import { Chess } from "/vendor/chess.js/chess.js";

const storageKey = "orby-chess-pgn-v1";
const gameSettingsStorageKey = "orby-chess-game-settings-v1";
const localGamePgnUpdatedAtStorageKey = "orby-chess-pgn-updated-at-v1";
let chess = new Chess();
const board = document.getElementById("chessBoard");
const status = document.getElementById("chessStatus");
const capturedByWhite = document.getElementById("chessCapturedByWhite");
const capturedByBlack = document.getElementById("chessCapturedByBlack");
const capturedRowWhite = document.getElementById("chessCapturedRowWhite");
const capturedRowBlack = document.getElementById("chessCapturedRowBlack");
const historyList = document.getElementById("chessHistory");
const historyEmpty = document.getElementById("chessHistoryEmpty");
const promotionDialog = document.getElementById("chessPromotionDialog");
const settingsDialog = document.getElementById("chessSettingsDialog");
const matchHistoryDialog = document.getElementById("chessMatchHistoryDialog");
const matchHistoryList = document.getElementById("chessMatchHistoryList");
const matchHistoryStatus = document.getElementById("chessMatchHistoryStatus");
const settingsOpenButton = document.getElementById("chessSettingsOpen");
const matchHistoryOpenButton = document.getElementById("chessMatchHistoryOpen");
const chatOpenButton = document.getElementById("chessChatOpen");
const chatAnnouncement = document.getElementById("chessChatAnnouncement");
const chatPanel = document.getElementById("chessChatPanel");
const chatCloseButton = document.getElementById("chessChatClose");
const chatOpponent = document.getElementById("chessChatOpponent");
const chatMessagesList = document.getElementById("chessChatMessages");
const chatEmpty = document.getElementById("chessChatEmpty");
const chatStatus = document.getElementById("chessChatStatus");
const chatForm = document.getElementById("chessChatForm");
const chatInput = document.getElementById("chessChatInput");
const chatSendButton = document.getElementById("chessChatSend");
const gameModeSelect = document.getElementById("chessGameMode");
const playerColorSelect = document.getElementById("chessPlayerColor");
const skillLevelInput = document.getElementById("chessSkillLevel");
const skillValue = document.getElementById("chessSkillValue");
const opponentOptions = document.getElementById("chessOpponentOptions");
const inviteOptions = document.getElementById("chessInviteOptions");
const inviteEmailInput = document.getElementById("chessInviteEmail");
const moveNotificationsInput = document.getElementById("chessMoveNotifications");
const boardThemeSelect = document.getElementById("chessBoardTheme");
const newGameButton = document.getElementById("chessNewGame");
const newGameLabel = document.getElementById("chessNewGameLabel");
const resignButton = document.getElementById("chessResign");
const engineStatus = document.getElementById("chessEngineStatus");
const resizeButton = document.getElementById("chessResize");
const widgetCard = document.querySelector(".chess-widget-card");
const widget = widgetCard.closest(".workspace-widget");
const workspace = widget.closest(".widgetsWorkspace");
const widthStorageKey = "orby-chess-widget-width-v1";
const chessMoveSound = new Audio("/sons/chesss.mp3");
const chessCaptureSound = new Audio("/sons/pecacapiturada.mp3");
const minimumWidth = 180;
const userId = window.orbyUserId || "";
const chessBoardThemes = ["classico", "verde", "madeira"];
let chessBoardTheme = chessBoardThemes.includes(window.orbyChessBoardTheme)
  ? window.orbyChessBoardTheme
  : "verde";
let resizePointer = null;
let pieceDrag = null;
let ignoreBoardClickUntil = 0;
const pieceSymbols = {
  w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
  b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" }
};
const pieceNames = {
  k: "rei",
  q: "dama",
  r: "torre",
  b: "bispo",
  n: "cavalo",
  p: "peão"
};
const files = "abcdefgh";
let selectedSquare = null;
let legalMoves = [];
let pendingPromotion = null;
let gameMode = "local";
let playerColor = "w";
let skillLevel = 10;
let inviteGameId = "";
let localGameId = "";
let inviteEmail = "";
let onlineGameStatus = "";
let onlineGameResult = "*";
let onlineOpponent = "";
let onlineError = "";
let onlineMoveBusy = false;
let resignationBusy = false;
let onlineSyncBusy = false;
let onlineSyncTimer = null;
let onlineSyncedGameId = "";
let chatSyncTimer = null;
let chatSyncBusy = false;
let chatSendBusy = false;
let chatMessages = [];
let chatMessagesGameId = "";
let chatUnreadCount = 0;
let chatInitializedForGame = false;
let localGameSaveTimer = null;
let localGameSaveBusy = false;
let localGameSavePending = false;
let localHistorySubmissionBusy = false;
let localHistorySubmittedGameId = "";
let localGameReplaceOnlineStatePending = false;
let localGameUpdatedAt = 0;
let localGamePgnUpdatedAt = 0;
let stockfishWorker = null;
let stockfishReady = false;
let stockfishThinking = false;
let stockfishSearchFen = "";
let stockfishError = "";

try {
  const savedWidth = Number(localStorage.getItem(widthStorageKey));
  if (!widgetCard.style.width && Number.isFinite(savedWidth) && savedWidth > 0) {
    widgetCard.style.width = `${savedWidth}px`;
  } else if (!widgetCard.style.width && localStorage.getItem("orby-chess-widget-size-v1") === "large") {
    widgetCard.style.width = "460px";
  }
} catch (error) {
  console.warn("Não foi possível carregar a largura salva do widget de xadrez.", error);
}

function limiteLarguraWidget() {
  const larguraDisponivel = Math.min(
    workspace.clientWidth - widget.offsetLeft - 8,
    window.innerWidth - 24
  );
  return Math.max(minimumWidth, Math.min(620, larguraDisponivel));
}

function ajustarLarguraWidget(largura) {
  const larguraAjustada = Math.round(Math.max(minimumWidth, Math.min(limiteLarguraWidget(), largura)));
  widgetCard.style.width = `${larguraAjustada}px`;
  return larguraAjustada;
}

function salvarLarguraWidget() {
  const width = Math.round(widgetCard.getBoundingClientRect().width);
  try {
    localStorage.setItem(widthStorageKey, String(width));
  } catch (error) {
    console.warn("Não foi possível salvar a largura do widget de xadrez.", error);
    document.getElementById("chessStorageStatus").textContent =
      "Não foi possível salvar o tamanho do widget neste dispositivo.";
  }
  document.dispatchEvent(new CustomEvent("chess-widget-resized", { detail: { width } }));
}

try {
  localGamePgnUpdatedAt = Number(localStorage.getItem(localGamePgnUpdatedAtStorageKey)) || 0;
  const savedPgn = localStorage.getItem(storageKey);
  if (savedPgn) {
    const savedGame = new Chess();
    savedGame.loadPgn(savedPgn);
    chess = savedGame;
  }
} catch (error) {
  chess = new Chess();
  console.warn("Não foi possível restaurar a partida de xadrez salva.", error);
  document.getElementById("chessStorageStatus").textContent =
    "Não foi possível carregar a partida salva; uma nova partida foi iniciada.";
}

try {
  const savedSettings = JSON.parse(localStorage.getItem(gameSettingsStorageKey) || "{}");
  if (["local", "stockfish", "invite"].includes(savedSettings.mode)) gameMode = savedSettings.mode;
  if (["w", "b"].includes(savedSettings.playerColor)) playerColor = savedSettings.playerColor;
  if (Number.isInteger(savedSettings.skillLevel) && savedSettings.skillLevel >= 1 && savedSettings.skillLevel <= 20) {
    skillLevel = savedSettings.skillLevel;
  }
  if (typeof savedSettings.gameId === "string") inviteGameId = savedSettings.gameId;
  if (typeof savedSettings.localGameId === "string") localGameId = savedSettings.localGameId;
  if (typeof savedSettings.inviteEmail === "string") inviteEmail = savedSettings.inviteEmail;
} catch (error) {
  console.warn("Não foi possível carregar as configurações da partida de xadrez.", error);
}

