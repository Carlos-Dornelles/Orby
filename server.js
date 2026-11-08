import express from "express";
import { createServer } from "http";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { Chess } from "chess.js";
import { compare as comparePassword, hash as hashPassword } from "bcryptjs";
import { v2 as cloudinary } from "cloudinary";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import connectDB from "./DB.js";
import {
  dataPedidosFazenda,
  FARM_PEDIDOS_DIARIOS_MAX,
  gerarPedidosDiarios
} from "./farmpedidos.js";
import {
  calcularPrecoProximoCanteiro,
  calcularPrecoVendaRapidaOrbs,
  FARM_PRECO_ADUBO,
  FARM_ITENS_INVENTARIO,
  FARM_PRECOS
} from "./FarmPreços.js";
import {
  criarSessaoOrb,
  descriptografarChaveGemini,
  criptografarChaveGemini,
  gerarRespostaGemini,
  OrbAiError,
  validarSessaoOrb,
  verificarConfiguracaoOrb
} from "./orb-ia.js";
import { criarInstrucaoOrbIA } from "./ensinoRobo.js";
import { createPartyRoomService } from "./services/partyRoomService.js";
import { createDefaultGameManager } from "./services/gameManager.js";
import { createPartyRoomController } from "./controllers/partyRoomController.js";
import { createPartyRoomRouter } from "./routes/partyRooms.js";
import { attachPartyRoomSocket } from "./sockets/partyRoomSocket.js";
import { PartyRoom } from "./models/PartyRoom.js";
import { PartySession } from "./models/PartySession.js";

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const BCRYPT_ROUNDS = 12;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const IDS_CRIPTOMOEDAS_COIN_GECKO = Object.freeze({
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple"
});
const SIMBOLOS_MOEDAS_YAHOO = Object.freeze({
  USD: "USDBRL=X",
  EUR: "EURBRL=X",
  GBP: "GBPBRL=X",
  JPY: "JPYBRL=X",
  CAD: "CADBRL=X",
  AUD: "AUDBRL=X",
  CHF: "CHFBRL=X",
  CNY: "CNYBRL=X",
  ZAR: "ZARBRL=X",
  MXN: "MXNBRL=X"
});
const CACHE_COTACOES_CRIPTO_TTL_MS = 30 * 60 * 1000;
const cacheCotacoesCripto = new Map();
const requisicoesCotacoesCripto = new Map();
const cacheCotacoesMoedas = new Map();
const requisicoesCotacoesMoedas = new Map();
let filaRequisicoesCoinGecko = Promise.resolve();
let ultimaRequisicaoCoinGecko = 0;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function buscarCoinGecko(url) {
  const requisicao = filaRequisicoesCoinGecko.then(async () => {
    const intervaloRestante = 2000 - (Date.now() - ultimaRequisicaoCoinGecko);
    if (intervaloRestante > 0) {
      await new Promise(resolve => setTimeout(resolve, intervaloRestante));
    }
    ultimaRequisicaoCoinGecko = Date.now();
    return fetch(url, { signal: AbortSignal.timeout(12000) });
  });
  filaRequisicoesCoinGecko = requisicao.catch(() => undefined);
  return requisicao;
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const tarefaSchema = new mongoose.Schema({
  texto: { type: String, required: true, trim: true, maxlength: 300 },
  concluida: { type: Boolean, default: false },
  dataCriacao: { type: Date, required: true },
  dataConclusao: { type: Date, default: null },
  notificadoEm: { type: Date, default: null },
  recorrente: { type: Boolean, default: false },
  cor: { type: String, default: null },
  ordem: { type: Number, default: null }
});

const avisoAdminSchema = new mongoose.Schema({
  titulo: { type: String, required: true, trim: true, maxlength: 120 },
  mensagem: { type: String, required: true, trim: true, maxlength: 2000 },
  videoUrl: { type: String, default: "", maxlength: 2048 },
  criadoEm: { type: Date, required: true, default: Date.now }
}, { versionKey: false });
const AvisoAdmin = mongoose.models.AvisoAdmin ||
  mongoose.model("AvisoAdmin", avisoAdminSchema, "AVISOS_ADMIN");

const feedbackSchema = new mongoose.Schema({
  tipo: { type: String, enum: ["sugestao", "melhoria", "bug"], required: true },
  mensagem: { type: String, required: true, trim: true, maxlength: 2000 },
  imagemPublicId: { type: String, default: "" },
  usuarioId: { type: mongoose.Schema.Types.ObjectId, required: true },
  usuarioNome: { type: String, default: "" },
  usuarioEmail: { type: String, default: "" },
  criadoEm: { type: Date, required: true, default: Date.now }
}, { versionKey: false });
const FeedbackUsuario = mongoose.models.FeedbackUsuario ||
  mongoose.model("FeedbackUsuario", feedbackSchema, "FEEDBACK_USUARIOS");

function extrairIdVideoYoutube(valor) {
  if (typeof valor !== "string" || !valor) return "";
  try {
    const url = new URL(valor);
    if (url.protocol !== "https:") return "";
    const host = url.hostname.toLowerCase();
    let videoId = "";
    if (host === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] || "";
    } else if (["youtube.com", "www.youtube.com", "m.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
      else videoId = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1] || "";
    }
    return /^[A-Za-z0-9_-]{11}$/.test(videoId) ? videoId : "";
  } catch {
    return "";
  }
}

function urlCanonicaYoutube(videoId) {
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : "";
}

const notificacaoSchema = new mongoose.Schema({
  titulo: { type: String, required: true },
  texto: { type: String, required: true },
  tarefaId: { type: String, default: "" },
  partidaId: { type: String, default: "" },
  partyRoomId: { type: String, default: "" },
  ratingValendo: { type: Boolean, default: false },
  tipo: { type: String, enum: ["diaria", "importante", "habito", "xadrez_convite", "xadrez_lance", "orby_party_convite", "usuario_mensagem", "usuario_tremida", "fazenda"], required: true },
  remetenteId: { type: String, default: "" },
  remetenteNome: { type: String, default: "" },
  criadaEm: { type: Date, required: true },
  expiraEm: { type: Date, required: true },
  lida: { type: Boolean, default: false }
}, { timestamps: false });

const pushTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, maxlength: 4096 },
  registeredAt: { type: Date, required: true }
}, { _id: false });

const postSchema = new mongoose.Schema({
  titulo: { type: String, required: true, trim: true, maxlength: 100 },
  descricao: { type: String, trim: true, maxlength: 2000, default: "" },
  cor: { type: String, required: true, match: /^#[0-9a-fA-F]{6}$/ },
  x: { type: Number, required: true, min: 0, max: 10000, default: 16 },
  y: { type: Number, required: true, min: 0, max: 10000, default: 16 },
  largura: { type: Number, required: true, min: 180, max: 900, default: 240 },
  altura: { type: Number, required: true, min: 130, max: 1000, default: 160 }
});

const folhaCadernoSchema = new mongoose.Schema({
  titulo: { type: String, required: true, trim: true, maxlength: 100 },
  conteudo: { type: String, maxlength: 8000, default: "" },
  pauta: { type: String, enum: ["linhas", "quadriculada", "pontilhada", "sem-pauta"], default: "linhas" },
  corPauta: { type: String, match: /^#[0-9a-fA-F]{6}$/, default: "#e3e8e5" },
  espacamentoPauta: { type: Number, min: 24, max: 48, default: 32 },
  criadaEm: { type: Date, required: true, default: Date.now },
  atualizadaEm: { type: Date, required: true, default: Date.now }
});

const itemListaSchema = new mongoose.Schema({
  texto: { type: String, required: true, trim: true, maxlength: 300 },
  concluido: { type: Boolean, default: false },
  criadoEm: { type: Date, required: true, default: Date.now }
});

const listaSchema = new mongoose.Schema({
  nome: { type: String, required: true, trim: true, maxlength: 100 },
  tipo: { type: String, enum: ["simples", "data", "recorrente"], default: "simples" },
  dataFinal: { type: String, default: "" },
  recorrencia: { type: String, enum: ["diaria", "semanal", "mensal", "dia_mes"], default: "diaria" },
  diaRecorrencia: { type: Number, default: null },
  periodoRecorrencia: { type: String, default: "" },
  fusoHorario: { type: String, required: true, default: "UTC" },
  itens: { type: [itemListaSchema], default: [] },
  criadaEm: { type: Date, required: true, default: Date.now }
});

const plantacaoFazendaSchema = new mongoose.Schema({
  cultura: { type: String, enum: [...Object.keys(FARM_PRECOS), null], default: null },
  plantadoEm: { type: Date, default: null },
  amadureceEm: { type: Date, default: null },
  notificacaoProntaEnviadaEm: { type: Date, default: null },
  adubada: { type: Boolean, default: false },
  estado: { type: String, enum: ["vazio", "crescendo"], default: "vazio" }
}, { _id: false });

const anuncioTrigoSchema = new mongoose.Schema({
  item: { type: String, enum: FARM_ITENS_INVENTARIO, default: "trigo" },
  quantidadeOriginal: { type: Number, min: 1, required: true },
  quantidadeRestante: { type: Number, min: 0, required: true },
  precoTotal: { type: Number, min: 1 },
  precoUnitario: { type: Number, min: 1 },
  status: { type: String, enum: ["ativo", "vendido", "cancelado"], default: "ativo" },
  criadoEm: { type: Date, required: true, default: Date.now }
});

const pedidoConcluidoFazendaSchema = new mongoose.Schema({
  id: { type: String, required: true },
  item: { type: String, required: true },
  quantidade: { type: Number, required: true },
  recompensaOrbs: { type: Number, required: true },
  concluidoEm: { type: Date, required: true }
}, { _id: false });

const pedidoDiarioFazendaSchema = new mongoose.Schema({
  id: { type: String, required: true },
  item: { type: String, required: true },
  quantidade: { type: Number, required: true },
  recompensaOrbs: { type: Number, required: true }
}, { _id: false });

const fazendaSchema = new mongoose.Schema({
  inicializada: { type: Boolean, default: false },
  orbs: { type: Number, min: 0, default: 0 },
  inventario: Object.fromEntries(FARM_ITENS_INVENTARIO.map(item => [
    item,
    { type: Number, min: 0, default: 0 }
  ])),
  plantacao: { type: plantacaoFazendaSchema, default: () => ({}) },
  canteiros: { type: [plantacaoFazendaSchema], default: undefined },
  adubos: { type: Number, min: 0, default: 0 },
  notificacoesHabilitadas: { type: Boolean, default: true },
  pedidosData: { type: String, default: "" },
  pedidosDiarios: { type: [pedidoDiarioFazendaSchema], default: [] },
  pedidosConcluidos: { type: [pedidoConcluidoFazendaSchema], default: [] },
  anuncios: { type: [anuncioTrigoSchema], default: [] }
}, { _id: false });

const operacaoMercadoFazendaSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  operationId: { type: String, required: true, maxlength: 36 },
  resultado: { type: mongoose.Schema.Types.Mixed, required: true },
  criadaEm: { type: Date, required: true, default: Date.now }
}, { collection: "FAZENDA_MERCADO_OPERACOES" });
operacaoMercadoFazendaSchema.index({ userId: 1, operationId: 1 }, { unique: true });

const FazendaMarketOperation = mongoose.models.FazendaMarketOperation ||
  mongoose.model("FazendaMarketOperation", operacaoMercadoFazendaSchema);

const habitoSchema = new mongoose.Schema({
  nome: { type: String, required: true, trim: true, maxlength: 100 },
  tipo: { type: String, enum: ["simples", "horarios", "objetivo"], default: "simples" },
  dataFinal: { type: String, default: "" },
  horario: { type: String, required: true, match: /^(?:[01]\d|2[0-3]):[0-5]\d$/ },
  horarios: { type: [String], default: [] },
  conclusoesHorarios: { type: [String], default: [] },
  lembretesEnviados: { type: [String], default: [] },
  fusoHorario: { type: String, required: true, default: "UTC" },
  diasConcluidos: { type: [String], default: [] },
  lembreteEnviadoEm: { type: String, default: "" }
});

const userSchema = new mongoose.Schema({
  nome: String,
  email: String,
  fotoPerfilPublicId: { type: String, default: "" },
  emailNormalizado: { type: String, unique: true, sparse: true },
  senha: { type: String, select: false },
  orbIaApiKeyCriptografada: { type: String, select: false },
  orbIaModeloAtual: { type: String, default: "" },
  tarefasDiarias: [tarefaSchema],
  tarefasImportantes: [tarefaSchema],
  habitos: [habitoSchema],
  posts: [postSchema],
  folhasCaderno: [folhaCadernoSchema],
  listas: [listaSchema],
  notificacoes: [notificacaoSchema],
  contatosNotificacoesRecentes: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  pushTokens: { type: [pushTokenSchema], default: [] },
  xadrezEstadoAtual: { type: mongoose.Schema.Types.Mixed, default: null },
  xadrezRating: { type: Number, default: 300, min: 0 },
  xadrezRatingDeviation: { type: Number, default: 350, min: 30, max: 350 },
  xadrezRatingLastPlayedAt: { type: Date, default: null },
  xadrezRatingPartidas: { type: [String], default: [] },
  fazenda: { type: fazendaSchema, default: undefined },
  preferencias: { type: mongoose.Schema.Types.Mixed, default: {} }
});

const User = mongoose.models.User || mongoose.model("User", userSchema, "USERS");
const partyRoomService = createPartyRoomService({ User });
const partyGameManager = createDefaultGameManager();

const chessMessageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  senderName: { type: String, required: true },
  text: { type: String, required: true, maxlength: 500 },
  createdAt: { type: Date, required: true }
}, { _id: true });

const chessGameSchema = new mongoose.Schema({
  jogadorBrancas: { type: mongoose.Schema.Types.ObjectId, required: true },
  jogadorPretas: { type: mongoose.Schema.Types.ObjectId, required: true },
  criador: { type: mongoose.Schema.Types.ObjectId, required: true },
  nomeBrancas: { type: String, required: true },
  nomePretas: { type: String, required: true },
  status: { type: String, enum: ["aguardando", "ativa", "finalizada", "recusada", "expirada", "substituida"], default: "aguardando" },
  pgn: { type: String, default: "" },
  fen: { type: String, default: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  resultado: { type: String, default: "*" },
  rated: { type: Boolean, default: false },
  ratingProcessadaEm: { type: Date, default: null },
  ratingDeltaBrancas: { type: Number, default: null },
  ratingDeltaPretas: { type: Number, default: null },
  ratingDesvioBrancas: { type: Number, default: null },
  ratingDesvioPretas: { type: Number, default: null },
  mensagens: { type: [chessMessageSchema], default: [] },
  analise: { type: mongoose.Schema.Types.Mixed, default: null },
  criadaEm: { type: Date, required: true },
  expiraEm: { type: Date, required: true },
  iniciadaEm: { type: Date, default: null },
  atualizadaEm: { type: Date, required: true }
}, { collection: "PARTIDAS_XADREZ" });

const ChessGame = mongoose.models.ChessGame || mongoose.model("ChessGame", chessGameSchema);

const CHESS_RATING_INITIAL = 300;
const CHESS_RATING_RD_INITIAL = 350;
const CHESS_RATING_SCALE = 173.7178;
const CHESS_RATING_MAX_GAIN_PER_GAME = 80;
const CHESS_RATING_MAX_LOSS_PER_GAME = 60;
const CHESS_STOCKFISH_RATING_MAX_GAIN = 50;
const CHESS_STOCKFISH_RATING_MAX_LOSS = 30;

function desvioRatingAtual(user, agora) {
  const rdAnterior = Number.isFinite(user?.xadrezRatingDeviation)
    ? user.xadrezRatingDeviation
    : CHESS_RATING_RD_INITIAL;
  const ultimoJogo = user?.xadrezRatingLastPlayedAt instanceof Date
    ? user.xadrezRatingLastPlayedAt
    : null;
  const periodosInativos = ultimoJogo
    ? Math.max(0, (agora.getTime() - ultimoJogo.getTime()) / (30 * 24 * 60 * 60 * 1000))
    : 0;
  return Math.min(CHESS_RATING_RD_INITIAL, Math.sqrt(rdAnterior ** 2 + (34.6 ** 2) * periodosInativos));
}

function calcularAtualizacaoGlicko(jogador, oponente, resultado, agora = new Date(), limites = {}) {
  const rating = Number.isFinite(jogador?.xadrezRating) ? jogador.xadrezRating : CHESS_RATING_INITIAL;
  const rd = desvioRatingAtual(jogador, agora);
  const mu = (rating - 1500) / CHESS_RATING_SCALE;
  const phi = rd / CHESS_RATING_SCALE;
  const opponentRating = Number.isFinite(oponente?.xadrezRating) ? oponente.xadrezRating : CHESS_RATING_INITIAL;
  const opponentRd = desvioRatingAtual(oponente, agora);
  const opponentMu = (opponentRating - 1500) / CHESS_RATING_SCALE;
  const opponentPhi = opponentRd / CHESS_RATING_SCALE;
  const g = 1 / Math.sqrt(1 + (3 * opponentPhi ** 2) / (Math.PI ** 2));
  const expected = 1 / (1 + Math.exp(-g * (mu - opponentMu)));
  const variance = 1 / (g ** 2 * expected * (1 - expected));
  const phiAfter = 1 / Math.sqrt((1 / phi ** 2) + (1 / variance));
  const muAfter = mu + phiAfter ** 2 * g * (resultado - expected);
  const ratingCalculado = Math.max(0, Math.round(1500 + CHESS_RATING_SCALE * muAfter));
  const deltaCalculado = ratingCalculado - rating;
  const limiteGanho = Number.isFinite(limites.maxGain) ? limites.maxGain : CHESS_RATING_MAX_GAIN_PER_GAME;
  const limitePerda = Number.isFinite(limites.maxLoss) ? limites.maxLoss : CHESS_RATING_MAX_LOSS_PER_GAME;
  const delta = Math.max(-rating, Math.max(-limitePerda, Math.min(limiteGanho, deltaCalculado)));
  return {
    rating,
    ratingAfter: rating + delta,
    delta,
    deviationAfter: Math.max(30, Math.round(CHESS_RATING_SCALE * phiAfter))
  };
}

async function inicializarRatingXadrez(userIds) {
  await User.bulkWrite(userIds.map(_id => ({
    updateOne: {
      filter: { _id, $or: [{ xadrezRating: { $exists: false } }, { xadrezRating: null }] },
      update: { $set: {
        xadrezRating: CHESS_RATING_INITIAL,
        xadrezRatingDeviation: CHESS_RATING_RD_INITIAL,
        xadrezRatingLastPlayedAt: null
      } }
    }
  })));
}

async function processarRatingPartida(partidaId) {
  const partida = await ChessGame.findOne({
    _id: partidaId,
    status: "finalizada",
    rated: true,
    resultado: { $in: ["1-0", "0-1", "1/2-1/2"] }
  }).select("jogadorBrancas jogadorPretas resultado rated ratingProcessadaEm ratingDeltaBrancas ratingDeltaPretas ratingDesvioBrancas ratingDesvioPretas");
  if (!partida) return null;

  const ids = [partida.jogadorBrancas, partida.jogadorPretas];
  await inicializarRatingXadrez(ids);
  let resultadoRating = partida;
  if (!resultadoRating.ratingProcessadaEm) {
    const [brancasAntes, pretasAntes] = await Promise.all(ids.map(id => User.findById(id).select(
      "xadrezRating xadrezRatingDeviation xadrezRatingLastPlayedAt"
    )));
    if (!brancasAntes || !pretasAntes) return null;

    const agora = new Date();
    const scoreBrancas = partida.resultado === "1-0" ? 1 : partida.resultado === "0-1" ? 0 : 0.5;
    const atualizacaoBrancas = calcularAtualizacaoGlicko(brancasAntes, pretasAntes, scoreBrancas, agora);
    const atualizacaoPretas = calcularAtualizacaoGlicko(pretasAntes, brancasAntes, 1 - scoreBrancas, agora);
    // Persist the exact result before applying it so a retry can safely finish either account.
    resultadoRating = await ChessGame.findOneAndUpdate({
      _id: partida._id,
      status: "finalizada",
      rated: true,
      ratingProcessadaEm: null
    }, {
      $set: {
        ratingProcessadaEm: agora,
        ratingDeltaBrancas: atualizacaoBrancas.delta,
        ratingDeltaPretas: atualizacaoPretas.delta,
        ratingDesvioBrancas: atualizacaoBrancas.deviationAfter,
        ratingDesvioPretas: atualizacaoPretas.deviationAfter
      }
    }, { returnDocument: "after" });
    if (!resultadoRating) {
      resultadoRating = await ChessGame.findById(partida._id).select(
        "jogadorBrancas jogadorPretas resultado rated ratingProcessadaEm ratingDeltaBrancas ratingDeltaPretas ratingDesvioBrancas ratingDesvioPretas"
      );
      if (!resultadoRating?.ratingProcessadaEm) return null;
    }
  }

  const dataRating = resultadoRating.ratingProcessadaEm;
  await User.bulkWrite([
    {
      updateOne: {
        filter: { _id: resultadoRating.jogadorBrancas, xadrezRatingPartidas: { $ne: String(resultadoRating._id) } },
        update: {
          $inc: { xadrezRating: resultadoRating.ratingDeltaBrancas },
          $set: { xadrezRatingDeviation: resultadoRating.ratingDesvioBrancas, xadrezRatingLastPlayedAt: dataRating },
          $addToSet: { xadrezRatingPartidas: String(resultadoRating._id) }
        },
        upsert: false
      }
    },
    {
      updateOne: {
        filter: { _id: resultadoRating.jogadorPretas, xadrezRatingPartidas: { $ne: String(resultadoRating._id) } },
        update: {
          $inc: { xadrezRating: resultadoRating.ratingDeltaPretas },
          $set: { xadrezRatingDeviation: resultadoRating.ratingDesvioPretas, xadrezRatingLastPlayedAt: dataRating },
          $addToSet: { xadrezRatingPartidas: String(resultadoRating._id) }
        },
        upsert: false
      }
    }
  ]);
  const [brancas, pretas] = await Promise.all(ids.map(id => User.findById(id).select("xadrezRating")));
  if (!brancas || !pretas) return null;
  return {
    brancas: { rating: brancas.xadrezRating, delta: resultadoRating.ratingDeltaBrancas },
    pretas: { rating: pretas.xadrezRating, delta: resultadoRating.ratingDeltaPretas }
  };
}

const chessLocalGameSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  gameId: { type: String, required: true },
  mode: { type: String, enum: ["local", "stockfish"], required: true },
  playerColor: { type: String, enum: ["w", "b", "both"], required: true },
  opponent: { type: String, required: true, maxlength: 120 },
  resultado: { type: String, enum: ["1-0", "0-1", "1/2-1/2"], required: true },
  moveCount: { type: Number, min: 0, max: 20000, required: true },
  rated: { type: Boolean, default: false },
  skillLevel: { type: Number, min: 1, max: 20, default: null },
  ratingDelta: { type: Number, default: null },
  ratingDeviationAfter: { type: Number, min: 30, max: 350, default: null },
  pgn: { type: String, default: "" },
  analise: { type: mongoose.Schema.Types.Mixed, default: null },
  playedAt: { type: Date, required: true }
}, { collection: "PARTIDAS_XADREZ_LOCAL" });
chessLocalGameSchema.index({ userId: 1, gameId: 1 }, { unique: true });
const ChessLocalGame = mongoose.models.ChessLocalGame ||
  mongoose.model("ChessLocalGame", chessLocalGameSchema);

function firebaseMessaging() {
  const existente = getApps().find(firebaseApp => firebaseApp.name === "orby-fcm");
  if (existente) return getMessaging(existente);

  const credenciaisJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!credenciaisJson) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não foi configurada no servidor.");
  }
  let credenciais;
  try {
    credenciais = JSON.parse(credenciaisJson);
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não contém um JSON válido.");
  }
  if (!credenciais.project_id || !credenciais.client_email || !credenciais.private_key) {
    throw new Error("A conta de serviço do Firebase está incompleta.");
  }
  const firebaseApp = initializeApp({
    credential: cert(credenciais),
    projectId: credenciais.project_id
  }, "orby-fcm");
  return getMessaging(firebaseApp);
}

async function enviarPushParaUsuario(userId, notificacao) {
  const usuario = await User.findById(userId).select("pushTokens.token");
  const tokens = usuario?.pushTokens.map(dispositivo => dispositivo.token) || [];
  if (!tokens.length) return;

  try {
    const resposta = await firebaseMessaging().sendEachForMulticast({
      tokens,
      notification: {
        title: notificacao.titulo,
        body: notificacao.texto
      },
      data: Object.fromEntries(Object.entries({
        notificationId: notificacao.notificationId || "",
        type: notificacao.tipo || "",
        partidaId: notificacao.partidaId || ""
      }).map(([key, value]) => [key, String(value)])),
      android: {
        priority: "high",
        notification: {
          channelId: "orby_notifications",
          sound: "default",
          tag: notificacao.notificationId || undefined
        }
      }
    });
    const tokensInvalidos = resposta.responses.flatMap((resultado, index) =>
      !resultado.success && [
        "messaging/registration-token-not-registered",
        "messaging/invalid-registration-token"
      ].includes(resultado.error?.code) ? [tokens[index]] : []
    );
    if (tokensInvalidos.length) {
      await User.updateMany({}, { $pull: { pushTokens: { token: { $in: tokensInvalidos } } } });
    }
    if (resposta.failureCount) {
      console.error("Algumas notificações FCM não foram entregues.", {
        userId: String(userId),
        failures: resposta.responses.filter(resultado => !resultado.success)
          .map(resultado => resultado.error?.code || "erro-desconhecido")
      });
    }
  } catch (error) {
    console.error("Não foi possível enviar notificação pelo Firebase Cloud Messaging.", {
      userId: String(userId),
      erro: error.message
    });
  }
}

