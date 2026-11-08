import test from "node:test";
import assert from "node:assert/strict";
import { PartyEngine, PARTY_TIMINGS } from "../services/partyEngine.js";
import { GameManager, GameModule, createDefaultGameManager } from "../services/gameManager.js";
import { PartyRoom } from "../models/PartyRoom.js";
import { PartySession } from "../models/PartySession.js";
import { createPartyRoomService } from "../services/partyRoomService.js";
import {
  RockPaperScissorsGameModule,
  ROCK_PAPER_SCISSORS_TIMINGS
} from "../services/rockPaperScissorsGame.js";
import { GarticGameModule, GARTIC_TIMINGS } from "../services/garticGame.js";
import { simulateBasketballShot } from "../services/basketballGame.js";

const clone = value => structuredClone(value);

test("Party room service exposes the host authorization used by PartyEngine", async () => {
  const hostId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const room = {
    _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    hostId,
    state: "waiting",
    status: "waiting",
    participants: [
      { userId: hostId },
      { userId: "cccccccccccccccccccccccc" }
    ]
  };
  const service = createPartyRoomService({
    User: {},
    PartyRoomModel: { findById: async () => room }
  });

  assert.equal((await service.requireHost(String(room._id), hostId)), room);
  await assert.rejects(service.requireHost(String(room._id), "cccccccccccccccccccccccc"), /Somente o host/);
});

test("Party room service persists and returns structured final rankings", async () => {
  const roomId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const hostId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const playerId = "cccccccccccccccccccccccc";
  const room = {
    _id: roomId,
    state: "showing_final_results",
    participants: [
      { userId: hostId, username: "Host" },
      { userId: playerId, username: "Jogador" }
    ]
  };
  const storedMessages = [];
  const service = createPartyRoomService({
    User: {},
    PartyRoomModel: { findById: async () => room },
    PartyRoomMessageModel: {
      async create(message) {
        const saved = { ...message, _id: `message-${storedMessages.length + 1}`, createdAt: new Date() };
        storedMessages.push(saved);
        return saved;
      },
      find() {
        return {
          sort() { return this; },
          limit() { return this; },
          lean: async () => storedMessages
        };
      }
    }
  });
  const ranking = [
    { userId: hostId, username: "Host", points: 20, position: 1 },
    { userId: playerId, username: "Jogador", points: 10, position: 2 }
  ];

  const created = await service.partyResultMessage(roomId, hostId, ranking);
  assert.equal(created.type, "party-result");
  assert.equal(created.senderName, "Orby Party");
  assert.equal(created.text, "A Party foi encerrada.");
  assert.deepEqual(created.ranking, ranking);
  assert.deepEqual((await service.messages(roomId, playerId))[0].ranking, ranking);
  await assert.rejects(
    service.partyResultMessage(roomId, hostId, [
      ...ranking.slice(0, 1),
      { userId: "dddddddddddddddddddddddd", username: "Outro", points: 0, position: 2 }
    ]),
    /ranking final.*inválido/i
  );
});

test("Party room list includes joinable final-result rooms for anyone", async () => {
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const activeRoom = {
    _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    hostId: userId,
    name: "Sala ativa",
    state: "showing_final_results",
    participants: [{ userId, username: "Host" }]
  };
  let filter;
  const query = {
    sort() { return this; },
    async limit() { return [activeRoom]; }
  };
  const service = createPartyRoomService({
    User: {},
    PartyRoomModel: {
      find(value) {
        filter = value;
        return query;
      }
    }
  });

  const rooms = await service.list(userId);
  assert.equal(rooms[0].id, activeRoom._id);
  assert.ok(filter.$or[0].$or.some(state => state.state === "showing_final_results"));
  assert.deepEqual(filter.$or[1], {
    state: { $in: ["party_running", "showing_game_results", "showing_final_results"] },
    "participants.userId": userId
  });
});

test("Leaving final results lets a player rejoin while the room remains", async () => {
  const hostId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const userId = "cccccccccccccccccccccccc";
  const roomId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const room = {
    _id: roomId,
    hostId,
    name: "Sala final",
    state: "showing_final_results",
    status: "started",
    maxUsers: 8,
    participants: [{ userId: hostId, username: "Host" }]
  };
  const service = createPartyRoomService({
    User: {
      findById: () => ({ select: async () => ({ _id: userId, nome: "Jogador" }) })
    },
    PartyRoomModel: {
      async find() { return []; },
      async findOneAndUpdate(filter, update) {
        if (filter.participants?.$size === 0) return null;
        if (!filter.$or.some(state => state.state === "showing_final_results")) return null;
        room.participants.push(update.$push.participants);
        return room;
      },
      async findById() { return room; }
    }
  });

  const result = await service.join(roomId, userId);

  assert.equal(result.joined, true);
  assert.equal(result.room.state, "showing_final_results");
  assert.ok(room.participants.some(participant => String(participant.userId) === userId));
});

test("Party room join distinguishes new members from repeated and concurrent joins", async () => {
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const hostId = "cccccccccccccccccccccccc";
  const roomId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const createService = ({ alreadyJoined = false, concurrentJoin = false } = {}) => {
    const room = {
      _id: roomId,
      name: "Sala",
      hostId,
      state: "waiting",
      status: "waiting",
      maxUsers: 8,
      participants: [{ userId: hostId, username: "Host" }],
      partyConfig: { games: [] }
    };
    if (alreadyJoined) room.participants.push({ userId, username: "Jogador" });
    const User = {
      findById: () => ({
        select: async () => ({ _id: userId, nome: "Jogador" })
      })
    };
    const PartyRoomModel = {
      find: async () => room.participants.some(person => String(person.userId) === userId) ? [room] : [],
      findOne: async () => room.participants.some(person => String(person.userId) === userId) ? room : null,
      findById: async () => room,
      async findOneAndUpdate(filter, update) {
        if (filter.participants?.$size === 0) return null;
        if (concurrentJoin) {
          room.participants.push({ userId, username: "Jogador" });
          return null;
        }
        room.participants.push(update.$push.participants);
        return room;
      }
    };
    return createPartyRoomService({ User, PartyRoomModel });
  };

  const existing = await createService({ alreadyJoined: true }).join(roomId, userId);
  assert.equal(existing.joined, false);

  const newlyJoined = await createService().join(roomId, userId);
  assert.equal(newlyJoined.joined, true);

  const racedJoin = await createService({ concurrentJoin: true }).join(roomId, userId);
  assert.equal(racedJoin.joined, false);
});

test("Joining another waiting room leaves the previous room and transfers its host", async () => {
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const guestId = "cccccccccccccccccccccccc";
  const previousRoom = {
    _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    hostId: userId,
    state: "waiting",
    status: "waiting",
    participants: [
      { userId, username: "Host" },
      { userId: guestId, username: "Guest" }
    ]
  };
  const targetRoom = {
    _id: "dddddddddddddddddddddddd",
    hostId: guestId,
    state: "waiting",
    status: "waiting",
    maxUsers: 8,
    participants: [{ userId: guestId, username: "Guest" }]
  };
  const rooms = [previousRoom, targetRoom];
  const service = createPartyRoomService({
    User: {
      findById: () => ({ select: async () => ({ _id: userId, nome: "Host" }) })
    },
    PartyRoomModel: {
      find: async () => rooms.filter(room =>
        room.participants.some(participant => String(participant.userId) === userId)
      ),
      async findOneAndUpdate(filter, update) {
        const room = rooms.find(candidate => String(candidate._id) === String(filter._id));
        if (!room) return null;
        if (update.$push) {
          room.participants.push(update.$push.participants);
        } else {
          Object.assign(room, update.$set);
        }
        return room;
      }
    }
  });

  const result = await service.join(targetRoom._id, userId);
  assert.equal(result.joined, true);
  assert.deepEqual(result.leftRooms.map(room => room.roomId), [previousRoom._id]);
  assert.deepEqual(previousRoom.participants.map(participant => participant.userId), [guestId]);
  assert.equal(previousRoom.hostId, guestId);
  assert.ok(targetRoom.participants.some(participant => participant.userId === userId));
});

