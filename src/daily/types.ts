import type { Rng } from '@/lib/rng';
import type { Board } from '@/data/liquipedia/rankings';
import type { RosterPlayer } from '@/data/liquipedia/roster';

/**
 * The daily puzzles: one per game per day, the same for everyone.
 *
 * A day's puzzles are a `DailySet` — for each game a small descriptor naming
 * what to play (a secret player and the clues in order, a Tenaball board, the
 * six rules of a grid), never the puzzle itself. The server makes the set the
 * first time anyone asks for a day and keeps it, so a deploy or a data update
 * at noon cannot swap the puzzle under the people who have not played it yet
 * (`server/index.ts`, `GET /api/daily/<day>`). Each game rebuilds its round
 * from the descriptor (`games/<game>/daily.ts`).
 */

/** The games with a daily puzzle built. Higher or Lower stays an endless run. */
export const DAILY_GAMES = ['wordle', 'career-path', 'who-are-ya', 'tenaball', 'list', 'tic-tac-toe'] as const;

export type DailyGame = (typeof DAILY_GAMES)[number];

/**
 * The ones served as a daily: made each day, played once a day on the live
 * site, listed under "Today's puzzles". The rest keep their daily code but play
 * unlimited, setup screens and all, like Higher or Lower — Career Path, Who Are
 * Ya? and Tic Tac Toe (the user, 4 Oct 2026: "having who are ya and career path
 * unlimited for now", "tic tac toe maybe unlimited as well"), and Fortnitedle
 * from 5 Oct 2026 — or are hidden: List, back in about a month. Add a game here to make it a daily again; days
 * the schedule editor already made ahead have no puzzle for it, so draw one
 * with New there.
 */
export const LIVE_DAILY: readonly DailyGame[] = ['tenaball'];

export const isLiveDaily = (game: string): game is DailyGame => (LIVE_DAILY as readonly string[]).includes(game);

export interface DailyPuzzles {
  wordle: { secret: string };
  /** `clues` are tournament names, in the order they are revealed. */
  'career-path': { secret: string; clues: string[] };
  /** `clues` are teammate ids, in the order they are revealed. */
  'who-are-ya': { secret: string; clues: string[] };
  /**
   * `sig` fingerprints who was on the board that day (`reuse.ts`), so a changed
   * board can come back. `frozen` is the board itself, rows and numbers, pinned
   * the first time the day is served on or after its date (`freezeDay` in
   * `generate.ts`): a data update afterwards changes the boards to come, never
   * one already played. Absent on a day not reached yet, made ahead by the
   * schedule editor, so it is pinned on its own day's data.
   */
  tenaball: { board: string; sig?: string; frozen?: Board };
  list: { list: string; sig?: string };
  'tic-tac-toe': { rows: string[]; cols: string[] };
}

export interface DailySet {
  /** The day, "YYYY-MM-DD" in Central European time (`day.ts`). */
  day: string;
  /**
   * One per game. A game missing here could not be made that day — the data it
   * needs was absent — and its page says so instead of inventing a puzzle.
   */
  puzzles: Partial<DailyPuzzles>;
}

/** Whether a day served on or after its date still has a board to pin (`freezeDay`). */
export function unfrozen(set: DailySet): boolean {
  return Boolean(set.puzzles.tenaball && !set.puzzles.tenaball.frozen);
}

/**
 * Which puzzle a descriptor is, as text: all of it but what the server adds
 * once the day is under way — the board pinned on the day (`frozen`) and the
 * fingerprint pinning brings up to date (`sig`). A saved round is matched on
 * this, so pinning a day already begun orphans nobody's round.
 */
export function puzzleId(puzzle: unknown): string {
  if (!puzzle || typeof puzzle !== 'object') return JSON.stringify(puzzle ?? null);
  const { frozen: _frozen, sig: _sig, ...rest } = puzzle as Record<string, unknown>;
  return JSON.stringify(rest);
}

/**
 * A puzzle without its pinned board, for moving it to another day in the
 * schedule editor: it is pinned again on the day it lands on.
 */
export function unpinned<P>(puzzle: P): P {
  if (!puzzle || typeof puzzle !== 'object' || !('frozen' in puzzle)) return puzzle;
  const { frozen: _frozen, ...rest } = puzzle as P & { frozen?: unknown };
  return rest as P;
}

/** What a game's daily picker gets to choose with. */
export interface DailyContext {
  day: string;
  /** The seed string for one purpose — for an engine that takes a seed of its own. */
  seed: (purpose: string) => string;
  /** A generator of its own per purpose, so adding a draw in one game moves nothing in another. */
  rng: (purpose: string) => Rng;
  /**
   * The secret player for a one-player game: famous or a regular (`DAILY_MIX`),
   * never one dealt in another game the same day, and not one from the recent
   * past while anyone else is left.
   */
  pickPlayer: (game: DailyGame, pool: readonly RosterPlayer[]) => RosterPlayer | null;
  /**
   * This game's descriptors on the days around this one, nearest first, with how
   * many days away each is — before or after, for a schedule made ahead.
   */
  recent: <G extends DailyGame>(game: G) => { daysAgo: number; puzzle: DailyPuzzles[G] }[];
}

/** How a game's daily round went, kept in the browser for streaks and the home page. */
export interface DailyResult {
  outcome: 'won' | 'lost' | 'gave-up' | 'cleared';
  /** The headline, e.g. "4/6", "7/10", "23 names". */
  score: string;
  /** Played from the archive, after its own day: counts as played, not towards a streak. */
  late?: boolean;
}
