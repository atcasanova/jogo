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

  test('startGame gives fixed hands when DEBUG is true', () => {
    process.env.DEBUG = 'true';
    const game = new Game('roomDebug');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.startGame();
    const expectedValues = ['K', 'Q', 'T', '8', 'JOKER'];
    game.players.forEach(p => {
      expect(p.cards.map(c => c.value)).toEqual(expectedValues);
    });
    const expectedDeckSize = 108 - game.players.length * 5;
    expect(game.deck.length).toBe(expectedDeckSize);
    process.env.DEBUG = 'false';
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

  test('enterHomeStretch blocks movement past occupied squares', () => {
    const game = new Game('room5');
    const piece = game.pieces.find(p => p.id === 'p0_1');
    const blocker = game.pieces.find(p => p.id === 'p0_2');

    piece.inPenaltyZone = false;
    piece.position = { row: 0, col: 4 };

    blocker.inPenaltyZone = false;
    blocker.inHomeStretch = true;
    blocker.position = { row: 2, col: 4 };

    expect(() => game.enterHomeStretch(piece, 3)).toThrow();
  });

  test('moveInHomeStretch cannot pass another piece', () => {
    const game = new Game('room6');
    const mover = game.pieces.find(p => p.id === 'p0_1');
    const blocker = game.pieces.find(p => p.id === 'p0_2');

    mover.inPenaltyZone = false;
    mover.inHomeStretch = true;
    mover.position = { row: 1, col: 4 };

    blocker.inPenaltyZone = false;
    blocker.inHomeStretch = true;
    blocker.position = { row: 3, col: 4 };

    expect(() => game.moveInHomeStretch(mover, 3)).toThrow();
  });

  test('leavePenaltyZone is blocked by own piece', () => {
    const game = new Game('room7');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.setupTeams();

    const leaving = game.pieces.find(p => p.id === 'p0_1');
    const blocker = game.pieces.find(p => p.id === 'p0_2');

    blocker.inPenaltyZone = false;
    blocker.position = { row: 0, col: 8 };

    expect(() => game.leavePenaltyZone(leaving)).toThrow();
  });

  test('leavePenaltyZone captures opponent on exit', () => {
    const game = new Game('room8');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.setupTeams();

    const leaving = game.pieces.find(p => p.id === 'p0_1');
    const opponent = game.pieces.find(p => p.id === 'p1_1');

    opponent.inPenaltyZone = false;
    opponent.position = { row: 0, col: 8 };

    const result = game.leavePenaltyZone(leaving);

    expect(result.action).toBe('leavePenalty');
    expect(result.captures).toHaveLength(1);
    expect(result.captures[0].action).toBe('opponentCapture');
    expect(opponent.inPenaltyZone).toBe(true);
    expect(leaving.position).toEqual({ row: 0, col: 8 });
  });

  test('leavePenaltyZone captures partner on exit', () => {
    const game = new Game('room9');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.setupTeams();

    const leaving = game.pieces.find(p => p.id === 'p0_1');
    const partner = game.pieces.find(p => p.id === 'p2_1');

    partner.inPenaltyZone = false;
    partner.position = { row: 0, col: 8 };

    const result = game.leavePenaltyZone(leaving);

    expect(result.action).toBe('leavePenalty');
    expect(result.captures).toHaveLength(1);
    expect(result.captures[0].action).toBe('partnerCapture');
    expect(partner.position).toEqual({ row: 18, col: 14 });
    expect(leaving.position).toEqual({ row: 0, col: 8 });
  });

  test('landing exactly on home entrance stops on the board', () => {
    const game = new Game('room10');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.setupTeams();

    const piece = game.pieces.find(p => p.id === 'p0_1');
    piece.inPenaltyZone = false;
    piece.position = { row: 0, col: 0 };

    const result = game.movePieceForward(piece, 4);

    expect(result.action).toBe('move');
    expect(piece.inHomeStretch).toBe(false);
    expect(piece.position).toEqual({ row: 0, col: 4 });
  });
});
