import {
  GAME_IDS,
  type FunnelCount,
  type FunnelStep,
  type GameId,
  type GamePayloads,
  type Outcome,
  type RoundRecord,
  type Setup,
  type Stored,
} from './types';

/**
 * Stored rounds -> the numbers on `/analytics`.
 *
 * Pure, and run on the server at request time, so the dashboard is always
 * live and there is no second copy of the data to keep in step. Every record
 * is read defensively: an old build or a hand-crafted POST can send anything,
 * and one bad row must cost that row, not the page.
 *
 * What each game reports follows the list of questions the dashboard was
 * built to answer — see the comment on each section.
 */

// ------------------------------------------------------------------ shapes --

export interface Count {
  label: string;
  count: number;
}

/**
 * Where a round's players came from — the first question about how the site
 * is played.
 *
 *   random   the shared picker on Random, the default
 *   chosen   the shared picker on Choose: a region and a difficulty
 *   event    an event field was in force (the site-wide event mode)
 *   own      a game with no shared picker — Higher or Lower, Tic Tac Toe,
 *            Tenaball, List — on the whole roster, set up by its own level
 *            or category
 *   daily    the day's puzzle, the same for everyone (`setup.daily` is the day)
 */
export type Source = 'daily' | 'random' | 'chosen' | 'event' | 'own';
export const SOURCES: Source[] = ['daily', 'random', 'chosen', 'event', 'own'];

export function sourceOf(setup: Setup | undefined): Source {
  if (setup?.daily) return 'daily';
  if (setup?.event) return 'event';
  if (setup?.pick === 'random') return 'random';
  if (setup?.pick === 'custom') return 'chosen';
  return 'own';
}

/** The region a Chosen round narrowed to — `all` for Choose with no region — or null. */
function regionOf(setup: Setup | undefined): string | null {
  return sourceOf(setup) === 'chosen' ? (setup?.region ?? 'all') : null;
}

/** The fame band a Chosen round narrowed to, or null. Random always reads `any`, which says nothing. */
function difficultyOf(setup: Setup | undefined): string | null {
  return sourceOf(setup) === 'chosen' ? (setup?.difficulty ?? null) : null;
}

/**
 * How a set of rounds was set up, one tally per question.
 *
 * Every tally is over the rounds the question applies to: `regions` and
 * `difficulty` over Chosen rounds only, `events` over event rounds, `level`
 * over rounds that had one. Labels are the raw values (`europe`, `easy`,
 * `globals-2026`); the page names them.
 */
export interface Mix {
  rounds: number;
  /** In `SOURCES` order, zeros kept, so the four always line up. */
  source: Count[];
  events: Count[];
  regions: Count[];
  difficulty: Count[];
  /** A game's own Easy / Medium / Hard, and the level Fortnitedle played a round at. */
  level: Count[];
  /** A game's own mode: Order / Random, Exact / Direction… */
  mode: Count[];
  /** Higher or Lower's category. */
  category: Count[];
}

export interface GameOverview {
  game: GameId;
  rounds: number;
  outcomes: Record<Outcome, number>;
  mix: Mix;
}

// ----------------------------------------------------------------- filters --

/**
 * What the dashboard can be narrowed to. Every field is optional and they
 * combine: "Fortnitedle, Chosen, Europe, lost" is one filter.
 */
export interface Filter {
  game?: GameId;
  source?: Source;
  event?: string;
  /** A Chosen round's region, or `all` for Choose with every region. */
  region?: string;
  /** A Chosen round's difficulty. */
  difficulty?: string;
  level?: string;
  outcome?: Outcome;
}

export const FILTER_KEYS = ['game', 'source', 'event', 'region', 'difficulty', 'level', 'outcome'] as const;

/** A filter from a query string, dropping anything that is not a value the field can take. */
export function parseFilter(params: URLSearchParams): Filter {
  const filter: Filter = {};
  const text = (key: string) => {
    const value = params.get(key);
    return value && value.length <= 80 ? value : undefined;
  };
  const game = text('game');
  if (game && (GAME_IDS as readonly string[]).includes(game)) filter.game = game as GameId;
  const source = text('source');
  if (source && (SOURCES as string[]).includes(source)) filter.source = source as Source;
  const outcome = text('outcome');
  if (outcome && (OUTCOMES as string[]).includes(outcome)) filter.outcome = outcome as Outcome;
  for (const key of ['event', 'region', 'difficulty', 'level'] as const) {
    const value = text(key);
    if (value) filter[key] = value;
  }
  return filter;
}

export function matches(body: RoundRecord, filter: Filter): boolean {
  const setup = body.setup;
  if (filter.game && body.game !== filter.game) return false;
  if (filter.source && sourceOf(setup) !== filter.source) return false;
  if (filter.event && setup?.event !== filter.event) return false;
  if (filter.region && regionOf(setup) !== filter.region) return false;
  if (filter.difficulty && difficultyOf(setup) !== filter.difficulty) return false;
  if (filter.level && setup?.level !== filter.level) return false;
  if (filter.outcome && body.outcome !== filter.outcome) return false;
  return true;
}

/** Fortnitedle and Guess the Player: how each secret player went. */
export interface SecretRow {
  id: string;
  name: string;
  plays: number;
  solved: number;
  /** Over solved rounds only. */
  avgGuesses: number | null;
}

/** Career Path and Who Are Ya: the same, plus which clue did it. */
export interface ClueRow extends SecretRow {
  /** Over solved rounds: how many clues were showing. */
  avgClues: number | null;
  /**
   * Per clue: how many rounds were solved right after it, and how many
   * reached it at all. "2024 Globals 30/32" is solved 30 of 32 reached.
   */
  clues: { name: string; solved: number; skipped: number; wrong: number; reached: number }[];
  /** Wrong guesses made on this secret, most common first — who they get mistaken for. */
  mistakenFor: Count[];
}

