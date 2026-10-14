/**
 * What the site records, and in what shape.
 *
 * One record per *finished round*, and two counts on the way to one: a page
 * opened and a round started (`FunnelHit`), kept only as hourly totals — never
 * one row per visit, never per click. The reason to record anything is narrow:
 * to see which games people open, which they start and finish, and where the
 * puzzles are too hard or too easy. Everything below is chosen for that and
 * nothing else.
 *
 * Nothing identifies a person. There is no device id, no account, no cookie
 * for players (the only cookie is the admin login on `/analytics`), nothing is
 * stored in the browser for it, and the server does not keep IP addresses.
 * Totals are global: "Tenaball was played 300 times", never "this device
 * played 30 of them".
 *
 * Shared by the browser (which sends records), the server (which stores
 * them) and `aggregate.ts` (which turns them into the dashboard), so the three
 * cannot disagree about a field.
 */

/** Bumped when a record's shape changes, so the dashboard can tell eras apart. */
export const RECORD_VERSION = 1;

/** Registry ids — the same ones local best scores hang off. */
export const GAME_IDS = [
  'higher-lower',
  'wordle',
  'career-path',
  'who-are-ya',
  'tenaball',
  'list',
  'impostor',
  'tic-tac-toe',
  'connections',
  'guess-the-player',
  'pyramid',
  'bingo',
  'curveball',
  'org-chart',
  'contextinho',
  'rewind',
  'irl',
  'transfer-window',
  'which-lobby',
] as const;

export type GameId = (typeof GAME_IDS)[number];

/** A player, an org, a rule — anything a record names, with the label to show. */
export interface Ref {
  id: string;
  name: string;
}

/** The `Ref` of anything with an id and a name — a roster player, a criterion. */
export const ref = (item: { id: string; name: string }): Ref => ({ id: item.id, name: item.name });

/**
 * How the round was set up: the "how many were Random, how many in Asia"
 * half of the dashboard. Every field optional, because each game only has
 * some of these.
 */
export interface Setup {
  /** The day, "YYYY-MM-DD", when this was that day's daily puzzle. */
  daily?: string;
  /** The event mode's pool id, when one was in force. */
  event?: string | null;
  /** Shared pool picker: Random or Choose. */
  pick?: 'random' | 'custom';
  region?: string | null;
  /** Fame band from the pool picker, or `any`. */
  difficulty?: string;
  status?: string;
  /** A game's own Easy / Medium / Hard (Tic Tac Toe, Higher or Lower, Tenaball, List). */
  level?: string;
  /** A game's own mode: Order / Random, Exact / Direction, all-at-once / one-by-one… */
  mode?: string;
  /** Higher or Lower's category. */
  category?: string;
}

export type Outcome = 'won' | 'lost' | 'gave-up' | 'cleared';

/**
 * One step in a clue game (Career Path, Who Are Ya): what the player did while
 * clue `clue` was the newest one showing. `guess` is null for "reveal next
 * clue" — a skip — and set for a guess, `correct` saying which kind.
 */
export interface Step {
  clue: number;
  guess: Ref | null;
  correct: boolean;
}

/**
 * A round of clues revealed one at a time and guessed between: Career Path's
 * and Who Are Ya's shape, and every newer game built the same way. `secret`
 * is whatever is being named — a player, an organisation, a tournament.
 */
export interface ClueRoundPayload {
  secret: Ref;
  clues: Ref[];
  steps: Step[];
}

