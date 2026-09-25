import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchFloEvent } from './lib/flo.mjs';

const inputs = process.argv.slice(2);
if (!inputs.length) throw new Error('Usage: npm run sync:flo -- <Flo event ID or URL> [more events]');
const events = [];
for (const input of inputs) events.push(await fetchFloEvent(input));
const output = 'src/generated/flo-results-snapshot.json';
await mkdir(path.dirname(output), { recursive: true });
await writeFile(`${output}.tmp`, JSON.stringify({ source: 'flo', syncedAt: new Date().toISOString(), calendarUrl: '', events }, null, 2) + '\n');
await rename(`${output}.tmp`, output);
console.log(`Imported ${events.length} Flo events, ${events.reduce((sum, event) => sum + event.matches.length, 0)} published results.`);