/** Tenaball and List: one row per board or list. */
export interface BoardRow {
  id: string;
  name: string;
  plays: number;
  /** Mean share of the answers found, 0–1 — the difficulty. */
  avgShare: number;
  /** Rounds where everything was found: 10/10, or a cleared list. */
  perfect: number;
  gaveUp: number;
  /** Per answer: rounds it was found in, of rounds it was on the board. */
  answers: { name: string; found: number; seen: number }[];
  /** Tenaball only: wrong answers typed, most common first. */
  wrong: Count[];
}

export interface RuleRow {
  id: string;
  name: string;
  plays: number;
  won: number;
}

/** Griefer: a player misread under one rule. */
export interface Misread {
  rule: string;
  player: string;
  /** Whether they actually fit the rule. */
  fits: boolean;
  shown: number;
  /** Picked when they did not fit, or left when they did. */
  wrong: number;
}

/** Tic Tac Toe: one pair of rules. */
export interface CellRow {
  name: string;
  plays: number;
  filled: number;
  answers: Count[];
}

export interface GroupRow {
  name: string;
  plays: number;
  solved: number;
}

export interface PairRow {
  category: string;
  shown: string;
  hidden: string;
  seen: number;
  correct: number;
}

export interface RunRow {
  category: string;
  level: string;
  runs: number;
  avgScore: number;
  best: number;
}

/** One slice's way from arriving to a finished round. */
export interface FunnelTotals {
  /** Page loads — someone arriving, from a link, a bookmark or a reload. */
  visits: number;
  /** Game pages opened; the home page is not counted. */
  opens: number;
  /** Game-page opens that led to at least one round. */
  engaged: number;
  /** Rounds started: a deal in unlimited play, the first move on a daily. */
  starts: number;
  /** Rounds finished — the recorded rounds. */
  finished: number;
  /**
   * Of those, the ones finished once starts were being counted — what the
   * finish rate sets against `starts`. Rounds were recorded from the launch
   * at the end of September, starts only from 4 Oct 2026, so a range reaching
   * back before that had more rounds finished than started.
   */
  tracked: number;
  /** Of those, won or cleared. */
  won: number;
}

/**
 * Opens, starts and finishes. Counts of page loads and opens, never of
 * people: one person opening Tenaball three times is three opens.
 *
 * Only the range, the game and daily-or-not apply here. The other filters are
 * about how a finished round was set up, which an open or a start does not
 * know, so they are left out rather than half-applied.
 */
export interface Traffic {
  totals: FunnelTotals;
  /** The period of the same length just before, for the deltas; null for all time. */
  previous: FunnelTotals | null;
  /** Per day, oldest first, on the same days as `Dashboard.series`. */
  days: ({ day: string } & FunnelTotals)[];
  /** Per game, busiest first, with its daily and unlimited halves. */
  games: { game: GameId; all: FunnelTotals; daily: FunnelTotals; unlimited: FunnelTotals }[];
  /** Where page loads land: `home` or a game's id. */
  landing: Count[];
  /** Page opens by weekday (0 = Monday) and hour, Berlin time: `hours[weekday][hour]`. */
  hours: number[][];
  /** The first UTC hour with a count, "YYYY-MM-DDTHH" — when `tracked` starts; empty with none. */
  countingSince: string;
}

export interface Dashboard {
  generated: string;
  /** The range the numbers cover, in days; 0 for all time. */
  range: number;
  filter: Filter;
  traffic: Traffic;
  /** Rounds in range that pass the filter. */
  rounds: number;
  outcomes: Record<Outcome, number>;
  /**
   * Rounds per day, oldest first: the last 30 days, or every day since the
   * first round for all time (at most 180). The filter applies; the range
   * does not, so a "Today" view still shows the month it sits in.
   */
  series: { day: string; rounds: number }[];
  mix: Mix;
  /** Values the filter can take, read off the stored rounds rather than listed. */
  options: { events: string[]; regions: string[]; difficulty: string[]; level: string[] };
  games: GameOverview[];
  wordle: SecretRow[];
  guessThePlayer: SecretRow[];
  careerPath: ClueRow[];
  whoAreYa: ClueRow[];
  tenaball: BoardRow[];
  list: BoardRow[];
  /** Per category: how often each item ended in its place. */
  pyramid: BoardRow[];
  /** One row: every square that has come up, and how often it was marked. */
  bingo: BoardRow[];
  curveball: ClueRow[];
  /** The secret is an organisation, so these rows are orgs, not players. */
  orgChart: ClueRow[];
  contextinho: SecretRow[];
  /** Per deal: how often each event ended in its place. */
  rewind: BoardRow[];
  irl: ClueRow[];
  transferWindow: ClueRow[];
  /** The secret is a tournament, so these rows are events, not players. */
  whichLobby: ClueRow[];
  griefer: { rules: RuleRow[]; misreads: Misread[] };
  ticTacToe: CellRow[];
  connections: { groups: GroupRow[]; misgrouped: Count[] };
  higherLower: { runs: RunRow[]; pairs: PairRow[]; players: SecretRow[] };
}

// ----------------------------------------------------------------- helpers --

export const OUTCOMES: Outcome[] = ['won', 'lost', 'gave-up', 'cleared'];

function tally(counts: Map<string, number>, key: string, by = 1): void {
  counts.set(key, (counts.get(key) ?? 0) + by);
}

function top(counts: Map<string, number>, limit = 10): Count[] {
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

function outcomesOf(rounds: Stored<RoundRecord>[]): Record<Outcome, number> {
  const out = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const { body } of rounds) if (OUTCOMES.includes(body.outcome)) out[body.outcome]++;
  return out;
}

