import { ref, type GamePayloads, type Outcome } from '@/analytics/types';
import type { RosterPlayer } from '@/data/liquipedia/roster';
import type { Teammates } from '@/data/liquipedia/teammates';
import type { FameTier } from '@/data/liquipedia/roster';
import { makeRng, pick, shuffle, type Rng } from '@/lib/rng';
import { ambiguousNames, namedPlayer } from '@/lib/text';
import {
  buildCriteria,
  isNested,
  NEAR_NESTED,
  type CriteriaSource,
  type CriterionKind,
  type PlayerCriterion,
} from '@/games/shared/criteria';

/**
 * Pure logic for Bingo: a 4×4 card of player categories and players dealt one
 * at a time. Put each on a square they fit, or skip them. Fill the whole card
 * before the players, the clock or the lives run out.
 *
 * The user's list (30 Sep 2026), as far as the export can answer it. Two of
 * its squares are not here: "is a controller player" (Liquipedia records no
 * input device) and "has been on a trio with X" (teammates are counted across
 * every mode, not per mode).
 */

export const SIZE = 4;
export const SQUARES = SIZE * SIZE;

/** The ten ways to win: four rows, four columns, two diagonals. */
export const LINES: number[][] = [
  ...Array.from({ length: SIZE }, (_, r) => Array.from({ length: SIZE }, (_, c) => r * SIZE + c)),
  ...Array.from({ length: SIZE }, (_, c) => Array.from({ length: SIZE }, (_, r) => r * SIZE + c)),
  Array.from({ length: SIZE }, (_, i) => i * SIZE + i),
  Array.from({ length: SIZE }, (_, i) => i * SIZE + (SIZE - 1 - i)),
];

export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Where the players come from (the user, 14 Oct 2026: "One is which is now
 * with amount of players, second is with time … players could repeat", and
 * "maybe even no timer"):
 *
 * - `deck`: a fixed deck, each player once, built so a full card is in it.
 * - `timed`: no deck. Players are drawn from the level's band until the clock
 *   runs out, leaning towards the squares still open (`drawNext`). One can come
 *   up again, never twice in a row.
 * - `endless`: the same stream with no clock.
 *
 * The clock is the component's. The engine is told the time (`tick`) and ends
 * a Timed round when it is up, so it stays pure and a check can play a
 * two-minute round in no time.
 */
export type Mode = 'deck' | 'timed' | 'endless';

/**
 * `bands` is who is dealt: the famous players on Easy, the regulars too on
 * Medium, anyone on Hard. `deck` is the Deck mode's size (the user, 14 Oct
 * 2026: "Decrease players, so have like 40-35-30"), and `seconds` the Timed
 * clock (their "60-90-120"): the easier the level, the longer the clock, so
 * Hard's unknown names come with the least time to place them. `lives` is how
 * many players put on a square they do not fit end the round, in every mode:
 * in a stream that never runs dry they are what stops tapping squares at
 * random from being free. `cover` is how many players in the deck fit every
 * square — the slack for a player put on one square who was also the answer
 * to another. `answers` is how many of the band every square must have, so
 * the deck can carry that many.
 */
export const LEVELS: Record<
  Difficulty,
  { answers: number; cover: number; lives: number; deck: number; seconds: number; bands: FameTier[] }
> = {
  easy: { answers: 4, cover: 3, lives: 3, deck: 40, seconds: 120, bands: ['easy'] },
  medium: { answers: 3, cover: 2, lives: 3, deck: 35, seconds: 90, bands: ['easy', 'medium'] },
  hard: { answers: 2, cover: 2, lives: 2, deck: 30, seconds: 60, bands: ['easy', 'medium', 'hard'] },
};

/**
 * The most squares one player from the level's band may fit. Without it one
 * name fitted seven to ten squares on most cards — EpikWhale, Bugha, K1nG —
 * the same "one name for everything" Tic Tac Toe had.
 */
export const MAX_REACH = 5;

export interface BingoSource extends CriteriaSource {
  /** For "10+ tournaments with X"; the squares simply do not appear without it. */
  teammates: Teammates | null;
  /** Everyone, to name the anchors of those squares. */
  roster: readonly RosterPlayer[];
}

/**
 * Every category a square can hold: the shared ones Tic Tac Toe uses, plus
 * Bingo's own from the user's list.
 */