if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(localGameId)) {
  localGameId = crypto.randomUUID();
  saveGameSettings();
}

function saveGame({ replaceOnlineState = false } = {}) {
  try {
    localStorage.setItem(storageKey, chess.pgn());
    if (gameMode !== "invite") {
      localGamePgnUpdatedAt = Math.max(Date.now(), localGamePgnUpdatedAt + 1);
      localStorage.setItem(localGamePgnUpdatedAtStorageKey, String(localGamePgnUpdatedAt));
    }
    document.getElementById("chessStorageStatus").textContent = "";
  } catch (error) {
    console.warn("Não foi possível salvar a partida de xadrez neste dispositivo.", error);
    document.getElementById("chessStorageStatus").textContent =
      "Não foi possível salvar a partida neste dispositivo.";
  }
  if (gameMode !== "invite" && userId) agendarSalvamentoPartidaLocal(replaceOnlineState);
}

function agendarSalvamentoPartidaLocal(replaceOnlineState = false) {
  localGameSavePending = true;
  localGameReplaceOnlineStatePending ||= replaceOnlineState;
  if (localGameSaveTimer) window.clearTimeout(localGameSaveTimer);
  localGameSaveTimer = window.setTimeout(() => void salvarPartidaLocalNoServidor(), 400);
}

function cancelarSalvamentoPartidaLocal() {
  if (localGameSaveTimer) window.clearTimeout(localGameSaveTimer);
  localGameSaveTimer = null;
  localGameSavePending = false;
  localGameReplaceOnlineStatePending = false;
}

async function salvarPartidaLocalNoServidor() {
  localGameSaveTimer = null;
  if (localGameSaveBusy || !localGameSavePending || gameMode === "invite") return;
  localGameSaveBusy = true;
  try {
    while (localGameSavePending && gameMode !== "invite") {
      localGameSavePending = false;
      const replaceOnlineState = localGameReplaceOnlineStatePending;
      localGameReplaceOnlineStatePending = false;
      const updatedAt = Math.max(Date.now(), localGameUpdatedAt + 1);
      localGameUpdatedAt = updatedAt;
      localGamePgnUpdatedAt = Math.max(localGamePgnUpdatedAt, updatedAt);
      try {
        localStorage.setItem(localGamePgnUpdatedAtStorageKey, String(localGamePgnUpdatedAt));
      } catch (error) {
        console.warn("Não foi possível registrar a data local da partida de xadrez.", error);
      }
      const response = await fetch(`/xadrez/usuarios/${encodeURIComponent(userId)}/partida-local`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: gameMode,
          playerColor,
          skillLevel,
          pgn: chess.pgn(),
          updatedAt,
          replaceOnlineState
        })
      });
      const resultado = await response.json();
      if (response.status === 409) {
        document.getElementById("chessStorageStatus").textContent = "";
        continue;
      }
      if (!response.ok) throw new Error(resultado.erro || "Não foi possível salvar a partida na conta.");
      localGameUpdatedAt = Math.max(localGameUpdatedAt, resultado.partida.updatedAt);
      localGamePgnUpdatedAt = Math.max(localGamePgnUpdatedAt, resultado.partida.updatedAt);
      try {
        localStorage.setItem(localGamePgnUpdatedAtStorageKey, String(localGamePgnUpdatedAt));
      } catch (error) {
        console.warn("Não foi possível registrar a data local da partida de xadrez.", error);
      }
      document.getElementById("chessStorageStatus").textContent = "";
    }
  } catch (error) {
    console.error("Não foi possível salvar a partida de xadrez na conta.", error);
    document.getElementById("chessStorageStatus").textContent =
      error.message || "Não foi possível salvar a partida na conta.";
  } finally {
    localGameSaveBusy = false;
    if (localGameSavePending) agendarSalvamentoPartidaLocal();
  }
}

function saveGameSettings() {
  try {
    localStorage.setItem(gameSettingsStorageKey, JSON.stringify({
      mode: gameMode,
      playerColor,
      skillLevel,
      gameId: inviteGameId,
      localGameId,
      inviteEmail
    }));
  } catch (error) {
    console.warn("Não foi possível salvar as configurações da partida de xadrez.", error);
    document.getElementById("chessStorageStatus").textContent =
      "Não foi possível salvar as configurações neste dispositivo.";
  }
}

function isComputerTurn() {
  return gameMode === "stockfish" && chess.turn() !== playerColor;
}

function tocarSomLanceXadrez(lance = null) {
  const som = lance?.captured ? chessCaptureSound : chessMoveSound;
  som.currentTime = 0;
  void som.play().catch(error => {
    console.warn("Não foi possível reproduzir o som do lance de xadrez.", error);
  });
}

