#!/usr/bin/env python3
"""Rank saved model checkpoints by win rate and summarize reward-shaped moves.

The trainer writes cumulative ``training_stats.json`` files under directories
such as ``models/episode_1000``. This script scans those checkpoints, computes
both full-run and recent-window win rates, and prints compact reward-event/move
statistics for each checkpoint.
"""

import argparse
import json
import re
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


EPISODE_DIR_RE = re.compile(r"^episode_(\d+)$")


def _safe_float(value) -> Optional[float]:
    """Convert numeric values to float, returning ``None`` for missing data."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _mean(values: Iterable[float]) -> Optional[float]:
    """Return the mean of numeric values, ignoring ``None`` entries."""
    nums = [float(v) for v in values if _safe_float(v) is not None]
    return sum(nums) / len(nums) if nums else None


def _tail(values: List, window: int) -> List:
    """Return the last ``window`` values from a list."""
    if window <= 0:
        return list(values)
    return list(values[-min(window, len(values)):])


def _last_number(values: List) -> Optional[float]:
    """Return the last numeric value from a list."""
    for value in reversed(values or []):
        numeric = _safe_float(value)
        if numeric is not None:
            return numeric
    return None


def _episode_from_dir(path: Path) -> Optional[int]:
    """Extract the numeric checkpoint episode from ``episode_<N>`` directories."""
    match = EPISODE_DIR_RE.match(path.name)
    return int(match.group(1)) if match else None


def _numeric_series(data: Dict, key: str) -> List[float]:
    """Return a list of floats for a stats series."""
    values = data.get(key)
    if not isinstance(values, list):
        return []
    out = []
    for value in values:
        numeric = _safe_float(value)
        if numeric is not None:
            out.append(numeric)
    return out


def _masked_mean(values: List[float], mask: List[float]) -> Optional[float]:
    """Mean of ``values`` where the matching mask entry is truthy."""
    paired = [value for value, keep in zip(values, mask) if keep > 0.5]
    return _mean(paired)


def _team_key(trainable_team: str) -> Optional[str]:
    """Map command-line team names to saved stat keys."""
    if trainable_team == "team1":
        return "team_0_win"
    if trainable_team == "team2":
        return "team_1_win"
    return None


def _fixed_key(trainable_team: str) -> Optional[str]:
    """Map command-line team names to the opposite saved stat key."""
    if trainable_team == "team1":
        return "team_1_win"
    if trainable_team == "team2":
        return "team_0_win"
    return None


def _win_rates(data: Dict, window: int, trainable_team: str) -> Dict[str, Optional[float]]:
    """Compute full-session, decisive, and recent win-rate metrics."""
    trainable_key = _team_key(trainable_team)
    fixed_key = _fixed_key(trainable_team)
    had_winner = _numeric_series(data, "had_winner")

    if trainable_key:
        trainable = _numeric_series(data, trainable_key)
        fixed = _numeric_series(data, fixed_key) if fixed_key else []
        trainable_all = _mean(trainable)
        fixed_all = _mean(fixed)
        trainable_recent = _mean(_tail(trainable, window))
        fixed_recent = _mean(_tail(fixed, window))
        trainable_decisive = _masked_mean(trainable, had_winner)
        fixed_decisive = _masked_mean(fixed, had_winner)
        source = trainable_key
    else:
        trainable = _numeric_series(data, "trainable_win")
        trainable_all = _mean(trainable)
        fixed_all = None
        trainable_decisive = _masked_mean(trainable, had_winner)
        fixed_decisive = None
        source = "trainable_win"

        # Prefer explicit rolling matchup telemetry in auto mode when available.
        trainable_recent = _last_number(data.get("trainable_team_win_rate_window", []))
        fixed_recent = _last_number(data.get("fixed_team_win_rate_window", []))
        if trainable_recent is None:
            trainable_recent = _mean(_tail(trainable, window))

    recent_diff = None
    if trainable_recent is not None and fixed_recent is not None:
        recent_diff = trainable_recent - fixed_recent

    all_diff = None
    if trainable_all is not None and fixed_all is not None:
        all_diff = trainable_all - fixed_all

    return {
        "source": source,
        "trainable_all": trainable_all,
        "fixed_all": fixed_all,
        "all_diff": all_diff,
        "trainable_recent": trainable_recent,
        "fixed_recent": fixed_recent,
        "recent_diff": recent_diff,
        "trainable_decisive": trainable_decisive,
        "fixed_decisive": fixed_decisive,
        "decisive_rate": _mean(had_winner),
        "timeout_rate": _mean(_numeric_series(data, "timed_out")),
    }


def _move_stats(data: Dict, window: int, top_events: int) -> List[Dict[str, Optional[float]]]:
    """Summarize reward-event counts and reward totals over the recent window."""
    count_history = data.get("reward_count_history") or []
    reward_history = data.get("reward_breakdown_history") or []
    count_window = _tail(count_history, window) if isinstance(count_history, list) else []
    reward_window = _tail(reward_history, window) if isinstance(reward_history, list) else []

    # Align totals to count history when both are present. Older checkpoints may
    # only have reward totals, so keep those totals rather than dropping them.
    if count_window and reward_window:
        reward_window = reward_window[-len(count_window):]

    events = set()
    for entry in count_window + reward_window:
        if isinstance(entry, dict):
            events.update(str(key) for key in entry)

    rows = []
    for event in sorted(events):
        counts = [float(entry.get(event, 0.0)) for entry in count_window if isinstance(entry, dict)]
        rewards = [float(entry.get(event, 0.0)) for entry in reward_window if isinstance(entry, dict)]
        count_per_game = _mean(counts)
        reward_per_game = _mean(rewards)
        if (count_per_game is None or count_per_game == 0.0) and (reward_per_game is None or reward_per_game == 0.0):
            continue
        rows.append(
            {
                "event": event,
                "count_per_game": count_per_game,
                "reward_per_game": reward_per_game,
            }
        )

    rows.sort(
        key=lambda row: (
            abs(row["reward_per_game"] or 0.0),
            abs(row["count_per_game"] or 0.0),
            row["event"],
        ),
        reverse=True,
    )
    return rows[:top_events]


def discover_checkpoints(models_dir: Path, include_final: bool = False) -> List[Path]:
    """Find checkpoint ``training_stats.json`` files below ``models_dir``."""
    candidates: List[Tuple[int, Path]] = []
    for stats_path in models_dir.glob("episode_*/training_stats.json"):
        episode = _episode_from_dir(stats_path.parent)
        if episode is not None:
            candidates.append((episode, stats_path))

    if include_final:
        final_path = models_dir / "final" / "training_stats.json"
        if final_path.exists():
            candidates.append((10**18, final_path))

    return [path for _, path in sorted(candidates, key=lambda item: item[0])]


def analyze_checkpoint(
    stats_path: Path,
    window: int,
    trainable_team: str = "auto",
    top_events: int = 5,
) -> Dict:
    """Analyze one checkpoint stats file."""
    with stats_path.open("r", encoding="utf-8") as fh:
        data = json.load(fh)

    episode = _episode_from_dir(stats_path.parent)
    if episode is None:
        episode = len(data.get("episode_rewards", []))

    rates = _win_rates(data, window=window, trainable_team=trainable_team)
    moves = _move_stats(data, window=window, top_events=top_events)
    return {
        "checkpoint": stats_path.parent.name,
        "path": str(stats_path),
        "episode": episode,
        "episodes_recorded": len(data.get("episode_rewards", [])),
        "rates": rates,
        "moves": moves,
    }


def rank_checkpoints(
    models_dir: Path,
    window: int = 1000,
    trainable_team: str = "auto",
    rank_by: str = "recent",
    top_events: int = 5,
    include_final: bool = False,
) -> List[Dict]:
    """Return checkpoints sorted from best to worst by the chosen win-rate metric."""
    analyses = [
        analyze_checkpoint(path, window=window, trainable_team=trainable_team, top_events=top_events)
        for path in discover_checkpoints(models_dir, include_final=include_final)
    ]

    metric_by_rank = {
        "recent": "trainable_recent",
        "all": "trainable_all",
        "decisive": "trainable_decisive",
    }
    metric = metric_by_rank[rank_by]
    analyses.sort(
        key=lambda item: (
            item["rates"].get(metric) is not None,
            item["rates"].get(metric) or -1.0,
            item["episode"],
        ),
        reverse=True,
    )
    return analyses


def _fmt_pct(value: Optional[float]) -> str:
    """Format a rate as a percentage."""
    return "n/a" if value is None else f"{100.0 * value:5.1f}%"


def _fmt_signed_pct(value: Optional[float]) -> str:
    """Format a rate difference as signed percentage points."""
    return "n/a" if value is None else f"{100.0 * value:+5.1f}pp"


def _fmt_move(row: Dict[str, Optional[float]]) -> str:
    """Format one compact move/reward event summary."""
    count = row.get("count_per_game")
    reward = row.get("reward_per_game")
    count_text = "n/a" if count is None else f"{count:.2f}/g"
    reward_text = "n/a" if reward is None else f"{reward:+.2f}r/g"
    return f"{row['event']} {count_text} {reward_text}"


def format_report(analyses: List[Dict], window: int, rank_by: str) -> str:
    """Format checkpoint analyses as a human-readable report."""
    if not analyses:
        return "No checkpoint training_stats.json files found."

    lines = [
        f"Ranked checkpoints by {rank_by} trainable win rate (recent window={window} games):",
        "",
        "rank checkpoint        eps     recent  all     decisive fixed_recent diff    moves",
        "---- ---------------- ------  ------- ------- -------- ------------ ------- ----------------",
    ]
    for idx, item in enumerate(analyses, start=1):
        rates = item["rates"]
        moves = "; ".join(_fmt_move(row) for row in item["moves"]) or "n/a"
        lines.append(
            f"{idx:>4} {item['checkpoint']:<16} {item['episodes_recorded']:>6}  "
            f"{_fmt_pct(rates.get('trainable_recent')):>7} "
            f"{_fmt_pct(rates.get('trainable_all')):>7} "
            f"{_fmt_pct(rates.get('trainable_decisive')):>8} "
            f"{_fmt_pct(rates.get('fixed_recent')):>12} "
            f"{_fmt_signed_pct(rates.get('recent_diff')):>7} "
            f"{moves}"
        )
    return "\n".join(lines)


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Rank saved training checkpoints by win rate.")
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=Path("models"),
        help="Directory containing episode_<N>/training_stats.json checkpoints (default: models).",
    )
    parser.add_argument(
        "--window",
        type=int,
        default=1000,
        help="Recent-game window used for ranking and move summaries (default: 1000).",
    )
    parser.add_argument(
        "--trainable-team",
        choices=["auto", "team1", "team2"],
        default="auto",
        help="Trainable locked team; team1=seats 0/2, team2=seats 1/3 (default: auto).",
    )
    parser.add_argument(
        "--rank-by",
        choices=["recent", "all", "decisive"],
        default="recent",
        help="Win-rate metric to rank by (default: recent).",
    )
    parser.add_argument(
        "--top-events",
        type=int,
        default=5,
        help="Number of compact reward/move event summaries to print per checkpoint (default: 5).",
    )
    parser.add_argument(
        "--include-final",
        action="store_true",
        help="Also include models/final/training_stats.json if present.",
    )
    args = parser.parse_args()

    analyses = rank_checkpoints(
        args.models_dir,
        window=max(1, args.window),
        trainable_team=args.trainable_team,
        rank_by=args.rank_by,
        top_events=max(0, args.top_events),
        include_final=args.include_final,
    )
    print(format_report(analyses, window=max(1, args.window), rank_by=args.rank_by))


if __name__ == "__main__":
    main()
