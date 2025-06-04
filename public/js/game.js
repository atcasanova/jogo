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
    const specialMoveChoice = document.getElementById('special-move-choice');
    const specialMoveSlider = document.getElementById('special-move-slider');
    const samePieceBtn = document.getElementById('same-piece-btn');
    const otherPieceBtn = document.getElementById('other-piece-btn');
    const pieceLeft = document.getElementById('piece-left');
    const pieceRight = document.getElementById('piece-right');
    const splitSlider = document.getElementById('split-slider');
    const sliderValues = document.getElementById('slider-values');
    const confirmSplitBtn = document.getElementById('confirm-split');
    
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
    let playerCards = [];
    let secondPieceId = null;
    let awaitingSecondPiece = false;
    const playerColors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12'];

    function getDisplayValue(card) {
      return card.value === 'JOKER' ? 'C' : card.value;
    }

    function showStatusMessage(message, type = 'info') {
      turnMessage.textContent = message;
      turnMessage.className = '';
      turnMessage.classList.add(type);
    }
    
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
  socket.on('choosePosition', handleChoosePosition);
  socket.on('homeEntryChoice', handleHomeEntryChoice);
  socket.on('homeEntryChoiceSpecial', handleHomeEntryChoiceSpecial);
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

}

    // Manipuladores de eventos do socket
    function handleGameStateUpdate(state) {
        console.log('Estado do jogo recebido:', state);
        gameState = state;

        clearJokerMode();
        
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

function handleChoosePosition(data) {
  showStatusMessage('Escolha qual peça deseja capturar', 'info');

  jokerTargets = {
    pieceId: data.pieceId,
    cardIndex: data.cardIndex,
    valid: data.validPositions.map(p => p.id)
  };

  board.classList.add('joker-mode');
  data.validPositions.forEach(p => {
    const el = document.querySelector(`.piece[data-id="${p.id}"]`);
    if (el) {
      el.classList.add('joker-target');
    }
  });
}

function clearJokerMode() {
  board.classList.remove('joker-mode');
  document.querySelectorAll('.joker-target').forEach(el => el.classList.remove('joker-target'));
  jokerTargets = null;
}

function handleHomeEntryChoice(data) {
  const choice = confirm('Sua peça pode entrar na zona de vitória. Deseja entrar?');
  socket.emit('confirmHomeEntry', {
    roomId,
    pieceId: data.pieceId,
    cardIndex: data.cardIndex,
    enterHome: choice
  });
}

function handleHomeEntryChoiceSpecial(data) {
  const choice = confirm('Sua peça pode entrar na zona de vitória. Deseja entrar?');
  socket.emit('confirmSpecialHomeEntry', {
    roomId,
    moves: data.moves,
    moveIndex: data.moveIndex,
    cardIndex: data.cardIndex,
    enterHome: choice
  });
}
   

// Modifique a função handleYourTurn
 // No arquivo game.js do cliente - Modifique a função handleYourTurn
function handleYourTurn(data) {
  console.log('É sua vez de jogar!', data);
  isMyTurn = true;
  showStatusMessage('É sua vez de jogar!', 'turn');

  // Atualizar cartas na mão
  if (data && data.cards) {
    console.log('Atualizando cartas:', data.cards);
    updateCards(data.cards);

    // Verificar se o jogador está preso no castigo sem K, Q ou J
    checkIfStuckInPenalty(data.cards, data.canMove);
  } else {
    console.error('ERRO: Dados de cartas não recebidos');
  }
}

// Adicione esta função para verificar se o jogador está preso no castigo
function checkIfStuckInPenalty(cards, canMoveFlag) {
  if (!gameState || !gameState.pieces) return;

  const cardElements = document.querySelectorAll('.card');

  if (canMoveFlag === false) {
    showStatusMessage('Você não tem jogadas possíveis. Selecione uma carta para descartar.', 'error');
    cardElements.forEach(card => card.classList.add('discard-only'));
    return;
  }

  const playerPieces = gameState.pieces.filter(p => p.playerId === playerPosition);
  const allInPenalty = playerPieces.every(p => p.inPenaltyZone);
  const hasExitCard = cards.some(card => ['K', 'Q', 'J'].includes(card.value));

  if (allInPenalty && !hasExitCard) {
    showStatusMessage('Você não tem K, Q ou J para sair do castigo. Selecione uma carta para descartar.', 'error');
    cardElements.forEach(card => card.classList.add('discard-only'));
  } else {
    cardElements.forEach(card => card.classList.remove('discard-only'));
    showStatusMessage('É sua vez de jogar!', 'turn');
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
        showStatusMessage(data.message, 'error');
        window.location.href = '/';
    }
    
    function handleError(message) {
        showStatusMessage(`Erro: ${message}`, 'error');
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

  clearJokerMode();
  
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
  
  
  // Aplicar rotação com base na posição do jogador
  rotateBoard();
  
  // Marcar células especiais
  markSpecialCells();

  // Posicionar peças
  positionPieces();

  // Reaplicar rotação para ajustar a orientação das peças
  rotateBoard();

  updatePlayerLabels();

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

function updatePlayerLabels() {
  const container = document.getElementById('player-labels');
  if (!container || !gameState || !gameState.players) return;

  container.innerHTML = '';

  const rotationMap = [180, 90, 0, 270];
  const rotation = rotationMap[playerPosition];

  const orientationMap = ['bottom', 'left', 'top', 'right'];

  gameState.players.forEach(p => {
    const label = document.createElement('div');
    label.className = 'player-label';
    label.textContent = p.name;
    if (p.id === playerId) {
      label.textContent += ' (você)';
    }
    if (p.position !== undefined) {
      label.style.color = playerColors[p.position];
    }

    const relIndex = (p.position - playerPosition + 4) % 4;
    const orientation = orientationMap[relIndex];

    label.style.top = '';
    label.style.left = '';
    label.style.transform = 'translate(-50%, -50%)';

    const offset = 12; // porcentagem aproximada da zona de castigo

    switch (orientation) {
      case 'top':
        label.style.top = `${offset}%`;
        label.style.left = '50%';
        break;
      case 'bottom':
        label.style.top = `${100 - offset}%`;
        label.style.left = '50%';
        break;
      case 'left':
        label.style.top = '50%';
        label.style.left = `${offset}%`;
        break;
      case 'right':
        label.style.top = '50%';
        label.style.left = `${100 - offset}%`;
        break;
    }

    container.appendChild(label);
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
            [{row: 13, col: 14}, {row: 14, col: 14}, {row: 15, col: 14}, {row: 16, col: 14}, {row: 17, col: 14}],
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
            if (player.position !== undefined) {
                playerElement.style.color = playerColors[player.position];
            }
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
            if (player.position !== undefined) {
                playerElement.style.color = playerColors[player.position];
            }
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
    showStatusMessage('É sua vez de jogar!', 'turn');
    console.log('É SUA VEZ DE JOGAR!');
  } else {
    isMyTurn = false;
    showStatusMessage(`Aguardando jogada de ${currentPlayer.name}...`, 'info');
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

  playerCards = cards || [];
  
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
    const displayValue = getDisplayValue(card);

    cardElement.innerHTML = `
      <div class="card-value">${displayValue}</div>
      <div class="card-suit ${isRed ? 'red' : 'black'}">${card.suit}</div>
    `;
    
    cardElement.addEventListener('click', () => handleCardClick(index));
    
    cardsContainer.appendChild(cardElement);
  });

  // Ajusta o tamanho das cartas caso a mão tenha mais de cinco
  if (cards.length > 5) {
    cardsContainer.classList.add('compact');
  } else {
    cardsContainer.classList.remove('compact');
  }

  console.log('Cartas atualizadas no DOM:', cardsContainer.children.length);
}
   

    function createCardHTML(card) {
        const isRed = card.suit === '♥' || card.suit === '♦';
        const displayValue = getDisplayValue(card);
        return `
            <div class="card-value">${displayValue}</div>
            <div class="card-suit ${isRed ? 'red' : 'black'}">${card.suit}</div>
        `;
    }
    
    // Manipuladores de eventos de interface
    function handleCellClick(row, col) {
        // Implementar lógica de clique na célula, se necessário
    }
    
function handlePieceClick(pieceId) {
  if (jokerTargets && jokerTargets.valid.includes(pieceId)) {
    socket.emit('makeJokerMove', {
      roomId,
      pieceId: jokerTargets.pieceId,
      targetPieceId: pieceId,
      cardIndex: jokerTargets.cardIndex
    });
    clearJokerMode();
    return;
  }

  if (!isMyTurn) {
    showStatusMessage('Não é sua vez de jogar!', 'error');
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
    showStatusMessage(`Esta peça pertence ao jogador ${piece.playerId + 1}, não a você`, 'error');
    return;
  }
  
  if (awaitingSecondPiece) {
    if (pieceId === selectedPieceId) {
      showStatusMessage('Selecione uma peça diferente', 'error');
      return;
    }
    const target = gameState.pieces.find(p => p.id === pieceId);
    if (target.inPenaltyZone || target.completed) {
      showStatusMessage('Peça inválida para dividir o movimento', 'error');
      return;
    }
    secondPieceId = pieceId;
    awaitingSecondPiece = false;
    showSliderDialog();
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
  if (selectedPieceId && selectedCardIndex !== null && !awaitingSecondPiece) {
    const value = playerCards[selectedCardIndex]?.value;
    if (value === '7') {
      initiateSpecialMove();
    } else {
      makeMove();
    }
  }
}
   

  // No arquivo game.js do cliente
// No arquivo game.js - Modifique a função handleCardClick
function handleCardClick(index) {
  if (!isMyTurn) {
    showStatusMessage('Não é sua vez de jogar!', 'error');
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
  if (selectedPieceId && selectedCardIndex !== null && !awaitingSecondPiece) {
    const value = playerCards[selectedCardIndex]?.value;
    if (value === '7') {
      initiateSpecialMove();
    } else {
      makeMove();
    }
  }
}

// Adicione esta função auxiliar
function isPlayerStuckInPenalty() {
  const cardElements = document.querySelectorAll('.card');
  return cardElements.length > 0 && cardElements[0].classList.contains('discard-only');
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

    function finalizeSpecialMove() {
        specialMoveDialog.classList.add('hidden');
        awaitingSecondPiece = false;
        secondPieceId = null;
        selectedPieceId = null;
        selectedCardIndex = null;
        updateSelectedPiece();
        updateSelectedCard();
    }

    function initiateSpecialMove() {
        specialMoveCard = selectedCardIndex;
        const movable = gameState.pieces.filter(p =>
            p.playerId === playerPosition && !p.inPenaltyZone && !p.completed
        );

        if (movable.length <= 1) {
            socket.emit('makeSpecialMove', {
                roomId,
                moves: [{ pieceId: selectedPieceId, steps: 7 }],
                cardIndex: specialMoveCard
            });
            finalizeSpecialMove();
            return;
        }

        specialMoveChoice.classList.remove('hidden');
        specialMoveSlider.classList.add('hidden');
        specialMoveDialog.classList.remove('hidden');
    }

    function showSliderDialog() {
        const p1 = gameState.pieces.find(p => p.id === selectedPieceId);
        const p2 = gameState.pieces.find(p => p.id === secondPieceId);
        pieceLeft.textContent = `Peça ${p1.pieceId}`;
        pieceRight.textContent = `Peça ${p2.pieceId}`;
        splitSlider.value = 3;
        updateSliderValues();
        specialMoveChoice.classList.add('hidden');
        specialMoveSlider.classList.remove('hidden');
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
            showStatusMessage('Não há posições ocupadas para mover', 'error');
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
        samePieceBtn.addEventListener('click', () => {
            socket.emit('makeSpecialMove', {
                roomId,
                moves: [{ pieceId: selectedPieceId, steps: 7 }],
                cardIndex: specialMoveCard
            });
            finalizeSpecialMove();
        });

        otherPieceBtn.addEventListener('click', () => {
            specialMoveDialog.classList.add('hidden');
            awaitingSecondPiece = true;
            showStatusMessage('Selecione a segunda peça', 'info');
        });

        splitSlider.addEventListener('input', updateSliderValues);

        confirmSplitBtn.addEventListener('click', () => {
            const val = parseInt(splitSlider.value, 10);
            socket.emit('makeSpecialMove', {
                roomId,
                moves: [
                    { pieceId: selectedPieceId, steps: val },
                    { pieceId: secondPieceId, steps: 7 - val }
                ],
                cardIndex: specialMoveCard
            });
            finalizeSpecialMove();
        });

        cancelJokerMoveBtn.addEventListener('click', () => {
            jokerDialog.classList.add('hidden');
        });

        newGameBtn.addEventListener('click', () => {
            window.location.href = '/';
        });
    }

    function updateSliderValues() {
        const val = parseInt(splitSlider.value, 10);
        sliderValues.textContent = `${val}-${7 - val}`;
    }
    
    // Inicializar o jogo
    init();
});

