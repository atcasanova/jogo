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

describe('GameWrapper 7-card split actions', () => {
  test('prioritizes split moves inside the bounded special action range', () => {
    const GameWrapper = loadGameWrapper();
    const wrapper = new GameWrapper();

    const pieces = [1, 2, 3].map(n => ({
      id: `p0_${n}`,
      playerId: 0,
      completed: false,
      inPenaltyZone: false,
      inHomeStretch: false,
      position: { row: 0, col: n }
    }));

    wrapper.game = {
      players: [{ cards: [{ value: '7' }] }],
      pieces,
      piecesPerPlayer: 3,
      cloneForSimulation() {
        const clonePieces = JSON.parse(JSON.stringify(pieces));
        return {
          pieces: clonePieces,
          makeSpecialMove(moves) {
            for (const move of moves) {
              const piece = clonePieces.find(p => p.id === move.pieceId);
              if (!piece) throw new Error('missing piece');
              if (move.pieceId === 'p0_1' && move.steps === 1) {
                piece.inHomeStretch = true;
              }
              if (move.pieceId === 'p0_2' && move.steps === 6) {
                piece.inHomeStretch = true;
                piece.completed = true;
              }
            }
            return { success: true };
          },
          makeMove() {
            throw new Error('normal moves omitted');
          }
        };
      }
    };

    const actions = wrapper.getValidActions(0);
    const specialActions = actions.filter(action => action >= 60 && action < 70);

    expect(specialActions).toHaveLength(10);
    expect(Math.max(...specialActions)).toBe(69);
    expect(specialActions.every(action => wrapper.specialActions[action].length > 1)).toBe(true);
  });
});

describe('GameWrapper home-stretch entry priorities', () => {
  test('reports only the deepest available home-stretch entry action', () => {
    const GameWrapper = loadGameWrapper();
    const wrapper = new GameWrapper();
    wrapper.setupGame();

    const game = wrapper.game;
    game.players[0].cards = [
      { suit: '♠', value: '2' },
      { suit: '♣', value: '5' }
    ];

    const mover = game.pieces.find(p => p.id === 'p0_1');
    mover.inPenaltyZone = false;
    mover.inHomeStretch = false;
    mover.completed = false;
    mover.position = { row: 0, col: 4 };

    const validActions = wrapper.getValidActions(0);

    expect(validActions).toEqual(expect.arrayContaining([1, 11]));
    expect(wrapper.getHomeEntryActions(0, validActions)).toEqual([11]);
  });
});

describe('GameWrapper discard protection', () => {
  function buildDiscardOnlyWrapper(cards) {
    const GameWrapper = loadGameWrapper();
    const wrapper = new GameWrapper();
    wrapper.game = {
      players: [{ cards }],
      pieces: [],
      piecesPerPlayer: 1,
      cloneForSimulation() {
        return {
          pieces: [],
          makeMove() {
            throw new Error('no moves');
          },
          makeSpecialMove() {
            throw new Error('no special moves');
          }
        };
      }
    };
    return wrapper;
  }

  test('does not expose 7, 8 or Joker discards while safer cards are available', () => {
    const wrapper = buildDiscardOnlyWrapper([
      { value: 'JOKER' },
      { value: '8' },
      { value: '7' },
      { value: '5' },
      { value: 'K' }
    ]);

    expect(wrapper.getValidActions(0)).toEqual([73, 74]);
  });

  test('allows protected discards only when every discard option is protected', () => {
    const wrapper = buildDiscardOnlyWrapper([
      { value: '8' },
      { value: 'JOKER' },
      { value: '7' }
    ]);

    expect(wrapper.getValidActions(0)).toEqual([70, 71, 72]);
  });

  test('redirects stale protected discard actions to a safer discard', () => {
    const GameWrapper = loadGameWrapper();
    const wrapper = new GameWrapper();
    const discardedIndices = [];
    wrapper.game = {
      isActive: true,
      currentPlayerIndex: 0,
      players: [{ name: 'Bot_0', position: 0, cards: [{ value: 'JOKER' }, { value: '5' }] }],
      pieces: [],
      discardPile: [],
      history: [],
      stats: { roundsWithoutPlay: [0, 0, 0, 0], jokersPlayed: [0, 0, 0, 0] },
      hasAnyValidMove() {
        return false;
      },
      discardCard(cardIndex) {
        discardedIndices.push(cardIndex);
        this.players[0].cards.splice(cardIndex, 1);
        return { success: true, action: 'discard' };
      },
      getCurrentPlayer() {
        return null;
      },
      checkWinCondition() {
        return false;
      },
      getWinningTeam() {
        return null;
      }
    };

    const response = wrapper.makeMove(0, 70);

    expect(response.success).toBe(true);
    expect(discardedIndices).toEqual([1]);
  });
});

