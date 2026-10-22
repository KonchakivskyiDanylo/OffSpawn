/**
 * Playability check for all ten games.
 *
 * Run with: npm run check:games
 *
 * Each game is driven through a full round by a perfect-oracle "player" using
 * only its public engine API. Generated games (Tic Tac Toe, Connections,
 * Griefer) are generated many times over to catch a board that is
 * rare-but-impossible rather than one that happens to work.
 *
 * Everything now reads the Liquipedia export. Three of its files are written by
 * `scripts/build_data.py` and may legitimately not exist yet — the
 * sections that need them are skipped with a note rather than failing, so this
 * is still useful on a fresh clone.
 */
import { loadRoster, EXPORT_DATE, Roster, type LiquipediaRow, type RosterPlayer } from '@/data/liquipedia/roster';
import { loadJson } from '@/data/liquipedia/files';
import { loadMajors } from '@/data/liquipedia/majors';
import { loadTeammates } from '@/data/liquipedia/teammates';
import { isRegionalFinal, loadFacts } from '@/data/liquipedia/facts';
import { loadOrgs } from '@/data/liquipedia/orgs';
import { loadPools } from '@/data/liquipedia/pools';
import { loadRankings, membersOf, type Board } from '@/data/liquipedia/rankings';
import { deal, dealInTurn, dealWeighted } from '@/games/shared/rotation';
import { TERMS, termsIn, type TermId } from '@/games/shared/glossary';
import { dealSecret, DEFAULT_POOL, RANDOM_MIX, resolvePool, type PoolChoice } from '@/games/shared/pool';
import { pickFresh, type PuzzleStatus } from '@/games/shared/progress';
import { GAMES, getGame, VISIBLE_GAMES } from '@/games/registry';
import { MOVED_SLUGS } from '@/games/moved';
import {
  buildCriteria,
  hasNestedPair,
  isNested,
  NEAR_NESTED,
  type CriteriaSource,
  type PlayerCriterion,
} from '@/games/shared/criteria';
import { makeRng, shuffle } from '@/lib/rng';
import { aggregate, playerIndex, playerLens } from '@/analytics/aggregate';
import {
  GAME_IDS,
  MAX_RECORD_BYTES,
  RECORD_VERSION,
  type GameId,
  type RoundRecord,
  type Stored,
} from '@/analytics/types';
import { ordinal } from '@/lib/format';
import { matchPlayer, suggestPlayers } from '@/lib/text';

import * as hl from '@/games/higher-lower/engine';
import * as wordle from '@/games/wordle/engine';
import * as career from '@/games/career-path/engine';
import * as whoAreYa from '@/games/who-are-ya/engine';
import * as tenaball from '@/games/tenaball/engine';
import { buildCriteria as buildListCriteria, buildPoolCriteria } from '@/games/list/criteria';
import { FIELD_POOLS, poolBoards } from '@/games/tenaball/pool-boards';
import { derivedBoards } from '@/games/tenaball/derived-boards';
import { globalsBoards, globalsEvents } from '@/games/tenaball/globals-boards';
import { socialBoards } from '@/games/tenaball/social-boards';
import { recordBoards } from '@/games/tenaball/record-boards';
import { fncsRegion, winnerBoards } from '@/games/tenaball/winner-boards';
import * as griefer from '@/games/impostor/engine';
import * as ttt from '@/games/tic-tac-toe/engine';
import * as connections from '@/games/connections/engine';
import * as gtp from '@/games/guess-the-player/engine';
import * as pyramid from '@/games/pyramid/engine';
import * as bingo from '@/games/bingo/engine';
import * as curveball from '@/games/curveball/engine';
import * as orgChart from '@/games/org-chart/engine';
import * as contextinho from '@/games/contextinho/engine';
import * as irl from '@/games/irl/engine';
import * as transferWindow from '@/games/transfer-window/engine';
import * as whichLobby from '@/games/which-lobby/engine';
import * as rewind from '@/games/rewind/engine';
import { loadBios } from '@/data/liquipedia/bios';
import { loadSocials } from '@/data/socials';
import {
  giveUp as clueGiveUp,
  guess as clueGuess,
  skip as clueSkip,
  type ClueRound,
  type Named,
} from '@/games/shared/clue-round';
import { LEVEL_IDS, levelPlayers, type Level } from '@/games/shared/levels';
import * as daily from '@/daily/day';
import * as dailyProgress from '@/daily/progress';
import { clueGrid, clueResult, snapClues } from '@/daily/clue-round';
import { knownPlayers } from '@/daily/fame';
import { freezeDay, generateDaily, missingFrom, playersIn } from '@/daily/generate';
import { DAILY_FROM, DAILY_GAMES, gamesOn, puzzleId, type DailySet } from '@/daily/types';
import * as hlDaily from '@/games/higher-lower/daily';
import * as cxDaily from '@/games/contextinho/daily';
import { SECRET_GAMES } from '@/daily/generate';
import * as wordleDaily from '@/games/wordle/daily';
import * as careerDaily from '@/games/career-path/daily';
import * as whoDaily from '@/games/who-are-ya/daily';
import * as tenaballDaily from '@/games/tenaball/daily';
import * as listDaily from '@/games/list/daily';
import * as reuse from '@/daily/reuse';
import * as tttDaily from '@/games/tic-tac-toe/daily';
import { lobbiesOf, parseLobby, roundLabel } from '@/games/shared/lobbies';

const problems: string[] = [];
const notes: string[] = [];
const skipped: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) problems.push(message);
}

/** Resolves to null when the notebook has not written the file yet. */
async function optional<T>(load: () => Promise<T>, what: string): Promise<T | null> {
  try {
    return await load();
  } catch {
    skipped.push(what);
    return null;
  }
}

// ------------------------------------------------------------ 0. the registry
// Games look themselves up with `getGame('<id>')` while the router looks them
// up by slug, and a rename moves the slug away from the id. If either lookup
// misses, `meta` is undefined and the game crashes on its first render.
for (const game of GAMES) {
  check(getGame(game.slug) === game, `registry: getGame('${game.slug}') did not find ${game.title}`);
  check(getGame(game.id) === game, `registry: getGame('${game.id}') did not find ${game.title}`);
  // A renamed game's old address (its id) redirects to the new one, and no current address ever does.
  if (game.id !== game.slug) {
    check(MOVED_SLUGS[game.id] === game.slug, `registry: /game/${game.id} does not redirect to /game/${game.slug}`);
  }
  check(!(game.slug in MOVED_SLUGS), `registry: /game/${game.slug} is current but listed as moved`);
}
check(
  Object.entries(MOVED_SLUGS).every(([from, to]) => getGame(from)?.slug === to),
  'registry: a moved address points somewhere that is not that game',
);
// Every game records its rounds under an id the analytics know, and every id has a game.
check(
  GAMES.length === GAME_IDS.length && GAME_IDS.every((id) => GAMES.some((game) => game.id === id)),
  `registry: ${GAMES.length} games but ${GAME_IDS.length} analytics ids`,
);
// Hidden games leave the lists, not the registry: they are still played below.
check(
  VISIBLE_GAMES.length > 0 && VISIBLE_GAMES.every((game) => !game.hidden),
  'registry: a hidden game is still listed',
);
notes.push(
  `registry: ${VISIBLE_GAMES.length} games listed, hidden: ${GAMES.filter((g) => g.hidden).map((g) => g.title).join(', ') || 'none'}`,
);

const roster = await loadRoster();
notes.push(`roster: ${roster.players.length} playable players (export ${EXPORT_DATE})`);

// roster.json is players.json with the unused columns and empty values left
// out. It must give the games exactly the same players, field for field.
{
  const slim = await optional(() => loadJson('roster'), 'roster: roster.json (run scripts/build_data.py)');
  if (slim) {
    const today = new Date();
    const full = new Roster((await loadJson('players')) as LiquipediaRow[], today).players;
    const lean = new Roster(slim as LiquipediaRow[], today).players;
    check(full.length === lean.length, `roster: roster.json has ${lean.length} players, players.json ${full.length}`);
    const differ = full.filter((player, i) => JSON.stringify(player) !== JSON.stringify(lean[i]));
    check(differ.length === 0, `roster: roster.json reads differently for ${differ.slice(0, 3).map((p) => p.name).join(', ')}`);
    if (differ.length === 0) notes.push(`roster: roster.json gives the same ${lean.length} players as players.json`);
  }
}
for (const tier of ['easy', 'medium', 'hard'] as const) {
  notes.push(`  ${tier}: ${roster.playersFor(tier).length}`);
}

const facts = await optional(loadFacts, 'facts.json');
const orgs = await optional(loadOrgs, 'orgs.json');
const rankings = await optional(loadRankings, 'rankings.json');
const pools = await loadPools(); // never rejects
const majors = await optional(loadMajors, 'career_path.json');
const teammates = await optional(loadTeammates, 'teammates.json');
// The developer's own socials.json when there is one (never in git, so never in CI).
const socials = await loadSocials();

// ------------------------------------------------------------- 1. name search
// The one piece of shared logic every typing game depends on.
{
  const aqua = roster.players.filter((p) => p.name.toLowerCase() === 'aqua');
  notes.push(`search: ${aqua.length} players answer to "Aqua"`);
  for (const [input, expected] of [
    ['peterbo', 'Peterbot'],
    ['clix', 'Clix'],
  ] as const) {
    const found = matchPlayer(input, roster.players);
    check(found !== null, `search: "${input}" resolved to nothing (expected ${expected})`);
  }
  // An alias must find its player — this is the shxrk/Shark case.
  const withAlias = roster.players.find((p) => p.aliases.length > 0);
  if (withAlias) {
    const viaAlias = matchPlayer(withAlias.aliases[0], roster.players);
    check(
      viaAlias !== null,
      `search: alias "${withAlias.aliases[0]}" did not resolve (expected ${withAlias.name})`,
    );
  }
  check(suggestPlayers('cl', roster.players, 5).length > 0, 'search: two letters suggested nothing');
}

// --------------------------------------------------------- 2. Higher or Lower
// Played perfectly for forty rounds, five runs per level, checking the pairing
// keeps the promises the schedule makes: it opens on famous names, never
// leaves the level's cap, never deals a free tie, and once the schedule has
// reached "close" it never serves an obvious pair — the 1-versus-5 on round
// thirty that started all this. And that the answers cannot be read off the
// board: not by flipping the last one, not by the nought on the left.
// FNCS Finals reads `facts.json`, attached to the roster the way the page does it.
const contenders: hl.Contender[] = facts
  ? roster.players.map((p) => ({ ...p, fncsFinals: facts.of(p.id).fncsApps }))
  : roster.players;
const hlCategories: hl.Category[] = facts ? ['age', 'earnings', 'fncsWins', 'fncsFinals'] : ['age', 'earnings', 'fncsWins'];
/**
 * The run checks for one category over one set of players. `tag` names it in
 * the output — the category, or Placement and the event it is about.
 */
function checkHigherLower(contenders: readonly hl.Contender[], category: hl.Category, tag: string = category) {
  // The engine's own fame order: earnings, or the count itself on a follower category.
  const fame = (player: hl.Contender) => (hl.SOCIAL_CATEGORIES.includes(category) ? hl.valueOf(player, category) : player.earnings);
  const ranked = [...hl.eligible(contenders, category)].sort((a, b) => fame(b) - fame(a));
  const rank = new Map(ranked.map((player, index) => [player.id, index + 1]));
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    let rounds = 0;
    let onSchedule = 0;
    let ties = 0;
    let deepest = 0;
    // Consecutive answers that flipped direction, and shown noughts that went
    // up — the two ways Hard's FNCS Wins could be read without knowing anyone.
    let turns = 0;
    let flips = 0;
    let fromNought = 0;
    let noughtUp = 0;
    for (let run = 0; run < 5; run++) {
      let state = hl.createGame(contenders, category, difficulty, `hl-${tag}-${difficulty}-${run}`);
      check(state !== null, `higher-lower: could not start ${tag}/${difficulty}`);
      if (!state) continue;
      check(
        (rank.get(state.current.id) ?? Infinity) <= 20 && (rank.get(state.challenger.id) ?? Infinity) <= 20,
        `higher-lower ${tag}/${difficulty}: round one was not top 20 against top 20`,
      );

      let previous: hl.Answer | null = null;
      while (state.status === 'playing' && hl.roundOf(state) <= 40) {
        const round = hl.roundOf(state);
        const scheduled = hl.closenessFor(difficulty, round);
        const where = `${tag}/${difficulty} run ${run} round ${round}`;
        rounds++;
        if (hl.fitsBand(state.current, state.challenger, category, scheduled)) onSchedule++;
        deepest = Math.max(deepest, rank.get(state.challenger.id) ?? Infinity);

        check(
          (rank.get(state.challenger.id) ?? Infinity) <= hl.WINDOW[difficulty].cap,
          `higher-lower ${where}: ${state.challenger.name} is outside the level's cap`,
        );
        const truth = hl.correctAnswer(state);
        if (truth === 'equal') ties++;
        check(
          truth !== 'equal' || hl.hasEqualButton(category),
          `higher-lower ${where}: dealt a tie with no Equal button`,
        );
        if (previous && previous !== 'equal' && truth !== 'equal') {
          turns++;
          if (previous !== truth) flips++;
        }
        previous = truth;
        if (category === 'fncsWins' && state.current.fncsWins === 0) {
          fromNought++;
          if (truth === 'higher') noughtUp++;
        }
        if (category !== 'fncsWins' && (scheduled === 'close' || scheduled === 'very-close')) {
          check(
            !hl.fitsBand(state.current, state.challenger, category, 'obvious'),
            `higher-lower ${where}: served an obvious pair`,
          );
        }

        state = hl.submitAnswer(state, truth);
        check(state.status !== 'gameover', `higher-lower ${where}: perfect play lost`);
        if (state.status === 'gameover') break;
        state = hl.nextRound(state);
      }
    }
    const share = onSchedule / Math.max(rounds, 1);
    const flipped = flips / Math.max(turns, 1);
    notes.push(
      `higher-lower ${tag}/${difficulty}: ${rounds} rounds, ${Math.round(share * 100)}% in the ` +
        `scheduled band, deepest challenger #${deepest}, ${ties} ties, ` +
        `${Math.round(flipped * 100)}% of answers flipped direction`,
    );
    // An answer that just went up used to be followed by one going down: 93%
    // of Hard's FNCS answers flipped, so "the opposite of last time" won the
    // game. A fair coin flips half the time; three in four is the alarm.
    check(
      flipped < 0.75,
      `higher-lower ${tag}/${difficulty}: ${Math.round(flipped * 100)}% of answers flipped direction`,
    );
    // FNCS Wins has Equal on every level (13 Oct 2026), so a shown nought can be
    // equal and must sometimes be — it used to go up every time on Easy and
    // Medium, a free Higher in about one FNCS round in six.
    if (category === 'fncsWins') {
      check(fromNought > 0, `higher-lower fncsWins/${difficulty}: no nought was ever shown`);
      check(
        noughtUp < fromNought * 0.75,
        `higher-lower fncsWins/${difficulty}: ${noughtUp} of ${fromNought} shown noughts went up`,
      );
      notes.push(`higher-lower fncsWins/${difficulty}: ${noughtUp} of ${fromNought} shown noughts went up`);
    }
    // FNCS Wins runs on small integers and a few hundred title-holders, so its
    // bands are often unreachable and the nearest miss stands in — measured,
    // not held to a number.
    if (category !== 'fncsWins') {
      check(share >= 0.7, `higher-lower ${tag}/${difficulty}: only ${Math.round(share * 100)}% on schedule`);
    }
    // Legitimate ties must still not be the whole game.
    check(ties < rounds * 0.5, `higher-lower ${tag}/${difficulty}: ${ties} of ${rounds} rounds were ties`);
  }
}
for (const category of hlCategories) checkHigherLower(contenders, category);

// Placement counts down: 1st is higher than 10th, and nine places of fifty is
// a close pair. Runs over a real field are in section 12, once cell 5 has
// written an event's results.
{
  const [a, b] = roster.players;
  const first: hl.Contender = { ...a, placement: { place: 1, of: 50 } };
  const tenth: hl.Contender = { ...b, placement: { place: 10, of: 50 } };
  check(hl.valueOf(first, 'placement') > hl.valueOf(tenth, 'placement'), 'higher-lower placement: 1st is not higher than 10th');
  check(hl.fitsBand(first, tenth, 'placement', 'close'), 'higher-lower placement: 1st against 10th of 50 is not close');
  const placed = hl.withPlacements([a, b], { [a.id]: 3 });
  check(
    hl.eligible(placed, 'placement').length === 1 && placed[0].placement?.of === 3,
    'higher-lower placement: withPlacements attached the wrong finishes',
  );
}

// Age is Older or Younger by the birth dates, never a tie; Equal is FNCS Wins' alone.
{
  const [a, b] = roster.players.filter((p) => p.birthDate);
  const older: hl.Contender = { ...a, birthDate: '2003-03-01', age: 23 };
  const younger: hl.Contender = { ...b, birthDate: '2003-09-01', age: 23 };
  check(hl.valueOf(older, 'age') > hl.valueOf(younger, 'age'), 'higher-lower age: two 23-year-olds are not split by their birthdays');
  check(hl.valueOf(older, 'age') === hl.valueOf({ ...b, birthDate: '2003-03-01', age: 23 }, 'age'), 'higher-lower age: one birthday is not level with itself');
  check(hl.answerLabel('age', 'higher') === 'older' && hl.answerLabel('age', 'lower') === 'younger', 'higher-lower age: the answers do not read older and younger');
  check(
    (['age', 'earnings', 'fncsFinals', 'placement', 'twitch', 'youtube'] as const).every((c) => !hl.hasEqualButton(c)) && hl.hasEqualButton('fncsWins'),
    'higher-lower: Equal is offered somewhere other than FNCS Wins',
  );
  const offered = hl.CATEGORIES.filter((c) => !c.hidden && !c.eventOnly).map((c) => c.id);
  check(offered.join() === 'age,earnings,fncsWins', `higher-lower: the categories on offer are ${offered.join(', ')}`);
}

// FNCS Wins must now include players on nought.
{
  const pool = hl.eligible(roster.players, 'fncsWins');
  const zeroes = pool.filter((p) => p.fncsWins === 0).length;
  check(zeroes > 0, 'higher-lower: FNCS Wins still excludes players with no title');
  notes.push(`higher-lower fncsWins: ${pool.length} eligible, ${zeroes} on nought`);
}

// ------------------------------------------------------------- 3. Fortnitedle
{
  const pool = wordle.eligible(roster.players);
  check(pool.length > 0, 'fortnitedle: no eligible answers');
  notes.push(`fortnitedle: ${pool.length} usable handles`);

  let withDigits = 0;
  for (const secret of pool) {
    const game = wordle.gameFor(secret);
    check(game.answer.length >= 3, `fortnitedle: ${secret.name} reduced to "${game.answer}"`);
    const schedule = wordle.revealSchedule(game.answer);
    if (schedule.size === 0) continue;
    withDigits++;
    for (const [position, after] of schedule) {
      check(
        after >= 0 && after <= wordle.MAX_GUESSES,
        `fortnitedle: ${secret.name} reveals position ${position} after ${after} guesses`,
      );
    }
    // Every digit must be out by the last guess, or it was never a fair puzzle.
    const last = Math.max(...schedule.values());
    check(
      last < wordle.MAX_GUESSES,
      `fortnitedle: ${secret.name} hides a digit until guess ${last} of ${wordle.MAX_GUESSES}`,
    );
  }
  notes.push(`fortnitedle: ${withDigits} answers contain a digit`);

  // The documented schedule, exactly: nothing before guess 3, nothing after 5.
  const cases: [string, string][] = [
    ['TH0MASHD', '3'],
    ['A1B2C', '3,4'],
    ['A309', '3,4,5'],
    ['LEO2004', '3,4,5,5'],
  ];
  for (const [answer, expected] of cases) {
    const got = [...wordle.revealSchedule(answer).values()].join();
    check(got === expected, `fortnitedle: ${answer} should reveal after ${expected}, got ${got}`);
  }
  check(
    Math.min(...wordle.revealSchedule('A309').values()) >= wordle.FIRST_REVEAL,
    'fortnitedle: a digit leaked before the first reveal guess',
  );

  // A perfect solve.
  const game = wordle.gameFor(pool[0]);
  const solved = wordle.submitGuess(game, pool[0].name);
  check(solved.ok && solved.state.status === 'won', 'fortnitedle: the exact answer did not win');

  // Player names only (Choose, 13 Oct 2026): a made-up string is refused and
  // costs no guess, a real name of the right length is taken, and every
  // possible answer is itself a name. Off, anything the right length goes.
  {
    const names = wordle.playerNames(roster.players);
    check(pool.every((p) => names.has(wordle.gameFor(p).answer)), 'fortnitedle: an answer is missing from the player names');
    const secret = pool.find((p) => p.name.length >= 5 && /^[A-Za-z]+$/.test(p.name))!;
    const strict = wordle.gameFor(secret, null, true);
    const madeUp = 'QWERTYUIOPAS'.slice(0, strict.answer.length);
    const real = [...names].find((name) => name.length === strict.answer.length && name !== strict.answer)!;
    check(!names.has(madeUp), `fortnitedle: ${madeUp} is somebody's name, pick another test string`);
    const refused = wordle.submitGuess(strict, madeUp, names);
    check(!refused.ok, `fortnitedle: names-only took ${madeUp}`);
    const taken = wordle.submitGuess(strict, real, names);
    check(taken.ok && taken.state.guesses.length === 1, `fortnitedle: names-only refused the real name ${real}`);
    check(wordle.submitGuess(strict, strict.answer, names).ok, 'fortnitedle: names-only refused the answer itself');
    check(wordle.submitGuess(wordle.gameFor(secret), madeUp).ok, 'fortnitedle: a normal round refused a made-up guess');
    const byLength = [3, 6, 9, 12].map((n) => `${n}: ${[...names].filter((name) => name.length === n).length}`);
    notes.push(`fortnitedle names-only: ${names.size} names, by length ${byLength.join(', ')}`);
  }

  // The digit help, three guesses into a round on a digit answer: every level,
  // Random (no level) and the daily say only that there is a digit — no digit
  // shown, no # and no key coloured (the user, 8 Oct 2026).
  const digital = pool.find((p) => wordle.revealSchedule(wordle.gameFor(p).answer).size > 0);
  if (digital) {
    const help = (level: 'easy' | 'medium' | 'hard' | null, guesses = 3) => {
      let state = wordle.gameFor(digital, level);
      const filler = ['Q', 'X', 'Z', 'J', 'V'].slice(0, guesses).map((c) => c.repeat(state.answer.length));
      for (const guess of filler) {
        const next = wordle.submitGuess(state, guess);
        if (next.ok) state = next.state;
      }
      const shown = [...wordle.revealedDigits(state).values()];
      const keyed = [...wordle.keyboardState(state)].filter(([key, s]) => /\d/.test(key) && s === 'correct');
      return { shown, keyed: keyed.length, announced: wordle.digitAnnounced(state) };
    };
    for (const level of ['easy', 'medium', 'hard', null, wordleDaily.DAILY_LEVEL] as const) {
      const got = help(level);
      check(
        got.shown.length === 0 && got.keyed === 0 && got.announced,
        `fortnitedle ${level ?? 'random'}: ${digital.name} — digit announced ${got.announced}, ${got.shown.length} shown, ${got.keyed} keys`,
      );
      check(!help(level, 2).announced, `fortnitedle ${level ?? 'random'}: ${digital.name}'s digit was announced before guess 3`);
    }
    const letters = pool.find((p) => wordle.revealSchedule(wordle.gameFor(p).answer).size === 0)!;
    let plain = wordle.gameFor(letters, null);
    for (const guess of ['Q', 'X', 'Z'].map((c) => c.repeat(plain.answer.length))) {
      const next = wordle.submitGuess(plain, guess);
      if (next.ok) plain = next.state;
    }
    check(!wordle.digitAnnounced(plain), `fortnitedle random: ${letters.name}, all letters, was said to have a digit`);
  }
}

