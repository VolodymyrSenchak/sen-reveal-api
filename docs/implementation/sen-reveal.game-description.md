# SenReveal game.

The idea of the game is that user can go to the website, create a session, and other people can join the session by session ID (should be 6-number code) and optionally with password.

The session is in pending state by default. The players can join to it. The users are anonymos, they are just required to enter the nickname.

Then host player starts the game. API randomly selects the active player who is asking question currently.
Other players on their screen automatically (via web-sockets) input for entering the number or just an answer.

The answer is not automatically shown to others and to active player.

Then when everybody has entered the number, active player can press button for showing all results. All Results are shown for all players.

Then active player picks winner and loser.

After that session goes to next random player, but to previous if he was already active in the current circle.

The session should live for 24 hours. After that it should not be possbile to join that session.

Tech preferences:
1. communication API with client should be via web-sockets/http
2. supabase DB is used for storing the session (infrastructure is ready)
3. session should be one row. Needed columns can be created, extended info e.g. players could be stored in the json.
4. UI client will be created later.
5. The game infrastructure should be ready for different types of games. The plan is:
  - number guessing game: players can only pick the number, and active player enters the right number, and game shows automatically who is closest and who is far from the answer.
  - word/number guessing game (CURRENT one): players can enter any answer
  - who am I game: in the session players give each other some names (one player gives name to another random player), e.g. actor names, and then each player sees others names, but not he's own.