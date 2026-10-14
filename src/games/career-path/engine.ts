import { ref, type GamePayloads, type Outcome } from '@/analytics/types';
import type { MajorResult } from '@/data/liquipedia/majors';
import type { FameTier, RosterPlayer } from '@/data/liquipedia/roster';
import { ordinal } from '@/lib/format';
import { makeRng, type Rng } from '@/lib/rng';

/** Pure logic for Career Path. */

/** Order reads the career oldest first; Random builds up, least telling result first. */
export type Mode = 'order' | 'random';

/** Clues in a round. Ten is enough for an arc and short enough to read. */
export const MAX_CLUES = 10;

/**
 * Guesses a round always gets, however short the hand — here and in Who Are Ya.
 *
 * A round has one guess per clue, which was all it needed while every answer
 * had five majors or more. An event field asks about anyone in it with a major
 * at all, and a two-major career would have been two guesses. So a hand
 * shorter than this makes the difference up after its last clue: guesses that
 * reveal nothing new, until five have been made.
 */
export const MIN_GUESSES = 5;

export interface Clue {
  result: MajorResult;
}

export interface GameState {
  mode: Mode;
  secret: RosterPlayer;
  /** Clues in reveal order. */
  clues: Clue[];
  revealed: number;
  /**
   * How many clues were showing when the round ended.
   *
   * Ending a round turns the whole clue list face up, so `revealed` alone can
   * no longer answer "how much did I actually need". This is the number the
   * score is really made of, and the list dims everything past it.
   */
  earned: number;
  guesses: RosterPlayer[];
  /**
   * Everything the player did, in order, and which clue was newest when they
   * did it: a guess, or a null for "reveal next clue". `guesses` alone cannot
   * say whether clue four was skipped or guessed past, and "Peterbot was found
   * right after the 2024 Globals" is exactly that question.
   */
  steps: { clue: number; guess: RosterPlayer | null }[];
  status: 'playing' | 'won' | 'lost';
  /**
   * Ended by Give up rather than by running out. The steps used to tell the two
   * apart — running out was a wrong guess on the last clue — but with spare
   * guesses after the last clue that no longer ends the round, so it is said
   * outright.
   */
  gaveUp: boolean;
}

/**
 * What the clue picker needs to know about everyone else.
 *
 * Passed in rather than imported so the engine stays pure: `Majors.finishers`
 * is the real one, and `check:games` hands over the same.
 */
export interface Field {
  /** Everyone who finished exactly where `result` did, the secret included. */
  finishers: (result: MajorResult) => ReadonlySet<string>;
}

/*
 * How the ten clues are chosen.
 *
 * The old picker had one idea — the best result from each stretch of the
 * career — and it produced exactly the rounds nobody enjoys: a champion's path
 * read 1st, 1st, 1st, 1st, 1st, which says "a winner" and nothing else; the
 * first clue for Bugha was the World Cup, which ends the round before it has
 * started; and a duo that played every major side by side got a clue list
 * that described both of them, so the right answer could be either.
 *
 * Now each clue is picked one at a time, scoring every result still unused on
 * what it would add to the list:
 *
 *   event    how recognisable the stage is — a Globals or the World Cup over a
 *            $65k regional final, on the prize pool's log scale
 *   mix      a finish band the list does not have yet (win, podium, top 10,
 *            top 25, the rest), and a penalty for a placement it already has
 *   spread   distance in time from the clues already picked, so the list
 *            covers the career rather than its best year — heavy in Order,
 *            where the career is read as a story, light in Random
 *   unique   whether it rules out someone else the list still describes — a
 *            duo partner, until one result they did not share is in
 *
 * plus a little noise, so meeting the same player twice is not the same round.
 *
 * Two rules sit on top. The list must describe exactly one player: if the
 * picks still fit someone else, the weakest is swapped for a result that
 * player does not share. The only careers where that cannot be done are the
 * thirteen whose every major was played beside the same partner — there the
 * partner fits every clue, and naming them first costs one clue.
 *
 * And the opening must not give the answer away: a signature result — any
 * major win, or a podium on a $1M stage — never comes in the first few
 * clues, how many depending on how famous the player is.
 * Three for the household names, two for the regulars, none for the deep
 * cuts, whose biggest stage is the only thing anyone could know them by. The
 * weights lean the same way: famous players get more mix, obscure players
 * more big events.
 */

