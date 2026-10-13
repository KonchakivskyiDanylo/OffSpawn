import type { Facts } from '@/data/liquipedia/facts';
import type { Orgs } from '@/data/liquipedia/orgs';
import type { Pool } from '@/data/liquipedia/pools';
import { Rankings, type Board } from "@/data/liquipedia/rankings";
import { board, byValue, NEEDED, SLOTS, TIE_EARNINGS, TIE_GROUP_EARNINGS, type Ranked } from './board-builder';
import type { RosterPlayer } from '@/data/liquipedia/roster';
import { money, ordinal, plural } from '@/lib/format';

/**
 * Tenaball boards for one tournament's field.
 *
 * The shipped boards in `rankings.json` are all-time and precomputed, for the
 * good reason given in `rankings.ts`: they are aggregated from 442,736
 * placement rows, which is not a thing to ask a phone to do. An event field is
 * the opposite problem — eighty to a hundred players, every number already on
 * the roster row or in `facts.json` — so these are derived here, on the spot.
 *
 * That matters beyond saving a notebook run: the mode is a lens, and a lens
 * that only worked on eight of the ten games would be a worse feature than no
 * lens at all. "Top 10 of the Globals field by earnings" is a better Tenaball
 * board than most of the two hundred shipped ones, because you can picture the
 * whole answer set before you start typing.
 *
 * The result is wrapped in a `Rankings`, so the game itself cannot tell the
 * difference between these and the shipped set.
 */

/**
 * Every board this field can fill, in the order they are offered.
 *
 * Deliberately boards that read as questions — "who earned the most", "who is
 * the youngest" — rather than everything the columns permit.
 *
 * One heading and a fixed order. These were filed under Players, Countries and
 * Organisations like the shipped boards, which scattered a field's dozen
 * boards across three headings in no particular order; a field is one subject.
 * The order is the one planned for an event's fortnight in LIMITED_MODE.md.
 * Three of its results boards — the final top ten, the upsets and the
 * disappointments — appear once the export has the event's placements; the
 * top ten of day one and eliminations still wait for data it does not carry.
 */
