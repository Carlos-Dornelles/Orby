import { Chess } from "/vendor/chess.js/chess.js";

const storageKey = "orby-chess-pgn-v1";
const gameSettingsStorageKey = "orby-chess-game-settings-v1";
const localGamePgnUpdatedAtStorageKey = "orby-chess-pgn-updated-at-v1";
let chess = new Chess();
const board = document.getElementById("chessBoard");
const status = document.getElementById("chessStatus");
const chessRatingValue = document.getElementById("chessRatingValue");
const chessRankingList = document.getElementById("chessRankingList");
const chessRankingStatus = document.getElementById("chessRankingStatus");
const capturedByWhite = document.getElementById("chessCapturedByWhite");
const capturedByBlack = document.getElementById("chessCapturedByBlack");
const capturedRowWhite = document.getElementById("chessCapturedRowWhite");
const capturedRowBlack = document.getElementById("chessCapturedRowBlack");
const historyList = document.getElementById("chessHistory");
const historyEmpty = document.getElementById("chessHistoryEmpty");
const promotionDialog = document.getElementById("chessPromotionDialog");
const settingsDialog = document.getElementById("chessSettingsDialog");
const rankingDialog = document.getElementById("chessRankingDialog");
const matchHistoryDialog = document.getElementById("chessMatchHistoryDialog");
const matchHistoryList = document.getElementById("chessMatchHistoryList");
const matchHistoryStatus = document.getElementById("chessMatchHistoryStatus");
const matchHistoryPeriodFilter = document.getElementById("chessHistoryPeriodFilter");
const matchHistoryResultFilter = document.getElementById("chessHistoryResultFilter");
const settingsOpenButton = document.getElementById("chessSettingsOpen");
const matchHistoryOpenButton = document.getElementById("chessMatchHistoryOpen");
const rankingOpenButton = document.getElementById("chessRankingOpen");
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
const skillRating = document.getElementById("chessSkillRating");
const stockfishRatingOptions = document.getElementById("chessStockfishRatingOptions");
const stockfishRatingModeSelect = document.getElementById("chessStockfishRatingMode");
const opponentOptions = document.getElementById("chessOpponentOptions");
const inviteOptions = document.getElementById("chessInviteOptions");
const inviteNameInput = document.getElementById("chessInviteName");
const inviteSuggestions = document.getElementById("chessInviteSuggestions");
const inviteSearchStatus = document.getElementById("chessInviteSearchStatus");
const inviteRatingModeInput = document.getElementById("chessInviteRatingMode");
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
const chessBoardThemes = ["classico", "verde", "madeira", "aero", "vermelho"];
let chessBoardTheme = chessBoardThemes.includes(window.orbyChessBoardTheme)
  ? window.orbyChessBoardTheme
  : "verde";
let resizePointer = null;
let pieceDrag = null;
let ignoreBoardClickUntil = 0;
const pieceSymbols = {
  w: { k: "\u2654", q: "\u2655", r: "\u2656", b: "\u2657", n: "\u2658", p: "\u2659" },
  b: { k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F" }
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
let stockfishRated = false;
let inviteGameId = "";
let localGameId = "";
let inviteUserId = "";
let inviteUserName = "";
let inviteSearchTimer = null;
let inviteSearchController = null;
let onlineGameStatus = "";
let onlineGameResult = "*";
let onlineOpponent = "";
let onlineRated = false;
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
let localGameSaveConflict = false;
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
  stockfishRated = savedSettings.stockfishRated === true;
  if (typeof savedSettings.gameId === "string") inviteGameId = savedSettings.gameId;
  if (typeof savedSettings.localGameId === "string") localGameId = savedSettings.localGameId;
  if (typeof savedSettings.inviteUserId === "string") inviteUserId = savedSettings.inviteUserId;
  if (typeof savedSettings.inviteUserName === "string") inviteUserName = savedSettings.inviteUserName;
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
    if (!localGameSaveConflict) document.getElementById("chessStorageStatus").textContent = "";
  } catch (error) {
    console.warn("Não foi possível salvar a partida de xadrez neste dispositivo.", error);
    document.getElementById("chessStorageStatus").textContent =
      "Não foi possível salvar a partida neste dispositivo.";
  }
  if (gameMode !== "invite" && userId) agendarSalvamentoPartidaLocal(replaceOnlineState);
}

