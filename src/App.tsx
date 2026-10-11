import { PredictionsProvider, PickButtons, MyPredictions } from "./Predictions";
import { CompetitorPortrait } from "./CompetitorPortrait";
import { WinnerBadge } from './WinnerBadge';
import {
  Activity,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  CircleDot,
  DatabaseZap,
  ExternalLink,
  Gauge,
  ListChecks,
  LockKeyhole,
  MapPin,
  ReceiptText,
  RefreshCw,
  Search,
  RotateCcw,
  SlidersHorizontal,
  Star,
  Swords,
  Trophy,
  TrendingUp,
  UsersRound,
  Wallet,
  X
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useState, useRef } from "react";
import { competitionImportance, currentEvents, isCurrentMatch, isMajorCompetition, isPastCompetition, searchCompetitions } from "./events";
import featuredSnapshot from "./generated/featured-events.json";
import { initialState } from "./data";
import { CompetitionData } from "./CompetitionData";
import { LiquidityPlanner } from "./LiquidityPlanner";
import { OwsWallet } from "./OwsWallet";
import { DataSourcesPanel, sourceLabels } from "./DataSourcesPanel";
import discoverySnapshot from "./generated/data-discovery.json";
import dataSnapshot from "./generated/data-snapshot.json";
import floResultsSnapshot from "./generated/flo-results-snapshot.json";
import smoothcompLiveSnapshot from "./generated/smoothcomp-live-snapshot.json";
import {
  formatDateTime,
  formatPercent,
  getOwnedShares,
  getQuote,
  isMatchTradable,
  lockMarket,
  markPositions,
  placeTrade,
  quoteTrade,
  roundMoney,
  roundShares,
  settleMarket
} from "./market";
import {
  applySmoothcompSnapshot,
  type SmoothcompSnapshot
} from "./smoothcomp";
import { loadState, resetState, saveState } from "./storage";
import type { AppState, Competitor, Event as AppEvent, Market, Match, Position, TradeQuote, TradeSide } from "./types";

type View = "competitions" | "matches" | "markets" | "leaderboard" | "admin";

type Ticket = {
  marketId: string;
  competitorId: string;
};

const finishOptions = ["Points", "Submission", "Referee decision", "DQ"];

const communityLeaderboard = [
  { name: "GuardPullGuru", academy: "Unity Jiu Jitsu", score: 1840, hitRate: "68%" },
  { name: "PassMap", academy: "Atos HQ", score: 1715, hitRate: "64%" },
  { name: "CollarGrip", academy: "Checkmat", score: 1660, hitRate: "61%" },
  { name: "You", academy: "Independent", score: 0, hitRate: "0%" }
];

const smoothcompSnapshot = smoothcompLiveSnapshot as SmoothcompSnapshot;

type DiscoveryPayload = {
  checkedAt: string;
  providers?: Array<{ source: string; status: string; warnings?: string[]; error?: string }>;
  events: Array<{
    id: string; source: AppEvent["source"]; sourceEventId: string; name: string; sourceUrl: string;
    startsAt: string; endsAt?: string; status: AppEvent["status"]; city?: string; country?: string;
    coverImage?: string; officialUrl?: string; organizer?: string; venue?: string; observedAt?: string;
    coverage?: AppEvent["coverage"];
  }>;
};

function applyDiscoveryEvents(state: AppState, discovery: DiscoveryPayload): AppState {
  const byId = new Map(state.events.map(event => [event.id, event]));
  for (const candidate of discovery.events) {
    const previous = byId.get(candidate.id);
    byId.set(candidate.id, {
      ...previous,
      id: candidate.id, sport: "bjj", name: candidate.name,
      organizer: candidate.organizer || previous?.organizer || sourceLabels[candidate.source], venue: candidate.venue || previous?.venue, city: [candidate.city, candidate.country].filter(Boolean).join(", "),
      imageUrl: candidate.coverImage || previous?.imageUrl,
      startsAt: candidate.startsAt, endsAt: candidate.endsAt || previous?.endsAt || "",
      sourceUrl: candidate.sourceUrl, officialUrl: candidate.officialUrl || previous?.officialUrl, source: candidate.source, status: candidate.status,
      lastSyncedAt: previous?.lastSyncedAt || candidate.observedAt || discovery.checkedAt,
      ...(previous?.coverage && previous.coverage.level !== "discovered" ? { coverage: previous.coverage } : candidate.coverage ? { coverage: candidate.coverage } : {}),
      ...(previous?.warnings ? { warnings: previous.warnings } : {})
    });
  }
  return { ...state, events: [...byId.values()] };
}

function hydrateStateFromSnapshot(baseState: AppState, snapshot = smoothcompSnapshot) {
  // Superseded bundled entry used a curated ID before directory discovery existed.
  const migrated = { ...baseState, events: baseState.events.filter(event => event.id !== "e-curated-grappling-grand-prix-88") };
  const withFeatured = applySmoothcompSnapshot(migrated, featuredSnapshot as SmoothcompSnapshot, { supplement: true });
  const hydrated = applySmoothcompSnapshot(applySmoothcompSnapshot(applySmoothcompSnapshot(withFeatured, floResultsSnapshot as SmoothcompSnapshot), snapshot), dataSnapshot as SmoothcompSnapshot);
  const publishedNames: Record<string, string> = {
    "https://ajptour.com/en/event/1552": "AJP TOUR GERMANY NATIONAL JIU-JITSU CHAMPIONSHIP 2026 - GI & NO-GI",
    "https://grapplingindustries.smoothcomp.com/en/event/26334": "Grappling Industries VANCOUVER"
  };
  const named = { ...hydrated, events: hydrated.events.map(event =>
    publishedNames[event.sourceUrl] ? { ...event, name: publishedNames[event.sourceUrl] } : event) };
  const discoveredEvents = discoverySnapshot.events
    .filter(event => !named.events.some(existing => existing.id === event.id))
    .map(event => ({
      id: event.id, sport: "bjj" as const, name: event.name,
      organizer: event.source, city: [(event as { city?: string }).city, (event as { country?: string }).country].filter(Boolean).join(", "), startsAt: event.startsAt,
      imageUrl: (event as typeof event & { coverImage?: string }).coverImage,
      endsAt: (event as typeof event & { endsAt?: string }).endsAt,
      sourceUrl: event.sourceUrl, source: event.source as AppEvent["source"], status: event.status as AppEvent["status"],
      lastSyncedAt: discoverySnapshot.checkedAt
    }));
  const discovered = { ...named, events: [...named.events, ...discoveredEvents] };
  return { ...discovered, positions: markPositions(discovered) };
}

function browseCompetitionEvents(events: AppEvent[], matches: Match[]) {
  const withMatches = new Set(matches.map(match => match.eventId));
  return events.filter(event => event.source !== "manual" && !/\b(cancelled|canceled)\b/i.test(event.name)).sort((a, b) =>
    Number(withMatches.has(b.id)) - Number(withMatches.has(a.id)) ||
    (withMatches.has(a.id) ? Date.parse(b.startsAt || "") - Date.parse(a.startsAt || "") : Date.parse(a.startsAt || "") - Date.parse(b.startsAt || "")) ||
    a.name.localeCompare(b.name));
}

