import { loadJson } from './files';
import type { RosterPlayer } from './roster';

/**
 * Career facts `players.json` cannot answer.
 *
 * `facts.json` is written by `scripts/build_data.py` from `tournaments.json` and
 * `placements.json`, and read here in place through the `@data` alias — the
 * same contract as `players.json`: no build step, no derived copy.
 *
 * It exists because the criteria games were starved. Griefer, Tic Tac Toe and
 * Connections generated most of their rules from country and region alone,
 * which is exactly why a Griefer board about "competes in Brazil" was solvable
 * by reading the flags rather than knowing the players. Where a player *won*,
 * how many LANs they turned up to, which headline events they played — all of
 * it is in the export and none of it was reaching a game.
 *
 * Deliberately no `tier` column: difficulty joins from `players.json` by page
 * name, so re-tiering the roster re-tiers every game and this never goes stale.
 *
 * Content from Liquipedia, CC-BY-SA 3.0. See CREDITS.md.
 */

/** What kind of event this is. `lan` is a venue, the rest are brackets. */
export type EventKind = 'global' | 'fncs' | 'lan' | 'major';

/** One row of `facts.json`'s `events`. */
interface RawEvent {
  name: string;
  short: string;
  date: string;
  kind: EventKind;
  lan: boolean;
  region: string | null;
  mode: string | null;
  prizePool: number | null;
}

interface RawPlayer {
  id: string;
  played: number[];
  won: number[];
  apps: number;
  lanApps: number;
  fncsApps: number;
  wins: { global: number; fncs: number; lan: number; major: number };
  winRegions: string[];
  winYears: number[];
  /** Absent from a file written before the appendix cell carried it. */
  podium?: number[];
}

/** One team's result at a season event: [event, finish, player ids]. */
type RawSeasonTeam = [number, number, string[]];

interface RawSeason {
  year: number;
  events: string[];
  teams: RawSeasonTeam[];
}

/**
 * A finished List category: the Div Cup and Performance Evaluation lists,
 * built by `derived.py` from events `facts.json` does not otherwise carry.
 */
export interface PlayerList {
  id: string;
  title: string;
  subtitle: string;
  /** Page names, as roster ids. */
  players: string[];
}

interface RawPayload {
  generated: string;
  events: RawEvent[];
  players: RawPlayer[];
  /** Absent from a file written before the season block existed. */
  season?: RawSeason;
  /** Absent from a file written before the Div Cup lists existed. */
  lists?: PlayerList[];
}

/** A player's finish at one season event, and who they played it with. */
export interface SeasonResult {
  finish: number;
  /** Every player on the team, this one included. */
  team: readonly string[];
}

/**
 * One year's big events — for 2026: EWC, the Globals, the Summit and FNCS
 * Majors 1 and 2 — and everyone's finish at each.
 */
export interface Season {
  year: number;
  /** Short names, in the order `results` lists them. */
  events: readonly string[];
  /** Player id -> their result at each event, null where they were not there. */
  results: ReadonlyMap<string, readonly (SeasonResult | null)[]>;
}

export interface HeadlineEvent extends RawEvent {
  /** Index into `Facts.events` — what `played` and `won` hold. */
  index: number;
  year: number;
}

export interface PlayerFacts {
  id: string;
  played: readonly number[];
  won: readonly number[];
  /** Every tournament in the export, not just headline ones. */
  apps: number;
  lanApps: number;
  fncsApps: number;
  wins: { global: number; fncs: number; lan: number; major: number };
  /** Where each won event was *held* — a Globals in Copenhagen reads Europe. */
  winRegions: readonly string[];
  winYears: readonly number[];
  /**
   * Regions of the online regional FNCS finals this player won.
   *
   * Not `winRegions`, which is where any won event was held: Cooper won the
   * 2023 Globals in Copenhagen and so "won in Europe", which nobody means by
   * it. A Globals, the 2022 Invitational and the 2026 Summit are LANs with
   * every region in them, so they are left out — this is "won the EU FNCS".
   */
  fncsWinRegions: readonly string[];
  /** Years this player won a regional FNCS final — the same finals as above. */
  fncsWinYears: readonly number[];
  /** The dates of those wins, oldest first. */
  fncsWinDates: readonly string[];
  /** Headline events this player finished in the top 3 of, as indices like `played`. */
  podium: readonly number[];
}

