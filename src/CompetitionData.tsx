import { CompetitorProfileLink } from "./CompetitorProfile";
import { PickButtons } from "./Predictions";
import { TournamentBracket } from "./TournamentBracket";
import { CompetitorPortrait } from "./CompetitorPortrait";
import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Search, Trophy, UsersRound, GitBranch, CalendarDays, RefreshCw } from 'lucide-react';
import type { Event, EventParticipant, CompetitionBracket, Match, Competitor, PublishedBout } from './types';
import { formatDateTime } from './market';
import { WinnerBadge } from './WinnerBadge';

type Props = { event: Event; matches: Match[]; competitors: Competitor[]; busy: boolean; notice: string;
  onLoad: (offset?: number, all?: boolean, participants?: boolean) => Promise<void> };
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function CompetitionData({ event, matches, competitors, busy, notice, onLoad }: Props) {
  const platform = event.source === 'smoothcomp' || event.source === 'ajp';
  const sourceName = event.source === 'ajp' ? 'AJP Tour' : platform ? 'Smoothcomp' : 'Published card';
  const [tab, setTab] = useState<'athletes' | 'brackets' | 'games' | 'results'>(() => typeof window !== 'undefined' && window.location.hash === '#/app/brackets' ? 'brackets' : 'games');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [division, setDivision] = useState('');
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => setVisibleCount(50), [division, query, status, tab]);
  const competitorMap = useMemo(() => new Map(competitors.map(player => [player.id, player])), [competitors]);
  const brackets = useMemo(() => {

    // Keep previously imported bouts visible while a fresh full-draw request is unavailable.
    const groups = new Map<string, CompetitionBracket>((event.brackets || []).map(bracket => [bracket.sourceId, { ...bracket, bouts: (bracket.bouts || []).map(bout => ({ ...bout })) }]));
    for (const match of matches) {
      if (match.sourceState === "withdrawn") continue;
      const id = match.sourceBracketId || match.division;
      const bracket = groups.get(id) || { sourceId: id, name: match.division, registrations: 0,
        mat: match.mat, startsAt: match.scheduledAt, sourceUrl: match.sourceUrl || event.sourceUrl, loaded: true, bouts: [] };
      const published = bracket.bouts?.find(bout => bout.sourceId === (match.sourceMatchId || match.id));
      if (published) {
        if (match.winnerId || match.status === 'live' || match.status === 'settled') {
          Object.assign(published, { observedAt: match.sourceObservedAt, state: match.status, score: match.score, finish: match.finish || '', clock: match.liveClock || '', seats: published.seats.map(seat => ({ ...seat, winner: Boolean(match.winnerId && competitorMap.get(match.winnerId || "")?.sourceId === seat.participant?.sourceId) })) });
        }
        continue;
      }
      if (bracket.bouts?.some(bout => bout.sourceId === (match.sourceMatchId || match.id))) continue;
      const seats = [match.competitorAId, match.competitorBId].map(id => {
        const player = competitorMap.get(id);
        return { label: player?.name || 'Athlete not loaded', winner: Boolean(match.winnerId && match.winnerId === id),
          participant: player ? { ...player, sourceId: player.sourceId || player.id, division: match.division } : null };
      });
      bracket.bouts!.push({ sourceId: match.sourceMatchId || match.id, number: '', round: match.round,
        roundOrder: /final/i.test(match.round) ? /semi/i.test(match.round) ? 3 : /quarter/i.test(match.round) ? 2 : 4 : 1,
        observedAt: match.sourceObservedAt, state: match.status, mat: match.mat, startsAt: match.scheduledAt, finish: match.finish || '', clock: match.liveClock || '', score: match.score, seats });
      bracket.registrations = new Set(bracket.bouts!.flatMap(bout => bout.seats.map(seat => seat.participant?.sourceId).filter(Boolean))).size;
      groups.set(id, bracket);
    }
    return [...groups.values()];
  }, [event.brackets, matches, competitors, event.sourceUrl]);
  const loaded = brackets.filter(bracket => bracket.loaded).length;

  const athletes = useMemo(() => {
    const found = new Map<string, EventParticipant>();
    const add = (player: EventParticipant) => {
      const key = `${player.sourceId}:${player.division}`;
      found.set(key, { ...found.get(key), ...player });
    };
    for (const match of matches.filter(match => match.sourceState !== "withdrawn")) for (const id of [match.competitorAId, match.competitorBId]) {
      const player = competitorMap.get(id);
      if (player) add({ ...player, sourceId: player.sourceId || player.id, division: event.brackets?.find(bracket => bracket.sourceId === match.sourceBracketId)?.name || match.division });
    }
    for (const player of event.participants || []) add(player);
    return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [event.participants, matches, competitors]);
  const names = new Set(athletes.map(player => player.sourceId));
  const divisions = [...new Set([...brackets.map(bracket => bracket.name), ...athletes.map(player => player.division)])].sort();
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const filteredAthletes = athletes.filter(player => (!division || player.division === division) &&
    terms.every(term => normalize(`${player.name} ${player.academy} ${player.country} ${player.division}`).includes(term)));
  const selectedBracket = brackets.find(bracket => bracket.name === division) || brackets[0];
  const currentDraw = selectedBracket?.bouts || [];
  const allBouts = brackets.flatMap(bracket => (bracket.bouts || []).map(bout => ({ ...bout, division: bracket.name, sourceUrl: bracket.sourceUrl })));
  const games = allBouts.filter(bout => bout.seats.filter(seat => seat.participant).length === 2 || bout.state === "awaiting-opponents");
  const matchingGames = games.filter(bout => (!division || bout.division === division) &&
    terms.every(term => normalize(`${bout.division} ${bout.seats.map(seat => `${seat.label} ${seat.participant?.academy || ''} ${seat.participant?.country || ''}`).join(' ')}`).includes(term)));
  const rows = matchingGames.filter(bout => tab === 'results' ? bout.seats.some(seat => seat.winner) : status === 'all' || gameStatus(bout) === status)
    .sort((a, b) => {
      const rank = { live: 0, upcoming: 1, finished: 2, unreported: 3 };
      return rank[gameStatus(a)] - rank[gameStatus(b)] ||
        (gameStatus(a) === 'finished' ? -1 : 1) * ((Date.parse(a.startsAt) || 0) - (Date.parse(b.startsAt) || 0));
    });
  const nextOffset = brackets.findIndex(bracket => !bracket.loaded);
  return <section className="competition-data" aria-label="Competition games, athletes and brackets">
    <div className="competition-data-heading"><div><span className="eyebrow">{sourceName}</span><h3>Games & results</h3><p>{games.length} games · {names.size} athletes · {loaded} of {brackets.length || event.coverage?.totalBrackets || 0} divisions loaded</p></div>
      <div className="empty-actions"><button className="ghost-button" disabled={busy} onClick={() => void onLoad(0)}><RefreshCw size={15}/>Refresh data</button>{platform && <button className="primary-button" disabled={busy} onClick={() => void onLoad(Math.max(0, nextOffset), true)}>{busy ? 'Loading…' : 'Load all divisions'}</button>}</div></div>
    {!platform && <p className="competition-data-notice">Event starts {formatDateTime(event.startsAt)}. Individual bout times are TBA. Future rounds show which winners advance.</p>}
    {!event.brackets?.length && matches.length > 0 && <p className="competition-data-notice">Showing stored matchups. Refresh data for the complete published draw.</p>}
    <div className="competition-data-tabs" role="tablist" aria-label="Competition data views">{([
      ['games', 'Games', CalendarDays], ['results', 'Results', Trophy], ['brackets', 'Brackets', GitBranch], ['athletes', 'Athletes', UsersRound]
    ] as const).map(([id, label, Icon]) => <button type="button" role="tab" id={`competition-tab-${id}`} aria-controls="competition-data-content" aria-selected={tab === id} key={id} onClick={() => setTab(id)}><Icon size={16}/>{label}</button>)}</div>
    {platform && <p className="competition-data-notice">Scores refresh every 15 seconds for the last opened divisions during the event. Last checked: {formatDateTime(event.lastSyncedAt)}. {Date.now() - Date.parse(event.lastSyncedAt) > 45000 ? 'Saved data — scores may be delayed.' : 'Scores are shown only when published by the source.'}</p>}
    {platform && nextOffset >= 0 && <div className="load-more-divisions"><button className="ghost-button" disabled={busy} onClick={() => void onLoad(nextOffset)}>Load next 3 divisions</button><span>{loaded} / {brackets.length} loaded · choose a division to jump directly to it</span></div>}
    {notice && <p className="competition-data-notice" role="status">{notice}</p>}
    <div className="competition-data-filters"><label>Division<select aria-label="Competition division" value={division} onChange={e => {
        const name = e.target.value; setDivision(name);
        const index = event.brackets?.findIndex(bracket => bracket.name === name) ?? -1;
        if (platform && index >= 0) void onLoad(index);
      }}><option value="">{tab === 'brackets' ? 'First published division' : 'All divisions'}</option>{divisions.map(name => <option key={name}>{name}</option>)}</select></label>
      {tab !== 'brackets' && <label>Search {tab === 'athletes' ? 'athletes' : 'games'}<div className="competition-search-input"><Search size={16}/><input type="search" aria-label="Search competition games and athletes" placeholder="Athlete, academy, country or division" value={query} onChange={e => setQuery(e.target.value)}/></div></label>}
      <a href={platform ? `${event.sourceUrl.replace(/\/$/, '')}/${tab === 'athletes' ? 'participants' : tab === 'results' ? 'results' : 'schedule'}` : event.officialUrl || event.sourceUrl} target="_blank" rel="noreferrer">View {platform ? sourceName : "event source"}<ExternalLink size={13}/></a></div>
    <div id="competition-data-content" role="tabpanel" aria-labelledby={`competition-tab-${tab}`}>
    {tab === 'athletes' && <>{platform && <button className="ghost-button" disabled={busy} onClick={() => void onLoad(0, false, true)}>Load public athlete list</button>}<p className="small-note">{filteredAthletes.length} division registrations shown. {event.participantsStatus === 'published' ? 'Public athlete list and published draws.' : 'Athletes from loaded brackets and matches; the complete registration list may be unavailable.'}</p>
      <div className="competition-athletes">{filteredAthletes.slice(0, visibleCount).map(player => <article className="competition-athlete" key={`${player.sourceId}:${player.division}`}>
        <CompetitorPortrait competitor={player}/>
        <div><strong><CompetitorProfileLink competitor={player}/></strong><span>{[player.academy, player.country].filter(Boolean).join(' · ') || 'Academy not listed'}</span><small>{player.division || 'Division not listed'}</small><CompetitorProfileLink competitor={player}>View profile ↗</CompetitorProfileLink></div></article>)}</div>
      {!filteredAthletes.length && <p className="competition-data-empty">{query ? 'No athletes match this search.' : busy ? 'Loading published athletes…' : 'No athletes loaded yet. Refresh data or open the source athlete list.'}</p>}</>}
    {tab === 'brackets' && (selectedBracket ? <><div className="published-draw-heading"><div><h4>{selectedBracket.name}</h4><span>{selectedBracket.registrations} registrations · {selectedBracket.mat || 'Mat TBA'} · {formatDateTime(selectedBracket.startsAt)}</span></div><a href={selectedBracket.sourceUrl} target="_blank" rel="noreferrer">Source bracket <ExternalLink size={13}/></a><button className="ghost-button" disabled={busy} onClick={() => void onLoad(event.brackets?.length ? brackets.indexOf(selectedBracket) : 0)}>{selectedBracket.loaded ? 'Refresh this division' : 'Load this division'}</button></div>
      {selectedBracket.loaded ? <TournamentBracket bracket={selectedBracket} renderBout={bout => <DrawBout bout={bout} eventId={event.id}/>}/> : <p className="competition-data-empty">This division is published. Load it to see the full draw, including byes and advancement slots.</p>}
      {selectedBracket.loaded && !currentDraw.length && <p className="competition-data-empty">No bouts published in this division yet.</p>}</> : <p className="competition-data-empty">{busy ? 'Loading the bracket catalog…' : 'No bracket catalog loaded. Refresh data to check published draws.'}</p>)}
    {tab === 'games' && <div className="game-status-filters" role="group" aria-label="Filter games by status">{([
      ['all', 'All games'], ['live', 'Live'], ['upcoming', 'Upcoming'], ['finished', 'Finished'], ['unreported', 'Result pending']
    ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}<span>{matchingGames.filter(bout => value === 'all' || gameStatus(bout) === value).length}</span></button>)}</div>}
    {(tab === 'games' || tab === 'results') && <>
      <p className="small-note">{rows.length} {rows.length === 1 ? 'game' : 'games'} shown{loaded < brackets.length ? ' · More games may be available in unloaded divisions.' : '.'} {tab === 'results' && 'Ticks mark confirmed winners.'}</p>
      <div className="competition-games">{rows.slice(0, visibleCount).map(bout => <section className="competition-game" key={`${bout.division}:${bout.sourceId}`}>
        <div className="competition-game-heading"><strong>{bout.division}</strong><span>{bout.round || 'Round TBA'} · {bout.startsAt ? formatDateTime(bout.startsAt) : 'Time TBA'}</span></div>
        <DrawBout bout={bout} eventId={event.id}/>
        <a className="game-bracket-link" href={bout.sourceUrl} target="_blank" rel="noreferrer">View source bracket<ExternalLink size={12}/></a>
      </section>)}</div>
      {!rows.length && <div className="competition-data-empty"><strong>{busy ? 'Loading games…' : query || division || status !== 'all' ? 'No games match these filters.' : tab === 'results' ? 'No confirmed results yet.' : 'No games with both athletes loaded yet.'}</strong><p>{query || division || status !== 'all' ? 'Try another name or reset your filters.' : 'Load the published divisions to see matchups. Future opponents and byes appear in Brackets.'}</p>{(query || division || status !== 'all') && <button className="ghost-button" onClick={() => { setQuery(''); setDivision(''); setStatus('all'); }}>Reset filters</button>}</div>}
    </>}
    {((tab === 'athletes' ? filteredAthletes.length : tab === 'brackets' ? 0 : rows.length) > visibleCount) && <button className="ghost-button show-more-games" onClick={() => setVisibleCount(count => count + 50)}>Show 50 more</button>}
    </div>
    {event.warnings?.length ? <details className="coverage-note"><summary>Data availability ({event.warnings.length})</summary>{event.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details> : null}
  </section>;
}
export function gameStatus(bout: PublishedBout): 'live' | 'upcoming' | 'finished' | 'unreported' {
  if (bout.seats.some(seat => seat.winner) || /^(finished|completed|settled|ended|done)$/i.test(bout.state)) return 'finished';
  if (/^(live|running|started)$/i.test(bout.state)) {
    const age = Date.now() - Date.parse(bout.observedAt || '');
    return Number.isFinite(age) && age >= 0 && age < 45000 ? 'live' : 'unreported';
  }
  if (bout.startsAt && Date.parse(bout.startsAt) < Date.now()) return 'unreported';
  return 'upcoming';
}
function DrawBout({ bout, eventId }: { bout: PublishedBout; eventId: string }) {
  return <article className="published-bout"><header><span>{bout.number ? `Match ${bout.number}` : 'Match'}</span><span className={`game-state ${gameStatus(bout)}`}>{gameStatus(bout) === 'live' && Date.now() - Date.parse(bout.observedAt || '') > 45000 ? 'Live · update delayed' : bout.state === 'awaiting-opponents' ? 'Awaiting opponents' : { live: 'Live', upcoming: 'Upcoming', finished: 'Finished', unreported: 'Result pending' }[gameStatus(bout)]}</span></header>
    {bout.seats.map((seat, index) => { const score = index === 0 ? bout.score?.left : bout.score?.right;
      return <div className={`published-seat ${seat.winner ? 'winner' : ''} ${!seat.participant ? 'pending' : ''}`} key={index}><CompetitorPortrait competitor={seat.participant || undefined} compact/><div><strong className="athlete-name"><CompetitorProfileLink competitor={seat.participant}>{seat.label}</CompetitorProfileLink>{seat.winner && <WinnerBadge/>}</strong>{seat.participant?.academy && <small>{seat.participant.academy}</small>}</div>{score?.points != null && <b>{score.points}</b>}{(score?.advantages != null || score?.penalties != null) && <small>A {score?.advantages ?? '—'} · P {score?.penalties ?? '—'}</small>}</div>; })}
    {!bout.seats.length && <div className="published-seat pending">Awaiting opponents</div>}
    <footer>{[bout.mat, bout.finish, bout.clock].filter(Boolean).join(' · ') || 'Time and result pending'}</footer><PickButtons eventId={eventId} sourceMatchId={bout.sourceId}/></article>;
}
