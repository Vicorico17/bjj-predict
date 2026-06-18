import type { AppState, Market, MarketQuote, Match, Position, Trade, TradeQuote, TradeSide } from "./types";

const MIN_BUY_AMOUNT = 1;
const MAX_BUY_AMOUNT = 5000;
const MIN_SELL_SHARES = 0.0001;
const MAX_SELL_SHARES = 1_000_000;

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatPercent(value: number) {
  return `${Math.round(value * 1000) / 10}%`;
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundShares(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function normalizeProbabilities(probabilities: number[] | undefined, count: number) {
  if (!probabilities || probabilities.length !== count) {
    return Array.from({ length: count }, () => 1 / count);
  }

  const cleaned = probabilities.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = cleaned.reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return Array.from({ length: count }, () => 1 / count);
  }

  return cleaned.map((value) => value / total);
}

export function quantitiesFromProbabilities(outcomeIds: string[], probabilities: number[], liquidity: number) {
  const normalized = normalizeProbabilities(probabilities, outcomeIds.length);

  return outcomeIds.reduce<Record<string, number>>((acc, outcomeId, index) => {
    acc[outcomeId] = liquidity * Math.log(Math.max(normalized[index], 0.0001));
    return acc;
  }, {});
}

export function liquidityRiskFor(probabilities: number[], liquidity: number) {
  const cleaned = probabilities.filter((probability) => Number.isFinite(probability) && probability > 0);
  const lowestProbability = Math.max(Math.min(...(cleaned.length ? cleaned : [1])), 0.0001);
  return roundMoney(liquidity * Math.log(1 / lowestProbability));
}

export function outcomeIdsFor(match: Match) {
  return [match.competitorAId, match.competitorBId];
}

export function probabilitiesFor(outcomeIds: string[], quantities: Record<string, number>, liquidity: number) {
  const scores = outcomeIds.map((outcomeId) => (quantities[outcomeId] || 0) / liquidity);
  const maxScore = Math.max(...scores);
  const exps = scores.map((score) => Math.exp(score - maxScore));
  const sum = exps.reduce((total, value) => total + value, 0);

  return outcomeIds.reduce<Record<string, number>>((acc, outcomeId, index) => {
    acc[outcomeId] = exps[index] / sum;
    return acc;
  }, {});
}

function lmsrCost(outcomeIds: string[], quantities: Record<string, number>, liquidity: number) {
  const scores = outcomeIds.map((outcomeId) => (quantities[outcomeId] || 0) / liquidity);
  const maxScore = Math.max(...scores);
  const sum = scores.reduce((total, score) => total + Math.exp(score - maxScore), 0);

  return liquidity * (Math.log(sum) + maxScore);
}

export function costToBuyShares(market: Market, match: Match, competitorId: string, shares: number) {
  const outcomeIds = outcomeIdsFor(match);
  const nextQuantities = {
    ...market.quantities,
    [competitorId]: (market.quantities[competitorId] || 0) + shares
  };

  return (
    lmsrCost(outcomeIds, nextQuantities, market.liquidity) -
    lmsrCost(outcomeIds, market.quantities, market.liquidity)
  );
}

export function proceedsFromSellingShares(market: Market, match: Match, competitorId: string, shares: number) {
  const outcomeIds = outcomeIdsFor(match);
  const nextQuantities = {
    ...market.quantities,
    [competitorId]: (market.quantities[competitorId] || 0) - shares
  };

  return (
    lmsrCost(outcomeIds, market.quantities, market.liquidity) -
    lmsrCost(outcomeIds, nextQuantities, market.liquidity)
  );
}

export function quoteBuy(market: Market, match: Match, competitorId: string, amount: number): TradeQuote {
  const outcomeIds = outcomeIdsFor(match);

  if (!outcomeIds.includes(competitorId)) {
    throw new Error("Outcome not found");
  }

  if (!Number.isFinite(amount) || amount < MIN_BUY_AMOUNT || amount > MAX_BUY_AMOUNT) {
    throw new Error(`Trade amount must be between ${MIN_BUY_AMOUNT} and ${MAX_BUY_AMOUNT}`);
  }

  const probabilitiesBefore = probabilitiesFor(outcomeIds, market.quantities, market.liquidity);
  let low = 0;
  let high = Math.max(amount / Math.max(probabilitiesBefore[competitorId], 0.01), 1);

  while (costToBuyShares(market, match, competitorId, high) < amount) {
    high *= 2;
    if (high > 1_000_000) {
      throw new Error("Trade size is too large for this market");
    }
  }

  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    const cost = costToBuyShares(market, match, competitorId, mid);

    if (cost > amount) {
      high = mid;
    } else {
      low = mid;
    }
  }

  const shares = roundShares((low + high) / 2);
  const nextQuantities = {
    ...market.quantities,
    [competitorId]: (market.quantities[competitorId] || 0) + shares
  };
  const probabilitiesAfter = probabilitiesFor(outcomeIds, nextQuantities, market.liquidity);

  return {
    side: "buy",
    competitorId,
    amount: roundMoney(amount),
    shares,
    averagePrice: roundMoney(amount / shares),
    probabilityBefore: probabilitiesBefore[competitorId],
    probabilityAfter: probabilitiesAfter[competitorId],
    priceImpact: probabilitiesAfter[competitorId] - probabilitiesBefore[competitorId]
  };
}

