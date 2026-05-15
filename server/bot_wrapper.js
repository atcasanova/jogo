const { Game } = require('./game');

class BotWrapper {
  constructor(game) {
    this.game = game;
    this.specialActions = {};
  }

  getGameState() {
    if (typeof this.game.getGameStateWithCards === 'function') {
      return this.game.getGameStateWithCards();
    }
    return this.game.getGameState();
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
      let specialId = 60;

      const uniqueIndices = {};
      for (let idx = 0; idx < player.cards.length; idx++) {
        const val = player.cards[idx].value;
        if (!(val in uniqueIndices)) {
          uniqueIndices[val] = idx;
        }
      }
      const cardIndices = Object.values(uniqueIndices).sort((a, b) => a - b);
      const maxMoveCards = Math.min(cardIndices.length, 6);

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

      // Search the entire hand for sevens so bots consider them even when
      // more than six unique values appear. Limit to the first four sevens
      // to mirror the training wrapper logic.
      const sevenIndices = [];
      for (let i = 0; i < player.cards.length && sevenIndices.length < 4; i++) {
        if (player.cards[i].value === '7') {
          sevenIndices.push(i);
        }
      }
      for (const cardIdx of sevenIndices) {

        const movable = [];
        for (const info of pieceInfos) {
          const p = this.game.pieces.find(pp => pp.id === info.id);
          if (p && !p.completed && !p.inPenaltyZone) {
            // Include pieces already in the home stretch. The game engine will
            // validate whether the resulting split move is legal.
            movable.push(info.id);
          }
        }

        for (const pid of movable) {
          const moves = [{ pieceId: pid, steps: 7 }];
          const clone = this.game.cloneForSimulation();
          try {
            clone.makeSpecialMove(moves);
            specialActionsList.push(specialId);
            this.specialActions[specialId] = moves;
            specialId++;
          } catch (e) {
            // ignore invalid
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
                continue;
              }
            }
          }
        }
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
            continue;
          }
        }
      }

      const validActions = [...specialActionsList, ...moveActions];

      if (validActions.length === 0) {
        const discardCardIndices = this.getPreferredDiscardCardIndices(player.cards, cardIndices);
        for (const cardIdx of discardCardIndices) {
          validActions.push(70 + cardIdx);
        }
      }

      return this.applyActionConstraints(playerId, validActions);
    } catch (e) {
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

  homeStretchForPlayer(playerId, game = this.game) {
    if (game && typeof game.homeStretchForPlayer === 'function') {
      return game.homeStretchForPlayer(playerId);
    }
    return [
      [
        { row: 1, col: 4 },
        { row: 2, col: 4 },
        { row: 3, col: 4 },
        { row: 4, col: 4 },
        { row: 5, col: 4 }
      ],
      [
        { row: 4, col: 17 },
        { row: 4, col: 16 },
        { row: 4, col: 15 },
        { row: 4, col: 14 },
        { row: 4, col: 13 }
      ],
      [
        { row: 17, col: 14 },
        { row: 16, col: 14 },
        { row: 15, col: 14 },
        { row: 14, col: 14 },
        { row: 13, col: 14 }
      ],
      [
        { row: 14, col: 1 },
        { row: 14, col: 2 },
        { row: 14, col: 3 },
        { row: 14, col: 4 },
        { row: 14, col: 5 }
      ]
    ][playerId];
  }

  homeStretchIndex(piece, game = this.game) {
    if (!piece || !piece.position) return -1;
    const stretch = this.homeStretchForPlayer(piece.playerId, game);
    if (!stretch) return -1;
    return stretch.findIndex(pos => this.positionsEqual(pos, piece.position));
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

  getHomeReachExitActions(playerId, actions) {
    const avoid = [];
    if (!this.game) return avoid;

    for (const action of actions || []) {
      if (action >= 70) continue;
      const outcomes = this.simulateActionOutcomes(playerId, action);
      if (outcomes.length === 0) continue;

      const everyOutcomeLeavesReach = outcomes.every(outcome => {
        let movedReachPiece = false;

        for (const pieceId of outcome.movedPieceIds || []) {
          const beforeMove = this.game.pieces.find(p => p.id === pieceId);
          const afterMove = outcome.finalPieces && outcome.finalPieces[pieceId];
          if (!beforeMove || !afterMove || !this.withinHomeEntryReach(beforeMove)) {
            continue;
          }

          movedReachPiece = true;
          const enteredHome = Boolean(afterMove.inHomeStretch || afterMove.completed);
          if (enteredHome || this.withinHomeEntryReach(afterMove)) {
            return false;
          }
        }

        return movedReachPiece;
      });

      if (everyOutcomeLeavesReach) {
        avoid.push(action);
      }
    }

    return Array.from(new Set(avoid));
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

  homeEntryDepthForAction(playerId, actionId) {
    try {
      if (!this.game || !this.game.players || !this.game.players[playerId] || actionId >= 70) {
        return -1;
      }

      const clone = this.game.cloneForSimulation();

      if (actionId >= 60) {
        const moves = this.specialActions[actionId];
        if (!moves) return -1;
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
          return -1;
        }
        return before.reduce((bestDepth, info) => {
          const piece = clone.pieces.find(p => p.id === info.id);
          if (!piece || info.inHomeStretch || !piece.inHomeStretch) return bestDepth;
          return Math.max(bestDepth, this.homeStretchIndex(piece, clone));
        }, -1);
      }

      const info = this.actionPieceInfo(playerId, actionId);
      if (!info) return -1;
      const beforePiece = clone.pieces.find(p => p.id === info.pieceId);
      if (!beforePiece || beforePiece.inHomeStretch || beforePiece.completed) {
        return -1;
      }

      let result = clone.makeMove(info.pieceId, info.cardIndex);
      if (result && result.action === 'homeEntryChoice') {
        result = clone.makeMove(info.pieceId, info.cardIndex, true);
      }
      if (result && result.success === false) {
        return -1;
      }

      const afterPiece = clone.pieces.find(p => p.id === info.pieceId);
      if (!afterPiece || !afterPiece.inHomeStretch) return -1;
      return this.homeStretchIndex(afterPiece, clone);
    } catch (e) {
      return -1;
    }
  }

  actionWouldEnterHome(playerId, actionId) {
    return this.homeEntryDepthForAction(playerId, actionId) >= 0;
  }

  homeStretchProgressForAction(playerId, actionId) {
    try {
      if (!this.game || !this.game.players || !this.game.players[playerId] || actionId >= 70) {
        return -1;
      }

      const clone = this.game.cloneForSimulation();
      const beforeByPiece = new Map();
      const trackBefore = (pieceId) => {
        const piece = clone.pieces.find(p => p.id === pieceId);
        if (!piece || !piece.inHomeStretch || piece.completed) return;
        beforeByPiece.set(pieceId, this.homeStretchIndex(piece, clone));
      };

      if (actionId >= 60) {
        const moves = this.specialActions[actionId];
        if (!moves) return -1;
        for (const move of moves) {
          trackBefore(move.pieceId);
        }
        if (beforeByPiece.size === 0) return -1;

        let result = clone.makeSpecialMove(moves);
        if (result && result.action === 'homeEntryChoice') {
          result = clone.resumeSpecialMove(true);
        }
        if (result && result.success === false) {
          return -1;
        }
      } else {
        const info = this.actionPieceInfo(playerId, actionId);
        if (!info) return -1;
        const card = this.game.players[playerId].cards[info.cardIndex];
        if (!card || !['A', '2', '3', '4'].includes(card.value)) {
          return -1;
        }
        trackBefore(info.pieceId);
        if (beforeByPiece.size === 0) return -1;

        const result = clone.makeMove(info.pieceId, info.cardIndex);
        if (result && result.success === false) {
          return -1;
        }
      }

      let bestProgress = -1;
      for (const [pieceId, beforeIndex] of beforeByPiece.entries()) {
        const piece = clone.pieces.find(p => p.id === pieceId);
        const afterIndex = this.homeStretchIndex(piece, clone);
        if (afterIndex > beforeIndex) {
          bestProgress = Math.max(bestProgress, afterIndex);
        }
      }
      return bestProgress;
    } catch (e) {
      return -1;
    }
  }

  getHomeStretchMoveActions(playerId, actions) {
    const moves = (actions || [])
      .map(action => ({ action, progress: this.homeStretchProgressForAction(playerId, action) }))
      .filter(entry => entry.progress >= 0);
    if (moves.length === 0) return [];

    const deepest = Math.max(...moves.map(entry => entry.progress));
    return moves.filter(entry => entry.progress === deepest).map(entry => entry.action);
  }

  getHomeEntryActions(playerId, actions) {
    const entries = (actions || [])
      .map(action => ({ action, depth: this.homeEntryDepthForAction(playerId, action) }))
      .filter(entry => entry.depth >= 0);
    if (entries.length === 0) return [];

    const deepest = Math.max(...entries.map(entry => entry.depth));
    return entries.filter(entry => entry.depth === deepest).map(entry => entry.action);
  }

  applyActionConstraints(playerId, actions) {
    const validActions = Array.from(new Set(actions || []));
    const validActionSet = new Set(validActions);
    const homeEntryActions = this.getHomeEntryActions(playerId, validActions);
    if (homeEntryActions.length > 0) {
      return homeEntryActions;
    }

    const homeStretchMoveActions = this.getHomeStretchMoveActions(playerId, validActions);
    if (homeStretchMoveActions.length > 0) {
      return homeStretchMoveActions;
    }

    const homeReachExitActions = new Set(
      this.getHomeReachExitActions(playerId, validActions).filter(action => validActionSet.has(action))
    );
    const reachSafeActions = validActions.filter(action => !homeReachExitActions.has(action));
    if (reachSafeActions.length > 0 && reachSafeActions.length < validActions.length) {
      return this.applyActionConstraints(playerId, reachSafeActions);
    }

    const fixedPlayMetadata = this.getFixedPlayActions(playerId, validActions);
    const fixedPlayActions = fixedPlayMetadata.priorityActions.filter(action => validActionSet.has(action));
    if (fixedPlayActions.length > 0) {
      return fixedPlayActions;
    }

    const avoidActions = new Set(
      fixedPlayMetadata.avoidActions.filter(action => validActionSet.has(action))
    );
    const filteredActions = validActions.filter(action => !avoidActions.has(action));
    return filteredActions.length > 0 ? filteredActions : validActions;
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
          const alt = this.getValidActions(playerId)[0];
          if (alt !== undefined) {
            return this.makeMove(playerId, alt);
          }
        }

        try {
          result = this.game.discardCard(cardIndex);
        } catch (e) {
          throw e;
        }
      } else if (actionId >= 60) {
        playedCard = this.game.players[playerId].cards.find(card => card.value === '7');
        const moves = this.specialActions[actionId];
        if (!moves) {
          throw new Error('Invalid special action');
        }
        result = this.game.makeSpecialMove(moves);
        if (result && result.action === 'homeEntryChoice') {
          result = this.game.resumeSpecialMove(true);
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
          const targets = result.validPositions || [];
          let target = targets[0];
          let bestScore = -Infinity;
          for (const candidate of targets) {
            const targetPiece = this.game.pieces.find(p => p.id === candidate.id);
            if (!targetPiece) continue;
            const isPartner = this.game.isPartner && this.game.isPartner(playerId, targetPiece.playerId);
            const isOpponent = targetPiece.playerId !== playerId && !isPartner;
            const targetStart = this.startForPlayer(targetPiece.playerId);
            let score = 0;
            if (isOpponent && this.withinHomeEntryReach(targetPiece)) score += 100;
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
          this.game.history.push({ move: msg, state: this.getGameState() });
          this.game.nextTurn();
        }
      }

      if (jokerPlayed) {
        this.game.stats.jokersPlayed[playerId]++;
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
        moves: result && result.moves ? result.moves : null,
        playedCard: playedCard ? { suit: playedCard.suit, value: playedCard.value } : null,
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

module.exports = BotWrapper;
