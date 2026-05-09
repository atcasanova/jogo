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
    STUCK_SMART_CARD_DISCARD_PENALTY,
    SMART_CARD_MISUSE_PENALTY,
    EIGHT_CARD_REACH_REWARD,
    EIGHT_HOME_ENTRY_MULTIPLIER,
)
from config import (
    STEP_PENALTY_BASE,
    PIECE_COMPLETION_BONUS,
    REWARD_WEIGHTS,
    NEAR_FINISH_BONUS,
    NEAR_FINISH_CONVERSION_BONUS,
)


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

    expected = (
        step_cost
        + REWARD_WEIGHTS['home_entry']
        + SEVEN_SPLIT_REWARD
        + SEVEN_SPLIT_HOME_ENTRY_REWARD
    )
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


def test_unimpactful_seven_gets_penalty_without_split_bonus():
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
                'position': {'row': 0, 'col': 10},
            },
        ],
        'teams': [[{'position': 0}, {'position': 2}], [{'position': 1}, {'position': 3}]],
    }
    env.player_team_map = {0: 0, 2: 0, 1: 1, 3: 1}
    response = {
        'success': True,
        'specialMove': {
            'cardValue': '7',
            'split': True,
            'moves': [{'pieceId': 'p0_1', 'steps': 7}],
        },
        'gameState': {
            'pieces': [
                {
                    'id': 'p0_1',
                    'playerId': 0,
                    'completed': False,
                    'inHomeStretch': False,
                    'inPenaltyZone': False,
                    'position': {'row': 0, 'col': 17},
                },
            ],
            'teams': env.game_state['teams'],
        },
        'gameEnded': False,
        'winningTeam': None,
    }

    with patch.object(env, 'send_command', return_value=response):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                _, reward, _ = env.step(60, 0)

    assert reward == pytest.approx(step_cost + SMART_CARD_MISUSE_PENALTY)
    assert env.reward_event_counts['seven_split'] == 0
    assert env.reward_event_counts['seven_card_penalty'] == 1


def test_eight_setup_rewards_reach_and_boosts_next_home_entry():
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
                'position': {'row': 0, 'col': 12},
            },
        ],
        'teams': [[{'position': 0}, {'position': 2}], [{'position': 1}, {'position': 3}]],
    }
    env.player_team_map = {0: 0, 2: 0, 1: 1, 3: 1}
    eight_response = {
        'success': True,
        'playedCardValue': '8',
        'gameState': {
            'pieces': [
                {
                    'id': 'p0_1',
                    'playerId': 0,
                    'completed': False,
                    'inHomeStretch': False,
                    'inPenaltyZone': False,
                    'position': {'row': 0, 'col': 4},
                },
            ],
            'teams': env.game_state['teams'],
        },
        'gameEnded': False,
        'winningTeam': None,
    }

    with patch.object(env, 'send_command', return_value=eight_response):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                _, eight_reward, _ = env.step(0, 0)

    assert eight_reward == pytest.approx(
        step_cost + REWARD_WEIGHTS['home_entry_progress'] + EIGHT_CARD_REACH_REWARD
    )
    assert env.pending_eight_setups[0]['piece_id'] == 'p0_1'

    env.game_state = eight_response['gameState']
    entry_response = {
        'success': True,
        'playedCardValue': '2',
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
            ],
            'teams': env.game_state['teams'],
        },
        'gameEnded': False,
        'winningTeam': None,
    }

    with patch.object(env, 'send_command', return_value=entry_response):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                _, entry_reward, _ = env.step(0, 0)

    expected_entry = step_cost + REWARD_WEIGHTS['home_entry'] * EIGHT_HOME_ENTRY_MULTIPLIER
    assert entry_reward == pytest.approx(expected_entry)
    assert env.reward_event_counts['eight_home_entry_boost'] == 1
    assert env.pending_eight_setups[0] is None


def test_stuck_penalty_zone_joker_discard_gets_smart_card_penalty():
    env = GameEnvironment()
    step_cost = STEP_PENALTY_BASE * max(1.0, env.pieces_per_player / 2.0)
    env.game_state = {
        'currentPlayerIndex': 0,
        'players': [
            {'position': 0, 'cards': [{'value': 'JOKER'}, {'value': '8'}, {'value': '7'}]},
        ],
        'pieces': [
            {
                'id': 'p0_1',
                'playerId': 0,
                'completed': False,
                'inHomeStretch': False,
                'inPenaltyZone': True,
                'position': {'row': 2, 'col': 8},
            },
            {
                'id': 'p0_2',
                'playerId': 0,
                'completed': False,
                'inHomeStretch': False,
                'inPenaltyZone': True,
                'position': {'row': 1, 'col': 8},
            },
        ],
        'teams': [[{'position': 0}, {'position': 2}], [{'position': 1}, {'position': 3}]],
    }
    env.player_team_map = {0: 0, 2: 0, 1: 1, 3: 1}
    response = {
        'success': True,
        'action': 'discard',
        'playedCardValue': 'JOKER',
        'gameState': {
            'players': [{'position': 0, 'cards': [{'value': '8'}, {'value': '7'}]}],
            'pieces': env.game_state['pieces'],
            'teams': env.game_state['teams'],
        },
        'gameEnded': False,
        'winningTeam': None,
    }

    with patch.object(env, 'send_command', return_value=response):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                _, reward, _ = env.step(70, 0)

    assert reward == pytest.approx(step_cost + STUCK_SMART_CARD_DISCARD_PENALTY)
    assert env.reward_event_counts['stuck_smart_card_discard'] == 1
    assert env.reward_event_totals['stuck_smart_card_discard'] == pytest.approx(
        STUCK_SMART_CARD_DISCARD_PENALTY
    )


