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
});
