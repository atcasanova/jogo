const { Game } = require('../game');

describe('Game class', () => {
  test('addPlayer adds players and prevents duplicates', () => {
    const game = new Game('room1');
    expect(game.addPlayer('1', 'Alice')).toBe(true);
    expect(game.addPlayer('2', 'Bob')).toBe(true);
    // attempt duplicate id and name
    expect(game.addPlayer('1', 'Alice')).toBe(false);
    expect(game.addPlayer('2', 'Bob')).toBe(false);
    expect(game.players).toHaveLength(2);
  });

  test('startGame initializes the deck, deals cards, and activates the game', () => {
    const game = new Game('room2');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.startGame();
    expect(game.isActive).toBe(true);
    const expectedDeckSize = 108 - game.players.length * 5;
    expect(game.deck.length).toBe(expectedDeckSize);
    game.players.forEach(p => {
      expect(p.cards).toHaveLength(5);
    });
  });

  test('handlePartnerCapture moves piece to entrance before home stretch', () => {
    const game = new Game('room3');
    const piece = game.pieces.find(p => p.id === 'p2_1');

    const result = game.handlePartnerCapture(piece);

    expect(result.position).toEqual({ row: 18, col: 14 });
    expect(piece.position).toEqual({ row: 18, col: 14 });
    expect(piece.inHomeStretch).toBe(false);
  });

  test('executeMove interprets Ace as one step forward', () => {
    const game = new Game('room4');
    const piece = game.pieces.find(p => p.id === 'p0_1');

    piece.inPenaltyZone = false;
    piece.position = { row: 0, col: 8 };

    const result = game.executeMove(piece, { value: 'A' });

    expect(result.action).toBe('move');
    expect(piece.position).toEqual({ row: 0, col: 9 });
  });
});
