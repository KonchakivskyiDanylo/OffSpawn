import { ref, type GamePayloads, type Outcome } from '@/analytics/types';
import type { Facts } from '@/data/liquipedia/facts';
import type { Majors } from '@/data/liquipedia/majors';
import type { Orgs } from '@/data/liquipedia/orgs';
import type { RosterPlayer } from '@/data/liquipedia/roster';
import type { Teammates } from '@/data/liquipedia/teammates';

/**
 * Pure logic for Contextinho: Contexto with players. Every guess is ranked by
 * how alike it is to the secret player, out of everyone on record; #1 is the
 * secret.
 *
 * The roadmap (2 Oct 2026) says V1's real job is to find out how similarity
 * should work, so the measure is a weighted sum of separate parts, each 0 to
 * 1, and the weights are an argument. The game plays on `DEFAULT_WEIGHTS`, and
 * the lab on the page (dev builds only) changes them live.
 */

export type AttributeId =
  | 'teammates'
  | 'results'
  | 'lately'
  | 'titles'
  | 'champions'
  | 'stage'
  | 'country'
  | 'age'
  | 'region'
  | 'linked'
  | 'era'
  | 'lobbies'
  | 'rivals'
  | 'early'
  | 'earlyRivals'
  | 'earlyLobbies'
  | 'earnings'
  | 'orgs'
  | 'fncs';

export interface Attribute {
  id: AttributeId;
  label: string;
  /** What 1 and 0 mean, for the lab. */
  hint: string;
}

export const ATTRIBUTES: Attribute[] = [
  { id: 'teammates', label: 'Played together', hint: 'Tournaments entered as teammates, on a log scale: 40 or more is a full match.' },
  {
    id: 'results',
    label: 'Results together',
    hint: 'FNCS grand finals and major LANs played on one team, each worth more the better the finish — a win 1, a podium 0.8, top 5 0.65, top 10 0.5, top 25 0.3, anything else 0.15 — twice at a LAN, and faded by the recency half-life: 3 is a full match.',
  },
  { id: 'lately', label: 'Teamed up lately', hint: 'FNCS grand finals and major LANs played as teammates, each faded by the recency half-life: three this year is a full match.' },
  { id: 'titles', label: 'FNCS wins together', hint: 'Regional FNCS finals won on the same team: one scores 0.7, two or more a full match.' },
  { id: 'champions', label: 'Won a big event together', hint: 'Won the World Cup, a Global Championship or another major LAN on the same team: 1 for each, times the event’s weight below.' },
  { id: 'stage', label: 'Big events together', hint: 'Teammates at the World Cup, a Global Championship or another major LAN: once scores 0.7; twice, or a podium, a full match.' },
  { id: 'country', label: 'Country', hint: 'Same first nationality; a neighbouring scene (the Nordics, Benelux, the Baltics…) scores half; any other country up to 0.4, by how close its capital is (none past 2,500 km).' },
  { id: 'age', label: 'Age', hint: 'Birth dates two years apart score a third; unknown scores 0.3.' },
  { id: 'region', label: 'Region', hint: 'Same competitive region.' },
  { id: 'linked', label: 'Shared teammates', hint: 'Overlap between the two players’ top-50 teammate lists.' },
  {
    id: 'era',
    label: 'Same years',
    hint: 'The years each earned prize money, weighed by how much (on a log scale): two players big in the same years match fully; $50 in a year someone else won $100K in barely counts.',
  },
  { id: 'lobbies', label: 'Same tournaments', hint: 'FNCS grand finals and LANs both played, out of the shorter career (counted as at least 10).' },
  {
    id: 'rivals',
    label: 'Top of the same lobbies',
    hint: 'FNCS grand finals and LANs where both finished in the top 10, on different teams: eight is a full match.',
  },
  { id: 'earnings', label: 'Career earnings', hint: 'A tenfold gap in career earnings scores half.' },
  {
    id: 'early',
    label: 'Early majors together',
    hint: 'The 2018–19 Skirmishes and the rest of the early majors played on one team, by finish — a win 1, a podium 0.8, top 10 0.55, top 25 0.3, anything else 0.15 — twice at a LAN, never faded: 2 is a full match.',
  },
  {
    id: 'earlyRivals',
    label: 'Top of the same early lobbies',
    hint: 'Early majors where both finished in the top 10, on different teams: three is a full match.',
  },
  {
    id: 'earlyLobbies',
    label: 'Same early majors',
    hint: 'Early majors both played, out of the shorter early career (counted as at least 5).',
  },
  { id: 'orgs', label: 'Same organisations', hint: 'Organisations both have played for; two in common is a full match.' },
  { id: 'fncs', label: 'FNCS wins', hint: 'Five titles apart scores 0.' },
];

export type Weights = Record<AttributeId, number>;

