import { GameModule } from "../gameModule";
import { createInitialState, onPlayerJoined, onPlayerRemoved, senRevealActions } from "./senReveal.actions";
import { projectSenReveal, SenRevealView } from "./senReveal.projection";
import {
  defaultSenRevealSettings,
  SEN_REVEAL_GAME_TYPE,
  SenRevealSettings,
  senRevealSettingsSchema,
  SenRevealState,
} from "./senReveal.state";

export const senRevealModule: GameModule<SenRevealState, SenRevealSettings, SenRevealView> = {
  type: SEN_REVEAL_GAME_TYPE,
  minPlayers: 3,
  maxPlayers: 20,
  settingsSchema: senRevealSettingsSchema,
  defaultSettings: defaultSenRevealSettings,
  createInitialState,
  actions: senRevealActions,
  onPlayerJoined,
  onPlayerRemoved,
  project: projectSenReveal,
  getHistory: (state) => state.history,
};
