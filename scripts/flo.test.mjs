import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resultCards, floEventId, parseFloPage, fetchFloEvent } from './lib/flo.mjs';

const cards = JSON.parse(await readFile(new URL('./fixtures/flo-adcc-results.json', import.meta.url)));
test('real Flo scores, unknown submission scores and unique stable match IDs', () => {
  const results = resultCards(cards, '11302663');
  assert.equal(results[0].score.left.points, 21);
  assert.equal(results[0].score.right.points, 0);
  assert.equal(results[1].score.left.points, 2);
  assert.equal(results[2].score.left.points, null);
  assert.equal(new Set(results.map(match => match.sourceMatchId)).size, cards.length);
  const reversed = { ...cards[0], competitor1: cards[0].competitor2, competitor2: cards[0].competitor1 };
  assert.equal(resultCards([reversed], '11302663')[0].sourceMatchId, results[0].sourceMatchId);
  assert.equal(resultCards([reversed], '11302663')[0].winnerSide, 'right');
});
test('ambiguous results and unsupported pages fail without guessing winners', () => {
  const card = structuredClone(cards[0]);
  card.competitor2.isWinner = true;
  assert.throws(() => resultCards([card], '11302663'), /unambiguous/);
  card.competitor1.isWinner = false; card.competitor2.isWinner = false;
  assert.throws(() => resultCards([card], '11302663'), /unambiguous/);
  assert.throws(() => parseFloPage('<html>unavailable</html>'), /payload missing/);
});
test('event URL validation rejects arbitrary hosts', () => {
  assert.equal(floEventId('https://www.flograppling.com/events/11302663-adcc/results'), '11302663');
  assert.throws(() => floEventId('https://example.com/events/123'));
  assert.throws(() => floEventId('http://127.0.0.1/events/123'));
});
test('pagination is followed, duplicates merged and foreign links ignored', async () => {
  const schema = { name: 'ADCC fixture', startDate: '2024-08-17T17:00:00Z', endDate: '2024-08-19T07:00:00Z' };
  const first = { seo: { schema: { innerText: JSON.stringify(schema) } }, items: [cards[0],
    { type: 'link', style: 'paginate', url: '/api/experiences/web/event-hub/11302663/results/list/partial?itemOffset=40' },
    { type: 'link', title: 'View All', url: 'https://example.com/private' }] };
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    return new Response(JSON.stringify(calls.length === 1 ? first : { items: [cards[0], cards[1]] }), { headers: { 'content-type': 'application/json' } });
  };
  const event = await fetchFloEvent('11302663', { fetchImpl });
  assert.equal(event.matches.length, 2);
  assert.equal(calls.length, 2);
  assert.match(calls[1], /^https:\/\/api.flograppling.com\//);
  await assert.rejects(fetchFloEvent('11302663', { maxPages: 1, fetchImpl: async () => new Response(JSON.stringify(first), { headers: { 'content-type': 'application/json' } }) }), /page limit/);
});
