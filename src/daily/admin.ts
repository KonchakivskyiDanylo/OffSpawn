import type { Board } from '@/data/liquipedia/rankings';
import type { RosterPlayer } from '@/data/liquipedia/roster';
import { puzzleFor as careerPuzzle, dailyPool as careerPool } from '@/games/career-path/daily';
import { buildCriteria, type Criterion } from '@/games/list/criteria';
import { listSig } from '@/games/list/daily';
import { levelPlayers } from '@/games/shared/levels';
import { boardSig, dailyBoards } from '@/games/tenaball/daily';
import { boardRules } from '@/games/tic-tac-toe/engine';
import { dailyPools } from '@/games/tic-tac-toe/daily';
import { puzzleFor as whoPuzzle, dailyPool as whoPool } from '@/games/who-are-ya/daily';
import { eligible as wordleEligible } from '@/games/wordle/engine';
import { daysBetween } from './day';
import { SAME_REST } from './reuse';
import { dailyContext, pickPuzzle, type DailyData } from './generate';
import { LIVE_DAILY, puzzleId, type DailyGame, type DailyPuzzles, type DailySet } from './types';

/**
 * The daily schedule editor's half on the server: what each day's puzzle is
 * called, what a game's puzzle may be swapped for, and making one.
 *
 * Behind `/analytics/daily` (the user, 3 Oct 2026: "Add to analytics a
 * possibility to change daily modes… for example Tenaball, I can change the
 * order in which it goes"). Only today and the days after it can change.
 */

/** A choice for a day: a player, a board, a list. */
export interface Option {
  id: string;
  label: string;
  group?: string;
  /**
   * The days a board or a list is already on, and whether its answers have
   * changed since each — a changed one may be chosen again (`daily/reuse.ts`).
   * `past` is a day already played; a coming day's board can be moved instead.
   */
  used?: { day: string; changed: boolean; past: boolean }[];
}

export interface Described {
  label: string;
  /** A second line: the board's group, a player's band, the grid's columns. */
  detail?: string;
}

/** How near the same puzzle may come round before the editor flags it. */
export const REPEAT_WINDOW = 30;

const SECRET_GAMES: DailyGame[] = ['wordle', 'career-path', 'who-are-ya'];

/**
 * The things the labels and the options are read from, built once per data
 * object — the server makes one per request.
 */
const lookups = new WeakMap<
  DailyData,
  {
    byId: Map<string, RosterPlayer>;
    boards: Map<string, Board>;
    lists: Map<string, Criterion>;
    rules: Map<string, string>;
  }
>();

function lookup(data: DailyData) {
  let found = lookups.get(data);
  if (!found) {
    const { roster, rankings, facts, orgs, teammates, majors } = data;
    const socials = data.socials ?? null;
    found = {
      byId: new Map(roster.players.map((player) => [player.id, player])),
      boards: new Map(dailyBoards(rankings, roster, socials, majors, facts).map((board) => [board.id, board])),
      lists: new Map(buildCriteria(roster, facts, null, orgs, teammates, socials).map((list) => [list.id, list])),
      rules: new Map(
        boardRules({ facts, orgs, socials }, dailyPools(roster, facts), 'medium').map((rule) => [rule.id, rule.short]),
      ),
    };
    lookups.set(data, found);
  }
  return found;
}

const TIER: Record<string, string> = { easy: 'famous', medium: 'regular', hard: 'deep cut' };

export function describe(game: DailyGame, puzzle: DailyPuzzles[DailyGame] | undefined, data: DailyData): Described {
  if (!puzzle) return { label: '—' };
  const { byId, boards, lists, rules } = lookup(data);
  if ('secret' in puzzle) {
    const player = byId.get(puzzle.secret);
    return { label: player?.name ?? puzzle.secret, detail: player ? TIER[player.tier] : 'no longer on the roster' };
  }
  if ('board' in puzzle) {
    const board = boards.get(puzzle.board);
    return { label: board?.title ?? puzzle.board, detail: board?.group ?? 'board not found' };
  }
  if ('list' in puzzle) {
    const list = lists.get(puzzle.list);
    return { label: list?.title ?? puzzle.list, detail: list ? `${list.answers.length} answers` : 'list not found' };
  }
  if (game !== 'tic-tac-toe' || !('rows' in puzzle)) return { label: JSON.stringify(puzzle) };
  const name = (id: string) => rules.get(id) ?? id;
  return { label: puzzle.rows.map(name).join(' · '), detail: `× ${puzzle.cols.map(name).join(' · ')}` };
}

