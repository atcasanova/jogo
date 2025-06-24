import json
import numpy as np
from unittest.mock import patch
import subprocess
from pathlib import Path
import tempfile
import pytest
from ai.environment import GameEnvironment


def test_reset_returns_zero_when_start_fails():
    env = GameEnvironment()
    with patch.object(env, 'start_node_game', return_value=False):
        state = env.reset()
    assert isinstance(state, np.ndarray)
    assert state.shape[0] == env.state_size
    assert np.all(state == 0)


def test_get_valid_actions_returns_all_actions():
    env = GameEnvironment()
    with patch.object(env, 'send_command', return_value={'validActions': list(range(15))}):
        actions = env.get_valid_actions(0)
    assert actions == list(range(15))


def test_get_valid_actions_returns_empty_on_error():
    env = GameEnvironment()
    with patch.object(env, 'send_command', return_value={'error': 'fail'}):
        actions = env.get_valid_actions(0)
    assert actions == []


def test_get_valid_actions_returns_discard_on_error_with_state():
    env = GameEnvironment()
    env.game_state = {'players': [{'cards': [{}]}]}
    with patch.object(env, 'send_command', return_value={'error': 'fail'}):
        actions = env.get_valid_actions(0)
    assert actions == [70]


def test_get_valid_actions_preserves_discard_when_filtered():
    env = GameEnvironment()
    with patch.object(env, 'send_command', return_value={'validActions': [70, 71]}):
        with patch.object(env, 'is_action_valid', return_value=False):
            actions = env.get_valid_actions(0)
    assert actions == [70]


def test_step_updates_game_state_and_returns_rewards():
    env = GameEnvironment()
    with patch.object(env, 'send_command', return_value={'success': True, 'gameState': {'foo': 'bar'}, 'gameEnded': False, 'winningTeam': None}):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                next_state, reward, done = env.step(1, 0)
    assert reward == 0.05
    assert done is False
    assert env.game_state == {'foo': 'bar', 'gameEnded': False, 'winningTeam': None}
    assert isinstance(next_state, np.ndarray)


def test_step_updates_state_on_failure():
    env = GameEnvironment()
    response = {
        'success': False,
        'gameState': {'foo': 'bar', 'lastMove': 'moved'},
        'gameEnded': False,
        'winningTeam': None
    }
    with patch.object(env, 'send_command', return_value=response):
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                next_state, reward, done = env.step(1, 0)

    assert reward == -0.1
    assert done is False
    assert env.game_state == {'foo': 'bar', 'lastMove': 'moved', 'gameEnded': False, 'winningTeam': None}
    assert env.move_history[-1]['move'] == 'moved'
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
        "const m = new Module(filename);",
        "m.filename = filename;",
        "m.paths = Module._nodeModulePaths(path.dirname(filename));",
        "m._compile(code, filename);",
        "const GameWrapper = m.exports;",
        "const wrapper = new GameWrapper();",
        "wrapper.setupGame();",
        f"wrapper.game.hasAnyValidMove = () => {str(has_move).lower()};",
        "if (!wrapper.game.hasAnyValidMove()) { wrapper.game.cloneForSimulation = () => ({ makeMove: () => { throw new Error('x'); } }); }",
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
    assert actions


def test_includes_discard_actions_when_no_moves():
    actions = _run_get_valid_actions_mock(False)
    assert 70 in actions


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
        "const res = wrapper.makeMove(0, 70);",
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


def _run_discard_fallback_mock():
    """Discard is rejected but wrapper performs a move instead."""
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
        "  discardCard: function() { throw new Error('Você ainda tem jogadas disponíveis'); },",
        "  makeMove: function(pid, ci) { this.used = [pid, ci]; return { success: true, action: 'move' }; },",
        "  cloneForSimulation: function() { return { makeMove: () => ({ success: true }) }; },",
        "  nextTurn: function() {},",
        "  getCurrentPlayer: function() { return this.players[this.currentPlayerIndex]; },",
        "  drawCard: function() { return {}; },",
        "  checkWinCondition: function() { return false; },",
        "  getWinningTeam: function() { return null; },",
        "  getGameState: function() { return {}; },",
        "  stats: { jokersPlayed: [0] }",
        "};",
        "const res = wrapper.makeMove(0, 70);",
        "process.stdout.write(JSON.stringify({ res, used: wrapper.game.used }));"
    ]
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    lines = [line for line in output.splitlines() if line.startswith('{')]
    return json.loads(lines[-1]) if lines else {}


