import type { AppState, Event, Market, Match } from "./types";
import { liquidityRiskFor, quantitiesFromProbabilities } from "./market";

const importedCompetitorPairs = [
  ["c-ana-rios", "c-rafa-silva"],
  ["c-lucas-martin", "c-maya-kim"],
  ["c-eli-parker", "c-tommy-cole"],
  ["c-niko-santos", "c-alex-nguyen"]
] as const;

export function parseSmoothcompEventId(url: string) {
  const match = url.match(/smoothcomp\.com\/(?:[a-z]{2}\/)?event\/(\d+)/i);
  return match?.[1] ?? "";
}

export function importSmoothcompEvent(state: AppState, url: string): AppState {
  const eventNumber = parseSmoothcompEventId(url);
  const suffix = eventNumber || String(Date.now()).slice(-5);
  const eventId = `e-smoothcomp-${suffix}`;

  if (state.events.some((event) => event.id === eventId)) {
    return {
      ...state,
      events: state.events.map((event) =>
        event.id === eventId ? { ...event, lastSyncedAt: new Date().toISOString() } : event
      )
    };
  }

  const now = new Date();
  const startsAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 21).toISOString();
  const event: Event = {
    id: eventId,
    sport: "bjj",
    name: `Smoothcomp Event ${suffix}`,
    organizer: "Smoothcomp import",
    city: "Imported event",
    startsAt,
    sourceUrl: url,
    source: "smoothcomp",
    status: "upcoming",
    lastSyncedAt: now.toISOString()
  };

  const importedMatches: Match[] = importedCompetitorPairs.slice(0, 2).map((pair, index) => ({
    id: `m-smoothcomp-${suffix}-${index + 1}`,
    eventId,
    division: index === 0 ? "Adult Black Belt / Open Class" : "Adult Brown Belt / Middleweight",
    round: index === 0 ? "Quarterfinal" : "Semifinal",
    mat: `Mat ${index + 3}`,
    scheduledAt: new Date(now.getTime() + 1000 * 60 * 60 * (24 * 21 + index + 1)).toISOString(),
    status: "open",
    competitorAId: pair[0],
    competitorBId: pair[1]
  }));

  const importedMarkets: Market[] = importedMatches.map((match, index) => {
    const probabilities = index === 0 ? [0.52, 0.48] : [0.48, 0.52];
    const liquidity = 135 + index * 20;
    const createdAt = now.toISOString();

    return {
      id: `mk-${match.id}`,
      matchId: match.id,
      sport: "bjj",
      status: "open",
      liquidity,
      liquidityRisk: liquidityRiskFor(probabilities, liquidity),
      quantities: quantitiesFromProbabilities([match.competitorAId, match.competitorBId], probabilities, liquidity),
      volume: 0,
      tradeCount: 0,
      participantCount: 0,
      createdAt,
      updatedAt: createdAt
    };
  });

  return {
    ...state,
    events: [event, ...state.events],
    matches: [...importedMatches, ...state.matches],
    markets: [...importedMarkets, ...state.markets]
  };
}
