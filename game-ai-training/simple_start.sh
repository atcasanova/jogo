#!/bin/bash

# Simplified training launcher
# Let the Python environment handle Node.js process management

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Simple Game AI Training Launcher ===${NC}"

# Create logs directory
mkdir -p "$LOG_DIR"

# Ensure we run from the script directory so relative paths resolve
cd "$SCRIPT_DIR"

# Function to cleanup any leftover processes
cleanup() {
    echo -e "${BLUE}Cleaning up...${NC}"
    pkill -f "game_wrapper.js" 2>/dev/null || true
    pkill -f "main.py" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

# Check basic prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo "Error: Node.js not found"
    exit 1
fi

if ! command -v python3 &> /dev/null; then
    echo "Error: Python3 not found"
    exit 1
fi

if [ ! -f "game/game.js" ] || [ ! -f "game/game_wrapper.js" ]; then
    echo "Error: Game files not found"
    exit 1
fi

echo -e "${GREEN}Prerequisites OK${NC}"

# Start training (let Python handle Node.js)
echo -e "${BLUE}Starting training...${NC}"

python3 main.py "$@" 2>&1 | tee "$LOG_DIR/training.log"

echo -e "${GREEN}Training completed!${NC}"

