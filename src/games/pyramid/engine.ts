import type { GamePayloads, Outcome } from '@/analytics/types';
import type { Facts } from '@/data/liquipedia/facts';
import type { Majors } from '@/data/liquipedia/majors';
import { membersOf, type Rankings } from '@/data/liquipedia/rankings';
import type { FameTier, Roster, RosterPlayer } from '@/data/liquipedia/roster';
import { money, ordinal } from '@/lib/format';
import { makeRng, shuffle, type Rng } from '@/lib/rng';
import { countShort, PLATFORM_META, type Socials } from '@/data/socials';

/**
 * Pure logic for Pyramid: ten players and one category, sorted into a pyramid
 * of 1, 2, 3 and 4 with the best at the top.
 *
 * Built to the user's roadmap (30 Sep 2026): V1's simple categories and its
 * check-the-whole-order loop, with V3's player selection and three levels.
 */

export const SIZE = 10;
/** The pyramid, top down: 1 + 2 + 3 + 4 = 10. */
export const ROWS = [1, 2, 3, 4] as const;

export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * What each level promises.
 *
 * `lives` is how many checks that are not perfect it takes to lose — none on
 * Easy, where checking is how you learn the order. `bands` is who can come up.
 * `start` is how far down the ranking the ten may begin — never the long tail
 * of one-off entries at the bottom, which nobody can order — and `gap` how much
 * each money value must drop from the one above it, so no two are a coin flip:
 * wider on Easy, tighter on Hard.
 */
export const LEVELS: Record<Difficulty, { lives: number; bands: FameTier[]; start: number; gap: number }> = {
  easy: { lives: Number.POSITIVE_INFINITY, bands: ['easy'], start: 0.25, gap: 0.12 },
  medium: { lives: 2, bands: ['easy', 'medium'], start: 0.35, gap: 0.06 },
  hard: { lives: 1, bands: ['easy', 'medium', 'hard'], start: 0.5, gap: 0.03 },
};

/** One thing to sort: a player, or on a tournament a team. */
export interface Item {
  id: string;
  name: string;
  value: number;
  /** The value as it is shown once the pyramid is over: "$1.2M", "14 finals", "3rd". */
  display: string;
}

export interface Puzzle {
  /** Which category — the analytics groups rounds by it. */
  id: string;
  /** Picker heading and card label: Players, Tournament. */
  group: string;
  /** "FNCS grand finals played", "Top 10 at FNCS 2024 Global Championship". */
  title: string;
  /** "Most at the top", "Best finish at the top". */
  direction: string;
  /** In the right order, best first. */
  items: Item[];
}

// ------------------------------------------------------------- categories --

interface PlayerCategory {
  id: string;
  title: string;
  /** Money drops by a share of itself; a count by at least one. */
  kind: 'money' | 'count';
  value: (player: RosterPlayer) => number;
  display: (value: number) => string;
}

const count = (word: string) => (value: number) => `${value} ${word}${value === 1 ? '' : 's'}`;

/**
 * The categories, one per kind. Earnings in a year is one kind with a year
 * drawn inside it, so nine years do not crowd out everything else.
 *
 * LAN wins is on the roadmap and not here: only fifteen players have won one,
 * almost all of them once, so ten players on it would be nearly all tied.
 */
function playerKinds(roster: Roster, facts: Facts, socials: Socials | null): PlayerCategory[][] {
  const years = [...new Set(roster.players.flatMap((player) => Object.keys(player.earningsByYear)))]
    .map(Number)
    .sort();
  const kinds: PlayerCategory[][] = [
    [
      {
        id: 'fncs-finals',
        title: 'FNCS grand finals played',
        kind: 'count',
        value: (player) => facts.of(player.id).fncsApps,
        display: count('final'),
      },
    ],
    [{ id: 'fncs-wins', title: 'FNCS wins', kind: 'count', value: (player) => player.fncsWins, display: count('title') }],
    [
      {
        id: 'earnings',
        title: 'Career earnings',
        kind: 'money',
        value: (player) => (player.earningsKnown ? player.earnings : 0),
        display: money,
      },
    ],
    years.map((year) => ({
      id: `earnings:${year}`,
      title: `Earnings in ${year}`,
      kind: 'money' as const,
      value: (player: RosterPlayer) => player.earningsByYear[year] ?? 0,
      display: money,
    })),
    [
      {
        id: 'lan-apps',
        title: 'Major LAN appearances',
        kind: 'count',
        value: (player) => facts.of(player.id).lanApps,
        display: count('LAN'),
      },
    ],
    // Followers, one kind for both platforms, while the server has fresh counts.
    (socials?.platforms ?? []).map((platform) => ({
      id: `followers:${platform}`,
      title: PLATFORM_META[platform].noun,
      kind: 'money' as const,
      value: (player: RosterPlayer) => socials!.of(platform, player) ?? 0,
      display: (value: number) => `${countShort(value)} ${PLATFORM_META[platform].short}`,
    })),
  ];
  return kinds.filter((kind) => kind.length > 0);
}

