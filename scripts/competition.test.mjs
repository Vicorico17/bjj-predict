import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publishedDraw, parsePublicParticipants } from './lib/smoothcomp-competition.mjs';
import { importData, mergeDataSnapshots } from './lib/data-sources.mjs';
const fixture = JSON.parse(await readFile('scripts/fixtures/ajp-bracket.json', 'utf8'));
const base = 'https://smoothcomp.com/en/event/123';
const roster = `<table><thead><tr><th>Bracket</th><th>Athlete</th><th>Birth</th><th>Academy & Affiliation</th></tr></thead><tbody><tr><td>Adult Black</td><td><a href="/en/profile/100">Alex Example</a></td><td>2000-01-01</td><td>Example Academy</td></tr></tbody></table>`;
const json = value => new Response(JSON.stringify(value));

test('Public draws preserve byes and unresolved slots without turning them into athletes', () => {
  const raw = [...fixture.raw.matches, { id: 9, round: 3, seats: [{ ...fixture.raw.matches[0].seats[0] }, { type: 'bye', name: 'Bye' }] },
    { id: 10, round: 4, seats: [{ name: 'Winner of match 9' }, { name: 'Winner from match 8' }] }];
  const draw = publishedDraw(fixture.bracket, raw, base);
  assert.equal(draw.bouts.length, raw.length);
  assert.equal(draw.bouts.at(-2).seats[1].label, 'Bye');
  assert.equal(draw.bouts.at(-2).seats[1].participant, null);
  assert(draw.bouts.at(-1).seats.every(seat => seat.participant === null));
  assert(draw.bouts[0].seats[0].participant.imageUrl.startsWith('https://'));
  assert.equal(draw.bouts[0].seats[0].winner, true);
});

test('Public athlete parser imports sporting fields only and rejects unavailable layouts', () => {
  const players = parsePublicParticipants(roster, base);
  assert.equal(players[0].name, 'Alex Example');
  assert.equal(players[0].academy, 'Example Academy');
  assert.equal(players[0].division, 'Adult Black');
  assert.equal(players[0].sourceUrl, 'https://smoothcomp.com/en/profile/100');
  assert(!JSON.stringify(players).includes('2000-01-01'));
  assert.throws(() => parsePublicParticipants('<html>Access denied</html>', base), /unavailable/);
});

const fetchFixture = (calls, failures = false) => async url => {
  calls.push(url);
  if (url.includes('/participants')) return url.includes('page=2') ? new Response('', { status: 503 }) : new Response(roster + '<a rel="next" href="?page=2">Next</a>');
  if (url.endsWith('/brackets.json')) return json({ brackets: Array.from({ length: 205 }, (_, index) => ({ ...fixture.bracket, bracket_id: index + 1, registrations_count: index ? 4 : 1 })) });
  if (url.includes('/bracket.json/')) {
    if (failures) return new Response('', { status: 503 });
    return json({ matches: [fixture.raw.matches[0], { id: 999, round: 2, seats: [{ name: 'Winner of match 1' }, { name: 'Bye', type: 'bye' }] }] });
  }
  if (url.includes('getBracketMatchData')) return json(fixture.live);
  return new Response('<script type="application/ld+json">{"@type":"SportsEvent","name":"Example event","startDate":"2099-01-01T10:00:00Z"}</script>');
};

test('Pagination imports divisions past 200, preserves single-athlete divisions, and retains partial roster pages', async () => {
  const calls = [];
  const snapshot = await importData(base, { fetchImpl: fetchFixture(calls), pauseMs: 0, bracketOffset: 200, bracketLimit: 2, liveScoreLimit: 1, participants: true });
  const event = snapshot.events[0];
  assert.equal(event.brackets.length, 205);
  assert.equal(event.brackets[0].registrations, 1);
  assert.equal(event.brackets.filter(bracket => bracket.loaded).length, 2);
  assert.equal(event.coverage.nextBracketOffset, 202);
  assert(calls.some(url => url.endsWith('/bracket.json/201')));
  assert(!calls.some(url => url.endsWith('/bracket.json/1')));
  assert(event.participants.some(player => player.name === 'Alex Example'));
  assert(event.warnings.some(warning => /partially loaded/.test(warning)));
  assert(event.matches.every(match => !/Winner|Bye/.test(match.competitorA.name)));
});

