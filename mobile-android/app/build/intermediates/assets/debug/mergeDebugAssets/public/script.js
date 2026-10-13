function lerCookie(nome) {
  const prefixo = `${encodeURIComponent(nome)}=`;
  const item = document.cookie.split(";").map(valor => valor.trim()).find(valor => valor.startsWith(prefixo));
  return item ? decodeURIComponent(item.slice(prefixo.length)) : "";
}

const userId = lerCookie("orbyUserId");
window.orbyUserId = userId;
if (!userId) {
  window.location.href = "/login.html";
}

const user = userId ? { id: userId } : null;
let habitos = [];
let habitoEmEdicao = null;
let horariosHabitoFormulario = [];

let dataSelecionada = new Date();
dataSelecionada.setHours(0, 0, 0, 0);
let posts = [];
let postEmEdicao = null;
let arrastePostAtivo = null;
let quadroPosts;
let canvasPosts;
let folhasCaderno = [];
let indiceFolhaCaderno = -1;
let carregandoCaderno = false;
let cadernoCarregado = false;
let cadernoAlterado = false;
let cadernoSalvando = false;
let listas = [];
let listaEmEdicao = null;


//funcao de deslogar
async function logout() {
  const sincronizadorAndroid = sincronizadorAndroidNativo();
  if (sincronizadorAndroid) {
    try {
      await sincronizadorAndroid.stop();
    } catch (error) {
      console.error("Não foi possível desativar a sincronização nativa ao sair:", error);
    }
  }
  const pushNotifications = pushNotificationsNativas();
  const tokenPush = localStorage.getItem("orbyFcmToken") || "";
  if (tokenPush) {
    try {
      const response = await fetch(`/notificacoes/${encodeURIComponent(userId)}/fcm`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenPush })
      });
      if (!response.ok) throw new Error("O servidor não removeu o dispositivo das notificações.");
      localStorage.removeItem("orbyFcmToken");
      localStorage.removeItem("orbyFcmPushEnabled");
    } catch (error) {
      console.error("Não foi possível desvincular as notificações push ao sair:", error);
    }
  }
  if (pushNotifications) {
    try {
      await pushNotifications.unregister();
    } catch (error) {
      console.error("Não foi possível desativar o token FCM ao sair:", error);
    }
  }
  const notificacoesLocais = notificacoesLocaisNativas();
  notificacoesTarefasDesativadas = true;
  clearTimeout(temporizadorSincronizacaoNotificacoesTarefas);
  if (notificacoesLocais) {
    try {
      await sincronizacaoNotificacoesTarefasPromise;
      const pendentes = await notificacoesLocais.getPending();
      if (pendentes.notifications.length) {
        await notificacoesLocais.cancel({
          notifications: pendentes.notifications.map(notificacao => ({ id: notificacao.id }))
        });
      }
      await notificacoesLocais.removeAllDeliveredNotifications();
    } catch (error) {
      console.error("Não foi possível limpar as notificações ao sair:", error);
    }
  }
  try {
    const response = await fetch("/logout", { method: "POST" });
    if (!response.ok) throw new Error("O servidor não confirmou o encerramento da sessão.");
  } catch (error) {
    console.error("Não foi possível encerrar a sessão da Orb.IA no servidor:", error);
  }
  document.cookie = "orbyUserId=; Max-Age=0; Path=/; SameSite=Lax";
  window.location.href = "/login.html";
}

async function carregarPerfilUsuario() {
  try {
    const response = await fetch(`/usuarios/${encodeURIComponent(userId)}/perfil`);
    const perfil = await response.json();
    if (!response.ok) throw new Error(perfil.erro || "Não foi possível carregar o perfil.");

    const nome = (perfil.nome || "Usuário").trim().split(/\s+/)[0];
    const nomeElemento = document.getElementById("nomeUsuario");
    const foto = document.getElementById("fotoPerfilUsuario");
    nomeElemento.textContent = nome;
    document.getElementById("inputNomePerfil").value = perfil.nome || "";
    if (perfil.fotoPerfilUrl) {
      foto.src = perfil.fotoPerfilUrl;
      foto.hidden = false;
      foto.addEventListener("error", () => {
        foto.hidden = true;
        foto.removeAttribute("src");
      }, { once: true });
    }
  } catch (error) {
    console.error("Não foi possível carregar o perfil do usuário:", error);
    document.getElementById("nomeUsuario").textContent = "Perfil indisponível";
  }
}

async function salvarNomePerfil(event) {
  event.preventDefault();
  const input = document.getElementById("inputNomePerfil");
  const status = document.getElementById("statusConfiguracoesPerfil");
  const botao = document.querySelector("#formNomePerfil button[type='submit']");
  const nome = input.value.trim();
  status.hidden = false;
  status.textContent = "";
  status.classList.remove("erro");
  if (!nome || nome.length > 100) {
    status.classList.add("erro");
    status.textContent = "Informe um nome de até 100 caracteres.";
    return;
  }

  botao.disabled = true;
  try {
    const response = await fetch(`/usuarios/${encodeURIComponent(userId)}/perfil/nome`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome })
    });
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Não foi possível salvar o nome.");

    document.getElementById("nomeUsuario").textContent = resultado.nome.trim().split(/\s+/)[0];
    status.textContent = "Nome atualizado.";
  } catch (error) {
    console.error("Não foi possível atualizar o nome do perfil:", error);
    status.classList.add("erro");
    status.textContent = error.message || "Não foi possível salvar o nome.";
  } finally {
    botao.disabled = false;
  }
}

async function redefinirSenhaPerfil(event) {
  event.preventDefault();
  const formulario = document.getElementById("formSenhaPerfil");
  const status = document.getElementById("statusConfiguracoesPerfil");
  const botao = formulario.querySelector("button[type='submit']");
  const senhaAtual = document.getElementById("senhaAtualPerfil").value;
  const novaSenha = document.getElementById("novaSenhaPerfil").value;

  status.hidden = false;
  status.textContent = "";
  status.classList.remove("erro");

  botao.disabled = true;
  try {
    const response = await fetch(`/usuarios/${encodeURIComponent(userId)}/senha`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senhaAtual, novaSenha })
    });
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Não foi possível redefinir a senha.");

    formulario.reset();
    status.textContent = "Senha atualizada com sucesso.";
  } catch (error) {
    console.error("Não foi possível redefinir a senha:", error);
    status.classList.add("erro");
    status.textContent = error.message || "Não foi possível redefinir a senha.";
  } finally {
    botao.disabled = false;
  }
}

async function enviarFotoPerfil(arquivo) {
  const seletor = document.getElementById("arquivoFotoPerfil");
  const botoes = [document.getElementById("escolherFotoPerfil")];
  const statusConfiguracoes = document.getElementById("statusConfiguracoesPerfil");
  statusConfiguracoes.hidden = false;
  statusConfiguracoes.textContent = "Enviando foto...";
  statusConfiguracoes.classList.remove("erro");
  botoes.forEach(botao => { botao.disabled = true; });

  try {
    if (!["image/jpeg", "image/png", "image/webp"].includes(arquivo.type)) {
      throw new Error("Escolha uma imagem JPG, PNG ou WebP.");
    }
    if (arquivo.size > 5 * 1024 * 1024) throw new Error("A foto deve ter no máximo 5 MB.");

    const assinaturaResponse = await fetch("/cloudinary/profile-signature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });
    const assinatura = await assinaturaResponse.json();
    if (!assinaturaResponse.ok) throw new Error(assinatura.erro || "Não foi possível preparar o envio.");

    const formulario = new FormData();
    formulario.append("file", arquivo);
    formulario.append("api_key", assinatura.apiKey);
    formulario.append("timestamp", String(assinatura.timestamp));
    formulario.append("folder", assinatura.folder);
    formulario.append("signature", assinatura.signature);

    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(assinatura.cloudName)}/image/upload`,
      { method: "POST", body: formulario }
    );
    const upload = await uploadResponse.json();
    if (!uploadResponse.ok) throw new Error(upload.error?.message || "A Cloudinary recusou o envio.");

    const salvarResponse = await fetch(`/usuarios/${encodeURIComponent(userId)}/perfil/foto`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publicId: upload.public_id })
    });
    const resultado = await salvarResponse.json();
    if (!salvarResponse.ok) throw new Error(resultado.erro || "Não foi possível salvar a foto de perfil.");

    const foto = document.getElementById("fotoPerfilUsuario");
    foto.src = resultado.fotoPerfilUrl;
    foto.hidden = false;
    statusConfiguracoes.textContent = "Foto de perfil atualizada.";
  } catch (error) {
    console.error("Não foi possível atualizar a foto de perfil:", error);
    statusConfiguracoes.classList.add("erro");
    statusConfiguracoes.textContent = error.message || "Não foi possível atualizar a foto.";
  } finally {
    botoes.forEach(botao => { botao.disabled = false; });
    seletor.value = "";
  }
}

carregarPerfilUsuario();

// Loader do sistema
window.addEventListener("load", () => {
  setTimeout(() => {
    const loader = document.getElementById("loader");

    if (!loader) return;

    loader.style.opacity = "0";
    loader.style.pointerEvents = "none";

    setTimeout(() => loader.remove(), 300);
  }, 700);
});


//função para setar a seção ativa
function setActive(button) {
  const container = document.getElementById("containerTasks");
  const sections = Array.from(container.children).filter(element => element.tagName === "SECTION");
  const section = sections.find(element => element.id === button.dataset.section);

  if (!section) return;

  document.querySelectorAll("#containerOptions .option").forEach(option => {
    option.classList.toggle("active", option === button);
  });

  sections.forEach(element => {
    const isActive = element === section;
    element.style.removeProperty("display");
    element.hidden = !isActive;
    element.classList.toggle("show", isActive);
  });

  if (section.id === "containerNotas") carregarPosts();
  if (section.id === "containerNotas") requestAnimationFrame(atualizarPosicaoLixeiraPosts);
  if (section.id === "containerOutracoisa") carregarCaderno();
  if (section.id === "containerHabitos") carregarHabitos();
  if (section.id === "containerListas") carregarListas();
  if (section.id === "containerTarefas") {
    aplicarTamanhoSalvoPainelTarefas();
    aplicarLayoutWidgets();
  }
}
let redimensionamentoPainelTarefas = null;
let arrasteWidget = null;
let ordemWidgets = 1;
let modoArrasteWidgets = false;
let layoutWidgetsEmMemoria = null;
let layoutWidgetsCarregado = false;
let salvamentoLayoutWidgetsEmAndamento = Promise.resolve();
let contextoAudioPomodoro = null;
const preferenciasPadrao = {
  layoutWidgets: {},
  visibilidadeWidgets: { "important-tasks": true, list: false, habit: false, clock: false, stopwatch: false, pomodoro: false, "timer-regressivo": false, utilidades: false, links: false, chess: false, "orb-ia": false },
  postitsWidgets: [],
  estiloRelogio: "digital",
  habitoWidget: "",
  listaWidget: "",
  linksWidget: [],
  modoArrasteWidgets: false,
  tamanhoPainelTarefas: null,
  cronometro: { tempoMs: 0, rodando: false, iniciadoEm: null },
  duracoesPomodoro: { focoMinutos: 25, pausaMinutos: 5 },
  pomodoro: { fase: "foco", tempoRestanteMs: 25 * 60 * 1000, rodando: false, iniciadoEm: null },
  timerRegressivo: { titulo: "", dataHora: "" },
  notificacoesLancesXadrez: true,
  tabuleiroXadrez: "verde"
};
let preferenciasUsuario = structuredClone(preferenciasPadrao);

function normalizarPreferencias(preferencias) {
  const origem = preferencias && typeof preferencias === "object" && !Array.isArray(preferencias) ? preferencias : {};
  return {
    layoutWidgets: origem.layoutWidgets && typeof origem.layoutWidgets === "object" && !Array.isArray(origem.layoutWidgets) ? origem.layoutWidgets : {},
    visibilidadeWidgets: origem.visibilidadeWidgets && typeof origem.visibilidadeWidgets === "object" && !Array.isArray(origem.visibilidadeWidgets)
      ? { ...preferenciasPadrao.visibilidadeWidgets, ...origem.visibilidadeWidgets }
      : structuredClone(preferenciasPadrao.visibilidadeWidgets),
    postitsWidgets: Array.isArray(origem.postitsWidgets) ? origem.postitsWidgets : [],
    estiloRelogio: ["digital", "analogico", "minimalista", "flip"].includes(origem.estiloRelogio)
      ? origem.estiloRelogio : preferenciasPadrao.estiloRelogio,
    habitoWidget: typeof origem.habitoWidget === "string" ? origem.habitoWidget : "",
    listaWidget: typeof origem.listaWidget === "string" && /^[a-fA-F0-9]{24}$/.test(origem.listaWidget)
      ? origem.listaWidget : "",
    linksWidget: normalizarLinksWidget(origem.linksWidget),
    modoArrasteWidgets: origem.modoArrasteWidgets === true,
    tamanhoPainelTarefas: origem.tamanhoPainelTarefas && Number.isFinite(origem.tamanhoPainelTarefas.largura) &&
      Number.isFinite(origem.tamanhoPainelTarefas.altura) ? origem.tamanhoPainelTarefas : null,
    duracoesPomodoro: origem.duracoesPomodoro && typeof origem.duracoesPomodoro === "object" &&
      Number.isInteger(origem.duracoesPomodoro.focoMinutos) && origem.duracoesPomodoro.focoMinutos >= 1 &&
      origem.duracoesPomodoro.focoMinutos <= 180 && Number.isInteger(origem.duracoesPomodoro.pausaMinutos) &&
      origem.duracoesPomodoro.pausaMinutos >= 1 && origem.duracoesPomodoro.pausaMinutos <= 180
      ? { focoMinutos: origem.duracoesPomodoro.focoMinutos, pausaMinutos: origem.duracoesPomodoro.pausaMinutos }
      : structuredClone(preferenciasPadrao.duracoesPomodoro),
    cronometro: origem.cronometro && typeof origem.cronometro === "object" &&
      Number.isFinite(origem.cronometro.tempoMs) && origem.cronometro.tempoMs >= 0 &&
      typeof origem.cronometro.rodando === "boolean" &&
      (origem.cronometro.iniciadoEm === null || Number.isFinite(origem.cronometro.iniciadoEm))
      ? { tempoMs: Math.floor(origem.cronometro.tempoMs), rodando: origem.cronometro.rodando, iniciadoEm: origem.cronometro.iniciadoEm }
      : structuredClone(preferenciasPadrao.cronometro),
    pomodoro: origem.pomodoro && typeof origem.pomodoro === "object" &&
      ["foco", "pausa"].includes(origem.pomodoro.fase) && Number.isFinite(origem.pomodoro.tempoRestanteMs) &&
      origem.pomodoro.tempoRestanteMs >= 0 && typeof origem.pomodoro.rodando === "boolean" &&
      (origem.pomodoro.iniciadoEm === null || Number.isFinite(origem.pomodoro.iniciadoEm))
      ? { fase: origem.pomodoro.fase, tempoRestanteMs: Math.floor(origem.pomodoro.tempoRestanteMs), rodando: origem.pomodoro.rodando, iniciadoEm: origem.pomodoro.iniciadoEm }
      : structuredClone(preferenciasPadrao.pomodoro),
    timerRegressivo: origem.timerRegressivo && typeof origem.timerRegressivo === "object" &&
      typeof origem.timerRegressivo.titulo === "string" && origem.timerRegressivo.titulo.length <= 80 &&
      typeof origem.timerRegressivo.dataHora === "string" && dataHoraTimerRegressivoValida(origem.timerRegressivo.dataHora) &&
      origem.timerRegressivo.titulo.trim()
      ? { titulo: origem.timerRegressivo.titulo.trim(), dataHora: origem.timerRegressivo.dataHora }
      : structuredClone(preferenciasPadrao.timerRegressivo),
    notificacoesLancesXadrez: typeof origem.notificacoesLancesXadrez === "boolean"
      ? origem.notificacoesLancesXadrez
      : preferenciasPadrao.notificacoesLancesXadrez,
    tabuleiroXadrez: ["classico", "verde", "madeira"].includes(origem.tabuleiroXadrez)
      ? origem.tabuleiroXadrez
      : preferenciasPadrao.tabuleiroXadrez
  };
}

function dataHoraTimerRegressivoValida(valor) {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor)) return false;
  if (Number(valor.slice(0, 4)) < 1000) return false;
  const data = new Date(`${valor}:00`);
  if (Number.isNaN(data.getTime())) return false;
  const ano = String(data.getFullYear()).padStart(4, "0");
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  const hora = String(data.getHours()).padStart(2, "0");
  const minuto = String(data.getMinutes()).padStart(2, "0");
  return valor === `${ano}-${mes}-${dia}T${hora}:${minuto}`;
}

function urlLinkWidgetValida(valor) {
  if (typeof valor !== "string" || valor.length > 2048) return false;
  try {
    const url = new URL(valor);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function normalizarLinksWidget(links) {
  if (!Array.isArray(links)) return [];
  return links.slice(0, 50).filter(link =>
    link && typeof link === "object" && !Array.isArray(link) &&
    typeof link.titulo === "string" && link.titulo.trim().length > 0 && link.titulo.length <= 80 &&
    urlLinkWidgetValida(link.url)
  ).map(link => ({ titulo: link.titulo.trim(), url: link.url }));
}

function salvarPreferenciasNoServidor() {
  const preferencias = structuredClone(preferenciasUsuario);
  salvamentoLayoutWidgetsEmAndamento = salvamentoLayoutWidgetsEmAndamento
    .catch(() => {})
    .then(async () => {
      const response = await fetch(`/preferencias/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferencias })
      });
      if (!response.ok) {
        const resultado = await response.json().catch(() => ({}));
        throw new Error(resultado.erro || "Nao foi possivel salvar as preferencias.");
      }
    })
    .catch(error => console.warn("Nao foi possivel salvar as preferencias no servidor.", error));
}

function lerLayoutWidgets() {
  return preferenciasUsuario.layoutWidgets;
  try {
    const layout = preferenciasUsuario.layoutWidgets;
    return layout && typeof layout === "object" ? layout : {};
  } catch {
    return {};
  }
}

function salvarLayoutWidgetsNoCache(layout) {
  layoutWidgetsEmMemoria = layout;
  try {
    preferenciasUsuario.layoutWidgets = layout;
  } catch (error) {
    console.warn("Não foi possível atualizar o cache dos widgets.", error);
  }
}

function layoutPossuiWidgets(layout) {
  return layout && typeof layout === "object" && !Array.isArray(layout) && Object.keys(layout).length > 0;
}

