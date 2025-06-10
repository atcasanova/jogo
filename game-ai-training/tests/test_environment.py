import json
import numpy as np
from unittest.mock import patch
import subprocess
from pathlib import Path
import tempfile
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


def test_save_history_writes_json(tmp_path):
    env = GameEnvironment()
    env.move_history = [
        {'move': 'foo', 'state': {'players': []}},
        {'move': 'bar', 'state': {'players': []}}
    ]

    log_file = tmp_path / 'history.log'
    env.save_history(str(log_file))

    lines = log_file.read_text().splitlines()
    assert len(lines) == 2
    assert all('move' in json.loads(line) for line in lines)


def _run_get_valid_actions_mock(has_move: bool):
    """Helper to execute GameWrapper.getValidActions under Node with mocked
    hasAnyValidMove."""
    lines = [
        "const fs = require('fs');",
        "const Module = require('module');",
        "const path = require('path');",
        "const filename = path.join('game-ai-training','game','game_wrapper.js');",
        "let code = fs.readFileSync(filename, 'utf8');",
        "code = code.replace(/new GameWrapper\\(\\);\\s*$/, 'module.exports = GameWrapper;');",
        "code = code.replace('return validActions.length > 0 ? validActions.slice(0, 10) : [0];', 'return validActions;');",
        "const m = new Module(filename);",
        "m.filename = filename;",
        "m.paths = Module._nodeModulePaths(path.dirname(filename));",
        "m._compile(code, filename);",
        "const GameWrapper = m.exports;",
        "const wrapper = new GameWrapper();",
        "wrapper.setupGame();",
        f"wrapper.game.hasAnyValidMove = () => {str(has_move).lower()};",
        "process.stdout.write(JSON.stringify(wrapper.getValidActions(0)));"
    ]
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    # Parse last JSON line which contains the actions
    lines = [line for line in output.splitlines() if line.startswith('[')]
    return json.loads(lines[-1]) if lines else []


def _run_make_move_home_entry_mock():
    """Run GameWrapper.makeMove when game.makeMove initially requests home entry."""
    lines = [
        "const fs = require('fs');",
        "const Module = require('module');",
        "const path = require('path');",
        "const filename = path.join('game-ai-training','game','game_wrapper.js');",
        "let code = fs.readFileSync(filename, 'utf8');",
        "code = code.replace(/new GameWrapper\\(\\);\\s*$/, 'module.exports = GameWrapper;');",
        "const m = new Module(filename);",
        "m.filename = filename;",
        "m.paths = Module._nodeModulePaths(path.dirname(filename));",
        "m._compile(code, filename);",
        "const GameWrapper = m.exports;",
        "const wrapper = new GameWrapper();",
        "wrapper.game = {",
        "  isActive: true,",
        "  currentPlayerIndex: 0,",
        "  players: [{ cards: [{}] }],",
        "  pieces: [{ id: 'p0_1' }],",
        "  discardPile: [],",
        "  makeMoveCalls: [],",
        "  makeMove: function(pid, cidx, enterHome) {",
        "    this.makeMoveCalls.push([pid, cidx, enterHome]);",
        "    if (this.makeMoveCalls.length === 1) {",
        "      return { success: false, action: 'homeEntryChoice' };",
        "    }",
        "    this.discardPile.push('card');",
        "    this.nextTurn();",
        "    return { success: true, action: 'enterHomeStretch' };",
        "  },",
        "  nextTurnCalled: false,",
        "  nextTurn: function() { this.nextTurnCalled = true; },",
        "  getCurrentPlayer: function() { return this.players[this.currentPlayerIndex]; },",
        "  drawCard: function() { return {}; },",
        "  checkWinCondition: function() { return false; },",
        "  getWinningTeam: function() { return null; },",
        "  getGameState: function() { return {}; },",
        "  stats: { jokersPlayed: [0] }",
        "};",
        "const result = wrapper.makeMove(0, 1);",
        "process.stdout.write(JSON.stringify({",
        "  calls: wrapper.game.makeMoveCalls,",
        "  discard: wrapper.game.discardPile.length,",
        "  nextTurn: wrapper.game.nextTurnCalled,",
        "  result: result.action",
        "}));"
    ];
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    lines = [line for line in output.splitlines() if line.startswith('{')]
    return json.loads(lines[-1]) if lines else {}


def test_no_discard_actions_when_moves_available():
    actions = _run_get_valid_actions_mock(True)
    assert 40 not in actions


