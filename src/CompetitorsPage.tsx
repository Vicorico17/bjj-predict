import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CompetitorPortrait } from './CompetitorPortrait';
import { CompetitorProfileLink, identityUrl } from './CompetitorProfile';
import type { Competitor, Event, Match } from './types';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function CompetitorsPage({ competitors, events, matches, onCompetition }: {
  competitors: Competitor[]; events: Event[]; matches: Match[]; onCompetition: (event: Event) => void;
}) {
  const [query, setQuery] = useState('');
  const [eventId, setEventId] = useState('');
  const [limit, setLimit] = useState(48);
  const athletes = useMemo(() => {
    const rows = new Map(competitors.map(player => [player.id, { player, eventIds: new Set<string>() }]));
    for (const match of matches) {
      if (match.sourceState === 'withdrawn') continue;
      for (const id of [match.competitorAId, match.competitorBId]) rows.get(id)?.eventIds.add(match.eventId);
    }
    for (const event of events) {
      const entrants = [...(event.participants || []), ...(event.brackets || []).flatMap(bracket => (bracket.bouts || []).flatMap(bout => bout.seats.flatMap(seat => seat.participant ? [seat.participant] : [])))];
      for (const entrant of entrants) {
        const id = `c-${event.source}-${entrant.sourceId}`;
        const row = rows.get(id) || { player: { ...entrant, id, belt: 'unknown' as const, seed: 0, record: 'Record not listed' }, eventIds: new Set<string>() };
        row.eventIds.add(event.id); rows.set(id, row);
      }
    }
    const identities = new Map<string, { player: Competitor; eventIds: Set<string> }>();
    for (const row of rows.values()) {
      if (!row.eventIds.size) continue;
      const key = identityUrl(row.player.sourceUrl) || row.player.id;
      const existing = identities.get(key);
      if (existing) {
        for (const id of row.eventIds) existing.eventIds.add(id);
        if (!existing.player.imageUrl && row.player.imageUrl) existing.player = row.player;
      } else identities.set(key, row);
    }
    return [...identities.values()].sort((a, b) => Number(Boolean(b.player.imageUrl)) - Number(Boolean(a.player.imageUrl)) || a.player.name.localeCompare(b.player.name));
  }, [competitors, events, matches]);
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const filtered = athletes.filter(({ player, eventIds }) => (!eventId || eventIds.has(eventId)) && terms.every(term => normalize(`${player.name} ${player.academy} ${player.country}`).includes(term)));
  const availableEvents = events.filter(event => athletes.some(row => row.eventIds.has(event.id))).sort((a,b) => a.name.localeCompare(b.name));
  return <section className="competitors-page" aria-labelledby="competitors-title">
    <header className="section-heading"><div><span className="eyebrow">Know the athletes</span><h2 id="competitors-title">Competitors</h2><p>Explore athletes, open their profiles, and find their matchups.</p></div><strong>{athletes.length} athletes</strong></header>
    <div className="athlete-directory-filters">
      <label>Search competitors<div className="competition-search-input"><Search size={18}/><input type="search" value={query} placeholder="Name, academy or country" onChange={e => { setQuery(e.target.value); setLimit(48); }}/></div></label>
      <label>Competition<select value={eventId} onChange={e => { setEventId(e.target.value); setLimit(48); }}><option value="">All loaded competitions</option>{availableEvents.map(event => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label>
    </div>
    <p className="small-note" role="status">{filtered.length} competitors found · Includes past and upcoming events. Photos appear when available from the source.</p>
    <div className="athlete-directory-grid">{filtered.slice(0, limit).map(({ player, eventIds }) => <article className="athlete-directory-card" key={player.id}>
      <CompetitorProfileLink competitor={player}><CompetitorPortrait competitor={player}/></CompetitorProfileLink>
      <h3><CompetitorProfileLink competitor={player}/></h3><p>{player.academy || 'Academy not listed'}</p><span className="small-note">{player.country || 'Country not listed'}{player.belt !== 'unknown' ? ` · ${player.belt} belt` : ''}</span>
      <div className="athlete-event-links">{[...eventIds].map(id => { const event = events.find(item => item.id === id); return event ? <button className="text-button" key={id} onClick={() => onCompetition(event)}>{event.name} ↗</button> : null; })}</div>
      <CompetitorProfileLink competitor={player}>View profile →</CompetitorProfileLink>
    </article>)}</div>
    {!filtered.length && <div className="panel"><h3>No competitors found</h3><p>Try another search, or open an event listing and load its published athletes and brackets.</p><button className="ghost-button" onClick={() => { setQuery(''); setEventId(''); }}>Clear filters</button></div>}
    {filtered.length > limit && <button className="ghost-button" onClick={() => setLimit(value => value + 48)}>Show more competitors</button>}
  </section>;
}