export function mix(rounds: Stored<RoundRecord>[]): Mix {
  const source = new Map<string, number>(SOURCES.map((s) => [s, 0]));
  const tallies = {
    events: new Map<string, number>(),
    regions: new Map<string, number>(),
    difficulty: new Map<string, number>(),
    level: new Map<string, number>(),
    mode: new Map<string, number>(),
    category: new Map<string, number>(),
  };
  for (const { body } of rounds) {
    const setup = body.setup;
    tally(source, sourceOf(setup));
    if (setup?.event) tally(tallies.events, setup.event);
    const region = regionOf(setup);
    if (region) tally(tallies.regions, region);
    const difficulty = difficultyOf(setup);
    if (difficulty) tally(tallies.difficulty, difficulty);
    if (setup?.level) tally(tallies.level, setup.level);
    if (setup?.mode) tally(tallies.mode, setup.mode);
    if (setup?.category) tally(tallies.category, setup.category);
  }
  return {
    rounds: rounds.length,
    source: SOURCES.map((s) => ({ label: s, count: source.get(s) ?? 0 })),
    events: top(tallies.events, 50),
    regions: top(tallies.regions, 50),
    difficulty: top(tallies.difficulty, 10),
    level: top(tallies.level, 10),
    mode: top(tallies.mode, 20),
    category: top(tallies.category, 20),
  };
}

function mean(total: number, n: number): number | null {
  return n > 0 ? Math.round((total / n) * 100) / 100 : null;
}

function of<G extends GameId>(rounds: Stored<RoundRecord>[], game: G): Stored<RoundRecord<G>>[] {
  return rounds.filter((round) => round.body?.game === game) as Stored<RoundRecord<G>>[];
}

/** Runs `fn` per round and drops the rounds it throws on. */
function each<T>(rounds: T[], fn: (round: T) => void): void {
  for (const round of rounds) {
    try {
      fn(round);
    } catch {
      /* malformed record — skipped, see the header comment */
    }
  }
}

// -------------------------------------------------------------- per game --

function overview(rounds: Stored<RoundRecord>[]): GameOverview[] {
  return GAME_IDS.map((game) => {
    const mine = of(rounds, game) as Stored<RoundRecord>[];
    return { game, rounds: mine.length, outcomes: outcomesOf(mine), mix: mix(mine) };
  });
}

/** Fortnitedle, Guess the Player and Contextinho. */
function secrets(
  rounds: Stored<RoundRecord<'wordle' | 'guess-the-player' | 'contextinho'>>[],
): SecretRow[] {
  const rows = new Map<string, SecretRow & { guessTotal: number }>();
  each(rounds as Stored<RoundRecord>[], ({ body }) => {
    const r = body.r as GamePayloads['wordle'] | GamePayloads['guess-the-player'];
    const guesses = typeof r.guesses === 'number' ? r.guesses : r.guesses.length;
    const row = rows.get(r.secret.id) ?? {
      id: r.secret.id,
      name: r.secret.name,
      plays: 0,
      solved: 0,
      avgGuesses: null,
      guessTotal: 0,
    };
    row.plays++;
    if (body.outcome === 'won') {
      row.solved++;
      row.guessTotal += guesses;
    }
    rows.set(row.id, row);
  });
  return [...rows.values()]
    .map(({ guessTotal, ...row }) => ({ ...row, avgGuesses: mean(guessTotal, row.solved) }))
    .sort((a, b) => b.plays - a.plays);
}

/** The games that reveal clues one at a time: Career Path, Who Are Ya and the ones built like them. */
type ClueGame = 'career-path' | 'who-are-ya' | 'curveball' | 'org-chart' | 'irl' | 'transfer-window' | 'which-lobby';

function clueGames(rounds: Stored<RoundRecord<ClueGame>>[]): ClueRow[] {
  type Acc = ClueRow & { guessTotal: number; clueTotal: number; clueMap: Map<string, ClueRow['clues'][number]>; wrongMap: Map<string, number> };
  const rows = new Map<string, Acc>();
  each(rounds as Stored<RoundRecord>[], ({ body }) => {
    const r = body.r as GamePayloads['career-path'];
    const row: Acc = rows.get(r.secret.id) ?? {
      id: r.secret.id,
      name: r.secret.name,
      plays: 0,
      solved: 0,
      avgGuesses: null,
      avgClues: null,
      clues: [],
      mistakenFor: [],
      guessTotal: 0,
      clueTotal: 0,
      clueMap: new Map(),
      wrongMap: new Map(),
    };
    row.plays++;
    const clueAt = (index: number) => {
      const clue = r.clues[index];
      const key = clue.id;
      const entry = row.clueMap.get(key) ?? { name: clue.name, solved: 0, skipped: 0, wrong: 0, reached: 0 };
      row.clueMap.set(key, entry);
      return entry;
    };
    // Every clue that was ever the newest one showing was reached.
    const newest = Math.max(0, ...r.steps.map((step) => step.clue));
    const lastShown = body.outcome === 'won' ? newest : Math.min(r.clues.length - 1, newest + (r.steps.length ? 1 : 0));
    for (let i = 0; i <= Math.min(lastShown, r.clues.length - 1); i++) clueAt(i).reached++;
    for (const step of r.steps) {
      const entry = clueAt(step.clue);
      if (!step.guess) entry.skipped++;
      else if (step.correct) entry.solved++;
      else {
        entry.wrong++;
        tally(row.wrongMap, step.guess.name);
      }
    }
    if (body.outcome === 'won') {
      row.solved++;
      row.guessTotal += r.steps.filter((step) => step.guess).length;
      row.clueTotal += newest + 1;
    }
    rows.set(row.id, row);
  });
  return [...rows.values()]
    .map(({ guessTotal, clueTotal, clueMap, wrongMap, ...row }) => ({
      ...row,
      avgGuesses: mean(guessTotal, row.solved),
      avgClues: mean(clueTotal, row.solved),
      clues: [...clueMap.values()].sort((a, b) => b.reached - a.reached),
      mistakenFor: top(wrongMap, 5),
    }))
    .sort((a, b) => b.plays - a.plays);
}

