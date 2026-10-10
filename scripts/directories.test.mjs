import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { discoverDirectory, parseDirectoryEvent, parseChampionshipCalendar, directorySource } from './lib/directories.mjs';
import { discoverData, deduplicateDiscoveredEvents, importData } from './lib/data-sources.mjs';
const now = Date.parse('2026-10-10T12:00:00Z');
const fixture = name => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const card = (id, title) => `<article class="card"><h5><a href="/Events/Details/${id}">${title}</a></h5></article>`;
const eventPage = (name, status = 'EventScheduled') => `<script type="application/ld+json">${JSON.stringify({ '@type': 'SportsEvent', name, startDate: '2099-10-11T19:00:00+03:00', eventStatus: `https://schema.org/${status}`, location: { name: 'Test arena' } })}</script>`;

test('Independent discovery follows pages and discovers unseen shows without the reviewed catalog', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    if (url.includes('/Details/')) return new Response(eventPage(url.endsWith('9001') ? 'New Grappling Invitational' : 'BJJ Grand Prix 99'));
    if (url.includes('page=2')) return new Response(card('9002', 'BJJ Grand Prix 99'));
    return new Response(card('9001', 'New Grappling Invitational') + card('7', 'Boxing night') + '<nav class="pagination"><a href="?page=2&category=Sports">Следваща</a></nav>');
  };
  const result = await discoverDirectory('gosofia', { fetchImpl, pauseMs: 0, now });
  assert.deepEqual(result.events.map(event => event.name), ['New Grappling Invitational', 'BJJ Grand Prix 99']);
  assert.equal(result.warnings.length, 0);
  assert.equal(calls.length, 4);
  assert(!calls.some(url => url.endsWith('/7')));
  assert(result.events.every(event => event.matches.length === 0));
  const imported = await importData(result.events[1].sourceUrl, { fetchImpl, pauseMs: 0 });
  assert.equal(imported.events[0].name, 'BJJ Grand Prix 99');
  assert.equal(imported.events[0].matches.length, 0);
});

test('Sofia published metadata decodes escaped timezone and retains source provenance', async () => {
  const event = parseDirectoryEvent(await fixture('directory-sofia-event.html'), 'https://www.go-sofia.com/Events/Details/2387', now);
  assert.equal(event.name, 'Grappling Grand Prix 88');
  assert.equal(Date.parse(event.startsAt), Date.parse('2026-10-11T16:00:00Z'));
  assert.equal(event.city, 'Sofia');
  assert.equal(event.country, 'Bulgaria');
  assert.match(event.officialUrl, /kupibileti.bg/);
});

test('Directory events need valid dates and grappling evidence, and cancelled events are not upcoming', () => {
  const url = 'https://www.go-sofia.com/Events/Details/90';
  assert.throws(() => parseDirectoryEvent(eventPage('Boxing championship'), url, now), /not a grappling event/);
  assert.equal(parseDirectoryEvent(eventPage('BJJ Open', 'EventCancelled'), url, now).status, 'complete');
  assert.equal(directorySource('https://www.go-sofia.com.evil.test/Events/Details/90'), null);
  assert.equal(directorySource('https://user@www.go-sofia.com/Events/Details/90'), null);
  assert.equal(directorySource('https://www.go-sofia.com/admin'), null);
});

test('Later-page failures and crawl limits report partial discovery without dropping earlier events', async () => {
  const fetchImpl = async url => {
    if (url.includes('/Details/')) return new Response(eventPage('New BJJ Open'));
    if (url.includes('page=2')) return new Response('unavailable', { status: 503 });
    return new Response(card('9001', 'New BJJ Open') + '<nav class="pagination"><a href="?page=2">Next</a></nav>');
  };
  const result = await discoverData({ selectedProviders: ['gosofia'], fetchImpl, pauseMs: 0, now });
  assert.equal(result.events.length, 1);
  assert.equal(result.providers[0].status, 'partial');
  assert.match(result.providers[0].warnings.join(' '), /503/);
  const limited = await discoverDirectory('gosofia', { fetchImpl, pauseMs: 0, now, maxPages: 1 });
  assert.equal(limited.events.length, 1);
  assert.match(limited.warnings.join(' '), /Page budget/);
});

test('Worldwide calendar extracts dates and locations from published structured data', async () => {
  const events = parseChampionshipCalendar(await fixture('directory-calendar.html'), now);
  assert.equal(events.length, 1);
  assert.equal(events[0].city, 'Scarborough');
  assert.equal(events[0].country, 'Canada');
  assert.match(events[0].officialUrl, /^https:\/\/ibjjf.com\//);
  assert.throws(() => parseChampionshipCalendar('<html>maintenance</html>', now));
});

test('Discovery keeps more than 100 events and reports any explicitly requested truncation', async () => {
  const events = Array.from({ length: 135 }, (_, index) => ({ id: index + 1, title: `BJJ Open ${index}`, categoryGroups: ['1'], startdate: '2099-01-01', enddate: '2099-01-01', url: `https://smoothcomp.com/en/event/${index + 1}` }));
  const fetchImpl = async () => new Response(`<script>var events = ${JSON.stringify(events)}</script>`);
  const all = await discoverData({ selectedProviders: ['smoothcomp'], fetchImpl, pauseMs: 0 });
  assert.equal(all.events.length, 135);
  const limited = await discoverData({ selectedProviders: ['smoothcomp'], fetchImpl, pauseMs: 0, eventLimit: 100 });
  assert.equal(limited.events.length, 100);
  assert.equal(limited.providers[0].status, 'partial');
  assert.match(limited.providers[0].warnings[0], /100 of 135/);
});

test('Mirrored calendar IDs merge without conflating distinct events with the same name', () => {
  const rows = [{ id: 'e-smoothcomp-1', name: 'BJJ Open', city: 'Sofia' }, { id: 'e-smoothcomp-1', name: 'BJJ Open', city: '', country: 'Bulgaria' }, { id: 'e-smoothcomp-2', name: 'BJJ Open', city: 'London' }];
  const result = deduplicateDiscoveredEvents(rows);
  assert.equal(result.length, 2);
  assert.equal(result[0].city, 'Sofia');
  assert.equal(result[0].country, 'Bulgaria');
});