/** What a player with no recorded results looks like, so callers never branch. */
const NONE: PlayerFacts = {
  id: '',
  played: [],
  won: [],
  apps: 0,
  lanApps: 0,
  fncsApps: 0,
  wins: { global: 0, fncs: 0, lan: 0, major: 0 },
  winRegions: [],
  winYears: [],
  fncsWinRegions: [],
  fncsWinYears: [],
  fncsWinDates: [],
  podium: [],
};

/**
 * An FNCS title: a regional grand final, played online.
 *
 * Not a Global Championship, the 2022 Invitational or the 2026 Summit, though
 * all three carry the FNCS name. A Globals is its own title, and counting it
 * here made Cooper an "FNCS winner in 2023" when the FNCS count every game
 * shows (`players.json`, counted from the same finals) has him on none. This keeps "Won
 * FNCS in 2023" and "Won EU FNCS" about the same finals that count does.
 */
function isRegionalFinal(event: RawEvent): boolean {
  return event.kind === 'fncs' && !event.lan;
}

/**
 * The 2019 World Cup finals are a major LAN, not a Global Championship (the
 * user, 13 Oct 2026: "world cup isn't great in this category"). `derived.py`
 * writes them as `lan` now; a file built before that still says `global`.
 */
function readKind(event: RawEvent): EventKind {
  return event.kind === 'global' && /^Fortnite World Cup/.test(event.name) ? 'lan' : event.kind;
}

export class Facts {
  readonly generated: string;
  readonly events: HeadlineEvent[];
  /** Null until `build_data.py` has written the season block. */
  readonly season: Season | null;
  /** Empty until `build_data.py` has written the Div Cup lists. */
  readonly lists: readonly PlayerList[];

  private readonly byPlayer = new Map<string, PlayerFacts>();
  /** event index -> player ids who were there. Built lazily, once. */
  private participants: Map<number, Set<string>> | null = null;
  /** event index -> player ids who won it. Built lazily, once. */
  private winners: Map<number, Set<string>> | null = null;
  private backToBack: Set<string> | null = null;

  constructor(payload: RawPayload) {
    this.generated = payload.generated;
    this.events = payload.events.map((event, index) => ({
      ...event,
      kind: readKind(event),
      index,
      year: Number(event.date.slice(0, 4)),
    }));
    for (const player of payload.players) {
      const regional = player.won.map((index) => payload.events[index]).filter(
        (event) => event && isRegionalFinal(event),
      );
      this.byPlayer.set(player.id, {
        ...player,
        // Counted from the events as read, so a World Cup win is not a Globals win in an older file either.
        wins: { ...player.wins, global: player.won.filter((index) => this.events[index]?.kind === 'global').length },
        fncsWinRegions: [
          ...new Set(regional.flatMap((event) => (event.region ? [event.region] : []))),
        ].sort(),
        fncsWinYears: [...new Set(regional.map((event) => Number(event.date.slice(0, 4))))].sort(),
        fncsWinDates: regional.map((event) => event.date).sort(),
        podium: player.podium ?? [],
      });
    }
    this.season = payload.season ? readSeason(payload.season) : null;
    this.lists = payload.lists ?? [];
  }

  /** This player's facts, or an all-zero record when they have no results. */
  of(playerId: string): PlayerFacts {
    return this.byPlayer.get(playerId) ?? NONE;
  }

  has(playerId: string): boolean {
    return this.byPlayer.has(playerId);
  }

  /** Everyone recorded at one headline event. */
  playedAt(eventIndex: number): ReadonlySet<string> {
    if (!this.participants) {
      const map = new Map<number, Set<string>>();
      for (const [id, facts] of this.byPlayer) {
        for (const index of facts.played) {
          let set = map.get(index);
          if (!set) map.set(index, (set = new Set()));
          set.add(id);
        }
      }
      this.participants = map;
    }
    return this.participants.get(eventIndex) ?? new Set();
  }

  /** Everyone who won one headline event — one team, so two or three names. */
  wonAt(eventIndex: number): ReadonlySet<string> {
    if (!this.winners) {
      const map = new Map<number, Set<string>>();
      for (const [id, facts] of this.byPlayer) {
        for (const index of facts.won) {
          let set = map.get(index);
          if (!set) map.set(index, (set = new Set()));
          set.add(id);
        }
      }
      this.winners = map;
    }
    return this.winners.get(eventIndex) ?? new Set();
  }