function tenaball(rounds: Stored<RoundRecord<'tenaball'>>[]): BoardRow[] {
  type Acc = BoardRow & { shareTotal: number; answerMap: Map<string, { found: number; seen: number }>; wrongMap: Map<string, number> };
  const rows = new Map<string, Acc>();
  each(rounds, ({ body }) => {
    const { board, answers, wrong } = body.r;
    const row: Acc = rows.get(board.id) ?? {
      id: board.id,
      name: board.name,
      plays: 0,
      avgShare: 0,
      perfect: 0,
      gaveUp: 0,
      answers: [],
      wrong: [],
      shareTotal: 0,
      answerMap: new Map(),
      wrongMap: new Map(),
    };
    const found = answers.filter((answer) => answer.found).length;
    row.plays++;
    row.shareTotal += answers.length ? found / answers.length : 0;
    if (found === answers.length) row.perfect++;
    if (body.outcome === 'gave-up') row.gaveUp++;
    for (const answer of answers) {
      const entry = row.answerMap.get(answer.name) ?? { found: 0, seen: 0 };
      entry.seen++;
      if (answer.found) entry.found++;
      row.answerMap.set(answer.name, entry);
    }
    for (const name of wrong) tally(row.wrongMap, name);
    rows.set(board.id, row);
  });
  return [...rows.values()]
    .map(({ shareTotal, answerMap, wrongMap, ...row }) => ({
      ...row,
      avgShare: mean(shareTotal, row.plays) ?? 0,
      answers: [...answerMap].map(([name, n]) => ({ name, ...n })).sort((a, b) => b.found / b.seen - a.found / a.seen),
      wrong: top(wrongMap, 10),
    }))
    .sort((a, b) => b.plays - a.plays);
}

/**
 * Pyramid, read as boards: a category is a board and its items the answers,
 * "found" when they ended in their place — so the Tenaball table shows it.
 */
function pyramid(rounds: Stored<RoundRecord<'pyramid' | 'rewind'>>[]): BoardRow[] {
  return tenaball(
    rounds.map((round) => ({
      ...round,
      body: {
        ...round.body,
        game: 'tenaball' as const,
        r: {
          board: round.body.r.puzzle,
          answers: round.body.r.items.map((item) => ({ name: item.name, found: item.placed })),
          wrong: [],
        },
      },
    })),
  );
}

/** Bingo, read as one board whose answers are the squares: "found" means marked. */
function bingo(rounds: Stored<RoundRecord<'bingo'>>[]): BoardRow[] {
  return tenaball(
    rounds.map((round) => {
      const marked = new Set(round.body.r.placed.map((entry) => entry.square));
      return {
        ...round,
        body: {
          ...round.body,
          game: 'tenaball' as const,
          r: {
            board: { id: 'bingo', name: 'Bingo squares' },
            answers: round.body.r.squares.map((square, index) => ({ name: square.name, found: marked.has(index) })),
            wrong: [],
          },
        },
      };
    }),
  );
}

function list(rounds: Stored<RoundRecord<'list'>>[]): BoardRow[] {
  type Acc = BoardRow & { shareTotal: number; answerMap: Map<string, { found: number; seen: number }> };
  const rows = new Map<string, Acc>();
  each(rounds, ({ body }) => {
    const { list: which, total, found, missed } = body.r;
    const row: Acc = rows.get(which.id) ?? {
      id: which.id,
      name: which.name,
      plays: 0,
      avgShare: 0,
      perfect: 0,
      gaveUp: 0,
      answers: [],
      wrong: [],
      shareTotal: 0,
      answerMap: new Map(),
    };
    row.plays++;
    row.shareTotal += total ? found.length / total : 0;
    if (found.length >= total) row.perfect++;
    if (body.outcome === 'gave-up') row.gaveUp++;
    const bump = (name: string, hit: boolean) => {
      const entry = row.answerMap.get(name) ?? { found: 0, seen: 0 };
      entry.seen++;
      if (hit) entry.found++;
      row.answerMap.set(name, entry);
    };
    for (const entry of found) bump(entry.name, true);
    for (const name of missed ?? []) bump(name, false);
    rows.set(which.id, row);
  });
  return [...rows.values()]
    .map(({ shareTotal, answerMap, ...row }) => ({
      ...row,
      avgShare: mean(shareTotal, row.plays) ?? 0,
      answers: [...answerMap].map(([name, n]) => ({ name, ...n })).sort((a, b) => b.found / b.seen - a.found / a.seen),
    }))
    .sort((a, b) => b.plays - a.plays);
}

/**
 * Griefer: which rules are hard, and which players people misread under a
 * rule — picked though they do not fit, or passed over though they do.
 */
function griefer(rounds: Stored<RoundRecord<'impostor'>>[]): Dashboard['griefer'] {
  const rules = new Map<string, RuleRow>();
  const reads = new Map<string, Misread>();
  each(rounds, ({ body }) => {
    const { rule, cards } = body.r;
    const row = rules.get(rule.id) ?? { id: rule.id, name: rule.name, plays: 0, won: 0 };
    row.plays++;
    if (body.outcome === 'won') row.won++;
    rules.set(rule.id, row);
    // A round given up says nothing about what the player believed.
    if (body.outcome === 'gave-up') return;
    for (const card of cards) {
      const key = `${rule.id}|${card.player.id}`;
      const entry = reads.get(key) ?? { rule: rule.name, player: card.player.name, fits: card.fits, shown: 0, wrong: 0 };
      entry.shown++;
      if (card.fits !== card.picked) entry.wrong++;
      reads.set(key, entry);
    }
  });
  return {
    rules: [...rules.values()].sort((a, b) => b.plays - a.plays),
    misreads: [...reads.values()]
      .filter((read) => read.wrong > 0)
      .sort((a, b) => b.wrong / b.shown - a.wrong / a.shown || b.shown - a.shown)
      .slice(0, 100),
  };
}

