export const PARTY_GAME_PLACEMENT_POINTS = Object.freeze([20, 10, 5]);

export function scorePartyPlacements(participants, placementGroups) {
  const pointsByUser = new Map();
  let place = 1;
  for (const group of placementGroups) {
    const points = PARTY_GAME_PLACEMENT_POINTS[place - 1] || 0;
    for (const userId of group) pointsByUser.set(String(userId), points);
    place += group.length;
  }
  return participants.map(participant => ({
    userId: participant.userId,
    points: pointsByUser.get(String(participant.userId)) || 0
  }));
}

export class GameModule {
  constructor({ id, name }) {
    if (!id || !name) throw new TypeError("GameModule exige id e name.");
    this.id = id;
    this.name = name;
  }

  async validateStart() {}

  async start() {
    throw new Error(`O jogo "${this.id}" não implementou start().`);
  }

  async finish() {
    throw new Error(`O jogo "${this.id}" não implementou finish().`);
  }

  async handleAction() {
    throw new Error(`O jogo "${this.id}" não implementou handleAction().`);
  }

  async handlePlayerLeave({ state }) {
    return state;
  }

  getClientState() {
    return null;
  }

  getScheduledAction() {
    return null;
  }

  async calculateScores() {
    throw new Error(`O jogo "${this.id}" não implementou calculateScores().`);
  }

  getResults({ gameResult }) {
    return gameResult?.rankings || [];
  }
}
