#!/bin/bash

# Development training script with enhanced monitoring
# Includes real-time GPU monitoring and log tailing

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== Development Training with GPU Monitoring ===${NC}"

# Function to start GPU monitoring
start_gpu_monitor() {
    if command -v nvidia-smi &> /dev/null; then
        echo -e "${YELLOW}Starting GPU monitoring...${NC}"
        
        # Create GPU monitoring script with fixed nvidia-smi query
        cat > "$LOG_DIR/gpu_monitor.sh" << 'EOF'
#!/bin/bash
LOG_FILE="$1"
echo "timestamp,gpu_util,mem_util,temp,power,mem_used,mem_total" > "$LOG_FILE"
while true; do
    # Use a simpler nvidia-smi query that works
    nvidia-smi --query-gpu=utilization.gpu,utilization.memory,temperature.gpu,power.draw,memory.used,memory.total --format=csv,noheader,nounits | while read line; do
        timestamp=$(date '+%Y-%m-%d %H:%M:%S')
        echo "$timestamp,$line" >> "$LOG_FILE"
    done
    sleep 2
done
EOF
        chmod +x "$LOG_DIR/gpu_monitor.sh"
        
        # Start GPU monitoring in background
        "$LOG_DIR/gpu_monitor.sh" "$LOG_DIR/gpu_stats.csv" &
        echo $! > "$LOG_DIR/gpu_monitor.pid"
        
        # Try to start visual monitoring in background terminal
        if command -v tmux &> /dev/null; then
            # Use tmux if available
            tmux new-session -d -s gpu_monitor "watch -n 1 'nvidia-smi'"
            echo -e "${GREEN}✓ GPU visual monitor started in tmux session 'gpu_monitor'${NC}"
            echo -e "${YELLOW}  Run 'tmux attach -t gpu_monitor' to view${NC}"
        elif command -v screen &> /dev/null; then
            # Use screen if available
            screen -dmS gpu_monitor bash -c "watch -n 1 'nvidia-smi'"
            echo -e "${GREEN}✓ GPU visual monitor started in screen session 'gpu_monitor'${NC}"
            echo -e "${YELLOW}  Run 'screen -r gpu_monitor' to view${NC}"
        else
            echo -e "${YELLOW}⚠ No tmux/screen found for background monitoring${NC}"
            echo -e "${YELLOW}  You can manually run: watch -n 1 nvidia-smi${NC}"
        fi
        
        echo -e "${GREEN}✓ GPU stats logging to: $LOG_DIR/gpu_stats.csv${NC}"
    else
        echo -e "${RED}⚠ nvidia-smi not found, GPU monitoring disabled${NC}"
    fi
}

# Function to stop GPU monitoring
stop_gpu_monitor() {
    echo -e "${YELLOW}Stopping GPU monitoring...${NC}"
    
    # Stop GPU stats logging
    if [ -f "$LOG_DIR/gpu_monitor.pid" ]; then
        local gpu_pid=$(cat "$LOG_DIR/gpu_monitor.pid")
        kill "$gpu_pid" 2>/dev/null || true
        rm -f "$LOG_DIR/gpu_monitor.pid"
    fi
    
    # Stop tmux/screen sessions
    tmux kill-session -t gpu_monitor 2>/dev/null || true
    screen -S gpu_monitor -X quit 2>/dev/null || true
    
    # Clean up monitoring script
    rm -f "$LOG_DIR/gpu_monitor.sh"
    
    echo -e "${GREEN}✓ GPU monitoring stopped${NC}"
}

