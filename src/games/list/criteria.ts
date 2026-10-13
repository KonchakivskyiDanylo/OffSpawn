import type { Facts, HeadlineEvent, Season } from '@/data/liquipedia/facts';
import type { Orgs } from '@/data/liquipedia/orgs';
import type { Pool, Pools } from '@/data/liquipedia/pools';
import { ageOn, type Roster, type RosterPlayer } from '@/data/liquipedia/roster';
import type { Teammates } from '@/data/liquipedia/teammates';
import { countShort, PLATFORM_META, type Socials } from '@/data/socials';
import { moneyShort } from '@/lib/format';
import type { Searchable } from '@/lib/text';

/**
 * The List categories.
 *
 * Deliberately a short, hand-picked set rather than the hundreds the generator
 * used to produce. A recall game only works when you can picture the answer
 * set before you start typing — "players who competed at FNCS Chapter 3 Season
 * 2 NA West Grand Finals" is a list nobody holds in their head, and forty of
 * those made the game feel random rather than hard.
 *
 * These are lists people actually argue about.
 */

export interface Criterion {
  id: string;
  /** The prompt shown to the player. */
  title: string;
  /** Extra context, e.g. the event the field came from. */
  subtitle?: string;
  answers: Searchable[];
  /**
   * What the guess box searches, when it is not the roster.
   *
   * Almost every list is answered with players and leaves this alone. "Countries
   * with a player over $1M" is answered with countries, and searching the
   * roster for one would find nothing.
   */
  pool?: Searchable[];
  /** What the answers are, for the prompt and the count. Default "players". */
  noun?: string;
}

/** Below this a category is not worth a 90-second round. */
const MIN_ANSWERS = 8;

