"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whoAmIActions = void 0;
exports.dealRound = dealRound;
exports.getGiverIds = getGiverIds;
exports.hasGivenName = hasGivenName;
exports.createInitialState = createInitialState;
exports.onPlayerJoined = onPlayerJoined;
exports.onPlayerRemoved = onPlayerRemoved;
const zod_1 = require("zod");
const result_1 = require("../../models/result");
const gameModule_1 = require("../gameModule");
const whoAmI_state_1 = require("./whoAmI.state");
const action = (schema, handle) => (0, gameModule_1.defineGameAction)(schema, handle);
const transition = (state) => (0, result_1.success)({ state });
const notEnoughPlayers = (ctx) => (0, result_1.failure)(`At least ${ctx.settings.minPlayers} players are needed for a round`, "conflict");
function shuffle(items, rng) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}
/**
 * Seats everybody in a random circle and has each player name the next one. A single cycle is a
 * derangement (nobody names themselves), and it keeps the chain intact when someone leaves:
 * giver → leaver → target simply becomes giver → target.
 */
function dealRound(number, ctx) {
    const playerIds = ctx.activePlayers.map((player) => player.id);
    const circle = shuffle(playerIds, ctx.rng);
    const nextInCircle = new Map(circle.map((id, index) => [id, circle[(index + 1) % circle.length]]));
    return {
        number,
        phase: "playing",
        playerIds,
        assignments: Object.fromEntries(playerIds.map((id) => [id, nextInCircle.get(id)])),
        names: {},
        startedAt: ctx.now.toISOString(),
        revealedAt: null,
    };
}
/** Players who still have somebody to name, in seat order. */
function getGiverIds(round) {
    return round.playerIds.filter((id) => Object.hasOwn(round.assignments, id));
}
function hasGivenName(round, giverId) {
    const targetId = round.assignments[giverId];
    return targetId !== undefined && Object.hasOwn(round.names, targetId);
}
function createInitialState(ctx) {
    if (ctx.activePlayers.length < ctx.settings.minPlayers) {
        return (0, result_1.failure)(`At least ${ctx.settings.minPlayers} players are needed to start`, "conflict");
    }
    return (0, result_1.success)({ round: dealRound(1, ctx), history: [] });
}
exports.whoAmIActions = {
    submitName: action(zod_1.z.object({ name: whoAmI_state_1.nameSchema }), (ctx, state, { name }) => {
        const round = state.round;
        if (round.phase !== "playing") {
            return (0, result_1.failure)("The cards are already revealed", "conflict");
        }
        const targetId = round.assignments[ctx.actorId];
        if (targetId === undefined) {
            return (0, result_1.failure)("You have nobody to name this round", "forbidden");
        }
        if (Object.hasOwn(round.names, targetId)) {
            return (0, result_1.failure)("You have already given the name", "conflict");
        }
        const names = { ...round.names, [targetId]: { value: name, givenById: ctx.actorId, submittedAt: ctx.now.toISOString() } };
        return transition({ ...state, round: { ...round, names } });
    }),
    /** Host-only. Names that never came in simply stay blank. */
    reveal: action(zod_1.z.object({}), (ctx, state) => {
        if (ctx.actorId !== ctx.hostPlayerId) {
            return (0, result_1.failure)("Only the host can reveal the cards", "forbidden");
        }
        const round = state.round;
        if (round.phase !== "playing") {
            return (0, result_1.failure)("The cards are already revealed", "conflict");
        }
        const revealedAt = ctx.now.toISOString();
        const result = {
            roundNumber: round.number,
            names: Object.fromEntries(round.playerIds
                .filter((id) => Object.hasOwn(round.names, id))
                .map((id) => [id, { name: round.names[id].value, givenById: round.names[id].givenById }])),
            revealedAt,
        };
        return transition({
            history: [...state.history, result].slice(-whoAmI_state_1.HISTORY_LIMIT),
            round: { ...round, phase: "revealed", revealedAt },
        });
    }),
    /** Host-only, after the reveal: everybody active (latecomers included) is dealt a fresh circle. */
    nextRound: action(zod_1.z.object({}), (ctx, state) => {
        if (ctx.actorId !== ctx.hostPlayerId) {
            return (0, result_1.failure)("Only the host can start the next round", "forbidden");
        }
        if (state.round.phase !== "revealed") {
            return (0, result_1.failure)("Reveal the cards first", "conflict");
        }
        if (ctx.activePlayers.length < ctx.settings.minPlayers) {
            return notEnoughPlayers(ctx);
        }
        return transition({ ...state, round: dealRound(state.round.number + 1, ctx) });
    }),
};
/** Latecomers watch the current round and are dealt in on the next one. */
function onPlayerJoined(_ctx, state) {
    return state;
}
function onPlayerRemoved(_ctx, state, playerId) {
    const round = state.round;
    // a revealed round is only on screen for the record; the leaver's card stays on it
    if (round.phase !== "playing" || !round.playerIds.includes(playerId)) {
        return { state };
    }
    const { [playerId]: targetId, ...assignments } = round.assignments;
    const { [playerId]: _dropped, ...names } = round.names;
    const giverId = Object.keys(assignments).find((id) => assignments[id] === playerId);
    if (giverId !== undefined) {
        delete assignments[giverId];
        // the leaver still owed their target a name: whoever was naming the leaver takes that over
        if (targetId !== undefined && targetId !== giverId && !Object.hasOwn(names, targetId)) {
            assignments[giverId] = targetId;
        }
    }
    return {
        state: {
            ...state,
            round: { ...round, playerIds: round.playerIds.filter((id) => id !== playerId), assignments, names },
        },
    };
}
//# sourceMappingURL=whoAmI.actions.js.map