// Planning model for independent binary LMSR markets starting at 50/50,
// one collateral unit per winning share, fixed b, no fees or gas.
export function planLiquidity(totalSubsidy: number, marketCount: number, tradeSize: number, impactLimit: number) {
  if (!Number.isFinite(totalSubsidy) || totalSubsidy <= 0 || !Number.isInteger(marketCount) || marketCount <= 0 ||
      !Number.isFinite(tradeSize) || tradeSize <= 0 || !Number.isFinite(impactLimit) || impactLimit <= 0 || impactLimit >= 0.5) {
    throw new Error('Enter positive budgets and trade sizes, a whole number of markets, and a price movement below 50 percentage points.');
  }
  const subsidyPerMarket = totalSubsidy / marketCount;
  const liquidity = subsidyPerMarket / Math.LN2;
  const probabilityAfter = 1 - 0.5 * Math.exp(-tradeSize / liquidity);
  const requiredLiquidity = -tradeSize / Math.log1p(-2 * impactLimit);
  const requiredSubsidyPerMarket = requiredLiquidity * Math.LN2;
  return { subsidyPerMarket, liquidity, probabilityAfter, priceImpact: probabilityAfter - 0.5,
    requiredSubsidyPerMarket, requiredTotalSubsidy: requiredSubsidyPerMarket * marketCount,
    marketsWithinBudget: Math.floor(totalSubsidy / requiredSubsidyPerMarket),
    tradeWithinImpact: -liquidity * Math.log1p(-2 * impactLimit) };
}