// ------------------------------------------------------------ 4. Career Path
// Every answerable player, both modes, two seeds each. What is asserted is
// what the clue picker promises: the ten describe one player and nobody else,
// the opening never hands over a signature result for a known name, Order
// reads by date, and a hand is never five of the same finish.
if (majors) {
  const answerable = majors.eligible(roster.players);
  check(answerable.length > 0, 'career-path: nobody is answerable');
  // Players whose whole record a partner shares. No hand can tell them apart,
  // so they are held to everything below except describing one player.
  const twinned = new Set(
    answerable
      .filter((p) => career.alsoFits(majors.resultsFor(p.id), p.id, majors).size > 0)
      .map((p) => p.id),
  );
  notes.push(
    `career-path: ${answerable.length} answerable, ${twinned.size} of them share a partner's whole ` +
      `record, ${majors.tournaments.length} majors`,
  );
  const guard = { easy: 3, medium: 2, hard: 0 } as const;

  for (const mode of ['order', 'random'] as const) {
    let hands = 0;
    let bands = 0;
    let samey = 0;
    let varied = 0;
    let long = 0;
    // Random builds up: where the last clue finished, and hands that end on a
    // clue far less telling than one before it.
    const lastPlaces: number[] = [];
    let flat = 0;
    for (const secret of answerable) {
      const results = majors.resultsFor(secret.id);
      const [first, second] = ['a', 'b'].map((seed) =>
        career.createGame(secret, results, mode, majors, `cp-${mode}-${seed}-${secret.id}`),
      );
      if (!first || !second) {
        check(false, `career-path: could not start on ${secret.name}`);
        continue;
      }
      for (const game of [first, second]) {
        hands++;
        const clues = game.clues.map((clue) => clue.result);
        check(clues.length <= career.MAX_CLUES, `career-path: ${secret.name} got ${clues.length} clues`);
        check(
          clues.length === Math.min(career.MAX_CLUES, results.length),
          `career-path: ${secret.name} got ${clues.length} clues from ${results.length} results`,
        );

        const others = career.alsoFits(clues, secret.id, majors);
        check(
          others.size === 0 || twinned.has(secret.id),
          `career-path ${mode}: ${secret.name}'s clues also describe ${[...others].slice(0, 2).join(', ')}`,
        );

        // A known name never opens on the result that gives them away — as far
        // as the career has ordinary results to open on instead.
        const ordinary = clues.filter((clue) => !career.isSignature(clue)).length;
        const opening = Math.min(guard[secret.tier], ordinary);
        if (results.length > career.MAX_CLUES || mode === 'random') {
          check(
            clues.slice(0, opening).every((clue) => !career.isSignature(clue)),
            `career-path ${mode}: ${secret.name} opens on a signature result`,
          );
        }

        if (mode === 'order') {
          for (let i = 1; i < clues.length; i++) {
            check(
              clues[i - 1].tournament.date <= clues[i].tournament.date,
              `career-path: ${secret.name}'s story is out of order at clue ${i}`,
            );
          }
        } else {
          // The last clue is within the jitter of the most telling in the hand,
          // and no clue comes before one less telling by more than the jitter.
          const told = clues.map(career.telling);
          lastPlaces.push(clues[clues.length - 1].placement);
          const reversed = told.some((value, i) => told.slice(i + 1).some((later) => value - later > career.RAMP_JITTER + 1e-9));
          if (Math.max(...told) - told[told.length - 1] > career.RAMP_JITTER + 1e-9 || reversed) flat++;
        }

        bands += new Set(clues.map((clue) => career.finishBand(clue.placement))).size;
        const same = Math.max(
          ...[...new Set(clues.map((clue) => clue.placement))].map(
            (place) => clues.filter((clue) => clue.placement === place).length,
          ),
        );
        // Only a hand with a choice counts: a five-major career of five wins
        // is what it is.
        if (same >= 5 && results.length > career.MAX_CLUES) samey++;

        const solved = career.submitGuess(game, secret);
        check(solved.status === 'won', `career-path: correct guess did not win on ${secret.name}`);
        check(
          solved.revealed === game.clues.length,
          `career-path: winning on ${secret.name} left ${solved.revealed}/${game.clues.length} clues hidden`,
        );
      }
      if (results.length > 15) {
        long++;
        const key = (game: career.GameState) =>
          game.clues.map((clue) => clue.result.tournament.name).sort().join('|');
        if (key(first) !== key(second)) varied++;
      }
    }
    check(samey === 0, `career-path ${mode}: ${samey} hands repeat one placement five times`);
    notes.push(
      `career-path ${mode}: ${hands} hands, ${(bands / Math.max(hands, 1)).toFixed(1)} finish bands each, ` +
        `${varied}/${long} long careers dealt a different hand on a second meeting`,
    );
    if (mode === 'random') {
      // A guarded opening can pull one ordinary clue forward, which is the only
      // way a hand breaks the ramp; a handful of all-win careers do.
      check(flat <= hands * 0.01, `career-path random: ${flat} of ${hands} hands do not build up`);
      const sorted = [...lastPlaces].sort((a, b) => a - b);
      const share = (top: number) => Math.round((100 * lastPlaces.filter((place) => place <= top).length) / Math.max(1, lastPlaces.length));
      notes.push(
        `career-path random: the last clue is a top 3 in ${share(3)}% of hands, top 10 in ${share(10)}%, ` +
          `median ${ordinal(sorted[Math.floor(sorted.length / 2)] ?? 0)}; ${flat} hands break the ramp`,
      );
    }
  }

  // The round the old picker served: Bugha opening on the World Cup.
  const bugha = answerable.find((p) => p.name === 'Bugha');
  if (bugha) {
    const game = career.createGame(bugha, majors.resultsFor(bugha.id), 'order', majors, 'bugha');
    const opening = game?.clues[0]?.result;
    notes.push(`career-path: Bugha's Order path opens on ${opening?.tournament.shortName} (${opening?.placement})`);
    check(
      !opening?.tournament.name.startsWith('Fortnite World Cup'),
      "career-path: Bugha's path still opens on the World Cup",
    );
  }

  // Every round gets MIN_GUESSES guesses, however short the career: an event
  // field's two-major qualifier plays two clues, then three spare guesses that
  // reveal nothing. A ten-clue round is unchanged — its tenth wrong guess ends it.
  const [secret, ...others] = answerable;
  const wrongs = (game: career.GameState, n: number) =>
    others.slice(0, n).reduce((state, other) => career.submitGuess(state, other), game);
  const two = career.createGame(secret, majors.resultsFor(secret.id).slice(0, 2), 'order', majors, 'short')!;
  const fourIn = wrongs(two, career.MIN_GUESSES - 1);
  check(
    fourIn.status === 'playing' && career.guessesLeft(fourIn) === 1,
    `career-path: a two-clue round ended or miscounted after ${career.MIN_GUESSES - 1} wrong guesses`,
  );
  const fiveIn = wrongs(two, career.MIN_GUESSES);
  check(fiveIn.status === 'lost' && career.record(fiveIn).outcome === 'lost', 'career-path: a two-clue round outlived its guesses');
  check(
    career.record(career.giveUp(wrongs(two, 3))).outcome === 'gave-up',
    'career-path: giving up on the spare guesses was recorded as running out',
  );
  const full = career.createGame(secret, majors.resultsFor(secret.id), 'order', majors, 'full')!;
  if (full.clues.length === career.MAX_CLUES) {
    check(wrongs(full, career.MAX_CLUES - 1).status === 'playing', 'career-path: a ten-clue round ended early');
    check(wrongs(full, career.MAX_CLUES).status === 'lost', 'career-path: a ten-clue round outlived its clues');
  }

  // An event field reaches its short careers; the roster does not.
  for (const pool of pools.pools) {
    const inPool = roster.players.filter((p) => pool.players.includes(p.id));
    const reached = majors.inField(inPool).length;
    const long = majors.eligible(inPool).length;
    check(reached >= long, `career-path: ${pool.label} lost players to the field rule`);
    notes.push(`career-path ${pool.label}: ${reached} of ${inPool.length} answerable (${long} with ${majors.minAppearances}+ majors)`);
  }
}

// ------------------------------------------------------------- 5. Who Are Ya
if (teammates && facts) {
  const byId = new Map(roster.players.map((p) => [p.id, p]));
  const answerable = roster.players.filter(
    (p) =>
      whoAreYa.usableClues(teammates.cluesFor(p.id, byId)).length >= whoAreYa.MIN_CLUES &&
      facts.of(p.id).apps >= whoAreYa.MIN_TOURNAMENTS,
  );
  check(answerable.length > 0, 'who-are-ya: nobody is answerable');
  notes.push(
    `who-are-ya: ${answerable.length} answerable (${whoAreYa.MIN_CLUES}+ teammates, ${whoAreYa.MIN_TOURNAMENTS}+ majors)`,
  );

  let early = 0;
  for (const mode of ['easy', 'hard', 'random'] as const) {
    for (const secret of answerable.slice(0, 120)) {
      const clues = teammates.cluesFor(secret.id, byId);
      const game = whoAreYa.createGame(secret, clues, mode, `wy-${mode}-${secret.id}`);
      check(game !== null, `who-are-ya: could not start on ${secret.name}`);
      if (!game) continue;
      check(
        !game.clues.some((clue) => clue.player.id === secret.id),
        `who-are-ya: ${secret.name} is listed as their own teammate`,
      );
      check(
        game.clues.every((clue) => clue.events >= whoAreYa.MIN_SHARED),
        `who-are-ya: ${secret.name}'s hand has a teammate under ${whoAreYa.MIN_SHARED} shared tournaments`,
      );
      // The number one teammate: last in the two ramped orders, and never in
      // the first four of Random.
      const top = game.clues.findIndex((clue) => clue.player.id === clues[0].player.id);
      if (mode === 'random') {
        if (top < Math.min(whoAreYa.TOP_HELD_BACK, game.clues.length - 1)) early++;
      } else {
        check(top === game.clues.length - 1, `who-are-ya ${mode}: ${secret.name}'s top teammate is not last`);
      }
      const solved = whoAreYa.submitGuess(game, secret);
      check(solved.status === 'won', 'who-are-ya: correct guess did not win');
      check(
        solved.revealed === game.clues.length,
        `who-are-ya: winning on ${secret.name} left ${solved.revealed}/${game.clues.length} clues hidden`,
      );
    }
  }
  check(early === 0, `who-are-ya random: the top teammate came in the first ${whoAreYa.TOP_HELD_BACK} clues ${early} times`);

  // A two-teammate hand — an event field's short record — still plays five
  // wrong guesses, and giving up on the spares is not running out.
  const secret = answerable[0];
  const two = whoAreYa.createGame(secret, teammates.cluesFor(secret.id, byId).slice(0, 2), 'easy', 'short')!;
  const others = roster.players.filter((p) => p.id !== secret.id);
  const wrongs = (n: number) => others.slice(0, n).reduce((state, p) => whoAreYa.submitGuess(state, p), two);
  check(wrongs(career.MIN_GUESSES - 1).status === 'playing', 'who-are-ya: a two-clue hand ended before five guesses');
  check(wrongs(career.MIN_GUESSES).status === 'lost', 'who-are-ya: a two-clue hand outlived five guesses');
  check(whoAreYa.record(whoAreYa.giveUp(wrongs(3))).outcome === 'gave-up', 'who-are-ya: giving up on the spares read as running out');
}

// ---------------------------------------------------------------- 6. Tenaball
if (rankings) {
  // The Globals boards are built in the browser from career_path.json, and play like any shipped board.
  const globals = majors ? globalsBoards(majors, roster) : [];
  notes.push(`tenaball: ${rankings.boards.length} boards, ${globals.length} Globals boards`);

  // The winners and records boards of 14 Oct 2026, built from facts.json: each
  // the user asked for is there, and every one is ten rows, a 10th not level
  // with an 11th, and (but for the exactly-ten boards) an 11th to name.
  if (facts) {
    const winners = winnerBoards(facts, roster);
    const records = recordBoards(facts, roster);
    for (const id of ['first-million', 'fncs-first-to:5', 'fncs-debut', 'fncs-youngest', 'fncs-oldest', 'fncs-long-road', 'fncs-comebacks', 'fncs-in-a-row', 'pairs-major-titles', 'countries-fncs-winners', 'born:2006', 'fncs-last:Europe', 'divcup-last:Europe', 'fncs-win-rate', 'fncs-win-rate:Europe', 'fncs-fewest-finals:Europe', 'fncs-fewest-finals:Europe:2021', 'fncs-fewest-finals:Europe:2022', 'fncs-youngest:Europe', 'fncs-oldest:Europe', 'majors-in-a-row']) {
      check([...winners, ...records].some((board) => board.id === id), `tenaball: no "${id}" board`);
    }
    for (const board of [...winners, ...records]) {
      check(board.rows.length === tenaball.SLOTS, `tenaball: ${board.id} has ${board.rows.length} rows`);
      check(board.id.includes('-all:') || Boolean(board.next.key), `tenaball: ${board.id} has no 11th`);
    }
    notes.push(`tenaball: ${winners.length} FNCS and Div Cup winners boards, ${records.length} records`);
    // On the pairs board one player is on several rows: naming them once names
    // them on every one (15 Oct 2026), and a second time is a repeat.
    const pairsBoard = records.find((board) => board.id === 'pairs-major-titles');
    const shared = pairsBoard?.rows.flatMap((row) => row.members ?? []).find((member, i, all) => all.findIndex((m) => m.key === member.key) !== i);
    if (pairsBoard && shared) {
      const theirs = pairsBoard.rows.flatMap((row, i) => (row.members?.some((member) => member.key === shared.key) ? [i + 1] : []));
      const once = tenaball.applyGuess(tenaball.createGame(pairsBoard, 'easy'), shared.key, shared.label);
      const placed = once.outcome.kind === 'partial' || once.outcome.kind === 'correct' ? once.outcome.placed.map((row) => row.rank) : [];
      check(placed.join() === theirs.join(), `tenaball: naming ${shared.label} once filled rows ${placed.join(', ') || 'none'}, not ${theirs.join(', ')}`);
      let game = once.state;
      for (const rank of theirs) {
        for (const member of pairsBoard.rows[rank - 1].members ?? []) {
          if (member.key !== shared.key) game = tenaball.applyGuess(game, member.key, member.label).state;
        }
      }
      check(theirs.every((rank) => game.found.has(rank)), `tenaball: ${shared.label}'s ${theirs.length} pairs did not all close`);
      check(tenaball.applyGuess(game, shared.key, shared.label).outcome.kind === 'duplicate', `tenaball: naming ${shared.label} again was not a repeat`);
    }
  }
  const byGroup = new Map<string, number>();
  for (const board of [...rankings.boards, ...globals]) {
    byGroup.set(board.group, (byGroup.get(board.group) ?? 0) + 1);
    check(board.rows.length === tenaball.SLOTS, `tenaball: ${board.id} has ${board.rows.length} rows`);
    check(Boolean(board.next?.key), `tenaball: ${board.id} has no 11th place for the tie rule`);

    // Answers, not rows: a tournament board in duos ranks placements, so the
    // ten rows hold twenty names and it is the *names* that have to be unique.
    // One player answering for two slots would make the board unwinnable.
    const answers = board.rows.flatMap((row) => membersOf(row).map((member) => member.key));
    check(new Set(answers).size === answers.length, `tenaball: ${board.id} repeats an entry`);
    const spare = membersOf(board.next).map((member) => member.key);
    check(
      !spare.some((key) => answers.includes(key)),
      `tenaball: ${board.id} lists its 11th place inside the ten`,
    );

    // A paydays board is answered with an event name, and the only place the
    // guess box can find one is the list the notebook ships. An answer missing
    // from it is a slot that cannot be filled — the same bug the org boards had.
    if (board.entity === 'tournament') {
      const pool = new Set(rankings.tournaments);
      check(pool.size > answers.length * 5, `tenaball: ${board.id} has no event list to search`);
      check(
        [...answers, ...spare].every((key) => pool.has(key)),
        `tenaball: ${board.id} names an event the guess box cannot offer`,
      );
    }

    // A perfect run fills every slot and never loses a life. A team row takes
    // one guess per name and only closes on the last of them.
    let game = tenaball.createGame(board, 'hard');
    for (const row of board.rows) {
      const members = membersOf(row);
      members.forEach((member, index) => {
        const result = tenaball.applyGuess(game, member.key, member.label);
        const wanted = index === members.length - 1 ? 'correct' : 'partial';
        check(
          result.outcome.kind === wanted,
          `tenaball: ${board.id} answered "${member.label}" with ${result.outcome.kind}, expected ${wanted}`,
        );
        game = result.state;
      });
    }
    check(game.status === 'won', `tenaball: ${board.id} did not win on a perfect run`);
    check(game.lives === tenaball.HARD_LIVES, `tenaball: ${board.id} lost a life on a perfect run`);

    if (board.shareCut) {
      // Level at the cut: the 11th fills 10th, and the 10th is then told it is level.
      const tenth = board.rows[tenaball.SLOTS - 1];
      check(tenth.value === board.next.value, `tenaball: ${board.id} shares a cut that is not level`);
      let shared = tenaball.createGame(board, 'hard');
      for (const key of spare) shared = tenaball.applyGuess(shared, key).state;
      check(shared.found.has(tenaball.SLOTS), `tenaball: ${board.id}'s level 11th did not fill 10th`);
      const other = tenaball.applyGuess(shared, membersOf(tenth)[0].key);
      check(
        other.outcome.kind === 'level' && other.state.lives === tenaball.HARD_LIVES,
        `tenaball: ${board.id}'s 10th after its level 11th read ${other.outcome.kind}`,
      );
    } else {
      // The 11th is wrong and costs a life (13 Oct 2026); the game only says it was 11th.
      const near = tenaball.applyGuess(tenaball.createGame(board, 'hard'), spare[0], board.next.label);
      check(near.outcome.kind === 'eleventh', `tenaball: ${board.id} did not call out its own 11th place`);
      check(near.state.lives === tenaball.HARD_LIVES - 1, `tenaball: ${board.id} did not charge a life for the 11th`);
      check(near.state.wrong.length === 1, `tenaball: ${board.id} did not count the 11th as a wrong answer`);
    }
  }

  // The average-finish boards. The user's worked example is Vico at 2026's
  // five majors, 1 + 3 + 1 + 3 + 20 = 5.6; Peterbot's 2024 FNCS was 2nd, 1st
  // and 1st in NA Central, 4 / 3.
  const year = facts?.season?.year ?? 2026;
  const europe = rankings.get(`season:${year}:Europe`);
  const naCentral = rankings.get('fncs-avg:2024:NA Central');
  if (!europe || !naCentral) {
    skipped.push('tenaball: the average-finish boards (rankings.json is older — run build_data.py)');
  } else {
    const vico = europe.rows.find((row) => row.key === 'Vic0try0na');
    check(vico?.display === '5.6', `tenaball: Vic0try0na reads ${vico?.display} on Europe's 2026 board, not 5.6`);
    const peterbot = naCentral.rows.find((row) => row.key === 'Peterbot');
    check(
      peterbot?.display === '1.3',
      `tenaball: Peterbot reads ${peterbot?.display} on NA Central's 2024 FNCS board, not 1.3`,
    );
    // Cold played EWC and the Summit with Rapid, Major 2 and the Globals with
    // Ritual: as a duo, either pair missed two of the five, at 100th each.
    const duos = rankings.get(`season:${year}:duos`);
    check(Boolean(duos), 'tenaball: no top 10 duos of the season');
    check(
      !duos?.rows.some((row) => membersOf(row).some((member) => member.key === 'Cold')),
      'tenaball: Cold is in a top 10 duo',
    );
    // A miss is twice a full lobby's last place, 200th at the most, so no
    // average can be worse than that.
    for (const board of rankings.boards.filter((b) => /^(season|fncs-avg):/.test(b.id))) {
      check(board.lowerIsBetter === true, `tenaball: ${board.id} is an average that is not lower-is-better`);
      check(
        [...board.rows, board.next].every((row) => row.value <= 200),
        `tenaball: ${board.id} has an average worse than a missed solo final`,
      );
    }
    for (const key of ['world', 'Europe', 'NA Central', 'NA West', 'duos']) {
      const board = rankings.get(`season:${year}:${key}`);
      if (!board) {
        notes.push(`tenaball: no ${year} "${key}" board — 11th and 12th are level too, or fewer than eleven`);
        continue;
      }
      const cut = board.shareCut ? ` (10th shared with ${board.next.label})` : '';
      notes.push(`tenaball: ${board.title} — ${board.rows.map((row) => row.label).join(', ')}${cut}`);
    }
  }

  // Div Cups and Performance Evaluations. C7S4's Div Cups carry C7S3's names,
  // so both seasons have to come out as boards of their own — merged, C7S4
  // would have no weeks and C7S3 eight.
  const divcups = rankings.boards.filter((b) => b.id.startsWith('divcup:'));
  if (divcups.length === 0) {
    skipped.push('tenaball: the Div Cup boards (rankings.json is older — run build_data.py)');
  } else {
    const finals = rankings.get('divcup:finals:all:world');
    check(
      finals?.rows[0].key === 'Eomzo' && finals.rows[0].value === 62,
      `tenaball: Div Cup finals all time opens on ${finals?.rows[0].label} ${finals?.rows[0].value}, not Eomzo 62`,
    );
    for (const season of ['C7S3', 'C7S4']) {
      const board = rankings.get(`divcup:average:${season}:world`);
      check(Boolean(board), `tenaball: no ${season} Div Cup average board`);
      check(Boolean(board?.tieRule.includes('the 4 Div Cup weeks')), `tenaball: ${season} is not four weeks of Div Cups`);
    }
    for (const board of divcups) {
      if (board.id.startsWith('divcup:average')) {
        check(board.lowerIsBetter === true, `tenaball: ${board.id} is an average that is not lower-is-better`);
        check(
          [...board.rows, board.next].every((row) => row.value <= 100),
          `tenaball: ${board.id} averages worse than a missed week`,
        );
      } else {
        check(board.rows.every((row) => row.value > 0), `tenaball: ${board.id} lists someone on nothing`);
      }
    }
    const fpe = rankings.boards.filter((b) => b.id.startsWith('fpe:'));
    check(fpe.length > 0, 'tenaball: no Performance Evaluation boards');
    notes.push(`tenaball: ${divcups.length} Div Cup boards, ${fpe.length} Performance Evaluation boards`);
  }

  // The Globals boards, each row worked out again from the raw finishes.
  if (!majors) {
    skipped.push('tenaball: the Globals boards (no career_path.json)');
  } else {
    const events = globalsEvents(majors);
    check(events.length >= 4, `tenaball: only ${events.length} Globals with results`);
    check(!events.some((event) => /World Cup/.test(event.name)), 'tenaball: the World Cup is counted as a Globals');
    const missedAt: Record<string, number> = { Duo: 100, Trio: 66 };
    const finishOf = (id: string) =>
      new Map(majors.resultsFor(id).filter((r) => events.includes(r.tournament)).map((r) => [r.tournament.name, r.placement]));
    // Every minimum gets its board unless it is the same ten as one already made
    // (today "played all four" is the best-at-every-Globals board, row for row).
    const ids = ['globals:best', ...events.slice(0, -1).map((_, i) => `globals:average:${i + 1}`), 'globals:worst'];
    check(ids.every((id) => globals.some((b) => b.id === id)), `tenaball: Globals boards built: ${globals.map((b) => b.id).join(', ') || 'none'}`);
    const tens = globals.map((b) => b.rows.map((row) => row.key).join(','));
    check(new Set(tens).size === tens.length, 'tenaball: two Globals boards have the same ten');
    for (const board of globals) {
      check(termsIn(`${board.group} ${board.title}`, board.id).includes('global'), `tenaball: ${board.id} does not explain the Globals`);
      const all = [...board.rows, board.next];
      const worst = board.id === 'globals:worst';
      check(board.lowerIsBetter === !worst, `tenaball: ${board.id} sorts the wrong way`);
      all.forEach((row, index) => {
        const mine = finishOf(row.key);
        const places = [...mine.values()];
        const expected =
          board.id === 'globals:best'
            ? events.reduce((sum, event) => sum + (mine.get(event.name) ?? missedAt[event.mode ?? ''] ?? NaN), 0) / events.length
            : places.reduce((sum, place) => sum + place, 0) / places.length;
        check(Math.abs(row.value - expected) < 1e-9, `tenaball: ${board.id} has ${row.label} on ${row.value}, the finishes say ${expected}`);
        const least = /^globals:average:(\d+)$/.exec(board.id);
        if (least) check(places.length >= Number(least[1]), `tenaball: ${row.label} is on ${board.id} with ${places.length} Globals`);
        if (worst) check(places.length >= events.length - 1, `tenaball: ${row.label} is on ${board.id} with ${places.length} of ${events.length} Globals`);
        if (index > 0) {
          const before = all[index - 1].value;
          check(worst ? before >= row.value : before <= row.value, `tenaball: ${board.id} is out of order at ${row.label}`);
        }
      });
    }
    for (const board of globals) {
      notes.push(`tenaball ${board.id}: ${board.rows.map((row) => `${row.label} ${row.display}`).join(', ')} | 11th ${board.next.label}`);
    }
  }
  for (const [group, count] of [...byGroup].sort((a, b) => b[1] - a[1])) {
    notes.push(`  ${group}: ${count}`);
  }
  check(byGroup.size >= 4, `tenaball: only ${byGroup.size} category groups`);
}

