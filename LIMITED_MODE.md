# Limited mode — the plan

**Status: planned, not built.** What the site has today is the **event mode**:
a lens picked on the home page that points every game at one tournament's
field. Limited mode is the next step. It's written down here so the plan
survives until it gets built. Each item is marked:

- **live**: works in event mode today
- **results**: needs the event's own results in the export
- **data**: needs something the export has no source for yet

## What it is

- A limited mode runs for **about two weeks around one event**. It opens
  10–12 days before the first day, for the build-up, and closes a few days
  after the last, so there is time for boards about placements and regions.
- **While it runs, it is the only mode.** No picker, no whole-scene option:
  every game is about that event. The event-mode picker exists only because
  we are testing; the end state has only the limited mode.
- **Games are daily.** One puzzle per game per day.
- **It can be run again later.** A World Cup limited mode over Christmas
  week, say.

### FNCS 2026 Globals

| | |
| --- | --- |
| Event | 26–27 September 2026, two days, duos, 101 qualified players on record |
| Limited mode | 16 September – 3 October 2026: **18 days** |
| Day one of the event | 26 September: the appearances board |
| Results from | 27 September for day one, 28 September for the whole event |

The plans below had 19 categories each. The subscribers one goes (Tenite 11
and List 9), because nothing has that data, which leaves **18 per game, one
per day**. It comes back once there is a source.

### Decided

- **Six regions.** North America Central and West are one region, as the
  export has them.
- **Nationality is the first one listed.** A player who lists Scotland first
  is Scottish, not British. The same goes for England and Wales.
- **Higher or Lower has four categories:** Age, FNCS Wins, FNCS Finals (added
  for this) and Career Earnings. A fifth, **Placement** (who finished better
  at the event), is built and opens once the results are in.

## The fortnight, day by day

Tenite and List numbers are the categories in the tables further down.

| Day | Date | Tenite | List |
| --- | --- | --- | --- |
| 1 | Wed 16 Sep | 1 career earnings | 1 European qualifiers |
| 2 | Thu 17 Sep | 2 youngest | 2 FNCS winners this year |
| 3 | Fri 18 Sep | 3 lowest earners | 3 North American qualifiers |
| 4 | Sat 19 Sep | 4 FNCS wins | 4 organisations |
| 5 | Sun 20 Sep | 5 Europe by earnings | 5 Brazilian qualifiers |
| 6 | Mon 21 Sep | 6 countries by players | 6 nations |
| 7 | Tue 22 Sep | 7 earnings this year | 7 Middle East qualifiers |
| 8 | Wed 23 Sep | 8 oldest | 8 FNCS winners ever |
| 9 | Thu 24 Sep | 9 organisations by players | 10 Asia and Oceania |
| 10 | Fri 25 Sep | 10 North America by earnings | 11 duos split across nations |
| 11 | **Sat 26 Sep, day one** | 12 LAN and FNCS appearances | 12 also played the last LAN |
| 12 | **Sun 27 Sep, day two** | 13 top 10 of day one | 13 qualified from … |
| 13 | Mon 28 Sep | 14 top 10 overall | 14 qualified from … 2.0 |
| 14 | Tue 29 Sep | 15 biggest improvements | 15 X points |
| 15 | Wed 30 Sep | 16 eliminations | 16 X eliminations |
| 16 | Thu 1 Oct | 17 biggest upsets | 17 X earnings this year |
| 17 | Fri 2 Oct | 18 damage | 18 won a game |
| 18 | Sat 3 Oct | 19 biggest disappointments | 19 X career earnings |

Days 12 onwards need the export refreshed with results the evening before.
Day 12 needs day one's results by the night of the 26th.

## Tenite: qualified players only

In event mode today these are the field's boards, under one heading, in this
order (`games/tenaball/pool-boards.ts`). Two more follow them: tournaments
played, and countries by career earnings.

| # | Category | Status |
| --- | --- | --- |
| 1 | Top 10 by career earnings | live |
| 2 | Top 10 youngest | live |
| 3 | Top 10 lowest career earners | live |
| 4 | Top 10 by FNCS wins | live |
| 5 | Top 10 European players by earnings | live |
| 6 | Top 10 countries by players | live |
| 7 | Top 10 by earnings this year | live |
| 8 | Top 10 oldest | live |
| 9 | Top 10 organisations by players | live |
| 10 | Top 10 North American players by earnings | live |
| 11 | Top 10 by subscribers on … | dropped until there is **data** |
| 12 | LAN appearances for a LAN, FNCS grand finals for an FNCS event, **on the first day of the event** | live: both, for a Globals |
| 13 | Top 10 of day one | results |
| 14 | Two days: top 10 overall. Three days: top 10 of day two | live: the final top 10 |
| 15 | Three days: top 10 overall. Two days: top 10 biggest improvements, places gained from day one to day two | results, by day |
| 16 | Top 10 by eliminations (individual) | data |
| 17 | Top 10 biggest upsets: low earnings before, placed high | live: places gained from the earnings seed |
| 18 | Top 10 by damage | data |
| 19 | Top 10 biggest disappointments: big earnings, bad placement (the opposite of 17) | live: places lost from the earnings seed |

A regions board after the event ("which region placed best") would fit
alongside 13–19.

## List: qualified players only

In event mode today these are the field's lists, in this order
(`buildPoolCriteria` in `games/list/criteria.ts`). The rest follow them:
everyone who qualified, the well-represented countries, LAN winners, never won
an FNCS, and retired.

