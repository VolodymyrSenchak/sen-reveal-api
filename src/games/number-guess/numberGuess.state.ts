import { z } from "zod";
import { TurnCircle } from "../shared/turnRotation";

export const NUMBER_GUESS_GAME_TYPE = "number-guess";
export const HISTORY_LIMIT = 200;
export const MAX_QUESTION_LENGTH = 300;
/**
 * Guesses and the correct answer live in [-GUESS_LIMIT, GUESS_LIMIT]. The bound is what keeps the
 * distance arithmetic exact: the largest distance (2e9) still rounds to DISTANCE_DECIMALS places
 * inside the safe-integer range.
 */
export const GUESS_LIMIT = 1_000_000_000;
/** Distances are rounded to this many places before they are compared, so 0.1 + 0.2 never breaks a tie. */
export const DISTANCE_DECIMALS = 6;

export const numberGuessSettingsSchema = z.object({
  minPlayers: z.number().int().min(3).max(20).default(3),
});

export type NumberGuessSettings = z.output<typeof numberGuessSettingsSchema>;

export const defaultNumberGuessSettings: NumberGuessSettings = { minPlayers: 3 };

/** `z.number()` already rejects NaN and Infinity, so only the range has to be stated. */
export const guessValueSchema = z
  .number()
  .min(-GUESS_LIMIT, `The number must be at least ${-GUESS_LIMIT}`)
  .max(GUESS_LIMIT, `The number must be at most ${GUESS_LIMIT}`);

export type NumberGuessPhase = "answering" | "revealed" | "resolved";

export interface NumberGuessScore {
  wins: number;
  losses: number;
  turns: number;
}

export interface NumberGuessState {
  circle: TurnCircle;
  lastActivePlayerId: string | null;
  /** Round numbers keep increasing across pauses and cancelled rounds. */
  lastRoundNumber: number;
  /** null only when paused. */
  round: NumberGuessRound | null;
  pausedReason: "not-enough-players" | null;
  /** Capped at HISTORY_LIMIT. */
  history: NumberGuessRoundResult[];
  scoreboard: Record<string, NumberGuessScore>;
}

export interface NumberGuessRound {
  number: number;
  activePlayerId: string;
  phase: NumberGuessPhase;
  /** null → the UI shows a placeholder. */
  question: string | null;
  /** Active players at round start minus the active player, plus mid-round joiners. */
  eligiblePlayerIds: string[];
  guesses: Record<string, { value: number; submittedAt: string }>;
  startedAt: string;
  revealedAt: string | null;
  /** The number the active player was after. Known only once the round is resolved. */
  correctAnswer: number | null;
  /** Everybody tied at the smallest distance — the game picks them, not the active player. */
  winnerIds: string[];
  /** Everybody tied at the largest distance. Empty when every guess is equally close. */
  loserIds: string[];
  resolvedAt: string | null;
}

export interface NumberGuessRoundResult {
  roundNumber: number;
  activePlayerId: string;
  question: string | null;
  correctAnswer: number;
  guesses: Record<string, number>;
  winnerIds: string[];
  loserIds: string[];
  resolvedAt: string;
}

/** Rounds to DISTANCE_DECIMALS so that ties are decided on what a player would read on screen. */
export function distanceBetween(guess: number, correctAnswer: number): number {
  const factor = 10 ** DISTANCE_DECIMALS;
  return Math.round(Math.abs(guess - correctAnswer) * factor) / factor;
}
