#!/usr/bin/env python3
"""Summarize stage metrics from analyze_training_stats.py JSON output.

This helper reads one or more summary JSON files and prints compact,
weighted metrics grouped by pieces_per_player. It is useful for comparing
curriculum stability without scanning thousands of stage rows.
"""

import argparse
import json
from collections import defaultdict
from typing import Dict, Iterable, List, Optional


def _safe_div(num: float, den: float) -> Optional[float]:
    if den == 0:
        return None
    return num / den


def _weighted_mean(pairs: Iterable[tuple]) -> Optional[float]:
    total_w = 0.0
    total_v = 0.0
    for value, weight in pairs:
        if value is None:
            continue
        total_w += float(weight)
        total_v += float(value) * float(weight)
    return _safe_div(total_v, total_w)


def _format_metric(value: Optional[float]) -> str:
    return "n/a" if value is None else f"{value:.4f}"


def summarize_file(path: str, top_n: int) -> Dict:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)

    stages: List[Dict] = data.get("stage_metrics", [])
    groups = defaultdict(list)
    for row in stages:
        groups[row.get("pieces_per_player")].append(row)

    out_rows = []
    for pieces, rows in sorted(groups.items()):
        weights = [int(r.get("episodes_in_stage", 0) or 0) for r in rows]
        total_eps = sum(weights)
        out_rows.append(
            {
                "pieces_per_player": pieces,
                "segments": len(rows),
                "episodes": total_eps,
                "had_winner_rate_w": _weighted_mean(
                    (r.get("had_winner_rate"), w) for r, w in zip(rows, weights)
                ),
                "timeout_rate_w": _weighted_mean(
                    (r.get("timeout_rate"), w) for r, w in zip(rows, weights)
                ),
                "completion_ratio_w": _weighted_mean(
                    (r.get("completion_ratio_last_window_mean"), w)
                    for r, w in zip(rows, weights)
                ),
                "reward_mean_w": _weighted_mean(
                    (r.get("reward_last_window_mean"), w) for r, w in zip(rows, weights)
                ),
                "reward_slope_w": _weighted_mean(
                    (r.get("reward_last_window_slope_per_ep"), w)
                    for r, w in zip(rows, weights)
                ),
                "trainable_win_decisive_w": _weighted_mean(
                    (r.get("trainable_win_rate_decisive_only"), w)
                    for r, w in zip(rows, weights)
                ),
            }
        )

    longest_5 = sorted(
        [r for r in stages if r.get("pieces_per_player") == 5],
        key=lambda r: int(r.get("episodes_in_stage", 0) or 0),
        reverse=True,
    )[:top_n]

    return {
        "path": path,
        "episodes": data.get("episodes"),
        "window": data.get("window"),
        "global": data.get("global", {}),
        "by_pieces": out_rows,
        "top_piece5_segments": longest_5,
    }


def print_summary(summary: Dict) -> None:
    print(f"\n=== {summary['path']} ===")
    print(f"episodes={summary.get('episodes')} window={summary.get('window')}")

    g = summary.get("global", {})
    print("global:")
    for key in [
        "reward_last_window_mean",
        "reward_last_window_slope_per_ep",
        "completion_ratio_last_window_mean",
        "had_winner_rate",
        "timeout_rate",
        "trainable_win_rate_decisive_only",
    ]:
        print(f"  {key}: {_format_metric(g.get(key))}")

    print("by pieces (weighted by episodes_in_stage):")
    for row in summary.get("by_pieces", []):
        print(
            "  pieces={pieces} segments={segments} episodes={episodes} "
            "winner={winner} timeout={timeout} completion={completion} "
            "reward={reward} slope={slope} trainable_decisive={tw}".format(
                pieces=row["pieces_per_player"],
                segments=row["segments"],
                episodes=row["episodes"],
                winner=_format_metric(row["had_winner_rate_w"]),
                timeout=_format_metric(row["timeout_rate_w"]),
                completion=_format_metric(row["completion_ratio_w"]),
                reward=_format_metric(row["reward_mean_w"]),
                slope=_format_metric(row["reward_slope_w"]),
                tw=_format_metric(row["trainable_win_decisive_w"]),
            )
        )

    print("top piece=5 segments by length:")
    for idx, seg in enumerate(summary.get("top_piece5_segments", []), start=1):
        print(
            "  {idx}. eps={eps} winner={winner} timeout={timeout} "
            "completion={completion} reward={reward} slope={slope}".format(
                idx=idx,
                eps=seg.get("episodes_in_stage"),
                winner=_format_metric(seg.get("had_winner_rate")),
                timeout=_format_metric(seg.get("timeout_rate")),
                completion=_format_metric(seg.get("completion_ratio_last_window_mean")),
                reward=_format_metric(seg.get("reward_last_window_mean")),
                slope=_format_metric(seg.get("reward_last_window_slope_per_ep")),
            )
        )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Summarize analyze_training_stats.py output for easier comparison"
    )
    parser.add_argument("paths", nargs="+", help="One or more summary JSON files")
    parser.add_argument(
        "--top-piece5",
        type=int,
        default=5,
        help="Number of longest piece=5 segments to print (default: 5)",
    )
    args = parser.parse_args()

    for path in args.paths:
        print_summary(summarize_file(path, top_n=max(1, args.top_piece5)))


if __name__ == "__main__":
    main()
