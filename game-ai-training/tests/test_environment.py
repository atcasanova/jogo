import numpy as np
from unittest.mock import patch
from ai.environment import GameEnvironment, PIECE_COMPLETION_REWARD, SKIP_HOME_PENALTY


def test_reset_returns_zero_when_start_fails():
    env = GameEnvironment()
    with patch.object(env, 'start_node_game', return_value=False):
        state = env.reset()
    assert isinstance(state, np.ndarray)
    assert state.shape[0] == env.state_size
    assert np.all(state == 0)


def test_piece_completion_reward():
    env = GameEnvironment()
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

    assert reward == PIECE_COMPLETION_REWARD
    assert env.reward_event_counts['home_completion'] == 1


def test_skip_home_penalty():
    env = GameEnvironment()
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
                'position': {'row': 0, 'col': 6},
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
    assert reward == SKIP_HOME_PENALTY
    assert env.reward_event_counts['skip_home'] == 1
