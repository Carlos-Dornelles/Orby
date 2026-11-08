import { Server } from "socket.io";
import { PartyRoomError } from "../services/partyRoomService.js";
import { PartyEngine } from "../services/partyEngine.js";

const channel = roomId => `party-room:${roomId}`;
const userChannel = userId => `party-user:${userId}`;
const ack = (callback, payload) => {
  if (typeof callback === "function") callback(payload);
};

export function attachPartyRoomSocket(httpServer, {
  service,
  PartyRoom,
  PartySession,
  gameManager,
  getUserIdFromCookie
}) {
  const io = new Server(httpServer, { cors: { origin: true, credentials: true } });
  const engine = new PartyEngine({
    PartyRoom,
    PartySession,
    service,
    gameManager,
    publish: (event, roomId, payload) => {
      if (roomId) io.to(channel(roomId)).emit(event, payload);
      else io.emit(event, payload);
    },
    publishPrivate: (event, userId, payload) => io.to(userChannel(userId)).emit(event, payload)
  });
  const basketballPlayers = new Map();
  const removeBasketballPresence = (roomId, userId) => {
    const players = basketballPlayers.get(roomId);
    if (!players?.delete(userId)) return;
    if (players.size === 0) basketballPlayers.delete(roomId);
    io.to(channel(roomId)).emit("party:basketball:leave", { roomId, userId });
  };

  io.use(async (socket, next) => {
    try {
      const userId = getUserIdFromCookie(socket.handshake.headers.cookie || "");
      if (!userId) return next(new Error("Não autenticado."));
      const user = await service.getUser(userId);
      socket.data.userId = userId;
      socket.data.username = user.nome || user.email?.split("@")[0] || "Usuário";
      next();
    } catch (error) {
      console.error("Não foi possível autenticar o socket da Orby Party:", error);
      next(new Error("Não autenticado."));
    }
  });

  const emitRoom = room => io.to(channel(room.id)).emit("room:update", room);
  const emitDirectory = (action, room) => io.emit("room:directory", { action, room });

  io.on("connection", socket => {
    const userId = socket.data.userId;
    const typingTimers = new Map();
    socket.join(userChannel(userId));
    const stopTyping = roomId => {
      clearTimeout(typingTimers.get(roomId));
      typingTimers.delete(roomId);
      if (!socket.data.typingRooms?.delete(roomId)) return;
      socket.to(channel(roomId)).emit("room:typing", {
        roomId,
        userId,
        username: socket.data.username,
        isTyping: false
      });
    };
    const publishMembershipChanges = async leftRooms => {
      if (!leftRooms?.length) return;
      const userSockets = await io.in(userChannel(userId)).fetchSockets();
      for (const left of leftRooms) {
        const roomChannel = channel(left.roomId);
        removeBasketballPresence(left.roomId, userId);
        stopTyping(left.roomId);
        io.to(roomChannel).emit("room:typing", {
          roomId: left.roomId,
          userId,
          isTyping: false
        });
        for (const memberSocket of userSockets) {
          if (memberSocket.data.partyCursorRoomId === left.roomId) {
            io.to(roomChannel).emit("party:cursor:leave", { cursorId: memberSocket.id });
            memberSocket.data.partyCursorRoomId = null;
          }
        }
        io.in(userChannel(userId)).socketsLeave(roomChannel);
        if (left.deleted) {
          io.emit("room:directory", { action: "deleted", roomId: left.roomId });
        } else {
          emitRoom(left.room);
          io.to(roomChannel).emit("room:participants", left.room.participants);
          io.to(roomChannel).emit("room:system", {
            type: "left",
            username: socket.data.username,
            createdAt: new Date()
          });
          emitDirectory("updated", left.room);
        }
      }
    };
    const handle = (event, action) => socket.on(event, async (payload = {}, callback) => {
      try {
        ack(callback, { ok: true, data: await action(payload) });
      } catch (error) {
        if (!(error instanceof PartyRoomError)) {
          console.error(`Erro no evento Socket.io "${event}":`, error);
        }
        ack(callback, {
          ok: false,
          error: error instanceof PartyRoomError ? error.message : "Erro ao processar a sala."
        });
      }
    });

    handle("room:list", async () => service.list(userId));
    handle("room:resume", async () => {
      const rooms = await service.roomsForUser(userId);
      for (const room of rooms) socket.join(channel(room.id));
      return rooms;
    });
    handle("room:create", async ({ name, coverPublicId, roomIcon }) => {
      const { room, leftRooms } = await service.create(userId, name, coverPublicId, roomIcon);
      await publishMembershipChanges(leftRooms);
      socket.join(channel(room.id));
      emitDirectory("created", room);
      return room;
    });
    handle("room:join", async ({ roomId }) => {
      const { room, joined, leftRooms } = await service.join(roomId, userId);
      await publishMembershipChanges(leftRooms);
      socket.join(channel(room.id));
      if (!joined) return { room, joined };
      emitRoom(room);
      io.to(channel(room.id)).emit("room:participants", room.participants);
      socket.to(channel(room.id)).emit("room:system", {
        type: "joined",
        username: room.participants.find(participant => participant.userId === String(userId))?.username || "Usuário",
        createdAt: new Date()
      });
      emitDirectory("updated", room);
      return { room, joined };
    });
    handle("room:leave", async ({ roomId }) => {
      const result = await service.leave(roomId, userId);
      removeBasketballPresence(roomId, userId);
      stopTyping(roomId);
      if (socket.data.partyCursorRoomId === roomId) {
        io.to(channel(roomId)).emit("party:cursor:leave", { cursorId: socket.id });
        socket.data.partyCursorRoomId = null;
      }
      socket.leave(channel(roomId));
      if (result.deleted) {
        io.emit("room:directory", { action: "deleted", roomId });
      } else {
        emitRoom(result.room);
        io.to(channel(roomId)).emit("room:participants", result.room.participants);
        io.to(channel(roomId)).emit("room:system", { type: "left", createdAt: new Date() });
        emitDirectory("updated", result.room);
      }
      return result;
    });
    handle("room:messages:list", async ({ roomId }) => service.messages(roomId, userId));
    socket.on("room:typing", async ({ roomId, isTyping } = {}) => {
      if (typeof roomId !== "string" || !roomId ||
          typeof isTyping !== "boolean" ||
          !socket.rooms.has(channel(roomId))) return;
      try {
        await service.requireParticipant(roomId, userId);
      } catch (error) {
        if (!(error instanceof PartyRoomError)) {
          console.error("Não foi possível validar a digitação na Party Room:", error);
        }
        stopTyping(roomId);
        return;
      }
      if (!isTyping) {
        stopTyping(roomId);
        return;
      }
      if (!socket.data.typingRooms) socket.data.typingRooms = new Set();
      if (!socket.data.typingRooms.has(roomId)) {
        socket.data.typingRooms.add(roomId);
        socket.to(channel(roomId)).emit("room:typing", {
          roomId,
          userId,
          username: socket.data.username,
          isTyping: true
        });
      }
      clearTimeout(typingTimers.get(roomId));
      typingTimers.set(roomId, setTimeout(() => stopTyping(roomId), 3000));
    });
    handle("room:message", async ({ roomId, text }) => {
      const message = await service.message(roomId, userId, text);
      io.to(channel(roomId)).emit("room:message", message);
      return message;
    });
    handle("room:image", async ({ roomId, publicId }) => {
      const message = await service.imageMessage(roomId, userId, publicId);
      io.to(channel(roomId)).emit("room:message", message);
      return message;
    });
    handle("party:update", async ({ roomId, config }) => {
      const room = await service.updateParty(roomId, userId, config);
      emitRoom(room);
      io.to(channel(roomId)).emit("party:update", { room });
      emitDirectory("updated", room);
      return room;
    });
    handle("party:invite", async ({ roomId, recipientId }) => {
      const invitation = await service.invite(roomId, userId, recipientId);
      io.to(userChannel(invitation.recipientId)).emit("notification:new", invitation.notification);
      return { ok: true };
    });
    handle("party:room-preview", async ({ roomId }) => {
      const room = await service.get(roomId);
      if (room.state !== "waiting") throw new PartyRoomError("Essa sala não está mais aceitando convites.", 409);
      if (room.participants.length >= room.maxUsers) throw new PartyRoomError("Essa sala está cheia.", 409);
      return room;
    });
    handle("party:start", async ({ roomId }) => engine.start(roomId, userId));
    handle("party:leave-game", async ({ roomId }) => engine.leaveGame(roomId, userId));
    handle("party:game-finish", async ({ roomId }) => engine.finishGame(roomId, userId));
    handle("party:end", async ({ roomId }) => engine.endNow(roomId, userId));
    handle("party:game-action", async ({ roomId, action, payload }) =>
      engine.handleGameAction(roomId, userId, action, payload, {
        serializeActions: action === "shoot"
      }));
    handle("party:state", async ({ roomId }) => {
      const state = await engine.getPartyState(roomId, userId);
      socket.join(channel(roomId));
      return state;
    });
    handle("party:cursor:join", async ({ roomId }) => {
      await service.requireParticipant(roomId, userId);
      const previousRoomId = socket.data.partyCursorRoomId;
      if (previousRoomId && previousRoomId !== roomId) {
        io.to(channel(previousRoomId)).emit("party:cursor:leave", { cursorId: socket.id });
      }
      socket.join(channel(roomId));
      socket.data.partyCursorRoomId = roomId;
      socket.data.lastCursorUpdateAt = 0;
      return { roomId };
    });

    handle("party:basketball:join", async ({ roomId }) => {
      const room = await service.requireParticipant(roomId, userId);
      const game = room.currentParty?.selectedGames?.[room.currentParty.currentGameIndex];
      if (room.state !== "party_running" || room.currentParty?.roundFinishAt || game?.id !== "basketball") {
        throw new PartyRoomError("Cesta Certa não está em andamento.", 409);
      }
      socket.join(channel(roomId));
      socket.data.basketballRoomId = roomId;
      return Array.from(basketballPlayers.get(roomId)?.values() || []);
    });

    socket.on("party:basketball:state", payload => {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
      const { roomId, x, ball } = payload;
      if (typeof roomId !== "string" || roomId !== socket.data.basketballRoomId ||
          !socket.rooms.has(channel(roomId)) ||
          !Number.isFinite(x) || x < 0 || x > 1 ||
          !ball || typeof ball !== "object" ||
          !Number.isFinite(ball.x) || ball.x < 0 || ball.x > 1 ||
          !Number.isFinite(ball.y) || ball.y < 0 || ball.y > 1) return;
      const now = Date.now();
      if (now - (socket.data.lastBasketballStateAt || 0) < 40) return;
      socket.data.lastBasketballStateAt = now;
      let players = basketballPlayers.get(roomId);
      if (!players) {
        players = new Map();
        basketballPlayers.set(roomId, players);
      }
      const presence = { roomId, userId, username: socket.data.username, x, ball };
      players.set(userId, presence);
      socket.to(channel(roomId)).emit("party:basketball:state", presence);
    });

    socket.on("party:basketball:leave", () => {
      const roomId = socket.data.basketballRoomId;
      if (!roomId) return;
      removeBasketballPresence(roomId, userId);
      socket.data.basketballRoomId = null;
    });

    socket.on("party:cursor:move", ({ x, y } = {}) => {
      const roomId = socket.data.partyCursorRoomId;
      if (!roomId || !socket.rooms.has(channel(roomId)) ||
          !Number.isFinite(x) || !Number.isFinite(y) ||
          x < 0 || x > 1 || y < 0 || y > 1) return;
      const now = Date.now();
      if (now - socket.data.lastCursorUpdateAt < 30) return;
      socket.data.lastCursorUpdateAt = now;
      socket.to(channel(roomId)).emit("party:cursor:move", {
        cursorId: socket.id,
        userId,
        username: socket.data.username,
        x,
        y
      });
    });

    socket.on("party:cursor:hide", () => {
      const roomId = socket.data.partyCursorRoomId;
      if (!roomId || !socket.rooms.has(channel(roomId))) return;
      socket.to(channel(roomId)).emit("party:cursor:leave", { cursorId: socket.id });
    });

    socket.on("party:cursor:leave", () => {
      const roomId = socket.data.partyCursorRoomId;
      if (!roomId) return;
      io.to(channel(roomId)).emit("party:cursor:leave", { cursorId: socket.id });
      socket.data.partyCursorRoomId = null;
    });
    socket.on("disconnecting", () => {
      for (const roomId of socket.data.typingRooms || []) stopTyping(roomId);
    });
    socket.on("disconnect", () => {
      if (socket.data.basketballRoomId) {
        removeBasketballPresence(socket.data.basketballRoomId, userId);
      }
      const roomId = socket.data.partyCursorRoomId;
      if (roomId) {
        io.to(channel(roomId)).emit("party:cursor:leave", { cursorId: socket.id });
      }
    });
  });

  void engine.recoverActiveParties().catch(error => {
    console.error("Não foi possível recuperar os temporizadores das Party Rooms:", error);
  });
  return io;
}
