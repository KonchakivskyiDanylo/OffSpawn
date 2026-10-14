import { ref, type GamePayloads, type Outcome } from '@/analytics/types';
import type { FameTier, RosterPlayer } from '@/data/liquipedia/roster';
import { makeRng, type Rng } from '@/lib/rng';
import {
  buildCriteria,
  hasNestedPair,
  intersect,
  intersects,
  isNested,
  NEAR_NESTED,
  type CriteriaSource,
  type PlayerCriterion,
} from '@/games/shared/criteria';

export { NEAR_NESTED };

/** Pure logic for the 3x3 grid game. */

export const SIZE = 3;
/**
 * How many candidate boards to try per pass. 600 was enough until orgs.json
 * folded "NRG Esports" into NRG (3 Oct 2026): the org rules shifted, and one
 * board in six on Medium ran out of tries and fell back to near-identical axes.
 * A pass that finds a board stops early, so this only costs time on the rare
 * hard seed.
 */
const GENERATION_ATTEMPTS = 1500;

/**
 * The one setting the game has.
 *
 * It used to have two — a fame band from the shared pool picker and an
 * Easy/Hard ruleset under it — and the fame band did something no player would
 * guess: it also narrowed who you could *type*. On Hard the search box held
 * only the four thousand least-known players, so naming Bugha for a cell he
 * obviously fits was impossible. Now the level decides what the board is
 * built around and how forgiving the rules are, and any valid player is
 * accepted at every level.
 */
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * What a board at each level promises.
 *
 * `answers` is how many players from the level's fame band every cell must
 * have — three household names per cell on Easy, so there is always one you
 * know, and a single answer from anywhere on Hard.
 *
 * `lives` is how many wrong answers end the board. Hard used to give "nine
 * guesses, one per cell", which is one life said the long way round: the
 * first wrong guess left eight for nine cells.
 *
 * `reach` is the most cells any one player may fit. Without it the board was
 * often solved by one name: on 15 of 80 Easy boards EpikWhale, Bugha or
 * Peterbot fitted all nine cells, and someone fitted six on 48 more. Easy's
 * pool is only the hundred-odd famous players, who share most achievements,
 * so four is as tight as it can reliably go there.
 */
export const LEVELS: Record<Difficulty, { answers: number; lives: number; reach: number }> = {
  easy: { answers: 3, lives: 3, reach: 4 },
  medium: { answers: 2, lives: 3, reach: 3 },
  hard: { answers: 1, lives: 1, reach: 2 },
};

export interface Board {
  rows: PlayerCriterion[];
  cols: PlayerCriterion[];
  /**
   * Every accepted player per cell, indexed [row][col], biggest earner first.
   *
   * Drawn from the whole accepted pool rather than the fame band the board was
   * built around, because it is what `canComplete` reasons over: a board that
   * only knew the famous answers would refuse moves an obscure answer makes
   * perfectly safe.
   */
  candidates: RosterPlayer[][][];
}

export interface BoardPools {
  /** The fame band the board is built around — every cell has answers here. */
  answers: readonly RosterPlayer[];
  /** Everyone the guess box accepts. */
  accepted: readonly RosterPlayer[];
}

export interface GameState {
  board: Board;
  difficulty: Difficulty;
  /** Filled cells keyed "row,col". */
  filled: Map<string, RosterPlayer>;
  mistakes: number;
  /** Every player submitted, right or wrong. */
  guesses: number;
  status: 'playing' | 'won' | 'lost';
}

export const cellKey = (row: number, col: number) => `${row},${col}`;

/** The fame bands each level's board is built around, widest last. */
export const BANDS: Record<Difficulty, FameTier[]> = {
  easy: ['easy'],
  medium: ['easy', 'medium'],
  hard: ['easy', 'medium', 'hard'],
};