async function registrarPartidaLocalFinalizada() {
  if (!userId || gameMode === "invite" || !isGameFinished() ||
      localHistorySubmissionBusy || localHistorySubmittedGameId === localGameId) return;

  const headers = chess.getHeaders();
  const resultado = chess.isCheckmate()
    ? chess.turn() === "w" ? "0-1" : "1-0"
    : chess.isDraw() ? "1/2-1/2"
      : headers.Termination === "resignation" && ["1-0", "0-1"].includes(headers.Result)
        ? headers.Result
        : null;
  if (!resultado) return;

  const partida = {
    gameId: localGameId,
    mode: gameMode,
    playerColor: gameMode === "local" ? "both" : playerColor,
    opponent: gameMode === "local" ? "Partida local" : "Stockfish",
    pgn: chess.pgn()
  };
  localHistorySubmissionBusy = true;
  try {
    const response = await fetch(`/xadrez/usuarios/${encodeURIComponent(userId)}/historico-local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partida)
    });
    const resultadoResposta = await response.json();
    if (!response.ok) throw new Error(resultadoResposta.erro || "Não foi possível salvar o histórico da partida.");
    localHistorySubmittedGameId = localGameId;
  } catch (error) {
    console.error("Não foi possível salvar o histórico da partida de xadrez.", error);
    document.getElementById("chessStorageStatus").textContent =
      error.message || "Não foi possível salvar o histórico da partida.";
  } finally {
    localHistorySubmissionBusy = false;
  }
}

function rotuloResultadoHistorico(partida) {
  if (partida.resultado === "1/2-1/2") return "Empate";
  if (partida.playerColor === "both") {
    return partida.resultado === "1-0" ? "Vitória das brancas" : "Vitória das pretas";
  }
  const venceu = (partida.playerColor === "w" && partida.resultado === "1-0") ||
    (partida.playerColor === "b" && partida.resultado === "0-1");
  return venceu ? "Vitória" : "Derrota";
}

async function carregarHistoricoPartidas() {
  matchHistoryList.replaceChildren();
  if (!userId) {
    matchHistoryStatus.textContent = "Entre na sua conta para consultar o histórico.";
    return;
  }
  matchHistoryStatus.textContent = "Carregando partidas...";
  try {
    const response = await fetch(`/xadrez/usuarios/${encodeURIComponent(userId)}/historico`);
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Não foi possível carregar o histórico.");
    if (!Array.isArray(resultado.partidas)) throw new Error("O servidor devolveu um histórico inválido.");
    matchHistoryList.replaceChildren();
    if (!resultado.partidas.length) {
      matchHistoryStatus.textContent = "Nenhuma partida finalizada ainda.";
      return;
    }
    for (const partida of resultado.partidas) {
      const item = document.createElement("li");
      const principal = document.createElement("div");
      const nome = document.createElement("strong");
      const detalhes = document.createElement("span");
      const resultadoPartida = document.createElement("span");
      const data = document.createElement("time");
      const dataPartida = new Date(partida.playedAt);
      const cor = partida.playerColor === "w" ? "Brancas"
        : partida.playerColor === "b" ? "Pretas" : "Brancas e pretas";
      item.className = "chess-match-history-item";
      principal.className = "chess-match-history-main";
      nome.textContent = partida.opponent || "Adversário desconhecido";
      detalhes.textContent = `${cor} · ${partida.moveCount} ${partida.moveCount === 1 ? "lance" : "lances"}`;
      resultadoPartida.className = "chess-match-history-result";
      resultadoPartida.textContent = rotuloResultadoHistorico(partida);
      if (Number.isFinite(dataPartida.getTime())) {
        data.dateTime = dataPartida.toISOString();
        data.textContent = dataPartida.toLocaleString();
      }
      principal.append(nome, detalhes);
      item.append(principal, resultadoPartida, data);
      matchHistoryList.appendChild(item);
    }
    matchHistoryStatus.textContent = "";
  } catch (error) {
    console.error("Não foi possível carregar o histórico de partidas de xadrez.", error);
    matchHistoryStatus.textContent = error.message || "Não foi possível carregar o histórico.";
  }
}

function isHumanTurn() {
  return gameMode === "local" ||
    ((gameMode === "stockfish" || (gameMode === "invite" && onlineGameStatus === "ativa")) &&
      chess.turn() === playerColor);
}

function setEngineStatus(message) {
  engineStatus.textContent = message;
  engineStatus.hidden = !message;
}

function aplicarTemaTabuleiro(tema) {
  if (!chessBoardThemes.includes(tema)) return;
  chessBoardTheme = tema;
  board.dataset.theme = tema;
  boardThemeSelect.value = tema;
}

function stopStockfish() {
  if (stockfishWorker) {
    stockfishWorker.postMessage("quit");
    stockfishWorker.terminate();
  }
  stockfishWorker = null;
  stockfishReady = false;
  stockfishThinking = false;
  stockfishSearchFen = "";
}

function failStockfish(error) {
  console.error("Não foi possível executar o Stockfish.", error);
  stockfishError = "Não foi possível iniciar o Stockfish. Tente iniciar outra partida.";
  stopStockfish();
  setEngineStatus(stockfishError);
  render();
}

function receiveStockfishMessage(event) {
  const line = String(event.data || "").trim();
  if (line === "uciok") {
    stockfishWorker.postMessage(`setoption name Skill Level value ${skillLevel}`);
    stockfishWorker.postMessage("isready");
    return;
  }
  if (line === "readyok") {
    stockfishReady = true;
    stockfishError = "";
    setEngineStatus("");
    requestComputerMove();
    return;
  }
  if (!line.startsWith("bestmove ")) return;
  const searchedFen = stockfishSearchFen;
  stockfishThinking = false;
  setEngineStatus("");
  if (searchedFen !== chess.fen() || !isComputerTurn() || isGameFinished()) return;
  const match = line.match(/^bestmove\s+([a-h][1-8])([a-h][1-8])([qrbn])?/);
  if (!match) {
    failStockfish(new Error(`Resposta inválida do motor: ${line}`));
    return;
  }
  const move = chess.moves({ verbose: true }).find(candidate =>
    candidate.from === match[1] && candidate.to === match[2] &&
    (candidate.promotion || undefined) === (match[3] || undefined)
  );
  if (!move) {
    failStockfish(new Error(`O motor sugeriu um lance ilegal: ${line}`));
    return;
  }
  applyMove({ from: move.from, to: move.to, promotion: move.promotion });
}

function iniciarStockfish() {
  stopStockfish();
  stockfishError = "";
  setEngineStatus("Iniciando Stockfish...");
  try {
    stockfishWorker = new Worker("/vendor/stockfish.js/stockfish.wasm.js");
    stockfishWorker.addEventListener("message", receiveStockfishMessage);
    stockfishWorker.addEventListener("error", failStockfish);
    stockfishWorker.postMessage("uci");
  } catch (error) {
    failStockfish(error);
  }
}

function requestComputerMove() {
  if (!isComputerTurn() || isGameFinished() || stockfishThinking || stockfishError) return;
  if (!stockfishWorker) {
    iniciarStockfish();
    return;
  }
  if (!stockfishReady) return;
  stockfishThinking = true;
  stockfishSearchFen = chess.fen();
  setEngineStatus(`Stockfish pensando — nível ${skillLevel}...`);
  stockfishWorker.postMessage(`position fen ${stockfishSearchFen}`);
  stockfishWorker.postMessage(`go depth ${Math.round(4 + (skillLevel - 1) * 0.4)}`);
}

function currentTurnName() {
  return chess.turn() === "w" ? "brancas" : "pretas";
}

function getResignedColor() {
  if (chess.getHeaders().Termination !== "resignation") return null;
  if (chess.getHeaders().Result === "1-0") return "b";
  if (chess.getHeaders().Result === "0-1") return "w";
  return null;
}

function isGameFinished() {
  return chess.isGameOver() || getResignedColor() !== null;
}

function updateResignButton() {
  resignButton.disabled = resignationBusy || isGameFinished() ||
    (gameMode === "invite" && onlineGameStatus !== "ativa");
}

function getGameStatus() {
  if (gameMode === "invite") {
    if (onlineError) return onlineError;
    if (onlineGameStatus === "aguardando") {
      return `Convite enviado para ${inviteEmail || onlineOpponent}. Aguardando resposta.`;
    }
    if (onlineGameStatus === "recusada") return "O convite para esta partida foi recusado.";
    if (onlineGameStatus === "expirada") return "O convite para esta partida expirou.";
    if (onlineGameStatus !== "ativa" && onlineGameStatus !== "finalizada") {
      return "Conectando à partida convidada...";
    }
  }
  const resignedColor = getResignedColor();
  if (resignedColor) {
    const vencedor = resignedColor === "w" ? "pretas" : "brancas";
    if (gameMode === "invite") {
      return resignedColor === playerColor
        ? `Você desistiu. As ${vencedor} venceram.`
        : "Seu oponente desistiu. Você venceu.";
    }
    if (gameMode === "stockfish") return "Você desistiu. O Stockfish venceu.";
    return `As ${resignedColor === "w" ? "brancas" : "pretas"} desistiram. As ${vencedor} venceram.`;
  }
  if (chess.isCheckmate()) {
    return `Xeque-mate! As ${chess.turn() === "w" ? "pretas" : "brancas"} venceram.`;
  }
  if (chess.isStalemate()) return "Empate por afogamento.";
  if (chess.isInsufficientMaterial()) return "Empate por material insuficiente.";
  if (chess.isThreefoldRepetition()) return "Empate por repetição tripla.";
  if (chess.isDrawByFiftyMoves()) return "Empate pela regra dos 50 lances.";
  if (gameMode === "invite") {
    if (onlineGameStatus === "finalizada") return `Partida finalizada (${onlineOpponent}).`;
    if (chess.isCheck()) {
      return chess.turn() === playerColor
        ? `Xeque! Sua vez (${currentTurnName()}) · contra ${onlineOpponent}.`
        : `Xeque! Vez de ${onlineOpponent} (${currentTurnName()}).`;
    }
    return chess.turn() === playerColor
      ? `Sua vez (${currentTurnName()}) · contra ${onlineOpponent}.`
      : `Vez de ${onlineOpponent}.`;
  }
  if (chess.isCheck()) {
    if (gameMode === "stockfish") {
      return chess.turn() === playerColor
        ? `Xeque! Sua vez (${currentTurnName()}).`
        : `Xeque! Vez do Stockfish (${currentTurnName()}).`;
    }
    return `Xeque! Vez das ${currentTurnName()}.`;
  }
  if (isComputerTurn()) {
    if (stockfishError) return "Stockfish indisponível. Abra as configurações para iniciar outra partida.";
    if (stockfishThinking) return "Stockfish pensando...";
    return "Aguardando Stockfish...";
  }
  if (gameMode === "stockfish") return `Sua vez (${currentTurnName()}).`;
  return `Vez das ${currentTurnName()}.`;
}

function pararSincronizacaoConvidada() {
  if (onlineSyncTimer) window.clearInterval(onlineSyncTimer);
  onlineSyncTimer = null;
}

function pararSincronizacaoChat() {
  if (chatSyncTimer) window.clearInterval(chatSyncTimer);
  chatSyncTimer = null;
}

function atualizarNotificacaoChat() {
  const hasUnread = chatUnreadCount > 0;
  chatOpenButton.classList.toggle("has-unread", hasUnread);
  chatOpenButton.title = hasUnread
    ? `${chatUnreadCount} ${chatUnreadCount === 1 ? "nova mensagem" : "novas mensagens"}`
    : "Chat da partida";
  chatOpenButton.setAttribute("aria-label", hasUnread
    ? `Abrir chat da partida, ${chatUnreadCount} ${chatUnreadCount === 1 ? "nova mensagem" : "novas mensagens"}`
    : "Abrir chat da partida");
}

function isChatAvailable() {
  return gameMode === "invite" && Boolean(inviteGameId) &&
    ["ativa", "finalizada"].includes(onlineGameStatus);
}

function atualizarDisponibilidadeChat() {
  const available = isChatAvailable();
  if (!available) {
    chatMessages = [];
    chatMessagesGameId = "";
    chatUnreadCount = 0;
    chatInitializedForGame = false;
    chatMessagesList.replaceChildren();
    chatEmpty.hidden = false;
  } else if (chatMessagesGameId !== inviteGameId) {
    chatMessages = [];
    chatUnreadCount = 0;
    chatInitializedForGame = false;
    chatMessagesGameId = inviteGameId;
    chatMessagesList.replaceChildren();
    chatEmpty.hidden = false;
  }
  chatOpenButton.hidden = !available;
  atualizarNotificacaoChat();
  chatOpponent.textContent = onlineOpponent ? `com ${onlineOpponent}` : "";
  if (!available && !chatPanel.hidden) fecharChatPartida();
  chatInput.disabled = chatSendBusy || onlineGameStatus !== "ativa";
  chatSendButton.disabled = chatSendBusy || onlineGameStatus !== "ativa";
  if (onlineGameStatus === "finalizada" && !chatStatus.textContent) {
    chatStatus.textContent = "Partida encerrada: chat somente para leitura.";
  }
  if (onlineGameStatus === "ativa" && !chatSyncTimer) {
    void sincronizarChatPartida();
    chatSyncTimer = window.setInterval(() => void sincronizarChatPartida(), 2500);
  } else if (onlineGameStatus !== "ativa") {
    pararSincronizacaoChat();
  }
}

function renderizarMensagensChat(scrollToBottom = false) {
  const estavaNoFim = chatMessagesList.scrollHeight - chatMessagesList.scrollTop -
    chatMessagesList.clientHeight < 24;
  chatMessagesList.replaceChildren();
  chatEmpty.hidden = chatMessages.length > 0;
  for (const mensagem of chatMessages) {
    const item = document.createElement("li");
    const nome = document.createElement("span");
    const texto = document.createElement("span");
    item.className = `chess-chat-message${mensagem.senderId === userId ? " chess-chat-message-own" : ""}`;
    nome.className = "chess-chat-message-name";
    nome.textContent = mensagem.senderId === userId ? "Você" : mensagem.senderName;
    texto.className = "chess-chat-message-text";
    texto.textContent = mensagem.text;
    item.append(nome, texto);
    const timestamp = new Date(mensagem.createdAt);
    if (Number.isFinite(timestamp.getTime())) {
      const hora = document.createElement("time");
      hora.dateTime = timestamp.toISOString();
      hora.textContent = timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      item.appendChild(hora);
    }
    chatMessagesList.appendChild(item);
  }
  if (scrollToBottom || estavaNoFim) chatMessagesList.scrollTop = chatMessagesList.scrollHeight;
}

async function sincronizarChatPartida() {
  if (isChatAvailable() && !chatSyncBusy) {
    chatSyncBusy = true;
    const partidaId = inviteGameId;
    try {
      const response = await fetch(`/xadrez/partidas/${encodeURIComponent(partidaId)}/chat/${encodeURIComponent(userId)}`);
      const resultado = await response.json();
      if (!response.ok) throw new Error(resultado.erro || "Não foi possível carregar o chat.");
      if (partidaId !== inviteGameId || gameMode !== "invite") return;
      if (!Array.isArray(resultado.mensagens)) {
        throw new Error("O servidor devolveu um histórico de chat inválido.");
      }
      const idsAnteriores = new Set(chatMessages.map(mensagem => mensagem.id));
      const primeiraSincronizacao = !chatInitializedForGame;
      const novasMensagensDoOponente = primeiraSincronizacao ? [] : resultado.mensagens.filter(mensagem =>
        !idsAnteriores.has(mensagem.id) && mensagem.senderId !== userId
      );
      const mensagensAnteriores = chatMessages.map(mensagem => mensagem.id).join(",");
      chatMessages = resultado.mensagens;
      chatMessagesGameId = partidaId;
      chatInitializedForGame = true;
      chatStatus.textContent = "";
      if (chatPanel.hidden && novasMensagensDoOponente.length) {
        chatUnreadCount += novasMensagensDoOponente.length;
        chatAnnouncement.textContent = `${novasMensagensDoOponente.length} ${
          novasMensagensDoOponente.length === 1 ? "nova mensagem recebida" : "novas mensagens recebidas"
        } no chat da partida.`;
        atualizarNotificacaoChat();
      }
      if (mensagensAnteriores !== chatMessages.map(mensagem => mensagem.id).join(",")) {
        renderizarMensagensChat();
      }
    } catch (error) {
      console.error("Não foi possível sincronizar o chat da partida.", error);
      if (partidaId === inviteGameId) chatStatus.textContent = error.message || "Não foi possível carregar o chat.";
    } finally {
      chatSyncBusy = false;
    }
  }
}

function abrirChatPartida() {
  if (!isChatAvailable()) return;
  chatPanel.hidden = false;
  chatOpenButton.setAttribute("aria-expanded", "true");
  chatUnreadCount = 0;
  chatAnnouncement.textContent = "";
  atualizarNotificacaoChat();
  chatStatus.textContent = onlineGameStatus === "finalizada"
    ? "Partida encerrada: chat somente para leitura."
    : "";
  atualizarDisponibilidadeChat();
  chatInput.focus();
  void sincronizarChatPartida();
}

function fecharChatPartida() {
  chatPanel.hidden = true;
  chatOpenButton.setAttribute("aria-expanded", "false");
}

async function enviarMensagemChat(event) {
  event.preventDefault();
  const text = chatInput.value.trim();
  if (!text || text.length > 500 || chatSendBusy || onlineGameStatus !== "ativa" ||
      gameMode !== "invite" || !inviteGameId) return;

  const partidaId = inviteGameId;
  chatSendBusy = true;
  chatStatus.textContent = "";
  atualizarDisponibilidadeChat();
  try {
    const response = await fetch(`/xadrez/partidas/${encodeURIComponent(partidaId)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, text })
    });
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Não foi possível enviar a mensagem.");
    if (partidaId !== inviteGameId || gameMode !== "invite") return;
    if (!resultado.mensagem?.id) throw new Error("O servidor não confirmou a mensagem enviada.");
    chatMessages = [...chatMessages.filter(mensagem => mensagem.id !== resultado.mensagem.id), resultado.mensagem]
      .slice(-200);
    chatInitializedForGame = true;
    chatInput.value = "";
    renderizarMensagensChat(true);
  } catch (error) {
    console.error("Não foi possível enviar uma mensagem no chat da partida.", error);
    if (partidaId === inviteGameId) chatStatus.textContent = error.message || "Não foi possível enviar a mensagem.";
  } finally {
    chatSendBusy = false;
    atualizarDisponibilidadeChat();
    if (chatPanel.hidden) chatStatus.textContent = "";
  }
}

