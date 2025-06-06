import numpy as np
from unittest.mock import patch
from ai.environment import GameEnvironment


def test_reset_returns_zero_when_start_fails():
    env = GameEnvironment()
    with patch.object(env, 'start_node_game', return_value=False):
        state = env.reset()
    assert isinstance(state, np.ndarray)
    assert state.shape[0] == env.state_size
    assert np.all(state == 0)


def test_get_valid_actions_limits_to_ten():
    env = GameEnvironment()
    with patch.object(env, 'send_command', return_value={'validActions': list(range(15))}):
        actions = env.get_valid_actions(0)
    assert actions == list(range(10))


def test_step_updates_game_state_and_returns_rewards():
    env = GameEnvironment()
    with patch.object(env, 'send_command', return_value={'success': True, 'gameState': {'foo': 'bar'}, 'gameEnded': False, 'winningTeam': None}):
        with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
            next_state, reward, done = env.step(1, 0)
    assert reward == 0.1
    assert done is False
    assert env.game_state == {'foo': 'bar', 'gameEnded': False, 'winningTeam': None}
    assert isinstance(next_state, np.ndarray)


def test_reset_initializes_win_fields():
    env = GameEnvironment()
    with patch.object(env, 'start_node_game', return_value=True):
        with patch.object(env, 'send_command', return_value={'success': True, 'gameState': {}, 'winningTeam': None}):
            env.reset()
    assert env.game_state == {'gameEnded': False, 'winningTeam': None}
