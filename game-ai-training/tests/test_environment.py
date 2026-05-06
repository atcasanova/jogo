import numpy as np
from unittest.mock import patch
import pytest
from ai.environment import (
    GameEnvironment,
    PIECE_COMPLETION_REWARD,
    SEVEN_SPLIT_COMPLETION_REWARD,
    SEVEN_SPLIT_HOME_ENTRY_REWARD,
    SEVEN_SPLIT_REWARD,
    SKIP_HOME_PENALTY,
)
from config import STEP_PENALTY_BASE, PIECE_COMPLETION_BONUS


def test_reset_returns_zero_when_start_fails():
    env = GameEnvironment()
    with patch.object(env, 'start_node_game', return_value=False):
        state = env.reset()
    assert isinstance(state, np.ndarray)
    assert state.shape[0] == env.state_size
    assert np.all(state == 0)


def test_piece_completion_reward():
    env = GameEnvironment()
    step_cost = STEP_PENALTY_BASE * max(1.0, env.pieces_per_player / 2.0)
    env.game_state = {
        'pieces': [
            {'id': 'p0_1', 'playerId': 0, 'completed': False, 'position': {'row': 0, 'col': 0}},
        ],
        'teams': [[{'position': 0}, {'position': 2}], [{'position': 1}, {'position': 3}]]
    }
    env.player_team_map = {0: 0, 2: 0, 1: 1, 3: 1}

    response = {
        'success': True,
        'gameState': {
            'pieces': [
                {'id': 'p0_1', 'playerId': 0, 'completed': True, 'position': {'row': 0, 'col': 0}},
            ],
            'teams': env.game_state['teams']
        },
        'gameEnded': False,
        'winningTeam': None
    }

    with patch.object(env, 'send_command', return_value=response):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                _, reward, _ = env.step(0, 0)

    assert reward == pytest.approx(PIECE_COMPLETION_REWARD + PIECE_COMPLETION_BONUS + step_cost)
    assert env.reward_event_counts['home_completion'] == 1
    assert env.reward_event_counts['piece_completion_bonus'] == 1


def test_skip_home_penalty():
    env = GameEnvironment()
    step_cost = STEP_PENALTY_BASE * max(1.0, env.pieces_per_player / 2.0)
    env.game_state = {
        'currentPlayerIndex': 0,
        'teams': [[{'position': 0}, {'position': 2}], [{'position': 1}, {'position': 3}]],
        'pieces': [
            {
                'id': 'p0_1',
                'playerId': 0,
                'position': {'row': 0, 'col': 0},
                'inHomeStretch': False,
                'inPenaltyZone': False,
                'completed': False,
            }
        ],
    }
    env.player_team_map = {0: 0, 2: 0, 1: 1, 3: 1}

    new_state = {
        'pieces': [
            {
                'id': 'p0_1',
                'playerId': 0,
                'position': {'row': 99, 'col': 98},
                'inHomeStretch': False,
                'inPenaltyZone': False,
                'completed': False,
            }
        ],
        'teams': env.game_state['teams'],
    }

    calls = []

    def _send(cmd):
        calls.append(cmd)
        if len(calls) == 1:
            return {'success': False, 'action': 'homeEntryChoice'}
        return {'success': True, 'gameState': new_state, 'gameEnded': False, 'winningTeam': None}

    with patch.object(env, 'send_command', side_effect=_send):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                _, reward, _ = env.step(0, 0, enter_home=False)

    assert len(calls) == 2
    assert reward == pytest.approx(SKIP_HOME_PENALTY + step_cost)
    assert env.reward_event_counts['skip_home'] == 1


