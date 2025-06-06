#!/usr/bin/env python3
import sys
import os
from ai.trainer import TrainingManager

def main():
    print("=== Game AI Training System ===")
    print("Initializing training environment...")
    
    # Create training manager
    trainer = TrainingManager()
    
    # Create bots
    trainer.create_bots(num_bots=4)
    
    # Check if we should load existing models
    if len(sys.argv) > 1 and sys.argv[1] == "--continue":
        model_path = "models/final"
        if os.path.exists(model_path):
            print(f"Loading existing models from {model_path}")
            trainer.load_models(model_path)
        else:
            print("No existing models found, starting fresh training")
    
    # Start training
    print("Starting training process...")
    try:
        trainer.train()
    except KeyboardInterrupt:
        print("\nTraining interrupted by user")
        trainer.save_models("models/interrupted")
        print("Models saved before exit")
    except Exception as e:
        print(f"Training error: {e}")
        trainer.save_models("models/error_backup")
        print("Emergency backup saved")

if __name__ == "__main__":
    main()

