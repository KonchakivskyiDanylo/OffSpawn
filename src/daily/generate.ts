import { loadFacts, type Facts } from '@/data/liquipedia/facts';
import { loadMajors, type Majors } from '@/data/liquipedia/majors';
import { loadOrgs, type Orgs } from '@/data/liquipedia/orgs';
import { loadRankings, type Rankings } from '@/data/liquipedia/rankings';
import { loadRoster, type Roster, type RosterPlayer } from '@/data/liquipedia/roster';
import { loadTeammates, type Teammates } from '@/data/liquipedia/teammates';
import type { Socials } from '@/data/socials';
import { pickDaily as careerPath } from '@/games/career-path/daily';
import { freezeDaily as freezePairs, pickDaily as higherLower } from '@/games/higher-lower/daily';
import { buildCriteria } from '@/games/list/criteria';
import { pickDaily as list } from '@/games/list/daily';
import { freezeDaily as freezeBoard, pickDaily as tenaball } from '@/games/tenaball/daily';
import { pickDaily as ticTacToe } from '@/games/tic-tac-toe/daily';
import { pickDaily as whoAreYa } from '@/games/who-are-ya/daily';
import { pickDaily as wordle } from '@/games/wordle/daily';
import { makeRng } from '@/lib/rng';
import { DAILY_START, daysBetween } from './day';
import { knownPlayers } from './fame';
import { gamesOn, type DailyContext, type DailyGame, type DailyPuzzles, type DailySet } from './types';

/**
 * Makes a day's puzzles.
 *
 * Run by the server the first time a day is asked for, and kept (see
 * `server/index.ts`); run in the browser only when there is no server — the
 * dev server on its own. Deterministic for a given day, data and history.
 */

export interface DailyData {
  /** Fresh follower counts, when there are any — a grid may then carry a follower rule. */
  socials?: Socials | null;
  roster: Roster;
  majors: Majors;
  teammates: Teammates;
  facts: Facts;
  orgs: Orgs;
  rankings: Rankings;
}

export async function loadDailyData(): Promise<DailyData> {
  const [roster, majors, teammates, facts, orgs, rankings] = await Promise.all([
    loadRoster(),
    loadMajors(),
    loadTeammates(),
    loadFacts(),
    loadOrgs(),
    loadRankings(),
  ]);
  return { roster, majors, teammates, facts, orgs, rankings };
}

/**
 * Who a one-player game's secret is drawn from: the famous names more often
 * than the regulars, never the deep cuts. A daily is the one puzzle everyone
 * plays, and Random's 15% of names only the scene knows would make one day in
 * seven unwinnable for most of them.
 */
export const DAILY_MIX: Readonly<Record<'easy' | 'medium', number>> = { easy: 0.6, medium: 0.4 };

/**
 * How far back a secret is kept out, tried longest first. The famous pool is
 * about a hundred players across three games, so after two months or so the
 * oldest ones start coming round again.
 */
const SECRET_REST = [Infinity, 180, 60, 14, 0];

/** The games whose puzzle is one secret player. */
export const SECRET_GAMES: readonly DailyGame[] = ['wordle', 'career-path', 'who-are-ya'];

/**
 * The player a puzzle is about, by id: the secret of a one-player game, and
 * nothing for the rest. Only those count for "nobody in two games on one day"
 * (the user, 22 Oct 2026: "tenite and other's doesn't matter. Only solo player
 * games count"), so a Tenite board naming the day's Ready Up answer is fine.
 */
export function playersIn(game: DailyGame, puzzle: unknown): string[] {
  if (!SECRET_GAMES.includes(game)) return [];
  const secret = (puzzle as { secret?: string } | undefined)?.secret;
  return secret ? [secret] : [];
}

/**
 * The day's one-player answers, but that of `except` — and of any game not
 * served that day, like a daily taken back to unlimited, whose puzzle nobody
 * sees.
 */
export function takenOn(set: DailySet, except?: DailyGame): Set<string> {
  return new Set(servedIn(set).filter((game) => game !== except).flatMap((game) => playersIn(game, set.puzzles[game])));
}

/** The games a day has a puzzle for that are served that day. */
export function servedIn(set: DailySet): DailyGame[] {
  return gamesOn(set.day).filter((game) => set.puzzles[game]);
}

/**
 * Everything a picker draws with, for one day.
 *
 * `others` are the days around it, before or after — a schedule made ahead
 * (the editor on /analytics/daily) has days after this one, and a puzzle should
 * not repeat on either side. `taken` is every player already the answer in a
 * one-player game that day; a picker adds nothing to it, `generateDaily` does. `salt` makes a
 * different draw for the same day, for the editor's "New".
 */
