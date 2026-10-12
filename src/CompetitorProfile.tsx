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
function identityUrl(value?: string) {
  const url = profileUrl(value);
  if (!url) return undefined;
  const parsed = new URL(url);
  const id = parsed.pathname.match(/^\/(?:[a-z]{2}\/)?profile\/(\d+)\/?$/)?.[1];
  return id && (parsed.hostname === 'smoothcomp.com' || parsed.hostname.endsWith('.smoothcomp.com')) ? `smoothcomp:${id}` : id ? `${parsed.hostname}:profile:${id}` : undefined;
}
function sameAthlete(a: Athlete, b: Athlete) {
  if (a.id && b.id && a.id === b.id) return true;
  const left = identityUrl(a.sourceUrl), right = identityUrl(b.sourceUrl);
  if (left && right) return left === right;
  return Boolean(a.sourceId && /^\d+$/.test(a.sourceId) && b.sourceId && a.sourceId === b.sourceId && a.name === b.name);
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
function ProfileDialog({ athlete, competitors, matches, events, onClose }: { athlete: Athlete; competitors: Competitor[]; matches: Match[]; events: Event[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const related = competitors.filter(player => sameAthlete(athlete, player));
  const player = { ...related[0], ...athlete };
  const ids = new Set(related.map(item => item.id));
  if (athlete.id) ids.add(athlete.id);
  const history = matches.filter(match => match.sourceState !== 'withdrawn' && (ids.has(match.competitorAId) || ids.has(match.competitorBId)))
    .sort((a, b) => (Date.parse(b.scheduledAt) || 0) - (Date.parse(a.scheduledAt) || 0));
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
  const wins = history.filter(match => match.winnerId && ids.has(match.winnerId)).length;
  const losses = history.filter(match => match.winnerId && !ids.has(match.winnerId)).length;
  return <dialog ref={dialog} className="athlete-profile-dialog" aria-labelledby="athlete-profile-title" onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <article className="athlete-profile-content">
      <button type="button" className="ghost-button profile-close" onClick={onClose} autoFocus>Close profile ×</button>
      <header className="athlete-profile-header"><CompetitorPortrait competitor={player}/><div><span className="eyebrow">Competitor profile</span><h2 id="athlete-profile-title">{player.name}</h2><p>{player.academy || 'Academy not listed'}</p></div></header>
      <dl className="athlete-profile-facts"><div><dt>Country</dt><dd>{player.country || 'Not listed'}</dd></div><div><dt>Belt in imported division</dt><dd>{player.belt && player.belt !== 'unknown' ? player.belt : 'Not listed'}</dd></div><div><dt>Recorded wins</dt><dd>{wins}</dd></div><div><dt>Recorded losses</dt><dd>{losses}</dd></div></dl>
      <p className="small-note">Information comes from imported competition records, including Smoothcomp. Results below cover loaded matches only, not a career record.</p>
      {source ? <a className="ghost-button" href={source} target="_blank" rel="noreferrer">Open official athlete profile ↗</a> : <p className="small-note">An official profile link has not been published in the loaded records.</p>}
      {divisions.length > 0 && <section><h3>Divisions</h3><ul>{divisions.map(division => <li key={division}>{division}</li>)}</ul></section>}
      <section><h3>Match history <span>({history.length})</span></h3>{history.length ? <ul className="athlete-profile-history">{history.map(match => {
        const opponent = competitors.find(item => item.id === (ids.has(match.competitorAId) ? match.competitorBId : match.competitorAId));
        const event = events.find(item => item.id === match.eventId);
        const outcome = match.winnerId ? ids.has(match.winnerId) ? 'Win' : 'Loss' : match.status === 'live' ? 'Live' : match.status === 'settled' || (Date.parse(match.scheduledAt) || Infinity) < Date.now() ? 'Result unavailable' : 'Scheduled';
        return <li key={match.id}><div><strong>vs {opponent?.name || 'Opponent not listed'}</strong><small>{event?.name || 'Competition'} · {match.round}</small><small>{Number.isFinite(Date.parse(match.scheduledAt)) ? new Date(match.scheduledAt).toLocaleDateString() : 'Date not listed'}{match.finish ? ` · ${match.finish}` : ''}</small></div><b>{outcome}</b></li>;
      })}</ul> : <p>No matches loaded for this competitor. Load their competition’s brackets to add available results.</p>}</section>
      {registrations.length > 0 && <section><h3>Published registrations</h3><ul className="athlete-profile-history">{registrations.map(({ event, participant }) => <li key={`${event.id}:${participant.division}`}><div><strong>{event.name}</strong><small>{participant.division || 'Division not listed'}</small></div></li>)}</ul></section>}
    </article>
  </dialog>;
}
