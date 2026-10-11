import { cachedSmoothcompText } from "./lib/smoothcomp-cache.mjs";
import { load } from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { allowedSourceUrl, createSourceClient, finiteScore, coverage } from "./lib/source-http.mjs";

import { bracketSummary, publishedDraw, parsePublicParticipants } from "./lib/smoothcomp-competition.mjs";

const CALENDAR_URL = "https://smoothcomp.com/en/events/upcoming";
const GRAPPLING_CATEGORY_GROUPS = new Set(["1", "3", "4", "7", "24"]);
const DEFAULT_OUTPUT = "src/generated/smoothcomp-live-snapshot.json";
export function createSmoothcompWorker(args = [], { persist = false, fetchImpl = fetch, maxRequests = 400, pauseMs = 100 } = {}) {
const options = parseArgs(args);
const warnings = [];
const client = createSourceClient({ fetchImpl, maxRequests, pauseMs, timeoutMs: 10000 });

async function main() {
  const startedAt = new Date().toISOString();
  const discoveredEvents = await discoverEvents();
  const selectedEvents = selectEvents(discoveredEvents);
  const snapshotEvents = [];
  const stats = {
    discoveredEvents: discoveredEvents.length,
    importedEvents: 0,
    importedMatches: 0,
    liveMatches: 0,
    settledMatches: 0,
    failedEvents: 0,
    failedBrackets: 0,
    failedLiveScores: 0,
    failedMatchDetails: 0
  };

  for (const event of selectedEvents) {
    try {
      const syncedEvent = await syncEvent(event, stats);
      snapshotEvents.push(syncedEvent);
      stats.importedEvents += 1;
      stats.importedMatches += syncedEvent.matches.length;
      stats.liveMatches += syncedEvent.matches.filter((match) => match.status === "live").length;
      stats.settledMatches += syncedEvent.matches.filter((match) => match.status === "settled").length;
    } catch (error) {
      stats.failedEvents += 1;
      warnings.push(`Failed to sync event ${event.id || event.url}: ${messageFor(error)}`);
    }
  }

  const snapshot = {
    source: new URL(options.calendarUrl).hostname.includes("ajptour.com") ? "ajp" : "smoothcomp",
    syncedAt: startedAt,
    calendarUrl: options.calendarUrl,
    events: snapshotEvents,
    stats,
    warnings
  };

  if (persist) {
    await mkdir(path.dirname(options.output), { recursive: true });
    await writeFile(options.output, `${JSON.stringify(snapshot, null, 2)}\n`);
  }

  if (persist) console.log(
    `Smoothcomp snapshot wrote ${stats.importedEvents} events, ${stats.importedMatches} matches, ` +
      `${stats.liveMatches} live, ${stats.settledMatches} settled -> ${options.output}`
  );

  if (persist && warnings.length > 0) {
    console.warn(`Warnings: ${warnings.length}`);
  }

  return snapshot;
}

async function discoverEvents() {
  if (options.eventUrls.length > 0) {
    return options.eventUrls.map((urlOrId) => eventSeedFromInput(urlOrId));
  }

  const html = await fetchText(options.calendarUrl);
  const events = parseCalendarEvents(html)
    .filter((event) => !event.eventEnded)
    .filter((event) => hasGrapplingCategory(event.categoryGroups) || /\bbjj\b|jiu[ -]?jitsu|grappling|\badcc\b/i.test(event.title || ""))
    .sort((left, right) => Number(left.days_to_start ?? 0) - Number(right.days_to_start ?? 0));

  return events;
}

function selectEvents(events) {
  if (!Number.isFinite(options.eventLimit)) {
    return events;
  }

  return events.slice(0, options.eventLimit);
}

async function syncEvent(calendarEvent, stats) {
  const sourceEventId = String(calendarEvent.id || parseSmoothcompEventId(calendarEvent.url));
  const eventUrl = canonicalEventUrl(calendarEvent.url || sourceEventId);
  const eventBase = eventUrl.replace(/\/$/, "");
  const origin = new URL(eventUrl).origin;
  const source = new URL(eventUrl).hostname.includes("ajptour.com") ? "ajp" : "smoothcomp";
  const eventWarnings = [];
  let sportsEvent = null;
  const bracketRequest = fetchJson(`${eventBase}/schedule/brackets.json`).then(data => ({ data }), error => ({ error }));

  try {
    const eventHtml = await fetchText(eventUrl);
    sportsEvent = parseSportsEvent(eventHtml);
  } catch (error) {
    eventWarnings.push(`Event page metadata unavailable: ${messageFor(error)}`);
  }

  const startsAt = sportsEvent?.startDate || dateToIso(calendarEvent.startdate) || "";
  const endsAt = sportsEvent?.endDate || dateToIso(calendarEvent.enddate, true) || "";
  const eventSnapshot = {
    id: `e-${source}-${sourceEventId}`,
    source,
    sourceEventId,
    name: sportsEvent?.name || calendarEvent.title || `Smoothcomp Event ${sourceEventId}`,
    organizer: sportsEvent?.organizer?.name || "Smoothcomp",
    city: locationCityFor(calendarEvent, sportsEvent),
    venue: sportsEvent?.location?.name || "",
    country: calendarEvent.location_country_human || calendarEvent.location_country || "",
    startsAt,
    endsAt,
    sourceUrl: eventUrl,
    status: eventStatusFor(startsAt, endsAt, calendarEvent.eventEnded),
    categoryGroups: calendarEvent.categoryGroups || [],
    coverImage: calendarEvent.cover_image || sportsEvent?.image || "",
    matches: [],
    participants: [],
    brackets: [],
    warnings: eventWarnings
  };

  const brackets = await fetchEventBrackets(eventBase, eventSnapshot, stats, bracketRequest);
  eventSnapshot.brackets = brackets.map(bracket => bracketSummary(bracket, eventBase));
  if (options.participants) {
    try {
      const result = await fetchPublicParticipants(eventBase);
      eventSnapshot.participants = result.participants;
      eventSnapshot.participantsStatus = result.warning ? 'unavailable' : 'published';
      if (result.warning) eventWarnings.push(result.warning);
    } catch (error) { eventSnapshot.participantsStatus = 'unavailable'; eventWarnings.push(`Athlete list unavailable: ${messageFor(error)}`); }
  }
  let liveScoreRequests = 0, successfulLiveScores = 0;

  let importedBrackets = 0, attemptedBrackets = 0;
  for (const bracket of limitItems(brackets.slice(options.bracketOffset), options.bracketLimit)) {
    if (eventSnapshot.matches.length >= options.matchLimit) break;
    attemptedBrackets += 1;
    const bracketId = String(bracket.bracket_id || bracket.id || "");

    if (!bracketId) {
      continue;
    }

    try {
      await pause();
      const bracketData = await fetchJson(`${eventBase}/schedule/new/bracket.json/${bracketId}`);
      if (!Array.isArray(bracketData.matches)) throw new Error("Invalid bracket matches response");
      importedBrackets += 1;
      const rawMatches = bracketData.matches;
      const draw = publishedDraw(bracket, rawMatches, eventBase);
      eventSnapshot.brackets = eventSnapshot.brackets.map(item => item.sourceId === draw.sourceId ? draw : item);
      for (const bout of draw.bouts) for (const seat of bout.seats) {
        if (seat.participant && !eventSnapshot.participants.some(player => player.sourceId === seat.participant.sourceId && player.division === seat.participant.division)) eventSnapshot.participants.push(seat.participant);
      }

      // Prioritize active scoreboards, then published finals; upcoming bouts need no score request.
      const active = match => /^(started|running|current|live|ongoing|paused)$/i.test(match.state);
      const scoreCandidates = rawMatches.filter(match => match.id && (!options.liveOnly || active(match) || /^(finished|completed|ended|end)$/i.test(match.state)))
        .sort((a, b) => Number(active(b)) - Number(active(a)))
        .slice(0, Math.max(0, options.liveScoreLimit - liveScoreRequests));
      const liveResults = new Map();
      liveScoreRequests += scoreCandidates.length;
      for (let index = 0; index < scoreCandidates.length; index += 3) {
        await Promise.all(scoreCandidates.slice(index, index + 3).map(async match => {
          try { liveResults.set(match.id, await fetchJson(`${origin}/en/getBracketMatchData/${match.id}`)); successfulLiveScores++; }
          catch (error) {
            stats.failedLiveScores++;
            eventWarnings.push(`Live score data unavailable for match ${match.id}: ${messageFor(error)}`);
          }
        }));
      }
      if (options.liveOnly && rawMatches.filter(active).length > scoreCandidates.filter(active).length) eventWarnings.push('Some active scoreboards exceed this page’s refresh limit.');

      for (const rawMatch of rawMatches) {
        if (Number.isFinite(options.matchLimit) && eventSnapshot.matches.length >= options.matchLimit) {
          break;
        }

        const liveData = liveResults.get(rawMatch.id) || null;
        let detailData = null;

        if (options.details) try {
          await pause();
          detailData = await fetchJson(`${origin}/en/getBracketMatch/${rawMatch.id}`);
        } catch (error) {
          stats.failedMatchDetails += 1;
          eventWarnings.push(`Athlete detail unavailable for match ${rawMatch.id}: ${messageFor(error)}`);
        }

        const normalized = normalizeMatch(rawMatch, liveData, detailData, bracket, eventSnapshot, eventBase);

        if (normalized) {
          eventSnapshot.matches.push(normalized);
          const bout = draw.bouts.find(item => item.sourceId === normalized.sourceMatchId);
          if (bout) {
            bout.score = normalized.score;
            bout.clock = normalized.liveClock || bout.clock;
            bout.finish = normalized.finish || bout.finish;
            bout.state = normalized.sourceState;
            if (normalized.winnerSide) bout.seats.forEach((seat, index) => { seat.winner = index === (normalized.winnerSide === 'left' ? 0 : 1); });
          }
        }
      }
    } catch (error) {
      stats.failedBrackets += 1;
      eventWarnings.push(`Bracket ${bracketId} unavailable: ${messageFor(error)}`);
    }
  }

  eventSnapshot.coverage = coverage(eventSnapshot.matches, {
    totalBrackets: brackets.length, importedBrackets,
    nextBracketOffset: Math.min(options.bracketOffset + attemptedBrackets, brackets.length),
    level: eventWarnings.length ? "partial" : importedBrackets < brackets.length || eventSnapshot.matches.length >= options.matchLimit ? "limited" : "published",
    liveScores: successfulLiveScores > 0
  });
  if (importedBrackets < brackets.length) eventWarnings.push(`Imported ${importedBrackets} of ${brackets.length} published brackets. Increase limits to expand coverage.`);
  return eventSnapshot;
}

async function fetchPublicParticipants(eventBase) {
  const athletes = new Map(), visited = new Set();
  let page = `${eventBase}/participants`, warning = '';
  while (page && !visited.has(page)) {
    visited.add(page);
    try {
      const html = await fetchText(page);
      for (const athlete of parsePublicParticipants(html, eventBase)) athletes.set(`${athlete.sourceId}:${athlete.division}`, athlete);
      const $ = load(html);
      const next = $('a[rel="next"]').attr('href');
      page = next ? new URL(next, page).href : '';
      if (page && !page.startsWith(`${eventBase}/participants?`)) throw new Error('Unexpected participant pagination URL.');
    } catch (error) {
      if (!athletes.size) throw error;
      warning = `Athlete list partially loaded: ${messageFor(error)}`;
      break;
    }
  }
  if (page && visited.has(page) && !warning) warning = 'Athlete list pagination repeated a page; earlier registrations retained.';
  return { participants: [...athletes.values()], warning };
}

async function fetchEventBrackets(eventBase, eventSnapshot, stats, prefetched) {
  try {
    await pause();
    const result = prefetched ? await prefetched : { data: await fetchJson(`${eventBase}/schedule/brackets.json`) };
    if (result.error) throw result.error;
    const bracketResponse = result.data;
    const brackets = Array.isArray(bracketResponse.brackets) ? bracketResponse.brackets : [];
    return brackets.filter((bracket) => bracket.bracket_id || bracket.id);
  } catch (error) {
    stats.failedBrackets += 1;
    eventSnapshot.warnings.push(`Published brackets unavailable: ${messageFor(error)}`);
    return [];
  }
}

function normalizeMatch(rawMatch, liveData, detailData, bracket, eventSnapshot, eventBase) {
  const seats = Array.isArray(rawMatch.seats) ? rawMatch.seats : [];
  const detailSeats = Array.isArray(detailData?.seats) ? detailData.seats : [];
  const leftSeat = seats[0] || null;
  const rightSeat = seats[1] || null;
  const leftDetailSeat = detailSeats.find((seat) => Number(seat.position) === 0) || detailSeats[0] || null;
  const rightDetailSeat = detailSeats.find((seat) => Number(seat.position) === 1) || detailSeats[1] || null;
  const leftName = leftSeat?.name || nameFromLiveSide(liveData?.left);
  const rightName = rightSeat?.name || nameFromLiveSide(liveData?.right);

  if (!rawMatch.id || !leftName || !rightName || isBracketPlaceholder(leftName) || isBracketPlaceholder(rightName)) {
    return null;
  }

  const winnerSide = winnerSideFor(leftSeat, rightSeat, liveData);
  const sourceState = String(liveData?.matchInfo?.state || rawMatch.state || "").toLowerCase();
  let status = statusForMatch(sourceState, winnerSide);
  if (!winnerSide && (eventSnapshot.status === "complete" || sourceState === "finished" || sourceState === "end")) status = "locked";
  const sourceMatchId = String(rawMatch.id);
  const division = rawMatch.group || liveData?.group || bracket.name || "Smoothcomp division";
  const sourceBracketId = String(rawMatch.bracket_id || bracket.bracket_id || bracket.id || "");

  return {
    sourceMatchId,
    sourceBracketId,
    division,
    round: rawMatch.name || liveData?.matchInfo?.round || roundLabel(rawMatch.round),
    mat: liveData?.matchInfo?.mat || rawMatch.mat_name || bracket.mats || matFromNumber(rawMatch.mat_match_nr),
    scheduledAt: rawMatch.estimated_start || liveData?.matchInfo?.estimated_date || bracket.estimated_start || eventSnapshot.startsAt,
    status,
    sourceState,
    sourceUrl: `${eventBase}/bracket/${sourceBracketId}`,
    competitorA: competitorFromSeat(leftSeat, liveData?.left, leftDetailSeat, division, "left"),
    competitorB: competitorFromSeat(rightSeat, liveData?.right, rightDetailSeat, division, "right"),
    winnerSide,
    winnerSourceId: winnerSide === "left" ? sourceIdForSeat(leftSeat, liveData?.left) : winnerSide === "right" ? sourceIdForSeat(rightSeat, liveData?.right) : null,
    finish: finishFor(rawMatch, liveData),
    liveClock: liveData?.matchInfo?.time || rawMatch.time_passed || rawMatch.timePassed || null,
    score: scoreFor(rawMatch, liveData)
  };
}

function isBracketPlaceholder(name) {
  return /^(?:(?:winner|loser)(?:\s+(?:from|of)\b|\s*$)|tbd\b|to be determined\b|bye\b|unknown competitor\b)/i.test(String(name).trim());
}

function competitorFromSeat(seat, liveSide, detailSeat, division, side) {
  return {
    sourceId: sourceIdForSeat(seat, liveSide),
    name: seat?.name || nameFromLiveSide(liveSide) || "Unknown competitor",
    academy: detailSeat?.player_club || seat?.club || liveSide?.club || liveSide?.affiliation || "Not listed",
    country: String(detailSeat?.player_country || seat?.country || liveSide?.country_flag || liveSide?.country || "Not listed").toUpperCase(),
    belt: beltFromDivision(division),
    seed: Number(detailSeat?.seed || seat?.seed || 0) || 0,
    record: liveSide?.wins !== undefined && liveSide?.wins !== null ? `Wins listed: ${liveSide.wins}` : "Record not listed",
    imageUrl: absoluteAssetUrl(firstPhotoUrl(liveSide, detailSeat, seat)),
    clubLogoUrl: absoluteAssetUrl(detailSeat?.player_club_logo || detailSeat?.player_competition_team_logo || null),
    sourceUrl: liveSide?.profile_link || seat?.profile_link || null
  };
}

function firstPhotoUrl(...records) {
  const fields = ["profile_image", "player_profile_image", "profile_photo", "profilePhoto", "image", "player_image",
    "photo", "photo_url", "headshot", "headshot_url", "avatar", "avatar_url", "imageUrl", "image_url"];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    for (const field of fields) {
      const value = record[field];
      const url = typeof value === "string" ? value : value?.url || value?.src;
      if (url) return url;
    }
  }
  return null;
}

