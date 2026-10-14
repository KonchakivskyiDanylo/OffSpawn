import type { Facts, HeadlineEvent } from '@/data/liquipedia/facts';

/**
 * What the words mean.
 *
 * Every game leans on a handful of terms — a major, a LAN, a nationality —
 * that mean something narrower here than they do in conversation, and the
 * games left the reader to guess which. "Players who have won a LAN" refused
 * a DreamHack winner under a hint that did not say DreamHack was out; a player
 * with two nationalities could not tell which flag a country question would
 * use; nothing said that a "tournament" means every cash cup on Liquipedia.
 *
 * So each term is defined once, here, and shown wherever it is used: in a
 * game's "How to play" (`GameMeta.terms`), and under a Tenaball board or a
 * List prompt that mentions it (`termsIn`). Where the data can list the events
 * a term covers, it does, so the definition cannot drift from what the games
 * actually count.
 */

export type TermId =
  | 'tournament'
  | 'major'
  | 'lan'
  | 'lan-wide'
  | 'global'
  | 'fncs-title'
  | 'fncs-final'
  | 'nationality'
  | 'region'
  | 'fncs-region'
  | 'org'
  | 'earnings'
  | 'age'
  | 'teammates'
  | 'field'
  | 'div-cup'
  | 'fpe';

export interface EventList {
  names: string[];
  /** What the list leaves out, as one closing line — "and 178 regional grand finals". */
  more?: string;
}

export interface Term {
  id: TermId;
  name: string;
  text: string;
  /** The events the term covers, read from `facts.json` once it has loaded. */
  events?: (facts: Facts) => EventList;
}

const named = (events: HeadlineEvent[]): string[] =>
  [...events]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((event) => (event.short.includes(String(event.year)) ? event.short : `${event.short} (${event.year})`));

/** A regional FNCS grand final: the online kind, one per region per round. */
const isRegional = (event: HeadlineEvent) => event.kind === 'fncs' && !event.lan;

export const TERMS: Record<TermId, Term> = {
  tournament: {
    id: 'tournament',
    name: 'Tournament',
    text:
      'Any Fortnite tournament with a Liquipedia page — Epic’s events, third-party cups, qualifiers, cash cups, online or offline. A count of tournaments counts all of them.',
  },
  major: {
    id: 'major',
    name: 'Major',
    text:
      'A tier-1 main event run by Epic, from the 2019 World Cup on: every regional FNCS grand final, every Global Championship, the World Cup finals and Epic’s other LANs. Not qualifiers, showmatches, cash cups, console, mobile, Twitch or challenge events, and not third-party events.',
    events: (facts) => {
      const regional = facts.events.filter(isRegional).length;
      return {
        names: named(facts.events.filter((event) => !isRegional(event))),
        more: `…and ${regional} regional FNCS grand finals, every region and season since 2019.`,
      };
    },
  },
  lan: {
    id: 'lan',
    name: 'Major LAN',
    text:
      'A major played offline: Epic’s own LAN finals, listed below. DreamHack, Gamers8 and other events Epic did not run are not major LANs, nor are cash cups held at one.',
    events: (facts) => ({ names: named(facts.events.filter((event) => event.lan)) }),
  },
  'lan-wide': {
    id: 'lan-wide',
    name: 'LAN',
    text:
      'Any offline main event in Liquipedia’s top two tiers: Epic’s major LANs plus DreamHack, Gamers8 and the Esports World Cup. Only the “LAN wins” board counts this way.',
  },
  global: {
    id: 'global',
    name: 'Global Championship',
    text:
      'The FNCS Global Championship, held yearly since 2023: the offline final every region qualifies into. The 2019 World Cup is not one, and a Globals win is not an FNCS win.',
    events: (facts) => ({ names: named(facts.events.filter((event) => event.kind === 'global')) }),
  },
  'fncs-title': {
    id: 'fncs-title',
    name: 'FNCS win',
    text:
      'A regional FNCS grand final won, in any region, since 2019. PC only: the 2020 console FNCS does not count. The Globals, the 2022 Invitational and the 2026 Summit are not FNCS wins.',
  },
  'fncs-final': {
    id: 'fncs-final',
    name: 'FNCS grand finals played',
    text:
      'Every regional FNCS grand final reached, plus the offline FNCS events: the Globals, the 2022 Invitational and the 2026 Summit. Not qualifying heats or cash cups.',
    events: (facts) => {
      const regional = facts.events.filter(isRegional).length;
      return {
        names: named(
          facts.events.filter((event) => !isRegional(event) && event.short.includes('FNCS')),
        ),
        more: `…and ${regional} regional grand finals.`,
      };
    },
  },
  nationality: {
    id: 'nationality',
    name: 'Nationality',
    text:
      'The first nationality on the player’s Liquipedia page. Peterbot (United States, then Hungary) counts as American only. England, Scotland and Wales count as nations when listed first: Cr1nge is Scottish here, not British.',
  },
  region: {
    id: 'region',
    name: 'Region',
    text:
      'Where a player competes, not where they are from. Six: Europe, North America (East and West together), South America (the FNCS’s Brazil), Asia, Oceania and the Middle East.',
  },
  'fncs-region': {
    id: 'fncs-region',
    name: 'FNCS region',
    text:
      'The region of the final a player played, not their profile’s. North America follows the FNCS: NA East and NA West until Major 1 of 2023, one final (NA Central here) through 2024, then NA Central and NA West. Brazil is South America.',
  },
  org: {
    id: 'org',
    name: 'Organisation',
    text:
      '“Has played for” means at any time, not only now. Counting the orgs in an event’s field uses each player’s current team.',
  },
  earnings: {
    id: 'earnings',
    name: 'Earnings',
    text:
      'Individual prize money on Liquipedia, in US dollars — a team’s prize split between its players. “In 2026” is that calendar year. No salaries or creator deals.',
  },
  age: {
    id: 'age',
    name: 'Age',
    text:
      'Age today, from the published birthday. Players with no birthday on record are left out of age questions.',
  },
  teammates: {
    id: 'teammates',
    name: 'Teammates',
    text:
      'Teammates share a result at a tournament — a duo, trio or squad. Counts are tournaments entered together.',
  },
  field: {
    id: 'field',
    name: 'Qualified',
    text:
      'In the event’s field as Liquipedia lists it. An entrant without a Liquipedia page cannot be an answer.',
  },
  'div-cup': {
    id: 'div-cup',
    name: 'Div Cup',
    text:
      'An FNCS Divisional Cup final, from Chapter 6: one a week in each of seven regions (Europe, NA Central, NA West, Brazil, Asia, Middle East, Oceania), C6S4’s three Practice Cups included. Each region’s final is its own event, and the region is the final’s. Chapter 6 was trios (duos in C6S4); Chapter 7 is duos.',
  },
  fpe: {
    id: 'fpe',
    name: 'Performance Evaluation',
    text:
      'Epic’s Fortnite Performance Evaluation sessions, in Europe and NA Central since 2023: one lobby, top four paid. Reload and Arenas evaluations are not included.',
  },
};

