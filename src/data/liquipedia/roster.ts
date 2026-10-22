import { COUNTRY_CODES } from './countries';
import { loadJson } from './files';

/**
 * The difficulty band a player sits in.
 *
 * A column in `players.json`, maintained by the notebook — the roster is the
 * only thing that knows it, so it is declared here. It used to live in
 * `data/types.ts` alongside an older import's domain model, which was
 * deleted once no game read that import any more.
 */
export type FameTier = 'easy' | 'medium' | 'hard';

/**
 * The Liquipedia roster.
 *
 * Reads `liquipedia_data/clean_data/fortnite/players.json` — the cleaned export
 * — directly, with no build step and no derived copy. Nothing here computes a
 * ranking or decides who is playable: `tier` and `fncs_wins` are columns in that
 * file, written by the notebook that maintains it. Re-tiering the roster means
 * editing one column and reloading; no code changes, and nothing to regenerate.
 *
 * The only source: every column, `fncs_wins` included, is Liquipedia's — the
 * FNCS count is read off the regional finals' results by scripts/build_data.py.
 *
 * Content from Liquipedia, CC-BY-SA 3.0. See CREDITS.md.
 */

/**
 * When the Liquipedia export behind `players.json` was taken.
 *
 * Hand-maintained: the export carries no timestamp column, and a file mtime
 * does not survive a clone. Bump it when you re-export.
 */
export const EXPORT_DATE = '2026-10-22';

/**
 * Where the roster comes from, for the attribution line every game shows.
 *
 * The licence link is the United States port, because that is the one
 * Liquipedia's own copyright page names and links.
 */
export const SOURCE = {
  name: 'Liquipedia',
  url: 'https://liquipedia.net/fortnite',
  license: 'CC BY-SA 3.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/us/',
} as const;

/**
 * One row of `roster.json`, or of `players.json` before the first build that
 * wrote it.
 *
 * `roster.json` is the same columns with empty values left out (see
 * `scripts/pipeline/site.py`), so everything but the page name and tier is
 * optional here and defaulted where it is read.
 */
export interface LiquipediaRow {
  /** Unique page name, e.g. `Aqua_(Japanese_player)`. */
  pagename: string;
  /** Competitive handle — what the UI shows. Left out when it is the page name. */
  id?: string;
  /** Former or alternate spellings, e.g. `Shark` for `shxrk`. */
  alternateid_list?: string[];
  status?: string | null;
  nationalities?: string[];
  region?: string | null;
  birthdate?: string | null;
  teampagename?: string | null;
  earnings?: number | null;
  /** Difficulty band, maintained in the dataset. `unused` never reaches a game. */
  tier: FameTier | 'unused';
  /**
   * Prize money per calendar year, as `earnings_2019`, `earnings_2020`, …
   *
   * An index signature because the years are a moving set: an export taken
   * next January carries an `earnings_2027` nothing had to be told about.
   */
  [year: `earnings_${number}`]: number | null | undefined;
  /**
   * Difficulty band *within* `region`, maintained in the same notebook.
   *
   * `tier` ranks all 5,678 rows against each other, which is the right answer
   * for "pick a difficulty" and the wrong one for "pick Asia, then pick a
   * difficulty": on the global ranking Asia, Oceania and the Middle East have
   * no Easy players at all. Optional, because a roster exported before the
   * column existed still has to load — those rows fall back to `tier`, and the
   * count under each difficulty card shows what that leaves.
   */
  region_tier?: FameTier | 'unused';
  fncs_wins?: number;
}

/** A roster row in the shape the games read. */
export interface RosterPlayer {
  /** Page name — unique, so it is the identity. */
  id: string;
  /** Competitive handle. */
  name: string;
  /** Other spellings this player answers to. */
  aliases: string[];
  /** ISO 3166-1 alpha-2, or null when no nationality is published. */
  country: string | null;
  countryName: string | null;
  /** Liquipedia's own region label, e.g. "North America". */
  region: string | null;
  birthDate: string | null;
  /** Age in whole years today, or null when no birth date is published. */
  age: number | null;
  earnings: number;
  /**
   * Prize money by calendar year, from the export's `earnings_YYYY` columns.
   *
   * A year with nothing published is simply absent. List reads it for
   * "everyone who cleared $100k in 2023" — a question the export could always
   * answer and nothing had ever asked it.
   */
  earningsByYear: Readonly<Record<number, number>>;
  /** False when no prize money is published, so the UI shows a dash not a zero. */
  earningsKnown: boolean;
  team: string | null;
  status: string | null;
  fncsWins: number;
  tier: FameTier;
  /** Difficulty band among players from the same region. */
  regionTier: FameTier;
  /** Always null — the export ships no headshots. Kept for `PlayerAvatar`. */
  photoUrl: null;
}

/** Age in whole years on `today` — List also asks it of the day an FNCS was won. */
export function ageOn(birthDate: string | null, today: Date): number | null {
  if (!birthDate) return null;
  const born = new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;
  let age = today.getFullYear() - born.getFullYear();
  const months = today.getMonth() - born.getMonth();
  if (months < 0 || (months === 0 && today.getDate() < born.getDate())) age--;
  return age;
}

/**
 * `Void_Esports` -> `Void Esports`.
 *
 * The export's team display names live in `teams.json`, which is not shipped;
 * of the 403 organisations actually referenced, 9 have a display name that this
 * does not reproduce exactly (`KoS_Esports` is really "Knights of Shadows").
 * A slightly-off org name is a cosmetic line under a player's handle, which is
 * not worth another megabyte of data.
 */
function teamName(pageName: string | null): string | null {
  if (!pageName) return null;
  return pageName.replace(/_\(.*\)$/, '').replace(/_/g, ' ');
}

