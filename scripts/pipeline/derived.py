"""
The files the games read that are derived from the clean ones: rankings.json,
pools.json, teammates.json, career_path.json and facts.json.

These were the cells of notebook_cells.md - 1 to 7, then the facts.json
appendix - copied in verbatim and run top to bottom in one function, so every
cell sees what the ones before it defined, exactly as in one notebook kernel.
This file is where a derivation changes now. notebook_cells.md, with the longer
write-up of each cell, was deleted on 27 Sep 2026; git history has it.

The only edit to the cells: cell 1 no longer sets BASE, which is the folder
passed in.
"""


def build(BASE):
    # ======================================================================
    # Cell 1 — shared setup
    # ======================================================================
    print()
    print('Cell 1 — shared setup')
    import json, re, itertools, os
    from collections import Counter, defaultdict
    from datetime import date
    import pandas as pd

    TODAY = date.today().isoformat()

    players_rows = json.load(open(f'{BASE}/players.json', encoding='utf-8'))
    tournaments  = json.load(open(f'{BASE}/tournaments.json', encoding='utf-8'))
    placements   = json.load(open(f'{BASE}/placements.json', encoding='utf-8'))
    orgs_payload = json.load(open(f'{BASE}/orgs.json', encoding='utf-8'))

    # ------------------------------------------------------------------ resolve --
    # Identical to the helper in the career_path and teammates cells: a placement's
    # participant name -> a *playable* players.json pagename, or None.
    by_page = {p['pagename'].replace('_', ' '): p['pagename'] for p in players_rows}
    by_id = {}
    for p in players_rows:
        by_id.setdefault(p['id'], p['pagename'])
    tier = {p['pagename']: p['tier'] for p in players_rows}
    player_of = {p['pagename']: p for p in players_rows}

    def resolve(name):
        page = by_page.get(name) or by_id.get(name)
        return page if page and tier.get(page) != 'unused' else None

    PLAYABLE = [p for p in players_rows if p['tier'] != 'unused']
    print(f'{len(PLAYABLE):,} playable players, {len(placements):,} placement rows')

    # -------------------------------------------------------------- classifiers --
    def is_epic(t):
        return any('epic games' in str(o).lower() for o in (t.get('organizers') or []))

    EXCLUDE_LAN_PATTERN = re.compile(r"console|mobile|twitch|challenge", re.IGNORECASE)


    def has_epic_games(val):
        if isinstance(val, list):
            return any(
                "epic games" in str(item).lower()
                or (
                    isinstance(item, dict)
                    and "epic games" in str(item.values()).lower()
                )
                for item in val
            )
        elif isinstance(val, str):
            return "epic games" in val.lower()
        return False


    def is_lan(t):
        """A LAN worth asking about:

        Offline, Tier 1, no tier type (main event), organized by Epic Games,
        post-World Cup (>= 2019-07-26), excluding console/mobile/twitch/challenge.
        """
        # 1. Offline & Tier 1 without tiertype (e.g. not qualifiers/showmatches)
        if t.get("type") != "Offline":
            return False
        if t.get("liquipediatier") != 1:
            return False
        if pd.notna(t.get("liquipediatiertype")):
            return False

        # 2. Start date check (>= 2019-07-26)
        start_date = pd.to_datetime(t.get("startdate"), errors="coerce")
        if pd.isna(start_date) or start_date < pd.Timestamp("2019-07-26"):
            return False

        # 3. Epic Games organizer check
        if not has_epic_games(t.get("organizers")):
            return False

        # 4. Name exclusion check
        name = str(t.get("name") or "")
        if EXCLUDE_LAN_PATTERN.search(name):
            return False

        return True

    def is_major(t):
        """Your career_path filter, verbatim — challenge events included in the
        exclusion now, as they always were in career_path's own copy. That drops
        one event, MrBeast's Extreme Survival Challenge: 188 majors become 187."""
        return (
            t['liquipediatier'] == 1
            and t['liquipediatiertype'] is None
            and is_epic(t)
            and (t['startdate'] or '') >= '2019-07-26'
            and not re.search(r'console|mobile|twitch|challenge', t['name'], re.I)
        )

    def is_fncs_final(t):
        return is_major(t) and 'FNCS' in t['name']

    def is_world_cup(t):
        return t['name'].startswith('Fortnite World Cup')

    def is_global(t):
        """The FNCS Global Championships. Not the 2019 World Cup finals, which are
        a LAN of their own (the user, 13 Oct 2026); facts.ts reads an older
        file's World Cup as a LAN too."""
        return 'Global Championship' in t['name']

    def year_of(t):
        """Calendar year, or None when the export's date is not one.

        A few rows carry a malformed `startdate` — the one that bit was
        `0-01-...` — so `str(startdate)[:4]` is not safe to hand to `int()`.
        Those results still count towards career and LAN totals; they are only
        left out of the per-year buckets, because there is no year to put them in.
        """
        m = re.match(r'^(\d{4})-', str(t.get('startdate') or ''))
        return int(m.group(1)) if m else None

    bad_dates = [t['name'] for t in tournaments if year_of(t) is None]
    if bad_dates:
        print(f'{len(bad_dates)} tournaments have an unusable startdate, e.g. {bad_dates[:3]}')

    # Region label: tournaments.json says "Brazil", players.json says "South
    # America". One word for one place, or the per-region boards split in two.
    REGION_FIX = {'Brazil': 'South America', 'Japan': 'Asia', 'MENA': 'Middle East',
                  'India': 'Asia', 'China': 'Asia', 'Latin America': 'South America',
                  'CIS': 'Europe', 'Benelux': 'Europe', 'Turkey': 'Europe',
                  'Pakistan': 'Asia'}

    def region_of(t):
        r = t.get('region')
        return REGION_FIX.get(r, r)

    tour_of = {}
    for t in tournaments:
        tour_of.setdefault(t['name'], t)

    MAJORS = {t['name'] for t in tournaments if is_major(t)}
    LANS   = {t['name'] for t in tournaments if is_lan(t)}
    FNCS   = {t['name'] for t in tournaments if is_fncs_final(t)}
    WCUP   = {t['name'] for t in tournaments if is_world_cup(t)}
    GLOBAL = {t['name'] for t in tournaments if is_global(t)}

    print(f'majors {len(MAJORS)}  LANs {len(LANS)}  FNCS finals {len(FNCS)} '
          f'  World Cup {len(WCUP)}  globals {len(GLOBAL)}')

    # ------------------------------------------------------------- placed rows --
    # One pass, reused by every cell below. `rank` is None for '', 'DNP' and 'DQ';
    # a range like '35-36' reads as its best end, same rule as career_path.
    def rank_of(raw):
        m = re.match(r'^(\d+)', str(raw or ''))
        return int(m.group(1)) if m else None

    def did_not_play(row):
        """A 'DNP' row: listed for the event, never took part - a substitute, or a
        player replaced before it started. Three of them made the 2026 Globals a
        field of 103; they are not results, appearances or entrants anywhere."""
        return str(row.get('placement') or '').strip().upper() == 'DNP'

    PLACED = []
    for row in placements:
        t = tour_of.get(row.get('tournament'))
        if not t or did_not_play(row):
            continue
        r = rank_of(row.get('placement'))
        money = float(row.get('individualprizemoney') or 0)
        pages = [(resolve(p.get('player') or ''), p.get('team')) for p in (row.get('participants') or [])]
        pages = [(pg, tm) for pg, tm in pages if pg]
        if not pages:
            continue
        PLACED.append((t, r, money, pages))

    print(f'{len(PLACED):,} placement rows with at least one nameable player')

    # ------------------------------------------------------------- FNCS waves --
    # A "wave" is one round of FNCS grand finals: every region's final inside a week
    # of each other. Read off the dates rather than the names, because the naming
    # changed four times (Season X, C2S1, FNCS 2023 - Major 1) and the dates did not.
    # A cluster smaller than four regions is a one-off - a Global Championship, the
    # 2022 Invitational, the 2026 Summit - and is left out, so missing an event
    # nobody could qualify for does not break a streak. Cell 2's averages and
    # cell 4's streaks both count in waves.
    def day_of(t):
        d = str(t.get('startdate') or '')[:10]
        return d if re.match(r'^\d{4}-\d{2}-\d{2}$', d) else None
    def days_apart(a, b):
        return (date.fromisoformat(b) - date.fromisoformat(a)).days

    _fncs_days = sorted((day_of(tour_of[n]), n) for n in FNCS if day_of(tour_of[n]))
    _clusters, _cur = [], []
    for _d, _n in _fncs_days:
        if _cur and days_apart(_cur[-1][0], _d) > 7:
            _clusters.append(_cur)
            _cur = []
        _cur.append((_d, _n))
    if _cur:
        _clusters.append(_cur)
    WAVES = [c for c in _clusters if len(c) >= 4]
    wave_of = {n: i for i, c in enumerate(WAVES) for _, n in c}

    # ------------------------------------------------------------------ season --
    # The big events of one year, for List's "played all of them" (facts.json).
    # Tenaball's "Top 10 players of 2026" boards are cell 2's averages now, over
    # the same five events and every other year's too.
    #
    # The five were named by the user. EWC 2026 is Liquipedia's "Reload Elite
    # Series 2026 - Championship" (its series is the Esports World Cup). A
    # Major is its regional grand finals, and a player only plays their own.
    SEASON_YEAR = 2026
    SEASON_EVENTS = [
        ("EWC", r"Reload Elite Series 2026 - Championship"),
        ("Globals", r"FNCS 2026\s+Global Championship"),
        ("Summit", r"FNCS 2026\s+Major 1 Summit"),
        ("FNCS Major 1", r"FNCS 2026 - Major 1: .+ - Grand Finals"),
        ("FNCS Major 2", r"FNCS 2026 - Major 2: .+ - Grand Finals"),
    ]
    season_slot = {}
    for slot, (label, pattern) in enumerate(SEASON_EVENTS):
        names = {t["name"] for t in tournaments if re.fullmatch(pattern, t["name"])}
        if not names:
            print(f"  season: nothing matches {label!r} - its boards and lists will not be built")
        season_slot.update((name, slot) for name in names)

    # Every team's finish at each event. A finish of None is a DQ or a blank row:
    # not a result to average.
    SEASON_TEAMS = sorted(
        {
            (season_slot[t["name"]], r, tuple(sorted(page for page, _team in pages)))
            for t, r, _money, pages in PLACED
            if t["name"] in season_slot and r is not None
        }
    )

    # ======================================================================
    # Cell 2 — rankings.json
    # ======================================================================
    print()
    print('Cell 2 — rankings.json')
    OUT = f'{BASE}/rankings.json'
    YEARS = list(range(2018, 2027))
    SLOTS = 10

    boards = []
    LEVEL_AT_CUT = []   # boards left out because 10th and 11th could not be split

    def level(a, b):
        """Equal on the value and on every tiebreak after it."""
        return a[2] == b[2] and a[3:] == b[3:]

    def board(bid, group, title, entity, tie, ranked, fmt, lower=False, members_of=None):
        """`ranked` is [(key, label, value)] or [(key, label, value, tiebreak...)],
        already sorted best-first.

        A board whose 10th and 11th are level on everything it ranks by has no
        single right answer for the last slot. Those used to be split by name,
        which is a rule a player can read but not play, and then left out. Now
        either of the two fills 10th (`shareCut`, the user's call on 30 Sep 2026)
        and the rule says so. Only a pair: a 12th level too has no spare to be
        tested against, so that board is still left out. Everywhere else in the
        ten a level pair is only a question of which slot is drawn first, so the
        name still orders them there and nothing says so.

        `members_of` makes each row a team, as on the tournament boards."""
        if len(ranked) < SLOTS + 1:
            return
        shared = False
        if level(ranked[SLOTS - 1], ranked[SLOTS]):
            if len(ranked) > SLOTS + 1 and level(ranked[SLOTS], ranked[SLOTS + 1]):
                LEVEL_AT_CUT.append(bid)
                return
            shared = True
            tie = f'{tie} 10th and 11th are level, so either one fills 10th.'

        def row(k, l, v):
            out = {'key': k, 'label': l, 'value': round(v, 2), 'display': fmt(v)}
            if members_of:
                out['members'] = members_of(k)
            return out

        spare = row(*ranked[SLOTS][:3])
        del spare['display']             # the 11th is a near-miss test, never shown
        out = {'id': bid, 'group': group, 'title': title, 'entity': entity,
               'tieRule': tie, 'rows': [row(*e[:3]) for e in ranked[:SLOTS]], 'next': spare}
        if lower:
            out['lowerIsBetter'] = True
        if shared:
            out['shareCut'] = True
        boards.append(out)

    money = lambda v: '${:,.0f}'.format(v)
    count = lambda word: (lambda v: f'{v:,.0f} {word}' + ('' if v == 1 else 's'))

    def rank(d, label_of):
        return sorted(((k, label_of(k), v) for k, v in d.items() if v > 0),
                      key=lambda e: (-e[2], e[1].lower()))

    def rank_fame(d, label_of=None, money_of=None):
        """`rank`, but level counts fall to money before they fall to the alphabet.

        On a count board the alphabet is a bad tiebreak and TIE_COUNT already
        promised this one: nine of the ten slots on "Top 10 by FNCS wins" are 3s and
        4s, and which of the 3s is tenth was decided by their initial. "The bigger
        earner is higher" is a rule a player can act on. `money_of` is the career
        column for a player, the org's prize money for an org, the country's total
        for a country."""
        # Resolved here rather than as defaults: both are defined below this.
        label_of = label_of or NAME
        money_of = money_of or (lambda k: career.get(k, 0))
        # The money rides along as a fourth field so `board` can tell a level count
        # that money settles from one it does not.
        return sorted(((k, label_of(k), v, money_of(k)) for k, v in d.items() if v > 0),
                      key=lambda e: (-e[2], -e[3], e[1].lower()))

    NAME = lambda page: player_of[page]['id'] if page in player_of else page
    TIE_MONEY = 'Straight prize-money order.'
    TIE_COUNT = ('Players level on the count are ranked by career earnings, so the '
                 'bigger earner is higher.')

    # ---------------------------------------------------------- player: totals --
    earn      = Counter()   # from placements, so it can be sliced
    lan_earn  = Counter(); fncs_earn = Counter(); wc_earn = Counter()
    lan_apps  = Counter(); fncs_apps = Counter()
    year_earn = defaultdict(Counter)
    org_earn  = Counter(); org_year  = defaultdict(Counter); org_majors = Counter()

    for t, r, m, pages in PLACED:
        # `yr` is None for the handful of rows with a malformed date. They still
        # count towards career totals — the money was won — and are simply left out
        # of the per-year boards, because there is no year to file them under.
        n, yr = t['name'], year_of(t)
        for page, team in pages:
            earn[page] += m
            if yr is not None:
                year_earn[yr][page] += m
            if n in LANS:
                lan_earn[page] += m; lan_apps[page] += 1
            if n in FNCS:
                fncs_earn[page] += m; fncs_apps[page] += 1
            if n in WCUP:
                wc_earn[page] += m
            if team and team.lower() not in ('free agent', '', 'none'):
                org_earn[team] += m
                if yr is not None:
                    org_year[yr][team] += m
                if n in MAJORS and r == 1:
                    org_majors[team] += 1

    # The day each player's prize money from tournament results first reached
    # $1M, for Tenite's "first 10 to $1M in career earnings" (the user, 14 Oct
    # 2026), into facts.json as `million`. Counted from the placements in date
    # order, so it is the results' running total, not the published figure.
    MILLION = []
    running = Counter()
    for t, r, m, pages in sorted(PLACED, key=lambda placed: day_of(placed[0]) or '9999'):
        day = day_of(t)
        if not day:
            continue
        for page, team in pages:
            before = running[page]
            running[page] += m
            if before < 1_000_000 <= running[page]:
                MILLION.append({'id': page, 'date': day})

    # Career earnings uses the published column, not the sum of placements — it is
    # the number Liquipedia shows on the player page and the one people remember.
    career = Counter({p['pagename']: float(p['earnings'] or 0) for p in PLAYABLE})

    # ------------------------------------------------------------- tiebreaks --
    # What a level count falls to before career earnings (the user, 22 Oct 2026:
    # "only career earnings isn't ideal ... it could change depends on the
    # category"). Each board names its own, in the order a fan would reach for
    # them: a count of titles goes to the player with more podiums of the same
    # kind, a count of appearances to the better average finish at those
    # events, and only what is still level after that to the bigger earner.
    REGIONAL = FNCS - LANS          # the regional grand finals, the ones an "FNCS win" is
    top3_at = defaultdict(Counter)  # kind -> page -> top-3 finishes
    places_at = defaultdict(lambda: defaultdict(list))   # kind -> page -> places
    for t, r, m, pages in PLACED:
        if r is None:
            continue
        n = t['name']
        kinds = [k for k, names in (('regional', REGIONAL), ('fncs', FNCS), ('major', MAJORS), ('lan', LANS))
                 if n in names]
        for page, _ in pages:
            for k in kinds:
                places_at[k][page].append(r)
                if r <= 3:
                    top3_at[k][page] += 1

    def podiums(kind):
        """More top-3 finishes of `kind` ranks higher."""
        return lambda page: top3_at[kind][page]

    def avg_finish(kind):
        """The better average finish at events of `kind` ranks higher; none at all, last."""
        return lambda page: (-sum(places_at[kind][page]) / len(places_at[kind][page])
                             if places_at[kind][page] else float('-inf'))

    def rank_by(d, *tiebreaks, label_of=None):
        """`rank_fame` with the category's own tiebreaks before the money: each
        one page -> number, bigger ranking higher. They ride along after the
        value, so `board` sees a cut still level after all of them as level."""
        label_of = label_of or NAME
        return sorted(((k, label_of(k), v, *(f(k) for f in tiebreaks), career.get(k, 0))
                       for k, v in d.items() if v > 0),
                      key=lambda e: (-e[2], *(-x for x in e[3:]), e[1].lower()))

    def tie_text(*steps):
        """"Players level on titles are ranked by X, then by Y, then by career earnings." """
        return 'Level ones go to ' + ', then to '.join(steps + ('the bigger career earner',)) + '.'

    board('career-earnings', 'Players', 'Top 10 by career earnings', 'player',
          TIE_MONEY, rank(career, NAME), money)
    board('lan-earnings', 'Players', 'Top 10 by major LAN earnings', 'player',
          TIE_MONEY, rank(lan_earn, NAME), money)
    board('fncs-earnings', 'Players', 'Top 10 by FNCS earnings', 'player',
          TIE_MONEY, rank(fncs_earn, NAME), money)
    board('earnings-no-wc', 'Players', 'Top 10 by earnings excluding the World Cup',
          'player', TIE_MONEY,
          rank(Counter({k: v - wc_earn[k] for k, v in earn.items()}), NAME), money)
    board('lan-apps', 'Players', 'Top 10 by major LAN appearances', 'player',
          tie_text('the better average finish at those LANs'),
          rank_by(lan_apps, avg_finish('lan')), count('LAN'))
    board('fncs-apps', 'Players', 'Top 10 by FNCS Finals appearances', 'player',
          tie_text('the better average finish in those finals'),
          rank_by(fncs_apps, avg_finish('fncs')), count('final'))
    board('fncs-wins', 'Players', 'Top 10 by FNCS wins', 'player',
          tie_text('more FNCS podiums (top 3 in a grand final)', 'the better average FNCS finish'),
          rank_by(Counter({p['pagename']: p['fncs_wins'] for p in PLAYABLE}),
                  podiums('regional'), avg_finish('regional')),
          count('title'))

    major_wins = Counter()
    for t, r, m, pages in PLACED:
        if t['name'] in MAJORS and r == 1:
            for page, _ in pages:
                major_wins[page] += 1
    board('major-wins', 'Players', 'Top 10 by major tournament wins', 'player',
          tie_text('more podiums at majors', 'the better average finish at majors'),
          rank_by(major_wins, podiums('major'), avg_finish('major')), count('win'))

    for y in YEARS:
        board(f'year-earnings:{y}', 'Players', f'Top 10 earners in {y}', 'player',
              TIE_MONEY, rank(year_earn[y], NAME), money)

    # ---------------------------------------------------------------- averages --
    # Average finish over a run of events (the user's spec, 1 Oct 2026), in
    # three families, newest year first:
    #
    #   "Top 10 players of 2025"                 the year's majors: each round of
    #                                             FNCS grand finals plus the
    #                                             year's LANs - the World Cup,
    #                                             the Invitational, the Summit,
    #                                             EWC, the Globals
    #   "Top 10 by average FNCS finish in 2025"  the rounds of FNCS finals alone
    #   "... average FNCS finish, all time"      every round since 2019
    #
    # Each is a world board plus one per FNCS region, with North America split
    # the way the FNCS split it (`fncs_server`). From 2022, when a year kept one
    # team format the whole way through, the same again for duos or trios. The
    # majors are skipped in 2020 and 2021: with no LAN they would be the FNCS
    # boards twice.
    #
    # A round is one slot - a player has one final in it, their own region's -
    # and each LAN is a slot of its own. A slot missed counts as twice the last
    # place of a full lobby in its format (MISSED): 100th in duos, 66th in
    # trios. That puts the players at every event first without one missed
    # final sinking a great year; it was a flat 200 until 1 Oct 2026. Being
    # there with no finish on record - a DQ, or out of the Summit before its
    # last stage - counts as a miss. Before 2022 the formats changed inside a
    # year, and a trio's 12th of 33 and a solo 40th of 100 average as written
    # (the user's call).
    MISSED = {'Solo': 200, 'Duo': 100, 'Trio': 66, 'Squad': 50}
    MODE_WORD = {'Solo': 'solos', 'Duo': 'duos', 'Trio': 'trios', 'Squad': 'squads'}
    TEAM_SIZE = {'Duo': 2, 'Trio': 3}
    SERVERS = ['Europe', 'NA East', 'NA Central', 'NA West', 'Brazil', 'Asia',
               'Middle East', 'Oceania']
    average = lambda v: f'{v:.1f}'

    def fncs_server(t):
        """A regional final's region, North America split the way the FNCS split
        it: NA East and NA West until Major 1 of 2023, one North America final
        from Major 2 that year through 2024 - NA Central, as the user names it -
        then NA Central and NA West again from 2025."""
        reg = region_of(t)
        if reg == 'South America':
            return 'Brazil'          # what the FNCS calls it
        if reg != 'North America':
            return reg
        if re.search(r'NA East|North America East', t['name']):
            return 'NA East'
        if re.search(r'NA West|North America West', t['name']):
            return 'NA West'
        return 'NA Central'

    def team_name(pages):
        """'aqua & nyhrox', 'Japko, panzer & Setty' — the names, alphabetical."""
        names = sorted((NAME(p) for p in pages), key=str.lower)
        return names[0] if len(names) == 1 else ' & '.join([', '.join(names[:-1]), names[-1]])

    # Every finish at those events, straight off `placements` like the
    # tournament boards below: PLACED drops the players it cannot resolve, and
    # a board with one of them in its top eleven has to see that and refuse,
    # or 11th would be shown as 10th.
    entrant = lambda name: resolve(name) or f'?{name}'
    unnamed = lambda key: any(k.startswith('?') for k in (key if isinstance(key, tuple) else [key]))
    AVERAGED = {n for wave in WAVES for _, n in wave} | LANS
    finishes = defaultdict(list)        # event -> [(finish, sorted member keys)]
    for row in placements:
        n = row.get('tournament')
        if n not in AVERAGED or did_not_play(row):
            continue
        r = rank_of(row.get('placement'))
        names = [p.get('player') or '' for p in (row.get('participants') or [])]
        if r is not None and names and all(names):
            finishes[n].append((r, tuple(sorted(entrant(x) for x in names))))

    # (year, mode, {server: [finals]}) for each round with results, oldest
    # first. A round still to be played is not one anybody missed.
    ROUNDS = []
    for wave in WAVES:
        played = [n for _, n in wave if finishes[n]]
        if not played:
            continue
        servers = defaultdict(list)
        for n in played:
            servers[fncs_server(tour_of[n])].append(n)
        modes = {tour_of[n].get('mode') for n in played}
        ROUNDS.append((year_of(tour_of[played[0]]), modes.pop() if len(modes) == 1 else None,
                       dict(servers)))
    YEAR_LANS = defaultdict(list)
    for n in sorted(LANS, key=lambda n: (day_of(tour_of[n]) or '', n)):
        if finishes[n]:
            YEAR_LANS[year_of(tour_of[n])].append(n)

    def average_finish(slots, home, size=None, results=None, missed=None, peak=None):
        """Each entrant's average over `slots`, [(mode, events)]. A slot holds one
        finish per entrant - the best, for a player Liquipedia lists twice, like
        Astell in two duos at the 2026 Major 2 Asia final. Only entrants with a
        finish at one of the `home` events are kept. With `size` an entrant is a
        whole team of that many, with a finish only where exactly those players
        played together. `results` and `missed` default to the majors' finishes
        and MISSED; the Div Cups pass their own and a flat 100. `peak`, a dict,
        is filled with each entrant's best single finish over the same slots -
        what a level average goes to."""
        results = finishes if results is None else results
        miss = (lambda mode: MISSED[mode]) if missed is None else (lambda mode: missed)
        best, kept = defaultdict(dict), set()
        for i, (_mode, events) in enumerate(slots):
            for n in events:
                for r, members in results[n]:
                    if size and len(members) != size:
                        continue
                    for key in ([members] if size else members):
                        if r < best[key].get(i, r + 1):
                            best[key][i] = r
                        if n in home:
                            kept.add(key)
        if peak is not None:
            peak.update((key, min(best[key].values())) for key in kept)
        return {key: sum(best[key].get(i, miss(mode)) for i, (mode, _) in enumerate(slots))
                     / len(slots)
                for key in kept}

    def join(words):
        return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"

    def lan_label(n):
        m = re.search(r'World Cup Finals - (\w+)', n)
        if m:
            return f'the World Cup {m.group(1).lower()} final'
        for word, label in (('Global Championship', 'the Globals'), ('Summit', 'the Summit'),
                            ('Invitational', 'the Invitational'), ('Reload Elite Series', 'EWC')):
            if word in n:
                return label
        return n

    def avg_tie(slots, lans, k, server, when, size):
        if server:
            finals = (f'the {server} FNCS grand final {when}' if k == 1 else
                      f'the {k} {server} FNCS grand finals {when}')
        else:
            finals = (f'the {k} rounds of FNCS grand finals {when}, each player in their '
                      f"own region's final")
        out = (f'Average finish at {join([lan_label(n) for n in lans] + [finals])}.' if lans else
               f'Average finish across {finals}.')
        noun = 'event' if lans else 'final'
        modes = sorted({mode for mode, _ in slots}, key=lambda m: -MISSED[m])
        if len(modes) == 1:
            out += f" A missed {noun} counts as {MISSED[modes[0]]}th, twice a full lobby's last place."
        else:
            out += (f" A missed {noun} counts as twice a full lobby's last place: "
                    + join([f'{MISSED[m]}th in {MODE_WORD[m]}' for m in modes]) + '.')
        if size:
            word = 'duo' if size == 2 else 'trio'
            out += (f' {word.title()}s are ranked as one team, so an {noun} they did not play '
                    f'together is a miss. Each player counts once, with their best {word}, '
                    f'and {"both" if size == 2 else "all three"} names fill one slot.')
        return out

    def team_members(key):
        return [{'key': pg, 'label': NAME(pg)}
                for pg in sorted(key.split('|'), key=lambda pg: NAME(pg).lower())]

    AVG_UNNAMED = []     # left out: an entrant in the top eleven the roster cannot name

    def avg_board(bid, group, title, tie, avgs, size=None, peak=None):
        """Level averages fall to the better best finish over the same events
        (`peak`, from `average_finish`), then to career earnings - a team's added
        up - and only then to a shared 10th: with two or three rounds in a year,
        three players level at the cut is common, and those boards were being
        dropped. The best finish first (22 Oct 2026): two players on one average
        are told apart by who reached higher, which is the thing a fan remembers."""
        label = team_name if size else NAME
        money_of = (lambda key: sum(career.get(pg, 0) for pg in key)) if size else \
                   (lambda key: career.get(key, 0))
        peak = peak or {}
        ranked = sorted(((key, label(key), v, -peak.get(key, 999), money_of(key)) for key, v in avgs.items()),
                        key=lambda e: (e[2], -e[3], -e[4], e[1].lower()))
        if size:
            # One team per player, their best: with two of one player's duos
            # in the eleven, naming them would answer two slots at once.
            seen = set()
            ranked = [e for e in ranked if not seen & set(e[0]) and not seen.update(e[0])]
        if any(unnamed(e[0]) for e in ranked[:SLOTS + 1]):
            AVG_UNNAMED.append(bid)
            return
        if size:
            ranked = [('|'.join(key), name, v, top, money) for key, name, v, top, money in ranked]
        tie += (' Level averages go to the better best finish, then to the bigger combined career earnings.'
                if size else ' Level averages go to the better best finish, then to the bigger career earner.')
        board(bid, group, title, 'player', tie, ranked, average, lower=True,
              members_of=team_members if size else None)

    def avg_scope(year, server, lans, mode=None):
        """One board's slots - [(mode, events)] - the events that put an entrant
        on it, and how many rounds of FNCS finals are among the slots."""
        slots = []
        for y, m, by_server in ROUNDS:
            if year is not None and y != year:
                continue
            events = by_server.get(server, []) if server else [n for ns in by_server.values() for n in ns]
            if events and (mode is None or m == mode):
                slots.append((m, events))
        k = len(slots)
        home = {n for _, events in slots for n in events}
        slots += [(tour_of[n].get('mode'), [n]) for n in lans
                  if mode is None or tour_of[n].get('mode') == mode]
        if not server:
            home = {n for _, events in slots for n in events}
        return slots, home, k

    avg_built = Counter()
    for year in sorted({y for y, _, _ in ROUNDS}, reverse=True):
        group = f'{year} season'
        round_modes = Counter(m for y, m, _ in ROUNDS if y == year)
        team_mode = round_modes.most_common(1)[0][0] if year >= 2022 else None
        for prefix, lans in (('season', YEAR_LANS[year]), ('fncs-avg', [])):
            if prefix == 'season' and not lans:
                continue
            for size in [None] + ([TEAM_SIZE[team_mode]] if team_mode in TEAM_SIZE else []):
                mode = team_mode if size else None
                for server in [None] + SERVERS:
                    slots, home, k = avg_scope(year, server, lans, mode)
                    if not k:
                        continue        # no final in this region that year
                    if any(m not in MISSED for m, _ in slots):
                        print(f'  averages: {year} {server or "world"} has a format with no '
                              f'missed value: {sorted({m for m, _ in slots} - set(MISSED), key=str)}')
                        continue
                    who = MODE_WORD[mode] if size else 'players'
                    title = (f'Top 10 {who} of {year}' if prefix == 'season' else
                             f"Top 10 {'' if not size else who + ' '}by average FNCS finish in {year}")
                    bid = ':'.join([prefix, str(year)] + ([who] if size else [])
                                   + ([server] if server else [] if size else ['world']))
                    before = len(boards)
                    peak = {}
                    avg_board(bid, group, title + (f' — {server}' if server else ''),
                              avg_tie(slots, lans, k, server, f'of {year}', size),
                              average_finish(slots, home, size, peak=peak), size, peak)
                    avg_built[prefix] += len(boards) - before

    # All time: every round of FNCS finals, misses counted from 2019 for
    # everyone - nobody knows when a player started trying to qualify.
    for server in [None] + SERVERS:
        slots, home, k = avg_scope(None, server, [])
        if not k:
            continue
        first = min(y for y, _, by_server in ROUNDS if not server or server in by_server)
        before = len(boards)
        peak = {}
        avg_board(f"fncs-avg:all:{server or 'world'}", 'FNCS all time',
                  'Top 10 by average FNCS finish, all time' + (f' — {server}' if server else ''),
                  avg_tie(slots, [], k, server, f'since {first}', None),
                  average_finish(slots, home, peak=peak), peak=peak)
        avg_built['all time'] += len(boards) - before
    print(f'averages: {len(ROUNDS)} rounds of FNCS finals, LANs by year '
          f'{ {y: len(ns) for y, ns in sorted(YEAR_LANS.items())} }; boards {dict(avg_built)}')
    # ----------------------------------------------- Div Cups and Evaluations --
    # FNCS Divisional Cup finals, Chapter 6 on with C6S4's Practice Cups, and
    # Fortnite Performance Evaluations (the user's spec, 1 Oct 2026). Every
    # board is a world board plus one per region, and every region's final is
    # its own event: a player in two regions in one week has two finals.
    #
    # Read by pagename, not by name: Liquipedia gave the C7S4 Div Cups the C7S3
    # names, so "C7S3: FNCS Divisional Cup Finals Week 1: Europe" is two events,
    # and a placement row only carries the name. A row goes to the event of
    # that name that started nearest its own date.
    def by_pagename(keep):
        events = {t['pagename']: t for t in tournaments if keep(t)}
        named = defaultdict(list)
        for t in events.values():
            named[t['name']].append(t)
        rows = defaultdict(list)
        for row in placements:
            same = named.get(row.get('tournament'))
            if not same or did_not_play(row):
                continue
            day = str(row.get('date') or '')[:10]
            t = same[0]
            if len(same) > 1 and re.match(r'^\d{4}-\d{2}-\d{2}$', day):
                t = min(same, key=lambda t: abs(days_apart(day_of(t) or day, day)))
            rows[t['pagename']].append(row)
        return events, rows

    # The pagename says the region where the name does not ("North America" in
    # both NA finals' regions), and it is right about the season where the name
    # is not.
    PAGE_SERVER = [('North_America_Central', 'NA Central'), ('North_America_West', 'NA West'),
                   ('North_America', 'NA Central'), ('Europe', 'Europe'), ('Brazil', 'Brazil'),
                   ('Asia', 'Asia'), ('Middle_East', 'Middle East'), ('Oceania', 'Oceania')]
    REGION_SERVER = {'North America': 'NA Central', 'South America': 'Brazil'}

    def page_server(t):
        """Older Evaluation pages carry no region in the pagename; theirs is the
        event's own, and North America's only Evaluation region is NA Central."""
        found = next((label for key, label in PAGE_SERVER if key in t['pagename']), None)
        return found or REGION_SERVER.get(region_of(t), region_of(t))

    def page_results(rows_of):
        """pagename -> ranked finishes, everyone there (ranked or not), prize per entrant."""
        ranked, there, prize = defaultdict(list), defaultdict(set), defaultdict(Counter)
        for page, rows in rows_of.items():
            for row in rows:
                names = [p.get('player') for p in (row.get('participants') or []) if p.get('player')]
                if not names:
                    continue        # a session still to be played: places, nobody in them
                members = tuple(sorted(entrant(x) for x in names))
                r = rank_of(row.get('placement'))
                if r is not None:
                    ranked[page].append((r, members))
                each = (float(row.get('individualprizemoney') or 0)
                        or float(row.get('prizemoney') or 0) / len(names))
                for k in members:
                    there[page].add(k)
                    prize[page][k] += each
        return ranked, there, prize

    DIV_MISSED = 100     # the user's number for a Div Cup week missed, duos or trios
    DIV_SERVERS = ['Europe', 'NA Central', 'NA West', 'Brazil', 'Asia', 'Middle East', 'Oceania']
    DIV, div_rows = by_pagename(lambda t: 'Divisional' in t['name'])
    div_ranked, div_there, div_prize = page_results(div_rows)
    season_tag = lambda t: 'C{}S{}'.format(*re.search(r'Chapter_(\d+)/Season_(\d+)', t['pagename']).groups())

    # A week is every region's final of one Div Cup: (season, practice, number).
    # Only weeks someone has played.
    _weeks = defaultdict(list)
    for page, t in DIV.items():
        if div_there[page]:
            m = re.search(r'Week_(\d+)', page)
            _weeks[(season_tag(t), 'Practice' in page, int(m.group(1)) if m else 0)].append(page)
    week_start = {w: min(day_of(DIV[p]) or '9999' for p in pages) for w, pages in _weeks.items()}
    WEEKS = sorted(_weeks, key=week_start.get)
    week_year = {w: int(week_start[w][:4]) for w in WEEKS}
    week_mode = {w: Counter(DIV[p].get('mode') for p in _weeks[w]).most_common(1)[0][0] for w in WEEKS}
    week_label = lambda w: f"{w[0]} {'Practice Cup' if w[1] else 'week'} {w[2]}"

    def div_pages(weeks, server):
        return [p for w in weeks for p in _weeks[w] if not server or page_server(DIV[p]) == server]

    def div_average(weeks, server, size=None, peak=None):
        """Average finish over `weeks`, a week missed at 100th. On a world board
        a player in two regions that week keeps the better finish."""
        slots = [(week_mode[w], div_pages([w], server)) for w in weeks]
        slots = [s for s in slots if s[1]]
        home = {p for _, pages in slots for p in pages}
        return average_finish(slots, home, size, div_ranked, DIV_MISSED, peak) if slots else {}

    def tally_board(bid, group, title, tie, counts, tiebreak, fmt, then=None):
        """A count or a sum, level ones split by `tiebreak` - an average finish,
        lower first, as the user asked for the Div Cups - and what is still
        level by `then`, lower first too."""
        ranked = sorted(((k, NAME(k), v, tiebreak.get(k, DIV_MISSED), *([then.get(k, 0)] if then else []))
                         for k, v in counts.items() if v > 0),
                        key=lambda e: (-e[2], *e[3:], e[1].lower()))
        if any(unnamed(e[0]) for e in ranked[:SLOTS + 1]):
            AVG_UNNAMED.append(bid)
            return
        board(bid, group, title, 'player', tie, ranked, fmt)

    # The scopes. Counts are all time, by chapter and by year; averages by
    # chapter, year and season (the user, 1 Oct 2026: a season's handful of
    # weeks makes every count a tie). A year needs four weeks - December 2024
    # had two, and they count in Chapter 6 and all time.
    _chapters = sorted({w[0][:2] for w in WEEKS}, reverse=True)
    _years = sorted((y for y, n in Counter(week_year.values()).items() if n >= 4), reverse=True)
    _seasons = sorted({w[0] for w in WEEKS}, key=lambda s: (int(s[1]), int(s[3:])), reverse=True)
    WHOLE = [('all', 'all time', ', all time', WEEKS)]
    CHAPTERS = [(c, f'Chapter {c[1:]}', f' in Chapter {c[1:]}', [w for w in WEEKS if w[0][:2] == c])
                for c in _chapters]
    YEARS_DIV = [(str(y), str(y), f' in {y}', [w for w in WEEKS if week_year[w] == y]) for y in _years]
    SEASONS = [(s, s, f' in {s}', [w for w in WEEKS if w[0] == s]) for s in _seasons]
    where = lambda server: f' — {server}' if server else ''
    the = lambda server: f'{server} ' if server else ''
    count_fmt = lambda one: lambda v: f'{v:,.0f} {one}' + ('' if v == 1 else 's')
    div_built = Counter()

    def div_tie(lead, scope_text, server, note=''):
        return (f'{lead}{scope_text}{note}. Level ones go to the better average {the(server)}Div Cup '
                f'finish over the same weeks, a missed week counting as 100th.')

    for key, label, scope_text, weeks in WHOLE + CHAPTERS + YEARS_DIV:
        group = f'Div Cups — {label}'
        for server in [None] + DIV_SERVERS:
            pages = div_pages(weeks, server)
            quals, wins, prize = Counter(), Counter(), Counter()
            for p in pages:
                quals.update(div_there[p])
                wins.update(k for r, members in div_ranked[p] if r == 1 for k in members)
                prize.update(div_prize[p])
            avg = div_average(weeks, server)
            bid = lambda metric: f"divcup:{metric}:{key}:{server or 'world'}"
            before = len(boards)
            tally_board(bid('finals'), group, f'Top 10 by Div Cup finals reached{scope_text}{where(server)}',
                        div_tie(f'{the(server)}Div Cup finals reached', scope_text, server,
                                '' if server else "; every region's final counts, so two regions in one week is two"),
                        quals, avg, count_fmt('final'))
            tally_board(bid('wins'), group, f'Top 10 by Div Cup wins{scope_text}{where(server)}',
                        div_tie(f'{the(server)}Div Cup finals won', scope_text, server),
                        wins, avg, count_fmt('win'))
            tally_board(bid('earnings'), group, f'Top 10 by Div Cup earnings{scope_text}{where(server)}',
                        div_tie(f'Prize money from {the(server)}Div Cup finals', scope_text, server),
                        prize, avg, money)
            div_built['counts'] += len(boards) - before

    # Averages, players and teams. A team only has a finish in a week where
    # exactly those players played together. Chapter 6's duo Div Cups (C6S4)
    # are left out of the team boards - too many duos changed partners there,
    # the user's call - so Chapter 6 and 2025 are trios, Chapter 7 and 2026
    # duos, and C6S4 has no team board at all.
    team_week = lambda w: not (w[0].startswith('C6') and week_mode[w] == 'Duo')
    for key, label, scope_text, weeks in CHAPTERS + YEARS_DIV + SEASONS:
        group = f'Div Cups — {label}'
        n = len(weeks)
        for server in [None] + DIV_SERVERS:
            before = len(boards)
            peak = {}
            avg_board(f"divcup:average:{key}:{server or 'world'}", group,
                      f'Top 10 by average Div Cup finish{scope_text}{where(server)}',
                      f'Average finish across the {n} {the(server)}Div Cup weeks{scope_text}'
                      + (', the better one for a player in two regions that week' if not server else '')
                      + '. A missed week counts as 100th.',
                      div_average(weeks, server, peak=peak), peak=peak)
            div_built['averages'] += len(boards) - before
        eligible = [w for w in weeks if team_week(w)]
        if not eligible or (key in {s for s, *_ in SEASONS} and len(eligible) < n):
            continue
        mode = Counter(week_mode[w] for w in eligible).most_common(1)[0][0]
        team_weeks = [w for w in eligible if week_mode[w] == mode]
        size, word = TEAM_SIZE[mode], MODE_WORD[mode]
        for server in [None] + DIV_SERVERS:
            before = len(boards)
            peak = {}
            avg_board(f"divcup:average-{word}:{key}:{server or 'world'}", group,
                      f'Top 10 {word} by average Div Cup finish{scope_text}{where(server)}',
                      f'Average finish across the {len(team_weeks)} {the(server)}{mode.lower()} Div Cup '
                      f'weeks{scope_text}'
                      + (", Chapter 6's duo Div Cups left out" if len(team_weeks) < n else '')
                      + f'. {word.title()} are ranked as one team, so a week they did not play together '
                      f'is a miss, counting as 100th. Each player counts once, with their best '
                      f'{word[:-1]}, and {"both" if size == 2 else "all three"} names fill one slot.',
                      div_average(team_weeks, server, size, peak), size, peak)
            div_built['team averages'] += len(boards) - before

    # Performance Evaluations: money and lobbies reached, no averages (the
    # user's call). Europe and NA Central are the only regions that hold them.
    # 2023 had seven sessions paying $400 a head, so it counts in all time only.
    FPE, fpe_rows = by_pagename(lambda t: 'Fortnite Performance Evaluation' in t['name'])
    _fpe_ranked, fpe_there, fpe_prize = page_results(fpe_rows)
    FPE_PLAYED = [p for p in sorted(FPE, key=lambda p: day_of(FPE[p]) or '') if fpe_there[p]]
    FPE_SERVERS = [s for s in DIV_SERVERS if any(page_server(FPE[p]) == s for p in FPE_PLAYED)]
    _fpe_years = sorted((y for y, n in Counter(year_of(FPE[p]) for p in FPE_PLAYED).items() if n >= 20),
                        reverse=True)
    # Level sessions go to the bigger Evaluation earner, level money to the
    # player with more sessions, and only then the bigger career earner.
    TIE_FPE_SESSIONS = 'Level ones go to more Performance Evaluation prize money, then to the bigger career earner.'
    TIE_FPE_MONEY = 'Level ones go to more sessions played, then to the bigger career earner.'
    for key, scope_text, pages in ([('all', ', all time', FPE_PLAYED)]
                                   + [(str(y), f' in {y}', [p for p in FPE_PLAYED if year_of(FPE[p]) == y])
                                      for y in _fpe_years]):
        modes = sorted({FPE[p].get('mode') for p in pages} & set(MODE_WORD), key=lambda m: TEAM_SIZE.get(m, 9))
        for server in [None] + FPE_SERVERS:
            here = [p for p in pages if not server or page_server(FPE[p]) == server]
            quals, prize = Counter(), Counter()
            for p in here:
                quals.update(fpe_there[p])
                prize.update(fpe_prize[p])
            fame = {k: -career.get(k, 0) for k in set(quals) | set(prize)}
            more = lambda counts: {k: -v for k, v in counts.items()}
            before = len(boards)
            tally_board(f"fpe:sessions:{key}:{server or 'world'}", 'Performance Evaluations',
                        f'Top 10 by Performance Evaluations played{scope_text}{where(server)}',
                        f'{the(server)}Performance Evaluation sessions played{scope_text}. {TIE_FPE_SESSIONS}',
                        quals, more(prize), count_fmt('session'), fame)
            tally_board(f"fpe:earnings:{key}:{server or 'world'}", 'Performance Evaluations',
                        f'Top 10 by Performance Evaluation earnings{scope_text}{where(server)}',
                        f'Prize money from {the(server)}Performance Evaluations{scope_text}. {TIE_FPE_MONEY}',
                        prize, more(quals), money, fame)
            # By format, where the scope had more than one - otherwise it is
            # the board above again.
            for mode in (modes if len(modes) > 1 else []):
                prize, played = Counter(), Counter()
                for p in here:
                    if FPE[p].get('mode') == mode:
                        prize.update(fpe_prize[p])
                        played.update(fpe_there[p])
                tally_board(f"fpe:earnings-{MODE_WORD[mode]}:{key}:{server or 'world'}",
                            'Performance Evaluations',
                            f'Top 10 by {mode.lower()} Performance Evaluation earnings{scope_text}{where(server)}',
                            f'Prize money from {the(server)}Performance Evaluations played in '
                            f'{MODE_WORD[mode]}{scope_text}. {TIE_FPE_MONEY}',
                            prize, more(played), money, fame)
            div_built['evaluations'] += len(boards) - before

    # List's Div Cup and Evaluation lists, written into facts.json below. A
    # threshold list takes the two highest steps that still name eight players,
    # so the lists move with the data instead of going stale.
    PLAYER_LISTS = []

    def add_list(lid, title, subtitle, keys):
        PLAYER_LISTS.append({'id': lid, 'title': title, 'subtitle': subtitle,
                             'players': sorted(k for k in keys if not unnamed(k))})

    def threshold_lists(lid, title, subtitle, counts, steps):
        named_counts = [v for k, v in counts.items() if not unnamed(k)]
        picked = [x for x in steps if sum(1 for v in named_counts if v >= x) >= 8][-2:]
        for x in picked:
            add_list(f'{lid}:{x}', title(x), subtitle, [k for k, v in counts.items() if v >= x])

    for server in [None] + DIV_SERVERS:
        pages = div_pages(WEEKS, server)
        quals, wins = Counter(), Counter()
        for p in pages:
            quals.update(div_there[p])
            wins.update(k for r, members in div_ranked[p] if r == 1 for k in members)
        tag = f':{server}' if server else ''
        threshold_lists(f'divcup-finals{tag}', lambda x: f'Players with {x}+ {the(server)}Div Cup finals',
                        'Chapters 6 and 7, Practice Cups included' + (
                            '' if server else "; every region's final counts, so two in one week is two"),
                        quals, range(10, 200, 10))
        if not server:
            threshold_lists('divcup-wins', lambda x: f'Players with {x}+ Div Cup wins',
                            'Div Cup finals won in any region, Chapters 6 and 7', wins, (2, 3, 5, 8, 12, 20, 30))
            continue
        add_list(f'divcup-won:{server}', f'Div Cup winners — {server}',
                 'Won a Div Cup final in this region, duos or trios, Practice Cups included', set(wins))
        for mode in ('Duo', 'Trio'):
            add_list(f'divcup-won:{server}:{MODE_WORD[mode]}', f'{mode} Div Cup winners — {server}',
                     f'Won a {mode.lower()} Div Cup final in this region',
                     {k for p in pages if DIV[p].get('mode') == mode
                      for r, members in div_ranked[p] if r == 1 for k in members})

    # Every Div Cup final won, with its day and region, into facts.json as
    # `divcups`: Tenite's first and last winners boards are built from it in
    # the browser (the user, 14 Oct 2026: "Last 10 different players to win eu
    # div cup", by region and by year). A winner with no Liquipedia page stays
    # '?Name', so the browser can tell a board it cannot fill. A final with a
    # shared first place, or none yet, is left out.
    DIVCUP_WINS = []
    for w in WEEKS:
        for p in _weeks[w]:
            firsts = [members for r, members in div_ranked[p] if r == 1]
            if len(firsts) != 1:
                continue
            DIVCUP_WINS.append({'date': day_of(DIV[p]), 'region': page_server(DIV[p]), 'season': w[0],
                                'practice': w[1], 'week': w[2], 'mode': DIV[p].get('mode'),
                                'players': list(firsts[0])})
    DIVCUP_WINS.sort(key=lambda win: (win['date'] or '', win['region']))

    # "Played every one of them", split by region: year-wide, the FNCS lists
    # ran to 367 names and the Div Cup ones to 384, too many for 90 seconds
    # (the user, 1 Oct 2026). A player at every round, in whichever regions,
    # is listed under the region where they played the most of them - in 2023
    # that puts North America's regulars under NA Central, two of its three
    # rounds - and one level between two regions is on both.
    every_n = lambda n, word: f'Both {word}' if n == 2 else f'All {n} {word}'
    # "Most of them" of two is one, for a player who split them.
    most_in = lambda n, server: f'at least one in {server}' if n == 2 else f'most of them in {server}'

    def every_by_region(lid, title, subtitle, rounds):
        """`rounds` is [{region: everyone there}], one per round."""
        everyone = set.intersection(*(set().union(*r.values()) for r in rounds))
        played = defaultdict(Counter)
        for r in rounds:
            for server, there in r.items():
                for k in there & everyone:
                    played[k][server] += 1
        listed = defaultdict(set)
        for k, per_server in played.items():
            most = max(per_server.values())
            for server, n in per_server.items():
                if n == most:
                    listed[server].add(k)
        for server in SERVERS:
            if listed[server]:
                add_list(f'{lid}:{server}', f'{title} — {server}', subtitle(server), listed[server])

    for season in _seasons:
        weeks = [w for w in WEEKS if w[0] == season]
        practice = ', Practice Cups included' if any(w[1] for w in weeks) else ''
        every_by_region(f'divcup-every:{season}', f'Players who played every Div Cup final of {season}',
                        lambda server: f"{every_n(len(weeks), 'weeks')}{practice}, {most_in(len(weeks), server)}",
                        [{page_server(DIV[p]): div_there[p] for p in _weeks[w]} for w in weeks])

    # The FNCS by year, the same way. 2019 had two rounds, Season X and C2S1,
    # so its list asks for the World Cup finals as well, solo or duos - and at
    # 65 names it stays one list.
    fncs_there = defaultdict(set)
    for t, _r, _m, pages in PLACED:
        if t['name'] in AVERAGED:
            fncs_there[t['name']].update(pg for pg, _team in pages)
    for year in sorted({y for y, _, _ in ROUNDS}):
        rounds = [{server: set().union(*(fncs_there[n] for n in finals)) for server, finals in by_server.items()}
                  for y, _m, by_server in ROUNDS if y == year]
        cup = [n for n in YEAR_LANS[year] if 'World Cup Finals' in n]
        if cup:
            add_list(f'fncs-every:{year}',
                     f'Players who played the World Cup and every FNCS grand final of {year}',
                     f"{every_n(len(rounds), 'rounds')}, each in the player’s own region, and the World Cup "
                     f'finals, solo or duos',
                     set.intersection(*(set().union(*r.values()) for r in rounds))
                     & set().union(*(fncs_there[n] for n in cup)))
            continue
        every_by_region(f'fncs-every:{year}', f'Players who played every FNCS grand final of {year}',
                        lambda server: f"{every_n(len(rounds), 'rounds')}, {most_in(len(rounds), server)}", rounds)
    for server in [None] + FPE_SERVERS:
        quals = Counter()
        for p in FPE_PLAYED:
            if not server or page_server(FPE[p]) == server:
                quals.update(fpe_there[p])
        threshold_lists(f"fpe-sessions{f':{server}' if server else ''}",
                        lambda x: f'Players with {x}+ {the(server)}Performance Evaluations',
                        'Performance Evaluation sessions played since 2023', quals, range(20, 400, 20))

    _repeat = sum(1 for p in DIV if len({r for r, _ in div_ranked[p]}) < len(div_ranked[p]))
    print(f'Div Cups: {len(DIV)} finals in {len(WEEKS)} weeks, {_repeat} with a place given twice; '
          f'Evaluations: {len(FPE_PLAYED)} sessions in {FPE_SERVERS}; boards {dict(div_built)}; '
          f'{len(PLAYER_LISTS)} lists for List')
    if AVG_UNNAMED:
        print(f'  {len(AVG_UNNAMED)} left out, a top-11 entrant the roster cannot name:', AVG_UNNAMED)

    # ------------------------------------------------- player: region / country --
    region_of_page  = {p['pagename']: p.get('region') for p in PLAYABLE}
    country_of_page = {p['pagename']: (p.get('nationalities') or [None])[0] for p in PLAYABLE}
    REGIONS = sorted({r for r in region_of_page.values() if r})

    for reg in REGIONS:
        sub = Counter({k: v for k, v in career.items() if region_of_page.get(k) == reg})
        board(f'region-earnings:{reg}', 'By region',
              f'Top 10 career earnings — {reg}', 'player', TIE_MONEY, rank(sub, NAME), money)
        for y in YEARS:
            sub = Counter({k: v for k, v in year_earn[y].items() if region_of_page.get(k) == reg})
            board(f'region-year-earnings:{reg}:{y}', 'By region',
                  f'Top 10 earners in {y} — {reg}', 'player', TIE_MONEY, rank(sub, NAME), money)

    # Only countries deep enough to field a real top ten.
    by_country = defaultdict(Counter)
    for page, v in career.items():
        c = country_of_page.get(page)
        if c:
            by_country[c][page] = v
    for c, sub in by_country.items():
        board(f'country-earnings:{c}', 'By country',
              f'Top 10 career earnings — {c}', 'player', TIE_MONEY, rank(sub, NAME), money)

    # --------------------------------------------------------------- teammates --
    # Anchors people would actually recognise: the biggest earners.
    # Level counts go to the partner of the bigger events: more majors - FNCS
    # finals and the LANs - played on one team.
    mates = defaultdict(Counter)
    mates_majors = defaultdict(Counter)
    for t, r, m, pages in PLACED:
        ids = sorted({pg for pg, _ in pages})
        if len(ids) > 1:
            for a, b in itertools.combinations(ids, 2):
                mates[a][b] += 1; mates[b][a] += 1
                if t['name'] in MAJORS:
                    mates_majors[a][b] += 1; mates_majors[b][a] += 1
    anchors = [p for p, _ in career.most_common(60)]
    for a in anchors:
        board(f'teammates:{a}', 'Teammates',
              f'Top 10 most frequent teammates of {NAME(a)}', 'player',
              'Ranked by tournaments entered together. '
              + tie_text('more majors played together (FNCS finals and LANs)'),
              rank_by(mates[a], mates_majors[a].__getitem__), count('tournament'))

    # ----------------------------------------------------------- one tournament --
    # Epic's LANs (the Globals, the World Cup finals, the Invitational, the Summit),
    # and below them FNCS grand finals by region.
    #
    # A row per finishing *position*, not per player. These events are played in
    # duos and trios, so 1st place is two or three people and the slot only fills
    # once every one of them has been named — which is what `members` carries.
    #
    # Ranking players instead is what used to lose whole events: at a trios Globals
    # the top three places are nine players, so 10th and 11th were both the
    # fourth-placed trio, the "no single right answer" guard fired and FNCS 2025
    # Global Championship shipped no board at all. By place there is no such tie,
    # and the trio is the answer rather than an accident of the alphabet.
    # `team_name` is defined with the averages, above.
    def team_row(place, team):
        pages = sorted(team, key=lambda pg: NAME(pg).lower())
        return {'key': '|'.join(sorted(team)), 'label': team_name(team),
                'value': place, 'display': f'{place}',
                'members': [{'key': pg, 'label': NAME(pg)} for pg in pages]}

    # FNCS grand finals too (26 Sep 2026), by region: every European and North
    # American final, and the other regions' 2025 and 2026 finals plus the 2021
    # Grand Royale. The Globals, the Invitational and the Summit are LANs and
    # already above. Newest first inside each group — the season people remember
    # is the one at the top.
    FNCS_GROUPS = ['FNCS finals — Europe', 'FNCS finals — North America',
                   'FNCS finals — other regions']

    def fncs_group(t):
        region = region_of(t)
        if region == 'Europe':
            return FNCS_GROUPS[0]
        if region == 'North America':
            return FNCS_GROUPS[1]
        if year_of(t) in (2025, 2026) or 'Grand Royale' in t['name']:
            return FNCS_GROUPS[2]
        return None

    def fncs_short(name):
        """'FNCS 2025 - Major 3: Europe - Grand Finals' -> 'FNCS 2025 - Major 3: Europe'."""
        s = re.sub(r'\s*[-–:]?\s*Grand Finals?\s*[-–:]?\s*', ' ', name, flags=re.I)
        s = re.sub(r'\s{2,}', ' ', s).strip()
        return re.sub(r'[-–:]\s*$', '', s).strip()

    fncs_events = [n for n in FNCS - LANS if fncs_group(tour_of[n])]
    fncs_events.sort(key=lambda n: (str(tour_of[n].get('startdate') or ''), n), reverse=True)
    fncs_events.sort(key=lambda n: FNCS_GROUPS.index(fncs_group(tour_of[n])))

    # (tournament, group, the name in the title)
    EVENT_BOARDS = ([(n, 'Tournaments', n) for n in sorted(LANS)] +
                    [(n, fncs_group(tour_of[n]), fncs_short(n)) for n in fncs_events])
    wanted_events = {n for n, _, _ in EVENT_BOARDS}

    # Straight off `placements` rather than PLACED, which drops the participants it
    # cannot resolve: a team missing a member is a slot nobody can close, and the
    # board has to be able to see that and refuse.
    event_places = defaultdict(lambda: defaultdict(list))
    for row in placements:
        n = row.get('tournament')
        if n not in wanted_events:
            continue
        r = rank_of(row.get('placement'))
        if r is None:
            continue
        event_places[n][r].append([resolve(p.get('player') or '')
                                   for p in (row.get('participants') or [])])

    event_skipped = Counter()
    for n, group, shown in EVENT_BOARDS:
        places = sorted(event_places[n])[:SLOTS + 1]
        teams = [event_places[n][p][0] if len(event_places[n][p]) == 1 else [] for p in places]
        if len(places) < SLOTS + 1 or any(not t or not all(t) for t in teams):
            event_skipped[group] += 1
            continue     # fewer than 11 placements, two teams on one place, or a
                         # member this export cannot name — see the note above
        named = [pg for t in teams for pg in t]
        if len(set(named)) != len(named):
            event_skipped[group] += 1
            continue     # the same player twice in the eleven — no single right answer
        spare = team_row(places[SLOTS], teams[SLOTS])
        del spare['display']             # the 11th is a near-miss test, never shown
        solo = max(len(t) for t in teams) == 1
        boards.append({
            'id': f'tournament:{n}', 'group': group,
            'title': f'Top 10 at {shown}', 'entity': 'player',
            'tieRule': 'Ranked by finishing position at this event.' if solo else
                       ('Ranked by finishing position at this event. Each place is a '
                        'team, and it only fills once every player on it is named.'),
            'rows': [team_row(p, t) for p, t in zip(places[:SLOTS], teams[:SLOTS])],
            'next': spare,
            'lowerIsBetter': True,
        })

    # ---------------------------------------------------------------- orgs --
    org_name = {o['id']: o['name'] for o in orgs_payload['orgs']}
    ORG = lambda k: org_name.get(k, k)
    board('org-earnings', 'Organisations', 'Top 10 organisations by total earnings',
          'org', TIE_MONEY, rank(org_earn, ORG), money)
    board('org-majors', 'Organisations', 'Top 10 organisations by major wins',
          'org', 'Ranked by wins at Epic-run majors. Organisations level on the count '
          'are ranked by their own prize money.',
          rank_fame(org_majors, ORG, org_earn.get), count('win'))
    for y in YEARS:
        board(f'org-year-earnings:{y}', 'Organisations',
              f'Top 10 organisations by earnings in {y}', 'org', TIE_MONEY,
              rank(org_year[y], ORG), money)

    # ------------------------------------------------------------- countries --
    CT = lambda c: c
    country_total = Counter()
    country_year  = defaultdict(Counter)
    country_fncs  = Counter()
    for p in PLAYABLE:
        c = (p.get('nationalities') or [None])[0]
        if not c:
            continue
        country_total[c] += float(p['earnings'] or 0)
        country_fncs[c]  += p['fncs_wins']
        for y in YEARS:
            country_year[y][c] += float(p.get(f'earnings_{y}') or 0)

    board('country-total-earnings', 'Countries', 'Top 10 countries by player earnings',
          'country', TIE_MONEY, rank(country_total, CT), money)
    country_winners = Counter((p.get('nationalities') or [None])[0] for p in PLAYABLE if p['fncs_wins'])
    board('country-fncs-wins', 'Countries', 'Top 10 countries by FNCS wins',
          'country', 'Every FNCS title won by a player of that nationality. Countries '
          'level on the count are ranked by how many different players won them, then '
          "by their players' total earnings.",
          sorted(((c, c, v, country_winners[c], country_total[c]) for c, v in country_fncs.items() if v > 0),
                 key=lambda e: (-e[2], -e[3], -e[4], e[1].lower())),
          count('title'))
    for y in YEARS:
        board(f'country-year-earnings:{y}', 'Countries',
              f'Top 10 countries by earnings in {y}', 'country', TIE_MONEY,
              rank(country_year[y], CT), money)
    for reg in REGIONS:
        sub = Counter()
        for p in PLAYABLE:
            c = (p.get('nationalities') or [None])[0]
            if c and p.get('region') == reg:
                sub[c] += float(p['earnings'] or 0)
        board(f'region-country-earnings:{reg}', 'Countries',
              f'Top 10 countries by earnings — {reg}', 'country', TIE_MONEY,
              rank(sub, CT), money)

    payload = {'generated': TODAY, 'slots': SLOTS, 'boards': boards}
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(',', ':'))

    print(f'{len(boards)} boards, {os.path.getsize(OUT)/1e6:.2f} MB')
    print(Counter(b['group'] for b in boards))
    print('tournaments left out (under 11 places, a shared place, or a finisher the roster cannot name):',
          dict(event_skipped))
    for bid in ('career-earnings', 'lan-earnings', 'fncs-apps', 'org-earnings',
                'country-total-earnings'):
        b = next((x for x in boards if x['id'] == bid), None)
        print(f"\n{bid}:" if b else f"\n{bid}: MISSING")
        if b:
            for row in b['rows'][:5]:
                print(f"   {row['label']:<22} {row['display']}")

    # ======================================================================
    # Cell 3 — earnings by game mode
    # ======================================================================
    print()
    print('Cell 3 — earnings by game mode')
    from collections import Counter

    # (value in `opponenttype`, the word to put in the board title).
    # The export spells the four-player format "Quad"; everyone calls it squads,
    # so the data key and the label are kept apart. The other values in the column
    # are "Team" (1,711 rows, mixed team-vs-team events) which is not a format
    # anyone would ask about, and blanks.
    MODES = [('Solo', 'solo'), ('Duo', 'duo'), ('Trio', 'trio'), ('Quad', 'squad')]
    mode_earn = {key: Counter() for key, _ in MODES}

    for row in placements:
        mode = (row.get('opponenttype') or '').strip().title()
        if mode not in mode_earn:
            continue
        parts = row.get('participants') or []
        if not parts:
            continue
        # `individualprizemoney` is per player where the export gives it; where it
        # is 0 the team total is split evenly, which is what Liquipedia's own
        # per-player figures do.
        each = float(row.get('individualprizemoney') or 0)
        if each <= 0:
            each = float(row.get('prizemoney') or 0) / len(parts)
        if each <= 0:
            continue
        for part in parts:
            page = resolve(part.get('player') or '')
            if page:
                mode_earn[mode][page] += each

    for key, word in MODES:
        board(f'mode-earnings-{word}', 'Players',
              f'Top 10 by {word} earnings', 'player',
              f'Prize money won in {word} events only. A player appears on several '
              f'of these boards — the money is split by the format each result was '
              f'played in.',
              rank(mode_earn[key], NAME), money)
        print(f'{word:<6} {len(mode_earn[key]):>5} players with earnings')

    payload = {'generated': TODAY, 'slots': SLOTS, 'boards': boards}
    with open(f'{BASE}/rankings.json', 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(',', ':'))
    print('\nrewrote rankings.json —', len(boards), 'boards')

    # ======================================================================
    # Cell 4 — sixty-six more categories
    # ======================================================================
    print()
    print('Cell 4 — sixty-six more categories')
    import bisect
    from datetime import date as _date

    OUT = f'{BASE}/rankings.json'

    TIE_FAME = ('Level counts are split by career earnings, so of two players on the '
                'same number the bigger earner ranks higher.')
    TIE_RICH = ('Countries level on count are ordered by total career earnings, '
                'so the bigger-earning country ranks higher.')

    def phrase(one, many):
        """`count` from cell 2 pluralises by adding an s, which gives "15 finishs"
        and "26 in a rows". These boards spell both forms out."""
        return lambda v: f'{v:,.0f} {one if v == 1 else many}'

    # `day_of` and `days_apart` come from cell 1, with the FNCS waves.
    # `rank_fame` comes from cell 2, where the count boards it was written for are.

    # ============================================================ player counts ==
    wins_any, wins_offline = Counter(), Counter()
    fncs_top5, fncs_apps_all = Counter(), Counter()

    # "LAN wins" wants more than the nine events `is_lan` keeps - that filter is
    # Epic-run tier-1 finals only, and it is deliberately left alone because
    # facts.json, List, Griefer and Tic Tac Toe are all built on it. This is a local
    # widening for one board: every offline main event in the top two tiers, which
    # is what people mean by a LAN and includes DreamHack, Gamers8 and the EWC.
    OFFLINE = {t['name'] for t in tournaments
               if t.get('type') in ('Offline', 'Hybrid')
               and t.get('liquipediatier') in (1, 2)
               and t.get('liquipediatiertype') is None}

    # Podiums for the tiebreaks (cell 2's `rank_by`): anywhere, and at these offline events.
    top3_any, top3_offline, fncs_firsts = Counter(), Counter(), Counter()
    for t, r, m, pages in PLACED:
        n = t['name']
        for page, _ in pages:
            if r == 1:
                wins_any[page] += 1
                if n in OFFLINE:
                    wins_offline[page] += 1
                if n in FNCS:
                    fncs_firsts[page] += 1
            if r is not None and r <= 3:
                top3_any[page] += 1
                if n in OFFLINE:
                    top3_offline[page] += 1
            if n in FNCS:
                fncs_apps_all[page] += 1
                if r is not None and r <= 5:
                    fncs_top5[page] += 1

    board('tournament-wins', 'Players', 'Top 10 by tournaments won', 'player',
          'Every tournament on record, from a Global Championship to a $50 cup - '
          'first place only. ' + tie_text('more top-3 finishes'),
          rank_by(wins_any, top3_any.__getitem__), count('win'))
    board('lan-wins', 'Players', 'Top 10 by LAN wins', 'player',
          'Offline main events in the top two tiers, so the Globals and the World '
          'Cup but also DreamHack, Gamers8 and the Esports World Cup. '
          + tie_text('more podiums at those events'),
          rank_by(wins_offline, top3_offline.__getitem__), count('win'))
    board('fncs-top5', 'Players', 'Top 10 by top-5 finishes at FNCS finals', 'player',
          'Fifth or better at an FNCS grand final, counting every season and region. '
          + tie_text('more top-3 finishes', 'more wins'),
          rank_by(fncs_top5, podiums('fncs'), fncs_firsts.__getitem__),
          phrase('top-5 finish', 'top-5 finishes'))

    fncs_titles = {p['pagename']: p['fncs_wins'] for p in PLAYABLE}
    board('fncs-finals-no-title', 'Players',
          'Top 10 by FNCS grand finals without ever winning one', 'player',
          'Grand finals reached by players whose FNCS title count is still zero. '
          'One win and you leave this board for good. '
          + tie_text('more podiums in those finals', 'the better average finish in them'),
          rank_by(Counter({k: v for k, v in fncs_apps_all.items() if not fncs_titles.get(k)}),
                  podiums('fncs'), avg_finish('fncs')),
          count('final'))
    board('earnings-no-fncs', 'Players', 'Top 10 earners who have never won an FNCS',
          'player', 'Career prize money, among players with no FNCS title. ' + TIE_MONEY,
          rank(Counter({k: v for k, v in career.items() if not fncs_titles.get(k)}), NAME), money)

    # ============================================== FNCS waves: streaks, chapters ==
    # The waves themselves - one round of FNCS grand finals each - are cell 1's
    # WAVES and wave_of.

    # Chapters come out of the export's own names: thousands of community events are
    # called "C6S2" or "Chapter 5 Season 1", so the chapter of any date is whatever
    # the events around it call themselves. Nothing is hardcoded, which matters
    # because the FNCS stopped putting the chapter in its own name after 2022.
    _CH_PREFIX, _CH_WORDS = re.compile(r'\bC(\d)S\d+\b'), re.compile(r'\bChapter\s+(\d+)\b', re.I)
    _marked = []
    for t in tournaments:
        _m = _CH_PREFIX.search(str(t.get('name') or '')) or _CH_WORDS.search(str(t.get('name') or ''))
        if _m and day_of(t):
            _marked.append((day_of(t), int(_m.group(1))))
    _marked.sort()

    def chapter_at(day, window=45):
        """The chapter the scene was in on `day`, by majority vote of the events
        around it. Before the first event that names a chapter at all, it is the one
        before that - Chapter 1 predates the convention."""
        if day < _marked[0][0]:
            return _marked[0][1] - 1
        near = [c for d, c in _marked if abs(days_apart(d, day)) <= window]
        return Counter(near).most_common(1)[0][0] if near else None

    played_waves, won_waves, chapters_won = defaultdict(set), defaultdict(set), defaultdict(set)
    for t, r, m, pages in PLACED:
        w = wave_of.get(t['name'])
        if w is None:
            continue
        ch = chapter_at(day_of(t))
        for page, _ in pages:
            played_waves[page].add(w)
            if r == 1:
                won_waves[page].add(w)
                chapters_won[page].add(ch)

    def longest_run(seen, universe=None):
        best = run = 0
        for i in (universe if universe is not None else range(len(WAVES))):
            run = run + 1 if i in seen else 0
            best = max(best, run)
        return best

    board('fncs-streak-finals', 'Players',
          'Top 10 by consecutive FNCS grand finals qualified for', 'player',
          "The longest run of FNCS grand finals in a row, counting every region's "
          'own final as one round. Miss a round and the run starts again. '
          + tie_text('the better average FNCS finish'),
          rank_by(Counter({p: longest_run(s) for p, s in played_waves.items()}), avg_finish('regional')),
          phrase('final in a row', 'finals in a row'))
    titles = lambda page: fncs_titles.get(page, 0)
    board('fncs-streak-wins', 'Players', 'Top 10 by consecutive FNCS titles', 'player',
          "Winning your region's grand final in consecutive rounds of the FNCS. "
          'A Globals or a LAN in between is not an FNCS round, so losing one does not '
          'end the run - the consecutive major titles board counts those. '
          + tie_text('more FNCS titles in all', 'more FNCS podiums'),
          rank_by(Counter({p: longest_run(s) for p, s in won_waves.items()}), titles, podiums('regional')),
          phrase('title in a row', 'titles in a row'))
    board('fncs-chapters', 'Players', 'Top 10 by FNCS titles across different chapters',
          'player',
          'How many different chapters of Fortnite a player has won an FNCS in - '
          'three titles in one chapter counts once. '
          + tie_text('more FNCS titles in all', 'more FNCS podiums'),
          rank_by(Counter({p: len(s) for p, s in chapters_won.items()}), titles, podiums('regional')),
          count('chapter'))

    # ==================================================== age at a major win =====
    birthday = {p['pagename']: str(p['birthdate'])[:10] for p in PLAYABLE
                if p.get('birthdate') and re.match(r'^\d{4}-\d{2}-\d{2}$', str(p['birthdate'])[:10])}
    major_win_days = defaultdict(list)
    for t, r, m, pages in PLACED:
        if t['name'] in MAJORS and r == 1 and day_of(t):
            for page, _ in pages:
                major_win_days[page].append(day_of(t))

    AGE_TEXT = {}        # whole days -> "13 years 103 days"

    def age_days(page, day):
        """Age in whole days, so the order is the real one and only players who
        share a birthday can tie.

        The spelled-out form is worked out here, from the two real dates, and filed
        under the day count: a year is not 365 days and rounding one is how a board
        ends up claiming somebody won at "13 years 365 days"."""
        born = birthday[page]
        b, d = _date.fromisoformat(born), _date.fromisoformat(day)
        y = d.year - b.year - ((d.month, d.day) < (b.month, b.day))
        try:
            anniversary = b.replace(year=b.year + y)
        except ValueError:                      # born on 29 February
            anniversary = _date(b.year + y, 3, 1)
        days = (d - b).days
        AGE_TEXT.setdefault(days, f'{y} years {(d - anniversary).days} days')
        return days

    def spell_age(days):
        return AGE_TEXT[days]

    _won = {p: sorted(ds) for p, ds in major_win_days.items() if p in birthday}
    first_win = {p: age_days(p, ds[0]) for p, ds in _won.items()}
    young_win = {p: min(age_days(p, d) for d in ds) for p, ds in _won.items()}
    old_win = {p: max(age_days(p, d) for d in ds) for p, ds in _won.items()}

    def by_age(d, oldest_first):
        return sorted(((k, NAME(k), v) for k, v in d.items() if v > 0),
                      key=lambda e: (-e[2] if oldest_first else e[2], e[1].lower()))

    board('youngest-major-win', 'Players', 'Top 10 youngest ever to win a major',
          'player',
          'Age on the first day of the event, for every Epic-run tier-1 final since '
          'the World Cup. Players with no published birthday cannot be ranked.',
          by_age(young_win, False), spell_age)
    board('oldest-major-win', 'Players', 'Top 10 oldest ever to win a major', 'player',
          'The same list read from the other end: the oldest anyone has been on the '
          'day they won an Epic-run tier-1 final.',
          by_age(old_win, True), spell_age)
    board('oldest-first-major-win', 'Players', 'Top 10 oldest to win a first major',
          'player',
          'Age at a maiden title rather than at any title, so a long wait counts and '
          'a long career does not.', by_age(first_win, True), spell_age)

    # ========================================== per-country, active players only ==
    # The all-time country boards above are monuments to the 2019 World Cup. These
    # ask who is winning money there now.
    active_pages = {p['pagename'] for p in PLAYABLE if str(p.get('status') or '').lower() == 'active'}
    _active_country = defaultdict(Counter)
    for page, v in career.items():
        c = country_of_page.get(page)
        if c and page in active_pages:
            _active_country[c][page] = v
    for c, sub in sorted(_active_country.items()):
        board(f'country-earnings-active:{c}', 'By country',
              f'Top 10 career earnings - {c}, active players only', 'player',
              'Career prize money, counting only players the export still lists as '
              'active. Retired names are not answers here. ' + TIE_MONEY,
              rank(sub, NAME), money)

    # ========================================== duos that lasted, major by major ==
    # A team board: the row is a pair, and it only fills once both are named.
    _major_days = sorted((day_of(tour_of[n]), n) for n in MAJORS if day_of(tour_of[n]))
    _mclusters, _cur = [], []
    for _d, _n in _major_days:
        if _cur and days_apart(_cur[-1][0], _d) > 7:
            _mclusters.append(_cur)
            _cur = []
        _cur.append((_d, _n))
    if _cur:
        _mclusters.append(_cur)
    mwave_of = {n: i for i, c in enumerate(_mclusters) for _, n in c}

    pair_waves, solo_waves = defaultdict(set), defaultdict(set)
    for t, r, m, pages in PLACED:
        w = mwave_of.get(t['name'])
        if w is None:
            continue
        ids = sorted({pg for pg, _ in pages})
        for pg in ids:
            solo_waves[pg].add(w)
        for a, b in itertools.combinations(ids, 2):
            pair_waves[(a, b)].add(w)

    def together_run(pair, shared):
        """Consecutive majors played side by side, counted over the majors either of
        them entered. Sitting one out together does not break it; turning up with
        somebody else does."""
        a, b = pair
        return longest_run(shared, sorted(solo_waves[a] | solo_waves[b]))

    # Level runs fall to the pair's combined career earnings before the names.
    _pair_money = lambda pair: sum(career.get(pg, 0) for pg in pair)
    _duos = sorted(((p, together_run(p, s)) for p, s in pair_waves.items() if len(s) >= 3),
                   key=lambda e: (-e[1], -_pair_money(e[0]), NAME(e[0][0]).lower(),
                                  NAME(e[0][1]).lower()))
    # One duo per player: their longest. Kami ran with Setty and with charyy, and
    # with both pairs in the eleven, naming Kami answered two slots at once - the
    # same "a player listed twice" the tournament boards are skipped for.
    _seen_pages = set()
    _duos = [e for e in _duos
             if not (_seen_pages & set(e[0])) and not _seen_pages.update(e[0])]
    _duo_level = len(_duos) >= SLOTS + 1 and (
        _duos[SLOTS - 1][1] == _duos[SLOTS][1]
        and _pair_money(_duos[SLOTS - 1][0]) == _pair_money(_duos[SLOTS][0]))
    if _duo_level:
        LEVEL_AT_CUT.append('duo-longevity')
    if len(_duos) >= SLOTS + 1 and not _duo_level:
        def duo_row(pair, value):
            a, b = sorted(pair, key=lambda pg: NAME(pg).lower())
            return {'key': '|'.join(sorted(pair)), 'label': f'{NAME(a)} & {NAME(b)}',
                    'value': value, 'display': count('major')(value),
                    'members': [{'key': a, 'label': NAME(a)}, {'key': b, 'label': NAME(b)}]}
        _spare = duo_row(*_duos[SLOTS])
        _spare.pop('display')
        boards.append({
            'id': 'duo-longevity', 'group': 'Teammates',
            'title': 'Top 10 longest-running duos, major by major', 'entity': 'player',
            'tieRule': ('The longest run of consecutive majors a pair turned up to '
                        'together, counting the majors either of them entered. Both '
                        'names fill one slot. Pairs level on the run are ranked by '
                        'their combined career earnings.'),
            'rows': [duo_row(p, v) for p, v in _duos[:SLOTS]],
            'next': _spare,
        })

    # =============================================== countries, counted and sized ==
    country_money = Counter()
    for page, v in career.items():
        c = country_of_page.get(page)
        if c:
            country_money[c] += v

    for thr, word in ((100_000, '$100K'), (300_000, '$300K'), (500_000, '$500K'),
                      (1_000_000, '$1M')):
        c = Counter()
        for page, v in career.items():
            if v >= thr and country_of_page.get(page):
                c[country_of_page[page]] += 1
        board(f'country-over:{thr}', 'Countries',
              f'Top 10 countries by players over {word} in career earnings', 'country',
              f'How many individual players from each country have passed {word}. '
              + TIE_RICH,
              sorted(((k, k, v, country_money[k]) for k, v in c.items() if v > 0),
                     key=lambda e: (-e[2], -e[3], e[1].lower())),
              count('player'))

    # Resident populations, hand-entered from public 2024 estimates and rounded to
    # the nearest hundred thousand. Not from Liquipedia: the export has no such
    # column, and this is the one board that needs a number from outside it.
    # England, Scotland and Wales are separate nationalities in the export, so they
    # get separate populations rather than being folded into the United Kingdom.
    POPULATION = {
        'United States': 340, 'Canada': 41.3, 'Brazil': 212, 'Mexico': 130, 'Argentina': 46,
        'Chile': 19.8, 'Colombia': 52.3, 'Peru': 34.2, 'Uruguay': 3.4, 'Paraguay': 6.9,
        'Ecuador': 18.1, 'Venezuela': 28.4, 'Bolivia': 12.4, 'Costa Rica': 5.2, 'Panama': 4.5,
        'Guatemala': 18.1, 'El Salvador': 6.3, 'Honduras': 10.6, 'Nicaragua': 7,
        'Dominican Republic': 11.4, 'Cuba': 11, 'Puerto Rico': 3.2, 'Trinidad and Tobago': 1.5,
        'United Kingdom': 69.1, 'England': 57.1, 'Scotland': 5.5, 'Wales': 3.2,
        'Northern Ireland': 1.9, 'Ireland': 5.4, 'France': 68.4, 'Germany': 84.6,
        'Spain': 48.6, 'Italy': 58.9, 'Portugal': 10.6, 'Netherlands': 18, 'Belgium': 11.8,
        'Luxembourg': 0.67, 'Switzerland': 8.9, 'Austria': 9.2, 'Denmark': 6, 'Norway': 5.6,
        'Sweden': 10.6, 'Finland': 5.6, 'Iceland': 0.39, 'Poland': 36.7, 'Czechia': 10.9,
        'Slovakia': 5.4, 'Hungary': 9.6, 'Romania': 19, 'Bulgaria': 6.4, 'Greece': 10.4,
        'Croatia': 3.9, 'Slovenia': 2.1, 'Serbia': 6.6, 'Bosnia and Herzegovina': 3.2,
        'North Macedonia': 1.8, 'Albania': 2.7, 'Montenegro': 0.62, 'Kosovo': 1.6,
        'Malta': 0.56, 'Cyprus': 1.3, 'Estonia': 1.37, 'Latvia': 1.87, 'Lithuania': 2.86,
        'Belarus': 9.1, 'Ukraine': 37.9, 'Russia': 144, 'Moldova': 2.5, 'Georgia': 3.7,
        'Armenia': 3, 'Azerbaijan': 10.2, 'Kazakhstan': 20.3, 'Uzbekistan': 36.4,
        'Turkey': 85.7, 'Israel': 9.8, 'Palestine': 5.5, 'Lebanon': 5.4, 'Jordan': 11.5,
        'Syria': 24, 'Iraq': 45.5, 'Iran': 89.2, 'Yemen': 34.4, 'Saudi Arabia': 34,
        'United Arab Emirates': 11, 'Kuwait': 4.9, 'Bahrain': 1.6, 'Qatar': 3, 'Oman': 5.3,
        'Egypt': 114, 'Morocco': 37.8, 'Algeria': 46.3, 'Tunisia': 12.3, 'South Africa': 63,
        'Nigeria': 227, 'Kenya': 56.4, 'Ghana': 34.4, 'Uganda': 49, 'Namibia': 3,
        'Greenland': 0.057, 'India': 1441, 'China': 1411, 'Pakistan': 245, 'Bangladesh': 173,
        'Sri Lanka': 21.9, 'Cambodia': 17.6, 'Japan': 123, 'South Korea': 51.7, 'Taiwan': 23.4,
        'Hong Kong': 7.5, 'Singapore': 6, 'Malaysia': 34.6, 'Indonesia': 281,
        'Philippines': 118, 'Vietnam': 100, 'Thailand': 71.7, 'Australia': 27.1,
        'New Zealand': 5.3, 'Fiji': 0.93,
    }
    _nopop = sorted(c for c, v in country_money.items() if v > 0 and c not in POPULATION)
    if _nopop:
        print('no population on file for:', _nopop)
    board('country-per-capita', 'Countries',
          'Top 10 countries by earnings per resident', 'country',
          "Career prize money won by that country's players, divided by its "
          'population. Populations are public 2024 estimates typed in by hand - they '
          'are not part of the Liquipedia export.',
          sorted(((c, c, country_money[c] / (POPULATION[c] * 1_000_000))
                  for c in country_money if c in POPULATION and country_money[c] > 0),
                 key=lambda e: (-e[2], e[1].lower())),
          lambda v: f'${v:,.2f} per resident')

    # ================================================= the paydays of the famous ==
    # Answered with a tournament rather than a player, which is a first: the board
    # asks where the money came from. Names are shortened to the event rather than
    # the region's own page ("C3S1: FNCS", not "C3S1: FNCS - Grand Finals: NA East"),
    # because the region is not what anyone remembers and it is never the question.
    _REGION_TAIL = re.compile(
        r'\s*[-:]\s*(NA East|NA West|NA Central|North America East|North America West|'
        r'North America Central|North America|Europe|Asia|Brazil|Middle East|Oceania|'
        r'World|Global)\s*$', re.I)
    _FINALS = re.compile(r'\s*[-:]?\s*Grand Finals?\s*[-:]?\s*', re.I)

    def short_event(name):
        s, prev = name, None
        while prev != s:
            prev = s
            s = _REGION_TAIL.sub('', s).strip().rstrip('-:').strip()
            s = _FINALS.sub(' ', s).strip().rstrip('-:').strip()
        return re.sub(r'\s{2,}', ' ', s)

    paydays = defaultdict(Counter)
    # When each shortened event last paid out, so two level paydays can be split by
    # date rather than by name: C2S7 and FNCS 2023 - Major 3 paid Kami the same.
    payday_last = defaultdict(dict)
    for t, r, m, pages in PLACED:
        if m <= 0:
            continue
        for page, _ in pages:
            name = short_event(t['name'])
            paydays[page][name] += m
            day = day_of(t)
            when = _date.fromisoformat(day).toordinal() if day else 0
            payday_last[page][name] = max(when, payday_last[page].get(name, 0))
    for page, _ in career.most_common(20):
        board(f'paydays:{page}', 'Paydays', f'Top 10 biggest paydays - {NAME(page)}',
              'tournament',
              f'The ten tournaments {NAME(page)} earned the most at, by prize money '
              'from that one event. A regional final is named by the event rather '
              'than the region. Level paydays are ordered by date, the more recent '
              'first.',
              sorted(((n, n, v, payday_last[page].get(n, 0)) for n, v in paydays[page].items()
                      if v > 0),
                     key=lambda e: (-e[2], -e[3], e[1].lower())),
              money)

    # Everything answerable on a paydays board, so the guess box has somewhere to
    # search that is not the answer sheet. Tier 1-2 only: 735 names is a list, the
    # whole export is a phone book.
    TOURNAMENT_POOL = {short_event(t['name']) for t in tournaments
                       if t.get('liquipediatier') in (1, 2)}
    # Plus any answer that falls outside those two tiers - a payday from a 2018
    # skirmish, mostly. An answer you cannot type is the same bug as a wrong answer.
    for b in boards:
        if b['entity'] == 'tournament':
            TOURNAMENT_POOL.update(r['key'] for r in b['rows'] + [b['next']])
    TOURNAMENT_POOL = sorted(TOURNAMENT_POOL)

    payload = {'generated': TODAY, 'slots': SLOTS, 'boards': boards,
               'tournaments': TOURNAMENT_POOL}
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(',', ':'))

    print(f'{len(boards)} boards, {len(TOURNAMENT_POOL)} tournament names, '
          f'{os.path.getsize(OUT)/1e6:.2f} MB')
    print(f'{len(LEVEL_AT_CUT)} boards left out, level at the cut:', LEVEL_AT_CUT)
    print(Counter(b['group'] for b in boards))

    # ======================================================================
    # Cell 5 — pools.json
    # ======================================================================
    print()
    print('Cell 5 — pools.json')
    OUT = f'{BASE}/pools.json'

    WANTED = [
        ('globals-2026', 'FNCS 2026 Globals', 'FNCS 2026  Global Championship',
         'The field for the Global Championship in Europe, 26–27 September 2026.'),
        # ('ewc-2026', 'EWC 2026', 'Reload Elite Series 2026 - Championship',
        #  'The field for the Esports World Cup Fortnite event, August 2026.'),
        # Note the double space in the 2024/2025/2026 names — that is how the
        # export spells them. The 2023 one has a single space.
        # ('globals-2025', 'FNCS 2025 Globals', 'FNCS 2025  Global Championship',
        #  'The field for the Global Championship, September 2025.'),
        # ('globals-2024', 'FNCS 2024 Globals', 'FNCS 2024  Global Championship',
        #  'The field for the Global Championship, September 2024.'),
        # ('globals-2023', 'FNCS 2023 Globals', 'FNCS 2023 Global Championship',
        #  'The field for the Global Championship, October 2023.'),
        # ('world-cup-2019', 'World Cup 2019', 'Fortnite World Cup Finals - Solo',
        #  'The solo field at the 2019 Fortnite World Cup, July 2019.'),
        # The 2026 Solo FNCS (the user, 22 Oct 2026: "add common categories for
        # this tournament, it's not done yet"): its seven regional grand finals
        # as one field, a pattern rather than one event name. Its boards are a
        # Tenite group of their own outside event mode (`FIELD_POOLS` in
        # pool-boards.ts). Seven regions' places are not one leaderboard, so it
        # carries no placements: each final's own top 10 comes as a tournament
        # board once its results are in.
        ('solos-2026', 'FNCS 2026 Solos', re.compile(r'FNCS 2026 - Solos BR: .+ - Grand Finals'),
         'The field for the seven regional grand finals of the 2026 Solo FNCS, 26–27 October 2026.'),
    ]

    pools = []
    for pid, label, event, blurb in WANTED:
        events = (sorted(n for n in tour_of if event.fullmatch(n)) if isinstance(event, re.Pattern)
                  else [event] if event in tour_of else [])
        if not events:
            print(f'!! {getattr(event, "pattern", event)!r} not in tournaments.json — skipped')
            continue
        t = tour_of[events[0]]
        raw, named, placed = set(), set(), {}
        for row in placements:
            if row.get('tournament') not in events or did_not_play(row):
                continue
            # None until the result is in: the 2026 Globals rows are the entrants
            # with no place, plus fifty places with nobody in them yet.
            rank = rank_of(row.get('placement'))
            for part in (row.get('participants') or []):
                name = part.get('player') or ''
                if not name:
                    continue
                raw.add(name)
                page = resolve(name)
                if page:
                    named.add(page)
                    if rank is not None:
                        placed[page] = min(rank, placed.get(page, rank))

        # Career prize money from before the event, for Tenaball's upsets and
        # disappointments: a team is seeded by what its players had won going
        # in, not by a career total that already holds this event's prize.
        # Every tournament that started earlier counts, split per player the
        # way the per-format boards in cell 2 split it.
        start = min(str(tour_of[n]['startdate'])[:10] for n in events)
        if len(events) > 1:
            placed = {}     # one place per region's final: no single leaderboard
        before = Counter()
        for row in placements:
            other = tour_of.get(row.get('tournament')) or {}
            day = str(other.get('startdate') or row.get('date') or '')[:10]
            if not day[:4].isdigit() or day >= start:
                continue
            parts = row.get('participants') or []
            if not parts:
                continue
            each = float(row.get('individualprizemoney') or 0)
            if each <= 0:
                each = float(row.get('prizemoney') or 0) / len(parts)
            if each <= 0:
                continue
            for part in parts:
                page = resolve(part.get('player') or '')
                if page in named:
                    before[page] += each

        pools.append({'id': pid, 'label': label, 'blurb': blurb,
                      'event': events[0], 'date': start,
                      **({'events': events} if len(events) > 1 else {}),
                      'players': sorted(named),
                      'placements': dict(sorted(placed.items())),
                      'earningsBefore': {page: round(before[page]) for page in sorted(named)}})
        print(f'{label:<20} {len(raw):>3} entrants, {len(named):>3} playable, {len(placed):>3} placed')

    payload = {'generated': TODAY, 'pools': pools}
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(',', ':'))
    print('\nwrote', OUT)

    # ======================================================================
    # Cell 6 — teammates.json
    # ======================================================================
    print()
    print('Cell 6 — teammates.json')
    OUT = f'{BASE}/teammates.json'
    TOP = 50          # was 10 — see the note above

    pair = Counter()
    for row in placements:
        parts = row.get('participants') or []
        if len(parts) < 2 or did_not_play(row):
            continue
        # `resolve` drops anyone the roster marks unused, so a mate who cannot be
        # shown or guessed never reaches the file in the first place.
        pages = sorted({resolve(p.get('player') or '') for p in parts} - {None})
        for a, b in itertools.combinations(pages, 2):
            pair[(a, b)] += 1

    mates = defaultdict(list)
    for (a, b), n in pair.items():
        mates[a].append([b, n])
        mates[b].append([a, n])

    players_out = []
    for page, entries in mates.items():
        entries.sort(key=lambda e: (-e[1], e[0]))
        players_out.append({'id': page, 'mates': entries[:TOP]})
    players_out.sort(key=lambda p: p['id'])

    payload = {'generated': TODAY, 'top': TOP, 'players': players_out}
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(',', ':'))

    kept = sum(len(p['mates']) for p in players_out)
    print(f'{len(pair):,} distinct pairs; {len(players_out):,} players with a teammate')
    print(f'{kept:,} rows kept at TOP={TOP}; {os.path.getsize(OUT)/1e6:.2f} MB')
    for n in (3, 10, 20, 50):
        print(f'  players with {n}+ teammates on file: '
              f'{sum(1 for p in players_out if len(p["mates"]) >= n):,}')
    print('Peterbot:', players_out[[p['id'] for p in players_out].index('Peterbot')]['mates'][:6])

    # ======================================================================
    # Cell 7 — career_path.json
    # ======================================================================
    print()
    print('Cell 7 — career_path.json')
    OUT = f'{BASE}/career_path.json'
    MIN_APPEARANCES = 5    # to be an answer on the whole roster; an event field takes one

    cp_events = sorted((tour_of[n] for n in MAJORS), key=lambda t: (str(t['startdate'])[:10], t['name']))
    cp_index = {t['name']: i for i, t in enumerate(cp_events)}
    cp_tournaments = [
        {
            'name': t['name'],
            'date': str(t['startdate'])[:10],
            'mode': t.get('mode'),
            'region': t.get('region'),
            'prizePool': None if t.get('prizepool') is None or pd.isna(t.get('prizepool'))
                         else round(float(t['prizepool'])),
        }
        for t in cp_events
    ]

    # `r` is None for '', 'DNP' and 'DQ' — not a finish anyone can be identified by
    # — and a range like '35-36' already reads as its best end (cell 1).
    cp_results = defaultdict(dict)
    for t, r, _money, pages in PLACED:
        i = cp_index.get(t['name'])
        if i is None or r is None:
            continue
        for page, _team in pages:
            cp_results[page][i] = r

    cp_players = [
        {'id': page, 'results': sorted([i, r] for i, r in hits.items())}
        for page, hits in sorted(cp_results.items())
    ]

    payload = {
        'generated': TODAY,
        'minAppearances': MIN_APPEARANCES,
        'tournaments': cp_tournaments,
        'players': cp_players,
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(',', ':'))

    full = [p for p in cp_players if len(p['results']) >= MIN_APPEARANCES]
    print(f'{len(cp_tournaments)} majors; {len(cp_players):,} players with one or more, '
          f'{len(full):,} with {MIN_APPEARANCES}+; {os.path.getsize(OUT)/1e6:.2f} MB')
    print('  by tier, 5+:', dict(Counter(tier.get(p['id']) for p in full)))
    print('  longest path:', max(len(p['results']) for p in cp_players))
    for pool in json.load(open(f'{BASE}/pools.json', encoding='utf-8'))['pools']:
        have = {p['id']: len(p['results']) for p in cp_players}
        short = sorted(page for page in pool['players'] if 0 < have.get(page, 0) < MIN_APPEARANCES)
        none = sorted(page for page in pool['players'] if page not in have)
        print(f"  {pool['label']}: {len(short)} short careers now answerable, "
              f"{len(none)} with no major at all{' — ' + ', '.join(none) if none else ''}")

    # ======================================================================
    # Appendix — facts.json
    # ======================================================================
    print()
    print('Appendix — facts.json')
    OUT = f"{BASE}/facts.json"

    # ------------------------------------------------------------------ events --
    headline = sorted(
        {n for n in (MAJORS | LANS)},
        key=lambda n: (tour_of[n].get("startdate") or "", n),
    )
    index_of = {n: i for i, n in enumerate(headline)}


    def short_name(t):
        """'FNCS 2025 - Major 3: Europe - Grand Finals' -> 'FNCS 2025 - Major 3: Europe'."""
        s = re.sub(r"\s*[-–:]?\s*Grand Finals?\s*[-–:]?\s*", " ", t["name"], flags=re.I)
        s = re.sub(r"\s{2,}", " ", s).strip()
        return re.sub(r"[-–:]\s*$", "", s).strip()


    events = []
    for n in headline:
        t = tour_of[n]
        events.append(
            {
                "name": t["name"],
                "short": short_name(t),
                "date": str(t["startdate"])[:10],
                "kind": (
                    "global"
                    if n in GLOBAL
                    else "fncs"
                    if n in FNCS
                    else "lan"
                    if n in LANS
                    else "major"
                ),
                "lan": n in LANS,
                "region": region_of(t),
                "mode": t.get("mode"),
                "prizePool": (
                    None
                    if t.get("prizepool") is None or pd.isna(t.get("prizepool"))
                    else round(float(t["prizepool"]))
                ),
            }
        )

    # ----------------------------------------------------------------- players --
    blank = lambda: {
        "played": set(),
        "won": set(),
        "lan_tourneys": set(),
        "fncs_tourneys": set(),
        "winRegions": set(),
        "winYears": set(),
        "podium": set(),
    }
    facts = defaultdict(blank)

    for t, r, money, pages in PLACED:
        name = t.get("name")
        idx = index_of.get(name)
        if idx is None:
            continue

        # Placement rank check: matches 1 or '1'
        is_winner = str(r).strip() in ("1", "1st")

        for page, _team in pages:
            f = facts[page]
            f["played"].add(idx)

            if name in LANS:
                f["lan_tourneys"].add(idx)
            if name in FNCS:
                f["fncs_tourneys"].add(idx)

            # Top 3 — Tic Tac Toe's "LAN podium".
            if r is not None and r <= 3:
                f["podium"].add(idx)

            if is_winner:
                f["won"].add(idx)
                reg = region_of(t)
                if reg:
                    f["winRegions"].add(reg)
                if t.get("startdate"):
                    f["winYears"].add(int(str(t["startdate"])[:4]))

    players_out = []
    for page in sorted(facts):
        if tier.get(page) == "unused":
            continue
        f = facts[page]
        won_kinds = Counter(events[i]["kind"] for i in f["won"])

        players_out.append(
            {
                "id": page,
                "played": sorted(f["played"]),
                "won": sorted(f["won"]),
                "apps": len(f["played"]),
                "lanApps": len(f["lan_tourneys"]),
                "fncsApps": len(f["fncs_tourneys"]),
                "wins": {
                    "global": won_kinds["global"],
                    "fncs": won_kinds["fncs"],
                    "lan": sum(1 for i in f["won"] if events[i]["lan"]),
                    "major": len(f["won"]),
                },
                "winRegions": sorted(f["winRegions"]),
                "winYears": sorted(f["winYears"]),
                "podium": sorted(f["podium"]),
            }
        )

    # ------------------------------------------------------------------ season --
    # Every team's finish at the year's big events (cell 1), for List's "played
    # all of them". Tenaball's season boards are built from the same rows in
    # cell 2.
    season_teams = SEASON_TEAMS
    season = {
        "year": SEASON_YEAR,
        "events": [label for label, _pattern in SEASON_EVENTS],
        "teams": [[slot, r, list(ids)] for slot, r, ids in season_teams],
    }
    at = defaultdict(set)
    for slot, _r, ids in season_teams:
        for page in ids:
            at[page].add(slot)
    print(
        f"  season {SEASON_YEAR}: {len(season_teams)} team results, "
        f"{sum(1 for slots in at.values() if len(slots) == len(SEASON_EVENTS))} players at all "
        f"{len(SEASON_EVENTS)} events"
    )

    # `lists`: List's Div Cup and Evaluation lists, finished in cell 2.
    # `divcups`: every Div Cup final won, for Tenite's first and last boards.
    # `million`: the day each player's results first reached $1M.
    payload = {"generated": TODAY, "events": events, "players": players_out, "season": season,
               "lists": PLAYER_LISTS, "divcups": DIVCUP_WINS, "million": MILLION}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))

    print(
        f"{len(events)} headline events, {len(players_out):,} players, "
        f"{os.path.getsize(OUT)/1e6:.1f} MB"
    )
    print("  LAN winners:      ", sum(1 for p in players_out if p["wins"]["lan"]))
    print("  global winners:   ", sum(1 for p in players_out if p["wins"]["global"]))
    print("  LAN podiums:      ", sum(1 for p in players_out if any(events[i]["lan"] for i in p["podium"])))
    print("  5+ tournaments:   ", sum(1 for p in players_out if p["apps"] >= 5))
    print(
        "  most LAN apps:    ",
        sorted(players_out, key=lambda p: -p["lanApps"])[:3],
    )
