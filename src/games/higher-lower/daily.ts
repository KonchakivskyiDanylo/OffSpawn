import { ref, type GamePayloads, type Outcome } from '@/analytics/types';
import type { Roster, RosterPlayer } from '@/data/liquipedia/roster';
import { knownPlayers } from '@/daily/fame';
import type { DailyCategory, DailyContext, DailyPuzzles, DailyResult } from '@/daily/types';
import { pick } from '@/lib/rng';
import { dealChain, hasEqualButton, valueOf, type Answer, type Contender, type Difficulty } from './engine';

/**
 * Higher or Lower's daily puzzle (22 Oct 2026): ten pairs, the same for
 * everyone, in one category.
 *
 * Every pair is played. A wrong answer is marked and the next pair comes, so
 * the score is how many of the ten were right. The endless run stops at the
 * first mistake, which suits a run you can start again; on the one puzzle of
 * the day, a coin toss on pair two would end it in five seconds.
 */
export const DAILY_ROUNDS = 10;

/** The categories the game offers, taken in turn: never the same two days running. */
export const DAILY_CATEGORIES: readonly DailyCategory[] = ['earnings', 'age', 'fncsWins'];

/**
 * Hard's schedule — four obvious pairs, four moderate, two close — over the
 * well-known players only. Hard because its fame window opens fastest, and
 * the pool is cut to the names a follower of the scene knows first, so it
 * never reaches a deep cut.
 */
export const DAILY_LEVEL: Difficulty = 'hard';

/** Days a player sits out after being in the pairs, tried longest first. */
const PLAYER_REST = [14, 7, 0];

type Puzzle = DailyPuzzles['higher-lower'];

/** Who the pairs are drawn from: the daily's well-known players (`daily/fame.ts`). */
export function dailyPool(roster: Roster): RosterPlayer[] {
  const known = knownPlayers(roster);
  return roster.players.filter((player) => known.has(player.id));
}

/**
 * The day's pairs, clear of every player another game uses that day and of
 * the players in the pairs of the fortnight around it. `chosen` is a category
 * set by hand in the schedule editor; otherwise it is drawn, never the one the
 * day before or after has.
 */
export function pickDaily(roster: Roster, ctx: DailyContext, chosen?: DailyCategory): Puzzle | null {
  const rng = ctx.rng('higher-lower');
  const recent = ctx.recent('higher-lower');
  const near = new Set(recent.filter((use) => use.daysAgo <= 1).map((use) => use.puzzle.category));
  const open = DAILY_CATEGORIES.filter((category) => !near.has(category));
  const category = chosen ?? pick(rng, open.length ? open : DAILY_CATEGORIES);
  for (const rest of PLAYER_REST) {
    const resting = recent.filter((use) => use.daysAgo <= rest).flatMap((use) => use.puzzle.players);
    const puzzle = puzzleFor(roster, category, ctx.seed('higher-lower'), new Set([...ctx.taken, ...resting]));
    if (puzzle) return puzzle;
  }
  return null;
}

/** Ten pairs in `category`, from the well-known players other than `without`. */
export function puzzleFor(
  roster: Roster,
  category: DailyCategory,
  seed: string,
  without: ReadonlySet<string> = new Set(),
): Puzzle | null {
  const pool = dailyPool(roster).filter((player) => !without.has(player.id));
  const chain = dealChain(pool, category, DAILY_LEVEL, DAILY_ROUNDS, seed);
  return chain ? { category, players: chain.map((player) => player.id) } : null;
}

/**
 * The day's numbers pinned into its descriptor, the first time it is served
 * on or after its date, like Tenite's board: a tournament won the next week
 * cannot turn round a pair already played. Null when there is nothing to pin.
 */
