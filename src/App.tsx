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
  ReceiptText,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Swords,
  Trophy,
  TrendingUp,
  UsersRound,
  Wallet,
  X
} from "lucide-react";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { initialState } from "./data";
import { LiquidityPlanner } from "./LiquidityPlanner";
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
  events: Array<{
    id: string; source: AppEvent["source"]; sourceEventId: string; name: string; sourceUrl: string;
    startsAt: string; endsAt?: string; status: AppEvent["status"]; city?: string; country?: string;
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
      organizer: sourceLabels[candidate.source], city: [candidate.city, candidate.country].filter(Boolean).join(", "),
      startsAt: candidate.startsAt, endsAt: candidate.endsAt || previous?.endsAt || "",
      sourceUrl: candidate.sourceUrl, source: candidate.source, status: candidate.status,
      lastSyncedAt: discovery.checkedAt,
      ...(previous?.coverage && previous.coverage.level !== "discovered" ? { coverage: previous.coverage } : candidate.coverage ? { coverage: candidate.coverage } : {}),
      ...(previous?.warnings ? { warnings: previous.warnings } : {})
    });
  }
  return { ...state, events: [...byId.values()] };
}

function hydrateStateFromSnapshot(baseState: AppState, snapshot = smoothcompSnapshot) {
  const hydrated = applySmoothcompSnapshot(applySmoothcompSnapshot(applySmoothcompSnapshot(baseState, floResultsSnapshot as SmoothcompSnapshot), snapshot), dataSnapshot as SmoothcompSnapshot);
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
      organizer: event.source, city: "", startsAt: event.startsAt,
      endsAt: (event as typeof event & { endsAt?: string }).endsAt,
      sourceUrl: event.sourceUrl, source: event.source as AppEvent["source"], status: event.status as AppEvent["status"],
      lastSyncedAt: discoverySnapshot.checkedAt
    }));
  const discovered = { ...named, events: [...named.events, ...discoveredEvents] };
  return { ...discovered, positions: markPositions(discovered) };
}

