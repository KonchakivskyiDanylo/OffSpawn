import type { GamePayloads, Outcome } from '@/analytics/types';
import type { Bios } from '@/data/liquipedia/bios';
import type { Facts, HeadlineEvent } from '@/data/liquipedia/facts';
import type { Majors } from '@/data/liquipedia/majors';
import { orgName, type Orgs } from '@/data/liquipedia/orgs';
import type { FameTier, Roster, RosterPlayer } from '@/data/liquipedia/roster';
import { dayMonthYear, ordinal } from '@/lib/format';
import { makeRng, shuffle, type Rng } from '@/lib/rng';
import type { Level } from '@/games/shared/levels';
import { parseLobby, roundLabel } from '@/games/shared/lobbies';

/**
 * Pure logic for Rewind: moments from competitive Fortnite, dealt in a jumble,
 * to be put back in order oldest first.
 *
 * Built to the user's roadmap (2 Oct 2026), from the moments the data has
 * dates for, and widened on 14 Oct 2026 ("Needs more categories, without it
 * not really interesting. Maybe also like famous players first earnings. Or
 * first fncs finals"). No card carries its year in its words — "the 2024
 * Global Championship" would sort itself — so a LAN is named by who won it.
 *
 * The check is Pyramid's: everything in the right place locks green, and the
 * levels differ in how far apart the moments are and how many checks you get.
 */

export type MomentKind =
  | 'lan-win'
  | 'first-title'
  | 'title'
  | 'round'
  | 'first-final'
  | 'duo'
  | 'first-money'
  | 'best-year'
  | 'org-title'
  | 'signing'
  | 'departure'
  | 'founded';

export interface Moment {
  /** Unique within a deal. */
  id: string;
  /** ISO day: the day it happened, or 1 January for a moment the data dates by its year. */
  date: string;
  /**
   * True when only the year is known. Prize money is recorded per calendar
   * year, so "Bugha’s first prize money" is 2018 and no day of it; the deal
   * gives such a moment the whole year to itself, which keeps the order honest.
   */
  wholeYear?: boolean;
  text: string;
  icon: string;
  kind: MomentKind;
  /** How well known: the level deals only moments at or above its bands. */
  tier: FameTier;
  /** Roster ids the moment is about, so one player does not fill a deal. */
  players: string[];
  /** Org ids the moment is about, for the same reason. */
  orgs: string[];
}

/** Every kind but the later titles and the FNCS rounds, which only regulars can date. */
const EASY_KINDS: MomentKind[] = [
  'lan-win',
  'first-title',
  'first-final',
  'duo',
  'first-money',
  'best-year',
  'org-title',
  'signing',
  'departure',
  'founded',
];
const ALL_KINDS: MomentKind[] = [...EASY_KINDS, 'title', 'round'];

/**
 * Seven, eight and ten moments (the user, 14 Oct 2026: "maybe overall more
 * events, like 7-8-10"). The gaps are a little wider than the five-to-seven
 * deals had (150, 60 and 21 days), so a longer line reads about as easily.
 * Each deals 2,000 seeds out of 2,000 on this data and only starts failing far
 * wider — Easy around 450 days, Medium 365, Hard past 180 — and the prize-money
 * years still turn up in most deals.
 */
export const LEVELS: Record<
  Level,
  { size: number; gapDays: number; tiers: FameTier[]; kinds: MomentKind[]; lives: number }
> = {
  easy: {
    size: 7,
    gapDays: 180,
    tiers: ['easy'],
    kinds: EASY_KINDS,
    lives: Number.POSITIVE_INFINITY,
  },
  medium: {
    size: 8,
    gapDays: 75,
    tiers: ['easy', 'medium'],
    kinds: ALL_KINDS,
    lives: 2,
  },
  hard: {
    size: 10,
    gapDays: 30,
    tiers: ['easy', 'medium', 'hard'],
    kinds: ALL_KINDS,
    lives: 1,
  },
};

