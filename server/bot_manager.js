const { spawn } = require('child_process');
const path = require('path');
const BotWrapper = require('./bot_wrapper');

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
}

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
      const result = this.wrapper.makeMove(current.position, actionId);
      const roomId = this.game.roomId;
      this.io.to(roomId).emit('gameStateUpdate', result.gameState);
      const last = this.game.history[this.game.history.length - 1];
      if (last && last.move) {
        this.io.to(roomId).emit('lastMove', { message: last.move });
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
