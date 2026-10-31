import { loadJson } from './files';

/**
 * Event-scoped player pools.
 *
 * `pools.json` is written by `scripts/build_data.py` from `placements.json` and read here
 * in place through the `@data` alias.
 *
 * A pool is a fixed list of players and nothing else. Pick one in any game and
 * you get those players only — no region, no difficulty, no active/retired
 * split, because a pool of eighty is already the narrowest the games can go and
 * cutting it further leaves nothing to ask about. That is the whole feature:
 * the week the Globals are on, every game is about the Globals field.
 *
 * Two to start — the FNCS 2026 Global Championship field and the Esports World
 * Cup field, which Liquipedia files as `Reload Elite Series 2026 -
 * Championship`. A third is one entry in the notebook's `WANTED` list and no
 * code change here.
 *
 * Content from Liquipedia, CC-BY-SA 3.0. See CREDITS.md.
 */

export interface Pool {
  id: string;
  /** Short name for the picker card, e.g. "FNCS 2026 Globals". */
  label: string;
  blurb: string;
  /** The tournament the field was taken from. */
  event: string;
  /** Every final, for a field of several — the 2026 Solo FNCS's seven regions. `event` is the first. */
  events?: string[];
  /** Which of `events` each player was in, by page name. Only with `events`. */
  finals?: Record<string, number>;
  date: string;
  /** Page names, sorted. Entrants with no Liquipedia player page are absent. */
  players: string[];
  /**
   * Where each player finished, by page name: 1 is the winner, and a duo or
   * trio shares its place. Empty until the event has been played and the
   * export refreshed, and absent from a file written before cell 5 carried it.
   */
  placements?: Record<string, number>;
  /**
   * Career prize money from every tournament that started before this one, by
   * page name: what a player had won going in, which the published career
   * figure no longer shows once the event's prize is added to it. Tenaball's
   * upsets and disappointments seed on it. Absent from a file written before
   * cell 5 carried it.
   */
  earningsBefore?: Record<string, number>;
}

interface RawPayload {
  generated: string;
  pools: Pool[];
}

export class Pools {
  readonly generated: string;
  readonly pools: Pool[];

  private readonly byId = new Map<string, Pool>();

  constructor(payload: RawPayload) {
    this.generated = payload.generated;
    // Soonest event last, so the picker reads as a timeline.
    this.pools = [...payload.pools].sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const pool of this.pools) this.byId.set(pool.id, pool);
  }

  get(id: string | null): Pool | null {
    return id === null ? null : (this.byId.get(id) ?? null);
  }
}

let cached: Promise<Pools> | null = null;

/**
 * Loads (once) and indexes the pools.
 *
 * Resolves to an empty set rather than rejecting when the file is missing: a
 * pool is an optional extra, and a game that has never heard of the Globals
 * should still start.
 */
export function loadPools(): Promise<Pools> {
  if (!cached) {
    cached = loadJson('pools')
      .then((payload) => new Pools(payload as RawPayload))
      // A pool is an optional extra: a site that has never heard of the Globals
      // should still start every game.
      .catch(() => new Pools({ generated: '', pools: [] }));
  }
  return cached;
}
