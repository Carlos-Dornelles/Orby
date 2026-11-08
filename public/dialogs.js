(() => {
  const dialog = document.getElementById("orbyDialog");
  const title = document.getElementById("orbyDialogTitle");
  const message = document.getElementById("orbyDialogMessage");
  const input = document.getElementById("orbyDialogInput");
  const cancel = document.getElementById("orbyDialogCancel");
  const accept = document.getElementById("orbyDialogAccept");
  const queue = [];
  let active = null;

  function show(options) {
    return new Promise(resolve => {
      queue.push({ ...options, resolve });
      renderNext();
    });
  }

  function renderNext() {
    if (active || !queue.length) return;
    active = queue.shift();
    if (active.type === "confirm") {
      const tema = document.documentElement.dataset.specialTheme;
      const arquivoSom = tema === "wii"
        ? "/sons/wii%20erro.mp3"
        : tema === "aero" ? "/sons/error-win-7.mp3" : "";
      if (arquivoSom) {
        const som = new Audio(arquivoSom);
        som.volume = 0.55;
        void som.play().catch(() => {});
      }
    }
    title.textContent = active.title;
    message.textContent = active.message;
    input.hidden = active.type !== "prompt";
    input.value = active.value || "";
    cancel.hidden = active.type === "alert";
    accept.textContent = active.acceptLabel || (active.type === "confirm" ? "Confirmar" : "OK");
    accept.classList.toggle("orby-dialog-danger", active.danger === true);
    dialog.hidden = false;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    requestAnimationFrame(() => active?.type === "prompt" ? input.focus() : accept.focus());
  }

  function close(result) {
    if (!active) return;
    const current = active;
    active = null;
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
    dialog.hidden = true;
    current.resolve(result);
    renderNext();
  }

  cancel.addEventListener("click", () => close(active?.type === "prompt" ? null : false));
  accept.addEventListener("click", () => close(active?.type === "prompt" ? input.value : true));
  dialog.addEventListener("click", event => {
    if (event.target === dialog && active?.type !== "alert") close(active?.type === "prompt" ? null : false);
  });
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (active?.type !== "alert") close(active?.type === "prompt" ? null : false);
    }
    if (event.key === "Enter" && active?.type === "prompt") close(input.value);
  });

  window.orbyConfirm = (text, options = {}) => show({ type: "confirm", title: options.title || "Confirmar ação", message: String(text), ...options });
  window.orbyPrompt = (text, value = "", options = {}) => show({ type: "prompt", title: options.title || "Editar informação", message: String(text), value, ...options });
  window.alert = text => { void show({ type: "alert", title: "Aviso", message: String(text) }); };
})();
