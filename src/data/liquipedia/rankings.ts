import { makeRng, pick, type Rng } from '@/lib/rng';
import { loadJson } from './files';

/**
 * Every Tenaball board, precomputed.
 *
 * `rankings.json` is written by `scripts/build_data.py` from `placements.json`,
 * `tournaments.json`, `players.json` and `orgs.json`, and read here in place
 * through the `@data` alias.
 *
 * Precomputed rather than derived in the browser because the source is 442,736
 * placement rows and 154 MB: aggregating that per board, per page load, is not
 * something a phone should be asked to do. The boards only change when the
 * export does, so they are built once where the data already lives.
 *
 * Content from Liquipedia, CC-BY-SA 3.0. See CREDITS.md.
 */

/**
 * What a board is answered with.
 *
 * New for Tenaball. Until now every board wanted a player; "Top 10
 * organisations by earnings" wants an org and "Top 10 countries by FNCS wins"
 * wants a country, so the board has to say which and the game picks the
 * matching resolver.
 *
 * `tournament` is the odd one: the paydays boards turn the question round and
 * ask *where* a player's money came from, so the answer is an event. Those are
 * the only boards whose answers are not somewhere else in the export already,
 * which is why the payload ships a list of event names to search — see
 * `tournaments` below.
 */
export type EntityKind = 'player' | 'org' | 'country' | 'tournament';

/**
 * One nameable answer inside a row.
 *
 * A row is usually its own answer, and then it has no members. A tournament
 * played in duos or trios is the exception: the row is a finishing position and
 * the answer is the team that took it, which is two or three people.
 */
export interface BoardMember {
  key: string;
  label: string;
}

export interface BoardRow {
  /** Canonical id — a page name for players, an org id, a country name. */
  key: string;
  /** What the player types and reads. */
  label: string;
  value: number;
  /** Preformatted, because only the notebook knows if this is money or a count. */
  display: string;
  /**
   * Everyone this row wants named, for a board whose answer is a team.
   *
   * Absent on every other board — and on a tournament board written before the
   * notebook grew this column, which is why nothing may read it directly. Go
   * through {@link membersOf}, which treats a member-less row as a team of one.
   */
  members?: BoardMember[];
}

/** A row's answers: its team, or the row itself. */
export function membersOf(row: {
  key: string;
  label: string;
  members?: BoardMember[];
}): BoardMember[] {
  return row.members?.length ? row.members : [{ key: row.key, label: row.label }];
}

export interface Board {
  id: string;
  /** Picker heading: Players, By region, Tournaments, Organisations, … */
  group: string;
  title: string;
  entity: EntityKind;
  tieRule: string;
  rows: BoardRow[];
  /**
   * 11th place. Used to spot a guess that just missed the cut and call it a near
   * miss instead of a mistake — the rule the board already states.
   */
  next: { key: string; label: string; value: number; members?: BoardMember[] };
  /** True for finishing positions, where 1 beats 2. */
  lowerIsBetter?: boolean;
  /**
   * 10th and 11th are level and either one fills 10th: naming one takes the
   * place, naming the other after that is told it is level and costs nothing.
   * Otherwise a board level at the cut is not built at all.
   */
  shareCut?: boolean;
  /**
   * When the numbers were current, "YYYY-MM-DD": set only on a daily board
   * pinned on its day (`freezeDaily` in `games/tenaball/daily.ts`), which then
   * shows "As of …" under its title.
   */
  asOf?: string;
}

interface RawPayload {
  generated: string;
  slots: number;
  boards: Board[];
  tournaments?: string[];
}

export class Rankings {
  readonly generated: string;
  readonly slots: number;
  readonly boards: Board[];
  /**
   * Event names the guess box can offer on a `tournament` board.
   *
   * Written by the notebook: every tier-1 and tier-2 event, short-named, plus
   * any answer from outside those tiers. Deliberately far wider than the
   * answers — a dropdown holding only the solution is a dropdown that solves
   * the board for you.
   */
  readonly tournaments: string[];

  private readonly byId = new Map<string, Board>();

  constructor(payload: RawPayload) {
    this.generated = payload.generated;
    this.slots = payload.slots;
    this.boards = payload.boards;
    this.tournaments = payload.tournaments ?? [];
    for (const board of this.boards) this.byId.set(board.id, board);
  }

  get(id: string): Board | null {
    return this.byId.get(id) ?? null;
  }

  /** Group name -> its boards, in the order the notebook wrote them. */
  get grouped(): Map<string, Board[]> {
    const out = new Map<string, Board[]>();
    for (const board of this.boards) {
      const list = out.get(board.group);
      if (list) list.push(board);
      else out.set(board.group, [board]);
    }
    return out;
  }

  /** Any board, for the Random category. */
  random(seed: string | number | Rng = Date.now()): Board | null {
    if (this.boards.length === 0) return null;
    const rng: Rng = typeof seed === 'function' ? seed : makeRng(seed);
    return pick(rng, this.boards);
  }

  /** Boards whose title or group contains `query`, for the picker's search. */
  search(query: string): Board[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.boards;
    return this.boards.filter(
      (board) =>
        board.title.toLowerCase().includes(needle) || board.group.toLowerCase().includes(needle),
    );
  }
}

let cached: Promise<Rankings> | null = null;

/** Loads (once) and indexes the boards. Dynamic — only Tenaball reads them. */
export function loadRankings(): Promise<Rankings> {
  if (!cached) {
    cached = loadJson('rankings').then((payload) => new Rankings(payload as RawPayload));
  }
  return cached;
}
