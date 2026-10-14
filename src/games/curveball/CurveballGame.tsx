import { useCallback, useState } from 'react';
import { sendStart, useRoundRecorder } from '@/analytics/client';
import { ClueActions, GuessChips } from '@/components/ClueControls';
import { GameShell } from '@/components/GameShell';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { PlayerSearch } from '@/components/PlayerSearch';
import { LevelSetup, type LevelOption } from '@/components/PoolSetup';
import { SecretCard } from '@/components/SecretCard';
import { Banner, Stat } from '@/components/ui';
import { EXPORT_DATE, type Roster } from '@/data/liquipedia/roster';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import { getGame } from '@/games/registry';
import { giveUp, guess, skip } from '@/games/shared/clue-round';
import { dealFresh, LEVEL_LABEL, levelPlayers, type Level } from '@/games/shared/levels';
import { moneyShort, plural } from '@/lib/format';
import {
  AXIS,
  createGame,
  eligible,
  heightOf,
  MIN_GUESSES,
  pointLabel,
  record as roundRecord,
  totalSoFar,
  type GameState,
  type Point,
} from './engine';
import './curveball.css';

const meta = getGame('curveball')!;

const LEVELS: LevelOption<Level>[] = [
  { id: 'easy', label: LEVEL_LABEL.easy, hint: 'The names everyone knows.' },
  { id: 'medium', label: LEVEL_LABEL.medium, hint: 'The regulars of the scene too.' },
  { id: 'hard', label: LEVEL_LABEL.hard, hint: 'Anyone with three years of prize money.' },
];

export default function CurveballGame() {
  const { roster, error } = useRoster();
  return (
    <LiquipediaGate error={error} ready={Boolean(roster)}>
      {roster ? <Game roster={roster} /> : null}
    </LiquipediaGate>
  );
}

