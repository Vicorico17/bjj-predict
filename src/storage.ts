import { initialState, STARTING_BALANCE } from "./data";
import type { AppState } from "./types";

const STORAGE_KEY = "bjj-predict-state-v2";

export function loadState(): AppState {
  if (typeof window === "undefined") {
    return initialState;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const saved = JSON.parse(raw) as Partial<AppState>;

    return {
      balance: typeof saved.balance === "number" ? saved.balance : STARTING_BALANCE,
      competitors: Array.isArray(saved.competitors) ? saved.competitors : initialState.competitors,
      events: Array.isArray(saved.events) ? saved.events : initialState.events,
      markets: Array.isArray(saved.markets) ? saved.markets : initialState.markets,
      matches: Array.isArray(saved.matches) ? saved.matches : initialState.matches,
      positions: Array.isArray(saved.positions) ? saved.positions : [],
      trades: Array.isArray(saved.trades) ? saved.trades : []
    };
  } catch {
    return initialState;
  }
}

// Tournament draws are a replaceable cache. Never let them crowd out personal records.
export function compactState(state: AppState, cacheLimit = 150): AppState {
  const protectedIds = new Set([...state.positions, ...state.trades].map(item => item.matchId));
  try {
    const picks = JSON.parse(window.localStorage.getItem("bjj-predict-winner-picks-v1") || "{}");
    for (const id of Object.keys(picks)) protectedIds.add(id);
  } catch { /* Storage access is checked by saveState below. */ }
  const optional = new Set((cacheLimit > 0 ? state.matches.slice(-cacheLimit) : []).map(match => match.id));
  const matches = state.matches.filter(match => protectedIds.has(match.id) || optional.has(match.id));
  const matchIds = new Set(matches.map(match => match.id));
  const competitorIds = new Set(matches.flatMap(match => [match.competitorAId, match.competitorBId]));
  const eventIds = new Set(matches.map(match => match.eventId));
  return {
    ...state,
    matches,
    markets: state.markets.filter(market => matchIds.has(market.matchId)),
    competitors: state.competitors.filter(competitor => competitorIds.has(competitor.id)),
    events: state.events.filter((event, index) => eventIds.has(event.id) || cacheLimit > 0 && index < 200)
      .map(({ participants, brackets, participantsStatus, coverage, ...event }) => ({ ...event,
        ...(coverage ? { coverage: { ...coverage, importedBrackets: 0, nextBracketOffset: 0 } } : {})
      }))
  };
}

export function saveState(state: AppState) {
  for (const limit of [150, 0]) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(compactState(state, limit)));
      return true;
    } catch { /* Retry with personal records only when the optional cache is too large. */ }
  }
  return false;
}

export function resetState() {
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Reset in memory still works. */ }
}
