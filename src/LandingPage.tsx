import { ArrowDown, ArrowRight, GitBranch, Swords, Trophy, Radar, MoveUpRight } from 'lucide-react';
import { CompetitorPortrait } from './CompetitorPortrait';
import featured from './generated/featured-events.json';
import './landing.css';

export function LandingPage() {
  const event = featured.events[0];
  const quarterfinals = event.matches.filter(match => match.round === 'Quarterfinal');
  const first = quarterfinals[0];
  return <div className="landing">
    <nav className="landing-nav" aria-label="Main navigation">
      <a className="landing-brand" href="#"><Swords size={25}/><span>BJJ<span className="brand-light">Predict</span><small>THE NEXT MOVE IS YOURS.</small></span></a>
      <div className="landing-nav-links"><a href="#the-game">The experience</a><a href="#featured-card">Featured card</a></div>
      <a className="landing-entry" href="#/app">Enter app <ArrowRight size={17}/></a>
    </nav>
    <main>
      <section className="landing-hero">
        <div className="hero-copy"><p className="landing-kicker"><span/> FOR THE ONES WHO KNOW THE GAME</p>
          <h1>Read the fight.<br/>See the path.<br/><em>Make your call.</em></h1>
          <p className="hero-description">Every matchup has a story. Follow the brackets, study the athletes, and put your grappling instincts to the test.</p>
          <div className="hero-actions"><a className="landing-cta" href="#/app">Step onto the mat <ArrowRight size={20}/></a><span>Free to explore.<br/>Predictions with demo points.</span></div>
          <a className="hero-scroll" href="#featured-card"><ArrowDown size={15}/> Discover the next matchup</a>
        </div>
        <div className="hero-visual" aria-label="Featured tournament matchup">
          <div className="visual-grid"/><span className="hero-watermark" aria-hidden="true">88</span>
          <div className="visual-topline"><span>THE MATCHUP</span><span>01 / 04 · QUARTERFINAL</span></div>
          <div className="hero-athlete athlete-left"><CompetitorPortrait competitor={first.competitorA}/><span>BG</span><strong>KALIN<br/>ZHELEZOV</strong></div>
          <div className="hero-versus" aria-hidden="true">VS</div>
          <div className="hero-athlete athlete-right"><CompetitorPortrait competitor={first.competitorB}/><span>RO</span><strong>SEBASTIAN<br/>CURELARU</strong></div>
          <div className="visual-bottomline"><span><i/> GRAPPLING GRAND PRIX 88</span><span>SOFIA, BULGARIA</span></div>
          <div className="visual-caption"><GitBranch size={17}/> Eight athletes. One path to the title.</div>
        </div>
      </section>
      <div className="landing-strip" aria-label="App features"><span>FOLLOW THE CARD</span><i>✳</i><span>READ THE BRACKET</span><i>✳</i><span>BACK YOUR INSTINCTS</span><i>✳</i><span>KNOW YOUR SPORT</span></div>
      <section className="landing-featured" id="featured-card">
        <div className="featured-copy"><p className="landing-kicker">IN FOCUS / 001</p><h2>One night.<br/>Every route<br/>to the final.</h2><p>Grappling Grand Prix 88<br/><span>11 October 2026 · Mixtape 5, Sofia</span></p><a className="landing-text-link" href="#/app/brackets">Explore the full bracket <MoveUpRight size={18}/></a></div>
        <div className="landing-draw-preview"><header><span>THE −88 KG TOURNAMENT</span><GitBranch size={20}/></header><div className="landing-mini-draw"><div className="mini-quarterfinals">{quarterfinals.map((match, i) => <div className="mini-bout" key={match.sourceMatchId}><small>QF {i + 1}</small>{[match.competitorA, match.competitorB].map(player => <div key={player.sourceId}><CompetitorPortrait competitor={player} compact/><span>{player.name}</span><b>—</b></div>)}</div>)}</div><div className="mini-advances" aria-hidden="true"><span/><span/></div><div className="mini-title"><Trophy size={29}/><span>THE FINAL</span><strong>Earn your<br/>place.</strong></div></div><footer>4 quarterfinals <span>→</span> 2 semifinals <span>→</span> 1 final</footer></div>
      </section>
      <section className="landing-experience" id="the-game"><div className="experience-heading"><p className="landing-kicker">MORE THAN A SPECTATOR</p><h2>Your mat-side advantage.</h2><p>The details matter. Get closer to the sport you love.</p></div><div className="experience-grid">{[
        { icon: Radar, title: 'Find your next event.', text: 'Explore competitions and published matchups in one place, with links back to the sources.', number: '01' },
        { icon: GitBranch, title: 'See the whole picture.', text: 'Follow the tournament from the opening round to the final. Athletes, opponents, and the route ahead.', number: '02' },
        { icon: Trophy, title: 'Trust your read.', text: 'Try predictions with demo points when markets are available. Follow confirmed results as they come in.', number: '03' }
      ].map(({icon: Icon, ...item}) => <article key={item.number}><div><Icon size={26}/><span>{item.number}</span></div><h3>{item.title}</h3><p>{item.text}</p></article>)}</div></section>
      <section className="landing-final"><p className="landing-kicker">YOU KNOW WHAT TO LOOK FOR.</p><h2>Now make your move.</h2><a className="landing-cta" href="#/app">Enter BJJ Predict <ArrowRight size={20}/></a><p>No real-money wagering. Just the sport, and your instincts.</p></section>
    </main>
    <footer className="landing-footer"><a href="#" className="landing-brand"><Swords size={20}/><span>BJJ<span className="brand-light">Predict</span></span></a><span>Built for the grappling obsessed.</span><a href="#/app">Open app <ArrowRight size={14}/></a></footer>
  </div>;
}
