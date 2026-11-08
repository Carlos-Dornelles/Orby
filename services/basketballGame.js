import { PartyRoomError } from "./partyRoomService.js";
import { GameModule, scorePartyPlacements } from "./gameModule.js";

const GAME_DURATION_MS = 90_000;
const MIN_BASKET_INTERVAL_MS = 750;
const GRAVITY = 2.2;
const SHOT_HORIZONTAL_SCALE = 4.5;
const SHOT_VERTICAL_BASE_SPEED = 0.9;
const SHOT_VERTICAL_PULL_SCALE = 2.7;
const START_Y = 0.79;
const HOOP_X = 0.5;
const HOOP_Y = 0.35;
const HOOP_RADIUS = 0.044;
const BALL_RADIUS_IN_HEIGHTS = 0.028;
const serializeId = value => String(value);

export function simulateBasketballShot({ startX, pullX, pullY, aspectRatio }) {
  const initialVerticalSpeed = SHOT_VERTICAL_BASE_SPEED + pullY * SHOT_VERTICAL_PULL_SCALE;
  const heightToHoop = START_Y - HOOP_Y;
  const discriminant = initialVerticalSpeed ** 2 - 2 * GRAVITY * heightToHoop;
  const canReachHoop = discriminant >= 0;
  const hoopCrossingTime = canReachHoop
    ? (initialVerticalSpeed + Math.sqrt(discriminant)) / GRAVITY
    : null;
  const flightTime = hoopCrossingTime ?? (2 * initialVerticalSpeed / GRAVITY);
  const hoopXAtCrossing = canReachHoop
    ? startX - pullX * SHOT_HORIZONTAL_SCALE * flightTime / aspectRatio
    : null;
  const peakY = START_Y - initialVerticalSpeed ** 2 / (2 * GRAVITY);
  const horizontalTolerance = Math.max(
    0,
    HOOP_RADIUS - BALL_RADIUS_IN_HEIGHTS / aspectRatio
  );

  return {
    flightTime,
    initialVerticalSpeed,
    horizontalSpeed: -pullX * SHOT_HORIZONTAL_SCALE,
    hoopXAtCrossing,
    peakY,
    scored: canReachHoop &&
      peakY >= 0.16 &&
      Math.abs(hoopXAtCrossing - HOOP_X) <= horizontalTolerance
  };
}

export class BasketballGameModule extends GameModule {
  constructor() {
    super({ id: "basketball", name: "Cesta Certa" });
  }

  async start({ participants, now = () => new Date() }) {
    const startedAt = now();
    return {
      mode: this.id,
      startedAt,
      endsAt: new Date(startedAt.getTime() + GAME_DURATION_MS),
      gameOver: false,
      shotSequence: 0,
      lastShot: null,
      players: participants.map(participant => ({
        userId: serializeId(participant.userId),
        username: participant.username,
        baskets: 0,
        lastShotAt: null
      }))
    };
  }

  async handleAction(
    { participant, state, serverAction = false, now = () => new Date() },
    { action, payload }
  ) {
    if (!state || state.mode !== this.id || state.gameOver) {
      throw new PartyRoomError("Cesta Certa não está recebendo ações.", 409);
    }

    const currentTime = now();
    if (action === "timeout") {
      if (!serverAction) throw new PartyRoomError("Ação de tempo limite reservada ao servidor.", 403);
      if (new Date(state.endsAt).getTime() > currentTime.getTime()) {
        throw new PartyRoomError("A partida ainda não chegou ao limite de tempo.", 409);
      }
      state.gameOver = true;
      return { state, update: this.getClientState({ state }), finished: true };
    }

    if (action !== "shoot" || serverAction) {
      throw new PartyRoomError("Ação inválida para Cesta Certa.");
    }
    if (new Date(state.endsAt).getTime() <= currentTime.getTime()) {
      throw new PartyRoomError("O tempo da partida acabou.", 409);
    }

    const userId = serializeId(participant.userId);
    const player = state.players.find(candidate => candidate.userId === userId);
    if (!player) throw new PartyRoomError("Você não participa desta partida.", 403);
    if (action === "shoot") {
      const { startX, pullX, pullY, aspectRatio } = payload || {};
      if (!Number.isFinite(startX) || startX < 0.12 || startX > 0.88 ||
          !Number.isFinite(pullX) || !Number.isFinite(pullY) ||
          pullY < 0 || Math.hypot(pullX, pullY) > 0.341 ||
          !Number.isFinite(aspectRatio) || aspectRatio < 1 || aspectRatio > 3) {
        throw new PartyRoomError("Dados do arremesso inválidos.");
      }
      if (player.lastShotAt &&
          currentTime.getTime() - new Date(player.lastShotAt).getTime() < MIN_BASKET_INTERVAL_MS) {
        throw new PartyRoomError("Aguarde antes de arremessar novamente.", 429);
      }

      const shot = simulateBasketballShot({ startX, pullX, pullY, aspectRatio });
      player.lastShotAt = currentTime;
      state.shotSequence += 1;
      state.lastShot = {
        sequence: state.shotSequence,
        userId,
        username: player.username,
        scored: shot.scored
      };
      if (shot.scored) {
        player.baskets += 1;
      }
      return { state, update: this.getClientState({ state }) };
    }
  }

  async handlePlayerLeave({ state, userId }) {
    state.players = state.players.filter(player => player.userId !== serializeId(userId));
    return state;
  }

  getScheduledAction({ state }) {
    if (!state || state.gameOver || !state.endsAt) return null;
    return { action: "timeout", at: state.endsAt };
  }

  getClientState({ state }) {
    if (!state || state.mode !== this.id || !Array.isArray(state.players)) return null;
    return {
      mode: this.id,
      startedAt: state.startedAt,
      endsAt: state.endsAt,
      gameOver: state.gameOver,
      lastShot: state.lastShot,
      players: state.players.map(({ userId, username, baskets }) => ({ userId, username, baskets }))
    };
  }

  async finish({ state }) {
    if (!state?.gameOver) throw new PartyRoomError("A partida de Cesta Certa ainda não terminou.", 409);
    return { baskets: state.players.reduce((sum, player) => sum + player.baskets, 0) };
  }

  async calculateScores({ participants, state }) {
    const players = [...(state?.players || [])]
      .sort((left, right) => right.baskets - left.baskets);
    const placementGroups = [];
    for (let index = 0; index < players.length;) {
      const baskets = players[index].baskets;
      const tiedPlayers = [];
      while (index < players.length && players[index].baskets === baskets) {
        tiedPlayers.push(players[index].userId);
        index += 1;
      }
      placementGroups.push(tiedPlayers);
    }
    return scorePartyPlacements(participants, placementGroups);
  }
}

export const BASKETBALL_TIMINGS = Object.freeze({
  gameDurationMs: GAME_DURATION_MS,
  minBasketIntervalMs: MIN_BASKET_INTERVAL_MS
});
