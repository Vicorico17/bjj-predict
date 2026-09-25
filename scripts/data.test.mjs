import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSmoothcompWorker } from './smoothcomp-sync.mjs';
import { parseIbjjfBracket, parseIbjjfEvents, fetchIbjjfEvent } from './lib/ibjjf.mjs';
import { parseArenaBouts, arenaId, discoverArena } from './lib/floarena.mjs';
import { allowedSourceUrl, createSourceClient, finiteScore } from './lib/source-http.mjs';
import { discoverData, importData, mergeDataSnapshots, providerFor } from './lib/data-sources.mjs';
import importHandler from '../api/data/import.mjs';

const fixture = async name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const ajp = JSON.parse(await fixture('ajp-bracket.json'));
const ibjjf = await fixture('ibjjf-bracket.html');
const arena = JSON.parse(await fixture('floarena-results.json'));
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('AJP: real numeric scores and explicit winners; missing scores stay missing', () => {
  const worker = createSmoothcompWorker();
  const event = { startsAt: '2026-09-12T00:00:00Z', status: 'live' };
  const match = worker.normalizeMatch(ajp.raw.matches[0], ajp.live, null, ajp.bracket, event, 'https://ajptour.com/en/event/1552');
  assert.equal(match.score.left.points, 4);
  assert.equal(match.score.right.points, 0);
  assert.equal(match.winnerSide, 'left');
  assert.match(match.sourceUrl, /^https:\/\/ajptour.com\//);
  assert.equal(finiteScore(null), null); assert.equal(finiteScore(''), null); assert.equal(finiteScore(false), null);
  assert.equal(worker.winnerSideFor({ isWinner: true }, { isWinner: true }, null), null);
  assert.equal(worker.statusForMatch('finished', null), 'locked');
});

test('AJP requests stay on AJP; concurrent Smoothcomp workers do not share options', async () => {
  const run = async (host, id) => {
    const calls = [];
    const fetchImpl = async url => {
      calls.push(url);
      if (url.endsWith('/brackets.json')) return json({ brackets: [ajp.bracket] });
      if (url.includes('/bracket.json/')) return json({ matches: [ajp.raw.matches[0]] });
      if (url.includes('/getBracketMatchData/')) return json(ajp.live);
      return new Response(`<script type="application/ld+json">${JSON.stringify({ '@type': 'SportsEvent', name: host, startDate: '2026-09-12T09:00:00Z', endDate: '2026-09-12T22:00:00Z' })}</script>`);
    };
    const snapshot = await importData(`https://${host}/en/event/${id}`, { fetchImpl, pauseMs: 0 });
    assert(calls.every(url => new URL(url).hostname === host));
    assert.equal(snapshot.events[0].sourceEventId, String(id));
    return snapshot;
  };
  const [a, b] = await Promise.all([run('ajptour.com', 1552), run('smoothcomp.com', 123)]);
  assert.equal(a.events[0].id, 'e-ajp-1552'); assert.equal(b.events[0].id, 'e-smoothcomp-123');
});

test('IBJJF real bracket excludes byes and retains scoped IDs without fabricated scores', () => {
  const matches = parseIbjjfBracket(ibjjf, '3367', '2960592');
  assert.equal(matches.length, 17);
  assert.equal(new Set(matches.map(match => match.sourceMatchId)).size, matches.length);
  assert(matches.every(match => match.competitorA.name && match.competitorB.name && !match.score));
  assert(matches.some(match => match.winnerSide === 'right'));
  assert(matches.filter(match => !match.winnerSide).every(match => match.status === 'locked'));
  assert(matches.every(match => match.scheduledAt === ''));
  assert.throws(() => parseIbjjfBracket('<html>Unavailable</html>', '1', '2'), /layout/);
});

test('IBJJF calendar and category import use published links with explicit coverage', async () => {
  const calendar = '<select id="tournament_id"><option value="3367">South American No-Gi</option></select>';
  assert.equal(parseIbjjfEvents(calendar)[0].name, 'South American No-Gi');
  const categories = '<div class="public-categories"><a href="/tournaments/3367/categories/2960592">BLUE Middle</a><a href="/tournaments/999/categories/888">Other event</a></div>';
  const event = await fetchIbjjfEvent('https://www.bjjcompsystem.com/tournaments/3367/categories', { pauseMs: 0,
    fetchImpl: async url => new Response(url.endsWith('/categories') ? categories : ibjjf) });
  assert.equal(event.coverage.importedBrackets, 1);
  assert.equal(event.coverage.totalBrackets, 1);
  assert.equal(event.coverage.liveScores, false);
});

test('FloArena uses explicit GUID winner, preserves score text without guessing orientation', () => {
  const id = '1f471e33-0648-4fbb-9c08-f4a25af3f4f3';
  const matches = parseArenaBouts(arena, id);
  assert.equal(matches.length, 20);
  assert.equal(matches[0].finish, '21-0 20:00');
  assert.equal(matches[0].winnerSide, 'left');
  assert.equal(matches[0].score, undefined);
  assert.equal(arenaId(`https://arena.flograppling.com/event/${id}?page=brackets`), id);
  assert.throws(() => arenaId('https://arena.flograppling.com/event/11302663'));
});

test('Discovery survives one provider failing and does not create matches', async () => {
  const fetchImpl = async url => {
    if (url.includes('ajptour.com')) throw new Error('Source unavailable');
    return json({ status: 'SUCCESS', response: [{ guid: '52703b65-bade-46e2-9ce2-399dd32d93e4', name: 'ADCC Worlds', siteId: 8, status: 'live', startDate: '2026-09-12T09:00:00Z' }] });
  };
  const data = await discoverData({ selectedProviders: ['ajp', 'floarena'], fetchImpl, pauseMs: 0 });
  assert.equal(data.providers[0].status, 'error');
  assert.equal(data.events.length, 1);
  assert.deepEqual(data.events[0].matches, []);
});

test('Snapshot merge retains older matches and each event observation time', () => {
  const old = { events: [{ id: 'e-a', observedAt: '2026-01-01', matches: [{ sourceMatchId: 'one' }] }, { id: 'e-b', observedAt: '2025-01-01', matches: [] }] };
  const merged = mergeDataSnapshots(old, { syncedAt: '2026-09-12', events: [{ id: 'e-a', matches: [{ sourceMatchId: 'two' }] }] });
  assert.equal(merged.events[0].matches.length, 2);
  assert.equal(merged.events[0].observedAt, '2026-09-12');
  assert.equal(merged.events[1].observedAt, '2025-01-01');
});

test('Source client rejects arbitrary hosts and redirects without requesting them', async () => {
  assert.equal(providerFor('https://ajptour.com/en/event/1552'), 'ajp');
  for (const url of ['https://smoothcomp.com.evil.test/en/event/1', 'http://smoothcomp.com/en/event/1', 'https://user:secret@smoothcomp.com/en/event/1', 'https://127.0.0.1/']) assert.throws(() => allowedSourceUrl(url));
  let calls = 0;
  const client = createSourceClient({ pauseMs: 0, fetchImpl: async () => { calls++; return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }); } });
  await assert.rejects(client.text('https://smoothcomp.com/en/event/1'), /Unsupported/);
  assert.equal(calls, 1);
});

test('Import API rejects malformed payloads and unbounded limits', async () => {
  for (const body of ['bad json', { eventUrl: 'https://example.com/1' }, { eventUrl: 'https://ajptour.com/en/event/1552', bracketLimit: 99999 }]) {
    const res = { status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await importHandler({ method: 'POST', body }, res);
    assert.equal(res.code, 400);
  }
});
