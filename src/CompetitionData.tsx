import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Search, Trophy, UsersRound, GitBranch, CalendarDays, RefreshCw } from 'lucide-react';
import type { Event, EventParticipant, CompetitionBracket, Match, Competitor, PublishedBout } from './types';
import { formatDateTime } from './market';

type Props = { event: Event; matches: Match[]; competitors: Competitor[]; busy: boolean; notice: string;
  onLoad: (offset?: number, all?: boolean) => Promise<void> };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function CompetitionData({ event, matches, competitors, busy, notice, onLoad }: Props) {
  const [tab, setTab] = useState<'athletes' | 'brackets' | 'schedule' | 'results'>('brackets');
  const [query, setQuery] = useState('');
  const [division, setDivision] = useState('');
  const brackets = useMemo(() => {
    if (event.brackets?.length) return event.brackets;
    // Keep previously imported bouts visible while a fresh full-draw request is unavailable.
    const groups = new Map<string, CompetitionBracket>();
    for (const match of matches) {
      const id = match.sourceBracketId || match.division;
      const bracket = groups.get(id) || { sourceId: id, name: match.division, registrations: 0,
        mat: match.mat, startsAt: match.scheduledAt, sourceUrl: match.sourceUrl || event.sourceUrl, loaded: true, bouts: [] };
      const seats = [match.competitorAId, match.competitorBId].map(id => {
        const player = competitors.find(player => player.id === id);
        return { label: player?.name || 'Athlete not loaded', winner: match.winnerId === id,
          participant: player ? { ...player, sourceId: player.sourceId || player.id, division: match.division } : null };
      });
      bracket.bouts!.push({ sourceId: match.sourceMatchId || match.id, number: '', round: match.round,
        roundOrder: /final/i.test(match.round) ? /semi/i.test(match.round) ? 3 : /quarter/i.test(match.round) ? 2 : 4 : 1,
        state: match.status, mat: match.mat, startsAt: match.scheduledAt, finish: match.finish || '', clock: match.liveClock || '', score: match.score, seats });
      bracket.registrations = new Set(bracket.bouts!.flatMap(bout => bout.seats.map(seat => seat.participant?.sourceId).filter(Boolean))).size;
      groups.set(id, bracket);
    }
    return [...groups.values()];
  }, [event.brackets, matches, competitors, event.sourceUrl]);
  const loaded = brackets.filter(bracket => bracket.loaded).length;
  useEffect(() => { if (!event.brackets?.length && !busy) void onLoad(0); }, [event.id]);
  const athletes = useMemo(() => {
    const found = new Map<string, EventParticipant>();
    const add = (player: EventParticipant) => {
      const key = `${normalize(player.name)}:${normalize(player.academy || '')}:${player.division}`;
      found.set(key, { ...found.get(key), ...player });
    };
    for (const match of matches) for (const id of [match.competitorAId, match.competitorBId]) {
      const player = competitors.find(player => player.id === id);
      if (player) add({ ...player, sourceId: player.sourceId || player.id, division: match.division });
    }
    for (const player of event.participants || []) add(player);
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [event.participants, matches, competitors]);
  const names = new Set(athletes.map(player => `${normalize(player.name)}:${normalize(player.academy || '')}`));
  const divisions = [...new Set([...brackets.map(bracket => bracket.name), ...athletes.map(player => player.division)])].sort();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const filteredAthletes = athletes.filter(player => (!division || player.division === division) &&
    terms.every(term => normalize(`${player.name} ${player.academy} ${player.country} ${player.division}`).includes(term)));
  const selectedBracket = brackets.find(bracket => bracket.name === division) || brackets[0];
  const currentDraw = selectedBracket?.bouts || [];
  const rounds = [...new Set(currentDraw.map(bout => bout.round))].sort((a, b) =>
    (currentDraw.find(bout => bout.round === a)?.roundOrder || 0) - (currentDraw.find(bout => bout.round === b)?.roundOrder || 0));
  const allBouts = brackets.flatMap(bracket => (bracket.bouts || []).map(bout => ({ ...bout, division: bracket.name, sourceUrl: bracket.sourceUrl })));
  const rows = allBouts.filter(bout => (!division || bout.division === division) && (tab !== 'results' || bout.seats.some(seat => seat.winner)))
    .sort((a, b) => (Date.parse(a.startsAt) || Infinity) - (Date.parse(b.startsAt) || Infinity));
  const nextOffset = brackets.findIndex(bracket => !bracket.loaded);
  return <section className="competition-data" aria-label="Athletes and official brackets">
    <div className="competition-data-heading"><div><span className="eyebrow">{event.source === 'ajp' ? 'AJP Tour' : 'Smoothcomp'} competition data</span><h3>Athletes, draws & results</h3><p>{names.size} athletes in loaded data · {loaded} of {brackets.length || event.coverage?.totalBrackets || 0} divisions loaded</p></div>
      <div className="empty-actions"><button className="ghost-button" disabled={busy} onClick={() => void onLoad(0)}><RefreshCw size={15}/>Refresh data</button><button className="primary-button" disabled={busy} onClick={() => void onLoad(Math.max(0, nextOffset), true)}>{busy ? 'Loading competition…' : loaded && nextOffset < 0 ? 'Refresh all divisions' : 'Load all divisions'}</button></div></div>
    {!event.brackets?.length && matches.length > 0 && <p className="competition-data-notice">Showing stored matchups. Refresh data for the complete published draw.</p>}
    <div className="competition-data-tabs" role="tablist" aria-label="Competition data views">{([
      ['athletes', 'Athletes', UsersRound], ['brackets', 'Brackets', GitBranch], ['schedule', 'Schedule', CalendarDays], ['results', 'Results', Trophy]
    ] as const).map(([id, label, Icon]) => <button type="button" role="tab" id={`competition-tab-${id}`} aria-controls="competition-data-content" aria-selected={tab === id} key={id} onClick={() => setTab(id)}><Icon size={16}/>{label}</button>)}</div>
    {notice && <p className="competition-data-notice" role="status">{notice}</p>}
    <div className="competition-data-filters"><label>Division<select aria-label="Competition division" value={division} onChange={e => setDivision(e.target.value)}><option value="">{tab === 'brackets' ? 'First published division' : 'All divisions'}</option>{divisions.map(name => <option key={name}>{name}</option>)}</select></label>
      {tab === 'athletes' && <label>Find an athlete<div className="competition-search-input"><Search size={16}/><input type="search" aria-label="Search competition athletes" placeholder="Name, academy or country" value={query} onChange={e => setQuery(e.target.value)}/></div></label>}
      <a href={`${event.sourceUrl.replace(/\/$/, '')}/${tab === 'athletes' ? 'participants' : tab === 'results' ? 'results' : 'schedule'}`} target="_blank" rel="noreferrer">View on {event.source === 'ajp' ? 'AJP' : 'Smoothcomp'}<ExternalLink size={13}/></a></div>
    <div id="competition-data-content" role="tabpanel" aria-labelledby={`competition-tab-${tab}`}>
    {tab === 'athletes' && <><p className="small-note">{filteredAthletes.length} division registrations shown. {event.participantsStatus === 'published' ? 'Public athlete list and published draws.' : 'Athletes from loaded brackets and matches; the complete registration list may be unavailable.'}</p>
      <div className="competition-athletes">{filteredAthletes.map(player => <article className="competition-athlete" key={`${player.sourceId}:${player.division}`}>
        {player.imageUrl ? <img src={player.imageUrl} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }}/> : <span className="athlete-initials">{player.name.split(' ').map(part => part[0]).slice(0, 2).join('')}</span>}
        <div><strong>{player.name}</strong><span>{[player.academy, player.country].filter(Boolean).join(' · ') || 'Academy not listed'}</span><small>{player.division || 'Division not listed'}</small>{player.sourceUrl && <a href={player.sourceUrl} target="_blank" rel="noreferrer">Athlete profile <ExternalLink size={12}/></a>}</div></article>)}</div>
      {!filteredAthletes.length && <p className="competition-data-empty">{query ? 'No athletes match this search.' : busy ? 'Loading published athletes…' : 'No athletes loaded yet. Refresh data or open the source athlete list.'}</p>}</>}
    {tab === 'brackets' && (selectedBracket ? <><div className="published-draw-heading"><div><h4>{selectedBracket.name}</h4><span>{selectedBracket.registrations} registrations · {selectedBracket.mat || 'Mat TBA'} · {formatDateTime(selectedBracket.startsAt)}</span></div><a href={selectedBracket.sourceUrl} target="_blank" rel="noreferrer">Source bracket <ExternalLink size={13}/></a><button className="ghost-button" disabled={busy} onClick={() => void onLoad(event.brackets?.length ? brackets.indexOf(selectedBracket) : 0)}>{selectedBracket.loaded ? 'Refresh this division' : 'Load this division'}</button></div>
      {selectedBracket.loaded ? <div className="published-draw" aria-label={`Bracket for ${selectedBracket.name}`}>{rounds.map(round => <section className="published-round" key={round}><h5>{round}</h5>{currentDraw.filter(bout => bout.round === round).map(bout => <DrawBout key={bout.sourceId} bout={bout}/>)}</section>)}</div> : <p className="competition-data-empty">This division is published. Load it to see the full draw, including byes and advancement slots.</p>}
      {selectedBracket.loaded && !currentDraw.length && <p className="competition-data-empty">No bouts published in this division yet.</p>}</> : <p className="competition-data-empty">{busy ? 'Loading the bracket catalog…' : 'No bracket catalog loaded. Refresh data to check published draws.'}</p>)}
    {(tab === 'schedule' || tab === 'results') && <div className="competition-schedule">{rows.map(bout => <article key={`${bout.division}:${bout.sourceId}`}><div><strong>{bout.division}</strong><span>{bout.round} · {bout.mat || 'Mat TBA'} · {formatDateTime(bout.startsAt)}</span></div><DrawBout bout={bout}/></article>)}{!rows.length && <p className="competition-data-empty">{tab === 'results' ? 'No winners reported in the loaded divisions.' : 'Load divisions to see their published schedule.'}</p>}</div>}
    </div>
    {event.warnings?.length ? <details className="coverage-note"><summary>Data availability ({event.warnings.length})</summary>{event.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details> : null}
  </section>;
}
function DrawBout({ bout }: { bout: PublishedBout }) {
  return <article className="published-bout"><header><span>{bout.number ? `Match ${bout.number}` : 'Match'}</span><span>{bout.seats.some(seat => seat.winner) ? 'Result' : /live|running|started/.test(bout.state) ? 'Live' : 'Scheduled'}</span></header>
    {bout.seats.map((seat, index) => { const score = index === 0 ? bout.score?.left : bout.score?.right;
      return <div className={`published-seat ${seat.winner ? 'winner' : ''} ${!seat.participant ? 'pending' : ''}`} key={index}><div><strong>{seat.label}</strong>{seat.participant?.academy && <small>{seat.participant.academy}</small>}</div>{seat.winner && <Trophy size={14} aria-label="Winner"/>}{score?.points != null && <b>{score.points}</b>}{(score?.advantages != null || score?.penalties != null) && <small>A {score?.advantages ?? '—'} · P {score?.penalties ?? '—'}</small>}</div>; })}
    {!bout.seats.length && <div className="published-seat pending">Awaiting opponents</div>}
    <footer>{[bout.mat, bout.finish, bout.clock].filter(Boolean).join(' · ') || 'Time and result pending'}</footer></article>;
}