  /**
   * Everyone this player won a regional FNCS final with: the rest of the
   * winning duo or trio, over every title. Peterbot's five are Cold, Ritual,
   * Pollo and Bylah.
   */
  fncsPartners(playerId: string): Set<string> {
    const partners = new Set<string>();
    for (const index of this.of(playerId).won) {
      if (!isRegionalFinal(this.events[index])) continue;
      for (const id of this.wonAt(index)) if (id !== playerId) partners.add(id);
    }
    return partners;
  }

  /**
   * The same partners with how many of those titles each shared: Pollo is on
   * more of Peterbot's than Bylah is. Contextinho weighs a pair by it.
   */
  fncsTitlesWith(playerId: string): Map<string, number> {
    const titles = new Map<string, number>();
    for (const index of this.of(playerId).won) {
      if (!isRegionalFinal(this.events[index])) continue;
      for (const id of this.wonAt(index)) if (id !== playerId) titles.set(id, (titles.get(id) ?? 0) + 1);
    }
    return titles;
  }

  /**
   * Rounds of the FNCS: every region's grand final inside a week of each other.
   *
   * Clustered on the date rather than parsed out of the name, because the name
   * has been "FNCS: Season X", "C2S1: FNCS", "FNCS 2023 - Major 1" and "FNCS
   * 2025 - Major 3" and the dates have been the dates throughout. A cluster of
   * fewer than four regions is a one-off nobody could qualify for — a Global
   * Championship, an invitational — and is not a round.
   */
  get fncsRounds(): HeadlineEvent[][] {
    const finals = this.events
      .filter((event) => event.kind === 'fncs')
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const rounds: HeadlineEvent[][] = [];
    let current: HeadlineEvent[] = [];
    for (const event of finals) {
      const gap = current.length
        ? (Date.parse(event.date) - Date.parse(current[current.length - 1].date)) / 86_400_000
        : 0;
      if (current.length && gap > 7) {
        rounds.push(current);
        current = [];
      }
      current.push(event);
    }
    if (current.length) rounds.push(current);
    return rounds.filter((round) => round.length >= 4);
  }

  /** Players who won two rounds of the FNCS in a row, in any regions. */
  backToBackWinners(): ReadonlySet<string> {
    if (!this.backToBack) {
      const out = new Set<string>();
      let previous = new Set<string>();
      for (const round of this.fncsRounds) {
        const here = new Set(round.flatMap((event) => [...this.wonAt(event.index)]));
        for (const id of here) if (previous.has(id)) out.add(id);
        previous = here;
      }
      this.backToBack = out;
    }
    return this.backToBack;
  }

  /**
   * Events worth naming in a rule.
   *
   * A regional FNCS grand final is a fine thing to have played at and a poor
   * thing to be asked about — there are well over a hundred of them and their
   * names differ by one word. Globals and LANs are the ones people remember.
   */
  get headlineEvents(): HeadlineEvent[] {
    return this.events.filter((event) => event.kind === 'global' || event.lan);
  }

  /**
   * Roster players with enough recorded history to be a fair answer.
   *
   * Passed to `roster.playersFor` as its `eligible` filter, so a difficulty
   * card counts answerable players rather than rows in the export.
   */
  readonly eligible =
    (minApps: number) =>
    (players: readonly RosterPlayer[]): RosterPlayer[] =>
      players.filter((player) => this.of(player.id).apps >= minApps);
}

/**
 * Indexes the season block by player.
 *
 * A player listed twice at one event keeps the better finish: Liquipedia has
 * Astell in two different duos at the 2026 Major 2 Asia final.
 */
function readSeason(raw: RawSeason): Season {
  const results = new Map<string, (SeasonResult | null)[]>();
  for (const [event, finish, team] of raw.teams) {
    for (const id of team) {
      let row = results.get(id);
      if (!row) results.set(id, (row = raw.events.map(() => null)));
      const was = row[event];
      if (!was || finish < was.finish) row[event] = { finish, team };
    }
  }
  return { year: raw.year, events: raw.events, results };
}

let cached: Promise<Facts> | null = null;

/** Loads (once) and indexes the career facts. Dynamic — only on demand. */
export function loadFacts(): Promise<Facts> {
  if (!cached) {
    cached = loadJson('facts').then((payload) => new Facts(payload as RawPayload));
  }
  return cached;
}