/** The big events by kind, each with its own weight in the two parts about them. */
export type EventFamily = 'worldcup' | 'globals' | 'invitational' | 'summit' | 'other';

export const EVENT_FAMILIES: { id: EventFamily; label: string }[] = [
  { id: 'worldcup', label: 'World Cup' },
  { id: 'globals', label: 'Global Championships' },
  { id: 'invitational', label: '2022 Invitational' },
  { id: 'summit', label: '2026 Summit' },
  { id: 'other', label: 'Other major LANs' },
];

export type EventWeights = Record<EventFamily, number>;

/**
 * How much each big event counts in "won a big event together" and "big
 * events together": 1 is as it stands, 2 twice that, 0 not at all (the user,
 * 14 Oct 2026: "add weight for tournaments, so I can add extra weight to
 * world cup or vice versa"). A lab knob for now, all level.
 */
export const DEFAULT_EVENT_WEIGHTS: EventWeights = { worldcup: 1, globals: 1, invitational: 1, summit: 1, other: 1 };

export function eventFamily(name: string): EventFamily {
  if (/World Cup/.test(name)) return 'worldcup';
  if (/Global Championship/.test(name)) return 'globals';
  if (/Invitational/.test(name)) return 'invitational';
  if (/Summit/.test(name)) return 'summit';
  return 'other';
}

/**
 * The user's own mix from the lab (14 Oct 2026: played together 5, country 2,
 * age 1.5, region 1, shared teammates 1, same years 2, same organisations 2 —
 * "Something like that"), plus the three parts asked for the same day.
 *
 * FNCS wins together and big events together are rare and nearly always
 * right — "if they win together it should be a really big clue" — so they are
 * heavy: one title or one Globals as a duo is worth what seven tournaments
 * together are, two what twenty are. At 4, measured over the Easy secrets,
 * 99% of FNCS-winning partners and 95% of big-event partners rank in the top
 * 10 (97% and 92% at 3); 5 changed little. Same tournaments is shared by
 * most of a region's regulars, so it is light: at 1.5 a regular of the
 * secret's finals who never teamed with them moves from about #180 to #70 and
 * stays out of the top 25 nine times in ten; at 3 it was one in six.
 */
export const DEFAULT_WEIGHTS: Weights = {
  // 5.5 and age 1 were the user's from the lab (22 Oct 2026: "played together
  // 5.5 and age 1 is a great improvement"). Measured over the Easy secrets: the
  // partner at a secret's latest final from #23.4 to #19.8 on average, strangers
  // in a top 10 from 75 to 58, same-age strangers from 21 to 10; the famous top
  // 10s barely move.
  teammates: 5.5,
  // Results together (22 Oct 2026) grades what "teamed up lately" only
  // counted, so it takes its place; big events together give it some of theirs.
  results: 4,
  lately: 0,
  titles: 4,
  champions: 5,
  stage: 3,
  country: 2,
  age: 1,
  region: 1,
  linked: 1,
  era: 1.5,
  lobbies: 1,
  // The top of the same finals: the rivals a fan names, which shared lobbies alone could not tell from the regulars.
  rivals: 1.5,
  // The early majors, 2018 to the World Cup (22 Oct 2026), on a scale of their own.
  early: 3,
  earlyRivals: 1.5,
  earlyLobbies: 1,
  earnings: 0,
  orgs: 2,
  fncs: 0,
};

/**
 * What the parts read besides the roster row. Orgs, facts and majors are
 * optional: without one, the parts it feeds score 0 for everyone.
 */
export interface Context {
  teammates: Teammates;
  orgs: Orgs | null;
  /** FNCS titles and which events were big. */
  facts: Facts | null;
  /** Who played which grand final and LAN, and with whom. */
  majors: Majors | null;
  /** Each big event's weight; `DEFAULT_EVENT_WEIGHTS` when absent. */
  events?: EventWeights;
  /**
   * Years for a result together to count half as much: titles, big events and
   * "teamed up lately" fade with it. 0 is no fading. `DEFAULT_HALF_LIFE` when absent.
   */
  halfLife?: number;
}

/**
 * Recency (the user, 14 Oct 2026: "recency bias to the teammates or wins"): a
 * duo people remember is the one playing now, not the one from 2019. Played
 * together counts tournaments with no dates (`teammates.json` keeps only the
 * totals), so the dated results carry it: FNCS titles, the big events, and
 * the finals and LANs in "teamed up lately".
 *
 * Measured over the Easy secrets against their partner at their latest final
 * or LAN: with no fading it was one of the three closest 51% of the time; a
 * four-year half-life and "teamed up lately" at 3 make it 57%, bring the top
 * teammate from #3.1 to #2.9 on average, and leave every FNCS-winning partner
 * in the top 25. Two years or a heavier "lately" pushed 2019's title partners
 * out of it. Big events won together are weighted 5: each one's partner is
 * then one of the secret's three closest (Aqua → Nyhrox and Cooper → Mero the
 * closest); at 0 Cooper → Mero was #5.
 */
