# OffSpawn — the whole project

As of 26 September 2026: every game and how it chooses its players, the data, the server, the tests, the limited-mode plan and what to decide next. See also [README.md](README.md), [DATA.md](DATA.md) and [LIMITED_MODE.md](LIMITED_MODE.md).

## What OffSpawn is

OffSpawn is nineteen browser puzzle games about competitive Fortnite players, seven of them on the live site. They are built on a Liquipedia export of 5,678 players, 14,645 tournaments and 442,736 placements.

The site is React, Vite and TypeScript. Every game splits in two: a pure `engine.ts` with the rules and no React, and a component that draws it. That split is what lets a script play every game to the end in Node.

| Game | What you do | Folder |
| --- | --- | --- |
| Higher or Lower | Say whether the next player's number is higher or lower. Endless; one mistake ends the run | `higher-lower` |
| Fortnitedle | Guess a player's handle in six tries, Wordle-style | `wordle` |
| Career Path | Name the player from ten of their major results | `career-path` |
| Ready Up | Name the player from the teammates they played with | `who-are-ya` |
| Tenite | Name all ten entries on a top-10 board | `tenaball` |
| List | Name as many answers to a list as you can in 90 seconds | `list` |
| Griefer | Pick the four to six of ten players who fit a rule | `impostor` |
| Box Fight | Fill a 3×3 grid where every cell is a row rule and a column rule | `tic-tac-toe` |
| Squads | Sort 16 players into four groups of four | `connections` |
| Guess the Player | Close in on a secret player attribute by attribute, eight guesses | `guess-the-player` |
| Pyramid | Sort ten players into a 1-2-3-4 pyramid on one category, best at the top | `pyramid` |
| Bingo | Players are dealt one by one; put each on a 4×4 card of categories or skip, and fill the whole card | `bingo` |
| Curveball | Name the player from their prize money drawn as a curve, a year at a time | `curveball` |
| Org Chart | Name the organisation from players who played for it, with dates, join dates or names only | `org-chart` |
| Contextinho | Find the secret player; every guess is ranked by how alike the two are | `contextinho` |
| Rewind | Put seven to ten moments from competitive Fortnite in order | `rewind` |
| IRL | Name the player behind a real name, their file filled in a line at a time | `irl` |
| Transfer Window | Name the player from the organisations they have played for | `transfer-window` |
| Which Lobby? | Name the tournament from its leaderboard, revealed from the bottom up | `which-lobby` |

**Hidden for now: Guess the Player, Connections and Griefer (26 Sep 2026), Pyramid and Bingo (new, 30 Sep 2026), the seven October games (new, 2 Oct 2026 — see their section), and List (4 Oct 2026: too close to Tenite, back in about a month).** A `hidden` flag in the registry takes a game off the home page and the side nav, and the live site sends its address home. A dev server still opens it by URL, and `check:games` still plays it. Guess the Player needs more than it has. Of the three rule-grid games only one is kept, Tic Tac Toe: every board builds at every level and none repeats over 200 deals. Its Easy level is the thin one, with 30 distinct rules, and "won the EU FNCS" and "$1M+ earner" each sit on 41% of Easy boards. Delete the flag to bring a game back.

Six folders keep old names: Fortnitedle lives in `wordle`, Griefer in `impostor`, Tenite in `tenaball` (Tenaball until 13 Oct 2026, the user: "it's a football name"), and since 14 Oct 2026 Ready Up in `who-are-ya` (Who Are Ya?; the user: "rename it to ready up", not Duo Finder, "because there are trio, squad tournaments as well"), Box Fight in `tic-tac-toe` (Tic Tac Toe) and Squads in `connections` (Connections). The rest of this guide still says Who Are Ya, Tic Tac Toe and Connections in places; they are the same games. The ids stay unchanged because best scores, daily progress and the daily schedule are stored under them. The old address, which is the id, is a 301 to the new one (`src/games/moved.ts`, read by the server; the app does the same on a dev server), so `/game/tenaball` in shared results still lands on Tenite.

How it runs:

- **Locally:** `npm run dev:all` starts the site on port 5173 and the API on port 3000. The analytics page opens without a password, and rounds you play are recorded to `server/.data` on your machine.
- **In production:** Heroku, live since the end of September 2026. `npm start` serves the built site and the API from one Node process, stores records in Postgres, and puts `/analytics` behind `ADMIN_PASSWORD`.
- **No accounts yet.** Best scores, daily progress and streaks live in each browser's local storage.
- **Daily puzzles on the live site** for Tenite only; the other live games play unlimited (Fortnitedle since 5 Oct 2026, the rest since 4 Oct). See "Daily puzzles" below.

## The data

Every game reads one Liquipedia export in `liquipedia_data/clean_data/fortnite/`, in place, with no build step. Two commands keep it current, and you run both: `scripts/liquipedia_api.py` pulls what changed from Liquipedia into the raw dump, and `scripts/build_data.py` turns the raw dump into every file here (the cleaning, the FNCS titles and tiers, then the derived files). The site never writes that folder. Since 14 Oct 2026 the same update can run on GitHub Actions instead (`.github/workflows/update-data.yml`): weekly, or from **Update now** on `/analytics/data`, which also shows how old the data is and how many Liquipedia pages changed since. It keeps the raw dump in the Actions cache, commits the new files, and Heroku deploys them. Setup: UPDATE_DATA.md, "Updating from the dashboard".

| File | Holds | Written by | Read by |
| --- | --- | --- | --- |
| `players.json` | 5,678 playable rows: handle, aliases, nationalities, region, birthday, career and per-year earnings, status, FNCS wins, fame tier | the upstream notebook | the pipeline |
| `roster.json` | the same players with only the columns the games read and no empty values: 1.3 MB instead of 3.9 MB, 131 KB with brotli (`scripts/pipeline/site.py`, every build). `check:games` proves it gives the same players field for field | `site.py` | every game (falls back to `players.json` if missing) |
| `tournaments.json`, `placements.json` | 14,645 tournaments and 442,736 placements (154 MB) | the export | the notebook only |
| `career_path.json` | 187 majors and every player's finishes in them: 1,175 with five or more, 3,348 in all once cell 7 has run | cell 7 | Career Path, Tenite's Globals boards, Rewind's duos |
| `teammates.json` | each player's 50 most frequent teammates | cell 6 | Who Are Ya, List |
| `orgs.json` | 979 organisations, with current and past players | the export | Griefer, Tic Tac Toe, Connections, Tenite, List |
| `facts.json` | per player: tournaments played, LAN and FNCS appearances, wins by kind, which headline events they played; plus `season`, every team's finish at the year's big events, and `divcups`, every Div Cup final won with its day | notebook appendix | the criteria games, List, Tenite's field and winners boards, FNCS Finals, Contextinho, the glossary |
| `rankings.json` | 375 precomputed Tenite boards (284 until cells 2–4 are re-run), plus the tournament names the paydays boards answer from | cells 2–4 | Tenite |
| `pools.json` | event fields; today one, the FNCS 2026 Globals with 103 players, where each finished and what each had earned before it | cell 5 | event mode |
| `bios.json` | real names and every organisation stint with its dates, from the transfers | `enrich.py` | IRL, Org Chart, Transfer Window, Rewind (they fall back to `players.json` and `orgs.json` without it) |

Three rules keep this safe:

- **Data changes go through a cell.** A cell is proved against the real dump, with every write sent to a scratch folder, before you run it.
- **Old and new shapes both read.** The TypeScript reads the current file shape and any new one, so nothing breaks before you re-run.
- **A missing file is not a crash.** A generated file that is absent is simply skipped: its games show a "has it been generated?" note, and the test suite reports them as skipped.

Fame is decided upstream. `tier` (easy, medium, hard or unused) and `region_tier` are columns in `players.json`. The app never recomputes them, so re-tiering the roster re-tiers every game at once.

### What the words mean

| Term | Meaning here |
| --- | --- |
| Major | An Epic-run main event that Liquipedia rates tier 1, from the 2019 World Cup on. Console, mobile, Twitch and challenge events are excluded, so MrBeast's Extreme Survival Challenge is not a major. 187 events, 178 of them regional FNCS grand finals |
| Major LAN | A major played offline: 9 events (the two World Cup finals, the 2022 Invitational, the Globals 2023–26, the 2026 Summit, the Reload Elite Series Championship). Called "major LAN" everywhere a player reads it since 13 Oct 2026 (the user: "give it a name like a major lan") |
| LAN | Only the "LAN wins" board: any offline tier 1–2 event, so DreamHack, Gamers8 and the Esports World Cup count there |
| Global Championship | The FNCS Globals 2023–26. Not the 2019 World Cup since 13 Oct 2026 (the user: "world cup isn't great in this category"): it is a major LAN, and a World Cup win is no longer a Global win. `is_global` in `derived.py`; `facts.ts` reads an older `facts.json` the same way |
| FNCS win | A regional FNCS grand final won, PC only, counted from Liquipedia's results (the 2020 console FNCS is not counted). The Globals, the Invitational and the Summit are not FNCS wins |
| FNCS finals played | Every FNCS-branded major reached, the Globals, Invitational and Summit included. The 2026 Globals already counts for its qualifiers, because the dump lists entrants before the event |
| Nationality | The first one on the Liquipedia page. 487 players list two or more. England, Scotland and Wales count as their own nations when listed first |
| Region | Where a player competes, one of six: Europe, North America (Central and West together), South America (Brazil), Asia, Oceania, Middle East |
| Earnings | Individual prize money in US dollars, as a career total and per calendar year (2018–2026) |

## Shared machinery

Six pieces are shared across the games:

- how a game chooses its pool
- how it deals a secret player without repeats
- the event mode
- the rules the criteria games draw from
- the definitions
- the Give up button

### Choosing who you get asked about

| Setup | Games | What it offers |
| --- | --- | --- |
| Pool setup | Fortnitedle, Career Path, Who Are Ya, Griefer, Connections, Guess the Player | **Random** (the default), or **Choose** by region and fame tier. The choice is remembered across games. The active-or-retired choice is hidden for now; `SHOW_STATUS` in `pool.ts` brings it back |
| Level setup | Higher or Lower, Tic Tac Toe | One Easy / Medium / Hard that sets both who is asked about and how hard the game presses |
| Category picker | Tenite, List | The category is the whole subject, so you pick a board or a list |

Fame tiers come from `players.json`:

- **Region fame.** Choosing a region switches to `region_tier`, so Easy means "well known in Asia", not worldwide.
- **Short tiers widen.** A game passes its own eligibility filter, and a tier that comes up short folds in the next-closest one rather than failing.

**Random leans towards names you know.** An even draw over everyone eligible was 70–80% Hard-tier players. So Random picks the tier first:

- **The mix.** Half Easy, a third Medium, the rest Hard (`RANDOM_MIX`, 50/35/15).
- **Who uses it.** The four secret-player games deal every round this way. Connections applies the same mix to each group.
- **Choose → Any too** (14 Oct 2026, the user: "I get a lot of nonames when I play eu any difficulty… I would like it to be similar proportions to just a random mode"). It used to deal evenly, which for Europe was 73% deep cuts. Now it takes the same mix, on the region's own tiers when a region is chosen (`regionTier`), so Easy means well known in that region.

### Dealing without repeats

Fortnitedle, Career Path, Who Are Ya and Guess the Player deal their secret player from a bag, not a die (`rotation.ts`):

- **No repeats.** Everyone comes out once before anyone comes round again.
- **No back-to-back across a refill.** A new cycle never opens with the player who closed the last one.
- **It survives a reload.** The bag is stored in the browser, keyed by everything that changes who is in it.

### Event mode

**Switched off for the launch (28 Sep 2026).** `SHOW_EVENT_MODE` in `games/shared/mode.ts` is `false`: the home page has no picker, the header no chip, and a mode a browser remembered from before is ignored. Everything below is kept, and `check:games` still tests it; set the flag to `true` to bring it back.

On the home page you can swap the whole scene for one tournament's field; today that is the FNCS 2026 Globals, 103 players. Every game then draws from that field only, until you leave it from the header.

