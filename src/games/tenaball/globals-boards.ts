import type { MajorTournament, Majors } from '@/data/liquipedia/majors';
import type { Board } from '@/data/liquipedia/rankings';
import type { Roster } from '@/data/liquipedia/roster';
import { board, byValue, SLOTS, NEEDED, type Ranked } from './board-builder';

/**
 * The FNCS Global Championships as Tenite boards: the best at them over the
 * years, the best average over the Globals played — one board for each
 * minimum, from one Globals up to all of them — and the worst average among
 * those who have been to every one (the user, 13 Oct 2026: "min4, min3, min2,
 * min1 all of them").
 *
 * Built in the browser from `career_path.json`, which already holds every
 * player's finish at every Globals, so they need no notebook run and change
 * whenever that file does — a new Globals joins them by itself.
 *
 * The 2019 World Cup is not a Globals here (see the `global` term), so it is
 * not in these.
 */

export const GLOBALS_GROUP = 'Global Championships';

/**
 * A missed Globals: twice a full lobby's last place in its format, the season
 * boards' rule (`MISSED` in `scripts/pipeline/derived.py`).
 */
const MISSED: Record<string, number> = { Solo: 200, Duo: 100, Trio: 66, Squad: 50 };
const MODE_WORD: Record<string, string> = { Solo: 'solos', Duo: 'duos', Trio: 'trios', Squad: 'squads' };

/**
 * The worst board asks about the players at every Globals. Once that is fewer
 * than this — each new Globals thins it — it takes those who missed one
 * instead (the user: "if there is like 15 players like that then do players
 * who qualed to at least 3 of globals").
 */
export const EVERY_POOL_MIN = 20;

const TIE = 'Level averages are split by career earnings, the bigger earner higher.';
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => WORDS[n] ?? String(n);

/** 7.75, 5.5, 8 — a Globals average is a multiple of a quarter or a third, so two places at most. */
const average = (value: number) => String(Number(value.toFixed(2)));

/** The Globals with results, oldest first. One still to be played is not one anybody missed. */
export function globalsEvents(majors: Majors): MajorTournament[] {
  return majors.tournaments
    .filter((event) => /Global Championship/.test(event.name))
    .filter((event) => majors.fieldOf(event.name).some((finish) => finish.placement === 1))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Each player's finish at each Globals, by event name. */
function finishesBy(majors: Majors, events: readonly MajorTournament[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const event of events) {
    for (const { placement, players } of majors.fieldOf(event.name)) {
      for (const id of players) {
        let mine = out.get(id);
        if (!mine) out.set(id, (mine = new Map()));
        // A player listed twice keeps the better finish, as on the season boards.
        mine.set(event.name, Math.min(placement, mine.get(event.name) ?? placement));
      }
    }
  }
  return out;
}

function join(words: string[]): string {
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

export function globalsBoards(majors: Majors, roster: Roster): Board[] {
  const events = globalsEvents(majors);
  // One Globals is a tournament board, not a career; two is not much of one either.
  if (events.length < 3) return [];
  const n = events.length;
  const years = `${events[0].year}–${events[n - 1].year}`;
  const finishes = finishesBy(majors, events);
  const byId = new Map(roster.players.map((player) => [player.id, player]));
  const out: Board[] = [];

  /**
   * Ranks the averages and makes the board. A player the roster cannot name in
   * the top eleven would make the 11th look 10th, so that board is not built —
   * the notebook's rule for its average boards.
   */
  const add = (id: string, title: string, tieRule: string, averages: Map<string, number>, worstFirst = false) => {
    const ranked: Ranked[] = [...averages].map(([key, value]) => {
      const player = byId.get(key);
      return {
        key,
        label: player?.name ?? '',
        value,
        display: average(value),
        tiebreak: player?.earnings ?? -1,
      };
    });
    const sorted = byValue(ranked, !worstFirst);
    if (sorted.slice(0, NEEDED).some((row) => !byId.has(row.key))) return;
    const made = board(id, GLOBALS_GROUP, title, 'player', tieRule, sorted, !worstFirst);
    // The same ten in the same order as a board already made says nothing new:
    // today "played all four" is exactly the best-at-every-Globals board, since
    // its ten never missed one. It comes back once the two differ.
    const same = (a: Board, b: Board) =>
      a.rows.every((row, i) => row.key === b.rows[i]?.key) && a.next.key === b.next.key;
    if (made && !out.some((other) => same(made, other))) out.push(made);
  };

  // 1. The best at the Globals, every one counted: a missed one is twice a full lobby's last place.
  const modes = [...new Set(events.map((event) => event.mode ?? ''))].sort((a, b) => (MISSED[b] ?? 0) - (MISSED[a] ?? 0));
  if (modes.every((mode) => mode in MISSED)) {
    const best = new Map<string, number>();
    for (const [id, mine] of finishes) {
      const total = events.reduce((sum, event) => sum + (mine.get(event.name) ?? MISSED[event.mode!]), 0);
      best.set(id, total / n);
    }
    const missed =
      modes.length === 1
        ? `A missed one counts as ${MISSED[modes[0]]}th, twice a full lobby’s last place.`
        : `A missed one counts as twice a full lobby’s last place: ${join(modes.map((mode) => `${MISSED[mode]}th in ${MODE_WORD[mode]}`))}.`;
    add(
      'globals:best',
      'Top 10 players at the Global Championships',
      `Average finish across all ${word(n)} Global Championships, ${years}. ${missed} ${TIE}`,
      best,
    );
  }

  // 2. The best average over the Globals each player reached: one board per
  //    minimum played, from any one of them up to every one. The titles share a
  //    family ("… — two or more played"), so the daily keeps them a week apart.
  for (let least = 1; least <= n; least++) {
    const played = new Map<string, number>();
    for (const [id, mine] of finishes) {
      if (mine.size < least) continue;
      played.set(id, [...mine.values()].reduce((sum, place) => sum + place, 0) / mine.size);
    }
    const who =
      least === 1
        ? 'however many that was'
        : `counting only players at ${least === n ? `all ${word(n)}` : `${word(least)} or more of the ${word(n)}`}`;
    add(
      `globals:average:${least}`,
      `Top 10 by average Globals finish — ${least === n ? `played all ${word(n)}` : least === 1 ? 'one or more played' : `${word(least)} or more played`}`,
      `Average finish at the Global Championships each player reached (${years}), ${who}. ${TIE}`,
      played,
    );
  }

  // 3. The worst average among the players at every Globals — or at all but one, once too few have been to all.
  const every = [...finishes].filter(([, mine]) => mine.size === n);
  const allOf = every.length >= EVERY_POOL_MIN;
  const pool = allOf ? every : [...finishes].filter(([, mine]) => mine.size >= n - 1);
  if (pool.length > SLOTS) {
    const worst = new Map(pool.map(([id, mine]) => [id, [...mine.values()].reduce((sum, place) => sum + place, 0) / mine.size]));
    add(
      'globals:worst',
      allOf
        ? `Top 10 worst average Globals finish — played all ${word(n)}`
        : `Top 10 worst average Globals finish — ${word(n - 1)} or more of ${word(n)} played`,
      `The ${pool.length} players at ${allOf ? `every Global Championship, ${years}` : `${word(n - 1)} or more of the ${word(n)} Global Championships (${years})`}, ranked by their average finish there, worst first. ${TIE}`,
      worst,
      true,
    );
  }

  return out;
}
