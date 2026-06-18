import { initialState, STARTING_BALANCE } from "./data";
import type { AppState } from "./types";

const STORAGE_KEY = "bjj-predict-state-v1";

export function loadState(): AppState {
  if (typeof window === "undefined") {
    return initialState;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return initialState;
  }

  try {
    const saved = JSON.parse(raw) as Partial<AppState>;

    return {
      balance: typeof saved.balance === "number" ? saved.balance : STARTING_BALANCE,
      competitors: saved.competitors?.length ? saved.competitors : initialState.competitors,
      events: saved.events?.length ? saved.events : initialState.events,
      markets: saved.markets?.length ? saved.markets : initialState.markets,
      matches: saved.matches?.length ? saved.matches : initialState.matches,
      predictions: Array.isArray(saved.predictions) ? saved.predictions : []
    };
  } catch {
    return initialState;
  }
}

export function saveState(state: AppState) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState() {
  window.localStorage.removeItem(STORAGE_KEY);
}