/**
 * Builds a board whose every cell has enough answers from the level's fame
 * band AND where all nine cells can be filled with nine *different* players —
 * otherwise the "each player once" rule could make a generated board
 * unwinnable.
 *
 * The rules are built against `pools.answers`, so "has played for FaZe" on an
 * Easy board is a question about the famous FaZe players, and the guess box
 * then takes anyone in `pools.accepted` who fits.
 *
 * `recent` is the rules of the last few boards this player saw, newest first.
 * They are left out when a board can be built without them — all of them, or
 * failing that the last board's — so two boards in a row do not ask the same
 * questions.
 */
export function generateBoard(
  source: Omit<CriteriaSource, 'players'>,
  pools: BoardPools,
  difficulty: Difficulty,
  seed: string = String(Date.now()),
  recent: readonly string[] = [],
): Board | null {
  const pool = boardRules(source, pools, difficulty);
  if (pool.length < SIZE * 2) return null;
  const weights = kindWeights(pool);
  const level = LEVELS[difficulty];
  const avoids = [new Set(recent), new Set(recent.slice(0, SIZE * 2))].filter(
    (avoid, index, all) => avoid.size > 0 && (index === 0 || avoid.size < all[0].size),
  );

  // Every promise first, then give way one at a time rather than showing an
  // error: the recent rules, then redundant-looking axes, then the reach cap,
  // and only then fewer answers per cell. A small field — an event mode on
  // Easy — may not have three answers per cell anywhere, and a board with two
  // beats "cannot start".
  for (let answers = level.answers; answers >= 1; answers--) {
    for (const reach of [level.reach, SIZE * SIZE]) {
      const tries = { answers, reach, weights };
      const found =
        avoids.reduce<Board | null>(
          (board, avoid, index) => board ?? attemptBoards(pool, `${seed}:${index}`, { ...tries, strict: true, avoid }),
          null,
        ) ??
        attemptBoards(pool, `${seed}:any`, { ...tries, strict: true }) ??
        attemptBoards(pool, `${seed}:relaxed`, { ...tries, strict: false });
      if (found) return { ...found, candidates: acceptedPerCell(found, pools.accepted) };
    }
  }
  return null;
}

/**
 * The rules a board may use, built against the level's fame band. Hard also
 * draws on the deep rules — Div Cups, Performance Evaluations, a year's prize
 * money — which the Easy and Medium boards never ask.
 */
export function boardRules(
  source: Omit<CriteriaSource, 'players'>,
  pools: BoardPools,
  difficulty?: Difficulty,
): PlayerCriterion[] {
  return buildCriteria(
    { ...source, players: pools.answers, everyone: pools.accepted },
    { minMatches: 5, maxShare: 0.45, deep: difficulty === 'hard' },
  );
}

/**
 * A board from its rules' ids — how the daily puzzle rebuilds the grid it was
 * given. Null when the data no longer makes one of the six rules.
 */
export function boardFrom(
  source: Omit<CriteriaSource, 'players'>,
  pools: BoardPools,
  rows: readonly string[],
  cols: readonly string[],
  difficulty?: Difficulty,
): Board | null {
  const byId = new Map(boardRules(source, pools, difficulty).map((rule) => [rule.id, rule]));
  const axis = (ids: readonly string[]) => ids.map((id) => byId.get(id));
  const [r, c] = [axis(rows), axis(cols)];
  if (r.length !== SIZE || c.length !== SIZE || [...r, ...c].some((rule) => !rule)) return null;
  const board = { rows: r as PlayerCriterion[], cols: c as PlayerCriterion[] };
  return { ...board, candidates: acceptedPerCell(board, pools.accepted) };
}

/** What the grid builder (`/analytics/grid`) says about a hand-made board. */
export interface Inspection {
  /** [row][col]: the level's fame band who fit, biggest earner first. */
  answers: RosterPlayer[][][];
  /** [row][col]: everyone the guess box takes who fits. */
  accepted: number[][];
  /** The most cells one player fits, and who. */
  reach: { cells: number; player: string | null };
  /** Rule pairs where one (nearly) implies the other — `NEAR_NESTED`. */
  nested: [string, string][];
  /** Kinds used more than twice. */
  crowded: string[];
  /** Whether nine different players can fill it, from the band and from anyone. */
  distinct: { band: boolean; anyone: boolean };
  /** Each promise the generator holds a board to at this level, kept or not. */
  problems: string[];
}

