import os
import json
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator
from datetime import datetime
import torch
from concurrent.futures import ThreadPoolExecutor
from collections import deque
from ai.environment import (
    GameEnvironment,
    TIMEOUT_PENALTY,
    WIN_BONUS,
    FINAL_MOVE_BONUS,
)
from ai.bot import GameBot
from config import (
    TRAINING_CONFIG,
    MODEL_DIR,
    PLOT_DIR,
    LOG_DIR,
    REWARD_SCHEDULE,
    HEAVY_REWARD_BASE,
    WINRATE_TARGET,
    MAX_REWARD_MULTIPLIER,
    MIN_REWARD_MULTIPLIER,
    REWARD_TUNE_STEP,
)
from json_logger import info, warning
import random

from typing import Optional


class TrainingManager:
    def __init__(self, num_envs: int = 1, *, num_trainable_bots: int = 4,
                 fixed_model_dir: Optional[str] = None):
        self.pieces_per_player = 1
        self.turn_limit = 100 * self.pieces_per_player
        self.num_trainable_bots = num_trainable_bots
        self.fixed_model_dir = fixed_model_dir
        self.env = GameEnvironment(
            env_id=0,
            pieces_per_player=self.pieces_per_player,
            turn_limit=self.turn_limit,
        )
        # Additional environments for parallel execution
        self.envs = [
            GameEnvironment(
                env_id=i,
                pieces_per_player=self.pieces_per_player,
                turn_limit=self.turn_limit,
            )
            for i in range(max(1, num_envs))
        ]
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
            'reward_breakdown_history': [],
            'completed_pieces': [],
            'homestretch_pieces': []
        }

        # Optional external list storing per-episode reward contributions
        # This allows plotting detailed breakdowns without modifying the core
        # environment logic.
        self.reward_breakdown_history = self.training_stats['reward_breakdown_history']

        # Track bonus rewards separately
        self.training_stats['bonus_breakdown_history'] = []
        self.bonus_breakdown_history = self.training_stats['bonus_breakdown_history']

        self.total_training_steps = 0

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

        # Snapshot training setup
        self.snapshot_dir = 'snapshots'
        os.makedirs(self.snapshot_dir, exist_ok=True)
        self.snapshot_freq = 2000
        self.focus_interval = 500
        self._train_focus_pointer = 0
        self.train_focus_idx = 0
        self.latest_snapshot = None

        # Create directories
        for directory in [MODEL_DIR, PLOT_DIR, LOG_DIR]:
            os.makedirs(directory, exist_ok=True)

        # Curriculum tracking
        self.stage_games = 0
        self.stage_winning_games = 0
        self.recent_outcomes = deque(maxlen=500)

        # Reward multiplier per difficulty level
        self.level_reward_multiplier = {}

    def _stats_interval(self) -> int:
        """Return plotting interval based on current piece count."""
        return 500 if self.pieces_per_player < 4 else 100

    
    def create_bots(self, num_bots=4):
        self.bots = []
        self.trainable_bots = []
        self.fixed_bots = []

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
                bot = GameBot(
                    player_id=i,
                    state_size=self.env.state_size,
                    action_size=self.env.action_space_size,
                    bot_id=i
                )

            if i < self.num_trainable_bots:
                bot.trainable = True
                self.trainable_bots.append(bot)
            else:
                bot.trainable = False
                if self.fixed_model_dir:
                    path = os.path.join(self.fixed_model_dir, f"bot_{i}.pth")
                    if os.path.exists(path):
                        try:
                            bot.load_model(path, reset_stats=False)
                            info("Loaded fixed bot", bot=i, path=path)
                        except Exception:
                            warning("Failed to load fixed bot", bot=i)
                self.fixed_bots.append(bot)

            self.bots.append(bot)

        info("Created bots for training", count=num_bots, gpus=num_gpus)
        self.stage_start_wins = [0 for _ in range(num_bots)]
        self.stage_start_games = [0 for _ in range(num_bots)]
        # Track how many games have been played in the current curriculum stage
        self.stage_games = 0
        # Track how many of those games ended with a winner
        self.stage_winning_games = 0

    def _shuffle_bots(self) -> None:
        """Randomize bot seating positions for the next episode."""
        random.shuffle(self.bots)
        for idx, bot in enumerate(self.bots):
            bot.player_id = idx
        trainable_indices = [i for i, b in enumerate(self.bots) if getattr(b, 'trainable', True)]
        if trainable_indices:
            self.train_focus_idx = trainable_indices[self._train_focus_pointer % len(trainable_indices)]

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
        """Update environment reward weight according to the schedule and
        per-level multiplier."""
        weight = env.heavy_reward
        for start, value in REWARD_SCHEDULE:
            if episode >= start:
                weight = value
        multiplier = self.level_reward_multiplier.get(self.pieces_per_player, 1.0)
        env.set_heavy_reward(weight * multiplier)
        env.set_win_bonus(WIN_BONUS * multiplier)

    def _adjust_reward_multiplier(self, win_rate: float, env: GameEnvironment) -> None:
        """Update the reward multiplier based on the observed win rate."""
        level = self.pieces_per_player
        factor = self.level_reward_multiplier.get(level, 1.0)
        if win_rate < WINRATE_TARGET:
            factor = min(factor + REWARD_TUNE_STEP, MAX_REWARD_MULTIPLIER)
        elif win_rate > WINRATE_TARGET + 0.15:
            factor = max(factor - REWARD_TUNE_STEP, MIN_REWARD_MULTIPLIER)
        self.level_reward_multiplier[level] = factor
        # Immediately apply the updated multiplier so the next episode reflects
        # the change.
        self._apply_reward_schedule(self.training_stats['games_played'], env)

    def _log_reward_summary(self, interval: int = 100) -> None:
        """Aggregate reward totals for the last ``interval`` episodes and log them."""
        if len(self.reward_breakdown_history) < interval:
            return

        start = len(self.reward_breakdown_history) - interval
        totals: dict = {}
        for entry in self.reward_breakdown_history[start:]:
            for key, value in entry.items():
                totals[key] = totals.get(key, 0.0) + value

        bonus_totals: dict = {}
        for entry in self.bonus_breakdown_history[start:]:
            for key, value in entry.items():
                bonus_totals[key] = bonus_totals.get(key, 0.0) + value

        summary = {k: round(v, 2) for k, v in totals.items()}
        for k, v in bonus_totals.items():
            summary[k] = round(summary.get(k, 0.0) + v, 2)

        info(f"Reward totals last {interval} games", **summary)
    
    def train_episode(self, env=None):
        """Run a single training episode using the provided environment."""
        env = env or self.env

        episode_num = self.training_stats['games_played']
        if episode_num > 0 and episode_num % self.focus_interval == 0:
            trainable_count = max(1, len(self.trainable_bots))
            self._train_focus_pointer = (self._train_focus_pointer + 1) % trainable_count

        if (
            episode_num > 0
            and episode_num % 5000 == 0
        ):
            seed = np.random.randint(0, 2**32 - 1)
            np.random.seed(seed)
            env.reseed(seed)

        # Randomize bot seating for this episode
        self._shuffle_bots()

        if self.latest_snapshot and episode_num % 4 != 0:
            opponents = [i for i in range(len(self.bots)) if i != self.train_focus_idx]
            num_snapshot = np.random.randint(1, len(opponents) + 1)
            chosen = random.sample(opponents, num_snapshot)
            for idx in chosen:
                try:
                    self.bots[idx].load_model(self.latest_snapshot, reset_stats=False)
                except Exception:
                    pass

        # Names for logging the actual bot identities in the Node game
        bot_names = [f"Bot_{bot.bot_id}" if hasattr(bot, 'bot_id') else f"Bot_{i}" for i, bot in enumerate(self.bots)]

        # Reset environment with the ordered bot names
        initial_state = env.reset(bot_names=bot_names)
        env.reset_reward_events()

        episode_rewards = [0] * 4
        states = [None] * 4
        actions = [None] * 4
        step_records = []
        
        step_count = 0
        max_steps = self.turn_limit
        
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
            game_won = False
            if done:
                winners = env.game_state.get('winningTeam') or []
                game_won = any(
                    pl.get('position') == current_player for pl in winners
                )
            bonus = 0.0
            info_dict = getattr(env, "last_step_info", None)
            if done and info_dict:
                bonus += info_dict.get('win_bonus', 0.0)
                bonus += info_dict.get('final_move_bonus', 0.0)
            reward += 0.01 * getattr(current_bot, 'last_entropy', 0.0)
            norm_reward = self._normalize_reward(reward)

            # Store experience only for the training focus bot
            if (
                current_player == self.train_focus_idx
                and states[current_player] is not None
            ):
                current_bot.remember(
                    states[current_player],
                    actions[current_player],
                    norm_reward,
                    next_state,
                    done,
                    game_won,
                    bonus,
                )

            # Update tracking
            states[current_player] = state
            actions[current_player] = action
            episode_rewards[current_player] += reward + bonus
            step_records.append((abs(reward + bonus), current_player, action, reward + bonus))
            
            # Train bot
            current_bot.step_count += 1
            if (
                current_player == self.train_focus_idx
                and current_bot.step_count % current_bot.train_freq == 0
            ):
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

            if (
                current_player == self.train_focus_idx
                and current_bot.step_count % current_bot.update_target_freq == 0
            ):
                current_bot.update_target_network()

            step_count += 1
            self.total_training_steps += 1

            if done:
                break

        if not env.game_state.get('gameEnded', False):
            for i in range(len(episode_rewards)):
                episode_rewards[i] += TIMEOUT_PENALTY
            env.reward_event_counts['timeout'] = (
                env.reward_event_counts.get('timeout', 0) + 1
            )
            env.reward_event_totals['timeout'] = (
                env.reward_event_totals.get('timeout', 0.0)
                + TIMEOUT_PENALTY * len(episode_rewards)
            )

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
            if winning_team:
                self.stage_winning_games += 1
            self.recent_outcomes.append(1 if winning_team else 0)
            for player in winning_team:
                player_pos = player.get('position', -1)
                if 0 <= player_pos < len(self.bots):
                    self.bots[player_pos].wins += 1
        else:
            self.recent_outcomes.append(0)

        # Update curriculum tracking
        self.stage_games += 1
        # Win rate based on the last 500 games only
        win_rate = (
            sum(self.recent_outcomes) / len(self.recent_outcomes)
            if self.recent_outcomes
            else 0.0
        )
        self._adjust_reward_multiplier(win_rate, env)
        info(
            "Curriculum progress",
            pieces=self.pieces_per_player,
            game=self.stage_games,
            win_rate=f"{win_rate:.2f}"
        )
        if (
            self.stage_games >= 5000
            and win_rate >= 0.55
            and self.pieces_per_player < 5
        ):
            self.pieces_per_player += 1
            self.turn_limit = 100 * self.pieces_per_player
            for env in [self.env] + self.envs:
                env.set_piece_count(self.pieces_per_player)
                env.set_turn_limit(self.turn_limit)
            self.stage_start_wins = [bot.wins for bot in self.bots]
            self.stage_start_games = [bot.games_played for bot in self.bots]
            self.stage_games = 0
            self.stage_winning_games = 0
            self.recent_outcomes.clear()
            info(
                "Increased difficulty",
                pieces=self.pieces_per_player,
                turns=self.turn_limit
            )

        summary = env.game_state.get('statsSummary')
        if summary:
            info("Game summary", summary=summary)

        if hasattr(env, "get_completed_counts"):
            completed_counts = env.get_completed_counts()
        else:
            completed_counts = [0] * len(self.bots)
            for p in env.game_state.get('pieces', []):
                pid = p.get('playerId')
                if pid is not None and 0 <= pid < len(self.bots):
                    if p.get('completed'):
                        completed_counts[pid] += 1
        homestretch_counts = [0] * len(self.bots)
        for p in env.game_state.get('pieces', []):
            pid = p.get('playerId')
            if pid is not None and 0 <= pid < len(self.bots):
                if p.get('inHomeStretch'):
                    homestretch_counts[pid] += 1

        self.training_stats['completed_pieces'].append(completed_counts)
        self.training_stats['homestretch_pieces'].append(homestretch_counts)

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
        self.bonus_breakdown_history.append(dict(env.reward_bonus_totals))

        if step_records:
            top = sorted(step_records, key=lambda x: x[0], reverse=True)[:3]
            info(
                "Top moves",
                moves=[
                    {"player": p, "action": a, "reward": round(r, 2)}
                    for _, p, a, r in top
                ],
            )

        if self.training_stats['games_played'] % 100 == 0:
            self._log_reward_summary()

        return episode_rewards
    
    def train(
        self,
        num_episodes=None,
        save_freq=None,
        stats_freq=None,
        num_envs: int = 1,
        save_match_log: bool = False,
    ):
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

                    if (episode + 1) % self.snapshot_freq == 0:
                        self.save_snapshot(episode + 1)

                    interval = self._stats_interval()
                    if (episode + 1) % interval == 0:
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
            self.envs = [
                GameEnvironment(
                    env_id=i,
                    pieces_per_player=self.pieces_per_player,
                    turn_limit=self.turn_limit,
                )
                for i in range(num_envs)
            ]
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

                    if (episode + 1) % self.snapshot_freq == 0:
                        self.save_snapshot((episode + 1) * num_envs)

                    interval = self._stats_interval()
                    if (episode + 1) % interval == 0:
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
            avg_clip = (
                np.mean(self.training_stats['clip_fractions'][-10:])
                if self.training_stats['clip_fractions']
                else 0
            )
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
        bot_colors = ['#3498db', '#000000', '#e74c3c', '#2ecc71']

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
        
        # Completed pieces per episode shown as stacked bars
        if self.training_stats['completed_pieces']:
            episodes = range(len(self.training_stats['completed_pieces']))
            pieces_array = np.array(self.training_stats['completed_pieces'], dtype=int)
            bottom = np.zeros(len(episodes))

            for bot_idx in range(pieces_array.shape[1]):
                values = pieces_array[:, bot_idx]
                color = bot_colors[bot_idx % len(bot_colors)]
                axs[1, 1].bar(
                    episodes,
                    values,
                    bottom=bottom,
                    label=f'Bot {bot_idx}',
                    color=color,
                )
                bottom += values

            axs[1, 1].yaxis.set_major_locator(MaxNLocator(integer=True))
            axs[1, 1].set_xlabel('Episode')
            axs[1, 1].set_ylabel('Completed Pieces')
            axs[1, 1].set_title('Completed Pieces per Bot')
            axs[1, 1].legend()
        else:
            axs[1, 1].axis('off')

        # Reward breakdown stacked bar chart with distinct colors
        if self.reward_breakdown_history:
            episodes = list(range(len(self.reward_breakdown_history)))

            combined_history = []
            for i, entry in enumerate(self.reward_breakdown_history):
                combined = dict(entry)
                if i < len(self.bonus_breakdown_history):
                    for k, v in self.bonus_breakdown_history[i].items():
                        combined[k] = combined.get(k, 0.0) + v
                combined_history.append(combined)

            totals: dict = {}
            for entry in combined_history:
                for key, value in entry.items():
                    totals[key] = totals.get(key, 0) + value

            sorted_keys = sorted(totals, key=totals.get, reverse=True)

            data = {k: [] for k in sorted_keys}
            for entry in combined_history:
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
                'timeout': 'orange',
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

    def save_snapshot(self, episode: int) -> None:
        """Save the best-performing bot as a frozen snapshot."""
        if not self.bots:
            return

        def win_rate(bot):
            return (bot.wins / bot.games_played) if bot.games_played else 0.0

        best_bot = max(self.bots, key=win_rate)
        path = os.path.join(
            self.snapshot_dir,
            f"bot_{best_bot.bot_id}_ep{episode}.pt",
        )
        best_bot.save_model(path)
        self.latest_snapshot = path
        info("Saved snapshot", bot=best_bot.bot_id, episode=episode, path=path)

