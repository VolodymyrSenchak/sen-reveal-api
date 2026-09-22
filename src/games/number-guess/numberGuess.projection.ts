import { GameContext } from "../gameModule";
import { getGuessedPlayerIds } from "./numberGuess.actions";
import {
  distanceBetween,
  NumberGuessPhase,
  NumberGuessRound,
  NumberGuessSettings,
  NumberGuessState,
} from "./numberGuess.state";

export interface NumberGuessScoreView {
  playerId: string;
  wins: number;
  losses: number;
  turns: number;
}

export interface NumberGuessGuessView {
  playerId: string;
  value: number;
  /** How far off, once the right answer is in. null before that. */
  distance: number | null;
}

export interface NumberGuessRoundView {
  number: number;
  activePlayerId: string;
  phase: NumberGuessPhase;
  /** null → show the placeholder ("<nickname> asks the question out loud"). */
  question: string | null;
  eligiblePlayerIds: string[];
  answeredPlayerIds: string[];
  /** The viewer's own guess (never anyone else's before the reveal). */
  myGuess: number | null;
  /** All guesses, only after the reveal. */
  guesses: NumberGuessGuessView[] | null;
  /** The number everybody was aiming at. Only once the round is resolved. */
  correctAnswer: number | null;
  /** Closest to the answer — several when they tie. */
  winnerIds: string[];
  /** Furthest from the answer. Empty when every guess is equally close. */
  loserIds: string[];
  startedAt: string;
  revealedAt: string | null;
  resolvedAt: string | null;
  canSetQuestion: boolean;
  canSubmitAnswer: boolean;
  canReveal: boolean;
  canForceReveal: boolean;
  canSetCorrectAnswer: boolean;
  canGoNext: boolean;
}

export interface NumberGuessView {
  circle: { number: number };
  pausedReason: NumberGuessState["pausedReason"];
  round: NumberGuessRoundView | null;
  /** Active players, in join order. */
  scoreboard: NumberGuessScoreView[];
  canSkipRound: boolean;
}

/** Whitelist-based per-viewer projection. Field order is fixed so the JSON (and ETag) is deterministic. */
export function projectNumberGuess(
  state: NumberGuessState,
  viewerId: string,
  ctx: GameContext<NumberGuessSettings>
): NumberGuessView {
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

function projectRound(round: NumberGuessRound, viewerId: string, inProgress: boolean): NumberGuessRoundView {
  const guessed = getGuessedPlayerIds(round);
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
          return { playerId, value, distance: correctAnswer === null ? null : distanceBetween(value, correctAnswer) };
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