export function freezeDaily(puzzle: Puzzle, roster: Roster): Puzzle | null {
  if (puzzle.frozen) return null;
  const byId = new Map(roster.players.map((player) => [player.id, player]));
  const players = puzzle.players.map((id) => byId.get(id));
  if (players.some((player) => !player)) return null;
  const frozen = (players as RosterPlayer[]).map((player) => round(valueOf(player, puzzle.category)));
  return { ...puzzle, frozen };
}

/** Five places is a few minutes of age and a fraction of a cent. */
const round = (value: number) => Math.round(value * 1e5) / 1e5;

export interface DailyState {
  category: DailyCategory;
  /** The players in the order they come, carrying the pinned numbers. */
  chain: Contender[];
  /** Each player's number in the category, pinned or as the data has it now. */
  values: number[];
  /** One per pair answered, in order. */
  answers: Answer[];
}

/** Everything the round needs to come back after a reload. */
export interface Snapshot {
  answers: Answer[];
}

export function restoreDaily(
  puzzle: Puzzle,
  byId: ReadonlyMap<string, RosterPlayer>,
  saved: Snapshot | null,
): DailyState | null {
  const players = puzzle.players.map((id) => byId.get(id));
  if (players.length < 2 || players.some((player) => !player)) return null;
  const live = players as RosterPlayer[];
  const values = puzzle.frozen?.length === live.length ? puzzle.frozen : live.map((player) => valueOf(player, puzzle.category));
  // The cards show the pinned numbers; age shows the birthday, which does not move.
  const chain = live.map((player, i): Contender =>
    puzzle.category === 'earnings'
      ? { ...player, earnings: values[i] }
      : puzzle.category === 'fncsWins'
        ? { ...player, fncsWins: values[i] }
        : player,
  );
  const answers = (saved?.answers ?? []).slice(0, chain.length - 1);
  return { category: puzzle.category, chain, values, answers };
}

export const pairsIn = (state: DailyState): number => state.chain.length - 1;

export const finished = (state: DailyState): boolean => state.answers.length >= pairsIn(state);

/** The right answer to pair `index`: its challenger against the player shown. */
export function truthAt(state: DailyState, index: number): Answer {
  const hidden = state.values[index + 1];
  const shown = state.values[index];
  return hidden > shown ? 'higher' : hidden < shown ? 'lower' : 'equal';
}

/** Whether pair `index` was answered right. A level pair without an Equal button takes either way. */
export function rightAt(state: DailyState, index: number): boolean {
  const given = state.answers[index];
  if (given === undefined) return false;
  const truth = truthAt(state, index);
  if (truth === 'equal' && !hasEqualButton(state.category)) return given !== 'equal';
  return given === truth;
}

export function answer(state: DailyState, given: Answer): DailyState {
  return finished(state) ? state : { ...state, answers: [...state.answers, given] };
}

export function scoreOf(state: DailyState): number {
  return state.answers.filter((_given, index) => rightAt(state, index)).length;
}

export function snapshot(state: DailyState): Snapshot {
  return { answers: state.answers };
}

export function result(state: DailyState): DailyResult {
  const right = scoreOf(state);
  return { outcome: right === pairsIn(state) ? 'won' : 'lost', score: `${right}/${pairsIn(state)}` };
}

/** One square per pair, five to a row: 🟩 right, 🟥 wrong. */
export function shareGrid(state: DailyState): string[] {
  const squares = state.answers.map((_given, index) => (rightAt(state, index) ? '🟩' : '🟥'));
  const rows: string[] = [];
  for (let i = 0; i < squares.length; i += 5) rows.push(squares.slice(i, i + 5).join(''));
  return rows;
}

/** The day as the analytics record it: the same payload as a run, every pair in it. */
export function record(state: DailyState): { outcome: Outcome; r: GamePayloads['higher-lower'] } {
  return {
    outcome: result(state).outcome,
    r: {
      score: scoreOf(state),
      pairs: state.answers.map((given, index) => ({
        shown: ref(state.chain[index]),
        hidden: ref(state.chain[index + 1]),
        answer: given,
        correct: rightAt(state, index),
      })),
    },
  };
}
