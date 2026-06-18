import { liquidityRiskFor, quantitiesFromProbabilities, settleMarket } from "./market";
import type { AppState, BeltRank, Competitor, Event, Market, Match, MatchScore, MatchStatus } from "./types";

type SmoothcompCompetitorSnapshot = {
  sourceId?: string;
  name: string;
  academy?: string;
  country?: string;
  belt?: BeltRank;
  seed?: number;
  record?: string;
  imageUrl?: string;
  clubLogoUrl?: string;
  sourceUrl?: string;
};

export type SmoothcompMatchSnapshot = {
  sourceMatchId: string;
  sourceBracketId?: string;
  division: string;
  round: string;
  mat?: string;
  scheduledAt?: string;
  status: MatchStatus;
  sourceState?: string;
  sourceUrl?: string;
  competitorA: SmoothcompCompetitorSnapshot;
  competitorB: SmoothcompCompetitorSnapshot;
  winnerSide?: "left" | "right" | null;
  winnerSourceId?: string | null;
  finish?: string | null;
  liveClock?: string | null;
  score?: MatchScore;
};

export type SmoothcompEventSnapshot = {
  id: string;
  sourceEventId: string;
  name: string;
  organizer?: string;
  city?: string;
  country?: string;
  startsAt?: string;
  endsAt?: string;
  sourceUrl: string;
  status: Event["status"];
  categoryGroups?: string[];
  coverImage?: string;
  matches: SmoothcompMatchSnapshot[];
  warnings?: string[];
};

export type SmoothcompSnapshot = {
  source: "smoothcomp";
  syncedAt: string;
  calendarUrl: string;
  events: SmoothcompEventSnapshot[];
  stats?: {
    discoveredEvents?: number;
    importedEvents?: number;
    importedMatches?: number;
    liveMatches?: number;
    settledMatches?: number;
    failedEvents?: number;
    failedBrackets?: number;
    failedLiveScores?: number;
    failedMatchDetails?: number;
  };
  warnings?: string[];
};

type ApplySnapshotOptions = {
  eventId?: string;
  sourceEventId?: string;
};

const DEFAULT_LIQUIDITY = 120;

export function parseSmoothcompEventId(url: string) {
  const match = url.match(/smoothcomp\.com\/(?:[a-z]{2}(?:_[A-Z]{2})?\/)?event\/(\d+)/i);
  return match?.[1] ?? "";
}

export function summarizeSmoothcompSnapshot(snapshot: SmoothcompSnapshot) {
  const matches = snapshot.events.flatMap((event) => event.matches);

  return {
    syncedAt: snapshot.syncedAt,
    eventCount: snapshot.events.length,
    matchCount: matches.length,
    liveCount: matches.filter((match) => match.status === "live").length,
    settledCount: matches.filter((match) => match.status === "settled").length,
    warningCount:
      (snapshot.warnings?.length ?? 0) +
      snapshot.events.reduce((count, event) => count + (event.warnings?.length ?? 0), 0)
  };
}

export function importSmoothcompEvent(
  state: AppState,
  url: string,
  snapshot?: SmoothcompSnapshot
): AppState {
  const eventNumber = parseSmoothcompEventId(url);

  if (snapshot && eventNumber && snapshot.events.some((event) => event.sourceEventId === eventNumber)) {
    return applySmoothcompSnapshot(state, snapshot, { sourceEventId: eventNumber });
  }

  const now = new Date().toISOString();
  const eventId = `e-smoothcomp-${eventNumber || slugify(url).slice(0, 24) || Date.now().toString(36)}`;

  if (state.events.some((event) => event.id === eventId)) {
    return {
      ...state,
      events: state.events.map((event) =>
        event.id === eventId ? { ...event, lastSyncedAt: now, sourceUrl: url } : event
      )
    };
  }

  const event: Event = {
    id: eventId,
    sport: "bjj",
    name: eventNumber ? `Smoothcomp Event ${eventNumber}` : "Smoothcomp Event",
    organizer: "Smoothcomp",
    city: "Awaiting sync",
    startsAt: now,
    sourceUrl: url,
    source: "smoothcomp",
    status: "upcoming",
    lastSyncedAt: now
  };

  return {
    ...state,
    events: [event, ...state.events]
  };
}