test('CLI snapshot merge retains loaded draw pages and athletes during later partial imports', async () => {
  const first = await importData(base, { fetchImpl: fetchFixture([]), pauseMs: 0, bracketLimit: 1, liveScoreLimit: 1 });
  const next = await importData(base, { fetchImpl: fetchFixture([]), pauseMs: 0, bracketOffset: 1, bracketLimit: 1, liveScoreLimit: 1 });
  const merged = mergeDataSnapshots(first, next).events[0];
  assert.equal(merged.brackets.filter(bracket => bracket.loaded).length, 2);
  assert.equal(merged.coverage.importedBrackets, 2);
  assert(merged.participants.length > 0);
});

test('A blocked bracket source still returns an available public roster', async () => {
  const result = await importData(base, { fetchImpl: fetchFixture([], true), pauseMs: 0, participants: true, bracketLimit: 1 });
  assert.equal(result.events[0].matches.length, 0);
  assert.equal(result.events[0].participants[0].name, 'Alex Example');
  assert(result.events[0].warnings.some(warning => /Bracket .* unavailable/.test(warning)));
});

test('fast browsing skips all upcoming score calls and fetches only requested divisions', async () => {
  const calls = [];
  const upcoming = { ...fixture.raw.matches[0], state: 'pending', seats: fixture.raw.matches[0].seats.map(seat => ({ ...seat, isWinner: false })) };
  const snapshot = await importData(base, { pauseMs: 0, liveOnly: true, bracketLimit: 3, fetchImpl: async url => {
    calls.push(url);
    if (url.endsWith('/brackets.json')) return json({ brackets: Array.from({length: 100}, (_, i) => ({ ...fixture.bracket, bracket_id: i + 1 })) });
    if (url.includes('/bracket.json/')) return json({ matches: Array.from({length: 30}, (_, i) => ({ ...upcoming, id: Number(url.split('/').at(-1)) * 100 + i })) });
    if (url.includes('getBracketMatch') || url.includes('/participants')) throw new Error('Unexpected expensive request');
    return new Response('<script type="application/ld+json">{"@type":"SportsEvent","name":"Fast event","startDate":"2099-01-01"}</script>');
  }});
  assert.equal(snapshot.events[0].matches.length, 90);
  assert.equal(calls.length, 5); // metadata + catalog + three draws, previously up to 95 requests
  assert.equal(snapshot.events[0].coverage.nextBracketOffset, 3);
  assert.equal(snapshot.events[0].coverage.liveScores, false);
});

test('active scoreboards are prioritized over finished bouts, with three requests at most in flight', async () => {
  let inFlight = 0, peak = 0;
  const requested = [];
  const matches = Array.from({length: 10}, (_, i) => ({ ...fixture.raw.matches[0], id: i + 1, state: i < 6 ? 'finished' : 'started', seats: fixture.raw.matches[0].seats.map(seat => ({ ...seat, isWinner: false })) }));
  const snapshot = await importData(base, { pauseMs: 0, liveOnly: true, bracketLimit: 1, liveScoreLimit: 4, fetchImpl: async url => {
    if (url.endsWith('/brackets.json')) return json({ brackets: [fixture.bracket] });
    if (url.includes('/bracket.json/')) return json({ matches });
    if (url.includes('getBracketMatchData')) {
      requested.push(Number(url.split('/').at(-1))); peak = Math.max(peak, ++inFlight);
      await new Promise(resolve => setTimeout(resolve, 5)); inFlight--;
      return json({ ...fixture.live, matchInfo: { ...fixture.live.matchInfo, state: 'started', winner: null } });
    }
    return new Response('<html></html>');
  }});
  assert.deepEqual(requested, [7, 8, 9, 10]);
  assert(peak <= 3 && peak > 1);
  assert.equal(snapshot.events[0].matches.find(match => match.sourceMatchId === '7').score.left.points, 4);
});

test('Smoothcomp source cache deduplicates concurrent calls and does not cache failures', async () => {
  const { cachedSmoothcompText } = await import('./lib/smoothcomp-cache.mjs');
  let calls = 0;
  const url = `${base}/cache-test`;
  const load = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return 'verified'; };
  assert.deepEqual(await Promise.all([cachedSmoothcompText(url, load), cachedSmoothcompText(url, load)]), ['verified', 'verified']);
  assert.equal(await cachedSmoothcompText(url, load), 'verified');
  assert.equal(calls, 1);
  await assert.rejects(cachedSmoothcompText(`${url}/failure`, async () => { throw new Error('Unavailable'); }));
  assert.equal(await cachedSmoothcompText(`${url}/failure`, load), 'verified');
  assert.equal(calls, 2);
});