function salvarLayoutWidgetsNoServidor(layout) {
  salvamentoLayoutWidgetsEmAndamento = salvamentoLayoutWidgetsEmAndamento
    .catch(() => {})
    .then(async () => {
      const response = await fetch(`/widgets/${encodeURIComponent(userId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout })
      });
      if (!response.ok) {
        const resultado = await response.json().catch(() => ({}));
        throw new Error(resultado.erro || "Não foi possível salvar o layout dos widgets.");
      }
    })
    .catch(error => console.warn("Não foi possível salvar o layout dos widgets no servidor.", error));
}

async function carregarLayoutWidgets() {
  const layoutLocal = lerLayoutWidgets();
  try {
    const response = await fetch(`/preferencias/${encodeURIComponent(userId)}`);
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Não foi possível carregar o layout dos widgets.");

    preferenciasUsuario = normalizarPreferencias(resultado?.preferencias);
    layoutWidgetsEmMemoria = preferenciasUsuario.layoutWidgets;
  } catch (error) {
    console.warn("Usando o layout local dos widgets porque o servidor não respondeu.", error);
    preferenciasUsuario = normalizarPreferencias();
    layoutWidgetsEmMemoria = preferenciasUsuario.layoutWidgets;
  } finally {
    window.orbyChessMoveNotifications = preferenciasUsuario.notificacoesLancesXadrez;
    window.orbyChessBoardTheme = preferenciasUsuario.tabuleiroXadrez;
    document.dispatchEvent(new CustomEvent("orby-chess-preferences-loaded", {
      detail: {
        moveNotifications: preferenciasUsuario.notificacoesLancesXadrez,
        boardTheme: preferenciasUsuario.tabuleiroXadrez
      }
    }));
    layoutWidgetsCarregado = true;
    const seletorRelogio = document.getElementById("widgetRelogioEstilo");
    if (seletorRelogio) seletorRelogio.value = preferenciasUsuario.estiloRelogio;
    const relogio = document.getElementById("widgetRelogio");
    if (relogio) relogio.dataset.clockStyle = preferenciasUsuario.estiloRelogio;
    modoArrasteWidgets = preferenciasUsuario.modoArrasteWidgets;
    document.getElementById("modoArrasteWidgets").checked = modoArrasteWidgets;
    document.getElementById("all").classList.toggle("modoWidgetsAtivo", modoArrasteWidgets);
    aplicarLayoutWidgets();
    renderizarPostitsWidget();
    aplicarVisibilidadeWidgets();
    atualizarWidgetCronometro();
    document.getElementById("widgetPomodoroFocoMinutos").value = preferenciasUsuario.duracoesPomodoro.focoMinutos;
    document.getElementById("widgetPomodoroPausaMinutos").value = preferenciasUsuario.duracoesPomodoro.pausaMinutos;
    atualizarWidgetPomodoro();
    document.getElementById("timerRegressivoTitulo").value = preferenciasUsuario.timerRegressivo.titulo;
    document.getElementById("timerRegressivoDataHora").value = preferenciasUsuario.timerRegressivo.dataHora;
    document.getElementById("timerRegressivoStatus").textContent = preferenciasUsuario.timerRegressivo.titulo
      ? "Edite os campos para substituir o objetivo ou remova a data atual."
      : "Configure um objetivo e uma data. Só é possível manter uma data por vez.";
    atualizarWidgetTimerRegressivo();
    renderizarListaWidgetsImagem();
    aplicarTamanhoSalvoPainelTarefas();
    void carregarListas();
  }
}

document.addEventListener("chess-move-notifications-changed", event => {
  if (typeof event.detail?.enabled !== "boolean") return;
  preferenciasUsuario.notificacoesLancesXadrez = event.detail.enabled;
  window.orbyChessMoveNotifications = event.detail.enabled;
  if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
});

document.addEventListener("chess-board-theme-changed", event => {
  if (!["classico", "verde", "madeira"].includes(event.detail?.theme)) return;
  preferenciasUsuario.tabuleiroXadrez = event.detail.theme;
  window.orbyChessBoardTheme = event.detail.theme;
  if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
});

function widgetsEmTelaPequena() {
  return window.matchMedia("(max-width: 800px)").matches;
}

function lerVisibilidadeWidgets() {
  try {
    const visibilidade = preferenciasUsuario.visibilidadeWidgets;
    return visibilidade && typeof visibilidade === "object" ? visibilidade : {};
  } catch {
    return {};
  }
}

function lerPostitsWidget() {
  try {
    const postits = preferenciasUsuario.postitsWidgets;
    return Array.isArray(postits) ? postits.filter(postit => postit && typeof postit.id === "string") : [];
  } catch {
    return [];
  }
}

function salvarPostitsWidget(postits) {
  try {
    preferenciasUsuario.postitsWidgets = postits;
    if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
  } catch (error) {
    console.warn("Não foi possível salvar os post-its.", error);
  }
}

function atualizarWidgetRelogio() {
  const relogio = document.getElementById("widgetRelogio");
  const horaElemento = document.getElementById("horaWidgetRelogio");
  const dataElemento = document.getElementById("dataWidgetRelogio");
  if (!relogio || !horaElemento || !dataElemento) return;

  const agora = new Date();
  horaElemento.dateTime = agora.toISOString();
  horaElemento.textContent = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(agora);
  dataElemento.textContent = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "2-digit", month: "long"
  }).format(agora);

  const segundos = agora.getSeconds();
  const minutos = agora.getMinutes() + segundos / 60;
  const horas = (agora.getHours() % 12) + minutos / 60;
  relogio.style.setProperty("--clock-hour-angle", `${horas * 30}deg`);
  relogio.style.setProperty("--clock-minute-angle", `${minutos * 6}deg`);
  relogio.style.setProperty("--clock-second-angle", `${segundos * 6}deg`);
}

function renderizarPostitsWidget() {
  const workspace = document.getElementById("widgetsWorkspace");
  if (!workspace) return;
  const existentes = new Set(lerPostitsWidget().map(postit => postit.id));
  workspace.querySelectorAll('[data-widget-id^="postit-"]').forEach(widget => {
    if (!existentes.has(widget.dataset.widgetId)) widget.remove();
  });
  const postits = lerPostitsWidget();
  for (const [indice, postit] of postits.entries()) {
    let widget = workspace.querySelector(`[data-widget-id="${CSS.escape(postit.id)}"]`);
    if (!widget) {
      widget = document.createElement("article");
      widget.className = "workspace-widget postit-workspace-widget";
      widget.dataset.widgetId = postit.id;
      widget.dataset.defaultX = String(300 + (indice % 3) * 250);
      widget.dataset.defaultY = String(590 + Math.floor(indice / 3) * 210);
      const card = document.createElement("article");
      card.className = "postIt postit-card";
      card.style.setProperty("--cor-post", postit.cor || "#fff2a8");
      const handle = document.createElement("button");
      handle.className = "widget-drag-handle postit-widget-drag-handle";
      handle.type = "button";
      handle.setAttribute("aria-label", "Mover post-it");
      handle.title = "Arraste para mover";
      handle.innerHTML = '<i class="bi bi-grip-horizontal" aria-hidden="true"></i>';
      handle.addEventListener("pointerdown", iniciarArrasteWidget);
      handle.addEventListener("keydown", moverWidgetComTeclado);
      const header = document.createElement("div");
      header.className = "cabecalhoPost postit-widget-header";
      const titulo = document.createElement("strong");
      titulo.className = "tituloPost";
      titulo.textContent = postit.titulo || "Post-it";
      const acoes = document.createElement("div");
      acoes.className = "acoesPost postit-widget-actions";
      const editar = document.createElement("button");
      editar.type = "button";
      editar.className = "editarPost";
      editar.setAttribute("aria-label", "Editar post-it");
      editar.title = "Editar post-it";
      editar.innerHTML = '<i class="bi bi-pencil" aria-hidden="true"></i>';
      editar.addEventListener("click", () => abrirEditorPostitWidget(postit.id));
      const excluir = document.createElement("button");
      excluir.type = "button";
      excluir.className = "excluirPost";
      excluir.setAttribute("aria-label", "Excluir post-it");
      excluir.title = "Excluir post-it";
      excluir.innerHTML = '<i class="bi bi-trash" aria-hidden="true"></i>';
      excluir.addEventListener("click", () => {
        salvarPostitsWidget(lerPostitsWidget().filter(item => item.id !== postit.id));
        widget.remove();
        salvarLayoutWidgets();
        atualizarAlturaAreaWidgets();
      });
      acoes.append(editar, excluir);
      header.append(titulo, acoes);
      const descricao = document.createElement("p");
      descricao.className = "descricaoPost";
      descricao.textContent = postit.texto || "";
      card.append(header, descricao, handle);
      widget.appendChild(card);
      workspace.appendChild(widget);
    } else {
      widget.querySelector(".tituloPost").textContent = postit.titulo || "Post-it";
      widget.querySelector(".descricaoPost").textContent = postit.texto || "";
      widget.querySelector(".postIt")?.style.setProperty("--cor-post", postit.cor || "#fff2a8");
    }
  }
  aplicarLayoutWidgets();
  if (workspace.clientWidth) salvarLayoutWidgets();
}

function adicionarPostitWidget() {
  const postits = lerPostitsWidget();
  const id = `postit-${crypto.randomUUID()}`;
  postits.push({ id, titulo: "", texto: "", cor: "#fff2a8" });
  salvarPostitsWidget(postits);
  renderizarPostitsWidget();
}

function abrirEditorPostitWidget(id) {
  const postit = lerPostitsWidget().find(item => item.id === id);
  if (!postit) return;
  document.getElementById("tituloModalPost").textContent = "Editar post-it";
  document.getElementById("inputTituloPost").value = postit.titulo || "";
  document.getElementById("inputDescricaoPost").value = postit.texto || "";
  document.getElementById("inputCorPost").value = postit.cor || "#fff2a8";
  const modal = document.getElementById("modalPost");
  modal.dataset.widgetPostitId = id;
  modal.classList.remove("hidden");
  document.getElementById("inputTituloPost").focus();
}

function fecharEditorPostitWidget() {
  document.getElementById("modalPost").classList.add("hidden");
  delete document.getElementById("modalPost").dataset.widgetPostitId;
}

function salvarVisibilidadeWidget(id, ativo) {
  const visibilidade = lerVisibilidadeWidgets();
  visibilidade[id] = ativo;
  try {
    preferenciasUsuario.visibilidadeWidgets = visibilidade;
    if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
  } catch (error) {
    console.warn("Não foi possível salvar os widgets ativos.", error);
  }
}

function obterTempoCronometro() {
  const cronometro = preferenciasUsuario.cronometro;
  if (!cronometro.rodando || !Number.isFinite(cronometro.iniciadoEm)) return cronometro.tempoMs;
  return Math.max(0, cronometro.tempoMs + Date.now() - cronometro.iniciadoEm);
}

function formatarTempoCronometro(tempoMs) {
  const totalSegundos = Math.floor(tempoMs / 1000);
  const horas = Math.floor(totalSegundos / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);
  const segundos = totalSegundos % 60;
  return [horas, minutos, segundos].map(valor => String(valor).padStart(2, "0")).join(":");
}

function atualizarWidgetCronometro() {
  const tempo = document.getElementById("tempoWidgetCronometro");
  const iniciar = document.getElementById("btnIniciarCronometro");
  const parar = document.getElementById("btnPararCronometro");
  if (!tempo || !iniciar || !parar) return;
  const estado = preferenciasUsuario.cronometro;
  const tempoMs = obterTempoCronometro();
  tempo.textContent = formatarTempoCronometro(tempoMs);
  tempo.dateTime = `PT${Math.floor(tempoMs / 1000)}S`;
  iniciar.disabled = estado.rodando;
  parar.disabled = !estado.rodando;
}

function iniciarCronometro() {
  const estado = preferenciasUsuario.cronometro;
  if (estado.rodando) return;
  estado.iniciadoEm = Date.now();
  estado.rodando = true;
  salvarPreferenciasNoServidor();
  atualizarWidgetCronometro();
}

function pararCronometro() {
  const estado = preferenciasUsuario.cronometro;
  if (!estado.rodando) return;
  estado.tempoMs = Math.floor(obterTempoCronometro());
  estado.iniciadoEm = null;
  estado.rodando = false;
  salvarPreferenciasNoServidor();
  atualizarWidgetCronometro();
}

function reiniciarCronometro() {
  const estado = preferenciasUsuario.cronometro;
  estado.tempoMs = 0;
  estado.iniciadoEm = null;
  estado.rodando = false;
  salvarPreferenciasNoServidor();
  atualizarWidgetCronometro();
}

function obterTempoRestantePomodoro() {
  const pomodoro = preferenciasUsuario.pomodoro;
  if (!pomodoro.rodando || !Number.isFinite(pomodoro.iniciadoEm)) return pomodoro.tempoRestanteMs;
  return Math.max(0, pomodoro.tempoRestanteMs - (Date.now() - pomodoro.iniciadoEm));
}

function formatarTempoPomodoro(tempoMs) {
  const totalSegundos = Math.ceil(tempoMs / 1000);
  const minutos = Math.floor(totalSegundos / 60);
  const segundos = totalSegundos % 60;
  return `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
}

function obterDuracaoPomodoroMs(fase) {
  const duracoes = preferenciasUsuario.duracoesPomodoro;
  const minutos = fase === "foco" ? duracoes.focoMinutos : duracoes.pausaMinutos;
  return minutos * 60 * 1000;
}

function prepararAudioPomodoro() {
  if (!window.AudioContext) return Promise.resolve(false);
  if (!contextoAudioPomodoro) contextoAudioPomodoro = new window.AudioContext();
  if (contextoAudioPomodoro.state === "suspended") {
    return contextoAudioPomodoro.resume()
      .then(() => contextoAudioPomodoro.state === "running")
      .catch(error => {
        console.warn("Não foi possível ativar o som do Pomodoro.", error);
        return false;
      });
  }
  return Promise.resolve(contextoAudioPomodoro.state === "running");
}

function emitirSomPomodoro() {
  void prepararAudioPomodoro().then(audioAtivo => {
    if (!audioAtivo) return;

    const agora = contextoAudioPomodoro.currentTime;
    const oscilador = contextoAudioPomodoro.createOscillator();
    const volume = contextoAudioPomodoro.createGain();
    oscilador.type = "sine";
    oscilador.frequency.setValueAtTime(660, agora);
    volume.gain.setValueAtTime(0.12, agora);
    volume.gain.exponentialRampToValueAtTime(0.001, agora + 0.2);
    oscilador.connect(volume);
    volume.connect(contextoAudioPomodoro.destination);
    oscilador.start(agora);
    oscilador.stop(agora + 0.2);
  });
}

function atualizarWidgetPomodoro() {
  const tempo = document.getElementById("tempoWidgetPomodoro");
  const fase = document.getElementById("faseWidgetPomodoro");
  const iniciar = document.getElementById("btnIniciarPomodoro");
  const pausar = document.getElementById("btnPausarPomodoro");
  if (!tempo || !fase || !iniciar || !pausar) return;
  const estado = preferenciasUsuario.pomodoro;
  const restante = obterTempoRestantePomodoro();
  if (estado.rodando && restante === 0) {
    const iniciouPausa = estado.fase === "foco";
    estado.fase = iniciouPausa ? "pausa" : "foco";
    estado.tempoRestanteMs = obterDuracaoPomodoroMs(estado.fase);
    estado.iniciadoEm = iniciouPausa ? Date.now() : null;
    estado.rodando = iniciouPausa;
    if (iniciouPausa) emitirSomPomodoro();
    salvarPreferenciasNoServidor();
  }
  document.getElementById("widgetPomodoro")?.classList.toggle("pomodoro-pausa", estado.fase === "pausa");
  const tempoAtual = estado.rodando ? obterTempoRestantePomodoro() : estado.tempoRestanteMs;
  tempo.textContent = formatarTempoPomodoro(tempoAtual);
  tempo.dateTime = `PT${Math.ceil(tempoAtual / 1000)}S`;
  const nomeFase = estado.fase === "foco" ? "Foco" : "Pausa";
  const duracaoFase = preferenciasUsuario.duracoesPomodoro[estado.fase === "foco" ? "focoMinutos" : "pausaMinutos"];
  fase.textContent = `${nomeFase} · ${duracaoFase} min`;
  iniciar.disabled = estado.rodando;
  pausar.disabled = !estado.rodando;
}

function iniciarPomodoro() {
  const estado = preferenciasUsuario.pomodoro;
  if (estado.rodando) return;
  void prepararAudioPomodoro();
  estado.iniciadoEm = Date.now();
  estado.rodando = true;
  salvarPreferenciasNoServidor();
  atualizarWidgetPomodoro();
}

function pausarPomodoro() {
  const estado = preferenciasUsuario.pomodoro;
  if (!estado.rodando) return;
  estado.tempoRestanteMs = Math.ceil(obterTempoRestantePomodoro());
  estado.iniciadoEm = null;
  estado.rodando = false;
  salvarPreferenciasNoServidor();
  atualizarWidgetPomodoro();
}

function reiniciarPomodoro() {
  preferenciasUsuario.pomodoro = {
    fase: "foco",
    tempoRestanteMs: obterDuracaoPomodoroMs("foco"),
    rodando: false,
    iniciadoEm: null
  };
  salvarPreferenciasNoServidor();
  atualizarWidgetPomodoro();
}

function aplicarVisibilidadeWidgets() {
  const visibilidade = lerVisibilidadeWidgets();
  const controles = {
    calendar: document.getElementById("widgetCalendarioAtivo"),
    weather: document.getElementById("widgetTempoAtivo"),
    message: document.getElementById("widgetMensagemAtivo"),
    "important-tasks": document.getElementById("widgetTarefasImportantesAtivo"),
    list: document.getElementById("widgetListaAtivo"),
    habit: document.getElementById("widgetHabitoAtivo"),
    clock: document.getElementById("widgetRelogioAtivo"),
    stopwatch: document.getElementById("widgetCronometroAtivo"),
    pomodoro: document.getElementById("widgetPomodoroAtivo"),
    "timer-regressivo": document.getElementById("widgetTimerRegressivoAtivo"),
    utilidades: document.getElementById("widgetUtilidadesAtivo"),
    links: document.getElementById("widgetLinksAtivo"),
    chess: document.getElementById("widgetXadrezAtivo"),
    "orb-ia": document.getElementById("widgetOrbIaAtivo")
  };
  Object.entries(controles).forEach(([id, controle]) => {
    if (controle) controle.checked = visibilidade[id] !== false;
  });
  document.querySelectorAll("#widgetsWorkspace .workspace-widget").forEach(widget => {
    widget.hidden = visibilidade[widget.dataset.widgetId] === false;
  });
  const mensagem = document.getElementById("mensagemWidget");
  if (mensagem) mensagem.hidden = visibilidade.message === false;
  const tarefasImportantesWidget = document.getElementById("widgetTarefasImportantes");
  if (tarefasImportantesWidget) tarefasImportantesWidget.hidden = visibilidade["important-tasks"] === false;
  const habitoWidget = document.querySelector('#widgetsWorkspace [data-widget-id="habit"]');
  if (habitoWidget) habitoWidget.hidden = visibilidade.habit === false;
  atualizarAlturaAreaWidgets();
}

function alterarVisibilidadeWidget(id, ativo) {
  salvarVisibilidadeWidget(id, ativo);
  if (id === "links" && !ativo) alternarPainelLinks(false);
  if (id === "message") {
    const mensagem = document.getElementById("mensagemWidget");
    if (mensagem) mensagem.hidden = !ativo;
    atualizarAlturaAreaWidgets();
    return;
  }
  if (id === "important-tasks") {
    const tarefasImportantesWidget = document.getElementById("widgetTarefasImportantes");
    if (tarefasImportantesWidget) tarefasImportantesWidget.hidden = !ativo;
    return;
  }
  if (id === "habit") {
    void atualizarWidgetHabito();
    return;
  }
  const widget = [...document.querySelectorAll("#widgetsWorkspace .workspace-widget")]
    .find(item => item.dataset.widgetId === id);
  if (widget) widget.hidden = !ativo;
  atualizarAlturaAreaWidgets();
}

function atualizarWidgetTimerRegressivo() {
  const nome = document.getElementById("timerRegressivoNome");
  const rotulo = document.getElementById("timerRegressivoRotulo");
  const contagem = document.getElementById("timerRegressivoContagem");
  const dataFormatada = document.getElementById("timerRegressivoDataFormatada");
  if (!nome || !rotulo || !contagem || !dataFormatada) return;

  const { titulo, dataHora } = preferenciasUsuario.timerRegressivo;
  nome.textContent = titulo || "Seu objetivo";
  if (!titulo || !dataHora || !dataHoraTimerRegressivoValida(dataHora)) {
    rotulo.textContent = "Configure uma data";
    contagem.textContent = "Aguardando objetivo";
    contagem.classList.add("timer-regressivo-widget-time-vazio");
    dataFormatada.textContent = "";
    contagem.removeAttribute("datetime");
    return;
  }
  contagem.classList.remove("timer-regressivo-widget-time-vazio");

  const alvo = new Date(`${dataHora}:00`);
  const diferenca = alvo.getTime() - Date.now();
  rotulo.textContent = diferenca > 0 ? "Faltam" : "Chegou o momento";
  contagem.dateTime = alvo.toISOString();
  dataFormatada.textContent = alvo.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
  if (diferenca <= 0) {
    contagem.textContent = "Objetivo alcançado!";
    return;
  }

  const segundosRestantes = Math.floor(diferenca / 1000);
  const dias = Math.floor(segundosRestantes / 86400);
  const horas = Math.floor((segundosRestantes % 86400) / 3600);
  const minutos = Math.floor((segundosRestantes % 3600) / 60);
  const segundos = segundosRestantes % 60;
  const horario = [horas, minutos, segundos].map(valor => String(valor).padStart(2, "0")).join(":");
  contagem.textContent = dias > 0 ? `${dias} ${dias === 1 ? "dia" : "dias"} · ${horario}` : horario;
}

function salvarTimerRegressivo() {
  const campoTitulo = document.getElementById("timerRegressivoTitulo");
  const campoDataHora = document.getElementById("timerRegressivoDataHora");
  const status = document.getElementById("timerRegressivoStatus");
  const titulo = campoTitulo.value.trim();
  if (!campoTitulo.checkValidity() || !titulo || !campoDataHora.checkValidity() ||
      !dataHoraTimerRegressivoValida(campoDataHora.value)) {
    if (!titulo) campoTitulo.setCustomValidity("Informe o nome do objetivo.");
    campoTitulo.reportValidity();
    campoTitulo.setCustomValidity("");
    if (titulo && !dataHoraTimerRegressivoValida(campoDataHora.value)) campoDataHora.reportValidity();
    status.textContent = "Informe um objetivo e uma data/hora válida.";
    return;
  }

  preferenciasUsuario.timerRegressivo = { titulo, dataHora: campoDataHora.value };
  salvarPreferenciasNoServidor();
  atualizarWidgetTimerRegressivo();
  status.textContent = "Data salva.";
}

function removerTimerRegressivo() {
  preferenciasUsuario.timerRegressivo = structuredClone(preferenciasPadrao.timerRegressivo);
  document.getElementById("timerRegressivoTitulo").value = "";
  document.getElementById("timerRegressivoDataHora").value = "";
  document.getElementById("timerRegressivoStatus").textContent = "Timer regressivo removido.";
  salvarPreferenciasNoServidor();
  atualizarWidgetTimerRegressivo();
}

const estadoCalculadora = {
  display: "0",
  valorAnterior: null,
  operador: null,
  aguardandoOperando: false
};

function renderizarVisorCalculadora() {
  const visor = document.getElementById("calculadoraVisor");
  const expressao = document.getElementById("calculadoraExpressao");
  if (visor) visor.textContent = estadoCalculadora.display;
  if (expressao) {
    expressao.textContent = estadoCalculadora.operador && estadoCalculadora.valorAnterior !== null
      ? `${estadoCalculadora.valorAnterior} ${estadoCalculadora.operador}`
      : "";
  }
}

function formatarNumeroCalculadora(valor) {
  if (!Number.isFinite(valor)) {
    estadoCalculadora.display = "Erro";
    estadoCalculadora.valorAnterior = null;
    estadoCalculadora.operador = null;
    estadoCalculadora.aguardandoOperando = true;
    renderizarVisorCalculadora();
    return;
  }
  estadoCalculadora.display = String(Number(valor.toPrecision(12)));
}

function digitarCalculadora(valor) {
  if (estadoCalculadora.aguardandoOperando || estadoCalculadora.display === "Erro") {
    estadoCalculadora.display = valor === "." ? "0." : valor;
    estadoCalculadora.aguardandoOperando = false;
  } else if (valor === ".") {
    if (!estadoCalculadora.display.includes(".")) estadoCalculadora.display += ".";
  } else if (estadoCalculadora.display === "0") {
    estadoCalculadora.display = valor;
  } else {
    estadoCalculadora.display += valor;
  }
  renderizarVisorCalculadora();
}

function calcularResultado(a, b, operador) {
  switch (operador) {
    case "+": return a + b;
    case "−": return a - b;
    case "×": return a * b;
    case "÷": return b === 0 ? NaN : a / b;
    default: return b;
  }
}

function escolherOperadorCalculadora(operador) {
  const atual = Number(estadoCalculadora.display);
  if (!Number.isFinite(atual)) {
    limparCalculadora();
    return;
  }
  if (estadoCalculadora.operador && !estadoCalculadora.aguardandoOperando) {
    formatarNumeroCalculadora(calcularResultado(estadoCalculadora.valorAnterior, atual, estadoCalculadora.operador));
    if (estadoCalculadora.display === "Erro") return;
    estadoCalculadora.valorAnterior = Number(estadoCalculadora.display);
  } else if (estadoCalculadora.valorAnterior === null || !estadoCalculadora.aguardandoOperando) {
    estadoCalculadora.valorAnterior = atual;
  }
  estadoCalculadora.operador = operador;
  estadoCalculadora.aguardandoOperando = true;
  renderizarVisorCalculadora();
}

function igualCalculadora() {
  if (!estadoCalculadora.operador || estadoCalculadora.valorAnterior === null) return;
  const atual = Number(estadoCalculadora.display);
  const resultado = calcularResultado(estadoCalculadora.valorAnterior, atual, estadoCalculadora.operador);
  formatarNumeroCalculadora(resultado);
  estadoCalculadora.valorAnterior = null;
  estadoCalculadora.operador = null;
  estadoCalculadora.aguardandoOperando = true;
  renderizarVisorCalculadora();
}

function limparCalculadora() {
  estadoCalculadora.display = "0";
  estadoCalculadora.valorAnterior = null;
  estadoCalculadora.operador = null;
  estadoCalculadora.aguardandoOperando = false;
  renderizarVisorCalculadora();
}

function aplicarAcaoCalculadora(acao) {
  if (acao === "limpar") {
    limparCalculadora();
  } else if (acao === "igual") {
    igualCalculadora();
  } else if (acao === "decimal") {
    digitarCalculadora(".");
  } else if (acao === "sinal" && estadoCalculadora.display !== "0" && estadoCalculadora.display !== "Erro") {
    estadoCalculadora.display = String(-Number(estadoCalculadora.display));
    renderizarVisorCalculadora();
  } else if (acao === "porcentagem" && estadoCalculadora.display !== "Erro") {
    formatarNumeroCalculadora(Number(estadoCalculadora.display) / 100);
    renderizarVisorCalculadora();
  } else if (acao === "apagar" && !estadoCalculadora.aguardandoOperando) {
    estadoCalculadora.display = estadoCalculadora.display.length > 1
      ? estadoCalculadora.display.slice(0, -1)
      : "0";
    if (estadoCalculadora.display === "-") estadoCalculadora.display = "0";
    renderizarVisorCalculadora();
  }
}

function selecionarUtilidade(utilidade) {
  const abaAtiva = document.querySelector(`[data-utilidade-aba="${utilidade}"]`);
  if (!abaAtiva) return;
  document.querySelectorAll("[data-utilidade-aba]").forEach(aba => {
    const selecionada = aba === abaAtiva;
    aba.setAttribute("aria-selected", String(selecionada));
    aba.tabIndex = selecionada ? 0 : -1;
  });
  document.querySelectorAll("[data-utilidade-painel]").forEach(painel => {
    painel.hidden = painel.dataset.utilidadePainel !== utilidade;
  });
}

function sortearInteiroAte(limite) {
  const espaco = 1n << 53n;
  const limiteBigInt = BigInt(limite);
  const tetoAceito = espaco - (espaco % limiteBigInt);
  const buffer = new Uint32Array(2);
  let amostra;
  do {
    crypto.getRandomValues(buffer);
    amostra = (BigInt(buffer[0] & 0x1fffff) << 32n) | BigInt(buffer[1]);
  } while (amostra >= tetoAceito);
  return Number((amostra % limiteBigInt) + 1n);
}

function gerarNumeroAleatorioUtilidades() {
  const campo = document.getElementById("numeroAleatorioLimite");
  const resultado = document.getElementById("numeroAleatorioResultado");
  const status = document.getElementById("numeroAleatorioStatus");
  const botaoGerar = document.getElementById("gerarNumeroAleatorio");
  const palco = document.getElementById("numeroAleatorioPalco");
  if (botaoGerar.disabled) return;
  const limite = Number(campo.value);
  if (!campo.checkValidity() || !Number.isSafeInteger(limite) || limite < 1) {
    campo.reportValidity();
    resultado.textContent = "?";
    status.textContent = "Informe um limite inteiro válido.";
    return;
  }
  try {
    const sorteado = sortearInteiroAte(limite);
    const icone = document.querySelector(".utilidades-aleatorio-dado");
    const iconeClasse = Number(limite) === 4 ? "bi-dice-4"
      : Number(limite) === 6 || Number(limite) === 100 ? "bi-dice-6"
        : Number(limite) === 8 ? "bi-dice-5"
          : Number(limite) === 10 ? "bi-dice-2"
            : Number(limite) === 12 ? "bi-dice-3"
              : Number(limite) === 20 ? "bi-dice-1"
                : "bi-dice-5";
    icone.className = `bi ${iconeClasse} utilidades-aleatorio-dado`;
    resultado.textContent = String(sortearInteiroAte(limite));
    palco.classList.remove("rolando");
    void palco.offsetWidth;
    palco.classList.add("rolando");
    botaoGerar.classList.add("rolando");
    botaoGerar.disabled = true;
    campo.disabled = true;
    document.querySelectorAll("[data-dado-rpg]").forEach(botao => { botao.disabled = true; });
    status.textContent = "Rolando...";

    const intervalo = window.setInterval(() => {
      resultado.textContent = String(sortearInteiroAte(limite));
    }, 65);
    window.setTimeout(() => {
      window.clearInterval(intervalo);
      resultado.textContent = String(sorteado);
      palco.classList.remove("rolando");
      botaoGerar.classList.remove("rolando");
      botaoGerar.disabled = false;
      campo.disabled = false;
      document.querySelectorAll("[data-dado-rpg]").forEach(botao => { botao.disabled = false; });
      status.textContent = `Resultado entre 1 e ${limite}.`;
    }, 720);
  } catch (error) {
    console.error("Não foi possível sortear um número aleatório:", error);
    resultado.textContent = "?";
    status.textContent = "Não foi possível gerar o número.";
  }
}

function posicionarCalculadora() {
  const widget = document.querySelector('[data-widget-id="utilidades"]');
  const launcher = document.getElementById("widgetUtilidadesAbrir");
  const calculadora = document.getElementById("widgetCalculadora");
  if (!widget || !launcher || !calculadora || calculadora.hidden) return;

  const margem = 12;
  const espacamento = 8;
  const retangulo = launcher.getBoundingClientRect();
  const largura = calculadora.offsetWidth;
  const altura = calculadora.offsetHeight;
  const left = Math.min(retangulo.left - largura - espacamento, window.innerWidth - largura - margem);
  const top = Math.min(
    Math.max(margem, retangulo.top),
    Math.max(margem, window.innerHeight - altura - margem)
  );
  calculadora.style.left = `${left}px`;
  calculadora.style.top = `${top}px`;
}

function alternarCalculadora(abrir) {
  const launcher = document.getElementById("widgetUtilidadesAbrir");
  const calculadora = document.getElementById("widgetCalculadora");
  if (!launcher || !calculadora) return;
  const aberta = abrir ?? calculadora.hidden;
  calculadora.hidden = !aberta;
  launcher.setAttribute("aria-expanded", String(aberta));
  if (aberta) posicionarCalculadora();
}

function inicializarCalculadora() {
  const widget = document.querySelector('[data-widget-id="utilidades"]');
  const launcher = document.getElementById("widgetUtilidadesAbrir");
  const calculadora = document.getElementById("widgetCalculadora");
  if (!widget || !launcher || !calculadora) return;
  document.body.appendChild(calculadora);

  let ignorarProximoClique = false;
  launcher.addEventListener("pointerdown", iniciarArrasteWidget);
  launcher.addEventListener("keydown", moverWidgetComTeclado);
  launcher.addEventListener("pointerup", () => {
    ignorarProximoClique = Boolean(arrasteWidget?.handle === launcher && arrasteWidget.moveu);
  });
  launcher.addEventListener("click", event => {
    if (ignorarProximoClique) {
      ignorarProximoClique = false;
      event.preventDefault();
      return;
    }
    alternarCalculadora();
  });
  document.querySelectorAll("[data-utilidade-aba]").forEach(aba => {
    aba.addEventListener("click", () => selecionarUtilidade(aba.dataset.utilidadeAba));
  });
  document.getElementById("widgetCalculadoraFechar").addEventListener("click", () => alternarCalculadora(false));
  document.getElementById("gerarNumeroAleatorio").addEventListener("click", gerarNumeroAleatorioUtilidades);
  document.querySelectorAll("[data-dado-rpg]").forEach(botao => {
    botao.addEventListener("click", () => {
      document.querySelectorAll("[data-dado-rpg]").forEach(outro => {
        outro.setAttribute("aria-pressed", String(outro === botao));
      });
      document.getElementById("numeroAleatorioLimite").value = botao.dataset.dadoRpg;
      gerarNumeroAleatorioUtilidades();
    });
  });
  document.getElementById("numeroAleatorioLimite").addEventListener("input", () => {
    document.querySelectorAll("[data-dado-rpg]").forEach(botao => botao.setAttribute("aria-pressed", "false"));
  });
  calculadora.addEventListener("click", event => {
    const botao = event.target.closest("button");
    if (!botao) return;
    if (botao.dataset.calculadoraDigito !== undefined) digitarCalculadora(botao.dataset.calculadoraDigito);
    if (botao.dataset.calculadoraOperador) escolherOperadorCalculadora(botao.dataset.calculadoraOperador);
    if (botao.dataset.calculadoraAcao) aplicarAcaoCalculadora(botao.dataset.calculadoraAcao);
  });
  document.addEventListener("keydown", event => {
    if (calculadora.hidden) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    const painelCalculadora = document.getElementById("painelCalculadora");
    if (painelCalculadora.hidden && event.key !== "Escape") return;
    if (/^\d$/.test(event.key)) digitarCalculadora(event.key);
    else if (event.key === "." || event.key === ",") digitarCalculadora(".");
    else if (["+", "-", "*", "/"].includes(event.key)) {
      escolherOperadorCalculadora(({ "-": "−", "*": "×", "/": "÷" })[event.key] || event.key);
    } else if (event.key === "Enter" || event.key === "=") igualCalculadora();
    else if (event.key === "Escape") alternarCalculadora(false);
    else if (event.key === "Backspace") aplicarAcaoCalculadora("apagar");
    else if (event.key === "%") aplicarAcaoCalculadora("porcentagem");
    else return;
    event.preventDefault();
  });
  document.addEventListener("pointerdown", event => {
    if (!calculadora.hidden && !widget.contains(event.target) && !calculadora.contains(event.target)) {
      alternarCalculadora(false);
    }
  });
  window.addEventListener("resize", posicionarCalculadora);
  window.addEventListener("scroll", posicionarCalculadora, true);
}

function posicionarPainelLinks() {
  const launcher = document.getElementById("widgetLinksAbrir");
  const painel = document.getElementById("widgetLinksPainel");
  if (!launcher || !painel || painel.hidden) return;
  const margem = 12;
  const retangulo = launcher.getBoundingClientRect();
  const largura = painel.offsetWidth;
  const altura = painel.offsetHeight;
  let left = retangulo.left - largura - 8;
  if (left < margem) left = Math.min(retangulo.right + 8, window.innerWidth - largura - margem);
  painel.style.left = `${Math.max(margem, left)}px`;
  painel.style.top = `${Math.min(Math.max(margem, retangulo.top), Math.max(margem, window.innerHeight - altura - margem))}px`;
}

function alternarPainelLinks(abrir) {
  const launcher = document.getElementById("widgetLinksAbrir");
  const painel = document.getElementById("widgetLinksPainel");
  if (!launcher || !painel) return;
  const aberto = abrir ?? painel.hidden;
  painel.hidden = !aberto;
  launcher.setAttribute("aria-expanded", String(aberto));
  if (aberto) {
    renderizarLinksWidget();
    posicionarPainelLinks();
    document.getElementById("widgetLinksAdicionar").focus();
  } else {
    alternarFormularioLinks(false);
    launcher.focus();
  }
}

function alternarFormularioLinks(abrir) {
  const formulario = document.getElementById("widgetLinksForm");
  const botao = document.getElementById("widgetLinksAdicionar");
  if (!formulario || !botao) return;
  const aberto = abrir ?? formulario.hidden;
  formulario.hidden = !aberto;
  botao.setAttribute("aria-expanded", String(aberto));
  if (aberto) {
    document.getElementById("widgetLinksNome").focus();
    posicionarPainelLinks();
  } else {
    formulario.reset();
    botao.focus();
    posicionarPainelLinks();
  }
}

function renderizarLinksWidget() {
  const lista = document.getElementById("widgetLinksLista");
  const status = document.getElementById("widgetLinksStatus");
  if (!lista || !status) return;
  lista.replaceChildren();
  const links = preferenciasUsuario.linksWidget;
  status.textContent = links.length
    ? `${links.length} ${links.length === 1 ? "link salvo" : "links salvos"}`
    : "Seus links salvos aparecerão aqui.";
  links.forEach((link, indice) => {
    const linha = document.createElement("li");
    linha.className = "links-widget-item";
    const ancora = document.createElement("a");
    ancora.href = link.url;
    ancora.target = "_blank";
    ancora.rel = "noopener noreferrer";
    ancora.title = link.url;
    const icone = document.createElement("i");
    icone.className = "bi bi-box-arrow-up-right";
    icone.setAttribute("aria-hidden", "true");
    const nome = document.createElement("span");
    nome.textContent = link.titulo;
    const detalhes = document.createElement("span");
    detalhes.className = "links-widget-item-details";
    const endereco = document.createElement("small");
    endereco.textContent = new URL(link.url).hostname;
    detalhes.append(nome, endereco);
    ancora.append(icone, detalhes);
    const remover = document.createElement("button");
    remover.type = "button";
    remover.className = "links-widget-remove";
    remover.dataset.linkIndex = String(indice);
    remover.setAttribute("aria-label", `Remover link ${link.titulo}`);
    remover.title = "Remover link";
    remover.innerHTML = '<i class="bi bi-trash3" aria-hidden="true"></i>';
    linha.append(ancora, remover);
    lista.append(linha);
  });
}

function inicializarWidgetLinks() {
  const widget = document.querySelector('[data-widget-id="links"]');
  const launcher = document.getElementById("widgetLinksAbrir");
  const painel = document.getElementById("widgetLinksPainel");
  const formulario = document.getElementById("widgetLinksForm");
  const adicionar = document.getElementById("widgetLinksAdicionar");
  const nome = document.getElementById("widgetLinksNome");
  const url = document.getElementById("widgetLinksUrl");
  if (!widget || !launcher || !painel || !formulario || !adicionar || !nome || !url) return;
  document.body.appendChild(painel);
  renderizarLinksWidget();

  let ignorarProximoClique = false;
  launcher.addEventListener("pointerdown", iniciarArrasteWidget);
  launcher.addEventListener("keydown", moverWidgetComTeclado);
  launcher.addEventListener("pointerup", () => {
    ignorarProximoClique = Boolean(arrasteWidget?.handle === launcher && arrasteWidget.moveu);
  });
  launcher.addEventListener("click", event => {
    if (ignorarProximoClique) {
      ignorarProximoClique = false;
      event.preventDefault();
      return;
    }
    alternarPainelLinks();
  });
  adicionar.addEventListener("click", () => alternarFormularioLinks());
  document.getElementById("widgetLinksCancelar").addEventListener("click", () => alternarFormularioLinks(false));
  document.getElementById("widgetLinksFechar").addEventListener("click", () => alternarPainelLinks(false));
  formulario.addEventListener("submit", event => {
    event.preventDefault();
    if (!formulario.reportValidity()) return;
    const titulo = nome.value.trim();
    if (!titulo) {
      nome.setCustomValidity("Informe um nome para o link.");
      nome.reportValidity();
      nome.setCustomValidity("");
      return;
    }
    const endereco = url.value.trim();
    if (!urlLinkWidgetValida(endereco)) {
      url.setCustomValidity("Informe um endereço HTTP ou HTTPS válido, sem usuário ou senha.");
      url.reportValidity();
      url.setCustomValidity("");
      return;
    }
    if (preferenciasUsuario.linksWidget.length >= 50) {
      document.getElementById("widgetLinksStatus").textContent = "O limite de 50 links foi atingido.";
      return;
    }
    preferenciasUsuario.linksWidget.push({ titulo, url: endereco });
    salvarPreferenciasNoServidor();
    renderizarLinksWidget();
    alternarFormularioLinks(false);
    posicionarPainelLinks();
  });
  document.getElementById("widgetLinksLista").addEventListener("click", event => {
    const remover = event.target.closest(".links-widget-remove");
    if (!remover) return;
    preferenciasUsuario.linksWidget.splice(Number(remover.dataset.linkIndex), 1);
    salvarPreferenciasNoServidor();
    renderizarLinksWidget();
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || painel.hidden) return;
    if (!formulario.hidden) alternarFormularioLinks(false);
    else alternarPainelLinks(false);
  });
  document.addEventListener("pointerdown", event => {
    if (!painel.hidden && !widget.contains(event.target) && !painel.contains(event.target)) {
      alternarPainelLinks(false);
    }
  });
  window.addEventListener("resize", posicionarPainelLinks);
  window.addEventListener("scroll", posicionarPainelLinks, true);
}

function inicializarWidgetOrbIa() {
  const formularioConfiguracao = document.getElementById("orbIaConfig");
  const formularioChat = document.getElementById("orbIaChatForm");
  const campoChave = document.getElementById("orbIaApiKey");
  const campoMensagem = document.getElementById("orbIaChatInput");
  const mensagensElemento = document.getElementById("orbIaMessages");
  const status = document.getElementById("orbIaStatus");
  const botaoRemoverChave = document.getElementById("orbIaRemoveKey");
  const widgetOrbIa = document.querySelector('#widgetsWorkspace [data-widget-id="orb-ia"]');
  const cartaoOrbIa = widgetOrbIa?.querySelector(".orb-ia-card");
  const alcaRedimensionar = cartaoOrbIa?.querySelector(".orb-ia-resize-handle");
  const conversacao = [];
  let chaveConfigurada = false;
  let enviando = false;
  if (!formularioConfiguracao || !formularioChat) return;

  let redimensionamento = null;
  const limitarTamanho = (largura, altura) => {
    const limiteLargura = widgetsEmTelaPequena()
      ? Math.min(440, window.innerWidth - 36)
      : Math.min(680, window.innerWidth - 36);
    const limiteAltura = Math.min(800, window.innerHeight - 32);
    const larguraMinima = Math.min(280, Math.max(180, limiteLargura));
    const alturaMinima = Math.min(240, Math.max(160, limiteAltura));
    return {
      largura: Math.round(Math.min(limiteLargura, Math.max(larguraMinima, largura))),
      altura: Math.round(Math.min(limiteAltura, Math.max(alturaMinima, altura)))
    };
  };
  const aplicarTamanho = (largura, altura) => {
    if (!cartaoOrbIa || !widgetOrbIa) return;
    const tamanho = limitarTamanho(largura, altura);
    cartaoOrbIa.style.width = `${tamanho.largura}px`;
    cartaoOrbIa.style.height = `${tamanho.altura}px`;
    if (!widgetsEmTelaPequena()) {
      definirPosicaoWidget(widgetOrbIa, widgetOrbIa.offsetLeft, widgetOrbIa.offsetTop);
    }
    return tamanho;
  };
  const salvarTamanho = () => {
    if (!cartaoOrbIa) return;
    const largura = Math.round(cartaoOrbIa.getBoundingClientRect().width);
    const altura = Math.round(cartaoOrbIa.getBoundingClientRect().height);
    aplicarTamanho(largura, altura);
    salvarLayoutWidgets();
  };

  alcaRedimensionar?.addEventListener("pointerdown", event => {
    if (event.button !== 0 || !event.isPrimary || !cartaoOrbIa) return;
    const dimensoes = cartaoOrbIa.getBoundingClientRect();
    redimensionamento = {
      pointerId: event.pointerId,
      inicioX: event.clientX,
      inicioY: event.clientY,
      largura: dimensoes.width,
      altura: dimensoes.height
    };
    alcaRedimensionar.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  alcaRedimensionar?.addEventListener("keydown", event => {
    const dimensoes = cartaoOrbIa?.getBoundingClientRect();
    if (!dimensoes) return;
    const passo = event.shiftKey ? 48 : 20;
    let largura = dimensoes.width;
    let altura = dimensoes.height;
    if (event.key === "ArrowLeft") largura -= passo;
    else if (event.key === "ArrowRight") largura += passo;
    else if (event.key === "ArrowUp") altura -= passo;
    else if (event.key === "ArrowDown") altura += passo;
    else return;
    event.preventDefault();
    aplicarTamanho(largura, altura);
    salvarLayoutWidgets();
  });
  document.addEventListener("pointermove", event => {
    if (!redimensionamento || event.pointerId !== redimensionamento.pointerId) return;
    aplicarTamanho(
      redimensionamento.largura + event.clientX - redimensionamento.inicioX,
      redimensionamento.altura + event.clientY - redimensionamento.inicioY
    );
    event.preventDefault();
  });
  const finalizarRedimensionamento = event => {
    if (!redimensionamento || event.pointerId !== redimensionamento.pointerId) return;
    redimensionamento = null;
    salvarTamanho();
    if (alcaRedimensionar.hasPointerCapture(event.pointerId)) {
      alcaRedimensionar.releasePointerCapture(event.pointerId);
    }
  };
  document.addEventListener("pointerup", finalizarRedimensionamento);
  document.addEventListener("pointercancel", finalizarRedimensionamento);

  const renderizarMensagem = (papel, texto, classeExtra = "") => {
    const mensagem = document.createElement("li");
    mensagem.className = `orb-ia-message orb-ia-message-${papel} ${classeExtra}`.trim();
    mensagem.textContent = texto;
    mensagensElemento.append(mensagem);
    mensagensElemento.scrollTop = mensagensElemento.scrollHeight;
    document.getElementById("orbIaEmpty").hidden = true;
    return mensagem;
  };
  const atualizarDisponibilidadeChat = () => {
    campoMensagem.disabled = !chaveConfigurada || enviando;
  };
  const limparStatus = () => {
    status.textContent = "";
    status.hidden = true;
    status.classList.remove("erro");
  };
  const mostrarErro = mensagem => {
    status.textContent = mensagem;
    status.hidden = false;
    status.classList.add("erro");
  };
  const animarResposta = (mensagem, texto) => new Promise(resolve => {
    mensagem.classList.remove("orb-ia-message-loading");
    mensagem.classList.add("orb-ia-message-reveal");
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      mensagem.textContent = texto;
      resolve();
      return;
    }

    const caracteres = Array.from(texto);
    const duracao = Math.min(520, Math.max(180, caracteres.length * 7));
    const inicio = performance.now();
    const revelar = agora => {
      const progresso = Math.min((agora - inicio) / duracao, 1);
      const quantidade = Math.ceil(caracteres.length * progresso);
      mensagem.textContent = caracteres.slice(0, quantidade).join("");
      mensagensElemento.scrollTop = mensagensElemento.scrollHeight;
      if (progresso < 1) {
        requestAnimationFrame(revelar);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(revelar);
  });
  const carregarConfiguracaoChave = async () => {
    const response = await fetch("/orb-ia/config");
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Não foi possível verificar a chave Gemini.");
    chaveConfigurada = resultado.chaveConfigurada === true;
    botaoRemoverChave.hidden = !chaveConfigurada;
    atualizarDisponibilidadeChat();
    limparStatus();
  };

  document.getElementById("orbIaConfigToggle").addEventListener("click", event => {
    const botao = event.currentTarget;
    formularioConfiguracao.hidden = !formularioConfiguracao.hidden;
    botao.setAttribute("aria-expanded", String(!formularioConfiguracao.hidden));
    if (!formularioConfiguracao.hidden) campoChave.focus();
  });

  formularioConfiguracao.addEventListener("submit", async event => {
    event.preventDefault();
    const chaveApi = campoChave.value.trim();
    if (!chaveApi) {
      campoChave.focus();
      return;
    }
    const botaoSalvar = formularioConfiguracao.querySelector('button[type="submit"]');
    botaoSalvar.disabled = true;
    limparStatus();
    try {
      const response = await fetch("/orb-ia/chave", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chaveApi })
      });
      const resultado = await response.json();
      if (!response.ok) throw new Error(resultado.erro || "Não foi possível salvar a chave Gemini.");
      campoChave.value = "";
      chaveConfigurada = true;
      botaoRemoverChave.hidden = false;
      atualizarDisponibilidadeChat();
    } catch (error) {
      console.error("Não foi possível salvar a chave Gemini da Orb.IA:", error);
      mostrarErro(error.message || "Não foi possível salvar a chave Gemini.");
    } finally {
      botaoSalvar.disabled = false;
    }
  });

  botaoRemoverChave.addEventListener("click", async () => {
    if (!window.confirm("Remover sua chave Gemini salva?")) return;
    botaoRemoverChave.disabled = true;
    try {
      const response = await fetch("/orb-ia/chave", { method: "DELETE" });
      const resultado = await response.json();
      if (!response.ok) throw new Error(resultado.erro || "Não foi possível remover a chave Gemini.");
      chaveConfigurada = false;
      botaoRemoverChave.hidden = true;
      atualizarDisponibilidadeChat();
      limparStatus();
    } catch (error) {
      console.error("Não foi possível remover a chave Gemini da Orb.IA:", error);
      mostrarErro(error.message || "Não foi possível remover a chave Gemini.");
    } finally {
      botaoRemoverChave.disabled = false;
    }
  });

  formularioChat.addEventListener("submit", async event => {
    event.preventDefault();
    const texto = campoMensagem.value.trim();
    if (!texto || !chaveConfigurada || enviando) return;

    campoMensagem.value = "";
    renderizarMensagem("user", texto, "orb-ia-message-enter");
    const carregando = renderizarMensagem("model", "", "orb-ia-message-loading");
    const indicadorLoading = document.createElement("span");
    indicadorLoading.className = "orb-ia-loading-indicator";
    indicadorLoading.setAttribute("role", "status");
    const iconeLoading = document.createElement("i");
    iconeLoading.className = "bi bi-arrow-repeat";
    iconeLoading.setAttribute("aria-hidden", "true");
    const textoLoading = document.createElement("span");
    textoLoading.textContent = "Pensando...";
    indicadorLoading.append(iconeLoading, textoLoading);
    carregando.append(indicadorLoading);
    enviando = true;
    atualizarDisponibilidadeChat();
    limparStatus();
    try {
      const historico = [
        ...conversacao.slice(-10),
        { role: "user", text: texto }
      ];
      const climaAtivo = lerVisibilidadeWidgets().weather !== false;
      const coordenadasContextoClima = climaAtivo && coordenadasClima
        ? {
          latitude: Number(coordenadasClima.latitude),
          longitude: Number(coordenadasClima.longitude)
        }
        : null;
      const response = await fetch("/orb-ia/conversar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mensagens: historico,
          coordenadasClima: coordenadasContextoClima
        })
      });
      const resultado = await response.json();
      if (!response.ok) throw new Error(resultado.erro || "Não foi possível obter uma resposta.");
      await animarResposta(carregando, resultado.resposta);
      conversacao.push({ role: "user", text: texto }, { role: "model", text: resultado.resposta });
    } catch (error) {
      carregando.remove();
      console.error("Não foi possível conversar com a Orb.IA:", error);
      mostrarErro(error.message || "Não foi possível obter uma resposta do Gemini.");
    } finally {
      enviando = false;
      atualizarDisponibilidadeChat();
      campoMensagem.focus();
    }
  });

  campoMensagem.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      formularioChat.requestSubmit();
    }
  });

  atualizarDisponibilidadeChat();
  carregarConfiguracaoChave().catch(error => {
    console.error("Não foi possível carregar a configuração da Orb.IA:", error);
    mostrarErro(error.message || "Não foi possível verificar a configuração da Orb.IA.");
  });
}

