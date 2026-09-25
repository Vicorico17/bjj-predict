import { discoverData } from '../../scripts/lib/data-sources.mjs';

let cached, pending;
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  if (cached && Date.now() - cached.at < 60000) return res.status(200).json(cached.data);
  try {
    pending ||= discoverData().finally(() => { pending = null; });
    const data = await pending;
    cached = { at: Date.now(), data };
    return res.status(200).json(data);
  } catch (error) { return res.status(502).json({ error: error.message }); }
}
