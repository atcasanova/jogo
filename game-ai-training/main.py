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
    parser.add_argument(
        "--fixed-model-dir",
        type=str,
        default=None,
        help="Directory containing old opponent models",
    )
    parser.add_argument(
        "--save-match-log",
        dest="save_match_log",
        action="store_true",
        help="Save move history every save_frequency episodes",
    )
    args = parser.parse_args()

    info("Game AI Training System starting")
    info("Initializing training environment")

    # Create training manager
    trainer = TrainingManager(
        num_envs=args.num_envs,
        num_trainable_bots=2 if args.fixed_model_dir else 4,
        fixed_model_dir=args.fixed_model_dir,
    )

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
        trainer.train(num_envs=args.num_envs, save_match_log=args.save_match_log)
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

