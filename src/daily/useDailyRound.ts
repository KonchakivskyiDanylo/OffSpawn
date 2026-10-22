import { useCallback, useEffect, useRef, useState } from 'react';
import { sendStart } from '@/analytics/client';
import { useLocalState } from '@/lib/storage';
import { useDailySet } from './client';
import { DAILY_START, puzzleNumber } from './day';
import { logResult, readLog, savedRound, saveRound } from './progress';
import { DAILY_FROM, isLiveDaily, type DailyGame, type DailyPuzzles, type DailyResult } from './types';
import { usePuzzleDay, useToday } from './useDay';

/**
 * Daily or practice.
 *
 * The live site is daily only (the user, 3 Oct 2026: "I would probably have
 * only daily puzzles, setup is only for dev") from `DAILY_START` on — before
 * it, it plays as it always did, and it turns daily by itself at midnight on
 * the day (the user: "let's start it actually on 5th October"). A dev server
 * keeps the setup screens behind a toggle in each game's toolbar, for working
 * on the games; the choice is remembered in the browser.
 *
 * With a `game`, whether that game's page plays its daily: never for a game
 * not served as one (`LIVE_DAILY`), which plays unlimited everywhere. Without,
 * whether the site is in daily mode at all — the home page.
 */
export const DEV_TOGGLE = import.meta.env?.DEV === true;

export function usePlayMode(game?: DailyGame): [daily: boolean, setDaily: (daily: boolean) => void] {
  const [mode, setMode] = useLocalState<'daily' | 'practice'>('dev:play-mode', 'daily');
  const today = useToday();
  const set = useCallback((daily: boolean) => setMode(daily ? 'daily' : 'practice'), [setMode]);
  const on = DEV_TOGGLE ? mode === 'daily' : today >= (game ? DAILY_FROM[game] : DAILY_START);
  return [on && (game === undefined || isLiveDaily(game)), set];
}

export type DailyStatus = 'off' | 'loading' | 'ready' | 'missing' | 'error' | 'played';

export interface DailyRound<S> {
  /** The round, once the day's puzzle and the game's data are both in. */
  state: S | null;
  setState: (next: S) => void;
  /**
   * `loading` until the round exists; `missing` when the day has no puzzle for
   * this game or the data can no longer rebuild it; `error` when the puzzles
   * did not load; `played` when this browser finished the day already and its
   * board is no longer kept — the result is in `played`, and no new round.
   */
  status: DailyStatus;
  error: string | null;
  /** The day being played: today, or an earlier one from the archive (`usePuzzleDay`). */
  day: string;
  number: number;
  /** True for an earlier day's puzzle. */
  past: boolean;
  played: DailyResult | null;
  /**
   * With `played`: the day's puzzle as it starts, so the page can show its
   * answers beside the result — which ones this browser found went with the
   * board it no longer keeps. Null otherwise, or when the data cannot rebuild it.
   */
  answers: S | null;
  /**
   * True once the round has ended while this page was open. A round that was
   * already over when the page loaded was recorded the first time, so the
   * analytics recorder waits on this rather than on the round being over.
   */
  endedHere: boolean;
}

/**
 * The day's round for one game: rebuilt from the day's descriptor, carried on
 * from the browser's saved copy, and saved again on every move.
 *
 * `restore` is only called once `ready` is true — the game's own data loaded —
 * and again when the day turns over with the page open.
 */
export function useDailyRound<G extends DailyGame, S, Snap>(
  game: G,
  options: {
    on: boolean;
    ready: boolean;
    restore: (puzzle: DailyPuzzles[G], saved: Snap | null) => S | null;
    snapshot: (state: S) => Snap;
    finished: (state: S) => boolean;
    result: (state: S) => DailyResult;
  },
): DailyRound<S> {
  const { day, past } = usePuzzleDay(game);
  const { set, error } = useDailySet(options.on ? day : null);
  const [round, setRound] = useState<{
    day: string;
    state: S | null;
    played: DailyResult | null;
    answers?: S | null;
  } | null>(null);
  const [endedHere, setEndedHere] = useState(false);
  const latest = useRef(options);
  latest.current = options;

  const puzzle = set?.puzzles[game] as DailyPuzzles[G] | undefined;
  useEffect(() => {
    if (!options.on || !options.ready || !set) return;
    const saved = puzzle ? savedRound<Snap>(game, day, puzzle) : null;
    // Finished here before, its board since let go: the result, never a fresh start.
    const played = saved === null ? (readLog(game)[day] ?? null) : null;
    const restored = puzzle && !played ? latest.current.restore(puzzle, saved) : null;
    const answers = puzzle && played ? latest.current.restore(puzzle, null) : null;
    setRound({ day, state: restored, played, answers });
    setEndedHere(false);
  }, [options.on, options.ready, set, puzzle, game, day]);

  const current = round && round.day === day ? round : null;
  const shown = useRef<S | null>(null);
  shown.current = current?.state ?? null;

  const setState = useCallback(
    (next: S) => {
      const { snapshot, finished, result } = latest.current;
      const was = shown.current;
      if (was && !finished(was) && finished(next)) setEndedHere(true);
      // Nothing saved yet for the day: this is the first move, the daily's "started".
      if (savedRound(game, day, puzzle) === null) sendStart(game, true);
      shown.current = next;
      setRound({ day, state: next, played: null });
      saveRound(game, day, puzzle, snapshot(next));
      if (finished(next)) logResult(game, day, result(next), past);
    },
    [game, day, puzzle, past],
  );

  const status: DailyStatus = !options.on
    ? 'off'
    : error
      ? 'error'
      : !current
        ? 'loading'
        : current.state
          ? 'ready'
          : current.played
            ? 'played'
            : 'missing';
  return {
    state: current?.state ?? null,
    setState,
    status,
    error,
    day,
    number: puzzleNumber(day, game),
    past,
    played: current?.played ?? null,
    answers: current?.answers ?? null,
    endedHere,
  };
}
