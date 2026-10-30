import type { Event } from './types';

// Verified against the organizer's event page and published tournament draw.
export const featuredChampionship: Event = {
  id: 'e-ibjjf-3313', sport: 'bjj', source: 'ibjjf',
  name: 'European IBJJF Jiu-Jitsu No-Gi Championship 2026',
  organizer: 'IBJJF', city: 'Lido di Ostia, Rome, Italy',
  venue: 'PalaPellicone · Viale della Stazione di Castel Fusano, 30',
  startsAt: '2026-10-28T00:00:00+01:00', endsAt: '2026-11-01T23:59:59+01:00',
  sourceUrl: 'https://www.bjjcompsystem.com/tournaments/3313/categories',
  officialUrl: 'https://ibjjf.com/events/european-ibjjf-jiu-jitsu-no-gi-championship-2026',
  status: 'unknown', lastSyncedAt: '2026-10-30T00:00:00Z',
  coverage: { level: 'discovered', matchCount: 0, scoredMatches: 0, liveScores: false },
};
export const featuredChampionshipLink = `#/app/competitions/${featuredChampionship.id}`;

export function linkedCompetitionId(hash: string) {
  const parts = hash.split('/');
  if (parts[1] !== 'app' || parts[2] !== 'competitions') return undefined;
  // Preserve links from the original calendar-only homepage.
  return parts[3] === 'e-bjjcalendar-2155' ? featuredChampionship.id : parts[3] || undefined;
}

export function withFeaturedChampionship(events: Event[]): Event[] {
  const existing = events.find(event => event.id === featuredChampionship.id);
  return [...events.filter(event => ![featuredChampionship.id, 'e-bjjcalendar-2155'].includes(event.id)),
    { ...featuredChampionship, ...existing, name: featuredChampionship.name,
      organizer: featuredChampionship.organizer, city: featuredChampionship.city, venue: featuredChampionship.venue,
      startsAt: featuredChampionship.startsAt, endsAt: featuredChampionship.endsAt,
      sourceUrl: featuredChampionship.sourceUrl, officialUrl: featuredChampionship.officialUrl }];
}