test("Joining another room is blocked while the previous Party is running", async () => {
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const previousRoom = {
    _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    hostId: userId,
    state: "party_running",
    status: "started",
    participants: [{ userId, username: "Host" }]
  };
  const targetRoom = {
    _id: "dddddddddddddddddddddddd",
    hostId: "cccccccccccccccccccccccc",
    state: "waiting",
    status: "waiting",
    maxUsers: 8,
    participants: []
  };
  let targetJoinAttempted = false;
  const service = createPartyRoomService({
    User: {
      findById: () => ({ select: async () => ({ _id: userId, nome: "Host" }) })
    },
    PartyRoomModel: {
      find: async () => [previousRoom],
      async findOneAndUpdate() {
        targetJoinAttempted = true;
        return targetRoom;
      }
    }
  });

  await assert.rejects(service.join(targetRoom._id, userId), /Party em andamento/);
  assert.equal(targetJoinAttempted, false);
  assert.equal(previousRoom.participants.length, 1);
  assert.equal(targetRoom.participants.length, 0);
});

test("Creating a room leaves the previous waiting room", async () => {
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const previousRoom = {
    _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    hostId: userId,
    state: "waiting",
    status: "waiting",
    participants: [{ userId, username: "Host" }]
  };
  let roomDeleted = false;
  const service = createPartyRoomService({
    User: {
      findById: () => ({ select: async () => ({ _id: userId, nome: "Host" }) })
    },
    PartyRoomModel: {
      find: async () => [previousRoom],
      async create(data) {
        return { ...data, _id: "dddddddddddddddddddddddd" };
      },
      async deleteOne() {
        roomDeleted = true;
        return { deletedCount: 1 };
      }
    },
    PartyRoomMessageModel: {
      async deleteMany() {}
    }
  });

  const result = await service.create(userId, "Nova sala");
  assert.equal(result.room.id, "dddddddddddddddddddddddd");
  assert.equal(result.leftRooms[0].deleted, true);
  assert.equal(roomDeleted, true);
});

