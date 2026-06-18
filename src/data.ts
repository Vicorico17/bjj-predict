import { liquidityRiskFor, quantitiesFromProbabilities } from "./market";
import type { AppState, Competitor, Event, Market, Match } from "./types";

export const STARTING_BALANCE = 2500;

export const competitors: Competitor[] = [
  {
    id: "c-ana-rios",
    name: "Ana Rios",
    academy: "Unity Jiu Jitsu",
    country: "BR",
    belt: "black",
    seed: 1,
    record: "28-5"
  },
  {
    id: "c-maya-kim",
    name: "Maya Kim",
    academy: "Atos HQ",
    country: "US",
    belt: "black",
    seed: 4,
    record: "21-7"
  },
  {
    id: "c-lucas-martin",
    name: "Lucas Martin",
    academy: "Checkmat",
    country: "FR",
    belt: "black",
    seed: 2,
    record: "31-9"
  },
  {
    id: "c-rafa-silva",
    name: "Rafa Silva",
    academy: "AOJ",
    country: "BR",
    belt: "black",
    seed: 7,
    record: "18-8"
  },
  {
    id: "c-eli-parker",
    name: "Eli Parker",
    academy: "New Wave",
    country: "US",
    belt: "brown",
    seed: 3,
    record: "24-6"
  },
  {
    id: "c-niko-santos",
    name: "Niko Santos",
    academy: "Alliance",
    country: "PT",
    belt: "brown",
    seed: 6,
    record: "17-9"
  },
  {
    id: "c-tommy-cole",
    name: "Tommy Cole",
    academy: "Renzo Gracie",
    country: "GB",
    belt: "purple",
    seed: 5,
    record: "19-10"
  },
  {
    id: "c-alex-nguyen",
    name: "Alex Nguyen",
    academy: "Fight Sports",
    country: "CA",
    belt: "purple",
    seed: 8,
    record: "15-12"
  }
];

export const events: Event[] = [
  {
    id: "e-world-no-gi-trials",
    sport: "bjj",
    name: "World No-Gi Trials",
    organizer: "Grappling Circuit",
    city: "Austin, TX",
    startsAt: "2026-07-11T15:00:00.000Z",
    sourceUrl: "https://smoothcomp.com/en/event/18922",
    source: "smoothcomp",
    status: "upcoming",
    lastSyncedAt: "2026-06-18T04:30:00.000Z"
  },
  {
    id: "e-summer-open",
    sport: "bjj",
    name: "Summer Open Gi Championship",
    organizer: "Mat League",
    city: "Los Angeles, CA",
    startsAt: "2026-07-26T16:00:00.000Z",
    sourceUrl: "https://smoothcomp.com/en/event/19108",
    source: "smoothcomp",
    status: "upcoming",
    lastSyncedAt: "2026-06-18T03:12:00.000Z"
  }
];

export const matches: Match[] = [
  {
    id: "m-001",
    eventId: "e-world-no-gi-trials",
    division: "Adult Black Belt / Female / Lightweight",
    round: "Semifinal",
    mat: "Mat 2",
    scheduledAt: "2026-07-11T16:10:00.000Z",
    status: "open",
    competitorAId: "c-ana-rios",
    competitorBId: "c-maya-kim"
  },
  {
    id: "m-002",
    eventId: "e-world-no-gi-trials",
    division: "Adult Black Belt / Male / Middleweight",
    round: "Quarterfinal",
    mat: "Mat 5",
    scheduledAt: "2026-07-11T17:00:00.000Z",
    status: "open",
    competitorAId: "c-lucas-martin",
    competitorBId: "c-rafa-silva"
  },
  {
    id: "m-003",
    eventId: "e-summer-open",
    division: "Adult Brown Belt / Male / Lightweight",
    round: "Final",
    mat: "Mat 1",
    scheduledAt: "2026-07-26T19:30:00.000Z",
    status: "open",
    competitorAId: "c-eli-parker",
    competitorBId: "c-niko-santos"
  },
  {
    id: "m-004",
    eventId: "e-summer-open",
    division: "Adult Purple Belt / Male / Open Class",
    round: "Round of 16",
    mat: "Mat 7",
    scheduledAt: "2026-07-26T18:15:00.000Z",
    status: "open",
    competitorAId: "c-tommy-cole",
    competitorBId: "c-alex-nguyen"
  }
];

const marketSeeds = [
  { probabilities: [0.57, 0.43], liquidity: 170, volume: 1320, tradeCount: 34, participantCount: 18 },
  { probabilities: [0.47, 0.53], liquidity: 155, volume: 960, tradeCount: 27, participantCount: 14 },
  { probabilities: [0.54, 0.46], liquidity: 145, volume: 790, tradeCount: 21, participantCount: 11 },
  { probabilities: [0.45, 0.55], liquidity: 130, volume: 520, tradeCount: 16, participantCount: 9 }
];

export const markets: Market[] = matches.map((match, index) => {
  const seed = marketSeeds[index] ?? {
    probabilities: [0.5, 0.5],
    liquidity: 140,
    volume: 0,
    tradeCount: 0,
    participantCount: 0
  };
  const outcomeIds = [match.competitorAId, match.competitorBId];
  const createdAt = "2026-06-18T04:00:00.000Z";

  return {
    id: `mk-${match.id}`,
    matchId: match.id,
    sport: "bjj",
    status: "open",
    liquidity: seed.liquidity,
    liquidityRisk: liquidityRiskFor(seed.probabilities, seed.liquidity),
    quantities: quantitiesFromProbabilities(outcomeIds, seed.probabilities, seed.liquidity),
    volume: seed.volume,
    tradeCount: seed.tradeCount,
    participantCount: seed.participantCount,
    createdAt,
    updatedAt: createdAt
  };
});

export const initialState: AppState = {
  balance: STARTING_BALANCE,
  competitors,
  events,
  markets,
  matches,
  positions: [],
  trades: []
};
