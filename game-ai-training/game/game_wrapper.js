const readline = require('readline');

// Suppress console.log from the game module during initialization
const originalConsoleLog = console.log;
console.log = () => {}; // Temporarily disable console.log

let Game;
try {
    const gameModule = require('./game.js');
    Game = gameModule.Game || gameModule.default || gameModule;
} catch (error) {
    console.error = originalConsoleLog; // Restore for error
    console.error("Error loading game module:", error.message);
    process.exit(1);
}

// Restore console.log and redirect all further output to stderr so that
// stdout remains reserved for JSON communication with the Python side.
console.log = (...args) => {
    process.stderr.write(args.join(' ') + '\n');
};
console.error = (...args) => {
    process.stderr.write(args.join(' ') + '\n');
};

class GameWrapper {
    constructor() {
        this.game = null;
        // Map of special action ids to move arrays for card 7
        this.specialActions = {};
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false
        });
        
        // Send ready signal
        this.sendResponse({ ready: true, message: "Game wrapper initialized" });
        
        this.listen();
    }
    
    sendResponse(response) {
        // Write JSON to stdout so the Python side can read it
        process.stdout.write(JSON.stringify(response) + '\n');
    }
    
    setupGame() {
        try {
            this.game = new Game("training_room");

            // Add 4 bot players
            for (let i = 0; i < 4; i++) {
                this.game.addPlayer(`bot_${i}`, `Bot_${i}`);
            }

            this.game.startGame();

            // Draw a card for the first player just like the server does
            const first = this.game.getCurrentPlayer();
            if (first) {
                try {
                    first.cards.push(this.game.drawCard());
                } catch (e) {
                    // ignore if deck is empty
                }
            }

            return true;
        } catch (error) {
            return false;
        }
    }
    
    listen() {
        this.rl.on('line', (input) => {
            try {
                if (!input.trim()) {
                    this.sendResponse({ error: "Empty input" });
                    return;
                }
                
                const command = JSON.parse(input);
                const response = this.handleCommand(command);
                this.sendResponse(response);
            } catch (error) {
                this.sendResponse({ error: `Command error: ${error.message}` });
            }
        });
    }
    
    handleCommand(command) {
        try {
            switch (command.action) {
                case 'reset':
                    if (this.setupGame()) {
                        return {
                            success: true,
                            gameState: this.getGameState()
                        };
                    } else {
                        return { error: "Failed to setup game" };
                    }
                    
                case 'getValidActions':
                    return {
                        validActions: this.getValidActions(command.playerId)
                    };
                    
                case 'makeMove':
                    return this.makeMove(command.playerId, command.actionId);

                case 'makeSpecialMove':
                    return this.makeSpecialMove(command.playerId, command.actionId);
                    
                default:
                    return { error: `Unknown action: ${command.action}` };
            }
        } catch (error) {
            return { error: `Handler error: ${error.message}` };
        }
    }
    
    getGameState() {
        if (!this.game) {
            return {
                players: [],
                pieces: [],
                currentPlayerIndex: 0,
                isActive: false
            };
        }

        // Prefer the game's own helper so fields like `lastMove` are included
        if (typeof this.game.getGameState === 'function') {
            return this.game.getGameState();
        }

        return {
            players: this.game.players || [],
            pieces: this.game.pieces || [],
            currentPlayerIndex: this.game.currentPlayerIndex || 0,
            isActive: this.game.isActive || false
        };
    }
    
    getValidActions(playerId) {
        try {
            if (!this.game || !this.game.players || !this.game.players[playerId]) {
                return [0];
            }

            const validActions = [];
            const player = this.game.players[playerId];
            this.specialActions = {};
            let specialId = 50; // range 50-59 reserved for special moves

            // Limit to the first 5 cards so that generated action IDs never
            // exceed the Python trainer's action space of 50. Each card index
            // contributes at most five piece moves (cardIdx * 10 + pieceNum) and
            // cardIdx >= 5 would produce IDs >= 50.
            const maxMoveCards = Math.min(player.cards.length, 5);
            for (let cardIdx = 0; cardIdx < maxMoveCards; cardIdx++) {
                for (let pieceNum = 1; pieceNum <= 5; pieceNum++) {
                    const pieceId = `p${playerId}_${pieceNum}`;
                    const piece = this.game.pieces.find(p => p.id === pieceId);
                    if (!piece || piece.completed) {
                        continue;
                    }

                    const clone = this.game.cloneForSimulation();
                    try {
                        clone.makeMove(pieceId, cardIdx);
                        validActions.push(cardIdx * 10 + pieceNum);
                    } catch (e) {
                        // invalid move, ignore
                    }
                }
            }

            // Generate special move actions for card 7
            for (let cardIdx = 0; cardIdx < Math.min(player.cards.length, 4); cardIdx++) {
                if (player.cards[cardIdx].value !== '7') continue;

                const pieceIds = [];
                for (let num1 = 1; num1 <= 5; num1++) {
                    const id = `p${playerId}_${num1}`;
                    const p = this.game.pieces.find(pp => pp.id === id);
                    if (p && !p.completed && !p.inPenaltyZone) {
                        pieceIds.push(id);
                    }
                }

                for (let i = 0; i < pieceIds.length; i++) {
                    for (let j = i + 1; j < pieceIds.length; j++) {
                        for (let steps = 1; steps <= 6; steps++) {
                            if (validActions.length >= 10) break;
                            const moves = [
                                { pieceId: pieceIds[i], steps },
                                { pieceId: pieceIds[j], steps: 7 - steps }
                            ];
                            const clone = this.game.cloneForSimulation();
                            try {
                                clone.makeSpecialMove(moves);
                                validActions.push(specialId);
                                this.specialActions[specialId] = moves;
                                specialId++;
                            } catch (e) {
                                // invalid split move, ignore
                            }
                        }
                    }
                }
            }

            if (!this.game.hasAnyValidMove(playerId)) {
                // Discard actions use IDs 60-69 (10 possible discards). Constrain
                // the number of cards considered so action IDs remain < 70.
                const maxDiscardCards = Math.min(player.cards.length, 10);
                for (let cardIdx = 0; cardIdx < maxDiscardCards; cardIdx++) {
                    validActions.push(60 + cardIdx);
                }
            }

            if (
                validActions.length === 0 &&
                player.cards.length > 0 &&
                !this.game.hasAnyValidMove(playerId)
            ) {
                // Fallback to discarding the first card so training can continue
                // only when no valid move exists at all
                validActions.push(60);
            }

            return validActions.length > 0 ? validActions.slice(0, 10) : [];
        } catch (error) {
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
            if (actionId >= 60) {
                const cardIndex = actionId - 60;
                playedCard = this.game.players[playerId].cards[cardIndex];
                result = this.game.discardCard(cardIndex);
            } else {
                const cardIndex = Math.floor(actionId / 10);
                const pieceNumber = actionId % 10;
                const pieceId = `p${playerId}_${pieceNumber}`;
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
                    this.game.history.push(msg);
                    this.game.nextTurn();
                }
            }

            if (jokerPlayed) {
                this.game.stats.jokersPlayed[playerId]++;
            }

            // After the move/discard the turn has advanced inside the game
            // Draw a card for the new current player
            const nextPlayer = this.game.getCurrentPlayer();
            if (nextPlayer) {
                try {
                    nextPlayer.cards.push(this.game.drawCard());
                } catch (e) {
                    // ignore deck exhaustion
                }
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

    makeSpecialMove(playerId, actionId) {
        try {
            if (!this.game || !this.game.isActive) {
                throw new Error('Game is not active');
            }

            if (playerId !== this.game.currentPlayerIndex) {
                throw new Error('Not this player\'s turn');
            }

            const moves = this.specialActions[actionId];
            if (!moves) {
                throw new Error('Invalid special action');
            }

            let result = this.game.makeSpecialMove(moves);

            if (result && result.action === 'homeEntryChoice') {
                result = this.game.resumeSpecialMove(true);
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

new GameWrapper();