export const DEFAULT_HALF_LIFE = 4;

const YEAR_MS = 365.25 * 86_400_000;

/** How much a result on `date` still counts: 1 today, a half at one half-life ago. */
function fader(context: Context): (date: string) => number {
  const halfLife = context.halfLife ?? DEFAULT_HALF_LIFE;
  if (!(halfLife > 0)) return () => 1;
  // "Now" is the data's date, so a ranking is the same whenever it is made.
  const now = Date.parse(context.facts?.generated ?? '') || Date.now();
  return (date) => 0.5 ** (Math.max(0, now - Date.parse(date)) / YEAR_MS / halfLife);
}

/** A regional FNCS final won with the player, each faded by its age. */
function titlesWith(playerId: string, context: Context): Map<string, number> {
  const out = new Map<string, number>();
  const facts = context.facts;
  if (!facts) return out;
  const fade = fader(context);
  for (const index of facts.of(playerId).won) {
    const event = facts.events[index];
    if (!event || event.kind !== 'fncs' || event.lan) continue;
    for (const id of facts.wonAt(index)) if (id !== playerId) out.set(id, (out.get(id) ?? 0) + fade(event.date));
  }
  return out;
}

/**
 * What a finish together is worth in "results together" (the user, 22 Oct
 * 2026: "It's not only about wins, but placements as well. Like top 10, top 5
 * is a great placements sometimes"): a title the most, then the podium, a top
 * 5, a top 10, a top 25, and a final simply played together a little.
 */
export function finishWorth(placement: number): number {
  if (placement === 1) return 1;
  if (placement <= 3) return 0.8;
  if (placement <= 5) return 0.65;
  if (placement <= 10) return 0.5;
  if (placement <= 25) return 0.3;
  return 0.15;
}

/** A LAN result together counts this many times a regional final's. */
const LAN_WORTH = 2;

/** The sum of finishes together that makes a full "results together": a podium, a top 5 and a top 10 between them. */
const RESULTS_FULL = 3;

/**
 * Every FNCS grand final and major LAN played on one team, each worth its
 * finish (`finishWorth`), twice at a LAN, faded by its age. It folds in what
 * "teamed up lately" counted — a final together, faded — and grades it by how
 * it went, so a duo who were top 5 three times stands above one who were 80th.
 */
function resultsWith(playerId: string, context: Context): Map<string, number> {
  const out = new Map<string, number>();
  if (!context.majors) return out;
  const fade = fader(context);
  const lans = new Set(context.facts?.events.filter((event) => event.lan).map((event) => event.name) ?? []);
  for (const result of context.majors.resultsFor(playerId)) {
    const team = context.majors.finishers(result);
    if (team.size > (TEAM_SIZE[result.tournament.mode ?? ''] ?? 1)) continue;
    const worth = finishWorth(result.placement) * (lans.has(result.tournament.name) ? LAN_WORTH : 1) * fade(result.tournament.date);
    for (const id of team) if (id !== playerId) out.set(id, (out.get(id) ?? 0) + worth);
  }
  return out;
}

/**
 * "Same years", weighed by money (22 Oct 2026): each year's prize money on a
 * log scale, the smaller of the two over the larger, summed over the years.
 * A plain overlap of years tied a 2018 star to everyone who won $50 that year
 * — 7ssk7's top 10 was Swedes and Russians whose one thing in common with him
 * was earning something in 2018 and 2019.
 */
function sameYears(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): number {
  let low = 0;
  let high = 0;
  for (const year of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const [x, y] = [Math.log10(1 + (a[year] ?? 0)), Math.log10(1 + (b[year] ?? 0))];
    low += Math.min(x, y);
    high += Math.max(x, y);
  }
  return high > 0 ? low / high : 0;
}

/** The best finishes that count in "top of the same lobbies". */
const RIVAL_PLACE = 10;

/** How many grand finals or LANs both in the top 10 make a full "top of the same lobbies": eight, so a top player's rivals are not all full at once. */
const RIVALS_FULL = 8;

/** How many finals or major LANs together make a full "teamed up lately". */
const LATELY_FULL = 3;

/**
 * The early majors (`Facts.early`: the 2018 Summer and Fall Skirmishes, the
 * Winter Royale finals, the 2019 Secret Skirmish, Katowice Royale and World Cup
 * Warmup) on a scale of their own (the user, 22 Oct 2026: "Include skirmishes
 * in like old majors, so they have completely different scoring"). They are
 * not faded: they are the whole career of a 2018 player, and fading by the
 * half-life would leave a seventh of them. A 100-player Skirmish lobby makes a
 * top 10 rarer than a modern final's, so it is worth a little more.
 */
