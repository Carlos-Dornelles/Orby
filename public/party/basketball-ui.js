(() => {
  "use strict";

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const GRAVITY = 2.2;
  const SHOT_HORIZONTAL_SCALE = 4.5;
  const SHOT_VERTICAL_BASE_SPEED = 0.9;
  const SHOT_VERTICAL_PULL_SCALE = 2.7;
  const MAX_VERTICAL_PULL = 0.28;
  const START_Y = 0.79;
  const HOOP_X = 0.5;
  const HOOP_Y = 0.35;
  const LANDING_Y = 0.92;
  const AIM_PREVIEW_SECONDS = 0.32;
  const BALL_RETURN_SECONDS = 0.28;
  const SHOT_EDGE_PADDING = 0.04;
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  let game = null;

  function shotParameters(startX, pullXPixels, pullYPixels, width, height) {
    const aspectRatio = width / height;
    const pullY = clamp(pullYPixels / height, 0, MAX_VERTICAL_PULL);
    const initialVerticalSpeed = SHOT_VERTICAL_BASE_SPEED + pullY * SHOT_VERTICAL_PULL_SCALE;
    const landingTime = (
      initialVerticalSpeed +
      Math.sqrt(initialVerticalSpeed ** 2 + 2 * GRAVITY * (LANDING_Y - START_Y))
    ) / GRAVITY;
    const maxPullLeft = Math.max(0, (startX - SHOT_EDGE_PADDING) * aspectRatio /
      (SHOT_HORIZONTAL_SCALE * landingTime));
    const maxPullRight = Math.max(0, (1 - SHOT_EDGE_PADDING - startX) * aspectRatio /
      (SHOT_HORIZONTAL_SCALE * landingTime));
    const pullX = clamp(pullXPixels / height, -maxPullRight, maxPullLeft);
    const discriminant = initialVerticalSpeed ** 2 -
      2 * GRAVITY * (START_Y - HOOP_Y);

    return {
      aspectRatio,
      pullX,
      pullY,
      initialVerticalSpeed,
      landingTime,
      scoreTime: discriminant >= 0
        ? (initialVerticalSpeed + Math.sqrt(discriminant)) / GRAVITY
        : landingTime
    };
  }

  function resolveShot(instance, result) {
    const shot = instance.shot;
    if (!shot?.actionSent || !result ||
        String(result.userId) !== String(instance.options.userId)) return;
    shot.result = Boolean(result.scored);
  }

  function destroy() {
    if (!game) return;
    cancelAnimationFrame(game.frame);
    clearInterval(game.presenceTimer);
    clearInterval(game.countdownTimer);
    window.removeEventListener("resize", game.resize);
    if (game.presenceJoined) game.options.onPresenceLeave?.();
    game = null;
  }

  function colorFor(id) {
    let hash = 0;
    for (const character of String(id)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return `hsl(${hash % 360} 68% 48%)`;
  }

  function render(root, state, options = {}) {
    if (game?.root === root && state?.mode === "basketball") {
      game.state = state;
      game.options = options;
      updateHud(game);
      if (state.lastShot?.sequence > game.lastShotSequence) {
        game.lastShotSequence = state.lastShot.sequence;
        resolveShot(game, state.lastShot);
        game.message.textContent = state.lastShot.scored
          ? `CESTAAA! ${state.lastShot.username} acertou!`
          : `${state.lastShot.username} errou. Tente ajustar força e direção!`;
      }
      return;
    }
    destroy();
    root.replaceChildren();
    root.className = "party-game-controls party-basketball-controls";
    root.hidden = false;
    if (!state || state.mode !== "basketball" || !Array.isArray(state.players)) {
      root.appendChild(node("p", "party-basketball-loading", "Preparando a quadra…"));
      return;
    }

    const shell = node("section", "party-basketball-shell");
    const header = node("header", "party-basketball-header");
    const title = node("div", "party-basketball-title");
    title.append(node("span", "party-basketball-logo", "🏀"));
    const titleCopy = node("div");
    titleCopy.append(node("strong", "", "Cesta Certa"), node("small", "", "DESAFIO DE ARREMESSOS"));
    title.appendChild(titleCopy);
    const status = node("div", "party-basketball-status");
    const remaining = node("strong", "party-basketball-time", "--:--");
    status.append(node("span", "", "TEMPO"), remaining);
    header.append(title, status);

    const canvasWrap = node("div", "party-basketball-court");
    const canvas = node("canvas", "party-basketball-canvas");
    canvas.tabIndex = 0;
    canvas.setAttribute("aria-label", "Quadra. Arraste a bola para trás e solte para arremessar.");
    canvasWrap.appendChild(canvas);
    const message = node("p", "party-basketball-message", "Puxe a bola para trás e solte. Ajuste a força e a direção do arremesso.");
    const board = node("section", "party-basketball-board");
    board.setAttribute("aria-label", "Placar da partida");
    shell.append(header, canvasWrap, message, board);
    root.appendChild(shell);

    const context = canvas.getContext("2d");
    const instance = game = {
      root, state, options, shell, canvas, context, remaining, board, message,
      width: 800, height: 450, dpr: 1, playerX: 0.5, direction: 1, drag: null, shot: null,
      remotes: new Map(), frame: 0, lastFrameAt: 0, lastPresenceAt: 0, presenceJoined: false,
      particles: [], resize: null, lastShotSequence: state.lastShot?.sequence || 0
    };
    const playerIndex = Math.max(0, state.players.findIndex(player =>
      String(player.userId) === String(options.userId)
    ));
    instance.playerX = state.players.length > 1
      ? 0.16 + playerIndex * 0.68 / (state.players.length - 1)
      : 0.5;
    instance.direction = playerIndex % 2 === 0 ? 1 : -1;

    const ballOrigin = () => ({ x: instance.playerX * instance.width, y: instance.height * 0.79 });
    const point = event => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const launch = (pullX, pullY, startX) => {
      if (instance.shot || Date.now() >= new Date(instance.state.endsAt).getTime()) return;
      const startXFraction = startX / instance.width;
      const trajectory = shotParameters(
        startXFraction, pullX, pullY, instance.width, instance.height
      );
      instance.shot = {
        t: 0,
        duration: trajectory.landingTime,
        actionTime: trajectory.scoreTime,
        actionSent: false,
        result: null,
        startX: startXFraction,
        pullX: trajectory.pullX,
        pullY: trajectory.pullY,
        aspectRatio: trajectory.aspectRatio,
        initialVerticalSpeed: trajectory.initialVerticalSpeed,
        horizontalSpeed: -trajectory.pullX * SHOT_HORIZONTAL_SCALE,
        x: startXFraction,
        y: START_Y,
        returnElapsed: null,
        landingX: null
      };
      instance.message.textContent = "Arremesso em andamento…";
    };
    const originFromPointer = event => {
      if (Date.now() >= new Date(instance.state.endsAt).getTime() || instance.shot) return;
      const cursor = point(event);
      const origin = ballOrigin();
      if (Math.hypot(cursor.x - origin.x, cursor.y - origin.y) > Math.min(instance.width, instance.height) * 0.15) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      instance.drag = { startX: origin.x, startY: origin.y, x: origin.x, y: origin.y };
    };
    canvas.addEventListener("pointerdown", originFromPointer);
    canvas.addEventListener("pointermove", event => {
      if (!instance.drag) return;
      event.preventDefault();
      const cursor = point(event);
      const maxPull = Math.min(instance.width, instance.height) * 0.34;
      let dx = clamp(cursor.x - instance.drag.startX, -maxPull, maxPull);
      const dy = clamp(cursor.y - instance.drag.startY, 0, maxPull);
      const pullLength = Math.hypot(dx, dy);
      if (pullLength > maxPull) {
        dx *= maxPull / pullLength;
        instance.drag.y = instance.drag.startY + dy * maxPull / pullLength;
      } else {
        instance.drag.y = instance.drag.startY + dy;
      }
      instance.drag.x = instance.drag.startX + dx;
    });
    const release = () => {
      if (!instance.drag) return;
      const drag = instance.drag;
      instance.drag = null;
      const pullX = drag.x - drag.startX;
      const pullY = drag.y - drag.startY;
      const pullLength = Math.hypot(pullX, pullY);
      if (pullLength < instance.height * 0.045) {
        instance.message.textContent = "Puxe a bola um pouco mais antes de soltar.";
        return;
      }
      launch(pullX, pullY, drag.startX);
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    instance.resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      instance.width = rect.width;
      instance.height = rect.height;
      instance.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * instance.dpr);
      canvas.height = Math.round(rect.height * instance.dpr);
      context.setTransform(instance.dpr, 0, 0, instance.dpr, 0, 0);
    };
    window.addEventListener("resize", instance.resize);
    instance.resize();

    const drawPlayer = (x, y, color, name, scale = 1) => {
      const size = Math.min(instance.width, instance.height) * 0.11 * scale;
      context.save();
      context.globalAlpha = 0.2;
      context.fillStyle = "#24364d";
      context.beginPath();
      context.ellipse(x, y + size * 0.04, size * 0.48, size * 0.12, 0, 0, Math.PI * 2);
      context.fill();
      context.restore();
      context.fillStyle = "#efc39c";
      context.beginPath();
      context.arc(x, y - size * 0.72, size * 0.24, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#49352f";
      context.beginPath();
      context.arc(x, y - size * 0.8, size * 0.25, Math.PI, Math.PI * 2);
      context.lineTo(x + size * 0.25, y - size * 0.69);
      context.quadraticCurveTo(x, y - size * 0.85, x - size * 0.25, y - size * 0.69);
      context.closePath();
      context.fill();
      const jersey = context.createLinearGradient(x - size * 0.4, y - size * 0.55, x + size * 0.4, y);
      jersey.addColorStop(0, color);
      jersey.addColorStop(1, "#193651");
      context.fillStyle = jersey;
      context.beginPath();
      context.roundRect(x - size * 0.36, y - size * 0.54, size * 0.72, size * 0.48, size * 0.12);
      context.fill();
      context.strokeStyle = "#26384d";
      context.font = `800 ${Math.max(10, 12 * scale)}px system-ui`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineWidth = 3;
      context.strokeStyle = "rgba(255,255,255,.88)";
      context.strokeText(name, x, y + size * 0.25);
      context.fillStyle = "#24364d";
      context.fillText(name, x, y + size * 0.25);
    };
    const drawBall = (x, y, radius) => {
      context.save();
      context.shadowColor = "rgba(67,35,16,.4)";
      context.shadowBlur = radius * 0.45;
      context.shadowOffsetY = radius * 0.18;
      const ballGradient = context.createRadialGradient(
        x - radius * 0.38, y - radius * 0.42, radius * 0.08,
        x, y, radius
      );
      ballGradient.addColorStop(0, "#ffd783");
      ballGradient.addColorStop(0.55, "#f79338");
      ballGradient.addColorStop(1, "#bd4f16");
      context.fillStyle = ballGradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.shadowColor = "transparent";
      context.strokeStyle = "#713817";
      context.lineWidth = Math.max(1.5, radius * 0.075);
      context.beginPath();
      context.arc(x, y, radius * 0.96, -Math.PI / 2, Math.PI / 2);
      context.moveTo(x - radius * 0.94, y);
      context.quadraticCurveTo(x, y - radius * 0.28, x + radius * 0.94, y);
      context.moveTo(x - radius * 0.66, y - radius * 0.72);
      context.quadraticCurveTo(x - radius * 0.08, y, x - radius * 0.66, y + radius * 0.72);
      context.stroke();
      context.fillStyle = "rgba(255,255,255,.48)";
      context.beginPath();
      context.ellipse(x - radius * 0.32, y - radius * 0.48, radius * 0.15, radius * 0.07, -0.5, 0, Math.PI * 2);
      context.fill();
      context.restore();
    };
    const drawCourt = () => {
      const { width, height } = instance;
      const sky = context.createLinearGradient(0, 0, 0, height * 0.58);
      sky.addColorStop(0, "#65c9f4");
      sky.addColorStop(0.65, "#b9edff");
      sky.addColorStop(1, "#effcff");
      context.fillStyle = sky;
      context.fillRect(0, 0, width, height);
      const sun = context.createRadialGradient(width * 0.18, height * 0.15, 2, width * 0.18, height * 0.15, height * 0.28);
      sun.addColorStop(0, "rgba(255,255,255,.56)");
      sun.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = sun;
      context.fillRect(0, 0, width * 0.55, height * 0.55);

      for (const cloud of [
        [0.2, 0.2, 0.052], [0.78, 0.15, 0.064], [0.91, 0.34, 0.036]
      ]) {
        const [cx, cy, radius] = cloud;
        const cloudX = width * cx;
        const cloudY = height * cy;
        const cloudRadius = Math.min(width, height) * radius;
        context.fillStyle = "rgba(255,255,255,.48)";
        context.beginPath();
        context.ellipse(cloudX, cloudY, cloudRadius * 1.65, cloudRadius * 0.42, 0, 0, Math.PI * 2);
        context.ellipse(cloudX - cloudRadius * 0.55, cloudY, cloudRadius * 0.62, cloudRadius * 0.58, 0, 0, Math.PI * 2);
        context.ellipse(cloudX + cloudRadius * 0.17, cloudY - cloudRadius * 0.2, cloudRadius * 0.76, cloudRadius * 0.72, 0, 0, Math.PI * 2);
        context.ellipse(cloudX + cloudRadius * 0.8, cloudY, cloudRadius * 0.53, cloudRadius * 0.48, 0, 0, Math.PI * 2);
        context.fill();
      }

      const wallY = height * 0.43;
      const wallGradient = context.createLinearGradient(0, wallY, 0, height * 0.57);
      wallGradient.addColorStop(0, "#5196bd");
      wallGradient.addColorStop(1, "#39749f");
      context.fillStyle = wallGradient;
      context.fillRect(0, wallY, width, height * 0.14);
      for (let row = 0; row < 2; row += 1) {
        for (let index = 0; index < 16; index += 1) {
          const seatWidth = width / 16;
          context.fillStyle = ["#f26e68", "#ffd16b", "#f7f4e8", "#63d0bd"][index % 4];
          context.globalAlpha = row === 0 ? 0.8 : 0.48;
          context.beginPath();
          context.roundRect(index * seatWidth + 3, wallY + row * height * 0.045 + 6, seatWidth * 0.58, height * 0.025, 5);
          context.fill();
        }
      }
      context.globalAlpha = 1;
      const wood = context.createLinearGradient(0, height * 0.55, 0, height);
      wood.addColorStop(0, "#efb96e");
      wood.addColorStop(0.45, "#d99349");
      wood.addColorStop(1, "#b96e35");
      context.fillStyle = wood;
      context.fillRect(0, height * 0.55, width, height * 0.45);
      for (let index = 0; index < 13; index += 1) {
        context.fillStyle = index % 2 ? "rgba(255,222,158,.14)" : "rgba(105,54,28,.08)";
        context.beginPath();
        context.moveTo(index * width / 13, height * 0.55);
        context.lineTo((index + 1) * width / 13, height * 0.55);
        context.lineTo(width / 2 + (index - 6) * width * 0.105, height);
        context.lineTo(width / 2 + (index - 5) * width * 0.105, height);
        context.closePath();
        context.fill();
      }
      context.strokeStyle = "rgba(255,244,215,.88)";
      context.lineWidth = Math.max(2, height * 0.006);
      for (let index = 0; index <= 12; index += 1) {
        context.beginPath();
        context.moveTo(index * width / 12, height * 0.55);
        context.lineTo(width / 2 + (index - 6) * width * 0.105, height);
        context.stroke();
      }
      context.beginPath();
      context.ellipse(width * 0.5, height * 0.94, width * 0.19, height * 0.17, 0, Math.PI, Math.PI * 2);
      context.stroke();
      context.beginPath();
      context.moveTo(0, height * 0.56);
      context.lineTo(width, height * 0.56);
      context.stroke();

      const hoopX = width * HOOP_X;
      const hoopY = height * HOOP_Y;
      const backboardWidth = width * 0.11;
      const backboardHeight = height * 0.16;
      const backboardX = hoopX - backboardWidth / 2;
      const backboardY = hoopY - height * 0.135;
      const supportX = backboardX + backboardWidth + width * 0.018;
      context.save();
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "rgba(32,54,73,.24)";
      context.lineWidth = Math.max(10, height * 0.028);
      context.beginPath();
      context.moveTo(supportX, hoopY - height * 0.14);
      context.lineTo(supportX, height * 0.67);
      context.stroke();
      context.strokeStyle = "#52677b";
      context.lineWidth = Math.max(8, height * 0.022);
      context.beginPath();
      context.moveTo(supportX, hoopY + height * 0.14);
      context.lineTo(supportX, height * 0.68);
      context.stroke();

      context.fillStyle = "rgba(35,63,82,.2)";
      context.beginPath();
      context.roundRect(backboardX + 5, backboardY + 6, backboardWidth, backboardHeight, 7);
      context.fill();
      const glass = context.createLinearGradient(backboardX, backboardY, backboardX + backboardWidth, backboardY + backboardHeight);
      glass.addColorStop(0, "rgba(255,255,255,.95)");
      glass.addColorStop(1, "rgba(196,239,255,.77)");
      context.fillStyle = glass;
      context.strokeStyle = "#fff";
      context.lineWidth = Math.max(3, height * 0.01);
      context.beginPath();
      context.roundRect(backboardX, backboardY, backboardWidth, backboardHeight, 7);
      context.fill();
      context.stroke();
      context.strokeStyle = "#ed7950";
      context.lineWidth = Math.max(2, height * 0.006);
      context.beginPath();
      const targetWidth = width * 0.055;
      const targetHeight = height * 0.052;
      context.rect(hoopX - targetWidth / 2, hoopY - targetHeight / 2, targetWidth, targetHeight);
      context.stroke();
      context.strokeStyle = "#c84932";
      context.lineWidth = Math.max(5, height * 0.014);
      context.beginPath();
      context.moveTo(hoopX - width * 0.044, hoopY - height * 0.012);
      context.quadraticCurveTo(hoopX, hoopY + height * 0.013, hoopX + width * 0.044, hoopY - height * 0.012);
      context.stroke();
      context.strokeStyle = "rgba(255,255,255,.92)";
      context.lineWidth = Math.max(1.5, height * 0.004);
      context.beginPath();
      context.moveTo(hoopX - width * 0.04, hoopY + height * 0.004);
      context.lineTo(hoopX - width * 0.025, hoopY + height * 0.106);
      context.lineTo(hoopX + width * 0.025, hoopY + height * 0.106);
      context.lineTo(hoopX + width * 0.04, hoopY + height * 0.004);
      context.moveTo(hoopX - width * 0.032, hoopY + height * 0.056);
      context.lineTo(hoopX + width * 0.032, hoopY + height * 0.056);
      context.stroke();
      context.restore();
    };
    const draw = timestamp => {
      if (game !== instance) return;
      const delta = Math.min(0.05, instance.lastFrameAt ? (timestamp - instance.lastFrameAt) / 1000 : 0);
      instance.lastFrameAt = timestamp;
      if (!instance.drag && !instance.shot && Date.now() < new Date(instance.state.endsAt).getTime()) {
        instance.playerX += instance.direction * delta * 0.18;
        if (instance.playerX > 0.88 || instance.playerX < 0.12) {
          instance.playerX = clamp(instance.playerX, 0.12, 0.88);
          instance.direction *= -1;
        }
      }
      drawCourt();
      const playerY = instance.height * 0.88;
      const playerPx = instance.playerX * instance.width;
      const ownOrigin = ballOrigin();

      if (instance.drag) {
        const startX = instance.drag.startX / instance.width;
        const trajectory = shotParameters(
          startX,
          instance.drag.x - instance.drag.startX,
          instance.drag.y - instance.drag.startY,
          instance.width,
          instance.height
        );
        const { pullX, initialVerticalSpeed: verticalSpeed } = trajectory;
        context.save();
        context.setLineDash([7, 7]);
        context.lineWidth = Math.max(2, instance.height * 0.006);
        context.strokeStyle = "rgba(255,255,255,.58)";
        const duration = AIM_PREVIEW_SECONDS;
        const startY = START_Y * instance.height;
        const startXPixels = startX * instance.width;
        const controlX = (startX - pullX * SHOT_HORIZONTAL_SCALE * duration /
          (instance.width / instance.height) / 2) * instance.width;
        const controlY = (START_Y - verticalSpeed * duration / 2) * instance.height;
        const endX = (startX - pullX * SHOT_HORIZONTAL_SCALE * duration /
          (instance.width / instance.height)) * instance.width;
        const endY = (START_Y - verticalSpeed * duration +
          0.5 * GRAVITY * duration ** 2) * instance.height;
        context.beginPath();
        context.moveTo(startXPixels, startY);
        context.quadraticCurveTo(controlX, controlY, endX, endY);
        context.stroke();
        context.restore();
      }

      for (const remote of instance.remotes.values()) {
        const remoteX = remote.x * instance.width;
        drawPlayer(remoteX, playerY, colorFor(remote.userId), remote.username || "Jogador", 0.78);
        if (remote.ball) drawBall(remote.ball.x * instance.width, remote.ball.y * instance.height, Math.min(instance.width, instance.height) * 0.028);
      }
      drawPlayer(playerPx, playerY, "#287eb8", instance.options.username || "Você");

      if (instance.drag) {
        const drag = instance.drag;
        context.strokeStyle = "#ffffffbb";
        context.lineWidth = 3;
        context.setLineDash([6, 6]);
        context.beginPath();
        context.moveTo(drag.startX, drag.startY);
        context.lineTo(drag.x, drag.y);
        context.stroke();
        context.setLineDash([]);
        drawBall(drag.x, drag.y, Math.min(instance.width, instance.height) * 0.047);
      } else if (instance.shot) {
        const shot = instance.shot;
        let xFraction;
        let yFraction;
        if (shot.returnElapsed === null && shot.actionSent && shot.result === null) {
          const crossingTime = Math.min(shot.actionTime, shot.duration);
          xFraction = shot.startX + shot.horizontalSpeed * crossingTime / shot.aspectRatio;
          yFraction = START_Y - shot.initialVerticalSpeed * crossingTime +
            0.5 * GRAVITY * crossingTime ** 2;
        } else if (shot.returnElapsed === null) {
          shot.t += delta;
          if (shot.actionSent && shot.result === false) shot.actionTime = shot.duration;
          const time = Math.min(shot.t, shot.duration);
          xFraction = shot.startX + shot.horizontalSpeed * time / shot.aspectRatio;
          yFraction = START_Y - shot.initialVerticalSpeed * time +
            0.5 * GRAVITY * time ** 2;
          if (shot.t >= shot.duration) {
            shot.returnElapsed = 0;
            shot.landingX = xFraction;
          }
        } else {
          shot.returnElapsed += delta;
          const progress = clamp(shot.returnElapsed / BALL_RETURN_SECONDS, 0, 1);
          const easedProgress = progress * progress * (3 - 2 * progress);
          xFraction = shot.landingX + (shot.startX - shot.landingX) * easedProgress;
          yFraction = LANDING_Y + (START_Y - LANDING_Y) * easedProgress -
            Math.sin(Math.PI * progress) * 0.035;
        }
        shot.x = xFraction;
        shot.y = yFraction;
        drawBall(
          xFraction * instance.width,
          yFraction * instance.height,
          Math.min(instance.width, instance.height) * 0.028
        );
        if (!shot.actionSent && shot.t >= shot.actionTime) {
          shot.actionSent = true;
          const payload = {
            startX: shot.startX,
            pullX: shot.pullX,
            pullY: shot.pullY,
            aspectRatio: shot.aspectRatio
          };
          instance.message.textContent = "Conferindo o arremesso…";
          void Promise.resolve(instance.options.onAction("shoot", payload))
            .then(response => resolveShot(instance, response?.update?.lastShot))
            .catch(error => {
              if (instance.shot === shot) shot.result = false;
              instance.options.onError(error);
            });
        }
        if (shot.returnElapsed !== null && shot.returnElapsed >= BALL_RETURN_SECONDS) {
          instance.shot = null;
        }
      } else {
        drawBall(ownOrigin.x, ownOrigin.y, Math.min(instance.width, instance.height) * 0.028);
      }
      instance.particles = instance.particles.filter(particle => particle.life > 0);
      instance.particles.forEach(particle => {
        particle.x += particle.vx * delta * 60;
        particle.y += particle.vy * delta * 60;
        particle.vy += 0.08;
        particle.life -= delta * 60;
        context.fillStyle = particle.color;
        context.fillRect(particle.x, particle.y, 4, 4);
      });
      if (instance.presenceJoined && timestamp - instance.lastPresenceAt > 50) {
        instance.lastPresenceAt = timestamp;
        const ball = instance.shot
          ? {
            x: clamp(instance.shot.x, 0, 1),
            y: clamp(instance.shot.y, 0, 1)
          }
          : { x: clamp(ownOrigin.x / instance.width, 0, 1), y: clamp(ownOrigin.y / instance.height, 0, 1) };
        instance.options.onPresence?.({ roomId: instance.options.roomId, x: instance.playerX, ball });
      }
      instance.frame = requestAnimationFrame(draw);
    };
    const updateTime = () => {
      const seconds = Math.max(0, Math.ceil((new Date(instance.state.endsAt).getTime() - Date.now()) / 1000));
      remaining.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
      canvas.classList.toggle("is-finished", seconds === 0);
      if (seconds === 0) message.textContent = "Tempo encerrado! Aguarde o resultado da partida.";
    };
    instance.frame = requestAnimationFrame(draw);
    instance.countdownTimer = setInterval(updateTime, 250);
    updateTime();
    updateHud(instance);
    Promise.resolve(options.onPresenceJoin?.()).then(presences => {
      if (game !== instance) return;
      instance.presenceJoined = true;
      if (Array.isArray(presences)) presences.forEach(presence => updatePresence(presence));
    }).catch(options.onError);
  }

  function updateHud(instance) {
    const timeLabel = Math.max(0, Math.ceil((new Date(instance.state.endsAt).getTime() - Date.now()) / 1000));
    instance.remaining.textContent =
      `${String(Math.floor(timeLabel / 60)).padStart(2, "0")}:${String(timeLabel % 60).padStart(2, "0")}`;
    instance.board.replaceChildren(node("strong", "", "PLACAR"));
    const players = [...instance.state.players].sort((a, b) => b.baskets - a.baskets);
    for (const player of players) {
      const row = node("div", "party-basketball-score");
      row.append(node("span", "", player.username), node("b", "", `${player.baskets} ${player.baskets === 1 ? "cesta" : "cestas"}`));
      if (String(player.userId) === String(instance.options.userId)) row.classList.add("is-you");
      instance.board.appendChild(row);
    }
  }

  function updatePresence(presence) {
    if (!game || !presence || presence.userId === game.options.userId ||
        !Number.isFinite(presence.x) || presence.x < 0 || presence.x > 1 ||
        !presence.ball || !Number.isFinite(presence.ball.x) || presence.ball.x < 0 || presence.ball.x > 1 ||
        !Number.isFinite(presence.ball.y) || presence.ball.y < 0 || presence.ball.y > 1) return;
    game.remotes.set(String(presence.userId), presence);
  }

  function removePresence(userId) {
    game?.remotes.delete(String(userId));
  }

  window.OrbyBasketballUI = { render, updatePresence, removePresence, destroy };
})();
