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

/**
 * The games with a daily puzzle built. Higher or Lower's was built on 22 Oct
 * 2026 as ten fixed pairs (`higher-lower/daily.ts`), and is not served yet;
 * Contextinho's the same day, served from 26 Oct.
 */
export const DAILY_GAMES = [
  'wordle',
  'career-path',
  'who-are-ya',
  'tenaball',
  'list',
  'tic-tac-toe',
  'higher-lower',
  'contextinho',
] as const;

export type DailyGame = (typeof DAILY_GAMES)[number];

/**
 * The ones served as a daily: made each day, played once a day on the live
 * site, listed under "Today's puzzles". The rest keep their daily code but play
 * unlimited, setup screens and all: Tic Tac Toe (Box Fight), Higher or Lower
 * (the user, 22 Oct 2026: "do it unlimited for now"), and List, which is
 * hidden. Tenite was the only daily from 5 Oct 2026; on 22 Oct the user made
 * Fortnitedle, Career Path and Ready Up dailies again ("every game that is
 * there public except of tic tac toe"), and Contextinho public, a daily from
 * 26 Oct ("add it this game to public also as a daily but daily from 26
 * october only"). Before its first day a game plays unlimited (`isDailyOn`).
 *
 * In the order a day is made. The three secret players are three different
 * people (`DailyContext.taken`); the other games' players do not count.
 */
export const LIVE_DAILY: readonly DailyGame[] = ['tenaball', 'wordle', 'career-path', 'who-are-ya', 'contextinho'];

export const isLiveDaily = (game: string): game is DailyGame => (LIVE_DAILY as readonly string[]).includes(game);

/**
 * Each daily's first day, its puzzle #1. Tenite has run since the dailies
 * began; the four that joined on 22 Oct 2026 start on Monday 19 Oct, so they
 * have an archive from their first day too (the user: "from this monday so from
 * 19th october"). A day before a game's start has no puzzle for it; the server
 * fills in the days from it to today the first time each is asked for
 * (`dailySet` in `server/index.ts`). A game added to `LIVE_DAILY` later wants
 * its own first day here, or the server fills its archive in from this one.
 */
export const DAILY_FROM: Readonly<Record<DailyGame, string>> = {
  tenaball: '2026-10-05',
  wordle: '2026-10-19',
  'career-path': '2026-10-19',
  'who-are-ya': '2026-10-19',
  'higher-lower': '2026-10-19',
  contextinho: '2026-10-26',
  list: '2026-10-05',
  'tic-tac-toe': '2026-10-05',
};

/** The live dailies with a puzzle on `day`: those that had started by then. */
export function gamesOn(day: string): DailyGame[] {
  return LIVE_DAILY.filter((game) => DAILY_FROM[game] <= day);
}

/**
 * Whether `game` plays its daily on `day`: served, and started. Before its
 * first day a game in `LIVE_DAILY` plays unlimited, setup and all.
 */
export function isDailyOn(game: string, day: string): game is DailyGame {
  return isLiveDaily(game) && DAILY_FROM[game] <= day;
}

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
  /**
   * Ten pairs in one category: `players` in the order they come, the first one
   * shown and each of the rest the next challenger. `frozen` is each player's
   * number in the category, pinned on the day like Tenite's board, so a data
   * update cannot turn round a pair already played.
   */
  'higher-lower': { category: DailyCategory; players: string[]; frozen?: number[] };
  /** The secret player; the ranking is worked out in the browser, on the default weights. */
  contextinho: { secret: string };
}

/** Higher or Lower's daily categories: the three the game offers. */
export type DailyCategory = 'age' | 'earnings' | 'fncsWins';

export interface DailySet {
  /** The day, "YYYY-MM-DD" in Central European time (`day.ts`). */
  day: string;
  /**
   * One per game. A game missing here could not be made that day — the data it
   * needs was absent — and its page says so instead of inventing a puzzle.
   */
  puzzles: Partial<DailyPuzzles>;
}

/** Whether a day served on or after its date still has a puzzle to pin (`freezeDay`). */
export function unfrozen(set: DailySet): boolean {
  const { tenaball, 'higher-lower': pairs } = set.puzzles;
  return Boolean((tenaball && !tenaball.frozen) || (pairs && !pairs.frozen));
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
   * The players already the answer in another one-player game that day:
   * Fortnitedle, Career Path, Ready Up. Tenite's names and anything else do not
   * count (the user, 22 Oct 2026: "Only solo player games count").
   */
  taken: ReadonlySet<string>;
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
