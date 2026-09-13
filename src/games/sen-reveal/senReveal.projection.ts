import { GameContext } from "../gameModule";
import { getAnsweredPlayerIds } from "./senReveal.actions";
import { SenRevealPhase, SenRevealRound, SenRevealSettings, SenRevealState } from "./senReveal.state";

export interface SenRevealScoreView {
  playerId: string;
  wins: number;
  losses: number;
  turns: number;
}

export interface SenRevealRoundView {
  number: number;
  activePlayerId: string;
  phase: SenRevealPhase;
  /** null → show the placeholder ("<nickname> asks the question out loud"). */
  question: string | null;
  eligiblePlayerIds: string[];
  answeredPlayerIds: string[];
  /** The viewer's own answer (never anyone else's before the reveal). */
  myAnswer: string | null;
  /** All answers, only after the reveal. */
  answers: { playerId: string; value: string }[] | null;
  winnerId: string | null;
  loserId: string | null;
  startedAt: string;
  revealedAt: string | null;
  resolvedAt: string | null;
  canSetQuestion: boolean;
  canSubmitAnswer: boolean;
  canReveal: boolean;
  canForceReveal: boolean;
  canPickResult: boolean;
  canGoNext: boolean;
}

export interface SenRevealView {
  circle: { number: number };
  pausedReason: SenRevealState["pausedReason"];
  round: SenRevealRoundView | null;
  /** Active players, in join order. */
  scoreboard: SenRevealScoreView[];
  canSkipRound: boolean;
}

/** Whitelist-based per-viewer projection. Field order is fixed so the JSON (and ETag) is deterministic. */
export function projectSenReveal(state: SenRevealState, viewerId: string, ctx: GameContext<SenRevealSettings>): SenRevealView {
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

function projectRound(round: SenRevealRound, viewerId: string, inProgress: boolean): SenRevealRoundView {
  const answered = getAnsweredPlayerIds(round);
  const isActive = inProgress && round.activePlayerId === viewerId;
  const answering = round.phase === "answering";
  const resolved = round.phase === "resolved";
  const allAnswered = answered.length === round.eligiblePlayerIds.length;

  return {
    number: round.number,
    activePlayerId: round.activePlayerId,
    phase: round.phase,
    question: round.question,
    eligiblePlayerIds: [...round.eligiblePlayerIds],
    answeredPlayerIds: answered,
    myAnswer: Object.hasOwn(round.answers, viewerId) ? round.answers[viewerId].value : null,
    answers: answering ? null : answered.map((playerId) => ({ playerId, value: round.answers[playerId].value })),
    winnerId: resolved ? round.winnerId : null,
    loserId: resolved ? round.loserId : null,
    startedAt: round.startedAt,
    revealedAt: round.revealedAt,
    resolvedAt: round.resolvedAt,
    canSetQuestion: isActive && answering,
    canSubmitAnswer: inProgress && answering && round.eligiblePlayerIds.includes(viewerId),
    canReveal: isActive && answering && answered.length > 0 && allAnswered,
    canForceReveal: isActive && answering && answered.length > 0,
    canPickResult: isActive && round.phase === "revealed",
    canGoNext: isActive && resolved,
  };
}
