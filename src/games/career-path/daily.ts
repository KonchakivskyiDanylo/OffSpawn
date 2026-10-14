import type { Majors } from '@/data/liquipedia/majors';
import type { Roster, RosterPlayer } from '@/data/liquipedia/roster';
import { reviveClues, type ClueSnapshot } from '@/daily/clue-round';
import type { DailyContext, DailyPuzzles } from '@/daily/types';
import { levelPlayers } from '@/games/shared/levels';
import { createGame, roundOf, type GameState, type Mode } from './engine';

/**
 * The daily builds up, best results last, the way the game opens by default
 * since 14 Oct 2026 (oldest first before; no Career Path daily was served in
 * between, so no kept day changes its label).
 */
export const DAILY_MODE: Mode = 'random';

type Puzzle = DailyPuzzles['career-path'];

export function pickDaily(roster: Roster, majors: Majors, ctx: DailyContext): Puzzle | null {
  const secret = ctx.pickPlayer('career-path', dailyPool(roster, majors));
  return secret ? puzzleFor(secret, majors, ctx.seed('career-path')) : null;
}

/** Who the daily may be about — also what the schedule editor offers. */
export function dailyPool(roster: Roster, majors: Majors): RosterPlayer[] {
  return levelPlayers(roster, 'medium', majors.eligible);
}

/** The puzzle on a secret already chosen: its ten clues, drawn and ordered. */
export function puzzleFor(secret: RosterPlayer, majors: Majors, seed: string): Puzzle | null {
  const round = createGame(secret, majors.resultsFor(secret.id), DAILY_MODE, majors, seed);
  return round ? { secret: secret.id, clues: round.clues.map((clue) => clue.result.tournament.name) } : null;
}

/**
 * The round from the descriptor's own clues, so a later change to how clues
 * are chosen cannot change a day that has already been played. Null when the
 * data no longer has one of them.
 */
export function restoreDaily(
  puzzle: Puzzle,
  majors: Majors,
  byId: ReadonlyMap<string, RosterPlayer>,
  saved: ClueSnapshot | null,
): GameState | null {
  const secret = byId.get(puzzle.secret);
  if (!secret) return null;
  const results = new Map(majors.resultsFor(secret.id).map((result) => [result.tournament.name, result]));
  const clues = puzzle.clues.map((name) => results.get(name));
  if (clues.length === 0 || clues.some((clue) => !clue)) return null;
  const fresh = roundOf(secret, clues as NonNullable<(typeof clues)[number]>[], DAILY_MODE);
  return saved ? (reviveClues(fresh, saved, byId) ?? fresh) : fresh;
}
