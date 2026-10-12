import { load } from 'cheerio';
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const placeholder = value => /^(?:(?:winner|loser)(?:\s+(?:from|of)\b|\s*$)|tbd\b|to be determined\b|bye\b|unknown competitor\b)/i.test(clean(value));
const link = (value, base) => { try { const url = new URL(value, base); return value && url.protocol === 'https:' ? url.href : ''; } catch { return ''; } };
export function participantFromSeat(seat, division, base) {
  if (!seat?.name || placeholder(seat.name)) return null;
  const sourceId = String(seat.event_registration_id || seat.player_id || seat.id || '');
  if (!sourceId) return null;
  return { sourceId, name: clean(seat.name), academy: clean(seat.club || seat.affiliation), country: clean(seat.country), division,
    imageUrl: link(seat.image || seat.profile_image, base), sourceUrl: link(seat.profile_link, base) };
}
export function bracketSummary(bracket, base) {
  const sourceId = String(bracket.bracket_id || bracket.id);
  return { sourceId, name: clean(bracket.name) || 'Division', registrations: Number(bracket.registrations_count) || 0,
    mat: clean(bracket.mats), startsAt: bracket.estimated_start || '', sourceUrl: `${base}/bracket/${sourceId}` };
}
export function publishedDraw(bracket, rawMatches, base) {
  const summary = bracketSummary(bracket, base);
  return { ...summary, loaded: true, bouts: rawMatches.filter(match => match.id).map(match => ({
    sourceId: String(match.id), number: match.match_nr == null ? '' : String(match.match_nr),
    round: clean(match.name) || (match.round != null ? `Round ${match.round}` : 'Round not published'),
    roundOrder: Number.isFinite(Number(match.round)) ? Number(match.round) : 0,
    state: clean(match.state), mat: clean(match.mat_name || bracket.mats), startsAt: match.estimated_start || '',
    finish: clean(match.wonBy), clock: clean(match.time_passed || match.timePassed),
    seats: (Array.isArray(match.seats) ? match.seats : []).map(seat => ({
      label: clean(seat.name) || (seat.type === 'bye' ? 'Bye' : 'Awaiting opponent'),
      participant: participantFromSeat(seat, summary.name, base), winner: seat.isWinner === true
    }))
  })) };
}

// Public participant tables only. Ignore birthdays, payments and non-public fields.
export function parsePublicParticipants(html, base) {
  const $ = load(html), participants = new Map();
  let recognized = false;
  $('table').each((_, node) => {
    const table = $(node);
    const headers = table.find('thead th').map((_, th) => clean($(th).text()).toLowerCase()).get();
    if (!headers.some(header => /athlete|competitor|name/.test(header))) return;
    recognized = true;
    const column = pattern => headers.findIndex(header => pattern.test(header));
    table.find('tbody tr').each((_, row) => {
      const cells = $(row).children('td');
      const nameCell = cells.eq(column(/athlete|competitor|name/));
      const profile = nameCell.find('a[href*="/profile/"]').first();
      const name = clean(profile.text() || nameCell.text());
      const divisionIndex = column(/bracket|division|category/);
      const division = divisionIndex >= 0 ? clean(cells.eq(divisionIndex).text()) : '';
      const profileUrl = link(profile.attr('href'), base);
      if (!name || placeholder(name)) return;
      const sourceId = String($(row).attr('data-registration-id') || profileUrl || `${name}:${division}`);
      const academyIndex = column(/academy|club|affiliation/);
      participants.set(`${sourceId}:${division}`, { sourceId, name, division,
        academy: academyIndex >= 0 ? clean(cells.eq(academyIndex).text()) : '',
        country: column(/country|nationality/) >= 0 ? clean(cells.eq(column(/country|nationality/)).text()) : '', sourceUrl: profileUrl,
        imageUrl: link(nameCell.find('img').attr('src'), base) });
    });
  });
  if (!recognized) throw new Error('Public athlete list is unavailable or uses an unsupported layout.');
  return [...participants.values()];
}