describe('GameWrapper fixed play action metadata', () => {
  function buildWrapper(capturedPiece, captureAction = 'opponentCapture') {
    const GameWrapper = loadGameWrapper();
    const wrapper = new GameWrapper();
    const pieces = [
      {
        id: 'p0_1',
        playerId: 0,
        completed: false,
        inPenaltyZone: false,
        inHomeStretch: false,
        position: { row: 0, col: 14 }
      },
      capturedPiece
    ];
    wrapper.game = {
      pieces,
      piecesPerPlayer: 5,
      partnerIdFor(playerId) {
        return playerId === 0 ? 2 : 0;
      },
      isPartner(a, b) {
        return (a === 0 && b === 2) || (a === 2 && b === 0);
      },
      cloneForSimulation() {
        const clonePieces = JSON.parse(JSON.stringify(pieces));
        return {
          pieces: clonePieces,
          makeMove() {
            return { success: true, captures: [{ pieceId: capturedPiece.id, action: captureAction }] };
          }
        };
      }
    };
    return wrapper;
  }

  test('prioritizes capturing an opponent in home-entry reach', () => {
    const wrapper = buildWrapper({
      id: 'p1_1',
      playerId: 1,
      completed: false,
      inPenaltyZone: false,
      inHomeStretch: false,
      position: { row: 0, col: 15 }
    });

    const metadata = wrapper.getFixedPlayActions(0, [1]);

    expect(metadata.priorityActions).toEqual([1]);
    expect(metadata.avoidActions).toEqual([]);
  });

  test('marks opponent captures on start squares as avoidable', () => {
    const wrapper = buildWrapper({
      id: 'p1_1',
      playerId: 1,
      completed: false,
      inPenaltyZone: false,
      inHomeStretch: false,
      position: { row: 8, col: 18 }
    });

    const metadata = wrapper.getFixedPlayActions(0, [1]);

    expect(metadata.priorityActions).toEqual([]);
    expect(metadata.avoidActions).toEqual([1]);
  });

  test('prioritizes capturing a partner on their start square', () => {
    const wrapper = buildWrapper({
      id: 'p2_1',
      playerId: 2,
      completed: false,
      inPenaltyZone: false,
      inHomeStretch: false,
      position: { row: 18, col: 10 }
    }, 'partnerCapture');

    const metadata = wrapper.getFixedPlayActions(0, [1]);

    expect(metadata.priorityActions).toEqual([1]);
    expect(metadata.avoidActions).toEqual([]);
  });

  test('does not prioritize partner captures on home entrance squares', () => {
    const wrapper = buildWrapper({
      id: 'p2_1',
      playerId: 2,
      completed: false,
      inPenaltyZone: false,
      inHomeStretch: false,
      position: { row: 18, col: 14 }
    }, 'partnerCapture');

    const metadata = wrapper.getFixedPlayActions(0, [1]);

    expect(metadata.priorityActions).toEqual([]);
    expect(metadata.avoidActions).toEqual([]);
  });

  test('prioritizes parking an own piece on partner start when partner is jailed', () => {
    const GameWrapper = loadGameWrapper();
    const wrapper = new GameWrapper();
    const pieces = [
      {
        id: 'p2_1',
        playerId: 2,
        completed: false,
        inPenaltyZone: false,
        inHomeStretch: false,
        position: { row: 18, col: 11 }
      },
      {
        id: 'p0_1',
        playerId: 0,
        completed: false,
        inPenaltyZone: true,
        inHomeStretch: false,
        position: { row: 2, col: 8 }
      }
    ];
    wrapper.game = {
      pieces,
      piecesPerPlayer: 5,
      partnerIdFor(playerId) {
        return playerId === 2 ? 0 : 2;
      },
      isPartner(a, b) {
        return (a === 0 && b === 2) || (a === 2 && b === 0);
      },
      cloneForSimulation() {
        const clonePieces = JSON.parse(JSON.stringify(pieces));
        return {
          pieces: clonePieces,
          makeMove(pieceId) {
            const piece = clonePieces.find(p => p.id === pieceId);
            piece.position = { row: 0, col: 8 };
            return { success: true };
          }
        };
      }
    };

    const metadata = wrapper.getFixedPlayActions(2, [1]);

    expect(metadata.priorityActions).toEqual([1]);
    expect(metadata.avoidActions).toEqual([]);
  });

  test('avoids vacating partner start when partner is jailed', () => {
    const GameWrapper = loadGameWrapper();
    const wrapper = new GameWrapper();
    const pieces = [
      {
        id: 'p2_1',
        playerId: 2,
        completed: false,
        inPenaltyZone: false,
        inHomeStretch: false,
        position: { row: 0, col: 8 }
      },
      {
        id: 'p0_1',
        playerId: 0,
        completed: false,
        inPenaltyZone: true,
        inHomeStretch: false,
        position: { row: 2, col: 8 }
      }
    ];
    wrapper.game = {
      pieces,
      piecesPerPlayer: 5,
      partnerIdFor(playerId) {
        return playerId === 2 ? 0 : 2;
      },
      isPartner(a, b) {
        return (a === 0 && b === 2) || (a === 2 && b === 0);
      },
      cloneForSimulation() {
        const clonePieces = JSON.parse(JSON.stringify(pieces));
        return {
          pieces: clonePieces,
          makeMove(pieceId) {
            const piece = clonePieces.find(p => p.id === pieceId);
            piece.position = { row: 0, col: 9 };
            return { success: true };
          }
        };
      }
    };

    const metadata = wrapper.getFixedPlayActions(2, [1]);

    expect(metadata.priorityActions).toEqual([]);
    expect(metadata.avoidActions).toEqual([1]);
  });

});
