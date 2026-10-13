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
    'Random 🎲 — anyone can come up, but it leans towards names you know: half the rounds are Easy-band players, a third Medium, the rest Hard. This is the default, and Start works without touching anything.',
    SHOW_STATUS
      ? 'Choose 🎛️ — narrow it by region, difficulty and whether the player is still competing. Whatever you pick is remembered, here and in every other game.'
      : 'Choose 🎛️ — narrow it by region and difficulty. Whatever you pick is remembered, here and in every other game.',
    'Region — play one region’s scene only. Difficulty is then ranked inside that region, so Easy means “well known in Asia”, not “well known worldwide”.',
    'Difficulty — Easy 🟢 is the names everyone knows, Medium 🟡 the regulars of the scene, Hard 🔴 the deep cuts.',
    ...(SHOW_STATUS ? ['Active, retired or everyone — the export says which players are still competing.'] : []),
  ],
};

export const GAMES: GameMeta[] = [
  {
    id: 'higher-lower',
    socials: true,
    slug: 'higher-lower',
    title: 'Higher or Lower',
    tagline: 'Is the next player above or below? Keep the streak alive.',
    seo: {
      title: 'Fortnite Higher or Lower: pro earnings, FNCS wins and age',
      description:
        'Is the next competitive Fortnite player higher or lower? Compare pros on career earnings, FNCS wins, FNCS finals and age, and keep your streak alive.',
    },
    icon: '📈',
    intro: [
      'Is the player on the right higher or lower than the one on the left, in the category you picked?',
      'A right answer scores a point: the right-hand player slides across and a new one comes in. One wrong answer ends the run.',
    ],
    sections: [
      {
        title: 'Categories',
        items: [
          'Age — how old each player is today, from their published birthday.',
          'Career Earnings — every dollar of tournament prize money on record.',
          'FNCS Wins — regional FNCS grand finals won, every season and region. Players with none come up too.',
          'FNCS Finals — FNCS grand finals reached, the Globals and the other FNCS LANs included.',
          'Twitch Followers, YouTube Subscribers — the counts each platform shows, updated every day. YouTube rounds its counts, like 1.23M.',
        ],
      },
      {
        title: 'Difficulty',
        items: [
          'A run starts with famous players far apart. The longer it lasts, the less known the players and the closer their numbers.',
          'Easy gets harder slowly, Medium faster, Hard fastest. Hard also adds an Equal button.',
        ],
      },
      {
        title: 'Ties',
        items: [
          'Easy and Medium never show two players on the same number, so Higher or Lower is always right.',
          'Hard can, and then only Equal is right — two players with no FNCS wins too.',
          'Age is compared in whole years: two 19-year-olds are level even with birthdays months apart.',
          'Two players are never level on career earnings.',
        ],
      },
    ],
    terms: ['earnings', 'age', 'fncs-title', 'fncs-final'],
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
    intro: [
      'Guess the competitive Fortnite player in 6 tries. After each guess, the tiles change colour to show how close you were to the player’s name.',
    ],
    rules: [
      'Spaces and punctuation are removed, capitalisation does not matter.',
      'Digits 0–9 count as characters and are on the keyboard.',
      'Any combination of letters and digits is allowed — it does not have to be a real player.',
      'From your third guess, you are told if the name has a digit — not which one or where.',
      'Every player in the pool comes up once before any of them comes round again.',
    ],
    daily: {
      rules: [
        'Spaces and punctuation are removed, capitalisation does not matter.',
        'Digits 0–9 count as characters and are on the keyboard.',
        'Any combination of letters and digits is allowed — it does not have to be a real player.',
        'From your third guess, you are told if the name has a digit — not which one or where.',
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
      'Up to ten of a secret player’s major results are revealed one at a time. Name the player from the career alone.',
      'A wrong guess reveals the next clue, and running out of clues loses the round. The fewer clues you need, the better.',
    ],
    rules: [
      'Clues are majors only: Epic’s grand finals since the 2019 World Cup — regional FNCS finals, the Globals, the World Cup itself.',
      'Each clue is one tournament and where the player finished.',
      'Only players with at least five majors on record can be the answer.',
      'When the round ends, the clues you did not need are shown, dimmed.',
    ],
    sections: [
      {
        title: 'Game modes',
        practiceOnly: true,
        items: [
          'Order — ten results spread across the career, oldest first.',
          'Random — the same kind of ten, in no order.',
        ],
      },
      {
        title: 'Which results',
        items: [
          'A mix of finishes — a win, a top 10, a 40th — with the bigger stages preferred.',
          'The first clues never give it away: no win or $1M podium in the first three for famous players, or the first two for regulars.',
          'The clues fit only one player. The exception is a few players who played every major with the same partner — if you name the partner, the answer is the other one.',
        ],
      },
      POOL_SECTION,
    ],
    terms: ['major', 'global', 'lan'],
    Component: lazy(() => import('./career-path/CareerPathGame')),
  },
  {
    id: 'who-are-ya',
    slug: 'who-are-ya',
    title: 'Who Are Ya?',
    tagline: 'Identify the player from the teammates they queue with.',
    seo: {
      title: 'Who Are Ya? Guess the Fortnite pro from their teammates',
      description:
        'The teammates a competitive Fortnite player has entered tournaments with are revealed one by one. Name the pro from the company they keep.',
    },
    icon: '🤝',
    intro: [
      'A secret player is picked, and the people they have entered tournaments with are revealed one at a time. Name the player from the company they keep.',
      'You may guess after every clue. The round ends on a correct guess or when the clues run out.',
    ],
    rules: [
      'Teammates are ranked by how many tournaments the pair entered together, across every tournament on record.',
      'A clue is a teammate who entered at least three tournaments with the answer. Only players with three such teammates and five majors can be the answer.',
      'When the round ends, the rest of the list is shown with the counts.',
    ],
    daily: {
      rules: [
        'Teammates are ranked by how many tournaments the pair entered together, across every tournament on record.',
        'They come fewest shared tournaments first, each with its count. Teammates on the same count can come in either order.',
        'A clue is a teammate who entered at least three tournaments with the answer. Only players with three such teammates and five majors can be the answer.',
        'When the round ends, the rest of the list is shown.',
      ],
    },
    sections: [
      {
        title: 'Clue order',
        practiceOnly: true,
        items: [
          'Counts shown — fewest → most shared tournaments, with the number on each teammate.',
          'Counts hidden — the same order, without the numbers.',
          'Random order — no ramp-up, and the counts stay hidden. The top teammate is never one of the first four clues.',
          'Teammates on the same number of shared tournaments can come out in either order — the count is the clue, not the position.',
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
      'You get one leaderboard — "Top 10 by major LAN earnings", "Top 10 countries by FNCS wins" — and ten empty slots. Name the ten.',
      'Correct answers lock into their real position, so the board fills in from wherever you happen to know it.',
    ],
    rules: [
      'Easy: unlimited guesses — just find all ten.',
      'Hard: 3 lives, and every wrong guess costs one — the player in 11th too.',
      'On a duos or trios board a slot is a whole team, and it locks once you have named everyone on it.',
      '“What counts here” under each board explains its words — which events count as a major or a major LAN, whose nationality a dual national counts for.',
    ],
    daily: {
      rules: [
        '5 lives: every wrong guess costs one — the player in 11th too.',
        'On a duos or trios board a slot is a whole team, and it locks once you have named everyone on it.',
        '“What counts here” under the board explains its words — which events count as a major or a major LAN, whose nationality a dual national counts for.',
      ],
    },
    sections: [
      {
        title: 'Categories',
        practiceOnly: true,
        items: [
          'About nine hundred boards: players, regions, countries, tournaments, FNCS finals, season averages, Div Cups, organisations and paydays. Hit Random, or search for one.',
          'Not every board wants a player. Some want an organisation, a country or a tournament — the input says which.',
        ],
      },
      {
        title: 'Ties',
        items: [
          'Every board shows its tie rule above the slots. On most boards that count something, players level on the count are split by career earnings.',
          'If 10th and 11th are still level after that, either one fills 10th, and the board says so.',
          'Naming the player in 11th is a wrong answer like any other. The game tells you it was 11th, but it still costs a life.',
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
      'One list, ninety seconds, and as many names as you can remember.',
      'Every correct name scores a point and adds 5 seconds, so a good run keeps extending itself.',
    ],
    rules: [
      'Repeating a name you already found does not count again.',
      'Easy: wrong answers cost nothing.',
      'Hard: every wrong answer takes 3 seconds off the clock.',
      'Name everyone on the list and you win straight away.',
      'When time runs out you see everyone you missed.',
      'The suggestion box helps you spell a name you already thought of — it never tells you whether that name is on the list.',
    ],
    daily: {
      rules: [
        'Repeating a name you already found does not count again.',
        'Every wrong answer takes 3 seconds off the clock.',
        'Name everyone on the list and you win straight away.',
        'When time runs out you see everyone you missed.',
        'The suggestion box helps you spell a name you already thought of — it never tells you whether that name is on the list.',
        '“What counts here” under the list explains its words.',
      ],
    },
    sections: [
      {
        title: 'The lists',
        practiceOnly: true,
        items: [
          'Over three hundred: an organisation’s players, FNCS winners by region or year, Div Cups, earnings thresholds, countries, the top earners’ teammates, and who played two events.',
          '“What counts here” under each list explains its words — which events count as a major or a major LAN, whose nationality a dual national counts for.',
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
      'You get a rule — "has played for NRG", "has won a major LAN" — and a board of ten players. Four to six of them fit the rule. The rest are griefers.',
      'Find the ones who fit.',
    ],
    rules: [
      'Cards show the player’s handle and nothing else: no flag, no org, no earnings.',
      'That is deliberate. A card carrying a Brazilian flag answers "competes in Brazil" for you, which made the old version a reading exercise rather than a knowledge one.',
      'Between four and six of the ten fit the rule, and the board never tells you how many. A stated count makes the last pick arithmetic instead of knowledge.',
      'Most griefers nearly fit: one title short, just under the money, the next country over.',
    ],
    sections: [
      {
        title: 'Game modes',
        items: [
          'All at once — select everyone you think fits, then hit Check. The selection has to be exactly right.',
          'One by one — tap a player, then confirm. A correct pick continues; a griefer ends the round.',
          'The confirm step exists because a mis-tap used to end a round outright.',
        ],
      },
      {
        title: 'The rules you will see',
        items: [
          'Organisations — has played for a given org, at any point, not just today.',
          'Titles — has won an FNCS, a major LAN, a Global Championship, or two or more FNCS titles.',
          'Career earnings above a threshold.',
          'Won their region’s FNCS — “has won the EU FNCS” — or won an FNCS in a given year. Regional finals only: a Globals is its own title and counts for neither.',
          'Played at a specific tournament — the Globals and major LANs, never a regional qualifier.',
          'Country and region — in the draw now that the cards carry no flags.',
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
    id: 'tic-tac-toe',
    socials: true,
    slug: 'tic-tac-toe',
    title: 'Tic Tac Toe',
    tagline: 'Fill the grid with players who match both conditions.',
    seo: {
      title: 'Fortnite Tic Tac Toe: pros who fit both categories',
      description:
        'Fill a 3×3 grid with competitive Fortnite players who fit both their row and their column: country, region, organisation, FNCS titles, LANs and earnings.',
    },
    icon: '⭕',
    intro: [
      'A 3×3 grid has a category on every row and every column. Fill each cell with a player who fits both.',
      'Type a player’s name and the grid places them. If they fit more than one cell, you tap which.',
    ],
    rules: [
      'A player who fits no open cell costs a life.',
      'Each player can be used once.',
      'No player fits the whole grid: at most 4 cells on Easy, 3 on Medium, 2 on Hard.',
      'The grid only offers cells that leave every other cell still possible to fill.',
    ],
    daily: {
      rules: [
        '3 lives: a player who fits no open cell costs one.',
        'Each player can be used once.',
        'Every cell has at least two well-known answers, and no player fits more than 3 cells.',
        'The grid only offers cells that leave every other cell still possible to fill.',
      ],
    },
    sections: [
      {
        title: 'Difficulty',
        practiceOnly: true,
        items: [
          'Easy 🟢 — every cell has at least three names everyone knows. 3 lives.',
          'Medium 🟡 — every cell has at least two of the scene’s regulars. 3 lives.',
          'Hard 🔴 — a cell may have only one answer. 1 life.',
          'At every level, any player who fits is accepted.',
        ],
      },
      {
        title: 'Categories',
        items: [
          'Won EU FNCS, Won FNCS in 2023 — the regional FNCS finals. A Globals is not an FNCS win.',
          'Won FNCS with a famous player, like Peterbot — was on one of their FNCS-winning teams.',
          'Top 3 at a major LAN — a podium finish at any major LAN, as defined below.',
          'Won FNCS back to back — won two FNCS finals in a row, in any region.',
          'Played at an event — was in its field, whatever the result.',
        ],
      },
    ],
    terms: ['nationality', 'region', 'org', 'fncs-title', 'lan', 'global', 'major', 'earnings', 'age'],
    Component: lazy(() => import('./tic-tac-toe/TicTacToeGame')),
  },
  {
    id: 'connections',
    socials: true,
    slug: 'connections',
    title: 'Connections',
    tagline: 'Sort 16 players into the 4 groups they belong to.',
    icon: '🧩',
    intro: [
      '16 players hide 4 groups of 4. Select four and submit; a correct group locks in and reveals what its connection was.',
      'You have 4 lives, and every wrong group costs one.',
    ],
    rules: [
      'A group is a country, a region, an organisation, a title — FNCS, major, major LAN — or an earnings threshold. Nothing more obscure than that, and no birth years: nobody can tell a 2005 from a 2006.',
      'Every connection fits exactly its own four. If the group is Poland, there is no fifth Pole on the board — so there is exactly one way to split the sixteen.',
      'A wrong guess tells you when three of your four belonged to one group, and says nothing otherwise.',
      'Nothing otherwise is deliberate: two of any four landing in the same group is close to chance on a sixteen-card board, so reporting it every time buried the one hint worth reading.',
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
      'Guess any player and you get a row of comparisons against the secret one. Use them to close in.',
      'You have 8 lives, and every wrong guess costs one.',
    ],
    rules: [
      'Green means a match, red means not. There is no in-between colour — the arrows already say which way to go.',
      'Columns: region, country, status, age, career earnings, FNCS wins, FNCS finals played, whether your guess has played with the secret player, and Twitch followers.',
      'Together is green when the two have entered 10 or more tournaments as teammates. A red cell still shows how many they did play, if any.',
      'Career earnings always show a direction, because exact-matching a six-figure number would never land.',
      'You can guess anyone, not just players from the pool the secret was drawn from. A guess with no published birthday shows — for age.',
      'Only players with a published birthday and earnings figure can be the answer, so the secret never has a blank.',
    ],
    sections: [
      {
        title: 'Feedback style',
        items: [
          'Exact — age and the FNCS counts are simply right or wrong. Worth trying: competitive players sit in a narrow age band and FNCS counts are small.',
          'Direction — ▲ means the secret player is higher, ▼ lower, on every number.',
        ],
      },
      {
        title: 'Ties',
        items: [
          'A number level with the secret player’s is green in both styles — in Direction there is simply no arrow.',
          'Country compares the first nationality on each page, so a dual national matches only on the flag they list first.',
        ],
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
      'Ten players and one category — FNCS finals, titles, earnings, major LANs or ten finishers at one tournament. Sort them into the pyramid with the best at the top, then check.',
      'Every player in the right place turns green and locks. Red ones are in the wrong place.',
    ],
    rules: [
      'Tap two players to swap them, or drag one onto another.',
      'Players level on the value can go either way round.',
    ],
    sections: [
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — famous players, and check as often as you like. A tournament’s ten come from its top 20.',
          'Medium 🟡 — the regulars too, closer values, 2 lives: a check that is not perfect costs one. A tournament’s ten come from its top 30.',
          'Hard 🔴 — anyone, the closest values, 1 life: one check, then the right order. A tournament’s ten come from anywhere in the results.',
        ],
      },
    ],
    terms: ['fncs-final', 'fncs-title', 'lan', 'earnings'],
    // New 30 Sep 2026, not hosted yet.
    hidden: true,
    Component: lazy(() => import('./pyramid/PyramidGame')),
  },
  {
    id: 'bingo',
    socials: true,
    slug: 'bingo',
    title: 'Bingo',
    tagline: 'Players are dealt one by one — fill all 16 squares before the deck runs out.',
    icon: '🎱',
    intro: [
      'Every square is a category. Players are dealt one at a time: tap a square they fit, or skip them. Fill the whole card before the deck runs out.',
    ],
    rules: [
      'A player on a square they do not fit costs a life, and that player.',
      'Skipping is free — some players fit nothing on the card.',
      'The deck always holds enough players for a full card, with some to spare.',
      'No player fits more than 5 squares.',
    ],
    sections: [
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — 50 famous players, 3 lives.',
          'Medium 🟡 — 45 players, the regulars too, 3 lives.',
          'Hard 🔴 — 40 players from anywhere, 2 lives.',
        ],
      },
    ],
    terms: ['nationality', 'region', 'org', 'fncs-title', 'fncs-final', 'lan', 'global', 'earnings', 'teammates'],
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
      'A secret player’s prize money is drawn year by year. Name the player.',
      'A wrong guess, or a skip, draws the next year. Run out of years and the round is lost.',
    ],
    rules: [
      'The curve runs from the first year the player won prize money to the last, empty years included.',
      'A curve shorter than five years still gets five guesses.',
    ],
    sections: [
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — the names everyone knows.',
          'Medium 🟡 — the regulars of the scene too.',
          'Hard 🔴 — anyone with three years of prize money.',
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
      'A secret organisation’s players are revealed one at a time. Name the org.',
      'A wrong guess, or a skip, reveals the next clue. Run out and the round is lost.',
    ],
    rules: [
      'Its best-known players are never in the first three.',
      'Every few players, a clue about the org itself: its region, when it was founded, its prize money.',
    ],
    sections: [
      {
        title: 'Clues',
        items: [
          'Full dates — when each player joined and left.',
          'Joined — only when they joined.',
          'Names only — just the players.',
        ],
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
      'Close means alike: age, country, region, and how often the two played together.',
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
    terms: ['nationality', 'region', 'age', 'teammates'],
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
      'Moments from competitive Fortnite — a World Cup, a first FNCS title, a signing. Put them in order, oldest at the top, then check.',
      'Every moment in the right place turns green, locks and shows its date.',
    ],
    rules: ['Drag a card, or tap it and then tap where it goes.', 'Moments on the same day can go either way round.'],
    sections: [
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — 5 moments about famous names, far apart. Check as often as you like.',
          'Medium 🟡 — 6 moments, closer together. 2 lives.',
          'Hard 🔴 — 7 moments, anyone. 1 life.',
        ],
      },
    ],
    terms: ['fncs-title', 'global', 'lan', 'org'],
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
      'A wrong guess, or a skip, fills in the next line of their file: nationality, age, organisations, titles — and last, the shape of their handle.',
    ],
    rules: ['The real name is the one on the player’s Liquipedia page.'],
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
      'A secret player’s organisations are revealed one at a time. Name the player.',
      'A wrong guess, or a skip, reveals the next. Run out and the round is lost.',
    ],
    rules: [
      'Only players with three or more organisations on record come up.',
      'After the organisations: their FNCS titles, then their prize money.',
    ],
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
      'A tournament’s finishers are revealed from the bottom of the leaderboard up, the winner last. Name the tournament.',
      'A wrong guess reveals the next finisher, and says whether the lobby was earlier or later and whether you had its region.',
    ],
    rules: ['Pick the round, then the region.', 'On a duos or trios event a finisher is the whole team.'],
    sections: [
      {
        title: 'Difficulty',
        items: [
          'Easy 🟢 — the major LANs and the Europe and North America finals, famous finishers.',
          'Medium 🟡 — Brazil too.',
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
