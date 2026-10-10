import { load } from 'cheerio';
import { allowedSourceUrl, coverage, createSourceClient, eventStatus } from './source-http.mjs';

const ORIGIN = 'https://www.onefc.com';
const INDEX = `${ORIGIN}/events/`;

export function oneEventId(input) {
  const url = allowedSourceUrl(input);
  const slug = url.pathname.match(/^\/events\/([a-z0-9-]+)\/?$/)?.[1];
  if (url.hostname !== 'www.onefc.com' || !slug) throw new Error('Use a ONE Championship event URL.');
  return slug;
}

export function parseOneEventsIndex(html) {
  const $ = load(html);
  return $('#upcoming-events-section .simple-post-card.is-event').toArray().flatMap(node => {
    const card = $(node);
    const sourceUrl = card.find('a.title').attr('href');
    try { oneEventId(sourceUrl); } catch { return []; }
    const timestamp = Number(card.find('.datetime').attr('data-timestamp'));
    if (!Number.isFinite(timestamp) || timestamp <= 0) return [];
    const startsAt = new Date(timestamp * 1000).toISOString();
    if (!Number.isFinite(Date.parse(startsAt)) || Date.parse(startsAt) < Date.now() - 24 * 60 * 60 * 1000) return [];
    return [{ sourceUrl, startsAt, name: card.find('a.title').text().replace(/\s+/g, ' ').trim(),
      city: card.find('.location').text().replace(/\s+/g, ' ').trim(),
      coverImage: card.find('.image img').attr('src') || '' }];
  });
}

export function parseOneEvent(html, sourceUrl, listed = {}) {
  const slug = oneEventId(sourceUrl);
  const $ = load(html);
  const schema = $('script[type="application/ld+json"]').toArray().map(node => {
    try { return JSON.parse($(node).html()); } catch { return null; }
  }).find(value => value?.['@type'] === 'Event');
  const startsAt = listed.startsAt || schema?.startDate || '';
  const endsAt = schema?.endDate || '';
  const matches = $('.event-matchup').toArray().flatMap(node => {
    const card = $(node);
    const division = card.find('.title').first().text().replace(/\s+/g, ' ').trim();
    if (!/submission grappling|jiu.?jitsu/i.test(division)) return [];
    const athletes = card.find('tr.vs td a').toArray().map(link => ({
      name: $(link).text().replace(/\s+/g, ' ').trim(), sourceUrl: $(link).attr('href') || ''
    }));
    if (athletes.length !== 2 || athletes.some(athlete => !athlete.name)) return [];
    const [a, b] = athletes;
    const country = card.find('.stats tr').eq(1).find('td').toArray().map(cell => $(cell).text().trim());
    const photos = [card.find('.face1 img').attr('src'), card.find('.face2 img').attr('src')];
    const sourceMatchId = `${slug}-${a.sourceUrl.split('/').filter(Boolean).at(-1)}-${b.sourceUrl.split('/').filter(Boolean).at(-1)}`;
    return [{ sourceMatchId, division, round: 'Announced fight card', mat: 'Mat TBA',
      // The organizer publishes the card start, not an individual bout time.
      scheduledAt: startsAt, status: 'locked', sourceState: 'card-announced', sourceUrl,
      competitorA: { sourceId: a.sourceUrl, name: a.name, sourceUrl: a.sourceUrl,
        imageUrl: photos[0], country: country[0] || '', academy: 'Not listed' },
      competitorB: { sourceId: b.sourceUrl, name: b.name, sourceUrl: b.sourceUrl,
        imageUrl: photos[1], country: country[1] || '', academy: 'Not listed' } }];
  });
  return { id: `e-one-${slug}`, source: 'one', sourceEventId: slug,
    name: listed.name || schema?.name || `ONE Championship ${slug}`, organizer: 'ONE Championship',
    city: listed.city || schema?.location?.name || '', coverImage: listed.coverImage || schema?.image?.[0] || '',
    startsAt, endsAt, sourceUrl, status: eventStatus(startsAt, endsAt), matches,
    coverage: coverage(matches, { level: matches.length ? 'published' : 'discovered', liveScores: false }),
    warnings: matches.length ? ['Bouts are confirmed on the official card; exact bout times are not published.'] : [] };
}

export async function discoverOne(options = {}) {
  const client = createSourceClient(options);
  const listings = parseOneEventsIndex(await client.text(INDEX));
  const results = await Promise.allSettled(listings.map(async listed => parseOneEvent(await client.text(listed.sourceUrl), listed.sourceUrl, listed)));
  if (listings.length && results.every(result => result.status === 'rejected')) throw new Error('ONE Championship event cards unavailable.');
  return results.flatMap(result => result.status === 'fulfilled' && result.value.matches.length ?
    [{ ...result.value, matches: [], coverage: coverage([], { level: 'discovered' }) }] : []);
}

export async function fetchOneEvent(input, options = {}) {
  const sourceUrl = allowedSourceUrl(input).href;
  oneEventId(sourceUrl);
  return parseOneEvent(await createSourceClient(options).text(sourceUrl), sourceUrl);
}