function agendarSalvamentoPartidaLocal(replaceOnlineState = false) {
  if (localGameSaveConflict) return;
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
  if (localGameSaveConflict) {
    localGameSavePending = false;
    localGameReplaceOnlineStatePending = false;
    return;
  }
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
          gameId: localGameId,
          mode: gameMode,
          playerColor,
          skillLevel,
          rated: gameMode === "stockfish" && stockfishRated && skillLevel >= 8,
          pgn: chess.pgn(),
          updatedAt,
          replaceOnlineState
        })
      });
      const resultado = await response.json();
      if (response.status === 409) {
        localGameSaveConflict = true;
        localGameSavePending = false;
        localGameReplaceOnlineStatePending = false;
        if (localGameSaveTimer) window.clearTimeout(localGameSaveTimer);
        localGameSaveTimer = null;
        document.getElementById("chessStorageStatus").textContent =
          "O servidor tem um estado de xadrez mais recente. Recarregue para sincronizar; sua partida continua salva neste dispositivo.";
        break;
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
      stockfishRated,
      gameId: inviteGameId,
      localGameId,
      inviteUserId,
      inviteUserName
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

  const ratingValendo = gameMode === "stockfish" && stockfishRated && skillLevel >= 8;
  if (ratingValendo) {
    if (localGameSaveTimer) window.clearTimeout(localGameSaveTimer);
    localGameSaveTimer = null;
    localGameSavePending = true;
    while (localGameSavePending || localGameSaveBusy) {
      if (!localGameSaveBusy) await salvarPartidaLocalNoServidor();
      else await new Promise(resolve => window.setTimeout(resolve, 25));
    }
  }

  const partida = {
    gameId: localGameId,
    mode: gameMode,
    skillLevel,
    rated: ratingValendo,
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
    if (partida.rated) {
      void carregarRatingXadrez();
      void carregarRankingXadrez();
    }
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

async function carregarRatingXadrez() {
  if (!userId || !chessRatingValue) return;
  try {
    const response = await fetch(`/xadrez/usuarios/${encodeURIComponent(userId)}/rating`);
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Não foi possível carregar o rating.");
    chessRatingValue.textContent = String(resultado.rating ?? 300);
  } catch (error) {
    console.error("Não foi possível carregar o rating de xadrez.", error);
  }
}

async function carregarRankingXadrez() {
  if (!chessRankingList || !chessRankingStatus) return;
  chessRankingStatus.textContent = "Carregando ranking...";
  try {
    const response = await fetch("/xadrez/ranking");
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Não foi possível carregar o ranking.");
    chessRankingList.replaceChildren();
    for (const jogador of resultado.jogadores || []) {
      const item = document.createElement("li");
      item.className = "chess-ranking-player";
      if (jogador.userId === userId) item.classList.add("is-current-user");
      const nome = document.createElement("span");
      nome.textContent = `${jogador.posicao}. ${jogador.nome}`;
      const rating = document.createElement("strong");
      rating.textContent = String(jogador.rating);
      item.append(nome, rating);
      chessRankingList.appendChild(item);
    }
    chessRankingStatus.textContent = resultado.jogadores?.length
      ? "Maiores ratings de xadrez"
      : "O ranking aparece após a primeira partida por convite concluída.";
  } catch (error) {
    console.error("Não foi possível carregar o ranking de xadrez.", error);
    chessRankingStatus.textContent = error.message || "Não foi possível carregar o ranking.";
  }
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
      item.className = "chess-match-history-item";
      const dataHistorico = new Date(partida.playedAt);
      item.dataset.playedAt = Number.isFinite(dataHistorico.getTime()) ? dataHistorico.toISOString() : "";
      item.dataset.outcome = partida.playerColor === "both" ? "other"
        : partida.resultado === "1/2-1/2" ? "draw"
          : ((partida.playerColor === "w" && partida.resultado === "1-0") ||
            (partida.playerColor === "b" && partida.resultado === "0-1")) ? "won" : "lost";

      const row = document.createElement("div");
      row.className = "chess-match-history-row";

      const principal = document.createElement("div");
      principal.className = "chess-match-history-main";
      const nome = document.createElement("strong");
      const detalhes = document.createElement("span");
      const cor = partida.playerColor === "w" ? "Brancas"
        : partida.playerColor === "b" ? "Pretas" : "Brancas e pretas";
      const peao = partida.playerColor === "w" ? "\u2659"
        : partida.playerColor === "b" ? "\u265F" : "\u2659\u265F";
      nome.textContent = partida.opponent || "Adversário desconhecido";
      detalhes.innerHTML = `<span class="chess-match-pawn-indicator chess-pawn-${partida.playerColor}">${peao}</span><span>${cor} · ${partida.moveCount} ${partida.moveCount === 1 ? "lance" : "lances"}</span>`;
      principal.append(nome, detalhes);

      const resultadoPartida = document.createElement("span");
      const rotulo = rotuloResultadoHistorico(partida);
      resultadoPartida.textContent = rotulo;
      const rotuloLower = rotulo.toLowerCase();
      if (rotuloLower.includes("vitória") || rotuloLower.includes("venceu")) {
        resultadoPartida.className = "chess-match-history-result result-win";
      } else if (rotuloLower.includes("derrota") || rotuloLower.includes("perdeu")) {
        resultadoPartida.className = "chess-match-history-result result-loss";
      } else {
        resultadoPartida.className = "chess-match-history-result result-draw";
      }
      row.append(principal, resultadoPartida);
      if (partida.rated && Number.isFinite(partida.ratingDelta)) {
        const ratingDelta = document.createElement("span");
        ratingDelta.className = `chess-match-rating-delta ${partida.ratingDelta > 0 ? "rating-gain" : partida.ratingDelta < 0 ? "rating-loss" : "rating-neutral"}`;
        ratingDelta.textContent = `${partida.ratingDelta > 0 ? "+" : ""}${partida.ratingDelta} rating`;
        ratingDelta.title = partida.ratingDelta > 0 ? "Rating ganho nesta partida"
          : partida.ratingDelta < 0 ? "Rating perdido nesta partida" : "Rating sem alteração nesta partida";
        row.appendChild(ratingDelta);
      } else if (["invite", "stockfish"].includes(partida.mode) && !partida.rated) {
        const semRating = document.createElement("span");
        semRating.className = "chess-match-rating-delta rating-neutral";
        semRating.textContent = "Sem rating";
        row.appendChild(semRating);
      }

      const movesBox = document.createElement("div");
      movesBox.className = "chess-match-history-moves";
      if (Array.isArray(partida.moves) && partida.moves.length) {
        let pgnFormatted = "";
        for (let i = 0; i < partida.moves.length; i += 2) {
          pgnFormatted += `${Math.floor(i / 2) + 1}. ${partida.moves[i]} ${partida.moves[i + 1] || ""}  `;
        }
        movesBox.textContent = pgnFormatted.trim();
      } else if (partida.pgn) {
        movesBox.textContent = partida.pgn;
      } else {
        movesBox.textContent = "Lances não gravados para esta partida.";
      }

      const actions = document.createElement("div");
      actions.className = "chess-match-history-actions";

      const data = document.createElement("time");
      const dataPartida = new Date(partida.playedAt);
      if (Number.isFinite(dataPartida.getTime())) {
        data.dateTime = dataPartida.toISOString();
        data.textContent = dataPartida.toLocaleString();
      }

      const analyzeBtn = document.createElement("button");
      analyzeBtn.type = "button";
      analyzeBtn.className = "chess-match-history-btn-analyze";
      analyzeBtn.innerHTML = '<i class="bi bi-graph-up-arrow" aria-hidden="true"></i><span>Analisar partida</span><i class="bi bi-check-circle-fill chess-match-analysis-done" aria-hidden="true"></i>';
      const analysisDone = Array.isArray(partida.analise?.moves) && partida.analise.moves.length > 0;
      analyzeBtn.classList.toggle("analysis-complete", analysisDone);
      analyzeBtn.querySelector(".chess-match-analysis-done").hidden = !analysisDone;
      analyzeBtn.title = analysisDone ? "Análise já realizada" : "Analisar partida";
      analyzeBtn.setAttribute("aria-label", analysisDone
        ? "Análise já realizada. Abrir análise da partida"
        : "Analisar partida");
      analyzeBtn.addEventListener("click", () => {
        matchHistoryDialog.close();
        const opponentName = partida.opponent || (partida.mode === "stockfish" ? "Stockfish" : "Adversário");
        iniciarAnalisePartida(partida.pgn, {
          gameId: partida.gameId,
          whiteName: partida.playerColor === "b" ? opponentName
            : partida.playerColor === "both" ? "Jogador local (brancas)" : "Você",
          blackName: partida.playerColor === "b" ? "Você"
            : partida.playerColor === "both" ? "Jogador local (pretas)" : opponentName,
          playerColor: partida.playerColor,
          analise: partida.analise,
          analysisButton: analyzeBtn
        });
      });

      actions.append(data, analyzeBtn);
      item.append(row, movesBox, actions);
      matchHistoryList.appendChild(item);
    }
    aplicarFiltrosHistoricoPartidas();
  } catch (error) {
    console.error("Não foi possível carregar o histórico de partidas de xadrez.", error);
    matchHistoryStatus.textContent = error.message || "Não foi possível carregar o histórico.";
  }
}

function aplicarFiltrosHistoricoPartidas() {
  const periodo = matchHistoryPeriodFilter.value;
  const resultado = matchHistoryResultFilter.value;
  const agora = new Date();
  let visiveis = 0;
  for (const item of matchHistoryList.children) {
    const data = new Date(item.dataset.playedAt);
    const dataValida = Number.isFinite(data.getTime());
    const combinaData = dataValida && (
      periodo === "today"
        ? data.getFullYear() === agora.getFullYear() && data.getMonth() === agora.getMonth() && data.getDate() === agora.getDate()
        : periodo === "month"
          ? data.getFullYear() === agora.getFullYear() && data.getMonth() === agora.getMonth()
          : periodo === "year" && data.getFullYear() === agora.getFullYear()
    );
    const combinaResultado = resultado === "all" || item.dataset.outcome === resultado;
    item.hidden = !(combinaData && combinaResultado);
    if (!item.hidden) visiveis += 1;
  }
  matchHistoryStatus.textContent = visiveis
    ? `${visiveis} ${visiveis === 1 ? "partida exibida" : "partidas exibidas"}.`
    : "Nenhuma partida corresponde aos filtros selecionados.";
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
  document.getElementById("chessAnalysisBoard").dataset.theme = tema;
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
    stockfishWorker.postMessage(`setoption name Skill Level value ${getStockfishLevelConfig().engineSkill}`);
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
  let move = chess.moves({ verbose: true }).find(candidate =>
    candidate.from === match[1] && candidate.to === match[2] &&
    (candidate.promotion || undefined) === (match[3] || undefined)
  );
  if (!move) {
    failStockfish(new Error(`O motor sugeriu um lance ilegal: ${line}`));
    return;
  }
  const levelConfig = getStockfishLevelConfig();
  const legalMoves = chess.moves({ verbose: true });
  if (!chess.isCheck() && legalMoves.length > 1 && Math.random() < levelConfig.randomMoveChance) {
    move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }
  applyMove({ from: move.from, to: move.to, promotion: move.promotion });
}

function getStockfishLevelConfig(level = skillLevel) {
  const normalizedLevel = Math.max(1, Math.min(20, Number(level) || 1));
  return {
    engineSkill: Math.round((normalizedLevel - 1) * 20 / 19),
    depth: Math.round(2 + (normalizedLevel - 1) * 0.5),
    rating: 300 + (normalizedLevel - 1) * 100,
    randomMoveChance: Math.max(0, 0.55 * (13 - normalizedLevel) / 12)
  };
}