/**
 * Checks a board someone chose by hand against everything `generateBoard`
 * promises at `difficulty`: the answers per cell, the reach cap, no
 * (near-)nested pair, at most two of a kind, and nine different players. A
 * board with problems can still be played; the builder says what they are.
 */
export function inspectBoard(
  board: Pick<Board, 'rows' | 'cols'>,
  pools: BoardPools,
  difficulty: Difficulty,
): Inspection {
  const level = LEVELS[difficulty];
  const ranked = (players: RosterPlayer[]) => [...players].sort((a, b) => b.earnings - a.earnings);
  const answers = board.rows.map((row) => board.cols.map((col) => ranked(intersect(row, col))));
  const everyone = acceptedPerCell(board, pools.accepted);

  const fits = new Map<string, number>();
  for (const row of board.rows) {
    for (const col of board.cols) {
      for (const player of intersect(row, col)) fits.set(player.name, (fits.get(player.name) ?? 0) + 1);
    }
  }
  const [top] = [...fits].sort((a, b) => b[1] - a[1]);
  const reach = { cells: top?.[1] ?? 0, player: top?.[0] ?? null };

  const all = [...board.rows, ...board.cols];
  const nested: [string, string][] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (isNested(all[i], all[j], NEAR_NESTED)) nested.push([all[i].short, all[j].short]);
    }
  }
  const kinds = new Map<string, number>();
  for (const rule of all) kinds.set(rule.kind, (kinds.get(rule.kind) ?? 0) + 1);
  const crowded = [...kinds].filter(([, n]) => n > 2).map(([kind]) => kind);
  const distinct = { band: hasDistinctSolution(answers), anyone: hasDistinctSolution(everyone) };

  const problems: string[] = [];
  const ids = all.map((rule) => rule.id);
  if (new Set(ids).size < ids.length) problems.push('A rule is used twice.');
  const thin = answers.flat().filter((cell) => cell.length < level.answers).length;
  if (thin) problems.push(`${thin} cell${thin === 1 ? ' has' : 's have'} fewer than ${level.answers} answers from this level's players.`);
  if (reach.cells > level.reach) problems.push(`${reach.player} fits ${reach.cells} cells; this level allows ${level.reach}.`);
  for (const [a, b] of nested) problems.push(`"${a}" and "${b}" are nearly the same rule.`);
  for (const kind of crowded) problems.push(`More than two rules of one kind (${kind}).`);
  if (!distinct.anyone) problems.push('Nine different players cannot fill it.');
  else if (!distinct.band) problems.push("Nine different players fill it, but not from this level's players alone.");
  return { answers, accepted: everyone.map((line) => line.map((cell) => cell.length)), reach, nested, crowded, distinct, problems };
}

/**
 * The most cells one player fits: the rows they fit times the columns.
 *
 * Counted over the rules' own matches — the level's fame band, which on every
 * level includes the famous players this is about.
 */
export function maxReach(board: Pick<Board, 'rows' | 'cols'>): number {
  const count = (axes: PlayerCriterion[]) => {
    const out = new Map<string, number>();
    for (const axis of axes) {
      for (const player of axis.matches) out.set(player.id, (out.get(player.id) ?? 0) + 1);
    }
    return out;
  };
  const rows = count(board.rows);
  const cols = count(board.cols);
  let most = 0;
  for (const [id, fits] of rows) most = Math.max(most, fits * (cols.get(id) ?? 0));
  return most;
}

/**
 * How likely each rule is to be drawn: one over the square root of how many
 * rules share its kind.
 *
 * A plain draw asked "Played <event>" on nearly every board, because there are
 * nine headline events and only one "LAN winner". Fully even kinds would swing
 * the other way and put "LAN winner" everywhere; the square root is between.
 */
function kindWeights(pool: PlayerCriterion[]): Map<string, number> {
  const perKind = new Map<string, number>();
  for (const rule of pool) perKind.set(rule.kind, (perKind.get(rule.kind) ?? 0) + 1);
  return new Map(pool.map((rule) => [rule.id, 1 / Math.sqrt(perKind.get(rule.kind)!)]));
}

