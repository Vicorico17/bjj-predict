import { Check } from 'lucide-react';

export function WinnerBadge() {
  return <span className="winner-tick" aria-label="Winner" title="Confirmed winner"><Check size={13} strokeWidth={3} aria-hidden="true"/></span>;
}
