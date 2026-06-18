# BJJ Predict

A BJJ-first prediction-market MVP for Smoothcomp-style event data. The launch product is intentionally free-play and niche: users pick winners, stake points, watch implied probabilities move, and compete on predictor and academy leaderboards.

## What is included

- React + TypeScript + Vite app
- BJJ-only market UI with event filters and match cards
- Generic sports-ready data model under the BJJ surface
- Play-money prediction tickets with live implied probabilities
- LocalStorage persistence for balance, predictions, imported events, and settlements
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
3. Open free-play winner markets.
4. Lock markets before scheduled start.
5. Settle from verified match results.

Real-money markets should not be added until there is a licensed/compliant path. This MVP keeps settlement in points only.
