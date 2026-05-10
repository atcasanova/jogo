# Game AI Training System

This directory contains the Python training scripts and utilities used to train bots for the board game.

## JSON Logging

Set the environment variable `JSON_LOGGING=1` before running the training
scripts to output logs in machine readable JSON format. When enabled, each log
message is emitted as a single JSON object on a separate line. Without this
variable the logs remain human friendly text.

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
When `training_stats.json` exists in the same directory, the trainer also
restores curriculum telemetry (including piece count and stage progress) so a
continued run does not reset back to one piece.

## Training with Fixed Opponents

Pass the `--fixed-model-dir` option to `main.py` to load old models as
unchanging opponents. When set, two trainable bots rotate as partners while the
remaining seats use the models from the provided directory.

To train only one fixed team while keeping seats stable, use
`--trainable-team team1` (seats 0/2 trainable) or `--trainable-team team2`
(seats 1/3 trainable). In this mode seat shuffling is disabled so you can track
whether one side improves against the other across checkpoints. The trainer now
logs a rolling trainable-vs-fixed team win-rate differential and persists the
per-episode team winner fields in `training_stats.json`.

## Training Configuration

`config.py` defines hyperparameters for PPO training. A new `kl_target` value
specifies the desired KL divergence between policy updates. The trainer logs a
warning if the measured KL divergence stays below half of this value for more
than 100 update steps.

### Reward Monitoring

Training logs record how many times each of the following events occurs:

- Completing a piece (+50 points).
- Entering the homestretch (+250 points), with matching severe penalties for
  explicitly skipping or choosing another move when a homestretch-entry action is
  available (−250 points).

The Node wrapper also tags legal actions that would enter the homestretch so the
Python trainer can punish missed entries even when the bot chooses a different
move. Additional tactical shaping rewards guide card-specific play without relying on
periodic plot image checks. The trainer still records per-event reward totals in
`training_stats.json`, but it no longer saves training-progress plot images at
statistics intervals or at the end of training.

Seven-card bonuses now require concrete impact: capturing, entering the home
stretch, or completing a piece. Low-impact seven plays receive a small smart-card
misuse penalty instead of generic movement shaping. Eight-card plays receive
extra reward when they capture or newly place a piece within reach of the home
stretch; otherwise they receive the same small penalty. A one-turn setup bonus
multiplies the next home-entry reward when the previous play by that player was
an 8 that moved the piece from outside entry reach to within entry reach.

Every 100 episodes the trainer now logs the cumulative reward totals for each
event type. These summaries are useful when sharing progress logs for further
analysis. The trainer also persists per-episode reward event counts and a
`reward_event_best_stats` table with latest, best, and worst per-episode and
rolling-window count/reward values for each shaping signal, making it easier to
see whether incentivized events are increasing and discouraged actions are
decreasing.

The saved `training_stats.json` file now also includes per-episode curriculum
telemetry fields that are useful for stage-aware analysis and speed-focused
experiments:

- `pieces_per_player`
- `stage_games`
- `had_winner`
- `timed_out`
- `trainable_win`
- `winning_team_index`
- `team_0_win` / `team_1_win`
- `trainable_team_win_rate_window` / `fixed_team_win_rate_window`
- `team_win_rate_diff_window`
- `terminal_turns`
- `near_finish_any_team` / `near_finish_timeout`
- `reward_count_history`
- `reward_event_best_stats`

### Dynamic Reward Adjustment

The trainer watches the win rate for the current number of pieces. If it drops
below 0.75 the heavy reward and win bonus are increased by a small multiplier.
Once the win rate rises above roughly 0.9 the multiplier decays back toward the
scheduled values. This automatic tuning helps the curriculum progress without
needing to manually edit the reward configuration.

Timeout handling is also stage-aware: unresolved games now apply a negative
timeout penalty that is scaled by the current piece count and by a dynamic
speed multiplier. The turn limit uses a per-stage schedule from `config.py` to
reduce premature truncation at higher piece counts.

To encourage faster resolution after the 7-card and 8-card tactical curriculum
has plateaued, the speed preset now starts long-game pressure earlier, applies
a stronger urgency penalty late in the turn budget, and grants a larger
fast-finish bonus when a winning team completes the game well before the
current turn limit. The trainer raises or lowers a separate speed multiplier
when recent timeout rate or median terminal turn count shows that bots are
not closing games quickly enough. Teammates on the winning team also receive
terminal credit, so setup moves that enable the final action are reinforced.

Near-finish rewards are counted exactly once per crossing and are now paired
with a configurable conversion bonus when the team turns a near-finish state
into a win within the conversion window. This makes the closing objective
explicit without increasing 7-card or 8-card tactical weights again.

### Advantage Normalization

During PPO updates the advantages are now normalised per batch. After adding any
extra advantages, the mean is subtracted and the result is divided by its
standard deviation. This keeps gradients well scaled when reward magnitudes
shift during training.

## Match Logging

Passing the `--save-match-log` flag to `main.py` writes the move history of
every game played at each save interval to the `logs/` directory. The log files
follow the pattern `episode_<N>_env_<ID>.log` where `<N>` is the episode number
and `<ID>` identifies the environment when multiple environments run in
parallel.

## Training Stats Analysis Helper

Use `analyze_training_stats.py` to build a stage-aware summary from a saved
`training_stats.json` file:

```bash
python3 game-ai-training/analyze_training_stats.py models/final/training_stats.json
```

You can change the tail window used for trend metrics:

```bash
python3 game-ai-training/analyze_training_stats.py training_stats.json --window 1000
```

For compact per-piece aggregation across noisy stage segments, run:

```bash
python3 game-ai-training/summarize_stage_metrics.py run1_summary.json run2_summary.json
```

This script reports weighted metrics by `pieces_per_player` and highlights the
longest `pieces_per_player=5` segments where instability is often most visible.

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

Select the model directory for each team when prompted. The script now plays
100 games, prints the winner of each game, and updates win statistics every ten
games. When a game ends with a winner, the full move history is saved in the
`logs/` directory using the same JSON format as the training match logs.
