export type SportKind = "bjj" | "mma" | "boxing" | "wrestling" | "judo";

export type MatchStatus = "open" | "locked" | "live" | "settled";

export type MarketStatus = "open" | "locked" | "settled";

export type PredictionStatus = "active" | "settled";

export type Competitor = {
  id: string;
  name: string;
  academy: string;
  country: string;
  belt: "blue" | "purple" | "brown" | "black";
  seed: number;
  record: string;
};

export type Event = {
  id: string;
  sport: SportKind;
  name: string;
  organizer: string;
  city: string;
  startsAt: string;
  sourceUrl: string;
  source: "smoothcomp" | "manual";
  status: "upcoming" | "live" | "complete";
  lastSyncedAt: string;
};

export type Match = {
  id: string;
  eventId: string;
  division: string;
  round: string;
  mat: string;
  scheduledAt: string;
  status: MatchStatus;
  competitorAId: string;
  competitorBId: string;
  winnerId?: string;
  finish?: string;
};

export type Market = {
  id: string;
  matchId: string;
  sport: SportKind;
  status: MarketStatus;
  baseLiquidityA: number;
  baseLiquidityB: number;
};

export type Prediction = {
  id: string;
  marketId: string;
  matchId: string;
  competitorId: string;
  stake: number;
  impliedProbability: number;
  payoutIfCorrect: number;
  createdAt: string;
  status: PredictionStatus;
  settledAt?: string;
  won?: boolean;
};

export type AppState = {
  balance: number;
  competitors: Competitor[];
  events: Event[];
  markets: Market[];
  matches: Match[];
  predictions: Prediction[];
};

export type MarketQuote = {
  probabilityA: number;
  probabilityB: number;
  totalStakeA: number;
  totalStakeB: number;
  totalVolume: number;
};
