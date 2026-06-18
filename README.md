# BJJ Predict

A BJJ-first prediction-market MVP for Smoothcomp-style event data. The launch product is intentionally free-play and niche: users trade winner shares, watch LMSR probabilities move, and compete on predictor and academy leaderboards.

## What is included

- React + TypeScript + Vite app
- BJJ-only market UI with event filters and match cards
- Generic sports-ready data model under the BJJ surface
- Markketz-style LMSR automated market maker for thin-volume markets
- Play-money buy/sell trade ticket with shares, average price, and price impact
- Portfolio positions with mark value, realized PnL, unrealized PnL, and recent trades
- LocalStorage persistence for balance, trades, positions, imported events, and settlements
- Mock Smoothcomp importer that parses `smoothcomp.com/en/event/:id` URLs
- Admin controls for syncing, locking, and settling winner markets
- Generated BJJ mat visual asset at `public/bjj-mat-hero.png`

## Commands

```bash
npm install
npm run dev
npm run build
```

## Product direction

The best wedge is BJJ-only: Smoothcomp events, divisions, academies, brackets, and athlete names are specific enough to form a focused community. The backend concepts are generic enough to support other sports later, but the initial UX and copy should stay centered on Brazilian jiu-jitsu.

The first production data path should be:

1. Import Smoothcomp event URL.
2. Stage matches for admin review.
3. Open free-play LMSR winner markets.
4. Let users buy and sell shares while viewing price impact.
5. Lock markets before scheduled start.
6. Settle from verified match results, paying 1 point per winning share.

Real-money markets should not be added until there is a licensed/compliant path. This MVP keeps settlement in points only.
