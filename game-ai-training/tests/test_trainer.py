import sys
import numpy as np
from unittest.mock import patch, MagicMock


class MockGameEnvironment:
    def __init__(self):
        self.state_size = 1
        self.action_space_size = 1
        self.game_state = {'currentPlayerIndex': 0, 'gameEnded': False, 'winningTeam': None}
        # provide env_id attribute expected by TrainingManager
        self.env_id = 0
        self.saved_file = None
        self.reward_event_counts = {
            'home_entry': 0,
            'penalty_exit': 0,
            'capture': 0,
            'game_win': 0
        }

    def reset(self, bot_names=None):
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

    def save_history(self, filepath):
        self.saved_file = filepath

    def reset_reward_events(self):
        pass

    def set_heavy_reward(self, value):
        self.heavy_reward = value


class DummyGameBot:
    def __init__(self, player_id, state_size, action_size, device=None, bot_id=None):
        self.player_id = player_id
        self.bot_id = bot_id if bot_id is not None else player_id
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

        with patch.object(manager, '_shuffle_bots', lambda: None):
            initial_wins = manager.bots[0].wins
            manager.train_episode()
            assert manager.bots[0].wins == initial_wins + 1


def test_train_episode_breaks_on_no_actions():
    torch_mock = MagicMock()
    sys.modules['torch'] = torch_mock
    sys.modules['torch.nn'] = MagicMock()
    sys.modules['torch.optim'] = MagicMock()

    from ai.trainer import TrainingManager

    with patch('ai.trainer.GameBot', DummyGameBot):
        manager = TrainingManager()
        env = MockGameEnvironment()
        env.get_valid_actions = lambda pid: []
        env.step = MagicMock()
        manager.env = env
        manager.create_bots(num_bots=4)

        with patch.object(manager, '_shuffle_bots', lambda: None):
            manager.train_episode()
            env.step.assert_not_called()


def test_reward_entropy_computation():
    from ai.trainer import TrainingManager
    manager = TrainingManager()
    counts = {'home_entry': 2, 'penalty_exit': 1, 'capture': 1, 'game_win': 0}
    entropy = manager._reward_entropy(counts)
    assert entropy > 0


def test_apply_reward_schedule_sets_weight():
    from ai.trainer import TrainingManager
    from ai.environment import GameEnvironment
    from config import HEAVY_REWARD_BASE

    manager = TrainingManager()
    env = GameEnvironment()
    env.set_heavy_reward(0.5)
    manager._apply_reward_schedule(0, env)
    assert env.heavy_reward == HEAVY_REWARD_BASE