/** `count` distinct rules, drawn by `weights`. */
function draw(rng: Rng, rules: PlayerCriterion[], count: number, weights: Map<string, number>): PlayerCriterion[] {
  const left = [...rules];
  const out: PlayerCriterion[] = [];
  while (out.length < count && left.length > 0) {
    let at = rng() * left.reduce((sum, rule) => sum + weights.get(rule.id)!, 0);
    let index = 0;
    while (index < left.length - 1 && (at -= weights.get(left[index].id)!) > 0) index++;
    out.push(left.splice(index, 1)[0]);
  }
  return out;
}

/** Everyone in `accepted` who fits each cell, biggest earner first. */
function acceptedPerCell(
  board: Pick<Board, 'rows' | 'cols'>,
  accepted: readonly RosterPlayer[],
): RosterPlayer[][][] {
  const ranked = [...accepted].sort((a, b) => b.earnings - a.earnings);
  return board.rows.map((row) =>
    board.cols.map((col) => ranked.filter((player) => row.test(player) && col.test(player))),
  );
}

/**
 * Builds a board by construction rather than by guessing.
 *
 * Picking six criteria at random and checking all nine cells afterwards used
 * to work, and stopped once the criteria came from the Liquipedia export: of
 * the 276 rules it produces over a typical pool, 138 are organisations, and
 * two organisations almost never share a player. A random six therefore
 * contained an empty cell nearly every time — 36 of 40 seeds produced nothing
 * at all.
 *
 * So the columns are chosen from the criteria that already intersect all three
 * rows. Every cell is non-empty because it was never allowed to be otherwise,
 * and the only check left to fail is whether nine *different* players can fill
 * it.
 */
function attemptBoards(
  all: PlayerCriterion[],
  seed: string,
  {
    strict,
    answers,
    reach,
    weights,
    avoid,
  }: {
    strict: boolean;
    answers: number;
    /** The most cells one player may fit. */
    reach: number;
    weights: Map<string, number>;
    /** Rules to leave out. */
    avoid?: ReadonlySet<string>;
  },
): Board | null {
  const rng = makeRng(seed);
  const pool = avoid ? all.filter((rule) => !avoid.has(rule.id)) : all;

  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt++) {
    const rows = draw(rng, pool, SIZE, weights);
    // A board of three "played at X" rows is a dull puzzle before it is a hard
    // one, so reject the shape early — before the expensive part below.
    if (strict && !isVaried(rows)) continue;

    const usable = pool.filter(
      (candidate) =>
        !rows.some((row) => row.id === candidate.id) &&
        rows.every((row) => intersects(row, candidate)),
    );
    if (usable.length < SIZE) continue;

    const cols = draw(rng, usable, SIZE, weights);
    const picked = [...rows, ...cols];
    if (strict) {
      if (!isVaried(picked)) continue;
      // A row that implies a column ("3+ titles" vs "2+ titles") is redundant,
      // and so is one that nearly does ("Won NA FNCS" vs "North America").
      if (hasNestedPair(picked, NEAR_NESTED)) continue;
    }
    // No one name for the whole board.
    if (maxReach({ rows, cols }) > reach) continue;

    const candidates: RosterPlayer[][][] = rows.map((row) =>
      cols.map((col) => intersect(row, col)),
    );
    if (candidates.some((line) => line.some((cell) => cell.length < answers))) continue;
    if (!hasDistinctSolution(candidates)) continue;

    return { rows, cols, candidates };
  }
  return null;
}

/** No more than two axes may come from the same kind of criterion. */
function isVaried(criteria: PlayerCriterion[]): boolean {
  const counts = new Map<string, number>();
  for (const criterion of criteria) {
    const next = (counts.get(criterion.kind) ?? 0) + 1;
    if (next > 2) return false;
    counts.set(criterion.kind, next);
  }
  return true;
}

/**
 * Can all nine cells be filled with nine different players?
 * Backtracking over the most constrained cells first — the grid is tiny, so
 * this is instant.
 */