/**
 * Tic Tac Toe, per pair of rules. The pair is keyed in a fixed order so
 * "FaZe × Won EU FNCS" and "Won EU FNCS × FaZe" are one cell.
 */
function ticTacToe(rounds: Stored<RoundRecord<'tic-tac-toe'>>[]): CellRow[] {
  const cells = new Map<string, CellRow & { answerMap: Map<string, number> }>();
  each(rounds, ({ body }) => {
    const { rows, cols, placed } = body.r;
    rows.forEach((row, r) =>
      cols.forEach((col, c) => {
        const [a, b] = row.id < col.id ? [row, col] : [col, row];
        const key = `${a.id}|${b.id}`;
        const cell = cells.get(key) ?? { name: `${a.name} × ${b.name}`, plays: 0, filled: 0, answers: [], answerMap: new Map() };
        cell.plays++;
        const hit = placed.find((entry) => entry.row === r && entry.col === c);
        if (hit) {
          cell.filled++;
          tally(cell.answerMap, hit.player.name);
        }
        cells.set(key, cell);
      }),
    );
  });
  return [...cells.values()]
    .map(({ answerMap, ...cell }) => ({ ...cell, answers: top(answerMap, 50) }))
    .sort((a, b) => b.plays - a.plays);
}

/** Connections: which groups get solved, and who ends up in a wrong four. */
function connections(rounds: Stored<RoundRecord<'connections'>>[]): Dashboard['connections'] {
  const groups = new Map<string, GroupRow>();
  const misgrouped = new Map<string, number>();
  each(rounds, ({ body }) => {
    const { groups: inPlay, attempts } = body.r;
    const names = new Map(inPlay.flatMap((group) => group.players.map((p) => [p.id, p.name] as const)));
    for (const group of inPlay) {
      const row = groups.get(group.rule.id) ?? { name: group.rule.name, plays: 0, solved: 0 };
      row.plays++;
      const ids = new Set(group.players.map((p) => p.id));
      if (attempts.some((a) => a.correct && a.players.every((id) => ids.has(id)))) row.solved++;
      groups.set(group.rule.id, row);
    }
    for (const attempt of attempts) {
      if (attempt.correct) continue;
      for (const id of attempt.players) tally(misgrouped, names.get(id) ?? id);
    }
  });
  return {
    groups: [...groups.values()].sort((a, b) => b.plays - a.plays),
    misgrouped: top(misgrouped, 30),
  };
}

/**
 * Higher or Lower: runs by category and level, and pair- and player-level hit
 * rates — the numbers that could one day pick pairs by how often people get
 * them right rather than by the gap between the values.
 */
function higherLower(rounds: Stored<RoundRecord<'higher-lower'>>[]): Dashboard['higherLower'] {
  const runs = new Map<string, RunRow & { total: number }>();
  const pairs = new Map<string, PairRow>();
  const players = new Map<string, SecretRow>();
  each(rounds, ({ body }) => {
    const category = body.setup?.category ?? '?';
    const level = body.setup?.level ?? '?';
    const key = `${category}|${level}`;
    const run = runs.get(key) ?? { category, level, runs: 0, avgScore: 0, best: 0, total: 0 };
    run.runs++;
    run.total += body.r.score;
    run.best = Math.max(run.best, body.r.score);
    runs.set(key, run);
    for (const pair of body.r.pairs) {
      const pairKey = `${category}|${pair.shown.id}|${pair.hidden.id}`;
      const row = pairs.get(pairKey) ?? { category, shown: pair.shown.name, hidden: pair.hidden.name, seen: 0, correct: 0 };
      row.seen++;
      if (pair.correct) row.correct++;
      pairs.set(pairKey, row);
      const playerKey = `${category}|${pair.hidden.id}`;
      const player = players.get(playerKey) ?? { id: pair.hidden.id, name: `${pair.hidden.name} (${category})`, plays: 0, solved: 0, avgGuesses: null };
      player.plays++;
      if (pair.correct) player.solved++;
      players.set(playerKey, player);
    }
  });
  return {
    runs: [...runs.values()].map(({ total, ...run }) => ({ ...run, avgScore: mean(total, run.runs) ?? 0 })),
    pairs: [...pairs.values()].sort((a, b) => b.seen - a.seen).slice(0, 200),
    players: [...players.values()].sort((a, b) => b.plays - a.plays).slice(0, 200),
  };
}

// ------------------------------------------------------------------- entry --

const DAY = 86_400_000;

/** Rounds with a body the dashboard can read at all. */
function readable(rounds: Stored<RoundRecord>[]): Stored<RoundRecord>[] {
  return rounds.filter((round) => round.body && GAME_IDS.includes(round.body.game));
}

/**
 * How far back the server has to read for a range: twice the range, for the
 * period before it that the deltas compare with, and never less than the 30
 * days the daily chart shows. 0 means everything.
 */
export function readSince(days: number, now: Date = new Date()): Date | undefined {
  return days > 0 ? new Date(now.getTime() - Math.max(days * 2, 30) * DAY) : undefined;
}

// ----------------------------------------------------------------- traffic --

const emptyTotals = (): FunnelTotals => ({ visits: 0, opens: 0, engaged: 0, starts: 0, finished: 0, tracked: 0, won: 0 });

const STEP_TOTAL: Record<FunnelStep, keyof FunnelTotals | undefined> = {
  open: 'opens',
  entry: 'visits',
  start: 'starts',
  'first-start': 'engaged',
};

const BERLIN = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin',
  weekday: 'short',
  hour: '2-digit',
  hourCycle: 'h23',
});
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** A UTC hour key's weekday (0 = Monday) and hour in Berlin, where the dailies turn over. */
function berlinSlot(hour: string): [number, number] {
  const parts = BERLIN.formatToParts(new Date(`${hour}:00:00Z`));
  const weekday = WEEKDAYS.indexOf(parts.find((p) => p.type === 'weekday')?.value ?? '');
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  return [Math.max(0, weekday), Number.isFinite(h) ? h % 24 : 0];
}

