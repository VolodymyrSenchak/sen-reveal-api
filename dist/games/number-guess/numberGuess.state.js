"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.guessValueSchema = exports.defaultNumberGuessSettings = exports.numberGuessSettingsSchema = exports.DISTANCE_DECIMALS = exports.GUESS_LIMIT = exports.MAX_QUESTION_LENGTH = exports.HISTORY_LIMIT = exports.NUMBER_GUESS_GAME_TYPE = void 0;
exports.distanceBetween = distanceBetween;
const zod_1 = require("zod");
exports.NUMBER_GUESS_GAME_TYPE = "number-guess";
exports.HISTORY_LIMIT = 200;
exports.MAX_QUESTION_LENGTH = 300;
/**
 * Guesses and the correct answer live in [-GUESS_LIMIT, GUESS_LIMIT]. The bound is what keeps the
 * distance arithmetic exact: the largest distance (2e9) still rounds to DISTANCE_DECIMALS places
 * inside the safe-integer range.
 */
exports.GUESS_LIMIT = 1_000_000_000;
/** Distances are rounded to this many places before they are compared, so 0.1 + 0.2 never breaks a tie. */
exports.DISTANCE_DECIMALS = 6;
exports.numberGuessSettingsSchema = zod_1.z.object({
    minPlayers: zod_1.z.number().int().min(3).max(20).default(3),
});
exports.defaultNumberGuessSettings = { minPlayers: 3 };
/** `z.number()` already rejects NaN and Infinity, so only the range has to be stated. */
exports.guessValueSchema = zod_1.z
    .number()
    .min(-exports.GUESS_LIMIT, `The number must be at least ${-exports.GUESS_LIMIT}`)
    .max(exports.GUESS_LIMIT, `The number must be at most ${exports.GUESS_LIMIT}`);
/** Rounds to DISTANCE_DECIMALS so that ties are decided on what a player would read on screen. */
function distanceBetween(guess, correctAnswer) {
    const factor = 10 ** exports.DISTANCE_DECIMALS;
    return Math.round(Math.abs(guess - correctAnswer) * factor) / factor;
}
//# sourceMappingURL=numberGuess.state.js.map