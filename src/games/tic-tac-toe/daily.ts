import type { Facts } from '@/data/liquipedia/facts';
import type { Orgs } from '@/data/liquipedia/orgs';
import type { Roster, RosterPlayer } from '@/data/liquipedia/roster';
import type { Socials } from '@/data/socials';
import type { DailyContext, DailyPuzzles, DailyResult } from '@/daily/types';
import { boardFrom, cellKey, createGame, generateBoard, LEVELS, livesLeft, SIZE, type BoardPools, type Difficulty, type GameState } from './engine';

/** Two regulars in every cell, three lives — the middle of the three levels. */
export const DAILY_LEVEL: Difficulty = 'medium';

/** The rules of the last week's grids are kept out of today's. */
const RECENT_DAYS = 7;

type Puzzle = DailyPuzzles['tic-tac-toe'];

/** What the medium board is built around and what the guess box takes — as in the game. */
export function dailyPools(roster: Roster, facts: Facts): BoardPools {
  const eligible = facts.eligible(3);
  return {
    answers: (['easy', 'medium'] as const).flatMap((band) => roster.exactly(band, { eligible })),
    accepted: roster.players,
  };
}

/**
 * `socials` are the follower counts the server has fresh: with them, a grid may
 * carry a "100K+ Twitch followers" rule, and the browser rebuilds it from the
 * same counts (the day's set and the counts come from the same server).
 */
export function pickDaily(roster: Roster, facts: Facts, orgs: Orgs, socials: Socials | null, ctx: DailyContext): Puzzle | null {
  const recent = ctx
    .recent('tic-tac-toe')
    .filter((entry) => entry.daysAgo <= RECENT_DAYS)
    .flatMap((entry) => [...entry.puzzle.rows, ...entry.puzzle.cols]);
  const board = generateBoard({ facts, orgs, socials }, dailyPools(roster, facts), DAILY_LEVEL, ctx.seed('tic-tac-toe'), recent);
  return board ? { rows: board.rows.map((rule) => rule.id), cols: board.cols.map((rule) => rule.id) } : null;
}

export interface Snapshot {
  filled: [string, string][];
  mistakes: number;
  guesses: number;
  status: GameState['status'];
}

export function restoreDaily(
  puzzle: Puzzle,
  roster: Roster,
  facts: Facts,
  orgs: Orgs,
  socials: Socials | null,
  byId: ReadonlyMap<string, RosterPlayer>,
  saved: Snapshot | null,
): GameState | null {
  const board = boardFrom({ facts, orgs, socials }, dailyPools(roster, facts), puzzle.rows, puzzle.cols, DAILY_LEVEL);
  if (!board) return null;
  const fresh = createGame(board, DAILY_LEVEL);
  if (!saved) return fresh;
  const filled = new Map<string, RosterPlayer>();
  for (const [cell, id] of saved.filled) {
    const player = byId.get(id);
    if (player) filled.set(cell, player);
  }
  return { ...fresh, filled, mistakes: saved.mistakes, guesses: saved.guesses, status: saved.status };
}

export function snapshot(state: GameState): Snapshot {
  return {
    filled: [...state.filled].map(([cell, player]) => [cell, player.id]),
    mistakes: state.mistakes,
    guesses: state.guesses,
    status: state.status,
  };
}

export function result(state: GameState): DailyResult {
  return {
    outcome: state.status === 'won' ? 'won' : livesLeft(state) <= 0 ? 'lost' : 'gave-up',
    score: `${state.filled.size}/${SIZE * SIZE}`,
  };
}

/** The grid as it ended, 🟩 filled and ⬛ empty, then the lives left. */
export function shareGrid(state: GameState): string[] {
  const rows = Array.from({ length: SIZE }, (_, row) =>
    Array.from({ length: SIZE }, (_, col) => (state.filled.has(cellKey(row, col)) ? '🟩' : '⬛')).join(''),
  );
  const lives = LEVELS[state.difficulty].lives;
  const left = Math.max(0, livesLeft(state));
  return [...rows, '❤️'.repeat(left) + '🖤'.repeat(lives - left)];
}
