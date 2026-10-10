import { bracketListUrl, probeBrackets } from '../../scripts/lib/bracket-probe.mjs';

let cached = new Map();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  let eventUrls;
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    eventUrls = body?.eventUrls;
    if (!Array.isArray(eventUrls) || eventUrls.length > 200 ||
        eventUrls.some(url => typeof url !== 'string' || url.length > 500)) throw new Error('Invalid event URLs.');
    eventUrls.forEach(bracketListUrl);
  } catch (error) { return res.status(400).json({ error: error.message }); }
  const unique = [...new Set(eventUrls)];
  const now = Date.now();
  const fresh = unique.filter(url => cached.has(url) && now - cached.get(url).at < 5 * 60 * 1000);
  const missing = unique.filter(url => !fresh.includes(url));
  try {
    const scanned = await probeBrackets(missing);
    const available = new Map(scanned.available.map(item => [item.sourceUrl, item]));
    for (const url of missing) cached.set(url, { at: now, result: available.get(url) || null });
    if (cached.size > 400) cached = new Map([...cached].filter(([, entry]) => now - entry.at < 5 * 60 * 1000));
    return res.status(200).json({ checked: unique.length,
      available: unique.map(url => cached.get(url)?.result).filter(Boolean),
      unavailable: scanned.unavailable });
  } catch (error) { return res.status(502).json({ error: error.message }); }
}
