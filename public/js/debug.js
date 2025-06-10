// Simple debug viewer for game UI

document.addEventListener('DOMContentLoaded', () => {
  const board = document.getElementById('board');
  const team1Span = document.getElementById('team1-players');
  const team2Span = document.getElementById('team2-players');
  const currentPlayerSpan = document.getElementById('current-player');
  const pagination = document.getElementById('debug-pagination');
  const cardsContainer = document.getElementById('cards-container');
  const deckCountSpan = document.getElementById('deck-count');
  const discardCountSpan = document.getElementById('discard-count');
  const topDiscard = document.getElementById('top-discard');

  const playerColors = ['#3498db', '#000000', '#e74c3c', '#2ecc71'];

  const players = [
    { id: 'p0', name: 'Jogador 1', position: 0 },
    { id: 'p1', name: 'Jogador 2', position: 1 },
    { id: 'p2', name: 'Jogador 3', position: 2 },
    { id: 'p3', name: 'Jogador 4', position: 3 }
  ];

  const cardValues = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
  const cardSuits = ['\u2660','\u2665','\u2666','\u2663']; // ♠ ♥ ♦ ♣

  function generateHands() {
    return cardSuits.map((suit, idx) => {
      const start = (idx * 3) % cardValues.length;
      const hand = [];
      for (let i = 0; i < 6; i++) {
        hand.push({ value: cardValues[(start + i) % cardValues.length], suit });
      }
      return hand;
    });
  }

  const gameState = {
    players,
    teams: [ [players[0], players[2]], [players[1], players[3]] ],
    currentPlayerIndex: 0,
    pieces: initializePieces(),
    hands: generateHands(),
    discardPile: [{ value: 'Q', suit: '\u2663' }],
    deckCount: 100,
    discardCount: 1
  };

  let playerPosition = 0;
  const pieceElements = {};

  createBoard();
  markSpecialCells();
  updateInfo();
  positionPieces();
  rotateBoard();
  updatePlayerLabels();
  rotateBoard();
  updateDeckInfo();
  updateCards();
  adjustBoardSize();

  window.addEventListener('resize', adjustBoardSize);

  // Pagination buttons
  for (let i = 0; i < 4; i++) {
    const btn = document.createElement('button');
    btn.textContent = String(i + 1);
    btn.dataset.pos = i;
    if (i === 0) btn.classList.add('active');
    btn.addEventListener('click', () => {
      playerPosition = parseInt(btn.dataset.pos, 10);
      pagination.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateBoardView();
    });
    pagination.appendChild(btn);
  }

  function updateBoardView() {
    // clear pieces and reapply orientation
    const cells = board.querySelectorAll('.cell');
    cells.forEach(cell => {
      const p = cell.querySelector('.piece');
      if (p) cell.removeChild(p);
    });
    positionPieces();
    rotateBoard();
    updatePlayerLabels();
    rotateBoard();
    updateCards();
  }

  function updateInfo() {
    team1Span.textContent = `${players[0].name} e ${players[2].name}`;
    team2Span.textContent = `${players[1].name} e ${players[3].name}`;
    currentPlayerSpan.textContent = players[gameState.currentPlayerIndex].name;
  }

  function createBoard() {
    for (let row = 0; row < 19; row++) {
      for (let col = 0; col < 19; col++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.row = row;
        cell.dataset.col = col;
        board.appendChild(cell);
      }
    }
  }

  function getCell(row, col) {
    return board.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
  }

  function markCellIfExists(row, col, className) {
    const cell = getCell(row, col);
    if (cell) cell.classList.add(className);
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
          if (!exists) cell.style[`border${edge}Color`] = color;
        }
      }
    });
  }

  function markSpecialCells() {
    for (let i = 0; i < 19; i++) {
      markCellIfExists(0, i, 'track');
      markCellIfExists(18, i, 'track');
      markCellIfExists(i, 0, 'track');
      markCellIfExists(i, 18, 'track');
    }

    const penaltyZones = [
      [{row:2,col:8},{row:1,col:8},{row:3,col:8},{row:2,col:7},{row:2,col:9}],
      [{row:8,col:16},{row:7,col:16},{row:9,col:16},{row:8,col:15},{row:8,col:17}],
      [{row:16,col:10},{row:15,col:10},{row:17,col:10},{row:16,col:9},{row:16,col:11}],
      [{row:10,col:2},{row:9,col:2},{row:11,col:2},{row:10,col:1},{row:10,col:3}]
    ];
    penaltyZones.forEach((z,idx)=>outlineZone(z,'penalty',idx));

    const homeStretches = [
      [{row:1,col:4},{row:2,col:4},{row:3,col:4},{row:4,col:4},{row:5,col:4}],
      [{row:4,col:13},{row:4,col:14},{row:4,col:15},{row:4,col:16},{row:4,col:17}],
      [{row:13,col:14},{row:14,col:14},{row:15,col:14},{row:16,col:14},{row:17,col:14}],
      [{row:14,col:1},{row:14,col:2},{row:14,col:3},{row:14,col:4},{row:14,col:5}]
    ];
    homeStretches.forEach((s,idx)=>outlineZone(s,'home-stretch',idx,true));

    for (let r=6;r<=12;r++) {
      for (let c=7;c<=11;c++) {
        markCellIfExists(r,c,'discard-area');
      }
    }
  }

  function initializePieces() {
    const zones = [
      [{row:2,col:8},{row:1,col:8},{row:3,col:8},{row:2,col:7},{row:2,col:9}],
      [{row:8,col:16},{row:7,col:16},{row:9,col:16},{row:8,col:15},{row:8,col:17}],
      [{row:16,col:10},{row:15,col:10},{row:17,col:10},{row:16,col:9},{row:16,col:11}],
      [{row:10,col:2},{row:9,col:2},{row:11,col:2},{row:10,col:1},{row:10,col:3}]
    ];
    const pieces = [];
    for (let pid=0; pid<4; pid++) {
      for (let i=0;i<5;i++) {
        pieces.push({
          id: `p${pid}_${i+1}`,
          playerId: pid,
          pieceId: i+1,
          position: zones[pid][i],
          inPenaltyZone: true,
          inHomeStretch: false,
          completed: false
        });
      }
    }
    return pieces;
  }

  function positionPieces() {
    gameState.pieces.forEach(piece => {
      const cell = getCell(piece.position.row, piece.position.col);
      if (!cell) return;
      let el = pieceElements[piece.id];
      if (!el) {
        el = document.createElement('div');
        el.className = `piece player${piece.playerId}`;
        el.textContent = piece.pieceId;
        pieceElements[piece.id] = el;
        cell.appendChild(el);
      } else {
        cell.appendChild(el);
      }
      const rotationMap = [180,90,0,270];
      el.style.transform = `rotate(${-rotationMap[playerPosition]}deg)`;
    });
  }

  function rotateBoard() {
    const rotationMap = [180,90,0,270];
    const rot = rotationMap[playerPosition];
    board.style.transform = `rotate(${rot}deg)`;
    document.getElementById('player-labels').style.transform = `rotate(${rot}deg)`;
    document.querySelectorAll('.piece').forEach(p => {
      p.style.transform = `rotate(${-rot}deg)`;
    });
    const labels = document.querySelectorAll('.player-label');
    labels.forEach(l => l.style.transform = `rotate(${-rot}deg)`);
  }

  function updatePlayerLabels() {
    const container = document.getElementById('player-labels');
    container.innerHTML = '';
    const base = {
      bottom:{row:17,startCol:11,endCol:13},
      top:{row:1,startCol:5,endCol:7},
      left:{row:12,startCol:1,endCol:3},
      right:{row:10,startCol:15,endCol:17}
    };
    const orientationMaps={
      0:['bottom','left','top','right'],
      1:['right','bottom','left','top'],
      2:['top','right','bottom','left'],
      3:['left','top','right','bottom']
    };
    const rotationMap=[180,90,0,270];
    const rot=rotationMap[playerPosition];

    function rotatePoint(r,c,rot){
      switch(rot){
        case 90: return {row:c,col:18-r};
        case 180:return{row:18-r,col:18-c};
        case 270:return{row:18-c,col:r};
        default:return{row:r,col:c};
      }
    }
    function rotatePosition(pos,rot){
      const inv=(360-rot)%360;
      const a=rotatePoint(pos.row,pos.startCol,inv);
      const b=rotatePoint(pos.row,pos.endCol,inv);
      const rows=[a.row,b.row];
      const cols=[a.col,b.col];
      return{rowStart:Math.min(...rows),rowEnd:Math.max(...rows),colStart:Math.min(...cols),colEnd:Math.max(...cols)};
    }

    gameState.players.forEach(p=>{
      const label=document.createElement('div');
      label.className='player-label';
      label.textContent=p.name;
      label.style.color=playerColors[p.position];
      const orientation=orientationMaps[playerPosition][p.position];
      const pos=rotatePosition(base[orientation],rot);
      label.style.gridRowStart=pos.rowStart+1;
      label.style.gridRowEnd=pos.rowEnd+2;
      label.style.gridColumnStart=pos.colStart+1;
      label.style.gridColumnEnd=pos.colEnd+2;
      container.appendChild(label);
    });
  }

  function getDisplayValue(card) {
    return card.value === 'JOKER' ? 'C' : card.value;
  }

  function createCardHTML(card) {
    const isRed = card.suit === '\u2665' || card.suit === '\u2666';
    const val = getDisplayValue(card);
    return `\n      <div class="card-value">${val}</div>\n      <div class="card-suit ${isRed ? 'red' : 'black'}">${card.suit}</div>`;
  }

  function updateCards() {
    const cards = gameState.hands[playerPosition];
    cardsContainer.innerHTML = '';
    cards.forEach(card => {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = createCardHTML(card);
      cardsContainer.appendChild(el);
    });
    cardsContainer.classList.remove('compact');
    if (cardsContainer.scrollWidth > cardsContainer.clientWidth) {
      cardsContainer.classList.add('compact');
    }
  }

  function updateDeckInfo() {
    deckCountSpan.textContent = gameState.deckCount;
    discardCountSpan.textContent = gameState.discardCount;
    if (gameState.discardPile && gameState.discardPile.length > 0) {
      topDiscard.innerHTML = createCardHTML(gameState.discardPile[0]);
      topDiscard.classList.remove('hidden');
    } else {
      topDiscard.innerHTML = '';
      topDiscard.classList.add('hidden');
    }
  }

  function adjustBoardSize() {
    const info = document.querySelector('.game-info');
    const hand = document.querySelector('.player-hand');
    const cssMax = Math.min(window.innerWidth * 0.8, window.innerHeight * 0.65);
    let size = cssMax;
    if (info && hand) {
      const available = window.innerHeight - info.offsetHeight - hand.offsetHeight - 32;
      size = Math.min(cssMax, available);
    }
    board.style.width = `${size}px`;
    board.style.height = `${size}px`;
  }
});
