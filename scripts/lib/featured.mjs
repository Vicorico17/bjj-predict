import snapshot from '../../src/generated/featured-events.json' with { type: 'json' };

export function featuredEventFor(input) {
  let url;
  try { url = new URL(input); } catch { return undefined; }
  // Optional reviewed match reports supplement listings; this is not a discovery source.
  return snapshot.events.find(event => new URL(event.sourceUrl).href === url.href || event.officialUrl === url.href);
}

