import mongoose from "mongoose";
import { PARTY_MAX_USERS, PARTY_ROOM_ICONS, PartyRoom, PartyRoomMessage } from "../models/PartyRoom.js";

const DEFAULT_GAMES = Object.freeze([
  { id: "uno", name: "UNO", enabled: true },
  { id: "rock-paper-scissors", name: "Pedra, Papel e Tesoura", enabled: false },
  { id: "gartic", name: "Rabisco", enabled: false },
  { id: "basketball", name: "Cesta Certa", enabled: false }
]);
const LEGACY_GAME_IDS = new Set(["trivia", "guess", "drawing", "guess-the-number"]);
const PARTY_ROOM_ICON_SET = new Set(PARTY_ROOM_ICONS);
const ROOM_COVER_FOLDER = "party-room-covers";
const ROOM_COVER_ID_PATTERN = /^[0-9a-f-]{36}$/i;

export class PartyRoomError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function migratePartyGames(games) {
  const remaining = games.filter(game => !LEGACY_GAME_IDS.has(game.id));
  if (!remaining.some(game => game.id === "uno")) {
    remaining.push({ ...DEFAULT_GAMES[0], enabled: games.some(game => game.enabled) });
  }
  for (const defaultGame of DEFAULT_GAMES.slice(1)) {
    if (!remaining.some(game => game.id === defaultGame.id)) {
      remaining.push({ ...defaultGame });
    }
  }
  return remaining;
}

function validateRoomCoverPublicId(publicId, userId) {
  if (publicId === "") return "";
  const expectedPrefix = `orby/${userId}/${ROOM_COVER_FOLDER}/`;
  if (typeof publicId !== "string" ||
      !publicId.startsWith(expectedPrefix) ||
      !ROOM_COVER_ID_PATTERN.test(publicId.slice(expectedPrefix.length))) {
    throw new PartyRoomError("A imagem da sala não pertence a este usuário.");
  }
  return publicId;
}

function roomDto(room) {
  const source = room.toObject ? room.toObject() : room;
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const coverPublicId = typeof source.coverPublicId === "string" &&
    /^orby\/[0-9a-f]{24}\/party-room-covers\/[0-9a-f-]{36}$/i.test(source.coverPublicId)
    ? source.coverPublicId
    : "";
  const state = ["waiting", "party_running", "showing_game_results", "showing_final_results"].includes(source.state)
    ? source.state
    : "waiting";
  const currentParty = source.currentParty ? {
    id: source.currentParty.id,
    status: source.currentParty.status,
    currentGameIndex: source.currentParty.currentGameIndex,
    selectedGames: source.currentParty.selectedGames || [],
    leftUserIds: source.currentParty.leftUserIds || [],
    scores: (source.currentParty.scores || []).map(score => ({
      userId: String(score.userId), username: score.username, totalPoints: score.totalPoints
    })),
    gameResults: (source.currentParty.gameResults || []).map(result => ({
      gameId: result.gameId,
      gameName: result.gameName,
      rankings: (result.rankings || []).map(ranking => ({
        userId: String(ranking.userId),
        username: ranking.username,
        points: ranking.points,
        position: ranking.position
      })),
      finishedAt: result.finishedAt
    })),
    startedAt: source.currentParty.startedAt,
    currentGameStartedAt: source.currentParty.currentGameStartedAt,
    roundFinishAt: source.currentParty.roundFinishAt,
    phaseEndsAt: source.currentParty.phaseEndsAt,
    finishedAt: source.currentParty.finishedAt
  } : null;
  const partyConfig = Array.isArray(source.partyConfig?.games)
    ? { ...source.partyConfig, games: migratePartyGames(source.partyConfig.games) }
    : source.partyConfig;
  return {
    id: String(source._id), name: source.name, hostId: String(source.hostId),
    roomIcon: PARTY_ROOM_ICON_SET.has(source.roomIcon) ? source.roomIcon : PARTY_ROOM_ICONS[0],
    imageUrl: coverPublicId && cloudName
      ? `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload/c_fill,w_256,h_256,g_auto,f_auto,q_auto/${coverPublicId}`
      : "",
    participants: (source.participants || []).map(participant => ({
      userId: String(participant.userId), username: participant.username, joinedAt: participant.joinedAt
    })),
    maxUsers: source.maxUsers,
    status: state === "waiting" ? "waiting" : "started",
    state,
    currentParty,
    partyConfig,
    createdAt: source.createdAt, updatedAt: source.updatedAt
  };
}