app.use(express.urlencoded({ extended: true, limit: "32kb" }));
app.use(express.json({ limit: "512kb" }));
app.use("/vendor/chess.js", express.static(path.join(__dirname, "node_modules", "chess.js", "dist", "esm")));
app.use("/vendor/stockfish.js", express.static(path.join(__dirname, "node_modules", "stockfish.js")));
app.use("/vendor/capacitor", express.static(path.join(__dirname, "node_modules", "@capacitor", "core", "dist")));
app.use("/vendor/local-notifications", express.static(path.join(__dirname, "node_modules", "@capacitor", "local-notifications", "dist")));
const adminSessoes = new Map();
const DURACAO_SESSAO_ADMIN_MS = 12 * 60 * 60 * 1000;

function enviarPaginaAdmin(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.sendFile(path.join(__dirname, "public", "admin.html"));
}

app.get("/admin", enviarPaginaAdmin);
app.get("/admin/", enviarPaginaAdmin);

function compararCredencialAdmin(valor, esperado) {
  const hashValor = createHash("sha256").update(valor).digest();
  const hashEsperado = createHash("sha256").update(esperado).digest();
  return timingSafeEqual(hashValor, hashEsperado);
}

function tokenSessaoAdmin(req) {
  const cookie = (req.headers.cookie || "").split(";")
    .map(valor => valor.trim())
    .find(valor => valor.startsWith("orbyAdminSession="));
  if (!cookie) return "";
  try {
    return decodeURIComponent(cookie.slice("orbyAdminSession=".length));
  } catch {
    return "";
  }
}

function autenticarAdmin(req, res) {
  const token = tokenSessaoAdmin(req);
  const expiracao = adminSessoes.get(token);
  if (!expiracao || expiracao <= Date.now()) {
    if (token) adminSessoes.delete(token);
    res.status(401).json({ erro: "Faça login como administrador." });
    return false;
  }
  return true;
}

function cookieSessaoAdmin(token, maxAge) {
  const partes = [
    `orbyAdminSession=${encodeURIComponent(token)}`,
    "Path=/admin",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`
  ];
  if (process.env.NODE_ENV === "production") partes.push("Secure");
  return partes.join("; ");
}

app.post("/admin/api/login", (req, res) => {
  const loginConfigurado = process.env.ADMIN_LOGIN;
  const senhaConfigurada = process.env.ADMIN_PASSWORD;
  if (!loginConfigurado || !senhaConfigurada) {
    return res.status(503).json({
      erro: "Configure ADMIN_LOGIN e ADMIN_PASSWORD nas variáveis de ambiente do servidor."
    });
  }

  const login = typeof req.body?.login === "string" ? req.body.login : "";
  const senha = typeof req.body?.senha === "string" ? req.body.senha : "";
  const loginValido = compararCredencialAdmin(login, loginConfigurado);
  const senhaValida = compararCredencialAdmin(senha, senhaConfigurada);
  if (login.length > 256 || senha.length > 256 || !loginValido || !senhaValida) {
    return res.status(401).json({ erro: "Login ou senha inválidos." });
  }

  const agora = Date.now();
  for (const [token, expiracao] of adminSessoes) {
    if (expiracao <= agora) adminSessoes.delete(token);
  }
  const token = randomBytes(32).toString("hex");
  adminSessoes.set(token, agora + DURACAO_SESSAO_ADMIN_MS);
  res.setHeader("Set-Cookie", cookieSessaoAdmin(token, DURACAO_SESSAO_ADMIN_MS / 1000));
  return res.json({ autenticado: true });
});

app.get("/admin/api/session", (req, res) => {
  if (!autenticarAdmin(req, res)) return;
  return res.json({ autenticado: true });
});

app.post("/admin/api/logout", (req, res) => {
  const token = tokenSessaoAdmin(req);
  if (token) adminSessoes.delete(token);
  res.setHeader("Set-Cookie", cookieSessaoAdmin("", 0));
  return res.json({ sucesso: true });
});

app.get("/admin/api/announcements", async (req, res) => {
  if (!autenticarAdmin(req, res)) return;
  const avisos = await AvisoAdmin.find({}).sort({ criadoEm: -1 })
    .select("titulo mensagem videoUrl criadoEm").lean();
  const avisosSeguros = avisos.map(aviso => ({
    ...aviso,
    videoUrl: urlCanonicaYoutube(extrairIdVideoYoutube(aviso.videoUrl))
  }));
  return res.json({ avisos: avisosSeguros });
});

app.post("/admin/api/announcements", async (req, res) => {
  if (!autenticarAdmin(req, res)) return;
  const titulo = typeof req.body?.titulo === "string" ? req.body.titulo.trim() : "";
  const mensagem = typeof req.body?.mensagem === "string" ? req.body.mensagem.trim() : "";
  const videoUrl = typeof req.body?.videoUrl === "string" ? req.body.videoUrl.trim() : "";
  if (!titulo || titulo.length > 120 || !mensagem || mensagem.length > 2000) {
    return res.status(400).json({
      erro: "Informe um título de até 120 caracteres e uma mensagem de até 2.000 caracteres."
    });
  }
  if (videoUrl.length > 2048 || (videoUrl && !extrairIdVideoYoutube(videoUrl))) {
    return res.status(400).json({
      erro: "Informe um link HTTPS válido de um vídeo do YouTube ou deixe o campo vazio."
    });
  }

  const videoId = extrairIdVideoYoutube(videoUrl);
  const aviso = await AvisoAdmin.create({
    titulo,
    mensagem,
    videoUrl: urlCanonicaYoutube(videoId)
  });
  return res.status(201).json({ aviso });
});

app.delete("/admin/api/announcements/:id", async (req, res) => {
  if (!autenticarAdmin(req, res)) return;
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ erro: "Identificador de aviso inválido." });
  }
  const removido = await AvisoAdmin.findByIdAndDelete(req.params.id).select("_id");
  if (!removido) return res.status(404).json({ erro: "Aviso não encontrado." });
  return res.json({ sucesso: true });
});

app.get("/admin/api/feedback", async (req, res) => {
  if (!autenticarAdmin(req, res)) return;
  const sugestoes = await FeedbackUsuario.find({}).sort({ criadoEm: -1 })
    .select("tipo mensagem imagemPublicId usuarioNome usuarioEmail criadoEm").lean();
  return res.json({
    sugestoes: sugestoes.map(sugestao => ({
      ...sugestao,
      imagemUrl: urlImagemFeedback(sugestao.imagemPublicId)
    }))
  });
});

app.post("/api/feedback", async (req, res) => {
  const userId = userIdDaCookie(req.headers.cookie || "");
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(401).json({ erro: "Faça login para enviar uma sugestão." });
  }

  const tipo = typeof req.body?.tipo === "string" ? req.body.tipo : "";
  const mensagem = typeof req.body?.mensagem === "string" ? req.body.mensagem.trim() : "";
  const imagemPublicId = typeof req.body?.imagemPublicId === "string"
    ? req.body.imagemPublicId
    : "";
  if (!["sugestao", "melhoria", "bug"].includes(tipo)) {
    return res.status(400).json({ erro: "Escolha sugestão, melhoria ou bug." });
  }
  if (mensagem.length < 5 || mensagem.length > 2000) {
    return res.status(400).json({ erro: "Escreva uma mensagem de 5 a 2.000 caracteres." });
  }
  const imagemFeedbackRegex = new RegExp(
    `^${pastaFeedback(userId)}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
    "i"
  );
  if (imagemPublicId && !imagemFeedbackRegex.test(imagemPublicId)) {
    return res.status(400).json({ erro: "A imagem anexada é inválida." });
  }

  const usuario = await User.findById(userId).select("nome email");
  if (!usuario) return res.status(401).json({ erro: "Sua sessão expirou. Entre novamente." });

  const sugestao = await FeedbackUsuario.create({
    tipo,
    mensagem,
    imagemPublicId,
    usuarioId: usuario._id,
    usuarioNome: usuario.nome || "",
    usuarioEmail: usuario.email || ""
  });
  return res.status(201).json({ sucesso: true, id: String(sugestao._id) });
});

app.get("/api/announcements", async (req, res) => {
  const avisos = await AvisoAdmin.find({}).sort({ criadoEm: -1 })
    .select("titulo mensagem videoUrl criadoEm").lean();
  return res.json({
    avisos: avisos.map(({ _id, titulo, mensagem, videoUrl, criadoEm }) => ({
      id: String(_id),
      titulo,
      mensagem,
      videoId: extrairIdVideoYoutube(videoUrl),
      criadoEm
    }))
  });
});

const arquivosDoAppSemCache = new Set([".css", ".html", ".js"]);
app.use(express.static(path.join(__dirname, "public"), {
  // Alguns provedores preservam a data do arquivo ao publicar. Sem ETag e
  // Last-Modified, eles não conseguem confirmar incorretamente um JS antigo com 304.
  etag: false,
  lastModified: false,
  setHeaders(res, arquivo) {
    if (arquivosDoAppSemCache.has(path.extname(arquivo).toLowerCase())) {
      res.setHeader("Cache-Control", "no-store, max-age=0");
    }
  }
}));
app.use("/sons", express.static(path.join(__dirname, "sons")));

// Party Rooms use the existing application login cookie.  The user is resolved
// from MongoDB on every protected operation, so deleted/invalid users cannot act.
function userIdDaCookie(cookieHeader = "") {
  const cookie = cookieHeader.split(";").map(value => value.trim())
    .find(value => value.startsWith("orbyUserId="));
  if (!cookie) return "";
  try {
    return decodeURIComponent(cookie.slice("orbyUserId=".length));
  } catch {
    return "";
  }
}

const partyRoomController = createPartyRoomController({
  service: partyRoomService,
  getAuthenticatedUserId: req => userIdDaCookie(req.headers.cookie || "")
});
app.use("/party-rooms", createPartyRoomRouter(partyRoomController));

function cloudinaryConfigurado() {
  return Boolean(process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
}

function pastaImagensUsuario(userId) {
  return `orby/${userId}/widgets`;
}

function pastaPerfilUsuario(userId) {
  return `orby/${userId}/profile`;
}

function pastaFeedback(userId) {
  return `orby/${userId}/feedback`;
}

function urlFotoPerfil(publicId) {
  if (!publicId || !process.env.CLOUDINARY_CLOUD_NAME) return "";
  return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,w_96,h_96,g_face,r_max,f_auto,q_auto/${publicId}`;
}

function urlImagemFeedback(publicId) {
  if (!/^orby\/[a-f0-9]{24}\/feedback\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(publicId) ||
      !process.env.CLOUDINARY_CLOUD_NAME) return "";
  return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/f_auto,q_auto/${publicId}`;
}

app.post("/cloudinary/feedback-signature", async (req, res) => {
  const userId = userIdDaCookie(req.headers.cookie || "");
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(401).json({ erro: "Faça login para anexar uma imagem." });
  }
  if (!cloudinaryConfigurado()) {
    return res.status(503).json({ erro: "O envio de imagens está indisponível no momento." });
  }

  const usuario = await User.findById(userId).select("_id");
  if (!usuario) return res.status(401).json({ erro: "Sua sessão expirou. Entre novamente." });

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = pastaFeedback(userId);
  const uploadPublicId = randomUUID();
  const allowedFormats = "jpg,jpeg,png,webp";
  const signature = cloudinary.utils.api_sign_request(
    { folder, public_id: uploadPublicId, allowed_formats: allowedFormats, timestamp },
    process.env.CLOUDINARY_API_SECRET
  );
  return res.json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    uploadPublicId,
    allowedFormats,
    signature
  });
});

app.post("/cloudinary/signature", async (req, res) => {
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ erro: "Identificador de usuário inválido" });
  }
  if (!cloudinaryConfigurado()) {
    return res.status(503).json({ erro: "Configure as credenciais da Cloudinary no ambiente do servidor" });
  }

  const user = await findUser(userId, res);
  if (!user) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = pastaImagensUsuario(userId);
  const signature = cloudinary.utils.api_sign_request(
    { folder, timestamp },
    process.env.CLOUDINARY_API_SECRET
  );
  return res.json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    signature
  });
});

app.post("/cloudinary/party-chat-signature", async (req, res) => {
  const userId = userIdDaCookie(req.headers.cookie || "");
  const roomId = typeof req.body?.roomId === "string" ? req.body.roomId : "";
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(401).json({ erro: "Faça login para enviar uma imagem." });
  }
  if (!mongoose.isValidObjectId(roomId)) {
    return res.status(400).json({ erro: "Sala inválida." });
  }
  if (!cloudinaryConfigurado()) {
    return res.status(503).json({ erro: "Configure as credenciais da Cloudinary no ambiente do servidor." });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const room = await PartyRoom.findOne({ _id: roomId, "participants.userId": user._id }).select("_id");
  if (!room) return res.status(403).json({ erro: "Entre na sala para enviar uma imagem." });

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `orby/${userId}/party-chat/${roomId}`;
  const publicId = randomUUID();
  const allowedFormats = "jpg,jpeg,png,gif,webp";
  const signature = cloudinary.utils.api_sign_request(
    { folder, public_id: publicId, allowed_formats: allowedFormats, timestamp },
    process.env.CLOUDINARY_API_SECRET
  );
  return res.json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    publicId: `${folder}/${publicId}`,
    uploadPublicId: publicId,
    allowedFormats,
    signature
  });
});

app.post("/cloudinary/party-room-signature", async (req, res) => {
  const userId = userIdDaCookie(req.headers.cookie || "");
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(401).json({ erro: "Faça login para enviar uma imagem." });
  }
  if (!cloudinaryConfigurado()) {
    return res.status(503).json({ erro: "Configure as credenciais da Cloudinary no ambiente do servidor." });
  }

  const user = await findUser(userId, res);
  if (!user) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `orby/${userId}/party-room-covers`;
  const uploadPublicId = randomUUID();
  const allowedFormats = "jpg,jpeg,png,webp";
  const signature = cloudinary.utils.api_sign_request(
    { folder, public_id: uploadPublicId, allowed_formats: allowedFormats, timestamp },
    process.env.CLOUDINARY_API_SECRET
  );
  return res.json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    publicId: `${folder}/${uploadPublicId}`,
    uploadPublicId,
    allowedFormats,
    signature
  });
});

app.get("/usuarios/:userId/perfil", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  return res.json({
    nome: user.nome || user.email?.split("@")[0] || "Usuário",
    fotoPerfilUrl: urlFotoPerfil(user.fotoPerfilPublicId),
    avatarAero: typeof user.preferencias?.avatarAero === "string" ? user.preferencias.avatarAero : "",
    aderecoChapeu: typeof user.preferencias?.aderecos?.chapeu === "string" ? user.preferencias.aderecos.chapeu : ""
  });
});

app.put("/usuarios/:userId/perfil/nome", async (req, res) => {
  const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
  if (!nome || nome.length > 100) {
    return res.status(400).json({ erro: "Informe um nome de até 100 caracteres." });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  user.nome = nome;
  await user.save();
  return res.json({ nome: user.nome });
});

app.put("/usuarios/:userId/senha", async (req, res) => {
  const senhaAtual = typeof req.body?.senhaAtual === "string" ? req.body.senhaAtual : "";
  const novaSenha = typeof req.body?.novaSenha === "string" ? req.body.novaSenha : "";

  if (!senhaAtual || !novaSenha) {
    return res.status(400).json({ erro: "Informe a senha atual e a nova senha." });
  }
  if (novaSenha.length < 6) {
    return res.status(400).json({ erro: "A nova senha deve ter pelo menos 6 caracteres." });
  }
  if (Buffer.byteLength(novaSenha, "utf8") > 72) {
    return res.status(400).json({ erro: "A nova senha deve ter no máximo 72 bytes." });
  }
  if (!mongoose.isValidObjectId(req.params.userId)) {
    return res.status(400).json({ erro: "Identificador de usuário inválido" });
  }

  const user = await User.findById(req.params.userId).select("+senha");
  if (!user) {
    return res.status(404).json({ erro: "Usuário não encontrado" });
  }

  const senhaAtualValida = BCRYPT_HASH_PATTERN.test(user.senha || "")
    ? await comparePassword(senhaAtual, user.senha)
    : user.senha === senhaAtual;
  if (!senhaAtualValida) {
    return res.status(401).json({ erro: "A senha atual está incorreta." });
  }

  const senhaHash = await hashPassword(novaSenha, BCRYPT_ROUNDS);
  const atualizacao = await User.updateOne(
    { _id: user._id, senha: user.senha },
    { $set: { senha: senhaHash } }
  );
  if (atualizacao.matchedCount !== 1) {
    return res.status(409).json({ erro: "A senha foi alterada em outra solicitação. Tente novamente." });
  }

  return res.json({ sucesso: true });
});

app.post("/cloudinary/profile-signature", async (req, res) => {
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ erro: "Identificador de usuário inválido" });
  }
  if (!cloudinaryConfigurado()) {
    return res.status(503).json({ erro: "Configure as credenciais da Cloudinary no ambiente do servidor" });
  }

  const user = await findUser(userId, res);
  if (!user) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = pastaPerfilUsuario(userId);
  const signature = cloudinary.utils.api_sign_request(
    { folder, timestamp },
    process.env.CLOUDINARY_API_SECRET
  );
  return res.json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder,
    signature
  });
});

app.put("/usuarios/:userId/perfil/foto", async (req, res) => {
  const userId = req.params.userId;
  const publicId = typeof req.body?.publicId === "string" ? req.body.publicId : "";
  const prefixoEsperado = `${pastaPerfilUsuario(userId)}/`;
  if (!mongoose.isValidObjectId(userId) || !publicId.startsWith(prefixoEsperado) ||
      !/^[A-Za-z0-9_-]{1,120}$/.test(publicId.slice(prefixoEsperado.length))) {
    return res.status(400).json({ erro: "Imagem de perfil inválida" });
  }

  const user = await findUser(userId, res);
  if (!user) return;

  const fotoAnterior = user.fotoPerfilPublicId;
  user.fotoPerfilPublicId = publicId;
  await user.save();

  if (fotoAnterior && fotoAnterior !== publicId && cloudinaryConfigurado()) {
    try {
      const resultado = await cloudinary.uploader.destroy(fotoAnterior, {
        invalidate: true,
        resource_type: "image"
      });
      if (resultado.result !== "ok" && resultado.result !== "not found") {
        console.warn("A foto de perfil foi atualizada, mas a imagem anterior não foi removida.");
      }
    } catch (error) {
      console.error("Falha ao remover a foto de perfil anterior:", error);
    }
  }

  return res.json({ ok: true, fotoPerfilUrl: urlFotoPerfil(publicId) });
});

app.delete("/cloudinary/image", async (req, res) => {
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  const publicId = typeof req.body?.publicId === "string" ? req.body.publicId : "";
  if (!mongoose.isValidObjectId(userId) || !publicId.startsWith(`${pastaImagensUsuario(userId)}/`)) {
    return res.status(400).json({ erro: "Imagem ou usuário inválido" });
  }
  if (!cloudinaryConfigurado()) {
    return res.status(503).json({ erro: "Configure as credenciais da Cloudinary no ambiente do servidor" });
  }

  const user = await findUser(userId, res);
  if (!user) return;

  try {
    const resultado = await cloudinary.uploader.destroy(publicId, {
      invalidate: true,
      resource_type: "image"
    });
    if (resultado.result !== "ok" && resultado.result !== "not found") {
      return res.status(502).json({ erro: "Não foi possível excluir a imagem da Cloudinary" });
    }
    return res.json({ ok: true });
  } catch (error) {
    console.error("Falha ao excluir imagem da Cloudinary:", error);
    return res.status(502).json({ erro: "Não foi possível excluir a imagem da Cloudinary" });
  }
});

function isValidDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) &&
    date.getFullYear() === Number(value.slice(0, 4)) &&
    date.getMonth() + 1 === Number(value.slice(5, 7)) &&
    date.getDate() === Number(value.slice(8, 10));
}

function fusoHorarioValido(fusoHorario) {
  if (typeof fusoHorario !== "string" || fusoHorario.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: fusoHorario });
    return true;
  } catch {
    return false;
  }
}

function dataHoraNoFuso(date, fusoHorario) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fusoHorario,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const valores = Object.fromEntries(partes.map(parte => [parte.type, parte.value]));
  return {
    data: `${valores.year}-${valores.month}-${valores.day}`,
    horario: `${valores.hour}:${valores.minute}`
  };
}

function chaveInicioSemana(chave) {
  const [ano, mes, dia] = chave.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia);
  const deslocamento = (data.getDay() + 6) % 7;
  data.setDate(data.getDate() - deslocamento);
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function periodoListaRecorrente(lista, agora = new Date()) {
  const { data } = dataHoraNoFuso(agora, lista.fusoHorario);
  const [ano, mes, dia] = data.split("-").map(Number);
  if (lista.recorrencia === "diaria") return data;
  if (lista.recorrencia === "semanal") return chaveInicioSemana(data);
  if (lista.recorrencia === "mensal") return `${ano}-${String(mes).padStart(2, "0")}`;

  const diaConfigurado = Math.min(Math.max(Number(lista.diaRecorrencia) || 1, 1), new Date(ano, mes, 0).getDate());
  if (dia >= diaConfigurado) return `${ano}-${String(mes).padStart(2, "0")}`;
  const mesAnterior = mes === 1 ? 12 : mes - 1;
  const anoAnterior = mes === 1 ? ano - 1 : ano;
  return `${anoAnterior}-${String(mesAnterior).padStart(2, "0")}`;
}

function sincronizarListaRecorrente(lista, agora = new Date()) {
  if (lista.tipo !== "recorrente") return false;
  const periodoAtual = periodoListaRecorrente(lista, agora);
  if (lista.periodoRecorrencia === periodoAtual) return false;
  lista.itens.forEach(item => { item.concluido = false; });
  lista.periodoRecorrencia = periodoAtual;
  return true;
}

function normalizeTaskOrder(tasks) {
  let nextOrder = tasks.reduce(
    (highest, task) => Math.max(highest, Number.isInteger(task.ordem) ? task.ordem : -1),
    -1
  ) + 1;

  for (const task of tasks) {
    if (!Number.isInteger(task.ordem)) task.ordem = nextOrder++;
  }
}

function validTaskColor(color) {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color);
}

