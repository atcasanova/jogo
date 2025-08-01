// file: server/game.js
const { shuffle, createDeck, boardLayout } = require('./utils');

class Game {
  constructor(roomId, piecesPerPlayer = 5) {
    this.roomId = roomId;
    this.piecesPerPlayer = piecesPerPlayer;
    this.players = [];
    this.teams = [[], []]; // Equipe 0 e Equipe 1
    this.deck = [];
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.isActive = false;
    this.board = this.createBoard();
    this.pieces = this.initializePieces();
    this.cleanupTimer = null;
    this.pendingSpecialMove = null;
    this.history = [];
    this.homeStretchAnnounced = [false, false, false, false];
    this.movesToFirstComplete = null;
    this.gameEnded = false;
    this.winningTeam = null;
    this.stats = {
      captures: [0, 0, 0, 0],
      roundsWithoutPlay: [0, 0, 0, 0],
      jokersPlayed: [0, 0, 0, 0],
      timesCaptured: [0, 0, 0, 0]
    };
  }

  createBoard() {
    return boardLayout;
  }

  initializePieces() {
    // Inicializar peças nas zonas de castigo
    const pieces = [];
    const penaltyZones = [
      // Topo (jogador 0)
      [{row: 2, col: 8}, {row: 1, col: 8}, {row: 3, col: 8}, {row: 2, col: 7}, {row: 2, col: 9}],
      // Direita (jogador 1)
      [{row: 8, col: 16}, {row: 7, col: 16}, {row: 9, col: 16}, {row: 8, col: 15}, {row: 8, col: 17}],
      // Fundo (jogador 2)
      [{row: 16, col: 10}, {row: 15, col: 10}, {row: 17, col: 10}, {row: 16, col: 9}, {row: 16, col: 11}],
      // Esquerda (jogador 3)
      [{row: 10, col: 2}, {row: 9, col: 2}, {row: 11, col: 2}, {row: 10, col: 1}, {row: 10, col: 3}]
    ];

    for (let playerId = 0; playerId < 4; playerId++) {
      for (let pieceId = 1; pieceId <= this.piecesPerPlayer; pieceId++) {
        pieces.push({
          id: `p${playerId}_${pieceId}`,
          playerId,
          pieceId,
          position: penaltyZones[playerId][pieceId - 1],
          inPenaltyZone: true,
          inHomeStretch: false,
          completed: false
        });
      }
    }
    return pieces;
  }

  addPlayer(id, name) {
    if (process.env.DEBUG === 'true') {
      console.log(`Tentando adicionar jogador ${name} (${id}) à sala ${this.roomId}`);
    }
    
    if (this.players.length >= 4) {
      if (process.env.DEBUG === 'true') {
        console.log(`ERRO: Sala ${this.roomId} já está cheia`);
      }
      return false;
    }
    
    // Verificar se o jogador já existe
    const existingPlayer = this.players.find(p => p.id === id || p.name === name);
    if (existingPlayer) {
      if (process.env.DEBUG === 'true') {
        console.log(`Jogador ${name} já existe na sala`);
      }
      return false;
    }
    
    this.players.push({
      id,
      name,
      cards: [],
      position: this.players.length // 0, 1, 2 ou 3
    });
    
    if (process.env.DEBUG === 'true') {
      console.log(`Jogador ${name} adicionado com sucesso. Total: ${this.players.length}`);
    }
    return true;
  }

  removePlayer(id) {
    const index = this.players.findIndex(p => p.id === id);
    if (index !== -1) {
      this.players.splice(index, 1);
      return true;
    }
    return false;
  }

