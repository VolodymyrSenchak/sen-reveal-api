import { describe, expect, it } from "vitest";
import { createHttpHarness, TestPlayer } from "../../testing/harness";
import { NumberGuessView } from "./numberGuess.projection";

const gameOf = (view: { game: unknown }) => view.game as NumberGuessView;

describe("NumberGuess over HTTP", () => {
  it("lets 4 players play a full circle using only /actions and /state", async () => {
    const h = createHttpHarness({ repositoryLatencyMs: 2 });
    const ann = await h.api.createPlayer("Ann", { gameType: "number-guess" });
    const players: TestPlayer[] = [
      ann,
      await h.api.joinPlayer(ann.code, "Ben"),
      await h.api.joinPlayer(ann.code, "Cid"),
      await h.api.joinPlayer(ann.code, "Dee"),
    ];
    const byId = new Map(players.map((player) => [player.playerId, player]));
    await h.api.act(ann, "lobby.start");

    for (let roundNumber = 1; roundNumber <= 4; roundNumber++) {
      const round = gameOf(await h.api.view(ann)).round!;
      expect(round.number).toBe(roundNumber);
      const active = byId.get(round.activePlayerId)!;
      const guessers = players.filter((player) => player !== active);

      await h.api.act(active, "number-guess.setQuestion", { text: `How many, round ${roundNumber}?` });
      // 100 is the answer every round: the first guesser is always closest, the last always furthest
      const guesses = [101, 90, 40];
      const submitted = await Promise.all(
        guessers.map((player, i) => h.api.action(player, "number-guess.submitGuess", { value: guesses[i] }))
      );
      expect(submitted.map((res) => res.status)).toEqual([200, 200, 200]);

      const activeView = await h.api.view(active);
      expect(gameOf(activeView).round).toMatchObject({ guesses: null, myGuess: null, canReveal: true });
      expect(gameOf(activeView).round!.answeredPlayerIds).toHaveLength(3);

      await h.api.act(active, "number-guess.reveal");
      for (const player of players) {
        expect(gameOf(await h.api.view(player)).round!.guesses!.map((guess) => guess.value).sort((a, b) => a - b)).toEqual(
          [...guesses].sort((a, b) => a - b)
        );
      }
      // nothing is scored until the right answer is in
      expect(gameOf(await h.api.view(ann)).round).toMatchObject({ correctAnswer: null, winnerIds: [], loserIds: [] });

      await h.api.act(active, "number-guess.setCorrectAnswer", { value: 100 });
      expect(gameOf(await h.api.view(guessers[2])).round).toMatchObject({
        phase: "resolved",
        correctAnswer: 100,
        winnerIds: [guessers[0].playerId],
        loserIds: [guessers[2].playerId],
      });
      await h.api.act(active, "number-guess.nextRound");
    }

    const history = await h.api.history(ann);
    expect(history.body).toHaveLength(4);
    expect(history.body[0]).toMatchObject({ roundNumber: 1, question: "How many, round 1?", correctAnswer: 100 });

    const scoreboard = gameOf(await h.api.view(ann)).scoreboard;
    expect(scoreboard.reduce((sum, score) => sum + score.wins, 0)).toBe(4);
    expect(scoreboard.reduce((sum, score) => sum + score.losses, 0)).toBe(4);
    expect(scoreboard.reduce((sum, score) => sum + score.turns, 0)).toBe(5);
  });

  it("rejects an action from the other game and a non-numeric guess", async () => {
    const h = createHttpHarness();
    const ann = await h.api.createPlayer("Ann", { gameType: "number-guess" });
    const ben = await h.api.joinPlayer(ann.code, "Ben");
    const cid = await h.api.joinPlayer(ann.code, "Cid");
    const started = await h.api.act(ann, "lobby.start");
    const guesser = [ann, ben, cid].find((player) => player.playerId !== gameOf(started).round!.activePlayerId)!;

    expect((await h.api.action(guesser, "sen-reveal.submitAnswer", { value: "twelve" })).status).toBe(400);
    expect((await h.api.action(guesser, "number-guess.submitGuess", { value: "12" })).status).toBe(400);
    expect((await h.api.action(guesser, "number-guess.submitGuess", { value: 12 })).status).toBe(200);
  });
});
