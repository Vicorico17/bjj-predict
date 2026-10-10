import { createSmoothcompWorker } from '../smoothcomp-sync.mjs';
import { fetchFloEvent } from './flo.mjs';
import { discoverIbjjf, fetchIbjjfEvent } from './ibjjf.mjs';
import { discoverArena, fetchArenaEvent } from './floarena.mjs';
import { discoverOne, fetchOneEvent } from './one.mjs';
import { discoverUfcBjj, fetchUfcBjjEvent, ufcBjjId } from './ufcbjj.mjs';
import { allowedSourceUrl, coverage } from './source-http.mjs';
import { featuredEventFor } from './featured.mjs';
import { directoryProviders, directorySource, discoverDirectory, fetchDirectoryEvent } from './directories.mjs';

export const providers = [
  ...directoryProviders.map(provider => ({ ...provider, discovery: true })),
  { id: 'smoothcomp', name: 'Smoothcomp', discovery: true, description: 'Brackets, match state and published scores' },
  { id: 'ajp', name: 'AJP Tour', discovery: true, description: 'AJP brackets and published scores' },
  { id: 'ibjjf', name: 'IBJJF', discovery: true, description: 'Published brackets; pending fixtures stay locked' },
  { id: 'floarena', name: 'FloArena', discovery: true, description: 'Current events and recent results; partial coverage' },
  { id: 'one', name: 'ONE Championship', discovery: true, description: 'Officially announced submission grappling bouts' },
  { id: 'ufcbjj', name: 'UFC BJJ', discovery: true, description: 'Official schedule and reported fight card' },
  { id: 'flo', name: 'FloGrappling', discovery: false, description: 'Import a Flo event URL for published results' }
];

export function providerFor(input) {
  const directory = directorySource(input);
  if (directory) return directory;
  if (featuredEventFor(input)) return featuredEventFor(input).source;
  const url = allowedSourceUrl(input), host = url.hostname;
  if (host === 'smoothcomp.com' || host.endsWith('.smoothcomp.com')) return 'smoothcomp';
  if (host === 'ajptour.com' || host === 'www.ajptour.com') return 'ajp';
  if (host === 'bjjcompsystem.com' || host === 'www.bjjcompsystem.com') return 'ibjjf';
  if (host === 'arena.flograppling.com') return 'floarena';
  if (host === 'www.onefc.com') return 'one';
  if (host === 'www.ufc.com.br' || host === 'ufc.com.br') { ufcBjjId(input); return 'ufcbjj'; }
  if (host === 'www.flograppling.com' || host === 'flograppling.com') return 'flo';
  throw new Error('Unsupported event URL.');
}

function eventStatus(event) {
  const start = event.startdate ? Date.parse(`${event.startdate}T00:00:00Z`) : NaN;
  const end = event.enddate ? Date.parse(`${event.enddate}T23:59:59Z`) : NaN;
  const now = Date.now();
  if (event.eventEnded || Number.isFinite(end) && end < now) return 'complete';
  if (Number.isFinite(start) && start > now) return 'upcoming';
  if (Number.isFinite(start) && (Number.isFinite(end) && end >= now || now - start < 24 * 60 * 60 * 1000)) return 'live';
  return Number.isFinite(start) ? 'complete' : 'unknown';
}

function prioritizeEvents(events) {
  return events.map(event => ({ ...event, status: eventStatus(event) }))
    .filter(event => event.status === 'live' || event.status === 'upcoming' || event.status === 'unknown')
    .sort((a, b) => {
      const rank = status => status === 'live' ? 0 : status === 'upcoming' ? 1 : 2;
      return rank(a.status) - rank(b.status) || Date.parse(a.startsAt || '') - Date.parse(b.startsAt || '');
    });
}