def test_includes_discard_actions_when_no_moves():
    actions = _run_get_valid_actions_mock(False)
    assert 40 in actions


def test_make_move_handles_home_entry_choice():
    result = _run_make_move_home_entry_mock()
    assert len(result['calls']) == 2
    assert result['calls'][1][2] is True
    assert result['discard'] == 1
    assert result['nextTurn'] is True
    assert result['result'] == 'enterHomeStretch'


def _run_joker_history_mock():
    """Run GameWrapper.makeMove for a Joker that triggers choosePosition."""
    lines = [
        "const fs = require('fs');",
        "const Module = require('module');",
        "const path = require('path');",
        "const filename = path.join('game-ai-training','game','game_wrapper.js');",
        "let code = fs.readFileSync(filename, 'utf8');",
        "code = code.replace(/new GameWrapper\\(\\);\\s*$/, 'module.exports = GameWrapper;');",
        "const m = new Module(filename);",
        "m.filename = filename;",
        "m.paths = Module._nodeModulePaths(path.dirname(filename));",
        "m._compile(code, filename);",
        "const GameWrapper = m.exports;",
        "const wrapper = new GameWrapper();",
        "wrapper.game = {",
        "  isActive: true,",
        "  currentPlayerIndex: 0,",
        "  players: [{ name: 'Bot_0', cards: [{ value: 'JOKER', suit: '★' }] }],",
        "  pieces: [{ id: 'p0_1' }],",
        "  discardPile: [],",
        "  makeMove: function(pid, cidx, enterHome) {",
        "    return { success: false, action: 'choosePosition', validPositions: [{ id: 't1' }] };",
        "  },",
        "  moveToSelectedPosition: function(piece, targetId) {},",
        "  nextTurnCalled: false,",
        "  nextTurn: function() { this.nextTurnCalled = true; },",
        "  getCurrentPlayer: function() { return this.players[this.currentPlayerIndex]; },",
        "  drawCard: function() { return {}; },",
        "  checkWinCondition: function() { return false; },",
        "  getWinningTeam: function() { return null; },",
        "  getGameState: function() { return { history: this.history }; },",
        "  stats: { jokersPlayed: [0] },",
        "  history: []",
        "};",
        "wrapper.makeMove(0, 1);",
        "process.stdout.write(JSON.stringify({ history: wrapper.game.history }));"
    ]
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    lines = [line for line in output.splitlines() if line.startswith('{')]
    return json.loads(lines[-1]) if lines else {}


def _run_discard_validation_mock():
    """Attempt to discard when a valid move exists."""
    lines = [
        "const fs = require('fs');",
        "const Module = require('module');",
        "const path = require('path');",
        "const filename = path.join('game-ai-training','game','game_wrapper.js');",
        "let code = fs.readFileSync(filename, 'utf8');",
        "code = code.replace(/new GameWrapper\\(\\);\\s*$/, 'module.exports = GameWrapper;');",
        "const m = new Module(filename);",
        "m.filename = filename;",
        "m.paths = Module._nodeModulePaths(path.dirname(filename));",
        "m._compile(code, filename);",
        "const GameWrapper = m.exports;",
        "const wrapper = new GameWrapper();",
        "wrapper.game = {",
        "  isActive: true,",
        "  currentPlayerIndex: 0,",
        "  players: [{ name: 'Bot_0', cards: [{ value: '5' }] }],",
        "  pieces: [{ id: 'p0_1', completed: false }],",
        "  discardPile: [],",
        "  hasAnyValidMove: () => true,",
        "  discardCard: function() { throw new Error('invalid discard'); },",
        "  nextTurnCalled: false,",
        "  nextTurn: function() { this.nextTurnCalled = true; },",
        "  getCurrentPlayer: function() { return this.players[this.currentPlayerIndex]; },",
        "  drawCard: function() { return {}; },",
        "  checkWinCondition: function() { return false; },",
        "  getWinningTeam: function() { return null; },",
        "  getGameState: function() { return {}; },",
        "  stats: { jokersPlayed: [0] }",
        "};",
        "const res = wrapper.makeMove(0, 40);",
        "process.stdout.write(JSON.stringify(res));"
    ]
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    lines = [line for line in output.splitlines() if line.startswith('{')]
    return json.loads(lines[-1]) if lines else {}


def test_joker_updates_history():
    result = _run_joker_history_mock()
    assert result['history'][-1] == 'Bot_0 moveu p0_1 com C'


def test_discard_fails_when_move_available():
    result = _run_discard_validation_mock()
    assert result['success'] is False
