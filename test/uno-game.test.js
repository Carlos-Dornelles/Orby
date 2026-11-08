import test from "node:test";
import assert from "node:assert/strict";
import { UnoGameModule } from "../services/unoGame.js";

const game = new UnoGameModule();
const participants = [
  { userId: "player-1", username: "Ana" },
  { userId: "player-2", username: "Bia" }
];

function createState(overrides = {}) {
  return {
    mode: "uno",
    players: [
      {
        userId: "player-1",
        username: "Ana",
        hand: [
          { id: 1, color: "red", value: "7" },
          { id: 2, color: "blue", value: "1" }
        ],
        saidUno: false
      },
      {
        userId: "player-2",
        username: "Bia",
        hand: [
          { id: 3, color: "green", value: "2" },
          { id: 4, color: "yellow", value: "3" }
        ],
        saidUno: false
      }
    ],
    deck: [
      { id: 5, color: "yellow", value: "8" },
      { id: 6, color: "blue", value: "4" },
      { id: 7, color: "green", value: "9" }
    ],
    discard: [{ id: 8, color: "blue", value: "7" }],
    currentPlayerIndex: 0,
    direction: 1,
    activeColor: "blue",
    pendingDraw: 0,
    unoPenaltyUserId: null,
    gameOver: false,
    winnerUserId: null,
    message: "Sua vez.",
    ...overrides
  };
}

test("UNO initializes a standard 108-card deck for 2 to 8 participants", async () => {
  await assert.rejects(game.validateStart({ participants: [participants[0]] }), /pelo menos 2/);
  await assert.rejects(game.validateStart({ participants: Array(9).fill(participants[0]) }), /no máximo 8/);

  const state = await game.start({ participants });
  const cardCount = state.players.reduce((sum, player) => sum + player.hand.length, 0) +
    state.deck.length + state.discard.length;
  assert.equal(cardCount, 108);
  assert.deepEqual(state.players.map(player => player.hand.length), [7, 7]);
});

test("UNO keeps hands private and permits matching color or value", async () => {
  const state = createState();
  const publicState = game.getClientState({ state });
  const privateState = game.getClientState({ state, userId: "player-1" });

  assert.equal("hand" in publicState, false);
  assert.equal("deck" in publicState, false);
  assert.equal(privateState.hand.length, 2);

  const result = await game.handleAction({
    participant: { userId: "player-1" },
    state
  }, { action: "play", payload: { cardId: 1 } });
  assert.equal(result.state.players[0].hand.length, 1);
  assert.equal(result.state.currentPlayerIndex, 1);
  assert.equal(result.state.unoPenaltyUserId, "player-1");
  assert.equal("hand" in result.update, false);
});

test("UNO replaces the previous table message after each move", async () => {
  const state = createState({
    players: [
      {
        userId: "player-1",
        username: "Ana",
        hand: [
          { id: 1, color: "blue", value: "7" },
          { id: 9, color: "green", value: "2" }
        ],
        saidUno: false
      },
      { userId: "player-2", username: "Bia", hand: [{ id: 3, color: "blue", value: "2" }], saidUno: false }
    ],
    discard: [{ id: 8, color: "blue", value: "4" }],
    message: "Mensagem antiga."
  });
  const result = await game.handleAction({
    participant: { userId: "player-1" },
    state
  }, { action: "play", payload: { cardId: 1 } });

  assert.match(result.state.message, /^Ana jogou 7\./);
  assert.doesNotMatch(result.state.message, /Mensagem antiga/);
});

