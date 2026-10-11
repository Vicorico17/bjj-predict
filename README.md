# BJJ Predict

A BJJ-first prediction-market MVP with Smoothcomp, AJP, IBJJF, FloArena and FloGrappling data adapters. The launch product is intentionally free-play and niche: users trade winner shares, watch LMSR probabilities move, and compete on predictor and academy leaderboards.

## What is included

- React + TypeScript + Vite app
- BJJ-only market UI with event filters and match cards
- Generic sports-ready data model under the BJJ surface
- Markketz-style LMSR automated market maker for thin-volume markets
- Play-money buy/sell trade ticket with shares, average price, and price impact
- Portfolio positions with mark value, realized PnL, unrealized PnL, and recent trades
- LocalStorage persistence for balance, trades, positions, imported events, and settlements
- Optional Open Wallet Standard (OWS) Solana wallet link, verified by a locally signed message
- Smoothcomp sync worker that imports public grappling events, published brackets, athlete photos, club logos, match status, score fields, and winners
- Generated app snapshot at `src/generated/smoothcomp-live-snapshot.json`
- Admin controls for syncing, locking, and settling winner markets
- Generated BJJ mat visual asset at `public/bjj-mat-hero.png`

## Expanded event coverage

The public views default to major championships and professional shows. **Show all events** includes smaller tournaments. In **Competitions**, search by event name, city, country, venue, or a competitor from loaded matchups. Search includes smaller events in the selected upcoming/history view even when the default filter is on.

Discovery combines tournament platforms with BJJ Championships, GrapplersNews, and paginated Go Sofia listings. Independent events are discovered from live calendars without adding individual shows to code. Source failures and crawl limits are reported, and the catalog refreshes every five minutes while the app is open. The major-event filter affects presentation, not discovery.

`src/generated/featured-events.json` is an offline fallback and optional reviewed match supplement, not a discovery source. Missing tournament pairings and live scores are not inferred. Announced cards remain locked for trading and visible through the event window (24 hours after the start when no end is published).

Admin → **Find and import competitions** discovers current events across tournament platforms, professional-show calendars, and local listings. Paste event URLs to import any of those sources or FloGrappling. Coverage counts and warnings distinguish published brackets, limited imports and recent-result windows.

```bash
npm run sync:data -- --discover
npm run sync:data -- https://ajptour.com/en/event/1552
npm run test:data
```

Use Node.js 22 or later. See [data coverage and API details](docs/data-sources.md) for verified contracts, limitations and the usage-limited live validation status. The existing standalone Smoothcomp and Flo commands remain available.

Admin also includes a **liquidity planner** that estimates subsidy, trade size and price movement without changing market funding. See [the proposed crypto liquidity design](docs/liquidity.md).

## Competition data

Smoothcomp and AJP competition pages have Athletes, Brackets, Schedule, and Results tabs. Opening a competition checks its public athlete list and first division. Search athletes by name, academy, or country; choose a division to inspect its draw. **Load all divisions** follows bracket offsets in batches, including divisions beyond 200. Published byes and advancement slots remain visible but never create prediction markets. Stored matchups remain visible if a refresh fails.

The public athlete list is used when its table is available; otherwise athletes come from loaded brackets. Source failures, incomplete imports, and missing scores are shown explicitly. Live site access can return HTTP 403, so complete public data cannot be guaranteed. Large imports remain usable if browser storage fills, with a persistence warning.

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

## Link an OWS Solana wallet

Install the [Open Wallet Standard CLI](https://openwallet.sh/) on your own computer (`npm install -g @open-wallet-standard/core`). The CLI is also available in this project's development dependencies; `npm run ows:wallets` lists local wallets. Create a wallet with `ows wallet create --name bjj-predict` if you do not already have one. Keep the wallet password and recovery phrase outside the app.

Open the BJJ Predict app and select **Link OWS** next to the demo balance. Run `ows wallet list` locally, enter the Solana address and OWS wallet name, then run the one-time signing command shown in the app. Paste only the resulting signature into the app. The browser verifies the Ed25519 signature and remembers the public address locally. Unlinking removes that association from browser storage.

This links a public Solana address to the browser's existing points account. Predictions, balances, and settlements still use demo points in browser storage; linking does not send Solana transactions or create an on-chain market.


## Competition loading and winner picks

- App startup refreshes the Smoothcomp directory independently from the other directories. It no longer probes and imports every event in the background.
- Opening an event fetches three divisions first. Use **Load next 3 divisions**, choose a specific division, or explicitly load the full event. The public athlete roster is fetched only on request.
- Changing events aborts the previous browser request. Completed responses cannot replace the newly selected event. Large lists render 50 items at a time.
- Smoothcomp metadata and draw responses have bounded server-instance caches and concurrent-request deduplication. Active scoreboards take priority over completed bouts, with at most three scoreboard requests in flight and 12 scoreboards per page.
- During an event, the last opened divisions refresh every 15 seconds while the app is visible. HTTP failures retain saved data. Public sources may deny access (403); unavailable scores are not invented.
- **Who wins?** buttons save one changeable winner pick per matchup in this browser. Picks lock at the scheduled start, when a bout is live, or when a result is known. Confirmed winners resolve picks in **Predictions → My winner picks**. Changed matchups void the previous pick. Unknown start times remain paused.
- Winner picks are a local demo feature, separate from points trading and the optional wallet link. There is no server account or cross-device synchronization.

Verification includes a 90-upcoming-bout fixture loaded through five upstream requests (metadata, catalog, three draws), live-score priority/concurrency tests, and browser checks for switching events, pagination, score polling, pick persistence, and settlement.
