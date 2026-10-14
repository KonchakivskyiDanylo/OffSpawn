import { hashString } from '@/lib/rng';

/**
 * When a Tenaball board or a List may come round again.
 *
 * Never while it would be the same puzzle: a board whose top 10 is the same
 * people is the puzzle people already played. But a board can change under its
 * name — "Top 10 by career earnings" after a World Cup is a new top 10 — and
 * then it is a new puzzle (the user, 3 Oct 2026: "it's fine to reuse like career
 * earnings if something changed"). So each daily keeps a fingerprint of who was
 * on it (`sig`), and a board is used up only while that is still who is on it.
 */

/** Who is on a puzzle, order aside: "the same top 10" means the same people. */
export function answerSig(keys: readonly string[]): string {
  return hashString([...keys].sort().join('|')).toString(36);
}

/** Even a changed board waits this long, so a top 10 that moves every week is not every week's puzzle. */
export const CHANGED_REST = 30;

/**
 * An unchanged board may come back after this long, as the same puzzle (the
 * user, 14 Oct 2026: "even something doesn't change I would like to repeat it
 * sometimes, maybe just have like 90 days… like have world cup board again,
 * because it's popular"). It used to wait for good.
 */
export const SAME_REST = 90;

export interface Use {
  daysAgo: number;
  id: string;
  /** Absent on a day scheduled before fingerprints existed — read as unchanged. */
  sig?: string;
}

/**
 * The ids not to offer, given how strict to be: anything used unchanged within
 * `SAME_REST` days, and anything changed but used within `CHANGED_REST` days —
 * both only within `rest` days, so a caller can relax it when nothing else is
 * left.
 */
export function resting(uses: readonly Use[], current: (id: string) => string | null, rest: number): Set<string> {
  return new Set(
    uses
      .filter((use) => use.daysAgo <= rest)
      .filter((use) => {
        const now = current(use.id);
        const unchanged = !use.sig || now === null || now === use.sig;
        return use.daysAgo <= (unchanged ? SAME_REST : CHANGED_REST);
      })
      .map((use) => use.id),
  );
}

/** Days either side of a day that may not have the same kind of board or list. */
export const KIND_GAP = 2;

/** Days either side that may not have the same family: one board split by region or by year. */
export const FAMILY_GAP = 7;

/**
 * The candidates that keep neighbouring days apart: no kind used within
 * `KIND_GAP` days, and no family within `FAMILY_GAP`. A kind was drawn fresh
 * every day, so five "average FNCS finish" boards could land in eight days.
 * Drops the family test, then the kind test, if nothing would be left.
 */
export function spaced<T>(
  left: readonly T[],
  uses: readonly Use[],
  lookup: (id: string) => T | undefined,
  kind: (item: T) => string | null,
  family?: (item: T) => string,
): T[] {
  const near = (gap: number, key: (item: T) => string | null) =>
    new Set(
      uses.flatMap((use) => {
        const item = use.daysAgo <= gap ? lookup(use.id) : undefined;
        return item ? [key(item)] : [];
      }),
    );
  const kinds = near(KIND_GAP, kind);
  const apart = left.filter((item) => !kinds.has(kind(item)));
  if (!apart.length) return [...left];
  if (!family) return apart;
  const families = near(FAMILY_GAP, family);
  const further = apart.filter((item) => !families.has(family(item)));
  return further.length ? further : apart;
}
