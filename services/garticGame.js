import { PartyRoomError } from "./partyRoomService.js";
import { GameModule, scorePartyPlacements } from "./gameModule.js";

const ROUND_COUNT = 5;
const ROUND_DURATION_MS = 90_000;
const RESULT_ADVANCE_MS = 5_000;
const MAX_MESSAGES = 40;
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 720;
const DRAWING_SHAPES = new Set(["square", "circle", "triangle", "line"]);
const WORDS = Object.freeze([
  "CASA", "GATO", "ÁRVORE", "PIZZA", "CARRO", "SOL", "PEIXE", "AVIÃO",
  "SORVETE", "BICICLETA", "CHUVA", "FUTEBOL", "CELULAR", "BOLO", "FLOR",
  "ÓCULOS", "GUITARRA", "TARTARUGA", "COMPUTADOR", "GUARDA-CHUVA",
  "ELEFANTE", "ABACAXI", "CASTELO", "RELÓGIO", "BORBOLETA", "PRAIA",
  "FOGUETE", "PIPOCA", "DINOSSAURO", "CHAPÉU", "PANDA", "MONTANHA",
  "CACHORRO", "LUA", "ESTRELA", "ÔNIBUS", "CHAVE", "PRESENTE", "LIVRO",
  "BOLA", "CORAÇÃO", "PIRATA", "ROBÔ", "GELADEIRA", "PENTE", "SAPATO",
  "CENOURA", "TELESCÓPIO", "PONTE", "VULCÃO", "FANTASMA", "ABÓBORA",
  "ESCOVA", "VIOLÃO", "BONECO", "CAFÉ", "TRAVESSEIRO", "FOCA", "NAVIO",
  "CUPCAKE", "MÁGICO", "IGREJA", "TREM", "MELANCIA", "PISCINA",
  "CAVALO", "VACA", "PORCO", "GALINHA", "PATO", "COELHO", "MACACO",
  "LEÃO", "TIGRE", "URSO", "ZEBRA", "GIRAFA", "CAMELO", "CANGURU",
  "PINGUIM", "GOLFINHO", "BALEIA", "TUBARÃO", "SAPO", "CORUJA",
  "MESA", "CADEIRA", "SOFÁ", "CAMA", "LÂMPADA", "VENTILADOR", "TELEVISÃO",
  "RÁDIO", "TELEFONE", "TECLADO", "MOUSE", "IMPRESSORA", "ESPELHO",
  "MOCHILA", "LÁPIS", "CANETA", "TESOURA", "BORRACHA", "PANELA", "COLHER",
  "MAÇÃ", "BANANA", "LARANJA", "UVA", "MORANGO", "LIMÃO", "PERA",
  "MANGA", "ABACATE", "COCO", "PÃO", "QUEIJO", "OVO", "LEITE",
  "HAMBÚRGUER", "SANDUÍCHE", "MACARRÃO", "ARROZ", "FEIJÃO", "BATATA",
  "FLORESTA", "DESERTO", "ILHA", "CACHOEIRA", "RIO", "LAGO", "MAR",
  "NUVEM", "ARCO-ÍRIS", "RAIO", "NEVE", "FOGO", "GELO", "AREIA",
  "PEDRA", "CAVERNA", "JARDIM", "FAZENDA", "ESCOLA", "HOSPITAL",
  "COROA", "ESPADA", "ESCUDO", "BALÃO", "PIPA", "VELA", "BONECA",
  "CARRINHO", "TAMBOR", "FLAUTA", "MICROFONE", "CÂMERA", "CHINELO",
  "MEIA", "CAMISA", "CALÇA", "JAQUETA", "BOTA", "ANEL"
]);
const serializeId = value => String(value);

function normalizeGuess(value) {
  return value.normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]/g, "");
}

function currentDrawingOps(round) {
  return Array.isArray(round?.drawingOps) ? round.drawingOps : [];
}

function currentMessages(round) {
  return Array.isArray(round?.messages) ? round.messages : [];
}

function chooseWord(usedWords, random) {
  const available = WORDS.filter(word => !usedWords.includes(word));
  const words = available.length ? available : WORDS;
  const index = Math.min(words.length - 1, Math.floor(random() * words.length));
  return words[index];
}

function createRound(roundNumber, players, usedWords, now, random) {
  const word = chooseWord(usedWords, random);
  usedWords.push(word);
  const drawer = players[(roundNumber - 1) % players.length];
  return {
    roundNumber,
    drawerUserId: drawer.userId,
    word,
    startedAt: now,
    deadlineAt: new Date(now.getTime() + ROUND_DURATION_MS),
    guessedUserIds: [],
    drawingRevision: 0,
    drawingOps: [],
    messages: [],
    messageSequence: 0,
    result: null,
    resultAdvanceAt: null
  };
}