function renderizarListaWidgetsImagem() {
  const lista = document.getElementById("listaWidgetsImagem");
  if (!lista) return;
  const registros = Object.entries(lerLayoutWidgets())
    .filter(([id, registro]) => id.startsWith("image-") && registro.src && registro.publicId);
  const visibilidade = lerVisibilidadeWidgets();
  lista.replaceChildren();

  if (registros.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "gerenciador-widgets-vazio";
    vazio.textContent = "Nenhuma imagem adicionada.";
    lista.appendChild(vazio);
    return;
  }

  for (const [id, registro] of registros) {
    const linha = document.createElement("div");
    linha.className = "gerenciador-imagem-linha";
    const miniatura = document.createElement("img");
    miniatura.src = registro.src;
    miniatura.alt = "";
    miniatura.loading = "lazy";
    const nome = document.createElement("span");
    nome.className = "gerenciador-imagem-nome";
    nome.textContent = registro.alt || "Imagem";
    const opcao = document.createElement("label");
    opcao.className = "gerenciador-imagem-visibilidade";
    opcao.title = "Mostrar imagem no canvas";
    const ativar = document.createElement("input");
    ativar.type = "checkbox";
    ativar.checked = visibilidade[id] !== false;
    ativar.setAttribute("aria-label", `Mostrar widget ${registro.alt || "imagem"}`);
    ativar.addEventListener("change", () => alterarVisibilidadeWidget(id, ativar.checked));
    opcao.appendChild(ativar);
    const remover = document.createElement("button");
    remover.className = "gerenciador-imagem-remover";
    remover.type = "button";
    remover.setAttribute("aria-label", `Remover ${registro.alt || "imagem"}`);
    const icone = document.createElement("i");
    icone.className = "bi bi-trash3";
    icone.setAttribute("aria-hidden", "true");
    remover.appendChild(icone);
    remover.addEventListener("click", () => {
      const widget = [...document.querySelectorAll("#widgetsWorkspace .image-widget")]
        .find(item => item.dataset.widgetId === id);
      if (widget) void removerWidgetImagem(widget, remover);
    });
    linha.append(miniatura, nome, opcao, remover);
    lista.appendChild(linha);
  }
}

function criarWidgetImagem(registro) {
  const workspace = document.getElementById("widgetsWorkspace");
  if (!workspace || !/^https:\/\/res\.cloudinary\.com\/[^/]+\//.test(registro.src || "") ||
      typeof registro.publicId !== "string" ||
      !registro.publicId.startsWith(`orby/${userId}/widgets/`)) return null;

  const widget = document.createElement("article");
  widget.className = "workspace-widget image-widget";
  widget.dataset.widgetId = registro.id;
  widget.dataset.imageSrc = registro.src;
  widget.dataset.imagePublicId = registro.publicId;
  widget.dataset.imageAlt = registro.alt || "Imagem";

  const imagem = document.createElement("img");
  imagem.className = "image-widget-content";
  imagem.src = registro.src;
  imagem.alt = registro.alt || "Imagem";
  imagem.loading = "eager";
  imagem.draggable = false;

  const handle = document.createElement("button");
  handle.className = "widget-drag-handle";
  handle.type = "button";
  handle.setAttribute("aria-label", "Mover widget de imagem");
  handle.title = "Ative o modo de arraste nas configurações para mover";
  const grip = document.createElement("i");
  grip.className = "bi bi-grip-horizontal";
  grip.setAttribute("aria-hidden", "true");
  handle.appendChild(grip);

  const remover = document.createElement("button");
  remover.className = "image-widget-remove";
  remover.type = "button";
  remover.setAttribute("aria-label", "Remover widget de imagem");
  remover.title = "Remover imagem";
  const iconeRemover = document.createElement("i");
  iconeRemover.className = "bi bi-x-lg";
  iconeRemover.setAttribute("aria-hidden", "true");
  remover.appendChild(iconeRemover);

  const editar = document.createElement("button");
  editar.className = "image-widget-edit";
  editar.type = "button";
  editar.setAttribute("aria-label", `Substituir imagem: ${registro.alt || "Imagem"}`);
  editar.title = "Substituir imagem";
  const iconeEditar = document.createElement("i");
  iconeEditar.className = "bi bi-pencil";
  iconeEditar.setAttribute("aria-hidden", "true");
  editar.appendChild(iconeEditar);

  const conteudo = document.createElement("div");
  conteudo.className = "image-widget-frame";
  conteudo.append(imagem, handle, editar, remover);
  widget.appendChild(conteudo);
  workspace.appendChild(widget);

  handle.addEventListener("pointerdown", iniciarArrasteWidget);
  handle.addEventListener("keydown", moverWidgetComTeclado);
  remover.addEventListener("click", () => void removerWidgetImagem(widget, remover));
  editar.addEventListener("click", () => {
    const seletor = document.getElementById("arquivoWidgetImagem");
    seletor.dataset.widgetId = widget.dataset.widgetId;
    seletor.click();
  });
  imagem.addEventListener("load", () => {
    atualizarAlturaAreaWidgets();
    salvarLayoutWidgets();
  }, { once: true });
  return widget;
}

async function removerWidgetImagem(widget, botao) {
  botao.disabled = true;
  try {
    const response = await fetch("/cloudinary/image", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, publicId: widget.dataset.imagePublicId })
    });
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Não foi possível remover a imagem");
    widget.remove();
    salvarLayoutWidgets();
    renderizarListaWidgetsImagem();
    atualizarAlturaAreaWidgets();
  } catch (error) {
    console.error("Não foi possível remover o widget de imagem:", error);
    const status = document.getElementById("statusWidgetImagem");
    status.hidden = false;
    status.textContent = error.message || "Não foi possível remover a imagem.";
  } finally {
    botao.disabled = false;
  }
}

