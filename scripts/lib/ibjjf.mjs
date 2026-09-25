import { load } from 'cheerio';
import { allowedSourceUrl, coverage, createSourceClient } from './source-http.mjs';

const ORIGIN = 'https://www.bjjcompsystem.com';
const text = element => element.text().replace(/\s+/g, ' ').trim();

export function ibjjfId(input) {
  const url = allowedSourceUrl(input);
  if (!['www.bjjcompsystem.com', 'bjjcompsystem.com'].includes(url.hostname)) throw new Error('Use an IBJJF BJJCompsystem tournament URL.');
  const id = url.pathname.match(/^\/tournaments\/(\d+)(?:\/|$)/)?.[1];
  if (!id) throw new Error('IBJJF tournament ID is missing.');
  return id;
}

export function parseIbjjfEvents(html) {
  const $ = load(html);
  if (!$('#tournament_id').length) throw new Error('IBJJF event calendar changed or is unavailable.');
  return $('#tournament_id option[value]').toArray().flatMap(node => {
    const id = $(node).attr('value');
    if (!/^\d+$/.test(id || '')) return [];
    return [{ id: `e-ibjjf-${id}`, source: 'ibjjf', sourceEventId: id, name: text($(node)),
      sourceUrl: `${ORIGIN}/tournaments/${id}/categories`, status: 'unknown', startsAt: '',
      organizer: 'IBJJF', matches: [], coverage: coverage([], { level: 'discovered' }) }];
  });
}

export async function discoverIbjjf(options = {}) {
  return parseIbjjfEvents(await createSourceClient(options).text(`${ORIGIN}/`));
}

export function parseIbjjfCategories(html, eventId) {
  const $ = load(html);
  if (!$('.public-categories').length && !$('a[href*="/categories/"]').length) throw new Error('IBJJF published categories not available.');
  const categories = new Map();
  $('a[href]').each((_, node) => {
    const match = $(node).attr('href').match(/^\/tournaments\/(\d+)\/categories\/(\d+)$/);
    if (match?.[1] !== eventId) return;
    categories.set(match[2], { id: match[2], name: text($(node)), url: `${ORIGIN}${$(node).attr('href')}` });
  });
  // Elite divisions first when a request budget limits coverage.
  return [...categories.values()].sort((a, b) => Number(/BLACK/i.test(b.name)) - Number(/BLACK/i.test(a.name)));
}

export function parseIbjjfBracket(html, eventId, categoryId) {
  const $ = load(html);
  const division = $('.category-title__label').toArray().map(node => text($(node))).filter(Boolean).join(' / ');
  if (!division || !$('.tournament-category__brackets').length) throw new Error('IBJJF bracket layout missing.');
  const matches = [];
  $('.tournament-category__match').each((_, node) => {
    const container = $(node), card = container.find('.tournament-category__match-card');
    const id = card.attr('id');
    const players = card.find('.match-card__competitor').toArray().map(player => {
      const element = $(player);
      return { sourceId: element.attr('id')?.replace(/^competitor-/, ''),
        name: text(element.find('.match-card__competitor-name')), academy: text(element.find('.match-card__club-name')) || 'Not listed',
        country: '—', belt: ['black', 'brown', 'purple', 'blue', 'white'].find(belt => division.toLowerCase().includes(belt)) || 'unknown',
        record: 'IBJJF bracket', imageUrl: competitorPhoto(element), loser: element.find('.match-competitor--loser').length > 0 };
    });
    // Byes and unresolved advancement placeholders are not two-sided markets.
    if (!id || players.length !== 2 || players.some(p => !p.sourceId || !p.name)) return;
    const [a, b] = players;
    const winnerSide = a.loser !== b.loser ? a.loser ? 'right' : 'left' : null;
    const where = text(container.find('.bracket-match-header__where'));
    matches.push({ sourceMatchId: `${eventId}-${categoryId}-${id}`, sourceBracketId: categoryId, division,
      round: text(container.find('.bracket-match-header__fight')).replace(/:$/, '') || 'Bracket match',
      mat: where.match(/Mat\s+\d+/i)?.[0] || 'TBD', scheduledAt: '',
      scheduledLabel: text(container.find('.bracket-match-header__when')),
      // The bracket page lacks a reliable live state / timezone. Pending
      // fixtures stay locked rather than pretending they are pre-match.
      status: winnerSide ? 'settled' : 'locked', sourceState: winnerSide ? 'published-bracket-result' : 'bracket-state-unconfirmed',
      competitorA: { ...a, loser: undefined }, competitorB: { ...b, loser: undefined }, winnerSide,
      finish: winnerSide ? 'IBJJF bracket result (method not listed)' : null,
      sourceUrl: `${ORIGIN}/tournaments/${eventId}/categories/${categoryId}` });
  });
  return matches;
}

function competitorPhoto(element) {
  const image = element.find('img').first();
  const srcset = image.attr('srcset')?.split(',')[0]?.trim().split(/\s+/)[0];
  const style = image.attr('style') || element.attr('style') || '';
  const backgroundImage = style.match(/background-image\s*:\s*url\(["']?([^"')]+)["']?\)/i)?.[1];
  const raw = image.attr('data-profile-image') || element.attr('data-profile-image') || image.attr('data-src') ||
    image.attr('data-original') || image.attr('src') || srcset || backgroundImage;
  if (!raw || /placeholder|default-avatar|no-image/i.test(raw)) return undefined;
  try {
    const url = allowedSourceUrl(new URL(raw, ORIGIN).href);
    return ['www.bjjcompsystem.com', 'bjjcompsystem.com'].includes(url.hostname) ? url.href : undefined;
  } catch { return undefined; }
}

export async function fetchIbjjfEvent(input, { bracketLimit = 30, seed, ...options } = {}) {
  const eventId = ibjjfId(input), client = createSourceClient(options);
  const sourceUrl = `${ORIGIN}/tournaments/${eventId}/categories`;
  const html = await client.text(sourceUrl);
  const categories = parseIbjjfCategories(html, eventId);
  const matches = [], warnings = [];
  let importedBrackets = 0;
  for (const category of categories.slice(0, bracketLimit)) {
    try {
      matches.push(...parseIbjjfBracket(await client.text(category.url), eventId, category.id));
      importedBrackets++;
    } catch (error) { warnings.push(`Category ${category.id}: ${error.message}`); }
  }
  if (categories.length && !importedBrackets) throw new Error(`No IBJJF brackets could be read. ${warnings[0] || ''}`);
  if (categories.length > importedBrackets) warnings.push(`Imported ${importedBrackets} of ${categories.length} published categories. Black belts are prioritized.`);
  warnings.push('Points, finish methods, exact times and live match state are not exposed by this bracket adapter. Unresolved fixtures are locked.');
  return { ...seed, id: `e-ibjjf-${eventId}`, source: 'ibjjf', sourceEventId: eventId,
    name: seed?.name || load(html)('.navbar-public__tournament-logo').attr('alt') || `IBJJF tournament ${eventId}`,
    organizer: 'IBJJF', startsAt: seed?.startsAt || '', status: seed?.status || 'unknown', sourceUrl, matches, warnings,
    coverage: coverage(matches, { level: importedBrackets < categories.length ? 'limited' : 'published',
      totalBrackets: categories.length, importedBrackets, liveScores: false }) };
}