// Boards built in the browser — each event field's, and the derived all-time
// ones — never let the alphabet decide who is 10th. A level cut means the
// board is not built at all, and no rule may promise a split by name.
{
  const byId = new Map(roster.players.map((p) => [p.id, p]));
  const built = [
    ...derivedBoards(roster.players),
    ...(majors ? globalsBoards(majors, roster) : []),
    ...(facts ? [...winnerBoards(facts, roster), ...recordBoards(facts, roster)] : []),
    ...pools.pools.flatMap((pool) =>
      poolBoards(pool, pool.players.flatMap((id) => byId.get(id) ?? []), facts, orgs),
    ),
  ];
  for (const board of built) {
    check(!/alphabet|by name/i.test(board.tieRule), `tenaball: ${board.id} still breaks ties by name`);
    const tenth = board.rows[tenaball.SLOTS - 1];
    // Level on the value is fine when the rule has something under it: the
    // category's own steps end in the money ("the bigger career earner").
    if (tenth.value === board.next.value) {
      check(/earn|born|oldest|newest|won first/i.test(board.tieRule), `tenaball: ${board.id} is level at the cut with no tiebreak`);
    }
  }
  notes.push(`tenaball: ${built.length} boards built in the browser (derived + records + winners + event fields)`);

  // Level counts go to the category's own tiebreak before the money (22 Oct
  // 2026): FNCS titles to FNCS podiums, the most wins in a region to podiums
  // there. Read against facts.json, so the notebook and the browser agree.
  if (facts) {
    const atCut = (board: Board | null | undefined, podiums: (id: string) => number) => {
      if (!board) return true;
      const [tenth, next] = [board.rows[tenaball.SLOTS - 1], board.next];
      return tenth.value !== next.value || podiums(tenth.key) >= podiums(next.key);
    };
    check(atCut(rankings?.get('fncs-wins'), (id) => facts.podiumsAt(id)), 'tenaball: fncs-wins splits a level cut against FNCS podiums');
    check(/podiums/.test(rankings?.get('fncs-wins')?.tieRule ?? 'podiums'), 'tenaball: fncs-wins does not say level titles go to podiums');
    const most = winnerBoards(facts, roster).filter((board) => board.id.startsWith('fncs-most:'));
    const wrong = most.filter((board) => {
      const region = board.id.slice('fncs-most:'.length);
      return !atCut(board, (id) => facts.podiumsAt(id, (event) => isRegionalFinal(event) && fncsRegion(event) === region));
    });
    check(wrong.length === 0, `tenaball: ${wrong.map((board) => board.id).join(', ')} split a level cut against the region's podiums`);
  }
}

// -------------------------------------------------------------------- 7. List
if (facts) {
  // Orgs and teammates are optional to the game — it shows the lists they buy
  // once the files land — so they are passed here to get those lists checked.
  const criteria = buildListCriteria(roster, facts, pools, orgs, teammates);
  check(criteria.length > 0, 'list: no categories available');
  const byGroup = new Map<string, number>();
  const rosterIds = new Set(roster.players.map((player) => player.id));
  for (const criterion of criteria) {
    const kind = criterion.id.split(':')[0];
    byGroup.set(kind, (byGroup.get(kind) ?? 0) + 1);
    check(criterion.answers.length >= 8, `list: "${criterion.title}" has only ${criterion.answers.length}`);
    const ids = new Set(criterion.answers.map((p) => p.id));
    check(ids.size === criterion.answers.length, `list: "${criterion.title}" repeats an answer`);
    // Every answer has to be typable in the box this list opens, or the round
    // cannot be finished — the same rule Tenaball's boards live by.
    const pool = new Set((criterion.pool ?? roster.players).map((entry) => entry.id));
    const unreachable = criterion.answers.filter((answer) => !pool.has(answer.id));
    check(
      unreachable.length === 0,
      `list: "${criterion.title}" cannot be typed: ${unreachable.slice(0, 3).map((a) => a.name).join(', ')}`,
    );
    if (!criterion.pool) {
      check(
        criterion.answers.every((answer) => rosterIds.has(answer.id)),
        `list: "${criterion.title}" answers with somebody off the roster`,
      );
    }
  }
  // Countries, not players: one FNCS winner puts a country on it.
  const winning = criteria.find((criterion) => criterion.id === 'countries-fncs');
  check(Boolean(winning), 'list: no "Countries with an FNCS winner"');
  if (winning) {
    const expected = new Set(roster.players.filter((p) => p.fncsWins > 0).flatMap((p) => p.countryName ?? []));
    check(
      winning.answers.length === expected.size && winning.answers.every((answer) => expected.has(answer.id)),
      'list: "Countries with an FNCS winner" is not the set of the winners’ countries',
    );
    notes.push(`list: ${winning.answers.length} countries with an FNCS winner`);
  }
  // Div Cup and Evaluation lists come finished in facts.json: a winners list
  // for every region, and every season's "played them all".
  if (facts.lists.length === 0) {
    skipped.push('list: the Div Cup lists (facts.json is older — run build_data.py)');
  } else {
    const ids = new Set(criteria.map((criterion) => criterion.id));
    for (const region of ['Europe', 'NA Central', 'NA West', 'Brazil', 'Asia', 'Middle East', 'Oceania']) {
      check(ids.has(`divcup-won:${region}`), `list: no Div Cup winners list for ${region}`);
    }
    check(
      [...ids].some((id) => id.startsWith('divcup-every:C7S4')) && [...ids].some((id) => id.startsWith('divcup-every:C7S3')),
      'list: C7S3 and C7S4 are not two seasons',
    );
    // "Played every one of them", split by region: every FNCS year has its
    // lists, 2019's is the one with the World Cup, and none is a phone book.
    const everyFinal = criteria.filter((criterion) => criterion.id.startsWith('fncs-every:'));
    if (everyFinal.length === 0) {
      skipped.push('list: "played every one" by region (facts.json is older — run build_data.py)');
    } else {
      const years = new Set(everyFinal.map((criterion) => criterion.id.split(':')[1]));
      check(years.size >= 8, `list: "every FNCS grand final" covers only ${years.size} years`);
      check(
        Boolean(everyFinal.find((criterion) => criterion.id === 'fncs-every:2019')?.title.includes('World Cup')),
        'list: 2019’s "every FNCS grand final" does not ask for the World Cup',
      );
      const every = criteria.filter((criterion) => /^(fncs|divcup)-every:/.test(criterion.id));
      const biggest = every.reduce((a, b) => (b.answers.length > a.answers.length ? b : a));
      check(biggest.answers.length <= 100, `list: "${biggest.title}" is ${biggest.answers.length} names`);
      notes.push(`list: ${every.length} "played every one" lists, the biggest ${biggest.title} at ${biggest.answers.length}`);
    }
    const weekly = criteria.filter((criterion) => /^(divcup|fpe)/.test(criterion.id));
    notes.push(
      `list: ${weekly.length} Div Cup and Evaluation lists, ${facts.lists.length - weekly.length} under 8 answers`,
    );
  }
  notes.push(`list: ${criteria.length} categories`);
  for (const [kind, count] of [...byGroup].sort((a, b) => b[1] - a[1])) {
    notes.push(`  ${kind}: ${count}`);
  }
}

// ---------------------------------------------- 8-10. the criteria-based games
if (facts && orgs) {
  const players = roster.playersFor('medium', { minimum: 200, eligible: facts.eligible(3) });
  const source: CriteriaSource = { players, facts, orgs };
  const criteria = buildCriteria(source, { minMatches: 4, maxShare: 0.5 });
  notes.push(`criteria: ${criteria.length} usable over a ${players.length}-player pool`);

  const kinds = new Map<string, number>();
  for (const criterion of criteria) kinds.set(criterion.kind, (kinds.get(criterion.kind) ?? 0) + 1);
  for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1])) notes.push(`  ${kind}: ${count}`);

  // The old dataset could only really answer "country" and "region". If that is
  // true again, the criteria games are back to being flag-reading exercises.
  const identity = (kinds.get('country') ?? 0) + (kinds.get('region') ?? 0);
  check(
    identity < criteria.length * 0.5,
    `criteria: ${identity} of ${criteria.length} are country/region — too few real questions`,
  );

  // ---- Griefer
  let grieferOk = 0;
  for (let seed = 0; seed < 60; seed++) {
    const round = griefer.createRound(source, `g-${seed}`);
    if (!round) continue;
    grieferOk++;
    check(round.memberIds.size >= 2, `griefer: round ${seed} has ${round.memberIds.size} players who fit`);
    check(
      round.memberIds.size < round.board.length,
      `griefer: round ${seed} has no griefers at all`,
    );
    for (const player of round.board) {
      check(
        round.criterion.test(player) === round.memberIds.has(player.id),
        `griefer: round ${seed} mislabels ${player.name}`,
      );
    }
    // Perfect play: select exactly the ones who fit.
    let game = griefer.createGame(round, 'all-at-once');
    for (const player of round.board) {
      if (round.memberIds.has(player.id)) game = griefer.toggle(game, player);
    }
    check(griefer.check(game).status === 'won', `griefer: round ${seed} rejected a perfect selection`);
  }
  check(grieferOk >= 50, `griefer: only ${grieferOk} of 60 seeds produced a board`);

  // ---- Tic Tac Toe
  // Built the way the game builds it: the board around one level's fame band,
  // the guess box open to the whole roster.
  const bands = { easy: ['easy'], medium: ['easy', 'medium'], hard: ['easy', 'medium', 'hard'] } as const;
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const answers = bands[difficulty].flatMap((band) =>
      roster.exactly(band, { eligible: facts.eligible(3) }),
    );
    const pools = { answers, accepted: roster.players };
    const answerIds = new Set(answers.map((p) => p.id));
    let boards = 0;
    let offers = 0;
    let autoPlaced = 0;
    // Placed players from outside the level's band. The band builds the board;
    // it must never decide who you are allowed to answer with.
    let outsiders = 0;
    let nearNested = 0;
    // Boards where one player fits more cells than the level allows.
    let overReach = 0;
    // Boards carrying one of the rules added 27 Sep 2026, by kind.
    const added = new Map<string, number>();
    for (let seed = 0; seed < 25; seed++) {
      const board = ttt.generateBoard({ facts, orgs }, pools, difficulty, `t-${difficulty}-${seed}`);
      if (!board) continue;
      boards++;
      if (ttt.maxReach(board) > ttt.LEVELS[difficulty].reach) overReach++;
      for (const kind of new Set([...board.rows, ...board.cols].map((axis) => axis.kind))) {
        if (['fncs-count', 'fncs-back-to-back', 'fncs-with', 'lan-podium'].includes(kind)) {
          added.set(kind, (added.get(kind) ?? 0) + 1);
        }
      }
      // No two axes nearly the same rule — "Won NA FNCS" beside "North America".
      const axes = [...board.rows, ...board.cols];
      for (let i = 0; i < axes.length; i++) {
        for (let j = i + 1; j < axes.length; j++) {
          const [small, large] =
            axes[i].matches.length <= axes[j].matches.length ? [axes[i], axes[j]] : [axes[j], axes[i]];
          const inside = small.matches.filter((p) => large.test(p)).length;
          if (inside >= small.matches.length * ttt.NEAR_NESTED) nearNested++;
        }
      }
      // The level's promise: enough answers from its own band in every cell.
      for (const row of board.candidates) {
        for (const cell of row) {
          const known = cell.filter((p) => answerIds.has(p.id)).length;
          check(
            known >= ttt.LEVELS[difficulty].answers,
            `tic-tac-toe ${difficulty}: board ${seed} has a cell with ${known} answers from its band`,
          );
        }
      }

      // Play it in a scrambled order, submitting whoever fits some empty cell.
      // This is the path that used to dead-end: a player offered two cells,
      // one of which stranded a third.
      let game = ttt.createGame(board, difficulty);
      // One pass is enough: a cell only ever closes, so anyone who fits an
      // open cell now was offered it on their turn.
      const order = shuffle(makeRng(`t-order-${seed}`), board.candidates.flat(2));
      for (const candidate of order) {
        if (game.status !== 'playing') break;
        if ([...game.filled.values()].some((p) => p.id === candidate.id)) continue;
        const open = board.rows.some((row, r) =>
          board.cols.some(
            (col, c) => !game.filled.has(ttt.cellKey(r, c)) && row.test(candidate) && col.test(candidate),
          ),
        );
        if (!open) continue;
        const result = ttt.submit(game, candidate);
        check(
          result.outcome.kind !== 'deadlock',
          `tic-tac-toe ${difficulty}: board ${seed} refused ${candidate.name}, who fits an open cell`,
        );
        if (result.outcome.kind === 'placed') {
          autoPlaced++;
          if (!answerIds.has(candidate.id)) outsiders++;
          game = result.state;
        } else if (result.outcome.kind === 'choose') {
          offers++;
          // Every offered cell has to be one the move can actually go to.
          for (const cell of result.outcome.cells) {
            const tried = ttt.place(game, cell, candidate);
            check(
              tried.outcome.kind === 'placed',
              `tic-tac-toe ${difficulty}: board ${seed} offered ${candidate.name} a cell that strands another`,
            );
          }
          game = ttt.place(game, result.outcome.cells[0], candidate).state;
          if (!answerIds.has(candidate.id)) outsiders++;
        }
      }
      check(
        game.status === 'won',
        `tic-tac-toe ${difficulty}: board ${seed} could not be completed (${game.filled.size}/9)`,
      );
      check(game.mistakes === 0, `tic-tac-toe ${difficulty}: board ${seed} charged a mistake on perfect play`);
    }
    check(boards >= 22, `tic-tac-toe ${difficulty}: only ${boards} of 25 seeds produced a board`);
    if (difficulty !== 'hard') {
      check(outsiders > 0, `tic-tac-toe ${difficulty}: nobody from outside the band was ever placed`);
    }
    check(nearNested === 0, `tic-tac-toe ${difficulty}: ${nearNested} pairs of near-identical axes`);
    // EpikWhale used to fit all nine cells on one Easy board in five.
    check(overReach <= 1, `tic-tac-toe ${difficulty}: ${overReach} boards let one player fit over ${ttt.LEVELS[difficulty].reach} cells`);

    // Ten boards in a row, the way the game deals them: the last three boards' rules kept out.
    let recent: string[] = [];
    let repeats = 0;
    const rules = new Set<string>();
    for (let round = 0; round < 10; round++) {
      const board = ttt.generateBoard({ facts, orgs }, pools, difficulty, `run-${difficulty}-${round}`, recent);
      if (!board) continue;
      const ids = [...board.rows, ...board.cols].map((axis) => axis.id);
      repeats += ids.filter((id) => recent.slice(0, 6).includes(id)).length;
      ids.forEach((id) => rules.add(id));
      recent = [...ids, ...recent].slice(0, 18);
    }
    notes.push(`tic-tac-toe ${difficulty}: 10 boards in a row use ${rules.size} rules, ${repeats} repeated from the board before`);
    notes.push(
      `tic-tac-toe ${difficulty}: ${boards}/25 boards over a ${answers.length}-player band, ` +
        `${autoPlaced} placed by typing alone, ${offers} asked which cell, ` +
        `${outsiders} placed from outside the band; new rules on ` +
        ([...added].map(([kind, n]) => `${n} (${kind})`).join(', ') || 'none'),
    );
  }

  // Nobody reads "won in Europe" off a Globals any more — and a Globals is not
  // an FNCS title for the year either.
  {
    const all = buildCriteria({ players: roster.players, facts, orgs }, { minMatches: 1, maxShare: 1 });
    const eu = all.find((criterion) => criterion.id === 'won-fncs:Europe');
    const y2023 = all.find((criterion) => criterion.id === 'won-fncs-in:2023');
    const cooper = roster.players.find((p) => p.name === 'Cooper' && facts.of(p.id).wins.global > 0);
    check(Boolean(eu), 'criteria: no "Won EU FNCS" rule');
    if (eu && cooper) {
      check(!eu.test(cooper), 'criteria: Cooper counts as an EU FNCS winner for the Copenhagen Globals');
    }
    if (y2023 && cooper) {
      check(!y2023.test(cooper), 'criteria: Cooper counts as a 2023 FNCS winner for the Globals');
    }

    // The rules added for Tic Tac Toe on 27 Sep 2026.
    const exact = [0, 1, 2, 3].map((n) => all.find((criterion) => criterion.id === `fncs-count:${n}`));
    const four = all.find((criterion) => criterion.id === 'fncs-count:4+');
    check(exact.every(Boolean) && Boolean(four), 'criteria: an exact FNCS count rule is missing');
    const counted = exact.reduce((sum, criterion) => sum + (criterion?.matches.length ?? 0), 0) + (four?.matches.length ?? 0);
    check(counted === roster.players.length, `criteria: the FNCS count rules cover ${counted} of ${roster.players.length}`);

    const peterbot = all.find((criterion) => criterion.id === 'fncs-with:Peterbot');
    const partners = peterbot?.matches.map((p) => p.id).sort().join(', ');
    check(partners === 'Bylah, Cold, Pollo, Ritual', `criteria: Peterbot's FNCS partners read ${partners ?? 'nothing'}`);
    const anchors = all.filter((criterion) => criterion.kind === 'fncs-with');
    notes.push(`criteria: "won an FNCS with" anchors — ${anchors.map((c) => c.short.replace('Won FNCS with ', '')).join(', ')}`);

    const backToBack = all.find((criterion) => criterion.id === 'fncs-back-to-back');
    check(Boolean(backToBack), 'criteria: no back-to-back FNCS rule');
    notes.push(`criteria: ${backToBack?.matches.length ?? 0} back-to-back FNCS winners`);
    // Majors back to back is its own rule (15 Oct 2026): Scroll and Skyboy won
    // EU's Major 1 and 2 of 2026 but lost the Summit between them.
    const majorsBackToBack = all.find((criterion) => criterion.id === 'majors-back-to-back');
    check(Boolean(majorsBackToBack), 'criteria: no back-to-back majors rule');
    if (roster.players.some((p) => p.id === 'Scroll')) {
      check(facts.backToBackWinners().has('Scroll') && !facts.majorBackToBackWinners().has('Scroll'), 'criteria: Scroll should have won the FNCS back to back and not majors');
    }
    notes.push(`criteria: ${majorsBackToBack?.matches.length ?? 0} back-to-back major winners`);

    // Podium needs the appendix cell's `podium`; a file from before it has none.
    const podiums = roster.players.some((p) => facts.of(p.id).podium.length > 0);
    const podium = all.find((criterion) => criterion.id === 'lan-podium');
    if (podiums) {
      check(Boolean(podium), 'criteria: facts.json has podiums but no "LAN podium" rule');
      const winners = all.find((criterion) => criterion.id === 'lan-winner');
      if (podium && winners) {
        check(winners.matches.every((p) => podium.test(p)), 'criteria: a LAN winner is not on a LAN podium');
      }
      notes.push(`criteria: ${podium?.matches.length ?? 0} players with a LAN podium`);
    } else {
      skipped.push('LAN podium (facts.json has no podium yet — run the appendix cell)');
    }
  }

  const easyPools = {
    answers: roster.exactly('easy', { eligible: facts.eligible(3) }),
    accepted: roster.players,
  };

  // A player who fits nothing must be rejected, not placed.
  {
    const board = ttt.generateBoard({ facts, orgs }, easyPools, 'easy', 'reject');
    if (board) {
      const game = ttt.createGame(board, 'easy');
      const misfit = players.find(
        (p) => !board.rows.some((row) => row.test(p)) && !board.cols.some((col) => col.test(p)),
      );
      if (misfit) {
        const result = ttt.submit(game, misfit);
        check(result.outcome.kind === 'rejected', `tic-tac-toe: ${misfit.name} fits nothing but was not rejected`);
      }
    }
  }

  // Hard must end the board once nine guesses cannot fill nine cells.
  {
    const board = ttt.generateBoard({ facts, orgs }, easyPools, 'hard', 'hard');
    if (board) {
      let game = ttt.createGame(board, 'hard');
      const misfit = players.find(
        (p) => !board.rows.some((row) => row.test(p)) && !board.cols.some((col) => col.test(p)),
      );
      if (misfit) {
        game = ttt.submit(game, misfit).state;
        check(game.status === 'lost', 'tic-tac-toe: hard survived a wasted guess');
      }
    }
  }

  // The grid builder (/analytics/grid) reads a board the way the generator
  // builds one: a generated board has nothing to say against it, the same
  // rule twice does, and a builder link rebuilds the same six rules.
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const answers = ttt.BANDS[difficulty].flatMap((band) => roster.exactly(band, { eligible: facts.eligible(3) }));
    const pools = { answers, accepted: roster.players };
    let flagged = 0;
    for (let seed = 0; seed < 10; seed++) {
      const board = ttt.generateBoard({ facts, orgs }, pools, difficulty, `inspect-${difficulty}-${seed}`);
      if (!board) continue;
      const report = ttt.inspectBoard(board, pools, difficulty);
      if (report.problems.length && report.problems.some((p) => !/^.+ fits \d+ cells/.test(p))) flagged++;
      if (seed === 0) {
        const twice = ttt.inspectBoard({ rows: board.rows, cols: [board.rows[0], ...board.cols.slice(1)] }, pools, difficulty);
        check(twice.problems.some((p) => p.includes('used twice')), `grid builder ${difficulty}: a rule used twice went unflagged`);
        const spec = ttt.readGridSpec(JSON.stringify({ rows: board.rows.map((r) => r.id), cols: board.cols.map((c) => c.id), level: difficulty }));
        const again = spec && ttt.boardFrom({ facts, orgs }, pools, spec.rows, spec.cols, spec.level);
        check(Boolean(again) && again!.rows.every((rule, i) => rule.id === board.rows[i].id), `grid builder ${difficulty}: a Play link did not rebuild its grid`);
      }
    }
    // The generator may relax a promise when nothing else builds; the reach cap
    // gives way first, so only the other promises are held here.
    check(flagged <= 1, `grid builder ${difficulty}: ${flagged} of 10 generated boards break a promise`);

    // The rules added 14 Oct 2026: every level has the user's picks, and only
    // Hard has the deep ones (Div Cups, Performance Evaluations, a year's money).
    const rules = ttt.boardRules({ facts, orgs }, pools, difficulty);
    const kinds = new Set(rules.map((rule) => rule.kind));
    const picks = ['fncs-format', 'fncs-years', 'young-winner', 'world-cup', 'globals-played'] as const;
    check(picks.every((kind) => kinds.has(kind)), `box fight ${difficulty}: missing ${picks.filter((kind) => !kinds.has(kind)).join(', ')}`);
    const deep = rules.filter((rule) => rule.deep).length;
    check(difficulty === 'hard' ? deep >= 10 : deep === 0, `box fight ${difficulty}: ${deep} deep rules`);
  }

  // ---- Connections
  // On a chosen tier, and on Random over the whole roster with the fame mix
  // the game passes there — the pool most people play and the one where an
  // exclusive draw would otherwise be all deep cuts.
  const everyone: CriteriaSource = {
    players: (['easy', 'medium', 'hard'] as const).flatMap((tier) =>
      roster.exactly(tier, { eligible: facts.eligible(3) }),
    ),
    facts,
    orgs,
  };
  for (const setup of [
    { name: 'medium', source, mix: undefined, seeds: 40, least: 35 },
    { name: 'random', source: everyone, mix: RANDOM_MIX, seeds: 20, least: 18 },
  ]) {
    const inPlay = buildCriteria(setup.source, { minMatches: 4, maxShare: 0.5 });
    let puzzles = 0;
    const tiers = { easy: 0, medium: 0, hard: 0 };
    for (let seed = 0; seed < setup.seeds; seed++) {
      const where = `connections ${setup.name}: puzzle ${seed}`;
      const puzzle = connections.generatePuzzle(setup.source, `c-${seed}`, setup.mix);
      if (!puzzle) continue;
      puzzles++;
      check(puzzle.board.length === 16, `${where} has ${puzzle.board.length} tiles`);
      const ids = new Set(puzzle.board.map((p) => p.id));
      check(ids.size === 16, `${where} repeats a player`);
      for (const player of puzzle.board) tiers[player.tier]++;

      let game = connections.createGame(puzzle);
      for (const group of puzzle.groups) {
        for (const player of group.players) game = connections.toggle(game, player);
        game = connections.submit(game);
      }
      check(game.status === 'won', `${where} rejected its own groups`);
      check(game.mistakes === 0, `${where} charged a mistake on perfect play`);
      check(connections.livesLeft(game) === connections.MAX_MISTAKES, `${where} lost a life`);

      // One way to split the sixteen.
      const ways = connections.solutions(puzzle, setup.source);
      check(ways === 1, `${where} splits ${ways} ways, not 1`);
      // And no group lands on a fifth player — five Poles beside a Poland group.
      const crowded = connections.crowded(puzzle, setup.source);
      check(crowded.length === 0, `${where} has a fifth player for "${crowded.join('", "')}"`);
      // "Has won a major" beside "has won an FNCS title": 164 of 165 in both.
      const groups = puzzle.groups.map((group) => inPlay.find((c) => c.id === group.id));
      if (groups.every((c) => c !== undefined)) {
        check(
          !hasNestedPair(groups as PlayerCriterion[], NEAR_NESTED),
          `${where} has two nearly identical groups (${puzzle.groups.map((g) => g.label).join(' / ')})`,
        );
      }
    }
    check(
      puzzles >= setup.least,
      `connections ${setup.name}: only ${puzzles} of ${setup.seeds} seeds produced a board`,
    );
    const dealt = Math.max(puzzles * 16, 1);
    notes.push(
      `connections ${setup.name}: ${puzzles} of ${setup.seeds} seeds produced a board; tiles ` +
        `${Math.round((tiers.easy / dealt) * 100)}% easy, ${Math.round((tiers.medium / dealt) * 100)}% medium, ` +
        `${Math.round((tiers.hard / dealt) * 100)}% hard`,
    );
  }

  // A near miss must report how many belonged to one group.
  {
    const puzzle = connections.generatePuzzle(source, 'near');
    if (puzzle) {
      let game = connections.createGame(puzzle);
      for (const player of puzzle.groups[0].players.slice(0, 3)) game = connections.toggle(game, player);
      game = connections.toggle(game, puzzle.groups[1].players[0]);
      game = connections.submit(game);
      check(game.near === 3, `connections: a three-of-four guess reported near=${game.near}`);
    }
  }
}

