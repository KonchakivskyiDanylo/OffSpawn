import type { Majors } from '@/data/liquipedia/majors';
import type { Board, Rankings } from '@/data/liquipedia/rankings';
import { membersOf } from '@/data/liquipedia/rankings';
import type { Roster } from '@/data/liquipedia/roster';
import { knownPlayers } from '@/daily/fame';
import { answerSig, resting, spaced } from '@/daily/reuse';
import type { Socials } from '@/data/socials';
import { DAILY_SOCIAL, SOCIAL_GROUP, socialBoards } from './social-boards';
import { globalsBoards } from './globals-boards';
import type { DailyContext, DailyPuzzles, DailyResult } from '@/daily/types';
import { pick } from '@/lib/rng';
import { createGame, DAILY_LIVES, HARD_LIVES, namedIn, slotsIn, type Difficulty, type GameState } from './engine';

/** Hard, on `DAILY_LIVES` lives, so the daily ends on its own and the score is how many you found. */
export const DAILY_LEVEL: Difficulty = 'hard';

type Puzzle = DailyPuzzles['tenaball'];

/**
 * The kinds of board a daily can be, by picker group. A kind is drawn first and
 * a board inside it second, so the forty-odd Div Cup and season boards do not
 * crowd out the one career-earnings board.
 *
 * Left out: Div Cup seasons, Performance Evaluations and the smaller regions'
 * FNCS finals (too deep for a puzzle everyone gets), and Paydays (naming a
 * tournament exactly is a spelling test).
 */
const KINDS: { kind: string; groups: RegExp }[] = [
  { kind: 'players', groups: /^Players$/ },
  { kind: 'seasons', groups: /^\d{4} season$/ },
  { kind: 'fncs', groups: /^FNCS all time$/ },
  { kind: 'places', groups: /^By (region|country)$/ },
  { kind: 'teammates', groups: /^Teammates$/ },
  { kind: 'events', groups: /^(Tournaments|FNCS finals — (Europe|North America))$/ },
  { kind: 'orgs', groups: /^(Organisations|Countries)$/ },
  { kind: 'divcups', groups: /^Div Cups — all time$/ },
  // The Globals across the years, built from the majors (`globals-boards.ts`).
  { kind: 'globals', groups: /^Global Championships$/ },
  // Twitch and YouTube, built from the day's counts (`social-boards.ts`).
  { kind: 'followers', groups: /^Followers$/ },
];

/** Rows on a player board that must hold a famous name or a regular. */
const FAMOUS_ROWS = 6;

/**
 * A board with the same top 10 waits `SAME_REST` days, a changed one
 * `CHANGED_REST` (`daily/reuse.ts`); these narrow that window further only if
 * every board ever ran out.
 */
const REST_DAYS = [Infinity, 60, 7];

/** Who is on a board, for telling a changed top 10 from the same one. */
export function boardSig(board: Board): string {
  return answerSig(board.rows.flatMap((row) => membersOf(row).map((member) => member.key)));
}

export function kindOf(board: Board): string | null {
  return KINDS.find((entry) => entry.groups.test(board.group))?.kind ?? null;
}

/** One board split by region or by year: "…average FNCS finish in 2021 — NA East" is "…in #". */
export function familyOf(board: Board): string {
  return board.title.replace(/ — .*$/, '').replace(/\b\d{4}\b/g, '#');
}

/**
 * A board whose slots are duos or trios. Fine for practice; for the daily they
 * double the names a slot needs, and a season's duo board ranks on an average
 * finish nobody holds in their head.
 */
function teamBoard(board: Board): boolean {
  return board.rows.some((row) => membersOf(row).length > 1);
}

/**
 * A board that counts only players Liquipedia lists as active. Liquipedia rarely
 * marks a retirement (the user, 28 Sep 2026), so its answer key can be wrong.
 */
function onStatus(board: Board): boolean {
  return /(^|[-:])active([-:]|$)/.test(board.id);
}

/** Whether the board is about players people know: six of the ten rows hold one (`daily/fame.ts`). */
function famousEnough(board: Board, known: ReadonlySet<string>): boolean {
  if (board.entity !== 'player') return true;
  const rows = board.rows.filter((row) => membersOf(row).some((member) => known.has(member.key)));
  return rows.length >= FAMOUS_ROWS;
}

/**
 * Every board a daily can name: the shipped set, the Globals boards, and the
 * follower boards while there are counts. The schedule editor reads the same list.
 */
export function dailyBoards(rankings: Rankings, roster: Roster, socials: Socials | null, majors: Majors | null): Board[] {
  return [...rankings.boards, ...(majors ? globalsBoards(majors, roster) : []), ...socialBoards(roster, socials)];
}

