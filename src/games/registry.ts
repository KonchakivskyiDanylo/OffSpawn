import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { TermId } from './shared/glossary';
import { SHOW_STATUS } from './shared/pool';

/** A named block of rules, e.g. "Game modes". */
export interface RuleSection {
  title: string;
  items: string[];
  /**
   * About a setup choice — a mode, a level, who the pool is — and so left out
   * of the daily puzzle's rules, where there is nothing to choose.
   */
  practiceOnly?: boolean;
}

export interface GameMeta {
  /**
   * Stable key. Local best scores and the "seen the rules" flag hang off it, so
   * renaming a game changes its `title` and `slug` and leaves this alone.
   */
  id: string;
  /** URL path segment. */
  slug: string;
  title: string;
  /** One-line pitch for the home page card. */
  tagline: string;
  /**
   * The game's own page in search results: a title that says what the game is
   * to someone who has never heard of it, and the description under it. Without
   * one the title and tagline stand in. See `lib/seo.ts`.
   */
  seo?: { title: string; description: string };
  icon: string;
  /**
   * Short bullets shown in the "How to play" card and modal. Optional: a game
   * that explains itself with `intro` and `sections` needs no flat list.
   */
  rules?: string[];
  /**
   * Opening paragraphs above the bullets, for games whose rules read better as
   * prose than as a list.
   */
  intro?: string[];
  /** Grouped rules shown under their own headings, below `rules`. */
  sections?: RuleSection[];
  /**
   * The terms this game leans on — a major, a LAN, a nationality — defined
   * under "What the words mean". See `games/shared/glossary.ts`.
   */
  terms?: TermId[];
  /**
   * The rules of the daily puzzle, where they differ: the bullets that name a
   * level ("Easy: unlimited guesses") give way to the one level the daily is
   * played at. Sections marked `practiceOnly` are dropped there too.
   */
  daily?: { rules: string[] };
  /** Shows YouTube or Twitch counts somewhere, so its rules carry their source line (`SocialsNote`). */
  socials?: true;
  /**
   * Not ready to host: left off the home page and the side nav, and a
   * production build sends its address back home. A dev server still opens it
   * by URL, so it can be worked on; `check:games` still plays it. Delete the
   * flag to bring it back.
   */
  hidden?: boolean;
  Component: LazyExoticComponent<ComponentType>;
}

/**
 * Rules every game repeats, written once.
 *
 * Six of the ten share a setup step (see `components/PoolSetup`), so six
 * rules panels were about to say the same three paragraphs in three slightly
 * different ways. Higher or Lower and Tic Tac Toe left it for a single
 * Easy / Medium / Hard of their own (`LevelSetup`), and explain that instead.
 */
const POOL_SECTION: RuleSection = {
  title: 'Who you get asked about',
  practiceOnly: true,
  items: [
    'Random 🎲 — anyone, leaning to names you know: half the rounds famous players, a third regulars, the rest deep cuts.',
    SHOW_STATUS
      ? 'Choose 🎛️ — pick a region, a difficulty and active or retired. Remembered across games.'
      : 'Choose 🎛️ — pick a region and a difficulty. Remembered across games.',
    'Region — difficulty is then ranked inside it: Easy means well known in Asia, not worldwide.',
    'Difficulty — Easy 🟢 famous names, Medium 🟡 regulars, Hard 🔴 deep cuts, Any 🎲 all three, mixed like Random.',
    ...(SHOW_STATUS ? ['Active, retired or everyone — as Liquipedia records it.'] : []),
  ],
};