/**
 * The days `id` is on in `sets`, whether its answers have changed since, and
 * whether that day is more than `SAME_REST` days from `from` — far enough to
 * come back as it is.
 */
function usesOf(game: 'tenaball' | 'list', id: string, sets: readonly DailySet[], now: string | null, from: string) {
  return sets
    .filter((set) => {
      const puzzle = set.puzzles[game] as { board?: string; list?: string } | undefined;
      return (puzzle?.board ?? puzzle?.list) === id;
    })
    .map((set) => {
      const sig = (set.puzzles[game] as { sig?: string }).sig;
      return {
        day: set.day,
        changed: Boolean(sig && now && sig !== now),
        rested: Math.abs(daysBetween(set.day, from)) > SAME_REST,
      };
    });
}

/**
 * Where a board or a list already is, with the same answers, for choosing it
 * for another day: `past` days block the choice — that puzzle was played —
 * and `coming` days are where it moves from (`server/index.ts` swaps them).
 */
export function sameElsewhere(
  game: DailyGame,
  id: string,
  others: readonly DailySet[],
  data: DailyData,
  firstEditable: string,
): { past: string[]; coming: string[] } {
  if (game !== 'tenaball' && game !== 'list') return { past: [], coming: [] };
  const same = usesOf(game, id, others, sigOf(game, id, data), firstEditable).filter((use) => !use.changed && !use.rested);
  return {
    past: same.filter((use) => use.day < firstEditable).map((use) => use.day),
    coming: same.filter((use) => use.day >= firstEditable).map((use) => use.day),
  };
}

function sigOf(game: 'tenaball' | 'list', id: string, data: DailyData): string | null {
  const { boards, lists } = lookup(data);
  if (game === 'tenaball') {
    const board = boards.get(id);
    return board ? boardSig(board) : null;
  }
  const list = lists.get(id);
  return list ? listSig(list) : null;
}

/** What a game's puzzle may be set to by hand. Tic Tac Toe has no list: its six rules are drawn together. */
export function optionsFor(
  game: DailyGame,
  data: DailyData,
  sets: readonly DailySet[] = [],
  firstEditable = '',
): Option[] {
  const { roster, majors, teammates, facts } = data;
  const { byId, boards, lists } = lookup(data);
  const players = (pool: readonly RosterPlayer[]): Option[] =>
    [...pool]
      .sort((a, b) => b.earnings - a.earnings)
      .map((player) => ({ id: player.id, label: player.name, group: TIER[player.tier] }));
  switch (game) {
    case 'wordle':
      return players(levelPlayers(roster, 'medium', wordleEligible));
    case 'career-path':
      return players(careerPool(roster, majors));
    case 'who-are-ya':
      return players(whoPool(roster, teammates, facts, byId));
    case 'tenaball':
      return [...boards.values()].map((board) => ({
        id: board.id,
        label: board.title,
        group: board.group,
        used: usesOf('tenaball', board.id, sets, boardSig(board), firstEditable).map((use) => ({ ...use, past: use.day < firstEditable })),
      }));
    case 'list':
      return [...lists.values()].map((list) => ({
        id: list.id,
        label: list.title,
        group: `${list.answers.length} answers`,
        used: usesOf('list', list.id, sets, listSig(list), firstEditable).map((use) => ({ ...use, past: use.day < firstEditable })),
      }));
    default:
      return [];
  }
}