/** Clues at the top of a round that may not be a signature result. */
const OPENING_GUARD: Record<FameTier, number> = { easy: 3, medium: 2, hard: 0 };

const WEIGHTS: Record<FameTier, { event: number; mix: number }> = {
  easy: { event: 0.6, mix: 1.3 },
  medium: { event: 1, mix: 1 },
  hard: { event: 1.6, mix: 0.7 },
};

const SPREAD: Record<Mode, number> = { order: 1.4, random: 0.4 };
const UNIQUE = 3;
const NOISE = 0.35;

/** A result the scene remembers by name: any major win, or a podium at a $1M+ event. */
export function isSignature(result: MajorResult): boolean {
  return result.placement === 1 || (result.placement <= 3 && (result.tournament.prizePool ?? 0) >= 1_000_000);
}

/** How recognisable the event is, 0 (a $65k regional final) to 1 (the World Cup). */
function eventWeight(result: MajorResult): number {
  const pool = Math.log10((result.tournament.prizePool ?? 0) + 1);
  return Math.min(1, Math.max(0, (pool - 4.8) / 2.4));
}

/**
 * How much a result gives away: about 0 for a 100th in a regional final, 1.5
 * for winning the World Cup. The finish counts most, on a log scale — a 1st is
 * 1, a 5th 0.65, a 10th a half, a 43rd under a fifth — and the stage adds up
 * to a half: a podium at the Globals tells more than one at a regional final.
 */
export function telling(result: MajorResult): number {
  const place = Math.max(0, 1 - Math.log(Math.max(1, result.placement)) / Math.log(100));
  return place + 0.5 * eventWeight(result);
}

/**
 * How far Random's clues may stray from least to most telling. Neighbours can
 * swap — a 25th and a 43rd come either way round — but a gap wider than this
 * never reverses, so a 43rd never comes after a top 5 or a top 10.
 */
export const RAMP_JITTER = 0.25;

/** Win, podium, top 10, top 25, the rest. */
export function finishBand(placement: number): number {
  if (placement === 1) return 0;
  if (placement <= 3) return 1;
  if (placement <= 10) return 2;
  return placement <= 25 ? 3 : 4;
}

const time = (result: MajorResult) => Date.parse(result.tournament.date);

/** Everyone besides the secret whom every one of these clues also describes. */
export function alsoFits(clues: readonly MajorResult[], secretId: string, field: Field): Set<string> {
  let others: Set<string> | null = null;
  for (const clue of clues) {
    const here = field.finishers(clue);
    others = new Set([...(others ?? here)].filter((id) => id !== secretId && here.has(id)));
    if (others.size === 0) break;
  }
  return others ?? new Set();
}