function linkWidgetValido(link) {
  if (!link || typeof link !== "object" || Array.isArray(link) ||
      typeof link.titulo !== "string" || link.titulo.trim().length === 0 || link.titulo.length > 80 ||
      typeof link.url !== "string" || link.url.length > 2048) {
    return false;
  }
  try {
    const url = new URL(link.url);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function layoutWidgetsValido(layout) {
  if (!layout || typeof layout !== "object" || Array.isArray(layout) || Object.keys(layout).length > 100) {
    return false;
  }

  return Object.entries(layout).every(([id, registro]) => {
    if (typeof id !== "string" || !/^(?:calendar|weather|message|habit|list|clock|stopwatch|pomodoro|timer-regressivo|utilidades|links|chess|currency|farm|orb-ia|image-[a-zA-Z0-9-]{1,128}|postit-[a-zA-Z0-9-]{1,128})$/.test(id) ||
        !registro || typeof registro !== "object" || Array.isArray(registro) ||
        !Number.isInteger(registro.x) || !Number.isInteger(registro.y) || !Number.isInteger(registro.z) ||
        registro.x < 0 || registro.x > 10000 || registro.y < 0 || registro.y > 10000 ||
        registro.z < 1 || registro.z > 1000 ||
        (Object.hasOwn(registro, "width") &&
          !Number.isInteger(registro.width)) ||
        (Object.hasOwn(registro, "height") && !Number.isInteger(registro.height)) ||
        (id === "chess" &&
          ((Object.hasOwn(registro, "height")) ||
            (Object.hasOwn(registro, "width") && (registro.width < 180 || registro.width > 620)))) ||
        (id === "orb-ia" &&
          (Object.hasOwn(registro, "width") !== Object.hasOwn(registro, "height") ||
            (Object.hasOwn(registro, "width") && (registro.width < 180 || registro.width > 680)) ||
            (Object.hasOwn(registro, "height") && (registro.height < 160 || registro.height > 800)))) ||
        (id === "farm" &&
          ((Object.hasOwn(registro, "width") && (registro.width < 1 || registro.width > 420)) ||
            (Object.hasOwn(registro, "height") && (registro.height < 1 || registro.height > 680)))) ||
        (!["chess", "orb-ia", "farm"].includes(id) &&
          (Object.hasOwn(registro, "width") || Object.hasOwn(registro, "height")))) {
      return false;
    }

    return (!Object.hasOwn(registro, "src") || (typeof registro.src === "string" && registro.src.length <= 3000)) &&
      (!Object.hasOwn(registro, "publicId") || (typeof registro.publicId === "string" && registro.publicId.length <= 500)) &&
      (!Object.hasOwn(registro, "alt") || (typeof registro.alt === "string" && registro.alt.length <= 300));
  });
}

function objetoBooleanoValido(valor) {
  return valor && typeof valor === "object" && !Array.isArray(valor) && Object.keys(valor).length <= 100 &&
    Object.entries(valor).every(([id, ativo]) => typeof id === "string" && id.length <= 150 && typeof ativo === "boolean");
}

function postitsWidgetsValidos(postits) {
  return Array.isArray(postits) && postits.length <= 50 && postits.every(postit =>
    postit && typeof postit === "object" &&
    typeof postit.id === "string" && /^postit-[a-zA-Z0-9-]{1,128}$/.test(postit.id) &&
    typeof postit.titulo === "string" && postit.titulo.length <= 100 &&
    typeof postit.texto === "string" && postit.texto.length <= 2000 &&
    validTaskColor(postit.cor)
  );
}

function preferenciasValidas(preferencias) {
  if (!preferencias || typeof preferencias !== "object" || Array.isArray(preferencias)) return false;
  const { layoutWidgets, visibilidadeWidgets, postitsWidgets, estiloRelogio, visualCalendario, visualTempo, habitoWidget,
    modoArrasteWidgets, tamanhoPainelTarefas, cronometro, pomodoro, duracoesPomodoro,
    notificacoesLancesXadrez, tabuleiroXadrez, listaWidget, linksWidget, avatarAero, localizacaoOrbIa,
    cotacaoMoedas, cotacaoCriptomoedas, secoesNavegacao } = preferencias;
  const moedasCotacaoValidas = cotacaoMoedas === undefined ||
    (Array.isArray(cotacaoMoedas) && cotacaoMoedas.length <= 5 &&
      new Set(cotacaoMoedas).size === cotacaoMoedas.length &&
      cotacaoMoedas.every(codigo => ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "ZAR", "MXN"].includes(codigo)));
  const criptomoedasCotacaoValidas = cotacaoCriptomoedas === undefined ||
    (Array.isArray(cotacaoCriptomoedas) && cotacaoCriptomoedas.length <= 5 &&
      new Set(cotacaoCriptomoedas).size === cotacaoCriptomoedas.length &&
      cotacaoCriptomoedas.every(codigo => ["BTC", "ETH", "USDT", "BNB", "SOL", "XRP"].includes(codigo)));
  const secoesNavegacaoValidas = secoesNavegacao === undefined ||
    (secoesNavegacao && typeof secoesNavegacao === "object" && !Array.isArray(secoesNavegacao) &&
      Object.entries(secoesNavegacao).every(([id, ativo]) =>
        ["containerTarefasImportantes", "containerNotas", "containerOutracoisa", "containerHabitos", "containerListas", "containerOrbyParty"].includes(id) &&
        typeof ativo === "boolean"));
  const tamanhoValido = tamanhoPainelTarefas === null ||
    (tamanhoPainelTarefas && typeof tamanhoPainelTarefas === "object" &&
      Number.isInteger(tamanhoPainelTarefas.largura) && Number.isInteger(tamanhoPainelTarefas.altura) &&
      tamanhoPainelTarefas.largura >= 320 && tamanhoPainelTarefas.largura <= 10000 &&
      tamanhoPainelTarefas.altura >= 280 && tamanhoPainelTarefas.altura <= 10000);
  const cronometroValido = cronometro && typeof cronometro === "object" && !Array.isArray(cronometro) &&
    Number.isInteger(cronometro.tempoMs) && cronometro.tempoMs >= 0 && cronometro.tempoMs <= 31536000000 &&
    typeof cronometro.rodando === "boolean" &&
    (cronometro.iniciadoEm === null || (Number.isInteger(cronometro.iniciadoEm) && cronometro.iniciadoEm > 0));
  const pomodoroValido = pomodoro && typeof pomodoro === "object" && !Array.isArray(pomodoro) &&
    ["foco", "pausa"].includes(pomodoro.fase) && Number.isInteger(pomodoro.tempoRestanteMs) &&
    pomodoro.tempoRestanteMs >= 0 && pomodoro.tempoRestanteMs <= 10800000 &&
    typeof pomodoro.rodando === "boolean" &&
    (pomodoro.iniciadoEm === null || (Number.isInteger(pomodoro.iniciadoEm) && pomodoro.iniciadoEm > 0));
  const duracoesPomodoroValidas = duracoesPomodoro === undefined ||
    (duracoesPomodoro && typeof duracoesPomodoro === "object" && !Array.isArray(duracoesPomodoro) &&
      Number.isInteger(duracoesPomodoro.focoMinutos) && duracoesPomodoro.focoMinutos >= 1 &&
      duracoesPomodoro.focoMinutos <= 180 && Number.isInteger(duracoesPomodoro.pausaMinutos) &&
      duracoesPomodoro.pausaMinutos >= 1 && duracoesPomodoro.pausaMinutos <= 180);
  const timerRegressivoValido = preferencias.timerRegressivo === undefined ||
    (preferencias.timerRegressivo && typeof preferencias.timerRegressivo === "object" &&
      !Array.isArray(preferencias.timerRegressivo) &&
      typeof preferencias.timerRegressivo.titulo === "string" &&
      preferencias.timerRegressivo.titulo.length <= 80 &&
      typeof preferencias.timerRegressivo.dataHora === "string" &&
      ((preferencias.timerRegressivo.titulo === "" && preferencias.timerRegressivo.dataHora === "") ||
        (preferencias.timerRegressivo.titulo.trim().length > 0 &&
          dataHoraTimerRegressivoValida(preferencias.timerRegressivo.dataHora))));
  const visuaisWidgetsValidos = [visualCalendario, visualTempo]
    .every(visual => visual === undefined || ["tema", "windows7"].includes(visual));

  const aderecosValidos = preferencias.aderecos === undefined ||
    (preferencias.aderecos && typeof preferencias.aderecos === "object" && !Array.isArray(preferencias.aderecos) &&
      (preferencias.aderecos.chapeu === undefined ||
        (typeof preferencias.aderecos.chapeu === "string" && preferencias.aderecos.chapeu.length <= 250)));

  return visuaisWidgetsValidos && layoutWidgetsValido(layoutWidgets) && objetoBooleanoValido(visibilidadeWidgets) &&
    postitsWidgetsValidos(postitsWidgets) && ["digital", "analogico", "minimalista", "flip", "windows7"].includes(estiloRelogio) &&
    (linksWidget === undefined || (Array.isArray(linksWidget) && linksWidget.length <= 50 &&
      linksWidget.every(linkWidgetValido))) &&
    typeof habitoWidget === "string" && habitoWidget.length <= 100 &&
    (listaWidget === undefined || listaWidget === "" ||
      (typeof listaWidget === "string" && mongoose.isValidObjectId(listaWidget))) &&
    typeof modoArrasteWidgets === "boolean" && tamanhoValido && cronometroValido && pomodoroValido &&
    duracoesPomodoroValidas && timerRegressivoValido &&
    (notificacoesLancesXadrez === undefined || typeof notificacoesLancesXadrez === "boolean") &&
    (localizacaoOrbIa === undefined || ["widget", "cabecalho"].includes(localizacaoOrbIa)) &&
    (tabuleiroXadrez === undefined || ["classico", "verde", "madeira", "aero", "vermelho"].includes(tabuleiroXadrez)) &&
    (avatarAero === undefined || ["", "icon1", "icon2", "icon-3", "icon4", "icon5", "icon6", "icon7", "obj-headphones", "obj-camera", "obj-book", "obj-coffee", "obj-game", "obj-plant", "obj-rocket", "obj-music", "animal-cat", "animal-dog", "animal-fox", "animal-rabbit", "animal-panda", "animal-bird", "animal-turtle", "animal-butterfly"].includes(avatarAero)) &&
    moedasCotacaoValidas && criptomoedasCotacaoValidas && secoesNavegacaoValidas && aderecosValidos;
}

function dataHoraTimerRegressivoValida(valor) {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return false;
  const [data, hora] = valor.split("T");
  const [ano, mes, dia] = data.split("-").map(Number);
  const [horas, minutos] = hora.split(":").map(Number);
  if (ano < 1000 || mes < 1 || mes > 12 || dia < 1 || horas > 23 || minutos > 59) return false;
  const instante = new Date(ano, mes - 1, dia, horas, minutos);
  return instante.getFullYear() === ano && instante.getMonth() === mes - 1 &&
    instante.getDate() === dia && instante.getHours() === horas && instante.getMinutes() === minutos;
}

function parseTaskSchedule(data, hora, minuto) {
  if (!isValidDateOnly(data) || typeof hora !== "string" || !/^(?:[01]\d|2[0-3])$/.test(hora) ||
      typeof minuto !== "string" || !/^(?:[0-5]\d)$/.test(minuto) ||
      Number(minuto) % 5 !== 0) {
    return null;
  }

  const [ano, mes, dia] = data.split("-").map(Number);
  return new Date(ano, mes - 1, dia, Number(hora), Number(minuto));
}

async function findUser(userId, res) {
  if (!mongoose.isValidObjectId(userId)) {
    res.status(400).json({ erro: "Identificador de usuário inválido" });
    return null;
  }

  const user = await User.findById(userId);
  if (!user) {
    res.status(404).json({ erro: "Usuário não encontrado" });
    return null;
  }

  // Remove registros criados sem nome antes de a estrutura de listas ser validada.
  // Eles impedem qualquer salvamento do usuário pela validação do Mongoose.
  const possuiListaInvalida = user.listas.some(lista =>
    typeof lista?.nome !== "string" || !lista.nome.trim()
  );
  if (possuiListaInvalida) {
    await User.updateOne(
      { _id: user._id },
      { $pull: { listas: { $or: [{ nome: { $exists: false } }, { nome: null }, { nome: "" }] } } }
    );
    user.listas = user.listas.filter(lista => typeof lista?.nome === "string" && lista.nome.trim());
  }

  return user;
}

function normalizarEmail(email) {
  return email.trim().toLowerCase();
}

function emailExatoCaseInsensitive(email) {
  const escapado = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapado}$`, "i");
}

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validarCredenciais(email, senha, res, cadastro = false) {
  if (!email || !senha) {
    res.status(400).json({ erro: "Informe o e-mail e a senha" });
    return false;
  }
  if (!emailValido(email)) {
    res.status(400).json({ erro: "Informe um e-mail válido" });
    return false;
  }
  if (cadastro && senha.length < 6) {
    res.status(400).json({ erro: "A senha deve ter pelo menos 6 caracteres" });
    return false;
  }
  if (cadastro && Buffer.byteLength(senha, "utf8") > 72) {
    res.status(400).json({ erro: "A senha deve ter no máximo 72 bytes" });
    return false;
  }
  return true;
}

function dadosAcessoUsuario(user) {
  return {
    sucesso: true,
    id: user._id,
    nome: user.nome || user.email,
    email: user.email
  };
}

function iniciarSessao(res, user) {
  res.cookie("orbyUserId", String(user._id), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 30
  });
  try {
    res.cookie("orbySession", criarSessaoOrb(user._id), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 30
    });
  } catch (error) {
    if (!(error instanceof OrbAiError) || error.status !== 503) throw error;
    res.clearCookie("orbySession", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production"
    });
  }
}

app.post("/logout", (req, res) => {
  const cookieOptions = {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production"
  };
  res.clearCookie("orbyUserId", cookieOptions);
  res.clearCookie("orbySession", { ...cookieOptions, httpOnly: true });
  return res.json({ sucesso: true });
});

app.post("/login", async (req, res) => {
  const email = typeof req.body?.email === "string" ? normalizarEmail(req.body.email) : "";
  const senha = typeof req.body?.senha === "string" ? req.body.senha : "";

  if (!validarCredenciais(email, senha, res)) return;

  const user = await User.findOne({
    $or: [
      { emailNormalizado: email },
      { email: emailExatoCaseInsensitive(email) }
    ]
  }).select("+senha");
  if (!user) {
    return res.status(401).json({ erro: "E-mail ou senha inválidos" });
  }

  if (BCRYPT_HASH_PATTERN.test(user.senha || "")) {
    if (!await comparePassword(senha, user.senha)) {
      return res.status(401).json({ erro: "E-mail ou senha inválidos" });
    }
  } else {
    if (user.senha !== senha) {
      return res.status(401).json({ erro: "E-mail ou senha inválidos" });
    }

    const senhaHash = await hashPassword(senha, BCRYPT_ROUNDS);
    const migracao = await User.updateOne(
      { _id: user._id, senha: user.senha },
      { $set: { senha: senhaHash } }
    );
    if (migracao.matchedCount !== 1) {
      return res.status(401).json({ erro: "E-mail ou senha inválidos" });
    }
  }

  iniciarSessao(res, user);
  return res.json(dadosAcessoUsuario(user));
});

app.post("/cadastro", async (req, res) => {
  const emailOriginal = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  const email = normalizarEmail(emailOriginal);
  const senha = typeof req.body?.senha === "string" ? req.body.senha : "";
  if (!validarCredenciais(email, senha, res, true)) return;

  const existente = await User.findOne({ email: emailExatoCaseInsensitive(email) }).select("_id");
  if (existente) {
    return res.status(409).json({ erro: "Já existe uma conta com este e-mail" });
  }

  try {
    const user = await User.create({
      nome: email.split("@")[0],
      email,
      emailNormalizado: email,
      senha: await hashPassword(senha, BCRYPT_ROUNDS)
    });
    iniciarSessao(res, user);
    return res.status(201).json({ ...dadosAcessoUsuario(user), novoCadastro: true });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ erro: "Já existe uma conta com este e-mail" });
    }
    throw error;
  }
});

function autenticarOrb(req, res) {
  try {
    verificarConfiguracaoOrb();
    const cookies = (req.headers.cookie || "").split(";");
    const cookieSessao = cookies.find(cookie => cookie.trim().startsWith("orbySession="));
    const token = cookieSessao ? cookieSessao.trim().slice("orbySession=".length) : "";
    const userId = validarSessaoOrb(token);
    if (!userId) {
      res.status(401).json({ erro: "Sua sessão expirou. Entre novamente para usar a Orb.IA." });
      return null;
    }
    return userId;
  } catch (error) {
    if (error instanceof OrbAiError) {
      res.status(error.status).json({ erro: error.message });
      return null;
    }
    throw error;
  }
}

app.get("/orb-ia/config", async (req, res) => {
  const userId = autenticarOrb(req, res);
  if (!userId) return;
  const user = await User.findById(userId).select("+orbIaApiKeyCriptografada");
  if (!user) return res.status(404).json({ erro: "Usuário não encontrado." });
  return res.json({ chaveConfigurada: Boolean(user.orbIaApiKeyCriptografada) });
});

app.put("/orb-ia/chave", async (req, res) => {
  const userId = autenticarOrb(req, res);
  if (!userId) return;

  const chaveApi = typeof req.body?.chaveApi === "string" ? req.body.chaveApi.trim() : "";
  if (chaveApi.length < 20 || chaveApi.length > 256) {
    return res.status(400).json({ erro: "Informe uma chave API Gemini válida." });
  }

  const chaveCriptografada = criptografarChaveGemini(chaveApi);
  const atualizacao = await User.updateOne(
    { _id: userId },
    { $set: { orbIaApiKeyCriptografada: chaveCriptografada } }
  );
  if (atualizacao.matchedCount !== 1) {
    return res.status(404).json({ erro: "Usuário não encontrado." });
  }
  return res.json({ chaveConfigurada: true });
});

app.delete("/orb-ia/chave", async (req, res) => {
  const userId = autenticarOrb(req, res);
  if (!userId) return;
  const atualizacao = await User.updateOne(
    { _id: userId },
    { $unset: { orbIaApiKeyCriptografada: 1 } }
  );
  if (atualizacao.matchedCount !== 1) {
    return res.status(404).json({ erro: "Usuário não encontrado." });
  }
  return res.json({ chaveConfigurada: false });
});

app.post("/orb-ia/conversar", async (req, res) => {
  const userId = autenticarOrb(req, res);
  if (!userId) return;

  const mensagens = req.body?.mensagens;
  if (
    !Array.isArray(mensagens) ||
    mensagens.length < 1 ||
    mensagens.length > 12 ||
    mensagens.some((mensagem, indice) =>
      !mensagem ||
      typeof mensagem !== "object" ||
      !["user", "model"].includes(mensagem.role) ||
      typeof mensagem.text !== "string" ||
      !mensagem.text.trim() ||
      mensagem.text.length > 2000 ||
      (indice > 0 && mensagem.role === mensagens[indice - 1]?.role)
    ) ||
    mensagens[mensagens.length - 1]?.role !== "user"
  ) {
    return res.status(400).json({ erro: "A conversa enviada é inválida." });
  }

  const user = await User.findById(userId).select(
    "+orbIaApiKeyCriptografada orbIaModeloAtual nome tarefasDiarias tarefasImportantes habitos posts folhasCaderno listas preferencias"
  );
  if (!user) return res.status(404).json({ erro: "Usuário não encontrado." });
  if (!user.orbIaApiKeyCriptografada) {
    return res.status(409).json({ erro: "Configure sua chave API Gemini antes de conversar." });
  }

  const tarefas = [
    ...user.tarefasDiarias.map(tarefa => ({ tarefa, tipo: "Rotina" })),
    ...user.tarefasImportantes.map(tarefa => ({ tarefa, tipo: "Importante" }))
  ].slice(0, 100).map(({ tarefa, tipo }) => ({
    status: tarefa.concluida ? "concluída" : "pendente",
    tipo,
    data: tarefa.dataCriacao
      ? new Date(tarefa.dataCriacao).toLocaleDateString("pt-BR")
      : "sem data",
    texto: tarefa.texto
  }));

  try {
    const clima = await obterContextoClimaOrb(
      user.preferencias?.visibilidadeWidgets?.weather !== false,
      req.body?.coordenadasClima
    );
    const { texto, modeloUtilizado } = await gerarRespostaGemini({
      chaveApi: descriptografarChaveGemini(user.orbIaApiKeyCriptografada),
      modeloPreferencial: user.orbIaModeloAtual,
      instrucao: criarInstrucaoOrbIA({
        nomeUsuario: user.nome,
        tarefas,
        habitos: user.habitos.slice(0, 100).map(habito => ({
          nome: habito.nome,
          horario: habito.horario,
          horarios: habito.horarios,
          diasConcluidos: habito.diasConcluidos
        })),
        postits: user.posts.slice(0, 50).map(post => ({
          titulo: post.titulo,
          descricao: post.descricao
        })),
        folhasCaderno: user.folhasCaderno.slice(0, 30).map(folha => ({
          titulo: folha.titulo,
          conteudo: folha.conteudo
        })),
        listas: user.listas.slice(0, 20).map(lista => ({
          nome: lista.nome,
          itens: lista.itens
        })),
        clima
      }),
      mensagens: mensagens.map(mensagem => ({
        role: mensagem.role,
        text: mensagem.text.trim()
      }))
    });

    if (modeloUtilizado && modeloUtilizado !== user.orbIaModeloAtual) {
      await User.updateOne({ _id: user._id }, { $set: { orbIaModeloAtual: modeloUtilizado } });
    }

    return res.json({ resposta: texto, modelo: modeloUtilizado });
  } catch (error) {
    if (error instanceof OrbAiError) {
      return res.status(error.status).json({ erro: error.message });
    }
    throw error;
  }
});

app.get("/preferencias/:userId", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  return res.json({ preferencias: user.preferencias && typeof user.preferencias === "object" ? user.preferencias : {} });
});

app.put("/preferencias/:userId", async (req, res) => {
  const preferencias = req.body?.preferencias;
  if (!preferenciasValidas(preferencias)) {
    return res.status(400).json({ erro: "Layout dos widgets inválido" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  if (preferencias.listaWidget && !user.listas.id(preferencias.listaWidget)) {
    return res.status(400).json({ erro: "A lista selecionada para o widget não existe" });
  }
  user.preferencias = preferencias;
  await user.save();
  return res.json({ preferencias: user.preferencias });
});

app.get("/api/aderecos", async (req, res) => {
  try {
    const pastaAderecos = path.join(__dirname, "public", "aderecos");
    if (!fs.existsSync(pastaAderecos)) {
      return res.json({ chapeus: [] });
    }
    const arquivos = await fs.promises.readdir(pastaAderecos);
    const extensoesValidas = new Set([".png", ".webp", ".svg", ".jpg", ".jpeg"]);
    const chapeus = arquivos
      .filter(arquivo => extensoesValidas.has(path.extname(arquivo).toLowerCase()))
      .map(arquivo => ({
        id: arquivo,
        nome: path.basename(arquivo, path.extname(arquivo)),
        url: "/aderecos/" + encodeURIComponent(arquivo)
      }));
    return res.json({ chapeus });
  } catch (error) {
    console.error("Erro ao listar adereços:", error);
    return res.status(500).json({ erro: "Não foi possível carregar os adereços." });
  }
});


app.post("/tarefas", async (req, res) => {
  const body = req.body ?? {};
  const { userId } = body;
  const texto = typeof body.texto === "string" ? body.texto.trim() : "";
  const dataCriacao = parseTaskSchedule(body.data, body.hora, body.minuto);
  const cor = body.cor ?? "#e73d3d";

  if (!texto || texto.length > 300 || !dataCriacao || !validTaskColor(cor)) {
    return res.status(400).json({ erro: "Descrição, data, horário ou cor da tarefa inválida" });
  }

  const user = await findUser(userId, res);
  if (!user) return;

  normalizeTaskOrder(user.tarefasDiarias);
  user.tarefasDiarias.push({
    texto,
    dataCriacao,
    cor,
    ordem: user.tarefasDiarias.length
  });
  await user.save();
  return res.status(201).json(user.tarefasDiarias.at(-1));
});

app.get("/tarefas/:userId", async (req, res) => {
  const { data } = req.query;
  if (!isValidDateOnly(data)) {
    return res.status(400).json({ erro: "Informe uma data válida no formato AAAA-MM-DD" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;

  normalizeTaskOrder(user.tarefasDiarias);
  if (user.isModified("tarefasDiarias")) await user.save();
  const [ano, mes, dia] = data.split("-").map(Number);
  const inicio = new Date(ano, mes - 1, dia);
  const fim = new Date(ano, mes - 1, dia + 1);
  const tarefas = user.tarefasDiarias.filter(tarefa =>
    tarefa.dataCriacao >= inicio && tarefa.dataCriacao < fim
  ).sort((a, b) => a.ordem - b.ordem);
  return res.json(tarefas);
});

app.get("/tarefas/:userId/notificacoes", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;

  const agora = new Date();
  const incluirRecentes = req.query.includeRecent === "true";
  const limiteRecentes = new Date(agora.getTime() - 20 * 60 * 1000);
  const tarefaPendenteNoIntervalo = tarefa =>
    !tarefa.concluida &&
    (tarefa.dataCriacao > agora || (incluirRecentes && tarefa.dataCriacao > limiteRecentes));
  const tarefas = [
    ...user.tarefasDiarias
      .filter(tarefaPendenteNoIntervalo)
      .map(tarefa => ({ _id: tarefa.id, texto: tarefa.texto, dataCriacao: tarefa.dataCriacao, tipo: "diaria" })),
    ...user.tarefasImportantes
      .filter(tarefaPendenteNoIntervalo)
      .map(tarefa => ({ _id: tarefa.id, texto: tarefa.texto, dataCriacao: tarefa.dataCriacao, tipo: "importante" }))
  ].sort((a, b) => a.dataCriacao - b.dataCriacao);

  return res.json(tarefas);
});

app.get("/tarefas/:userId/calendario", async (req, res) => {
  const { ano, mes } = req.query;
  const anoNumero = Number(ano);
  const mesNumero = Number(mes);
  if (!Number.isInteger(anoNumero) || anoNumero < 1000 || anoNumero > 9999 ||
      !Number.isInteger(mesNumero) || mesNumero < 1 || mesNumero > 12) {
    return res.status(400).json({ erro: "Informe um mês válido" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;

  const inicio = new Date(anoNumero, mesNumero - 1, 1);
  const fim = new Date(anoNumero, mesNumero, 1);
  const diasComTarefas = [...new Set(user.tarefasDiarias
    .filter(tarefa => !tarefa.concluida && tarefa.dataCriacao >= inicio && tarefa.dataCriacao < fim)
    .map(tarefa => {
      const data = tarefa.dataCriacao;
      return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
    }))];

  return res.json(diasComTarefas);
});

app.put("/tarefas/:userId/ordem", async (req, res) => {
  const { data, ids } = req.body ?? {};
  if (!isValidDateOnly(data) || !Array.isArray(ids) ||
      ids.some(id => !mongoose.isValidObjectId(id)) ||
      new Set(ids).size !== ids.length) {
    return res.status(400).json({ erro: "Data ou lista de tarefas inválida" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  normalizeTaskOrder(user.tarefasDiarias);

  const [ano, mes, dia] = data.split("-").map(Number);
  const inicio = new Date(ano, mes - 1, dia);
  const fim = new Date(ano, mes - 1, dia + 1);
  const tarefasDoDia = user.tarefasDiarias.filter(tarefa =>
    tarefa.dataCriacao >= inicio && tarefa.dataCriacao < fim
  );
  const idsDoDia = new Set(tarefasDoDia.map(tarefa => tarefa.id));

  if (ids.length !== tarefasDoDia.length || ids.some(id => !idsDoDia.has(id))) {
    return res.status(400).json({ erro: "A lista precisa conter todas as tarefas deste dia" });
  }

  ids.forEach((id, ordem) => {
    user.tarefasDiarias.id(id).ordem = ordem;
  });
  await user.save();
  return res.json({ ok: true });
});

app.put("/tarefas/:userId/:tarefaId", async (req, res) => {
  const { userId, tarefaId } = req.params;
  if (!mongoose.isValidObjectId(tarefaId)) {
    return res.status(400).json({ erro: "Identificador de tarefa inválido" });
  }
  const { texto, concluida, cor, data, hora, minuto } = req.body ?? {};
  const novoTexto = typeof texto === "string" ? texto.trim() : undefined;
  const scheduleRequested = data !== undefined || hora !== undefined || minuto !== undefined;
  const dataCriacao = scheduleRequested ? parseTaskSchedule(data, hora, minuto) : null;
  if (scheduleRequested && !dataCriacao) {
    return res.status(400).json({ erro: "Informe uma data e um horário válidos (minutos de 5 em 5)" });
  }
  if (texto !== undefined && (!novoTexto || novoTexto.length > 300)) {
    return res.status(400).json({ erro: "A descrição deve ter entre 1 e 300 caracteres" });
  }
  if (concluida !== undefined && typeof concluida !== "boolean") {
    return res.status(400).json({ erro: "Informe se a tarefa foi concluída" });
  }
  if (cor !== undefined && !validTaskColor(cor)) {
    return res.status(400).json({ erro: "Informe uma cor hexadecimal válida" });
  }
  if (novoTexto === undefined && concluida === undefined && cor === undefined && !scheduleRequested) {
    return res.status(400).json({ erro: "Informe os dados que deseja alterar na tarefa" });
  }

  const user = await findUser(userId, res);
  if (!user) return;

  const tarefa = user.tarefasDiarias.id(tarefaId);
  if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada" });

  if (novoTexto !== undefined) tarefa.texto = novoTexto;
  if (cor !== undefined) tarefa.cor = cor;
  if (scheduleRequested) {
    tarefa.dataCriacao = dataCriacao;
    tarefa.notificadoEm = null;
  }
  if (concluida !== undefined) {
    tarefa.concluida = concluida;
    tarefa.dataConclusao = tarefa.concluida ? new Date() : null;
  }
  await user.save();
  return res.json(tarefa);
});

app.delete("/tarefas/:userId/:tarefaId", async (req, res) => {
  const { userId, tarefaId } = req.params;
  if (!mongoose.isValidObjectId(tarefaId)) {
    return res.status(400).json({ erro: "Identificador de tarefa inválido" });
  }

  const user = await findUser(userId, res);
  if (!user) return;

  const tarefa = user.tarefasDiarias.id(tarefaId);
  if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada" });

  tarefa.deleteOne();
  await user.save();
  return res.json({ ok: true });
});

function classificarCodigoTempo(codigo) {
  const condicoes = {
    0: ["Clear", "céu limpo"],
    1: ["Clear", "predominantemente limpo"],
    2: ["Clouds", "parcialmente nublado"],
    3: ["Clouds", "nublado"],
    45: ["Fog", "neblina"],
    48: ["Fog", "neblina congelante"],
    51: ["Drizzle", "garoa fraca"],
    53: ["Drizzle", "garoa moderada"],
    55: ["Drizzle", "garoa intensa"],
    56: ["Drizzle", "garoa congelante fraca"],
    57: ["Drizzle", "garoa congelante intensa"],
    61: ["Rain", "chuva fraca"],
    63: ["Rain", "chuva moderada"],
    65: ["Rain", "chuva forte"],
    66: ["Rain", "chuva congelante fraca"],
    67: ["Rain", "chuva congelante forte"],
    71: ["Snow", "neve fraca"],
    73: ["Snow", "neve moderada"],
    75: ["Snow", "neve forte"],
    77: ["Snow", "grãos de neve"],
    80: ["Rain", "pancadas de chuva fracas"],
    81: ["Rain", "pancadas de chuva moderadas"],
    82: ["Rain", "pancadas de chuva fortes"],
    85: ["Snow", "pancadas de neve fracas"],
    86: ["Snow", "pancadas de neve fortes"],
    95: ["Thunderstorm", "trovoada"],
    96: ["Thunderstorm", "trovoada com granizo fraco"],
    99: ["Thunderstorm", "trovoada com granizo forte"]
  };
  const [main, description] = condicoes[codigo] || ["Clouds", "condição variável"];
  return { main, description };
}

function timestampClima(dataHoraLocal, fusoHorario) {
  return Math.floor(Date.parse(`${dataHoraLocal}Z`) / 1000) - fusoHorario;
}

function criarUrlClima(query, incluirPrevisao) {
  const { lat, lon } = query;
  const hasCoordinates = lat !== undefined || lon !== undefined;
  let latitude = -30.0346;
  let longitude = -51.2177;
  if (hasCoordinates) {
    latitude = Number(lat);
    longitude = Number(lon);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return { erro: "Coordenadas inválidas", status: 400 };
    }
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("wind_speed_unit", "ms");
  url.searchParams.set("forecast_days", incluirPrevisao ? "7" : "1");
  url.searchParams.set("daily", "sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum");
  if (!incluirPrevisao) {
    url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m");
  }
  return { url, hasCoordinates, latitude, longitude };
}

async function obterNomeCidade(latitude, longitude) {
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("localityLanguage", "pt");

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const data = await response.json();
    return data.city || data.locality || data.principalSubdivision || null;
  } catch {
    return null;
  }
}

function normalizarClima(data, hasCoordinates, incluirPrevisao, nomeCidade) {
  const fusoHorario = data.utc_offset_seconds || 0;
  const resposta = {
    name: hasCoordinates ? nomeCidade || "Localidade indisponível" : "Porto Alegre",
    timezone: fusoHorario
  };

  if (!incluirPrevisao) {
    const clima = classificarCodigoTempo(data.current.weather_code);
    return {
      ...resposta,
      main: {
        temp: data.current.temperature_2m,
        feels_like: data.current.apparent_temperature,
        humidity: data.current.relative_humidity_2m
      },
      weather: [clima],
      wind: { speed: data.current.wind_speed_10m },
      sys: {
        sunrise: timestampClima(data.daily.sunrise[0], fusoHorario),
        sunset: timestampClima(data.daily.sunset[0], fusoHorario)
      }
    };
  }

  return { daily: data.daily };
}

async function responderClima(req, res, incluirPrevisao) {
  const { url, hasCoordinates, latitude, longitude, erro, status } = criarUrlClima(req.query, incluirPrevisao);
  if (erro) return res.status(status).json({ erro });

  try {
    const [response, nomeCidade] = await Promise.all([
      fetch(url, { signal: AbortSignal.timeout(8000) }),
      hasCoordinates && !incluirPrevisao
        ? obterNomeCidade(latitude, longitude)
        : Promise.resolve(null)
    ]);
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.reason || "Não foi possível buscar o clima");
    }
    if (incluirPrevisao && (!Array.isArray(data.daily?.time) || data.daily.time.length !== 7)) {
      throw new Error("A previsão dos próximos sete dias está incompleta");
    }
    return res.json(normalizarClima(data, hasCoordinates, incluirPrevisao, nomeCidade));
  } catch (error) {
    console.error("Falha ao consultar o serviço de clima:", error);
    return res.status(502).json({ erro: "Serviço de clima temporariamente indisponível" });
  }
}

async function obterContextoClimaOrb(widgetAtivo, coordenadas) {
  if (!widgetAtivo) return { widgetAtivo: false, disponivel: false };

  const consulta = {};
  if (coordenadas !== undefined && coordenadas !== null) {
    if (!coordenadas || typeof coordenadas !== "object" || Array.isArray(coordenadas)) {
      throw new OrbAiError("As coordenadas do widget de clima são inválidas.", 400);
    }
    const latitude = coordenadas.latitude;
    const longitude = coordenadas.longitude;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new OrbAiError("As coordenadas do widget de clima são inválidas.", 400);
    }
    consulta.lat = latitude;
    consulta.lon = longitude;
  }
  const { url, hasCoordinates, latitude, longitude } = criarUrlClima(consulta, true);
  url.searchParams.set(
    "current",
    "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m"
  );

  try {
    const [response, nomeCidade] = await Promise.all([
      fetch(url, { signal: AbortSignal.timeout(8000) }),
      hasCoordinates ? obterNomeCidade(latitude, longitude) : Promise.resolve(null)
    ]);
    const dados = await response.json();
    if (!response.ok || !dados.current || !Array.isArray(dados.daily?.time)) {
      throw new Error(dados.reason || "O serviço de clima retornou dados incompletos.");
    }
    const clima = normalizarClima(dados, hasCoordinates, false, nomeCidade);
    const previsao = dados.daily.time.slice(0, 7).map((data, indice) => ({
      data,
      condicao: classificarCodigoTempo(dados.daily.weather_code[indice]).description,
      maxima: dados.daily.temperature_2m_max[indice],
      minima: dados.daily.temperature_2m_min[indice],
      chanceChuva: dados.daily.precipitation_probability_max[indice]
    }));
    return {
      widgetAtivo: true,
      disponivel: true,
      cidade: clima.name,
      condicao: clima.weather[0].description,
      temperatura: clima.main.temp,
      sensacao: clima.main.feels_like,
      umidade: clima.main.humidity,
      vento: clima.wind.speed,
      previsao
    };
  } catch (error) {
    console.error("Não foi possível incluir o clima no contexto da Orb.IA:", error);
    return { widgetAtivo: true, disponivel: false };
  }
}

app.get("/clima", async (req, res) => {
  return responderClima(req, res, false);
});

app.get("/clima/previsao", async (req, res) => {
  return responderClima(req, res, true);
});

app.get("/cotacoes/criptomoedas/:codigo", async (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  const coinId = IDS_CRIPTOMOEDAS_COIN_GECKO[codigo];
  const dias = String(req.query.dias ?? "");
  if (!coinId || !["1", "7", "30"].includes(dias)) {
    return res.status(400).json({ erro: "Criptomoeda ou período inválido." });
  }

  const historicoIntradia = dias === "1";
  const chaveCache = `${codigo}:${historicoIntradia ? "1d" : "90d"}`;
  const cache = cacheCotacoesCripto.get(chaveCache);
  const ttlCache = historicoIntradia ? 60 * 1000 : CACHE_COTACOES_CRIPTO_TTL_MS;
  if (cache && Date.now() - cache.atualizadoEm < ttlCache) {
    res.set("Cache-Control", `public, max-age=${historicoIntradia ? 30 : 300}`);
    return res.json(cache.dados);
  }

  let requisicao = requisicoesCotacoesCripto.get(chaveCache);
  if (!requisicao) {
    requisicao = (async () => {
      const resposta = await buscarCoinGecko(
        `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=brl&days=${historicoIntradia ? 1 : 90}`
      );
      if (!resposta.ok) {
        throw new Error(`CoinGecko respondeu com status ${resposta.status}.`);
      }
      const dados = await resposta.json();
      if (!Array.isArray(dados.prices)) {
        throw new Error("A resposta do CoinGecko não contém cotações.");
      }
      cacheCotacoesCripto.set(chaveCache, { dados, atualizadoEm: Date.now() });
      return dados;
    })().finally(() => {
      requisicoesCotacoesCripto.delete(chaveCache);
    });
    requisicoesCotacoesCripto.set(chaveCache, requisicao);
  }

  try {
    const dados = await requisicao;
    res.set("Cache-Control", `public, max-age=${historicoIntradia ? 30 : 300}`);
    return res.json(dados);
  } catch (error) {
    if (cache) {
      console.warn(`CoinGecko falhou para ${codigo}; servindo cotação em cache:`, error);
      res.set("Cache-Control", `public, max-age=${historicoIntradia ? 30 : 60}`);
      return res.json(cache.dados);
    }
    console.error(`Não foi possível carregar a cotação de ${codigo}:`, error);
    return res.status(502).json({ erro: "Cotação indisponível no momento." });
  }
});

app.get("/cotacoes/moedas/:codigo", async (req, res) => {
  const codigo = req.params.codigo.toUpperCase();
  if (!SIMBOLOS_MOEDAS_YAHOO[codigo] || String(req.query.dias ?? "") !== "1") {
    return res.status(400).json({ erro: "Moeda ou período inválido." });
  }

  const cache = cacheCotacoesMoedas.get(codigo);
  if (cache && Date.now() - cache.atualizadoEm < 60 * 1000) {
    res.set("Cache-Control", "public, max-age=30");
    return res.json(cache.dados);
  }

  let requisicao = requisicoesCotacoesMoedas.get(codigo);
  if (!requisicao) {
    requisicao = (async () => {
      let precos;
      try {
        const simbolo = SIMBOLOS_MOEDAS_YAHOO[codigo];
        const resposta = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=1d&interval=5m`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!resposta.ok) {
          throw new Error(`Yahoo Finance respondeu com status ${resposta.status}.`);
        }
        const dados = await resposta.json();
        const resultado = dados.chart?.result?.[0];
        const timestamps = resultado?.timestamp;
        const fechamentos = resultado?.indicators?.quote?.[0]?.close;
        if (Array.isArray(timestamps) && Array.isArray(fechamentos)) {
          precos = timestamps
            .map((timestamp, indice) => [timestamp * 1000, Number(fechamentos[indice])])
            .filter(([timestamp, valor]) =>
              Number.isFinite(timestamp) && Number.isFinite(valor) && valor > 0
            );
        }
        if (!precos?.length) throw new Error("Yahoo Finance não retornou cotações intradiárias.");
      } catch (error) {
        console.warn(`Histórico intradiário indisponível para ${codigo}; usando a última cotação diária.`, error);
        const resposta = await fetch(
          `https://economia.awesomeapi.com.br/json/daily/${codigo}-BRL/1`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!resposta.ok) {
          throw new Error(`AwesomeAPI respondeu com status ${resposta.status}.`);
        }
        const dados = await resposta.json();
        const ultimaCotacao = Array.isArray(dados) ? dados[0] : null;
        const timestamp = Number(ultimaCotacao?.timestamp) * 1000;
        const valor = Number(ultimaCotacao?.bid);
        if (!Number.isFinite(timestamp) || !Number.isFinite(valor) || valor <= 0) {
          throw new Error(`AwesomeAPI não retornou uma cotação válida para ${codigo}.`);
        }
        precos = [[timestamp, valor]];
      }

      return { prices: precos };
    })().then(dados => {
      cacheCotacoesMoedas.set(codigo, { dados, atualizadoEm: Date.now() });
      return dados;
    }).finally(() => {
      requisicoesCotacoesMoedas.delete(codigo);
    });
    requisicoesCotacoesMoedas.set(codigo, requisicao);
  }

  try {
    const dados = await requisicao;
    res.set("Cache-Control", "public, max-age=30");
    return res.json(dados);
  } catch (error) {
    console.error(`Não foi possível carregar a cotação intradiária de ${codigo}:`, error);
    return res.status(502).json({ erro: "Cotação indisponível no momento." });
  }
});

