import { PartyRoomError } from "./partyRoomService.js";
import { GameModule, scorePartyPlacements } from "./gameModule.js";

const CHOICES = Object.freeze(["rock", "paper", "scissors"]);
const CHOICE_TIMEOUT_MS = 10_000;
const RESULT_ADVANCE_MS = 5_000;
export const ROCK_PAPER_SCISSORS_TIMINGS = Object.freeze({
  choiceMs: CHOICE_TIMEOUT_MS,
  resultAdvanceMs: RESULT_ADVANCE_MS
});
const BEATS = Object.freeze({
  rock: "scissors",
  paper: "rock",
  scissors: "paper"
});

const serializeId = value => String(value);

function createMatch(players, now = new Date()) {
  const [first, second] = players;
  return {
    players: [first, second],
    wins: { [first]: 0, [second]: 0 },
    playedRounds: 0,
    choices: {},
    result: null,
    winnerUserId: null,
    choiceDeadlineAt: new Date(now.getTime() + CHOICE_TIMEOUT_MS),
    resultAdvanceAt: null
  };
}

function makeMatchups(players) {
  const matchups = [];
  for (let index = 0; index + 1 < players.length; index += 2) {
    matchups.push([players[index], players[index + 1]]);
  }
  return {
    matchups,
    byeUserId: players.length % 2 ? players[players.length - 1] : null
  };
}

function advanceBracket(state, now) {
  const withdrawn = new Set(state.withdrawnUserIds || []);
  const active = userId => !withdrawn.has(userId);

  const startNextMatch = () => {
    while (state.matchIndex < state.matchups.length) {
      const matchup = state.matchups[state.matchIndex].filter(active);
      if (matchup.length === 2) {
        state.currentMatch = createMatch(matchup, now());
        state.message = "Próximo confronto do torneio!";
        return true;
      }
      if (matchup.length === 1) state.roundWinners.push(matchup[0]);
      state.matchIndex += 1;
    }
    return false;
  };

  if (startNextMatch()) return;

  const qualifiers = state.roundWinners.filter(active);
  if (state.byeUserId && active(state.byeUserId)) qualifiers.push(state.byeUserId);
  if (qualifiers.length === 1) {
    state.gameOver = true;
    state.championUserId = qualifiers[0];
    state.currentMatch = null;
    state.message = `${state.players.find(player => player.userId === qualifiers[0])?.username || "O jogador"} venceu o torneio!`;
    return;
  }

  const nextRound = makeMatchups(qualifiers);
  state.bracketRound += 1;
  state.matchups = nextRound.matchups;
  state.byeUserId = nextRound.byeUserId;
  state.matchIndex = 0;
  state.roundWinners = [];
  if (startNextMatch()) return;
  if (state.byeUserId) {
    state.roundWinners.push(state.byeUserId);
    state.byeUserId = null;
    advanceBracket(state, now);
  }
}

function normalizeMatch(match, now = new Date()) {
  if (!match || !Array.isArray(match.players) || match.players.length !== 2) {
    throw new PartyRoomError("O confronto salvo está inválido. Reinicie o jogo.", 409);
  }
  if (!match.choices || typeof match.choices !== "object" || Array.isArray(match.choices)) {
    match.choices = {};
  }
  if (!match.wins || typeof match.wins !== "object" || Array.isArray(match.wins)) {
    match.wins = {};
  }
  for (const playerId of match.players) {
    if (!Number.isSafeInteger(match.wins[playerId]) || match.wins[playerId] < 0) {
      match.wins[playerId] = 0;
    }
  }
  if (!Number.isSafeInteger(match.playedRounds) || match.playedRounds < 0) {
    match.playedRounds = 0;
  }
  if (match.result && !match.resultAdvanceAt) {
    match.resultAdvanceAt = new Date(now.getTime() + RESULT_ADVANCE_MS);
  } else if (!match.result && !match.choiceDeadlineAt) {
    match.choiceDeadlineAt = new Date(now.getTime() + CHOICE_TIMEOUT_MS);
  }
  return match;
}