export interface GamePayloads {
  wordle: { secret: Ref; guesses: number };
  'guess-the-player': { secret: Ref; guesses: Ref[] };
  'career-path': { secret: Ref; clues: Ref[]; steps: Step[] };
  'who-are-ya': { secret: Ref; clues: Ref[]; steps: Step[] };
  tenaball: {
    board: Ref;
    /** Every answer on the board, found or not — per-answer hit rates need both. */
    answers: { name: string; found: boolean }[];
    wrong: string[];
  };
  /** `missed` is names only, to keep a 300-answer list inside the size limit. */
  list: { list: Ref; total: number; found: Ref[]; missed: string[] };
  impostor: {
    rule: Ref;
    /** Every card: whether it fit the rule and whether the player picked it. */
    cards: { player: Ref; fits: boolean; picked: boolean }[];
  };
  'tic-tac-toe': {
    rows: Ref[];
    cols: Ref[];
    placed: { row: number; col: number; player: Ref }[];
    mistakes: number;
  };
  connections: {
    groups: { rule: Ref; players: Ref[] }[];
    /** Every submitted four, in order. */
    attempts: { players: string[]; correct: boolean }[];
  };
  'higher-lower': {
    score: number;
    pairs: { shown: Ref; hidden: Ref; answer: string; correct: boolean }[];
  };
  /** The final arrangement: each item and whether it ended in its place. */
  pyramid: { puzzle: Ref; items: { id: string; name: string; placed: boolean }[]; checks: number };
  /** The sixteen squares, who went where, who was put on a square they did not fit, and how far through the deck. */
  bingo: {
    squares: Ref[];
    placed: { square: number; player: Ref }[];
    wrong: { square: number; player: Ref }[];
    dealt: number;
    /** The deck's size; 0 in Timed and Endless, which have none (the mode is in `setup`). */
    deck: number;
    lines: number;
  };
  /** The clues are the years of the curve, as they were shown: "2019 — $3.1M". */
  curveball: ClueRoundPayload;
  /** The secret is an organisation; the clues its players and facts. */
  'org-chart': ClueRoundPayload;
  /** Every guess in order and how many hints were taken. */
  contextinho: { secret: Ref; guesses: Ref[]; hints: number };
  /** Pyramid's shape: the events, and whether each ended in its place. */
  rewind: { puzzle: Ref; items: { id: string; name: string; placed: boolean }[]; checks: number };
  irl: ClueRoundPayload;
  'transfer-window': ClueRoundPayload;
  /** The secret is a tournament; the clues are its finishers. */
  'which-lobby': ClueRoundPayload;
}

export interface RoundRecord<G extends GameId = GameId> {
  v: number;
  game: G;
  /** Build of the app that sent it. */
  app: string;
  /** When the data behind the round was generated, so re-runs do not blur together. */
  data: string;
  setup: Setup;
  outcome: Outcome;
  r: GamePayloads[G];
}

/**
 * One step on the way to a finished round, as the browser sends it: a page was
 * opened, or a round was started. No id and no time — the server files it under
 * the current hour and keeps only the count.
 */
export interface FunnelHit {
  step: 'open' | 'start';
  /** `home`, or the game's id. */
  page: 'home' | GameId;
  /** The game was on its daily puzzle. Never set for the home page. */
  daily?: boolean;
  /**
   * An open: the first page of this page load — someone arriving, from a link,
   * a bookmark or a reload, rather than moving around the site.
   */
  entry?: boolean;
  /**
   * A start: the first round started since the page was opened, so "opens that
   * led to a round" can be told from "rounds per open". A daily's start is the
   * first move of the day, which is always first.
   */
  first?: boolean;
}

/**
 * What the server keeps: a count per hour, page, step and mode.
 *
 *   open         a page opened
 *   entry        of those, the first page of a page load
 *   start        a round started — a deal in unlimited play, the first move on a daily
 *   first-start  of those, the first since the page was opened
 */
export const FUNNEL_STEPS = ['open', 'entry', 'start', 'first-start'] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export interface FunnelCount {
  /** UTC hour, "YYYY-MM-DDTHH". */
  hour: string;
  page: string;
  step: FunnelStep;
  /** `daily` or `unlimited` for a game; empty for the home page. */
  mode: '' | 'daily' | 'unlimited';
  n: number;
}

/** What the support form sends. */
export const SUPPORT_KINDS = ['bug', 'wrong-data', 'suggestion', 'category', 'other'] as const;
export type SupportKind = (typeof SUPPORT_KINDS)[number];

export interface SupportRequest {
  kind: SupportKind;
  message: string;
  /** Optional — only if the player wants an answer. */
  contact?: string;
  /** Where they were: the page, and the round they last finished if they chose to attach it. */
  context?: { page: string; round?: RoundRecord };
}

export const SUPPORT_STATUSES = ['new', 'seen', 'done'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** A browser error, reported on its own so broken pages show up without anyone writing in. */
export interface ClientError {
  message: string;
  stack?: string;
  page: string;
  app: string;
}

/** What the server hands back from storage. */
export interface Stored<T> {
  id: number;
  at: string;
  body: T;
}

export interface StoredSupport extends Stored<SupportRequest> {
  status: SupportStatus;
}

/** The largest record the server takes. A 200-round Higher or Lower run is about 30 KB. */
export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_MESSAGE_CHARS = 2000;