app.post("/tarefas/importantes", async (req, res) => {
  const body = req.body ?? {};
  const { userId, data, hora, minuto } = body;
  const recorrente = body.recorrente === true;
  const texto = typeof body.texto === "string" ? body.texto.trim() : "";
  const dataCriacao = recorrente
    ? parseTaskSchedule(new Date().toLocaleDateString("sv-SE"), hora, minuto)
    : parseTaskSchedule(data, hora, minuto);
  const cor = body.cor ?? "#ffd700";
  if (!texto || texto.length > 300 || !dataCriacao || !validTaskColor(cor)) {
    return res.status(400).json({ erro: "Descrição, data, horário ou cor da tarefa inválida" });
  }

  const user = await findUser(userId, res);
  if (!user) return;

  normalizeTaskOrder(user.tarefasImportantes);
  user.tarefasImportantes.push({
    texto,
    dataCriacao,
    recorrente,
    cor,
    ordem: user.tarefasImportantes.length
  });
  await user.save();
  return res.status(201).json(user.tarefasImportantes.at(-1));
});

app.get("/tarefas/importantes/:userId", async (req, res) => {
  const filtro = req.query.filtro || "hoje";
  if (!["hoje", "semana", "mes", "todas"].includes(filtro)) {
    return res.status(400).json({ erro: "Filtro inválido" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  const hojeRecorrencia = new Date();
  hojeRecorrencia.setHours(0, 0, 0, 0);
  let atualizouRecorrencias = false;
  for (const tarefa of user.tarefasImportantes) {
    if (!tarefa.recorrente) continue;
    const dataTarefa = new Date(tarefa.dataCriacao);
    if (dataTarefa.getFullYear() === hojeRecorrencia.getFullYear() &&
        dataTarefa.getMonth() === hojeRecorrencia.getMonth() &&
        dataTarefa.getDate() === hojeRecorrencia.getDate()) continue;
    tarefa.dataCriacao = new Date(hojeRecorrencia);
    tarefa.dataCriacao.setHours(dataTarefa.getHours(), dataTarefa.getMinutes(), 0, 0);
    tarefa.concluida = false;
    tarefa.dataConclusao = null;
    tarefa.notificadoEm = null;
    atualizouRecorrencias = true;
  }
  if (atualizouRecorrencias) await user.save();
  normalizeTaskOrder(user.tarefasImportantes);
  if (user.isModified("tarefasImportantes")) await user.save();
  if (filtro === "todas") {
    return res.json([...user.tarefasImportantes].sort((a, b) => a.ordem - b.ordem));
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const tarefasImportantes = user.tarefasImportantes.filter(tarefa => !tarefa.recorrente);
  let inicio;
  let fim;

  if (filtro === "hoje") {
    inicio = hoje;
    fim = new Date(hoje);
    fim.setDate(fim.getDate() + 1);
  } else if (filtro === "semana") {
    inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - inicio.getDay());
    fim = new Date(inicio);
    fim.setDate(fim.getDate() + 7);
  } else {
    inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    fim = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
  }

  const tarefas = [...user.tarefasImportantes.filter(tarefa => tarefa.recorrente && filtro === "hoje"), ...tarefasImportantes.filter(tarefa =>
    tarefa.dataCriacao >= inicio && tarefa.dataCriacao < fim
  )].sort((a, b) => a.ordem - b.ordem);
  return res.json(tarefas);
});

app.put("/tarefas/importantes/:userId/ordem", async (req, res) => {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.some(id => !mongoose.isValidObjectId(id)) ||
      new Set(ids).size !== ids.length) {
    return res.status(400).json({ erro: "Lista de tarefas inválida" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  normalizeTaskOrder(user.tarefasImportantes);
  const idsImportantes = new Set(user.tarefasImportantes.map(tarefa => tarefa.id));

  if (ids.length !== user.tarefasImportantes.length || ids.some(id => !idsImportantes.has(id))) {
    return res.status(400).json({ erro: "A lista precisa conter todas as tarefas importantes" });
  }

  ids.forEach((id, ordem) => {
    user.tarefasImportantes.id(id).ordem = ordem;
  });
  await user.save();
  return res.json({ ok: true });
});

app.put("/tarefas/importantes/:userId/:tarefaId", async (req, res) => {
  const { userId, tarefaId } = req.params;
  if (!mongoose.isValidObjectId(tarefaId)) {
    return res.status(400).json({ erro: "Identificador de tarefa inválido" });
  }
  const { texto, concluida, cor, data, hora, minuto, recorrente } = req.body ?? {};
  const novoTexto = typeof texto === "string" ? texto.trim() : undefined;
  const scheduleRequested = data !== undefined || hora !== undefined || minuto !== undefined;
  const dataCriacao = scheduleRequested ? parseTaskSchedule(data, hora, minuto) : null;
  if (scheduleRequested && !dataCriacao) {
    return res.status(400).json({ erro: "Informe uma data e um horário válidos (minutos de 5 em 5)" });
  }
  if (texto !== undefined && (!novoTexto || novoTexto.length > 300)) {
    return res.status(400).json({ erro: "A descrição deve ter entre 1 e 300 caracteres" });
  }
  if (concluida !== undefined && typeof concluida !== "boolean") {
    return res.status(400).json({ erro: "Informe se a tarefa foi concluída" });
  }
  if (cor !== undefined && !validTaskColor(cor)) {
    return res.status(400).json({ erro: "Informe uma cor hexadecimal válida" });
  }
  if (recorrente !== undefined && typeof recorrente !== "boolean") {
    return res.status(400).json({ erro: "Informe se a tarefa é recorrente" });
  }
  if (novoTexto === undefined && concluida === undefined && cor === undefined && recorrente === undefined && !scheduleRequested) {
    return res.status(400).json({ erro: "Informe os dados que deseja alterar na tarefa" });
  }

  const user = await findUser(userId, res);
  if (!user) return;

  const tarefa = user.tarefasImportantes.id(tarefaId);
  if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada" });

  if (novoTexto !== undefined) tarefa.texto = novoTexto;
  if (cor !== undefined) tarefa.cor = cor;
  if (recorrente !== undefined) tarefa.recorrente = recorrente;
  if (recorrente === true) {
    const atual = new Date();
    tarefa.dataCriacao = parseTaskSchedule(atual.toLocaleDateString("sv-SE"), tarefa.dataCriacao.getHours(), tarefa.dataCriacao.getMinutes());
    tarefa.concluida = false;
    tarefa.dataConclusao = null;
    tarefa.notificadoEm = null;
  }
  if (scheduleRequested) {
    tarefa.dataCriacao = dataCriacao;
    tarefa.notificadoEm = null;
  }
  if (concluida !== undefined) {
    tarefa.concluida = concluida;
    tarefa.dataConclusao = tarefa.concluida ? new Date() : null;
  }
  await user.save();
  return res.json(tarefa);
});

app.delete("/tarefas/importantes/:userId/:tarefaId", async (req, res) => {
  const { userId, tarefaId } = req.params;
  if (!mongoose.isValidObjectId(tarefaId)) {
    return res.status(400).json({ erro: "Identificador de tarefa inválido" });
  }

  const user = await findUser(userId, res);
  if (!user) return;

  const tarefa = user.tarefasImportantes.id(tarefaId);
  if (!tarefa) return res.status(404).json({ erro: "Tarefa não encontrada" });

  tarefa.deleteOne();
  await user.save();
  return res.json({ ok: true });
});

app.get("/posts/:userId", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  return res.json(user.posts);
});

app.post("/posts/:userId", async (req, res) => {
  const { titulo, descricao, cor, x, y } = req.body ?? {};
  if (typeof titulo !== "string" || !titulo.trim() || titulo.trim().length > 100 ||
      typeof descricao !== "string" || descricao.length > 2000 ||
      !validTaskColor(cor) || !Number.isInteger(x) || !Number.isInteger(y) ||
      x < 0 || y < 0 || x > 10000 || y > 10000) {
    return res.status(400).json({ erro: "Título, descrição, cor ou posição do post-it inválidos" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  user.posts.push({ titulo: titulo.trim(), descricao: descricao.trim(), cor, x, y });
  await user.save();
  return res.status(201).json(user.posts.at(-1));
});

app.put("/posts/:userId/:postId", async (req, res) => {
  const { userId, postId } = req.params;
  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ erro: "Identificador de post-it inválido" });
  }

  const body = req.body ?? {};
  const hasPosition = Object.hasOwn(body, "x") || Object.hasOwn(body, "y");
  const hasSize = Object.hasOwn(body, "largura") || Object.hasOwn(body, "altura");
  if ((Object.hasOwn(body, "titulo") &&
        (typeof body.titulo !== "string" || !body.titulo.trim() || body.titulo.trim().length > 100)) ||
      (Object.hasOwn(body, "descricao") &&
        (typeof body.descricao !== "string" || body.descricao.length > 2000)) ||
      (Object.hasOwn(body, "cor") && !validTaskColor(body.cor)) ||
      (hasPosition && (!Number.isInteger(body.x) || !Number.isInteger(body.y) ||
        body.x < 0 || body.y < 0 || body.x > 10000 || body.y > 10000)) ||
      (hasSize && (!Number.isInteger(body.largura) || !Number.isInteger(body.altura) ||
        body.largura < 180 || body.largura > 900 || body.altura < 130 || body.altura > 1000)) ||
      (!hasPosition && !Object.hasOwn(body, "titulo") &&
        !Object.hasOwn(body, "descricao") && !Object.hasOwn(body, "cor") && !hasSize)) {
    return res.status(400).json({ erro: "Dados do post-it inválidos" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const post = user.posts.id(postId);
  if (!post) return res.status(404).json({ erro: "Post-it não encontrado" });

  if (Object.hasOwn(body, "titulo")) post.titulo = body.titulo.trim();
  if (Object.hasOwn(body, "descricao")) post.descricao = body.descricao.trim();
  if (Object.hasOwn(body, "cor")) post.cor = body.cor;
  if (hasPosition) {
    post.x = body.x;
    post.y = body.y;
  }
  if (hasSize) {
    post.largura = body.largura;
    post.altura = body.altura;
  }
  await user.save();
  return res.json(post);
});

app.delete("/posts/:userId/:postId", async (req, res) => {
  const { userId, postId } = req.params;
  if (!mongoose.isValidObjectId(postId)) {
    return res.status(400).json({ erro: "Identificador de post-it inválido" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const post = user.posts.id(postId);
  if (!post) return res.status(404).json({ erro: "Post-it não encontrado" });
  post.deleteOne();
  await user.save();
  return res.json({ ok: true });
});

app.get("/caderno/:userId", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  return res.json(user.folhasCaderno);
});

app.post("/caderno/:userId", async (req, res) => {
  const titulo = typeof req.body?.titulo === "string" ? req.body.titulo.trim() : "";
  if (titulo.length > 100) {
    return res.status(400).json({ erro: "O título da folha deve ter até 100 caracteres" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  const agora = new Date();
  user.folhasCaderno.push({
    titulo: titulo || `Folha ${user.folhasCaderno.length + 1}`,
    conteudo: "",
    criadaEm: agora,
    atualizadaEm: agora
  });
  await user.save();
  return res.status(201).json(user.folhasCaderno.at(-1));
});

app.put("/caderno/:userId/:folhaId", async (req, res) => {
  const { userId, folhaId } = req.params;
  if (!mongoose.isValidObjectId(folhaId)) {
    return res.status(400).json({ erro: "Identificador de folha inválido" });
  }

  const { titulo, conteudo } = req.body ?? {};
  if (typeof titulo !== "string" || !titulo.trim() || titulo.trim().length > 100 ||
      typeof conteudo !== "string" || conteudo.length > 8000) {
    return res.status(400).json({ erro: "Informe um título e uma anotação válida (até 8.000 caracteres)" });
  }

  const { pauta, corPauta, espacamentoPauta } = req.body;
  if ((pauta !== undefined && !["linhas", "quadriculada", "pontilhada", "sem-pauta"].includes(pauta)) ||
      (corPauta !== undefined && !validTaskColor(corPauta)) ||
      (espacamentoPauta !== undefined &&
        (!Number.isInteger(espacamentoPauta) || espacamentoPauta < 24 || espacamentoPauta > 48))) {
    return res.status(400).json({ erro: "Estilo ou espaçamento da pauta inválido" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const folha = user.folhasCaderno.id(folhaId);
  if (!folha) return res.status(404).json({ erro: "Folha não encontrada" });

  folha.titulo = titulo.trim();
  folha.conteudo = conteudo;
  if (pauta !== undefined) folha.pauta = pauta;
  if (corPauta !== undefined) folha.corPauta = corPauta;
  if (espacamentoPauta !== undefined) folha.espacamentoPauta = espacamentoPauta;
  folha.atualizadaEm = new Date();
  await user.save();
  return res.json(folha);
});

app.delete("/caderno/:userId/:folhaId", async (req, res) => {
  const { userId, folhaId } = req.params;
  if (!mongoose.isValidObjectId(folhaId)) {
    return res.status(400).json({ erro: "Identificador de folha inválido" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const folha = user.folhasCaderno.id(folhaId);
  if (!folha) return res.status(404).json({ erro: "Folha não encontrada" });
  folha.deleteOne();
  await user.save();
  return res.json({ ok: true });
});

app.get("/listas/:userId", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  const fusoHorario = req.query.fusoHorario;
  if (fusoHorario !== undefined && !fusoHorarioValido(fusoHorario)) {
    return res.status(400).json({ erro: "Fuso horario invalido" });
  }
  let alterado = false;
  for (const lista of user.listas) {
    if (fusoHorario && lista.fusoHorario !== fusoHorario) {
      lista.fusoHorario = fusoHorario;
      alterado = true;
    }
    if (sincronizarListaRecorrente(lista)) alterado = true;
  }
  if (alterado) await user.save();
  return res.json(user.listas);
});

app.post("/listas/:userId", async (req, res) => {
  const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
  const tipo = req.body?.tipo ?? "simples";
  const dataFinal = req.body?.dataFinal ?? "";
  const recorrencia = req.body?.recorrencia ?? "diaria";
  const diaRecorrencia = req.body?.diaRecorrencia ?? null;
  const fusoHorario = req.body?.fusoHorario ?? "UTC";
  if (!nome || nome.length > 100 || !["simples", "data", "recorrente"].includes(tipo) ||
      (tipo === "data" ? !isValidDateOnly(dataFinal) : dataFinal !== "") ||
      (tipo === "recorrente" && !["diaria", "semanal", "mensal", "dia_mes"].includes(recorrencia)) ||
      (tipo === "recorrente" && recorrencia === "dia_mes" && (!Number.isInteger(diaRecorrencia) || diaRecorrencia < 1 || diaRecorrencia > 31)) ||
      !fusoHorarioValido(fusoHorario)) {
    return res.status(400).json({ erro: "Informe um nome de lista de at\u00e9 100 caracteres" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  user.listas.push({ nome, tipo, dataFinal, recorrencia, diaRecorrencia: recorrencia === "dia_mes" ? diaRecorrencia : null, fusoHorario });
  await user.save();
  return res.status(201).json(user.listas.at(-1));
});

app.put("/listas/:userId/:listaId", async (req, res) => {
  const { userId, listaId } = req.params;
  const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
  const tipo = req.body?.tipo ?? "simples";
  const dataFinal = req.body?.dataFinal ?? "";
  const recorrencia = req.body?.recorrencia ?? "diaria";
  const diaRecorrencia = req.body?.diaRecorrencia ?? null;
  const fusoHorario = req.body?.fusoHorario ?? "UTC";
  if (!mongoose.isValidObjectId(listaId) || !nome || nome.length > 100 ||
      !["simples", "data", "recorrente"].includes(tipo) ||
      (tipo === "data" ? !isValidDateOnly(dataFinal) : dataFinal !== "") ||
      (tipo === "recorrente" && !["diaria", "semanal", "mensal", "dia_mes"].includes(recorrencia)) ||
      (tipo === "recorrente" && recorrencia === "dia_mes" && (!Number.isInteger(diaRecorrencia) || diaRecorrencia < 1 || diaRecorrencia > 31)) ||
      !fusoHorarioValido(fusoHorario)) {
    return res.status(400).json({ erro: "Lista inv\u00e1lida" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const lista = user.listas.id(listaId);
  if (!lista) return res.status(404).json({ erro: "Lista n\u00e3o encontrada" });
  lista.nome = nome;
  lista.tipo = tipo;
  lista.dataFinal = dataFinal;
  lista.recorrencia = recorrencia;
  lista.diaRecorrencia = recorrencia === "dia_mes" ? diaRecorrencia : null;
  lista.fusoHorario = fusoHorario;
  lista.periodoRecorrencia = "";
  sincronizarListaRecorrente(lista);
  await user.save();
  return res.json(lista);
});

app.delete("/listas/:userId/:listaId", async (req, res) => {
  const { userId, listaId } = req.params;
  if (!mongoose.isValidObjectId(listaId)) {
    return res.status(400).json({ erro: "Identificador de lista inv\u00e1lido" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const lista = user.listas.id(listaId);
  if (!lista) return res.status(404).json({ erro: "Lista n\u00e3o encontrada" });
  lista.deleteOne();
  await user.save();
  return res.json({ ok: true });
});

app.post("/listas/:userId/:listaId/itens", async (req, res) => {
  const { userId, listaId } = req.params;
  const texto = typeof req.body?.texto === "string" ? req.body.texto.trim() : "";
  if (!mongoose.isValidObjectId(listaId) || !texto || texto.length > 300) {
    return res.status(400).json({ erro: "Item de lista inv\u00e1lido" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const lista = user.listas.id(listaId);
  if (!lista) return res.status(404).json({ erro: "Lista n\u00e3o encontrada" });
  sincronizarListaRecorrente(lista);
  lista.itens.push({ texto });
  await user.save();
  return res.status(201).json(lista.itens.at(-1));
});

app.put("/listas/:userId/:listaId/itens/ordem", async (req, res) => {
  const { userId, listaId } = req.params;
  const itemIds = req.body?.itemIds;
  if (!mongoose.isValidObjectId(listaId) || !Array.isArray(itemIds) ||
      itemIds.some(itemId => typeof itemId !== "string" || !mongoose.isValidObjectId(itemId)) ||
      new Set(itemIds.map(itemId => itemId.toLowerCase())).size !== itemIds.length) {
    return res.status(400).json({ erro: "Ordem dos itens inválida" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const lista = user.listas.id(listaId);
  if (!lista) return res.status(404).json({ erro: "Lista não encontrada" });
  sincronizarListaRecorrente(lista);
  const idsAtuais = lista.itens.map(item => item.id);
  if (itemIds.length !== idsAtuais.length ||
      itemIds.some(itemId => !idsAtuais.includes(itemId))) {
    return res.status(400).json({ erro: "A ordem precisa conter todos os itens desta lista" });
  }

  const itensPorId = new Map(lista.itens.map(item => [item.id, item.toObject()]));
  lista.itens = itemIds.map(itemId => itensPorId.get(itemId));
  await user.save();
  return res.json({ ok: true });
});

app.post("/listas/:userId/:listaId/itens/:itemId/mover", async (req, res) => {
  const { userId, listaId, itemId } = req.params;
  const destinoListaId = req.body?.destinoListaId;
  if (!mongoose.isValidObjectId(listaId) || !mongoose.isValidObjectId(itemId) ||
      typeof destinoListaId !== "string" || !mongoose.isValidObjectId(destinoListaId) ||
      listaId.toLowerCase() === destinoListaId.toLowerCase()) {
    return res.status(400).json({ erro: "Origem ou destino do item inválido" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const listaOrigem = user.listas.id(listaId);
  const listaDestino = user.listas.id(destinoListaId);
  if (!listaOrigem || !listaDestino) {
    return res.status(404).json({ erro: "Lista de origem ou destino não encontrada" });
  }
  sincronizarListaRecorrente(listaOrigem);
  sincronizarListaRecorrente(listaDestino);
  const item = listaOrigem.itens.id(itemId);
  if (!item) return res.status(404).json({ erro: "Item não encontrado" });

  const itemMovido = item.toObject();
  item.deleteOne();
  listaDestino.itens.push(itemMovido);
  await user.save();
  return res.json({ ok: true });
});

app.put("/listas/:userId/:listaId/itens/:itemId", async (req, res) => {
  const { userId, listaId, itemId } = req.params;
  if (!mongoose.isValidObjectId(listaId) || !mongoose.isValidObjectId(itemId)) {
    return res.status(400).json({ erro: "Identificador de lista ou item inv\u00e1lido" });
  }

  const body = req.body ?? {};
  const texto = Object.hasOwn(body, "texto") && typeof body.texto === "string" ? body.texto.trim() : null;
  const concluido = body.concluido;
  if ((texto !== null && (!texto || texto.length > 300)) ||
      (Object.hasOwn(body, "concluido") && typeof concluido !== "boolean") ||
      (texto === null && !Object.hasOwn(body, "concluido"))) {
    return res.status(400).json({ erro: "Dados do item inv\u00e1lidos" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const lista = user.listas.id(listaId);
  if (lista) sincronizarListaRecorrente(lista);
  const item = lista?.itens.id(itemId);
  if (!item) return res.status(404).json({ erro: "Item n\u00e3o encontrado" });
  if (texto !== null) item.texto = texto;
  if (Object.hasOwn(body, "concluido")) item.concluido = concluido;
  await user.save();
  return res.json(item);
});

app.delete("/listas/:userId/:listaId/itens/:itemId", async (req, res) => {
  const { userId, listaId, itemId } = req.params;
  if (!mongoose.isValidObjectId(listaId) || !mongoose.isValidObjectId(itemId)) {
    return res.status(400).json({ erro: "Identificador de lista ou item inv\u00e1lido" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const lista = user.listas.id(listaId);
  const item = lista?.itens.id(itemId);
  if (!item) return res.status(404).json({ erro: "Item n\u00e3o encontrado" });
  item.deleteOne();
  await user.save();
  return res.json({ ok: true });
});

app.get("/habitos/:userId", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  const fusoHorario = req.query.fusoHorario;
  if (fusoHorario !== undefined) {
    if (!fusoHorarioValido(fusoHorario)) {
      return res.status(400).json({ erro: "Fuso horário inválido" });
    }
    let alterado = false;
    for (const habito of user.habitos) {
      if (habito.fusoHorario !== fusoHorario) {
        habito.fusoHorario = fusoHorario;
        alterado = true;
      }
    }
    if (alterado) await user.save();
  }
  return res.json(user.habitos);
});

app.post("/habitos/:userId", async (req, res) => {
  const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
  const tipo = req.body?.tipo ?? (Array.isArray(req.body?.horarios) && req.body.horarios.length ? "horarios" : "simples");
  const dataFinal = req.body?.dataFinal ?? "";
  const horario = req.body?.horario;
  const horarios = req.body?.horarios ?? [];
  const fusoHorario = req.body?.fusoHorario;
  if (!nome || nome.length > 100 || !["simples", "horarios", "objetivo"].includes(tipo) ||
      (tipo === "objetivo" ? !isValidDateOnly(dataFinal) : dataFinal !== "") ||
      (tipo === "objetivo" && horarios.length < 2) || typeof horario !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(horario) || !Array.isArray(horarios) ||
      horarios.length > 12 || horarios.some(item => typeof item !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item)) ||
      (horarios.length > 0 && (horarios.length < 2 || new Set(horarios).size !== horarios.length)) ||
      !fusoHorarioValido(fusoHorario)) {
    return res.status(400).json({ erro: "Informe um nome de até 100 caracteres e um horário válido" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  user.habitos.push({ nome, tipo, dataFinal, horario, horarios, fusoHorario });
  await user.save();
  return res.status(201).json(user.habitos.at(-1));
});

app.put("/habitos/:userId/:habitoId", async (req, res) => {
  const { userId, habitoId } = req.params;
  if (!mongoose.isValidObjectId(habitoId)) {
    return res.status(400).json({ erro: "Identificador de hábito inválido" });
  }
  const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
  const tipo = req.body?.tipo ?? (Array.isArray(req.body?.horarios) && req.body.horarios.length ? "horarios" : "simples");
  const dataFinal = req.body?.dataFinal ?? "";
  const horario = req.body?.horario;
  const horarios = req.body?.horarios ?? [];
  const fusoHorario = req.body?.fusoHorario;
  if (!nome || nome.length > 100 || !["simples", "horarios", "objetivo"].includes(tipo) ||
      (tipo === "objetivo" ? !isValidDateOnly(dataFinal) : dataFinal !== "") ||
      (tipo === "objetivo" && horarios.length < 2) || typeof horario !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(horario) || !Array.isArray(horarios) ||
      horarios.length > 12 || horarios.some(item => typeof item !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item)) ||
      (horarios.length > 0 && (horarios.length < 2 || new Set(horarios).size !== horarios.length)) ||
      !fusoHorarioValido(fusoHorario)) {
    return res.status(400).json({ erro: "Informe um nome de até 100 caracteres e um horário válido" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const habito = user.habitos.id(habitoId);
  if (!habito) return res.status(404).json({ erro: "Hábito não encontrado" });
  habito.nome = nome;
  habito.tipo = tipo;
  habito.dataFinal = dataFinal;
  habito.horario = horario;
  habito.horarios = horarios;
  habito.fusoHorario = fusoHorario;
  await user.save();
  return res.json(habito);
});

app.put("/habitos/:userId/:habitoId/conclusao", async (req, res) => {
  const { userId, habitoId } = req.params;
  if (!mongoose.isValidObjectId(habitoId)) {
    return res.status(400).json({ erro: "Identificador de hábito inválido" });
  }
  const data = req.body?.data;
  const horarioConcluido = req.body?.horario;
  const marcarTodos = req.body?.marcarTodos === true;
  if (!isValidDateOnly(data)) {
    return res.status(400).json({ erro: "Data inválida" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const habito = user.habitos.id(habitoId);
  if (!habito) return res.status(404).json({ erro: "Hábito não encontrado" });
  const hoje = dataHoraNoFuso(new Date(), habito.fusoHorario).data;
  if (habito.tipo === "objetivo" && hoje > habito.dataFinal) {
    return res.status(400).json({ erro: "Este objetivo ja foi finalizado" });
  }
  if (marcarTodos && !habito.horarios?.length) {
    return res.status(400).json({ erro: "Este hábito não possui múltiplos horários" });
  }
  if (data !== hoje) {
    return res.status(400).json({ erro: "Só é possível marcar ou desmarcar o hábito de hoje" });
  }
  if (habito.horarios?.length) {
    if (!marcarTodos && !habito.horarios.includes(horarioConcluido)) {
      return res.status(400).json({ erro: "Horário inválido para este hábito" });
    }
    if (marcarTodos) {
      const conclusoes = [...(habito.conclusoesHorarios || [])];
      for (const horario of habito.horarios) {
        const chaveConclusao = `${data}@${horario}`;
        if (!conclusoes.includes(chaveConclusao)) conclusoes.push(chaveConclusao);
      }
      habito.conclusoesHorarios = conclusoes;
    } else {
      const chaveConclusao = `${data}@${horarioConcluido}`;
      const indiceHorario = habito.conclusoesHorarios.indexOf(chaveConclusao);
      if (indiceHorario === -1) habito.conclusoesHorarios.push(chaveConclusao);
      else habito.conclusoesHorarios.splice(indiceHorario, 1);
    }

    const concluiuTodos = habito.horarios.every(horario =>
      habito.conclusoesHorarios.includes(`${data}@${horario}`)
    );
    const indiceDia = habito.diasConcluidos.indexOf(data);
    if (concluiuTodos && indiceDia === -1) habito.diasConcluidos.push(data);
    else if (!concluiuTodos && indiceDia !== -1) habito.diasConcluidos.splice(indiceDia, 1);
  } else {
    const indice = habito.diasConcluidos.indexOf(data);
    if (indice === -1) habito.diasConcluidos.push(data);
    else habito.diasConcluidos.splice(indice, 1);
  }
  await user.save();
  return res.json(habito);
});

app.delete("/habitos/:userId/:habitoId", async (req, res) => {
  const { userId, habitoId } = req.params;
  if (!mongoose.isValidObjectId(habitoId)) {
    return res.status(400).json({ erro: "Identificador de hábito inválido" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const habito = user.habitos.id(habitoId);
  if (!habito) return res.status(404).json({ erro: "Hábito não encontrado" });
  habito.deleteOne();
  await user.save();
  return res.json({ ok: true });
});

app.get("/notificacoes/:userId", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;

  const agora = new Date();
  const anteriores = user.notificacoes.length;
  user.notificacoes = user.notificacoes.filter(notificacao => notificacao.expiraEm > agora);
  if (user.notificacoes.length !== anteriores) await user.save();

  return res.json([...user.notificacoes].sort((a, b) => b.criadaEm - a.criadaEm));
});

app.put("/notificacoes/:userId/:notificacaoId", async (req, res) => {
  const { userId, notificacaoId } = req.params;
  if (!mongoose.isValidObjectId(notificacaoId)) {
    return res.status(400).json({ erro: "Identificador de notificação inválido" });
  }
  if (typeof req.body?.lida !== "boolean") {
    return res.status(400).json({ erro: "Informe o estado de leitura da notificação" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const notificacao = user.notificacoes.id(notificacaoId);
  if (!notificacao || notificacao.expiraEm <= new Date()) {
    return res.status(404).json({ erro: "Notificação não encontrada ou expirada" });
  }

  notificacao.lida = req.body.lida;
  await user.save();
  return res.json(notificacao);
});

app.delete("/notificacoes/:userId", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;

  user.notificacoes = [];
  await user.save();
  return res.json({ ok: true });
});

app.get("/notificacoes/:userId/usuarios", async (req, res) => {
  const autenticado = autenticarUsuarioPush(req, res);
  if (!autenticado) return;
  if (autenticado !== req.params.userId) return res.status(403).json({ erro: "A sessão não corresponde a esta conta." });
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  const prefixo = typeof req.query.prefixo === "string" ? req.query.prefixo.trim() : "";
  if (prefixo.length < 2 || prefixo.length > 60) return res.json({ usuarios: [] });
  const escaped = prefixo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filtro = { _id: { $ne: user._id }, nome: { $regex: `^${escaped}`, $options: "i" } };
  const encontrados = await User.find(filtro).select("_id nome").sort({ nome: 1 }).limit(8).lean();
  return res.json({ usuarios: encontrados.map(item => ({ id: String(item._id), nome: item.nome || "Usuário" })) });
});

app.get("/notificacoes/:userId/contatos-recentes", async (req, res) => {
  const autenticado = autenticarUsuarioPush(req, res);
  if (!autenticado) return;
  if (autenticado !== req.params.userId) return res.status(403).json({ erro: "A sessão não corresponde a esta conta." });
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  const ids = (user.contatosNotificacoesRecentes || []).slice(0, 20);
  const usuarios = await User.find({ _id: { $in: ids } }).select("_id nome").lean();
  const porId = new Map(usuarios.map(item => [String(item._id), item]));
  return res.json({ usuarios: ids.map(id => porId.get(String(id))).filter(Boolean).map(item => ({ id: String(item._id), nome: item.nome || "Usuário" })) });
});

app.post("/notificacoes/:userId/enviar", async (req, res) => {
  const autenticado = autenticarUsuarioPush(req, res);
  if (!autenticado) return;
  if (autenticado !== req.params.userId) return res.status(403).json({ erro: "A sessão não corresponde a esta conta." });
  const destinatarioId = typeof req.body?.destinatarioId === "string" ? req.body.destinatarioId.trim() : "";
  const tipo = req.body?.tipo;
  const texto = typeof req.body?.texto === "string" ? req.body.texto.trim() : "";
  if (!mongoose.isValidObjectId(destinatarioId) || !["mensagem", "tremida"].includes(tipo) ||
      (tipo === "mensagem" && (!texto || texto.length > 500)) || (tipo === "tremida" && texto.length > 500)) {
    return res.status(400).json({ erro: "Confira o destinatário e o conteúdo da notificação." });
  }
  const remetente = await findUser(autenticado, res);
  if (!remetente) return;
  if (String(remetente._id) === destinatarioId) return res.status(400).json({ erro: "Você não pode enviar uma notificação para si mesmo." });
  const destinatario = await findUser(destinatarioId, res);
  if (!destinatario) return;
  const agora = new Date();
  const notificacao = {
    titulo: tipo === "tremida" ? `${remetente.nome || "Alguém"} enviou uma tremida` : `Mensagem de ${remetente.nome || "alguém"}`,
    texto: tipo === "tremida" ? (texto || "Abra para receber uma tremida!") : texto,
    tarefaId: "",
    partidaId: "",
    ratingValendo: false,
    tipo: tipo === "tremida" ? "usuario_tremida" : "usuario_mensagem",
    remetenteId: String(remetente._id),
    remetenteNome: remetente.nome || "Usuário",
    criadaEm: agora,
    expiraEm: new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000),
    lida: false
  };
  destinatario.notificacoes.push(notificacao);
  await destinatario.save();
  remetente.contatosNotificacoesRecentes = [destinatario._id, ...(remetente.contatosNotificacoesRecentes || []).filter(id => String(id) !== destinatarioId)].slice(0, 20);
  await remetente.save();
  const salva = destinatario.notificacoes[destinatario.notificacoes.length - 1];
  await enviarPushParaUsuario(destinatario._id, {
    titulo: notificacao.titulo, texto: notificacao.texto, tipo: notificacao.tipo,
    notificationId: String(salva._id)
  });
  return res.status(201).json({ ok: true });
});

app.post("/notificacoes/:userId/fcm", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token || token.length > 4096 || /\s/.test(token)) {
    return res.status(400).json({ erro: "Token do Firebase inválido." });
  }
  const usuarioAutenticado = autenticarUsuarioPush(req, res);
  if (!usuarioAutenticado) return;
  if (usuarioAutenticado !== req.params.userId) {
    return res.status(403).json({ erro: "A sessão não corresponde a esta conta." });
  }
  const user = await findUser(req.params.userId, res);
  if (!user) return;

  await User.updateMany(
    { "pushTokens.token": token },
    { $pull: { pushTokens: { token } } }
  );
  await User.updateOne(
    { _id: user._id },
    { $push: { pushTokens: { $each: [{ token, registeredAt: new Date() }], $slice: -10 } } }
  );
  let pushEnabled = false;
  try {
    firebaseMessaging();
    pushEnabled = true;
  } catch (error) {
    console.error("Firebase Cloud Messaging está sem configuração válida no servidor.", error.message);
  }
  return res.json({ ok: true, pushEnabled });
});

app.delete("/notificacoes/:userId/fcm", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token || token.length > 4096 || /\s/.test(token)) {
    return res.status(400).json({ erro: "Token do Firebase inválido." });
  }
  const usuarioAutenticado = autenticarUsuarioPush(req, res);
  if (!usuarioAutenticado) return;
  if (usuarioAutenticado !== req.params.userId) {
    return res.status(403).json({ erro: "A sessão não corresponde a esta conta." });
  }
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  await User.updateOne({ _id: user._id }, { $pull: { pushTokens: { token } } });
  return res.json({ ok: true });
});

function autenticarUsuarioPush(req, res) {
  try {
    const cookies = (req.headers.cookie || "").split(";");
    const cookieSessao = cookies.find(cookie => cookie.trim().startsWith("orbySession="));
    const token = cookieSessao ? cookieSessao.trim().slice("orbySession=".length) : "";
    const userId = validarSessaoOrb(token);
    if (!userId) {
      res.status(401).json({ erro: "Sua sessão expirou. Entre novamente para ativar as notificações." });
      return null;
    }
    return userId;
  } catch (error) {
    if (error instanceof OrbAiError) {
      res.status(error.status).json({ erro: error.message });
      return null;
    }
    throw error;
  }
}

const CONFIG_FAZENDA = Object.freeze({
  culturaInicial: "trigo",
  canteirosIniciais: 3,
  canteirosMaximos: 9,
  precoAdubo: FARM_PRECO_ADUBO,
  mercado: {
    quantidadeMaximaAnuncio: 10_000,
    precoTotalMaximo: 1_000_000,
    sementesSistemaQuantidadeMaximaCompra: 10_000,
    limiteAnunciosAtivos: 20,
    limiteResultados: 40
  }
});

function criarFazendaInicial() {
  const inventario = {};
  for (const cultura of Object.values(FARM_PRECOS)) {
    inventario[cultura.itemSemente] = cultura.sementesIniciais;
    inventario[cultura.itemColheita] = 0;
  }
  const canteiroVazio = () => ({
    cultura: null,
    plantadoEm: null,
    amadureceEm: null,
    notificacaoProntaEnviadaEm: null,
    adubada: false,
    estado: "vazio"
  });
  return {
    inicializada: true,
    orbs: 0,
    inventario,
    canteiros: Array.from({ length: CONFIG_FAZENDA.canteirosIniciais }, canteiroVazio),
    adubos: 2,
    notificacoesHabilitadas: true,
    plantacao: canteiroVazio(),
    pedidosConcluidos: []
  };
}

async function carregarFazendaDoUsuario(userId, res) {
  const filtroInicializacao = {
    _id: userId,
    "fazenda.inicializada": { $ne: true }
  };
  await User.findOneAndUpdate(
    filtroInicializacao,
    { $set: { fazenda: criarFazendaInicial() } }
  );
  await User.updateOne(
    {
      _id: userId,
      "fazenda.inicializada": true,
      $or: FARM_ITENS_INVENTARIO.map(item => ({ [`fazenda.inventario.${item}`]: { $exists: false } }))
    },
    [{
      $set: Object.fromEntries(FARM_ITENS_INVENTARIO.map(item => [
        `fazenda.inventario.${item}`,
        { $ifNull: [`$fazenda.inventario.${item}`, 0] }
      ]))
    }],
    { updatePipeline: true }
  );
  await User.updateOne(
    { _id: userId, "fazenda.inicializada": true, "fazenda.pedidosConcluidos": { $exists: false } },
    { $set: { "fazenda.pedidosConcluidos": [] } }
  );
  const canteiroVazio = {
    cultura: null,
    plantadoEm: null,
    amadureceEm: null,
    notificacaoProntaEnviadaEm: null,
    adubada: false,
    estado: "vazio"
  };
  await User.updateOne(
    { _id: userId, "fazenda.inicializada": true, "fazenda.canteiros": { $exists: false } },
    [{
      $set: {
        "fazenda.canteiros": {
          $concatArrays: [[{
            $mergeObjects: [
              canteiroVazio,
              { $ifNull: ["$fazenda.plantacao", {}] }
            ]
          }], [canteiroVazio, canteiroVazio]]
        },
        "fazenda.adubos": { $ifNull: ["$fazenda.adubos", 2] }
      }
    }],
    { updatePipeline: true }
  );
  await User.updateOne(
    { _id: userId, "fazenda.inicializada": true, "fazenda.adubos": { $exists: false } },
    { $set: { "fazenda.adubos": 2 } }
  );

  let user = await User.findById(userId).select("fazenda");
  if (!user) {
    res.status(404).json({ erro: "Usuário não encontrado." });
    return null;
  }

  const agora = new Date();
  const dataPedidos = dataPedidosFazenda(agora);
  if (user.fazenda.pedidosData !== dataPedidos) {
    const userAtualizado = await User.findOneAndUpdate(
      {
        _id: userId,
        "fazenda.inicializada": true,
        "fazenda.pedidosData": { $ne: dataPedidos }
      },
      {
        $set: {
          "fazenda.pedidosData": dataPedidos,
          "fazenda.pedidosDiarios": gerarPedidosDiarios(dataPedidos),
          "fazenda.pedidosConcluidos": []
        }
      },
      { returnDocument: "after" }
    ).select("fazenda");
    user = userAtualizado || await User.findById(userId).select("fazenda");
    if (!user) {
      res.status(404).json({ erro: "Usuário não encontrado." });
      return null;
    }
  }
  return user.fazenda;
}

function dadosFazenda(fazenda, agora = new Date()) {
  const canteiroVazio = {
    estado: "vazio",
    cultura: null,
    plantadoEm: null,
    amadureceEm: null,
    notificacaoProntaEnviadaEm: null,
    segundosRestantes: 0,
    adubada: false
  };
  const formatarPlantacao = plantacao => {
    if (!plantacao || plantacao.estado === "vazio") return canteiroVazio;
    const amadureceEm = plantacao.amadureceEm ? new Date(plantacao.amadureceEm) : null;
    const pronta = plantacao.estado === "crescendo" && amadureceEm && amadureceEm <= agora;
    const segundosRestantes = plantacao.estado === "crescendo" && amadureceEm
      ? Math.max(0, Math.ceil((amadureceEm.getTime() - agora.getTime()) / 1000))
      : 0;
    return {
      estado: pronta ? "pronta" : "crescendo",
      cultura: plantacao.cultura,
      plantadoEm: plantacao.plantadoEm,
      amadureceEm,
      notificacaoProntaEnviadaEm: plantacao.notificacaoProntaEnviadaEm ?? null,
      segundosRestantes,
      adubada: plantacao.adubada === true
    };
  };
  const canteirosSalvos = Array.isArray(fazenda.canteiros) && fazenda.canteiros.length
    ? fazenda.canteiros
    : [fazenda.plantacao];
  const canteiros = canteirosSalvos.map(formatarPlantacao);
  return {
    orbs: fazenda.orbs,
    adubos: fazenda.adubos ?? 0,
    quantidadeCanteiros: canteiros.length,
    canteirosMaximos: CONFIG_FAZENDA.canteirosMaximos,
    precoProximoCanteiro: calcularPrecoProximoCanteiro(
      canteiros.length,
      CONFIG_FAZENDA.canteirosMaximos
    ),
    precoAdubo: CONFIG_FAZENDA.precoAdubo,
    notificacoesHabilitadas: fazenda.notificacoesHabilitadas !== false,
    inventario: {
      ...Object.fromEntries(FARM_ITENS_INVENTARIO.map(item => [item, fazenda.inventario[item] ?? 0]))
    },
    canteiros,
    plantacao: canteiros[0] ?? canteiroVazio,
    configuracao: {
      culturas: FARM_PRECOS
    },
    dataPedidos: fazenda.pedidosData,
    pedidosLimiteDiario: FARM_PEDIDOS_DIARIOS_MAX,
    pedidos: (fazenda.pedidosDiarios ?? []).map(pedido => {
      const cultura = Object.values(FARM_PRECOS).find(item => item.itemColheita === pedido.item);
      const concluido = fazenda.pedidosConcluidos?.some(item => item.id === pedido.id) ?? false;
      return {
        id: pedido.id,
        item: pedido.item,
        quantidade: pedido.quantidade,
        recompensaOrbs: pedido.recompensaOrbs,
        nome: cultura?.nome ?? pedido.item,
        concluido
      };
    })
  };
}

async function notificarColheitaPronta(
  userId,
  culturaNome,
  amadureceEm,
  indiceCanteiro = 0,
  agora = new Date(),
  usarPlantacaoLegada = false
) {
  const cultura = FARM_PRECOS[culturaNome];
  if (!cultura || !(amadureceEm instanceof Date) || amadureceEm > agora) return false;
  const canteiroPath = usarPlantacaoLegada
    ? "fazenda.plantacao"
    : `fazenda.canteiros.${indiceCanteiro}`;

  const notificacao = {
    _id: new mongoose.Types.ObjectId(),
    titulo: "🌱 Colheita pronta!",
    texto: `Sua plantação de ${cultura.nome.toLowerCase()} no canteiro ${indiceCanteiro + 1} está pronta para colher.`,
    tipo: "fazenda",
    criadaEm: agora,
    expiraEm: new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000),
    lida: false
  };
  const resultado = await User.updateOne(
    {
      _id: userId,
      "fazenda.notificacoesHabilitadas": { $ne: false },
      [`${canteiroPath}.estado`]: "crescendo",
      [`${canteiroPath}.cultura`]: culturaNome,
      [`${canteiroPath}.amadureceEm`]: amadureceEm,
      $or: [
        { [`${canteiroPath}.notificacaoProntaEnviadaEm`]: null },
        { [`${canteiroPath}.notificacaoProntaEnviadaEm`]: { $exists: false } }
      ]
    },
    {
      $set: { [`${canteiroPath}.notificacaoProntaEnviadaEm`]: agora },
      $push: { notificacoes: notificacao }
    }
  );
  if (resultado.modifiedCount !== 1) return false;
  await enviarPushParaUsuario(userId, {
    ...notificacao,
    notificationId: String(notificacao._id)
  });
  return true;
}

app.get("/api/fazenda", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const fazenda = await carregarFazendaDoUsuario(userId, res);
  if (!fazenda) return;
  return res.json(dadosFazenda(fazenda));
});

app.post("/api/fazenda/venda-rapida", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const cultura = Object.values(FARM_PRECOS).find(item => item.itemColheita === req.body?.item);
  if (!cultura) return res.status(400).json({ erro: "Escolha um vegetal válido para vender." });
  const quantidade = req.body?.quantidade;
  if (!Number.isSafeInteger(quantidade) || quantidade < 1) {
    return res.status(400).json({ erro: "Informe uma quantidade válida para vender." });
  }

  const agora = new Date();
  const valorUnitarioCentavos = Math.round(calcularPrecoVendaRapidaOrbs(cultura) * 100);
  const valorTotalCentavos = valorUnitarioCentavos * quantidade;
  if (!Number.isSafeInteger(valorTotalCentavos)) {
    return res.status(400).json({ erro: "O valor total da venda excede o limite numérico suportado." });
  }
  const valorOrbs = valorTotalCentavos / 100;
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      "fazenda.inicializada": true,
      [`fazenda.inventario.${cultura.itemColheita}`]: { $gte: quantidade }
    },
    {
      $inc: {
        [`fazenda.inventario.${cultura.itemColheita}`]: -quantidade,
        "fazenda.orbs": valorOrbs
      }
    },
    { returnDocument: "after" }
  ).select("fazenda");

  if (!user) {
    const fazenda = await carregarFazendaDoUsuario(userId, res);
    if (!fazenda) return;
    return res.status(400).json({
      erro: `Você não tem ${quantidade} ${cultura.nome.toLowerCase()}${quantidade === 1 ? "" : "s"} disponível${quantidade === 1 ? "" : "is"} para vender.`,
      fazenda: dadosFazenda(fazenda, agora)
    });
  }

  return res.json({
    fazenda: dadosFazenda(user.fazenda, agora),
    venda: { item: cultura.itemColheita, quantidade, orbs: valorOrbs }
  });
});

app.get("/api/fazenda/ranking", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const jogadores = await User.find({ "fazenda.orbs": { $gte: 1 } })
    .select("nome fazenda.orbs fotoPerfilPublicId")
    .sort({ "fazenda.orbs": -1, nome: 1, _id: 1 })
    .limit(20)
    .lean();
  return res.json({
    jogadores: jogadores.map((jogador, index) => ({
      posicao: index + 1,
      nome: jogador.nome || "Jogador",
      orbs: jogador.fazenda.orbs,
      fotoPerfilUrl: urlFotoPerfil(jogador.fotoPerfilPublicId)
    }))
  });
});

app.put("/api/fazenda/notificacoes", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  if (typeof req.body?.habilitadas !== "boolean") {
    return res.status(400).json({ erro: "Informe se as notificações da Orby Farm devem ficar habilitadas." });
  }
  const fazenda = await carregarFazendaDoUsuario(userId, res);
  if (!fazenda) return;
  const user = await User.findOneAndUpdate(
    { _id: userId, "fazenda.inicializada": true },
    { $set: { "fazenda.notificacoesHabilitadas": req.body.habilitadas } },
    { returnDocument: "after" }
  ).select("fazenda");
  if (!user) return res.status(404).json({ erro: "Usuário não encontrado." });
  return res.json({ fazenda: dadosFazenda(user.fazenda) });
});

app.post("/api/fazenda/colheita/notificar", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const fazenda = await carregarFazendaDoUsuario(userId, res);
  if (!fazenda) return;
  const indiceCanteiro = req.body?.canteiro ?? 0;
  if (!Number.isSafeInteger(indiceCanteiro) || indiceCanteiro < 0 ||
      indiceCanteiro >= fazenda.canteiros.length) {
    return res.status(400).json({ erro: "Escolha um canteiro válido." });
  }
  const plantacao = fazenda.canteiros[indiceCanteiro];
  const agora = new Date();
  if (plantacao.estado !== "crescendo" || !plantacao.amadureceEm || plantacao.amadureceEm > agora) {
    return res.json({ notificada: false });
  }
  const notificada = fazenda.notificacoesHabilitadas !== false
    ? await notificarColheitaPronta(userId, plantacao.cultura, plantacao.amadureceEm, indiceCanteiro, agora)
    : false;
  return res.json({ notificada });
});

app.post("/api/fazenda/plantar", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const indiceCanteiro = req.body?.canteiro ?? 0;
  if (!Number.isSafeInteger(indiceCanteiro) || indiceCanteiro < 0) {
    return res.status(400).json({ erro: "Escolha um canteiro válido." });
  }
  const culturaNome = req.body?.cultura || CONFIG_FAZENDA.culturaInicial;
  const cultura = Object.hasOwn(FARM_PRECOS, culturaNome) ? FARM_PRECOS[culturaNome] : null;
  if (!cultura) return res.status(400).json({ erro: "Escolha uma cultura válida para plantar." });
  const fazenda = await carregarFazendaDoUsuario(userId, res);
  if (!fazenda) return;
  const plantacao = fazenda.canteiros[indiceCanteiro];
  if (!plantacao) return res.status(400).json({ erro: "Escolha um canteiro válido.", fazenda: dadosFazenda(fazenda) });
  if (plantacao.estado !== "vazio") {
    return res.status(409).json({ erro: "O canteiro já está ocupado.", fazenda: dadosFazenda(fazenda) });
  }
  if ((fazenda.inventario[cultura.itemSemente] ?? 0) < 1) {
    return res.status(400).json({ erro: `Você não tem sementes de ${cultura.nome.toLowerCase()}.`, fazenda: dadosFazenda(fazenda) });
  }

  const plantadoEm = new Date();
  const amadureceEm = new Date(plantadoEm.getTime() + cultura.tempoCrescimentoSegundos * 1000);
  const canteiroPath = `fazenda.canteiros.${indiceCanteiro}`;
  const camposPlantacao = {
    [`${canteiroPath}.cultura`]: culturaNome,
    [`${canteiroPath}.plantadoEm`]: plantadoEm,
    [`${canteiroPath}.amadureceEm`]: amadureceEm,
    [`${canteiroPath}.notificacaoProntaEnviadaEm`]: null,
    [`${canteiroPath}.adubada`]: false,
    [`${canteiroPath}.estado`]: "crescendo"
  };
  if (indiceCanteiro === 0) {
    Object.assign(camposPlantacao, {
      "fazenda.plantacao.cultura": culturaNome,
      "fazenda.plantacao.plantadoEm": plantadoEm,
      "fazenda.plantacao.amadureceEm": amadureceEm,
      "fazenda.plantacao.notificacaoProntaEnviadaEm": null,
      "fazenda.plantacao.adubada": false,
      "fazenda.plantacao.estado": "crescendo"
    });
  }
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      "fazenda.inicializada": true,
      [`${canteiroPath}.estado`]: "vazio",
      [`fazenda.inventario.${cultura.itemSemente}`]: { $gte: 1 }
    },
    {
      $inc: { [`fazenda.inventario.${cultura.itemSemente}`]: -1 },
      $set: camposPlantacao
    },
    { returnDocument: "after" }
  ).select("fazenda");

  if (!user) {
    const estadoAtual = await User.findById(userId).select("fazenda");
    if (!estadoAtual) return res.status(404).json({ erro: "Usuário não encontrado." });
    const atual = estadoAtual.fazenda;
    if (atual.canteiros[indiceCanteiro]?.estado !== "vazio") {
      return res.status(409).json({ erro: "O canteiro já está ocupado.", fazenda: dadosFazenda(atual) });
    }
    return res.status(400).json({
      erro: `Você não tem sementes de ${cultura.nome.toLowerCase()}.`,
      fazenda: dadosFazenda(atual)
    });
  }
  return res.status(201).json({ fazenda: dadosFazenda(user.fazenda) });
});

app.post("/api/fazenda/colher", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const indiceCanteiro = req.body?.canteiro ?? 0;
  if (!Number.isSafeInteger(indiceCanteiro) || indiceCanteiro < 0) {
    return res.status(400).json({ erro: "Escolha um canteiro válido." });
  }
  const fazenda = await carregarFazendaDoUsuario(userId, res);
  if (!fazenda) return;
  const plantacao = fazenda.canteiros[indiceCanteiro];
  const agora = new Date();

  if (!plantacao) return res.status(400).json({ erro: "Escolha um canteiro válido.", fazenda: dadosFazenda(fazenda, agora) });
  if (plantacao.estado === "vazio") {
    return res.status(409).json({ erro: "Não há nada plantado para colher.", fazenda: dadosFazenda(fazenda, agora) });
  }
  const culturaNome = plantacao.cultura;
  const cultura = Object.hasOwn(FARM_PRECOS, culturaNome) ? FARM_PRECOS[culturaNome] : null;
  if (!cultura) {
    return res.status(409).json({ erro: "A cultura plantada não é válida.", fazenda: dadosFazenda(fazenda, agora) });
  }
  if (!plantacao.amadureceEm || plantacao.amadureceEm > agora) {
    return res.status(409).json({ erro: `${cultura.nome} ainda está crescendo.`, fazenda: dadosFazenda(fazenda, agora) });
  }

  const recebeuSemente = Math.random() < cultura.chanceSementeColheita;
  const quantidadeColheita = cultura.quantidadeColheita * (plantacao.adubada ? 2 : 1);
  const canteiroPath = `fazenda.canteiros.${indiceCanteiro}`;
  const camposPlantacao = {
    [`${canteiroPath}.cultura`]: null,
    [`${canteiroPath}.plantadoEm`]: null,
    [`${canteiroPath}.amadureceEm`]: null,
    [`${canteiroPath}.notificacaoProntaEnviadaEm`]: null,
    [`${canteiroPath}.adubada`]: false,
    [`${canteiroPath}.estado`]: "vazio"
  };
  if (indiceCanteiro === 0) {
    Object.assign(camposPlantacao, {
      "fazenda.plantacao.cultura": null,
      "fazenda.plantacao.plantadoEm": null,
      "fazenda.plantacao.amadureceEm": null,
      "fazenda.plantacao.notificacaoProntaEnviadaEm": null,
      "fazenda.plantacao.adubada": false,
      "fazenda.plantacao.estado": "vazio"
    });
  }
  const atualizacoes = {
    $inc: {
      [`fazenda.inventario.${cultura.itemColheita}`]: quantidadeColheita,
      ...(recebeuSemente ? { [`fazenda.inventario.${cultura.itemSemente}`]: 1 } : {})
    },
    $set: camposPlantacao
  };
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      [`${canteiroPath}.estado`]: "crescendo",
      [`${canteiroPath}.amadureceEm`]: { $lte: agora }
    },
    atualizacoes,
    { returnDocument: "after" }
  ).select("fazenda");

  if (!user) {
    const estadoAtual = await User.findById(userId).select("fazenda");
    if (!estadoAtual) return res.status(404).json({ erro: "Usuário não encontrado." });
    const plantacaoAtual = estadoAtual.fazenda.canteiros[indiceCanteiro];
    return res.status(409).json({
      erro: plantacaoAtual?.estado === "vazio"
        ? "Esta plantação já foi colhida."
        : "A cultura ainda está crescendo.",
      fazenda: dadosFazenda(estadoAtual.fazenda)
    });
  }
  return res.json({
    fazenda: dadosFazenda(user.fazenda),
    colheita: {
      [cultura.itemColheita]: quantidadeColheita,
      [cultura.itemSemente]: recebeuSemente ? 1 : 0
    },
    canteiro: indiceCanteiro
  });
});

app.post("/api/fazenda/canteiro/expandir", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const fazenda = await carregarFazendaDoUsuario(userId, res);
  if (!fazenda) return;
  const quantidadeCanteiros = fazenda.canteiros.length;
  if (quantidadeCanteiros >= CONFIG_FAZENDA.canteirosMaximos) {
    return res.status(409).json({ erro: "Sua horta já tem todos os canteiros disponíveis.", fazenda: dadosFazenda(fazenda) });
  }

  const preco = calcularPrecoProximoCanteiro(
    quantidadeCanteiros,
    CONFIG_FAZENDA.canteirosMaximos
  );
  if (preco === null) {
    return res.status(409).json({
      erro: "Não há mais canteiros disponíveis para comprar.",
      fazenda: dadosFazenda(fazenda)
    });
  }
  const canteiroVazio = {
    cultura: null,
    plantadoEm: null,
    amadureceEm: null,
    notificacaoProntaEnviadaEm: null,
    adubada: false,
    estado: "vazio"
  };
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      "fazenda.inicializada": true,
      "fazenda.orbs": { $gte: preco },
      "fazenda.canteiros": { $size: quantidadeCanteiros }
    },
    {
      $inc: { "fazenda.orbs": -preco },
      $push: { "fazenda.canteiros": canteiroVazio }
    },
    { returnDocument: "after" }
  ).select("fazenda");

  if (!user) {
    const atual = await carregarFazendaDoUsuario(userId, res);
    if (!atual) return;
    return res.status(400).json({
      erro: atual.orbs < preco
        ? `Você precisa de ${preco} Orbs para abrir outro canteiro.`
        : "A horta mudou enquanto você comprava o canteiro. Tente novamente.",
      fazenda: dadosFazenda(atual)
    });
  }
  return res.status(201).json({ fazenda: dadosFazenda(user.fazenda), preco });
});

app.post("/api/fazenda/adubo/comprar", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const quantidade = req.body?.quantidade ?? 1;
  if (!Number.isSafeInteger(quantidade) || quantidade < 1 || quantidade > 100) {
    return res.status(400).json({ erro: "Escolha uma quantidade entre 1 e 100 sacos de adubo." });
  }
  const preco = quantidade * CONFIG_FAZENDA.precoAdubo;
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      "fazenda.inicializada": true,
      "fazenda.orbs": { $gte: preco }
    },
    {
      $inc: { "fazenda.orbs": -preco, "fazenda.adubos": quantidade }
    },
    { returnDocument: "after" }
  ).select("fazenda");
  if (!user) {
    const fazenda = await carregarFazendaDoUsuario(userId, res);
    if (!fazenda) return;
    return res.status(400).json({
      erro: `Você precisa de ${preco} Orbs para comprar ${quantidade} ${quantidade === 1 ? "saco" : "sacos"} de adubo.`,
      fazenda: dadosFazenda(fazenda)
    });
  }
  return res.json({
    fazenda: dadosFazenda(user.fazenda),
    compra: { quantidade, orbs: preco }
  });
});

app.post("/api/fazenda/adubo/aplicar", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const indiceCanteiro = req.body?.canteiro;
  if (!Number.isSafeInteger(indiceCanteiro) || indiceCanteiro < 0) {
    return res.status(400).json({ erro: "Escolha um canteiro válido." });
  }
  const fazenda = await carregarFazendaDoUsuario(userId, res);
  if (!fazenda) return;
  const plantacao = fazenda.canteiros[indiceCanteiro];
  if (!plantacao) return res.status(400).json({ erro: "Escolha um canteiro válido.", fazenda: dadosFazenda(fazenda) });
  if (fazenda.adubos < 1) {
    return res.status(400).json({ erro: "Você não tem adubo. Compre um saco na horta.", fazenda: dadosFazenda(fazenda) });
  }
  if (plantacao.estado !== "crescendo" || !plantacao.amadureceEm || plantacao.amadureceEm <= new Date()) {
    return res.status(409).json({ erro: "Só é possível adubar uma plantação que ainda está crescendo.", fazenda: dadosFazenda(fazenda) });
  }
  if (plantacao.adubada) {
    return res.status(409).json({ erro: "Este canteiro já recebeu adubo.", fazenda: dadosFazenda(fazenda) });
  }

  const agora = new Date();
  const amadureceEm = new Date(agora.getTime() + Math.max(
    1,
    Math.floor((new Date(plantacao.amadureceEm).getTime() - agora.getTime()) * 0.8)
  ));
  const canteiroPath = `fazenda.canteiros.${indiceCanteiro}`;
  const campos = {
    [`${canteiroPath}.amadureceEm`]: amadureceEm,
    [`${canteiroPath}.adubada`]: true,
    [`${canteiroPath}.notificacaoProntaEnviadaEm`]: null
  };
  if (indiceCanteiro === 0) {
    Object.assign(campos, {
      "fazenda.plantacao.amadureceEm": amadureceEm,
      "fazenda.plantacao.adubada": true,
      "fazenda.plantacao.notificacaoProntaEnviadaEm": null
    });
  }
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      "fazenda.adubos": { $gte: 1 },
      [`${canteiroPath}.estado`]: "crescendo",
      [`${canteiroPath}.amadureceEm`]: plantacao.amadureceEm,
      [`${canteiroPath}.adubada`]: { $ne: true }
    },
    {
      $inc: { "fazenda.adubos": -1 },
      $set: campos
    },
    { returnDocument: "after" }
  ).select("fazenda");
  if (!user) {
    const atual = await carregarFazendaDoUsuario(userId, res);
    if (!atual) return;
    return res.status(409).json({
      erro: atual.adubos < 1
        ? "Você não tem mais adubo disponível."
        : "A plantação mudou enquanto o adubo era aplicado. Atualize e tente novamente.",
      fazenda: dadosFazenda(atual)
    });
  }
  return res.json({ fazenda: dadosFazenda(user.fazenda), canteiro: indiceCanteiro });
});

app.post("/api/fazenda/pedido/entregar", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const fazenda = await carregarFazendaDoUsuario(userId, res);
  if (!fazenda) return;
  const pedidoDiario = fazenda.pedidosDiarios.find(item => item.id === req.body?.pedidoId);
  if (!pedidoDiario) {
    return res.status(400).json({
      erro: "Este pedido não está entre as ofertas de hoje.",
      fazenda: dadosFazenda(fazenda)
    });
  }
  const cultura = Object.values(FARM_PRECOS).find(item => item.itemColheita === pedidoDiario.item);
  if (!cultura || !Number.isSafeInteger(pedidoDiario.quantidade) || pedidoDiario.quantidade < 1 ||
      !Number.isSafeInteger(pedidoDiario.recompensaOrbs) || pedidoDiario.recompensaOrbs < 0) {
    return res.status(500).json({ erro: "A configuração deste pedido é inválida." });
  }
  const pedido = {
    id: pedidoDiario.id,
    item: pedidoDiario.item,
    quantidade: pedidoDiario.quantidade,
    recompensaOrbs: pedidoDiario.recompensaOrbs,
    nome: cultura.nome
  };
  const agora = new Date();
  if (fazenda.pedidosConcluidos.some(item => item.id === pedido.id)) {
    return res.status(409).json({
      erro: "Este pedido já foi concluído hoje.",
      fazenda: dadosFazenda(fazenda, agora)
    });
  }
  if ((fazenda.inventario[pedido.item] ?? 0) < pedido.quantidade) {
    return res.status(400).json({ erro: `Você precisa de ${pedido.quantidade} ${pedido.nome.toLowerCase()} para concluir o pedido.`, fazenda: dadosFazenda(fazenda, agora) });
  }

  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      "fazenda.inicializada": true,
      "fazenda.pedidosData": fazenda.pedidosData,
      "fazenda.pedidosDiarios": { $elemMatch: { id: pedido.id } },
      [`fazenda.inventario.${pedido.item}`]: { $gte: pedido.quantidade },
      "fazenda.pedidosConcluidos": {
        $not: {
          $elemMatch: { id: pedido.id }
        }
      }
    },
    {
      $inc: {
        [`fazenda.inventario.${pedido.item}`]: -pedido.quantidade,
        "fazenda.orbs": pedido.recompensaOrbs
      },
      $push: {
        "fazenda.pedidosConcluidos": {
          id: pedido.id,
          item: pedido.item,
          quantidade: pedido.quantidade,
          recompensaOrbs: pedido.recompensaOrbs,
          concluidoEm: agora
        }
      }
    },
    { returnDocument: "after" }
  ).select("fazenda");

  if (!user) {
    const atual = await carregarFazendaDoUsuario(userId, res);
    if (!atual) return;
    const pedidoAtual = atual.pedidosDiarios.find(item => item.id === pedido.id);
    const jaConcluido = atual.pedidosConcluidos.some(item => item.id === pedido.id);
    return res.status(409).json({
      erro: !pedidoAtual
        ? "Os pedidos de hoje foram renovados. Atualize a lista."
        : jaConcluido
          ? "Este pedido já foi concluído hoje."
          : `Você precisa de ${pedido.quantidade} ${pedido.nome.toLowerCase()} para concluir o pedido.`,
      fazenda: dadosFazenda(atual, agora)
    });
  }

  return res.json({
    fazenda: dadosFazenda(user.fazenda, agora),
    entrega: {
      item: pedido.item,
      quantidade: pedido.quantidade,
      orbs: pedido.recompensaOrbs
    }
  });
});

app.get("/api/fazenda/mercado", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const fazenda = await carregarFazendaDoUsuario(userId, res);
  if (!fazenda) return;
  const anuncios = await User.aggregate([
    { $match: { "fazenda.anuncios.status": "ativo" } },
    { $unwind: "$fazenda.anuncios" },
    { $match: { "fazenda.anuncios.status": "ativo", "fazenda.anuncios.quantidadeRestante": { $gt: 0 } } },
    { $sort: { "fazenda.anuncios.criadoEm": -1 } },
    { $limit: CONFIG_FAZENDA.mercado.limiteResultados },
    {
      $project: {
        _id: { $toString: "$fazenda.anuncios._id" },
        item: "$fazenda.anuncios.item",
        quantidade: "$fazenda.anuncios.quantidadeRestante",
        precoTotal: {
          $ifNull: [
            "$fazenda.anuncios.precoTotal",
            { $multiply: ["$fazenda.anuncios.precoUnitario", "$fazenda.anuncios.quantidadeRestante"] }
          ]
        },
        criadoEm: "$fazenda.anuncios.criadoEm",
        vendedor: { $ifNull: ["$nome", { $ifNull: ["$email", "Agricultor"] }] },
        fotoPerfilPublicId: "$fotoPerfilPublicId",
        isMine: { $eq: [{ $toString: "$_id" }, userId] }
      }
    }
  ]).then(resultados => resultados.map(({ fotoPerfilPublicId, ...anuncio }) => ({
    ...anuncio,
    fotoPerfilUrl: urlFotoPerfil(fotoPerfilPublicId)
  })));
  return res.json({
    anuncios,
    ofertasSementes: Object.entries(FARM_PRECOS)
      .map(([cultura, dados]) => ({
        cultura,
        item: dados.itemSemente,
        nome: dados.nome,
        precoUnitario: dados.precoSementeOrbs,
        quantidadeMaximaCompra: CONFIG_FAZENDA.mercado.sementesSistemaQuantidadeMaximaCompra
      }))
      .sort((a, b) => a.precoUnitario - b.precoUnitario || a.nome.localeCompare(b.nome, "pt-BR"))
  });
});

app.post("/api/fazenda/mercado/anunciar", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const item = req.body?.item;
  const cultura = Object.values(FARM_PRECOS).find(dados =>
    dados.itemSemente === item || dados.itemColheita === item
  );
  if (!cultura) {
    return res.status(400).json({ erro: "Escolha um produto válido para anunciar." });
  }
  const inventarioCampo = item;
  const nomeItem = item === cultura.itemSemente
    ? `sementes de ${cultura.nome.toLowerCase()}`
    : cultura.nome.toLowerCase();
  const quantidade = req.body?.quantidade;
  const precoTotal = req.body?.precoTotal;
  if (!Number.isSafeInteger(quantidade) || quantidade < 1 ||
      quantidade > CONFIG_FAZENDA.mercado.quantidadeMaximaAnuncio) {
    return res.status(400).json({ erro: "Informe uma quantidade válida para anunciar." });
  }
  if (!Number.isSafeInteger(precoTotal) || precoTotal < 1 ||
      precoTotal > CONFIG_FAZENDA.mercado.precoTotalMaximo) {
    return res.status(400).json({ erro: "O preço total do lote deve ser um número inteiro entre 1 e 1.000.000 Orbs." });
  }

  const agora = new Date();
  const anuncio = {
    item,
    quantidadeOriginal: quantidade,
    quantidadeRestante: quantidade,
    precoTotal,
    status: "ativo",
    criadoEm: agora
  };
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      "fazenda.inicializada": true,
      [`fazenda.inventario.${inventarioCampo}`]: { $gte: quantidade },
      $expr: {
        $lt: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ["$fazenda.anuncios", []] },
                as: "anuncio",
                cond: { $eq: ["$$anuncio.status", "ativo"] }
              }
            }
          },
          CONFIG_FAZENDA.mercado.limiteAnunciosAtivos
        ]
      }
    },
    {
      $inc: { [`fazenda.inventario.${inventarioCampo}`]: -quantidade },
      $push: { "fazenda.anuncios": anuncio }
    },
    { returnDocument: "after", runValidators: true }
  ).select("fazenda.orbs fazenda.inventario fazenda.anuncios");

  if (!user) {
    const fazenda = await carregarFazendaDoUsuario(userId, res);
    if (!fazenda) return;
    if (fazenda.anuncios.filter(item => item.status === "ativo").length >= CONFIG_FAZENDA.mercado.limiteAnunciosAtivos) {
      return res.status(409).json({ erro: "Você atingiu o limite de anúncios ativos." });
    }
    if (fazenda.inventario[inventarioCampo] < quantidade) {
      return res.status(400).json({ erro: `Você não tem essa quantidade de ${nomeItem} disponível.` });
    }
    return res.status(409).json({ erro: `Não foi possível anunciar ${nomeItem}. Atualize a loja e tente novamente.` });
  }
  const criado = user.fazenda.anuncios.at(-1);
  return res.status(201).json({
    anuncio: {
      _id: String(criado._id),
      item: criado.item,
      quantidade: criado.quantidadeRestante,
      precoTotal: criado.precoTotal,
      criadoEm: criado.criadoEm
    },
    fazenda: {
      orbs: user.fazenda.orbs,
      inventario: Object.fromEntries(FARM_ITENS_INVENTARIO.map(item => [
        item,
        user.fazenda.inventario[item] ?? 0
      ]))
    }
  });
});

app.post("/api/fazenda/mercado/cancelar", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const anuncioId = req.body?.anuncioId;
  if (!mongoose.isValidObjectId(anuncioId)) {
    return res.status(400).json({ erro: "Anúncio inválido." });
  }
  const user = await User.findOne({ _id: userId, "fazenda.anuncios._id": anuncioId })
    .select("fazenda.inventario fazenda.anuncios");
  if (!user) return res.status(404).json({ erro: "Anúncio não encontrado." });
  const anuncio = user.fazenda.anuncios.id(anuncioId);
  if (!anuncio || anuncio.status !== "ativo" || anuncio.quantidadeRestante < 1) {
    return res.status(409).json({ erro: "Este anúncio não está mais ativo." });
  }
  const quantidadeRestante = anuncio.quantidadeRestante;
  const cancelado = await User.findOneAndUpdate(
    {
      _id: userId,
      "fazenda.anuncios": {
        $elemMatch: {
          _id: anuncioId,
          status: "ativo",
          quantidadeRestante
        }
      }
    },
    {
      $inc: { [`fazenda.inventario.${anuncio.item}`]: quantidadeRestante },
      $set: {
        "fazenda.anuncios.$.quantidadeRestante": 0,
        "fazenda.anuncios.$.status": "cancelado"
      }
    },
    { returnDocument: "after" }
  ).select("fazenda.inventario fazenda.anuncios");
  if (!cancelado) {
    return res.status(409).json({ erro: "O anúncio mudou enquanto era cancelado. Atualize a loja e tente novamente." });
  }
  return res.json({
    item: anuncio.item,
    devolvido: quantidadeRestante,
    inventario: {
      ...Object.fromEntries(FARM_ITENS_INVENTARIO.map(item => [
        item,
        cancelado.fazenda.inventario[item] ?? 0
      ]))
    }
  });
});

app.post("/api/fazenda/mercado/comprar", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const { anuncioId, quantidade, operationId } = req.body ?? {};
  if (!mongoose.isValidObjectId(anuncioId) ||
      !Number.isSafeInteger(quantidade) || quantidade < 1 ||
      typeof operationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    return res.status(400).json({ erro: "Dados de compra inválidos." });
  }
  const fazendaComprador = await carregarFazendaDoUsuario(userId, res);
  if (!fazendaComprador) return;

  await FazendaMarketOperation.init();
  const session = await mongoose.startSession();
  let resultado;
  let notificacaoVendedor = null;
  let destinatarioNotificacaoId = null;
  try {
    await session.withTransaction(async () => {
      const repetida = await FazendaMarketOperation.findOne({ userId, operationId }).session(session);
      if (repetida) {
        resultado = repetida.resultado;
        return;
      }

      const vendedor = await User.findOne({ "fazenda.anuncios._id": anuncioId }).session(session)
        .select("nome fazenda.orbs fazenda.anuncios fazenda.notificacoesHabilitadas");
      const anuncio = vendedor?.fazenda.anuncios.id(anuncioId);
      if (!vendedor || !anuncio || anuncio.status !== "ativo" || anuncio.quantidadeRestante !== quantidade) {
        const erro = new Error("O anúncio não tem mais essa quantidade disponível.");
        erro.status = 409;
        throw erro;
      }
      if (String(vendedor._id) === userId) {
        const erro = new Error("Você não pode comprar do próprio anúncio.");
        erro.status = 400;
        throw erro;
      }

      const comprador = await User.findById(userId).session(session).select("fazenda.orbs fazenda.inventario");
      if (!comprador?.fazenda) {
        const erro = new Error("Fazenda do comprador não encontrada.");
        erro.status = 404;
        throw erro;
      }
      const total = anuncio.precoTotal ??
        (anuncio.precoUnitario * anuncio.quantidadeRestante);
      if (!Number.isSafeInteger(total) || comprador.fazenda.orbs < total) {
        const erro = new Error("Você não tem Orbs suficientes para essa compra.");
        erro.status = 400;
        throw erro;
      }

      const quantidadeRestante = anuncio.quantidadeRestante - quantidade;
      const statusAnuncio = quantidadeRestante === 0 ? "vendido" : "ativo";
      const inventarioCampo = anuncio.item;
      const culturaProduto = Object.values(FARM_PRECOS).find(cultura =>
        cultura.itemSemente === anuncio.item || cultura.itemColheita === anuncio.item
      );
      const nomeItem = anuncio.item === culturaProduto?.itemSemente
        ? `sementes de ${culturaProduto.nome.toLowerCase()}`
        : culturaProduto?.nome.toLowerCase() ?? "produto";
      const deveNotificarVendedor = vendedor.fazenda.notificacoesHabilitadas !== false;
      const notificacao = deveNotificarVendedor ? {
        _id: new mongoose.Types.ObjectId(),
        titulo: "🌱 Venda realizada!",
        texto: `Você vendeu ${quantidade} ${nomeItem} por ${total} Orbs.`,
        tipo: "fazenda",
        criadaEm: new Date(),
        expiraEm: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        lida: false
      } : null;
      const debitoComprador = await User.updateOne(
        { _id: userId, "fazenda.orbs": { $gte: total } },
        { $inc: { "fazenda.orbs": -total, [`fazenda.inventario.${inventarioCampo}`]: quantidade } },
        { session }
      );
      if (debitoComprador.modifiedCount !== 1) {
        const erro = new Error("Seu saldo mudou. Atualize a fazenda e tente novamente.");
        erro.status = 409;
        throw erro;
      }

      const creditoVendedor = await User.updateOne(
        {
          _id: vendedor._id,
          fazenda: {
            $exists: true
          },
          "fazenda.anuncios": {
            $elemMatch: {
              _id: anuncio._id,
              status: "ativo",
              quantidadeRestante: anuncio.quantidadeRestante
            }
          }
        },
        {
          $inc: { "fazenda.orbs": total },
          $set: {
            "fazenda.anuncios.$.quantidadeRestante": quantidadeRestante,
            "fazenda.anuncios.$.status": statusAnuncio
          },
          ...(notificacao ? { $push: { notificacoes: notificacao } } : {})
        },
        { session }
      );
      if (creditoVendedor.modifiedCount !== 1) {
        const erro = new Error("O anúncio foi atualizado por outra compra. Tente novamente.");
        erro.status = 409;
        throw erro;
      }

      notificacaoVendedor = notificacao
        ? { ...notificacao, notificationId: String(notificacao._id) }
        : null;
      destinatarioNotificacaoId = notificacao ? String(vendedor._id) : null;
      resultado = { sucesso: true, item: anuncio.item, quantidade, orbs: total };
      await FazendaMarketOperation.create([{
        userId,
        operationId,
        resultado,
        criadaEm: new Date()
      }], { session });
    });
    if (notificacaoVendedor) {
      await enviarPushParaUsuario(destinatarioNotificacaoId, notificacaoVendedor);
    }
    return res.json(resultado);
  } catch (error) {
    if (Number.isInteger(error.status)) return res.status(error.status).json({ erro: error.message });
    if (error?.code === 20 || /Transaction numbers are only allowed|replica set|mongos/i.test(error.message)) {
      return res.status(503).json({ erro: "O mercado exige MongoDB configurado como replica set para concluir compras com segurança." });
    }
    throw error;
  } finally {
    await session.endSession();
  }
});

app.post("/api/fazenda/mercado/comprar-sementes", async (req, res) => {
  const userId = autenticarUsuarioPush(req, res);
  if (!userId) return;
  const { cultura: culturaNome, quantidade, operationId } = req.body ?? {};
  const cultura = Object.hasOwn(FARM_PRECOS, culturaNome) ? FARM_PRECOS[culturaNome] : null;
  if (!Number.isSafeInteger(quantidade) || quantidade < 1 ||
      quantidade > CONFIG_FAZENDA.mercado.sementesSistemaQuantidadeMaximaCompra ||
      !cultura ||
      typeof operationId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
    return res.status(400).json({ erro: "Dados inválidos para comprar sementes." });
  }
  const fazendaComprador = await carregarFazendaDoUsuario(userId, res);
  if (!fazendaComprador) return;

  const total = quantidade * cultura.precoSementeOrbs;
  if (!Number.isSafeInteger(total)) {
    return res.status(400).json({ erro: "A quantidade excede o limite permitido para esta compra." });
  }

  await FazendaMarketOperation.init();
  const session = await mongoose.startSession();
  let resultado;
  try {
    await session.withTransaction(async () => {
      const repetida = await FazendaMarketOperation.findOne({ userId, operationId }).session(session);
      if (repetida) {
        resultado = repetida.resultado;
        return;
      }

      const debitoComprador = await User.updateOne(
        { _id: userId, "fazenda.orbs": { $gte: total } },
        {
          $inc: {
            "fazenda.orbs": -total,
            [`fazenda.inventario.${cultura.itemSemente}`]: quantidade
          }
        },
        { session }
      );
      if (debitoComprador.modifiedCount !== 1) {
        const erro = new Error("Você não tem Orbs suficientes para comprar essas sementes.");
        erro.status = 400;
        throw erro;
      }

      resultado = { sucesso: true, item: cultura.itemSemente, quantidade, orbs: total };
      await FazendaMarketOperation.create([{
        userId,
        operationId,
        resultado,
        criadaEm: new Date()
      }], { session });
    });
    return res.json(resultado);
  } catch (error) {
    if (Number.isInteger(error.status)) return res.status(error.status).json({ erro: error.message });
    if (error?.code === 20 || /Transaction numbers are only allowed|replica set|mongos/i.test(error.message)) {
      return res.status(503).json({ erro: "A loja exige MongoDB configurado como replica set para concluir compras com segurança." });
    }
    throw error;
  } finally {
    await session.endSession();
  }
});

app.get("/xadrez/usuarios/:userId/partida-atual", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;

  const estado = user.xadrezEstadoAtual;
  if (estado?.mode === "invite" && mongoose.isValidObjectId(estado.gameId)) {
    const partidaSalva = await ChessGame.findOne({
      _id: estado.gameId,
      $or: [{ jogadorBrancas: user._id }, { jogadorPretas: user._id }]
    }).select("_id");
    if (partidaSalva) return res.json({ mode: "invite", gameId: String(partidaSalva._id) });
  }

  if (estado?.mode === "local" || estado?.mode === "stockfish") {
    return res.json({ mode: estado.mode, partida: estado });
  }

  const partidaOnline = await ChessGame.findOne({
    $and: [
      { $or: [{ jogadorBrancas: user._id }, { jogadorPretas: user._id }] },
      { $or: [
        { status: "ativa" },
        { status: "aguardando", expiraEm: { $gt: new Date() } }
      ] }
    ]
  }).sort({ atualizadaEm: -1 }).select("_id");
  if (partidaOnline) {
    return res.json({ mode: "invite", gameId: String(partidaOnline._id) });
  }
  return res.json({ mode: "none" });
});

app.put("/xadrez/usuarios/:userId/partida-local", async (req, res) => {
  const { gameId, mode, playerColor, skillLevel, rated, pgn, updatedAt, replaceOnlineState } = req.body || {};
  if (!["local", "stockfish"].includes(mode) || !["w", "b"].includes(playerColor) ||
      !Number.isInteger(skillLevel) || skillLevel < 1 || skillLevel > 20 ||
      (gameId !== undefined && (typeof gameId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(gameId))) ||
      (rated !== undefined && typeof rated !== "boolean") ||
      (rated === true && (mode !== "stockfish" || skillLevel < 8)) ||
      typeof pgn !== "string" || pgn.length > 200000 ||
      !Number.isSafeInteger(updatedAt) || updatedAt <= 0 ||
      (replaceOnlineState !== undefined && typeof replaceOnlineState !== "boolean")) {
    return res.status(400).json({ erro: "Estado da partida de xadrez inválido." });
  }

  let jogo;
  try {
    jogo = new Chess();
    if (pgn) jogo.loadPgn(pgn);
  } catch {
    return res.status(400).json({ erro: "A notação da partida de xadrez é inválida." });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  const partida = {
    ...(gameId ? { gameId } : {}),
    mode,
    playerColor,
    skillLevel,
    rated: rated === true,
    pgn,
    fen: jogo.fen(),
    updatedAt
  };
  const atualizacao = await User.updateOne({
    _id: user._id,
    $or: [
      { xadrezEstadoAtual: null },
      {
        "xadrezEstadoAtual.mode": { $in: ["local", "stockfish"] },
        "xadrezEstadoAtual.updatedAt": { $exists: false }
      },
      {
        "xadrezEstadoAtual.mode": { $in: ["local", "stockfish"] },
        "xadrezEstadoAtual.updatedAt": { $lte: updatedAt }
      },
      ...(replaceOnlineState ? [{ "xadrezEstadoAtual.mode": "invite" }] : [])
    ]
  }, { $set: { xadrezEstadoAtual: partida } });
  if (atualizacao.matchedCount !== 1) {
    return res.status(409).json({ erro: "Uma partida mais recente já foi salva." });
  }

  return res.json({ mode, partida });
});

app.post("/xadrez/usuarios/:userId/historico-local", async (req, res) => {
  const { gameId, mode, playerColor, opponent, pgn } = req.body || {};
  const nivelStockfish = Number.isInteger(req.body?.skillLevel) &&
    req.body.skillLevel >= 1 && req.body.skillLevel <= 20
    ? req.body.skillLevel
    : null;
  const ratingSolicitado = req.body?.rated === true;
  if (!mongoose.isValidObjectId(req.params.userId) ||
      typeof gameId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(gameId) ||
      !["local", "stockfish"].includes(mode) ||
      !(mode === "local" ? playerColor === "both" : ["w", "b"].includes(playerColor)) ||
      (ratingSolicitado && (mode !== "stockfish" || nivelStockfish === null || nivelStockfish < 8)) ||
      typeof opponent !== "string" || !opponent.trim() || opponent.length > 120 ||
      typeof pgn !== "string" || pgn.length > 200000) {
    return res.status(400).json({ erro: "Dados da partida local inválidos." });
  }

  let jogo;
  try {
    jogo = new Chess();
    if (pgn) jogo.loadPgn(pgn);
  } catch {
    return res.status(400).json({ erro: "A notação da partida local é inválida." });
  }

  const headers = jogo.getHeaders();
  const resultado = jogo.isCheckmate()
    ? jogo.turn() === "w" ? "0-1" : "1-0"
    : jogo.isDraw() ? "1/2-1/2"
      : headers.Termination === "resignation" && ["1-0", "0-1"].includes(headers.Result)
        ? headers.Result
        : null;
  if (!resultado) {
    return res.status(400).json({ erro: "Só é possível registrar partidas finalizadas." });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  if (ratingSolicitado) {
    const estadoAtual = user.xadrezEstadoAtual;
    if (estadoAtual?.mode !== "stockfish" ||
        estadoAtual.gameId !== gameId ||
        estadoAtual.skillLevel !== nivelStockfish ||
        estadoAtual.rated !== true ||
        estadoAtual.playerColor !== playerColor ||
        estadoAtual.pgn !== pgn) {
      return res.status(409).json({ erro: "Não foi possível confirmar o resultado da partida contra o Stockfish." });
    }
  }
  let partidaLocal = await ChessLocalGame.findOneAndUpdate(
    { userId: user._id, gameId },
    {
      $setOnInsert: {
        mode,
        playerColor,
        opponent: opponent.trim(),
        resultado,
        moveCount: jogo.history().length,
        pgn: pgn || jogo.pgn(),
        rated: ratingSolicitado && mode === "stockfish" && nivelStockfish >= 8,
        skillLevel: mode === "stockfish" ? nivelStockfish : null,
        playedAt: new Date()
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true }
  );
  if (partidaLocal.rated && !Number.isFinite(partidaLocal.ratingDelta)) {
    await inicializarRatingXadrez([user._id]);
    const jogador = await User.findById(user._id).select(
      "xadrezRating xadrezRatingDeviation xadrezRatingLastPlayedAt"
    );
    if (!jogador) return res.status(404).json({ erro: "Jogador não encontrado." });
    const ratingStockfish = 300 + (partidaLocal.skillLevel - 1) * 100;
    const scoreBrancas = partidaLocal.resultado === "1-0" ? 1
      : partidaLocal.resultado === "0-1" ? 0 : 0.5;
    const scoreJogador = partidaLocal.playerColor === "w" ? scoreBrancas : 1 - scoreBrancas;
    const atualizacao = calcularAtualizacaoGlicko(
      jogador,
      { xadrezRating: ratingStockfish, xadrezRatingDeviation: 120, xadrezRatingLastPlayedAt: null },
      scoreJogador,
      new Date(),
      { maxGain: CHESS_STOCKFISH_RATING_MAX_GAIN, maxLoss: CHESS_STOCKFISH_RATING_MAX_LOSS }
    );
    await ChessLocalGame.findOneAndUpdate({
      userId: user._id,
      gameId,
      rated: true,
      ratingDelta: null
    }, {
      $set: {
        ratingDelta: atualizacao.delta,
        ratingDeviationAfter: atualizacao.deviationAfter
      }
    });
    partidaLocal = await ChessLocalGame.findOne({ userId: user._id, gameId });
  }
  if (partidaLocal?.rated && Number.isFinite(partidaLocal.ratingDelta)) {
    const marcadorRating = `stockfish:${gameId}`;
    await User.updateOne({
      _id: user._id,
      xadrezRatingPartidas: { $ne: marcadorRating }
    }, {
      $inc: { xadrezRating: partidaLocal.ratingDelta },
      $set: {
        xadrezRatingDeviation: partidaLocal.ratingDeviationAfter,
        xadrezRatingLastPlayedAt: partidaLocal.playedAt
      },
      $addToSet: { xadrezRatingPartidas: marcadorRating }
    });
  }
  const jogadorAtualizado = partidaLocal?.rated
    ? await User.findById(user._id).select("xadrezRating")
    : null;
  return res.json({
    ok: true,
    rated: partidaLocal?.rated === true,
    ratingDelta: partidaLocal?.rated ? partidaLocal.ratingDelta : null,
    rating: jogadorAtualizado?.xadrezRating ?? null
  });
});

app.get("/xadrez/usuarios/:userId/rating", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  await inicializarRatingXadrez([user._id]);
  const ratingUser = await User.findById(user._id).select("nome xadrezRating");
  return res.json({ rating: ratingUser?.xadrezRating ?? CHESS_RATING_INITIAL });
});

app.get("/xadrez/ranking", async (_req, res) => {
  await User.updateMany({ $or: [{ xadrezRating: { $exists: false } }, { xadrezRating: null }] }, { $set: {
    xadrezRating: CHESS_RATING_INITIAL,
    xadrezRatingDeviation: CHESS_RATING_RD_INITIAL,
    xadrezRatingLastPlayedAt: null
  } });
  await User.updateMany({
    xadrezRating: { $exists: true, $ne: null },
    $or: [{ xadrezRatingDeviation: { $exists: false } }, { xadrezRatingDeviation: null }]
  }, { $set: { xadrezRatingDeviation: CHESS_RATING_RD_INITIAL } });
  const filtroPartidasConvidadas = {
    status: "finalizada",
    resultado: { $in: ["1-0", "0-1", "1/2-1/2"] }
  };
  const [idsBrancas, idsPretas, idsStockfish] = await Promise.all([
    ChessGame.distinct("jogadorBrancas", filtroPartidasConvidadas),
    ChessGame.distinct("jogadorPretas", filtroPartidasConvidadas),
    ChessLocalGame.distinct("userId", { rated: true })
  ]);
  const idsComPartidaValendo = [...new Set([...idsBrancas, ...idsPretas, ...idsStockfish].map(String))];
  const jogadores = idsComPartidaValendo.length
    ? await User.find({ _id: { $in: idsComPartidaValendo } }).select("nome xadrezRating").sort({ xadrezRating: -1, nome: 1, _id: 1 }).limit(20).lean()
    : [];
  return res.json({ jogadores: jogadores.map((jogador, index) => ({
    posicao: index + 1,
    userId: String(jogador._id),
    nome: jogador.nome || "Jogador",
    rating: Math.round(jogador.xadrezRating ?? CHESS_RATING_INITIAL)
  })) });
});

app.get("/xadrez/usuarios/:userId/historico", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;

  const partidasOnline = await ChessGame.find({
    status: "finalizada",
    resultado: { $in: ["1-0", "0-1", "1/2-1/2"] },
    $or: [{ jogadorBrancas: user._id }, { jogadorPretas: user._id }]
  }).select("jogadorBrancas jogadorPretas nomeBrancas nomePretas resultado rated ratingProcessadaEm ratingDeltaBrancas ratingDeltaPretas pgn analise atualizadaEm");
  const partidasLocais = await ChessLocalGame.find({ userId: user._id })
    .select("gameId mode opponent playerColor resultado moveCount pgn analise playedAt rated ratingDelta");

  const historicoLocal = partidasLocais.map(partida => {
    let moves = [];
    try {
      const jogo = new Chess();
      if (partida.pgn) jogo.loadPgn(partida.pgn);
      moves = jogo.history();
    } catch {}
    return {
      gameId: partida.gameId,
      mode: partida.mode,
      opponent: partida.opponent,
      playerColor: partida.playerColor,
      resultado: partida.resultado,
      moveCount: partida.moveCount || moves.length,
      pgn: partida.pgn || "",
      moves,
      analise: partida.analise || null,
      rated: partida.rated === true,
      ratingDelta: partida.rated === true ? partida.ratingDelta : null,
      playedAt: partida.playedAt
    };
  });
  const historicoOnline = partidasOnline.map(partida => {
    const jogadorBrancas = String(partida.jogadorBrancas) === String(user._id);
    const playerColor = jogadorBrancas ? "w" : "b";
    let moves = [];
    try {
      const jogo = new Chess();
      if (partida.pgn) jogo.loadPgn(partida.pgn);
      moves = jogo.history();
    } catch {}
    return {
      gameId: String(partida._id),
      mode: "invite",
      opponent: jogadorBrancas ? partida.nomePretas : partida.nomeBrancas,
      playerColor,
      resultado: partida.resultado,
      rated: partida.rated === true,
      ratingDelta: partida.rated === true && partida.ratingProcessadaEm
        ? (jogadorBrancas ? partida.ratingDeltaBrancas : partida.ratingDeltaPretas)
        : null,
      moveCount: moves.length || partida.resultado ? moves.length : 0,
      pgn: partida.pgn || "",
      moves,
      analise: partida.analise || null,
      playedAt: partida.atualizadaEm
    };
  });

  const partidas = [...historicoLocal, ...historicoOnline]
    .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());
  return res.json({ partidas });
});

app.put("/xadrez/usuarios/:userId/historico/:gameId/analise", async (req, res) => {
  const { analise } = req.body || {};
  if (!analise || typeof analise !== "object") {
    return res.status(400).json({ erro: "Dados de análise inválidos." });
  }
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  const { gameId } = req.params;

  let atualizado = await ChessLocalGame.findOneAndUpdate(
    { userId: user._id, gameId },
    { $set: { analise } },
    { returnDocument: "after" }
  );
  if (!atualizado && mongoose.isValidObjectId(gameId)) {
    atualizado = await ChessGame.findOneAndUpdate(
      { _id: gameId, $or: [{ jogadorBrancas: user._id }, { jogadorPretas: user._id }] },
      { $set: { analise } },
      { returnDocument: "after" }
    );
  }
  return res.json({ ok: true, analise: atualizado?.analise || analise });
});

app.get("/xadrez/usuarios/:userId/buscar", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  const query = typeof req.query.nome === "string" ? req.query.nome.trim() : "";
  if (query.length < 2 || query.length > 100) return res.json({ usuarios: [] });
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const usuarios = await User.find({
    _id: { $ne: user._id },
    nome: { $regex: escapedQuery, $options: "i" }
  }).select("_id nome").sort({ nome: 1 }).limit(8).lean();
  return res.json({ usuarios: usuarios.map(usuario => ({ id: String(usuario._id), nome: usuario.nome || "Usuário" })) });
});

app.post("/xadrez/convites/:userId", async (req, res) => {
  const convidadoId = typeof req.body?.convidadoId === "string" ? req.body.convidadoId.trim() : "";
  const rated = req.body?.rated === true;
  if (!mongoose.isValidObjectId(convidadoId)) return res.status(400).json({ erro: "Selecione um usuário da lista." });

  const remetente = await findUser(req.params.userId, res);
  if (!remetente) return;
  const convidado = await User.findById(convidadoId).select("_id nome email");
  if (!convidado) return res.status(404).json({ erro: "Usuário não encontrado." });
  if (String(convidado._id) === String(remetente._id)) {
    return res.status(400).json({ erro: "Você não pode convidar a si mesmo." });
  }
  const destinatario = await findUser(String(convidado._id), res);
  if (!destinatario) return;

  const agora = new Date();
  const convitesAnteriores = await ChessGame.find({
    criador: remetente._id,
    $or: [
      { jogadorBrancas: remetente._id, jogadorPretas: convidado._id },
      { jogadorBrancas: convidado._id, jogadorPretas: remetente._id }
    ],
    status: "aguardando"
  }).select("_id");
  if (convitesAnteriores.length) {
    const idsAnteriores = convitesAnteriores.map(convite => convite._id);
    await ChessGame.updateMany({ _id: { $in: idsAnteriores }, status: "aguardando" }, {
      $set: { status: "substituida", atualizadaEm: agora }
    });
    await User.updateOne({
      _id: convidado._id,
      "notificacoes.partidaId": { $in: idsAnteriores.map(String) }
    }, {
      $set: {
        "notificacoes.$[notificacao].lida": true,
        "notificacoes.$[notificacao].texto": "Convite substituído por um novo convite."
      }
    }, {
      arrayFilters: [{ "notificacao.partidaId": { $in: idsAnteriores.map(String) } }]
    });
  }

  const expiraEm = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);
  const remetenteJogaDeBrancas = Math.random() < 0.5;
  const partida = await ChessGame.create({
    jogadorBrancas: remetenteJogaDeBrancas ? remetente._id : convidado._id,
    jogadorPretas: remetenteJogaDeBrancas ? convidado._id : remetente._id,
    criador: remetente._id,
    nomeBrancas: (remetenteJogaDeBrancas ? remetente : destinatario).nome || "Jogador",
    nomePretas: (remetenteJogaDeBrancas ? destinatario : remetente).nome || "Jogador",
    status: "aguardando",
    rated,
    criadaEm: agora,
    expiraEm,
    atualizadaEm: agora
  });

  const notificacaoConvite = {
    titulo: "Convite para uma partida de xadrez",
    texto: `${remetente.nome || "Um usuário"} convidou você para jogar xadrez${rated ? " valendo rating" : " sem rating"}.`,
    partidaId: String(partida._id),
    ratingValendo: rated,
    tipo: "xadrez_convite",
    criadaEm: agora,
    expiraEm,
    lida: false
  };
  destinatario.notificacoes.push(notificacaoConvite);
  await destinatario.save();
  await enviarPushParaUsuario(destinatario._id, {
    titulo: notificacaoConvite.titulo,
    texto: notificacaoConvite.texto,
    notificationId: String(destinatario.notificacoes.at(-1)._id),
    tipo: notificacaoConvite.tipo,
    partidaId: notificacaoConvite.partidaId
  });
  remetente.xadrezEstadoAtual = { mode: "invite", gameId: String(partida._id) };
  await remetente.save();
  return res.status(201).json({
    partidaId: String(partida._id), status: partida.status, rated,
    cor: remetenteJogaDeBrancas ? "w" : "b"
  });
});

app.get("/xadrez/partidas/:partidaId/:userId", async (req, res) => {
  const { partidaId, userId } = req.params;
  if (!mongoose.isValidObjectId(partidaId)) {
    return res.status(400).json({ erro: "Identificador da partida inválido." });
  }
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ erro: "Identificador de usuário inválido." });
  }
  let partida = await ChessGame.findById(partidaId);
  if (!partida) return res.status(404).json({ erro: "Partida não encontrada." });
  const cor = String(partida.jogadorBrancas) === userId
    ? "w"
    : String(partida.jogadorPretas) === userId ? "b" : null;
  if (!cor) return res.status(403).json({ erro: "Você não participa desta partida." });

  if (partida.status === "aguardando" && partida.expiraEm <= new Date()) {
    partida.status = "expirada";
    partida.atualizadaEm = new Date();
    await partida.save();
  }

  if (partida.status === "finalizada" && partida.rated) {
    await processarRatingPartida(partida._id);
    partida = await ChessGame.findById(partidaId);
  }

  return res.json({
    partidaId: String(partida._id),
    status: partida.status,
    pgn: partida.pgn,
    fen: partida.fen,
    resultado: partida.resultado,
    rated: partida.rated === true,
    ratingProcessada: Boolean(partida.ratingProcessadaEm),
    ratingDelta: cor === "w" ? partida.ratingDeltaBrancas : partida.ratingDeltaPretas,
    cor,
    adversario: cor === "w" ? partida.nomePretas : partida.nomeBrancas,
    expiraEm: partida.expiraEm
  });
});

app.post("/xadrez/partidas/:partidaId/aceitar", async (req, res) => {
  const { partidaId } = req.params;
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!mongoose.isValidObjectId(partidaId) || !mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ erro: "Identificador da partida ou usuário inválido." });
  }

  const agora = new Date();
  let partida = await ChessGame.findOneAndUpdate({
    _id: partidaId,
    criador: { $ne: userId },
    $or: [{ jogadorBrancas: userId }, { jogadorPretas: userId }],
    status: "aguardando",
    expiraEm: { $gt: agora }
  }, {
    $set: { status: "ativa", iniciadaEm: agora, atualizadaEm: agora }
  }, { returnDocument: "after" });
  if (!partida) {
    partida = await ChessGame.findOne({
      _id: partidaId,
      criador: { $ne: userId },
      $or: [{ jogadorBrancas: userId }, { jogadorPretas: userId }]
    });
    if (!partida) return res.status(404).json({ erro: "Convite não encontrado." });
    if (partida.status !== "ativa") {
      return res.status(409).json({ erro: partida.status === "expirada" ? "Este convite expirou." : "Este convite não está mais aguardando resposta." });
    }
  }

  await User.updateOne(
    { _id: userId, "notificacoes.partidaId": partidaId },
    { $set: {
      "notificacoes.$.lida": true,
      "notificacoes.$.texto": "Convite aceito. A partida está ativa.",
      xadrezEstadoAtual: { mode: "invite", gameId: String(partida._id) }
    } }
  );
  await User.updateOne(
    { _id: userId },
    { $set: { xadrezEstadoAtual: { mode: "invite", gameId: String(partida._id) } } }
  );
  return res.json({
    partidaId: String(partida._id),
    status: partida.status,
    rated: partida.rated === true,
    pgn: partida.pgn,
    cor: String(partida.jogadorBrancas) === userId ? "w" : "b",
    adversario: partida.nomeBrancas
  });
});