/** The puzzle for a choice from `optionsFor`, or null when it cannot make one. */
export function puzzleForChoice(game: DailyGame, id: string, day: string, data: DailyData): DailyPuzzles[DailyGame] | null {
  const { byId, boards, lists } = lookup(data);
  const seed = `daily:${day}:chosen:${game}`;
  switch (game) {
    case 'wordle': {
      const player = byId.get(id);
      return player && wordleEligible([player]).length ? { secret: id } : null;
    }
    case 'career-path': {
      const player = byId.get(id);
      return player ? careerPuzzle(player, data.majors, seed) : null;
    }
    case 'who-are-ya': {
      const player = byId.get(id);
      return player ? whoPuzzle(player, data.teammates, byId, seed) : null;
    }
    case 'tenaball': {
      const board = boards.get(id);
      return board ? { board: id, sig: boardSig(board) } : null;
    }
    case 'list': {
      const list = lists.get(id);
      return list ? { list: id, sig: listSig(list) } : null;
    }
    default:
      return null;
  }
}

/**
 * A new draw of one game for one day, steering clear of every other day in
 * the schedule and of the day's other secret players — and of what it was.
 */
export function redraw(
  game: DailyGame,
  set: DailySet,
  others: readonly DailySet[],
  data: DailyData,
): DailyPuzzles[DailyGame] | null {
  // Today's may be pinned; the same board drawn again is still the same puzzle.
  const was = puzzleId(set.puzzles[game]);
  for (let attempt = 0; attempt < 6; attempt++) {
    const taken = new Set(
      SECRET_GAMES.filter((other) => other !== game).flatMap((other) => {
        const puzzle = set.puzzles[other] as { secret?: string } | undefined;
        return puzzle?.secret ? [puzzle.secret] : [];
      }),
    );
    if (SECRET_GAMES.includes(game)) {
      const current = set.puzzles[game] as { secret?: string } | undefined;
      if (current?.secret) taken.add(current.secret);
    }
    const salt = `:redraw:${Date.now().toString(36)}:${attempt}`;
    const puzzle = pickPuzzle(game, data, dailyContext(set.day, data, [set, ...others], taken, salt));
    if (puzzle && puzzleId(puzzle) !== was) return puzzle;
  }
  return null;
}

/** What `puzzle` repeats: the same secret, board or list within `REPEAT_WINDOW` days, or a secret twice in one day. */
export function warningFor(game: DailyGame, set: DailySet, all: readonly DailySet[], data: DailyData): string | null {
  const puzzle = set.puzzles[game];
  if (!puzzle || game === 'tic-tac-toe') return null;
  const key = (p: unknown) => {
    const value = p as { secret?: string; board?: string; list?: string } | undefined;
    return value?.secret ?? value?.board ?? value?.list ?? null;
  };
  const mine = key(puzzle);
  const out: string[] = [];
  if (SECRET_GAMES.includes(game)) {
    const twin = SECRET_GAMES.find((other) => other !== game && key(set.puzzles[other]) === mine);
    if (twin) out.push(`also the answer in ${twin} that day`);
  }
  if (game === 'tenaball' || game === 'list') {
    // A board or a list is a repeat on any day while its answers are the same people.
    const now = sigOf(game, mine ?? '', data);
    const same = usesOf(game, mine ?? '', all.filter((other) => other.day !== set.day), now, set.day).filter(
      (use) => !use.changed && !use.rested,
    );
    if (same.length) out.push(`also on ${same.map((use) => use.day).join(', ')}, with the same answers`);
  } else {
    const near = all
      .filter((other) => other.day !== set.day && Math.abs(daysBetween(other.day, set.day)) <= REPEAT_WINDOW)
      .filter((other) => SECRET_GAMES.some((g) => key(other.puzzles[g]) === mine))
      .map((other) => other.day);
    if (near.length) out.push(`also on ${near.join(', ')}`);
  }
  if (!out.length) return null;
  return `${describe(game, puzzle, data).label}: ${out.join('; ')}`;
}

export function rowsFor(sets: readonly DailySet[], all: readonly DailySet[], data: DailyData) {
  return sets.map((set) => ({
    day: set.day,
    puzzles: Object.fromEntries(
      LIVE_DAILY.map((game) => [
        game,
        { ...describe(game, set.puzzles[game], data), warning: warningFor(game, set, all, data) },
      ]),
    ),
  }));
}
