import { importData, providerFor } from '../../scripts/lib/data-sources.mjs';

const pending = new Map(), cache = new Map();
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body.eventUrl !== 'string') throw new Error('An event URL is required.');
    providerFor(body.eventUrl);
    for (const [key, max] of [['bracketLimit', 100], ['matchLimit', 2000], ['liveScoreLimit', 200]]) {
      if (body[key] !== undefined && (!Number.isInteger(body[key]) || body[key] < 1 || body[key] > max)) throw new Error(`Invalid ${key}; maximum ${max}.`);
    }
    if (body.seed !== undefined) {
      if (!body.seed || typeof body.seed !== 'object' || Array.isArray(body.seed)) throw new Error('Invalid event metadata.');
      for (const key of ['name', 'startsAt', 'endsAt', 'city']) if (body.seed[key] !== undefined && (typeof body.seed[key] !== 'string' || body.seed[key].length > 500)) throw new Error(`Invalid event metadata field: ${key}.`);
      if (body.seed.status !== undefined && !['live', 'upcoming', 'complete', 'unknown'].includes(body.seed.status)) throw new Error('Invalid event status.');
    }
  } catch (error) { return res.status(400).json({ error: error.message }); }
  const options = { bracketLimit: body.bracketLimit, matchLimit: body.matchLimit, liveScoreLimit: body.liveScoreLimit, seed: body.seed };
  // Undefined values must use adapter defaults.
  for (const key of Object.keys(options)) if (options[key] === undefined) delete options[key];
  const key = JSON.stringify([body.eventUrl, options]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15000) return res.status(200).json(hit.snapshot);
  if (pending.size >= 3 && !pending.has(key)) return res.status(429).json({ error: 'Imports are busy. Try again shortly.' });
  try {
    if (!pending.has(key)) pending.set(key, importData(body.eventUrl, options).finally(() => pending.delete(key)));
    const snapshot = await pending.get(key);
    if (cache.size > 30) cache.clear();
    cache.set(key, { at: Date.now(), snapshot });
    return res.status(200).json(snapshot);
  } catch (error) { return res.status(502).json({ error: error.message }); }
}
