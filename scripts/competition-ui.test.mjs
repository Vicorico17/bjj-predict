import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const output = await build({ entryPoints: ['src/CompetitionData.tsx'], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', jsx: 'automatic' });
const mod = { exports: {} };
new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const { CompetitionData, gameStatus } = mod.exports;
const player = name => ({ sourceId: name, name, academy: 'Club', country: 'BG', division: 'Adult' });
const bout = { sourceId: 'bout', number: '1', round: 'Final', roundOrder: 1, state: 'settled', mat: 'Mat 1', startsAt: '', finish: '', clock: '', seats: [
  { label: 'Alice', participant: player('Alice'), winner: true },
  { label: 'Bea', participant: player('Bea'), winner: false },
] };
const event = { id: 'event', source: 'smoothcomp', sourceUrl: 'https://smoothcomp.com/en/event/1', brackets: [
  { sourceId: 'division', name: 'Adult', registrations: 2, mat: '', startsAt: '', sourceUrl: 'https://smoothcomp.com/en/event/1', loaded: true, bouts: [bout] }
] };
function render(extra = {}) {
  return renderToStaticMarkup(React.createElement(CompetitionData, { event, matches: [], competitors: [], busy: false, notice: '', onLoad: async () => {}, ...extra }));
}
test('games are visible by default and only the confirmed winner receives a tick', () => {
  const html = render();
  assert.match(html, /aria-selected="true"[^>]*>.*?Games/);
  assert.match(html, /Alice<\/button><span class="winner-tick"/);
  assert.doesNotMatch(html, /Bea<\/button><span class="winner-tick"/);
  assert.equal((html.match(/aria-label="Winner"/g) || []).length, 1);
});
test('a high score without a reported winner does not receive a tick', () => {
  const pending = { ...bout, state: 'pending', seats: bout.seats.map(seat => ({ ...seat, winner: false })), score: { left: { points: 10 }, right: { points: 0 } } };
  assert.doesNotMatch(render({ event: { ...event, brackets: [{ ...event.brackets[0], bouts: [pending] }] } }), /aria-label="Winner"/);
  assert.equal(gameStatus({ ...pending, startsAt: '2020-01-01T12:00:00Z' }), 'unreported');
});
test('partial catalogs retain saved matchups and byes stay in brackets', () => {
  const html = render({
    event: { ...event, brackets: [{ ...event.brackets[0], loaded: false, bouts: [] }] },
    competitors: [{ ...player('Alice'), id: 'a' }, { ...player('Bea'), id: 'b' }],
    matches: [{ id: 'saved', sourceBracketId: 'division', division: 'Adult', competitorAId: 'a', competitorBId: 'b', winnerId: 'a', status: 'settled', round: 'Final', scheduledAt: '' }],
  });
  assert.match(html, /Alice<\/button><span class="winner-tick"/);
  const bye = { ...bout, seats: [bout.seats[0], { label: 'Bye', participant: null, winner: false }] };
  assert.match(render({ event: { ...event, brackets: [{ ...event.brackets[0], bouts: [bye] }] } }), /No games with both athletes loaded yet/);
});

test('reviewed tournament shows all rounds and portraits without platform-only actions', async () => {
  const { readFile } = await import('node:fs/promises');
  const featured = JSON.parse(await readFile('src/generated/featured-events.json', 'utf8')).events[0];
  const html = render({ event: featured });
  assert.equal((html.match(/class="competition-game"/g) || []).length, 11);
  assert.equal((html.match(/alt="[^"]+ portrait"/g) || []).length, 16);
  assert.match(html, /Winner of QF1/);
  assert.match(html, /Winner of SF2/);
  assert.match(html, /Georgi Angelov/);
  assert.doesNotMatch(html, /Load all divisions|Refresh all divisions|View on Smoothcomp/);
  assert.doesNotMatch(html, /aria-label="Winner"/);
});

const profileOutput = await build({ entryPoints: ['src/CompetitorProfile.tsx'], bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', jsx: 'automatic' });
const profileMod = { exports: {} };
new Function('require', 'module', 'exports', profileOutput.outputFiles[0].text)(createRequire(import.meta.url), profileMod, profileMod.exports);
const { profileHistory, ProfileDialog, CountryFlag, sameAthlete } = profileMod.exports;

test('Sebastian profile includes his published bracket game and Romanian flag from every entry point', async () => {
  const { readFile } = await import('node:fs/promises');
  const featured = JSON.parse(await readFile('src/generated/featured-events.json', 'utf8')).events[0];
  const athlete = featured.participants.find(player => player.name === 'Sebastian Curelaru');
  assert.ok(athlete);
  const history = profileHistory(athlete, [], [], [featured]);
  assert.equal(history.length, 1);
  assert.equal(history[0].opponent, 'Kalin Zhelezov');
  const html = renderToStaticMarkup(React.createElement(ProfileDialog, { athlete, competitors: [], matches: [], events: [featured], onClose() {} }));
  assert.match(html, /vs Kalin Zhelezov/);
  assert.match(html, /🇷🇴/);
  assert.match(renderToStaticMarkup(React.createElement(CountryFlag, { country: 'de' })), /🇩🇪/);
  assert.equal(sameAthlete(athlete, { ...athlete, id: 'c-curated-sebastian-curelaru' }), true);
});

test('profile combines bracket and saved games across events without duplicate results or byes', () => {
  const alice = { ...player('Alice'), id: 'a' }, bea = { ...player('Bea'), id: 'b' };
  const saved = { id: 'saved', eventId: 'event', sourceMatchId: 'bout', sourceBracketId: 'division', division: 'Adult', competitorAId: 'a', competitorBId: 'b', winnerId: 'a', status: 'settled', round: 'Final', scheduledAt: '' };
  const secondEvent = { ...event, id: 'other-event' };
  const rows = profileHistory(alice, [alice, bea], [saved], [event, secondEvent]);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.outcome === 'Win'));
  assert.equal(profileHistory(alice, [alice, bea], [{ ...saved, sourceState: 'withdrawn' }], [event]).length, 0);
  const bye = { ...bout, seats: [bout.seats[0], { participant: null, label: 'Bye', winner: false }] };
  assert.equal(profileHistory(alice, [], [], [{ ...event, brackets: [{ ...event.brackets[0], bouts: [bye] }] }]).length, 0);
});

test('profile identity does not merge different official athletes with matching names', () => {
  assert.equal(sameAthlete({ ...player('Alice'), sourceUrl: 'https://smoothcomp.com/en/profile/1' }, { ...player('Alice'), sourceUrl: 'https://smoothcomp.com/en/profile/2' }), false);
});