/** The mode a source filter narrows opens and starts to: a daily, or any unlimited setup. */
function modeOf(filter: Filter): 'daily' | 'unlimited' | null {
  if (!filter.source) return null;
  return filter.source === 'daily' ? 'daily' : 'unlimited';
}

export function traffic(
  counts: FunnelCount[],
  rounds: Stored<RoundRecord>[],
  { now, days, filter, span }: { now: Date; days: number; filter: Filter; span: string[] },
): Traffic {
  const end = now.getTime();
  const start = days > 0 ? end - days * DAY : -Infinity;
  const before = days > 0 ? end - 2 * days * DAY : -Infinity;
  const fromHour = days > 0 ? new Date(start).toISOString().slice(0, 13) : '';
  const prevHour = days > 0 ? new Date(before).toISOString().slice(0, 13) : '';
  const mode = modeOf(filter);

  const totals = emptyTotals();
  const previous = days > 0 ? emptyTotals() : null;
  const byDay = new Map(span.map((day) => [day, { day, ...emptyTotals() }]));
  const games = new Map<GameId, Traffic['games'][number]>();
  const landing = new Map<string, number>();
  const hours = WEEKDAYS.map(() => Array.from({ length: 24 }, () => 0));
  const gameRow = (game: GameId) => {
    let row = games.get(game);
    if (!row) games.set(game, (row = { game, all: emptyTotals(), daily: emptyTotals(), unlimited: emptyTotals() }));
    return row;
  };
  const add = (into: FunnelTotals[], key: keyof FunnelTotals, n: number) => {
    for (const t of into) t[key] += n;
  };

  for (const count of counts) {
    if (!count || typeof count.n !== 'number') continue;
    const isGame = (GAME_IDS as readonly string[]).includes(count.page);
    if (count.page !== 'home' && !isGame) continue;
    if (filter.game && count.page !== filter.game) continue;
    // The home page has no mode; it belongs to neither half when one is chosen.
    if (mode && count.mode !== mode) continue;
    // A home-page open is not a game open; its entry still counts as a visit.
    const key = STEP_TOTAL[count.step] === 'opens' && count.page === 'home' ? null : STEP_TOTAL[count.step];
    if (!key) {
      if (count.step === 'open' && count.hour >= fromHour) {
        const [weekday, hour] = berlinSlot(count.hour);
        hours[weekday][hour] += count.n;
      }
      continue;
    }
    // The chart shows a month whatever the range.
    const day = byDay.get(count.hour.slice(0, 10));
    if (day) day[key] += count.n;
    if (count.hour < fromHour) {
      if (previous && count.hour >= prevHour) previous[key] += count.n;
      continue;
    }
    const targets: FunnelTotals[] = [totals];
    if (isGame) {
      const row = gameRow(count.page as GameId);
      targets.push(row.all, count.mode === 'daily' ? row.daily : row.unlimited);
    }
    add(targets, key, count.n);
    if (count.step === 'entry') tally(landing, count.page, count.n);
    if (count.step === 'open') {
      const [weekday, hour] = berlinSlot(count.hour);
      hours[weekday][hour] += count.n;
    }
  }

  // The first hour anything was counted, whatever the filters: the funnel
  // began on 4 Oct 2026 for every page at once. A round finished before it has
  // no start to set against, so it is not `tracked`.
  let counting = '';
  for (const count of counts) if (count?.hour && (!counting || count.hour < counting)) counting = count.hour;

  for (const round of rounds) {
    const body = round.body;
    if (filter.game && body.game !== filter.game) continue;
    const daily = sourceOf(body.setup) === 'daily';
    if (mode && (mode === 'daily') !== daily) continue;
    const at = Date.parse(round.at);
    const won = body.outcome === 'won' || body.outcome === 'cleared' ? 1 : 0;
    const tracked = counting !== '' && String(round.at).slice(0, 13) >= counting ? 1 : 0;
    const day = byDay.get(String(round.at).slice(0, 10));
    if (day) {
      day.finished++;
      day.tracked += tracked;
      day.won += won;
    }
    if (at >= start || !round.at) {
      const row = gameRow(body.game);
      for (const t of [totals, row.all, daily ? row.daily : row.unlimited]) {
        t.finished++;
        t.tracked += tracked;
        t.won += won;
      }
    } else if (previous && at >= before) {
      previous.finished++;
      previous.tracked += tracked;
      previous.won += won;
    }
  }

  return {
    totals,
    previous,
    days: [...byDay.values()],
    games: [...games.values()].sort((a, b) => b.all.opens + b.all.finished - (a.all.opens + a.all.finished)),
    landing: top(landing, 20),
    hours,
    countingSince: counting,
  };
}

function series(rounds: Stored<RoundRecord>[], now: Date, allTime: boolean): Dashboard['series'] {
  const byDay = new Map<string, number>();
  for (const round of rounds) tally(byDay, String(round.at).slice(0, 10));
  const first = rounds.length ? Date.parse(rounds[0].at) : now.getTime();
  const span = allTime ? Math.min(180, Math.max(30, Math.ceil((now.getTime() - first) / DAY) + 1)) : 30;
  const out: Dashboard['series'] = [];
  for (let i = span - 1; i >= 0; i--) {
    const day = new Date(now.getTime() - i * DAY).toISOString().slice(0, 10);
    out.push({ day, rounds: byDay.get(day) ?? 0 });
  }
  return out;
}

/** Every value a filter field takes in these rounds, most used first. */
function options(rounds: Stored<RoundRecord>[]): Dashboard['options'] {
  const all = mix(rounds);
  const labels = (counts: Count[]) => counts.map((c) => c.label);
  return {
    events: labels(all.events),
    regions: labels(all.regions),
    difficulty: labels(all.difficulty),
    level: labels(all.level),
  };
}

