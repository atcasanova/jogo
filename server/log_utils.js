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

  const snap = game.getGameStateWithCards();
  delete snap.lastMove;
  snap.currentPlayerCards = player.cards.map(c => ({ ...c }));
  game.history.push({ move: `Turno de ${player.name}`, state: snap });
}

function logMoveDetails(player, pieceId, oldPos, result, game, card) {
  const piece = game.pieces.find(p => p.id === pieceId);
  if (!piece) return null;

  if (result && result.success === false) {
    return null; // movimento ainda não finalizado
  }
  console.log(
    `${player.name} moveu ${pieceId} de (${oldPos.row},${oldPos.col}) para (${piece.position.row},${piece.position.col})`
  );

  const cardVal = card ? (card.value === 'JOKER' ? 'C' : card.value) : '';
  let message = `${player.name} jogou um ${cardVal}`;

  if (result && result.action === 'capture' && result.captures) {
    for (const c of result.captures) {
      if (c.action === 'partnerCapture') {
        const pos = c.result.position;
        console.log(`Capturou parceiro ${c.pieceId} e moveu para (${pos.row},${pos.col})`);
        const captured = game.pieces.find(p => p.id === c.pieceId);
        if (captured) {
          const name = game.players.find(p => p.position === captured.playerId)?.name || `player${captured.playerId+1}`;
          message += ` e comeu ${name} (parceiro)`;
        }
      } else if (c.action === 'opponentCapture') {
        console.log(`Capturou adversário ${c.pieceId} e enviou ao castigo`);
        const captured = game.pieces.find(p => p.id === c.pieceId);
        if (captured) {
          const name = game.players.find(p => p.position === captured.playerId)?.name || `player${captured.playerId+1}`;
          message += ` e comeu ${name} (adversário)`;
        }
      }
    }
  } else if (result && result.action === 'leavePenalty') {
    console.log(`${pieceId} saiu do castigo`);
    message += ' e saiu do castigo';
    if (result.captures) {
      for (const c of result.captures) {
        if (c.action === 'partnerCapture') {
          const pos = c.result.position;
          console.log(`Capturou parceiro ${c.pieceId} e moveu para (${pos.row},${pos.col})`);
          const captured = game.pieces.find(p => p.id === c.pieceId);
          if (captured) {
            const name = game.players.find(p => p.position === captured.playerId)?.name || `player${captured.playerId+1}`;
            message += ` e comeu ${name} (parceiro)`;
          }
        } else {
          console.log(`Capturou adversário ${c.pieceId} e enviou ao castigo`);
          const captured = game.pieces.find(p => p.id === c.pieceId);
          if (captured) {
            const name = game.players.find(p => p.position === captured.playerId)?.name || `player${captured.playerId+1}`;
            message += ` e comeu ${name} (adversário)`;
          }
        }
      }
    }
  } else if (result && result.action === 'enterHomeStretch') {
    console.log(`${pieceId} entrou no corredor de chegada`);
    message += ' e avançou para o corredor de chegada';
  }

  const snapState = game.getGameStateWithCards();
  delete snapState.lastMove;
  const snapshot = JSON.parse(JSON.stringify(snapState));
  game.history.push({ move: message, state: snapshot });
  return message;
}

module.exports = {
  logTurnState,
  logMoveDetails
};
