import { load } from 'cheerio';
import { createSourceClient, coverage } from './source-http.mjs';

export const directoryProviders = [
  { id: 'bjjcalendar', name: 'BJJ Championships', url: 'https://www.bjj-championships.com/en/', description: 'Worldwide multi-federation competition calendar' },
  { id: 'grapplingnews', name: 'GrapplersNews', url: 'https://grapplersnews.jp/en/events', description: 'Independent shows and professional grappling calendar' },
  { id: 'gosofia', name: 'Go Sofia', url: 'https://www.go-sofia.com/Events?category=Sports', description: 'Local event listings, including independent grappling shows' }
];
const clean = value => String(value || '').replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16))).replace(/\s+/g, ' ').trim();
const grappling = /\bbjj\b|jiu[ -]?jitsu|grappling|adcc|джиу|жиу|граплинг/i;
const DAY = 86400000;
const dateStatus = (start, end, now) => !Number.isFinite(Date.parse(start)) ? 'unknown' :
  (Date.parse(end) || Date.parse(start) + DAY) < now ? 'complete' : Date.parse(start) > now ? 'upcoming' : 'live';
const safeLink = (value, base) => {
  try { const url = new URL(value, base); return url.protocol === 'https:' && !url.username && !url.password && !url.port ? url.href : ''; } catch { return ''; }
};

export function directorySource(input) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
  if (url.hostname === 'www.bjj-championships.com' && /^\/en\/competition\/\d+\/?$/.test(url.pathname)) return 'bjjcalendar';
  if (url.hostname === 'grapplersnews.jp' && /^\/en\/event\/[a-z0-9-]+\/?$/.test(url.pathname)) return 'grapplingnews';
  if (url.hostname === 'www.go-sofia.com' && /^\/Events\/Details\/\d+\/?$/.test(url.pathname)) return 'gosofia';
  return null;
}

function eventRecord(source, id, fields, now) {
  return { id: `e-${source}-${id}`, source, sourceEventId: String(id), name: fields.name, organizer: fields.organizer || '',
    city: fields.city || '', country: fields.country || '', venue: fields.venue || '', coverImage: fields.coverImage || '',
    startsAt: fields.startsAt || '', endsAt: fields.endsAt || '', sourceUrl: fields.sourceUrl, officialUrl: fields.officialUrl || '',
    status: fields.cancelled ? 'complete' : dateStatus(fields.startsAt, fields.endsAt, now),
    observedAt: new Date(now).toISOString(), matches: [], coverage: coverage([], { level: 'discovered', liveScores: false }),
    warnings: fields.cancelled ? ['The listing reports this event as cancelled.'] : ['Event listing only; matchups and live scores are not supplied by this directory.'] };
}

// Read only the event fields in Nuxt's JSON reference table. No script execution.
export function parseChampionshipCalendar(html, now = Date.now()) {
  const $ = load(html);
  const table = JSON.parse($('#__NUXT_DATA__').text() || 'null');
  if (!Array.isArray(table)) throw new Error('BJJ Championships calendar payload unavailable.');
  const deref = index => Number.isInteger(index) && index >= 0 ? table[index] : undefined;
  const rows = table.filter(row => row && !Array.isArray(row) && typeof row === 'object' &&
    'id' in row && 'name' in row && 'startDate' in row && 'eventUrl' in row);
  if (!rows.length) throw new Error('BJJ Championships event schema changed.');
  return rows.map(row => {
    const id = deref(row.id), calendar = deref(row.calendar);
    const startsAt = deref(row.startDate), end = deref(row.endDate);
    const officialUrl = safeLink(deref(row.eventUrl));
    const event = eventRecord('bjjcalendar', id, { name: clean(deref(row.name)), startsAt: `${startsAt}T00:00:00Z`,
      endsAt: `${end || startsAt}T23:59:59Z`, city: clean(deref(row.city)), country: clean(deref(row.country)),
      venue: clean(deref(row.arenaAddress)), organizer: clean(deref(calendar?.federation)), officialUrl,
      sourceUrl: `https://www.bjj-championships.com/en/competition/${id}` }, now);
    // Use the same identity as bracket providers when the directory links to them.
    if (officialUrl) {
      const url = new URL(officialUrl), match = url.pathname.match(/\/(?:[a-z]{2}\/)?event\/(\d+)\/?$/);
      const source = url.hostname === 'smoothcomp.com' || url.hostname.endsWith('.smoothcomp.com') ? 'smoothcomp' :
        ['ajptour.com', 'www.ajptour.com'].includes(url.hostname) ? 'ajp' : null;
      if (source && match) Object.assign(event, { source, id: `e-${source}-${match[1]}`, sourceEventId: match[1], sourceUrl: officialUrl });
    }
    return event;
  }).filter(event => event.name && event.status !== 'complete');
}