test("Party room image messages only persist Cloudinary assets for their sender and room", async () => {
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const roomId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const publicId = `orby/${userId}/party-chat/${roomId}/123e4567-e89b-12d3-a456-426614174000`;
  const room = {
    _id: roomId,
    state: "waiting",
    status: "waiting",
    participants: [{ userId, username: "Jogador" }]
  };
  const previousCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  process.env.CLOUDINARY_CLOUD_NAME = "orby-test";
  const service = createPartyRoomService({
    User: {},
    PartyRoomModel: { findById: async () => room },
    PartyRoomMessageModel: {
      async create(message) {
        return { ...message, _id: "cccccccccccccccccccccccc", createdAt: new Date() };
      }
    }
  });

  try {
    const message = await service.imageMessage(roomId, userId, publicId);
    assert.equal(message.type, "image");
    assert.equal(message.imageUrl, `https://res.cloudinary.com/orby-test/image/upload/f_auto,q_auto/${publicId}`);
    await assert.rejects(
      service.imageMessage(roomId, userId, `orby/cccccccccccccccccccccccc/party-chat/${roomId}/123e4567-e89b-12d3-a456-426614174000`),
      /não pertence/
    );
    await assert.rejects(
      service.imageMessage(roomId, userId, `orby/${userId}/party-chat/cccccccccccccccccccccccc/123e4567-e89b-12d3-a456-426614174000`),
      /não pertence/
    );
  } finally {
    if (previousCloudName === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = previousCloudName;
  }
});

test("Party room creation accepts an optional owned Cloudinary cover", async () => {
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const publicId = `orby/${userId}/party-room-covers/123e4567-e89b-12d3-a456-426614174000`;
  const previousCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  process.env.CLOUDINARY_CLOUD_NAME = "orby-test";
  let created;
  const service = createPartyRoomService({
    User: {
      findById: () => ({ select: async () => ({ _id: userId, nome: "Host" }) })
    },
    PartyRoomModel: {
      find: async () => [],
      async create(data) {
        created = { ...data, _id: "bbbbbbbbbbbbbbbbbbbbbbbb" };
        return created;
      }
    }
  });

  try {
    const { room } = await service.create(userId, "Noite de jogos", publicId, "🎲");
    assert.equal(created.coverPublicId, publicId);
    assert.equal(created.roomIcon, "🎲");
    assert.deepEqual(created.partyConfig.games, [
      { id: "uno", name: "UNO", enabled: true },
      { id: "rock-paper-scissors", name: "Pedra, Papel e Tesoura", enabled: false },
      { id: "gartic", name: "Rabisco", enabled: false },
      { id: "basketball", name: "Cesta Certa", enabled: false }
    ]);
    assert.equal(room.roomIcon, "🎲");
    assert.equal(room.imageUrl, `https://res.cloudinary.com/orby-test/image/upload/c_fill,w_256,h_256,g_auto,f_auto,q_auto/${publicId}`);
    await assert.rejects(service.create(userId, "Ícone inválido", "", "não-é-um-ícone"), /ícone válido/);
    await assert.rejects(
      service.create(userId, "Sala inválida", `orby/bbbbbbbbbbbbbbbbbbbbbbbb/party-room-covers/123e4567-e89b-12d3-a456-426614174000`),
      /não pertence/
    );
    const { room: roomWithoutCover } = await service.create(userId, "Sem foto", "");
    assert.equal(roomWithoutCover.imageUrl, "");
  } finally {
    if (previousCloudName === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = previousCloudName;
  }
});

test("Party host can rename a room and change or remove its cover", async () => {
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const publicId = `orby/${userId}/party-room-covers/123e4567-e89b-12d3-a456-426614174000`;
  const room = {
    _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    name: "Sala antiga",
    coverPublicId: "",
    hostId: userId,
    state: "waiting",
    status: "waiting",
    participants: [{ userId, username: "Host" }],
    partyConfig: { name: "Party", games: [] },
    async save() {}
  };
  const previousCloudName = process.env.CLOUDINARY_CLOUD_NAME;
  process.env.CLOUDINARY_CLOUD_NAME = "orby-test";
  const service = createPartyRoomService({
    User: {},
    PartyRoomModel: {
      findById: async () => room,
      async findOneAndUpdate(_filter, update) {
        Object.assign(room, update.$set);
        return room;
      }
    }
  });

  try {
    const updated = await service.updateParty(room._id, userId, {
      name: "Party",
      roomName: "Sala nova",
      roomIcon: "🚀",
      coverPublicId: publicId,
      rounds: 0,
      games: []
    });
    assert.equal(updated.name, "Sala nova");
    assert.equal(updated.roomIcon, "🚀");
    await assert.rejects(service.updateParty(room._id, userId, {
      name: "Party",
      roomName: "Sala nova",
      roomIcon: "ícone inválido",
      rounds: 0,
      games: []
    }), /Configuração da Party inválida/);
    assert.ok(updated.imageUrl.includes(publicId));

    const cleared = await service.updateParty(room._id, userId, {
      name: "Party",
      roomName: "Sala nova",
      coverPublicId: "",
      rounds: 0,
      games: []
    });
    assert.equal(cleared.imageUrl, "");
  } finally {
    if (previousCloudName === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = previousCloudName;
  }
});

test("Party host can configure the next party while others are still viewing final results", async () => {
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const room = {
    _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    name: "Sala antiga",
    hostId: userId,
    state: "showing_final_results",
    status: "started",
    participants: [{ userId, username: "Host" }],
    partyConfig: { name: "Party antiga", rounds: 0, games: [] },
    currentParty: { id: "party-1", leftUserIds: [userId] }
  };
  let updateFilter;
  const service = createPartyRoomService({
    User: {},
    PartyRoomModel: {
      findById: async () => room,
      async findOneAndUpdate(filter, update) {
        updateFilter = filter;
        Object.assign(room, update.$set);
        return room;
      }
    }
  });

  const updated = await service.updateParty(room._id, userId, {
    name: "Próxima Party",
    roomName: "Sala nova",
    rounds: 0,
    games: [{ id: "uno", name: "UNO", enabled: true }]
  });

  assert.equal(updateFilter.$or.some(state => state.state === "showing_final_results"), true);
  assert.equal(updated.state, "showing_final_results");
  assert.equal(updated.name, "Sala nova");
  assert.equal(updated.partyConfig.name, "Próxima Party");
  assert.equal(updated.partyConfig.games[0].enabled, true);
});

test("Party room invites persist notifications only for eligible recipients", async () => {
  const senderId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const recipientId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const roomId = "cccccccccccccccccccccccc";
  const room = {
    _id: roomId,
    name: "Noite de jogos",
    hostId: senderId,
    state: "waiting",
    status: "waiting",
    maxUsers: 8,
    participants: [{ userId: senderId, username: "Host" }]
  };
  const recipient = {
    _id: recipientId,
    notificacoes: [],
    async save() {
      for (const notification of this.notificacoes) {
        notification.expiraEm = new Date(notification.expiraEm);
      }
    }
  };
  const service = createPartyRoomService({
    User: { findById: async () => recipient },
    PartyRoomModel: {
      findById: async () => room,
      findOne: async () => null
    }
  });

  const result = await service.invite(roomId, senderId, recipientId);
  assert.equal(result.recipientId, recipientId);
  assert.equal(result.notification.tipo, "orby_party_convite");
  assert.equal(result.notification.partyRoomId, roomId);
  assert.equal(recipient.notificacoes.length, 1);
  await assert.rejects(service.invite(roomId, senderId, recipientId), /convite pendente/);
  await assert.rejects(service.invite(roomId, recipientId, senderId), /Entre na sala/);

  room.state = "party_running";
  await assert.rejects(service.invite(roomId, senderId, "dddddddddddddddddddddddd"), /aguardando jogadores/);
});

test("Party room removes retired games including Acerta Tempo from saved selections", async () => {
  const room = {
    _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    name: "Sala antiga",
    hostId: "aaaaaaaaaaaaaaaaaaaaaaaa",
    state: "waiting",
    status: "waiting",
    participants: [],
    maxUsers: 8,
    partyConfig: {
      name: "Party antiga",
      games: [
        { id: "trivia", name: "Trivia", enabled: true },
        { id: "guess-the-number", name: "Acerta Tempo", enabled: true }
      ]
    },
    async save() {}
  };
  const service = createPartyRoomService({
    User: {},
    PartyRoomModel: { findById: async () => room }
  });

  const migrated = await service.get(String(room._id));
  assert.deepEqual(migrated.partyConfig.games, [
    { id: "uno", name: "UNO", enabled: true },
    { id: "rock-paper-scissors", name: "Pedra, Papel e Tesoura", enabled: false },
    { id: "gartic", name: "Rabisco", enabled: false },
    { id: "basketball", name: "Cesta Certa", enabled: false }
  ]);
  assert.deepEqual(room.partyConfig.games, migrated.partyConfig.games);
});

test("Party room prevents leaving while the game is active", async () => {
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const room = {
    _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    hostId: userId,
    state: "party_running",
    status: "started",
    participants: [{ userId, username: "Host" }],
    partyConfig: { games: [{ id: "uno", name: "UNO", enabled: true }] }
  };
  const service = createPartyRoomService({
    User: {},
    PartyRoomModel: { findById: async () => room }
  });

  await assert.rejects(service.leave(String(room._id), userId), /Party terminar/);
  assert.equal(room.participants.length, 1);
});

test("Party room stays open at final results until every participant leaves", async () => {
  const hostId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const guestId = "cccccccccccccccccccccccc";
  const room = {
    _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    hostId,
    state: "showing_final_results",
    status: "started",
    participants: [
      { userId: hostId, username: "Host" },
      { userId: guestId, username: "Guest" }
    ]
  };
  let roomDeleted = false;
  let messagesDeleted = false;
  const service = createPartyRoomService({
    User: {},
    PartyRoomModel: {
      findById: async () => room,
      async findOneAndUpdate(_filter, update) {
        Object.assign(room, update.$set);
        return room;
      },
      async deleteOne() {
        roomDeleted = true;
      }
    },
    PartyRoomMessageModel: {
      async deleteMany() {
        messagesDeleted = true;
      }
    }
  });

  const firstLeave = await service.leave(String(room._id), hostId);
  assert.equal(firstLeave.deleted, false);
  assert.deepEqual(room.participants.map(participant => participant.userId), [guestId]);
  assert.equal(room.hostId, guestId);
  assert.equal(roomDeleted, false);

  const lastLeave = await service.leave(String(room._id), guestId);
  assert.equal(lastLeave.deleted, true);
  assert.equal(roomDeleted, true);
  assert.equal(messagesDeleted, true);
});

function createHarness({ games = ["uno"], manager = createDefaultGameManager() } = {}) {
  const room = {
    _id: "room-1",
    id: "room-1",
    name: "Sala de teste",
    hostId: "host-1",
    state: "waiting",
    status: "waiting",
    partyConfig: {
      name: "Party de teste",
      games: games.map(id => ({ id, name: id, enabled: true }))
    },
    participants: [
      { userId: "host-1", username: "João" },
      { userId: "player-2", username: "Pedro" }
    ]
  };
  const archivedSessions = new Map();
  const events = [];
  const privateEvents = [];
  let now = new Date("2026-01-01T00:00:00.000Z");
  const matches = (filter, candidate) =>
    (!filter.state || candidate.state === filter.state) &&
    (!filter.hostId || candidate.hostId === filter.hostId) &&
    (!filter["currentParty.id"] || candidate.currentParty?.id === filter["currentParty.id"]) &&
    (filter["currentParty.currentGameIndex"] === undefined ||
      candidate.currentParty?.currentGameIndex === filter["currentParty.currentGameIndex"]) &&
    (filter["currentParty.gameStateVersion"] === undefined ||
      (candidate.currentParty?.gameStateVersion || 0) === filter["currentParty.gameStateVersion"]) &&
    (filter["currentParty.roundFinishAt"] === undefined ||
      (filter["currentParty.roundFinishAt"] === null
        ? candidate.currentParty?.roundFinishAt === null || candidate.currentParty?.roundFinishAt === undefined
        : candidate.currentParty?.roundFinishAt === filter["currentParty.roundFinishAt"])) &&
    (!filter["currentParty.phaseEndsAt"] ||
      new Date(candidate.currentParty?.phaseEndsAt) <= filter["currentParty.phaseEndsAt"].$lte);
  const setPath = (target, path, value) => {
    const keys = path.split(".");
    const last = keys.pop();
    const parent = keys.reduce((item, key) => item[key], target);
    parent[last] = clone(value);
  };
  const PartyRoom = {
    async findOneAndUpdate(filter, update) {
      if (!matches(filter, room)) return null;
      for (const [path, value] of Object.entries(update.$set || {})) {
        if (path.includes(".")) setPath(room, path, value);
        else room[path] = clone(value);
      }
      return clone(room);
    },
    findById() { return { lean: async () => clone(room) }; },
    async find() { return []; },
    async updateOne(filter, update) {
      if (matches(filter, room)) {
        for (const [path, value] of Object.entries(update.$set || {})) {
          if (path.includes(".")) setPath(room, path, value);
          else room[path] = clone(value);
        }
      }
    }
  };
  const PartySession = {
    async updateOne(filter, update) {
      archivedSessions.set(filter.sessionId, clone(update.$set));
    }
  };
  const service = {
    async requireHost(roomId, userId) {
      assert.equal(roomId, room.id);
      assert.equal(userId, room.hostId);
      return clone(room);
    },
    async requireParticipant(roomId, userId) {
      assert.equal(roomId, room.id);
      assert.ok(room.participants.some(person => person.userId === userId));
      return clone(room);
    },
    async get() {
      const snapshot = clone(room);
      if (snapshot.currentParty) delete snapshot.currentParty.gameState;
      return snapshot;
    },
    async partyResultMessage(roomId, userId, ranking, leftUserIds = room.currentParty?.leftUserIds || []) {
      assert.equal(roomId, room.id);
      assert.equal(userId, room.hostId);
      const withdrawn = new Set(leftUserIds);
      const activeParticipants = room.participants.filter(person => !withdrawn.has(person.userId));
      assert.equal(ranking.length, activeParticipants.length);
      assert.deepEqual(
        new Set(ranking.map(entry => entry.userId)),
        new Set(activeParticipants.map(person => person.userId))
      );
      return {
        id: "party-result-1",
        senderId: userId,
        senderName: "Orby Party",
        type: "party-result",
        text: "A Party foi encerrada.",
        ranking: clone(ranking),
        createdAt: now
      };
    }
  };
  const engine = new PartyEngine({
    PartyRoom,
    PartySession,
    service,
    gameManager: manager,
    publish: (event, roomId, payload) => events.push({ event, roomId, payload }),
    publishPrivate: (event, userId, payload) => privateEvents.push({ event, userId, payload }),
    now: () => new Date(now)
  });
  return {
    engine, room, archivedSessions, events, privateEvents,
    setNow(value) { now = new Date(value); },
    async finishPendingRound() {
      const party = room.currentParty;
      assert.ok(party?.roundFinishAt, "round finish should be scheduled");
      now = new Date(party.roundFinishAt);
      return engine.runScheduledRoundFinish(room.id, party.id, party.currentGameIndex);
    }
  };
}

test("GameManager rejects duplicate modules and exposes registered games", () => {
  assert.deepEqual(createDefaultGameManager().list(), [
    { id: "uno", name: "UNO" },
    { id: "rock-paper-scissors", name: "Pedra, Papel e Tesoura" },
    { id: "gartic", name: "Rabisco" },
    { id: "basketball", name: "Cesta Certa" }
  ]);
  const manager = new GameManager();
  const module = new GameModule({ id: "sample", name: "Sample" });
  manager.register(module);
  assert.equal(manager.get("sample"), module);
  assert.deepEqual(manager.list(), [{ id: "sample", name: "Sample" }]);
  assert.throws(() => manager.register(module), /já está registrado/);
});

test("Abandonar os jogos mantém o host na sala e no cargo", async t => {
  const harness = createHarness({ games: ["uno"] });
  t.after(() => harness.engine.close());
  harness.room.participants.push({ userId: "player-3", username: "Caio" });
  await harness.engine.start("room-1", "host-1");

  const room = await harness.engine.leaveGame("room-1", "host-1");

  assert.equal(room.state, "party_running");
  assert.equal(room.hostId, "host-1");
  assert.equal(room.participants.length, 3);
  assert.deepEqual(room.currentParty.leftUserIds, ["host-1"]);
  assert.deepEqual(room.currentParty.scores.map(score => score.userId), ["player-2", "player-3"]);
  await assert.rejects(
    harness.engine.handleGameAction("room-1", "host-1", "draw", {}),
    /abandonou esta Party/
  );
});

test("A última pessoa ativa vence quando o host abandona a partida", async t => {
  const harness = createHarness({ games: ["uno"] });
  t.after(() => harness.engine.close());
  await harness.engine.start("room-1", "host-1");

  const room = await harness.engine.leaveGame("room-1", "host-1");
  const finalResults = harness.events.find(event => event.event === "party:final-results");

  assert.equal(room.state, "showing_final_results");
  assert.equal(room.hostId, "host-1");
  assert.equal(room.participants.length, 2);
  assert.deepEqual(room.currentParty.scores.map(score => score.userId), ["player-2"]);
  assert.deepEqual(finalResults.payload.rankings.map(entry => entry.userId), ["player-2"]);
});

test("Host que abandona mantém o cargo e pode iniciar outra Party após o resultado final", async t => {
  const harness = createHarness({ games: ["uno"] });
  t.after(() => harness.engine.close());
  await harness.engine.start("room-1", "host-1");
  await harness.engine.leaveGame("room-1", "host-1");

  const lobby = await harness.engine.endNow("room-1", "host-1");
  assert.equal(lobby.state, "waiting");
  assert.equal(lobby.hostId, "host-1");
  assert.equal(lobby.participants.length, 2);

  const nextParty = await harness.engine.start("room-1", "host-1");
  assert.equal(nextParty.state, "party_running");
  assert.equal(nextParty.hostId, "host-1");
  assert.deepEqual(nextParty.currentParty.leftUserIds, []);
});

test("Rock Paper Scissors wins a best-of-three match as soon as a player wins twice", async () => {
  const game = new RockPaperScissorsGameModule();
  assert.deepEqual(ROCK_PAPER_SCISSORS_TIMINGS, {
    choiceMs: 10_000,
    resultAdvanceMs: 5_000
  });
  let time = new Date("2026-01-01T00:00:00.000Z");
  const now = () => new Date(time);
  const participants = [
    { userId: "player-1", username: "Ana" },
    { userId: "player-2", username: "Bia" }
  ];
  const state = await game.start({ participants, now });
  const choose = (userId, choice) => game.handleAction({
    participant: participants.find(person => person.userId === userId),
    state,
    now
  }, { action: "choose", payload: { choice } });
  const continueMatch = () => {
    time = new Date(state.currentMatch.resultAdvanceAt);
    return game.handleAction({
    participant: participants[0],
      state,
      now
    }, { action: "continue", payload: {} });
  };

  await choose("player-1", "rock");
  assert.equal(state.currentMatch.result, null);
  assert.equal(game.getClientState({ state, userId: "player-1" }).currentMatch.hasSelected, true);
  assert.equal(game.getClientState({ state, userId: "player-2" }).currentMatch.hasSelected, false);
  assert.equal(game.getClientState({ state, userId: "player-1" }).currentMatch.selectedChoice, "rock");
  assert.equal(game.getClientState({ state, userId: "player-2" }).currentMatch.selectedChoice, null);
  await choose("player-2", "scissors");
  assert.equal(state.currentMatch.result.winnerUserId, "player-1");
  await continueMatch();
  await choose("player-1", "paper");
  await choose("player-2", "rock");
  assert.equal(state.currentMatch.wins["player-1"], 2);
  assert.equal(state.currentMatch.winnerUserId, "player-1");
  await continueMatch();
  assert.equal(state.gameOver, true);
  assert.equal(state.championUserId, "player-1");
  assert.deepEqual(await game.calculateScores({ participants, state }), [
    { userId: "player-1", points: 20 },
    { userId: "player-2", points: 10 }
  ]);
});

test("Abandonar um confronto de Pedra, Papel e Tesoura avança o adversário", async () => {
  let time = new Date("2026-01-01T00:00:00.000Z");
  const game = new RockPaperScissorsGameModule();
  const participants = [
    { userId: "player-1", username: "Ana" },
    { userId: "player-2", username: "Bia" }
  ];
  const state = await game.start({ participants, now: () => new Date(time) });

  await game.handlePlayerLeave({
    state,
    userId: "player-1",
    now: () => new Date(time)
  });
  assert.equal(state.currentMatch.winnerUserId, "player-2");

  time = new Date(state.currentMatch.resultAdvanceAt);
  await game.handleAction({
    participant: participants[1],
    state,
    now: () => new Date(time),
    serverAction: true
  }, { action: "continue", payload: {} });

  assert.equal(state.gameOver, true);
  assert.equal(state.championUserId, "player-2");
});

test("Rock Paper Scissors awards podium points and ties semifinal placements", async () => {
  const game = new RockPaperScissorsGameModule();
  const participants = [
    { userId: "player-1", username: "Ana" },
    { userId: "player-2", username: "Bia" },
    { userId: "player-3", username: "Caio" },
    { userId: "player-4", username: "Duda" }
  ];
  const scores = await game.calculateScores({
    participants,
    state: {
      championUserId: "player-1",
      matchups: [["player-1", "player-2"]],
      players: [
        { userId: "player-1", matchWins: 2 },
        { userId: "player-2", matchWins: 1 },
        { userId: "player-3", matchWins: 1 },
        { userId: "player-4", matchWins: 1 }
      ]
    }
  });

  assert.deepEqual(scores, [
    { userId: "player-1", points: 20 },
    { userId: "player-2", points: 10 },
    { userId: "player-3", points: 5 },
    { userId: "player-4", points: 5 }
  ]);
});

test("Party Engine runs Cesta Certa for 90 seconds and ranks players by baskets", async t => {
  const harness = createHarness({ games: ["basketball"] });
  t.after(() => harness.engine.close());
  await harness.engine.start("room-1", "host-1");

  const aspectRatio = 16 / 9;
  const pullY = 0.2;
  const flightTime = simulateBasketballShot({
    startX: 0.5,
    pullX: 0,
    pullY,
    aspectRatio
  }).flightTime;
  await harness.engine.handleGameAction("room-1", "host-1", "shoot", {
    startX: 0.5,
    pullX: 0,
    pullY,
    aspectRatio
  });
  harness.setNow(new Date("2026-01-01T00:00:00.750Z"));
  await harness.engine.handleGameAction("room-1", "host-1", "shoot", {
    startX: 0.5,
    pullX: 0,
    pullY,
    aspectRatio
  });
  const playerPullX = (0.4 - 0.5) * aspectRatio / (4.5 * flightTime);
  await harness.engine.handleGameAction("room-1", "player-2", "shoot", {
    startX: 0.4,
    pullX: playerPullX,
    pullY,
    aspectRatio
  });

  const party = harness.room.currentParty;
  const scheduled = harness.engine.gameManager.get("basketball").getScheduledAction({
    state: party.gameState
  });
  assert.equal(scheduled.action, "timeout");
  assert.equal(new Date(scheduled.at).getTime() - new Date(party.currentGameStartedAt).getTime(), 90_000);
  harness.setNow(scheduled.at);
  await harness.engine.runScheduledGameAction(
    "room-1",
    party.id,
    party.currentGameIndex,
    party.gameStateVersion,
    "timeout"
  );
  await harness.finishPendingRound();

  assert.equal(harness.room.state, "showing_final_results");
  assert.deepEqual(harness.room.currentParty.gameResults[0].rankings.map(entry => entry.points), [20, 10]);
});

test("Rabisco keeps its word private, validates drawer permissions, and accepts a unique correct guess", async () => {
  const game = new GarticGameModule({ random: () => 0 });
  const participants = [
    { userId: "player-1", username: "Ana" },
    { userId: "player-2", username: "Bia" }
  ];
  let time = new Date("2026-01-01T00:00:00.000Z");
  const now = () => new Date(time);
  const state = await game.start({ participants, now });
  const word = state.currentRound.word;
  assert.equal(GARTIC_TIMINGS.roundCount, 5);
  assert.equal(GARTIC_TIMINGS.roundDurationMs, 90_000);
  assert.equal(game.getClientState({ state, userId: "player-1" }).currentRound.secretWord, word);
  assert.equal(game.getClientState({ state, userId: "player-2" }).currentRound.secretWord, null);
  assert.equal(game.getClientState({ state, userId: "player-2" }).currentRound.wordMask.includes(word), false);

  await assert.rejects(game.handleAction({
    participant: participants[1], state, now
  }, {
    action: "draw",
    payload: {
      roundNumber: 1,
      points: [[10, 10], [20, 20]],
      color: "#172033",
      size: 7,
      eraser: false
    }
  }), /desenhista da vez/);

  await assert.rejects(game.handleAction({
    participant: participants[0], state, now
  }, {
    action: "draw",
    payload: {
      roundNumber: 1,
      points: [[-1, 10], [20, 20]],
      color: "#172033",
      size: 7,
      eraser: false
    }
  }), /Traço de desenho inválido/);

  await game.handleAction({
    participant: participants[0], state, now
  }, {
    action: "draw",
    payload: {
      roundNumber: 1,
      points: [[10, 10], [20, 20]],
      color: "#172033",
      size: 7,
      eraser: false
    }
  });
  const incorrectGuess = await game.handleAction({
    participant: participants[1], state, now
  }, { action: "guess", payload: { roundNumber: 1, guess: "nao e essa" } });
  assert.equal(state.currentRound.messages.at(-1).text, "nao e essa");
  assert.equal(incorrectGuess.update.currentRound.lastMessage.text, "nao e essa");
  assert.equal(incorrectGuess.update.currentRound.lastMessage.username, "Bia");

  const correct = await game.handleAction({
    participant: participants[1], state, now
  }, { action: "guess", payload: { roundNumber: 1, guess: word.toLocaleLowerCase("pt-BR") } });
  assert.equal(correct.state.currentRound.result.word, word);
  assert.equal(state.players.find(player => player.userId === "player-2").points, 100);
  assert.equal(state.players.find(player => player.userId === "player-1").points, 25);
  await assert.rejects(game.handleAction({
    participant: participants[1], state, now
  }, { action: "guess", payload: { roundNumber: 1, guess: word } }), /rodada já terminou/);
});

test("Rabisco accepts synchronized geometric shapes and custom colors only in valid drawing payloads", async () => {
  const game = new GarticGameModule();
  const participants = [
    { userId: "player-1", username: "Ana" },
    { userId: "player-2", username: "Bia" }
  ];
  const state = await game.start({ participants });
  const shapes = ["square", "circle", "triangle", "line"];

  for (const [index, shape] of shapes.entries()) {
    await game.handleAction({
      participant: participants[0],
      state
    }, {
      action: "draw",
      payload: {
        roundNumber: 1,
        points: [[10, 10], [100 + index * 30, 80 + index * 20]],
        color: "#12abef",
        size: 5,
        eraser: false,
        shape
      }
    });
  }
  assert.deepEqual(
    state.currentRound.drawingOps.map(operation => operation.shape),
    shapes
  );
  assert.equal(state.currentRound.drawingOps[0].points[1][0], 100);
  assert.equal(state.currentRound.drawingOps[1].points[1][0], 130);
  assert.equal(state.currentRound.drawingOps[2].points[1][1], 120);
  assert.equal(state.currentRound.drawingOps[0].color, "#12abef");

  const firstShape = state.currentRound.drawingOps.at(-1);
  const undoShape = await game.handleAction({
    participant: participants[0],
    state
  }, {
    action: "undo",
    payload: { roundNumber: 1 }
  });
  assert.equal(undoShape.state.currentRound.drawingOps.length, shapes.length - 1);
  assert.equal(undoShape.update.currentRound.lastDrawingOp.type, "undo");
  assert.equal(state.currentRound.drawingOps.includes(firstShape), false);

  await game.handleAction({
    participant: participants[0],
    state
  }, {
    action: "clear",
    payload: { roundNumber: 1 }
  });
  assert.equal(state.currentRound.drawingOps.at(-1).type, "clear");
  await game.handleAction({
    participant: participants[0],
    state
  }, {
    action: "undo",
    payload: { roundNumber: 1 }
  });
  assert.equal(state.currentRound.drawingOps.length, shapes.length - 1);

  await assert.rejects(game.handleAction({
    participant: participants[0],
    state
  }, {
    action: "draw",
    payload: {
      roundNumber: 1,
      points: [[10, 10], [100, 80]],
      color: "#12abef",
      size: 5,
      eraser: false,
      shape: "star"
    }
  }), /Traço de desenho inválido/);
});

test("Party Engine serializes Rabisco actions and advances all five timed rounds", async t => {
  const harness = createHarness({ games: ["gartic"] });
  t.after(() => harness.engine.close());
  await harness.engine.start("room-1", "host-1");

  const game = harness.engine.gameManager.get("gartic");
  const initialRound = harness.room.currentParty.gameState.currentRound;
  const publicStart = harness.events.find(event => event.event === "party:game-start");
  assert.equal(publicStart.payload.gameState.currentRound.secretWord, null);
  assert.equal(
    harness.privateEvents.find(event => event.userId === "host-1").payload.gameState.currentRound.secretWord,
    initialRound.word
  );
  assert.equal(
    harness.privateEvents.find(event => event.userId === "player-2").payload.gameState.currentRound.secretWord,
    null
  );
  assert.equal(
    (await harness.engine.getPartyState("room-1", "host-1")).gameState.currentRound.secretWord,
    initialRound.word
  );
  assert.equal(
    (await harness.engine.getPartyState("room-1", "player-2")).gameState.currentRound.secretWord,
    null
  );
  for (let roundNumber = 1; roundNumber <= GARTIC_TIMINGS.roundCount; roundNumber += 1) {
    const party = harness.room.currentParty;
    const round = party.gameState.currentRound;
    assert.equal(round.roundNumber, roundNumber);
    if (roundNumber === 1) {
      const [drawing] = await Promise.all([
        harness.engine.handleGameAction("room-1", "host-1", "draw", {
          roundNumber,
          points: [[10, 10], [20, 20]],
          color: "#172033",
          size: 7,
          eraser: false
        }),
        harness.engine.handleGameAction("room-1", "player-2", "guess", {
          roundNumber,
          guess: "tentativa"
        })
      ]);
      assert.equal(drawing.room.state, "party_running");
      assert.equal(harness.room.currentParty.gameState.currentRound.drawingOps.length, 1);
      assert.equal(harness.room.currentParty.gameState.currentRound.messages.at(-1).text, "tentativa");
      await harness.engine.handleGameAction("room-1", "player-2", "guess", {
        roundNumber,
        guess: round.word
      });
    } else {
      const timeout = game.getScheduledAction({ state: party.gameState });
      assert.equal(timeout.action, "timeout");
      harness.setNow(timeout.at);
      await harness.engine.runScheduledGameAction(
        "room-1", party.id, party.currentGameIndex, party.gameStateVersion, "timeout"
      );
    }

    const advance = game.getScheduledAction({ state: harness.room.currentParty.gameState });
    assert.equal(advance.action, "advance");
    harness.setNow(advance.at);
    await harness.engine.runScheduledGameAction(
      "room-1",
      harness.room.currentParty.id,
      harness.room.currentParty.currentGameIndex,
      harness.room.currentParty.gameStateVersion,
      "advance"
    );
    if (roundNumber === 1) {
      await assert.rejects(harness.engine.handleGameAction("room-1", "player-2", "guess", {
        roundNumber,
        guess: "tentativa atrasada"
      }), /rodada anterior/);
    }
  }

  assert.ok(harness.room.currentParty.roundFinishAt);
  await harness.finishPendingRound();
  assert.equal(harness.room.state, "showing_final_results");
  assert.equal(harness.room.currentParty.gameResults[0].gameId, "gartic");
  assert.deepEqual(harness.room.currentParty.gameResults[0].rankings.map(entry => entry.points), [20, 10]);
});

test("Rabisco accepts drawing beyond the former per-round caps without rebroadcasting private history", async t => {
  const harness = createHarness({ games: ["gartic"] });
  t.after(() => harness.engine.close());
  await harness.engine.start("room-1", "host-1");

  for (let index = 0; index < 305; index += 1) {
    await harness.engine.handleGameAction("room-1", "host-1", "draw", {
      roundNumber: 1,
      points: [[10, 10], [20, 20]],
      color: "#172033",
      size: 7,
      eraser: false,
      shape: "square"
    });
  }

  const drawingState = harness.room.currentParty.gameState;
  assert.equal(drawingState.currentRound.drawingOps.length, 305);
  assert.equal(drawingState.currentRound.drawingPointCount, undefined);
  assert.ok(JSON.stringify(drawingState).length > 32_000);
  assert.equal(harness.privateEvents.length, 2);
});

test("Rock Paper Scissors restores a saved match with missing choices and scores", async () => {
  const game = new RockPaperScissorsGameModule();
  const participants = [
    { userId: "player-1", username: "Ana" },
    { userId: "player-2", username: "Bia" }
  ];
  const state = await game.start({ participants });
  state.currentMatch.choices = null;
  state.currentMatch.wins = null;

  const clientState = game.getClientState({ state, userId: "player-1" });
  assert.equal(clientState.currentMatch.selectedCount, 0);
  assert.deepEqual(clientState.currentMatch.wins, {
    "player-1": 0,
    "player-2": 0
  });

  await game.handleAction({
    participant: participants[0],
    state
  }, { action: "choose", payload: { choice: "rock" } });
  assert.deepEqual(state.currentMatch.choices, { "player-1": "rock" });
});

test("Rock Paper Scissors waits out a third-round tie and uses sudden death", async () => {
  const game = new RockPaperScissorsGameModule();
  let time = new Date("2026-01-01T00:00:00.000Z");
  const now = () => new Date(time);
  const participants = [
    { userId: "player-1", username: "Ana" },
    { userId: "player-2", username: "Bia" }
  ];
  const state = await game.start({ participants, now });
  const playRound = async (firstChoice, secondChoice) => {
    for (const [userId, choice] of [["player-1", firstChoice], ["player-2", secondChoice]]) {
      await game.handleAction({
        participant: participants.find(person => person.userId === userId),
        state,
        now
      }, { action: "choose", payload: { choice } });
    }
  };
  const continueRound = () => {
    time = new Date(state.currentMatch.resultAdvanceAt);
    return game.handleAction({
      participant: participants[0],
      state,
      now
    }, { action: "continue", payload: {} });
  };

  await playRound("rock", "scissors");
  await continueRound();
  await playRound("scissors", "rock");
  await continueRound();
  await playRound("paper", "paper");
  assert.equal(state.currentMatch.winnerUserId, null);
  assert.equal(state.currentMatch.result.isSuddenDeath, false);
  await continueRound();
  assert.equal(state.currentMatch.playedRounds, 3);
  await playRound("rock", "scissors");
  assert.equal(state.currentMatch.result.isSuddenDeath, true);
  assert.equal(state.currentMatch.winnerUserId, "player-1");
});

test("Rock Paper Scissors gives an odd-player bye a match against the round winner", async () => {
  const game = new RockPaperScissorsGameModule();
  let time = new Date("2026-01-01T00:00:00.000Z");
  const now = () => new Date(time);
  const participants = [
    { userId: "player-1", username: "Ana" },
    { userId: "player-2", username: "Bia" },
    { userId: "player-3", username: "Caio" }
  ];
  const state = await game.start({ participants, now });
  assert.equal(state.byeUserId, "player-3");
  assert.equal(game.getClientState({ state, userId: "player-3" }).players[2].status, "waiting");

  const choose = (userId, choice) => game.handleAction({
    participant: participants.find(person => person.userId === userId),
    state,
    now
  }, { action: "choose", payload: { choice } });
  const continueMatch = () => {
    time = new Date(state.currentMatch.resultAdvanceAt);
    return game.handleAction({
      participant: participants[0],
      state,
      now
    }, { action: "continue", payload: {} });
  };
  await choose("player-1", "rock");
  await choose("player-2", "scissors");
  await continueMatch();
  await choose("player-1", "rock");
  await choose("player-2", "scissors");
  await continueMatch();
  assert.deepEqual(state.currentMatch.players, ["player-1", "player-3"]);
});

test("Rock Paper Scissors ties a round when the ten-second choice timer expires", async () => {
  const game = new RockPaperScissorsGameModule();
  let time = new Date("2026-01-01T00:00:00.000Z");
  const now = () => new Date(time);
  const participants = [
    { userId: "player-1", username: "Ana" },
    { userId: "player-2", username: "Bia" }
  ];
  const state = await game.start({ participants, now });
  await game.handleAction({
    participant: participants[0],
    state,
    now
  }, { action: "choose", payload: { choice: "rock" } });

  const scheduled = game.getScheduledAction({ state });
  assert.equal(scheduled.action, "timeout");
  assert.equal(new Date(scheduled.at).getTime() - time.getTime(), 10_000);
  time = new Date(scheduled.at);
  await game.handleAction({
    participant: participants[0],
    state,
    now
  }, { action: "timeout", payload: {} });

  assert.equal(state.currentMatch.result.timedOut, true);
  assert.equal(state.currentMatch.result.winnerUserId, null);
  assert.deepEqual(state.currentMatch.result.choices, { "player-1": "rock" });
  assert.deepEqual(state.currentMatch.wins, { "player-1": 0, "player-2": 0 });
  const advance = game.getScheduledAction({ state });
  assert.equal(advance.action, "continue");
  assert.equal(new Date(advance.at).getTime() - time.getTime(), 5_000);
  await assert.rejects(game.handleAction({
    participant: participants[0],
    state,
    now
  }, { action: "continue", payload: {} }), /automaticamente/);
  time = new Date(state.currentMatch.resultAdvanceAt);
  await game.handleAction({
    participant: participants[0],
    state,
    now
  }, { action: "continue", payload: {} });

  assert.equal(state.currentMatch.result, null);
  assert.equal(state.currentMatch.playedRounds, 1);
  assert.equal(new Date(state.currentMatch.choiceDeadlineAt).getTime() - time.getTime(), 10_000);
});

test("Party Engine completes Rock Paper Scissors and publishes the final ranking", async () => {
  const harness = createHarness({
    games: ["rock-paper-scissors"],
    manager: createDefaultGameManager()
  });
  const { engine, room, events } = harness;
  await engine.start(room.id, room.hostId);
  await assert.rejects(
    engine.handleGameAction(room.id, room.hostId, "timeout", {}),
    /reservada ao servidor/
  );
  const choose = (userId, choice) => engine.handleGameAction(
    room.id,
    userId,
    "choose",
    { choice }
  );
  const advance = () => {
    harness.setNow(room.currentParty.gameState.currentMatch.resultAdvanceAt);
    return engine.handleGameAction(room.id, room.hostId, "continue", {});
  };

  await choose(room.hostId, "rock");
  await choose("player-2", "scissors");
  await advance();
  await choose(room.hostId, "paper");
  await choose("player-2", "rock");
  const completion = await advance();

  assert.equal(completion.finished, true);
  assert.equal(room.state, "party_running");
  assert.ok(room.currentParty.roundFinishAt);
  await harness.finishPendingRound();
  assert.equal(room.state, "showing_final_results");
  assert.equal(room.currentParty.scores.find(score => score.userId === room.hostId).totalPoints, 20);
  assert.ok(events.some(event => event.event === "party:final-results"));
});

test("PartyRoom and PartySession validate persisted party state", async () => {
  const hostId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const room = new PartyRoom({
    name: "Sala de teste",
    hostId,
    participants: [{ userId: hostId, username: "João" }],
    state: "showing_game_results",
    currentParty: {
      id: "party-session-1",
      status: "showing_game_results",
      currentGameIndex: 0,
      selectedGames: [{ id: "trivia", name: "Trivia", enabled: true }],
      scores: [{ userId: hostId, username: "João", totalPoints: 120 }],
      gameResults: [{
        gameId: "trivia",
        gameName: "Trivia",
        rankings: [{ userId: hostId, username: "João", points: 120, position: 1 }],
        finishedAt: new Date()
      }],
      startedAt: new Date(),
      gameState: null,
      gameStateVersion: 0,
      phaseEndsAt: new Date()
    }
  });
  await room.validate();

  const session = new PartySession({
    sessionId: "party-session-1",
    roomId: room._id,
    status: "party_running",
    currentGameIndex: 0,
    gameStateVersion: 0,
    selectedGames: [{ id: "trivia", name: "Trivia", enabled: true }],
    scores: [{ userId: hostId, username: "João", totalPoints: 0 }],
    startedAt: new Date(),
    finishedAt: null
  });
  await session.validate();
});

test("Party Engine returns the final room to its configured lobby for a new Party", async t => {
  assert.equal(PARTY_TIMINGS.roundFinishDelayMs, 1_000);
  class QueueGameModule extends GameModule {
    async start({ party }) { return { gameIndex: party.currentGameIndex }; }
    async finish() { return null; }
    async calculateScores({ participants }) {
      return participants.map(participant => ({ userId: participant.userId, points: 0 }));
    }
  }
  const manager = new GameManager().register(new QueueGameModule({ id: "queue-test", name: "Queue test" }));
  const harness = createHarness({ games: ["queue-test", "queue-test"], manager });
  t.after(() => harness.engine.close());

  const started = await harness.engine.start("room-1", "host-1");
  assert.equal(started.state, "party_running");
  assert.equal(harness.room.participants.length, 2);
  assert.equal(harness.room.currentParty.selectedGames.length, 2);

  const pendingGameResults = await harness.engine.finishGame("room-1", "host-1");
  assert.equal(pendingGameResults.state, "party_running");
  assert.ok(pendingGameResults.currentParty.roundFinishAt);
  assert.equal(
    new Date(pendingGameResults.currentParty.roundFinishAt).getTime() - Date.parse("2026-01-01T00:00:00.000Z"),
    PARTY_TIMINGS.roundFinishDelayMs
  );
  assert.ok(harness.events.some(event => event.event === "party:round-ending"));
  assert.equal(harness.events.some(event => event.event === "party:game-finish"), false);
  await assert.rejects(
    harness.engine.handleGameAction("room-1", "player-2", "move", {}),
    /finalizada/
  );
  await harness.finishPendingRound();
  const gameResults = await harness.engine.service.get("room-1");
  assert.equal(gameResults.state, "showing_game_results");
  assert.equal(gameResults.currentParty.gameResults[0].rankings.length, 2);
  assert.equal(gameResults.currentParty.scores[0].totalPoints, 0);
  assert.equal(harness.room.participants.length, 2);

  harness.setNow("2026-01-01T00:00:16.000Z");
  await harness.engine.advance("room-1");
  assert.equal(harness.room.state, "party_running");
  assert.equal(harness.room.currentParty.currentGameIndex, 1);
  assert.ok(harness.events.some(event => event.event === "party:next-game"));

  await harness.engine.finishGame("room-1", "host-1");
  await harness.finishPendingRound();
  const finalResults = await harness.engine.service.get("room-1");
  assert.equal(finalResults.state, "showing_final_results");
  assert.equal(finalResults.currentParty.phaseEndsAt, null);
  assert.ok(harness.events.some(event => event.event === "party:final-results"));

  await harness.engine.advance("room-1");
  assert.equal(harness.room.state, "showing_final_results");

  await assert.rejects(harness.engine.endNow("room-1", "player-2"), /host/i);
  const lobby = await harness.engine.endNow("room-1", "host-1");
  assert.equal(lobby.state, "waiting");
  assert.equal(lobby.currentParty, null);
  assert.equal(harness.room.participants.length, 2);
  assert.deepEqual(harness.room.partyConfig.games.map(game => game.id), ["queue-test", "queue-test"]);
  assert.equal(harness.archivedSessions.size, 1);
  assert.equal([...harness.archivedSessions.values()][0].status, "ended");
  const endEvent = harness.events.find(event => event.event === "party:end");
  assert.equal(endEvent.payload.endedBy, "host-1");
  assert.equal(harness.events.some(event => event.event === "room:update" && event.payload.state === "waiting"), false);
  const resultEvent = harness.events.find(event => event.event === "room:message");
  assert.equal(resultEvent.payload.type, "party-result");
  assert.equal(resultEvent.payload.text, "A Party foi encerrada.");
  assert.equal(resultEvent.payload.ranking.length, 2);
  assert.ok(resultEvent.payload.ranking[0].position <= resultEvent.payload.ranking[1].position);
  const restarted = await harness.engine.start("room-1", "host-1");
  assert.equal(restarted.state, "party_running");
  assert.equal(restarted.currentParty.selectedGames.length, 2);
});

test("Party Engine recovers legacy games without blocking other room timers", async t => {
  const harness = createHarness({ games: ["uno"] });
  t.after(() => harness.engine.close());
  await harness.engine.start("room-1", "host-1");

  harness.room.currentParty.selectedGames[0] = {
    id: "trivia",
    name: "Trivia",
    enabled: true
  };
  harness.room.currentParty.scores[0].totalPoints = 25;
  const anotherRoom = {
    ...clone(harness.room),
    _id: "room-2",
    state: "showing_game_results",
    currentParty: {
      ...clone(harness.room.currentParty),
      id: "party-2",
      status: "showing_game_results",
      phaseEndsAt: new Date(Date.now() + 60_000)
    }
  };
  harness.engine.PartyRoom.find = () => ({
    limit() { return this; },
    async lean() { return [clone(harness.room), anotherRoom]; }
  });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(message);
  try {
    await harness.engine.recoverActiveParties();
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(harness.room.state, "showing_final_results");
  assert.equal(harness.room.currentParty.status, "showing_final_results");
  assert.equal(harness.room.currentParty.scores[0].totalPoints, 25);
  assert.equal(harness.engine.timers.has("room-2"), true);
  assert.ok(warnings.some(message => message.includes("trivia")));
  assert.ok(harness.events.some(event =>
    event.event === "party:final-results" && event.roomId === "room-1"
  ));
});

test("Party Engine accepts scores only from server game modules and rejects foreign users", async t => {
  class InvalidScoringModule extends GameModule {
    async start() {}
    async finish() { return null; }
    async calculateScores() {
      return [{ userId: "not-a-participant", points: 999 }];
    }
  }
  const manager = new GameManager().register(new InvalidScoringModule({ id: "trivia", name: "Trivia" }));
  const harness = createHarness({ games: ["trivia"], manager });
  t.after(() => harness.engine.close());
  await harness.engine.start("room-1", "host-1");

  await harness.engine.finishGame("room-1", "host-1");
  await assert.rejects(harness.finishPendingRound(), /pontuação inválida/);
  assert.equal(harness.room.state, "party_running");
  assert.deepEqual(harness.room.currentParty.scores.map(score => score.totalPoints), [0, 0]);
});

test("Party Engine accumulates server-calculated scores into the final ranking", async t => {
  class ScoringModule extends GameModule {
    async start() {}
    async finish() { return null; }
    async calculateScores({ participants }) {
      return participants.map(participant => ({
        userId: participant.userId,
        points: participant.userId === "host-1" ? 120 : 90
      }));
    }
  }
  const manager = new GameManager().register(new ScoringModule({ id: "trivia", name: "Trivia" }));
  const harness = createHarness({ games: ["trivia"], manager });
  t.after(() => harness.engine.close());

  await harness.engine.start("room-1", "host-1");
  await harness.engine.finishGame("room-1", "host-1");
  await harness.finishPendingRound();
  const room = await harness.engine.service.get("room-1");

  assert.equal(room.state, "showing_final_results");
  assert.equal(room.currentParty.phaseEndsAt, null);
  assert.deepEqual(room.currentParty.scores.map(score => score.totalPoints), [120, 90]);
  assert.deepEqual(room.currentParty.gameResults[0].rankings.map(entry => entry.points), [120, 90]);
});

test("Party Engine gives tied scores the same ranking position", async t => {
  class TiedScoringModule extends GameModule {
    async start() {}
    async finish() { return null; }
    async calculateScores({ participants }) {
      return participants.map(participant => ({ userId: participant.userId, points: 20 }));
    }
  }
  const manager = new GameManager().register(new TiedScoringModule({ id: "tie", name: "Empate" }));
  const harness = createHarness({ games: ["tie"], manager });
  t.after(() => harness.engine.close());

  await harness.engine.start("room-1", "host-1");
  await harness.engine.finishGame("room-1", "host-1");
  await harness.finishPendingRound();

  assert.deepEqual(
    harness.room.currentParty.gameResults[0].rankings.map(entry => entry.position),
    [1, 1]
  );
  assert.deepEqual(
    harness.room.currentParty.scores.map(score => score.totalPoints),
    [20, 20]
  );
});

test("Party Engine persists game actions and exposes only module-approved client state", async t => {
  class StatefulModule extends GameModule {
    async start() { return { moves: 0, answer: "server-only" }; }
    async handleAction({ state }, { action }) {
      assert.equal(action, "move");
      return {
        state: { ...state, moves: state.moves + 1 },
        update: { moves: state.moves + 1 }
      };
    }
    getClientState({ state }) {
      return { moves: state.moves };
    }
    async finish() { return null; }
    async calculateScores({ participants, state }) {
      return participants.map(participant => ({
        userId: participant.userId,
        points: participant.userId === "player-2" ? state.moves * 10 : 0
      }));
    }
  }
  const manager = new GameManager().register(new StatefulModule({ id: "trivia", name: "Trivia" }));
  const harness = createHarness({ games: ["trivia"], manager });
  t.after(() => harness.engine.close());

  await harness.engine.start("room-1", "host-1");
  assert.deepEqual(await harness.engine.getPartyState("room-1", "player-2"), {
    room: await harness.engine.service.get("room-1"),
    gameState: { moves: 0 }
  });
  const update = await harness.engine.handleGameAction("room-1", "player-2", "move", { square: "A1" });
  assert.deepEqual(update.update, { moves: 1 });
  assert.equal(harness.room.currentParty.gameState.answer, "server-only");
  await harness.engine.finishGame("room-1", "host-1");
  await harness.finishPendingRound();
  const result = await harness.engine.service.get("room-1");
  assert.deepEqual(result.currentParty.scores.map(score => score.totalPoints), [0, 10]);
});

test("Party Engine resets private game state before starting the next game", async t => {
  class StatefulModule extends GameModule {
    async start({ party }) {
      return { gameIndex: party.currentGameIndex, moves: 0 };
    }
    async handleAction({ state }) {
      return { state: { ...state, moves: state.moves + 1 } };
    }
    getClientState({ state }) { return state; }
    async finish() { return null; }
    async calculateScores() { return []; }
  }
  const manager = new GameManager()
    .register(new StatefulModule({ id: "trivia", name: "Trivia" }))
    .register(new StatefulModule({ id: "guess", name: "Guess" }));
  const harness = createHarness({ games: ["trivia", "guess"], manager });
  t.after(() => harness.engine.close());

  await harness.engine.start("room-1", "host-1");
  await harness.engine.handleGameAction("room-1", "player-2", "move", {});
  assert.deepEqual(harness.room.currentParty.gameState, { gameIndex: 0, moves: 1 });

  await harness.engine.finishGame("room-1", "host-1");
  await harness.finishPendingRound();
  harness.setNow("2026-01-01T00:00:16.000Z");
  await harness.engine.advance("room-1");

  assert.deepEqual(harness.room.currentParty.gameState, { gameIndex: 1, moves: 0 });
  assert.equal(harness.room.currentParty.gameStateVersion, 1);
});

test("Party Engine rejects concurrent game actions based on stale state", async t => {
  let releaseActions;
  const bothActionsStarted = new Promise(resolve => {
    releaseActions = resolve;
  });
  let actionCount = 0;
  class StatefulModule extends GameModule {
    async start() { return { moves: 0 }; }
    async handleAction({ state }) {
      actionCount += 1;
      if (actionCount === 2) releaseActions();
      await bothActionsStarted;
      return { state: { moves: state.moves + 1 } };
    }
  }
  const manager = new GameManager().register(new StatefulModule({ id: "trivia", name: "Trivia" }));
  const harness = createHarness({ games: ["trivia"], manager });
  t.after(() => harness.engine.close());

  await harness.engine.start("room-1", "host-1");
  const results = await Promise.allSettled([
    harness.engine.handleGameAction("room-1", "player-2", "move", {}),
    harness.engine.handleGameAction("room-1", "host-1", "move", {})
  ]);

  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected").length, 1);
  assert.equal(harness.room.currentParty.gameState.moves, 1);
  assert.equal(harness.room.currentParty.gameStateVersion, 2);
});

test("Party Engine sends each UNO hand only to its owner and restores it on reconnect", async t => {
  const harness = createHarness({ games: ["uno"] });
  t.after(() => harness.engine.close());

  await harness.engine.start("room-1", "host-1");
  const publicStart = harness.events.find(event => event.event === "party:game-start");
  assert.equal(publicStart.payload.gameState.mode, "uno");
  assert.equal("hand" in publicStart.payload.gameState, false);
  assert.equal(harness.privateEvents.length, 2);

  const hostState = await harness.engine.getPartyState("room-1", "host-1");
  const playerState = await harness.engine.getPartyState("room-1", "player-2");
  assert.equal(hostState.gameState.hand.length, 7);
  assert.equal(playerState.gameState.hand.length, 7);
  assert.deepEqual(harness.room.currentParty.gameState.players.map(player => player.hand.length), [7, 7]);
  assert.equal("hand" in hostState.room.currentParty, false);
});

test("Party Engine automatically finishes UNO and accumulates the server-calculated winner score", async t => {
  const harness = createHarness({ games: ["uno"] });
  t.after(() => harness.engine.close());
  await harness.engine.start("room-1", "host-1");

  harness.room.currentParty.gameState = {
    mode: "uno",
    players: [
      { userId: "host-1", username: "João", hand: [{ id: 1, color: "blue", value: "2" }], saidUno: false },
      { userId: "player-2", username: "Pedro", hand: [{ id: 2, color: "blue", value: "draw2" }], saidUno: false }
    ],
    deck: [],
    discard: [{ id: 3, color: "blue", value: "7" }],
    currentPlayerIndex: 0,
    direction: 1,
    activeColor: "blue",
    pendingDraw: 0,
    drawnCardId: null,
    drawnCardUserId: null,
    unoPenaltyUserId: null,
    gameOver: false,
    winnerUserId: null,
    message: "Sua vez."
  };

  const result = await harness.engine.handleGameAction(
    "room-1",
    "host-1",
    "play",
    { cardId: 1 }
  );
  assert.equal(result.finished, true);
  assert.equal(result.room.state, "party_running");
  await harness.finishPendingRound();
  const finalRoom = await harness.engine.service.get("room-1");
  assert.equal(finalRoom.state, "showing_final_results");
  assert.deepEqual(finalRoom.currentParty.gameResults[0].rankings.map(entry => entry.points), [20, 10]);
  assert.ok(harness.events.some(event => event.event === "party:game-finish"));
});
