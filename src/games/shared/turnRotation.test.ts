import { describe, expect, it } from "vitest";
import { createSeededRng } from "../../utils/random";
import { addPlayerToCircle, createTurnCircle, pickNextActive, removePlayerFromCircle, TurnCircle } from "./turnRotation";

function simulate(players: string[], picks: number, seed = 3) {
  const rng = createSeededRng(seed);
  let circle = createTurnCircle();
  let last: string | null = null;
  const turns: { playerId: string; circle: number }[] = [];
  for (let i = 0; i < picks; i++) {
    const next = pickNextActive(circle, players, last, rng);
    circle = next.circle;
    last = next.activePlayerId;
    turns.push({ playerId: last, circle: circle.number });
  }
  return turns;
}

describe("turnRotation", () => {
  it("makes every player active exactly once per circle", () => {
    const players = ["a", "b", "c", "d", "e"];
    const turns = simulate(players, 15);
    for (const circleNumber of [1, 2, 3]) {
      const inCircle = turns.filter((turn) => turn.circle === circleNumber).map((turn) => turn.playerId);
      expect([...inCircle].sort()).toEqual(players);
    }
  });

  it("never gives back-to-back turns at a circle boundary", () => {
    for (let seed = 1; seed <= 50; seed++) {
      const turns = simulate(["a", "b", "c"], 30, seed);
      for (let i = 1; i < turns.length; i++) {
        expect(turns[i].playerId).not.toBe(turns[i - 1].playerId);
      }
    }
  });

  it("keeps picking the only player", () => {
    expect(simulate(["solo"], 3)).toEqual([
      { playerId: "solo", circle: 1 },
      { playerId: "solo", circle: 2 },
      { playerId: "solo", circle: 3 },
    ]);
  });

  it("adds a joiner to the current circle", () => {
    const rng = createSeededRng(9);
    let { circle, activePlayerId } = pickNextActive(createTurnCircle(), ["a", "b", "c"], null, rng);
    const picked = [activePlayerId];
    circle = addPlayerToCircle(circle, "d");
    for (let i = 0; i < 3; i++) {
      ({ circle, activePlayerId } = pickNextActive(circle, ["a", "b", "c", "d"], activePlayerId, rng));
      picked.push(activePlayerId);
      expect(circle.number).toBe(1);
    }
    expect([...picked].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("does not add a player twice", () => {
    const circle: TurnCircle = { number: 1, remainingPlayerIds: ["b"], completedPlayerIds: ["a"] };
    expect(addPlayerToCircle(addPlayerToCircle(circle, "a"), "b")).toEqual(circle);
  });

  it("never picks a player who left", () => {
    const rng = createSeededRng(5);
    let { circle, activePlayerId } = pickNextActive(createTurnCircle(), ["a", "b", "c", "d"], null, rng);
    const leaver = circle.remainingPlayerIds[0];
    circle = removePlayerFromCircle(circle, leaver);
    const active = ["a", "b", "c", "d"].filter((id) => id !== leaver);

    const circleOne = [activePlayerId];
    while (true) {
      ({ circle, activePlayerId } = pickNextActive(circle, active, activePlayerId, rng));
      if (circle.number !== 1) break;
      circleOne.push(activePlayerId);
    }
    expect(circleOne).toHaveLength(3);
    expect(circleOne).not.toContain(leaver);
  });

  it("ignores stale ids still listed in the circle", () => {
    const circle: TurnCircle = { number: 1, remainingPlayerIds: ["gone", "b"], completedPlayerIds: ["a"] };
    const next = pickNextActive(circle, ["a", "b"], "a", createSeededRng(1));
    expect(next.activePlayerId).toBe("b");
    expect(next.circle).toEqual({ number: 1, remainingPlayerIds: [], completedPlayerIds: ["a", "b"] });
  });
});
