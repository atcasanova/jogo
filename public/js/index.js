// file: public/js/index.js
document.addEventListener('DOMContentLoaded', () => {
    // Elementos da interface
    const welcomeScreen = document.getElementById('welcome-screen');
    const joinRoomScreen = document.getElementById('join-room-screen');
    const waitingRoom = document.getElementById('waiting-room');
    const playerNameInput = document.getElementById('player-name');
    const roomIdInput = document.getElementById('room-id');
    const roomCodeSpan = document.getElementById('room-code');
    const playersList = document.getElementById('players-list');
    const teamsSetup = document.getElementById('teams-setup');
    const team1List = document.getElementById('team1-list');
    const team2List = document.getElementById('team2-list');
    const waitingMessage = document.getElementById('waiting-message');
    
    // Botões
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const confirmJoinBtn = document.getElementById('confirm-join-btn');
    const backBtn = document.getElementById('back-btn');
    const confirmTeamsBtn = document.getElementById('confirm-teams-btn');
    
    // Estado da aplicação
    let socket;
    let playerId;
    let roomId;
    let players = [];
    let teams = [[], []];
    let isRoomCreator = false;
    
    // Inicializar Socket.io
    function initSocket() {
        socket = io();
        
        // Eventos do socket
        socket.on('roomCreated', handleRoomCreated);
        socket.on('roomJoined', handleRoomJoined);
        socket.on('updatePlayers', handleUpdatePlayers);
        socket.on('teamsSet', handleTeamsSet);
        socket.on('gameStarted', handleGameStarted);
        socket.on('error', handleError);
    }
    
    // Manipuladores de eventos do socket
    function handleRoomCreated(data) {
        roomId = data.roomId;
        playerId = data.playerId;
        isRoomCreator = true;
        
        roomCodeSpan.textContent = roomId;
        showWaitingRoom();
    }
    
    function handleRoomJoined(data) {
        console.log('Evento roomJoined recebido:', data);
        
        roomId = data.roomId;
        playerId = data.playerId;
        
        roomCodeSpan.textContent = roomId;
        showWaitingRoom();
        
        // Se for uma reconexão, não fazer nada mais
        if (data.isReconnection) {
            console.log('Reconectado à sala existente');
            return;
        }
        
        console.log('Entrando na sala de espera');
    }
    
    function handleUpdatePlayers(updatedPlayers) {
        players = updatedPlayers;
        updatePlayersList();
        
        // Atualizar mensagem de espera
        waitingMessage.textContent = `Aguardando mais jogadores... (${players.length}/4)`;
        
        // Mostrar configuração de times se houver 4 jogadores e o usuário é o criador
        if (players.length === 4 && isRoomCreator) {
            teamsSetup.classList.remove('hidden');
            waitingMessage.classList.add('hidden');
            populateTeamLists();
        }
    }
    
    function handleTeamsSet(updatedTeams) {
        teams = updatedTeams;
        // Aguardar início do jogo
        waitingMessage.textContent = 'Times definidos! O jogo começará em breve...';
        waitingMessage.classList.remove('hidden');
        teamsSetup.classList.add('hidden');
    }
    
   // No arquivo index.js - Modifique a função handleGameStarted

// No arquivo index.js - Modifique a função handleGameStarted
// No arquivo index.js - Modifique a função handleGameStarted
function handleGameStarted(gameState) {
  console.log(`Evento gameStarted recebido:`, gameState);
  
  if (!gameState || !gameState.roomId) {
    console.error(`Estado do jogo inválido:`, gameState);
    alert('Erro ao iniciar o jogo. Estado do jogo inválido.');
    return;
  }
  
  // Encontrar o jogador atual na lista de jogadores
  const currentPlayer = players.find(p => p.id === playerId);
  
  if (!currentPlayer) {
    console.error('Jogador atual não encontrado');
    alert('Erro ao iniciar o jogo. Jogador não encontrado.');
    return;
  }
  
  // Criar um identificador único para este jogador
  const playerKey = `game_${gameState.roomId}_player`;
  
  // Salvar informações do jogador de forma mais segura
  const playerData = {
    name: currentPlayer.name,
    position: players.indexOf(currentPlayer),
    id: playerId,
    roomId: gameState.roomId
  };
  
  // Salvar como string JSON no localStorage
  localStorage.setItem(playerKey, JSON.stringify(playerData));
  
  console.log(`Dados do jogador salvos: ${JSON.stringify(playerData)}`);
  
  // Redirecionar para a página do jogo
  console.log(`Redirecionando para game.html?roomId=${gameState.roomId}`);
  window.location.href = `/game.html?roomId=${gameState.roomId}`;
}

function handleError(message) {
        alert(`Erro: ${message}`);
    }
    
    // Funções auxiliares
    function showJoinRoomScreen() {
        welcomeScreen.classList.add('hidden');
        joinRoomScreen.classList.remove('hidden');
        waitingRoom.classList.add('hidden');
    }
    
    function showWelcomeScreen() {
        welcomeScreen.classList.remove('hidden');
        joinRoomScreen.classList.add('hidden');
        waitingRoom.classList.add('hidden');
    }
    
    function showWaitingRoom() {
        welcomeScreen.classList.add('hidden');
        joinRoomScreen.classList.add('hidden');
        waitingRoom.classList.remove('hidden');
    }
    
    function updatePlayersList() {
        playersList.innerHTML = '';
        players.forEach(player => {
            const li = document.createElement('li');
            li.textContent = player.name;
            if (player.id === playerId) {
                li.textContent += ' (você)';
                li.style.fontWeight = 'bold';
            }
            playersList.appendChild(li);
        });
    }
    
    function populateTeamLists() {
        team1List.innerHTML = '';
        team2List.innerHTML = '';
        
        players.forEach(player => {
            const li = document.createElement('li');
            li.textContent = player.name;
            li.dataset.id = player.id;
            
            // Verificar se o jogador já está em algum time
            const team1 = teams[0].find(p => p.id === player.id);
            const team2 = teams[1].find(p => p.id === player.id);
            
            if (team1) {
                li.classList.add('selected');
                team1List.appendChild(li);
            } else if (team2) {
                li.classList.add('selected');
                team2List.appendChild(li);
            } else {
                // Se não estiver em nenhum time, adicionar ao time 1 por padrão
                team1List.appendChild(li);
            }
            
            // Adicionar evento de clique para mover entre times
            li.addEventListener('click', () => {
                movePlayerBetweenTeams(li);
            });
        });
    }
    
    function movePlayerBetweenTeams(playerElement) {
        const playerId = playerElement.dataset.id;
        
        // Se estiver no time 1, mover para o time 2
        if (playerElement.parentElement === team1List) {
            team2List.appendChild(playerElement);
        } 
        // Se estiver no time 2, mover para o time 1
        else if (playerElement.parentElement === team2List) {
            team1List.appendChild(playerElement);
        }
    }
    
    function validateTeams() {
        // Verificar se cada time tem exatamente 2 jogadores
        return team1List.children.length === 2 && team2List.children.length === 2;
    }
    
    // Event listeners
    createRoomBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        if (!playerName) {
            alert('Por favor, digite seu nome');
            return;
        }
        
        initSocket();
        socket.emit('createRoom', playerName);
    });
    
    joinRoomBtn.addEventListener('click', () => {
        const playerName = playerNameInput.value.trim();
        if (!playerName) {
            alert('Por favor, digite seu nome');
            return;
        }
        
        initSocket();
        showJoinRoomScreen();
    });
    
    confirmJoinBtn.addEventListener('click', () => {
        const roomId = roomIdInput.value.trim();
        const playerName = playerNameInput.value.trim();
        
        if (!roomId) {
            alert('Por favor, digite o código da sala');
            return;
        }
        
        socket.emit('joinRoom', { roomId, playerName });
    });
    
    backBtn.addEventListener('click', () => {
        showWelcomeScreen();
    });
    
    confirmTeamsBtn.addEventListener('click', () => {
        if (!validateTeams()) {
            alert('Cada time deve ter exatamente 2 jogadores');
            return;
        }
        
        // Obter IDs dos jogadores em cada time
        const team1Ids = Array.from(team1List.children).map(li => li.dataset.id);
        const team2Ids = Array.from(team2List.children).map(li => li.dataset.id);
        
        socket.emit('setTeams', { roomId, teams: [team1Ids, team2Ids] });
    });
});

