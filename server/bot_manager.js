const { spawn } = require('child_process');
const path = require('path');
const BotWrapper = require('./bot_wrapper');
const { logTurnState, logMoveDetails } = require('./log_utils');
class BotManager {
  constructor(game, io) {
    this.game = game;
    this.io = io;
    this.wrapper = new BotWrapper(game);
    this.running = false;
    this.proc = spawn('python3', [path.join(__dirname, '../game-ai-training/bot_service.py')]);
    this.buffer = '';
    this.queue = [];
    this.proc.stdout.on('data', data => {
      this.buffer += data.toString();
      let idx;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          obj = null;
        }
        const resolve = this.queue.shift();
        if (resolve) resolve(obj);
      }
    });
  }

  requestAction(playerId) {
    return new Promise(resolve => {
      const msg = {
        cmd: 'predict',
        playerId,
        gameState: this.wrapper.getGameState(),
        validActions: this.wrapper.getValidActions(playerId)
      };
      this.proc.stdin.write(JSON.stringify(msg) + '\n');
      this.queue.push(resolve);
    });
  }

  async playBots() {
    if (this.running) return;
    this.running = true;
    while (this.game.isActive) {
      const current = this.game.getCurrentPlayer();
      if (!current || !current.isBot) break;
      logTurnState(this.game);
      const res = await this.requestAction(current.position);
      const actionId = res && res.actionId !== undefined ? res.actionId : 70;

      let pieceId = null;
      let oldPos = null;
      let playedCard = null;

      if (actionId >= 70) {
        const cardIndex = actionId - 70;
        playedCard = this.game.players[current.position].cards[cardIndex];
        const pieces = this.game.pieces.filter(p => p.playerId === current.position);
        const allPenalty = pieces.every(p => p.inPenaltyZone);
        if (allPenalty && ['A', 'K', 'Q', 'J'].includes(playedCard.value)) {
          const first = pieces.find(p => p.inPenaltyZone);
          if (first) {
            pieceId = first.id;
            oldPos = { ...first.position };
          }
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
        let ownerId = current.position;
        if (pieceNumber > 5) {
          const partner = this.game.partnerIdFor && this.game.partnerIdFor(current.position);
          if (partner !== null && partner !== undefined) {
            ownerId = partner;
            pieceNumber -= 5;
          }
        }
        pieceId = `p${ownerId}_${pieceNumber}`;
        const piece = this.game.pieces.find(p => p.id === pieceId);
        if (piece) {
          oldPos = { ...piece.position };
        }
        playedCard = this.game.players[current.position].cards[cardIndex];
      }

      const result = this.wrapper.makeMove(current.position, actionId);
      const roomId = this.game.roomId;
      this.io.to(roomId).emit('gameStateUpdate', result.gameState);

      if (pieceId) {
        const msg = logMoveDetails(current, pieceId, oldPos, result, this.game, playedCard);
        if (msg) {
          this.io.to(roomId).emit('lastMove', { message: msg });
        }
      } else if (result.action === 'discard' && playedCard) {
        const discardMsg = `${current.name} descartou um ${playedCard.value === 'JOKER' ? 'C' : playedCard.value}`;
        const snapState = this.game.getGameState();
        delete snapState.lastMove;
        const snap = JSON.parse(JSON.stringify(snapState));
        this.game.history.push({ move: discardMsg, state: snap });
        this.io.to(roomId).emit('lastMove', { message: discardMsg });
      } else {
        const last = this.game.history[this.game.history.length - 1];
        if (last && last.move) {
          this.io.to(roomId).emit('lastMove', { message: last.move });
        }
      }
      if (result.gameEnded) {
        this.io.to(roomId).emit('gameOver', {
          winners: result.winningTeam,
          stats: result.stats
        });
        this.game.endGame();
        break;
      }

      const nextPlayer = this.game.getCurrentPlayer();
      if (!nextPlayer) break;

      logTurnState(this.game);

      if (!nextPlayer.isBot) {
        this.io.to(nextPlayer.id).emit('yourTurn', {
          cards: nextPlayer.cards,
          canMove: this.game.hasAnyValidMove(nextPlayer.position)
        });
        break;
      }

      const delay = 4000 + Math.random() * 4000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    this.running = false;
  }

  stop() {
    if (this.proc) {
      this.proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n');
      this.proc.kill();
    }
  }
}

module.exports = BotManager;