export function earlyFinishWorth(placement: number): number {
  if (placement === 1) return 1;
  if (placement <= 3) return 0.8;
  if (placement <= 10) return 0.55;
  if (placement <= 25) return 0.3;
  return 0.15;
}

/** What makes a full "early majors together": a podium and a top 10 between them, or one LAN top 10. */
const EARLY_FULL = 2;

/** Early majors both in the top 10 that make a full "top of the same early lobbies". */
const EARLY_RIVALS_FULL = 3;

/** The shortest early career "same early majors" divides by. */
const EARLY_FLOOR = 5;

/** Every early major played on one team, by finish, twice at a LAN. */
function earlyWith(playerId: string, context: Context): Map<string, number> {
  const out = new Map<string, number>();
  for (const result of context.facts?.earlyResultsFor(playerId) ?? []) {
    const worth = earlyFinishWorth(result.placement) * (result.event.lan ? LAN_WORTH : 1);
    for (const id of result.team) if (id !== playerId) out.set(id, (out.get(id) ?? 0) + worth);
  }
  return out;
}

/** Every FNCS grand final and major LAN played as teammates, each faded by its age. */
function latelyWith(playerId: string, context: Context): Map<string, number> {
  const out = new Map<string, number>();
  if (!context.majors) return out;
  const fade = fader(context);
  for (const result of context.majors.resultsFor(playerId)) {
    const team = context.majors.finishers(result);
    if (team.size > (TEAM_SIZE[result.tournament.mode ?? ''] ?? 1)) continue;
    for (const id of team) if (id !== playerId) out.set(id, (out.get(id) ?? 0) + fade(result.tournament.date));
  }
  return out;
}

export type Parts = Record<AttributeId, number>;

export interface Scored {
  player: RosterPlayer;
  /** 1 is the secret. */
  rank: number;
  /** 0–100, the secret 100. */
  score: number;
  parts: Parts;
}

const YEAR = 365.25 * 86_400_000;

function jaccard<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

// ------------------------------------------------------------- country --

/**
 * Scenes: countries whose players grow up in each other's lobbies, teams and
 * languages. Hand-made and kept disjoint so it stays readable.
 *
 * All-or-nothing country was unkind to small countries (the user, 14 Oct
 * 2026: "in eu, especially in countries with a small amount of players there
 * could be a problem, maybe something by closer"): a Latvian secret has three
 * compatriots, so country said nothing about anyone else, Lithuanians and
 * Estonians included.
 *
 * Outside a scene, the distance between capitals gives a little
 * (`countryCloseness`): Germany and Poland, Paris and Brussels, Japan and South
 * Korea are next door without sharing a scene (the user, 14 Oct 2026: "improve
 * countries… it's still gives to neighbor only"). There is no same-continent
 * step: `region` is already that. Countries in no scene — France, Brazil,
 * Japan, South Korea, Turkey, Israel, Iran — count by distance alone.
 */
const SCENES: readonly (readonly string[])[] = [
  ['GB', 'IE'], // UK & Ireland
  ['DK', 'FI', 'GL', 'IS', 'NO', 'SE'], // Nordics
  ['AT', 'CH', 'DE'], // DACH
  ['BE', 'LU', 'NL'], // Benelux
  ['AD', 'ES', 'PT'], // Iberia
  ['IT', 'MT'], // Italy & Malta
  ['EE', 'LT', 'LV'], // Baltics
  ['CZ', 'HU', 'PL', 'SK'], // Central Europe
  ['AL', 'BA', 'BG', 'GR', 'HR', 'ME', 'MK', 'RO', 'RS', 'SI', 'XK'], // Balkans
  ['AM', 'AZ', 'BY', 'GE', 'KZ', 'MD', 'RU', 'UA'], // Eastern Europe & CIS
  ['CA', 'US'], // US & Canada
  // Spanish-speaking America and the Caribbean. Brazil, a scene of its own,
  // shares their lobbies — `lobbies` and `region` see that — not their language.
  ['AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DM', 'DO', 'EC', 'GT', 'HN', 'JM', 'KY', 'MQ', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'TT', 'UY', 'VE'],
  ['AE', 'BH', 'KW', 'OM', 'QA', 'SA', 'YE'], // Gulf
  ['DZ', 'EG', 'IQ', 'JO', 'LB', 'MA', 'PS', 'SY', 'TN'], // Levant, Iraq & North Africa
  ['AU', 'CK', 'FJ', 'NZ'], // Oceania
  ['CN', 'HK', 'TW'], // Greater China
  ['ID', 'KH', 'MY', 'PH', 'SG', 'TH', 'VN'], // Southeast Asia
  ['IN', 'LK', 'PK'], // South Asia
  ['CV', 'GN', 'KE', 'NA', 'NG', 'UG', 'ZA'], // Sub-Saharan Africa
];

const SCENE_OF = new Map(SCENES.flatMap((countries, scene) => countries.map((code) => [code, scene] as const)));

