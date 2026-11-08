import { GameModule } from "./gameModule.js";
import { UnoGameModule } from "./unoGame.js";
import { RockPaperScissorsGameModule } from "./rockPaperScissorsGame.js";
import { GarticGameModule } from "./garticGame.js";
import { BasketballGameModule } from "./basketballGame.js";

export { GameModule } from "./gameModule.js";

export class GameManager {
  #modules = new Map();

  register(module) {
    if (!(module instanceof GameModule)) throw new TypeError("Registre uma instância de GameModule.");
    if (this.#modules.has(module.id)) throw new Error(`O jogo "${module.id}" já está registrado.`);
    this.#modules.set(module.id, module);
    return this;
  }

  get(gameId) {
    const module = this.#modules.get(gameId);
    if (!module) throw new Error(`O jogo "${gameId}" não está registrado.`);
    return module;
  }

  has(gameId) {
    return this.#modules.has(gameId);
  }

  list() {
    return Array.from(this.#modules.values(), ({ id, name }) => ({ id, name }));
  }
}

export function createDefaultGameManager() {
  return new GameManager()
    .register(new UnoGameModule())
    .register(new RockPaperScissorsGameModule())
    .register(new GarticGameModule())
    .register(new BasketballGameModule());
}