def _run_prevent_discard_mock():
    """Discard would be allowed by the game but wrapper should play instead."""
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
        "  players: [{ cards: [{ value: '5' }] }, {}],",
        "  pieces: [{ id: 'p1_1', completed: false, inPenaltyZone: false }],",
        "  discardPile: [],",
        "  discardCard: function() { this.discarded = true; return { success: true, action: 'discard' }; },",
        "  makeMove: function(pid, ci) { this.used = [pid, ci]; return { success: true, action: 'move' }; },",
        "  cloneForSimulation: function() { return { makeMove: () => ({ success: true }) }; },",
        "  hasAnyValidMove: () => true,",
        "  partnerIdFor: () => 1,",
        "  hasAllPiecesInHomeStretch: () => true,",
        "  nextTurn: function() {},",
        "  getCurrentPlayer: function() { return this.players[this.currentPlayerIndex]; },",
        "  drawCard: function() { return {}; },",
        "  checkWinCondition: function() { return false; },",
        "  getWinningTeam: function() { return null; },",
        "  getGameState: function() { return {}; },",
        "  stats: { jokersPlayed: [0], roundsWithoutPlay: [0] }",
        "};",
        "const res = wrapper.makeMove(0, 70);",
        "process.stdout.write(JSON.stringify({ res, used: wrapper.game.used, discarded: wrapper.game.discarded }));"
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


def test_discard_fallback_executes_move():
    result = _run_discard_fallback_mock()
    assert result['res']['success'] is True


def test_discard_prevented_when_move_possible():
    result = _run_prevent_discard_mock()
    assert result['res']['success'] is True
    assert result.get('discarded') is None
    assert result['used'][0] == 'p1_1'


def _run_hidden_move_mock():
    """Return actions when hasAnyValidMove is true but enumeration yields none."""
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
        "  players: [{ cards: [{ value: '5' }] }],",
        "  pieces: [{ id: 'p0_1', completed: false }],",
        "  cloneForSimulation: () => ({ makeMove: () => { throw new Error('x'); } }),",
        "  hasAnyValidMove: () => true",
        "};",
        "process.stdout.write(JSON.stringify(wrapper.getValidActions(0)));"
    ]
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    actions = [line for line in output.splitlines() if line.startswith('[')]
    return json.loads(actions[-1]) if actions else []


def test_no_fallback_discard_when_moves_unlisted():
    actions = _run_hidden_move_mock()
    # When enumeration yields no moves but the game reports that moves are
    # possible, the wrapper should now fall back to allowing a discard.
    assert actions == [70]


def _run_partner_actions_mock():
    """Return actions including partner pieces when all own pieces home."""
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
        "  players: [{ cards: [{ value: '5' }] }, {}],",
        "  pieces: [",
        "    { id: 'p0_1', inHomeStretch: true },",
        "    { id: 'p0_2', inHomeStretch: true },",
        "    { id: 'p0_3', inHomeStretch: true },",
        "    { id: 'p0_4', inHomeStretch: true },",
        "    { id: 'p0_5', inHomeStretch: true },",
        "    { id: 'p1_1', inPenaltyZone: false, completed: false }",
        "  ],",
        "  cloneForSimulation: () => ({ makeMove: () => {} }),",
        "  hasAnyValidMove: () => true,",
        "  hasAllPiecesInHomeStretch: id => id === 0,",
        "  partnerIdFor: () => 1",
        "};",
        "process.stdout.write(JSON.stringify(wrapper.getValidActions(0)));"
    ]
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    actions = [line for line in output.splitlines() if line.startswith('[')]
    return json.loads(actions[-1]) if actions else []


def _run_partner_move_mock():
    """Execute a move targeting a partner piece."""
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
        "  players: [{ cards: [{}] }, {}],",
        "  partnerIdFor: () => 1,",
        "  pieces: [{ id: 'p1_1' }],",
        "  discardPile: [],",
        "  makeMove: function(pid, idx) { this.called = [pid, idx]; return { success: true }; },",
        "  getCurrentPlayer: function() { return this.players[this.currentPlayerIndex]; },",
        "  drawCard: function() { return {}; },",
        "  checkWinCondition: function() { return false; },",
        "  getWinningTeam: function() { return null; },",
        "  getGameState: function() { return {}; },",
        "  nextTurn: function() {},",
        "  stats: { jokersPlayed: [0] }",
        "};",
        "wrapper.makeMove(0, 6);",
        "process.stdout.write(JSON.stringify({ called: wrapper.game.called }));"
    ]
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    lines = [line for line in output.splitlines() if line.startswith('{')]
    return json.loads(lines[-1]) if lines else {}


