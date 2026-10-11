// Shared within a server instance; never cache errors or retain unbounded responses.
const cache = new Map(), pending = new Map();
export async function cachedSmoothcompText(url, load) {
  const ttl = url.includes('getBracketMatchData') ? 5000 : url.includes('/bracket.json/') ? 10000 : url.endsWith('/brackets.json') ? 30000 : 300000;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.text;
  if (pending.has(url)) return pending.get(url);
  const request = load().then(text => {
    if (text.length <= 2_000_000) {
      cache.delete(url);
      if (cache.size >= 64) cache.delete(cache.keys().next().value);
      cache.set(url, { at: Date.now(), text });
    }
    return text;
  }).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}