export async function discoverData({ selectedProviders = [...directoryProviders.map(provider => provider.id), 'smoothcomp', 'ajp', 'ibjjf', 'floarena', 'one', 'ufcbjj'], eventLimit = Infinity, ...options } = {}) {
  const results = await Promise.all(selectedProviders.map(async source => {
    try {
      let events, warnings = [];
      if (source === 'smoothcomp' || source === 'ajp') {
        const calendar = source === 'ajp' ? 'https://ajptour.com/en/events/upcoming' : 'https://smoothcomp.com/en/events/upcoming';
        const worker = createSmoothcompWorker(['--calendar-url', calendar], options);
        const raw = await worker.discover();
        events = prioritizeEvents(raw.map(event => ({ startdate: event.startdate, enddate: event.enddate, eventEnded: event.eventEnded, id: `e-${source}-${event.id}`, source, sourceEventId: String(event.id), name: event.title,
          organizer: source === 'ajp' ? 'AJP Tour' : 'Smoothcomp', sourceUrl: event.url,
          city: event.location_city || '', country: event.location_country_human || '', coverImage: event.cover_image || '',
          startsAt: event.startdate ? `${event.startdate}T00:00:00Z` : '',
          endsAt: event.enddate ? `${event.enddate}T23:59:59Z` : '',
          matches: [], coverage: coverage([], { level: 'discovered' }) })));
      } else if (directoryProviders.some(provider => provider.id === source)) {
        ({ events, warnings } = await discoverDirectory(source, options));
      }
      else if (source === 'ibjjf') events = await discoverIbjjf(options);
      else if (source === 'floarena') events = await discoverArena(options);
      else if (source === 'one') events = await discoverOne(options);
      else if (source === 'ufcbjj') events = await discoverUfcBjj(options);
      else throw new Error('Provider does not offer verified discovery.');
      const returned = events.slice(0, eventLimit);
      if (returned.length < events.length) warnings.push(`Event limit returned ${returned.length} of ${events.length} discovered events.`);
      return { source, status: warnings.length ? 'partial' : 'ok', discovered: events.length, returned: returned.length, warnings, events: returned };
    } catch (error) { return { source, status: 'error', error: error.message, events: [] }; }
  }));
  return { checkedAt: new Date().toISOString(), providers: results.map(({ events, ...result }) => result), events: deduplicateDiscoveredEvents(results.flatMap(result => result.events)) };
}

export async function importData(input, { bracketLimit = 30, matchLimit = 1000, liveScoreLimit = 120, bracketOffset = 0, participants = false, details = false, seed, ...options } = {}) {
  const source = providerFor(input);
  let event;
  if (source === 'smoothcomp' || source === 'ajp') {
    const worker = createSmoothcompWorker(['--event', input, ...(details ? [] : ['--no-details']), ...(participants ? ['--participants'] : []), `--bracket-offset=${bracketOffset}`, `--bracket-limit=${bracketLimit}`, `--match-limit=${matchLimit}`, `--live-score-limit=${liveScoreLimit}`], options);
    const snapshot = await worker.run();
    event = snapshot.events[0];
    if (!event) throw new Error(snapshot.warnings[0] || 'Event import failed.');
    if (event.coverage?.importedBrackets === 0) {
      const bracketFailure = event.warnings.find(warning => warning.startsWith('Published brackets unavailable:') || warning.startsWith('Bracket '));
      if (bracketFailure && !event.participants?.length && !event.brackets?.length) throw new Error(bracketFailure);
    }
    if (seed && event?.warnings?.some(warning => warning.startsWith('Event page metadata unavailable:'))) {
      event.name = seed.name || event.name;
      event.startsAt = seed.startsAt || event.startsAt;
      event.endsAt = seed.endsAt || event.endsAt;
      event.status = seed.status || event.status;
      event.city = seed.city || event.city;
    }
  } else if (directoryProviders.some(provider => provider.id === source)) {
    event = await fetchDirectoryEvent(featuredEventFor(input)?.sourceUrl || input, options);
    // Reviewed bouts supplement the live listing; they are never used for discovery.
    const supplement = featuredEventFor(input);
    if (supplement) {
      event.matches = structuredClone(supplement.matches);
      event.coverage = { ...supplement.coverage };
      event.warnings = [...(supplement.warnings || []), `Reported card last reviewed ${supplement.observedAt}.`];
    }
  }
  else if (source === 'ibjjf') event = await fetchIbjjfEvent(input, { bracketLimit, seed, ...options });
  else if (source === 'floarena') event = await fetchArenaEvent(input, options);
  else if (source === 'one') event = await fetchOneEvent(input, options);
  else if (source === 'ufcbjj') event = await fetchUfcBjjEvent(input, options);
  else {
    event = await fetchFloEvent(input, options);
    event.coverage = coverage(event.matches, { level: 'partial', liveScores: false });
  }
  event.source = source;
  if (seed?.name && (event.name === `IBJJF tournament ${event.sourceEventId}` || event.name.startsWith('Smoothcomp Event'))) event.name = seed.name;
  return { source, syncedAt: new Date().toISOString(), calendarUrl: '', events: [event] };
}