export class RockPaperScissorsGameModule extends GameModule {
  constructor() {
    super({ id: "rock-paper-scissors", name: "Pedra, Papel e Tesoura" });
  }

  async validateStart({ participants }) {
    if (participants.length < 2) {
      throw new PartyRoomError("Pedra, Papel e Tesoura precisa de pelo menos 2 jogadores.");
    }
    if (participants.length > 8) {
      throw new PartyRoomError("Pedra, Papel e Tesoura aceita no máximo 8 jogadores.");
    }
  }

  async start({ participants, now = () => new Date() }) {
    const players = participants.map(participant => ({
      userId: serializeId(participant.userId),
      username: participant.username,
      matchWins: 0
    }));
    const initialPlayers = players.map(player => player.userId);
    const { matchups, byeUserId } = makeMatchups(initialPlayers);
    return {
      mode: this.id,
      players,
      bracketRound: 1,
      matchups,
      byeUserId,
      matchIndex: 0,
      roundWinners: [],
      currentMatch: createMatch(matchups[0], now()),
      gameOver: false,
      championUserId: null,
      withdrawnUserIds: [],
      message: byeUserId
        ? `${players.find(player => player.userId === byeUserId).username} aguarda para enfrentar um vencedor.`
        : "O torneio começou!"
    };
  }

  async handleAction({ participant, state, now = () => new Date(), serverAction = false }, { action, payload }) {
    if (!state || state.mode !== this.id || state.gameOver || !state.currentMatch) {
      throw new PartyRoomError("O torneio não está recebendo ações.", 409);
    }
    const userId = serializeId(participant.userId);
    const match = normalizeMatch(state.currentMatch);
    if (!match.players.includes(userId)) {
      throw new PartyRoomError("Aguarde sua vez: esta partida é entre outros jogadores.", 409);
    }

    if (action === "choose") {
      if (match.result) throw new PartyRoomError("Avance o resultado antes de jogar novamente.", 409);
      if (new Date(match.choiceDeadlineAt).getTime() <= now().getTime()) {
        throw new PartyRoomError("O tempo para escolher acabou. A rodada será empate.", 409);
      }
      if (Object.hasOwn(match.choices, userId)) {
        throw new PartyRoomError("Você já escolheu nesta rodada.", 409);
      }
      if (!CHOICES.includes(payload?.choice)) throw new PartyRoomError("Escolha pedra, papel ou tesoura.");
      match.choices[userId] = payload.choice;
      if (match.players.every(playerId => Object.hasOwn(match.choices, playerId))) {
        match.playedRounds += 1;
        const [firstId, secondId] = match.players;
        const firstChoice = match.choices[firstId];
        const secondChoice = match.choices[secondId];
        let winnerUserId = null;
        if (firstChoice !== secondChoice) {
          winnerUserId = BEATS[firstChoice] === secondChoice ? firstId : secondId;
          match.wins[winnerUserId] += 1;
        }
        const firstWins = match.wins[firstId];
        const secondWins = match.wins[secondId];
        if (firstWins >= 2 || secondWins >= 2 ||
            (match.playedRounds >= 3 && firstWins !== secondWins)) {
          match.winnerUserId = firstWins > secondWins ? firstId : secondId;
        }
        match.result = {
          round: match.playedRounds,
          choices: { [firstId]: firstChoice, [secondId]: secondChoice },
          winnerUserId,
          matchWinnerUserId: match.winnerUserId,
          isSuddenDeath: match.playedRounds > 3
        };
        match.choiceDeadlineAt = null;
        match.resultAdvanceAt = new Date(now().getTime() + RESULT_ADVANCE_MS);
        const winner = state.players.find(player => player.userId === winnerUserId);
        state.message = winner
          ? `${winner.username} venceu a rodada!`
          : match.playedRounds >= 3
            ? "Empate! Rodada de morte súbita."
            : "Empate nesta rodada. Joguem novamente!";
      } else {
        state.message = "Escolha registrada. Aguardando o outro jogador…";
      }
    } else if (action === "timeout") {
      if (match.result || new Date(match.choiceDeadlineAt).getTime() > now().getTime()) {
        throw new PartyRoomError("A rodada ainda não chegou ao limite de tempo.", 409);
      }
      match.playedRounds += 1;
      match.result = {
        round: match.playedRounds,
        choices: { ...match.choices },
        winnerUserId: null,
        matchWinnerUserId: null,
        isSuddenDeath: match.playedRounds > 3,
        timedOut: true
      };
      match.choiceDeadlineAt = null;
      match.resultAdvanceAt = new Date(now().getTime() + RESULT_ADVANCE_MS);
      state.message = "Tempo esgotado! A rodada terminou em empate.";
    } else if (action === "continue") {
      if (!match.result) throw new PartyRoomError("A rodada ainda não terminou.", 409);
      if (new Date(match.resultAdvanceAt).getTime() > now().getTime()) {
        throw new PartyRoomError("A rodada avançará automaticamente em alguns segundos.", 409);
      }
      if (!serverAction && userId !== match.players[0]) {
        throw new PartyRoomError("Aguarde o primeiro jogador avançar a rodada.", 409);
      }
      if (match.winnerUserId) {
        const winner = state.players.find(player => player.userId === match.winnerUserId);
        if (winner) winner.matchWins += 1;
        state.roundWinners.push(match.winnerUserId);
        state.matchIndex += 1;
        advanceBracket(state, now);
      } else {
        match.choices = {};
        match.result = null;
        match.choiceDeadlineAt = new Date(now().getTime() + CHOICE_TIMEOUT_MS);
        match.resultAdvanceAt = null;
        state.message = match.playedRounds >= 3
          ? "Morte súbita! A próxima rodada decide o confronto."
          : "Nova rodada: escolham suas jogadas.";
      }
    } else {
      throw new PartyRoomError("Ação inválida para Pedra, Papel e Tesoura.");
    }

    return {
      state,
      update: this.getClientState({ state }),
      finished: state.gameOver
    };
  }