function sourceIdForSeat(seat, liveSide) {
  return String(seat?.event_registration_id || seat?.player_id || seat?.id || liveSide?.id || "");
}

function scoreFor(rawMatch, liveData) {
  const liveScore = {
    left: compactScoreSide(liveData?.left),
    right: compactScoreSide(liveData?.right)
  };

  if (liveScore.left || liveScore.right) {
    return liveScore;
  }

  if (rawMatch.points && typeof rawMatch.points === "object") {
    return {
      left: { points: numberOrNull(rawMatch.points.left) },
      right: { points: numberOrNull(rawMatch.points.right) }
    };
  }

  return undefined;
}

function compactScoreSide(side) {
  if (!side) {
    return undefined;
  }

  const points = numberOrNull(side.score);
  const advantages = numberOrNull(side.advantage);
  const penalties = numberOrNull(side.penalty);

  if (points === null && advantages === null && penalties === null) {
    return undefined;
  }

  return { points, advantages, penalties };
}

function winnerSideFor(leftSeat, rightSeat, liveData) {
  const left = leftSeat?.isWinner === true || liveData?.left?.isWinner === true;
  const right = rightSeat?.isWinner === true || liveData?.right?.isWinner === true;
  if (left !== right) return left ? "left" : "right";

  return null;
}

