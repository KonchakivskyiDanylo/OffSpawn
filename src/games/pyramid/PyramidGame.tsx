import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { sendStart, useRoundRecorder } from '@/analytics/client';
import { GameShell } from '@/components/GameShell';
import { GiveUpButton } from '@/components/GiveUpButton';
import { WhatCounts } from '@/components/Glossary';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { LevelSetup, type LevelOption } from '@/components/PoolSetup';
import { Banner, Hearts, Stat } from '@/components/ui';
import type { Facts } from '@/data/liquipedia/facts';
import { loadMajors, type Majors } from '@/data/liquipedia/majors';
import { loadRankings, type Rankings } from '@/data/liquipedia/rankings';
import type { Roster } from '@/data/liquipedia/roster';
import { useFacts } from '@/data/liquipedia/useFacts';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import { getGame } from '@/games/registry';
import { termsIn } from '@/games/shared/glossary';
import { plural } from '@/lib/format';
import {
  check,
  createGame,
  generatePuzzle,
  giveUp,
  inPlace,
  LEVELS,
  record as roundRecord,
  rightAt,
  ROWS,
  SIZE,
  swap,
  type Difficulty,
  type GameState,
  type Item,
} from './engine';
import './pyramid.css';
import { useSocials } from '@/data/useSocials';

const meta = getGame('pyramid')!;

const DIFFICULTIES: LevelOption<Difficulty>[] = [
  { id: 'easy', label: '🟢 Easy', hint: 'Famous players. Check as often as you like.' },
  { id: 'medium', label: '🟡 Medium', hint: `The regulars too, closer values. ${LEVELS.medium.lives} lives.` },
  { id: 'hard', label: '🔴 Hard', hint: 'Anyone, closest values. One check, then the answer.' },
];

export default function PyramidGame() {
  const { roster, error: rosterError } = useRoster();
  const { facts, error: factsError } = useFacts();

  return (
    <LiquipediaGate error={rosterError ?? factsError} ready={Boolean(roster && facts)}>
      {roster && facts ? <Game roster={roster} facts={facts} /> : null}
    </LiquipediaGate>
  );
}

