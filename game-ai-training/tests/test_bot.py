import sys
import pytest
from unittest.mock import MagicMock


def test_load_model_legacy_error(tmp_path):
    torch_mock = MagicMock()
    torch_mock.cuda.is_available.return_value = False
    torch_mock.device = lambda *args, **kwargs: 'cpu'
    torch_mock.load.return_value = {
        'q_network_state_dict': {},
        'optimizer_state_dict': {}
    }
    sys.modules['torch'] = torch_mock
    sys.modules['torch.nn'] = MagicMock()
    sys.modules['torch.optim'] = MagicMock()

    from ai.bot import GameBot

    bot = GameBot(player_id=0, state_size=1, action_size=1)
    with pytest.raises(ValueError):
        bot.load_model(str(tmp_path / 'legacy.pth'))
