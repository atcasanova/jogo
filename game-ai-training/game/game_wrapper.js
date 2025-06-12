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

                case 'isActionValid':
                    return { valid: this.isActionValid(command.playerId, command.actionId) };

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

            const moveActions = [];
            const specialActionsList = [];
            const player = this.game.players[playerId];
            this.specialActions = {};
            // range 60-69 reserved for special moves
            let specialId = 60;

            // Limit to the first 6 cards so that move IDs remain below the
            // special action range starting at 60. Each card index contributes
            // at most five piece moves (cardIdx * 10 + pieceNum) and
            // cardIdx >= 6 would yield IDs >= 60.
            const maxMoveCards = Math.min(player.cards.length, 6);

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

            // Generate special move actions for card 7 first so they are not
            // truncated when many normal moves exist.
            for (let cardIdx = 0; cardIdx < Math.min(player.cards.length, 4); cardIdx++) {
                if (player.cards[cardIdx].value !== '7') continue;

                const movable = [];
                for (const info of pieceInfos) {
                    const p = this.game.pieces.find(pp => pp.id === info.id);
                    if (p && !p.completed && !p.inPenaltyZone) {
                        movable.push(info.id);
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
                                // invalid split move, ignore
                            }
                        }
                    }
                }
            }

            for (let cardIdx = 0; cardIdx < maxMoveCards; cardIdx++) {
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
                        // invalid move, ignore
                    }
                }
            }

            const validActions = [...specialActionsList, ...moveActions];

            if (validActions.length === 0) {
                // If no moves were generated, allow discarding any card. This
                // ensures the Python trainer always receives at least one
                // action even when a playable card lies outside the scanned
                // range.
                const maxDiscardCards = Math.min(player.cards.length, 10);
                for (let cardIdx = 0; cardIdx < maxDiscardCards; cardIdx++) {
                    validActions.push(70 + cardIdx);
                }
            }

            return validActions.slice(0, 10);
        } catch (error) {
            return [];
        }
    }

    findFirstAvailableAction(playerId) {
        try {
            if (!this.game || !this.game.players || !this.game.players[playerId]) {
                return null;
            }

            const actions = this.getValidActions(playerId);
            if (!actions || actions.length === 0) {
                return null;
            }

            for (const action of actions) {
                const clone = this.game.cloneForSimulation();

                if (action >= 60) {
                    const moves = this.specialActions[action];
                    if (!moves) continue;
                    try {
                        clone.makeSpecialMove(moves);
                        return action;
                    } catch (e) {
                        continue;
                    }
                } else {
                    const cardIndex = Math.floor(action / 10);
                    let pieceNumber = action % 10;
                    if (pieceNumber === 0) {
                        pieceNumber = 10;
                    }
                    let ownerId = playerId;
                    if (pieceNumber > 5) {
                        const partner = this.game.partnerIdFor && this.game.partnerIdFor(playerId);
                        if (partner === null || partner === undefined) {
                            continue;
                        }
                        ownerId = partner;
                        pieceNumber -= 5;
                    }
                    const pid = `p${ownerId}_${pieceNumber}`;
                    try {
                        const res = clone.makeMove(pid, cardIndex);
                        if (res && res.success !== false) {
                            return action;
                        }
                        if (res && (res.action === 'homeEntryChoice' || res.action === 'choosePosition')) {
                            return action;
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }

            return null;
        } catch (err) {
            return null;
        }
    }

    isActionValid(playerId, actionId) {
        try {
            if (!this.game || !this.game.players || !this.game.players[playerId]) {
                return false;
            }

            const clone = this.game.cloneForSimulation();

            if (actionId >= 70) {
                const cardIndex = actionId - 70;
                const player = clone.players[playerId];
                if (!player || cardIndex < 0 || cardIndex >= player.cards.length) {
                    return false;
                }
                try {
                    clone.discardCard(cardIndex);
                    return true;
                } catch (e) {
                    return false;
                }
            }

            if (actionId >= 60) {
                const moves = this.specialActions[actionId];
                if (!moves) return false;
                try {
                    clone.makeSpecialMove(moves);
                    return true;
                } catch (e) {
                    return false;
                }
            }

            const cardIndex = Math.floor(actionId / 10);
            let pieceNumber = actionId % 10;
            if (pieceNumber === 0) {
                pieceNumber = 10;
            }

            let ownerId = playerId;
            if (pieceNumber > 5) {
                const partner = this.game.partnerIdFor && this.game.partnerIdFor(playerId);
                if (partner === null || partner === undefined) {
                    return false;
                }
                ownerId = partner;
                pieceNumber -= 5;
            }

            const pid = `p${ownerId}_${pieceNumber}`;
            let res;
            try {
                res = clone.makeMove(pid, cardIndex);
            } catch (err) {
                // Move is invalid if clone.makeMove throws (e.g., "Casa de chegada já ocupada")
                return false;
            }

            if (res && res.success === false) {
                return false;
            }
            return true;
        } catch (e) {
            return false;
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
                    const alt = this.findFirstAvailableAction(playerId);
                    if (alt !== null) {
                        return this.makeMove(playerId, alt);
                    }
                }

                try {
                    result = this.game.discardCard(cardIndex);
                } catch (e) {
                    if (e.message && e.message.includes('jogadas disponíveis')) {
                        const player = this.game.players[playerId];
                        const infos = [];
                        for (let n = 1; n <= 5; n++) {
                            infos.push({ owner: playerId, id: `p${playerId}_${n}` });
                        }
                        if (this.game.hasAllPiecesInHomeStretch && this.game.partnerIdFor &&
                            this.game.hasAllPiecesInHomeStretch(playerId)) {
                            const partner = this.game.partnerIdFor(playerId);
                            if (partner !== null && partner !== undefined) {
                                for (let n = 1; n <= 5; n++) {
                                    infos.push({ owner: partner, id: `p${partner}_${n}` });
                                }
                            }
                        }
                        for (let ci = 0; ci < player.cards.length && !result; ci++) {
                            for (const info of infos) {
                                const piece = this.game.pieces.find(p => p.id === info.id && !p.completed);
                                if (!piece) continue;
                                const sim = this.game.cloneForSimulation();
                                try {
                                    sim.makeMove(info.id, ci);
                                    playedCard = player.cards[ci];
                                    result = this.game.makeMove(info.id, ci);
                                    if (result && result.action === 'homeEntryChoice') {
                                        result = this.game.makeMove(info.id, ci, true);
                                    }
                                    if (result && result.action === 'choosePosition') {
                                        const target = result.validPositions && result.validPositions[0];
                                        if (!target) throw new Error('No valid Joker positions');
                                        const realPiece = this.game.pieces.find(p => p.id === info.id);
                                        result = this.game.moveToSelectedPosition(realPiece, target.id);
                                        this.game.discardPile.push(playedCard);
                                        player.cards.splice(ci, 1);
                                        jokerPlayed = true;
                                        const playerName = player.name;
                                        const msg = `${playerName} moveu ${info.id} com C`;
                                        this.game.history.push(msg);
                                        this.game.nextTurn();
                                    }
                                    break;
                                } catch (err) {
                                    continue;
                                }
                            }
                        }

                        if (!result) {
                            for (let ci = 0; ci < player.cards.length && !result; ci++) {
                                if (player.cards[ci].value !== '7') continue;
                                const pieceIds = [];
                                const infoList = [];
                                for (let n = 1; n <= 5; n++) {
                                    infoList.push(`p${playerId}_${n}`);
                                }
                                if (this.game.hasAllPiecesInHomeStretch && this.game.partnerIdFor &&
                                    this.game.hasAllPiecesInHomeStretch(playerId)) {
                                    const partner = this.game.partnerIdFor(playerId);
                                    if (partner !== null && partner !== undefined) {
                                        for (let n = 1; n <= 5; n++) {
                                            infoList.push(`p${partner}_${n}`);
                                        }
                                    }
                                }
                                for (const pid of infoList) {
                                    const p = this.game.pieces.find(pp => pp.id === pid && !pp.completed && !pp.inPenaltyZone);
                                    if (p) pieceIds.push(pid);
                                }
                                for (let i = 0; i < pieceIds.length && !result; i++) {
                                    for (let j = i + 1; j < pieceIds.length && !result; j++) {
                                        for (let s = 1; s <= 6 && !result; s++) {
                                            const moves = [
                                                { pieceId: pieceIds[i], steps: s },
                                                { pieceId: pieceIds[j], steps: 7 - s }
                                            ];
                                            const sim = this.game.cloneForSimulation();
                                            try {
                                                sim.makeSpecialMove(moves);
                                                playedCard = player.cards[ci];
                                                result = this.game.makeSpecialMove(moves);
                                                if (result && result.action === 'homeEntryChoice') {
                                                    result = this.game.resumeSpecialMove(true);
                                                }
                                            } catch (err) {
                                                continue;
                                            }
                                        }
                                    }
                                }
                                if (!result) {
                                    for (let k = 0; k < pieceIds.length && !result; k++) {
                                        const moves = [{ pieceId: pieceIds[k], steps: 7 }];
                                        const sim = this.game.cloneForSimulation();
                                        try {
                                            sim.makeSpecialMove(moves);
                                            playedCard = player.cards[ci];
                                            result = this.game.makeSpecialMove(moves);
                                            if (result && result.action === 'homeEntryChoice') {
                                                result = this.game.resumeSpecialMove(true);
                                            }
                                        } catch (err) {
                                            continue;
                                        }
                                    }
                                }
                            }
                        }

                        if (!result) {
                            // Could not find a valid move. Force the discard
                            // so the training loop can proceed rather than
                            // failing repeatedly.
                            const fallbackCard = player.cards[cardIndex];
                            this.game.discardPile.push(fallbackCard);
                            player.cards.splice(cardIndex, 1);
                            this.game.stats.roundsWithoutPlay[player.position]++;
                            this.game.nextTurn();
                            const dMsg = `${player.name} descartou um ${fallbackCard.value === 'JOKER' ? 'C' : fallbackCard.value}`;
                            this.game.history.push(dMsg);
                            result = { success: true, action: 'discard' };
                        }
                    } else {
                        throw e;
                    }
                }
            } else {
                let pieceNumber = actionId % 10;
                let cardIndex;
                // Piece numbers for partner pieces may encode as 10 which would
                // otherwise wrap to 0 when using modulo 10. Normalize so 10 is
                // preserved after the modulo operation and adjust the card
                // index accordingly.
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

