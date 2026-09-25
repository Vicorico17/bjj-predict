import { useState } from 'react';
import { planLiquidity } from './liquidity';

export function LiquidityPlanner() {
  const [budget, setBudget] = useState(2000);
  const [markets, setMarkets] = useState(10);
  const [trade, setTrade] = useState(100);
  const [impact, setImpact] = useState(5);
  let result, error;
  try { result = planLiquidity(budget, markets, trade, impact / 100); }
  catch (caught) { error = caught instanceof Error ? caught.message : 'Invalid inputs'; }
  const amount = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return <div className="panel liquidity-planner">
    <div className="section-heading"><div><span className="eyebrow">Launch planning</span><h2>How many liquid markets can we fund?</h2></div></div>
    <p>Estimate the subsidy needed for useful trade sizes. This calculator does not allocate funds or change existing markets.</p>
    <div className="liquidity-inputs">
      <label>Total subsidy budget<input type="number" min="1" value={budget} onChange={event => setBudget(Number(event.target.value))} /></label>
      <label>Simultaneous markets<input type="number" min="1" step="1" value={markets} onChange={event => setMarkets(Number(event.target.value))} /></label>
      <label>Typical buy size<input type="number" min="1" value={trade} onChange={event => setTrade(Number(event.target.value))} /></label>
      <label>Maximum price movement (percentage points)<input type="number" min="0.1" max="49" step="0.5" value={impact} onChange={event => setImpact(Number(event.target.value))} /></label>
    </div>
    {error && <p role="alert">{error}</p>}
    {result && <div className="coverage-note" aria-live="polite">
      <strong>Budget supports {result.marketsWithinBudget} markets at the chosen trade size and movement limit.</strong>
      <span>Across {markets} markets: {amount(result.subsidyPerMarket)} subsidy per market.</span>
      <span>A {amount(trade)} buy moves a 50% price to {amount(result.probabilityAfter * 100)}%.</span>
      <span>For at most {impact} percentage points of movement: {amount(result.requiredSubsidyPerMarket)} per market, or {amount(result.requiredTotalSubsidy)} total.</span>
      <span>With your current allocation, the buy size within that limit is {amount(result.tradeWithinImpact)}.</span>
    </div>}
    <p className="source-checked">All amounts use the same collateral unit. Assumes independent binary LMSR markets at 50/50, fixed liquidity, and a 1-unit winning payout. Subsidy is maximum theoretical maker loss; fees, gas and operating reserves are additional.</p>
  </div>;
}
