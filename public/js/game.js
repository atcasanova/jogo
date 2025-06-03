//file: public/js/game.js
document.addEventListener('DOMContentLoaded', () => {
    // Elementos da interface
    const board = document.getElementById('board');
    const roomCodeSpan = document.getElementById('room-code');
    const team1Players = document.getElementById('team1-players');
    const team2Players = document.getElementById('team2-players');
    const currentPlayerSpan = document.getElementById('current-player');
    const turnMessage = document.getElementById('turn-message');
    const cardsContainer = document.getElementById('cards-container');
    const deckCount = document.getElementById('deck-count');
    const discardCount = document.getElementById('discard-count');
    const topDiscard = document.getElementById('top-discard');
    const specialMoveDialog = document.getElementById('special-move-dialog');
    const jokerDialog = document.getElementById('joker-dialog');
    const gameOverDialog = document.getElementById('game-over');
    const winnersDiv = document.getElementById('winners');
    
    // Elementos do diálogo de movimento especial (carta 7)
    const piece1Select = document.getElementById('piece1');
    const piece2Select = document.getElementById('piece2');
    const steps1Input = document.getElementById('steps1');
    const steps2Input = document.getElementById('steps2');
    const totalStepsSpan = document.getElementById('total-steps');
    const confirmSpecialMoveBtn = document.getElementById('confirm-special-move');
    const cancelSpecialMoveBtn = document.getElementById('cancel-special-move');
    
    // Elementos do diálogo de movimento com Joker
    const jokerPositions = document.getElementById('joker-positions');
    const cancelJokerMoveBtn = document.getElementById('cancel-joker-move');
    
    // Botão de novo jogo
    const newGameBtn = document.getElementById('new-game-btn');
    
    // Estado do jogo
    let socket;
    let roomId;
    let playerId;
    let gameState;
    let playerPosition;
    let selectedPieceId = null;
    let selectedCardIndex = null;
    let isMyTurn = false;
    let specialMoveCard = null;
    let jokerTargets = null;
    
    // Inicializar o jogo
   // No arquivo game.js - Modifique a função init
function init() {
  // Obter roomId e playerId da URL
  const urlParams = new URLSearchParams(window.location.search);
  roomId = urlParams.get('roomId');
  playerId = urlParams.get('playerId');
  
  if (!roomId) {
    alert('Sala não especificada');
    window.location.href = '/';
    return;
  }
  
  // Recuperar dados do jogador do localStorage
  const playerKey = `game_${roomId}_player_${playerId}`;
  const playerDataString = localStorage.getItem(playerKey);
  
  if (!playerDataString) {
    console.error('Dados do jogador não encontrados');
    alert('Erro ao recuperar dados do jogador. Redirecionando para a página inicial.');
    window.location.href = '/';
    return;
  }
  
  // Parsear os dados do jogador
  try {
    const playerData = JSON.parse(playerDataString);
    
    // Armazenar dados importantes
    const playerName = playerData.name;
    playerPosition = playerData.position;
    
    console.log(`Dados do jogador recuperados: ${playerName} (posição ${playerPosition})`);
    
    roomCodeSpan.textContent = roomId;
    
    // Criar tabuleiro
    createBoard();
    
    // Inicializar Socket.io com os dados recuperados
    initSocketWithPlayerData(playerData);
    
    // Adicionar event listeners
    setupEventListeners();
    
  } catch (error) {
    console.error('Erro ao parsear dados do jogador:', error);
    alert('Erro ao recuperar dados do jogador. Redirecionando para a página inicial.');
    window.location.href = '/';
  }
}

// Adicione esta nova função
function initSocketWithPlayerData(playerData) {
  socket = io();
  
  console.log(`Conectando como: ${playerData.name} (posição ${playerData.position})`);
  
  // Reconectar à sala com dados completos
  socket.emit('joinRoom', { 
    roomId: playerData.roomId,
    playerName: playerData.name,
    originalPosition: playerData.position,
    originalId: playerData.id
  });
  
  // Eventos do socket
  socket.on('roomJoined', handleRoomJoined);
  socket.on('gameStateUpdate', handleGameStateUpdate);
  socket.on('playerInfo', handlePlayerInfo);
  socket.on('yourTurn', handleYourTurn);
  socket.on('gameOver', handleGameOver);
  socket.on('gameAborted', handleGameAborted);
  socket.on('updateCards', handleUpdateCards);
  socket.on('error', handleError);
}

// Modifique a função handleRoomJoined
function handleRoomJoined(data) {
  console.log('Evento roomJoined recebido:', data);
  playerId = data.playerId;
  
  // Atualizar a posição do jogador se fornecida
  if (data.playerPosition !== undefined) {
    playerPosition = data.playerPosition;
    console.log('Posição do jogador atualizada para:', playerPosition);
    
    // Atualizar o localStorage com a posição atualizada
    const playerKey = `game_${roomId}_player_${playerId}`;
    const playerDataString = localStorage.getItem(playerKey);
    
    if (playerDataString) {
      try {
        const playerData = JSON.parse(playerDataString);
        playerData.position = playerPosition;
        localStorage.setItem(playerKey, JSON.stringify(playerData));
      } catch (error) {
        console.error('Erro ao atualizar posição no localStorage:', error);
      }
    }
  }
  
  // Se for uma reconexão, solicitar o estado atual do jogo
  if (data.isReconnection) {
    console.log('Reconectado à sala, solicitando estado do jogo');
    const playerKey = `game_${roomId}_player_${playerId}`;
    let storedName = null;
    const stored = localStorage.getItem(playerKey);
    if (stored) {
      try {
        storedName = JSON.parse(stored).name;
      } catch (error) {
        console.error('Erro ao ler nome do jogador no localStorage:', error);
      }
    }
    socket.emit('requestGameState', {
      roomId,
      playerName: data.playerName || storedName,
      playerPosition: playerPosition
    });
  }
}

// Adicione esta função
function handlePlayerInfo(data) {
  console.log('Informações do jogador recebidas:', data);

  if (data.playerPosition !== undefined) {
    playerPosition = data.playerPosition;
    const playerKey = `game_${roomId}_player_${playerId}`;
    const playerDataString = localStorage.getItem(playerKey);
    if (playerDataString) {
      try {
        const playerData = JSON.parse(playerDataString);
        playerData.position = playerPosition;
        localStorage.setItem(playerKey, JSON.stringify(playerData));
      } catch (error) {
        console.error('Erro ao atualizar posição no localStorage:', error);
      }
    }
    console.log('Posição do jogador definida como:', playerPosition);
  }

  if (data.cards) {
    updateCards(data.cards);
  }

  // Atualizar o indicador de jogador
  updatePlayerIndicator();
}

// Adicione esta função para atualizar o indicador de jogador
function updatePlayerIndicator() {
  // Remover indicador existente
  const existingIndicator = document.querySelector('.player-info-fixed');
  if (existingIndicator) {
    existingIndicator.remove();
  }

  // Criar novo indicador
  const playerInfoDiv = document.createElement('div');
  playerInfoDiv.className = 'player-info-fixed';
  playerInfoDiv.style.position = 'fixed';
  playerInfoDiv.style.top = '70px';
  playerInfoDiv.style.left = '10px';
  playerInfoDiv.style.backgroundColor = 'white';
  playerInfoDiv.style.padding = '10px';
  playerInfoDiv.style.border = '1px solid black';
  playerInfoDiv.style.zIndex = '1000';

  // Determinar a cor do jogador
  const colors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12'];
  const colorNames = ['Azul', 'Vermelho', 'Verde', 'Laranja'];

  if (playerPosition === undefined || playerPosition < 0 || playerPosition > 3) {
    console.error('Posição do jogador inválida:', playerPosition);
    return;
  }

  playerInfoDiv.innerHTML = `
    <div>Você é o jogador ${playerPosition + 1} (${colorNames[playerPosition]})</div>
    <div style="width: 20px; height: 20px; background-color: ${colors[playerPosition]}; display: inline-block; margin-right: 5px;"></div>
    <span>Suas peças</span>
  `;

  document.body.appendChild(playerInfoDiv);
}

    // Manipuladores de eventos do socket
    function handleGameStateUpdate(state) {
        console.log('Estado do jogo recebido:', state);
        gameState = state;
        
        // Encontrar a posição do jogador
        const player = gameState.players.find(p => p.id === playerId);
        if (player) {
            playerPosition = player.position;
            console.log('Posição do jogador:', playerPosition);
        }
        
        updateBoard();
        updateTeams();
        updateTurnInfo();
        updateDeckInfo();
    }
    
function handleUpdateCards(data) {
  console.log('Cartas atualizadas recebidas:', data);
  
  if (data.playerPosition !== undefined) {
    playerPosition = data.playerPosition;
    console.log('Posição do jogador atualizada para:', playerPosition);
  }
  
  if (data && data.cards) {
    updateCards(data.cards);
  }
}
   

// Modifique a função handleYourTurn
 // No arquivo game.js do cliente - Modifique a função handleYourTurn
function handleYourTurn(data) {
  console.log('É sua vez de jogar!', data);
  isMyTurn = true;
  
  // Atualizar cartas na mão
  if (data && data.cards) {
    console.log('Atualizando cartas:', data.cards);
    updateCards(data.cards);
    
    // Verificar se o jogador está preso no castigo sem K, Q ou J
    checkIfStuckInPenalty(data.cards);
  } else {
    console.error('ERRO: Dados de cartas não recebidos');
  }
}

// Adicione esta função para verificar se o jogador está preso no castigo
function checkIfStuckInPenalty(cards) {
  if (!gameState || !gameState.pieces) return;
  
  // Verificar se todas as peças do jogador estão no castigo
  const playerPieces = gameState.pieces.filter(p => p.playerId === playerPosition);
  const allInPenalty = playerPieces.every(p => p.inPenaltyZone);
  
  // Verificar se o jogador não tem K, Q ou J
  const hasExitCard = cards.some(card => ['K', 'Q', 'J'].includes(card.value));
  
  if (allInPenalty && !hasExitCard) {
    // Jogador está preso no castigo sem cartas para sair
    turnMessage.textContent = 'Você não tem K, Q ou J para sair do castigo. Selecione uma carta para descartar.';
    turnMessage.style.color = '#e74c3c';
    
    // Adicionar classe visual para indicar que as cartas são apenas para descarte
    const cardElements = document.querySelectorAll('.card');
    cardElements.forEach(card => {
      card.classList.add('discard-only');
    });
  } else {
    turnMessage.textContent = 'É sua vez de jogar!';
    turnMessage.style.color = '#2ecc71';
  }
}   

    function handleGameOver(data) {
        isMyTurn = false;
        
        // Mostrar diálogo de fim de jogo
        const winners = data.winners.map(player => player.name).join(' e ');
        winnersDiv.textContent = `Parabéns! ${winners} venceram o jogo!`;
        gameOverDialog.classList.remove('hidden');
    }
    
    function handleGameAborted(data) {
        alert(data.message);
        window.location.href = '/';
    }
    
    function handleError(message) {
        alert(`Erro: ${message}`);
    }
    
    // Funções de atualização da interface
    function createBoard() {
        console.log('Criando tabuleiro 19x19');
        // Criar células do tabuleiro 19x19
        for (let row = 0; row < 19; row++) {
            for (let col = 0; col < 19; col++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = row;
                cell.dataset.col = col;
                
                // Adicionar evento de clique
                cell.addEventListener('click', () => handleCellClick(row, col));
                
                board.appendChild(cell);
            }
        }
        console.log('Tabuleiro criado com', board.children.length, 'células');
    }
    
   // Modifique a função updateBoard para incluir o indicador de peças
function updateBoard() {
  if (!gameState) return;
  
  // Limpar tabuleiro
  const cells = board.querySelectorAll('.cell');
  cells.forEach(cell => {
    cell.className = 'cell';
    
    // Remover peças
    const piece = cell.querySelector('.piece');
    if (piece) {
      cell.removeChild(piece);
    }
  });
  
  // Adicionar indicador de peças do jogador
  const playerInfoDiv = document.createElement('div');
  playerInfoDiv.style.position = 'fixed';
  playerInfoDiv.style.top = '70px';
  playerInfoDiv.style.left = '10px';
  playerInfoDiv.style.backgroundColor = 'white';
  playerInfoDiv.style.padding = '10px';
  playerInfoDiv.style.border = '1px solid black';
  playerInfoDiv.style.zIndex = '1000';
  
  // Determinar a cor do jogador
  let playerColor = '';
  switch(playerPosition) {
    case 0: playerColor = '#3498db'; break; // Azul
    case 1: playerColor = '#e74c3c'; break; // Vermelho
    case 2: playerColor = '#2ecc71'; break; // Verde
    case 3: playerColor = '#f39c12'; break; // Laranja
  }
  
  playerInfoDiv.innerHTML = `
    <div>Você é o jogador ${playerPosition + 1} (${['Azul', 'Vermelho', 'Verde', 'Laranja'][playerPosition]})</div>
    <div style="width: 20px; height: 20px; background-color: ${playerColor}; display: inline-block; margin-right: 5px;"></div>
    <span>Suas peças</span>
  `;
  
  // Remover indicador existente
  const existingInfo = document.querySelector('.player-info-fixed');
  if (existingInfo) {
    existingInfo.remove();
  }
  
  playerInfoDiv.className = 'player-info-fixed';
  document.body.appendChild(playerInfoDiv);
  
  // Aplicar rotação com base na posição do jogador
  rotateBoard();
  
  // Marcar células especiais
  markSpecialCells();

  // Posicionar peças
  positionPieces();

  // Reaplicar rotação para ajustar a orientação das peças
  rotateBoard();
  
  console.log('Tabuleiro atualizado');
}


function rotateBoard() {
  // Rotacionar o tabuleiro com base na posição do jogador
  // 0: sem rotação, 1: 90° no sentido anti-horário, 2: 180°, 3: 270° no sentido anti-horário
  if (playerPosition === undefined) return;
  
  // Mapeamento correto para que cada jogador veja suas peças na parte inferior
  const rotationMap = [180, 90, 0, 270]; // 0: 0°, 1: 270°, 2: 180°, 3: 90°
  const rotation = rotationMap[playerPosition];
  
  board.style.transform = `rotate(${rotation}deg)`;
  
  // Rotacionar também as peças na direção oposta para manter orientação correta
  const pieces = document.querySelectorAll('.piece');
  pieces.forEach(piece => {
    piece.style.transform = `rotate(${-rotation}deg)`;
  });
}



    function markSpecialCells() {
        console.log('Marcando células especiais');
        
        // Limpar todas as células primeiro
        const cells = board.querySelectorAll('.cell');
        cells.forEach(cell => {
            cell.className = 'cell';
        });
        
        // Marcar pista principal (contorno)
        for (let i = 0; i < 19; i++) {
            markCellIfExists(0, i, 'track');
            markCellIfExists(18, i, 'track');
            markCellIfExists(i, 0, 'track');
            markCellIfExists(i, 18, 'track');
        }
        
        // Marcar zonas de castigo (cruzes)
        const penaltyZones = [
            // Topo
            [{row: 2, col: 8}, {row: 1, col: 8}, {row: 3, col: 8}, {row: 2, col: 7}, {row: 2, col: 9}],
            // Direita
            [{row: 8, col: 16}, {row: 7, col: 16}, {row: 9, col: 16}, {row: 8, col: 15}, {row: 8, col: 17}],
            // Fundo
            [{row: 16, col: 10}, {row: 15, col: 10}, {row: 17, col: 10}, {row: 16, col: 9}, {row: 16, col: 11}],
            // Esquerda
            [{row: 10, col: 2}, {row: 9, col: 2}, {row: 11, col: 2}, {row: 10, col: 1}, {row: 10, col: 3}]
        ];
        
        penaltyZones.forEach(zone => {
            zone.forEach(pos => {
                markCellIfExists(pos.row, pos.col, 'penalty');
            });
        });
        
        // Marcar corredores de chegada
        const homeStretches = [
            // Topo-Esquerda
            [{row: 1, col: 4}, {row: 2, col: 4}, {row: 3, col: 4}, {row: 4, col: 4}, {row: 5, col: 4}],
            // Topo-Direita
            [{row: 4, col: 13}, {row: 4, col: 14}, {row: 4, col: 15}, {row: 4, col: 16}, {row: 4, col: 17}],
            // Fundo-Direita
            [{row: 13, col: 15}, {row: 14, col: 15}, {row: 15, col: 15}, {row: 16, col: 15}, {row: 17, col: 15}],
            // Fundo-Esquerda
            [{row: 14, col: 1}, {row: 14, col: 2}, {row: 14, col: 3}, {row: 14, col: 4}, {row: 14, col: 5}]
        ];
        
        homeStretches.forEach(stretch => {
            stretch.forEach(pos => {
                markCellIfExists(pos.row, pos.col, 'home-stretch');
            });
        });
        
        // Marcar área de descarte (centro)
        for (let row = 6; row <= 12; row++) {
            for (let col = 7; col <= 11; col++) {
                markCellIfExists(row, col, 'discard-area');
            }
        }
        
        console.log('Células especiais marcadas');
    }
    
    function markCellIfExists(row, col, className) {
        const cell = getCell(row, col);
        if (cell) {
            cell.classList.add(className);
        } else {
            console.error(`Célula não encontrada: (${row}, ${col})`);
        }
    }
    
   // Modifique a função positionPieces

	function positionPieces() {
  if (!gameState || !gameState.pieces) {
    console.log('Sem peças para posicionar');
    return;
  }
  
  console.log(`Posicionando ${gameState.pieces.length} peças`);
  
  // Remover indicador existente se houver
  const existingIndicator = document.querySelector('.player-info');
  if (existingIndicator) {
    existingIndicator.remove();
  }
  
  // Adicionar uma indicação visual de quais peças são do jogador
  const playerInfoDiv = document.createElement('div');
  playerInfoDiv.className = 'player-info';
  playerInfoDiv.style.position = 'absolute';
  playerInfoDiv.style.top = '10px';
  playerInfoDiv.style.left = '10px';
  playerInfoDiv.style.backgroundColor = 'rgba(255,255,255,0.8)';
  playerInfoDiv.style.padding = '5px';
  playerInfoDiv.style.borderRadius = '5px';
  playerInfoDiv.style.zIndex = '20';
  
  const colorIndicator = document.createElement('span');
  colorIndicator.className = `piece-indicator player${playerPosition}`;
  colorIndicator.style.width = '20px';
  colorIndicator.style.height = '20px';
  colorIndicator.style.display = 'inline-block';
  colorIndicator.style.borderRadius = '50%';
  colorIndicator.style.marginLeft = '5px';
  
  playerInfoDiv.innerHTML = `<p>Suas peças são: `;
  playerInfoDiv.appendChild(colorIndicator);
  playerInfoDiv.innerHTML += `</p>`;
  
  document.querySelector('.board-container').appendChild(playerInfoDiv);
  
  gameState.pieces.forEach(piece => {
    console.log(`Posicionando peça ${piece.id} em (${piece.position.row}, ${piece.position.col})`);
    const cell = getCell(piece.position.row, piece.position.col);
    
    if (!cell) {
      console.error(`Célula não encontrada para peça ${piece.id} em (${piece.position.row}, ${piece.position.col})`);
      return;
    }
    
    // Remover peça existente, se houver
    const existingPiece = cell.querySelector('.piece');
    if (existingPiece) {
      cell.removeChild(existingPiece);
    }
    
    // Criar elemento da peça
    const pieceElement = document.createElement('div');
    pieceElement.className = `piece player${piece.playerId}`;
    
    // Destacar peças do jogador atual
    if (piece.playerId === playerPosition) {
      pieceElement.classList.add('my-piece');
    }
    
    pieceElement.textContent = piece.pieceId;
    pieceElement.dataset.id = piece.id;
    
    // Rotacionar a peça na direção oposta ao tabuleiro para manter orientação correta
    //if (playerPosition !== undefined) {
    //  pieceElement.style.transform = `rotate(${-playerPosition * 90}deg)`;
    //}
    
    // Adicionar evento de clique
    pieceElement.addEventListener('click', (e) => {
      e.stopPropagation();
      handlePieceClick(piece.id);
    });
    
    cell.appendChild(pieceElement);
    console.log(`Peça ${piece.id} posicionada com sucesso`);
  });
}


    function updateTeams() {
        if (!gameState || !gameState.teams) return;
        
        // Limpar listas de times
        team1Players.innerHTML = '';
        team2Players.innerHTML = '';
        
        // Preencher time 1
        gameState.teams[0].forEach(player => {
            const playerElement = document.createElement('div');
            playerElement.textContent = player.name;
            if (player.id === playerId) {
                playerElement.style.fontWeight = 'bold';
                playerElement.textContent += ' (você)';
            }
            team1Players.appendChild(playerElement);
        });
        
        // Preencher time 2
        gameState.teams[1].forEach(player => {
            const playerElement = document.createElement('div');
            playerElement.textContent = player.name;
            if (player.id === playerId) {
                playerElement.style.fontWeight = 'bold';
                playerElement.textContent += ' (você)';
            }
            team2Players.appendChild(playerElement);
        });
    }
    
// No arquivo game.js do cliente
function updateTurnInfo() {
  if (!gameState || !gameState.players || gameState.currentPlayerIndex === undefined) {
    console.error('Estado do jogo incompleto para atualizar turno');
    return;
  }
  
  const currentPlayer = gameState.players[gameState.currentPlayerIndex];
  
  if (!currentPlayer) {
    console.error('Jogador atual não encontrado:', gameState.currentPlayerIndex);
    return;
  }
  
  console.log(`Atualizando turno: Jogador atual é ${currentPlayer.name} (${currentPlayer.id}), seu ID é ${playerId}`);
  
  currentPlayerSpan.textContent = currentPlayer.name;
  
  // Verificar se é a vez do jogador atual
  const isCurrentPlayersTurn = currentPlayer.id === playerId;
  
  if (isCurrentPlayersTurn) {
    isMyTurn = true;
    turnMessage.textContent = 'É sua vez de jogar!';
    turnMessage.style.color = '#2ecc71';
    console.log('É SUA VEZ DE JOGAR!');
  } else {
    isMyTurn = false;
    turnMessage.textContent = `Aguardando jogada de ${currentPlayer.name}...`;
    turnMessage.style.color = '#7f8c8d';
    console.log(`Aguardando jogada de ${currentPlayer.name}`);
  }
}
 
    function updateDeckInfo() {
        if (!gameState) return;
        
        // Atualizar contadores
        deckCount.textContent = gameState.deckCount || 0;
        discardCount.textContent = gameState.discardCount || 0;
        
        // Mostrar carta no topo da pilha de descarte
        if (gameState.discardPile && gameState.discardPile.length > 0) {
            const card = gameState.discardPile[0];
            topDiscard.innerHTML = createCardHTML(card);
            topDiscard.classList.remove('hidden');
        } else {
            topDiscard.innerHTML = '';
            topDiscard.classList.add('hidden');
        }
    }
    
function updateCards(cards) {
  console.log('Atualizando cartas:', cards);
  
  // Limpar container de cartas
  cardsContainer.innerHTML = '';
  
  if (!cards || cards.length === 0) {
    console.error('Nenhuma carta para exibir');
    return;
  }
  
  cards.forEach((card, index) => {
    const cardElement = document.createElement('div');
    cardElement.className = 'card';
    cardElement.dataset.index = index;
    
    const isRed = card.suit === '♥' || card.suit === '♦';
    
    cardElement.innerHTML = `
      <div class="card-value">${card.value}</div>
      <div class="card-suit ${isRed ? 'red' : 'black'}">${card.suit}</div>
    `;
    
    cardElement.addEventListener('click', () => handleCardClick(index));
    
    cardsContainer.appendChild(cardElement);
  });
  
  console.log('Cartas atualizadas no DOM:', cardsContainer.children.length);
}
   

    function createCardHTML(card) {
        const isRed = card.suit === '♥' || card.suit === '♦';
        return `
            <div class="card-value">${card.value}</div>
            <div class="card-suit ${isRed ? 'red' : 'black'}">${card.suit}</div>
        `;
    }
    
    // Manipuladores de eventos de interface
    function handleCellClick(row, col) {
        // Implementar lógica de clique na célula, se necessário
    }
    
function handlePieceClick(pieceId) {
  if (!isMyTurn) {
    alert('Não é sua vez de jogar!');
    return;
  }
  
  console.log('Clique na peça:', pieceId, 'Posição do jogador:', playerPosition);
  
  // Verificar se a peça pertence ao jogador
  const piece = gameState.pieces.find(p => p.id === pieceId);
  if (!piece) {
    console.error('Peça não encontrada:', pieceId);
    return;
  }
  
  console.log('Peça encontrada:', piece);
  
  if (piece.playerId !== playerPosition) {
    alert(`Esta peça pertence ao jogador ${piece.playerId + 1}, não a você (jogador ${playerPosition + 1})`);
    return;
  }
  
  // Selecionar/desselecionar peça
  if (selectedPieceId === pieceId) {
    selectedPieceId = null;
    updateSelectedPiece();
  } else {
    selectedPieceId = pieceId;
    updateSelectedPiece();
  }
  
  // Se já tiver uma carta selecionada, tentar fazer o movimento
  if (selectedPieceId && selectedCardIndex !== null) {
    makeMove();
  }
}
   

  // No arquivo game.js do cliente
// No arquivo game.js - Modifique a função handleCardClick
function handleCardClick(index) {
  if (!isMyTurn) {
    alert('Não é sua vez de jogar!');
    return;
  }
  
  console.log('Clique na carta com índice:', index);
  
  // Verificar se o jogador está preso no castigo
  if (isPlayerStuckInPenalty()) {
    // Descartar a carta diretamente
    discardCard(index);
    return;
  }
  
  // Resto do código normal para seleção de carta...
  if (selectedCardIndex === index) {
    selectedCardIndex = null;
    updateSelectedCard();
  } else {
    selectedCardIndex = index;
    updateSelectedCard();
  }
  
  // Se já tiver uma peça selecionada, tentar fazer o movimento
  if (selectedPieceId && selectedCardIndex !== null) {
    makeMove();
  }
}

// Adicione esta função auxiliar
function isPlayerStuckInPenalty() {
  if (!gameState || !gameState.pieces) return false;
  
  // Verificar se todas as peças do jogador estão no castigo
  const playerPieces = gameState.pieces.filter(p => p.playerId === playerPosition);
  const allInPenalty = playerPieces.every(p => p.inPenaltyZone);
  
  // Obter cartas do DOM
  const cardElements = document.querySelectorAll('.card');
  const hasDiscard = cardElements.length > 0 && cardElements[0].classList.contains('discard-only');
  
  return allInPenalty && hasDiscard;
}

// Adicione esta função para descartar uma carta
function discardCard(cardIndex) {
  console.log('Descartando carta:', cardIndex);
  
  socket.emit('discardCard', {
    roomId,
    cardIndex
  });
}

// Modifique a função makeMove
function makeMove() {
  if (!isMyTurn || !selectedPieceId || selectedCardIndex === null) return;
  
  console.log(`Tentando mover peça ${selectedPieceId} com carta ${selectedCardIndex}`);
  
  socket.emit('makeMove', {
    roomId,
    pieceId: selectedPieceId,
    cardIndex: selectedCardIndex
  });
  
  // Limpar seleção
  selectedPieceId = null;
  selectedCardIndex = null;
  updateSelectedPiece();
  updateSelectedCard();
}


    function updateSelectedPiece() {
        // Remover seleção de todas as peças
        const pieces = document.querySelectorAll('.piece');
        pieces.forEach(piece => {
            piece.classList.remove('selected');
        });
        
        // Adicionar seleção à peça escolhida
        if (selectedPieceId) {
            const piece = document.querySelector(`.piece[data-id="${selectedPieceId}"]`);
            if (piece) {
                piece.classList.add('selected');
            }
        }
    }
    
    function updateSelectedCard() {
        // Remover seleção de todas as cartas
        const cards = document.querySelectorAll('.card');
        cards.forEach(card => {
            card.classList.remove('selected');
        });
        
        // Adicionar seleção à carta escolhida
        if (selectedCardIndex !== null) {
            const card = document.querySelector(`.card[data-index="${selectedCardIndex}"]`);
            if (card) {
                card.classList.add('selected');
            }
        }
    }
    
    
    function showSpecialMoveDialog(cardIndex) {
        specialMoveCard = cardIndex;
        
        // Preencher seletores de peças
        piece1Select.innerHTML = '';
        piece2Select.innerHTML = '';
        
        // Adicionar opção vazia
        const emptyOption1 = document.createElement('option');
        emptyOption1.value = '';
        emptyOption1.textContent = 'Selecione uma peça';
        piece1Select.appendChild(emptyOption1);
        
        const emptyOption2 = document.createElement('option');
        emptyOption2.value = '';
        emptyOption2.textContent = 'Selecione uma peça';
        piece2Select.appendChild(emptyOption2);
        
        // Adicionar peças do jogador
        const playerPieces = gameState.pieces.filter(p => p.playerId === playerPosition && !p.completed);
        playerPieces.forEach(piece => {
            const option1 = document.createElement('option');
            option1.value = piece.id;
            option1.textContent = `Peça ${piece.pieceId}`;
            piece1Select.appendChild(option1);
            
            const option2 = document.createElement('option');
            option2.value = piece.id;
            option2.textContent = `Peça ${piece.pieceId}`;
            piece2Select.appendChild(option2);
        });
        
        // Resetar valores
        steps1Input.value = 0;
        steps2Input.value = 0;
        totalStepsSpan.textContent = '0';
        
        // Mostrar diálogo
        specialMoveDialog.classList.remove('hidden');
    }
    
    function showJokerDialog(cardIndex) {
        // Implementar diálogo para movimento com Joker
        // Mostrar todas as posições ocupadas por outras peças
        jokerPositions.innerHTML = '';
        
        // Obter peças que não são do jogador e não estão completadas
        const occupiedPositions = gameState.pieces.filter(p => 
            !p.completed && 
            !p.inPenaltyZone && 
            (p.playerId !== playerPosition || p.id !== selectedPieceId)
        );
        
        if (occupiedPositions.length === 0) {
            alert('Não há posições ocupadas para mover');
            return;
        }
        
        occupiedPositions.forEach(piece => {
            const option = document.createElement('div');
            option.className = 'position-option';
            option.textContent = `Jogador ${piece.playerId + 1}, Peça ${piece.pieceId}`;
            option.dataset.id = piece.id;
            
            option.addEventListener('click', () => {
                socket.emit('makeJokerMove', {
                    roomId,
                    pieceId: selectedPieceId,
                    targetPieceId: piece.id,
                    cardIndex
                });
                
                jokerDialog.classList.add('hidden');
            });
            
            jokerPositions.appendChild(option);
        });
        
        jokerDialog.classList.remove('hidden');
    }
    
    // Funções auxiliares
    function getCell(row, col) {
        const cell = board.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        if (!cell) {
            console.error(`Célula não encontrada: ${row},${col}`);
        }
        return cell;
    }
    
    function verifyBoard() {
        const cells = board.querySelectorAll('.cell');
        console.log(`Verificando tabuleiro: ${cells.length} células encontradas`);
        
        if (cells.length !== 19 * 19) {
            console.error(`Número incorreto de células: ${cells.length} (deveria ser 361)`);
        }
        
        // Verificar algumas células específicas
        const testCells = [
            {row: 0, col: 0}, // Canto superior esquerdo
            {row: 0, col: 18}, // Canto superior direito
            {row: 18, col: 0}, // Canto inferior esquerdo
            {row: 18, col: 18}, // Canto inferior direito
            {row: 9, col: 9}  // Centro
        ];
        
        testCells.forEach(pos => {
            const cell = getCell(pos.row, pos.col);
            console.log(`Célula ${pos.row},${pos.col}: ${cell ? 'encontrada' : 'NÃO ENCONTRADA'}`);
        });
    }
    
    function setupEventListeners() {
        // Event listeners para diálogo de movimento especial
        steps1Input.addEventListener('input', updateTotalSteps);
        steps2Input.addEventListener('input', updateTotalSteps);
        
        confirmSpecialMoveBtn.addEventListener('click', () => {
            const piece1Id = piece1Select.value;
            const piece2Id = piece2Select.value;
            const steps1 = parseInt(steps1Input.value) || 0;
            const steps2 = parseInt(steps2Input.value) || 0;
            
            if (steps1 + steps2 !== 7) {
                alert('O total de passos deve ser exatamente 7');
                return;
            }
            
            if (steps1 > 0 && !piece1Id) {
                alert('Selecione uma peça para o primeiro movimento');
                return;
            }
            
            if (steps2 > 0 && !piece2Id) {
                alert('Selecione uma peça para o segundo movimento');
                return;
            }
            
            const moves = [];
            if (steps1 > 0) {
                moves.push({ pieceId: piece1Id, steps: steps1 });
            }
            if (steps2 > 0) {
                moves.push({ pieceId: piece2Id, steps: steps2 });
            }
            
            socket.emit('makeSpecialMove', {
                roomId,
                moves,
                cardIndex: specialMoveCard
            });
            
            specialMoveDialog.classList.add('hidden');
        });
        
        cancelSpecialMoveBtn.addEventListener('click', () => {
            specialMoveDialog.classList.add('hidden');
        });
        
        cancelJokerMoveBtn.addEventListener('click', () => {
            jokerDialog.classList.add('hidden');
        });
        
        newGameBtn.addEventListener('click', () => {
            window.location.href = '/';
        });
    }
    
    function updateTotalSteps() {
        const steps1 = parseInt(steps1Input.value) || 0;
        const steps2 = parseInt(steps2Input.value) || 0;
        const total = steps1 + steps2;
        
        totalStepsSpan.textContent = total;
        
        if (total > 7) {
            totalStepsSpan.style.color = 'red';
        } else {
            totalStepsSpan.style.color = 'black';
        }
    }
    
    // Inicializar o jogo
    init();
});

