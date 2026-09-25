# Data coverage implementation

Updated 2026-09-12. The adapters use public website responses; none is represented as a contracted API with complete coverage or uptime guarantees.

## Available providers

| Provider | Discovery | Imported data | Verified limitations |
| --- | --- | --- | --- |
| Smoothcomp | Public grappling calendar | Published brackets, athletes, status, winners, scores, clocks when available | Bounded bracket and scoreboard requests; unpublished or failed brackets reported |
| AJP Tour | Public AJP calendar | Same bracket schema, with AJP-hosted match and scoreboard requests | Separate ID namespace from Smoothcomp; limited imports show actual bracket counts |
| IBJJF / BJJCompsystem | Current tournament selector | Published matchups, clubs and bracket results | No verified numeric scores or reliable live state; pending fixtures remain locked; byes excluded |
| FloArena | Current grappling events | Recent result window, stable bout GUIDs and exact result strings | Full bracket endpoint returned HTTP 500; no completeness claim; numeric score orientation unverified |
| FloGrappling | Event URL import | Published results, numeric scores and finish methods, including linked pagination and gender filters | Does not retrieve FloArena live brackets; no public calendar adapter implemented |

## Use in the app

Open Admin → Find and import competitions. Discover current events, search or filter by provider, then import an event. You can also paste a supported event URL directly. Bracket limits of 10, 30 or 100 trade request time against coverage. Black belts are prioritized for IBJJF when the limit truncates categories.

Refresh imported events processes every locally stored imported event, including ones absent from the original bundled Smoothcomp snapshot. Each event failure preserves the existing data. This replaces the previous UI behavior that only refreshed fixed Smoothcomp event URLs.

Event pages show provider, observation time, imported match count, numeric-score coverage, bracket counts and source warnings. FloArena and FloGrappling can represent the same tournament separately: cross-provider deduplication is NOT implemented, and their match counts must not be added as unique fights. Names alone are not identity keys.

Discovered events do not open markets. Imported completed results cannot be traded retrospectively. An unresolved source match only opens if its scheduled start is in the future and its observation is at most two minutes old. The trade function rechecks freshness and start time, including after the UI has been idle. This is a conservative play-money safeguard, not a production oracle. IBJJF pending fixtures have no verified exact start/live status and remain locked.

## Endpoints and scripts

- `GET /api/data/discover`: discovery across Smoothcomp, AJP, IBJJF and FloArena; errors are isolated per provider; 60-second process-local cache.
- `POST /api/data/import`: JSON body with `eventUrl` and optional `bracketLimit` (1–100), `matchLimit` (1–2000), `liveScoreLimit` (1–200). Detects provider from a validated host. Concurrent identical requests share work; three imports per process; 15-second result cache.
- `npm run sync:data -- --discover`: update the bundled discovery list.
- `npm run sync:data -- --discover --import-current`: discover and import up to eight currently live events in source order.
- `npm run sync:data -- https://ajptour.com/en/event/1552 https://www.bjjcompsystem.com/tournaments/3367/categories`: import chosen events and merge into `src/generated/data-snapshot.json`.
- `npm run sync:flo -- 11302663`: legacy standalone Flo snapshot command.
- `npm run test:data`: parser, routing, partial-failure, snapshot and liquidity-model tests.

The new endpoints use the same handlers in Vite and Vercel. Runtime imports persist in browser LocalStorage, not a shared database. CLI imports persist to the bundle; redeploy after regenerating bundled data. No cron or chain deployment was performed.

## Observed source contracts

Smoothcomp and AJP:

- `/en/events/upcoming` contains `var events` JSON.
- `/en/event/{id}/schedule/brackets.json` lists published brackets.
- `/en/event/{id}/schedule/new/bracket.json/{bracketId}` contains matches.
- `/en/getBracketMatchData/{matchId}` contains scoreboard fields.

AJP requests stay on `ajptour.com`; numeric IDs must never be used against `smoothcomp.com`. Source, event, bracket and competitor identities are namespaced. Each Smoothcomp worker now owns its options and warnings, preventing concurrent requests from changing one another's import targets.

IBJJF:

- The [current tournament selector](https://www.bjjcompsystem.com/) publishes tournament IDs.
- `/tournaments/{id}/categories` links to category pages.
- Category match cards contain scoped DOM match IDs, competitor IDs, names, clubs and loser markers. A single loser marker with two named competitors identifies the other side as the bracket winner; two or no loser markers do not resolve a winner. Numeric scores and method are not inferred from bracket numbers or colors.

FloArena:

- `/events/current` provides current event GUIDs; verified ADCC Worlds 2026 GUID `52703b65-bade-46e2-9ce2-399dd32d93e4`.
- `/event/{guid}/info` provides event metadata.
- `/event/{guid}/recent-results` provides a rolling result window and explicit winner GUIDs.
- `/event/{guid}/brackets` returned HTTP 500 for both tested ADCC editions. Mat/upcoming endpoints returned empty bout lists for the tested current event. No workaround or invented full-bracket adapter was added.

FloGrappling:

- The [ADCC 2024 results page](https://www.flograppling.com/events/11302663/results) embeds `flo-app-state` JSON.
- Follow only public same-event View All, gender and pagination links, including `/api/experiences/web/event-hub/{id}/results/list/partial` on `api.flograppling.com`.
- W/L results retain unknown numeric scores, even if a placeholder `points: 0` is supplied.

## Validation and bundled evidence

The earlier live Flo import contains 114 published ADCC 2024 records across seven pages. Before the usage limit blocked further network checks, public responses were downloaded for AJP Germany 2026, IBJJF South American No-Gi 2026, and FloArena ADCC 2024/2026.

Those downloaded responses produced the added bundled evidence: AJP 3 matches from 1 of 64 published brackets, IBJJF 17 matches from 1 of 174 categories, and FloArena 20 recent results. They are explicitly marked limited/partial, retain their observation timestamps, and do not imply a full live import was completed. The API orchestration was tested with these captured response contracts; remaining live end-to-end checks are blocked by automatic approval review's usage-limit rejection.

Failed providers retain existing results. Unknown scores stay null. Ambiguous winners stay locked. Corrections that change opponents or an already confirmed winner are flagged for review rather than silently rewriting payouts. Source requests use host validation, redirect validation, timeouts and request budgets.

## Later coverage

[ADCC official results](https://adcombat.com/2024-adcc-world-championship-day-2-full-results/), [BJJ Heroes](https://www.bjjheroes.com/) and [UWW result documents](https://cms.uww.org/arena/weight-category/1f0a0df0-6d53-61b2-ba6a-85ba4a8e95d1/results.pdf) remain useful verification/history sources. They have no implemented adapters here. Prioritize reliable shared storage, scheduled refresh and cross-provider identity review before broadening to more article/PDF sources.