- **Setup collapses.** The setup screens become a Start button.
- **Field categories.** Tenite and List swap to boards and lists built from the field in the browser, under one heading, in a planned order.
- **Regions in turn for the secret-player games.** Taking regions in turn (`dealInTurn`) puts every region on screen every six rounds. Europe sent 46 players and the Middle East 4, so an even draw almost never reached the small regions.
- **Region lean in Higher or Lower.** The next player leans towards the region the run has shown least: 4.8 regions in the first 12 rounds instead of 3.2.
- **The whole field, not the roster's minimums.** A qualifier is never left out for falling short of a bar the roster uses. Career Path takes anyone in the field with a major and Who Are Ya anyone with a teammate; either gives a short hand five guesses. Guess the Player takes the players with no birthday, and their Age column goes grey. Griefer, Connections and Tic Tac Toe drop their three-major minimum. At the 2026 Globals every secret-player game deals all 101 (Career Path once cell 7 has run). Only Higher or Lower's Age leaves out the 11 with no birthday, because there is nothing to compare.
- **Not in How to play.** Event mode is not described in any game's rules. Limited mode will get rules of its own.

### Criteria: the rules Griefer, Tic Tac Toe and Connections use

`criteria.ts` builds one list of player rules from the pool, each carrying the players who fit it:

