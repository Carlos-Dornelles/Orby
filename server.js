import express from "express";
import mongoose from "mongoose";
import { Chess } from "chess.js";
import { compare as comparePassword, hash as hashPassword } from "bcryptjs";
import { v2 as cloudinary } from "cloudinary";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import path from "path";
import { fileURLToPath } from "url";
import connectDB from "./DB.js";
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

const app = express();
const PORT = Number(process.env.PORT) || 8080;
const BCRYPT_ROUNDS = 12;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  cor: { type: String, default: null },
  ordem: { type: Number, default: null }
});

const notificacaoSchema = new mongoose.Schema({
  titulo: { type: String, required: true },
  texto: { type: String, required: true },
  tarefaId: { type: String, default: "" },
  partidaId: { type: String, default: "" },
  tipo: { type: String, enum: ["diaria", "importante", "habito", "xadrez_convite", "xadrez_lance"], required: true },
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
  itens: { type: [itemListaSchema], default: [] },
  criadaEm: { type: Date, required: true, default: Date.now }
});

const habitoSchema = new mongoose.Schema({
  nome: { type: String, required: true, trim: true, maxlength: 100 },
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
  tarefasDiarias: [tarefaSchema],
  tarefasImportantes: [tarefaSchema],
  habitos: [habitoSchema],
  posts: [postSchema],
  folhasCaderno: [folhaCadernoSchema],
  listas: [listaSchema],
  notificacoes: [notificacaoSchema],
  pushTokens: { type: [pushTokenSchema], default: [] },
  xadrezEstadoAtual: { type: mongoose.Schema.Types.Mixed, default: null },
  preferencias: { type: mongoose.Schema.Types.Mixed, default: {} }
});

const User = mongoose.models.User || mongoose.model("User", userSchema, "USERS");

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
  status: { type: String, enum: ["aguardando", "ativa", "finalizada", "recusada", "expirada"], default: "aguardando" },
  pgn: { type: String, default: "" },
  fen: { type: String, default: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" },
  resultado: { type: String, default: "*" },
  mensagens: { type: [chessMessageSchema], default: [] },
  criadaEm: { type: Date, required: true },
  expiraEm: { type: Date, required: true },
  iniciadaEm: { type: Date, default: null },
  atualizadaEm: { type: Date, required: true }
}, { collection: "PARTIDAS_XADREZ" });

const ChessGame = mongoose.models.ChessGame || mongoose.model("ChessGame", chessGameSchema);

const chessLocalGameSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  gameId: { type: String, required: true },
  mode: { type: String, enum: ["local", "stockfish"], required: true },
  playerColor: { type: String, enum: ["w", "b", "both"], required: true },
  opponent: { type: String, required: true, maxlength: 120 },
  resultado: { type: String, enum: ["1-0", "0-1", "1/2-1/2"], required: true },
  moveCount: { type: Number, min: 0, max: 20000, required: true },
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

