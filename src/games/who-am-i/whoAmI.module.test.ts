import { describe, expect, it } from "vitest";
import { PlayerRecord, Result } from "../../models";
import { createSeededRng, Rng } from "../../utils/random";
import { GameContext, GameTransition } from "../gameModule";
import { whoAmIModule } from "./whoAmI.module";
import { WhoAmIView } from "./whoAmI.projection";
import { HISTORY_LIMIT, MAX_NAME_LENGTH, WhoAmIState } from "./whoAmI.state";

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
  state: WhoAmIState;
  hostId = "p1";
  private readonly rng: Rng;
  private tick = 0;

  constructor(count: number, seed = 1) {
    this.rng = createSeededRng(seed);
    this.players = Array.from({ length: count }, (_, i) => makePlayer(`p${i + 1}`, i));
    const initial = whoAmIModule.createInitialState(this.ctx(this.hostId));
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

  run(actorId: string, name: string, payload: unknown = {}): Result<GameTransition<WhoAmIState>> {
    const action = whoAmIModule.actions[name];
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

  ok(actorId: string, name: string, payload: unknown = {}): WhoAmIState {
    const result = this.run(actorId, name, payload);
    if (!result.isSuccess) throw new Error(`${name} by ${actorId} failed: ${result.error}`);
    return this.state;
  }

  view(viewerId: string): WhoAmIView {
    return whoAmIModule.project(this.state, viewerId, this.ctx(viewerId));
  }

  get round() {
    return this.state.round;
  }

  targetOf(giverId: string) {
    return this.round.assignments[giverId];
  }

  giverOf(targetId: string) {
    return Object.keys(this.round.assignments).find((id) => this.round.assignments[id] === targetId);
  }

  /** Every giver names their target "<target> famous". */
  nameAll() {
    for (const giverId of Object.keys(this.round.assignments)) {
      this.ok(giverId, "submitName", { name: `${this.targetOf(giverId)} famous` });
    }
  }

  join(id: string) {
    this.players = [...this.players, makePlayer(id, this.players.length)];
    this.state = whoAmIModule.onPlayerJoined!(this.ctx(id), this.state, id);
  }

  remove(id: string) {
    this.players = this.players.filter((player) => player.id !== id);
    if (this.hostId === id) this.hostId = this.players[0].id;
    this.state = whoAmIModule.onPlayerRemoved!(this.ctx(this.hostId), this.state, id).state;
  }
}

/** Walks giver → target from `start`; a single cycle visits everybody before coming back. */
function cycleLength(assignments: Record<string, string>, start: string): number {
  let length = 0;
  let current = start;
  do {
    current = assignments[current];
    length++;
  } while (current !== start && length <= Object.keys(assignments).length);
  return length;
}

describe("WhoAmI module", () => {
  it("deals everybody one target in a single circle, never themselves", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const game = new Game(6, seed);
      const { assignments, playerIds } = game.round;
      expect(playerIds).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
      expect(Object.keys(assignments).sort()).toEqual(playerIds);
      expect(Object.values(assignments).sort()).toEqual(playerIds);
      for (const id of playerIds) {
        expect(assignments[id]).not.toBe(id);
      }
      expect(cycleLength(assignments, "p1")).toBe(6);
    }
  });

  it("refuses to start with fewer than 3 players", () => {
    expect(() => new Game(2)).toThrow(/At least 3 players/);
  });

  it("shows a giver only their target until they have named them", () => {
    const game = new Game(4);
    const view = game.view("p1").round;
    expect(view).toMatchObject({ phase: "playing", isPlaying: true, myTargetId: game.targetOf("p1"), cards: null });
    expect(view).toMatchObject({ canSubmitName: true, myGivenName: null, answeredPlayerIds: [] });
    expect(view.eligiblePlayerIds).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("opens the table once the name is in, with every card but the viewer's own", () => {
    const game = new Game(4);
    game.nameAll();

    for (const player of game.players) {
      const view = game.view(player.id).round;
      expect(view.canSubmitName).toBe(false);
      expect(view.myGivenName).toBe(`${game.targetOf(player.id)} famous`);
      expect(view.answeredPlayerIds).toHaveLength(4);
      for (const card of view.cards!) {
        if (card.playerId === player.id) {
          expect(card).toEqual({ playerId: player.id, name: null, givenById: null, isMine: true });
        } else {
          expect(card).toEqual({
            playerId: card.playerId,
            name: `${card.playerId} famous`,
            givenById: game.giverOf(card.playerId),
            isMine: false,
          });
        }
      }
    }
  });

  it("never leaks the viewer's own name, even when it arrives before theirs", () => {
    const game = new Game(3);
    const me = "p1";
    const myGiver = game.giverOf(me)!;
    game.ok(myGiver, "submitName", { name: "Napoleon" });
    expect(JSON.stringify(game.view(me))).not.toContain("Napoleon");

    game.ok(me, "submitName", { name: "Cleopatra" });
    expect(JSON.stringify(game.view(me))).not.toContain("Napoleon");
    expect(game.view(me).round.cards!.find((card) => card.isMine)).toMatchObject({ name: null });
  });

  it("validates names and makes them final", () => {
    const game = new Game(3);
    expect(game.run("p1", "submitName", { name: "   " })).toMatchObject({ errorStatus: "bad-request" });
    expect(game.run("p1", "submitName", { name: "x".repeat(MAX_NAME_LENGTH + 1) })).toMatchObject({
      errorStatus: "bad-request",
    });
    expect(game.run("p1", "submitName", {})).toMatchObject({ errorStatus: "bad-request" });

    game.ok("p1", "submitName", { name: "  Sherlock Holmes  " });
    expect(game.round.names[game.targetOf("p1")]).toMatchObject({ value: "Sherlock Holmes", givenById: "p1" });
    expect(game.run("p1", "submitName", { name: "Watson" })).toMatchObject({ errorStatus: "conflict" });
    expect(game.run("stranger", "submitName", { name: "Watson" })).toMatchObject({ errorStatus: "forbidden" });
  });

  it("lets only the host reveal, whenever they like, and then shows everybody their own card", () => {
    const game = new Game(4);
    game.ok("p2", "submitName", { name: "Frodo" });
    expect(game.run("p2", "reveal")).toMatchObject({ errorStatus: "forbidden" });
    expect(game.view("p2").round.canReveal).toBe(false);
    expect(game.view("p1").round.canReveal).toBe(true);

    game.ok("p1", "reveal");
    expect(game.run("p1", "reveal")).toMatchObject({ errorStatus: "conflict" });
    expect(game.run("p3", "submitName", { name: "Late" })).toMatchObject({ errorStatus: "conflict" });

    const frodo = game.targetOf("p2");
    for (const player of game.players) {
      const view = game.view(player.id).round;
      expect(view).toMatchObject({ phase: "revealed", canSubmitName: false, canReveal: false });
      const cards = view.cards!;
      expect(cards.find((card) => card.playerId === frodo)).toMatchObject({ name: "Frodo", givenById: "p2" });
      expect(cards.filter((card) => card.name === null)).toHaveLength(3);
    }
    expect(game.state.history).toEqual([
      { roundNumber: 1, names: { [frodo]: { name: "Frodo", givenById: "p2" } }, revealedAt: game.round.revealedAt },
    ]);
  });

  it("starts a fresh deal only from the host, only after the reveal", () => {
    const game = new Game(4);
    expect(game.run("p1", "nextRound")).toMatchObject({ errorStatus: "conflict" });
    game.nameAll();
    game.ok("p1", "reveal");
    expect(game.run("p2", "nextRound")).toMatchObject({ errorStatus: "forbidden" });
    expect(game.view("p1").round.canStartNextRound).toBe(true);
    expect(game.view("p2").round.canStartNextRound).toBe(false);

    game.ok("p1", "nextRound");
    expect(game.round).toMatchObject({ number: 2, phase: "playing", names: {}, revealedAt: null });
    expect(game.view("p3").round).toMatchObject({ canSubmitName: true, cards: null });
  });

  it("caps the history", () => {
    const game = new Game(3);
    for (let i = 0; i < HISTORY_LIMIT + 3; i++) {
      game.ok("p1", "reveal");
      game.ok("p1", "nextRound");
    }
    expect(game.state.history).toHaveLength(HISTORY_LIMIT);
    expect(game.state.history[0].roundNumber).toBe(4);
  });

  it("lets a latecomer watch every card and deals them in next round", () => {
    const game = new Game(3);
    game.nameAll();
    game.join("p4");
    const view = game.view("p4").round;
    expect(view).toMatchObject({ isPlaying: false, myTargetId: null, canSubmitName: false });
    expect(view.cards!.map((card) => card.name)).toEqual(["p1 famous", "p2 famous", "p3 famous"]);

    game.ok("p1", "reveal");
    game.ok("p1", "nextRound");
    expect(game.round.playerIds).toContain("p4");
    expect(game.targetOf("p4")).toBeDefined();
    expect(game.giverOf("p4")).toBeDefined();
  });

  it("hands the leaver's unfinished job to whoever was naming them", () => {
    const game = new Game(5);
    const leaver = "p3";
    const giver = game.giverOf(leaver)!;
    const target = game.targetOf(leaver);
    game.ok(giver, "submitName", { name: "Gone" });

    game.remove(leaver);
    expect(game.round.playerIds).not.toContain(leaver);
    expect(game.round.names[leaver]).toBeUndefined();
    expect(game.targetOf(giver)).toBe(target);
    expect(cycleLength(game.round.assignments, giver)).toBe(4);
    // the giver's first name went with the leaver, so they are back to naming
    expect(game.view(giver).round).toMatchObject({ canSubmitName: true, myTargetId: target, cards: null });
  });

  it("keeps a name the leaver already gave and frees up their giver", () => {
    const game = new Game(5);
    const leaver = "p3";
    const giver = game.giverOf(leaver)!;
    const target = game.targetOf(leaver);
    game.ok(leaver, "submitName", { name: "Zorro" });

    game.remove(leaver);
    expect(game.round.names[target]).toMatchObject({ value: "Zorro", givenById: leaver });
    expect(game.targetOf(giver)).toBeUndefined();
    expect(game.view(giver).round).toMatchObject({ canSubmitName: false, myTargetId: null });
    expect(game.view(giver).round.cards).not.toBeNull();
    expect(game.view(giver).round.eligiblePlayerIds).not.toContain(giver);
  });

  it("leaves a revealed round as it was when someone leaves", () => {
    const game = new Game(4);
    game.nameAll();
    game.ok("p1", "reveal");
    const before = game.state;
    game.remove("p4");
    expect(game.state).toBe(before);
  });

  it("refuses a new round below the minimum, but keeps the current one going", () => {
    const game = new Game(3);
    game.remove("p3");
    expect(game.round.phase).toBe("playing");
    game.ok("p1", "reveal");
    expect(game.view("p1").round.canStartNextRound).toBe(false);
    expect(game.run("p1", "nextRound")).toMatchObject({ errorStatus: "conflict" });

    game.join("p9");
    game.ok("p1", "nextRound");
    expect(game.round.playerIds).toEqual(["p1", "p2", "p9"]);
  });

  it("projects deterministically and turns every action off once finished", () => {
    const game = new Game(4);
    game.nameAll();
    expect(JSON.stringify(game.view("p2"))).toBe(JSON.stringify(game.view("p2")));
    const clone = structuredClone(game.state);
    expect(JSON.stringify(whoAmIModule.project(clone, "p2", game.ctx("p2")))).toBe(JSON.stringify(game.view("p2")));

    const finished = whoAmIModule.project(game.state, "p1", { ...game.ctx("p1"), status: "finished" });
    expect(finished.round).toMatchObject({ canSubmitName: false, canReveal: false, canStartNextRound: false });
  });
});
