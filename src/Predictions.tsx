import { createContext, useContext, useState, type ReactNode } from 'react';
import type { Competitor, Event, Match } from './types';

export type WinnerPick = { matchId: string; competitorId: string; opponents: string[]; pickedAt: string };
export function predictionClosed(match: Match, event?: Event, now = Date.now()) {
  if (match.winnerId || match.status === 'settled') return 'Result confirmed';
  if (match.sourceState === 'withdrawn' || /cancel|disqualif|finished|ended|^end$|completed/i.test(match.sourceState || '')) return 'Picks closed';
  if (match.status === 'live' || /started|running|ongoing|paused|current/i.test(match.sourceState || '')) return 'Match in progress · picks locked';
  if (event?.status === 'complete' || (Date.parse(event?.endsAt || '') || Infinity) <= now) return 'Event ended · picks locked';
  const startsAt = Date.parse(match.scheduledAt) || Date.parse(event?.startsAt || '');
  if (!Number.isFinite(startsAt)) return 'Start time unavailable · picks paused';
  if (startsAt <= now) return 'Scheduled start passed · picks locked';
  return '';
}
const KEY = 'bjj-predict-winner-picks-v1';
function loadPicks(): Record<string, WinnerPick> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}');
    return Object.fromEntries(Object.entries(parsed).filter(([id, value]) => {
      const pick = value as WinnerPick;
      return pick && pick.matchId === id && typeof pick.competitorId === 'string' && typeof pick.pickedAt === 'string' && Array.isArray(pick.opponents) && pick.opponents.length === 2 && pick.opponents.includes(pick.competitorId);
    })) as Record<string, WinnerPick>;
  } catch { return {}; }
}
const Context = createContext<null | {
  matches: Match[]; events: Event[]; competitors: Competitor[]; picks: Record<string, WinnerPick>;
  choose: (match: Match, competitorId: string) => void; notice: string;
}>(null);
export function PredictionsProvider({ matches, events, competitors, children }: { matches: Match[]; events: Event[]; competitors: Competitor[]; children: ReactNode }) {
  const [picks, setPicks] = useState(loadPicks);
  const [notice, setNotice] = useState('');
  function choose(match: Match, competitorId: string) {
    const current = matches.find(item => item.id === match.id);
    if (!current || predictionClosed(current, events.find(event => event.id === current.eventId)) || ![current.competitorAId, current.competitorBId].includes(competitorId)) return;
    const next = { ...picks, [match.id]: { matchId: match.id, competitorId, opponents: [current.competitorAId, current.competitorBId], pickedAt: new Date().toISOString() } };
    setPicks(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); setNotice('Pick saved on this device. You can change it until the match starts.'); }
    catch { setNotice('Pick saved for this session. Browser storage is unavailable.'); }
  }
  return <Context.Provider value={{ matches, events, competitors, picks, choose, notice }}>{children}</Context.Provider>;
}
export function PickButtons({ matchId, eventId, sourceMatchId }: { matchId?: string; eventId?: string; sourceMatchId?: string }) {
  const context = useContext(Context);
  if (!context) return null;
  const match = context.matches.find(item => matchId ? item.id === matchId : item.eventId === eventId && (item.sourceMatchId || item.id) === sourceMatchId);
  if (!match) return <div className="winner-pick-unavailable">Picks open when both opponents are confirmed.</div>;
  const closed = predictionClosed(match, context.events.find(event => event.id === match.eventId));
  const saved = context.picks[match.id];
  const valid = saved?.opponents.includes(match.competitorAId) && saved.opponents.includes(match.competitorBId);
  const pick = valid ? saved : undefined;
  return <div className="winner-pick" role="group" aria-label={`Pick the winner of ${match.round || 'match'}`}>
    <span>{closed || (pick ? 'Your pick' : 'Who wins? Make your pick')}</span>
    <div>{[match.competitorAId, match.competitorBId].map(id => <button type="button" key={id} disabled={Boolean(closed)} aria-pressed={pick?.competitorId === id} onClick={() => context.choose(match, id)}>{pick?.competitorId === id ? '✓ ' : ''}{context.competitors.find(player => player.id === id)?.name || 'Competitor'}</button>)}</div>
    {pick && match.winnerId && <small>{pick.competitorId === match.winnerId ? 'Correct pick' : 'Incorrect pick'}</small>}
  </div>;
}
export function MyPredictions() {
  const context = useContext(Context);
  if (!context) return null;
  const picks = Object.values(context.picks);
  return <section className="my-predictions panel"><h2>My winner picks <small>{picks.length}</small></h2><p>Choose a winner on a game card. Picks are saved on this device and lock when the match starts.</p>
    <p role="status">{context.notice}</p>
    {!picks.length && <p>No picks yet. Open a competition or the match feed to make your first prediction.</p>}
    {picks.map(pick => {
      const match = context.matches.find(item => item.id === pick.matchId);
      const changed = match && ![match.competitorAId, match.competitorBId].every(id => pick.opponents.includes(id));
      return <div className="saved-pick" key={pick.matchId}><strong>{context.competitors.find(player => player.id === pick.competitorId)?.name || 'Saved competitor'}</strong><span>{context.events.find(event => event.id === match?.eventId)?.name || 'Previously loaded event'} · {match?.round || 'Match'}</span><b>{changed ? 'Matchup changed · pick void' : match?.winnerId ? match.winnerId === pick.competitorId ? 'Correct' : 'Incorrect' : 'Awaiting result'}</b></div>;
    })}
  </section>;
}