export function poolBoards(
  pool: Pool,
  players: RosterPlayer[],
  facts: Facts | null,
  orgs: Orgs | null,
): Board[] {
  const out: Board[] = [];
  const add = (made: Board | null) => {
    if (made) out.push(made);
  };
  const prefix = `pool:${pool.id}`;
  const group = pool.label;
  const year = Number(pool.date.slice(0, 4));

  const player = (p: RosterPlayer, value: number, display: string): Ranked => ({
    key: p.id,
    label: p.name,
    value,
    display,
    tiebreak: p.earnings,
  });
  /** A money board: the value is the earnings, so there is nothing under it. */
  const earner = (p: RosterPlayer): Ranked => ({
    key: p.id,
    label: p.name,
    value: p.earnings,
    display: money(p.earnings),
  });
  const earners = players.filter((p) => p.earningsKnown);

  /*
   * Youngest and oldest rank on the birth *date*, not the age in years.
   *
   * Age is a whole number, so a field of eighty players has four or five people
   * showing 19 and the alphabet decided which of them was 10th — a tiebreak the
   * board could state but nobody could reason about. The export publishes the
   * day, and two players sharing one is rare, so the real order is available
   * and the displayed age is just how it is rendered. A shared birthday is a
   * real tie and is left as one: no tiebreak, so `board` drops the board if
   * it lands on the cut.
   */
  const withAge = players.filter((p) => p.age !== null && p.birthDate);
  const born = (p: RosterPlayer): Ranked => ({
    key: p.id,
    label: p.name,
    value: Date.parse(p.birthDate as string),
    display: plural(p.age as number, 'year'),
  });
  const BIRTHDAY_NOTE =
    'Age today, from published birthdays. Players with no birthday on record cannot be ranked and are not answers.';

  // Keyed by the country's name, because that is what the guess box resolves
  // to for a country board — see `searchPool` in the game.
  const countries = new Map<string, { players: number; earnings: number }>();
  for (const p of players) {
    if (!p.countryName) continue;
    const entry = countries.get(p.countryName) ?? { players: 0, earnings: 0 };
    entry.players += 1;
    entry.earnings += p.earnings;
    countries.set(p.countryName, entry);
  }

  const regional = (region: string, who: string) =>
    board(
      `${prefix}:earnings:${region}`,
      group,
      `Top 10 ${who} by career earnings`,
      'player',
      `Qualifiers who compete in ${region}, by career prize money across every tournament on record. Straight prize-money order.`,
      byValue(earners.filter((p) => p.region === region).map(earner)),
    );

  // 1 ---------------------------------------------------------------------------
  add(
    board(
      `${prefix}:earnings`,
      group,
      'Top 10 by career earnings',
      'player',
      `Career prize money across every tournament on record, not just ${pool.label}. Straight prize-money order.`,
      byValue(earners.map(earner)),
    ),
  );

  // 2 ---------------------------------------------------------------------------
  add(
    board(
      `${prefix}:youngest`,
      group,
      'The 10 youngest',
      'player',
      `${BIRTHDAY_NOTE} Ranked on the date itself, so two players showing the same age are ordered by who was born later.`,
      byValue(withAge.map(born)),
    ),
  );

  // 3 ---------------------------------------------------------------------------
  // The other end of the money: who got here on the least. A better question
  // than it sounds, because the answers are the field's breakouts.
  add(
    board(
      `${prefix}:earnings-least`,
      group,
      'The 10 lowest career earners',
      'player',
      'Least career prize money across every tournament on record, lowest first. Straight prize-money order.',
      byValue(earners.map(earner), true),
      true,
    ),
  );

  // 4 ---------------------------------------------------------------------------
  add(
    board(
      `${prefix}:fncs`,
      group,
      'Top 10 by FNCS wins',
      'player',
      `Regional FNCS grand finals won, across every season and region. ${TIE_EARNINGS}`,
      byValue(
        players.filter((p) => p.fncsWins > 0).map((p) => player(p, p.fncsWins, plural(p.fncsWins, 'win'))),
      ),
    ),
  );

  // 5 ---------------------------------------------------------------------------
  add(regional('Europe', 'European players'));

  // 6 ---------------------------------------------------------------------------
  add(
    board(
      `${prefix}:countries`,
      group,
      'Top 10 countries by players',
      'country',
      `How many of the field each country sent, by each player’s first nationality. ${TIE_GROUP_EARNINGS}`,
      byValue(
        [...countries].map(([name, entry]) => ({
          key: name,
          label: name,
          value: entry.players,
          display: plural(entry.players, 'player'),
          tiebreak: entry.earnings,
        })),
      ),
    ),
  );

  // 7 ---------------------------------------------------------------------------
  add(
    board(
      `${prefix}:earnings-year`,
      group,
      `Top 10 by earnings in ${year}`,
      'player',
      `Prize money won during ${year}, at every tournament on record. Straight prize-money order.`,
      byValue(
        players
          .map((p) => ({
            key: p.id,
            label: p.name,
            value: p.earningsByYear[year] ?? 0,
            display: money(p.earningsByYear[year] ?? 0),
          }))
          .filter((row) => row.value > 0),
      ),
    ),
  );

  // 8 ---------------------------------------------------------------------------
  add(
    board(
      `${prefix}:oldest`,
      group,
      'The 10 oldest',
      'player',
      `${BIRTHDAY_NOTE} Ranked on the date itself, so two players showing the same age are ordered by who was born earlier.`,
      byValue(withAge.map(born), true),
      true,
    ),
  );

  // 9 ---------------------------------------------------------------------------
  if (orgs) {
    const inField = new Map(players.map((p) => [p.id, p]));
    const counted = orgs.orgs
      .map((org) => {
        const here = org.current.flatMap((id) => inField.get(id) ?? []);
        return {
          // Display name, not the page id: that is how the shipped org boards
          // are keyed and what the guess box resolves to. See `searchPool`.
          key: org.name,
          label: org.name,
          value: here.length,
          display: plural(here.length, 'player'),
          tiebreak: here.reduce((sum, p) => sum + p.earnings, 0),
        };
      })
      .filter((row) => row.value > 0);

    add(
      board(
        `${prefix}:orgs`,
        group,
        'Top 10 organisations by players',
        'org',
        `Counted from each player's current organisation, so a player with no org counts for nobody. ${TIE_GROUP_EARNINGS}`,
        byValue(counted),
      ),
    );
  }

  // 10 --------------------------------------------------------------------------
  add(regional('North America', 'North American players'));

  // 11 is subscribers, which the export does not have.

  // 12 --------------------------------------------------------------------------
  // Appearances at the kind of event this is: LANs for a LAN, FNCS grand finals
  // for an FNCS event, and both for a Globals.
  if (facts) {
    const event = facts.events.find((candidate) => candidate.name === pool.event);
    if (event?.lan ?? true) {
      add(
        board(
          `${prefix}:lans`,
          group,
          'Top 10 by major LAN appearances',
          'player',
          `Epic’s offline majors only — the World Cup, the Globals, the Summit and the other LANs. ${TIE_EARNINGS}`,
          byValue(
            players
              .map((p) => player(p, facts.of(p.id).lanApps, plural(facts.of(p.id).lanApps, 'LAN')))
              .filter((row) => row.value > 0),
          ),
        ),
      );
    }
    if (pool.event.includes('FNCS')) {
      add(
        board(
          `${prefix}:fncs-apps`,
          group,
          'Top 10 by FNCS grand finals played',
          'player',
          `Every regional grand final reached, plus the FNCS events played offline. ${TIE_EARNINGS}`,
          byValue(
            players
              .map((p) => player(p, facts.of(p.id).fncsApps, plural(facts.of(p.id).fncsApps, 'final')))
              .filter((row) => row.value > 0),
          ),
        ),
      );
    }
  }

  // 14, 17, 19 ------------------------------------------------------------------
  // The event's own results, once the export has them: the final standings,
  // then who beat the seed their money gave them and who fell furthest below it.
  for (const made of resultBoards(pool, players, prefix, group)) add(made);

  if (facts) {
    // The rest, after the planned boards.
    add(
      board(
        `${prefix}:apps`,
        group,
        'Top 10 by tournaments played',
        'player',
        `Every tournament on record, not just this field's. ${TIE_EARNINGS}`,
        byValue(
          players
            .map((p) => player(p, facts.of(p.id).apps, plural(facts.of(p.id).apps, 'tournament')))
            .filter((row) => row.value > 0),
        ),
      ),
    );
  }

  add(
    board(
      `${prefix}:countries-money`,
      group,
      'Top 10 countries by career earnings',
      'country',
      'The career earnings of this field, added up per country. Straight prize-money order.',
      byValue(
        [...countries].map(([name, entry]) => ({
          key: name,
          label: name,
          value: entry.earnings,
          display: money(entry.earnings),
        })),
      ),
    ),
  );

  return out;
}