function statusForMatch(sourceState, winnerSide) {
  if (winnerSide) {
    return "settled";
  }

  if (["started", "running", "current", "live", "ongoing", "paused"].includes(sourceState)) {
    return "live";
  }

  if (["finished", "end", "done", "resolved", "cancelled", "canceled", "walkover"].includes(sourceState)) {
    return "locked";
  }

  return "open";
}

function finishFor(rawMatch, liveData) {
  const wonBy = rawMatch.wonBy || liveData?.left?.wonBy || liveData?.right?.wonBy;
  const result = rawMatch.seats?.find?.((seat) => seat?.isWinner)?.result || liveData?.left?.result || liveData?.right?.result;
  return wonBy || result || null;
}

function parseCalendarEvents(html) {
  const match = html.match(/var events = (\[[\s\S]*?\])\s*<\/script>/);

  if (!match) {
    throw new Error("Could not find Smoothcomp calendar events payload");
  }

  return JSON.parse(match[1]);
}

function parseSportsEvent(html) {
  const scripts = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);

  for (const script of scripts) {
    try {
      const data = JSON.parse(script[1].trim());
      if (data?.["@type"] === "SportsEvent") {
        return data;
      }
    } catch {
      // Ignore non-JSON-LD script fragments.
    }
  }

  return null;
}

