export type DataProvider = "smoothcomp" | "ajp" | "ibjjf" | "floarena" | "flo" | "one" | "ufcbjj" | "curated" | "bjjcalendar" | "grapplingnews" | "gosofia";

export type DataCoverage = {
  level: "discovered" | "partial" | "limited" | "published";
  matchCount: number; scoredMatches: number; totalBrackets?: number; importedBrackets?: number; nextBracketOffset?: number; liveScores?: boolean;
};

export type SportKind = "bjj" | "mma" | "boxing" | "wrestling" | "judo";

export type MatchStatus = "open" | "locked" | "live" | "settled";

export type MarketStatus = "open" | "locked" | "settled";

export type TradeSide = "buy" | "sell";

export type BeltRank = "unknown" | "white" | "grey" | "yellow" | "orange" | "green" | "blue" | "purple" | "brown" | "black";

export type ImageFocus = { x: number; y: number; zoom: number };

export type Competitor = {
  id: string;
  name: string;
  academy: string;
  country: string;
  belt: BeltRank;
  seed: number;
  record: string;
  imageUrl?: string;
  imageFocus?: ImageFocus;
  clubLogoUrl?: string;
  sourceId?: string;
  sourceUrl?: string;
};

export type EventParticipant = {
  sourceId: string; name: string; academy: string; country: string; division: string;
  imageUrl?: string;
  imageFocus?: ImageFocus; sourceUrl?: string;
};
export type PublishedBout = {
  observedAt?: string;
  advancesFrom?: string[];
  sourceId: string; number: string; round: string; roundOrder: number; state: string;
  mat: string; startsAt: string; finish: string; clock: string; score?: MatchScore;
  seats: Array<{ label: string; participant: EventParticipant | null; winner: boolean }>;
};
export type CompetitionBracket = {
  sourceId: string; name: string; registrations: number; mat: string; startsAt: string;
  sourceUrl: string; loaded?: boolean; bouts?: PublishedBout[];
};

export type Event = {
  id: string;
  sport: SportKind;
  name: string;
  organizer: string;
  city: string;
  venue?: string;
  imageUrl?: string;
  imageFocus?: ImageFocus;
  categoryGroups?: string[];
  participants?: EventParticipant[];
  participantsStatus?: "published" | "unavailable";
  brackets?: CompetitionBracket[];
  withdrawnMatchIds?: string[];
  startsAt: string;
  endsAt?: string;
  sourceUrl: string;
  officialUrl?: string;
  source: DataProvider | "manual";
  coverage?: DataCoverage;
  warnings?: string[];
  status: "upcoming" | "live" | "complete" | "unknown";
  lastSyncedAt: string;
};

export type MatchScoreSide = {
  points?: number | null;
  advantages?: number | null;
  penalties?: number | null;
};

export type MatchScore = {
  left?: MatchScoreSide;
  right?: MatchScoreSide;
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
  liveClock?: string;
  score?: MatchScore;
  sourceBracketId?: string;
  sourceMatchId?: string;
  sourceState?: string;
  sourceUrl?: string;
  sourceObservedAt?: string;
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