/** One finishing place at the event, and the players who took it. */
interface Team {
  place: number;
  players: RosterPlayer[];
  /** False when the roster cannot name everyone on it: a slot nobody could close. */
  complete: boolean;
}

/** What one team is called in a board's rules, by how many players it has. */
const TEAM_WORDS: Record<number, [string, string]> = {
  1: ['player', 'players'],
  2: ['duo', 'duos'],
  3: ['trio', 'trios'],
  4: ['squad', 'squads'],
};

/**
 * The event's teams, best finish first.
 *
 * Whoever shares a place is one team, because the export gives a duo a single
 * placement. The team size is the event's — the most players any place has —
 * so a place with fewer holds someone the roster cannot name.
 */
function teamsAt(pool: Pool, players: RosterPlayer[]): Team[] {
  const byId = new Map(players.map((p) => [p.id, p]));
  const places = new Map<number, RosterPlayer[]>();
  for (const [id, place] of Object.entries(pool.placements ?? {})) {
    const player = byId.get(id);
    if (player) places.set(place, [...(places.get(place) ?? []), player]);
  }
  const size = Math.max(0, ...[...places.values()].map((team) => team.length));
  return [...places]
    .sort(([a], [b]) => a - b)
    .map(([place, members]) => ({
      place,
      players: members.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())),
      complete: members.length === size,
    }));
}

