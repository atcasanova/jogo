# Training configuration
TRAINING_CONFIG = {
    'num_episodes': 5000,
    'save_frequency': 500,
    'stats_frequency': 10,
    'learning_rate': 7e-5,
    'batch_size': 128,
    'memory_size': 50000,
    'gamma': 0.95,
    'hidden_size': 1024,
    'train_freq': 4,
    'ppo_clip': 0.08,
    # Slight entropy bonus to maintain exploration without destabilising updates.
    'entropy_weight': 0.005,
    # Target KL divergence used for monitoring training stability.
    'kl_target': 0.02,
    # How often the bot's target network should be updated.
    # Used by TrainingManager to call GameBot.update_target_network().
    # Defaulting to a relatively high value keeps updates infrequent
    # but allows quick overrides in custom configs.
    'update_target_freq': 1000,
    'lr_final': 7e-6
}

# Piece-dependent entropy regularization. Harder stages use lower entropy so
# the policy can consolidate and stop dithering in long games.
ENTROPY_WEIGHT_SCHEDULE = {
    1: 0.005,
    2: 0.004,
    3: 0.003,
    4: 0.0025,
    5: 0.0015,
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


# Dynamic speed/closing tuning. These multipliers scale win-speed bonuses,
# late-game urgency, long-game penalties, and unresolved timeout penalties.
TIMEOUT_TUNE_TARGET = 0.15
SLOW_TERMINAL_TURN_FRAC = 0.60
MAX_SPEED_REWARD_MULTIPLIER = 2.0
MIN_SPEED_REWARD_MULTIPLIER = 0.75
SPEED_TUNE_STEP = 0.1

# Terminal outcome credit for teammates who contributed earlier in the episode
# but were not the actor on the final move, plus a matching team loss signal.
TEAM_TERMINAL_CREDIT_RATIO = 1.0
TEAM_TERMINAL_LOSS_RATIO = 1.0

# Curriculum bridge/rollback controls for the final stage.
STAGE5_MIX_FROM_GAME = 1000
STAGE5_MIX_LOWER_STAGE_RATIO = 0.25
STAGE5_ROLLBACK_MIN_GAMES = 2500
STAGE5_ROLLBACK_DECISIVE_RATE = 0.08
STAGE_PROMOTION_CONFIRM_WINDOWS = 3
STAGE5_ROLLBACK_CONFIRM_WINDOWS = 4
STAGE5_TURN_LIMIT_BOOST = 200

# Event-based reward weights used by ``GameEnvironment``. The environment
# computes a weighted sum and then clips the total to reduce reward spikes.
REWARD_WEIGHTS = {
    # Completing a piece remains a strong objective signal, but lower than
    # before to reduce farming of intermediate rewards without closing games.
    'home_completion': 35.0,
    # Discourage skipping a valid home entry.
    'skip_home': -1.0,
    # Reward entering the home stretch; this is boosted when it follows
    # an 8-card setup that newly put the piece within entry reach.
    'home_entry': 8.0,
    # Small tactical bonuses to improve credit assignment.
    'home_entry_progress': 1.0,
    'capture': 2.0,
    'safe_move': 1.0,
    # Team outcome signal.
    'win': 100.0,
    'loss': -80.0,
}

# Extra piece completion bonus applied in addition to the base completion
# reward. Helps agents value converting progress into fully completed pieces.
PIECE_COMPLETION_BONUS = 8.0

# Bonus granted when a team reaches "one move from victory" by completing all
# but one piece. This creates a bridge between shaping rewards and final wins.
NEAR_FINISH_BONUS = 10.0

# Bonus for converting a near-finish state into a win soon after reaching it.
NEAR_FINISH_CONVERSION_WINDOW = 32
NEAR_FINISH_CONVERSION_BONUS = 30.0

# Small per-step penalty to encourage faster game resolution.
STEP_PENALTY_BASE = -0.01

# Additional penalty for long-running games. Applied in increasing tiers every
# ``LONG_GAME_PENALTY_INTERVAL`` turns once ``LONG_GAME_PENALTY_START`` is
# reached, so stalling policies become progressively less attractive.
LONG_GAME_PENALTY_START = 180
LONG_GAME_PENALTY_INTERVAL = 50
LONG_GAME_PENALTY_BASE = -0.05

# Extra bonus awarded on wins that finish well before the turn limit.
FAST_FINISH_BONUS_SCALE = 40.0

# Additional late-game urgency signal: penalty ramps up after
# ``URGENCY_PENALTY_START_FRAC`` of the turn budget has been consumed.
# Speed pressure is intentionally stronger than the baseline tactical-card
# curriculum so policies that already find good plays learn to close sooner.
URGENCY_PENALTY_START_FRAC = 0.60
URGENCY_PENALTY_BASE = -0.35

# Cap loopable shaping rewards to reduce farming behavior.
HOME_ENTRY_PROGRESS_CAP = 120.0
CAPTURE_REWARD_CAP = 80.0

# Anti-stall penalties.
NO_PROGRESS_WINDOW = 24
NO_PROGRESS_PENALTY = -0.8
REPEATED_STATE_THRESHOLD = 3
REPEATED_STATE_PENALTY = -0.6

# Clip range for the per-step weighted reward sum.
REWARD_CLIP_RANGE = (-250.0, 250.0)

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

# Turn budget per piece count. Higher stages need more moves to finish
# reliably; a too-small limit can artificially inflate timeout rates.
TURN_LIMIT_SCHEDULE = {
    1: 120,
    2: 280,
    3: 520,
    4: 760,
    5: 1000,
}
