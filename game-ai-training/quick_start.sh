#!/bin/bash

# Quick start script for development/testing
# Runs training for a shorter duration

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Quick Start Training (500 episodes) ===${NC}"

# Create a temporary config for quick testing
cat > "$SCRIPT_DIR/config_quick.py" << 'EOF'
# Quick training configuration for testing
TRAINING_CONFIG = {
    'num_episodes': 500,        # Reduced for quick testing
    'save_frequency': 50,       # Save more frequently
    'stats_frequency': 25,      # Show stats more frequently
    'learning_rate': 0.001,
    'batch_size': 32,
    'memory_size': 5000,        # Smaller memory for faster startup
    'epsilon_start': 1.0,
    'epsilon_min': 0.01,
    'epsilon_decay': 0.995,
    'gamma': 0.95,
    'hidden_size': 256,         # Smaller network for faster training
    'update_target_freq': 50,   # Update more frequently
    'train_freq': 4
}

# Paths
MODEL_DIR = 'models_quick'
PLOT_DIR = 'plots_quick'
LOG_DIR = 'logs_quick'
EOF

# Temporarily replace config
mv "$SCRIPT_DIR/config.py" "$SCRIPT_DIR/config_backup.py" 2>/dev/null || true
mv "$SCRIPT_DIR/config_quick.py" "$SCRIPT_DIR/config.py"

# Cleanup function
cleanup_quick() {
    echo -e "${BLUE}Restoring original config...${NC}"
    mv "$SCRIPT_DIR/config.py" "$SCRIPT_DIR/config_quick.py" 2>/dev/null || true
    mv "$SCRIPT_DIR/config_backup.py" "$SCRIPT_DIR/config.py" 2>/dev/null || true
}

trap cleanup_quick EXIT

# Run the main training script
"$SCRIPT_DIR/start_training.sh" "$@"

echo -e "${GREEN}Quick training completed!${NC}"

