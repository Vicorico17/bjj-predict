import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const folder = await mkdtemp(path.join(os.tmpdir(), 'bjj-data-tests-'));
await build({ entryPoints: ['src/smoothcomp.ts', 'src/liquidity.ts', 'src/market.ts', 'src/events.ts'], outdir: folder, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
const { applyDataSnapshot } = await import(pathToFileURL(path.join(folder, 'smoothcomp.mjs')));
const { planLiquidity } = await import(pathToFileURL(path.join(folder, 'liquidity.mjs')));
const { costToBuyShares, quantitiesFromProbabilities, quoteBuy, isMatchTradable } = await import(pathToFileURL(path.join(folder, 'market.mjs')));
const { currentEvents, isCurrentMatch, isMajorCompetition, searchCompetitions } = await import(pathToFileURL(path.join(folder, 'events.mjs')));
await rm(folder, { recursive: true });
const fixture = JSON.parse(await readFile('src/generated/data-snapshot.json', 'utf8'));
const empty = () => ({ balance: 1000, competitors: [], events: [], matches: [], markets: [], positions: [], trades: [] });

test('All provider snapshots hydrate without ID collisions or unsafe trading', () => {
  const state = applyDataSnapshot(empty(), fixture);
  assert.equal(state.matches.length, fixture.events.reduce((count, event) => count + event.matches.length, 0));
  assert.equal(new Set(state.matches.map(match => match.id)).size, state.matches.length);
  const matchesById = new Map(state.matches.map(match => [match.id, match]));
  for (const market of state.markets) {
    const match = matchesById.get(market.matchId);
    if (market.status === 'open') assert(match && isMatchTradable(match));
    if (match?.status === 'settled') assert.notEqual(market.status, 'open');
  }
  for (const match of state.matches) {
    const a = state.competitors.find(competitor => competitor.id === match.competitorAId);
    const b = state.competitors.find(competitor => competitor.id === match.competitorBId);
    assert(a && b);
    assert(!/^(?:winner|loser) from\b/i.test(a.name));
    assert(!/^(?:winner|loser) from\b/i.test(b.name));
  }
  assert.equal(state.balance, 1000);
  assert.equal(applyDataSnapshot(state, fixture).matches.length, state.matches.length);
  assert.equal(state.events.find(event => event.source === 'ibjjf').startsAt, '');
});

test('A partial import keeps artwork discovered from the event calendar', () => {
  const sourceUrl = 'https://smoothcomp.com/en/event/123';
  const existing = { id: 'e-smoothcomp-123', sport: 'bjj', name: 'Upcoming BJJ event', organizer: 'Smoothcomp',
    city: 'Bucharest', startsAt: '2030-01-01T10:00:00Z', sourceUrl, source: 'smoothcomp', status: 'upcoming',
    imageUrl: 'https://smoothcomp.com/pictures/real-event.jpg', lastSyncedAt: '2026-09-28T10:00:00Z' };
  const snapshot = { source: 'smoothcomp', syncedAt: '2026-09-28T10:01:00Z', calendarUrl: '',
    events: [{ id: existing.id, sourceEventId: '123', name: existing.name, sourceUrl, status: 'upcoming',
      startsAt: existing.startsAt, matches: [], coverage: { level: 'partial', matchCount: 0, scoredMatches: 0 } }] };
  const result = applyDataSnapshot({ ...empty(), events: [existing] }, snapshot);
  assert.equal(result.events[0].imageUrl, existing.imageUrl);
});

test('Partial imports preserve previous matches and newer observation times', () => {
  const state = applyDataSnapshot(empty(), fixture);
  const old = state.events[0];
  state.events[0] = { ...old, name: 'Newer data', lastSyncedAt: '2099-01-01T00:00:00Z' };
  const next = applyDataSnapshot(state, fixture);
  assert.equal(next.events[0].name, 'Newer data');
  assert.equal(next.matches.length, state.matches.length);
});

test('Unknown winners remain locked; cancelled/locked source status locks an open market', () => {
  const source = structuredClone(fixture.events[0]);
  source.matches = [source.matches[0]];
  const match = source.matches[0];
  match.winnerSide = null; match.winnerSourceId = null; match.status = 'open';
  source.observedAt = new Date().toISOString();
  match.scheduledAt = new Date(Date.now() + 3600000).toISOString();
  const snapshot = { source: 'mixed', syncedAt: source.observedAt, events: [source] };
  const initial = applyDataSnapshot(empty(), snapshot);
  assert.equal(initial.markets[0].status, "open");
  match.status = 'locked';
  const locked = applyDataSnapshot(initial, snapshot);
  assert.equal(locked.markets[0].status, 'locked');
  match.status = 'settled';
  const unknown = applyDataSnapshot(empty(), snapshot);
  assert.equal(unknown.matches[0].status, 'locked');
  assert.equal(unknown.markets[0].status, 'locked');
});

test('Conflicting winners do not silently rewrite already settled markets', () => {
  const state = applyDataSnapshot(empty(), fixture);
  const changed = structuredClone(fixture);
  changed.events[0].matches[0].winnerSide = 'right';
  changed.events[0].observedAt = '2099-01-01T00:00:00Z';
  const next = applyDataSnapshot(state, changed);
  const matchId = `m-ajp-${changed.events[0].matches[0].sourceMatchId}`;
  assert.equal(next.matches.find(match => match.id === matchId).winnerId, state.matches.find(match => match.id === matchId).winnerId);
  assert(next.events.find(event => event.id === changed.events[0].id).warnings.some(warning => warning.includes('review required')));
});

test('Liquidity planner matches the actual LMSR engine, and inverses respect target impact', () => {
  const plan = planLiquidity(2000, 10, 100, 0.05);
  const match = { competitorAId: 'a', competitorBId: 'b' };
  const market = { liquidity: plan.liquidity, quantities: quantitiesFromProbabilities(['a', 'b'], [0.5, 0.5], plan.liquidity) };
  const quote = quoteBuy(market, match, 'a', 100);
  assert(Math.abs(quote.probabilityAfter - plan.probabilityAfter) < 1e-6);
  const funded = planLiquidity(plan.requiredTotalSubsidy, 10, 100, 0.05);
  assert(Math.abs(funded.priceImpact - 0.05) < 1e-10);
  assert.equal(plan.marketsWithinBudget, 3);
  assert.throws(() => planLiquidity(0, 10, 100, 0.05));
  assert.throws(() => planLiquidity(1000, 0, 100, 0.05));
  assert.throws(() => planLiquidity(1000, 1, 100, 0.5));
  assert(costToBuyShares(market, match, 'a', 1) > 0);
});

test('Imported markets cannot trade after stale observations or scheduled start', () => {
  const match = { status: 'open', sourceMatchId: '1', scheduledAt: new Date(Date.now() + 3600000).toISOString(), sourceObservedAt: new Date().toISOString() };
  assert.equal(isMatchTradable(match), true);
  assert.equal(isMatchTradable({ ...match, sourceObservedAt: new Date(Date.now() - 180000).toISOString() }), false);
  assert.equal(isMatchTradable({ ...match, scheduledAt: new Date(Date.now() - 1000).toISOString() }), false);
  assert.equal(isMatchTradable({ ...match, sourceObservedAt: undefined }), false);
});

test('Announced cards without end times and delayed bouts remain visible during the event', () => {
  const now = Date.parse('2026-10-11T18:00:00Z');
  const event = { id: 'sofia', source: 'curated', name: 'Grappling Grand Prix 88', startsAt: '2026-10-11T16:00:00Z', status: 'upcoming' };
  const match = { eventId: event.id, status: 'locked', scheduledAt: event.startsAt, sourceState: 'card-announced' };
  assert.equal(isCurrentMatch(match, [event], now), true);
  assert.equal(isCurrentMatch({ ...match, sourceState: 'scheduled' }, [event], now), true);
  assert.equal(isCurrentMatch({ ...match, scheduledAt: '' }, [event], now), true);
  assert.equal(isCurrentMatch({ ...match, status: 'settled' }, [event], now), false);
  assert.equal(isCurrentMatch(match, [{ ...event, status: 'complete' }], now), false);
  assert.equal(isCurrentMatch(match, [event], now + 2 * 86400000), false);
  assert.equal(currentEvents([event], now)[0].status, 'live');
  assert.equal(currentEvents([{ ...event, startsAt: '2026-10-09T00:00:00Z', endsAt: '2026-10-12T20:00:00Z' }], now).length, 1);
});

test('Major competitions include professional cards and championships, excluding routine opens', () => {
  for (const name of ['Grappling Grand Prix 88', 'IBJJF World Championship', 'ADCC European Trials', 'Polaris 40', 'AJP Grand Slam', 'European Jiu-Jitsu Championship']) {
    assert.equal(isMajorCompetition({ source: 'smoothcomp', name }), true, name);
  }
  assert.equal(isMajorCompetition({ source: 'ufcbjj', name: 'UFC BJJ 10' }), true);
  assert.equal(isMajorCompetition({ source: 'smoothcomp', name: 'Grappling Industries London' }), false);
  assert.equal(isMajorCompetition({ source: 'ibjjf', name: 'Sofia International Open' }), false);
});

test('Competition search matches names, cities, countries, venues, and either athlete without duplicates', () => {
  const events = [
    { id: 'sofia', name: 'Grappling Grand Prix 88', city: 'Sofia, Bulgaria', venue: 'Mixtape 5', organizer: 'New Eventic Aventura' },
    { id: 'paris', name: 'Paris Open', city: 'Paris, France' }
  ];
  const competitors = [{ id: 'a', name: 'Kaloyan Kolev' }, { id: 'b', name: 'Dimitar Shtarbanov' }, { id: 'c', name: 'José Silva' }];
  const matches = [{ eventId: 'sofia', competitorAId: 'a', competitorBId: 'b' }, { eventId: 'paris', competitorAId: 'c', competitorBId: 'b' }];
  for (const query of ['grand prix', ' SOFIA ', 'bulgaria', 'mixtape', 'Kolev', 'sofia dimitar']) {
    assert.deepEqual(searchCompetitions(events, matches, competitors, query).map(event => event.id), ['sofia'], query);
  }
  assert.equal(searchCompetitions(events, matches, competitors, 'shtarbanov').length, 2);
  assert.deepEqual(searchCompetitions(events, matches, competitors, 'jose').map(event => event.id), ['paris']);
  assert.equal(searchCompetitions(events, matches, competitors, 'unknown').length, 0);
  assert.deepEqual(searchCompetitions(events, matches, competitors, '  '), events);
});

test('Sofia featured snapshot immediately hydrates three sourced matchups with locked markets', async () => {
  const featured = JSON.parse(await readFile('src/generated/featured-events.json', 'utf8'));
  const state = applyDataSnapshot(empty(), featured);
  const now = Date.parse('2026-10-10T19:00:00Z');
  assert.equal(currentEvents(state.events, now).length, 1);
  assert.equal(state.matches.filter(match => isCurrentMatch(match, state.events, now)).length, 3);
  assert(state.markets.every(market => market.status === 'locked'));
  assert.equal(searchCompetitions(state.events, state.matches, state.competitors, 'sofia kolev').length, 1);
});

test('Full draw hydration keeps athletes without matchups and merges separately fetched divisions', () => {
  const first = { source: 'smoothcomp', syncedAt: '2090-01-01T00:00:00Z', calendarUrl: '', events: [{
    id: 'e-smoothcomp-987', sourceEventId: '987', name: 'BJJ Open', startsAt: '2099-01-01T00:00:00Z', status: 'upcoming', sourceUrl: 'https://smoothcomp.com/en/event/987', matches: [],
    participants: [{ sourceId: 'p1', name: 'Alex Solo', academy: 'Example', country: 'BG', division: 'Adult Black' }],
    brackets: [{ sourceId: 'b1', name: 'Adult Black', loaded: true, bouts: [] }, { sourceId: 'b2', name: 'Adult Brown' }],
    coverage: { level: 'limited', totalBrackets: 2, importedBrackets: 1, matchCount: 0, scoredMatches: 0 }
  }] };
  const hydrated = applyDataSnapshot(empty(), first);
  assert.equal(hydrated.matches.length, 0);
  assert.equal(hydrated.markets.length, 0);
  assert.equal(searchCompetitions(hydrated.events, [], [], 'Alex Solo').length, 1);
  const next = structuredClone(first);
  next.syncedAt = '2090-01-01T00:01:00Z';
  next.events[0].participants = [];
  next.events[0].brackets = [{ sourceId: 'b1', name: 'Adult Black' }, { sourceId: 'b2', name: 'Adult Brown', loaded: true, bouts: [] }];
  const updated = applyDataSnapshot(hydrated, next);
  assert.equal(updated.events[0].participants.length, 1);
  assert.equal(updated.events[0].brackets.filter(bracket => bracket.loaded).length, 2);
  assert.equal(updated.events[0].coverage.importedBrackets, 2);
});