// ------------------------------------------------------- 11. Guess the Player
{
  const pool = gtp.answerable(roster.players);
  check(pool.length > 0, 'guess-the-player: nobody is answerable');
  notes.push(`guess-the-player: ${pool.length} answerable`);

  const extras: gtp.Extras = {
    fncsFinals: facts ? (id) => facts.of(id).fncsApps : undefined,
    together: teammates ? (a, b) => teammates.together(a, b) : undefined,
  };
  const columns = 6 + (facts ? 1 : 0) + (teammates ? 1 : 0);

  for (const mode of ['exact', 'direction'] as const) {
    const drawn = deal(pool, [], `gtp-${mode}`);
    if (!drawn) continue;
    const game = gtp.gameFor(drawn.pick, mode, extras);
    const won = gtp.submitGuess(game, drawn.pick);
    check(
      won.rows[0].attributes.length === columns,
      `guess-the-player: ${won.rows[0].attributes.length} columns, expected ${columns}`,
    );
    check(won.status === 'won', `guess-the-player: the correct guess did not win in ${mode}`);
    check(
      won.rows[0].attributes.every((attribute) => attribute.state === 'hit'),
      `guess-the-player: the secret player did not match itself on every attribute in ${mode}`,
    );
    check(
      won.rows[0].attributes.some((attribute) => attribute.key === 'status'),
      'guess-the-player: no status column',
    );
  }

  // Played together: a duo that has entered 100+ events is green both ways, a
  // pair that never has is red — and nothing is ever amber any more.
  if (teammates) {
    const peterbot = pool.find((p) => p.name === 'Peterbot');
    const pollo = pool.find((p) => p.name === 'Pollo');
    if (peterbot && pollo) {
      const cell = (guess: RosterPlayer, secret: RosterPlayer) =>
        gtp.compare(guess, secret, 'direction', extras).find((a) => a.key === 'together');
      notes.push(`guess-the-player: Pollo on Peterbot reads "${cell(pollo, peterbot)?.display}"`);
      check(cell(pollo, peterbot)?.state === 'hit', 'guess-the-player: Pollo is not green on Peterbot');
      check(cell(peterbot, pollo)?.state === 'hit', 'guess-the-player: Peterbot is not green on Pollo');
      const stranger = pool.find((p) => teammates.together(p.id, peterbot.id) === 0 && p.id !== peterbot.id);
      if (stranger) {
        check(cell(stranger, peterbot)?.state === 'miss', `guess-the-player: ${stranger.name} is green on Peterbot`);
      }
    }
  }
  for (const secret of pool.slice(0, 50)) {
    for (const guess of pool.slice(50, 70)) {
      const states = gtp.compare(guess, secret, 'direction', extras).map((a) => a.state as string);
      check(!states.includes('close'), 'guess-the-player: a cell came back amber');
    }
  }

  // Running out of guesses must lose.
  const drawn = deal(pool, [], 'gtp-lose');
  if (drawn) {
    let game = gtp.gameFor(drawn.pick, 'direction');
    const wrong = pool.filter((p: RosterPlayer) => p.id !== drawn.pick.id).slice(0, gtp.MAX_GUESSES);
    for (const player of wrong) game = gtp.submitGuess(game, player);
    check(game.status === 'lost', `guess-the-player: ${gtp.MAX_GUESSES} wrong guesses did not lose`);
  }
}

// ------------------------------------------------ 11b. Random's fame weighting
// Deal 3,000 secrets the way Random does and count the tiers. Each tier is its
// own no-repeat bag, so nobody may come round twice before their tier's bag
// empties, and nobody twice in a row ever.
{
  const pool = gtp.answerable(roster.players);
  let seen: string[] = [];
  const counts: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  const sinceRefill = new Map<string, Set<string>>();
  let last = '';
  let repeats = 0;
  let backToBack = 0;
  const draws = 3000;
  for (let i = 0; i < draws; i++) {
    const drawn = dealWeighted(pool, seen, (p) => p.tier, RANDOM_MIX, `mix-${i}`);
    if (!drawn) break;
    const tier = drawn.pick.tier;
    counts[tier]++;
    const bag = sinceRefill.get(tier) ?? new Set<string>();
    if (drawn.wrapped) bag.clear();
    if (bag.has(drawn.pick.id)) repeats++;
    bag.add(drawn.pick.id);
    sinceRefill.set(tier, bag);
    if (drawn.pick.id === last) backToBack++;
    last = drawn.pick.id;
    seen = drawn.seen;
  }
  check(repeats === 0, `random mix: ${repeats} players came round twice inside one cycle`);
  check(backToBack === 0, `random mix: ${backToBack} back-to-back repeats`);
  for (const tier of ['easy', 'medium', 'hard'] as const) {
    const share = counts[tier] / draws;
    check(
      Math.abs(share - RANDOM_MIX[tier]) < 0.04,
      `random mix: ${tier} is ${Math.round(share * 100)}% of draws, meant to be ${RANDOM_MIX[tier] * 100}%`,
    );
  }
  notes.push(
    `random mix over ${draws} Guess the Player deals: ` +
      `easy ${Math.round((counts.easy / draws) * 100)}%, medium ${Math.round((counts.medium / draws) * 100)}%, ` +
      `hard ${Math.round((counts.hard / draws) * 100)}% (default choice is ${DEFAULT_POOL.mode})`,
  );
}

// Choose → Europe, any difficulty leans like Random, on Europe's own tiers:
// dealt evenly it was mostly names nobody knows.
{
  const choice: PoolChoice = { ...DEFAULT_POOL, mode: 'custom', region: 'Europe', difficulty: 'any' };
  const players = resolvePool(roster, null, null, choice, gtp.answerable);
  let seen: string[] = [];
  const counts: Record<string, number> = { easy: 0, medium: 0, hard: 0 };
  const draws = 1500;
  for (let i = 0; i < draws; i++) {
    const drawn = dealSecret(players, seen, null, null, choice, `any-${i}`);
    if (!drawn) break;
    counts[drawn.pick.regionTier]++;
    seen = drawn.seen;
  }
  const even = Math.round((100 * players.filter((p) => p.regionTier === 'hard').length) / Math.max(1, players.length));
  const hard = Math.round((100 * counts.hard) / draws);
  check(Math.abs(counts.easy / draws - RANDOM_MIX.easy) < 0.05, `choose any: Europe's Easy is ${Math.round((100 * counts.easy) / draws)}% of draws`);
  notes.push(`choose Europe → any: ${hard}% deep cuts (an even draw would be ${even}%)`);
}

// A guess with no published birthday reads as a blank, never as age 0.
{
  const secret = gtp.answerable(roster.players)[0];
  const ageless = roster.players.find((p) => p.age === null);
  if (secret && ageless) {
    const age = gtp.compare(ageless, secret, 'direction').find((a) => a.key === 'age');
    check(age?.display === '—' && !age.direction, `guess-the-player: ${ageless.name} with no birthday reads "${age?.display}"`);
  }
}

// The Random buttons: something unplayed first, then something only tried, then anything.
{
  const puzzles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const status: Record<string, PuzzleStatus> = { a: 'won', b: 'tried' };
  const statusOf = (id: string) => status[id] ?? null;
  check(pickFresh(puzzles, statusOf)?.id === 'c', 'progress: Random did not prefer the unplayed puzzle');
  status.c = 'won';
  check(pickFresh(puzzles, statusOf)?.id === 'b', 'progress: Random did not fall back to a tried puzzle');
}

// List: FNCS winners by region are the regional finals, not the venue of a LAN.
if (facts) {
  const lists = buildListCriteria(roster, facts, pools, orgs, teammates);
  const na = lists.find((c) => c.id === 'fncs:North America');
  const kami = roster.players.find((p) => p.name === 'Kami' && p.countryName === 'Poland');
  if (na && kami) {
    check(!na.answers.some((a) => a.id === kami.id), 'list: Kami is an NA FNCS winner for the Raleigh Invitational');
  }
  check(
    !lists.some((c) => c.id.startsWith('won-in-year:') && /title/i.test(c.title)),
    'list: a year list still asks for "a title"',
  );

  // The age lists only hold players with a birthday; Peterbot won at 14.
  const young = lists.find((c) => c.id === 'fncs-age:under:15');
  check(Boolean(young?.answers.some((a) => a.name === 'Peterbot')), 'list: Peterbot is not an FNCS winner before 15');
  for (const c of lists.filter((c) => c.id.startsWith('fncs-age:'))) {
    check(
      c.answers.every((a) => roster.players.find((p) => p.id === a.id)?.birthDate),
      `list: "${c.title}" has a player with no birthday`,
    );
  }
  for (const c of lists.filter((c) => c.id.startsWith('country-lan:'))) {
    const country = c.id.slice('country-lan:'.length);
    check(
      c.answers.every((a) => facts.of(a.id).lanApps > 0 && roster.players.find((p) => p.id === a.id)?.countryName === country),
      `list: "${c.title}" has a player from elsewhere or with no LAN`,
    );
  }

  // The season: the user's worked example is Vico, 1 + 3 + 1 + 3 + 20 = 28, an average of 5.6.
  const season = facts.season;
  if (!season) {
    skipped.push('list: the season lists (facts.json has no season block — run build_data.py)');
  } else {
    const vico = season.results.get('Vic0try0na');
    check(
      vico?.map((r) => r?.finish).join(',') === '1,3,1,3,20',
      `list: Vic0try0na's 2026 finishes are ${vico?.map((r) => r?.finish).join(',')}, not 1,3,1,3,20`,
    );
    const all = lists.find((c) => c.id === `season:${season.year}:all`);
    check(Boolean(all?.answers.some((a) => a.id === 'Vic0try0na')), 'list: Vic0try0na did not play all five');
    // The top tens are Tenaball boards now, not lists.
    check(!lists.some((c) => c.id.startsWith(`season:${season.year}:top`)), 'list: a season top 10 is still a list');
    notes.push(`list: ${all?.title} — ${all?.answers.length} players`);
  }
}

// ------------------------------------------------------------------ Pyramid
if (facts) {
  /** Swaps a game into the right order, the way a player would. */
  const solve = (game: pyramid.GameState): pyramid.GameState => {
    for (let i = 0; i < pyramid.SIZE; i++) {
      const j = game.order.findIndex((item, k) => k >= i && item.value === game.puzzle.items[i].value);
      game = pyramid.swap(game, i, j);
    }
    return game;
  };
  /** One pyramid, whatever made it: ten in order, a fair start, and the tie rule. Returns its level pairs. */
  const checkPuzzle = (puzzle: pyramid.Puzzle, level: pyramid.Difficulty, seed: string): number => {
    const tag = `pyramid ${level}: "${puzzle.title}"`;
    const values = puzzle.items.map((item) => item.value);
    check(puzzle.items.length === pyramid.SIZE, `${tag} has ${puzzle.items.length} items`);
    check(new Set(puzzle.items.map((item) => item.id)).size === pyramid.SIZE, `${tag} repeats an item`);
    // Best first: most at the top, or the smallest for a finish or an age.
    check(
      values.every((value, i) => i === 0 || (puzzle.lowFirst ? value >= values[i - 1] : value <= values[i - 1])),
      `${tag} is not in order`,
    );
    if (puzzle.id.startsWith('tournament:')) check(new Set(values).size === pyramid.SIZE, `${tag} has two teams on one place`);
    // Never three on one value; a share category never level, and never a coin flip.
    const perValue = new Map<number, number>();
    for (const value of values) perValue.set(value, (perValue.get(value) ?? 0) + 1);
    check(Math.max(...perValue.values()) <= 2, `${tag} has three players on one value`);
    if (puzzle.id === 'age') {
      const days = pyramid.LEVELS[level].days;
      check(values.every((value, i) => i === 0 || Math.abs(value - values[i - 1]) >= days), `${tag} has two birthdays under ${days} days apart`);
    }
    if (puzzle.id.startsWith('earnings')) {
      const gap = pyramid.LEVELS[level].gap;
      check(
        values.every((value, i) => i === 0 || Math.min(value, values[i - 1]) <= Math.max(value, values[i - 1]) * (1 - gap) + 1e-9),
        `${tag} has two values closer than ${gap * 100}%`,
      );
    }

    // The start gives nothing away; sorted and checked, it wins on the first check.
    const fresh = pyramid.createGame(puzzle, level, `o-${seed}`);
    check(pyramid.inPlace(fresh) <= 1, `${tag} starts with ${pyramid.inPlace(fresh)} in place`);
    const won = pyramid.check(solve(fresh));
    check(won.status === 'won' && won.checks === 1, `${tag} sorted right read ${won.status}`);
    // A level pair is right either way round.
    const pair = values.findIndex((value, i) => i > 0 && value === values[i - 1]);
    if (pair > 0) {
      const flipped = pyramid.check(pyramid.swap(solve(fresh), pair - 1, pair));
      check(flipped.status === 'won', `${tag} refused a level pair the other way round`);
    }
    return [...perValue.values()].filter((n) => n === 2).length;
  };

  for (const level of ['easy', 'medium', 'hard'] as const) {
    let built = 0;
    let pairs = 0;
    let deep = 0;
    const kinds = new Map<string, number>();
    for (let seed = 0; seed < 40; seed++) {
      const puzzle = pyramid.generatePuzzle(roster, facts, rankings, level, `p-${level}-${seed}`, null, majors);
      if (!puzzle) continue;
      built++;
      const kind = puzzle.id.replace(/:\d{4}$/, ':year').replace(/^tournament:.*/, 'tournament');
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      // Tournaments draw ten from the field, not the top ten every time.
      if (kind === 'tournament' && puzzle.items.some((item, i) => item.value !== i + 1)) deep++;
      pairs += checkPuzzle(puzzle, level, String(seed));
    }
    check(built >= 38, `pyramid ${level}: only ${built} of 40 seeds made a pyramid`);
    if (majors && kinds.get('tournament')) {
      check(deep > 0, `pyramid ${level}: every tournament pyramid was the top ten`);
    }
    notes.push(
      `pyramid ${level}: ${built}/40 built, ${pairs} level pairs; ` +
        [...kinds].sort((a, b) => b[1] - a[1]).map(([kind, n]) => `${kind} ${n}`).join(', '),
    );
  }

  // Every player category in the draw builds on every level, not just the ones
  // the forty seeds above happen to pick; the hidden ones are never drawn.
  {
    const categories = pyramid.playerCategories(roster, facts, null).flat();
    const hidden = new Set(categories.filter((category) => category.hidden).map((category) => category.id));
    // The user, 14 Oct 2026: "remove category lan appearances for now".
    check(hidden.has('lan-apps'), 'pyramid: LAN appearances is back in the draw');
    for (let seed = 0; seed < 300; seed++) {
      const level = (['easy', 'medium', 'hard'] as const)[seed % 3];
      const puzzle = pyramid.generatePuzzle(roster, facts, rankings, level, `h-${seed}`, null, majors);
      check(!puzzle || !hidden.has(puzzle.id), `pyramid ${level}: drew the hidden "${puzzle?.title}"`);
    }
    const rates: string[] = [];
    for (const category of categories) {
      if (category.hidden) continue;
      const built = (['easy', 'medium', 'hard'] as const).map((level) => {
        let n = 0;
        for (let seed = 0; seed < 20; seed++) {
          const puzzle = pyramid.playerPuzzle(category, roster, level, makeRng(`c-${category.id}-${level}-${seed}`));
          if (!puzzle) continue;
          n++;
          checkPuzzle(puzzle, level, `c-${seed}`);
        }
        return n;
      });
      check(built.every((n) => n === 20), `pyramid: "${category.title}" built ${built.join('/')} of 20 on Easy/Medium/Hard`);
      if (!category.id.startsWith('earnings:')) rates.push(`${category.id} ${built.join('/')}`);
    }
    // Of the categories tried on 14 Oct 2026 only age stayed.
    check(categories.some((category) => category.id === 'age' && !category.hidden), 'pyramid: no age category');
    for (const id of ['fncs-podiums', 'fncs-top10s', 'globals-avg']) {
      check(!categories.some((category) => category.id === id), `pyramid: "${id}" is back`);
    }
    notes.push(`pyramid categories, built of 20 on Easy/Medium/Hard: ${rates.join(', ')}; hidden: ${[...hidden].join(', ')}`);
  }

  // Lives: Hard ends on the first imperfect check, Medium on the second, Easy never.
  const puzzle = pyramid.generatePuzzle(roster, facts, rankings, 'easy', 'lives')!;
  const unsorted = (level: pyramid.Difficulty) => {
    let game = pyramid.createGame(puzzle, level, 'lives');
    // Make sure it is not already right.
    if (pyramid.inPlace(game) === pyramid.SIZE) game = pyramid.swap(game, 0, 1);
    return game;
  };
  check(pyramid.check(unsorted('hard')).status === 'lost', 'pyramid: hard survived an imperfect check');
  const medium = pyramid.check(unsorted('medium'));
  check(medium.status === 'playing' && medium.lives === 1, 'pyramid: medium lost on the first imperfect check');
  check(pyramid.check(medium).status === 'lost', 'pyramid: medium survived a second imperfect check');
  let easy = unsorted('easy');
  for (let i = 0; i < 5; i++) easy = pyramid.check(easy);
  check(easy.status === 'playing', 'pyramid: easy ran out of checks');
  // What a check locks stays put; what it marks wrong loses the mark once moved.
  const locked = [...easy.locked][0];
  if (locked) {
    const at = easy.order.findIndex((item) => item.id === locked);
    const other = easy.order.findIndex((item) => !easy.locked.has(item.id));
    check(pyramid.swap(easy, at, other) === easy, 'pyramid: a locked player moved');
  }
  const [a, b] = easy.order.map((item, i) => (easy.wrong.has(item.id) ? i : -1)).filter((i) => i >= 0);
  if (b !== undefined) {
    const moved = pyramid.swap(easy, a, b);
    check(!moved.wrong.has(easy.order[a].id), 'pyramid: a moved player kept its red mark');
  }
}

