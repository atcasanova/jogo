# Training configuration
TRAINING_CONFIG = {
    'num_episodes': 5000,
    'save_frequency': 500,
    'stats_frequency': 10,
    'learning_rate': 2.5e-5,
    'batch_size': 32,
    'memory_size': 10000,
    'gamma': 0.95,
    'hidden_size': 512,
    'train_freq': 4,
    'ppo_clip': 0.1,
    # Slight entropy bonus to maintain exploration without destabilising updates.
    'entropy_weight': 0.005,
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

# Reward shaping
# ``HEAVY_REWARD_BASE`` defines the default additional reward granted when a
# high value play occurs such as entering the home stretch or leaving the
# penalty zone with a capture. ``REWARD_SCHEDULE`` can override this value at
# different points during training to implement a simple curriculum. Each tuple
# in the list is ``(episode_start, heavy_reward)``.
HEAVY_REWARD_BASE = 200.0
# The heavy reward decreases over time so early training emphasises key moves
REWARD_SCHEDULE = [
    (0, HEAVY_REWARD_BASE),
    (1000, HEAVY_REWARD_BASE * 0.75),
    (3000, HEAVY_REWARD_BASE * 0.5),
]