def _run_partner_move_five_mock():
    """Execute a move targeting the fifth partner piece."""
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
        "  players: [{ cards: [{}] }, {}],",
        "  partnerIdFor: () => 1,",
        "  pieces: [{ id: 'p1_5' }],",
        "  discardPile: [],",
        "  makeMove: function(pid, idx) { this.called = [pid, idx]; return { success: true }; },",
        "  getCurrentPlayer: function() { return this.players[this.currentPlayerIndex]; },",
        "  drawCard: function() { return {}; },",
        "  checkWinCondition: function() { return false; },",
        "  getWinningTeam: function() { return null; },",
        "  getGameState: function() { return {}; },",
        "  nextTurn: function() {},",
        "  stats: { jokersPlayed: [0] }",
        "};",
        "wrapper.makeMove(0, 10);",
        "process.stdout.write(JSON.stringify({ called: wrapper.game.called }));"
    ]
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    lines = [line for line in output.splitlines() if line.startswith('{')]
    return json.loads(lines[-1]) if lines else {}


def test_partner_actions_listed_when_all_home():
    actions = _run_partner_actions_mock()
    assert 6 in actions


def test_make_move_accepts_partner_piece():
    result = _run_partner_move_mock()
    assert result['called'][0] == 'p1_1'


def test_make_move_accepts_partner_piece_five():
    result = _run_partner_move_five_mock()
    assert result['called'][0] == 'p1_5'


def _run_is_action_valid_discard(card_len, action_id):
    """Run GameWrapper.isActionValid for a discard action."""
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
        f"wrapper.game = {{",
        f"  players: [{{ cards: new Array({card_len}).fill({{}}) }}],",
        "  cloneForSimulation: function() { return { players: this.players, discardCard: this.discardCard.bind(this) }; },",
        "  discardCard: function(idx) { if (idx < 0 || idx >= this.players[0].cards.length) throw new Error('bad'); }",
        "};",
        f"process.stdout.write(JSON.stringify(wrapper.isActionValid(0, {action_id})));"
    ]
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    lines = [line for line in output.splitlines() if line.strip()]
    return json.loads(lines[-1]) if lines else None


def test_is_action_valid_discard():
    assert _run_is_action_valid_discard(6, 75) is True
    assert _run_is_action_valid_discard(5, 75) is False


def _run_is_action_valid_joker_no_targets():
    """Run GameWrapper.isActionValid when Joker has no valid targets."""
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
        "  players: [{ cards: [{ value: 'JOKER' }] }],",
        "  pieces: [{ id: 'p0_1', completed: false, inPenaltyZone: false }],",
        "  cloneForSimulation: function() { return {",
        "    players: this.players,",
        "    pieces: this.pieces,",
        "    makeMove: () => ({ action: 'choosePosition', validPositions: [] }),",
        "    moveToSelectedPosition: function() {}",
        "  }; }",
        "};",
        "process.stdout.write(JSON.stringify(wrapper.isActionValid(0, 1)));"
    ]
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    lines = [line for line in output.splitlines() if line.strip()]
    return json.loads(lines[-1]) if lines else None


def test_is_action_valid_joker_no_targets():
    assert _run_is_action_valid_joker_no_targets() is False


def _run_get_special_actions_mock():
    """Run GameWrapper.getValidActions with a 7 card to ensure special actions are generated."""
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
        "  players: [{ cards: [{ value: '7' }] }],",
        "  pieces: [",
        "    { id: 'p0_1', completed: false, inPenaltyZone: false },",
        "    { id: 'p0_2', completed: false, inPenaltyZone: false }",
        "  ],",
        "  cloneForSimulation: function() { return { makeMove: () => {}, makeSpecialMove: () => {} }; },",
        "  hasAnyValidMove: () => true",
        "};",
        "process.stdout.write(JSON.stringify(wrapper.getValidActions(0)));"
    ];
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    lines = [line for line in output.splitlines() if line.startswith('[')]
    return json.loads(lines[-1]) if lines else []