async function sincronizarPartidaConvidada() {
  if (gameMode !== "invite" || !inviteGameId || onlineSyncBusy || onlineMoveBusy) return;
  onlineSyncBusy = true;
  try {
    const response = await fetch(`/xadrez/partidas/${encodeURIComponent(inviteGameId)}/${encodeURIComponent(userId)}`);
    const partida = await response.json();
    if (!response.ok) throw new Error(partida.erro || "Não foi possível sincronizar a partida.");
    if (pieceDrag) return;
    const mudouEstado = onlineGameStatus !== partida.status ||
      onlineGameResult !== partida.resultado ||
      playerColor !== partida.cor || onlineOpponent !== (partida.adversario || "oponente");
    const mudouTabuleiro = partida.pgn !== chess.pgn();
    onlineError = "";
    onlineGameStatus = partida.status;
    onlineGameResult = partida.resultado || "*";
    playerColor = partida.cor;
    onlineOpponent = partida.adversario || "oponente";
    let lanceNovo = null;
    if (mudouTabuleiro) {
      const quantidadeLancesAnterior = chess.history().length;
      const jogoAtualizado = new Chess();
      if (partida.pgn) jogoAtualizado.loadPgn(partida.pgn);
      if (jogoAtualizado.fen() !== partida.fen) {
        throw new Error("A partida recebida está inconsistente. Tente atualizar a página.");
      }
      chess = jogoAtualizado;
      selectedSquare = null;
      legalMoves = [];
      saveGame();
      const novosLances = jogoAtualizado.history({ verbose: true });
      lanceNovo = novosLances.length > quantidadeLancesAnterior
        ? novosLances[novosLances.length - 1]
        : null;
    }
    const sincronizadoAntes = onlineSyncedGameId === inviteGameId;
    onlineSyncedGameId = inviteGameId;
    if (sincronizadoAntes && lanceNovo) tocarSomLanceXadrez(lanceNovo);
    if (!mudouEstado && !mudouTabuleiro) return;
    saveGameSettings();
    render(lanceNovo);
  } catch (error) {
    console.error("Não foi possível sincronizar a partida convidada.", error);
    onlineError = error.message || "Não foi possível sincronizar a partida convidada.";
    render();
  } finally {
    onlineSyncBusy = false;
  }
}

