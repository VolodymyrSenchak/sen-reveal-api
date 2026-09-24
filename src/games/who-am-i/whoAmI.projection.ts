import { GameContext } from "../gameModule";
import { getGiverIds, hasGivenName } from "./whoAmI.actions";
import { WhoAmIPhase, WhoAmIRound, WhoAmISettings, WhoAmIState } from "./whoAmI.state";

export interface WhoAmICardView {
  playerId: string;
  /** null → nobody has named them yet, or it is the viewer's own card before the reveal. */
  name: string | null;
  /** Who wrote it. null whenever `name` is. */
  givenById: string | null;
  /** The viewer's own card, face down until the reveal. */
  isMine: boolean;
}

export interface WhoAmIRoundView {
  number: number;
  phase: WhoAmIPhase;
  /** Dealt in this round, in join order. */
  playerIds: string[];
  /** Players who have somebody to name. */
  eligiblePlayerIds: string[];
  /** Of those, the ones who already have. */
  answeredPlayerIds: string[];
  /** false → joined mid-round; watching until the next one. */
  isPlaying: boolean;
  /** Whom the viewer names. null for a spectator, or when the chain broke around a leaver. */
  myTargetId: string | null;
  /** The name the viewer gave. null until they have. */
  myGivenName: string | null;
  /** One card per dealt player. null until the viewer has given their own name. */
  cards: WhoAmICardView[] | null;
  startedAt: string;
  revealedAt: string | null;
  canSubmitName: boolean;
  canReveal: boolean;
  canStartNextRound: boolean;
}

export interface WhoAmIView {
  round: WhoAmIRoundView;
}

/** Whitelist-based per-viewer projection. Field order is fixed so the JSON (and ETag) is deterministic. */
export function projectWhoAmI(state: WhoAmIState, viewerId: string, ctx: GameContext<WhoAmISettings>): WhoAmIView {
  return { round: projectRound(state.round, viewerId, ctx) };
}

function projectRound(round: WhoAmIRound, viewerId: string, ctx: GameContext<WhoAmISettings>): WhoAmIRoundView {
  const inProgress = ctx.status === "in_progress";
  const isHost = inProgress && viewerId === ctx.hostPlayerId;
  const revealed = round.phase === "revealed";
  const giverIds = getGiverIds(round);
  const myTargetId = round.assignments[viewerId] ?? null;
  const hasGiven = hasGivenName(round, viewerId);
  // Whoever still owes a name sees only their own target, so nobody's pick is shaped by the table.
  const seesTable = revealed || myTargetId === null || hasGiven;

  return {
    number: round.number,
    phase: round.phase,
    playerIds: [...round.playerIds],
    eligiblePlayerIds: giverIds,
    answeredPlayerIds: giverIds.filter((id) => hasGivenName(round, id)),
    isPlaying: round.playerIds.includes(viewerId),
    myTargetId,
    myGivenName: hasGiven ? round.names[myTargetId!].value : null,
    cards: seesTable
      ? round.playerIds.map((playerId) => {
          const isMine = playerId === viewerId;
          const name = Object.hasOwn(round.names, playerId) && (revealed || !isMine) ? round.names[playerId] : null;
          return { playerId, name: name?.value ?? null, givenById: name?.givenById ?? null, isMine };
        })
      : null,
    startedAt: round.startedAt,
    revealedAt: round.revealedAt,
    canSubmitName: inProgress && !revealed && myTargetId !== null && !hasGiven,
    canReveal: isHost && !revealed,
    canStartNextRound: isHost && revealed && ctx.activePlayers.length >= ctx.settings.minPlayers,
  };
}
