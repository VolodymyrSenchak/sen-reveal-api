"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectSenReveal = projectSenReveal;
const senReveal_actions_1 = require("./senReveal.actions");
/** Whitelist-based per-viewer projection. Field order is fixed so the JSON (and ETag) is deterministic. */
function projectSenReveal(state, viewerId, ctx) {
    const inProgress = ctx.status === "in_progress";
    return {
        circle: { number: state.circle.number },
        pausedReason: state.pausedReason,
        round: state.round ? projectRound(state.round, viewerId, inProgress, ctx.settings.blindPicks) : null,
        scoreboard: ctx.activePlayers.map((player) => {
            const score = state.scoreboard[player.id];
            return { playerId: player.id, wins: score?.wins ?? 0, losses: score?.losses ?? 0, turns: score?.turns ?? 0 };
        }),
        canSkipRound: inProgress && state.round !== null && viewerId === ctx.hostPlayerId,
    };
}
function projectRound(round, viewerId, inProgress, blindPicks) {
    const answered = (0, senReveal_actions_1.getAnsweredPlayerIds)(round);
    const isActive = inProgress && round.activePlayerId === viewerId;
    const answering = round.phase === "answering";
    const revealed = round.phase === "revealed";
    const resolved = round.phase === "resolved";
    const allAnswered = answered.length === round.eligiblePlayerIds.length;
    const namesHidden = revealed && blindPicks && !round.namesShown;
    return {
        number: round.number,
        activePlayerId: round.activePlayerId,
        phase: round.phase,
        question: round.question,
        eligiblePlayerIds: [...round.eligiblePlayerIds],
        answeredPlayerIds: answered,
        myAnswer: Object.hasOwn(round.answers, viewerId) ? round.answers[viewerId].value : null,
        answers: answering ? null : answered.map((playerId) => ({ playerId, value: round.answers[playerId].value })),
        winnerId: round.winnerId,
        loserId: round.loserId,
        picksSeq: round.picksSeq,
        namesHidden,
        picksLocked: revealed && round.namesShown,
        startedAt: round.startedAt,
        revealedAt: round.revealedAt,
        resolvedAt: round.resolvedAt,
        canSetQuestion: isActive && answering,
        canSubmitAnswer: inProgress && answering && round.eligiblePlayerIds.includes(viewerId),
        canReveal: isActive && answering && answered.length > 0 && allAnswered,
        canForceReveal: isActive && answering && answered.length > 0,
        canSetPicks: isActive && revealed && !round.namesShown,
        canShowNames: isActive && namesHidden,
        canPickResult: isActive && revealed && !namesHidden,
        canGoNext: isActive && resolved,
    };
}
//# sourceMappingURL=senReveal.projection.js.map