  async handlePlayerLeave({ state, userId, now = () => new Date() }) {
    const playerId = serializeId(userId);
    state.withdrawnUserIds = [...new Set([...(state.withdrawnUserIds || []), playerId])];
    state.roundWinners = (state.roundWinners || []).filter(winnerId => winnerId !== playerId);
    if (state.byeUserId === playerId) state.byeUserId = null;
    const match = state.currentMatch;
    if (match?.players.includes(playerId)) {
      const winnerUserId = match.players.find(candidate => candidate !== playerId);
      match.winnerUserId = winnerUserId;
      match.choices = {};
      match.result = {
        round: match.playedRounds,
        choices: {},
        winnerUserId,
        matchWinnerUserId: winnerUserId,
        forfeitUserId: playerId,
        isSuddenDeath: false
      };
      match.choiceDeadlineAt = null;
      match.resultAdvanceAt = new Date(now().getTime() + RESULT_ADVANCE_MS);
      state.message = `${state.players.find(player => player.userId === winnerUserId)?.username || "O adversário"} avançou após a desistência.`;
    }
    return state;
  }

  getScheduledAction({ state }) {
    const match = state?.currentMatch;
    if (!match) return null;
    const normalized = normalizeMatch(match);
    if (normalized.result && normalized.resultAdvanceAt) {
      return { action: "continue", at: normalized.resultAdvanceAt };
    }
    if (!normalized.result && normalized.choiceDeadlineAt) {
      return { action: "timeout", at: normalized.choiceDeadlineAt };
    }
    return null;
  }