/** "Pixie & SwizzY", "Japko, panzer & Setty" — the way the shipped boards write a team. */
function teamName(team: Team): string {
  const names = team.players.map((p) => p.name);
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/**
 * The results boards, or none before the event has been played.
 *
 * Upsets and disappointments seed every team by what its players had won
 * before the event (`earningsBefore`), not by today's career figure, which
 * already holds the prize from this event and would make every winner look
 * like the favourite. A file written before cell 5 carried that column offers
 * the standings alone.
 */
function resultBoards(pool: Pool, players: RosterPlayer[], prefix: string, group: string): Board[] {
  const teams = teamsAt(pool, players);
  if (teams.length === 0) return [];
  const size = Math.max(...teams.map((team) => team.players.length));
  const [unit, units] = TEAM_WORDS[size] ?? ['team', 'teams'];
  const fill =
    size > 1 ? ` Each slot is a ${unit} and fills once ${size === 2 ? 'both players are' : `all ${size} are`} named.` : '';

  const out: Board[] = [];
  /** A team board, unless a team the roster cannot fully name would be one of its eleven. */
  const teamBoard = (
    id: string,
    title: string,
    tieRule: string,
    ranked: (Ranked & { complete: boolean })[],
    lowerIsBetter?: boolean,
  ) => {
    if (ranked.slice(0, NEEDED).some((row) => !row.complete)) return;
    const made = board(
      id,
      group,
      title,
      'player',
      tieRule,
      ranked.map(({ complete: _, ...row }) => row),
      lowerIsBetter,
    );
    if (made) out.push(made);
  };
  const row = (team: Team, value: number, display: string, tiebreak?: number) => ({
    key: team.players.map((p) => p.id).join('|'),
    label: teamName(team),
    value,
    display,
    tiebreak,
    members: size > 1 ? team.players.map((p) => ({ key: p.id, label: p.name })) : undefined,
    complete: team.complete,
  });

  // 14 --------------------------------------------------------------------------
  teamBoard(
    `${prefix}:results`,
    `Top 10 at ${pool.label}`,
    `Final standings.${fill}`,
    teams.map((team) => row(team, team.place, String(team.place))),
    true,
  );

  const before = pool.earningsBefore;
  if (!before) return out;
  const funds = new Map(teams.map((team) => [team, team.players.reduce((sum, p) => sum + (before[p.id] ?? 0), 0)]));
  // 1st is the richest; two teams on the same money share a seed.
  const seedOf = new Map(
    teams.map((team) => [team, 1 + teams.filter((other) => funds.get(other)! > funds.get(team)!).length]),
  );
  const seeding = `A ${unit}’s seed is its rank by combined career earnings before the event, the richest 1st.`;

  // 17 --------------------------------------------------------------------------
  teamBoard(
    `${prefix}:upsets`,
    'Top 10 biggest upsets',
    `${seeding} Ranked by places gained from seed to finish; level ${units} go to the better finish.${fill}`,
    byValue(
      teams
        .map((team) => {
          const seed = seedOf.get(team)!;
          const gained = seed - team.place;
          return row(team, gained, `+${gained} (${ordinal(seed)} → ${ordinal(team.place)})`, -team.place);
        })
        .filter((ranked) => ranked.value > 0),
    ),
  );

  // 19 --------------------------------------------------------------------------
  teamBoard(
    `${prefix}:disappointments`,
    'Top 10 biggest disappointments',
    `${seeding} Ranked by places lost from seed to finish; level ${units} go to the higher seed.${fill}`,
    byValue(
      teams
        .map((team) => {
          const seed = seedOf.get(team)!;
          const lost = team.place - seed;
          return row(team, lost, `−${lost} (${ordinal(seed)} → ${ordinal(team.place)})`, -seed);
        })
        .filter((ranked) => ranked.value > 0),
    ),
  );
  return out;
}

/**
 * The pool's boards in the shape the game already reads.
 *
 * Returning a `Rankings` rather than an array is what keeps this change to one
 * file: the picker, the search box and the Random button all go through that
 * class, and none of them has to learn that a board can now be derived.
 */
export function poolRankings(
  pool: Pool,
  players: RosterPlayer[],
  facts: Facts | null,
  orgs: Orgs | null,
  generated: string,
): Rankings {
  return new Rankings({
    generated,
    slots: SLOTS,
    boards: poolBoards(pool, players, facts, orgs),
  });
}