function iniciarSincronizacaoConvidada() {
  pararSincronizacaoConvidada();
  pararSincronizacaoChat();
  if (gameMode !== "invite" || !inviteGameId) return;
  void sincronizarPartidaConvidada();
  onlineSyncTimer = window.setInterval(() => void sincronizarPartidaConvidada(), 2000);
  void sincronizarChatPartida();
  chatSyncTimer = window.setInterval(() => void sincronizarChatPartida(), 2500);
}

function checkedKingSquare() {
  if (!chess.isCheck()) return null;
  const position = chess.board();
  const king = position.flat().find(piece => piece?.type === "k" && piece.color === chess.turn());
  if (!king) return null;
  const row = position.findIndex(rank => rank.includes(king));
  const column = position[row].indexOf(king);
  return `${files[column]}${8 - row}`;
}

function renderBoard(lastMove = null) {
  const checkedSquare = checkedKingSquare();
  const position = chess.board();
  const orientacaoPretas = playerColor === "b" && gameMode !== "local";
  const previousSquares = new Map();
  if (lastMove) {
    for (const square of [lastMove.from, lastMove.to]) {
      const element = board.querySelector(`[data-square="${square}"]`);
      if (element) previousSquares.set(square, element.getBoundingClientRect());
    }
    const rank = lastMove.color === "w" ? "1" : "8";
    if (lastMove.flags?.includes("k")) {
      const from = `h${rank}`;
      const to = `f${rank}`;
      const element = board.querySelector(`[data-square="${from}"]`);
      if (element) previousSquares.set(from, element.getBoundingClientRect());
      previousSquares.set(to, { destination: true });
    } else if (lastMove.flags?.includes("q")) {
      const from = `a${rank}`;
      const to = `d${rank}`;
      const element = board.querySelector(`[data-square="${from}"]`);
      if (element) previousSquares.set(from, element.getBoundingClientRect());
      previousSquares.set(to, { destination: true });
    }
  }
  board.replaceChildren();
  board.setAttribute("aria-label", `Tabuleiro de xadrez, visão das ${orientacaoPretas ? "pretas" : "brancas"}`);

  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const positionRow = orientacaoPretas ? 7 - row : row;
      const positionColumn = orientacaoPretas ? 7 - column : column;
      const piece = position[positionRow][positionColumn];
      const square = `${files[positionColumn]}${8 - positionRow}`;
      const button = document.createElement("button");
      const isLight = (row + column) % 2 === 0;
      button.type = "button";
      button.className = `chess-square ${isLight ? "chess-square-light" : "chess-square-dark"}`;
      button.dataset.square = square;
      button.setAttribute("aria-label", piece
        ? `${piece.color === "w" ? "Brancas" : "Pretas"}, ${pieceNames[piece.type]}, ${square}`
        : `Casa ${square}`);
      if (square === selectedSquare) button.classList.add("chess-square-selected");
      if (square === checkedSquare) button.classList.add("chess-square-check");
      if (lastMove && (square === lastMove.from || square === lastMove.to)) {
        button.classList.add("chess-square-last-move");
      }

      const targetMove = legalMoves.find(move => move.to === square);
      if (targetMove) {
        button.classList.add(piece ? "chess-square-capture" : "chess-square-target");
      }

      if (piece) {
        button.classList.add("chess-square-has-piece");
        const symbol = document.createElement("span");
        symbol.className = `chess-piece ${piece.color === "w" ? "chess-piece-white" : "chess-piece-black"}`;
        symbol.textContent = pieceSymbols[piece.color][piece.type];
        symbol.setAttribute("aria-hidden", "true");
        button.appendChild(symbol);
      }
      if (row === 7 || column === 0) {
        const coordinate = document.createElement("span");
        coordinate.className = "chess-square-coordinate";
        coordinate.textContent = row === 7 && column === 0
          ? square
          : row === 7 ? files[positionColumn] : 8 - positionRow;
        coordinate.setAttribute("aria-hidden", "true");
        button.appendChild(coordinate);
      }

      board.appendChild(button);
    }
  }
  if (!lastMove || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const movimentos = [{ from: lastMove.from, to: lastMove.to }];
  const rank = lastMove.color === "w" ? "1" : "8";
  if (lastMove.flags?.includes("k")) movimentos.push({ from: `h${rank}`, to: `f${rank}` });
  if (lastMove.flags?.includes("q")) movimentos.push({ from: `a${rank}`, to: `d${rank}` });
  for (const movimento of movimentos) {
    const origem = previousSquares.get(movimento.from);
    const peca = board.querySelector(`[data-square="${movimento.to}"] .chess-piece`);
    if (!origem || origem.destination || !peca) continue;
    const destino = board.querySelector(`[data-square="${movimento.to}"]`).getBoundingClientRect();
    const deslocamentoX = origem.left + origem.width / 2 - (destino.left + destino.width / 2);
    const deslocamentoY = origem.top + origem.height / 2 - (destino.top + destino.height / 2);
    peca.animate([
      { transform: `translate(${deslocamentoX}px, ${deslocamentoY}px) scale(.86)`, opacity: .7 },
      { transform: "translate(0, 0) scale(1)", opacity: 1 }
    ], { duration: 240, easing: "cubic-bezier(.2,.75,.25,1)" });
  }
}