function pushMessage(round, message) {
  round.messageSequence = (round.messageSequence || 0) + 1;
  const messages = currentMessages(round);
  messages.push({ ...message, sequence: round.messageSequence });
  if (messages.length > MAX_MESSAGES) messages.splice(0, messages.length - MAX_MESSAGES);
  round.messages = messages;
  return messages.at(-1);
}

function resolveRound(state, round, now, reason) {
  if (round.result) return;
  round.result = {
    roundNumber: round.roundNumber,
    drawerUserId: round.drawerUserId,
    word: round.word,
    guessedUserIds: [...(round.guessedUserIds || [])],
    reason
  };
  round.deadlineAt = null;
  round.resultAdvanceAt = new Date(now.getTime() + RESULT_ADVANCE_MS);
  const drawer = state.players.find(player => player.userId === round.drawerUserId);
  const guessedNames = round.result.guessedUserIds
    .map(userId => state.players.find(player => player.userId === userId)?.username)
    .filter(Boolean);
  state.message = reason === "all-guessed"
    ? "Todos acertaram! A próxima rodada vai começar."
    : guessedNames.length
      ? "O tempo acabou! A palavra foi revelada."
      : "O tempo acabou. Ninguém acertou a palavra.";
  pushMessage(round, {
    type: "system",
    username: "Rabisco",
    text: `${drawer?.username || "O desenhista"} desenhou "${round.word}".${guessedNames.length ? ` Acertaram: ${guessedNames.join(", ")}.` : ""}`
  });
}

function publicRound(round, players) {
  const drawer = players.find(player => player.userId === round.drawerUserId);
  const guessedUserIds = round.guessedUserIds || [];
  const wordMask = round.word.split("").map(character =>
    /\p{L}/u.test(character) ? "_" : character
  ).join(" ");
  return {
    roundNumber: round.roundNumber,
    drawerUserId: round.drawerUserId,
    drawerName: drawer?.username || "Desenhista",
    startedAt: round.startedAt,
    deadlineAt: round.deadlineAt,
    wordMask,
    wordLength: [...round.word].filter(character => /\p{L}/u.test(character)).length,
    guessedUserIds,
    drawingRevision: round.drawingRevision || 0,
    drawingOps: currentDrawingOps(round),
    lastDrawingOp: round.lastDrawingOp || null,
    messages: currentMessages(round),
    result: round.result,
    resultAdvanceAt: round.resultAdvanceAt
  };
}

export class GarticGameModule extends GameModule {
  constructor({ random = Math.random } = {}) {
    super({ id: "gartic", name: "Rabisco" });
    this.random = random;
  }

  async validateStart({ participants }) {
    if (participants.length < 2) {
      throw new PartyRoomError("Rabisco precisa de pelo menos 2 jogadores.");
    }
    if (participants.length > 8) {
      throw new PartyRoomError("Rabisco aceita no máximo 8 jogadores.");
    }
  }

  async start({ participants, now = () => new Date() }) {
    const players = participants.map(participant => ({
      userId: serializeId(participant.userId),
      username: participant.username,
      points: 0,
      correctGuesses: 0,
      drawingRounds: 0
    }));
    const usedWords = [];
    const currentRound = createRound(1, players, usedWords, now(), this.random);
    players.find(player => player.userId === currentRound.drawerUserId).drawingRounds += 1;
    return {
      mode: this.id,
      players,
      usedWords,
      roundHistory: [],
      currentRound,
      gameOver: false,
      message: "Descubra a palavra! O desenhista tem 90 segundos."
    };
  }

