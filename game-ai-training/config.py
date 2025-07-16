# Training configuration
TRAINING_CONFIG = {
    'num_episodes': 5000,
    'save_frequency': 500,
    'stats_frequency': 10,
    'learning_rate': 3e-4,
    'batch_size': 64,
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
    'update_target_freq': 1000,
    'lr_final': 1e-5
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
# Increase heavy reward to give stronger incentives for impactful plays.
# A small positive value helps bots prioritise key actions without
# overwhelming the simpler reward structure.
HEAVY_REWARD_BASE = 2.0
# Curriculum stages can still adjust the weight but default to zero.
REWARD_SCHEDULE = [
    (0, HEAVY_REWARD_BASE),
]

# Dynamic reward tuning
# If the win rate for the current difficulty drops below this threshold the
# trainer gradually increases bonus rewards. When it climbs well above the
# target the bonuses decay back toward the base schedule.
WINRATE_TARGET = 0.75
# Maximum multiplier applied to ``HEAVY_REWARD_BASE`` and ``WIN_BONUS``
MAX_REWARD_MULTIPLIER = 2.0
# Minimum multiplier applied to keep rewards from shrinking too far
MIN_REWARD_MULTIPLIER = 0.5
# Step size used when adjusting the reward multiplier up or down
REWARD_TUNE_STEP = 0.1

# Multiplier applied to positive rewards based on the current
# number of pieces per player. The curriculum increases the
# difficulty by adding more pieces, so rewards must scale up to
# remain meaningful. Levels correspond to piece counts from 1 to 5.
# Scale down positive reward multipliers so penalties remain
# meaningful relative to the bonuses awarded for successful plays.
POSITIVE_REWARD_MULTIPLIERS = {
    1: 600.0,
    2: 500.0,
    3: 250.0,
    4: 225.0,
    5: 50.0,
}