/**
 * The whole dashboard for `rounds`.
 *
 * `rounds` may reach further back than `days` — see `readSince` — because the
 * daily chart always shows a month; everything else is cut to the range. The
 * filter applies to all of it, the dropdowns' `options` aside, which are read
 * off everything in range so a filter can always be widened again.
 */
export function aggregate(
  rounds: Stored<RoundRecord>[],
  {
    now = new Date(),
    days = 0,
    filter = {},
    funnel = [],
  }: { now?: Date; days?: number; filter?: Filter; funnel?: FunnelCount[] } = {},
): Dashboard {
  const since = days > 0 ? now.getTime() - days * DAY : -Infinity;
  const readableRounds = readable(rounds);
  const inRange = readableRounds.filter((round) => Date.parse(round.at) >= since || !round.at);
  const passes = (round: Stored<RoundRecord>) => matches(round.body, filter);
  const valid = inRange.filter(passes);
  const daily = series(readableRounds.filter(passes), now, days <= 0);

  return {
    generated: now.toISOString(),
    range: days,
    filter,
    traffic: traffic(funnel, readableRounds, { now, days, filter, span: daily.map((d) => d.day) }),
    rounds: valid.length,
    outcomes: outcomesOf(valid),
    series: daily,
    mix: mix(valid),
    options: options(inRange),
    games: overview(valid),
    wordle: secrets(of(valid, 'wordle')),
    guessThePlayer: secrets(of(valid, 'guess-the-player')),
    careerPath: clueGames(of(valid, 'career-path')),
    whoAreYa: clueGames(of(valid, 'who-are-ya')),
    tenaball: tenaball(of(valid, 'tenaball')),
    list: list(of(valid, 'list')),
    pyramid: pyramid(of(valid, 'pyramid')),
    bingo: bingo(of(valid, 'bingo')),
    curveball: clueGames(of(valid, 'curveball')),
    orgChart: clueGames(of(valid, 'org-chart')),
    contextinho: secrets(of(valid, 'contextinho')),
    rewind: pyramid(of(valid, 'rewind')),
    irl: clueGames(of(valid, 'irl')),
    transferWindow: clueGames(of(valid, 'transfer-window')),
    whichLobby: clueGames(of(valid, 'which-lobby')),
    griefer: griefer(of(valid, 'impostor')),
    ticTacToe: ticTacToe(of(valid, 'tic-tac-toe')),
    connections: connections(of(valid, 'connections')),
    higherLower: higherLower(of(valid, 'higher-lower')),
  };
}

// ----------------------------------------------------------------- players --

/**
 * What a player was in one round.
 *
 *   secret     the answer — Fortnitedle, Guess the Player, Career Path, Who Are Ya,
 *              Curveball, Contextinho, IRL, Transfer Window
 *   guessed    typed as a guess in Guess the Player or Contextinho
 *   mistaken   a wrong guess in Career Path, Who Are Ya and the games built like them
 *   clue       one of Who Are Ya's teammate clues, shown before the round ended
 *   answer     an answer on a Tenaball board or a List
 *   fits       a Griefer card that fitted the rule
 *   griefer    a Griefer card that did not
 *   placed     a Tic Tac Toe or Bingo answer someone used
 *   tile       a Connections tile
 *   misgrouped put in a wrong four in Connections
 *   hidden     the player to call Higher or Lower on
 *   sorted     one of a Pyramid's ten
 */
export type Role =
  | 'secret'
  | 'guessed'
  | 'mistaken'
  | 'clue'
  | 'answer'
  | 'fits'
  | 'griefer'
  | 'placed'
  | 'tile'
  | 'misgrouped'
  | 'hidden'
  | 'sorted';

/** One appearance. `good` is whether whoever was playing got this player right, where that means anything. */
interface Mention {
  role: Role;
  id?: string;
  name: string;
  good?: boolean;
}

function mentions(body: RoundRecord): Mention[] {
  const out: Mention[] = [];
  const won = body.outcome === 'won' || body.outcome === 'cleared';
  const push = (role: Role, who: { id?: string; name: string }, good?: boolean) =>
    out.push({ role, id: who.id, name: who.name, good });

  switch (body.game) {
    case 'wordle': {
      push('secret', (body.r as GamePayloads['wordle']).secret, won);
      break;
    }
    case 'guess-the-player': {
      const r = body.r as GamePayloads['guess-the-player'];
      push('secret', r.secret, won);
      for (const guess of r.guesses) if (guess.id !== r.secret.id) push('guessed', guess);
      break;
    }
    case 'contextinho': {
      const r = body.r as GamePayloads['contextinho'];
      push('secret', r.secret, won);
      for (const guess of r.guesses) if (guess.id !== r.secret.id) push('guessed', guess);
      break;
    }
    // Org Chart's and Which Lobby's secrets are an org and a tournament, and
    // their clues are not all players either: nothing there is a player to index.
    case 'curveball':
    case 'irl':
    case 'transfer-window':
    case 'career-path':
    case 'who-are-ya': {
      const r = body.r as GamePayloads['career-path'];
      push('secret', r.secret, won);
      for (const step of r.steps) if (step.guess && !step.correct) push('mistaken', step.guess);
      if (body.game === 'who-are-ya') {
        const shown = Math.max(0, ...r.steps.map((step) => step.clue)) + 1;
        for (const clue of r.clues.slice(0, shown)) push('clue', clue);
      }
      break;
    }
    case 'tenaball': {
      for (const answer of (body.r as GamePayloads['tenaball']).answers) push('answer', answer, answer.found);
      break;
    }
    case 'list': {
      const r = body.r as GamePayloads['list'];
      for (const entry of r.found) push('answer', entry, true);
      for (const name of r.missed ?? []) push('answer', { name }, false);
      break;
    }
    case 'impostor': {
      // A round given up says nothing about what the player believed.
      if (body.outcome === 'gave-up') break;
      for (const card of (body.r as GamePayloads['impostor']).cards) {
        push(card.fits ? 'fits' : 'griefer', card.player, card.fits === card.picked);
      }
      break;
    }
    case 'tic-tac-toe': {
      for (const entry of (body.r as GamePayloads['tic-tac-toe']).placed) push('placed', entry.player);
      break;
    }
    case 'connections': {
      const r = body.r as GamePayloads['connections'];
      const names = new Map<string, string>();
      for (const group of r.groups) {
        const ids = new Set(group.players.map((p) => p.id));
        const solved = r.attempts.some((a) => a.correct && a.players.every((id) => ids.has(id)));
        for (const player of group.players) {
          names.set(player.id, player.name);
          push('tile', player, solved);
        }
      }
      for (const attempt of r.attempts) {
        if (attempt.correct) continue;
        for (const id of attempt.players) push('misgrouped', { id, name: names.get(id) ?? id });
      }
      break;
    }
    case 'higher-lower': {
      for (const pair of (body.r as GamePayloads['higher-lower']).pairs) push('hidden', pair.hidden, pair.correct);
      break;
    }
    case 'bingo': {
      const r = body.r as GamePayloads['bingo'];
      for (const entry of r.placed) push('placed', entry.player);
      for (const entry of r.wrong ?? []) push('mistaken', entry.player);
      break;
    }
    case 'pyramid': {
      // A tournament's items are teams, "a|b" — not one player's id.
      for (const item of (body.r as GamePayloads['pyramid']).items) {
        if (!item.id.includes('|')) push('sorted', item, item.placed);
      }
      break;
    }
  }
  return out;
}