  async handleAction(
    { participant, state, serverAction = false, now = () => new Date() },
    { action, payload }
  ) {
    if (!state || state.mode !== this.id || state.gameOver || !state.currentRound) {
      throw new PartyRoomError("Rabisco não está recebendo ações.", 409);
    }
    const round = state.currentRound;
    const userId = serializeId(participant.userId);
    const player = state.players.find(candidate => candidate.userId === userId);
    if (!player) throw new PartyRoomError("Você não participa desta partida.", 403);
    if (!payload || (!serverAction && payload.roundNumber !== round.roundNumber)) {
      throw new PartyRoomError("Essa ação pertence a uma rodada anterior.", 409);
    }

    if (action === "draw" || action === "clear" || action === "undo") {
      if (serverAction) throw new PartyRoomError("Ação de desenho reservada aos jogadores.", 403);
      if (round.result) throw new PartyRoomError("A rodada já terminou.", 409);
      if (new Date(round.deadlineAt).getTime() <= now().getTime()) {
        throw new PartyRoomError("O tempo acabou. A palavra será revelada.", 409);
      }
      if (userId !== round.drawerUserId) {
        throw new PartyRoomError("Somente o desenhista da vez pode alterar o desenho.", 403);
      }
      if (action === "clear") {
        const drawingOps = currentDrawingOps(round);
        round.drawingRevision = (round.drawingRevision || 0) + 1;
        const operation = { type: "clear", revision: round.drawingRevision };
        drawingOps.push(operation);
        round.drawingOps = drawingOps;
        round.lastDrawingOp = operation;
      } else if (action === "undo") {
        const drawingOps = currentDrawingOps(round);
        if (!drawingOps.length) throw new PartyRoomError("Não há ações para desfazer.", 409);
        drawingOps.pop();
        round.drawingRevision = (round.drawingRevision || 0) + 1;
        round.drawingOps = drawingOps;
        round.lastDrawingOp = { type: "undo", revision: round.drawingRevision };
      } else {
        const { points, color, size, eraser, shape = null } = payload;
        const isShape = shape !== null;
        if (!Array.isArray(points) || points.length < 2 ||
            (isShape ? points.length !== 2 || !DRAWING_SHAPES.has(shape) : points.length > 32) ||
            (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) ||
            !Number.isSafeInteger(size) || size < 2 || size > 32 ||
            typeof eraser !== "boolean" ||
            (eraser && (isShape || color !== "#ffffff")) ||
            points.some(point =>
              !Array.isArray(point) || point.length !== 2 ||
              !Number.isSafeInteger(point[0]) || point[0] < 0 || point[0] > CANVAS_WIDTH ||
              !Number.isSafeInteger(point[1]) || point[1] < 0 || point[1] > CANVAS_HEIGHT
            )) {
          throw new PartyRoomError("Traço de desenho inválido.");
        }
        const drawingOps = currentDrawingOps(round);
        round.drawingRevision = (round.drawingRevision || 0) + 1;
        const operation = {
          type: "stroke",
          revision: round.drawingRevision,
          points,
          color,
          size,
          eraser,
          shape
        };
        drawingOps.push(operation);
        round.drawingOps = drawingOps;
        round.lastDrawingOp = operation;
      }
    } else if (action === "guess") {
      if (serverAction) throw new PartyRoomError("Palpites são reservados aos jogadores.", 403);
      if (round.result) throw new PartyRoomError("A rodada já terminou.", 409);
      if (new Date(round.deadlineAt).getTime() <= now().getTime()) {
        throw new PartyRoomError("O tempo acabou. A palavra será revelada.", 409);
      }
      if (userId === round.drawerUserId) {
        throw new PartyRoomError("O desenhista não pode enviar palpites.", 403);
      }
      if (round.guessedUserIds.includes(userId)) {
        throw new PartyRoomError("Você já acertou esta rodada.", 409);
      }
      const guess = typeof payload.guess === "string" ? payload.guess.trim() : "";
      if (!guess || guess.length > 100) throw new PartyRoomError("Digite um palpite de até 100 caracteres.");
      const correct = normalizeGuess(guess) === normalizeGuess(round.word);
      if (correct) {
        const place = round.guessedUserIds.length;
        const guessPoints = Math.max(25, 100 - place * 20);
        round.guessedUserIds.push(userId);
        player.points += guessPoints;
        player.correctGuesses += 1;
        const drawer = state.players.find(candidate => candidate.userId === round.drawerUserId);
        drawer.points += 25;
        pushMessage(round, {
          type: "correct",
          userId,
          username: player.username,
          text: `acertou a palavra e ganhou ${guessPoints} pontos!`
        });
        state.message = `${player.username} acertou!`;
        const eligibleGuessers = state.players.length - 1;
        if (round.guessedUserIds.length === eligibleGuessers) {
          resolveRound(state, round, now(), "all-guessed");
        }
      } else {
        pushMessage(round, {
          type: "guess",
          userId,
          username: player.username,
          text: guess
        });
        state.message = `${player.username} enviou um palpite.`;
      }
    } else if (action === "timeout") {
      if (!serverAction) throw new PartyRoomError("Ação de tempo reservada ao servidor.", 403);
      if (round.result || new Date(round.deadlineAt).getTime() > now().getTime()) {
        throw new PartyRoomError("A rodada ainda não chegou ao limite de tempo.", 409);
      }
      resolveRound(state, round, now(), "timeout");
    } else if (action === "advance") {
      if (!serverAction) throw new PartyRoomError("Ação de avanço reservada ao servidor.", 403);
      if (!round.result || new Date(round.resultAdvanceAt).getTime() > now().getTime()) {
        throw new PartyRoomError("A rodada ainda está exibindo o resultado.", 409);
      }
      state.roundHistory.push(round.result);
      if (round.roundNumber >= ROUND_COUNT) {
        state.currentRound = null;
        state.gameOver = true;
        state.message = "As cinco rodadas terminaram!";
      } else {
        const nextRound = createRound(
          round.roundNumber + 1,
          state.players,
          state.usedWords || [],
          now(),
          this.random
        );
        state.players.find(playerState => playerState.userId === nextRound.drawerUserId).drawingRounds += 1;
        state.currentRound = nextRound;
        state.message = `Rodada ${nextRound.roundNumber}: ${nextRound.drawerName || state.players.find(candidate => candidate.userId === nextRound.drawerUserId).username} vai desenhar.`;
      }
    } else {
      throw new PartyRoomError("Ação inválida para Rabisco.");
    }

    const update = this.getClientUpdate({ state });
    return {
      state,
      update,
      finished: state.gameOver,
      privateStateChanged: action === "advance" && !state.gameOver
    };
  }

