"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultSenRevealSettings = exports.senRevealSettingsSchema = exports.MAX_ANSWER_LENGTH_LIMIT = exports.MAX_QUESTION_LENGTH = exports.HISTORY_LIMIT = exports.SEN_REVEAL_GAME_TYPE = void 0;
const zod_1 = require("zod");
exports.SEN_REVEAL_GAME_TYPE = "sen-reveal";
exports.HISTORY_LIMIT = 200;
exports.MAX_QUESTION_LENGTH = 300;
/** Upper bound for the `maxAnswerLength` setting. */
exports.MAX_ANSWER_LENGTH_LIMIT = 500;
exports.senRevealSettingsSchema = zod_1.z.object({
    minPlayers: zod_1.z.number().int().min(3).max(20).default(3),
    maxAnswerLength: zod_1.z.number().int().min(1).max(exports.MAX_ANSWER_LENGTH_LIMIT).default(200),
});
exports.defaultSenRevealSettings = { minPlayers: 3, maxAnswerLength: 200 };
//# sourceMappingURL=senReveal.state.js.map