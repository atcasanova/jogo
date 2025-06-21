const { spawn } = require('child_process');
const path = require('path');
const BotWrapper = require('./bot_wrapper');

class BotManager {
  constructor(game, io) {
    this.game = game;
    this.io = io;
    this.wrapper = new BotWrapper(game);
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
    while (this.game.isActive) {
      const current = this.game.getCurrentPlayer();
      if (!current || !current.isBot) break;
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
    }
  }

  stop() {
    if (this.proc) {
      this.proc.stdin.write(JSON.stringify({ cmd: 'quit' }) + '\n');
      this.proc.kill();
    }
  }
}

module.exports = BotManager;
