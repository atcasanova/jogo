# Game AI Training System

This directory contains the Python training scripts and utilities used to train bots for the board game.

## JSON Logging

Set the environment variable `JSON_LOGGING=1` before running the training scripts to output logs in machine readable JSON format. When enabled, each log message is emitted as a single JSON object on a separate line. Without this variable the logs remain human friendly text.

## Running Tests

Install the required Python packages and run the PyTest suite:

```bash
pip install -r game-ai-training/requirements.txt
pytest
```

This installs all dependencies listed in `requirements.txt` and executes the tests located in `game-ai-training/tests`.

## Continuing Training

If you have previously saved models you can resume training by passing the
`--continue` flag to the launcher script or to `main.py` directly:

```bash
python3 game-ai-training/main.py --continue
```

The trainer will load the models from `models/final` if they exist.

## Multi-GPU Support

When multiple CUDA devices are available, the training manager will now
distribute bots across the GPUs in a round-robin fashion. No additional
configuration is required – simply ensure that your GPUs are visible to PyTorch
and start training as usual.
