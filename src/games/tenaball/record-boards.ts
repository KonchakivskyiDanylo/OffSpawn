import type { Facts } from '@/data/liquipedia/facts';
import type { Board } from '@/data/liquipedia/rankings';
import type { Roster, RosterPlayer } from '@/data/liquipedia/roster';
import { money, monthYear } from '@/lib/format';
import { board, byValue, NEEDED, SLOTS, tieText, type Ranked } from './board-builder';
import { dayNumber, FNCS_WINNERS_GROUP, fncsRegion, fncsWins, TIE_FIRST, TIE_LAST } from './winner-boards';

/**
 * Records and milestones, the user's picks of 14 Oct 2026: the first ten to
 * $1M and to five FNCS wins, the youngest and oldest FNCS winners, the last
 * ten to win on their very first final and the longest road to a first win,
 * the longest wait between two wins, the most finals in a row, the pairs with
 * the most major titles, the countries with the most different winners, and
 * the top earners born in each year. Added 15 Oct 2026: the most major titles
 * in a row, beside the FNCS's own count in `rankings.json`; each FNCS region's
 * youngest and oldest winners; and the fewest finals before a first win again
 * for first wins from 2021 and from 2022.
 *
 * Asked for and not built, because the data does not make a fair ten: the
 * first ten to win in two FNCS regions (nine players have), the fewest finals
 * before a first win (43 won their very first), the most Globals in a row (24
 * have played all four), every LAN champion as a board of exactly ten (there
 * are fifteen) and anyone's ten FNCS-winning partners (nobody has exactly ten).
 */

export const BIRTH_YEAR_GROUP = 'By birth year';

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/** "14y 9m": an age or a wait, to the month. */
function yearsMonths(days: number): string {
  const months = Math.floor(days / 30.4375);
  return `${Math.floor(months / 12)}y ${months % 12}m`;
}

