import { PartyRoomError } from "./partyRoomService.js";
import { GameModule, scorePartyPlacements } from "./gameModule.js";

const COLORS = Object.freeze(["red", "blue", "yellow", "green"]);
const ACTION_VALUES = new Set(["skip", "reverse", "draw2", "draw4"]);
const COLOR_NAMES = Object.freeze({
  red: "vermelho",
  blue: "azul",
  yellow: "amarelo",
  green: "verde"
});

const serializeId = value => String(value);
const shuffle = cards => {
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [cards[index], cards[swapIndex]] = [cards[swapIndex], cards[index]];
  }
  return cards;
};

export class UnoGameModule extends GameModule {
  constructor() {
    super({ id: "uno", name: "UNO" });
  }

  async validateStart({ participants }) {
    if (participants.length < 2) throw new PartyRoomError("O UNO precisa de pelo menos 2 jogadores.");
    if (participants.length > 8) throw new PartyRoomError("O UNO aceita no máximo 8 jogadores.");
  }

  async start({ participants }) {
    let nextCardId = 1;
    const makeCard = (color, value) => ({ id: nextCardId++, color, value });
    const deck = [];
    for (const color of COLORS) {
      deck.push(makeCard(color, "0"));
      for (let number = 1; number <= 9; number += 1) {
        deck.push(makeCard(color, String(number)), makeCard(color, String(number)));
      }
      for (const value of ["skip", "reverse", "draw2"]) {
        deck.push(makeCard(color, value), makeCard(color, value));
      }
    }
    for (let index = 0; index < 4; index += 1) {
      deck.push(makeCard("wild", "wild"), makeCard("wild", "draw4"));
    }
    shuffle(deck);

    const players = participants.map(participant => ({
      userId: serializeId(participant.userId),
      username: participant.username,
      hand: [],
      saidUno: false
    }));
    for (const player of players) {
      for (let cardIndex = 0; cardIndex < 7; cardIndex += 1) {
        player.hand.push(deck.pop());
      }
    }

    const firstNumberIndex = deck.findIndex(card => card.color !== "wild" && /^\d$/.test(card.value));
    const firstCard = deck.splice(firstNumberIndex < 0 ? 0 : firstNumberIndex, 1)[0];
    return {
      mode: "uno",
      players,
      deck,
      discard: [firstCard],
      currentPlayerIndex: 0,
      direction: 1,
      activeColor: firstCard.color,
      pendingDraw: 0,
      unoPenaltyUserId: null,
      gameOver: false,
      winnerUserId: null,
      message: `${players[0].username} começa. Combine a cor ou o símbolo da carta.`
    };
  }

  async handleAction({ participant, state }, { action, payload }) {
    if (!state || state.mode !== "uno" || state.gameOver || !Array.isArray(state.players)) {
      throw new PartyRoomError("A partida de UNO não está recebendo ações.", 409);
    }
    const userId = serializeId(participant.userId);
    const playerIndex = state.players.findIndex(player => player.userId === userId);
    if (playerIndex < 0) throw new PartyRoomError("Você não participa desta partida.", 403);
    if (state.currentPlayerIndex !== playerIndex) {
      throw new PartyRoomError("Ainda não é a sua vez.", 409);
    }
    const player = state.players[playerIndex];
    if (action !== "catch-uno") state.unoPenaltyUserId = null;

    if (action === "announce-uno") {
      if (player.hand.length > 2 || player.hand.length < 1 || player.saidUno) {
        throw new PartyRoomError("Você só pode anunciar UNO quando tiver uma ou duas cartas.");
      }
      player.saidUno = true;
      state.message = `${player.username} anunciou UNO!`;
    } else if (action === "catch-uno") {
      const offender = state.players.find(candidate => candidate.userId === state.unoPenaltyUserId);
      if (!offender || offender.userId === userId || offender.hand.length !== 1) {
        throw new PartyRoomError("Não há um UNO sem anúncio para contestar.", 409);
      }
      this.drawCards(state, offender, 2);
      offender.saidUno = false;
      state.unoPenaltyUserId = null;
      state.message = `${offender.username} recebeu 2 cartas por não anunciar UNO.`;
    } else if (action === "draw") {
      if (state.pendingDraw > 0) {
        const amount = state.pendingDraw;
        const received = this.drawCards(state, player, amount);
        state.pendingDraw = 0;
        state.message = `${player.username} comprou ${received} cartas e perdeu a vez.`;
        this.advance(state);
      } else {
        const card = this.drawCard(state);
        if (!card) throw new PartyRoomError("Não há cartas disponíveis para comprar.", 409);
        player.hand.push(card);
        state.message = `${player.username} comprou uma carta e perdeu a vez.`;
        this.advance(state);
      }
    } else if (action === "play") {
      const cardId = payload?.cardId;
      if (!Number.isSafeInteger(cardId)) throw new PartyRoomError("Carta inválida.");
      const cardIndex = player.hand.findIndex(card => card.id === cardId);
      if (cardIndex < 0) throw new PartyRoomError("Essa carta não está na sua mão.", 409);
      const card = player.hand[cardIndex];
      if (!this.canPlay(state, card)) throw new PartyRoomError("Essa carta não pode ser jogada agora.");
      const chosenColor = payload.color;
      if (card.color === "wild" && !COLORS.includes(chosenColor)) {
        throw new PartyRoomError("Escolha uma cor válida para o curinga.");
      }

      player.hand.splice(cardIndex, 1);
      state.discard.push(card);
      state.activeColor = card.color === "wild" ? chosenColor : card.color;
      if (player.hand.length === 1) {
        if (!player.saidUno) state.unoPenaltyUserId = userId;
        state.message = player.saidUno
          ? `${player.username} ficou com uma carta e anunciou UNO!`
          : `${player.username} ficou com uma carta sem anunciar UNO.`;
      } else {
        player.saidUno = false;
      }

      if (player.hand.length === 0) {
        state.gameOver = true;
        state.winnerUserId = userId;
        state.unoPenaltyUserId = null;
        state.message = `${player.username} venceu a partida!`;
      } else {
        if (card.value === "draw2") state.pendingDraw += 2;
        if (card.value === "draw4") state.pendingDraw += 4;
        let steps = 1;
        if (card.value === "skip") steps = 2;
        if (card.value === "reverse") {
          state.direction *= -1;
          if (state.players.length === 2) steps = 2;
        }
        const colorText = card.color === "wild" ? ` Cor escolhida: ${COLOR_NAMES[chosenColor]}.` : "";
        state.message = `${player.username} jogou ${card.value === "draw4" ? "+4" : card.value === "draw2" ? "+2" : card.value}.${colorText}`;
        this.advance(state, steps);
      }
    } else {
      throw new PartyRoomError("Ação inválida para UNO.");
    }

    return {
      state,
      update: this.getClientState({ state }),
      finished: state.gameOver
    };
  }