/** What a neighbouring scene scores; the same country is 1. */
const SAME_SCENE = 0.5;

/**
 * Each country's capital, roughly, for how far apart two countries are — every
 * country on the roster. A country missing here counts by its scene alone.
 */
const CAPITAL: Record<string, readonly [number, number]> = {
  AE: [24.5, 54.4], AL: [41.3, 19.8], AR: [-34.6, -58.4], AT: [48.2, 16.4], AU: [-35.3, 149.1], AZ: [40.4, 49.9],
  BA: [43.9, 18.4], BE: [50.9, 4.4], BG: [42.7, 23.3], BH: [26.2, 50.6], BO: [-16.5, -68.2], BR: [-15.8, -47.9],
  BY: [53.9, 27.6], CA: [45.4, -75.7], CH: [47.0, 7.4], CL: [-33.5, -70.7], CN: [39.9, 116.4], CO: [4.7, -74.1],
  CR: [9.9, -84.1], CU: [23.1, -82.4], CZ: [50.1, 14.4], DE: [52.5, 13.4], DK: [55.7, 12.6], DO: [18.5, -69.9],
  DZ: [36.8, 3.1], EC: [-0.2, -78.5], EE: [59.4, 24.8], EG: [30.0, 31.2], ES: [40.4, -3.7], FI: [60.2, 24.9],
  FJ: [-18.1, 178.4], FR: [48.9, 2.4], GB: [51.5, -0.1], GL: [64.2, -51.7], GR: [38.0, 23.7], GT: [14.6, -90.5],
  HK: [22.3, 114.2], HN: [14.1, -87.2], HR: [45.8, 16.0], HU: [47.5, 19.0], ID: [-6.2, 106.8], IE: [53.3, -6.3],
  IL: [31.8, 35.2], IN: [28.6, 77.2], IQ: [33.3, 44.4], IR: [35.7, 51.4], IS: [64.1, -21.9], IT: [41.9, 12.5],
  JO: [32.0, 35.9], JP: [35.7, 139.7], KH: [11.6, 104.9], KR: [37.6, 127.0], KW: [29.4, 48.0], KZ: [51.2, 71.4],
  LB: [33.9, 35.5], LT: [54.7, 25.3], LU: [49.6, 6.1], LV: [57.0, 24.1], MA: [34.0, -6.8], MD: [47.0, 28.9],
  MK: [42.0, 21.4], MT: [35.9, 14.5], MX: [19.4, -99.1], MY: [3.1, 101.7], NA: [-22.6, 17.1], NI: [12.1, -86.3],
  NL: [52.4, 4.9], NO: [59.9, 10.8], NZ: [-41.3, 174.8], OM: [23.6, 58.4], PA: [9.0, -79.5], PE: [-12.0, -77.0],
  PH: [14.6, 121.0], PK: [33.7, 73.1], PL: [52.2, 21.0], PR: [18.5, -66.1], PS: [31.9, 35.2], PT: [38.7, -9.1],
  PY: [-25.3, -57.6], QA: [25.3, 51.5], RO: [44.4, 26.1], RS: [44.8, 20.5], RU: [55.8, 37.6], SA: [24.7, 46.7],
  SE: [59.3, 18.1], SG: [1.4, 103.8], SI: [46.1, 14.5], SK: [48.1, 17.1], SV: [13.7, -89.2], SY: [33.5, 36.3],
  TH: [13.8, 100.5], TR: [39.9, 32.9], TT: [10.7, -61.5], UA: [50.5, 30.5], UG: [0.3, 32.6], US: [38.9, -77.0],
  UY: [-34.9, -56.2], VE: [10.5, -66.9], VN: [21.0, 105.8], YE: [15.4, 44.2], ZA: [-25.7, 28.2],
};

/** The most a country outside the scene scores, next door; nothing from this far. */
const NEAR = 0.4;
const FAR_KM = 2500;

/** Great-circle distance between two capitals, in km. */
function km([lat1, lon1]: readonly [number, number], [lat2, lon2]: readonly [number, number]): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * 1 for the same country; `SAME_SCENE` for a neighbour in the same scene; and
 * for any other country up to `NEAR`, falling to nothing at `FAR_KM` between
 * capitals — Berlin and Warsaw, 520 km apart, score 0.32; Paris and Madrid
 * 0.23; Lisbon and Moscow nothing. The better of the two counts.
 */
export function countryCloseness(a: string | null, b: string | null): number {
  if (a === null || b === null) return 0;
  if (a === b) return 1;
  const scene = SCENE_OF.get(a);
  const sameScene = scene !== undefined && scene === SCENE_OF.get(b) ? SAME_SCENE : 0;
  const [p, q] = [CAPITAL[a], CAPITAL[b]];
  const near = p && q ? NEAR * Math.max(0, 1 - km(p, q) / FAR_KM) : 0;
  return Math.max(sameScene, near);
}

