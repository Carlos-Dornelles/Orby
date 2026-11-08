(() => {
  "use strict";

  const COLORS = ["#172033", "#e5484d", "#2585f5", "#20a66a", "#f4b629", "#9348d8", "#ff8b35"];
  const CANVAS_WIDTH = 960;
  const CANVAS_HEIGHT = 720;
  const drawingCache = new Map();
  const messageCache = new Map();
  let selectedColor = COLORS[0];
  let selectedTool = "pencil";
  let selectedSize = 7;
  let deadlineInterval = null;
  let activeCanvas = null;
  let activeChatLog = null;
  let drawingInProgress = false;
  let pendingRender = false;
  let undoKeyHandler = null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function createToolIcon(toolId) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("party-gartic-tool-icon");
    const addShape = (tag, attributes) => {
      const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
      for (const [name, value] of Object.entries(attributes)) shape.setAttribute(name, value);
      svg.appendChild(shape);
    };
    const stroke = {
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round"
    };
    if (toolId === "square") {
      addShape("rect", { ...stroke, x: "4", y: "4", width: "16", height: "16", rx: "2" });
    } else if (toolId === "circle") {
      addShape("circle", { ...stroke, cx: "12", cy: "12", r: "8" });
    } else if (toolId === "triangle") {
      addShape("path", { ...stroke, d: "M12 4 21 20H3L12 4Z" });
    } else if (toolId === "line") {
      addShape("path", { ...stroke, d: "M4 20 20 4" });
    } else if (toolId === "eraser") {
      addShape("path", { ...stroke, d: "m7 16 8-10a2 2 0 0 1 3-.2l2.2 1.8a2 2 0 0 1 .3 2.8L13 20H7l-3-2.4a2 2 0 0 1-.3-2.8L7 10" });
      addShape("path", { ...stroke, d: "m10 20 6-7" });
    } else {
      addShape("path", { ...stroke, d: "m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" });
      addShape("path", { ...stroke, d: "m13.8 7.7 3 3" });
    }
    return svg;
  }

  function cacheKey(roomId, roundNumber) {
    return `${roomId || "party"}:${roundNumber}`;
  }

  function rememberRound(cache, key, initialValue) {
    if (!cache.has(key)) cache.set(key, initialValue);
    while (cache.size > 20) cache.delete(cache.keys().next().value);
    return cache.get(key);
  }

  function updateDrawingCache(key, round) {
    const cache = rememberRound(drawingCache, key, { revision: 0, operations: [] });
    if (Array.isArray(round.drawingOps)) {
      cache.operations = round.drawingOps;
      cache.revision = round.drawingRevision || 0;
    } else if (round.lastDrawingOp && round.lastDrawingOp.revision > cache.revision) {
      if (round.lastDrawingOp.type === "undo") cache.operations.pop();
      else cache.operations.push(round.lastDrawingOp);
      cache.revision = round.lastDrawingOp.revision;
    }
    return cache;
  }

  function updateMessageCache(key, round) {
    const cache = rememberRound(messageCache, key, []);
    if (Array.isArray(round.messages)) {
      cache.splice(0, cache.length, ...round.messages);
    } else if (round.lastMessage &&
      !cache.some(message => message.sequence === round.lastMessage.sequence)) {
      cache.push(round.lastMessage);
      if (cache.length > 40) cache.shift();
    }
    return cache;
  }

  function drawOperation(context, operation) {
    if (operation.type === "clear") {
      context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      return;
    }
    if (!Array.isArray(operation.points) || operation.points.length < 2) return;
    context.beginPath();
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = operation.size;
    context.strokeStyle = operation.eraser ? "#fff" : operation.color;
    if (operation.shape) {
      drawShape(context, operation.shape, operation.points);
      return;
    }
    context.moveTo(operation.points[0][0], operation.points[0][1]);
    for (const [x, y] of operation.points.slice(1)) context.lineTo(x, y);
    context.stroke();
  }

  function drawShape(context, shape, points) {
    const [[startX, startY], [endX, endY]] = points;
    const width = Math.abs(endX - startX);
    const height = Math.abs(endY - startY);
    const left = Math.min(startX, endX);
    const top = Math.min(startY, endY);
    if (shape === "line") {
      context.moveTo(startX, startY);
      context.lineTo(endX, endY);
    } else if (shape === "square") {
      context.strokeRect(startX, startY, endX - startX, endY - startY);
    } else if (shape === "circle") {
      context.arc((startX + endX) / 2, (startY + endY) / 2, Math.max(1, Math.max(width, height) / 2), 0, Math.PI * 2);
    } else if (shape === "triangle") {
      context.moveTo((startX + endX) / 2, top);
      context.lineTo(left, Math.max(startY, endY));
      context.lineTo(Math.max(startX, endX), Math.max(startY, endY));
      context.closePath();
    }
    context.stroke();
  }

  function drawHistory(context, operations) {
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (const operation of operations) drawOperation(context, operation);
  }

  function renderMessages(log, messages) {
    log.replaceChildren();
    for (const message of messages) {
      const row = element("div", `party-gartic-message ${message.type || "guess"}`);
      if (message.type !== "system") {
        const name = element("strong", "", `${message.username}: `);
        row.appendChild(name);
      }
      row.appendChild(document.createTextNode(message.text));
      log.appendChild(row);
    }
    log.scrollTop = log.scrollHeight;
  }

  function render(root, state, {
    roomId,
    userId,
    loadProfile,
    renderAvatar,
    onAction,
    onError,
    onInteractionEnd
  } = {}) {
    clearInterval(deadlineInterval);
    deadlineInterval = null;
    if (undoKeyHandler) {
      document.removeEventListener("keydown", undoKeyHandler);
      undoKeyHandler = null;
    }
    activeCanvas = null;
    activeChatLog = null;
    drawingInProgress = false;
    pendingRender = false;
    root.replaceChildren();
    root.className = "party-game-controls party-gartic-controls";
    root.hidden = false;
    if (!state || state.mode !== "gartic" || !Array.isArray(state.players)) {
      root.appendChild(element("p", "party-gartic-loading", "Preparando o Rabisco…"));
      return;
    }

    const round = state.currentRound;
    if (!round) {
      root.appendChild(element("p", "party-gartic-loading", state.message || "Partida concluída."));
      return;
    }
    const key = cacheKey(roomId, round.roundNumber);
    const drawCache = updateDrawingCache(key, round);
    const messages = updateMessageCache(key, round);
    const drawer = String(round.drawerUserId) === String(userId);
    const alreadyGuessed = round.guessedUserIds.includes(String(userId));
    const result = round.result;
    const shell = element("section", "party-gartic-shell");
    const header = element("header", "party-gartic-header");
    const brand = element("div", "party-gartic-brand");
    brand.append(
      element("span", "party-gartic-brand-mark", "✏"),
      element("strong", "", "rabisco"),
      element("span", "party-gartic-brand-dot", ".")
    );
    const status = element("div", "party-gartic-top-info");
    status.append(
      element("span", "party-gartic-pill", `Rodada ${round.roundNumber} / 5`),
      element("span", "party-gartic-pill party-gartic-timer", "01:30")
    );
    header.append(brand, status);
    shell.appendChild(header);

    const layout = element("main", "party-gartic-layout");
    const playersPanel = element("aside", "party-gartic-panel");
    playersPanel.appendChild(element("h3", "party-gartic-side-title", "Jogadores"));
    const players = element("div", "party-gartic-players");
    for (const player of state.players) {
      const card = element("div", "party-gartic-player");
      if (player.userId === round.drawerUserId) card.classList.add("is-drawer");
      if (round.guessedUserIds.includes(player.userId)) card.classList.add("has-guessed");
      const avatar = element("span", "party-gartic-avatar");
      if (renderAvatar) renderAvatar(avatar, null, player.username);
      else avatar.textContent = (player.username || "?").slice(0, 1).toUpperCase();
      if (loadProfile && renderAvatar) {
        loadProfile(player.userId).then(profile => {
          if (avatar.isConnected) renderAvatar(avatar, profile, player.username);
        });
      }
      card.append(
        avatar,
        element("span", "party-gartic-player-name", player.username),
        element("strong", "party-gartic-score", `${player.points} pts`)
      );
      const detail = player.userId === round.drawerUserId
        ? "Desenhista"
        : round.guessedUserIds.includes(player.userId) ? "Acertou!" : "Adivinhando";
      card.appendChild(element("small", "party-gartic-player-detail", detail));
      players.appendChild(card);
    }
    playersPanel.appendChild(players);
    layout.appendChild(playersPanel);

    const center = element("section", "party-gartic-center");
    const prompt = element("div", "party-gartic-prompt");
    const promptText = element("div", "party-gartic-prompt-copy");
    promptText.append(
      element("small", "", drawer ? "SUA VEZ DE DESENHAR" : `${round.drawerName} está desenhando`),
      element("strong", "party-gartic-word",
        result?.word || (drawer ? round.secretWord || round.wordMask : round.wordMask))
    );
    prompt.append(
      promptText,
      element("span", "party-gartic-word-hint",
        result ? "Palavra revelada" : `${round.wordLength} letras`)
    );
    center.appendChild(prompt);

    const canvasWrap = element("div", "party-gartic-canvas-wrap");
    const shapeHint = element("span", "party-gartic-shape-hint", "Arraste no quadro para escolher o tamanho");
    shapeHint.hidden = !drawer || !["square", "circle", "triangle", "line"].includes(selectedTool);
    const canvas = element("canvas", "party-gartic-canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.setAttribute("aria-label", "Área de desenho do Rabisco");
    canvas.setAttribute("role", "img");
    const context = canvas.getContext("2d");
    drawHistory(context, drawCache.operations);
    activeCanvas = canvas;
    canvasWrap.append(canvas, shapeHint);
    center.appendChild(canvasWrap);

    const toolbar = element("div", "party-gartic-toolbar");
    const palette = element("div", "party-gartic-colors");
    const enabled = drawer && !result;
    const colorPicker = element("input", "party-gartic-color-picker");
    colorPicker.type = "color";
    colorPicker.value = selectedColor;
    colorPicker.disabled = !enabled;
    colorPicker.setAttribute("aria-label", "Escolher uma cor personalizada");
    const selectedColorIndicator = element("span", "party-gartic-selected-color");
    const selectedColorSwatch = element("span", "party-gartic-selected-color-swatch");
    const selectedColorName = element("span", "party-gartic-selected-color-name");
    selectedColorIndicator.append(selectedColorSwatch, selectedColorName);
    const toolButtons = new Map();
    const tools = [
      { id: "pencil", label: "Lápis" },
      { id: "square", label: "Quadrado" },
      { id: "circle", label: "Redondo" },
      { id: "triangle", label: "Triângulo" },
      { id: "line", label: "Linha reta" },
      { id: "eraser", label: "Borracha" }
    ];
    const setTool = tool => {
      selectedTool = tool;
      const isShape = ["square", "circle", "triangle", "line"].includes(tool);
      shapeHint.hidden = !enabled || !isShape;
      if (isShape) {
        shapeHint.textContent = "Arraste no quadro para escolher largura e altura";
      }
      for (const [id, button] of toolButtons) {
        const selected = id === tool;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      }
    };
    const updateColorIndicator = () => {
      selectedColorSwatch.style.backgroundColor = selectedColor;
      selectedColorName.textContent = selectedColor.toUpperCase();
    };
    const setSelectedColor = color => {
      selectedColor = color.toLowerCase();
      colorPicker.value = selectedColor;
      for (const button of palette.querySelectorAll(".party-gartic-swatch")) {
        const selected = button.dataset.color === selectedColor;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
        button.querySelector(".party-gartic-swatch-check").hidden = !selected;
      }
      updateColorIndicator();
      if (selectedTool === "eraser") setTool("pencil");
    };
    for (const { id, label } of tools) {
      const button = element("button", "party-gartic-tool party-gartic-tool-shape");
      button.type = "button";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(selectedTool === id));
      button.disabled = !enabled;
      if (selectedTool === id) button.classList.add("is-selected");
      button.appendChild(createToolIcon(id));
      button.addEventListener("click", () => setTool(id));
      toolButtons.set(id, button);
    }
    const clear = element("button", "party-gartic-tool is-danger", "Limpar");
    clear.type = "button";
    const undo = element("button", "party-gartic-tool", "↶ Desfazer");
    undo.type = "button";
    undo.title = "Desfazer última ação (Ctrl+Z)";
    undo.setAttribute("aria-label", "Desfazer última ação (Ctrl+Z)");
    undo.disabled = !enabled || drawCache.operations.length === 0;
    for (const color of COLORS) {
      const swatch = element("button", "party-gartic-swatch");
      swatch.type = "button";
      swatch.dataset.color = color;
      swatch.style.backgroundColor = color;
      swatch.setAttribute("aria-label", `Cor ${color}`);
      swatch.setAttribute("aria-pressed", String(color === selectedColor));
      swatch.disabled = !enabled;
      if (color === selectedColor) swatch.classList.add("is-selected");
      const check = element("span", "party-gartic-swatch-check", "✓");
      check.setAttribute("aria-hidden", "true");
      check.hidden = color !== selectedColor;
      swatch.appendChild(check);
      swatch.addEventListener("click", () => {
        setSelectedColor(color);
      });
      palette.appendChild(swatch);
    }
    colorPicker.addEventListener("input", () => setSelectedColor(colorPicker.value));
    const sizeLabel = element("label", "party-gartic-size", "Tamanho");
    const sizeInput = element("input");
    sizeInput.type = "range";
    sizeInput.min = "2";
    sizeInput.max = "32";
    sizeInput.value = String(selectedSize);
    sizeInput.disabled = !enabled;
    sizeInput.addEventListener("input", () => { selectedSize = Number(sizeInput.value); });
    sizeLabel.appendChild(sizeInput);
    clear.disabled = !enabled;
    clear.addEventListener("click", () => {
      drawHistory(context, []);
      void Promise.resolve(onAction?.("clear", { roundNumber: round.roundNumber })).catch(onError);
    });
    updateColorIndicator();
    toolbar.append(palette, colorPicker, selectedColorIndicator);
    for (const { id } of tools) toolbar.appendChild(toolButtons.get(id));
    toolbar.append(undo, clear, sizeLabel);
    center.appendChild(toolbar);

    const chat = element("aside", "party-gartic-panel party-gartic-chat");
    chat.appendChild(element("h3", "party-gartic-side-title", "Palpites e conversa"));
    const chatLog = element("div", "party-gartic-chatlog");
    renderMessages(chatLog, messages);
    activeChatLog = chatLog;
    chat.appendChild(chatLog);
    const chatForm = element("form", "party-gartic-chatform");
    const guessInput = element("input");
    guessInput.type = "text";
    guessInput.maxLength = 100;
    guessInput.placeholder = drawer ? "Você está desenhando" : "Digite seu palpite";
    guessInput.autocomplete = "off";
    guessInput.disabled = drawer || alreadyGuessed || Boolean(result);
    const send = element("button", "party-gartic-send", alreadyGuessed ? "Acertou" : "Enviar");
    send.type = "submit";
    send.disabled = guessInput.disabled;
    chatForm.append(guessInput, send);
    chatForm.addEventListener("submit", event => {
      event.preventDefault();
      const guess = guessInput.value.trim();
      if (!guess) return;
      guessInput.value = "";
      void Promise.resolve(onAction?.("guess", {
        roundNumber: round.roundNumber,
        guess
      })).catch(onError);
    });
    chat.appendChild(chatForm);
    layout.append(center, chat);
    shell.appendChild(layout);

    const footer = element("div", "party-gartic-footer");
    footer.appendChild(element("span", "", result
      ? `${result.guessedUserIds.length} jogador(es) acertaram. Próxima rodada em 5 segundos…`
      : drawer ? "Desenhe a palavra sem escrevê-la." : "Acerte a palavra no chat para ganhar pontos."));
    shell.appendChild(footer);
    root.appendChild(shell);

    if (enabled) {
      let pointerDown = false;
      let points = [];
      const toPoint = event => {
        const bounds = canvas.getBoundingClientRect();
        return [
          Math.max(0, Math.min(CANVAS_WIDTH, Math.round((event.clientX - bounds.left) * CANVAS_WIDTH / bounds.width))),
          Math.max(0, Math.min(CANVAS_HEIGHT, Math.round((event.clientY - bounds.top) * CANVAS_HEIGHT / bounds.height)))
        ];
      };
      const paint = (from, to) => {
        context.beginPath();
        context.moveTo(from[0], from[1]);
        context.lineTo(to[0], to[1]);
        context.lineCap = "round";
        context.lineJoin = "round";
        context.lineWidth = selectedSize;
        context.strokeStyle = selectedTool === "eraser" ? "#fff" : selectedColor;
        context.stroke();
      };
      const sendStroke = strokePoints => {
        const shape = ["square", "circle", "triangle", "line"].includes(selectedTool)
          ? selectedTool
          : null;
        if (strokePoints.length < 2) return;
        void Promise.resolve(onAction?.("draw", {
          roundNumber: round.roundNumber,
          points: strokePoints,
          color: selectedTool === "eraser" ? "#ffffff" : selectedColor,
          size: selectedSize,
          eraser: selectedTool === "eraser",
          shape
        })).catch(onError);
      };
      const requestUndo = () => {
        if (!enabled || !drawCache.operations.length) return;
        void Promise.resolve(onAction?.("undo", { roundNumber: round.roundNumber }))
          .catch(onError);
      };
      undo.addEventListener("click", requestUndo);
      undoKeyHandler = event => {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" ||
            event.target instanceof HTMLElement &&
              (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))) {
          return;
        }
        event.preventDefault();
        requestUndo();
      };
      document.addEventListener("keydown", undoKeyHandler);
      const updateShapeHint = (start, end) => {
        const width = Math.abs(end[0] - start[0]);
        const height = Math.abs(end[1] - start[1]);
        if (selectedTool === "square") {
          shapeHint.textContent = `Quadrado · ${width} × ${height} px`;
        } else if (selectedTool === "circle") {
          const diameter = Math.max(width, height);
          shapeHint.textContent = `Círculo · ${diameter} × ${diameter}`;
        } else if (selectedTool === "triangle") {
          shapeHint.textContent = `Triângulo · ${width} × ${height}`;
        } else if (selectedTool === "line") {
          shapeHint.textContent = `Linha · ${Math.round(Math.hypot(width, height))} px`;
        }
      };
      canvas.addEventListener("pointerdown", event => {
        pointerDown = true;
        drawingInProgress = true;
        canvas.setPointerCapture(event.pointerId);
        points = [toPoint(event)];
        if (["square", "circle", "triangle", "line"].includes(selectedTool)) {
          shapeHint.hidden = false;
          updateShapeHint(points[0], points[0]);
        }
      });
      canvas.addEventListener("pointermove", event => {
        if (!pointerDown) return;
        const next = toPoint(event);
        if (["square", "circle", "triangle", "line"].includes(selectedTool)) {
          drawHistory(context, drawCache.operations);
          context.beginPath();
          context.lineWidth = selectedSize;
          context.strokeStyle = selectedColor;
          drawShape(context, selectedTool, [points[0], next]);
          updateShapeHint(points[0], next);
        } else {
          paint(points.at(-1), next);
        }
        points.push(next);
        if (selectedTool === "pencil" && points.length >= 32) {
          sendStroke(points);
          points = [next];
        }
      });
      const stopDrawing = event => {
        if (!pointerDown) return;
        pointerDown = false;
        drawingInProgress = false;
        if (["square", "circle", "triangle", "line"].includes(selectedTool)) {
          const pointerPoint = event ? toPoint(event) : points.at(-1);
          drawHistory(context, drawCache.operations);
          context.beginPath();
          context.lineWidth = selectedSize;
          context.strokeStyle = selectedColor;
          drawShape(context, selectedTool, [points[0], pointerPoint]);
          updateShapeHint(points[0], pointerPoint);
          sendStroke([points[0], pointerPoint]);
        } else {
          sendStroke(points);
        }
        points = [];
        if (pendingRender) {
          pendingRender = false;
          onInteractionEnd?.();
        }
      };
      canvas.addEventListener("pointerup", stopDrawing);
      canvas.addEventListener("pointercancel", stopDrawing);
    }

    const timer = status.querySelector(".party-gartic-timer");
    const updateDeadline = () => {
      if (result) {
        timer.textContent = "00:00";
        return;
      }
      const remaining = Math.max(0, Math.ceil(
        (new Date(round.deadlineAt).getTime() - Date.now()) / 1_000
      ));
      const minutes = String(Math.floor(remaining / 60)).padStart(2, "0");
      const seconds = String(remaining % 60).padStart(2, "0");
      timer.textContent = `${minutes}:${seconds}`;
      timer.classList.toggle("is-urgent", remaining <= 15);
    };
    updateDeadline();
    if (!result) deadlineInterval = setInterval(updateDeadline, 250);
  }

  function applyState(state, { roomId } = {}) {
    const round = state?.currentRound;
    if (!round) return;
    const key = cacheKey(roomId, round.roundNumber);
    const previousRevision = drawingCache.get(key)?.revision || 0;
    const cache = updateDrawingCache(key, round);
    updateMessageCache(key, { ...round, lastMessage: round.lastMessage || state.lastMessage });
    if (activeChatLog) renderMessages(activeChatLog, messageCache.get(key) || []);
    if (drawingInProgress) {
      pendingRender = true;
      return;
    }
    if (!activeCanvas || cache.revision === previousRevision) return;
    const context = activeCanvas.getContext("2d");
    if (Array.isArray(round.drawingOps)) {
      drawHistory(context, cache.operations);
    } else if (round.lastDrawingOp?.type === "undo") {
      drawHistory(context, cache.operations);
    } else if (round.lastDrawingOp) {
      drawOperation(context, round.lastDrawingOp);
    }
  }

  window.OrbyGarticUI = {
    render,
    applyState,
    isDrawing: () => drawingInProgress
  };
})();