/**
 * The terms a board or list title leans on, in the order they are defined.
 *
 * Read off the words rather than tagged by hand, because there are three
 * hundred boards and lists and most of them are built by the notebook: a
 * title that says "LAN" needs the LAN definition whoever wrote it. `id` is
 * there for the one board whose LAN is the wide one, and for an event field's
 * boards and lists (`pool:…`), whose titles carry the event's name: every one
 * of them mentioned the Globals, so every one explained what a Globals is.
 *
 * A board about one event (`tournament:…`, its top ten placements) explains
 * nothing: "Top 10 at FNCS 2023 Global Championship" needs no definition of a
 * Globals, and an FNCS final's board none of finals or regions. Definitions are
 * for the boards that gather many events under one word (the user, 13 Oct 2026).
 */
export function termsIn(text: string, id = ''): TermId[] {
  if (id.startsWith('tournament:')) return [];
  const found = new Set<TermId>();
  const field = id.startsWith('pool:');
  // The average-finish boards: their region is the final's, and their duos
  // are teams ranked together rather than a count of tournaments shared.
  const averages = /^(season|fncs-avg|fncs-every):/.test(id);
  // Div Cups and Evaluations: their own term says what their regions are.
  const weekly = /^(divcup|fpe)/.test(id);
  const region = /\bby region\b|Europe|North America|South America|Brazil|\bAsia\b|Oceania|Middle East|\bNA (East|West|Central)\b/i;
  if (field) found.add('field');
  // "Major LAN" is the strict meaning, and so is a bare "LAN" anywhere but the
  // one board that widens it.
  if (/\bLANs?\b/.test(text)) found.add(id === 'lan-wins' ? 'lan-wide' : 'lan');
  // "Major 1 Summit" is an event's name, not the word; "major LAN" has its own term.
  if (/\bmajors?\b(?! \d| LAN)/i.test(text)) found.add('major');
  // Not "World Cup": the 2019 World Cup is not a Global Championship here.
  if (!field && /Global Championship|\bGlobals?\b/i.test(text)) found.add('global');
  if (/FNCS (wins?|titles?)|won (an|the|their region’s) FNCS|FNCS (grand final )?winners?|Won [A-Z]+ FNCS|finals won/i.test(text)) {
    found.add('fncs-title');
  }
  if (/FNCS (grand )?finals|FNCS Finals|grand finals (played|reached|qualified)/i.test(text) && !/finals won/i.test(text)) {
    found.add('fncs-final');
  }
  // "Qualifiers from Europe" is a region, "players from Poland" a nationality.
  const from = /\bfrom ([A-Z][\w ]+)/.exec(text);
  if (/countr|nation/i.test(text) || (from && !region.test(from[1]))) found.add('nationality');
  if (region.test(text) && !weekly) found.add(averages ? 'fncs-region' : 'region');
  if (/organi[sz]ation|played for|\borgs?\b/i.test(text)) found.add('org');
  if (/earn|\$|prize|money|payday/i.test(text)) found.add('earnings');
  if (/youngest|oldest|\bage\b|born/i.test(text)) found.add('age');
  if (/tournaments (played|won|entered)|tournaments? on record|every tournament|tournaments with/i.test(text)) {
    found.add('tournament');
  }
  if (!averages && !weekly && /teammate|\bduos?\b|played together|entered together|queued|tournaments with [A-Z]/.test(text)) {
    found.add('teammates');
  }
  if (/qualif/i.test(text)) found.add('field');
  if (/\bDiv Cups?\b/i.test(text)) found.add('div-cup');
  if (/Performance Evaluations?/i.test(text)) found.add('fpe');
  return (Object.keys(TERMS) as TermId[]).filter((term) => found.has(term));
}
