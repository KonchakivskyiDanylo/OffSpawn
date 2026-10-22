import type { Board, BoardMember, BoardRow, EntityKind } from '@/data/liquipedia/rankings';

/**
 * Assembling a Tenaball board out of ranked rows.
 *
 * Shared by the two places that build boards in the browser rather than reading
 * them from `rankings.json`: the event-mode field boards (`pool-boards.ts`) and
 * the handful of all-time boards the shipped set does not carry
 * (`derived-boards.ts`). Everything precomputed still comes from the notebook,
 * for the reason given in `rankings.ts` — 442,736 placement rows is not a thing
 * to aggregate on a phone. These two build from data already in memory.
 */

export const SLOTS = 10;

/** Ten rows plus the spare that makes the near-miss rule work. */
export const NEEDED = SLOTS + 1;

export interface Ranked {
  key: string;
  label: string;
  value: number;
  display: string;
  /**
   * What decides a tie on `value`, bigger first: the category's own steps in
   * order, then career earnings for a player or combined earnings for a
   * country or an org — `[podiums, earnings]` on a board of FNCS titles.
   * Absent where the value is already money, and a tie there is a tie.
   */
  tiebreak?: number | readonly number[];
  /** A team row's players — see `BoardRow.members`. */
  members?: BoardMember[];
}

/** The tie rule for a player board counted in anything but money. */
export const TIE_EARNINGS =
  'Players level on the count are ranked by career earnings, so the bigger earner is higher.';

/**
 * A tie rule with the category's own steps before the money, the way the
 * notebook writes them (`tie_text` in `derived.py`): "Level ones go to more
 * FNCS podiums, then to the bigger career earner." The user, 22 Oct 2026:
 * "only career earnings isn't ideal… it could change depends on the category".
 */
export function tieText(...steps: string[]): string {
  return `Level ones go to ${[...steps, 'the bigger career earner'].join(', then to ')}.`;
}

/** The same, for boards whose rows are countries or organisations. */
export const TIE_GROUP_EARNINGS =
  'Level counts are split by the combined career earnings of the players behind them.';

/**
 * A board, or nothing.
 *
 * Nothing is the common case for a small field — a hundred players do not
 * necessarily yield eleven organisations worth ranking — and a board with
 * eight rows is not a Tenaball board. The caller simply drops it.
 */
export function board(
  id: string,
  group: string,
  title: string,
  entity: EntityKind,
  tieRule: string,
  ranked: Ranked[],
  lowerIsBetter?: boolean,
): Board | null {
  if (ranked.length < NEEDED) return null;
  // Level with the 11th on everything the board ranks by: no single right
  // answer for the last slot. The board used to hand it to whichever name came
  // first in the alphabet, which is a rule nobody can play; now it is not
  // offered at all, the way the notebook drops a tournament whose tenth and
  // eleventh places are shared.
  if (level(ranked[SLOTS - 1], ranked[SLOTS])) return null;
  const rows: BoardRow[] = ranked.slice(0, SLOTS);
  const next = ranked[SLOTS];
  return {
    id,
    group,
    title,
    entity,
    tieRule,
    rows,
    next: { key: next.key, label: next.label, value: next.value, members: next.members },
    lowerIsBetter,
  };
}

/**
 * Sort on `value`, descending unless `ascending`, then on `tiebreak`, bigger
 * first.
 *
 * Ties used to fall to the label. It was at least a stated rule — "level
 * values are ordered alphabetically" — but not one anybody can play: on "top
 * 10 by FNCS wins" the 3s outnumber the slots, and which of them is tenth came
 * down to an initial. Earnings is a rule a player can reason about. What is
 * still level after it is left level — `board` refuses a cut that falls there,
 * and anywhere else in the ten the order is only where a slot is drawn.
 */
export function byValue<T extends Ranked>(ranked: T[], ascending = false): T[] {
  return ranked.sort(
    (a, b) => (ascending ? a.value - b.value : b.value - a.value) || compareTies(b.tiebreak, a.tiebreak),
  );
}

/** The steps of a tiebreak as a list: one number is a list of one. */
const steps = (tiebreak: Ranked['tiebreak']): readonly number[] =>
  tiebreak === undefined ? [] : typeof tiebreak === 'number' ? [tiebreak] : tiebreak;

/** `a` against `b`, step by step: positive when `a` is bigger at the first step they differ. */
function compareTies(a: Ranked['tiebreak'], b: Ranked['tiebreak']): number {
  const [x, y] = [steps(a), steps(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

function level(a: Ranked, b: Ranked): boolean {
  return a.value === b.value && compareTies(a.tiebreak, b.tiebreak) === 0;
}