export function bingoCriteria(source: BingoSource, minMatches: number): PlayerCriterion[] {
  const { players, facts, orgs, teammates, roster } = source;
  // Named anchors are told apart against the whole roster, as the guess box takes it.
  const out = buildCriteria({ ...source, everyone: roster }, { minMatches, maxShare: 0.6 });
  const add = (id: string, kind: CriterionKind, label: string, short: string, test: (p: RosterPlayer) => boolean) => {
    const matches = players.filter(test);
    if (matches.length >= minMatches && matches.length <= players.length * 0.6) {
      out.push({ id, kind, label, short, test, matches });
    }
  };

  for (const at of [1, 2, 10]) {
    add(
      `fncs-finals:${at}`,
      'fncs-finals',
      at === 1 ? 'has played an FNCS grand final' : `has played ${at}+ FNCS grand finals`,
      at === 1 ? 'Played an FNCS grand final' : `${at}+ FNCS grand finals`,
      (p) => facts.of(p.id).fncsApps >= at,
    );
  }

  const orgCount = new Map<string, number>();
  for (const org of orgs.orgs) for (const id of org.ever) orgCount.set(id, (orgCount.get(id) ?? 0) + 1);
  add('orgs:3', 'org-count', 'has played for 3+ organisations', 'Played for 3+ orgs', (p) => (orgCount.get(p.id) ?? 0) >= 3);

  // Regions of the regional finals played: an EU player who moved to NA.
  const regionsOf = (id: string) =>
    new Set(
      facts
        .of(id)
        .played.map((index) => facts.events[index])
        .filter((event) => event?.kind === 'fncs' && !event.lan && event.region)
        .map((event) => event.region),
    ).size;
  add('fncs-regions:2', 'fncs-regions', 'has played FNCS finals in 2+ regions', 'FNCS finals in 2+ regions', (p) => regionsOf(p.id) >= 2);

  // "Played the World Cup" is a shared rule since 14 Oct 2026 (criteria.ts).

  add(
    'fncs-partners:2',
    'fncs-partners',
    'has won an FNCS with 2+ different teammates',
    'Won FNCS with 2+ teammates',
    (p) => facts.fncsPartners(p.id).size >= 2,
  );

  /*
   * "Has played with Mongraal", as 10+ tournaments together: the teammates file
   * keeps each player's fifty most frequent partners, and nobody's fiftieth has
   * ten events with them, so at ten the list is complete and a right answer is
   * never refused. Anchored on the famous players only.
   *
   * The anchor is named the way "Won FNCS with X" names one — "Chap (United
   * States)" — when anyone else on the whole roster shares the handle, not
   * only someone in the level's band: three players are called Chap (the user,
   * 14 Oct 2026: "it should be specified which exactly").
   */
  if (teammates) {
    const byId = new Map(roster.map((player) => [player.id, player]));
    const ambiguous = ambiguousNames(roster);
    for (const anchor of roster.filter((player) => player.tier === 'easy')) {
      const mates = new Set(
        teammates
          .cluesFor(anchor.id, byId)
          .filter((clue) => clue.events >= 10)
          .map((clue) => clue.player.id),
      );
      const name = namedPlayer(anchor, ambiguous);
      add(
        `with:${anchor.id}`,
        'played-with',
        `has played 10+ tournaments with ${name}`,
        `10+ events with ${name}`,
        (p) => mates.has(p.id),
      );
    }
  }
  // "Won FNCS with X" sets its own floor of three partners; a square keeps the level's.
  return out.filter((rule) => rule.matches.length >= minMatches);
}

export interface Board {
  mode: Mode;
  squares: PlayerCriterion[];
  /** Deck mode: the players, in the order they are dealt. Some fit nothing: skip them. Empty in a stream. */
  deck: RosterPlayer[];
  /** The level's band, biggest earner first: who a stream draws from. */
  band: RosterPlayer[];
  /** For each of `band`, the squares they fit as bits (square i is bit i): the stream asks every deal. */
  fits: number[];
  /** Everyone in the band who fits each square, biggest earner first — for the reveal. */
  candidates: RosterPlayer[][];
  /** The seed the card was drawn with; a stream's players follow from it, so a round can be replayed. */
  seed: string;
}