/** At most this many of one kind (unless the pile has too few kinds), and about one player or org, in a deal. */
const PER_KIND = 2;
const PER_PLAYER = 2;
/**
 * At most this many moments known only by their year. Each fills a whole year
 * of the line, and a board of them would be a board of years, not moments.
 */
const PER_DEAL_YEARS = 2;

/** Orgs whose signings, departures, titles and foundings are worth a card: the richest with a page. */
const NOTABLE_ORGS = 60;
const EASY_ORGS = 20;

/** Two players are a duo worth a card when they reached this many FNCS grand finals side by side. */
const DUO_FINALS = 3;

const TIER_RANK: Record<FameTier, number> = { easy: 0, medium: 1, hard: 2 };
const lesser = (a: FameTier, b: FameTier): FameTier => (TIER_RANK[a] >= TIER_RANK[b] ? a : b);

export interface Sources {
  roster: Roster;
  facts: Facts;
  bios: Bios | null;
  orgs: Orgs | null;
  /** For the duos; without career_path.json there are none. */
  majors?: Majors | null;
}

const names = (players: readonly RosterPlayer[]) =>
  players.length <= 2
    ? players.map((p) => p.name).join(' & ')
    : `${players.slice(0, -1).map((p) => p.name).join(', ')} & ${players[players.length - 1].name}`;

/** "NRG’s", "Team Falcons’". */
const possessive = (name: string) => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

/**
 * An FNCS grand final as the glossary counts them ("FNCS grand finals
 * played"): every regional one, and the FNCS played offline — the Global
 * Championships, the 2022 Invitational, the 2026 Summit.
 */
const isFncsFinal = (event: HeadlineEvent) => event.kind === 'fncs' || event.kind === 'global';
/** An FNCS title: a regional grand final, the one `fncsWinDates` counts. */
const isRegionalFinal = (event: HeadlineEvent) => event.kind === 'fncs' && !event.lan;