app.post("/xadrez/partidas/:partidaId/recusar", async (req, res) => {
  const { partidaId } = req.params;
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!mongoose.isValidObjectId(partidaId) || !mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ erro: "Identificador da partida ou usuário inválido." });
  }
  const partida = await ChessGame.findOneAndUpdate({
    _id: partidaId,
    criador: { $ne: userId },
    $or: [{ jogadorBrancas: userId }, { jogadorPretas: userId }],
    status: "aguardando",
    expiraEm: { $gt: new Date() }
  }, {
    $set: { status: "recusada", atualizadaEm: new Date() }
  }, { returnDocument: "after" });
  if (!partida) return res.status(409).json({ erro: "Este convite não está mais aguardando resposta." });
  await User.updateOne(
    { _id: userId, "notificacoes.partidaId": partidaId },
    { $set: {
      "notificacoes.$.lida": true,
      "notificacoes.$.texto": "Convite recusado."
    } }
  );
  return res.json({ ok: true });
});

app.get("/xadrez/partidas/:partidaId/chat/:userId", async (req, res) => {
  const { partidaId, userId } = req.params;
  if (!mongoose.isValidObjectId(partidaId) || !mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ erro: "Identificador da partida ou usuário inválido." });
  }

  const partida = await ChessGame.findById(partidaId).select("jogadorBrancas jogadorPretas status mensagens");
  if (!partida) return res.status(404).json({ erro: "Partida não encontrada." });
  const participa = String(partida.jogadorBrancas) === userId || String(partida.jogadorPretas) === userId;
  if (!participa) return res.status(403).json({ erro: "Você não participa desta partida." });
  if (!["ativa", "finalizada"].includes(partida.status)) {
    return res.status(409).json({ erro: "O chat fica disponível enquanto a partida estiver ativa ou finalizada." });
  }

  return res.json({
    mensagens: partida.mensagens.map(mensagem => ({
      id: String(mensagem._id),
      senderId: String(mensagem.senderId),
      senderName: mensagem.senderName,
      text: mensagem.text,
      createdAt: mensagem.createdAt
    }))
  });
});