export function quoteSell(market: Market, match: Match, competitorId: string, shares: number): TradeQuote {
  const outcomeIds = outcomeIdsFor(match);

  if (!outcomeIds.includes(competitorId)) {
    throw new Error("Outcome not found");
  }

  if (!Number.isFinite(shares) || shares < MIN_SELL_SHARES || shares > MAX_SELL_SHARES) {
    throw new Error(`Share amount must be between ${MIN_SELL_SHARES} and ${MAX_SELL_SHARES}`);
  }

  const probabilitiesBefore = probabilitiesFor(outcomeIds, market.quantities, market.liquidity);
  const amount = proceedsFromSellingShares(market, match, competitorId, shares);
  const nextQuantities = {
    ...market.quantities,
    [competitorId]: (market.quantities[competitorId] || 0) - shares
  };
  const probabilitiesAfter = probabilitiesFor(outcomeIds, nextQuantities, market.liquidity);

  return {
    side: "sell",
    competitorId,
    amount: roundMoney(amount),
    shares: roundShares(shares),
    averagePrice: roundMoney(amount / shares),
    probabilityBefore: probabilitiesBefore[competitorId],
    probabilityAfter: probabilitiesAfter[competitorId],
    priceImpact: probabilitiesAfter[competitorId] - probabilitiesBefore[competitorId]
  };
}

export function getQuote(market: Market, match: Match): MarketQuote {
  const probabilities = probabilitiesFor(outcomeIdsFor(match), market.quantities, market.liquidity);

  return {
    probabilityA: probabilities[match.competitorAId] || 0,
    probabilityB: probabilities[match.competitorBId] || 0,
    sharesA: roundShares(Math.max(market.quantities[match.competitorAId] || 0, 0)),
    sharesB: roundShares(Math.max(market.quantities[match.competitorBId] || 0, 0)),
    totalVolume: market.volume,
    volumeToRisk: market.liquidityRisk > 0 ? market.volume / market.liquidityRisk : 0
  };
}

export function quoteTrade(
  market: Market,
  match: Match,
  side: TradeSide,
  competitorId: string,
  amountOrShares: number
) {
  return side === "sell"
    ? quoteSell(market, match, competitorId, amountOrShares)
    : quoteBuy(market, match, competitorId, amountOrShares);
}

function positionIdFor(marketId: string, competitorId: string) {
  return `local:${marketId}:${competitorId}`;
}

export function getOwnedShares(state: AppState, marketId: string, competitorId: string) {
  return (
    state.positions.find(
      (position) => position.marketId === marketId && position.competitorId === competitorId && position.shares > 0
    )?.shares || 0
  );
}

export function markPositions(state: AppState): Position[] {
  return state.positions.map((position) => {
    const market = state.markets.find((candidate) => candidate.id === position.marketId);
    const match = market ? state.matches.find((candidate) => candidate.id === market.matchId) : undefined;

    if (!market || !match) {
      return position;
    }

    const probabilities = probabilitiesFor(outcomeIdsFor(match), market.quantities, market.liquidity);
    const currentProbability = probabilities[position.competitorId] || 0;
    const isResolved = market.status === "settled";
    const isWinner = market.resolvedOutcomeId === position.competitorId;
    const markValue = isResolved ? (isWinner ? position.shares : 0) : position.shares * currentProbability;

    return {
      ...position,
      currentProbability,
      markValue: roundMoney(markValue),
      payoutIfCorrect: roundMoney(position.shares),
      unrealizedPnl: roundMoney(markValue - position.costBasis),
      isResolved,
      isWinner
    };
  });
}

