import type { Board } from '@/data/liquipedia/rankings';
import type { RosterPlayer } from '@/data/liquipedia/roster';
import { puzzleFor as careerPuzzle, dailyPool as careerPool } from '@/games/career-path/daily';
import { DAILY_CATEGORIES, pickDaily as pairsFor } from '@/games/higher-lower/daily';
import { CATEGORIES } from '@/games/higher-lower/engine';
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
import { dailyContext, pickPuzzle, playersIn, SECRET_GAMES, servedIn, takenOn, type DailyData } from './generate';
import {
  DAILY_FROM,
  LIVE_DAILY,
  puzzleId,
  type DailyCategory,
  type DailyGame,
  type DailyPuzzles,
  type DailySet,
} from './types';

/**
 * The daily schedule editor's half on the server: what each day's puzzle is
 * called, what a game's puzzle may be swapped for, and making one.
 *
 * Behind `/analytics/daily` (the user, 3 Oct 2026: "Add to analytics a
 * possibility to change daily modes… for example Tenaball, I can change the
 * order in which it goes"). Today and the days after it can change, and the
 * earlier days of the games in `PAST_EDITABLE`.
 */

/**
 * The games whose earlier days may still be changed: the one-player games
 * (the user, 22 Oct 2026: "I want to change previous challenges for the solo
 * modes (tenite doesn't touch, I will tell you and you will block this
 * possibility)"). Empty it to lock every day before today again.
 */
export const PAST_EDITABLE: readonly DailyGame[] = SECRET_GAMES;

/** A choice for a day: a player, a board, a list, a category. */
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
  /**
   * Why it cannot go on the day being edited: the player is already the answer
   * in another one-player game that day ("Chubs is the Career Path answer").
   */
  clash?: string;
  /** A player's region, country and career earnings, for the chooser's filters and sorting. */
  player?: { region: string | null; country: string | null; earnings: number };
  /**
   * The days this player is a one-player answer within `REPEAT_WINDOW` days of
   * the day being edited, nearest first, and in which game.
   */
  answered?: { day: string; game: string }[];
}

export interface Described {
  label: string;
  /** A second line: the board's group, a player's band, the grid's columns, the pairs. */
  detail?: string;
}

/** How near the same puzzle may come round before the editor flags it. */
export const REPEAT_WINDOW = 30;

/** The games as players know them, for the editor's messages. */
const NAME: Record<DailyGame, string> = {
  wordle: 'Fortnitedle',
  'career-path': 'Career Path',
  'who-are-ya': 'Ready Up',
  tenaball: 'Tenite',
  list: 'List',
  'tic-tac-toe': 'Box Fight',
  'higher-lower': 'Higher or Lower',
};

const CATEGORY_LABEL = (category: string) => CATEGORIES.find((item) => item.id === category)?.label ?? category;

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
  const name = (id: string) => byId.get(id)?.name ?? id;
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
  if ('category' in puzzle) {
    return {
      label: `${CATEGORY_LABEL(puzzle.category)} · ${puzzle.players.length - 1} pairs`,
      detail: puzzle.players.map(name).join(' → '),
    };
  }
  if (game !== 'tic-tac-toe' || !('rows' in puzzle)) return { label: JSON.stringify(puzzle) };
  const rule = (id: string) => rules.get(id) ?? id;
  return { label: puzzle.rows.map(rule).join(' · '), detail: `× ${puzzle.cols.map(rule).join(' · ')}` };
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

/**
 * Whether `game`'s puzzle on `set` may still change: from the game's first
 * day, today and after — and before today for the `PAST_EDITABLE` games.
 */
export function canEdit(set: DailySet, game: DailyGame, firstEditable: string): boolean {
  return DAILY_FROM[game] <= set.day && (set.day >= firstEditable || PAST_EDITABLE.includes(game));
}

/**
 * The other one-player games that day whose answer is also `game`'s: the
 * clashes "nobody in two games on one day" rules out.
 */