// Source IDs are stable across mirrored calendars. Never deduplicate on name alone.
export function deduplicateDiscoveredEvents(events) {
  const byId = new Map();
  for (const event of events) {
    const previous = byId.get(event.id);
    if (!previous) { byId.set(event.id, event); continue; }
    const merged = { ...previous, ...event };
    for (const field of ['city', 'country', 'venue', 'organizer', 'startsAt', 'endsAt', 'coverImage', 'officialUrl']) {
      if (!merged[field]) merged[field] = previous[field];
    }
    byId.set(event.id, merged);
  }
  return [...byId.values()];
}

// Partial fetches update known matches but do not discard earlier result pages.
// Each event retains its own observation time, including events not refreshed.
export function mergeDataSnapshots(previous, incoming) {
  const isPlaceholder = name => /^(?:(?:winner|loser)(?:\s+from\b|\s*$)|tbd\b|to be determined\b|bye\b|unknown competitor\b)/i.test(String(name || '').trim());
  const usable = match => !isPlaceholder(match.competitorA?.name) && !isPlaceholder(match.competitorB?.name);
  const events = new Map((previous?.events || []).map(event => [event.id, {
    ...event,
    matches: (event.matches || []).filter(usable),
    coverage: event.coverage ? { ...event.coverage, matchCount: (event.matches || []).filter(usable).length } : event.coverage
  }]));
  for (const event of incoming.events) {
    const old = events.get(event.id);
    const matches = new Map((old?.matches || []).filter(usable).map(match => [match.sourceMatchId, match]));
    const warnings = [...(event.warnings || [])];
    for (const match of event.matches.filter(usable)) {
      const before = matches.get(match.sourceMatchId);
      if (before && (before.competitorA?.sourceId !== match.competitorA?.sourceId || before.competitorB?.sourceId !== match.competitorB?.sourceId ||
          before.winnerSide && match.winnerSide && before.winnerSide !== match.winnerSide)) {
        warnings.push(`Match ${match.sourceMatchId} changed participants or winner; previous record retained for review.`);
        continue;
      }
      matches.set(match.sourceMatchId, before?.winnerSide && !match.winnerSide ? before : match);
    }
    const brackets = new Map((old?.brackets || []).map(bracket => [bracket.sourceId, bracket]));
    for (const bracket of event.brackets || []) brackets.set(bracket.sourceId, { ...brackets.get(bracket.sourceId), ...bracket });
    const participants = new Map((old?.participants || []).map(player => [`${player.sourceId}:${player.division}`, player]));
    for (const player of event.participants || []) participants.set(`${player.sourceId}:${player.division}`, player);
    events.set(event.id, { ...old, ...event,
      ...(brackets.size ? { brackets: [...brackets.values()] } : {}),
      ...(participants.size ? { participants: [...participants.values()] } : {}), observedAt: event.observedAt || incoming.syncedAt,
      warnings, matches: [...matches.values()], coverage: event.coverage ? { ...event.coverage, matchCount: matches.size, ...(brackets.size ? { importedBrackets: [...brackets.values()].filter(bracket => bracket.loaded).length } : {}) } : event.coverage });
  }
  return { source: 'mixed', syncedAt: incoming.syncedAt, calendarUrl: '', events: [...events.values()] };
}
