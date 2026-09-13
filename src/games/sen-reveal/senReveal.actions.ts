import { z } from "zod";
import { failure, Result, success } from "../../models/result";
import { defineGameAction, GameAction, GameContext, GameTransition } from "../gameModule";
import { addPlayerToCircle, createTurnCircle, pickNextActive, removePlayerFromCircle } from "../shared/turnRotation";
import {
  HISTORY_LIMIT,
  MAX_ANSWER_LENGTH_LIMIT,
  MAX_QUESTION_LENGTH,
  SenRevealRound,
  SenRevealScore,
  SenRevealSettings,
  SenRevealState,
} from "./senReveal.state";

type Ctx = GameContext<SenRevealSettings>;
type TransitionResult = Result<GameTransition<SenRevealState>>;

const action = <TPayload>(
  schema: z.ZodType<TPayload>,
  handle: (ctx: Ctx, state: SenRevealState, payload: TPayload) => TransitionResult
) => defineGameAction<SenRevealState, SenRevealSettings, TPayload>(schema, handle);

const transition = (state: SenRevealState): TransitionResult => success({ state });
const paused = (): TransitionResult => failure("The game is paused until more players join", "conflict");

export function getAnsweredPlayerIds(round: SenRevealRound): string[] {
  return round.eligiblePlayerIds.filter((id) => Object.hasOwn(round.answers, id));
}

function addToScore(
  scoreboard: Record<string, SenRevealScore>,
  playerId: string,
  change: Partial<SenRevealScore>
): Record<string, SenRevealScore> {
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

function pause(state: SenRevealState): SenRevealState {
  return { ...state, round: null, pausedReason: "not-enough-players" };
}

/** Rotates to the next active player and starts a fresh round, or pauses if there aren't enough players. */
export function startNextRound(state: SenRevealState, ctx: Ctx): SenRevealState {
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
      answers: {},
      startedAt: ctx.now.toISOString(),
      revealedAt: null,
      winnerId: null,
      loserId: null,
      resolvedAt: null,
    },
  };
}

export function createInitialState(ctx: Ctx): Result<SenRevealState> {
  if (ctx.activePlayers.length < ctx.settings.minPlayers) {
    return failure(`At least ${ctx.settings.minPlayers} players are needed to start`, "conflict");
  }
  const initial: SenRevealState = {
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

export const senRevealActions: Record<string, GameAction<SenRevealState, SenRevealSettings>> = {
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

  submitAnswer: action(
    z.object({ value: z.string().trim().min(1, "Answer must not be empty").max(MAX_ANSWER_LENGTH_LIMIT) }),
    (ctx, state, { value }) => {
      const round = state.round;
      if (!round) return paused();
      if (round.activePlayerId === ctx.actorId) {
        return failure("The active player does not answer", "forbidden");
      }
      if (!round.eligiblePlayerIds.includes(ctx.actorId)) {
        return failure("You are not answering in this round", "forbidden");
      }
      if (round.phase !== "answering") {
        return failure("Answers are already revealed", "conflict");
      }
      if (value.length > ctx.settings.maxAnswerLength) {
        return failure(`Answer must be at most ${ctx.settings.maxAnswerLength} characters`, "bad-request");
      }
      const answers = { ...round.answers, [ctx.actorId]: { value, submittedAt: ctx.now.toISOString() } };
      return transition({ ...state, round: { ...round, answers } });
    }
  ),

  reveal: action(z.object({ force: z.boolean().optional() }), (ctx, state, { force }) => {
    const round = state.round;
    if (!round) return paused();
    if (round.activePlayerId !== ctx.actorId) {
      return failure("Only the active player can reveal the answers", "forbidden");
    }
    if (round.phase !== "answering") {
      return failure("Answers are already revealed", "conflict");
    }
    const answered = getAnsweredPlayerIds(round);
    if (answered.length === 0) {
      return failure("Nobody has answered yet", "conflict");
    }
    if (!force && answered.length < round.eligiblePlayerIds.length) {
      return failure("Not everybody has answered yet", "conflict");
    }
    return transition({ ...state, round: { ...round, phase: "revealed", revealedAt: ctx.now.toISOString() } });
  }),

  pickResult: action(
    z.object({ winnerId: z.string().min(1), loserId: z.string().min(1).nullable().optional() }),
    (ctx, state, payload) => {
      const round = state.round;
      if (!round) return paused();
      if (round.activePlayerId !== ctx.actorId) {
        return failure("Only the active player can pick the winner and the loser", "forbidden");
      }
      if (round.phase === "answering") {
        return failure("Answers are not revealed yet", "conflict");
      }
      if (round.phase === "resolved") {
        return failure("The result has already been picked", "conflict");
      }

      const answered = getAnsweredPlayerIds(round);
      const winnerId = payload.winnerId;
      const loserId = payload.loserId ?? null;
      if (!answered.includes(winnerId)) {
        return failure("The winner must be a player who answered", "bad-request");
      }
      if (loserId === null && answered.length !== 1) {
        return failure("A loser must be picked when more than one player answered", "bad-request");
      }
      if (loserId !== null && !answered.includes(loserId)) {
        return failure("The loser must be a player who answered", "bad-request");
      }
      if (loserId === winnerId) {
        return failure("The winner and the loser must be different players", "bad-request");
      }

      const resolvedAt = ctx.now.toISOString();
      let scoreboard = addToScore(state.scoreboard, winnerId, { wins: 1 });
      if (loserId !== null) {
        scoreboard = addToScore(scoreboard, loserId, { losses: 1 });
      }
      const result = {
        roundNumber: round.number,
        activePlayerId: round.activePlayerId,
        question: round.question,
        answers: Object.fromEntries(answered.map((id) => [id, round.answers[id].value])),
        winnerId,
        loserId,
        resolvedAt,
      };
      return transition({
        ...state,
        scoreboard,
        history: [...state.history, result].slice(-HISTORY_LIMIT),
        round: { ...round, phase: "resolved", winnerId, loserId, resolvedAt },
      });
    }
  ),

  nextRound: action(z.object({}), (ctx, state) => {
    const round = state.round;
    if (!round) return paused();
    if (round.activePlayerId !== ctx.actorId) {
      return failure("Only the active player can start the next round", "forbidden");
    }
    if (round.phase !== "resolved") {
      return failure("Pick the winner and the loser first", "conflict");
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

export function onPlayerJoined(ctx: Ctx, state: SenRevealState, playerId: string): SenRevealState {
  const next: SenRevealState = {
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

export function onPlayerRemoved(ctx: Ctx, state: SenRevealState, playerId: string): GameTransition<SenRevealState> {
  const next: SenRevealState = { ...state, circle: removePlayerFromCircle(state.circle, playerId) };
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

  const { [playerId]: _dropped, ...answers } = round.answers;
  const updatedRound: SenRevealRound = {
    ...round,
    eligiblePlayerIds: round.eligiblePlayerIds.filter((id) => id !== playerId),
    answers,
  };
  if (updatedRound.phase === "revealed" && getAnsweredPlayerIds(updatedRound).length === 0) {
    // nothing left to pick from
    return { state: startNextRound(next, ctx) };
  }
  return { state: { ...next, round: updatedRound } };
}
