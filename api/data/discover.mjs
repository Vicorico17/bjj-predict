import { discoverData, providers } from '../../scripts/lib/data-sources.mjs';
const cache = new Map(), pending = new Map();
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET.' });
  const source = new URL(req.url || '/', 'http://localhost').searchParams.get('provider') || 'all';
  if (!['all', 'smoothcomp', 'others'].includes(source)) return res.status(400).json({ error: 'Invalid discovery provider.' });
  const hit = cache.get(source);
  if (hit && Date.now() - hit.at < 300000) return res.status(200).json(hit.data);
  try {
    if (!pending.has(source)) {
      const selectedProviders = providers.filter(item => item.discovery && (source === 'all' || (source === 'smoothcomp' ? item.id === 'smoothcomp' : item.id !== 'smoothcomp'))).map(item => item.id);
      pending.set(source, discoverData({ selectedProviders }).finally(() => pending.delete(source)));
    }
    const data = await pending.get(source);
    cache.set(source, { at: Date.now(), data });
    return res.status(200).json(data);
  } catch (error) { return res.status(502).json({ error: error.message }); }
}