function atualizarRatingEstimado() {
  if (!skillRating) return;
  const rating = getStockfishLevelConfig(skillLevelInput.value).rating;
  skillRating.textContent = `Rating estimado: ${rating.toLocaleString("pt-BR")}`;
}

function atualizarDisponibilidadeRatingStockfish() {
  const disponivel = Number(skillLevelInput.value) >= 8;
  stockfishRatingOptions.hidden = !disponivel;
  if (!disponivel) stockfishRatingModeSelect.value = "unrated";
  stockfishRated = disponivel && stockfishRatingModeSelect.value === "rated";
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
  setEngineStatus(`Stockfish pensando \u2014 nível ${skillLevel}...`);
  stockfishWorker.postMessage(`position fen ${stockfishSearchFen}`);
  stockfishWorker.postMessage(`go depth ${getStockfishLevelConfig().depth}`);
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
      return `Convite enviado para ${inviteUserName || onlineOpponent}. Aguardando resposta.`;
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
    return `🏆 Xeque-mate! As ${chess.turn() === "w" ? "pretas" : "brancas"} venceram.`;
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
      onlineRated !== (partida.rated === true) ||
      playerColor !== partida.cor || onlineOpponent !== (partida.adversario || "oponente");
    const novoResultadoRated = onlineGameStatus !== "finalizada" &&
      partida.status === "finalizada" && partida.rated === true;
    const mudouTabuleiro = partida.pgn !== chess.pgn();
    onlineError = "";
    onlineGameStatus = partida.status;
    onlineGameResult = partida.resultado || "*";
    onlineRated = partida.rated === true;
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
    if (novoResultadoRated) {
      void carregarRatingXadrez();
      void carregarRankingXadrez();
    }
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
  historyList.scrollTop = historyList.scrollHeight;
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
  if (gameMode === "invite") status.textContent += onlineRated ? " · valendo rating" : " · sem rating";
  if (gameMode === "stockfish") status.textContent += stockfishRated ? " · valendo rating" : " · sem rating";
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
      onlineRated = resultado.rated === true;
      if (onlineGameStatus === "finalizada" && onlineRated) {
        void carregarRatingXadrez();
        void carregarRankingXadrez();
      }
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
  if (!inviteUserId) {
    inviteSearchStatus.textContent = "Escolha uma pessoa na lista de sugestões.";
    return;
  }
  if (!userId) {
    setEngineStatus("Entre na sua conta para convidar um usuário.");
    return;
  }
  if (!await encerrarPartidaAnteriorParaNova()) return;
  newGameButton.disabled = true;
  setEngineStatus("Enviando convite...");
  try {
    const response = await fetch(`/xadrez/convites/${encodeURIComponent(userId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ convidadoId: inviteUserId, rated: inviteRatingModeInput.value === "rated" })
    });
    const resultado = await response.json();
    if (!response.ok && !(response.status === 409 && resultado.partidaId && resultado.status === "aguardando")) {
      throw new Error(resultado.erro || "Não foi possível enviar o convite.");
    }
    cancelarSalvamentoPartidaLocal();
    pararSincronizacaoConvidada();
    stopStockfish();
    gameMode = "invite";
    playerColor = resultado.cor || "w";
    inviteGameId = resultado.partidaId;
    inviteUserName = inviteNameInput.value.trim();
    onlineGameStatus = resultado.status;
    onlineGameResult = "*";
    onlineRated = resultado.rated === true;
    onlineOpponent = inviteUserName;
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

async function encerrarPartidaAnteriorParaNova() {
  if (isGameFinished() || (!chess.history().length && !inviteGameId)) return true;

  if (gameMode === "invite") {
    if (onlineGameStatus !== "ativa") return true;
    resignationBusy = true;
    try {
      const response = await fetch(`/xadrez/partidas/${encodeURIComponent(inviteGameId)}/desistir`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId })
      });
      const resultado = await response.json();
      if (!response.ok) throw new Error(resultado.erro || "N\u00e3o foi poss\u00edvel encerrar a partida atual.");
      pararSincronizacaoConvidada();
      onlineGameStatus = resultado.status;
      onlineGameResult = resultado.resultado;
      onlineRated = resultado.rated === true;
      if (onlineRated) {
        void carregarRatingXadrez();
        void carregarRankingXadrez();
      }
      return true;
    } catch (error) {
      onlineError = error.message || "N\u00e3o foi poss\u00edvel encerrar a partida atual.";
      render();
      return false;
    } finally {
      resignationBusy = false;
    }
  }

  const resignedColor = gameMode === "local" ? chess.turn() : playerColor;
  chess.setHeader("Result", resignedColor === "w" ? "0-1" : "1-0");
  chess.setHeader("Termination", "resignation");
  stopStockfish();
  saveGame();
  if (userId) {
    if (localGameSaveTimer) window.clearTimeout(localGameSaveTimer);
    localGameSaveTimer = null;
    localGameSavePending = true;
    while (localGameSavePending || localGameSaveBusy) {
      if (!localGameSaveBusy) await salvarPartidaLocalNoServidor();
      else await new Promise(resolve => window.setTimeout(resolve, 25));
    }
  }
  await registrarPartidaLocalFinalizada();
  return true;
}

function fecharSugestoesConvite() {
  inviteSuggestions.replaceChildren();
  inviteSuggestions.hidden = true;
  inviteNameInput.setAttribute("aria-expanded", "false");
}

function escolherUsuarioConvite(usuario) {
  inviteUserId = usuario.id;
  inviteUserName = usuario.nome;
  inviteNameInput.value = usuario.nome;
  inviteSearchStatus.textContent = `Convite será enviado para ${usuario.nome}.`;
  fecharSugestoesConvite();
}

async function buscarUsuariosConvite(nome, signal) {
  try {
    const url = `/xadrez/usuarios/${encodeURIComponent(userId)}/buscar?nome=${encodeURIComponent(nome)}`;
    const response = await fetch(url, { signal });
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Não foi possível buscar pessoas.");
    if (signal.aborted || inviteNameInput.value.trim() !== nome) return;
    inviteSuggestions.replaceChildren();
    const usuarios = Array.isArray(resultado.usuarios) ? resultado.usuarios : [];
    for (const usuario of usuarios) {
      const opcao = document.createElement("button");
      opcao.type = "button";
      opcao.className = "chess-invite-suggestion";
      opcao.setAttribute("role", "option");
      opcao.textContent = usuario.nome;
      opcao.addEventListener("click", () => escolherUsuarioConvite(usuario));
      inviteSuggestions.appendChild(opcao);
    }
    inviteSuggestions.hidden = usuarios.length === 0;
    inviteNameInput.setAttribute("aria-expanded", String(usuarios.length > 0));
    inviteSearchStatus.textContent = usuarios.length ? `${usuarios.length} pessoa(s) encontrada(s).` : "Nenhuma pessoa encontrada com esse nome.";
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error("Não foi possível buscar usuários para o convite de xadrez.", error);
    inviteSearchStatus.textContent = error.message || "Não foi possível buscar pessoas.";
    fecharSugestoesConvite();
  }
}

inviteNameInput.addEventListener("input", () => {
  inviteUserId = "";
  inviteUserName = "";
  if (inviteSearchTimer) window.clearTimeout(inviteSearchTimer);
  inviteSearchController?.abort();
  fecharSugestoesConvite();
  const nome = inviteNameInput.value.trim();
  inviteSearchStatus.textContent = nome.length < 2 ? "Digite pelo menos 2 letras para buscar." : "Buscando pessoas...";
  if (nome.length < 2 || !userId) return;
  inviteSearchTimer = window.setTimeout(() => {
    inviteSearchController = new AbortController();
    void buscarUsuariosConvite(nome, inviteSearchController.signal);
  }, 250);
});

inviteNameInput.addEventListener("keydown", event => {
  if (event.key === "Escape") fecharSugestoesConvite();
  if (event.key === "ArrowDown") inviteSuggestions.querySelector("button")?.focus();
});

inviteSuggestions.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    fecharSugestoesConvite();
    inviteNameInput.focus();
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    event.target.nextElementSibling?.focus();
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (event.target.previousElementSibling) event.target.previousElementSibling.focus();
    else inviteNameInput.focus();
  }
});

newGameButton.addEventListener("click", async () => {
  if ((chess.history().length || inviteGameId) &&
      !await window.orbyConfirm("Iniciar outra partida neste dispositivo? A partida online atual continuará para o outro usuário.")) return;
  if (gameModeSelect.value === "invite") {
    await enviarConviteXadrez();
    return;
  }
  if (!await encerrarPartidaAnteriorParaNova()) return;

  const replaceOnlineState = gameMode === "invite";
  pararSincronizacaoConvidada();
  gameMode = gameModeSelect.value;
  playerColor = playerColorSelect.value;
  localGameId = crypto.randomUUID();
  localGameSaveConflict = false;
  localHistorySubmittedGameId = "";
  skillLevel = Number(skillLevelInput.value);
  atualizarDisponibilidadeRatingStockfish();
  inviteGameId = "";
  inviteUserId = "";
  inviteUserName = "";
  onlineGameStatus = "";
  onlineGameResult = "*";
  onlineRated = false;
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
  if (!await window.orbyConfirm(confirmation)) return;

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
      onlineRated = resultado.rated === true;
      if (onlineRated) {
        void carregarRatingXadrez();
        void carregarRankingXadrez();
      }
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
  stockfishRatingModeSelect.value = stockfishRated ? "rated" : "unrated";
  skillValue.value = String(skillLevel);
  atualizarRatingEstimado();
  atualizarDisponibilidadeRatingStockfish();
  opponentOptions.hidden = gameModeSelect.value !== "stockfish";
  inviteOptions.hidden = gameModeSelect.value !== "invite";
  inviteNameInput.value = inviteUserName;
  newGameLabel.textContent = gameModeSelect.value === "invite" ? "Enviar convite" : "Iniciar nova partida";
}

settingsOpenButton.addEventListener("click", () => {
  syncGameSettings();
  void carregarRatingXadrez();
  if (typeof settingsDialog.showModal === "function") settingsDialog.showModal();
  else settingsDialog.setAttribute("open", "");
});

rankingOpenButton.addEventListener("click", () => {
  void carregarRankingXadrez();
  if (typeof rankingDialog.showModal === "function") rankingDialog.showModal();
  else rankingDialog.setAttribute("open", "");
});
document.getElementById("chessRankingClose").addEventListener("click", () => rankingDialog.close());
rankingDialog.addEventListener("click", event => {
  if (event.target === rankingDialog) rankingDialog.close();
});

matchHistoryOpenButton.addEventListener("click", async () => {
  await registrarPartidaLocalFinalizada();
  settingsDialog.close();
  if (typeof matchHistoryDialog.showModal === "function") matchHistoryDialog.showModal();
  else matchHistoryDialog.setAttribute("open", "");
  void carregarHistoricoPartidas();
});
matchHistoryPeriodFilter.addEventListener("change", aplicarFiltrosHistoricoPartidas);
matchHistoryResultFilter.addEventListener("change", aplicarFiltrosHistoricoPartidas);
document.getElementById("chessHistoryFiltersClear").addEventListener("click", () => {
  matchHistoryPeriodFilter.value = "today";
  matchHistoryResultFilter.value = "all";
  aplicarFiltrosHistoricoPartidas();
});
function fecharHistoricoVoltarConfiguracao() {
  if (matchHistoryDialog.open) matchHistoryDialog.close();
  syncGameSettings();
  if (!settingsDialog.open) {
    if (typeof settingsDialog.showModal === "function") settingsDialog.showModal();
    else settingsDialog.setAttribute("open", "");
  }
}

document.getElementById("chessMatchHistoryClose").addEventListener("click", fecharHistoricoVoltarConfiguracao);
matchHistoryDialog.addEventListener("click", event => {
  if (event.target === matchHistoryDialog) fecharHistoricoVoltarConfiguracao();
});
matchHistoryDialog.addEventListener("cancel", event => {
  event.preventDefault();
  fecharHistoricoVoltarConfiguracao();
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

const toggleNewGameBtn = document.getElementById("chessToggleNewGame");
const newGamePanel = document.getElementById("chessNewGamePanel");
if (toggleNewGameBtn && newGamePanel) {
  toggleNewGameBtn.addEventListener("click", () => {
    const isHidden = newGamePanel.hidden;
    newGamePanel.hidden = !isHidden;
    toggleNewGameBtn.setAttribute("aria-expanded", String(isHidden));
  });
}

gameModeSelect.addEventListener("change", () => {
  opponentOptions.hidden = gameModeSelect.value !== "stockfish";
  inviteOptions.hidden = gameModeSelect.value !== "invite";
  atualizarDisponibilidadeRatingStockfish();
  newGameLabel.textContent = gameModeSelect.value === "invite" ? "Enviar convite" : "Iniciar nova partida";
});
skillLevelInput.addEventListener("input", () => {
  skillValue.value = skillLevelInput.value;
  atualizarRatingEstimado();
  atualizarDisponibilidadeRatingStockfish();
});
stockfishRatingModeSelect.addEventListener("change", () => {
  stockfishRated = Number(skillLevelInput.value) >= 8 && stockfishRatingModeSelect.value === "rated";
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
  inviteUserId = "";
  inviteUserName = "";
  onlineGameStatus = partida.status || "ativa";
  onlineGameResult = partida.resultado || "*";
  onlineRated = partida.rated === true;
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
        if (typeof partida.gameId === "string" && /^[0-9a-f-]{36}$/i.test(partida.gameId)) {
          localGameId = partida.gameId;
        }
        stockfishRated = partida.mode === "stockfish" && partida.rated === true && skillLevel >= 8;
        localGameUpdatedAt = Number(partida.updatedAt) || 0;
        inviteGameId = "";
        inviteUserId = "";
        inviteUserName = "";
        onlineGameStatus = "";
        onlineOpponent = "";
      } else if (atual.mode === "none") {
        if (gameMode === "invite") {
          gameMode = "local";
          inviteGameId = "";
          inviteUserId = "";
          inviteUserName = "";
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

// ==================== STOCKFISH GAME ANALYZER ====================
let analysisWorker = null;
let analysisCancelled = false;
let currentAnalysisData = null;
let currentAnalysisStep = 0;
let analysisFlipped = false;
let analysisCountdownTimer = null;
let analysisCountdownDeadline = 0;
let analysisProgressMessage = "";

const analysisDialog = document.getElementById("chessAnalysisDialog");
const analysisClose = document.getElementById("chessAnalysisClose");
const analysisCancel = document.getElementById("chessAnalysisCancel");
const analysisProgress = document.getElementById("chessAnalysisProgress");
const analysisProgressBar = document.getElementById("chessAnalysisProgressBar");
const analysisProgressText = document.getElementById("chessAnalysisProgressText");
const analysisWhiteAccuracy = document.getElementById("chessAnalysisWhiteAccuracy");
const analysisBlackAccuracy = document.getElementById("chessAnalysisBlackAccuracy");
const analysisWhiteLabel = document.getElementById("chessAnalysisWhiteLabel");
const analysisBlackLabel = document.getElementById("chessAnalysisBlackLabel");
const analysisBreakdown = document.getElementById("chessAnalysisBreakdown");
const analysisBoard = document.getElementById("chessAnalysisBoard");
const analysisEvalFill = document.getElementById("chessAnalysisEvalFill");
const analysisEvalScore = document.getElementById("chessAnalysisEvalScore");
const analysisArrowLayer = document.getElementById("chessAnalysisArrowLayer");
const analysisFeedbackBadge = document.getElementById("chessAnalysisFeedbackBadge");
const analysisFeedbackIcon = document.getElementById("chessAnalysisFeedbackIcon");
const analysisFeedbackTitle = document.getElementById("chessAnalysisFeedbackTitle");
const analysisFeedbackDesc = document.getElementById("chessAnalysisFeedbackDesc");
const analysisFirstBtn = document.getElementById("chessAnalysisFirst");
const analysisPrevBtn = document.getElementById("chessAnalysisPrev");
const analysisFlipBtn = document.getElementById("chessAnalysisFlip");
const analysisNextBtn = document.getElementById("chessAnalysisNext");
const analysisLastBtn = document.getElementById("chessAnalysisLast");
const analysisMoveList = document.getElementById("chessAnalysisMoveList");

const MOVE_CLASSIFICATIONS = {
  brilliant:   { label: "Brilhante", symbol: "!!", class: "badge-brilliant", desc: "Lance genial! Sacrifício decisivo que mantém a vantagem." },
  best:        { label: "Melhor lance", symbol: "\u2605", class: "badge-best", desc: "A jogada ideal apontada pelo Stockfish." },
  excellent:   { label: "Excelente", symbol: "\u2713", class: "badge-excellent", desc: "Quase tão forte quanto o lance do motor." },
  good:        { label: "Bom", symbol: "\u2713", class: "badge-good", desc: "Um lance sólido que mantém uma boa posição." },
  book:        { label: "Livro de teoria", symbol: "\u{1F4D6}", class: "badge-book", desc: "Lance padrão de abertura conhecido na teoria." },
  inaccuracy:  { label: "Inacurácia", symbol: "?!", class: "badge-inaccuracy", desc: "Não é o melhor lance; cedeu um pouco de vantagem." },
  mistake:     { label: "Erro", symbol: "?", class: "badge-mistake", desc: "Um erro que prejudicou sensivelmente a posição." },
  missed:      { label: "Vitória perdida", symbol: "X", class: "badge-missed", desc: "Deixou passar uma chance clara de vitória ou mate." },
  blunder:     { label: "Grave (Capivara)", symbol: "??", class: "badge-blunder", desc: "Erro grave que muda o rumo da partida drasticamente." }
};

function calcularPorcentagemVitoria(cp) {
  return 100 / (1 + Math.pow(10, -cp / 400));
}

function convertLanToSan(fen, lan) {
  if (!lan || lan.length < 4) return lan || "";
  try {
    const testGame = new Chess(fen);
    const from = lan.slice(0, 2);
    const to = lan.slice(2, 4);
    const promotion = lan[4] || undefined;
    const move = testGame.move({ from, to, promotion });
    return move?.san || lan;
  } catch {
    return lan;
  }
}

function logChessAnalysis(event, details = {}) {
  console.info("[chess-analysis]", event, details);
}

function atualizarContagemRegressivaAnalise() {
  if (!analysisProgressText || !analysisCountdownDeadline) return;
  const remainingSeconds = Math.max(0, Math.ceil((analysisCountdownDeadline - Date.now()) / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");
  analysisProgressText.textContent = `${analysisProgressMessage} Tempo restante: ${minutes} min ${seconds} s.`;
}

function iniciarContagemRegressivaAnalise(seconds) {
  if (analysisCountdownTimer) window.clearInterval(analysisCountdownTimer);
  analysisCountdownDeadline = Date.now() + Math.max(0, seconds) * 1000;
  atualizarContagemRegressivaAnalise();
  analysisCountdownTimer = window.setInterval(atualizarContagemRegressivaAnalise, 1000);
}

function pararContagemRegressivaAnalise() {
  if (analysisCountdownTimer) window.clearInterval(analysisCountdownTimer);
  analysisCountdownTimer = null;
  analysisCountdownDeadline = 0;
}

window.addEventListener("error", event => {
  console.error("[chess-analysis] Erro JavaScript não tratado:", event.error || event.message);
});
window.addEventListener("unhandledrejection", event => {
  console.error("[chess-analysis] Promise rejeitada sem tratamento:", event.reason);
});

function avaliarFenStockfish(worker, fen, index, total, searchTimeMs) {
  return new Promise((resolve, reject) => {
    let score = 0;
    let mate = null;
    let bestmove = "";
    let isWhiteTurn = true;
    try {
      const parts = fen.split(" ");
      isWhiteTurn = parts[1] !== "b";
    } catch {}

    logChessAnalysis("posição iniciada", { index, total, fen });
    const timeout = setTimeout(() => {
      worker.removeEventListener("message", handler);
      worker.removeEventListener("error", onError);
      reject(new Error(`Timeout após ${(searchTimeMs + 15000) / 1000}s na posição ${index}/${total}.`));
    }, searchTimeMs + 15000);
    const handler = event => {
      const line = String(event.data || "").trim();
      if (line.includes("score cp ")) {
        const cpMatch = line.match(/score cp (-?\d+)/);
        if (cpMatch) {
          const rawCp = Number(cpMatch[1]);
          score = isWhiteTurn ? rawCp : -rawCp;
          mate = null;
        }
      } else if (line.includes("score mate ")) {
        const mateMatch = line.match(/score mate (-?\d+)/);
        if (mateMatch) {
          mate = Number(mateMatch[1]);
          const base = mate > 0 ? 10000 - Math.abs(mate) * 10 : -10000 + Math.abs(mate) * 10;
          score = isWhiteTurn ? base : -base;
        }
      }
      if (line.startsWith("bestmove ")) {
        const bmMatch = line.match(/^bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
        bestmove = bmMatch ? bmMatch[1] : "";
        clearTimeout(timeout);
        worker.removeEventListener("message", handler);
        worker.removeEventListener("error", onError);
        resolve({ score, mate, bestmove });
      }
    };

    worker.addEventListener("error", onError);
    function onError(event) {
      clearTimeout(timeout);
      worker.removeEventListener("message", handler);
      worker.removeEventListener("error", onError);
      const error = event.error || new Error("O worker do Stockfish falhou.");
      console.error("[chess-analysis] Falha no worker durante posição:", { index, total, fen, error });
      reject(error);
    }
    worker.addEventListener("message", handler);
    worker.postMessage(`position fen ${fen}`);
    // A bounded time search is stronger and more consistent than a shallow
    // fixed depth, especially across positions with very different complexity.
    worker.postMessage(`go movetime ${searchTimeMs}`);
  });
}

function pararAnaliseEFechar() {
  analysisCancelled = true;
  pararContagemRegressivaAnalise();
  if (analysisWorker) {
    try {
      analysisWorker.postMessage("quit");
      analysisWorker.terminate();
    } catch {}
    analysisWorker = null;
  }
  if (analysisDialog?.open) analysisDialog.close();
}

function fecharAnaliseVoltarHistorico() {
  pararAnaliseEFechar();
  if (!matchHistoryDialog.open) {
    if (typeof matchHistoryDialog.showModal === "function") matchHistoryDialog.showModal();
    else matchHistoryDialog.setAttribute("open", "");
  }
}

async function iniciarAnalisePartida(pgn, metadata = {}) {
  pararAnaliseEFechar();
  analysisCancelled = false;
  logChessAnalysis("análise iniciada", {
    gameId: metadata.gameId || null,
    opponent: metadata.opponent || null,
    pgnLength: typeof pgn === "string" ? pgn.length : 0,
    hasSavedAnalysis: Boolean(metadata.analise)
  });

  if (typeof analysisDialog.showModal === "function") analysisDialog.showModal();
  else analysisDialog.setAttribute("open", "");

  analysisWhiteLabel.textContent = `Brancas · ${metadata.whiteName || "Jogador"}`;
  analysisBlackLabel.textContent = `Pretas · ${metadata.blackName || "Jogador"}`;
  analysisFlipped = metadata.playerColor === "b";

  if (metadata.analise && Array.isArray(metadata.analise.moves) && metadata.analise.moves.length) {
    if (metadata.analysisButton) {
      metadata.analysisButton.classList.add("analysis-complete");
      metadata.analysisButton.querySelector(".chess-match-analysis-done")?.removeAttribute("hidden");
      metadata.analysisButton.title = "Análise já realizada";
      metadata.analysisButton.setAttribute("aria-label", "Análise já realizada. Abrir análise da partida");
    }
    analysisProgress.hidden = false;
    analysisProgress.classList.add("analysis-completed");
    analysisCancel.hidden = true;
    analysisProgressBar.style.width = "100%";
    analysisProgressText.innerHTML = '<i class="bi bi-check-circle-fill" style="color:#2e7d32"></i> Análise concluída pelo Stockfish';
    carregarDadosAnalise(metadata.analise, metadata.playerColor || "w");
    return;
  }

  const jogo = new Chess();
  try {
    if (pgn) jogo.loadPgn(pgn);
  } catch (err) {
    console.warn("Erro ao carregar PGN para análise:", err);
  }

  const moves = jogo.history({ verbose: true });
  logChessAnalysis("PGN carregado", { moveCount: moves.length, headers: jogo.getHeaders() });
  if (!moves.length) {
    analysisProgress.hidden = false;
    analysisProgress.classList.remove("analysis-completed");
    analysisCancel.hidden = true;
    analysisProgressText.textContent = "Nenhum lance nesta partida para analisar.";
    analysisProgressBar.style.width = "0%";
    analysisWhiteAccuracy.textContent = "--%";
    analysisBlackAccuracy.textContent = "--%";
    analysisBreakdown.replaceChildren();
    return;
  }

  analysisProgress.hidden = false;
  analysisProgress.classList.remove("analysis-completed");
  analysisCancel.hidden = false;
  analysisProgressBar.style.width = "0%";
  analysisProgressText.textContent = `Iniciando Stockfish para analisar ${moves.length} lances...`;

  const positions = [];
  const replay = new Chess();
  positions.push({ fen: replay.fen(), movePlayed: null });
  for (const mv of moves) {
    replay.move(mv);
    positions.push({ fen: replay.fen(), movePlayed: mv });
  }

  // Render immediately: waiting for every engine evaluation left the dialog
  // looking blank throughout long Stockfish games.
  currentAnalysisData = {
    moves: [],
    initialFen: positions[0].fen,
    initialEval: { score: 0, mate: null },
    breakdown: {}
  };
  renderAnalysisStep(0);

  try {
    analysisWorker = new Worker("/vendor/stockfish.js/stockfish.wasm.js");
    analysisWorker.addEventListener("error", event => {
      console.error("[chess-analysis] Erro global do worker:", event.error || event.message);
    });
  } catch (error) {
    console.error("Falha ao instanciar worker do Stockfish:", error);
    analysisProgressText.textContent = "Não foi possível carregar o Stockfish no navegador.";
    return;
  }

  const stockfishInitialized = await new Promise(res => {
    const initTimeout = setTimeout(() => {
      analysisWorker?.removeEventListener("message", initHandler);
      console.error("[chess-analysis] Timeout aguardando uciok/readyok do Stockfish.");
      res(false);
    }, 15000);
    const initHandler = e => {
      const line = String(e.data || "").trim();
      if (line === "uciok" || line === "readyok") logChessAnalysis("handshake", { response: line });
      if (line === "uciok") {
        analysisWorker.postMessage("isready");
      } else if (line === "readyok") {
        clearTimeout(initTimeout);
        analysisWorker.removeEventListener("message", initHandler);
        res(true);
      }
    };
    analysisWorker.addEventListener("message", initHandler);
    logChessAnalysis("enviando UCI", { workerUrl: "/vendor/stockfish.js/stockfish.wasm.js" });
    analysisWorker.postMessage("uci");
  });

  if (analysisCancelled) return;
  if (!stockfishInitialized || !analysisWorker) {
    analysisProgressText.textContent = "O Stockfish não respondeu ao iniciar. Feche e tente novamente.";
    analysisCancel.hidden = true;
    try { analysisWorker.terminate(); } catch {}
    analysisWorker = null;
    return;
  }
  logChessAnalysis("motor pronto", { positions: positions.length });

  const evaluations = [];
  const analysisSearchTimeMs = 1000;
  const enginePositionCount = positions.reduce((count, position) => {
    const positionGame = new Chess(position.fen);
    return count + (positionGame.isGameOver() ? 0 : 1);
  }, 0);
  const estimatedAnalysisSeconds = Math.ceil((analysisSearchTimeMs * enginePositionCount) / 1000);
  logChessAnalysis("tempo de análise definido", {
    searchTimeMsPerPosition: analysisSearchTimeMs,
    estimatedSeconds: estimatedAnalysisSeconds,
    enginePositions: enginePositionCount
  });
  analysisProgressMessage = "Preparando análise das posições";
  iniciarContagemRegressivaAnalise(estimatedAnalysisSeconds);
  for (let i = 0; i < positions.length; i += 1) {
    if (analysisCancelled) return;
    const pct = Math.min(99, Math.round(((i + 1) / positions.length) * 100));
    analysisProgressBar.style.width = `${pct}%`;
    analysisProgressMessage = `Analisando posição ${i + 1} de ${positions.length} (${pct}%).`;
    atualizarContagemRegressivaAnalise();

    let ev;
    try {
      const positionGame = new Chess(positions[i].fen);
      if (positionGame.isCheckmate()) {
        // Stockfish 10's WASM build can fail to emit `bestmove` for terminal
        // checkmate positions. The side to move is mated, so score from White's view.
        ev = { score: positionGame.turn() === "w" ? -10000 : 10000, mate: null, bestmove: "" };
        logChessAnalysis("posição terminal detectada", {
          index: i + 1, total: positions.length, result: "checkmate", turn: positionGame.turn(), fen: positions[i].fen
        });
      } else if (positionGame.isStalemate() || positionGame.isDraw()) {
        ev = { score: 0, mate: null, bestmove: "" };
        logChessAnalysis("posição terminal detectada", {
          index: i + 1, total: positions.length, result: "draw", turn: positionGame.turn(), fen: positions[i].fen
        });
      } else {
        ev = await avaliarFenStockfish(
          analysisWorker, positions[i].fen, i + 1, positions.length, analysisSearchTimeMs
        );
      }
    } catch (error) {
      if (analysisCancelled) return;
      pararContagemRegressivaAnalise();
      console.error("Falha durante a análise do Stockfish:", error);
      console.error("[chess-analysis] Contexto da falha:", {
        position: i + 1, total: positions.length, fen: positions[i].fen
      });
      analysisProgressText.textContent = `A análise parou na posição ${i + 1}: ${error.message || "erro do Stockfish"}`;
      analysisCancel.hidden = true;
      try { analysisWorker?.terminate(); } catch {}
      analysisWorker = null;
      return;
    }
    evaluations.push(ev);
  }

  const classifiedMoves = [];
  const breakdown = {
    brilliant:   { w: 0, b: 0 },
    best:        { w: 0, b: 0 },
    excellent:   { w: 0, b: 0 },
    good:        { w: 0, b: 0 },
    book:        { w: 0, b: 0 },
    inaccuracy:  { w: 0, b: 0 },
    mistake:     { w: 0, b: 0 },
    missed:      { w: 0, b: 0 },
    blunder:     { w: 0, b: 0 }
  };

  const pieceValues = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  for (let i = 0; i < moves.length; i += 1) {
    const mv = moves[i];
    const fenBefore = positions[i].fen;
    const fenAfter = positions[i + 1].fen;
    const evBefore = evaluations[i];
    const evAfter = evaluations[i + 1];

    const isWhite = mv.color === "w";
    const winBefore = calcularPorcentagemVitoria(evBefore.score);
    const winAfter = calcularPorcentagemVitoria(evAfter.score);

    const playerWinBefore = isWhite ? winBefore : 100 - winBefore;
    const playerWinAfter = isWhite ? winAfter : 100 - winAfter;
    const winDiff = Math.max(0, playerWinBefore - playerWinAfter);
    const cpDiff = Math.max(0, isWhite ? evBefore.score - evAfter.score : evAfter.score - evBefore.score);

    const playedLan = mv.from + mv.to + (mv.promotion || "");
    const bestLan = evBefore.bestmove || "";
    const isEngineTopMove = playedLan === bestLan;

    let type = "good";

    const isBook = i < 4 && cpDiff <= 30;
    const isSacrifice = ["q", "r", "b", "n"].includes(mv.piece) &&
      ((pieceValues[mv.piece] || 0) - (mv.captured ? pieceValues[mv.captured] || 0 : 0) >= 2);

    if (isBook) {
      type = "book";
    } else if (isSacrifice && winDiff <= 2.0 && playerWinAfter >= 58) {
      type = "brilliant";
    } else if (isEngineTopMove || winDiff <= 1.5 || cpDiff <= 15) {
      type = "best";
    } else if (winDiff <= 4.0 || cpDiff <= 35) {
      type = "excellent";
    } else if (winDiff <= 9.0 || cpDiff <= 75) {
      type = "good";
    } else if (playerWinBefore >= 80 && playerWinAfter < 52) {
      type = "missed";
    } else if (winDiff <= 18.0 || cpDiff <= 160) {
      type = "inaccuracy";
    } else if (winDiff <= 32.0 || cpDiff <= 300) {
      type = "mistake";
    } else {
      type = "blunder";
    }

    if (breakdown[type]) {
      breakdown[type][mv.color] += 1;
    }

    const accuracy = Math.max(0, Math.min(100,
      Math.round((103.1668 * Math.exp(-0.04354 * winDiff) - 3.1668) * 10) / 10
    ));

    const bestMoveSan = convertLanToSan(fenBefore, bestLan);

    classifiedMoves.push({
      index: i,
      ply: i + 1,
      turn: Math.floor(i / 2) + 1,
      color: mv.color,
      san: mv.san,
      from: mv.from,
      to: mv.to,
      fenBefore,
      fenAfter,
      evalBefore: evBefore,
      evalAfter: evAfter,
      winPctAfter: winAfter,
      bestLan,
      bestMoveSan,
      type,
      winDiff,
      cpDiff,
      accuracy
    });
  }

  const whiteMoves = classifiedMoves.filter(m => m.color === "w");
  const blackMoves = classifiedMoves.filter(m => m.color === "b");
  const whiteAcc = whiteMoves.length
    ? Math.round(whiteMoves.reduce((s, m) => s + m.accuracy, 0) / whiteMoves.length * 10) / 10
    : 100;
  const blackAcc = blackMoves.length
    ? Math.round(blackMoves.reduce((s, m) => s + m.accuracy, 0) / blackMoves.length * 10) / 10
    : 100;

  const analiseFinal = {
    whiteAccuracy: whiteAcc,
    blackAccuracy: blackAcc,
    moves: classifiedMoves,
    breakdown,
    initialFen: positions[0].fen,
    initialEval: evaluations[0]
  };
  pararContagemRegressivaAnalise();

  logChessAnalysis("avaliações classificadas", {
    evaluatedPositions: evaluations.length,
    classifiedMoves: classifiedMoves.length,
    whiteAccuracy: whiteAcc,
    blackAccuracy: blackAcc
  });

  analysisProgress.hidden = false;
  analysisProgress.classList.add("analysis-completed");
  analysisCancel.hidden = true;
  analysisProgressBar.style.width = "100%";
  analysisProgressText.innerHTML = '<i class="bi bi-check-circle-fill" style="color:#2e7d32"></i> Análise concluída com sucesso pelo Stockfish!';
  if (analysisWorker) {
    try { analysisWorker.terminate(); } catch {}
    analysisWorker = null;
  }

  if (userId && metadata.gameId) {
    void fetch(`/xadrez/usuarios/${encodeURIComponent(userId)}/historico/${encodeURIComponent(metadata.gameId)}/analise`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analise: analiseFinal })
    }).catch(err => console.warn("Não foi possível salvar a análise:", err));
  }

  if (metadata.analysisButton) {
    metadata.analysisButton.classList.add("analysis-complete");
    metadata.analysisButton.querySelector(".chess-match-analysis-done")?.removeAttribute("hidden");
    metadata.analysisButton.title = "Análise já realizada";
    metadata.analysisButton.setAttribute("aria-label", "Análise já realizada. Abrir análise da partida");
  }

  carregarDadosAnalise(analiseFinal, metadata.playerColor || "w");
  logChessAnalysis("análise exibida", { gameId: metadata.gameId || null });
}

function carregarDadosAnalise(analise, orientation = "w") {
  currentAnalysisData = analise;
  analysisFlipped = orientation === "b";

  analysisWhiteAccuracy.textContent = `${analise.whiteAccuracy}%`;
  analysisBlackAccuracy.textContent = `${analise.blackAccuracy}%`;

  analysisBreakdown.replaceChildren();
  const order = ["brilliant", "best", "excellent", "good", "book", "inaccuracy", "mistake", "missed", "blunder"];
  for (const cat of order) {
    const config = MOVE_CLASSIFICATIONS[cat];
    const row = document.createElement("div");
    row.className = "chess-breakdown-row";

    const countW = document.createElement("span");
    countW.className = "count-w";
    countW.textContent = String(analise.breakdown?.[cat]?.w || 0);

    const tag = document.createElement("span");
    tag.className = `badge-tag ${config.class}`;
    tag.innerHTML = `<span>${config.symbol}</span> <span>${config.label}</span>`;

    const countB = document.createElement("span");
    countB.className = "count-b";
    countB.textContent = String(analise.breakdown?.[cat]?.b || 0);

    row.append(countW, tag, countB);
    analysisBreakdown.appendChild(row);
  }

  renderAnalysisMoveList(analise.moves);
  selectAnalysisMove(analise.moves.length ? 1 : 0);
}

function renderAnalysisMoveList(moves) {
  analysisMoveList.replaceChildren();
  for (let i = 0; i < moves.length; i += 2) {
    const row = document.createElement("li");
    row.className = "chess-analysis-move-row";

    const num = document.createElement("span");
    num.className = "chess-history-number";
    num.textContent = `${Math.floor(i / 2) + 1}.`;

    const whiteMv = moves[i];
    const whiteBtn = document.createElement("button");
    whiteBtn.type = "button";
    whiteBtn.className = "chess-analysis-move-btn";
    whiteBtn.dataset.step = String(i + 1);
    const whiteConfig = MOVE_CLASSIFICATIONS[whiteMv.type] || MOVE_CLASSIFICATIONS.good;
    whiteBtn.innerHTML = `<span>${whiteMv.san}</span><span class="move-badge ${whiteConfig.class}">${whiteConfig.symbol}</span>`;
    whiteBtn.addEventListener("click", () => selectAnalysisMove(i + 1));

    row.append(num, whiteBtn);

    if (moves[i + 1]) {
      const blackMv = moves[i + 1];
      const blackBtn = document.createElement("button");
      blackBtn.type = "button";
      blackBtn.className = "chess-analysis-move-btn";
      blackBtn.dataset.step = String(i + 2);
      const blackConfig = MOVE_CLASSIFICATIONS[blackMv.type] || MOVE_CLASSIFICATIONS.good;
      blackBtn.innerHTML = `<span>${blackMv.san}</span><span class="move-badge ${blackConfig.class}">${blackConfig.symbol}</span>`;
      blackBtn.addEventListener("click", () => selectAnalysisMove(i + 2));
      row.appendChild(blackBtn);
    }

    analysisMoveList.appendChild(row);
  }
}

function desenharSetaAnalise(svg, fromSq, toSq, cor = "#35a853", strokeWidth = 2.4) {
  const col1 = files.indexOf(fromSq[0]);
  const rank1 = Number(fromSq[1]);
  const col2 = files.indexOf(toSq[0]);
  const rank2 = Number(toSq[1]);
  if (col1 < 0 || col2 < 0 || !Number.isFinite(rank1) || !Number.isFinite(rank2)) return;

  const f1 = analysisFlipped ? 7 - col1 : col1;
  const r1 = analysisFlipped ? rank1 - 1 : 8 - rank1;
  const f2 = analysisFlipped ? 7 - col2 : col2;
  const r2 = analysisFlipped ? rank2 - 1 : 8 - rank2;

  const x1 = (f1 + 0.5) * 12.5;
  const y1 = (r1 + 0.5) * 12.5;
  const x2 = (f2 + 0.5) * 12.5;
  const y2 = (r2 + 0.5) * 12.5;

  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return;
  const shorten = 3.6;
  const endX = x2 - (dx / dist) * shorten;
  const endY = y2 - (dy / dist) * shorten;

  const markerId = `marker-${cor.replace(/[^a-zA-Z0-9]/g, "")}`;
  let defs = svg.querySelector("defs");
  if (!defs) {
    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.appendChild(defs);
  }
  if (!defs.querySelector(`#${markerId}`)) {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", markerId);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "6");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto-start-reverse");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M 0 1.5 L 9 5 L 0 8.5 z");
    path.setAttribute("fill", cor);
    marker.appendChild(path);
    defs.appendChild(marker);
  }

  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(endX));
  line.setAttribute("y2", String(endY));
  line.setAttribute("stroke", cor);
  line.setAttribute("stroke-width", String(strokeWidth));
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("opacity", "0.92");
  line.setAttribute("marker-end", `url(#${markerId})`);
  svg.appendChild(line);
}