function hasGrapplingCategory(categoryGroups = []) {
  return categoryGroups.some((categoryGroup) => GRAPPLING_CATEGORY_GROUPS.has(String(categoryGroup)));
}

function eventSeedFromInput(input) {
  const eventUrl = canonicalEventUrl(input);
  const id = parseSmoothcompEventId(eventUrl) || String(input).replace(/\D/g, "");

  return {
    id,
    title: `Smoothcomp Event ${id}`,
    url: eventUrl,
    categoryGroups: [],
    eventEnded: false
  };
}

function canonicalEventUrl(input) {
  const url = allowedSourceUrl(/^\d+$/.test(String(input)) ? `https://smoothcomp.com/en/event/${input}` : input);
  const id = parseSmoothcompEventId(url.href);
  if (!id || !(url.hostname === "smoothcomp.com" || url.hostname.endsWith(".smoothcomp.com") || ["ajptour.com", "www.ajptour.com"].includes(url.hostname))) throw new Error("Use a Smoothcomp or AJP event URL.");
  return `${url.origin}/en/event/${id}`;
}

function parseSmoothcompEventId(url) {
  return new URL(url).pathname.match(/^\/(?:[a-z]{2}(?:_[A-Z]{2})?\/)?event\/(\d+)(?:\/|$)/)?.[1] || "";
}

