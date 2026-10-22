import type { Facts } from '@/data/liquipedia/facts';
import type { Majors } from '@/data/liquipedia/majors';
import type { Roster, RosterPlayer } from '@/data/liquipedia/roster';
import type { Teammates } from '@/data/liquipedia/teammates';
import type { DailyContext, DailyPuzzles, DailyResult } from '@/daily/types';
import { levelPlayers } from '@/games/shared/levels';
import { bandOf, eligible, type GameState, type Scored } from './engine';

/**
 * Contextinho's daily (from 26 Oct 2026, the user: "add it this game to public
 * also as a daily but daily from 26 october only"): one secret player for
 * everyone, ranked on the default weights. Guesses are unlimited; the score is
 * how many it took, hints included, since a hint is a guess the game made.
 */

type Puzzle = DailyPuzzles['contextinho'];

/**
 * Majors and early majors a daily secret has between them, at least: a career
 * thin on record ranks strangers near the top, which is no puzzle for anyone.
 */
export const DAILY_MIN_EVENTS = 5;

/** Who the daily may be about — also what the schedule editor offers. */
export function dailyPool(roster: Roster, teammates: Teammates, majors: Majors, facts: Facts): RosterPlayer[] {
  return levelPlayers(roster, 'medium', eligible(teammates)).filter(
    (player) => majors.resultsFor(player.id).length + facts.earlyResultsFor(player.id).length >= DAILY_MIN_EVENTS,
  );
}

export function pickDaily(
  roster: Roster,
  teammates: Teammates,
  majors: Majors,
  facts: Facts,
  ctx: DailyContext,
): Puzzle | null {
  const secret = ctx.pickPlayer('contextinho', dailyPool(roster, teammates, majors, facts));
  return secret ? { secret: secret.id } : null;
}

/** The guesses as ids, and whether a hint gave each — players by id so it fits in local storage. */
export interface Snapshot {
  guesses: [id: string, hint: boolean][];
  status: GameState['status'];
}

export function restoreDaily(
  puzzle: Puzzle,
  byId: ReadonlyMap<string, RosterPlayer>,
  saved: Snapshot | null,
): GameState | null {
  const secret = byId.get(puzzle.secret);
  if (!secret) return null;
  const guesses = (saved?.guesses ?? []).flatMap(([id, hint]) => {
    const player = byId.get(id);
    return player ? [{ player, hint }] : [];
  });
  return {
    secret,
    guesses,
    status: saved?.status ?? 'playing',
    hints: guesses.filter((guess) => guess.hint).length,
  };
}

export function snapshot(state: GameState): Snapshot {
  return { guesses: state.guesses.map((guess) => [guess.player.id, guess.hint]), status: state.status };
}

export function result(state: GameState): DailyResult {
  const won = state.status === 'won';
  const n = state.guesses.length;
  return {
    outcome: won ? 'won' : 'gave-up',
    score: won ? `${n} ${n === 1 ? 'guess' : 'guesses'}${state.hints ? ` · ${state.hints} 💡` : ''}` : 'X',
  };
}

const BAND_SQUARE = { hot: '🟩', warm: '🟨', cool: '🟧', cold: '🟥' } as const;

/**
 * The guesses as squares by how close each was, ten to a row, in the order
 * made — 🟩 the top 25, 🟨 to 150, 🟧 to 750, 🟥 further — then the count of
 * each. A long hunt is cut at three rows, with how many more there were.
 */
export function shareGrid(state: GameState, ranking: ReadonlyMap<string, Scored>): string[] {
  const bands = state.guesses.map((guess) => {
    const rank = ranking.get(guess.player.id)?.rank ?? Infinity;
    return rank === 1 ? '🎯' : BAND_SQUARE[bandOf(rank)];
  });
  const rows: string[] = [];
  for (let i = 0; i < Math.min(bands.length, 30); i += 10) rows.push(bands.slice(i, i + 10).join(''));
  if (bands.length > 30) rows.push(`+${bands.length - 30} more`);
  return rows;
}