function renderAnalysisStep(stepIndex) {
  if (!currentAnalysisData) return;
  currentAnalysisStep = stepIndex;

  const moves = currentAnalysisData.moves || [];
  const mv = stepIndex > 0 ? moves[stepIndex - 1] : null;
  const fen = mv ? mv.fenAfter : (currentAnalysisData.initialFen || "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const evalInfo = mv ? mv.evalAfter : (currentAnalysisData.initialEval || { score: 0 });

  const tempGame = new Chess();
  try { tempGame.load(fen); } catch {}
  const position = tempGame.board();

  analysisBoard.replaceChildren();
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const posRow = analysisFlipped ? 7 - row : row;
      const posCol = analysisFlipped ? 7 - column : column;
      const piece = position[posRow][posCol];
      const square = `${files[posCol]}${8 - posRow}`;
      const button = document.createElement("button");
      const isLight = (row + column) % 2 === 0;
      button.type = "button";
      button.className = `chess-square ${isLight ? "chess-square-light" : "chess-square-dark"}`;
      button.dataset.square = square;

      if (mv && (square === mv.from || square === mv.to)) {
        button.classList.add("chess-square-last-move");
      }

      if (piece) {
        button.classList.add("chess-square-has-piece");
        const symbol = document.createElement("span");
        symbol.className = `chess-piece ${piece.color === "w" ? "chess-piece-white" : "chess-piece-black"}`;
        symbol.textContent = pieceSymbols[piece.color][piece.type];
        button.appendChild(symbol);
      }
      if (row === 7 || column === 0) {
        const coordinate = document.createElement("span");
        coordinate.className = "chess-square-coordinate";
        coordinate.textContent = row === 7 && column === 0
          ? square
          : row === 7 ? files[posCol] : 8 - posRow;
        button.appendChild(coordinate);
      }
      analysisBoard.appendChild(button);
    }
  }

  analysisArrowLayer.replaceChildren();

  if (mv) {
    const config = MOVE_CLASSIFICATIONS[mv.type] || MOVE_CLASSIFICATIONS.good;
    analysisFeedbackBadge.className = `chess-analysis-feedback-badge ${config.class}`;
    analysisFeedbackIcon.textContent = config.symbol;
    analysisFeedbackTitle.textContent = `${config.label} (${mv.san})`;

    if (mv.bestLan && mv.bestLan !== (mv.from + mv.to + (mv.promotion || ""))) {
      analysisFeedbackDesc.innerHTML = `${config.desc}<br>Melhor lance recomendado: <strong>${mv.bestMoveSan || mv.bestLan}</strong>.`;
      const bestFrom = mv.bestLan.slice(0, 2);
      const bestTo = mv.bestLan.slice(2, 4);
      desenharSetaAnalise(analysisArrowLayer, bestFrom, bestTo, "#35a853", 2.6);

      if (["inaccuracy", "mistake", "blunder", "missed"].includes(mv.type)) {
        const errColor = mv.type === "blunder" ? "#d32f2f" : mv.type === "mistake" ? "#e67e22" : "#e6a700";
        desenharSetaAnalise(analysisArrowLayer, mv.from, mv.to, errColor, 2.2);
      }
    } else {
      analysisFeedbackDesc.textContent = config.desc;
      if (mv.bestLan) {
        desenharSetaAnalise(analysisArrowLayer, mv.from, mv.to, "#35a853", 2.6);
      }
    }
  } else {
    analysisFeedbackBadge.className = "chess-analysis-feedback-badge badge-best";
    analysisFeedbackIcon.textContent = "\u2605";
    analysisFeedbackTitle.textContent = "Posição inicial";
    analysisFeedbackDesc.textContent = "Nenhum lance selecionado. Use as setas ou clique em um lance na lista.";
  }

  const winWhite = calcularPorcentagemVitoria(evalInfo.score || 0);
  analysisEvalFill.style.height = `${Math.max(5, Math.min(95, winWhite))}%`;
  if (evalInfo.mate !== null && evalInfo.mate !== undefined) {
    analysisEvalScore.textContent = `M${Math.abs(evalInfo.mate)}`;
  } else {
    const rawScore = (evalInfo.score || 0) / 100;
    const formatted = rawScore > 0 ? `+${rawScore.toFixed(1)}` : rawScore.toFixed(1);
    analysisEvalScore.textContent = formatted;
  }

  analysisMoveList.querySelectorAll(".chess-analysis-move-btn").forEach(btn => {
    const active = Number(btn.dataset.step) === stepIndex;
    btn.classList.toggle("active", active);
    if (active) {
      btn.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  });
}