async function enviarImagemWidget(arquivo, widgetIdParaSubstituir = "") {
  const status = document.getElementById("statusWidgetImagem");
  const botao = document.getElementById("adicionarWidgetImagem");
  status.hidden = false;
  status.textContent = "Preparando envio...";
  status.classList.remove("erro");
  botao.disabled = true;

  try {
    if (!arquivo.type.startsWith("image/")) throw new Error("Selecione um arquivo de imagem.");
    if (arquivo.size > 10 * 1024 * 1024) throw new Error("A imagem deve ter no máximo 10 MB.");

    const assinaturaResponse = await fetch("/cloudinary/signature", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });
    const assinatura = await assinaturaResponse.json();
    if (!assinaturaResponse.ok) throw new Error(assinatura.erro || "Não foi possível preparar o envio.");

    const formulario = new FormData();
    formulario.append("file", arquivo);
    formulario.append("api_key", assinatura.apiKey);
    formulario.append("timestamp", String(assinatura.timestamp));
    formulario.append("folder", assinatura.folder);
    formulario.append("signature", assinatura.signature);
    status.textContent = "Enviando imagem...";

    const uploadResponse = await fetch(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(assinatura.cloudName)}/image/upload`,
      { method: "POST", body: formulario }
    );
    const upload = await uploadResponse.json();
    if (!uploadResponse.ok) throw new Error(upload.error?.message || "A Cloudinary recusou o envio.");

    if (widgetIdParaSubstituir) {
      const widget = [...document.querySelectorAll("#widgetsWorkspace .image-widget")]
        .find(item => item.dataset.widgetId === widgetIdParaSubstituir);
      if (!widget) throw new Error("O widget de imagem não está mais disponível.");
      const publicIdAnterior = widget.dataset.imagePublicId;
      const imagem = widget.querySelector(".image-widget-content");
      widget.dataset.imageSrc = upload.secure_url;
      widget.dataset.imagePublicId = upload.public_id;
      widget.dataset.imageAlt = arquivo.name;
      imagem.src = upload.secure_url;
      imagem.alt = arquivo.name;
      widget.querySelector(".image-widget-edit").setAttribute("aria-label", `Substituir imagem: ${arquivo.name}`);
      salvarLayoutWidgets();
      renderizarListaWidgetsImagem();
      try {
        await excluirImagemCloudinary(publicIdAnterior);
      } catch (error) {
        console.warn("A imagem foi substituída, mas não foi possível apagar a anterior:", error);
      }
      status.textContent = "Imagem substituída.";
    } else {
      const id = `image-${crypto.randomUUID()}`;
      const widget = criarWidgetImagem({
        id,
        src: upload.secure_url,
        publicId: upload.public_id,
        alt: arquivo.name
      });
      if (!widget) throw new Error("A imagem foi enviada, mas não foi possível criar o widget.");

      const widgetsExistentes = [...document.querySelectorAll("#widgetsWorkspace .workspace-widget")]
        .filter(item => item !== widget && !item.hidden);
      const y = widgetsExistentes.reduce((maior, item) =>
        Math.max(maior, item.offsetTop + item.offsetHeight + 16), 8);
      definirPosicaoWidget(widget, 8, y);
      atualizarAlturaAreaWidgets();
      salvarLayoutWidgets();
      renderizarListaWidgetsImagem();
      status.textContent = "Imagem adicionada.";
    }
  } catch (error) {
    console.error("Não foi possível adicionar a imagem:", error);
    status.classList.add("erro");
    status.textContent = error.message || "Não foi possível enviar a imagem.";
  } finally {
    botao.disabled = false;
    document.getElementById("arquivoWidgetImagem").value = "";
  }
}

async function excluirImagemCloudinary(publicId) {
  const response = await fetch("/cloudinary/image", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, publicId })
  });
  const resultado = await response.json();
  if (!response.ok) throw new Error(resultado.erro || "Não foi possível excluir a imagem anterior");
}

function salvarLayoutWidgets() {
  const layoutAnterior = lerLayoutWidgets();
  const telaPequena = widgetsEmTelaPequena();
  const widgets = [...document.querySelectorAll("#widgetsWorkspace .workspace-widget")];
  const maiorYSalvo = Math.max(0, ...Object.values(layoutAnterior).map(registro =>
    Number.isFinite(registro?.y) ? registro.y : 0
  ));
  const layout = Object.fromEntries(
    widgets.map((widget, indice) => {
      const id = widget.dataset.widgetId;
      const anterior = layoutAnterior[id];
      const xDeclarado = Number(widget.dataset.defaultX);
      const yDeclarado = Number(widget.dataset.defaultY);
      const xPadrao = id === "weather" ? 278 : Number.isFinite(xDeclarado) ? xDeclarado : 8;
      const yPadrao = id === "weather" ? 8 : Number.isFinite(yDeclarado) ? yDeclarado : maiorYSalvo + 360 + indice * 16;
      const xSalvo = Number(widget.dataset.layoutX);
      const ySalvo = Number(widget.dataset.layoutY);
      return [id, {
        x: telaPequena && Number.isFinite(anterior?.x) ? anterior.x : telaPequena ? xPadrao : Number.isFinite(xSalvo) ? xSalvo : Number.parseFloat(widget.style.left) || 0,
        y: telaPequena && Number.isFinite(anterior?.y) ? anterior.y : telaPequena ? yPadrao : Number.isFinite(ySalvo) ? ySalvo : Number.parseFloat(widget.style.top) || 0,
        z: telaPequena && Number.isFinite(anterior?.z) ? anterior.z : Number.parseInt(widget.style.zIndex, 10) || 1,
        ...(id === "chess" ? {
          width: Math.round(widget.querySelector(".chess-widget-card")?.getBoundingClientRect().width || 340)
        } : {}),
        ...(id === "orb-ia" ? {
          width: Math.round(widget.querySelector(".orb-ia-card")?.getBoundingClientRect().width || 290),
          height: Math.round(widget.querySelector(".orb-ia-card")?.getBoundingClientRect().height || 360)
        } : {}),
        ...(widget.dataset.imageSrc ? {
          src: widget.dataset.imageSrc,
          publicId: widget.dataset.imagePublicId,
          alt: widget.dataset.imageAlt
        } : {})
      }];
    })
  );
  salvarLayoutWidgetsNoCache(layout);
  if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
}

function atualizarAlturaAreaWidgets() {
  const workspace = document.getElementById("widgetsWorkspace");
  if (!workspace || !workspace.clientWidth) return;
  const widgets = [...workspace.querySelectorAll(".workspace-widget")];
  const maiorBase = widgets.reduce((maior, widget) =>
    Math.max(maior, widget.offsetTop + widget.offsetHeight), 0);
  workspace.style.setProperty("--widgets-conteudo-altura", `${Math.max(520, maiorBase + 20)}px`);
}

function definirPosicaoWidget(widget, x, y, salvar = false) {
  const workspace = document.getElementById("widgetsWorkspace");
  if (!workspace || !workspace.clientWidth) return;
  const maximoX = Math.max(0, workspace.clientWidth - widget.offsetWidth);
  const xLimitado = Math.round(Math.min(maximoX, Math.max(0, x)));
  const yLimitado = Math.max(0, Math.round(y));
  widget.style.left = `${xLimitado}px`;
  widget.style.top = `${yLimitado}px`;
  widget.dataset.layoutX = String(xLimitado);
  widget.dataset.layoutY = String(yLimitado);
  if (salvar) widget.style.zIndex = String(++ordemWidgets);
  atualizarAlturaAreaWidgets();
  if (salvar) salvarLayoutWidgets();
}

function aplicarLayoutWidgets() {
  const workspace = document.getElementById("widgetsWorkspace");
  if (!workspace || !workspace.clientWidth) return;
  const layout = lerLayoutWidgets();
  const idsComLayout = Object.keys(layout);
  const layoutFoiZerado = idsComLayout.length > 1 && idsComLayout.every(id =>
    Number(layout[id]?.x) === 0 && Number(layout[id]?.y) === 0
  );

  for (const [id, registro] of Object.entries(layout)) {
    if (id.startsWith("image-") && !workspace.querySelector(`[data-widget-id="${CSS.escape(id)}"]`)) {
      criarWidgetImagem({ id, ...registro });
    }
  }

  const visibilidade = lerVisibilidadeWidgets();
  workspace.querySelectorAll(".workspace-widget").forEach((widget, indice) => {
    const salvo = layoutFoiZerado ? null : layout[widget.dataset.widgetId];
    if (widget.dataset.widgetId === "chess" && Number.isInteger(salvo?.width)) {
      const cartaoXadrez = widget.querySelector(".chess-widget-card");
      if (cartaoXadrez) cartaoXadrez.style.width = `${salvo.width}px`;
    }
    if (widget.dataset.widgetId === "orb-ia") {
      const cartaoOrbIa = widget.querySelector(".orb-ia-card");
      if (cartaoOrbIa && Number.isInteger(salvo?.width) && Number.isInteger(salvo?.height)) {
        cartaoOrbIa.style.width = `${salvo.width}px`;
        cartaoOrbIa.style.height = `${salvo.height}px`;
      }
    }
    const padraoLadoALado = workspace.clientWidth >= 620;
    const xDeclarado = Number(widget.dataset.defaultX);
    const yDeclarado = Number(widget.dataset.defaultY);
    const xPadrao = widget.dataset.widgetId === "weather" && padraoLadoALado ? 278 : Number.isFinite(xDeclarado) ? xDeclarado : 8;
    const yPadrao = widget.dataset.widgetId === "weather" && padraoLadoALado ? 8 : Number.isFinite(yDeclarado) ? yDeclarado : indice * 330;
    const x = Number.isFinite(salvo?.x) ? salvo.x : xPadrao;
    const y = Number.isFinite(salvo?.y) ? salvo.y : yPadrao;
    widget.hidden = false;
    widget.dataset.layoutX = String(Math.max(0, Math.round(x)));
    widget.dataset.layoutY = String(Math.max(0, Math.round(y)));
    widget.style.left = `${Math.round(Math.min(Math.max(0, workspace.clientWidth - widget.offsetWidth), Math.max(0, x)))}px`;
    widget.style.top = `${Math.max(0, Math.round(y))}px`;
    if (Number.isFinite(salvo?.z)) {
      widget.style.zIndex = String(salvo.z);
      ordemWidgets = Math.max(ordemWidgets, salvo.z);
    } else {
      widget.style.zIndex = String(indice + 1);
      ordemWidgets = Math.max(ordemWidgets, indice + 1);
    }
    atualizarAlturaAreaWidgets();
    widget.hidden = visibilidade[widget.dataset.widgetId] === false;
  });
  atualizarAlturaAreaWidgets();
}

function reorganizarWidgets() {
  if (widgetsEmTelaPequena()) return;
  const workspace = document.getElementById("widgetsWorkspace");
  if (!workspace?.clientWidth) return;

  const margem = 8;
  const espacamento = 16;
  const limiteDireito = workspace.clientWidth - margem;
  const widgets = [...workspace.querySelectorAll(".workspace-widget")]
    .filter(widget => !widget.hidden);
  let x = margem;
  let y = margem;
  let alturaLinha = 0;

  for (const widget of widgets) {
    const largura = Math.min(widget.offsetWidth, Math.max(0, workspace.clientWidth - margem * 2));
    const altura = widget.offsetHeight;
    if (x > margem && x + largura > limiteDireito) {
      x = margem;
      y += alturaLinha + espacamento;
      alturaLinha = 0;
    }
    widget.style.left = `${Math.round(x)}px`;
    widget.style.top = `${Math.round(y)}px`;
    widget.style.zIndex = String(++ordemWidgets);
    x += largura + espacamento;
    alturaLinha = Math.max(alturaLinha, altura);
  }

  atualizarAlturaAreaWidgets();
  salvarLayoutWidgets();
}

function iniciarArrasteWidget(event) {
  if (widgetsEmTelaPequena() || !modoArrasteWidgets || event.button !== 0 || !event.isPrimary) return;
  const handle = event.currentTarget;
  const widget = handle.closest(".workspace-widget");
  const workspace = document.getElementById("widgetsWorkspace");
  if (!widget || !workspace) return;

  const widgetRect = widget.getBoundingClientRect();
  arrasteWidget = {
    pointerId: event.pointerId,
    handle,
    widget,
    inicioX: event.clientX,
    inicioY: event.clientY,
    offsetX: event.clientX - widgetRect.left,
    offsetY: event.clientY - widgetRect.top,
    xInicial: widget.offsetLeft,
    yInicial: widget.offsetTop,
    moveu: false
  };
  widget.style.zIndex = String(++ordemWidgets);
  widget.classList.add("workspace-widget-moving");
  handle.setPointerCapture(event.pointerId);
  event.preventDefault();
}

function moverWidgetComTeclado(event) {
  if (widgetsEmTelaPequena() || !modoArrasteWidgets) return;
  const movimentos = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1]
  };
  const movimento = movimentos[event.key];
  if (!movimento) return;
  event.preventDefault();
  const widget = event.currentTarget.closest(".workspace-widget");
  const passo = event.shiftKey ? 48 : 16;
  definirPosicaoWidget(
    widget,
    widget.offsetLeft + movimento[0] * passo,
    widget.offsetTop + movimento[1] * passo,
    true
  );
}

function inicializarWidgets() {
  const workspace = document.getElementById("widgetsWorkspace");
  if (!workspace) return;

  const dialogo = document.getElementById("gerenciadorWidgets");
  const abrirGerenciador = document.getElementById("abrirGerenciadorWidgets");
  const fecharGerenciador = document.getElementById("fecharGerenciadorWidgets");
  const visibilidadeInicial = lerVisibilidadeWidgets();
  if (user?.primeiroCadastro) {
    for (const id of ["habit", "clock"]) {
      if (!(id in visibilidadeInicial)) visibilidadeInicial[id] = false;
    }
    try {
      preferenciasUsuario.visibilidadeWidgets = visibilidadeInicial;
      delete user.primeiroCadastro;
      salvarPreferenciasNoServidor();
    } catch (error) {
      console.warn("Não foi possível aplicar as opções iniciais dos widgets.", error);
    }
  }
  document.getElementById("adicionarWidgetPostit").addEventListener("click", adicionarPostitWidget);
  document.getElementById("reorganizarWidgets").addEventListener("click", reorganizarWidgets);
  const opcoesEstaticas = [
    ["calendar", document.getElementById("widgetCalendarioAtivo")],
    ["weather", document.getElementById("widgetTempoAtivo")],
    ["message", document.getElementById("widgetMensagemAtivo")],
    ["important-tasks", document.getElementById("widgetTarefasImportantesAtivo")],
    ["list", document.getElementById("widgetListaAtivo")],
    ["habit", document.getElementById("widgetHabitoAtivo")],
    ["clock", document.getElementById("widgetRelogioAtivo")],
    ["stopwatch", document.getElementById("widgetCronometroAtivo")],
    ["timer-regressivo", document.getElementById("widgetTimerRegressivoAtivo")],
    ["utilidades", document.getElementById("widgetUtilidadesAtivo")],
    ["links", document.getElementById("widgetLinksAtivo")],
    ["chess", document.getElementById("widgetXadrezAtivo")],
    ["orb-ia", document.getElementById("widgetOrbIaAtivo")]
  ];
  for (const [id, controle] of opcoesEstaticas) {
    controle.checked = visibilidadeInicial[id] !== false;
    controle.addEventListener("change", () => alterarVisibilidadeWidget(id, controle.checked));
  }
  const widgetPomodoroAtivo = document.getElementById("widgetPomodoroAtivo");
  widgetPomodoroAtivo.checked = visibilidadeInicial.pomodoro !== false;
  widgetPomodoroAtivo.addEventListener("change", () => alterarVisibilidadeWidget("pomodoro", widgetPomodoroAtivo.checked));
  const inputDuracaoFoco = document.getElementById("widgetPomodoroFocoMinutos");
  const inputDuracaoPausa = document.getElementById("widgetPomodoroPausaMinutos");
  const salvarDuracaoPomodoro = (input, chave) => {
    if (!input.checkValidity()) {
      input.reportValidity();
      input.value = preferenciasUsuario.duracoesPomodoro[chave];
      return;
    }
    preferenciasUsuario.duracoesPomodoro[chave] = Number(input.value);
    salvarPreferenciasNoServidor();
    atualizarWidgetPomodoro();
  };
  inputDuracaoFoco.value = preferenciasUsuario.duracoesPomodoro.focoMinutos;
  inputDuracaoPausa.value = preferenciasUsuario.duracoesPomodoro.pausaMinutos;
  inputDuracaoFoco.addEventListener("change", () => salvarDuracaoPomodoro(inputDuracaoFoco, "focoMinutos"));
  inputDuracaoPausa.addEventListener("change", () => salvarDuracaoPomodoro(inputDuracaoPausa, "pausaMinutos"));
  const campoTimerTitulo = document.getElementById("timerRegressivoTitulo");
  const campoTimerDataHora = document.getElementById("timerRegressivoDataHora");
  campoTimerTitulo.value = preferenciasUsuario.timerRegressivo.titulo;
  campoTimerDataHora.value = preferenciasUsuario.timerRegressivo.dataHora;
  document.getElementById("salvarTimerRegressivo").addEventListener("click", salvarTimerRegressivo);
  document.getElementById("removerTimerRegressivo").addEventListener("click", removerTimerRegressivo);
  document.getElementById("timerRegressivoStatus").textContent = preferenciasUsuario.timerRegressivo.titulo
    ? "Edite os campos para substituir o objetivo ou remova a data atual."
    : "Configure um objetivo e uma data. Só é possível manter uma data por vez.";
  const seletorEstiloRelogio = document.getElementById("widgetRelogioEstilo");
  const estilosRelogio = ["digital", "analogico", "minimalista", "flip"];
  let estiloRelogioSalvo = "digital";
  try {
    const salvo = preferenciasUsuario.estiloRelogio;
    if (estilosRelogio.includes(salvo)) estiloRelogioSalvo = salvo;
  } catch {}
  seletorEstiloRelogio.value = estiloRelogioSalvo;
  document.getElementById("widgetRelogio").dataset.clockStyle = estiloRelogioSalvo;
  seletorEstiloRelogio.addEventListener("change", () => {
    const estilo = seletorEstiloRelogio.value;
    document.getElementById("widgetRelogio").dataset.clockStyle = estilo;
    try {
      preferenciasUsuario.estiloRelogio = estilo;
      if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
    } catch (error) {
      console.warn("Não foi possível salvar o estilo do relógio.", error);
    }
  });
  document.getElementById("widgetHabitoSelect").addEventListener("change", event => {
    try {
      preferenciasUsuario.habitoWidget = event.currentTarget.value;
      if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
    } catch (error) {
      console.warn("Não foi possível salvar o hábito selecionado para o widget.", error);
    }
    renderizarWidgetHabito();
  });
  document.getElementById("widgetListaSelect").addEventListener("change", event => {
    preferenciasUsuario.listaWidget = event.currentTarget.value;
    if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
    preencherSelecaoWidgetLista();
    renderizarWidgetLista();
  });
  document.getElementById("widgetListaAtivo").checked = visibilidadeInicial.list !== false;
  document.getElementById("widgetListaAtivo")
    .addEventListener("change", event => alterarVisibilidadeWidget("list", event.currentTarget.checked));

  abrirGerenciador.addEventListener("click", async () => {
    document.getElementById("config").style.display = "none";
    await carregarListas();
    preencherSelecaoWidgetLista();
    renderizarListaWidgetsImagem();
    if (typeof dialogo.showModal === "function") dialogo.showModal();
    else dialogo.setAttribute("open", "");
  });
  fecharGerenciador.addEventListener("click", () => {
    if (typeof dialogo.close === "function") dialogo.close();
    else dialogo.removeAttribute("open");
  });
  dialogo.addEventListener("click", evento => {
    if (evento.target === dialogo && typeof dialogo.close === "function") dialogo.close();
  });

  const botaoAdicionarImagem = document.getElementById("adicionarWidgetImagem");
  const seletorImagem = document.getElementById("arquivoWidgetImagem");
  botaoAdicionarImagem.addEventListener("click", () => {
    delete seletorImagem.dataset.widgetId;
    seletorImagem.click();
  });
  seletorImagem.addEventListener("change", () => {
    const arquivo = seletorImagem.files?.[0];
    if (arquivo) void enviarImagemWidget(arquivo, seletorImagem.dataset.widgetId || "");
    delete seletorImagem.dataset.widgetId;
  });

  const seletorFotoPerfil = document.getElementById("arquivoFotoPerfil");
  const selecionarFotoPerfil = () => seletorFotoPerfil.click();
  document.getElementById("escolherFotoPerfil").addEventListener("click", selecionarFotoPerfil);
  seletorFotoPerfil.addEventListener("change", () => {
    const arquivo = seletorFotoPerfil.files?.[0];
    if (arquivo) void enviarFotoPerfil(arquivo);
  });
  const dialogoPerfil = document.getElementById("dialogConfiguracoesPerfil");
  const abrirConfiguracoesPerfil = document.getElementById("abrirConfiguracoesPerfil");
  const formularioSenhaPerfil = document.getElementById("formSenhaPerfil");
  const alternarRedefinicaoSenha = document.getElementById("alternarRedefinicaoSenha");
  abrirConfiguracoesPerfil.addEventListener("click", () => {
    document.getElementById("statusConfiguracoesPerfil").hidden = true;
    if (typeof dialogoPerfil.showModal === "function") dialogoPerfil.showModal();
    else dialogoPerfil.setAttribute("open", "");
  });
  document.getElementById("fecharConfiguracoesPerfil").addEventListener("click", () => {
    if (typeof dialogoPerfil.close === "function") dialogoPerfil.close();
    else dialogoPerfil.removeAttribute("open");
  });
  dialogoPerfil.addEventListener("click", evento => {
    if (evento.target === dialogoPerfil && typeof dialogoPerfil.close === "function") dialogoPerfil.close();
  });
  document.getElementById("formNomePerfil").addEventListener("submit", salvarNomePerfil);
  alternarRedefinicaoSenha.addEventListener("click", () => {
    formularioSenhaPerfil.hidden = !formularioSenhaPerfil.hidden;
    alternarRedefinicaoSenha.setAttribute("aria-expanded", String(!formularioSenhaPerfil.hidden));
    if (!formularioSenhaPerfil.hidden) document.getElementById("senhaAtualPerfil").focus();
  });
  formularioSenhaPerfil.addEventListener("submit", redefinirSenhaPerfil);
  document.getElementById("botaoLogoutPerfil").addEventListener("click", logout);

  const controleModo = document.getElementById("modoArrasteWidgets");
  const raiz = document.getElementById("all");
  try {
    modoArrasteWidgets = preferenciasUsuario.modoArrasteWidgets === true;
  } catch {
    modoArrasteWidgets = false;
  }
  controleModo.checked = modoArrasteWidgets;
  raiz.classList.toggle("modoWidgetsAtivo", modoArrasteWidgets);
  controleModo.addEventListener("change", () => {
    modoArrasteWidgets = controleModo.checked;
    raiz.classList.toggle("modoWidgetsAtivo", modoArrasteWidgets);
    try {
      preferenciasUsuario.modoArrasteWidgets = modoArrasteWidgets;
      if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
    } catch (error) {
      console.warn("Não foi possível salvar o modo de arraste dos widgets.", error);
    }
    if (!modoArrasteWidgets && arrasteWidget) {
      arrasteWidget.widget.classList.remove("workspace-widget-moving");
      arrasteWidget = null;
    }
  });

  workspace.querySelectorAll(".widget-drag-handle").forEach(handle => {
    handle.addEventListener("pointerdown", iniciarArrasteWidget);
    handle.addEventListener("keydown", moverWidgetComTeclado);
  });
  inicializarCalculadora();
  inicializarWidgetLinks();
  inicializarWidgetOrbIa();
  aplicarLayoutWidgets();
  renderizarPostitsWidget();
  void carregarLayoutWidgets();
  atualizarWidgetRelogio();
  window.setInterval(atualizarWidgetRelogio, 1000);
  atualizarWidgetCronometro();
  window.setInterval(atualizarWidgetCronometro, 250);
  document.getElementById("btnIniciarCronometro").addEventListener("click", iniciarCronometro);
  document.getElementById("btnPararCronometro").addEventListener("click", pararCronometro);
  document.getElementById("btnReiniciarCronometro").addEventListener("click", reiniciarCronometro);

  // Pomodoro: inicializa UI, atualiza periodicamente e conecta botões
  atualizarWidgetPomodoro();
  window.setInterval(atualizarWidgetPomodoro, 250);
  const _btnIniciarPomodoro = document.getElementById("btnIniciarPomodoro");
  const _btnPausarPomodoro = document.getElementById("btnPausarPomodoro");
  const _btnReiniciarPomodoro = document.getElementById("btnReiniciarPomodoro");
  if (_btnIniciarPomodoro) _btnIniciarPomodoro.addEventListener("click", iniciarPomodoro);
  if (_btnPausarPomodoro) _btnPausarPomodoro.addEventListener("click", pausarPomodoro);
  if (_btnReiniciarPomodoro) _btnReiniciarPomodoro.addEventListener("click", reiniciarPomodoro);
  atualizarWidgetTimerRegressivo();
  window.setInterval(atualizarWidgetTimerRegressivo, 1000);

  document.getElementById("mensagemWidget").hidden = visibilidadeInicial.message === false;
  renderizarWidgetHabito();
  atualizarAlturaAreaWidgets();
  renderizarListaWidgetsImagem();
  void carregarHabitos();
  window.addEventListener("resize", aplicarLayoutWidgets);
  if (typeof ResizeObserver !== "undefined") {
    const observador = new ResizeObserver(entradas => {
      if (entradas.some(entrada => entrada.target.matches?.(".tarefasDiv"))) {
        atualizarAlturaAreaWidgets();
      }
      if (entradas.some(entrada => entrada.target === workspace)) {
        aplicarLayoutWidgets();
        return;
      }
      atualizarAlturaAreaWidgets();
    });
    observador.observe(workspace);
    const tarefasDiv = document.querySelector("#containerTarefas > .tarefasDiv");
    if (tarefasDiv) observador.observe(tarefasDiv);
    workspace.querySelectorAll(".workspace-widget").forEach(widget => observador.observe(widget));
  }
}

document.addEventListener("pointermove", event => {
  if (!modoArrasteWidgets || !arrasteWidget || event.pointerId !== arrasteWidget.pointerId) return;
  const workspace = document.getElementById("widgetsWorkspace");
  const rect = workspace.getBoundingClientRect();
  const x = event.clientX - rect.left + workspace.scrollLeft - arrasteWidget.offsetX;
  const y = event.clientY - rect.top + workspace.scrollTop - arrasteWidget.offsetY;
  if (Math.abs(event.clientX - arrasteWidget.inicioX) + Math.abs(event.clientY - arrasteWidget.inicioY) > 3) {
    arrasteWidget.moveu = true;
  }
  definirPosicaoWidget(arrasteWidget.widget, x, y);
  if (arrasteWidget.widget.dataset.widgetId === "utilidades") posicionarCalculadora();
  event.preventDefault();
});

document.addEventListener("pointerup", event => {
  if (!arrasteWidget || event.pointerId !== arrasteWidget.pointerId) return;
  const arraste = arrasteWidget;
  arrasteWidget = null;
  arraste.widget.classList.remove("workspace-widget-moving");
  if (arraste.moveu) salvarLayoutWidgets();
  if (arraste.handle.hasPointerCapture(event.pointerId)) {
    arraste.handle.releasePointerCapture(event.pointerId);
  }
});

document.addEventListener("pointercancel", event => {
  if (!arrasteWidget || event.pointerId !== arrasteWidget.pointerId) return;
  arrasteWidget.widget.classList.remove("workspace-widget-moving");
  arrasteWidget = null;
});

inicializarWidgets();

document.addEventListener("chess-widget-resized", event => {
  const widget = document.querySelector('#widgetsWorkspace [data-widget-id="chess"]');
  if (!widget || !Number.isInteger(event.detail?.width)) return;
  const tamanho = widgetsEmTelaPequena();
  if (!tamanho) definirPosicaoWidget(widget, widget.offsetLeft, widget.offsetTop);
  salvarLayoutWidgets();
});

function obterLimitesPainelTarefas() {
  const painel = document.querySelector("#containerTarefas .tarefasContainer");
  const secao = document.getElementById("containerTarefas");
  const estilo = getComputedStyle(painel);
  const margemHorizontal = (parseFloat(estilo.marginLeft) || 0) + (parseFloat(estilo.marginRight) || 0);
  const margemVertical = (parseFloat(estilo.marginTop) || 0) + (parseFloat(estilo.marginBottom) || 0);
  const larguraMinimaWidgets = window.matchMedia("(min-width: 901px)").matches
    ? Math.max(270, parseFloat(getComputedStyle(document.getElementById("widgetsWorkspace")).minWidth) || 0)
    : 0;
  const espacamentoColunas = parseFloat(getComputedStyle(secao).columnGap) || 0;

  return {
    largura: Math.max(320, secao.clientWidth - larguraMinimaWidgets - espacamentoColunas - margemHorizontal),
    altura: Math.max(280, secao.clientHeight - margemVertical)
  };
}

function definirTamanhoPainelTarefas(largura, altura) {
  const painel = document.querySelector("#containerTarefas .tarefasContainer");
  const secao = document.getElementById("containerTarefas");
  const limites = obterLimitesPainelTarefas();
  const estilo = getComputedStyle(painel);
  const margemHorizontal = (parseFloat(estilo.marginLeft) || 0) + (parseFloat(estilo.marginRight) || 0);
  const tamanho = {
    largura: Math.min(limites.largura, Math.max(320, largura)),
    altura: Math.min(limites.altura, Math.max(280, altura))
  };

  painel.style.width = `${tamanho.largura}px`;
  painel.style.height = `${tamanho.altura}px`;
  secao.style.setProperty("--tarefas-coluna-largura", `${tamanho.largura + margemHorizontal}px`);
  return tamanho;
}

function salvarTamanhoPainelTarefas(largura, altura) {
  try {
    preferenciasUsuario.tamanhoPainelTarefas = { largura: Math.round(largura), altura: Math.round(altura) };
    if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
  } catch (error) {
    console.warn("Não foi possível salvar o tamanho do painel de tarefas.", error);
  }
}

function aplicarTamanhoSalvoPainelTarefas() {
  const painel = document.querySelector("#containerTarefas .tarefasContainer");
  const secao = document.getElementById("containerTarefas");
  if (!painel || !secao) return;

  if (window.matchMedia("(max-width: 800px)").matches) {
    painel.style.removeProperty("width");
    painel.style.removeProperty("height");
    secao.style.removeProperty("--tarefas-coluna-largura");
    return;
  }
  if (secao.hidden) return;

  try {
    const tamanho = preferenciasUsuario.tamanhoPainelTarefas;
    if (!tamanho || !Number.isFinite(tamanho.largura) || !Number.isFinite(tamanho.altura)) return;
    definirTamanhoPainelTarefas(tamanho.largura, tamanho.altura);
  } catch (error) {
    console.warn("Não foi possível carregar o tamanho do painel de tarefas.", error);
  }
}

const alcaRedimensionarPainel = document.querySelector(".alcaRedimensionarTarefas");
alcaRedimensionarPainel?.addEventListener("pointerdown", event => {
  if (window.matchMedia("(max-width: 800px)").matches || event.pointerType !== "mouse" || event.button !== 0) return;

  const painel = document.querySelector("#containerTarefas .tarefasContainer");
  if (!painel || document.getElementById("containerTarefas").hidden) return;
  const limites = obterLimitesPainelTarefas();
  redimensionamentoPainelTarefas = {
    pointerId: event.pointerId,
    inicioX: event.clientX,
    inicioY: event.clientY,
    larguraInicial: painel.offsetWidth,
    alturaInicial: painel.offsetHeight,
    larguraMaxima: limites.largura,
    alturaMaxima: limites.altura
  };
  event.preventDefault();
  alcaRedimensionarPainel.setPointerCapture(event.pointerId);
});

document.addEventListener("pointermove", event => {
  const redimensionamento = redimensionamentoPainelTarefas;
  if (!redimensionamento || event.pointerId !== redimensionamento.pointerId) return;

  const largura = Math.min(redimensionamento.larguraMaxima, Math.max(320,
    redimensionamento.larguraInicial + event.clientX - redimensionamento.inicioX
  ));
  const altura = Math.min(redimensionamento.alturaMaxima, Math.max(280,
    redimensionamento.alturaInicial + event.clientY - redimensionamento.inicioY
  ));
  definirTamanhoPainelTarefas(largura, altura);
  event.preventDefault();
});

function finalizarRedimensionamentoPainelTarefas(event) {
  const redimensionamento = redimensionamentoPainelTarefas;
  if (!redimensionamento || event.pointerId !== redimensionamento.pointerId) return;

  redimensionamentoPainelTarefas = null;
  const painel = document.querySelector("#containerTarefas .tarefasContainer");
  salvarTamanhoPainelTarefas(painel.offsetWidth, painel.offsetHeight);
  if (alcaRedimensionarPainel.hasPointerCapture(event.pointerId)) {
    alcaRedimensionarPainel.releasePointerCapture(event.pointerId);
  }
}

document.addEventListener("pointerup", finalizarRedimensionamentoPainelTarefas);
document.addEventListener("pointercancel", finalizarRedimensionamentoPainelTarefas);

alcaRedimensionarPainel?.addEventListener("keydown", event => {
  if (window.matchMedia("(max-width: 800px)").matches) return;
  const painel = document.querySelector("#containerTarefas .tarefasContainer");
  let largura = painel.offsetWidth;
  let altura = painel.offsetHeight;
  const passo = event.shiftKey ? 50 : 20;

  if (event.key === "ArrowLeft") largura -= passo;
  else if (event.key === "ArrowRight") largura += passo;
  else if (event.key === "ArrowUp") altura -= passo;
  else if (event.key === "ArrowDown") altura += passo;
  else return;

  event.preventDefault();
  const tamanho = definirTamanhoPainelTarefas(largura, altura);
  salvarTamanhoPainelTarefas(tamanho.largura, tamanho.altura);
});

window.addEventListener("load", aplicarTamanhoSalvoPainelTarefas, { once: true });
window.addEventListener("resize", aplicarTamanhoSalvoPainelTarefas);

function chaveDataLocal(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

function deslocarDataLocal(chave, dias) {
  const [ano, mes, dia] = chave.split("-").map(Number);
  const data = new Date(ano, mes - 1, dia);
  data.setDate(data.getDate() + dias);
  return chaveDataLocal(data);
}

function calcularSequenciaHabito(diasConcluidos) {
  const concluidos = new Set(diasConcluidos);
  const hoje = chaveDataLocal(new Date());
  const inicio = concluidos.has(hoje) ? hoje : deslocarDataLocal(hoje, -1);
  if (!concluidos.has(inicio)) return { atual: 0, melhor: calcularMelhorSequencia(diasConcluidos) };

  let atual = 0;
  let dia = inicio;
  while (concluidos.has(dia)) {
    atual += 1;
    dia = deslocarDataLocal(dia, -1);
  }
  return { atual, melhor: Math.max(atual, calcularMelhorSequencia(diasConcluidos)) };
}

function calcularMelhorSequencia(diasConcluidos) {
  const concluidos = [...new Set(diasConcluidos)].sort();
  let melhor = 0;
  let sequencia = 0;
  let anterior = "";

  for (const dia of concluidos) {
    sequencia = anterior && deslocarDataLocal(anterior, 1) === dia ? sequencia + 1 : 1;
    melhor = Math.max(melhor, sequencia);
    anterior = dia;
  }
  return melhor;
}

function renderizarHabitos() {
  const lista = document.getElementById("listaHabitos");
  lista.replaceChildren();
  const hoje = chaveDataLocal(new Date());

  if (habitos.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "habitosVazios";
    vazio.textContent = "Você ainda não criou hábitos. Adicione o primeiro para começar sua sequência.";
    lista.appendChild(vazio);
    return;
  }

  for (const habito of habitos) {
    const horarios = Array.isArray(habito.horarios) ? habito.horarios : [];
    const concluidoHoje = horarios.length
      ? horarios.every(horario => (habito.conclusoesHorarios || []).includes(`${hoje}@${horario}`))
      : habito.diasConcluidos.includes(hoje);
    const sequencia = calcularSequenciaHabito(habito.diasConcluidos);
    const cartao = document.createElement("article");
    cartao.className = `cartaoHabito${concluidoHoje ? " concluido" : ""}`;
    cartao.dataset.habitoId = habito._id;

    const informacoes = document.createElement("div");
    informacoes.className = "informacoesHabito";
    const nome = document.createElement("h3");
    nome.textContent = habito.nome;
    const lembrete = document.createElement("p");
    lembrete.innerHTML = horarios.length
      ? '<i class="bi bi-clock" aria-hidden="true"></i> Conclua nos horários abaixo'
      : '<i class="bi bi-bell" aria-hidden="true"></i> Lembrete diário às ';
    if (!horarios.length) {
      const horario = document.createElement("strong");
      horario.textContent = habito.horario;
      lembrete.appendChild(horario);
    }
    const estatisticas = document.createElement("p");
    estatisticas.className = "sequenciaHabito";
    estatisticas.textContent =
      `${sequencia.atual} ${sequencia.atual === 1 ? "dia" : "dias"} seguidos · melhor: ${sequencia.melhor}`;
    informacoes.append(nome, lembrete, estatisticas);

    const acoes = document.createElement("div");
    acoes.className = "acoesHabito";
    const concluir = document.createElement("button");
    concluir.type = "button";
    concluir.className = "btnMarcarHabito";
    concluir.dataset.acaoHabito = "concluir";
    concluir.setAttribute("aria-pressed", String(concluidoHoje));
    concluir.innerHTML = concluidoHoje
      ? '<i class="bi bi-check2-circle" aria-hidden="true"></i> Feito hoje'
      : '<i class="bi bi-circle" aria-hidden="true"></i> Marcar como feito';
    if (horarios.length) {
      concluir.remove();
      const listaHorarios = document.createElement("div");
      listaHorarios.className = "conclusoesHorariosHabito";
      for (const horario of horarios) {
        const feito = (habito.conclusoesHorarios || []).includes(`${hoje}@${horario}`);
        const botaoHorario = document.createElement("button");
        botaoHorario.type = "button";
        botaoHorario.className = `btnHorarioHabito${feito ? " concluido" : ""}`;
        botaoHorario.dataset.acaoHabito = "concluir";
        botaoHorario.dataset.horario = horario;
        botaoHorario.setAttribute("aria-pressed", String(feito));
        botaoHorario.innerHTML = `<i class="bi ${feito ? "bi-check-circle-fill" : "bi-circle"}" aria-hidden="true"></i> ${horario}`;
        listaHorarios.appendChild(botaoHorario);
      }
      if (horarios.length > 1) {
        const marcarTodos = document.createElement("button");
        marcarTodos.type = "button";
        marcarTodos.className = "btnMarcarTodosHorariosHabito";
        marcarTodos.dataset.acaoHabito = "concluirTodos";
        marcarTodos.disabled = concluidoHoje;
        marcarTodos.setAttribute("aria-label", concluidoHoje
          ? `Todos os horários de ${habito.nome} já foram feitos`
          : `Marcar todos os horários de ${habito.nome} como feitos`);
        marcarTodos.innerHTML = concluidoHoje
          ? '<i class="bi bi-check2" aria-hidden="true"></i> Todos feitos'
          : '<i class="bi bi-check2-all" aria-hidden="true"></i> Marcar todos';
        listaHorarios.appendChild(marcarTodos);
      }
      informacoes.appendChild(listaHorarios);
    }
    const editar = document.createElement("button");
    editar.type = "button";
    editar.className = "btnAcaoHabito";
    editar.dataset.acaoHabito = "editar";
    editar.setAttribute("aria-label", `Editar ${habito.nome}`);
    editar.innerHTML = '<i class="bi bi-pencil" aria-hidden="true"></i>';
    const excluir = document.createElement("button");
    excluir.type = "button";
    excluir.className = "btnAcaoHabito";
    excluir.dataset.acaoHabito = "excluir";
    excluir.setAttribute("aria-label", `Excluir ${habito.nome}`);
    excluir.innerHTML = '<i class="bi bi-trash" aria-hidden="true"></i>';
    if (!horarios.length) acoes.append(concluir);
    acoes.append(editar, excluir);
    cartao.append(informacoes, acoes);
    lista.appendChild(cartao);
  }
}

function preencherSelecaoWidgetHabito() {
  const select = document.getElementById("widgetHabitoSelect");
  const status = document.getElementById("widgetHabitoStatus");
  const selecionadoSalvo = preferenciasUsuario.habitoWidget;
  select.replaceChildren();

  if (habitos.length === 0) {
    const vazio = document.createElement("option");
    vazio.value = "";
    vazio.textContent = "Nenhum hábito cadastrado";
    select.appendChild(vazio);
    select.disabled = true;
    status.textContent = "Crie um hábito na seção Hábitos para adicioná-lo aqui.";
    return;
  }

  select.disabled = false;
  const selecionado = habitos.some(habito => habito._id === selecionadoSalvo)
    ? selecionadoSalvo
    : habitos[0]._id;
  for (const habito of habitos) {
    const opcao = document.createElement("option");
    opcao.value = habito._id;
    opcao.textContent = habito.nome;
    select.appendChild(opcao);
  }
  select.value = selecionado;
  preferenciasUsuario.habitoWidget = selecionado;
  if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
  status.textContent = "";
}

function criarBotaoHorarioWidgetHabito(habito, horario, feito, cartao) {
  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = `btnHorarioHabito${feito ? " concluido" : ""}`;
  botao.dataset.acaoHabito = "concluir";
  botao.dataset.horario = horario;
  botao.setAttribute("aria-pressed", String(feito));
  const icone = document.createElement("i");
  icone.className = `bi ${feito ? "bi-check-circle-fill" : "bi-circle"}`;
  icone.setAttribute("aria-hidden", "true");
  botao.append(icone, document.createTextNode(` ${horario}`));
  botao.addEventListener("click", () => void acionarHabito(cartao, "concluir", horario, botao));
  return botao;
}

function renderizarWidgetHabito() {
  const widget = document.querySelector('#widgetsWorkspace [data-widget-id="habit"]');
  const card = document.getElementById("widgetHabitoCard");
  if (!widget || !card) return;

  const visibilidade = lerVisibilidadeWidgets();
  widget.hidden = visibilidade.habit === false;
  card.replaceChildren();
  const handle = document.createElement("button");
  handle.className = "widget-drag-handle";
  handle.type = "button";
  handle.setAttribute("aria-label", "Mover widget de hábitos");
  handle.title = "Arraste para mover";
  const grip = document.createElement("i");
  grip.className = "bi bi-grip-horizontal";
  grip.setAttribute("aria-hidden", "true");
  handle.appendChild(grip);
  card.appendChild(handle);
  handle.addEventListener("pointerdown", iniciarArrasteWidget);
  handle.addEventListener("keydown", moverWidgetComTeclado);
  const habitoId = document.getElementById("widgetHabitoSelect").value || preferenciasUsuario.habitoWidget;
  const habito = habitos.find(item => item._id === habitoId);
  if (!habito) {
    const vazio = document.createElement("p");
    vazio.className = "habit-widget-empty";
    vazio.textContent = "Selecione um hábito nas configurações.";
    card.appendChild(vazio);
    atualizarAlturaAreaWidgets();
    return;
  }

  card.dataset.habitoId = habito._id;
  const hoje = chaveDataLocal(new Date());
  const horarios = Array.isArray(habito.horarios) ? habito.horarios : [];
  const conclusoes = habito.conclusoesHorarios || [];
  const concluidoHoje = horarios.length
    ? horarios.every(horario => conclusoes.includes(`${hoje}@${horario}`))
    : (habito.diasConcluidos || []).includes(hoje);
  const sequencia = calcularSequenciaHabito(habito.diasConcluidos || []);
  const cabecalho = document.createElement("div");
  cabecalho.className = "habit-widget-heading";
  const titulo = document.createElement("h3");
  titulo.textContent = habito.nome;
  const lembrete = document.createElement("span");
  lembrete.textContent = horarios.length ? `${horarios.length} horários hoje` : `Lembrete às ${habito.horario}`;
  cabecalho.append(titulo, lembrete);

  const sequenciaTexto = document.createElement("p");
  sequenciaTexto.className = "habit-widget-streak";
  sequenciaTexto.textContent = `${sequencia.atual} ${sequencia.atual === 1 ? "dia" : "dias"} seguidos · melhor: ${sequencia.melhor}`;
  card.append(cabecalho, sequenciaTexto);

  if (horarios.length) {
    const listaHorarios = document.createElement("div");
    listaHorarios.className = "habit-widget-times";
    for (const horario of horarios) {
      listaHorarios.appendChild(criarBotaoHorarioWidgetHabito(
        habito,
        horario,
        conclusoes.includes(`${hoje}@${horario}`),
        card
      ));
    }
    if (horarios.length > 1) {
      const marcarTodos = document.createElement("button");
      marcarTodos.type = "button";
      marcarTodos.className = "btnMarcarTodosHorariosHabito";
      marcarTodos.dataset.acaoHabito = "concluirTodos";
      marcarTodos.disabled = concluidoHoje;
      marcarTodos.textContent = concluidoHoje ? "Todos feitos" : "Marcar todos";
      marcarTodos.addEventListener("click", () => void acionarHabito(card, "concluirTodos", null, marcarTodos));
      listaHorarios.appendChild(marcarTodos);
    }
    card.appendChild(listaHorarios);
  } else {
    const concluir = document.createElement("button");
    concluir.type = "button";
    concluir.className = `btnMarcarHabito${concluidoHoje ? " concluido" : ""}`;
    concluir.setAttribute("aria-pressed", String(concluidoHoje));
    concluir.innerHTML = concluidoHoje
      ? '<i class="bi bi-check2-circle" aria-hidden="true"></i> Feito hoje'
      : '<i class="bi bi-circle" aria-hidden="true"></i> Marcar como feito';
    concluir.addEventListener("click", () => void acionarHabito(card, "concluir", null, concluir));
    card.appendChild(concluir);
  }
  atualizarAlturaAreaWidgets();
}

function preencherSelecaoWidgetLista() {
  const select = document.getElementById("widgetListaSelect");
  const status = document.getElementById("widgetListaStatus");
  const listaSalva = preferenciasUsuario.listaWidget;
  select.replaceChildren();

  if (!listas.length) {
    const vazio = document.createElement("option");
    vazio.value = "";
    vazio.textContent = "Nenhuma lista cadastrada";
    select.appendChild(vazio);
    select.disabled = true;
    status.textContent = "Crie uma lista na seção Listas para adicioná-la aqui.";
    if (listaSalva) {
      preferenciasUsuario.listaWidget = "";
      if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
    }
    return;
  }

  select.disabled = false;
  const opcaoVazia = document.createElement("option");
  opcaoVazia.value = "";
  opcaoVazia.textContent = "Selecione uma lista";
  select.appendChild(opcaoVazia);
  for (const lista of listas) {
    const opcao = document.createElement("option");
    opcao.value = lista._id;
    opcao.textContent = lista.nome;
    select.appendChild(opcao);
  }
  const selecionado = listas.some(lista => lista._id === listaSalva) ? listaSalva : "";
  select.value = selecionado;
  if (selecionado !== listaSalva) {
    preferenciasUsuario.listaWidget = "";
    if (layoutWidgetsCarregado) salvarPreferenciasNoServidor();
  }
  status.textContent = selecionado ? "" : "Escolha qual lista deseja exibir.";
}

function renderizarWidgetLista() {
  const card = document.querySelector('#widgetsWorkspace [data-widget-id="list"]');
  const titulo = document.getElementById("widgetListaTitulo");
  const progresso = document.getElementById("widgetListaProgresso");
  const vazio = document.getElementById("widgetListaVazia");
  const itensElement = document.getElementById("widgetListaItens");
  if (!card || !titulo || !progresso || !vazio || !itensElement) return;

  const listaId = document.getElementById("widgetListaSelect").value || preferenciasUsuario.listaWidget;
  const lista = listas.find(item => item._id === listaId);
  titulo.replaceChildren();
  const icone = document.createElement("i");
  icone.className = "bi bi-list-check";
  icone.setAttribute("aria-hidden", "true");
  titulo.append(icone, document.createTextNode(` ${lista?.nome || "Lista"}`));
  itensElement.replaceChildren();

  if (!lista) {
    progresso.textContent = "";
    vazio.textContent = listas.length
      ? "Selecione uma lista nas configurações."
      : "Crie uma lista e selecione-a nas configurações.";
    atualizarAlturaAreaWidgets();
    return;
  }

  const concluidos = lista.itens.filter(item => item.concluido).length;
  progresso.textContent = `${concluidos}/${lista.itens.length}`;
  vazio.textContent = lista.itens.length ? "" : "Esta lista ainda não tem itens.";
  for (const item of lista.itens) {
    const linha = document.createElement("li");
    linha.className = `list-widget-item${item.concluido ? " concluido" : ""}`;
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "list-widget-item-toggle";
    botao.dataset.itemId = item._id;
    botao.setAttribute("aria-pressed", String(item.concluido));
    botao.setAttribute("aria-label", item.concluido
      ? `Marcar ${item.texto} como pendente`
      : `Marcar ${item.texto} como concluído`);
    const marcador = document.createElement("i");
    marcador.className = `bi ${item.concluido ? "bi-check-circle-fill" : "bi-circle"}`;
    marcador.setAttribute("aria-hidden", "true");
    const texto = document.createElement("span");
    texto.textContent = item.texto;
    botao.append(marcador, texto);
    linha.appendChild(botao);
    itensElement.appendChild(linha);
  }
  atualizarAlturaAreaWidgets();
}

document.getElementById("widgetListaItens").addEventListener("click", async event => {
  const botao = event.target.closest(".list-widget-item-toggle");
  const lista = listas.find(item => item._id === preferenciasUsuario.listaWidget);
  const item = lista?.itens.find(candidato => candidato._id === botao?.dataset.itemId);
  if (!lista || !item || !botao) return;

  botao.disabled = true;
  try {
    await atualizarItemLista(lista._id, item._id, { concluido: !item.concluido });
    await carregarListas();
  } catch (error) {
    console.error("Não foi possível atualizar o item pelo widget de lista:", error);
    alert(error.message || "Não foi possível atualizar o item.");
  } finally {
    botao.disabled = false;
  }
});

function atualizarWidgetHabito() {
  preencherSelecaoWidgetHabito();
  renderizarWidgetHabito();
}

async function carregarHabitos() {
  const lista = document.getElementById("listaHabitos");
  try {
    const fusoHorario = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const response = await fetch(
      `/habitos/${userId}?fusoHorario=${encodeURIComponent(fusoHorario)}`
    );
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Erro ao carregar hábitos");
    habitos = resultado;
    renderizarHabitos();
    atualizarWidgetHabito();
  } catch (error) {
    console.error("Não foi possível carregar hábitos:", error);
    lista.textContent = "Não foi possível carregar seus hábitos. Tente novamente.";
  }
}

function abrirModalHabito(habito = null) {
  habitoEmEdicao = habito?._id ?? null;
  document.getElementById("tituloModalHabito").textContent = habito ? "Editar hábito" : "Novo hábito";
  document.getElementById("inputNomeHabito").value = habito?.nome ?? "";
  document.getElementById("inputHorarioHabito").value = habito?.horario ?? "09:00";
  horariosHabitoFormulario = Array.isArray(habito?.horarios) ? [...habito.horarios] : [];
  document.getElementById("tipoHabito").value = horariosHabitoFormulario.length ? "horarios" : "simples";
  atualizarFormularioHorariosHabito();
  document.getElementById("modalHabito").classList.remove("hidden");
  document.getElementById("inputNomeHabito").focus();
}

function atualizarFormularioHorariosHabito() {
  const multiplos = document.getElementById("tipoHabito").value === "horarios";
  document.getElementById("configHabitoSimples").classList.toggle("hidden", multiplos);
  document.getElementById("configHabitoHorarios").classList.toggle("hidden", !multiplos);
  const lista = document.getElementById("listaHorariosHabito");
  lista.replaceChildren();
  horariosHabitoFormulario.forEach((horario, indice) => {
    const item = document.createElement("span");
    item.className = "horarioHabitoItem";
    const texto = document.createElement("strong");
    texto.textContent = horario;
    const remover = document.createElement("button");
    remover.type = "button";
    remover.textContent = "×";
    remover.setAttribute("aria-label", `Remover horário ${horario}`);
    remover.addEventListener("click", () => {
      horariosHabitoFormulario.splice(indice, 1);
      atualizarFormularioHorariosHabito();
    });
    item.append(texto, remover);
    lista.appendChild(item);
  });
}

function adicionarHorarioHabito() {
  const input = document.getElementById("inputNovoHorarioHabito");
  const horario = input.value;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(horario) || horariosHabitoFormulario.includes(horario)) return;
  if (horariosHabitoFormulario.length >= 12) {
    alert("Você pode adicionar até 12 horários por hábito.");
    return;
  }
  horariosHabitoFormulario.push(horario);
  horariosHabitoFormulario.sort();
  atualizarFormularioHorariosHabito();
}

function fecharModalHabito() {
  document.getElementById("modalHabito").classList.add("hidden");
  habitoEmEdicao = null;
}

async function salvarHabito() {
  const nomeInput = document.getElementById("inputNomeHabito");
  const horarioInput = document.getElementById("inputHorarioHabito");
  const nome = nomeInput.value.trim();
  const multiplos = document.getElementById("tipoHabito").value === "horarios";
  const horarios = multiplos ? horariosHabitoFormulario : [];
  const horario = multiplos ? horarios[0] : horarioInput.value;
  if (!nome || nome.length > 100 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(horario || "") ||
      (multiplos && horarios.length < 2)) {
    alert(multiplos
      ? "Informe o nome e adicione pelo menos dois horários diferentes."
      : "Informe um nome de até 100 caracteres e um horário válido.");
    return;
  }

  const botao = document.getElementById("btnSalvarHabito");
  botao.disabled = true;
  try {
    const editando = Boolean(habitoEmEdicao);
    const response = await fetch(
      editando ? `/habitos/${userId}/${habitoEmEdicao}` : `/habitos/${userId}`,
      {
        method: editando ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome,
          horario,
          horarios,
          fusoHorario: Intl.DateTimeFormat().resolvedOptions().timeZone
        })
      }
    );
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Erro ao salvar hábito");
    fecharModalHabito();
    await carregarHabitos();
  } catch (error) {
    console.error("Não foi possível salvar o hábito:", error);
    alert(error.message || "Não foi possível salvar o hábito.");
  } finally {
    botao.disabled = false;
  }
}

async function acionarHabito(cartao, acao, horario = null, botaoAcionado = null) {
  const id = cartao.dataset.habitoId;
  const habito = habitos.find(item => item._id === id);
  if (!habito) return;

  if (acao === "editar") {
    abrirModalHabito(habito);
    return;
  }
  if (acao === "excluir") {
    if (!confirm(`Excluir o hábito "${habito.nome}" e sua sequência?`)) return;
    try {
      const response = await fetch(`/habitos/${userId}/${id}`, { method: "DELETE" });
      const resultado = await response.json();
      if (!response.ok) throw new Error(resultado.erro || "Erro ao excluir hábito");
      await carregarHabitos();
    } catch (error) {
      console.error("Não foi possível excluir o hábito:", error);
      alert(error.message || "Não foi possível excluir o hábito.");
    }
    return;
  }

  const botao = botaoAcionado || cartao.querySelector('[data-acao-habito="concluir"]');
  const hoje = chaveDataLocal(new Date());
  const estavaConcluido = acao === "concluirTodos"
    ? habito.horarios.every(item => (habito.conclusoesHorarios || []).includes(`${hoje}@${item}`))
    : habito.horarios?.length
      ? (habito.conclusoesHorarios || []).includes(`${hoje}@${horario}`)
      : (habito.diasConcluidos || []).includes(hoje);
  if (botao) botao.disabled = true;
  try {
    const response = await fetch(`/habitos/${userId}/${id}/conclusao`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: hoje,
        ...(acao === "concluirTodos" ? { marcarTodos: true } : horario ? { horario } : {})
      })
    });
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Erro ao atualizar hábito");
    if (!estavaConcluido) tocarSomEvento("conclusao");
    await carregarHabitos();
  } catch (error) {
    console.error("Não foi possível atualizar o hábito:", error);
    alert(error.message || "Não foi possível atualizar o hábito.");
  } finally {
    if (botao) botao.disabled = false;
  }
}

document.getElementById("btnNovoHabito").addEventListener("click", () => abrirModalHabito());
document.getElementById("btnCancelarHabito").addEventListener("click", fecharModalHabito);
document.getElementById("btnSalvarHabito").addEventListener("click", salvarHabito);
document.getElementById("tipoHabito").addEventListener("change", atualizarFormularioHorariosHabito);
document.getElementById("btnAdicionarHorarioHabito").addEventListener("click", adicionarHorarioHabito);
document.getElementById("listaHabitos").addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  const botao = event.target.closest("[data-acao-habito]");
  const cartao = botao?.closest(".cartaoHabito");
  if (botao && cartao) acionarHabito(cartao, botao.dataset.acaoHabito, botao.dataset.horario || null, botao);
});

setInterval(() => {
  if (document.getElementById("containerHabitos").classList.contains("show")) renderizarHabitos();
}, 60000);

async function carregarListas() {
  const container = document.getElementById("listaDeListas");
  try {
    const response = await fetch(`/listas/${userId}`);
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "N\u00e3o foi poss\u00edvel carregar as listas");
    listas = resultado;
    renderizarListas();
    preencherSelecaoWidgetLista();
    renderizarWidgetLista();
  } catch (error) {
    console.error("N\u00e3o foi poss\u00edvel carregar as listas:", error);
    container.textContent = "N\u00e3o foi poss\u00edvel carregar suas listas. Tente novamente.";
    document.getElementById("widgetListaStatus").textContent = "Não foi possível carregar as listas.";
    document.getElementById("widgetListaVazia").textContent = "Não foi possível carregar esta lista.";
  }
}

function criarBotaoLista(classe, rotulo, icone, acao) {
  const botao = document.createElement("button");
  botao.type = "button";
  botao.className = classe;
  botao.setAttribute("aria-label", rotulo);
  botao.title = rotulo;
  botao.dataset.acaoLista = acao;
  botao.innerHTML = `<i class="bi ${icone}" aria-hidden="true"></i>`;
  return botao;
}

function renderizarListas() {
  const container = document.getElementById("listaDeListas");
  const progressosAnteriores = new Map(
    Array.from(container.querySelectorAll(".cartaoLista")).map(card => [
      card.dataset.listaId,
      card.querySelector(".preenchimentoProgressoLista")?.style.width || "0%"
    ])
  );
  container.replaceChildren();
  if (!listas.length) {
    const vazio = document.createElement("p");
    vazio.className = "listasVazias";
    vazio.textContent = "Nenhuma lista criada ainda. Comece criando a sua primeira lista.";
    container.appendChild(vazio);
    return;
  }

  listas.forEach(lista => {
    const card = document.createElement("article");
    card.className = "cartaoLista";
    card.dataset.listaId = lista._id;
    const totalItens = lista.itens.length;
    const itensConcluidos = lista.itens.filter(item => item.concluido).length;
    const percentualConcluido = totalItens ? Math.round((itensConcluidos / totalItens) * 100) : 0;

    const cabecalho = document.createElement("div");
    cabecalho.className = "cabecalhoCartaoLista";
    const titulo = document.createElement("h3");
    titulo.textContent = lista.nome;
    const acoesLista = document.createElement("div");
    acoesLista.className = "acoesLista";
    acoesLista.append(
      criarBotaoLista("btnAcaoLista", "Editar lista", "bi-pencil", "editar-lista"),
      criarBotaoLista("btnAcaoLista perigo", "Excluir lista", "bi-trash", "excluir-lista")
    );
    cabecalho.append(titulo, acoesLista);

    const progresso = document.createElement("div");
    progresso.className = "progressoLista";
    const resumo = document.createElement("span");
    resumo.className = "resumoProgressoLista";
    resumo.textContent = totalItens
      ? `${itensConcluidos} de ${totalItens} ${totalItens === 1 ? "item" : "itens"}`
      : "Nenhum item";
    const trilho = document.createElement("div");
    trilho.className = "trilhoProgressoLista";
    trilho.setAttribute("role", "progressbar");
    trilho.setAttribute("aria-label", `Progresso da lista ${lista.nome}`);
    trilho.setAttribute("aria-valuemin", "0");
    trilho.setAttribute("aria-valuemax", String(totalItens));
    trilho.setAttribute("aria-valuenow", String(itensConcluidos));
    const preenchimento = document.createElement("span");
    preenchimento.className = "preenchimentoProgressoLista";
    preenchimento.style.width = progressosAnteriores.get(lista._id) ?? "0%";
    preenchimento.dataset.progressoFinal = `${percentualConcluido}%`;
    trilho.appendChild(preenchimento);
    progresso.append(resumo, trilho);

    const formulario = document.createElement("form");
    formulario.className = "adicionarItemLista";
    formulario.dataset.acaoLista = "adicionar-item";
    const input = document.createElement("input");
    input.type = "text";
    input.name = "texto";
    input.maxLength = 300;
    input.placeholder = "Adicionar um item";
    input.setAttribute("aria-label", `Adicionar item em ${lista.nome}`);
    const adicionar = document.createElement("button");
    adicionar.type = "submit";
    adicionar.innerHTML = '<i class="bi bi-plus-lg" aria-hidden="true"></i><span>Adicionar</span>';
    formulario.append(input, adicionar);

    const itens = document.createElement("ul");
    itens.className = "itensLista";
    if (!lista.itens.length) {
      const vazio = document.createElement("li");
      vazio.className = "itensListaVazios";
      vazio.textContent = "Esta lista ainda n\u00e3o tem itens.";
      itens.appendChild(vazio);
    }
    lista.itens.forEach(item => {
      const linha = document.createElement("li");
      linha.className = `itemLista${item.concluido ? " concluido" : ""}`;
      linha.dataset.itemId = item._id;
      const marcador = document.createElement("button");
      marcador.type = "button";
      marcador.className = "marcadorItemLista";
      marcador.dataset.acaoLista = "alternar-item";
      marcador.setAttribute("aria-pressed", String(item.concluido));
      marcador.setAttribute("aria-label", item.concluido ? "Marcar item como pendente" : "Marcar item como conclu\u00eddo");
      marcador.innerHTML = `<i class="bi ${item.concluido ? "bi-check-circle-fill" : "bi-circle"}" aria-hidden="true"></i>`;
      const texto = document.createElement("span");
      texto.className = "textoItemLista";
      texto.textContent = item.texto;
      const acoes = document.createElement("div");
      acoes.className = "acoesItemLista";
      acoes.append(
        criarBotaoLista("btnAcaoItemLista", "Editar item", "bi-pencil", "editar-item"),
        criarBotaoLista("btnAcaoItemLista perigo", "Excluir item", "bi-trash", "excluir-item")
      );
      linha.append(marcador, texto, acoes);
      itens.appendChild(linha);
    });
    card.append(cabecalho, progresso, formulario, itens);
    container.appendChild(card);
  });

  requestAnimationFrame(() => {
    container.querySelectorAll(".preenchimentoProgressoLista").forEach(preenchimento => {
      preenchimento.style.width = preenchimento.dataset.progressoFinal;
    });
  });
}

function abrirModalLista(lista = null) {
  listaEmEdicao = lista?._id ?? null;
  document.getElementById("tituloModalLista").textContent = lista ? "Editar lista" : "Nova lista";
  const input = document.getElementById("inputNomeLista");
  input.value = lista?.nome ?? "";
  document.getElementById("modalLista").classList.remove("hidden");
  input.focus();
}

function fecharModalLista() {
  document.getElementById("modalLista").classList.add("hidden");
  listaEmEdicao = null;
}

async function salvarLista() {
  const nome = document.getElementById("inputNomeLista").value.trim();
  if (!nome) return alert("Informe o nome da lista.");
  const botao = document.getElementById("btnSalvarLista");
  botao.disabled = true;
  try {
    const editando = Boolean(listaEmEdicao);
    const response = await fetch(editando ? `/listas/${userId}/${listaEmEdicao}` : `/listas/${userId}`, {
      method: editando ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome })
    });
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "N\u00e3o foi poss\u00edvel salvar a lista");
    fecharModalLista();
    await carregarListas();
  } catch (error) {
    console.error(error);
    alert(error.message || "N\u00e3o foi poss\u00edvel salvar a lista.");
  } finally {
    botao.disabled = false;
  }
}

async function atualizarItemLista(listaId, itemId, dados) {
  const response = await fetch(`/listas/${userId}/${listaId}/itens/${itemId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dados)
  });
  const resultado = await response.json();
  if (!response.ok) throw new Error(resultado.erro || "N\u00e3o foi poss\u00edvel atualizar o item");
}

