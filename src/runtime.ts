import { Server as HttpServer } from "node:http";
import { Application } from "express";
import { createApp, AppOptions } from "./app";
import { createDefaultGameRegistry, GameRegistry } from "./games/gameRegistry";
import { Broadcaster } from "./realtime/broadcaster";
import { LocalSessions } from "./realtime/localSessions";
import { SessionBus, SupabaseRealtimeBus } from "./realtime/sessionBus";
import { attachSocketServer, RealtimeHandle, RealtimeOptions } from "./realtime/socketServer";
import { SessionService, SessionServiceDeps } from "./services/session.service";
import { SessionRepository, SupabaseSessionRepository } from "./services/sessionRepository.service";
import { getSupabaseClient } from "./utils/supabaseDb";
import { cryptoRng, Rng } from "./utils/random";

export interface RuntimeOptions {
  repository: SessionRepository;
  bus: SessionBus;
  registry?: GameRegistry;
  clock?: () => Date;
  rng?: Rng;
  http?: AppOptions;
  realtime?: Partial<RealtimeOptions>;
  service?: Pick<SessionServiceDeps, "maxCasAttempts" | "retryDelayMs">;
}

export interface Runtime {
  app: Application;
  sessionService: SessionService;
  broadcaster: Broadcaster;
  localSessions: LocalSessions;
  registry: GameRegistry;
  attachRealtime(server: HttpServer): RealtimeHandle;
}

/** Composition root: one instance = one Express app + (optionally) one Socket.IO server. */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { repository, bus } = options;
  const registry = options.registry ?? createDefaultGameRegistry();
  const clock = options.clock ?? (() => new Date());
  const rng = options.rng ?? cryptoRng;

  const localSessions = new LocalSessions();
  const broadcaster = new Broadcaster({ repository, localSessions, registry, clock });
  const sessionService = new SessionService({ repository, registry, bus, clock, rng, ...options.service });
  sessionService.setSavedListener((row) => broadcaster.emitLocal(row));
  const app = createApp({ sessionService }, options.http);

  return {
    app,
    sessionService,
    broadcaster,
    localSessions,
    registry,
    attachRealtime: (server) =>
      attachSocketServer(
        server,
        { sessionService, repository, registry, bus, localSessions, broadcaster, clock },
        options.realtime
      ),
  };
}

export function createSupabaseRuntime(): Runtime {
  const db = getSupabaseClient();
  return createRuntime({
    repository: new SupabaseSessionRepository(db),
    // separate client for subscriptions, see SupabaseRealtimeBus
    bus: new SupabaseRealtimeBus(db, getSupabaseClient()),
  });
}
