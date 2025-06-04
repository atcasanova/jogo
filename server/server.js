// file: server/server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { nanoid } = require('nanoid');
const { Game } = require('./game');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, '../public')));

// Armazenar salas e jogos ativos
const rooms = new Map();

function logTurnState(game) {
  const player = game.getCurrentPlayer();
  if (!player) return;

  const formatPiece = p => {
    const state = p.inPenaltyZone ? 'P' : p.inHomeStretch ? 'H' : 'B';
    return `${p.id}@(${p.position.row},${p.position.col})${state}`;
  };

  const ownPieces = game.pieces
    .filter(p => p.playerId === player.position)
    .map(formatPiece)
    .join(' | ');

  const others = game.pieces
    .filter(p => p.playerId !== player.position)
    .map(formatPiece)
    .join(' | ');

  const hand = player.cards.map(c => c.value).join(' ');

  console.log(`=== Turno de ${player.name} ===`);
  console.log(`Mão: ${hand}`);
  console.log(`Suas peças: ${ownPieces}`);
  console.log(`Outros: ${others}`);
}

function logMoveDetails(player, pieceId, oldPos, result, game) {
  const piece = game.pieces.find(p => p.id === pieceId);
  if (!piece) return;
  console.log(`${player.name} moveu ${pieceId} de (${oldPos.row},${oldPos.col}) para (${piece.position.row},${piece.position.col})`);

  if (result && result.action === 'capture' && result.captures) {
    for (const c of result.captures) {
      if (c.action === 'partnerCapture') {
        const pos = c.result.position;
        console.log(`Capturou parceiro ${c.pieceId} e moveu para (${pos.row},${pos.col})`);
      } else if (c.action === 'opponentCapture') {
        console.log(`Capturou adversário ${c.pieceId} e enviou ao castigo`);
      }
    }
  } else if (result && result.action === 'leavePenalty') {
    console.log(`${pieceId} saiu do castigo`);
    if (result.captures) {
      for (const c of result.captures) {
        if (c.action === 'partnerCapture') {
          const pos = c.result.position;
          console.log(`Capturou parceiro ${c.pieceId} e moveu para (${pos.row},${pos.col})`);
        } else {
          console.log(`Capturou adversário ${c.pieceId} e enviou ao castigo`);
        }
      }
    }
  } else if (result && result.action === 'enterHomeStretch') {
    console.log(`${pieceId} entrou no corredor de chegada`);
  }
}

function launchGame(game) {
  const roomId = game.roomId;

  game.startGame();

  const gameState = game.getGameState();
  io.to(roomId).emit('gameStarted', gameState);
  logTurnState(game);

  const currentPlayer = game.getCurrentPlayer();
  if (currentPlayer && currentPlayer.id) {
    currentPlayer.cards.push(game.drawCard());
    logTurnState(game);
    io.to(currentPlayer.id).emit('yourTurn', {
      cards: currentPlayer.cards,
      canMove: game.hasAnyValidMove(currentPlayer.position)
    });
  }
}

