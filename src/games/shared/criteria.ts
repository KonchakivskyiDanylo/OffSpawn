import type { Facts } from '@/data/liquipedia/facts';
import type { Orgs } from '@/data/liquipedia/orgs';
import type { RosterPlayer } from '@/data/liquipedia/roster';
import { countShort, PLATFORM_META, type Socials } from '@/data/socials';
import { moneyShort } from '@/lib/format';
import { namedPlayer, namesakesOf } from '@/lib/text';

/**
 * Reusable player predicates.
 *
 * Griefer, Tic Tac Toe and Connections all need "does this player satisfy X",
 * so the criteria live in one place. Every criterion carries its matching
 * players, which is what lets the puzzle generators reject impossible boards
 * before showing them.
 *
 * Rebuilt on the Liquipedia export. The previous version ran on an older
 * 316-player import and could only really answer two questions — of the 21
 * criteria it produced, 16 were a country or a region. That is why a Griefer
 * board reading "every player here competes in Brazil" was solvable without
 * knowing a single player: the cards carried flags, and the flags were the
 * answer. Cards now show the handle alone, and the criteria below are varied
 * enough that reading one off a card is no longer possible anyway.
 */

export type CriterionKind =
  | 'country'
  | 'region'
  | 'org'
  | 'fncs-winner'
  | 'global-winner'
  | 'lan-winner'
  | 'tournament-winner'
  | 'earnings'
  | 'fncs-wins'
  | 'fncs-count'
  | 'fncs-back-to-back'
  | 'fncs-with'
  | 'lan-podium'
  | 'won-fncs-region'
  | 'won-fncs-year'
  | 'played-event'
  | 'age'
  // Added for Box Fight on 14 Oct 2026; Connections' and Griefer's whitelists leave them out.
  | 'fncs-format'
  | 'fncs-years'
  | 'young-winner'
  | 'world-cup'
  | 'globals-played'
  // Hard Box Fight only (`deep`).
  | 'div-cup'
  | 'fpe'
  | 'year-earnings'
  | 'fncs-every'
  // Bingo's own (games/bingo/engine.ts); no other game builds these.
  | 'fncs-finals'
  | 'org-count'
  | 'fncs-regions'
  | 'fncs-partners'
  | 'played-with'
  // Followers: built only when the server has fresh counts (`data/socials.ts`).
  | 'socials';

export interface PlayerCriterion {
  id: string;
  kind: CriterionKind;
  /** Reads after "This player ...", e.g. "has played for NRG". */
  label: string;
  /** Compact label for grid headers. */
  short: string;
  test: (player: RosterPlayer) => boolean;
  matches: RosterPlayer[];
  /** Built only with `CriteriaOptions.deep`: what the scene's regulars know, not what the famous names' fans do. */
  deep?: true;
}

export interface CriteriaSource {
  /** The pool criteria are built against — usually the game's chosen pool. */
  players: readonly RosterPlayer[];
  facts: Facts;
  orgs: Orgs;
  /**
   * Follower counts, when the server has fresh ones. Absent or empty, the
   * follower rules are simply not built — the rest of the board is unchanged.
   */
  socials?: Socials | null;
  /**
   * Everyone a guess may name, when that is wider than `players` — Tic Tac
   * Toe builds over a fame band and takes the whole roster. A handle two of
   * them share is named with the country ("Chap (Poland)").
   */
  everyone?: readonly RosterPlayer[];
}

/** The follower lines a rule can draw: "100K+ Twitch followers", "1M+ YouTube subscribers". */
export const SOCIAL_THRESHOLDS = [100_000, 1_000_000] as const;

export interface CriteriaOptions {
  /** Criteria with fewer matches than this are dropped. */
  minMatches?: number;
  /** Criteria matching more than this share of the pool are dropped (too easy). */
  maxShare?: number;
  /**
   * How many organisations may become rules, richest first.
   *
   * Capped, and low, for two reasons. The generators pick a rule at random, and
   * without a cap 174 of the ~250 rules were organisations — so "has played for
   * X" came up seven times in ten and career earnings, titles and tournaments
   * almost never did. And the tail of that list is orgs nobody can name: being
   * asked which four of eight players once had a stint at a team with a
   * Liquipedia page and $102k in career prize money is not a quiz question.
   */
  maxOrgs?: number;
  /**
   * Also build the deep rules — Div Cups, Performance Evaluations, a year's
   * prize money — which only Box Fight's Hard boards ask (the user, 14 Oct
   * 2026: "categories like won a div cup isn't easy, so they could be only in hard").
   */
  deep?: boolean;
}

