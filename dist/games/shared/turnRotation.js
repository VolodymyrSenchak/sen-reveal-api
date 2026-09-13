"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTurnCircle = createTurnCircle;
exports.pickNextActive = pickNextActive;
exports.addPlayerToCircle = addPlayerToCircle;
exports.removePlayerFromCircle = removePlayerFromCircle;
function createTurnCircle() {
    return { number: 0, remainingPlayerIds: [], completedPlayerIds: [] };
}
/**
 * Picks the next active player. When the circle is exhausted a new one starts,
 * and the previous active player can't be picked first (no back-to-back turns).
 */
function pickNextActive(circle, activePlayerIds, lastActivePlayerId, rng) {
    if (activePlayerIds.length === 0) {
        throw new Error("No active players to pick from");
    }
    const active = new Set(activePlayerIds);
    let number = circle.number;
    let completed = circle.completedPlayerIds.filter((id) => active.has(id));
    let remaining = circle.remainingPlayerIds.filter((id) => active.has(id));
    let candidates = remaining;
    if (remaining.length === 0) {
        number += 1;
        completed = [];
        remaining = [...activePlayerIds];
        candidates = remaining.length > 1 && lastActivePlayerId !== null
            ? remaining.filter((id) => id !== lastActivePlayerId)
            : remaining;
    }
    const activePlayerId = rng.pick(candidates);
    return {
        activePlayerId,
        circle: {
            number,
            remainingPlayerIds: remaining.filter((id) => id !== activePlayerId),
            completedPlayerIds: [...completed, activePlayerId],
        },
    };
}
/** A player who joins mid-game gets a turn in the current circle. */
function addPlayerToCircle(circle, playerId) {
    if (circle.remainingPlayerIds.includes(playerId) || circle.completedPlayerIds.includes(playerId)) {
        return circle;
    }
    return { ...circle, remainingPlayerIds: [...circle.remainingPlayerIds, playerId] };
}
function removePlayerFromCircle(circle, playerId) {
    return {
        ...circle,
        remainingPlayerIds: circle.remainingPlayerIds.filter((id) => id !== playerId),
        completedPlayerIds: circle.completedPlayerIds.filter((id) => id !== playerId),
    };
}
//# sourceMappingURL=turnRotation.js.map