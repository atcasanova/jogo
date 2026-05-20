const { isIntermediateJokerReplayEntry, replayHistoryForSave } = require('../replay_utils');

describe('replayHistoryForSave', () => {
  const players = [
    { id: 'p1', name: 'Alice', position: 0, cards: [{ value: 'JOKER' }] },
    { id: 'p2', name: 'Bob', position: 1, cards: [] }
  ];

  test('hides joker snapshots captured before the turn advances', () => {
    const intermediate = {
      move: 'Alice jogou um C',
      state: {
        players,
        currentPlayerIndex: 0,
        pieces: [{ id: 'p0_1', inHomeStretch: true }, { id: 'p1_1', inPenaltyZone: true }]
      }
    };
    const normal = {
      move: 'Bob jogou um 5',
      state: { players, currentPlayerIndex: 0 }
    };

    expect(isIntermediateJokerReplayEntry(intermediate)).toBe(true);
    expect(replayHistoryForSave([intermediate, normal])).toEqual([normal]);
  });

  test('keeps final joker snapshots after the turn has advanced', () => {
    const finalJoker = {
      move: 'Alice jogou um C',
      state: {
        players,
        currentPlayerIndex: 1,
        discardPile: [{ value: 'JOKER' }]
      }
    };

    expect(isIntermediateJokerReplayEntry(finalJoker)).toBe(false);
    expect(replayHistoryForSave([finalJoker])).toEqual([finalJoker]);
  });

  test('hides intermediate snapshots for card 7 before the turn advances', () => {
    const intermediateSeven = {
      move: 'Alice jogou um 7',
      state: {
        players,
        currentPlayerIndex: 0,
        pieces: [{ id: 'p0_1', inHomeStretch: true }]
      }
    };
    const finalSeven = {
      move: 'Alice jogou um 7',
      state: {
        players,
        currentPlayerIndex: 1,
        discardPile: [{ value: '7' }]
      }
    };

    expect(replayHistoryForSave([intermediateSeven, finalSeven])).toEqual([finalSeven]);
  });
});