app.post("/xadrez/partidas/:partidaId/chat", async (req, res) => {
  const { partidaId } = req.params;
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!mongoose.isValidObjectId(partidaId) || !mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ erro: "Identificador da partida ou usuário inválido." });
  }
  if (!text || text.length > 500) {
    return res.status(400).json({ erro: "A mensagem deve ter entre 1 e 500 caracteres." });
  }

  const partida = await ChessGame.findById(partidaId).select("jogadorBrancas jogadorPretas nomeBrancas nomePretas status");
  if (!partida) return res.status(404).json({ erro: "Partida não encontrada." });
  const corJogador = String(partida.jogadorBrancas) === userId
    ? "w"
    : String(partida.jogadorPretas) === userId ? "b" : null;
  if (!corJogador) return res.status(403).json({ erro: "Você não participa desta partida." });
  if (partida.status !== "ativa") {
    return res.status(409).json({ erro: "Não é possível enviar mensagens após o fim da partida." });
  }

  const mensagem = {
    _id: new mongoose.Types.ObjectId(),
    senderId: userId,
    senderName: corJogador === "w" ? partida.nomeBrancas : partida.nomePretas,
    text,
    createdAt: new Date()
  };
  const atualizada = await ChessGame.findOneAndUpdate({
    _id: partida._id,
    status: "ativa",
    $or: [{ jogadorBrancas: userId }, { jogadorPretas: userId }]
  }, {
    $push: { mensagens: { $each: [mensagem], $slice: -200 } }
  }, { returnDocument: "after" }).select("_id");
  if (!atualizada) {
    return res.status(409).json({ erro: "A partida foi finalizada; não foi possível enviar a mensagem." });
  }

  return res.status(201).json({
    mensagem: {
      id: String(mensagem._id),
      senderId: userId,
      senderName: mensagem.senderName,
      text: mensagem.text,
      createdAt: mensagem.createdAt
    }
  });
});