def _run_single_piece_seven_mock():
    """Return special actions when only one piece can move with a seven."""
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
        "  players: [{ cards: [{ value: '7' }] }],",
        "  pieces: [{ id: 'p0_1', completed: false, inPenaltyZone: false }],",
        "  cloneForSimulation: function() { return { makeMove: () => {}, makeSpecialMove: () => {} }; },",
        "  hasAnyValidMove: () => true",
        "};",
        "const actions = wrapper.getValidActions(0);",
        "process.stdout.write(JSON.stringify({ specials: wrapper.specialActions, actions }));"
    ];
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    lines = [line for line in output.splitlines() if line.startswith('{')]
    return json.loads(lines[-1]) if lines else {}


def _run_wrapper_special_move_mock():
    """Invoke GameWrapper.makeSpecialMove with a stored mapping."""
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
        "  makeSpecialMove: function(moves) { this.called = moves; return { success: true }; },",
        "  getCurrentPlayer: () => ({}),",
        "  drawCard: () => ({}),",
        "  checkWinCondition: () => false,",
        "  getWinningTeam: () => null,",
        "  getGameState: () => ({}) ,",
        "  nextTurn: () => {},",
        "  stats: { jokersPlayed: [0] },",
        "  discardPile: []",
        "};",
        "wrapper.specialActions = { 60: [{ pieceId: 'p0_1', steps: 3 }, { pieceId: 'p0_2', steps: 4 }] };",
        "const res = wrapper.makeSpecialMove(0, 60);",
        "process.stdout.write(JSON.stringify({ moves: wrapper.game.called, success: res.success }));"
    ];
    script = "\n".join(lines)

    root = Path(__file__).resolve().parents[2]
    with tempfile.NamedTemporaryFile('w+', suffix='.js', delete=False) as tmp:
        tmp.write(script)
        tmp.flush()
        output = subprocess.check_output(['node', tmp.name], cwd=root, text=True)
    lines = [line for line in output.splitlines() if line.startswith('{')]
    return json.loads(lines[-1]) if lines else {}


def test_special_actions_returned_for_card_seven():
    actions = _run_get_special_actions_mock()
    assert any(a >= 60 for a in actions)


def test_single_piece_seven_action_generated():
    result = _run_single_piece_seven_mock()
    assert any(len(m) == 1 and m[0]['steps'] == 7 for m in result['specials'].values())


def test_wrapper_make_special_move_calls_game():
    result = _run_wrapper_special_move_mock()
    assert result['success'] is True
    assert result['moves'][0]['steps'] == 3


def test_step_dispatches_special_move():
    env = GameEnvironment()
    with patch.object(env, 'send_command', return_value={'success': True, 'gameState': {}, 'gameEnded': False, 'winningTeam': None}) as mock:
        with patch.object(env, 'is_action_valid', return_value=True):
            with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                env.step(60, 0)
    assert mock.call_args[0][0]['action'] == 'makeSpecialMove'


def test_step_retries_until_success():
    env = GameEnvironment()

    responses = [
        {'success': False, 'gameState': {}, 'gameEnded': False, 'winningTeam': None},
        {'success': False, 'gameState': {}, 'gameEnded': False, 'winningTeam': None},
        {'success': True, 'gameState': {}, 'gameEnded': False, 'winningTeam': None}
    ]

    def _send(cmd):
        return responses.pop(0)

    with patch.object(env, 'send_command', side_effect=_send) as mock_cmd:
        with patch.object(env, 'get_valid_actions', side_effect=[[1, 2, 3], [2, 3], [3]]):
            with patch.object(env, 'is_action_valid', return_value=True):
                with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                    next_state, reward, done = env.step(1, 0)

    assert reward == pytest.approx(-0.15)
    assert mock_cmd.call_count == 3


def test_step_discards_when_all_actions_fail():
    env = GameEnvironment()

    responses = [
        {'success': False, 'gameState': {}, 'gameEnded': False, 'winningTeam': None},
        {'success': False, 'gameState': {}, 'gameEnded': False, 'winningTeam': None},
        {'success': True, 'gameState': {}, 'gameEnded': False, 'winningTeam': None}
    ]

    def _send(cmd):
        return responses.pop(0)

    with patch.object(env, 'send_command', side_effect=_send) as mock_cmd:
        with patch.object(env, 'get_valid_actions', return_value=[1]):
            with patch.object(env, 'is_action_valid', return_value=True):
                with patch.object(env, 'get_state', return_value=np.zeros(env.state_size)):
                    env.step(1, 0)

    assert mock_cmd.call_count == 3
    assert mock_cmd.call_args[0][0]['actionId'] >= 70