// -------------------------------------------------------- events together --

/** Players per team by format. A place shared by more is a tie between teams. */
const TEAM_SIZE: Record<string, number> = { Duo: 2, Trio: 3, Squad: 4 };

/**
 * Who shared the secret's team at each big event, and how many times.
 *
 * Big is `Facts.headlineEvents` — the World Cup, the Global Championships, the
 * 2022 Invitational, the Summit, the Reload Elite final: the LANs a duo is
 * remembered by (the user, 14 Oct 2026: "if the players played together world
 * cup it should give them a lot of points, because it's probably the teammate
 * you think first of all"). A team is everyone who finished in the same place
 * (`Majors.finishers`), so a place two teams tied for is skipped rather than
 * read as one team of four.
 *
 * A podium together counts twice, because the result is what the duo is
 * remembered by: Aqua and Nyhrox won the 2019 World Cup and that was their
 * only LAN together. Counted once, Nyhrox was #4 for Aqua, behind two of
 * Aqua's FNCS-title partners; twice, #3, and nothing else measured moved.
 */
function stageMates(playerId: string, context: Context): { mates: Map<string, number>; won: Map<string, number> } {
  const mates = new Map<string, number>();
  // Big events won on the same team, each counted at its event's weight —
  // Aqua and Nyhrox's World Cup, Cooper and Mero's 2023 Globals (the user,
  // 14 Oct 2026: "what about like world cup win, or globals win").
  const won = new Map<string, number>();
  if (!context.facts || !context.majors) return { mates, won };
  const weights = context.events ?? DEFAULT_EVENT_WEIGHTS;
  const fade = fader(context);
  const big = new Set(context.facts.headlineEvents.map((event) => event.name));
  for (const result of context.majors.resultsFor(playerId)) {
    if (!big.has(result.tournament.name)) continue;
    const team = context.majors.finishers(result);
    if (team.size > (TEAM_SIZE[result.tournament.mode ?? ''] ?? 1)) continue;
    const weight = weights[eventFamily(result.tournament.name)] * fade(result.tournament.date);
    const times = (result.placement <= 3 ? 2 : 1) * weight;
    for (const id of team) {
      if (id === playerId) continue;
      mates.set(id, (mates.get(id) ?? 0) + times);
      if (result.placement === 1) won.set(id, (won.get(id) ?? 0) + weight);
    }
  }
  return { mates, won };
}

/**
 * Once together is already a strong clue; twice is as strong as it gets. In
 * between — an event weighted below 1 — it climbs to 0.7 in a straight line.
 */
function onceOrTwice(times: number): number {
  return times >= 2 ? 1 : times >= 1 ? 0.7 + 0.3 * (times - 1) : 0.7 * times;
}

/**
 * The shortest career `lobbies` divides by.
 *
 * Same tournaments counts the grand finals and LANs both players reached
 * (`Majors`: every region's FNCS final and every major LAN — the lobbies the
 * user means by "some eu player plays fncs and I name another player from eu,
 * they could have played in the same lobby a lot", 14 Oct 2026). Shared ÷ the
 * shorter of the two careers, because a player with eight finals cannot share
 * more than eight, and having shared all of them is as alike as two careers
 * get. Divided by at least this many, so "a lot" stays a count: two players
 * whose only final was the same one score 0.1, not a perfect match, and ten
 * shared finals is the least a full match takes — about three years of one
 * region's finals, where an Easy secret's median career is 15. Measured, 10
 * lifted the secret's lobby regulars more than 5 or 15 did: at 5, short
 * careers sharing their few finals crowd them out.
 */
const LOBBY_FLOOR = 10;

/** Everything about the secret the parts compare against, worked out once per ranking. */
function profile(player: RosterPlayer, context: Context, orgsOf: (id: string) => ReadonlySet<string>) {
  const results = context.majors?.resultsFor(player.id) ?? [];
  const events = new Set(results.map((result) => result.tournament.name));
  return {
    player,
    born: player.birthDate ? Date.parse(player.birthDate) : NaN,
    mates: new Map(context.teammates.matesOf(player.id)),
    mateIds: new Set(context.teammates.matesOf(player.id).map(([id]) => id)),
    titles: titlesWith(player.id, context),
    results: resultsWith(player.id, context),
    /** Each final and LAN the secret finished in the top 10 of, and where. */
    early: earlyWith(player.id, context),
    /** Each early major the secret played, and where they finished. */
    earlyPlaces: new Map((context.facts?.earlyResultsFor(player.id) ?? []).map((result) => [result.event.index, result.placement])),
    topTen: new Map(results.filter((result) => result.placement <= RIVAL_PLACE).map((result) => [result.tournament.name, result.placement])),
    lately: latelyWith(player.id, context),
    stage: stageMates(player.id, context),
    years: player.earningsByYear,
    events,
    orgs: orgsOf(player.id),
  };
}

