import { ref, type GamePayloads, type Outcome } from '@/analytics/types';
import type { RosterPlayer } from '@/data/liquipedia/roster';
import type { Difficulty } from '@/games/shared/difficulty';
import { makeRng } from '@/lib/rng';
import { normalizeName } from '@/lib/text';

/** Pure Wordle logic over player handles. */

export type TileState = 'correct' | 'present' | 'absent';
export const MAX_GUESSES = 6;

/**
 * What a digit gives away when its turn comes (see `revealSchedule`).
 *
 *   digit      the digit itself, in place, and its key goes green
 *   position   a # where a digit sits, and not which one
 *   exists     only that the name has at least one digit — not how many,
 *              which or where
 *   none       nothing; find it yourself
 *
 * Every round is `exists` now, every level and the daily (the user, 8 Oct
 * 2026: "just tell that there is a number but don't tell which one and
 * where"). Until then Easy gave the digit, Medium and the daily a #, Hard
 * nothing, and only Random said there was one (2 Oct 2026: "at least tell
 * that there is a number"). It arrives after guess three. The other kinds are
 * kept: one line in `DIGIT_HELP` brings a level's back.
 */
export type DigitHelp = 'digit' | 'position' | 'exists' | 'none';

export const DIGIT_HELP: Readonly<Record<Difficulty, DigitHelp>> = {
  easy: 'exists',
  medium: 'exists',
  hard: 'exists',
};

/** What a position-only reveal shows in place of the digit. */
export const HIDDEN_DIGIT = '#';

export interface GameState {
  secret: RosterPlayer;
  /** The secret reduced to A-Z0-9 — what the player actually types. */
  answer: string;
  /** The difficulty chosen for the round, or null for none (see `chosenLevel`). Sets the digit help. */
  level: Difficulty | null;
  /** Every guess must be a player's name (`playerNames`) — a Choose option, never Random or the daily. */
  namesOnly: boolean;
  guesses: string[];
  status: 'playing' | 'won' | 'lost';
}

/**
 * Players whose handle makes a fair puzzle once punctuation is stripped.
 *
 * Length is the obvious rule; the other two are answers that are technically
 * guessable and miserable in practice:
 *
 *   - a parenthetical is Liquipedia page bookkeeping, not part of a handle, and
 *     it leaks straight into the answer — "Nate (NA player)" becomes the
 *     twelve-tile word NATENAPLAYER, which no one can be expected to reach.
 *   - one distinct character means the grid gives nothing back. "666" scores
 *     every tile green or every tile grey and the round is a coin flip.
 */
export function eligible(players: readonly RosterPlayer[]): RosterPlayer[] {
  return players.filter((player) => {
    if (/[(）)]/.test(player.name)) return false;
    const key = normalizeName(player.name);
    if (key.length < 3 || key.length > 12) return false;
    return new Set(key).size >= 2;
  });
}

/**
 * A round on a secret player the caller has already chosen.
 *
 * Separate from `createGame` because the board no longer picks: the game deals
 * from a no-repeat rotation (`games/shared/rotation.ts`) and hands the result
 * here, so the choice of player and the rules of the round stay apart.
 */
export function gameFor(secret: RosterPlayer, level: Difficulty | null = 'easy', namesOnly = false): GameState {
  return { secret, answer: normalizeName(secret.name), level, namesOnly, guesses: [], status: 'playing' };
}

/**
 * Every guess a "player names only" round accepts: each player's handle and
 * the other names Liquipedia lists for them, reduced the way a guess is.
 *
 * The option the user asked for on 13 Oct 2026: no QWERTY or ASDFG to test
 * letters, only real names, the way Wordle only takes real words. Harder, so it
 * is behind Choose and never in Random or the daily. The whole roster counts,
 * not just the answers: a handle too long or odd to be an answer (NATENAPLAYER)
 * is still a name. Over a thousand at five or six characters; at eleven and
 * twelve only a few dozen, which is the hard end of it.
 */