export function parseGrapplingNewsCalendar(html, now = Date.now()) {
  const $ = load(html), events = new Map();
  $('a[href^="/en/event/"]').each((_, node) => {
    const card = $(node), name = clean(card.find('h3').text());
    if (!name) return;
    const dateParts = card.children('div').first().children('div').map((_, part) => clean($(part).text())).get();
    const date = Date.parse(`${dateParts[1]} ${dateParts[2]} ${dateParts[0]} UTC`);
    if (!Number.isFinite(date)) return;
    const sourceUrl = new URL(card.attr('href'), 'https://grapplersnews.jp').href;
    const tags = card.find('span').map((_, tag) => clean($(tag).text())).get();
    const event = eventRecord('grapplingnews', sourceUrl.split('/').at(-1), { name, sourceUrl,
      startsAt: new Date(date).toISOString(), organizer: tags.length > 1 ? tags[0] : '', city: tags.at(-1) || '' }, now);
    if (event.status !== 'complete') events.set(event.id, event);
  });
  if (!$('a[href^="/en/event/"]').length) throw new Error('GrapplersNews calendar layout unavailable.');
  return [...events.values()];
}

export function parseSofiaLinks(html, pageUrl) {
  const $ = load(html);
  if (!$('.card, .pagination').length) throw new Error('Go Sofia event listing unavailable.');
  const links = new Set();
  $('.card').each((_, node) => {
    const card = $(node);
    if (!grappling.test(card.text())) return;
    const link = card.find('a[href^="/Events/Details/"]').first().attr('href');
    if (link) links.add(new URL(link, pageUrl).href);
  });
  const next = $('.pagination a').toArray().find(node => /Следваща|Next/i.test($(node).text()));
  const nextUrl = next ? safeLink($(next).attr('href'), pageUrl) : '';
  return { links: [...links], nextUrl: nextUrl && new URL(nextUrl).origin === new URL(pageUrl).origin ? nextUrl : '' };
}

export function parseDirectoryEvent(html, input, now = Date.now()) {
  const source = directorySource(input);
  if (!source) throw new Error('Unsupported directory event URL.');
  const $ = load(html), schemas = [];
  const visit = value => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if ([value['@type']].flat().some(type => type === 'Event' || type === 'SportsEvent')) schemas.push(value);
    if (value['@graph']) visit(value['@graph']);
  };
  $('script[type="application/ld+json"]').each((_, node) => { try { visit(JSON.parse($(node).text())); } catch {} });
  const schema = schemas.find(value => value.name && value.startDate);
  if (!schema) throw new Error('Dated event metadata unavailable.');
  const name = clean(schema.name), startsAt = clean(schema.startDate);
  if (!Number.isFinite(Date.parse(startsAt))) throw new Error('Event start date is invalid.');
  if (source === 'gosofia' && !grappling.test(`${name} ${clean(schema.description)}`)) throw new Error('This listing is not a grappling event.');
  const location = schema.location || {}, address = location.address || {};
  return eventRecord(source, new URL(input).pathname.split('/').filter(Boolean).at(-1), { name, startsAt,
    endsAt: clean(schema.endDate), sourceUrl: input, organizer: clean(schema.organizer?.name),
    city: source === 'gosofia' ? 'Sofia' : clean(address.addressLocality), country: source === 'gosofia' ? 'Bulgaria' : clean(typeof address.addressCountry === 'object' ? address.addressCountry.name : address.addressCountry),
    venue: clean(location.name), coverImage: safeLink(Array.isArray(schema.image) ? schema.image[0] : schema.image?.url || schema.image),
    officialUrl: safeLink(schema.offers?.url), cancelled: /EventCancelled/.test(schema.eventStatus || '') }, now);
}

export async function discoverDirectory(source, options = {}) {
  const provider = directoryProviders.find(provider => provider.id === source);
  if (!provider) throw new Error('Unknown directory.');
  const client = createSourceClient({ timeoutMs: 12000, ...options });
  const now = options.now ?? Date.now();
  if (source === 'bjjcalendar') return { events: parseChampionshipCalendar(await client.text(provider.url), now), warnings: [] };
  if (source === 'grapplingnews') return { events: parseGrapplingNewsCalendar(await client.text(provider.url), now), warnings: [] };
  const events = [], warnings = [], visited = new Set(), details = new Set();
  let page = provider.url;
  const maxPages = options.maxPages ?? 20;
  while (page && !visited.has(page) && visited.size < maxPages) {
    visited.add(page);
    try {
      const parsed = parseSofiaLinks(await client.text(page), page);
      parsed.links.forEach(link => details.add(link));
      page = parsed.nextUrl;
    } catch (error) { warnings.push(`${page}: ${error.message}`); break; }
  }
  if (page && visited.size >= maxPages) warnings.push(`Page budget reached at ${maxPages} pages; more listings remain.`);
  for (const url of details) {
    try { const event = parseDirectoryEvent(await client.text(url), url, now); if (event.status !== 'complete') events.push(event); }
    catch (error) { warnings.push(`${url}: ${error.message}`); }
  }
  if (!events.length && warnings.length) throw new Error(warnings.join('; '));
  return { events, warnings };
}

export async function fetchDirectoryEvent(input, options = {}) {
  if (!directorySource(input)) throw new Error('Unsupported directory event URL.');
  return parseDirectoryEvent(await createSourceClient(options).text(input), input, options.now ?? Date.now());
}