export function applySmoothcompSnapshot(
  state: AppState,
  snapshot: SmoothcompSnapshot,
  options: ApplySnapshotOptions = {}
): AppState {
  const scopedEvents = snapshot.events.filter((event) => {
    if (options.eventId) {
      return event.id === options.eventId;
    }

    if (options.sourceEventId) {
      return event.sourceEventId === options.sourceEventId;
    }

    return true;
  });

  if (scopedEvents.length === 0) {
    return state;
  }

  let competitors = [...state.competitors];
  let events = [...state.events];
  let matches = [...state.matches];
  let markets = [...state.markets];
  const settlements: Array<{ marketId: string; winnerId: string; finish: string }> = [];

  for (const snapshotEvent of scopedEvents) {
    const event = eventFromSnapshot(snapshotEvent, snapshot.syncedAt);
    events = upsertById(events, event);

    for (const snapshotMatch of snapshotEvent.matches) {
      const competitorA = competitorFromSnapshot(
        snapshotMatch.competitorA,
        snapshotEvent.sourceEventId,
        snapshotMatch.sourceMatchId,
        "left",
        snapshotMatch.division
      );
      const competitorB = competitorFromSnapshot(
        snapshotMatch.competitorB,
        snapshotEvent.sourceEventId,
        snapshotMatch.sourceMatchId,
        "right",
        snapshotMatch.division
      );

      competitors = upsertById(competitors, competitorA);
      competitors = upsertById(competitors, competitorB);

      const winnerId = winnerIdFor(snapshotMatch, competitorA.id, competitorB.id);
      const localMatch = matchFromSnapshot(snapshotEvent, snapshotMatch, competitorA.id, competitorB.id, winnerId);
      const existingMatch = matches.find((match) => match.id === localMatch.id);
      const mergedMatch = existingMatch ? mergeMatch(existingMatch, localMatch) : localMatch;

      matches = upsertById(matches, mergedMatch);

      const existingMarket = markets.find((market) => market.matchId === mergedMatch.id);
      const nextMarket = marketFromMatch(mergedMatch, existingMarket, snapshot.syncedAt);
      markets = upsertById(markets, nextMarket);

      if (winnerId && existingMarket && existingMarket.status !== "settled") {
        settlements.push({
          marketId: existingMarket.id,
          winnerId,
          finish: snapshotMatch.finish || snapshotMatch.sourceState || "Smoothcomp result"
        });
      }
    }
  }

  let nextState: AppState = {
    ...state,
    competitors,
    events,
    matches,
    markets
  };

  for (const settlement of settlements) {
    nextState = settleMarket(nextState, settlement.marketId, settlement.winnerId, settlement.finish);
  }

  return nextState;
}

function eventFromSnapshot(snapshotEvent: SmoothcompEventSnapshot, syncedAt: string): Event {
  return {
    id: snapshotEvent.id,
    sport: "bjj",
    name: snapshotEvent.name,
    organizer: snapshotEvent.organizer || "Smoothcomp",
    city: [snapshotEvent.city, snapshotEvent.country].filter(Boolean).join(", ") || "Smoothcomp",
    startsAt: snapshotEvent.startsAt || syncedAt,
    sourceUrl: snapshotEvent.sourceUrl,
    source: "smoothcomp",
    status: snapshotEvent.status,
    lastSyncedAt: syncedAt
  };
}

function competitorFromSnapshot(
  snapshotCompetitor: SmoothcompCompetitorSnapshot,
  sourceEventId: string,
  sourceMatchId: string,
  side: "left" | "right",
  division: string
): Competitor {
  const sourceId =
    snapshotCompetitor.sourceId ||
    `${sourceEventId}-${sourceMatchId}-${side}-${slugify(snapshotCompetitor.name || "unknown")}`;

  return {
    id: `c-smoothcomp-${sourceId}`,
    name: snapshotCompetitor.name || "Unknown competitor",
    academy: snapshotCompetitor.academy || "Independent",
    country: (snapshotCompetitor.country || "SC").toUpperCase(),
    belt: snapshotCompetitor.belt || beltFromDivision(division),
    seed: snapshotCompetitor.seed && snapshotCompetitor.seed > 0 ? snapshotCompetitor.seed : side === "left" ? 1 : 2,
    record: snapshotCompetitor.record || "0 Smoothcomp wins",
    imageUrl: snapshotCompetitor.imageUrl,
    clubLogoUrl: snapshotCompetitor.clubLogoUrl,
    sourceId,
    sourceUrl: snapshotCompetitor.sourceUrl
  };
}

