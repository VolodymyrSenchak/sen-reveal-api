"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nameSchema = exports.defaultWhoAmISettings = exports.whoAmISettingsSchema = exports.MAX_NAME_LENGTH = exports.HISTORY_LIMIT = exports.WHO_AM_I_GAME_TYPE = void 0;
const zod_1 = require("zod");
exports.WHO_AM_I_GAME_TYPE = "who-am-i";
exports.HISTORY_LIMIT = 200;
exports.MAX_NAME_LENGTH = 60;
exports.whoAmISettingsSchema = zod_1.z.object({
    minPlayers: zod_1.z.number().int().min(3).max(20).default(3),
});
exports.defaultWhoAmISettings = { minPlayers: 3 };
exports.nameSchema = zod_1.z
    .string()
    .trim()
    .min(1, "The name can't be empty")
    .max(exports.MAX_NAME_LENGTH, `The name must be at most ${exports.MAX_NAME_LENGTH} characters`);
//# sourceMappingURL=whoAmI.state.js.map