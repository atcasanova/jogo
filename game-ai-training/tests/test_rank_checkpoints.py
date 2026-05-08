import importlib.util
import json
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "rank_checkpoints.py"
SPEC = importlib.util.spec_from_file_location("rank_checkpoints", MODULE_PATH)
rank_checkpoints = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rank_checkpoints)


def _write_stats(path, trainable_window, team_0, team_1, capture_rewards):
    path.mkdir(parents=True)
    episodes = len(team_0)
    stats = {
        "episode_rewards": [0.0] * episodes,
        "had_winner": [1] * episodes,
        "timed_out": [0] * episodes,
        "trainable_win": team_0,
        "team_0_win": team_0,
        "team_1_win": team_1,
        "trainable_team_win_rate_window": [trainable_window],
        "fixed_team_win_rate_window": [1.0 - trainable_window],
        "team_win_rate_diff_window": [trainable_window - (1.0 - trainable_window)],
        "reward_count_history": [
            {"capture": 2, "seven_card_penalty": 1},
            {"capture": 4, "seven_card_penalty": 0},
        ],
        "reward_breakdown_history": [
            {"capture": capture_rewards[0], "seven_card_penalty": -1.0},
            {"capture": capture_rewards[1], "seven_card_penalty": 0.0},
        ],
    }
    (path / "training_stats.json").write_text(json.dumps(stats), encoding="utf-8")


def test_rank_checkpoints_sorts_by_recent_win_rate(tmp_path):
    models_dir = tmp_path / "models"
    _write_stats(models_dir / "episode_100", 0.4, [1, 0, 0, 1], [0, 1, 1, 0], [2.0, 3.0])
    _write_stats(models_dir / "episode_200", 0.8, [1, 1, 1, 0], [0, 0, 0, 1], [5.0, 7.0])

    ranked = rank_checkpoints.rank_checkpoints(models_dir, window=2, top_events=2)

    assert [item["checkpoint"] for item in ranked] == ["episode_200", "episode_100"]
    assert ranked[0]["rates"]["trainable_recent"] == 0.8
    assert ranked[0]["moves"][0]["event"] == "capture"
    assert ranked[0]["moves"][0]["count_per_game"] == 3.0
    assert ranked[0]["moves"][0]["reward_per_game"] == 6.0


def test_rank_checkpoints_can_use_explicit_trainable_team(tmp_path):
    models_dir = tmp_path / "models"
    _write_stats(models_dir / "episode_100", 0.2, [0, 0, 1, 0], [1, 1, 0, 1], [1.0, 1.0])
    _write_stats(models_dir / "episode_200", 0.9, [0, 1, 0, 1], [1, 0, 1, 0], [1.0, 1.0])

    ranked = rank_checkpoints.rank_checkpoints(
        models_dir,
        window=4,
        trainable_team="team2",
        rank_by="all",
        top_events=1,
    )

    assert ranked[0]["checkpoint"] == "episode_100"
    assert ranked[0]["rates"]["source"] == "team_1_win"
    assert ranked[0]["rates"]["trainable_all"] == 0.75


def test_format_report_handles_missing_checkpoints():
    assert rank_checkpoints.format_report([], window=1000, rank_by="recent") == (
        "No checkpoint training_stats.json files found."
    )