document.getElementById("btnNovaLista").addEventListener("click", () => abrirModalLista());
document.getElementById("btnCancelarLista").addEventListener("click", fecharModalLista);
document.getElementById("btnSalvarLista").addEventListener("click", () => void salvarLista());
document.getElementById("listaDeListas").addEventListener("submit", event => {
  const formulario = event.target.closest('form[data-acao-lista="adicionar-item"]');
  if (!formulario) return;
  event.preventDefault();
  const texto = new FormData(formulario).get("texto")?.trim();
  const listaId = formulario.closest(".cartaoLista")?.dataset.listaId;
  if (!texto || !listaId) return;
  const botao = formulario.querySelector("button");
  botao.disabled = true;
  fetch(`/listas/${userId}/${listaId}/itens`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto })
  }).then(async response => {
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "N\u00e3o foi poss\u00edvel adicionar o item");
    await carregarListas();
  }).catch(error => {
    console.error(error);
    alert(error.message || "N\u00e3o foi poss\u00edvel adicionar o item.");
  }).finally(() => { botao.disabled = false; });
});
document.getElementById("listaDeListas").addEventListener("click", event => {
  const botao = event.target.closest("[data-acao-lista]");
  if (!botao || botao.tagName === "FORM") return;
  const card = botao.closest(".cartaoLista");
  const lista = listas.find(item => item._id === card?.dataset.listaId);
  const linha = botao.closest(".itemLista");
  const item = lista?.itens.find(item => item._id === linha?.dataset.itemId);
  if (!lista) return;
  const acao = botao.dataset.acaoLista;
  (async () => {
    try {
      if (acao === "editar-lista") return abrirModalLista(lista);
      if (acao === "excluir-lista") {
        if (!confirm(`Excluir a lista "${lista.nome}" e todos os seus itens?`)) return;
        const response = await fetch(`/listas/${userId}/${lista._id}`, { method: "DELETE" });
        if (!response.ok) throw new Error("N\u00e3o foi poss\u00edvel excluir a lista");
      } else if (!item) return;
      else if (acao === "alternar-item") await atualizarItemLista(lista._id, item._id, { concluido: !item.concluido });
      else if (acao === "editar-item") {
        const texto = prompt("Editar item", item.texto);
        if (texto === null) return;
        if (!texto.trim()) return alert("O item n\u00e3o pode ficar vazio.");
        await atualizarItemLista(lista._id, item._id, { texto: texto.trim() });
      } else if (acao === "excluir-item") {
        if (!confirm(`Excluir o item "${item.texto}"?`)) return;
        const response = await fetch(`/listas/${userId}/${lista._id}/itens/${item._id}`, { method: "DELETE" });
        if (!response.ok) throw new Error("N\u00e3o foi poss\u00edvel excluir o item");
      } else return;
      await carregarListas();
    } catch (error) {
      console.error(error);
      alert(error.message || "N\u00e3o foi poss\u00edvel atualizar a lista.");
    }
  })();
});

function renderizarCaderno() {
  const vazio = document.getElementById("cadernoVazio");
  const editor = document.getElementById("editorFolhaCaderno");
  const temFolha = indiceFolhaCaderno >= 0 && indiceFolhaCaderno < folhasCaderno.length;
  vazio.classList.toggle("hidden", temFolha);
  editor.classList.toggle("hidden", !temFolha);
  document.getElementById("btnSalvarFolha").disabled = !temFolha || !cadernoAlterado;
  document.getElementById("btnExcluirFolha").disabled = !temFolha;
  document.getElementById("btnFolhaAnterior").disabled = !temFolha || indiceFolhaCaderno === 0;
  document.getElementById("btnProximaFolha").disabled =
    !temFolha || indiceFolhaCaderno === folhasCaderno.length - 1;
  for (const id of ["estiloPautaCaderno", "corPautaCaderno", "espacamentoPautaCaderno"]) {
    document.getElementById(id).disabled = !temFolha;
  }

  if (!temFolha) {
    document.getElementById("indicadorFolha").textContent = "Nenhuma folha";
    document.getElementById("tituloFolhaCaderno").value = "";
    document.getElementById("conteudoFolhaCaderno").value = "";
    aplicarEstiloPautaCaderno();
    return;
  }

  const folha = folhasCaderno[indiceFolhaCaderno];
  document.getElementById("indicadorFolha").textContent =
    `Folha ${indiceFolhaCaderno + 1} de ${folhasCaderno.length}`;
  document.getElementById("tituloFolhaCaderno").value = folha.titulo;
  document.getElementById("conteudoFolhaCaderno").value = folha.conteudo;
  document.getElementById("estiloPautaCaderno").value = folha.pauta || "linhas";
  document.getElementById("corPautaCaderno").value = folha.corPauta || "#e3e8e5";
  document.getElementById("espacamentoPautaCaderno").value = String(folha.espacamentoPauta || 32);
  aplicarEstiloPautaCaderno();
}

function aplicarEstiloPautaCaderno() {
  const folha = document.getElementById("folhaCaderno");
  const conteudo = document.getElementById("conteudoFolhaCaderno");
  const estilo = document.getElementById("estiloPautaCaderno").value || "linhas";
  const cor = document.getElementById("corPautaCaderno").value || "#e3e8e5";
  const espacamento = Number(document.getElementById("espacamentoPautaCaderno").value) || 32;
  folha.dataset.pauta = estilo;
  conteudo.style.setProperty("--cor-pauta", cor);
  conteudo.style.setProperty("--cor-margem-pauta", cor);
  conteudo.style.setProperty("--espacamento-pauta", `${espacamento}px`);
}

async function carregarCaderno() {
  if (carregandoCaderno || cadernoCarregado) return;
  carregandoCaderno = true;
  document.getElementById("statusCaderno").textContent = "Carregando...";
  try {
    const response = await fetch(`/caderno/${userId}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Não foi possível carregar o caderno");
    folhasCaderno = result;
    indiceFolhaCaderno = folhasCaderno.length ? 0 : -1;
    cadernoCarregado = true;
    renderizarCaderno();
    document.getElementById("statusCaderno").textContent = "";
  } catch (error) {
    console.error(error);
    document.getElementById("statusCaderno").textContent =
      error.message || "Não foi possível carregar o caderno.";
  } finally {
    carregandoCaderno = false;
  }
}

async function salvarFolhaCaderno() {
  if (indiceFolhaCaderno < 0 || cadernoSalvando) return false;
  const tituloInput = document.getElementById("tituloFolhaCaderno");
  const conteudoInput = document.getElementById("conteudoFolhaCaderno");
  const titulo = tituloInput.value.trim();
  const pauta = document.getElementById("estiloPautaCaderno").value;
  const corPauta = document.getElementById("corPautaCaderno").value;
  const espacamentoPauta = Number(document.getElementById("espacamentoPautaCaderno").value);
  if (!titulo) {
    document.getElementById("statusCaderno").textContent = "Dê um título para esta folha antes de salvar.";
    tituloInput.focus();
    return false;
  }

  const folha = folhasCaderno[indiceFolhaCaderno];
  const conteudo = conteudoInput.value;
  cadernoSalvando = true;
  const botao = document.getElementById("btnSalvarFolha");
  botao.disabled = true;
  document.getElementById("statusCaderno").textContent = "Salvando...";
  try {
    const response = await fetch(`/caderno/${userId}/${folha._id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titulo, conteudo, pauta, corPauta, espacamentoPauta })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Não foi possível salvar a folha");
    folhasCaderno[indiceFolhaCaderno] = result;
    cadernoAlterado = tituloInput.value.trim() !== titulo || conteudoInput.value !== conteudo;
    document.getElementById("statusCaderno").textContent =
      cadernoAlterado ? "Há alterações novas não salvas" : "Salvo";
    return !cadernoAlterado;
  } catch (error) {
    console.error(error);
    document.getElementById("statusCaderno").textContent =
      error.message || "Não foi possível salvar a folha.";
    return false;
  } finally {
    cadernoSalvando = false;
    botao.disabled = !cadernoAlterado;
    if (!cadernoAlterado) document.getElementById("statusCaderno").textContent = "Salvo";
  }
}

