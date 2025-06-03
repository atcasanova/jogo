// file: server/utils.js
// Criar e embaralhar o baralho
function createDeck() {
  const suits = ['♠', '♥', '♦', '♣'];
  const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
  
  let deck = [];
  
  // Criar 2 baralhos completos
  for (let i = 0; i < 2; i++) {
    for (const suit of suits) {
      for (const value of values) {
        deck.push({ suit, value });
      }
    }
  }
  
  // Adicionar 4 coringas
  for (let i = 0; i < 4; i++) {
    deck.push({ suit: '★', value: 'JOKER' });
  }
  
  return deck;
}

function shuffle(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

// Layout do tabuleiro 19x19
// Definindo apenas as casas especiais, o resto será preenchido pelo frontend
const boardLayout = Array(19).fill().map(() => Array(19).fill('b')); // 'b' para casas em branco

// Preencher a pista principal (contorno)
for (let i = 0; i < 19; i++) {
  boardLayout[0][i] = 'x'; // Linha superior
  boardLayout[18][i] = 'x'; // Linha inferior
  boardLayout[i][0] = 'x'; // Coluna esquerda
  boardLayout[i][18] = 'x'; // Coluna direita
}

// Zonas de castigo (cruzes)
// Topo
boardLayout[2][8] = 'c';
boardLayout[1][8] = 'c';
boardLayout[3][8] = 'c';
boardLayout[2][7] = 'c';
boardLayout[2][9] = 'c';

// Direita
boardLayout[8][16] = 'c';
boardLayout[7][16] = 'c';
boardLayout[9][16] = 'c';
boardLayout[8][15] = 'c';
boardLayout[8][17] = 'c';

// Fundo
boardLayout[16][10] = 'c';
boardLayout[15][10] = 'c';
boardLayout[17][10] = 'c';
boardLayout[16][9] = 'c';
boardLayout[16][11] = 'c';

// Esquerda
boardLayout[10][2] = 'c';
boardLayout[9][2] = 'c';
boardLayout[11][2] = 'c';
boardLayout[10][1] = 'c';
boardLayout[10][3] = 'c';

// Corredores de chegada
// Topo-Esquerda
boardLayout[1][4] = 'e';
boardLayout[2][4] = 'e';
boardLayout[3][4] = 'e';
boardLayout[4][4] = 'e';
boardLayout[5][4] = 'e';

// Topo-Direita
boardLayout[4][13] = 'e';
boardLayout[4][14] = 'e';
boardLayout[4][15] = 'e';
boardLayout[4][16] = 'e';
boardLayout[4][17] = 'e';

// Fundo-Direita
boardLayout[13][15] = 'e';
boardLayout[14][15] = 'e';
boardLayout[15][15] = 'e';
boardLayout[16][15] = 'e';
boardLayout[17][15] = 'e';

// Fundo-Esquerda
boardLayout[14][1] = 'e';
boardLayout[14][2] = 'e';
boardLayout[14][3] = 'e';
boardLayout[14][4] = 'e';
boardLayout[14][5] = 'e';

// Área de descarte (centro)
for (let row = 6; row <= 12; row++) {
  for (let col = 7; col <= 11; col++) {
    boardLayout[row][col] = 'd';
  }
}

module.exports = {
  createDeck,
  shuffle,
  boardLayout
};

