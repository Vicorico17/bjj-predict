import { readFile, writeFile, rename } from 'node:fs/promises';
import { discoverData, importData, mergeDataSnapshots } from './lib/data-sources.mjs';
import { readFile as readDiscoveryFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const output = 'src/generated/data-snapshot.json';
let snapshot = { source: 'mixed', syncedAt: '', calendarUrl: '', events: [] };
try { snapshot = JSON.parse(await readFile(output, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
let urls = args.filter(arg => !arg.startsWith('--'));
if (args.includes('--discover')) {
  const discovery = await discoverData();
  await writeFile('src/generated/data-discovery.json', JSON.stringify(discovery, null, 2) + '\n');
  const byUrl = new Map(discovery.events.map(event => [event.sourceUrl, event]));
  snapshot.events = snapshot.events.map(event => {
    const candidate = byUrl.get(event.sourceUrl);
    return candidate ? { ...event, name: candidate.name, startsAt: candidate.startsAt, status: candidate.status } : event;
  });
  await writeFile(`${output}.tmp`, JSON.stringify(snapshot, null, 2) + '\n');
  await rename(`${output}.tmp`, output);
  console.log(discovery.providers.map(p => `${p.source}: ${p.status === 'ok' ? p.discovered + ' discovered' : p.error}`).join('\n'));
  if (args.includes('--import-current')) urls.push(...discovery.events.filter(event => ['live', 'upcoming'].includes(event.status)).slice(0, 8).map(event => event.sourceUrl));
}
for (const url of new Set(urls)) {
  try {
    const seed = JSON.parse(await readDiscoveryFile('src/generated/data-discovery.json', 'utf8')).events.find(event => event.sourceUrl === url);
    const incoming = await importData(url, { maxRequests: 400, bracketLimit: 100, matchLimit: 2000, liveScoreLimit: 200, seed });
    // Imports from providers with generic event metadata inherit the calendar's
    // published name and date, so the bundled snapshot remains useful at startup.
    try {
      const discovery = JSON.parse(await readDiscoveryFile('src/generated/data-discovery.json', 'utf8'));
      const candidate = discovery.events.find(event => event.sourceUrl === url);
      if (candidate && incoming.events[0]) {
        incoming.events[0].name = candidate.name;
        if (!incoming.events[0].startsAt) incoming.events[0].startsAt = candidate.startsAt;
        if (!incoming.events[0].status) incoming.events[0].status = candidate.status;
      }
    } catch {}
    snapshot = mergeDataSnapshots(snapshot, incoming);
    await writeFile(`${output}.tmp`, JSON.stringify(snapshot, null, 2) + '\n');
    await rename(`${output}.tmp`, output);
    console.log(`${incoming.events[0].name}: ${incoming.events[0].matches.length} matches (${incoming.events[0].coverage.level})`);
  } catch (error) { console.error(`${url}: ${error.message}`); process.exitCode = 1; }
}
if (!args.length) console.log('Usage: npm run sync:data -- --discover [--import-current] [event URLs...]');
