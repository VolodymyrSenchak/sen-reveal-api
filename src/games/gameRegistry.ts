import { AnyGameModule } from "./gameModule";
import { numberGuessModule } from "./number-guess/numberGuess.module";
import { senRevealModule } from "./sen-reveal/senReveal.module";

export class GameRegistry {
  private readonly modules = new Map<string, AnyGameModule>();

  constructor(modules: AnyGameModule[] = []) {
    modules.forEach((module) => this.register(module));
  }

  register(module: AnyGameModule): this {
    if (this.modules.has(module.type)) {
      throw new Error(`Game type '${module.type}' is already registered`);
    }
    this.modules.set(module.type, module);
    return this;
  }

  get(type: string): AnyGameModule | undefined {
    return this.modules.get(type);
  }

  types(): string[] {
    return [...this.modules.keys()];
  }
}

export function createDefaultGameRegistry(): GameRegistry {
  return new GameRegistry([senRevealModule, numberGuessModule]);
}
