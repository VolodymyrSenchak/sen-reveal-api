"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectNumberGuess = projectNumberGuess;
const numberGuess_actions_1 = require("./numberGuess.actions");
const numberGuess_state_1 = require("./numberGuess.state");
/** Whitelist-based per-viewer projection. Field order is fixed so the JSON (and ETag) is deterministic. */
function projectNumberGuess(state, viewerId, ctx) {
    const inProgress = ctx.status === "in_progress";
    return {
        circle: { number: state.circle.number },
        pausedReason: state.pausedReason,
        round: state.round ? projectRound(state.round, viewerId, inProgress) : null,
        scoreboard: ctx.activePlayers.map((player) => {
            const score = state.scoreboard[player.id];
            return { playerId: player.id, wins: score?.wins ?? 0, losses: score?.losses ?? 0, turns: score?.turns ?? 0 };
        }),
        canSkipRound: inProgress && state.round !== null && viewerId === ctx.hostPlayerId,
    };
}
function projectRound(round, viewerId, inProgress) {
    const guessed = (0, numberGuess_actions_1.getGuessedPlayerIds)(round);
    const isActive = inProgress && round.activePlayerId === viewerId;
    const answering = round.phase === "answering";
    const resolved = round.phase === "resolved";
    const allGuessed = guessed.length === round.eligiblePlayerIds.length;
    const correctAnswer = resolved ? round.correctAnswer : null;
    return {
        number: round.number,
        activePlayerId: round.activePlayerId,
        phase: round.phase,
        question: round.question,
        eligiblePlayerIds: [...round.eligiblePlayerIds],
        answeredPlayerIds: guessed,
        myGuess: Object.hasOwn(round.guesses, viewerId) ? round.guesses[viewerId].value : null,
        guesses: answering
            ? null
            : guessed.map((playerId) => {
                const value = round.guesses[playerId].value;
                return { playerId, value, distance: correctAnswer === null ? null : (0, numberGuess_state_1.distanceBetween)(value, correctAnswer) };
            }),
        correctAnswer,
        winnerIds: resolved ? [...round.winnerIds] : [],
        loserIds: resolved ? [...round.loserIds] : [],
        startedAt: round.startedAt,
        revealedAt: round.revealedAt,
        resolvedAt: round.resolvedAt,
        canSetQuestion: isActive && answering,
        canSubmitAnswer: inProgress && answering && round.eligiblePlayerIds.includes(viewerId),
        canReveal: isActive && answering && guessed.length > 0 && allGuessed,
        canForceReveal: isActive && answering && guessed.length > 0,
        canSetCorrectAnswer: isActive && round.phase === "revealed",
        canGoNext: isActive && resolved,
    };
}
//# sourceMappingURL=numberGuess.projection.js.map