  clearCleanupTimer() {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  setupTeams() {
    // Por padrão, jogadores frente a frente são parceiros
    // 0 e 2 formam uma equipe, 1 e 3 formam outra
    this.teams = [
      [this.players[0], this.players[2]],
      [this.players[1], this.players[3]]
    ];
  }

  setCustomTeams(teamConfig) {
    // teamConfig deve ser um array com dois arrays, cada um contendo os IDs dos jogadores em cada equipe
    const team0 = teamConfig[0].map(id => this.players.find(p => p.id === id));
    const team1 = teamConfig[1].map(id => this.players.find(p => p.id === id));

    if (team0.length === 2 && team1.length === 2) {
      // Reorganizar jogadores para que parceiros fiquem frente a frente
      const ordered = [team0[0], team1[0], team0[1], team1[1]];
      ordered.forEach((p, idx) => {
        p.position = idx;
      });

      this.players = ordered;
      this.pieces = this.initializePieces();
      this.teams = [team0, team1];
      return true;
    }
    return false;
  }

// No arquivo game.js do servidor
  startGame() {
    if (process.env.DEBUG === 'true') {
      console.log(`Iniciando jogo. Jogadores: ${this.players.length}`);
    }

    this.homeStretchAnnounced = [false, false, false, false];

  // Criar e embaralhar o deck
  this.deck = shuffle(createDeck());
  if (process.env.DEBUG === 'true') {
    console.log(`Deck criado com ${this.deck.length} cartas`);
  }

  this.discardPile = [];

  const debug = process.env.DEBUG === 'true';

  if (debug) {
    const fixedValues = ['K', 'Q', '7', '8', 'JOKER'];
    for (const player of this.players) {
      player.cards = [];
      for (const value of fixedValues) {
        const index = this.deck.findIndex(c => c.value === value);
        if (index !== -1) {
          player.cards.push(this.deck.splice(index, 1)[0]);
        }
      }
      if (process.env.DEBUG === 'true') {
        console.log(`Modo debug: cartas fixas distribuídas para ${player.name}`);
      }
    }
  } else {
    // Distribuir 5 cartas para cada jogador
    for (const player of this.players) {
      player.cards = this.deck.splice(0, 5);
      if (process.env.DEBUG === 'true') {
        console.log(`Distribuídas 5 cartas para ${player.name}`);
      }
    }
  }
  
  // Sempre começar com o jogador 0 (p1)
  this.currentPlayerIndex = 0;
  if (process.env.DEBUG === 'true') {
    console.log(`Primeiro jogador escolhido: índice ${this.currentPlayerIndex}`);
  }
  
  // Garantir que os times estejam definidos
  if (this.teams[0].length !== 2 || this.teams[1].length !== 2) {
    this.setupTeams();
  }
  if (process.env.DEBUG === 'true') {
    console.log(`Times definidos: ${this.teams[0][0].name}/${this.teams[0][1].name} vs ${this.teams[1][0].name}/${this.teams[1][1].name}`);
  }
  
  this.isActive = true;
  this.gameEnded = false;
  this.winningTeam = null;
  if (process.env.DEBUG === 'true') {
    console.log(`Jogo marcado como ativo`);
  }
}

  resetForNewGame() {
    // Reconfigurar tabuleiro e peças para uma nova partida mantendo os mesmos jogadores
    this.board = this.createBoard();
    this.pieces = this.initializePieces();
    this.discardPile = [];
    this.deck = [];
    this.currentPlayerIndex = 0;
    this.isActive = false;
    this.pendingSpecialMove = null;
    this.history = [];
    this.homeStretchAnnounced = [false, false, false, false];
    this.movesToFirstComplete = null;
    this.gameEnded = false;
    this.winningTeam = null;
    this.stats = {
      captures: [0, 0, 0, 0],
      roundsWithoutPlay: [0, 0, 0, 0],
      jokersPlayed: [0, 0, 0, 0],
      timesCaptured: [0, 0, 0, 0]
    };
    for (const player of this.players) {
      player.cards = [];
    }
  }

  endGame() {
    this.isActive = false;
    this.gameEnded = true;
  }

  getCurrentPlayer() {
    if (process.env.DEBUG === 'true') {
      console.log(`Obtendo jogador atual. Índice: ${this.currentPlayerIndex}, Total de jogadores: ${this.players.length}`);
    }
    
    if (this.currentPlayerIndex === undefined || 
        this.currentPlayerIndex < 0 || 
        this.currentPlayerIndex >= this.players.length) {
      if (process.env.DEBUG === 'true') {
        console.log(`ERRO: Índice de jogador atual inválido: ${this.currentPlayerIndex}`);
      }
      return null;
    }
    
    const player = this.players[this.currentPlayerIndex];
    if (process.env.DEBUG === 'true') {
      console.log(`Jogador atual: ${player ? player.name : 'null'}`);
    }
    return player;
  }

  drawCard() {
    // Se o deck estiver vazio, reembaralhar o monte de descartes
    if (this.deck.length === 0) {
      if (this.discardPile.length === 0) {
        throw new Error("Não há mais cartas disponíveis");
      }
      this.deck = shuffle([...this.discardPile]);
      this.discardPile = [];
    }
    
    return this.deck.pop();
  }

   // No arquivo game.js do servidor - Adicione este método
  discardCard(cardIndex) {
  const player = this.getCurrentPlayer();
  
  if (!player) {
    throw new Error("Jogador atual não encontrado");
  }
  
  if (cardIndex < 0 || cardIndex >= player.cards.length) {
    throw new Error("Índice de carta inválido");
  }
  
  const card = player.cards[cardIndex];

  // Verificar se todas as peças estão no castigo
  const playerPieces = this.pieces.filter(p => p.playerId === player.position);
  const allInPenalty = playerPieces.every(p => p.inPenaltyZone);

  const hasMove = this.hasAnyValidMove(player.position);

  // Se todas as peças estão no castigo e a carta é A, K, Q ou J, tentar sair do castigo
  if (allInPenalty && ['A', 'K', 'Q', 'J'].includes(card.value)) {
    // Encontrar a primeira peça no castigo
    const firstPenaltyPiece = playerPieces.find(p => p.inPenaltyZone);
    if (firstPenaltyPiece) {
      // Descartar a carta
      this.discardPile.push(card);
      player.cards.splice(cardIndex, 1);
      // Sair do castigo com esta peça
      const result = this.leavePenaltyZone(firstPenaltyPiece);

      // Passar a vez para o próximo jogador
      this.nextTurn();

      this.history.push(`${player.name} saiu do castigo`);
      return result;
    }
  }

  // Se todas as peças estão no castigo e a carta não é A, K, Q ou J, permitir descarte
  if (allInPenalty && !['A', 'K', 'Q', 'J'].includes(card.value)) {
    // Descartar a carta
    this.discardPile.push(card);
    player.cards.splice(cardIndex, 1);

    this.stats.roundsWithoutPlay[player.position]++;

    // Passar para o próximo jogador
    this.nextTurn();

    const msg = `${player.name} descartou um ${card.value === 'JOKER' ? 'C' : card.value}`;
    this.history.push(msg);
    return { success: true, action: 'discard' };
  }

  // Se nem todas as peças estão no castigo, verificar se o jogador tem peças fora
  if (!allInPenalty) {
    if (hasMove) {
      throw new Error("Você ainda tem jogadas disponíveis");
    }
    // Não possui movimentos válidos, permitir descarte
    this.discardPile.push(card);
    player.cards.splice(cardIndex, 1);

    // Contabilizar rodada sem jogada efetiva
    this.stats.roundsWithoutPlay[player.position]++;

    this.nextTurn();

    const dMsg = `${player.name} descartou um ${card.value === 'JOKER' ? 'C' : card.value}`;
    this.history.push(dMsg);
    return { success: true, action: 'discard' };
  }

  throw new Error("Você deve usar A, K, Q ou J para sair do castigo ou ter peças fora do castigo para usar outras cartas");
}


// No arquivo server.js - Adicione este evento
  makeMove(pieceId, cardIndex, enterHome = null) {
    const player = this.getCurrentPlayer();
    const card = player.cards[cardIndex];
    
    if (!card) {
      throw new Error("Carta inválida");
    }
    
    const piece = this.pieces.find(p => p.id === pieceId);
    
    if (!piece) {
      throw new Error("Peça inválida");
    }
    
    if (!this.canControlPiece(this.currentPlayerIndex, piece.playerId)) {
      throw new Error("Esta peça não pertence a você");
    }
    
    // Verificar se o movimento é válido e executá-lo
    const moveResult = this.executeMove(piece, card, enterHome);

    if (moveResult && (moveResult.action === 'homeEntryChoice' || moveResult.action === 'choosePosition')) {
      moveResult.cardIndex = cardIndex;
      return moveResult;
    }
    
    // Descartar a carta usada
    this.discardPile.push(card);
    player.cards.splice(cardIndex, 1);
    
    // NÃO comprar nova carta aqui - a carta já foi comprada no início do turno
    
    // Passar para o próximo jogador
    this.nextTurn();

    const msg = `${player.name} moveu ${pieceId} com ${card.value === 'JOKER' ? 'C' : card.value}`;
    this.history.push(msg);
    return moveResult;
  }

  makeSpecialMove(moves) {
    // Para a carta 7 que permite dividir o movimento
    const player = this.getCurrentPlayer();
    const cardIndex = player.cards.findIndex(c => c.value === '7');
    const card = player.cards[cardIndex];
    
    if (!card) {
      throw new Error("Você não tem uma carta 7");
    }
    
    let totalMoves = 0;
    for (const move of moves) {
      totalMoves += move.steps;
    }

    if (totalMoves !== 7) {
      throw new Error("Total de movimentos deve ser exatamente 7");
    }
    
    const moveResults = [];

    // Salvar estado antes de executar os movimentos
    const snapshot = {
      pieces: JSON.parse(JSON.stringify(this.pieces)),
      players: JSON.parse(JSON.stringify(this.players)),
      discardPile: JSON.parse(JSON.stringify(this.discardPile)),
      stats: JSON.parse(JSON.stringify(this.stats)),
      pendingSpecialMove: this.pendingSpecialMove ? JSON.parse(JSON.stringify(this.pendingSpecialMove)) : null
    };

    try {
      // Executar cada movimento
      for (let i = 0; i < moves.length; i++) {
        const move = moves[i];
        const piece = this.pieces.find(p => p.id === move.pieceId);

        const oldPosition = { ...piece.position };

        if (!piece) {
          throw new Error("Peça inválida");
        }

        if (!this.canControlPiece(this.currentPlayerIndex, piece.playerId)) {
          throw new Error("Esta peça não pertence a você");
        }

        const result = this.movePieceForward(
          piece,
          move.steps,
          Object.prototype.hasOwnProperty.call(move, 'enterHome') ? move.enterHome : null
        );

        moveResults.push({
          pieceId: piece.id,
          oldPosition,
          newPosition: { ...piece.position },
          result
        });

        if (result && result.action === 'homeEntryChoice') {
          this.pendingSpecialMove = {
            moves,
            moveResults,
            nextIndex: i,
            cardIndex
          };
          return { ...result, moveIndex: i, moves: moveResults };
        }
      }
    } catch (err) {
      // Reverter para o estado salvo
      this.pieces = snapshot.pieces;
      this.players = snapshot.players;
      this.discardPile = snapshot.discardPile;
      this.stats = snapshot.stats;
      this.pendingSpecialMove = snapshot.pendingSpecialMove;
      throw err;
    }
    
    // Remover a carta 7 da mão do jogador
    this.discardPile.push(player.cards[cardIndex]);
    player.cards.splice(cardIndex, 1);
    
    // NÃO comprar nova carta aqui - a carta já foi comprada no início do turno
    
    // Passar para o próximo jogador
    this.nextTurn();

    this.pendingSpecialMove = null;

    return { success: true, moves: moveResults };
  }

  resumeSpecialMove(enterHome) {
    if (!this.pendingSpecialMove) {
      throw new Error('Não há movimento especial pendente');
    }

    const { moves, moveResults, nextIndex, cardIndex } = this.pendingSpecialMove;
    moves[nextIndex].enterHome = enterHome;

    const snapshot = {
      pieces: JSON.parse(JSON.stringify(this.pieces)),
      players: JSON.parse(JSON.stringify(this.players)),
      discardPile: JSON.parse(JSON.stringify(this.discardPile)),
      stats: JSON.parse(JSON.stringify(this.stats)),
      pendingSpecialMove: this.pendingSpecialMove ? JSON.parse(JSON.stringify(this.pendingSpecialMove)) : null
    };

    try {
      for (let i = nextIndex; i < moves.length; i++) {
        const move = moves[i];
        const piece = this.pieces.find(p => p.id === move.pieceId);
        const oldPosition = { ...piece.position };

        const result = this.movePieceForward(
          piece,
          move.steps,
          Object.prototype.hasOwnProperty.call(move, 'enterHome') ? move.enterHome : null
        );

        if (moveResults[i]) {
          moveResults[i] = {
            pieceId: piece.id,
            oldPosition,
            newPosition: { ...piece.position },
            result
          };
        } else {
          moveResults.push({
            pieceId: piece.id,
            oldPosition,
            newPosition: { ...piece.position },
            result
          });
        }

        if (result && result.action === 'homeEntryChoice') {
          this.pendingSpecialMove = { moves, moveResults, nextIndex: i, cardIndex };
          return { ...result, moveIndex: i, moves: moveResults };
        }
      }
    } catch (err) {
      this.pieces = snapshot.pieces;
      this.players = snapshot.players;
      this.discardPile = snapshot.discardPile;
      this.stats = snapshot.stats;
      this.pendingSpecialMove = snapshot.pendingSpecialMove;
      throw err;
    }

    const player = this.getCurrentPlayer();
    this.discardPile.push(player.cards[cardIndex]);
    player.cards.splice(cardIndex, 1);

    this.nextTurn();
    this.pendingSpecialMove = null;
    return { success: true, moves: moveResults };
  }

  executeMove(piece, card, enterHome = null) {
    // Implementar regras de movimento baseadas na carta
    const value = card.value;
    
    // Peça está na zona de castigo
    if (piece.inPenaltyZone) {
      if (['A', 'K', 'Q', 'J'].includes(value)) {
        return this.leavePenaltyZone(piece);
      } else {
        throw new Error("Precisa de A, K, Q ou J para sair da zona de castigo");
      }
    }
    
    // Peça está no tabuleiro
    switch (value) {
      case 'A':
        return this.movePieceForward(piece, 1, enterHome);
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '9':
      case 'T': // 10
        return this.movePieceForward(piece, value === 'T' ? 10 : parseInt(value), enterHome);
      case '7':
        throw new Error("Carta 7 requer movimento especial");
      case '8':
        return this.movePieceBackward(piece, 8);
      case 'J':
      case 'Q':
      case 'K':
        return this.movePieceForward(piece, 10, enterHome);
      case 'JOKER':
        return this.moveToOccupiedSpace(piece);
      default:
        throw new Error("Carta inválida");
    }
  }

  leavePenaltyZone(piece) {
    // Implementar saída da zona de castigo
    const startPositions = [
      { row: 0, col: 8 },   // Jogador 0 (topo)
      { row: 8, col: 18 },  // Jogador 1 (direita)
      { row: 18, col: 10 }, // Jogador 2 (fundo)
      { row: 10, col: 0 }   // Jogador 3 (esquerda)
    ];
    const exitPosition = startPositions[piece.playerId];

    // Verificar se há alguma peça na posição de saída
    const occupyingPiece = this.pieces.find(p =>
      p.id !== piece.id &&
      p.position.row === exitPosition.row &&
      p.position.col === exitPosition.col
    );

    let captures;

    if (occupyingPiece) {
      if (occupyingPiece.playerId === piece.playerId) {
        // Não pode sair se a própria peça estiver na posição de saída
        throw new Error(
          'Não é possível sair do castigo. A posição de saída está ocupada por sua própria peça.'
        );
      }

      captures = [];
      const isPartner = this.isPartner(piece.playerId, occupyingPiece.playerId);

      if (isPartner) {
        const result = this.handlePartnerCapture(occupyingPiece, piece.playerId);
        this.stats.captures[piece.playerId]++;
        this.stats.timesCaptured[occupyingPiece.playerId]++;
        captures.push({ pieceId: occupyingPiece.id, action: 'partnerCapture', result });
      } else {
        this.sendToPenaltyZone(occupyingPiece, piece.playerId);
        this.stats.captures[piece.playerId]++;
        this.stats.timesCaptured[occupyingPiece.playerId]++;
        captures.push({ pieceId: occupyingPiece.id, action: 'opponentCapture' });
      }
    }

    piece.inPenaltyZone = false;
    piece.position = exitPosition;

    if (captures) {
      return { success: true, action: 'leavePenalty', captures };
    }

    return { success: true, action: 'leavePenalty' };
  }

  movePieceForward(piece, steps, enterHome = null) {
    // Implementar movimento no sentido horário
    if (piece.completed) {
      throw new Error("Esta peça já completou o percurso");
    }

    if (piece.inPenaltyZone) {
      throw new Error('Peça está na zona de castigo');
    }
    
    // Se a peça está no corredor de chegada
    if (piece.inHomeStretch) {
      return this.moveInHomeStretch(piece, steps);
    }
    
    const homeOption = this.checkHomeEntryOption(piece, steps);
    if (homeOption) {
      if (enterHome === true) {
        return this.enterHomeStretch(piece, homeOption.remainingSteps);
      }

      if (enterHome === null) {
        return {
          success: false,
          action: 'homeEntryChoice',
          pieceId: piece.id,
          cardSteps: steps,
          boardPosition: homeOption.boardPosition,
          homePosition: homeOption.homePosition
        };
      }
      // Se enterHome for false, continua movimentação normal
    }

    // Calcular nova posição na pista principal
    const newPosition = this.calculateNewPosition(piece.position, steps, true);

    // Verificar se vai ultrapassar peça do mesmo jogador
    if (this.wouldOverpassOwnPiece(piece, steps, true)) {
      throw new Error("Não pode ultrapassar sua própria peça");
    }


    // Verificar se deve entrar no corredor de chegada diretamente
    if (this.shouldEnterHomeStretch(piece, newPosition)) {
      const oldPosition = { ...piece.position };
      piece.position = newPosition;
      return this.checkCapture(piece, oldPosition);
    }
    
    // Mover para a nova posição
    const oldPosition = { ...piece.position };
    piece.position = newPosition;

    try {
      // Verificar se "comeu" alguma peça
      return this.checkCapture(piece, oldPosition);
    } catch (err) {
      piece.position = oldPosition;
      throw err;
    }
  }

  movePieceBackward(piece, steps) {
    // Implementar movimento no sentido anti-horário (carta 8)
    if (piece.completed || piece.inHomeStretch) {
      throw new Error("Não pode mover para trás no corredor de chegada");
    }
    // Calcular nova posição
    const newPosition = this.calculateNewPosition(piece.position, steps, false);

    // Verificar se vai ultrapassar peça do mesmo jogador
    if (this.wouldOverpassOwnPiece(piece, steps, false)) {
      throw new Error("Não pode ultrapassar sua própria peça");
    }
    
    // Mover para a nova posição
    const oldPosition = { ...piece.position };
    piece.position = newPosition;

    try {
      // Verificar se "comeu" alguma peça
      return this.checkCapture(piece, oldPosition);
    } catch (err) {
      piece.position = oldPosition;
      throw err;
    }
  }

  moveToOccupiedSpace(piece) {
    // Implementar movimento com Joker
    if (piece.inHomeStretch) {
      throw new Error("Não pode usar Joker no corredor de chegada");
    }
    const occupiedPositions = this.pieces.filter(p =>
      p.id !== piece.id &&
      p.playerId !== piece.playerId &&
      !p.completed &&
      !p.inPenaltyZone &&
      !p.inHomeStretch
    );
    
    if (occupiedPositions.length === 0) {
      throw new Error("Não há posições ocupadas para mover");
    }
    
    // Frontend deve permitir escolher para qual posição ocupada mover
    // Por enquanto, vamos apenas retornar as posições válidas
    return { 
      success: false, 
      action: 'choosePosition',
      validPositions: occupiedPositions.map(p => ({
        id: p.id,
        position: p.position
      }))
    };
  }

  moveToSelectedPosition(piece, targetPieceId) {
    const targetPiece = this.pieces.find(p => p.id === targetPieceId);

    if (piece.inHomeStretch) {
      throw new Error("Não pode usar Joker no corredor de chegada");
    }

    if (
      !targetPiece ||
      targetPiece.completed ||
      targetPiece.inPenaltyZone ||
      targetPiece.inHomeStretch
    ) {
      throw new Error("Posição inválida");
    }
    
    const oldPosition = { ...piece.position };
    piece.position = { ...targetPiece.position };

    try {
      return this.checkCapture(piece, oldPosition);
    } catch (err) {
      piece.position = oldPosition;
      throw err;
    }
  }

  calculateNewPosition(currentPos, steps, isForward) {
    // Implementar cálculo de nova posição na pista principal
    // Esta é uma implementação simplificada que precisa ser adaptada ao layout real do tabuleiro
    
    // Mapear a pista em coordenadas
    const track = this.getTrackCoordinates();
    
    // Encontrar o índice atual na pista
    let currentIndex = track.findIndex(pos => 
      pos.row === currentPos.row && pos.col === currentPos.col
    );
    
    if (currentIndex === -1) {
      // Se não estiver na pista principal, retornar posição atual
      return currentPos;
    }
    
    // Calcular novo índice
    let newIndex;
    if (isForward) {
      newIndex = (currentIndex + steps) % track.length;
    } else {
      newIndex = (currentIndex - steps + track.length) % track.length;
    }
    
    return track[newIndex];
  }

  getTrackCoordinates() {
    // Retornar array com todas as coordenadas da pista principal em ordem
    const track = [];
    
    // Linha superior (da esquerda para direita)
    for (let col = 0; col <= 18; col++) {
      track.push({row: 0, col});
    }

    // Coluna direita (de cima para baixo, excluindo cantos)
    for (let row = 1; row <= 18; row++) {
      track.push({row, col: 18});
    }

    // Linha inferior (da direita para esquerda)
    for (let col = 17; col >= 0; col--) {
      track.push({row: 18, col});
    }

    // Coluna esquerda (de baixo para cima, excluindo cantos)
    for (let row = 17; row >= 1; row--) {
      track.push({row, col: 0});
    }
    
    return track;
  }

  shouldEnterHomeStretch(piece, newPosition) {
    // Verificar se a peça deve entrar no corredor de chegada
    const entrances = [
      {row: 0, col: 4},   // Jogador 0 (topo-esquerda)
      {row: 4, col: 18},  // Jogador 1 (topo-direita)
      {row: 18, col: 14}, // Jogador 2 (fundo-direita)
      {row: 14, col: 0}   // Jogador 3 (fundo-esquerda)
    ];
    
    const entrance = entrances[piece.playerId];
    return newPosition.row === entrance.row && newPosition.col === entrance.col;
  }

  enterHomeStretch(piece, remainingSteps) {
    // Implementar entrada no corredor de chegada
    piece.inHomeStretch = true;
    
    // Definir corredores de chegada para cada jogador
    const homeStretches = [
      // Jogador 0 - topo-esquerda
      [
        {row: 1, col: 4},
        {row: 2, col: 4},
        {row: 3, col: 4},
        {row: 4, col: 4},
        {row: 5, col: 4}
      ],
      // Jogador 1 - topo-direita
      [
        {row: 4, col: 17},
        {row: 4, col: 16},
        {row: 4, col: 15},
        {row: 4, col: 14},
        {row: 4, col: 13}
      ],
      // Jogador 2 - fundo-direita
      [
        {row: 17, col: 14},
        {row: 16, col: 14},
        {row: 15, col: 14},
        {row: 14, col: 14},
        {row: 13, col: 14}
      ],
      // Jogador 3 - fundo-esquerda
      [
        {row: 14, col: 1},
        {row: 14, col: 2},
        {row: 14, col: 3},
        {row: 14, col: 4},
        {row: 14, col: 5}
      ]
    ];
    
    const homeStretch = homeStretches[piece.playerId];

    // Verificar se os passos restantes são exatos para alguma casa
    if (remainingSteps > homeStretch.length) {
      throw new Error("Movimento excede o corredor de chegada");
    }

    // Verificar se o caminho até a casa alvo está livre
    if (remainingSteps > 1 && !this.isHomeStretchPathClear(piece, 0, remainingSteps - 2)) {
      throw new Error("Caminho do corredor de chegada bloqueado");
    }

    // Mover para a casa correspondente
    const targetPosition = homeStretch[remainingSteps - 1];
    
    // Verificar se a casa está ocupada
    const occupyingPiece = this.pieces.find(p =>
      p.id !== piece.id &&
      p.position.row === targetPosition.row &&
      p.position.col === targetPosition.col &&
      !p.inPenaltyZone
    );
    
    if (occupyingPiece) {
      throw new Error("Casa de chegada já ocupada");
    }
    
    const wasCompleted = piece.completed;
    piece.position = targetPosition;
    this.syncCompletedPieces();
    if (!wasCompleted && piece.completed) {
      if (this.movesToFirstComplete === null) {
        this.movesToFirstComplete = this.history.length + 1;
      }
      this.checkWinCondition();
    }
    
    return { success: true, action: 'enterHomeStretch' };
  }

  moveInHomeStretch(piece, steps) {
    // Implementar movimento dentro do corredor de chegada
    const homeStretches = [
      // Jogador 0 - topo-esquerda
      [
        {row: 1, col: 4},
        {row: 2, col: 4},
        {row: 3, col: 4},
        {row: 4, col: 4},
        {row: 5, col: 4}
      ],
      // Jogador 1 - topo-direita
      [
        {row: 4, col: 17},
        {row: 4, col: 16},
        {row: 4, col: 15},
        {row: 4, col: 14},
        {row: 4, col: 13}
      ],
      // Jogador 2 - fundo-direita
      [
        {row: 17, col: 14},
        {row: 16, col: 14},
        {row: 15, col: 14},
        {row: 14, col: 14},
        {row: 13, col: 14}
      ],
      // Jogador 3 - fundo-esquerda
      [
        {row: 14, col: 1},
        {row: 14, col: 2},
        {row: 14, col: 3},
        {row: 14, col: 4},
        {row: 14, col: 5}
      ]
    ];
    
    const homeStretch = homeStretches[piece.playerId];
    
    // Encontrar posição atual no corredor
    let currentIndex = homeStretch.findIndex(pos => 
      pos.row === piece.position.row && pos.col === piece.position.col
    );
    
    if (currentIndex === -1) {
      throw new Error("Peça não está no corredor de chegada");
    }
    
    // Calcular nova posição
    const newIndex = currentIndex + steps;
    
    if (newIndex >= homeStretch.length) {
      throw new Error("Movimento excede o corredor de chegada");
    }
    
    // Verificar se o caminho até a casa alvo está livre
    if (newIndex - currentIndex > 1 &&
        !this.isHomeStretchPathClear(piece, currentIndex + 1, newIndex - 1)) {
      throw new Error("Caminho do corredor de chegada bloqueado");
    }

    // Verificar se a casa está ocupada
    const targetPosition = homeStretch[newIndex];
    const occupyingPiece = this.pieces.find(p =>
      p.id !== piece.id &&
      p.position.row === targetPosition.row &&
      p.position.col === targetPosition.col &&
      !p.inPenaltyZone
    );
    
    if (occupyingPiece) {
      throw new Error("Casa de chegada já ocupada");
    }
    
    const wasCompleted = piece.completed;
    piece.position = targetPosition;
    this.syncCompletedPieces();
    if (!wasCompleted && piece.completed) {
      if (this.movesToFirstComplete === null) {
        this.movesToFirstComplete = this.history.length + 1;
      }
      this.checkWinCondition();
    }
    
    return { success: true, action: 'moveInHomeStretch' };
  }

  wouldOverpassOwnPiece(piece, steps, isForward) {
    // Verificar se o movimento ultrapassaria peça do mesmo jogador
    const track = this.getTrackCoordinates();

    const startIndex = track.findIndex(pos =>
      pos.row === piece.position.row && pos.col === piece.position.col
    );

    if (startIndex === -1) {
      // Peça não está na pista principal
      return false;
    }

    const direction = isForward ? 1 : -1;
    for (let i = 1; i < steps; i++) {
      const idx = (startIndex + direction * i + track.length) % track.length;
      const pos = track[idx];

      const blockingPiece = this.pieces.find(p =>
        p.id !== piece.id &&
        p.playerId === piece.playerId &&
        !p.completed &&
        !p.inPenaltyZone &&
        p.position.row === pos.row &&
        p.position.col === pos.col
      );

      if (blockingPiece) {
        return true;
      }
    }

    return false;
  }

  stepsToEntrance(piece) {
    const track = this.getTrackCoordinates();
    const entrances = [
      { row: 0, col: 4 },
      { row: 4, col: 18 },
      { row: 18, col: 14 },
      { row: 14, col: 0 }
    ];
    const entrance = entrances[piece.playerId];
    const startIndex = track.findIndex(pos => pos.row === piece.position.row && pos.col === piece.position.col);
    const entranceIndex = track.findIndex(pos => pos.row === entrance.row && pos.col === entrance.col);
    if (startIndex === -1 || entranceIndex === -1) return null;
    return (entranceIndex - startIndex + track.length) % track.length;
  }

  homeStretchForPlayer(playerId) {
    const stretches = [
      [
        { row: 1, col: 4 },
        { row: 2, col: 4 },
        { row: 3, col: 4 },
        { row: 4, col: 4 },
        { row: 5, col: 4 }
      ],
      [
        { row: 4, col: 17 },
        { row: 4, col: 16 },
        { row: 4, col: 15 },
        { row: 4, col: 14 },
        { row: 4, col: 13 }
      ],
      [
        { row: 17, col: 14 },
        { row: 16, col: 14 },
        { row: 15, col: 14 },
        { row: 14, col: 14 },
        { row: 13, col: 14 }
      ],
      [
        { row: 14, col: 1 },
        { row: 14, col: 2 },
        { row: 14, col: 3 },
        { row: 14, col: 4 },
        { row: 14, col: 5 }
      ]
    ];
    return stretches[playerId];
  }

  // Marcar como completas as peças posicionadas no ponto mais distante
  // disponível de cada corredor de chegada.
  syncCompletedPieces() {
    for (let playerId = 0; playerId < 4; playerId++) {
      const stretch = this.homeStretchForPlayer(playerId);
      if (!stretch) continue;

      for (let i = stretch.length - 1; i >= 0; i--) {
        const pos = stretch[i];
        const piece = this.pieces.find(
          p =>
            p.playerId === playerId &&
            !p.inPenaltyZone &&
            p.position.row === pos.row &&
            p.position.col === pos.col
        );

        if (piece) {
          if (!piece.completed) {
            piece.inHomeStretch = true;
            piece.completed = true;
          }
        } else {
          break;
        }
      }
    }
  }

  // Verifica se o caminho no corredor de chegada está livre entre dois índices
  isHomeStretchPathClear(piece, startIndex, endIndex) {
    const stretch = this.homeStretchForPlayer(piece.playerId);
    if (startIndex > endIndex) return true;

    for (let i = startIndex; i <= endIndex; i++) {
      const pos = stretch[i];
      const occupyingPiece = this.pieces.find(p =>
        p.id !== piece.id &&
        !p.inPenaltyZone &&
        p.position.row === pos.row &&
        p.position.col === pos.col
      );
      if (occupyingPiece) {
        return false;
      }
    }
    return true;
  }

  checkHomeEntryOption(piece, steps) {
    const stepsToEnt = this.stepsToEntrance(piece);
    if (stepsToEnt === null) return null;
    const stretch = this.homeStretchForPlayer(piece.playerId);
    if (steps > stepsToEnt) {
      const remaining = steps - stepsToEnt;
      if (remaining <= stretch.length && !this.wouldOverpassOwnPiece(piece, stepsToEnt + 1, true)) {
        const boardPos = this.calculateNewPosition(piece.position, steps, true);
        const target = stretch[remaining - 1];
        const occupyingPiece = this.pieces.find(p =>
          p.id !== piece.id &&
          p.position.row === target.row &&
          p.position.col === target.col
        );
        const pathClear = this.isHomeStretchPathClear(piece, 0, remaining - 2);
        if (!occupyingPiece && pathClear) {
          return { remainingSteps: remaining, boardPosition: boardPos, homePosition: target };
        }
      }
    }
    return null;
  }

  checkCapture(piece, oldPosition) {
    // Verificar se "comeu" alguma peça
    const capturedPieces = this.pieces.filter(
      p =>
        p.id !== piece.id &&
        !p.completed &&
        !p.inPenaltyZone &&
        !p.inHomeStretch &&
        p.position.row === piece.position.row &&
        p.position.col === piece.position.col
    );

    if (capturedPieces.length === 0) {
      return { success: true, action: 'move' };
    }

    // Não é permitido capturar a própria peça
    for (const capturedPiece of capturedPieces) {
      if (capturedPiece.playerId === piece.playerId) {
        // Reverter movimento antes de lançar o erro
        piece.position = oldPosition;
        throw new Error('Não é possível capturar sua própria peça.');
      }
    }

    const captures = [];
    
    for (const capturedPiece of capturedPieces) {
      // Verificar se é adversário ou parceiro
      const isPartner = this.isPartner(piece.playerId, capturedPiece.playerId);
      
      if (isPartner) {
        // Captura de parceiro - mover para corredor de chegada
        const result = this.handlePartnerCapture(capturedPiece, piece.playerId);
        this.stats.captures[piece.playerId]++;
        this.stats.timesCaptured[capturedPiece.playerId]++;
        captures.push({
          pieceId: capturedPiece.id,
          action: 'partnerCapture',
          result
        });
      } else {
        // Captura de adversário - mover para zona de castigo
        this.sendToPenaltyZone(capturedPiece, piece.playerId);
        this.stats.timesCaptured[capturedPiece.playerId]++;
        this.stats.captures[piece.playerId]++;
        captures.push({
          pieceId: capturedPiece.id,
          action: 'opponentCapture'
        });
      }
    }
    
    return { 
      success: true, 
      action: 'capture',
      captures
    };
  }

  handlePartnerCapture(piece, capturingPlayerId = null) {
    // Regra de captura de parceiro: a peça deve ir para a casa
    // imediatamente antes da entrada do seu corredor de chegada.

    const entrances = [
      { row: 0, col: 4 },   // Jogador 0
      { row: 4, col: 18 },  // Jogador 1
      { row: 18, col: 14 }, // Jogador 2
      { row: 14, col: 0 }   // Jogador 3
    ];

    const target = entrances[piece.playerId];

    const occupyingPiece = this.pieces.find(p =>
      p.id !== piece.id &&
      !p.completed &&
      !p.inPenaltyZone &&
      p.position.row === target.row &&
      p.position.col === target.col
    );

    if (occupyingPiece) {
      if (piece.playerId === capturingPlayerId) {
        const partner = this.partnerIdFor(capturingPlayerId);
        if (
          occupyingPiece.playerId === capturingPlayerId ||
          occupyingPiece.playerId === partner
        ) {
          throw new Error('Não é possível capturar sua própria peça.');
        }
      } else {
        if (occupyingPiece.playerId === piece.playerId) {
          throw new Error('Não é possível capturar sua própria peça.');
        }
      }
    }

    let captures;
    if (occupyingPiece) {
      captures = [];
      const isPartner = this.isPartner(piece.playerId, occupyingPiece.playerId);

      if (isPartner) {
        const result = this.handlePartnerCapture(occupyingPiece, capturingPlayerId);
        this.stats.captures[capturingPlayerId]++;
        this.stats.timesCaptured[occupyingPiece.playerId]++;
        captures.push({ pieceId: occupyingPiece.id, action: 'partnerCapture', result });
      } else {
        this.sendToPenaltyZone(occupyingPiece, capturingPlayerId);
        // Atualiza estatísticas de captura e de capturado para o adversário
        this.stats.captures[capturingPlayerId]++;
        this.stats.timesCaptured[occupyingPiece.playerId]++;
        captures.push({ pieceId: occupyingPiece.id, action: 'opponentCapture' });
      }
    }

    piece.position = target;
    piece.inHomeStretch = false;
    piece.inPenaltyZone = false;

    if (captures) {
      return { position: target, captures };
    }

    return { position: target };
  }

  sendToPenaltyZone(piece, capturingPlayerId = null) {
    // Enviar peça para zona de castigo
    const penaltyZones = [
      // Topo (jogador 0)
      [{row: 2, col: 8}, {row: 1, col: 8}, {row: 3, col: 8}, {row: 2, col: 7}, {row: 2, col: 9}],
      // Direita (jogador 1)
      [{row: 8, col: 16}, {row: 7, col: 16}, {row: 9, col: 16}, {row: 8, col: 15}, {row: 8, col: 17}],
      // Fundo (jogador 2)
      [{row: 16, col: 10}, {row: 15, col: 10}, {row: 17, col: 10}, {row: 16, col: 9}, {row: 16, col: 11}],
      // Esquerda (jogador 3)
      [{row: 10, col: 2}, {row: 9, col: 2}, {row: 11, col: 2}, {row: 10, col: 1}, {row: 10, col: 3}]
    ];
    
    const penaltyZone = penaltyZones[piece.playerId];
    
    // Encontrar primeira casa disponível na zona de castigo
    for (const pos of penaltyZone) {
      // Verificar se a casa está ocupada
      const occupyingPiece = this.pieces.find(p => 
        p.id !== piece.id && 
        p.position.row === pos.row && 
        p.position.col === pos.col
      );
      
      if (!occupyingPiece) {
        // Casa disponível
        piece.position = pos;
        piece.inPenaltyZone = true;
        piece.inHomeStretch = false;
        // Se houver jogador responsável pela captura, as estatísticas serão
        // atualizadas pela função que invocou sendToPenaltyZone.
        return;
      }
    }
    
    // Se todas as casas estiverem ocupadas, usar a primeira (situação rara)
    piece.position = penaltyZone[0];
    piece.inPenaltyZone = true;
    piece.inHomeStretch = false;
    // Da mesma forma, não incrementamos as estatísticas aqui para evitar
    // contagem dupla. O chamador é responsável por atualizar os contadores de
    // captura.
  }

  isPartner(playerId1, playerId2) {
    // Jogador não é parceiro de si mesmo
    if (playerId1 === playerId2) return false;

    // Verificar se os jogadores são parceiros usando
    // os índices atuais na lista de jogadores
    const playerObj1 = this.players[playerId1];
    const playerObj2 = this.players[playerId2];
    if (!playerObj1 || !playerObj2) return false;
    return this.teams.some(
      team => team.includes(playerObj1) && team.includes(playerObj2)
    );
  }

  hasAllPiecesInHomeStretch(playerId) {
    return this.pieces
      .filter(p => p.playerId === playerId)
      .every(p => p.inHomeStretch || p.completed);
  }

  partnerIdFor(playerId) {
    const team = this.teams.find(t => t.some(p => p.position === playerId));
    if (!team) return null;
    const partner = team.find(p => p.position !== playerId);
    return partner ? partner.position : null;
  }

  canControlPiece(controllerId, pieceOwnerId) {
    if (controllerId === pieceOwnerId) return true;
    return (
      this.hasAllPiecesInHomeStretch(controllerId) &&
      this.isPartner(controllerId, pieceOwnerId)
    );
  }

  nextTurn() {
    // Passar para o próximo jogador no sentido horário
    // (diminuindo o índice, pois os jogadores estão dispostos
    // no sentido anti-horário em relação à pista)
    this.currentPlayerIndex = (this.currentPlayerIndex + 3) % 4;
  }

  checkWinCondition() {
    // Verificar se alguma dupla venceu
    this.syncCompletedPieces();
    if (this.gameEnded) {
      return true;
    }

    for (let teamIndex = 0; teamIndex < 2; teamIndex++) {
      const team = this.teams[teamIndex];
      const playerIds = team.map(p => p.position);

      // Considerar vitória apenas quando todas as peças estiverem
      // finalizadas (completed)
      const allComplete = this.pieces
        .filter(p => playerIds.includes(p.playerId))
        .every(p => p.completed);

      if (allComplete) {
        this.gameEnded = true;
        this.winningTeam = team;
        this.isActive = false;
        return true;
      }
    }

    return false;
  }

  getWinningTeam() {
    // Retornar a equipe vencedora
    for (let teamIndex = 0; teamIndex < 2; teamIndex++) {
      const team = this.teams[teamIndex];
      const playerIds = team.map(p => p.position);

      const allComplete = this.pieces
        .filter(p => playerIds.includes(p.playerId))
        .every(p => p.completed);

      if (allComplete) {
        return team;
      }
    }

    return null;
  }

  getStatisticsSummary() {
    const stat = this.stats;
    const pick = arr => {
      const max = Math.max(...arr);
      const idx = arr.indexOf(max);
      return { idx, max };
    };

    const capt = pick(stat.captures);
    const stuck = pick(stat.roundsWithoutPlay);
    const jok = pick(stat.jokersPlayed);
    const mostCap = pick(stat.timesCaptured);

    const winners = this.getWinningTeam() || [];
    const piecesCompleted = [0, 0];
    for (const piece of this.pieces) {
      if (piece.completed) {
        const idx = this.teams.findIndex(t => t.some(p => p.position === piece.playerId));
        if (idx !== -1) piecesCompleted[idx]++;
      }
    }

    return {
      mostCaptures: {
        name: this.players[capt.idx]?.name,
        count: capt.max
      },
      mostRoundsStuck: {
        name: this.players[stuck.idx]?.name,
        count: stuck.max
      },
      mostJokers: {
        name: this.players[jok.idx]?.name,
        count: jok.max
      },
      mostCaptured: {
        name: this.players[mostCap.idx]?.name,
        count: mostCap.max
      },
      piecesCompleted,
      firstCompletionMove: this.movesToFirstComplete ?? this.history.length,
      movesPlayed: this.history.length,
      winners: winners.map(p => p.name)
    };
  }

  cloneForSimulation() {
    const clone = new Game(this.roomId, this.piecesPerPlayer);
    clone.players = JSON.parse(JSON.stringify(this.players));

    // Ensure team arrays reference the cloned player objects rather than
    // fresh copies so that helper methods relying on object identity behave
    // the same as in the main game instance.
    clone.teams = this.teams.map(team =>
      team.map(p => clone.players.find(cp => cp.id === p.id))
    );

    clone.deck = JSON.parse(JSON.stringify(this.deck));
    clone.discardPile = JSON.parse(JSON.stringify(this.discardPile));
    clone.currentPlayerIndex = this.currentPlayerIndex;
    clone.isActive = this.isActive;
    clone.gameEnded = this.gameEnded;
    clone.winningTeam = JSON.parse(JSON.stringify(this.winningTeam));
    clone.board = JSON.parse(JSON.stringify(this.board));
    clone.pieces = JSON.parse(JSON.stringify(this.pieces));
    return clone;
  }

  hasAnyValidMove(playerIndex) {
    const player = this.players[playerIndex];
    if (!player) return false;

    const pieces = this.pieces.filter(p => p.playerId === playerIndex && !p.completed);

    if (this.hasAllPiecesInHomeStretch(playerIndex)) {
      const partnerId = this.partnerIdFor(playerIndex);
      if (partnerId !== null) {
        pieces.push(
          ...this.pieces.filter(p => p.playerId === partnerId && !p.completed)
        );
      }
    }

    for (const card of player.cards) {
      if (card.value === '7') {
        // Look for valid split moves with two different pieces first
        for (const pieceA of pieces) {
          for (const pieceB of pieces) {
            if (pieceA.id === pieceB.id) continue;
            for (let s = 1; s <= 6; s++) {
              const moves = [
                { pieceId: pieceA.id, steps: s },
                { pieceId: pieceB.id, steps: 7 - s }
              ];
              const tempGame = this.cloneForSimulation();
              try {
                tempGame.makeSpecialMove(moves);
                return true;
              } catch (e) {
                continue;
              }
            }
          }
        }

        // Fallback to single piece moves
        for (const piece of pieces) {
          const tempGame = this.cloneForSimulation();
          try {
            tempGame.makeSpecialMove([{ pieceId: piece.id, steps: 7 }]);
            return true;
          } catch (e) {
            continue;
          }
        }
      } else {
        for (const piece of pieces) {
          const tempGame = this.cloneForSimulation();
          const tempPiece = tempGame.pieces.find(p => p.id === piece.id);
          try {
            tempGame.executeMove(tempPiece, card);
            return true;
          } catch (e) {
            continue;
          }
        }
      }
    }

    return false;
  }

  getValidSplits(pieceAId, pieceBId) {
    const valid = [];
    for (let s = 1; s <= 6; s++) {
      const moves = [
        { pieceId: pieceAId, steps: s },
        { pieceId: pieceBId, steps: 7 - s }
      ];
      const clone = this.cloneForSimulation();
      try {
        clone.makeSpecialMove(moves);
        valid.push(s);
      } catch (e) {
        continue;
      }
    }
    return valid;
  }

  getPlayersInfo() {
    return this.players.map(p => ({
      id: p.id,
      name: p.name,
      position: p.position
    }));
  }

  getTeamsInfo() {
    return this.teams.map(team => 
      team.map(player => ({
        id: player.id,
        name: player.name,
        position: player.position
      }))
    );
  }

  getGameState() {
    this.syncCompletedPieces();
    // Keep win status up to date whenever the state is requested
    // so training code receives the correct `gameEnded` flag.
    this.checkWinCondition();
    return {
      roomId: this.roomId,
      players: this.getPlayersInfo(),
      teams: this.getTeamsInfo(),
      currentPlayerIndex: this.currentPlayerIndex,
      pieces: this.pieces,
      discardPile: this.discardPile.length > 0 ? [this.discardPile[this.discardPile.length - 1]] : [],
      deckCount: this.deck.length,
      discardCount: this.discardPile.length,
      isActive: this.isActive,
      gameEnded: this.gameEnded,
      winningTeam: this.winningTeam,
      lastMove: this.history.length > 0 ? this.history[this.history.length - 1] : null,
      stats: this.stats
    };
  }

  getGameStateWithCards() {
    const state = this.getGameState();
    state.players = this.players.map(p => ({
      id: p.id,
      name: p.name,
      position: p.position,
      cards: p.cards
    }));
    return state;
  }
}

module.exports = { Game };

