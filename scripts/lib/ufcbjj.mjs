import { load } from 'cheerio';
import { allowedSourceUrl, coverage, createSourceClient, eventStatus } from './source-http.mjs';

const CALENDAR = 'https://www.ufc.com.br/ufcbjj';
const REPORTED_CARD = 'https://ge.globo.com/combate/noticia/2026/01/01/programacao-do-combate.ghtml';
const MONTHS = { janeiro: 0, fevereiro: 1, marco: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11 };
const plain = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const slug = value => plain(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const brazilClock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric',
  month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' });

function brasiliaTime(year, month, day, hour) {
  const wanted = Date.UTC(year, month, day, hour);
  let utc = wanted;
  for (let attempt = 0; attempt < 2; attempt++) {
    const parts = Object.fromEntries(brazilClock.formatToParts(new Date(utc)).map(part => [part.type, part.value]));
    const displayed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour));
    utc += wanted - displayed;
  }
  return new Date(utc).toISOString();
}

export function ufcBjjId(input) {
  const url = allowedSourceUrl(input);
  const id = url.hash.match(/^#ufc-bjj-(\d+)$/)?.[1];
  if (!['www.ufc.com.br', 'ufc.com.br'].includes(url.hostname) || url.pathname !== new URL(CALENDAR).pathname || !id)
    throw new Error('Use a UFC BJJ calendar event URL.');
  return id;
}

export function parseUfcBjjCalendar(html, { now = Date.now() } = {}) {
  const $ = load(html);
  const hero = $('.hero--ufc_experience').first();
  const title = clean(hero.find('.hero__title').first().text());
  const found = title.match(/^UFC BJJ (\d+):\s*(.+?)\s+[x×]\s+(.+)$/i);
  if (!found) return [];
  const alt = hero.find('img').first().attr('alt') || '';
  const detailText = clean(`${hero.find('.hero__body').text()} ${alt}`);
  const year = new Date(now).getUTCFullYear();
  const date = plain(detailText).match(/(\d{1,2}) de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?: de (\d{4}))?/);
  const hour = plain(detailText).match(/as (\d{1,2}) horas? \(horario de brasilia\)/);
  if (!date || !hour) return [];
  const eventYear = Number(date[3] || year), month = MONTHS[date[2]], day = Number(date[1]);
  const startsAt = brasiliaTime(eventYear, month, day, Number(hour[1]));
  if (Date.parse(startsAt) < now - 8 * 60 * 60 * 1000) return [];
  const endsAt = new Date(Date.parse(startsAt) + 8 * 60 * 60 * 1000).toISOString();
  const fullNames = alt.match(/^(.+?) e (.+?) lideram o UFC BJJ/i);
  const names = fullNames ? [clean(fullNames[1]), clean(fullNames[2])] : [clean(found[2]), clean(found[3])];
  const sourceUrl = `${CALENDAR}#ufc-bjj-${found[1]}`;
  return [{ id: `e-ufcbjj-${found[1]}`, source: 'ufcbjj', sourceEventId: found[1],
    name: title.replace(/ x /i, ' vs '), organizer: 'UFC BJJ', city: 'Las Vegas, Nevada',
    startsAt, endsAt, sourceUrl, coverImage: hero.find('img').first().attr('src') || '',
    status: eventStatus(startsAt, endsAt), mainPair: names }];
}

export function parseReportedUfcBjjCard(html, eventNumber) {
  const $ = load(html);
  const card = $('article p').toArray().map(node => $(node)).find(paragraph =>
    clean(paragraph.find('strong').first().text()) === `UFC BJJ ${eventNumber}`);
  if (!card) return [];
  const separated = card.html().replace(/<br\s*\/?\s*>/gi, '\n');
  const lines = load(`<div>${separated}</div>`)('div').text().split('\n').map(clean);
  return lines.flatMap(line => {
    const found = line.match(/^([^:]+):\s*(.+?)\s+x\s+(.+?)(?:\s*\([^)]*\))?$/i);
    return found ? [{ division: clean(found[1]), a: clean(found[2]), b: clean(found[3]) }] : [];
  });
}

function asSnapshot(event, reported = []) {
  const pairings = [{ division: 'Main event', a: event.mainPair[0], b: event.mainPair[1], sourceUrl: CALENDAR },
    ...reported.map(pair => ({ ...pair, sourceUrl: REPORTED_CARD }))];
  const seen = new Set();
  const matches = pairings.flatMap(pair => {
    if (!pair.a || !pair.b || plain(pair.a) === plain(pair.b)) return [];
    const key = [slug(pair.a), slug(pair.b)].sort().join('-');
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ sourceMatchId: `${event.sourceEventId}-${key}`, division: pair.division,
      round: pair.division === 'Main event' ? 'Main event' : 'Reported fight card', mat: 'Mat TBA',
      scheduledAt: event.startsAt, status: 'locked', sourceState: 'card-announced', sourceUrl: pair.sourceUrl,
      competitorA: { sourceId: `ufcbjj-${slug(pair.a)}`, name: pair.a, academy: 'Not listed' },
      competitorB: { sourceId: `ufcbjj-${slug(pair.b)}`, name: pair.b, academy: 'Not listed' } }];
  });
  return { ...event, matches, coverage: coverage(matches, { level: reported.length ? 'partial' : 'limited', liveScores: false }),
    warnings: ['Card start is published; individual bout times are not. Additional pairings are reported by ge.globo.com and may change.'] };
}

export async function discoverUfcBjj(options = {}) {
  const events = parseUfcBjjCalendar(await createSourceClient(options).text(CALENDAR));
  return events.map(({ mainPair, ...event }) => ({ ...event, matches: [], coverage: coverage([], { level: 'discovered' }) }));
}

export async function fetchUfcBjjEvent(input, options = {}) {
  const id = ufcBjjId(input);
  const client = createSourceClient(options);
  const events = parseUfcBjjCalendar(await client.text(CALENDAR));
  const event = events.find(candidate => candidate.sourceEventId === id);
  if (!event) throw new Error('UFC BJJ event is no longer on the upcoming calendar.');
  let reported = [];
  try { reported = parseReportedUfcBjjCard(await client.text(REPORTED_CARD), id); } catch { /* Official main event remains available. */ }
  return asSnapshot(event, reported);
}