/**
 * Who a follower pyramid draws from: the biggest channels, not the level's
 * earnings band — the famous streamers are rarely the top earners, and an Easy
 * pyramid of pros with a few thousand followers would be the hardest on the site.
 */
const FOLLOWER_POOL: Record<Difficulty, number> = { easy: 60, medium: 200, hard: Number.POSITIVE_INFINITY };

/**
 * Ten players from one category, close together in its ranking.
 *
 * Money: rank the level's players, start at a random place in the top `start`
 * share, and walk down, taking the next player whose value is at least `gap`
 * below the last one taken.
 *
 * Counts (finals, wins, LANs): the same, over the distinct values rather than
 * the players, one player per value. FNCS wins and LANs have fewer than ten
 * values to go round, so when the values run out a second player joins one of
 * them — at most `MAX_LEVEL_PAIRS` times, never three on one value.
 *
 * Players level on a value can go either way round, so a pair costs nothing;
 * it just gives the pyramid one fewer thing to know.
 */
const MAX_LEVEL_PAIRS = 3;

function drawPlayers(
  category: PlayerCategory,
  pool: readonly RosterPlayer[],
  difficulty: Difficulty,
  rng: Rng,
): Item[] | null {
  const { start, gap } = LEVELS[difficulty];
  // Shuffled first, so who stands for a crowded value is a draw, not the alphabet.
  const ranked = shuffle(rng, pool)
    .map((player) => ({ player, value: category.value(player) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
  if (ranked.length < SIZE) return null;
  const item = ({ player, value }: (typeof ranked)[number]): Item => ({
    id: player.id,
    name: player.name,
    value,
    display: category.display(value),
  });
  const from = (length: number) => Math.floor(rng() * Math.max(1, Math.floor(length * start)));

  if (category.kind === 'money') {
    for (let attempt = 0; attempt < 12; attempt++) {
      const picked: typeof ranked = [];
      for (let i = from(ranked.length); i < ranked.length && picked.length < SIZE; i++) {
        const last = picked[picked.length - 1];
        if (!last || ranked[i].value <= last.value * (1 - gap)) picked.push(ranked[i]);
      }
      if (picked.length === SIZE) return picked.map(item);
    }
    return null;
  }

  const byValue = new Map<number, typeof ranked>();
  for (const entry of ranked) byValue.set(entry.value, [...(byValue.get(entry.value) ?? []), entry]);
  const values = [...byValue.keys()];
  // Where the ten can still start and reach ten with the pairs allowed.
  const latest = values.length - (SIZE - MAX_LEVEL_PAIRS);
  if (latest < 0) return null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const chosen = values.slice(Math.min(from(values.length), latest)).slice(0, SIZE);
    const pairs = SIZE - chosen.length;
    const doubled = new Set(shuffle(rng, chosen.filter((value) => byValue.get(value)!.length >= 2)).slice(0, pairs));
    if (doubled.size < pairs) continue;
    return chosen.flatMap((value) => byValue.get(value)!.slice(0, doubled.has(value) ? 2 : 1)).map(item);
  }
  return null;
}

/**
 * How deep into a tournament's results the ten may come from: Easy the top 20,
 * Medium the top 30, Hard anywhere. Ten of the top ten every time made the
 * category a recital of the podium (the user, 1 Oct 2026: "it shouldn't be top
 * 10 always, could be random placements").
 */
const FIELD_DEPTH: Record<Difficulty, number> = { easy: 20, medium: 30, hard: Number.POSITIVE_INFINITY };

/** "aqua & nyhrox", "Japko, panzer & Setty" — the board labels' style. */
function teamLabel(names: string[]): string {
  const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return sorted.length <= 2 ? sorted.join(' & ') : `${sorted.slice(0, -1).join(', ')} & ${sorted[sorted.length - 1]}`;
}

/**
 * Ten random placements from the event's whole field, from `career_path.json`.
 * Only places whose whole team is on the roster: a team short of a member
 * cannot be named, and a placement nobody can name is not a fair item. Null
 * when the field is too thin to draw ten from, and the top ten stand in.
 */
function randomPlacements(
  event: string,
  teamSize: number,
  majors: Majors,
  names: ReadonlyMap<string, string>,
  difficulty: Difficulty,
  rng: Rng,
): Item[] | null {
  const pool = majors
    .fieldOf(event)
    .filter(({ placement, players }) =>
      placement <= FIELD_DEPTH[difficulty] && players.length === teamSize && players.every((id) => names.has(id)),
    );
  if (pool.length < SIZE) return null;
  return shuffle(rng, pool)
    .slice(0, SIZE)
    .sort((a, b) => a.placement - b.placement)
    .map(({ placement, players }) => ({
      id: [...players].sort().join('|'),
      name: teamLabel(players.map((id) => names.get(id)!)),
      value: placement,
      display: ordinal(placement),
    }));
}

/**
 * Ten finishers at one tournament, events picked from Tenaball's precomputed
 * boards: on a duos or trios event each item is the team. Easy asks about
 * Epic's LANs only, Medium adds the European and North American FNCS finals
 * since 2024, Hard every final there is a board for. With the majors loaded the
 * ten are drawn from the whole field (`randomPlacements`); without, the board's
 * top ten.
 */
function tournamentPuzzle(
  rankings: Rankings,
  difficulty: Difficulty,
  rng: Rng,
  majors: Majors | null,
  names: ReadonlyMap<string, string>,
): Puzzle | null {
  const boards = rankings.boards.filter((board) => {
    if (!board.id.startsWith('tournament:') || board.rows.length !== SIZE) return false;
    if (board.group === 'Tournaments') return true;
    if (difficulty === 'hard') return true;
    const year = Number(/\b(20\d\d)\b/.exec(board.title)?.[1] ?? 0);
    return difficulty === 'medium' && /Europe|North America/.test(board.group) && year >= 2024;
  });
  if (boards.length === 0) return null;
  const board = boards[Math.floor(rng() * boards.length)];
  const drawn = majors
    ? randomPlacements(
        board.id.slice('tournament:'.length),
        membersOf(board.rows[0]).length,
        majors,
        names,
        difficulty,
        rng,
      )
    : null;
  if (drawn) {
    return {
      id: board.id,
      group: 'Tournament',
      title: board.title.replace(/^Top 10 at /, 'Ten finishers at '),
      direction: 'Best finish at the top',
      items: drawn,
    };
  }
  return {
    id: board.id,
    group: 'Tournament',
    title: board.title,
    direction: 'Best finish at the top',
    items: board.rows.map((row) => ({
      id: membersOf(row)
        .map((member) => member.key)
        .join('|'),
      name: row.label,
      value: row.value,
      display: ordinal(row.value),
    })),
  };
}

/**
 * A new pyramid.
 *
 * A kind of category first, all kinds equally likely — the five player kinds
 * and tournaments, when `rankings` has loaded — then a category inside it,
 * then the ten. A draw that cannot make ten tries another category rather
 * than showing something lopsided. `avoid` is the last pyramid's category.
 */
export function generatePuzzle(
  roster: Roster,
  facts: Facts,
  rankings: Rankings | null,
  difficulty: Difficulty,
  seed: string = String(Date.now()),
  avoid: string | null = null,
  /** Every finish at every major, for tournaments drawn from the whole field. */
  majors: Majors | null = null,
  /** Fresh follower counts, when there are any — `data/socials.ts`. */
  socials: Socials | null = null,
): Puzzle | null {
  const rng = makeRng(seed);
  const level = LEVELS[difficulty];
  const pool = level.bands.flatMap((band) => roster.exactly(band));
  const kinds: (PlayerCategory[] | 'tournament')[] = [...playerKinds(roster, facts, socials)];
  if (rankings) kinds.push('tournament');
  const names = new Map(roster.players.map((player) => [player.id, player.name]));

  for (let attempt = 0; attempt < 40; attempt++) {
    const kind = kinds[Math.floor(rng() * kinds.length)];
    if (kind === 'tournament') {
      const puzzle = tournamentPuzzle(rankings!, difficulty, rng, majors, names);
      if (puzzle && puzzle.id !== avoid) return puzzle;
      continue;
    }
    const category = kind[Math.floor(rng() * kind.length)];
    if (category.id === avoid) continue;
    const from = category.id.startsWith('followers:')
      ? [...roster.players]
          .sort((a, b) => category.value(b) - category.value(a))
          .slice(0, FOLLOWER_POOL[difficulty])
      : pool;
    const items = drawPlayers(category, from, difficulty, rng);
    if (items) {
      return { id: category.id, group: 'Players', title: category.title, direction: 'Most at the top', items };
    }
  }
  return null;
}

// ------------------------------------------------------------------- play --

export interface GameState {
  puzzle: Puzzle;
  difficulty: Difficulty;
  /** The current arrangement, top of the pyramid first. */
  order: Item[];
  /** Items a check has confirmed in place. They cannot move again. */
  locked: ReadonlySet<string>;
  /** Items the last check found in the wrong place and that have not moved since. */
  wrong: ReadonlySet<string>;
  checks: number;
  lives: number;
  status: 'playing' | 'won' | 'lost';
  gaveUp: boolean;
}

/**
 * Whether the item at `position` belongs there.
 *
 * Compared on the value, not the item, so players level on a value are right
 * in either order — the V1 tie rule.
 */
export function rightAt(puzzle: Puzzle, order: readonly Item[], position: number): boolean {
  return order[position].value === puzzle.items[position].value;
}

/** A shuffle with at most one item already in place, so the start gives nothing away. */
export function createGame(puzzle: Puzzle, difficulty: Difficulty, seed: string = String(Date.now())): GameState {
  const rng = makeRng(`${seed}:order`);
  let order = shuffle(rng, puzzle.items);
  for (let tries = 0; tries < 50; tries++) {
    const inPlace = order.filter((_, position) => rightAt(puzzle, order, position)).length;
    if (inPlace <= 1) break;
    order = shuffle(rng, puzzle.items);
  }
  return {
    puzzle,
    difficulty,
    order,
    locked: new Set(),
    wrong: new Set(),
    checks: 0,
    lives: LEVELS[difficulty].lives,
    status: 'playing',
    gaveUp: false,
  };
}

/** Swaps two positions. A locked item stays where it is, and so does a finished game. */
export function swap(state: GameState, a: number, b: number): GameState {
  if (state.status !== 'playing' || a === b) return state;
  const [first, second] = [state.order[a], state.order[b]];
  if (!first || !second || state.locked.has(first.id) || state.locked.has(second.id)) return state;
  const order = [...state.order];
  [order[a], order[b]] = [second, first];
  // A red mark was about the old position; after a move it says nothing.
  const wrong = new Set(state.wrong);
  wrong.delete(first.id);
  wrong.delete(second.id);
  return { ...state, order, wrong };
}

/**
 * Checks the whole pyramid.
 *
 * Everything in place locks; the rest is marked. All ten right wins. Anything
 * less costs a life where the level has them, and the last one ends the game.
 */
export function check(state: GameState): GameState {
  if (state.status !== 'playing') return state;
  const locked = new Set(state.locked);
  const wrong = new Set<string>();
  state.order.forEach((item, position) => {
    if (rightAt(state.puzzle, state.order, position)) locked.add(item.id);
    else wrong.add(item.id);
  });
  const checks = state.checks + 1;
  if (wrong.size === 0) return { ...state, locked, wrong, checks, status: 'won' };
  const lives = state.lives - 1;
  return { ...state, locked, wrong, checks, lives, status: lives <= 0 ? 'lost' : 'playing' };
}

export function giveUp(state: GameState): GameState {
  return state.status === 'playing' ? { ...state, status: 'lost', gaveUp: true } : state;
}

/** How many are in the right place right now. */
export function inPlace(state: GameState): number {
  return state.order.filter((_, position) => rightAt(state.puzzle, state.order, position)).length;
}

/** The round for the analytics: the pyramid, each item and whether it ended in its place. */
export function record(state: GameState): { outcome: Outcome; r: GamePayloads['pyramid'] } {
  return {
    outcome: state.status === 'won' ? 'won' : state.gaveUp ? 'gave-up' : 'lost',
    r: {
      puzzle: { id: state.puzzle.id, name: state.puzzle.title },
      items: state.order.map((item, position) => ({
        id: item.id,
        name: item.name,
        placed: rightAt(state.puzzle, state.order, position),
      })),
      checks: state.checks,
    },
  };
}