function pickClues(
  results: readonly MajorResult[],
  secret: RosterPlayer,
  mode: Mode,
  field: Field,
  rng: Rng,
): MajorResult[] {
  if (results.length <= MAX_CLUES) return [...results];

  const weights = WEIGHTS[secret.tier];
  const guard = OPENING_GUARD[secret.tier];
  const span = Math.max(1, time(results[results.length - 1]) - time(results[0]));
  const chosen: MajorResult[] = [];

  /*
   * In Order the opening is the start of the career, so the guard is kept by
   * construction: the first clues are the earliest results that are not
   * signatures, and any signature from before them is left out altogether.
   * That is how Bugha's path now opens on the FNCS finals after the World Cup
   * instead of on the World Cup itself.
   */
  let earliest = -Infinity;
  if (mode === 'order' && guard > 0) {
    const opening = results.filter((result) => !isSignature(result)).slice(0, guard);
    chosen.push(...opening);
    if (opening.length > 0) earliest = time(opening[opening.length - 1]);
  }
  const pool = results.filter((result) => !chosen.includes(result) && time(result) > earliest);

  const score = (result: MajorResult, others: Set<string>) => {
    const band = finishBand(result.placement);
    const sameBand = chosen.filter((clue) => finishBand(clue.placement) === band).length;
    // Per copy already in, so a fifth 4th costs more than a second 8th. Flat,
    // it did not: Saf's eleven majors hold five 4ths, and the hand kept all
    // five and dropped an 8th.
    const samePlace = chosen.filter((clue) => clue.placement === result.placement).length;
    const mix = (sameBand === 0 ? 1 : -0.35 * sameBand) - 0.3 * samePlace;
    const nearest = chosen.length
      ? Math.min(...chosen.map((clue) => Math.abs(time(clue) - time(result))))
      : span;
    const ruledOut = others.size
      ? [...others].filter((id) => !field.finishers(result).has(id)).length / others.size
      : 0;
    return (
      weights.event * eventWeight(result) +
      weights.mix * mix +
      SPREAD[mode] * (nearest / span) +
      UNIQUE * ruledOut +
      NOISE * rng()
    );
  };

  while (chosen.length < MAX_CLUES) {
    const open = pool.filter((result) => !chosen.includes(result));
    if (open.length === 0) break;
    const others = alsoFits(chosen, secret.id, field);
    let best = open[0];
    let bestScore = -Infinity;
    for (const result of open) {
      const value = score(result, others);
      if (value > bestScore) {
        best = result;
        bestScore = value;
      }
    }
    chosen.push(best);
  }

  // The list has to describe one player. The unique term nearly always gets
  // there on its own; this is the backstop, swapping the least recognisable
  // clue for the unused result that rules out the most of who is left.
  for (let tries = 0; tries < MAX_CLUES; tries++) {
    const others = alsoFits(chosen, secret.id, field);
    if (others.size === 0) break;
    const fixes = pool
      .filter((result) => !chosen.includes(result))
      .map((result) => ({
        result,
        ruledOut: [...others].filter((id) => !field.finishers(result).has(id)).length,
      }))
      .filter((fix) => fix.ruledOut > 0)
      .sort((a, b) => b.ruledOut - a.ruledOut);
    if (fixes.length === 0) break;
    const swappable = chosen
      .filter((clue) => mode !== 'order' || time(clue) > earliest)
      .sort((a, b) => eventWeight(a) - eventWeight(b));
    if (swappable.length === 0) break;
    chosen[chosen.indexOf(swappable[0])] = fixes[0].result;
  }
  return chosen;
}

/**
 * Puts the chosen clues in reveal order.
 *
 * Order is by date, and its opening was settled when the clues were picked.
 * Random builds up: the years come in any order, but the results go from the
 * least telling to the most, give or take `RAMP_JITTER` (the user, 14 Oct
 * 2026: "later places give you much more information… no top 43 in last
 * guess, but like top 5"). A plain shuffle used to leave a 43rd for the last
 * clue as often as a win. Then any signature still in the guarded opening —
 * only a hand of nearly all wins has one there — swaps places with the first
 * ordinary clue behind it.
 */
