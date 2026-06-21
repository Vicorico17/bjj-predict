import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const CALENDAR_URL = "https://smoothcomp.com/en/events/upcoming";
const GRAPPLING_CATEGORY_GROUPS = new Set(["1", "3", "4", "7", "24"]);
const DEFAULT_OUTPUT = "src/generated/smoothcomp-live-snapshot.json";
const REQUEST_PAUSE_MS = 90;
const USER_AGENT = "bjj-predict-sync/0.1 (+https://github.com/Vicorico17/bjj-predict)";
const execFileAsync = promisify(execFile);

let options = parseArgs(process.argv.slice(2));
let warnings = [];

export async function runSmoothcompSync(args = process.argv.slice(2)) {
  options = parseArgs(args);
  warnings = [];
  return main();
}

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
    source: "smoothcomp",
    syncedAt: startedAt,
    calendarUrl: options.calendarUrl,
    events: snapshotEvents,
    stats,
    warnings
  };

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log(
    `Smoothcomp snapshot wrote ${stats.importedEvents} events, ${stats.importedMatches} matches, ` +
      `${stats.liveMatches} live, ${stats.settledMatches} settled -> ${options.output}`
  );

  if (warnings.length > 0) {
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
    .filter((event) => hasGrapplingCategory(event.categoryGroups))
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
  const eventWarnings = [];
  let sportsEvent = null;

  try {
    const eventHtml = await fetchText(eventUrl);
    sportsEvent = parseSportsEvent(eventHtml);
  } catch (error) {
    eventWarnings.push(`Event page metadata unavailable: ${messageFor(error)}`);
  }

  const startsAt = sportsEvent?.startDate || dateToIso(calendarEvent.startdate) || new Date().toISOString();
  const endsAt = sportsEvent?.endDate || dateToIso(calendarEvent.enddate) || startsAt;
  const eventSnapshot = {
    id: `e-smoothcomp-${sourceEventId}`,
    sourceEventId,
    name: sportsEvent?.name || calendarEvent.title || `Smoothcomp Event ${sourceEventId}`,
    organizer: sportsEvent?.organizer?.name || "Smoothcomp",
    city: locationCityFor(calendarEvent, sportsEvent),
    country: calendarEvent.location_country_human || calendarEvent.location_country || "",
    startsAt,
    endsAt,
    sourceUrl: eventUrl,
    status: eventStatusFor(startsAt, endsAt, calendarEvent.eventEnded),
    categoryGroups: calendarEvent.categoryGroups || [],
    coverImage: calendarEvent.cover_image || sportsEvent?.image || "",
    matches: [],
    warnings: eventWarnings
  };

  const brackets = await fetchEventBrackets(eventBase, eventSnapshot, stats);
  let liveScoreRequests = 0;

  for (const bracket of limitItems(brackets, options.bracketLimit)) {
    const bracketId = String(bracket.bracket_id || bracket.id || "");

    if (!bracketId) {
      continue;
    }

    try {
      await pause();
      const bracketData = await fetchJson(`${eventBase}/schedule/new/bracket.json/${bracketId}`);
      const rawMatches = Array.isArray(bracketData.matches) ? bracketData.matches : [];

      for (const rawMatch of rawMatches) {
        if (Number.isFinite(options.matchLimit) && eventSnapshot.matches.length >= options.matchLimit) {
          break;
        }

        let liveData = null;
        let detailData = null;

        if (liveScoreRequests < options.liveScoreLimit) {
          try {
            await pause();
            liveData = await fetchJson(`https://smoothcomp.com/en/getBracketMatchData/${rawMatch.id}`);
            liveScoreRequests += 1;
          } catch (error) {
            stats.failedLiveScores += 1;
            eventWarnings.push(`Live score data unavailable for match ${rawMatch.id}: ${messageFor(error)}`);
          }
        }

        try {
          await pause();
          detailData = await fetchJson(`https://smoothcomp.com/en/getBracketMatch/${rawMatch.id}`);
        } catch (error) {
          stats.failedMatchDetails += 1;
          eventWarnings.push(`Athlete detail unavailable for match ${rawMatch.id}: ${messageFor(error)}`);
        }

        const normalized = normalizeMatch(rawMatch, liveData, detailData, bracket, eventSnapshot, eventBase);

        if (normalized) {
          eventSnapshot.matches.push(normalized);
        }
      }
    } catch (error) {
      stats.failedBrackets += 1;
      eventWarnings.push(`Bracket ${bracketId} unavailable: ${messageFor(error)}`);
    }
  }

  return eventSnapshot;
}