/**
 * Picks 16 squares, then, in Deck mode, deals the deck.
 *
 * Rules are drawn one at a time, each kind weighted by one over the square
 * root of how many rules share it (so nine "Played <event>" rules do not fill
 * the card), at most two of a kind, never one nearly the same as a square
 * already on the card ("FNCS winner" beside "Won a major"), and never one that
 * would let a player fit more than `MAX_REACH` squares.
 *
 * The deck: players until every square has `cover` of them who fit it, then
 * anyone from the band — some fit nothing, and are there to be skipped —
 * shuffled. It is kept only if the whole card can be filled from it with
 * sixteen different players, and still can with any one player taken out: so
 * no single player is the only way to a square, and putting someone on the
 * "wrong" one of two squares they fit never makes the card impossible.
 *
 * A stream needs no such check: every square has `answers` players in the
 * band, and the stream keeps drawing from all of it.
 */
export function generateBoard(
  source: Omit<BingoSource, 'players'>,
  pools: { answers: readonly RosterPlayer[] },
  difficulty: Difficulty,
  seed: string = String(Date.now()),
  mode: Mode = 'deck',
): Board | null {
  const rng = makeRng(seed);
  const level = LEVELS[difficulty];
  const pool = bingoCriteria({ ...source, players: pools.answers }, level.answers);
  const perKind = new Map<string, number>();
  for (const rule of pool) perKind.set(rule.kind, (perKind.get(rule.kind) ?? 0) + 1);

  const finish = (squares: PlayerCriterion[], deck: RosterPlayer[]): Board => {
    const band = [...pools.answers].sort((a, b) => b.earnings - a.earnings);
    const fits = band.map((player) => squares.reduce((bits, square, index) => (square.test(player) ? bits | (1 << index) : bits), 0));
    const candidates = squares.map((_, index) => band.filter((_, i) => fits[i] & (1 << index)));
    return { mode, squares, deck, band, fits, candidates, seed };
  };

  for (let attempt = 0; attempt < 40; attempt++) {
    const squares = draw(rng, pool, perKind);
    // Two-per-kind and the near-duplicate rule can leave a draw short; another order may not.
    if (squares.length < SQUARES) continue;
    if (mode !== 'deck') return finish(squares, []);

    const deck = new Map<string, RosterPlayer>();
    const covered = (square: PlayerCriterion) => [...deck.values()].filter((player) => square.test(player)).length;
    for (const square of shuffle(rng, squares)) {
      for (const player of shuffle(rng, square.matches)) {
        if (covered(square) >= level.cover) break;
        deck.set(player.id, player);
      }
    }
    if (deck.size > level.deck) continue;
    for (const player of shuffle(rng, pools.answers)) {
      if (deck.size >= level.deck) break;
      deck.set(player.id, player);
    }
    const dealt = shuffle(rng, [...deck.values()]);
    if (!robust(squares, dealt)) continue;
    return finish(squares, dealt);
  }
  return null;
}

function draw(rng: Rng, pool: PlayerCriterion[], perKind: Map<string, number>): PlayerCriterion[] {
  // Weighted order: each rule's key is rng^(1/weight), highest first.
  const order = pool
    .map((rule) => ({ rule, key: rng() ** Math.sqrt(perKind.get(rule.kind)!) }))
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.rule);
  const picked: PlayerCriterion[] = [];
  const used = new Map<string, number>();
  // Squares each player in the band fits so far. `matches` is that band.
  const reach = new Map<string, number>();
  for (const rule of order) {
    if (picked.length === SQUARES) break;
    if ((used.get(rule.kind) ?? 0) >= 2) continue;
    if (rule.matches.some((player) => (reach.get(player.id) ?? 0) >= MAX_REACH)) continue;
    if (picked.some((other) => isNested(other, rule, NEAR_NESTED))) continue;
    picked.push(rule);
    used.set(rule.kind, (used.get(rule.kind) ?? 0) + 1);
    for (const player of rule.matches) reach.set(player.id, (reach.get(player.id) ?? 0) + 1);
  }
  return shuffle(rng, picked);
}

/**
 * Square -> the deck player who fills it in a full card, or null when the deck
 * cannot fill every square with a different player. A bipartite matching,
 * grown one augmenting path at a time — sixteen squares, so it is instant.
 */
export function fullCard(squares: PlayerCriterion[], deck: readonly RosterPlayer[]): Map<number, RosterPlayer> | null {
  const holder = new Map<string, number>(); // player id -> square
  const fits = squares.map((square) => deck.filter((player) => square.test(player)));
  const augment = (square: number, seen: Set<string>): boolean => {
    for (const player of fits[square]) {
      if (seen.has(player.id)) continue;
      seen.add(player.id);
      const other = holder.get(player.id);
      if (other === undefined || augment(other, seen)) {
        holder.set(player.id, square);
        return true;
      }
    }
    return false;
  };
  for (let square = 0; square < squares.length; square++) {
    if (!augment(square, new Set())) return null;
  }
  const out = new Map<number, RosterPlayer>();
  for (const player of deck) {
    const square = holder.get(player.id);
    if (square !== undefined) out.set(square, player);
  }
  return out;
}

