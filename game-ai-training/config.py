# Training configuration
TRAINING_CONFIG = {
    'num_episodes': 5000,
    'save_frequency': 500,
    'stats_frequency': 10,
    'learning_rate': 0.001,
    'batch_size': 32,
    'memory_size': 10000,
    'gamma': 0.95,
    'hidden_size': 512,
    'train_freq': 4,
    'ppo_clip': 0.2,
    # Encourage exploration slightly more by increasing the entropy term.
    'entropy_weight': 0.02,
    # Target KL divergence used for monitoring training stability.
    'kl_target': 0.02,
    # How often the bot's target network should be updated.
    # Used by TrainingManager to call GameBot.update_target_network().
    # Defaulting to a relatively high value keeps updates infrequent
    # but allows quick overrides in custom configs.
    'update_target_freq': 1000
}

# Paths
MODEL_DIR = 'models'
PLOT_DIR = 'plots'
LOG_DIR = 'logs'

# Logging
import os
JSON_LOGGING = os.getenv('JSON_LOGGING', '0').lower() in ('1', 'true', 'yes')

