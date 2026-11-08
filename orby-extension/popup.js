const $ = (selector) => document.querySelector(selector);
const SERVER_URLS = ["https://orbyapp.discloud.app", "https://orbyapp.discloud.dev"];
const SERVER_ORIGINS = SERVER_URLS.map(origin => `${origin}/*`);
const THEMES = [
  ["light", "Claro"], ["dark", "Escuro"], ["custom", "Personalizado"],
  ["halloween", "Halloween"], ["natal", "Natal"], ["orby-vannila", "Orby Vannila"],
  ["aero", "Frutiger Aero"], ["wii", "Wii Theme"], ["coffe", "Coffe Theme"]
];
const state = { config: null, tab: "tarefas", date: localDate(), taskFilter: "all", cache: {} };
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`; }
function setStatus(message = "", error = false) { const el = $("#status"); el.textContent = message; el.className = `status${error ? " error" : ""}`; }
async function api(path, options = {}) {
  let lastError;
  for (const server of SERVER_URLS) {
    try {
      const response = await fetch(`${server}${path}`, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.erro || "Não foi possível acessar o Orby.");
      state.config.server = server;
      await chrome.storage.local.set({ orbyCompactConfig: state.config });
      return data;
    } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Não foi possível acessar o Orby.");
}
const json = (method, body) => ({ method, body: JSON.stringify(body) });
function showSetup() { $("#setup").hidden = false; $("#app").hidden = true; $("#settings").hidden = true; $("#settingsButton").hidden = false; }
async function initialize() {
  const stored = await chrome.storage.local.get("orbyCompactConfig");
  state.config = stored.orbyCompactConfig || null;
  if (state.config) {
    if (!SERVER_URLS.includes(state.config.server)) state.config.server = SERVER_URLS[0];
    await chrome.storage.local.set({ orbyCompactConfig: state.config });
  }
  if (!state.config) {
    const permitted = await chrome.permissions.contains({ origins: SERVER_ORIGINS });
    if (!permitted) {
      showSetup();
      $("#setup").hidden = true;
      $("#settings").hidden = false;
      $("#appearanceSettings").hidden = true;
      await refreshServerPermissionStatus();
      return;
    }
    showSetup();
    return;
  }
  await applyTheme();
  $("#settingsButton").hidden = false;
  $("#notificationsButton").hidden = false;
  $("#setup").hidden = true; $("#settings").hidden = true; $("#app").hidden = false;
  $("#welcome").textContent = `Olá, ${state.config.name || "pessoa"}`;
  await loadTab();
}
$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const status = $("#loginStatus");
  button.disabled = true; status.className = "status"; status.textContent = "Conectando...";
  try {
    const granted = await chrome.permissions.request({ origins: SERVER_ORIGINS });
    if (!granted) throw new Error("A permissão de acesso aos servidores não foi concedida.");
    let user;
    let server;
    let lastError;
    for (const candidate of SERVER_URLS) {
      try {
        const response = await fetch(`${candidate}/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: $("#email").value.trim(), senha: $("#password").value }) });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.erro || "E-mail ou senha inválidos.");
        user = result; server = candidate; break;
      } catch (error) { lastError = error; }
    }
    if (!user) throw lastError || new Error("Não foi possível acessar o Orby.");
    state.config = { server, userId: String(user.id), name: user.nome || user.email };
    await chrome.storage.local.set({ orbyCompactConfig: state.config });
    $("#password").value = "";
    await initialize();
  } catch (error) { status.textContent = error.message || "Erro ao conectar."; status.className = "status error"; }
  finally { button.disabled = false; }
});
$("#logoutButton").addEventListener("click", async () => { await chrome.storage.local.remove("orbyCompactConfig"); state.config = null; state.cache = {}; $("#notificationsButton").hidden = true; showSetup(); });
$("#settingsButton").addEventListener("click", () => {
  $("#setup").hidden = true;
  $("#app").hidden = true;
  $("#settings").hidden = false;
  $("#appearanceSettings").hidden = !state.config;
  if (state.config) renderThemeOptions();
  refreshServerPermissionStatus().catch(error => {
    $("#permissionStatus").textContent = error.message || "Não foi possível verificar as permissões.";
    $("#permissionStatus").className = "permission-status error";
  });
});
$("#backButton").addEventListener("click", () => {
  $("#settings").hidden = true;
  if (state.config) $("#app").hidden = false;
  else $("#setup").hidden = false;
});
async function refreshServerPermissionStatus() {
  const granted = await chrome.permissions.contains({ origins: SERVER_ORIGINS });
  const status = $("#permissionStatus");
  status.textContent = granted
    ? "Acesso autorizado para os dois endereços."
    : "Os endereços ainda precisam ser autorizados.";
  status.className = "permission-status";
}
$("#authorizeServersButton").addEventListener("click", async event => {
  const button = event.currentTarget;
  const status = $("#permissionStatus");
  button.disabled = true;
  status.textContent = "Aguardando autorização do navegador...";
  status.className = "permission-status";
  try {
    const granted = await chrome.permissions.request({ origins: SERVER_ORIGINS });
    if (!granted) throw new Error("A permissão de acesso aos servidores não foi concedida.");
    await refreshServerPermissionStatus();
  } catch (error) {
    status.textContent = error.message || "Não foi possível autorizar os servidores.";
    status.className = "permission-status error";
  } finally {
    button.disabled = false;
  }
});
document.querySelectorAll(".tabs button").forEach(button => button.addEventListener("click", () => {
  state.tab = button.dataset.tab;
  document.querySelectorAll(".tabs button").forEach(item => item.classList.toggle("active", item === button));
  $("#notificationsButton").setAttribute("aria-pressed", "false");
  loadTab();
}));
$("#notificationsButton").addEventListener("click", () => {
  state.tab = "notificacoes";
  document.querySelectorAll(".tabs button").forEach(item => item.classList.remove("active"));
  $("#notificationsButton").setAttribute("aria-pressed", "true");
  loadTab();
});
function updateNotificationBadge(notifications = []) {
  const unreadCount = notifications.filter(notification => !notification.lida).length;
  const badge = $("#notificationBadge");
  badge.hidden = unreadCount === 0;
  badge.textContent = unreadCount ? String(Math.min(unreadCount, 99)) : "";
  chrome.action.setBadgeBackgroundColor({ color: "#ef4444" }).catch(error => console.error("Não foi possível atualizar a cor do contador:", error));
  chrome.action.setBadgeText({ text: unreadCount ? String(Math.min(unreadCount, 99)) : "" }).catch(error => console.error("Não foi possível atualizar o contador:", error));
}
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.orbyCompactNotifications) {
    updateNotificationBadge(changes.orbyCompactNotifications.newValue || []);
  }
});