// -------------------------------------------------------------------- Bingo
if (facts && orgs) {
  const source = { facts, orgs, teammates, roster: roster.players };
  const eligible = facts.eligible(3);
  const bandOf = (level: bingo.Difficulty) => bingo.LEVELS[level].bands.flatMap((band) => roster.exactly(band, { eligible }));
  for (const level of ['easy', 'medium', 'hard'] as const) {
    const answers = bandOf(level);
    const kinds = new Map<string, number>();
    let built = 0;
    let decoys = 0;
    for (let seed = 0; seed < 25; seed++) {
      const board = bingo.generateBoard(source, { answers }, level, `bingo-${level}-${seed}`);
      if (!board) continue;
      built++;
      const tag = `bingo ${level}: card ${seed}`;
      check(board.squares.length === bingo.SQUARES, `${tag} has ${board.squares.length} squares`);
      check(new Set(board.squares.map((sq) => sq.id)).size === bingo.SQUARES, `${tag} repeats a square`);
      const perKind = new Map<string, number>();
      for (const sq of board.squares) {
        perKind.set(sq.kind, (perKind.get(sq.kind) ?? 0) + 1);
        kinds.set(sq.kind, (kinds.get(sq.kind) ?? 0) + 1);
      }
      check(Math.max(...perKind.values()) <= 2, `${tag} has three squares of one kind`);
      const most = Math.max(...answers.map((player) => board.squares.filter((sq) => sq.test(player)).length));
      check(most <= bingo.MAX_REACH, `${tag} lets one player fit ${most} squares`);
      for (let i = 0; i < board.squares.length; i++) {
        for (let j = i + 1; j < board.squares.length; j++) {
          check(!isNested(board.squares[i], board.squares[j], NEAR_NESTED), `${tag}: "${board.squares[i].short}" and "${board.squares[j].short}" are nearly the same`);
        }
      }
      // The deck: the level's size, no one twice, every square covered, and a full
      // card in it that survives losing any one player.
      check(board.deck.length === bingo.LEVELS[level].deck, `${tag} deals ${board.deck.length} players`);
      check(new Set(board.deck.map((p) => p.id)).size === board.deck.length, `${tag} deals a player twice`);
      board.squares.forEach((sq) => {
        const cover = board.deck.filter((p) => sq.test(p)).length;
        check(cover >= bingo.LEVELS[level].cover, `${tag}: "${sq.short}" has ${cover} players in the deck`);
      });
      check(bingo.robust(board.squares, board.deck), `${tag} has a player the full card cannot do without`);
      decoys += board.deck.filter((p) => !board.squares.some((sq) => sq.test(p))).length;
      const full = bingo.fullCard(board.squares, board.deck);

      // A perfect round: each player the full card needs goes to their square, the rest are skipped.
      if (full) {
        const plan = new Map([...full].map(([square, player]) => [player.id, square]));
        let game = bingo.createGame(board, level);
        while (game.status === 'playing') {
          const player = bingo.current(game)!;
          const square = plan.get(player.id);
          game = square === undefined ? bingo.skip(game) : bingo.place(game, square)!.state;
        }
        check(
          game.filled.size === bingo.SQUARES && bingo.lines(game).length === bingo.LINES.length && game.wrong.length === 0,
          `${tag}: a perfect round filled ${game.filled.size} squares`,
        );
        check(bingo.outcomeOf(game) === 'won', `${tag}: a full card read ${bingo.outcomeOf(game)}`);
      }
    }
    check(built >= 24, `bingo ${level}: only ${built} of 25 seeds made a card`);
    notes.push(`bingo ${level}: ${built}/25 cards, ${bingo.LEVELS[level].deck}-player decks with ${(decoys / Math.max(built, 1)).toFixed(1)} who fit nothing; ${[...kinds].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  }

  // A wrong square costs a life and the player; skipping costs nothing; the deck running out ends it.
  const board = bingo.generateBoard(source, { answers: bandOf('hard') }, 'hard', 'bingo-lives')!;
  const wrongSquare = (game: bingo.GameState) =>
    board.squares.findIndex((sq, i) => !game.filled.has(i) && !sq.test(bingo.current(game)!));
  let game = bingo.createGame(board, 'hard');
  while (game.status === 'playing' && wrongSquare(game) < 0) game = bingo.skip(game);
  if (game.status === 'playing') {
    const missed = bingo.place(game, wrongSquare(game))!;
    check(missed.outcome.kind === 'wrong' && bingo.livesLeft(missed.state) === bingo.LEVELS.hard.lives - 1, 'bingo: a wrong square did not cost one life');
    check(missed.state.turn === game.turn + 1, 'bingo: a wrong square did not move to the next player');
  }
  let skipped = bingo.createGame(board, 'hard');
  while (skipped.status === 'playing') skipped = bingo.skip(skipped);
  check(skipped.skipped === board.deck.length && bingo.livesLeft(skipped) === bingo.LEVELS.hard.lives, 'bingo: skipping cost something');
  check(bingo.outcomeOf(skipped) === 'lost', `bingo: skipping the whole deck read ${bingo.outcomeOf(skipped)}`);
  check(bingo.timeLeft(game) === null && bingo.tick(bingo.createGame(board, 'hard'), 1e6).status === 'playing', 'bingo: a Deck round has a clock');

  // The user's sizes and clocks (14 Oct 2026: "40-35-30", and "60-90-120" with
  // the easier level given the longer clock), and the rules panel saying so.
  const levels = ['easy', 'medium', 'hard'] as const;
  check(
    levels.map((level) => bingo.LEVELS[level].deck).join() === '40,35,30',
    `bingo: decks of ${levels.map((level) => bingo.LEVELS[level].deck).join('/')}, not 40/35/30`,
  );
  check(
    levels.map((level) => bingo.LEVELS[level].seconds).join() === '120,105,90',
    `bingo: clocks of ${levels.map((level) => bingo.LEVELS[level].seconds).join('/')}s, not 120/105/90`,
  );
  const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const difficultyRules = getGame('bingo')?.sections?.find((section) => section.title === 'Difficulty')?.items ?? [];
  levels.forEach((level, i) => {
    const { deck, seconds, lives } = bingo.LEVELS[level];
    const line = difficultyRules[i] ?? '';
    check(
      line.includes(String(deck)) && line.includes(clockText(seconds)) && line.includes(`${lives} lives`),
      `bingo: the rules' ${level} line does not say ${deck} players, ${clockText(seconds)} and ${lives} lives`,
    );
  });

  // Timed and Endless: no deck, the band to draw from, and a good round wins.
  // Each player who fits goes on the open square with the fewest answers in
  // the band, the rest are skipped, four deals a second.
  for (const level of levels) {
    const answers = bandOf(level);
    const deals: number[] = [];
    let repeats = 0;
    for (let seed = 0; seed < 12; seed++) {
      const mode = seed % 2 ? 'endless' : 'timed';
      const tag = `bingo ${level} ${mode}: card ${seed}`;
      const board = bingo.generateBoard(source, { answers }, level, `bingo-stream-${level}-${seed}`, mode);
      if (!board) {
        check(false, `${tag} was not built`);
        continue;
      }
      check(
        board.mode === mode && board.deck.length === 0 && board.band.length === answers.length && board.squares.length === bingo.SQUARES,
        `${tag}: ${board.squares.length} squares, a deck of ${board.deck.length}, a band of ${board.band.length}`,
      );
      board.candidates.forEach((who, i) =>
        check(who.length >= bingo.LEVELS[level].answers, `${tag}: "${board.squares[i].short}" has ${who.length} answers in the band`),
      );
      let game = bingo.createGame(board, level);
      const seen = new Set<string>();
      let previous: string | null = null;
      while (game.status === 'playing') {
        game = bingo.tick(game, game.turn / 4);
        const player = bingo.current(game);
        if (!player) break;
        check(player.id !== previous, `${tag}: ${player.name} was dealt twice in a row`);
        if (seen.has(player.id)) repeats++;
        seen.add(player.id);
        previous = player.id;
        const fits = bingo.fitting(game, player).sort((a, b) => board.candidates[a].length - board.candidates[b].length);
        game = fits.length ? bingo.place(game, fits[0])!.state : bingo.skip(game);
      }
      check(bingo.outcomeOf(game) === 'won' && game.wrong.length === 0, `${tag}: a good round ended ${bingo.outcomeOf(game)} on ${game.filled.size} squares`);
      check(
        bingo.score(game) === (mode === 'timed' ? Math.round(game.elapsed * 10) / 10 : game.turn),
        `${tag}: a full card scored ${bingo.score(game)}`,
      );
      check(bingo.record(game).r.deck === 0 && bingo.record(game).r.dealt === game.turn, `${tag}: the record says a deck of ${bingo.record(game).r.deck}`);
      deals.push(game.turn);
    }
    deals.sort((a, b) => a - b);
    notes.push(
      `bingo ${level} stream: a good round fills the card in ${deals[0]}–${deals[deals.length - 1]} players (median ${deals[deals.length >> 1]}), ${repeats} repeats in all; clock ${clockText(bingo.LEVELS[level].seconds)}`,
    );

    /*
     * The lean towards open squares: with one open, most players fit it but not
     * all, so a skip still matters; never the same player twice in a row. The
     * open squares are picked at random, the rest filled with anyone.
     */
    const shares: string[] = [];
    for (const open of [1, 2, 4]) {
      let fit = 0;
      let drawn = 0;
      for (let seed = 0; seed < 6; seed++) {
        const board = bingo.generateBoard(source, { answers }, level, `bingo-share-${level}-${seed}`, 'endless')!;
        const rng = makeRng(`bingo-share-${level}-${open}-${seed}`);
        const shut = shuffle(rng, board.squares.map((_, i) => i)).slice(open);
        const filled = new Map<number, RosterPlayer>(shut.map((square) => [square, answers[0]]));
        let previous: RosterPlayer | null = null;
        for (let i = 0; i < 500; i++) {
          const player: RosterPlayer = bingo.drawNext(board, filled, previous, rng)!;
          check(player.id !== previous?.id, `bingo ${level}: the stream dealt ${player.name} twice in a row`);
          if (board.squares.some((square, index) => !filled.has(index) && square.test(player))) fit++;
          drawn++;
          previous = player;
        }
      }
      const share = fit / drawn;
      check(share >= bingo.fitShare(open) - 0.05 && share < 0.95, `bingo ${level}: with ${open} open, ${(share * 100).toFixed(0)}% of the stream fits one`);
      if (open === 1) check(share >= 0.65 && share <= 0.85, `bingo ${level}: with one square open ${(share * 100).toFixed(0)}% fit it, not about three in four`);
      shares.push(`${open} open ${(share * 100).toFixed(0)}% (at least ${(bingo.fitShare(open) * 100).toFixed(0)}%)`);
    }
    notes.push(`bingo ${level} stream: fitting share ${shares.join(', ')}`);

    // The clock: still playing a tenth before the end, over at it, and no move after.
    const timed = bingo.generateBoard(source, { answers }, level, `bingo-clock-${level}`, 'timed')!;
    const seconds = bingo.LEVELS[level].seconds;
    const fresh = bingo.createGame(timed, level);
    const nearly = bingo.tick(fresh, seconds - 0.1);
    const late = bingo.tick(nearly, seconds);
    check(bingo.timeLeft(fresh) === seconds && nearly.status === 'playing', `bingo ${level}: the clock is ${bingo.timeLeft(fresh)}s, or ended early`);
    check(
      late.status === 'over' && late.timedOut && bingo.timeLeft(late) === 0 && bingo.outcomeOf(late) === 'lost',
      `bingo ${level}: the clock ran out and the round read ${late.status}, ${bingo.outcomeOf(late)}`,
    );
    check(bingo.place(late, 0) === null && bingo.skip(late) === late, `bingo ${level}: a move after the clock ran out was taken`);
    const endless = bingo.createGame(bingo.generateBoard(source, { answers }, level, `bingo-clock-${level}`, 'endless')!, level);
    check(bingo.timeLeft(endless) === null && bingo.tick(endless, 1e6).status === 'playing', `bingo ${level}: Endless has a clock`);
  }

  // A stream's lives: every player put on a square they do not fit, until they are gone.
  {
    const board = bingo.generateBoard(source, { answers: bandOf('hard') }, 'hard', 'bingo-stream-lives', 'endless')!;
    let game = bingo.createGame(board, 'hard');
    for (let turn = 0; game.status === 'playing' && turn < 500; turn++) {
      const player = bingo.current(game)!;
      const wrong = board.squares.findIndex((sq, i) => !game.filled.has(i) && !sq.test(player));
      game = wrong < 0 ? bingo.skip(game) : bingo.place(game, wrong)!.state;
    }
    check(
      game.status === 'over' && game.wrong.length === bingo.LEVELS.hard.lives && bingo.outcomeOf(game) === 'lost',
      `bingo: an Endless round of wrong squares ended ${game.status} after ${game.wrong.length} misses`,
    );
  }

  // "10+ events with X" says which X when the handle is shared anywhere on the
  // roster (the user, 14 Oct 2026: three players are called Chap). The shared
  // "Won FNCS with X" judges against the level's band only, so it is noted
  // rather than failed here.
  if (teammates) {
    const sharing = (name: string) => roster.players.filter((p) => p.name.toLowerCase() === name.toLowerCase()).length;
    const anchorOf = (rule: { short: string }) => rule.short.replace(/^(10\+ events with|Won FNCS with) /, '');
    for (const level of levels) {
      const named = bingo
        .bingoCriteria({ ...source, players: bandOf(level) }, bingo.LEVELS[level].answers)
        .filter((rule) => rule.kind === 'played-with' || rule.kind === 'fncs-with');
      const vague = named.filter((rule) => sharing(anchorOf(rule)) > 1);
      const own = vague.filter((rule) => rule.kind === 'played-with');
      check(own.length === 0, `bingo ${level}: ${own.map((rule) => `"${rule.short}"`).join(', ')} does not say which player`);
      const which = named.filter((rule) => rule.short.endsWith(')')).map(anchorOf);
      notes.push(
        `bingo ${level}: ${named.length} squares naming a player, ${which.length} saying which (${[...new Set(which)].join(', ') || 'none'})` +
          (vague.length ? `; shared and not saying which: ${vague.map((rule) => `"${rule.short}"`).join(', ')}` : ''),
      );
    }
  }
}

// ------------------------------------------------------- the October games
// Seven games from the user's 2 Oct 2026 roadmaps, all hidden. Each is dealt
// many times at every level and played through its own engine.
const bios = await loadBios();
notes.push(
  bios.dated
    ? `bios: bios.json — ${roster.players.filter((p) => bios.realName(p.id)).length} real names, stints for ${roster.players.filter((p) => bios.stintsOf(p.id).length).length} players`
    : 'bios: no bios.json yet — names from players.json, undated stints from orgs.json',
);
if (bios.dated) {
  for (const player of roster.players.slice(0, 2000)) {
    const days = bios.stintsOf(player.id).map((stint) => stint.from ?? stint.to ?? '9999');
    check(days.every((day, i) => i === 0 || days[i - 1] <= day), `bios: ${player.name}'s stints are not oldest first`);
  }
} else {
  skipped.push('bios.json (IRL, Org Chart and Transfer Window play on the fallback; run scripts/build_data.py)');
}

/** A wrong guess for a clue round: anyone but the answer, never the same one twice. */
const wrongs = (secretId: string) => roster.players.filter((p) => p.id !== secretId);

/** Plays a clue round out wrong, and checks it lasts exactly its clues plus spares. */
function checkClueRound<R extends ClueRound<Named, unknown>>(round: R, tag: string, others: Named[]) {
  const expected = Math.max(round.clues.length, round.minGuesses);
  let state = round;
  let made = 0;
  while (state.status === 'playing' && made < expected + 3) state = clueGuess(state, others[made++]);
  check(state.status === 'lost' && made === expected, `${tag}: lost after ${made} wrong guesses, expected ${expected}`);
  const won = clueGuess(clueSkip(round), round.secret);
  check(won.status === 'won' && won.earned === Math.min(2, round.clues.length), `${tag}: the right guess on clue 2 did not win there`);
}

// Curveball: every curve is a run of years, first and last with prize money.
{
  for (const level of LEVEL_IDS) {
    const pool = levelPlayers(roster, level, curveball.eligible);
    check(pool.length >= 50, `curveball ${level}: only ${pool.length} players to deal`);
    const rng = makeRng(`curve-${level}`);
    let years = 0;
    for (let i = 0; i < 40; i++) {
      const secret = pool[Math.floor(rng() * pool.length)];
      const game = curveball.createGame(secret);
      const points = game.clues;
      years += points.length;
      const tag = `curveball ${level} ${secret.name}`;
      check(points.length >= curveball.MIN_YEARS, `${tag}: a curve of ${points.length} years`);
      check(points[0].earnings > 0 && points[points.length - 1].earnings > 0, `${tag}: the curve starts or ends on an empty year`);
      check(points.every((p, j) => j === 0 || p.year === points[j - 1].year + 1), `${tag}: the years are not consecutive`);
      check(
        points.every((p) => p.earnings === (secret.earningsByYear[p.year] ?? 0)),
        `${tag}: a year's prize money is not the roster's`,
      );
      if (i < 3) checkClueRound(game, tag, wrongs(secret.id));
    }
    notes.push(`curveball ${level}: ${pool.length} players, curves of ${(years / 40).toFixed(1)} years on average`);
  }

  // The axis: fixed, rising, room for the richest year, $500K and $600K apart,
  // and the small earners still off the floor.
  const { heightOf, AXIS } = curveball;
  const grid = [0, 50, 100, 500, 1_000, 5_000, 20_000, 100_000, 500_000, 999_999, 1_000_000, 1_000_001, 2_000_000, 5_000_000];
  check(heightOf(0) === 0 && Math.abs(heightOf(AXIS.max) - 1) < 1e-9, 'curveball: the axis does not run from $0 to its top');
  check(grid.every((v, i) => i === 0 || heightOf(v) > heightOf(grid[i - 1])), 'curveball: the axis does not rise with the money');
  const richest = Math.max(...roster.players.flatMap((p) => Object.values(p.earningsByYear)));
  check(richest <= AXIS.max, `curveball: a year of ${richest} is off the top of the axis`);
  const apart = heightOf(600_000) - heightOf(500_000);
  check(apart >= 0.04, `curveball: $500K and $600K only ${(apart * 100).toFixed(1)}% of the height apart`);
  check(heightOf(1_000) >= 0.08, `curveball: a $1K year sits ${(heightOf(1_000) * 100).toFixed(1)}% up`);
  const hard = levelPlayers(roster, 'hard', curveball.eligible);
  const paid = hard.flatMap((p) => curveball.curveOf(p).map((pt) => pt.earnings)).filter((v) => v > 0);
  const floored = paid.filter((v) => heightOf(v) < 0.05).length / paid.length;
  const peaks = hard.map((p) => heightOf(Math.max(...curveball.curveOf(p).map((pt) => pt.earnings)))).sort((a, b) => a - b);
  const medianPeak = peaks[Math.floor(peaks.length / 2)];
  check(floored < 0.1, `curveball hard: ${(floored * 100).toFixed(1)}% of paid years sit on the floor`);
  check(medianPeak >= 0.12, `curveball hard: the typical curve peaks only ${(medianPeak * 100).toFixed(0)}% up`);
  notes.push(
    `curveball axis: $500K–$600K ${(apart * 100).toFixed(1)}% of the height apart, $1K ${(heightOf(1_000) * 100).toFixed(0)}% up; ` +
      `Hard: ${(floored * 100).toFixed(1)}% of paid years within 5% of the floor, the typical curve peaks ${(medianPeak * 100).toFixed(0)}% up`,
  );
}

// Org Chart: famous players never open a round, and the facts sit where promised.
if (orgs) {
  const sizes: string[] = [];
  for (const level of LEVEL_IDS) {
    const pool = orgChart.orgPool(orgs, roster, level);
    check(pool.length >= Math.min(orgChart.LEVELS[level].top, 100), `org-chart ${level}: only ${pool.length} orgs`);
    sizes.push(`${level} ${pool.length}`);
    for (let i = 0; i < 30; i++) {
      const org = pool[i % pool.length];
      for (const style of ['dates', 'joined', 'names'] as const) {
        const game = orgChart.createGame(org, roster, bios, style, `oc-${level}-${i}`);
        const tag = `org-chart ${level} ${org.name}`;
        const players = game.clues.flatMap((c) => (c.kind === 'player' ? [c.player] : []));
        check(players.length >= orgChart.MIN_MEMBERS, `${tag}: only ${players.length} player clues`);
        check(new Set(players.map((p) => p.id)).size === players.length, `${tag}: a player twice`);
        const famous = [...players].sort((a, b) => b.earnings - a.earnings).slice(0, orgChart.HELD_BACK);
        const firstThree = game.clues.slice(0, orgChart.OPENING);
        // The org's two best-known players overall are the ones held back.
        check(
          !firstThree.some((c) => c.kind === 'player' && famous.includes(c.player) && players.length > orgChart.OPENING + orgChart.HELD_BACK),
          `${tag}: a famous player in the first three clues`,
        );
        check(game.clues[0].kind === 'player', `${tag}: opens on a fact`);
        check(bios.dated || game.style === 'names', `${tag}: dates without dated stints`);
        if (i === 0 && style === 'dates') checkClueRound(game, tag, orgs.orgs.filter((o) => o.id !== org.id));
      }
    }
    // A full hand wherever the org has the players for it, and the facts where promised.
    const onRoster = new Set(roster.players.map((p) => p.id));
    let eight = 0;
    for (const org of pool) {
      const members = new Set([...org.ever, ...bios.membersOf(org.id).keys()].filter((id) => onRoster.has(id))).size;
      const game = orgChart.createGame(org, roster, bios, 'names', `oc-full-${org.id}`);
      const tag = `org-chart ${level} ${org.name}`;
      const players = game.clues.filter((c) => c.kind === 'player').length;
      check(players === Math.min(orgChart.PLAYER_CLUES, members), `${tag}: ${players} player clues from ${members} players`);
      if (players === orgChart.PLAYER_CLUES) eight++;
      const before = (id: string) => {
        const at = game.clues.findIndex((c) => c.kind === 'fact' && c.id === id);
        return at < 0 ? null : game.clues.slice(0, at).filter((c) => c.kind === 'player').length;
      };
      const region = before('region');
      const founded = before('founded');
      check(region === null || region === orgChart.REGION_AFTER, `${tag}: the region after ${region} players`);
      check(founded === null || founded === Math.min(orgChart.FOUNDED_AFTER, players), `${tag}: the founding year after ${founded} players`);
      const last = game.clues[game.clues.length - 1];
      check(!(org.earnings > 0) || (last.kind === 'fact' && last.id === 'earnings'), `${tag}: the prize money is not last`);
    }
    notes.push(`org-chart ${level}: ${eight} of ${pool.length} orgs get ${orgChart.PLAYER_CLUES} players`);
  }
  notes.push(`org-chart: orgs per level — ${sizes.join(', ')}`);
}

// Contextinho: the secret is #1, the ranks are a permutation, and a hint halves your best.
// Every Easy secret, because the partners the user called the biggest clues
// (14 Oct 2026) are promised a place near the top on the default weights.
if (teammates) {
  const context = { teammates, orgs, facts, majors };
  const pool = levelPlayers(roster, 'easy', contextinho.eligible(teammates));
  check(pool.length >= 50, `contextinho easy: only ${pool.length} players`);
  let mateRank = 0;
  let tried = 0;
  const partnerRanks: number[] = [];
  for (const secret of pool) {
    const ranking = contextinho.rankAll(secret, roster.players, contextinho.DEFAULT_WEIGHTS, context);
    const ranks = [...ranking.values()].map((s) => s.rank).sort((a, b) => a - b);
    check(ranking.get(secret.id)?.rank === 1, `contextinho: ${secret.name} is not #1 against themselves`);
    check(ranks.every((r, i) => r === i + 1), `contextinho: ${secret.name}'s ranks are not 1..${ranks.length}`);
    const [mate] = teammates.matesOf(secret.id).filter(([id]) => ranking.has(id));
    if (mate) {
      mateRank += ranking.get(mate[0])!.rank;
      tried++;
    }
    // An FNCS won together lands in the hot band (top 25), two or more in the top 10.
    for (const [id, titles] of facts?.fncsTitlesWith(secret.id) ?? []) {
      const entry = ranking.get(id);
      if (!entry) continue;
      partnerRanks.push(entry.rank);
      const bound = titles >= 2 ? 10 : 25;
      check(entry.rank <= bound, `contextinho: ${secret.name}'s FNCS partner ${entry.player.name} (${titles} together) ranks #${entry.rank}, not top ${bound}`);
    }
    for (const entry of ranking.values()) {
      // Teammates at two big events, or on a podium at one (a full `stage`), are in the top 10.
      if (entry.rank > 1 && entry.parts.stage === 1) {
        check(entry.rank <= 10, `contextinho: ${entry.player.name}, ${secret.name}'s partner at two big events or on a podium, ranks #${entry.rank}`);
      }
      // A big event won together — a World Cup, a Globals — is one of the three closest (#2–#4).
      if (entry.rank > 1 && entry.parts.champions >= 1) {
        check(entry.rank <= 4, `contextinho: ${entry.player.name}, who won a big event with ${secret.name}, ranks #${entry.rank}`);
      }
      // And the top 3 is never someone the secret has not played with.
      if (entry.rank > 1 && entry.rank <= 3 && entry.parts.teammates === 0 && entry.parts.titles === 0 && entry.parts.stage === 0) {
        check(false, `contextinho: ${entry.player.name} is #${entry.rank} for ${secret.name} without ever teaming up`);
      }
    }
    let game = contextinho.createGame(secret);
    game = contextinho.submitGuess(game, pool.find((p) => p.id !== secret.id && p.region !== secret.region) ?? roster.players[0]);
    const before = Math.min(...game.guesses.map((g) => ranking.get(g.player.id)!.rank));
    const hint = contextinho.hintFor(game, ranking, ranking.size);
    if (hint && before > 2) {
      const after = ranking.get(hint.id)!.rank;
      check(after < before && after >= Math.floor(before / 2), `contextinho: a hint from #${before} gave #${after}`);
    }
    game = contextinho.submitGuess(game, secret);
    check(game.status === 'won', `contextinho: guessing ${secret.name} did not win`);
  }
  // The weights matter: with only country on, everyone from the secret's country outranks everyone else,
  // and their neighbours in the same scene (Canada for an American) come straight after.
  const secret = pool[0];
  const countryOnly = Object.fromEntries(
    contextinho.ATTRIBUTES.map((a) => [a.id, a.id === 'country' ? 1 : 0]),
  ) as contextinho.Weights;
  const byCountry = contextinho.rankAll(secret, roster.players, countryOnly, context);
  const others = roster.players.filter((p) => p.id !== secret.id);
  const compatriots = others.filter((p) => p.country === secret.country);
  const neighbours = others.filter((p) => p.country !== secret.country && contextinho.countryCloseness(secret.country, p.country) > 0);
  const worstCompatriot = Math.max(...compatriots.map((p) => byCountry.get(p.id)!.rank));
  check(worstCompatriot === compatriots.length + 1, `contextinho: with country alone, a compatriot of ${secret.name} ranks ${worstCompatriot}`);
  check(neighbours.length > 0, `contextinho: ${secret.name} (${secret.country}) has no neighbouring scene`);
  const worstNeighbour = Math.max(...neighbours.map((p) => byCountry.get(p.id)!.rank));
  check(worstNeighbour === compatriots.length + neighbours.length + 1, `contextinho: with country alone, a neighbour of ${secret.name} ranks ${worstNeighbour}`);
  check(contextinho.countryCloseness('LV', 'EE') === contextinho.countryCloseness('DE', 'AT') && contextinho.countryCloseness('FR', 'BR') === 0, 'contextinho: the scenes are not as documented');
  // Outside a scene, distance: Germany and Poland are close, Portugal and Russia are not.
  const dePl = contextinho.countryCloseness('DE', 'PL');
  check(dePl > 0.25 && dePl < 0.5 && contextinho.countryCloseness('PT', 'RU') === 0, `contextinho: distance reads DE–PL ${dePl.toFixed(2)}`);
  notes.push(
    `contextinho: ${pool.length} Easy secrets; their top teammate ranks #${(mateRank / Math.max(1, tried)).toFixed(1)} on average` +
      (partnerRanks.length ? `, an FNCS-winning partner #${(partnerRanks.reduce((a, b) => a + b, 0) / partnerRanks.length).toFixed(1)} (worst #${Math.max(...partnerRanks)})` : ''),
  );
}

