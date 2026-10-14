import type { GamePayloads, Outcome } from '@/analytics/types';
import { membersOf, type Board, type BoardMember, type BoardRow } from '@/data/liquipedia/rankings';

/** Pure logic for Tenaball. */

export type Difficulty = 'easy' | 'hard';

export const HARD_LIVES = 3;
/** The daily's lives, more than practice Hard (the user, 13 Oct 2026: "more lives for daily tenaball, like 5"). */
export const DAILY_LIVES = 5;
export const SLOTS = 10;

export interface Slot {
  rank: number;
  row: BoardRow;
  /**
   * Everyone this slot wants named.
   *
   * One person on almost every board. A tournament played in duos or trios
   * ranks *placements*, so 1st is a team and the slot only closes once every
   * name on it has been given.
   */
  members: BoardMember[];
  /**
   * On a board whose cut is shared, the other level entry for 10th: the 11th
   * until they are named in its place, then the 10th. Shown beside a 10th that
   * was never found.
   */
  also?: BoardMember[];
}

export function slotsOf(board: Board): Slot[] {
  return board.rows.map((row, index) => ({ rank: index + 1, row, members: membersOf(row) }));
}

/**
 * The slots as a round stands. The same as `slotsOf` except on a shared cut,
 * where 10th is whichever of the two level entries was named there.
 */
export function slotsIn(state: GameState): Slot[] {
  const { board } = state;
  const slots = slotsOf(board);
  if (!board.shareCut) return slots;
  const last = slots[slots.length - 1];
  const spare = membersOf(board.next);
  const named = namedIn(state, last.rank);
  slots[slots.length - 1] = spare.some((member) => named.has(member.key))
    ? { rank: last.rank, row: { ...board.next, display: last.row.display }, members: spare, also: last.members }
    : { ...last, also: spare };
  return slots;
}

export interface GameState {
  board: Board;
  difficulty: Difficulty;
  /** Ranks with every member named. */
  found: Set<number>;
  /**
   * Rank -> the member keys named so far, including the ranks now in `found`.
   *
   * The partial ones are the point: a duo row someone has half of is worth
   * showing on the board, and worth protecting from being scored as a miss.
   */
  named: Map<number, Set<string>>;
  /** Labels of wrong answers, in the order they were given. */
  wrong: string[];
  lives: number;
  /** The lives the round started with: `HARD_LIVES` in practice, `DAILY_LIVES` on the daily. */
  maxLives: number;
  status: 'playing' | 'won' | 'lost';
}

export function createGame(board: Board, difficulty: Difficulty, maxLives = HARD_LIVES): GameState {
  return {
    board,
    difficulty,
    found: new Set(),
    named: new Map(),
    wrong: [],
    lives: difficulty === 'hard' ? maxLives : Number.POSITIVE_INFINITY,
    maxLives,
    status: 'playing',
  };
}

const EMPTY: ReadonlySet<string> = new Set();

/** The member keys already given for one rank. */
export function namedIn(state: GameState, rank: number): ReadonlySet<string> {
  return state.named.get(rank) ?? EMPTY;
}

/** Ends the board unsolved, so the remaining ten can be revealed. */
export function giveUp(state: GameState): GameState {
  return state.status === 'playing' ? { ...state, status: 'lost' } : state;
}

export type GuessOutcome =
  | { kind: 'correct'; rank: number }
  /** Right row, but the team it ranks is not complete yet. */
  | { kind: 'partial'; rank: number; remaining: number }
  | { kind: 'duplicate'; rank: number }
  /** Level with the entry already holding a shared 10th — costs nothing. */
  | { kind: 'level'; rank: number; holder: string }
  /**
   * The 11th: wrong, and it costs a life like any wrong answer — the game only
   * says how close it was. `level` when it is tied with 10th on the value and
   * lost on the tie rule.
   */
  | { kind: 'eleventh'; level: boolean }
  | { kind: 'wrong' }
  /** The text did not resolve to anything the board could judge. */
  | { kind: 'unknown' };