async function applyTheme() {
  const stored = await chrome.storage.local.get("orbyCompactTheme");
  const theme = stored.orbyCompactTheme || { name: "light", color: "#174c32", mode: "light" };
  const root = document.documentElement;
  root.dataset.theme = theme.name === "dark" || (theme.name === "custom" && theme.mode === "dark") || theme.name === "halloween" ? "dark" : "light";
  if (["halloween", "natal", "orby-vannila", "aero", "wii", "coffe"].includes(theme.name)) root.dataset.specialTheme = theme.name;
  else delete root.dataset.specialTheme;
  const palettes = {
    light: ["#ef4444", "#f87171", "#fff1f2", "#fecdd3", "#f5f7fb", "rgba(255,255,255,.94)", "#172033", "#e7eaf0"],
    dark: ["#ef4444", "#f87171", "#39252b", "#70404a", "#151922", "#222936", "#e7eaf0", "#394253"],
    halloween: ["#f97316", "#fb923c", "#3d2b20", "#7c4528", "#151922", "#222936", "#e7eaf0", "#394253"],
    natal: ["#174c32", "#28734b", "#e7f0e9", "#a9c7b2", "#f5f7fb", "rgba(255,255,255,.94)", "#172033", "#e7eaf0"],
    "orby-vannila": ["#83d65c", "#a0e184", "#eff9e9", "#b8df9f", "#f7f9f3", "rgba(255,255,255,.94)", "#26351f", "#e3ecd9"],
    aero: ["#168bd0", "#59b7ff", "#e7f7ff", "#a8dcf5", "#d6f2ff", "rgba(255,255,255,.84)", "#244a63", "rgba(125,190,221,.62)"],
    wii: ["#168fc2", "#43b7e6", "#e5f7ff", "#a7dcef", "#edf9fd", "rgba(255,255,255,.94)", "#274c60", "#b9deeb"],
    coffe: ["#6d4c41", "#a1887f", "#f1e8e4", "#cdb9ae", "#5d4037", "#fffdfb", "#49352f", "#ddcec5"]
  };
  const colors = theme.name === "custom" ? [theme.color || "#174c32", theme.color || "#28734b", "color-mix(in srgb, " + (theme.color || "#174c32") + " 10%, white)", "color-mix(in srgb, " + (theme.color || "#174c32") + " 35%, white)", theme.mode === "dark" ? "#151922" : "#f5f7fb", theme.mode === "dark" ? "#202631" : "#fff", theme.mode === "dark" ? "#edf0f6" : "#172033", theme.mode === "dark" ? "#394253" : "#e7eaf0"] : palettes[theme.name] || palettes.light;
  ["--red", "--red-light", "--red-soft", "--red-border", "--page-bg", "--card-bg", "--ink", "--line"].forEach((key, index) => root.style.setProperty(key, colors[index]));
  root.style.setProperty("--muted", theme.name === "coffe" ? "#806b62" : theme.name === "aero" ? "#5d7c90" : theme.name === "dark" || theme.name === "halloween" ? "#a4adbd" : theme.mode === "dark" && theme.name === "custom" ? "#a4adbd" : "#7b8495");
  root.style.colorScheme = root.dataset.theme;
  root.style.setProperty("--header-gradient", theme.name === "natal" ? "repeating-linear-gradient(135deg,#c62828 0,#c62828 34px,#f5f1e8 34px,#f5f1e8 46px)" : theme.name === "aero" || theme.name === "wii" ? `linear-gradient(135deg,${colors[5]},${colors[2]})` : `linear-gradient(135deg,${colors[0]},${colors[1]} 55%,${colors[0]})`);
  root.style.setProperty("--header-ink", ["aero", "wii"].includes(theme.name) ? "#174e70" : "#fff");
  document.body.dataset.currentTheme = theme.name;
}
function renderThemeOptions() {
  const stored = chrome.storage.local.get("orbyCompactTheme").then(({ orbyCompactTheme }) => {
    const current = orbyCompactTheme || { name: "light", color: "#174c32", mode: "light" };
    $("#themeOptions").innerHTML = THEMES.map(([name, label]) => `<button class="theme-option" type="button" data-theme-choice="${name}" aria-pressed="${current.name === name}"><span class="theme-swatch swatch-${name}"></span><span>${label}</span>${current.name === name ? `<i class="bi bi-check-circle-fill" aria-label="Selecionado"></i>` : ""}</button>`).join("");
    $("#customThemeControls").hidden = current.name !== "custom";
    $("#customThemeColor").value = current.color || "#174c32";
    $("#customThemeMode").value = current.mode || "light";
    document.querySelectorAll("[data-theme-choice]").forEach(button => button.addEventListener("click", async () => {
      const next = { ...current, name: button.dataset.themeChoice };
      await chrome.storage.local.set({ orbyCompactTheme: next });
      await applyTheme(); renderThemeOptions();
    }));
  });
  return stored;
}
async function saveCustomTheme() {
  const color = $("#customThemeColor").value;
  const mode = $("#customThemeMode").value;
  await chrome.storage.local.set({ orbyCompactTheme: { name: "custom", color, mode } });
  await applyTheme();
}
$("#customThemeColor").addEventListener("input", saveCustomTheme);
$("#customThemeMode").addEventListener("change", saveCustomTheme);

