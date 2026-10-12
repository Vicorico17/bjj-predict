import type { Competitor, Event, Match } from "./types";

const DAY = 24 * 60 * 60 * 1000;

export function isPastCompetition(event: Event, now = Date.now()) {
  // Completion reported on 12 October; the listing only publishes a start time.
  if (event.id === "e-gosofia-2387" && now >= Date.parse("2026-10-12T00:00:00+03:00")) return true;
  const end = Date.parse(event.endsAt || "");
  const start = Date.parse(event.startsAt);
  return event.status === "complete" || (Number.isFinite(end) ? end < now : Number.isFinite(start) && start + DAY < now);
}

export function competitionImportance(event: Pick<Event, "name" | "source"> & { organizer?: string }) {
  const name = `${event.name} ${event.organizer || ""}`;
  if (/world championship|worlds|world cup|adcc world|craig jones invitational|\bcji\b/i.test(name)) return 5;
  if (event.source === "one" || event.source === "ufcbjj" || event.source === "curated" ||
      /grand prix|grand slam|\bwno\b|who.?s number one|polaris|\bebi\b|eddie bravo invitational|\bquintet\b|adcc.*trials|european.*championship|pan.?american|\bpan\b.*championship|continental championship|asian.*championship|african.*championship/i.test(name)) return 4;
  if (/national.*championship|national tournament|national pro|continental open/i.test(name)) return 3;
  if (/regional|state championship|city championship|open/i.test(name)) return 2;
  return 1;
}

export function isMajorCompetition(event: Pick<Event, "name" | "source"> & { organizer?: string }) {
  return competitionImportance(event) >= 4;
}

export function currentEvents(events: Event[], now = Date.now()) {
  return events.filter(event => event.source !== "manual" && !/\b(cancelled|canceled)\b/i.test(event.name) &&
    !isPastCompetition(event, now) && (Number.isFinite(Date.parse(event.startsAt)) || event.status === "unknown"))
    .map(event => ({ ...event, status: !Number.isFinite(Date.parse(event.startsAt)) ? "unknown" as const : Date.parse(event.startsAt) > now ? "upcoming" as const : event.status === "live" && event.coverage?.liveScores && now - Date.parse(event.lastSyncedAt) >= 0 && now - Date.parse(event.lastSyncedAt) < 45000 ? "live" as const : "unknown" as const }))
    .sort((a, b) => Number(b.status === "live") - Number(a.status === "live") ||
      Date.parse(a.startsAt) - Date.parse(b.startsAt) || competitionImportance(b) - competitionImportance(a));
}

// A published start is an estimate. Keep unresolved bouts visible until the
// event ends, including cards without individual bout times or an end time.
export function isCurrentMatch(match: Match, events: Event[], now = Date.now()) {
  if (match.sourceState === "withdrawn" || match.status === "settled" || match.winnerId) return false;
  const event = events.find(item => item.id === match.eventId);
  if (event) {
    if (event.source === "manual" || /\b(cancelled|canceled)\b/i.test(event.name) || isPastCompetition(event, now)) return false;
    if (Number.isFinite(Date.parse(event.startsAt))) return true;
  }
  const scheduled = Date.parse(match.scheduledAt);
  return Number.isFinite(scheduled) && (scheduled >= now || match.status === "live" && scheduled + DAY >= now);
}

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

export function searchCompetitions(events: Event[], matches: Match[], competitors: Competitor[], query: string) {
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return events;
  const names = new Map(competitors.map(competitor => [competitor.id, competitor.name]));
  const participants = new Map<string, Set<string>>();
  for (const match of matches) {
    const set = participants.get(match.eventId) || new Set<string>();
    set.add(names.get(match.competitorAId) || "");
    set.add(names.get(match.competitorBId) || "");
    participants.set(match.eventId, set);
  }
  return events.filter(event => {
    const text = normalizeSearch([event.name, event.city, event.venue, event.organizer,
      ...(event.participants || []).map(player => `${player.name} ${player.academy}`), ...(participants.get(event.id) || [])].filter(Boolean).join(" "));
    return terms.every(term => text.includes(term));
  });
}

export function hasFreshLiveMatch(match: Match, events: Event[], now = Date.now()) {
  const age = now - Date.parse(match.sourceObservedAt || "");
  const event = events.find(event => event.id === match.eventId);
  return match.status === "live" && Number.isFinite(age) && age >= 0 && age < 45000 && (!event || !isPastCompetition(event, now));
}