app.post("/xadrez/partidas/:partidaId/desistir", async (req, res) => {
  const { partidaId } = req.params;
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  if (!mongoose.isValidObjectId(partidaId) || !mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ erro: "Identificador da partida ou usuário inválido." });
  }

  const partida = await ChessGame.findById(partidaId);
  if (!partida) return res.status(404).json({ erro: "Partida não encontrada." });
  const corJogador = String(partida.jogadorBrancas) === userId
    ? "w"
    : String(partida.jogadorPretas) === userId ? "b" : null;
  if (!corJogador) return res.status(403).json({ erro: "Você não participa desta partida." });
  if (partida.status !== "ativa") return res.status(409).json({ erro: "Esta partida não está ativa." });

  const jogo = new Chess();
  if (partida.pgn) jogo.loadPgn(partida.pgn);
  if (jogo.fen() !== partida.fen) {
    return res.status(409).json({ erro: "O tabuleiro foi atualizado; sincronizando a partida." });
  }
  const resultado = corJogador === "w" ? "0-1" : "1-0";
  jogo.setHeader("Result", resultado);
  jogo.setHeader("Termination", "resignation");
  const atualizadaEm = new Date();
  const partidaAtualizada = await ChessGame.findOneAndUpdate({
    _id: partida._id,
    status: "ativa",
    fen: partida.fen,
    $or: [{ jogadorBrancas: userId }, { jogadorPretas: userId }]
  }, {
    $set: {
      pgn: jogo.pgn(),
      status: "finalizada",
      resultado,
      atualizadaEm
    }
  }, { returnDocument: "after" });
  if (!partidaAtualizada) {
    return res.status(409).json({ erro: "A partida foi atualizada; sincronize e tente novamente." });
  }
  const ratingResultado = partidaAtualizada.rated
    ? await processarRatingPartida(partidaAtualizada._id)
    : null;
  return res.json({
    status: partidaAtualizada.status,
    rated: partidaAtualizada.rated === true,
    ratingResultado,
    pgn: partidaAtualizada.pgn,
    fen: partidaAtualizada.fen,
    resultado: partidaAtualizada.resultado
  });
});

