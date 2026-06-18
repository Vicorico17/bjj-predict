import type { AppState, Market, MarketQuote, Match, Prediction } from "./types";

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function getQuote(market: Market, match: Match, predictions: Prediction[]): MarketQuote {
  const activePredictions = predictions.filter(
    (prediction) => prediction.marketId === market.id && prediction.status === "active"
  );
  const totalStakeA = activePredictions
    .filter((prediction) => prediction.competitorId === match.competitorAId)
    .reduce((sum, prediction) => sum + prediction.stake, 0);
  const totalStakeB = activePredictions
    .filter((prediction) => prediction.competitorId === match.competitorBId)
    .reduce((sum, prediction) => sum + prediction.stake, 0);
  const sideA = market.baseLiquidityA + totalStakeA;
  const sideB = market.baseLiquidityB + totalStakeB;
  const total = sideA + sideB || 1;

  return {
    probabilityA: sideA / total,
    probabilityB: sideB / total,
    totalStakeA,
    totalStakeB,
    totalVolume: activePredictions.reduce((sum, prediction) => sum + prediction.stake, 0)
  };
}

export function quoteForCompetitor(market: Market, match: Match, predictions: Prediction[], competitorId: string) {
  const quote = getQuote(market, match, predictions);
  return competitorId === match.competitorAId ? quote.probabilityA : quote.probabilityB;
}

export function projectedPayout(stake: number, probability: number) {
  return Math.max(stake, Math.round(stake / Math.max(probability, 0.08)));
}

export function settleMarket(
  state: AppState,
  marketId: string,
  winnerId: string,
  finish: string
): AppState {
  const now = new Date().toISOString();
  const market = state.markets.find((item) => item.id === marketId);

  if (!market) {
    return state;
  }

  let balanceDelta = 0;
  const predictions = state.predictions.map((prediction) => {
    if (prediction.marketId !== marketId || prediction.status === "settled") {
      return prediction;
    }

    const won = prediction.competitorId === winnerId;
    if (won) {
      balanceDelta += prediction.payoutIfCorrect;
    }

    return {
      ...prediction,
      status: "settled" as const,
      settledAt: now,
      won
    };
  });

  return {
    ...state,
    balance: state.balance + balanceDelta,
    markets: state.markets.map((item) =>
      item.id === marketId ? { ...item, status: "settled" as const } : item
    ),
    matches: state.matches.map((match) =>
      match.id === market.matchId
        ? {
            ...match,
            status: "settled" as const,
            winnerId,
            finish
          }
        : match
    ),
    predictions
  };
}

export function lockMarket(state: AppState, marketId: string): AppState {
  const market = state.markets.find((item) => item.id === marketId);

  if (!market) {
    return state;
  }

  return {
    ...state,
    markets: state.markets.map((item) =>
      item.id === marketId ? { ...item, status: "locked" as const } : item
    ),
    matches: state.matches.map((match) =>
      match.id === market.matchId ? { ...match, status: "locked" as const } : match
    )
  };
}
