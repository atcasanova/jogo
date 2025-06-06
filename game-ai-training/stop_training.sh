#!/bin/bash

# Script to safely stop training and cleanup processes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"
PID_FILE="$LOG_DIR/game_process.pid"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}Stopping Game AI Training...${NC}"

# Stop Node.js game process
if [ -f "$PID_FILE" ]; then
    game_pid=$(cat "$PID_FILE")
    if kill -0 "$game_pid" 2>/dev/null; then
        echo "Stopping Node.js game process (PID: $game_pid)"
        kill "$game_pid" 2>/dev/null || true
        sleep 2
        if kill -0 "$game_pid" 2>/dev/null; then
            kill -9 "$game_pid" 2>/dev/null || true
        fi
    fi
    rm -f "$PID_FILE"
fi

# Stop any remaining processes
pkill -f "game_wrapper.js" 2>/dev/null || true
pkill -f "main.py" 2>/dev/null || true

# Stop GPU monitoring if running
if [ -f "$LOG_DIR/gpu_monitor.pid" ]; then
    gpu_pid=$(cat "$LOG_DIR/gpu_monitor.pid")
    kill "$gpu_pid" 2>/dev/null || true
    rm -f "$LOG_DIR/gpu_monitor.pid"
fi

echo -e "${GREEN}All training processes stopped${NC}"