async function criarFolhaCaderno() {
  if (!cadernoCarregado) await carregarCaderno();
  if (!cadernoCarregado) return;
  if (cadernoAlterado && !await salvarFolhaCaderno()) return;

  const botao = document.getElementById("btnNovaFolha");
  botao.disabled = true;
  document.getElementById("statusCaderno").textContent = "Criando folha...";
  try {
    const response = await fetch(`/caderno/${userId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Não foi possível criar a folha");
    folhasCaderno.push(result);
    indiceFolhaCaderno = folhasCaderno.length - 1;
    cadernoAlterado = false;
    renderizarCaderno();
    document.getElementById("tituloFolhaCaderno").focus();
    document.getElementById("statusCaderno").textContent = "Nova folha criada";
  } catch (error) {
    console.error(error);
    document.getElementById("statusCaderno").textContent =
      error.message || "Não foi possível criar a folha.";
  } finally {
    botao.disabled = false;
  }
}

async function navegarFolhaCaderno(direcao) {
  if (cadernoAlterado && !await salvarFolhaCaderno()) return;
  const novoIndice = indiceFolhaCaderno + direcao;
  if (novoIndice < 0 || novoIndice >= folhasCaderno.length) return;
  indiceFolhaCaderno = novoIndice;
  cadernoAlterado = false;
  renderizarCaderno();
  document.getElementById("statusCaderno").textContent = "";
}

async function excluirFolhaCaderno() {
  if (indiceFolhaCaderno < 0) return;
  if (!window.confirm("Excluir esta folha e todas as anotações dela?")) return;
  const folha = folhasCaderno[indiceFolhaCaderno];
  const botao = document.getElementById("btnExcluirFolha");
  botao.disabled = true;
  document.getElementById("statusCaderno").textContent = "Excluindo folha...";
  try {
    const response = await fetch(`/caderno/${userId}/${folha._id}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Não foi possível excluir a folha");
    folhasCaderno.splice(indiceFolhaCaderno, 1);
    indiceFolhaCaderno = folhasCaderno.length
      ? Math.min(indiceFolhaCaderno, folhasCaderno.length - 1)
      : -1;
    cadernoAlterado = false;
    renderizarCaderno();
    document.getElementById("statusCaderno").textContent = "";
  } catch (error) {
    console.error(error);
    document.getElementById("statusCaderno").textContent =
      error.message || "Não foi possível excluir a folha.";
    botao.disabled = false;
  }
}

for (const inputId of [
  "tituloFolhaCaderno",
  "conteudoFolhaCaderno",
  "estiloPautaCaderno",
  "corPautaCaderno",
  "espacamentoPautaCaderno"
]) {
  const evento = inputId === "estiloPautaCaderno" || inputId === "espacamentoPautaCaderno"
    ? "change"
    : "input";
  document.getElementById(inputId).addEventListener(evento, () => {
    if (indiceFolhaCaderno < 0) return;
    cadernoAlterado = true;
    if (inputId === "estiloPautaCaderno" || inputId === "corPautaCaderno" ||
        inputId === "espacamentoPautaCaderno") aplicarEstiloPautaCaderno();
    document.getElementById("statusCaderno").textContent = "Alterações não salvas";
    document.getElementById("btnSalvarFolha").disabled = false;
  });
}

function renderizarPosts() {
  canvasPosts.replaceChildren();
  posts.forEach(post => {
    const card = document.createElement("article");
    card.className = "postIt";
    card.dataset.postId = post._id;
    const larguraPost = Math.min(post.largura || 240, Math.max(180, canvasPosts.clientWidth - 32));
    const posicaoX = Math.min(post.x, Math.max(16, canvasPosts.clientWidth - larguraPost - 16));
    card.style.left = `${posicaoX}px`;
    card.style.top = `${post.y}px`;
    card.style.width = `${larguraPost}px`;
    card.style.height = `${post.altura || 160}px`;
    card.style.setProperty("--cor-post", post.cor);

    const header = document.createElement("div");
    header.className = "cabecalhoPost";
    header.title = window.matchMedia("(max-width: 800px)").matches ? "" : "Arraste para mover";

    const titulo = document.createElement("strong");
    titulo.className = "tituloPost";
    titulo.textContent = post.titulo;

    const acoes = document.createElement("div");
    acoes.className = "acoesPost";
    const editar = document.createElement("button");
    editar.type = "button";
    editar.className = "editarPost";
    editar.setAttribute("aria-label", `Editar ${post.titulo}`);
    editar.innerHTML = '<i class="bi bi-pencil" aria-hidden="true"></i>';
    const excluir = document.createElement("button");
    excluir.type = "button";
    excluir.className = "excluirPost";
    excluir.setAttribute("aria-label", `Excluir ${post.titulo}`);
    excluir.innerHTML = '<i class="bi bi-trash" aria-hidden="true"></i>';
    acoes.append(editar, excluir);
    header.append(titulo, acoes);

    const descricao = document.createElement("p");
    descricao.className = "descricaoPost";
    descricao.textContent = post.descricao;
    const alca = document.createElement("span");
    alca.className = "alcaRedimensionarPost";
    alca.title = "Arraste para redimensionar";
    alca.setAttribute("aria-label", "Arraste para redimensionar o post-it");
    card.append(header, descricao, alca);
    canvasPosts.appendChild(card);
  });
  ajustarAlturaQuadroPosts();
}

function ajustarAlturaQuadroPosts() {
  const alturaConteudo = [...canvasPosts.querySelectorAll(".postIt")]
    .reduce((altura, post) => Math.max(altura, post.offsetTop + post.offsetHeight + 16), quadroPosts.clientHeight);
  canvasPosts.style.height = `${alturaConteudo}px`;
}

async function carregarPosts() {
  quadroPosts = quadroPosts || document.getElementById("quadroPosts");
  try {
    const response = await fetch(`/posts/${userId}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Não foi possível carregar os post-its");
    posts = result;
    renderizarPosts();
  } catch (error) {
    console.error(error);
    canvasPosts.replaceChildren();
    const mensagem = document.createElement("p");
    mensagem.className = "erroPosts";
    mensagem.textContent = "Não foi possível carregar os post-its. Tente novamente.";
    canvasPosts.appendChild(mensagem);
  }
}

function abrirModalPost(postId = null) {
  postEmEdicao = postId ? posts.find(post => post._id === postId) : null;
  document.getElementById("tituloModalPost").textContent = postEmEdicao ? "Editar post-it" : "Novo post-it";
  document.getElementById("inputTituloPost").value = postEmEdicao?.titulo || "";
  document.getElementById("inputDescricaoPost").value = postEmEdicao?.descricao || "";
  document.getElementById("inputCorPost").value = postEmEdicao?.cor || "#fff2a8";
  document.getElementById("modalPost").classList.remove("hidden");
  document.getElementById("inputTituloPost").focus();
}

function fecharModalPost() {
  if (document.getElementById("modalPost").dataset.widgetPostitId) {
    fecharEditorPostitWidget();
    return;
  }
  document.getElementById("modalPost").classList.add("hidden");
  postEmEdicao = null;
}

function obterPosicaoNovoPost() {
  const larguraPost = 256;
  if (window.matchMedia("(max-width: 800px)").matches) {
    const posicaoVertical = posts.reduce((fim, post) => Math.max(
      fim,
      (Number(post.y) || 16) + (Number(post.altura) || 160) + 24
    ), 16);
    return { x: 16, y: posicaoVertical };
  }

  const colunas = Math.max(1, Math.floor((canvasPosts.clientWidth - 32) / larguraPost));
  return {
    x: 16 + (posts.length % colunas) * larguraPost,
    y: 16 + Math.floor(posts.length / colunas) * 250
  };
}

async function salvarPost() {
  const titulo = document.getElementById("inputTituloPost").value.trim();
  const descricao = document.getElementById("inputDescricaoPost").value.trim();
  const cor = document.getElementById("inputCorPost").value;
  const modalPost = document.getElementById("modalPost");
  const postitWidgetId = modalPost.dataset.widgetPostitId;
  if (postitWidgetId) {
    const postits = lerPostitsWidget();
    const postit = postits.find(item => item.id === postitWidgetId);
    if (!postit) return fecharEditorPostitWidget();
    postit.titulo = titulo || "Post-it";
    postit.texto = descricao;
    postit.cor = cor;
    salvarPostitsWidget(postits);
    fecharEditorPostitWidget();
    renderizarPostitsWidget();
    return;
  }
  if (!titulo) {
    alert("Informe um título para o post-it.");
    return;
  }

  const botao = document.getElementById("btnSalvarPost");
  botao.disabled = true;
  try {
    const edicao = Boolean(postEmEdicao);
    const posicao = edicao ? {} : obterPosicaoNovoPost();
    const response = await fetch(
      edicao ? `/posts/${userId}/${postEmEdicao._id}` : `/posts/${userId}`,
      {
        method: edicao ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo, descricao, cor, ...posicao })
      }
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Não foi possível salvar o post-it");

    if (edicao) {
      posts = posts.map(post => post._id === result._id ? result : post);
    } else {
      posts.push(result);
    }
    fecharModalPost();
    renderizarPosts();
  } catch (error) {
    console.error(error);
    alert(error.message || "Não foi possível salvar o post-it.");
  } finally {
    botao.disabled = false;
  }
}

async function excluirPost(postId, confirmar = true) {
  if (confirmar && !window.confirm("Deseja excluir este post-it?")) return false;
  try {
    const response = await fetch(`/posts/${userId}/${postId}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Não foi possível excluir o post-it");
    posts = posts.filter(post => post._id !== postId);
    renderizarPosts();
    return true;
  } catch (error) {
    console.error(error);
    alert(error.message || "Não foi possível excluir o post-it.");
    return false;
  }
}

function atualizarPosicaoLixeiraPosts() {
  const lixeira = document.getElementById("lixeiraPosts");
  if (!lixeira || !quadroPosts) return;
  const secaoVisivel = document.getElementById("containerNotas").classList.contains("show");
  const quadro = quadroPosts.getBoundingClientRect();
  lixeira.hidden = !secaoVisivel || quadro.width === 0 || quadro.height === 0;
}

function postEstaSobreLixeira(x, y) {
  const lixeira = document.getElementById("lixeiraPosts");
  if (!lixeira || lixeira.hidden) return false;
  const bounds = lixeira.getBoundingClientRect();
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function iniciarArrastePost(event) {
  if (window.matchMedia("(max-width: 800px)").matches || event.pointerType !== "mouse") return;
  if (!(event.target instanceof Element) || event.button !== 0) return;
  const alcaRedimensionar = event.target.closest(".alcaRedimensionarPost");
  const cardRedimensionar = alcaRedimensionar?.closest(".postIt");
  if (cardRedimensionar) {
    arrastePostAtivo = {
      modo: "redimensionar",
      card: cardRedimensionar,
      pointerId: event.pointerId,
      xInicial: cardRedimensionar.offsetLeft,
      yInicial: cardRedimensionar.offsetTop,
      larguraInicial: cardRedimensionar.offsetWidth,
      alturaInicial: cardRedimensionar.offsetHeight,
      largura: cardRedimensionar.offsetWidth,
      altura: cardRedimensionar.offsetHeight,
      inicioX: event.clientX,
      inicioY: event.clientY
    };
    cardRedimensionar.classList.add("redimensionandoPost");
    event.preventDefault();
    return;
  }

  const cabecalho = event.target.closest(".cabecalhoPost");
  const card = cabecalho?.closest(".postIt");
  if (!card || event.target.closest(".acoesPost")) return;

  const bounds = card.getBoundingClientRect();
  arrastePostAtivo = {
    modo: "mover",
    card,
    pointerId: event.pointerId,
    offsetX: event.clientX - bounds.left,
    offsetY: event.clientY - bounds.top,
    xInicial: card.offsetLeft,
    yInicial: card.offsetTop,
    x: card.offsetLeft,
    y: card.offsetTop
  };
  card.classList.add("arrastandoPost");
  document.getElementById("lixeiraPosts").classList.add("arrasteAtivo");
  atualizarPosicaoLixeiraPosts();
  event.preventDefault();
}

function moverPostComPonteiro(event) {
  if (!arrastePostAtivo || event.pointerId !== arrastePostAtivo.pointerId) return;
  if (arrastePostAtivo.modo === "redimensionar") {
    const resize = arrastePostAtivo;
    const maxWidth = Math.max(180, Math.min(900, canvasPosts.clientWidth - resize.card.offsetLeft));
    resize.largura = Math.min(maxWidth, Math.max(180,
      resize.larguraInicial + event.clientX - resize.inicioX
    ));
    resize.altura = Math.min(1000, Math.max(130,
      resize.alturaInicial + event.clientY - resize.inicioY
    ));
    resize.card.style.width = `${resize.largura}px`;
    resize.card.style.height = `${resize.altura}px`;
    ajustarAlturaQuadroPosts();
    event.preventDefault();
    return;
  }

  const bounds = canvasPosts.getBoundingClientRect();
  const { card } = arrastePostAtivo;
  const maxX = Math.max(0, canvasPosts.clientWidth - card.offsetWidth);
  const x = Math.min(10000, maxX, Math.max(0, Math.round(
    event.clientX - bounds.left - arrastePostAtivo.offsetX
  )));
  const y = Math.min(10000 - card.offsetHeight, Math.max(0, Math.round(
    event.clientY - bounds.top - arrastePostAtivo.offsetY
  )));

  arrastePostAtivo.x = x;
  arrastePostAtivo.y = y;
  card.style.left = `${x}px`;
  card.style.top = `${y}px`;
  document.getElementById("lixeiraPosts").classList.toggle("alvoAtivo", postEstaSobreLixeira(event.clientX, event.clientY));
  ajustarAlturaQuadroPosts();
  event.preventDefault();
}

async function finalizarArrastePost(event, cancelado = false) {
  if (!arrastePostAtivo || event.pointerId !== arrastePostAtivo.pointerId) return;
  const arraste = arrastePostAtivo;
  const descartar = !cancelado && arraste.modo === "mover" && postEstaSobreLixeira(event.clientX, event.clientY);
  arrastePostAtivo = null;
  arraste.card.classList.remove("arrastandoPost");
  arraste.card.classList.remove("redimensionandoPost");
  const lixeira = document.getElementById("lixeiraPosts");
  lixeira.classList.remove("arrasteAtivo", "alvoAtivo");

  if (cancelado) {
    if (arraste.modo === "redimensionar") {
      arraste.card.style.width = `${arraste.larguraInicial}px`;
      arraste.card.style.height = `${arraste.alturaInicial}px`;
    } else {
      arraste.card.style.left = `${arraste.xInicial}px`;
      arraste.card.style.top = `${arraste.yInicial}px`;
    }
    ajustarAlturaQuadroPosts();
    return;
  }
  if (descartar) {
    const excluido = await excluirPost(arraste.card.dataset.postId, false);
    if (!excluido) {
      arraste.card.style.left = `${arraste.xInicial}px`;
      arraste.card.style.top = `${arraste.yInicial}px`;
      ajustarAlturaQuadroPosts();
    }
    return;
  }
  const alterou = arraste.modo === "redimensionar"
    ? arraste.largura !== arraste.larguraInicial || arraste.altura !== arraste.alturaInicial
    : arraste.x !== arraste.xInicial || arraste.y !== arraste.yInicial;
  if (!alterou) return;

  const post = posts.find(item => item._id === arraste.card.dataset.postId);
  if (post) {
    if (arraste.modo === "redimensionar") {
      post.largura = arraste.largura;
      post.altura = arraste.altura;
    } else {
      post.x = arraste.x;
      post.y = arraste.y;
    }
  }
  try {
    const response = await fetch(`/posts/${userId}/${arraste.card.dataset.postId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(arraste.modo === "redimensionar"
        ? { largura: arraste.largura, altura: arraste.altura }
        : { x: arraste.x, y: arraste.y })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Não foi possível salvar a posição");
  } catch (error) {
    console.error(error);
    if (post) {
      if (arraste.modo === "redimensionar") {
        arraste.card.style.width = `${arraste.larguraInicial}px`;
        arraste.card.style.height = `${arraste.alturaInicial}px`;
        post.largura = arraste.larguraInicial;
        post.altura = arraste.alturaInicial;
      } else {
        arraste.card.style.left = `${arraste.xInicial}px`;
        arraste.card.style.top = `${arraste.yInicial}px`;
        post.x = arraste.xInicial;
        post.y = arraste.yInicial;
      }
    }
    ajustarAlturaQuadroPosts();
    alert(error.message || "Não foi possível salvar a posição do post-it.");
  }
}

quadroPosts = document.getElementById("quadroPosts");
canvasPosts = document.getElementById("canvasPosts");
canvasPosts.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  const card = event.target.closest(".postIt");
  if (!card) return;
  if (event.target.closest(".editarPost")) abrirModalPost(card.dataset.postId);
  if (event.target.closest(".excluirPost")) excluirPost(card.dataset.postId);
});
canvasPosts.addEventListener("pointerdown", iniciarArrastePost);
let larguraCanvasPostsRenderizada = canvasPosts.clientWidth;
window.addEventListener("resize", () => {
  const novaLargura = canvasPosts.clientWidth;
  if (novaLargura === larguraCanvasPostsRenderizada || arrastePostAtivo) return;
  larguraCanvasPostsRenderizada = novaLargura;
  if (posts.length) renderizarPosts();
});
document.addEventListener("pointermove", moverPostComPonteiro);
document.addEventListener("pointerup", event => finalizarArrastePost(event));
document.addEventListener("pointercancel", event => finalizarArrastePost(event, true));
window.addEventListener("resize", atualizarPosicaoLixeiraPosts);
window.addEventListener("scroll", atualizarPosicaoLixeiraPosts, true);

window.addEventListener("DOMContentLoaded", () => {
  const firstSection = document.getElementById("containerTarefas");
  firstSection.style.removeProperty("display");
  firstSection.classList.add("show");

  document.querySelector(".option").classList.add("active");

  const dialogoTemas = document.getElementById("dialogTemas");
  const statusTemas = document.getElementById("statusTemas");
  const opcoesTema = Array.from(document.querySelectorAll("[data-theme-option]"));
  const corTemaPersonalizado = document.getElementById("corTemaPersonalizado");
  const modoTemaPersonalizado = document.getElementById("modoTemaPersonalizado");
  const amostraTemaPersonalizado = document.querySelector(".dialog-tema-amostra-personalizado");
  const editorTemaPersonalizado = document.getElementById("editorTemaPersonalizado");
  let audioTemaAtivo = null;
  let limiteAudioTema = null;
  const tocarSomTema = tema => {
    const sonsTemas = {
      halloween: "/sons/temaHalloween.mp3",
      natal: "/sons/temanatal.mp3"
    };
    const arquivo = sonsTemas[tema];
    if (!arquivo) return;

    if (audioTemaAtivo) {
      audioTemaAtivo.pause();
      audioTemaAtivo.currentTime = 0;
    }
    if (limiteAudioTema !== null) {
      window.clearTimeout(limiteAudioTema);
      limiteAudioTema = null;
    }

    const audio = new Audio(arquivo);
    audioTemaAtivo = audio;
    const pararAudio = () => {
      if (audioTemaAtivo !== audio) return;
      audio.pause();
      audio.currentTime = 0;
      audioTemaAtivo = null;
      if (limiteAudioTema !== null) {
        window.clearTimeout(limiteAudioTema);
        limiteAudioTema = null;
      }
    };
    audio.addEventListener("timeupdate", () => {
      if (audio.currentTime >= 10) pararAudio();
    });
    audio.addEventListener("ended", pararAudio, { once: true });
    limiteAudioTema = window.setTimeout(pararAudio, 10000);
    void audio.play().catch(error => {
      pararAudio();
      console.warn(`Não foi possível reproduzir o som do tema ${tema}.`, error);
    });
  };
  const atualizarTemaSelecionado = tema => {
    opcoesTema.forEach(opcao => {
      opcao.setAttribute("aria-pressed", String(opcao.dataset.themeOption === tema));
    });
    editorTemaPersonalizado.hidden = tema !== "custom";
  };

  const temaEspecialInicial = document.documentElement.dataset.specialTheme;
  const temaInicial = ["halloween", "natal", "orby-vannila", "custom"].includes(temaEspecialInicial)
    ? temaEspecialInicial
    : document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  let temaSelecionadoAtual = temaInicial;
  const animarTrocaTema = tema => {
    if (tema === temaSelecionadoAtual) return;
    temaSelecionadoAtual = tema;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    dialogoTemas.querySelector(".transicao-tema")?.remove();
    const detalhesTemas = {
      light: { nome: "Tema claro", icone: "bi-sun", particula: "✦" },
      dark: { nome: "Tema escuro", icone: "bi-moon-stars", particula: "✧" },
      halloween: { nome: "Halloween", icone: "bi-moon-stars", particula: "✦" },
      natal: { nome: "Natal", icone: "bi-snow2", particula: "❄" },
      "orby-vannila": { nome: "Orby Vannila", icone: "bi-stars", particula: "✿" },
      custom: { nome: "Tema personalizado", icone: "bi-palette", particula: "✦" }
    };
    const detalhes = detalhesTemas[tema];
    if (!detalhes) return;

    const transicao = document.createElement("div");
    transicao.className = `transicao-tema transicao-tema-${tema}`;
    transicao.setAttribute("aria-hidden", "true");
    if (tema === "custom") {
      transicao.style.setProperty(
        "--transicao-cor",
        getComputedStyle(document.documentElement).getPropertyValue("--ui-primary")
      );
    }

    const particulas = [-25, -15, -5, 5, 15, 25, -20, -10, 0, 10, 20, 30];
    particulas.forEach((posicao, indice) => {
      const particula = document.createElement("span");
      particula.className = "transicao-tema-particula";
      particula.textContent = detalhes.particula;
      particula.style.left = `${posicao + 50}%`;
      particula.style.animationDelay = `${(indice % 6) * 70}ms`;
      transicao.append(particula);
    });

    const destaque = document.createElement("div");
    destaque.className = "transicao-tema-destaque";
    const icone = document.createElement("i");
    icone.className = `bi ${detalhes.icone}`;
    icone.setAttribute("aria-hidden", "true");
    const nome = document.createElement("span");
    nome.textContent = detalhes.nome;
    destaque.append(icone, nome);
    transicao.append(destaque);
    transicao.addEventListener("animationend", event => {
      if (event.target === transicao) transicao.remove();
    }, { once: true });
    dialogoTemas.append(transicao);
    window.setTimeout(() => transicao.remove(), 1300);
  };
  const preferenciasTemaPersonalizado = window.orbyCustomTheme || { color: "#174c32", mode: "light" };
  corTemaPersonalizado.value = preferenciasTemaPersonalizado.color;
  modoTemaPersonalizado.value = preferenciasTemaPersonalizado.mode;
  amostraTemaPersonalizado.style.setProperty("--amostra-personalizada", preferenciasTemaPersonalizado.color);
  amostraTemaPersonalizado.classList.toggle("amostra-personalizada-escura", preferenciasTemaPersonalizado.mode === "dark");
  atualizarTemaSelecionado(temaInicial);
  const atualizarPreviaTemaPersonalizado = () => {
    amostraTemaPersonalizado.style.setProperty("--amostra-personalizada", corTemaPersonalizado.value);
    amostraTemaPersonalizado.classList.toggle("amostra-personalizada-escura", modoTemaPersonalizado.value === "dark");
  };
  const atualizarTemaPersonalizadoSeAtivo = () => {
    atualizarPreviaTemaPersonalizado();
    if (document.documentElement.dataset.specialTheme === "custom") {
      aplicarTemaPersonalizado();
    }
  };
  corTemaPersonalizado.addEventListener("input", atualizarTemaPersonalizadoSeAtivo);
  modoTemaPersonalizado.addEventListener("change", atualizarTemaPersonalizadoSeAtivo);
  const aplicarTemaPersonalizado = () => {
    try {
      if (typeof window.orbyThemeStorageKey !== "string") {
        throw new Error("A chave de armazenamento do tema não está disponível.");
      }
      if (typeof window.orbyCustomThemeStorageKey !== "string") {
        throw new Error("A chave de armazenamento do tema personalizado não está disponível.");
      }
      if (typeof window.orbyApplyCustomTheme !== "function") {
        throw new Error("A aplicação do tema personalizado não está disponível.");
      }
      const preferencias = {
        color: corTemaPersonalizado.value,
        mode: modoTemaPersonalizado.value
      };
      window.orbyApplyCustomTheme(preferencias.color, preferencias.mode);
      atualizarTemaSelecionado("custom");
      statusTemas.hidden = true;
      localStorage.setItem(window.orbyCustomThemeStorageKey, JSON.stringify(preferencias));
      localStorage.setItem(window.orbyThemeStorageKey, "custom");
    } catch (error) {
      console.error("Não foi possível salvar o tema personalizado.", error);
      statusTemas.textContent = "O tema foi aplicado, mas não foi possível salvá-lo neste dispositivo.";
      statusTemas.hidden = false;
    }
  };
  document.getElementById("abrirTemas").addEventListener("click", () => {
    document.querySelectorAll(".mini-modal").forEach(modal => { modal.style.display = "none"; });
    statusTemas.hidden = true;
    if (typeof dialogoTemas.showModal === "function") dialogoTemas.showModal();
    else dialogoTemas.setAttribute("open", "");
  });
  document.getElementById("fecharDialogTemas").addEventListener("click", () => {
    if (typeof dialogoTemas.close === "function") dialogoTemas.close();
    else dialogoTemas.removeAttribute("open");
  });
  dialogoTemas.addEventListener("click", event => {
    if (event.target === dialogoTemas && typeof dialogoTemas.close === "function") dialogoTemas.close();
  });
  opcoesTema.forEach(opcao => {
    opcao.addEventListener("click", () => {
      const tema = opcao.dataset.themeOption;
      try {
        if (typeof window.orbyThemeStorageKey !== "string") {
          throw new Error("A chave de armazenamento do tema não está disponível.");
        }
        if (tema === "custom") {
          aplicarTemaPersonalizado();
          animarTrocaTema(tema);
          return;
        } else if (["light", "dark", "halloween", "natal", "orby-vannila"].includes(tema)) {
          if (typeof window.orbyClearCustomTheme !== "function") {
            throw new Error("A restauração dos temas padrão não está disponível.");
          }
          window.orbyClearCustomTheme();
          document.documentElement.dataset.theme = tema === "dark" || tema === "halloween" ? "dark" : "light";
          if (["halloween", "natal", "orby-vannila"].includes(tema)) {
            document.documentElement.dataset.specialTheme = tema;
          }
        } else {
          return;
        }
        atualizarTemaSelecionado(tema);
        statusTemas.hidden = true;
        tocarSomTema(tema);
        animarTrocaTema(tema);
        localStorage.setItem(window.orbyThemeStorageKey, tema);
      } catch (error) {
        console.error("Não foi possível salvar o tema selecionado.", error);
        statusTemas.textContent = "O tema foi aplicado, mas não foi possível salvá-lo neste dispositivo.";
        statusTemas.hidden = false;
      }
    });
  });
});

//função para trocar mensagem de saúde
const mensagens = [
  "Manter uma boa hidratação ao longo do dia é essencial para o funcionamento do corpo, ajudando na digestão, na circulação sanguínea e na manutenção dos níveis de energia.",
  "Dormir bem não é luxo, é necessidade. Uma boa noite de sono contribui para a recuperação muscular, melhora a memória e fortalece o sistema imunológico.",
  "Praticar atividade física regularmente ajuda a reduzir o estresse, melhora o humor e aumenta a sensação de bem-estar ao longo do dia.",
  "Uma alimentação equilibrada, rica em frutas, legumes e verduras, fornece os nutrientes necessários para manter o corpo saudável e prevenir doenças.",
  "Fazer pequenas pausas durante o dia para se alongar ajuda a evitar dores musculares, melhora a postura e aumenta a produtividade.",
  "Cuidar da saúde mental é tão importante quanto cuidar da saúde física, pois o equilíbrio emocional influencia diretamente na qualidade de vida.",
  "Caminhar por pelo menos 30 minutos por dia ajuda a fortalecer o coração, melhora a circulação e contribui para a manutenção do peso corporal.",
  "Reduzir o consumo de alimentos ultraprocessados é uma escolha inteligente para melhorar a digestão e aumentar os níveis de energia.",
  "Respirar de forma consciente por alguns minutos pode reduzir a ansiedade e ajudar a relaxar o corpo e a mente.",
  "Manter horários regulares para as refeições ajuda o metabolismo a funcionar melhor e evita exageros alimentares.",
  "A prática de exercícios físicos contribui para o fortalecimento dos músculos e ossos, prevenindo lesões e problemas articulares.",
  "Beber água mesmo sem sentir sede ajuda a manter o corpo hidratado e melhora o funcionamento dos órgãos.",
  "Uma rotina saudável impacta diretamente na disposição, na concentração e no desempenho diário.",
  "Comer devagar e com atenção ajuda na digestão e aumenta a sensação de saciedade.",
  "Evitar o excesso de açúcar na alimentação contribui para níveis mais estáveis de energia ao longo do dia.",
  "Alongar-se diariamente ajuda a manter a flexibilidade e reduz o risco de lesões.",
  "Praticar exercícios regularmente melhora a qualidade do sono e facilita o descanso do corpo.",
  "Cuidar da postura durante o trabalho evita dores nas costas e no pescoço.",
  "Manter-se ativo mesmo em dias corridos faz diferença para a saúde a longo prazo.",
  "Uma alimentação balanceada contribui para o bom funcionamento do sistema imunológico.",
  "Evitar longos períodos sentado ajuda a melhorar a circulação sanguínea.",
  "A atividade física regular ajuda a controlar a ansiedade e melhora o bem-estar emocional.",
  "Incluir alimentos naturais na dieta é uma forma simples de cuidar da saúde.",
  "Manter uma rotina de exercícios melhora a resistência física e mental.",
  "Pequenos hábitos saudáveis, quando praticados diariamente, geram grandes resultados ao longo do tempo.",
  "Dormir cedo ajuda o corpo a se recuperar melhor das atividades do dia.",
  "Manter o equilíbrio entre trabalho, descanso e lazer é essencial para a saúde.",
  "Exercícios de força ajudam a preservar a massa muscular com o passar do tempo.",
  "Evitar o excesso de sal contribui para a saúde do coração.",
  "Movimentar-se ao longo do dia ajuda a manter o corpo ativo e saudável.",
  "Uma boa alimentação influencia diretamente no humor e na disposição.",
  "Cuidar do corpo hoje é um investimento na sua saúde futura.",
  "A prática regular de exercícios reduz o risco de diversas doenças.",
  "Manter-se hidratado melhora a concentração e o desempenho mental.",
  "Alongamentos ajudam a aliviar tensões acumuladas no corpo.",
  "Evitar telas antes de dormir contribui para uma melhor qualidade do sono.",
  "Criar uma rotina saudável facilita a manutenção de bons hábitos.",
  "Exercícios físicos ajudam a fortalecer o sistema imunológico.",
  "Alimentar-se bem melhora a recuperação muscular após exercícios.",
  "O descanso adequado é essencial para o bom funcionamento do organismo.",
  "Manter hábitos saudáveis aumenta a longevidade.",
  "Exercícios melhoram a circulação e a saúde cardiovascular.",
  "Cuidar da saúde é um compromisso diário consigo mesmo.",
  "A prática de atividades físicas melhora a autoestima.",
  "Beber água regularmente ajuda na eliminação de toxinas.",
  "Manter uma alimentação equilibrada ajuda no controle do peso.",
  "A saúde é construída com escolhas diárias.",
  "Movimento é essencial para uma vida mais saudável.",
  "Cuidar de si mesmo reflete em mais qualidade de vida."
];

const boxMensagem = document.querySelector(".divBoxMensagem");
let ultimoIndice = -1;

function trocarMensagemAleatoria() {
  let indice;
  do {
    indice = Math.floor(Math.random() * mensagens.length);
  } while (indice === ultimoIndice);

  ultimoIndice = indice;

  boxMensagem.textContent = mensagens[indice];
  boxMensagem.classList.remove("animar");
  void boxMensagem.offsetWidth; // força reflow
  boxMensagem.classList.add("animar");
}

//funcao de calendario

const monthYear = document.getElementById("monthYear");
const calendarDays = document.getElementById("calendarDays");

let currentDate = new Date();
let diasComTarefasNoMes = new Set();
let versaoCalendario = 0;

function obterFeriadosNacionais(ano) {
  const feriados = new Map([
    [`${ano}-01-01`, "Confraternização Universal"],
    [`${ano}-04-21`, "Tiradentes"],
    [`${ano}-05-01`, "Dia do Trabalho"],
    [`${ano}-09-07`, "Independência do Brasil"],
    [`${ano}-10-12`, "Nossa Senhora Aparecida"],
    [`${ano}-11-02`, "Finados"],
    [`${ano}-11-15`, "Proclamação da República"],
    [`${ano}-11-20`, "Dia Nacional de Zumbi e da Consciência Negra"],
    [`${ano}-12-25`, "Natal"]
  ]);

  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mesPascoa = Math.floor((h + l - 7 * m + 114) / 31);
  const diaPascoa = (h + l - 7 * m + 114) % 31 + 1;
  const sextaSanta = new Date(ano, mesPascoa - 1, diaPascoa - 2);
  const chaveSextaSanta = [
    sextaSanta.getFullYear(),
    String(sextaSanta.getMonth() + 1).padStart(2, "0"),
    String(sextaSanta.getDate()).padStart(2, "0")
  ].join("-");
  feriados.set(chaveSextaSanta, "Sexta-feira Santa");

  return feriados;
}

async function carregarDiasComTarefasDoMes() {
  if (!userId) return;

  const versao = ++versaoCalendario;
  const ano = currentDate.getFullYear();
  const mes = currentDate.getMonth() + 1;
  try {
    const res = await fetch(`/tarefas/${userId}/calendario?ano=${ano}&mes=${mes}`);
    const dias = await res.json();
    if (!res.ok) throw new Error(dias.erro || "Erro ao carregar dias com tarefas");
    if (versao !== versaoCalendario) return;

    diasComTarefasNoMes = new Set(dias);
    renderCalendar();
  } catch (error) {
    console.error(error);
  }
}

function renderCalendar() {
  calendarDays.innerHTML = "";

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const feriadosNacionais = obterFeriadosNacionais(year);

  monthYear.textContent = currentDate.toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric"
  });

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();

  // espaços vazios
  for (let i = 0; i < firstDay; i++) {
    calendarDays.appendChild(document.createElement("span"));
  }

  for (let day = 1; day <= lastDate; day++) {
    const span = document.createElement("span");
    span.textContent = day;
    span.style.setProperty("--dia-posicao", (day - 1) % 7);

    const fullDate = new Date(year, month, day);
    span.dataset.date = [
      year,
      String(month + 1).padStart(2, "0"),
      String(day).padStart(2, "0")
    ].join("-");

    const nomeFeriado = feriadosNacionais.get(span.dataset.date);
    if (nomeFeriado) {
      span.classList.add("feriado");
      span.title = `Feriado nacional: ${nomeFeriado}`;
    }

    if (diasComTarefasNoMes.has(span.dataset.date)) {
      span.classList.add("has-tasks");
      span.title = [span.title, "Tem tarefas neste dia"].filter(Boolean).join(" · ");
    }

    // hoje
    const today = new Date();
    if (
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear()
    ) {
      span.classList.add("today");
    }
    if (
      day === dataSelecionada.getDate() &&
      month === dataSelecionada.getMonth() &&
      year === dataSelecionada.getFullYear()
    ) {
      span.classList.add("selected");
    }



    // 🔥 clique no dia
    span.addEventListener("click", () => {
      document
        .querySelectorAll(".calendar-days span")
        .forEach(d => d.classList.remove("selected"));

      span.classList.add("selected");

      dataSelecionada = new Date(fullDate);
      dataSelecionada.setHours(0, 0, 0, 0);

      atualizarTituloData(dataSelecionada);
      carregarTarefasPorData(userId, dataSelecionada);
    });

    calendarDays.appendChild(span);
  }
}


document.getElementById("prevMonth").onclick = () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  diasComTarefasNoMes = new Set();
  renderCalendar();
  carregarDiasComTarefasDoMes();
};

document.getElementById("nextMonth").onclick = () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  diasComTarefasNoMes = new Set();
  renderCalendar();
  carregarDiasComTarefasDoMes();
};

document.getElementById("todayButton").onclick = () => {
  const today = new Date();
  currentDate = new Date(today.getFullYear(), today.getMonth(), 1);
  diasComTarefasNoMes = new Set();
  dataSelecionada = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  dataSelecionada.setHours(0, 0, 0, 0);
  renderCalendar();
  atualizarTituloData(dataSelecionada);
  carregarTarefasPorData(userId, dataSelecionada);
  carregarDiasComTarefasDoMes();
};

renderCalendar();
carregarDiasComTarefasDoMes();

//função para atualizar a hora atual
const horaContainer = document.getElementById("horaAtual");
let valorAtual = "";

function formatarHora() {
  const agora = new Date();
  return `${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`;
}

function atualizarHora() {
  const novoValor = formatarHora();
  if (novoValor === valorAtual) return;

  const antiga = document.createElement("div");
  antiga.className = "hora atual";
  antiga.textContent = valorAtual || novoValor;

  const nova = document.createElement("div");
  nova.className = "hora entrando";
  nova.textContent = novoValor;

  horaContainer.innerHTML = "";
  horaContainer.appendChild(antiga);
  horaContainer.appendChild(nova);

  // força render
  requestAnimationFrame(() => {
    antiga.classList.add("saindo");
    nova.classList.remove("entrando");
    nova.classList.add("atual");
  });

  valorAtual = novoValor;
}

function iniciarRelogio() {
  atualizarHora();

  const agora = new Date();
  const delay = (60 - agora.getSeconds()) * 1000;

  setTimeout(() => {
    atualizarHora();
    setInterval(atualizarHora, 60000);
  }, delay);
}

iniciarRelogio();

let filtroAtual = "pendentes";
let tarefasDoDia = [];
let tarefasVisiveisDoDia = [];
let tarefasImportantesVisiveis = [];
let tarefaEmEdicao = null;
let notificacoesInicializadas = false;
let idsNotificadosNoNavegador = new Set();
let versaoNotificacoes = 0;
let limpandoNotificacoes = false;
const sonsEventos = {
  tarefa: new Audio("/sons/somparatarefa.mp3"),
  habito: new Audio("/sons/somparahabito.mp3"),
  conclusao: new Audio("/sons/somparaconcluirtarefa.mp3")
};

function tocarSomEvento(tipo) {
  const audio = sonsEventos[tipo];
  if (!audio) return;

  audio.currentTime = 0;
  void audio.play().catch(error => {
    console.warn(`Não foi possível reproduzir o som de ${tipo}.`, error);
  });
}

function notificacoesLocaisNativas() {
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  return window.capacitorLocalNotifications?.LocalNotifications || null;
}

function pushNotificationsNativas() {
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  return window.Capacitor.Plugins?.PushNotifications ||
    window.Capacitor.registerPlugin?.("PushNotifications") || null;
}

let listenersPushNativosConfigurados = false;

async function salvarTokenFcm(token) {
  if (notificacoesTarefasDesativadas || !userId || !token) return;
  const response = await fetch(`/notificacoes/${encodeURIComponent(userId)}/fcm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token })
  });
  const resultado = await response.json();
  if (!response.ok) throw new Error(resultado.erro || "Não foi possível registrar o aparelho no Firebase.");
  localStorage.setItem("orbyFcmToken", token);
  localStorage.setItem("orbyFcmPushEnabled", String(resultado.pushEnabled === true));
  sincronizacaoAndroidPushAtiva = resultado.pushEnabled === true;
  const sincronizadorAndroid = sincronizadorAndroidNativo();
  if (!sincronizadorAndroid) {
    throw new Error("O sincronizador nativo não está disponível. Instale o APK atualizado.");
  }
  await sincronizadorAndroid.start({ userId, pushEnabled: sincronizacaoAndroidPushAtiva });
  sincronizacaoAndroidIniciada = true;
  if (sincronizacaoAndroidPushAtiva) await sincronizadorAndroid.syncTasks({ tasks: [] });
  agendarSincronizacaoNotificacoesTarefas();
  document.getElementById("statusPermissaoNotificacoes").textContent = resultado.pushEnabled
    ? "Notificações push do Firebase ativadas neste aparelho."
    : "Token registrado. Configure a conta de serviço Firebase no servidor para ativar o push; os lembretes locais seguem ativos.";
}

async function configurarPushNativo(solicitarPermissao = false) {
  const pushNotifications = pushNotificationsNativas();
  if (!pushNotifications || !userId) {
    if (notificacoesNativasEsperadas()) {
      document.getElementById("statusPermissaoNotificacoes").textContent =
        "Plugin de push ausente. Sincronize o projeto Android e gere um novo APK.";
    }
    return false;
  }

  if (!listenersPushNativosConfigurados) {
    listenersPushNativosConfigurados = true;
    await pushNotifications.addListener("registration", ({ value }) => {
      void salvarTokenFcm(value).catch(error => {
        console.error("Não foi possível registrar o token FCM no servidor:", error);
        document.getElementById("statusPermissaoNotificacoes").textContent =
          error.message || "Não foi possível ativar o push do Firebase.";
      });
    });
    await pushNotifications.addListener("registrationError", error => {
      console.error("O Firebase não registrou este aparelho para push:", error);
      document.getElementById("statusPermissaoNotificacoes").textContent =
        error.error || "O Firebase não conseguiu registrar este aparelho.";
    });
    await pushNotifications.addListener("pushNotificationActionPerformed", () => {
      void carregarNotificacoes();
      document.getElementById("botaoNotificacoes").click();
    });
  }

  let permissao = await pushNotifications.checkPermissions();
  if (solicitarPermissao && permissao.receive !== "granted") {
    permissao = await pushNotifications.requestPermissions();
  }
  if (permissao.receive !== "granted") {
    document.getElementById("statusPermissaoNotificacoes").textContent =
      "Permita notificações do Orby para ativar o push no celular.";
    return false;
  }

  await pushNotifications.createChannel({
    id: "orby_notifications",
    name: "Notificações do Orby",
    description: "Avisos de tarefas, hábitos e partidas",
    importance: 3,
    vibration: true
  });
  await pushNotifications.register();
  document.getElementById("statusPermissaoNotificacoes").textContent =
    "Permissão concedida. Conectando ao Firebase...";
  return true;
}

function sincronizadorAndroidNativo() {
  if (!window.Capacitor?.isNativePlatform?.()) return null;
  if (typeof window.Capacitor.registerPlugin === "function") {
    return window.Capacitor.registerPlugin("OrbyBackgroundSync");
  }
  return window.Capacitor.Plugins?.OrbyBackgroundSync || null;
}

function notificacoesNativasEsperadas() {
  return Boolean(window.Capacitor?.isNativePlatform?.());
}

function idNotificacaoTarefa(id) {
  const sufixo = Number.parseInt(String(id).slice(-8), 16);
  return (Number.isFinite(sufixo) ? sufixo : 0) % 2147483646 + 1;
}

let temporizadorSincronizacaoNotificacoesTarefas;
let sincronizacaoNotificacoesTarefasAtiva = false;
let sincronizacaoNotificacoesTarefasNovamente = false;
let notificacoesTarefasDesativadas = false;
let sincronizacaoAndroidIniciada = false;
let sincronizacaoAndroidPushAtiva = false;
let sincronizacaoNotificacoesTarefasPromise = Promise.resolve();

function agendarSincronizacaoNotificacoesTarefas() {
  if (!notificacoesLocaisNativas() || !userId || notificacoesTarefasDesativadas) return;
  clearTimeout(temporizadorSincronizacaoNotificacoesTarefas);
  temporizadorSincronizacaoNotificacoesTarefas = setTimeout(() => {
    sincronizacaoNotificacoesTarefasPromise = sincronizarNotificacoesTarefas();
  }, 250);
}

async function sincronizarNotificacoesTarefas() {
  const notificacoesLocais = notificacoesLocaisNativas();
  if (!notificacoesLocais || !userId || notificacoesTarefasDesativadas) {
    if (notificacoesNativasEsperadas() && !notificacoesLocais) {
      document.getElementById("statusPermissaoNotificacoes").textContent =
        "O plugin de notificações não foi carregado. Reinstale o APK atualizado.";
    }
    return;
  }
  if (sincronizacaoNotificacoesTarefasAtiva) {
    sincronizacaoNotificacoesTarefasNovamente = true;
    return;
  }

  sincronizacaoNotificacoesTarefasAtiva = true;
  try {
    const response = await fetch(`/tarefas/${encodeURIComponent(userId)}/notificacoes`, {
      cache: "no-store"
    });
    const tarefas = await response.json();
    if (!response.ok) throw new Error(tarefas.erro || "Não foi possível sincronizar os lembretes.");
    if (notificacoesTarefasDesativadas) return;

    const permissao = await notificacoesLocais.checkPermissions();
    if (permissao.display !== "granted") {
      document.getElementById("statusPermissaoNotificacoes").textContent =
        "Permita notificações do Orby no Android e toque em “Ativar notificações”.";
      return;
    }
    const pushAtivo = localStorage.getItem("orbyFcmPushEnabled") === "true";
    const alarmesExatos = pushAtivo
      ? { exact_alarm: "granted" }
      : await notificacoesLocais.checkExactNotificationSetting();
    if (alarmesExatos.exact_alarm !== "granted") {
      document.getElementById("statusPermissaoNotificacoes").textContent =
        "Permita alarmes exatos do Orby para agendar tarefas no horário.";
      return;
    }
    const sincronizadorAndroid = sincronizadorAndroidNativo();
    if (!sincronizadorAndroid) {
      throw new Error("O sincronizador nativo não está disponível. Instale o APK atualizado.");
    }
    if (!sincronizacaoAndroidIniciada) {
      await sincronizadorAndroid.start({
        userId,
        pushEnabled: sincronizacaoAndroidPushAtiva ||
          localStorage.getItem("orbyFcmPushEnabled") === "true"
      });
      sincronizacaoAndroidIniciada = true;
    }

    const pendentes = await notificacoesLocais.getPending();
    const lembretesAgendados = pendentes.notifications
      .filter(notificacao => notificacao.extra?.tarefaId)
      .map(notificacao => ({ id: notificacao.id }));
    if (lembretesAgendados.length) {
      await notificacoesLocais.cancel({ notifications: lembretesAgendados });
    }
    const alarmesNativos = await sincronizadorAndroid.syncTasks({
      tasks: pushAtivo ? [] : tarefas
        .filter(tarefa => !tarefa.concluida)
        .map(tarefa => ({
          taskId: tarefa._id,
          title: tarefa.tipo === "importante" ? "Tarefa importante" : "Tarefa no horário",
          body: tarefa.texto,
          triggerMs: new Date(tarefa.dataCriacao).getTime()
        }))
    });
    const totalAgendado = alarmesNativos.scheduled;
    document.getElementById("statusPermissaoNotificacoes").textContent = pushAtivo
      ? "Push Firebase ativo. Tarefas, hábitos e xadrez podem avisar com o app fechado."
      : totalAgendado
        ? `${totalAgendado} lembrete(s) agendado(s) no Android. Tarefas criadas pela web são verificadas aproximadamente a cada 1 minuto.`
        : "Sincronização nativa ativada. Nenhuma tarefa futura pendente.";
  } catch (error) {
    console.error("Não foi possível sincronizar as notificações de tarefas:", error);
    document.getElementById("statusPermissaoNotificacoes").textContent =
      `Não foi possível agendar os lembretes: ${error.message || "erro inesperado"}`;
  } finally {
    sincronizacaoNotificacoesTarefasAtiva = false;
    if (sincronizacaoNotificacoesTarefasNovamente) {
      sincronizacaoNotificacoesTarefasNovamente = false;
      agendarSincronizacaoNotificacoesTarefas();
    }
  }
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) agendarSincronizacaoNotificacoesTarefas();
});
window.addEventListener("focus", agendarSincronizacaoNotificacoesTarefas);

function valorBusca(id) {
  return document.getElementById(id).value.trim().toLocaleLowerCase("pt-BR");
}

async function carregarTarefasPorData(userId, data) {
  if (!userId || !data) return;

  const dataISO = data.toLocaleDateString("sv-SE");

  const container = document.getElementById("tarefas");
  try {
    const res = await fetch(`/tarefas/${userId}?data=${dataISO}`);
    const tarefas = await res.json();
    if (!res.ok) throw new Error(tarefas.erro || "Erro ao carregar tarefas");

    tarefasDoDia = tarefas;
    renderizarTarefasDoDia();
    agendarSincronizacaoNotificacoesTarefas();
  } catch (error) {
    console.error(error);
    container.textContent = "Não foi possível carregar as tarefas.";
  }
}

function renderizarTarefasDoDia() {
  const container = document.getElementById("tarefas");
  const concluidas = tarefasDoDia.filter(tarefa => tarefa.concluida).length;
  const resumo = document.getElementById("resumoTarefasDia");
  resumo.textContent = `${tarefasDoDia.length} ${tarefasDoDia.length === 1 ? "tarefa" : "tarefas"} · ${concluidas} ${concluidas === 1 ? "concluída" : "concluídas"}`;
  const busca = valorBusca("buscaTarefas");
  const tarefasFiltradas = tarefasDoDia.filter(tarefa =>
    (filtroAtual === "concluidas" ? tarefa.concluida : !tarefa.concluida) &&
    tarefa.texto.toLocaleLowerCase("pt-BR").includes(busca)
  );
  tarefasVisiveisDoDia = tarefasFiltradas;
  container.replaceChildren();

  if (tarefasFiltradas.length === 0) {
    const mensagem = document.createElement("p");
    mensagem.className = "sem-tarefas";
    mensagem.textContent = busca
      ? "Nenhuma tarefa corresponde à pesquisa."
      : filtroAtual === "concluidas"
        ? "Nenhuma tarefa concluída"
        : "Nenhuma tarefa pendente";
    container.appendChild(mensagem);
    return;
  }

  tarefasFiltradas.forEach(renderizarTarefa);
}

function atualizarIndicadorHorarioTarefa(horario) {
  const limite = Number(horario.dataset.horarioLimite);
  const tarefa = horario.closest(".tarefa, .tarefaImportante, .tarefas-importantes-widget-item");
  const concluida = tarefa?.classList.contains("done") || tarefa?.classList.contains("concluida") || tarefa?.dataset.concluida === "true";
  const atrasada = Number.isFinite(limite) && limite < Date.now() && !concluida;
  horario.classList.toggle("atrasado", atrasada);
  horario.title = atrasada ? "Horário ultrapassado" : "";
}

function atualizarIndicadoresHorariosTarefas() {
  document.querySelectorAll(".tarefa-hora[data-horario-limite]").forEach(atualizarIndicadorHorarioTarefa);
}

function renderizarTarefa(t) {
  const container = document.getElementById("tarefas");

  const dataObj = new Date(t.dataCriacao || t.data);

  const div = document.createElement("div");
  div.className = `tarefa${t.concluida ? " done" : ""}`;
  div.id = t._id;
  div.dataset.taskId = t._id;
  div.style.setProperty("--cor-tarefa",
    /^#[0-9a-fA-F]{6}$/.test(t.cor || "") ? t.cor : "#e73d3d");

  const handle = criarAlcaPrioridade();

  const texto = document.createElement("div");
  texto.className = "tarefa-texto";
  texto.textContent = t.texto;

  const info = document.createElement("div");
  info.className = "tarefa-info";

  const dataEl = document.createElement("div");
  dataEl.className = "tarefa-data";
  dataEl.textContent = dataObj.toLocaleDateString("pt-BR");

  const horaEl = document.createElement("div");
  horaEl.className = "tarefa-hora";
  horaEl.innerHTML = `
    <i class="bi bi-clock"></i>
    ${dataObj.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    })}
  `;
  horaEl.dataset.horarioLimite = String(dataObj.getTime());

  info.appendChild(dataEl);
  info.appendChild(horaEl);

  const btn = document.createElement("button");
  btn.className = "btn-toggle";
  btn.innerHTML = t.concluida
    ? `<i class="bi bi-arrow-counterclockwise" style="font-size:22px;"></i>`
    : `<i class="bi bi-circle icon-concluir" style="font-size:22px;"></i>`;


  btn.onclick = () => toggleTarefa(t._id);

  const editButton = document.createElement("button");
  editButton.className = "btnEditarTarefa";
  editButton.type = "button";
  editButton.setAttribute("aria-label", "Editar tarefa");
  editButton.title = "Editar tarefa";
  editButton.innerHTML = '<i class="bi bi-pencil"></i>';
  editButton.onclick = () => editarTarefa(t._id, t.texto, false);

  const deleteButton = document.createElement("button");
  deleteButton.className = "btnExcluirTarefa";
  deleteButton.type = "button";
  deleteButton.setAttribute("aria-label", "Excluir tarefa");
  deleteButton.title = "Excluir tarefa";
  deleteButton.innerHTML = '<i class="bi bi-trash"></i>';
  deleteButton.onclick = () => excluirTarefa(t._id);

  div.appendChild(handle);
  div.appendChild(texto);
  div.appendChild(info);
  div.appendChild(btn);
  div.appendChild(editButton);
  div.appendChild(deleteButton);

  container.appendChild(div);
  atualizarIndicadorHorarioTarefa(horaEl);
}

function criarAlcaPrioridade() {
  const handle = document.createElement("span");
  handle.className = "alcaTarefa";
  handle.title = "Arraste para alterar a prioridade";
  handle.setAttribute("aria-label", "Arraste para alterar a prioridade");
  handle.innerHTML = '<i class="bi bi-grip-vertical" aria-hidden="true"></i>';
  return handle;
}

function installTaskDragging(containerId, taskSelector, saveOrder, moveToDate) {
  const container = document.getElementById(containerId);
  let draggedItem = null;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let initialItems = [];
  let preview = null;
  let hoveredDate = null;
  let pendingFrame = null;
  let latestPointer = null;

  const currentItems = () =>
    Array.from(container.querySelectorAll(`${taskSelector}[data-task-id]`));

  const resetDrag = () => {
    draggedItem?.classList.remove("arrastando");
    preview?.remove();
    preview = null;
    hoveredDate?.classList.remove("dia-alvo-arraste");
    hoveredDate = null;
    if (pendingFrame !== null) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
    latestPointer = null;
    draggedItem = null;
    pointerId = null;
    moved = false;
    initialItems = [];
  };

  const updatePreview = (event) => {
    if (!preview) {
      preview = draggedItem.cloneNode(true);
      preview.removeAttribute("id");
      preview.removeAttribute("data-task-id");
      preview.classList.add("previewArrasteTarefa");
      preview.setAttribute("aria-hidden", "true");
      document.body.appendChild(preview);
    }

    const bounds = preview.getBoundingClientRect();
    const left = Math.max(8, Math.min(event.clientX + 14, window.innerWidth - bounds.width - 8));
    const top = Math.max(8, Math.min(event.clientY + 14, window.innerHeight - bounds.height - 8));
    preview.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  };

  container.addEventListener("pointerdown", event => {
    if (!(event.target instanceof Element) || (event.button !== 0 && event.pointerType === "mouse")) {
      return;
    }

    const handle = event.target.closest(".alcaTarefa");
    draggedItem = handle?.closest(taskSelector) || null;
    if (!draggedItem) return;

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    initialItems = currentItems();
    moved = false;
    draggedItem.classList.add("arrastando");
    event.preventDefault();
  });

  const processPointerMove = (clientX, clientY) => {
    if (!draggedItem) return;
    if (!moved && Math.hypot(clientX - startX, clientY - startY) < 4) return;
    moved = true;
    updatePreview({ clientX, clientY });

    const element = document.elementFromPoint(clientX, clientY);
    const dateTarget = moveToDate && element instanceof Element
      ? element.closest(".calendar-days [data-date]")
      : null;
    if (dateTarget && calendarDays.contains(dateTarget)) {
      hoveredDate?.classList.remove("dia-alvo-arraste");
      hoveredDate = dateTarget;
      hoveredDate.classList.add("dia-alvo-arraste");
      return;
    }
    hoveredDate?.classList.remove("dia-alvo-arraste");
    hoveredDate = null;

    const target = element instanceof Element ? element.closest(taskSelector) : null;
    if (target && (target === draggedItem || !container.contains(target))) return;

    let reference = null;
    if (target) {
      const bounds = target.getBoundingClientRect();
      const insertAfter = clientY >= bounds.top + bounds.height / 2;
      reference = insertAfter ? target.nextElementSibling : target;
    } else {
      const bounds = container.getBoundingClientRect();
      if (clientY < bounds.top || clientY > bounds.bottom) return;
      const items = currentItems().filter(item => item !== draggedItem);
      const first = items[0];
      const last = items.at(-1);
      if (first && clientY < first.getBoundingClientRect().top) reference = first;
      else if (!last || clientY > last.getBoundingClientRect().bottom) reference = null;
      else return;
    }

    if (reference !== draggedItem) {
      container.insertBefore(draggedItem, reference || null);
    }
  };

  document.addEventListener("pointermove", event => {
    if (!draggedItem || event.pointerId !== pointerId) return;
    if (!moved && Math.hypot(event.clientX - startX, event.clientY - startY) < 4) return;

    moved = true;
    event.preventDefault();
    latestPointer = { clientX: event.clientX, clientY: event.clientY };
    if (pendingFrame !== null) return;

    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      if (latestPointer) {
        processPointerMove(latestPointer.clientX, latestPointer.clientY);
      }
    });
  });

  const finishDrag = (event, cancelled = false) => {
    if (!draggedItem || event.pointerId !== pointerId) return;

    const item = draggedItem;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const dateTarget = moveToDate && element instanceof Element
      ? element.closest(".calendar-days [data-date]")
      : null;
    if (!cancelled && moved && dateTarget && calendarDays.contains(dateTarget)) {
      moveToDate(item.dataset.taskId, dateTarget.dataset.date);
    } else if (cancelled && moved) {
      for (const originalItem of initialItems) container.appendChild(originalItem);
    } else if (moved) {
      const ids = currentItems().map(task => task.dataset.taskId);
      const initialIds = initialItems.map(task => task.dataset.taskId);
      if (ids.some((id, index) => id !== initialIds[index])) saveOrder(ids);
    }

    item.classList.remove("arrastando");
    resetDrag();
  };

  document.addEventListener("pointerup", event => finishDrag(event));
  document.addEventListener("pointercancel", event => finishDrag(event, true));

  container.addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest(".alcaTarefa")) {
      event.preventDefault();
    }
  });
}