def test_stuck_penalty_zone_smart_discard_not_penalized_when_exit_card_available():
    env = GameEnvironment()
    step_cost = STEP_PENALTY_BASE * max(1.0, env.pieces_per_player / 2.0)
    env.game_state = {
        'currentPlayerIndex': 0,
        'players': [
            {'position': 0, 'cards': [{'value': 'JOKER'}, {'value': 'A'}]},
        ],
        'pieces': [
            {
                'id': 'p0_1',
                'playerId': 0,
                'completed': False,
                'inHomeStretch': False,
                'inPenaltyZone': True,
                'position': {'row': 2, 'col': 8},
            },
        ],
        'teams': [[{'position': 0}, {'position': 2}], [{'position': 1}, {'position': 3}]],
    }
    env.player_team_map = {0: 0, 2: 0, 1: 1, 3: 1}
    response = {
        'success': True,
        'action': 'discard',
        'playedCardValue': 'JOKER',
        'gameState': {
            'players': [{'position': 0, 'cards': [{'value': 'A'}]}],
            'pieces': env.game_state['pieces'],
            'teams': env.game_state['teams'],
        },
        'gameEnded': False,
        'winningTeam': None,
    }

    with patch.object(env, 'send_command', return_value=response):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                _, reward, _ = env.step(70, 0)

    assert reward == pytest.approx(step_cost)
    assert env.reward_event_counts['stuck_smart_card_discard'] == 0


def test_near_finish_reward_matches_logged_total():
    env = GameEnvironment(pieces_per_player=1)
    step_cost = STEP_PENALTY_BASE * max(1.0, env.pieces_per_player / 2.0)
    env.game_state = {
        'turnCount': 5,
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
                'id': 'p2_1',
                'playerId': 2,
                'completed': False,
                'inHomeStretch': False,
                'inPenaltyZone': False,
                'position': {'row': 18, 'col': 10},
            },
        ],
        'teams': [[{'position': 0}, {'position': 2}], [{'position': 1}, {'position': 3}]],
    }
    env.player_team_map = {0: 0, 2: 0, 1: 1, 3: 1}

    response = {
        'success': True,
        'gameState': {
            'turnCount': 6,
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
                    'id': 'p2_1',
                    'playerId': 2,
                    'completed': False,
                    'inHomeStretch': False,
                    'inPenaltyZone': False,
                    'position': {'row': 18, 'col': 10},
                },
            ],
            'teams': env.game_state['teams'],
        },
        'gameEnded': False,
        'winningTeam': None,
    }

    with patch.object(env, 'send_command', return_value=response):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                _, reward, _ = env.step(0, 0, step_count=5)

    expected = step_cost + PIECE_COMPLETION_REWARD + PIECE_COMPLETION_BONUS + NEAR_FINISH_BONUS
    assert reward == pytest.approx(expected)
    assert env.reward_event_counts['near_finish'] == 1
    assert env.reward_event_totals['near_finish'] == pytest.approx(NEAR_FINISH_BONUS)
    assert env.near_finish_turns[0] == 5


def test_near_finish_conversion_bonus_rewards_fast_close():
    env = GameEnvironment(pieces_per_player=1)
    step_cost = STEP_PENALTY_BASE * max(1.0, env.pieces_per_player / 2.0)
    env.turn_limit = 100
    env.near_finish_turns[0] = 10
    env.game_state = {
        'turnCount': 12,
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
                'id': 'p2_1',
                'playerId': 2,
                'completed': False,
                'inHomeStretch': True,
                'inPenaltyZone': False,
                'position': {'row': 17, 'col': 14},
            },
        ],
        'teams': [[{'position': 0}, {'position': 2}], [{'position': 1}, {'position': 3}]],
    }
    env.player_team_map = {0: 0, 2: 0, 1: 1, 3: 1}

    response = {
        'success': True,
        'gameState': {
            'turnCount': 12,
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
                    'id': 'p2_1',
                    'playerId': 2,
                    'completed': True,
                    'inHomeStretch': True,
                    'inPenaltyZone': False,
                    'position': {'row': 19, 'col': 14},
                },
            ],
            'teams': env.game_state['teams'],
        },
        'gameEnded': True,
        'winningTeam': [{'position': 0}, {'position': 2}],
    }

    with patch.object(env, 'send_command', return_value=response):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                _, reward, done = env.step(0, 2, step_count=12)

    expected_conversion = NEAR_FINISH_CONVERSION_BONUS * (1.0 - 2.0 / 32.0)
    expected_fast_finish = 40.0 * 0.88
    expected = (
        step_cost
        + PIECE_COMPLETION_REWARD
        + PIECE_COMPLETION_BONUS
        + REWARD_WEIGHTS['win']
        + expected_fast_finish
        + expected_conversion
    )
    assert done
    assert reward == pytest.approx(expected)
    assert env.reward_event_counts['near_finish_conversion'] == 1
    assert env.reward_event_totals['near_finish_conversion'] == pytest.approx(expected_conversion)
