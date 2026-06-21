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
  Link,
  ListChecks,
  LockKeyhole,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Swords,
  Trophy,
  TrendingUp,
  UploadCloud,
  UsersRound,
  Wallet,
  X
} from "lucide-react";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { initialState } from "./data";
import smoothcompLiveSnapshot from "./generated/smoothcomp-live-snapshot.json";
import {
  formatDateTime,
  formatPercent,
  getOwnedShares,
  getQuote,
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
  importSmoothcompEvent,
  parseSmoothcompEventId,
  summarizeSmoothcompSnapshot,
  type SmoothcompSnapshot
} from "./smoothcomp";
import { loadState, resetState, saveState } from "./storage";
import type { AppState, Competitor, Event as AppEvent, Market, Match, Position, TradeQuote, TradeSide } from "./types";

type View = "markets" | "leaderboard" | "admin";

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

function hydrateStateFromSnapshot(baseState: AppState, snapshot = smoothcompSnapshot) {
  const hydrated = applySmoothcompSnapshot(baseState, snapshot);
  return { ...hydrated, positions: markPositions(hydrated) };
}

function App() {
  const [state, setState] = useState<AppState>(() => hydrateStateFromSnapshot(loadState()));
  const [latestSmoothcompSnapshot, setLatestSmoothcompSnapshot] = useState<SmoothcompSnapshot>(smoothcompSnapshot);
  const [view, setView] = useState<View>("markets");
  const [selectedEventId, setSelectedEventId] = useState(() => hydrateStateFromSnapshot(loadState()).events[0]?.id ?? "");
  const [tradeSide, setTradeSide] = useState<TradeSide>("buy");
  const [amount, setAmount] = useState(100);
  const [sellShares, setSellShares] = useState(1);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [smoothcompUrl, setSmoothcompUrl] = useState("https://smoothcomp.com/en/event/19240");
  const [settlementFinish, setSettlementFinish] = useState(finishOptions[0]);
  const [syncNotice, setSyncNotice] = useState("");
  const [syncNoticeType, setSyncNoticeType] = useState<"muted" | "warning" | "error">("muted");
  const [isRefreshingSmoothcomp, setIsRefreshingSmoothcomp] = useState(false);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const selectedEvent = state.events.find((event) => event.id === selectedEventId) ?? state.events[0];
  const selectedMatches = selectedEvent
    ? state.matches.filter((match) => match.eventId === selectedEvent.id)
    : state.matches;
  const selectedMatchIds = new Set(selectedMatches.map((match) => match.id));
  const eventMarkets = state.markets.filter((market) => selectedMatchIds.has(market.matchId));
  const openMarkets = state.markets.filter((market) => market.status === "open");
  const totalVolume = state.markets.reduce((sum, market) => sum + market.volume, 0);
  const activePositions = state.positions.filter((position) => position.shares > 0 && !position.isResolved);
  const portfolioMarkValue = state.positions.reduce((sum, position) => sum + position.markValue, 0);
  const portfolioValue = roundMoney(state.balance + portfolioMarkValue);
  const smoothcompSummary = useMemo(() => summarizeSmoothcompSnapshot(latestSmoothcompSnapshot), [latestSmoothcompSnapshot]);
  const eventGroups = useMemo(() => {
    const byDate = (left: AppEvent, right: AppEvent) =>
      new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime();
    const byDateOnly = (events: AppEvent[]) => [...events].sort(byDate);

    return [
      {
        id: "current",
        label: "Current events",
        events: byDateOnly(state.events.filter((event) => event.status === "live"))
      },
      {
        id: "upcoming",
        label: "Upcoming events",
        events: byDateOnly(state.events.filter((event) => event.status === "upcoming"))
      },
      {
        id: "complete",
        label: "Completed events",
        events: byDateOnly(state.events.filter((event) => event.status === "complete"))
      }
    ];
  }, [state.events]);

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

  function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const eventNumber = parseSmoothcompEventId(smoothcompUrl);
    setState((current) => hydrateStateFromSnapshot(importSmoothcompEvent(current, smoothcompUrl, latestSmoothcompSnapshot), latestSmoothcompSnapshot));
    if (eventNumber) {
      setSelectedEventId(`e-smoothcomp-${eventNumber}`);
    }
  }

  function applyLatestSmoothcompSnapshot(
    options: { eventId?: string; sourceEventId?: string } = {},
    snapshot = latestSmoothcompSnapshot
  ) {
    const targetEventId =
      options.eventId || (options.sourceEventId ? `e-smoothcomp-${options.sourceEventId}` : snapshot.events[0]?.id);
    const summary = summarizeSmoothcompSnapshot(snapshot);

    setState((current) => {
      const next = applySmoothcompSnapshot(current, snapshot, options);
      return { ...next, positions: markPositions(next) };
    });

    if (targetEventId) {
      setSelectedEventId(targetEventId);
    }

    setSyncNotice(
      `Applied ${summary.eventCount} events and ${summary.matchCount} matches from the latest Smoothcomp snapshot.`
    );
    setSyncNoticeType("muted");
  }

  async function refreshSmoothcompSnapshot() {
    setIsRefreshingSmoothcomp(true);
    setSyncNotice("Refreshing all Smoothcomp games. This can take a while when many brackets are published.");
    setSyncNoticeType("warning");

    try {
      let payload = await readSmoothcompRefreshResponse(await fetch("/api/smoothcomp/refresh", { method: "POST" }));

      while (payload.status === "running") {
        await delay(3000);
        payload = await readSmoothcompRefreshResponse(await fetch("/api/smoothcomp/refresh"));
        if (payload.startedAt) {
          const elapsedSeconds = Math.max(1, Math.round((Date.now() - Date.parse(payload.startedAt)) / 1000));
          setSyncNotice(`Refreshing all Smoothcomp games. Running for ${elapsedSeconds}s.`);
        }
      }

      if (payload.status === "error" || !payload.snapshot) {
        throw new Error(payload.error || "Smoothcomp refresh failed");
      }

      const freshSnapshot = payload.snapshot;
      const summary = summarizeSmoothcompSnapshot(freshSnapshot);
      setLatestSmoothcompSnapshot(freshSnapshot);
      applyLatestSmoothcompSnapshot(
        selectedEvent?.source === "smoothcomp" ? { eventId: selectedEvent.id } : {},
        freshSnapshot
      );
      setSyncNotice(
        `Refreshed from Smoothcomp and applied ${summary.eventCount} events, ${summary.matchCount} matches, ${summary.liveCount} live, and ${summary.settledCount} settled.`
      );
      setSyncNoticeType("muted");
    } catch (error) {
      setSyncNotice(error instanceof Error ? error.message : "Smoothcomp refresh failed");
      setSyncNoticeType("error");
    } finally {
      setIsRefreshingSmoothcomp(false);
    }
  }

  async function readSmoothcompRefreshResponse(response: Response) {
    const responseText = await response.text();
    let payload: Record<string, unknown> = {};

    if (responseText) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        const isHtml = responseText.trim().startsWith("<");
        const preview = responseText.trim().replace(/\s+/g, " ").slice(0, 140);
        const fallback = isHtml
          ? "Smoothcomp refresh API is not available at this URL. Run npm run dev and open http://127.0.0.1:5173/."
          : `Smoothcomp refresh returned a non-JSON server response: ${preview || "empty response"}`;
        throw new Error(fallback);
      }
    }

    if (!response.ok) {
      const fallback =
        response.status === 404
          ? "Smoothcomp refresh is only available from the Vite dev server. Run npm run dev and open that local URL."
          : "Smoothcomp refresh failed";
      throw new Error(typeof payload.error === "string" ? payload.error : fallback);
    }

    return payload as {
      status?: "idle" | "running" | "complete" | "error";
      startedAt?: string | null;
      snapshot?: SmoothcompSnapshot;
      error?: string;
    };
  }

  function delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function syncSelectedEvent() {
    if (!selectedEvent) {
      return;
    }

    if (selectedEvent.source === "smoothcomp") {
      applyLatestSmoothcompSnapshot({ eventId: selectedEvent.id });
      return;
    }

    setState((current) => ({
      ...current,
      events: current.events.map((event) =>
        event.id === selectedEvent.id ? { ...event, lastSyncedAt: new Date().toISOString() } : event
      )
    }));
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
            className={view === "markets" ? "nav-button active" : "nav-button"}
            onClick={() => setView("markets")}
            type="button"
          >
            <BarChart3 size={18} aria-hidden="true" />
            <span>Markets</span>
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
            <span className="status-pill live">
              <RefreshCw size={12} aria-hidden="true" />
              Smoothcomp sync
            </span>
            <span>{smoothcompSummary.eventCount} events</span>
            <span>{smoothcompSummary.matchCount} matches</span>
            <span>{smoothcompSummary.liveCount} live</span>
            <span>{smoothcompSummary.settledCount} settled</span>
          </div>
          <div className="topbar-actions">
            <a className="icon-link" href={selectedEvent?.sourceUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={17} aria-hidden="true" />
              <span>Smoothcomp</span>
            </a>
            <button className="ghost-button" onClick={handleReset} type="button">
              <RotateCcw size={17} aria-hidden="true" />
              <span>Reset demo</span>
            </button>
          </div>
        </header>

        <section className="event-hero" aria-label="Selected event">
          <EventSwitcher
            groups={eventGroups}
            selectedEventId={selectedEvent?.id ?? ""}
            onSelect={(eventId) => setSelectedEventId(eventId)}
          />
          <div className="hero-copy">
            <div className="status-row">
              <span className="status-pill live">
                <CircleDot size={12} aria-hidden="true" />
                Free-play
              </span>
              <span className="status-pill">
                <ShieldCheck size={12} aria-hidden="true" />
                LMSR AMM
              </span>
            </div>
            <h2>{selectedEvent?.name ?? "No event selected"}</h2>
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
        </section>

        <section className="metric-grid" aria-label="Market summary">
          <Metric icon={<CircleDollarSign size={18} />} label="Market volume" value={`${totalVolume.toLocaleString()} pts`} />
          <Metric icon={<Gauge size={18} />} label="Open markets" value={String(openMarkets.length)} />
          <Metric icon={<ListChecks size={18} />} label="Open positions" value={String(activePositions.length)} />
          <Metric icon={<CheckCircle2 size={18} />} label="Portfolio value" value={`${portfolioValue.toLocaleString()} pts`} />
        </section>

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
            <div className="panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">Data source</span>
                  <h2>Smoothcomp import</h2>
                </div>
                <UploadCloud size={20} aria-hidden="true" />
              </div>
              <form className="import-form" onSubmit={handleImport}>
                <label htmlFor="smoothcompUrl">Event URL</label>
                <div className="url-row">
                  <Link size={18} aria-hidden="true" />
                  <input
                    id="smoothcompUrl"
                    placeholder="https://smoothcomp.com/en/event/..."
                    type="url"
                    value={smoothcompUrl}
                    onChange={(event) => setSmoothcompUrl(event.target.value)}
                  />
                </div>
                <button className="primary-button" type="submit">
                  <UploadCloud size={17} aria-hidden="true" />
                  <span>Import event</span>
                </button>
              </form>
              <div className="admin-actions">
                <button className="ghost-button" type="button" onClick={syncSelectedEvent}>
                  <RefreshCw size={17} aria-hidden="true" />
                  <span>Sync selected</span>
                </button>
                <button
                  className="primary-button"
                  type="button"
                  disabled={isRefreshingSmoothcomp}
                  onClick={refreshSmoothcompSnapshot}
                >
                  <RefreshCw className={isRefreshingSmoothcomp ? "spin-icon" : undefined} size={17} aria-hidden="true" />
                  <span>{isRefreshingSmoothcomp ? "Refreshing..." : "Refresh all games"}</span>
                </button>
                <button className="primary-button" type="button" onClick={() => applyLatestSmoothcompSnapshot()}>
                  <DatabaseZap size={17} aria-hidden="true" />
                  <span>Apply snapshot</span>
                </button>
              </div>
              <div className="snapshot-summary">
                <div>
                  <strong>Latest Smoothcomp snapshot</strong>
                  <span>
                    {smoothcompSummary.eventCount} events · {smoothcompSummary.matchCount} matches ·{" "}
                    {smoothcompSummary.liveCount} live · {smoothcompSummary.settledCount} settled
                  </span>
                </div>
                <span>{smoothcompSummary.syncedAt ? formatDateTime(smoothcompSummary.syncedAt) : "Not synced yet"}</span>
              </div>
              {syncNotice && <div className={`ticket-alert ${syncNoticeType}`}>{syncNotice}</div>}
            </div>

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
  return (
    <div className="event-switcher" aria-label="Event switcher">
      <div className="event-switcher-head">
        <div>
          <span className="eyebrow">Events</span>
          <strong>Current and upcoming</strong>
        </div>
        <span>{groups.reduce((count, group) => count + group.events.length, 0)} events</span>
      </div>
      <div className="event-group-grid">
        {groups
          .filter((group) => group.id !== "complete" || group.events.length > 0)
          .map((group) => (
            <div className="event-group" key={group.id}>
              <div className="event-group-label">
                <span>{group.label}</span>
                <strong>{group.events.length}</strong>
              </div>
              <div className="event-button-list">
                {group.events.length > 0 ? (
                  group.events.map((event) => (
                    <button
                      className={event.id === selectedEventId ? "event-choice-button active" : "event-choice-button"}
                      key={event.id}
                      onClick={() => onSelect(event.id)}
                      type="button"
                    >
                      <strong>{event.name}</strong>
                      <span>
                        {formatDateTime(event.startsAt)} · {event.city}
                      </span>
                    </button>
                  ))
                ) : (
                  <button className="event-choice-button empty" disabled type="button">
                    <strong>No {group.id} events</strong>
                    <span>Nothing synced in this group</span>
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
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
  const disabled = market.status !== "open";
  const matchScore = formatMatchScore(match.score);

  return (
    <article className="market-card">
      <div className="market-card-top">
        <div>
          <span className="eyebrow">{match.division}</span>
          <h3>{match.round}</h3>
        </div>
        <div className={`market-status ${market.status}`}>
          {market.status === "open" ? <CircleDot size={13} aria-hidden="true" /> : <LockKeyhole size={13} aria-hidden="true" />}
          <span>{market.status}</span>
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
        <span>Volume/risk {quote.volumeToRisk.toFixed(1)}x · liquidity parameter {market.liquidity}</span>
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
        <div className="seed-badge">#{competitor.seed}</div>
        <div>
          <strong>{competitor.name}</strong>
          <span className="fighter-academy">
            {competitor.clubLogoUrl && <img src={competitor.clubLogoUrl} alt="" loading="lazy" />}
            {competitor.academy}
          </span>
        </div>
      </div>
      <div className="fighter-stats">
        <span>{competitor.belt} belt</span>
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
    ticketData.market.status !== "open" ||
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
