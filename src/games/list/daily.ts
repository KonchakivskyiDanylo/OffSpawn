import type { Roster } from '@/data/liquipedia/roster';
import { knownPlayers } from '@/daily/fame';
import { answerSig, resting, spaced } from '@/daily/reuse';
import type { DailyContext, DailyPuzzles, DailyResult } from '@/daily/types';
import { pick } from '@/lib/rng';
import type { Criterion } from './criteria';

/** A wrong name costs three seconds, so a shared score is a score and not a typing speed. */
export const DAILY_LEVEL = 'hard' as const;

type Puzzle = DailyPuzzles['list'];

/** Kinds too deep for a list everyone gets: every Div Cup or FNCS final of one season, two regional finals, evaluations. */
const LEFT_OUT = new Set(['pool', 'divcup-every', 'fncs-every', 'finals-pair', 'fpe-sessions']);

/** Lists this long are a round; shorter ones end in seconds, longer ones are a census. */
const SIZE = { min: 10, max: 60 };

/** On a list of players: at least this many famous names, and this share famous or regular. */
const FAMOUS = { names: 4, share: 0.4 };

/**
 * A list with the same answers waits `SAME_REST` days, a changed one
 * `CHANGED_REST` (`daily/reuse.ts`); these narrow that window further only if
 * every list ever ran out.
 */
const REST_DAYS = [Infinity, 30, 7];

/** Who is on a list, for telling a changed list from the same one. */
export function listSig(list: Criterion): string {
  return answerSig(list.answers.map((answer) => answer.id));
}

export const kindOf = (list: Criterion) => list.id.split(':')[0];

export function pickDaily(roster: Roster, lists: readonly Criterion[], ctx: DailyContext): Puzzle | null {
  const tier = new Map(roster.players.map((player) => [player.id, player.tier]));
  const wellKnown = knownPlayers(roster);
  const offered = lists.filter((list) => {
    if (LEFT_OUT.has(kindOf(list))) return false;
    if (list.answers.length < SIZE.min || list.answers.length > SIZE.max) return false;
    if (list.noun && list.noun !== 'players') return true;
    // Followers are famous by what the list counts: the fame test is about earnings.
    if (kindOf(list) === 'followers') return true;
    const famous = list.answers.filter((answer) => tier.get(answer.id) === 'easy').length;
    const known = list.answers.filter((answer) => wellKnown.has(answer.id)).length;
    return famous >= FAMOUS.names && known >= FAMOUS.share * list.answers.length;
  });
  const byId = new Map(lists.map((list) => [list.id, list]));
  const rng = ctx.rng('list');
  const sigs = new Map(offered.map((list) => [list.id, listSig(list)]));
  const uses = ctx.recent('list').map(({ daysAgo, puzzle }) => ({ daysAgo, id: puzzle.list, sig: puzzle.sig }));
  for (const rest of [...REST_DAYS, 0]) {
    const out = resting(uses, (id) => sigs.get(id) ?? null, rest);
    const fresh = offered.filter((list) => !out.has(list.id));
    if (fresh.length === 0) continue;
    const left = spaced(fresh, uses, (id) => byId.get(id), kindOf);
    // A kind first, so fifty organisation lists do not make every other day an organisation.
    const kind = pick(rng, [...new Set(left.map(kindOf))]);
    const list = pick(rng, left.filter((candidate) => kindOf(candidate) === kind));
    return { list: list.id, sig: sigs.get(list.id) };
  }
  return null;
}

/**
 * A daily List run as it stands. The clock is kept as when it started and how
 * far the bonuses and penalties have moved it, so a reload mid-run carries on
 * from the real time left — and a run left open past its end is over.
 */
export interface Snapshot {
  /** When the clock started, ms since the epoch; null before Start. */
  started: number | null;
  /** Seconds added and taken away so far. */
  shift: number;
  /** What was named, newest first. */
  found: { id: string; name: string }[];
  wrong: number;
  ended: null | 'cleared' | 'time' | 'gave-up';
}

export const FRESH: Snapshot = { started: null, shift: 0, found: [], wrong: 0, ended: null };

export function result(snap: Snapshot, total: number): DailyResult {
  return {
    outcome: snap.ended === 'cleared' ? 'won' : snap.ended === 'gave-up' ? 'gave-up' : 'lost',
    score: `${snap.found.length}/${total}`,
  };
}

/** Ten blocks, one per tenth of the list named. */
export function shareGrid(snap: Snapshot, total: number): string[] {
  const filled = total > 0 ? Math.round((snap.found.length / total) * 10) : 0;
  return ['🟩'.repeat(filled) + '⬛'.repeat(10 - filled)];
}