export function dailyContext(
  day: string,
  data: DailyData,
  others: readonly DailySet[],
  taken: ReadonlySet<string> = new Set(),
  salt = '',
): DailyContext {
  const around = others
    .filter((set) => set.day !== day)
    .map((set) => ({ daysAgo: Math.abs(daysBetween(set.day, day)), puzzles: set.puzzles }))
    .sort((a, b) => a.daysAgo - b.daysAgo);
  const seed = (purpose: string) => `daily:${day}${salt}:${purpose}`;
  return {
    day,
    seed,
    rng: (purpose) => makeRng(seed(purpose)),
    taken,
    recent: <G extends DailyGame>(game: G) =>
      around.flatMap(({ daysAgo, puzzles }) => {
        const puzzle = puzzles[game];
        return puzzle ? [{ daysAgo, puzzle: puzzle as DailyPuzzles[G] }] : [];
      }),
    pickPlayer: (game, pool) => {
      const rng = makeRng(seed(`${game}:secret`));
      const known = knownPlayers(data.roster);
      const dealt = around.flatMap(({ daysAgo, puzzles }) =>
        SECRET_GAMES.flatMap((other) => {
          const puzzle = puzzles[other] as { secret?: string } | undefined;
          return puzzle?.secret ? [{ daysAgo, id: puzzle.secret }] : [];
        }),
      );
      for (const rest of SECRET_REST) {
        const resting = new Set(dealt.filter((entry) => entry.daysAgo <= rest).map((entry) => entry.id));
        const open = (tier: 'easy' | 'medium') =>
          pool.filter(
            (player) =>
              player.tier === tier &&
              known.has(player.id) &&
              !taken.has(player.id) &&
              !resting.has(player.id),
          );
        const tiers = (['easy', 'medium'] as const).map((tier) => ({ tier, players: open(tier) })).filter((t) => t.players.length > 0);
        if (tiers.length === 0) continue;
        let roll = rng() * tiers.reduce((sum, t) => sum + DAILY_MIX[t.tier], 0);
        const chosen = tiers.find((t) => (roll -= DAILY_MIX[t.tier]) < 0) ?? tiers[tiers.length - 1];
        const secret: RosterPlayer = chosen.players[Math.floor(rng() * chosen.players.length)];
        return secret;
      }
      return null;
    },
  };
}

/** One game's puzzle for the day the context is about, or null when its data cannot make one. */
export function pickPuzzle<G extends DailyGame>(game: G, data: DailyData, ctx: DailyContext): DailyPuzzles[G] | null {
  const { roster, majors, teammates, facts, orgs, rankings } = data;
  const socials = data.socials ?? null;
  const byId = new Map(roster.players.map((player) => [player.id, player]));
  const made: { [K in DailyGame]: () => DailyPuzzles[K] | null } = {
    wordle: () => wordle(roster, ctx),
    'career-path': () => careerPath(roster, majors, ctx),
    'who-are-ya': () => whoAreYa(roster, teammates, facts, byId, ctx),
    tenaball: () => tenaball(roster, rankings, socials, majors, ctx, facts),
    list: () => list(roster, buildCriteria(roster, facts, null, orgs, teammates, socials), ctx),
    'tic-tac-toe': () => ticTacToe(roster, facts, orgs, socials, ctx),
    'higher-lower': () => higherLower(roster, ctx),
  };
  return made[game]() as DailyPuzzles[G] | null;
}

/**
 * The days a new day steers clear of: every other day once the dailies have
 * started — never the preview days before `DAILY_START`, which nobody but a
 * tester saw.
 */
function aroundDay(day: string, history: readonly DailySet[]): DailySet[] {
  return history.filter((set) => set.day !== day && (day < DAILY_START || set.day >= DAILY_START));
}

/**
 * `games` is the dailies being served that day: a game played unlimited for
 * now, or one whose daily had not started yet (`DAILY_FROM`), gets no puzzle,
 * so it uses up no board or player nobody plays. `check:games` passes every
 * built one, to keep them all tested.
 *
 * `kept` is the day as the store already has it: its puzzles stay as they are,
 * and only the games it lacks are made, clear of its one-player answers — how a
 * daily that starts later gets its first days filled in.
 */
export function generateDaily(
  day: string,
  data: DailyData,
  history: readonly DailySet[],
  games: readonly DailyGame[] = gamesOn(day),
  kept?: DailySet,
): DailySet {
  const puzzles: Partial<DailyPuzzles> = { ...kept?.puzzles };
  const taken = kept ? takenOn(kept) : new Set<string>();
  const ctx = dailyContext(day, data, aroundDay(day, history), taken);
  // Each on its own: a game whose data is missing is left out, not the whole day.
  for (const game of games) {
    if (puzzles[game]) continue;
    try {
      const puzzle = pickPuzzle(game, data, ctx);
      if (!puzzle) continue;
      (puzzles as Record<string, unknown>)[game] = puzzle;
      for (const id of playersIn(game, puzzle)) taken.add(id);
    } catch (error) {
      console.error(`daily ${day}: ${game} failed`, error);
    }
  }
  return kept ? { ...kept, puzzles } : { day, puzzles };
}

/** The games served on `set`'s day that it has no puzzle for yet. */
export function missingFrom(set: DailySet): DailyGame[] {
  return gamesOn(set.day).filter((game) => !set.puzzles[game]);
}

/**
 * Pins a day's Tenite board and Higher or Lower's numbers to the data they are
 * played on: the server calls this the first time it serves a day on or after
 * its date, and keeps what it returns. Null when there is nothing new to keep.
 *
 * The other dailies are rebuilt from their descriptor — a player and the clues
 * in order — which a data update cannot change. List and Tic Tac Toe would want
 * pinning before they are a daily again.
 */
export function freezeDay(set: DailySet, data: DailyData, today: string): DailySet | null {
  const { tenaball: board, 'higher-lower': pairs } = set.puzzles;
  const frozenBoard =
    board && freezeBoard(board, data.rankings, data.roster, data.socials ?? null, data.majors, today, data.facts);
  const frozenPairs = pairs && freezePairs(pairs, data.roster);
  if (!frozenBoard && !frozenPairs) return null;
  return {
    ...set,
    puzzles: {
      ...set.puzzles,
      ...(frozenBoard ? { tenaball: frozenBoard } : {}),
      ...(frozenPairs ? { 'higher-lower': frozenPairs } : {}),
    },
  };
}
