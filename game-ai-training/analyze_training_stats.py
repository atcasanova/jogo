#!/usr/bin/env python3
"""Analyze training_stats.json with stage-aware curriculum metrics.

Usage examples:
  python3 game-ai-training/analyze_training_stats.py models/final/training_stats.json
  python3 game-ai-training/analyze_training_stats.py training_stats.json --window 1000
"""

import argparse
import json
from typing import Dict, List, Tuple

import numpy as np


def _to_float_array(values) -> np.ndarray:
    if values is None:
        return np.array([], dtype=float)
    return np.array(values, dtype=float)


def _safe_mean(arr: np.ndarray):
    return float(np.mean(arr)) if arr.size else None


def _safe_std(arr: np.ndarray):
    return float(np.std(arr)) if arr.size else None


def _safe_slope(arr: np.ndarray):
    """Return linear slope per episode for the provided series."""
    if arr.size < 2:
        return None
    x = np.arange(arr.size, dtype=float)
    slope, _ = np.polyfit(x, arr, 1)
    return float(slope)


def _window_tail(arr: np.ndarray, window: int) -> np.ndarray:
    if not arr.size:
        return arr
    return arr[-min(window, arr.size):]


def _derive_piece_series(data: Dict, episodes: int) -> np.ndarray:
    """Return piece count per episode.

    Prefers the explicit `pieces_per_player` telemetry and falls back to a
    simple curriculum estimate when unavailable.
    """
    pieces = data.get("pieces_per_player")
    if isinstance(pieces, list) and len(pieces) == episodes:
        arr = np.array(pieces, dtype=int)
        arr[arr < 1] = 1
        return arr

    # Fallback for older runs without telemetry.
    inferred = np.ones(episodes, dtype=int)
    if episodes > 5000:
        inferred[5000:] = 2
    if episodes > 10000:
        inferred[10000:] = 3
    return inferred


def _stage_ranges(piece_series: np.ndarray) -> List[Tuple[int, int, int]]:
    """Return contiguous ranges as (start, end, pieces)."""
    if piece_series.size == 0:
        return []
    ranges = []
    start = 0
    current = int(piece_series[0])
    for idx in range(1, piece_series.size):
        val = int(piece_series[idx])
        if val != current:
            ranges.append((start, idx, current))
            start = idx
            current = val
    ranges.append((start, piece_series.size, current))
    return ranges


def _build_summary(data: Dict, window: int) -> Dict:
    rewards = _to_float_array(data.get("episode_rewards"))
    entropy = _to_float_array(data.get("reward_entropies"))
    completed = _to_float_array(data.get("completed_pieces"))
    had_winner = _to_float_array(data.get("had_winner"))
    timed_out = _to_float_array(data.get("timed_out"))
    trainable_win = _to_float_array(data.get("trainable_win"))

    episodes = int(rewards.size)
    pieces = _derive_piece_series(data, episodes)

    completed_total = (
        completed.sum(axis=1)
        if completed.ndim == 2 and completed.shape[0] == episodes
        else np.array([], dtype=float)
    )
    completion_ratio = (
        completed_total / np.maximum(1.0, 4.0 * pieces)
        if completed_total.size
        else np.array([], dtype=float)
    )

    out = {
        "episodes": episodes,
        "window": window,
        "global": {
            "reward_mean": _safe_mean(rewards),
            "reward_std": _safe_std(rewards),
            "reward_last_window_mean": _safe_mean(_window_tail(rewards, window)),
            "reward_last_window_slope_per_ep": _safe_slope(_window_tail(rewards, window)),
            "entropy_mean": _safe_mean(entropy),
            "entropy_last_window_mean": _safe_mean(_window_tail(entropy, window)),
            "completed_total_mean": _safe_mean(completed_total),
            "completed_total_last_window_mean": _safe_mean(_window_tail(completed_total, window)),
            "completion_ratio_mean": _safe_mean(completion_ratio),
            "completion_ratio_last_window_mean": _safe_mean(_window_tail(completion_ratio, window)),
            "completion_ratio_last_window_slope_per_ep": _safe_slope(_window_tail(completion_ratio, window)),
            "had_winner_rate": _safe_mean(had_winner),
            "timeout_rate": _safe_mean(timed_out),
            "trainable_win_rate_all_eps": _safe_mean(trainable_win),
        },
        "stage_metrics": [],
    }

    if had_winner.size and trainable_win.size and had_winner.size == trainable_win.size:
        decisive = had_winner > 0.5
        if decisive.any():
            out["global"]["trainable_win_rate_decisive_only"] = float(np.mean(trainable_win[decisive]))
        else:
            out["global"]["trainable_win_rate_decisive_only"] = None
    else:
        out["global"]["trainable_win_rate_decisive_only"] = None

    for start, end, piece_count in _stage_ranges(pieces):
        rr = rewards[start:end]
        ee = entropy[start:end] if entropy.size == episodes else np.array([], dtype=float)
        cc = completed_total[start:end] if completed_total.size == episodes else np.array([], dtype=float)
        cr = completion_ratio[start:end] if completion_ratio.size == episodes else np.array([], dtype=float)
        hw = had_winner[start:end] if had_winner.size == episodes else np.array([], dtype=float)
        to = timed_out[start:end] if timed_out.size == episodes else np.array([], dtype=float)
        tw = trainable_win[start:end] if trainable_win.size == episodes else np.array([], dtype=float)

        entry = {
            "stage_start": int(start),
            "stage_end": int(end),
            "pieces_per_player": int(piece_count),
            "episodes_in_stage": int(end - start),
            "reward_mean": _safe_mean(rr),
            "reward_last_window_mean": _safe_mean(_window_tail(rr, window)),
            "reward_last_window_slope_per_ep": _safe_slope(_window_tail(rr, window)),
            "entropy_mean": _safe_mean(ee),
            "entropy_last_window_mean": _safe_mean(_window_tail(ee, window)),
            "completed_total_mean": _safe_mean(cc),
            "completed_total_last_window_mean": _safe_mean(_window_tail(cc, window)),
            "completion_ratio_mean": _safe_mean(cr),
            "completion_ratio_last_window_mean": _safe_mean(_window_tail(cr, window)),
            "completion_ratio_last_window_slope_per_ep": _safe_slope(_window_tail(cr, window)),
            "had_winner_rate": _safe_mean(hw),
            "timeout_rate": _safe_mean(to),
            "trainable_win_rate_all_eps": _safe_mean(tw),
        }

        if hw.size and tw.size and hw.size == tw.size:
            decisive = hw > 0.5
            if decisive.any():
                entry["trainable_win_rate_decisive_only"] = float(np.mean(tw[decisive]))
            else:
                entry["trainable_win_rate_decisive_only"] = None
        else:
            entry["trainable_win_rate_decisive_only"] = None

        out["stage_metrics"].append(entry)

    return out


def main():
    parser = argparse.ArgumentParser(description="Analyze jogo training_stats.json")
    parser.add_argument("path", help="Path to training_stats.json")
    parser.add_argument(
        "--window",
        type=int,
        default=1000,
        help="Window size for tail means and slope calculations (default: 1000)",
    )
    args = parser.parse_args()

    with open(args.path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    summary = _build_summary(data, window=max(10, args.window))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
