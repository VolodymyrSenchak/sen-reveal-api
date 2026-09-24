import { describe, expect, it } from "vitest";
import { createHttpHarness, TestPlayer } from "../../testing/harness";
import { WhoAmIView } from "./whoAmI.projection";

const gameOf = (view: { game: unknown }) => view.game as WhoAmIView;

describe("WhoAmI over HTTP", () => {
  it("lets 4 players name each other, see everyone but themselves, and play a second round", async () => {
    const h = createHttpHarness({ repositoryLatencyMs: 2 });
    const ann = await h.api.createPlayer("Ann", { gameType: "who-am-i" });
    const players: TestPlayer[] = [
      ann,
      await h.api.joinPlayer(ann.code, "Ben"),
      await h.api.joinPlayer(ann.code, "Cid"),
      await h.api.joinPlayer(ann.code, "Dee"),
    ];
    await h.api.act(ann, "lobby.start");

    for (let roundNumber = 1; roundNumber <= 2; roundNumber++) {
      const targets = new Map<string, string>();
      for (const player of players) {
        const round = gameOf(await h.api.view(player)).round;
        expect(round).toMatchObject({ number: roundNumber, phase: "playing", canSubmitName: true, cards: null });
        targets.set(player.playerId, round.myTargetId!);
      }

      const submitted = await Promise.all(
        players.map((player) =>
          h.api.action(player, "who-am-i.submitName", { name: `Star of ${targets.get(player.playerId)}` })
        )
      );
      expect(submitted.map((res) => res.status)).toEqual([200, 200, 200, 200]);

      for (const player of players) {
        const cards = gameOf(await h.api.view(player)).round.cards!;
        expect(cards).toHaveLength(4);
        for (const card of cards) {
          expect(card.name).toBe(card.playerId === player.playerId ? null : `Star of ${card.playerId}`);
        }
      }

      expect((await h.api.action(players[1], "who-am-i.reveal")).status).toBe(403);
      await h.api.act(ann, "who-am-i.reveal");
      for (const player of players) {
        const mine = gameOf(await h.api.view(player)).round.cards!.find((card) => card.isMine)!;
        expect(mine.name).toBe(`Star of ${player.playerId}`);
      }
      await h.api.act(ann, "who-am-i.nextRound");
    }

    const history = await h.api.history(ann);
    expect(history.body).toHaveLength(2);
    expect(Object.keys(history.body[0].names)).toHaveLength(4);
  });
});
