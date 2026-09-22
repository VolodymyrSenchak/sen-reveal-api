import { describe, expect, it } from "vitest";
import { PlayerRecord, Result } from "../../models";
import { createSeededRng, Rng } from "../../utils/random";
import { GameContext, GameTransition } from "../gameModule";
import { numberGuessModule } from "./numberGuess.module";
import { NumberGuessView } from "./numberGuess.projection";
import { GUESS_LIMIT, HISTORY_LIMIT, NumberGuessState } from "./numberGuess.state";

const SETTINGS = { minPlayers: 3, maxPlayers: 20, allowJoinInProgress: true };

function makePlayer(id: string, index: number): PlayerRecord {
  return {
    id,
    nickname: id,
    tokenHash: `hash-${id}`,
    joinedAt: new Date(Date.UTC(2026, 0, 1, 12, 0, index)).toISOString(),
    status: "active",
  };
}

/** Drives the pure module the way the session pipeline does. */
class Game {
  players: PlayerRecord[];
  state: NumberGuessState;
  hostId = "p1";
  private readonly rng: Rng;
  private tick = 0;

  constructor(count: number, seed = 1) {
    this.rng = createSeededRng(seed);
    this.players = Array.from({ length: count }, (_, i) => makePlayer(`p${i + 1}`, i));
    const initial = numberGuessModule.createInitialState(this.ctx(this.hostId));
    if (!initial.isSuccess) throw new Error(String(initial.error));
    this.state = initial.result!;
  }

  ctx(actorId: string): GameContext<typeof SETTINGS> {
    return {
      actorId,
      hostPlayerId: this.hostId,
      activePlayers: this.players,
      settings: SETTINGS,
      status: "in_progress",
      now: new Date(Date.UTC(2026, 0, 1, 13) + this.tick++ * 1000),
      rng: this.rng,
    };
  }

  run(actorId: string, name: string, payload: unknown = {}): Result<GameTransition<NumberGuessState>> {
    const action = numberGuessModule.actions[name];
    const parsed = action.schema.safeParse(payload);
    if (!parsed.success) {
      return { isSuccess: false, errorStatus: "bad-request", error: parsed.error.message };
    }
    const result = action.handle(this.ctx(actorId), this.state, parsed.data);
    if (result.isSuccess) {
      this.state = result.result!.state;
    }
    return result;
  }

  ok(actorId: string, name: string, payload: unknown = {}): NumberGuessState {
    const result = this.run(actorId, name, payload);
    if (!result.isSuccess) throw new Error(`${name} by ${actorId} failed: ${result.error}`);
    return this.state;
  }

  view(viewerId: string): NumberGuessView {
    return numberGuessModule.project(this.state, viewerId, this.ctx(viewerId));
  }

  get round() {
    if (!this.state.round) throw new Error("No round (paused)");
    return this.state.round;
  }

  get activeId() {
    return this.round.activePlayerId;
  }

  get guesserIds() {
    return this.round.eligiblePlayerIds;
  }

  nonHost(except: string[] = []) {
    return this.players.find((player) => player.id !== this.hostId && !except.includes(player.id))!.id;
  }

  /** Guesses 10, 20, 30, … so the first guesser is always the closest to an answer of 10. */
  guessAll() {
    this.guesserIds.forEach((id, index) => this.ok(id, "submitGuess", { value: (index + 1) * 10 }));
  }

  resolveRound(correctAnswer = 10) {
    this.guessAll();
    this.ok(this.activeId, "reveal");
    this.ok(this.activeId, "setCorrectAnswer", { value: correctAnswer });
  }

  join(id: string) {
    this.players = [...this.players, makePlayer(id, this.players.length)];
    this.state = numberGuessModule.onPlayerJoined!(this.ctx(id), this.state, id);
  }

  remove(id: string) {
    this.players = this.players.filter((player) => player.id !== id);
    if (this.hostId === id) this.hostId = this.players[0].id;
    this.state = numberGuessModule.onPlayerRemoved!(this.ctx(this.hostId), this.state, id).state;
  }
}