async function loadTab() {
  if (!state.config) return;
  setStatus("Carregando...");
  try {
    if (state.tab === "tarefas") await renderTasks();
    if (state.tab === "posts") await renderPosts();
    if (state.tab === "caderno") await renderNotebook();
    if (state.tab === "habitos") await renderHabits();
    if (state.tab === "listas") await renderLists();
    if (state.tab === "notificacoes") await renderNotifications();
    setStatus("");
  } catch (error) { setStatus(error.message, true); $("#content").innerHTML = `<div class="empty">Não foi possível carregar esta seção.</div>`; }
}
const uid = () => encodeURIComponent(state.config.userId);
function head(title, action = "") { return `<div class="section-head"><h2>${title}</h2>${action}</div>`; }
function empty(text) { return `<div class="empty">${text}</div>`; }
function bindForm(id, handler) { const form = $(id); if (form) form.addEventListener("submit", async event => { event.preventDefault(); try { await handler(new FormData(form)); } catch (error) { setStatus(error.message, true); } }); }
function bindDelete(selector, handler) {
  const dataAttribute = selector.match(/\[data-([a-z-]+)\]/)?.[1];
  const dataKey = dataAttribute?.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  document.querySelectorAll(selector).forEach(button => button.addEventListener("click", async () => {
    try {
      const id = dataKey ? button.dataset[dataKey] : button.dataset.id;
      if (!id) throw new Error("Não foi possível identificar o item para excluir.");
      await handler(id);
    } catch (error) { setStatus(error.message, true); }
  }));
}
function openEditModal(title, content, onSubmit) {
  const dialog = $("#editModal");
  $("#editModalTitle").textContent = title;
  $("#editModalContent").innerHTML = content;
  $("#editModalStatus").textContent = "";
  $("#editModalStatus").className = "edit-modal-status";
  dialog.showModal();
  const form = $("#editModalForm");
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = $("#editModalSubmit");
    submit.disabled = true;
    $("#editModalStatus").textContent = "";
    try {
      await onSubmit(new FormData(form));
      dialog.close();
    } catch (error) {
      $("#editModalStatus").textContent = error.message || "Não foi possível salvar as alterações.";
      $("#editModalStatus").classList.add("error");
    } finally {
      submit.disabled = false;
    }
  };
  dialog.querySelector("[autofocus]")?.focus();
}
document.querySelectorAll("[data-modal-close]").forEach(button => button.addEventListener("click", () => $("#editModal").close()));
$("#editModal").addEventListener("click", event => {
  if (event.target === $("#editModal")) $("#editModal").close();
});
function openHabitEditModal(habit, zone) {
  let hours = [...(habit.horarios || [])];
  const renderHours = () => {
    const chips = $("#editHabitHours");
    if (!chips) return;
    chips.innerHTML = hours.map(hour => `<button type="button" class="hour-chip" data-edit-remove-hour="${hour}">${hour}<i class="bi bi-x-lg" aria-hidden="true"></i></button>`).join("") || "<small>Adicione pelo menos dois horários.</small>";
    chips.querySelectorAll("[data-edit-remove-hour]").forEach(button => button.addEventListener("click", () => {
      hours = hours.filter(hour => hour !== button.dataset.editRemoveHour);
      renderHours();
    }));
  };
  const updateTypeFields = () => {
    const type = $("#editHabitType").value;
    $("#editHabitReminder").hidden = type !== "simples";
    $("#editHabitSchedule").hidden = type === "simples";
    $("#editHabitEndField").hidden = type !== "objetivo";
    $("#editHabitEnd").required = type === "objetivo";
  };
  openEditModal("Editar hábito", `
    <label class="modal-field">Nome<input class="field" name="nome" maxlength="100" value="${escapeHtml(habit.nome)}" required autofocus></label>
    <label class="modal-field">Tipo<select id="editHabitType" name="tipo" class="field">
      <option value="simples" ${habit.tipo === "simples" ? "selected" : ""}>Diário</option>
      <option value="horarios" ${habit.tipo === "horarios" ? "selected" : ""}>Vários horários</option>
      <option value="objetivo" ${habit.tipo === "objetivo" ? "selected" : ""}>Objetivo com data final</option>
    </select></label>
    <label id="editHabitReminder" class="modal-field" ${habit.tipo !== "simples" ? "hidden" : ""}>Lembrete<input class="field" name="horario" type="time" value="${escapeHtml(habit.horario || "09:00")}"></label>
    <div id="editHabitSchedule" class="hour-adder" ${habit.tipo === "simples" ? "hidden" : ""}>
      <label class="field-label">Horários para concluir</label>
      <div class="row"><input id="editHabitHourInput" type="time" class="field" value="09:00"><button id="editHabitAddHour" type="button" class="small-button secondary"><i class="bi bi-plus-lg" aria-hidden="true"></i> Adicionar</button></div>
      <div id="editHabitHours" class="hour-chips"></div>
    </div>
    <label id="editHabitEndField" class="modal-field" ${habit.tipo !== "objetivo" ? "hidden" : ""}>Data final<input id="editHabitEnd" class="field" name="dataFinal" type="date" value="${escapeHtml(habit.dataFinal || "")}" ${habit.tipo === "objetivo" ? "required" : ""}></label>
  `, async data => {
    const type = data.get("tipo");
    const scheduled = type !== "simples";
    if (scheduled && hours.length < 2) throw new Error("Adicione pelo menos dois horários diferentes.");
    const ending = type === "objetivo" ? data.get("dataFinal") : "";
    if (type === "objetivo" && !ending) throw new Error("Escolha a data final do objetivo.");
    await api(`/habitos/${uid()}/${habit._id}`, json("PUT", {
      nome: data.get("nome"),
      tipo: type,
      dataFinal: ending,
      horario: scheduled ? hours[0] : data.get("horario"),
      horarios: scheduled ? hours : [],
      fusoHorario: zone
    }));
    await renderHabits();
  });
  $("#editHabitType").addEventListener("change", updateTypeFields);
  $("#editHabitAddHour").addEventListener("click", () => {
    const hour = $("#editHabitHourInput").value;
    if (!hour || hours.includes(hour)) return;
    if (hours.length >= 12) {
      $("#editModalStatus").textContent = "Você pode adicionar até 12 horários.";
      $("#editModalStatus").classList.add("error");
      return;
    }
    hours = [...hours, hour].sort();
    renderHours();
  });
  renderHours();
}