/** Tier order to widen through when a pool is too small, closest first. */
const TIER_FALLBACK: Record<FameTier, FameTier[]> = {
  easy: ['easy', 'medium', 'hard'],
  medium: ['medium', 'easy', 'hard'],
  hard: ['hard', 'medium', 'easy'],
};

/** Options shared by both pool queries. */
export interface PoolOptions {
  /**
   * The caller's own filter, applied per tier — Higher or Lower drops players
   * with no birth date from an Age run, Fortnitedle drops handles of the wrong
   * length.
   */
  eligible?: (players: RosterPlayer[]) => RosterPlayer[];
  /**
   * A Liquipedia region label (`'Asia'`), or null for the whole roster. With a
   * region the band read is `regionTier`, because a global ranking has no Easy
   * players outside NA/EU/SA.
   */
  region?: string | null;
}

export class Roster {
  /** Everyone a game may use — `unused` rows are dropped on the way in. */
  readonly players: RosterPlayer[];

  private readonly byTier = new Map<FameTier, RosterPlayer[]>([
    ['easy', []],
    ['medium', []],
    ['hard', []],
  ]);

  /** region -> regionTier -> players. Built once, same shape as `byTier`. */
  private readonly byRegion = new Map<string, Map<FameTier, RosterPlayer[]>>();

  constructor(rows: readonly LiquipediaRow[], today: Date = new Date()) {
    this.players = [];
    for (const row of rows) {
      // The dataset's own opinion about who is playable. A row can be excluded
      // for any reason the notebook likes — no earnings, no longer with us — and
      // the games never need to know which.
      if (row.tier === 'unused') continue;

      const nationality = row.nationalities?.[0] ?? null;
      const earnings = row.earnings ?? 0;
      const earningsByYear: Record<number, number> = {};
      for (const [column, value] of Object.entries(row)) {
        const year = /^earnings_(\d{4})$/.exec(column);
        const amount = Number(value) || 0;
        if (year && amount > 0) earningsByYear[Number(year[1])] = amount;
      }
      this.players.push({
        id: row.pagename,
        name: row.id ?? row.pagename,
        aliases: row.alternateid_list ?? [],
        country: nationality ? (COUNTRY_CODES[nationality] ?? null) : null,
        countryName: nationality,
        region: row.region ?? null,
        birthDate: row.birthdate ?? null,
        age: ageOn(row.birthdate ?? null, today),
        earnings,
        earningsByYear,
        earningsKnown: earnings > 0,
        team: teamName(row.teampagename ?? null),
        status: row.status ? row.status.toLowerCase() : null,
        fncsWins: row.fncs_wins ?? 0,
        tier: row.tier,
        // A roster exported before the column existed still has to load, and
        // the global band is the only honest answer when there is no other.
        regionTier: row.region_tier && row.region_tier !== 'unused' ? row.region_tier : row.tier,
        photoUrl: null,
      });
    }
    for (const player of this.players) {
      this.byTier.get(player.tier)?.push(player);
      if (!player.region) continue;
      let bands = this.byRegion.get(player.region);
      if (!bands) {
        bands = new Map([
          ['easy', []],
          ['medium', []],
          ['hard', []],
        ]);
        this.byRegion.set(player.region, bands);
      }
      bands.get(player.regionTier)?.push(player);
    }
    this.regions = [...this.byRegion.entries()]
      .map(([region, bands]) => ({
        region,
        size: [...bands.values()].reduce((n, list) => n + list.length, 0),
      }))
      .sort((a, b) => b.size - a.size || (a.region < b.region ? -1 : 1))
      .map((entry) => entry.region);
  }

  /**
   * Region labels that have at least one playable row, biggest first.
   *
   * Read off the data rather than listed anywhere, so a region the export
   * starts publishing appears in the picker without a code change.
   */
  readonly regions: string[];

  /**
   * Exactly this tier, with no widening — what a difficulty card counts.
   *
   * Separate from `playersFor` on purpose: a card that says "0 players" and a
   * card that quietly shows you Medium players are different promises, and the
   * setup screen makes the first one and disables the option.
   */
  exactly(tier: FameTier, options: PoolOptions = {}): RosterPlayer[] {
    const { eligible, region } = options;
    const pool = region ? (this.byRegion.get(region)?.get(tier) ?? []) : (this.byTier.get(tier) ?? []);
    return eligible ? eligible(pool) : pool;
  }

  /**
   * The pool a game may draw from at one difficulty.
   *
   * `eligible` runs per tier, because whether a tier is big enough is a
   * question about the players the game can actually use. If that leaves fewer
   * than `minimum`, the next-closest tier is folded in rather than failing —
   * within the chosen region, never across regions, because "Asia" is the
   * promise the player made and the difficulty is the one they can live with.
   */
  playersFor(
    tier: FameTier,
    options: PoolOptions & { minimum?: number } = {},
  ): RosterPlayer[] {
    const { minimum = 1, ...rest } = options;
    const out: RosterPlayer[] = [];
    for (const step of TIER_FALLBACK[tier]) {
      out.push(...this.exactly(step, rest));
      if (out.length >= minimum) break;
    }
    return out;
  }
}

let cached: Promise<Roster> | null = null;

/**
 * Loads (once) and indexes the roster.
 *
 * Imported dynamically so the player rows stay out of the app bundle and only
 * download when someone opens a game that reads them — or when the home page
 * fetches them ahead, see `Home`. `roster.json` is the slim copy the build
 * writes; `players.json` has the same rows in full, for data built before it.
 */
export function loadRoster(): Promise<Roster> {
  if (!cached) {
    cached = loadJson('roster')
      .catch(() => loadJson('players'))
      .then((rows) => new Roster(rows as LiquipediaRow[]));
  }
  return cached;
}