export const GAMES: GameMeta[] = [
  {
    id: 'higher-lower',
    // `socials: true` comes back with the Twitch and YouTube categories (hidden since 13 Oct 2026).
    slug: 'higher-lower',
    title: 'Higher or Lower',
    tagline: 'Is the next player above or below? Keep the streak alive.',
    seo: {
      title: 'Fortnite Higher or Lower: pro earnings, FNCS wins and age',
      description:
        'Is the next competitive Fortnite player higher or lower? Compare pros on career earnings, FNCS wins and age, and keep your streak alive.',
    },
    icon: '📈',
    intro: ['Is the player on the right higher or lower than the one on the left, in your category?'],
    rules: ['A right answer scores a point and brings in a new player. One wrong answer ends the run.'],
    // Ten fixed pairs a day since 22 Oct 2026 (`higher-lower/daily.ts`): every pair is played.
    daily: {
      rules: [
        'Ten pairs, the same for everyone, in one category: Age, Career Earnings or FNCS Wins.',
        'The player you just revealed stays on as the one to beat.',
        'Every pair is played: a wrong answer turns red and the next pair comes. Your score is how many of the ten you got right.',
        'It starts with famous players far apart and gets closer.',
      ],
    },
    sections: [
      {
        title: 'Categories',
        items: [
          'Age — older or younger, by birthday.',
          'Career Earnings — all tournament prize money on record.',
          'FNCS Wins — regional FNCS grand finals won. Players with none come up too.',
        ],
      },
      {
        title: 'Difficulty',
        practiceOnly: true,
        items: [
          'A run starts with famous players far apart, then gets less known and closer. Easy ramps up slowly, Medium faster, Hard fastest.',
        ],
      },
      {
        title: 'Ties',
        items: [
          'Only FNCS Wins has Equal: two players on the same number, none included, are level, and only Equal is right.',
          'Age compares birthdays, so it is never level. Earnings never are either.',
        ],
      },
    ],
    // 'fncs-final' comes back with the FNCS Finals category (hidden since 13 Oct 2026).
    terms: ['earnings', 'age', 'fncs-title'],
    Component: lazy(() => import('./higher-lower/HigherLowerGame')),
  },
  {
    id: 'wordle',
    slug: 'fortnitedle',
    title: 'Fortnitedle',
    tagline: 'Guess the player’s name, letter by letter.',
    seo: {
      title: 'Fortnitedle: guess the competitive Fortnite player',
      description:
        'Wordle for competitive Fortnite: guess the pro player’s name in six tries, with the tiles showing how close each guess is.',
    },
    icon: '🟩',
    intro: ['Guess the player in 6 tries. The tiles show how close each guess is to the name.'],
    rules: [
      'Spaces, punctuation and capitals are ignored.',
      'Digits 0–9 count and are on the keyboard.',
      'Any letters and digits are allowed — a guess need not be a real player.',
      'Player names only (under Choose): every guess must be a real player’s name. Anything else is refused at no cost.',
      'From your third guess you are told if the name has a digit, not which or where.',
      'Every player in the pool comes up once before any comes round again.',
    ],
    daily: {
      rules: [
        'Spaces, punctuation and capitals are ignored.',
        'Digits 0–9 count and are on the keyboard.',
        'Any letters and digits are allowed — a guess need not be a real player.',
        'From your third guess you are told if the name has a digit, not which or where.',
      ],
    },
    sections: [POOL_SECTION],
    terms: ['region'],
    Component: lazy(() => import('./wordle/WordleGame')),
  },
  {
    id: 'career-path',
    slug: 'career-path',
    title: 'Career Path',
    tagline: 'Name the player from their major results alone.',
    seo: {
      title: 'Fortnite Career Path: name the pro from their results',
      description:
        'A competitive Fortnite player’s results — FNCS grand finals, the Globals, the World Cup — revealed one at a time. Name the pro from their career alone.',
    },
    icon: '🗺️',
    intro: [
      'Up to ten of a player’s major results are revealed one at a time. Name the player.',
      'A wrong guess reveals the next clue; run out and you lose. Fewer clues is better.',
    ],
    rules: [
      'Majors only: Epic’s grand finals since the 2019 World Cup — regional FNCS finals, the Globals, the World Cup.',
      'Each clue is a tournament and the player’s finish.',
      'Only players with five or more majors can be the answer.',
      'When the round ends, the clues you did not need are shown, dimmed.',
    ],
    sections: [
      {
        title: 'Game modes',
        practiceOnly: true,
        items: [
          'Random — ten results from any year, best results last.',
          'Order — ten results from across the career, oldest first.',
        ],
      },
      {
        title: 'Which results',
        items: [
          'A mix of finishes, favouring big stages.',
          'Famous players never open on a win or a $1M podium: none in the first three clues, or the first two for regulars.',
          'The clues fit one player only, except a few duos who played every major together.',
        ],
      },
      POOL_SECTION,
    ],
    terms: ['major', 'global', 'lan'],
    Component: lazy(() => import('./career-path/CareerPathGame')),
  },
  {
    // Who Are Ya? until 14 Oct 2026 (the user: "rename it to ready up", not
    // Duo Finder, because "there are trio, squad tournaments as well"). The id
    // stays, so progress carries over; the old address redirects (`moved.ts`).
    id: 'who-are-ya',
    slug: 'ready-up',
    title: 'Ready Up',
    tagline: 'Name the player from the teammates they queue with.',
    seo: {
      title: 'Ready Up: guess the Fortnite pro from their teammates',
      description:
        'The teammates a competitive Fortnite player has entered tournaments with are revealed one by one. Name the pro from the company they keep.',
    },
    icon: '🤝',
    intro: [
      'A secret player’s teammates are revealed one at a time. Name the player.',
      'Guess after any clue. The round ends on a right guess or when the clues run out.',
    ],
    rules: [
      'Teammates are ranked by tournaments entered together.',
      'A clue is a teammate with three or more tournaments together. The answer has at least three such teammates and five majors.',
      'When the round ends, the full list is shown with the counts.',
    ],
    daily: {
      rules: [
        'Teammates come fewest shared tournaments first, each with its count. Equal counts can come in either order.',
        'A clue is a teammate with three or more tournaments together. The answer has at least three such teammates and five majors.',
        'When the round ends, the full list is shown.',
      ],
    },
    sections: [
      {
        title: 'Clue order',
        practiceOnly: true,
        items: [
          'Counts shown — fewest to most shared tournaments, with each count.',
          'Counts hidden — the same order, no numbers.',
          'Random order — no ramp and no counts. The top teammate is never in the first four.',
          'Teammates on the same count can come in either order.',
        ],
      },
      POOL_SECTION,
    ],
    terms: ['teammates', 'tournament'],
    Component: lazy(() => import('./who-are-ya/WhoAreYaGame')),
  },
  {
    // Tenaball until 13 Oct 2026 (the user: a football name). The id stays, so
    // best scores and daily progress carry over; the old address redirects.
    id: 'tenaball',
    socials: true,
    slug: 'tenite',
    title: 'Tenite',
    tagline: 'Find all ten players in a top 10.',
    seo: {
      title: 'Tenite: name the competitive Fortnite top 10',
      description:
        'One competitive Fortnite leaderboard, ten empty slots: top earners, FNCS and LAN results, Div Cups, countries and organisations. Name all ten.',
    },
    icon: '🔟',
    intro: [
      'One leaderboard — "Top 10 by major LAN earnings", "Top 10 countries by FNCS wins" — and ten empty slots. Name all ten.',
      'Right answers lock into their place.',
    ],
    rules: [
      'Easy: unlimited guesses.',
      'Hard: 3 lives; every wrong guess costs one, 11th place included.',
      'On a duos or trios board a slot is a whole team, filled once everyone on it is named.',
      '“What counts here” under the board explains its terms.',
    ],
    daily: {
      rules: [
        '5 lives; every wrong guess costs one, 11th place included.',
        'On a duos or trios board a slot is a whole team, filled once everyone on it is named.',
        'The numbers are as of the date beside the title, and a day’s board never changes.',
        '“What counts here” under the board explains its terms.',
      ],
    },
    sections: [
      {
        title: 'Categories',
        practiceOnly: true,
        items: [
          'About nine hundred boards: players, regions, countries, tournaments, FNCS finals, season averages, Div Cups, organisations, paydays. Pick one or hit Random.',
          'Some boards want an organisation, a country or a tournament — the input says which.',
        ],
      },
      {
        title: 'Ties',
        items: [
          'Each board states its tie rule. Most split level players by career earnings.',
          'If 10th and 11th are still level, either fills 10th.',
          'Naming 11th is wrong and costs a life; the game tells you it was 11th.',
        ],
      },
    ],
    terms: [
      'tournament',
      'major',
      'lan',
      'lan-wide',
      'global',
      'fncs-title',
      'fncs-final',
      'nationality',
      'region',
      'org',
      'earnings',
      'age',
      'teammates',
    ],
    Component: lazy(() => import('./tenaball/TenaballGame')),
  },
  {
    id: 'list',
    socials: true,
    slug: 'list',
    title: 'List',
    tagline: 'Name as many players as you can before the clock runs out.',
    seo: {
      title: 'Fortnite List: name every pro before the clock runs out',
      description:
        'Ninety seconds to name as many competitive Fortnite players as you can: FNCS winners, Div Cup regulars, an organisation’s players, a country’s top earners.',
    },
    icon: '⏱️',
    intro: [
      'One list, ninety seconds: name as many as you can.',
      'Every right name scores a point and adds 5 seconds.',
    ],
    rules: [
      'A name counts once.',
      'Easy: wrong answers cost nothing.',
      'Hard: every wrong answer takes 3 seconds off.',
      'Name everyone and you win on the spot.',
      'When time runs out you see who you missed.',
      'The suggestions help you spell a name; they never say whether it is on the list.',
    ],
    daily: {
      rules: [
        'A name counts once.',
        'Every wrong answer takes 3 seconds off.',
        'Name everyone and you win on the spot.',
        'When time runs out you see who you missed.',
        'The suggestions help you spell a name; they never say whether it is on the list.',
        '“What counts here” under the list explains its terms.',
      ],
    },
    sections: [
      {
        title: 'The lists',
        practiceOnly: true,
        items: [
          'Over three hundred: an organisation’s players, FNCS winners by region or year, Div Cups, earnings thresholds, countries, the top earners’ teammates, who played two events.',
          '“What counts here” under each list explains its terms.',
        ],
      },
    ],
    terms: [
      'field',
      'region',
      'nationality',
      'org',
      'fncs-title',
      'fncs-final',
      'major',
      'lan',
      'global',
      'earnings',
      'teammates',
    ],
    // Hidden 4 Oct 2026: too close to Tenaball for now, back in about a month.
    hidden: true,
    Component: lazy(() => import('./list/ListGame')),
  },
  {
    id: 'impostor',
    socials: true,
    slug: 'griefer',
    title: 'Griefer',
    tagline: 'Spot the players who actually belong.',
    icon: '🕵️',
    intro: [
      'A rule — "has played for NRG", "has won a major LAN" — and ten players. Four to six fit; the rest are griefers. Find the ones who fit.',
    ],
    rules: [
      'Cards show the handle only.',
      'The board never says how many fit.',
      'Most griefers nearly fit: one title short, just under the money, the next country over.',
    ],
    sections: [
      {
        title: 'Game modes',
        items: [
          'All at once — select everyone who fits, then Check. It must be exactly right.',
          'One by one — tap a player, then confirm. A griefer ends the round.',
        ],
      },
      {
        title: 'The rules you will see',
        items: [
          'Organisations — has played for an org, at any time.',
          'Titles — has won an FNCS, a major LAN, a Global Championship, or 2+ FNCS titles.',
          'Career earnings over a threshold.',
          'Won a region’s FNCS, or an FNCS in a given year — regional finals only.',
          'Played a given Globals or major LAN.',
          'Country and region.',
        ],
      },
      POOL_SECTION,
    ],
    terms: ['org', 'fncs-title', 'lan', 'global', 'earnings', 'nationality', 'region'],
    // Hidden 26 Sep 2026: one of Griefer, Connections and Tic Tac Toe for now, and
    // Tic Tac Toe is the one kept. Its griefers are near misses since 3 Oct 2026.
    hidden: true,
    Component: lazy(() => import('./impostor/ImpostorGame')),
  },
  {
    // Tic Tac Toe until 14 Oct 2026: a 3×3 grid of boxes, and a Fortnite term.
    // The id stays; the old address redirects (`moved.ts`).
    id: 'tic-tac-toe',
    socials: true,
    slug: 'box-fight',
    title: 'Box Fight',
    tagline: 'Fill the grid with players who match both conditions.',
    seo: {
      title: 'Box Fight: Fortnite tic tac toe with pro players',
      description:
        'Fill a 3×3 grid with competitive Fortnite players who fit both their row and their column: country, region, organisation, FNCS titles, LANs and earnings.',
    },
    icon: '⭕',
    intro: [
      'Every row and column is a category. Fill each cell with a player who fits both.',
      'Type a name and the grid places it; if it fits several cells, tap one.',
    ],
    rules: [
      'A player who fits no open cell costs a life.',
      'Each player can be used once.',
      'No player fits more than 4 cells on Easy, 3 on Medium, 2 on Hard.',
      'You are only offered cells that keep the rest of the grid fillable.',
    ],
    daily: {
      rules: [
        '3 lives: a player who fits no open cell costs one.',
        'Each player can be used once.',
        'Every cell has two or more well-known answers; no player fits more than 3 cells.',
        'You are only offered cells that keep the rest of the grid fillable.',
      ],
    },
    sections: [
      {
        title: 'Difficulty',
        practiceOnly: true,
        items: [
          'Easy 🟢 — three famous answers in every cell. 3 lives.',
          'Medium 🟡 — two regulars in every cell. 3 lives.',
          'Hard 🔴 — a cell may have one answer. 1 life.',
          'Any player who fits is accepted.',
        ],
      },
      {
        title: 'Categories',
        items: [
          'Won EU FNCS, Won FNCS in 2023, Won a Duo FNCS — regional finals; a Globals is not an FNCS win.',
          'Won FNCS with Peterbot — was on one of their winning teams.',
          'FNCS winner before 16 — age on the day of the final.',
          'Won FNCS back to back — two rounds of finals in a row, any region.',
          'Won majors back to back — two majors in a row, the Globals and LANs included: losing the Globals between two FNCS wins ends it.',
          'Top 3 at a major LAN. Played at an event — was in its field.',
          'Hard only: Div Cups, Performance Evaluations and a year’s prize money.',
        ],
      },
    ],
    terms: ['nationality', 'region', 'org', 'fncs-title', 'lan', 'global', 'major', 'earnings', 'age', 'div-cup', 'fpe'],
    Component: lazy(() => import('./tic-tac-toe/TicTacToeGame')),
  },
  {
    // Connections until 14 Oct 2026: four groups of four, like squads. The id
    // stays; the old address redirects (`moved.ts`).
    id: 'connections',
    socials: true,
    slug: 'squads',
    title: 'Squads',
    tagline: 'Sort 16 players into the 4 squads they belong to.',
    icon: '🧩',
    intro: [
      '16 players, 4 hidden groups of 4. Select four and submit; a right group locks in and shows its connection.',
      'You have 4 lives; every wrong group costs one.',
    ],
    rules: [
      'A group is a country, a region, an organisation, a title (FNCS, major, major LAN) or an earnings threshold.',
      'Each connection fits exactly its four: if the group is Poland, there is no fifth Pole.',
      'A wrong guess with three of one group says so.',
    ],
    sections: [POOL_SECTION],
    terms: ['nationality', 'region', 'org', 'fncs-title', 'lan', 'major', 'earnings'],
    // Hidden 26 Sep 2026 in favour of Tic Tac Toe; thin pools cannot build a board.
    hidden: true,
    Component: lazy(() => import('./connections/ConnectionsGame')),
  },
  {
    id: 'guess-the-player',
    socials: true,
    slug: 'guess-the-player',
    title: 'Guess the Player',
    tagline: 'Narrow down the secret player attribute by attribute.',
    icon: '🎯',
    intro: [
      'Guess any player to see how they compare with the secret one, column by column. Close in from there.',
      'You have 8 lives; every wrong guess costs one.',
    ],
    rules: [
      'Green is a match, red is not; arrows show which way.',
      'Columns: region, country, status, age, career earnings, FNCS wins, FNCS finals, played together, Twitch followers.',
      'Together is green at 10+ tournaments as teammates; a red cell shows how many.',
      'Career earnings always show a direction.',
      'You can guess anyone. A player with no published birthday shows — for age.',
      'The secret always has a birthday and earnings on record.',
    ],
    sections: [
      {
        title: 'Feedback style',
        items: ['Exact — age and FNCS counts are right or wrong.', 'Direction — ▲ the secret is higher, ▼ lower.'],
      },
      {
        title: 'Ties',
        items: ['A number equal to the secret’s is green, with no arrow.', 'Country compares each player’s first nationality.'],
      },
      POOL_SECTION,
    ],
    terms: ['region', 'nationality', 'age', 'earnings', 'fncs-title', 'fncs-final', 'teammates'],
    // Hidden 26 Sep 2026: needs more than the columns it has before it is hosted.
    hidden: true,
    Component: lazy(() => import('./guess-the-player/GuessThePlayerGame')),
  },
  {
    id: 'pyramid',
    socials: true,
    slug: 'pyramid',
    title: 'Pyramid',
    tagline: 'Sort ten players into order, best at the top.',
    icon: '🔺',
    intro: [
      'Ten players, one category — FNCS finals or titles, earnings, age, or ten finishers at one tournament. Sort them into the pyramid in the order the card asks, then check.',
      'Players in the right place turn green and lock.',
    ],
    rules: [
      'Tap two players to swap them, or drag one onto another.',
      'Players level on the value can go either way round.',
      'Age goes by birth date, youngest at the top.',
    ],
    sections: [
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — famous players; check as often as you like. A tournament’s ten come from its top 20.',
          'Medium 🟡 — regulars too, closer values, 2 lives (a wrong check costs one). Top 30.',
          'Hard 🔴 — anyone, the closest values, 1 life. Anywhere in the results.',
        ],
      },
    ],
    terms: ['fncs-final', 'fncs-title', 'earnings', 'age'],
    // New 30 Sep 2026, not hosted yet.
    hidden: true,
    Component: lazy(() => import('./pyramid/PyramidGame')),
  },
  {
    id: 'bingo',
    socials: true,
    slug: 'bingo',
    title: 'Bingo',
    tagline: 'Players are dealt one by one — put each on a square or skip, and fill all 16.',
    icon: '🎱',
    intro: [
      'Every square is a category. Players are dealt one at a time: tap a square they fit, or skip them. Fill the whole card to win.',
    ],
    rules: [
      'A player on a square they do not fit costs a life, and that player.',
      'Skipping is free — some players fit nothing on the card.',
      'No player fits more than 5 squares.',
      'Your best is your quickest full card: the fewest players, or on Timed the fewest seconds.',
    ],
    sections: [
      {
        title: 'Modes',
        items: [
          'Deck 🃏 — a set deck, each player once. It always holds a full card, with some to spare.',
          'Timed ⏱️ — random players until the clock runs out. One can come back, never twice in a row. The fewer squares open, the likelier the next player fits one.',
          'Endless ♾️ — the same, with no clock.',
        ],
      },
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — famous players: a 40-player deck or 2:00 on the clock, 3 lives.',
          'Medium 🟡 — the regulars too: 35 players or 1:45, 3 lives.',
          'Hard 🔴 — anyone: 30 players or 1:30, 2 lives.',
        ],
      },
    ],
    terms: ['nationality', 'region', 'org', 'fncs-title', 'fncs-final', 'major', 'lan', 'global', 'earnings', 'teammates'],
    // New 30 Sep 2026, not hosted yet.
    hidden: true,
    Component: lazy(() => import('./bingo/BingoGame')),
  },
  // The seven below were added on 2 Oct 2026 from the user's roadmaps, hidden
  // until they say otherwise. They open on `LevelSetup`, with the pools in
  // `games/shared/levels.ts`.
  {
    id: 'curveball',
    slug: 'curveball',
    title: 'Curveball',
    tagline: 'A career’s prize money drawn as a curve, one year at a time. Whose is it?',
    icon: '📉',
    intro: [
      'A player’s prize money is drawn year by year. Name the player.',
      'A wrong guess or a skip draws the next year. Run out and you lose.',
    ],
    rules: [
      'The curve runs from the player’s first paid year to the last, empty years included.',
      'A curve under five years still gets five guesses.',
      'Every curve shares one scale, squeezed above $1M.',
    ],
    sections: [
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — famous names.',
          'Medium 🟡 — regulars too.',
          'Hard 🔴 — anyone with three paid years.',
        ],
      },
    ],
    terms: ['earnings'],
    hidden: true,
    Component: lazy(() => import('./curveball/CurveballGame')),
  },
  {
    id: 'org-chart',
    slug: 'org-chart',
    title: 'Org Chart',
    tagline: 'Name the organisation from the players who wore its jersey.',
    icon: '🏢',
    intro: [
      'An organisation’s players are revealed one at a time, up to eight. Name the org.',
      'A wrong guess or a skip reveals the next clue. Run out and you lose.',
    ],
    rules: [
      'Its best-known players are never in the first three.',
      'Between players come the org’s region, founding year and prize money.',
    ],
    sections: [
      {
        title: 'Clues',
        items: ['Full dates — when each player joined and left.', 'Joined — when they joined.', 'Names only.'],
      },
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — the 25 richest organisations.',
          'Medium 🟡 — the top 75.',
          'Hard 🔴 — any org with a Liquipedia page and five players.',
        ],
      },
    ],
    terms: ['org', 'region', 'earnings'],
    hidden: true,
    Component: lazy(() => import('./org-chart/OrgChartGame')),
  },
  {
    id: 'contextinho',
    slug: 'contextinho',
    title: 'Contextinho',
    tagline: 'Every guess gets a rank. How close are you to the secret player?',
    icon: '🌡️',
    intro: [
      'Find the secret player. Every guess gets a rank: how close that player is to the secret one, out of everyone on record. #1 is the answer.',
      'Close means alike. Teammates rank highest — above all a title or a big LAN won together, and recent ones most — then the same majors, years and organisations, nationality (nearby countries count partly), age and region.',
    ],
    rules: ['Guesses are unlimited.', 'A hint names a player halfway between your best guess and #1.'],
    sections: [
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — the secret is a name everyone knows.',
          'Medium 🟡 — a regular of the scene.',
          'Hard 🔴 — anyone who has played with a teammate.',
        ],
      },
    ],
    terms: ['teammates', 'fncs-title', 'lan', 'major', 'org', 'nationality', 'region', 'age'],
    hidden: true,
    Component: lazy(() => import('./contextinho/ContextinhoGame')),
  },
  {
    id: 'rewind',
    slug: 'rewind',
    title: 'Rewind',
    tagline: 'Put competitive Fortnite history back in order.',
    icon: '⏪',
    intro: [
      'Moments from competitive Fortnite — a World Cup win, a first FNCS final, a signing, a best year for prize money. Put them in order, oldest at the top, then check.',
      'Every moment in the right place turns green, locks and shows its date.',
    ],
    rules: [
      'Drag a card, tap two to swap them, or use the arrows.',
      'Prize money is recorded by the year, so a prize-money moment has its whole year to itself.',
    ],
    sections: [
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — 7 moments about famous names, far apart. Check as often as you like.',
          'Medium 🟡 — 8 moments, closer together. 2 lives.',
          'Hard 🔴 — 10 moments, anyone. 2 lives.',
        ],
      },
    ],
    terms: ['fncs-title', 'fncs-final', 'global', 'lan', 'org', 'earnings'],
    hidden: true,
    Component: lazy(() => import('./rewind/RewindGame')),
  },
  {
    id: 'irl',
    socials: true,
    slug: 'irl',
    title: 'IRL',
    tagline: 'A real name. Which player is behind it?',
    icon: '🪪',
    intro: [
      'You get a real name. Name the player behind it.',
      'A wrong guess or a skip adds the next line of their file: nationality, age, organisations, titles — last, the shape of their handle.',
    ],
    rules: ['The real name is the one on their Liquipedia page.'],
    sections: [
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — the names everyone knows.',
          'Medium 🟡 — the regulars of the scene too.',
          'Hard 🔴 — anyone with a published real name.',
        ],
      },
    ],
    terms: ['nationality', 'org', 'fncs-title', 'earnings', 'teammates', 'major'],
    hidden: true,
    Component: lazy(() => import('./irl/IrlGame')),
  },
  {
    id: 'transfer-window',
    slug: 'transfer-window',
    title: 'Transfer Window',
    tagline: 'Every org a player signed for. Who made the moves?',
    icon: '🔁',
    intro: [
      'A player’s organisations are revealed one at a time. Name the player.',
      'A wrong guess or a skip reveals the next. Run out and you lose.',
    ],
    rules: ['Every answer has three or more organisations.', 'After the organisations: FNCS titles, then prize money.'],
    sections: [
      {
        title: 'Modes',
        items: [
          'Timeline — oldest first, with the dates and the FNCS titles won at each.',
          'Shuffled — no order and no dates.',
        ],
      },
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — the names everyone knows.',
          'Medium 🟡 — the regulars of the scene too.',
          'Hard 🔴 — anyone.',
        ],
      },
    ],
    terms: ['org', 'fncs-title', 'earnings'],
    hidden: true,
    Component: lazy(() => import('./transfer-window/TransferWindowGame')),
  },
  {
    id: 'which-lobby',
    slug: 'which-lobby',
    title: 'Which Lobby?',
    tagline: 'The leaderboard fills from the bottom up. Name the tournament.',
    icon: '🏟️',
    intro: [
      'A tournament’s leaderboard is revealed from the bottom up, the winner last. Name the tournament.',
      'A wrong guess reveals the next finisher and says whether the lobby was earlier or later, and whether the region was right.',
    ],
    rules: ['Pick the round, then the region.', 'On a duos or trios event a finisher is the whole team.'],
    sections: [
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — the major LANs and the Europe and North America finals, famous finishers.',
          'Medium 🟡 — NA West and Brazil too.',
          'Hard 🔴 — every region, anyone in the results.',
        ],
      },
    ],
    terms: ['major', 'lan', 'global'],
    hidden: true,
    Component: lazy(() => import('./which-lobby/WhichLobbyGame')),
  },
];