export function recordBoards(facts: Facts, roster: Roster): Board[] {
  const byId = new Map(roster.players.map((player) => [player.id, player]));
  const onRoster = (id: string) => byId.has(id);
  const player = (id: string) => byId.get(id)!;
  const row = (id: string, value: number, display: string): Ranked => ({
    key: id,
    label: player(id).name,
    value,
    display,
    tiebreak: player(id).earnings,
  });
  const out: Board[] = [];
  const push = (made: Board | null) => {
    if (made) out.push(made);
  };

  // Each winner's FNCS wins, oldest first.
  const winsBy = new Map<string, string[]>();
  for (const win of fncsWins(facts, onRoster)) {
    for (const id of win.players) winsBy.set(id, [...(winsBy.get(id) ?? []), win.date]);
  }
  const regionalBefore = (id: string, date: string) =>
    facts.of(id).played.filter((index) => {
      const event = facts.events[index];
      return event && event.kind === 'fncs' && !event.lan && event.date < date;
    }).length;

  // ---------------------------------------------------------------- firsts --
  // $1M, from the results' running total (`million`, written by derived.py). A
  // winner with no page among the first eleven would hide a place: no board.
  const firstUnnamed = facts.million.findIndex((entry) => !onRoster(entry.id));
  if (facts.million.length >= NEEDED && (firstUnnamed < 0 || firstUnnamed >= NEEDED)) {
    push(
      board(
        'first-million',
        'Players',
        'First 10 players to $1M in career earnings',
        'player',
        'The day their tournament results first added up to $1M, oldest first. Players who got there on the same day are ranked by career earnings, the bigger earner higher.',
        byValue(facts.million.filter((entry) => onRoster(entry.id)).map((entry) => row(entry.id, dayNumber(entry.date), monthYear(entry.date))), true),
        true,
      ),
    );
  }
  const fifth = [...winsBy].filter(([, dates]) => dates.length >= 5).map(([id, dates]) => row(id, dayNumber(dates[4]), monthYear(dates[4])));
  push(board('fncs-first-to:5', FNCS_WINNERS_GROUP, 'First 10 players to 5 FNCS wins', 'player', `The day of their fifth win. ${TIE_FIRST}`, byValue(fifth, true), true));
  // Won on their very first final — the last ten, because the first ten are
  // only Season X's winners: the first FNCS was everybody's first final.
  const debut = [...winsBy]
    .filter(([id, dates]) => regionalBefore(id, dates[0]) === 0)
    .map(([id, dates]) => row(id, dayNumber(dates[0]), monthYear(dates[0])));
  push(board('fncs-debut', FNCS_WINNERS_GROUP, 'Last 10 players to win the FNCS in their first grand final', 'player', TIE_LAST, byValue(debut)));

  // ------------------------------------------------------------------- ages --
  const ages = [...winsBy].flatMap(([id, dates]) => {
    const born = player(id).birthDate;
    return born ? [{ id, young: daysBetween(born, dates[0]), old: daysBetween(born, dates[dates.length - 1]) }] : [];
  });
  const ageRule = 'from the published birthday; winners without one are left out.';
  push(board('fncs-youngest', FNCS_WINNERS_GROUP, 'Top 10 youngest FNCS winners', 'player', `Age on the day of their first FNCS win, youngest first, ${ageRule}`, byValue(ages.map((a) => row(a.id, a.young, yearsMonths(a.young))), true), true));
  push(board('fncs-oldest', FNCS_WINNERS_GROUP, 'Top 10 oldest FNCS winners', 'player', `Age on the day of their latest FNCS win, oldest first, ${ageRule}`, byValue(ages.map((a) => row(a.id, a.old, yearsMonths(a.old))))));

  // ---------------------------------------------------------- longest roads --
  const road = [...winsBy].map(([id, dates]) => {
    const finals = regionalBefore(id, dates[0]);
    // Level roads go to whoever won more once the wait was over.
    return { ...row(id, finals, `${finals} final${finals === 1 ? '' : 's'}`), tiebreak: [dates.length, player(id).earnings] };
  });
  push(board('fncs-long-road', FNCS_WINNERS_GROUP, 'Top 10 most FNCS grand finals before a first win', 'player', `Grand finals played before their first FNCS win. ${tieText('more FNCS titles in all')}`, byValue(road)));
  const waits = [...winsBy]
    .filter(([, dates]) => dates.length >= 2)
    .map(([id, dates]) => {
      let longest = 0;
      for (let i = 1; i < dates.length; i++) longest = Math.max(longest, daysBetween(dates[i - 1], dates[i]));
      return row(id, longest, yearsMonths(longest));
    });
  push(board('fncs-comebacks', FNCS_WINNERS_GROUP, 'Top 10 longest waits between two FNCS wins', 'player', 'The longest time between one FNCS win and the next. Level waits are split by career earnings, the bigger earner higher.', byValue(waits)));

  // ---------------------------------------------- per region: debut and rate --
  // Each player's regional finals already played, by FNCS region, oldest first,
  // and which of them they won (the user, 14 Oct 2026: the debut board "for
  // region… Minimum grand finals to win", and "wins/grand finals played").
  const finalsIn = new Map<string, Map<string, { date: string; won: boolean }[]>>();
  const allFinals = new Map<string, { date: string; won: boolean }[]>();
  for (const p of roster.players) {
    const won = new Set(facts.of(p.id).won);
    for (const index of facts.of(p.id).played) {
      const event = facts.events[index];
      if (!event || event.kind !== 'fncs' || event.lan || event.date > facts.generated) continue;
      const region = fncsRegion(event);
      if (!region) continue;
      const entry = { date: event.date, won: won.has(index) };
      let regions = finalsIn.get(region);
      if (!regions) finalsIn.set(region, (regions = new Map()));
      regions.set(p.id, [...(regions.get(p.id) ?? []), entry]);
      allFinals.set(p.id, [...(allFinals.get(p.id) ?? []), entry]);
    }
  }
  /**
   * Win rate, FNCS wins ÷ grand finals played. The world board counts players
   * with `RATE_MIN` finals or more, so a one-from-one is not the best there
   * is; a region's counts everyone (the user, 14 Oct 2026: "for the world
   * let's have 5, for region without it"). Level rates go to more wins, then
   * to career earnings.
   */
  const RATE_MIN = 5;
  const rateRows = (byPlayer: ReadonlyMap<string, { won: boolean }[]>, least: number) =>
    [...byPlayer].flatMap(([id, finals]) => {
      const wins = finals.filter((f) => f.won).length;
      if (finals.length < least || wins === 0) return [];
      return [{ key: id, label: player(id).name, value: wins / finals.length, display: `${Math.round((100 * wins) / finals.length)}% · ${wins} of ${finals.length}`, tiebreak: wins * 1e9 + player(id).earnings }];
    });
  const levelRates = 'Level rates go to more wins, then to career earnings.';
  push(
    board(
      'fncs-win-rate',
      FNCS_WINNERS_GROUP,
      `Top 10 by FNCS win rate (min. ${RATE_MIN} finals)`,
      'player',
      `FNCS wins ÷ grand finals played, in any region, for players with ${RATE_MIN} finals or more. ${levelRates}`,
      byValue(rateRows(allFinals, RATE_MIN)),
    ),
  );
  for (const [region, byPlayer] of [...finalsIn].sort((a, b) => a[0].localeCompare(b[0]))) {
    const where = region === 'Europe' ? 'EU' : region;
    push(
      board(
        `fncs-win-rate:${region}`,
        FNCS_WINNERS_GROUP,
        `Top 10 by FNCS win rate — ${where}`,
        'player',
        `${where} FNCS wins ÷ ${where} grand finals played, however few. ${levelRates}`,
        byValue(rateRows(byPlayer, 1)),
      ),
    );
    // Fewest finals before a first win in the region: 0 is winning on debut there.
    // Level counts go to whoever won first — the earlier day, then the bigger earner.
    // Again for first wins from 2021 and from 2022, every final before the win
    // still counted, 2020's included: the whole-history board is the first
    // seasons' debut winners (the user, 15 Oct 2026: "count from 1st january
    // 2021, and 3rd from 2022… we still count the fncs they qualed").
    // A region whose finals began later — NA Central, from 2023 — gives the
    // same ten every time, and the same board twice is not a second board.
    let previous = '';
    for (const from of [null, 2021, 2022]) {
      const fewest = [...byPlayer].flatMap(([id, finals]) => {
        const sorted = [...finals].sort((a, b) => (a.date < b.date ? -1 : 1));
        const at = sorted.findIndex((f) => f.won);
        if (at < 0 || (from && sorted[at].date < `${from}-01-01`)) return [];
        return [{ key: id, label: player(id).name, value: at, display: at === 0 ? 'won on debut' : `${at} before`, tiebreak: -dayNumber(sorted[at].date) * 1e9 + player(id).earnings }];
      });
      const ranked = byValue(fewest, true);
      const same = ranked.slice(0, NEEDED).map((entry) => entry.key).join('|');
      if (same === previous) continue;
      previous = same;
      push(
        board(
          from ? `fncs-fewest-finals:${region}:${from}` : `fncs-fewest-finals:${region}`,
          FNCS_WINNERS_GROUP,
          from ? `Fewest FNCS finals before a first win — ${where}, first wins since ${from}` : `Fewest FNCS finals before a first win — ${where}`,
          'player',
          from
            ? `${where} grand finals played before the first ${where} win, for players whose first ${where} win came in ${from} or later; their finals before ${from} count too. 0 is winning on debut. Level counts go to whoever won first.`
            : `${where} grand finals played before the first ${where} win; 0 is winning on debut. Level counts go to whoever won first.`,
          ranked,
          true,
        ),
      );
    }

    // The youngest and oldest to win the region's FNCS (the user, 15 Oct 2026:
    // "youngest fncs winners on eu"): age at the first and the latest win there.
    const regionAges = [...byPlayer].flatMap(([id, finals]) => {
      const born = player(id).birthDate;
      const won = finals.filter((f) => f.won).map((f) => f.date).sort();
      return born && won.length ? [{ id, young: daysBetween(born, won[0]), old: daysBetween(born, won[won.length - 1]) }] : [];
    });
    push(board(`fncs-youngest:${region}`, FNCS_WINNERS_GROUP, `Top 10 youngest FNCS winners — ${where}`, 'player', `Age on the day of their first ${where} FNCS win, youngest first, ${ageRule}`, byValue(regionAges.map((a) => row(a.id, a.young, yearsMonths(a.young))), true), true));
    push(board(`fncs-oldest:${region}`, FNCS_WINNERS_GROUP, `Top 10 oldest FNCS winners — ${where}`, 'player', `Age on the day of their latest ${where} FNCS win, oldest first, ${ageRule}`, byValue(regionAges.map((a) => row(a.id, a.old, yearsMonths(a.old))))));
  }

  // ------------------------------------------------------------- in a row --
  // A round is every region's final in one week; one already played, not one
  // whose field is listed ahead of it.
  const rounds = facts.fncsRounds.filter((round) => round[0].date <= facts.generated);
  const streaks = roster.players.flatMap((p) => {
    const played = new Set(facts.of(p.id).played);
    let run = 0;
    let best = 0;
    for (const round of rounds) {
      run = round.some((event) => played.has(event.index)) ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best >= 2 ? [{ ...row(p.id, best, `${best} in a row`), tiebreak: [facts.podiumsAt(p.id), p.earnings] }] : [];
  });
  push(board('fncs-in-a-row', FNCS_WINNERS_GROUP, 'Top 10 most FNCS grand finals in a row', 'player', `Rounds of grand finals in a row, in any region. ${tieText('more FNCS podiums')}`, byValue(streaks)));

  // Major titles in a row, beside "Top 10 by consecutive FNCS titles" from the
  // notebook: the Globals and the LANs are majors and not FNCS rounds, so
  // losing one between two FNCS wins ends this run and not that one (the user,
  // 15 Oct 2026). A winner with no page as long a run as the 11th's would hide
  // a place: no board.
  const majorRuns = [...facts.majorWinRuns].filter(([, run]) => run >= 2);
  const majorRanked = byValue(
    majorRuns
      .filter(([id]) => onRoster(id))
      .map(([id, run]) => ({
        ...row(id, run, `${run} titles in a row`),
        tiebreak: [facts.of(id).wins.major, facts.podiumsAt(id, () => true), player(id).earnings],
      })),
  );
  if (majorRanked.length >= NEEDED && !majorRuns.some(([id, run]) => !onRoster(id) && run >= majorRanked[SLOTS].value)) {
    push(
      board(
        'majors-in-a-row',
        'Players',
        'Top 10 by consecutive major titles',
        'player',
        `Majors won one after another. Every round of the FNCS is one major, and so is each Globals and major LAN, so losing the Globals between two FNCS wins ends the run; a LAN they were not at is passed over. ${tieText('more major titles in all', 'more podiums at majors')}`,
        majorRanked,
      ),
    );
  }

  // ------------------------------------------------------------------ pairs --
  // Major titles: every FNCS final, Global Championship and major LAN won. A
  // trio is three pairs, so one player can be on several rows — Peterbot with
  // Pollo and Peterbot with someone else (the user's question, 14 Oct 2026).
  const pairs = new Map<string, number>();
  for (const event of facts.events) {
    const team = [...facts.wonAt(event.index)].filter(onRoster).sort();
    for (let i = 0; i < team.length; i++) {
      for (let j = i + 1; j < team.length; j++) {
        const key = `${team[i]}|${team[j]}`;
        pairs.set(key, (pairs.get(key) ?? 0) + 1);
      }
    }
  }
  const pairRows: Ranked[] = [...pairs].map(([key, titles]) => {
    const [a, b] = key.split('|');
    return {
      key,
      label: `${player(a).name} & ${player(b).name}`,
      value: titles,
      display: `${titles} title${titles === 1 ? '' : 's'}`,
      tiebreak: player(a).earnings + player(b).earnings,
      members: [
        { key: a, label: player(a).name },
        { key: b, label: player(b).name },
      ],
    };
  });
  push(
    board(
      'pairs-major-titles',
      FNCS_WINNERS_GROUP,
      'Top 10 pairs by major titles together',
      'player',
      'FNCS finals, Global Championships and major LANs won on one team; a trio is three pairs, so a player can be in more than one. Level pairs are split by their combined career earnings.',
      byValue(pairRows),
    ),
  );

  // -------------------------------------------------------------- countries --
  const winnersFrom = new Map<string, string[]>();
  for (const id of winsBy.keys()) {
    const country = player(id).countryName;
    if (country) winnersFrom.set(country, [...(winnersFrom.get(country) ?? []), id]);
  }
  const countryRows: Ranked[] = [...winnersFrom].map(([country, ids]) => ({
    key: country,
    label: country,
    value: ids.length,
    display: `${ids.length} winner${ids.length === 1 ? '' : 's'}`,
    tiebreak: [
      ids.reduce((sum, id) => sum + (winsBy.get(id)?.length ?? 0), 0),
      ids.reduce((sum, id) => sum + player(id).earnings, 0),
    ],
  }));
  push(
    board(
      'countries-fncs-winners',
      'Countries',
      'Top 10 countries by different FNCS winners',
      'country',
      'Countries level on winners are ranked by the FNCS titles those players won between them, then by their combined career earnings.',
      byValue(countryRows),
    ),
  );

  // ------------------------------------------------------------ birth years --
  const born = new Map<number, RosterPlayer[]>();
  for (const p of roster.players) {
    if (!p.birthDate || !p.earningsKnown || p.earnings <= 0) continue;
    const year = Number(p.birthDate.slice(0, 4));
    born.set(year, [...(born.get(year) ?? []), p]);
  }
  for (const [year, players] of [...born].sort((a, b) => a[0] - b[0])) {
    const ranked = players.map((p) => ({ key: p.id, label: p.name, value: p.earnings, display: money(p.earnings) }));
    push(board(`born:${year}`, BIRTH_YEAR_GROUP, `Top 10 earners born in ${year}`, 'player', 'Straight prize-money order.', byValue(ranked)));
  }
  return out;
}