async function renderTasks() {
  const tasks = await api(`/tarefas/${uid()}?data=${state.date}`);
  const visibleTasks = tasks.filter(task => state.taskFilter === "all" || (state.taskFilter === "done" ? task.concluida : !task.concluida));
  const filters = `<div class="task-filters" role="group" aria-label="Filtrar tarefas">${[["all",`Todas · ${tasks.length}`],["open",`Pendentes · ${tasks.filter(task => !task.concluida).length}`],["done",`Concluídas · ${tasks.filter(task => task.concluida).length}`]].map(([key,label]) => `<button type="button" data-task-filter="${key}" aria-pressed="${state.taskFilter === key}">${label}</button>`).join("")}</div>`;
  $("#content").innerHTML = `${head("Tarefas", `<input id="taskDate" class="field" type="date" value="${state.date}" style="width:145px;padding:6px">`)}${filters}<form id="taskForm" class="inline-form"><input name="texto" class="field" maxlength="300" placeholder="Nova tarefa..." required><button class="small-button"><i class="bi bi-plus-lg" aria-hidden="true"></i> Adicionar</button></form><div class="list">${visibleTasks.length ? visibleTasks.map(task => `<article class="card task ${task.concluida ? "done" : ""}"><label class="task-completion" title="${task.concluida ? "Concluída" : "Marcar como concluída"}"><input type="checkbox" data-task-check="${task._id}" ${task.concluida ? "checked" : ""}><i class="bi ${task.concluida ? "bi-check-circle-fill" : "bi-circle"}" aria-hidden="true"></i></label><div class="task-main"><div class="card-title">${escapeHtml(task.texto)}</div><div class="muted">${new Date(task.dataCriacao).toLocaleTimeString("pt-BR", {hour:"2-digit",minute:"2-digit"})}${task.concluida ? ` · <i class="bi bi-check2" aria-hidden="true"></i> Concluída` : ""}</div></div><div class="actions"><button class="action-icon" data-task-edit="${task._id}" aria-label="Editar"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button class="text-button action-icon" data-task-delete="${task._id}" aria-label="Excluir"><i class="bi bi-trash3" aria-hidden="true"></i></button></div></article>`).join("") : empty(state.taskFilter === "done" ? "Nenhuma tarefa concluída neste dia." : state.taskFilter === "open" ? "Todas as tarefas deste dia estão concluídas." : "Nenhuma tarefa neste dia.")}</div>`;
  $("#taskDate").addEventListener("change", event => { state.date = event.target.value; renderTasks(); });
  document.querySelectorAll("[data-task-filter]").forEach(button => button.addEventListener("click", () => { state.taskFilter = button.dataset.taskFilter; renderTasks(); }));
  bindForm("#taskForm", async data => { await api("/tarefas", json("POST", { userId: state.config.userId, texto: data.get("texto"), data: state.date, hora: "09", minuto: "00" })); await renderTasks(); });
  document.querySelectorAll("[data-task-check]").forEach(input => input.addEventListener("change", async () => { await api(`/tarefas/${uid()}/${input.dataset.taskCheck}`, json("PUT", { concluida: input.checked })); await renderTasks(); }));
  document.querySelectorAll("[data-task-edit]").forEach(button => button.addEventListener("click", () => {
    const task = tasks.find(item => item._id === button.dataset.taskEdit);
    if (!task) return;
    const scheduledAt = new Date(task.dataCriacao);
    const time = `${String(scheduledAt.getHours()).padStart(2, "0")}:${String(scheduledAt.getMinutes()).padStart(2, "0")}`;
    openEditModal("Editar tarefa", `
      <label class="modal-field">Descrição<input class="field" name="texto" maxlength="300" value="${escapeHtml(task.texto)}" required autofocus></label>
      <label class="modal-field">Data<input class="field" name="data" type="date" value="${localDate(scheduledAt)}" required></label>
      <label class="modal-field">Horário<input class="field" name="hora" type="time" step="300" value="${time}" required></label>
    `, async data => {
      const [hour, minute] = String(data.get("hora")).split(":");
      await api(`/tarefas/${uid()}/${task._id}`, json("PUT", {
        texto: data.get("texto"),
        data: data.get("data"),
        hora: hour,
        minuto: minute
      }));
      await renderTasks();
    });
  }));
  bindDelete("[data-task-delete]", async id => { await api(`/tarefas/${uid()}/${id}`, { method: "DELETE" }); await renderTasks(); });
}

