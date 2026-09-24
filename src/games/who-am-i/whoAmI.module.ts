import { GameModule } from "../gameModule";
import { createInitialState, onPlayerJoined, onPlayerRemoved, whoAmIActions } from "./whoAmI.actions";
import { projectWhoAmI, WhoAmIView } from "./whoAmI.projection";
import {
  defaultWhoAmISettings,
  WHO_AM_I_GAME_TYPE,
  WhoAmISettings,
  whoAmISettingsSchema,
  WhoAmIState,
} from "./whoAmI.state";

export const whoAmIModule: GameModule<WhoAmIState, WhoAmISettings, WhoAmIView> = {
  type: WHO_AM_I_GAME_TYPE,
  minPlayers: 3,
  maxPlayers: 20,
  settingsSchema: whoAmISettingsSchema,
  defaultSettings: defaultWhoAmISettings,
  createInitialState,
  actions: whoAmIActions,
  onPlayerJoined,
  onPlayerRemoved,
  project: projectWhoAmI,
  getHistory: (state) => state.history,
};
