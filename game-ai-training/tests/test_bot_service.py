import sys
from unittest.mock import MagicMock, patch


def test_load_bots_detects_algorithm(tmp_path):
    torch_mock = MagicMock()
    torch_mock.cuda.is_available.return_value = False
    torch_mock.device = lambda *a, **k: 'cpu'

    def fake_load(path, map_location=None):
        if 'bot_0.pth' in path:
            return {'model_state_dict': {}}
        if 'bot_1.pth' in path:
            return {'q_network_state_dict': {}}
        return {}

    torch_mock.load.side_effect = fake_load
    sys.modules['torch'] = torch_mock
    sys.modules['torch.nn'] = MagicMock()
    sys.modules['torch.optim'] = MagicMock()

    (tmp_path / 'bot_0.pth').write_text('')
    (tmp_path / 'bot_1.pth').write_text('')
    (tmp_path / 'bot_2.pth').write_text('')
    (tmp_path / 'bot_3.pth').write_text('')

    env_mock = MagicMock()
    env_mock.state_size = 1
    env_mock.action_space_size = 1

    with patch('bot_service.GameEnvironment', return_value=env_mock):
        from bot_service import load_bots
        from ai.bot import GameBot, DQNBot

        env, bots = load_bots(str(tmp_path))

    assert isinstance(bots[0], GameBot)
    assert isinstance(bots[1], DQNBot)
