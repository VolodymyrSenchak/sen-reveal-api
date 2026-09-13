"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.senRevealModule = void 0;
const senReveal_actions_1 = require("./senReveal.actions");
const senReveal_projection_1 = require("./senReveal.projection");
const senReveal_state_1 = require("./senReveal.state");
exports.senRevealModule = {
    type: senReveal_state_1.SEN_REVEAL_GAME_TYPE,
    minPlayers: 3,
    maxPlayers: 20,
    settingsSchema: senReveal_state_1.senRevealSettingsSchema,
    defaultSettings: senReveal_state_1.defaultSenRevealSettings,
    createInitialState: senReveal_actions_1.createInitialState,
    actions: senReveal_actions_1.senRevealActions,
    onPlayerJoined: senReveal_actions_1.onPlayerJoined,
    onPlayerRemoved: senReveal_actions_1.onPlayerRemoved,
    project: senReveal_projection_1.projectSenReveal,
    getHistory: (state) => state.history,
};
//# sourceMappingURL=senReveal.module.js.map