// IRL: a file opens on the real name and ends on the handle's shape.
{
  for (const level of LEVEL_IDS) {
    const pool = levelPlayers(roster, level, irl.eligible(bios));
    check(pool.length >= (level === 'easy' ? 80 : 300), `irl ${level}: only ${pool.length} players with a real name`);
    const byId = new Map(roster.players.map((p) => [p.id, p]));
    for (const secret of pool.slice(0, 30)) {
      const game = irl.createGame(secret, bios, { orgs, teammates, majors }, byId);
      const tag = `irl ${level} ${secret.name}`;
      check(game.clues[0].id === 'name' && game.clues[0].value === bios.realName(secret.id), `${tag}: does not open on the real name`);
      const last = game.clues[game.clues.length - 1];
      check(last.id === 'handle', `${tag}: does not end on the handle`);
      check(
        last.value.split(' ').filter((c) => c === '_').length === [...secret.name].slice(1).filter((c) => /[\p{L}\p{N}]/u.test(c)).length,
        `${tag}: the handle shape "${last.value}" has the wrong number of blanks`,
      );
      const key = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
      check(key(game.clues[0].value) !== key(secret.name), `${tag}: the real name is the handle`);
    }
    notes.push(`irl ${level}: ${pool.length} players with a real name`);
  }
  check(irl.handleShape('Bugha') === 'B _ _ _ _', `irl: Bugha's shape reads "${irl.handleShape('Bugha')}"`);
}

// Transfer Window: three orgs or more, oldest first in Timeline.
{
  for (const level of LEVEL_IDS) {
    const pool = levelPlayers(roster, level, transferWindow.eligible(bios));
    check(pool.length >= 40, `transfer-window ${level}: only ${pool.length} players`);
    for (const secret of pool.slice(0, 30)) {
      for (const mode of ['timeline', 'shuffled'] as const) {
        const game = transferWindow.createGame(secret, bios, orgs, facts, mode, `tw-${secret.id}`);
        const cards = game.clues.flatMap((c) => (c.kind === 'org' ? [c.card] : []));
        const tag = `transfer-window ${level}/${mode} ${secret.name}`;
        check(cards.length >= transferWindow.MIN_ORGS && cards.length <= transferWindow.MAX_CARDS, `${tag}: ${cards.length} cards`);
        check(game.clues[0].kind === 'org', `${tag}: opens on a fact`);
        if (game.mode === 'timeline') {
          const days = cards.map((c) => c.from ?? c.to ?? '9999');
          check(days.every((d, i) => i === 0 || days[i - 1] <= d), `${tag}: the timeline is not oldest first`);
        } else {
          check(new Set(cards.map((c) => c.org)).size === cards.length, `${tag}: an org twice in Shuffled`);
          check(cards.every((c) => !c.from && !c.to), `${tag}: dates in Shuffled`);
        }
      }
    }
    notes.push(`transfer-window ${level}: ${pool.length} players with ${transferWindow.MIN_ORGS}+ orgs`);
  }
  check(transferWindow.duration('2019-03-25', '2022-12-28') === '3y 9m', `transfer-window: Bugha's Sentinels stint reads ${transferWindow.duration('2019-03-25', '2022-12-28')}`);
}

// Which Lobby?: the leaderboard climbs to the winner, every finisher typable.
if (majors) {
  const lobbies = lobbiesOf(majors);
  check(lobbies.every((l) => l.round && l.label), 'which-lobby: a lobby with no round');
  const keys = new Set(lobbies.map((l) => `${l.year}|${l.round}|${l.variant}`));
  check(keys.size === lobbies.length, `which-lobby: ${lobbies.length - keys.size} lobbies share a round and region`);
  check(parseLobby('FNCS 2023 - Major 2:  Europe - Grand Finals').round === 'FNCS 2023 - Major 2', 'which-lobby: Major 2 parses wrong');
  check(roundLabel('C2S1: FNCS') === 'C2S1' && roundLabel('FNCS: Chapter 2 Season 2') === 'C2S2', 'which-lobby: round labels wrong');
  const byId = new Map(roster.players.map((p) => [p.id, p]));
  // A finisher is a whole team: as many players as the format says, read here
  // from Liquipedia's label rather than from the engine.
  const TEAM: Record<string, number> = { Solo: 1, Duo: 2, Trio: 3, Squad: 4 };
  check(lobbies.every((l) => l.mode && TEAM[l.mode]), 'which-lobby: a lobby with no known format');
  for (const level of LEVEL_IDS) {
    const pool = whichLobby.lobbiesFor(majors, level);
    check(pool.length >= (level === 'easy' ? 60 : 100), `which-lobby ${level}: only ${pool.length} lobbies`);
    let clues = 0;
    for (const [i, lobby] of pool.entries()) {
      const team = TEAM[lobby.mode ?? ''];
      const whole = (f: { players: readonly unknown[] }) => f.players.length === team;
      for (let seed = 0; seed < 3; seed++) {
        const game = whichLobby.createGame(lobby, majors, byId, level, `wl-${i}-${seed}`);
        const places = game.clues.map((f) => f.placement);
        const tag = `which-lobby ${level} ${lobby.name}`;
        if (seed === 0) clues += places.length;
        check(places.length >= 4, `${tag}: only ${places.length} finishers`);
        check(places.every((p, j) => j === 0 || p < places[j - 1]), `${tag}: the finishers do not climb (${places.join(', ')})`);
        const broken = game.clues.find((f) => !whole(f));
        check(!broken, `${tag}: ${broken && whichLobby.finisherName(broken)} at ${broken?.placement} is not a whole ${lobby.mode}`);
        check(
          places[places.length - 1] === 1 || !majors.fieldOf(lobby.name).some((f) => f.placement === 1 && whole(f) && f.players.every((id) => byId.has(id))),
          `${tag}: the winner is not the last clue`,
        );
        if (i === 0 && seed === 0) checkClueRound(game, tag, pool.filter((l) => l.name !== lobby.name).map(whichLobby.asNamed));
      }
    }
    notes.push(`which-lobby ${level}: ${pool.length} lobbies, ${(clues / pool.length).toFixed(2)} finishers each`);
  }
  const [a, b] = [lobbies[2], lobbies[lobbies.length - 1]];
  check(whichLobby.compare(b, a).when === 'earlier' && whichLobby.compare(a, b).when === 'later', 'which-lobby: earlier and later are the wrong way round');
}

// Rewind: deals of the right size, far enough apart, with no year in the words,
// every kind turning up, and no kind, player or org filling a deal.
if (facts) {
  const moments = rewind.allMoments({ roster, facts, bios, orgs, majors });
  const kinds = new Map<string, number>();
  for (const m of moments) kinds.set(m.kind, (kinds.get(m.kind) ?? 0) + 1);
  // Every kind the files on disk can date: duos need career_path.json, the stints bios.json.
  const expected: rewind.MomentKind[] = ['lan-win', 'first-title', 'title', 'round', 'first-final', 'first-money', 'best-year'];
  if (majors) expected.push('duo');
  if (orgs?.orgs.some((org) => org.founded)) expected.push('founded');
  if (orgs && bios.dated) expected.push('signing', 'departure', 'org-title');
  const missing = expected.filter((kind) => !kinds.has(kind));
  check(missing.length === 0, `rewind: no ${missing.join(', ')} moments`);
  check(
    moments.every((m) => !m.wholeYear || (/^\d{4}-01-01$/.test(m.date) && /^\d{4}$/.test(rewind.when(m)))),
    'rewind: a prize-money moment is dated finer than its year',
  );
  const tierOf = new Map(roster.players.map((p) => [p.id, p.tier]));
  const most = (ids: string[]) => Math.max(0, ...[...new Set(ids)].map((id) => ids.filter((other) => other === id).length));
  for (const level of LEVEL_IDS) {
    const config = rewind.LEVELS[level];
    const pileKinds = new Set(moments.filter((m) => config.tiers.includes(m.tier) && config.kinds.includes(m.kind)).map((m) => m.kind));
    const perKind = Math.max(2, Math.ceil(config.size / pileKinds.size));
    const seen = new Set<string>();
    let built = 0;
    for (let seed = 0; seed < 40; seed++) {
      const hand = rewind.deal(moments, level, makeRng(`rw-${level}-${seed}`));
      if (!hand) continue;
      built++;
      const tag = `rewind ${level} deal ${seed}`;
      for (const m of hand) seen.add(m.kind);
      check(hand.length === config.size, `${tag}: ${hand.length} moments`);
      // Every pair, not just neighbours: a prize-money year spans 365 days.
      check(
        hand.every((m, i) => i === 0 || hand[i - 1].date < m.date) &&
          hand.every((m, i) => hand.every((o, j) => j <= i || rewind.daysApart(m, o) >= config.gapDays)),
        `${tag}: two moments closer than ${config.gapDays} days`,
      );
      check(hand.every((m) => !/\b(19|20)\d\d\b/.test(m.text)), `${tag}: a moment gives its year away — "${hand.find((m) => /\b(19|20)\d\d\b/.test(m.text))?.text}"`);
      check(hand.every((m) => config.tiers.includes(m.tier) && config.kinds.includes(m.kind)), `${tag}: a moment from outside the level`);
      check(most(hand.map((m) => m.kind)) <= perKind, `${tag}: more than ${perKind} of one kind`);
      check(most(hand.flatMap((m) => [...m.players, ...m.orgs])) <= 2, `${tag}: more than two about one player or org`);
      check(hand.filter((m) => m.wholeYear).length <= 2, `${tag}: more than two prize-money years`);
      // Easy is famous names: every player it names is Easy tier. A LAN win is
      // Easy for the event, whoever won it, as it always was.
      if (level === 'easy') {
        const unknown = hand.find((m) => m.kind !== 'lan-win' && m.players.some((id) => tierOf.get(id) !== 'easy'));
        check(!unknown, `${tag}: "${unknown?.text}" is about a player outside the Easy tier`);
      }
      let game = rewind.createGame(hand, level, `rw-${seed}`);
      check(rewind.inPlace(game) <= 1, `${tag}: starts with ${rewind.inPlace(game)} in place`);
      // Solve by swapping each place's right moment in.
      for (let i = 0; i < hand.length; i++) {
        const j = game.order.findIndex((m) => m.id === hand[i].id);
        game = rewind.swap(game, i, j);
      }
      check(rewind.check(game).status === 'won', `${tag}: the right order did not win`);
    }
    check(built === 40, `rewind ${level}: only ${built} of 40 deals`);
    const unseen = [...pileKinds].filter((kind) => !seen.has(kind));
    check(unseen.length === 0, `rewind ${level}: no ${unseen.join(', ')} in 40 deals`);
    notes.push(`rewind ${level}: ${built}/40 deals of ${config.size}, ${config.gapDays}+ days apart, ${seen.size} kinds seen`);
  }
  notes.push(`rewind: ${moments.length} moments — ${[...kinds].map(([k, n]) => `${k} ${n}`).join(', ')}`);
  // Lives: Medium and Hard end on the second imperfect check, a locked moment stays put.
  const hand = rewind.deal(moments, 'medium', makeRng('rw-lives'))!;
  const unsorted = (level: Level) => {
    let game = rewind.createGame(hand, level, 'lives');
    if (rewind.inPlace(game) === hand.length) game = rewind.swap(game, 0, 1);
    return game;
  };
  const hard = rewind.check(unsorted('hard'));
  check(hard.status === 'playing' && hard.lives === 1, 'rewind: hard lost on the first imperfect check');
  const medium = rewind.check(unsorted('medium'));
  check(medium.status === 'playing' && medium.lives === 1, 'rewind: medium lost on the first imperfect check');
  const lockedAt = medium.order.findIndex((m) => medium.locked.has(m.id));
  if (lockedAt >= 0) check(rewind.swap(medium, lockedAt, (lockedAt + 1) % hand.length) === medium, 'rewind: a locked moment moved');
}

// --------------------------------------------------------- 13. analytics records
// One real round per game through its own engine, recorded the way the game
// records it, then aggregated — so a record that stops matching what the
// dashboard reads fails here rather than on the live page.
{
  const stored: Stored<RoundRecord>[] = [];
  const keep = <G extends GameId>(
    game: G,
    made: { outcome: RoundRecord['outcome']; r: RoundRecord<G>['r'] },
    setup: RoundRecord['setup'] = {},
  ) => {
    const body = { v: RECORD_VERSION, game, app: 'check', data: 'check', setup, ...made } as RoundRecord;
    const size = JSON.stringify(body).length;
    check(size < MAX_RECORD_BYTES, `analytics: a ${game} record is ${size} bytes`);
    stored.push({ id: stored.length + 1, at: new Date().toISOString(), body });
  };
  const pool = gtp.answerable(roster.players);
  const [secret, other] = [pool[0], pool[1]];

  // Fortnitedle: one wrong guess, then the answer.
  {
    let game = wordle.gameFor(secret);
    const first = wordle.submitGuess(game, 'Q'.repeat(game.answer.length));
    if (first.ok) game = first.state;
    const second = wordle.submitGuess(game, game.answer);
    if (second.ok) game = second.state;
    const made = wordle.record(game);
    check(made.outcome === 'won' && made.r.guesses === 2, `analytics: fortnitedle recorded ${made.outcome} in ${made.r.guesses}`);
    keep('wordle', made, { pick: 'random' });
  }

  // Guess the Player: given up after one guess.
  {
    const game = gtp.giveUp(gtp.submitGuess(gtp.gameFor(secret, 'direction'), other));
    const made = gtp.record(game);
    check(made.outcome === 'gave-up', `analytics: guess-the-player give-up recorded as ${made.outcome}`);
    keep('guess-the-player', made);
  }

  // Career Path: skip, wrong guess, right guess — and a second round given up.
  if (majors) {
    const who = majors.eligible(roster.players).find((p) => majors.resultsFor(p.id).length >= 6)!;
    let game = career.createGame(who, majors.resultsFor(who.id), 'order', majors, 'analytics')!;
    game = career.revealNext(game);
    game = career.submitGuess(game, other.id === who.id ? secret : other);
    game = career.submitGuess(game, who);
    const made = career.record(game);
    check(made.outcome === 'won', `analytics: career-path win recorded as ${made.outcome}`);
    check(
      made.r.steps.map((s) => (s.guess ? (s.correct ? 'right' : 'wrong') : 'skip')).join() === 'skip,wrong,right',
      `analytics: career-path steps read ${JSON.stringify(made.r.steps)}`,
    );
    check(
      made.r.steps.map((s) => s.clue).join() === '0,1,2',
      'analytics: career-path steps name the wrong clues',
    );
    keep('career-path', made, { pick: 'custom', region: 'Europe', mode: 'order' });
    const quit = career.record(career.giveUp(career.createGame(who, majors.resultsFor(who.id), 'order', majors, 'q')!));
    check(quit.outcome === 'gave-up', `analytics: career-path give-up recorded as ${quit.outcome}`);
    keep('career-path', quit);
  }

  // Who Are Ya: out of clues is a loss, not a give-up.
  if (teammates && facts) {
    const byId = new Map(roster.players.map((p) => [p.id, p]));
    const who = roster.players.find((p) => whoAreYa.usableClues(teammates.cluesFor(p.id, byId)).length >= 3)!;
    let game = whoAreYa.createGame(who, teammates.cluesFor(who.id, byId), 'easy', 'analytics')!;
    const wrongs = roster.players.filter((p) => p.id !== who.id);
    for (let i = 0; game.status === 'playing'; i++) game = whoAreYa.submitGuess(game, wrongs[i]);
    const made = whoAreYa.record(game);
    check(made.outcome === 'lost', `analytics: who-are-ya running out recorded as ${made.outcome}`);
    keep('who-are-ya', made);
  }

  // Tenaball: the first row found, then given up.
  if (rankings) {
    const board = rankings.boards[0];
    let game = tenaball.createGame(board, 'easy');
    for (const member of membersOf(board.rows[0])) game = tenaball.applyGuess(game, member.key, member.label).state;
    game = tenaball.giveUp(game);
    const made = tenaball.record(game);
    check(made.outcome === 'gave-up', `analytics: tenaball give-up recorded as ${made.outcome}`);
    check(
      made.r.answers.filter((a) => a.found).length === membersOf(board.rows[0]).length,
      'analytics: tenaball recorded the wrong answers as found',
    );
    keep('tenaball', made, { level: 'easy' });
  }

  // List has no engine; the record is built in the component, so build one the same way.
  keep('list', {
    outcome: 'lost',
    r: { list: { id: 'check', name: 'Check list' }, total: 3, found: [{ id: secret.id, name: secret.name }], missed: ['A', 'B'] },
  });

  if (facts && orgs) {
    const source: CriteriaSource = {
      players: roster.playersFor('medium', { minimum: 200, eligible: facts.eligible(3) }),
      facts,
      orgs,
    };

    // Griefer: one griefer picked and checked — a loss, with the misread on file.
    const round = griefer.createRound(source, 'analytics')!;
    const outsider = round.board.find((p) => !round.memberIds.has(p.id))!;
    const lost = griefer.check(griefer.toggle(griefer.createGame(round, 'all-at-once'), outsider));
    const made = griefer.record(lost);
    check(made.outcome === 'lost', `analytics: griefer loss recorded as ${made.outcome}`);
    check(
      made.r.cards.some((c) => c.player.id === outsider.id && c.picked && !c.fits),
      'analytics: griefer did not record the picked griefer',
    );
    keep('impostor', made, { mode: 'all-at-once' });

    // Tic Tac Toe: one player placed, then given up.
    const answers = roster.exactly('easy', { eligible: facts.eligible(3) });
    const board = ttt.generateBoard({ facts, orgs }, { answers, accepted: roster.players }, 'easy', 'analytics')!;
    let game = ttt.createGame(board, 'easy');
    const first = board.candidates[0][0][0];
    const placed = ttt.submit(game, first);
    game = placed.outcome.kind === 'choose' ? ttt.place(game, placed.outcome.cells[0], first).state : placed.state;
    const tt = ttt.record(ttt.giveUp(game));
    check(tt.outcome === 'gave-up' && tt.r.placed.length === 1, `analytics: tic-tac-toe recorded ${tt.outcome}, ${tt.r.placed.length} placed`);
    keep('tic-tac-toe', tt, { level: 'easy' });

    // Connections: one wrong four, then given up.
    const puzzle = connections.generatePuzzle(source, 'analytics')!;
    let cgame = connections.createGame(puzzle);
    const mixed = [...puzzle.groups[0].players.slice(0, 3), puzzle.groups[1].players[0]];
    for (const p of mixed) cgame = connections.toggle(cgame, p);
    cgame = connections.giveUp(connections.submit(cgame));
    const cm = connections.record(cgame);
    check(
      cm.outcome === 'gave-up' && cm.r.attempts.length === 1 && !cm.r.attempts[0].correct,
      `analytics: connections recorded ${cm.outcome} with ${cm.r.attempts.length} attempts`,
    );
    keep('connections', cm);
  }

  // Higher or Lower: one right, one wrong.
  {
    let game = hl.createGame(roster.players, 'earnings', 'easy', 'analytics')!;
    game = hl.nextRound(hl.submitAnswer(game, hl.correctAnswer(game)));
    game = hl.submitAnswer(game, hl.correctAnswer(game) === 'higher' ? 'lower' : 'higher');
    const made = hl.record(game);
    check(
      made.outcome === 'lost' && made.r.score === 1 && made.r.pairs.length === 2,
      `analytics: higher-lower recorded ${made.outcome}, score ${made.r.score}, ${made.r.pairs.length} pairs`,
    );
    keep('higher-lower', made, { level: 'easy', category: 'earnings' });
  }

  // Pyramid: one check with some wrong, then given up.
  if (facts) {
    const puzzle = pyramid.generatePuzzle(roster, facts, rankings, 'easy', 'analytics')!;
    let game = pyramid.createGame(puzzle, 'easy', 'analytics');
    game = pyramid.giveUp(pyramid.check(game));
    const made = pyramid.record(game);
    check(
      made.outcome === 'gave-up' && made.r.items.length === pyramid.SIZE && made.r.checks === 1,
      `analytics: pyramid recorded ${made.outcome}, ${made.r.items.length} items, ${made.r.checks} checks`,
    );
    keep('pyramid', made, { level: 'easy' });
  }

  // Bingo: one square marked, one wrong, then given up.
  if (facts && orgs) {
    const easy = roster.exactly('easy', { eligible: facts.eligible(3) });
    const board = bingo.generateBoard({ facts, orgs, teammates, roster: roster.players }, { answers: easy }, 'easy', 'analytics')!;
    let game = bingo.createGame(board, 'easy');
    while (!board.squares.some((sq) => sq.test(bingo.current(game)!))) game = bingo.skip(game);
    const first = bingo.current(game)!;
    game = bingo.place(game, board.squares.findIndex((sq) => sq.test(first)))!.state;
    const second = bingo.current(game)!;
    const wrong = board.squares.findIndex((sq, i) => !game.filled.has(i) && !sq.test(second));
    if (wrong >= 0) game = bingo.place(game, wrong)!.state;
    const made = bingo.record(bingo.giveUp(game));
    check(
      made.outcome === 'gave-up' && made.r.squares.length === bingo.SQUARES && made.r.placed.length === 1 && made.r.deck === board.deck.length,
      `analytics: bingo recorded ${made.outcome}, ${made.r.squares.length} squares, ${made.r.placed.length} placed`,
    );
    keep('bingo', made, { level: 'easy', mode: 'deck' });

    // A Timed round run out of time: the same shape, with no deck.
    const timed = bingo.generateBoard({ facts, orgs, teammates, roster: roster.players }, { answers: easy }, 'easy', 'analytics', 'timed')!;
    const skipped = bingo.skip(bingo.createGame(timed, 'easy'));
    const ran = bingo.record(bingo.tick(skipped, bingo.LEVELS.easy.seconds));
    check(
      ran.outcome === 'lost' && ran.r.deck === 0 && ran.r.dealt === 1 && ran.r.squares.length === bingo.SQUARES,
      `analytics: a timed bingo recorded ${ran.outcome}, a deck of ${ran.r.deck}, ${ran.r.dealt} dealt`,
    );
    keep('bingo', ran, { level: 'easy', mode: 'timed' });
  }

  // The October games: one round each, through their own engines.
  const stepsOf = (steps: { guess: unknown; correct: boolean }[]) =>
    steps.map((s) => (s.guess ? (s.correct ? 'right' : 'wrong') : 'skip')).join();
  {
    const who = levelPlayers(roster, 'easy', curveball.eligible)[0];
    let game = curveball.createGame(who);
    game = clueGuess(clueSkip(game), who.id === other.id ? secret : other);
    game = clueGuess(game, who);
    const made = curveball.record(game);
    check(made.outcome === 'won' && stepsOf(made.r.steps) === 'skip,wrong,right', `analytics: curveball recorded ${made.outcome}, ${stepsOf(made.r.steps)}`);
    check(made.r.clues.every((c) => /^\d{4} — /.test(c.name)), 'analytics: a curveball clue is not "year — value"');
    keep('curveball', made, { level: 'easy' });
  }
  {
    const who = levelPlayers(roster, 'easy', irl.eligible(bios))[0];
    const made = irl.record(clueGiveUp(irl.createGame(who, bios, { orgs, teammates, majors }, new Map(roster.players.map((p) => [p.id, p])))));
    check(made.outcome === 'gave-up' && made.r.clues[0].id === 'name', `analytics: irl recorded ${made.outcome}`);
    keep('irl', made, { level: 'easy' });
  }
  {
    const who = levelPlayers(roster, 'easy', transferWindow.eligible(bios))[0];
    let game = transferWindow.createGame(who, bios, orgs, facts, 'timeline', 'analytics');
    for (const wrong of roster.players.filter((p) => p.id !== who.id)) {
      if (game.status !== 'playing') break;
      game = clueGuess(game, wrong);
    }
    const made = transferWindow.record(game);
    check(made.outcome === 'lost', `analytics: transfer-window running out recorded as ${made.outcome}`);
    keep('transfer-window', made, { level: 'easy', mode: game.mode });
  }
  if (orgs) {
    const org = orgChart.orgPool(orgs, roster, 'easy')[0];
    const made = orgChart.record(clueGuess(orgChart.createGame(org, roster, bios, 'names', 'analytics'), org));
    check(made.outcome === 'won' && made.r.secret.id === org.id, `analytics: org-chart recorded ${made.outcome}`);
    keep('org-chart', made, { level: 'easy', mode: 'names' });
  }
  if (majors) {
    const lobby = whichLobby.lobbiesFor(majors, 'easy')[0];
    const made = whichLobby.record(
      clueGiveUp(whichLobby.createGame(lobby, majors, new Map(roster.players.map((p) => [p.id, p])), 'easy', 'analytics')),
    );
    check(made.outcome === 'gave-up' && made.r.secret.id === lobby.name, `analytics: which-lobby recorded ${made.outcome}`);
    check(!('lobby' in made.r.secret), 'analytics: which-lobby sent the whole lobby as the secret');
    keep('which-lobby', made, { level: 'easy' });
  }
  if (teammates) {
    const who = levelPlayers(roster, 'easy', contextinho.eligible(teammates))[0];
    const ranking = contextinho.rankAll(who, roster.players, contextinho.DEFAULT_WEIGHTS, { teammates, orgs, facts, majors });
    let game = contextinho.submitGuess(contextinho.createGame(who), who.id === other.id ? secret : other);
    const hint = contextinho.hintFor(game, ranking, ranking.size);
    if (hint) game = contextinho.submitGuess(game, hint, true);
    game = contextinho.submitGuess(game, who);
    const made = contextinho.record(game);
    check(made.outcome === 'won' && made.r.guesses[made.r.guesses.length - 1].id === who.id, `analytics: contextinho recorded ${made.outcome}`);
    check(made.r.hints === (hint ? 1 : 0), `analytics: contextinho recorded ${made.r.hints} hints`);
    keep('contextinho', made, { level: 'easy' });
  }
  if (facts) {
    const hand = rewind.deal(rewind.allMoments({ roster, facts, bios, orgs }), 'easy', makeRng('analytics'))!;
    const made = rewind.record(rewind.giveUp(rewind.check(rewind.createGame(hand, 'easy', 'analytics'))));
    check(
      made.outcome === 'gave-up' && made.r.items.length === hand.length && made.r.checks === 1,
      `analytics: rewind recorded ${made.outcome}, ${made.r.items.length} items`,
    );
    keep('rewind', made, { level: 'easy' });
  }

  // A malformed row must cost itself, not the dashboard.
  stored.push({ id: 999, at: new Date().toISOString(), body: { game: 'tenaball', r: null } as unknown as RoundRecord });

  const dash = aggregate(stored);
  const played = (id: GameId) => dash.games.find((g) => g.game === id)?.rounds ?? 0;

  // Starts were counted from 4 Oct 2026, rounds from the launch: a round
  // finished before the first count is a finish with no start, and the finish
  // rate leaves it out ("579 of 487 rounds started").
  {
    const hour = new Date().toISOString().slice(0, 13);
    const early = stored.slice(0, 2).map((round) => ({ ...round, at: '2026-09-29T12:00:00.000Z' }));
    const late = stored.slice(2, 3);
    const t = aggregate([...early, ...late], { days: 0, funnel: [{ hour, page: 'wordle', step: 'start', mode: 'unlimited', n: 1 }] }).traffic;
    check(
      t.totals.finished === 3 && t.totals.tracked === 1 && t.countingSince === hour,
      `analytics: rounds before the funnel read ${t.totals.tracked} tracked of ${t.totals.finished}`,
    );
  }
  check(played('wordle') === 1, `analytics: dashboard counts ${played('wordle')} fortnitedle rounds`);
  check(dash.wordle[0]?.solved === 1 && dash.wordle[0]?.avgGuesses === 2, 'analytics: fortnitedle row is wrong');
  if (majors) {
    check(played('career-path') === 2, `analytics: dashboard counts ${played('career-path')} career-path rounds`);
    const row = dash.careerPath[0];
    const solvedAt = row?.clues.find((c) => c.solved === 1);
    check(Boolean(solvedAt) && row.solved === 1 && row.avgClues === 3, 'analytics: career-path clue breakdown is wrong');
    const mix = dash.games.find((g) => g.game === 'career-path')!.mix;
    check(mix.regions[0]?.label === 'Europe', 'analytics: setup counts lost the region');
    const chosen = mix.source.find((s) => s.label === 'chosen')?.count;
    check(chosen === 1, `analytics: ${chosen} career-path rounds counted as Chosen, expected 1`);

    // Filters narrow everything at once, and a filter nothing matches is an
    // empty dashboard rather than an error.
    const europe = aggregate(stored, { filter: { region: 'Europe' } });
    check(europe.rounds === 1 && europe.careerPath.length === 1, `analytics: the Europe filter kept ${europe.rounds} rounds`);
    const nothing = aggregate(stored, { filter: { source: 'event' } });
    check(nothing.rounds === 0 && nothing.wordle.length === 0, 'analytics: an empty filter still counted rounds');

    // The player view: the Career Path secret, seen as the secret twice.
    const who = dash.careerPath[0];
    const lens = playerLens(stored, who.id);
    const asSecret = lens.rows.find((row) => row.game === 'career-path' && row.role === 'secret');
    check(asSecret?.rounds === 2 && asSecret.good === 1, `analytics: ${who.name}'s player view reads ${JSON.stringify(asSecret)}`);
  }
  const index = playerIndex(stored);
  check(index.length > 0 && index.every((entry) => entry.rounds > 0), 'analytics: the player index is empty');
  check(!index.some((entry) => entry.id === 'check'), 'analytics: a list id leaked into the player index');
  if (rankings) check(dash.tenaball[0]?.gaveUp === 1, 'analytics: tenaball give-up not counted');
  check(dash.list[0]?.answers.length === 3, 'analytics: list answers not counted from found + missed');
  if (facts && orgs) {
    check(dash.griefer.misreads.length > 0, 'analytics: griefer misreads empty');
    check(dash.ticTacToe.length === 9, `analytics: tic-tac-toe has ${dash.ticTacToe.length} cells, not 9`);
    check(dash.connections.misgrouped.length === 4, 'analytics: connections misgrouped players not counted');
  }
  check(dash.higherLower.pairs.length === 2, 'analytics: higher-lower pairs not counted');
  check(dash.curveball[0]?.solved === 1 && dash.curveball[0]?.avgClues === 3, 'analytics: curveball row is wrong');
  check(dash.irl.length === 1 && dash.transferWindow.length === 1, 'analytics: irl or transfer-window not counted');
  if (orgs) check(dash.orgChart[0]?.solved === 1, 'analytics: org-chart not counted as solved');
  if (majors) check(dash.whichLobby.length === 1, 'analytics: which-lobby not counted');
  if (teammates) check(dash.contextinho[0]?.solved === 1, 'analytics: contextinho not counted as solved');
  if (facts) check((dash.rewind[0]?.answers.length ?? 0) >= rewind.LEVELS.easy.size, 'analytics: rewind moments not counted');
  // An org and a tournament are secrets, not players: neither may reach the player search.
  check(
    !index.some((entry) => entry.id.includes(' - ') || orgs?.get(entry.id)),
    'analytics: an org or a tournament leaked into the player index',
  );
  notes.push(`analytics: ${stored.length} records across ${dash.games.filter((g) => g.rounds).length} games aggregate cleanly`);
}

