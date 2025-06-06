import os
import json
import numpy as np
import matplotlib.pyplot as plt
from datetime import datetime
from ai.environment import GameEnvironment
from ai.bot import GameBot
from config import TRAINING_CONFIG, MODEL_DIR, PLOT_DIR, LOG_DIR

class TrainingManager:
    def __init__(self):
        self.env = GameEnvironment()
        self.bots = []
        self.training_stats = {
            'episode_rewards': [],
            'win_rates': [],
            'average_losses': [],
            'games_played': 0
        }
        
        # Create directories
        for directory in [MODEL_DIR, PLOT_DIR, LOG_DIR]:
            os.makedirs(directory, exist_ok=True)
    
    def create_bots(self, num_bots=4):
        self.bots = []
        for i in range(num_bots):
            bot = GameBot(
                player_id=i,
                state_size=self.env.state_size,
                action_size=self.env.action_space_size
            )
            self.bots.append(bot)
        print(f"Created {num_bots} bots for training")
    
    def train_episode(self):
        # Reset environment
        initial_state = self.env.reset()
        
        episode_rewards = [0] * 4
        states = [None] * 4
        actions = [None] * 4
        
        step_count = 0
        max_steps = 1000
        
        while step_count < max_steps:
            # Get current player from game state
            current_player = self.env.game_state.get('currentPlayerIndex', 0)
            current_bot = self.bots[current_player]
            
            # Get current state and valid actions
            state = self.env.get_state(current_player)
            valid_actions = self.env.get_valid_actions(current_player)
            
            if not valid_actions:
                break
            
            # Bot chooses action
            action = current_bot.act(state, valid_actions)
            
            # Execute action
            next_state, reward, done = self.env.step(action, current_player)
            
            # Store experience
            if states[current_player] is not None:
                current_bot.remember(
                    states[current_player],
                    actions[current_player],
                    reward,
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
                current_bot.replay()
            
            if current_bot.step_count % current_bot.update_target_freq == 0:
                current_bot.update_target_network()
            
            step_count += 1
            
            if done:
                break
        
        # Update statistics
        for i, bot in enumerate(self.bots):
            bot.total_reward += episode_rewards[i]
            bot.games_played += 1
        
        # Check for winners
        if self.env.game_state.get('gameEnded', False):
            winning_team = self.env.game_state.get('winningTeam', [])
            for player in winning_team:
                player_pos = player.get('position', -1)
                if 0 <= player_pos < len(self.bots):
                    self.bots[player_pos].wins += 1
        
        self.training_stats['games_played'] += 1
        self.training_stats['episode_rewards'].append(sum(episode_rewards))
        
        return episode_rewards
    
    def train(self, num_episodes=None, save_freq=None, stats_freq=None):
        num_episodes = num_episodes or TRAINING_CONFIG['num_episodes']
        save_freq = save_freq or TRAINING_CONFIG['save_frequency']
        stats_freq = stats_freq or TRAINING_CONFIG['stats_frequency']
        
        print(f"Starting training for {num_episodes} episodes...")
        
        # Start the game environment
        if not self.env.start_node_game():
            print("Failed to start Node.js game process")
            return
        
        try:
            for episode in range(num_episodes):
                episode_rewards = self.train_episode()
                
                # Print progress
                if episode % stats_freq == 0:
                    self.print_statistics(episode)
                    self.plot_training_progress()
                
                # Save models
                if episode % save_freq == 0:
                    self.save_models(f"{MODEL_DIR}/episode_{episode}")
            
            print("Training completed!")
            self.save_models(f"{MODEL_DIR}/final")
            self.plot_training_progress()
            
        finally:
            self.env.close()
    
    def print_statistics(self, episode):
        print(f"\n=== Episode {episode} Statistics ===")
        
        for i, bot in enumerate(self.bots):
            win_rate = (bot.wins / bot.games_played * 100) if bot.games_played > 0 else 0
            avg_reward = bot.total_reward / bot.games_played if bot.games_played > 0 else 0
            avg_loss = np.mean(bot.losses[-100:]) if bot.losses else 0
            
            print(f"Bot {i}: Win Rate: {win_rate:.1f}%, "
                  f"Avg Reward: {avg_reward:.2f}, "
                  f"Epsilon: {bot.epsilon:.3f}, "
                  f"Avg Loss: {avg_loss:.4f}")
    
    def plot_training_progress(self):
        fig, axes = plt.subplots(2, 2, figsize=(15, 10))
        
        # Episode rewards
        if self.training_stats['episode_rewards']:
            axes[0, 0].plot(self.training_stats['episode_rewards'])
            axes[0, 0].set_title('Episode Rewards')
            axes[0, 0].set_xlabel('Episode')
            axes[0, 0].set_ylabel('Total Reward')
        
        # Win rates
        win_rates = []
        for bot in self.bots:
            win_rate = (bot.wins / bot.games_played * 100) if bot.games_played > 0 else 0
            win_rates.append(win_rate)
        
        axes[0, 1].bar(range(len(win_rates)), win_rates)
        axes[0, 1].set_title('Win Rates by Bot')
        axes[0, 1].set_xlabel('Bot ID')
        axes[0, 1].set_ylabel('Win Rate (%)')
        
        # Average losses
        for i, bot in enumerate(self.bots):
            if bot.losses:
                window_size = min(100, len(bot.losses))
                if window_size > 0:
                    moving_avg = np.convolve(bot.losses, np.ones(window_size)/window_size, mode='valid')
                    axes[1, 0].plot(moving_avg, label=f'Bot {i}')
        
        axes[1, 0].set_title('Training Loss (Moving Average)')
        axes[1, 0].set_xlabel('Training Step')
        axes[1, 0].set_ylabel('Loss')
        axes[1, 0].legend()
        
        # Epsilon decay
        epsilons = [bot.epsilon for bot in self.bots]
        axes[1, 1].bar(range(len(epsilons)), epsilons)
        axes[1, 1].set_title('Current Epsilon Values')
        axes[1, 1].set_xlabel('Bot ID')
        axes[1, 1].set_ylabel('Epsilon')
        
        plt.tight_layout()
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        plt.savefig(f'{PLOT_DIR}/training_progress_{timestamp}.png')
        plt.close()
    
    def save_models(self, base_path):
        os.makedirs(base_path, exist_ok=True)
        
        for i, bot in enumerate(self.bots):
            bot.save_model(f"{base_path}/bot_{i}.pth")
        
        # Save training statistics
        with open(f"{base_path}/training_stats.json", 'w') as f:
            json.dump(self.training_stats, f, indent=2)
        
        print(f"Models saved to {base_path}")
    
    def load_models(self, base_path):
        for i, bot in enumerate(self.bots):
            model_path = f"{base_path}/bot_{i}.pth"
            if os.path.exists(model_path):
                bot.load_model(model_path)
                print(f"Loaded model for bot {i}")

