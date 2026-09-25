# Making BJJ markets tradable

The app already implements a logarithmic market scoring rule (LMSR) automated market maker. That provides executable buy/sell quotes without requiring another user to place an opposing order. It does not supply real collateral: the existing market balances, positions and payouts are browser-local play money.

## Recommended launch design

1. Curate a few headline match markets. Event discovery can cover thousands of matches, but funded trading should initially concentrate on perhaps 3–10 at a time, depending on the budget and intended ticket size.
2. Fund a fixed-subsidy binary AMM for each selected match using the same stable collateral unit as the winning payout. Ring-fence the theoretical maximum maker loss at market creation; do not reuse that reserve while liabilities remain unresolved.
3. Allow users to sell their positions back to the AMM before the trading cutoff. Show expected fill price, final price, minimum output and fees before execution. Quotes alone are not enough: the actual reserve and accounting must support redemption.
4. Lock trading before the bout's scheduled start, and on missing/stale data. BJJ feeds can lag real action. Start with pre-match markets; live markets require a stronger low-latency feed contract and halt mechanism.
5. Resolve through a defined result authority and review/dispute process. Specify walkovers, DQs, replaced opponents, cancellations and draws before trading. A scraped winner is not by itself a production settlement oracle.
6. Add external makers and an order book only after there is demand. Reward sustained two-sided quotes near fair value rather than raw trade volume. Self-trading and fragmented books do not create useful depth.

The AMM is the launch liquidity backstop. A future order book can route larger flow to competitive makers; AMM and order-book paths must share the same outcome tokens, collateral and settlement rules. Liquidity rewards are an additional expense, not collateral backing.

## Budget model

For a binary LMSR starting at 50/50, with fixed liquidity parameter `b` and a 1-unit winning payout:

- Maximum theoretical maker loss / initial subsidy: `S = b × ln(2)`.
- After buying one outcome with `A` collateral units: `p_after = 1 − 0.5 × exp(−A/b)`.
- To keep a buy's terminal price movement to `d` above 50%: `b >= −A / ln(1 − 2d)`, where `0 < d < 0.5`.

These calculations assume no fees or gas. The subsidy is the maximum net maker loss, not total future turnover or total outstanding payout. Biased initial prices require a different worst-case reserve: `b × ln(1/p_min)`. Do not change `b` on existing positions without a separately designed funded liquidity-adjustment mechanism.

Examples calculated from the app's pricing model:

| Scenario | Result |
| --- | --- |
| Current default `b = 120`, 50/50 | Maximum theoretical subsidy loss ≈ 83.18 units |
| A 100-unit buy with `b = 120` | Terminal price rises to ≈ 78.27% |
| 100-unit buy, at most 5 percentage points of movement | Subsidy ≈ 657.88 units per market |
| Ten such markets | Subsidy ≈ 6,578.81 units, before fees/gas/operating reserves |
| 2,000-unit total budget at that trade size/depth | Three simultaneous markets |

The **Admin liquidity planner** implements these calculations and is tested against the actual LMSR quote engine. Its inputs do not change market liquidity or move money.

## Implementation boundary

Implemented now: data-provider coverage, conservative imported-match trading gates, play-money AMM, and the liquidity planner. Real collateral deposits, outcome tokens, smart contracts, a shared trade ledger, maker incentives, order-book routing and dispute settlement are not implemented or funded. Production crypto launch requires those components and a separate legal/compliance path; the current browser-local demo must not accept real deposits.

Source references: [Hanson's LMSR paper](https://hanson.gmu.edu/mktscore.pdf), [Polymarket order lifecycle](https://docs.polymarket.com/concepts/order-lifecycle), [liquidity rewards](https://help.polymarket.com/en/articles/13364466-liquidity-rewards). The proposed BJJ architecture is our design recommendation; it is not a claim that Polymarket supplies liquidity for these markets.