function revealOrder(clues: MajorResult[], secret: RosterPlayer, mode: Mode, rng: Rng): MajorResult[] {
  if (mode === 'order') return [...clues].sort((a, b) => time(a) - time(b));
  const out = clues
    .map((clue) => ({ clue, key: telling(clue) + RAMP_JITTER * rng() }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.clue);
  const guard = Math.min(OPENING_GUARD[secret.tier], out.length);
  for (let i = 0; i < guard; i++) {
    if (!isSignature(out[i])) continue;
    const swap = out.findIndex((clue, j) => j >= guard && !isSignature(clue));
    if (swap < 0) break;
    [out[i], out[swap]] = [out[swap], out[i]];
  }
  return out;
}

/**
 * A round on a secret player the caller has already chosen.
 *
 * The caller picks, because who comes up next is a rotation question (see
 * `games/shared/rotation.ts`) and the rules of the round are not.
 *
 * `results` must be the player's majors oldest first — `Majors.resultsFor`
 * guarantees that. Both modes draw the same kind of hand (see `pickClues`);
 * Order reads it by date, Random from the least telling result to the most.
 */
export function createGame(
  secret: RosterPlayer,
  results: readonly MajorResult[],
  mode: Mode,
  field: Field,
  seed: string = String(Date.now()),
): GameState | null {
  if (results.length === 0) return null;
  const rng = makeRng(seed);
  return roundOf(secret, revealOrder(pickClues(results, secret, mode, field, rng), secret, mode, rng), mode);
}

/** A fresh round on clues already chosen and ordered — how the daily puzzle rebuilds one. */
export function roundOf(secret: RosterPlayer, clues: readonly MajorResult[], mode: Mode): GameState {
  return {
    mode,
    secret,
    clues: clues.map((result) => ({ result })),
    revealed: 1,
    earned: 1,
    guesses: [],
    steps: [],
    status: 'playing',
    gaveUp: false,
  };
}

/**
 * A round of clues revealed one at a time — Career Path's and Who Are Ya's.
 * The guess budget below is written against this so both games share it.
 */
export interface ClueRound {
  clues: readonly unknown[];
  revealed: number;
  secret: { id: string };
  steps: readonly { clue: number; guess: { id: string } | null }[];
}

/** Guesses a short hand gets after its last clue — see `MIN_GUESSES`. */
function spareGuesses(state: ClueRound): number {
  return Math.max(0, MIN_GUESSES - state.clues.length);
}

/** Wrong guesses made with every clue already showing. */
function wrongAtEnd(state: ClueRound): number {
  const last = state.clues.length - 1;
  return state.steps.filter(
    (step) => step.clue === last && step.guess !== null && step.guess.id !== state.secret.id,
  ).length;
}

/**
 * Guesses still to come, the one that would end the round included: a clue's
 * worth for every clue still hidden, one on the last clue, and the spares.
 */
export function guessesLeft(state: ClueRound): number {
  return state.clues.length - state.revealed + 1 + spareGuesses(state) - wrongAtEnd(state);
}

/** Whether a wrong guess now, with every clue showing, ends the round. */
export function lastGuess(state: ClueRound): boolean {
  return wrongAtEnd(state) >= spareGuesses(state);
}

export function submitGuess(state: GameState, guess: RosterPlayer): GameState {
  if (state.status !== 'playing') return state;
  if (state.guesses.some((g) => g.id === guess.id)) return state;

  const guesses = [...state.guesses, guess];
  const steps = [...state.steps, { clue: state.revealed - 1, guess }];
  // Winning turns the rest of the clue list face up. Getting it in three means
  // seven results you never saw, and they are the payoff for getting it in
  // three — the career you just identified from a quarter of the evidence.
  if (guess.id === state.secret.id) {
    return { ...state, guesses, steps, revealed: state.clues.length, status: 'won' };
  }

  // A wrong guess burns a clue. With none left it spends one of a short
  // career's spare guesses, and with none of those either the round is over.
  if (state.revealed >= state.clues.length) {
    return { ...state, guesses, steps, status: lastGuess(state) ? 'lost' : 'playing' };
  }
  const revealed = state.revealed + 1;
  return { ...state, guesses, steps, revealed, earned: revealed };
}

/** Voluntarily reveal the next clue without guessing. */
export function revealNext(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  if (state.revealed >= state.clues.length) return state;
  const revealed = state.revealed + 1;
  const steps = [...state.steps, { clue: state.revealed - 1, guess: null }];
  return { ...state, steps, revealed, earned: revealed };
}

/** Ends the round unsolved, with every remaining clue turned face up. */
export function giveUp(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  return { ...state, revealed: state.clues.length, status: 'lost', gaveUp: true };
}

export function cluesLeft(state: GameState): number {
  return state.clues.length - state.revealed;
}

/**
 * The round as the analytics record it — see `analytics/types.ts`.
 *
 * A clue is named by its tournament, not its position: every hand is drawn
 * fresh, so "clue 4" means a different event each time Peterbot comes up, and
 * "after the 2024 Globals" is the thing worth counting.
 */
export function record(state: GameState): { outcome: Outcome; r: GamePayloads['career-path'] } {
  return {
    outcome: state.status === 'won' ? 'won' : state.gaveUp ? 'gave-up' : 'lost',
    r: {
      secret: ref(state.secret),
      clues: state.clues.map(({ result }) => ({
        id: result.tournament.name,
        name: `${result.tournament.shortName} — ${ordinal(result.placement)}`,
      })),
      steps: state.steps.map((step) => ({
        clue: step.clue,
        guess: step.guess ? ref(step.guess) : null,
        correct: step.guess?.id === state.secret.id,
      })),
    },
  };
}