/**
 * The fewest partners that make an anchor for "has won an FNCS with X". Lower
 * than the usual minimum, because three is already a long FNCS career:
 * Peterbot's five titles were won with four people.
 */
const MIN_PARTNERS = 3;

/**
 * How the scene writes each FNCS region. South America is Liquipedia's label
 * for what the FNCS itself has always called Brazil.
 */
const REGION_SHORT: Record<string, string> = {
  'North America': 'NA',
  Europe: 'EU',
  'South America': 'BR',
  Oceania: 'OCE',
  'Middle East': 'ME',
  Asia: 'Asia',
};

export function buildCriteria(
  { players, facts, orgs, socials, everyone }: CriteriaSource,
  options: CriteriaOptions = {},
): PlayerCriterion[] {
  const { minMatches = 4, maxShare = 0.5, maxOrgs = 10, deep = false } = options;
  const out: PlayerCriterion[] = [];

  const add = (
    id: string,
    kind: CriterionKind,
    label: string,
    short: string,
    test: (player: RosterPlayer) => boolean,
    least = minMatches,
  ) => {
    const matches = players.filter(test);
    if (matches.length < least) return;
    if (matches.length > players.length * maxShare) return;
    out.push({ id, kind, label, short, test, matches });
  };
  const addDeep = (id: string, kind: CriterionKind, label: string, short: string, test: (player: RosterPlayer) => boolean) => {
    if (!deep) return;
    const before = out.length;
    add(id, kind, label, short, test);
    if (out.length > before) out[out.length - 1].deep = true;
  };

  // ------------------------------------------------------------ identity --
  for (const country of [...new Set(players.map((p) => p.countryName).filter(Boolean))] as string[]) {
    add(`country:${country}`, 'country', `is from ${country}`, country, (p) => p.countryName === country);
  }

  for (const region of [...new Set(players.map((p) => p.region).filter(Boolean))] as string[]) {
    add(`region:${region}`, 'region', `competes in ${region}`, region, (p) => p.region === region);
  }

  // No active / retired rule: Liquipedia rarely marks a player retired, so
  // "Retired" refused players everyone knows have stopped (removed 28 Sep 2026).

  for (const [id, label, short, test] of [
    ['age:under-18', 'is under 18', 'Aged under 18', (p: RosterPlayer) => p.age !== null && p.age < 18],
    ['age:20-plus', 'is 20 or older', 'Aged 20+', (p: RosterPlayer) => p.age !== null && p.age >= 20],
  ] as const) {
    add(id, 'age', label, short, test);
  }

  // ---------------------------------------------------------------- orgs --
  // Org *history*, not the current badge — most players have worn several, and
  // "has played for FaZe" is a far better question than "plays for FaZe today".
  //
  // `notable()` is already sorted richest first, so the cap takes the orgs a
  // viewer would actually recognise. See `maxOrgs`.
  for (const org of orgs.notable().slice(0, maxOrgs)) {
    const ids = new Set(org.ever);
    add(`org:${org.id}`, 'org', `has played for ${org.name}`, org.name, (p) => ids.has(p.id));
  }

  // --------------------------------------------------------------- wins --
  add('fncs-winner', 'fncs-winner', 'has won an FNCS title', 'FNCS winner', (p) => p.fncsWins > 0);
  add(
    'global-winner',
    'global-winner',
    'has won a global championship',
    'Global champion',
    (p) => facts.of(p.id).wins.global > 0,
  );
  add(
    'lan-winner',
    'lan-winner',
    'has won a major LAN',
    'Major LAN winner',
    (p) => facts.of(p.id).wins.lan > 0,
  );
  add(
    'tournament-winner',
    'tournament-winner',
    'has won a major tournament',
    'Major winner',
    (p) => facts.of(p.id).wins.major > 0,
  );

  for (const threshold of [2, 3]) {
    add(
      `fncs-wins:${threshold}`,
      'fncs-wins',
      `has ${threshold}+ FNCS titles`,
      `${threshold}+ FNCS titles`,
      (p) => p.fncsWins >= threshold,
    );
  }

  /*
   * The count itself, not just a floor: none at all, exactly one to three, or
   * four and more. A kind of their own, so Connections and Griefer, which
   * whitelist the kinds they use, keep asking what they asked before.
   */
  add('fncs-count:0', 'fncs-count', 'has never won an FNCS', 'No FNCS wins', (p) => p.fncsWins === 0);
  for (const count of [1, 2, 3]) {
    const titles = count === 1 ? '1 FNCS title' : `${count} FNCS titles`;
    add(`fncs-count:${count}`, 'fncs-count', `has exactly ${titles}`, `Exactly ${titles}`, (p) => p.fncsWins === count);
  }
  add('fncs-count:4+', 'fncs-count', 'has 4+ FNCS titles', '4+ FNCS titles', (p) => p.fncsWins >= 4);

  const backToBack = facts.backToBackWinners();
  add(
    'fncs-back-to-back',
    'fncs-back-to-back',
    'has won two FNCS in a row',
    'Won FNCS back to back',
    (p) => backToBack.has(p.id),
  );
  // Majors are not the FNCS (the user, 15 Oct 2026): a Globals or a LAN between
  // two FNCS wins ends this run and not that one. The same kind, so a board
  // weighs the two as one question and the near-duplicate rule keeps them apart.
  const majorsBackToBack = facts.majorBackToBackWinners();
  add(
    'majors-back-to-back',
    'fncs-back-to-back',
    'has won two majors in a row',
    'Won majors back to back',
    (p) => majorsBackToBack.has(p.id),
  );

  /*
   * "Won FNCS with Peterbot": anyone who was on one of his winning teams.
   *
   * Any household name can be the anchor: the Easy fame tier, so the rule is
   * never about someone you would have to look up. This used to be the eight
   * biggest earners only, which put the same eight names on every board.
   */
  const namesakes = namesakesOf(everyone ?? players);
  for (const anchor of players) {
    if (anchor.tier !== 'easy') continue;
    const partners = facts.fncsPartners(anchor.id);
    if (partners.size < MIN_PARTNERS) continue;
    const name = namedPlayer(anchor, namesakes);
    add(
      `fncs-with:${anchor.id}`,
      'fncs-with',
      `has won an FNCS with ${name}`,
      `Won FNCS with ${name}`,
      (p) => partners.has(p.id),
      MIN_PARTNERS,
    );
  }

  // Top 3 at one of Epic's LANs. Empty until `facts.json` carries `podium`.
  add(
    'lan-podium',
    'lan-podium',
    'has finished top 3 at a major LAN',
    'Top 3 at a major LAN',
    (p) => facts.of(p.id).podium.some((index) => facts.events[index]?.lan),
  );

  for (const threshold of [100_000, 250_000, 500_000, 1_000_000]) {
    add(
      `earnings:${threshold}`,
      'earnings',
      `has earned ${moneyShort(threshold)}+ in their career`,
      `${moneyShort(threshold)}+ earned`,
      (p) => p.earnings >= threshold,
    );
  }

  /*
   * FNCS wins by region and by year, named as the thing a player did.
   *
   * These used to be "Won in Europe" and "Won in 2023", counting any headline
   * win by where the event was held. That made Cooper a European winner for
   * taking the 2023 Globals in Copenhagen — true of the venue and of nothing a
   * player would ever answer with. Both now ask about the regional FNCS alone
   * — "Won EU FNCS", "Won FNCS in 2023" — and a Globals is not an FNCS title
   * for either, which is how the FNCS count everywhere else reads it too.
   */
  const regions = [...new Set(players.flatMap((p) => facts.of(p.id).fncsWinRegions))];
  for (const region of regions) {
    const short = REGION_SHORT[region] ?? region;
    add(
      `won-fncs:${region}`,
      'won-fncs-region',
      `has won the ${short} FNCS`,
      `Won ${short} FNCS`,
      (p) => facts.of(p.id).fncsWinRegions.includes(region),
    );
  }

  const years = [...new Set(players.flatMap((p) => facts.of(p.id).fncsWinYears))].sort();
  for (const year of years) {
    add(
      `won-fncs-in:${year}`,
      'won-fncs-year',
      `won a regional FNCS final in ${year}`,
      `Won FNCS in ${year}`,
      (p) => facts.of(p.id).fncsWinYears.includes(year),
    );
  }

  // ------------------------------------------ added 14 Oct 2026, for Box Fight --
  // The user's picks from the measured list: the format won in, titles across
  // years, a young champion, the World Cup, Globals played. Regional finals
  // only, as everywhere an FNCS win is counted.
  const fncsWon = (p: RosterPlayer) =>
    facts.of(p.id).won.map((index) => facts.events[index]).filter((event) => event?.kind === 'fncs' && !event.lan);
  for (const [mode, word] of [['Solo', 'solo'], ['Duo', 'duo'], ['Trio', 'trio'], ['Squad', 'squad']] as const) {
    add(`won-fncs-mode:${mode}`, 'fncs-format', `has won a ${word} FNCS`, `Won a ${mode} FNCS`, (p) =>
      fncsWon(p).some((event) => event.mode === mode),
    );
  }
  add('fncs-years:3', 'fncs-years', 'has won FNCS in 3+ different years', 'Won FNCS in 3+ years', (p) =>
    new Set(facts.of(p.id).fncsWinYears).size >= 3,
  );
  // Age on the day of the final, from the published birthday.
  const youngest = (p: RosterPlayer) => {
    if (!p.birthDate) return Infinity;
    const born = Date.parse(p.birthDate);
    const ages = facts.of(p.id).fncsWinDates.map((day) => (Date.parse(day) - born) / (365.2425 * 86_400_000));
    return ages.length ? Math.min(...ages) : Infinity;
  };
  for (const age of [15, 16]) {
    add(`young-winner:${age}`, 'young-winner', `won an FNCS before turning ${age}`, `FNCS winner before ${age}`, (p) =>
      youngest(p) < age,
    );
  }
  const worldCup = facts.events.filter((event) => event.name.startsWith('Fortnite World Cup'));
  add('world-cup', 'world-cup', 'played at the 2019 World Cup', 'Played the World Cup', (p) =>
    worldCup.some((event) => facts.playedAt(event.index).has(p.id)),
  );
  const globalsPlayed = (p: RosterPlayer) =>
    facts.of(p.id).played.filter((index) => facts.events[index]?.kind === 'global').length;
  add('globals-played:3', 'globals-played', 'has played 3+ Global Championships', 'Played 3+ Globals', (p) => globalsPlayed(p) >= 3);

  // Deep: Hard boards only.
  addDeep('globals-played:2', 'globals-played', 'has played 2+ Global Championships', 'Played 2+ Globals', (p) => globalsPlayed(p) >= 2);
  const listed = (id: string) => new Set(facts.lists.find((list) => list.id === id)?.players ?? []);
  const divCupRegions = facts.lists.flatMap((list) => /^divcup-won:([^:]+)$/.exec(list.id)?.[1] ?? []);
  const anyDivCup = new Set(divCupRegions.flatMap((region) => [...listed(`divcup-won:${region}`)]));
  addDeep('divcup-won', 'div-cup', 'has won a Div Cup', 'Won a Div Cup', (p) => anyDivCup.has(p.id));
  for (const region of divCupRegions) {
    const ids = listed(`divcup-won:${region}`);
    const short = region === 'Europe' ? 'EU' : region;
    addDeep(`divcup-won:${region}`, 'div-cup', `has won a ${short} Div Cup`, `Won ${short} Div Cup`, (p) => ids.has(p.id));
  }
  const fiveDivCups = listed('divcup-wins:5');
  addDeep('divcup-wins:5', 'div-cup', 'has won 5+ Div Cups', '5+ Div Cup wins', (p) => fiveDivCups.has(p.id));
  const evaluations = listed('fpe-sessions:40');
  addDeep('fpe-sessions:40', 'fpe', 'has played 40+ Performance Evaluations', '40+ Perf. Evaluations', (p) => evaluations.has(p.id));
  for (const [year, line] of [[2025, 100_000], [2026, 50_000]] as const) {
    addDeep(`earned:${year}:${line}`, 'year-earnings', `earned ${moneyShort(line)}+ in ${year}`, `${moneyShort(line)}+ in ${year}`, (p) =>
      (p.earningsByYear[year] ?? 0) >= line,
    );
  }
  addDeep('earned-year:500000', 'year-earnings', 'earned $500K+ in a single year', '$500K+ in one year', (p) =>
    Object.values(p.earningsByYear).some((amount) => amount >= 500_000),
  );
  const every2025 = new Set(facts.lists.filter((list) => list.id.startsWith('fncs-every:2025')).flatMap((list) => list.players));
  addDeep('fncs-every:2025', 'fncs-every', 'played every FNCS grand final of 2025 in their region', 'Every 2025 FNCS final', (p) =>
    every2025.has(p.id),
  );

  // ------------------------------------------------------------ followers --
  // "Has 100K+ Twitch followers": a player's own channels, the count as the
  // platform gives it. One rule per platform and line.
  for (const platform of socials?.platforms ?? []) {
    const meta = PLATFORM_META[platform];
    for (const threshold of SOCIAL_THRESHOLDS) {
      add(
        `${platform}:${threshold}`,
        'socials',
        `has ${countShort(threshold)}+ ${meta.noun}`,
        `${countShort(threshold)}+ ${meta.name}`,
        (p) => (socials!.of(platform, p) ?? 0) >= threshold,
      );
    }
  }

  // ------------------------------------------------------ played at event --
  // Only events people can name — globals and LANs. There are well over a
  // hundred regional FNCS grand finals and their names differ by one word.
  for (const event of facts.headlineEvents) {
    const ids = facts.playedAt(event.index);
    add(
      `played:${event.index}`,
      'played-event',
      `played at ${event.name}`,
      // "Played" matters in a grid header — otherwise it reads as "won it".
      `Played ${event.short}`,
      (p) => ids.has(p.id),
    );
  }

  return out;
}