// ------------------------------------------------------------ 12. event pools
if (pools.pools.length > 0) {
  const byId = new Map(roster.players.map((p) => [p.id, p]));
  for (const pool of pools.pools) {
    const playable = pool.players.filter((id) => byId.has(id));
    notes.push(`pool ${pool.label}: ${playable.length} of ${pool.players.length} playable`);
    check(playable.length >= 20, `pools: ${pool.label} only has ${playable.length} playable players`);
  }

  for (const pool of pools.pools) {
    const field = pool.players.flatMap((id) => byId.get(id) ?? []);
    const year = pool.date.slice(0, 4);

    // Tenaball: one heading, and the planned boards first and in order. A board
    // the field cannot fill is dropped, so this checks order, not presence.
    const boards = poolBoards(pool, field, facts, orgs);
    check(new Set(boards.map((b) => b.group)).size === 1, `event ${pool.label}: field boards under several headings`);
    const planned = ['earnings', 'youngest', 'earnings-least', 'fncs', 'earnings:Europe', 'countries',
      'earnings-year', 'oldest', 'orgs', 'earnings:North America', 'lans', 'fncs-apps'];
    const at = planned.map((id) => boards.findIndex((b) => b.id === `pool:${pool.id}:${id}`)).filter((i) => i >= 0);
    check(at.every((index, i) => i === 0 || index > at[i - 1]), `event ${pool.label}: field boards out of order`);
    check(at.length >= 10, `event ${pool.label}: only ${at.length} of the ${planned.length} planned boards built`);
    notes.push(`event ${pool.label}: ${boards.length} Tenaball boards, ${at.length} of ${planned.length} planned`);

    // The results boards, once the event has been played: standings in place
    // order, every team slot closable by naming its players, and the two
    // seeded boards only from a file that carries earnings from before.
    if (Object.keys(pool.placements ?? {}).length > 0) {
      const playable = (board: (typeof boards)[number]) => {
        let game = tenaball.createGame(board, 'hard');
        for (const row of board.rows) {
          for (const member of membersOf(row)) game = tenaball.applyGuess(game, member.key, member.label).state;
        }
        return game.status === 'won';
      };
      const results = boards.find((b) => b.id === `pool:${pool.id}:results`);
      check(Boolean(results), `event ${pool.label}: the results are in but there is no top 10 board`);
      if (results) {
        check(
          results.rows.every((row, i) => row.value === i + 1),
          `event ${pool.label}: the top 10 reads ${results.rows.map((row) => row.value).join(', ')}`,
        );
        check(playable(results), `event ${pool.label}: the top 10 cannot be completed`);
      }
      const seeded = ['upsets', 'disappointments'].map((id) => boards.find((b) => b.id === `pool:${pool.id}:${id}`));
      if (pool.earningsBefore) {
        check(seeded.every(Boolean), `event ${pool.label}: earnings from before are in but a seeded board is missing`);
        for (const board of seeded) {
          if (!board) continue;
          check(board.rows.every((row) => row.value > 0), `event ${pool.label}: ${board.title} has a row that moved no places`);
          check(playable(board), `event ${pool.label}: ${board.title} cannot be completed`);
        }
        const [upset, flop] = seeded.map((board) => board?.rows[0]);
        notes.push(
          `event ${pool.label}: biggest upset ${upset?.label} ${upset?.display}, biggest disappointment ${flop?.label} ${flop?.display}`,
        );
      } else {
        check(seeded.every((board) => !board), `event ${pool.label}: seeded boards without earnings from before`);
        notes.push(`event ${pool.label}: no earnings from before the event yet — upsets and disappointments wait for cell 5`);
      }
    }

    // List: the planned lists, and the two answered with names that are not
    // players search a population wider than their answers.
    if (facts) {
      const lists = buildPoolCriteria(pool, field, facts, orgs, roster.players);
      const ids = lists.map((c) => c.id.replace(`pool:${pool.id}:`, ''));
      for (const id of ['region:Europe', `fncs-${year}`, 'region:North America', 'orgs', 'region:South America',
        'countries', 'region:Middle East', 'fncs', 'region:Asia-Oceania']) {
        check(ids.includes(id), `event ${pool.label}: no "${id}" list`);
      }
      check(ids.some((id) => id.startsWith('also:')), `event ${pool.label}: no "also played the last LAN" list`);
      const firstLan = lists.find((c) => c.id === `pool:${pool.id}:first-lan`);
      const lansBefore = facts.events.filter((event) => event.lan && event.date < pool.date);
      if (firstLan) {
        check(
          firstLan.answers.every((a) => lansBefore.every((event) => !facts.playedAt(event.index).has(a.id))),
          `event ${pool.label}: a "first LAN" answer played an earlier LAN`,
        );
        notes.push(`event ${pool.label}: ${firstLan.answers.length} qualifiers at their first LAN (${lansBefore.length} LANs before it)`);
      } else {
        check(lansBefore.length === 0, `event ${pool.label}: no "first LAN" list`);
      }
      for (const list of lists.filter((c) => c.pool)) {
        const searchable = new Set(list.pool!.map((entry) => entry.id));
        check(list.answers.every((a) => searchable.has(a.id)), `event ${pool.label}: "${list.title}" has an answer you cannot type`);
        check(list.pool!.length > list.answers.length * 2, `event ${pool.label}: "${list.title}" searches little more than its answers`);
      }
      notes.push(`event ${pool.label}: ${lists.length} List lists — ${lists.slice(0, 4).map((c) => c.title).join('; ')}…`);
    }

    // The secret-player games: regions in turn, so any run of as many deals as
    // there are regions shows every one of them.
    const regions = new Set(field.map((p) => p.region ?? ''));
    let seen: string[] = [];
    const dealt: string[] = [];
    const rng = makeRng(`turns-${pool.id}`);
    for (let i = 0; i < regions.size * 4; i++) {
      const drawn = dealInTurn(field, seen, (p) => p.region ?? '', rng)!;
      seen = drawn.seen;
      dealt.push(drawn.pick.region ?? '');
    }
    for (let i = 0; i + regions.size <= dealt.length; i += regions.size) {
      const window = new Set(dealt.slice(i, i + regions.size));
      check(window.size === regions.size, `event ${pool.label}: deals ${i + 1}-${i + regions.size} miss a region`);
    }

    // Higher or Lower leans to the region it has shown least; measured against
    // the same runs without the lean.
    const spread = (on: boolean) => {
      let total = 0;
      for (let run = 0; run < 5; run++) {
        let state = hl.createGame(field, 'earnings', 'easy', `spread-${run}`, on);
        const shown = new Set<string>();
        while (state && state.status === 'playing' && hl.roundOf(state) <= 12) {
          shown.add(state.challenger.region ?? '');
          state = hl.nextRound(hl.submitAnswer(state, hl.correctAnswer(state)));
        }
        total += shown.size;
      }
      return total / 5;
    };
    const [flat, leaned] = [spread(false), spread(true)];
    check(leaned >= flat, `event ${pool.label}: Higher or Lower's region lean shows fewer regions (${leaned} vs ${flat})`);
    notes.push(`event ${pool.label}: Higher or Lower shows ${leaned.toFixed(1)} regions in 12 rounds with the lean, ${flat.toFixed(1)} without`);

    // Higher or Lower's Placement, once the event's results are in.
    if (Object.keys(pool.placements ?? {}).length > 0) {
      checkHigherLower(hl.withPlacements(field, pool.placements), 'placement', `placement at ${pool.label}`);
    } else {
      notes.push(`event ${pool.label}: no results yet — Higher or Lower's Placement is greyed out`);
    }

    // Every game deals the whole field where the data allows: a qualifier is
    // never left out for falling short of a minimum the roster uses. Career
    // Path can only once cell 7 has written its short careers.
    const reach: [string, number][] = [
      ['Fortnitedle', wordle.eligible(field).length],
      ['Guess the Player', gtp.answerableInField(field).length],
    ];
    if (teammates) {
      reach.push(['Who Are Ya', field.filter((p) => whoAreYa.usableClues(teammates.cluesFor(p.id, byId)).length > 0).length]);
    }
    const shortCareers = majors && roster.players.some((p) => {
      const n = majors.resultsFor(p.id).length;
      return n > 0 && n < majors.minAppearances;
    });
    if (majors && shortCareers) reach.push(['Career Path', majors.inField(field).length]);
    // A field shown as a Tenite group only (`FIELD_POOLS`: the 2026 Solo FNCS, 355
    // qualifiers, some with no major yet) is not held to it: its reach is a note.
    const strict = !FIELD_POOLS.includes(pool.id);
    for (const [game, n] of reach) check(!strict || n === field.length, `event ${pool.label}: ${game} deals ${n} of ${field.length}`);
    notes.push(
      `event ${pool.label}: ${reach.map(([game, n]) => `${game} ${n}`).join(', ')} of ${field.length}` +
        (majors && !shortCareers ? ` (Career Path ${majors.inField(field).length} until cell 7 runs)` : ''),
    );

    // The board games take the whole field too, and still build.
    if (facts && orgs) {
      const source: CriteriaSource = { players: field, facts, orgs };
      let rounds = 0;
      let puzzles = 0;
      let grids = 0;
      for (let seed = 0; seed < 8; seed++) {
        if (griefer.createRound(source, `field-g-${seed}`)) rounds++;
        if (connections.generatePuzzle(source, `field-c-${seed}`)) puzzles++;
        const level = (['easy', 'medium', 'hard'] as const)[seed % 3];
        if (ttt.generateBoard({ facts, orgs }, { answers: field, accepted: field }, level, `field-t-${seed}`)) grids++;
      }
      check(rounds === 8 && puzzles >= 6 && grids >= 6, `event ${pool.label}: whole-field boards — Griefer ${rounds}/8, Connections ${puzzles}/8, Tic Tac Toe ${grids}/8`);
      notes.push(`event ${pool.label}: whole-field boards — Griefer ${rounds}/8, Connections ${puzzles}/8, Tic Tac Toe ${grids}/8`);
    }
  }
} else {
  skipped.push('pools.json (no event pools)');
}

// ------------------------------------------------------------ 12b. the glossary
// The definitions are matched to titles by their words; the traps are the ones
// that read alike — a region after "from", the one board whose LAN is wide.
{
  const expect = (title: string, id: string, has: TermId[], lacks: TermId[] = []) => {
    const found = termsIn(title, id);
    for (const term of has) check(found.includes(term), `glossary: "${title}" is missing ${term}`);
    for (const term of lacks) check(!found.includes(term), `glossary: "${title}" wrongly explains ${term}`);
  };
  expect('Top 10 by LAN wins', 'lan-wins', ['lan-wide'], ['lan']);
  expect('Players who have won a major LAN', 'lan-winners', ['lan'], ['lan-wide', 'major']);
  expect('Top 10 by major LAN earnings', 'lan-earnings', ['lan', 'earnings'], ['major']);
  expect('Players from Poland who have won an FNCS', 'country-fncs:Poland', ['nationality', 'fncs-title']);
  expect('FNCS 2026 Globals qualifiers from Europe', 'pool:x:region:Europe', ['region', 'field'], ['nationality']);
  expect('Top 10 by major tournament wins', 'major-wins', ['major']);
  expect('Players with 20+ FNCS grand finals', 'fncs-apps:20', ['fncs-final'], ['fncs-title']);
  // The 2019 World Cup is not a Globals; the Globals boards explain the Globals.
  expect('Top 10 by earnings excluding the World Cup', 'earnings-no-wc', ['earnings'], ['global']);
  expect('Global Championships Top 10 players at the Global Championships', 'globals:best', ['global']);
  // One event's board says what it is; nothing to explain (13 Oct 2026).
  for (const [title, id] of [
    ['Tournaments Top 10 at FNCS 2023 Global Championship', 'tournament:FNCS 2023 Global Championship'],
    ['FNCS finals — Europe Top 10 at FNCS 2026 - Major 2: Europe', 'tournament:FNCS 2026 - Major 2: Europe - Grand Finals'],
  ]) {
    check(termsIn(title, id).length === 0, `glossary: the one-event board "${title}" explains ${termsIn(title, id).join(', ')}`);
  }
  if (facts) {
    const lans = TERMS.lan.events!(facts).names;
    check(lans.length === facts.events.filter((e) => e.lan).length, 'glossary: the LAN list is not every LAN');
    notes.push(`glossary: ${lans.length} LANs listed — ${lans.join(', ')}`);
    const globals = TERMS.global.events!(facts).names;
    check(globals.length >= 4 && globals.every((name) => /Global Championship/.test(name)), `glossary: the Globals list is ${globals.join(', ')}`);
    // A World Cup win is a major LAN win, never a Globals one.
    check(facts.of('Bugha').wins.global === 0 && facts.of('Bugha').wins.lan > 0, 'glossary: Bugha’s World Cup still counts as a Globals win');
    notes.push(`glossary: ${globals.length} Globals listed — ${globals.join(', ')}`);
  }
}

// ------------------------------------------------------------ 12d. followers
// Only when this machine has counts (scripts/socials_api.py writes them; git and
// CI never see them). Every game that reads them builds with them.
if (socials.platforms.length > 0) {
  const byId = new Map(roster.players.map((player) => [player.id, player]));
  for (const platform of socials.platforms) {
    // Higher or Lower: the run checks, on contenders carrying the counts.
    const withCounts: hl.Contender[] = roster.players.map((p) => ({ ...p, [platform]: socials.of(platform, p) ?? undefined }));
    checkHigherLower(withCounts, platform);
  }
  // Tenaball: every follower board is ten nameable players and a spare.
  const boards = socialBoards(roster, socials);
  for (const board of boards) {
    check(board.rows.length === 10 && board.rows.every((row) => byId.has(row.key)) && byId.has(board.next.key), `followers: ${board.title} has an answer nobody can type`);
    check(board.rows.every((row, i) => i === 0 || board.rows[i - 1].value >= row.value), `followers: ${board.title} is out of order`);
  }
  check(boards.length >= socials.platforms.length * 4, `followers: only ${boards.length} Tenaball boards`);
  // List, and the shared rules.
  if (facts && orgs) {
    const followerLists = buildListCriteria(roster, facts, null, orgs, null, socials).filter((list) => list.id.startsWith('followers:'));
    check(followerLists.length > 0 && followerLists.every((list) => list.answers.length >= 10 && list.answers.length <= 120), 'followers: a List follower list is missing or out of bounds');
    const rules = buildCriteria({ players: roster.players, facts, orgs, socials }, { minMatches: 4, maxShare: 0.5 }).filter((rule) => rule.kind === 'socials');
    check(rules.length > 0, 'followers: no follower rules were built');
    // Pyramid: some seed deals a follower pyramid, in order.
    let followerPyramids = 0;
    for (let seed = 0; seed < 60 && followerPyramids < 3; seed++) {
      const puzzle = pyramid.generatePuzzle(roster, facts, null, 'easy', `f-${seed}`, null, null, socials);
      if (!puzzle?.id.startsWith('followers:')) continue;
      followerPyramids++;
      check(puzzle.items.length === pyramid.SIZE, `followers: a pyramid of ${puzzle.items.length}`);
    }
    check(followerPyramids > 0, 'followers: no follower pyramid in 60 deals');
    notes.push(`followers: ${socials.platforms.join(' and ')} — ${boards.length} Tenaball boards, ${followerLists.length} lists, ${rules.length} rules (${rules.map((rule) => `${rule.short} ${rule.matches.length}`).join(', ')})`);
  }
  // Guess the Player's Twitch column points the right way.
  if (socials.has('twitch')) {
    const [big, small] = ['Ninja', 'Bugha'].map((id) => byId.get(id));
    if (big && small) {
      const cell = gtp.compare(small, big, 'direction', { twitch: (id) => socials.of('twitch', id) }).find((r) => r.key === 'twitch');
      check(cell?.direction === 'up', `followers: Guess the Player's Twitch arrow points ${cell?.direction}`);
    }
  }
} else {
  skipped.push('followers (no socials.json here — scripts/socials_api.py)');
}

