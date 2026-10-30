import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CompetitorPortrait } from './CompetitorPortrait';
import type { Competitor, Event, EventParticipant, Match } from './types';

type Athlete = Pick<Competitor, 'name'> & Partial<Competitor> & { division?: string };
const ProfileContext = createContext<(athlete: Athlete) => void>(() => {});
function profileUrl(value?: string) {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
export function identityUrl(value?: string) {
  const url = profileUrl(value);
  if (!url) return undefined;
  const parsed = new URL(url);
  const id = parsed.pathname.match(/^\/(?:[a-z]{2}\/)?profile\/(\d+)\/?$/)?.[1];
  return id && (parsed.hostname === 'smoothcomp.com' || parsed.hostname.endsWith('.smoothcomp.com')) ? `smoothcomp:${id}` : id ? `${parsed.hostname}:profile:${id}` : undefined;
}
export function sameAthlete(a: Athlete, b: Athlete) {
  if (a.id && b.id && a.id === b.id) return true;
  const left = identityUrl(a.sourceUrl), right = identityUrl(b.sourceUrl);
  if (left && right) return left === right;
  if (profileUrl(a.sourceUrl) && profileUrl(a.sourceUrl) === profileUrl(b.sourceUrl) && a.name === b.name) return true;
  return Boolean(a.sourceId && b.sourceId && a.sourceId === b.sourceId && a.name === b.name);
}
export function CompetitorProfileLink({ competitor, children }: { competitor?: Athlete | null; children?: ReactNode }) {
  const open = useContext(ProfileContext);
  if (!competitor) return <>{children || 'Competitor TBA'}</>;
  return <button type="button" className="competitor-profile-link" aria-label={`View ${competitor.name}'s profile`} onClick={() => open(competitor)}>{children || competitor.name}</button>;
}
export function CompetitorProfiles({ competitors, matches, events, children }: { competitors: Competitor[]; matches: Match[]; events: Event[]; children: ReactNode }) {
  const [selected, setSelected] = useState<Athlete | null>(null);
  return <ProfileContext.Provider value={setSelected}>{children}{selected && <ProfileDialog athlete={selected} competitors={competitors} matches={matches} events={events} onClose={() => setSelected(null)}/>}</ProfileContext.Provider>;
}
export function ProfileDialog({ athlete, competitors, matches, events, onClose }: { athlete: Athlete; competitors: Competitor[]; matches: Match[]; events: Event[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const related = competitors.filter(player => sameAthlete(athlete, player));
  const player = { ...related[0], ...athlete };
  const history = profileHistory(athlete, competitors, matches, events);
  const registrations: Array<{ event: Event; participant: EventParticipant }> = [];
  for (const event of events) {
    const seen = new Set<string>();
    const participants = [...(event.participants || []), ...(event.brackets || []).flatMap(bracket => (bracket.bouts || []).flatMap(bout => bout.seats.flatMap(seat => seat.participant ? [seat.participant] : [])))];
    for (const participant of participants) if (sameAthlete(athlete, participant) && !seen.has(participant.division)) {
      registrations.push({ event, participant }); seen.add(participant.division);
    }
  }
  const divisions = [...new Set([player.division, ...history.map(match => match.division), ...registrations.map(row => row.participant.division)].filter(Boolean))];
  const source = profileUrl(player.sourceUrl);
  const wins = history.filter(match => match.outcome === 'Win').length;
  const losses = history.filter(match => match.outcome === 'Loss').length;
  return <dialog ref={dialog} className="athlete-profile-dialog" aria-labelledby="athlete-profile-title" onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <article className="athlete-profile-content">
      <button type="button" className="ghost-button profile-close" onClick={onClose} autoFocus>Close profile ×</button>
      <header className="athlete-profile-header"><CompetitorPortrait competitor={player}/><div><span className="eyebrow">Competitor profile</span><h2 id="athlete-profile-title">{player.name}</h2><p>{player.academy || 'Academy not listed'}</p></div></header>
      <dl className="athlete-profile-facts"><div><dt>Country</dt><dd><CountryFlag country={player.country}/></dd></div><div><dt>Belt in imported division</dt><dd>{player.belt && player.belt !== 'unknown' ? player.belt : 'Not listed'}</dd></div><div><dt>Recorded wins</dt><dd>{wins}</dd></div><div><dt>Recorded losses</dt><dd>{losses}</dd></div></dl>
      <p className="small-note">Information comes from imported competition records, including Smoothcomp. Results below cover loaded matches only, not a career record.</p>
      {source ? <a className="ghost-button" href={source} target="_blank" rel="noreferrer">Open official athlete profile ↗</a> : <p className="small-note">An official profile link has not been published in the loaded records.</p>}
      {divisions.length > 0 && <section><h3>Divisions</h3><ul>{divisions.map(division => <li key={division}>{division}</li>)}</ul></section>}
      <section><h3>Match history <span>({history.length})</span></h3>{history.length ? <ul className="athlete-profile-history">{history.map(match => {
        return <li key={match.id}><div><strong>vs {match.opponent || 'Opponent not listed'}</strong><small>{match.eventName} · {match.round}</small><small>{Number.isFinite(Date.parse(match.scheduledAt)) ? new Date(match.scheduledAt).toLocaleDateString() : 'Date not listed'}{match.finish ? ` · ${match.finish}` : ''}</small><small>{match.division}{match.score ? ` · ${match.score}` : ''}</small></div><b>{match.outcome}</b></li>;
      })}</ul> : <p>No matches loaded for this competitor. Load their competition’s brackets to add available results.</p>}</section>
      {registrations.length > 0 && <section><h3>Published registrations</h3><ul className="athlete-profile-history">{registrations.map(({ event, participant }) => <li key={`${event.id}:${participant.division}`}><div><strong>{event.name}</strong><small>{participant.division || 'Division not listed'}</small></div></li>)}</ul></section>}
    </article>
  </dialog>;
}

export function CountryFlag({ country }: { country?: string }) {
  const code = country?.trim().toUpperCase();
  const flag = code && /^[A-Z]{2}$/.test(code)
    ? [...code].map(char => String.fromCodePoint(127397 + char.charCodeAt(0))).join('') : undefined;
  return flag ? <span role="img" aria-label={code} title={code}>{flag}</span> : <>{country || 'Not listed'}</>;
}

type HistoryRow = { id: string; eventName: string; opponent: string; division: string; round: string;
  scheduledAt: string; finish?: string; score?: string; outcome: string };
export function profileHistory(athlete: Athlete, competitors: Competitor[], matches: Match[], events: Event[]): HistoryRow[] {
  const players = new Map(competitors.map(player => [player.id, player]));
  const ids = new Set(competitors.filter(player => sameAthlete(athlete, player)).map(player => player.id));
  if (athlete.id) ids.add(athlete.id);
  const rows = new Map<string, HistoryRow>();
  const key = (eventId: string, bracket: string, bout: string) => JSON.stringify([eventId, bracket, bout]);
  const outcome = (won: boolean, lost: boolean, state: string, date: string) => won ? 'Win' : lost ? 'Loss' : state === 'live' ? 'Live' :
    ['settled', 'finished', 'complete', 'completed'].includes(state) || (Date.parse(date) || Infinity) < Date.now() ? 'Result unavailable' : 'Scheduled';
  const scoreText = (left?: number | null, right?: number | null) => left != null && right != null ? `${left} – ${right}` : undefined;
  const withdrawn = new Set(matches.filter(match => match.sourceState === 'withdrawn').map(match => key(match.eventId, match.sourceBracketId || match.division, match.sourceMatchId || match.id)));
  for (const event of events) for (const bracket of event.brackets || []) for (const bout of bracket.bouts || []) {
    const index = bout.seats.findIndex(seat => seat.participant && sameAthlete(athlete, seat.participant));
    const id = key(event.id, bracket.sourceId, bout.sourceId);
    if (index < 0 || bout.state === 'withdrawn' || withdrawn.has(id) || bout.seats.filter(seat => seat.participant).length !== 2) continue;
    const date = bout.startsAt || event.startsAt;
    rows.set(id, { id, eventName: event.name, opponent: bout.seats[1 - index].participant!.name,
      division: bracket.name, round: bout.round, scheduledAt: date, finish: bout.finish,
      score: scoreText(index === 0 ? bout.score?.left?.points : bout.score?.right?.points, index === 0 ? bout.score?.right?.points : bout.score?.left?.points),
      outcome: outcome(bout.seats[index].winner, bout.seats[1 - index].winner, bout.state, date) });
  }
  for (const match of matches) {
    if (match.sourceState === 'withdrawn' || (!ids.has(match.competitorAId) && !ids.has(match.competitorBId))) continue;
    const left = ids.has(match.competitorAId);
    const event = events.find(event => event.id === match.eventId);
    const id = key(match.eventId, match.sourceBracketId || match.division, match.sourceMatchId || match.id);
    const previous = rows.get(id);
    const date = match.scheduledAt || previous?.scheduledAt || event?.startsAt || '';
    rows.set(id, { id, eventName: event?.name || 'Competition', opponent: players.get(left ? match.competitorBId : match.competitorAId)?.name || previous?.opponent || '',
      division: match.division, round: match.round, scheduledAt: date, finish: match.finish || previous?.finish,
      score: scoreText(left ? match.score?.left?.points : match.score?.right?.points, left ? match.score?.right?.points : match.score?.left?.points) || previous?.score,
      outcome: match.winnerId ? outcome(ids.has(match.winnerId), !ids.has(match.winnerId), match.status, date) : previous?.outcome || outcome(false, false, match.status, date) });
  }
  return [...rows.values()].sort((a, b) => (Date.parse(b.scheduledAt) || 0) - (Date.parse(a.scheduledAt) || 0));
}
