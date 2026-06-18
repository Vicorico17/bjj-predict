import {
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
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Swords,
  Trophy,
  UploadCloud,
  UsersRound,
  Wallet,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { initialState } from "./data";
import {
  formatDateTime,
  formatPercent,
  getQuote,
  lockMarket,
  projectedPayout,
  quoteForCompetitor,
  settleMarket
} from "./market";
import { importSmoothcompEvent, parseSmoothcompEventId } from "./smoothcomp";
import { loadState, resetState, saveState } from "./storage";
import type { AppState, Competitor, Event, Market, Match, Prediction } from "./types";

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

function App() {
  const [state, setState] = useState<AppState>(() => loadState());
  const [view, setView] = useState<View>("markets");
  const [selectedEventId, setSelectedEventId] = useState(() => loadState().events[0]?.id ?? "");
  const [stake, setStake] = useState(100);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [smoothcompUrl, setSmoothcompUrl] = useState("https://smoothcomp.com/en/event/19240");
  const [settlementFinish, setSettlementFinish] = useState(finishOptions[0]);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const selectedEvent = state.events.find((event) => event.id === selectedEventId) ?? state.events[0];
  const selectedMatches = selectedEvent
    ? state.matches.filter((match) => match.eventId === selectedEvent.id)
    : state.matches;
  const selectedMarketIds = new Set(selectedMatches.map((match) => `mk-${match.id}`));
  const eventMarkets = state.markets.filter((market) => selectedMarketIds.has(market.id));
  const openMarkets = state.markets.filter((market) => market.status === "open");
  const activePredictions = state.predictions.filter((prediction) => prediction.status === "active");
  const settledPredictions = state.predictions.filter((prediction) => prediction.status === "settled");
  const resolvedWins = settledPredictions.filter((prediction) => prediction.won).length;
  const totalVolume = state.predictions.reduce((sum, prediction) => sum + prediction.stake, 0);

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

    const probability = quoteForCompetitor(market, match, state.predictions, competitor.id);

    return {
      market,
      match,
      competitor,
      probability,
      payout: projectedPayout(stake, probability)
    };
  }, [state, stake, ticket]);

  function getCompetitor(id: string) {
    return state.competitors.find((competitor) => competitor.id === id);
  }

  function placePrediction() {
    if (!selectedTicketData || stake <= 0 || stake > state.balance) {
      return;
    }

    const prediction: Prediction = {
      id: crypto.randomUUID(),
      marketId: selectedTicketData.market.id,
      matchId: selectedTicketData.match.id,
      competitorId: selectedTicketData.competitor.id,
      stake,
      impliedProbability: selectedTicketData.probability,
      payoutIfCorrect: selectedTicketData.payout,
      createdAt: new Date().toISOString(),
      status: "active"
    };

    setState((current) => ({
      ...current,
      balance: current.balance - stake,
      predictions: [prediction, ...current.predictions]
    }));
    setTicket(null);
  }

  function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const eventNumber = parseSmoothcompEventId(smoothcompUrl);
    setState((current) => importSmoothcompEvent(current, smoothcompUrl));
    if (eventNumber) {
      setSelectedEventId(`e-smoothcomp-${eventNumber}`);
    }
  }

  function syncSelectedEvent() {
    if (!selectedEvent) {
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
    setState(initialState);
    setSelectedEventId(initialState.events[0]?.id ?? "");
    setTicket(null);
  }

  const leaderboardRows = communityLeaderboard.map((row) => {
    if (row.name !== "You") {
      return row;
    }

    const hitRate = settledPredictions.length
      ? `${Math.round((resolvedWins / settledPredictions.length) * 100)}%`
      : "0%";

    return {
      ...row,
      score: state.balance + activePredictions.reduce((sum, prediction) => sum + prediction.payoutIfCorrect, 0),
      hitRate
    };
  });

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
            <span>Balance</span>
            <strong>{state.balance.toLocaleString()} pts</strong>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="eyebrow">BJJ-only launch wedge</span>
            <h1>Free-play prediction markets for grappling events</h1>
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
          <div className="hero-copy">
            <div className="status-row">
              <span className="status-pill live">
                <CircleDot size={12} aria-hidden="true" />
                Free-play
              </span>
              <span className="status-pill">
                <ShieldCheck size={12} aria-hidden="true" />
                BJJ markets only
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
          <div className="event-controls">
            <label htmlFor="eventSelect">Event</label>
            <select
              id="eventSelect"
              value={selectedEvent?.id ?? ""}
              onChange={(event) => setSelectedEventId(event.target.value)}
            >
              {state.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="metric-grid" aria-label="Market summary">
          <Metric icon={<CircleDollarSign size={18} />} label="Market volume" value={`${totalVolume.toLocaleString()} pts`} />
          <Metric icon={<Gauge size={18} />} label="Open markets" value={String(openMarkets.length)} />
          <Metric icon={<ListChecks size={18} />} label="Active picks" value={String(activePredictions.length)} />
          <Metric icon={<CheckCircle2 size={18} />} label="Settled picks" value={String(settledPredictions.length)} />
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
                  <label htmlFor="stake">Stake</label>
                  <input
                    id="stake"
                    min="25"
                    max="500"
                    step="25"
                    type="range"
                    value={stake}
                    onChange={(event) => setStake(Number(event.target.value))}
                  />
                  <strong>{stake} pts</strong>
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
                      predictions={state.predictions}
                      onPick={(competitorId) => setTicket({ marketId: market.id, competitorId })}
                    />
                  );
                })}
              </div>
            </section>

            <TicketPanel
              balance={state.balance}
              stake={stake}
              ticketData={selectedTicketData}
              onCancel={() => setTicket(null)}
              onConfirm={placePrediction}
            />
          </div>
        )}

        {view === "leaderboard" && (
          <section className="panel leaderboard-panel" aria-label="Leaderboards">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Community edge</span>
                <h2>Predictor leaderboard</h2>
              </div>
              <span className="small-note">Points, hit rate, and active ticket upside</span>
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
              </div>
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

type MetricProps = {
  icon: React.ReactNode;
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
  predictions: Prediction[];
  onPick: (competitorId: string) => void;
};

function MarketCard({ competitors, market, match, predictions, onPick }: MarketCardProps) {
  const quote = getQuote(market, match, predictions);
  const disabled = market.status !== "open";

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
        <span>{match.mat}</span>
        <span>{formatDateTime(match.scheduledAt)}</span>
        <span>{quote.totalVolume.toLocaleString()} pts</span>
      </div>

      <div className="fighter-options">
        <FighterOption
          competitor={competitors[0]}
          disabled={disabled}
          probability={quote.probabilityA}
          stake={quote.totalStakeA}
          won={match.winnerId === competitors[0].id}
          onPick={() => onPick(competitors[0].id)}
        />
        <div className="versus">vs</div>
        <FighterOption
          competitor={competitors[1]}
          disabled={disabled}
          probability={quote.probabilityB}
          stake={quote.totalStakeB}
          won={match.winnerId === competitors[1].id}
          onPick={() => onPick(competitors[1].id)}
        />
      </div>

      <div className="probability-bar" aria-label="Market implied probabilities">
        <span style={{ width: `${Math.round(quote.probabilityA * 100)}%` }} />
        <span style={{ width: `${Math.round(quote.probabilityB * 100)}%` }} />
      </div>
    </article>
  );
}

type FighterOptionProps = {
  competitor: Competitor;
  disabled: boolean;
  probability: number;
  stake: number;
  won: boolean;
  onPick: () => void;
};

function FighterOption({ competitor, disabled, probability, stake, won, onPick }: FighterOptionProps) {
  return (
    <div className={won ? "fighter-option winner" : "fighter-option"}>
      <div className="fighter-main">
        <div className="seed-badge">#{competitor.seed}</div>
        <div>
          <strong>{competitor.name}</strong>
          <span>{competitor.academy}</span>
        </div>
      </div>
      <div className="fighter-stats">
        <span>{competitor.belt} belt</span>
        <span>{competitor.record}</span>
        <span>{stake.toLocaleString()} pts</span>
      </div>
      <button className="pick-button" disabled={disabled} onClick={onPick} type="button">
        {won ? <Trophy size={16} aria-hidden="true" /> : <CircleDollarSign size={16} aria-hidden="true" />}
        <span>{formatPercent(probability)}</span>
      </button>
    </div>
  );
}

type TicketPanelProps = {
  balance: number;
  stake: number;
  ticketData: {
    market: Market;
    match: Match;
    competitor: Competitor;
    probability: number;
    payout: number;
  } | null;
  onCancel: () => void;
  onConfirm: () => void;
};

function TicketPanel({ balance, stake, ticketData, onCancel, onConfirm }: TicketPanelProps) {
  if (!ticketData) {
    return (
      <aside className="ticket-panel empty" aria-label="Prediction ticket">
        <CircleDollarSign size={24} aria-hidden="true" />
        <h2>Prediction ticket</h2>
        <p>Select a competitor price to stage a pick.</p>
      </aside>
    );
  }

  const disabled = stake > balance || ticketData.market.status !== "open";

  return (
    <aside className="ticket-panel" aria-label="Prediction ticket">
      <div className="ticket-header">
        <div>
          <span className="eyebrow">Ticket</span>
          <h2>{ticketData.competitor.name}</h2>
        </div>
        <button className="icon-only" onClick={onCancel} type="button" aria-label="Clear ticket">
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <dl className="ticket-lines">
        <div>
          <dt>Stake</dt>
          <dd>{stake} pts</dd>
        </div>
        <div>
          <dt>Market price</dt>
          <dd>{formatPercent(ticketData.probability)}</dd>
        </div>
        <div>
          <dt>Payout</dt>
          <dd>{ticketData.payout.toLocaleString()} pts</dd>
        </div>
        <div>
          <dt>Balance after</dt>
          <dd>{Math.max(balance - stake, 0).toLocaleString()} pts</dd>
        </div>
      </dl>
      <button className="primary-button full" disabled={disabled} onClick={onConfirm} type="button">
        <CheckCircle2 size={17} aria-hidden="true" />
        <span>Place prediction</span>
      </button>
    </aside>
  );
}

export default App;