/** The line every daily puzzle's rules open with. */
export const DAILY_LINE =
  'One puzzle a day, the same for everyone. A new one at midnight, Central European time.';

/**
 * The rules as one mode shows them: the daily puzzle's own bullets and none of
 * the setup sections, or everything as written for practice.
 */
export function rulesFor(
  game: GameMeta,
  daily: boolean,
): { intro: string[]; rules: string[]; sections: RuleSection[] } {
  const sections = game.sections ?? [];
  if (!daily) return { intro: game.intro ?? [], rules: game.rules ?? [], sections };
  return {
    intro: [...(game.intro ?? []), DAILY_LINE],
    rules: game.daily?.rules ?? game.rules ?? [],
    sections: sections.filter((section) => !section.practiceOnly),
  };
}

/** The games players see — everything not `hidden`. */
export const VISIBLE_GAMES: GameMeta[] = GAMES.filter((game) => !game.hidden);

/** Whether a hidden game's page opens at all: on a dev server, yes; on the live site, no. */
export const OPEN_HIDDEN = import.meta.env?.DEV === true;

/**
 * A game by its URL slug or its id.
 *
 * Both, because they can differ: a rename changes `slug` and leaves `id` alone
 * so local best scores survive it, and the game components ask for themselves
 * by id (`getGame('wordle')` inside Fortnitedle). Slug wins on a tie, so the
 * router always resolves to the game whose URL was actually requested, and a
 * link to a game's old slug — which is still its id — keeps working.
 */
export function getGame(key: string): GameMeta | undefined {
  return GAMES.find((game) => game.slug === key) ?? GAMES.find((game) => game.id === key);
}
