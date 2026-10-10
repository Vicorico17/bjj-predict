import type { ReactNode } from 'react';
import type { CompetitionBracket, PublishedBout } from './types';

const CARD_WIDTH = 252;
const CARD_HEIGHT = 196;
const ROW_GAP = 28;
const ROUND_GAP = 48;
const HEADER = 44;

export function TournamentBracket({ bracket, renderBout }: {
  bracket: CompetitionBracket; renderBout: (bout: PublishedBout) => ReactNode;
}) {
  const bouts = bracket.bouts || [];
  const rounds = [...new Set(bouts.map(bout => bout.round))].sort((a, b) =>
    (bouts.find(bout => bout.round === a)?.roundOrder || 0) - (bouts.find(bout => bout.round === b)?.roundOrder || 0));
  const groups = rounds.map(round => bouts.filter(bout => bout.round === round));
  const height = Math.max(1, ...groups.map(group => group.length)) * (CARD_HEIGHT + ROW_GAP) - ROW_GAP;
  const positions = new Map<string, { x: number; y: number }>();
  groups.forEach((group, column) => group.forEach((bout, row) => {
    const feeders = (bout.advancesFrom || []).map(id => positions.get(id)).filter(position => position !== undefined);
    const center = feeders.length ? feeders.reduce((sum, position) => sum + position.y, 0) / feeders.length
      : HEADER + (row + 0.5) * (height + ROW_GAP) / group.length - ROW_GAP / 2;
    positions.set(bout.sourceId, { x: column * (CARD_WIDTH + ROUND_GAP), y: center });
  }));
  const width = rounds.length * (CARD_WIDTH + ROUND_GAP) - ROUND_GAP;
  return <>
    <p className="small-note bracket-instructions">Follow the lines to the final. Scroll sideways to see every round.</p>
    <div className="tournament-scroll" role="region" tabIndex={0} aria-label={`Bracket for ${bracket.name}`}>
      <div className="tournament-tree" style={{ width, height: height + HEADER }}>
        <svg className="bracket-connectors" width={width} height={height + HEADER} aria-hidden="true">
          {bouts.flatMap(bout => (bout.advancesFrom || []).map(id => {
            const from = positions.get(id), to = positions.get(bout.sourceId);
            if (!from || !to || from.x >= to.x) return null;
            const start = from.x + CARD_WIDTH, elbow = to.x - ROUND_GAP / 2;
            return <path key={`${id}:${bout.sourceId}`} data-from={id} data-to={bout.sourceId}
              d={`M ${start} ${from.y} H ${elbow} V ${to.y} H ${to.x}`} />;
          }))}
        </svg>
        {groups.map((group, column) => <section className="tournament-round" key={rounds[column]} aria-label={rounds[column]}>
          <h5 style={{ left: column * (CARD_WIDTH + ROUND_GAP), width: CARD_WIDTH }}>{rounds[column] === 'Final' && <span aria-hidden="true">🏆 </span>}{rounds[column]}</h5>
          {group.map(bout => {
            const position = positions.get(bout.sourceId)!;
            return <div key={bout.sourceId} className={`tournament-node${bout.round === 'Final' ? ' championship' : ''}`}
              style={{ left: position.x, top: position.y - CARD_HEIGHT / 2, width: CARD_WIDTH, height: CARD_HEIGHT }}>
              {renderBout(bout)}
            </div>;
          })}
        </section>)}
      </div>
    </div>
  </>;
}
