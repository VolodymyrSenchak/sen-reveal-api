# SenReveal API — Implementation Plan

Source requirements: [sen-reveal.game-description.md](./sen-reveal.game-description.md)

This plan covers the backend (HTTP + WebSocket API) for the SenReveal party game, built so that the two future games
(number guessing, "Who am I") plug into the same session infrastructure.

**Confirmed decisions**
- Hosting stays on **Vercel**. Real-time sync uses **Vercel Functions WebSockets** (public beta) with Socket.IO. **HTTP short polling stays as a fallback** (§3.1).
- Turn rotation: each player is active **once per circle, in random order**.
- Minimum **3 players**.
- The active player can **force reveal** before everyone has answered.
- Players **can join a game in progress**. They join the current circle.
- Typing the question is **optional**. If there's no question, the UI shows a placeholder.
- After the winner/loser pick, the result stays on screen until the **active player presses "Next"**.
- A player who lost their token (new device, cleared storage) **just rejoins** as a new player.
- Table name `sencha_game_session`. **The owner creates the DB objects manually** (§4.1). No migration files.
- **No data deletion.** Session rows are kept.
- Vercel plan: **Hobby**. That means 300 s max connection lifetime, fixed 2 GB function memory, hard monthly quotas, and 1 WAF rate-limit rule (§3.1, §3.7).
- Accepted: stale nickname replacement, final pick, host-only skip, idle thresholds (§12).

---

## 1. Current state of the repo

| Area | Finding | Action |
|---|---|---|
| Stack | Express 5 + TypeScript (commonjs, ts-node/nodemon), `@supabase/supabase-js` ^2.49, layered folders `routes/ services/ models/ utils/` | Keep the stack and folder style. Upgrade supabase-js to ≥ 2.107 (§3.2) |
| Error handling | `Result<T>` + `success/failure` + `setResResult` | Reuse. `conflict` isn't mapped to 409 yet, and there are no `gone`/`too-many-requests` statuses |
| Routing | [src/routes/index.ts](../../src/routes/index.ts) uses `useSenRevealSessionRoutes()`, but it's never imported or defined, so **the build is currently broken** | Fix in Phase 0 |
| Service stub | [src/services/senRevealSession.service.ts](../../src/services/senRevealSession.service.ts) queries `sencha_sen_reveal_session` by `sessionId` | Replace with the generic session service below |
| Database | The Supabase project is shared with other apps (`actual_expenses`, `sencha_interview_questions`, …). **`sencha_sen_reveal_session` does not exist yet** | Owner creates `sencha_game_session` manually from the spec in §4.1 (prerequisite for Phase 1) |
| Auth | Existing auth is Supabase email/Google. Players here are anonymous | Add separate anonymous player tokens. Don't touch the existing auth |
| Hosting | [vercel.json](../../vercel.json) uses the legacy `builds` config for `dist/index.js`. Vercel WebSockets need **Fluid compute**, which is only the default for projects created on or after 2025-04-23. The repo files date from 2025-04-08, so the project may predate that | Phase 0 spike: enable Fluid compute, check that WebSocket upgrades work with this config, and switch to the documented entry style (export an `http.Server`) if not |
| Tests | None | Add Vitest. The game logic is designed as pure functions so it's easy to test |

---

## 2. Scope

### In scope (MVP)
- Anonymous players who only enter a nickname.
- Create a session with a 6-digit code and an optional password. Join by code (+ password).
- Lobby (`pending`): join, leave, kick, host transfer, start.
- SenReveal game loop: random active player (optionally types the question) → others submit hidden answers → active player reveals → active player picks winner & loser → result screen → active player presses "Next" → next active player (circle rotation).
- Real-time per-player state push over WebSockets (Socket.IO), with an HTTP polling fallback. Hidden info is filtered per player.
- Player online/offline status.
- The session expires 24 h after creation. No joins or actions after that.
- A generic game-module abstraction that number-guess and who-am-i will use later.

