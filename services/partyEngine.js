import { randomUUID } from "node:crypto";
import { PartyRoomError } from "./partyRoomService.js";

const GAME_RESULTS_DURATION_MS = 10_000;
const ROUND_FINISH_DELAY_MS = 1_000;
const MAX_GAME_POINTS = 1_000_000;
const MAX_GAME_STATE_SIZE = 32_000;
const MAX_GARTIC_STATE_SIZE = 12_000_000;

const serializeId = value => String(value);

function rankedScores(participants, pointsByUser) {
  const sorted = participants.map(participant => ({
    userId: serializeId(participant.userId),
    username: participant.username,
    points: pointsByUser.get(serializeId(participant.userId)) || 0
  })).sort((left, right) =>
    right.points - left.points || left.username.localeCompare(right.username, "pt-BR")
  );
  let position = 0;
  return sorted.map((entry, index) => {
    if (index === 0 || entry.points !== sorted[index - 1].points) position = index + 1;
    return { ...entry, position };
  });
}

export class PartyEngine {
  constructor({ PartyRoom, PartySession, service, gameManager, publish, publishPrivate, now = () => new Date() }) {
    this.PartyRoom = PartyRoom;
    this.PartySession = PartySession;
    this.service = service;
    this.gameManager = gameManager;
    this.publish = publish;
    this.publishPrivate = publishPrivate || (() => {});
    this.now = now;
    this.timers = new Map();
    this.actionQueues = new Map();
  }

  async start(roomId, userId) {
    const room = await this.service.requireHost(roomId, userId);
    if (room.state !== "waiting") throw new PartyRoomError("A sala não está aguardando uma Party.", 409);

    const selectedGames = (room.partyConfig?.games || [])
      .filter(game => game.enabled)
      .map(game => {
        if (!this.gameManager.has(game.id)) {
          throw new PartyRoomError(`O jogo "${game.name}" não está disponível.`, 409);
        }
        const module = this.gameManager.get(game.id);
        return { id: module.id, name: module.name, enabled: true };
      });
    if (!selectedGames.length) throw new PartyRoomError("Ative ao menos um jogo para iniciar a Party.");
    for (const game of selectedGames) {
      await this.gameManager.get(game.id).validateStart({
        room,
        party: null,
        game,
        participants: room.participants
      });
    }

    const startedAt = this.now();
    const party = {
      id: randomUUID(),
      status: "party_running",
      currentGameIndex: 0,
      selectedGames,
      gameState: null,
      gameStateVersion: 0,
      leftUserIds: [],
      roundFinishAt: null,
      scores: room.participants.map(participant => ({
        userId: participant.userId,
        username: participant.username,
        totalPoints: 0
      })),
      gameResults: [],
      startedAt,
      currentGameStartedAt: startedAt,
      phaseEndsAt: null,
      finishedAt: null
    };
    const updated = await this.PartyRoom.findOneAndUpdate({
      _id: room._id,
      hostId: userId,
      $or: [{ state: "waiting" }, { state: { $exists: false }, status: "waiting" }]
    }, {
      $set: { state: "party_running", status: "started", currentParty: party }
    }, { returnDocument: "after", runValidators: true });
    if (!updated) throw new PartyRoomError("A sala foi atualizada; tente novamente.", 409);

    let startedRoom = updated;
    try {
      startedRoom = await this.startCurrentGame(updated);
    } catch (error) {
      await this.PartyRoom.updateOne({
        _id: updated._id,
        state: "party_running",
        "currentParty.id": party.id
      }, { $set: { state: "waiting", status: "waiting", currentParty: null } });
      throw new PartyRoomError(`Não foi possível iniciar o jogo: ${error.message}`, 500);
    }

    await this.persistSession(startedRoom);
    const currentRoom = await this.service.get(roomId);
    const clientState = await this.getClientState(startedRoom);
    this.broadcast("party:start", currentRoom);
    this.broadcast("party:game-start", currentRoom, { game: selectedGames[0], gameState: clientState });
    this.broadcast("party:score-update", currentRoom, { scores: currentRoom.currentParty.scores });
    await this.publishPrivateGameStates(startedRoom);
    this.scheduleGameAction(startedRoom);
    return currentRoom;
  }

  async getPartyState(roomId, userId) {
    const room = await this.service.requireParticipant(roomId, userId);
    const clientState = await this.getClientState(room, userId);
    return { room: await this.service.get(roomId), gameState: clientState };
  }

  async finishGame(roomId, userId) {
    const room = await this.service.requireHost(roomId, userId);
    return this.beginGameFinish(room);
  }

