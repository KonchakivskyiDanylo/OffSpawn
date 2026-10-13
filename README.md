# OffSpawn — competitive Fortnite puzzles

Browser puzzle games built around competitive Fortnite players — ten built,
seven on the site. No accounts and no monetisation: the games run in the browser
on data from Liquipedia, and a small Node server (`server/index.ts`)
serves the site and records anonymous round stats and support requests.

Player data comes from [Liquipedia](https://liquipedia.net/fortnite) and is
reused and modified under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/us/),
FNCS title counts included. The derived data files are
shared under the same licence — see [CREDITS.md](CREDITS.md).

```bash
npm install
npm run dev:all      # the site on http://localhost:5173 and its API on :3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run dev:all` | The site and the API together in one terminal, output tagged `site` / `api`, Ctrl+C stops both. The API runs with `ADMIN_OPEN=1`, so `/analytics` opens without a password, and the site with `VITE_RECORD=1`, so rounds you play land on it (in `server/.data`, this machine only) |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm run check:games` | Drives all ten games through a full round headlessly. Career Path and Who Are Ya report SKIPPED until their generated files exist |
| `npm run api` | The server (`server/`), for the analytics and support endpoints. Run beside `npm run dev`; `/api` is proxied to it |
| `npm start` | The production server: `dist/` plus the API. What Heroku runs |
| `npm run check:server` | Starts the server on a spare port with a throwaway store and checks every endpoint |

Every game reads the Liquipedia
export, and `scripts/build_data.py` builds every data file from the raw
dump (see DATA.md, "Keeping the dump current").

**Where the data comes from and how to extend it: see [DATA.md](DATA.md).
To bring it up to date: [UPDATE_DATA.md](UPDATE_DATA.md).**

**Every game's algorithm, the server, the tests and what to decide next, in one place: see [PROJECT_GUIDE.md](PROJECT_GUIDE.md).**

## The games

| Game | Modes | Notes |
| --- | --- | --- |
| Higher or Lower | Age / Career earnings / FNCS wins (+ Placement in event mode; FNCS finals and follower counts hidden) × Easy / Medium / Hard | Endless, one mistake ends the run, best score in `localStorage`. Round one is two of the top 20 earners; each round widens that window (to 250 / 1,000 / everyone) and narrows the gap on a four-rounds-a-step schedule. The answer is drawn before the player, so it cannot be read off the last one. Only FNCS Wins deals ties and has the Equal button, on every level; Age is Older / Younger by birth date |
| Fortnitedle | — | 6 guesses, digits are playable characters. From guess 3 every round says the name has a digit — never which one, how many or where |
| Career Path | Order / Random | 10 clues, picked for a mix of finishes on recognisable stages, spread across the career, never opening on a famous player's signature result, and describing exactly one player wherever the career allows it (a duo partner is ruled out). Order reads them by date, Random in no order |
| Who Are Ya? | Counts shown / hidden / Random order | Ten clues drawn across up to fifty teammates, number one always among them, revealed fewest-shared first. Needs 3+ teammates and 5+ tournaments on record |
| Tenite | ~290 categories × Easy / Hard | Boards answer in players, organisations, countries *or* tournaments. Each states its own tie rule. A tournament board is ten placements, so a duos slot wants both names |
| List | Easy / Hard | ~180 categories. 90s, +5s per correct answer, −3s per miss on Hard. Naming everyone ends the round as a win |
| Griefer | All at once / One by one | Ten cards, four to six of which **fit** the rule, and the board never says how many. Cards show the handle only |
| Tic Tac Toe | Easy / Medium / Hard | Type any player; the grid only offers cells that keep the board solvable, and places them itself when there is one. Easy boards have 3+ household names per cell, Medium 2+ regulars; Hard may have one answer. Lives shown as hearts: 3, 3 and 1 |
| Connections | — | 16 players, 4 groups that each land on exactly their own four, 4 lives shown as hearts. No birth-year groups |
| Guess the Player | Exact / Direction | 8 attributes — including FNCS finals played and "played together" (10+ events as teammates) — green or red, 8 guesses |

Six of the ten share a **setup step** (`components/PoolSetup`), and it opens
closed: Random, or Choose to narrow by region, difficulty and active/retired.
Higher or Lower and Tic Tac Toe have a single Easy / Medium / Hard instead
(`LevelSetup`), which sets both who they ask about and how hard they ask.
Tenite and List pick a category instead, because that is their whole subject.

Above all of them sits the **event mode** (`games/shared/mode.ts`), chosen on
the home page and shown in the header. Pick a tournament and every game draws
only from that field until you leave it — the eight setup screens collapse to a
Start button, and Tenite and List swap their categories for field-scoped ones
derived in the browser, under one heading and in a planned order. A field is
lopsided (46 of the 2026 Globals' 101 are European), so the four secret-player
games take its regions in turn and Higher or Lower leans towards the region a
run has shown least.

The event mode is the testing ground for a **limited mode**: a fortnight
around one event, daily puzzles, and nothing else on the site. The plan —
dates, the day-by-day Tenite and List categories, the daily schedule per game
and what each needs from the data — is in [LIMITED_MODE.md](LIMITED_MODE.md).

Every game's "How to play" ends with **What the words mean**
(`games/shared/glossary.ts`): what a tournament, a major, a LAN, a Global
Championship, an FNCS win and a nationality mean here, with the events each
covers listed from `facts.json`. A Tenite board or a List prompt shows the
same definitions for the words in its own title under "What counts here".
Where a game can tie, its rules say how.

Fortnitedle, Career Path, Who Are Ya and Guess the Player deal their secret
player from a **no-repeat rotation** (`games/shared/rotation.ts`): the pool
empties before anyone comes round again, and the new cycle never opens with
whoever closed the last one. The cycle is keyed by everything that changes who
is in the bag (`poolScope`) and lives in `localStorage`, so it survives a
reload. On Random each fame tier is its own bag and the draw picks the tier
first — half Easy, a third Medium, the rest Hard (`RANDOM_MIX` in
`games/shared/pool.ts`) — because an even draw over everyone eligible was 70–80%
Hard-tier players nobody had heard of. (Higher or Lower already never repeats
inside a run; the rest deal a whole board rather than one player.)

Every game has a **Give up** button next to its guess controls while a round is
running — not in the title bar, where it sat beside "New game" and was too easy
to hit by accident. It is two-step: the first click arms it, the second reveals
the answer. Each engine exposes a pure `giveUp(state)` that ends the round and
is a no-op once it has.

A game's folder name is its original name, not its current one: Fortnitedle
lives in `games/wordle/`, Griefer in `games/impostor/`. `GameMeta.id` is
likewise unchanged, because local best scores hang off it — a rename touches
`title` and `slug` only. (Piece Control has been renamed back to Tic Tac Toe,
which is both its folder and its id.)

Easy / Medium / Hard means three different things across that table. In the
shared setup step it is the **fame ranking** below — how well known the players
you are asked about are, expressed on each card as the career-earnings band it
covers. Inside Tenite and List it is that game's own mechanical setting
(lives, time penalties) and has nothing to do with fame. In Higher or Lower and
Tic Tac Toe it is both at once and the only setting those games have: who the
game is built around, and how hard it presses.
Who Are Ya calls its clue orders Counts shown / Counts hidden / Random order
for the same reason: it has a fame difficulty above them, and two Easys on one
screen meant two different things.

### One data source

All ten games read the **Liquipedia export** in
`liquipedia_data/clean_data/fortnite/`, in place, with no build step.

| file | rows | read by |
| --- | --- | --- |
| `players.json` | 5,678 playable | every game — identity, earnings, tier, FNCS wins |
| `career_path.json` | 187 majors; every player with one (1,175 with five or more) | Career Path |
| `teammates.json` | 39,038 pairs, 5,490 players, 50 kept each | Who Are Ya, List |
| `orgs.json` | 984 orgs | Griefer, Tic Tac Toe, Connections, Tenite, Org Chart |
| `bios.json` | real names and dated organisation stints | IRL, Org Chart, Transfer Window, Rewind (hidden games) |
| `facts.json` | per-player career facts | Griefer, Tic Tac Toe, Connections, List, Who Are Ya |
| `rankings.json` | ~290 precomputed leaderboards, plus the event names the paydays boards are answered from | Tenite |
| `pools.json` | event-qualified fields | every game's setup step |

All of them are **built by `scripts/build_data.py`** from the raw dump. A file that has not been generated is simply absent:
`src/data/liquipedia/files.ts` reads the folder with `import.meta.glob`, so a
missing file is a value to branch on rather than a build error, and
`npm run check:games` reports the affected games as SKIPPED and stays green.

None of the derived files carries a `tier` column: difficulty is joined from
`players.json` by page name, so re-tiering the roster re-tiers every game and
the derived files cannot go stale against it.

**There is no build step.** The app imports that file in place, through the
`@data` alias. Two columns in it are maintained by the notebook that owns the
data rather than by any code here:

| column | values | meaning |
| --- | --- | --- |
| `tier` | `easy` / `medium` / `hard` / `unused` | difficulty band; `unused` rows never reach a game |
| `region_tier` | same, optional | difficulty band *within* `region` |
| `fncs_wins` | integer ≥ 0 | FNCS grand finals won |

`region_tier` exists because the global band cannot serve Fortnitedle's region
picker: `tier` ranks all 5,678 rows together, so Asia, Oceania and the Middle
East have no Easy players between them and "Asia + Easy" would quietly hand
back Medium. Ranked inside the region every region has all three. It is
optional — a roster exported before the column existed falls back to `tier` —
and a difficulty with nobody in it is greyed out with its count showing rather
than silently widened.

`tier` is **opaque to the app**: nothing recomputes it, nothing second-guesses
it, and there is no fallback ranking. Re-tier the roster by editing that column
and reloading — no code changes, nothing to regenerate.

### The fame ranking

There is no separate fame file: difficulty is the `tier` / `region_tier`
columns above, written by `scripts/build_data.py` into `players.json`.

Games do not read the JSON. They ask for a pool:

```ts
dataset.playersFor('hard', { minimum: 2, eligible: (players) => eligible(players, 'age') })
```

`eligible` is the game's own filter, applied per tier, because whether a tier is
big enough is a question about the players a game can actually use — roughly
half the roster has too little recorded history to be a fair answer. If a tier
still comes up short, the next-closest tier is folded in rather than failing.

## Architecture

Game logic is separated from UI throughout: each game has a pure `engine.ts`
(no React, no DOM) plus a component that renders it. That is what lets
`npm run check:games` play every game to completion in Node.

```
src/
  data/liquipedia/
    roster.ts         Reads .../players.json in place, via the @data alias
    facts.ts          Career facts players.json cannot answer
    majors.ts         Reads .../career_path.json — Career Path's tournaments
    teammates.ts      Reads .../teammates.json — who has played with whom
    rankings.ts       The precomputed Tenite boards
    pools.ts          Event-qualified fields — the event mode reads these
    orgs.ts           Organisations and who has played for them
    countries.ts      Liquipedia nationality names -> ISO country codes
    files.ts          The one place that knows how to read the export
    useLoaded.ts      The load-on-mount hook they all share
  games/<game>/engine.ts + <Game>.tsx
  games/shared/criteria.ts   Player predicates shared by Griefer / Tic Tac Toe / Connections
  games/shared/difficulty.ts Fame tier labels, shared by the pooled games
  games/shared/pool.ts       Region / difficulty / status, and Random vs Choose
  games/shared/mode.ts       The site-wide event mode
  games/shared/rotation.ts   Deals a pool out once before anyone repeats
  games/tenaball/board-builder.ts  Assembling a board from ranked rows
  games/tenaball/pool-boards.ts    Field boards, derived in the browser
  games/tenaball/derived-boards.ts All-time boards the notebook does not ship
  components/EventMode.tsx   The mode picker (home) and mode chip (header)
  components/SideNav.tsx     The games list down the left of every page
  components/Footer.tsx      Site footer — carries the Liquipedia attribution
  pages/Credits.tsx          Long-form attribution, as CC-BY-SA asks for
  components/, lib/, styles/
