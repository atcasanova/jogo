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

  test('setCustomTeams reorders players across from partners', () => {
    const game = new Game('customTeams');
    game.addPlayer('1', 'A');
    game.addPlayer('2', 'B');
    game.addPlayer('3', 'C');
    game.addPlayer('4', 'D');

    const teams = [
      [game.players[0].id, game.players[1].id],
      [game.players[2].id, game.players[3].id]
    ];

    game.setCustomTeams(teams);

    expect(game.players.map(p => p.name)).toEqual(['A', 'C', 'B', 'D']);
    game.players.forEach((p, idx) => {
      expect(p.position).toBe(idx);
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

  test('leavePenaltyZone cannot capture partner when entrance is blocked', () => {
    const game = new Game('room9b');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.setupTeams();

    const leaving = game.pieces.find(p => p.id === 'p3_1');
    const partner = game.pieces.find(p => p.id === 'p1_1');
    const blocker = game.pieces.find(p => p.id === 'p1_2');

    partner.inPenaltyZone = false;
    partner.position = { row: 10, col: 0 };

    blocker.inPenaltyZone = false;
    blocker.position = { row: 4, col: 18 };

    expect(() => game.leavePenaltyZone(leaving)).toThrow();
  });

  test('leavePenaltyZone allows chain capture to own entrance', () => {
    const game = new Game('chain1');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.setupTeams();

    const leaving = game.pieces.find(p => p.id === 'p3_1');
    const partner = game.pieces.find(p => p.id === 'p1_1');
    const captPiece = game.pieces.find(p => p.id === 'p3_2');
    const opponent = game.pieces.find(p => p.id === 'p0_1');

    partner.inPenaltyZone = false;
    partner.position = { row: 10, col: 0 };

    captPiece.inPenaltyZone = false;
    captPiece.position = { row: 4, col: 18 };

    opponent.inPenaltyZone = false;
    opponent.position = { row: 14, col: 0 };

    const result = game.leavePenaltyZone(leaving);

    expect(result.success).toBe(true);
    expect(partner.position).toEqual({ row: 4, col: 18 });
    expect(captPiece.position).toEqual({ row: 14, col: 0 });
    expect(opponent.inPenaltyZone).toBe(true);
  });

  test('landing exactly on home entrance does not offer entry option', () => {
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

    expect(result.success).toBe(true);
    expect(result.action).toBe('move');
    expect(piece.position).toEqual({ row: 0, col: 4 });
    expect(piece.inHomeStretch).toBe(false);
  });

  test('movePieceForward can enter home stretch when overshooting', () => {
    const game = new Game('room10b');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.setupTeams();

    const piece = game.pieces.find(p => p.id === 'p0_1');
    piece.inPenaltyZone = false;
    piece.position = { row: 0, col: 0 };

    const result = game.movePieceForward(piece, 5, true);

    expect(result.success).toBe(true);
    expect(piece.inHomeStretch).toBe(true);
    expect(piece.position).toEqual({ row: 1, col: 4 });
  });

  test('makeSpecialMove moves one piece seven steps', () => {
    const game = new Game('room11');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.startGame();

    const piece = game.pieces.find(p => p.id === 'p0_1');
    piece.inPenaltyZone = false;
    piece.position = { row: 0, col: 0 };

    game.players[0].cards.push({ suit: '♠', value: '7' });
    const before = game.players[0].cards.length;

    const initial = { ...piece.position };
    game.makeSpecialMove([{ pieceId: piece.id, steps: 7, enterHome: false }]);

    expect(piece.position).not.toEqual(initial);
    expect(game.players[0].cards.length).toBe(before - 1);
  });

  test('makeSpecialMove splits steps between two pieces', () => {
    const game = new Game('room12');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.startGame();

    const piece1 = game.pieces.find(p => p.id === 'p0_1');
    const piece2 = game.pieces.find(p => p.id === 'p0_2');
    piece1.inPenaltyZone = false;
    piece2.inPenaltyZone = false;
    piece1.position = { row: 0, col: 0 };
    piece2.position = { row: 0, col: 10 };

    game.players[0].cards.push({ suit: '♠', value: '7' });
    const before = game.players[0].cards.length;

    const pos1 = { ...piece1.position };
    const pos2 = { ...piece2.position };
    game.makeSpecialMove([
      { pieceId: piece1.id, steps: 3 },
      { pieceId: piece2.id, steps: 4 }
    ]);

    expect(piece1.position).not.toEqual(pos1);
    expect(piece2.position).not.toEqual(pos2);
    expect(game.players[0].cards.length).toBe(before - 1);
  });

  test('makeSpecialMove offers home entry option', () => {
    const game = new Game('room13');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.startGame();

    const piece = game.pieces.find(p => p.id === 'p0_1');
    piece.inPenaltyZone = false;
    piece.position = { row: 0, col: 0 };

    game.players[0].cards.push({ suit: '♠', value: '7' });
    const len = game.players[0].cards.length;

    const result = game.makeSpecialMove([{ pieceId: piece.id, steps: 7 }]);

    expect(result.action).toBe('homeEntryChoice');
    expect(result.success).toBe(false);
    expect(game.players[0].cards.length).toBe(len);
  });

  test('makeSpecialMove can move piece into home stretch', () => {
    const game = new Game('room14');
    game.addPlayer('1', 'Alice');
    game.addPlayer('2', 'Bob');
    game.addPlayer('3', 'Carol');
    game.addPlayer('4', 'Dave');
    game.startGame();

    const piece = game.pieces.find(p => p.id === 'p0_1');
    piece.inPenaltyZone = false;
    piece.position = { row: 0, col: 0 };

    game.players[0].cards.push({ suit: '♠', value: '7' });

    const result = game.makeSpecialMove([{ pieceId: piece.id, steps: 7, enterHome: true }]);

    expect(result.success).toBe(true);
    expect(piece.inHomeStretch).toBe(true);
    expect(piece.position).toEqual({ row: 3, col: 4 });
  });

  test('moveToSelectedPosition rejects targets in home stretch', () => {
    const game = new Game('roomJoker');
    const mover = game.pieces.find(p => p.id === 'p0_1');
    const target = game.pieces.find(p => p.id === 'p1_1');

    mover.inPenaltyZone = false;
    mover.position = { row: 0, col: 8 };

    target.inPenaltyZone = false;
    target.inHomeStretch = true;
    target.position = { row: 4, col: 17 };

    expect(() => game.moveToSelectedPosition(mover, target.id)).toThrow();
  });

  test('executeMove cannot use Joker to leave home stretch', () => {
    const game = new Game('jokerHome');
    const mover = game.pieces.find(p => p.id === 'p0_1');
    const target = game.pieces.find(p => p.id === 'p1_1');

    mover.inPenaltyZone = false;
    mover.inHomeStretch = true;
    mover.position = { row: 1, col: 4 };

    target.inPenaltyZone = false;
    target.position = { row: 0, col: 8 };

    expect(() => game.executeMove(mover, { value: 'JOKER' })).toThrow();
    expect(() => game.moveToSelectedPosition(mover, target.id)).toThrow();
  });

  test('movePieceForward cannot move piece in penalty zone', () => {
    const game = new Game('penaltyMove');
    const piece = game.pieces.find(p => p.id === 'p0_1');
    expect(() => game.movePieceForward(piece, 3)).toThrow();
  });

  test('hasAnyValidMove is false with 7 when all pieces penalized', () => {
    const game = new Game('penaltyHand');
    game.addPlayer('1', 'A');
    game.addPlayer('2', 'B');
    game.addPlayer('3', 'C');
    game.addPlayer('4', 'D');
    const player = game.players[0];
    player.cards = [{ suit: '♠', value: '7' }];
    expect(game.hasAnyValidMove(player.position)).toBe(false);
  });

  test('player can control partner pieces after all in home stretch', () => {
    const game = new Game('partnerPlay');
    game.addPlayer('1', 'A');
    game.addPlayer('2', 'B');
    game.addPlayer('3', 'C');
    game.addPlayer('4', 'D');
    game.setupTeams();
    const p0Pieces = game.pieces.filter(p => p.playerId === 0);
    p0Pieces.forEach((p, idx) => {
      p.inPenaltyZone = false;
      p.inHomeStretch = true;
      p.position = { row: 1 + idx, col: 4 };
    });
    const partnerPiece = game.pieces.find(p => p.id === 'p2_1');
    partnerPiece.inPenaltyZone = false;
    partnerPiece.position = { row: 0, col: 0 };

    game.players[0].cards = [{ suit: '♠', value: 'A' }];
    game.currentPlayerIndex = 0;

    expect(game.hasAnyValidMove(0)).toBe(true);
    game.makeMove(partnerPiece.id, 0);
    expect(partnerPiece.position).toEqual({ row: 0, col: 1 });
  });
});
