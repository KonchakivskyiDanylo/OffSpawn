import type { RosterPlayer } from '@/data/liquipedia/roster';
import type { DailyResult } from './types';

/**
 * Saving and sharing a round of clues — Career Path's and Who Are Ya's, whose
 * states have the same shape and differ only in what a clue is.
 */

interface ClueState {
  clues: readonly unknown[];
  secret: { id: string };
  revealed: number;
  earned: number;
  guesses: RosterPlayer[];
  steps: { clue: number; guess: RosterPlayer | null }[];
  /** Career Path's teammate hints; Who Are Ya has none. */
  hints?: number[];
  status: 'playing' | 'won' | 'lost';
  gaveUp: boolean;
}

/** Players by id instead of whole rows, so it fits in local storage. */
export interface ClueSnapshot {
  revealed: number;
  earned: number;
  guesses: string[];
  steps: { clue: number; guess: string | null }[];
  /** Absent from a day saved before Career Path had hints, and from Who Are Ya's. */
  hints?: number[];
  status: ClueState['status'];
  gaveUp: boolean;
}

export function snapClues(state: ClueState): ClueSnapshot {
  return {
    revealed: state.revealed,
    earned: state.earned,
    guesses: state.guesses.map((player) => player.id),
    steps: state.steps.map((step) => ({ clue: step.clue, guess: step.guess?.id ?? null })),
    ...(state.hints ? { hints: state.hints } : {}),
    status: state.status,
    gaveUp: state.gaveUp,
  };
}

/**
 * A fresh round with a saved one's progress put back. Null if a guessed player
 * has left the roster since — the caller then starts the day's round afresh.
 */
export function reviveClues<S extends ClueState>(fresh: S, saved: ClueSnapshot, byId: ReadonlyMap<string, RosterPlayer>): S | null {
  const player = (id: string) => byId.get(id);
  const guesses = saved.guesses.map(player);
  if (guesses.some((guess) => !guess)) return null;
  const steps = saved.steps.map((step) => ({ clue: step.clue, guess: step.guess === null ? null : (player(step.guess) ?? null) }));
  if (saved.revealed > fresh.clues.length) return null;
  return {
    ...fresh,
    revealed: saved.revealed,
    earned: saved.earned,
    guesses: guesses as RosterPlayer[],
    steps,
    ...(fresh.hints && saved.hints ? { hints: saved.hints.filter((index) => index < fresh.clues.length) } : {}),
    status: saved.status,
    gaveUp: saved.gaveUp,
  };
}

export function clueResult(state: ClueState): DailyResult {
  const won = state.status === 'won';
  return {
    outcome: won ? 'won' : state.gaveUp ? 'gave-up' : 'lost',
    score: `${won ? state.earned : 'X'}/${state.clues.length}`,
  };
}

/**
 * One square per clue: 🟥 guessed wrong on it, ⬛ skipped it, 🟩 named the
 * player on it, ⬜ never needed. A short hand's spare guesses after the last
 * clue add a 🟥 each.
 */
export function clueGrid(state: ClueState): string[] {
  const last = state.clues.length - 1;
  const squares = state.clues.map((_clue, index) => {
    const here = state.steps.filter((step) => step.clue === index);
    if (here.some((step) => step.guess?.id === state.secret.id)) return '🟩';
    if (index >= state.earned) return '⬜';
    if (here.some((step) => step.guess !== null)) return '🟥';
    return '⬛';
  });
  const spare = state.steps.filter((step) => step.clue === last && step.guess && step.guess.id !== state.secret.id).length - 1;
  for (let i = 0; i < spare; i++) squares.push('🟥');
  // Five to a row reads at a glance on a phone; ten in one line wraps anyway.
  const rows: string[] = [];
  for (let i = 0; i < squares.length; i += 5) rows.push(squares.slice(i, i + 5).join(''));
  return rows;
}
