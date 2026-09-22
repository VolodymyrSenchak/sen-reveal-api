import { z } from "zod";
import { failure, Result, success } from "../../models/result";
import { defineGameAction, GameAction, GameContext, GameTransition } from "../gameModule";
import { addPlayerToCircle, createTurnCircle, pickNextActive, removePlayerFromCircle } from "../shared/turnRotation";
import {
  distanceBetween,
  guessValueSchema,
  HISTORY_LIMIT,
  MAX_QUESTION_LENGTH,
  NumberGuessRound,
  NumberGuessScore,
  NumberGuessSettings,
  NumberGuessState,
} from "./numberGuess.state";

type Ctx = GameContext<NumberGuessSettings>;
type TransitionResult = Result<GameTransition<NumberGuessState>>;

const action = <TPayload>(
  schema: z.ZodType<TPayload>,
  handle: (ctx: Ctx, state: NumberGuessState, payload: TPayload) => TransitionResult
) => defineGameAction<NumberGuessState, NumberGuessSettings, TPayload>(schema, handle);

const transition = (state: NumberGuessState): TransitionResult => success({ state });
const paused = (): TransitionResult => failure("The game is paused until more players join", "conflict");

export function getGuessedPlayerIds(round: NumberGuessRound): string[] {
  return round.eligiblePlayerIds.filter((id) => Object.hasOwn(round.guesses, id));
}

/**
 * The whole point of this game: nobody votes. The closest guess wins, the furthest loses, and
 * everybody tied at either end shares the outcome. When every guess sits the same distance away
 * (a single guess, or a perfectly symmetric spread) they all win and nobody loses — there is no
 * furthest one to single out.
 */
export function resolveGuesses(
  round: NumberGuessRound,
  correctAnswer: number
): { winnerIds: string[]; loserIds: string[] } {
  const guessed = getGuessedPlayerIds(round);
  const distances = guessed.map((id) => distanceBetween(round.guesses[id].value, correctAnswer));
  const closest = Math.min(...distances);
  const furthest = Math.max(...distances);
  return {
    winnerIds: guessed.filter((_, index) => distances[index] === closest),
    loserIds: closest === furthest ? [] : guessed.filter((_, index) => distances[index] === furthest),
  };
}