export function playerNames(players: readonly RosterPlayer[]): Set<string> {
  const names = new Set<string>();
  for (const player of players) {
    for (const name of [player.name, ...player.aliases]) {
      const key = normalizeName(name);
      if (key) names.add(key);
    }
  }
  return names;
}

export function createGame(
  players: readonly RosterPlayer[],
  seed: string = String(Date.now()),
): GameState | null {
  const pool = eligible(players);
  if (pool.length === 0) return null;
  const rng = makeRng(seed);
  return gameFor(pool[Math.floor(rng() * pool.length)], null);
}

/** How much this round's digits give away. */
export function digitHelp(state: GameState): DigitHelp {
  return state.level ? DIGIT_HELP[state.level] : 'exists';
}

// ------------------------------------------------------- digit reveals --

/** No digit is given away before this many guesses — see `revealSchedule`. */
export const FIRST_REVEAL = 3;
/** ...and none is held back past this one. */
export const LAST_REVEAL = 5;

/**
 * When each digit in the answer stops being a secret.
 *
 * Digits are the one thing in this game a player cannot reason about. A letter
 * tile tells you something every round — it is in the name, or it is not, or it
 * is somewhere else. A digit tells you nothing until you happen to type it, and
 * 342 of the 5,678 handles have one, so those rounds were a lottery rather than
 * a puzzle: TH0MASHD is unreachable if you never think to try a zero.
 *
 * So they are given, but not before guess three. Digit `k` arrives after guess
 * `3 + k`, and nothing waits past guess five:
 *
 *   one digit      after 3
 *   two digits     after 3, 4
 *   three digits   after 3, 4, 5
 *   four digits    after 3, 4, 5, 5
 *
 * The previous schedule spread the reveals evenly across all six guesses, which
 * handed the first digit of a four-digit handle over before the player had
 * typed anything. Eleven handles carry three digits or more and two carry four
 * (`LEO2004`, `Stef2317`), so that case was rare and, when it came up, gave the
 * round away on sight. Three guesses of nothing is the point: you get half the
 * round to find it yourself, and the same half every time.
 *
 * Returns position in the answer -> guesses required.
 */
export function revealSchedule(answer: string): Map<number, number> {
  const schedule = new Map<number, number>();
  let index = 0;
  for (let i = 0; i < answer.length; i++) {
    if (answer[i] >= '0' && answer[i] <= '9') {
      schedule.set(i, Math.min(FIRST_REVEAL + index, LAST_REVEAL));
      index++;
    }
  }
  return schedule;
}

/**
 * The digits the player can see right now, as position -> what the strip shows
 * there: the digit for `digit` help, `HIDDEN_DIGIT` for `position`. Always
 * empty for `none` and for `exists`, which only says there is one
 * (`digitAnnounced`) — every round today.
 *
 * Empty for the great majority of rounds, whose answers are all letters.
 */
export function revealedDigits(state: GameState): Map<number, string> {
  const shown = new Map<number, string>();
  const help = digitHelp(state);
  if (help === 'none' || help === 'exists') return shown;
  const done = state.status !== 'playing';
  for (const [position, after] of revealSchedule(state.answer)) {
    if (done || state.guesses.length >= after) {
      shown.set(position, help === 'digit' ? state.answer[position] : HIDDEN_DIGIT);
    }
  }
  return shown;
}

/**
 * Whether the round may now say the answer has a digit: from guess
 * `FIRST_REVEAL`, the moment a digit's first reveal is due. Never how many —
 * "at least one" is the whole hint (the user, 2 Oct 2026). False before then,
 * for any help but `exists`, and for an answer with no digit.
 */
export function digitAnnounced(state: GameState): boolean {
  return digitHelp(state) === 'exists' && state.guesses.length >= FIRST_REVEAL && hasDigits(state.answer);
}

/** True when this answer has any digit at all — the hint strip is hidden otherwise. */
export function hasDigits(answer: string): boolean {
  return /[0-9]/.test(answer);
}

/**
 * Standard two-pass Wordle scoring: exact hits first, then misplaced ones
 * against whatever letters are left over, so duplicates behave correctly.
 */
