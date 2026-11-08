(() => {
  "use strict";

  const CHOICES = [
    { id: "rock", icon: "✊", label: "Pedra" },
    { id: "paper", icon: "✋", label: "Papel" },
    { id: "scissors", icon: "✌️", label: "Tesoura" }
  ];
  let localSelection = null;

  function roundKey(state) {
    const match = state.currentMatch;
    return [
      state.bracketRound,
      state.matchNumber,
      match.players.map(player => player.userId).join(":"),
      match.playedRounds
    ].join("|");
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render(root, state, { userId, onAction, onError, loadProfile, renderAvatar } = {}) {
    root.replaceChildren();
    root.className = "party-game-controls party-rps-controls";
    root.hidden = false;
    if (!state || state.mode !== "rock-paper-scissors" || !Array.isArray(state.players)) {
      root.appendChild(element("p", "party-rps-loading", "Preparando o torneio…"));
      return;
    }
    if (state.gameOver || !state.currentMatch || localSelection?.key !== roundKey(state)) {
      localSelection = null;
    }

    const shell = element("section", "party-rps-shell");
    const header = element("header", "party-rps-header");
    const logo = element("span", "party-rps-logo", "✊");
    logo.setAttribute("aria-hidden", "true");
    const title = element("div", "party-rps-heading");
    title.append(
      element("strong", "", "Pedra, Papel e Tesoura"),
      element("small", "", "TORNEIO ELIMINATÓRIO · MELHOR DE 3")
    );
    header.append(logo, title);
    const roundLabel = element("span", "party-rps-round-label", `FASE ${state.bracketRound}`);
    header.appendChild(roundLabel);
    shell.appendChild(header);

    const bracket = element("div", "party-rps-bracket");
    const matchCounter = state.currentMatch
      ? `Confronto ${state.matchNumber} de ${state.matchCount}`
      : "Torneio encerrado";
    bracket.append(
      element("span", "party-rps-bracket-kicker", matchCounter),
      element("h2", "party-rps-message", state.message || "Escolham suas jogadas.")
    );
    const waitingPlayers = state.players.filter(player => player.status === "waiting");
    if (waitingPlayers.length) {
      const waiting = element("p", "party-rps-waiting");
      waiting.append(element("span", "", "⏳"));
      waiting.append(document.createTextNode(
        ` Na fila para o próximo confronto: ${waitingPlayers.map(player => player.username).join(", ")}`
      ));
      bracket.appendChild(waiting);
    }
    shell.appendChild(bracket);

    if (state.gameOver) {
      const champion = state.players.find(player => player.userId === state.championUserId);
      const winner = element("div", "party-rps-champion");
      if (champion) {
        winner.appendChild(makeAvatar(champion, "party-rps-champion-avatar", loadProfile, renderAvatar));
      }
      winner.append(
        element("span", "party-rps-champion-crown", "🏆"),
        element("span", "party-rps-champion-label", "CAMPEÃO DO TORNEIO"),
        element("strong", "party-rps-champion-name", champion?.username || "Jogador")
      );
      shell.appendChild(winner);
    } else if (state.currentMatch) {
      const match = element("section", "party-rps-match");
      const first = state.currentMatch.players[0];
      const second = state.currentMatch.players[1];
      const result = state.roundResult;
      const choiceByPlayer = new Map((result?.players || []).map(player => [player.userId, player.choice]));
      const selectedChoice = state.currentMatch.selectedChoice ||
        (localSelection?.key === roundKey(state) ? localSelection.choice : null);
      if (!result && selectedChoice && userId) {
        choiceByPlayer.set(userId, selectedChoice);
      }
      const duel = element("div", "party-rps-duel");
      duel.append(
        renderPlayer(first, state.currentMatch.wins[first.userId], choiceByPlayer.get(first.userId), result?.winnerUserId === first.userId, !result && first.userId === userId && Boolean(selectedChoice), loadProfile, renderAvatar),
        element("span", "party-rps-versus", "VS"),
        renderPlayer(second, state.currentMatch.wins[second.userId], choiceByPlayer.get(second.userId), result?.winnerUserId === second.userId, !result && second.userId === userId && Boolean(selectedChoice), loadProfile, renderAvatar)
      );
      match.appendChild(duel);

      if (result) {
        const resultBanner = element(
          "div",
          `party-rps-round-result${result.winnerUserId ? " has-winner" : " is-tie"}`
        );
        const roundNumber = `Rodada ${result.round}${result.isSuddenDeath ? " · MORTE SÚBITA" : ""}`;
        const resultText = result.timedOut
          ? "Tempo esgotado! A rodada terminou em empate."
          : result.winnerUserId
            ? `${result.players.find(player => player.userId === result.winnerUserId)?.username} venceu a rodada!`
            : "Empate! Ninguém pontua.";
        resultBanner.append(
          element("span", "party-rps-result-round", roundNumber),
          element("strong", "", resultText),
          element("small", "party-rps-auto-advance", "Próxima rodada em 5 segundos…")
        );
        match.appendChild(resultBanner);
      } else {
        const round = state.currentMatch.playedRounds + 1;
        match.appendChild(element("p", "party-rps-round-label", `RODADA ${round}${round > 3 ? " · MORTE SÚBITA" : " DE 3"}`));
        match.appendChild(element("p", "party-rps-choice-deadline", "Você tem 10 segundos para escolher."));
        if (state.currentMatch.isParticipant) {
          const alreadySelected = state.currentMatch.hasSelected ||
            state.currentMatch.selectedUserIds?.includes(userId);
          const choices = element("div", "party-rps-choices");
          for (const choice of CHOICES) {
            const button = element("button", "party-rps-choice");
            button.type = "button";
            button.disabled = alreadySelected;
            button.setAttribute("aria-label", choice.label);
            button.append(
              element("span", "party-rps-choice-icon", choice.icon),
              element("span", "party-rps-choice-label", choice.label)
            );
            button.addEventListener("click", () => {
              localSelection = { key: roundKey(state), choice: choice.id };
              const ownCard = [...match.querySelectorAll(".party-rps-player-card")]
                .find(card => card.dataset.userId === userId);
              const hand = ownCard?.querySelector(".party-rps-reveal");
              if (hand) {
                hand.textContent = choice.icon;
                hand.classList.add("is-revealed", "is-preview");
                hand.setAttribute("aria-label", `${choice.label}, aguardando a escolha do adversário`);
              }
              void dispatch("choose", { choice: choice.id });
            });
            choices.appendChild(button);
          }
          match.appendChild(choices);
          match.appendChild(element("p", "party-rps-hint", alreadySelected
              ? `Você escolheu ${CHOICES.find(choice => choice.id === selectedChoice)?.label || "sua jogada"} ${CHOICES.find(choice => choice.id === selectedChoice)?.icon || ""}. Aguardando o adversário…`
            : "Escolha sem ver a jogada do adversário!"));
        } else {
          match.appendChild(element("p", "party-rps-hint", "Você está assistindo a este confronto."));
        }
      }
      shell.appendChild(match);
    }

    const standings = element("section", "party-rps-standings");
    standings.appendChild(element("h3", "", "CHAVE DO TORNEIO"));
    const playerList = element("div", "party-rps-player-list");
    for (const player of state.players) {
      const item = element("div", `party-rps-player-row party-rps-player-row--${player.status}`);
      const status = {
        playing: "Jogando",
        waiting: "Aguardando",
        eliminated: "Eliminado",
        champion: "Campeão"
      }[player.status];
      item.append(
        makeAvatar(player, "party-rps-player-avatar-small", loadProfile, renderAvatar),
        element("span", "party-rps-player-name", player.username),
        element("span", "party-rps-player-wins", `${player.matchWins} ${player.matchWins === 1 ? "vitória" : "vitórias"}`),
        element("span", "party-rps-player-status", status)
      );
      playerList.appendChild(item);
    }
    standings.appendChild(playerList);
    shell.appendChild(standings);
    root.appendChild(shell);

    async function dispatch(action, payload) {
      root.setAttribute("aria-busy", "true");
      root.querySelectorAll("button").forEach(button => { button.disabled = true; });
      try {
        await onAction(action, payload);
      } catch (error) {
        onError?.(error);
      } finally {
        root.removeAttribute("aria-busy");
      }
    }
  }

  function renderPlayer(player, wins, revealedChoice, wonRound, isPreview, loadProfile, renderAvatar) {
    const card = element("div", `party-rps-player-card${wonRound ? " is-round-winner" : ""}`);
    card.dataset.userId = player.userId;
    const avatar = makeAvatar(player, "party-rps-player-avatar", loadProfile, renderAvatar);
    const name = element("strong", "party-rps-player-card-name", player.username);
    const score = element("span", "party-rps-score", `${wins} ${wins === 1 ? "ponto" : "pontos"}`);
    const hand = element("span", `party-rps-reveal${revealedChoice ? " is-revealed" : ""}${isPreview ? " is-preview" : ""}`,
      revealedChoice ? CHOICES.find(choice => choice.id === revealedChoice)?.icon : "…");
    if (revealedChoice) {
      const label = CHOICES.find(choice => choice.id === revealedChoice)?.label || "";
      hand.setAttribute("aria-label", label);
      hand.title = label;
    } else hand.setAttribute("aria-label", "Aguardando a escolha");
    card.append(avatar, name, score, hand);
    return card;
  }

  function makeAvatar(player, className, loadProfile, renderAvatar) {
    const avatar = element("span", className, (player.username || "?").slice(0, 1).toUpperCase());
    if (typeof renderAvatar === "function") renderAvatar(avatar, null, player.username);
    if (typeof loadProfile === "function" && typeof renderAvatar === "function") {
      void loadProfile(player.userId).then(profile => {
        if (avatar.isConnected) renderAvatar(avatar, profile, player.username);
      });
    }
    return avatar;
  }

  window.OrbyRockPaperScissorsUI = Object.freeze({ render });
})();