export function buildCriteria(
  roster: Roster,
  facts: Facts,
  pools: Pools | null,
  /** Both optional: List loads them after the first paint — see `ListGame`. */
  orgs?: Orgs | null,
  teammates?: Teammates | null,
  /** Fresh follower counts, when the server has them — `data/socials.ts`. */
  socials?: Socials | null,
): Criterion[] {
  const out: Criterion[] = [];
  const byId = new Map(roster.players.map((player) => [player.id, player]));

  const add = (id: string, title: string, answers: RosterPlayer[], subtitle?: string) => {
    if (answers.length < MIN_ANSWERS) return;
    out.push({ id, title, subtitle, answers });
  };

  // ------------------------------------------------------- event fields --
  // A qualified field is the best kind of list: finite, published, and argued
  // about all week.
  for (const pool of pools?.pools ?? []) {
    const answers = pool.players
      .map((id) => byId.get(id))
      .filter((player): player is RosterPlayer => Boolean(player));
    add(`pool:${pool.id}`, `Players who qualified for ${pool.label}`, answers, pool.event);
  }

  // ----------------------------------------------------- FNCS by region --
  // Split, because "every FNCS winner ever" is a 280-name list and neither
  // region's regulars help you with the other's.
  //
  // The regional finals only. This used to take any FNCS-branded event by
  // where it was held, so the 2022 Invitational in Raleigh put Kami and Setty,
  // both Polish, on the North America list. Same bug as Cooper's "won in
  // Europe" for the Copenhagen Globals, and the same fix: `fncsWinRegions`.
  const fncsRegions = new Map<string, RosterPlayer[]>();
  for (const player of roster.players) {
    for (const region of facts.of(player.id).fncsWinRegions) {
      const list = fncsRegions.get(region);
      if (list) list.push(player);
      else fncsRegions.set(region, [player]);
    }
  }
  for (const [region, answers] of [...fncsRegions].sort((a, b) => b[1].length - a[1].length)) {
    add(`fncs:${region}`, `FNCS grand final winners — ${region}`, answers);
  }

  // ---------------------------------------------------------- LAN wins --
  add(
    'lan-winners',
    'Players who have won a major LAN',
    roster.players.filter((player) => facts.of(player.id).wins.lan > 0),
    // This said "any offline tournament in the top two tiers", which is the
    // wider definition one Tenaball board uses. This list is the strict one, so
    // a DreamHack winner was refused under a description that invited them.
    'Major LANs only: the World Cup, the Globals and Epic’s other offline finals',
  );

  // ------------------------------------------------- qualified for both --
  // The overlap between two fields, which is a list people argue about all
  // week and a much shorter one than either field on its own.
  const fields = pools?.pools ?? [];
  if (fields.length >= 2) {
    const [a, b] = fields;
    const inB = new Set(b.players);
    const both = a.players
      .filter((id) => inB.has(id))
      .map((id) => byId.get(id))
      .filter((player): player is RosterPlayer => Boolean(player));
    add(
      `pool:both:${a.id}:${b.id}`,
      `Players who qualified for both ${a.label} and ${b.label}`,
      both,
      'On both fields',
    );
  }

  // ------------------------------------------------------- the season --
  if (facts.season) {
    for (const criterion of seasonCriteria(facts.season, byId)) {
      if (criterion.answers.length >= MIN_ANSWERS) out.push(criterion);
    }
  }
  // ----------------- every FNCS final by year, Div Cups, Evaluations --
  // Finished in `derived.py`: they are split by the region of the finals, and
  // the Div Cups are not in `facts.json`'s headline list at all, so the lists
  // come over whole.
  for (const list of facts.lists) {
    add(list.id, list.title, list.players.flatMap((id) => byId.get(id) ?? []), list.subtitle);
  }

  // --------------------------------------------------------- earnings --
  // Thresholds rather than a top-N, because a threshold is a list you can
  // picture the edge of: "who has cleared a million" is a question with a
  // remembered answer, where "the top 40 earners" is a ranking you look up.
  for (const threshold of [500_000, 1_000_000, 2_000_000]) {
    add(
      `earnings:${threshold}`,
      `Players with ${moneyShort(threshold)}+ career earnings`,
      roster.players.filter((player) => player.earnings >= threshold),
      'Career prize money across every tournament on record',
    );
  }

  // ------------------------------------------------------- FNCS titles --
  for (const threshold of [2, 3, 4]) {
    add(
      `fncs-wins:${threshold}`,
      `Players with ${threshold}+ FNCS wins`,
      roster.players.filter((player) => player.fncsWins >= threshold),
      'FNCS grand finals won, across every season and region',
    );
  }

  // ------------------------------------------------------ year by year --
  /*
   * One season at a time, which is how people actually remember this scene.
   *
   * Titles rather than earnings, because `facts.json` records the years a
   * player won something and nothing anywhere records what a player earned in
   * a given year per player — `rankings.json` has the per-year money as a
   * finished top ten, not as a column anything can filter. "Everyone who
   * cleared $300k in 2021" therefore needs a notebook run; this is the version
   * the shipped data can answer honestly.
   *
   * These asked for "a title", which could mean anything down to a cash cup,
   * under a hint reading "any tournament win on record" — when the list only
   * ever held Epic's tier-1 finals. They now say what they are.
   */
  const winYears = [...new Set(roster.players.flatMap((p) => facts.of(p.id).winYears))].sort();
  for (const year of winYears) {
    const winners = roster.players.filter((player) => facts.of(player.id).winYears.includes(year));
    add(
      `won-in-year:${year}`,
      `Players who won a major tournament in ${year}`,
      winners,
      'Epic’s tier-1 finals: FNCS grand finals, the Globals, the World Cup and Epic’s LANs',
    );
  }

  // ============================================================ two events ==
  /*
   * "Everyone who was at both of these."
   *
   * The intersection of two fields is a better list than either of them: it is
   * short enough to finish, and it is exactly the argument people have — who
   * has been to every Globals, who was at the World Cup *and* is still here.
   *
   * Only the headline events, because a pair of regional qualifiers is a list
   * nobody holds in their head. `playedAt` is indexed once and reused.
   */
  const headline = facts.headlineEvents;
  for (let i = 0; i < headline.length; i++) {
    for (let j = i + 1; j < headline.length; j++) {
      const a = headline[i];
      const b = headline[j];
      const atB = facts.playedAt(b.index);
      const both = roster.players.filter(
        (player) => facts.playedAt(a.index).has(player.id) && atB.has(player.id),
      );
      add(
        `both:${a.index}:${b.index}`,
        `Players who were at both ${a.short} and ${b.short}`,
        both,
        `${a.date.slice(0, 4)} and ${b.date.slice(0, 4)}`,
      );
    }
  }

  // Every Global Championship there has been — the shortest list in the game
  // and the one worth the most.
  const globals = headline.filter((event) => event.short.includes('Global Championship'));
  if (globals.length >= 3) {
    const everyOne = roster.players.filter((player) =>
      globals.every((event) => facts.playedAt(event.index).has(player.id)),
    );
    add(
      'every-global',
      `Players who have played every FNCS Global Championship`,
      everyOne,
      globals.map((event) => event.date.slice(0, 4)).join(', '),
    );
  }

  /*
   * Back-to-back rounds of the FNCS, by region.
   *
   * A "round" is every region's grand final inside a week of each other, found
   * by clustering the dates — the naming has changed four times and the dates
   * have not. Only the rounds from 2025 on, because a pair from 2020 is two
   * names most people never knew.
   */
  for (const [a, b] of consecutiveFinals(facts)) {
    if (a.date < '2025') continue;
    const atB = facts.playedAt(b.index);
    const both = roster.players.filter(
      (player) => facts.playedAt(a.index).has(player.id) && atB.has(player.id),
    );
    add(`finals-pair:${a.index}:${b.index}`, `Players at both ${a.short} and ${b.short}`, both,
      'Two FNCS grand finals in a row, same region');
  }

  // ===================================================== FNCS, deeper in ====
  for (const threshold of [15, 20, 25]) {
    add(
      `fncs-apps:${threshold}`,
      `Players with ${threshold}+ FNCS grand finals`,
      roster.players.filter((player) => facts.of(player.id).fncsApps >= threshold),
      'Grand finals reached, across every season and region',
    );
  }

  // Won two rounds of the FNCS in a row. Rare enough to be a list and famous
  // enough to be a memory.
  const backToBack = facts.backToBackWinners();
  add(
    'fncs-back-to-back',
    'Players who have won the FNCS back to back',
    roster.players.filter((player) => backToBack.has(player.id)),
    'Two consecutive rounds of FNCS grand finals',
  );

  // How old they were on the day of a regional final they won. A player with
  // no published birthday is on neither side rather than guessed.
  const winAges = new Map<string, number[]>();
  for (const player of roster.players) {
    const ages = facts
      .of(player.id)
      .fncsWinDates.map((date) => ageOn(player.birthDate, new Date(date)))
      .filter((age): age is number => age !== null);
    if (ages.length > 0) winAges.set(player.id, ages);
  }
  // Not "age": that word pulls in the glossary's "age today" definition.
  const ageNote = 'How old they were on the day of the grand final';
  for (const age of [15, 16]) {
    add(
      `fncs-age:under:${age}`,
      `Players who won an FNCS before turning ${age}`,
      roster.players.filter((player) => winAges.get(player.id)?.some((at) => at < age)),
      ageNote,
    );
  }
  for (const age of [20, 21]) {
    add(
      `fncs-age:over:${age}`,
      `Players who won an FNCS aged ${age} or older`,
      roster.players.filter((player) => winAges.get(player.id)?.some((at) => at >= age)),
      ageNote,
    );
  }

  // ============================================================= earnings ===
  // Per year, which is how a career is actually remembered: 2019 is the World
  // Cup and nothing else, 2021 is a different cast entirely.
  const years = [
    ...new Set(roster.players.flatMap((player) => Object.keys(player.earningsByYear).map(Number))),
  ].sort();
  for (const year of years) {
    for (const threshold of [100_000, 200_000]) {
      add(
        `year-earnings:${year}:${threshold}`,
        `Players who earned ${moneyShort(threshold)}+ in ${year}`,
        roster.players.filter((player) => (player.earningsByYear[year] ?? 0) >= threshold),
        `Prize money won during ${year}`,
      );
    }
  }
  add(
    'year-earnings:best:500000',
    'Players who have earned $500K+ in a single year',
    roster.players.filter((player) =>
      Object.values(player.earningsByYear).some((amount) => amount >= 500_000),
    ),
    'Any one calendar year on record',
  );

  // ======================================================== who plus what ===
  // A country crossed with an achievement. "French FNCS winners" is a list
  // somebody can actually reel off; "French players" is a phone book.
  const byCountry = new Map<string, RosterPlayer[]>();
  for (const player of roster.players) {
    if (!player.countryName) continue;
    const list = byCountry.get(player.countryName);
    if (list) list.push(player);
    else byCountry.set(player.countryName, [player]);
  }
  for (const [country, players] of [...byCountry].sort((a, b) => b[1].length - a[1].length)) {
    add(
      `country-fncs:${country}`,
      `Players from ${country} who have won an FNCS`,
      players.filter((player) => player.fncsWins > 0),
      'FNCS grand finals won, across every season and region',
    );
    add(
      `country-earnings:${country}`,
      `Players from ${country} with $100K+ career earnings`,
      players.filter((player) => player.earnings >= 100_000),
      'Career prize money across every tournament on record',
    );
    add(
      `country-lan:${country}`,
      `Players from ${country} who have played a major LAN`,
      players.filter((player) => facts.of(player.id).lanApps > 0),
      'Major LANs only: the World Cup, the Globals and Epic’s other offline finals',
    );
  }

  // Countries, not players: the one list here you answer with a flag's name.
  const countryPool = [...byCountry.keys()].sort().map((name) => ({ id: name, name }));
  const withWinner = [...byCountry]
    .filter(([, players]) => players.some((player) => player.fncsWins > 0))
    .map(([name]) => ({ id: name, name }));
  if (withWinner.length >= MIN_ANSWERS) {
    out.push({
      id: 'countries-fncs',
      title: 'Countries with an FNCS winner',
      subtitle: 'One player is enough — by their first nationality',
      answers: withWinner,
      pool: countryPool,
      noun: 'countries',
    });
  }
  for (const threshold of [100_000, 500_000, 1_000_000]) {
    const countries = [...byCountry]
      .filter(([, players]) => players.some((player) => player.earnings >= threshold))
      .map(([name]) => ({ id: name, name }));
    if (countries.length >= MIN_ANSWERS) {
      out.push({
        id: `countries-over:${threshold}`,
        title: `Countries with a player over ${moneyShort(threshold)} in career earnings`,
        subtitle: 'One player is enough to put a country on this list',
        answers: countries,
        pool: countryPool,
        noun: 'countries',
      });
    }
  }

  // ================================================================= orgs ===
  // All-time, not the current badge: "has played for FaZe" is a list, "plays
  // for FaZe" is a roster page.
  // $500k is where the tail stops being names anyone can place: it keeps 52
  // organisations, and the last of them is still a team you have heard of.
  for (const org of orgs?.notable(500_000) ?? []) {
    add(
      `org:${org.id}`,
      `Players who have played for ${org.name}`,
      org.ever
        .map((id) => byId.get(id))
        .filter((player): player is RosterPlayer => Boolean(player)),
      'Anyone on the roster at any point, not just today',
    );
  }

  // ============================================================ teammates ===
  /*
   * "Everyone who has queued with X."
   *
   * Anchored on names people can picture, and cut at ten tournaments together
   * so the list is a duo history rather than everyone who ever shared a lobby.
   * Needs `teammates.json`, which List loads in the background — see the note
   * where it is called.
   */
  if (teammates) {
    const anchors = [...roster.players].sort((a, b) => b.earnings - a.earnings).slice(0, 30);
    for (const anchor of anchors) {
      add(
        `with:${anchor.id}`,
        `Players who have played 10+ tournaments with ${anchor.name}`,
        teammates
          .cluesFor(anchor.id, byId)
          .filter((clue) => clue.events >= 10)
          .map((clue) => clue.player),
        'Tournaments entered together, across their whole careers',
      );
    }
  }

  // ------------------------------------------------------------ followers --
  // Everyone over a follower line, worldwide and per region. A region gets the
  // highest of its lines that still makes a round — 1M in Europe, 250K in
  // Oceania — so every region has one and none is a census.
  for (const platform of socials?.platforms ?? []) {
    const meta = PLATFORM_META[platform];
    const over = (line: number, players: readonly RosterPlayer[]) =>
      players.filter((player) => (socials!.of(platform, player) ?? 0) >= line);
    const subtitle = `Counts as ${meta.name} gives them, refreshed daily`;
    for (const line of [1_000_000, 2_000_000, 5_000_000]) {
      const answers = over(line, roster.players);
      if (answers.length <= SOCIAL_MAX) add(`followers:${platform}:${line}`, `Players with ${countShort(line)}+ ${meta.noun}`, answers, subtitle);
    }
    for (const region of roster.regions) {
      const here = roster.players.filter((player) => player.region === region);
      const line = [1_000_000, 500_000, 250_000, 100_000].find((l) => over(l, here).length >= SOCIAL_MIN);
      if (line && over(line, here).length <= SOCIAL_MAX) {
        add(`followers:${platform}:${line}:${region}`, `${region} players with ${countShort(line)}+ ${meta.noun}`, over(line, here), subtitle);
      }
    }
  }

  return out;
}