function Game({ roster }: { roster: Roster }) {
  const { pools } = usePools();
  const [level, setLevel] = useState<Level>('easy');
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useRoundRecorder('curveball', game !== null && game.status !== 'playing', () => ({
    title: `Curveball — ${game!.secret.name}`,
    data: EXPORT_DATE,
    setup: { level },
    ...roundRecord(game!),
  }));

  const start = useCallback(() => {
    const pick = dealFresh(meta.id, [level], levelPlayers(roster, level, eligible));
    if (!pick) {
      setError('Nobody at this level has three years of prize money.');
      return;
    }
    setError(null);
    sendStart('curveball', false);
    setGame(createGame(pick));
  }, [roster, level]);

  if (!game) {
    return (
      <GameShell game={meta}>
        <div className="stack">
          <LevelSetup pools={pools} event={null} levels={LEVELS} value={level} onChange={setLevel} onStart={start} />
          {error ? (
            <Banner tone="danger" title="Cannot start">
              {error}
            </Banner>
          ) : null}
        </div>
      </GameShell>
    );
  }

  const finished = game.status !== 'playing';
  const short = game.clues.length < MIN_GUESSES;

  return (
    <GameShell
      game={meta}
      dataNote={<RosterNote />}
      toolbar={
        <>
          <button type="button" className="icon-btn" onClick={start}>
            ↺ New curve
          </button>
          <button type="button" className="icon-btn" onClick={() => setGame(null)}>
            ⚙ Setup
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="stats">
          <Stat label="Years" value={`${finished ? game.earned : game.revealed}/${game.clues.length}`} />
          <Stat label="Guesses" value={game.guesses.length} />
          <Stat
            label={finished ? 'Career total' : 'Total so far'}
            value={moneyShort(totalSoFar(game.clues, finished ? game.clues.length : game.revealed))}
          />
        </div>

        <section className="card stack cb-card">
          <div className="row-between">
            <div className="card__title" style={{ marginBottom: 0 }}>
              Prize money, by year
            </div>
            {/* The span would be a clue of its own, so it waits for the end. */}
            <span className="tiny faint">
              {plural(game.clues.length, 'year')}
              {finished ? ` · ${game.clues[0].year}–${game.clues[game.clues.length - 1].year}` : ''}
            </span>
          </div>
          <Chart points={game.clues} shown={game.revealed} earned={finished ? game.earned : null} />
          <YearTable points={game.clues} shown={game.revealed} earned={finished ? game.earned : null} />
          {short && !finished ? (
            <p className="tiny faint" style={{ margin: 0 }}>
              A short curve: you still get {MIN_GUESSES} guesses — the ones after the last year draw nothing new.
            </p>
          ) : null}
        </section>

        {finished ? (
          <div className="stack">
            <Banner
              tone={game.status === 'won' ? 'success' : 'danger'}
              title={
                game.status === 'won'
                  ? `Got it in ${plural(game.earned, 'year')}!`
                  : game.gaveUp
                    ? 'Round over'
                    : 'Out of years'
              }
            >
              The curve was <strong>{game.secret.name}</strong>’s.
            </Banner>
            <SecretCard player={game.secret} />
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={start}>
              Next curve
            </button>
          </div>
        ) : (
          <div className="stack-sm">
            <PlayerSearch
              players={roster.players}
              onPick={(player) => setGame(guess(game, player))}
              exclude={new Set(game.guesses.map((g) => g.id))}
              autoFocus
            />
            <ClueActions round={game} noun="year" onReveal={() => setGame(skip(game))} onGiveUp={() => setGame(giveUp(game))} />
          </div>
        )}

        <GuessChips guesses={game.guesses} secretId={game.secret.id} />
      </div>
    </GameShell>
  );
}

// ------------------------------------------------------------------ chart --

const W = 640;
const H = 300;
const PAD = { left: 58, right: 18, top: 26, bottom: 38 };
const FLOOR = H - PAD.bottom;

function moneyTick(value: number): string {
  return value >= 1_000_000 ? `$${value / 1_000_000}M` : value >= 1_000 ? `$${value / 1_000}K` : `$${value}`;
}

/** Height of an amount on the plot (the engine's fixed axis); null for a year with nothing to plot. */
function yOf(value: number): number | null {
  if (!value) return null;
  return FLOOR - heightOf(value) * (FLOOR - PAD.top);
}

function Chart({
  points,
  shown,
  earned,
}: {
  points: readonly Point[];
  shown: number;
  /** Set once the round is over: the points after it were never needed, and are dimmed. */
  earned: number | null;
}) {
  const slot = (W - PAD.left - PAD.right) / points.length;
  const xOf = (index: number) => PAD.left + slot * (index + 0.5);
  const plotted = points.slice(0, shown).map((point, index) => ({
    point,
    index,
    x: xOf(index),
    y: yOf(point.earnings),
  }));
  // An empty year sits on the floor: the line drops to it rather than breaking.
  const at = (y: number | null) => y ?? FLOOR;
  const line = plotted.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${at(p.y).toFixed(1)}`).join(' ');
  const area =
    plotted.length > 1
      ? `${line} L${plotted[plotted.length - 1].x.toFixed(1)},${FLOOR} L${plotted[0].x.toFixed(1)},${FLOOR} Z`
      : '';

  return (
    <svg
      className="cb-chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Prize money by year: ${plotted.map((p) => `${p.point.year} ${pointLabel(p.point)}`).join(', ')}`}
    >
      <defs>
        <linearGradient id="cb-stroke" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--primary)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent)' }} />
        </linearGradient>
        <linearGradient id="cb-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--primary)', stopOpacity: 0.32 }} />
          <stop offset="1" style={{ stopColor: 'var(--primary)', stopOpacity: 0 }} />
        </linearGradient>
      </defs>

      {AXIS.ticks.map((value) => {
        const y = yOf(value)!;
        return (
          // Dashed at the knee: above it the scale is squeezed, so a gap there means more.
          <g key={value} className={`cb-grid${value === AXIS.knee ? ' cb-grid--knee' : ''}`}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end">
              {moneyTick(value)}
            </text>
          </g>
        );
      })}
      <g className="cb-grid">
        <text x={PAD.left - 8} y={FLOOR + 4} textAnchor="end">
          $0
        </text>
      </g>
      <line className="cb-floor" x1={PAD.left} x2={W - PAD.right} y1={FLOOR} y2={FLOOR} />

      {points.map((point, index) => {
        const hidden = index >= shown;
        return (
          <g key={point.year} className={hidden ? 'cb-slot cb-slot--hidden' : 'cb-slot'}>
            {hidden ? <line x1={xOf(index)} x2={xOf(index)} y1={PAD.top} y2={FLOOR} /> : null}
            <text x={xOf(index)} y={H - 14} textAnchor="middle">
              {hidden ? '?' : point.year}
            </text>
          </g>
        );
      })}

      {area ? <path className="cb-area" d={area} /> : null}
      {plotted.length > 1 ? <path className="cb-line" d={line} /> : null}

      {plotted.map(({ point, index, x, y }) => {
        const late = earned !== null && index >= earned;
        const newest = earned === null && index === shown - 1;
        const labelY = at(y) < PAD.top + 22 ? at(y) + 22 : at(y) - 12;
        return (
          <g
            key={point.year}
            className={`cb-point${late ? ' cb-point--late' : ''}${newest ? ' cb-point--new' : ''}${y === null ? ' cb-point--empty' : ''}`}
          >
            {newest ? <circle className="cb-point__ring" cx={x} cy={at(y)} r={13} /> : null}
            <circle className="cb-point__dot" cx={x} cy={at(y)} r={6} />
            <text x={x} y={labelY} textAnchor="middle">
              {pointLabel(point)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** The same numbers as a row of years — the roadmap's V1 table, under its V2 graph. */
function YearTable({
  points,
  shown,
  earned,
}: {
  points: readonly Point[];
  shown: number;
  earned: number | null;
}) {
  return (
    <ol className="cb-years list-reset">
      {points.map((point, index) => {
        const hidden = index >= shown;
        const late = earned !== null && index >= earned;
        return (
          <li key={point.year} className={`cb-year${hidden ? ' cb-year--hidden' : ''}${late ? ' cb-year--late' : ''}`}>
            <span className="cb-year__label">{hidden ? '????' : point.year}</span>
            <span className="cb-year__value">{hidden ? '?' : pointLabel(point)}</span>
          </li>
        );
      })}
    </ol>
  );
}
