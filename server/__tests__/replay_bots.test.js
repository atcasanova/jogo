const { Game } = require('../game');
const request = require('supertest');
const express = require('express');
const fs = require('fs');
const path = require('path');

const REPLAY_DIR = path.join(__dirname, '../../replays');

function saveReplay(game) {
  const file = path.join(REPLAY_DIR, `${Date.now()}_${game.roomId}.json`);
  const data = {
    roomId: game.roomId,
    players: game.players.map(p => p.name),
    history: game.history
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

function createApp() {
  const app = express();
  app.get('/replays/:file', (req, res) => {
    const resolved = path.resolve(REPLAY_DIR, req.params.file);
    if (!resolved.startsWith(REPLAY_DIR)) {
      return res.status(400).send('Invalid file');
    }
    if (fs.existsSync(resolved)) {
      res.sendFile(resolved);
    } else {
      res.status(404).send('Not found');
    }
  });
  return app;
}

const app = createApp();

let createdFile = null;

beforeAll(() => {
  if (!fs.existsSync(REPLAY_DIR)) fs.mkdirSync(REPLAY_DIR);
});

afterAll(() => {
  if (createdFile && fs.existsSync(createdFile)) fs.unlinkSync(createdFile);
  if (fs.existsSync(REPLAY_DIR) && fs.readdirSync(REPLAY_DIR).length === 0) {
    fs.rmdirSync(REPLAY_DIR);
  }
});

test('bots generate a replay that can be served', async () => {
  const game = new Game('room_bot');
  game.addPlayer('b1', 'Bot1', true);
  game.addPlayer('b2', 'Bot2', true);
  game.addPlayer('b3', 'Bot3', true);
  game.addPlayer('b4', 'Bot4', true);
  game.startGame();

  // put team 0 pieces at home except one
  for (const piece of game.pieces) {
    if (piece.playerId === 0 || piece.playerId === 2) {
      piece.inPenaltyZone = false;
      piece.inHomeStretch = true;
      piece.completed = true;
    }
  }
  const finalPiece = game.pieces.find(p => p.id === 'p0_1');
  finalPiece.completed = false;
  finalPiece.inHomeStretch = false;
  finalPiece.inPenaltyZone = false;

  // simulate bot move finishing the game
  finalPiece.inHomeStretch = true;
  finalPiece.completed = true;
  game.history.push({ move: 'Bot1 finishes', state: game.getGameState() });

  expect(game.checkWinCondition()).toBe(true);
  game.endGame();

  createdFile = saveReplay(game);
  expect(fs.existsSync(createdFile)).toBe(true);

  const json = JSON.parse(fs.readFileSync(createdFile, 'utf8'));
  expect(json.history.length).toBeGreaterThan(0);
  expect(json.history[0].move).toContain('Bot1');

  const res = await request(app).get(`/replays/${path.basename(createdFile)}`);
  expect(res.status).toBe(200);
});