- **Where from:** country and region
- **Who for:** has played for one of the ten richest organisations
- **What won:** FNCS winner, 2+ or 3+ FNCS wins, Global, major LAN or major winner, won a region's FNCS, won an FNCS in a given year
- **Box Fight only (also Bingo's squares)** (their own kinds, so Connections' and Griefer's whitelists leave them out). Added 14 Oct 2026, the user's picks from a measured list: won a Solo / Duo / Trio / Squad FNCS, won FNCS in 3+ different years, won an FNCS before turning 15 or 16 (age on the day of the final), played the 2019 World Cup (moved here from Bingo), played 3+ Globals. **Deep rules**, built only for Hard boards (`deep` in `CriteriaOptions`; the user: "categories like won a div cup isn't easy, so they could be only in hard"): played 2+ Globals, won a Div Cup (any region and each region), 5+ Div Cup wins, 40+ Performance Evaluations, $100K+ in 2025, $50K+ in 2026, $500K+ in one year, played every FNCS final of 2025 in their region. Left out at the user's word: 40+ Div Cup finals, an FNCS podium but no win, 10+ finals but no win, top 10 at a Globals. Over 60 boards a level, a new rule is on 55 Easy, 44 Medium and 53 Hard boards; the World Cup is on half the Easy ones. Earlier: the exact FNCS count (none, exactly 1, 2 or 3, 4+), won the FNCS back to back — and since 15 Oct 2026 won majors back to back beside it (the Globals and LANs count, so a lost Globals between two FNCS wins ends it; 36 players to the FNCS's 46 — Scroll and Skyboy won EU's Major 1 and 2 of 2026 and lost the Summit between; the same kind, so a board weighs them as one question and the near-duplicate rule keeps them apart), top 3 at a major LAN (35 players), and won an FNCS with a named player — any Easy-tier player with 3+ FNCS-winning partners can be named (23 of them; Peterbot: Cold, Ritual, Pollo, Bylah). A handle more than one player has is named with the country, "Cold (United States)" (`namedPlayer` in `lib/text.ts`; the user, 14 Oct 2026: "there are a lot of CHAPS, so it should be specified which exactly"). When a namesake shares the country too — 32 handles do, Cooper and Deyy among the famous — the career earnings follow, "Cooper (United States, $1.2M)"; level on that as well, the page name
- **What earned:** $100K, $250K, $500K or $1M+ career earnings
- **Where played:** at a named Globals or major LAN
- **The rest:** age (under 18, 20+). There is no active or retired rule: Liquipedia rarely marks a player retired, so "Retired" refused players everyone knows have stopped (removed 28 Sep 2026)

No two rules on one board may be nearly the same: if 90% of one fits inside the other, they do not go together (`NEAR_NESTED`). That is what stops "has won a major" (164 of 165 are FNCS winners) sharing a board with "has won an FNCS".

### Definitions and Give up

- **Definitions.** Every game's "How to play" ends with "What the words mean". Majors, LANs and Globals can list the exact events they cover. Every Tenite board and List prompt has a "What counts here" fold for the words in its own title — except a board about one event (`tournament:…`), whose name says what it is: "Top 10 at FNCS 2023 Global Championship" no longer explains what a Globals is (13 Oct 2026).
- **Give up.** Every game has a two-step Give up beside its controls: one click arms it, a second reveals the answer.

## Higher or Lower

Two dials run every round of this endless game. **Who** can appear widens round by round from the top earners down. **How close** the two values are tightens on a schedule. The answer is drawn before the player, so it cannot be read off the last one.

**The known player never changes places.** The revealed player slides across to become the known one, nobody is shown twice in a run, and one mistake ends it. Running out of players ends the run as a win ("cleared").

**Three categories on offer** since 13 Oct 2026: Age, Career Earnings and FNCS Wins (the user: "much more interesting"). FNCS Finals and the Twitch and YouTube counts are hidden (`hidden` in `CATEGORIES`, `engine.ts`); their code and checks stay, and so does Placement for event mode.

| Category | Who is eligible | Unit of the gap |
| --- | --- | --- |
| Age | a published birthday | years, to the day: Older or Younger by the birth dates, the birthday shown under each age |
| Career Earnings | earnings on record above $0 | share of the bigger figure |
| FNCS Wins | everyone, noughts included | titles |
| FNCS Finals | at least one final (3,316 players) | whole finals |
| Placement | event mode only: a finish at the event (`pools.json` → `placements`) | share of the field's last place |

**Placement** asks who finished better at the event in force; 1st is the highest, and duo partners share a place, so Hard can deal them as a tie. The card shows in event mode only, greyed out until cell 5 has written the event's results.

### Who can appear: the fame window

The pool is ranked by career earnings for every category, because what makes a pair obvious is knowing who the two players are. Round one is two of the top 20, and the window then grows each round:

| Level | Grows per round | Stops at |
| --- | --- | --- |
| Easy | +10 | top 250 |
| Medium | +30 | top 1,000 |
| Hard | +60 | everyone |

### How close: the schedule

Four rounds per step; the last step repeats forever.

| Level | Steps |
| --- | --- |
| Easy | obvious, obvious, moderate, moderate, close, very close |
| Medium | obvious, moderate, moderate, close, very close, very close |
| Hard | obvious, moderate, close, very close, very close, very close |

| Closeness | Earnings | Age | FNCS Wins | FNCS Finals | Placement |
| --- | --- | --- | --- | --- | --- |
| Obvious | 50%+ apart | 6+ years | 3+ titles | 8+ finals | 40%+ of the field |
| Moderate | 25–50% | 3–5 | 2 | 4–7 | 20–40% |
| Close | 10–25% | 2 | 1 | 2–3 | 10–20% |
| Very close | under 10% | 0–1 | 0–1 | 0–1 | under 10% |

### How the next player is picked

1. **Candidates.** Take the unused players inside this round's window. If none are left, widen to the level's cap, and if that is empty too the run is cleared.
2. **In the band.** Keep those whose gap lands in the scheduled band. If nobody does, take one of the three nearest misses.
3. **The answer comes first.** Higher and Lower are an even draw, with two exceptions:
   - **Edge of the roster.** On Age and Earnings, if one side is down to its last few players, the draw follows the players back towards the middle.
   - **Equal on FNCS Wins.** The only category with an Equal button, on every level. Equal comes up about one round in five. When a direction is impossible (a shown 0 cannot go lower), Equal is an even draw against the other.
4. **Look ahead.** Within that answer, prefer a player whose own round next time will still have two possible answers. It samples 24 candidates.
5. **Event mode.** Prefer the region the run has shown least.

Why the answer comes first: the old random draw leaked it. On Hard FNCS Wins, 93% of answers flipped direction and a shown 0 always went higher. Guessing from the shown number alone won about 90% of the time; now it wins about half.

| Guessing from the shown number alone | Before | Now |
| --- | --- | --- |
| FNCS Wins, Hard | 90% | 48% |
| FNCS Wins, Easy / Medium | 88% / 91% | 67% / 65% |
| Age, Easy | 75% | 66% |
| Earnings, Hard | 55% | 54% |
| FNCS Finals, Easy / Medium / Hard | new | 61% / 59% / 50% |

### Ties

Since 13 Oct 2026 (the user: "equal only in fncs wins for all levels"):

- **FNCS Wins** deals ties on every level, and only Equal is right. Two players with no FNCS wins count as level and can come up in any round: the question "has this player ever won one?". About a quarter of FNCS rounds are ties, and a shown 0 goes up only about half the time, so it is no longer a free Higher on Easy and Medium.
- **Age** is never level. It compares birth dates, not whole years, so of two 23-year-olds one is older, and the buttons read Older and Younger. Two players born on the same day (18 of the top 250 earners share a birthday with someone) are never dealt together.
- **Career earnings** are never dealt level, and neither are Placement, FNCS Finals or the follower counts.

Over 60 runs a level, the answer flips direction 51–61% of the time in every category (a coin is 50%).

## Fortnitedle

Wordle on a player's handle: six guesses, and every tile turns green (right place), yellow (elsewhere in the name) or grey (not in it).

**Handles are normalised** before anything is compared:

- **Stripped.** Spaces and punctuation go, and case does not matter.
- **Digits count.** They are characters and have keys of their own.
- **Any string goes.** A guess must be the answer's length but need not be a real player.
- **Or player names only** (13 Oct 2026, the user: harder, so "it shouldn't be in random"). A **Guesses** row under Choose, below Region and Difficulty: *Anything* or *Player names only*. With the second, every guess must be a player's handle or one of their Liquipedia aliases (`playerNames` in `wordle/engine.ts`: 6,315 names, 1,389 of six characters, 56 of twelve). A guess that is not one is refused, like Wordle's "not in word list", and costs nothing. Random, an event field and the daily always take anything. The pick is remembered (`wordle:names-only`), and a round played this way is recorded with setup mode `names-only`.
- **Repeated letters score like Wordle.** Greens are taken first, then yellows from what is left, so a second copy of a letter the name has once is grey.

**Who can be the answer:** 5,585 handles. After normalising, a handle must be 3–12 characters and use at least two different characters. Anything with a parenthesis is out, because "Nate (NA player)" would become the twelve-tile NATENAPLAYER.

**The game says when a name has a digit, because nobody can reason their way to one.** A letter tile tells you something every round; a digit tells you nothing until you happen to try it. 328 answers contain a digit.

From guess 3, every round — every difficulty, Random, event mode and the daily — says the name has at least one digit, and nothing more: not how many, which or where (the user, 8 Oct 2026: "just tell that there is a number but don't tell which one and where"). The keyboard is not coloured for it.

Until 8 Oct 2026 it went by difficulty: Easy showed the digit and greened its key, Medium (and the daily) a # where it sat, Hard nothing, and only Random said there was one. That code is kept; `DIGIT_HELP` in `wordle/engine.ts` sets each difficulty's help, so one line brings a level's back.

**The secret is dealt** from the no-repeat bag with the Random mix, or region by region in event mode.

## Career Path

You name a secret player from their results at majors, revealed one at a time: up to ten clues, each a tournament and where they finished.

- **Clues and guesses.** A wrong guess reveals the next clue, and running out of clues loses. The score is how many clues you needed.
- **Who can be the answer:** 1,175 players with at least five majors on record. In event mode it is anyone in the field with a major at all: all 101 at the 2026 Globals once cell 7 has run, against 79 before.
- **Five guesses at least.** A career shorter than five majors still gets five guesses (`MIN_GUESSES`). The ones after its last clue reveal nothing new.
- **Modes.** Random (the default since 14 Oct 2026) builds up: the ten in any year order, from the least telling result to the most (`telling` in the engine: the finish on a log scale, plus up to half for the stage), give or take `RAMP_JITTER` so close results can swap but a 43rd never follows a top 10. The user: "later places give you much more information… no top 43 in last guess, but like top 5". The last clue is now a top 3 in 39% of hands and a top 10 in 72% (median 5th); a plain shuffle gave 10%, 29% and 18th. Order reads the ten oldest first, as a career arc. The daily, when it comes back, uses Random.

### How the ten are chosen

The clues are picked one at a time. Each unused result is scored on what it would add to the list so far:

| Factor | Rewards |
| --- | --- |
| Event | a recognisable stage: a Globals or the World Cup over a $65K regional final, on the prize pool's log scale |
| Mix | a finish band the list lacks yet (win, podium, top 10, top 25, the rest), with a penalty for repeating a placement |
| Spread | distance in time from clues already picked: heavy in Order, light in Random |
| Unique | ruling out someone else the list still describes, such as a duo partner |
| Noise | a little, so meeting the same player twice is a different round |

**Fame changes the weights.** Famous players get more mix and less big-event weight; the deep cuts get the reverse, because their biggest stage is the only thing anyone knows them by.

**Two rules sit on top of the scores:**

- **One player only.** If the chosen clues still fit someone else, the weakest is swapped for a result that player did not share. Thirteen careers cannot be split, because every major was played beside the same partner. There, naming the partner costs one clue.
- **The opening does not give it away.** A signature result (any major win, or a podium at a $1M+ event) never appears in the first three clues for household names, or the first two for regulars. The deep cuts get theirs early.

**Short careers are shown whole.** A career of ten majors or fewer has nothing to choose from, so all of it is shown. In Order that reads oldest first whatever it opens on.

**After the round** the rest of the ten turn face up, dimmed, so you can see what was coming next.

## Ready Up (was Who Are Ya?)

You name a secret player from the people they have played tournaments with, revealed one at a time. You may guess after every clue, and the round ends on a correct guess or when the clues run out.

**Teammates are counted from every tournament on record.** Two players are teammates at a tournament when they share one result, such as a duo or trio. A pair's count is the number of tournaments entered together; two solo players at the same event are not teammates. `teammates.json` keeps each player's 50 most frequent.

**A clue is a teammate with 3+ shared tournaments** (`MIN_SHARED`). Before that, 44–48% of clues were pickup partners from one or two cash cups.

**Who can be the answer:** 1,165 players with at least three such teammates and five majors on record (`facts.json`'s `apps`, which the code calls `MIN_TOURNAMENTS`). In event mode, anyone in the field with a teammate; a hand shorter than five gets five guesses.

### How the ten clues are drawn

The hand always holds the number one teammate, usually the duo partner and the fact that makes the chain solvable. The other nine are drawn one from each slice of the rest of the list (teammates with 3+ shared tournaments only). For a long list a hand looks like teammates 1, 3, 9, 14, 19, 25, 30, 36, 41 and 47.

That spread means you are never dealt the ten weakest, and meeting the same player twice gives a different hand. The old version always showed the top ten in the same order.

### Clue order

| Mode | Order | Counts shown |
| --- | --- | --- |
| Counts shown | fewest shared tournaments first, the partner last | yes |
| Counts hidden | the same order | no |
| Random order | shuffled, but the number one teammate is never in the first four (`TOP_HELD_BACK`) | no |

A plain shuffle dealt the duo partner first one round in ten, which ended a known player's round on clue one. Teammates on the same count can come out in either order; the count is the clue, not the position. After the round the whole list turns face up, dimmed, with the counts.

A clue card shows the teammate's name and country, spelled out: no organisation and no country code (13 Oct 2026).

## Tenite

You get one top-10 board and ten empty slots, and name the ten. A correct answer locks into its real position, so the board fills from wherever you know it.

- **Easy:** unlimited guesses.
- **Hard:** three lives, and every wrong guess costs one. The daily is Hard on five (`DAILY_LIVES`, 13 Oct 2026); a daily begun on three that was still going got the two new ones.

**Typing is forgiving.** Names resolve regardless of case, spaces and accents, and one typo is accepted when the match is unambiguous. The guess box always searches the whole population, never just the ten answers, because a dropdown of the answers would solve the board for you.

### The boards

901 boards come precomputed from the notebook (`rankings.json`), because they are aggregated from 442,736 placements. Eleven more are built in the browser from the roster, and five from `career_path.json` (the Global Championships, below).

| Group | Boards | Answered with |
| --- | --- | --- |
| By country | 76 | players from one country |
| By region | 59 | players from one region |
| Teammates | 59 | a player's most frequent teammates |
| Players | 31 | players: earnings, FNCS wins, major LANs, majors and more |
| Countries | 20 | country names |
| Paydays | 20 | the tournament where the money was won |
| Organisations | 11 | organisation names |
| 2019–2026 season | 190 | top 10 by average finish, at the year's majors and at its FNCS finals alone: the world and each FNCS region, and duos or trios from 2022 |
| FNCS all time | 9 | top 10 by average finish across every FNCS round since 2019: the world and each FNCS region |
| Div Cups | 285 | finals reached, wins and earnings (all time, by chapter, by year), and average finish for players and for duos or trios (by chapter, year and season): the world and each of the seven regions |
| Performance Evaluations | 41 | sessions played and earnings (all time and by year, earnings by format too): the world, Europe and NA Central |
| FNCS finals — North America | 44 | an FNCS grand final's top ten placements: every NA final |
| FNCS finals — Europe | 26 | every EU final |
| FNCS finals — other regions | 21 | the other regions' 2025 and 2026 finals and the 2021 Grand Royale |
| Tournaments | 8 | a major LAN's top ten placements |
| Global Championships | 5 | the Globals across the years (`globals-boards.ts`, built in the browser): the best average finish at every Globals, a missed one at twice a full lobby's last place like the season boards; the best average over the Globals played, one board per minimum from one Globals to all of them (the user: "min4, min3, min2, min1 all of them") — but a board with the same ten as one already made is left out, and today "played all four" is the best board row for row; the worst average among the players at all of them (24 today: EpikWhale, Shadow, Yuma…), or at all but one once fewer than 20 have been to every one. Level averages go to career earnings: "two or more played" has Vanyak3kk, Demus and Darm on 7.5 for 10th |
| FNCS winners | 26 | built in the browser from `facts.json` (`winner-boards.ts`, 14 Oct 2026, the user's list): per FNCS region, North America split NA East / NA West / NA Central — the most wins (7 regions), the first and last 10 different players to win (8 and 7), the first and last 10 countries to win (EU and the Middle East; the others have fewer than eleven countries). "Last" is each player's latest win, "first" their first; teammates on one day are split by career earnings. A walk that meets a win whose team is not all on the roster before the eleventh name stops, and there is no board (Oceania's last 10, for one) |
| Div Cup winners | 48 | from `divcups` in `facts.json` (every Div Cup final won, with its day; written by `derived.py` since 14 Oct 2026): the first and last 10 players to win one in each region, all time and per year; and "All 10 players to win an EU Div Cup in C7S1" — any season, year or region whose winners are exactly ten, no more, no less ("if there is more or less than 10 then don't do it"). Those have no 11th. No FNCS group is exactly ten today |
| Records | 57 | `record-boards.ts`, the user's picks of 14 Oct 2026: FNCS win rate, wins ÷ grand finals played — the world for players with 5+ finals ("for the world let's have 5"), each FNCS region with no minimum ("for region without it"), level rates to more wins; the fewest finals before a first win in each FNCS region (0 is winning on debut; level counts to whoever won first — a region-wide "first 10 to win on debut" cannot fill a board, no region has more than nine); first 10 to $1M in career earnings (the day the results' running total passed it — `million` in `facts.json`, from `derived.py`; the first eleven all did it at the 2019 World Cup), first 10 to 5 FNCS wins, the last 10 to win the FNCS in their first grand final (the first ten would only be Season X, everybody's first final; nobody has done it since May 2022), youngest and oldest FNCS winners (age on the day, published birthdays only), most finals before a first win, longest wait between two wins, most finals in a row (rounds already played), the pairs with the most major titles together (FNCS finals, Globals, major LANs; a trio is three pairs, so a player can be on several rows — naming them once names them on every row of theirs, "EpikWhale — 1st and 2nd. 1 name to go on each." (15 Oct 2026, the user: "I had to type rehx, arkhram and epikwhale twice"; it used to fill one row per guess)), and countries by different FNCS winners. **Added 15 Oct 2026:** the most major titles in a row ("Top 10 by consecutive major titles", in Players beside the notebook's "consecutive FNCS titles"; the user: "Major tournament back to back isn't the same as fncs back to back") — every FNCS round is one major and so is each Globals and major LAN (`majorRounds` in `facts.ts`), so losing one between two FNCS wins ends the run, while a LAN the player was not at is passed over; Pollo has 4 with the 2024 Globals, Koyota and Yuma's FNCS 3 is a 1. The FNCS board's own rule now says a Globals or a LAN neither counts nor ends it (`derived.py`, and patched into `rankings.json` until the next run). Each FNCS region's youngest and oldest winners (age at the first and latest win there; "youngest fncs winners on eu"). The fewest finals before a first win again for first wins from 2021 and from 2022, every final before the win still counted ("we still count the fncs they qualed"); a dated board with the same eleven as the one before it is left out, so NA Central, whose finals start in 2023, has only the one, and NA East has no 2022 board |
| By birth year | 22 | the top 10 earners born in each year, 1990 to 2011 |

**Asked for on 14 Oct 2026 and not built**, because the data does not make a fair ten: first 10 to win in two FNCS regions (nine have: Acorn, Muz, Dukez, SwizzY, Veno, Peterbot, Cold, Boltz, Khanada), fewest finals before a first win (43 won their first), most Globals in a row (24 have played all four), every LAN champion as exactly ten (fifteen), anyone's ten FNCS partners (nobody has exactly ten), and List's "won the FNCS in two NA regions" (six players, under List's eight).

Seven FNCS finals are left out by the rules below: a finisher the roster cannot name, a shared place in the top eleven, or a player listed twice.

### Ties

Every board prints its own tie rule above the slots:

- **Counts.** Wins, appearances and players are split by career earnings, the bigger earner higher. Countries and organisations are split by their players' combined earnings.
- **Money boards** are straight money order.
- **Youngest and oldest** go by birth date, not age in years.
- **Never the alphabet.** If 10th and 11th are still level after the tie rule, either of the two fills 10th (`shareCut`), and naming the other after that says it is level and costs nothing. Today that is Top 10 earners in 2018 — Asia. A 12th level too still drops the board (squad earnings).
- **The 11th is wrong.** Naming the 11th, level with 10th or not, costs a life like any wrong answer; the game only says it was 11th (13 Oct 2026, the user: "top 11 is still wrong" — it used to be a free near miss). Only a shared cut is free: there both are right.

### Season boards

Average finish, three ways, built in cell 2 of `scripts/pipeline/derived.py`:

- **Top 10 players of 2025** — the year's majors: every round of FNCS grand finals plus the year's LANs (the World Cup finals, the 2022 Invitational, the Globals, the Summit, EWC). For 2026 that is EWC, the Globals, the Summit and Majors 1 and 2 (Vico: 1 + 3 + 1 + 3 + 20 = 5.6). Not built for 2020 and 2021, which had no LAN.
- **Top 10 by average FNCS finish in 2025** — the rounds of FNCS grand finals alone, 2019 to 2026.
- **Top 10 by average FNCS finish, all time** — every round since 2019.

A round is every region's final in one week (the waves), and a player has one finish in it: their own region's. Each comes as a world board and one per FNCS region, with North America split the way the FNCS split it: NA East and NA West until Major 1 of 2023, one North America final (NA Central) to the end of 2024, NA Central and NA West from 2025. From 2022, when each year kept one team format, the same boards again for duos or trios: a team only has a finish where exactly those players played together, each player counts once with their best team, and every name fills one slot.

A missed event counts as twice a full lobby's last place: 100th in duos, 66th in trios, 200th in solos, 50th in squads. Being there with no finish recorded (a DQ, or out of the Summit before its last stage) counts as a miss. Level averages go to the bigger career earner, a team's combined. A board with a player the roster cannot name in its top eleven is not built (2025's Middle East trios).

### Div Cups and Performance Evaluations

Built in cell 2 of `scripts/pipeline/derived.py` from every tournament named "Divisional" (FNCS Divisional Cup finals from C6S1, C6S4's three Practice Cups included) and "Fortnite Performance Evaluation". Both are read by pagename: Liquipedia named the C7S4 Div Cups after C7S3, and the placements, which only carry the name, are split between the two by date.

- **Regions.** Seven Div Cup regions, NA Central and NA West separate. Every region's final is its own event, so a player in two regions in one week has two finals on the world boards; on a world average, they keep that week's better finish.
- **Counts** (finals reached, wins, earnings) are all time, by chapter and by year; a year needs four weeks, so December 2024 counts only in all time and Chapter 6. Level counts go to the better average Div Cup finish over the same weeks, a missed week at 100th.
- **Averages** are by chapter, year and season, a missed week at 100th whatever the format. Teams only have a finish where exactly those players played together. Chapter 6's duo Div Cups (C6S4) are left out of the team boards, so Chapter 6 and 2025 are trios, Chapter 7 and 2026 duos, and C6S4 has no team board.
- **Performance Evaluations** are Europe and NA Central only: sessions played and money, all time and per year (2023's seven sessions count in all time only), money by format where a scope had two. Level ones go to the bigger career earner.
- **Not built:** 19 Div Cup boards, mostly NA West and Middle East team averages, have a finisher in the top eleven with no Liquipedia page.

### Tournament boards

A tournament board ranks placements, so on a duos or trios event one slot is a whole team. It fills as you name its players and locks once all of them are in. An event is skipped if two teams share a place in the top eleven, a player is listed twice, or a finisher has no roster entry.

### Event-mode boards

For a field, the shipped boards are replaced by up to 17 built on the spot, under one heading, in the order planned for the limited mode:

1. career earnings
2. youngest
3. lowest career earners
4. FNCS wins
5. Europe by earnings
6. countries by players
7. earnings this year
8. oldest
9. organisations by players
10. North America by earnings
11. LAN appearances
12. FNCS grand finals played
13. the event's top 10: the final standings, one duo per slot
14. biggest upsets
15. biggest disappointments
16. tournaments played
17. countries by career earnings

**Results boards (13–15)** appear once `pools.json` carries the event's placements. Upsets and disappointments also need `earningsBefore`, cell 5's career prize money from every tournament that started before the event:

- **Seed.** Each team is ranked by its players' combined earnings before the event, richest 1st. The published career figure is not used, because it already holds this event's prize and would make every winner look like the favourite.
- **Upsets** rank places gained from seed to finish, e.g. Izzi & Nociff, seeded 46th, finished 16th: +30. Level teams go to the better finish.
- **Disappointments** rank places lost, e.g. EpikWhale & PXMP, seeded 2nd, finished 42nd: −40. Level teams go to the higher seed.
- **Whole teams only.** A board is not offered if one of its eleven teams has a player the roster cannot name.

Top 10 of day one, eliminations and damage still need data the export does not have; see Limited mode.

## List

You get one list and 90 seconds to name as many of it as you can. Every correct name adds 5 seconds, so a good run keeps extending itself.

- **Levels.** On Easy a wrong name costs nothing; on Hard it takes 3 seconds off.
- **Finishing.** Naming everyone ends the round as a win on the spot. A repeated name does not count again.
- **Missed names.** When time runs out you see everyone you missed.
- **The suggestion box** helps you spell a name you already thought of, and never says whether it is on the list.

**The lists are hand-picked, not generated.** A recall game only works when you can picture the answer set, so there are 356 all-time lists with at least 8 answers each:

| Family | Lists | Example |
| --- | --- | --- |
| Organisations | 52 | has played for FaZe Clan (anyone, at any point) |
| Two events at once | 45 | at both the 2023 and 2024 Globals; played every Globals; two FNCS finals in a row |
| By country | 42 | French FNCS winners; French players who have played a LAN; countries with a player over $1M |
| Earnings | 20 | $1M+ career; $200K+ in 2021; $500K+ in a single year |
| Teammates | 20 | 10+ tournaments with one of the 30 top earners |
| FNCS | 18 | FNCS winners by region; 20+ grand finals; won the FNCS back to back, and majors back to back (15 Oct 2026: the Globals and LANs count there); won one before turning 15, or aged 20+ |
| Year by year | 56 | won a major in 2023; played every FNCS grand final of 2024 — Europe (each year by region, the one they played most of the rounds in; 2019's asks for the World Cup too and stays one list, 65) |
| Div Cups | 94 | winners by region, and duo and trio winners by region; 40+ and 50+ finals, 20+ and 30+ in one region; 5+ and 8+ wins; played every week of a season, by region |
| Performance Evaluations | 6 | 40+ and 60+ sessions, by region too |
| The 2026 season | 1 | played all five big events (the top 10s are Tenite boards) |
| Titles and fields | 2 | LAN winners; qualified for a field |

Lists answered with countries or organisations search every name, not just the answers.

- **Age at a win** is on the day of the grand final, from the published birthday; the dates are Liquipedia's regional finals, the same finals the FNCS count is made of.

**Played or not.** Tenite's and List's pickers mark each board green (completed), yellow (tried: gave up or fell short) or red (not played), from `progress:<game>` in local storage (`games/shared/progress.ts`). Keyed by puzzle id, so a daily puzzle can key by date. The Random buttons pick an unplayed board first, then a tried one, then any (`pickFresh`).

### Event-mode lists

A field gets 21 lists, in the order planned for the limited mode. Field lists may be as short as 4 answers, because "name the four from the Middle East" is a fine round:

1. qualifiers from Europe, North America, South America, the Middle East, and Asia or Oceania
2. who won an FNCS this year
3. organisations with a player there
4. countries with a player there
5. who has won an FNCS
6. who also played each of the last three LANs, and who is playing their first LAN (none of the LANs before it)
7. who earned $50K+ or $100K+ this year
8. who has $500K+ or $1M+ career earnings
9. then everyone who qualified, the well-represented countries, LAN winners, never won an FNCS, and retired

There are no ties in a list: it has no order, so everyone who fits counts.

## Griefer

You get a rule, such as "has played for NRG" or "has won a LAN", and ten cards in two rows of five. Four to six of them fit, and the board never says how many; the rest are griefers.

**Cards show the handle and nothing else.** With a flag on the card, "competes in Brazil" was solved by looking, not knowing. The count stays hidden because a stated count turns the last pick into arithmetic.

### How a board is built

1. **The rules.** Build the criteria for the chosen pool, keeping those with 4+ players and under 40% of the pool. Twelve kinds are used: country, region, organisation, FNCS winner, Global, LAN and major winner, 2+/3+ FNCS wins, earnings, won a region's FNCS, won an FNCS in a year, played at a named event.
2. **One seat per kind.** Draw one rule per kind, then shuffle. A flat draw was an organisation generator: about 174 of 250 rules were organisations, so "has played for X" came up seven times in ten.
3. **The ten cards.** Pick 4–6 players who fit (never more than the rule has) and fill the ten with players from the same pool who do not fit.
4. **Near misses** (since 3 Oct 2026). 60% of the griefers come from the outsiders who most nearly fit (`nearness` in the engine), the rest are random so not every card is a trap. Near means: the same scene for a country, the same flag elsewhere for a region, an FNCS partner of the org's players, a finalist or LAN podium for a title, one title short, just under the earnings line, a winner from another region or year, a player at another headline event — plus the same fame as the players who fit. "Has won a LAN" now deals TaySon and K1nG as griefers; "$1M+" deals players on $750K–$950K.

### Modes

| Mode | How you play | Ends |
| --- | --- | --- |
| All at once | select everyone you think fits, then Check | the selection must be exactly right |
| One by one | tap a card, then confirm it | a correct pick continues; a griefer ends the round |

The confirm step exists because a mis-tap on a phone used to end the round outright.

**The dashboard counts misreadings.** Analytics record every card and whether it was picked, so the dashboard shows which rules and which players get misread.

## Box Fight (was Tic Tac Toe)

A 3×3 grid has a rule on each row and each column; every cell needs one player who fits both. You don't pick the cell: you type a player and the grid works out where they go. Each player can be used once.

| Level | The board is built so every cell has | Most cells one player fits | Lives |
| --- | --- | --- | --- |
| Easy | 3+ household names (Easy tier) | 4 | 3 |
| Medium | 2+ regulars | 3 | 3 |
| Hard | at least one player from anywhere on record | 2 | 1 |

At every level any player who fits is accepted. The level decides what the board is built around, not who you may type. A name that fits no open cell costs a life, and the last life ends the board. Hard used to say "nine guesses, one per cell", which was one life said the long way round.

**Lives are hearts in every game that has them:** Tic Tac Toe, Tenite Hard, Connections and Guess the Player (`Hearts` in `components/ui.tsx`). Career Path and Who Are Ya count clues instead, Fortnitedle's rows are its tries, and Higher or Lower and Griefer end on the first mistake.

### How a board is built

1. **Rows first.** Choose three row rules from the criteria, each weighted by one over the square root of how many rules share its kind, so nine "Played <event>" rules do not crowd out the one "LAN winner". The rules of the player's last three boards are left out (`tic-tac-toe:recent` in local storage), or failing that the last board's.
2. **Columns second.** Choose the three columns only from rules that already share a player with all three rows. Picking six rules at random failed 36 times in 40, because 138 of the 276 rules are organisations and two organisations almost never share a player.
3. **Enough answers.** Check each cell has the answers its level promises, from that level's fame band.
4. **Varied rules.** No more than two rules of the same kind, and no two rules nearly the same (the 90% rule).
5. **No one answer for the whole board.** A player fits rows × columns cells; that may not pass the level's cap. Before it (30 Sep 2026), EpikWhale, Bugha or Peterbot fitted all nine cells on one Easy board in five, and someone fitted six on most of the rest. Easy's pool is only ~100 famous players who share most achievements, so 4 is as tight as it goes there, and Easy draws on only ~37 rules.
6. **Nine different players.** Prove, by a quick backtracking search, that the nine cells can be filled with nine different players. Otherwise the "each player once" rule could make a board unwinnable.

If no board passes, the promises give way one at a time: recent rules, then redundant-looking axes, then the cap, and last the answers per cell.

### Building a grid by hand

`/analytics/grid` on a dev server (the user, 14 Oct 2026: "a real tic tac toe board creation in analytics… for now maybe just in dev mode, in the future when I add daily I would add it in there"). Pick a level and three rows and three columns from the rules that level's boards draw on (`boardRules`); each cell shows its answers from the level's players, everyone who fits, and the best-known three. `inspectBoard` in the engine holds the grid to every promise `generateBoard` makes at that level — answers per cell, the reach cap, no near-nested pair, two of a kind at most, nine different players — and lists what it breaks. **Random grid** starts from a generated one. **Play it** opens the game on that grid (`?grid=`, dev only, read by `readGridSpec`). **Save** keeps it in this browser (`dev:grids`), and **Copy** gives the six rule ids, which is exactly a Tic Tac Toe daily's descriptor, for when the game is a daily again.

### Where a typed player lands

The grid only offers a cell that leaves every other empty cell still fillable with players not yet used, so a move can never soft-lock the board.

| Safe cells for this player | What happens |
| --- | --- |
| none (fits no open cell) | rejected; a mistake on Easy and Medium |
| exactly one | placed there automatically |
| several | highlighted, and you tap one |

A player who fits always has at least one safe cell, by construction. If you lose, each empty cell shows three answers you could have used: its biggest earners, since those are the ones you should have known.

## Squads (was Connections)

Sixteen players, four hidden groups of four: select four and submit. You have four lives, shown as hearts. A wrong guess with three of the four right says so; anything less says nothing, because two-of-four happens by chance on most guesses.

**Each group's rule fits exactly its own four players.** Five Poles may sit on a board where Poland is not a group; they may not when it is. The old design let players fit two groups on purpose, and every board it made had a rule covering five or more of the sixteen.

**Group kinds** are deliberately short, the things anyone can hold in their head about a handle:

- country and region
- organisation
- FNCS winner, 2+/3+ FNCS wins, LAN winner, major winner
- an earnings threshold

Birth year came off the list because nobody can tell a 2005 from a 2006 across four handles.

### How a board is built

1. **Kinds.** Draw four different kinds, then one rule of each. Every fourth draw is a free draw instead, so France and Brazil can both be groups.
2. **Families.** At most two rules from one family, and no two rules nearly the same (the 90% rule). The families are where-from (country, region) and titles (the four title kinds).
3. **Twenty tries.** Keep the drawn kinds for 20 attempts before redrawing, so kinds that are harder to deal still get boards.
4. **Deal.** The scarcest rule first: each group's four come only from players who fit none of the other three rules.
5. **Fame mix on Random.** Each group gets two household names, one regular, and a regular or a deep cut, falling back to the nearest tier the pool has.
6. **Balance.** The groups' players must sit at comparable earnings ranks. An earnings group sits out, because it is the richest four on the board by definition.
7. **Decoys.** Reject the board if a rule that is not in play lands on exactly four players across different groups: four French names when France is not a group.
8. **Give up.** After 1,500 attempts, say the pool is too thin.

| Pool | Boards built | Tiles by tier |
| --- | --- | --- |
| Random | 20 of 20 (was 16) | 41% Easy, 50% Medium, 9% Hard |
| One tier, e.g. Medium | 40 of 40 | that tier |
| FNCS 2026 Globals | 10 of 10 (was 7) | the field |

Known gaps: most single-region pools (Asia, Oceania, several Hard tiers) cannot build a board, before and after the rebuild. South America Easy and Medium went from 4 in 10 to none: that pool has only five usable rules.

**On screen:** one column, 600px at most, holds everything in play — the stats, the solved rows, the sixteen tiles and the buttons — so nothing is wider than the board (the user, 14 Oct 2026: "The board is so tiny, but other buttons are so big in comparison"). Each tile is a quarter of the column, wider than tall: 144 × 84 at the cap, 64 tall on a phone. A solved group takes a row's place at the same height. Tile text scales with the column (container units), a size smaller for handles of eleven characters and up, and breaks inside a handle only when it has to.

## Pyramid

Ten players and one category; sort them into a pyramid of 1, 2, 3 and 4, best at the top, and check. Everything in place turns green and locks; the rest is red until moved. Tap two to swap, or drag one onto another (pointer events, so it works on a phone).

| Level | Who | Values | Checks |
| --- | --- | --- | --- |
| Easy | the Easy tier | start in the top quarter of the ranking; money at least 12% apart, birthdays 180 days | unlimited |
| Medium | Easy + Medium tiers | top third; 6% apart, 90 days | 2 lives |
| Hard | everyone | top half; 3% apart, 30 days | 1 life |

**Categories.** A kind first, each equally likely, then a category inside it (`playerCategories` in the engine):

| Kind | Category | At the top |
| --- | --- | --- |
| FNCS finals | FNCS grand finals played | most |
| FNCS wins | FNCS wins | most |
| Earnings | career earnings | most |
| Earnings in a year | one year, 2018 to now | most |
| Age | by birth date, shown as the age to the month ("19y 4m"); no birthday, not in it | youngest |
| Followers | Twitch or YouTube, while the server has fresh counts | most |
| Tournament | ten finishers at one event | best finish |

- **Tournaments:** the events of Tenite's tournament boards — the LANs on Easy, plus EU/NA finals since 2024 on Medium, every final on Hard; on a duos event each item is the team. The ten are drawn at random from the event's results in `career_path.json` (the user, 1 Oct 2026: not always the top ten): from the top 20 on Easy, the top 30 on Medium, anywhere on Hard, and only places whose whole team is on the roster. Without that file, the top ten.
- **Hidden:** LAN appearances (the user, 14 Oct 2026: "remove category lan appearances for now"). Its code stays behind `hidden: true`; `check:games` fails if it is drawn, or if the flag goes.
- **Close but orderable:** money and followers walk the ranking from the best end, taking the next player at least the level's gap from the last; age does the same with birth dates, at least 180, 90 or 30 days apart (the user, 14 Oct 2026: "if the same age but months it's fine"). Counts take one player per distinct value; FNCS wins has fewer than ten values, so up to three pairs share a value.
- **Ties:** players level on a value are right either way round.

**Left out:**

- FNCS podiums, FNCS top 10s and average Globals finish: added on 14 Oct 2026 and taken out the same day (the user: "Keep only age, don't want this other categories in there").

- LAN wins: fifteen players have one, nearly all exactly one.
- Majors played: the regional finals plus a handful of LANs, so the same order as FNCS grand finals played, give or take one.
- Div Cup finals and wins, Performance Evaluations: `facts.json` has them only as lists over a threshold (40+ Div Cup finals and so on), not a count per player.
- Teammates: `teammates.json` keeps fifty per player, so every regular is level on 50.
- Earnings in the latest year: already one of the years in "earnings in a year".

## Bingo

A 4×4 card of categories and players dealt one at a time: tap a square the player on show fits, or skip them. The aim is the full card (the user, 30 Sep 2026: "the aim is to solve full bingo"); lines are only progress. A player on a square they do not fit costs a life and that player; skipping is free.

Three modes (the user, 14 Oct 2026: "2 modes. One is which is now with amount of players, second is with time … And maybe even no timer"), on the same cards, levels and lives:

| Mode | The players | The round is lost when | Best (lower wins) |
| --- | --- | --- | --- |
| Deck | a fixed deck, each player once | the deck is done or the lives are gone | fewest players to a full card |
| Timed | drawn from the level's band, until the clock runs out | the clock runs out or the lives are gone | fewest seconds |
| Endless | the same stream, no clock | the lives are gone | fewest players |

| Level | Dealt from | Deck | Clock | Every square has in the deck | Lives |
| --- | --- | --- | --- | --- | --- |
| Easy | the Easy tier | 40 | 2:00 | 3 players | 3 |
| Medium | Easy + Medium | 35 | 1:45 | 2 | 3 |
| Hard | everyone | 30 | 1:30 | 2 | 2 |

- **Sizes and clocks:** the user, 14 Oct 2026: "Decrease players, so have like 40-35-30" (they were 50, 45, 40) and "60-90-120" seconds, read as the easier level getting the longer clock. Raised the same day to 2:00 / 1:45 / 1:30: a perfect player needs about 21, 34 and 39 players, so 1:00 left Hard 1.5 seconds a player; now the pace is about 5.7, 3.1 and 2.3 seconds.
- **The deck:** players until every square is covered that many times, then anyone from the band — some fit nothing and are there to be skipped (about 1.4 per Easy deck, 5 on Medium, 4 on Hard). It is kept only if a full card is possible and stays possible with any one player removed, so no single player is the only way to a square. The covering alone takes 19–28 players, so even Hard's 30 has room: 25 of 25 seeds build on every level, guarantees unchanged.
- **The stream (Timed, Endless):** each player is drawn from the level's band, never the one just shown. Anyone else can come back, and go on another square they fit — on Hard a square may have only two answers in the band, so ruling out players already on the card could leave it impossible. The draw leans towards the open squares (the user: "when there is 1 category left, the players who fit are much more likely to be there"): at least 0.75 / ∛open of the stream fits one, or the band's own share when that is higher. A fitting player is drawn square-first, an open square at random and then someone who fits it, so a square with three answers is fed as often as one with three hundred.

  | Open squares | 1 | 2 | 4 | 8 | 16 |
  | --- | --- | --- | --- | --- | --- |
  | Fit an open square, at least | 75% | 60% | 47% | 38% | 30% |

  Never all, so a skip is still a decision. Measured by `check:games`: 74–75% with one open on every level. A good player (each fit on its scarcest square, the rest skipped, nothing wrong) fills the card in a median 21 players on Easy (18–25), 34 on Medium (27–59) and 39 on Hard (26–50) — six seconds a player on Easy's clock, two and a half on Medium's, a second and a half on Hard's.
- **Lives** are the same in every mode: in a stream that never runs dry they are what stops tapping squares at random from being free.
- **The clock** is the component's: a start time read ten times a second and before every move. The engine is told the time (`tick`) and ends a Timed round when it is up, so it stays pure and a tap after the clock ran out is refused.
- **Best:** per mode and level on the device (`best:bingo:<mode>:<level>`), set only by a full card.
- **Analytics:** `setup.mode` is `deck`, `timed` or `endless`; the payload keeps its shape, with `deck: 0` for a stream.

- **Squares:** Tic Tac Toe's categories plus Bingo's own: FNCS finals played (1+, 2+, 10+), played for 3+ organisations, FNCS finals in 2+ regions, played the World Cup, won FNCS with 2+ teammates, and 10+ tournaments with a famous player (complete at 10 — the teammates file keeps each player's top 50).
- **Which Chap:** "10+ events with X" names X with `namedPlayer`, judged against the whole roster rather than the level's band: three players are called Chap (the user, 14 Oct 2026: "it should be specified which exactly"), so the square reads "10+ events with Chap (United States)". Eight anchors say which: aqua, Chap, Cold, Cooper, Deyy, K1nG, Rapid and Rise. The shared "Won FNCS with X" judges against the band, so "Won FNCS with Cold" (Medium, Hard) and "Won FNCS with K1nG" (Medium) stay bare: the other Cold and K1nG are not in those bands. `check:games` notes them.
- **How a card is drawn:** weighted by kind like Tic Tac Toe, at most two of a kind, no two nearly the same, and no player fitting more than 5 squares (one name used to fit 7–10).
- **Not possible from the export:** "is a controller player" (no input device in the data) and "was in a trio with X" (teammates are not split by mode).

## The October games (hidden)

Seven games added on 2 October 2026 from the user's roadmaps, all `hidden` in the registry. They share three pieces:

- **One Easy / Medium / Hard** (`LevelSetup`), with pools that widen rather than slice (`games/shared/levels.ts`): Easy the Easy tier, Medium Easy + Medium, Hard everyone. The secret comes from a no-repeat bag per game and level (`dealFresh`).
- **The clue loop** (`games/shared/clue-round.ts`) for the five that reveal clues: a wrong guess or a skip reveals the next, a wrong guess with everything showing ends the round, and a hand shorter than its `minGuesses` makes the difference up with guesses that reveal nothing. Career Path and Who Are Ya keep their own copies of the same loop.
- **`bios.json`** (`build_bios` in `scripts/pipeline/enrich.py`): real names and dated organisation stints from `transfers.json`. Until it is built, `loadBios()` falls back to `players.json`'s names and `orgs.json`'s undated lists, and the modes that need dates are greyed out.

| Game | What you do | Folder |
| --- | --- | --- |
| Curveball | Name the player from their prize money drawn as a curve, a year at a time | `curveball` |
| Org Chart | Name the organisation from players who played for it | `org-chart` |
| Contextinho | Find the secret player; every guess is ranked by how alike it is | `contextinho` |
| Rewind | Put seven to ten moments in order, oldest first | `rewind` |
| IRL | Name the player behind a real name, their file filled in a line at a time | `irl` |
| Transfer Window | Name the player from the organisations they have played for | `transfer-window` |
| Which Lobby? | Name the tournament from its leaderboard, filled from the bottom up | `which-lobby` |

### Curveball

The curve runs from the first year with prize money to the last, empty years in between included (they sit on the floor). It needs three years with money: 108 Easy players, 965 up to Medium, 3,873 in all. A curve under five years still gets five guesses.

- **One curve: earnings**, that year's prize money. The roadmap's "PR curve" is not possible — PR is Fortnite Tracker's power ranking and the export has none — and a world rank by prize money that stood in for it was dropped (the user, 2 Oct 2026).
- **The axis is fixed**, so its range never gives away how high the curve goes: a cube-root scale from $0 to $1M, and $1M–$5M squeezed into the top tenth (only 11 years on record pass $1M, ten of them the 2019 World Cup). It was a log scale from $100 to $5M, on which $500K and $600K stood 4 pixels apart; they are 11 apart now (the user, 14 Oct 2026: "500k and 600k are completely similar"). A square root would part them further but flatten the small earners: on the cube root a $1K year still sits a tenth of the way up, and Hard's typical curve peaks at a sixth of the height (`AXIS`, `heightOf`). The year labels are question marks until revealed, and the span only shows once the round is over.

### Org Chart

The pool is the organisations with a team page and five roster players, richest first: the top 25 on Easy, 75 on Medium, all 392 on Hard. Up to eight players are clues (seven until the user's "increase it to eight if there is enough", 14 Oct 2026): the two best-known by career earnings (never in the first three clues), three of the next ten, and three from anyone. Eight is a full hand for 23 of Easy's 25 orgs, 65 of Medium's 75 and 306 of Hard's 392. The org's region comes after the third player, the year it was founded after the sixth or the last (`founded`, new in orgs.json), its prize money last.

- **Clues**: Full dates (joined – left, "now" for a current player), Joined, Names only. Dates need `bios.json`.
- The guess box offers every org with a team page, not just the level's.

### Contextinho

Every guess is ranked against the secret out of all 5,689 players, the secret #1. Similarity is a weighted sum of parts, each 0–1 (`rankAll`). The defaults are the user's own mix from the lab (14 Oct 2026: played together 5, country 2, age 1.5, region 1, shared teammates 1, same years 2, same organisations 2 — "Something like that") plus three parts asked for the same day:

| Part | Default weight | 1 means |
| --- | --- | --- |
| Played together | 5 | 40+ tournaments as teammates (log scale) |
| Teamed up lately | 3 | three FNCS finals or major LANs as teammates this year, each faded by the half-life |
| FNCS wins together | 4 | two regional FNCS titles won on the same team, faded by the half-life; one scores 0.7 |
| Won a big event together | 5 | 1 per World Cup, Globals or major LAN won on one team, times the event's weight and the fade |
| Big events together | 4 | teammates at two major LANs, or on the podium of one; once scores 0.7 |
| Country | 2 | same first nationality; a neighbour in the same scene 0.5; any other country up to 0.4 by the distance between capitals |
| Age | 1.5 | same birthday; two years apart scores about a third; unknown 0.3 |
| Region | 1 | same region |
| Shared teammates | 1 | the two top-50 teammate lists overlap by a third |
| Same years | 2 | prize money in exactly the same years |
| Same tournaments | 1.5 | majors both played ÷ the shorter career, counted as at least 10 |
| Same organisations | 2 | two organisations in common |
| Career earnings, FNCS wins | 0 | off, for trying |

- **FNCS wins together** — "if they win together it should be a really big clue" — counts titles per partner from `facts.json` (`Facts.fncsTitlesWith`).
- **Big events together** are the major LANs (`Facts.headlineEvents`: the World Cup, the Globals, the 2022 Invitational, the Summit, the Reload Elite final) — "if the players played together world cup it should give them a lot of points". A team is everyone who finished in one place (`Majors.finishers`); a place two teams tied for is skipped. A podium counts twice, so Aqua's World Cup partner Nyhrox is #3 for him rather than #4.
- **Same tournaments** is lobbies rather than years ("some eu player plays fncs and I name another player from eu, they could have played in the same lobby a lot"): the regional grand finals and LANs of `career_path.json`. Dividing by the shorter career lets a short one score fully if it was all spent in the secret's finals; the floor of 10 keeps one shared final out of one at 0.1. 10 measured better than 5 or 15.
- **Won a big event together** (the user, 14 Oct 2026: "what about like world cup win, or globals win"): every partner it gives is one of the secret's three closest — Aqua → Nyhrox and Cooper → Mero the closest of all (#5 for Mero at weight 0).
- **Event weights** (lab only, all 1 by default): World Cup, Globals, 2022 Invitational, 2026 Summit, other major LANs, each multiplying its events in the two big-event parts ("add weight for tournaments, so I can add extra weight to world cup or vice versa"; `EVENT_FAMILIES`).
- **Recency** ("recency bias to the teammates or wins"): titles, big events and "teamed up lately" fade with a half-life, 4 years by default (`DEFAULT_HALF_LIFE`, a lab slider; "now" is the data's date). Played together cannot fade: `teammates.json` keeps only totals. Against each Easy secret's partner at their latest final or LAN: one of the three closest 51% of the time before, 57% now; the top teammate #3.1 → #2.9; every FNCS partner still in the top 25. Two years, or "lately" heavier, pushed 2019's title partners out.
- **Country** is no longer all-or-nothing ("in eu, especially in countries with a small amount of players there could be a problem"). The scenes, hand-made in the engine: UK & Ireland, the Nordics, DACH, Benelux, Iberia, Italy & Malta, the Baltics, Central Europe (Poland, Czechia, Slovakia, Hungary), the Balkans (with Greece, Romania, Bulgaria), Eastern Europe & CIS, US & Canada, Spanish-speaking America & the Caribbean, the Gulf, the Levant, Iraq & North Africa, Oceania, Greater China, Southeast Asia, South Asia, Sub-Saharan Africa. France, Brazil, Japan, South Korea, Turkey, Israel and Iran count by distance alone. Outside a scene, the distance between capitals gives up to 0.4, nothing past 2,500 km (14 Oct 2026, the user: "it's still gives to neighbor only"): Berlin–Warsaw 0.32, Paris–Madrid 0.23, Lisbon–Moscow 0 (`CAPITAL` in the engine, every roster country). There is no same-continent step: `region` is read off nationality, so it already is one.

Measured over all 109 Easy secrets:

| | Old defaults | The user's mix, old parts | Now |
| --- | --- | --- | --- |
| Top teammate, average rank | #12.3 | #6.6 | #3.1 |
| FNCS-winning partners in the top 10 | 77% | 85% | 99% (worst #17) |
| Big-event partners in the top 10 | 68% | 73% | 95% |
| A regular of the secret's finals, never a teammate (median) | #425 | #180 | #73 |
| A neighbour of a small-country secret (median) | #879 | #1015 | #295 |
| A random same-region stranger in the top 25 | 1% | 0% | 0% |

`check:games` holds every Easy secret to it: an FNCS partner in the top 25 (two titles, top 10), a full big-events partner in the top 10, a big-event winning partner among the three closest, nobody the secret never teamed with in the top 3. Ties go to the bigger career earner. A hint names a player halfway between your best rank and #1. The round waits for orgs, facts and majors to load or fail, so a late file cannot re-rank the guesses. **The similarity lab** (dev builds only) has a slider per part, Rank or 0–100 display, the parts on every row and a peek at the ten closest — the roadmap's V1 is about finding the right weights, so they are knobs rather than constants.

### Rewind

17,704 moments with a date and no year in their words, in twelve kinds — widened on 14 Oct 2026 (the user: "Needs more categories, without it not really interesting. Maybe also like famous players first earnings. Or first fncs finals"):

| Kind | Example | Moments | Dated by |
| --- | --- | --- | --- |
| LAN win | "Cooper & Mero win the Global Championship" | 9 | the event |
| FNCS round | "The FNCS C2S1 grand finals", for seasons whose names carry no year | 16 | the round's first final |
| First / later FNCS title | "Peterbot’s first FNCS title", "Pollo’s 2nd FNCS title" | 247 / 175 | the final won |
| First FNCS final | "Bugha’s first FNCS final" — the finals the glossary's "FNCS grand finals played" counts | 3,318 | that final |
| Duo | "Bugha & Mero’s first FNCS final together", pairs with 3+ finals side by side (needs `career_path.json`) | 746 | that final |
| First prize money | "Bugha’s first prize money" | 5,695 | the year |
| Best year | "Bugha’s best year for prize money", careers of two years or more | 5,048 | the year |
| Org's first FNCS title | "NRG’s first FNCS title": the first regional final won by a player with the org that day (needs `bios.json`) | 39 | that final |
| Signing / departure | "Bugha joins Sentinels" / "Bugha leaves Sentinels", at the 60 richest orgs (needs `bios.json`) | 1,188 / 1,173 | the stint |
| Founded | "Gentle Mates is founded", orgs founded since 2017 | 50 | the team page |

Prize money is recorded per calendar year, so those two kinds are dated by the year (`wholeYear`): the card shows "2019" once locked, and the gap is kept from the whole year, so nothing else in the deal falls inside it and the order stays exact. The game waits for `orgs.json` and `career_path.json` to load or fail before it deals.

Not added, because the data cannot date them well: a first Global Championship (49 of the 57 Easy players' first was 2023 — one date), a biggest single payday (only 20 players have paydays boards, and those name the event without a date), a first Div Cup win (the Div Cup lists are undated), a first LAN (the export holds only Epic's headline LANs, so a DreamHack would be missed).

| Level | Moments | At least apart | From | Checks |
| --- | --- | --- | --- | --- |
| Easy | 7 | 180 days | Easy-tier players, LAN wins, top-20 orgs; no later titles or FNCS rounds | unlimited |
| Medium | 8 | 75 days | + Medium, FNCS rounds, later titles | 2 lives |
| Hard | 10 | 30 days | everyone | 2 lives (14 Oct 2026) |

7, 8 and 10 are the user's ("maybe overall more events, like 7-8-10"). The gaps are a little wider than the old 5/6/7 deals had (150, 60, 21 days); each level deals 2,000 seeds out of 2,000 and starts failing only far wider (Easy around 450 days, Medium 365, Hard past 180).

At most two of a kind (more when the pile has few kinds), two about one player or org, and two prize-money years. The check is Pyramid's: right places lock green and show their date; tap two to swap, drag, or the arrows. A card is one line, about 42px, with its arrows side by side (30px; 38px on a touch screen) and the date in their place once locked, so Hard's ten fit a laptop screen (the user: "make it smaller, because it's too big").

### IRL

The pool is everyone with a real name on their page: 109 Easy, 711 to Medium, 1,983 in all. The file: real name, nationality and region, birth year, past organisations, prize money, FNCS titles, best major result, most frequent teammate, current team, aliases, and last the handle with its letters blanked ("B _ _ _ _"). A line the data has nothing for is left out.

### Transfer Window

Players with three or more organisations: 81 Easy, 594 to Medium, 2,009 in all (79, 549 and 1,700 on `orgs.json`'s lists before `bios.json` is built). Up to eight org cards (a long career keeps the orgs with a team page, then the most recent), then the player's region, FNCS titles and prize money.

- **Timeline** — every stint oldest first, with its dates, how long it lasted, and a 🏆 per regional FNCS title won during it. Needs `bios.json`.
- **Shuffled** — one card per org, no dates, no order.

### Which Lobby?

186 majors, read as rounds and regions off their names (`games/shared/lobbies.ts`: "FNCS 2023 - Major 2: Europe - Grand Finals" is 2023's Major 2, Europe). The leaderboard reveals one finisher per band, bottom up — the back half, then closer each time, 2nd–3rd, the winner — six or seven per lobby, sized to how far its results go (`bands`).

- **No "down to 39th"** (14 Oct 2026): the board's footer said how far the results went, which named the event — 39th could only be the Reload Elite Series at the Esports World Cup (the user: "Don't write down to 50, it can be a spoiler"). The footer now gives the format alone. A fixed top 20 was tried the same day and taken back ("that's not what I meant… Just delete this message").
- **Whole teams only** (`wholeTeams`): a finisher must be exactly its format's team size, every player on the roster. `career_path.json` lists only players with a page, so a duo whose partner has none came back as one player (FNCS 2023 Major 1 Europe's 36th, Brandtman & Moneymaker, read "Moneymaker"); and a shared place reads as its best end, so two duos tied 35–36 at the Reload Elite Series were one team of four. It showed in 14% of Medium rounds and a third of Hard ones (the user: "1 player and duos"). The two Oceania finals that list two teams at 1st (2023 Major 3, 2025 Major 1) end on 2nd–3rd.
- **Guessing** is three taps: year, round, region. A wrong guess says whether the lobby was earlier or later and whether the region was right.
- **Levels**: Easy deals the LANs and the Europe and NA East / North America / NA Central finals (61), with the best-known finisher in each band; Medium adds NA West and Brazil (108); Hard everything (186), anyone in the results.

## Guess the Player

You guess any player and get a row of comparisons against the secret one, then use them to close in. You have eight guesses.

| Column | Compared how |
| --- | --- |
| Region | match or not |
| Country | match or not, on each player's first nationality |
| Status | active or retired, match or not |
| Age | exact, or a direction |
| Career earnings | always a direction: exact-matching a six-figure number would never land |
| FNCS wins | exact, or a direction |
| FNCS finals played | exact, or a direction |
| Together | green when the two have entered 10+ tournaments as teammates; a red cell still shows how many |

**Two feedback styles:**

- **Exact.** Age and the FNCS counts are simply right or wrong. That is worth playing, because competitive players sit in a narrow age band and FNCS counts are small.
- **Direction.** An arrow says whether the secret player is higher or lower on every number.

There are only two colours, green and red; the arrows already say which way to go. A number equal to the secret player's is green in both styles.

**Who can be the answer:** 3,027 players with a published birthday and an earnings figure, so the secret never has a blank. In event mode the birthday is not required: for a secret without one, every Age cell is grey (`unknown`) rather than red. You may guess anyone; a guess with no birthday shows a dash for age.

**The secret is dealt** from the no-repeat bag, with the Random mix: over 3,000 test deals it came out 50% Easy, 34% Medium, 16% Hard. In event mode the field's regions are taken in turn.

## Server, analytics and support

The site has its own small server (`server/index.ts`): plain Node HTTP with one dependency, `pg`. It stores to Postgres when `DATABASE_URL` is set, and otherwise to JSON-lines files in `server/.data/`. In production it also serves the built site, gzipped.

### What is recorded

| Record | When | What it holds |
| --- | --- | --- |
| Page open | the home page or a game's page opened (`useOpen`, counted in `App.tsx` before the game's data loads) | only a count per UTC hour, page, and daily or unlimited; also whether it was the first page of the page load (a visit) |
| Round start | a new deal in unlimited play (each game's `start`), or the first move on a daily (`useDailyRound`) | only a count per hour, as above; also whether it was the first round since the page was opened |
| Round | once per finished round, from a production build, or locally under `npm run dev:all` | game, setup, outcome, and per-game detail such as the pairs, guesses and cards |
| Support request | when someone sends the 💬 form | kind (bug, wrong data, suggestion, category, other), message, and optionally the round just played |
| Error | an uncaught browser error, production only | message and stack; at most 5 per page load, each message once |

Opens and starts go to `POST /api/funnel` and are kept in the `funnel` table as `(hour, page, step, mode) → n`, never as rows per visit (added 4 Oct 2026, the user: "I want people to play to see response"). They are counts of page loads and opens, not of people — a reload is another visit.

**Privacy.** There are no cookies for players, no device id, nothing stored in the browser for the analytics, and no stored IP addresses, and every total is global. Records are shaped so a user id can be attached later if accounts arrive.

**Spam.** The support form has a hidden trap field. When a bot fills it, the server accepts the request and throws it away.

### The dashboard

`/analytics` is linked from nowhere and computed live from the stored rounds and funnel counts on every load (`aggregate.ts`, `traffic()` for the funnel). Rounds were recorded from the launch and starts only from 4 Oct 2026, so a range reaching back before that read "579 of 487 rounds started"; the finish rate now sets starts against `tracked`, the rounds finished since the first funnel count, and says how many it leaves out. It has a page per question (`src/pages/analytics/`):

| Page | Shows |
| --- | --- |
| `/analytics` | five tiles (visits, game opens, rounds started, rounds finished, won) each against the period before with a sparkline; traffic per day as lines; conversion (opens that started a round, rounds finished, rounds won); where visits land; a games table with each game's funnel and how its rounds ended; page opens by weekday and hour (Berlin time); how rounds were set up |
| `/analytics/game/<id>` | one game: the same tiles, traffic and conversion narrowed to it, its daily and unlimited halves side by side, how its rounds ended, then its own tables with a search box. Examples: which clue solved a Career Path, which Tenite answers nobody finds, which Griefer cards get misread, which Tic Tac Toe cells stay empty, which Higher or Lower pairs trip people up |
| `/analytics/players` | a search over every player the rounds mention |
| `/analytics/players/<id>` | one player across every game: what they were (the secret, a card, an answer, a tile…), how often, how often people got them right, and their latest appearances |
| `/analytics/support`, `/errors` | the inbox, with status tabs and a search, and the error table |
| `/analytics/data` | how old the Liquipedia data is (the export date and the files' own), how many Fortnite pages the webhook says changed since, and **Update now** (`server/data-status.ts`) — see below |
| `/analytics/grid` | dev servers only: the Tic Tac Toe grid builder — see Tic Tac Toe |

**The charts** (`src/pages/analytics/charts.tsx`) are hand-drawn SVG and HTML, no library: thin marks, hairline axes, a legend for two or more series, hover and keyboard on every chart, and an "As a table" view under each. Their colours are the `--viz-*` tokens in `analytics.css`, one set per theme, checked for colour-blind separation and contrast against the site's own surfaces. The funnel numbers follow only the range, the game and daily-or-not: an open or a start does not know a round's region, level or outcome, so those filters narrow the tables and the page says so.

**How rounds were set up** splits the rounds four ways by where the players came from. Each breakdown under it counts only the rounds it applies to:

| Source | Meaning | Broken down by |
| --- | --- | --- |
| Random | the shared picker on Random | — |
| Chosen | the picker on Choose | region, difficulty |
| Event mode | an event field was in force | which field |
| Own setup | Higher or Lower, Tic Tac Toe, Tenite and List | level, mode, category |

**Filters.** A bar above every page narrows everything at once. Its choices are the range (24 hours, 7, 30 or 90 days, all time), where the players came from, the event, the region, the difficulty, the level and the outcome. The filters live in the address, so they hold across pages and a view can be bookmarked. The dropdowns only offer values some stored round has. Tables sort by any column.

### Access

| Setting | Meaning |
| --- | --- |
| `ADMIN_PASSWORD` | the dashboard password; without it the dashboard is switched off |
| `SESSION_SECRET` | optional; signs the login cookie (defaults to the password) |
| `ADMIN_OPEN=1` | local only: the dashboard with no password. Ignored when `NODE_ENV=production` |
| `LIQUIPEDIA_WEBHOOK_SECRET` | the last part of the webhook URL given to Liquipedia; the route is off without it. See DATA.md, "Keeping the dump current" |

Locally, `npm run dev:all` sets `ADMIN_OPEN=1` for the API and `VITE_RECORD=1` for the site. The dashboard opens without a password, and rounds you play land in this machine's `server/.data`.

## How it is tested and run

**Load speed.** The build writes a brotli and a gzip copy of every text file (`precompress` in `vite.config.ts`) and the server sends the brotli one to browsers that take it — about a third smaller than gzip. The home page fetches the players while you choose a game (`usePrefetchRoster` in `pages/Home.tsx`).

**Search engines.** Since 1 Oct 2026 every page has a real address — `/game/tenaball`, `/credits`, `/analytics` — instead of a `#/` hash, which a search engine reads as the home page. Old hash links are rewritten on load (`src/main.tsx`). After `vite build`, `scripts/prerender.ts` writes `dist/game/<slug>/index.html` for every game the site shows, plus the home and credits pages: each with its own title, description, canonical link and share tags (`src/lib/seo.ts`, the `seo` field in the registry), and the game's pitch and rules as plain HTML that the app replaces on its first render. It also writes `dist/sitemap.xml`; `public/robots.txt` keeps crawlers off `/analytics` and `/api/`. The server answers any other path with the home page and a 404, so a stray address is never indexed as a copy of the home page. Hidden games get no page until they are unhidden. **One address** (13 Oct 2026): Search Console had crawled `http://` and `www.` copies of every page and listed them as "Alternative page with proper canonical tag". The server now answers a page on `www.offspawn.app`, or on `http://offspawn.app` (Heroku's `x-forwarded-proto`), with a 301 to `https://offspawn.app` and the same path (`canonicalTarget` in `server/index.ts`; the address is `src/lib/site.ts`). API calls and the herokuapp.com address are left alone. Those copies then show in Search Console as "Page with redirect", which is the expected end state, not an error.

Three commands must pass before anything ships: `npm run typecheck`, `npm run check:games` and `npm run check:server`. `npm run build` runs the typecheck again and then builds the site. GitHub Actions runs all of them, the build, `scripts/check_liquipedia_api.py` and `scripts/check_socials_api.py` on every push (`.github/workflows/checks.yml`); Heroku waits for it only with "Wait for CI to pass before deploy" ticked.

The code is GNU AGPL-3.0 or later (`LICENSE`, since 30 Sep 2026; MIT before); the data is CC BY-SA 3.0.

| Command | What it does |
| --- | --- |
| `npm run dev:all` | the site (5173) and the API (3000) in one terminal; Ctrl+C stops both |
| `npm run dev` | the site alone |
| `npm run api` | the API alone, restarting on changes |
| `npm run build` | typecheck, production build into `dist/`, then a page per game and the sitemap (`scripts/prerender.ts`) |
| `npm start` | the production server: `dist/` plus the API (what Heroku will run) |
| `npm run check:games` | plays all ten games to the end in Node and checks what each promises |
| `npm run check:server` | starts the server on a spare port with a throwaway store and checks every endpoint |

### What check:games holds the games to

It plays every game with a perfect player, generating the random games many times over to catch a board that is rare but impossible:

- **Higher or Lower:** 5 runs of 40 rounds per category and level.
  - Round one is top 20 against top 20, and the cap is never left.
  - No tie without an Equal button, and no obvious pair once the schedule reaches close.
  - Under 75% of answers flip direction, and on Hard a shown 0 must not always go up.
- **Tenite:** every board has ten answers you can type, and a tie at 10th is never settled by name.
- **List:** every list has enough answers, none repeated, all typable. Lists answered with countries or organisations search more than their answers.
- **Tic Tac Toe:** 25 boards per level, every one fillable with nine different players, and a Hard board ends on its first wrong answer.
- **Connections:** 40 boards on a tier and 20 on Random. Each splits exactly one way, no rule covers a fifth player, and no two rules are nearly the same.
- **Event mode:**
  - The field's Tenite boards come in the planned order, and the planned lists exist.
  - Every six deals of the secret-player games cover all six regions.
  - Higher or Lower's region lean shows more regions than without it.
- **Definitions:** the matcher explains the right terms for tricky titles, and the LAN list names every LAN.
- **Fortnitedle:** three guesses into a digit answer, every difficulty, Random and the daily say there is a digit, with no digit or # shown and no key coloured; two guesses in, nothing.
- **Career Path:** a two-clue round lasts exactly five wrong guesses, a ten-clue round ten, and giving up is never recorded as running out. Random builds up for every answerable player: no clue comes before one less telling by more than `RAMP_JITTER`.
- **Who Are Ya:** the number one teammate is last in the ramped orders and never in Random's first four; a two-clue hand lasts five wrong guesses.
- **Whole field:** every secret-player game deals all of an event field that its data allows, and Griefer, Connections and Tic Tac Toe build boards from the whole field.
- **Analytics:** one real round per game, recorded and aggregated the way the dashboard reads it; the filters narrow every table, and the player view finds its player.
- **Daily puzzles:** midnight in Berlin on both sides of a clock change; 30 days in a row each with all six built dailies (served or not), no secret player, board or list twice, no kind of board or list on days 2 apart or board family 7 apart, no board on active status, three different secrets a day, all well known; every puzzle rebuilds, a saved round comes back, and the answer wins; a Tenite day pins once, plays from its pinned board, carries "as of" unless it is about one event, and keeps its saved rounds. Analytics: a round finished before the first funnel count is not in the finish rate. The archive: a day's round survives the next day starting, a late day is saved beside it, and a late day counts as played but not towards the streak. `check:server` asks the endpoint for today twice and gets the same set.

A generated data file that is missing makes its games report SKIPPED and the suite still passes, so a fresh clone is testable before the notebook runs.

## Daily puzzles

From **5 October 2026** (`DAILY_START`) the live site is **daily puzzles only** — before that day it plays as it always did, with a line on the home page saying when the dailies start, and it switches by itself at midnight in Berlin: one puzzle per game per day, the same for everyone. The setup screens — the pool picker, levels, modes, the board and list pickers — are still there on a dev server, behind a **🛠 Practice** button in each game's toolbar (`usePlayMode` in `src/daily/useDailyRound.ts`).

**Which games are a daily** is `LIVE_DAILY` in `src/daily/types.ts`: Tenite only. Six games have a daily built (`DAILY_GAMES`); on 4 Oct 2026 the user moved Career Path, Who Are Ya? and Tic Tac Toe to unlimited "for now" and hid List, and on 5 Oct moved Fortnitedle to unlimited too. A built daily not in `LIVE_DAILY` keeps its code and its checks, but no puzzle is made for it, its page plays unlimited with the setup screens everywhere (no chip, no 🛠 toggle), and the home page lists it under **Unlimited** with Higher or Lower. To make one a daily again, add it to `LIVE_DAILY`; days the editor already made ahead have no puzzle for it, so draw them with **↻ New**.

| Piece | Where | What it does |
| --- | --- | --- |
| The day | `src/daily/day.ts` | A day is its date in `Europe/Berlin`, so the reset is midnight Central European time through summer time too. `DAILY_START` (5 Oct 2026) is puzzle #1; a day before it shows as "preview". `?day=YYYY-MM-DD` pretends it is another day, on a dev server only |
| The puzzles | `src/daily/generate.ts`, `src/games/<game>/daily.ts` | A day's set is one small descriptor per game: a secret player and the clues in order, a Tenite board id, a List id, Tic Tac Toe's six rule ids. Each game's `daily.ts` picks one (`pickDaily`) and rebuilds a round from one (`restoreDaily`) |
| Kept once made | `server/index.ts` `GET /api/daily/<day>`, table `daily_puzzles` | The first request for a day makes its set and the store keeps it; every later request reads the kept one. Never a day after today on the live site |
| Pinned on the day | `freezeDay` in `generate.ts`, `freezeDaily` in `tenaball/daily.ts` | Until 14 Oct 2026 a Tenite day kept only its board's id and rebuilt the board from whatever data was live, so a data update changed past days, and today's too. Now the first request on or after a day's date copies the whole board, rows and numbers, into its descriptor (`frozen`), with `asOf` — the export's date, or the day itself for a follower board — shown beside the title, "Top 10 by career earnings (as of 13 Oct 2026)" (the user: "career earnings (As of ...) Or something like that, so it's clear from what date it is"). Every other board shows the data's date the same way (`asOfFor` in `TenaballGame.tsx`), today's for a follower board; a board about one event shows none. Days made ahead stay unpinned until their date, so they play on their own day's data. Moving a pinned puzzle in the schedule editor unpins it (`unpinned`). Saved rounds are matched on `puzzleId`, the descriptor without `frozen` and `sig`, so pinning orphans nobody. The days served before 14 Oct (#1 to #10) are pinned on the data live when each is next asked for — the 13 Oct export, not the 5 Oct one most were played on |
| Your progress | `src/daily/progress.ts`, `useDailyRound.ts` | The round in progress is saved on every move (`daily:<game>`, earlier days in `daily-past:<game>`), so a reload carries on; every finished day goes in `daily-log:<game>`. Browser only — no accounts yet |
| The end | `src/components/DailyEnd.tsx` | Score, a Wordle-style emoji grid, **Share** (the phone's share sheet, or the clipboard), played / won / streak / best, and the countdown |

**Each game's daily:**

| Game | The daily is | Score and grid |
| --- | --- | --- |
| Fortnitedle | a well-known name; from guess 3, told the name has a digit, as in every round | `4/6`, Wordle's rows |
| Career Path | a well-known player, clues building up (Random) | `3/10`, one square per clue: 🟥 guessed wrong, ⬛ skipped, 🟩 named, ⬜ not needed |
| Who Are Ya | a well-known player, counts shown, weakest teammate first | the same as Career Path |
| Tenite | a board of a known kind (players, seasons, FNCS, places, teammates, events, orgs and countries, Div Cups all time, the Globals), six of its ten rows well known; 5 lives | `7/10`, the ten slots and the hearts left |
| List | a list of 10–60 with four famous names and 40% well known; wrong answers cost 3 seconds | `14/37`, ten blocks for the share found |
| Tic Tac Toe | a Medium grid; the last week's rules left out | `9/9`, the grid and the hearts left |

**Well known** (`src/daily/fame.ts`) is the Easy band plus the 250 best-earning players of the Medium band. The whole Medium band reaches into every region's own scene, which made "Top 10 duos of 2024 — Asia" a daily. The three secret players of a day are three different people, 60% from the Easy band, and none comes back while anyone unplayed is left (`SECRET_REST`).

**Boards and lists come back only when they change** (`src/daily/reuse.ts`). Each Tenite and List daily keeps a fingerprint of who its answers are (`sig`). Once a big event changes a board ("Top 10 by career earnings" after a World Cup) it is a new puzzle and may come back after 30 days (`CHANGED_REST`). The same top 10 may come back too, after 90 days (`SAME_REST`, 14 Oct 2026; the user: "even something doesn't change I would like to repeat it sometimes… like have world cup board again, because it's popular") — it used to wait for good. The schedule editor offers a board played over 90 days ago again ("over 90 days ago"). Neighbouring days are kept apart too: no kind of board or list twice within 2 days (`KIND_GAP`), and no family — one board split by region or year, like "average FNCS finish — NA East" and "— NA West" — within 7 (`FAMILY_GAP`). Boards that count only players Liquipedia lists as active are never a daily, since its retired status is rarely updated.

**A streak** is days in a row with that game's daily played, win or lose — a hard day does not break a month. Every streak is per game, on the home page too: each daily's card shows its own 🔥 (4 Oct 2026, the user: "if player played fortnitedle today, it will show on fortnitedle 1 day streak but not for other games"). A day caught up from the archive counts as played and in Won, but not towards a streak or best run (`late` in the log). **Streaks live in the browser, per address**: `www.offspawn.app` and `offspawn.app` each keep their own. The one-address redirect of 13 Oct 2026 therefore started anyone who had played on `www.` from 0 (the user's own streak included; they chose to leave it: "it happens and won't affect overall game"). Data updates and deploys never touch it. What would reset everyone again: changing the site's address, the `chillfn:` storage prefix (`src/lib/storage.ts`), or a game's id.

**Earlier puzzles** (the archive, 8 Oct 2026 — the user: "play previous days games, only if from this website nobody played before"). Every daily from #1 to yesterday can be played, **once per browser**:

- **Where.** `/game/<slug>?puzzle=N` (`usePuzzleDay` in `src/daily/useDay.ts`; anything outside #1 to yesterday is today's). Reached from **📅 Earlier** beside a daily game's title and the missed days under a finished puzzle (`src/components/PastPuzzles.tsx`) — inside the games only: the home page lost its button on 13 Oct 2026, and its strip reads "Today's puzzles" with no number, since each game may count its days from a different start. The page says which day it is — "📅 The puzzle from Tue 13 Oct · Today's puzzle →", nothing about the streak (14 Oct 2026, the user: "Just write puzzles from . Today's puzzle, no of this played late").
- **Once.** A finished day opens to its board and result, never a new round. A day begun and left carries on where it was. A day finished before its board was kept (anything played before 8 Oct 2026) shows the whole board, every answer and number, above "You have played puzzle #N already" and its score (`played` and `answers` in `useDailyRound`; the user, 14 Oct 2026: "have like a full description… even if it [is] the past game"). Which answers were found is not known, so every row is plain.
- **Kept.** `daily:<game>` holds the latest day's round; when a later day starts, the earlier one moves to `daily-past:<game>`, where archive rounds are saved too. The newest 60 finished ones are kept for their boards; unfinished ones always stay. Browser only, like the rest.
- **The server** already hands out any day up to today, so nothing changed there. The day's set is the one kept, so an archive puzzle is the one everybody had that day.
- **List** runs its own daily loop (not `useDailyRound`) and has no archive yet; give it one before List is a daily again.

**Analytics:** a daily round's setup is `{ daily: '<day>' }`, which the dashboard counts as its own source, Daily. An archive round carries its own day, so it is told apart by being recorded after that day.

**The schedule editor** (`/analytics/daily`, `src/daily/admin.ts`): the next 30 days (more on request) made ahead and kept, one game at a time. ↑ and ↓ swap a puzzle with the day before or after; **Choose** sets a board, a list or a secret player by hand (Tic Tac Toe has no list — its six rules are drawn together); **↻ New** draws another, clear of every other scheduled day. In Choose, a board or list already played with the same answers is greyed out with the day it ran; one on a coming day says so, and choosing it swaps the two days; one whose answers changed since says that and can be chosen. A secret player within 30 days, a board or list on another day with the same answers, or a secret player who is the answer in two games on one day, is flagged. Days before today cannot change; today can, after a warning, since people may have played it. A new day steers clear of the days after it too, so a schedule made ahead never repeats itself.

The home page lists Higher or Lower under **Unlimited** (it was "Any time").

## Followers

YouTube subscribers and Twitch followers, in ten games since 3 October 2026. Both platforms limit how long their numbers may be kept — YouTube 30 days, Twitch 24 hours (checked 3 Oct 2026) — so the counts are **never in git**:

- `scripts/build_data.py` writes `links.json`: each player's YouTube and Twitch links, from Liquipedia. That is committed.
- The live server fetches the counts itself about every 20 hours (`server/socials.ts`), keeps only the newest set in Postgres, and serves only fresh ones at `GET /api/socials`. A platform whose counts got too old drops out, and every category built on it disappears until the next fetch. Keys and the one-time Twitch login: UPDATE_DATA.md; status at `/analytics/socials`.
- A dev server reads your local `socials.json` (from `scripts/socials_api.py`) and fetches nothing unless `SOCIALS_FETCH=1`. `check:games` uses the same file and skips the follower checks without it, as CI does.
- Pages that show the counts say where they come from (`SocialsNote` in the rules; `/credits`), and `/privacy` carries what YouTube's API terms ask for: that the site uses YouTube API Services, YouTube's Terms of Service and Google's Privacy Policy. Counts are shown as the platforms give them and never added together — YouTube's terms rule out new metrics made from theirs.

| Game | What uses them |
| --- | --- |
| Higher or Lower | Twitch Followers and YouTube Subscribers categories; the fame window ranks by the count itself, so a run opens on the big channels |
| Tenite | "Followers" boards per platform: everyone, each region, FNCS champions, under 20. Built in the browser; a level count goes to the bigger career earner. The daily may be the world, Europe, North America or the champions board |
| List | Everyone over 1M / 2M / 5M, and each region over the highest line that makes a round |
| Tic Tac Toe, Connections, Griefer, Bingo | rules "100K+ / 1M+ Twitch / YouTube"; Griefer's near misses are a quarter of the line or more |
| Guess the Player | a Twitch column with arrows |
| Pyramid | Twitch followers and YouTube subscribers, drawn from the biggest channels (60 on Easy, 200 on Medium) |
| IRL | a "Channels" line late in the file |

A daily puzzle can use them (Tic Tac Toe's rules, a follower board or list): the server makes the day with the counts it is serving, and the browser rebuilds it from the same server's counts. A refresh during the day can move a follower board by a place.

## Limited mode

Limited mode is planned, not built. It is a fortnight around one event when the site runs only that event, with one puzzle per game per day. For the FNCS 2026 Globals (26–27 September) it would run 16 September to 3 October: 18 days, 18 categories per game. The full plan is in `LIMITED_MODE.md`.

| Game | Daily plan | Works today in event mode |
| --- | --- | --- |
| Tenite | categories 1–10 before the event, appearances on day one, results boards from 27 Sep | the 11 pre-event boards |
| List | the same shape: field lists first, results lists after | 12 of 18 lists |
| Fortnitedle, Career Path, Who Are Ya, Guess the Player | one secret player a day each, nobody twice across all four (72 of 101); days 1–12 by region, 13–18 the event's stories | regions in turn |
| Higher or Lower | a 20-player run a day, rotating Age, FNCS Wins, FNCS Finals, Earnings; each category splits the field into its own five pools | region lean, difficulty rising |
| Tic Tac Toe, Connections, Griefer | random boards from the field | yes |

**Building it needs four things:**

1. A daily schedule, seeded by the date so everyone gets the same puzzle.
2. Switching on and off by date, with the mode picker hidden.
3. The event's results in the export, refreshed each evening through the event: placements by day, points, and the duos (List 11 needs them before the event).
4. Sources the export does not have: creator subscribers, eliminations and damage, and who qualified from where.

Decided so far:

- **Regions:** six, with North America as one.
- **Nationality:** Scotland stays Scotland.
- **Subscribers:** YouTube subscribers and Twitch followers are in the games since 3 Oct 2026 — see "Followers".
- **Small regions:** in the one-player games, each small-region player is used once across the four games.

## Open decisions and what to do next

My recommendation: commit this week's work and get the site live before the Globals weekend, so real rounds start arriving. Build limited mode for the next event, with this Globals as its test data. The daily mode cannot be built and tested by 26 September.

| # | Next step | Why | Size |
| --- | --- | --- | --- |
| 1 | Commit and push the work of 27 Sep: Higher or Lower Placement, the new List and Tic Tac Toe categories, the data pipeline and the webhook | none of it is in git yet | small |
| 2 | Deploy to Heroku: check a clean clone builds, then create the app, Postgres and `ADMIN_PASSWORD` | the dashboard only learns from real players | small |
| 3 | Event results by day: placements by day, points and duos into `pools.json` (final placements are already there, cell 5 of `scripts/pipeline/derived.py`), updated each evening of an event | unlocks Tenite 13–19 and List 11 and 15 | medium |
| 4 | The daily mode: one puzzle per game per day, seeded by date, switched on and off by date | the core of limited mode | large |
| 5 | Limited-mode dealing: no player twice across the four secret games; five balanced pools per Higher or Lower category | what the plan promises per day | medium |

### Decisions only you can make

- **The Middle East in Higher or Lower pools.** Four players cannot fill five pools. Either one pool per category goes without, or one of them appears twice in a category.
- **Thin Connections pools.** Most single-region pools and South America Easy/Medium cannot build a board. Accept that, or add rule kinds that work inside one region.
- **Data with no source yet:** eliminations and damage, and who qualified from where. Each unlocks limited-mode categories if a source is found. (X followers need a paid API; Instagram and TikTok have none for this.)
- **Accounts.** Not started. The records are shaped so a user id can be attached later.