function renderHistory() {
  const moves = chess.history();
  historyList.replaceChildren();
  historyEmpty.hidden = moves.length > 0;
  for (let index = 0; index < moves.length; index += 2) {
    const item = document.createElement("li");
    const number = document.createElement("span");
    const whiteMove = document.createElement("span");
    const blackMove = document.createElement("span");
    number.className = "chess-history-number";
    whiteMove.className = "chess-history-white";
    blackMove.className = "chess-history-black";
    number.textContent = `${Math.floor(index / 2) + 1}.`;
    whiteMove.textContent = moves[index];
    blackMove.textContent = moves[index + 1] || "";
    item.append(number, whiteMove, blackMove);
    historyList.appendChild(item);
  }
}

function renderCapturedPieces() {
  const capturas = { w: [], b: [] };
  for (const move of chess.history({ verbose: true })) {
    if (move.captured) capturas[move.color].push(move.captured);
  }

  for (const [color, element] of [["w", capturedByWhite], ["b", capturedByBlack]]) {
    const capturasDoJogador = capturas[color];
    const capturadaColor = color === "w" ? "b" : "w";
    element.replaceChildren();
    element.setAttribute("aria-label", capturasDoJogador.length
      ? `${capturasDoJogador.length} peça${capturasDoJogador.length === 1 ? "" : "s"} capturada${capturasDoJogador.length === 1 ? "" : "s"} pelas ${color === "w" ? "brancas" : "pretas"}`
      : `Nenhuma peça capturada pelas ${color === "w" ? "brancas" : "pretas"}`);
    if (!capturasDoJogador.length) continue;

    for (const type of capturasDoJogador) {
      const piece = document.createElement("span");
      piece.className = `chess-captured-piece ${capturadaColor === "w" ? "chess-piece-white" : "chess-piece-black"}`;
      piece.textContent = pieceSymbols[capturadaColor][type];
      piece.setAttribute("aria-hidden", "true");
      element.appendChild(piece);
    }
  }
  const playerColorOnBoard = gameMode === "local" ? "w" : playerColor;
  const capturedByPlayer = playerColorOnBoard === "w" ? capturedRowWhite : capturedRowBlack;
  const capturedByOpponent = playerColorOnBoard === "w" ? capturedRowBlack : capturedRowWhite;
  board.before(capturedByOpponent);
  capturedByPlayer.append(resizeButton);
  board.after(capturedByPlayer);
}

function render(lastMove = null) {
  status.textContent = getGameStatus();
  renderBoard(lastMove);
  renderCapturedPieces();
  renderHistory();
  updateResignButton();
  atualizarDisponibilidadeChat();
  void registrarPartidaLocalFinalizada();
}

