import { useEffect, useMemo, useState } from 'react';
import initialDiscovery from './generated/data-discovery.json';
import { formatDateTime } from './market';
import type { DataSnapshot } from './smoothcomp';
import type { DataProvider, Event } from './types';

export const sourceLabels: Record<DataProvider | 'manual', string> = {
  smoothcomp: 'Smoothcomp', ajp: 'AJP Tour', ibjjf: 'IBJJF', floarena: 'FloArena', flo: 'FloGrappling', manual: 'Manual'
};
type Candidate = { id: string; source: DataProvider; sourceEventId: string; name: string; sourceUrl: string; startsAt: string; endsAt?: string; city?: string; country?: string; coverage?: Event['coverage']; status: Event['status'] };
type Discovery = { checkedAt: string; events: Candidate[]; providers: Array<{ source: string; status: string; discovered?: number; error?: string }> };

export function DataSourcesPanel({ events, onImport, onDiscover }: { events: Event[]; onImport: (snapshot: DataSnapshot) => void; onDiscover: (discovery: Discovery) => void }) {
  const [discovery, setDiscovery] = useState(initialDiscovery as Discovery);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [url, setUrl] = useState('');
  const [limit, setLimit] = useState(30);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const candidates = useMemo(() => discovery.events.filter(event => (source === 'all' || event.source === source) &&
    event.name.toLowerCase().includes(query.toLowerCase())), [discovery, source, query]);
  const importable = useMemo(() => candidates.filter(event => {
    const startsAt = Date.parse(event.startsAt);
    const endsAt = Date.parse(event.endsAt || '');
    if (Number.isFinite(endsAt) && endsAt < Date.now()) return false;
    return event.status === 'upcoming' && Number.isFinite(startsAt) && startsAt >= Date.now() ||
      event.status === 'live' && Number.isFinite(startsAt) && Date.now() - startsAt < 24 * 60 * 60 * 1000;
  }), [candidates]);

  useEffect(() => { void discover(true); }, []);

  async function discover(silent = false) {
    setBusy('discovery');
    if (!silent) setNotice('');
    try {
      const response = await fetch('/api/data/discover');
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.events)) throw new Error(payload.error || 'Discovery unavailable.');
      setDiscovery(payload);
      onDiscover(payload);
      setNotice(`Live API connected: found ${payload.events.length} events. Import an event to fetch its matches.`);
    } catch (error) {
      setNotice(`Live API unavailable: ${error instanceof Error ? error.message : 'discovery failed.'} Bundled events remain available.`);
    }
    finally { setBusy(''); }
  }
  async function fetchEvent(eventUrl: string) {
    const candidate = discovery.events.find(item => item.sourceUrl === eventUrl);
    const response = await fetch('/api/data/import', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventUrl, bracketLimit: limit, matchLimit: 2000, liveScoreLimit: 200,
        seed: candidate ? { name: candidate.name, startsAt: candidate.startsAt, endsAt: candidate.endsAt, status: candidate.status, city: candidate.city } : undefined }) });
    const snapshot = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(snapshot.events) || !snapshot.events.length) throw new Error(snapshot.error || 'Import unavailable.');
    for (const event of snapshot.events) {
      if (candidate && event.name === `IBJJF tournament ${event.sourceEventId}`) event.name = candidate.name;
    }
    onImport(snapshot);
    return snapshot as DataSnapshot;
  }
  async function importEvent(eventUrl: string) {
    setBusy(eventUrl); setNotice('');
    try {
      const snapshot = await fetchEvent(eventUrl);
      const event = snapshot.events[0];
      setNotice(`${event.name}: ${event.matches.length} matches imported. Coverage: ${event.coverage?.level || 'partial'}.`);
    } catch (error) { setNotice(`${error instanceof Error ? error.message : 'Import failed.'} Existing data retained.`); }
    finally { setBusy(''); }
  }
  async function importCurrentEvents() {
    if (!importable.length) return;
    setBusy('bulk');
    let imported = 0;
    let matches = 0;
    const failures: string[] = [];
    for (let index = 0; index < importable.length; index += 1) {
      const candidate = importable[index];
      setNotice(`Importing ${index + 1} of ${importable.length}: ${candidate.name}…`);
      try {
        const snapshot = await fetchEvent(candidate.sourceUrl);
        onImport(snapshot);
        imported += 1;
        matches += snapshot.events.reduce((total, event) => total + event.matches.length, 0);
      } catch (error) {
        failures.push(`${candidate.name}: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
    setNotice(`Imported ${imported} of ${importable.length} events and ${matches} matches${failures.length ? `. ${failures.length} imports failed: ${failures.join('; ')}` : '.'}`);
    setBusy('');
  }
  async function refreshImported() {
    setBusy('refresh');
    const failures: string[] = []; let success = 0;
    for (const event of events.filter(event => event.source !== 'manual' && (event.status === 'live' || (event.status === 'upcoming' && event.startsAt.slice(0, 10) >= new Date().toISOString().slice(0, 10))))) {
      setNotice(`Refreshing ${event.name}…`);
      try { await fetchEvent(event.sourceUrl); success++; }
      catch (error) { failures.push(`${event.name}: ${error instanceof Error ? error.message : 'failed'}`); }
    }
    setNotice(`Refreshed ${success} events.${failures.length ? ` Retained old data for ${failures.length} failures: ${failures.join('; ')}` : ''}`);
    setBusy('');
  }

  return <div className="panel data-sources-panel">
    <div className="section-heading"><div><span className="eyebrow">Event coverage</span><h2>Find and import competitions</h2></div></div>
    <p>Smoothcomp · AJP Tour · IBJJF · FloArena · FloGrappling</p>
    <div className="admin-actions">
      <button className="primary-button" disabled={!!busy} onClick={() => void discover()}>Discover current events</button>
      <button className="primary-button" disabled={!!busy || !importable.length} onClick={() => void importCurrentEvents()}>
        Import all current events ({importable.length})
      </button>
      <button className="ghost-button" disabled={!!busy} onClick={refreshImported}>Refresh current events</button>
    </div>
    <p className="source-checked">Discovery checked: {formatDateTime(discovery.checkedAt)}</p>
    <div className="provider-statuses">{discovery.providers.map(provider => <span key={provider.source} className={`status-pill ${provider.status === 'error' ? 'warning' : ''}`} title={provider.error}>
      {sourceLabels[provider.source as DataProvider]}: {provider.status === 'ok' ? `${provider.discovered} found` : 'unavailable'}
    </span>)}</div>
    {discovery.providers.filter(provider => provider.error).map(provider => <p className="source-checked" key={provider.source}>{sourceLabels[provider.source as DataProvider]}: {provider.error}</p>)}
    <form className="import-form" onSubmit={event => { event.preventDefault(); void importEvent(url); }}>
      <label htmlFor="source-event-url">Event URL from any supported provider</label>
      <input id="source-event-url" type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="Paste a Smoothcomp, AJP, IBJJF, FloArena or Flo event URL" />
      <label htmlFor="bracket-limit">Brackets per event</label>
      <select id="bracket-limit" value={limit} onChange={event => setLimit(Number(event.target.value))}>
        <option value={30}>30 — quicker import</option><option value={100}>100 — maximum coverage</option>
      </select>
      <button className="primary-button" disabled={!!busy} type="submit">Import / refresh event</button>
    </form>
    <div className="source-filters">
      <input aria-label="Search discovered events" placeholder="Search events, e.g. ADCC" value={query} onChange={event => setQuery(event.target.value)} />
      <select aria-label="Filter data provider" value={source} onChange={event => setSource(event.target.value)}>
        <option value="all">All providers</option>{Object.entries(sourceLabels).filter(([id]) => !['manual', 'flo'].includes(id)).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </div>
    <div className="discovered-events">{candidates.map(event => <div className="discovered-event" key={event.id}>
      <div><strong>{event.name}</strong><span>{sourceLabels[event.source]} · {formatDateTime(event.startsAt)}</span><a href={event.sourceUrl} target="_blank" rel="noreferrer">View source</a></div>
      <button className="ghost-button" disabled={!!busy} onClick={() => importEvent(event.sourceUrl)}>{events.some(imported => imported.id === event.id && imported.coverage?.level !== 'discovered') ? 'Refresh matches' : 'Import matches'}</button>
    </div>)}{!candidates.length && <p>No matching discovered events. Try another search or paste an event URL.</p>}</div>
    {busy && <p role="status">{busy === 'bulk' ? 'Importing current events with maximum match and score limits…' : 'Fetching source data…'}</p>}
    {notice && <div className="ticket-alert" role="status">{notice}</div>}
  </div>;
}
