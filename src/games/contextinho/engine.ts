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
  | 'titles'
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
  { id: 'titles', label: 'FNCS wins together', hint: 'Regional FNCS finals won on the same team: one scores 0.7, two or more a full match.' },
  { id: 'stage', label: 'Big events together', hint: 'Teammates at the World Cup, a Global Championship or another major LAN: once scores 0.7; twice, or a podium, a full match.' },
  { id: 'country', label: 'Country', hint: 'Same first nationality; a neighbouring scene (the Nordics, Benelux, the Baltics…) scores half.' },
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
  titles: 4,
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
 * There is no third, same-continent step on purpose: `region` is already that
 * — Liquipedia reads it off nationality (Mexico is North America, Turkey and
 * South Africa the Middle East), so a continent score would only count region
 * twice. Countries in no scene — France, Brazil, Japan, South Korea, Turkey,
 * Israel, Iran — are big enough or apart enough to stand alone.
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

/** 1 for the same country, `SAME_SCENE` for a neighbour in the same scene, else 0. */
export function countryCloseness(a: string | null, b: string | null): number {
  if (a === null || b === null) return 0;
  if (a === b) return 1;
  const scene = SCENE_OF.get(a);
  return scene !== undefined && scene === SCENE_OF.get(b) ? SAME_SCENE : 0;
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
function stageMates(playerId: string, context: Context): Map<string, number> {
  const out = new Map<string, number>();
  if (!context.facts || !context.majors) return out;
  const big = new Set(context.facts.headlineEvents.map((event) => event.name));
  for (const result of context.majors.resultsFor(playerId)) {
    if (!big.has(result.tournament.name)) continue;
    const team = context.majors.finishers(result);
    if (team.size > (TEAM_SIZE[result.tournament.mode ?? ''] ?? 1)) continue;
    const times = result.placement <= 3 ? 2 : 1;
    for (const id of team) if (id !== playerId) out.set(id, (out.get(id) ?? 0) + times);
  }
  return out;
}

/** Once together is already a strong clue; twice is as strong as it gets. */
function onceOrTwice(times: number): number {
  return times >= 2 ? 1 : times === 1 ? 0.7 : 0;
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
    titles: context.facts?.fncsTitlesWith(player.id) ?? new Map<string, number>(),
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
    titles: onceOrTwice(target.titles.get(player.id) ?? 0),
    stage: onceOrTwice(target.stage.get(player.id) ?? 0),
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
