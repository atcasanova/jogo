# Contributor Guidance for Game AI Training

This document provides conventions and best practices for working inside the
`game-ai-training` directory. All Python and Node.js code related to training
bots lives here. Follow these rules when modifying files in this folder or any
subdirectory.

## General Guidelines

- Use **Python 3.8+** for all scripts and modules.
- Keep lines under **120 characters** when possible.
- Use 4 spaces per indentation level and avoid tabs.
- Include descriptive docstrings for public classes and functions.
- Prefer `snake_case` for Python variables and functions.
- When editing JavaScript files, follow the existing code style (two-space
  indentation and semicolons).

## Testing

Before committing changes that affect the training logic, run the automated test
suite. Tests live under `game-ai-training/tests` and use **pytest**.

```bash
pip install -r game-ai-training/requirements.txt
pytest
```

If you modify Node.js code inside `game-ai-training/game`, also run the Jest
tests from the repository root:

```bash
npm test
```

## Environment

The training scripts communicate with a Node.js game wrapper. When running
training locally, ensure that Node 18+ and Python 3 are installed. The helper
scripts `start_training.sh` and `simple_start.sh` can be used to launch the
training pipeline.

## Commit Messages

Write clear commit messages that describe **why** a change was made. Reference
issues or pull requests when applicable.

## Pull Requests

- Ensure tests pass before submitting a PR.
- Provide a concise summary of your changes in the PR description.
- If the change alters configuration or scripts, update the relevant README
  sections.

