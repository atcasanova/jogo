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
    const finalStatsDiv = document.getElementById('final-stats');
    const lastMoveDiv = document.getElementById('last-move');
    const playerHand = document.querySelector('.player-hand');
    const playBuilder = document.getElementById('play-builder');
    const playBuilderText = document.getElementById('play-builder-text');
    const resetPlayBuilderBtn = document.getElementById('reset-play-builder');
    const confirmPlayBuilderBtn = document.getElementById('confirm-play-builder');
    
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

    const statsPanel = document.getElementById('stats-panel');

    let isDraggingHand = false;
    let handOffsetX = 0;
    let handOffsetY = 0;

    if (playerHand) {
      playerHand.addEventListener('mousedown', e => {
        if (!playerHand.classList.contains('floating')) return;
        isDraggingHand = true;
        const rect = playerHand.getBoundingClientRect();
        handOffsetX = e.clientX - rect.left;
        handOffsetY = e.clientY - rect.top;
        playerHand.style.bottom = '';
        playerHand.style.transform = '';
        playerHand.style.left = `${rect.left}px`;
        playerHand.style.top = `${rect.top}px`;
        playerHand.classList.add('dragging');
      });

      document.addEventListener('mousemove', e => {
        if (!isDraggingHand) return;
        playerHand.style.left = `${e.clientX - handOffsetX}px`;
        playerHand.style.top = `${e.clientY - handOffsetY}px`;
      });

      document.addEventListener('mouseup', () => {
        if (!isDraggingHand) return;
        isDraggingHand = false;
        playerHand.classList.remove('dragging');
      });
    }

    // Botões do diálogo de fim de jogo
    const rematchBtn = document.getElementById('rematch-btn');
    const exitBtn = document.getElementById('exit-btn');
    
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
    let validSplits = [];
    let pendingSpecialMove = null;
    let boardSplitMode = false;
    let boardSplitValue = 3;
    const playerColors = ['#3498db', '#f2f2f2', '#e74c3c', '#2ecc71'];
    const homeStretches = [
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

    const pieceElements = {};
    const MOVE_ANIMATION_DURATION_MS = 1000;
    const CARD_HOLD_ANIMATION_DURATION_MS = 500;
    const CARD_TRAVEL_ANIMATION_DURATION_MS = 1000;
    let boardAnimationPromise = Promise.resolve();
    let gameStateUpdateQueue = Promise.resolve();
    let isAnimatingBoard = false;
    let pendingYourTurnData = null;
    let pendingCardsData = null;

    function setPieceNumbersVisible(visible) {
      board?.classList.toggle('show-piece-numbers', visible);
    }

    function ensurePieceLabel(pieceElement, piece) {
      let label = pieceElement.querySelector('.piece-text');
      if (!label) {
        label = document.createElement('span');
        label.className = 'piece-text';
        pieceElement.appendChild(label);
      }
      label.textContent = piece.pieceId;
    }

    function getDisplayValue(card) {
      return card.value === 'JOKER' ? 'C' : card.value;
    }

    function createFloatingCardElement(card) {
      const element = document.createElement('div');
      element.className = 'card turn-card-animation';
      element.innerHTML = createCardHTML(card);
      return element;
    }

    function getPenaltyZoneAnchor(playerId) {
      const anchors = [
        { row: 2, col: 8 },
        { row: 8, col: 16 },
        { row: 16, col: 10 },
        { row: 10, col: 2 }
      ];
      return anchors[playerId] || null;
    }

    function elementCenter(rect) {
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }

    async function animatePlayedCard(cardAnimation) {
      if (!cardAnimation || !cardAnimation.card) return;

      const penaltyAnchor = getPenaltyZoneAnchor(cardAnimation.playerPosition);
      const penaltyCell = penaltyAnchor ? getCell(penaltyAnchor.row, penaltyAnchor.col) : null;
      const deckElement = document.querySelector('.deck .card-back') || document.querySelector('.deck-area');
      if (!penaltyCell || !deckElement) return;

      const startRect = penaltyCell.getBoundingClientRect();
      const endRect = deckElement.getBoundingClientRect();
      const startCenter = elementCenter(startRect);
      const endCenter = elementCenter(endRect);
      const floatingCard = createFloatingCardElement(cardAnimation.card);

      floatingCard.style.left = `${startCenter.x}px`;
      floatingCard.style.top = `${startCenter.y}px`;
      document.body.appendChild(floatingCard);

      await wait(CARD_HOLD_ANIMATION_DURATION_MS);
      await waitForNextFrame();

      const travel = floatingCard.animate([
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${endCenter.x - startCenter.x}px), calc(-50% + ${endCenter.y - startCenter.y}px)) scale(0.72)`,
          opacity: 0.92
        }
      ], {
        duration: CARD_TRAVEL_ANIMATION_DURATION_MS,
        easing: 'ease-in-out',
        fill: 'forwards'
      });

      await travel.finished.catch(() => {});
      floatingCard.remove();
    }


    function showStatusMessage(message, type = 'info') {
      turnMessage.textContent = message;
      turnMessage.className = '';
      turnMessage.classList.add(type);
    }

    function wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    function waitForNextFrame() {
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }

    function cancelElementAnimations(element) {
      element.getAnimations().forEach(animation => {
        try {
          animation.cancel();
        } catch (error) {
          console.warn('Erro ao cancelar animação anterior da peça:', error);
        }
      });
    }

    function positionsEqual(a, b) {
      return Boolean(a && b && a.row === b.row && a.col === b.col);
    }

    function capturePieceRects() {
      const rects = {};
      Object.entries(pieceElements).forEach(([id, element]) => {
        if (element && element.isConnected) {
          rects[id] = element.getBoundingClientRect();
        }
      });
      return rects;
    }

    function getPieceById(state, id) {
      return state?.pieces?.find(piece => piece.id === id) || null;
    }

    function getMoveAnimationDescriptors() {
      if (!Array.isArray(gameState?.moveAnimations)) return [];
      return gameState.moveAnimations
        .filter(move => move && move.pieceId && move.oldPosition && move.newPosition)
        .map((move, index) => ({
          pieceId: move.pieceId,
          from: move.oldPosition,
          to: move.newPosition,
          direction: move.direction,
          order: Number.isFinite(move.order) ? move.order : index
        }));
    }


    function getTrackCoordinates() {
      const track = [];
      for (let col = 0; col <= 18; col++) track.push({ row: 0, col });
      for (let row = 1; row <= 18; row++) track.push({ row, col: 18 });
      for (let col = 17; col >= 0; col--) track.push({ row: 18, col });
      for (let row = 17; row >= 1; row--) track.push({ row, col: 0 });
      return track;
    }

    function positionIndex(path, position) {
      return path.findIndex(pos => positionsEqual(pos, position));
    }

    function pathBetweenIndexes(path, startIndex, endIndex, direction = 'forward') {
      if (startIndex === -1 || endIndex === -1) return [];
      const step = direction === 'backward' ? -1 : 1;
      const positions = [path[startIndex]];
      let index = startIndex;
      while (index !== endIndex) {
        index = (index + step + path.length) % path.length;
        positions.push(path[index]);
        if (positions.length > path.length + 1) break;
      }
      return positions;
    }

    function buildBoardMovementPath(move, piece, previousPiece) {
      const from = move?.from || previousPiece?.position;
      const to = move?.to || piece?.position;
      if (!from || !to || !piece || move?.direction === 'direct' || positionsEqual(from, to)) return [];

      const track = getTrackCoordinates();
      const startTrackIndex = positionIndex(track, from);
      const endTrackIndex = positionIndex(track, to);
      if (startTrackIndex !== -1 && endTrackIndex !== -1) {
        return pathBetweenIndexes(track, startTrackIndex, endTrackIndex, move?.direction || 'forward');
      }

      const homeStretch = homeStretches[piece.playerId] || [];
      const startHomeIndex = positionIndex(homeStretch, from);
      const endHomeIndex = positionIndex(homeStretch, to);
      if (startHomeIndex !== -1 && endHomeIndex !== -1 && endHomeIndex >= startHomeIndex) {
        return homeStretch.slice(startHomeIndex, endHomeIndex + 1);
      }

      if (startTrackIndex !== -1 && endHomeIndex !== -1) {
        const entrances = [
          { row: 0, col: 4 },
          { row: 4, col: 18 },
          { row: 18, col: 14 },
          { row: 14, col: 0 }
        ];
        const entranceIndex = positionIndex(track, entrances[piece.playerId]);
        const boardPath = pathBetweenIndexes(track, startTrackIndex, entranceIndex, 'forward');
        return [...boardPath, ...homeStretch.slice(0, endHomeIndex + 1)];
      }

      return [];
    }

    function viewportDeltaToBoardDelta(deltaX, deltaY, rotation) {
      const radians = -rotation * Math.PI / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      return {
        x: deltaX * cos - deltaY * sin,
        y: deltaX * sin + deltaY * cos
      };
    }

    function rectCenterDelta(fromRect, toRect) {
      return {
        x: (fromRect.left + fromRect.width / 2) - (toRect.left + toRect.width / 2),
        y: (fromRect.top + fromRect.height / 2) - (toRect.top + toRect.height / 2)
      };
    }

    function translateTransformFromViewportDelta(deltaX, deltaY, rotation) {
      const localDelta = viewportDeltaToBoardDelta(deltaX, deltaY, rotation);
      return `translate(${localDelta.x}px, ${localDelta.y}px) rotate(${-rotation}deg)`;
    }

    function buildMovementKeyframes(path, finalRect, rotation) {
      const keyframes = path
        .map(position => getCell(position.row, position.col))
        .filter(Boolean)
        .map(cell => {
          const delta = rectCenterDelta(cell.getBoundingClientRect(), finalRect);
          return {
            transform: translateTransformFromViewportDelta(delta.x, delta.y, rotation)
          };
        });

      keyframes.push({ transform: `rotate(${-rotation}deg)` });
      return keyframes;
    }

    function clearMoveHighlights() {
      board.querySelectorAll('.move-origin, .move-destination').forEach(cell => {
        cell.classList.remove('move-origin', 'move-destination');
      });
    }

    function highlightMoveCells(move) {
      clearMoveHighlights();
      const origin = getCell(move.from.row, move.from.col);
      const destination = getCell(move.to.row, move.to.col);
      if (origin) origin.classList.add('move-origin');
      if (destination) destination.classList.add('move-destination');
    }


    function resetPlayBuilder(clearCard = false) {
      selectedPieceId = null;
      secondPieceId = null;
      awaitingSecondPiece = false;
      if (clearCard) selectedCardIndex = null;
      updateSelectedPiece();
      updateSelectedCard();
      renderPlayBuilder();
      clearBoardSplitSliders();
    }

    function renderPlayBuilder() {
      if (!playBuilder || !playBuilderText) return;
      const selectedCard = selectedCardIndex !== null ? playerCards[selectedCardIndex] : null;
      const cardValue = selectedCard ? getDisplayValue(selectedCard) : '__';
      const pieceA = selectedPieceId ? gameState?.pieces?.find(p => p.id === selectedPieceId) : null;
      const pieceB = secondPieceId ? gameState?.pieces?.find(p => p.id === secondPieceId) : null;
      const text = pieceB
        ? `Jogar ${cardValue} com ${pieceA ? pieceA.pieceId : '__'} e ${pieceB.pieceId}.`
        : `Jogar ${cardValue} com ${pieceA ? pieceA.pieceId : '__'}`;
      playBuilderText.textContent = text;
      const shouldShowConfirm = (
        isMyTurn
        && selectedCard?.value === '7'
        && selectedPieceId
        && secondPieceId
        && validSplits.length > 0
        && !awaitingSecondPiece
      );
      confirmPlayBuilderBtn?.classList.toggle('hidden', !shouldShowConfirm);

      if (isMyTurn || gameState?.lastMove) playBuilder.classList.remove('hidden');
      else playBuilder.classList.add('hidden');
      if (!isMyTurn && gameState?.lastMove) {
        const lastMoveText = typeof gameState.lastMove === 'string'
          ? gameState.lastMove
          : gameState.lastMove.message;
        if (lastMoveText) playBuilderText.textContent = lastMoveText;
      }
    }

    function clearBoardSplitSliders() {
      document.querySelectorAll('.piece-split-slider-wrap').forEach(el => el.remove());
      boardSplitMode = false;
    }

    function showLastMove(message) {
      if (!lastMoveDiv) return;
      if (message) {
        lastMoveDiv.textContent = message;
        lastMoveDiv.classList.remove('hidden');
      } else {
        lastMoveDiv.classList.add('hidden');
      }
    }

    function adjustBoardSize() {
      const info = document.querySelector('.game-info');
      const hand = playerHand;

      const cssMax = Math.min(window.innerWidth * 0.8, window.innerHeight * 0.65);
      let size = cssMax;

      if (info && hand) {
        const availableWithHand = window.innerHeight - info.offsetHeight - hand.offsetHeight - 32;
        if (availableWithHand < 0) {
          hand.classList.add('floating');
          hand.style.bottom = '10px';
          hand.style.left = '50%';
          hand.style.transform = 'translateX(-50%)';
          const available = window.innerHeight - info.offsetHeight - 16;
          size = Math.min(cssMax, available);
        } else {
          hand.classList.remove('floating');
          hand.style.left = '';
          hand.style.top = '';
          hand.style.bottom = '';
          hand.style.transform = '';
          size = Math.min(cssMax, availableWithHand);
        }
      }

      board.style.width = `${size}px`;
      board.style.height = `${size}px`;
    }

    function isPartner(id1, id2) {
      if (!gameState || !gameState.teams) return false;
      return gameState.teams.some(team =>
        team.some(p => p.position === id1) && team.some(p => p.position === id2)
      );
    }

    function hasAllPiecesInHomeStretch(playerId) {
      if (!gameState || !gameState.pieces) return false;
      return gameState.pieces
        .filter(p => p.playerId === playerId)
        .every(p => p.inHomeStretch || p.completed);
    }

    function canControlPiece(controllerId, ownerId) {
      if (controllerId === ownerId) return true;
      return hasAllPiecesInHomeStretch(controllerId) && isPartner(controllerId, ownerId);
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
      adjustBoardSize();

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
  socket.on('gameStarted', handleGameStarted);
  socket.on('gameStateUpdate', enqueueGameStateUpdate);
  socket.on('playerInfo', handlePlayerInfo);
  socket.on('yourTurn', handleYourTurn);
  socket.on('gameOver', handleGameOver);
  socket.on('gameAborted', handleGameAborted);
  socket.on('updateCards', handleUpdateCards);
  socket.on('choosePosition', handleChoosePosition);
  socket.on('homeEntryChoice', handleHomeEntryChoice);
  socket.on('homeEntryChoiceSpecial', handleHomeEntryChoiceSpecial);
  socket.on('lastMove', handleLastMove);
  socket.on('validSplits', handleValidSplits);
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

function handleGameStarted(state) {
  console.log('Novo jogo iniciado:', state);
  gameState = state;
  updateBoard();
  updateTeams();
  updateTurnInfo();
  updateDeckInfo();
  updateStats(state.stats);
  if (state.lastMove) {
    showLastMove(state.lastMove);
  }
  gameOverDialog.classList.add('hidden');
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
    function enqueueGameStateUpdate(state) {
        gameStateUpdateQueue = gameStateUpdateQueue
          .then(() => handleGameStateUpdate(state))
          .catch(error => {
            console.error('Erro ao processar atualização do estado do jogo:', error);
          });
    }

    async function handleGameStateUpdate(state) {
        console.log('Estado do jogo recebido:', state);
        const previousState = gameState;
        gameState = state;

        clearJokerMode();
        
        // Encontrar a posição do jogador
        const player = gameState.players.find(p => p.id === playerId);
        if (player) {
            playerPosition = player.position;
        console.log('Posição do jogador:', playerPosition);
        }

        const hasCardAnimation = Boolean(state.cardAnimation);
        const animationPromise = updateBoard(previousState);
        boardAnimationPromise = animationPromise.catch(error => {
          console.error('Erro ao animar movimento no tabuleiro:', error);
        });
        updateTeams();
        updateDeckInfo(hasCardAnimation ? previousState : state);
        updateStats(state.stats);
        if (state.lastMove) {
            showLastMove(state.lastMove);
        }
        renderPlayBuilder();

        await boardAnimationPromise;
        updateDeckInfo(state);
        updateTurnInfo();
        flushDeferredTurnEvents();
    }
    
function handleUpdateCards(data) {
  if (isAnimatingBoard) {
    pendingCardsData = data;
    return;
  }
  applyCardsUpdate(data);
}

function applyCardsUpdate(data) {
  console.log('Cartas atualizadas recebidas:', data);
  
  if (data.playerPosition !== undefined) {
    playerPosition = data.playerPosition;
    console.log('Posição do jogador atualizada para:', playerPosition);
  }
  
  if (data && data.cards) {
    updateCards(data.cards);
  }

  // Reavaliar o turno atual com base no estado mais recente do jogo
  updateTurnInfo();
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
    enterHome: choice
  });
  finalizeSpecialMove();
}
   

// Modifique a função handleYourTurn
 // No arquivo game.js do cliente - Modifique a função handleYourTurn
function handleYourTurn(data) {
  if (isAnimatingBoard) {
    pendingYourTurnData = data;
    return;
  }
  applyYourTurn(data);
}

function applyYourTurn(data) {
  console.log('É sua vez de jogar!', data);
  isMyTurn = true;
  showStatusMessage('É sua vez de jogar!', 'turn');
  renderPlayBuilder();

  // Atualizar cartas na mão
  if (data && data.cards) {
    console.log('Atualizando cartas:', data.cards);
    updateCards(data.cards);

    // Verificar se o jogador está preso no castigo sem A, K, Q ou J
    checkIfStuckInPenalty(data.cards, data.canMove);
  } else {
    console.error('ERRO: Dados de cartas não recebidos');
  }
}

function flushDeferredTurnEvents() {
  if (pendingCardsData) {
    const data = pendingCardsData;
    pendingCardsData = null;
    applyCardsUpdate(data);
  }

  if (pendingYourTurnData) {
    const data = pendingYourTurnData;
    pendingYourTurnData = null;
    applyYourTurn(data);
  }
}

// Adicione esta função para verificar se o jogador está preso no castigo
function checkIfStuckInPenalty(cards, canMoveFlag) {
  if (!gameState || !gameState.pieces) return;

  const cardElements = cardsContainer.querySelectorAll('.card');

  if (canMoveFlag === false) {
    showStatusMessage('Você não tem jogadas possíveis. Selecione uma carta para descartar.', 'error');
    cardElements.forEach(card => card.classList.add('discard-only'));
    return;
  }

  const playerPieces = gameState.pieces.filter(p => p.playerId === playerPosition);
  const allInPenalty = playerPieces.every(p => p.inPenaltyZone);
  const hasExitCard = cards.some(card => ['A', 'K', 'Q', 'J'].includes(card.value));

  if (allInPenalty && !hasExitCard) {
    showStatusMessage('Você não tem A, K, Q ou J para sair do castigo. Selecione uma carta para descartar.', 'error');
    cardElements.forEach(card => card.classList.add('discard-only'));
  } else {
    cardElements.forEach(card => card.classList.remove('discard-only'));
    showStatusMessage('É sua vez de jogar!', 'turn');
  renderPlayBuilder();
  }
}

    function handleGameOver(data) {
        isMyTurn = false;

        // Mostrar diálogo de fim de jogo
        const winners = data.winners.map(player => player.name).join(' e ');
        winnersDiv.textContent = `Parabéns! ${winners} venceram o jogo!`;

        if (data.stats && finalStatsDiv) {
            const fullStats = data.stats.full || data.stats;
            const summary = data.stats.summary || computeStatsSummary(fullStats);

            const getName = idx => {
                const player = gameState?.players.find(p => p.position === idx);
                return player ? player.name : `Jogador ${idx + 1}`;
            };

            const rows = fullStats.captures.map((_, i) => `
                <tr>
                    <td>${getName(i)}</td>
                    <td>${fullStats.captures[i]}</td>
                    <td>${fullStats.roundsWithoutPlay[i]}</td>
                    <td>${fullStats.jokersPlayed[i]}</td>
                    <td>${fullStats.timesCaptured[i]}</td>
                </tr>`).join('');

            const table = `
                <table class="stats-table">
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>Capturas</th>
                            <th>Preso</th>
                            <th>Jokers</th>
                            <th>Capturado</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>`;

            finalStatsDiv.innerHTML = `
                <p>Maior número de capturas: <strong>${summary.mostCaptures.name || 'N/A'}</strong> (${summary.mostCaptures.count})</p>
                <p>Mais rodadas preso: <strong>${summary.mostRoundsStuck.name || 'N/A'}</strong> (${summary.mostRoundsStuck.count})</p>
                <p>Mais Jokers jogados: <strong>${summary.mostJokers.name || 'N/A'}</strong> (${summary.mostJokers.count})</p>
                <p>Jogador mais capturado: <strong>${summary.mostCaptured.name || 'N/A'}</strong> (${summary.mostCaptured.count})</p>
                <hr>
                ${table}
            `;
        }

        gameOverDialog.classList.remove('hidden');
    }
    
    function handleGameAborted(data) {
        showStatusMessage(data.message, 'error');
        window.location.href = '/';
    }
    
    function handleError(message) {
        showStatusMessage(`Erro: ${message}`, 'error');
        if (pendingSpecialMove && pendingSpecialMove.pieceAId !== pendingSpecialMove.pieceBId) {
            socket.emit('getValidSplits', {
                roomId,
                pieceAId: pendingSpecialMove.pieceAId,
                pieceBId: pendingSpecialMove.pieceBId
            });
        }
    }

    function handleLastMove(data) {
        if (data && data.message) {
            showLastMove(data.message);
        }
    }

    function handleValidSplits(data) {
        validSplits = data.splits || [];
        if (validSplits.length === 0) {
            showStatusMessage('Nenhuma divisão válida disponível', 'error');
            return;
        }
        splitSlider.min = Math.min(...validSplits);
        splitSlider.max = Math.max(...validSplits);
        const mid = validSplits[Math.floor(validSplits.length / 2)];
        splitSlider.value = mid;
        updateSliderValues();
        renderPlayBuilder();
        specialMoveDialog.classList.add('hidden');
        renderBoardSplitSliders();
    }
    

    function renderBoardSplitSliders() {
      clearBoardSplitSliders();
      const a = document.querySelector(`.piece[data-id="${selectedPieceId}"]`);
      const b = document.querySelector(`.piece[data-id="${secondPieceId}"]`);
      if (!a || !b) return;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const vertical = Math.abs(ra.left - rb.left) < 40 || Math.abs(ra.top - rb.top) < 40;
      const mk = (target, isLeft) => {
        const w = document.createElement('div');
        w.className = `piece-split-slider-wrap ${vertical ? 'vertical' : ''}`;
        const out = document.createElement('span');
        const input = document.createElement('input');
        const confirm = document.createElement('button');
        input.type='range'; input.min=Math.min(...validSplits); input.max=Math.max(...validSplits); input.value=boardSplitValue;
        input.addEventListener('input',()=>{ let val=parseInt(input.value,10); if(validSplits.length && !validSplits.includes(val)){ val = validSplits.reduce((a,b)=> Math.abs(b-val) < Math.abs(a-val) ? b : a); input.value=val; } boardSplitValue=val; document.querySelectorAll('.piece-split-slider-wrap .val').forEach((el,i)=> el.textContent = i===0?boardSplitValue:7-boardSplitValue); });
        confirm.type = 'button';
        confirm.className = 'piece-split-confirm';
        confirm.textContent = '✓';
        confirm.title = 'Confirmar divisão';
        confirm.addEventListener('click', submitSpecialSplit);
        out.className='val'; out.textContent = isLeft ? boardSplitValue : 7-boardSplitValue;
        w.append(out,input,confirm);
        target.appendChild(w);
      };
      mk(a,true); mk(b,false);
      boardSplitMode = true;
    }

    function submitSpecialSplit() {
        const val = boardSplitMode ? boardSplitValue : parseInt(splitSlider.value, 10);
        if (validSplits.length > 0 && !validSplits.includes(val)) {
            showStatusMessage('Divisão inválida', 'error');
            return;
        }
        pendingSpecialMove = { pieceAId: selectedPieceId, pieceBId: secondPieceId };
        socket.emit('makeSpecialMove', {
            roomId,
            moves: [
                { pieceId: selectedPieceId, steps: val },
                { pieceId: secondPieceId, steps: 7 - val }
            ],
            cardIndex: specialMoveCard
        });
        finalizeSpecialMove();
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
function updateBoard(previousState = null) {
  if (!gameState) return Promise.resolve();

  clearJokerMode();
  clearMoveHighlights();
  const previousPieceRects = capturePieceRects();
  
  // Limpar tabuleiro
  const cells = board.querySelectorAll('.cell');
  cells.forEach(cell => {
    cell.className = 'cell';
    cell.removeAttribute('style');
    
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
  const animations = positionPieces(previousState, previousPieceRects);

  updatePlayerLabels();

  // Ajustar os rótulos recém-criados sem sobrescrever transforms usados pela animação.
  rotateBoard(false);

  console.log('Tabuleiro atualizado');
  return animateTurnSequence(animations, gameState.cardAnimation);
}


function rotateBoard(rotatePieces = true) {
  // Rotacionar o tabuleiro com base na posição do jogador
  // 0: sem rotação, 1: 90° no sentido anti-horário, 2: 180°, 3: 270° no sentido anti-horário
  if (playerPosition === undefined) return;
  
  // Mapeamento correto para que cada jogador veja suas peças na parte inferior
  // Ordem de rotação para que cada jogador sempre visualize suas peças na parte inferior
  // p0 (topo) -> 180°, p1 (direita) -> 90°, p2 (fundo) -> 0°, p3 (esquerda) -> 270°
  const rotationMap = [180, 90, 0, 270];
  const rotation = rotationMap[playerPosition];
  
  board.style.transform = `rotate(${rotation}deg)`;

  // Rotacionar também as peças na direção oposta para manter orientação correta
  if (rotatePieces) {
    const pieces = document.querySelectorAll('.piece');
    pieces.forEach(piece => {
      piece.style.transform = `rotate(${-rotation}deg)`;
    });
  }

  // Ajustar a grade de nomes para acompanhar o tabuleiro
  const labelsContainer = document.getElementById('player-labels');
  if (labelsContainer) {
    labelsContainer.style.transform = `rotate(${rotation}deg)`;
    const labels = labelsContainer.querySelectorAll('.player-label');
    labels.forEach(label => {
      label.style.transform = `rotate(${-rotation}deg)`;
    });
  }
}

function updatePlayerLabels() {
  const container = document.getElementById('player-labels');
  if (!container || !gameState || !gameState.players) return;

  container.innerHTML = '';

  const basePositions = {
    // Posições base para o tabuleiro sem rotação
    bottom: { row: 17, startCol: 11, endCol: 13 },
    top: { row: 1, startCol: 5, endCol: 7 },
    left: { row: 12, startCol: 1, endCol: 3 },
    right: { row: 10, startCol: 15, endCol: 17 }
  };

  // Orientações corretas para cada posição do jogador
  // Cada array indica onde os jogadores 0 a 3 devem aparecer
  // para quem está nas posições 0 a 3 respectivamente
  const orientationMaps = {
    0: ['bottom', 'left', 'top', 'right'],
    // Para o jogador na posição 1 a rotação aplicada é de 90° no sentido
    // horário, portanto os jogadores devem aparecer na ordem direita,
    // baixo, esquerda e topo
    1: ['right', 'bottom', 'left', 'top'],
    2: ['top', 'right', 'bottom', 'left'],
    // Para a posição 3 o tabuleiro é rotacionado 270° no sentido horário
    // (ou 90° anti-horário), de modo que os jogadores aparecem na ordem
    // esquerda, topo, direita e baixo
    3: ['left', 'top', 'right', 'bottom']
  };

  // Mesma convenção de rotação usada em rotateBoard
  const rotationMap = [180, 90, 0, 270];
  const rotation = rotationMap[playerPosition] || 0;

  function rotatePoint(row, col, rot) {
    switch (rot) {
      case 90:
        return { row: col, col: 18 - row };
      case 180:
        return { row: 18 - row, col: 18 - col };
      case 270:
        return { row: 18 - col, col: row };
      default:
        return { row, col };
    }
  }

  function rotatePosition(pos, rot) {
    // Rotaciona ao contrário para obter a posição correta antes de aplicar a rotação do tabuleiro
    const inv = (360 - rot) % 360;
    const a = rotatePoint(pos.row, pos.startCol, inv);
    const b = rotatePoint(pos.row, pos.endCol, inv);
    const rows = [a.row, b.row];
    const cols = [a.col, b.col];
    return {
      rowStart: Math.min(...rows),
      rowEnd: Math.max(...rows),
      colStart: Math.min(...cols),
      colEnd: Math.max(...cols)
    };
  }

  gameState.players.forEach(p => {
    const label = document.createElement('div');
    label.className = 'player-label';
    label.textContent = p.id === playerId ? 'Você' : p.name;
    if (p.position !== undefined) {
      label.style.color = playerColors[p.position];
    }

    const orientationMap = orientationMaps[playerPosition] || orientationMaps[0];
    const orientation = orientationMap[p.position];
    const base = basePositions[orientation];
    const pos = rotatePosition(base, rotation);

    label.style.gridRowStart = pos.rowStart + 1;
    label.style.gridRowEnd = pos.rowEnd + 2;
    label.style.gridColumnStart = pos.colStart + 1;
    label.style.gridColumnEnd = pos.colEnd + 2;

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
            // Jogador 0 - topo
            [{row: 2, col: 8}, {row: 1, col: 8}, {row: 3, col: 8}, {row: 2, col: 7}, {row: 2, col: 9}],
            // Jogador 1 - direita
            [{row: 8, col: 16}, {row: 7, col: 16}, {row: 9, col: 16}, {row: 8, col: 15}, {row: 8, col: 17}],
            // Jogador 2 - fundo
            [{row: 16, col: 10}, {row: 15, col: 10}, {row: 17, col: 10}, {row: 16, col: 9}, {row: 16, col: 11}],
            // Jogador 3 - esquerda
            [{row: 10, col: 2}, {row: 9, col: 2}, {row: 11, col: 2}, {row: 10, col: 1}, {row: 10, col: 3}]
        ];

        penaltyZones.forEach((zone, idx) => {
            outlineZone(zone, 'penalty', idx);
        });
        
        // Marcar corredores de chegada
        const homeStretches = [
            // Jogador 0 - topo-esquerda
            [{row: 1, col: 4}, {row: 2, col: 4}, {row: 3, col: 4}, {row: 4, col: 4}, {row: 5, col: 4}],
            // Jogador 1 - topo-direita
            [{row: 4, col: 13}, {row: 4, col: 14}, {row: 4, col: 15}, {row: 4, col: 16}, {row: 4, col: 17}],
            // Jogador 2 - fundo-direita
            [{row: 13, col: 14}, {row: 14, col: 14}, {row: 15, col: 14}, {row: 16, col: 14}, {row: 17, col: 14}],
            // Jogador 3 - fundo-esquerda
            [{row: 14, col: 1}, {row: 14, col: 2}, {row: 14, col: 3}, {row: 14, col: 4}, {row: 14, col: 5}]
        ];

        homeStretches.forEach((stretch, idx) => {
            // Outline and color every cell in the home stretch for better visibility
            outlineZone(stretch, 'home-stretch', idx, true);
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

    function outlineZone(zone, className, playerId, fillAll = false) {
        zone.forEach(pos => {
            const cell = getCell(pos.row, pos.col);
            if (!cell) return;
            cell.classList.add(className, `player${playerId}`);
            const color = playerColors[playerId];
            if (fillAll) {
                cell.style.borderColor = color;
            } else {
                const neighbors = {
                    Top: { row: pos.row - 1, col: pos.col },
                    Bottom: { row: pos.row + 1, col: pos.col },
                    Left: { row: pos.row, col: pos.col - 1 },
                    Right: { row: pos.row, col: pos.col + 1 }
                };
                for (const [edge, n] of Object.entries(neighbors)) {
                    const exists = zone.some(p => p.row === n.row && p.col === n.col);
                    if (!exists) {
                        cell.style[`border${edge}Color`] = color;
                    }
                }
            }
        });
    }
    
   // Modifique a função positionPieces

        function positionPieces(previousState = null, previousPieceRects = {}) {
  if (!gameState || !gameState.pieces) {
    console.log('Sem peças para posicionar');
    return [];
  }

  const rotationMap = [180, 90, 0, 270];
  const rotation = rotationMap[playerPosition] || 0;

  console.log(`Posicionando ${gameState.pieces.length} peças`);

  const allMineHome = hasAllPiecesInHomeStretch(playerPosition);
  let partnerId = null;
  if (gameState && gameState.teams) {
    const team = gameState.teams.find(t => t.some(p => p.position === playerPosition));
    if (team) {
      const partner = team.find(p => p.position !== playerPosition);
      partnerId = partner ? partner.position : null;
    }
  }

  const animations = [];
  const moveDescriptors = getMoveAnimationDescriptors();
  const moveDescriptorByPiece = new Map(moveDescriptors.map(move => [move.pieceId, move]));

  gameState.pieces.forEach(piece => {
    const cell = getCell(piece.position.row, piece.position.col);
    if (!cell) {
      console.error(`Célula não encontrada para peça ${piece.id} em (${piece.position.row}, ${piece.position.col})`);
      return;
    }

    let pieceElement = pieceElements[piece.id];
    const shouldHighlight = allMineHome ? piece.playerId === partnerId : piece.playerId === playerPosition;

    if (!pieceElement) {
      pieceElement = document.createElement('div');
      pieceElement.className = `piece player${piece.playerId}`;
      if (shouldHighlight) {
        pieceElement.classList.add('my-piece');
      }
      pieceElement.dataset.id = piece.id;
      pieceElement.style.transform = `rotate(${-rotation}deg)`;
      pieceElement.addEventListener('click', e => {
        e.stopPropagation();
        handlePieceClick(piece.id);
      });
      ensurePieceLabel(pieceElement, piece);
      pieceElements[piece.id] = pieceElement;
      cell.appendChild(pieceElement);
      return;
    }

    pieceElement.className = `piece player${piece.playerId}`;
    if (shouldHighlight) {
      pieceElement.classList.add('my-piece');
    }
    ensurePieceLabel(pieceElement, piece);
    
    const previousPiece = getPieceById(previousState, piece.id);
    const moveDescriptor = moveDescriptorByPiece.get(piece.id);
    const first = previousPieceRects[piece.id];
    const moved = moveDescriptor || (previousPiece && !positionsEqual(previousPiece.position, piece.position));

    // A peça precisa ser anexada à célula de destino para calcular o FLIP,
    // mas não pode ficar visível ali antes de receber o transform inicial.
    // Caso contrário, o navegador pode pintar um frame no destino durante a
    // animação da carta e só depois reposicionar a peça na origem.
    if (moved) {
      cancelElementAnimations(pieceElement);
      pieceElement.style.transition = 'none';
      pieceElement.style.visibility = 'hidden';
    }

    cell.appendChild(pieceElement);
    const last = pieceElement.getBoundingClientRect();
    const delta = first ? rectCenterDelta(first, last) : { x: 0, y: 0 };
    const deltaX = delta.x;
    const deltaY = delta.y;

    pieceElement.style.transition = 'none';
    pieceElement.style.transform = `rotate(${-rotation}deg)`;

    if (moved && (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5)) {
      const boardMovementPath = moveDescriptor ? buildBoardMovementPath(moveDescriptor, piece, previousPiece) : [];
      const keyframes = boardMovementPath.length > 1
        ? buildMovementKeyframes(boardMovementPath, last, rotation)
        : [
            { transform: translateTransformFromViewportDelta(deltaX, deltaY, rotation) },
            { transform: `rotate(${-rotation}deg)` }
          ];

      pieceElement.style.transform = keyframes[0].transform;
      // Mantém a peça real invisível até o instante em que a animação do
      // tabuleiro começa. Assim, se o navegador pintar entre o append na célula
      // final e o início da WAAPI, ele nunca exibe um frame no destino.
      pieceElement.style.visibility = 'hidden';
      animations.push({
        element: pieceElement,
        from: moveDescriptor ? moveDescriptor.from : previousPiece.position,
        to: moveDescriptor ? moveDescriptor.to : piece.position,
        order: moveDescriptor ? moveDescriptor.order : animations.length,
        keyframes,
        initialTransform: keyframes[0].transform,
        finalTransform: `rotate(${-rotation}deg)`
      });
    } else {
      pieceElement.style.visibility = '';
    }
  });

  return animations.sort((a, b) => a.order - b.order);
}

async function animateTurnSequence(animations, cardAnimation) {
  if ((!animations || animations.length === 0) && !cardAnimation) {
    isAnimatingBoard = false;
    return;
  }

  isAnimatingBoard = true;
  isMyTurn = false;
  showStatusMessage('Acompanhando a carta da jogada...', 'info');

  await animatePlayedCard(cardAnimation);
  await animatePieceMoves(animations);

  isAnimatingBoard = false;
}

async function animatePieceMoves(animations) {
  if (!animations || animations.length === 0) {
    return;
  }

  showStatusMessage('Acompanhando a jogada no tabuleiro...', 'info');

  for (const animation of animations) {
    highlightMoveCells(animation);
    cancelElementAnimations(animation.element);
    animation.element.classList.add('moving');
    animation.element.style.transition = 'none';
    animation.element.style.transform = animation.initialTransform || animation.keyframes[0].transform;
    animation.element.style.visibility = '';
    await waitForNextFrame();
    const movement = animation.element.animate(animation.keyframes, {
      duration: MOVE_ANIMATION_DURATION_MS,
      easing: 'ease-in-out',
      fill: 'forwards'
    });

    try {
      await movement.finished;
    } catch (error) {
      // A animação pode ser cancelada por uma atualização mais nova do estado.
    } finally {
      animation.element.style.transform = animation.finalTransform;
      animation.element.style.visibility = '';
      movement.cancel();
      animation.element.classList.remove('moving');
    }
  }

  clearMoveHighlights();
}


    function updateTeams() {
        if (!gameState || !gameState.teams) return;

        const fillTeam = (container, players) => {
            container.innerHTML = '';
            players.forEach((player, index) => {
                const span = document.createElement('span');
                span.textContent = player.name;
                if (player.position !== undefined) {
                    span.style.color = playerColors[player.position];
                }
                if (player.id === playerId) {
                    span.style.fontWeight = 'bold';
                    span.textContent += ' (você)';
                }
                container.appendChild(span);
                if (index < players.length - 1) {
                    container.appendChild(document.createTextNode(' e '));
                }
            });
        };

        fillTeam(team1Players, gameState.teams[0]);
        fillTeam(team2Players, gameState.teams[1]);
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
  renderPlayBuilder();
    console.log('É SUA VEZ DE JOGAR!');
  } else {
    isMyTurn = false;
    showStatusMessage(`Aguardando jogada de ${currentPlayer.name}...`, 'info');
    console.log(`Aguardando jogada de ${currentPlayer.name}`);
  }
}
 
    function updateDeckInfo(stateOverride = gameState) {
        if (!stateOverride) return;
        
        // Atualizar contadores
        deckCount.textContent = stateOverride.deckCount || 0;
        discardCount.textContent = stateOverride.discardCount || 0;
        
        // Mostrar carta no topo da pilha de descarte
        if (stateOverride.discardPile && stateOverride.discardPile.length > 0) {
            const card = stateOverride.discardPile[0];
            topDiscard.innerHTML = createCardHTML(card);
            topDiscard.classList.remove('hidden', 'discard-only');
        } else {
            topDiscard.innerHTML = '';
            topDiscard.classList.remove('discard-only');
            topDiscard.classList.add('hidden');
        }
    }

    function computeStatsSummary(stats) {
        if (!stats || !gameState) return null;

        const getName = idx => {
            const player = gameState.players.find(p => p.position === idx);
            return player ? player.name : `Jogador ${idx + 1}`;
        };

        const pick = arr => {
            const max = Math.max(...arr);
            const idx = arr.indexOf(max);
            return { idx, max };
        };

        return {
            mostCaptures: (() => {
                const { idx, max } = pick(stats.captures);
                return { name: getName(idx), count: max };
            })(),
            mostRoundsStuck: (() => {
                const { idx, max } = pick(stats.roundsWithoutPlay);
                return { name: getName(idx), count: max };
            })(),
            mostJokers: (() => {
                const { idx, max } = pick(stats.jokersPlayed);
                return { name: getName(idx), count: max };
            })(),
            mostCaptured: (() => {
                const { idx, max } = pick(stats.timesCaptured);
                return { name: getName(idx), count: max };
            })()
        };
    }

    function updateStats(stats) {
        if (!stats || !statsPanel) return;

        const summary = computeStatsSummary(stats);
        if (!summary) return;

        statsPanel.innerHTML = `
            <p>Mais capturas: <strong>${summary.mostCaptures.name}</strong> (${summary.mostCaptures.count})</p>
            <p>Preso: <strong>${summary.mostRoundsStuck.name}</strong> (${summary.mostRoundsStuck.count})</p>
            <p>Mais coringas: <strong>${summary.mostJokers.name}</strong> (${summary.mostJokers.count})</p>
            <p>Mais capturado: <strong>${summary.mostCaptured.name}</strong> (${summary.mostCaptured.count})</p>
        `;
        statsPanel.classList.remove('hidden');
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

  // Ajusta o tamanho das cartas conforme o espaço disponível
  const shouldCompact =
    cards.length >= 6 || cardsContainer.scrollWidth > cardsContainer.clientWidth;
  cardsContainer.classList.toggle('compact', shouldCompact);

  // Recalcula o tamanho do tabuleiro após renderizar a mão,
  // garantindo que haja espaço para visualizar as cartas
  adjustBoardSize();

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
  
  if (!canControlPiece(playerPosition, piece.playerId)) {
    showStatusMessage(`Esta peça pertence ao jogador ${piece.playerId + 1}, não a você`, 'error');
    return;
  }
  
  if (awaitingSecondPiece) {
    if (pieceId === selectedPieceId) {
      showStatusMessage('Selecione uma peça diferente', 'error');
      return;
    }
    const target = gameState.pieces.find(p => p.id === pieceId);
    if (!canControlPiece(playerPosition, target.playerId)) {
      showStatusMessage(`Esta peça pertence ao jogador ${target.playerId + 1}, não a você`, 'error');
      return;
    }
    if (target.inPenaltyZone || target.completed) {
      showStatusMessage('Peça inválida para dividir o movimento', 'error');
      return;
    }
    secondPieceId = pieceId;
    awaitingSecondPiece = false;
    renderPlayBuilder();
    showSliderDialog();
    return;
  }

  // Selecionar/desselecionar peça
  if (selectedPieceId === pieceId) {
    selectedPieceId = null;
    updateSelectedPiece();
  renderPlayBuilder();
  } else {
    selectedPieceId = pieceId;
    updateSelectedPiece();
  renderPlayBuilder();
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
  renderPlayBuilder();
  } else {
    selectedCardIndex = index;
    updateSelectedCard();
  renderPlayBuilder();
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
  const cardElements = cardsContainer.querySelectorAll('.card');
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
  renderPlayBuilder();
  updateSelectedCard();
  renderPlayBuilder();
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
        setPieceNumbersVisible(false);
        awaitingSecondPiece = false;
        secondPieceId = null;
        specialMoveCard = null;
        pendingSpecialMove = null;
        clearBoardSplitSliders();
        selectedPieceId = null;
        selectedCardIndex = null;
        updateSelectedPiece();
        updateSelectedCard();
        renderPlayBuilder();
    }

    function initiateSpecialMove() {
        const selectedCard = playerCards[selectedCardIndex];

        if (!selectedCard || selectedCard.value !== '7') {
            setPieceNumbersVisible(false);
            return;
        }

        specialMoveCard = selectedCardIndex;
        const movable = gameState.pieces.filter(p => {
            if (!canControlPiece(playerPosition, p.playerId)) return false;
            if (p.inPenaltyZone || p.completed) return false;
            // Pieces in the home stretch must have at least one legal move
            // available to be considered for the split.
            if (p.inHomeStretch) {
                return canMoveInHomeStretch(p);
            }
            return true;
        });

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
        setPieceNumbersVisible(true);
    }

    function showSliderDialog() {
        const p1 = gameState.pieces.find(p => p.id === selectedPieceId);
        const p2 = gameState.pieces.find(p => p.id === secondPieceId);
        pieceLeft.textContent = `Peça ${p1.pieceId}`;
        pieceRight.textContent = `Peça ${p2.pieceId}`;
        socket.emit('getValidSplits', {
            roomId,
            pieceAId: selectedPieceId,
            pieceBId: secondPieceId
        });
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

    function homeStretchForPlayer(id) {
        return homeStretches[id];
    }

    function canMoveInHomeStretch(piece) {
        const stretch = homeStretchForPlayer(piece.playerId);
        const idx = stretch.findIndex(pos => pos.row === piece.position.row && pos.col === piece.position.col);
        if (idx === -1) return false;

        for (let steps = 1; steps <= 7 && idx + steps < stretch.length; steps++) {
            let pathClear = true;
            for (let i = idx + 1; i <= idx + steps; i++) {
                const pos = stretch[i];
                const occupying = gameState.pieces.find(p => p.id !== piece.id && !p.completed && !p.inPenaltyZone && p.position.row === pos.row && p.position.col === pos.col);
                if (occupying) {
                    pathClear = false;
                    break;
                }
            }
            if (pathClear) return true;
        }
        return false;
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
            pendingSpecialMove = { pieceAId: selectedPieceId, pieceBId: selectedPieceId };
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

        confirmSplitBtn.addEventListener('click', submitSpecialSplit);

        cancelJokerMoveBtn.addEventListener('click', () => {
            jokerDialog.classList.add('hidden');
        });

        rematchBtn.addEventListener('click', () => {
            socket.emit('rematch', { roomId });
            gameOverDialog.classList.add('hidden');
        });

        exitBtn.addEventListener('click', () => {
            window.location.href = '/';
        });

        window.addEventListener('resize', adjustBoardSize);
        window.addEventListener('orientationchange', adjustBoardSize);
        resetPlayBuilderBtn?.addEventListener('click', () => resetPlayBuilder(true));
        confirmPlayBuilderBtn?.addEventListener('click', submitSpecialSplit);
    }

    function updateSliderValues() {
        let val = parseInt(splitSlider.value, 10);
        if (validSplits.length > 0 && !validSplits.includes(val)) {
            const nearest = validSplits.reduce((a, b) => Math.abs(b - val) < Math.abs(a - val) ? b : a);
            splitSlider.value = nearest;
            val = nearest;
        }
        const leftValue = val;
        const rightValue = 7 - val;

        const leftPillValue = document.querySelector('.pill-value[data-label="left"]');
        const rightPillValue = document.querySelector('.pill-value[data-label="right"]');

        if (leftPillValue) {
            leftPillValue.textContent = `${leftValue} casa${leftValue === 1 ? '' : 's'}`;
        }

        if (rightPillValue) {
            rightPillValue.textContent = `${rightValue} casa${rightValue === 1 ? '' : 's'}`;
        }

        sliderValues.innerHTML = `<span class="readout-highlight">${leftValue}</span> / <span class="readout-highlight">${rightValue}</span> passos`;
    }
    
    // Inicializar o jogo
    init();
});
