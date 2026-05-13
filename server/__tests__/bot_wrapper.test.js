const BotWrapper = require('../bot_wrapper');
const { Game } = require('../game');

function buildCaptureWrapper(capturedPiece, captureAction = 'opponentCapture') {
  const wrapper = new BotWrapper(null);
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
        makeMove(pieceId) {
          if (pieceId !== 'p0_1') {
            return { success: true };
          }
          return { success: true, captures: [{ pieceId: capturedPiece.id, action: captureAction }] };
        }
      };
    }
  };
  return wrapper;
}

describe('BotWrapper live fixed play constraints', () => {
  test('prioritizes fixed plays before sending actions to human-game bots', () => {
    const wrapper = buildCaptureWrapper({
      id: 'p1_1',
      playerId: 1,
      completed: false,
      inPenaltyZone: false,
      inHomeStretch: false,
      position: { row: 0, col: 15 }
    });

    expect(wrapper.applyActionConstraints(0, [1, 2])).toEqual([1]);
  });

  test('filters avoidable opponent-start captures when another action exists', () => {
    const wrapper = buildCaptureWrapper({
      id: 'p1_1',
      playerId: 1,
      completed: false,
      inPenaltyZone: false,
      inHomeStretch: false,
      position: { row: 8, col: 18 }
    });

    expect(wrapper.applyActionConstraints(0, [1, 2])).toEqual([2]);
  });

  test('keeps avoidable actions when they are forced', () => {
    const wrapper = buildCaptureWrapper({
      id: 'p1_1',
      playerId: 1,
      completed: false,
      inPenaltyZone: false,
      inHomeStretch: false,
      position: { row: 8, col: 18 }
    });

    expect(wrapper.applyActionConstraints(0, [1])).toEqual([1]);
  });

  test('filters moves that take a piece out of home-stretch reach when another move exists', () => {
    const wrapper = new BotWrapper(null);
    const pieces = [
      {
        id: 'p0_1',
        playerId: 0,
        completed: false,
        inPenaltyZone: false,
        inHomeStretch: false,
        position: { row: 0, col: 4 }
      },
      {
        id: 'p0_2',
        playerId: 0,
        completed: false,
        inPenaltyZone: false,
        inHomeStretch: false,
        position: { row: 0, col: 15 }
      }
    ];
    wrapper.game = {
      pieces,
      players: [{ cards: [{ suit: '♠', value: '6' }] }],
      piecesPerPlayer: 5,
      partnerIdFor() {
        return 2;
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
            if (pieceId === 'p0_1') {
              piece.position = { row: 0, col: 10 };
            } else {
              piece.position = { row: 0, col: 16 };
            }
            return { success: true };
          }
        };
      }
    };

    expect(wrapper.applyActionConstraints(0, [1, 2])).toEqual([2]);
  });

  test('keeps home-stretch reach exit moves when they are forced', () => {
    const wrapper = new BotWrapper(null);
    const pieces = [
      {
        id: 'p0_1',
        playerId: 0,
        completed: false,
        inPenaltyZone: false,
        inHomeStretch: false,
        position: { row: 0, col: 4 }
      }
    ];
    wrapper.game = {
      pieces,
      players: [{ cards: [{ suit: '♠', value: '6' }] }],
      piecesPerPlayer: 5,
      partnerIdFor() {
        return 2;
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
            piece.position = { row: 0, col: 10 };
            return { success: true };
          }
        };
      }
    };

    expect(wrapper.applyActionConstraints(0, [1])).toEqual([1]);
  });

  test('keeps only the deepest home-stretch entry action', () => {
    const game = new Game('deepest-entry');
    game.addPlayer('1', 'Alice', true);
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.setupTeams();
    game.isActive = true;

    const player = game.players[0];
    player.cards = [
      { suit: '♠', value: '2' },
      { suit: '♣', value: '5' }
    ];

    const mover = game.pieces.find(p => p.id === 'p0_1');
    mover.inPenaltyZone = false;
    mover.position = { row: 0, col: 4 };

    const wrapper = new BotWrapper(game);

    expect(wrapper.getValidActions(0)).toEqual([11]);
  });


  test('keeps only deepest available home-stretch move action', () => {
    const game = new Game('home-stretch-progress');
    game.addPlayer('1', 'Alice', true);
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.setupTeams();
    game.isActive = true;

    const player = game.players[0];
    player.cards = [
      { suit: '♠', value: 'A' },
      { suit: '♣', value: '2' },
      { suit: '♦', value: '5' }
    ];

    const homeMover = game.pieces.find(p => p.id === 'p0_1');
    homeMover.inPenaltyZone = false;
    homeMover.inHomeStretch = true;
    homeMover.position = { ...game.homeStretchForPlayer(0)[0] };

    const boardMover = game.pieces.find(p => p.id === 'p0_2');
    boardMover.inPenaltyZone = false;
    boardMover.position = { row: 0, col: 9 };

    const wrapper = new BotWrapper(game);

    expect(wrapper.getValidActions(0)).toEqual([11]);
  });

  test('prioritizes parking an own piece on partner start when partner is jailed', () => {
    const wrapper = new BotWrapper(null);
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

    expect(wrapper.applyActionConstraints(2, [1, 2])).toEqual([1]);
  });
});
