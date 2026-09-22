"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.numberGuessModule = void 0;
const numberGuess_actions_1 = require("./numberGuess.actions");
const numberGuess_projection_1 = require("./numberGuess.projection");
const numberGuess_state_1 = require("./numberGuess.state");
exports.numberGuessModule = {
    type: numberGuess_state_1.NUMBER_GUESS_GAME_TYPE,
    minPlayers: 3,
    maxPlayers: 20,
    settingsSchema: numberGuess_state_1.numberGuessSettingsSchema,
    defaultSettings: numberGuess_state_1.defaultNumberGuessSettings,
    createInitialState: numberGuess_actions_1.createInitialState,
    actions: numberGuess_actions_1.numberGuessActions,
    onPlayerJoined: numberGuess_actions_1.onPlayerJoined,
    onPlayerRemoved: numberGuess_actions_1.onPlayerRemoved,
    project: numberGuess_projection_1.projectNumberGuess,
    getHistory: (state) => state.history,
};
//# sourceMappingURL=numberGuess.module.js.map