const BotWrapper = require('../bot_wrapper');

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