function eventStatusFor(startsAt, endsAt, eventEnded) {
  const now = Date.now();
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);

  if (eventEnded || Number.isFinite(end) && end < now) {
    return "complete";
  }

  if (Number.isFinite(start) && start > now) return "upcoming";
  if (Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end) return "live";
  if (Number.isFinite(start) && !Number.isFinite(end) && now - start < 24 * 60 * 60 * 1000) return "live";
  if (Number.isFinite(start)) return "complete";
  return "unknown";
}

function locationCityFor(calendarEvent, sportsEvent) {
  return (
    calendarEvent.location_city ||
    sportsEvent?.location?.address?.addressLocality ||
    sportsEvent?.location?.name ||
    "Smoothcomp"
  );
}

function dateToIso(value, endOfDay = false) {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function roundLabel(round) {
  return round ? `Round ${round}` : "Match";
}

function matFromNumber(value) {
  const match = String(value || "").match(/^(\d+)/);
  return match ? `Mat ${match[1]}` : "TBD";
}

function nameFromLiveSide(side) {
  return [side?.first_name, side?.last_name].filter(Boolean).join(" ").trim();
}

function numberOrNull(value) {
  return finiteScore(value);
}

function absoluteAssetUrl(value) {
  if (!value) {
    return null;
  }

  const url = String(value);
  if (url.includes("placeholder-image-profile")) return null;
  const absolute = url.startsWith("//") ? `https:${url}` : url.startsWith("/") ? `https://smoothcomp.com${url}` : url;
  try {
    const parsed = new URL(absolute);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function beltFromDivision(division) {
  const lower = String(division).toLowerCase();
  return ["black", "brown", "purple", "blue", "green", "orange", "yellow", "grey", "white"].find((belt) =>
    lower.includes(belt)
  ) || "unknown";
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

async function fetchText(url) {
  return fetchImpl === fetch ? cachedSmoothcompText(url, () => client.text(url)) : client.text(url);
}

function limitItems(items, limit) {
  return Number.isFinite(limit) ? items.slice(0, limit) : items;
}

function parseArgs(args) {
  const parsed = {
    calendarUrl: process.env.SMOOTHCOMP_CALENDAR_URL || CALENDAR_URL,
    output: process.env.SMOOTHCOMP_OUTPUT || DEFAULT_OUTPUT,
    eventLimit: toLimit(process.env.SMOOTHCOMP_EVENT_LIMIT, 6),
    bracketLimit: toLimit(process.env.SMOOTHCOMP_BRACKET_LIMIT, 12),
    matchLimit: toLimit(process.env.SMOOTHCOMP_MATCH_LIMIT, 240),
    liveScoreLimit: toLimit(process.env.SMOOTHCOMP_LIVE_SCORE_LIMIT, 120),
    bracketOffset: 0,
    participants: args.includes("--participants"),
    details: !args.includes("--no-details"),
    liveOnly: args.includes("--live-only"),
    eventUrls: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [key, inlineValue] = arg.split("=");
    const nextValue = inlineValue ?? args[index + 1];

    if (arg.startsWith("--event=") || arg.startsWith("--event-url=")) {
      parsed.eventUrls.push(inlineValue);
    } else if (arg === "--event" || arg === "--event-url") {
      parsed.eventUrls.push(nextValue);
      index += 1;
    } else if (arg.startsWith("--out=")) {
      parsed.output = inlineValue;
    } else if (arg === "--out") {
      parsed.output = nextValue;
      index += 1;
    } else if (arg.startsWith("--calendar-url=")) {
      parsed.calendarUrl = inlineValue;
    } else if (arg === "--calendar-url") {
      parsed.calendarUrl = nextValue;
      index += 1;
    } else if (["--limit", "--event-limit"].includes(key)) {
      parsed.eventLimit = toLimit(nextValue, parsed.eventLimit);
      if (!inlineValue) index += 1;
    } else if (key === "--bracket-offset") {
      parsed.bracketOffset = Math.max(0, Number(nextValue) || 0);
      if (!inlineValue) index += 1;
    } else if (key === "--bracket-limit") {
      parsed.bracketLimit = toLimit(nextValue, parsed.bracketLimit);
      if (!inlineValue) index += 1;
    } else if (key === "--match-limit") {
      parsed.matchLimit = toLimit(nextValue, parsed.matchLimit);
      if (!inlineValue) index += 1;
    } else if (key === "--live-score-limit") {
      parsed.liveScoreLimit = toLimit(nextValue, parsed.liveScoreLimit);
      if (!inlineValue) index += 1;
    } else if (!arg.startsWith("--")) {
      parsed.eventUrls.push(arg);
    }
  }

  return parsed;
}

function toLimit(value, fallback) {
  if (String(value).toLowerCase() === "all") {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pause() {
  return Promise.resolve();
}

function messageFor(error) {
  return error instanceof Error ? error.message : String(error);
}

return { run: main, discover: discoverEvents, syncEvent, normalizeMatch, scoreFor, statusForMatch, winnerSideFor, parseCalendarEvents };
}

export async function runSmoothcompSync(args = process.argv.slice(2)) {
  return createSmoothcompWorker(args, { persist: true, maxRequests: 20000 }).run();
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  runSmoothcompSync().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