/** A full card is possible, and stays possible with any one player of it taken out. */
export function robust(squares: PlayerCriterion[], deck: readonly RosterPlayer[]): boolean {
  const full = fullCard(squares, deck);
  if (!full) return false;
  return [...full.values()].every((player) => fullCard(squares, deck.filter((other) => other !== player)) !== null);
}

// ----------------------------------------------------------------- stream --

/**
 * The least share of a stream's players who fit an open square, by how many
 * squares are open: 0.75 / ∛open — three in four with one left, 60% with two,
 * 47% with four, 38% with eight, 30% with all sixteen. The user, 14 Oct 2026:
 * "when there is 1 category left, the players who fit are much more likely to
 * be there". Never all of them, so a skip is still a decision. Where the band
 * fits the card better than this by itself — the famous players on an Easy
 * card, early on — the stream is left as it is.
 */
export function fitShare(open: number): number {
  return open <= 0 ? 0 : Math.min(1, 0.75 / Math.cbrt(open));
}

/**
 * The next player of a Timed or Endless stream, never `previous`.
 *
 * With the chance `fitShare` gives (or the band's own share of players who fit
 * an open square, when that is higher), an open square is picked at random and
 * then someone in the band who fits it: so a square three players in the band
 * fit is fed as often as one three hundred fit, and the last square is not
 * left waiting on a rare name. Otherwise it is someone who fits no open
 * square. Players already on the card can come up again, and go on another
 * square they fit: on Hard a square may have only two answers in the band.
 */
export function drawNext(
  board: Board,
  filled: ReadonlyMap<number, RosterPlayer>,
  previous: RosterPlayer | null,
  rng: Rng,
): RosterPlayer | null {
  const openSquares = board.squares.map((_, index) => index).filter((index) => !filled.has(index));
  const open = openSquares.reduce((bits, index) => bits | (1 << index), 0);
  const hits: RosterPlayer[] = [];
  const misses: RosterPlayer[] = [];
  board.band.forEach((player, i) => {
    if (player.id !== previous?.id) (board.fits[i] & open ? hits : misses).push(player);
  });
  if (hits.length + misses.length === 0) return null;
  const share = Math.max(fitShare(openSquares.length), hits.length / (hits.length + misses.length));
  if (hits.length > 0 && (misses.length === 0 || rng() < share)) {
    for (const square of shuffle(rng, openSquares)) {
      const answers = board.candidates[square].filter((player) => player.id !== previous?.id);
      if (answers.length > 0) return pick(rng, answers);
    }
  }
  return pick(rng, misses.length > 0 ? misses : hits);
}

// ------------------------------------------------------------------- play --

export interface GameState {
  board: Board;
  difficulty: Difficulty;
  /** Square -> the player on it. */
  filled: Map<number, RosterPlayer>;
  /** How many players have been dealt and dealt with. */
  turn: number;
  /** The player on show. */
  showing: RosterPlayer | null;
  /** Players put on a square they do not fit, and where. */
  wrong: { player: RosterPlayer; square: number }[];
  skipped: number;
  /** Seconds since the first player, as `tick` was last told. */
  elapsed: number;
  status: 'playing' | 'over';
  gaveUp: boolean;
  /** Timed: the clock ran out. */
  timedOut: boolean;
}

export function createGame(board: Board, difficulty: Difficulty): GameState {
  const state: GameState = {
    board,
    difficulty,
    filled: new Map(),
    turn: 0,
    showing: null,
    wrong: [],
    skipped: 0,
    elapsed: 0,
    status: 'playing',
    gaveUp: false,
    timedOut: false,
  };
  const showing = deal(state);
  return { ...state, showing, status: showing ? 'playing' : 'over' };
}

/** The player for `state.turn`: the deck's next, or a stream's draw, seeded by the card and the turn. */
function deal(state: GameState): RosterPlayer | null {
  const { board } = state;
  if (board.mode === 'deck') return board.deck[state.turn] ?? null;
  return drawNext(board, state.filled, state.showing, makeRng(`${board.seed}:${state.turn}`));
}

