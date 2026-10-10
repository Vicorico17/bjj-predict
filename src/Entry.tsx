import { lazy, Suspense, useEffect, useState } from 'react';
import { LandingPage } from './LandingPage';

const App = lazy(() => import('./App'));

export function Entry() {
  const [inApp, setInApp] = useState(() => window.location.hash.startsWith('#/app'));
  useEffect(() => {
    const navigate = () => { setInApp(window.location.hash.startsWith('#/app')); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);
  return inApp ? <Suspense fallback={<div className="entry-loading" role="status">Opening BJJ Predict…</div>}><App/></Suspense> : <LandingPage/>;
}