function App() {
  const [, refreshClock] = useState(0);
  useEffect(() => { const timer = setInterval(() => refreshClock(value => value + 1), 15000); return () => clearInterval(timer); }, []);
  const [state, setState] = useState<AppState>(() => hydrateStateFromSnapshot(loadState()));
  const [storageNotice, setStorageNotice] = useState("");
  const [dataStatus, setDataStatus] = useState("Refreshing current matches…");
  const [importingCompetitionId, setImportingCompetitionId] = useState("");
  const [competitionImportNotice, setCompetitionImportNotice] = useState("");
  const [competitionNoticeEventId, setCompetitionNoticeEventId] = useState("");
  const [view, setView] = useState<View>(() => window.location.hash === "#/app/brackets" ? "competitions" : "matches");
  const [showAllCompetitions, setShowAllCompetitions] = useState(false);
  const [competitionSearch, setCompetitionSearch] = useState("");
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [discoveryWarnings, setDiscoveryWarnings] = useState<string[]>([]);
  useEffect(() => {
    if (isRefreshing) return;
    const timer = setTimeout(() => setRefreshGeneration(value => value + 1), 5 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [isRefreshing]);
  const [showHistory, setShowHistory] = useState(false);
  const [showOldCompetitions, setShowOldCompetitions] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState(() => {
    if (window.location.hash === "#/app/brackets") return "e-gosofia-2387";
    const initial = state;
    const active = currentEvents(initial.events);
    return active.find(event => initial.matches.some(match => match.eventId === event.id && match.status !== "settled"))?.id ??
      active[0]?.id ?? browseCompetitionEvents(initial.events, initial.matches).find(event => initial.matches.some(match => match.eventId === event.id))?.id ?? "";
  });
  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState(100);
  const [sellShares, setSellShares] = useState(1);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [settlementFinish, setSettlementFinish] = useState(finishOptions[0]);

  useEffect(() => {
    const timer = setTimeout(() => setStorageNotice(saveState(state) ? "" : "Browser storage is full or unavailable. Loaded data remains visible, but recent changes may not survive a reload."), 500);
    const flush = () => saveState(state);
    window.addEventListener('pagehide', flush);
    return () => { clearTimeout(timer); window.removeEventListener('pagehide', flush); };
  }, [state]);

  useEffect(() => {
    const controller = new AbortController();
    setIsRefreshing(true);
    setDiscoveryWarnings([]);
    setDataStatus("Updating the competition directory…");
    // Independent directories: a slow provider never blocks Smoothcomp or a selected event.
    Promise.allSettled(["smoothcomp", "others"].map(async provider => {
      const response = await fetch(`/api/data/discover?provider=${provider}`, { signal: controller.signal });
      const discovery = await response.json() as DiscoveryPayload & { error?: string };
      if (!response.ok || !Array.isArray(discovery.events)) throw new Error(discovery.error || "Directory unavailable");
      if (controller.signal.aborted) return;
      setState(current => applyDiscoveryEvents(current, discovery));
      setDiscoveryWarnings(current => [...new Set([...current, ...(discovery.providers || []).filter(item => item.status !== "ok").map(item => `${item.source}: ${item.error || "partial coverage"}`)])]);
      setDataStatus("Directory updated · open a competition to load its games");
    })).then(results => {
      if (controller.signal.aborted) return;
      setIsRefreshing(false);
      if (results.every(result => result.status === "rejected")) setDataStatus("Directory unavailable · showing saved competitions. You can still open an event to retry its games.");
    });
    return () => controller.abort();
  }, [refreshGeneration]);


  const scopedEvents = state.events.filter(event => showAllCompetitions || isMajorCompetition(event));
  const scopedEventIds = new Set(scopedEvents.map(event => event.id));
  const scopedMatches = state.matches.filter(match => scopedEventIds.has(match.eventId));
  const visibleEvents = showHistory ? scopedEvents : currentEvents(scopedEvents);
  const competitionPool = showOldCompetitions
    ? browseCompetitionEvents(state.events, state.matches).filter(event => isPastCompetition(event))
    : currentEvents(state.events);
  const competitionEvents = competitionSearch.trim()
    ? searchCompetitions(competitionPool, state.matches, state.competitors, competitionSearch)
    : competitionPool.filter(event => showAllCompetitions || isMajorCompetition(event));
  const selectedEventPool = view === "competitions" ? competitionEvents : visibleEvents;
  const selectedEvent = selectedEventPool.find((event) => event.id === selectedEventId) ??
    selectedEventPool.find(event => state.matches.some(match => match.eventId === event.id)) ?? selectedEventPool[0];
  const visibleEventIds = new Set(visibleEvents.map(event => event.id));
  const visibleMatches = state.matches.filter(match => visibleEventIds.has(match.eventId) && match.sourceState !== "withdrawn");
  const currentMatchCount = scopedMatches.filter(match => isCurrentMatch(match, scopedEvents)).length;
  const selectedMatches = selectedEvent
    ? state.matches.filter((match) => match.eventId === selectedEvent.id && match.sourceState !== "withdrawn")
    : [];
  const selectedMatchIds = new Set(selectedMatches.map((match) => match.id));
  const eventMarkets = state.markets.filter((market) => selectedMatchIds.has(market.matchId) && (showHistory || market.status !== "settled")).sort((a, b) => {
    const matchA = state.matches.find(match => match.id === a.matchId);
    const matchB = state.matches.find(match => match.id === b.matchId);
    const rank = (status?: Match["status"]) => status === "live" ? 0 : status === "open" ? 1 : status === "locked" ? 2 : 3;
    return rank(matchA?.status) - rank(matchB?.status) || Date.parse(matchA?.scheduledAt || "") - Date.parse(matchB?.scheduledAt || "");
  });
  const openMarkets = state.markets.filter((market) => market.status === "open" && state.matches.some(match => match.id === market.matchId && isMatchTradable(match)));
  const totalVolume = state.markets.reduce((sum, market) => sum + market.volume, 0);
  const activePositions = state.positions.filter((position) => position.shares > 0 && !position.isResolved);
  const portfolioMarkValue = state.positions.reduce((sum, position) => sum + position.markValue, 0);
  const portfolioValue = roundMoney(state.balance + portfolioMarkValue);
  const eventGroups = [
    { id: "current", label: "Live / today", events: visibleEvents.filter(event => event.status === "live") },
    { id: "upcoming", label: "Upcoming events", events: visibleEvents.filter(event => event.status === "upcoming") },
    { id: "unknown", label: "Schedule not published", events: visibleEvents.filter(event => event.status === "unknown") },
    { id: "complete", label: "History", events: visibleEvents.filter(event => event.status === "complete") }
  ];

  const selectedTicketData = useMemo(() => {
    if (!ticket) {
      return null;
    }

    const market = state.markets.find((item) => item.id === ticket.marketId);
    const match = market ? state.matches.find((item) => item.id === market.matchId) : undefined;
    const competitor = state.competitors.find((item) => item.id === ticket.competitorId);

    if (!market || !match || !competitor) {
      return null;
    }

    const ownedShares = getOwnedShares(state, market.id, competitor.id);
    const value = tradeSide === "sell" ? sellShares : amount;
    let quote: TradeQuote | null = null;
    let error: string | null = null;

    try {
      quote = quoteTrade(market, match, tradeSide, competitor.id, value);
    } catch (quoteError) {
      error = quoteError instanceof Error ? quoteError.message : "Quote unavailable";
    }

    return {
      market,
      match,
      competitor,
      ownedShares,
      quote,
      error
    };
  }, [amount, sellShares, state, ticket, tradeSide]);

  function getCompetitor(id: string) {
    return state.competitors.find((competitor) => competitor.id === id);
  }

  function submitTrade() {
    if (!selectedTicketData?.quote) {
      return;
    }

    setState((current) =>
      placeTrade(
        current,
        selectedTicketData.market.id,
        selectedTicketData.competitor.id,
        tradeSide,
        tradeSide === "sell" ? sellShares : amount
      )
    );
  }

  function handleReset() {
    resetState();
    const nextState = hydrateStateFromSnapshot(initialState);
    setState(nextState);
    setSelectedEventId(nextState.events[0]?.id ?? "");
    setTicket(null);
  }

  const importController = useRef<AbortController | null>(null);
  const activePage = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  async function importCompetitionMatches(event: AppEvent, offset = 0, all = false, participants = false) {
    importController.current?.abort();
    const controller = new AbortController();
    importController.current = controller;
    activePage.current = offset;
    setImportingCompetitionId(event.id);
    setCompetitionNoticeEventId(event.id);
    setCompetitionImportNotice("Loading this competition’s games…");
    const isBracketSource = event.source === "smoothcomp" || event.source === "ajp";
    let cursor = offset, pages = 0;
    try {
      do {
        const response = await fetch("/api/data/import", {
          method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45000)]), headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventUrl: event.sourceUrl, bracketOffset: cursor,
            bracketLimit: isBracketSource ? 3 : 100, matchLimit: 2000, liveScoreLimit: 12, liveOnly: true,
            participants: participants && pages === 0, details: false,
            seed: { name: event.name, startsAt: event.startsAt, endsAt: event.endsAt, status: event.status, city: event.city } })
        });
        const snapshot = await response.json().catch(() => ({})) as SmoothcompSnapshot & { error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok || !snapshot.events?.length) throw new Error(snapshot.error || "Source data unavailable.");
        const incoming = snapshot.events[0];
        setState(current => {
          const next = applySmoothcompSnapshot(current, snapshot);
          return { ...next, positions: markPositions(next) };
        });
        pages++;
        const next = incoming.coverage?.nextBracketOffset ?? 0;
        const total = incoming.coverage?.totalBrackets ?? 0;
        setCompetitionImportNotice(`${incoming.matches.length} games updated · ${total ? `divisions ${cursor + 1}–${next} of ${total}` : "no published draw yet"}. ${incoming.warnings?.length ? "Some source data is unavailable; saved games are retained." : ""}`);
        if (!all || !isBracketSource || next <= cursor || next >= total) break;
        cursor = next;
        activePage.current = cursor;
      } while (!controller.signal.aborted);
    } catch (error) {
      if (!controller.signal.aborted) setCompetitionImportNotice(`${error instanceof Error ? error.message : "Source data unavailable."} Saved games are still available. Retry using Refresh data.`);
    } finally {
      if (importController.current === controller) { importController.current = null; setImportingCompetitionId(""); }
    }
  }
  useEffect(() => {
    const event = stateRef.current.events.find(item => item.id === selectedEventId);
    if (!event || !["competitions", "matches"].includes(view)) return;
    activePage.current = 0;
    const loaded = event.brackets?.some(bracket => bracket.loaded) || stateRef.current.matches.some(match => match.eventId === event.id);
    if (!loaded || Date.now() - Date.parse(event.lastSyncedAt) > 30000) void importCompetitionMatches(event);
    const timer = setInterval(() => {
      const current = stateRef.current.events.find(item => item.id === event.id);
      if (!current || document.hidden || importController.current) return;
      const now = Date.now(), start = Date.parse(current.startsAt), end = Date.parse(current.endsAt || '') || start + 86400000;
      if (current.status !== 'complete' && start <= now && now <= end) void importCompetitionMatches(current, activePage.current);
    }, 15000);
    return () => { clearInterval(timer); importController.current?.abort(); importController.current = null; setImportingCompetitionId(""); };
  }, [selectedEventId, view]);

  const resolvedPositions = state.positions.filter((position) => position.isResolved);
  const winningPositions = resolvedPositions.filter((position) => position.isWinner);
  const hitRate = resolvedPositions.length
    ? `${Math.round((winningPositions.length / resolvedPositions.length) * 100)}%`
    : "0%";
  const leaderboardRows = communityLeaderboard.map((row) =>
    row.name === "You" ? { ...row, score: portfolioValue, hitRate } : row
  );

  return (
    <PredictionsProvider matches={state.matches} events={state.events} competitors={state.competitors}><div className="app-shell">
      <aside className="side-nav" aria-label="Primary navigation">
        <div className="brand-mark">
          <Swords size={22} aria-hidden="true" />
          <span>BJJ Predict</span>
        </div>
        <nav className="nav-stack">
          <button
            className={view === "matches" ? "nav-button active" : "nav-button"}
            onClick={() => setView("matches")}
            type="button"
          >
            <Swords size={18} aria-hidden="true" />
            <span>Live & upcoming</span>
          </button>
          <button
            className={view === "competitions" ? "nav-button active" : "nav-button"}
            onClick={() => { setShowOldCompetitions(false); setView("competitions"); }}
            type="button"
          >
            <Trophy size={18} aria-hidden="true" />
            <span>Competitions</span>
          </button>
          <button
            className={view === "markets" ? "nav-button active" : "nav-button"}
            onClick={() => setView("markets")}
            type="button"
          >
            <BarChart3 size={18} aria-hidden="true" />
            <span>Predictions</span>
          </button>
          <button
            className={view === "leaderboard" ? "nav-button active" : "nav-button"}
            onClick={() => setView("leaderboard")}
            type="button"
          >
            <Trophy size={18} aria-hidden="true" />
            <span>Leaderboard</span>
          </button>
          <button
            className={view === "admin" ? "nav-button active" : "nav-button"}
            onClick={() => setView("admin")}
            type="button"
          >
            <DatabaseZap size={18} aria-hidden="true" />
            <span>Admin</span>
          </button>
        </nav>
        <div className="wallet-block">
          <Wallet size={18} aria-hidden="true" />
          <div>
            <span>Demo balance</span>
            <strong>{state.balance.toLocaleString()} pts</strong>
          </div>
        </div>
        <OwsWallet />
      </aside>

      <main className="main-content">
        <header className="topbar topbar-compact">
          <div className="source-summary">
            <span className={`status-pill ${currentMatchCount ? "live" : "warning"}`} title={dataStatus}><RefreshCw size={12} aria-hidden="true" />{currentMatchCount ? `${currentMatchCount} games` : isRefreshing ? "Loading games…" : "No matchups loaded"}</span>
            <span>{visibleEvents.length} competitions</span>
            {currentMatchCount > 0 && <span>{scopedMatches.filter(match => match.status === "live" && isCurrentMatch(match, scopedEvents)).length} live</span>}
            {view === "markets" && <span>{state.matches.filter(match => match.status === "settled").length} settled</span>}
          </div>
          <div className="topbar-actions">
            {view === "markets" && <label><input type="checkbox" checked={showHistory} onChange={event => setShowHistory(event.target.checked)} /> Include settled markets</label>}
            <label className="event-scope-toggle"><input type="checkbox" checked={showAllCompetitions} onChange={event => setShowAllCompetitions(event.target.checked)} /> Show all events</label>
            <button className="primary-button" disabled={isRefreshing} onClick={() => setRefreshGeneration(value => value + 1)}>{isRefreshing ? "Refreshing…" : "Refresh matches"}</button>
            <a className="icon-link" href={selectedEvent?.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={17} aria-hidden="true" />
              <span>{selectedEvent ? sourceLabels[selectedEvent.source] : "Source"}</span>
            </a>
            <button className="ghost-button" onClick={handleReset} type="button">
              <RotateCcw size={17} aria-hidden="true" />
              <span>Reset demo</span>
            </button>
          </div>
        </header>

        {storageNotice && <p className="coverage-note" role="status">{storageNotice}</p>}
        <p className="data-refresh-status" role="status">{dataStatus} · {showAllCompetitions ? "All events" : "Major championships & pro shows"}</p>

        {discoveryWarnings.length > 0 && <details className="coverage-note"><summary>Discovery incomplete · {discoveryWarnings.length} sources need attention</summary>{discoveryWarnings.map(warning => <p key={warning}>{warning}</p>)}</details>}

        {view === "markets" && <section className="event-hero" aria-label="Selected event">
          <EventSwitcher
            groups={eventGroups}
            selectedEventId={selectedEvent?.id ?? ""}
            onSelect={(eventId) => setSelectedEventId(eventId)}
          />
          <div className="hero-copy">
            <div className="status-row">
              <span className={`status-pill ${selectedEvent?.status === "live" ? "live" : ""}`}>
                <CircleDot size={12} aria-hidden="true" />{selectedEvent?.status === "live" ? "Happening now" : selectedEvent?.status === "complete" ? "Completed" : "Competition"}
              </span>
            </div>
            <h2>{selectedEvent?.name ?? "No current events available"}</h2>
            {selectedEvent && !selectedMatches.length && <p>This event is listed by the provider, but its matchups have not been imported yet. Use Find / refresh live matches to load the published brackets.</p>}
            <div className="event-meta">
              <span>
                <CalendarDays size={16} aria-hidden="true" />
                {selectedEvent ? formatDateTime(selectedEvent.startsAt) : "No schedule"}
              </span>
              <span>
                <UsersRound size={16} aria-hidden="true" />
                {selectedEvent?.city ?? "No location"}
              </span>
              <span>
                <RefreshCw size={16} aria-hidden="true" />
                {selectedEvent ? formatDateTime(selectedEvent.lastSyncedAt) : "Not synced"}
              </span>
            </div>
          </div>
        </section>}

        {view === "markets" && selectedEvent?.coverage && <div className="coverage-note">
          <strong>{sourceLabels[selectedEvent.source]} · {selectedEvent.coverage.level} coverage</strong>
          <span>{selectedMatches.length} stored matches · {selectedEvent.coverage.scoredMatches} scored in latest fetch{selectedEvent.coverage.totalBrackets != null ? ` · ${selectedEvent.coverage.importedBrackets}/${selectedEvent.coverage.totalBrackets} brackets fetched` : ""}</span>
          {selectedEvent.warnings?.length ? <details><summary>Coverage notes ({selectedEvent.warnings.length})</summary>{selectedEvent.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details> : null}
        </div>}

        {view === "competitions" && <CompetitionsView
          events={competitionEvents}
          search={competitionSearch}
          onSearch={setCompetitionSearch}
          selectedEvent={selectedEvent}
          matches={state.matches}
          competitors={state.competitors}
          onSelect={setSelectedEventId}
          showingOldEvents={showOldCompetitions}
          onToggleOldEvents={() => setShowOldCompetitions(value => !value)}
          onImport={importCompetitionMatches}
          importingEventId={importingCompetitionId}
          importNotice={competitionImportNotice}
          noticeEventId={competitionNoticeEventId}
        />}

        {view === "matches" && <UpcomingMatchesView
          events={scopedEvents}
          matches={scopedMatches}
          competitors={state.competitors}
          onSelectEvent={setSelectedEventId}
          onCompetitions={old => { setCompetitionSearch(""); setShowOldCompetitions(Boolean(old)); setView("competitions"); }}
        />}

        {view === "markets" && <MyPredictions/>}
        {view === "markets" && <section className="metric-grid" aria-label="Prediction summary">
          <Metric icon={<CircleDollarSign size={18} />} label="Prediction volume" value={`${totalVolume.toLocaleString()} pts`} />
          <Metric icon={<Gauge size={18} />} label="Open picks" value={String(openMarkets.length)} />
          <Metric icon={<ListChecks size={18} />} label="Open positions" value={String(activePositions.length)} />
          <Metric icon={<CheckCircle2 size={18} />} label="Demo balance" value={`${state.balance.toLocaleString()} pts`} />
        </section>}

        {view === "markets" && (
          <div className="content-layout">
            <section className="market-column" aria-label="Match markets">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Winner markets</span>
                  <h2>{selectedEvent?.name ?? "Event"} matches</h2>
                </div>
                <div className="stake-control">
                  <SlidersHorizontal size={17} aria-hidden="true" />
                  <label htmlFor="amount">Buy amount</label>
                  <input
                    id="amount"
                    min="1"
                    max="500"
                    step="1"
                    type="range"
                    value={Math.min(amount, 500)}
                    onChange={(event) => setAmount(Number(event.target.value))}
                  />
                  <strong>{amount} pts</strong>
                </div>
              </div>

              <div className="market-list">
                {eventMarkets.map((market) => {
                  const match = state.matches.find((item) => item.id === market.matchId);
                  if (!match) {
                    return null;
                  }

                  const competitorA = getCompetitor(match.competitorAId);
                  const competitorB = getCompetitor(match.competitorBId);

                  if (!competitorA || !competitorB) {
                    return null;
                  }

                  return (
                    <MarketCard
                      key={market.id}
                      competitors={[competitorA, competitorB]}
                      market={market}
                      match={match}
                      positions={state.positions}
                      onPick={(competitorId) => setTicket({ marketId: market.id, competitorId })}
                    />
                  );
                })}
              </div>
              {!eventMarkets.length && <div className="panel empty-matchups">
                <strong>{selectedEvent ? "No live or upcoming matchups loaded for this event" : "No live or upcoming events loaded"}</strong>
                <span>Discover current tournaments and import their published brackets to see competitors and pick winners.</span>
                <button className="primary-button" onClick={() => setView("admin")} type="button">Discover and load matches</button>
              </div>}
            </section>

            <aside className="right-rail">
              <TicketPanel
                amount={amount}
                balance={state.balance}
                sellShares={sellShares}
                side={tradeSide}
                ticketData={selectedTicketData}
                onAmountChange={setAmount}
                onCancel={() => setTicket(null)}
                onConfirm={submitTrade}
                onSellSharesChange={setSellShares}
                onSideChange={setTradeSide}
              />
              <PortfolioPanel competitors={state.competitors} matches={state.matches} positions={state.positions} />
              <RecentTrades competitors={state.competitors} trades={state.trades} />
            </aside>
          </div>
        )}

        {view === "leaderboard" && (
          <section className="panel leaderboard-panel" aria-label="Leaderboards">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Community edge</span>
                <h2>Predictor leaderboard</h2>
              </div>
              <span className="small-note">Portfolio value, resolved hit rate, and live shares</span>
            </div>
            <div className="leaderboard-table" role="table" aria-label="Predictor leaderboard table">
              <div className="table-row table-head" role="row">
                <span role="columnheader">Rank</span>
                <span role="columnheader">Predictor</span>
                <span role="columnheader">Academy</span>
                <span role="columnheader">Score</span>
                <span role="columnheader">Hit rate</span>
              </div>
              {leaderboardRows
                .sort((a, b) => b.score - a.score)
                .map((row, index) => (
                  <div className={row.name === "You" ? "table-row highlight" : "table-row"} role="row" key={row.name}>
                    <span role="cell">#{index + 1}</span>
                    <strong role="cell">{row.name}</strong>
                    <span role="cell">{row.academy}</span>
                    <span role="cell">{row.score.toLocaleString()}</span>
                    <span role="cell">{row.hitRate}</span>
                  </div>
                ))}
            </div>
          </section>
        )}

        {view === "admin" && (
          <section className="admin-grid" aria-label="Admin tools">
            <DataSourcesPanel events={state.events} onDiscover={discovery => {
              setDiscoveryWarnings((discovery.providers || []).filter(provider => provider.status !== "ok").map(provider =>
          `${sourceLabels[provider.source as AppEvent["source"]] || provider.source}: ${provider.error || provider.warnings?.join("; ") || "partial coverage"}`));
        setState(current => applyDiscoveryEvents(current, discovery));
            }} onImport={snapshot => {
              setState(current => {
                const next = applySmoothcompSnapshot(current, snapshot);
                return { ...next, positions: markPositions(next) };
              });
              setSelectedEventId(snapshot.events[0]?.id || "");
            }} />

            <LiquidityPlanner />

            <div className="panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Operations</span>
                  <h2>Lock and settle markets</h2>
                </div>
                <LockKeyhole size={20} aria-hidden="true" />
              </div>
              <label htmlFor="finishType">Finish</label>
              <select
                id="finishType"
                value={settlementFinish}
                onChange={(event) => setSettlementFinish(event.target.value)}
              >
                {finishOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <div className="settlement-list">
                {eventMarkets.map((market) => {
                  const match = state.matches.find((item) => item.id === market.matchId);
                  if (!match) {
                    return null;
                  }
                  const competitorA = getCompetitor(match.competitorAId);
                  const competitorB = getCompetitor(match.competitorBId);
                  if (!competitorA || !competitorB) {
                    return null;
                  }

                  return (
                    <div className="settlement-row" key={market.id}>
                      <div>
                        <strong>{match.round}</strong>
                        <span className="portrait-name"><CompetitorPortrait competitor={competitorA} compact/>{competitorA.name} vs <CompetitorPortrait competitor={competitorB} compact/>{competitorB.name}</span>
                        <span>
                          {market.tradeCount} trades · {market.volume.toLocaleString()} pts ·{" "}
                          {market.status === "settled" ? `${match.finish} winner settled` : market.status}
                        </span>
                      </div>
                      <div className="settlement-actions">
                        <button
                          className="ghost-button"
                          disabled={market.status !== "open"}
                          onClick={() => setState((current) => lockMarket(current, market.id))}
                          type="button"
                        >
                          <LockKeyhole size={16} aria-hidden="true" />
                          <span>Lock</span>
                        </button>
                        <button
                          className="success-button"
                          disabled={market.status === "settled"}
                          onClick={() =>
                            setState((current) =>
                              settleMarket(current, market.id, competitorA.id, settlementFinish)
                            )
                          }
                          type="button"
                        >
                          <Check size={16} aria-hidden="true" />
                          <span>{competitorA.name.split(" ")[0]}</span>
                        </button>
                        <button
                          className="success-button"
                          disabled={market.status === "settled"}
                          onClick={() =>
                            setState((current) =>
                              settleMarket(current, market.id, competitorB.id, settlementFinish)
                            )
                          }
                          type="button"
                        >
                          <Check size={16} aria-hidden="true" />
                          <span>{competitorB.name.split(" ")[0]}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </main>
    </div></PredictionsProvider>
  );
}

type EventSwitcherProps = {
  groups: Array<{
    id: string;
    label: string;
    events: AppEvent[];
  }>;
  selectedEventId: string;
  onSelect: (eventId: string) => void;
};

function EventSwitcher({ groups, selectedEventId, onSelect }: EventSwitcherProps) {
  const events = groups.flatMap(group => group.events);
  const liveCount = groups.find(group => group.id === "current")?.events.length || 0;
  const upcomingCount = groups.find(group => group.id === "upcoming")?.events.length || 0;
  return (
    <div className="event-switcher" aria-label="Event switcher">
      <div className="event-switcher-head">
        <div>
          <span className="eyebrow">Competition slate</span>
          <strong>Choose an event</strong>
        </div>
        <span>{liveCount} live · {upcomingCount} upcoming</span>
      </div>
      <select aria-label="Choose competition" value={events.some(event => event.id === selectedEventId) ? selectedEventId : ""}
        onChange={event => onSelect(event.target.value)}>
        {!events.length && <option value="">No events loaded — discover competitions</option>}
        {groups.filter(group => group.events.length).map(group => <optgroup label={group.label} key={group.id}>
          {group.events.map(event => <option value={event.id} key={event.id}>{event.name} · {formatDateTime(event.startsAt)}</option>)}
        </optgroup>)}
      </select>
    </div>
  );
}

function CompetitionsView({ events, search, onSearch, selectedEvent, matches, competitors, onSelect, showingOldEvents, onToggleOldEvents, onImport, importingEventId, importNotice, noticeEventId }: {
  events: AppEvent[]; search: string; onSearch: (value: string) => void; selectedEvent?: AppEvent; matches: Match[]; competitors: Competitor[];
  onSelect: (id: string) => void; showingOldEvents: boolean; onToggleOldEvents: () => void;
  onImport: (event: AppEvent, offset?: number, all?: boolean, participants?: boolean) => Promise<void>; importingEventId: string; importNotice: string; noticeEventId: string;
}) {
  const [matchView, setMatchView] = useState<"all" | "current" | "old">(showingOldEvents ? "all" : "current");
  useEffect(() => { setMatchView(showingOldEvents ? "all" : "current"); }, [showingOldEvents]);
  const menuEvents = events;
  const selectedMatches = matches.filter(match => match.eventId === selectedEvent?.id && match.sourceState !== "withdrawn");
  const currentMatches = selectedMatches.filter(match => isCurrentMatch(match, selectedEvent ? [selectedEvent] : []));
  const oldMatches = selectedMatches.filter(match => !isCurrentMatch(match, selectedEvent ? [selectedEvent] : []));
  const displayedMatches = matchView === "current" ? currentMatches : matchView === "old" ? oldMatches : selectedMatches;
  const noUpcomingGames = !showingOldEvents && matchView === "current" && currentMatches.length === 0;
  const divisions = [...new Set(displayedMatches.map(match => match.division || "Division not listed"))];
  const liveCount = currentMatches.filter(match => match.status === "live").length;
  const scheduledCount = currentMatches.filter(match => match.status !== "live").length;
  const canLoadMoreBrackets = selectedEvent?.coverage?.totalBrackets != null && selectedEvent.coverage.importedBrackets != null &&
    selectedEvent.coverage.importedBrackets < Math.min(selectedEvent.coverage.totalBrackets, 200);
  const city = selectedEvent?.city && !/location not listed|awaiting sync/i.test(selectedEvent.city) ? selectedEvent.city : "";
  const venue = selectedEvent?.venue?.trim() || "";
  const location = [...new Set([venue, city].filter(Boolean))].join(", ") || "Location not published";
  const mapUrl = location === "Location not published" ? "" : `https://maps.google.com/maps?q=${encodeURIComponent(location)}&output=embed`;
  const dateLabel = selectedEvent ? formatCompetitionDate(selectedEvent.startsAt, selectedEvent.endsAt) : "Date not published";
  return <section className="competition-browser" aria-label="Competitions and brackets">
    <aside className="competition-menu">
      <div className="section-heading"><div><span className="eyebrow">Browse</span><h2>{showingOldEvents ? "Old events" : "Upcoming competitions"}</h2></div><span className="menu-count">{menuEvents.length}</span></div>
      <div className="competition-search">
        <label htmlFor="competition-search">Search competitions</label>
        <div className="competition-search-input"><Search size={17} aria-hidden="true"/><input id="competition-search" type="search" value={search} onChange={event => onSearch(event.target.value)} placeholder="Event, location or competitor" aria-describedby="competition-search-help"/>{search && <button type="button" aria-label="Clear competition search" onClick={() => onSearch("")}><X size={16}/></button>}</div>
        <small id="competition-search-help">Search all events in this view. Competitor names use loaded matchups.</small>
        <span role="status">{menuEvents.length} {menuEvents.length === 1 ? "competition" : "competitions"}{search.trim() ? " found" : ""}</span>
      </div>
      <div className="competition-menu-list">
        {menuEvents.map(event => {
          const count = matches.filter(match => match.eventId === event.id && match.sourceState !== "withdrawn").length;
          const importance = competitionImportance(event);
          return <button type="button" key={event.id} className={`competition-menu-item ${selectedEvent?.id === event.id ? "selected" : ""}`} onClick={() => { setMatchView(showingOldEvents ? "all" : "current"); onSelect(event.id); }}>
            <span className="competition-live-slot"><EventArtwork event={event} compact/>{event.status === "live" && !isPastCompetition(event) && <span className="competition-status-label live">LIVE</span>}</span>
            <span className="competition-menu-copy"><strong>{event.name}</strong><span>{[event.city, formatDateTime(event.startsAt)].filter(Boolean).join(" · ")}</span><span className="competition-importance" aria-label={`Estimated importance: ${importance} out of 5 stars`} title={`Estimated competition scale: ${importance} out of 5. Based on event name and organizer.`}>{Array.from({ length: 5 }, (_, index) => <Star key={index} size={12} fill={index < importance ? "currentColor" : "none"} />)}<small>{count ? `${count} published ${count === 1 ? "match" : "matches"}` : event.coverage?.level === "discovered" ? "Bracket not imported yet" : "No matches published"}</small></span></span>
            <span className="menu-chevron">›</span>
          </button>;
        })}
        {!menuEvents.length && <div className="menu-empty">No competitions found. Try another event, city, country or competitor name.</div>}
      </div>
    </aside>
    <div className="competition-detail">
      {selectedEvent ? <>
        <div className="competition-detail-heading">
          <div className="competition-title-block"><EventArtwork event={selectedEvent}/><div><span className="eyebrow">Competition overview</span><h2>{selectedEvent.name.trim()}</h2><div className="competition-heading-tags"><span className={`competition-status ${isPastCompetition(selectedEvent) ? "past" : selectedEvent.status}`}>{selectedEvent.status === "complete" ? "Completed" : isPastCompetition(selectedEvent) ? "Past event" : selectedEvent.status === "live" ? "Live now" : selectedEvent.status === "upcoming" ? "Upcoming" : "Schedule pending"}</span><span>{sourceLabels[selectedEvent.source]} listing</span><span className="competition-importance detail" aria-label={`Estimated importance: ${competitionImportance(selectedEvent)} out of 5 stars`} title="Estimated from the event name and organizer"><span>{Array.from({ length: 5 }, (_, index) => <Star key={index} size={14} fill={index < competitionImportance(selectedEvent) ? "currentColor" : "none"} />)}</span>Importance estimate</span></div><div className="competition-organizer-line"><span>Organized by</span><strong>{selectedEvent.organizer || sourceLabels[selectedEvent.source]}</strong>{selectedEvent.city && <><i>·</i><MapPin size={13}/><span>{selectedEvent.city}</span></>}</div></div></div>
          <a className="icon-link" href={selectedEvent.officialUrl || selectedEvent.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />Event listing</a>
        </div>
        {(selectedEvent.source === "smoothcomp" || selectedEvent.source === "ajp" || Boolean(selectedEvent.brackets?.length)) ? <CompetitionData key={selectedEvent.id} event={selectedEvent} matches={selectedMatches} competitors={competitors} busy={importingEventId === selectedEvent.id} notice={selectedEvent.id === noticeEventId ? importNotice : ""} onLoad={(offset, all, participants) => onImport(selectedEvent, offset, all, participants)}/> : <>
        {!noUpcomingGames && <div className="competition-stats"><div><strong>{currentMatches.length}</strong><span>Live & upcoming</span></div><div><strong>{divisions.length}</strong><span>Divisions shown</span></div><div><strong>{liveCount}</strong><span>Live now</span></div><div><strong>{scheduledCount}</strong><span>Coming next</span></div><button className="primary-button" type="button" onClick={onToggleOldEvents}>{showingOldEvents ? "See upcoming events" : "See old events"}</button></div>}
        <div className="bracket-heading"><div><span className="eyebrow">Competition draws</span><h3>{showingOldEvents ? "Past games & brackets" : "Live & upcoming games"}</h3></div>{displayedMatches.length > 0 && <span className="small-note">Pairings grouped by division and round</span>}</div>
        {canLoadMoreBrackets && <div className="bracket-import-action"><span>{selectedEvent.coverage?.importedBrackets} of {selectedEvent.coverage?.totalBrackets} published brackets loaded</span><button className="ghost-button" type="button" disabled={importingEventId === selectedEvent.id} onClick={() => onImport(selectedEvent)}>{importingEventId === selectedEvent.id ? "Loading brackets…" : "Load more brackets"}</button>{importNotice && selectedEvent.id === noticeEventId && <span role="status">{importNotice}</span>}</div>}
        {selectedMatches.length > 0 && <div className="match-archive-toggle" role="group" aria-label="Choose matches to show"><button type="button" className={matchView === "current" ? "active" : ""} onClick={() => setMatchView("current")}>Live & upcoming <b>{currentMatches.length}</b></button><button type="button" className={matchView === "old" ? "active" : ""} onClick={() => setMatchView("old")}>Past & results <b>{oldMatches.length}</b></button><button type="button" className={matchView === "all" ? "active" : ""} onClick={() => setMatchView("all")}>All games <b>{selectedMatches.length}</b></button></div>}
        {divisions.length ? <div className="bracket-list">{divisions.map(division => <BracketDivision key={division} event={selectedEvent} division={division} matches={displayedMatches.filter(match => (match.division || "Division not listed") === division)} competitors={competitors} />)}</div> : noUpcomingGames ? <div className="panel empty-matchups empty-upcoming"><CalendarDays size={26} aria-hidden="true"/><strong>{selectedMatches.length ? "No current games in this view" : "No matchups loaded yet"}</strong><div className="empty-actions"><button className="primary-button" type="button" onClick={onToggleOldEvents}>See old events</button><button className="ghost-button" type="button" disabled={importingEventId === selectedEvent.id} onClick={() => onImport(selectedEvent)}>{importingEventId === selectedEvent.id ? "Checking…" : "Check brackets"}</button></div>{importNotice && selectedEvent.id === noticeEventId && <span role="status" title={importNotice}>{/not published|has not published/i.test(importNotice) ? "No pairings published yet" : "Brackets unavailable right now"}</span>}</div> : <div className="panel empty-matchups"><strong>{matchView === "current" ? "No upcoming games published yet" : selectedMatches.length ? "No past games in this view" : "Brackets are not published yet"}</strong><span>{matchView === "current" ? "The organizer may publish pairings closer to the event. Refresh the official brackets to check again." : selectedMatches.length ? "Choose another match view to see the stored bouts for this competition." : "This competition is listed by its organizer. Try loading its official bracket data, or check back when matchups are published."}</span>{(matchView === "current" || !selectedMatches.length) && <button className="primary-button" type="button" disabled={importingEventId === selectedEvent.id} onClick={() => onImport(selectedEvent)}>{importingEventId === selectedEvent.id ? "Loading official brackets…" : "Refresh official matchups"}</button>}{importNotice && selectedEvent.id === noticeEventId && <span role="status">{importNotice}</span>}</div>}
        </>}
        <div className="competition-info-grid">
          <section className="competition-facts" aria-label="Competition details"><div className="competition-facts-title"><CalendarDays size={18}/><h3>Event details</h3></div><dl><div><dt>Dates</dt><dd>{dateLabel}</dd></div><div><dt>Organizer</dt><dd>{selectedEvent.organizer || sourceLabels[selectedEvent.source]}</dd></div><div><dt>Location</dt><dd>{location}</dd></div><div><dt>Data source</dt><dd>{sourceLabels[selectedEvent.source]} · <a href={selectedEvent.sourceUrl} target="_blank" rel="noreferrer">View event listing <ExternalLink size={12}/></a></dd></div></dl><div className="competition-facts-updated">Data last checked {formatDateTime(selectedEvent.lastSyncedAt)}</div></section>
          <section className="competition-map-card" aria-label="Competition location"><div className="competition-map-heading"><div><span className="eyebrow">Where it happens</span><h3>{venue || city || "Location not published"}</h3><p>{venue && city && venue !== city ? city : "Organizer-published location"}</p></div><a href={location === "Location not published" ? selectedEvent.sourceUrl : `https://maps.google.com/?q=${encodeURIComponent(location)}`} target="_blank" rel="noreferrer">{location === "Location not published" ? "Check event page" : "Open map"}<ExternalLink size={13}/></a></div>{mapUrl ? <iframe title={`Map showing ${location}`} src={mapUrl} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /> : <div className="map-placeholder"><span>📍</span><strong>Venue location not listed</strong><p>The organizer has not published a location. Check the official event listing for updates.</p></div>}</section>
        </div>
        {selectedEvent.coverage && !noUpcomingGames && <div className="coverage-note competition-coverage"><strong>Match data coverage · {selectedEvent.coverage.level}</strong><span>{selectedEvent.coverage.importedBrackets ?? divisions.length} of {selectedEvent.coverage.totalBrackets ?? divisions.length} brackets loaded · {selectedEvent.coverage.scoredMatches} scored matches{selectedEvent.coverage.liveScores ? " · live scoring available" : ""}</span></div>}
      </> : <div className="panel empty-matchups"><strong>{search.trim() ? "No competitions match your search" : `No ${showingOldEvents ? "old" : "upcoming"} competition available`}</strong><span>{search.trim() ? "Try another name or location, or switch between upcoming and old events. Competitor search covers loaded matchups." : "Check the other event view or enable Show all events."}</span><button className="primary-button" type="button" onClick={onToggleOldEvents}>{showingOldEvents ? "See upcoming events" : "See old events"}</button></div>}
    </div>
  </section>;
}

function EventArtwork({ event, compact = false }: { event: AppEvent; compact?: boolean }) {
  const [failedUrl, setFailedUrl] = useState("");
  let imageUrl = event.imageUrl || "";
  if (imageUrl.startsWith("/") && event.source === "smoothcomp") imageUrl = `https://smoothcomp.com${imageUrl}`;
  const validImage = imageUrl.startsWith("https://") && !/fallback|placeholder|default/i.test(imageUrl) && failedUrl !== imageUrl;
  const fallbackLogo = !validImage && event.source === "ibjjf";
  return <div className={`event-artwork ${compact ? "compact" : ""} ${fallbackLogo ? "source-logo" : ""}`} aria-label={compact ? undefined : validImage ? "Competition artwork" : "Competition source"} aria-hidden={compact ? "true" : undefined}>
    {validImage ? <img src={imageUrl} alt={compact ? "" : `${event.name} official event artwork`} loading="lazy" decoding="async" onError={() => setFailedUrl(imageUrl)}/> : fallbackLogo ? <img src="/ibjjf-logo.svg" alt={compact ? "" : "IBJJF logo"} loading="lazy"/> : <span className="event-artwork-source">{event.source === "smoothcomp" ? "SC" : sourceLabels[event.source] || "BJJ"}</span>}
  </div>;
}

function formatCompetitionDate(start: string, end?: string) {
  const format = (value: string) => Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(new Date(value))
    : "Date not published";
  const startLabel = format(start);
  if (!end || !Number.isFinite(Date.parse(end)) || startLabel === format(end)) return startLabel;
  return `${startLabel} – ${format(end)}`;
}

function BracketDivision({ event, division, matches, competitors }: { event: AppEvent; division: string; matches: Match[]; competitors: Competitor[] }) {
  const rounds = [...new Set(matches.map(match => match.round || "Scheduled match"))];
  const sorted = [...rounds].sort((a, b) => roundOrder(a) - roundOrder(b));
  return <section className="bracket-division"><div className="bracket-division-title"><div><span className="eyebrow">Division</span><h4>{division}</h4></div><span>{matches.length} {matches.length === 1 ? "match" : "matches"} · {sorted.length} rounds</span></div><div className="bracket-rounds">{sorted.map(round => <div className="bracket-round" key={round}><span className="bracket-round-name">{round}</span>{matches.filter(match => (match.round || "Scheduled match") === round).map(match => {
    const left = competitors.find(competitor => competitor.id === match.competitorAId);
    const right = competitors.find(competitor => competitor.id === match.competitorBId);
    return <article className={`bracket-match ${match.status}`} key={match.id}><div className="bracket-match-meta"><span className={`match-live-dot ${match.status}`} />{match.status === "live" && isCurrentMatch(match, [event]) ? "Live now" : match.status === "settled" ? "Final result" : isCurrentMatch(match, [event]) ? "Scheduled" : "Past · result unavailable"}<time>{formatDateTime(match.scheduledAt)}</time>{formatApproxStart(match.scheduledAt, match.status, match.sourceState === "card-announced") && <span className="match-countdown">{formatApproxStart(match.scheduledAt, match.status, match.sourceState === "card-announced")}</span>}</div><div className={`bracket-side ${match.winnerId === left?.id ? "winner" : ""}`}><div className="bracket-player"><CompetitorPortrait competitor={left} compact/><span><strong>{left?.name ?? "Competitor TBA"}{Boolean(match.winnerId && match.winnerId === left?.id) && <WinnerBadge/>}</strong><small>{left?.academy ?? "Academy not listed"}</small></span></div>{match.score?.left?.points != null && <b>{match.score.left.points}</b>}</div><div className={`bracket-side ${match.winnerId === right?.id ? "winner" : ""}`}><div className="bracket-player"><CompetitorPortrait competitor={right} compact/><span><strong>{right?.name ?? "Competitor TBA"}{Boolean(match.winnerId && match.winnerId === right?.id) && <WinnerBadge/>}</strong><small>{right?.academy ?? "Academy not listed"}</small></span></div>{match.score?.right?.points != null && <b>{match.score.right.points}</b>}</div><PickButtons matchId={match.id}/><div className="bracket-match-bottom"><span>{match.mat || "Mat not assigned"}</span>{match.winnerId && <span className="winner-label">Winner recorded</span>}</div></article>;
  })}</div>)}</div></section>;
}

function roundOrder(round: string) {
  const value = round.toLowerCase();
  if (value.includes("final")) return value.includes("semi") ? 3 : 4;
  if (value.includes("semi")) return 3;
  if (value.includes("quarter")) return 2;
  if (value.includes("16")) return 1;
  if (value.includes("32")) return 0;
  return 2;
}

function MatchCompetitor({ competitor, align = "left", won = false }: { competitor?: Competitor; align?: "left" | "right"; won?: boolean }) {
  return <span className={`match-competitor ${align}`}><CompetitorPortrait competitor={competitor}/><span className="match-competitor-copy"><strong>{competitor?.name ?? "Competitor TBA"}{won && <WinnerBadge/>}</strong><small>{competitor?.academy ?? "Academy not listed"}</small></span></span>;
}

function UpcomingMatchesView({ events, matches, competitors, onSelectEvent, onCompetitions }: {
  events: AppEvent[]; matches: Match[]; competitors: Competitor[]; onSelectEvent: (id: string) => void; onCompetitions: (old?: boolean) => void;
}) {
  const [showOldMatches, setShowOldMatches] = useState(false);
  const [eventFilter, setEventFilter] = useState("");
  const [feedLimit, setFeedLimit] = useState(50);
  useEffect(() => setFeedLimit(50), [eventFilter, showOldMatches]);
  const current = matches.filter(match => isCurrentMatch(match, events));
  const old = matches.filter(match => !isCurrentMatch(match, events));
  const source = showOldMatches ? old : current;
  const visible = source.filter(match => match.sourceState !== "withdrawn" && (!eventFilter || match.eventId === eventFilter));
  const ordered = [...visible].sort((a, b) => {
    if (!showOldMatches && a.status !== b.status && (a.status === "live" || b.status === "live")) return a.status === "live" ? -1 : 1;
    const aTime = Date.parse(a.scheduledAt), bTime = Date.parse(b.scheduledAt);
    const safeA = Number.isFinite(aTime) ? aTime : showOldMatches ? -Infinity : Infinity;
    const safeB = Number.isFinite(bTime) ? bTime : showOldMatches ? -Infinity : Infinity;
    if (safeA === safeB) return 0;
    return showOldMatches ? safeB - safeA : safeA - safeB;
  });
  const competitionOptions = (showOldMatches ? events : currentEvents(events)).sort((a, b) => a.name.localeCompare(b.name));
  const upcomingEvents = currentEvents(events).filter(event => event.status === "upcoming" && Date.parse(event.startsAt) > Date.now());
  return <section className="upcoming-page" aria-label="Live and upcoming matches"><div className="section-heading"><div><span className="eyebrow">Worldwide mat schedule</span><h2>{showOldMatches ? "Old matches" : "Live & upcoming"}</h2>{(showOldMatches || current.length > 0) && <p>{showOldMatches ? "Completed results and past bouts." : "Published matchups from the selected competitions."}</p>}</div><button type="button" className="ghost-button" onClick={() => onCompetitions(false)}>Browse competitions</button></div>
    {ordered.length > feedLimit && <button className="ghost-button" onClick={() => setFeedLimit(value => value + 50)}>Show 50 more games ({ordered.length} total)</button>}
    {!showOldMatches && upcomingEvents.length > 0 && <section className="upcoming-event-section" aria-label="Featured BJJ events">
      <div className="section-heading"><div><span className="eyebrow">On the calendar</span><h3>Featured BJJ events</h3></div><button type="button" className="text-button" onClick={() => onCompetitions(false)}>Browse all {upcomingEvents.length} events <ExternalLink size={14} aria-hidden="true"/></button></div>
      <div className="upcoming-event-grid">{upcomingEvents.slice(0, 8).map(event => <button type="button" className="upcoming-event-card" key={event.id} onClick={() => { onSelectEvent(event.id); onCompetitions(false); }}><EventArtwork event={event} compact/><span className="upcoming-event-copy"><strong>{event.name}</strong><span>{[formatCompetitionDate(event.startsAt, event.endsAt), event.city, sourceLabels[event.source]].filter(Boolean).join(" · ")}</span></span><span className="upcoming-event-when">{formatEventLead(event.startsAt)}</span></button>)}</div>
    </section>}
    <div className="match-filter-row"><div className="match-archive-toggle" role="group" aria-label="Choose matches to show"><button type="button" className={!showOldMatches ? "active" : ""} onClick={() => { setShowOldMatches(false); setEventFilter(""); }}>Live & upcoming <b>{current.length}</b></button><button type="button" className={showOldMatches ? "active" : ""} onClick={() => { setShowOldMatches(true); setEventFilter(""); }}>Old matches <b>{old.length}</b></button></div><label className="event-select-label">Competition<select aria-label="Filter by competition" onChange={event => { setEventFilter(event.target.value); if (event.target.value) onSelectEvent(event.target.value); }} value={eventFilter}><option value="">All competitions</option>{competitionOptions.map(event => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label></div>
    {ordered.length ? <div className="upcoming-match-list">{ordered.slice(0, feedLimit).map(match => { const event = events.find(item => item.id === match.eventId); const left = competitors.find(item => item.id === match.competitorAId); const right = competitors.find(item => item.id === match.competitorBId); const winner = match.winnerId === left?.id ? left : match.winnerId === right?.id ? right : undefined; const stateLabel = !showOldMatches && match.status === "live" ? "Live now" : match.status === "settled" ? "Final result" : showOldMatches ? "Past schedule · result unavailable" : "Upcoming"; return <article className={`upcoming-match-card ${match.status === "live" ? "is-live" : ""} ${showOldMatches ? "is-archived" : ""}`} key={match.id}><div className="upcoming-match-event"><MapPin className="event-location-icon" size={17} aria-hidden="true"/><div><strong>{event?.name ?? "Competition"}</strong><span>{[event?.city, match.division].filter(Boolean).join(" · ")}</span></div><span className={`market-status ${match.status === "live" ? "live" : match.status === "settled" ? "settled" : ""}`}>{stateLabel}</span></div>{!showOldMatches && formatApproxStart(match.scheduledAt, match.status, match.sourceState === "card-announced") && <span className="match-countdown upcoming">{formatApproxStart(match.scheduledAt, match.status, match.sourceState === "card-announced")}</span>}<div className="upcoming-pairing"><MatchCompetitor competitor={left} won={Boolean(match.winnerId && match.winnerId === left?.id)}/><b>VS</b><MatchCompetitor competitor={right} align="right" won={Boolean(match.winnerId && match.winnerId === right?.id)}/></div>{showOldMatches && <div className="archive-result">{winner ? <span className="archive-winner"><Trophy size={18} aria-hidden="true"/><strong>{winner.name}</strong><b>WINNER</b></span> : <span className="archive-no-winner">{match.status === "settled" ? "Winner not reported" : "Result unavailable"}</span>}{match.score?.left?.points != null && match.score?.right?.points != null ? <span className="archive-score"><small>FINAL SCORE</small><strong><span className={match.winnerId === left?.id ? "score-winner" : ""}>{match.score.left.points}</span><i>–</i><span className={match.winnerId === right?.id ? "score-winner" : ""}>{match.score.right.points}</span></strong></span> : <span className="archive-score missing"><small>SCORE</small><strong>Not reported</strong></span>}</div>}<PickButtons matchId={match.id}/><div className="upcoming-match-footer"><span>{match.round || "Round not listed"}</span><span>{match.mat || "Mat TBA"}</span><span><CalendarDays size={14} />{match.sourceState === "card-announced" ? `Event begins ${formatRelativeMatchTime(match.scheduledAt, match.status).toLowerCase()}` : formatRelativeMatchTime(match.scheduledAt, showOldMatches && match.status === "live" ? "locked" : match.status)}</span>{!showOldMatches && match.score?.left?.points != null && match.score?.right?.points != null && <strong className="match-result-score">{match.score.left.points} – {match.score.right.points}</strong>}{match.sourceUrl && <a className="match-source-link" href={match.sourceUrl} target="_blank" rel="noreferrer">{match.sourceState === "card-announced" ? (match.sourceUrl.includes("ge.globo.com") || match.sourceUrl.includes("sportal.bg")) ? "Reported card" : "Official card" : "Source bracket"}<ExternalLink size={12} aria-hidden="true"/></a>}<button type="button" className="text-button" onClick={() => { if (event) { onSelectEvent(event.id); } onCompetitions(showOldMatches); }}>View competition <ExternalLink size={14} /></button></div></article>; })}</div> : <div className="panel empty-matchups empty-upcoming"><CalendarDays size={26} aria-hidden="true"/><strong>{showOldMatches ? "No old games found" : "No upcoming games yet"}</strong>{!showOldMatches && <button type="button" className="primary-button" onClick={() => onCompetitions(true)}>See old events</button>}</div>}
  </section>;
}

function formatRelativeMatchTime(value: string, status: Match["status"]) {
  if (status === "live") return "Happening now";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Start time TBA";
  const date = new Date(time);
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const label = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  if (isSameDay(date, today)) return `Today · ${label}`;
  if (isSameDay(date, tomorrow)) return `Tomorrow · ${label}`;
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function formatEventLead(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date TBA";
  const today = new Date();
  const calendarDay = (day: Date) => Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  const days = Math.round((calendarDay(date) - calendarDay(today)) / (24 * 60 * 60 * 1000));
  return days <= 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`;
}

function formatApproxStart(value: string, status: Match["status"], eventStart = false) {
  const time = Date.parse(value);
  if (status === "live") return !Number.isFinite(time) || time >= Date.now() - 24 * 60 * 60 * 1000 ? "Live now" : "";
  if (status === "settled") return "";
  if (!Number.isFinite(time) || time <= Date.now()) return "";
  const minutes = Math.ceil((time - Date.now()) / 60000);
  const label = eventStart ? "Event starts" : "Starting";
  if (minutes < 60) return `${label} in approx ${minutes}m`;
  if (minutes < 48 * 60) return `${label} in approx ${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
  return `${label} in approx ${Math.ceil(minutes / (24 * 60))}d`;
}

type MetricProps = {
  icon: ReactNode;
  label: string;
  value: string;
};

function Metric({ icon, label, value }: MetricProps) {
  return (
    <div className="metric">
      <span className="metric-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

type MarketCardProps = {
  competitors: [Competitor, Competitor];
  market: Market;
  match: Match;
  positions: Position[];
  onPick: (competitorId: string) => void;
};

function MarketCard({ competitors, market, match, positions, onPick }: MarketCardProps) {
  const quote = getQuote(market, match);
  const disabled = market.status !== "open" || !isMatchTradable(match);
  const matchScore = formatMatchScore(match.score);

  return (
    <article className="market-card">
      <div className="market-card-top">
        <div>
          <span className="eyebrow">{match.division}</span>
          <h3>{match.round}</h3>
        </div>
        <div className={`market-status ${match.status === "live" ? "live" : market.status}`}>
          {market.status === "open" && !disabled ? <CircleDot size={13} aria-hidden="true" /> : <LockKeyhole size={13} aria-hidden="true" />}
          <span>{match.status === "live" ? "Live now · picks locked" : market.status === "open" && !disabled ? "Points trading open" : match.status === "settled" ? "Final" : "Points trading locked"}</span>
        </div>
      </div>

      <div className="match-meta">
        <span>{match.status === "live" ? "Live" : match.status}</span>
        <span>{match.mat}</span>
        <span>{formatDateTime(match.scheduledAt)}</span>
        {match.liveClock && <span>Clock {match.liveClock}</span>}
        {matchScore && <span>{matchScore}</span>}
        <span>{market.volume.toLocaleString()} pts</span>
        <span>{market.tradeCount} trades</span>
        <span>LP risk {market.liquidityRisk.toLocaleString()} pts</span>
      </div>

      <PickButtons matchId={match.id}/><div className="fighter-options">
        <FighterOption
          competitor={competitors[0]}
          disabled={disabled}
          ownedShares={ownedSharesFor(positions, market.id, competitors[0].id)}
          probability={quote.probabilityA}
          won={match.winnerId === competitors[0].id}
          onPick={() => onPick(competitors[0].id)}
        />
        <div className="versus">vs</div>
        <FighterOption
          competitor={competitors[1]}
          disabled={disabled}
          ownedShares={ownedSharesFor(positions, market.id, competitors[1].id)}
          probability={quote.probabilityB}
          won={match.winnerId === competitors[1].id}
          onPick={() => onPick(competitors[1].id)}
        />
      </div>

      <div className="probability-bar" aria-label="Market implied probabilities">
        <span style={{ width: `${Math.round(quote.probabilityA * 100)}%` }} />
        <span style={{ width: `${Math.round(quote.probabilityB * 100)}%` }} />
      </div>
      <div className="market-footnote">
        <Activity size={15} aria-hidden="true" />
        <span>{market.tradeCount ? `Crowd signal · volume/risk ${quote.volumeToRisk.toFixed(1)}x` : "No picks yet · starts at 50/50"}</span>
      </div>
    </article>
  );
}

function formatMatchScore(score: Match["score"]) {
  if (!score?.left && !score?.right) {
    return "";
  }

  const side = (value: NonNullable<Match["score"]>["left"]) =>
    `${value?.points ?? 0}/${value?.advantages ?? 0}/${value?.penalties ?? 0}`;

  return `Score ${side(score.left)} - ${side(score.right)} pts/adv/pen`;
}

function ownedSharesFor(positions: Position[], marketId: string, competitorId: string) {
  return positions.find((position) => position.marketId === marketId && position.competitorId === competitorId)?.shares || 0;
}

type FighterOptionProps = {
  competitor: Competitor;
  disabled: boolean;
  ownedShares: number;
  probability: number;
  won: boolean;
  onPick: () => void;
};

function FighterOption({ competitor, disabled, ownedShares, probability, won, onPick }: FighterOptionProps) {
  return (
    <button className={won ? "fighter-option winner" : "fighter-option"} disabled={disabled} onClick={onPick} type="button">
      <div className="fighter-main">
        <CompetitorPortrait competitor={competitor} />
        {competitor.seed > 0 && <div className="seed-badge">#{competitor.seed}</div>}
        <div>
          <strong>{competitor.name}{won && <WinnerBadge/>}</strong>
          <span className="fighter-academy">
            {competitor.clubLogoUrl && <img src={competitor.clubLogoUrl} alt="" loading="lazy" />}
            {competitor.academy}
          </span>
        </div>
      </div>
      <div className="fighter-stats">
        <span>{competitor.belt === "unknown" ? "Belt not listed" : `${competitor.belt} belt`}</span>
        <span>{competitor.record}</span>
        <span>{roundShares(ownedShares).toLocaleString()} shares</span>
      </div>
      <div className="fighter-probability">
        {won ? <Trophy size={16} aria-hidden="true" /> : <CircleDollarSign size={16} aria-hidden="true" />}
        <span>{formatPercent(probability)}</span>
      </div>
    </button>
  );
}

function initialsFor(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

type TicketPanelProps = {
  amount: number;
  balance: number;
  sellShares: number;
  side: TradeSide;
  ticketData: {
    market: Market;
    match: Match;
    competitor: Competitor;
    ownedShares: number;
    quote: TradeQuote | null;
    error: string | null;
  } | null;
  onAmountChange: (amount: number) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onSellSharesChange: (shares: number) => void;
  onSideChange: (side: TradeSide) => void;
};

function TicketPanel({
  amount,
  balance,
  sellShares,
  side,
  ticketData,
  onAmountChange,
  onCancel,
  onConfirm,
  onSellSharesChange,
  onSideChange
}: TicketPanelProps) {
  if (!ticketData) {
    return (
      <section className="ticket-panel empty" aria-label="Trade ticket">
        <ReceiptText size={24} aria-hidden="true" />
        <h2>Trade ticket</h2>
        <p>Select a competitor probability to quote a buy or sell.</p>
      </section>
    );
  }

  const quote = ticketData.quote;
  const highImpact = quote ? Math.abs(quote.priceImpact) >= 0.1 : false;
  const disabled =
    !quote ||
    ticketData.market.status !== "open" || !isMatchTradable(ticketData.match) ||
    (side === "buy" && quote.amount > balance) ||
    (side === "sell" && (ticketData.ownedShares <= 0 || quote.shares > ticketData.ownedShares));

  return (
    <section className="ticket-panel" aria-label="Trade ticket">
      <div className="ticket-header">
        <div>
          <span className="eyebrow">Trade ticket</span>
          <h2 className="portrait-name"><CompetitorPortrait competitor={ticketData.competitor} compact/>{ticketData.competitor.name}</h2>
        </div>
        <button className="icon-only" onClick={onCancel} type="button" aria-label="Clear ticket">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="segmented-control" aria-label="Trade side">
        {(["buy", "sell"] as TradeSide[]).map((nextSide) => (
          <button
            className={side === nextSide ? "active" : ""}
            key={nextSide}
            onClick={() => onSideChange(nextSide)}
            type="button"
          >
            {nextSide === "buy" ? "Buy" : "Sell"}
          </button>
        ))}
      </div>

      {ticketData.market.status === "open" && !isMatchTradable(ticketData.match) && <div className="ticket-alert">Trading paused: source data is stale or the scheduled start has passed. Refresh the event in Admin.</div>}

      <div className="amount-field">
        <label htmlFor="tradeValue">{side === "buy" ? "Spend" : "Shares to sell"}</label>
        <div className="amount-input">
          <input
            id="tradeValue"
            min={side === "buy" ? 1 : 0}
            max={side === "buy" ? 5000 : ticketData.ownedShares}
            step={side === "buy" ? 1 : 0.0001}
            type="number"
            value={side === "buy" ? amount : sellShares}
            onChange={(event) =>
              side === "buy" ? onAmountChange(Number(event.target.value)) : onSellSharesChange(Number(event.target.value))
            }
          />
          <span>{side === "buy" ? "pts" : "shares"}</span>
        </div>
        {side === "sell" && (
          <button
            className="text-button"
            disabled={ticketData.ownedShares <= 0}
            onClick={() => onSellSharesChange(roundShares(ticketData.ownedShares))}
            type="button"
          >
            Max {roundShares(ticketData.ownedShares).toLocaleString()} shares
          </button>
        )}
      </div>

      <dl className="ticket-lines">
        <div>
          <dt>{side === "buy" ? "Shares estimate" : "Proceeds estimate"}</dt>
          <dd>{quote ? (side === "buy" ? quote.shares.toLocaleString() : `${quote.amount.toLocaleString()} pts`) : "-"}</dd>
        </div>
        <div>
          <dt>Average price</dt>
          <dd>{quote ? `${quote.averagePrice.toLocaleString()} pts` : "-"}</dd>
        </div>
        <div>
          <dt>Price impact</dt>
          <dd className={highImpact ? "warning-text" : ""}>{quote ? signedPercentPoint(quote.priceImpact) : "-"}</dd>
        </div>
        <div>
          <dt>Probability after</dt>
          <dd>{quote ? formatPercent(quote.probabilityAfter) : "-"}</dd>
        </div>
        <div>
          <dt>Pays if correct</dt>
          <dd>{quote ? `${quote.shares.toLocaleString()} pts` : "-"}</dd>
        </div>
      </dl>

      {ticketData.error && <div className="ticket-alert error">{ticketData.error}</div>}
      {highImpact && (
        <div className="ticket-alert warning">
          Large price impact. For a thin BJJ market, smaller orders will move the probability less.
        </div>
      )}
      {side === "sell" && ticketData.ownedShares <= 0 && (
        <div className="ticket-alert muted">You do not own shares on this competitor yet.</div>
      )}

      <button className="primary-button full" disabled={disabled} onClick={onConfirm} type="button">
        <CheckCircle2 size={17} aria-hidden="true" />
        <span>{side === "buy" ? "Buy shares" : "Sell shares"}</span>
      </button>
    </section>
  );
}

function signedPercentPoint(value: number) {
  const points = Math.round(value * 1000) / 10;
  return `${points > 0 ? "+" : ""}${points} pp`;
}

type PortfolioPanelProps = {
  competitors: Competitor[];
  matches: Match[];
  positions: Position[];
};

function PortfolioPanel({ competitors, matches, positions }: PortfolioPanelProps) {
  const activePositions = positions.filter((position) => position.shares > 0);
  const markValue = activePositions.reduce((sum, position) => sum + position.markValue, 0);
  const costBasis = activePositions.reduce((sum, position) => sum + position.costBasis, 0);
  const realizedPnl = positions.reduce((sum, position) => sum + position.realizedPnl, 0);

  return (
    <section className="portfolio-panel" aria-label="Portfolio">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">Portfolio</span>
          <h2>{markValue.toLocaleString()} pts</h2>
        </div>
        <TrendingUp size={20} aria-hidden="true" />
      </div>
      <div className="pnl-grid">
        <div>
          <span>Unrealized PnL</span>
          <strong className={markValue - costBasis >= 0 ? "positive" : "negative"}>
            {roundMoney(markValue - costBasis).toLocaleString()} pts
          </strong>
        </div>
        <div>
          <span>Realized PnL</span>
          <strong className={realizedPnl >= 0 ? "positive" : "negative"}>{roundMoney(realizedPnl).toLocaleString()} pts</strong>
        </div>
      </div>

      <div className="position-list">
        {activePositions.slice(0, 5).map((position) => {
          const competitor = competitors.find((item) => item.id === position.competitorId);
          const match = matches.find((item) => item.id === position.matchId);

          return (
            <div className="position-row" key={position.id}>
              <div>
                <strong className="portrait-name"><CompetitorPortrait competitor={competitor} compact/>{competitor?.name ?? "Unknown competitor"}</strong>
                <span>{match?.round ?? "Match"} · {roundShares(position.shares).toLocaleString()} shares</span>
              </div>
              <div>
                <strong>{formatPercent(position.currentProbability)}</strong>
                <span className={position.unrealizedPnl >= 0 ? "positive" : "negative"}>
                  {position.unrealizedPnl.toLocaleString()} pts
                </span>
              </div>
            </div>
          );
        })}
        {activePositions.length === 0 && <div className="empty-list">No open positions yet.</div>}
      </div>
    </section>
  );
}

type RecentTradesProps = {
  competitors: Competitor[];
  trades: AppState["trades"];
};

function RecentTrades({ competitors, trades }: RecentTradesProps) {
  return (
    <section className="portfolio-panel" aria-label="Recent trades">
      <div className="section-heading compact">
        <div>
          <span className="eyebrow">Activity</span>
          <h2>Recent trades</h2>
        </div>
        <Activity size={20} aria-hidden="true" />
      </div>
      <div className="trade-list">
        {trades.slice(0, 4).map((trade) => {
          const competitor = competitors.find((item) => item.id === trade.competitorId);
          return (
            <div className="trade-row" key={trade.id}>
              <span className="portrait-name"><CompetitorPortrait competitor={competitor} compact/>{trade.side === "sell" ? "Sold" : "Bought"} · {competitor?.name ?? "Outcome"}</span>
              <strong>{trade.amount.toLocaleString()} pts</strong>
            </div>
          );
        })}
        {trades.length === 0 && <div className="empty-list">No trades yet.</div>}
      </div>
    </section>
  );
}

export default App;