### Out of scope (for now)
- UI client (it comes later; this plan defines the contract it'll use).
- Implementing number-guess and who-am-i. Only check that the abstraction fits them (§11).
- Accounts, persistent stats across sessions, spectators.

---

## 3. Architecture decisions

### 3.1 Transport: WebSockets on Vercel (with a polling fallback)

#### Analysis of Vercel Functions WebSockets
Sources: [WebSockets docs](https://vercel.com/docs/functions/websockets?framework=express), [Functions limits](https://vercel.com/docs/functions/limitations), [Fluid compute pricing](https://vercel.com/docs/functions/usage-and-pricing), [Pub/sub guide](https://vercel.com/kb/guide/publish-and-subscribe-to-realtime-data-on-vercel).

| Aspect | What Vercel provides | Impact on this game |
|---|---|---|
| Express / Socket.IO | An Express app wrapped in `http.createServer` can be exported with `ws` or Socket.IO attached. Socket.IO clients **must use `transports: ['websocket']`** (no long-polling transport) | ✅ Fits the existing Express app |
| Status | **Public beta** (since 2026-06-22) | ⚠️ Keep HTTP polling as a fallback (§3.1.3) |
| Prerequisite | Fluid compute enabled | ⚠️ Check the existing project (§1) |
| Connection lifetime | Closed at the function's max duration: **Hobby 300 s (our plan, no extension)**, Pro 800 s | ⚠️ Clients reconnect every 5 min. Socket.IO reconnects automatically, and the server sends a fresh snapshot on connect, so nothing is lost because state lives in the DB |
| Instance pinning | A connection stays on one instance. Reconnects can land on **another instance**. Existing connections stay on the **old deployment** until they close | ⚠️ Nothing important can live in memory. Changes to the view format must be additive |
| Cross-instance broadcast | **Not built in.** An instance can only emit to sockets it holds. Vercel recommends an external pub/sub | ⚠️ Needs a cross-instance relay (§3.2) |
| Security | The upgrade request goes through Firewall rules and rate limits | ✅ The single Hobby rate-limit rule also covers the socket path (§3.7) |
| Pricing | Active CPU is billed only while processing messages. **Provisioned memory is billed for as long as any connection on an instance is open** (idle included). Each upgrade counts as one invocation | ⚠️ Idle tabs are the main cost risk, so there's an idle policy (§3.1.2) |

**Verdict: it fits.** It needs a cross-instance relay, an idle-disconnect policy, and a polling fallback. All three are in this plan.

**Cost versus polling (rough estimate):** 10 players, 1 hour of play.
- Polling at 1.5 s: about 24k invocations, and the instance stays busy almost all the time anyway.
- WebSockets: about 120 invocations (reconnects) plus actions. Memory costs about 2 GB-hrs per instance holding the game's sockets; sockets may spread over 1–3 instances.
- **Hobby quotas (our plan):** 360 GB-hrs provisioned memory, 4 h active CPU and 1M invocations per month. Function memory is fixed at 2 GB. That's roughly **60–180 game-hours/month**.
- Hobby has no on-demand usage, so these quotas are **hard ceilings**. Idle sockets eat the memory quota, which is why the idle policy (§3.1.2) matters. Active CPU is spent only while handling messages and should stay far below 4 h.

#### 3.1.1 Design
- **One Node entry** exports an `http.Server` with the Express app and Socket.IO attached. It's the same code locally (where it calls `listen`) and on Vercel.
- **Commands:** the Socket.IO `action` event with an ack is the primary path. `POST /actions` uses the same dispatcher (§7.1) and serves tests and the fallback.
- **Push:** after any change, every connected player gets `session:state`, a snapshot **projected for that player**. The instance holding the socket builds it from the DB row.
- **Game data never goes through the relay.** Relay messages only say "session X changed, now at version N" (§3.2).

#### 3.1.2 Connection lifetime & idle policy
- Max duration: `maxDuration: 300` in `vercel.json` (the Hobby maximum, which is also the default).
- The client reconnects automatically. On every (re)connect the server sends a snapshot. The UI should hide a "reconnecting" state that lasts less than about 3 s.
- **Idle policy** (memory is billed while sockets are open):
  - The client disconnects when the tab has been hidden for **more than 60 s** and reconnects when it becomes visible.
  - The server disconnects sockets of `finished` or expired sessions.
  - The server disconnects sockets whose session hasn't changed for **20 min** (`session:idle`). The client reconnects on user interaction or visibility.

#### 3.1.3 Fallback: HTTP short polling
Used when the socket can't connect: 3 failed attempts in a row, a proxy blocking WebSockets, or a beta outage. While in fallback, the client retries the socket every 60 s.
- `GET /api/sessions/:code/state` returns the same projected view with an `ETag`. Clients send `If-None-Match` and get `304` when nothing changed. Express does this automatically for `GET` + `res.json`. Set `Cache-Control: private, no-cache`.
- The view must not contain anything that changes on every request (such as `serverNow`), or the ETag never matches.
- The view carries `poll.intervalMs`: `pending` 3000 · `in_progress` 1500 · `finished` 10000. Hidden tab: 10000 (client rule).

### 3.2 Cross-instance relay: Supabase Realtime Broadcast (server-only)
Players in one session can be connected to different instances, so every instance holding sockets for a session must hear about changes.

- **Relay:** Supabase Realtime Broadcast on a **private** channel `sencha-game-session:<sessionId>`. It's used **only by the server** with the service-role key; clients never subscribe. That means no new vendor: supabase-js is already a dependency, and the project's Realtime is ready.
- **Publish** after every successful save: `channel.httpSend('changed', { version, reason })`. It's a plain REST call with no subscription needed, so it works from any instance (supabase-js ≥ 2.107).
  - `reason: 'state'` after a game or lobby change.
  - `reason: 'presence'` after an online/offline transition.
- **Subscribe:** an instance subscribes to a session's channel when its first local socket for that session connects, and unsubscribes when the last one leaves. Each instance uses one Realtime connection. The Free tier allows 200 concurrent connections and 100 msg/s, which is plenty.
- **On a message:** if `reason = 'state'` and the version is ≤ the last version this instance emitted, ignore it. Otherwise reload the row (coalesced, so a burst of messages causes one reload) and emit per-player snapshots to the local sockets.
- **Safety net for dropped messages:** every 15 s, each instance runs one query for the versions of the sessions it holds (`select id, version, expires_at … where id in (…)`). It re-emits if any version is newer than what it sent. The same tick enforces expiry.
- **Local fast path:** the instance that saved the change also emits to its own sockets immediately, without waiting for the relay.
- The relay sits behind a `SessionBus` interface. There's an in-memory implementation for tests and local single-process dev, and it can be swapped for Upstash Redis pub/sub (Vercel's recommendation) if Realtime turns out unreliable.

Alternatives considered:
- **Postgres `LISTEN/NOTIFY`:** needs a long-lived direct or session-mode DB connection per instance. Supabase direct connections are IPv6-only without an add-on. Rejected.
- **Clients subscribing to Supabase Realtime directly:** a second protocol and the anon key in the client. Rejected.
- **Redis:** a new vendor. Kept as the swap-in option.

### 3.3 Persistence: one row per session
- One table, `sencha_game_session`, holds one row per session. Queryable fields become columns (`code`, `status`, `game_type`, `expires_at`, …). Everything else (players, settings, game state, history) goes in a `state jsonb` column.
- **The DB is the only source of truth.** Instances share no memory, and reconnects and deploys move clients between instances. Memory only holds per-instance socket bookkeeping.
- Player presence ("last seen") is in a separate `presence jsonb` column on the same row (§3.9), so presence updates never touch `state`/`version`.

### 3.4 Concurrency: optimistic locking
Several players often submit answers within the same second, each possibly on a different instance. With one JSON row, naive read-modify-write **loses answers**.

- The row has a `version integer` column.
- Every mutation: load row → run the pure reducer → `update ... where id = :id and version = :version` → `version + 1`.
- If 0 rows were updated, another write won. Reload and re-run the reducer, up to **10 attempts** with exponential, fully jittered backoff (25 ms base, 1 s cap), then return `409 conflict`. (Originally 5 attempts; the 10-parallel-joins test showed that a burst of N simultaneous writers needs up to N rounds, so 5 immediate retries dropped joins.)
- Reducers are pure (`state + action → new state`), so re-running them is safe.
- The compare-and-swap update writes only `state`, `status`, `host_player_id`, `version` and `updated_at`. It **never writes `presence`**.

### 3.5 Hidden information: server-side projection
- Clients **never** get the raw row. Every HTTP response and socket push goes through `projectSessionView(session, viewerPlayerId, now)`, which calls the game module's `project(gameState, viewer)`.
- The table has RLS enabled with **no policies**, so only the service-role key (server) can read it.
- Relay messages carry only `{ version, reason }`. No game data passes through Realtime.
- Secrets (player token hashes, password hash) are removed through a whitelist during projection, never through a blacklist.

### 3.6 Anonymous player identity
- On create or join, the server generates a `playerId` (uuid) and a `playerToken` (32 random bytes, base64url).
- Only `sha256(playerToken)` is stored in `state.players[]`. The raw token is returned **once**, and the client keeps it in `localStorage` to reconnect.
- HTTP: header `X-Player-Token: <token>`. It's kept separate from the existing `Authorization: Bearer` Supabase auth.
- Socket.IO: handshake `auth: { code, playerToken }`.
- **Lost token → just rejoin.** There's no reclaim flow. The player joins again through `/join` and becomes a new player with a fresh score.
  - Nicknames are unique only among **online** active players. If the nickname is held by an active player who has been **offline for more than 30 s** (§3.9), that stale record is set to `left` (with the same side effects as leaving), and the new player takes the nickname.
  - If the nickname belongs to an online player → `409 nickname-taken`.

### 3.7 Session code & password
- The code is 6 digits, stored as text so leading zeros are allowed (`"004213"`), and generated with `crypto.randomInt(0, 1_000_000)`.
- It's unique **among non-archived sessions** (partial unique index). On create, archive expired rows with the same code, then insert. Retry with a new code on a unique violation (`23505`), up to 10 times.
- The optional password is hashed with Node's built-in `crypto.scrypt` (random salt) and checked with `timingSafeEqual`.
- **Rate limiting** (6-digit codes are enumerable): in-memory `express-rate-limit` is only best-effort, because each instance counts separately. The real protection is a **Vercel WAF rate-limit rule**. Hobby allows **1 rule per project** (fixed window, keyed by IP, 1M allowed requests included), so a single rule uses one regex path condition covering the abuse-prone endpoints: `^/api/sessions/[0-9]{6}/(join|info)$` and the Socket.IO path. It applies to upgrade requests too. Example: 30 requests per 60 s per IP. `/state` and `/actions` rely on in-app limits instead.

### 3.8 Expiry (24 h)
- `expires_at = created_at + interval '24 hours'`, set by the DB default.
- HTTP: enforced lazily. `info` returns `joinable: false`; `join`, `state` and `actions` return **410 Gone**.
- Sockets: the connection is refused with `gone`. Connected sockets get `session:expired` and are disconnected by the instance's 15 s tick (§3.2).
- No cron jobs. The code of an expired session is freed lazily at `create` (§3.7). Rows are **never deleted**.

### 3.9 Presence (online / offline)
Presence is only for the UI (game rules never depend on it; force reveal and host `skipRound` handle idle players). It's best-effort.

- `presence` column: `{ "<playerId>": "<ISO lastSeenAt>" | null }`. Updated only through the RPC `sencha_game_session_presence(session_id, player_ids[], online)`, an atomic merge with no version bump.
- **Socket connect:** mark the player online. If they were offline before → publish `reason: 'presence'`.
- **Heartbeat:** each instance, every 10 s, makes one RPC per session it holds, covering all its connected players.
- **Socket disconnect:** after a 5 s grace period, if the player hasn't reconnected (no local socket, and `lastSeenAt` is older than the disconnect time, which covers a reconnect to another instance) → mark offline + publish `reason: 'presence'`. This hides the planned reconnects at max duration.
- **Polling fallback:** `GET /state` marks the caller online, throttled to once per 10 s.
- Projection: `isOnline = lastSeenAt != null && now - lastSeenAt < 30 s`.

---

## 4. Database

### 4.1 Required DB objects (created manually by the owner)

There are no migration files in the repo. The owner creates the objects below in Supabase before Phase 1. The SQL is a reference for exactly what the code expects.

> Columns are snake_case so SQL and the RPC need no quoting. The repository layer maps them to camelCase TS.

```sql
create table if not exists public.sencha_game_session (
  id              uuid primary key default gen_random_uuid(),
  code            text not null check (code ~ '^[0-9]{6}$'),
  game_type       text not null,                      -- 'sen-reveal' | 'number-guess' | 'who-am-i'
  status          text not null default 'pending'
                  check (status in ('pending', 'in_progress', 'finished')),
  password_hash   text,                               -- null = no password
  host_player_id  uuid not null,
  state           jsonb not null default '{}'::jsonb,  -- players, settings, game state
  presence        jsonb not null default '{}'::jsonb,  -- { playerId: lastSeenAt | null }, no version bump
  version         integer not null default 1,
  archived        boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '24 hours')
);

-- a code is unique only among live sessions
create unique index if not exists sencha_game_session_code_live_uq
  on public.sencha_game_session (code) where archived = false;

-- only the service role (API server) may access the table
alter table public.sencha_game_session enable row level security;

-- atomic presence update for one or many players (does not change state/version)
create or replace function public.sencha_game_session_presence(
  p_session_id uuid, p_player_ids uuid[], p_online boolean
)
returns void
language sql
as $$
  update public.sencha_game_session
     set presence = presence || (
       select coalesce(jsonb_object_agg(
                pid::text,
                case when p_online then to_jsonb(now()) else 'null'::jsonb end
              ), '{}'::jsonb)
         from unnest(p_player_ids) as pid
     )
   where id = p_session_id and archived = false;
$$;

revoke execute on function public.sencha_game_session_presence(uuid, uuid[], boolean)
  from public, anon, authenticated;
```

Checklist of what the code depends on:
- [ ] table `sencha_game_session` with the columns above (names and types)
- [ ] partial unique index on `code where archived = false` (the code-collision retry relies on error `23505`)
- [ ] RLS enabled, no policies
- [ ] function `sencha_game_session_presence(uuid, uuid[], boolean)`
- [ ] Realtime enabled in the project. There must be **no** `realtime.messages` RLS policy that lets `anon`/`authenticated` join `sencha-game-session:*` topics, so private channels stay server-only (the service role bypasses RLS)

### 4.2 `state` JSON shape

```ts
interface SessionState<TGame = unknown, TSettings = unknown> {
  players: PlayerRecord[];
  settings: CoreSettings & TSettings;
  game: TGame | null;          // null while pending; game module owns this
}

interface PlayerRecord {
  id: string;                  // uuid
  nickname: string;            // 1..20 chars, unique among online active players (case-insensitive, §3.6)
  tokenHash: string;           // sha256(playerToken) — never projected
  joinedAt: string;            // ISO
  status: 'active' | 'left' | 'kicked';
}

interface CoreSettings {
  maxPlayers: number;          // default 20
  allowJoinInProgress: boolean;// true (confirmed); kept as a setting for future games
}
```

Rough size: 20 players × a few hundred rounds of history easily fits in jsonb. History is capped at the last 200 rounds.

---

## 5. Code structure

Follows the existing layered layout, plus `games/` and `realtime/`.

```
src/
  app.ts                           # build Express app (cors, json limit, routes)
  index.ts                         # http.createServer(app) + attachSocketServer; listen locally; export default server (Vercel)
  models/
    result.ts                      # + 'gone' (410), 'too-many-requests' (429), map 'conflict' → 409
    session.model.ts               # SessionRow, SessionState, PlayerRecord, SessionStatus, SessionView
    action.model.ts                # ActionRequest, ActionContext
  services/
    serviceFactory.ts              # register new services
    sessionRepository.service.ts   # Supabase access: insertWithUniqueCode, findLiveByCode, compareAndSwap, getVersions, setPresence
    session.service.ts             # create / info / join / getView / dispatchAction (pipeline §7)
    lobby.actions.ts               # start, kick, transferHost, end, leave (game-agnostic)
    senRevealSession.service.ts    # DELETE (replaced)
  routes/
    index.ts                       # fix broken import; mount /api/sessions
    session.routes.ts
  middlewares/
    requirePlayer.ts               # X-Player-Token → resolves player within :code session
    validateBody.ts                # zod schema validation → 400
    rateLimit.ts                   # best-effort express-rate-limit (real limit = Vercel Firewall)
  realtime/
    socketServer.ts                # Socket.IO (websocket transport only), CORS, handshake auth, 'action' with ack
    localSessions.ts               # per-instance registry: sessionId → { sockets, lastEmittedVersion, expiresAt, lastChangeAt }
    broadcaster.ts                 # reload row (coalesced) → per-socket projection → emit
    sessionBus.ts                  # SessionBus interface + SupabaseRealtimeBus + InMemoryBus
    presenceTracker.ts             # connect/disconnect grace, 10 s heartbeat
    maintenanceTick.ts             # 15 s: version safety net, expiry, idle disconnect
  games/
    gameModule.ts                  # GameModule interface (§6)
    gameRegistry.ts                # gameType → module
    shared/
      turnRotation.ts              # circle-based random rotation (reused by number-guess)
    sen-reveal/
      senReveal.module.ts
      senReveal.state.ts
      senReveal.actions.ts
      senReveal.projection.ts
      senReveal.module.test.ts
  utils/
    random.ts                      # Rng interface over crypto.randomInt (injectable for tests)
    crypto.ts                      # token generation, sha256, scrypt hash/verify
    sessionCode.ts
    pollInterval.ts                # status → poll.intervalMs (fallback)
```

Dependencies:
- **New:** `socket.io`, `zod`, `express-rate-limit`.
- **Upgrade:** `@supabase/supabase-js` to ≥ 2.107 (`httpSend`).
- **Dev:** `vitest`, `supertest`, `socket.io-client`.
- **Node:** set `engines.node` to `22.x` or newer (native `WebSocket` for the Realtime client).

---

## 6. Game module abstraction

The core session code handles players, lobby, host, expiry, presence, persistence and delivery. Each game supplies only this module:

```ts
export interface GameModule<TState, TSettings, TView> {
  type: GameType;                                   // 'sen-reveal' | 'number-guess' | 'who-am-i'
  minPlayers: number;
  maxPlayers: number;

  settingsSchema: z.ZodType<TSettings>;             // validated on create
  defaultSettings: TSettings;

  /** Called by lobby `start`. */
  createInitialState(ctx: GameContext<TSettings>): Result<TState>;

  /** Action handlers keyed by action type, each with its own payload schema. */
  actions: Record<string, {
    schema: z.ZodTypeAny;
    handle(ctx: GameContext<TSettings>, state: TState, payload: unknown): Result<GameTransition<TState>>;
  }>;

  /** Keep the game consistent when the roster changes mid-game. */
  onPlayerJoined?(ctx: GameContext<TSettings>, state: TState, playerId: string): TState;
  onPlayerRemoved?(ctx: GameContext<TSettings>, state: TState, playerId: string): GameTransition<TState>;

  /** Per-viewer view of the state. The ONLY way game data leaves the server. Must be deterministic (ETag). */
  project(state: TState, viewerId: string, ctx: GameContext<TSettings>): TView;
}

export interface GameContext<TSettings> {
  actorId: string;                 // player performing the action / viewing
  hostPlayerId: string;
  activePlayers: PlayerRecord[];   // status === 'active'
  settings: TSettings;
  now: Date;
  rng: Rng;                        // injected → deterministic tests
}

export interface GameTransition<TState> {
  state: TState;
  finished?: boolean;              // module can end the game → session.status = 'finished'
}
```

Rules:
- Handlers are **pure**: no DB, no sockets, no `Date.now()`/`Math.random()` (use `ctx.now`/`ctx.rng`).
- Action type on the wire is namespaced: `lobby.start`, `sen-reveal.submitAnswer`, …
- The dispatcher rejects game actions whose namespace doesn't match `session.game_type`, and any game action while the status isn't `in_progress`.
- There are no pushed "events". The UI works out transitions (new round, revealed, new player) by comparing consecutive snapshots, using `round.number` and `phase`. Snapshots can be re-sent or skipped (reconnects, coalescing), so events would be unreliable anyway.

---

## 7. Request pipelines

### 7.1 Actions (`SessionService.dispatchAction`), used by the socket `action` event and `POST /actions`

```
1. Validate envelope { type, payload } (zod)
2. loop attempt = 1..5:
   a. row = repository.findLiveByCode(code)            → 404 if none
   b. if row.expires_at <= now                          → 410
   c. actor = players.find(tokenHash match)             → 401 unknown; 403 { code: 'kicked' } / 'left'
   d. route: 'lobby.*' → lobby.actions ; '<gameType>.*' → module.actions[...]
   e. validate payload with the handler's schema        → 400
   f. result = handler(ctx, state, payload)             → 400/403/409 business errors as Result failures
   g. saved = repository.compareAndSwap(row.id, row.version, newRow)
   h. if saved → break ; else continue (reload & re-run)
3. if not saved → 409 conflict
4. broadcaster.emitLocal(savedRow)                      # fast path: sockets on this instance
5. bus.publish(savedRow.id, { version: savedRow.version, reason: 'state' })   # other instances
6. return projectSessionView(savedRow, actor.id, now)   # HTTP response body / socket ack
```

Joining uses the same compare-and-swap loop. Inside the loop it checks nickname uniqueness (including replacing a stale offline holder, §3.6), `maxPlayers`, and `onPlayerJoined`. Then steps 4–5 run.

### 7.2 Socket connect

```
1. handshake auth { code, playerToken } → load row → 404 / 410 gone / 401 / 403 → connect_error { code }
2. localSessions.add(sessionId, socket) → first socket for this session on this instance → bus.subscribe(sessionId)
3. presenceTracker.connected(player)   → RPC online; if was offline → bus.publish(reason 'presence') + emitLocal
4. socket.emit('session:state', projectSessionView(row, player.id, now))
```

On disconnect: `localSessions.remove`. If it was the last socket for the session → `bus.unsubscribe`. Then `presenceTracker.disconnected(player)` (5 s grace, §3.9).

### 7.3 Relay message (`SessionBus` → `broadcaster`)

```
on { sessionId, version, reason }:
  if reason = 'state' and version <= lastEmittedVersion(sessionId) → ignore
  schedule coalesced reload (≤ 1 in flight per session; re-run once if more messages arrived meanwhile)
  row = findById(sessionId)
  for socket in localSessions.sockets(sessionId):
     player = row.players[socket.playerId]
     if player.status != 'active' → emit 'player:removed' { reason } + disconnect
     else emit 'session:state' projectSessionView(row, player.id, now)
  lastEmittedVersion = row.version
```

### 7.4 Polling fallback (`SessionService.getView`)

```
1. row = findLiveByCode(code)                           → 404
2. expired                                              → 410
3. resolve player by token                              → 401 / 403 kicked|left
4. if presence[player] older than 10 s → repository.setPresence(row.id, [player.id], true)
5. view = projectSessionView(row, player.id, now)
6. res.set('Cache-Control', 'private, no-cache'); res.json(view)   → Express returns 304 on matching ETag
```

---

## 8. SenReveal game design

### 8.1 Rules

1. The host can start when there are at least **3 active players**.
2. The server picks the active player at random with the rotation below.
3. The active player asks a question. Typing it (`setQuestion`) is **optional**. They can set or change it at any time before the reveal, and it shows on everyone's screen. If no question was entered, the view has `question: null`. The UI then shows a placeholder, e.g. *"<nickname> asks the question out loud"*. The placeholder text lives in the UI, not the API.
4. Every other **eligible** player submits a free-text answer (1–200 chars, trimmed). They can change it until the reveal. Nobody sees other answers, the active player included. Others only see *who* has answered.
5. When **all eligible players have answered**, the active player can `reveal`. The active player can also **force reveal** (`force: true`) any time once at least 1 answer exists.
6. After the reveal, all answers are visible to everyone.
7. The active player picks a `winnerId` and a `loserId` from the players who answered. They must be different. The loser can be null only if exactly one answer exists (possible after a force reveal).
8. The pick is final. It's recorded in history and the scoreboard (wins/losses), and the round moves to phase `resolved`. Everyone sees the result screen (answers + winner + loser).
9. In `resolved`, the **active player presses "Next"** (`nextRound`). Only then does the rotation pick the next active player and start a new round.
10. The host can `end` the game at any time → `finished`. The session stays readable until it expires.

### 8.2 Turn rotation (confirmed)

**Each circle, every player is active exactly once, in random order.**

```
circle = { number, remainingPlayerIds[], completedPlayerIds[] }

pickNextActive(state, activePlayerIds, rng):
  remaining = circle.remaining ∩ activePlayerIds
  if remaining is empty:                       # circle finished → start a new one
     circle.number++
     circle.completed = []
     remaining = activePlayerIds
     if remaining.length > 1: exclude lastActivePlayerId from the first pick (no back-to-back turns)
  next = rng.pick(remaining)
  move next from remaining → completed
```

- A player who joins mid-game is added to `remaining` of the current circle (`onPlayerJoined`).
- A player who leaves or is kicked is removed from `remaining`. If they were the **active** player: in `answering`/`revealed` the round is cancelled (not recorded) and the next active player is picked; in `resolved` the result is already recorded, so the next round just starts (nobody else can press "Next"). If they were an answerer, they're removed from `eligiblePlayerIds` and their answer is dropped.
- If fewer than 3 active players remain mid-game, the game pauses (`round = null`, `pausedReason: 'not-enough-players'`) until someone joins, or the host ends it.

Lives in `games/shared/turnRotation.ts` so number-guess can reuse it.

### 8.3 State

```ts
interface SenRevealSettings {
  minPlayers: number;               // 3
  maxAnswerLength: number;          // default 200
}

interface SenRevealState {
  circle: { number: number; remainingPlayerIds: string[]; completedPlayerIds: string[] };
  lastActivePlayerId: string | null;
  round: SenRevealRound | null;     // null only when paused
  pausedReason: 'not-enough-players' | null;
  history: SenRevealRoundResult[];  // capped at 200
  scoreboard: Record<string, { wins: number; losses: number; turns: number }>;
}

interface SenRevealRound {
  number: number;
  activePlayerId: string;
  phase: 'answering' | 'revealed' | 'resolved';
  question: string | null;          // null → UI placeholder
  eligiblePlayerIds: string[];      // active players at round start, minus the active player, plus mid-round joiners
  answers: Record<string, { value: string; submittedAt: string }>;
  startedAt: string;
  revealedAt: string | null;
  winnerId: string | null;          // set in 'resolved'
  loserId: string | null;
  resolvedAt: string | null;
}

interface SenRevealRoundResult {
  roundNumber: number;
  activePlayerId: string;
  question: string | null;
  answers: Record<string, string>;
  winnerId: string;
  loserId: string | null;
  resolvedAt: string;
}
```

### 8.4 Actions

| Action | Who | Phase | Payload | Effect / errors |
|---|---|---|---|---|
| `sen-reveal.setQuestion` | active player | `answering` | `{ text: string ≤ 300 }` | sets `round.question`; empty/whitespace text → `null` (back to placeholder) |
| `sen-reveal.submitAnswer` | eligible non-active player | `answering` | `{ value: string }` | upsert own answer; 403 if active player/not eligible |
| `sen-reveal.reveal` | active player | `answering` | `{ force?: boolean }` | `phase = 'revealed'`; 409 if not all answered and not forced; 409 if 0 answers |
| `sen-reveal.pickResult` | active player | `revealed` | `{ winnerId, loserId }` | validate ids ∈ answered, distinct; set winner/loser, append to history, update scoreboard, `phase = 'resolved'` |
| `sen-reveal.nextRound` | active player | `resolved` | `{}` | rotate and start the next round (`phase = 'answering'`) |
| `sen-reveal.skipRound` | host | any | `{}` | for an AFK active player. In `answering`/`revealed`, cancel the round without a result; in `resolved`, keep the result. Then rotate |

Lobby actions (game-agnostic, `lobby.actions.ts`):

| Action | Who | Status | Effect |
|---|---|---|---|
| `lobby.start` | host | `pending` | check minPlayers → `module.createInitialState` → `in_progress` |
| `lobby.kick` `{ playerId }` | host | any | status `kicked`, `onPlayerRemoved`; the kicked player's sockets (on any instance, §7.3) get `player:removed { reason: 'kicked' }` and are disconnected; polling clients get `403 { code: 'kicked' }` |
| `lobby.transferHost` `{ playerId }` | host | any | change `host_player_id` |
| `lobby.leave` | self | any | status `left`; if host → host passes to the earliest-joined active player; if nobody is left → `finished` |
| `lobby.end` | host | `in_progress` | `finished` |

### 8.5 Projection (what each viewer receives)

| Field | Active player (`answering`) | Other player (`answering`) | `revealed` / `resolved` (everyone) |
|---|---|---|---|
| `round.activePlayerId`, `question`, `phase` | ✅ | ✅ | ✅ |
| `round.answeredPlayerIds` | ✅ | ✅ | ✅ |
| `round.myAnswer` | — | own answer only | own answer |
| `round.answers` (all) | ❌ | ❌ | ✅ |
| `round.winnerId`, `loserId` | — | — | ✅ in `resolved` |
| `round.canSetQuestion`, `canReveal`, `canForceReveal` | ✅ computed | `false` | `false` |
| `round.canPickResult` | `false` | `false` | active player in `revealed` |
| `round.canGoNext` | `false` | `false` | active player in `resolved` |
| `scoreboard`, `circle.number` | ✅ | ✅ | ✅ |

The `can*` flags let the UI show buttons (Reveal, Pick, Next) without repeating the rules on the client.

`history` isn't part of the pushed/polled view (it keeps payloads small). It's available from `GET /api/sessions/:code/history`.

---

## 9. API contract

### 9.1 HTTP (`/api/sessions`)

All player endpoints require `X-Player-Token`. Error body: `{ error: { code: ErrorStatus | 'kicked' | 'left' | 'nickname-taken', message } }`. This extends the current plain-string error; the existing auth routes stay unchanged.

| Method & path | Auth | Body | Response |
|---|---|---|---|
| `POST /api/sessions` | — | `{ gameType: 'sen-reveal', nickname, password?, settings? }` | `201 { playerId, playerToken, session: SessionView }` |
| `GET /api/sessions/:code/info` | — (rate-limited) | — | `{ code, gameType, status, requiresPassword, playerCount, maxPlayers, joinable, expiresAt }` / 404 |
| `POST /api/sessions/:code/join` | — (rate-limited) | `{ nickname, password? }` | `{ playerId, playerToken, session }` / 401 wrong password / 404 / 409 nickname taken by an online player, or session full / 410 expired |
| `GET /api/sessions/:code/state` | player | — (+ `If-None-Match`) | `200 SessionView` + `ETag` / `304` / 401 / 403 kicked\|left / 404 / 410 |
| `POST /api/sessions/:code/actions` | player | `{ type, payload }` | `SessionView` after the action |
| `GET /api/sessions/:code/history` | player | — | `SenRevealRoundResult[]` (game-specific) |

```ts
interface SessionView<TGameView = unknown> {
  code: string;
  gameType: GameType;
  status: 'pending' | 'in_progress' | 'finished';
  version: number;                 // clients ignore a snapshot older than the one they hold
  createdAt: string;
  expiresAt: string;
  hostPlayerId: string;
  me: { playerId: string; nickname: string; isHost: boolean };
  players: { id: string; nickname: string; isHost: boolean; isOnline: boolean; joinedAt: string }[];
  settings: unknown;
  poll: { intervalMs: number };    // used only in polling fallback
  game: TGameView | null;
}
```

### 9.2 Socket.IO

**Connect:** `io(API_URL, { path: '/socket.io', transports: ['websocket'], auth: { code, playerToken } })`. The final path is confirmed in the Phase 0 spike, because it depends on the Vercel entry style. Invalid → `connect_error` with `data: { code: 'not-found' | 'unauthorized' | 'kicked' | 'left' | 'gone' }`.

| Direction | Event | Payload |
|---|---|---|
| S → C | `session:state` | `SessionView` projected for this player (on connect and after every change) |
| S → C | `session:expired` | `{ expiresAt }`, then the server disconnects |
| S → C | `session:idle` | `{}`, then the server disconnects (no changes for 20 min) |
| S → C | `player:removed` | `{ reason: 'kicked' \| 'left' \| 'replaced' }`, then the server disconnects |
| C → S | `action` | `{ type, payload }`, ack `(res: { ok: true, session: SessionView } \| { ok: false, error: { code, message } })` |

### 9.3 Client contract (for the UI developer)
1. After create/join, store `{ code, playerToken }` in `localStorage`.
2. Connect the socket (websocket transport only). Let Socket.IO auto-reconnect; the server closes connections every 5 min by design (Vercel Hobby max duration). Hide a "reconnecting" indicator that lasts less than about 3 s.
3. Send actions through `socket.emit('action', …, ack)`. If the socket isn't connected, use `POST /actions`.
4. Replace local state with a snapshot, ack or HTTP response only if its `version` is ≥ the current one.
5. Tab hidden for more than 60 s → `socket.disconnect()`. Visible again → `socket.connect()`. On `session:idle`, reconnect on the next user interaction or visibility change.
6. **Fallback:** after 3 failed connect attempts in a row, switch to polling `GET /state` with `If-None-Match` every `view.poll.intervalMs` (10 s while hidden). Only one poll in flight at a time. Try the socket again every 60 s; once it connects, stop polling.
7. `session:expired` / `410` → show "expired" and stop. `player:removed` / `403 kicked|left` / `401` → clear the token, stop, and offer "Join again".

---

## 10. Implementation phases

Each phase ends in a working, testable state.

**Status (2026-09-13):** Phases 0–5 are implemented, with all automated tests passing (`npm run test:run`, 56 tests, in-memory repo and bus). The in-app parts of Phase 6 are also done: rate limits, socket payload guard, per-socket action limit, structured logs, README. Still open:
- **Phase 0:** the Vercel preview spike (Fluid compute, WebSocket upgrade through `vercel.json`, Socket.IO path, cross-instance `httpSend`).
- **Phase 1:** the owner creates the DB objects from §4.1, then runs `npm run smoke:db`.
- **Phase 5:** the manual 3-browser preview test.
- **Phase 6:** the WAF rule and `sen-reveal.api-contract.md`.
- **Phase 7:** all of it.

Deviations and additions made during implementation:
- Compare-and-swap retries: 10 attempts with jittered backoff (§3.4).
- `GameContext.status` added, so projections disable `can*` flags once the session isn't `in_progress`.
- `GameModule.getHistory` (optional) backs `GET /history`.
- `SenRevealState.lastRoundNumber` added, so round numbers survive pauses and cancelled rounds.
- `PlayerRecord.removalReason` added, which carries `'replaced'` for `player:removed`.
- The view's `scoreboard` is an array ordered by active players, and `round.answers` is an array ordered by eligible players. Both keep the JSON deterministic, because jsonb reorders object keys.
- A player whose presence was explicitly set offline (`null`) counts as stale for nickname replacement. The offline timestamp isn't kept.
- Error codes `session-full` and `session-finished` were added.
- `vercel.json` is unchanged: 300 s is already the Hobby default, and the legacy `builds` config can't be combined with `functions.maxDuration` (revisit in the spike).
- Session services are wired in `src/runtime.ts` rather than `serviceFactory`, because they share per-instance socket state.

### Phase 0 — Housekeeping + Vercel WebSocket spike
- [ ] Fix [src/routes/index.ts](../../src/routes/index.ts): remove the undefined `useSenRevealSessionRoutes`, and delete `senRevealSession.service.ts` and its registration in `serviceFactory.ts`.
- [ ] Split `src/app.ts` (Express app) from `src/index.ts` (`http.createServer(app)`, attach Socket.IO, `listen` only when not on Vercel, `export default server`).
- [ ] Add `socket.io`, `zod`, `express-rate-limit`; upgrade `@supabase/supabase-js` to ≥ 2.107. Add dev `vitest`, `supertest`, `socket.io-client`. Add a `"test": "vitest"` script and `engines.node`.
- [ ] `result.ts`: add `gone`, `too-many-requests`. `requestUtils.getStatusCode`: map `conflict→409`, `gone→410`, `too-many-requests→429`.
- [ ] `middlewares/validateBody.ts` (zod), `express.json({ limit: '32kb' })`.
- [ ] **Spike on a Vercel preview deployment (go/no-go for WebSockets):**
  - Fluid compute is enabled for the project.
  - A Socket.IO echo with `transports: ['websocket']` connects through the current `vercel.json`. If not, switch to the documented entry (`api/server.ts` exporting the `http.Server`) and record the resulting Socket.IO `path`.
  - The connection closes at `maxDuration` and the client reconnects.
  - Two clients can land on different instances (log an instance id). A Supabase `httpSend` from one instance reaches a subscription on the other.
  - **No-go** → Phases 1–4 are unaffected; Phase 5 is replaced by polling only (§3.1.3), which is already fully specified.
- **Done when:** `npm run build` passes, `GET /api` works locally and on preview, and the spike result is recorded here.

### Phase 1 — Database & repository
- [ ] **Prerequisite (owner):** DB objects from §4.1 exist in Supabase.
- [ ] `sessionRepository.service.ts`:
  - `insertWithUniqueCode(row)`: archive expired rows with the same code, insert, retry on `23505`.
  - `findLiveByCode(code)` / `findById(id)`: `archived = false`.
  - `compareAndSwap(id, expectedVersion, patch)`: `update … eq('id').eq('version') .select()`. Returns `null` if no row was updated. Never includes `presence`.
  - `getVersions(ids)`: `id, version, expires_at` for the safety-net tick.
  - `setPresence(id, playerIds, online)`: `rpc('sencha_game_session_presence')`.
- [ ] A repository interface plus an in-memory implementation for tests.
- **Done when:** a manual script creates, reads and CAS-updates a row; a stale version update returns `null`; a presence update doesn't change `version`.

### Phase 2 — Core sessions over HTTP (lobby, no game yet)
- [ ] `utils/crypto.ts` (token, sha256, scrypt), `utils/sessionCode.ts`, `utils/random.ts`, `utils/pollInterval.ts`.
- [ ] `session.model.ts`, `projectSessionView` (whitelist-based, deterministic).
- [ ] `session.service.ts`: `create`, `info`, `join`, `getView` (§7.4), `dispatchAction` (§7.1). Bus publish goes through an injected `SessionBus` (no-op until Phase 5).
- [ ] `lobby.actions.ts`: start (calls the registry), kick, transferHost, leave, end.
- [ ] `middlewares/requirePlayer.ts`, `middlewares/rateLimit.ts`, `routes/session.routes.ts`.
- [ ] Validation: nickname 1–20 chars trimmed, unique case-insensitive among online active players; password ≤ 64; `maxPlayers`.
- **Tests:** create → join → wrong password 401 → nickname of an online player 409 → same nickname after the holder has been offline for 30 s succeeds and the old record becomes `left` → join while `in_progress` succeeds → expired 410 (fake `now`) → kick → kicked player's `GET /state` 403 → host leaves → host transferred. Concurrent joins: 10 parallel joins against the in-memory repo with forced conflicts → all 10 present.
- **Polling tests:** a second `GET /state` with the returned `ETag` → 304; after another player's action → 200 with a new ETag; presence update throttled to one per 10 s.
- **Done when:** the whole lobby flow works over HTTP.

### Phase 3 — Game module framework
- [ ] `games/gameModule.ts` (interface §6), `games/gameRegistry.ts`.
- [ ] Wire `lobby.start` and namespaced game actions through the registry. Call the roster hooks on join, leave and kick.
- [ ] A tiny `test-game` module in tests to exercise the pipeline without SenReveal.
- **Done when:** a test game can be started and receives actions through `/actions`.

### Phase 4 — SenReveal module
- [ ] `games/shared/turnRotation.ts` + unit tests: every player is active once per circle, no back-to-back turn at a circle boundary, joiners are added, leavers are removed.
- [ ] `senReveal.state.ts`, `senReveal.actions.ts` (§8.4), `senReveal.projection.ts` (§8.5), `senReveal.module.ts`. Register it. `GET /history`.
- **Unit tests** (seeded rng):
  - Answers are hidden from the active player and from other players before the reveal (check the whole serialized view, not just `answers`), and visible to all after.
  - Reveal blocked until all answered; force reveal allowed with ≥ 1 answer, rejected with 0.
  - Only the active player can reveal or pick; winner ≠ loser; ids must have answered; null loser only with exactly one answer.
  - `setQuestion` is optional: a round can be revealed with `question: null`; empty text resets it to `null`; rejected after the reveal.
  - `pickResult` → `resolved` with winner/loser visible to all; a second `pickResult` is rejected; the next round doesn't start until the active player's `nextRound`; `nextRound` from others → 403.
  - The active player leaving mid-round cancels the round and rotates; leaving in `resolved` keeps the result and starts the next round; an answerer leaving drops their answer.
  - A player joining mid-round becomes eligible in the current round and is added to the current circle.
  - Pause when fewer than 3 players, resume when a player joins.
  - Scoreboard and history updated on `pickResult`; history capped at 200.
  - The projection is deterministic: the same state and viewer give the same JSON.
- **Integration test** (supertest, in-memory repo): 4 players play 2 full circles using only `/actions` + `/state`; parallel `submitAnswer` from 3 players loses no answer.
- **Done when:** the integration test passes.

### Phase 5 — Real-time layer (WebSockets)
- [ ] `realtime/sessionBus.ts`: `SessionBus { publish, subscribe, unsubscribe }` with `SupabaseRealtimeBus` (private channel, `httpSend`, service role) and `InMemoryBus`.
- [ ] `realtime/localSessions.ts`, `realtime/broadcaster.ts` (§7.3: coalesced reload, per-socket projection, removed-player handling).
- [ ] `realtime/socketServer.ts`: websocket-only transport, CORS from `corsUtils`, handshake auth (§7.2), `action` event → `dispatchAction` with ack.
- [ ] `realtime/presenceTracker.ts`: online on connect, 10 s heartbeat, 5 s disconnect grace, presence publishes (§3.9).
- [ ] `realtime/maintenanceTick.ts` (15 s): version safety net, expiry (`session:expired`), idle disconnect after 20 min (`session:idle`), `finished` sessions.
- [ ] `vercel.json`: `maxDuration: 300`.
- **Integration tests** (two Socket.IO servers in one test process sharing an `InMemoryBus` and in-memory repo = two "instances"):
  - 3 clients spread across both servers → start → answers → **every payload the active player's socket receives before `revealed` contains no answer values** → reveal → all clients receive the answers.
  - An action sent through server A reaches clients on server B.
  - A dropped bus message (the test bus drops it) is recovered by the safety-net tick.
  - Kicking a player on server A disconnects their socket on server B with `player:removed`.
  - Disconnect + reconnect to the other server within 5 s → no offline flicker (no `presence` publish).
  - An expired session → `session:expired` + disconnect.
- [ ] Manual test on a Vercel preview: 3 browsers, one full round, and one forced reconnect (wait out `maxDuration`) mid-round.
- **Done when:** the tests pass and the preview game survives reconnects without losing state.

### Phase 6 — Hardening & docs
- [ ] The one Hobby WAF rate-limit rule (§3.7): a regex path condition covering `/join`, `/info` and the Socket.IO path, 30 requests / 60 s per IP. Start with the **Log** action to check that normal reconnects (1 per player per 5 min) stay far below the limit, then switch to the 429 action.
- [ ] In-app best-effort limit for `/state` + `/actions` (e.g. 300/min per IP via `express-rate-limit`).
- [ ] Socket payload guard: reject `action` messages > 32 KB; per-socket action rate limit (in-memory is fine, because the socket is pinned).
- [ ] Structured error logging for 5xx; log CAS retry exhaustion, relay publish failures, and safety-net recoveries (a recovery means a relay message was dropped).
- [ ] `docs/implementation/sen-reveal.api-contract.md` for the UI developer: HTTP endpoints, socket events, client contract (§9.3), `SessionView` examples per phase (lobby, answering as active/other with and without a question, revealed, resolved). Include a note that `question: null` means "show the placeholder".
- [ ] Update the README: env vars, run, test, DB prerequisites.

### Phase 7 — Deployment (Vercel)
- [ ] Env on Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS` (move the hardcoded list in `corsUtils.ts` to env).
- [ ] Function region = Supabase project region.
- [ ] Check on the deployment that `ETag`/`304` works for the fallback (`Cache-Control: private, no-cache`).
- [ ] Smoke test from the deployed client origin: create, join from 3 browsers, play one round; block WebSockets in one browser (devtools) and confirm it plays through the polling fallback.
- [ ] After real sessions, review usage against the Hobby quotas in the Vercel dashboard (360 GB-hrs memory, 4 h active CPU, 1M invocations). They're hard ceilings, so tighten the idle policy (§3.1.2) if memory use trends toward the limit.

---

## 11. Future work

**Number guessing** (`number-guess`) — **built**, in `games/number-guess/`
- Reuses `turnRotation`, the round phases and the same projection shape, exactly as predicted: only its `actions` and `project` differ.
- Differences as built: the guess action is `submitGuess { value: number }`. The active player submits `setCorrectAnswer { value }` in the `revealed` phase instead of picking a winner, and that is what resolves the round. The module computes the closest (`winnerIds`) and furthest (`loserIds`) itself; both are arrays, so ties are shared, and `loserIds` is empty when every guess is the same distance out. No `pickResult`.
- Guesses and the answer are finite numbers in ±1e9; distances are rounded to 6 places before they are compared, so float noise never decides a tie.

**Who am I** (`who-am-i`) — **built**, in `games/who-am-i/`
- On `start` (and on the host's `nextRound`), the module seats everybody in a random single cycle: `assignments[giverId] = targetId`. A single cycle is a derangement, and it survives a leaver: giver → leaver → target becomes giver → target.
- No turns and no scoring. One phase, `playing`: each giver sends `submitName { name }` once (final). Until they have, the projection gives them only their own target (`cards: null`). After that, they see every card except their own.
- Host-only `reveal` flips every card, including each viewer's own, and records the round in the history. Missing names stay blank. Then the host's `nextRound` deals a fresh round.
- Mid-round joiners watch (they see every card) and are dealt in next round. In a revealed round, a leaver's card is left as it was.

**If real-time needs grow**
- Relay problems (dropped messages showing up in safety-net logs) → swap `SupabaseRealtimeBus` for an Upstash Redis pub/sub implementation of `SessionBus`.
- Vercel WebSockets beta limits or cost become a problem → the polling fallback already works on its own. A managed provider (Ably/Pusher) could replace `realtime/` without touching sessions or games.

---

## 12. Decisions log

No open questions. Confirmed:
1. **Vercel plan: Hobby.** 300 s connection lifetime, 2 GB fixed memory, hard quotas (360 GB-hrs memory, 4 h active CPU, 1M invocations/month), 1 WAF rate-limit rule.
2. **Stale nickname replacement** (§3.6): a rejoining player can take over a nickname whose holder has been offline for more than 30 s. The old record becomes `left`, and its score isn't carried over.
3. **Final pick** (§8.1): winner and loser can't be changed after `pickResult`, even before "Next".
4. **Skip for AFK players** (§8.4): only the host can skip a round when the active player doesn't respond.
5. **Idle thresholds** (§3.1.2): hidden tab 60 s, server idle 20 min.