test("UNO announcement and catch apply the two-card penalty without changing turn", async () => {
  const state = createState();
  const announce = await game.handleAction({
    participant: { userId: "player-1" },
    state
  }, { action: "announce-uno", payload: {} });
  assert.equal(announce.state.players[0].saidUno, true);

  const played = await game.handleAction({
    participant: { userId: "player-1" },
    state: announce.state
  }, { action: "play", payload: { cardId: 1 } });
  assert.equal(played.state.unoPenaltyUserId, null);
  assert.equal(played.state.currentPlayerIndex, 1);

  const missedCall = createState();
  await game.handleAction({
    participant: { userId: "player-1" },
    state: missedCall
  }, { action: "play", payload: { cardId: 1 } });
  const caught = await game.handleAction({
    participant: { userId: "player-2" },
    state: missedCall
  }, { action: "catch-uno", payload: {} });
  assert.equal(caught.state.players[0].hand.length, 3);
  assert.equal(caught.state.currentPlayerIndex, 1);
  assert.equal(caught.state.unoPenaltyUserId, null);
});

test("UNO automatically skips the turn after a card is drawn", async () => {
  const state = createState();
  const startingHandSize = state.players[0].hand.length;
  const drawn = await game.handleAction({
    participant: { userId: "player-1" },
    state
  }, { action: "draw", payload: {} });
  assert.equal(drawn.state.players[0].hand.length, startingHandSize + 1);
  assert.equal(drawn.state.currentPlayerIndex, 1);
  assert.match(drawn.state.message, /Ana comprou uma carta e perdeu a vez/);
  await assert.rejects(game.handleAction({
    participant: { userId: "player-1" },
    state: drawn.state
  }, { action: "play", payload: { cardId: 1 } }), /Ainda não é a sua vez/);
  await assert.rejects(game.handleAction({
    participant: { userId: "player-1" },
    state: drawn.state
  }, { action: "pass", payload: {} }), /Ainda não é a sua vez/);
});

test("UNO advances the turn automatically after buying a pending draw penalty", async () => {
  const state = createState({ pendingDraw: 2 });
  const initialHandSize = state.players[0].hand.length;
  const result = await game.handleAction({
    participant: { userId: "player-1" },
    state
  }, { action: "draw", payload: {} });

  assert.equal(result.state.players[0].hand.length, initialHandSize + 2);
  assert.equal(result.state.pendingDraw, 0);
  assert.equal(result.state.currentPlayerIndex, 1);
  assert.match(result.state.message, /Ana comprou 2 cartas e perdeu a vez/);
});

test("UNO awards Party podium points by remaining cards", async () => {
  const won = createState({
    players: [
      { userId: "player-1", username: "Ana", hand: [{ id: 1, color: "blue", value: "2" }], saidUno: false },
      { userId: "player-2", username: "Bia", hand: [{ id: 3, color: "wild", value: "draw4" }], saidUno: false }
    ]
  });
  const result = await game.handleAction({
    participant: { userId: "player-1" },
    state: won
  }, { action: "play", payload: { cardId: 1 } });
  assert.equal(result.finished, true);
  assert.equal((await game.finish({ state: result.state })).winnerUserId, "player-1");
  await assert.rejects(game.finish({ state: createState() }), /só termina quando/);
  const scores = await game.calculateScores({ participants, state: result.state });
  assert.deepEqual(scores, [
    { userId: "player-1", points: 20 },
    { userId: "player-2", points: 10 }
  ]);
});

test("UNO awards 5 points to third place", async () => {
  const gameParticipants = [
    ...participants,
    { userId: "player-3", username: "Caio" }
  ];
  const state = createState({
    winnerUserId: "player-1",
    gameOver: true,
    players: [
      { userId: "player-1", username: "Ana", hand: [], saidUno: false },
      { userId: "player-2", username: "Bia", hand: [{ id: 3 }], saidUno: false },
      { userId: "player-3", username: "Caio", hand: [{ id: 4 }, { id: 5 }], saidUno: false }
    ]
  });

  assert.deepEqual(await game.calculateScores({ participants: gameParticipants, state }), [
    { userId: "player-1", points: 20 },
    { userId: "player-2", points: 10 },
    { userId: "player-3", points: 5 }
  ]);
});
