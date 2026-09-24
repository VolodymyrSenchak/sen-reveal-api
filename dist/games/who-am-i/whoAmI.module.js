"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whoAmIModule = void 0;
const whoAmI_actions_1 = require("./whoAmI.actions");
const whoAmI_projection_1 = require("./whoAmI.projection");
const whoAmI_state_1 = require("./whoAmI.state");
exports.whoAmIModule = {
    type: whoAmI_state_1.WHO_AM_I_GAME_TYPE,
    minPlayers: 3,
    maxPlayers: 20,
    settingsSchema: whoAmI_state_1.whoAmISettingsSchema,
    defaultSettings: whoAmI_state_1.defaultWhoAmISettings,
    createInitialState: whoAmI_actions_1.createInitialState,
    actions: whoAmI_actions_1.whoAmIActions,
    onPlayerJoined: whoAmI_actions_1.onPlayerJoined,
    onPlayerRemoved: whoAmI_actions_1.onPlayerRemoved,
    project: whoAmI_projection_1.projectWhoAmI,
    getHistory: (state) => state.history,
};
//# sourceMappingURL=whoAmI.module.js.map