async function renderPosts() {
  const posts = await api(`/posts/${uid()}`);
  $("#content").innerHTML = `${head("Posts")}<form id="postForm" class="list" style="margin-bottom:12px"><input class="field" name="titulo" maxlength="100" placeholder="Título do post-it" required><textarea class="field" name="descricao" maxlength="2000" rows="2" placeholder="Anotação"></textarea><button class="small-button"><i class="bi bi-plus-lg" aria-hidden="true"></i> Criar post-it</button></form><div class="list">${posts.length ? posts.map(post => `<article class="card post-card" style="--post-color:${escapeHtml(post.cor || "#8bc9aa")}"><div class="row"><div class="card-title" style="flex:1">${escapeHtml(post.titulo)}</div><div class="actions"><button class="action-icon" data-post-edit="${post._id}" aria-label="Editar"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button class="action-icon" data-post-delete="${post._id}" aria-label="Excluir"><i class="bi bi-trash3" aria-hidden="true"></i></button></div></div><div class="muted" style="white-space:pre-wrap">${escapeHtml(post.descricao)}</div></article>`).join("") : empty("Nenhum post-it criado.")}</div>`;
  bindForm("#postForm", async data => { await api(`/posts/${uid()}`, json("POST", { titulo: data.get("titulo"), descricao: data.get("descricao") || "", cor: "#a6dfbd", x: 16, y: 16 })); await renderPosts(); });
  bindDelete("[data-post-delete]", async id => { await api(`/posts/${uid()}/${id}`, { method: "DELETE" }); await renderPosts(); });
  document.querySelectorAll("[data-post-edit]").forEach(button => button.addEventListener("click", () => {
    const post = posts.find(item => item._id === button.dataset.postEdit);
    if (!post) return;
    openEditModal("Editar post-it", `
      <label class="modal-field">Título<input class="field" name="titulo" maxlength="100" value="${escapeHtml(post.titulo)}" required autofocus></label>
      <label class="modal-field">Anotação<textarea class="field" name="descricao" maxlength="2000" rows="6">${escapeHtml(post.descricao || "")}</textarea></label>
    `, async data => {
      await api(`/posts/${uid()}/${post._id}`, json("PUT", { titulo: data.get("titulo"), descricao: data.get("descricao") }));
      await renderPosts();
    });
  }));
}