function selectAnalysisMove(stepIndex) {
  renderAnalysisStep(stepIndex);
}

if (analysisClose) analysisClose.addEventListener("click", fecharAnaliseVoltarHistorico);
if (analysisCancel) analysisCancel.addEventListener("click", fecharAnaliseVoltarHistorico);
if (analysisDialog) {
  analysisDialog.addEventListener("click", event => {
    if (event.target === analysisDialog) fecharAnaliseVoltarHistorico();
  });
  analysisDialog.addEventListener("cancel", event => {
    event.preventDefault();
    fecharAnaliseVoltarHistorico();
  });
}

if (analysisFirstBtn) analysisFirstBtn.addEventListener("click", () => selectAnalysisMove(0));
if (analysisPrevBtn) {
  analysisPrevBtn.addEventListener("click", () => selectAnalysisMove(Math.max(0, currentAnalysisStep - 1)));
}
if (analysisNextBtn) {
  analysisNextBtn.addEventListener("click", () => {
    if (!currentAnalysisData) return;
    selectAnalysisMove(Math.min(currentAnalysisData.moves.length, currentAnalysisStep + 1));
  });
}
if (analysisLastBtn) {
  analysisLastBtn.addEventListener("click", () => {
    if (!currentAnalysisData) return;
    selectAnalysisMove(currentAnalysisData.moves.length);
  });
}
if (analysisFlipBtn) {
  analysisFlipBtn.addEventListener("click", () => {
    analysisFlipped = !analysisFlipped;
    if (currentAnalysisData) renderAnalysisStep(currentAnalysisStep);
  });
}

document.addEventListener("keydown", event => {
  if (!analysisDialog?.open || !currentAnalysisData) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    selectAnalysisMove(Math.max(0, currentAnalysisStep - 1));
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    selectAnalysisMove(Math.min(currentAnalysisData.moves.length, currentAnalysisStep + 1));
  }
});

void carregarRatingXadrez();
void carregarPartidaAtual();
