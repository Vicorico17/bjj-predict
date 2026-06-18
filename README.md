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
- Smoothcomp sync worker that imports public grappling events, published brackets, athlete photos, club logos, match status, score fields, and winners
- Generated app snapshot at `src/generated/smoothcomp-live-snapshot.json`
- Admin controls for syncing, locking, and settling winner markets
- Generated BJJ mat visual asset at `public/bjj-mat-hero.png`

## Commands

```bash
npm install
npm run sync:smoothcomp
npm run dev
npm run build
```

## Smoothcomp live sync

Refresh the imported Smoothcomp snapshot with:

```bash
npm run sync:smoothcomp
```

Useful variants:

```bash
npm run sync:smoothcomp -- --event=https://grapplingindustries.smoothcomp.com/en/event/27144
npm run sync:smoothcomp -- --event-limit=all --bracket-limit=all --match-limit=all --live-score-limit=500
```

The worker currently uses Smoothcomp public pages and public JSON endpoints:

1. Discover BJJ/grappling events from the public event calendar.
2. Fetch each event's published `schedule/brackets.json`.
3. Fetch bracket match JSON for the selected brackets.
4. Poll per-match live data for clock, points, advantages, penalties, state, and winners.
5. Fetch per-match athlete details for player photos and club logos when Smoothcomp exposes them publicly.
6. Write `src/generated/smoothcomp-live-snapshot.json`.
7. The app hydrates from that snapshot on load and settles matching markets when a winner appears.

For production, run the sync job on a short schedule during event hours and a slower schedule outside event hours. Keep limits/rate controls in place. If we need every scoreboard globally with stronger guarantees, we should get Smoothcomp partner/API access instead of relying only on public endpoints.

## Product direction

The best wedge is BJJ-only: Smoothcomp events, divisions, academies, brackets, and athlete names are specific enough to form a focused community. The backend concepts are generic enough to support other sports later, but the initial UX and copy should stay centered on Brazilian jiu-jitsu.

The first production data path should be:

1. Run the Smoothcomp sync worker for upcoming/current BJJ events.
2. Stage imported matches for admin review when needed.
3. Open free-play LMSR winner markets.
4. Let users buy and sell shares while viewing price impact.
5. Lock markets once Smoothcomp marks a match live.
6. Settle from Smoothcomp winners, paying 1 point per winning share.

Real-money markets should not be added until there is a licensed/compliant path. This MVP keeps settlement in points only.
