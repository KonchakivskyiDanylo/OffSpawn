import { isRegionalFinal, type Facts, type HeadlineEvent } from '@/data/liquipedia/facts';
import type { Board, BoardRow } from '@/data/liquipedia/rankings';
import type { Roster, RosterPlayer } from '@/data/liquipedia/roster';
import { monthYear } from '@/lib/format';
import { board, byValue, NEEDED, SLOTS, tieText, type Ranked } from './board-builder';

/**
 * Who won the FNCS and the Div Cups, and when, as Tenite boards (the user,
 * 14 Oct 2026): the most FNCS wins in each FNCS region, the first and the last
 * ten different players to win one, the first and last ten countries, the
 * same for the Div Cups by region and by year — and any group of winners that
 * is exactly ten ("all different players who won eu fncs in chapter X, year X,
 * from country X. If there is more or less than 10 then don't do it").
 *
 * Built in the browser from `facts.json`: the FNCS from its regional finals
 * and their winners, the Div Cups from `divcups` (written by `derived.py`).
 * The FNCS regions are the finals' own, North America split the way the FNCS
 * split it: NA East and NA West until Major 1 of 2023, one North America final
 * (NA Central here) through 2024, then NA Central and NA West.
 *
 * A board is only made when it can be right: walking the wins in order, one
 * whose winning team is not all on the roster ends the walk, and if that
 * comes before the ten (and the 11th) are known, there is no board.
 */

export const FNCS_WINNERS_GROUP = 'FNCS winners';
export const DIVCUP_WINNERS_GROUP = 'Div Cup winners';

/** Players on a winning team, by format. */
const TEAM: Record<string, number> = { Solo: 1, Duo: 2, Trio: 3, Squad: 4 };

/** One final won, as these boards read it. */
export interface Win {
  date: string;
  /** The final's region: Europe, NA East, NA West, NA Central, Brazil, Asia, Middle East, Oceania. */
  region: string;
  /** Roster ids of the winners. */
  players: string[];
  /** Every winner is on the roster — otherwise the walk cannot go past it. */
  complete: boolean;
  year: number;
  /** "Chapter 2"… for the FNCS, "C7S3" for a Div Cup. */
  scope: string;
}

/** "EU" in a title, the rest as they are. */
const SHORT: Record<string, string> = { Europe: 'EU' };
const short = (region: string) => SHORT[region] ?? region;
/** "an EU Div Cup", "a Brazil Div Cup": by how the short name is said. */
const an = (region: string) => (/^(EU|NA|Asia|Oceania)/.test(short(region)) ? 'an' : 'a');

/** The FNCS region of a regional final, North America split by its name. */
export function fncsRegion(event: { region?: string | null; name: string }): string | null {
  const region = event.region ?? null;
  if (region === 'South America') return 'Brazil';
  if (region !== 'North America') return region;
  if (/NA East|North America East/.test(event.name)) return 'NA East';
  if (/NA West|North America West/.test(event.name)) return 'NA West';
  return 'NA Central';
}

/**
 * A chapter from the date of a final. Close enough at the edges, because no
 * FNCS final falls within weeks of a chapter's start.
 */
function chapterOf(date: string): number {
  const starts = ['2019-10-13', '2021-12-04', '2022-12-03', '2023-12-03', '2024-11-30', '2025-11-29'];
  return 1 + starts.filter((start) => date >= start).length;
}