describe("NumberGuess module", () => {
  it("starts round 1 with a random active player and everyone else eligible", () => {
    const game = new Game(4);
    expect(game.round).toMatchObject({ number: 1, phase: "answering", question: null, guesses: {}, correctAnswer: null });
    expect(game.guesserIds).toHaveLength(3);
    expect(game.guesserIds).not.toContain(game.activeId);
    expect(game.state.circle.number).toBe(1);
    expect(game.state.scoreboard[game.activeId].turns).toBe(1);
  });

  it("refuses to start with fewer than 3 players", () => {
    expect(() => new Game(2)).toThrow(/At least 3 players/);
  });

  it("takes numbers only, inside the allowed range", () => {
    const game = new Game(4);
    const [first] = game.guesserIds;
    expect(game.run(first, "submitGuess", { value: "42" })).toMatchObject({ errorStatus: "bad-request" });
    expect(game.run(first, "submitGuess", { value: Number.NaN })).toMatchObject({ errorStatus: "bad-request" });
    expect(game.run(first, "submitGuess", { value: Number.POSITIVE_INFINITY })).toMatchObject({ errorStatus: "bad-request" });
    expect(game.run(first, "submitGuess", { value: GUESS_LIMIT + 1 })).toMatchObject({ errorStatus: "bad-request" });
    expect(game.run(first, "submitGuess", {})).toMatchObject({ errorStatus: "bad-request" });

    game.ok(first, "submitGuess", { value: -GUESS_LIMIT });
    game.ok(first, "submitGuess", { value: 3.5 });
    expect(game.round.guesses[first].value).toBe(3.5);
  });

  it("hides guesses from everyone before the reveal and shows them to all after", () => {
    const game = new Game(4);
    game.guessAll();
    for (const player of game.players) {
      const round = game.view(player.id).round!;
      expect(round.guesses).toBeNull();
      expect(round.myGuess).toBe(game.guesserIds.includes(player.id) ? game.round.guesses[player.id].value : null);
      expect(round.answeredPlayerIds).toEqual(game.guesserIds);
    }

    game.ok(game.activeId, "reveal");
    for (const player of game.players) {
      expect(game.view(player.id).round!.guesses).toEqual(
        game.guesserIds.map((id, index) => ({ playerId: id, value: (index + 1) * 10, distance: null }))
      );
    }
  });

  it("lets a guesser change their number until the reveal", () => {
    const game = new Game(3);
    const [first] = game.guesserIds;
    game.ok(first, "submitGuess", { value: 1 });
    game.ok(first, "submitGuess", { value: 2 });
    expect(game.round.guesses[first].value).toBe(2);

    expect(game.run(game.activeId, "submitGuess", { value: 5 })).toMatchObject({ errorStatus: "forbidden" });
    expect(game.run("stranger", "submitGuess", { value: 5 })).toMatchObject({ errorStatus: "forbidden" });

    game.guessAll();
    game.ok(game.activeId, "reveal");
    expect(game.run(first, "submitGuess", { value: 3 })).toMatchObject({ errorStatus: "conflict" });
  });

  it("blocks the reveal until all guessed, unless forced with at least one guess", () => {
    const game = new Game(4);
    expect(game.run(game.activeId, "reveal", { force: true })).toMatchObject({ errorStatus: "conflict" });

    game.ok(game.guesserIds[0], "submitGuess", { value: 7 });
    expect(game.view(game.activeId).round).toMatchObject({ canReveal: false, canForceReveal: true });
    expect(game.run(game.activeId, "reveal")).toMatchObject({ errorStatus: "conflict" });
    expect(game.run(game.guesserIds[1], "reveal", { force: true })).toMatchObject({ errorStatus: "forbidden" });

    game.ok(game.activeId, "reveal", { force: true });
    expect(game.round.phase).toBe("revealed");
    expect(game.run(game.activeId, "reveal")).toMatchObject({ errorStatus: "conflict" });
  });

  it("scores the closest as the winner and the furthest as the loser, with no picking", () => {
    const game = new Game(4);
    const [near, middle, far] = game.guesserIds;
    game.ok(near, "submitGuess", { value: 92 });
    game.ok(middle, "submitGuess", { value: 80 });
    game.ok(far, "submitGuess", { value: 10 });
    expect(game.run(game.activeId, "setCorrectAnswer", { value: 90 })).toMatchObject({ errorStatus: "conflict" });

    game.ok(game.activeId, "reveal");
    expect(game.run(near, "setCorrectAnswer", { value: 90 })).toMatchObject({ errorStatus: "forbidden" });
    expect(game.run(game.activeId, "setCorrectAnswer", { value: "90" })).toMatchObject({ errorStatus: "bad-request" });

    game.ok(game.activeId, "setCorrectAnswer", { value: 90 });
    expect(game.round).toMatchObject({ phase: "resolved", correctAnswer: 90, winnerIds: [near], loserIds: [far] });
    expect(game.state.scoreboard[near]).toMatchObject({ wins: 1, losses: 0 });
    expect(game.state.scoreboard[middle]).toMatchObject({ wins: 0, losses: 0 });
    expect(game.state.scoreboard[far]).toMatchObject({ wins: 0, losses: 1 });
    expect(game.view(middle).round!.guesses).toEqual([
      { playerId: near, value: 92, distance: 2 },
      { playerId: middle, value: 80, distance: 10 },
      { playerId: far, value: 10, distance: 80 },
    ]);
    expect(game.state.history[0]).toMatchObject({
      correctAnswer: 90,
      guesses: { [near]: 92, [middle]: 80, [far]: 10 },
      winnerIds: [near],
      loserIds: [far],
    });
    expect(game.run(game.activeId, "setCorrectAnswer", { value: 1 })).toMatchObject({ errorStatus: "conflict" });
  });

  it("shares the win and the loss between everybody who ties", () => {
    const game = new Game(5);
    const [a, b, c, d] = game.guesserIds;
    game.ok(a, "submitGuess", { value: 9 });
    game.ok(b, "submitGuess", { value: 11 });
    game.ok(c, "submitGuess", { value: 50 });
    game.ok(d, "submitGuess", { value: -30 });
    game.ok(game.activeId, "reveal");
    game.ok(game.activeId, "setCorrectAnswer", { value: 10 });

    expect(game.round).toMatchObject({ winnerIds: [a, b], loserIds: [c, d] });
    expect(game.state.scoreboard[a]).toMatchObject({ wins: 1, losses: 0 });
    expect(game.state.scoreboard[b]).toMatchObject({ wins: 1, losses: 0 });
    expect(game.state.scoreboard[c]).toMatchObject({ wins: 0, losses: 1 });
    expect(game.state.scoreboard[d]).toMatchObject({ wins: 0, losses: 1 });
  });

  it("leaves nobody out when every guess is the same distance away", () => {
    const game = new Game(4);
    const [a, b, c] = game.guesserIds;
    game.ok(a, "submitGuess", { value: 5 });
    game.ok(b, "submitGuess", { value: 5 });
    game.ok(c, "submitGuess", { value: 15 });
    game.ok(game.activeId, "reveal");
    game.ok(game.activeId, "setCorrectAnswer", { value: 10 });
    expect(game.round).toMatchObject({ winnerIds: [a, b, c], loserIds: [] });
    expect(Object.values(game.state.scoreboard).every((score) => score.losses === 0)).toBe(true);
  });

  it("gives the single guesser of a forced reveal the win and no loss", () => {
    const game = new Game(4);
    const [only] = game.guesserIds;
    game.ok(only, "submitGuess", { value: 1000 });
    game.ok(game.activeId, "reveal", { force: true });
    game.ok(game.activeId, "setCorrectAnswer", { value: 1 });
    expect(game.round).toMatchObject({ winnerIds: [only], loserIds: [] });
    expect(game.state.history[0]).toMatchObject({ winnerIds: [only], loserIds: [], guesses: { [only]: 1000 } });
  });

  it("decides ties on rounded distances, so decimals do not break them", () => {
    const game = new Game(4);
    const [a, b, c] = game.guesserIds;
    game.ok(a, "submitGuess", { value: 0.3 });
    game.ok(b, "submitGuess", { value: 0.1 + 0.2 });
    game.ok(c, "submitGuess", { value: 1 });
    game.ok(game.activeId, "reveal");
    game.ok(game.activeId, "setCorrectAnswer", { value: 0 });
    expect(game.round).toMatchObject({ winnerIds: [a, b], loserIds: [c] });
  });

  it("treats the question as optional", () => {
    const game = new Game(3);
    expect(game.run(game.guesserIds[0], "setQuestion", { text: "How many?" })).toMatchObject({ errorStatus: "forbidden" });
    expect(game.view(game.activeId).round!.canSetQuestion).toBe(true);
    expect(game.view(game.guesserIds[0]).round!.canSetQuestion).toBe(false);

    game.ok(game.activeId, "setQuestion", { text: "  How many bones in a human body?  " });
    expect(game.view(game.guesserIds[0]).round!.question).toBe("How many bones in a human body?");
    game.ok(game.activeId, "setQuestion", { text: "   " });
    expect(game.round.question).toBeNull();
    expect(game.run(game.activeId, "setQuestion", { text: "x".repeat(301) })).toMatchObject({ errorStatus: "bad-request" });

    game.guessAll();
    game.ok(game.activeId, "reveal");
    expect(game.run(game.activeId, "setQuestion", { text: "Too late" })).toMatchObject({ errorStatus: "conflict" });
  });

  it("makes the answer final and waits for the active player's Next", () => {
    const game = new Game(4);
    game.resolveRound();
    const active = game.activeId;
    const [winnerId] = game.guesserIds;

    for (const player of game.players) {
      expect(game.view(player.id).round).toMatchObject({ phase: "resolved", correctAnswer: 10, winnerIds: [winnerId] });
      expect(game.view(player.id).round!.canGoNext).toBe(player.id === active);
    }
    expect(game.run(winnerId, "nextRound")).toMatchObject({ errorStatus: "forbidden" });
    expect(game.round.number).toBe(1);

    game.ok(active, "nextRound");
    expect(game.round).toMatchObject({ number: 2, phase: "answering", question: null, guesses: {}, correctAnswer: null });
    expect(game.activeId).not.toBe(active);
    expect(game.run(game.activeId, "nextRound")).toMatchObject({ errorStatus: "conflict" });
  });

  it("updates the scoreboard and caps the history", () => {
    const game = new Game(3);
    game.resolveRound();
    expect(game.view("p1").scoreboard.map((score) => score.playerId)).toEqual(["p1", "p2", "p3"]);

    for (let i = 1; i < HISTORY_LIMIT + 5; i++) {
      game.ok(game.activeId, "nextRound");
      game.resolveRound();
    }
    expect(game.state.history).toHaveLength(HISTORY_LIMIT);
    expect(game.state.history[0].roundNumber).toBe(6);
    expect(game.state.history.at(-1)!.roundNumber).toBe(HISTORY_LIMIT + 5);
    const totalTurns = Object.values(game.state.scoreboard).reduce((sum, score) => sum + score.turns, 0);
    expect(totalTurns).toBe(HISTORY_LIMIT + 5);
  });

  it("cancels the round and rotates when the active player leaves mid-round", () => {
    const game = new Game(5);
    const active = game.activeId;
    game.ok(game.guesserIds[0], "submitGuess", { value: 3 });
    game.remove(active);
    expect(game.state.history).toHaveLength(0);
    expect(game.round).toMatchObject({ number: 2, phase: "answering", guesses: {} });
    expect(game.activeId).not.toBe(active);
    expect(game.state.circle.remainingPlayerIds).not.toContain(active);
  });

  it("keeps the result and starts the next round when the active player leaves after the answer", () => {
    const game = new Game(5);
    game.resolveRound();
    game.remove(game.activeId);
    expect(game.state.history).toHaveLength(1);
    expect(game.round).toMatchObject({ number: 2, phase: "answering" });
  });

  it("drops the guess of a guesser who leaves", () => {
    const game = new Game(5);
    const [leaver, stayer] = game.guesserIds;
    game.ok(leaver, "submitGuess", { value: 1 });
    game.ok(stayer, "submitGuess", { value: 2 });
    game.remove(leaver);
    expect(game.round.number).toBe(1);
    expect(game.guesserIds).not.toContain(leaver);
    expect(Object.keys(game.round.guesses)).toEqual([stayer]);
  });

  it("cancels a revealed round when its only guesser leaves", () => {
    const game = new Game(5);
    const [only] = game.guesserIds;
    game.ok(only, "submitGuess", { value: 42 });
    game.ok(game.activeId, "reveal", { force: true });
    game.remove(only);
    expect(game.round).toMatchObject({ number: 2, phase: "answering" });
  });

  it("makes a mid-round joiner eligible and adds them to the circle", () => {
    const game = new Game(3);
    game.join("p4");
    expect(game.guesserIds).toContain("p4");
    expect(game.state.circle.remainingPlayerIds).toContain("p4");
    expect(game.view("p4").round!.canSubmitAnswer).toBe(true);

    game.guessAll();
    game.ok(game.activeId, "reveal");
    game.join("p5");
    expect(game.guesserIds).not.toContain("p5");
    expect(game.view("p5").round!.canSubmitAnswer).toBe(false);
  });

  it("pauses below 3 players and resumes when someone joins", () => {
    const game = new Game(3);
    game.remove(game.nonHost([game.activeId]));
    expect(game.state).toMatchObject({ round: null, pausedReason: "not-enough-players" });
    expect(game.view("p1")).toMatchObject({ round: null, pausedReason: "not-enough-players", canSkipRound: false });
    expect(game.run("p1", "skipRound")).toMatchObject({ errorStatus: "conflict" });

    game.join("p9");
    expect(game.state.pausedReason).toBeNull();
    expect(game.round).toMatchObject({ number: 2, phase: "answering" });
  });

  it("lets only the host skip a round", () => {
    const game = new Game(4);
    expect(game.run(game.nonHost(), "skipRound")).toMatchObject({ errorStatus: "forbidden" });
    game.ok(game.hostId, "skipRound");
    expect(game.state.history).toHaveLength(0);
    expect(game.round.number).toBe(2);

    game.resolveRound();
    game.ok(game.hostId, "skipRound");
    expect(game.state.history).toHaveLength(1);
    expect(game.round.number).toBe(3);
  });

  it("projects deterministically and exposes action flags only to the active player", () => {
    const game = new Game(4);
    game.guessAll();
    const viewer = game.guesserIds[0];
    expect(JSON.stringify(game.view(viewer))).toBe(JSON.stringify(game.view(viewer)));
    const clone = structuredClone(game.state);
    expect(JSON.stringify(numberGuessModule.project(clone, viewer, game.ctx(viewer)))).toBe(JSON.stringify(game.view(viewer)));

    expect(game.view(game.activeId).round).toMatchObject({ canReveal: true, canForceReveal: true, canSubmitAnswer: false });
    expect(game.view(viewer).round).toMatchObject({
      canReveal: false,
      canForceReveal: false,
      canSetCorrectAnswer: false,
      canGoNext: false,
    });

    game.ok(game.activeId, "reveal");
    expect(game.view(game.activeId).round!.canSetCorrectAnswer).toBe(true);

    const finished = numberGuessModule.project(game.state, game.activeId, { ...game.ctx(game.activeId), status: "finished" });
    expect(finished.round).toMatchObject({ canSetCorrectAnswer: false, canSetQuestion: false });
  });
});
