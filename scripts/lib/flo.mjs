import { createHash } from 'node:crypto';
import { allowedSourceUrl, createSourceClient } from './source-http.mjs';

export function* objects(value) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) yield value;
  for (const child of Object.values(value)) yield* objects(child);
}

export function parseFloPage(html) {
  const script = html.match(/<script\b[^>]*\bid="flo-app-state"[^>]*>([\s\S]*?)<\/script>/i);
  if (!script) throw new Error('Flo results payload missing; page layout changed or access unavailable.');
  const state = JSON.parse(script[1].replace(/&([qalgs]);/g, (_, key) => ({ q: '"', a: '&', l: '<', g: '>', s: "'" })[key]));
  const entry = Object.entries(state).find(([key]) => key.includes('/event-hub/') && key.includes('/results'));
  if (!entry?.[1]?.body) throw new Error('Flo event results not found.');
  return entry[1].body;
}

export function floEventId(input) {
  if (/^\d+$/.test(input)) return input;
  const url = allowedSourceUrl(input);
  if (!['www.flograppling.com', 'flograppling.com'].includes(url.hostname) || url.protocol !== 'https:') throw new Error('Use a public https://www.flograppling.com/events/... URL.');
  const id = url.pathname.match(/^\/events\/(\d+)(?:[-/]|$)/)?.[1];
  if (!id) throw new Error('Flo event ID missing.');
  return id;
}

export function resultCards(body, eventId) {
  const matches = [];
  for (const card of objects(body)) {
    if (card.type !== 'card:grappling-result') continue;
    const a = card.competitor1, b = card.competitor2;
    if (!a?.name || !b?.name || !a.id || !b.id) throw new Error('Incomplete Flo competitor record.');
    if ((a.isWinner === true) === (b.isWinner === true)) throw new Error('Flo result has no unambiguous winner; refusing settlement.');
    const winner = a.isWinner === true ? a : b;
    const [round, ...division] = (card.footer1 || '').split(',').map(value => value.trim());
    // Flo repeats the event ID on every card. Use event, division, round and
    // sorted participant IDs; never use the non-unique card ID or score.
    const identity = [eventId, card.footer1, ...[a.id, b.id].sort()].join('|');
    const sourceMatchId = `${eventId}-${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
    const competitor = value => ({ sourceId: value.id, name: value.name,
      sourceUrl: value.nameAction?.url ? new URL(value.nameAction.url, 'https://www.flograppling.com').href : undefined,
      imageUrl: photoUrl(value),
      record: 'Flo result history', country: '—' });
    // A submission can carry placeholder points=0; only expose numbers when
    // Flo actually displays a numeric score, not W/L.
    const points = value => /^-?\d+$/.test(String(value.scoreText ?? '')) && Number.isFinite(value.points) ? value.points : null;
    matches.push({ sourceMatchId, division: division.join(', ') || 'Unspecified division', round: round || 'Result',
      status: 'settled', sourceState: 'published-result', sourceUrl: `https://www.flograppling.com/events/${eventId}/results`,
      competitorA: competitor(a), competitorB: competitor(b), winnerSide: winner === a ? 'left' : 'right',
      finish: winner.subtitle || 'Published result', score: { left: { points: points(a) }, right: { points: points(b) } } });
  }
  return matches;
}

function photoUrl(athlete) {
  const values = [athlete.profileImageUrl, athlete.profile_image_url, athlete.profilePhoto, athlete.profile_photo,
    athlete.imageUrl, athlete.image_url, athlete.photoUrl, athlete.photo_url, athlete.avatarUrl, athlete.avatar_url,
    athlete.headshotUrl, athlete.headshot_url, athlete.headshot, athlete.image, athlete.photo];
  for (const value of values) {
    const raw = typeof value === 'string' ? value : value?.url || value?.src;
    if (!raw || /placeholder|default-avatar|no-image/i.test(raw)) continue;
    try { const url = new URL(raw, 'https://www.flograppling.com'); return url.protocol === 'https:' ? url.href : undefined; }
    catch { /* Ignore unsupported photo fields. */ }
  }
  return undefined;
}

export async function fetchFloEvent(input, { fetchImpl = fetch, maxPages = 30 } = {}) {
  const eventId = floEventId(input);
  const client = createSourceClient({ fetchImpl, timeoutMs: 25000, pauseMs: 0, maxRequests: maxPages * 4 });
  const sourceUrl = `https://www.flograppling.com/events/${eventId}/results`;
  const queue = [sourceUrl], visited = new Set(), matches = new Map();
  let schema;
  while (queue.length) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    if (visited.size >= maxPages) throw new Error('Flo page limit reached; refusing to save incomplete results.');
    visited.add(url);
    if (visited.size > 1) await new Promise(resolve => setTimeout(resolve, 250));
    const response = await client.request(url);
    if (!response.ok) throw new Error(`Flo HTTP ${response.status}: ${url}`);
    const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : parseFloPage(await response.text());
    if (!schema && body.seo?.schema?.innerText) schema = JSON.parse(body.seo.schema.innerText);
    for (const match of resultCards(body, eventId)) {
      const previous = matches.get(match.sourceMatchId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(match)) throw new Error('Conflicting Flo results; manual review required.');
      matches.set(match.sourceMatchId, match);
    }
    for (const item of objects(body)) {
      let next;
      if (item.type === 'filter-option' && ['Male', 'Female'].includes(item.title)) next = item.action?.url;
      if (item.type === 'link' && (item.title === 'View All' || item.style === 'paginate')) next = item.url;
      if (!next) continue;
      const target = new URL(next, next.startsWith('/api/') ? 'https://api.flograppling.com' : sourceUrl);
      const allowedPage = /^\/events\/(\d+)(?:-[^/]*)?\/results(?:\/view-all)?$/.exec(target.pathname);
      const allowedApi = /^\/api\/experiences\/web\/event-hub\/(\d+)\/results\/list\/partial$/.exec(target.pathname);
      if (target.protocol !== 'https:' || target.port || target.username || target.password ||
          !((target.hostname === 'www.flograppling.com' && allowedPage?.[1] === eventId) || (target.hostname === 'api.flograppling.com' && allowedApi?.[1] === eventId))) continue;
      if (!visited.has(target.href)) queue.push(target.href);
    }
  }
  if (!matches.size || !schema?.name || !schema.startDate) throw new Error('No supported published Flo results or event metadata; previous snapshot preserved.');
  return { id: `e-flo-${eventId}`, sourceEventId: eventId, name: schema.name, organizer: 'FloGrappling',
    startsAt: schema.startDate, endsAt: schema.endDate, sourceUrl,
    status: schema.endDate && Date.parse(schema.endDate) < Date.now() ? 'complete' : 'live',
    matches: [...matches.values()], warnings: ['Published Flo results only. Live brackets, clocks and complete event coverage are not guaranteed.'],
    pagesFetched: visited.size };
}