/**
 * The parts any two players can share without ever meeting: an age, a
 * region, the same years. Between strangers they are coincidences, and a top
 * 10 made of them was a list of names nobody would guess — 7ssk7's was Swedes
 * born the same year who earned in 2018 too. So they count fully for a player
 * with $1M or more, and less the less a player has won (`fameLean`). A country
 * is not one of them: a guesser thinks by nationality, so a compatriot nobody
 * knows stays a compatriot. Everything the two did together, or at the same
 * events, counts in full.
 */
const BY_CHANCE: ReadonlySet<AttributeId> = new Set(['age', 'region', 'era']);

/** How much of the chance parts count for a player: 1 from $1M, about 0.6 at $10K, 0.4 at $1K or less. */
export function fameLean(player: RosterPlayer): number {
  const fame = Math.min(1, Math.max(0, (Math.log10(player.earnings + 1) - 3) / 3));
  return 0.4 + 0.6 * fame;
}

/**
 * What a player's score is made of: each part's share, in points out of 100,
 * with the fame lean on the chance parts — the same sum `rankAll` scores by,
 * so the points add up to the score. For the lab and the report script.
 */
export function pointsOf(scored: Scored, weights: Weights): Parts {
  const total = Object.values(weights).reduce((sum, weight) => sum + Math.max(0, weight), 0) || 1;
  const lean = fameLean(scored.player);
  return Object.fromEntries(
    ATTRIBUTES.map((attribute) => [
      attribute.id,
      (Math.max(0, weights[attribute.id]) * scored.parts[attribute.id] * (BY_CHANCE.has(attribute.id) ? lean : 1) * 100) / total,
    ]),
  ) as Parts;
}

/**
 * Ranks everyone against the secret: the secret first, then by the weighted
 * parts, the bigger career earner first on a tie — never the alphabet.
 */
export function rankAll(
  secret: RosterPlayer,
  players: readonly RosterPlayer[],
  weights: Weights,
  context: Context,
): Map<string, Scored> {
  const byPlayer = new Map<string, Set<string>>();
  for (const org of context.orgs?.orgs ?? []) {
    for (const id of org.ever) {
      let set = byPlayer.get(id);
      if (!set) byPlayer.set(id, (set = new Set()));
      set.add(org.id);
    }
  }
  const orgsOf = (id: string): ReadonlySet<string> => byPlayer.get(id) ?? new Set();
  const target = profile(secret, context, orgsOf);
  const total = Object.values(weights).reduce((sum, weight) => sum + Math.max(0, weight), 0) || 1;

  const scored = players
    .filter((player) => player.id !== secret.id)
    .map((player) => {
      const parts = compare(target, player, context, orgsOf);
      // What two strangers can share by chance counts more for a name a fan could guess.
      const lean = fameLean(player);
      const sum = (Object.keys(parts) as AttributeId[]).reduce(
        (acc, id) => acc + Math.max(0, weights[id]) * parts[id] * (BY_CHANCE.has(id) ? lean : 1),
        0,
      );
      return { player, value: sum / total, parts };
    })
    .sort((a, b) => b.value - a.value || b.player.earnings - a.player.earnings);

  const out = new Map<string, Scored>();
  const full = Object.fromEntries(ATTRIBUTES.map((a) => [a.id, 1])) as Parts;
  out.set(secret.id, { player: secret, rank: 1, score: 100, parts: full });
  scored.forEach((entry, index) => {
    out.set(entry.player.id, {
      player: entry.player,
      rank: index + 2,
      // Never 100 for anyone but the secret, however alike.
      score: Math.min(99, Math.round(entry.value * 100)),
      parts: entry.parts,
    });
  });
  return out;
}

