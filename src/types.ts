export type SportKind = "bjj" | "mma" | "boxing" | "wrestling" | "judo";

export type MatchStatus = "open" | "locked" | "live" | "settled";

export type MarketStatus = "open" | "locked" | "settled";

export type TradeSide = "buy" | "sell";

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
  liquidity: number;
  liquidityRisk: number;
  quantities: Record<string, number>;
  volume: number;
  tradeCount: number;
  participantCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedOutcomeId?: string;
  resolverNotes?: string;
};

export type Trade = {
  id: string;
  marketId: string;
  matchId: string;
  side: TradeSide;
  competitorId: string;
  amount: number;
  shares: number;
  averagePrice: number;
  probabilityBefore: number;
  probabilityAfter: number;
  priceImpact: number;
  createdAt: string;
};

export type Position = {
  id: string;
  marketId: string;
  matchId: string;
  competitorId: string;
  shares: number;
  costBasis: number;
  averagePrice: number;
  realizedPnl: number;
  currentProbability: number;
  markValue: number;
  payoutIfCorrect: number;
  unrealizedPnl: number;
  isResolved: boolean;
  isWinner: boolean;
  updatedAt: string;
};

export type AppState = {
  balance: number;
  competitors: Competitor[];
  events: Event[];
  markets: Market[];
  matches: Match[];
  positions: Position[];
  trades: Trade[];
};

export type MarketQuote = {
  probabilityA: number;
  probabilityB: number;
  sharesA: number;
  sharesB: number;
  totalVolume: number;
  volumeToRisk: number;
};

export type TradeQuote = {
  side: TradeSide;
  competitorId: string;
  amount: number;
  shares: number;
  averagePrice: number;
  probabilityBefore: number;
  probabilityAfter: number;
  priceImpact: number;
};