async function applyMove(move) {
  if (isGameFinished()) return;
  if (gameMode === "invite") {
    if (onlineMoveBusy || onlineGameStatus !== "ativa" || !isHumanTurn()) return;
    onlineMoveBusy = true;
    onlineError = "";
    let lanceParaAnimar = null;
    render();
    try {
      const response = await fetch(`/xadrez/partidas/${encodeURIComponent(inviteGameId)}/lances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, fen: chess.fen(), ...move })
      });
      const resultado = await response.json();
      if (!response.ok) throw new Error(resultado.erro || "Não foi possível enviar o lance.");
      onlineGameStatus = resultado.status;
      onlineGameResult = resultado.resultado || "*";
      const jogoAtualizado = new Chess();
      if (resultado.pgn) jogoAtualizado.loadPgn(resultado.pgn);
      if (jogoAtualizado.fen() !== resultado.fen) {
        throw new Error("O servidor devolveu um tabuleiro inconsistente.");
      }
      chess = jogoAtualizado;
      selectedSquare = null;
      legalMoves = [];
      pendingPromotion = null;
      saveGame();
      lanceParaAnimar = jogoAtualizado.history({ verbose: true }).at(-1) || null;
      if (lanceParaAnimar) tocarSomLanceXadrez(lanceParaAnimar);
    } catch (error) {
      console.error("Não foi possível enviar o lance da partida convidada.", error);
      onlineError = error.message || "Não foi possível enviar o lance.";
      await sincronizarPartidaConvidada();
    } finally {
      onlineMoveBusy = false;
      render(lanceParaAnimar);
    }
    return;
  }
  const lanceExecutado = chess.move(move);
  selectedSquare = null;
  legalMoves = [];
  pendingPromotion = null;
  tocarSomLanceXadrez(lanceExecutado);
  saveGame();
  render(lanceExecutado);
  requestComputerMove();
}

function moverOuSelecionarCasa(square) {
  if (isGameFinished() || pendingPromotion || !isHumanTurn() || stockfishThinking || onlineMoveBusy) return;
  const piece = chess.get(square);
  if (selectedSquare) {
    const matchingMoves = legalMoves.filter(move => move.to === square);
    if (matchingMoves.length) {
      if (matchingMoves.some(move => move.promotion)) {
        pendingPromotion = { from: selectedSquare, to: square };
        if (typeof promotionDialog.showModal === "function") promotionDialog.showModal();
        else promotionDialog.setAttribute("open", "");
        return;
      }
      applyMove({ from: selectedSquare, to: square });
      return;
    }
  }

  if (piece && piece.color === chess.turn()) {
    selectedSquare = square;
    legalMoves = chess.moves({ square, verbose: true });
  } else {
    selectedSquare = null;
    legalMoves = [];
  }
  renderBoard();
}

function handleSquareClick(square) {
  if (Date.now() < ignoreBoardClickUntil) return;
  if (gameMode === "invite" && onlineGameStatus === "ativa" && !isHumanTurn()) {
    void sincronizarPartidaConvidada();
    return;
  }
  moverOuSelecionarCasa(square);
}

board.addEventListener("click", event => {
  const casa = event.target.closest(".chess-square");
  if (casa) handleSquareClick(casa.dataset.square);
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && gameMode === "invite") void sincronizarPartidaConvidada();
});
window.addEventListener("focus", () => {
  if (gameMode === "invite") void sincronizarPartidaConvidada();
});

function destacarLancesLegais() {
  board.querySelectorAll(".chess-square").forEach(casa => {
    casa.classList.remove("chess-square-selected", "chess-square-target", "chess-square-capture");
    if (casa.dataset.square === selectedSquare) casa.classList.add("chess-square-selected");
    const destino = legalMoves.find(lance => lance.to === casa.dataset.square);
    if (!destino) return;
    casa.classList.add(chess.get(casa.dataset.square) ? "chess-square-capture" : "chess-square-target");
  });
}

function encontrarCasaNoPonto(x, y) {
  return [...board.querySelectorAll(".chess-square")].find(casa => {
    const limites = casa.getBoundingClientRect();
    return x >= limites.left && x < limites.right && y >= limites.top && y < limites.bottom;
  }) || null;
}

board.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0 || isGameFinished() || pendingPromotion ||
      !isHumanTurn() || stockfishThinking || onlineMoveBusy) return;
  const casa = event.target.closest(".chess-square");
  const origem = casa?.dataset.square;
  const peca = origem ? chess.get(origem) : null;
  if (!peca || peca.color !== chess.turn()) return;
  pieceDrag = {
    pointerId: event.pointerId,
    origin: origem,
    startX: event.clientX,
    startY: event.clientY,
    piece: casa.querySelector(".chess-piece"),
    dragged: false
  };
});

board.addEventListener("pointermove", event => {
  if (!pieceDrag || pieceDrag.pointerId !== event.pointerId) return;
  const deltaX = event.clientX - pieceDrag.startX;
  const deltaY = event.clientY - pieceDrag.startY;
  if (!pieceDrag.dragged && Math.hypot(deltaX, deltaY) < 6) return;
  if (!pieceDrag.dragged) {
    pieceDrag.dragged = true;
    board.setPointerCapture(event.pointerId);
    selectedSquare = pieceDrag.origin;
    legalMoves = chess.moves({ square: pieceDrag.origin, verbose: true });
    destacarLancesLegais();
    pieceDrag.piece.classList.add("chess-piece-dragging");
  }
  pieceDrag.piece.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(1.12)`;
  event.preventDefault();
});

function finalizarArrastePeca(event, cancelado = false) {
  if (!pieceDrag || pieceDrag.pointerId !== event.pointerId) return;
  const arraste = pieceDrag;
  const casaSolta = arraste.dragged && !cancelado
    ? encontrarCasaNoPonto(event.clientX, event.clientY)
    : null;
  const destino = casaSolta?.dataset.square;
  pieceDrag = null;
  arraste.piece.classList.remove("chess-piece-dragging");
  arraste.piece.style.transform = "";
  if (board.hasPointerCapture(event.pointerId)) board.releasePointerCapture(event.pointerId);
  if (!arraste.dragged) return;

  ignoreBoardClickUntil = Date.now() + 350;
  if (cancelado) {
    renderBoard();
    return;
  }
  const lances = destino ? legalMoves.filter(lance => lance.to === destino) : [];
  if (!lances.length) {
    renderBoard();
    return;
  }
  if (lances.some(lance => lance.promotion)) {
    pendingPromotion = { from: arraste.origin, to: destino };
    if (typeof promotionDialog.showModal === "function") promotionDialog.showModal();
    else promotionDialog.setAttribute("open", "");
    return;
  }
  applyMove({ from: arraste.origin, to: destino });
}

board.addEventListener("pointerup", event => finalizarArrastePeca(event));
board.addEventListener("pointercancel", event => finalizarArrastePeca(event, true));

document.querySelectorAll("[data-chess-promotion]").forEach(button => {
  button.addEventListener("click", () => {
    if (!pendingPromotion) return;
    const promotion = button.dataset.chessPromotion;
    promotionDialog.close();
    applyMove({ ...pendingPromotion, promotion });
  });
});

promotionDialog.addEventListener("cancel", () => {
  pendingPromotion = null;
  renderBoard();
});

async function enviarConviteXadrez() {
  const email = inviteEmailInput.value.trim();
  if (!inviteEmailInput.checkValidity()) {
    inviteEmailInput.reportValidity();
    return;
  }
  if (!userId) {
    setEngineStatus("Entre na sua conta para convidar um usuário.");
    return;
  }
  newGameButton.disabled = true;
  setEngineStatus("Enviando convite...");
  try {
    const response = await fetch(`/xadrez/convites/${encodeURIComponent(userId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const resultado = await response.json();
    if (!response.ok && !(response.status === 409 && resultado.partidaId && resultado.status === "aguardando")) {
      throw new Error(resultado.erro || "Não foi possível enviar o convite.");
    }
    cancelarSalvamentoPartidaLocal();
    pararSincronizacaoConvidada();
    stopStockfish();
    gameMode = "invite";
    playerColor = "w";
    inviteGameId = resultado.partidaId;
    inviteEmail = email;
    onlineGameStatus = resultado.status;
    onlineGameResult = "*";
    onlineOpponent = email;
    onlineError = "";
    chess.reset();
    selectedSquare = null;
    legalMoves = [];
    pendingPromotion = null;
    if (promotionDialog.open) promotionDialog.close();
    saveGameSettings();
    saveGame();
    syncGameSettings();
    setEngineStatus("");
    render();
    iniciarSincronizacaoConvidada();
    if (settingsDialog.open) settingsDialog.close();
  } catch (error) {
    console.error("Não foi possível enviar o convite de xadrez.", error);
    setEngineStatus(error.message || "Não foi possível enviar o convite.");
  } finally {
    newGameButton.disabled = false;
  }
}

newGameButton.addEventListener("click", async () => {
  if ((chess.history().length || inviteGameId) &&
      !window.confirm("Iniciar outra partida neste dispositivo? A partida online atual continuará para o outro usuário.")) return;
  if (gameModeSelect.value === "invite") {
    await enviarConviteXadrez();
    return;
  }

  const replaceOnlineState = gameMode === "invite";
  pararSincronizacaoConvidada();
  gameMode = gameModeSelect.value;
  playerColor = playerColorSelect.value;
  localGameId = crypto.randomUUID();
  skillLevel = Number(skillLevelInput.value);
  inviteGameId = "";
  inviteEmail = "";
  onlineGameStatus = "";
  onlineGameResult = "*";
  onlineOpponent = "";
  onlineError = "";
  onlineMoveBusy = false;
  stockfishError = "";
  setEngineStatus("");
  stopStockfish();
  chess.reset();
  selectedSquare = null;
  legalMoves = [];
  pendingPromotion = null;
  if (promotionDialog.open) promotionDialog.close();
  saveGameSettings();
  saveGame({ replaceOnlineState });
  render();
  if (settingsDialog.open) settingsDialog.close();
  if (gameMode === "stockfish") requestComputerMove();
});

async function desistirDaPartida() {
  if (isGameFinished() || (gameMode === "invite" && onlineGameStatus !== "ativa")) return;
  const resignedColor = gameMode === "local" ? chess.turn() : playerColor;
  const winner = resignedColor === "w" ? "pretas" : "brancas";
  const confirmation = gameMode === "invite"
    ? "Desistir da partida? Seu oponente vencerá."
    : gameMode === "stockfish"
      ? "Desistir da partida? O Stockfish vencerá."
      : `Desistir da partida? As ${winner} vencerão.`;
  if (!window.confirm(confirmation)) return;

  const result = resignedColor === "w" ? "0-1" : "1-0";
  if (gameMode === "invite") {
    resignationBusy = true;
    onlineError = "";
    render();
    try {
      const response = await fetch(`/xadrez/partidas/${encodeURIComponent(inviteGameId)}/desistir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId })
      });
      const resultado = await response.json();
      if (!response.ok) throw new Error(resultado.erro || "Não foi possível desistir da partida.");
      const jogoAtualizado = new Chess();
      if (resultado.pgn) jogoAtualizado.loadPgn(resultado.pgn);
      if (jogoAtualizado.fen() !== resultado.fen) {
        throw new Error("O servidor devolveu um tabuleiro inconsistente.");
      }
      chess = jogoAtualizado;
      onlineGameStatus = resultado.status;
      onlineGameResult = resultado.resultado;
      selectedSquare = null;
      legalMoves = [];
      pendingPromotion = null;
      saveGame();
    } catch (error) {
      console.error("Não foi possível desistir da partida convidada.", error);
      onlineError = error.message || "Não foi possível desistir da partida.";
    } finally {
      resignationBusy = false;
      render();
    }
    return;
  }

  stopStockfish();
  selectedSquare = null;
  legalMoves = [];
  pendingPromotion = null;
  if (promotionDialog.open) promotionDialog.close();
  chess.setHeader("Result", result);
  chess.setHeader("Termination", "resignation");
  saveGame();
  render();
}

resignButton.addEventListener("click", () => void desistirDaPartida());

function syncGameSettings() {
  gameModeSelect.value = gameMode;
  playerColorSelect.value = playerColor;
  skillLevelInput.value = String(skillLevel);
  skillValue.value = String(skillLevel);
  opponentOptions.hidden = gameModeSelect.value !== "stockfish";
  inviteOptions.hidden = gameModeSelect.value !== "invite";
  inviteEmailInput.value = inviteEmail;
  newGameLabel.textContent = gameModeSelect.value === "invite" ? "Enviar convite" : "Iniciar nova partida";
}

settingsOpenButton.addEventListener("click", () => {
  syncGameSettings();
  if (typeof settingsDialog.showModal === "function") settingsDialog.showModal();
  else settingsDialog.setAttribute("open", "");
});