export function placeTrade(
  state: AppState,
  marketId: string,
  competitorId: string,
  side: TradeSide,
  amountOrShares: number
): AppState {
  const market = state.markets.find((candidate) => candidate.id === marketId);
  const match = market ? state.matches.find((candidate) => candidate.id === market.matchId) : undefined;

  if (!market || !match || market.status !== "open") {
    return state;
  }

  let quote: TradeQuote;

  try {
    quote = quoteTrade(market, match, side, competitorId, amountOrShares);
  } catch {
    return state;
  }

  if (side === "buy" && state.balance < quote.amount) {
    return state;
  }

  const existing = state.positions.find(
    (position) => position.marketId === market.id && position.competitorId === competitorId
  );

  if (side === "sell" && (!existing || existing.shares < quote.shares)) {
    return state;
  }

  const createdAt = new Date().toISOString();
  const signedShares = side === "sell" ? -quote.shares : quote.shares;
  const nextMarket: Market = {
    ...market,
    quantities: {
      ...market.quantities,
      [competitorId]: roundShares((market.quantities[competitorId] || 0) + signedShares)
    },
    volume: roundMoney(market.volume + quote.amount),
    tradeCount: market.tradeCount + 1,
    participantCount: Math.max(market.participantCount, existing ? market.participantCount : market.participantCount + 1),
    updatedAt: createdAt
  };
  const trade: Trade = {
    id: `trd-${Date.now().toString(36)}-${state.trades.length + 1}`,
    marketId: market.id,
    matchId: match.id,
    side,
    competitorId,
    amount: quote.amount,
    shares: quote.shares,
    averagePrice: quote.averagePrice,
    probabilityBefore: quote.probabilityBefore,
    probabilityAfter: quote.probabilityAfter,
    priceImpact: quote.priceImpact,
    createdAt
  };
  const nextPositions = updatePositionAfterTrade(state.positions, trade, existing);
  const nextState = {
    ...state,
    balance: roundMoney(state.balance + (side === "sell" ? quote.amount : -quote.amount)),
    markets: state.markets.map((candidate) => (candidate.id === market.id ? nextMarket : candidate)),
    positions: nextPositions,
    trades: [trade, ...state.trades]
  };

  return {
    ...nextState,
    positions: markPositions(nextState)
  };
}

function updatePositionAfterTrade(positions: Position[], trade: Trade, existing?: Position) {
  if (trade.side === "buy" && existing) {
    return positions.map((position) => {
      if (position.id !== existing.id) {
        return position;
      }

      const shares = roundShares(position.shares + trade.shares);
      const costBasis = roundMoney(position.costBasis + trade.amount);

      return {
        ...position,
        shares,
        costBasis,
        averagePrice: roundMoney(costBasis / shares),
        updatedAt: trade.createdAt
      };
    });
  }

  if (trade.side === "buy") {
    return [
      {
        id: positionIdFor(trade.marketId, trade.competitorId),
        marketId: trade.marketId,
        matchId: trade.matchId,
        competitorId: trade.competitorId,
        shares: trade.shares,
        costBasis: trade.amount,
        averagePrice: trade.averagePrice,
        realizedPnl: 0,
        currentProbability: trade.probabilityAfter,
        markValue: 0,
        payoutIfCorrect: trade.shares,
        unrealizedPnl: 0,
        isResolved: false,
        isWinner: false,
        updatedAt: trade.createdAt
      },
      ...positions
    ];
  }

  if (!existing) {
    return positions;
  }

  return positions.map((position) => {
    if (position.id !== existing.id) {
      return position;
    }

    const previousShares = position.shares;
    const costRemoved = previousShares > 0 ? roundMoney(position.costBasis * (trade.shares / previousShares)) : 0;
    const shares = roundShares(Math.max(previousShares - trade.shares, 0));
    const costBasis = shares > 0 ? roundMoney(Math.max(position.costBasis - costRemoved, 0)) : 0;

    return {
      ...position,
      shares,
      costBasis,
      averagePrice: shares > 0 ? roundMoney(costBasis / shares) : 0,
      realizedPnl: roundMoney(position.realizedPnl + trade.amount - costRemoved),
      updatedAt: trade.createdAt
    };
  });
}

export function settleMarket(state: AppState, marketId: string, winnerId: string, finish: string): AppState {
  const now = new Date().toISOString();
  const market = state.markets.find((item) => item.id === marketId);

  if (!market || market.status === "settled") {
    return state;
  }

  const payout = state.positions
    .filter((position) => position.marketId === marketId && position.competitorId === winnerId)
    .reduce((sum, position) => sum + position.shares, 0);
  const nextState = {
    ...state,
    balance: roundMoney(state.balance + payout),
    markets: state.markets.map((item) =>
      item.id === marketId
        ? {
            ...item,
            status: "settled" as const,
            resolvedAt: now,
            resolvedOutcomeId: winnerId,
            resolverNotes: finish,
            updatedAt: now
          }
        : item
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
    )
  };

  return {
    ...nextState,
    positions: markPositions(nextState)
  };
}

export function lockMarket(state: AppState, marketId: string): AppState {
  const market = state.markets.find((item) => item.id === marketId);

  if (!market) {
    return state;
  }

  const now = new Date().toISOString();

  return {
    ...state,
    markets: state.markets.map((item) =>
      item.id === marketId ? { ...item, status: "locked" as const, updatedAt: now } : item
    ),
    matches: state.matches.map((match) =>
      match.id === market.matchId ? { ...match, status: "locked" as const } : match
    )
  };
}