# Function to show GPU stats summary
show_gpu_summary() {
    if [ -f "$LOG_DIR/gpu_stats.csv" ] && [ -s "$LOG_DIR/gpu_stats.csv" ]; then
        echo -e "\n${BLUE}=== GPU Usage Summary ===${NC}"
        
        # Get the last line for current stats (skip header)
        local last_line=$(tail -1 "$LOG_DIR/gpu_stats.csv")
        if [[ "$last_line" != *"gpu_util"* ]]; then
            echo -e "${YELLOW}Current GPU Status:${NC}"
            echo "$last_line" | awk -F',' '{
                printf "  GPU Utilization: %s%%\n", $2
                printf "  Memory Utilization: %s%%\n", $3
                printf "  Temperature: %s°C\n", $4
                printf "  Power Draw: %s W\n", $5
                printf "  Memory Used: %s MB / %s MB\n", $6, $7
            }'
        fi
        
        # Calculate averages if we have enough data
        local line_count=$(wc -l < "$LOG_DIR/gpu_stats.csv")
        if [ "$line_count" -gt 10 ]; then
            echo -e "\n${YELLOW}Average GPU Stats (last 30 readings):${NC}"
            tail -30 "$LOG_DIR/gpu_stats.csv" | grep -v "gpu_util" | awk -F',' '
            {
                if (NF >= 6 && $2 != "" && $2 != "gpu_util") {
                    gpu_sum += $2; mem_sum += $3; temp_sum += $4; power_sum += $5; count++
                }
            }
            END {
                if (count > 0) {
                    printf "  Avg GPU Utilization: %.1f%%\n", gpu_sum/count
                    printf "  Avg Memory Utilization: %.1f%%\n", mem_sum/count
                    printf "  Avg Temperature: %.1f°C\n", temp_sum/count
                    printf "  Avg Power Draw: %.1f W\n", power_sum/count
                }
            }'
        fi
    fi
}

# Function to start training monitoring
start_training_monitor() {
    echo -e "${YELLOW}Starting training log monitoring...${NC}"
    
    # Wait for log file to be created
    local wait_count=0
    while [ ! -f "$LOG_DIR/training.log" ] && [ $wait_count -lt 30 ]; do
        sleep 1
        wait_count=$((wait_count + 1))
    done
    
    if [ -f "$LOG_DIR/training.log" ]; then
        # Start log tailing in background
        tail -f "$LOG_DIR/training.log" &
        echo $! > "$LOG_DIR/tail.pid"
        echo -e "${GREEN}✓ Training log monitoring started${NC}"
    else
        echo -e "${RED}⚠ Training log not found${NC}"
    fi
}

# Function to stop training monitor
stop_training_monitor() {
    if [ -f "$LOG_DIR/tail.pid" ]; then
        local tail_pid=$(cat "$LOG_DIR/tail.pid")
        kill "$tail_pid" 2>/dev/null || true
        rm -f "$LOG_DIR/tail.pid"
    fi
}

# Enhanced cleanup function
cleanup_dev() {
    echo -e "\n${BLUE}Development cleanup...${NC}"
    stop_gpu_monitor
    stop_training_monitor
    show_gpu_summary
    
    echo -e "${GREEN}✓ Development session completed${NC}"
    echo -e "${YELLOW}GPU stats saved to: $LOG_DIR/gpu_stats.csv${NC}"
    
    # Show final GPU status
    if command -v nvidia-smi &> /dev/null; then
        echo -e "\n${BLUE}=== Final GPU Status ===${NC}"
        nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=table
    fi
}

# Set up signal handlers
trap cleanup_dev EXIT INT TERM

# Create monitoring directory
mkdir -p "$LOG_DIR"

# Check GPU availability and show info
if command -v nvidia-smi &> /dev/null; then
    echo -e "${GREEN}✓ NVIDIA GPU detected${NC}"
    nvidia-smi -L
    echo ""
else
    echo -e "${RED}⚠ No NVIDIA GPU or drivers detected${NC}"
    exit 1
fi

# Start monitoring
start_gpu_monitor

# Show initial GPU status
echo -e "\n${BLUE}=== Initial GPU Status ===${NC}"
nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=table

# Start training with monitoring
echo -e "\n${YELLOW}Starting training with comprehensive monitoring...${NC}"
echo -e "${YELLOW}Press Ctrl+C to stop training and view summary${NC}"
echo "=================================="

# Run training in background
"$SCRIPT_DIR/simple_start.sh" "$@" &
TRAINING_PID=$!

# Start training log monitoring
start_training_monitor

# Periodic status updates
update_count=0
while kill -0 $TRAINING_PID 2>/dev/null; do
    sleep 15  # Show status every 15 seconds
    update_count=$((update_count + 1))
    
    if [ $((update_count % 4)) -eq 0 ]; then  # Every minute
        show_gpu_summary
        echo -e "\n${BLUE}--- Training still running (PID: $TRAINING_PID) ---${NC}"
    fi
done

# Wait for training to complete
wait $TRAINING_PID
TRAINING_EXIT_CODE=$?

if [ $TRAINING_EXIT_CODE -eq 0 ]; then
    echo -e "\n${GREEN}✓ Training completed successfully${NC}"
else
    echo -e "\n${RED}✗ Training exited with code: $TRAINING_EXIT_CODE${NC}"
fi

