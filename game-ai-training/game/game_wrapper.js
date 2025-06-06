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
        console.log(JSON.stringify(response));
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
            
            // Simple approach: just return some basic actions for now
            // You can expand this based on your game's actual logic
            for (let cardIdx = 0; cardIdx < 5; cardIdx++) {
                for (let pieceId = 1; pieceId <= 5; pieceId++) {
                    validActions.push(cardIdx * 10 + pieceId);
                }
            }
            
            // Add discard actions
            for (let cardIdx = 0; cardIdx < 5; cardIdx++) {
                validActions.push(40 + cardIdx);
            }
            
            return validActions.length > 0 ? validActions.slice(0, 10) : [0]; // Limit to 10 actions
        } catch (error) {
            return [0];
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
            if (actionId >= 40) {
                const cardIndex = actionId - 40;
                result = this.game.discardCard(cardIndex);
            } else {
                const cardIndex = Math.floor(actionId / 10);
                const pieceNumber = actionId % 10;
                const pieceId = `p${playerId}_${pieceNumber}`;
                result = this.game.makeMove(pieceId, cardIndex);
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

            return {
                success: true,
                action: result && result.action ? result.action : 'move',
                captures: result && result.captures ? result.captures : [],
                gameState: this.getGameState(),
                gameEnded,
                winningTeam
            };
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

