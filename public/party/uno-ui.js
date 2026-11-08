(() => {
  "use strict";

  const COLORS = ["red", "blue", "yellow", "green"];
  const COLOR_LABELS = {
    red: "Vermelho",
    blue: "Azul",
    yellow: "Amarelo",
    green: "Verde"
  };
  const SEATS = ["top", "left", "right", "top-left", "top-right", "bottom-left", "bottom-right"];
  const FACE = { skip: "⊘", reverse: "⇄", draw2: "+2", wild: "✦", draw4: "+4" };
  const cardFace = value => FACE[value] || value;
  const cursor2Image = new Image();
  const cursor2Ready = new Promise(resolve => {
    cursor2Image.onload = () => {
      const canvas = document.createElement("canvas");
      const maxCursorSize = 32;
      const scale = Math.min(maxCursorSize / cursor2Image.naturalWidth, maxCursorSize / cursor2Image.naturalHeight);
      canvas.width = Math.round(cursor2Image.naturalWidth * scale);
      canvas.height = Math.round(cursor2Image.naturalHeight * scale);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        resolve("");
        return;
      }
      context.drawImage(cursor2Image, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = imageData;
      const visited = new Uint8Array(width * height);
      const queue = new Int32Array(width * height);
      let head = 0;
      let tail = 0;
      const isBackground = index => {
        const offset = index * 4;
        const red = data[offset];
        const green = data[offset + 1];
        const blue = data[offset + 2];
        return Math.max(red, green, blue) - Math.min(red, green, blue) < 36 &&
          (red + green + blue) / 3 > 145;
      };
      const addBackground = index => {
        if (visited[index] || !isBackground(index)) return;
        visited[index] = 1;
        queue[tail++] = index;
      };
      for (let x = 0; x < width; x += 1) {
        addBackground(x);
        addBackground((height - 1) * width + x);
      }
      for (let y = 0; y < height; y += 1) {
        addBackground(y * width);
        addBackground(y * width + width - 1);
      }
      while (head < tail) {
        const index = queue[head++];
        data[index * 4 + 3] = 0;
        const x = index % width;
        const y = Math.floor(index / width);
        if (x > 0) addBackground(index - 1);
        if (x + 1 < width) addBackground(index + 1);
        if (y > 0) addBackground(index - width);
        if (y + 1 < height) addBackground(index + width);
      }
      context.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    cursor2Image.onerror = () => resolve("");
    cursor2Image.src = "/party/cursor2.jpg";
  });

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function canPlay(card, state) {
    if (state.pendingDraw > 0) return card.value === "draw2" || card.value === "draw4";
    return card.color === "wild" || card.color === state.activeColor || card.value === state.topCard?.value;
  }

  function makeCard(card, { disabled, playable, onPlay, onDragDrop }) {
    const button = element("button", `party-uno-card party-uno-card--${card.color}`);
    button.type = "button";
    button.dataset.cardId = String(card.id);
    button.setAttribute("aria-label", `${cardFace(card.value)} ${COLOR_LABELS[card.color] || ""}`);
    button.title = `${cardFace(card.value)} ${COLOR_LABELS[card.color] || ""}`;
    button.disabled = disabled;
    button.classList.toggle("is-playable", playable);
    const face = element("span", "party-uno-card-face", cardFace(card.value));
    const corner = element("span", "party-uno-card-corner", cardFace(card.value));
    button.append(corner, face);
    let suppressClick = false;
    button.addEventListener("click", event => {
      if (suppressClick) {
        event.preventDefault();
        suppressClick = false;
        return;
      }
      onPlay();
    });
    if (playable && !disabled && onDragDrop) {
      button.addEventListener("pointerdown", event => {
        if (event.button !== 0 || event.isPrimary === false) return;
        const originX = event.clientX;
        const originY = event.clientY;
        let preview = null;
        let dragging = false;
        let dropTarget = null;
        const app = button.closest(".orby-party-app");
        const originalCursor = app?.style.getPropertyValue("--party-cursor") || "";
        const cleanup = keepPreview => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onCancel);
          if (!keepPreview) preview?.remove();
          dropTarget?.classList.remove("is-drop-target");
          button.classList.remove("is-dragging");
          app?.classList.remove("party-uno-card-dragging");
          if (app) {
            if (originalCursor) app.style.setProperty("--party-cursor", originalCursor);
            else app.style.removeProperty("--party-cursor");
          }
        };
        const onMove = moveEvent => {
          if (moveEvent.pointerId !== event.pointerId) return;
          if (!dragging && Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) < 7) return;
          if (!dragging) {
            dragging = true;
            suppressClick = true;
            preview = button.cloneNode(true);
            preview.disabled = false;
            preview.classList.remove("is-playable");
            preview.classList.add("party-uno-drag-preview");
            preview.style.width = `${button.getBoundingClientRect().width}px`;
            preview.style.height = `${button.getBoundingClientRect().height}px`;
            document.body.appendChild(preview);
            button.classList.add("is-dragging");
            app?.classList.add("party-uno-card-dragging");
            app?.style.setProperty("--party-cursor", 'url("/party/cursor2.jpg") 4 2, grabbing');
            void cursor2Ready.then(cursor => {
              if (cursor && app?.classList.contains("party-uno-card-dragging")) {
                app.style.setProperty("--party-cursor", `url("${cursor}") 4 2`);
              }
            });
          }
          preview.style.left = `${moveEvent.clientX - preview.offsetWidth / 2}px`;
          preview.style.top = `${moveEvent.clientY - preview.offsetHeight / 2}px`;
          const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY)
            ?.closest(".party-uno-table");
          if (target !== dropTarget) {
            dropTarget?.classList.remove("is-drop-target");
            dropTarget = target;
            dropTarget?.classList.add("is-drop-target");
          }
        };
        const onUp = async upEvent => {
          if (upEvent.pointerId !== event.pointerId) return;
          const target = dragging
            ? document.elementFromPoint(upEvent.clientX, upEvent.clientY)?.closest(".party-uno-table")
            : null;
          cleanup(Boolean(target && preview));
          if (!dragging) return;
          upEvent.preventDefault();
          if (!target || !preview?.isConnected) {
            preview?.remove();
            setTimeout(() => { suppressClick = false; }, 0);
            return;
          }
          const targetRect = target.getBoundingClientRect();
          const previewRect = preview.getBoundingClientRect();
          try {
            await preview.animate([
              { transform: "rotate(-5deg) scale(1.05)", opacity: 1 },
              {
                left: `${targetRect.left + targetRect.width / 2 - previewRect.width / 2}px`,
                top: `${targetRect.top + targetRect.height / 2 - previewRect.height / 2}px`,
                transform: "rotate(8deg) scale(.45)",
                opacity: .25
              }
            ], { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }).finished;
          } catch {}
          preview.remove();
          onDragDrop();
          setTimeout(() => { suppressClick = false; }, 0);
        };
        const onCancel = cancelEvent => {
          if (cancelEvent.pointerId === event.pointerId) cleanup(false);
        };
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onCancel);
      });
    }
    return button;
  }

  function render(root, state, { onAction, onError, userId, username, loadProfile, renderAvatar } = {}) {
    root.replaceChildren();
    root.className = "party-game-controls party-uno-controls";
    root.hidden = false;
    if (!state || state.mode !== "uno" || !Array.isArray(state.players)) {
      root.appendChild(element("p", "party-uno-loading", "Sincronizando a mesa do UNO…"));
      return;
    }

    const self = state.players.findIndex(player => player.userId === userId);
    const hand = state.hand || [];
    const isMyTurn = self >= 0 && state.currentPlayerIndex === self && !state.gameOver;
    const locked = { value: false };
    const shell = element("section", "party-uno-shell");
    const topbar = element("header", "party-uno-topbar");
    const brand = element("div", "party-uno-brand");
    brand.append(element("span", "party-uno-logo", "UNO!"));
    const brandText = element("div");
    brandText.append(element("strong", "", "UNO Party"));
    brandText.append(element("small", "", `${state.players.length} jogadores · até 8`));
    brand.appendChild(brandText);
    topbar.appendChild(brand);
    shell.appendChild(topbar);

    const table = element("section", "party-uno-table");
    table.setAttribute("aria-label", "Mesa de UNO");
    const grid = element("div", "party-uno-table-grid");
    const opponents = state.players.map((player, index) => ({ player, index }))
      .filter(({ index }) => index !== self);
    opponents.forEach(({ player, index }, seatIndex) => {
      const seat = element("div", `party-uno-player party-uno-player--${SEATS[seatIndex]}`);
      seat.classList.toggle("is-active", index === state.currentPlayerIndex);
      const avatar = makeAvatar(player, loadProfile, renderAvatar);
      const info = element("span", "party-uno-player-info");
      info.append(element("strong", "", player.username));
      info.append(element("small", "", index === state.currentPlayerIndex
        ? "Jogando agora"
        : player.cardCount === 1 ? player.saidUno ? "UNO!" : "⚠️ Só uma carta!" : "Na espera"));
      const count = element("b", "party-uno-card-count", `${player.cardCount} 🃏`);
      seat.append(avatar, info, count);
      const backs = element("div", "party-uno-opponent-cards");
      const backCount = Math.min(player.cardCount, 6);
      for (let cardIndex = 0; cardIndex < backCount; cardIndex += 1) {
        backs.appendChild(element("span", "party-uno-card-back"));
      }
      if (player.cardCount > backCount) backs.appendChild(element("small", "", `+${player.cardCount - backCount}`));
      seat.appendChild(backs);
      grid.appendChild(seat);
    });

    const center = element("div", "party-uno-center");
    center.appendChild(element("div", "party-uno-turn", state.gameOver
      ? "Fim de jogo"
      : isMyTurn ? "Sua vez de jogar!" : `Vez de ${state.players[state.currentPlayerIndex]?.username || "jogador"}`));
    const piles = element("div", "party-uno-piles");
    const deck = element("button", "party-uno-deck", "UNO");
    deck.type = "button";
    deck.disabled = !isMyTurn || locked.value || state.gameOver;
    deck.setAttribute("aria-label", "Comprar carta");
    deck.addEventListener("click", () => void dispatch("draw", {}));
    const topPile = element("div", "party-uno-top-pile");
    if (state.topCard) topPile.appendChild(makeCard(state.topCard, { disabled: true, playable: false }));
    piles.append(deck, topPile);
    center.appendChild(piles);
    center.appendChild(element("div", "party-uno-direction", state.direction === 1 ? "↻ Sentido horário" : "↺ Sentido anti-horário"));
    const colorRow = element("div", "party-uno-active-color");
    colorRow.append(element("span", "", "COR ATIVA"));
    colorRow.appendChild(element("i", `party-uno-color-dot party-uno-color-dot--${state.activeColor}`));
    const currentPlayer = state.players[state.currentPlayerIndex];
    const turnMessage = state.gameOver
      ? state.message || "Partida finalizada."
      : state.pendingDraw > 0
      ? `${currentPlayer?.username || "Jogador"}, compre ${state.pendingDraw} cartas ou jogue +2/+4.`
      : isMyTurn
          ? "Sua vez: jogue uma carta ou compre."
          : `Vez de ${currentPlayer?.username || "jogador"}.`;
    center.append(colorRow, element("p", "party-uno-message", turnMessage));
    grid.appendChild(center);

    const ownSeat = element("div", "party-uno-player party-uno-player--bottom is-self");
    ownSeat.classList.toggle("is-active", isMyTurn);
    ownSeat.append(makeAvatar({ userId, username: username || "Você" }, loadProfile, renderAvatar));
    ownSeat.append(element("span", "party-uno-player-info", username || "Você"));
    ownSeat.appendChild(element("b", "party-uno-card-count", `${hand.length} 🃏`));
    grid.appendChild(ownSeat);
    table.appendChild(grid);
    shell.appendChild(table);

    const handPanel = element("section", "party-uno-hand-panel");
    const handHeader = element("div", "party-uno-hand-header");
    const handHeading = element("div");
    handHeading.append(element("strong", "", "Sua mão"));
    handHeading.append(element("small", "", `Você tem ${hand.length} ${hand.length === 1 ? "carta" : "cartas"}`));
    const actions = element("div", "party-uno-actions");
    const announce = element("button", "party-uno-button party-uno-button--uno", "UNO!");
    announce.type = "button";
    announce.disabled = !isMyTurn || locked.value || state.saidUno || hand.length < 1 || hand.length > 2;
    announce.addEventListener("click", () => void dispatch("announce-uno", {}));
    actions.appendChild(announce);
    if (isMyTurn && state.unoPenaltyUserId && state.unoPenaltyUserId !== userId) {
      const catchButton = element("button", "party-uno-button party-uno-button--uno", "Pegar UNO!");
      catchButton.type = "button";
      catchButton.addEventListener("click", () => void dispatch("catch-uno", {}));
      actions.appendChild(catchButton);
    }
    handHeader.append(handHeading, actions);
    const cards = element("div", "party-uno-hand");
    hand.forEach((card, cardIndex) => {
      const playable = canPlay(card, state);
      const button = makeCard(card, {
        playable: isMyTurn && playable,
        disabled: !isMyTurn || !playable || locked.value || state.gameOver,
        onDragDrop: () => playCard(card),
        onPlay: () => {
          playCard(card);
        }
      });
      button.style.setProperty("--card-order", cardIndex);
      cards.appendChild(button);
    });
    const tip = state.pendingDraw > 0
      ? "Você pode acumular +2/+4 ou comprar as cartas."
      : isMyTurn ? "Arraste uma carta válida até a mesa ou compre para encerrar sua vez."
        : `Aguarde a vez de ${currentPlayer?.username || "jogador"}.`;
    handPanel.append(handHeader, cards, element("p", "party-uno-tip", tip));
    shell.appendChild(handPanel);
    root.appendChild(shell);

    async function dispatch(action, payload) {
      if (locked.value) return;
      locked.value = true;
      root.setAttribute("aria-busy", "true");
      try {
        await onAction(action, payload);
      } catch (error) {
        locked.value = false;
        root.removeAttribute("aria-busy");
        onError?.(error);
      }
    }

    function playCard(card) {
      if (card.color === "wild") {
        showColorPicker(shell, color => void dispatch("play", { cardId: card.id, color }));
        return;
      }
      void dispatch("play", { cardId: card.id });
    }
  }

  function makeAvatar(player, loadProfile, renderAvatar) {
    const avatar = element("span", "party-uno-avatar", (player.username || "?").slice(0, 1).toUpperCase());
    if (typeof loadProfile === "function" && typeof renderAvatar === "function") {
      void loadProfile(player.userId).then(profile => {
        if (avatar.isConnected) renderAvatar(avatar, profile, player.username);
      });
    }
    return avatar;
  }

  function showColorPicker(shell, onChoose) {
    shell.querySelector(".party-uno-color-picker")?.remove();
    const picker = element("div", "party-uno-color-picker");
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-label", "Escolha a próxima cor");
    picker.appendChild(element("strong", "", "Escolha a próxima cor"));
    for (const color of COLORS) {
      const button = element("button", `party-uno-color-choice party-uno-color-choice--${color}`, COLOR_LABELS[color]);
      button.type = "button";
      button.addEventListener("click", () => {
        picker.remove();
        onChoose(color);
      });
      picker.appendChild(button);
    }
    shell.appendChild(picker);
  }

  window.OrbyUnoUI = Object.freeze({ render });
})();