function matchFromSnapshot(
  snapshotEvent: SmoothcompEventSnapshot,
  snapshotMatch: SmoothcompMatchSnapshot,
  competitorAId: string,
  competitorBId: string,
  winnerId?: string
): Match {
  return {
    id: `m-smoothcomp-${snapshotMatch.sourceMatchId}`,
    eventId: snapshotEvent.id,
    division: snapshotMatch.division,
    round: snapshotMatch.round || `Match ${snapshotMatch.sourceMatchId}`,
    mat: snapshotMatch.mat || "TBD",
    scheduledAt: snapshotMatch.scheduledAt || snapshotEvent.startsAt || new Date().toISOString(),
    status: winnerId ? "settled" : snapshotMatch.status,
    competitorAId,
    competitorBId,
    winnerId,
    finish: winnerId ? snapshotMatch.finish || snapshotMatch.sourceState || "Smoothcomp result" : undefined,
    liveClock: snapshotMatch.liveClock || undefined,
    score: snapshotMatch.score,
    sourceBracketId: snapshotMatch.sourceBracketId,
    sourceMatchId: snapshotMatch.sourceMatchId,
    sourceState: snapshotMatch.sourceState,
    sourceUrl: snapshotMatch.sourceUrl
  };
}

function mergeMatch(existingMatch: Match, incomingMatch: Match): Match {
  const alreadySettled = existingMatch.status === "settled";

  return {
    ...existingMatch,
    ...incomingMatch,
    status: alreadySettled ? "settled" : incomingMatch.status,
    winnerId: alreadySettled ? existingMatch.winnerId : incomingMatch.winnerId,
    finish: alreadySettled ? existingMatch.finish : incomingMatch.finish
  };
}

function marketFromMatch(match: Match, existingMarket: Market | undefined, syncedAt: string): Market {
  if (existingMarket) {
    const shouldLock = match.status === "live" && existingMarket.status === "open";
    return {
      ...existingMarket,
      status: shouldLock ? "locked" : existingMarket.status,
      updatedAt: shouldLock ? syncedAt : existingMarket.updatedAt
    };
  }

  const probabilities = initialProbabilitiesFor(match);
  const status = match.status === "settled" ? "settled" : match.status === "live" ? "locked" : "open";

  return {
    id: `mk-${match.id}`,
    matchId: match.id,
    sport: "bjj",
    status,
    liquidity: DEFAULT_LIQUIDITY,
    liquidityRisk: liquidityRiskFor(probabilities, DEFAULT_LIQUIDITY),
    quantities: quantitiesFromProbabilities([match.competitorAId, match.competitorBId], probabilities, DEFAULT_LIQUIDITY),
    volume: 0,
    tradeCount: 0,
    participantCount: 0,
    createdAt: syncedAt,
    updatedAt: syncedAt,
    resolvedAt: match.status === "settled" ? syncedAt : undefined,
    resolvedOutcomeId: match.status === "settled" ? match.winnerId : undefined,
    resolverNotes: match.status === "settled" ? match.finish : undefined
  };
}

function winnerIdFor(snapshotMatch: SmoothcompMatchSnapshot, competitorAId: string, competitorBId: string) {
  if (snapshotMatch.winnerSide === "left") {
    return competitorAId;
  }

  if (snapshotMatch.winnerSide === "right") {
    return competitorBId;
  }

  if (snapshotMatch.winnerSourceId) {
    const sourceId = `c-smoothcomp-${snapshotMatch.winnerSourceId}`;
    return sourceId === competitorAId || sourceId === competitorBId ? sourceId : undefined;
  }

  return undefined;
}

function initialProbabilitiesFor(match: Match) {
  return [0.5, 0.5];
}

function beltFromDivision(division: string): BeltRank {
  const lower = division.toLowerCase();
  const belts: BeltRank[] = ["black", "brown", "purple", "blue", "green", "orange", "yellow", "grey", "white"];
  return belts.find((belt) => lower.includes(belt)) || "white";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const index = items.findIndex((item) => item.id === nextItem.id);

  if (index === -1) {
    return [nextItem, ...items];
  }

  const nextItems = [...items];
  nextItems[index] = { ...items[index], ...nextItem };
  return nextItems;
}
