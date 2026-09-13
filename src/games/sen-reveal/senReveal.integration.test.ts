import { describe, expect, it } from "vitest";
import { createHttpHarness, TestPlayer } from "../../testing/harness";
import { SenRevealView } from "./senReveal.projection";

const gameOf = (view: { game: unknown }) => view.game as SenRevealView;

describe("SenReveal over HTTP", () => {
  it("lets 4 players play 2 full circles using only /actions and /state", async () => {
    const h = createHttpHarness({ repositoryLatencyMs: 2 });
    const ann = await h.api.createPlayer("Ann");
    const players: TestPlayer[] = [
      ann,
      await h.api.joinPlayer(ann.code, "Ben"),
      await h.api.joinPlayer(ann.code, "Cid"),
      await h.api.joinPlayer(ann.code, "Dee"),
    ];
    const byId = new Map(players.map((player) => [player.playerId, player]));
    await h.api.act(ann, "lobby.start");

    const turns: string[] = [];
    for (let roundNumber = 1; roundNumber <= 8; roundNumber++) {
      const round = gameOf(await h.api.view(ann)).round!;
      expect(round.number).toBe(roundNumber);
      expect(gameOf(await h.api.view(ann)).circle.number).toBe(Math.ceil(roundNumber / 4));
      const active = byId.get(round.activePlayerId)!;
      turns.push(active.playerId);
      const answerers = players.filter((player) => player !== active);

      if (roundNumber % 2 === 1) {
        await h.api.act(active, "sen-reveal.setQuestion", { text: `Question ${roundNumber}?` });
      }

      const secrets = answerers.map((player) => `answer ${roundNumber} from ${player.nickname}`);
      const submitted = await Promise.all(
        answerers.map((player, i) => h.api.action(player, "sen-reveal.submitAnswer", { value: secrets[i] }))
      );
      expect(submitted.map((res) => res.status)).toEqual([200, 200, 200]);

      const activeView = await h.api.view(active);
      expect(gameOf(activeView).round).toMatchObject({ answers: null, canReveal: true });
      expect(gameOf(activeView).round!.answeredPlayerIds).toHaveLength(3);
      const activeJson = JSON.stringify(activeView);
      secrets.forEach((secret) => expect(activeJson).not.toContain(secret));

      await h.api.act(active, "sen-reveal.reveal");
      for (const player of players) {
        const answers = gameOf(await h.api.view(player)).round!.answers!;
        expect(answers.map((answer) => answer.value).sort()).toEqual([...secrets].sort());
      }

      await h.api.act(active, "sen-reveal.pickResult", { winnerId: answerers[0].playerId, loserId: answerers[1].playerId });
      expect(gameOf(await h.api.view(answerers[2])).round).toMatchObject({
        phase: "resolved",
        winnerId: answerers[0].playerId,
        loserId: answerers[1].playerId,
      });
      await h.api.act(active, "sen-reveal.nextRound");
    }

    expect(new Set(turns.slice(0, 4)).size).toBe(4);
    expect(new Set(turns.slice(4)).size).toBe(4);
    expect(turns[4]).not.toBe(turns[3]);

    const history = await h.api.history(ann);
    expect(history.body).toHaveLength(8);
    expect(history.body[0]).toMatchObject({ roundNumber: 1, question: "Question 1?" });
    expect(history.body[1]).toMatchObject({ roundNumber: 2, question: null });

    const scoreboard = gameOf(await h.api.view(ann)).scoreboard;
    expect(scoreboard.reduce((sum, score) => sum + score.wins, 0)).toBe(8);
    expect(scoreboard.reduce((sum, score) => sum + score.turns, 0)).toBe(9);
  });

  it("loses no answer when players submit in parallel against write conflicts", async () => {
    const h = createHttpHarness({ repositoryLatencyMs: 1 });
    const ann = await h.api.createPlayer("Ann");
    const players = [ann, await h.api.joinPlayer(ann.code, "Ben"), await h.api.joinPlayer(ann.code, "Cid"), await h.api.joinPlayer(ann.code, "Dee")];
    const started = await h.api.act(ann, "lobby.start");
    const activeId = gameOf(started).round!.activePlayerId;
    const answerers = players.filter((player) => player.playerId !== activeId);

    h.repository.forceConflicts(2);
    const results = await Promise.all(
      answerers.map((player) => h.api.action(player, "sen-reveal.submitAnswer", { value: `from ${player.nickname}` }))
    );
    expect(results.map((res) => res.status)).toEqual([200, 200, 200]);

    const round = gameOf(await h.api.view(ann)).round!;
    expect([...round.answeredPlayerIds].sort()).toEqual(answerers.map((player) => player.playerId).sort());
  });
});
