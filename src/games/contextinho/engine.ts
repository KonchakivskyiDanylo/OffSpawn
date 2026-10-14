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
  { id: 'lately', label: 'Teamed up lately', hint: 'FNCS grand finals and major LANs played as teammates, each faded by the recency half-life: three this year is a full match.' },
  { id: 'titles', label: 'FNCS wins together', hint: 'Regional FNCS finals won on the same team: one scores 0.7, two or more a full match.' },
  { id: 'champions', label: 'Won a big event together', hint: 'Won the World Cup, a Global Championship or another major LAN on the same team: 1 for each, times the event’s weight below.' },
  { id: 'stage', label: 'Big events together', hint: 'Teammates at the World Cup, a Global Championship or another major LAN: once scores 0.7; twice, or a podium, a full match.' },
  { id: 'country', label: 'Country', hint: 'Same first nationality; a neighbouring scene (the Nordics, Benelux, the Baltics…) scores half; any other country up to 0.4, by how close its capital is (none past 2,500 km).' },
  { id: 'age', label: 'Age', hint: 'Birth dates two years apart score a third; unknown scores 0.3.' },
  { id: 'region', label: 'Region', hint: 'Same competitive region.' },
  { id: 'linked', label: 'Shared teammates', hint: 'Overlap between the two players’ top-50 teammate lists.' },
  { id: 'era', label: 'Same years', hint: 'Overlap between the years each earned prize money.' },
  { id: 'lobbies', label: 'Same tournaments', hint: 'FNCS grand finals and LANs both played, out of the shorter career (counted as at least 10).' },
  { id: 'earnings', label: 'Career earnings', hint: 'A tenfold gap in career earnings scores half.' },
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
  teammates: 5,
  lately: 3,
  titles: 4,
  champions: 5,
  stage: 4,
  country: 2,
  age: 1.5,
  region: 1,
  linked: 1,
  era: 2,
  lobbies: 1.5,
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

/** How many finals or major LANs together make a full "teamed up lately". */
const LATELY_FULL = 3;

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
  const events = new Set((context.majors?.resultsFor(player.id) ?? []).map((result) => result.tournament.name));
  return {
    player,
    born: player.birthDate ? Date.parse(player.birthDate) : NaN,
    mates: new Map(context.teammates.matesOf(player.id)),
    mateIds: new Set(context.teammates.matesOf(player.id).map(([id]) => id)),
    titles: titlesWith(player.id, context),
    lately: latelyWith(player.id, context),
    stage: stageMates(player.id, context),
    years: new Set(Object.keys(player.earningsByYear)),
    events,
    orgs: orgsOf(player.id),
  };
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
      const sum = (Object.keys(parts) as AttributeId[]).reduce(
        (acc, id) => acc + Math.max(0, weights[id]) * parts[id],
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
  return {
    teammates: Math.min(1, Math.log1p(together) / Math.log1p(40)),
    lately: Math.min(1, (target.lately.get(player.id) ?? 0) / LATELY_FULL),
    titles: onceOrTwice(target.titles.get(player.id) ?? 0),
    champions: target.stage.won.get(player.id) ?? 0,
    stage: onceOrTwice(target.stage.mates.get(player.id) ?? 0),
    country: countryCloseness(target.player.country, player.country),
    age,
    region: player.region !== null && player.region === target.player.region ? 1 : 0,
    linked: Math.min(1, jaccard(target.mateIds, theirMates) * 3),
    era: jaccard(target.years, new Set(Object.keys(player.earningsByYear))),
    lobbies: sharedEvents / Math.max(LOBBY_FLOOR, Math.min(target.events.size, theirEvents.length)),
    earnings: Math.max(0, 1 - earningsGap / 2),
    orgs: Math.min(1, sharedOrgs / 2),
    fncs: Math.max(0, 1 - Math.abs(player.fncsWins - target.player.fncsWins) / 5),
  };
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