/** The player on show, or null once the round is over. */
export function current(state: GameState): RosterPlayer | null {
  return state.status === 'playing' ? state.showing : null;
}

export function livesLeft(state: GameState): number {
  return Math.max(0, LEVELS[state.difficulty].lives - state.wrong.length);
}

/** Seconds left on a Timed clock; null in the modes without one. */
export function timeLeft(state: GameState): number | null {
  return state.board.mode === 'timed' ? Math.max(0, LEVELS[state.difficulty].seconds - state.elapsed) : null;
}

/**
 * The clock, as the component reads it: seconds since the first player. A
 * Timed round ends when it reaches the level's limit; the other modes only
 * keep it. A full card placed before the tick that would have ended it still
 * counts: the component ticks before every move, so a move after the time is
 * refused.
 */
export function tick(state: GameState, elapsed: number): GameState {
  if (state.status !== 'playing') return state;
  const next = { ...state, elapsed: Math.max(state.elapsed, elapsed) };
  return timeLeft(next) === 0 ? { ...next, status: 'over', timedOut: true } : next;
}

/** The lines complete so far. */
export function lines(state: GameState): number[][] {
  return LINES.filter((line) => line.every((square) => state.filled.has(square)));
}

/** Open squares this player fits. */
export function fitting(state: GameState, player: RosterPlayer): number[] {
  return state.board.squares
    .map((square, index) => (!state.filled.has(index) && square.test(player) ? index : -1))
    .filter((index) => index >= 0);
}

export type Placement = { kind: 'placed'; square: number } | { kind: 'wrong'; square: number; fits: number[] };

/** The next player, or the end: the card full, the lives gone, or the deck done. */
function advance(state: GameState): GameState {
  const next = { ...state, turn: state.turn + 1 };
  if (next.filled.size === SQUARES || livesLeft(next) === 0) return { ...next, status: 'over' };
  const showing = deal(next);
  return { ...next, showing, status: showing ? 'playing' : 'over' };
}

/**
 * Puts the player on show on a square. One who fits it marks it; one who does
 * not costs a life, and either way the next player comes up.
 */
export function place(state: GameState, square: number): { state: GameState; outcome: Placement } | null {
  const player = current(state);
  if (!player || state.filled.has(square)) return null;
  if (state.board.squares[square].test(player)) {
    const filled = new Map(state.filled).set(square, player);
    return { state: advance({ ...state, filled }), outcome: { kind: 'placed', square } };
  }
  const fits = fitting(state, player);
  return {
    state: advance({ ...state, wrong: [...state.wrong, { player, square }] }),
    outcome: { kind: 'wrong', square, fits },
  };
}

/** Passes on the player on show. Free, but on Timed the clock keeps running. */
export function skip(state: GameState): GameState {
  return current(state) ? advance({ ...state, skipped: state.skipped + 1 }) : state;
}

export function giveUp(state: GameState): GameState {
  return state.status === 'playing' ? { ...state, status: 'over', gaveUp: true } : state;
}

/** A few answers for an open square, biggest earners first, not already on the card. */
export function solutionFor(state: GameState, square: number): RosterPlayer[] {
  const used = new Set([...state.filled.values()].map((player) => player.id));
  return state.board.candidates[square].filter((player) => !used.has(player.id)).slice(0, 3);
}

/** Only a full card wins. */
export function outcomeOf(state: GameState): Outcome {
  if (state.filled.size === SQUARES) return 'won';
  return state.gaveUp ? 'gave-up' : 'lost';
}

/**
 * What a full card is worth, lower better: on Timed the seconds it took (to a
 * tenth), otherwise the players it took. Null short of a full card — only a
 * full card sets a best, kept per mode and level.
 */
export function score(state: GameState): number | null {
  if (state.filled.size < SQUARES) return null;
  return state.board.mode === 'timed' ? Math.round(state.elapsed * 10) / 10 : state.turn;
}

export function record(state: GameState): { outcome: Outcome; r: GamePayloads['bingo'] } {
  return {
    outcome: outcomeOf(state),
    r: {
      squares: state.board.squares.map((square) => ({ id: square.id, name: square.short })),
      placed: [...state.filled].map(([square, player]) => ({ square, player: ref(player) })),
      wrong: state.wrong.map(({ player, square }) => ({ square, player: ref(player) })),
      dealt: state.turn,
      // A stream has no deck: 0, and the mode is in the round's setup.
      deck: state.board.deck.length,
      lines: lines(state).length,
    },
  };
}