```

### Replacing the data source

Games never import a data module. They receive a `Dataset` built from
whatever `PlayerRepository` returns:

```ts
class ApiPlayerRepository implements PlayerRepository {
  async getPlayers(): Promise<Player[]> { /* fetch Liquipedia / Tracker / your API */ }
  async getEvents(): Promise<TournamentEvent[]> { /* ... */ }
}
setRepository(new ApiPlayerRepository());
```

That is the whole migration path — no game code changes. Player headshots are
already modelled (`Player.photoUrl`); neither source publishes them, so the UI
falls back to a deterministic initials avatar.

## About the data

5,678 players, 14,645 tournaments and 442,736 placements, imported from
Liquipedia — FNCS title counts included, counted from its results. Nothing is
estimated: where a source is silent the field stays empty — a missing earnings
figure renders as a dash, never a zero — and a player with no published
birthday is left out of the questions that need one rather than guessed at.

Everything derived from it is derived in one place, the notebook, and read in
place by the app. `npm run check:games` plays all ten games to completion in
Node and asserts the invariants each one depends on. Details are in
[DATA.md](DATA.md).

## Edge cases

Generated puzzles are validated before they are shown, and the games degrade
gracefully rather than dead-ending:

- Tic Tac Toe boards are only offered if all nine cells can be filled with nine
  *different* players; during play a player is only ever offered cells that
  keep that true, so a move can never soft-lock the board.
- Connections deals every group from players who fit none of the other three,
  so each connection lands on exactly its own four — never a fifth Pole beside
  the Poland group — and the split is unique by construction (`check:games`
  still proves it). It also rejects a board where a connection that is *not*
  in play lands on exactly four players across different groups, which is the
  "four French names that are not a group" trap. On Random each group is two
  household names, a regular and one more, by the same mix Random uses
  everywhere, so the exclusive draw does not turn into a board of deep cuts.
- Higher or Lower picks the answer before the player: an even draw between
  Higher and Lower (Equal one round in five on Hard), leaning back toward the
  middle only when a side is down to its last few players. Letting the answer
  fall out of a random draw leaked it — Hard's FNCS Wins settled into
  1-0-1-0-1-0 and nine answers in ten could be called without knowing anyone.
  On Hard a player on nought can be level with another; on Easy and Medium,
  with no Equal button, a shown nought is still a free Higher.
- Tenite's tournament boards rank *placements*, so a duos or trios event puts
  the whole team in one slot and only fills it once every name is in. It skips
  an event where two teams share a place in the top eleven, where a player is
  listed twice in it, or where a finisher cannot be named from the roster.
- Higher or Lower never repeats a player and ends with a win when the pool runs
  out; List and Tenite resolve typed names tolerantly (case, spaces, accents,
  one typo when unambiguous).
- Tenite counts the 11th as wrong, level with 10th or not: it costs a life, and
  the game only says it was 11th (13 Oct 2026). The tie rule in force is printed
  above the ten slots, because it differs per category.

## Analytics and support

The site records one thing: how each round went, when it ends. One record per
finished round (`src/analytics/types.ts` has the exact shape), sent to the
site's own server — no third-party script, no cookie for players, no device
id, and the server does not store IP addresses. Totals are global. Rounds are
only sent from a production build, so local play does not pollute the numbers.

The 💬 button in the header opens a support form (wrong data, bug, new
category, suggestion) that can attach the round just played. Uncaught browser
errors are reported the same way.

Everything lands on **`/analytics`**, a password-protected page linked from
nowhere: rounds per game and per day, how each game was set up, and per game
the numbers that matter for tuning it — which clue solved a Career Path, which
Tenite answers nobody finds, which Griefer cards get misread, which Tic Tac
Toe cells stay empty. It is computed from the stored rounds on every load
(`src/analytics/aggregate.ts`), so it is always live.

The server (`server/index.ts`) has no framework and one dependency, `pg`. It
stores to Postgres when `DATABASE_URL` is set and to `server/.data/` otherwise.

| env | meaning |
| --- | --- |
| `DATABASE_URL` | Postgres. Heroku sets it when the add-on is attached |
| `ADMIN_PASSWORD` | the `/analytics` password. Without it the admin routes are off |
| `SESSION_SECRET` | optional, signs the login cookie (defaults to the password) |
| `ADMIN_OPEN=1` | local only: the dashboard with no password. Ignored when `NODE_ENV=production` |
| `LIQUIPEDIA_WEBHOOK_SECRET` | the last part of the LiquipediaDB webhook URL, `/api/liquipedia/<secret>`. Without it the route is off |

### Deploying to Heroku

```bash
heroku create offspawn
heroku addons:create heroku-postgresql:essential-0
heroku config:set ADMIN_PASSWORD=choose-a-long-one
git push heroku main
```

Heroku installs, runs `npm run build`, and starts `npm start` (see `Procfile`).
The generated data files have to be committed for the build to see them — the
`.gitignore` lists exactly which.

## Branding

The crown logo is loaded from `public/logo.png` — drop any crop of it there and
it appears in the header and as the favicon. Until the file exists the header
falls back to a plain `OS` mark rather than a broken image.

The games list runs down the left of every page (`SideNav.tsx`). The header's
☰ collapses it: to an icon rail on a wide screen, and under 900px to a drawer
over the page with a backdrop. The wide-screen state is remembered; the drawer
always opens closed, so nobody lands on a covered page.

Social links live in `SOCIALS` at the top of `src/components/Footer.tsx`. An
entry with an empty `href` is skipped, so fill in the ones you have and the rest
stay hidden. There are no Terms or Privacy pages yet; add them as routes in
`App.tsx` and link them from the footer's `site-footer__links` nav.

## Not in V1

No leaderboards, no accounts, no daily puzzles, no monetisation. Best scores are
per-device via `localStorage`.