function compare(
  target: ReturnType<typeof profile>,
  player: RosterPlayer,
  context: Context,
  orgsOf: (id: string) => ReadonlySet<string>,
): Parts {
  const together = target.mates.get(player.id) ?? 0;
  const born = player.birthDate ? Date.parse(player.birthDate) : NaN;
  const age =
    Number.isNaN(born) || Number.isNaN(target.born) ? 0.3 : Math.exp(-Math.abs(born - target.born) / YEAR / 1.8);
  const theirMates = new Set(context.teammates.matesOf(player.id).map(([id]) => id));
  const earningsGap = Math.abs(Math.log10(player.earnings + 1) - Math.log10(target.player.earnings + 1));
  const sharedOrgs = [...orgsOf(player.id)].filter((org) => target.orgs.has(org)).length;
  const theirEvents = context.majors?.resultsFor(player.id) ?? [];
  const sharedEvents = theirEvents.filter((result) => target.events.has(result.tournament.name)).length;
  // Both in the top 10 of one final, on different teams: a placement apart.
  const theirEarly = context.facts?.earlyResultsFor(player.id) ?? [];
  const sharedEarly = theirEarly.filter((result) => target.earlyPlaces.has(result.event.index));
  const earlyRivalries = sharedEarly.filter((result) => {
    const theirs = target.earlyPlaces.get(result.event.index)!;
    return theirs <= RIVAL_PLACE && result.placement <= RIVAL_PLACE && result.placement !== theirs;
  }).length;
  const rivalries = theirEvents.filter((result) => {
    const theirs = target.topTen.get(result.tournament.name);
    return theirs !== undefined && result.placement <= RIVAL_PLACE && result.placement !== theirs;
  }).length;
  return {
    teammates: Math.min(1, Math.log1p(together) / Math.log1p(40)),
    results: Math.min(1, (target.results.get(player.id) ?? 0) / RESULTS_FULL),
    lately: Math.min(1, (target.lately.get(player.id) ?? 0) / LATELY_FULL),
    titles: onceOrTwice(target.titles.get(player.id) ?? 0),
    champions: target.stage.won.get(player.id) ?? 0,
    stage: onceOrTwice(target.stage.mates.get(player.id) ?? 0),
    country: countryCloseness(target.player.country, player.country),
    age,
    region: player.region !== null && player.region === target.player.region ? 1 : 0,
    linked: Math.min(1, jaccard(target.mateIds, theirMates) * 3),
    era: sameYears(target.years, player.earningsByYear),
    lobbies: sharedEvents / Math.max(LOBBY_FLOOR, Math.min(target.events.size, theirEvents.length)),
    rivals: Math.min(1, rivalries / RIVALS_FULL),
    early: Math.min(1, (target.early.get(player.id) ?? 0) / EARLY_FULL),
    earlyRivals: Math.min(1, earlyRivalries / EARLY_RIVALS_FULL),
    earlyLobbies: sharedEarly.length / Math.max(EARLY_FLOOR, Math.min(target.earlyPlaces.size, theirEarly.length)),
    earnings: Math.max(0, 1 - earningsGap / 2),
    orgs: Math.min(1, sharedOrgs / 2),
    fncs: Math.max(0, 1 - Math.abs(player.fncsWins - target.player.fncsWins) / 5),
  };
}

/** Warm to cold by rank, for the guess rows and the daily's share grid. Bands sized for a ranking of ~5,700. */
export function bandOf(rank: number): 'hot' | 'warm' | 'cool' | 'cold' {
  if (rank <= 25) return 'hot';
  if (rank <= 150) return 'warm';
  if (rank <= 750) return 'cool';
  return 'cold';
}

/** Who can be the secret: someone with a teammate, so the biggest part has something to say. */
export function eligible(teammates: Teammates) {
  return (players: RosterPlayer[]): RosterPlayer[] =>
    players.filter((player) => teammates.matesOf(player.id).some(([, events]) => events >= 5));
}

// ------------------------------------------------------------------ round --

export interface GameState {
  secret: RosterPlayer;
  /** In the order made; `hint` marks the ones a hint gave. */
  guesses: { player: RosterPlayer; hint: boolean }[];
  status: 'playing' | 'won' | 'lost';
  hints: number;
}

export function createGame(secret: RosterPlayer): GameState {
  return { secret, guesses: [], status: 'playing', hints: 0 };
}

export function submitGuess(state: GameState, player: RosterPlayer, hint = false): GameState {
  if (state.status !== 'playing' || state.guesses.some((g) => g.player.id === player.id)) return state;
  return {
    ...state,
    guesses: [...state.guesses, { player, hint }],
    hints: state.hints + (hint ? 1 : 0),
    status: player.id === state.secret.id ? 'won' : 'playing',
  };
}

/**
 * The player a hint names: the one halfway between your best rank and #1, or
 * the nearest one to it you have not guessed. Null once you are next to it.
 */
export function hintFor(state: GameState, ranking: ReadonlyMap<string, Scored>, everyone: number): RosterPlayer | null {
  const best = Math.min(everyone + 1, ...state.guesses.map((g) => ranking.get(g.player.id)?.rank ?? Infinity));
  if (best <= 2) return null;
  const guessed = new Set(state.guesses.map((g) => g.player.id));
  const byRank = [...ranking.values()].sort((a, b) => a.rank - b.rank);
  for (let rank = Math.max(2, Math.floor(best / 2)); rank < best; rank++) {
    const entry = byRank[rank - 1];
    if (entry && !guessed.has(entry.player.id)) return entry.player;
  }
  return null;
}

export function giveUp(state: GameState): GameState {
  return state.status === 'playing' ? { ...state, status: 'lost' } : state;
}

export function record(state: GameState): { outcome: Outcome; r: GamePayloads['contextinho'] } {
  return {
    outcome: state.status === 'won' ? 'won' : 'gave-up',
    r: { secret: ref(state.secret), guesses: state.guesses.map((g) => ref(g.player)), hints: state.hints },
  };
}
