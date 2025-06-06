#!/bin/bash

# Game AI Training Launcher
# This script starts the Node.js game and Python bot training

set -e  # Exit on any error

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GAME_DIR="$SCRIPT_DIR/game"
LOG_DIR="$SCRIPT_DIR/logs"
PID_FILE="$LOG_DIR/game_process.pid"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create logs directory
mkdir -p "$LOG_DIR"

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to cleanup processes on exit
cleanup() {
    print_status "Cleaning up processes..."
    
    # Kill Node.js game process if it exists
    if [ -f "$PID_FILE" ]; then
        local game_pid=$(cat "$PID_FILE")
        if ps -p "$game_pid" > /dev/null 2>&1; then
            print_status "Stopping Node.js game process (PID: $game_pid)"
            kill "$game_pid" 2>/dev/null || true
            sleep 2
            # Force kill if still running
            if ps -p "$game_pid" > /dev/null 2>&1; then
                kill -9 "$game_pid" 2>/dev/null || true
            fi
        fi
        rm -f "$PID_FILE"
    fi
    
    # Kill any remaining node processes for our game
    pkill -f "game_wrapper.js" 2>/dev/null || true
    
    print_success "Cleanup completed"
}

# Function to check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed or not in PATH"
        exit 1
    fi
    
    # Check Python
    if ! command -v python3 &> /dev/null; then
        print_error "Python3 is not installed or not in PATH"
        exit 1
    fi
    
    # Check if game files exist
    if [ ! -f "$GAME_DIR/game.js" ]; then
        print_error "Game file not found: $GAME_DIR/game.js"
        exit 1
    fi
    
    if [ ! -f "$GAME_DIR/game_wrapper.js" ]; then
        print_error "Game wrapper not found: $GAME_DIR/game_wrapper.js"
        exit 1
    fi
    
    # Check Python dependencies
    python3 -c "import torch, numpy, matplotlib" 2>/dev/null || {
        print_error "Required Python packages not installed. Run: pip3 install -r requirements.txt"
        exit 1
    }
    
    print_success "All prerequisites met"
}

# Function to start Node.js game process
start_game_process() {
    print_status "Starting Node.js game process..."
    
    cd "$GAME_DIR"
    
    # Start game wrapper in background and capture PID
    node game_wrapper.js > "$LOG_DIR/game.log" 2>&1 &
    local game_pid=$!
    
    # Save PID for cleanup
    echo "$game_pid" > "$PID_FILE"
    
    # Wait a moment and check if process is still running
    sleep 3
    if ! ps -p "$game_pid" > /dev/null 2>&1; then
        print_error "Failed to start Node.js game process"
        print_error "Check log file: $LOG_DIR/game.log"
        if [ -f "$LOG_DIR/game.log" ]; then
            tail -20 "$LOG_DIR/game.log"
        fi
        exit 1
    fi
    
    # Check if the game initialized properly by looking for success indicators in log
    local retries=0
    local max_retries=10
    while [ $retries -lt $max_retries ]; do
        if grep -q "Jogo marcado como ativo" "$LOG_DIR/game.log" 2>/dev/null; then
            print_success "Node.js game process started and initialized (PID: $game_pid)"
            cd "$SCRIPT_DIR"
            return 0
        fi
        sleep 1
        retries=$((retries + 1))
    done
    
    # If we get here, the game didn't initialize properly
    print_error "Game process started but failed to initialize properly"
    print_error "Last 10 lines of game log:"
    tail -10 "$LOG_DIR/game.log" 2>/dev/null || echo "No log file found"
    exit 1
}

# Function to test game communication
test_game_communication() {
    print_status "Testing game communication..."
    
    # Test if we can communicate with the game process
    local test_result=$(timeout 5 python3 -c "
import sys
sys.path.append('$SCRIPT_DIR')
from ai.environment import GameEnvironment
try:
    env = GameEnvironment()
    if env.start_node_game():
        print('COMMUNICATION_SUCCESS')
    else:
        print('COMMUNICATION_FAILED')
except Exception as e:
    print(f'COMMUNICATION_ERROR: {e}')
" 2>/dev/null || echo "TIMEOUT")
    
    if [[ "$test_result" == *"COMMUNICATION_SUCCESS"* ]]; then
        print_success "Game communication test passed"
        return 0
    else
        print_warning "Game communication test failed: $test_result"
        print_warning "Proceeding anyway - the training script will handle communication"
        return 0
    fi
}

# Function to start Python bot training
start_bot_training() {
    print_status "Starting Python bot training..."
    
    # Check for continue flag
    local continue_flag=""
    if [ "$1" = "--continue" ]; then
        continue_flag="--continue"
        print_status "Continuing from existing models..."
    fi
    
    # Start Python training
    python3 main.py $continue_flag 2>&1 | tee "$LOG_DIR/training.log"
}

# Function to monitor processes
monitor_processes() {
    print_status "Monitoring training progress..."
    print_status "Logs are being saved to: $LOG_DIR/"
    print_status "Press Ctrl+C to stop training and cleanup"
    
    # Wait for training to complete or be interrupted
    wait
}

# Main execution
main() {
    print_status "=== Game AI Training Launcher ==="
    
    # Set up signal handlers for cleanup
    trap cleanup EXIT INT TERM
    
    # Check prerequisites
    check_prerequisites
    
    # Start game process
    start_game_process
    
    # Test communication (optional)
    test_game_communication
    
    # Give game process time to stabilize
    sleep 2
    
    # Start bot training
    start_bot_training "$@"
}

# Run main function with all arguments
main "$@"

