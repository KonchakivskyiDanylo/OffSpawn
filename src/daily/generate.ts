import { loadFacts, type Facts } from '@/data/liquipedia/facts';
import { loadMajors, type Majors } from '@/data/liquipedia/majors';
import { loadOrgs, type Orgs } from '@/data/liquipedia/orgs';
import { loadRankings, type Rankings } from '@/data/liquipedia/rankings';
import { loadRoster, type Roster, type RosterPlayer } from '@/data/liquipedia/roster';
import { loadTeammates, type Teammates } from '@/data/liquipedia/teammates';
import type { Socials } from '@/data/socials';
import { pickDaily as careerPath } from '@/games/career-path/daily';
import { buildCriteria } from '@/games/list/criteria';
import { pickDaily as list } from '@/games/list/daily';
import { pickDaily as tenaball } from '@/games/tenaball/daily';
import { pickDaily as ticTacToe } from '@/games/tic-tac-toe/daily';
import { pickDaily as whoAreYa } from '@/games/who-are-ya/daily';
import { pickDaily as wordle } from '@/games/wordle/daily';
import { makeRng } from '@/lib/rng';
import { DAILY_START, daysBetween } from './day';
import { knownPlayers } from './fame';
import { LIVE_DAILY, type DailyContext, type DailyGame, type DailyPuzzles, type DailySet } from './types';

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

/** The games whose puzzle is one secret player — no two the same player on one day. */
const SECRET_GAMES: DailyGame[] = ['wordle', 'career-path', 'who-are-ya'];

/**
 * Everything a picker draws with, for one day.
 *
 * `others` are the days around it, before or after — a schedule made ahead
 * (the editor on /analytics/daily) has days after this one, and a puzzle should
 * not repeat on either side. `taken` is the secret players already dealt this
 * day. `salt` makes a different draw for the same day, for the editor's "New".
 */
export function dailyContext(
  day: string,
  data: DailyData,
  others: readonly DailySet[],
  taken: Set<string> = new Set(),
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
        taken.add(secret.id);
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
    tenaball: () => tenaball(roster, rankings, socials, majors, ctx),
    list: () => list(roster, buildCriteria(roster, facts, null, orgs, teammates, socials), ctx),
    'tic-tac-toe': () => ticTacToe(roster, facts, orgs, socials, ctx),
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
 * `games` is the dailies being served: a game played unlimited for now gets no
 * puzzle, so it uses up no board or player nobody plays. `check:games` passes
 * every built one, to keep them all tested.
 */
export function generateDaily(
  day: string,
  data: DailyData,
  history: readonly DailySet[],
  games: readonly DailyGame[] = LIVE_DAILY,
): DailySet {
  const ctx = dailyContext(day, data, aroundDay(day, history));
  const puzzles: Partial<DailyPuzzles> = {};
  // Each on its own: a game whose data is missing is left out, not the whole day.
  for (const game of games) {
    try {
      const puzzle = pickPuzzle(game, data, ctx);
      if (puzzle) (puzzles as Record<string, unknown>)[game] = puzzle;
    } catch (error) {
      console.error(`daily ${day}: ${game} failed`, error);
    }
  }
  return { day, puzzles };
}