function Game({ roster, facts }: { roster: Roster; facts: Facts }) {
  const { pools } = usePools();
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The position picked up by a tap, waiting for a second tap to swap with. */
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  /*
   * Tenaball's boards, for the tournament pyramids. Loaded after the first
   * paint and not waited for: they only add a category, and a missing file
   * costs that category rather than the game.
   */
  const [rankings, setRankings] = useState<Rankings | null>(null);
  /**
   * Every finish at every major: tournaments past their top ten, FNCS top 10s
   * and the Globals averages. Same terms — without it those are not drawn.
   */
  const [majors, setMajors] = useState<Majors | null>(null);
  /** Follower counts, for the follower pyramids; none is the same as no such category. */
  const socials = useSocials();
  useEffect(() => {
    let cancelled = false;
    loadRankings().then(
      (loaded) => !cancelled && setRankings(loaded),
      () => {},
    );
    loadMajors().then(
      (loaded) => !cancelled && setMajors(loaded),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useRoundRecorder('pyramid', game !== null && game.status !== 'playing', () => ({
    title: `Pyramid — ${game!.puzzle.title}`,
    data: facts.generated,
    setup: { level: game!.difficulty },
    ...roundRecord(game!),
  }));

  const start = useCallback(() => {
    const puzzle = generatePuzzle(roster, facts, rankings, difficulty, undefined, game?.puzzle.id ?? null, majors, socials);
    if (!puzzle) {
      setError('Could not build a pyramid from this data.');
      return;
    }
    setError(null);
    setFeedback(null);
    setSelected(null);
    sendStart('pyramid', false);
    setGame(createGame(puzzle, difficulty));
  }, [roster, facts, rankings, majors, socials, difficulty, game]);

  const move = (a: number, b: number) => {
    if (!game) return;
    setGame(swap(game, a, b));
    setSelected(null);
    setFeedback(null);
  };

  /** A tap, or Enter on a focused tile: pick up, put down, or swap. */
  const tap = (position: number) => {
    if (!game || game.status !== 'playing' || game.locked.has(game.order[position].id)) return;
    if (selected === null) setSelected(position);
    else if (selected === position) setSelected(null);
    else move(selected, position);
  };

  const onCheck = () => {
    if (!game) return;
    const next = check(game);
    setGame(next);
    setSelected(null);
    const right = next.locked.size;
    if (next.status === 'won') setFeedback(null);
    else if (next.status === 'playing') {
      setFeedback(`${right} of ${SIZE} in place — ${right ? 'the green ones are locked. ' : ''}Swap the red ones round.`);
    }
  };

  if (!game) {
    return (
      <GameShell game={meta} dataNote={<RosterNote />}>
        <div className="stack">
          <LevelSetup
            pools={pools}
            event={null}
            levels={DIFFICULTIES}
            value={difficulty}
            onChange={setDifficulty}
            onStart={start}
            startLabel="New pyramid"
          />
          {error ? (
            <Banner tone="danger" title="Cannot start">
              {error}
            </Banner>
          ) : null}
        </div>
      </GameShell>
    );
  }

  const { puzzle } = game;
  const finished = game.status !== 'playing';
  const lives = LEVELS[game.difficulty].lives;

  return (
    <GameShell
      game={meta}
      dataNote={<RosterNote />}
      toolbar={
        <button type="button" className="icon-btn" onClick={() => setGame(null)}>
          ↺ New pyramid
        </button>
      }
    >
      <div className="stack pyr-play">
        <div className="stats">
          <Stat label="Locked" value={`${game.locked.size}/${SIZE}`} />
          {Number.isFinite(lives) ? (
            <Stat
              label={lives === 1 ? 'Life' : 'Lives'}
              value={<Hearts left={Math.max(0, game.lives)} total={lives} />}
            />
          ) : (
            <Stat label="Checks" value={game.checks} />
          )}
        </div>

        <section className="card pyr-head">
          <span className="pyr-head__group">{puzzle.group}</span>
          <h2 className="pyr-head__title">{puzzle.title}</h2>
          <p className="small muted pyr-head__direction">
            <span aria-hidden="true">▲</span> {puzzle.direction}
          </p>
          <WhatCounts terms={termsIn(puzzle.title, puzzle.id)} />
        </section>

        {finished ? (
          <Answer game={game} />
        ) : (
          <Pyramid game={game} selected={selected} onTap={tap} onSwap={move} />
        )}

        {finished ? (
          <div className="stack">
            <Banner
              tone={game.status === 'won' ? 'success' : 'danger'}
              title={game.status === 'won' ? 'Pyramid solved!' : game.gaveUp ? 'Gave up' : 'Out of checks'}
            >
              {game.status === 'won'
                ? `All ten in place in ${plural(game.checks, 'check')}.`
                : `${inPlace(game)} of ${SIZE} were in the right place. The pyramid above is the right order.`}
            </Banner>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={start}>
              New pyramid
            </button>
          </div>
        ) : (
          <div className="stack-sm">
            <p className="small center muted" style={{ margin: 0 }} aria-live="polite">
              {feedback ??
                (selected !== null
                  ? `Now tap where ${game.order[selected].name} should go.`
                  : 'Tap two players to swap them, or drag one onto another.')}
            </p>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={onCheck}>
              {game.lives === 1 ? 'Lock in my order' : 'Check'}
            </button>
            <div className="row" style={{ justifyContent: 'center' }}>
              <GiveUpButton onGiveUp={() => setGame(giveUp(game))} />
            </div>
          </div>
        )}
      </div>
    </GameShell>
  );
}

/** Positions split into the pyramid's rows: [0], [1, 2], [3, 4, 5], [6, 7, 8, 9]. */
function rowsOf<T>(items: readonly T[]): { item: T; position: number }[][] {
  let at = 0;
  return ROWS.map((width) => {
    const row = items.slice(at, at + width).map((item, i) => ({ item, position: at + i }));
    at += width;
    return row;
  });
}

/**
 * The board while playing.
 *
 * Two ways to move, both a swap: tap one player then another, or drag one onto
 * another. Dragging is pointer events rather than HTML drag and drop, which
 * does nothing on a phone. The target is found by the tiles' boxes, not by
 * what is under the finger, because the tile being dragged is always there.
 * Enter or Space on a focused tile is the same as a tap.
 */
function Pyramid({
  game,
  selected,
  onTap,
  onSwap,
}: {
  game: GameState;
  selected: number | null;
  onTap: (position: number) => void;
  onSwap: (a: number, b: number) => void;
}) {
  const tiles = useRef(new Map<number, HTMLButtonElement>());
  const press = useRef<{ position: number; x: number; y: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{ position: number; dx: number; dy: number; over: number | null } | null>(
    null,
  );

  const locked = (position: number) => game.locked.has(game.order[position].id);

  const targetAt = (x: number, y: number, from: number): number | null => {
    for (const [position, element] of tiles.current) {
      if (position === from || locked(position)) continue;
      const box = element.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return position;
    }
    return null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, position: number) => {
    if (event.button !== 0 || locked(position)) return;
    press.current = { position, x: event.clientX, y: event.clientY, moved: false };
    try {
      // Keeps the moves coming when the finger leaves the tile. Some browsers
      // refuse it for a pointer they consider gone; the drag works without it.
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* no capture — moves still arrive while over the tile */
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = press.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 8) return;
    start.moved = true;
    setDrag({ position: start.position, dx, dy, over: targetAt(event.clientX, event.clientY, start.position) });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const start = press.current;
    press.current = null;
    setDrag(null);
    if (!start) return;
    if (!start.moved) {
      onTap(start.position);
      return;
    }
    const target = targetAt(event.clientX, event.clientY, start.position);
    if (target !== null) onSwap(start.position, target);
  };

  const onPointerCancel = () => {
    press.current = null;
    setDrag(null);
  };

  return (
    <div className="pyr" role="group" aria-label="The pyramid, first place at the top">
      {rowsOf(game.order).map((row, index) => (
        <div key={index} className="pyr__row">
          {row.map(({ item, position }) => {
            const isLocked = locked(position);
            const dragging = drag?.position === position;
            const classes = ['pyr-tile'];
            if (isLocked) classes.push('pyr-tile--right');
            else if (game.wrong.has(item.id)) classes.push('pyr-tile--wrong');
            if (selected === position) classes.push('pyr-tile--selected');
            if (dragging) classes.push('pyr-tile--dragging');
            if (drag?.over === position) classes.push('pyr-tile--target');
            return (
              <button
                key={item.id}
                ref={(element) => {
                  if (element) tiles.current.set(position, element);
                  else tiles.current.delete(position);
                }}
                type="button"
                className={classes.join(' ')}
                style={dragging ? { transform: `translate(${drag.dx}px, ${drag.dy}px) scale(1.05)` } : undefined}
                aria-pressed={selected === position}
                aria-label={`${position + 1}: ${item.name}${isLocked ? ', correct and locked' : game.wrong.has(item.id) ? ', in the wrong place' : ''}`}
                onPointerDown={(event) => onPointerDown(event, position)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                // Pointer taps are handled on pointer up; this is the keyboard.
                onClick={(event) => event.detail === 0 && onTap(position)}
              >
                <span className="pyr-tile__rank">{position + 1}</span>
                <span className="pyr-tile__name">{item.name}</span>
                {isLocked ? (
                  <span className="pyr-tile__lock" aria-hidden="true">
                    🔒
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * The right order, once the round is over, with every value shown. Green is
 * a player you had in the right place, red one you did not — and where you had
 * them, so the miss can be read.
 */
function Answer({ game }: { game: GameState }) {
  const placedAt = new Map<string, number>(game.order.map((item, position) => [item.id, position]));
  const right = new Set(
    game.order.filter((_, position) => rightAt(game.puzzle, game.order, position)).map((item: Item) => item.id),
  );
  return (
    <div className="pyr pyr--answer" role="group" aria-label="The right order">
      {rowsOf(game.puzzle.items).map((row, index) => (
        <div key={index} className="pyr__row">
          {row.map(({ item, position }) => {
            const ok = right.has(item.id);
            return (
              <div key={item.id} className={`pyr-tile ${ok ? 'pyr-tile--right' : 'pyr-tile--wrong'}`}>
                <span className="pyr-tile__rank">{position + 1}</span>
                <span className="pyr-tile__name">{item.name}</span>
                <span className="pyr-tile__value">{item.display}</span>
                {ok ? null : <span className="pyr-tile__was">you: {placedAt.get(item.id)! + 1}</span>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
