# sen-reveal-api

Backend for the SenReveal and number-guess party games (and the future who-am-i):
anonymous players, 6-digit session codes, a lobby, and real-time game state over Socket.IO
with an HTTP polling fallback. Design: [docs/implementation/sen-reveal.api.implementation-plan.md](docs/implementation/sen-reveal.api.implementation-plan.md).

## Requirements

- Node.js 22+
- A Supabase project with the DB objects from plan §4.1 (table `sencha_game_session`,
  its partial unique index, RLS enabled without policies, and the `sencha_game_session_presence` function).
  There are no migrations — create them manually. Realtime must be enabled (used as a server-only relay).

## Environment

Read from `.env.local` (or `.env`):

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service role key (server only) |
| `CORS_ORIGINS` | no | Comma-separated allowed origins (defaults to localhost:4200 and the Vercel client) |
| `PORT` | no | Local port, default 8080 |
| `LOG_LEVEL` | no | `debug` \| `info` (default) \| `warn` \| `error` \| `silent` |

## Scripts

```bash
npm start           # dev server (nodemon + ts-node), HTTP + Socket.IO on the same port
npm run build       # compile to dist/
npm run typecheck   # tsc --noEmit, tests included
npm test            # vitest (watch); npm run test:run for a single run
npm run smoke:db    # checks the repository against the real Supabase DB (creates one row)
```

Tests use an in-memory repository and bus, so they need no database or network.

## Layout

```
src/
  app.ts, index.ts, runtime.ts   Express app, entry (exports the http.Server), composition root
  models/                        Result, session types, request schemas
  services/                      session pipeline, lobby actions, repository (Supabase + in-memory), projection
  games/                         GameModule interface, registry, shared turn rotation, sen-reveal module
  realtime/                      Socket.IO server, relay bus, broadcaster, presence, maintenance tick
  middlewares/, routes/, utils/
```

## API at a glance

HTTP under `/api/sessions` (player endpoints need the `X-Player-Token` header):

- `POST /` create · `GET /:code/info` · `POST /:code/join`
- `GET /:code/state` (ETag / 304) · `POST /:code/actions` `{ type, payload }` · `GET /:code/history`

Socket.IO: `io(API_URL, { transports: ['websocket'], auth: { code, playerToken } })`;
server events `session:state`, `session:expired`, `session:idle`, `player:removed`; client event `action` with an ack.

Errors: `{ error: { code, message } }`. See plan §9 for the full contract.
