function actorForMove(entry) {
  const move = entry && entry.move;
  const players = entry && entry.state && entry.state.players;

  if (!move || !Array.isArray(players)) {
    return null;
  }

  return players.find(player => player && player.name && move.startsWith(player.name)) || null;
}

function isJokerMove(entry) {
  const move = entry && entry.move;
  if (!move) return false;

  return /(?:\bC\b|JOKER|Joker)/.test(move);
}

function isIntermediateJokerReplayEntry(entry) {
  if (!isJokerMove(entry)) {
    return false;
  }

  const state = entry && entry.state;
  const actor = actorForMove(entry);

  return Boolean(
    state &&
    actor &&
    Number.isInteger(state.currentPlayerIndex) &&
    actor.position === state.currentPlayerIndex
  );
}

function replayHistoryForSave(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(entry => !isIntermediateJokerReplayEntry(entry))
    .map(entry => JSON.parse(JSON.stringify(entry)));
}

module.exports = {
  isIntermediateJokerReplayEntry,
  replayHistoryForSave
};