/**
 * Scores a guess.
 *
 * `key` is the canonical id the board ranks on — a page name, an org id or a
 * country name — which the caller resolves from what was typed. On a team board
 * it is one player's page name, and the row it belongs to is the one that owns
 * that name.
 *
 * Naming the 11th (`next`) is a wrong answer and costs a life: the top 11 is
 * still not the top 10 (the user, 13 Oct 2026 — it used to be a free near
 * miss). The game still says it was 11th, which is worth knowing and gives
 * nothing away. A 12th is invisible here, because the board ships ten rows and
 * one spare rather than the whole ranking — the trade that keeps the file small
 * enough to ship.
 *
 * `level` says whether the 11th is really tied with the 10th or merely next in
 * line: on a money board it almost never is, and on a board of finishing
 * positions it never is, so the message the two deserve is not the same one.
 *
 * The one free answer left is a shared cut (`shareCut`): there 10th and 11th
 * are level on everything, both are right, and naming the second after the
 * first is told it is level and costs nothing.
 */
export function applyGuess(
  state: GameState,
  key: string | null,
  label?: string,
): { state: GameState; outcome: GuessOutcome } {
  if (state.status !== 'playing') return { state, outcome: { kind: 'wrong' } };
  if (!key) return { state, outcome: { kind: 'unknown' } };

  const slots = slotsIn(state);
  // A player can be on more than one row of a pairs board — Peterbot & Pollo,
  // Peterbot & Cold — so the name goes to a row still missing it, one already
  // begun first; only when every row of theirs has it is it a repeat.
  const holding = slots.flatMap((slot, i) => (slot.members.some((member) => member.key === key) ? [i] : []));
  const open = holding.filter((i) => !namedIn(state, i + 1).has(key));
  let index = open.length ? (open.find((i) => namedIn(state, i + 1).size > 0) ?? open[0]) : (holding[0] ?? -1);
  let wanted = index >= 0 ? slots[index].members : [];
  const last = slots[slots.length - 1];
  if (index < 0 && last.also?.some((member) => member.key === key)) {
    // A shared cut: the other level entry takes 10th while nobody holds it.
    if (namedIn(state, last.rank).size > 0) {
      const holder = last.members.map((member) => member.label).join(' & ');
      return { state, outcome: { kind: 'level', rank: last.rank, holder } };
    }
    index = slots.length - 1;
    wanted = last.also;
  }
  if (index >= 0) {
    const rank = index + 1;
    const already = namedIn(state, rank);
    if (already.has(key)) return { state, outcome: { kind: 'duplicate', rank } };

    const names = new Set(already).add(key);
    const named = new Map(state.named).set(rank, names);
    if (names.size < wanted.length) {
      return {
        state: { ...state, named },
        outcome: { kind: 'partial', rank, remaining: wanted.length - names.size },
      };
    }
    const found = new Set(state.found).add(rank);
    return {
      state: {
        ...state,
        named,
        found,
        status: found.size === state.board.rows.length ? 'won' : 'playing',
      },
      outcome: { kind: 'correct', rank },
    };
  }

  const tenth = state.board.rows[state.board.rows.length - 1];
  const eleventh = membersOf(state.board.next).some((member) => member.key === key);
  const lives = state.difficulty === 'hard' ? state.lives - 1 : state.lives;
  return {
    state: {
      ...state,
      wrong: [...state.wrong, label ?? key],
      lives,
      status: lives <= 0 ? 'lost' : 'playing',
    },
    outcome: eleventh ? { kind: 'eleventh', level: state.board.next.value === tenth.value } : { kind: 'wrong' },
  };
}

/**
 * The board as the analytics record it: every answer on it, found or not,
 * which is what "most and least guessable" is counted from. On a team row
 * each name counts on its own — half a duo is half the knowledge.
 *
 * Only Hard can be lost; a board that ends unsolved any other way was given up.
 */
export function record(state: GameState): { outcome: Outcome; r: GamePayloads['tenaball'] } {
  return {
    outcome: state.status === 'won' ? 'won' : state.lives <= 0 ? 'lost' : 'gave-up',
    r: {
      board: { id: state.board.id, name: state.board.title },
      answers: slotsIn(state).flatMap((slot) =>
        slot.members.map((member) => ({
          name: member.label,
          found: namedIn(state, slot.rank).has(member.key),
        })),
      ),
      wrong: state.wrong,
    },
  };
}
