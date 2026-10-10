import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSmoothcompWorker } from './smoothcomp-sync.mjs';
import { parseIbjjfBracket, parseIbjjfEvents, fetchIbjjfEvent } from './lib/ibjjf.mjs';
import { parseArenaBouts, arenaId, discoverArena } from './lib/floarena.mjs';
import { parseOneEvent, parseOneEventsIndex, discoverOne } from './lib/one.mjs';
import { parseUfcBjjCalendar, parseReportedUfcBjjCard, discoverUfcBjj } from './lib/ufcbjj.mjs';
import { bracketListUrl, probeBrackets } from './lib/bracket-probe.mjs';
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

test('Blocked event metadata does not turn an empty published bracket list into an import failure', async () => {
  const url = 'https://smoothcomp.com/en/event/34849';
  const seed = { name: 'Upcoming grappling event', startsAt: '2026-10-03T00:00:00Z', status: 'upcoming', city: 'Bucharest' };
  const empty = await importData(url, { seed, pauseMs: 0, fetchImpl: async requestUrl =>
    requestUrl.endsWith('/brackets.json') ? json({ brackets: [] }) : new Response('', { status: 403 }) });
  assert.equal(empty.events[0].name, seed.name);
  assert.equal(empty.events[0].matches.length, 0);
  assert.equal(empty.events[0].coverage.totalBrackets, 0);
  await assert.rejects(importData(url, { seed, pauseMs: 0, fetchImpl: async () => new Response('', { status: 403 }) }),
    /Published brackets unavailable:.*HTTP 403/);
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

test('ONE Championship imports only officially announced grappling pairings', async () => {
  const sourceUrl = 'https://www.onefc.com/events/onefightnight48/';
  const index = `<div id="upcoming-events-section"><div class="simple-post-card is-event"><a class="title" href="${sourceUrl}">ONE Fight Night 48</a><div class="datetime" data-timestamp="1893456000"></div></div></div>`;
  const card = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Event', name: 'ONE Fight Night 48', startDate: '2030-01-01T01:00:00Z', endDate: '2030-01-01T23:00:00Z' })}</script>
    <div class="event-matchup"><div class="title">Heavyweight MMA</div><div class="stats"><table><tr class="vs"><td><a>Wrong A</a></td><td><a>Wrong B</a></td></tr></table></div></div>
    <div class="event-matchup"><div class="title">Featherweight Submission Grappling</div><a class="face1"><img src="https://cdn.onefc.com/a.jpg"></a><a class="face2"><img src="https://cdn.onefc.com/b.jpg"></a><div class="stats"><table><tr class="vs"><td><a href="https://www.onefc.com/athletes/shoya-ishiguro/">Shoya Ishiguro</a></td><th>VS</th><td><a href="https://www.onefc.com/athletes/ruan-alvarenga/">Ruan Alvarenga</a></td></tr></table></div></div>`;
  assert.equal(parseOneEventsIndex(index).length, 1);
  const parsed = parseOneEvent(card, sourceUrl);
  assert.equal(parsed.matches.length, 1);
  assert.equal(parsed.matches[0].competitorA.name, 'Shoya Ishiguro');
  assert.equal(parsed.matches[0].competitorB.name, 'Ruan Alvarenga');
  assert.equal(parsed.matches[0].sourceState, 'card-announced');
  assert.equal(parsed.matches[0].score, undefined);
  const fetchImpl = async url => new Response(url.endsWith('/events/') ? index : card);
  const discovered = await discoverOne({ fetchImpl, pauseMs: 0 });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].matches.length, 0);
  const imported = await importData(sourceUrl, { fetchImpl, pauseMs: 0 });
  assert.equal(imported.events[0].matches.length, 1);
});

test('UFC BJJ combines the official main event with distinct reported card bouts', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2030-09-28T00:00:00Z') });
  const official = `<div class="hero--ufc_experience"><h2 class="hero__title">UFC BJJ 12: Moura x Fornarino</h2>
    <div class="hero__body"><h3>Quinta-feira, 8 de outubro, às 21 horas (horário de Brasília)</h3></div>
    <img alt="Cassia Moura e Adele Fornarino lideram o UFC BJJ 12, em 8 de outubro de 2030." src="https://ufc.com/card.jpg"></div>`;
  const reported = `<article><p><strong>UFC BJJ 12</strong><br>8 de outubro, em Las Vegas<br><strong>CARD DO EVENTO:</strong><br>
    Peso-mosca: Cassia Moura x Adele Fornarino<br>Peso-palha: Danielle Kelly x Thaynara Victória<br>
    Peso-leve: John Chandler x Raphael Gomez<br>Peso-leve: Max Livingston x Landon Elmore</p></article>`;
  const events = parseUfcBjjCalendar(official, { now: Date.parse('2030-09-28T00:00:00Z') });
  assert.equal(events.length, 1);
  assert.equal(events[0].mainPair[0], 'Cassia Moura');
  assert.equal(parseReportedUfcBjjCard(reported, '12').length, 4);
  const fetchImpl = async url => new Response(url.includes('ge.globo.com') ? reported : official);
  const discovered = await discoverUfcBjj({ fetchImpl, pauseMs: 0 });
  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].matches.length, 0);
  const imported = await importData(discovered[0].sourceUrl, { fetchImpl, pauseMs: 0 });
  assert.equal(imported.events[0].matches.length, 4);
  assert(imported.events[0].matches.every(match => match.status === 'locked' && match.sourceState === 'card-announced'));
  assert.equal(new Set(imported.events[0].matches.map(match => match.sourceMatchId)).size, 4);
});

test('Bracket probe finds published draws and rejects unrelated URLs', async () => {
  const ready = 'https://agf.smoothcomp.com/en/event/123';
  const empty = 'https://smoothcomp.com/en/event/456';
  const blocked = 'https://ajptour.com/en/event/789';
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.includes('/123/')) return json({ brackets: [{ bracket_id: 1, registrations_count: 2 }, { bracket_id: 2, registrations_count: 1 }] });
    if (url.includes('/456/')) return json({ brackets: [] });
    return new Response('', { status: 403 });
  };
  const result = await probeBrackets([ready, empty, blocked, ready], { fetchImpl, concurrency: 3 });
  assert.equal(result.checked, 3);
  assert.deepEqual(result.available, [{ sourceUrl: ready, status: 'available', brackets: 1 }]);
  assert.equal(result.empty, 1);
  assert.equal(result.unavailable, 1);
  assert.equal(calls.length, 3);
  assert.throws(() => bracketListUrl('https://smoothcomp.com/admin'));
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

test('Reviewed bouts supplement a freshly fetched independent event listing', async () => {
  const url = 'https://www.go-sofia.com/Events/Details/2387';
  assert.equal(providerFor(url), 'gosofia');
  assert.equal(providerFor('https://www.go-sofia.com/Events/Details/9999'), 'gosofia');
  const imported = await importData(url, { fetchImpl: async () => new Response(await fixture('directory-sofia-event.html')), pauseMs: 0 });
  assert.equal(imported.events[0].matches.length, 3);
  assert.equal(imported.events[0].city, 'Sofia');
  assert(imported.events[0].matches.every(match => match.status === 'locked' && match.sourceUrl.includes('sportal.bg')));
});