  async handlePlayerLeave({ state, userId }) {
    const playerIndex = state.players.findIndex(player => player.userId === serializeId(userId));
    if (playerIndex < 0) return state;
    state.players.splice(playerIndex, 1);
    if (playerIndex < state.currentPlayerIndex) state.currentPlayerIndex -= 1;
    else if (playerIndex === state.currentPlayerIndex) {
      state.currentPlayerIndex %= state.players.length;
    }
    if (state.unoPenaltyUserId === serializeId(userId)) state.unoPenaltyUserId = null;
    state.message = "Um jogador saiu da Party. O jogo continua com quem ficou.";
    return state;
  }

  getClientState({ state, userId }) {
    if (!state || state.mode !== "uno") return null;
    const currentPlayer = state.players[state.currentPlayerIndex];
    const publicState = {
      gameId: this.id,
      mode: state.mode,
      players: state.players.map(player => ({
        userId: player.userId,
        username: player.username,
        cardCount: player.hand.length,
        saidUno: player.saidUno
      })),
      topCard: state.discard.at(-1) || null,
      activeColor: state.activeColor,
      currentPlayerIndex: state.currentPlayerIndex,
      currentPlayerUserId: currentPlayer?.userId || null,
      direction: state.direction,
      drawPileCount: state.deck.length,
      pendingDraw: state.pendingDraw,
      unoPenaltyUserId: state.unoPenaltyUserId,
      gameOver: state.gameOver,
      winnerUserId: state.winnerUserId,
      message: state.message
    };
    if (userId) {
      const player = state.players.find(candidate => candidate.userId === serializeId(userId));
      if (!player) return null;
      publicState.hand = player.hand.map(card => ({ ...card }));
      publicState.saidUno = player.saidUno;
    }
    return publicState;
  }

  async finish({ state }) {
    if (!state?.gameOver || !state.winnerUserId) {
      throw new PartyRoomError("O UNO só termina quando um jogador fica sem cartas.", 409);
    }
    return { winnerUserId: state?.winnerUserId || null };
  }

  async calculateScores({ participants, state }) {
    const winnerUserId = state?.winnerUserId;
    if (!winnerUserId) return scorePartyPlacements(participants, []);
    const remainingPlayers = state.players
      .filter(player => player.userId !== winnerUserId)
      .sort((left, right) => left.hand.length - right.hand.length);
    const placementGroups = [[winnerUserId]];
    for (let index = 0; index < remainingPlayers.length;) {
      const cardCount = remainingPlayers[index].hand.length;
      const tiedPlayers = [];
      while (index < remainingPlayers.length && remainingPlayers[index].hand.length === cardCount) {
        tiedPlayers.push(remainingPlayers[index].userId);
        index += 1;
      }
      placementGroups.push(tiedPlayers);
    }
    return scorePartyPlacements(participants, placementGroups);
  }

  canPlay(state, card) {
    if (state.pendingDraw > 0) return card.value === "draw2" || card.value === "draw4";
    const topCard = state.discard.at(-1);
    return card.color === "wild" || card.color === state.activeColor || card.value === topCard?.value;
  }

  drawCard(state) {
    if (!state.deck.length) {
      if (state.discard.length <= 1) return null;
      const topCard = state.discard.pop();
      state.deck = shuffle(state.discard);
      state.discard = [topCard];
    }
    return state.deck.pop() || null;
  }

  drawCards(state, player, amount) {
    let received = 0;
    for (let index = 0; index < amount; index += 1) {
      const card = this.drawCard(state);
      if (!card) break;
      player.hand.push(card);
      received += 1;
    }
    return received;
  }

  advance(state, steps = 1) {
    const size = state.players.length;
    state.currentPlayerIndex = (state.currentPlayerIndex + state.direction * steps + size * 10) % size;
  }
}

export { ACTION_VALUES, COLORS };