/**
 * Who the mentions are, by player id.
 *
 * Tenaball and List answers are the catch: an answer may be a country or an
 * organisation, and a Tenaball answer carries only a name. So they count
 * towards a player only when they can be tied to one seen in a role that is
 * always a player — by id, or by a name no two of those players share — and
 * are dropped otherwise, which keeps France out of the player search.
 */
function identities(rounds: Stored<RoundRecord>[]) {
  const names = new Map<string, string>();
  const byName = new Map<string, string | null>();
  const parsed: { round: Stored<RoundRecord>; list: Mention[] }[] = [];
  for (const round of rounds) {
    try {
      const list = mentions(round.body);
      parsed.push({ round, list });
      for (const m of list) {
        if (m.role !== 'answer' && m.id) names.set(m.id, m.name);
      }
    } catch {
      /* malformed record — skipped, see the header comment */
    }
  }
  for (const [id, name] of names) {
    const key = name.toLowerCase();
    byName.set(key, byName.has(key) && byName.get(key) !== id ? null : id);
  }
  const idOf = (m: Mention): string | null => {
    if (m.role !== 'answer') return m.id ?? null;
    if (m.id && names.has(m.id)) return m.id;
    return byName.get(m.name.toLowerCase()) ?? null;
  };
  return { names, parsed, idOf };
}

export interface PlayerEntry {
  id: string;
  name: string;
  /** Rounds the player appeared in, any role. */
  rounds: number;
}

export interface LensRow {
  game: GameId;
  role: Role;
  /** Appearances this way. */
  rounds: number;
  /** Of the appearances with a right answer, how many were got right. */
  good: number;
  judged: number;
}

export interface PlayerLens {
  id: string;
  name: string;
  rounds: number;
  rows: LensRow[];
  /** The latest appearances, newest first. */
  recent: { at: string; game: GameId; role: Role; outcome: Outcome; good?: boolean }[];
}

type Scope = { now?: Date; days?: number; filter?: Filter };

function scoped(rounds: Stored<RoundRecord>[], { now = new Date(), days = 0, filter = {} }: Scope) {
  const since = days > 0 ? now.getTime() - days * DAY : -Infinity;
  return readable(rounds).filter(
    (round) => (Date.parse(round.at) >= since || !round.at) && matches(round.body, filter),
  );
}

/** Everyone the stored rounds mention, most seen first — what the player search offers. */
export function playerIndex(rounds: Stored<RoundRecord>[], scope: Scope = {}): PlayerEntry[] {
  const { names, parsed, idOf } = identities(scoped(rounds, scope));
  const seen = new Map<string, Set<number>>();
  for (const { round, list } of parsed) {
    for (const m of list) {
      const id = idOf(m);
      if (!id) continue;
      if (!seen.has(id)) seen.set(id, new Set());
      seen.get(id)!.add(round.id);
    }
  }
  return [...seen]
    .map(([id, set]) => ({ id, name: names.get(id) ?? id, rounds: set.size }))
    .sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name));
}

/** One player across every game: what they were, how often, and how people did with them. */
export function playerLens(rounds: Stored<RoundRecord>[], id: string, scope: Scope = {}): PlayerLens {
  const { names, parsed, idOf } = identities(scoped(rounds, scope));
  const rows = new Map<string, LensRow>();
  const hit = new Set<number>();
  const recent: PlayerLens['recent'] = [];
  for (const { round, list } of parsed) {
    for (const m of list) {
      if (idOf(m) !== id) continue;
      hit.add(round.id);
      const key = `${round.body.game}|${m.role}`;
      const row = rows.get(key) ?? { game: round.body.game, role: m.role, rounds: 0, good: 0, judged: 0 };
      row.rounds++;
      if (m.good !== undefined) {
        row.judged++;
        if (m.good) row.good++;
      }
      rows.set(key, row);
      recent.push({ at: round.at, game: round.body.game, role: m.role, outcome: round.body.outcome, good: m.good });
    }
  }
  return {
    id,
    name: names.get(id) ?? id,
    rounds: hit.size,
    rows: [...rows.values()].sort(
      (a, b) => GAME_IDS.indexOf(a.game) - GAME_IDS.indexOf(b.game) || b.rounds - a.rounds,
    ),
    recent: recent.reverse().slice(0, 30),
  };
}