| # | List | Status |
| --- | --- | --- |
| 1 | All European qualifiers | live |
| 2 | Everyone who won an FNCS this year | live |
| 3 | All North American qualifiers, NA West included | live |
| 4 | Every organisation represented | live: current organisations |
| 5 | All Brazilian qualifiers | live: South America, the FNCS's Brazil region |
| 6 | Every nation represented | live: first nationality |
| 7 | All Middle East qualifiers | live |
| 8 | Everyone who has won an FNCS | live |
| 9 | Everyone with X subscribers on … | dropped until there is **data** |
| 10 | All Asia and Oceania qualifiers | live |
| 11 | Every player in a team split across nations (a German and a Pole in one duo: name both) | data: needs the duos before 25 Sep. The export pairs them only in the results |
| 12 | Everyone who also played the last LAN (for the 2026 Globals, the Summit) | live: the last three LANs |
| 12b | Everyone playing their first LAN: none of the LANs before this one (for the 2026 Globals, 22 of 101) | live, added 27 Sep; not on the day plan |
| 13 | Everyone who qualified from … (this year, the Summit) | data: the qualification path is not in the export |
| 14 | The same for another route, or, for a three-day event, day one or day two | data |
| 15 | Everyone who scored X points at this event | results |
| 16 | Everyone with X eliminations at this event | data |
| 17 | Everyone with X earnings this year | live: $50K+ and $100K+ |
| 18 | Everyone who won a game at this event | data |
| 19 | Everyone with X career earnings | live: $500K+ and $1M+ |

## Who Are Ya, Career Path, Fortnitedle, Guess the Player

**One secret player a day in each, and nobody twice across all four.** That is
4 × 18 = 72 players over the fortnight, out of 101 in the field.

- **Days 1–12: the regions.** Two days per region per game.
- **Days 13–18, after the event: the stories:**
  - the biggest breakouts: lowest earnings before the event, placed great
  - one half of a duo
  - maybe the winner

Two per region per game needs **eight players from every region** across the
four games, and the small regions do not have that many:

| Region | In the field | Fortnitedle | Career Path | Guess the Player | Who Are Ya |
| --- | --- | --- | --- | --- | --- |
| Europe | 46 | 46 | 30 | 43 | 34 |
| North America | 33 | 33 | 29 | 31 | 30 |
| Oceania | 6 | 6 | 5 | 3 | 6 |
| South America | 6 | 6 | 6 | 5 | 6 |
| Asia | 6 | 6 | 5 | 4 | 6 |
| Middle East | 4 | 4 | 4 | 4 | 4 |

The per-game columns count who can be the answer at all. Career Path needs
five majors on record, Guess the Player a birthday and earnings, and Who Are
Ya three teammates and five tournaments.

**Proposal:**

- **Every small-region player gets used once.** The Middle East is one per
  game. Oceania, South America and Asia are two in two games and one in the
  other two.
- **Europe and North America fill the rest** of the twelve region days.
- **Stories come from anywhere.** Days 13–18 draw from whoever is left, still
  never repeating across games.
- **The totals work:** the small regions give 22, and Europe and North America
  give 50 of their 79.

Today, in event mode, these four games deal the field's regions in turn
(`dealInTurn` in `games/shared/rotation.ts`). Every region comes up every
few rounds. There is no cross-game rule yet, because there is no daily
schedule for it to belong to.

## Higher or Lower

**A daily run of about 20 players, with the category rotating:**

- day 1 Age
- day 2 FNCS Wins
- day 3 FNCS Finals
- day 4 Career Earnings
- then round again

Over 18 days that is five runs each of Age and FNCS Wins, and four each of
FNCS Finals and Earnings.

**Each category splits the field into its own five pools of about 20:**

| Category | Players eligible | Per pool |
| --- | --- | --- |
| Age | 90 (a birthday on record) | 18 |
| FNCS Wins | 101 | 20 |
| FNCS Finals | 101 | 20 |
| Career Earnings | 101 | 20 |

- **Once per category, four times overall.** A player is in one pool per
  category, so they turn up at most once in a category and at most four times
  in the fortnight.
- **The splits differ between categories.** Who you face on FNCS day is not
  who you faced on earnings day.
- **A category with four runs** leaves one of its pools unplayed.

**Every pool is balanced:**

- **Every region is in it.** The Middle East has four players, so for five
  pools one pool per category goes without. The alternative is one Middle
  East player appearing twice in a category.
- **Difficulty rises through the run.** Pools are dealt from the field in
  fame order, so each gets its share of names and deep cuts. Within a run the
  most familiar come first, so the 20th is the hardest.

**Placement** is built: in event mode it is a fifth card, greyed out until
cell 5 has written the event's results, then "did X place higher or lower
than Y?". It could join the rotation from day 13.

Today, in event mode, the endless run leans towards the region it has shown
least: 4.8 regions in the first 12 rounds against 3.2 without. Difficulty
already rises through the fame window. What is missing is the fixed daily run
and its pools.

## Tic Tac Toe, Connections, Griefer

Random boards from the qualified players, which is what event mode does now.
To be revisited.

## What building it needs

1. **A daily schedule.** One puzzle per game per day, the same for everyone:
   seeded by the date, with the rotations and the no-repeat rules above.
2. **Switching by date.** On at the start of the window, off at the end, and
   the mode picker hidden while it runs.
3. **The event's results in the export, refreshed daily through the event:**
   - placements by day
   - points
   - the duos, which List 11 needs before the event
   
   The pools step (cell 5 in `scripts/pipeline/derived.py`) carries each player's final placement into
   `pools.json` already (Higher or Lower's Placement reads it); points,
   placements by day and the duos would follow the same way. Today the Globals
   rows are one player each, unpaired, with no placement.
4. **Sources the export does not have:**
   - creator subscribers
   - eliminations and damage
   - who qualified from where
