"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectWhoAmI = projectWhoAmI;
const whoAmI_actions_1 = require("./whoAmI.actions");
/** Whitelist-based per-viewer projection. Field order is fixed so the JSON (and ETag) is deterministic. */
function projectWhoAmI(state, viewerId, ctx) {
    return { round: projectRound(state.round, viewerId, ctx) };
}
function projectRound(round, viewerId, ctx) {
    const inProgress = ctx.status === "in_progress";
    const isHost = inProgress && viewerId === ctx.hostPlayerId;
    const revealed = round.phase === "revealed";
    const giverIds = (0, whoAmI_actions_1.getGiverIds)(round);
    const myTargetId = round.assignments[viewerId] ?? null;
    const hasGiven = (0, whoAmI_actions_1.hasGivenName)(round, viewerId);
    // Whoever still owes a name sees only their own target, so nobody's pick is shaped by the table.
    const seesTable = revealed || myTargetId === null || hasGiven;
    return {
        number: round.number,
        phase: round.phase,
        playerIds: [...round.playerIds],
        eligiblePlayerIds: giverIds,
        answeredPlayerIds: giverIds.filter((id) => (0, whoAmI_actions_1.hasGivenName)(round, id)),
        isPlaying: round.playerIds.includes(viewerId),
        myTargetId,
        myGivenName: hasGiven ? round.names[myTargetId].value : null,
        cards: seesTable
            ? round.playerIds.map((playerId) => {
                const isMine = playerId === viewerId;
                const name = Object.hasOwn(round.names, playerId) && (revealed || !isMine) ? round.names[playerId] : null;
                return { playerId, name: name?.value ?? null, givenById: name?.givenById ?? null, isMine };
            })
            : null,
        startedAt: round.startedAt,
        revealedAt: round.revealedAt,
        canSubmitName: inProgress && !revealed && myTargetId !== null && !hasGiven,
        canReveal: isHost && !revealed,
        canStartNextRound: isHost && revealed && ctx.activePlayers.length >= ctx.settings.minPlayers,
    };
}
//# sourceMappingURL=whoAmI.projection.js.map