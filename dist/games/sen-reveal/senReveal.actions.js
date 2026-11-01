"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.senRevealActions = void 0;
exports.getAnsweredPlayerIds = getAnsweredPlayerIds;
exports.startNextRound = startNextRound;
exports.createInitialState = createInitialState;
exports.onPlayerJoined = onPlayerJoined;
exports.onPlayerRemoved = onPlayerRemoved;
const zod_1 = require("zod");
const result_1 = require("../../models/result");
const random_1 = require("../../utils/random");
const gameModule_1 = require("../gameModule");
const turnRotation_1 = require("../shared/turnRotation");
const senReveal_state_1 = require("./senReveal.state");
const action = (schema, handle) => (0, gameModule_1.defineGameAction)(schema, handle);
const transition = (state) => (0, result_1.success)({ state });
const paused = () => (0, result_1.failure)("The game is paused until more players join", "conflict");
function getAnsweredPlayerIds(round) {
    return round.eligiblePlayerIds.filter((id) => Object.hasOwn(round.answers, id));
}
/** The loser may only be missing when there was a single answer to pick from. */
function hasCompletePicks(round) {
    return round.winnerId !== null && (round.loserId !== null || getAnsweredPlayerIds(round).length === 1);
}
function addToScore(scoreboard, playerId, change) {
    const current = scoreboard[playerId] ?? { wins: 0, losses: 0, turns: 0 };
    return {
        ...scoreboard,
        [playerId]: {
            wins: current.wins + (change.wins ?? 0),
            losses: current.losses + (change.losses ?? 0),
            turns: current.turns + (change.turns ?? 0),
        },
    };
}
function pause(state) {
    return { ...state, round: null, pausedReason: "not-enough-players" };
}
/** Rotates to the next active player and starts a fresh round, or pauses if there aren't enough players. */
function startNextRound(state, ctx) {
    const activeIds = ctx.activePlayers.map((player) => player.id);
    if (activeIds.length < ctx.settings.minPlayers) {
        return pause(state);
    }
    const { circle, activePlayerId } = (0, turnRotation_1.pickNextActive)(state.circle, activeIds, state.lastActivePlayerId, ctx.rng);
    const number = state.lastRoundNumber + 1;
    return {
        ...state,
        circle,
        lastActivePlayerId: activePlayerId,
        lastRoundNumber: number,
        pausedReason: null,
        scoreboard: addToScore(state.scoreboard, activePlayerId, { turns: 1 }),
        round: {
            number,
            activePlayerId,
            phase: "answering",
            question: null,
            eligiblePlayerIds: activeIds.filter((id) => id !== activePlayerId),
            answers: {},
            startedAt: ctx.now.toISOString(),
            revealedAt: null,
            winnerId: null,
            loserId: null,
            picksSeq: 0,
            namesShown: false,
            resolvedAt: null,
        },
    };
}
function createInitialState(ctx) {
    if (ctx.activePlayers.length < ctx.settings.minPlayers) {
        return (0, result_1.failure)(`At least ${ctx.settings.minPlayers} players are needed to start`, "conflict");
    }
    const initial = {
        circle: (0, turnRotation_1.createTurnCircle)(),
        lastActivePlayerId: null,
        lastRoundNumber: 0,
        round: null,
        pausedReason: null,
        history: [],
        scoreboard: Object.fromEntries(ctx.activePlayers.map((player) => [player.id, { wins: 0, losses: 0, turns: 0 }])),
    };
    return (0, result_1.success)(startNextRound(initial, ctx));
}
exports.senRevealActions = {
    setQuestion: action(zod_1.z.object({ text: zod_1.z.string().trim().max(senReveal_state_1.MAX_QUESTION_LENGTH) }), (ctx, state, { text }) => {
        const round = state.round;
        if (!round)
            return paused();
        if (round.activePlayerId !== ctx.actorId) {
            return (0, result_1.failure)("Only the active player can set the question", "forbidden");
        }
        if (round.phase !== "answering") {
            return (0, result_1.failure)("The question can only be changed before the reveal", "conflict");
        }
        return transition({ ...state, round: { ...round, question: text.length > 0 ? text : null } });
    }),
    submitAnswer: action(zod_1.z.object({ value: zod_1.z.string().trim().min(1, "Answer must not be empty").max(senReveal_state_1.MAX_ANSWER_LENGTH_LIMIT) }), (ctx, state, { value }) => {
        const round = state.round;
        if (!round)
            return paused();
        if (round.activePlayerId === ctx.actorId) {
            return (0, result_1.failure)("The active player does not answer", "forbidden");
        }
        if (!round.eligiblePlayerIds.includes(ctx.actorId)) {
            return (0, result_1.failure)("You are not answering in this round", "forbidden");
        }
        if (round.phase !== "answering") {
            return (0, result_1.failure)("Answers are already revealed", "conflict");
        }
        if (value.length > ctx.settings.maxAnswerLength) {
            return (0, result_1.failure)(`Answer must be at most ${ctx.settings.maxAnswerLength} characters`, "bad-request");
        }
        const answers = { ...round.answers, [ctx.actorId]: { value, submittedAt: ctx.now.toISOString() } };
        return transition({ ...state, round: { ...round, answers } });
    }),
    reveal: action(zod_1.z.object({ force: zod_1.z.boolean().optional() }), (ctx, state, { force }) => {
        const round = state.round;
        if (!round)
            return paused();
        if (round.activePlayerId !== ctx.actorId) {
            return (0, result_1.failure)("Only the active player can reveal the answers", "forbidden");
        }
        if (round.phase !== "answering") {
            return (0, result_1.failure)("Answers are already revealed", "conflict");
        }
        const answered = getAnsweredPlayerIds(round);
        if (answered.length === 0) {
            return (0, result_1.failure)("Nobody has answered yet", "conflict");
        }
        if (!force && answered.length < round.eligiblePlayerIds.length) {
            return (0, result_1.failure)("Not everybody has answered yet", "conflict");
        }
        // answers are listed in this order, and join order would give the authors away
        const eligiblePlayerIds = ctx.settings.blindPicks ? (0, random_1.shuffle)(round.eligiblePlayerIds, ctx.rng) : round.eligiblePlayerIds;
        return transition({ ...state, round: { ...round, eligiblePlayerIds, phase: "revealed", revealedAt: ctx.now.toISOString() } });
    }),
    /** The picks in progress: everyone sees them land on the cards, nothing is scored until `pickResult`. */
    setPicks: action(zod_1.z.object({
        winnerId: zod_1.z.string().min(1).nullable(),
        loserId: zod_1.z.string().min(1).nullable(),
        seq: zod_1.z.number().int().positive(),
    }), (ctx, state, { winnerId, loserId, seq }) => {
        const round = state.round;
        if (!round)
            return paused();
        if (round.activePlayerId !== ctx.actorId) {
            return (0, result_1.failure)("Only the active player can pick the winner and the loser", "forbidden");
        }
        if (seq <= round.picksSeq) {
            // two quick taps can overtake each other (a losing write re-runs); the newer one stands
            return transition(state);
        }
        if (round.phase !== "revealed") {
            return (0, result_1.failure)("Picks can only be changed while the answers are on the table", "conflict");
        }
        if (round.namesShown) {
            return (0, result_1.failure)("The picks are locked once the names are shown", "conflict");
        }
        const answered = getAnsweredPlayerIds(round);
        if ((winnerId !== null && !answered.includes(winnerId)) || (loserId !== null && !answered.includes(loserId))) {
            return (0, result_1.failure)("Picks must be players who answered", "bad-request");
        }
        if (winnerId !== null && winnerId === loserId) {
            return (0, result_1.failure)("The winner and the loser must be different players", "bad-request");
        }
        return transition({ ...state, round: { ...round, winnerId, loserId, picksSeq: seq } });
    }),
    /** Blind picks only: puts the names on the cards for everyone and locks the picks. */
    showNames: action(zod_1.z.object({}), (ctx, state) => {
        const round = state.round;
        if (!round)
            return paused();
        if (round.activePlayerId !== ctx.actorId) {
            return (0, result_1.failure)("Only the active player can show the names", "forbidden");
        }
        if (!ctx.settings.blindPicks) {
            return (0, result_1.failure)("Names are not hidden in this game", "conflict");
        }
        if (round.phase !== "revealed" || round.namesShown) {
            return (0, result_1.failure)("The names are not hidden right now", "conflict");
        }
        if (!hasCompletePicks(round)) {
            return (0, result_1.failure)("Pick the winner and the loser first", "conflict");
        }
        return transition({ ...state, round: { ...round, namesShown: true } });
    }),
    pickResult: action(zod_1.z.object({ winnerId: zod_1.z.string().min(1), loserId: zod_1.z.string().min(1).nullable().optional() }), (ctx, state, payload) => {
        const round = state.round;
        if (!round)
            return paused();
        if (round.activePlayerId !== ctx.actorId) {
            return (0, result_1.failure)("Only the active player can pick the winner and the loser", "forbidden");
        }
        if (round.phase === "answering") {
            return (0, result_1.failure)("Answers are not revealed yet", "conflict");
        }
        if (round.phase === "resolved") {
            return (0, result_1.failure)("The result has already been picked", "conflict");
        }
        if (ctx.settings.blindPicks && !round.namesShown) {
            return (0, result_1.failure)("Show the names first", "conflict");
        }
        const answered = getAnsweredPlayerIds(round);
        const winnerId = payload.winnerId;
        const loserId = payload.loserId ?? null;
        if (round.namesShown && (winnerId !== round.winnerId || loserId !== round.loserId)) {
            return (0, result_1.failure)("The picks are locked once the names are shown", "conflict");
        }
        if (!answered.includes(winnerId)) {
            return (0, result_1.failure)("The winner must be a player who answered", "bad-request");
        }
        if (loserId === null && answered.length !== 1) {
            return (0, result_1.failure)("A loser must be picked when more than one player answered", "bad-request");
        }
        if (loserId !== null && !answered.includes(loserId)) {
            return (0, result_1.failure)("The loser must be a player who answered", "bad-request");
        }
        if (loserId === winnerId) {
            return (0, result_1.failure)("The winner and the loser must be different players", "bad-request");
        }
        const resolvedAt = ctx.now.toISOString();
        let scoreboard = addToScore(state.scoreboard, winnerId, { wins: 1 });
        if (loserId !== null) {
            scoreboard = addToScore(scoreboard, loserId, { losses: 1 });
        }
        const result = {
            roundNumber: round.number,
            activePlayerId: round.activePlayerId,
            question: round.question,
            answers: Object.fromEntries(answered.map((id) => [id, round.answers[id].value])),
            winnerId,
            loserId,
            resolvedAt,
        };
        return transition({
            ...state,
            scoreboard,
            history: [...state.history, result].slice(-senReveal_state_1.HISTORY_LIMIT),
            round: { ...round, phase: "resolved", winnerId, loserId, resolvedAt },
        });
    }),
    nextRound: action(zod_1.z.object({}), (ctx, state) => {
        const round = state.round;
        if (!round)
            return paused();
        if (round.activePlayerId !== ctx.actorId) {
            return (0, result_1.failure)("Only the active player can start the next round", "forbidden");
        }
        if (round.phase !== "resolved") {
            return (0, result_1.failure)("Pick the winner and the loser first", "conflict");
        }
        return transition(startNextRound(state, ctx));
    }),
    /** Host-only escape hatch for an AFK active player. The result of a resolved round is kept. */
    skipRound: action(zod_1.z.object({}), (ctx, state) => {
        if (ctx.actorId !== ctx.hostPlayerId) {
            return (0, result_1.failure)("Only the host can skip a round", "forbidden");
        }
        if (!state.round)
            return paused();
        return transition(startNextRound(state, ctx));
    }),
};
function onPlayerJoined(ctx, state, playerId) {
    const next = {
        ...state,
        circle: (0, turnRotation_1.addPlayerToCircle)(state.circle, playerId),
        scoreboard: state.scoreboard[playerId] ? state.scoreboard : addToScore(state.scoreboard, playerId, {}),
    };
    const round = next.round;
    if (!round) {
        return startNextRound(next, ctx);
    }
    if (round.phase === "answering" && round.activePlayerId !== playerId && !round.eligiblePlayerIds.includes(playerId)) {
        return { ...next, round: { ...round, eligiblePlayerIds: [...round.eligiblePlayerIds, playerId] } };
    }
    return next;
}
function onPlayerRemoved(ctx, state, playerId) {
    const next = { ...state, circle: (0, turnRotation_1.removePlayerFromCircle)(state.circle, playerId) };
    const round = next.round;
    if (!round) {
        return { state: next };
    }
    if (ctx.activePlayers.length < ctx.settings.minPlayers) {
        return { state: pause(next) };
    }
    if (round.activePlayerId === playerId) {
        // answering/revealed: the round is cancelled; resolved: the result is already recorded
        return { state: startNextRound(next, ctx) };
    }
    if (round.phase === "resolved" || !round.eligiblePlayerIds.includes(playerId)) {
        return { state: next };
    }
    const { [playerId]: _dropped, ...answers } = round.answers;
    const lostPick = round.winnerId === playerId || round.loserId === playerId;
    const updatedRound = {
        ...round,
        eligiblePlayerIds: round.eligiblePlayerIds.filter((id) => id !== playerId),
        answers,
        winnerId: round.winnerId === playerId ? null : round.winnerId,
        loserId: round.loserId === playerId ? null : round.loserId,
        // the replacement pick has to be blind as well
        namesShown: round.namesShown && !lostPick,
    };
    if (updatedRound.phase === "revealed" && getAnsweredPlayerIds(updatedRound).length === 0) {
        // nothing left to pick from
        return { state: startNextRound(next, ctx) };
    }
    return { state: { ...next, round: updatedRound } };
}
//# sourceMappingURL=senReveal.actions.js.map