/** A follower list between these sizes: a round, not a coin toss and not a census. */
const SOCIAL_MIN = 10;
const SOCIAL_MAX = 120;

/**
 * Everyone at all of the year's big events — for 2026: EWC, the Globals, the
 * Summit and FNCS Majors 1 and 2. The top tens by average finish are Tenaball
 * boards, written by `scripts/pipeline/derived.py`.
 */
function seasonCriteria(season: Season, byId: Map<string, RosterPlayer>): Criterion[] {
  const { year, events } = season;
  const answers = [...season.results].flatMap(([id, results]) => {
    const player = byId.get(id);
    return player && results.every(Boolean) ? [player] : [];
  });
  return [
    {
      id: `season:${year}:all`,
      title: `Players who played all ${events.length} big events of ${year}`,
      subtitle: `${events.slice(0, -1).join(', ')} and ${events[events.length - 1]}`,
      answers,
    },
  ];
}

/**
 * Consecutive grand finals in one region, newest last.
 *
 * Regional finals only. The 2026 Summit is an FNCS event with a region on it
 * — where it was held — so it sat between two European finals and split the
 * real pair in two, each half labelled "two FNCS grand finals in a row".
 */
function consecutiveFinals(facts: Facts): [HeadlineEvent, HeadlineEvent][] {
  const byRegion = new Map<string, HeadlineEvent[]>();
  for (const event of facts.events) {
    if (event.kind !== 'fncs' || event.lan || !event.region) continue;
    const list = byRegion.get(event.region);
    if (list) list.push(event);
    else byRegion.set(event.region, [event]);
  }
  const pairs: [HeadlineEvent, HeadlineEvent][] = [];
  for (const events of byRegion.values()) {
    events.sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 1; i < events.length; i++) pairs.push([events[i - 1], events[i]]);
  }
  return pairs;
}


