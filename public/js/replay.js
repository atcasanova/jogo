// file: public/js/replay.js

document.addEventListener('DOMContentLoaded', () => {
  const inputBlock = document.getElementById('replay-input');
  const textarea = document.getElementById('replay-data');
  const loadBtn = document.getElementById('load-replay');

  const gameContainer = document.querySelector('.game-container');
  const board = document.getElementById('board');
  const team1Span = document.getElementById('team1-players');
  const team2Span = document.getElementById('team2-players');
  const currentPlayerSpan = document.getElementById('current-player');
  const deckCountSpan = document.getElementById('deck-count');
  const discardCountSpan = document.getElementById('discard-count');
  const topDiscard = document.getElementById('top-discard');
  const lastMoveDiv = document.getElementById('last-move');
  const moveIndexSpan = document.getElementById('move-index');
  const prevBtn = document.getElementById('prev-move');
  const nextBtn = document.getElementById('next-move');
  const fileList = document.getElementById('replay-files');
  const cardsContainer = document.getElementById('cards-container');
  const playerHand = document.querySelector('.player-hand');

  const playerColors = ['#3498db', '#000000', '#e74c3c', '#2ecc71'];
  let replayData = [];
  let idx = 0;
  let pieceElements = {};

  function startReplay(dataArr) {
    if (!Array.isArray(dataArr) || dataArr.length === 0) return;
    replayData = dataArr;
    idx = 0;
    inputBlock.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    createBoard();
    markSpecialCells();
    renderCurrent();
    adjustBoardSize();
  }

  const params = new URLSearchParams(window.location.search);
  const fileParam = params.get('file');
  if (fileParam) {
    fetch(`/replays/${encodeURIComponent(fileParam)}`)
      .then(res => res.text())
      .then(text => {
        const arr = parseInput(text);
        if (arr && arr.length > 0) startReplay(arr);
      })
      .catch(err => console.error('Failed to load replay', err));
  }


  if (fileList) {
    fetch('/replays')
      .then(res => res.json())
      .then(files => {
        fileList.innerHTML = '';
        files.forEach(f => {
          const li = document.createElement('li');
          const a = document.createElement('a');
          a.href = `/replay?file=${encodeURIComponent(f.file)}`;
          a.textContent = f.file;
          li.appendChild(a);
          fileList.appendChild(li);
        });
      })
      .catch(err => console.error('Failed to load replay list', err));
  }

  loadBtn.addEventListener('click', () => {
    const parsed = parseInput(textarea.value);
    if (parsed && parsed.length > 0) {
      startReplay(parsed);
    }
  });

  prevBtn.addEventListener('click', () => {
    if (idx > 0) {
      idx--;
      renderCurrent();
    }
  });

  nextBtn.addEventListener('click', () => {
    if (idx < replayData.length - 1) {
      idx++;
      renderCurrent();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') prevBtn.click();
    if (e.key === 'ArrowRight') nextBtn.click();
  });

  function parseInput(text) {
    if (!text) return null;
    text = text.trim();
    if (!text) return null;
    try {
      const obj = JSON.parse(text);
      if (Array.isArray(obj)) {
        return obj;
      }
      if (obj && Array.isArray(obj.history)) {
        return obj.history;
      }
    } catch (err) {
      // Fallback to line-delimited JSON
    }
    const lines = text.split(/\n/).filter(l => l.trim());
    const arr = [];
    for (const line of lines) {
      try {
        arr.push(JSON.parse(line));
      } catch (err) {
        alert('Linha inválida: ' + line);
        return null;
      }
    }
    return arr;
  }

  function renderCurrent() {
    const item = replayData[idx];
    if (!item || !item.state) return;
    const state = item.state;
    moveIndexSpan.textContent = `${idx + 1}/${replayData.length}`;
    lastMoveDiv.textContent = item.move || '';
    updateInfo(state);
    updateBoard(state);
    const currentCards =
      state.currentPlayerCards ||
      (state.players &&
        state.players[state.currentPlayerIndex] &&
        state.players[state.currentPlayerIndex].cards) ||
      [];
    updateCards(currentCards);
    if (playerHand) {
      playerHand.style.backgroundColor = playerColors[state.currentPlayerIndex];
    }
  }

  function updateInfo(state) {
    const players = state.players;
    team1Span.textContent = `${players[0].name} e ${players[2].name}`;
    team2Span.textContent = `${players[1].name} e ${players[3].name}`;
    currentPlayerSpan.textContent = players[state.currentPlayerIndex].name;
    deckCountSpan.textContent = state.deckCount;
    discardCountSpan.textContent = state.discardCount;
    if (state.discardPile && state.discardPile.length > 0) {
      topDiscard.innerHTML = createCardHTML(state.discardPile[0]);
      topDiscard.classList.remove('hidden');
    } else {
      topDiscard.innerHTML = '';
      topDiscard.classList.add('hidden');
    }
  }

  function updateBoard(state) {
    const cells = board.querySelectorAll('.cell');
    cells.forEach(cell => {
      const p = cell.querySelector('.piece');
      if (p) cell.removeChild(p);
    });

    state.pieces.forEach(piece => {
      const cell = getCell(piece.position.row, piece.position.col);
      if (!cell) return;
      let el = pieceElements[piece.id];
      if (!el) {
        el = document.createElement('div');
        el.className = `piece player${piece.playerId}`;
        el.textContent = piece.pieceId;
        pieceElements[piece.id] = el;
      }
      cell.appendChild(el);
    });
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

  function getDisplayValue(card) {
    return card.value === 'JOKER' ? 'C' : card.value;
  }

  function createCardHTML(card) {
    const isRed = card.suit === '\u2665' || card.suit === '\u2666';
    const val = getDisplayValue(card);
    return `
      <div class="card-value">${val}</div>
      <div class="card-suit ${isRed ? 'red' : 'black'}">${card.suit}</div>
    `;
  }

  function updateCards(cards) {
    if (!cardsContainer) return;
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

  function adjustBoardSize() {
    const info = document.querySelector('.game-info');
    const hand = document.querySelector('.player-hand');
    const cssMax = Math.min(window.innerWidth * 0.8, window.innerHeight * 0.8);
    let size = cssMax;
    if (info && hand) {
      const available = window.innerHeight - info.offsetHeight - hand.offsetHeight - 32;
      size = Math.min(cssMax, available);
    }
    board.style.width = `${size}px`;
    board.style.height = `${size}px`;
  }

  window.addEventListener('resize', adjustBoardSize);
});
