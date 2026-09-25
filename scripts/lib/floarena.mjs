import { allowedSourceUrl, coverage, createSourceClient, eventStatus } from './source-http.mjs';

const ORIGIN = 'https://arena.flograppling.com';
const UUID = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
export function arenaId(input) {
  const url = allowedSourceUrl(input);
  const id = url.pathname.match(new RegExp(`^/event/(${UUID})(?:/|$)`, 'i'))?.[1];
  if (url.hostname !== 'arena.flograppling.com' || !id) throw new Error('Use a FloArena event URL with a UUID.');
  return id;
}
function response(payload) {
  if (payload?.status !== 'SUCCESS' || !payload.response) throw new Error('FloArena data unavailable.');
  return payload.response;
}
export function arenaEvent(info) {
  if (!info.guid || !info.name) throw new Error('Invalid FloArena event metadata.');
  return { id: `e-floarena-${info.guid}`, source: 'floarena', sourceEventId: info.guid, name: info.name,
    startsAt: info.startDateTimezone || info.startDate || '', endsAt: info.endDateTimezone || info.endDate || '',
    city: info.locationName || '', organizer: 'FloArena', sourceUrl: `${ORIGIN}/event/${info.guid}`,
    status: info.status === 'concluded' ? 'complete' : eventStatus(info.startDate, info.endDate), matches: [],
    coverage: coverage([], { level: 'discovered' }) };
}
export async function discoverArena(options = {}) {
  const client = createSourceClient(options);
  const events = response(await client.json(`${ORIGIN}/events/current`));
  if (!Array.isArray(events)) throw new Error('Invalid FloArena calendar.');
  return events.filter(event => !event.siteId || event.siteId === 8).map(arenaEvent);
}
export function parseArenaBouts(payload, eventId) {
  const data = response(payload);
  if (!Array.isArray(data.bouts)) throw new Error('FloArena recent results shape changed.');
  return data.bouts.flatMap(bout => {
    const a = bout.topWrestler, b = bout.bottomWrestler;
    if (!bout.guid || !a?.guid || !b?.guid || bout.isTopBye || bout.isBottomBye) return [];
    const winnerSide = bout.winnerWrestlerGuid === a.guid ? 'left' : bout.winnerWrestlerGuid === b.guid ? 'right' : null;
    if (!winnerSide) return [];
    const competitor = athlete => ({ sourceId: `${eventId}-${athlete.guid}`,
      name: [athlete.firstName, athlete.lastName].filter(Boolean).join(' '),
      // ADCC team labels in this feed are often countries, not academies.
      academy: 'Not listed', country: '—', belt: 'unknown', record: 'FloArena results' });
    return [{ sourceMatchId: `${eventId}-${bout.guid}`, division: bout.weightClass?.name || 'Unspecified division',
      round: bout.roundName?.displayName || 'Result', status: 'settled', sourceState: 'published-result',
      competitorA: competitor(a), competitorB: competitor(b), winnerSide,
      // Result strings can contain points, penalties or referee decisions.
      // Keep the exact string; do not assign its numbers to a side by guessing.
      finish: bout.result || bout.winType || 'FloArena result', sourceUrl: `${ORIGIN}/event/${eventId}?page=results`,
      relatedSourceUrl: bout.boutVideoUrl || undefined }];
  });
}
export async function fetchArenaEvent(input, options = {}) {
  const id = arenaId(input), client = createSourceClient(options);
  const event = arenaEvent(response(await client.json(`${ORIGIN}/event/${id}/info`)));
  const matches = parseArenaBouts(await client.json(`${ORIGIN}/event/${id}/recent-results`), id);
  return { ...event, matches, warnings: ['Recent results only; this endpoint is a rolling window, not a complete bracket. Full bracket endpoints returned server errors during verification.'],
    coverage: coverage(matches, { level: 'partial', liveScores: false }) };
}
