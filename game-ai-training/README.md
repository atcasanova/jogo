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

## Training Configuration

`config.py` defines hyperparameters for PPO training. A new `kl_target` value
specifies the desired KL divergence between policy updates. The trainer logs a
warning if the measured KL divergence stays below half of this value for more
than 100 update steps.

### Reward Monitoring

Training logs now include counts for several reward sources after each episode:

- Home stretch entries
- Penalty exits that capture an opponent
- Captures
- Game wins

The entropy of this distribution is plotted to help detect reward starvation.
You can adjust the extra incentive for these events over time using the
`REWARD_SCHEDULE` variable in `config.py`.

## Match Logging

Passing the `--save-match-log` flag to `main.py` writes the move history of
every game played at each save interval to the `logs/` directory. The log files
follow the pattern `episode_<N>_env_<ID>.log` where `<N>` is the episode number
and `<ID>` identifies the environment when multiple environments run in
parallel.

## Multi-GPU Support

When multiple CUDA devices are available, the training manager will now
distribute bots across the GPUs in a round-robin fashion. No additional
configuration is required – simply ensure that your GPUs are visible to PyTorch
and start training as usual.

## Parallel Environments

The training manager can also run multiple game environments in parallel to
speed up experience collection. Pass the `num_envs` argument to the `train`
method or specify it on the command line:

```python
manager = TrainingManager(num_envs=2)
manager.create_bots()
manager.train(num_envs=2)
```

```bash
python3 game-ai-training/main.py --num_envs 2
```

Each environment runs in its own thread with a separate Node.js game process.
Statistics and model updates are aggregated automatically.

## Game Wrapper Behavior

The Python environment communicates with a lightweight Node.js wrapper. This
wrapper resolves certain prompts on its own so that training can proceed
without manual intervention. Specifically, when a piece can enter the
home-stretch or when a Joker move requires choosing a target position, the
wrapper automatically selects the first valid option.

When a seven card can be split across multiple pieces, `getValidActions` may
include special actions with IDs of 60 or higher to represent the available
split moves. If a bot attempts an unsupported action, no valid moves remain and
the episode may finish very quickly as the agent runs out of legal actions.

## Running Tournaments

The script `tournament.py` allows you to pit saved bots against each other
without further training. It scans the `models/` directory for available
episodes and lets you assign one model for seats 0 and 2 and another model for
seats 1 and 3. This simulates two fixed teams, making it easy to, for example,
play bots from episode 2500 against bots from episode 10000.

Run it from the repository root:

```bash
python3 game-ai-training/tournament.py
```

Select the model directory for each team when prompted. The script plays 200
games, prints the winner of each game, and updates win statistics every ten
games.