export function scoreGuess(guess: string, answer: string): TileState[] {
  const result: TileState[] = new Array(guess.length).fill('absent');
  const leftover = new Map<string, number>();

  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answer[i]) {
      result[i] = 'correct';
    } else {
      leftover.set(answer[i], (leftover.get(answer[i]) ?? 0) + 1);
    }
  }
  for (let i = 0; i < guess.length; i++) {
    if (result[i] === 'correct') continue;
    const available = leftover.get(guess[i]) ?? 0;
    if (available > 0) {
      result[i] = 'present';
      leftover.set(guess[i], available - 1);
    }
  }
  return result;
}

export type SubmitResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: string };

/** `names` is the accepted list on a names-only round (`playerNames`); any string goes otherwise. */
export function submitGuess(state: GameState, rawGuess: string, names?: ReadonlySet<string>): SubmitResult {
  if (state.status !== 'playing') return { ok: false, reason: 'This round is already over.' };

  const guess = normalizeName(rawGuess);
  if (guess.length === 0) {
    return { ok: false, reason: `Type ${state.answer.length} characters first.` };
  }
  // Say what is wrong and by how much, rather than restating the rule: a player
  // two letters short should not have to count the tiles to find that out.
  if (guess.length < state.answer.length) {
    const missing = state.answer.length - guess.length;
    return { ok: false, reason: `${missing} more character${missing === 1 ? '' : 's'} needed.` };
  }
  if (guess.length > state.answer.length) {
    return { ok: false, reason: `Too long — the name is ${state.answer.length} characters.` };
  }
  if (state.guesses.includes(guess)) {
    return { ok: false, reason: `You already tried ${guess}.` };
  }
  // Like Wordle's "not in word list": it costs no guess. Without a list nothing passes,
  // so a round that forgot to pass one fails loudly rather than quietly allowing anything.
  if (state.namesOnly && !names?.has(guess)) {
    return { ok: false, reason: `${guess} is not a player’s name — only real names count in this mode.` };
  }

  const guesses = [...state.guesses, guess];
  const won = guess === state.answer;
  return {
    ok: true,
    state: {
      ...state,
      guesses,
      status: won ? 'won' : guesses.length >= MAX_GUESSES ? 'lost' : 'playing',
    },
  };
}

/** Ends the round unsolved, so the answer can be revealed. */
export function giveUp(state: GameState): GameState {
  return state.status === 'playing' ? { ...state, status: 'lost' } : state;
}

/**
 * Best-known state per character, for colouring the on-screen keyboard.
 *
 * Best, not latest: a character green in one guess stays green even if a later
 * guess puts a second copy of it somewhere the answer does not have one. That
 * second copy is grey on the grid — correctly, there is only one — but greying
 * the key would retract information the player has already earned.
 */
export function keyboardState(state: GameState): Map<string, TileState> {
  const best = new Map<string, TileState>();
  const rank: Record<TileState, number> = { absent: 0, present: 1, correct: 2 };

  for (const guess of state.guesses) {
    const scores = scoreGuess(guess, state.answer);
    guess.split('').forEach((char, index) => {
      const current = best.get(char);
      if (!current || rank[scores[index]] > rank[current]) best.set(char, scores[index]);
    });
  }

  // A revealed digit is a character the player has been *told* is in the answer,
  // at a position they can see. Leaving its key uncoloured made the hint strip
  // and the keyboard disagree about a fact the game had already given away —
  // and the key is where you look before you type. Only on Easy: a Medium
  // reveal says where a digit is and not which, and a green key would say which.
  if (digitHelp(state) === 'digit') {
    for (const char of revealedDigits(state).values()) {
      if (rank[best.get(char) ?? 'absent'] < rank.correct) best.set(char, 'correct');
    }
  }
  return best;
}

/** The round as the analytics record it. Lost with guesses left means given up. */
export function record(state: GameState): { outcome: Outcome; r: GamePayloads['wordle'] } {
  return {
    outcome:
      state.status === 'won' ? 'won' : state.guesses.length >= MAX_GUESSES ? 'lost' : 'gave-up',
    r: { secret: ref(state.secret), guesses: state.guesses.length },
  };
}