export function clashesOn(set: DailySet, game: DailyGame): { id: string; game: DailyGame }[] {
  const mine = new Set(playersIn(game, set.puzzles[game]));
  if (mine.size === 0) return [];
  return servedIn(set)
    .filter((other) => other !== game)
    .flatMap((other) => playersIn(other, set.puzzles[other]).filter((id) => mine.has(id)).map((id) => ({ id, game: other })));
}

/** "Chubs is the Career Path answer that day". */
function clashText(clash: { id: string; game: DailyGame }, data: DailyData): string {
  return `${lookup(data).byId.get(clash.id)?.name ?? clash.id} is the ${NAME[clash.game]} answer that day`;
}

/**
 * Each player's days as a one-player answer, within `REPEAT_WINDOW` days of
 * `around`, nearest first: what the chooser shows beside a player, so one
 * used last week is not picked again by accident.
 */
function answersAround(sets: readonly DailySet[], around: string): Map<string, { day: string; game: string }[]> {
  const out = new Map<string, { day: string; game: string }[]>();
  const near = sets
    .filter((set) => set.day !== around && Math.abs(daysBetween(set.day, around)) <= REPEAT_WINDOW)
    .sort((a, b) => Math.abs(daysBetween(a.day, around)) - Math.abs(daysBetween(b.day, around)));
  for (const set of near) {
    for (const game of servedIn(set)) {
      for (const id of playersIn(game, set.puzzles[game])) out.set(id, [...(out.get(id) ?? []), { day: set.day, game: NAME[game] }]);
    }
  }
  return out;
}

/**
 * What a game's puzzle may be set to by hand. Tic Tac Toe has no list: its six
 * rules are drawn together. A player carries their region, country and
 * earnings for the chooser's filters, the days around `day` they are already
 * an answer, and — with `day` — whether they are another one-player game's
 * answer that very day.
 */
export function optionsFor(
  game: DailyGame,
  data: DailyData,
  sets: readonly DailySet[] = [],
  firstEditable = '',
  day?: DailySet,
): Option[] {
  const { roster, majors, teammates, facts } = data;
  const { byId, boards, lists } = lookup(data);
  // The day's other one-player answers: the reason a player cannot go there.
  const elsewhere = new Map<string, DailyGame>();
  if (day) {
    for (const other of servedIn(day)) {
      if (other === game) continue;
      for (const id of playersIn(other, day.puzzles[other])) elsewhere.set(id, other);
    }
  }
  const answered = answersAround(sets, day?.day ?? firstEditable);
  const players = (pool: readonly RosterPlayer[]): Option[] =>
    [...pool]
      .sort((a, b) => b.earnings - a.earnings)
      .map((player) => ({
        id: player.id,
        label: player.name,
        group: TIER[player.tier],
        clash: elsewhere.has(player.id) ? clashText({ id: player.id, game: elsewhere.get(player.id)! }, data) : undefined,
        player: { region: player.region, country: player.countryName ?? null, earnings: player.earnings },
        answered: answered.get(player.id),
      }));
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
    case 'higher-lower':
      // A category: its ten pairs are drawn for it.
      return DAILY_CATEGORIES.map((category) => ({ id: category, label: CATEGORY_LABEL(category), group: 'ten new pairs' }));
    default:
      return [];
  }
}

/**
 * The puzzle for a choice from `optionsFor`, or null when it cannot make one.
 * Higher or Lower's pairs are drawn for the category chosen, clear of the
 * pairs on the days around it.
 */
export function puzzleForChoice(
  game: DailyGame,
  id: string,
  set: DailySet,
  others: readonly DailySet[],
  data: DailyData,
): DailyPuzzles[DailyGame] | null {
  const { byId, boards, lists } = lookup(data);
  const seed = `daily:${set.day}:chosen:${game}`;
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
    case 'higher-lower': {
      if (!DAILY_CATEGORIES.includes(id as DailyCategory)) return null;
      const ctx = dailyContext(set.day, data, others, takenOn(set, game), `:chosen:${Date.now().toString(36)}`);
      return pairsFor(data.roster, ctx, id as DailyCategory);
    }
    default:
      return null;
  }
}

