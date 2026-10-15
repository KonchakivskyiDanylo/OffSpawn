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

/** One Div Cup final won: the day, the region's final, and the winning team. */
export interface DivCupWin {
  /** "YYYY-MM-DD". */
  date: string;
  /** Europe, NA Central, NA West, Brazil, Asia, Middle East or Oceania. */
  region: string;
  /** "C7S4". */
  season: string;
  /** One of C6S4's Practice Cups rather than a week of the season. */
  practice: boolean;
  week: number;
  mode: string | null;
  /** Roster ids; a winner with no Liquipedia page is "?Name". */
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
  /** Absent from a file written before 14 Oct 2026. */
  divcups?: DivCupWin[];
  /** Absent from a file written before 14 Oct 2026. */
  million?: { id: string; date: string }[];
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
  /** Every Div Cup final won, oldest first; empty in a file written before 14 Oct 2026. */
  readonly divcups: readonly DivCupWin[];
  /**
   * The day each player's prize money from tournament results first reached
   * $1M, oldest first ("?Name" for a winner with no page); empty before 14 Oct 2026.
   */
  readonly million: readonly { id: string; date: string }[];

  private readonly byPlayer = new Map<string, PlayerFacts>();
  /** event index -> player ids who were there. Built lazily, once. */
  private participants: Map<number, Set<string>> | null = null;
  /** event index -> player ids who won it. Built lazily, once. */
  private winners: Map<number, Set<string>> | null = null;
  private backToBack: Set<string> | null = null;
  private majorBackToBack: Set<string> | null = null;
  private fncsRuns: Map<string, number> | null = null;
  private majorRuns: Map<string, number> | null = null;

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
    this.divcups = payload.divcups ?? [];
    this.million = payload.million ?? [];
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
    this.backToBack ??= new Set([...this.fncsWinRuns].flatMap(([id, run]) => (run >= 2 ? [id] : [])));
    return this.backToBack;
  }

  /** Players who won two majors in a row — see `majorRounds`. */
  majorBackToBackWinners(): ReadonlySet<string> {
    this.majorBackToBack ??= new Set([...this.majorWinRuns].flatMap(([id, run]) => (run >= 2 ? [id] : [])));
    return this.majorBackToBack;
  }

  /**
   * Every major in order: each round of the FNCS as one, and each LAN — a
   * Globals, the World Cup finals, the 2022 Invitational, the 2026 Summit,
   * Reload's championship — as its own.
   *
   * Winning majors back to back is not winning the FNCS back to back (the
   * user, 15 Oct 2026: "Major tournament back to back isn't the same as fncs
   * back to back"). Scroll and Skyboy won EU's Major 1 and Major 2 of 2026,
   * two FNCS in a row, but lost the Summit in between.
   */
  get majorRounds(): HeadlineEvent[][] {
    const rounds = this.fncsRounds.map((round) => round.filter((event) => !event.lan));
    const lans = this.events.filter((event) => event.lan).map((event) => [event]);
    return [...rounds, ...lans].sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : 0));
  }

  /** Each winner's most FNCS rounds won in a row: a round they won nothing in ends the run. */
  get fncsWinRuns(): ReadonlyMap<string, number> {
    this.fncsRuns ??= this.winRuns(this.fncsRounds);
    return this.fncsRuns;
  }

  /**
   * Each winner's most majors won in a row. A round of the FNCS they did not
   * win ends the run, as on the FNCS's own count; so does a LAN they played
   * and lost. A LAN they were not at is passed over: most are by invitation or
   * qualified for separately, so missing one is not losing it.
   */
  get majorWinRuns(): ReadonlyMap<string, number> {
    this.majorRuns ??= this.winRuns(this.majorRounds, (round, id) => round[0].lan && !round.some((event) => this.playedAt(event.index).has(id) || this.wonAt(event.index).has(id)));
    return this.majorRuns;
  }

  private winRuns(
    rounds: readonly HeadlineEvent[][],
    passOver: (round: readonly HeadlineEvent[], id: string) => boolean = () => false,
  ): Map<string, number> {
    const best = new Map<string, number>();
    let running = new Map<string, number>();
    for (const round of rounds) {
      const next = new Map<string, number>();
      for (const [id, run] of running) if (passOver(round, id)) next.set(id, run);
      for (const event of round) {
        for (const id of this.wonAt(event.index)) next.set(id, (running.get(id) ?? 0) + 1);
      }
      for (const [id, run] of next) best.set(id, Math.max(best.get(id) ?? 0, run));
      running = next;
    }
    return best;
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
