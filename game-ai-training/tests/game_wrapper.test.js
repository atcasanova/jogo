const fs = require('fs');
const Module = require('module');
const path = require('path');

function loadGameWrapper() {
  const filename = path.join(__dirname, '..', 'game', 'game_wrapper.js');
  let code = fs.readFileSync(filename, 'utf8');
  code = code.replace(/new GameWrapper\(\);\s*$/, 'module.exports = GameWrapper;');
  const m = new Module(filename);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(code, filename);
  return m.exports;
}

describe('GameWrapper.isActionValid', () => {
  test('returns false when final home square is occupied by a completed piece', () => {
    const GameWrapper = loadGameWrapper();
    const wrapper = new GameWrapper();
    wrapper.setupGame();

    const game = wrapper.game;
    const finalPos = { row: 5, col: 4 }; // last home stretch square for player 0

    const donePiece = game.pieces.find(p => p.id === 'p0_1');
    donePiece.inPenaltyZone = false;
    donePiece.inHomeStretch = true;
    donePiece.completed = true;
    donePiece.position = finalPos;

    const movingPiece = game.pieces.find(p => p.id === 'p0_2');
    movingPiece.inPenaltyZone = false;
    movingPiece.inHomeStretch = true;
    movingPiece.position = { row: 4, col: 4 };

    game.players[0].cards = [{ value: 'A' }];

    const actionId = 0 * 10 + 2; // card index 0, piece number 2
    expect(wrapper.isActionValid(0, actionId)).toBe(false);
  });

  test('returns false when final home square is occupied by an unfinished piece', () => {
    const GameWrapper = loadGameWrapper();
    const wrapper = new GameWrapper();
    wrapper.setupGame();

    const game = wrapper.game;
    const finalPos = { row: 5, col: 4 };

    const blocking = game.pieces.find(p => p.id === 'p0_1');
    blocking.inPenaltyZone = false;
    blocking.inHomeStretch = true;
    blocking.completed = false;
    blocking.position = finalPos;

    const moving = game.pieces.find(p => p.id === 'p0_2');
    moving.inPenaltyZone = false;
    moving.inHomeStretch = true;
    moving.position = { row: 4, col: 4 };

    game.players[0].cards = [{ value: 'A' }];

    const actionId = 0 * 10 + 2;
    expect(wrapper.isActionValid(0, actionId)).toBe(false);
  });
});

describe('GameWrapper win condition', () => {
  test('requires all pieces to be completed', () => {
    const GameWrapper = loadGameWrapper();
    const wrapper = new GameWrapper();
    wrapper.setupGame();

    const game = wrapper.game;
    for (const piece of game.pieces) {
      if (piece.playerId === 0 || piece.playerId === 2) {
        piece.inPenaltyZone = false;
        piece.inHomeStretch = true;
        piece.completed = true;
      }
    }

    const lastPiece = game.pieces.find(p => p.id === 'p0_1');
    lastPiece.completed = false;
    lastPiece.inHomeStretch = true;

    expect(game.checkWinCondition()).toBe(false);

    lastPiece.completed = true;
    expect(game.checkWinCondition()).toBe(true);
  });

  test('win detection marks final square piece completed', () => {
    const GameWrapper = loadGameWrapper();
    const wrapper = new GameWrapper();
    wrapper.setupGame();

    const game = wrapper.game;
    for (const piece of game.pieces) {
      if (piece.playerId === 0 || piece.playerId === 2) {
        piece.inPenaltyZone = false;
        piece.inHomeStretch = true;
        piece.completed = true;
      }
    }

    const piece = game.pieces.find(p => p.id === 'p0_1');
    const finalPos = game.homeStretchForPlayer(0).slice(-1)[0];
    piece.position = { ...finalPos };
    piece.inHomeStretch = true;
    piece.completed = false;

    expect(game.checkWinCondition()).toBe(true);
    expect(piece.completed).toBe(true);
  });
});
