import { useCallback, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { sendStart, useRoundRecorder } from '@/analytics/client';
import { GameShell } from '@/components/GameShell';
import { GiveUpButton } from '@/components/GiveUpButton';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { LevelSetup, type LevelOption } from '@/components/PoolSetup';
import { Banner, Hearts, Stat } from '@/components/ui';
import type { Bios } from '@/data/liquipedia/bios';
import type { Facts } from '@/data/liquipedia/facts';
import type { Majors } from '@/data/liquipedia/majors';
import type { Orgs } from '@/data/liquipedia/orgs';
import type { Roster } from '@/data/liquipedia/roster';
import { useBios } from '@/data/liquipedia/useBios';
import { useFacts } from '@/data/liquipedia/useFacts';
import { useMajors } from '@/data/liquipedia/useMajors';
import { useOrgs } from '@/data/liquipedia/useOrgs';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import { getGame } from '@/games/registry';
import { LEVEL_LABEL, type Level } from '@/games/shared/levels';
import { plural } from '@/lib/format';
import { makeRng } from '@/lib/rng';
import {
  allMoments,
  check,
  createGame,
  deal,
  giveUp,
  inPlace,
  LEVELS,
  record as roundRecord,
  rightAt,
  swap,
  when,
  type GameState,
} from './engine';
import './rewind.css';

const meta = getGame('rewind')!;

const DIFFICULTIES: LevelOption<Level>[] = [
  { id: 'easy', label: LEVEL_LABEL.easy, hint: `${LEVELS.easy.size} moments about famous names, far apart. Check as often as you like.` },
  { id: 'medium', label: LEVEL_LABEL.medium, hint: `${LEVELS.medium.size} moments, closer together. ${LEVELS.medium.lives} lives.` },
  { id: 'hard', label: LEVEL_LABEL.hard, hint: `${LEVELS.hard.size} moments, anyone. ${LEVELS.hard.lives} lives.` },
];

export default function RewindGame() {
  const { roster, error: rosterError } = useRoster();
  const { facts, error: factsError } = useFacts();
  const { bios } = useBios();
  const { orgs, error: orgsError } = useOrgs();
  const { majors, error: majorsError } = useMajors();
  // Orgs and majors only add kinds of moment, so a missing file is played
  // without them — but a deal waits for them rather than racing them.
  const settled = Boolean(roster && facts && bios && (orgs || orgsError) && (majors || majorsError));
  return (
    <LiquipediaGate error={rosterError ?? factsError} ready={settled}>
      {roster && facts && bios && settled ? (
        <Game roster={roster} facts={facts} bios={bios} orgs={orgs} majors={majors} />
      ) : null}
    </LiquipediaGate>
  );
}

function Game({
  roster,
  facts,
  bios,
  orgs,
  majors,
}: {
  roster: Roster;
  facts: Facts;
  bios: Bios;
  orgs: Orgs | null;
  majors: Majors | null;
}) {
  const { pools } = usePools();
  const [level, setLevel] = useState<Level>('easy');
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const moments = useMemo(
    () => allMoments({ roster, facts, bios, orgs, majors }),
    [roster, facts, bios, orgs, majors],
  );

  useRoundRecorder('rewind', game !== null && game.status !== 'playing', () => ({
    title: `Rewind — ${game!.level}`,
    data: facts.generated,
    setup: { level: game!.level },
    ...roundRecord(game!),
  }));

  const start = useCallback(() => {
    const seed = String(Date.now());
    const hand = deal(moments, level, makeRng(seed));
    if (!hand) {
      setError('Could not deal a timeline from this data.');
      return;
    }
    setError(null);
    setFeedback(null);
    setSelected(null);
    sendStart('rewind', false);
    setGame(createGame(hand, level, seed));
  }, [moments, level]);

  const move = (a: number, b: number) => {
    if (!game) return;
    setGame(swap(game, a, b));
    setSelected(null);
    setFeedback(null);
  };

  const tap = (index: number) => {
    if (!game || game.status !== 'playing' || game.locked.has(game.order[index].id)) return;
    if (selected === null) setSelected(index);
    else if (selected === index) setSelected(null);
    else move(selected, index);
  };

  /** The nearest card above or below that is not locked, to swap with. */
  const step = (index: number, direction: -1 | 1) => {
    if (!game) return;
    for (let other = index + direction; other >= 0 && other < game.order.length; other += direction) {
      if (!game.locked.has(game.order[other].id)) {
        move(index, other);
        return;
      }
    }
  };

  const onCheck = () => {
    if (!game) return;
    const next = check(game);
    setGame(next);
    setSelected(null);
    if (next.status === 'playing') {
      const right = next.locked.size;
      setFeedback(`${right} of ${next.order.length} in place${right ? ' — the green ones are locked' : ''}. Swap the red ones round.`);
    } else setFeedback(null);
  };

  if (!game) {
    return (
      <GameShell game={meta}>
        <div className="stack">
          <LevelSetup
            pools={pools}
            event={null}
            levels={DIFFICULTIES}
            value={level}
            onChange={setLevel}
            onStart={start}
            startLabel="Deal a timeline"
          />
          {bios.dated ? null : (
            <p className="tiny faint center" style={{ margin: 0 }}>
              Signings, departures and org titles arrive with the next data build (bios.json).
            </p>
          )}
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
  const lives = LEVELS[game.level].lives;

  return (
    <GameShell
      game={meta}
      dataNote={<RosterNote />}
      toolbar={
        <button type="button" className="icon-btn" onClick={() => setGame(null)}>
          ↺ New timeline
        </button>
      }
    >
      <div className="stack rw-play">
        <div className="stats">
          <Stat label="Locked" value={`${game.locked.size}/${game.order.length}`} />
          {Number.isFinite(lives) ? (
            <Stat label={lives === 1 ? 'Life' : 'Lives'} value={<Hearts left={Math.max(0, game.lives)} total={lives} />} />
          ) : (
            <Stat label="Checks" value={game.checks} />
          )}
        </div>

        {finished ? <Answer game={game} /> : <Timeline game={game} selected={selected} onTap={tap} onSwap={move} onStep={step} />}

        {finished ? (
          <div className="stack">
            <Banner
              tone={game.status === 'won' ? 'success' : 'danger'}
              title={game.status === 'won' ? 'History restored!' : game.gaveUp ? 'Gave up' : 'Out of checks'}
            >
              {game.status === 'won'
                ? `All ${game.order.length} in order in ${plural(game.checks, 'check')}.`
                : `${inPlace(game)} of ${game.order.length} were in the right place. Above is the real order.`}
            </Banner>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={start}>
              Next timeline
            </button>
          </div>
        ) : (
          <div className="stack-sm">
            <p className="small center muted" style={{ margin: 0 }} aria-live="polite">
              {feedback ??
                (selected !== null
                  ? 'Now tap the card to swap it with.'
                  : 'Tap two cards to swap them, drag one onto another, or use the arrows.')}
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

/**
 * The cards while playing, oldest at the top. Dragging is pointer events, as
 * in Pyramid, so it works on a phone; the target is whichever card's box the
 * pointer is over when it lets go.
 */
function Timeline({
  game,
  selected,
  onTap,
  onSwap,
  onStep,
}: {
  game: GameState;
  selected: number | null;
  onTap: (index: number) => void;
  onSwap: (a: number, b: number) => void;
  onStep: (index: number, direction: -1 | 1) => void;
}) {
  const cards = useRef(new Map<number, HTMLDivElement>());
  const press = useRef<{ index: number; y: number; moved: boolean } | null>(null);
  const [drag, setDrag] = useState<{ index: number; dy: number; over: number | null } | null>(null);
  const locked = (index: number) => game.locked.has(game.order[index].id);

  const targetAt = (x: number, y: number, from: number): number | null => {
    for (const [index, element] of cards.current) {
      if (index === from || locked(index)) continue;
      const box = element.getBoundingClientRect();
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return index;
    }
    return null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (event.button !== 0 || locked(index)) return;
    if ((event.target as HTMLElement).closest('button')) return;
    press.current = { index, y: event.clientY, moved: false };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* no capture — moves still arrive while over the card */
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = press.current;
    if (!start) return;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.abs(dy) < 8) return;
    start.moved = true;
    setDrag({ index: start.index, dy, over: targetAt(event.clientX, event.clientY, start.index) });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = press.current;
    press.current = null;
    setDrag(null);
    if (!start) return;
    if (!start.moved) {
      onTap(start.index);
      return;
    }
    const target = targetAt(event.clientX, event.clientY, start.index);
    if (target !== null) onSwap(start.index, target);
  };

  return (
    <div className="rw-line" role="list" aria-label="Moments, oldest at the top">
      <div className="rw-end">Oldest</div>
      {game.order.map((moment, index) => {
        const isLocked = locked(index);
        const classes = ['rw-card'];
        if (isLocked) classes.push('rw-card--right');
        else if (game.wrong.has(moment.id)) classes.push('rw-card--wrong');
        if (selected === index) classes.push('rw-card--selected');
        if (drag?.index === index) classes.push('rw-card--dragging');
        if (drag?.over === index) classes.push('rw-card--target');
        return (
          <div
            key={moment.id}
            ref={(element) => {
              if (element) cards.current.set(index, element);
              else cards.current.delete(index);
            }}
            role="listitem"
            className={classes.join(' ')}
            style={drag?.index === index ? { transform: `translateY(${drag.dy}px) scale(1.02)` } : undefined}
            onPointerDown={(event) => onPointerDown(event, index)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              press.current = null;
              setDrag(null);
            }}
            tabIndex={isLocked ? -1 : 0}
            aria-label={`${index + 1}: ${moment.text}${isLocked ? `, correct, ${when(moment)}` : ''}`}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onTap(index);
              }
            }}
          >
            <span className="rw-card__pos">{index + 1}</span>
            <span className="rw-card__icon" aria-hidden="true">
              {moment.icon}
            </span>
            <span className="rw-card__text">{moment.text}</span>
            {/* A locked card has no arrows, so its date takes their place and the card stays one line. */}
            {isLocked ? (
              <span className="rw-card__date">
                {when(moment)}
                <span className="rw-card__lock" aria-hidden="true">
                  🔒
                </span>
              </span>
            ) : (
              <span className="rw-card__moves">
                <button type="button" className="rw-move" aria-label="Move up" onClick={() => onStep(index, -1)} disabled={index === 0}>
                  ▲
                </button>
                <button
                  type="button"
                  className="rw-move"
                  aria-label="Move down"
                  onClick={() => onStep(index, 1)}
                  disabled={index === game.order.length - 1}
                >
                  ▼
                </button>
              </span>
            )}
          </div>
        );
      })}
      <div className="rw-end">Newest</div>
    </div>
  );
}

/** The real order once it is over, every date shown; red where you had something else. */
function Answer({ game }: { game: GameState }) {
  return (
    <div className="rw-line" role="list" aria-label="The real order">
      <div className="rw-end">Oldest</div>
      {game.solution.map((moment, index) => {
        const ok = rightAt(game, index);
        return (
          <div key={moment.id} role="listitem" className={`rw-card ${ok ? 'rw-card--right' : 'rw-card--wrong'}`}>
            <span className="rw-card__pos">{index + 1}</span>
            <span className="rw-card__icon" aria-hidden="true">
              {moment.icon}
            </span>
            <span className="rw-card__text">{moment.text}</span>
            <span className="rw-card__date">{when(moment)}</span>
          </div>
        );
      })}
      <div className="rw-end">Newest</div>
    </div>
  );
}