def test_seven_split_home_entry_reward():
    env = GameEnvironment()
    step_cost = STEP_PENALTY_BASE * max(1.0, env.pieces_per_player / 2.0)
    env.game_state = {
        'pieces': [
            {
                'id': 'p0_1',
                'playerId': 0,
                'completed': False,
                'inHomeStretch': False,
                'inPenaltyZone': False,
                'position': {'row': 99, 'col': 99},
            },
            {
                'id': 'p0_2',
                'playerId': 0,
                'completed': False,
                'inHomeStretch': False,
                'inPenaltyZone': False,
                'position': {'row': 99, 'col': 98},
            },
        ],
        'teams': [[{'position': 0}, {'position': 2}], [{'position': 1}, {'position': 3}]]
    }
    env.player_team_map = {0: 0, 2: 0, 1: 1, 3: 1}

    response = {
        'success': True,
        'specialMove': {
            'cardValue': '7',
            'split': True,
            'moves': [{'pieceId': 'p0_1', 'steps': 2}, {'pieceId': 'p0_2', 'steps': 5}],
        },
        'gameState': {
            'pieces': [
                {
                    'id': 'p0_1',
                    'playerId': 0,
                    'completed': False,
                    'inHomeStretch': True,
                    'inPenaltyZone': False,
                    'position': {'row': 1, 'col': 4},
                },
                {
                    'id': 'p0_2',
                    'playerId': 0,
                    'completed': False,
                    'inHomeStretch': False,
                    'inPenaltyZone': False,
                    'position': {'row': 99, 'col': 97},
                },
            ],
            'teams': env.game_state['teams']
        },
        'gameEnded': False,
        'winningTeam': None
    }

    with patch.object(env, 'send_command', return_value=response):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                _, reward, _ = env.step(60, 0)

    expected = step_cost + SEVEN_SPLIT_REWARD + SEVEN_SPLIT_HOME_ENTRY_REWARD
    assert reward == pytest.approx(expected)
    assert env.reward_event_counts['seven_split'] == 1
    assert env.reward_event_counts['seven_split_home_entry'] == 1


def test_seven_split_completion_reward_stacks_with_completion_reward():
    env = GameEnvironment()
    step_cost = STEP_PENALTY_BASE * max(1.0, env.pieces_per_player / 2.0)
    env.game_state = {
        'pieces': [
            {
                'id': 'p0_1',
                'playerId': 0,
                'completed': False,
                'inHomeStretch': True,
                'inPenaltyZone': False,
                'position': {'row': 4, 'col': 4},
            },
            {
                'id': 'p0_2',
                'playerId': 0,
                'completed': False,
                'inHomeStretch': False,
                'inPenaltyZone': False,
                'position': {'row': 99, 'col': 98},
            },
        ],
        'teams': [[{'position': 0}, {'position': 2}], [{'position': 1}, {'position': 3}]]
    }
    env.player_team_map = {0: 0, 2: 0, 1: 1, 3: 1}

    response = {
        'success': True,
        'specialMove': {
            'cardValue': '7',
            'split': True,
            'moves': [{'pieceId': 'p0_1', 'steps': 1}, {'pieceId': 'p0_2', 'steps': 6}],
        },
        'gameState': {
            'pieces': [
                {
                    'id': 'p0_1',
                    'playerId': 0,
                    'completed': True,
                    'inHomeStretch': True,
                    'inPenaltyZone': False,
                    'position': {'row': 5, 'col': 4},
                },
                {
                    'id': 'p0_2',
                    'playerId': 0,
                    'completed': False,
                    'inHomeStretch': False,
                    'inPenaltyZone': False,
                    'position': {'row': 99, 'col': 97},
                },
            ],
            'teams': env.game_state['teams']
        },
        'gameEnded': False,
        'winningTeam': None
    }

    with patch.object(env, 'send_command', return_value=response):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                _, reward, _ = env.step(60, 0)

    expected = (
        step_cost
        + SEVEN_SPLIT_REWARD
        + SEVEN_SPLIT_COMPLETION_REWARD
        + PIECE_COMPLETION_REWARD
        + PIECE_COMPLETION_BONUS
    )
    assert reward == pytest.approx(expected)
    assert env.reward_event_counts['seven_split'] == 1
    assert env.reward_event_counts['seven_split_completion'] == 1