matchHistoryOpenButton.addEventListener("click", async () => {
  await registrarPartidaLocalFinalizada();
  settingsDialog.close();
  if (typeof matchHistoryDialog.showModal === "function") matchHistoryDialog.showModal();
  else matchHistoryDialog.setAttribute("open", "");
  void carregarHistoricoPartidas();
});
document.getElementById("chessMatchHistoryClose").addEventListener("click", () => matchHistoryDialog.close());
matchHistoryDialog.addEventListener("click", event => {
  if (event.target === matchHistoryDialog) matchHistoryDialog.close();
});

chatOpenButton.addEventListener("click", () => {
  if (chatPanel.hidden) abrirChatPartida();
  else fecharChatPartida();
});
chatCloseButton.addEventListener("click", fecharChatPartida);
chatForm.addEventListener("submit", event => void enviarMensagemChat(event));
chatPanel.addEventListener("keydown", event => {
  if (event.key === "Escape") fecharChatPartida();
});

document.getElementById("chessSettingsClose").addEventListener("click", () => settingsDialog.close());
settingsDialog.addEventListener("click", event => {
  if (event.target === settingsDialog) settingsDialog.close();
});
gameModeSelect.addEventListener("change", () => {
  opponentOptions.hidden = gameModeSelect.value !== "stockfish";
  inviteOptions.hidden = gameModeSelect.value !== "invite";
  newGameLabel.textContent = gameModeSelect.value === "invite" ? "Enviar convite" : "Iniciar nova partida";
});
skillLevelInput.addEventListener("input", () => {
  skillValue.value = skillLevelInput.value;
});

document.addEventListener("chess-invitation-accepted", event => {
  const partida = event.detail;
  if (!partida?.partidaId) return;
  cancelarSalvamentoPartidaLocal();
  pararSincronizacaoConvidada();
  stopStockfish();
  gameMode = "invite";
  playerColor = partida.cor || "b";
  inviteGameId = partida.partidaId;
  inviteEmail = "";
  onlineGameStatus = partida.status || "ativa";
  onlineGameResult = partida.resultado || "*";
  onlineOpponent = partida.adversario || "oponente";
  onlineError = "";
  chess.reset();
  selectedSquare = null;
  legalMoves = [];
  pendingPromotion = null;
  saveGameSettings();
  saveGame();
  syncGameSettings();
  saveGameSettings();
  render();
  const chessWidgetToggle = document.getElementById("widgetXadrezAtivo");
  if (chessWidgetToggle && !chessWidgetToggle.checked) {
    chessWidgetToggle.checked = true;
    chessWidgetToggle.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    widget.hidden = false;
  }
  iniciarSincronizacaoConvidada();
  widget.scrollIntoView({ behavior: "smooth", block: "center" });
});

moveNotificationsInput.checked = window.orbyChessMoveNotifications !== false;
moveNotificationsInput.addEventListener("change", () => {
  document.dispatchEvent(new CustomEvent("chess-move-notifications-changed", {
    detail: { enabled: moveNotificationsInput.checked }
  }));
});
document.addEventListener("orby-chess-preferences-loaded", event => {
  moveNotificationsInput.checked = event.detail?.moveNotifications !== false;
  aplicarTemaTabuleiro(event.detail?.boardTheme || "verde");
});
boardThemeSelect.value = chessBoardTheme;
aplicarTemaTabuleiro(chessBoardTheme);
boardThemeSelect.addEventListener("change", () => {
  aplicarTemaTabuleiro(boardThemeSelect.value);
  document.dispatchEvent(new CustomEvent("chess-board-theme-changed", {
    detail: { theme: chessBoardTheme }
  }));
});

resizeButton.addEventListener("pointerdown", event => {
  if (event.button !== 0 || !event.isPrimary) return;
  resizePointer = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: widgetCard.getBoundingClientRect().width
  };
  resizeButton.setPointerCapture(event.pointerId);
  event.preventDefault();
});

resizeButton.addEventListener("pointermove", event => {
  if (!resizePointer || resizePointer.pointerId !== event.pointerId) return;
  ajustarLarguraWidget(resizePointer.startWidth + event.clientX - resizePointer.startX);
  event.preventDefault();
});

function finalizarRedimensionamento(event) {
  if (!resizePointer || resizePointer.pointerId !== event.pointerId) return;
  resizePointer = null;
  salvarLarguraWidget();
  if (resizeButton.hasPointerCapture(event.pointerId)) {
    resizeButton.releasePointerCapture(event.pointerId);
  }
}

resizeButton.addEventListener("pointerup", finalizarRedimensionamento);
resizeButton.addEventListener("pointercancel", finalizarRedimensionamento);
resizeButton.addEventListener("keydown", event => {
  const passos = { ArrowLeft: -24, ArrowDown: -24, ArrowRight: 24, ArrowUp: 24 };
  if (!(event.key in passos)) return;
  event.preventDefault();
  ajustarLarguraWidget(widgetCard.getBoundingClientRect().width + passos[event.key]);
  salvarLarguraWidget();
});

window.addEventListener("resize", () => {
  ajustarLarguraWidget(widgetCard.getBoundingClientRect().width);
});

ajustarLarguraWidget(widgetCard.getBoundingClientRect().width);
status.textContent = "Carregando partida...";

async function carregarPartidaAtual() {
  let erroCarregamento = "";
  if (userId) {
    try {
      const response = await fetch(`/xadrez/usuarios/${encodeURIComponent(userId)}/partida-atual`);
      const atual = await response.json();
      if (!response.ok) throw new Error(atual.erro || "Não foi possível carregar a partida da conta.");

      if (atual.mode === "invite" && atual.gameId) {
        gameMode = "invite";
        inviteGameId = atual.gameId;
        onlineGameStatus = "";
        onlineOpponent = "";
        onlineError = "";
      } else if (["local", "stockfish"].includes(atual.mode) && atual.partida) {
        const partida = atual.partida;
        const jogoDaConta = new Chess();
        if (partida.pgn) jogoDaConta.loadPgn(partida.pgn);
        if (jogoDaConta.fen() !== partida.fen) {
          throw new Error("A partida salva na conta está inconsistente.");
        }
        const pgnLocal = localStorage.getItem(storageKey);
        if (gameMode === partida.mode && pgnLocal && localGamePgnUpdatedAt > Number(partida.updatedAt || 0)) {
          const jogoLocal = new Chess();
          jogoLocal.loadPgn(pgnLocal);
          chess = jogoLocal;
        } else {
          chess = jogoDaConta;
        }
        gameMode = partida.mode;
        if (["w", "b"].includes(partida.playerColor)) playerColor = partida.playerColor;
        if (Number.isInteger(partida.skillLevel) && partida.skillLevel >= 1 && partida.skillLevel <= 20) {
          skillLevel = partida.skillLevel;
        }
        localGameUpdatedAt = Number(partida.updatedAt) || 0;
        inviteGameId = "";
        inviteEmail = "";
        onlineGameStatus = "";
        onlineOpponent = "";
      } else if (atual.mode === "none") {
        if (gameMode === "invite") {
          gameMode = "local";
          inviteGameId = "";
          inviteEmail = "";
          onlineGameStatus = "";
          onlineOpponent = "";
          chess.reset();
        }
      }
    } catch (error) {
      console.error("Não foi possível carregar a partida de xadrez da conta.", error);
      erroCarregamento = error.message || "Não foi possível carregar a partida da conta.";
    }
  }

  syncGameSettings();
  render();
  if (gameMode === "invite" && inviteGameId) {
    iniciarSincronizacaoConvidada();
  } else {
    saveGame();
    if (gameMode === "stockfish") requestComputerMove();
  }
  if (erroCarregamento) {
    document.getElementById("chessStorageStatus").textContent = erroCarregamento;
  }
}

void carregarPartidaAtual();