async function moverTarefaParaData(tarefaId, data, importante) {
  const tarefas = importante ? tarefasDoFiltroImportante : tarefasDoDia;
  const tarefa = tarefas.find(item => item._id === tarefaId);
  if (!tarefa || !data) return;

  const dataAtual = new Date(tarefa.dataCriacao);
  const hora = String(dataAtual.getHours()).padStart(2, "0");
  const minuto = String(dataAtual.getMinutes()).padStart(2, "0");
  const endpoint = importante
    ? `/tarefas/importantes/${userId}/${tarefaId}`
    : `/tarefas/${userId}/${tarefaId}`;

  try {
    const response = await fetch(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, hora, minuto })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Erro ao mover tarefa");

    if (importante) {
      await carregarTarefasImportantes();
    } else {
      const [ano, mes, dia] = data.split("-").map(Number);
      dataSelecionada = new Date(ano, mes - 1, dia);
      dataSelecionada.setHours(0, 0, 0, 0);
      currentDate = new Date(ano, mes - 1, 1);
      diasComTarefasNoMes = new Set();
      renderCalendar();
      carregarDiasComTarefasDoMes();
      atualizarTituloData(dataSelecionada);
      await carregarTarefasPorData(userId, dataSelecionada);
    }
  } catch (error) {
    console.error(error);
    alert(error.message || "Não foi possível mover a tarefa para esse dia.");
  }
}

function mergeVisibleOrder(allTasks, previousVisibleTasks, orderedIds) {
  const visibleIds = new Set(previousVisibleTasks.map(task => task._id));
  const tasksById = new Map(allTasks.map(task => [task._id, task]));
  const reorderedVisible = orderedIds.map(id => tasksById.get(id)).filter(Boolean);
  let nextVisibleIndex = 0;

  return allTasks.map(task => visibleIds.has(task._id)
    ? reorderedVisible[nextVisibleIndex++]
    : task
  );
}

async function salvarOrdemDiaria(orderedIds) {
  const dataISO = dataSelecionada.toLocaleDateString("sv-SE");
  const reorderedDay = mergeVisibleOrder(tarefasDoDia, tarefasVisiveisDoDia, orderedIds);
  try {
    const response = await fetch(`/tarefas/${userId}/ordem`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: dataISO, ids: reorderedDay.map(tarefa => tarefa._id) })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Erro ao salvar a prioridade");
    tarefasDoDia = reorderedDay.map((tarefa, ordem) => ({ ...tarefa, ordem }));
    renderizarTarefasDoDia();
  } catch (error) {
    console.error(error);
    alert("Não foi possível salvar a prioridade das tarefas.");
    await carregarTarefasPorData(userId, dataSelecionada);
  }
}

async function editarTarefa(tarefaId, textoAtual, importante) {
  const tarefa = (importante ? tarefasDoFiltroImportante : tarefasDoDia)
    .find(item => item._id === tarefaId);
  if (!tarefa) return;

  const dataCriacao = new Date(tarefa.dataCriacao);
  const data = [
    dataCriacao.getFullYear(),
    String(dataCriacao.getMonth() + 1).padStart(2, "0"),
    String(dataCriacao.getDate()).padStart(2, "0")
  ].join("-");
  const hora = String(dataCriacao.getHours()).padStart(2, "0");
  const minuto = String(dataCriacao.getMinutes()).padStart(2, "0");
  tarefaEmEdicao = { id: tarefaId, importante, data, hora, minuto };
  document.getElementById("inputEditarTexto").value = textoAtual;
  document.getElementById("inputEditarData").value = data;
  preencherOpcoesHorario(hora, minuto);
  document.getElementById("inputEditarCor").value = /^#[0-9a-fA-F]{6}$/.test(tarefa.cor || "")
    ? tarefa.cor
    : importante ? "#ffd700" : "#e73d3d";
  sincronizarPaletaCor(document.getElementById("inputEditarCor"));
  document.getElementById("modalEditarTarefa").classList.remove("hidden");
  document.getElementById("inputEditarTexto").focus();
}

function sincronizarPaletaCor(input) {
  const grupo = input.closest(".seletor-cor-tarefa");
  if (!grupo) return;
  grupo.querySelectorAll("[data-cor-paleta]").forEach(botao => {
    botao.setAttribute("aria-pressed", String(botao.dataset.corPaleta === input.value.toLowerCase()));
  });
}

document.addEventListener("click", event => {
  if (!(event.target instanceof Element)) return;
  const botao = event.target.closest("[data-cor-paleta]");
  if (!botao) return;
  const grupo = botao.closest(".seletor-cor-tarefa");
  const input = grupo?.querySelector('input[type="color"]');
  if (!input) return;
  input.value = botao.dataset.corPaleta;
  sincronizarPaletaCor(input);
});

document.addEventListener("input", event => {
  if (event.target instanceof HTMLInputElement &&
      event.target.matches('.seletor-cor-tarefa input[type="color"]')) {
    sincronizarPaletaCor(event.target);
  }
});

document.querySelectorAll('.seletor-cor-tarefa input[type="color"]').forEach(sincronizarPaletaCor);

function preencherOpcoesHorario(horaAtual, minutoAtual) {
  const horaSelect = document.getElementById("inputEditarHora");
  const minutoSelect = document.getElementById("inputEditarMinuto");
  horaSelect.replaceChildren();
  minutoSelect.replaceChildren();

  for (let hora = 0; hora < 24; hora++) {
    const valor = String(hora).padStart(2, "0");
    horaSelect.add(new Option(valor, valor));
  }

  const minutos = Array.from({ length: 12 }, (_, index) => index * 5);
  if (Number(minutoAtual) % 5 !== 0) minutos.push(Number(minutoAtual));
  minutos.sort((a, b) => a - b);
  for (const minuto of minutos) {
    const valor = String(minuto).padStart(2, "0");
    const sufixo = Number(minuto) % 5 === 0 ? "" : " (atual)";
    minutoSelect.add(new Option(`${valor}${sufixo}`, valor));
  }

  horaSelect.value = horaAtual;
  minutoSelect.value = minutoAtual;
}

function fecharModalEdicao() {
  document.getElementById("modalEditarTarefa").classList.add("hidden");
  tarefaEmEdicao = null;
}

async function salvarEdicaoTarefa() {
  if (!tarefaEmEdicao) return;
  const texto = document.getElementById("inputEditarTexto").value.trim();
  const cor = document.getElementById("inputEditarCor").value;
  const data = document.getElementById("inputEditarData").value;
  const hora = document.getElementById("inputEditarHora").value;
  const minuto = document.getElementById("inputEditarMinuto").value;
  if (!texto || texto.length > 300) {
    alert("A descrição deve ter entre 1 e 300 caracteres.");
    return;
  }
  if (!data || !hora || !minuto) {
    alert("Informe uma data e um horário válidos.");
    return;
  }

  const { id, importante, data: dataOriginal, hora: horaOriginal, minuto: minutoOriginal } = tarefaEmEdicao;
  const rota = importante
    ? `/tarefas/importantes/${userId}/${id}`
    : `/tarefas/${userId}/${id}`;
  const atualizacoes = { texto, cor };
  if (data !== dataOriginal || hora !== horaOriginal || minuto !== minutoOriginal) {
    Object.assign(atualizacoes, { data, hora, minuto });
  }

  try {
    const button = document.getElementById("btnSalvarEdicao");
    button.disabled = true;
    const response = await fetch(rota, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(atualizacoes)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Erro ao salvar tarefa");

    fecharModalEdicao();
    if (importante) await carregarTarefasImportantes();
    else await carregarTarefasPorData(userId, dataSelecionada);
  } catch (error) {
    console.error(error);
    alert(error.message || "Não foi possível salvar a tarefa.");
  } finally {
    document.getElementById("btnSalvarEdicao").disabled = false;
  }
}

async function excluirTarefa(tarefaId) {
  if (!window.confirm("Deseja excluir esta tarefa?")) return;

  try {
    const response = await fetch(`/tarefas/${userId}/${tarefaId}`, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error("Erro ao excluir tarefa");
    await carregarTarefasPorData(userId, dataSelecionada);
  } catch (error) {
    console.error(error);
    alert("Não foi possível excluir a tarefa.");
  }
}



function criarDiaCalendario(data) {
  const dia = document.createElement("div");
  dia.classList.add("calendar-day");
  dia.textContent = data.getDate();


  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());

  const diff = Math.round((d - hoje) / 86400000);

  if (diff === -1) dia.classList.add("ontem");
  if (diff === 0) dia.classList.add("hoje");
  if (diff === 1) dia.classList.add("amanha");

  dia.onclick = () => {
    dataSelecionada = d;

    document
      .querySelectorAll(".calendar-day.selecionado")
      .forEach(el => el.classList.remove("selecionado"));

    dia.classList.add("selecionado");

    atualizarTituloData(dataSelecionada);
    carregarTarefasPorData(userId, dataSelecionada);
  };

  return dia;
}



//funcao de modal de criar tarefa
function abrirModal() {
  document.getElementById("modalTarefa").classList.remove("hidden");

  const agora = new Date();
  const dataISO = dataSelecionada.toLocaleDateString("sv-SE");
  document.getElementById("inputDataTarefa").value = dataISO;
  preencherHorariosCriacao("inputHoraTarefa", "inputMinutoTarefa", agora);
  document.getElementById("inputCorTarefa").value = "#e73d3d";
  sincronizarPaletaCor(document.getElementById("inputCorTarefa"));

  document.getElementById("inputTextoTarefa").focus();
}


function fecharModal() {
  const modal = document.getElementById("modalTarefa");
  modal.classList.add("hide");


    modal.classList.remove("hide");
    modal.classList.add("hidden");

}

//função para salvar tarefa
let salvandoTarefa = false;

async function salvarTarefa() {
  if (salvandoTarefa) return;
  salvandoTarefa = true;

  const btn = document.getElementById("btnSalvarTarefa");
  if (btn) btn.disabled = true;

  try {
    const texto = document.getElementById("inputTextoTarefa").value.trim();
    const data = document.getElementById("inputDataTarefa").value;
    const hora = document.getElementById("inputHoraTarefa").value;
    const minuto = document.getElementById("inputMinutoTarefa").value;
    const cor = document.getElementById("inputCorTarefa").value;

    if (!userId || !texto || !data || !hora || !minuto) {
      throw new Error("Informe a descrição, a data e o horário");
    }

    const res = await fetch("/tarefas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, texto, data, hora, minuto, cor })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.erro || "Erro ao salvar tarefa");

    // ✅ fecha modal só depois de salvar
    fecharModal();

    // ✅ recarrega tarefas direto do banco
    await carregarTarefasPorData(userId, dataSelecionada);

  } catch (err) {
    console.error(err);
    alert(err.message || "Erro ao salvar tarefa");
  } finally {
    salvandoTarefa = false;
    if (btn) btn.disabled = false;
  }
}


function preencherHorariosCriacao(horaId, minutoId, data = new Date()) {
  const horaSelect = document.getElementById(horaId);
  const minutoSelect = document.getElementById(minutoId);
  horaSelect.replaceChildren();
  minutoSelect.replaceChildren();

  for (let hora = 0; hora < 24; hora++) {
    const valor = String(hora).padStart(2, "0");
    horaSelect.add(new Option(valor, valor));
  }

  for (let minuto = 0; minuto < 60; minuto += 5) {
    const valor = String(minuto).padStart(2, "0");
    minutoSelect.add(new Option(valor, valor));
  }

  const minutoArredondado = Math.floor(data.getMinutes() / 5) * 5;
  horaSelect.value = String(data.getHours()).padStart(2, "0");
  minutoSelect.value = String(minutoArredondado).padStart(2, "0");
}

//função para remover mensagem de tarefas vazias
function removerMensagemVazia() {
  const container = document.getElementById("tarefas");
  container.querySelector(".sem-tarefas")?.remove();
}


//função para atualizar o título da data selecionada
function atualizarTituloData(data) {
  const el = document.getElementById("textoData");
  if (!el) return;

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());

  const diff = Math.round((d - hoje) / 86400000);

  if (diff === 0) el.textContent = "Hoje";
  else if (diff === -1) el.textContent = "Ontem";
  else if (diff === 1) el.textContent = "Amanhã";
  else {
    el.textContent = d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit"
    });
  }
}

function setFiltro(tipo) {
  filtroAtual = tipo;

  document.querySelectorAll(".filtro").forEach(b =>
    b.classList.remove("active")
  );

  event.target.classList.add("active");

  carregarTarefasPorData(userId, dataSelecionada);
}


async function toggleTarefa(tarefaId) {
  const el = document.getElementById(tarefaId);
  if (!el) return;

  const estaConcluida = el.classList.contains("done");

  // atualização otimista
  el.classList.toggle("done");

  try {
    const response = await fetch(`/tarefas/${userId}/${tarefaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concluida: !estaConcluida
      })
    });
    if (!response.ok) throw new Error("Erro ao atualizar tarefa");

    if (!estaConcluida) tocarSomEvento("conclusao");
    await carregarTarefasPorData(userId, dataSelecionada);

  } catch (err) {
    // rollback
    el.classList.toggle("done");
    alert("Erro ao atualizar tarefa");
  }
}


function toggleFiltro() {
  filtroAtual = filtroAtual === "pendentes" ? "concluidas" : "pendentes";

  const btn = document.getElementById("btnFiltro");
  const icon = btn.querySelector(".icon");
  const text = btn.querySelector(".text");

  if (filtroAtual === "pendentes") {
    btn.classList.remove("concluidas");
    btn.classList.add("pendentes");
    icon.innerHTML = '<i class="bi bi-stickies"></i>';
    text.textContent = "Pendentes";
  } else {
    btn.classList.remove("pendentes");
    btn.classList.add("concluidas");
    icon.innerHTML = '<i class="bi bi-check-circle"></i>';
    text.textContent = "Concluídas";
  }

  carregarTarefasPorData(userId, dataSelecionada);
}

let coordenadasClima = null;
let previsaoClimaCarregada = false;
let carregamentoPrevisaoClima = null;
let previsaoClimaCarregadaEm = 0;
let previsaoClimaCarregadaPara = null;

function formatarHorarioClima(timestamp, fuso) {
  if (!timestamp) return "--:--";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date((timestamp + fuso) * 1000));
}

function iconePrevisaoClima(tipo) {
  const classes = {
    Clear: "bi-sun",
    Clouds: "bi-clouds",
    Rain: "bi-cloud-rain-heavy",
    Drizzle: "bi-cloud-drizzle",
    Thunderstorm: "bi-cloud-lightning-rain",
    Snow: "bi-snow",
    Mist: "bi-cloud-fog",
    Fog: "bi-cloud-fog",
    Haze: "bi-cloud-haze"
  };
  return classes[tipo] || "bi-cloud";
}

const climaSvgNamespace = "http://www.w3.org/2000/svg";

function criarElementoClimaSvg(nome, atributos = {}) {
  const elemento = document.createElementNS(climaSvgNamespace, nome);
  for (const [chave, valor] of Object.entries(atributos)) {
    elemento.setAttribute(chave, String(valor));
  }
  return elemento;
}

function configurarGraficoClima(svg, quantidade, larguraPorPonto = 40, altura = 240) {
  const largura = Math.max(760, quantidade * larguraPorPonto + 70);
  const margens = { esquerda: 48, direita: 42, topo: 18, baixo: 40 };
  const dimensoes = {
    largura,
    altura,
    esquerda: margens.esquerda,
    direita: largura - margens.direita,
    topo: margens.topo,
    base: altura - margens.baixo
  };
  dimensoes.larguraPlot = dimensoes.direita - dimensoes.esquerda;
  dimensoes.alturaPlot = dimensoes.base - dimensoes.topo;
  dimensoes.passo = dimensoes.larguraPlot / quantidade;
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${largura} ${altura}`);
  svg.setAttribute("width", largura);
  svg.setAttribute("height", altura);
  svg.setAttribute("preserveAspectRatio", "none");
  return dimensoes;
}

function mapearValorGrafico(valor, minimo, maximo, dimensoes) {
  const alcance = maximo - minimo || 1;
  return dimensoes.base - ((valor - minimo) / alcance) * dimensoes.alturaPlot;
}

function adicionarGradeGrafico(svg, dimensoes, minimo, maximo, formatarValor) {
  for (let etapa = 0; etapa <= 4; etapa += 1) {
    const valor = minimo + ((maximo - minimo) * etapa) / 4;
    const y = mapearValorGrafico(valor, minimo, maximo, dimensoes);
    svg.appendChild(criarElementoClimaSvg("line", {
      x1: dimensoes.esquerda,
      y1: y,
      x2: dimensoes.direita,
      y2: y,
      class: "weather-chart-gridline"
    }));
    const rotulo = criarElementoClimaSvg("text", {
      x: dimensoes.esquerda - 9,
      y: y + 4,
      class: "weather-chart-axis-label",
      "text-anchor": "end"
    });
    rotulo.textContent = formatarValor(valor);
    svg.appendChild(rotulo);
  }
}

function adicionarRotulosTempo(svg, dimensoes, registros, porDia = false) {
  const intervalo = porDia ? 1 : Math.max(1, Math.ceil(registros.length / 6));
  registros.forEach((registro, indice) => {
    if (indice % intervalo !== 0 && indice !== registros.length - 1) return;
    const hora = registro.time?.slice(11, 16) || "";
    const rotulo = porDia ? registro.label : hora;
    const texto = criarElementoClimaSvg("text", {
      x: dimensoes.esquerda + (indice + 0.5) * dimensoes.passo,
      y: dimensoes.altura - 12,
      class: "weather-chart-axis-label weather-chart-time-label",
      "text-anchor": "middle"
    });
    texto.textContent = rotulo;
    svg.appendChild(texto);
  });
}

function adicionarInteracaoGrafico(svg, tooltip, registros, formatarDetalhe) {
  const exibirDetalhe = evento => {
    const alvo = evento.target instanceof Element
      ? evento.target.closest("[data-weather-index]")
      : null;
    if (!alvo) return;
    const registro = registros[Number(alvo.dataset.weatherIndex)];
    if (registro) tooltip.textContent = formatarDetalhe(registro);
  };
  svg.addEventListener("pointerover", exibirDetalhe);
  svg.addEventListener("click", exibirDetalhe);
  svg.addEventListener("focusin", exibirDetalhe);
}

function adicionarAlvosGrafico(svg, dimensoes, registros, formatarDetalhe) {
  registros.forEach((registro, indice) => {
    const alvo = criarElementoClimaSvg("rect", {
      x: dimensoes.esquerda + indice * dimensoes.passo,
      y: dimensoes.topo,
      width: dimensoes.passo,
      height: dimensoes.alturaPlot,
      fill: "#ffffff",
      opacity: 0,
      "pointer-events": "all",
      class: "weather-chart-hit",
      tabindex: 0,
      role: "button",
      "data-weather-index": indice,
      "aria-label": formatarDetalhe(registro)
    });
    svg.appendChild(alvo);
  });
}

function intensidadeChuva(milimetros, diario = false) {
  if (milimetros <= 0) return "none";
  if (diario) return milimetros < 5 ? "light" : milimetros < 15 ? "moderate" : "heavy";
  return milimetros < 1 ? "light" : milimetros < 4 ? "moderate" : "heavy";
}

function nomeIntensidadeChuva(milimetros) {
  if (milimetros <= 0) return "sem acumulado";
  if (milimetros < 1) return "leve";
  if (milimetros < 4) return "moderada";
  return "forte";
}

function formatarMilimetros(valor) {
  return `${Number(valor || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mm`;
}

function formatarDiaClima(data) {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(ano, mes - 1, dia, 12))).replace(".", "");
}

function obterDescricaoTempo(codigo) {
  const descricoes = {
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
  const [principal, descricao] = descricoes[codigo] || ["Clouds", "condição variável"];
  return { principal, descricao };
}

function criarRegistrosHorarios(dados, horasPrevistas = 24) {
  const { hourly, current } = dados;
  if (!Array.isArray(hourly?.time) || hourly.time.length === 0) {
    throw new Error("Os dados por hora estão indisponíveis.");
  }
  const intervalo = Math.max(1, Number(dados.forecastResolutionHours) || 1);
  const horaAtual = `${current?.time?.slice(0, 13) || hourly.time[0].slice(0, 13)}:00`;
  let inicio = hourly.time.findIndex(horario => horario >= horaAtual);
  if (inicio < 0) inicio = 0;

  const quantidade = Math.ceil(horasPrevistas / intervalo);
  return hourly.time.slice(inicio, inicio + quantidade).map((horario, posicao) => {
    const indice = inicio + posicao;
    const ler = campo => Number(hourly[campo]?.[indice] ?? 0);
    return {
      time: horario,
      temperature: ler("temperature_2m"),
      feelsLike: ler("apparent_temperature"),
      precipitation: ler("precipitation"),
      probability: ler("precipitation_probability"),
      rain: ler("rain"),
      showers: ler("showers"),
      windSpeed: ler("wind_speed_10m"),
      windDirection: ler("wind_direction_10m"),
      humidity: ler("relative_humidity_2m")
    };
  });
}

function detalharChuva(registro, incluirData = false) {
  const horario = registro.time.slice(11, 16);
  const acumulado = formatarMilimetros(registro.precipitation);
  const probabilidade = `${Math.round(registro.probability)}% de chance`;
  const data = incluirData ? `${formatarDiaClima(registro.time.slice(0, 10))} · ` : "";
  return `${data}${horario} · ${acumulado} · ${probabilidade} · intensidade ${nomeIntensidadeChuva(registro.precipitation)}`;
}

function renderizarGraficoChuva(registros, svgId = "weatherRainChart", tooltipId = "weatherRainTooltip", larguraPorPonto = 40, marcarDias = false) {
  const svg = document.getElementById(svgId);
  const tooltip = document.getElementById(tooltipId);
  const dimensoes = configurarGraficoClima(svg, registros.length, larguraPorPonto);
  const maximoChuva = Math.max(1, ...registros.map(registro => registro.precipitation));
  adicionarGradeGrafico(svg, dimensoes, 0, maximoChuva, valor => `${valor.toFixed(1)} mm`);
  for (const probabilidade of [0, 50, 100]) {
    const y = dimensoes.base - (probabilidade / 100) * dimensoes.alturaPlot;
    const rotulo = criarElementoClimaSvg("text", {
      x: dimensoes.direita + 8,
      y: y + 4,
      class: "weather-chart-axis-label",
      "text-anchor": "start"
    });
    rotulo.textContent = `${probabilidade}%`;
    svg.appendChild(rotulo);
  }

  const pontosProbabilidade = [];
  registros.forEach((registro, indice) => {
    const centro = dimensoes.esquerda + (indice + 0.5) * dimensoes.passo;
    if (marcarDias && (indice === 0 || registro.time.slice(0, 10) !== registros[indice - 1].time.slice(0, 10))) {
      const separador = criarElementoClimaSvg("line", {
        x1: dimensoes.esquerda + indice * dimensoes.passo,
        y1: dimensoes.topo,
        x2: dimensoes.esquerda + indice * dimensoes.passo,
        y2: dimensoes.base,
        class: "weather-day-divider"
      });
      const data = criarElementoClimaSvg("text", {
        x: centro,
        y: 12,
        class: "weather-chart-day-label",
        "text-anchor": "middle"
      });
      data.textContent = indice === 0 ? "Hoje" : formatarDiaClima(registro.time.slice(0, 10));
      svg.append(separador, data);
    }
    const alturaBarra = registro.precipitation > 0
      ? Math.max(3, (registro.precipitation / maximoChuva) * dimensoes.alturaPlot)
      : 0;
    svg.appendChild(criarElementoClimaSvg("rect", {
      x: centro - Math.min(11, dimensoes.passo * 0.32),
      y: dimensoes.base - alturaBarra,
      width: Math.min(22, dimensoes.passo * 0.64),
      height: alturaBarra,
      rx: 4,
      class: `weather-rain-bar weather-rain-${intensidadeChuva(registro.precipitation)}`
    }));
    pontosProbabilidade.push(`${centro},${mapearValorGrafico(registro.probability, 0, 100, dimensoes)}`);
  });

  svg.appendChild(criarElementoClimaSvg("polyline", {
    points: pontosProbabilidade.join(" "),
    class: "weather-probability-line"
  }));
  registros.forEach((registro, indice) => {
    const centro = dimensoes.esquerda + (indice + 0.5) * dimensoes.passo;
    svg.appendChild(criarElementoClimaSvg("circle", {
      cx: centro,
      cy: mapearValorGrafico(registro.probability, 0, 100, dimensoes),
      r: 3.5,
      class: "weather-probability-point"
    }));
  });
  adicionarRotulosTempo(svg, dimensoes, registros);
  const formatarDetalhe = registro => detalharChuva(registro, marcarDias);
  adicionarAlvosGrafico(svg, dimensoes, registros, formatarDetalhe);
  adicionarInteracaoGrafico(svg, tooltip, registros, formatarDetalhe);
}

function renderizarGraficoLinear(svgId, tooltipId, registros, series, formatarDetalhe, formatarEixo, faixa = null, decorador = null) {
  const svg = document.getElementById(svgId);
  const tooltip = document.getElementById(tooltipId);
  const dimensoes = configurarGraficoClima(svg, registros.length);
  const valores = registros.flatMap(registro => series.map(serie => serie.valor(registro)));
  const minimo = faixa?.[0] ?? Math.floor(Math.min(...valores) - 1);
  const maximo = faixa?.[1] ?? Math.ceil(Math.max(...valores) + 1);
  const intervalo = maximo - minimo || 1;
  adicionarGradeGrafico(svg, dimensoes, minimo, maximo, valor => formatarEixo(valor));

  const coordenadas = series.map(serie => registros.map((registro, indice) => ({
    x: dimensoes.esquerda + (indice + 0.5) * dimensoes.passo,
    y: mapearValorGrafico(serie.valor(registro), minimo, maximo, dimensoes),
    valor: serie.valor(registro)
  })));

  series.forEach((serie, serieIndice) => {
    const pontos = coordenadas[serieIndice];
    svg.appendChild(criarElementoClimaSvg("polyline", {
      points: pontos.map(ponto => `${ponto.x},${ponto.y}`).join(" "),
      class: "weather-data-line",
      stroke: serie.cor
    }));
    pontos.forEach(ponto => {
      svg.appendChild(criarElementoClimaSvg("circle", {
        cx: ponto.x,
        cy: ponto.y,
        r: 3.5,
        class: "weather-data-point",
        fill: serie.cor
      }));
    });
  });

  decorador?.(svg, coordenadas, dimensoes, intervalo);
  adicionarRotulosTempo(svg, dimensoes, registros);
  adicionarAlvosGrafico(svg, dimensoes, registros, formatarDetalhe);
  adicionarInteracaoGrafico(svg, tooltip, registros, formatarDetalhe);
}

function direcaoVento(graus) {
  return ["N", "NE", "L", "SE", "S", "SO", "O", "NO"][Math.round(graus / 45) % 8];
}

function detalharVento(registro) {
  return `${registro.time.slice(11, 16)} · ${registro.windSpeed.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m/s · direção ${direcaoVento(registro.windDirection)} (${Math.round(registro.windDirection)}°)`;
}

function formatarDataCompleta(data) {
  const [ano, mes, dia] = data.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(ano, mes - 1, dia, 12)));
}

function deslocarHorarioClima(dataHora, horas) {
  return new Date(Date.parse(`${dataHora}:00Z`) + horas * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}

function renderizarPeriodosChuva(registros, containerId, intervaloHoras, incluirData) {
  const container = document.getElementById(containerId);
  const periodos = [];
  registros.forEach((registro, indice) => {
    if (registro.precipitation <= 0 && registro.probability <= 0) return;
    const periodo = periodos.at(-1);
    if (!periodo || indice !== periodo.ultimoIndice + 1) {
      periodos.push({
        primeiroIndice: indice,
        ultimoIndice: indice,
        acumulado: registro.precipitation,
        probabilidade: registro.probability,
        intensidade: registro.precipitation / intervaloHoras
      });
      return;
    }
    periodo.ultimoIndice = indice;
    periodo.acumulado += registro.precipitation;
    periodo.probabilidade = Math.max(periodo.probabilidade, registro.probability);
    periodo.intensidade = Math.max(periodo.intensidade, registro.precipitation / intervaloHoras);
  });

  container.replaceChildren();
  if (periodos.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "weather-rain-period-empty";
    vazio.textContent = incluirData
      ? "Sem chuva prevista nos dias consultados."
      : "Sem chuva prevista nas próximas 24 horas.";
    container.appendChild(vazio);
    return;
  }

  for (const periodo of periodos) {
    const inicioRegistro = registros[periodo.primeiroIndice];
    const ultimoRegistro = registros[periodo.ultimoIndice];
    const dataInicio = inicioRegistro.time.slice(0, 10);
    const inicio = inicioRegistro.time.slice(11, 16);
    const proximoRegistro = registros[periodo.ultimoIndice + 1];
    const fim = proximoRegistro?.time || deslocarHorarioClima(ultimoRegistro.time, intervaloHoras);
    const dataFim = fim.slice(0, 10);
    const horarioFim = fim.slice(11, 16);
    const rotuloData = incluirData || dataInicio !== dataFim
      ? `${formatarDiaClima(dataInicio)} `
      : "";
    const rotuloFim = dataInicio !== dataFim
      ? `${formatarDiaClima(dataFim)} ${horarioFim}`
      : horarioFim;

    const item = document.createElement("div");
    item.className = `weather-rain-period weather-rain-${intensidadeChuva(periodo.intensidade)}`;
    const horario = document.createElement("strong");
    horario.textContent = `${rotuloData}${inicio}–${rotuloFim}`;
    const detalhes = document.createElement("span");
    const intensidade = periodo.intensidade > 0
      ? `chuva ${nomeIntensidadeChuva(periodo.intensidade)}`
      : "possibilidade de chuva";
    detalhes.textContent = `${formatarMilimetros(periodo.acumulado)} · ${Math.round(periodo.probabilidade)}% · ${intensidade}`;
    item.append(horario, detalhes);
    container.appendChild(item);
  }
}

function renderizarGraficoChuvaDiaria(registros) {
  const svg = document.getElementById("weatherDailyRainChart");
  const tooltip = document.getElementById("weatherDailyRainTooltip");
  const dimensoes = configurarGraficoClima(svg, registros.length, 72, 230);
  const maximo = Math.max(5, ...registros.map(registro => registro.precipitation));
  adicionarGradeGrafico(svg, dimensoes, 0, maximo, valor => `${Math.round(valor)} mm`);

  const probabilidades = [];
  registros.forEach((registro, indice) => {
    const centro = dimensoes.esquerda + (indice + 0.5) * dimensoes.passo;
    const alturaBarra = registro.precipitation > 0
      ? Math.max(3, (registro.precipitation / maximo) * dimensoes.alturaPlot)
      : 0;
    svg.appendChild(criarElementoClimaSvg("rect", {
      x: centro - 13,
      y: dimensoes.base - alturaBarra,
      width: 26,
      height: alturaBarra,
      rx: 5,
      class: `weather-rain-bar weather-rain-${intensidadeChuva(registro.precipitation, true)}`
    }));
    probabilidades.push(`${centro},${mapearValorGrafico(registro.probability, 0, 100, dimensoes)}`);
  });
  svg.appendChild(criarElementoClimaSvg("polyline", {
    points: probabilidades.join(" "),
    class: "weather-probability-line"
  }));
  registros.forEach((registro, indice) => {
    const centro = dimensoes.esquerda + (indice + 0.5) * dimensoes.passo;
    svg.appendChild(criarElementoClimaSvg("circle", {
      cx: centro,
      cy: mapearValorGrafico(registro.probability, 0, 100, dimensoes),
      r: 4,
      class: "weather-probability-point"
    }));
  });
  adicionarRotulosTempo(svg, dimensoes, registros, true);
  const detalharDia = registro => `${formatarDataCompleta(registro.time)} · ${formatarMilimetros(registro.precipitation)} previstos · ${Math.round(registro.probability)}% de chance`;
  adicionarAlvosGrafico(svg, dimensoes, registros, detalharDia);
  adicionarInteracaoGrafico(svg, tooltip, registros, detalharDia);
}

function renderizarPrevisaoDiaria(dados) {
  if (!Array.isArray(dados.daily?.time) || dados.daily.time.length !== 7) {
    throw new Error("A previsão dos próximos sete dias está indisponível.");
  }
  const diario = dados.daily;
  const registros = diario.time.map((time, indice) => ({
    time,
    label: indice === 0 ? "Hoje" : formatarDiaClima(time),
    weatherCode: diario.weather_code[indice],
    max: Number(diario.temperature_2m_max[indice] ?? 0),
    min: Number(diario.temperature_2m_min[indice] ?? 0),
    probability: Number(diario.precipitation_probability_max[indice] ?? 0),
    precipitation: Number(diario.precipitation_sum[indice] ?? 0),
    sunrise: diario.sunrise[indice],
    sunset: diario.sunset[indice]
  }));

  const resumoCard = document.getElementById("weatherCardForecast");
  resumoCard.replaceChildren();
  for (const registro of registros) {
    const condicao = obterDescricaoTempo(registro.weatherCode);
    const linha = document.createElement("div");
    linha.className = "weather-card-forecast-day";
    const dia = document.createElement("span");
    dia.textContent = registro.label;
    const icone = document.createElement("i");
    icone.className = `bi ${iconePrevisaoClima(condicao.principal)}`;
    icone.setAttribute("aria-hidden", "true");
    const temperatura = document.createElement("strong");
    temperatura.textContent = `${Math.round(registro.max)}° / ${Math.round(registro.min)}°`;
    const chuva = document.createElement("span");
    chuva.textContent = `${Math.round(registro.probability)}% · ${formatarMilimetros(registro.precipitation)}`;
    linha.append(dia, icone, temperatura, chuva);
    resumoCard.appendChild(linha);
  }
}

function renderizarDetalhesClima(dados) {
  renderizarPrevisaoDiaria(dados);
}

async function carregarPrevisaoClima() {
  const chaveLocalizacao = coordenadasClima
    ? `${Number(coordenadasClima.latitude).toFixed(3)},${Number(coordenadasClima.longitude).toFixed(3)}`
    : "porto-alegre";
  if (previsaoClimaCarregada && previsaoClimaCarregadaPara === chaveLocalizacao &&
      Date.now() - previsaoClimaCarregadaEm < 15 * 60 * 1000) {
    return;
  }
  if (carregamentoPrevisaoClima) return carregamentoPrevisaoClima;

  const resumoCard = document.getElementById("weatherCardForecast");
  resumoCard.textContent = "Carregando previsão...";
  const parametros = coordenadasClima
    ? `?lat=${encodeURIComponent(coordenadasClima.latitude)}&lon=${encodeURIComponent(coordenadasClima.longitude)}`
    : "";
  carregamentoPrevisaoClima = (async () => {
    try {
      const response = await fetch(`/clima/previsao${parametros}`, { cache: "no-store" });
      const dados = await response.json();
      if (!response.ok) throw new Error(dados.erro || "Não foi possível carregar a previsão.");
      renderizarPrevisaoDiaria(dados);
      previsaoClimaCarregada = true;
      previsaoClimaCarregadaEm = Date.now();
      previsaoClimaCarregadaPara = chaveLocalizacao;
    } catch (error) {
      console.error("Não foi possível carregar a previsão do tempo:", error);
      const mensagem = error.message || "Previsão indisponível.";
      resumoCard.textContent = mensagem;
    } finally {
      carregamentoPrevisaoClima = null;
      const localizacaoAtual = coordenadasClima
        ? `${Number(coordenadasClima.latitude).toFixed(3)},${Number(coordenadasClima.longitude).toFixed(3)}`
        : "porto-alegre";
      const painelAberto = !document.getElementById("weatherCardDetails").hidden;
      if (painelAberto && localizacaoAtual !== chaveLocalizacao) {
        void carregarPrevisaoClima();
      }
    }
  })();
  return carregamentoPrevisaoClima;
}

document.getElementById("weatherToggle").addEventListener("click", async () => {
  const botao = document.getElementById("weatherToggle");
  const resumo = document.getElementById("weatherCardDetails");
  const expandido = botao.getAttribute("aria-expanded") !== "true";
  botao.setAttribute("aria-expanded", String(expandido));
  resumo.hidden = !expandido;
  botao.querySelector(".weather-chevron").className =
    `bi ${expandido ? "bi-chevron-up" : "bi-chevron-right"} weather-chevron`;
  if (expandido) await carregarPrevisaoClima();
});

async function carregarClimaLocal() {
  const buscarClima = async (url) => {
    const response = await fetch(url, { cache: "no-store" });
    const dados = await response.json();
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error("Chave da API de clima inválida");
      }
      throw new Error(dados.erro || "Clima indisponível");
    }

    document.getElementById("temp").textContent = `${Math.round(dados.main.temp)}°C`;
    document.getElementById("desc").textContent = dados.weather[0].description;
    document.getElementById("city").textContent = dados.name;
    document.getElementById("weatherCardFeelsLike").textContent = `${Math.round(dados.main.feels_like)}°C`;
    document.getElementById("weatherCardHumidity").textContent = `${dados.main.humidity}%`;
    document.getElementById("weatherCardWind").textContent = `${Number(dados.wind.speed).toFixed(1)} m/s`;
    document.getElementById("weatherCardSun").textContent =
      `${formatarHorarioClima(dados.sys.sunrise, dados.timezone)} / ${formatarHorarioClima(dados.sys.sunset, dados.timezone)}`;
    aplicarEstiloClima(dados.weather[0].main);
    const consulta = new URL(url, window.location.origin);
    const latitude = consulta.searchParams.get("lat");
    const longitude = consulta.searchParams.get("lon");
    const coordenadasAnteriores = coordenadasClima;
    coordenadasClima = latitude !== null && longitude !== null
      ? { latitude, longitude }
      : null;
    const localizacaoMudou = coordenadasAnteriores?.latitude !== coordenadasClima?.latitude ||
      coordenadasAnteriores?.longitude !== coordenadasClima?.longitude;
    const resumoAberto = !document.getElementById("weatherCardDetails").hidden;
    if (localizacaoMudou && resumoAberto) {
      void carregarPrevisaoClima();
    }
  };

  const usarCidadePadrao = async () => {
    try {
      await buscarClima("/clima");
    } catch (error) {
      console.error("Não foi possível carregar o clima:", error);
      document.getElementById("desc").textContent = error.message || "Clima indisponível";
    }
  };

  if (!navigator.geolocation) {
    await usarCidadePadrao();
    return;
  }

  navigator.geolocation.getCurrentPosition(async pos => {
    try {
      const { latitude, longitude } = pos.coords;
      await buscarClima(`/clima?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`);
    } catch (error) {
      console.warn("Falha no clima pela localização; usando cidade padrão:", error);
      await usarCidadePadrao();
    }
  }, async () => {
    await usarCidadePadrao();
  }, {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 60000
  });
}