/**
 * Below this a field list is not worth a round. Lower than `MIN_ANSWERS`,
 * because a field list can be short and still be the question: the Middle
 * East sent four players to the 2026 Globals, and "name all four" is a fine
 * ninety seconds that ends in ten if you know them.
 */
const MIN_FIELD = 4;

/**
 * The same kinds of list, cut down to one tournament's field.
 *
 * "Name everyone who qualified" is the obvious one and the whole field is the
 * answer, which makes it the one list in this game you can genuinely finish.
 * The rest are that list crossed with a fact — everyone from Europe who made
 * it, everyone in the field who has won an FNCS — and they are better recall
 * prompts than their all-time versions precisely because the ceiling is eighty
 * rather than four thousand: you can hold the shape of the answer in your head
 * and still not be able to name it.
 *
 * In the order planned for an event's fortnight in LIMITED_MODE.md, numbered
 * below to match it. The gaps are lists the export cannot answer yet: creator
 * subscribers, duos split across two nations (the field has no pairings until
 * the event is played), who qualified from where, and anything scored at the
 * event itself.
 *
 * Nothing here is precomputed. A field is a hundred players and every fact
 * needed is already on the roster row or in `facts.json`. `orgs` arrives after
 * the first paint, like the all-time org lists; `everyone` is the roster, for
 * the guess box of the list answered with countries.
 */
