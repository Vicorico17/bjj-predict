export function allowedSourceUrl(input) {
  const url = new URL(input);
  const host = url.hostname;
  if (url.protocol !== 'https:' || url.port || url.username || url.password ||
      !(host === 'smoothcomp.com' || host.endsWith('.smoothcomp.com') ||
        ['ajptour.com', 'www.ajptour.com', 'www.bjjcompsystem.com', 'bjjcompsystem.com',
          'arena.flograppling.com', 'www.flograppling.com', 'flograppling.com', 'api.flograppling.com'].includes(host))) {
    throw new Error('Unsupported data-source URL.');
  }
  return url;
}

export function createSourceClient({ fetchImpl = fetch, timeoutMs = 20000, maxRequests = 400, pauseMs = 100 } = {}) {
  let requests = 0;
  async function request(input) {
    let url = allowedSourceUrl(input);
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (++requests > maxRequests) throw new Error('Request budget reached; remaining coverage was not fetched.');
      if (requests > 1 && pauseMs) await new Promise(resolve => setTimeout(resolve, pauseMs));
      const response = await fetchImpl(url.href, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json,text/html', 'user-agent': 'bjj-predict-sync/0.2' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        url = allowedSourceUrl(new URL(response.headers.get('location'), url).href);
        continue;
      }
      if (!response.ok) throw new Error(`${url.hostname}: HTTP ${response.status}`);
      return response;
    }
    throw new Error('Too many source redirects.');
  }
  return { request, text: async url => (await request(url)).text(), json: async url => (await request(url)).json(),
    get requests() { return requests; } };
}

export function eventStatus(start, end) {
  if (Number.isFinite(Date.parse(end)) && Date.parse(end) < Date.now()) return 'complete';
  if (Number.isFinite(Date.parse(start)) && Date.parse(start) > Date.now()) return 'upcoming';
  return 'live';
}

export function finiteScore(value) {
  return value === null || value === undefined || value === '' || typeof value === 'boolean' ? null :
    Number.isFinite(Number(value)) ? Number(value) : null;
}

export function coverage(matches, details = {}) {
  return { level: 'partial', matchCount: matches.length,
    scoredMatches: matches.filter(m => m.score?.left?.points != null && m.score?.right?.points != null).length,
    ...details };
}
