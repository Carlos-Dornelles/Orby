import test from "node:test";
import assert from "node:assert/strict";
import {
  BasketballGameModule,
  BASKETBALL_TIMINGS,
  simulateBasketballShot
} from "../services/basketballGame.js";

test("Cesta Certa uses a ballistic arc and only scores a correctly aimed descending shot", () => {
  const aspectRatio = 16 / 9;
  const pullY = 0.2;
  const crossingTime = simulateBasketballShot({
    startX: 0.5,
    pullX: 0,
    pullY,
    aspectRatio
  }).flightTime;
  const pullX = (0.4 - 0.5) * aspectRatio / (4.5 * crossingTime);

  const aimedShot = simulateBasketballShot({
    startX: 0.4,
    pullX,
    pullY,
    aspectRatio
  });
  assert.equal(aimedShot.scored, true);
  assert.ok(aimedShot.flightTime > 0.8);
  assert.equal(simulateBasketballShot({
    startX: 0.4,
    pullX: pullX + 0.1,
    pullY,
    aspectRatio
  }).scored, false);
  assert.equal(simulateBasketballShot({
    startX: 0.4,
    pullX,
    pullY: 0.05,
    aspectRatio
  }).scored, false);
  assert.equal(simulateBasketballShot({
    startX: 0.4,
    pullX,
    pullY: 0.34,
    aspectRatio
  }).scored, false);
});

test("Cesta Certa ranks by baskets and awards standard Party placement points", async () => {
  const game = new BasketballGameModule();
  const hostId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const playerId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const participants = [
    { userId: hostId, username: "Host" },
    { userId: playerId, username: "Jogador" }
  ];
  let now = new Date("2026-01-01T00:00:00.000Z");
  const state = await game.start({ participants, now: () => now });
  assert.equal(new Date(state.endsAt).getTime() - now.getTime(), BASKETBALL_TIMINGS.gameDurationMs);

  const makeShot = (participant, startX, pullX = 0) => game.handleAction({
    participant, state, now: () => now
  }, {
    action: "shoot",
    payload: { startX, pullX, pullY: 0.2, aspectRatio: 16 / 9 }
  });
  await makeShot(participants[0], 0.5);
  await assert.rejects(
    makeShot(participants[0], 0.5),
    /Aguarde/
  );
  now = new Date(now.getTime() + BASKETBALL_TIMINGS.minBasketIntervalMs);
  await makeShot(participants[0], 0.5);
  const aspectRatio = 16 / 9;
  const flightTime = simulateBasketballShot({
    startX: 0.5,
    pullX: 0,
    pullY: 0.2,
    aspectRatio
  }).flightTime;
  const pullX = (0.4 - 0.5) * aspectRatio / (4.5 * flightTime);
  await makeShot(participants[1], 0.4, pullX);

  assert.deepEqual(await game.calculateScores({ participants, state }), [
    { userId: hostId, points: 20 },
    { userId: playerId, points: 10 }
  ]);
  assert.equal(game.getClientState({ state }).players[0].baskets, 2);
  state.players[1].baskets = state.players[0].baskets;
  assert.deepEqual(await game.calculateScores({ participants, state }), [
    { userId: hostId, points: 20 },
    { userId: playerId, points: 20 }
  ]);
  state.players[1].baskets -= 1;
  await assert.rejects(
    game.handleAction({ participant: participants[0], state, now: () => now }, {
      action: "basket",
      payload: {}
    }),
    /Ação inválida/
  );
  assert.equal(game.getScheduledAction({ state }).action, "timeout");
});

test("Cesta Certa only ends after its 90-second deadline", async () => {
  const game = new BasketballGameModule();
  const participant = { userId: "aaaaaaaaaaaaaaaaaaaaaaaa", username: "Host" };
  let now = new Date("2026-01-01T00:00:00.000Z");
  const state = await game.start({ participants: [participant], now: () => now });

  await assert.rejects(
    game.handleAction({ participant, state, serverAction: true, now: () => now }, {
      action: "timeout",
      payload: {}
    }),
    /ainda não chegou/
  );
  now = new Date(state.endsAt);
  const result = await game.handleAction(
    { participant, state, serverAction: true, now: () => now },
    { action: "timeout", payload: {} }
  );
  assert.equal(result.finished, true);
  assert.equal((await game.finish({ state })).baskets, 0);
});