function addToScore(
  scoreboard: Record<string, NumberGuessScore>,
  playerId: string,
  change: Partial<NumberGuessScore>
): Record<string, NumberGuessScore> {
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

function pause(state: NumberGuessState): NumberGuessState {
  return { ...state, round: null, pausedReason: "not-enough-players" };
}

/** Rotates to the next active player and starts a fresh round, or pauses if there aren't enough players. */
export function startNextRound(state: NumberGuessState, ctx: Ctx): NumberGuessState {
  const activeIds = ctx.activePlayers.map((player) => player.id);
  if (activeIds.length < ctx.settings.minPlayers) {
    return pause(state);
  }

  const { circle, activePlayerId } = pickNextActive(state.circle, activeIds, state.lastActivePlayerId, ctx.rng);
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

export function createInitialState(ctx: Ctx): Result<NumberGuessState> {
  if (ctx.activePlayers.length < ctx.settings.minPlayers) {
    return failure(`At least ${ctx.settings.minPlayers} players are needed to start`, "conflict");
  }
  const initial: NumberGuessState = {
    circle: createTurnCircle(),
    lastActivePlayerId: null,
    lastRoundNumber: 0,
    round: null,
    pausedReason: null,
    history: [],
    scoreboard: Object.fromEntries(ctx.activePlayers.map((player) => [player.id, { wins: 0, losses: 0, turns: 0 }])),
  };
  return success(startNextRound(initial, ctx));
}

export const numberGuessActions: Record<string, GameAction<NumberGuessState, NumberGuessSettings>> = {
  setQuestion: action(z.object({ text: z.string().trim().max(MAX_QUESTION_LENGTH) }), (ctx, state, { text }) => {
    const round = state.round;
    if (!round) return paused();
    if (round.activePlayerId !== ctx.actorId) {
      return failure("Only the active player can set the question", "forbidden");
    }
    if (round.phase !== "answering") {
      return failure("The question can only be changed before the reveal", "conflict");
    }
    return transition({ ...state, round: { ...round, question: text.length > 0 ? text : null } });
  }),

  submitGuess: action(z.object({ value: guessValueSchema }), (ctx, state, { value }) => {
    const round = state.round;
    if (!round) return paused();
    if (round.activePlayerId === ctx.actorId) {
      return failure("The active player does not guess", "forbidden");
    }
    if (!round.eligiblePlayerIds.includes(ctx.actorId)) {
      return failure("You are not guessing in this round", "forbidden");
    }
    if (round.phase !== "answering") {
      return failure("The guesses are already revealed", "conflict");
    }
    const guesses = { ...round.guesses, [ctx.actorId]: { value, submittedAt: ctx.now.toISOString() } };
    return transition({ ...state, round: { ...round, guesses } });
  }),

  reveal: action(z.object({ force: z.boolean().optional() }), (ctx, state, { force }) => {
    const round = state.round;
    if (!round) return paused();
    if (round.activePlayerId !== ctx.actorId) {
      return failure("Only the active player can reveal the guesses", "forbidden");
    }
    if (round.phase !== "answering") {
      return failure("The guesses are already revealed", "conflict");
    }
    const guessed = getGuessedPlayerIds(round);
    if (guessed.length === 0) {
      return failure("Nobody has guessed yet", "conflict");
    }
    if (!force && guessed.length < round.eligiblePlayerIds.length) {
      return failure("Not everybody has guessed yet", "conflict");
    }
    return transition({ ...state, round: { ...round, phase: "revealed", revealedAt: ctx.now.toISOString() } });
  }),

  /** The right answer is what resolves the round — there is nothing for the active player to pick. */
  setCorrectAnswer: action(z.object({ value: guessValueSchema }), (ctx, state, { value }) => {
    const round = state.round;
    if (!round) return paused();
    if (round.activePlayerId !== ctx.actorId) {
      return failure("Only the active player can enter the right answer", "forbidden");
    }
    if (round.phase === "answering") {
      return failure("The guesses are not revealed yet", "conflict");
    }
    if (round.phase === "resolved") {
      return failure("The right answer has already been entered", "conflict");
    }
    const guessed = getGuessedPlayerIds(round);
    if (guessed.length === 0) {
      return failure("Nobody has guessed in this round", "conflict");
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
      history: [...state.history, result].slice(-HISTORY_LIMIT),
      round: { ...round, phase: "resolved", correctAnswer: value, winnerIds, loserIds, resolvedAt },
    });
  }),

  nextRound: action(z.object({}), (ctx, state) => {
    const round = state.round;
    if (!round) return paused();
    if (round.activePlayerId !== ctx.actorId) {
      return failure("Only the active player can start the next round", "forbidden");
    }
    if (round.phase !== "resolved") {
      return failure("Enter the right answer first", "conflict");
    }
    return transition(startNextRound(state, ctx));
  }),

  /** Host-only escape hatch for an AFK active player. The result of a resolved round is kept. */
  skipRound: action(z.object({}), (ctx, state) => {
    if (ctx.actorId !== ctx.hostPlayerId) {
      return failure("Only the host can skip a round", "forbidden");
    }
    if (!state.round) return paused();
    return transition(startNextRound(state, ctx));
  }),
};

export function onPlayerJoined(ctx: Ctx, state: NumberGuessState, playerId: string): NumberGuessState {
  const next: NumberGuessState = {
    ...state,
    circle: addPlayerToCircle(state.circle, playerId),
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

export function onPlayerRemoved(ctx: Ctx, state: NumberGuessState, playerId: string): GameTransition<NumberGuessState> {
  const next: NumberGuessState = { ...state, circle: removePlayerFromCircle(state.circle, playerId) };
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
  const updatedRound: NumberGuessRound = {
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
