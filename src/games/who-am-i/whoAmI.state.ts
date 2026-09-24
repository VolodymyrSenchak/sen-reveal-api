import { z } from "zod";

export const WHO_AM_I_GAME_TYPE = "who-am-i";
export const HISTORY_LIMIT = 200;
export const MAX_NAME_LENGTH = 60;

export const whoAmISettingsSchema = z.object({
  minPlayers: z.number().int().min(3).max(20).default(3),
});

export type WhoAmISettings = z.output<typeof whoAmISettingsSchema>;

export const defaultWhoAmISettings: WhoAmISettings = { minPlayers: 3 };

export const nameSchema = z
  .string()
  .trim()
  .min(1, "The name can't be empty")
  .max(MAX_NAME_LENGTH, `The name must be at most ${MAX_NAME_LENGTH} characters`);

/** `playing`: names go in and everybody sees every card but their own. `revealed`: the host flipped them all. */
export type WhoAmIPhase = "playing" | "revealed";

export interface WhoAmIName {
  value: string;
  /** Kept on the name itself: a giver can change when someone leaves mid-round. */
  givenById: string;
  submittedAt: string;
}

export interface WhoAmIRound {
  number: number;
  phase: WhoAmIPhase;
  /** Dealt in at round start, in join order. Mid-round joiners watch until the next round. */
  playerIds: string[];
  /** giverId → targetId. A random single cycle, so nobody names themselves. */
  assignments: Record<string, string>;
  /** targetId → the name stuck on them. Final once given. */
  names: Record<string, WhoAmIName>;
  startedAt: string;
  revealedAt: string | null;
}

export interface WhoAmIState {
  round: WhoAmIRound;
  /** Capped at HISTORY_LIMIT. */
  history: WhoAmIRoundResult[];
}

export interface WhoAmIRoundResult {
  roundNumber: number;
  /** targetId → the name and who gave it. */
  names: Record<string, { name: string; givenById: string }>;
  revealedAt: string;
}