/** Every moment the data can date. */
export function allMoments({ roster, facts, bios, orgs, majors = null }: Sources): Moment[] {
  const byId = new Map(roster.players.map((player) => [player.id, player]));
  const out: Moment[] = [];

  // Who won each LAN, the event named without its year.
  for (const event of facts.events) {
    if (!event.lan) continue;
    const winners = [...facts.wonAt(event.index)].flatMap((id) => byId.get(id) ?? []);
    if (winners.length === 0) continue;
    const title = roundLabel(event.short.replace(/\s+-\s+/g, ' ')).replace(/^Major 1 /, '');
    out.push({
      id: `lan:${event.index}`,
      date: event.date,
      text: `${names(winners)} win${winners.length === 1 ? 's' : ''} the ${title}`,
      icon: '🏆',
      kind: 'lan-win',
      tier: 'easy',
      players: winners.map((p) => p.id),
      orgs: [],
    });
  }

  // A season's FNCS grand finals, for the seasons whose names carry no year.
  for (const round of facts.fncsRounds) {
    const label = roundLabel(parseLobby(round[0].name).round);
    if (/^Major/.test(label) || /\b20\d\d\b/.test(label)) continue;
    out.push({
      id: `round:${round[0].date}`,
      date: round[0].date,
      text: `The FNCS ${label} grand finals`,
      icon: '📅',
      kind: 'round',
      tier: 'medium',
      players: [],
      orgs: [],
    });
  }

  for (const player of roster.players) {
    const record = facts.of(player.id);

    // FNCS titles: the first for anyone, the later ones for the players with several.
    record.fncsWinDates.forEach((date, index) => {
      out.push({
        id: `title:${player.id}:${index}`,
        date,
        text: `${player.name}’s ${index === 0 ? 'first' : ordinal(index + 1)} FNCS title`,
        icon: index === 0 ? '🥇' : '🏅',
        kind: index === 0 ? 'first-title' : 'title',
        tier: index === 0 ? player.tier : lesser(player.tier, 'medium'),
        players: [player.id],
        orgs: [],
      });
    });

    // The first FNCS grand final reached — "first fncs finals", in the user's
    // words. The export starts at the first FNCS (Season X, 2019), so there is
    // no earlier one it could be missing.
    const debut = record.played
      .map((index) => facts.events[index])
      .filter(isFncsFinal)
      .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
    if (debut) {
      out.push({
        id: `final:${player.id}`,
        date: debut.date,
        text: `${player.name}’s first FNCS final`,
        icon: '🎟️',
        kind: 'first-final',
        tier: player.tier,
        players: [player.id],
        orgs: [],
      });
    }

    // Prize money: the first year with any, and the best year. Liquipedia
    // records earnings per calendar year and nothing finer, so these are dated
    // by the year — the honest reading of "first earnings".
    const years = Object.keys(player.earningsByYear)
      .map(Number)
      .sort((a, b) => a - b);
    if (years.length === 0) continue;
    out.push({
      id: `money:${player.id}`,
      date: `${years[0]}-01-01`,
      wholeYear: true,
      text: `${player.name}’s first prize money`,
      icon: '💵',
      kind: 'first-money',
      tier: player.tier,
      players: [player.id],
      orgs: [],
    });
    // A one-year career's best year is its first; that card already exists.
    if (years.length < 2) continue;
    const best = years.reduce((a, b) => (player.earningsByYear[b] > player.earningsByYear[a] ? b : a));
    out.push({
      id: `best:${player.id}`,
      date: `${best}-01-01`,
      wholeYear: true,
      text: `${player.name}’s best year for prize money`,
      icon: '💰',
      kind: 'best-year',
      tier: player.tier,
      players: [player.id],
      orgs: [],
    });
  }

  // Duos: two players' first FNCS grand final side by side, for the pairs who
  // reached a few together — the ones people know as a duo. Teammates are the
  // players who finished in the same place, as in Career Path.
  if (majors) {
    const finals = new Map(facts.events.filter(isFncsFinal).map((event) => [event.name, event]));
    const together = new Map<string, string[]>();
    for (const tournament of majors.tournaments) {
      if (!finals.has(tournament.name)) continue;
      for (const finish of majors.fieldOf(tournament.name)) {
        const team = finish.players.filter((id) => byId.has(id)).sort();
        for (let i = 0; i < team.length; i++) {
          for (let j = i + 1; j < team.length; j++) {
            const key = `${team[i]}|${team[j]}`;
            together.set(key, [...(together.get(key) ?? []), tournament.date]);
          }
        }
      }
    }
    for (const [key, dates] of together) {
      if (dates.length < DUO_FINALS) continue;
      // The better-known name first: "Bugha & Mero".
      const pair = key
        .split('|')
        .map((id) => byId.get(id)!)
        .sort((a, b) => b.earnings - a.earnings);
      out.push({
        id: `duo:${key}`,
        date: dates.sort()[0],
        text: `${names(pair)}’s first FNCS final together`,
        icon: '🤝',
        kind: 'duo',
        tier: lesser(pair[0].tier, pair[1].tier),
        players: pair.map((p) => p.id),
        orgs: [],
      });
    }
  }

  const notable = (orgs?.orgs ?? []).filter((org) => org.hasPage).slice(0, NOTABLE_ORGS);
  const orgTier = new Map(notable.map((org, index) => [org.id, (index < EASY_ORGS ? 'easy' : 'medium') as FameTier]));

  if (bios?.dated) {
    // Signings and departures: only with dated stints, only at the orgs people know.
    for (const player of roster.players) {
      for (const stint of bios.stintsOf(player.id)) {
        const tier = orgTier.get(stint.org);
        if (!tier) continue;
        const name = orgName(stint.org, orgs);
        if (stint.from) {
          out.push({
            id: `signing:${player.id}:${stint.org}:${stint.from}`,
            date: stint.from,
            text: `${player.name} joins ${name}`,
            icon: '✍️',
            kind: 'signing',
            tier: lesser(player.tier, tier),
            players: [player.id],
            orgs: [stint.org],
          });
        }
        if (stint.to) {
          out.push({
            id: `departure:${player.id}:${stint.org}:${stint.to}`,
            date: stint.to,
            text: `${player.name} leaves ${name}`,
            icon: '👋',
            kind: 'departure',
            tier: lesser(player.tier, tier),
            players: [player.id],
            orgs: [stint.org],
          });
        }
      }
    }

    // An org's first FNCS title: the first regional final won by someone who
    // was with it that day. An open stint only counts for a player the org
    // lists today — otherwise the leave simply went unrecorded.
    const firstTitle = new Map<string, string>();
    for (const event of facts.events) {
      if (!isRegionalFinal(event)) continue;
      for (const id of facts.wonAt(event.index)) {
        for (const stint of bios.stintsOf(id)) {
          if (!orgTier.has(stint.org) || !stint.from || stint.from > event.date) continue;
          if (stint.to ? stint.to < event.date : !orgs?.get(stint.org)?.current.includes(id)) continue;
          const was = firstTitle.get(stint.org);
          if (!was || event.date < was) firstTitle.set(stint.org, event.date);
        }
      }
    }
    for (const [org, date] of firstTitle) {
      out.push({
        id: `org-title:${org}`,
        date,
        text: `${possessive(orgName(org, orgs))} first FNCS title`,
        icon: '🎖️',
        kind: 'org-title',
        tier: orgTier.get(org)!,
        players: [],
        orgs: [org],
      });
    }
  }

  // Foundings, from the Fortnite years on: FaZe Clan's 2010 sorts itself.
  for (const org of notable) {
    if (!org.founded || org.founded < '2017-01-01') continue;
    out.push({
      id: `founded:${org.id}`,
      date: org.founded,
      text: `${org.name} is founded`,
      icon: '🏢',
      kind: 'founded',
      tier: orgTier.get(org.id) ?? 'medium',
      players: [],
      orgs: [org.id],
    });
  }
  return out;
}