export function pickDaily(
  roster: Roster,
  rankings: Rankings,
  socials: Socials | null,
  majors: Majors | null,
  ctx: DailyContext,
): Puzzle | null {
  const known = knownPlayers(roster);
  const all = dailyBoards(rankings, roster, socials, majors);
  const byId = new Map(all.map((board) => [board.id, board]));
  // A follower board is famous by what it ranks, so it skips the fame test — but
  // only the big ones: the world, Europe, North America, the FNCS champions.
  const offered = all.filter((board) =>
    board.group === SOCIAL_GROUP
      ? DAILY_SOCIAL(board.id)
      : kindOf(board) !== null && !teamBoard(board) && !onStatus(board) && famousEnough(board, known),
  );
  const rng = ctx.rng('tenaball');
  const sigs = new Map(offered.map((board) => [board.id, boardSig(board)]));
  const uses = ctx.recent('tenaball').map(({ daysAgo, puzzle }) => ({ daysAgo, id: puzzle.board, sig: puzzle.sig }));
  for (const rest of [...REST_DAYS, 0]) {
    const out = resting(uses, (id) => sigs.get(id) ?? null, rest);
    const fresh = offered.filter((board) => !out.has(board.id));
    if (fresh.length === 0) continue;
    const left = spaced(fresh, uses, (id) => byId.get(id), kindOf, familyOf);
    const kinds = [...new Set(left.map(kindOf))];
    const kind = pick(rng, kinds);
    const board = pick(rng, left.filter((candidate) => kindOf(candidate) === kind));
    return { board: board.id, sig: sigs.get(board.id) };
  }
  return null;
}

/**
 * The day's board as it stands now, pinned into its descriptor: the same ten
 * and the same numbers for good, whatever later data updates do to the board
 * of that name (the user, 14 Oct 2026: "the daily challenge has passed and
 * that's it"). The same category can still come back as a new puzzle once its
 * top 10 changes (`reuse.ts`); this only keeps a played day as it was.
 *
 * `asOf` is the data's date — the export's, or the day itself for the
 * follower counts, which the server fetches daily. A board about one event
 * gets none: its results do not move. Null when there is nothing to pin: the
 * board is pinned already, or the data no longer has it.
 */
export function freezeDaily(
  puzzle: Puzzle,
  rankings: Rankings,
  roster: Roster,
  socials: Socials | null,
  majors: Majors | null,
  today: string,
): Puzzle | null {
  if (puzzle.frozen) return null;
  const board = dailyBoards(rankings, roster, socials, majors).find((candidate) => candidate.id === puzzle.board);
  if (!board) return null;
  const asOf = board.id.startsWith('tournament:') ? undefined : board.group === SOCIAL_GROUP ? today : rankings.generated;
  return { ...puzzle, sig: boardSig(board), frozen: asOf ? { ...board, asOf } : board };
}

/** Which names are on the board so far, by rank — `Map`s and `Set`s do not survive JSON. */
export interface Snapshot {
  named: [number, string[]][];
  found: number[];
  wrong: string[];
  lives: number;
  /** Absent from a round saved while the daily had `HARD_LIVES` (before 13 Oct 2026). */
  maxLives?: number;
  status: GameState['status'];
}

export function restoreDaily(
  puzzle: Puzzle,
  rankings: Rankings,
  roster: Roster,
  socials: Socials | null,
  majors: Majors | null,
  saved: Snapshot | null,
): GameState | null {
  // A day pinned on its date plays its own board; one not pinned yet (a dev
  // server, or a day made before 14 Oct 2026 and not served since) today's.
  const board =
    puzzle.frozen ?? dailyBoards(rankings, roster, socials, majors).find((candidate) => candidate.id === puzzle.board);
  if (!board) return null;
  const fresh = createGame(board, DAILY_LEVEL, DAILY_LIVES);
  if (!saved) return fresh;
  // A round begun on the old three lives and still going gets the two new ones;
  // a finished one keeps the hearts it ended on, out of the total it had.
  const was = saved.maxLives ?? HARD_LIVES;
  const playing = saved.status === 'playing';
  return {
    ...fresh,
    named: new Map(saved.named.map(([rank, keys]) => [rank, new Set(keys)])),
    found: new Set(saved.found),
    wrong: saved.wrong,
    lives: playing ? saved.lives + DAILY_LIVES - was : saved.lives,
    maxLives: playing ? DAILY_LIVES : was,
    status: saved.status,
  };
}

export function snapshot(state: GameState): Snapshot {
  return {
    named: [...state.named].map(([rank, keys]) => [rank, [...keys]]),
    found: [...state.found],
    wrong: state.wrong,
    lives: state.lives,
    maxLives: state.maxLives,
    status: state.status,
  };
}

export function result(state: GameState): DailyResult {
  return {
    outcome: state.status === 'won' ? 'won' : state.lives <= 0 ? 'lost' : 'gave-up',
    score: `${state.found.size}/${state.board.rows.length}`,
  };
}

/** The ten slots in rank order, 🟩 named, 🟨 half a team, ⬛ missed; then the lives left. */
export function shareGrid(state: GameState): string[] {
  const squares = slotsIn(state).map((slot) =>
    state.found.has(slot.rank) ? '🟩' : namedIn(state, slot.rank).size > 0 ? '🟨' : '⬛',
  );
  const lives = Math.max(0, Math.min(state.maxLives, state.lives));
  return [
    squares.slice(0, 5).join(''),
    squares.slice(5).join(''),
    '❤️'.repeat(lives) + '🖤'.repeat(state.maxLives - lives),
  ];
}