async function fetchEventBrackets(eventBase, eventSnapshot, stats) {
  try {
    await pause();
    const bracketResponse = await fetchJson(`${eventBase}/schedule/brackets.json`);
    const brackets = Array.isArray(bracketResponse.brackets) ? bracketResponse.brackets : [];
    return brackets.filter((bracket) => Number(bracket.registrations_count ?? 0) >= 2);
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

  if (!rawMatch.id || !leftName || !rightName) {
    return null;
  }

  const winnerSide = winnerSideFor(leftSeat, rightSeat, liveData);
  const sourceState = String(liveData?.matchInfo?.state || rawMatch.state || "").toLowerCase();
  const status = statusForMatch(sourceState, winnerSide);
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

function competitorFromSeat(seat, liveSide, detailSeat, division, side) {
  return {
    sourceId: sourceIdForSeat(seat, liveSide),
    name: seat?.name || nameFromLiveSide(liveSide) || "Unknown competitor",
    academy: detailSeat?.player_club || seat?.club || liveSide?.club || liveSide?.affiliation || "Independent",
    country: String(detailSeat?.player_country || seat?.country || liveSide?.country_flag || liveSide?.country || "").toUpperCase(),
    belt: beltFromDivision(division),
    seed: Number(detailSeat?.seed || seat?.seed || 0) || (side === "left" ? 1 : 2),
    record: liveSide?.wins !== undefined && liveSide?.wins !== null ? `${liveSide.wins} Smoothcomp wins` : "0 Smoothcomp wins",
    imageUrl: absoluteAssetUrl(
      liveSide?.profile_image || detailSeat?.player_profile_image || seat?.image || seat?.player_profile_image || null
    ),
    clubLogoUrl: absoluteAssetUrl(detailSeat?.player_club_logo || detailSeat?.player_competition_team_logo || null),
    sourceUrl: liveSide?.profile_link || seat?.profile_link || null
  };
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
  if (leftSeat?.isWinner || liveData?.left?.isWinner) {
    return "left";
  }

  if (rightSeat?.isWinner || liveData?.right?.isWinner) {
    return "right";
  }

  return null;
}

function statusForMatch(sourceState, winnerSide) {
  if (winnerSide || ["finished", "done", "resolved"].includes(sourceState)) {
    return "settled";
  }

  if (["started", "running", "current", "live", "ongoing", "paused"].includes(sourceState)) {
    return "live";
  }

  if (["cancelled", "canceled", "walkover"].includes(sourceState)) {
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
  if (/^https?:\/\//i.test(String(input))) {
    return String(input);
  }

  return `https://smoothcomp.com/en/event/${input}`;
}

function parseSmoothcompEventId(url) {
  const match = String(url).match(/smoothcomp\.com\/(?:[a-z]{2}(?:_[A-Z]{2})?\/)?event\/(\d+)/i);
  return match?.[1] || "";
}

function eventStatusFor(startsAt, endsAt, eventEnded) {
  const now = Date.now();
  const start = Date.parse(startsAt);
  const end = Date.parse(endsAt);

  if (eventEnded || Number.isFinite(end) && end < now) {
    return "complete";
  }

  if (Number.isFinite(start) && Number.isFinite(end) && start <= now && now <= end) {
    return "live";
  }

  return "upcoming";
}

function locationCityFor(calendarEvent, sportsEvent) {
  return (
    calendarEvent.location_city ||
    sportsEvent?.location?.address?.addressLocality ||
    sportsEvent?.location?.name ||
    "Smoothcomp"
  );
}

function dateToIso(value) {
  if (!value) {
    return "";
  }

  const date = new Date(`${value}T00:00:00.000Z`);
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
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function absoluteAssetUrl(value) {
  if (!value) {
    return null;
  }

  const url = String(value);
  return url.startsWith("/") ? `https://smoothcomp.com${url}` : url;
}

function beltFromDivision(division) {
  const lower = String(division).toLowerCase();
  return ["black", "brown", "purple", "blue", "green", "orange", "yellow", "grey", "white"].find((belt) =>
    lower.includes(belt)
  ) || "white";
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "user-agent": USER_AGENT
      }
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return response.text();
  } catch (error) {
    return fetchTextWithCurl(url, error);
  }
}

async function fetchTextWithCurl(url, originalError) {
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-sSL", "--fail-with-body", "-H", "accept: application/json,text/html;q=0.9,*/*;q=0.8", "-A", USER_AGENT, url],
      { maxBuffer: 30 * 1024 * 1024 }
    );
    return stdout;
  } catch (curlError) {
    throw new Error(`${messageFor(originalError)}; curl fallback failed: ${messageFor(curlError)}`);
  }
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
  return new Promise((resolve) => setTimeout(resolve, REQUEST_PAUSE_MS));
}

function messageFor(error) {
  return error instanceof Error ? error.message : String(error);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  runSmoothcompSync().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
