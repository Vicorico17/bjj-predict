import { fetchFloEvent } from '../../scripts/lib/flo.mjs';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  try {
    const { eventUrl } = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    if (typeof eventUrl !== 'string') return res.status(400).json({ error: 'A Flo event URL or ID is required.' });
    const event = await fetchFloEvent(eventUrl);
    res.status(200).json({ source: 'flo', syncedAt: new Date().toISOString(), calendarUrl: '', events: [event] });
  } catch (error) {
    res.status(502).json({ error: error.message });
  }
}