async function renderNotebook() {
  const pages = await api(`/caderno/${uid()}`);
  const selected = state.cache.pageId ? pages.find(page => page._id === state.cache.pageId) : pages[0];
  state.cache.pageId = selected?._id || null;
  $("#content").innerHTML = `${head("Caderno", `<button id="newPage" class="small-button"><i class="bi bi-plus-lg" aria-hidden="true"></i> Folha</button>`)}${pages.length ? `<div class="row" style="margin-bottom:9px"><select id="pageSelect" class="field">${pages.map(page => `<option value="${page._id}" ${page._id === selected?._id ? "selected" : ""}>${escapeHtml(page.titulo)}</option>`).join("")}</select><button id="deletePage" class="text-button action-icon" title="Excluir folha" aria-label="Excluir folha"><i class="bi bi-trash3" aria-hidden="true"></i></button></div><article class="card notebook-preview"><div class="card-title">${escapeHtml(selected.titulo)}</div><div class="notebook-preview-content">${escapeHtml(selected.conteudo || "Esta folha ainda está vazia.")}</div></article><button id="editPage" class="small-button notebook-edit"><i class="bi bi-pencil-square" aria-hidden="true"></i> Editar folha</button>` : empty("Seu caderno está vazio. Crie uma folha para começar.")}`;
  $("#newPage").addEventListener("click", async () => { const page = await api(`/caderno/${uid()}`, json("POST", { titulo: `Folha ${pages.length + 1}` })); state.cache.pageId = page._id; await renderNotebook(); });
  if (pages.length) {
    $("#pageSelect").addEventListener("change", event => { state.cache.pageId = event.target.value; renderNotebook(); });
    $("#editPage").addEventListener("click", () => openEditModal("Editar folha", `
      <label class="modal-field">Título<input class="field" name="titulo" maxlength="100" value="${escapeHtml(selected.titulo)}" required autofocus></label>
      <label class="modal-field">Anotação<textarea class="field note modal-note" name="conteudo" maxlength="8000" placeholder="Escreva suas anotações...">${escapeHtml(selected.conteudo || "")}</textarea></label>
    `, async data => {
      await api(`/caderno/${uid()}/${selected._id}`, json("PUT", { titulo: data.get("titulo"), conteudo: data.get("conteudo") }));
      await renderNotebook();
      setStatus("Folha salva.");
    }));
    $("#deletePage").addEventListener("click", async () => { if (confirm("Excluir esta folha?")) { await api(`/caderno/${uid()}/${selected._id}`, { method: "DELETE" }); state.cache.pageId = null; await renderNotebook(); } });
  }
}

async function renderHabits() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const habits = await api(`/habitos/${uid()}?fusoHorario=${encodeURIComponent(zone)}`);
  const today = localDate();
  const previousName = $("#habitName");
  const previousEnd = $("#habitEnd");
  const previousReminder = document.querySelector("#habitForm [name='horario']");
  const name = previousName ? previousName.value : "";
  const ending = previousEnd ? previousEnd.value : "";
  const reminder = previousReminder ? previousReminder.value : "09:00";
  const type = $("#habitType")?.value || "simples";
  const hours = state.cache.habitHours || [];
  $("#content").innerHTML = `${head("Hábitos", `<span class="habit-count">${habits.length} ${habits.length === 1 ? "hábito" : "hábitos"}</span>`)}<form id="habitForm" class="habit-form"><div class="row"><input id="habitName" name="nome" class="field" maxlength="100" placeholder="Nome do hábito" value="${escapeHtml(name)}" required><button class="small-button"><i class="bi bi-plus-lg" aria-hidden="true"></i> Adicionar</button></div><div class="row"><select id="habitType" class="field"><option value="simples" ${type === "simples" ? "selected" : ""}>Diário</option><option value="horarios" ${type === "horarios" ? "selected" : ""}>Vários horários</option><option value="objetivo" ${type === "objetivo" ? "selected" : ""}>Objetivo com data final</option></select>${type === "simples" ? `<label class="time-field">Lembrete<input name="horario" type="time" class="field" value="${escapeHtml(reminder)}"></label>` : ""}</div>${type !== "simples" ? `<div class="hour-adder"><label class="field-label">Horários para concluir</label><div class="row"><input id="habitHourInput" type="time" class="field" value="09:00"><button id="addHabitHour" type="button" class="small-button secondary"><i class="bi bi-plus-lg" aria-hidden="true"></i> Adicionar horário</button></div><div class="hour-chips">${hours.map(hour => `<button type="button" class="hour-chip" data-remove-hour="${hour}">${hour}<i class="bi bi-x-lg" aria-hidden="true"></i></button>`).join("") || `<small>Adicione pelo menos dois horários.</small>`}</div></div>` : ""}${type === "objetivo" ? `<label class="field-label goal-date">Data final<input id="habitEnd" class="field" type="date" value="${escapeHtml(ending)}" required></label>` : ""}</form><div class="habit-list">${habits.length ? habits.map(habit => {
    const completedHours = habit.conclusoesHorarios || [];
    const completed = (habit.diasConcluidos || []).includes(today);
    const isGoalExpired = habit.tipo === "objetivo" && habit.dataFinal < today;
    const hourControls = (habit.horarios || []).map(hour => { const checked = completedHours.includes(`${today}@${hour}`); return `<label class="habit-hour ${checked ? "checked" : ""}"><input type="checkbox" data-habit-hour="${habit._id}" data-hour="${hour}" ${checked ? "checked" : ""} ${isGoalExpired ? "disabled" : ""}><span>${hour}</span></label>`; }).join("");
    return `<article class="card habit-card"><div class="habit-card-head">${habit.tipo === "simples" ? `<label class="task-completion"><input class="habit-check" type="checkbox" data-habit-check="${habit._id}" ${completed ? "checked" : ""} ${isGoalExpired ? "disabled" : ""}><i class="bi ${completed ? "bi-check-circle-fill" : "bi-circle"}" aria-hidden="true"></i></label>` : `<span class="habit-symbol"><i class="bi ${completed ? "bi-check-circle-fill" : "bi-clock"}" aria-hidden="true"></i></span>`}<div class="habit-main"><div class="card-title">${escapeHtml(habit.nome)}</div><div class="muted">${habit.tipo === "objetivo" ? `Objetivo até ${escapeHtml(habit.dataFinal)}` : habit.tipo === "horarios" ? `${(habit.horarios || []).length} horários por dia` : `Lembrete ${escapeHtml(habit.horario || "09:00")}`}</div></div><div class="actions"><button class="action-icon" data-habit-edit="${habit._id}" aria-label="Editar"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button class="action-icon" data-habit-delete="${habit._id}" aria-label="Excluir"><i class="bi bi-trash3" aria-hidden="true"></i></button></div></div>${habit.horarios?.length ? `<div class="habit-hours">${hourControls}</div>` : ""}<div class="habit-progress"><span>${habit.horarios?.length ? `${completedHours.filter(value => value.startsWith(`${today}@`)).length} de ${habit.horarios.length} concluídos hoje` : completed ? "Concluído hoje" : isGoalExpired ? "Objetivo encerrado" : "Ainda não concluído hoje"}</span><span class="progress-track"><i style="width:${habit.horarios?.length ? Math.round(completedHours.filter(value => value.startsWith(`${today}@`)).length / habit.horarios.length * 100) : completed ? 100 : 0}%"></i></span></div></article>`;
  }).join("") : empty("Nenhum hábito cadastrado.")}</div>`;
  state.cache.habitHours = hours;
  $("#habitType").addEventListener("change", () => { state.cache.habitHours = []; renderHabits(); });
  if ($("#addHabitHour")) $("#addHabitHour").addEventListener("click", () => {
    const hour = $("#habitHourInput").value;
    if (!hour || state.cache.habitHours.includes(hour)) return;
    if (state.cache.habitHours.length >= 12) return setStatus("Você pode adicionar até 12 horários.", true);
    state.cache.habitHours = [...state.cache.habitHours, hour].sort(); renderHabits();
  });
  document.querySelectorAll("[data-remove-hour]").forEach(button => button.addEventListener("click", () => { state.cache.habitHours = state.cache.habitHours.filter(hour => hour !== button.dataset.removeHour); renderHabits(); }));
  bindForm("#habitForm", async data => {
    const selectedType = $("#habitType").value;
    const scheduled = selectedType !== "simples";
    if (scheduled && state.cache.habitHours.length < 2) throw new Error("Adicione pelo menos dois horários diferentes.");
    if (selectedType === "objetivo" && !$("#habitEnd").value) throw new Error("Escolha a data final do objetivo.");
    const payload = { nome: data.get("nome"), tipo: selectedType, dataFinal: selectedType === "objetivo" ? $("#habitEnd").value : "", horario: scheduled ? state.cache.habitHours[0] : data.get("horario"), horarios: scheduled ? state.cache.habitHours : [], fusoHorario: zone };
    await api(`/habitos/${uid()}`, json("POST", payload));
    state.cache.habitHours = []; await renderHabits();
  });
  document.querySelectorAll("[data-habit-check]").forEach(input => input.addEventListener("change", async () => { await api(`/habitos/${uid()}/${input.dataset.habitCheck}/conclusao`, json("PUT", { data: today })); await renderHabits(); }));
  document.querySelectorAll("[data-habit-hour]").forEach(input => input.addEventListener("change", async () => { await api(`/habitos/${uid()}/${input.dataset.habitHour}/conclusao`, json("PUT", { data: today, horario: input.dataset.hour })); await renderHabits(); }));
  document.querySelectorAll("[data-habit-edit]").forEach(button => button.addEventListener("click", () => {
    const habit = habits.find(item => item._id === button.dataset.habitEdit);
    if (habit) openHabitEditModal(habit, zone);
  }));
  bindDelete("[data-habit-delete]", async id => { await api(`/habitos/${uid()}/${id}`, { method: "DELETE" }); await renderHabits(); });
}

