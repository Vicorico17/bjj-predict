import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const folder = await mkdtemp(path.join(os.tmpdir(), 'bjj-data-tests-'));
await build({ entryPoints: ['src/smoothcomp.ts', 'src/liquidity.ts', 'src/market.ts'], outdir: folder, bundle: true, platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
const { applyDataSnapshot } = await import(pathToFileURL(path.join(folder, 'smoothcomp.mjs')));
const { planLiquidity } = await import(pathToFileURL(path.join(folder, 'liquidity.mjs')));
const { costToBuyShares, quantitiesFromProbabilities, quoteBuy, isMatchTradable } = await import(pathToFileURL(path.join(folder, 'market.mjs')));
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
