# Board Game Online

A web-based four-player board game built with Node.js, Express and Socket.IO. Players create or join rooms, form two teams and compete to move all pieces to the finish.

## Prerequisites
- [Node.js](https://nodejs.org/) 18 or higher
- [Docker](https://docs.docker.com/get-docker/) (optional)

## Installation
Install dependencies after cloning the repository:

```bash
npm install
```

## Running the Server
Run directly with Node:

```bash
npm start
```

or use Docker Compose:

```bash
docker-compose up
```

Set the `DEBUG` environment variable to `true` to start each player with a fixed
hand (`K`, `Q`, `T`, `8` and `JOKER`) which is useful for testing. Without this
variable or when set to `false`, the hands are dealt normally.

The application will be available at `http://localhost:3000`.

## Basic Gameplay
1. Open the app in your browser.
2. Enter your name and create a room or join an existing one using its code.
3. Wait for four players to connect and define the two teams.
4. Each turn, draw a card and move your pieces according to the card rules.
5. The first team to bring all their pieces home wins.

## Running Tests
Run the automated test suite using [Jest](https://jestjs.io/). Jest is listed as a dev dependency and will be installed automatically on the first test run:

```bash
npm test
```
This will install any missing packages and execute all tests inside the `server/__tests__` directory.
