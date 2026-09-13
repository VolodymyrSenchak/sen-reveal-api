import { z } from "zod";
import { TurnCircle } from "../shared/turnRotation";

export const SEN_REVEAL_GAME_TYPE = "sen-reveal";
export const HISTORY_LIMIT = 200;
export const MAX_QUESTION_LENGTH = 300;
/** Upper bound for the `maxAnswerLength` setting. */
export const MAX_ANSWER_LENGTH_LIMIT = 500;

export const senRevealSettingsSchema = z.object({
  minPlayers: z.number().int().min(3).max(20).default(3),
  maxAnswerLength: z.number().int().min(1).max(MAX_ANSWER_LENGTH_LIMIT).default(200),
});

export type SenRevealSettings = z.output<typeof senRevealSettingsSchema>;

export const defaultSenRevealSettings: SenRevealSettings = { minPlayers: 3, maxAnswerLength: 200 };

export type SenRevealPhase = "answering" | "revealed" | "resolved";

export interface SenRevealScore {
  wins: number;
  losses: number;
  turns: number;
}

export interface SenRevealState {
  circle: TurnCircle;
  lastActivePlayerId: string | null;
  /** Round numbers keep increasing across pauses and cancelled rounds. */
  lastRoundNumber: number;
  /** null only when paused. */
  round: SenRevealRound | null;
  pausedReason: "not-enough-players" | null;
  /** Capped at HISTORY_LIMIT. */
  history: SenRevealRoundResult[];
  scoreboard: Record<string, SenRevealScore>;
}

export interface SenRevealRound {
  number: number;
  activePlayerId: string;
  phase: SenRevealPhase;
  /** null → the UI shows a placeholder. */
  question: string | null;
  /** Active players at round start minus the active player, plus mid-round joiners. */
  eligiblePlayerIds: string[];
  answers: Record<string, { value: string; submittedAt: string }>;
  startedAt: string;
  revealedAt: string | null;
  winnerId: string | null;
  loserId: string | null;
  resolvedAt: string | null;
}

export interface SenRevealRoundResult {
  roundNumber: number;
  activePlayerId: string;
  question: string | null;
  answers: Record<string, string>;
  winnerId: string;
  loserId: string | null;
  resolvedAt: string;
}
