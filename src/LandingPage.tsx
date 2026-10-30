import { ArrowDown, ArrowRight, GitBranch, Swords, Trophy, Radar, MoveUpRight } from 'lucide-react';
import './landing.css';
import { featuredChampionship, featuredChampionshipLink } from './featuredChampionship';

export function LandingPage() {
  const eventLink = featuredChampionshipLink;
  const officialUrl = featuredChampionship.officialUrl;
  const bracketsUrl = featuredChampionship.sourceUrl;
  return <div className="landing">
    <a className="landing-skip" href="#main-content">Skip to content</a>
    <nav className="landing-nav" aria-label="Main navigation">
      <a className="landing-brand" href="/" aria-label="BJJ Predict landing page"><Swords size={25}/><span>BJJ<span className="brand-light">Predict</span></span></a>
      <a className="landing-entry" href={eventLink}>Enter app <ArrowRight size={17}/></a>
    </nav>
    <main id="main-content">
      <section className="landing-hero">
        <div className="hero-copy"><p className="landing-kicker"><span/> ROME, ITALY · 2026</p>
          <h1>European<br/>IBJJF No-Gi<br/><em>Championship 2026.</em></h1>
          <p className="hero-description">Europe’s No-Gi championship takes center stage in Rome. Follow the competition at PalaPellicone, October 28–November 1, 2026.</p>
          <div className="hero-actions"><a className="landing-cta" href={eventLink}>Explore the championship <ArrowRight size={20}/></a><a className="hero-official-link" href={bracketsUrl} target="_blank" rel="noreferrer">Official brackets <MoveUpRight size={16}/></a></div>
          <a className="hero-scroll" href="#featured-card"><ArrowDown size={15}/> Discover the championship</a>
        </div>
        <div className="hero-visual championship-visual" aria-label="European IBJJF No-Gi Championship 2026 in Rome">
          <div className="visual-grid"/>
          <div className="visual-topline"><span>IBJJF · EUROPEAN CHAMPIONSHIP</span><span>2026</span></div>
          <div className="championship-poster"><span role="img" aria-label="Italy">🇮🇹</span><Trophy size={64} strokeWidth={1}/><strong>EUROPEAN<br/>NO-GI</strong><p>28 OCT — 01 NOV</p><span>PALAPELLICONE · ROME</span></div>
          <div className="visual-bottomline"><span>JIU-JITSU WITHOUT THE GI</span><span>ITALY</span></div>
          <div className="visual-caption"><GitBranch size={17}/> Follow the path to the European title.</div>
        </div>
      </section>
      <div className="landing-strip" aria-label="App features"><span>FOLLOW THE CARD</span><i>✳</i><span>READ THE BRACKET</span><i>✳</i><span>BACK YOUR INSTINCTS</span><i>✳</i><span>KNOW YOUR SPORT</span></div>
      <section className="landing-featured" id="featured-card">
        <div className="featured-copy"><p className="landing-kicker">IN FOCUS / EUROPEAN NO-GI</p><h2>Five days.<br/>One European<br/>stage.</h2><p>European IBJJF Jiu-Jitsu No-Gi Championship 2026<br/><span>28 October–1 November · PalaPellicone, Lido di Ostia, Italy</span></p><a className="landing-text-link" href={eventLink}>Explore the championship <MoveUpRight size={18}/></a></div>
        <div className="landing-draw-preview championship-details"><header><span>YOUR GUIDE TO THE CHAMPIONSHIP</span><Trophy size={20}/></header><h3>Rome. No-Gi. European titles.</h3><p>Find your division and follow the published draw, from the opening match to the final.</p><a className="landing-text-link" href={bracketsUrl} target="_blank" rel="noreferrer">Official brackets <MoveUpRight size={18}/></a><a className="landing-text-link" href={officialUrl} target="_blank" rel="noreferrer">Schedule & event information <MoveUpRight size={18}/></a><footer>IBJJF <span>·</span> Juvenile, Adult & Master divisions</footer></div>
      </section>
      <section className="landing-experience" id="the-game"><div className="experience-heading"><p className="landing-kicker">MORE THAN A SPECTATOR</p><h2>Your mat-side advantage.</h2><p>The details matter. Get closer to the sport you love.</p></div><div className="experience-grid">{[
        { icon: Radar, title: 'Find your next event.', text: 'Explore competitions and published matchups in one place, with links back to the sources.', number: '01' },
        { icon: GitBranch, title: 'See the whole picture.', text: 'Follow the tournament from the opening round to the final. Athletes, opponents, and the route ahead.', number: '02' },
        { icon: Trophy, title: 'Trust your read.', text: 'Try predictions with demo points when markets are available. Follow confirmed results as they come in.', number: '03' }
      ].map(({icon: Icon, ...item}) => <article key={item.number}><div><Icon size={26}/><span>{item.number}</span></div><h3>{item.title}</h3><p>{item.text}</p></article>)}</div></section>
      <section className="landing-final"><p className="landing-kicker">YOU KNOW WHAT TO LOOK FOR.</p><h2>Now make your move.</h2><a className="landing-cta" href={eventLink}>Enter BJJ Predict <ArrowRight size={20}/></a><p>No real-money wagering. Just the sport, and your instincts.</p></section>
    </main>
    <footer className="landing-footer"><a href="/" className="landing-brand" aria-label="BJJ Predict landing page"><Swords size={20}/><span>BJJ<span className="brand-light">Predict</span></span></a><span>Built for the grappling obsessed.</span><a href={eventLink}>Open app <ArrowRight size={14}/></a></footer>
  </div>;
}