  async handlePlayerLeave({ state, userId, now = () => new Date() }) {
    const playerId = serializeId(userId);
    state.players = state.players.filter(player => player.userId !== playerId);
    if (!state.currentRound) return state;
    if (state.currentRound.drawerUserId === playerId && !state.currentRound.result) {
      resolveRound(state, state.currentRound, now(), "drawer-left");
    } else if (!state.currentRound.result) {
      const eligibleGuessers = state.players.length - 1;
      if (state.currentRound.guessedUserIds.length >= eligibleGuessers) {
        resolveRound(state, state.currentRound, now(), "all-guessed");
      }
    }
    return state;
  }

  getScheduledAction({ state }) {
    const round = state?.currentRound;
    if (!round) return null;
    if (round.result && round.resultAdvanceAt) {
      return { action: "advance", at: round.resultAdvanceAt };
    }
    if (!round.result && round.deadlineAt) {
      return { action: "timeout", at: round.deadlineAt };
    }
    return null;
  }

  getClientUpdate({ state }) {
    const clientState = this.getClientState({ state });
    const round = clientState.currentRound;
    if (round) {
      const lastMessage = round.messages.at(-1) || null;
      const {
        drawingOps,
        messages,
        ...roundUpdate
      } = round;
      return {
        ...clientState,
        currentRound: { ...roundUpdate, lastMessage }
      };
    }
    return clientState;
  }

  getClientState({ state, userId }) {
    if (!state || state.mode !== this.id || !Array.isArray(state.players)) return null;
    const round = state.currentRound;
    const ownId = userId ? serializeId(userId) : "";
    return {
      gameId: this.id,
      mode: this.id,
      players: state.players.map(player => ({
        userId: player.userId,
        username: player.username,
        points: player.points,
        correctGuesses: player.correctGuesses,
        drawingRounds: player.drawingRounds
      })),
      roundHistory: state.roundHistory,
      currentRound: round ? {
        ...publicRound(round, state.players),
        secretWord: ownId === round.drawerUserId && !round.result ? round.word : null
      } : null,
      gameOver: state.gameOver,
      message: state.message
    };
  }

  async finish({ state }) {
    if (!state?.gameOver || state.roundHistory.length !== ROUND_COUNT) {
      throw new PartyRoomError("As cinco rodadas de Rabisco ainda não terminaram.", 409);
    }
    return { roundsPlayed: state.roundHistory.length };
  }

  async calculateScores({ participants, state }) {
    const players = [...state.players].sort((left, right) => right.points - left.points);
    if (!players.length || players[0].points === 0) {
      return scorePartyPlacements(participants, []);
    }
    const placementGroups = [];
    for (let index = 0; index < players.length;) {
      const points = players[index].points;
      const tiedPlayers = [];
      while (index < players.length && players[index].points === points) {
        tiedPlayers.push(players[index].userId);
        index += 1;
      }
      placementGroups.push(tiedPlayers);
    }
    return scorePartyPlacements(participants, placementGroups);
  }
}

export const GARTIC_TIMINGS = Object.freeze({
  roundCount: ROUND_COUNT,
  roundDurationMs: ROUND_DURATION_MS,
  resultAdvanceMs: RESULT_ADVANCE_MS
});