function aplicarEstiloClima(tipo) {
  const card = document.getElementById("weatherCard");
  const icon = document.getElementById("weatherIcon");

  card.className = "weather-card";

  switch (tipo) {
    case "Clear":
      card.classList.add("sunny");
      icon.innerHTML = '<i class="bi bi-brightness-high"></i>';
      break;

    case "Clouds":
      card.classList.add("cloudy");
      icon.innerHTML = '<i class="bi bi-clouds"></i>';
      break;

    case "Rain":
    case "Drizzle":
      card.classList.add("rain");
      icon.innerHTML = '<i class="bi bi-cloud-rain-heavy"></i>';
      break;

    case "Thunderstorm":
      card.classList.add("storm");
      icon.innerHTML = '<i class="bi bi-cloud-lightning-rain"></i>';
      break;

    case "Snow":
      card.classList.add("snow");
      icon.innerHTML = '<i class="bi bi-snow"></i>';
      break;

    default:
      card.classList.add("cloudy");
      icon.innerHTML = '<i class="bi bi-cloud"></i>';
  }
}

//criar tarefa importante
let filtroImportanteAtual = "hoje";
let tarefasDoFiltroImportante = [];

document.querySelectorAll(".filtrosImportantes button").forEach(btn => {
  btn.classList.remove("ativo");

  if (btn.dataset.filtro === "hoje") {
    btn.classList.add("ativo");
  }
});


// carregar tarefas importantes
async function carregarTarefasImportantes() {
  const div = document.getElementById("tarefasImportantes");
  try {
    const res = await fetch(
      `/tarefas/importantes/${userId}?filtro=${filtroImportanteAtual}`
    );
    const tarefas = await res.json();
    if (!res.ok) throw new Error(tarefas.erro || "Erro ao carregar tarefas importantes");

    tarefasDoFiltroImportante = tarefas;
    renderizarTarefasImportantes(tarefas);
    void carregarTarefasImportantesWidget();
    agendarSincronizacaoNotificacoesTarefas();
  } catch (error) {
    console.error(error);
    div.textContent = "Não foi possível carregar as tarefas importantes.";
  }
}

let versaoWidgetTarefasImportantes = 0;
let filtroWidgetTarefasImportantes = "hoje";

document.querySelectorAll("[data-filtro-widget-importantes]").forEach(botao => {
  botao.addEventListener("click", () => {
    filtroWidgetTarefasImportantes = botao.dataset.filtroWidgetImportantes;
    document.querySelectorAll("[data-filtro-widget-importantes]").forEach(opcao => {
      opcao.setAttribute("aria-pressed", String(opcao === botao));
    });
    void carregarTarefasImportantesWidget();
  });
});

async function carregarTarefasImportantesWidget() {
  const versao = ++versaoWidgetTarefasImportantes;
  const lista = document.getElementById("listaWidgetTarefasImportantes");
  const contagem = document.getElementById("contagemWidgetTarefasImportantes");
  try {
    const response = await fetch(`/tarefas/importantes/${encodeURIComponent(userId)}?filtro=${filtroWidgetTarefasImportantes}`);
    const tarefas = await response.json();
    if (!response.ok) throw new Error(tarefas.erro || "Não foi possível carregar as tarefas importantes.");
    if (versao !== versaoWidgetTarefasImportantes) return;

    contagem.textContent = `${tarefas.length} ${tarefas.length === 1 ? "tarefa" : "tarefas"}`;
    lista.replaceChildren();
    if (tarefas.length === 0) {
      const vazio = document.createElement("li");
      vazio.className = "tarefas-importantes-widget-vazio";
      const periodo = {
        hoje: "hoje",
        semana: "nesta semana",
        mes: "neste mês"
      }[filtroWidgetTarefasImportantes];
      vazio.textContent = `Nenhuma tarefa importante ${periodo}.`;
      lista.appendChild(vazio);
      return;
    }

    for (const tarefa of tarefas) {
      const item = document.createElement("li");
      item.className = "tarefas-importantes-widget-item";
      if (tarefa.concluida) item.classList.add("concluida");
      item.style.setProperty("--cor-tarefa", /^#[0-9a-fA-F]{6}$/.test(tarefa.cor || "") ? tarefa.cor : "#ffd700");

      const texto = document.createElement("span");
      texto.className = "tarefas-importantes-widget-texto";
      texto.textContent = tarefa.texto;

      const data = document.createElement("time");
      data.className = "tarefas-importantes-widget-data";
      data.dateTime = tarefa.dataCriacao;
      data.textContent = new Date(tarefa.dataCriacao).toLocaleDateString("pt-BR");

      const hora = document.createElement("time");
      hora.className = "tarefas-importantes-widget-hora tarefa-hora";
      hora.dateTime = tarefa.dataCriacao;
      hora.dataset.horarioLimite = String(new Date(tarefa.dataCriacao).getTime());
      hora.textContent = new Date(tarefa.dataCriacao).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
      });

      const concluir = document.createElement("button");
      concluir.type = "button";
      concluir.className = "tarefas-importantes-widget-concluir";
      concluir.setAttribute("aria-label", tarefa.concluida ? "Reabrir tarefa" : "Concluir tarefa");
      concluir.setAttribute("aria-pressed", String(tarefa.concluida));
      concluir.title = tarefa.concluida ? "Reabrir tarefa" : "Concluir tarefa";
      concluir.innerHTML = tarefa.concluida
        ? '<i class="bi bi-check-circle-fill" aria-hidden="true"></i>'
        : '<i class="bi bi-circle" aria-hidden="true"></i>';
      concluir.addEventListener("click", async () => {
        const concluidaAnterior = tarefa.concluida;
        const concluidaNova = !concluidaAnterior;
        concluir.disabled = true;
        tarefa.concluida = concluidaNova;
        item.classList.toggle("concluida", concluidaNova);
        atualizarIndicadorHorarioTarefa(hora);
        concluir.setAttribute("aria-pressed", String(concluidaNova));
        concluir.setAttribute("aria-label", concluidaNova ? "Reabrir tarefa" : "Concluir tarefa");
        concluir.title = concluidaNova ? "Reabrir tarefa" : "Concluir tarefa";
        concluir.innerHTML = concluidaNova
          ? '<i class="bi bi-check-circle-fill" aria-hidden="true"></i>'
          : '<i class="bi bi-circle" aria-hidden="true"></i>';

        try {
          const response = await fetch(`/tarefas/importantes/${encodeURIComponent(userId)}/${encodeURIComponent(tarefa._id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ concluida: concluidaNova })
          });
          const resultado = await response.json();
          if (!response.ok) throw new Error(resultado.erro || "Não foi possível atualizar a tarefa.");
          tarefa.concluida = resultado.concluida;
          agendarSincronizacaoNotificacoesTarefas();
          if (concluidaNova) tocarSomEvento("conclusao");
          const tarefaNaSecao = tarefasDoFiltroImportante.find(itemImportante => itemImportante._id === tarefa._id);
          if (tarefaNaSecao) {
            tarefaNaSecao.concluida = resultado.concluida;
            renderizarTarefasImportantes(tarefasDoFiltroImportante);
          }
        } catch (error) {
          tarefa.concluida = concluidaAnterior;
          item.classList.toggle("concluida", concluidaAnterior);
          atualizarIndicadorHorarioTarefa(hora);
          concluir.setAttribute("aria-pressed", String(concluidaAnterior));
          concluir.setAttribute("aria-label", concluidaAnterior ? "Reabrir tarefa" : "Concluir tarefa");
          concluir.title = concluidaAnterior ? "Reabrir tarefa" : "Concluir tarefa";
          concluir.innerHTML = concluidaAnterior
            ? '<i class="bi bi-check-circle-fill" aria-hidden="true"></i>'
            : '<i class="bi bi-circle" aria-hidden="true"></i>';
          console.error("Não foi possível atualizar a tarefa importante pelo widget:", error);
          alert(error.message || "Não foi possível atualizar a tarefa importante.");
        } finally {
          concluir.disabled = false;
        }
      });

      item.append(texto, data, hora, concluir);
      lista.appendChild(item);
      atualizarIndicadorHorarioTarefa(hora);
    }
  } catch (error) {
    if (versao !== versaoWidgetTarefasImportantes) return;
    console.error("Não foi possível carregar as tarefas importantes do widget:", error);
    contagem.textContent = " indisponível";
    lista.replaceChildren();
    const falha = document.createElement("li");
    falha.className = "tarefas-importantes-widget-vazio";
    falha.textContent = "Não foi possível carregar as tarefas importantes.";
    lista.appendChild(falha);
  }
}

function renderizarTarefasImportantes(tarefas) {
  const div = document.getElementById("tarefasImportantes");
  const busca = valorBusca("buscaTarefasImportantes");
  const tarefasFiltradas = tarefas.filter(tarefa =>
    tarefa.texto.toLocaleLowerCase("pt-BR").includes(busca)
  );
  tarefasImportantesVisiveis = tarefasFiltradas;
  div.replaceChildren();
  if (tarefasFiltradas.length === 0) {
    const mensagem = document.createElement("p");
    mensagem.className = "sem-tarefas";
    mensagem.textContent = busca
      ? "Nenhuma tarefa importante corresponde à pesquisa."
      : "Nenhuma tarefa importante neste período.";
    div.appendChild(mensagem);
    return;
  }

  tarefasFiltradas.forEach(tarefa => {
      const item = document.createElement("div");
      item.className = "tarefaImportante";
      item.dataset.taskId = tarefa._id;
      item.style.setProperty("--cor-tarefa",
        /^#[0-9a-fA-F]{6}$/.test(tarefa.cor || "") ? tarefa.cor : "#ffd700");

      const handle = criarAlcaPrioridade();

      const texto = document.createElement("span");
      texto.className = "textoTarefa";
      texto.textContent = tarefa.texto;
      if (tarefa.concluida) texto.style.textDecoration = "line-through";

      const acoes = document.createElement("div");
      acoes.className = "acoesTarefa";

      const data = document.createElement("span");
      const dataCriacao = new Date(tarefa.dataCriacao);
      data.textContent = dataCriacao.toLocaleDateString("pt-BR");
      const hora = document.createElement("span");
      hora.className = "tarefa-hora";
      hora.dataset.horarioLimite = String(dataCriacao.getTime());
      hora.innerHTML = `<i class="bi bi-clock" aria-hidden="true"></i> ${dataCriacao.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit"
      })}`;
      item.dataset.concluida = String(tarefa.concluida);
      const concluir = document.createElement("button");
      concluir.className = "btnConcluirImportante";
      concluir.type = "button";
      concluir.dataset.concluida = String(tarefa.concluida);
      concluir.setAttribute("aria-label", tarefa.concluida ? "Reabrir tarefa" : "Concluir tarefa");
      concluir.innerHTML = tarefa.concluida
        ? '<i class="bi bi-arrow-counterclockwise"></i>'
        : '<i class="bi bi-check-lg"></i>';
      concluir.onclick = () => toggleImportanteUI(concluir, tarefa._id);

      const editar = document.createElement("button");
      editar.className = "btnEditarTarefa";
      editar.type = "button";
      editar.setAttribute("aria-label", "Editar tarefa importante");
      editar.title = "Editar tarefa";
      editar.innerHTML = '<i class="bi bi-pencil"></i>';
      editar.onclick = () => editarTarefa(tarefa._id, tarefa.texto, true);

      const excluir = document.createElement("button");
      excluir.className = "btnExcluirImportante";
      excluir.type = "button";
      excluir.setAttribute("aria-label", "Excluir tarefa importante");
      excluir.innerHTML = '<i class="bi bi-trash-fill"></i>';
      excluir.onclick = () => excluirImportante(tarefa._id);

      acoes.append(data, hora, concluir, editar, excluir);
      item.append(handle, texto, acoes);
      div.appendChild(item);
      atualizarIndicadorHorarioTarefa(hora);
  });
}

async function salvarOrdemImportante(orderedIds) {
  const previousVisible = tarefasImportantesVisiveis;
  try {
    const allResponse = await fetch(`/tarefas/importantes/${userId}?filtro=todas`);
    const todas = await allResponse.json();
    if (!allResponse.ok) throw new Error(todas.erro || "Erro ao carregar prioridades");

    const reordered = mergeVisibleOrder(todas, previousVisible, orderedIds);
    const response = await fetch(`/tarefas/importantes/${userId}/ordem`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: reordered.map(tarefa => tarefa._id) })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Erro ao salvar a prioridade");

    await carregarTarefasImportantes();
  } catch (error) {
    console.error(error);
    alert("Não foi possível salvar a prioridade das tarefas importantes.");
    await carregarTarefasImportantes();
  }
}

// filtros
document.querySelectorAll(".filtrosImportantes button").forEach(btn => {
  btn.addEventListener("click", () => {
    filtroImportanteAtual = btn.dataset.filtro;

    document
      .querySelectorAll(".filtrosImportantes button")
      .forEach(b => b.classList.remove("ativo"));

    btn.classList.add("ativo");

    carregarTarefasImportantes();
  });
});


// criar tarefa importante
async function salvarTarefaImportante() {
  const texto = document.getElementById("inputTarefaImportante").value.trim();
  const data = document.getElementById("dataTarefaImportante").value;
  const hora = document.getElementById("horaTarefaImportante").value;
  const minuto = document.getElementById("minutoTarefaImportante").value;
  const cor = document.getElementById("corTarefaImportante").value;
  const button = document.getElementById("btnSalvarImportante");

  if (!texto || !data || !hora || !minuto) {
    alert("Informe a descrição, a data e o horário");
    return;
  }

  try {
    button.disabled = true;
    const response = await fetch("/tarefas/importantes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, texto, data, hora, minuto, cor })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Erro ao salvar tarefa importante");

    fecharModalImportante();
    await carregarTarefasImportantes();
  } catch (error) {
    console.error(error);
    alert(error.message || "Não foi possível salvar a tarefa importante.");
  } finally {
    button.disabled = false;
  }
}

async function toggleImportanteUI(botao, id) {
  const tarefa = botao.closest(".tarefaImportante");
  const texto = tarefa.querySelector(".textoTarefa");

  const concluidaAtual = botao.dataset.concluida === "true";
  const novaConcluida = !concluidaAtual;

  botao.dataset.concluida = novaConcluida;
  tarefa.dataset.concluida = String(novaConcluida);
  texto.style.textDecoration = novaConcluida ? "line-through" : "none";
  atualizarIndicadorHorarioTarefa(tarefa.querySelector(".tarefa-hora"));

  botao.innerHTML = novaConcluida
    ? '<i class="bi bi-arrow-counterclockwise"></i>'
    : '<i class="bi bi-check-lg"></i>';

  botao.classList.add("animar");
  tarefa.classList.add("loading");

  setTimeout(() => {
    botao.classList.remove("animar");
    tarefa.classList.remove("loading");
  }, 200);

  try {
    const response = await fetch(`/tarefas/importantes/${userId}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concluida: novaConcluida })
    });
    if (!response.ok) throw new Error("Erro ao salvar tarefa importante");
    if (novaConcluida) tocarSomEvento("conclusao");
    agendarSincronizacaoNotificacoesTarefas();
  } catch (err) {

    botao.dataset.concluida = concluidaAtual;
    texto.style.textDecoration = concluidaAtual ? "line-through" : "none";

    botao.innerHTML = concluidaAtual
      ? '<i class="bi bi-arrow-counterclockwise"></i>'
      : '<i class="bi bi-check-lg"></i>';

    alert("Erro ao salvar");
  }
}



async function excluirImportante(id) {
  if (!window.confirm("Deseja excluir esta tarefa importante?")) return;

  try {
    const response = await fetch(`/tarefas/importantes/${userId}/${id}`, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error("Erro ao excluir tarefa importante");
    await carregarTarefasImportantes();
  } catch (error) {
    console.error(error);
    alert("Não foi possível excluir a tarefa importante.");
  }
}

function abrirModalImportante() {
  const agora = new Date();
  document.getElementById("dataTarefaImportante").value = agora.toLocaleDateString("sv-SE");
  preencherHorariosCriacao("horaTarefaImportante", "minutoTarefaImportante", agora);
  document.getElementById("corTarefaImportante").value = "#ffd700";
  sincronizarPaletaCor(document.getElementById("corTarefaImportante"));
  document.getElementById("modalImportante").classList.remove("hidden");
  document.getElementById("inputTarefaImportante").focus();
}

function fecharModalImportante() {
  document.getElementById("modalImportante").classList.add("hidden");
  document.getElementById("inputTarefaImportante").value = "";
}

preencherHorariosCriacao("inputHoraTarefa", "inputMinutoTarefa");
preencherHorariosCriacao("horaTarefaImportante", "minutoTarefaImportante");

document.getElementById("buscaTarefas").addEventListener("input", renderizarTarefasDoDia);
document.getElementById("buscaTarefasImportantes").addEventListener("input", () => {
  renderizarTarefasImportantes(tarefasDoFiltroImportante);
});

document.querySelectorAll(".btnBuscaTarefas").forEach(button => {
  button.addEventListener("click", () => {
    const busca = button.closest(".buscaTarefas");
    const input = busca.querySelector("input");
    const aberta = busca.classList.toggle("aberta");
    button.setAttribute("aria-expanded", String(aberta));
    if (aberta) input.focus();
    else {
      if (input.value) {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      input.blur();
    }
  });
});

installTaskDragging("tarefas", ".tarefa", salvarOrdemDiaria,
  (tarefaId, data) => moverTarefaParaData(tarefaId, data, false));
installTaskDragging("tarefasImportantes", ".tarefaImportante", salvarOrdemImportante,
  (tarefaId, data) => moverTarefaParaData(tarefaId, data, true));

function atualizarStatusPermissaoNotificacoes() {
  const status = document.getElementById("statusPermissaoNotificacoes");
  const botao = document.getElementById("ativarNotificacoes");

  const notificacoesLocais = notificacoesLocaisNativas();
  if (notificacoesLocais) {
    botao.disabled = false;
    void (async () => {
      try {
        const permissao = await notificacoesLocais.checkPermissions();
        if (permissao.display !== "granted") {
          status.textContent = permissao.display === "denied"
            ? "Permissão negada. Altere nas configurações do Android."
            : "Ative para receber lembretes mesmo com o Orby fechado.";
          botao.disabled = permissao.display === "denied";
          return;
        }
        void configurarPushNativo(false).catch(error => {
          console.error("Não foi possível iniciar as notificações push do Firebase:", error);
          status.textContent = error.message || "Não foi possível conectar ao Firebase.";
        });

        const alarmesExatos = await notificacoesLocais.checkExactNotificationSetting();
        if (alarmesExatos.exact_alarm !== "granted") {
          status.textContent = "Notificações ativadas. Permita alarmes exatos para receber no horário.";
          return;
        }
        const pendentes = await notificacoesLocais.getPending();
        const total = pendentes.notifications.filter(notificacao => notificacao.extra?.tarefaId).length;
        status.textContent = total
          ? `Horários exatos ativados. ${total} lembrete(s) agendado(s).`
          : "Horários exatos ativados. Nenhuma tarefa futura pendente.";
      } catch (error) {
        console.error("Não foi possível verificar as permissões de notificação:", error);
        status.textContent = "Não foi possível verificar as permissões do Android.";
      }
    })();
    return;
  }

  if (notificacoesNativasEsperadas()) {
    status.textContent = "O plugin nativo de notificações não foi carregado. Reinstale o APK atualizado.";
    botao.disabled = true;
    return;
  }

  if (!("Notification" in window)) {
    status.textContent = "Este navegador não oferece notificações.";
    botao.disabled = true;
    return;
  }
  if (!window.isSecureContext) {
    status.textContent = "As notificações precisam de uma conexão segura ou localhost.";
    botao.disabled = true;
    return;
  }

  const permissoes = {
    granted: "Notificações do navegador ativadas.",
    denied: "Permissão negada. Altere nas configurações do navegador.",
    default: "Ative para receber avisos mesmo com a janela em segundo plano."
  };
  status.textContent = permissoes[Notification.permission];
  botao.disabled = Notification.permission === "denied";
}

function avisarNoNavegador(notificacao) {
  const notificacoesLocais = notificacoesLocaisNativas();
  if (notificacoesLocais) {
    if (localStorage.getItem("orbyFcmPushEnabled") === "true") return;
    if (notificacao.tipo === "diaria" || notificacao.tipo === "importante") return;
    void notificacoesLocais.schedule({
      notifications: [{
        id: idNotificacaoTarefa(notificacao._id),
        title: notificacao.titulo,
        body: notificacao.texto,
        ongoing: false,
        autoCancel: true,
        extra: { notificacaoId: notificacao._id }
      }]
    }).catch(error => {
      console.error("Não foi possível exibir a notificação no aparelho:", error);
    });
    return;
  }

  if (!("Notification" in window) || Notification.permission !== "granted") return;

  const aviso = new Notification(notificacao.titulo, {
    body: notificacao.texto,
    tag: notificacao._id,
    icon: "/circle.png"
  });
  aviso.addEventListener("click", () => {
    window.focus();
    aviso.close();
  });
}

function renderizarNotificacoes(notificacoes) {
  const lista = document.getElementById("listaNotificacoes");
  const contador = document.getElementById("contadorNotificacoes");
  const naoLidas = notificacoes.filter(notificacao => !notificacao.lida).length;

  contador.textContent = String(naoLidas);
  contador.classList.toggle("hidden", naoLidas === 0);
  document.getElementById("botaoNotificacoes")
    .setAttribute("aria-label", `Notificações${naoLidas ? ` (${naoLidas} não lidas)` : ""}`);
  lista.replaceChildren();

  if (notificacoes.length === 0) {
    const vazio = document.createElement("p");
    vazio.className = "notificacoesVazias";
    vazio.textContent = "Sem notificações nos últimos 7 dias.";
    lista.appendChild(vazio);
    return;
  }

  for (const notificacao of notificacoes) {
    const conviteXadrez = notificacao.tipo === "xadrez_convite" && notificacao.partidaId;
    const lanceXadrez = notificacao.tipo === "xadrez_lance";
    const item = document.createElement(conviteXadrez ? "article" : "button");
    if (!conviteXadrez) item.type = "button";
    item.className = `itemNotificacao${notificacao.lida ? "" : " naoLida"}${conviteXadrez ? " conviteXadrez" : ""}${lanceXadrez ? " lanceXadrez" : ""}`;

    const titulo = document.createElement("strong");
    titulo.textContent = notificacao.titulo;
    const texto = document.createElement("span");
    texto.textContent = notificacao.texto;
    const data = document.createElement("time");
    data.dateTime = notificacao.criadaEm;
    data.textContent = new Date(notificacao.criadaEm).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });

    item.append(titulo, texto, data);
    if (conviteXadrez && !notificacao.lida) {
      const acoes = document.createElement("div");
      acoes.className = "acoesConviteXadrez";
      const aceitar = document.createElement("button");
      aceitar.type = "button";
      aceitar.className = "aceitarConviteXadrez";
      aceitar.textContent = "Aceitar partida";
      aceitar.addEventListener("click", () => responderConviteXadrez(notificacao, "aceitar", aceitar, recusar));
      const recusar = document.createElement("button");
      recusar.type = "button";
      recusar.className = "recusarConviteXadrez";
      recusar.textContent = "Recusar";
      recusar.addEventListener("click", () => responderConviteXadrez(notificacao, "recusar", recusar, aceitar));
      acoes.append(aceitar, recusar);
      item.appendChild(acoes);
    } else if (conviteXadrez) {
      const resposta = document.createElement("small");
      resposta.className = "conviteXadrezRespondido";
      resposta.textContent = "Convite respondido";
      item.appendChild(resposta);
    } else {
      item.addEventListener("click", () => marcarNotificacaoLida(notificacao._id));
    }
    lista.appendChild(item);
  }
}

async function responderConviteXadrez(notificacao, acao, botao, outroBotao) {
  botao.disabled = true;
  outroBotao.disabled = true;
  try {
    const response = await fetch(`/xadrez/partidas/${encodeURIComponent(notificacao.partidaId)}/${acao}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId })
    });
    const resultado = await response.json();
    if (!response.ok) throw new Error(resultado.erro || "Não foi possível responder ao convite.");
    if (acao === "aceitar") {
      document.dispatchEvent(new CustomEvent("chess-invitation-accepted", { detail: resultado }));
    }
    await carregarNotificacoes();
  } catch (error) {
    console.error(error);
    alert(error.message || "Não foi possível responder ao convite.");
    botao.disabled = false;
    outroBotao.disabled = false;
  }
}

async function carregarNotificacoes() {
  if (limpandoNotificacoes) return;
  const versaoRequisicao = ++versaoNotificacoes;
  try {
    const response = await fetch(`/notificacoes/${userId}`);
    const notificacoes = await response.json();
    if (!response.ok) throw new Error(notificacoes.erro || "Erro ao carregar notificações");
    if (limpandoNotificacoes || versaoRequisicao !== versaoNotificacoes) return;

    const idsAtuais = new Set(notificacoes.map(notificacao => notificacao._id));
    const agora = Date.now();
    for (const notificacao of notificacoes) {
      const id = notificacao._id;
      if (idsNotificadosNoNavegador.has(id)) continue;

      const criadaEm = new Date(notificacao.criadaEm).getTime();
      if (notificacoesInicializadas || agora - criadaEm <= 2 * 60 * 1000) {
        if (notificacao.tipo === "habito") tocarSomEvento("habito");
        else if (notificacao.tipo === "diaria" || notificacao.tipo === "importante") tocarSomEvento("tarefa");
        avisarNoNavegador(notificacao);
      }
    }

    idsNotificadosNoNavegador = idsAtuais;
    notificacoesInicializadas = true;
    renderizarNotificacoes(notificacoes);
  } catch (error) {
    if (limpandoNotificacoes || versaoRequisicao !== versaoNotificacoes) return;
    console.error("Não foi possível atualizar notificações:", error);
  }
}

async function marcarNotificacaoLida(id) {
  try {
    const response = await fetch(`/notificacoes/${userId}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lida: true })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Erro ao marcar notificação como lida");
    await carregarNotificacoes();
  } catch (error) {
    console.error(error);
    alert("Não foi possível atualizar a notificação.");
  }
}

async function limparNotificacoes() {
  const botao = document.getElementById("limparNotificacoes");
  if (limpandoNotificacoes) return;
  limpandoNotificacoes = true;
  versaoNotificacoes += 1;
  botao.disabled = true;
  try {
    const response = await fetch(`/notificacoes/${userId}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.erro || "Erro ao limpar notificações");
    idsNotificadosNoNavegador.clear();
    renderizarNotificacoes([]);
  } catch (error) {
    console.error(error);
    alert("Não foi possível limpar as notificações.");
    limpandoNotificacoes = false;
    await carregarNotificacoes();
  } finally {
    limpandoNotificacoes = false;
    botao.disabled = false;
  }
}

document.getElementById("ativarNotificacoes").addEventListener("click", async () => {
  const notificacoesLocais = notificacoesLocaisNativas();
  if (notificacoesLocais) {
    try {
      const permissao = await notificacoesLocais.requestPermissions();
      if (permissao.display !== "granted") {
        atualizarStatusPermissaoNotificacoes();
        return;
      }

      try {
        await configurarPushNativo(true);
      } catch (error) {
        console.error("Não foi possível ativar as notificações push do Firebase:", error);
        document.getElementById("statusPermissaoNotificacoes").textContent =
          error.message || "Não foi possível ativar as notificações push.";
      }

      let alarmesExatos = await notificacoesLocais.checkExactNotificationSetting();
      if (alarmesExatos.exact_alarm !== "granted") {
        document.getElementById("statusPermissaoNotificacoes").textContent =
          "Ative “Alarmes e lembretes” para o Orby na tela do Android.";
        alarmesExatos = await notificacoesLocais.changeExactNotificationSetting();
      }
      if (alarmesExatos.exact_alarm !== "granted") {
        atualizarStatusPermissaoNotificacoes();
        return;
      }
      atualizarStatusPermissaoNotificacoes();
      agendarSincronizacaoNotificacoesTarefas();
    } catch (error) {
      console.error("Não foi possível ativar as notificações do Android:", error);
      document.getElementById("statusPermissaoNotificacoes").textContent =
        "Não foi possível ativar as notificações. Verifique as permissões do Android.";
    }
    return;
  }

  if (!("Notification" in window) || !window.isSecureContext) {
    atualizarStatusPermissaoNotificacoes();
    return;
  }

  try {
    await Notification.requestPermission();
    atualizarStatusPermissaoNotificacoes();
  } catch (error) {
    console.error("Não foi possível solicitar permissão para notificações:", error);
    document.getElementById("statusPermissaoNotificacoes").textContent =
      "Não foi possível ativar as notificações neste navegador.";
  }
});
document.getElementById("limparNotificacoes").addEventListener("click", limparNotificacoes);
atualizarStatusPermissaoNotificacoes();
carregarNotificacoes();
setInterval(carregarNotificacoes, 15000);

//função para abrir modal de notificação e configurações
function abrirModalIcone(icone, idModal) {
  const modal = document.getElementById(idModal);
  const aberto = modal.style.display === 'block';

  document.querySelectorAll('.mini-modal').forEach(m => {
    m.style.display = 'none';
  });

  if (aberto) return;

  modal.style.display = 'block'; 
  if (idModal === "notificacao") carregarNotificacoes();
  if (idModal === "config") atualizarStatusPermissaoNotificacoes();

  const rect = icone.getBoundingClientRect();
  modal.style.top = rect.bottom + window.scrollY + 'px';
  const left = rect.left - modal.offsetWidth + rect.width;
  modal.style.left = `${Math.max(8, Math.min(left, window.innerWidth - modal.offsetWidth - 8))}px`;
}

document.addEventListener('click', function (e) {
  const alvo = e.target instanceof Element ? e.target : null;
  const clicouNoIcone = alvo?.closest('.iconeModal');
  const clicouNoModal = alvo?.closest('.mini-modal');

  if (!clicouNoIcone && !clicouNoModal) {
    document.querySelectorAll('.mini-modal').forEach(m => {
      m.style.display = 'none';
    });
  }
});


trocarMensagemAleatoria();
setInterval(trocarMensagemAleatoria, 15000);
atualizarIndicadoresHorariosTarefas();
setInterval(atualizarIndicadoresHorariosTarefas, 15000);
carregarTarefasImportantes();
agendarSincronizacaoNotificacoesTarefas();
function atualizarCardClima() {
  if (document.hidden) return;

  void carregarClimaLocal();
  if (!document.getElementById("weatherCardDetails").hidden) {
    void carregarPrevisaoClima();
  }
}

atualizarCardClima();
setInterval(atualizarCardClima, 60_000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    atualizarIndicadoresHorariosTarefas();
    atualizarCardClima();
  }
});
carregarTarefasPorData(userId, dataSelecionada);
atualizarTituloData(dataSelecionada);
