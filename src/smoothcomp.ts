import { liquidityRiskFor, quantitiesFromProbabilities, settleMarket } from "./market";
import type { AppState, DataProvider, DataCoverage, BeltRank, Competitor, Event, Market, Match, MatchScore, MatchStatus } from "./types";

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
  source?: DataProvider;
  observedAt?: string;
  coverage?: DataCoverage;
  name: string;
  organizer?: string;
  city?: string;
  venue?: string;
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
  source: DataProvider | "mixed";
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
    const source = snapshotEvent.source || snapshot.source;
    if (source === "mixed") continue;
    const observedAt = snapshotEvent.observedAt || snapshot.syncedAt;
    const existingEvent = events.find(event => event.id === snapshotEvent.id);
    if (existingEvent && Date.parse(existingEvent.lastSyncedAt) > Date.parse(observedAt)) continue;
    const event = eventFromSnapshot(snapshotEvent, observedAt, source);
    events = upsertById(events, event);

    for (const snapshotMatch of snapshotEvent.matches) {
      const competitorA = competitorFromSnapshot(
        snapshotMatch.competitorA,
        snapshotEvent.sourceEventId,
        snapshotMatch.sourceMatchId,
        "left",
        snapshotMatch.division,
        source
      );
      const competitorB = competitorFromSnapshot(
        snapshotMatch.competitorB,
        snapshotEvent.sourceEventId,
        snapshotMatch.sourceMatchId,
        "right",
        snapshotMatch.division,
        source
      );

      competitors = upsertById(competitors, competitorA);
      competitors = upsertById(competitors, competitorB);

      const winnerId = winnerIdFor(snapshotMatch, competitorA.id, competitorB.id, source);
      const localMatch = matchFromSnapshot(snapshotEvent, snapshotMatch, competitorA.id, competitorB.id, winnerId, source, observedAt);
      const existingMatch = matches.find((match) => match.id === localMatch.id);
      if (existingMatch && (existingMatch.competitorAId !== localMatch.competitorAId || existingMatch.competitorBId !== localMatch.competitorBId ||
          existingMatch.winnerId && winnerId && existingMatch.winnerId !== winnerId)) {
        const warning = `Match ${snapshotMatch.sourceMatchId} changed participants or winner; review required.`;
        events = events.map(item => item.id === event.id ? { ...item, warnings: [...new Set([...(item.warnings || []), warning])] } : item);
        markets = markets.map(item => item.matchId === existingMatch.id && item.status === "open" ? { ...item, status: "locked" } : item);
        matches = matches.map(item => item.id === existingMatch.id && item.status === "open" ? { ...item, status: "locked" } : item);
        continue;
      }
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

function eventFromSnapshot(snapshotEvent: SmoothcompEventSnapshot, syncedAt: string, source: DataProvider): Event {
  return {
    id: snapshotEvent.id,
    sport: "bjj",
    name: snapshotEvent.name,
    organizer: snapshotEvent.organizer || "Smoothcomp",
    city: [snapshotEvent.city, snapshotEvent.country].filter(Boolean).join(", ") || "Location not listed",
    venue: snapshotEvent.venue || "",
    startsAt: snapshotEvent.startsAt || "",
    endsAt: snapshotEvent.endsAt || "",
    coverage: snapshotEvent.coverage,
    warnings: snapshotEvent.warnings,
    sourceUrl: snapshotEvent.sourceUrl,
    source,
    status: snapshotEvent.status,
    lastSyncedAt: syncedAt
  };
}

function competitorFromSnapshot(
  snapshotCompetitor: SmoothcompCompetitorSnapshot,
  sourceEventId: string,
  sourceMatchId: string,
  side: "left" | "right",
  division: string,
  source: DataProvider
): Competitor {
  const sourceId =
    snapshotCompetitor.sourceId ||
    `${sourceEventId}-${sourceMatchId}-${side}-${slugify(snapshotCompetitor.name || "unknown")}`;

  return {
    id: `c-${source}-${sourceId}`,
    name: snapshotCompetitor.name || "Unknown competitor",
    academy: snapshotCompetitor.academy || "Not listed",
    country: (snapshotCompetitor.country || "Not listed").toUpperCase(),
    belt: snapshotCompetitor.belt || beltFromDivision(division),
    seed: snapshotCompetitor.seed && snapshotCompetitor.seed > 0 ? snapshotCompetitor.seed : 0,
    record: snapshotCompetitor.record || "Record not listed",
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
  winnerId: string | undefined,
  source: DataProvider,
  observedAt: string
): Match {
  const scheduledAt = snapshotMatch.scheduledAt || "";
  const canOpen = Date.parse(scheduledAt) > Date.now() && Date.now() - Date.parse(observedAt) <= 120000;
  return {
    id: `m-${source}-${snapshotMatch.sourceMatchId}`,
    eventId: snapshotEvent.id,
    division: snapshotMatch.division,
    round: snapshotMatch.round || `Match ${snapshotMatch.sourceMatchId}`,
    mat: snapshotMatch.mat || "TBD",
    scheduledAt,
    sourceObservedAt: observedAt,
    status: winnerId ? "settled" : snapshotMatch.status === "settled" || snapshotMatch.status === "open" && !canOpen ? "locked" : snapshotMatch.status,
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
    const shouldLock = match.status !== "open" && existingMarket.status === "open";
    return {
      ...existingMarket,
      status: shouldLock ? "locked" : existingMarket.status,
      updatedAt: shouldLock ? syncedAt : existingMarket.updatedAt
    };
  }

  const probabilities = initialProbabilitiesFor(match);
  const status = match.status === "settled" ? "settled" : match.status === "open" ? "open" : "locked";

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

function winnerIdFor(snapshotMatch: SmoothcompMatchSnapshot, competitorAId: string, competitorBId: string, source: DataProvider) {
  if (snapshotMatch.winnerSide === "left") {
    return competitorAId;
  }

  if (snapshotMatch.winnerSide === "right") {
    return competitorBId;
  }

  if (snapshotMatch.winnerSourceId) {
    const sourceId = `c-${source}-${snapshotMatch.winnerSourceId}`;
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
  return belts.find((belt) => lower.includes(belt)) || "unknown";
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

// Provider-neutral entry point; retain the existing name for compatibility.
export const applyDataSnapshot = applySmoothcompSnapshot;
export type DataSnapshot = SmoothcompSnapshot;