export function fncsWins(facts: Facts, onRoster: (id: string) => boolean): Win[] {
  return facts.events
    .filter((event) => event.kind === 'fncs' && !event.lan)
    .flatMap((event) => {
      const players = [...facts.wonAt(event.index)];
      const region = fncsRegion(event);
      // A final still to be played has no winners yet.
      if (!players.length || !region) return [];
      const size = TEAM[event.mode ?? ''] ?? players.length;
      return [
        {
          date: event.date,
          region,
          players: players.filter(onRoster),
          complete: players.length === size && players.every(onRoster),
          year: event.year,
          scope: `Chapter ${chapterOf(event.date)}`,
        },
      ];
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function divCupWins(facts: Facts, onRoster: (id: string) => boolean): Win[] {
  return facts.divcups.map((win) => {
    const named = win.players.filter((id) => !id.startsWith('?') && onRoster(id));
    const size = TEAM[win.mode ?? ''] ?? win.players.length;
    return {
      date: win.date,
      region: win.region,
      players: named,
      complete: named.length === win.players.length && win.players.length === size,
      year: Number(win.date.slice(0, 4)),
      scope: win.season,
    };
  });
}

const DAY = 86_400_000;
export const dayNumber = (date: string) => Math.floor(Date.parse(date) / DAY);

/**
 * The first (or last) ten different players to win, in order: each player at
 * their own first (or latest) win in `wins`. Null when an incomplete win comes
 * before the eleventh name is known.
 */
function firstOrLast(wins: readonly Win[], latest: boolean, byId: ReadonlyMap<string, RosterPlayer>): Ranked[] | null {
  const ordered = latest ? [...wins].reverse() : wins;
  const seen = new Map<string, Ranked>();
  for (const win of ordered) {
    if (seen.size >= NEEDED) break;
    if (!win.complete) return null;
    for (const id of win.players) {
      if (seen.has(id)) continue;
      const player = byId.get(id)!;
      seen.set(id, { key: id, label: player.name, value: dayNumber(win.date), display: monthYear(win.date), tiebreak: player.earnings });
    }
  }
  return seen.size >= NEEDED ? byValue([...seen.values()], !latest) : null;
}

/** The same for countries: each country at its first (or latest) win, teammates' countries level. */
function countriesFirstOrLast(
  wins: readonly Win[],
  latest: boolean,
  byId: ReadonlyMap<string, RosterPlayer>,
): Ranked[] | null {
  const ordered = latest ? [...wins].reverse() : wins;
  const seen = new Map<string, Ranked>();
  for (const win of ordered) {
    if (seen.size >= NEEDED) break;
    if (!win.complete || win.players.some((id) => !byId.get(id)?.countryName)) return null;
    // Combined earnings of the country's winners on that day settle a tie.
    const money = new Map<string, number>();
    for (const id of win.players) {
      const player = byId.get(id)!;
      money.set(player.countryName!, (money.get(player.countryName!) ?? 0) + player.earnings);
    }
    for (const [country, earned] of money) {
      if (seen.has(country)) continue;
      seen.set(country, { key: country, label: country, value: dayNumber(win.date), display: monthYear(win.date), tiebreak: earned });
    }
  }
  return seen.size >= NEEDED ? byValue([...seen.values()], !latest) : null;
}

/**
 * A board of exactly ten: everyone who did it, nobody left over, so there is
 * no 11th. Listed by their first win in the group, oldest first.
 */
function exactTen(
  id: string,
  group: string,
  title: string,
  wins: readonly Win[],
  byId: ReadonlyMap<string, RosterPlayer>,
): Board | null {
  if (wins.some((win) => !win.complete)) return null;
  const first = new Map<string, Win>();
  for (const win of wins) for (const player of win.players) if (!first.has(player)) first.set(player, win);
  if (first.size !== SLOTS) return null;
  const rows: BoardRow[] = byValue(
    [...first].map(([key, win]) => ({
      key,
      label: byId.get(key)!.name,
      value: dayNumber(win.date),
      display: monthYear(win.date),
      tiebreak: byId.get(key)!.earnings,
    })),
    true,
  ).map(({ key, label, value, display }) => ({ key, label, value, display }));
  return {
    id,
    group,
    title,
    entity: 'player',
    tieRule: 'Exactly ten players did it. They are listed by their first win, oldest first.',
    rows,
    // Nobody is 11th on a board of exactly ten.
    next: { key: '', label: '', value: 0 },
    lowerIsBetter: true,
  };
}

export const TIE_FIRST = 'Oldest first. Teammates who won together are ranked by career earnings, the bigger earner higher.';
export const TIE_LAST = 'Newest first. Teammates who won together are ranked by career earnings, the bigger earner higher.';
const TIE_COUNTRY = (order: string) =>
  `${order}. Countries that won on the same day are split by the combined career earnings of their winners.`;

export function winnerBoards(facts: Facts, roster: Roster): Board[] {
  const byId = new Map(roster.players.map((player) => [player.id, player]));
  const onRoster = (id: string) => byId.has(id);
  const out: Board[] = [];
  const push = (made: Board | null) => {
    if (made) out.push(made);
  };
  const regionsOf = (wins: readonly Win[]) => [...new Set(wins.map((win) => win.region))].sort();
  const yearsOf = (wins: readonly Win[]) => [...new Set(wins.map((win) => win.year))].sort();

  // ----------------------------------------------------------------- FNCS --
  const fncs = fncsWins(facts, onRoster);
  for (const region of regionsOf(fncs)) {
    const here = fncs.filter((win) => win.region === region);
    const name = `${short(region)} FNCS`;

    // Most wins. A win the roster cannot fully name gives someone it cannot see
    // a win, so the board waits until the 11th has more than those could add up to.
    // Level ones go to the podiums in this region's finals first (22 Oct 2026):
    // NA East has twenty players on one win at 10th.
    const counts = new Map<string, number>();
    for (const win of here) for (const id of win.players) counts.set(id, (counts.get(id) ?? 0) + 1);
    const inRegion = (event: HeadlineEvent) => isRegionalFinal(event) && fncsRegion(event) === region;
    const ranked = byValue(
      [...counts].map(([key, value]) => ({
        key,
        label: byId.get(key)!.name,
        value,
        display: `${value} win${value === 1 ? '' : 's'}`,
        tiebreak: [facts.podiumsAt(key, inRegion), byId.get(key)!.earnings],
      })),
    );
    const hidden = here.filter((win) => !win.complete).length;
    if (ranked.length >= NEEDED && ranked[SLOTS].value > hidden) {
      const tie = tieText(`more podiums (top 3) in ${name} finals`);
      push(board(`fncs-most:${region}`, FNCS_WINNERS_GROUP, `Top 10 by ${name} wins`, 'player', tie, ranked));
    }

    const first = firstOrLast(here, false, byId);
    if (first) push(board(`fncs-first:${region}`, FNCS_WINNERS_GROUP, `First 10 players to win the FNCS — ${short(region)}`, 'player', TIE_FIRST, first, true));
    const last = firstOrLast(here, true, byId);
    if (last) push(board(`fncs-last:${region}`, FNCS_WINNERS_GROUP, `Last 10 players to win the FNCS — ${short(region)}`, 'player', TIE_LAST, last));
    const firstCountries = countriesFirstOrLast(here, false, byId);
    if (firstCountries) {
      push(board(`fncs-first-countries:${region}`, FNCS_WINNERS_GROUP, `First 10 countries to win the FNCS — ${short(region)}`, 'country', TIE_COUNTRY('Oldest first'), firstCountries, true));
    }
    const lastCountries = countriesFirstOrLast(here, true, byId);
    if (lastCountries) {
      push(board(`fncs-last-countries:${region}`, FNCS_WINNERS_GROUP, `Last 10 countries to win the FNCS — ${short(region)}`, 'country', TIE_COUNTRY('Newest first'), lastCountries));
    }

    // Exactly ten: by year, by chapter, by country.
    for (const year of yearsOf(here)) {
      push(exactTen(`fncs-all:${region}:${year}`, FNCS_WINNERS_GROUP, `All 10 players to win the ${name} in ${year}`, here.filter((win) => win.year === year), byId));
    }
    for (const scope of [...new Set(here.map((win) => win.scope))]) {
      push(exactTen(`fncs-all:${region}:${scope}`, FNCS_WINNERS_GROUP, `All 10 players to win the ${name} in ${scope}`, here.filter((win) => win.scope === scope), byId));
    }
    const countries = [...new Set(here.flatMap((win) => win.players.map((id) => byId.get(id)?.countryName ?? '')))].filter(Boolean);
    for (const country of countries) {
      // Every win with a player from the country, counting only them.
      const theirs = here
        .filter((win) => win.players.some((id) => byId.get(id)?.countryName === country))
        .map((win) => ({ ...win, players: win.players.filter((id) => byId.get(id)?.countryName === country) }));
      push(exactTen(`fncs-all:${region}:from:${country}`, FNCS_WINNERS_GROUP, `All 10 ${name} winners from ${country}`, theirs, byId));
    }
  }

  // ------------------------------------------------------------- Div Cups --
  const div = divCupWins(facts, onRoster);
  for (const region of regionsOf(div)) {
    const here = div.filter((win) => win.region === region);
    const name = `${short(region)} Div Cup`;
    const scopes: [string, string, Win[]][] = [
      ['', '', here],
      ...yearsOf(here).map((year): [string, string, Win[]] => [`:${year}`, ` in ${year}`, here.filter((win) => win.year === year)]),
    ];
    for (const [key, words, wins] of scopes) {
      const first = firstOrLast(wins, false, byId);
      if (first) push(board(`divcup-first:${region}${key}`, DIVCUP_WINNERS_GROUP, `First 10 players to win a Div Cup${words} — ${short(region)}`, 'player', TIE_FIRST, first, true));
      const last = firstOrLast(wins, true, byId);
      if (last) push(board(`divcup-last:${region}${key}`, DIVCUP_WINNERS_GROUP, `Last 10 players to win a Div Cup${words} — ${short(region)}`, 'player', TIE_LAST, last));
    }
    for (const year of yearsOf(here)) {
      push(exactTen(`divcup-all:${region}:${year}`, DIVCUP_WINNERS_GROUP, `All 10 players to win ${an(region)} ${name} in ${year}`, here.filter((win) => win.year === year), byId));
    }
    for (const season of [...new Set(here.map((win) => win.scope))]) {
      push(exactTen(`divcup-all:${region}:${season}`, DIVCUP_WINNERS_GROUP, `All 10 players to win ${an(region)} ${name} in ${season}`, here.filter((win) => win.scope === season), byId));
    }
  }
  return out;
}
