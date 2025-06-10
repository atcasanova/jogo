/** @jest-environment jsdom */
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
const request = require('supertest');
const express = require('express');
const path = require('path');
const fs = require('fs');

const REPLAY_DIR = path.join(__dirname, '../../replays');

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

beforeAll(() => {
  if (!fs.existsSync(REPLAY_DIR)) fs.mkdirSync(REPLAY_DIR);
  fs.writeFileSync(path.join(REPLAY_DIR, 'sample.json'), JSON.stringify({ players: ['Alice', 'Bob'] }));
});

afterAll(() => {
  fs.unlinkSync(path.join(REPLAY_DIR, 'sample.json'));
  if (fs.readdirSync(REPLAY_DIR).length === 0) fs.rmdirSync(REPLAY_DIR);
});

describe('GET /replays/:file security', () => {
  test('rejects path traversal', async () => {
    const res = await request(app).get('/replays/..%2Fpackage.json');
    expect(res.status).toBe(400);
  });

  test('serves valid file', async () => {
    const res = await request(app).get('/replays/sample.json');
    expect(res.status).toBe(200);
  });
});


const { renderReplays } = require('../../public/js/replays.js');

describe('renderReplays', () => {
  test('escapes player names', () => {
    document.body.innerHTML = '<ul id="list"></ul>';
    const list = document.getElementById('list');
    const malicious = '<img src=x onerror="alert(1)">';
    renderReplays(list, [{ file: 'a.json', players: [malicious, 'Bob'] }]);
    const span = list.querySelector('li span');
    expect(span.querySelector('img')).toBeNull();
    expect(span.innerHTML).toContain('&lt;img');
  });
});