export function buildPoolCriteria(
  pool: Pool,
  players: RosterPlayer[],
  facts: Facts,
  orgs?: Orgs | null,
  everyone: readonly RosterPlayer[] = players,
): Criterion[] {
  const out: Criterion[] = [];
  const add = (id: string, title: string, answers: RosterPlayer[], subtitle?: string, least = MIN_FIELD) => {
    if (answers.length < least) return;
    out.push({ id, title, subtitle, answers });
  };
  const prefix = `pool:${pool.id}`;
  const field = `The ${pool.label} field`;
  const year = Number(pool.date.slice(0, 4));
  const from = (region: string) => players.filter((player) => player.region === region);

  // 1, 3, 5, 7 and 10: the regions, the big two first.
  const region = (id: string, where: string, answers: RosterPlayer[], note: string) =>
    add(`${prefix}:region:${id}`, `${pool.label} qualifiers from ${where}`, answers, `${field} — ${note}`);

  region('Europe', 'Europe', from('Europe'), 'by the region they compete in');

  // 2
  add(
    `${prefix}:fncs-${year}`,
    `${pool.label} qualifiers who won an FNCS in ${year}`,
    players.filter((player) => facts.of(player.id).fncsWinYears.includes(year)),
    `${field} — a regional FNCS grand final won during ${year}`,
  );

  region('North America', 'North America', from('North America'), 'East and West together');

  // 4: answered with organisations.
  if (orgs) {
    const inField = new Set(players.map((player) => player.id));
    const answers = orgs.orgs
      .filter((org) => org.current.some((id) => inField.has(id)))
      .map((org) => ({ id: org.name, name: org.name }));
    if (answers.length >= MIN_FIELD) {
      out.push({
        id: `${prefix}:orgs`,
        title: `Organisations with a player at ${pool.label}`,
        subtitle: `${field} — each player’s current organisation`,
        answers,
        pool: orgs.orgs.map((org) => ({ id: org.name, name: org.name })),
        noun: 'organisations',
      });
    }
  }

  region('South America', 'South America', from('South America'), 'the FNCS’s Brazil region');

  // 6: answered with countries.
  const byCountry = new Map<string, RosterPlayer[]>();
  for (const player of players) {
    if (!player.countryName) continue;
    const list = byCountry.get(player.countryName);
    if (list) list.push(player);
    else byCountry.set(player.countryName, [player]);
  }
  if (byCountry.size >= MIN_FIELD) {
    const known = [...new Set(everyone.flatMap((player) => player.countryName ?? []))].sort();
    out.push({
      id: `${prefix}:countries`,
      title: `Countries with a player at ${pool.label}`,
      subtitle: `${field} — by each player’s first nationality`,
      answers: [...byCountry.keys()].sort().map((name) => ({ id: name, name })),
      pool: known.map((name) => ({ id: name, name })),
      noun: 'countries',
    });
  }

  region('Middle East', 'the Middle East', from('Middle East'), 'by the region they compete in');

  // 8
  add(
    `${prefix}:fncs`,
    `${pool.label} qualifiers who have won an FNCS`,
    players.filter((player) => player.fncsWins > 0),
    `${field} — regional FNCS grand finals won across every season and region`,
  );

  // 9 is subscribers, which the export does not have.

  region(
    'Asia-Oceania',
    'Asia or Oceania',
    players.filter((player) => player.region === 'Asia' || player.region === 'Oceania'),
    'the two regions together',
  );

  // 11 wants the field's duos, which Liquipedia only pairs once they have played.

  // 12: the LANs just before this one — for a Globals, the season's Summit.
  const earlier = facts.events
    .filter((event) => event.lan && event.date < pool.date)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 3);
  for (const event of earlier) {
    const there = facts.playedAt(event.index);
    add(
      `${prefix}:also:${event.index}`,
      `${pool.label} qualifiers who also played ${event.short}`,
      players.filter((player) => there.has(player.id)),
      `${field} — on the ${event.short} field too`,
    );
  }

  // Their first LAN: at none of the LANs before this one. For the 2026 Globals
  // that is the World Cup, the 2022 Invitational, the Globals of 2023 to 2025,
  // the Summit and the EWC.
  const lansBefore = facts.events.filter((event) => event.lan && event.date < pool.date);
  if (lansBefore.length > 0) {
    add(
      `${prefix}:first-lan`,
      `${pool.label} qualifiers playing their first major LAN`,
      players.filter((player) => lansBefore.every((event) => !facts.playedAt(event.index).has(player.id))),
      `${field} — at none of the ${lansBefore.length} major LANs before it`,
    );
  }

  // 13 to 16 and 18 need who qualified from where and what happened at the
  // event itself; neither is in the export yet.

  // 17
  for (const threshold of [50_000, 100_000]) {
    add(
      `${prefix}:earned-${year}:${threshold}`,
      `${pool.label} qualifiers who earned ${moneyShort(threshold)}+ in ${year}`,
      players.filter((player) => (player.earningsByYear[year] ?? 0) >= threshold),
      `${field} — prize money won during ${year}`,
    );
  }

  // 19
  for (const threshold of [500_000, 1_000_000]) {
    add(
      `${prefix}:earned:${threshold}`,
      `${pool.label} qualifiers with ${moneyShort(threshold)}+ career earnings`,
      players.filter((player) => player.earnings >= threshold),
      `${field} — career prize money across every tournament on record`,
    );
  }

  // ------------------------------------------------ after the planned ones --
  add(`${prefix}:all`, `Everyone who qualified for ${pool.label}`, players, pool.event);

  // Only the well-represented countries: "the two Norwegians who qualified" is
  // a trivia question, not a list.
  for (const [country, answers] of [...byCountry].sort((a, b) => b[1].length - a[1].length)) {
    add(`${prefix}:country:${country}`, `${pool.label} qualifiers from ${country}`, answers, field, MIN_ANSWERS);
  }

  add(
    `${prefix}:lan`,
    `${pool.label} qualifiers who have won a major LAN`,
    players.filter((player) => facts.of(player.id).wins.lan > 0),
    `${field} — Epic’s offline majors only: the World Cup, the Globals, the Summit and the other LANs`,
  );
  add(
    `${prefix}:no-fncs`,
    `${pool.label} qualifiers who have never won an FNCS`,
    players.filter((player) => player.fncsWins === 0),
    field,
  );
  add(
    `${prefix}:retired`,
    `${pool.label} qualifiers who are no longer competing`,
    players.filter((player) => player.status !== 'active'),
    field,
  );

  return out;
}
