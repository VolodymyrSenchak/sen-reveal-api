"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.numberGuessActions = void 0;
exports.getGuessedPlayerIds = getGuessedPlayerIds;
exports.resolveGuesses = resolveGuesses;
exports.startNextRound = startNextRound;
exports.createInitialState = createInitialState;
exports.onPlayerJoined = onPlayerJoined;
exports.onPlayerRemoved = onPlayerRemoved;
const zod_1 = require("zod");
const result_1 = require("../../models/result");
const gameModule_1 = require("../gameModule");
const turnRotation_1 = require("../shared/turnRotation");
const numberGuess_state_1 = require("./numberGuess.state");
const action = (schema, handle) => (0, gameModule_1.defineGameAction)(schema, handle);
const transition = (state) => (0, result_1.success)({ state });
const paused = () => (0, result_1.failure)("The game is paused until more players join", "conflict");
function getGuessedPlayerIds(round) {
    return round.eligiblePlayerIds.filter((id) => Object.hasOwn(round.guesses, id));
}
/**
 * The whole point of this game: nobody votes. The closest guess wins, the furthest loses, and
 * everybody tied at either end shares the outcome. When every guess sits the same distance away
 * (a single guess, or a perfectly symmetric spread) they all win and nobody loses — there is no
 * furthest one to single out.
 */
function resolveGuesses(round, correctAnswer) {
    const guessed = getGuessedPlayerIds(round);
    const distances = guessed.map((id) => (0, numberGuess_state_1.distanceBetween)(round.guesses[id].value, correctAnswer));
    const closest = Math.min(...distances);
    const furthest = Math.max(...distances);
    return {
        winnerIds: guessed.filter((_, index) => distances[index] === closest),
        loserIds: closest === furthest ? [] : guessed.filter((_, index) => distances[index] === furthest),
    };
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
            guesses: {},
            startedAt: ctx.now.toISOString(),
            revealedAt: null,
            correctAnswer: null,
            winnerIds: [],
            loserIds: [],
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
exports.numberGuessActions = {
    setQuestion: action(zod_1.z.object({ text: zod_1.z.string().trim().max(numberGuess_state_1.MAX_QUESTION_LENGTH) }), (ctx, state, { text }) => {
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
    submitGuess: action(zod_1.z.object({ value: numberGuess_state_1.guessValueSchema }), (ctx, state, { value }) => {
        const round = state.round;
        if (!round)
            return paused();
        if (round.activePlayerId === ctx.actorId) {
            return (0, result_1.failure)("The active player does not guess", "forbidden");
        }
        if (!round.eligiblePlayerIds.includes(ctx.actorId)) {
            return (0, result_1.failure)("You are not guessing in this round", "forbidden");
        }
        if (round.phase !== "answering") {
            return (0, result_1.failure)("The guesses are already revealed", "conflict");
        }
        const guesses = { ...round.guesses, [ctx.actorId]: { value, submittedAt: ctx.now.toISOString() } };
        return transition({ ...state, round: { ...round, guesses } });
    }),
    reveal: action(zod_1.z.object({ force: zod_1.z.boolean().optional() }), (ctx, state, { force }) => {
        const round = state.round;
        if (!round)
            return paused();
        if (round.activePlayerId !== ctx.actorId) {
            return (0, result_1.failure)("Only the active player can reveal the guesses", "forbidden");
        }
        if (round.phase !== "answering") {
            return (0, result_1.failure)("The guesses are already revealed", "conflict");
        }
        const guessed = getGuessedPlayerIds(round);
        if (guessed.length === 0) {
            return (0, result_1.failure)("Nobody has guessed yet", "conflict");
        }
        if (!force && guessed.length < round.eligiblePlayerIds.length) {
            return (0, result_1.failure)("Not everybody has guessed yet", "conflict");
        }
        return transition({ ...state, round: { ...round, phase: "revealed", revealedAt: ctx.now.toISOString() } });
    }),
    /** The right answer is what resolves the round — there is nothing for the active player to pick. */
    setCorrectAnswer: action(zod_1.z.object({ value: numberGuess_state_1.guessValueSchema }), (ctx, state, { value }) => {
        const round = state.round;
        if (!round)
            return paused();
        if (round.activePlayerId !== ctx.actorId) {
            return (0, result_1.failure)("Only the active player can enter the right answer", "forbidden");
        }
        if (round.phase === "answering") {
            return (0, result_1.failure)("The guesses are not revealed yet", "conflict");
        }
        if (round.phase === "resolved") {
            return (0, result_1.failure)("The right answer has already been entered", "conflict");
        }
        const guessed = getGuessedPlayerIds(round);
        if (guessed.length === 0) {
            return (0, result_1.failure)("Nobody has guessed in this round", "conflict");
        }
        const { winnerIds, loserIds } = resolveGuesses(round, value);
        const resolvedAt = ctx.now.toISOString();
        let scoreboard = state.scoreboard;
        for (const id of winnerIds) {
            scoreboard = addToScore(scoreboard, id, { wins: 1 });
        }
        for (const id of loserIds) {
            scoreboard = addToScore(scoreboard, id, { losses: 1 });
        }
        const result = {
            roundNumber: round.number,
            activePlayerId: round.activePlayerId,
            question: round.question,
            correctAnswer: value,
            guesses: Object.fromEntries(guessed.map((id) => [id, round.guesses[id].value])),
            winnerIds,
            loserIds,
            resolvedAt,
        };
        return transition({
            ...state,
            scoreboard,
            history: [...state.history, result].slice(-numberGuess_state_1.HISTORY_LIMIT),
            round: { ...round, phase: "resolved", correctAnswer: value, winnerIds, loserIds, resolvedAt },
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
            return (0, result_1.failure)("Enter the right answer first", "conflict");
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
    const { [playerId]: _dropped, ...guesses } = round.guesses;
    const updatedRound = {
        ...round,
        eligiblePlayerIds: round.eligiblePlayerIds.filter((id) => id !== playerId),
        guesses,
    };
    if (updatedRound.phase === "revealed" && getGuessedPlayerIds(updatedRound).length === 0) {
        // nothing left to measure the answer against
        return { state: startNextRound(next, ctx) };
    }
    return { state: { ...next, round: updatedRound } };
}
//# sourceMappingURL=numberGuess.actions.js.map