const DAY = 86_400_000;

/** The first and last day a moment can have happened, as epoch ms. */
function span(moment: Moment): [number, number] {
  const start = Date.parse(moment.date);
  return [start, moment.wholeYear ? Date.parse(`${moment.date.slice(0, 4)}-12-31`) : start];
}

/** Whole days between two moments: from the end of the earlier to the start of the later, 0 if they overlap. */
export function daysApart(a: Moment, b: Moment): number {
  const [aStart, aEnd] = span(a);
  const [bStart, bEnd] = span(b);
  return Math.max(0, bStart - aEnd, aStart - bEnd) / DAY;
}

/** When it happened, as the card shows it once it is revealed: "27 Jul 2019", or "2019". */
export function when(moment: Moment): string {
  return moment.wholeYear ? moment.date.slice(0, 4) : dayMonthYear(moment.date);
}

/**
 * One deal: the level's number of moments, every two at least its gap apart,
 * no more than two of a kind or about one player or org. Kinds take turns
 * being drawn from, so the cards are not all signings because signings are
 * most of the pile. Null when the pile cannot make one.
 */
export function deal(moments: readonly Moment[], level: Level, rng: Rng): Moment[] | null {
  const config = LEVELS[level];
  const pile = moments.filter((moment) => config.kinds.includes(moment.kind) && config.tiers.includes(moment.tier));
  const byKind = new Map<MomentKind, Moment[]>();
  for (const moment of pile) {
    const list = byKind.get(moment.kind);
    if (list) list.push(moment);
    else byKind.set(moment.kind, [moment]);
  }
  if (byKind.size === 0) return null;
  // With few kinds in the pile — no signings before bios.json exists — each may fill more seats.
  const perKind = Math.max(PER_KIND, Math.ceil(config.size / byKind.size));

  for (let attempt = 0; attempt < 100; attempt++) {
    const chosen: Moment[] = [];
    const kinds = new Map<MomentKind, number>();
    const about = new Map<string, number>();
    let years = 0;
    const fits = (moment: Moment) =>
      (kinds.get(moment.kind) ?? 0) < perKind &&
      (!moment.wholeYear || years < PER_DEAL_YEARS) &&
      [...moment.players, ...moment.orgs].every((id) => (about.get(id) ?? 0) < PER_PLAYER) &&
      chosen.every((other) => daysApart(other, moment) >= config.gapDays);
    let stalled = 0;
    while (chosen.length < config.size && stalled < 60) {
      const kindList = [...byKind.keys()].filter((kind) => (kinds.get(kind) ?? 0) < perKind);
      if (kindList.length === 0) break;
      const kind = kindList[Math.floor(rng() * kindList.length)];
      const options = byKind.get(kind)!;
      const moment = options[Math.floor(rng() * options.length)];
      if (!fits(moment)) {
        stalled++;
        continue;
      }
      chosen.push(moment);
      kinds.set(moment.kind, (kinds.get(moment.kind) ?? 0) + 1);
      for (const id of [...moment.players, ...moment.orgs]) about.set(id, (about.get(id) ?? 0) + 1);
      if (moment.wholeYear) years++;
    }
    if (chosen.length === config.size) return chosen.sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return null;
}

// ------------------------------------------------------------------ round --

export interface GameState {
  level: Level;
  /** Oldest first: the answer. */
  solution: Moment[];
  /** As the player has them, top to bottom. */
  order: Moment[];
  locked: ReadonlySet<string>;
  wrong: ReadonlySet<string>;
  checks: number;
  lives: number;
  status: 'playing' | 'won' | 'lost';
  gaveUp: boolean;
}

/** Right where it stands: the same day as the moment that belongs there, so two on one day go either way. */
export function rightAt(state: Pick<GameState, 'solution' | 'order'>, index: number): boolean {
  return state.order[index].date === state.solution[index].date;
}

export function inPlace(state: GameState): number {
  return state.order.filter((_, index) => rightAt(state, index)).length;
}

/** A shuffle with at most one moment already in its place. */
export function createGame(solution: Moment[], level: Level, seed: string = String(Date.now())): GameState {
  const rng = makeRng(seed);
  let order = shuffle(rng, solution);
  for (let tries = 0; tries < 20; tries++) {
    if (order.filter((moment, index) => moment.date === solution[index].date).length <= 1) break;
    order = shuffle(rng, solution);
  }
  return {
    level,
    solution,
    order,
    locked: new Set(),
    wrong: new Set(),
    checks: 0,
    lives: LEVELS[level].lives,
    status: 'playing',
    gaveUp: false,
  };
}

/** Swap two places. A locked moment stays put. */
export function swap(state: GameState, a: number, b: number): GameState {
  if (state.status !== 'playing' || a === b) return state;
  if (state.locked.has(state.order[a].id) || state.locked.has(state.order[b].id)) return state;
  const order = [...state.order];
  [order[a], order[b]] = [order[b], order[a]];
  const wrong = new Set(state.wrong);
  wrong.delete(order[a].id);
  wrong.delete(order[b].id);
  return { ...state, order, wrong };
}

/** Locks everything in its place; the rest turns red. A check that is not perfect costs a life. */
export function check(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  const locked = new Set(state.locked);
  const wrong = new Set<string>();
  state.order.forEach((moment, index) => (rightAt(state, index) ? locked.add(moment.id) : wrong.add(moment.id)));
  const checks = state.checks + 1;
  if (wrong.size === 0) return { ...state, locked, wrong, checks, status: 'won' };
  const lives = state.lives - 1;
  return { ...state, locked, wrong, checks, lives, status: lives <= 0 ? 'lost' : 'playing' };
}

export function giveUp(state: GameState): GameState {
  return state.status === 'playing' ? { ...state, status: 'lost', gaveUp: true } : state;
}

export function record(state: GameState): { outcome: Outcome; r: GamePayloads['rewind'] } {
  const placed = new Set(state.order.filter((_, index) => rightAt(state, index)).map((moment) => moment.id));
  return {
    outcome: state.status === 'won' ? 'won' : state.gaveUp ? 'gave-up' : 'lost',
    r: {
      puzzle: { id: `rewind:${state.level}`, name: `Rewind — ${state.level}` },
      items: state.solution.map((moment) => ({ id: moment.id, name: moment.text, placed: placed.has(moment.id) })),
      checks: state.checks,
    },
  };
}