app.post("/xadrez/partidas/:partidaId/lances", async (req, res) => {
  const { partidaId } = req.params;
  const userId = typeof req.body?.userId === "string" ? req.body.userId : "";
  const { from, to, promotion, fen } = req.body || {};
  if (!mongoose.isValidObjectId(partidaId) || !mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ erro: "Identificador da partida ou usuário inválido." });
  }
  if (typeof from !== "string" || !/^[a-h][1-8]$/.test(from) ||
      typeof to !== "string" || !/^[a-h][1-8]$/.test(to) ||
      (promotion !== undefined && !["q", "r", "b", "n"].includes(promotion)) ||
      typeof fen !== "string" || fen.length > 100) {
    return res.status(400).json({ erro: "Lance inválido." });
  }

  const partida = await ChessGame.findById(partidaId);
  if (!partida) return res.status(404).json({ erro: "Partida não encontrada." });
  if (partida.status !== "ativa") return res.status(409).json({ erro: "Esta partida não está ativa." });
  const corJogador = String(partida.jogadorBrancas) === userId
    ? "w"
    : String(partida.jogadorPretas) === userId ? "b" : null;
  if (!corJogador) return res.status(403).json({ erro: "Você não participa desta partida." });
  if (fen !== partida.fen) return res.status(409).json({ erro: "O tabuleiro foi atualizado; sincronizando a partida." });

  const jogo = new Chess();
  if (partida.pgn) jogo.loadPgn(partida.pgn);
  if (jogo.fen() !== partida.fen) {
    return res.status(409).json({ erro: "O histórico da partida está inconsistente; sincronize e tente novamente." });
  }
  if (jogo.turn() !== corJogador) return res.status(409).json({ erro: "Ainda não é a sua vez." });
  let lance;
  try {
    lance = jogo.move({ from, to, ...(promotion ? { promotion } : {}) });
  } catch {
    return res.status(400).json({ erro: "Esse lance não é permitido pelas regras do xadrez." });
  }

  const terminou = jogo.isGameOver();
  const resultado = jogo.isCheckmate()
    ? jogo.turn() === "w" ? "0-1" : "1-0"
    : terminou ? "1/2-1/2" : "*";
  const atualizadaEm = new Date();
  const atualizacao = await ChessGame.updateOne({
    _id: partida._id,
    status: "ativa",
    fen: partida.fen
  }, {
    $set: {
      fen: jogo.fen(),
      pgn: jogo.pgn(),
      status: terminou ? "finalizada" : "ativa",
      resultado,
      atualizadaEm
    }
  });
  if (atualizacao.modifiedCount !== 1) {
    return res.status(409).json({ erro: "O tabuleiro foi atualizado; sincronizando a partida." });
  }
  const ratingResultado = terminou && partida.rated
    ? await processarRatingPartida(partida._id)
    : null;
  const jogadorOponenteId = corJogador === "w" ? partida.jogadorPretas : partida.jogadorBrancas;
  const nomeJogador = corJogador === "w" ? partida.nomeBrancas : partida.nomePretas;
  const notificacaoCriadaEm = new Date();
  const notificacaoLanceId = new mongoose.Types.ObjectId();
  const notificacaoLance = {
    _id: notificacaoLanceId,
    titulo: "Seu oponente jogou",
    texto: `${nomeJogador} jogou ${lance.san}. É sua vez.`,
    partidaId: String(partida._id),
    tipo: "xadrez_lance",
    criadaEm: notificacaoCriadaEm,
    expiraEm: new Date(notificacaoCriadaEm.getTime() + 7 * 24 * 60 * 60 * 1000),
    lida: false
  };
  const atualizacaoNotificacao = await User.updateOne({
    _id: jogadorOponenteId,
    "preferencias.notificacoesLancesXadrez": { $ne: false }
  }, {
    $push: {
      notificacoes: notificacaoLance
    }
  });
  if (atualizacaoNotificacao.modifiedCount) {
    await enviarPushParaUsuario(jogadorOponenteId, {
      titulo: notificacaoLance.titulo,
      texto: notificacaoLance.texto,
      notificationId: String(notificacaoLanceId),
      tipo: notificacaoLance.tipo,
      partidaId: notificacaoLance.partidaId
    });
  }
  return res.json({
    partidaId: String(partida._id),
    status: terminou ? "finalizada" : "ativa",
    rated: partida.rated === true,
    ratingResultado,
    pgn: jogo.pgn(),
    fen: jogo.fen(),
    resultado
  });
});

let processamentoNotificacoesAtivo = false;

export async function processarNotificacoesPendentes(agora = new Date()) {
  if (processamentoNotificacoesAtivo) return;
  processamentoNotificacoesAtivo = true;

  try {
    const usuarios = await User.find({}).select(
      "tarefasDiarias tarefasImportantes habitos notificacoes fazenda.inicializada fazenda.notificacoesHabilitadas fazenda.canteiros fazenda.plantacao"
    );
    const expiraEm = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);

    for (const usuario of usuarios) {
      const notificacoesAtivas = usuario.notificacoes.filter(notificacao => notificacao.expiraEm > agora);
      let alterado = notificacoesAtivas.length !== usuario.notificacoes.length;
      const notificacoesParaEnviar = [];
      if (alterado) usuario.notificacoes = notificacoesAtivas;

      const inicioHoje = new Date(agora);
      inicioHoje.setHours(0, 0, 0, 0);
      for (const tarefa of usuario.tarefasImportantes) {
        if (!tarefa.recorrente) continue;
        const dataTarefa = new Date(tarefa.dataCriacao);
        if (dataTarefa.getFullYear() === inicioHoje.getFullYear() &&
            dataTarefa.getMonth() === inicioHoje.getMonth() &&
            dataTarefa.getDate() === inicioHoje.getDate()) continue;
        tarefa.dataCriacao = new Date(inicioHoje);
        tarefa.dataCriacao.setHours(dataTarefa.getHours(), dataTarefa.getMinutes(), 0, 0);
        tarefa.concluida = false;
        tarefa.dataConclusao = null;
        tarefa.notificadoEm = null;
        alterado = true;
      }

      const verificarTarefas = (tarefas, tipo, titulo) => {
        for (const tarefa of tarefas) {
          if (!tarefa.concluida && !tarefa.notificadoEm && tarefa.dataCriacao <= agora) {
            tarefa.notificadoEm = agora;
            const notificacao = {
              titulo,
              texto: tarefa.texto,
              tarefaId: tarefa.id,
              tipo,
              criadaEm: agora,
              expiraEm,
              lida: false
            };
            usuario.notificacoes.push(notificacao);
            notificacoesParaEnviar.push(notificacao);
            alterado = true;
          }
        }
      };

      verificarTarefas(usuario.tarefasDiarias, "diaria", "Tarefa no horário");
      verificarTarefas(usuario.tarefasImportantes, "importante", "Tarefa importante no horário");
      for (const habito of usuario.habitos) {
        const agoraLocal = dataHoraNoFuso(agora, habito.fusoHorario);
        if (habito.tipo === "objetivo" && agoraLocal.data > habito.dataFinal) continue;
        const horariosHabito = habito.horarios?.length ? habito.horarios : [habito.horario];
        for (const horarioHabito of horariosHabito) {
          const chaveLembrete = `${agoraLocal.data}@${horarioHabito}`;
          const jaConcluido = habito.horarios?.length
            ? habito.conclusoesHorarios.includes(chaveLembrete)
            : habito.diasConcluidos.includes(agoraLocal.data);
          const lembreteJaEnviado = habito.horarios?.length
            ? habito.lembretesEnviados.includes(chaveLembrete)
            : habito.lembreteEnviadoEm === agoraLocal.data;
          if (jaConcluido || horarioHabito > agoraLocal.horario || lembreteJaEnviado) continue;

          if (habito.horarios?.length) habito.lembretesEnviados.push(chaveLembrete);
          else habito.lembreteEnviadoEm = agoraLocal.data;
          const notificacao = {
            titulo: "Lembrete de hábito",
            texto: habito.horarios?.length ? `${habito.nome} · ${horarioHabito}` : habito.nome,
            tarefaId: habito.id,
            tipo: "habito",
            criadaEm: agora,
            expiraEm,
            lida: false
          };
          usuario.notificacoes.push(notificacao);
          notificacoesParaEnviar.push(notificacao);
          alterado = true;
        }
      }
      if (alterado) {
        await usuario.save();
        await Promise.all(notificacoesParaEnviar.map(notificacao => enviarPushParaUsuario(usuario._id, {
          titulo: notificacao.titulo,
          texto: notificacao.texto,
          notificationId: String(notificacao._id),
          tipo: notificacao.tipo,
          partidaId: notificacao.partidaId
        })));
      }

      const usarPlantacaoLegada = !usuario.fazenda?.canteiros?.length;
      const canteiros = usarPlantacaoLegada
        ? [usuario.fazenda?.plantacao]
        : usuario.fazenda.canteiros;
      if (usuario.fazenda?.notificacoesHabilitadas !== false) {
        for (const [indiceCanteiro, plantacao] of canteiros.entries()) {
          if (!plantacao || plantacao.estado !== "crescendo" ||
              !plantacao.amadureceEm ||
              plantacao.amadureceEm > agora ||
              plantacao.notificacaoProntaEnviadaEm) continue;
          await notificarColheitaPronta(
            usuario._id,
            plantacao.cultura,
            plantacao.amadureceEm,
            indiceCanteiro,
            agora,
            usarPlantacaoLegada
          );
        }
      }
    }
  } finally {
    processamentoNotificacoesAtivo = false;
  }
}

app.use((error, req, res, next) => {
  console.error("Erro na requisição:", error);
  if (res.headersSent) return next(error);
  return res.status(500).json({ erro: "Erro interno do servidor" });
});

export async function startServer() {
  await connectDB();
  processarNotificacoesPendentes().catch(error => {
    console.error("Falha ao verificar notificações pendentes:", error);
  });
  const notificationTimer = setInterval(() => {
    processarNotificacoesPendentes().catch(error => {
      console.error("Falha ao verificar notificações pendentes:", error);
    });
  }, 15000);
  notificationTimer.unref();

  const httpServer = createServer(app);
  attachPartyRoomSocket(httpServer, {
    service: partyRoomService,
    PartyRoom,
    PartySession,
    gameManager: partyGameManager,
    getUserIdFromCookie: userIdDaCookie
  });
  return httpServer.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer().catch(error => {
    console.error("Falha ao iniciar o servidor:", error.message);
    process.exitCode = 1;
  });
}

export default app;
