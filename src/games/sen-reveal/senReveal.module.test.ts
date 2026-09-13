import { describe, expect, it } from "vitest";
import { PlayerRecord, Result } from "../../models";
import { createSeededRng, Rng } from "../../utils/random";
import { GameContext, GameTransition } from "../gameModule";
import { senRevealModule } from "./senReveal.module";
import { SenRevealView } from "./senReveal.projection";
import { HISTORY_LIMIT, SenRevealState } from "./senReveal.state";

const SETTINGS = { minPlayers: 3, maxAnswerLength: 200, maxPlayers: 20, allowJoinInProgress: true };

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
  state: SenRevealState;
  hostId = "p1";
  private readonly rng: Rng;
  private tick = 0;

  constructor(count: number, seed = 1) {
    this.rng = createSeededRng(seed);
    this.players = Array.from({ length: count }, (_, i) => makePlayer(`p${i + 1}`, i));
    const initial = senRevealModule.createInitialState(this.ctx(this.hostId));
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

  run(actorId: string, name: string, payload: unknown = {}): Result<GameTransition<SenRevealState>> {
    const action = senRevealModule.actions[name];
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

  ok(actorId: string, name: string, payload: unknown = {}): SenRevealState {
    const result = this.run(actorId, name, payload);
    if (!result.isSuccess) throw new Error(`${name} by ${actorId} failed: ${result.error}`);
    return this.state;
  }

  view(viewerId: string): SenRevealView {
    return senRevealModule.project(this.state, viewerId, this.ctx(viewerId));
  }

  get round() {
    if (!this.state.round) throw new Error("No round (paused)");
    return this.state.round;
  }

  get activeId() {
    return this.round.activePlayerId;
  }

  get answererIds() {
    return this.round.eligiblePlayerIds;
  }

  nonHost(except: string[] = []) {
    return this.players.find((player) => player.id !== this.hostId && !except.includes(player.id))!.id;
  }

  answerAll() {
    for (const id of this.answererIds) {
      this.ok(id, "submitAnswer", { value: `answer-${id}-${this.round.number}` });
    }
  }

  resolveRound() {
    this.answerAll();
    this.ok(this.activeId, "reveal");
    const [winnerId, loserId] = this.answererIds;
    this.ok(this.activeId, "pickResult", { winnerId, loserId });
  }

  join(id: string) {
    this.players = [...this.players, makePlayer(id, this.players.length)];
    this.state = senRevealModule.onPlayerJoined!(this.ctx(id), this.state, id);
  }

  remove(id: string) {
    this.players = this.players.filter((player) => player.id !== id);
    if (this.hostId === id) this.hostId = this.players[0].id;
    this.state = senRevealModule.onPlayerRemoved!(this.ctx(this.hostId), this.state, id).state;
  }
}

describe("SenReveal module", () => {
  it("starts round 1 with a random active player and everyone else eligible", () => {
    const game = new Game(4);
    expect(game.round).toMatchObject({ number: 1, phase: "answering", question: null, answers: {} });
    expect(game.answererIds).toHaveLength(3);
    expect(game.answererIds).not.toContain(game.activeId);
    expect(game.state.circle.number).toBe(1);
    expect(game.state.scoreboard[game.activeId].turns).toBe(1);
  });

  it("refuses to start with fewer than 3 players", () => {
    expect(() => new Game(2)).toThrow(/At least 3 players/);
  });

  it("hides answers from everyone before the reveal and shows them to all after", () => {
    const game = new Game(4);
    const secrets = Object.fromEntries(game.answererIds.map((id) => [id, `secret-of-${id}`]));
    for (const [id, value] of Object.entries(secrets)) {
      game.ok(id, "submitAnswer", { value });
    }

    for (const player of game.players) {
      const json = JSON.stringify(game.view(player.id));
      for (const [id, value] of Object.entries(secrets)) {
        if (id === player.id) {
          expect(json).toContain(value);
        } else {
          expect(json).not.toContain(value);
        }
      }
    }
    expect(game.view(game.activeId).round).toMatchObject({ answers: null, myAnswer: null, answeredPlayerIds: game.answererIds });

    game.ok(game.activeId, "reveal");
    for (const player of game.players) {
      const round = game.view(player.id).round!;
      expect(round.answers).toEqual(game.answererIds.map((id) => ({ playerId: id, value: secrets[id] })));
    }
  });

  it("lets an answerer change their answer until the reveal", () => {
    const game = new Game(3);
    const [first] = game.answererIds;
    game.ok(first, "submitAnswer", { value: "one" });
    game.ok(first, "submitAnswer", { value: "  two  " });
    expect(game.round.answers[first].value).toBe("two");

    expect(game.run(game.activeId, "submitAnswer", { value: "me too" })).toMatchObject({ errorStatus: "forbidden" });
    expect(game.run(first, "submitAnswer", { value: "   " })).toMatchObject({ errorStatus: "bad-request" });
    expect(game.run(first, "submitAnswer", { value: "x".repeat(201) })).toMatchObject({ errorStatus: "bad-request" });

    game.answerAll();
    game.ok(game.activeId, "reveal");
    expect(game.run(first, "submitAnswer", { value: "late" })).toMatchObject({ errorStatus: "conflict" });
  });

  it("blocks the reveal until all answered, unless forced with at least one answer", () => {
    const game = new Game(4);
    expect(game.run(game.activeId, "reveal", { force: true })).toMatchObject({ errorStatus: "conflict" });

    game.ok(game.answererIds[0], "submitAnswer", { value: "a" });
    expect(game.view(game.activeId).round).toMatchObject({ canReveal: false, canForceReveal: true });
    expect(game.run(game.activeId, "reveal")).toMatchObject({ errorStatus: "conflict" });
    expect(game.run(game.answererIds[1], "reveal", { force: true })).toMatchObject({ errorStatus: "forbidden" });

    game.ok(game.activeId, "reveal", { force: true });
    expect(game.round.phase).toBe("revealed");
    expect(game.run(game.activeId, "reveal")).toMatchObject({ errorStatus: "conflict" });
  });

  it("validates the winner and loser pick", () => {
    const game = new Game(4);
    game.answerAll();
    const [a, b] = game.answererIds;
    expect(game.run(game.activeId, "pickResult", { winnerId: a, loserId: b })).toMatchObject({ errorStatus: "conflict" });
    game.ok(game.activeId, "reveal");

    expect(game.run(a, "pickResult", { winnerId: a, loserId: b })).toMatchObject({ errorStatus: "forbidden" });
    expect(game.run(game.activeId, "pickResult", { winnerId: a, loserId: a })).toMatchObject({ errorStatus: "bad-request" });
    expect(game.run(game.activeId, "pickResult", { winnerId: game.activeId, loserId: b })).toMatchObject({ errorStatus: "bad-request" });
    expect(game.run(game.activeId, "pickResult", { winnerId: a, loserId: "stranger" })).toMatchObject({ errorStatus: "bad-request" });
    expect(game.run(game.activeId, "pickResult", { winnerId: a, loserId: null })).toMatchObject({ errorStatus: "bad-request" });
    expect(game.run(game.activeId, "pickResult", { winnerId: a })).toMatchObject({ errorStatus: "bad-request" });
    game.ok(game.activeId, "pickResult", { winnerId: a, loserId: b });
  });

  it("allows a null loser only when exactly one player answered", () => {
    const game = new Game(4);
    const [only, other] = game.answererIds;
    game.ok(only, "submitAnswer", { value: "lonely" });
    game.ok(game.activeId, "reveal", { force: true });
    expect(game.run(game.activeId, "pickResult", { winnerId: only, loserId: other })).toMatchObject({ errorStatus: "bad-request" });
    game.ok(game.activeId, "pickResult", { winnerId: only, loserId: null });
    expect(game.state.history[0]).toMatchObject({ winnerId: only, loserId: null, answers: { [only]: "lonely" } });
  });

  it("treats the question as optional", () => {
    const game = new Game(3);
    expect(game.run(game.answererIds[0], "setQuestion", { text: "Hi?" })).toMatchObject({ errorStatus: "forbidden" });
    expect(game.view(game.activeId).round!.canSetQuestion).toBe(true);
    expect(game.view(game.answererIds[0]).round!.canSetQuestion).toBe(false);

    game.ok(game.activeId, "setQuestion", { text: "  What is the capital of Peru?  " });
    expect(game.view(game.answererIds[0]).round!.question).toBe("What is the capital of Peru?");
    game.ok(game.activeId, "setQuestion", { text: "   " });
    expect(game.round.question).toBeNull();
    expect(game.run(game.activeId, "setQuestion", { text: "x".repeat(301) })).toMatchObject({ errorStatus: "bad-request" });

    game.answerAll();
    game.ok(game.activeId, "reveal");
    expect(game.round.question).toBeNull();
    expect(game.run(game.activeId, "setQuestion", { text: "Too late" })).toMatchObject({ errorStatus: "conflict" });
  });

  it("makes the pick final and waits for the active player's Next", () => {
    const game = new Game(4);
    game.resolveRound();
    const active = game.activeId;
    const [winnerId, loserId] = game.answererIds;

    for (const player of game.players) {
      expect(game.view(player.id).round).toMatchObject({ phase: "resolved", winnerId, loserId });
      expect(game.view(player.id).round!.canGoNext).toBe(player.id === active);
    }
    expect(game.run(active, "pickResult", { winnerId: loserId, loserId: winnerId })).toMatchObject({ errorStatus: "conflict" });
    expect(game.run(winnerId, "nextRound")).toMatchObject({ errorStatus: "forbidden" });
    expect(game.round.number).toBe(1);

    game.ok(active, "nextRound");
    expect(game.round).toMatchObject({ number: 2, phase: "answering", question: null, answers: {} });
    expect(game.activeId).not.toBe(active);
    expect(game.run(game.activeId, "nextRound")).toMatchObject({ errorStatus: "conflict" });
  });

  it("updates the scoreboard and caps the history", () => {
    const game = new Game(3);
    game.resolveRound();
    const [winnerId, loserId] = game.answererIds;
    expect(game.state.scoreboard[winnerId]).toMatchObject({ wins: 1, losses: 0 });
    expect(game.state.scoreboard[loserId]).toMatchObject({ wins: 0, losses: 1 });
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
    game.ok(game.answererIds[0], "submitAnswer", { value: "orphan" });
    game.remove(active);
    expect(game.state.history).toHaveLength(0);
    expect(game.round).toMatchObject({ number: 2, phase: "answering", answers: {} });
    expect(game.activeId).not.toBe(active);
    expect(game.state.circle.remainingPlayerIds).not.toContain(active);
  });

  it("keeps the result and starts the next round when the active player leaves after the pick", () => {
    const game = new Game(5);
    game.resolveRound();
    game.remove(game.activeId);
    expect(game.state.history).toHaveLength(1);
    expect(game.round).toMatchObject({ number: 2, phase: "answering" });
  });

  it("drops the answer of an answerer who leaves", () => {
    const game = new Game(5);
    const [leaver, stayer] = game.answererIds;
    game.ok(leaver, "submitAnswer", { value: "bye" });
    game.ok(stayer, "submitAnswer", { value: "hi" });
    game.remove(leaver);
    expect(game.round.number).toBe(1);
    expect(game.answererIds).not.toContain(leaver);
    expect(Object.keys(game.round.answers)).toEqual([stayer]);
  });

  it("cancels a revealed round when its only answerer leaves", () => {
    const game = new Game(5);
    const [only] = game.answererIds;
    game.ok(only, "submitAnswer", { value: "solo" });
    game.ok(game.activeId, "reveal", { force: true });
    game.remove(only);
    expect(game.round).toMatchObject({ number: 2, phase: "answering" });
  });

  it("makes a mid-round joiner eligible and adds them to the circle", () => {
    const game = new Game(3);
    game.join("p4");
    expect(game.answererIds).toContain("p4");
    expect(game.state.circle.remainingPlayerIds).toContain("p4");
    expect(game.view("p4").round!.canSubmitAnswer).toBe(true);

    game.answerAll();
    game.ok(game.activeId, "reveal");
    game.join("p5");
    expect(game.answererIds).not.toContain("p5");
    expect(game.state.circle.remainingPlayerIds).toContain("p5");
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
    expect(game.round.phase).toBe("answering");
    expect(game.round.number).toBe(2);
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
    game.answerAll();
    const viewer = game.answererIds[0];
    expect(JSON.stringify(game.view(viewer))).toBe(JSON.stringify(game.view(viewer)));
    const clone = structuredClone(game.state);
    expect(JSON.stringify(senRevealModule.project(clone, viewer, game.ctx(viewer)))).toBe(JSON.stringify(game.view(viewer)));

    expect(game.view(game.activeId).round).toMatchObject({ canReveal: true, canForceReveal: true, canSubmitAnswer: false });
    expect(game.view(viewer).round).toMatchObject({ canReveal: false, canForceReveal: false, canPickResult: false, canGoNext: false });

    const finished = senRevealModule.project(game.state, game.activeId, { ...game.ctx(game.activeId), status: "finished" });
    expect(finished.round).toMatchObject({ canReveal: false, canSetQuestion: false });
  });
});