  leaveGame(roomId, userId) {
    const key = serializeId(roomId);
    const previous = this.actionQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() =>
      this.processLeaveGame(roomId, userId)
    );
    this.actionQueues.set(key, current);
    return current.finally(() => {
      if (this.actionQueues.get(key) === current) this.actionQueues.delete(key);
    });
  }

  async processLeaveGame(roomId, userId) {
    const room = await this.service.requireParticipant(roomId, userId);
    if (!["party_running", "showing_game_results"].includes(room.state) ||
        !room.currentParty) {
      throw new PartyRoomError("Não há uma partida ativa para abandonar.", 409);
    }

    const party = room.currentParty.toObject
      ? room.currentParty.toObject()
      : room.currentParty;
    const playerId = serializeId(userId);
    const leftUserIds = [...new Set([...(party.leftUserIds || []), playerId])];
    if (leftUserIds.length === (party.leftUserIds || []).length) {
      throw new PartyRoomError("Você já abandonou esta Party.", 409);
    }
    const activeParticipants = room.participants.filter(participant =>
      !leftUserIds.includes(serializeId(participant.userId))
    );
    const scores = party.scores.filter(score =>
      !leftUserIds.includes(serializeId(score.userId))
    );
    const partyUpdate = {
      ...party,
      leftUserIds,
      scores,
      gameStateVersion: (party.gameStateVersion || 0) + 1
    };
    const becomesFinal = activeParticipants.length <= 1;
    const nextState = becomesFinal ? "showing_final_results" : room.state;

    if (becomesFinal) {
      partyUpdate.status = nextState;
      partyUpdate.roundFinishAt = null;
      partyUpdate.phaseEndsAt = null;
      partyUpdate.finishedAt = this.now();
    } else if (room.state === "party_running") {
      const game = party.selectedGames[party.currentGameIndex];
      if (!game) throw new PartyRoomError("O jogo atual da Party não foi encontrado.", 409);
      const module = this.gameManager.get(game.id);
      partyUpdate.gameState = await module.handlePlayerLeave({
        room,
        party,
        game,
        userId: playerId,
        participants: activeParticipants,
        state: JSON.parse(JSON.stringify(party.gameState)),
        now: this.now
      });
      if (!partyUpdate.gameState || typeof partyUpdate.gameState !== "object" ||
          Array.isArray(partyUpdate.gameState)) {
        throw new PartyRoomError("O jogo retornou um estado inválido após a desistência.", 500);
      }
    }

    const updated = await this.PartyRoom.findOneAndUpdate({
      _id: room._id,
      state: room.state,
      "currentParty.id": party.id,
      "currentParty.gameStateVersion": party.gameStateVersion || 0
    }, {
      $set: {
        state: nextState,
        currentParty: partyUpdate
      }
    }, { returnDocument: "after", runValidators: true });
    if (!updated) throw new PartyRoomError("A partida foi atualizada; tente novamente.", 409);

    await this.persistSession(updated);
    if (becomesFinal) {
      const key = serializeId(room._id);
      clearTimeout(this.timers.get(key));
      this.timers.delete(key);
    }
    const currentRoom = await this.service.get(roomId);
    const gameState = becomesFinal ? null : await this.getClientState(updated);
    this.broadcast("party:player-left", currentRoom, { userId: playerId, gameState });
    if (becomesFinal) {
      const rankings = rankedScores(
        currentRoom.currentParty.scores,
        new Map(currentRoom.currentParty.scores.map(score => [
          serializeId(score.userId),
          score.totalPoints
        ]))
      );
      this.broadcast("party:final-results", currentRoom, { rankings });
    } else if (room.state === "party_running") {
      await this.publishPrivateGameStates(updated);
      this.scheduleGameAction(updated);
    }
    return currentRoom;
  }

  async endNow(roomId, userId) {
    const room = await this.service.requireHost(roomId, userId);
    if (room.state !== "showing_final_results" || !room.currentParty) {
      throw new PartyRoomError("A Party ainda não está no placar final.", 409);
    }
    const party = room.currentParty.toObject
      ? room.currentParty.toObject()
      : room.currentParty;
    const finishedAt = party.finishedAt || this.now();
    const savedSession = await this.persistSession(room, "ended", finishedAt);
    if (!savedSession) throw new Error("Não foi possível arquivar a sessão da Party.");

    const updated = await this.PartyRoom.findOneAndUpdate({
      _id: room._id,
      state: "showing_final_results",
      "currentParty.id": party.id
    }, {
      $set: { state: "waiting", status: "waiting", currentParty: null }
    }, { returnDocument: "after", runValidators: true });
    if (!updated) throw new PartyRoomError("A sala foi atualizada; tente novamente.", 409);

    const roomKey = serializeId(room._id);
    clearTimeout(this.timers.get(roomKey));
    this.timers.delete(roomKey);
    const currentRoom = await this.service.get(roomId);
    const finalRankings = rankedScores(
      party.scores,
      new Map(party.scores.map(score => [
        serializeId(score.userId),
        score.totalPoints
      ]))
    );
    const resultMessage = await this.service.partyResultMessage(
      roomId,
      userId,
      finalRankings,
      party.leftUserIds || []
    );
    this.publish("room:message", roomKey, resultMessage);
    this.broadcast("party:end", currentRoom, {
      finalRankings,
      endedBy: serializeId(userId)
    });
    return currentRoom;
  }

  async finishCurrentGame(room) {
    const roomId = serializeId(room._id);
    if (room.state !== "party_running" || !room.currentParty) {
      throw new PartyRoomError("Não há um jogo em andamento para finalizar.", 409);
    }

    const party = room.currentParty.toObject
      ? room.currentParty.toObject()
      : room.currentParty;
    if (!party.roundFinishAt || new Date(party.roundFinishAt) > this.now()) {
      throw new PartyRoomError("A rodada ainda está sendo finalizada.", 409);
    }
    const game = party.selectedGames[party.currentGameIndex];
    if (!game) throw new PartyRoomError("O jogo atual da Party não foi encontrado.", 409);
    const module = this.gameManager.get(game.id);
    const activeParticipants = room.participants.filter(participant =>
      !(party.leftUserIds || []).includes(serializeId(participant.userId))
    );
    const context = { room, party, game, participants: activeParticipants };
    const gameState = await module.finish({ ...context, state: party.gameState });
    const calculatedScores = await module.calculateScores({ ...context, state: party.gameState }, gameState);
    if (!Array.isArray(calculatedScores)) throw new PartyRoomError("O jogo retornou pontuações inválidas.", 500);

    const pointsByUser = new Map();
    const participantIds = new Set(activeParticipants.map(person => serializeId(person.userId)));
    for (const score of calculatedScores) {
      const scoreUserId = serializeId(score?.userId || "");
      const points = score?.points;
      if (!participantIds.has(scoreUserId) || !Number.isSafeInteger(points) || points < 0 || points > MAX_GAME_POINTS) {
        throw new PartyRoomError("O jogo retornou uma pontuação inválida.", 500);
      }
      pointsByUser.set(scoreUserId, (pointsByUser.get(scoreUserId) || 0) + points);
      if (pointsByUser.get(scoreUserId) > MAX_GAME_POINTS) {
        throw new PartyRoomError("A pontuação do jogo excedeu o limite permitido.", 500);
      }
    }

    const gameRankings = rankedScores(activeParticipants, pointsByUser);
    const updatedScores = party.scores.map(score => ({
      userId: score.userId,
      username: score.username,
      totalPoints: score.totalPoints + (pointsByUser.get(serializeId(score.userId)) || 0)
    }));
    const finishedAt = this.now();
    const gameResult = {
      gameId: game.id,
      gameName: game.name,
      rankings: gameRankings,
      finishedAt
    };
    const moduleResults = module.getResults({ ...context, gameResult });
    if (!Array.isArray(moduleResults)) throw new PartyRoomError("O jogo retornou resultados inválidos.", 500);
    const isLastGame = party.currentGameIndex + 1 >= party.selectedGames.length;
    const nextParty = {
      ...party,
      roundFinishAt: null,
      status: isLastGame ? "showing_final_results" : "showing_game_results",
      scores: updatedScores,
      gameResults: [...party.gameResults, gameResult],
      phaseEndsAt: isLastGame ? null : new Date(finishedAt.getTime() + GAME_RESULTS_DURATION_MS)
    };

    const updated = await this.PartyRoom.findOneAndUpdate({
      _id: room._id,
      state: "party_running",
      "currentParty.id": party.id,
      "currentParty.currentGameIndex": party.currentGameIndex,
      "currentParty.gameStateVersion": party.gameStateVersion || 0
    }, {
      $set: { state: nextParty.status, currentParty: nextParty }
    }, { returnDocument: "after", runValidators: true });
    if (!updated) throw new PartyRoomError("O jogo já foi finalizado.", 409);

    await this.persistSession(updated);
    if (!isLastGame) this.schedule(updated);
    const currentRoom = await this.service.get(roomId);
    this.broadcast("party:game-finish", currentRoom, { gameResult });
    this.broadcast("party:score-update", currentRoom, { scores: currentRoom.currentParty.scores });
    if (isLastGame) {
      const rankings = rankedScores(
        currentRoom.currentParty.scores,
        new Map(currentRoom.currentParty.scores.map(score => [
          serializeId(score.userId),
          score.totalPoints
        ]))
      );
      this.broadcast("party:final-results", currentRoom, { rankings });
    } else {
      this.broadcast("party:game-results", currentRoom, {
        gameResult: { ...gameResult, rankings: moduleResults },
        durationMs: GAME_RESULTS_DURATION_MS
      });
    }
    return currentRoom;
  }

  async beginGameFinish(room) {
    if (room.state !== "party_running" || !room.currentParty) {
      throw new PartyRoomError("Não há um jogo em andamento para finalizar.", 409);
    }
    const party = room.currentParty.toObject
      ? room.currentParty.toObject()
      : room.currentParty;
    if (party.roundFinishAt) {
      this.scheduleRoundFinish(room);
      return this.service.get(room._id);
    }

    const roundFinishAt = new Date(this.now().getTime() + ROUND_FINISH_DELAY_MS);
    const updated = await this.PartyRoom.findOneAndUpdate({
      _id: room._id,
      state: "party_running",
      "currentParty.id": party.id,
      "currentParty.currentGameIndex": party.currentGameIndex,
      "currentParty.gameStateVersion": party.gameStateVersion || 0,
      "currentParty.roundFinishAt": null
    }, {
      $set: { "currentParty.roundFinishAt": roundFinishAt }
    }, { returnDocument: "after", runValidators: true });
    if (!updated) {
      const current = await this.PartyRoom.findById(room._id).lean();
      if (current?.state === "party_running" &&
          current.currentParty?.id === party.id &&
          current.currentParty.currentGameIndex === party.currentGameIndex &&
          current.currentParty.roundFinishAt) {
        this.scheduleRoundFinish(current);
        return this.service.get(room._id);
      }
      throw new PartyRoomError("A rodada foi atualizada; tente novamente.", 409);
    }

    await this.persistSession(updated);
    const currentRoom = await this.service.get(room._id);
    this.broadcast("party:round-ending", currentRoom, { roundFinishAt });
    this.scheduleRoundFinish(updated);
    return currentRoom;
  }

  scheduleRoundFinish(room) {
    const roomId = serializeId(room._id);
    const party = room.currentParty?.toObject
      ? room.currentParty.toObject()
      : room.currentParty;
    if (room.state !== "party_running" || !party?.roundFinishAt) return;

    clearTimeout(this.timers.get(roomId));
    const delay = Math.max(0, Math.min(
      new Date(party.roundFinishAt).getTime() - this.now().getTime(),
      2_147_000_000
    ));
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      void this.runScheduledRoundFinish(
        roomId,
        party.id,
        party.currentGameIndex
      ).catch(error => {
        if (error.status === 409) return;
        console.error(`Não foi possível finalizar a rodada da sala ${roomId}:`, error);
        this.scheduleRoundFinishRetry(roomId, party.id, party.currentGameIndex);
      });
    }, delay);
    timer.unref?.();
    this.timers.set(roomId, timer);
  }

  async runScheduledRoundFinish(roomId, partyId, gameIndex) {
    clearTimeout(this.timers.get(roomId));
    this.timers.delete(roomId);
    const room = await this.PartyRoom.findById(roomId).lean();
    if (room?.state !== "party_running" ||
        room.currentParty?.id !== partyId ||
        room.currentParty.currentGameIndex !== gameIndex ||
        !room.currentParty.roundFinishAt) return;
    if (new Date(room.currentParty.roundFinishAt) > this.now()) {
      this.scheduleRoundFinish(room);
      return;
    }
    await this.finishCurrentGame(room);
  }

  scheduleRoundFinishRetry(roomId, partyId, gameIndex) {
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      void this.PartyRoom.findById(roomId).lean().then(room => {
        if (room?.state === "party_running" &&
            room.currentParty?.id === partyId &&
            room.currentParty.currentGameIndex === gameIndex &&
            room.currentParty.roundFinishAt) {
          this.scheduleRoundFinish(room);
        }
      }).catch(error => {
        console.error(`Não foi possível reagendar o fim da rodada na sala ${roomId}:`, error);
        this.scheduleRoundFinishRetry(roomId, partyId, gameIndex);
      });
    }, 3_000);
    timer.unref?.();
    this.timers.set(roomId, timer);
  }

  async recoverActiveParties() {
    const rooms = await this.PartyRoom.find({
      state: { $in: ["party_running", "showing_game_results", "showing_final_results"] }
    }).limit(100).lean();
    for (const room of rooms) {
      await this.persistSession(room);
      if (room.state === "showing_game_results" && room.currentParty?.phaseEndsAt) this.schedule(room);
      else if (room.state === "party_running" && room.currentParty?.roundFinishAt) this.scheduleRoundFinish(room);
      else if (room.state === "party_running") {
        const game = room.currentParty?.selectedGames?.[room.currentParty.currentGameIndex];
        if (!game || !this.gameManager.has(game.id)) {
          await this.finishUnsupportedRecoveredGame(room, game);
          continue;
        }
        this.scheduleGameAction(room);
      }
    }
  }

  async finishUnsupportedRecoveredGame(room, game) {
    const party = room.currentParty;
    const gameId = game?.id || "(desconhecido)";
    console.warn(
      `A Party ${party?.id || room._id} da sala ${room._id} estava em um jogo não registrado (${gameId}); encerrando no ranking atual.`
    );
    const finishedAt = this.now();
    const updated = await this.PartyRoom.findOneAndUpdate({
      _id: room._id,
      state: "party_running",
      "currentParty.id": party.id,
      "currentParty.currentGameIndex": party.currentGameIndex
    }, {
      $set: {
        state: "showing_final_results",
        "currentParty.status": "showing_final_results",
        "currentParty.roundFinishAt": null,
        "currentParty.phaseEndsAt": null,
        "currentParty.finishedAt": finishedAt
      }
    }, { returnDocument: "after", runValidators: true });
    if (!updated) return;

    await this.persistSession(updated);
    const currentRoom = await this.service.get(room._id);
    const rankings = rankedScores(
      currentRoom.currentParty.scores,
      new Map(currentRoom.currentParty.scores.map(score => [
        serializeId(score.userId),
        score.totalPoints
      ]))
    );
    this.broadcast("party:game-error", currentRoom, {
      message: `O jogo "${gameId}" não está mais disponível. A Party foi encerrada com a pontuação atual.`
    });
    this.broadcast("party:final-results", currentRoom, { rankings });
  }

  async startCurrentGame(room) {
    const party = room.currentParty;
    const game = party.selectedGames[party.currentGameIndex];
    const initialState = await this.gameManager.get(game.id).start({
      room,
      party,
      game,
      participants: room.participants.filter(participant =>
        !(party.leftUserIds || []).includes(serializeId(participant.userId))
      ),
      now: this.now
    });
    if (initialState === undefined) return room;
    return this.persistGameState(room, initialState);
  }

  async getClientState(room, userId) {
    if (room.state !== "party_running" || !room.currentParty) return null;
    const party = room.currentParty.toObject
      ? room.currentParty.toObject()
      : room.currentParty;
    if (userId && (party.leftUserIds || []).includes(serializeId(userId))) return null;
    const game = party.selectedGames[party.currentGameIndex];
    if (!game) return null;
    const participants = room.participants.filter(participant =>
      !(party.leftUserIds || []).includes(serializeId(participant.userId))
    );
    const clientState = await this.gameManager.get(game.id).getClientState({
      room,
      party,
      game,
      participants,
      userId,
      state: party.gameState
    });
    if (clientState === undefined) return null;
    let serializedState;
    try {
      serializedState = JSON.stringify(clientState);
    } catch {
      throw new PartyRoomError("O jogo retornou um estado de tela inválido.", 500);
    }
    const maxStateSize = game.id === "gartic" ? MAX_GARTIC_STATE_SIZE : MAX_GAME_STATE_SIZE;
    if (typeof serializedState !== "string" || serializedState.length > maxStateSize) {
      throw new PartyRoomError("O estado de tela excedeu o limite permitido.", 500);
    }
    return clientState;
  }

  async persistGameState(room, gameState) {
    if (gameState === undefined) throw new PartyRoomError("O jogo não retornou um estado persistível.", 500);
    let serializedState;
    try {
      serializedState = JSON.stringify(gameState);
    } catch {
      throw new PartyRoomError("O estado do jogo não pode ser persistido.", 500);
    }
    const game = room.currentParty.selectedGames[room.currentParty.currentGameIndex];
    const maxStateSize = game?.id === "gartic" ? MAX_GARTIC_STATE_SIZE : MAX_GAME_STATE_SIZE;
    if (serializedState.length > maxStateSize) {
      throw new PartyRoomError("O estado do jogo excedeu o limite permitido.", 413);
    }
    const currentVersion = room.currentParty.gameStateVersion || 0;
    const updated = await this.PartyRoom.findOneAndUpdate({
      _id: room._id,
      state: "party_running",
      "currentParty.id": room.currentParty.id,
      "currentParty.currentGameIndex": room.currentParty.currentGameIndex,
      "currentParty.gameStateVersion": currentVersion
    }, {
      $set: {
        "currentParty.gameState": gameState,
        "currentParty.gameStateVersion": currentVersion + 1
      }
    }, { returnDocument: "after", runValidators: true });
    if (!updated) throw new PartyRoomError("A sala foi atualizada; tente novamente.", 409);
    return updated;
  }

  handleGameAction(roomId, userId, action, payload, options = {}) {
    if (!options.serializeActions && !Number.isSafeInteger(payload?.roundNumber)) {
      return this.processGameAction(roomId, userId, action, payload, options);
    }
    const key = serializeId(roomId);
    const previous = this.actionQueues.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(() =>
      this.processGameAction(roomId, userId, action, payload, options)
    );
    this.actionQueues.set(key, current);
    return current.finally(() => {
      if (this.actionQueues.get(key) === current) this.actionQueues.delete(key);
    });
  }

  async processGameAction(roomId, userId, action, payload, {
    serverAction = false,
    expectedVersion
  } = {}) {
    const room = await this.service.requireParticipant(roomId, userId);
    if (room.state !== "party_running" || !room.currentParty) {
      throw new PartyRoomError("Não há um jogo recebendo ações.", 409);
    }
    if (room.currentParty.roundFinishAt) {
      throw new PartyRoomError("A rodada está sendo finalizada.", 409);
    }
    if (typeof action !== "string" || !action.trim() || action.length > 80 ||
        !payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new PartyRoomError("Ação do jogo inválida.");
    }
    if (["timeout", "advance"].includes(action) && !serverAction) {
      throw new PartyRoomError("Ação reservada ao servidor.", 403);
    }
    let payloadSize;
    try {
      payloadSize = JSON.stringify(payload).length;
    } catch {
      throw new PartyRoomError("Ação do jogo inválida.");
    }
    if (payloadSize > 8_000) throw new PartyRoomError("A ação do jogo excedeu o limite permitido.", 413);

    const party = room.currentParty.toObject
      ? room.currentParty.toObject()
      : room.currentParty;
    if ((party.leftUserIds || []).includes(serializeId(userId))) {
      throw new PartyRoomError("Você já abandonou esta Party.", 403);
    }
    if (expectedVersion !== undefined &&
        (party.gameStateVersion || 0) !== expectedVersion) {
      throw new PartyRoomError("A rodada já foi atualizada.", 409);
    }
    const game = party.selectedGames[party.currentGameIndex];
    if (!game) throw new PartyRoomError("O jogo atual da Party não foi encontrado.", 409);
    const participant = room.participants.find(person => serializeId(person.userId) === serializeId(userId));
    const module = this.gameManager.get(game.id);
    const result = await module.handleAction({
      room,
      party,
      game,
      participant,
      participants: room.participants,
      state: party.gameState,
      serverAction,
      now: this.now
    }, { action: action.trim(), payload });
    if (!result || typeof result !== "object" || Array.isArray(result) || !Object.hasOwn(result, "state")) {
      throw new PartyRoomError("O jogo retornou uma atualização inválida.", 500);
    }
    const updated = await this.persistGameState(room, result.state);
    await this.persistSession(updated);
    const currentRoom = await this.service.get(roomId);
    const updatePayload = Object.hasOwn(result, "update") ? result.update : null;
    let updateSize;
    try {
      updateSize = JSON.stringify(updatePayload).length;
    } catch {
      throw new PartyRoomError("O jogo retornou uma atualização inválida.", 500);
    }
    if (updateSize > 8_000) throw new PartyRoomError("A atualização do jogo excedeu o limite permitido.", 500);
    this.publish("party:game-update", room.id, { room: currentRoom, update: updatePayload });
    if (game.id !== "gartic" || result.privateStateChanged) {
      await this.publishPrivateGameStates(updated);
    }
    if (result.finished === true) {
      const finishingRoom = await this.beginGameFinish(updated);
      return { room: finishingRoom, update: updatePayload, finished: true };
    }
    this.scheduleGameAction(updated);
    return { room: currentRoom, update: updatePayload };
  }

  scheduleGameAction(room) {
    if (room.state !== "party_running" || !room.currentParty) return;
    if (room.currentParty.roundFinishAt) {
      this.scheduleRoundFinish(room);
      return;
    }
    const party = room.currentParty.toObject
      ? room.currentParty.toObject()
      : room.currentParty;
    const game = party.selectedGames[party.currentGameIndex];
    if (!game) return;
    const module = this.gameManager.get(game.id);
    if (typeof module.getScheduledAction !== "function") return;
    const scheduled = module.getScheduledAction({ room, party, game, state: party.gameState });
    const roomId = serializeId(room._id);
    clearTimeout(this.timers.get(roomId));
    this.timers.delete(roomId);
    if (!scheduled || !scheduled.action || !scheduled.at) return;

    const expectedVersion = party.gameStateVersion || 0;
    const expectedPartyId = party.id;
    const expectedGameIndex = party.currentGameIndex;
    const delay = Math.max(0, Math.min(
      new Date(scheduled.at).getTime() - this.now().getTime(),
      2_147_000_000
    ));
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      void this.runScheduledGameAction(
        roomId,
        expectedPartyId,
        expectedGameIndex,
        expectedVersion,
        scheduled.action
      ).catch(error => {
        if (error.status === 409) return;
        console.error(`Não foi possível executar a ação programada do jogo na sala ${roomId}:`, error);
        this.scheduleGameActionRetry(roomId, expectedPartyId, expectedGameIndex);
      });
    }, delay);
    timer.unref?.();
    this.timers.set(roomId, timer);
  }

  async runScheduledGameAction(roomId, partyId, gameIndex, expectedVersion, action) {
    const room = await this.PartyRoom.findById(roomId).lean();
    if (room?.state !== "party_running" ||
        room.currentParty?.id !== partyId ||
        room.currentParty.currentGameIndex !== gameIndex ||
        (room.currentParty.gameStateVersion || 0) !== expectedVersion) return;
    const game = room.currentParty.selectedGames[gameIndex];
    const module = this.gameManager.get(game.id);
    const scheduled = module.getScheduledAction({
      room,
      party: room.currentParty,
      game,
      state: room.currentParty.gameState
    });
    if (!scheduled || scheduled.action !== action ||
        new Date(scheduled.at).getTime() > this.now().getTime()) {
      this.scheduleGameAction(room);
      return;
    }

    const withdrawn = new Set(room.currentParty.leftUserIds || []);
    const matchPlayers = room.currentParty.gameState?.currentMatch?.players || [];
    const playerId = matchPlayers.find(id => !withdrawn.has(serializeId(id))) ||
      room.participants.find(participant =>
        !withdrawn.has(serializeId(participant.userId))
      )?.userId;
    if (!playerId) return;
    await this.handleGameAction(roomId, playerId, action, {}, {
      serverAction: true,
      expectedVersion,
      serializeActions: game.id === "gartic"
    });
  }

  scheduleGameActionRetry(roomId, partyId, gameIndex) {
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      void this.PartyRoom.findById(roomId).lean().then(room => {
        if (room?.currentParty?.id === partyId &&
            room.currentParty.currentGameIndex === gameIndex) {
          this.scheduleGameAction(room);
        }
      }).catch(error => {
        console.error(`Não foi possível reagendar o jogo da sala ${roomId}:`, error);
        this.scheduleGameActionRetry(roomId, partyId, gameIndex);
      });
    }, 3_000);
    timer.unref?.();
    this.timers.set(roomId, timer);
  }

  async publishPrivateGameStates(room) {
    if (room.state !== "party_running" || !room.currentParty) return;
    for (const participant of room.participants) {
      const gameState = await this.getClientState(room, participant.userId);
      if (gameState !== null) {
        this.publishPrivate("party:game-private-state", serializeId(participant.userId), {
          roomId: serializeId(room._id),
          gameId: room.currentParty.selectedGames[room.currentParty.currentGameIndex]?.id,
          gameState
        });
      }
    }
  }

  schedule(room) {
    const roomId = serializeId(room._id);
    clearTimeout(this.timers.get(roomId));
    if (room.state === "showing_final_results") {
      this.timers.delete(roomId);
      return;
    }
    const endsAt = room.currentParty?.phaseEndsAt
      ? new Date(room.currentParty.phaseEndsAt).getTime()
      : Date.now();
    const delay = Math.max(0, Math.min(endsAt - Date.now(), 2_147_000_000));
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      void this.advance(roomId).catch(error => {
        console.error(`Não foi possível avançar a Party da sala ${roomId}:`, error);
        this.scheduleRetry(roomId);
      });
    }, delay);
    timer.unref?.();
    this.timers.set(roomId, timer);
  }

  scheduleRetry(roomId) {
    clearTimeout(this.timers.get(roomId));
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      void this.advance(roomId).catch(error => {
        console.error(`Falha ao tentar novamente avançar a Party da sala ${roomId}:`, error);
        this.scheduleRetry(roomId);
      });
    }, 3_000);
    timer.unref?.();
    this.timers.set(roomId, timer);
  }

  async advance(roomId) {
    const room = await this.PartyRoom.findById(roomId).lean();
    if (!room?.currentParty || !["showing_game_results", "showing_final_results"].includes(room.state)) return;
    if (room.state === "showing_final_results") return;
    if (room.currentParty.phaseEndsAt && new Date(room.currentParty.phaseEndsAt) > this.now()) {
      this.schedule(room);
      return;
    }

    const party = room.currentParty;
    if (room.state === "showing_game_results" && party.currentGameIndex + 1 < party.selectedGames.length) {
      const nextIndex = party.currentGameIndex + 1;
      const startedAt = this.now();
      const updated = await this.PartyRoom.findOneAndUpdate({
        _id: room._id,
        state: "showing_game_results",
        "currentParty.id": party.id,
        "currentParty.currentGameIndex": party.currentGameIndex,
        "currentParty.gameStateVersion": party.gameStateVersion || 0,
        "currentParty.phaseEndsAt": { $lte: startedAt }
      }, {
        $set: {
          state: "party_running",
          "currentParty.status": "party_running",
          "currentParty.currentGameIndex": nextIndex,
          "currentParty.currentGameStartedAt": startedAt,
          "currentParty.phaseEndsAt": null,
          "currentParty.gameState": null,
          "currentParty.gameStateVersion": 0
        }
      }, { returnDocument: "after", runValidators: true });
      if (!updated) return;
      let startedRoom = updated;
      try {
        startedRoom = await this.startCurrentGame(updated);
      } catch (error) {
        const failedGameRoom = await this.PartyRoom.findOneAndUpdate({
          _id: updated._id,
          state: "party_running",
          "currentParty.id": party.id,
          "currentParty.currentGameIndex": nextIndex
        }, {
          $set: {
            state: "showing_final_results",
            "currentParty.status": "showing_final_results",
            "currentParty.phaseEndsAt": null
          }
        }, { returnDocument: "after", runValidators: true });
        if (!failedGameRoom) throw error;
        await this.persistSession(failedGameRoom);
        const failedRoom = await this.service.get(roomId);
        const finalRankings = rankedScores(
          failedRoom.currentParty.scores,
          new Map(failedRoom.currentParty.scores.map(score => [
            serializeId(score.userId),
            score.totalPoints
          ]))
        );
        this.broadcast("party:game-error", failedRoom, {
          message: "Não foi possível iniciar o próximo jogo."
        });
        this.broadcast("party:final-results", failedRoom, {
          rankings: finalRankings
        });
        return;
      }
      await this.persistSession(startedRoom);
      const currentRoom = await this.service.get(roomId);
      const game = currentRoom.currentParty.selectedGames[nextIndex];
      const clientState = await this.getClientState(startedRoom);
      this.broadcast("party:next-game", currentRoom, { game, gameState: clientState });
      this.broadcast("party:game-start", currentRoom, { game, gameState: clientState });
      await this.publishPrivateGameStates(startedRoom);
      this.scheduleGameAction(startedRoom);
      return;
    }

    if (room.state === "showing_game_results") {
      const finalAt = this.now();
      const updated = await this.PartyRoom.findOneAndUpdate({
        _id: room._id,
        state: "showing_game_results",
        "currentParty.id": party.id,
        "currentParty.phaseEndsAt": { $lte: finalAt }
      }, {
        $set: {
          state: "showing_final_results",
          "currentParty.status": "showing_final_results",
          "currentParty.phaseEndsAt": null
        }
      }, { returnDocument: "after", runValidators: true });
      if (!updated) return;
      await this.persistSession(updated);
      const currentRoom = await this.service.get(roomId);
      const rankings = rankedScores(
        currentRoom.currentParty.scores,
        new Map(currentRoom.currentParty.scores.map(score => [
          serializeId(score.userId),
          score.totalPoints
        ]))
      );
      this.broadcast("party:final-results", currentRoom, { rankings });
      return;
    }
  }

  async persistSession(room, status = room.state, finishedAt = null) {
    const party = room.currentParty?.toObject
      ? room.currentParty.toObject()
      : room.currentParty;
    if (!party) return true;
    try {
      await this.PartySession.updateOne({ sessionId: party.id }, {
        $set: {
          sessionId: party.id,
          roomId: room._id,
          status,
          currentGameIndex: party.currentGameIndex,
          gameStateVersion: party.gameStateVersion || 0,
          roundFinishAt: party.roundFinishAt,
          selectedGames: party.selectedGames,
          gameResults: party.gameResults,
          scores: party.scores,
          startedAt: party.startedAt,
          currentGameStartedAt: party.currentGameStartedAt,
          phaseEndsAt: status === "ended" ? null : party.phaseEndsAt,
          finishedAt
        }
      }, { upsert: true, runValidators: true });
      return true;
    } catch (error) {
      console.error(`Não foi possível sincronizar a sessão da Party ${party.id}:`, error);
      return false;
    }
  }

  broadcast(event, room, extra = {}) {
    const payload = { room, ...extra };
    this.publish(event, room.id, payload);
    if (["party:start", "party:round-ending", "party:game-finish", "party:next-game", "party:final-results", "party:player-left", "party:end"].includes(event)) {
      if (event !== "party:end") this.publish("room:update", room.id, room);
      if (event === "party:start" || event === "party:end") {
        this.publish("room:directory", null, { action: "updated", room });
      }
    }
  }

  close() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

export const PARTY_TIMINGS = Object.freeze({
  roundFinishDelayMs: ROUND_FINISH_DELAY_MS,
  gameResultsMs: GAME_RESULTS_DURATION_MS,
  finalResultsMs: 0
});
