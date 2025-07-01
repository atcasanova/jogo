import os
import json
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime
import torch
from concurrent.futures import ThreadPoolExecutor
from ai.environment import GameEnvironment
from ai.bot import GameBot
from config import TRAINING_CONFIG, MODEL_DIR, PLOT_DIR, LOG_DIR, REWARD_SCHEDULE
from json_logger import info, warning
import random

class TrainingManager:
    def __init__(self, num_envs: int = 1):
        self.env = GameEnvironment(env_id=0)
        # Additional environments for parallel execution
        self.envs = [GameEnvironment(env_id=i) for i in range(max(1, num_envs))]
        self.bots = []
        self.training_stats = {
            'episode_rewards': [],
            'win_rates': [],
            'average_losses': [],
            'kl_divergences': [],
            'clip_fractions': [],
            'entropy_avgs': [],
            'games_played': 0,
            'reward_entropies': [],
            'reward_breakdown_history': []
        }

        # Optional external list storing per-episode reward contributions
        # This allows plotting detailed breakdowns without modifying the core
        # environment logic.
        self.reward_breakdown_history = self.training_stats['reward_breakdown_history']

        self.kl_target = TRAINING_CONFIG.get('kl_target', 0.02)
        self.kl_threshold = self.kl_target / 2
        self.low_kl_count = 0
        self.kl_warning_steps = 100
        self.loss_window = 100

        self.lr_start = TRAINING_CONFIG.get('learning_rate', 3e-4)
        self.lr_final = TRAINING_CONFIG.get('lr_final', self.lr_start / 10)

        # Running statistics for reward normalisation
        self.reward_mean = 0.0
        self.reward_var = 1.0
        self.reward_alpha = 0.99

        # Create directories
        for directory in [MODEL_DIR, PLOT_DIR, LOG_DIR]:
            os.makedirs(directory, exist_ok=True)
    
    def create_bots(self, num_bots=4):
        self.bots = []

        # Determine how many GPUs are available. When torch is mocked in tests
        # these calls may not return integers, so fall back to CPU in that case.
        num_gpus = 0
        if torch.cuda.is_available():
            try:
                count = torch.cuda.device_count()
                if isinstance(count, int):
                    num_gpus = count
            except Exception:
                num_gpus = 0

        for i in range(num_bots):
            if num_gpus > 0:
                device = f"cuda:{i % num_gpus}"
            else:
                device = "cpu"

            try:
                bot = GameBot(
                    player_id=i,
                    state_size=self.env.state_size,
                    action_size=self.env.action_space_size,
                    device=device,
                    bot_id=i
                )
            except TypeError:
                # For backward compatibility or when GameBot is mocked without
                # a device parameter
                bot = GameBot(
                    player_id=i,
                    state_size=self.env.state_size,
                    action_size=self.env.action_space_size,
                    bot_id=i
                )
            self.bots.append(bot)

        info("Created bots for training", count=num_bots, gpus=num_gpus)

    def _shuffle_bots(self) -> None:
        """Randomize bot seating positions for the next episode."""
        random.shuffle(self.bots)
        for idx, bot in enumerate(self.bots):
            bot.player_id = idx

    def _check_kl_warning(self, kl_value: float) -> None:
        """Warn if KL divergence remains below the threshold for many updates."""
        if kl_value < self.kl_threshold:
            self.low_kl_count += 1
        else:
            self.low_kl_count = 0

        if self.low_kl_count >= self.kl_warning_steps:
            warning(
                "KL divergence consistently low",
                kl=f"{kl_value:.4f}",
                steps=self.low_kl_count,
                threshold=f"{self.kl_threshold:.4f}"
            )

    def _check_loss_stagnation(self) -> None:
        """Warn when average loss shows little change across bots."""
        stagnant = True
        for bot in self.bots:
            if len(bot.losses) < self.loss_window * 2:
                stagnant = False
                break
            recent_avg = np.mean(bot.losses[-self.loss_window:])
            prev_avg = np.mean(bot.losses[-2 * self.loss_window:-self.loss_window])
            if abs(prev_avg - recent_avg) > 1e-4:
                stagnant = False
                break

        if stagnant:
            warning("Loss appears stagnant across bots", window=self.loss_window)

    def _reward_entropy(self, counts: dict) -> float:
        """Compute Shannon entropy of reward source distribution."""
        total = sum(counts.values())
        if total == 0:
            return 0.0
        probs = np.array([c / total for c in counts.values() if c > 0])
        return float(-(probs * np.log2(probs)).sum())

    def _normalize_reward(self, reward: float) -> float:
        """Return reward normalised using a running standard deviation."""
        self.reward_mean = (
            self.reward_alpha * self.reward_mean + (1 - self.reward_alpha) * reward
        )
        diff = reward - self.reward_mean
        self.reward_var = self.reward_alpha * self.reward_var + (1 - self.reward_alpha) * (diff ** 2)
        std = max(np.sqrt(self.reward_var), 1e-6)
        return diff / std

    def _adjust_ppo_params(self, bot: GameBot, kl: float) -> None:
        """Dynamically adjust learning rate and clip range based on KL."""
        target = self.kl_target
        if kl > target * 1.5:
            bot.clip_eps = max(bot.clip_eps * 0.9, 0.05)
            for group in bot.optimizer.param_groups:
                group['lr'] *= 0.5
        elif kl < target * 0.5:
            bot.clip_eps = min(bot.clip_eps * 1.1, 0.3)
            for group in bot.optimizer.param_groups:
                group['lr'] *= 1.1

    def _update_lr_schedule(self, bot: GameBot, progress: float) -> None:
        """Linearly decay the learning rate based on training progress."""
        lr = self.lr_start - progress * (self.lr_start - self.lr_final)
        for group in bot.optimizer.param_groups:
            group['lr'] = max(lr, self.lr_final)

    def _apply_reward_schedule(self, episode: int, env: GameEnvironment) -> None:
        """Update environment reward weight according to the configured schedule."""
        weight = env.heavy_reward
        for start, value in REWARD_SCHEDULE:
            if episode >= start:
                weight = value
        env.set_heavy_reward(weight)
    
    def train_episode(self, env=None):
        """Run a single training episode using the provided environment."""
        env = env or self.env

        # Randomize bot seating for this episode
        self._shuffle_bots()

        # Names for logging the actual bot identities in the Node game
        bot_names = [f"Bot_{bot.bot_id}" if hasattr(bot, 'bot_id') else f"Bot_{i}" for i, bot in enumerate(self.bots)]

        # Reset environment with the ordered bot names
        initial_state = env.reset(bot_names=bot_names)
        env.reset_reward_events()
        
        episode_rewards = [0] * 4
        states = [None] * 4
        actions = [None] * 4
        
        step_count = 0
        max_steps = 550
        
        while step_count < max_steps:
            # Get current player from game state
            current_player = env.game_state.get('currentPlayerIndex', 0)
            current_bot = self.bots[current_player]
            
            # Get current state and valid actions
            state = env.get_state(current_player)
            valid_actions = env.get_valid_actions(current_player)

            if valid_actions == []:
                warning(
                    "No valid actions left", step=step_count, player=current_player
                )
                break
            
            # Bot chooses action
            action = current_bot.act(state, valid_actions)
            
            # Execute action
            next_state, reward, done = env.step(action, current_player, step_count)
            reward += 0.01 * getattr(current_bot, 'last_entropy', 0.0)
            norm_reward = self._normalize_reward(reward)
            
            # Store experience
            if states[current_player] is not None:
                current_bot.remember(
                    states[current_player],
                    actions[current_player],
                    norm_reward,
                    next_state,
                    done
                )
            
            # Update tracking
            states[current_player] = state
            actions[current_player] = action
            episode_rewards[current_player] += reward
            
            # Train bot
            current_bot.step_count += 1
            if current_bot.step_count % current_bot.train_freq == 0:
                result = current_bot.replay()
                if result is not None:
                    kl, clipfrac, ent = result
                    self.training_stats['kl_divergences'].append(kl)
                    self.training_stats['clip_fractions'].append(clipfrac)
                    self.training_stats['entropy_avgs'].append(ent)
                    self._check_kl_warning(kl)
                    self._adjust_ppo_params(current_bot, kl)
                    progress = self.training_stats['games_played'] / TRAINING_CONFIG['num_episodes']
                    self._update_lr_schedule(current_bot, progress)
            
            if current_bot.step_count % current_bot.update_target_freq == 0:
                current_bot.update_target_network()
            
            step_count += 1
            
            if done:
                break
        
        # Update statistics
        for i, bot in enumerate(self.bots):
            capped = episode_rewards[i]
            if capped < -10000:
                capped = -10000
            bot.total_reward += capped
            bot.games_played += 1
        
        # Check for winners
        if env.game_state.get('gameEnded', False):
            winning_team = env.game_state.get('winningTeam', [])
            for player in winning_team:
                player_pos = player.get('position', -1)
                if 0 <= player_pos < len(self.bots):
                    self.bots[player_pos].wins += 1

        summary = env.game_state.get('statsSummary')
        if summary:
            info("Game summary", summary=summary)

        self.training_stats['games_played'] += 1
        ep_total = sum(episode_rewards)
        if ep_total < -10000:
            ep_total = -10000
        self.training_stats['episode_rewards'].append(ep_total)
        entropy = self._reward_entropy(env.reward_event_counts)
        self.training_stats['reward_entropies'].append(entropy)
        info(
            "Reward events",
            home_entries=env.reward_event_counts['home_entry'],
            penalty_exits=env.reward_event_counts['penalty_exit'],
            captures=env.reward_event_counts['capture'],
            wins=env.reward_event_counts['game_win'],
            entropy=f"{entropy:.3f}"
        )

        # Store per-episode reward totals to allow plotting breakdowns later
        self.reward_breakdown_history.append(dict(env.reward_event_totals))

        return episode_rewards
    
    def train(self, num_episodes=None, save_freq=None, stats_freq=None, num_envs: int = 1, save_match_log: bool = False):
        """Train using one or more environments in parallel."""
        num_episodes = num_episodes or TRAINING_CONFIG['num_episodes']
        save_freq = save_freq or TRAINING_CONFIG['save_frequency']
        stats_freq = stats_freq or TRAINING_CONFIG['stats_frequency']

        info("Starting training", episodes=num_episodes, envs=num_envs)

        if num_envs <= 1:
            # Start the single environment
            if not self.env.start_node_game():
                warning("Failed to start Node.js game process")
                return

            try:
                for episode in range(num_episodes):
                    self._apply_reward_schedule(episode, self.env)
                    self.train_episode(self.env)

                    if (episode + 1) % stats_freq == 0:
                        self.print_statistics(episode + 1)
                        self.plot_training_progress()

                    if (episode + 1) % save_freq == 0:
                        self.save_models(f"{MODEL_DIR}/episode_{episode + 1}")
                        if save_match_log:
                            log_file = os.path.join(
                                LOG_DIR,
                                f"episode_{episode + 1}_env_{self.env.env_id}.log"
                            )
                            self.env.save_history(log_file)

                info("Training completed")
                self.save_models(f"{MODEL_DIR}/final")
                self.plot_training_progress()

            finally:
                self.env.close()
        else:
            # Initialize and start multiple environments
            self.envs = [GameEnvironment(env_id=i) for i in range(num_envs)]
            for env in self.envs:
                if not env.start_node_game():
                    warning("Failed to start Node.js game process")
                    return

            try:
                for episode in range(num_episodes):
                    for env in self.envs:
                        self._apply_reward_schedule(episode, env)
                    with ThreadPoolExecutor(max_workers=num_envs) as executor:
                        list(executor.map(self.train_episode, self.envs))

                    if (episode + 1) % stats_freq == 0:
                        self.print_statistics((episode + 1) * num_envs)
                        self.plot_training_progress()

                    if (episode + 1) % save_freq == 0:
                        self.save_models(
                            f"{MODEL_DIR}/episode_{(episode + 1) * num_envs}"
                        )
                        if save_match_log:
                            for env in self.envs:
                                log_file = os.path.join(
                                    LOG_DIR,
                                    f"episode_{(episode + 1) * num_envs}_env_{env.env_id}.log"
                                )
                                env.save_history(log_file)

                info("Training completed")
                self.save_models(f"{MODEL_DIR}/final")
                self.plot_training_progress()

            finally:
                for env in self.envs:
                    env.close()
    
    def print_statistics(self, episode):
        info("Episode statistics", episode=episode)
        
        sorted_bots = sorted(self.bots, key=lambda b: getattr(b, 'bot_id', 0))

        for bot in sorted_bots:
            win_rate = (bot.wins / bot.games_played * 100) if bot.games_played > 0 else 0
            avg_reward = bot.total_reward / bot.games_played if bot.games_played > 0 else 0
            avg_loss = np.mean(bot.losses[-100:]) if bot.losses else 0

            info(
                "Bot stats",
                bot=bot.bot_id,
                win_rate=f"{win_rate:.1f}",
                avg_reward=f"{avg_reward:.2f}",
                avg_loss=f"{avg_loss:.4f}"
            )

        self._check_loss_stagnation()

        if self.training_stats['kl_divergences']:
            avg_kl = np.mean(self.training_stats['kl_divergences'][-10:])
            avg_clip = np.mean(self.training_stats['clip_fractions'][-10:]) if self.training_stats['clip_fractions'] else 0
            avg_ent = np.mean(self.training_stats['entropy_avgs'][-10:]) if self.training_stats['entropy_avgs'] else 0
            info(
                "PPO stats",
                kl=f"{avg_kl:.4f}",
                clip_frac=f"{avg_clip:.3f}",
                entropy=f"{avg_ent:.3f}"
            )
    
    def plot_training_progress(self):
        fig, axs = plt.subplots(2, 3, figsize=(18, 10))

        # Episode rewards
        if self.training_stats['episode_rewards']:
            axs[0, 0].plot(self.training_stats['episode_rewards'])
            axs[0, 0].set_title('Episode Rewards')
            axs[0, 0].set_xlabel('Episode')
            axs[0, 0].set_ylabel('Total Reward')
        
        # Win rates
        sorted_bots = sorted(self.bots, key=lambda b: getattr(b, 'bot_id', 0))
        colors = plt.rcParams['axes.prop_cycle'].by_key()['color']

        win_rates = []
        for bot in sorted_bots:
            win_rate = (bot.wins / bot.games_played * 100) if bot.games_played > 0 else 0
            win_rates.append(win_rate)

        bar_colors = [colors[bot.bot_id % len(colors)] for bot in sorted_bots]
        axs[0, 1].bar(range(len(sorted_bots)), win_rates, color=bar_colors)
        axs[0, 1].set_title('Win Rates by Bot')
        axs[0, 1].set_xlabel('Bot ID')
        axs[0, 1].set_xticks(range(len(sorted_bots)))
        axs[0, 1].set_xticklabels([bot.bot_id for bot in sorted_bots])
        axs[0, 1].set_ylabel('Win Rate (%)')

        # Reward entropy
        if self.training_stats['reward_entropies']:
            axs[0, 2].plot(self.training_stats['reward_entropies'])
        axs[0, 2].set_title('Reward Source Entropy')
        axs[0, 2].set_xlabel('Episode')
        axs[0, 2].set_ylabel('Entropy')
        
        # Average losses
        has_loss_plots = False
        for bot in sorted_bots:
            if bot.losses:
                window_size = min(100, len(bot.losses))
                if window_size > 0:
                    moving_avg = np.convolve(bot.losses, np.ones(window_size)/window_size, mode='valid')
                    color = colors[bot.bot_id % len(colors)]
                    axs[1, 0].plot(moving_avg, label=f'Bot {bot.bot_id}', color=color)
                    has_loss_plots = True
        axs[1, 0].set_title('Training Loss (Moving Average)')
        axs[1, 0].set_xlabel('Training Step')
        axs[1, 0].set_ylabel('Loss')
        if has_loss_plots:
            axs[1, 0].legend()
        
        # KL divergence and related metrics
        if self.training_stats['kl_divergences']:
            axs[1, 1].plot(self.training_stats['kl_divergences'], label='kl')
        if self.training_stats['clip_fractions']:
            axs[1, 1].plot(self.training_stats['clip_fractions'], label='clipfrac')
        if self.training_stats['entropy_avgs']:
            axs[1, 1].plot(self.training_stats['entropy_avgs'], label='entropy')
        axs[1, 1].set_title('PPO Diagnostics')
        axs[1, 1].set_xlabel('Training Step')
        axs[1, 1].set_ylabel('Value')
        if any(self.training_stats[k] for k in ['kl_divergences', 'clip_fractions', 'entropy_avgs']):
            axs[1, 1].legend()

        # Reward breakdown stacked bar chart with distinct colors
        if self.reward_breakdown_history:
            episodes = list(range(len(self.reward_breakdown_history)))

            totals: dict = {}
            for entry in self.reward_breakdown_history:
                for key, value in entry.items():
                    totals[key] = totals.get(key, 0) + value

            sorted_keys = sorted(totals, key=totals.get, reverse=True)

            data = {k: [] for k in sorted_keys}
            for entry in self.reward_breakdown_history:
                for k in sorted_keys:
                    data[k].append(entry.get(k, 0.0))

            pos_bottom = np.zeros(len(episodes))
            neg_bottom = np.zeros(len(episodes))

            custom_colors = [
                '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728',
                '#9467bd', '#8c564b', '#e377c2', '#7f7f7f',
                '#bcbd22', '#17becf'
            ]

            predefined_colors = {
                'home_entry': 'red',
                'penalty_exit': 'blue',
                'capture': 'green',
                'game_win': 'purple',
                'completion': 'yellow',
            }

            color_map = {}
            color_index = 0
            for k in sorted_keys:
                if k in predefined_colors:
                    color_map[k] = predefined_colors[k]
                else:
                    color_map[k] = custom_colors[color_index % len(custom_colors)]
                    color_index += 1

            for idx, k in enumerate(sorted_keys):
                values = np.array(data[k])
                pos_vals = np.where(values > 0, values, 0)
                neg_vals = np.where(values < 0, values, 0)

                label = k
                if np.any(pos_vals):
                    axs[1, 2].bar(
                        episodes,
                        pos_vals,
                        bottom=pos_bottom,
                        color=color_map[k],
                        label=label,
                    )
                    label = None
                    pos_bottom += pos_vals
                if np.any(neg_vals):
                    axs[1, 2].bar(
                        episodes,
                        neg_vals,
                        bottom=neg_bottom,
                        color=color_map[k],
                        label=label,
                    )
                    label = None
                    neg_bottom += neg_vals
                if label is not None:
                    axs[1, 2].bar([], [], color=color_map[k], label=label)

            axs[1, 2].axhline(0, color='black', linewidth=0.8)
            axs[1, 2].set_title('Reward Breakdown by Type')
            axs[1, 2].set_xlabel('Episode')
            axs[1, 2].set_ylabel('Reward')
            axs[1, 2].legend(loc='upper left', fontsize='small')
        else:
            axs[1, 2].axis('off')

        plt.tight_layout()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        plt.savefig(f'{PLOT_DIR}/training_progress_{timestamp}.png')
        plt.close()
    
    def save_models(self, base_path):
        os.makedirs(base_path, exist_ok=True)
        
        sorted_bots = sorted(self.bots, key=lambda b: getattr(b, 'bot_id', 0))

        for bot in sorted_bots:
            bot.save_model(f"{base_path}/bot_{bot.bot_id}.pth")
        
        # Save training statistics
        with open(f"{base_path}/training_stats.json", 'w') as f:
            json.dump(self.training_stats, f, indent=2)
        
        info("Models saved", path=base_path)
    
    def load_models(self, base_path):
        sorted_bots = sorted(self.bots, key=lambda b: getattr(b, 'bot_id', 0))

        for bot in sorted_bots:
            model_path = f"{base_path}/bot_{bot.bot_id}.pth"
            if os.path.exists(model_path):
                bot.load_model(model_path)
                info("Loaded model", bot=bot.bot_id)