function urlFotoPerfil(publicId) {
  if (!publicId || !process.env.CLOUDINARY_CLOUD_NAME) return "";
  return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,w_96,h_96,g_face,r_max,f_auto,q_auto/${publicId}`;
}

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

app.get("/usuarios/:userId/perfil", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;
  return res.json({
    nome: user.nome || user.email?.split("@")[0] || "Usuário",
    fotoPerfilUrl: urlFotoPerfil(user.fotoPerfilPublicId)
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
    if (typeof id !== "string" || !/^(?:calendar|weather|message|habit|list|clock|stopwatch|pomodoro|timer-regressivo|utilidades|links|chess|orb-ia|image-[a-zA-Z0-9-]{1,128}|postit-[a-zA-Z0-9-]{1,128})$/.test(id) ||
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
        (!["chess", "orb-ia"].includes(id) &&
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
  const { layoutWidgets, visibilidadeWidgets, postitsWidgets, estiloRelogio, habitoWidget,
    modoArrasteWidgets, tamanhoPainelTarefas, cronometro, pomodoro, duracoesPomodoro,
    notificacoesLancesXadrez, tabuleiroXadrez, listaWidget, linksWidget } = preferencias;
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

  return layoutWidgetsValido(layoutWidgets) && objetoBooleanoValido(visibilidadeWidgets) &&
    postitsWidgetsValidos(postitsWidgets) && ["digital", "analogico", "minimalista", "flip"].includes(estiloRelogio) &&
    (linksWidget === undefined || (Array.isArray(linksWidget) && linksWidget.length <= 50 &&
      linksWidget.every(linkWidgetValido))) &&
    typeof habitoWidget === "string" && habitoWidget.length <= 100 &&
    (listaWidget === undefined || listaWidget === "" ||
      (typeof listaWidget === "string" && mongoose.isValidObjectId(listaWidget))) &&
    typeof modoArrasteWidgets === "boolean" && tamanhoValido && cronometroValido && pomodoroValido &&
    duracoesPomodoroValidas && timerRegressivoValido &&
    (notificacoesLancesXadrez === undefined || typeof notificacoesLancesXadrez === "boolean") &&
    (tabuleiroXadrez === undefined || ["classico", "verde", "madeira"].includes(tabuleiroXadrez));
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
    "+orbIaApiKeyCriptografada nome tarefasDiarias tarefasImportantes habitos posts folhasCaderno listas preferencias"
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
    const resposta = await gerarRespostaGemini({
      chaveApi: descriptografarChaveGemini(user.orbIaApiKeyCriptografada),
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
    return res.json({ resposta });
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

app.post("/tarefas/importantes", async (req, res) => {
  const body = req.body ?? {};
  const { userId, data, hora, minuto } = body;
  const texto = typeof body.texto === "string" ? body.texto.trim() : "";
  const dataCriacao = parseTaskSchedule(data, hora, minuto);
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
  normalizeTaskOrder(user.tarefasImportantes);
  if (user.isModified("tarefasImportantes")) await user.save();
  if (filtro === "todas") {
    return res.json([...user.tarefasImportantes].sort((a, b) => a.ordem - b.ordem));
  }

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
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

  const tarefas = user.tarefasImportantes.filter(tarefa =>
    tarefa.dataCriacao >= inicio && tarefa.dataCriacao < fim
  ).sort((a, b) => a.ordem - b.ordem);
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

  const tarefa = user.tarefasImportantes.id(tarefaId);
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
  return res.json(user.listas);
});

app.post("/listas/:userId", async (req, res) => {
  const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
  if (!nome || nome.length > 100) {
    return res.status(400).json({ erro: "Informe um nome de lista de at\u00e9 100 caracteres" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  user.listas.push({ nome });
  await user.save();
  return res.status(201).json(user.listas.at(-1));
});

app.put("/listas/:userId/:listaId", async (req, res) => {
  const { userId, listaId } = req.params;
  const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
  if (!mongoose.isValidObjectId(listaId) || !nome || nome.length > 100) {
    return res.status(400).json({ erro: "Lista inv\u00e1lida" });
  }

  const user = await findUser(userId, res);
  if (!user) return;
  const lista = user.listas.id(listaId);
  if (!lista) return res.status(404).json({ erro: "Lista n\u00e3o encontrada" });
  lista.nome = nome;
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
  lista.itens.push({ texto });
  await user.save();
  return res.status(201).json(lista.itens.at(-1));
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
  const horario = req.body?.horario;
  const horarios = req.body?.horarios ?? [];
  const fusoHorario = req.body?.fusoHorario;
  if (!nome || nome.length > 100 || typeof horario !== "string" ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(horario) || !Array.isArray(horarios) ||
      horarios.length > 12 || horarios.some(item => typeof item !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item)) ||
      (horarios.length > 0 && (horarios.length < 2 || new Set(horarios).size !== horarios.length)) ||
      !fusoHorarioValido(fusoHorario)) {
    return res.status(400).json({ erro: "Informe um nome de até 100 caracteres e um horário válido" });
  }

  const user = await findUser(req.params.userId, res);
  if (!user) return;
  user.habitos.push({ nome, horario, horarios, fusoHorario });
  await user.save();
  return res.status(201).json(user.habitos.at(-1));
});

app.put("/habitos/:userId/:habitoId", async (req, res) => {
  const { userId, habitoId } = req.params;
  if (!mongoose.isValidObjectId(habitoId)) {
    return res.status(400).json({ erro: "Identificador de hábito inválido" });
  }
  const nome = typeof req.body?.nome === "string" ? req.body.nome.trim() : "";
  const horario = req.body?.horario;
  const horarios = req.body?.horarios ?? [];
  const fusoHorario = req.body?.fusoHorario;
  if (!nome || nome.length > 100 || typeof horario !== "string" ||
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
  const { mode, playerColor, skillLevel, pgn, updatedAt, replaceOnlineState } = req.body || {};
  if (!["local", "stockfish"].includes(mode) || !["w", "b"].includes(playerColor) ||
      !Number.isInteger(skillLevel) || skillLevel < 1 || skillLevel > 20 ||
      typeof pgn !== "string" || pgn.length > 20000 ||
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
    mode,
    playerColor,
    skillLevel,
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
  if (!mongoose.isValidObjectId(req.params.userId) ||
      typeof gameId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(gameId) ||
      !["local", "stockfish"].includes(mode) ||
      !(mode === "local" ? playerColor === "both" : ["w", "b"].includes(playerColor)) ||
      typeof opponent !== "string" || !opponent.trim() || opponent.length > 120 ||
      typeof pgn !== "string" || pgn.length > 20000) {
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
  await ChessLocalGame.findOneAndUpdate(
    { userId: user._id, gameId },
    {
      $set: {
        mode,
        playerColor,
        opponent: opponent.trim(),
        resultado,
        moveCount: jogo.history().length
      },
      $setOnInsert: { playedAt: new Date() }
    },
    { upsert: true, new: true, runValidators: true }
  );
  return res.json({ ok: true });
});

app.get("/xadrez/usuarios/:userId/historico", async (req, res) => {
  const user = await findUser(req.params.userId, res);
  if (!user) return;

  const partidasOnline = await ChessGame.find({
    status: "finalizada",
    resultado: { $in: ["1-0", "0-1", "1/2-1/2"] },
    $or: [{ jogadorBrancas: user._id }, { jogadorPretas: user._id }]
  }).select("jogadorBrancas jogadorPretas nomeBrancas nomePretas resultado pgn atualizadaEm");
  const partidasLocais = await ChessLocalGame.find({ userId: user._id })
    .select("gameId mode opponent playerColor resultado moveCount playedAt");

  const historicoLocal = partidasLocais.map(partida => ({
    gameId: partida.gameId,
    mode: partida.mode,
    opponent: partida.opponent,
    playerColor: partida.playerColor,
    resultado: partida.resultado,
    moveCount: partida.moveCount,
    playedAt: partida.playedAt
  }));
  const historicoOnline = partidasOnline.map(partida => {
    const jogadorBrancas = String(partida.jogadorBrancas) === String(user._id);
    const playerColor = jogadorBrancas ? "w" : "b";
    const jogo = new Chess();
    if (partida.pgn) jogo.loadPgn(partida.pgn);
    return {
      gameId: String(partida._id),
      mode: "invite",
      opponent: jogadorBrancas ? partida.nomePretas : partida.nomeBrancas,
      playerColor,
      resultado: partida.resultado,
      moveCount: jogo.history().length,
      playedAt: partida.atualizadaEm
    };
  });

  const partidas = [...historicoLocal, ...historicoOnline]
    .sort((a, b) => new Date(b.playedAt).getTime() - new Date(a.playedAt).getTime());
  return res.json({ partidas });
});

app.post("/xadrez/convites/:userId", async (req, res) => {
  const email = typeof req.body?.email === "string" ? normalizarEmail(req.body.email) : "";
  if (!emailValido(email) || email.length > 254) {
    return res.status(400).json({ erro: "Informe um e-mail válido." });
  }

  const remetente = await findUser(req.params.userId, res);
  if (!remetente) return;
  const convidado = await User.findOne({
    $or: [
      { emailNormalizado: email },
      { email: emailExatoCaseInsensitive(email) }
    ]
  }).select("_id nome email");
  if (!convidado) return res.status(404).json({ erro: "Não existe uma conta Orby com esse e-mail." });
  if (String(convidado._id) === String(remetente._id)) {
    return res.status(400).json({ erro: "Você não pode convidar a si mesmo." });
  }
  const destinatario = await findUser(String(convidado._id), res);
  if (!destinatario) return;

  const agora = new Date();
  const conviteExistente = await ChessGame.findOne({
    jogadorBrancas: remetente._id,
    jogadorPretas: convidado._id,
    status: "aguardando",
    expiraEm: { $gt: agora }
  }).select("_id");
  if (conviteExistente) {
    remetente.xadrezEstadoAtual = { mode: "invite", gameId: String(conviteExistente._id) };
    await remetente.save();
    return res.status(409).json({
      erro: "Já existe um convite aguardando resposta desse usuário.",
      partidaId: String(conviteExistente._id),
      status: "aguardando"
    });
  }

  const expiraEm = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);
  const partida = await ChessGame.create({
    jogadorBrancas: remetente._id,
    jogadorPretas: convidado._id,
    criador: remetente._id,
    nomeBrancas: remetente.nome || remetente.email || "Jogador",
    nomePretas: destinatario.nome || destinatario.email || "Jogador",
    status: "aguardando",
    criadaEm: agora,
    expiraEm,
    atualizadaEm: agora
  });

  const notificacaoConvite = {
    titulo: "Convite para uma partida de xadrez",
    texto: `${remetente.nome || remetente.email || "Um usuário"} convidou você para jogar xadrez.`,
    partidaId: String(partida._id),
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
  return res.status(201).json({ partidaId: String(partida._id), status: partida.status });
});

app.get("/xadrez/partidas/:partidaId/:userId", async (req, res) => {
  const { partidaId, userId } = req.params;
  if (!mongoose.isValidObjectId(partidaId)) {
    return res.status(400).json({ erro: "Identificador da partida inválido." });
  }
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ erro: "Identificador de usuário inválido." });
  }
  const partida = await ChessGame.findById(partidaId);
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

  return res.json({
    partidaId: String(partida._id),
    status: partida.status,
    pgn: partida.pgn,
    fen: partida.fen,
    resultado: partida.resultado,
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
    jogadorPretas: userId,
    status: "aguardando",
    expiraEm: { $gt: agora }
  }, {
    $set: { status: "ativa", iniciadaEm: agora, atualizadaEm: agora }
  }, { new: true });
  if (!partida) {
    partida = await ChessGame.findOne({ _id: partidaId, jogadorPretas: userId });
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
    pgn: partida.pgn,
    cor: "b",
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
    jogadorPretas: userId,
    status: "aguardando",
    expiraEm: { $gt: new Date() }
  }, {
    $set: { status: "recusada", atualizadaEm: new Date() }
  }, { new: true });
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
  }, { new: true }).select("_id");
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
  }, { new: true });
  if (!partidaAtualizada) {
    return res.status(409).json({ erro: "A partida foi atualizada; sincronize e tente novamente." });
  }
  return res.json({
    status: partidaAtualizada.status,
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
    const usuarios = await User.find({}).select("tarefasDiarias tarefasImportantes habitos notificacoes");
    const expiraEm = new Date(agora.getTime() + 7 * 24 * 60 * 60 * 1000);

    for (const usuario of usuarios) {
      const notificacoesAtivas = usuario.notificacoes.filter(notificacao => notificacao.expiraEm > agora);
      let alterado = notificacoesAtivas.length !== usuario.notificacoes.length;
      const notificacoesParaEnviar = [];
      if (alterado) usuario.notificacoes = notificacoesAtivas;

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

  return app.listen(PORT, () => {
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
