const { Game } = require('./game');

class BotWrapper {
  constructor(game) {
    this.game = game;
    this.specialActions = {};
  }

  getGameState() {
    if (typeof this.game.getGameStateWithCards === 'function') {
      return this.game.getGameStateWithCards();
    }
    return this.game.getGameState();
  }

  getValidActions(playerId) {
    try {
      if (!this.game || !this.game.players || !this.game.players[playerId]) {
        return [0];
      }

      const moveActions = [];
      const specialActionsList = [];
      const player = this.game.players[playerId];
      this.specialActions = {};
      let specialId = 60;

      const uniqueIndices = {};
      for (let idx = 0; idx < player.cards.length; idx++) {
        const val = player.cards[idx].value;
        if (!(val in uniqueIndices)) {
          uniqueIndices[val] = idx;
        }
      }
      const cardIndices = Object.values(uniqueIndices).sort((a, b) => a - b);
      const maxMoveCards = Math.min(cardIndices.length, 6);

      const pieceInfos = [];
      for (let n = 1; n <= 5; n++) {
        pieceInfos.push({ owner: playerId, num: n, id: `p${playerId}_${n}` });
      }
      if (this.game.hasAllPiecesInHomeStretch && this.game.partnerIdFor &&
          this.game.hasAllPiecesInHomeStretch(playerId)) {
        const partner = this.game.partnerIdFor(playerId);
        if (partner !== null && partner !== undefined) {
          for (let n = 1; n <= 5; n++) {
            pieceInfos.push({ owner: partner, num: n + 5, id: `p${partner}_${n}` });
          }
        }
      }

      // Search the entire hand for sevens so bots consider them even when
      // more than six unique values appear. Limit to the first four sevens
      // to mirror the training wrapper logic.
      const sevenIndices = [];
      for (let i = 0; i < player.cards.length && sevenIndices.length < 4; i++) {
        if (player.cards[i].value === '7') {
          sevenIndices.push(i);
        }
      }
      for (const cardIdx of sevenIndices) {

        const movable = [];
        for (const info of pieceInfos) {
          const p = this.game.pieces.find(pp => pp.id === info.id);
          if (p && !p.completed && !p.inPenaltyZone && !p.inHomeStretch) {
            movable.push(info.id);
          }
        }

        for (const pid of movable) {
          const moves = [{ pieceId: pid, steps: 7 }];
          const clone = this.game.cloneForSimulation();
          try {
            clone.makeSpecialMove(moves);
            specialActionsList.push(specialId);
            this.specialActions[specialId] = moves;
            specialId++;
          } catch (e) {
            // ignore invalid
          }
        }

        for (let i = 0; i < movable.length; i++) {
          for (let j = i + 1; j < movable.length; j++) {
            for (let steps = 1; steps <= 6; steps++) {
              const moves = [
                { pieceId: movable[i], steps },
                { pieceId: movable[j], steps: 7 - steps }
              ];
              const clone = this.game.cloneForSimulation();
              try {
                clone.makeSpecialMove(moves);
                specialActionsList.push(specialId);
                this.specialActions[specialId] = moves;
                specialId++;
              } catch (e) {
                continue;
              }
            }
          }
        }
      }

      for (let idx = 0; idx < maxMoveCards; idx++) {
        const cardIdx = cardIndices[idx];
        for (const info of pieceInfos) {
          const piece = this.game.pieces.find(p => p.id === info.id);
          if (!piece || piece.completed) {
            continue;
          }
          const clone = this.game.cloneForSimulation();
          try {
            clone.makeMove(info.id, cardIdx);
            moveActions.push(cardIdx * 10 + info.num);
          } catch (e) {
            continue;
          }
        }
      }

      const validActions = [...specialActionsList, ...moveActions];

      if (validActions.length === 0) {
        const maxDiscardCards = Math.min(cardIndices.length, 10);
        for (let i = 0; i < maxDiscardCards; i++) {
          const cardIdx = cardIndices[i];
          validActions.push(70 + cardIdx);
        }
      }

      return validActions;
    } catch (e) {
      return [];
    }
  }

  makeMove(playerId, actionId) {
    try {
      if (!this.game || !this.game.isActive) {
        throw new Error('Game is not active');
      }
      if (playerId !== this.game.currentPlayerIndex) {
        throw new Error('Not this player\'s turn');
      }

      let result;
      let playedCard;
      let jokerPlayed = false;

      if (actionId >= 70) {
        const cardIndex = actionId - 70;
        playedCard = this.game.players[playerId].cards[cardIndex];

        if (this.game.hasAnyValidMove && this.game.hasAnyValidMove(playerId)) {
          const alt = this.getValidActions(playerId)[0];
          if (alt !== undefined) {
            return this.makeMove(playerId, alt);
          }
        }

        try {
          result = this.game.discardCard(cardIndex);
        } catch (e) {
          throw e;
        }
      } else if (actionId >= 60) {
        const moves = this.specialActions[actionId];
        if (!moves) {
          throw new Error('Invalid special action');
        }
        result = this.game.makeSpecialMove(moves);
        if (result && result.action === 'homeEntryChoice') {
          result = this.game.resumeSpecialMove(true);
        }
      } else {
        let pieceNumber = actionId % 10;
        let cardIndex;
        if (pieceNumber === 0) {
          pieceNumber = 10;
          cardIndex = (actionId - pieceNumber) / 10;
        } else {
          cardIndex = Math.floor(actionId / 10);
        }
        let ownerId = playerId;
        if (pieceNumber > 5) {
          const partner = this.game.partnerIdFor && this.game.partnerIdFor(playerId);
          if (partner === null || partner === undefined) {
            throw new Error('Invalid partner move');
          }
          ownerId = partner;
          pieceNumber -= 5;
        }
        const pieceId = `p${ownerId}_${pieceNumber}`;
        playedCard = this.game.players[playerId].cards[cardIndex];
        result = this.game.makeMove(pieceId, cardIndex);

        if (result && result.action === 'homeEntryChoice') {
          result = this.game.makeMove(pieceId, cardIndex, true);
        }

        if (result && result.action === 'choosePosition') {
          const target = result.validPositions && result.validPositions[0];
          if (!target) {
            throw new Error('No valid Joker positions');
          }
          const piece = this.game.pieces.find(p => p.id === pieceId);
          result = this.game.moveToSelectedPosition(piece, target.id);
          this.game.discardPile.push(playedCard);
          this.game.players[playerId].cards.splice(cardIndex, 1);
          jokerPlayed = true;
          const playerName = this.game.players[playerId].name;
          const msg = `${playerName} moveu ${pieceId} com C`;
          this.game.history.push({ move: msg, state: this.getGameState() });
          this.game.nextTurn();
        }
      }

      if (jokerPlayed) {
        this.game.stats.jokersPlayed[playerId]++;
      }

      const nextPlayer = this.game.getCurrentPlayer();
      if (nextPlayer) {
        try {
          nextPlayer.cards.push(this.game.drawCard());
        } catch (e) {}
      }

      const gameEnded = this.game.checkWinCondition();
      const winningTeam = gameEnded ? this.game.getWinningTeam() : null;

      const response = {
        success: true,
        action: result && result.action ? result.action : 'move',
        captures: result && result.captures ? result.captures : [],
        gameState: this.getGameState(),
        gameEnded,
        winningTeam
      };

      if (gameEnded) {
        response.stats = {
          summary: this.game.getStatisticsSummary(),
          full: this.game.stats
        };
      }

      return response;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        gameState: this.getGameState()
      };
    }
  }
}

module.exports = BotWrapper;