io.on('connection', (socket) => {
  console.log('Novo usuário conectado:', socket.id);

  // Criar nova sala
  socket.on('createRoom', (playerName) => {
    const roomId = nanoid(6);
    const game = new Game(roomId);
    
    rooms.set(roomId, game);
    
    // Adicionar o criador como primeiro jogador
    game.addPlayer(socket.id, playerName);
    
    // Entrar na sala Socket.io
    socket.join(roomId);
    
    // Enviar ID da sala para o cliente
    socket.emit('roomCreated', { roomId, playerId: socket.id });
    
    // Atualizar lista de jogadores para todos na sala
    io.to(roomId).emit('updatePlayers', game.getPlayersInfo());
    
    console.log(`Sala ${roomId} criada por ${playerName}`);
  });

  // Entrar em uma sala existente
// No arquivo server.js - Substitua todo o evento joinRoom por este código
socket.on('joinRoom', ({ roomId, playerName, originalPosition, originalId }) => {
  console.log(`Tentando entrar na sala ${roomId} com o nome ${playerName} (posição original: ${originalPosition})`);
  const game = rooms.get(roomId);
  
  if (!game) {
    console.log(`ERRO: Sala ${roomId} não encontrada`);
    socket.emit('error', 'Sala não encontrada');
    return;
  }
  
  console.log(`Sala ${roomId} encontrada, jogadores atuais: ${game.players.length}`);
  
  // Se temos uma posição original, usá-la para encontrar o jogador
  if (originalPosition !== undefined && originalPosition !== null) {
    const position = parseInt(originalPosition);
    
    if (position >= 0 && position < game.players.length) {
      const player = game.players[position];
      
      if (player && player.name === playerName) {
        console.log(`Reconexão do jogador ${playerName} na posição ${position}`);

        // Cancelar limpeza da sala se estava agendada
        game.clearCleanupTimer();

        // Atualizar o ID do socket
        player.id = socket.id;
        
        // Entrar na sala Socket.io
        socket.join(roomId);
        
        // Enviar ID da sala e posição para o cliente
        socket.emit('roomJoined', { 
          roomId, 
          playerId: socket.id,
          playerName: playerName,
          playerPosition: position,
          isReconnection: true
        });
        
        // Enviar estado atual do jogo
        socket.emit('gameStateUpdate', game.getGameState());
        
        // Enviar informações específicas do jogador
        socket.emit('playerInfo', {
          playerPosition: position,
          cards: game.players[position].cards
        });
        
        // Se for a vez deste jogador, notificar
        if (game.currentPlayerIndex === position) {
          socket.emit('yourTurn', {
            cards: game.players[position].cards,
            canMove: game.hasAnyValidMove(position)
          });
        }
        
        console.log(`Jogador ${playerName} reconectado com sucesso na posição ${position}`);
        return;
      }
    }
  }
  
  // Se não encontrou pela posição, tentar pelo nome
  const existingPlayerIndex = game.players.findIndex(p => p.name === playerName);
  
  if (existingPlayerIndex !== -1) {
    console.log(`Reconexão do jogador ${playerName} na sala ${roomId}`);

    // Cancelar limpeza da sala se estava agendada
    game.clearCleanupTimer();

    // Atualizar o ID do socket para o jogador existente
    const oldId = game.players[existingPlayerIndex].id;
    game.players[existingPlayerIndex].id = socket.id;
    
    // Entrar na sala Socket.io
    socket.join(roomId);
    
    // Enviar ID da sala para o cliente
    socket.emit('roomJoined', { 
      roomId, 
      playerId: socket.id,
      playerName: playerName,
      playerPosition: existingPlayerIndex,
      isReconnection: true
    });
    
    // Enviar estado atual do jogo
    socket.emit('gameStateUpdate', game.getGameState());
    
    // Enviar informações específicas do jogador
    socket.emit('playerInfo', {
      playerPosition: existingPlayerIndex,
      cards: game.players[existingPlayerIndex].cards
    });
    
    // Se for a vez deste jogador, notificar
    if (game.currentPlayerIndex === existingPlayerIndex) {
      socket.emit('yourTurn', {
        cards: game.players[existingPlayerIndex].cards,
        canMove: game.hasAnyValidMove(existingPlayerIndex)
      });
    }
    
    console.log(`Jogador ${playerName} reconectado com sucesso`);
    return;
  }
  
  // Se não for reconexão e a sala estiver cheia, rejeitar
  if (game.players.length >= 4) {
    console.log(`ERRO: Sala ${roomId} já está cheia`);
    socket.emit('error', 'Sala cheia');
    return;
  }
  
  // Adicionar jogador ao jogo
  console.log(`Tentando adicionar jogador ${playerName} (${socket.id}) à sala ${roomId}`);
  const added = game.addPlayer(socket.id, playerName);
  
  if (!added) {
    console.log(`ERRO: Não foi possível adicionar o jogador ${playerName} à sala ${roomId}`);
    socket.emit('error', 'Não foi possível entrar na sala');
    return;
  }
  
  // Entrar na sala Socket.io
  socket.join(roomId);
  console.log(`Socket ${socket.id} entrou na sala Socket.io ${roomId}`);
  
  // Enviar ID da sala para o cliente
  socket.emit('roomJoined', { 
    roomId, 
    playerId: socket.id,
    playerName: playerName,
    playerPosition: game.players.length - 1
  });
  console.log(`Enviado evento 'roomJoined' para ${socket.id}`);
  
  // Atualizar lista de jogadores para todos na sala
  io.to(roomId).emit('updatePlayers', game.getPlayersInfo());
  console.log(`Lista de jogadores atualizada para sala ${roomId}. Total: ${game.players.length}`);
  
  console.log(`${playerName} entrou na sala ${roomId}`);
  
  // Se a sala estiver completa, avisar o criador para definir os times
  if (game.players.length === 4) {
    const creatorId = game.players[0].id;
    io.to(creatorId).emit('teamsReady');
  }
});


socket.on('discardCard', ({ roomId, cardIndex }) => {
  console.log(`Jogador ${socket.id} descartando carta ${cardIndex}`);
  const game = rooms.get(roomId);
  
  if (!game || !game.isActive) {
    socket.emit('error', 'Jogo não está ativo');
    return;
  }
  
  const currentPlayer = game.getCurrentPlayer();
  if (!currentPlayer) {
    socket.emit('error', 'Jogador atual não encontrado');
    return;
  }
  
  if (currentPlayer.id !== socket.id) {
    socket.emit('error', 'Não é sua vez');
    return;
  }
  
  if (cardIndex < 0 || cardIndex >= currentPlayer.cards.length) {
    socket.emit('error', 'Índice de carta inválido');
    return;
  }
  
  const card = currentPlayer.cards[cardIndex];
  console.log(`Jogador ${currentPlayer.name} descartando carta ${card.suit}${card.value}`);
  
  try {
    // Verificar se todas as peças estão no castigo
    const playerPieces = game.pieces.filter(p => p.playerId === currentPlayer.position);
    const allInPenalty = playerPieces.every(p => p.inPenaltyZone);
    
    // Se todas as peças estão no castigo e a carta é K, Q ou J, permitir sair do castigo
    if (allInPenalty && ['K', 'Q', 'J'].includes(card.value)) {
      // Encontrar a primeira peça no castigo
      const firstPenaltyPiece = playerPieces.find(p => p.inPenaltyZone);
      if (firstPenaltyPiece) {
        const oldPos = { ...firstPenaltyPiece.position };
        const result = game.leavePenaltyZone(firstPenaltyPiece);
        logMoveDetails(currentPlayer, firstPenaltyPiece.id, oldPos, result, game);
      }
    }
    
    // Descartar a carta
    game.discardPile.push(card);
    currentPlayer.cards.splice(cardIndex, 1);
    
    // Atualizar estado do jogo para todos
    io.to(roomId).emit('gameStateUpdate', game.getGameState());
    logTurnState(game);
    
    // Enviar cartas atualizadas para o jogador
    socket.emit('updateCards', {
      cards: currentPlayer.cards
    });
    
    // Passar para o próximo jogador
    game.nextTurn();
    
    // Notificar próximo jogador
    const nextPlayer = game.getCurrentPlayer();
    
    // Comprar uma carta para o próximo jogador
    nextPlayer.cards.push(game.drawCard());

    logTurnState(game);
    io.to(nextPlayer.id).emit('yourTurn', {
      cards: nextPlayer.cards,
      canMove: game.hasAnyValidMove(nextPlayer.position)
    });
  } catch (error) {
    console.error(`Erro ao descartar carta:`, error);
    socket.emit('error', error.message);
  }
});


  // Solicitar estado do jogo (para reconexão)
// No evento 'requestGameState' no server.js

// No arquivo server.js - Modifique o evento requestGameState
// Adicione este evento logo após o evento joinRoom
socket.on('requestGameState', ({ roomId, playerName }) => {
  console.log(`Jogador ${socket.id} solicitou estado do jogo para sala ${roomId} como ${playerName}`);
  const game = rooms.get(roomId);
  
  if (!game) {
    console.log(`ERRO: Sala ${roomId} não encontrada`);
    socket.emit('error', 'Sala não encontrada');
    return;
  }
  
  // Encontrar o jogador pelo nome
  const playerIndex = game.players.findIndex(p => p.name === playerName);
  
  if (playerIndex !== -1) {
    // Cancelar limpeza da sala se estava agendada
    game.clearCleanupTimer();

    // Atualizar o ID do socket para o jogador
    const oldId = game.players[playerIndex].id;
    game.players[playerIndex].id = socket.id;
    
    console.log(`Jogador ${playerName} (posição ${playerIndex}) reconectado`);
    
    // Enviar estado do jogo
    socket.emit('gameStateUpdate', game.getGameState());
    
    // Enviar informações específicas do jogador
    socket.emit('playerInfo', {
      playerPosition: playerIndex,
      cards: game.players[playerIndex].cards
    });
    
    // Se for a vez deste jogador, notificar
    if (game.currentPlayerIndex === playerIndex) {
      socket.emit('yourTurn', {
        cards: game.players[playerIndex].cards,
        canMove: game.hasAnyValidMove(playerIndex)
      });
    }
  } else {
    console.log(`ERRO: Jogador ${playerName} não encontrado na sala ${roomId}`);
    socket.emit('error', 'Jogador não encontrado na sala');
  }
});

socket.on('makeJokerMove', ({ roomId, pieceId, targetPieceId, cardIndex }) => {
  console.log(
    `Jogador ${socket.id} tentando mover peça ${pieceId} para posição da peça ${targetPieceId} com Joker`
  );
  const game = rooms.get(roomId);

  if (!game || !game.isActive) {
    socket.emit('error', 'Jogo não está ativo');
    return;
  }

  const currentPlayer = game.getCurrentPlayer();
  if (!currentPlayer) {
    socket.emit('error', 'Jogador atual não encontrado');
    return;
  }

  if (currentPlayer.id !== socket.id) {
    socket.emit('error', 'Não é sua vez');
    return;
  }

  try {
    const card = currentPlayer.cards[cardIndex];
    if (!card || card.value !== 'JOKER') {
      socket.emit('error', 'Esta não é uma carta Joker');
      return;
    }

    const piece = game.pieces.find(p => p.id === pieceId);
    const targetPiece = game.pieces.find(p => p.id === targetPieceId);

    if (!piece || !targetPiece) {
      socket.emit('error', 'Peça não encontrada');
      return;
    }

    if (!game.canControlPiece(currentPlayer.position, piece.playerId)) {
      socket.emit('error', 'Esta peça não pertence a você');
      return;
    }

    // Utilizar regra centralizada do jogo para mover a peça
    game.moveToSelectedPosition(piece, targetPieceId);

    // Descartar a carta Joker
    game.discardPile.push(card);
    currentPlayer.cards.splice(cardIndex, 1);

    io.to(roomId).emit('gameStateUpdate', game.getGameState());

    socket.emit('updateCards', {
      cards: currentPlayer.cards
    });

    if (game.checkWinCondition()) {
      io.to(roomId).emit('gameOver', {
        winners: game.getWinningTeam()
      });
      return;
    }

    game.nextTurn();
    const nextPlayer = game.getCurrentPlayer();
    nextPlayer.cards.push(game.drawCard());

    io.to(nextPlayer.id).emit('yourTurn', {
      cards: nextPlayer.cards,
      canMove: game.hasAnyValidMove(nextPlayer.position)
    });
  } catch (error) {
    console.error(`Erro ao processar movimento Joker:`, error);
    socket.emit('error', error.message);
  }
});


  // Definir times
  socket.on('setTeams', ({ roomId, teams }) => {
    const game = rooms.get(roomId);
    
    if (!game || game.players.length !== 4) {
      socket.emit('error', 'Não é possível definir times agora');
      return;
    }
    
    game.setCustomTeams(teams);
    io.to(roomId).emit('teamsSet', game.getTeamsInfo());

    if (!game.isActive) {
      launchGame(game);
    }
  });

  // Iniciar jogo manualmente pelo criador
  socket.on('startGame', ({ roomId }) => {
    const game = rooms.get(roomId);

    if (!game || game.players.length !== 4) {
      socket.emit('error', 'Não é possível iniciar o jogo agora');
      return;
    }

    if (game.isActive) {
      socket.emit('error', 'Jogo já está ativo');
      return;
    }

    launchGame(game);
  });

  // Jogador seleciona peça e carta
// No arquivo server.js - Modifique o evento makeMove
socket.on('makeMove', ({ roomId, pieceId, cardIndex, enterHome }) => {
  console.log(`Jogador ${socket.id} tentando mover peça ${pieceId} com carta ${cardIndex}`);
  const game = rooms.get(roomId);

  if (!game || !game.isActive) {
    socket.emit('error', 'Jogo não está ativo');
    return;
  }

  const currentPlayer = game.getCurrentPlayer();
  if (!currentPlayer) {
    socket.emit('error', 'Jogador atual não encontrado');
    return;
  }

  if (currentPlayer.id !== socket.id) {
    socket.emit('error', 'Não é sua vez');
    return;
  }

  console.log(`Jogador atual: ${currentPlayer.name}, cartas:`, currentPlayer.cards);

  if (!currentPlayer.cards || cardIndex >= currentPlayer.cards.length) {
    socket.emit('error', 'Índice de carta inválido');
    return;
  }

  try {
    const piece = game.pieces.find(p => p.id === pieceId);
    const oldPos = { ...piece.position };
    const moveResult = game.makeMove(pieceId, cardIndex, enterHome);
    logMoveDetails(currentPlayer, pieceId, oldPos, moveResult, game);

    if (moveResult && moveResult.action === 'homeEntryChoice') {
      socket.emit('homeEntryChoice', moveResult);
      return;
    }

    if (moveResult && moveResult.action === 'choosePosition') {
      socket.emit('choosePosition', {
        pieceId,
        cardIndex,
        validPositions: moveResult.validPositions
      });
      return;
    }

    // Atualizar estado do jogo para todos
    const updatedState = game.getGameState();
    io.to(roomId).emit('gameStateUpdate', updatedState);
    logTurnState(game);

    // Enviar cartas atualizadas para o jogador que fez o movimento
    socket.emit('updateCards', {
      cards: currentPlayer.cards
    });

    // Verificar se o jogo acabou
    if (game.checkWinCondition()) {
      io.to(roomId).emit('gameOver', {
        winners: game.getWinningTeam()
      });
      return;
    }

    // Notificar próximo jogador
    const nextPlayer = game.getCurrentPlayer();

    // Comprar uma carta para o próximo jogador
    nextPlayer.cards.push(game.drawCard());

    logTurnState(game);
    io.to(nextPlayer.id).emit('yourTurn', {
      cards: nextPlayer.cards,
      canMove: game.hasAnyValidMove(nextPlayer.position)
    });

  } catch (error) {
    console.error(`Erro ao processar movimento:`, error);
    socket.emit('error', error.message);
  }
});

socket.on('confirmHomeEntry', ({ roomId, pieceId, cardIndex, enterHome }) => {
   const game = rooms.get(roomId);

   if (!game || !game.isActive) {
     socket.emit('error', 'Jogo não está ativo');
     return;
   }

   const currentPlayer = game.getCurrentPlayer();
   if (!currentPlayer || currentPlayer.id !== socket.id) {
     socket.emit('error', 'Não é sua vez');
     return;
   }

   try {
     const piece = game.pieces.find(p => p.id === pieceId);
     const oldPos = { ...piece.position };
     const moveResult = game.makeMove(pieceId, cardIndex, enterHome);
     logMoveDetails(currentPlayer, pieceId, oldPos, moveResult, game);

     const updatedState = game.getGameState();
     io.to(roomId).emit('gameStateUpdate', updatedState);

     socket.emit('updateCards', {
       cards: currentPlayer.cards
     });

     if (game.checkWinCondition()) {
       io.to(roomId).emit('gameOver', {
         winners: game.getWinningTeam()
       });
       return;
     }

    const nextPlayer = game.getCurrentPlayer();
    nextPlayer.cards.push(game.drawCard());

    logTurnState(game);
    io.to(nextPlayer.id).emit('yourTurn', {
      cards: nextPlayer.cards,
      canMove: game.hasAnyValidMove(nextPlayer.position)
    });
   } catch (error) {
     console.error('Erro ao confirmar entrada na vitória:', error);
     socket.emit('error', error.message);
   }
 });




  // Movimento especial para carta 7
  socket.on('makeSpecialMove', ({ roomId, moves, cardIndex }) => {
    const game = rooms.get(roomId);
    
    if (!game || !game.isActive) {
      socket.emit('error', 'Jogo não está ativo');
      return;
    }
    
    if (game.getCurrentPlayer().id !== socket.id) {
      socket.emit('error', 'Não é sua vez');
      return;
    }
    
    try {
      const currentPlayer = game.getCurrentPlayer();
      const moveResult = game.makeSpecialMove(moves);
      if (moveResult.moves) {
        moveResult.moves.forEach(m => {
          logMoveDetails(currentPlayer, m.pieceId, m.oldPosition, m.result, game);
        });
      }

      if (moveResult && moveResult.action === 'homeEntryChoice') {
        socket.emit('homeEntryChoiceSpecial', {
          pieceId: moveResult.pieceId,
          moveIndex: moveResult.moveIndex,
          boardPosition: moveResult.boardPosition,
          homePosition: moveResult.homePosition,
          cardIndex,
          moves
        });
        return;
      }

      // Atualizar estado do jogo para todos
      io.to(roomId).emit('gameStateUpdate', game.getGameState());
      logTurnState(game);
      
      // Verificar se o jogo acabou
      if (game.checkWinCondition()) {
        io.to(roomId).emit('gameOver', {
          winners: game.getWinningTeam()
        });
        return;
      }
      
      // Notificar próximo jogador
      const nextPlayer = game.getCurrentPlayer();
      
      // Comprar uma carta para o próximo jogador
      nextPlayer.cards.push(game.drawCard());

      logTurnState(game);
      io.to(nextPlayer.id).emit('yourTurn', {
        cards: nextPlayer.cards,
        canMove: game.hasAnyValidMove(nextPlayer.position)
      });
      
    } catch (error) {
      socket.emit('error', error.message);
    }
  });

  socket.on('confirmSpecialHomeEntry', ({ roomId, moves, moveIndex, cardIndex, enterHome }) => {
    const game = rooms.get(roomId);

    if (!game || !game.isActive) {
      socket.emit('error', 'Jogo não está ativo');
      return;
    }

    const currentPlayer = game.getCurrentPlayer();
    if (!currentPlayer || currentPlayer.id !== socket.id) {
      socket.emit('error', 'Não é sua vez');
      return;
    }

    try {
      if (moves[moveIndex]) {
        moves[moveIndex].enterHome = enterHome;
      }

      const moveResult = game.makeSpecialMove(moves);

      if (moveResult && moveResult.action === 'homeEntryChoice') {
        socket.emit('homeEntryChoiceSpecial', {
          pieceId: moveResult.pieceId,
          moveIndex: moveResult.moveIndex,
          boardPosition: moveResult.boardPosition,
          homePosition: moveResult.homePosition,
          cardIndex,
          moves
        });
        return;
      }

      io.to(roomId).emit('gameStateUpdate', game.getGameState());
      logTurnState(game);

      if (game.checkWinCondition()) {
        io.to(roomId).emit('gameOver', {
          winners: game.getWinningTeam()
        });
        return;
      }

      const nextPlayer = game.getCurrentPlayer();
      nextPlayer.cards.push(game.drawCard());
      logTurnState(game);
      io.to(nextPlayer.id).emit('yourTurn', {
        cards: nextPlayer.cards,
        canMove: game.hasAnyValidMove(nextPlayer.position)
      });
    } catch (error) {
      console.error('Erro ao confirmar entrada na vitória especial:', error);
      socket.emit('error', error.message);
    }
  });

  // Desconexão
  socket.on('disconnect', () => {
    console.log('Usuário desconectado:', socket.id);
    
    // Encontrar e marcar o jogador como desconectado em qualquer sala
    for (const [roomId, game] of rooms.entries()) {
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      
      if (playerIndex !== -1) {
        const playerName = game.players[playerIndex].name;
        console.log(`${playerName} saiu da sala ${roomId}`);
        
        // Se o jogo já começou, não remover a sala imediatamente
        // Apenas marcar o jogador como desconectado temporariamente
        if (game.isActive) {
          game.players[playerIndex].disconnected = true;
          game.players[playerIndex].disconnectTime = Date.now();
          
          // Verificar se todos os jogadores estão desconectados
          const allDisconnected = game.players.every(p => p.disconnected);
          
          if (allDisconnected) {
            // Definir um timer para remover a sala após 2 minutos se ninguém reconectar
            game.cleanupTimer = setTimeout(() => {
              console.log(`Todos os jogadores desconectados da sala ${roomId}. Removendo sala.`);
              rooms.delete(roomId);
            }, 120000); // 2 minutos
          }
          
          // Não remover o jogador da sala ainda
          return;
        } else {
          // Se o jogo não começou, apenas remover o jogador
          game.removePlayer(socket.id);
          io.to(roomId).emit('updatePlayers', game.getPlayersInfo());
          
          // Se não sobrou ninguém, remover a sala
          if (game.players.length === 0) {
            rooms.delete(roomId);
          }
        }
        break;
      }
    }
  });
});


const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

