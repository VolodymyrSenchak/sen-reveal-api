import { GameModule } from "../gameModule";
import { createInitialState, numberGuessActions, onPlayerJoined, onPlayerRemoved } from "./numberGuess.actions";
import { NumberGuessView, projectNumberGuess } from "./numberGuess.projection";
import {
  defaultNumberGuessSettings,
  NUMBER_GUESS_GAME_TYPE,
  NumberGuessSettings,
  numberGuessSettingsSchema,
  NumberGuessState,
} from "./numberGuess.state";

export const numberGuessModule: GameModule<NumberGuessState, NumberGuessSettings, NumberGuessView> = {
  type: NUMBER_GUESS_GAME_TYPE,
  minPlayers: 3,
  maxPlayers: 20,
  settingsSchema: numberGuessSettingsSchema,
  defaultSettings: defaultNumberGuessSettings,
  createInitialState,
  actions: numberGuessActions,
  onPlayerJoined,
  onPlayerRemoved,
  project: projectNumberGuess,
  getHistory: (state) => state.history,
};