// ------------------------------------------------------------ 12c. the daily puzzles
// The day turns over at midnight in Berlin, summer time or not; a month of days
// in a row comes out whole, never repeats a secret or a board, and every
// puzzle rebuilds into a round the perfect player can finish.
{
  check(daily.dayKey(Date.parse('2026-10-04T21:59:00Z')) === '2026-10-04', 'daily: 23:59 CEST is not still the 4th');
  check(daily.dayKey(Date.parse('2026-10-04T22:00:00Z')) === '2026-10-05', 'daily: 00:00 CEST is not the 5th');
  check(daily.dayKey(Date.parse('2026-12-01T22:59:00Z')) === '2026-12-01', 'daily: 23:59 CET is not still the 1st');
  check(daily.dayKey(Date.parse('2026-12-01T23:00:00Z')) === '2026-12-02', 'daily: 00:00 CET is not the 2nd');
  check(daily.startOf('2026-10-26') === Date.parse('2026-10-25T23:00:00Z'), 'daily: the day after summer time ends starts at the wrong hour');
  check(daily.startOf('2027-03-29') === Date.parse('2027-03-28T22:00:00Z'), 'daily: the day after summer time starts begins at the wrong hour');
  const evening = Date.parse('2026-10-25T22:30:00Z');
  check(daily.msUntilNextDay(evening) === 30 * 60_000, `daily: half an hour to midnight read ${daily.msUntilNextDay(evening)}ms`);
  check(daily.puzzleNumber(daily.DAILY_START) === 1 && daily.puzzleNumber(daily.addDays(daily.DAILY_START, 9)) === 10, 'daily: puzzle numbers are off');
  // Each game counts from its own first day: Fortnitedle's #1 is 19 Oct, the day Tenite was on #15.
  check(
    daily.puzzleNumber(DAILY_FROM.wordle, 'wordle') === 1 &&
      daily.puzzleNumber(DAILY_FROM.wordle, 'tenaball') === daily.puzzleNumber(DAILY_FROM.wordle) &&
      daily.puzzleDay(3, 'higher-lower') === daily.addDays(DAILY_FROM['higher-lower'], 2),
    'daily: a game does not number its puzzles from its own first day',
  );
  check(
    gamesOn(daily.addDays(DAILY_FROM.wordle, -1)).every((game) => DAILY_FROM[game] < DAILY_FROM.wordle) &&
      gamesOn(DAILY_FROM.wordle).includes('wordle') &&
      !gamesOn(DAILY_FROM.wordle).includes('tic-tac-toe'),
    'daily: a day has a puzzle for a game that had not started, or for Box Fight',
  );

  // Streaks count days played in a row, up to today or, before today's is played, yesterday.
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05'];
  const streak = (today: string) => dailyProgress.statsOf(days, today);
  check(streak('2026-10-05').streak === 1 && streak('2026-10-06').streak === 1 && streak('2026-10-07').streak === 0, 'daily: the streak does not count up to today or yesterday');
  check(streak('2026-10-04').streak === 3 && streak('2026-10-05').best === 3, 'daily: the streak or best run is miscounted');

  // The archive: a day's round survives the next day starting, an earlier day
  // played late is kept beside it, and a late day counts as played but never
  // mends a streak. Run against a stand-in localStorage.
  {
    const store = new Map<string, string>();
    const g = globalThis as { window?: unknown };
    g.window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, String(value)),
        removeItem: (key: string) => void store.delete(key),
      },
    };
    try {
      const [d5, d6, d7] = ['2026-10-05', '2026-10-06', '2026-10-07'];
      const at = (day: string, board: string) => dailyProgress.savedRound<{ n: number }>('tenaball', day, { board })?.n;
      dailyProgress.saveRound('tenaball', d6, { board: 'six' }, { n: 6 });
      dailyProgress.saveRound('tenaball', d7, { board: 'seven' }, { n: 7 });
      check(at(d6, 'six') === 6 && at(d7, 'seven') === 7, `daily archive: a round was lost when the next day began (${at(d6, 'six')}, ${at(d7, 'seven')})`);
      dailyProgress.saveRound('tenaball', d5, { board: 'five' }, { n: 5 });
      dailyProgress.saveRound('tenaball', d5, { board: 'five' }, { n: 55 });
      check(at(d5, 'five') === 55 && at(d6, 'six') === 6 && at(d7, 'seven') === 7, 'daily archive: an earlier day played late overwrote another');
      check(at(d5, 'other') === undefined, 'daily archive: a round came back onto a different puzzle');
      check([d5, d6, d7].every((day) => dailyProgress.savedDays('tenaball').has(day)), 'daily archive: savedDays misses a day');

      dailyProgress.logResult('tenaball', d6, { outcome: 'won', score: '10/10' });
      dailyProgress.logResult('tenaball', d7, { outcome: 'lost', score: '4/10' });
      dailyProgress.logResult('tenaball', d5, { outcome: 'won', score: '9/10' }, true);
      dailyProgress.logResult('tenaball', d5, { outcome: 'lost', score: '0/10' });
      const log = dailyProgress.readLog('tenaball');
      check(log[d5]?.late === true && log[d5].score === '9/10' && !log[d6]?.late, 'daily archive: a late day is not marked late, or was logged twice');
      const stats = dailyProgress.gameStats(log, d7);
      check(stats.played === 3 && stats.won === 2 && stats.streak === 2 && stats.best === 2, `daily archive: late day miscounted — ${JSON.stringify(stats)}`);
    } finally {
      delete g.window;
    }
  }

  if (facts && orgs && rankings && majors && teammates) {
    const data = { roster, majors, teammates, facts, orgs, rankings, socials };
    const byId = new Map(roster.players.map((player) => [player.id, player]));
    const lists = buildListCriteria(roster, facts, null, orgs, teammates, socials);
    const history: DailySet[] = [];
    let day = daily.DAILY_START;
    const DAYS = 30;
    for (let i = 0; i < DAYS; i++, day = daily.addDays(day, 1)) {
      const set = generateDaily(day, data, history, DAILY_GAMES);
      history.push(set);
      const p = set.puzzles;
      const missing = DAILY_GAMES.filter((game) => !p[game]);
      check(missing.length === 0, `daily ${day}: no puzzle for ${missing.join(', ')}`);
      if (i === 0) {
        check(JSON.stringify(generateDaily(day, data, [], DAILY_GAMES)) === JSON.stringify(set), `daily ${day}: two makings of the same day differ`);
      }

      // Fortnitedle: the answer typed straight away wins in one, and shares one row.
      const w = p.wordle && wordleDaily.restoreDaily(p.wordle, roster, null);
      check(Boolean(w), `daily ${day}: Fortnitedle did not rebuild`);
      if (w) {
        const won = wordle.submitGuess(w, w.answer);
        check(won.ok && won.state.status === 'won' && wordleDaily.result(won.ok ? won.state : w).score === '1/6', `daily ${day}: Fortnitedle's answer did not win in one`);
        if (won.ok) check(wordleDaily.shareGrid(won.state).join('') === '🟩'.repeat(w.answer.length), `daily ${day}: Fortnitedle's share grid is wrong`);
      }

      // Career Path and Who Are Ya: the descriptor's clues come back in order, and a saved round comes back too.
      const cp = p['career-path'] && careerDaily.restoreDaily(p['career-path'], majors, byId, null);
      check(Boolean(cp) && cp!.clues.map((c) => c.result.tournament.name).join('|') === p['career-path']!.clues.join('|'), `daily ${day}: Career Path did not rebuild its clues`);
      if (cp) {
        const skipped = career.revealNext(cp);
        const back = careerDaily.restoreDaily(p['career-path']!, majors, byId, snapClues(skipped));
        check(back?.revealed === 2, `daily ${day}: a saved Career Path round did not come back`);
        const solved = career.submitGuess(skipped, cp.secret);
        check(clueResult(solved).score === `2/${cp.clues.length}` && clueGrid(solved)[0].startsWith('⬛🟩'), `daily ${day}: Career Path's result reads ${clueResult(solved).score} ${clueGrid(solved).join('/')}`);
      }
      const wy = p['who-are-ya'] && whoDaily.restoreDaily(p['who-are-ya'], teammates, byId, null);
      check(Boolean(wy) && wy!.clues.map((c) => c.player.id).join('|') === p['who-are-ya']!.clues.join('|'), `daily ${day}: Who Are Ya did not rebuild its clues`);

      // No secret player twice on one day — the one-player games only (Tenite's names do not count).
      const secrets = DAILY_GAMES.flatMap((game) => playersIn(game, p[game]));
      check(
        secrets.length === SECRET_GAMES.length && new Set(secrets).size === secrets.length,
        `daily ${day}: one player is the secret in two games`,
      );

      // Contextinho: a secret with a career on record, a round that comes back
      // from a save, and the answer guessed first scores one guess, a 🎯.
      const cx = p.contextinho && cxDaily.restoreDaily(p.contextinho, byId, null);
      check(
        Boolean(cx) && majors.resultsFor(cx!.secret.id).length + facts.earlyResultsFor(cx!.secret.id).length >= cxDaily.DAILY_MIN_EVENTS,
        `daily ${day}: Contextinho did not rebuild, or its secret has too little on record`,
      );
      if (cx) {
        const other = roster.players.find((player) => player.id !== cx.secret.id && player.region === cx.secret.region)!;
        const once = contextinho.submitGuess(cx, other, true);
        const back = cxDaily.restoreDaily(p.contextinho!, byId, cxDaily.snapshot(once));
        check(back?.guesses.length === 1 && back.hints === 1 && back.guesses[0].player.id === other.id, `daily ${day}: a saved Contextinho round did not come back`);
        const won = contextinho.submitGuess(cx, cx.secret);
        const ranking = contextinho.rankAll(cx.secret, roster.players, contextinho.DEFAULT_WEIGHTS, { teammates, orgs, facts, majors });
        check(
          cxDaily.result(won).score === '1 guess' && cxDaily.shareGrid(won, ranking).join('') === '🎯',
          `daily ${day}: Contextinho's answer reads ${cxDaily.result(won).score} ${cxDaily.shareGrid(won, ranking).join('/')}`,
        );
      }

      // Higher or Lower: ten pairs of well-known players that rebuild, play to
      // the end through a wrong answer, come back from a snapshot, and pin.
      const hl = p['higher-lower'] && hlDaily.restoreDaily(p['higher-lower'], byId, null);
      check(
        Boolean(hl) && hlDaily.pairsIn(hl!) === hlDaily.DAILY_ROUNDS && hl!.chain.every((player) => knownPlayers(roster).has(player.id)),
        `daily ${day}: Higher or Lower did not rebuild ten pairs of well-known players`,
      );
      if (hl) {
        let perfect = hl;
        for (let i = 0; i < hlDaily.pairsIn(hl); i++) perfect = hlDaily.answer(perfect, hlDaily.truthAt(hl, i));
        check(
          hlDaily.finished(perfect) && hlDaily.result(perfect).score === '10/10' && hlDaily.result(perfect).outcome === 'won' &&
            hlDaily.shareGrid(perfect).join('') === '🟩'.repeat(10),
          `daily ${day}: Higher or Lower's right answers read ${hlDaily.result(perfect).score} ${hlDaily.shareGrid(perfect).join('/')}`,
        );
        const opposite = (answer: string) => (answer === 'higher' ? 'lower' : 'higher');
        const slipped = hlDaily.answer(hl, opposite(hlDaily.truthAt(hl, 0)));
        check(!hlDaily.finished(slipped) && !hlDaily.rightAt(slipped, 0), `daily ${day}: a wrong Higher or Lower answer ended the day`);
        const back = hlDaily.restoreDaily(p['higher-lower']!, byId, hlDaily.snapshot(slipped));
        check(back?.answers.length === 1 && hlDaily.scoreOf(back) === 0, `daily ${day}: a saved Higher or Lower round did not come back`);
        const ties = hl.chain.slice(1).filter((_player, i) => hlDaily.truthAt(hl, i) === 'equal').length;
        check(hl.category === 'fncsWins' || ties === 0, `daily ${day}: Higher or Lower dealt a tie on ${hl.category}`);
        const pinned = hlDaily.freezeDaily(p['higher-lower']!, roster);
        check(
          Boolean(pinned?.frozen) && pinned!.frozen!.length === hl.chain.length && hlDaily.freezeDaily(pinned!, roster) === null &&
            puzzleId(pinned) === puzzleId(p['higher-lower']),
          `daily ${day}: Higher or Lower did not pin its numbers, pinned twice, or would orphan a saved round`,
        );
        if (pinned?.frozen && hl.category !== 'age') {
          // The pinned numbers win over today's data: turn the first pair round and the answer turns with it.
          const frozen = [...pinned.frozen];
          [frozen[0], frozen[1]] = [frozen[1], frozen[0]];
          const swapped = hlDaily.restoreDaily({ ...pinned, frozen }, byId, null)!;
          check(hlDaily.truthAt(swapped, 0) !== hlDaily.truthAt(hl, 0) || frozen[0] === frozen[1], `daily ${day}: a pinned Higher or Lower day rebuilt from today's data`);
        }
      }

      // Tenaball: rebuilds, and a snapshot taken mid-round comes back the same.
      const tb = p.tenaball && tenaballDaily.restoreDaily(p.tenaball, rankings, roster, socials, majors, null, facts);
      check(
        Boolean(tb) && tb!.difficulty === 'hard' && tb!.lives === tenaball.DAILY_LIVES && tb!.maxLives === tenaball.DAILY_LIVES,
        `daily ${day}: Tenaball did not rebuild on Hard with ${tenaball.DAILY_LIVES} lives`,
      );
      if (tb) {
        const first = tenaball.slotsIn(tb)[0].members[0];
        const one = tenaball.applyGuess(tb, first.key, first.label).state;
        const wrong = tenaball.applyGuess(one, '__nobody__', 'Nobody').state;
        const back = tenaballDaily.restoreDaily(p.tenaball!, rankings, roster, socials, majors, tenaballDaily.snapshot(wrong), facts);
        check(back?.lives === wrong.lives && back?.found.size === wrong.found.size && tenaball.namedIn(back, 1).has(first.key), `daily ${day}: a saved Tenaball round did not come back`);
        const grid = tenaballDaily.shareGrid(wrong);
        check(grid.length === 3, `daily ${day}: Tenaball's share grid is not two rows and the lives`);
        check([...grid[2]].filter((ch) => ch === '🖤').length === 1, `daily ${day}: Tenaball's share grid does not show one life lost`);
        // A round saved on the old three lives: still going, it gets the two new
        // ones; finished, it keeps its hearts out of three.
        const old = { ...tenaballDaily.snapshot(wrong), lives: 2, maxLives: undefined };
        const resumed = tenaballDaily.restoreDaily(p.tenaball!, rankings, roster, socials, majors, old, facts);
        check(resumed?.lives === 4 && resumed.maxLives === tenaball.DAILY_LIVES, `daily ${day}: an old three-life Tenaball round did not get its two new lives`);
        const ended = tenaballDaily.restoreDaily(p.tenaball!, rankings, roster, socials, majors, { ...old, lives: 0, status: 'lost' }, facts);
        check(ended?.lives === 0 && ended.maxLives === tenaball.HARD_LIVES, `daily ${day}: a finished three-life Tenaball round changed its hearts`);

        // Pinned on its day: the board plays from the descriptor, whatever the
        // data says later, and a round saved before the pin still comes back.
        const pinned = tenaballDaily.freezeDaily(p.tenaball!, rankings, roster, socials, majors, day, facts)!;
        check(
          Boolean(pinned?.frozen) && tenaballDaily.freezeDaily(pinned, rankings, roster, socials, majors, day, facts) === null,
          `daily ${day}: Tenite's board did not pin, or pinned twice`,
        );
        const moved = { ...pinned.frozen!, rows: pinned.frozen!.rows.map((row, i) => (i === 0 ? { ...row, display: 'pinned' } : row)) };
        const fromPin = tenaballDaily.restoreDaily({ ...pinned, frozen: moved }, rankings, roster, socials, majors, null, facts);
        check(fromPin?.board.rows[0].display === 'pinned', `daily ${day}: a pinned Tenite day rebuilt from today's data`);
        check(
          !pinned.frozen!.id.startsWith('tournament:') ? pinned.frozen!.asOf !== undefined : pinned.frozen!.asOf === undefined,
          `daily ${day}: Tenite's pinned board ${pinned.frozen!.id} has the wrong "as of"`,
        );
        check(
          puzzleId(pinned) === puzzleId(p.tenaball) && puzzleId(pinned) === puzzleId(JSON.parse(JSON.stringify(p.tenaball))),
          `daily ${day}: pinning Tenite's board would orphan a round saved before it`,
        );
      }

      // List: the list exists and fits the daily's bounds.
      const list = p.list && lists.find((entry) => entry.id === p.list!.list);
      check(Boolean(list) && list!.answers.length >= 10 && list!.answers.length <= 60, `daily ${day}: List's list is missing or out of bounds`);

      // Tic Tac Toe: the six rules rebuild a grid nine different players can fill.
      const tt = p['tic-tac-toe'] && tttDaily.restoreDaily(p['tic-tac-toe'], roster, facts, orgs, socials, byId, null);
      check(Boolean(tt) && tt!.difficulty === tttDaily.DAILY_LEVEL, `daily ${day}: Tic Tac Toe did not rebuild`);
      if (tt) check(tt.board.candidates.flat().every((cell) => cell.length >= 1), `daily ${day}: Tic Tac Toe has an empty cell`);
    }
    // Higher or Lower changes category every day, and a player sits out a week at least.
    const categories = history.map((set) => set.puzzles['higher-lower']?.category);
    check(categories.every((category, i) => i === 0 || category !== categories[i - 1]), `daily: Higher or Lower had one category two days running`);
    const hlAgain = history.flatMap((set, i) =>
      (set.puzzles['higher-lower']?.players ?? []).filter((id) =>
        history.slice(Math.max(0, i - 7), i).some((before) => before.puzzles['higher-lower']?.players.includes(id)),
      ),
    );
    check(hlAgain.length === 0, `daily: Higher or Lower brought back ${hlAgain.slice(0, 3).join(', ')} within a week`);
    // A daily that starts later is filled into a day already kept: the kept
    // puzzle stays, and the new ones keep clear of its players.
    {
      const later = daily.addDays(day, 1);
      const kept = generateDaily(later, data, history, ['tenaball']);
      const filled = generateDaily(later, data, history, missingFrom(kept), kept);
      const live = gamesOn(later);
      const owners = live.flatMap((game) => playersIn(game, filled.puzzles[game]));
      check(
        puzzleId(filled.puzzles.tenaball) === puzzleId(kept.puzzles.tenaball) &&
          live.every((game) => filled.puzzles[game]) &&
          new Set(owners).size === owners.length,
        `daily ${later}: filling in a kept day changed it, missed a game, or put a player in two games`,
      );
      // Pinning a day pins Tenite's board, and Higher or Lower's numbers too.
      const withPairs = generateDaily(later, data, history, ['higher-lower'], filled);
      const frozenDay = freezeDay(withPairs, data, later);
      check(
        Boolean(frozenDay?.puzzles.tenaball?.frozen && frozenDay.puzzles['higher-lower']?.frozen),
        `daily ${later}: pinning a day did not pin both Tenite's board and Higher or Lower's numbers`,
      );
    }
    const window = (game: 'wordle' | 'career-path' | 'who-are-ya' | 'contextinho') => history.map((set) => set.puzzles[game]?.secret);
    const allSecrets = [...window('wordle'), ...window('career-path'), ...window('who-are-ya'), ...window('contextinho')];
    check(new Set(allSecrets).size === allSecrets.length, `daily: a secret player came back within ${DAYS} days`);
    const boards = history.map((set) => set.puzzles.tenaball?.board);
    const listIds = history.map((set) => set.puzzles.list?.list);
    check(new Set(boards).size === DAYS && new Set(listIds).size === DAYS, `daily: a Tenaball board or a List came back within ${DAYS} days`);
    // Neighbouring days look different: no kind twice within KIND_GAP days, no Tenaball family within FAMILY_GAP.
    const boardById = new Map(tenaballDaily.dailyBoards(rankings, roster, socials, majors, facts).map((board) => [board.id, board]));
    const listById = new Map(lists.map((entry) => [entry.id, entry]));
    const clashes = (ids: (string | undefined)[], key: (id: string) => string | null, gap: number) =>
      ids.flatMap((id, i) =>
        ids.slice(Math.max(0, i - gap), i).flatMap((before, k) => {
          const a = id && key(id);
          return a && before && key(before) === a ? [`${history[Math.max(0, i - gap) + k].day}/${history[i].day} ${a}`] : [];
        }),
      );
    const near = [
      ...clashes(boards, (id) => tenaballDaily.kindOf(boardById.get(id)!), reuse.KIND_GAP),
      ...clashes(boards, (id) => tenaballDaily.familyOf(boardById.get(id)!), reuse.FAMILY_GAP),
      ...clashes(listIds, (id) => listDaily.kindOf(listById.get(id)!), reuse.KIND_GAP),
    ];
    check(near.length === 0, `daily: neighbouring days look alike — ${near.slice(0, 4).join('; ')}`);
    // A board with the same answers rests SAME_REST days, a changed one CHANGED_REST.
    {
      const same = (days: number) => reuse.resting([{ daysAgo: days, id: 'b', sig: 'x' }], () => 'x', Infinity).has('b');
      const moved = (days: number) => reuse.resting([{ daysAgo: days, id: 'b', sig: 'x' }], () => 'y', Infinity).has('b');
      check(
        same(reuse.SAME_REST) && !same(reuse.SAME_REST + 1) && moved(reuse.CHANGED_REST) && !moved(reuse.CHANGED_REST + 1),
        'daily: a board does not come back after its rest',
      );
    }
    const onStatus = boards.filter((id) => id && /(^|[-:])active([-:]|$)/.test(id));
    check(onStatus.length === 0, `daily: Tenaball boards that rank on active status — ${onStatus.join(', ')}`);
    const known = knownPlayers(roster);
    const famous = allSecrets.filter((id) => known.has(id!)).length;
    check(famous === allSecrets.length, `daily: ${allSecrets.length - famous} secret players are not well known`);
    notes.push(`daily: ${DAYS} days made — ${new Set(allSecrets).size} different secret players, ${allSecrets.filter((id) => byId.get(id!)?.tier === 'easy').length} of them famous`);
  } else {
    skipped.push('daily puzzles (needs facts, orgs, rankings, career_path and teammates)');
  }
}

// ------------------------------------------------------------------- report --
console.log('\n=== notes ===');
for (const note of notes) console.log('  ' + note);

if (skipped.length > 0) {
  console.log('\n=== skipped (run scripts/build_data.py) ===');
  for (const item of skipped) console.log('  ' + item);
}

if (problems.length > 0) {
  console.log(`\n=== ${problems.length} PROBLEM(S) ===`);
  for (const problem of problems) console.log('  ✗ ' + problem);
  process.exit(1);
}
console.log('\n✓ all checks passed');
