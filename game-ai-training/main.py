#!/usr/bin/env python3
import os
import argparse
from ai.trainer import TrainingManager
from json_logger import info, error

def main():
    parser = argparse.ArgumentParser(description="Game AI Training System")
    parser.add_argument(
        "--continue",
        dest="resume",
        action="store_true",
        help="Resume training from saved models",
    )
    parser.add_argument(
        "--num_envs",
        type=int,
        default=1,
        help="Number of parallel environments to run",
    )
    args = parser.parse_args()

    info("Game AI Training System starting")
    info("Initializing training environment")

    # Create training manager
    trainer = TrainingManager(num_envs=args.num_envs)
    
    # Create bots
    trainer.create_bots(num_bots=4)
    
    # Check if we should load existing models
    if args.resume:
        model_path = "models/final"
        if os.path.exists(model_path):
            info(f"Loading existing models from {model_path}")
            trainer.load_models(model_path)
        else:
            info("No existing models found, starting fresh training")
    
    # Start training
    info("Starting training process")
    try:
        trainer.train(num_envs=args.num_envs)
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