/**
 * A new draw of one game for one day, steering clear of every other day in
 * the schedule and of the day's other one-player answers — and of what it was.
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
    const taken = takenOn(set, game);
    // A secret player drawn again is someone else.
    for (const id of playersIn(game, set.puzzles[game])) taken.add(id);
    const salt = `:redraw:${Date.now().toString(36)}:${attempt}`;
    const puzzle = pickPuzzle(game, data, dailyContext(set.day, data, [set, ...others], taken, salt));
    if (puzzle && puzzleId(puzzle) !== was) return puzzle;
  }
  return null;
}

/**
 * `set` with `puzzle` as `game`'s, or the reason it cannot be: its answer is
 * already another one-player game's answer that day.
 */
export function settle(
  game: DailyGame,
  puzzle: DailyPuzzles[DailyGame],
  set: DailySet,
  data: DailyData,
): { set: DailySet } | { error: string } {
  const next: DailySet = { ...set, puzzles: { ...set.puzzles, [game]: puzzle } };
  const clash = clashesOn(next, game)[0];
  return clash ? { error: `${clashText(clash, data)}.` } : { set: next };
}

/**
 * What `puzzle` repeats or shares: the same secret, board or list within
 * `REPEAT_WINDOW` days, or a secret who is the answer in another game that day.
 */
export function warningFor(game: DailyGame, set: DailySet, all: readonly DailySet[], data: DailyData): string | null {
  const puzzle = set.puzzles[game];
  if (!puzzle || game === 'tic-tac-toe') return null;
  const key = (p: unknown) => {
    const value = p as { secret?: string; board?: string; list?: string } | undefined;
    return value?.secret ?? value?.board ?? value?.list ?? null;
  };
  const mine = key(puzzle);
  const out: string[] = clashesOn(set, game).map((clash) => clashText(clash, data));
  if (game === 'tenaball' || game === 'list') {
    // A board or a list is a repeat on any day while its answers are the same people.
    const now = sigOf(game, mine ?? '', data);
    const same = usesOf(game, mine ?? '', all.filter((other) => other.day !== set.day), now, set.day).filter(
      (use) => !use.changed && !use.rested,
    );
    if (same.length) out.push(`also on ${same.map((use) => use.day).join(', ')}, with the same answers`);
  } else if (SECRET_GAMES.includes(game)) {
    const near = all
      .filter((other) => other.day !== set.day && Math.abs(daysBetween(other.day, set.day)) <= REPEAT_WINDOW)
      .filter((other) => servedIn(other).some((g) => SECRET_GAMES.includes(g) && key(other.puzzles[g]) === mine))
      .map((other) => other.day);
    if (near.length) out.push(`also on ${near.join(', ')}`);
  }
  if (!out.length) return null;
  return `${describe(game, puzzle, data).label}: ${out.join('; ')}`;
}

/**
 * The schedule's rows. A day before a game's first shows nothing for it: a
 * puzzle kept there from an earlier schedule was never served.
 */
export function rowsFor(sets: readonly DailySet[], all: readonly DailySet[], data: DailyData, firstEditable: string) {
  return sets.map((set) => ({
    day: set.day,
    puzzles: Object.fromEntries(
      LIVE_DAILY.map((game) => [
        game,
        DAILY_FROM[game] <= set.day
          ? { ...describe(game, set.puzzles[game], data), warning: warningFor(game, set, all, data) }
          : { label: '—', warning: null },
      ]),
    ),
    editable: Object.fromEntries(LIVE_DAILY.map((game) => [game, canEdit(set, game, firstEditable)])),
  }));
}
