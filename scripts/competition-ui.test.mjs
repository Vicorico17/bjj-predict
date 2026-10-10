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
  assert.match(html, /Alice<span class="winner-tick"/);
  assert.doesNotMatch(html, /Bea<span class="winner-tick"/);
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
  assert.match(html, /Alice<span class="winner-tick"/);
  const bye = { ...bout, seats: [bout.seats[0], { label: 'Bye', participant: null, winner: false }] };
  assert.match(render({ event: { ...event, brackets: [{ ...event.brackets[0], bouts: [bye] }] } }), /No games with both athletes loaded yet/);
});
