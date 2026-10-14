import { readLocal, useLocalState, writeLocal } from '@/lib/storage';
import { addDays } from './day';
import { DAILY_GAMES, puzzleId, type DailyGame, type DailyResult } from './types';

/**
 * A player's daily history, in this browser only — there are no accounts yet
 * (the user, 3 Oct 2026: "streaks live only in the browser until accounts
 * exist").
 *
 *   daily:<game>       the round of the latest day played, in progress or
 *                      finished: which day, and the game's own snapshot of it,
 *                      so a reload carries on
 *   daily-past:<game>  the rounds of earlier days, day -> round: an earlier
 *                      day's round moves here when a later one starts, and a
 *                      puzzle played from the archive is kept here
 *   daily-log:<game>   every finished day, day -> how it went; streaks and the
 *                      home page read it
 *
 * Each day's round lives in exactly one of the first two, so an unfinished
 * puzzle picks up where it was left, from the archive too, and a finished one
 * shows its board again instead of starting over: a puzzle is played once.
 */

export interface SavedRound<Snap> {
  day: string;
  /**
   * The puzzle the round was played on, as its descriptor in JSON. A saved
   * round only comes back onto the same puzzle: the day's set is fixed on the
   * live site, but a dev server can make a different one for the same day.
   */
  puzzle?: string;
  snap: Snap;
}

export type DailyLog = Record<string, DailyResult>;

const EMPTY_LOG: DailyLog = {};

type PastRounds = Record<string, SavedRound<unknown>>;

export const roundKey = (game: DailyGame) => `daily:${game}`;
export const pastKey = (game: DailyGame) => `daily-past:${game}`;
export const logKey = (game: DailyGame) => `daily-log:${game}`;

/**
 * Finished earlier rounds kept, newest first, so their boards still show. Past
 * that, a finished day shows only its result from the log; an unfinished one
 * is always kept, or it could be started again from scratch.
 */
const KEEP_FINISHED = 60;

function roundFor<Snap>(game: DailyGame, day: string): SavedRound<Snap> | null {
  const latest = readLocal<SavedRound<Snap> | null>(roundKey(game), null);
  if (latest?.day === day) return latest;
  return (readLocal<PastRounds>(pastKey(game), {})[day] as SavedRound<Snap> | undefined) ?? null;
}

/**
 * The puzzle a round was saved on, as `puzzleId`. Rounds saved before 14 Oct
 * 2026 carry the whole descriptor, so it is read back through the same.
 */
function savedId(text: string | undefined): string | null {
  if (text === undefined) return null;
  try {
    return puzzleId(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The saved round for `day` and `puzzle`, or null. */
export function savedRound<Snap>(game: DailyGame, day: string, puzzle: unknown): Snap | null {
  const saved = roundFor<Snap>(game, day);
  return saved && savedId(saved.puzzle) === puzzleId(puzzle) ? saved.snap : null;
}

export function saveRound<Snap>(game: DailyGame, day: string, puzzle: unknown, snap: Snap): void {
  const round: SavedRound<Snap> = { day, puzzle: puzzleId(puzzle), snap };
  const latest = readLocal<SavedRound<unknown> | null>(roundKey(game), null);
  if (!latest || latest.day === day) {
    writeLocal(roundKey(game), round);
    return;
  }
  const past = { ...readLocal<PastRounds>(pastKey(game), {}) };
  if (day > latest.day) {
    // A later day starts: the one it replaces joins the earlier ones.
    past[latest.day] ??= latest;
    writeLocal(roundKey(game), round);
  } else {
    past[day] = round;
  }
  const log = readLog(game);
  const finished = Object.keys(past)
    .filter((key) => log[key])
    .sort()
    .reverse();
  for (const key of finished.slice(KEEP_FINISHED)) delete past[key];
  writeLocal(pastKey(game), past);
}

/** The days with a round saved, finished or not — an archive puzzle begun, as against one never opened. */
export function savedDays(game: DailyGame): Set<string> {
  const latest = readLocal<SavedRound<unknown> | null>(roundKey(game), null);
  const days = new Set(Object.keys(readLocal<PastRounds>(pastKey(game), {})));
  if (latest) days.add(latest.day);
  return days;
}

export function readLog(game: DailyGame): DailyLog {
  return readLocal<DailyLog>(logKey(game), EMPTY_LOG);
}

/**
 * Writes a finished day once; finishing it again (a reload) changes nothing.
 * `late` marks a puzzle played from the archive, after its own day.
 */
export function logResult(game: DailyGame, day: string, result: DailyResult, late = false): void {
  const log = readLog(game);
  if (log[day]) return;
  writeLocal(logKey(game), { ...log, [day]: late ? { ...result, late: true } : result });
}

export function useDailyLog(game: DailyGame): DailyLog {
  return useLocalState<DailyLog>(logKey(game), EMPTY_LOG)[0];
}

/**
 * Every daily game's log at once, for the home page. One hook per game in a
 * fixed order — `DAILY_GAMES` is a constant, so the order never changes.
 */
export function useDailyLogs(): Record<DailyGame, DailyLog> {
  const out = {} as Record<DailyGame, DailyLog>;
  // eslint-disable-next-line react-hooks/rules-of-hooks
  for (const game of DAILY_GAMES) out[game] = useLocalState<DailyLog>(logKey(game), EMPTY_LOG)[0];
  return out;
}

export interface DailyStats {
  played: number;
  won: number;
  /**
   * Days in a row with the daily played, win or lose, up to today — or up to
   * yesterday while today is still to play, so a streak does not read 0 all
   * morning. A streak counts playing, not winning: a hard day should not undo
   * a month of turning up. Only on the day itself: a missed day caught up
   * from the archive counts as played, but does not mend a streak.
   */
  streak: number;
  best: number;
}

export function statsOf(days: Iterable<string>, today: string, won = 0): DailyStats {
  const set = new Set(days);
  let streak = 0;
  let cursor = set.has(today) ? today : addDays(today, -1);
  while (set.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -1);
  }
  let best = 0;
  for (const day of set) {
    if (set.has(addDays(day, -1))) continue;
    let run = 0;
    for (let at = day; set.has(at); at = addDays(at, 1)) run++;
    best = Math.max(best, run);
  }
  return { played: set.size, won, streak, best };
}

export function gameStats(log: DailyLog, today: string): DailyStats {
  const entries = Object.entries(log);
  const won = entries.filter(([, entry]) => entry.outcome === 'won' || entry.outcome === 'cleared').length;
  const onTime = entries.filter(([, entry]) => !entry.late).map(([day]) => day);
  return { ...statsOf(onTime, today, won), played: entries.length };
}
