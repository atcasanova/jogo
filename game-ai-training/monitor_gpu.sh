#!/bin/bash

# Simple GPU monitor script
echo "Starting GPU monitoring... Press Ctrl+C to stop"
echo ""

while true; do
    clear
    echo "=== GPU Status - $(date) ==="
    echo ""
    nvidia-smi
    echo ""
    echo "=== GPU Utilization History (last 10 readings) ==="
    nvidia-smi --query-gpu=timestamp,name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv | tail -10
    sleep 2
done