/** Players who satisfy both criteria — the Tic Tac Toe cell test. */
export function intersect(a: PlayerCriterion, b: PlayerCriterion): RosterPlayer[] {
  return a.matches.filter((player) => b.test(player));
}

/**
 * Whether two criteria share anyone at all.
 *
 * Separate from `intersect` because the board generator asks this question
 * hundreds of times per attempt and does not care who the players are. It
 * stops at the first hit, where `intersect` always walks the whole match set —
 * and the answer is usually yes on the first or second player.
 */
export function intersects(a: PlayerCriterion, b: PlayerCriterion): boolean {
  return a.matches.some((player) => b.test(player));
}

/**
 * True when one criterion implies the other, e.g. "3+ FNCS titles" inside
 * "2+ FNCS titles", or "global champion" inside "LAN winner". Such a pair makes
 * a redundant row/column or a muddy Connections group, so generators reject
 * boards containing one.
 *
 * `share` below 1 also catches the pair that is *nearly* nested: at 0.9, a
 * pair where nine in ten of the smaller set are in the larger. Exact
 * implication let "Won NA FNCS" and "North America" onto one Tic Tac Toe board
 * because a handful of NA winners now compete elsewhere — and the cell where
 * they crossed was just "Won NA FNCS" asked twice.
 */
export function isNested(a: PlayerCriterion, b: PlayerCriterion, share = 1): boolean {
  const [small, large] = a.matches.length <= b.matches.length ? [a, b] : [b, a];
  if (small.matches.length === 0) return false;
  const inside = small.matches.filter((player) => large.test(player)).length;
  return inside >= small.matches.length * share;
}

/**
 * How much of one criterion may sit inside another before the pair is
 * redundant — nine in ten. Tic Tac Toe and Connections both hold to it.
 */
export const NEAR_NESTED = 0.9;

/** No pair among the given criteria may imply another — or nearly, below `share` 1. */
export function hasNestedPair(criteria: PlayerCriterion[], share = 1): boolean {
  for (let i = 0; i < criteria.length; i++) {
    for (let j = i + 1; j < criteria.length; j++) {
      if (isNested(criteria[i], criteria[j], share)) return true;
    }
  }
  return false;
}