function currentEvents(events: AppEvent[]) {
  const now = Date.now();
  const staleCutoff = now - 24 * 60 * 60 * 1000;
  return events.filter(event => {
    if (event.source === "manual") return false;
    const start = Date.parse(event.startsAt);
    const end = Date.parse(event.endsAt || "");
    if (event.status === "upcoming") return Number.isFinite(start) && start + 24 * 60 * 60 * 1000 > now;
    if (event.status === "live") return Number.isFinite(end) ? end >= now : Number.isFinite(start) && start >= staleCutoff && start <= now + 24 * 60 * 60 * 1000;
    return false;
  }).sort((a, b) => Number(b.status === "live") - Number(a.status === "live") || Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

function App() {
  const [, refreshClock] = useState(0);
  useEffect(() => { const timer = setInterval(() => refreshClock(value => value + 1), 15000); return () => clearInterval(timer); }, []);
  const [state, setState] = useState<AppState>(() => hydrateStateFromSnapshot(loadState()));
  const [dataStatus, setDataStatus] = useState("Refreshing current matches…");
  const [view, setView] = useState<View>("competitions");
  const [showHistory, setShowHistory] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState(() => {
    const initial = hydrateStateFromSnapshot(loadState());
    const active = currentEvents(initial.events);
    return active.find(event => initial.matches.some(match => match.eventId === event.id && match.status !== "settled"))?.id ?? active[0]?.id ?? "";
  });
  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState(100);
  const [sellShares, setSellShares] = useState(1);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [settlementFinish, setSettlementFinish] = useState(finishOptions[0]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  useEffect(() => {
    const controller = new AbortController();
    async function refreshCurrentMatches() {
      try {
        const discoveryResponse = await fetch("/api/data/discover", { signal: controller.signal });
        const discovery = await discoveryResponse.json().catch(() => ({})) as DiscoveryPayload & { error?: string };
        if (!discoveryResponse.ok || !Array.isArray(discovery.events)) throw new Error(discovery.error || "Event discovery unavailable.");
        setState(current => applyDiscoveryEvents(current, discovery));
        const now = Date.now();
        const currentEvents = discovery.events.filter(event => {
          const start = Date.parse(event.startsAt);
          const end = Date.parse(event.endsAt || "");
          if (Number.isFinite(end) && end < now) return false;
          return event.status === "upcoming" && Number.isFinite(start) && start + 24 * 60 * 60 * 1000 > now ||
            event.status === "live" && Number.isFinite(start) && now - start < 24 * 60 * 60 * 1000;
        }).slice(0, 8);
        let imported = 0;
        let matches = 0;
        for (const event of currentEvents) {
          const response = await fetch("/api/data/import", {
            method: "POST", signal: controller.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ eventUrl: event.sourceUrl, bracketLimit: 100, matchLimit: 2000, liveScoreLimit: 200,
              seed: { name: event.name, startsAt: event.startsAt, endsAt: event.endsAt, status: event.status, city: event.city } })
          });
          const snapshot = await response.json().catch(() => ({})) as SmoothcompSnapshot & { error?: string };
          if (!response.ok || !Array.isArray(snapshot.events) || !snapshot.events.length) continue;
          const firstEvent = snapshot.events[0];
          firstEvent.name = event.name;
          if (!firstEvent.startsAt) firstEvent.startsAt = event.startsAt;
          if (!firstEvent.endsAt) firstEvent.endsAt = event.endsAt;
          if (!firstEvent.status) firstEvent.status = event.status;
          setState(current => {
            const next = applySmoothcompSnapshot(current, snapshot);
            return { ...next, positions: markPositions(next) };
          });
          if (firstEvent.matches.length) {
            imported += 1;
            matches += firstEvent.matches.length;
            setSelectedEventId(firstEvent.id);
            if (imported >= 3) break;
          }
        }
        setDataStatus(matches ? `Loaded ${matches} matchups from ${imported} current events` : "Current events checked · no published matchups found yet");
      } catch (error) {
        if (controller.signal.aborted) return;
        setDataStatus(`Live data unavailable · ${error instanceof Error ? error.message : "try Admin → Discover"}`);
      }
    }
    void refreshCurrentMatches();
    return () => controller.abort();
  }, []);

  const visibleEvents = showHistory ? state.events : currentEvents(state.events);
  const selectedEvent = visibleEvents.find((event) => event.id === selectedEventId) ??
    visibleEvents.find(event => state.matches.some(match => match.eventId === event.id && match.status !== "settled")) ?? visibleEvents[0];
  const visibleEventIds = new Set(visibleEvents.map(event => event.id));
  const visibleMatches = state.matches.filter(match => visibleEventIds.has(match.eventId));
  const selectedMatches = selectedEvent
    ? state.matches.filter((match) => match.eventId === selectedEvent.id)
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

  const resolvedPositions = state.positions.filter((position) => position.isResolved);
  const winningPositions = resolvedPositions.filter((position) => position.isWinner);
  const hitRate = resolvedPositions.length
    ? `${Math.round((winningPositions.length / resolvedPositions.length) * 100)}%`
    : "0%";
  const leaderboardRows = communityLeaderboard.map((row) =>
    row.name === "You" ? { ...row, score: portfolioValue, hitRate } : row
  );

  return (
    <div className="app-shell">
      <aside className="side-nav" aria-label="Primary navigation">
        <div className="brand-mark">
          <Swords size={22} aria-hidden="true" />
          <span>BJJ Predict</span>
        </div>
        <nav className="nav-stack">
          <button
            className={view === "competitions" ? "nav-button active" : "nav-button"}
            onClick={() => setView("competitions")}
            type="button"
          >
            <Trophy size={18} aria-hidden="true" />
            <span>Competitions</span>
          </button>
          <button
            className={view === "matches" ? "nav-button active" : "nav-button"}
            onClick={() => setView("matches")}
            type="button"
          >
            <Swords size={18} aria-hidden="true" />
            <span>Upcoming matches</span>
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
      </aside>

      <main className="main-content">
        <header className="topbar topbar-compact">
          <div className="source-summary">
            <span className="status-pill live"><RefreshCw size={12} aria-hidden="true" />Live data</span>
            <span>{dataStatus}</span>
            <span>{visibleEvents.length} events</span>
            <span>{visibleMatches.filter(match => match.status !== "settled").length} live / upcoming matches</span>
            <span>{visibleMatches.filter(match => match.status === "live").length} live</span>
            <span>{visibleMatches.filter(match => match.status === "open").length} prediction-ready</span>
            <span>{visibleMatches.filter(match => match.status === "settled").length} settled</span>
          </div>
          <div className="topbar-actions">
            <label><input type="checkbox" checked={showHistory} onChange={event => setShowHistory(event.target.checked)} /> Show history / demo</label>
            <button className="primary-button" onClick={() => setView("admin")}>Find / refresh live matches</button>
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

        {selectedEvent?.coverage && <div className="coverage-note">
          <strong>{sourceLabels[selectedEvent.source]} · {selectedEvent.coverage.level} coverage</strong>
          <span>{selectedMatches.length} stored matches · {selectedEvent.coverage.scoredMatches} scored in latest fetch{selectedEvent.coverage.totalBrackets != null ? ` · ${selectedEvent.coverage.importedBrackets}/${selectedEvent.coverage.totalBrackets} brackets fetched` : ""}</span>
          {selectedEvent.warnings?.length ? <details><summary>Coverage notes ({selectedEvent.warnings.length})</summary>{selectedEvent.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</details> : null}
        </div>}

        {view === "competitions" && <CompetitionsView
          events={visibleEvents}
          selectedEvent={selectedEvent}
          matches={selectedMatches}
          competitors={state.competitors}
          onSelect={setSelectedEventId}
          onMatches={() => setView("matches")}
        />}

        {view === "matches" && <UpcomingMatchesView
          events={visibleEvents}
          matches={visibleMatches.filter(match => match.status !== "settled")}
          competitors={state.competitors}
          onSelectEvent={setSelectedEventId}
          onCompetitions={() => setView("competitions")}
        />}

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
                        <span>{competitorA.name} vs {competitorB.name}</span>
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
    </div>
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

function CompetitionsView({ events, selectedEvent, matches, competitors, onSelect, onMatches }: {
  events: AppEvent[]; selectedEvent?: AppEvent; matches: Match[]; competitors: Competitor[];
  onSelect: (id: string) => void; onMatches: () => void;
}) {
  const divisions = [...new Set(matches.map(match => match.division || "Division not listed"))];
  return <section className="competition-browser" aria-label="Competitions and brackets">
    <aside className="competition-menu">
      <div className="section-heading"><div><span className="eyebrow">Browse</span><h2>Competitions</h2></div><span className="menu-count">{events.length}</span></div>
      <div className="competition-menu-list">
        {events.map(event => {
          const count = matches.filter(match => match.eventId === event.id).length;
          return <button type="button" key={event.id} className={`competition-menu-item ${selectedEvent?.id === event.id ? "selected" : ""}`} onClick={() => onSelect(event.id)}>
            <span className={`event-marker ${event.status}`} />
            <span className="competition-menu-copy"><strong>{event.name}</strong><span>{[event.city, formatDateTime(event.startsAt)].filter(Boolean).join(" · ")}</span><small>{count} {count === 1 ? "match" : "matches"} · {event.status}</small></span>
            <span className="menu-chevron">›</span>
          </button>;
        })}
        {!events.length && <div className="menu-empty">No current competitions found. Use Discover to search live event listings.</div>}
      </div>
    </aside>
    <div className="competition-detail">
      {selectedEvent ? <>
        <div className="competition-detail-heading">
          <div><span className="eyebrow">{sourceLabels[selectedEvent.source]} · {selectedEvent.status}</span><h2>{selectedEvent.name}</h2><p>{[selectedEvent.city, formatDateTime(selectedEvent.startsAt)].filter(Boolean).join(" · ")}</p></div>
          <a className="icon-link" href={selectedEvent.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />Official event</a>
        </div>
        <div className="competition-stats"><div><strong>{matches.length}</strong><span>Published matches</span></div><div><strong>{divisions.length}</strong><span>Divisions</span></div><div><strong>{matches.filter(match => match.status === "live").length}</strong><span>Live now</span></div><button className="primary-button" type="button" onClick={onMatches}>See upcoming matches</button></div>
        <div className="bracket-heading"><div><span className="eyebrow">Draws & schedule</span><h3>Brackets by division</h3></div><span className="small-note">Showing provider-published matchups</span></div>
        {divisions.length ? <div className="bracket-list">{divisions.map(division => <BracketDivision key={division} division={division} matches={matches.filter(match => (match.division || "Division not listed") === division)} competitors={competitors} />)}</div> : <div className="panel empty-matchups"><strong>Brackets are not published yet</strong><span>This competition is listed by its organizer. Published divisions and matchups will appear here as soon as they are available.</span><button className="primary-button" type="button" onClick={onMatches}>Browse all upcoming matches</button></div>}
      </> : <div className="panel empty-matchups"><strong>No competition selected</strong><span>Choose an event from the competition menu.</span></div>}
    </div>
  </section>;
}

function BracketDivision({ division, matches, competitors }: { division: string; matches: Match[]; competitors: Competitor[] }) {
  const rounds = [...new Set(matches.map(match => match.round || "Scheduled match"))];
  const sorted = [...rounds].sort((a, b) => roundOrder(a) - roundOrder(b));
  return <section className="bracket-division"><div className="bracket-division-title"><div><span className="eyebrow">Division</span><h4>{division}</h4></div><span>{matches.length} matches · {sorted.length} rounds</span></div><div className="bracket-rounds">{sorted.map(round => <div className="bracket-round" key={round}><span className="bracket-round-name">{round}</span>{matches.filter(match => (match.round || "Scheduled match") === round).map(match => {
    const left = competitors.find(competitor => competitor.id === match.competitorAId);
    const right = competitors.find(competitor => competitor.id === match.competitorBId);
    return <article className="bracket-match" key={match.id}><div className="bracket-match-meta"><span className={`match-live-dot ${match.status}`} />{match.status === "live" ? "LIVE" : match.status}<span>{match.mat}</span><time>{formatDateTime(match.scheduledAt)}</time></div><div className="bracket-side"><strong>{left?.name ?? "Competitor TBA"}</strong>{match.score?.left?.points != null && <b>{match.score.left.points}</b>}</div><div className="bracket-side"><strong>{right?.name ?? "Competitor TBA"}</strong>{match.score?.right?.points != null && <b>{match.score.right.points}</b>}</div></article>;
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

function UpcomingMatchesView({ events, matches, competitors, onSelectEvent, onCompetitions }: {
  events: AppEvent[]; matches: Match[]; competitors: Competitor[]; onSelectEvent: (id: string) => void; onCompetitions: () => void;
}) {
  const [filter, setFilter] = useState<"all" | "live" | "scheduled">("all");
  const [eventFilter, setEventFilter] = useState("");
  const visible = matches.filter(match => (!eventFilter || match.eventId === eventFilter) && (filter === "all" || (filter === "live" ? match.status === "live" : match.status === "open")));
  const ordered = [...visible].sort((a, b) => Number(b.status === "live") - Number(a.status === "live") || Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt));
  return <section className="upcoming-page" aria-label="Upcoming matches"><div className="section-heading"><div><span className="eyebrow">Live mat schedule</span><h2>Upcoming matches</h2><p>Published pairings across the current competition slate.</p></div><button type="button" className="ghost-button" onClick={onCompetitions}>Browse competitions</button></div><div className="match-filter-row"><button type="button" className={`match-filter ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>All live & upcoming <b>{matches.length}</b></button><button type="button" className={`match-filter ${filter === "live" ? "active" : ""}`} onClick={() => setFilter("live")}>Live <b>{matches.filter(match => match.status === "live").length}</b></button><button type="button" className={`match-filter ${filter === "scheduled" ? "active" : ""}`} onClick={() => setFilter("scheduled")}>Scheduled <b>{matches.filter(match => match.status === "open").length}</b></button><label className="event-select-label">Competition<select aria-label="Filter by competition" onChange={event => { setEventFilter(event.target.value); if (event.target.value) onSelectEvent(event.target.value); }} value={eventFilter}><option value="">All competitions</option>{events.map(event => <option value={event.id} key={event.id}>{event.name}</option>)}</select></label></div>
    {ordered.length ? <div className="upcoming-match-list">{ordered.map(match => { const event = events.find(item => item.id === match.eventId); const left = competitors.find(item => item.id === match.competitorAId); const right = competitors.find(item => item.id === match.competitorBId); return <article className="upcoming-match-card" key={match.id}><div className="upcoming-match-event"><span className={`event-marker ${event?.status || "unknown"}`} /><div><strong>{event?.name ?? "Competition"}</strong><span>{match.division}</span></div><span className={`market-status ${match.status === "live" ? "live" : ""}`}>{match.status === "live" ? "Live now" : "Upcoming"}</span></div><div className="upcoming-pairing"><span>{left?.name ?? "Competitor TBA"}<small>{left?.academy ?? "Academy TBA"}</small></span><b>VS</b><span>{right?.name ?? "Competitor TBA"}<small>{right?.academy ?? "Academy TBA"}</small></span></div><div className="upcoming-match-footer"><span>{match.round}</span><span>{match.mat}</span><span><CalendarDays size={14} />{formatDateTime(match.scheduledAt)}</span><button type="button" className="text-button" onClick={() => { if (event) onSelectEvent(event.id); onCompetitions(); }}>View bracket <ExternalLink size={14} /></button></div></article>; })}</div> : <div className="panel empty-matchups"><strong>No upcoming matchups are published yet</strong><span>Choose a competition to see its bracket, or refresh event data to check for newly published pairings.</span><button type="button" className="primary-button" onClick={onCompetitions}>Browse competitions</button></div>}
  </section>;
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
          <span>{match.status === "live" ? "Live now · picks locked" : market.status === "open" && !disabled ? "Predictions open" : match.status === "settled" ? "Final" : "Upcoming · picks locked"}</span>
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

      <div className="fighter-options">
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
        {competitor.imageUrl ? (
          <img className="fighter-avatar" src={competitor.imageUrl} alt="" loading="lazy" />
        ) : (
          <div className="fighter-avatar fallback" aria-hidden="true">
            {initialsFor(competitor.name)}
          </div>
        )}
        {competitor.seed > 0 && <div className="seed-badge">#{competitor.seed}</div>}
        <div>
          <strong>{competitor.name}</strong>
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
          <h2>{ticketData.competitor.name}</h2>
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
                <strong>{competitor?.name ?? "Unknown competitor"}</strong>
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
              <span>{trade.side === "sell" ? "Sold" : "Bought"} · {competitor?.name ?? "Outcome"}</span>
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
