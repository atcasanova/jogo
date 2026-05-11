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
    
    setupGame(botNames, pieceCount = 5) {
        try {
            this.game = new Game("training_room", pieceCount);

            // Add 4 bot players
            for (let i = 0; i < 4; i++) {
                const name = Array.isArray(botNames) && botNames[i] ? botNames[i] : `Bot_${i}`;
                this.game.addPlayer(`bot_${i}`, name);
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
                    if (this.setupGame(command.botNames, command.pieces)) {
                        return {
                            success: true,
                            gameState: this.getGameState()
                        };
                    } else {
                        return { error: "Failed to setup game" };
                    }
                    
                case 'getValidActions': {
                    const validActions = this.getValidActions(command.playerId);
                    const fixedPlayActions = this.getFixedPlayActions(command.playerId, validActions);
                    return {
                        validActions,
                        homeEntryActions: this.getHomeEntryActions(command.playerId, validActions),
                        fixedPlayActions: fixedPlayActions.priorityActions,
                        avoidActions: fixedPlayActions.avoidActions
                    };
                }
                    
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

        // Prefer the game's helper that includes card information when
        // available so saved history snapshots contain full state.
        if (typeof this.game.getGameStateWithCards === 'function') {
            return this.game.getGameStateWithCards();
        }

        // Fallback to basic game state without cards if the extended helper is
        // not implemented.
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

            // Use only the first occurrence of each card value so duplicate
            // cards do not inflate the action space.
            const uniqueIndices = {};
            for (let idx = 0; idx < player.cards.length; idx++) {
                const val = player.cards[idx].value;
                if (!(val in uniqueIndices)) {
                    uniqueIndices[val] = idx;
                }
            }
            const cardIndices = Object.values(uniqueIndices).sort((a, b) => a - b);

            // Limit to the first 6 unique cards so that move IDs remain below
            // the special action range starting at 60. Each card index
            // contributes at most five piece moves (cardIdx * 10 + pieceNum) and
            // cardIdx >= 6 would yield IDs >= 60.
            const maxMoveCards = Math.min(cardIndices.length, 6);

            const pieceCount = this.game.piecesPerPlayer || 5;
            const pieceInfos = [];
            for (let n = 1; n <= pieceCount; n++) {
                pieceInfos.push({ owner: playerId, num: n, id: `p${playerId}_${n}` });
            }
            if (this.game.hasAllPiecesInHomeStretch && this.game.partnerIdFor &&
                this.game.hasAllPiecesInHomeStretch(playerId)) {
                const partner = this.game.partnerIdFor(playerId);
                if (partner !== null && partner !== undefined) {
                    for (let n = 1; n <= pieceCount; n++) {
                        pieceInfos.push({ owner: partner, num: n + 5, id: `p${partner}_${n}` });
                    }
                }
            }

            // Generate special move actions for card 7 first so they are not
            // truncated when many normal moves exist.
            // Look through the entire hand for sevens so they are always
            // considered, even when more than six unique card values are
            // present. Limit to the first four sevens to keep the action
            // space bounded.
            const sevenIndices = [];
            for (let i = 0; i < player.cards.length && sevenIndices.length < 4; i++) {
                if (player.cards[i].value === '7') {
                    sevenIndices.push(i);
                }
            }
            const specialCandidates = [];
            const seenSpecialMoves = new Set();
            const addSpecialCandidate = (moves) => {
                const key = moves.map(m => `${m.pieceId}:${m.steps}`).join('|');
                if (seenSpecialMoves.has(key)) {
                    return;
                }

                const clone = this.game.cloneForSimulation();
                try {
                    const before = moves.map(m => {
                        const p = this.game.pieces.find(pp => pp.id === m.pieceId);
                        return {
                            pieceId: m.pieceId,
                            inHomeStretch: Boolean(p && p.inHomeStretch),
                            completed: Boolean(p && p.completed)
                        };
                    });
                    clone.makeSpecialMove(moves);
                    const after = moves.map(m => {
                        const p = clone.pieces.find(pp => pp.id === m.pieceId);
                        return {
                            pieceId: m.pieceId,
                            inHomeStretch: Boolean(p && p.inHomeStretch),
                            completed: Boolean(p && p.completed)
                        };
                    });

                    const split = moves.length > 1;
                    let score = split ? 100 : 0;
                    for (let i = 0; i < before.length; i++) {
                        if (!before[i].inHomeStretch && after[i].inHomeStretch) {
                            score += split ? 40 : 10;
                        }
                        if (before[i].inHomeStretch && !before[i].completed && after[i].completed) {
                            score += split ? 60 : 20;
                        }
                    }

                    seenSpecialMoves.add(key);
                    specialCandidates.push({ moves, score });
                } catch (e) {
                    // invalid move, ignore
                }
            };

            for (const cardIdx of sevenIndices) {

                const movable = [];
                for (const info of pieceInfos) {
                    const p = this.game.pieces.find(pp => pp.id === info.id);
                    if (p && !p.completed && !p.inPenaltyZone) {
                        // Allow pieces already in the home stretch to be
                        // considered for splitting the movement. The game will
                        // reject illegal moves.
                        movable.push(info.id);
                    }
                }

                // Split moves across two pieces. These are intentionally
                // generated before single-piece seven moves and scored higher
                // so the bounded special action range exposes split choices.
                for (let i = 0; i < movable.length; i++) {
                    for (let j = i + 1; j < movable.length; j++) {
                        for (let steps = 1; steps <= 6; steps++) {
                            addSpecialCandidate([
                                { pieceId: movable[i], steps },
                                { pieceId: movable[j], steps: 7 - steps }
                            ]);
                        }
                    }
                }

                // Single-piece seven moves remain available when there is room
                // after the higher-value split candidates.
                for (const pid of movable) {
                    addSpecialCandidate([{ pieceId: pid, steps: 7 }]);
                }
            }

            specialCandidates.sort((a, b) => b.score - a.score);
            for (const candidate of specialCandidates) {
                if (specialId >= 70) {
                    break;
                }
                specialActionsList.push(specialId);
                this.specialActions[specialId] = candidate.moves;
                specialId++;
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
                        // invalid move, ignore
                    }
                }
            }

            const validActions = [...specialActionsList, ...moveActions];

            if (validActions.length === 0) {
                // If no moves were generated, allow discarding only low-value
                // cards first. Preserve 7, 8 and Joker unless every discard
                // option is protected.
                const discardCardIndices = this.getPreferredDiscardCardIndices(player.cards, cardIndices);
                for (const cardIdx of discardCardIndices) {
                    validActions.push(70 + cardIdx);
                }
            }

            // Return the complete list of valid actions without truncation so
            // the training environment can consider every possible move.
            return validActions;
        } catch (error) {
            return [];
        }
    }

    isProtectedDiscardCard(card) {
        return Boolean(card && ['7', '8', 'JOKER'].includes(card.value));
    }

    getPreferredDiscardCardIndices(cards, candidateIndices) {
        const safeIndices = (candidateIndices || [])
            .filter(idx => cards && cards[idx] && !this.isProtectedDiscardCard(cards[idx]));
        const selectedIndices = safeIndices.length > 0 ? safeIndices : (candidateIndices || []);
        return selectedIndices.slice(0, 10);
    }


    getTrackCoordinates() {
        const track = [];
        for (let col = 0; col < 19; col++) track.push({ row: 0, col });
        for (let row = 1; row < 19; row++) track.push({ row, col: 18 });
        for (let col = 17; col >= 0; col--) track.push({ row: 18, col });
        for (let row = 17; row > 0; row--) track.push({ row, col: 0 });
        return track;
    }

    positionsEqual(a, b) {
        return Boolean(a && b && a.row === b.row && a.col === b.col);
    }

    entranceForPlayer(playerId) {
        return [
            { row: 0, col: 4 },
            { row: 4, col: 18 },
            { row: 18, col: 14 },
            { row: 14, col: 0 }
        ][playerId];
    }

    startForPlayer(playerId) {
        return [
            { row: 0, col: 8 },
            { row: 8, col: 18 },
            { row: 18, col: 10 },
            { row: 10, col: 0 }
        ][playerId];
    }

    trackIndex(pos) {
        const track = this.getTrackCoordinates();
        return track.findIndex(p => this.positionsEqual(p, pos));
    }

    stepsToEntrance(pos, playerId) {
        const track = this.getTrackCoordinates();
        const startIdx = this.trackIndex(pos);
        const entranceIdx = this.trackIndex(this.entranceForPlayer(playerId));
        if (startIdx < 0 || entranceIdx < 0) return -1;
        return (entranceIdx - startIdx + track.length) % track.length;
    }

    withinHomeEntryReach(piece) {
        if (!piece || piece.inPenaltyZone || piece.inHomeStretch || piece.completed) {
            return false;
        }
        const stepsToEntry = this.stepsToEntrance(piece.position, piece.playerId);
        if (stepsToEntry < 0) return false;
        for (const cardSteps of [1, 2, 3, 4, 5, 6, 7, 9, 10]) {
            const remaining = cardSteps - stepsToEntry;
            if (remaining >= 1 && remaining <= 5) return true;
        }
        return false;
    }

    flattenCaptures(captures) {
        const flat = [];
        for (const capture of captures || []) {
            flat.push(capture);
            if (capture.result && capture.result.captures) {
                flat.push(...this.flattenCaptures(capture.result.captures));
            }
        }
        return flat;
    }

    actionPieceInfo(playerId, actionId) {
        if (actionId >= 60) return null;
        const pieceCount = this.game.piecesPerPlayer || 5;
        let pieceNumber = actionId % 10;
        let cardIndex;
        if (pieceNumber === 0) {
            pieceNumber = 10;
            cardIndex = (actionId - pieceNumber) / 10;
        } else {
            cardIndex = Math.floor(actionId / 10);
        }
        let ownerId = playerId;
        if (pieceNumber > pieceCount) {
            const partner = this.game.partnerIdFor && this.game.partnerIdFor(playerId);
            if (partner === null || partner === undefined) return null;
            ownerId = partner;
            pieceNumber -= pieceCount;
        }
        return { ownerId, pieceNumber, pieceId: `p${ownerId}_${pieceNumber}`, cardIndex };
    }

    simulateActionOutcomes(playerId, actionId) {
        const outcomes = [];
        if (!this.game || actionId >= 70) return outcomes;

        if (actionId >= 60) {
            const moves = this.specialActions[actionId];
            if (!moves) return outcomes;
            const clone = this.game.cloneForSimulation();
            try {
                let result = clone.makeSpecialMove(moves);
                if (result && result.action === 'homeEntryChoice') {
                    result = clone.resumeSpecialMove(true);
                }
                if (!result || result.success === false) return outcomes;
                const movedPieceIds = moves.map(m => m.pieceId);
                const finalPieces = {};
                for (const pid of movedPieceIds) {
                    const piece = clone.pieces.find(p => p.id === pid);
                    if (piece) finalPieces[pid] = JSON.parse(JSON.stringify(piece));
                }
                outcomes.push({
                    captures: this.flattenCaptures(result.captures),
                    movedPieceIds,
                    finalPieces
                });
            } catch (e) {}
            return outcomes;
        }

        const info = this.actionPieceInfo(playerId, actionId);
        if (!info) return outcomes;
        const clone = this.game.cloneForSimulation();
        try {
            let result = clone.makeMove(info.pieceId, info.cardIndex);
            if (result && result.action === 'homeEntryChoice') {
                result = clone.makeMove(info.pieceId, info.cardIndex, true);
            }
            if (result && result.action === 'choosePosition') {
                for (const target of result.validPositions || []) {
                    const choiceClone = this.game.cloneForSimulation();
                    try {
                        const choicePiece = choiceClone.pieces.find(p => p.id === info.pieceId);
                        const choiceResult = choiceClone.moveToSelectedPosition(choicePiece, target.id);
                        const finalPiece = choiceClone.pieces.find(p => p.id === info.pieceId);
                        outcomes.push({
                            captures: this.flattenCaptures(choiceResult && choiceResult.captures),
                            movedPieceIds: [info.pieceId],
                            finalPieces: finalPiece ? { [info.pieceId]: JSON.parse(JSON.stringify(finalPiece)) } : {},
                            jokerTargetId: target.id
                        });
                    } catch (e) {}
                }
            } else if (result && result.success !== false) {
                const finalPiece = clone.pieces.find(p => p.id === info.pieceId);
                outcomes.push({
                    captures: this.flattenCaptures(result.captures),
                    movedPieceIds: [info.pieceId],
                    finalPieces: finalPiece ? { [info.pieceId]: JSON.parse(JSON.stringify(finalPiece)) } : {}
                });
            }
        } catch (e) {}
        return outcomes;
    }

    getFixedPlayActions(playerId, actions) {
        const priority = [];
        const avoid = [];
        if (!this.game) return { priorityActions: priority, avoidActions: avoid };

        const partnerId = this.game.partnerIdFor ? this.game.partnerIdFor(playerId) : null;
        const partnerHasPenaltyPiece = partnerId !== null && partnerId !== undefined && this.game.pieces.some(
            p => p.playerId === partnerId && p.inPenaltyZone && !p.completed
        );
        const partnerStart = this.startForPlayer(partnerId);

        for (const action of actions || []) {
            if (action >= 70) continue;
            const outcomes = this.simulateActionOutcomes(playerId, action);
            let capturesHomeReachOpponent = false;
            let capturesOpponentOnStart = false;
            let capturesPartnerOnStart = false;
            let parksOwnPieceOnPartnerStart = false;
            let vacatesPartnerStart = false;

            for (const outcome of outcomes) {
                for (const capture of outcome.captures || []) {
                    const capturedBefore = this.game.pieces.find(p => p.id === capture.pieceId);
                    if (!capturedBefore) continue;
                    const isPartner = this.game.isPartner && this.game.isPartner(playerId, capturedBefore.playerId);
                    const isSelf = capturedBefore.playerId === playerId;
                    const isOpponent = !isSelf && !isPartner;
                    if (isOpponent && this.withinHomeEntryReach(capturedBefore)) {
                        capturesHomeReachOpponent = true;
                    }
                    const capturedStart = this.startForPlayer(capturedBefore.playerId);
                    if (isOpponent && this.positionsEqual(capturedBefore.position, capturedStart)) {
                        capturesOpponentOnStart = true;
                    }
                    if (isPartner && this.positionsEqual(capturedBefore.position, capturedStart)) {
                        capturesPartnerOnStart = true;
                    }
                }
            }

            if (partnerHasPenaltyPiece && partnerStart) {
                for (const outcome of outcomes) {
                    for (const pieceId of outcome.movedPieceIds || []) {
                        const beforeMove = this.game.pieces.find(p => p.id === pieceId);
                        const afterMove = outcome.finalPieces && outcome.finalPieces[pieceId];
                        if (!beforeMove || beforeMove.playerId !== playerId) continue;
                        const startedOnPartnerStart = this.positionsEqual(beforeMove.position, partnerStart);
                        const endedOnPartnerStart = this.positionsEqual(afterMove && afterMove.position, partnerStart);
                        if (!startedOnPartnerStart && endedOnPartnerStart) {
                            parksOwnPieceOnPartnerStart = true;
                        }
                        if (startedOnPartnerStart && !endedOnPartnerStart) {
                            vacatesPartnerStart = true;
                        }
                    }
                }
            }

            if (capturesHomeReachOpponent || capturesPartnerOnStart || parksOwnPieceOnPartnerStart) {
                priority.push(action);
            }
            if (capturesOpponentOnStart || vacatesPartnerStart) {
                avoid.push(action);
            }
        }

        return {
            priorityActions: Array.from(new Set(priority)),
            avoidActions: Array.from(new Set(avoid))
        };
    }

    actionWouldEnterHome(playerId, actionId) {
        try {
            if (!this.game || !this.game.players || !this.game.players[playerId] || actionId >= 70) {
                return false;
            }

            const clone = this.game.cloneForSimulation();

            if (actionId >= 60) {
                const moves = this.specialActions[actionId];
                if (!moves) return false;
                const before = moves.map(m => {
                    const piece = clone.pieces.find(p => p.id === m.pieceId);
                    return {
                        id: m.pieceId,
                        inHomeStretch: Boolean(piece && piece.inHomeStretch)
                    };
                });
                let result = clone.makeSpecialMove(moves);
                if (result && result.action === 'homeEntryChoice') {
                    result = clone.resumeSpecialMove(true);
                }
                if (result && result.success === false) {
                    return false;
                }
                return before.some(info => {
                    const piece = clone.pieces.find(p => p.id === info.id);
                    return piece && !info.inHomeStretch && piece.inHomeStretch;
                });
            }

            const cardIndex = Math.floor(actionId / 10);
            let pieceNumber = actionId % 10;
            if (pieceNumber === 0) {
                pieceNumber = 10;
            }

            const countCheck = this.game.piecesPerPlayer || 5;
            let ownerId = playerId;
            if (pieceNumber > countCheck) {
                const partner = this.game.partnerIdFor && this.game.partnerIdFor(playerId);
                if (partner === null || partner === undefined) {
                    return false;
                }
                ownerId = partner;
                pieceNumber -= countCheck;
            }

            const pieceId = `p${ownerId}_${pieceNumber}`;
            const beforePiece = clone.pieces.find(p => p.id === pieceId);
            if (!beforePiece || beforePiece.inHomeStretch || beforePiece.completed) {
                return false;
            }

            let result = clone.makeMove(pieceId, cardIndex);
            if (result && result.action === 'homeEntryChoice') {
                result = clone.makeMove(pieceId, cardIndex, true);
            }
            if (result && result.success === false) {
                return false;
            }

            const afterPiece = clone.pieces.find(p => p.id === pieceId);
            return Boolean(afterPiece && afterPiece.inHomeStretch);
        } catch (e) {
            return false;
        }
    }

    getHomeEntryActions(playerId, actions) {
        const result = [];
        for (const action of actions || []) {
            if (this.actionWouldEnterHome(playerId, action)) {
                result.push(action);
            }
        }
        return result;
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
                    const countCheck = this.game.piecesPerPlayer || 5;
                    let ownerId = playerId;
                    if (pieceNumber > countCheck) {
                        const partner = this.game.partnerIdFor && this.game.partnerIdFor(playerId);
                        if (partner === null || partner === undefined) {
                            continue;
                        }
                        ownerId = partner;
                        pieceNumber -= countCheck;
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
                    let result = clone.makeSpecialMove(moves);
                    if (result && result.action === 'homeEntryChoice') {
                        result = clone.resumeSpecialMove(true);
                    }
                    if (result && result.success === false) {
                        return false;
                    }
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

            const countCheck = this.game.piecesPerPlayer || 5;
            let ownerId = playerId;
            if (pieceNumber > countCheck) {
                const partner = this.game.partnerIdFor && this.game.partnerIdFor(playerId);
                if (partner === null || partner === undefined) {
                    return false;
                }
                ownerId = partner;
                pieceNumber -= countCheck;
            }

            const pid = `p${ownerId}_${pieceNumber}`;
            let res;
            try {
                res = clone.makeMove(pid, cardIndex);
            } catch (err) {
                // Move is invalid if clone.makeMove throws (e.g., "Casa de chegada já ocupada")
                return false;
            }

            if (res && res.action === 'choosePosition') {
                const piece = clone.pieces.find(p => p.id === pid);
                for (const target of res.validPositions || []) {
                    try {
                        clone.moveToSelectedPosition(piece, target.id);
                        return true;
                    } catch (e) {
                        continue;
                    }
                }
                return false;
            }

            if (res && res.action === 'homeEntryChoice') {
                return true;
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

                const preferredDiscardCardIndices = this.getPreferredDiscardCardIndices(
                    this.game.players[playerId].cards,
                    Object.keys(this.game.players[playerId].cards || {}).map(Number)
                );
                if (this.isProtectedDiscardCard(playedCard) &&
                    preferredDiscardCardIndices.length > 0 &&
                    !preferredDiscardCardIndices.includes(cardIndex)) {
                    return this.makeMove(playerId, 70 + preferredDiscardCardIndices[0]);
                }

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
                        const count = this.game.piecesPerPlayer || 5;
                        const infos = [];
                        for (let n = 1; n <= count; n++) {
                            infos.push({ owner: playerId, id: `p${playerId}_${n}` });
                        }
                        if (this.game.hasAllPiecesInHomeStretch && this.game.partnerIdFor &&
                            this.game.hasAllPiecesInHomeStretch(playerId)) {
                            const partner = this.game.partnerIdFor(playerId);
                            if (partner !== null && partner !== undefined) {
                                for (let n = 1; n <= count; n++) {
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
                                const count7 = this.game.piecesPerPlayer || 5;
                                const infoList = [];
                                for (let n = 1; n <= count7; n++) {
                                    infoList.push(`p${playerId}_${n}`);
                                }
                                if (this.game.hasAllPiecesInHomeStretch && this.game.partnerIdFor &&
                                    this.game.hasAllPiecesInHomeStretch(playerId)) {
                                    const partner = this.game.partnerIdFor(playerId);
                                    if (partner !== null && partner !== undefined) {
                                        for (let n = 1; n <= count7; n++) {
                                            infoList.push(`p${partner}_${n}`);
                                        }
                                    }
                                }
                                for (const pid of infoList) {
                                    const p = this.game.pieces.find(pp => (
                                        pp.id === pid && !pp.completed && !pp.inPenaltyZone
                                    ));
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
                            const fallbackLabel = fallbackCard.value === 'JOKER' ? 'C' : fallbackCard.value;
                            const dMsg = `${player.name} descartou um ${fallbackLabel}`;
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
                const countCheck2 = this.game.piecesPerPlayer || 5;
                let ownerId = playerId;
                if (pieceNumber > countCheck2) {
                    const partner = this.game.partnerIdFor && this.game.partnerIdFor(playerId);
                    if (partner === null || partner === undefined) {
                        throw new Error('Invalid partner move');
                    }
                    ownerId = partner;
                    pieceNumber -= countCheck2;
                }
                const pieceId = `p${ownerId}_${pieceNumber}`;
                playedCard = this.game.players[playerId].cards[cardIndex];
                result = this.game.makeMove(pieceId, cardIndex);

                if (result && result.action === 'homeEntryChoice') {
                    result = this.game.makeMove(pieceId, cardIndex, true);
                }

                if (result && result.action === 'choosePosition') {
                    const targets = result.validPositions || [];
                    let target = targets[0];
                    let bestScore = -Infinity;
                    for (const candidate of targets) {
                        const targetPiece = this.game.pieces.find(p => p.id === candidate.id);
                        if (!targetPiece) continue;
                        const isPartner = this.game.isPartner && this.game.isPartner(playerId, targetPiece.playerId);
                        const isOpponent = targetPiece.playerId !== playerId && !isPartner;
                        let score = 0;
                        if (isOpponent && this.withinHomeEntryReach(targetPiece)) score += 100;
                        const targetStart = this.startForPlayer(targetPiece.playerId);
                        if (isOpponent && this.positionsEqual(targetPiece.position, targetStart)) {
                            score -= 50;
                        }
                        if (isPartner && this.positionsEqual(targetPiece.position, targetStart)) {
                            score += 80;
                        }
                        if (score > bestScore) {
                            bestScore = score;
                            target = candidate;
                        }
                    }
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
                winningTeam,
                playedCardValue: playedCard ? playedCard.value : null
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
                winningTeam,
                specialMove: {
                    cardValue: '7',
                    split: moves.length > 1,
                    moves
                }
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