  getClientState({ state, userId }) {
    if (!state || state.mode !== this.id || !Array.isArray(state.players)) return null;
    const match = state.currentMatch
      ? normalizeMatch(state.currentMatch)
      : null;
    const choices = match?.choices || {};
    const wins = match?.wins || {};
    const matchPlayers = match?.players || [];
    const withdrawn = new Set(state.withdrawnUserIds || []);
    const firstPlayer = match && state.players.find(player => player.userId === matchPlayers[0]);
    const secondPlayer = match && state.players.find(player => player.userId === matchPlayers[1]);
    const waitingPlayerIds = new Set([
      ...(state.byeUserId ? [state.byeUserId] : []),
      ...(Array.isArray(state.roundWinners) ? state.roundWinners : []),
      ...(Array.isArray(state.matchups) ? state.matchups.slice((state.matchIndex || 0) + 1).flat() : [])
    ]);
    return {
      gameId: this.id,
      mode: state.mode,
      players: state.players.filter(player => !withdrawn.has(player.userId)).map(player => ({
        userId: player.userId,
        username: player.username,
        matchWins: player.matchWins,
        status: state.gameOver && state.championUserId === player.userId
          ? "champion"
          : matchPlayers.includes(player.userId)
            ? "playing"
            : waitingPlayerIds.has(player.userId) ? "waiting" : "eliminated"
      })),
      bracketRound: state.bracketRound,
      matchNumber: (state.matchIndex || 0) + 1,
      matchCount: Array.isArray(state.matchups) ? state.matchups.length : 0,
      currentMatch: match ? {
        players: [firstPlayer, secondPlayer],
        wins: { ...wins },
        playedRounds: match.playedRounds,
        selectedCount: Object.keys(choices).length,
        selectedUserIds: Object.keys(choices),
        hasSelected: Object.hasOwn(choices, serializeId(userId || "")),
        selectedChoice: choices[serializeId(userId || "")] || null,
        choiceDeadlineAt: match.choiceDeadlineAt,
        isParticipant: matchPlayers.includes(serializeId(userId || "")),
        canContinue: serializeId(userId || "") === matchPlayers[0]
      } : null,
      roundResult: match?.result ? {
        ...match.result,
        players: matchPlayers.map(playerId => ({
          ...state.players.find(player => player.userId === playerId),
          choice: match.result.choices?.[playerId]
        }))
      } : null,
      gameOver: state.gameOver,
      championUserId: state.championUserId,
      message: state.message
    };
  }

  async finish({ state }) {
    if (!state?.gameOver || !state.championUserId) {
      throw new PartyRoomError("O torneio só termina quando houver um campeão.", 409);
    }
    return { championUserId: state.championUserId };
  }

  async calculateScores({ participants, state }) {
    if (!state?.championUserId) return scorePartyPlacements(participants, []);
    const finalMatchup = Array.isArray(state.matchups) && state.matchups.length === 1
      ? state.matchups[0]
      : [];
    const runnerUpUserId = finalMatchup.find(userId => userId !== state.championUserId);
    const placementGroups = [[state.championUserId]];
    if (runnerUpUserId) placementGroups.push([runnerUpUserId]);

    const remainingPlayers = state.players
      .filter(player =>
        player.userId !== state.championUserId && player.userId !== runnerUpUserId
      )
      .sort((left, right) => right.matchWins - left.matchWins);
    for (let index = 0; index < remainingPlayers.length;) {
      const matchWins = remainingPlayers[index].matchWins;
      const tiedPlayers = [];
      while (index < remainingPlayers.length && remainingPlayers[index].matchWins === matchWins) {
        tiedPlayers.push(remainingPlayers[index].userId);
        index += 1;
      }
      placementGroups.push(tiedPlayers);
    }
    return scorePartyPlacements(participants, placementGroups);
  }
}

export { BEATS as ROCK_PAPER_SCISSORS_BEATS, CHOICES as ROCK_PAPER_SCISSORS_CHOICES };
