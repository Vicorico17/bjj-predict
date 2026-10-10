import { useState } from 'react';
import type { ImageFocus } from './types';

type Portrait = { name: string; imageUrl?: string; imageFocus?: ImageFocus };

export function CompetitorPortrait({ competitor, compact = false }: { competitor?: Portrait; compact?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = competitor?.imageUrl;
  const valid = url && (url.startsWith('https://') || (url.startsWith('/') && !url.startsWith('//'))) && url !== failedUrl;
  const focus = competitor?.imageFocus;
  const style = focus ? { width: `${focus.zoom * 100}%`, height: `${focus.zoom * 100}%`, left: `${(0.5 - focus.x * focus.zoom) * 100}%`, top: `${(0.5 - focus.y * focus.zoom) * 100}%` } : undefined;
  return <span className={`competitor-portrait ${compact ? 'compact' : 'fighter-avatar'}${valid ? '' : ' fallback'}`}>
    {valid ? <img src={url} style={style} alt={`${competitor?.name} portrait`} loading="lazy" decoding="async" onError={() => setFailedUrl(url)}/> : <span aria-label={competitor ? `Photo unavailable for ${competitor.name}` : 'Awaiting opponent'}>{competitor?.name.split(/\s+/).map(part => part[0]).slice(0, 2).join('') || '?'}</span>}
  </span>;
}