function hasDistinctSolution(candidates: RosterPlayer[][][]): boolean {
  return canComplete(candidates, new Map());
}

/**
 * Can the cells still empty in `filled` be completed with players nobody has
 * used yet? Used both to vet a fresh board and to keep a board winnable while
 * it is being played.
 */
function canComplete(candidates: RosterPlayer[][][], filled: Map<string, RosterPlayer>): boolean {
  const used = new Set([...filled.values()].map((player) => player.id));
  const cells: string[][] = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (filled.has(cellKey(r, c))) continue;
      const options = candidates[r][c].map((player) => player.id).filter((id) => !used.has(id));
      if (options.length === 0) return false;
      cells.push(options);
    }
  }
  cells.sort((a, b) => a.length - b.length);

  const solve = (depth: number): boolean => {
    if (depth === cells.length) return true;
    for (const id of cells[depth]) {
      if (used.has(id)) continue;
      used.add(id);
      if (solve(depth + 1)) return true;
      used.delete(id);
    }
    return false;
  };
  return solve(0);
}

export function createGame(board: Board, difficulty: Difficulty): GameState {
  return { board, difficulty, filled: new Map(), mistakes: 0, guesses: 0, status: 'playing' };
}

export function livesLeft(state: GameState): number {
  return Math.max(0, LEVELS[state.difficulty].lives - state.mistakes);
}

export interface Cell {
  row: number;
  col: number;
}

/**
 * What submitting a player did.
 *
 * `choose` is the only outcome that needs the user again — everything else
 * either landed or did not.
 */
export type Submission =
  | { kind: 'placed'; cell: Cell }
  | { kind: 'choose'; cells: Cell[] }
  | { kind: 'rejected' }
  | { kind: 'already-used' }
  | { kind: 'deadlock'; cell: Cell };

/** Empty cells this player satisfies, ignoring who else could go there. */
function fittingCells(state: GameState, player: RosterPlayer): Cell[] {
  const cells: Cell[] = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (state.filled.has(cellKey(row, col))) continue;
      if (state.board.rows[row].test(player) && state.board.cols[col].test(player)) {
        cells.push({ row, col });
      }
    }
  }
  return cells;
}

/**
 * Submits a typed player and resolves where they go.
 *
 * The board no longer asks you to pick a cell first. You name a player and the
 * grid works out where they belong, because in all but a handful of cases
 * there is only one answer to that and making someone click it was busywork.
 *
 * The cells a player is offered are the ones they fit *and* that leave every
 * other empty cell still fillable with players nobody has used. That second
 * test used to run after you chose: Koyota fitted two cells, you were asked
 * which, and the one you tapped was refused with "would leave another cell
 * impossible" — a question with a wrong answer the game already knew. A cell
 * that strands another is now never offered, so when only one cell is safe
 * the player goes straight there.
 *
 * That also covers what the old sole-answer rule did: if you are the last
 * person who fits a cell, putting you anywhere else strands it, so that cell
 * is the only safe one.
 *
 * A player who fits always has at least one safe cell. The board is
 * completable before the move, so some assignment fills every empty cell with
 * distinct players. If it uses this player, the cell it gives them is safe; if
 * it does not, every cell they fit is, because they can take that cell's
 * place in it. `deadlock` is kept as the guard on `place`, not as a path play
 * reaches.
 */
export function submit(
  state: GameState,
  player: RosterPlayer,
): { state: GameState; outcome: Submission } {
  if (state.status !== 'playing') return { state, outcome: { kind: 'rejected' } };

  for (const used of state.filled.values()) {
    if (used.id === player.id) return { state, outcome: { kind: 'already-used' } };
  }

  const fits = fittingCells(state, player);
  if (fits.length === 0) return { state: charge(state, false), outcome: { kind: 'rejected' } };

  const safe = fits.filter((cell) => keepsBoardWinnable(state, cell, player));
  if (safe.length === 0) return { state, outcome: { kind: 'deadlock', cell: fits[0] } };
  if (safe.length === 1) return place(state, safe[0], player);
  return { state, outcome: { kind: 'choose', cells: safe } };
}