export function createPartyRoomService({
  User,
  PartyRoomModel = PartyRoom,
  PartyRoomMessageModel = PartyRoomMessage
}) {
  const membershipLocks = new Map();

  async function withMembershipLock(userId, action) {
    const key = String(userId);
    const previous = membershipLocks.get(key) || Promise.resolve();
    let release;
    const current = new Promise(resolve => { release = resolve; });
    membershipLocks.set(key, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (membershipLocks.get(key) === current) membershipLocks.delete(key);
    }
  }

  async function getUser(userId) {
    if (!mongoose.isValidObjectId(userId)) throw new PartyRoomError("Usuário inválido.", 401);
    const user = await User.findById(userId).select("nome email");
    if (!user) throw new PartyRoomError("Usuário não encontrado.", 401);
    return user;
  }
  const userName = user => user.nome || user.email?.split("@")[0] || "Usuário";
  const validRoomId = roomId => {
    if (!mongoose.isValidObjectId(roomId)) throw new PartyRoomError("Sala inválida.", 400);
  };

  async function getRoom(roomId) {
    validRoomId(roomId);
    const room = await PartyRoomModel.findById(roomId);
    if (!room) throw new PartyRoomError("Sala não encontrada.", 404);
    if (room.state === "waiting" && room.status === "started" && room.$isDefault?.("state")) {
      room.status = "waiting";
      room.currentParty = null;
      await room.save();
    }
    if (room.state === "waiting" && Array.isArray(room.partyConfig?.games) &&
        (!room.partyConfig.games.some(game => game.id === "uno") ||
        !room.partyConfig.games.some(game => game.id === "rock-paper-scissors") ||
        !room.partyConfig.games.some(game => game.id === "gartic") ||
         !room.partyConfig.games.some(game => game.id === "basketball") ||
         room.partyConfig.games.some(game => LEGACY_GAME_IDS.has(game.id)))) {
      room.partyConfig.games = migratePartyGames(room.partyConfig.games);
      await room.save();
    }
    return room;
  }
  async function requireParticipant(roomId, userId) {
    const room = await getRoom(roomId);
    if (!room.participants.some(participant => String(participant.userId) === String(userId))) {
      throw new PartyRoomError("Entre na sala antes de usar este recurso.", 403);
    }
    return room;
  }
  async function requireHost(roomId, userId) {
    const room = await requireParticipant(roomId, userId);
    if (String(room.hostId) !== String(userId)) throw new PartyRoomError("Somente o host pode fazer isso.", 403);
    return room;
  }

  async function membershipRooms(userId) {
    return PartyRoomModel.find({ "participants.userId": userId });
  }

  function isPartyInProgress(room) {
    const state = room.state || (room.status === "started" ? "party_running" : "waiting");
    return ["party_running", "showing_game_results"].includes(state);
  }

  function leaveableRoomFilter(room, userId) {
    return {
      _id: room._id,
      "participants.userId": userId,
      $or: [
        { state: { $in: ["waiting", "showing_final_results"] } },
        { state: { $exists: false }, status: "waiting" }
      ]
    };
  }

  async function removeParticipant(room, userId) {
    const remaining = room.participants.filter(participant =>
      String(participant.userId) !== String(userId)
    );
    if (!remaining.length) {
      const deleted = await PartyRoomModel.deleteOne(leaveableRoomFilter(room, userId));
      if (deleted?.deletedCount === 0) {
        throw new PartyRoomError("A sala foi atualizada; tente novamente.", 409);
      }
      await PartyRoomMessageModel.deleteMany({ roomId: room._id });
      return { deleted: true, room: null };
    }

    const updates = { participants: remaining };
    if (String(room.hostId) === String(userId)) updates.hostId = remaining[0].userId;
    const updated = await PartyRoomModel.findOneAndUpdate(
      leaveableRoomFilter(room, userId),
      { $set: updates },
      { returnDocument: "after" }
    );
    if (!updated) throw new PartyRoomError("A sala foi atualizada; tente novamente.", 409);
    return { deleted: false, room: roomDto(updated) };
  }

  async function leavePreviousRooms(rooms, targetRoomId, userId) {
    const previousRooms = rooms.filter(room => String(room._id) !== String(targetRoomId));
    const leftRooms = [];
    for (const room of previousRooms) {
      leftRooms.push({
        roomId: String(room._id),
        ...await removeParticipant(room, userId)
      });
    }
    return leftRooms;
  }

  return {
    async list(userId) {
      const filters = [{
        $or: [
          { state: "waiting" },
          { state: { $exists: false }, status: "waiting" },
          { state: "showing_final_results" }
        ],
        $expr: { $lt: [{ $size: "$participants" }, "$maxUsers"] }
      }];
      if (userId) {
        filters.push({
          state: { $in: ["party_running", "showing_game_results", "showing_final_results"] },
          "participants.userId": userId
        });
      }
      const rooms = await PartyRoomModel.find({ $or: filters })
        .sort({ updatedAt: -1 }).limit(100);
      return rooms.map(roomDto);
    },
    async roomsForUser(userId) {
      const rooms = await PartyRoomModel.find({ "participants.userId": userId })
        .sort({ updatedAt: -1 }).limit(20);
      return rooms.map(roomDto);
    },
    async get(roomId) { return roomDto(await getRoom(roomId)); },
    async create(userId, name, coverPublicId = "", roomIcon = PARTY_ROOM_ICONS[0]) {
      const cleanName = typeof name === "string" ? name.trim() : "";
      if (!cleanName || cleanName.length > 80) throw new PartyRoomError("Informe um nome de sala de até 80 caracteres.");
      const cleanCoverPublicId = validateRoomCoverPublicId(coverPublicId, userId);
      if (!PARTY_ROOM_ICON_SET.has(roomIcon)) throw new PartyRoomError("Selecione um ícone válido para a sala.");
      return withMembershipLock(userId, async () => {
        const user = await getUser(userId);
        const existingRooms = await membershipRooms(user._id);
        if (existingRooms.some(isPartyInProgress)) {
          throw new PartyRoomError("Você já está em uma Party em andamento. Aguarde ela terminar para trocar de sala.", 409);
        }
        const now = new Date();
        const created = await PartyRoomModel.create({
          name: cleanName, coverPublicId: cleanCoverPublicId, roomIcon, hostId: user._id,
          participants: [{ userId: user._id, username: userName(user), joinedAt: now }],
          maxUsers: PARTY_MAX_USERS,
          partyConfig: { name: cleanName, games: DEFAULT_GAMES.map(game => ({ ...game })), rounds: 0 }
        });
        const room = roomDto(created);
        const leftRooms = await leavePreviousRooms(existingRooms, room.id, user._id);
        return { room, leftRooms };
      });
    },
    async join(roomId, userId) {
      validRoomId(roomId);
      return withMembershipLock(userId, async () => {
        const user = await getUser(userId);
        const memberships = await membershipRooms(user._id);
        if (memberships.some(room =>
          String(room._id) !== String(roomId) && isPartyInProgress(room)
        )) {
          throw new PartyRoomError("Você já está em uma Party em andamento. Aguarde ela terminar para trocar de sala.", 409);
        }
        const existing = memberships.find(room => String(room._id) === String(roomId));
        if (existing) {
          const leftRooms = await leavePreviousRooms(memberships, roomId, user._id);
          return { room: roomDto(existing), joined: false, leftRooms };
        }

        const newParticipant = { userId: user._id, username: userName(user), joinedAt: new Date() };
        const emptyRoom = await PartyRoomModel.findOneAndUpdate({
          _id: roomId,
          $or: [{ state: "waiting" }, { state: { $exists: false }, status: "waiting" }],
          participants: { $size: 0 }
        }, {
          $set: { hostId: user._id },
          $push: { participants: newParticipant }
        }, { returnDocument: "after" });
        if (emptyRoom) {
          const leftRooms = await leavePreviousRooms(memberships, roomId, user._id);
          return { room: roomDto(emptyRoom), joined: true, leftRooms };
        }
        // The capacity predicate and push happen in one MongoDB operation: concurrent joins cannot exceed 8.
        const room = await PartyRoomModel.findOneAndUpdate({
          _id: roomId,
          $or: [
            { state: "waiting" },
            { state: { $exists: false }, status: "waiting" },
            { state: "showing_final_results" }
          ],
          "participants.userId": { $ne: user._id },
          $expr: { $lt: [{ $size: "$participants" }, "$maxUsers"] }
        }, { $push: { participants: newParticipant } }, { returnDocument: "after" });
        if (!room) {
          const found = await PartyRoomModel.findById(roomId);
          if (!found) throw new PartyRoomError("Sala não encontrada.", 404);
          const alreadyJoined = await PartyRoomModel.findOne({
            _id: roomId,
            "participants.userId": user._id
          });
          if (alreadyJoined) {
            const leftRooms = await leavePreviousRooms(memberships, roomId, user._id);
            return { room: roomDto(alreadyJoined), joined: false, leftRooms };
          }
          if (!["waiting", "showing_final_results"].includes(found.state || found.status)) {
            throw new PartyRoomError("A Party já foi iniciada.", 409);
          }
          throw new PartyRoomError("A sala está cheia.", 409);
        }
        const leftRooms = await leavePreviousRooms(memberships, roomId, user._id);
        return { room: roomDto(room), joined: true, leftRooms };
      });
    },
    async leave(roomId, userId) {
      return withMembershipLock(userId, async () => {
        const room = await requireParticipant(roomId, userId);
        if (!["waiting", "showing_final_results"].includes(room.state)) {
          throw new PartyRoomError("Aguarde a Party terminar para sair da sala.", 409);
        }
        return removeParticipant(room, userId);
      });
    },
    async updateParty(roomId, userId, config) {
      await requireHost(roomId, userId);
      const hasRoomName = Object.hasOwn(config || {}, "roomName");
      const hasCoverPublicId = Object.hasOwn(config || {}, "coverPublicId");
      const hasRoomIcon = Object.hasOwn(config || {}, "roomIcon");
      const name = typeof config?.name === "string" ? config.name.trim() : "";
      const roomName = hasRoomName && typeof config.roomName === "string" ? config.roomName.trim() : "";
      const rounds = Number(config?.rounds ?? 0);
      const games = Array.isArray(config?.games) ? config.games : [];
      if (name.length > 100 || (hasRoomName && (!roomName || roomName.length > 80)) ||
          (hasRoomIcon && !PARTY_ROOM_ICON_SET.has(config.roomIcon)) ||
          !Number.isInteger(rounds) || rounds < 0 || rounds > 100 || games.length > 30 ||
          games.some(game => !game || typeof game.id !== "string" || !game.id.trim() || game.id.length > 80 || typeof game.name !== "string" || !game.name.trim() || game.name.length > 120 || typeof game.enabled !== "boolean")) {
        throw new PartyRoomError("Configuração da Party inválida.");
      }
      const updates = {
        partyConfig: { name, rounds, games: games.map(game => ({ id: game.id.trim(), name: game.name.trim(), enabled: game.enabled })) }
      };
      if (hasRoomName) updates.name = roomName;
      if (hasCoverPublicId) updates.coverPublicId = validateRoomCoverPublicId(config.coverPublicId, userId);
      if (hasRoomIcon) updates.roomIcon = config.roomIcon;
      const room = await PartyRoomModel.findOneAndUpdate({
        _id: roomId,
        hostId: userId,
        $or: [
          { state: "waiting" },
          { state: { $exists: false }, status: "waiting" },
          { state: "showing_final_results" }
        ]
      }, { $set: updates }, { returnDocument: "after" });
      if (!room) throw new PartyRoomError("Não foi possível atualizar a Party.", 409);
      return roomDto(room);
    },
    async invite(roomId, senderId, recipientId) {
      validRoomId(roomId);
      if (!mongoose.isValidObjectId(recipientId)) throw new PartyRoomError("Selecione um usuário válido.");
      const room = await requireParticipant(roomId, senderId);
      if (room.state !== "waiting") throw new PartyRoomError("Só é possível convidar para uma sala aguardando jogadores.", 409);
      if (room.participants.some(person => String(person.userId) === String(recipientId))) {
        throw new PartyRoomError("Esse usuário já está na sala.", 409);
      }
      if (room.participants.length >= room.maxUsers) throw new PartyRoomError("A sala está cheia.", 409);
      const recipient = await User.findById(recipientId);
      if (!recipient) throw new PartyRoomError("Usuário não encontrado.", 404);
      const sender = room.participants.find(person => String(person.userId) === String(senderId));
      const now = new Date();
      const alreadyInvited = recipient.notificacoes?.some(notification =>
        notification.tipo === "orby_party_convite" &&
        notification.partyRoomId === String(room._id) &&
        notification.remetenteId === String(senderId) &&
        !notification.lida &&
        notification.expiraEm > now
      );
      if (alreadyInvited) throw new PartyRoomError("Esse usuário já tem um convite pendente para esta sala.", 409);
      const notification = {
        titulo: "Convite para uma Orby Party",
        texto: `${sender?.username || "Um jogador"} convidou você para a sala "${room.name}".`,
        tarefaId: "",
        partidaId: "",
        partyRoomId: String(room._id),
        ratingValendo: false,
        tipo: "orby_party_convite",
        remetenteId: String(senderId),
        remetenteNome: sender?.username || "Jogador",
        criadaEm: now,
        expiraEm: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        lida: false
      };
      recipient.notificacoes.push(notification);
      await recipient.save();
      const savedNotification = recipient.notificacoes[recipient.notificacoes.length - 1];
      return {
        recipientId: String(recipient._id),
        notification: {
          _id: String(savedNotification._id),
          ...notification
        }
      };
    },
    async messages(roomId, userId) {
      await requireParticipant(roomId, userId);
      const messages = await PartyRoomMessageModel.find({ roomId }).sort({ createdAt: -1 }).limit(100).lean();
      return messages.reverse().map(message => ({
        id: String(message._id),
        senderId: String(message.senderId),
        senderName: message.senderName,
        type: message.type || "text",
        text: message.text || "",
        imageUrl: message.imageUrl || "",
        ranking: (message.ranking || []).map(entry => ({
          userId: String(entry.userId),
          username: entry.username,
          points: entry.points,
          position: entry.position
        })),
        createdAt: message.createdAt
      }));
    },
    async message(roomId, userId, text) {
      const room = await requireParticipant(roomId, userId);
      const participant = room.participants.find(item => String(item.userId) === String(userId));
      const cleanText = typeof text === "string" ? text.trim() : "";
      if (!cleanText || cleanText.length > 500) throw new PartyRoomError("A mensagem deve ter entre 1 e 500 caracteres.");
      return createMessage({
        roomId: room._id,
        userId,
        participant,
        type: "text",
        text: cleanText
      });
    },
    async partyResultMessage(roomId, userId, ranking, leftUserIds) {
      const room = await requireParticipant(roomId, userId);
      const withdrawn = new Set((leftUserIds ?? room.currentParty?.leftUserIds ?? []).map(String));
      const activeParticipants = room.participants.filter(participant =>
        !withdrawn.has(String(participant.userId))
      );
      if (!Array.isArray(ranking) || ranking.length !== activeParticipants.length ||
          ranking.length > PARTY_MAX_USERS) {
        throw new PartyRoomError("O ranking final da Party é inválido.", 500);
      }
      const participantIds = new Set(activeParticipants.map(item => String(item.userId)));
      const rankedIds = new Set();
      for (const entry of ranking) {
        const entryId = String(entry?.userId || "");
        if (!participantIds.has(entryId) || rankedIds.has(entryId) ||
            typeof entry.username !== "string" ||
            !Number.isSafeInteger(entry.points) || entry.points < 0 ||
            !Number.isSafeInteger(entry.position) || entry.position < 1) {
          throw new PartyRoomError("O ranking final da Party é inválido.", 500);
        }
        rankedIds.add(entryId);
      }
      return createMessage({
        roomId: room._id,
        userId,
        participant: { username: "Orby Party" },
        type: "party-result",
        text: "A Party foi encerrada.",
        ranking
      });
    },
    async imageMessage(roomId, userId, publicId) {
      const room = await requireParticipant(roomId, userId);
      const participant = room.participants.find(item => String(item.userId) === String(userId));
      const expectedPrefix = `orby/${userId}/party-chat/${roomId}/`;
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      if (!cloudName) throw new PartyRoomError("O envio de imagens está indisponível no momento.", 503);
      if (typeof publicId !== "string" ||
          !publicId.startsWith(expectedPrefix) ||
          !/^[0-9a-f-]{36}$/i.test(publicId.slice(expectedPrefix.length))) {
        throw new PartyRoomError("A imagem enviada não pertence a este usuário ou sala.");
      }
      return createMessage({
        roomId: room._id,
        userId,
        participant,
        type: "image",
        text: "",
        imageUrl: `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/image/upload/f_auto,q_auto/${publicId}`
      });
    },
    requireParticipant, requireHost, getUser
  };

  async function createMessage({ roomId, userId, participant, type, text, imageUrl = "", ranking }) {
    const message = await PartyRoomMessageModel.create({
      roomId,
      senderId: userId,
      senderName: participant.username,
      type,
      text,
      imageUrl,
      ...(ranking ? { ranking } : {})
    });
    return {
      id: String(message._id),
      senderId: String(message.senderId),
      senderName: message.senderName,
      type: message.type || type,
      text: message.text || "",
      imageUrl: message.imageUrl || "",
      ranking: (message.ranking || ranking || []).map(entry => ({
        userId: String(entry.userId),
        username: entry.username,
        points: entry.points,
        position: entry.position
      })),
      createdAt: message.createdAt
    };
  }
}