async function renderLists() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const lists = await api(`/listas/${uid()}?fusoHorario=${encodeURIComponent(zone)}`);
  const active = state.cache.listId ? lists.find(item => item._id === state.cache.listId) : lists[0];
  state.cache.listId = active?._id || null;
  $("#content").innerHTML = `${head("Listas")}<form id="listForm" class="inline-form"><input name="nome" class="field" maxlength="100" placeholder="Nova lista..." required><button class="small-button"><i class="bi bi-plus-lg" aria-hidden="true"></i> Criar</button></form>${lists.length ? `<div class="row" style="margin-bottom:9px"><select id="listSelect" class="field">${lists.map(list => `<option value="${list._id}" ${list._id === active?._id ? "selected" : ""}>${escapeHtml(list.nome)}</option>`).join("")}</select><button id="editList" class="action-icon" aria-label="Editar lista"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button id="deleteList" class="text-button action-icon" aria-label="Excluir lista"><i class="bi bi-trash3" aria-hidden="true"></i></button></div><form id="itemForm" class="inline-form"><input name="texto" class="field" maxlength="300" placeholder="Adicionar item..." required><button class="small-button" aria-label="Adicionar item"><i class="bi bi-plus-lg" aria-hidden="true"></i></button></form><div class="list">${(active.itens || []).map(item => `<article class="card item ${item.concluido ? "done" : ""}"><label class="task-completion"><input type="checkbox" data-item-check="${item._id}" ${item.concluido ? "checked" : ""}><i class="bi ${item.concluido ? "bi-check-circle-fill" : "bi-circle"}" aria-hidden="true"></i></label><span>${escapeHtml(item.texto)}</span><div class="actions"><button class="action-icon" data-item-edit="${item._id}" aria-label="Editar item"><i class="bi bi-pencil-square" aria-hidden="true"></i></button><button class="text-button action-icon" data-item-delete="${item._id}" aria-label="Excluir item"><i class="bi bi-trash3" aria-hidden="true"></i></button></div></article>`).join("") || empty("Adicione o primeiro item.")}</div>` : empty("Crie uma lista para organizar seus itens.")}`;
  bindForm("#listForm", async data => { const list = await api(`/listas/${uid()}`, json("POST", { nome: data.get("nome"), tipo: "simples", dataFinal: "", recorrencia: "diaria", fusoHorario: zone })); state.cache.listId = list._id; await renderLists(); });
  if (active) {
    $("#listSelect").addEventListener("change", event => { state.cache.listId = event.target.value; renderLists(); });
    $("#editList").addEventListener("click", () => openEditModal("Editar lista", `
      <label class="modal-field">Nome<input class="field" name="nome" maxlength="100" value="${escapeHtml(active.nome)}" required autofocus></label>
    `, async data => {
      await api(`/listas/${uid()}/${active._id}`, json("PUT", {
        nome: data.get("nome"),
        tipo: active.tipo || "simples",
        dataFinal: active.dataFinal || "",
        recorrencia: active.recorrencia || "diaria",
        diaRecorrencia: active.diaRecorrencia ?? null,
        fusoHorario: zone
      }));
      await renderLists();
    }));
    bindForm("#itemForm", async data => { await api(`/listas/${uid()}/${active._id}/itens`, json("POST", { texto: data.get("texto") })); await renderLists(); });
    $("#deleteList").addEventListener("click", async () => { if (confirm("Excluir esta lista e seus itens?")) { await api(`/listas/${uid()}/${active._id}`, { method: "DELETE" }); state.cache.listId = null; await renderLists(); } });
    document.querySelectorAll("[data-item-check]").forEach(input => input.addEventListener("change", async () => { await api(`/listas/${uid()}/${active._id}/itens/${input.dataset.itemCheck}`, json("PUT", { concluido: input.checked })); await renderLists(); }));
    document.querySelectorAll("[data-item-edit]").forEach(button => button.addEventListener("click", () => {
      const item = active.itens.find(entry => entry._id === button.dataset.itemEdit);
      if (!item) return;
      openEditModal("Editar item", `
        <label class="modal-field">Descrição<input class="field" name="texto" maxlength="300" value="${escapeHtml(item.texto)}" required autofocus></label>
      `, async data => {
        await api(`/listas/${uid()}/${active._id}/itens/${item._id}`, json("PUT", { texto: data.get("texto") }));
        await renderLists();
      });
    }));
    bindDelete("[data-item-delete]", async id => { await api(`/listas/${uid()}/${active._id}/itens/${id}`, { method: "DELETE" }); await renderLists(); });
  }
}

