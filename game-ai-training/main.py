#!/usr/bin/env python3
import sys
import os
from ai.trainer import TrainingManager
from json_logger import info, error

def main():
    info("Game AI Training System starting")
    info("Initializing training environment")
    
    # Create training manager
    trainer = TrainingManager()
    
    # Create bots
    trainer.create_bots(num_bots=4)
    
    # Check if we should load existing models
    if len(sys.argv) > 1 and sys.argv[1] == "--continue":
        model_path = "models/final"
        if os.path.exists(model_path):
            info(f"Loading existing models from {model_path}")
            trainer.load_models(model_path)
        else:
            info("No existing models found, starting fresh training")
    
    # Start training
    info("Starting training process")
    try:
        trainer.train()
    except KeyboardInterrupt:
        info("Training interrupted by user")
        trainer.save_models("models/interrupted")
        info("Models saved before exit")
    except Exception as e:
        error(f"Training error: {e}")
        trainer.save_models("models/error_backup")
        info("Emergency backup saved")

if __name__ == "__main__":
    main()

