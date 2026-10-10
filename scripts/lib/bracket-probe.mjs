import { allowedSourceUrl, createSourceClient } from './source-http.mjs';

export function bracketListUrl(input) {
  const url = allowedSourceUrl(input);
  if (!(url.hostname === 'smoothcomp.com' || url.hostname.endsWith('.smoothcomp.com') ||
      url.hostname === 'ajptour.com' || url.hostname === 'www.ajptour.com') ||
      !/^\/(?:[a-z]{2}(?:_[A-Z]{2})?\/)?event\/\d+\/?$/i.test(url.pathname))
    throw new Error('Use a supported tournament event URL.');
  return `${url.origin}${url.pathname.replace(/\/$/, '')}/schedule/brackets.json`;
}

export async function probeBrackets(eventUrls, { fetchImpl = fetch, concurrency = 8 } = {}) {
  if (!Array.isArray(eventUrls) || eventUrls.length > 200) throw new Error('Too many events to check.');
  const urls = [...new Set(eventUrls)];
  const targets = urls.map(sourceUrl => ({ sourceUrl, bracketUrl: bracketListUrl(sourceUrl) }));
  const results = new Array(targets.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (cursor < targets.length) {
      const index = cursor++;
      const { sourceUrl, bracketUrl } = targets[index];
      try {
        const client = createSourceClient({ fetchImpl, timeoutMs: 7000, pauseMs: 0, maxRequests: 2 });
        const payload = await client.json(bracketUrl);
        if (!Array.isArray(payload.brackets)) throw new Error('Invalid bracket list.');
        const count = payload.brackets.filter(bracket => Number(bracket.registrations_count ?? 0) >= 2).length;
        results[index] = { sourceUrl, status: count ? 'available' : 'empty', brackets: count };
      } catch (error) {
        results[index] = { sourceUrl, status: 'unavailable', error: error.message };
      }
    }
  }));
  return { checked: results.length, available: results.filter(result => result.status === 'available'),
    empty: results.filter(result => result.status === 'empty').length,
    unavailable: results.filter(result => result.status === 'unavailable').length };
}