async function renderNotifications() {
  const notifications = await api(`/notificacoes/${uid()}`);
  await chrome.storage.local.set({ orbyCompactNotifications: notifications });
  updateNotificationBadge(notifications);
  const typeNames = {
    diaria: "Tarefa",
    importante: "Tarefa importante",
    habito: "Hábito",
    xadrez_convite: "Convite de xadrez",
    xadrez_lance: "Partida de xadrez",
    usuario_mensagem: "Mensagem",
    usuario_tremida: "Notificação"
  };
  const clearAction = notifications.length
    ? `<button id="clearNotifications" class="text-button"><i class="bi bi-trash3" aria-hidden="true"></i> Limpar tudo</button>`
    : "";
  $("#content").innerHTML = `${head("Notificações", clearAction)}<div class="notification-list">${notifications.length ? notifications.map(notification => {
    const created = new Date(notification.criadaEm);
    const dateText = Number.isNaN(created.getTime()) ? "" : created.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
    return `<article class="card notification-card ${notification.lida ? "" : "unread"}">
      <div class="notification-card-heading"><span class="notification-type">${escapeHtml(typeNames[notification.tipo] || "Notificação")}</span>${notification.lida ? "" : `<span class="unread-dot" aria-label="Não lida"></span>`}</div>
      <h3>${escapeHtml(notification.titulo)}</h3>
      <p>${escapeHtml(notification.texto)}</p>
      <div class="notification-card-footer"><time>${escapeHtml(dateText)}</time>${notification.lida ? "" : `<button class="text-button" data-notification-read="${escapeHtml(notification._id)}">Marcar como lida</button>`}</div>
    </article>`;
  }).join("") : empty("Você não tem notificações.")}</div>`;
  document.querySelectorAll("[data-notification-read]").forEach(button => button.addEventListener("click", async () => {
    try {
      await api(`/notificacoes/${uid()}/${encodeURIComponent(button.dataset.notificationRead)}`, json("PUT", { lida: true }));
      await renderNotifications();
    } catch (error) { setStatus(error.message, true); }
  }));
  if ($("#clearNotifications")) $("#clearNotifications").addEventListener("click", async () => {
    if (!confirm("Apagar todas as notificações?")) return;
    try {
      await api(`/notificacoes/${uid()}`, { method: "DELETE" });
      await chrome.storage.local.set({ orbyCompactNotifications: [] });
      await renderNotifications();
    } catch (error) { setStatus(error.message, true); }
  });
}

initialize().catch(error => { showSetup(); $("#loginStatus").textContent = error.message; });