/** Whether every other empty cell can still be filled once `player` sits in `cell`. */
function keepsBoardWinnable(state: GameState, cell: Cell, player: RosterPlayer): boolean {
  const filled = new Map(state.filled).set(cellKey(cell.row, cell.col), player);
  return filled.size === SIZE * SIZE || canComplete(state.board.candidates, filled);
}

/**
 * Commits a player to a cell they are known to fit.
 *
 * Exported for the ambiguous case, where the user picked the cell themselves.
 */
export function place(
  state: GameState,
  cell: Cell,
  player: RosterPlayer,
): { state: GameState; outcome: Submission } {
  // `submit` only ever offers safe cells, so this guards the export rather
  // than a path play can reach: a move that strands another cell is refused,
  // and it costs nothing.
  if (!keepsBoardWinnable(state, cell, player)) {
    return { state, outcome: { kind: 'deadlock', cell } };
  }
  const filled = new Map(state.filled).set(cellKey(cell.row, cell.col), player);

  const next = charge({ ...state, filled }, true);
  return {
    state: { ...next, status: filled.size === SIZE * SIZE ? 'won' : next.status },
    outcome: { kind: 'placed', cell },
  };
}

/** Books a guess, and ends the round when a wrong one spends the last life. */
function charge(state: GameState, correct: boolean): GameState {
  const guesses = state.guesses + 1;
  const mistakes = state.mistakes + (correct ? 0 : 1);
  const out = { ...state, guesses, mistakes };
  return mistakes >= LEVELS[state.difficulty].lives ? { ...out, status: 'lost' } : out;
}

/** Ends the round unsolved, so the remaining cells can be revealed. */
export function giveUp(state: GameState): GameState {
  return state.status === 'playing' ? { ...state, status: 'lost' } : state;
}

/**
 * A few valid answers per empty cell, for the reveal after a loss.
 *
 * The biggest earners rather than a random three: the reveal is where you
 * learn the answer you should have known, and three at random from a cell with
 * three hundred players in it were nearly always three nobody had heard of.
 */
export function solutionFor(state: GameState, row: number, col: number): RosterPlayer[] {
  const usedIds = new Set([...state.filled.values()].map((player) => player.id));
  return state.board.candidates[row][col].filter((player) => !usedIds.has(player.id)).slice(0, 3);
}

/**
 * The board as the analytics record it: the six rules and who went where.
 * Cells are counted by the pair of rules, not the position, so "Won EU FNCS ×
 * FaZe" adds up across every board it appears on.
 */
export function record(state: GameState): { outcome: Outcome; r: GamePayloads['tic-tac-toe'] } {
  const outOfGuesses = livesLeft(state) === 0;
  const rule = (criterion: PlayerCriterion) => ({ id: criterion.id, name: criterion.short });
  return {
    outcome: state.status === 'won' ? 'won' : outOfGuesses ? 'lost' : 'gave-up',
    r: {
      rows: state.board.rows.map(rule),
      cols: state.board.cols.map(rule),
      placed: [...state.filled].map(([key, player]) => {
        const [row, col] = key.split(',').map(Number);
        return { row, col, player: ref(player) };
      }),
      mistakes: state.mistakes,
    },
  };
}

/**
 * A grid made by hand in the builder (`/analytics/grid`): its six rules by id
 * and the level it was checked at. The builder's Play link carries one as
 * `?grid=` on the game's page, on a dev server only.
 */
export interface GridSpec {
  rows: string[];
  cols: string[];
  level: Difficulty;
}

export function readGridSpec(text: string | null): GridSpec | null {
  if (!text) return null;
  try {
    const spec = JSON.parse(text) as Partial<GridSpec>;
    const ids = (value: unknown) => Array.isArray(value) && value.length === SIZE && value.every((id) => typeof id === 'string');
    if (!ids(spec.rows) || !ids(spec.cols) || !spec.level || !(spec.level in LEVELS)) return null;
    return { rows: spec.rows!, cols: spec.cols!, level: spec.level };
  } catch {
    return null;
  }
}
