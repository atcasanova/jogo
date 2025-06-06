import sys
import numpy as np
from unittest.mock import patch, MagicMock


class MockGameEnvironment:
    def __init__(self):
        self.state_size = 1
        self.action_space_size = 1
        self.game_state = {'currentPlayerIndex': 0, 'gameEnded': False, 'winningTeam': None}

    def reset(self):
        self.game_state = {'currentPlayerIndex': 0, 'gameEnded': False, 'winningTeam': None}
        return np.zeros(self.state_size)

    def get_state(self, player_id):
        return np.zeros(self.state_size)

    def get_valid_actions(self, player_id):
        return [0]

    def step(self, action, player_id):
        self.game_state = {
            'currentPlayerIndex': 0,
            'gameEnded': True,
            'winningTeam': [{'position': 0}]
        }
        return np.zeros(self.state_size), 0.0, True

    def close(self):
        pass


class DummyGameBot:
    def __init__(self, player_id, state_size, action_size):
        self.player_id = player_id
        self.state_size = state_size
        self.action_space_size = action_size
        self.wins = 0
        self.games_played = 0
        self.total_reward = 0
        self.losses = []
        self.epsilon = 0
        self.update_target_freq = 1
        self.train_freq = 1
        self.step_count = 0

    def act(self, state, valid_actions):
        return valid_actions[0]

    def remember(self, *args, **kwargs):
        pass

    def replay(self):
        pass

    def update_target_network(self):
        pass


def test_train_episode_increments_wins():
    torch_mock = MagicMock()
    sys.modules['torch'] = torch_mock
    sys.modules['torch.nn'] = MagicMock()
    sys.modules['torch.optim'] = MagicMock()

    from ai.trainer import TrainingManager

    with patch('ai.trainer.GameBot', DummyGameBot):
        manager = TrainingManager()
        manager.env = MockGameEnvironment()
        manager.create_bots(num_bots=4)

        initial_wins = manager.bots[0].wins
        manager.train_episode()
        assert manager.bots[0].wins == initial_wins + 1
