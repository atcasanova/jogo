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
