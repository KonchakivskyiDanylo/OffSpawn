import { useCallback, useEffect, useMemo, useState } from 'react';
import { sendStart, useRoundRecorder } from '@/analytics/client';
import { GameShell } from '@/components/GameShell';
import { GiveUpButton } from '@/components/GiveUpButton';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { PlayerSearch } from '@/components/PlayerSearch';
import { DailyEnd, DailyPending } from '@/components/DailyEnd';
import { Banner, Hearts, OptionCard, OptionGrid, Stat, StatusDot, StatusLegend } from '@/components/ui';
import { useDailyRound, usePlayMode } from '@/daily/useDailyRound';
import { restoreDaily, result as dailyResult, shareGrid, snapshot } from './daily';
import { WhatCounts } from '@/components/Glossary';
import type { Board } from '@/data/liquipedia/rankings';
import { loadFacts, type Facts } from '@/data/liquipedia/facts';
import type { Majors } from '@/data/liquipedia/majors';
import type { Orgs } from '@/data/liquipedia/orgs';
import type { Pools } from '@/data/liquipedia/pools';
import { Rankings } from '@/data/liquipedia/rankings';
import type { Roster } from '@/data/liquipedia/roster';
import { useMajors } from '@/data/liquipedia/useMajors';
import { useOrgs } from '@/data/liquipedia/useOrgs';
import { usePools } from '@/data/liquipedia/usePools';
import { useRankings } from '@/data/liquipedia/useRankings';
import { useRoster } from '@/data/liquipedia/useRoster';
import { activePool, useEventMode } from '@/games/shared/mode';
import { termsIn } from '@/games/shared/glossary';
import { poolPlayers } from '@/games/shared/pool';
import { pickFresh, useProgress, type PuzzleStatus } from '@/games/shared/progress';
import type { Searchable } from '@/lib/text';
import { useBestScore } from '@/lib/storage';
import { getGame } from '@/games/registry';
import { dayMonthYear, ordinal, plural } from '@/lib/format';
import {
  applyGuess,
  createGame,
  giveUp,
  HARD_LIVES,
  namedIn,
  slotsIn,
  type Difficulty,
  type GameState,
  record as roundRecord,
} from './engine';
import { derivedBoards } from './derived-boards';
import { globalsBoards } from './globals-boards';
import { socialBoards } from './social-boards';
import { useSocials } from '@/data/useSocials';
import { poolRankings } from './pool-boards';
import './tenaball.css';

const meta = getGame('tenaball')!;

const DIFFICULTIES: { id: Difficulty; label: string; hint: string }[] = [
  { id: 'easy', label: '🟢 Easy', hint: 'Unlimited guesses.' },
  { id: 'hard', label: '🔴 Hard', hint: `${HARD_LIVES} lives; every wrong answer costs one.` },
];

export default function TenaballGame() {
  const { roster, error: rosterError } = useRoster();
  const { rankings, error: rankingsError } = useRankings();
  const { orgs, error: orgsError } = useOrgs();
  // Every player's finish at every major: the Globals boards are built from it.
  const { majors, error: majorsError } = useMajors();
  const { pools } = usePools();

  return (
    <LiquipediaGate
      error={rosterError ?? rankingsError ?? orgsError ?? majorsError}
      ready={Boolean(roster && rankings && orgs && majors)}
    >
      {roster && rankings && orgs && majors ? (
        <Game roster={roster} rankings={rankings} orgs={orgs} majors={majors} pools={pools} />
      ) : null}
    </LiquipediaGate>
  );
}

function Game({
  roster,
  rankings,
  orgs,
  majors,
  pools,
}: {
  roster: Roster;
  rankings: Rankings;
  orgs: Orgs;
  majors: Majors;
  pools: Pools | null;
}) {
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  /** Follower counts: a daily may be a follower board, so the daily waits for them. */
  const socials = useSocials();
  const [dailyOn, setDailyOn] = usePlayMode('tenaball');
  const daily = useDailyRound('tenaball', {
    on: dailyOn,
    ready: socials !== null,
    restore: (puzzle, saved) => restoreDaily(puzzle, rankings, roster, socials, majors, saved),
    snapshot,
    finished: (state) => state.status !== 'playing',
    result: dailyResult,
  });
  const [practice, setPractice] = useState<GameState | null>(null);
  const game = dailyOn ? daily.state : practice;
  const setGame = (next: GameState | null) => (dailyOn ? next && daily.setState(next) : setPractice(next));

  useRoundRecorder('tenaball', dailyOn ? daily.endedHere : game !== null && game.status !== 'playing', () => ({
    title: `Tenite — ${game!.board.title}`,
    data: rankings.generated,
    setup: dailyOn ? { daily: daily.day, level: game!.difficulty } : { event, level: game!.difficulty },
    ...roundRecord(game!),
  }));
  const shell = { game: meta, dataNote: <RosterNote />, daily: { on: dailyOn, number: daily.number, setOn: setDailyOn } };
  // Green, yellow or red in the picker: completed, tried, not played.
  const { statusOf, mark } = useProgress('tenaball');
  useEffect(() => {
    if (game && game.status !== 'playing') mark(game.board.id, game.status === 'won');
  }, [game, mark]);
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState<{ tone: string; message: string } | null>(null);

  const [event] = useEventMode();
  const pool = activePool(pools, event);

  /**
   * Career facts, loaded only inside an event mode.
   *
   * Three of the field boards — LAN appearances, FNCS grand finals played,
   * tournaments played — are the only thing in this game that needs
   * `facts.json`, and it is 577 KB. Everyone who opens Tenaball on the whole
   * scene would be paying for boards they cannot reach, so this is a
   * deliberate conditional load rather than another `useFacts()` at the top.
   * The boards appear when it lands; `poolBoards` simply omits them until then.
   */
  const [facts, setFacts] = useState<Facts | null>(null);
  useEffect(() => {
    if (!pool) return;
    let cancelled = false;
    loadFacts().then(
      (loaded) => {
        if (!cancelled) setFacts(loaded);
      },
      // A missing facts.json costs two boards, not the game.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [pool]);

  /**
   * The boards on offer: this field's, or the shipped all-time set.
   *
   * A field that cannot fill even one board falls back rather than showing an
   * empty picker — see the note under the difficulty cards.
   */
  const derived = useMemo(() => {
    if (!pool) return null;
    const built = poolRankings(
      pool,
      poolPlayers(roster, pools, event),
      facts,
      orgs,
      rankings.generated,
    );
    return built.boards.length > 0 ? built : null;
  }, [pool, roster, pools, event, facts, orgs, rankings.generated]);

  /**
   * The all-time set, plus the boards built from the roster in place.
   *
   * Wrapped back into a `Rankings` so the picker, the search and the Random
   * button cannot tell where a board came from — the same trick the field
   * boards use.
   */
  const allTime = useMemo(
    () =>
      new Rankings({
        generated: rankings.generated,
        slots: rankings.slots,
        boards: [
          ...rankings.boards,
          ...globalsBoards(majors, roster),
          ...derivedBoards(roster.players),
          ...socialBoards(roster, socials),
        ],
        tournaments: rankings.tournaments,
      }),
    [rankings, roster, socials, majors],
  );

  const active = derived ?? allTime;
  // True when a mode is on but its field was too small to rank ten of anything.
  const fellBack = Boolean(pool) && derived === null;

  // A board id is a score key, and the field boards carry their own prefix, so
  // a best score never leaks between the field and the all-time set.
  useEffect(() => setPractice(null), [event]);

  const start = useCallback(
    (board: Board | null) => {
      if (!board) return;
      setFeedback(null);
      sendStart('tenaball', false);
      setPractice(createGame(board, difficulty));
    },
    [difficulty],
  );

  /**
   * What the guess box searches.
   *
   * Deliberately the *whole* population, never the ten answers — searching the
   * board would print the solution into the dropdown. A country board searches
   * every country, so typing "bra" offers Brazil whether or not Brazil is in
   * the top ten, and the board decides.
   */
  const searchPool: readonly Searchable[] = useMemo(() => {
    if (!game) return [];
    if (game.board.entity === 'org') {
      /*
       * Keyed by display name, because that is what an org board ranks on.
       *
       * This was a real bug: the rows carry "FaZe Clan" and this list used to
       * hand back `org.id`, which is the page name "FaZe_Clan". They never
       * matched, so every organisation whose name contains a space — 339 of
       * 979, including seven of the ten on the all-time earnings board — was
       * marked wrong when you typed it correctly.
       *
       * The board's own labels are unioned in afterwards: a handful of orgs
       * earn enough to rank without having a roster entry in `orgs.json`
       * (COOLER Esport, Gentside), and an answer you cannot type is the same
       * bug wearing a different hat.
       */
      const rows = new Map<string, Searchable>();
      for (const org of orgs.orgs) rows.set(org.name, { id: org.name, name: org.name });
      for (const row of [...game.board.rows, game.board.next]) {
        if (!rows.has(row.key)) rows.set(row.key, { id: row.key, name: row.label });
      }
      return [...rows.values()];
    }
    if (game.board.entity === 'country') {
      const names = new Set(roster.players.map((p) => p.countryName).filter(Boolean) as string[]);
      for (const row of [...game.board.rows, game.board.next]) names.add(row.key);
      return [...names].map((name) => ({ id: name, name }));
    }
    if (game.board.entity === 'tournament') {
      // The notebook's list already covers every answer; the union is the same
      // belt-and-braces the org branch above wears, for a board built anywhere
      // else — an event nobody can type is a slot nobody can fill.
      const names = new Set(rankings.tournaments);
      for (const row of [...game.board.rows, game.board.next]) names.add(row.key);
      return [...names].map((name) => ({ id: name, name }));
    }
    return roster.players;
  }, [game, orgs, roster, rankings]);

  const scoreKey = game ? `tenaball:${game.board.id}:${game.difficulty}` : 'tenaball:none';
  const { best, submit: submitScore } = useBestScore(scoreKey);

  if (!game && dailyOn) {
    // A day played before its board was kept: the whole board, then the score
    // (the user, 14 Oct 2026: "have like a full description… even if it [is] the past game").
    const answers = daily.status === 'played' ? daily.answers : null;
    return (
      <GameShell {...shell}>
        <div className="stack tb-play">
          {answers ? (
            <>
              <BoardHead board={answers.board} />
              <Slots game={answers} reveal />
            </>
          ) : null}
          <DailyPending status={daily.status} error={daily.error} game="tenaball" played={daily.played} />
        </div>
      </GameShell>
    );
  }

  if (!game) {
    return (
      <GameShell {...shell}>
        <div className="stack">
          <section className="card stack">
            <div className="card__title">Difficulty</div>
            <OptionGrid>
              {DIFFICULTIES.map((option) => (
                <OptionCard
                  key={option.id}
                  label={option.label}
                  hint={option.hint}
                  selected={difficulty === option.id}
                  onClick={() => setDifficulty(option.id)}
                />
              ))}
            </OptionGrid>
          </section>

          {pool && !fellBack ? (
            <p className="small muted center" style={{ margin: 0 }}>
              Every board below is the <strong>{pool.label}</strong> field only.
            </p>
          ) : null}
          {fellBack ? (
            <Banner tone="info" title={`${pool?.label} is too small for a top ten`}>
              Not enough of that field can be ranked ten deep on anything, so these are the
              all-time boards.
            </Banner>
          ) : null}

          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={() => start(pickFresh(active.boards, statusOf))}
          >
            🎲 Random category
          </button>

          <CategoryPicker
            rankings={active}
            query={query}
            onQuery={setQuery}
            onPick={start}
            statusOf={statusOf}
          />
        </div>
      </GameShell>
    );
  }

  const { board } = game;
  const slots = slotsIn(game);
  const finished = game.status !== 'playing';

  const guess = (entity: Searchable) => {
    const result = applyGuess(game, entity.id, entity.name);
    setGame(result.state);
    // Recorded here rather than during render — a state setter in the render
    // body re-renders forever.
    if (result.state.status !== 'playing') submitScore(result.state.found.size);
    switch (result.outcome.kind) {
      case 'correct': {
        // A team slot closing is worth saying out loud; a one-name board has
        // nothing to close, so it keeps the flatter wording it always had.
        const rank = result.outcome.rank;
        const team = slotsIn(result.state)[rank - 1].members.length > 1;
        setFeedback({
          tone: 'var(--success)',
          message: team
            ? `${entity.name} — that completes ${ordinal(rank)}.`
            : `${entity.name} — number ${rank}.`,
        });
        break;
      }
      case 'partial':
        setFeedback({
          tone: 'var(--success)',
          message: `${entity.name} — ${ordinal(result.outcome.rank)}. ${plural(
            result.outcome.remaining,
            'name',
          )} to go on that one.`,
        });
        break;
      case 'duplicate':
        setFeedback({ tone: 'var(--warning)', message: `${entity.name} is already on the board.` });
        break;
      case 'level':
        setFeedback({
          tone: 'var(--warning)',
          message: `${entity.name} is also ${ordinal(result.outcome.rank)}, level with ${result.outcome.holder} — no penalty.`,
        });
        break;
      case 'eleventh':
        // Wrong, and it cost a life; only how close it was is worth saying.
        setFeedback({
          tone: 'var(--danger)',
          message: result.outcome.level
            ? `${entity.name} is level with 10th but ranked out by the tie rule — not in the top ten.`
            : `${entity.name} is 11th — just outside the top ten.`,
        });
        break;
      default:
        setFeedback({ tone: 'var(--danger)', message: `${entity.name} is not in this top ten.` });
    }
  };

  return (
    <GameShell
      {...shell}
      toolbar={
        dailyOn ? null : (
          <button type="button" className="icon-btn" onClick={() => setPractice(null)}>
            ↺ New category
          </button>
        )
      }
    >
      {/* `tb-play` is what makes the round fit a laptop screen without
          scrolling: it tightens the shared stats and stacking, and it is the
          container the board measures to decide on two columns of five. */}
      <div className="stack tb-play">
        <div className="stats">
          <Stat label="Found" value={`${game.found.size}/${slots.length}`} />
          {game.difficulty === 'hard' ? (
            <Stat label="Lives" value={<Hearts left={Math.max(0, game.lives)} total={game.maxLives} />} />
          ) : null}
          <Stat label="Best" value={best} />
        </div>

        <BoardHead board={board} />
        <Slots game={game} />

        {feedback ? (
          <p className="small center" style={{ color: feedback.tone }}>
            {feedback.message}
          </p>
        ) : null}

        {finished ? (
          <div className="stack">
            <Banner
              tone={game.status === 'won' ? 'success' : 'danger'}
              title={game.status === 'won' ? 'All ten found!' : 'Board over'}
            >
              {game.status === 'won'
                ? `Every slot filled${game.wrong.length ? ` with ${game.wrong.length} wrong ${game.wrong.length === 1 ? 'answer' : 'answers'}` : ''}.`
                : `You found ${game.found.size} of ${slots.length}. The rest are revealed above.`}
            </Banner>
            {dailyOn ? (
              <DailyEnd
                game="tenaball"
                number={daily.number}
                day={daily.day}
                result={dailyResult(game)}
                grid={shareGrid(game)}
              />
            ) : (
              <button
                type="button"
                className="btn btn--primary btn--lg btn--block"
                onClick={() => setPractice(null)}
              >
                New category
              </button>
            )}
          </div>
        ) : (
          <div className="stack-sm">
            <PlayerSearch
              players={searchPool}
              onPick={guess}
              placeholder={
                board.entity === 'org'
                  ? 'Name an organisation…'
                  : board.entity === 'country'
                    ? 'Name a country…'
                    : board.entity === 'tournament'
                      ? 'Name a tournament…'
                      : 'Name a player…'
              }
              buttonLabel="Enter"
              autoFocus
            />
            <div className="row" style={{ justifyContent: 'center' }}>
              <GiveUpButton onGiveUp={() => setGame(giveUp(game))} />
            </div>
          </div>
        )}
      </div>
    </GameShell>
  );
}

/**
 * The board's name, its tie rule, and on a daily pinned on its day the date
 * its numbers are from (the user, 14 Oct 2026: "write somewhere like earnings
 * as of …") — a past day keeps the board it was played on.
 */
function BoardHead({ board }: { board: Board }) {
  return (
    <section className="card tb-head">
      <div className="tb-head__row">
        <span className="tb-head__group">{board.group}</span>
        <h2 className="tb-head__title">{board.title}</h2>
      </div>
      <p className="tiny faint">
        {board.tieRule}
        {board.asOf ? <span className="tb-head__asof"> As of {dayMonthYear(board.asOf)}.</span> : null}
      </p>
      <WhatCounts terms={termsIn(`${board.group} ${board.title}`, board.id)} />
    </section>
  );
}

/**
 * The ten slots. In play, what is named so far; once over, the rest revealed
 * in red. `reveal` is the answer key alone, every row plain — for a day played
 * before its board was kept, where which ones were found is not known.
 */
function Slots({ game, reveal = false }: { game: GameState; reveal?: boolean }) {
  const slots = slotsIn(game);
  const finished = reveal || game.status !== 'playing';
  /*
   * Whether the value column says anything the slot number has not.
   *
   * On a tournament board the value *is* the finishing position, so every row
   * would print its own rank back at itself. Asked of the board rather than of
   * each row, because a board written before the notebook ranked placements has
   * two players per position — 1st is rows 1 and 2 — and there half the numbers
   * do carry information.
   */
  const showValues = slots.some((slot) => slot.row.display !== String(slot.rank));
  return (
    <ol className="tb-list list-reset">
      {slots.map((slot) => {
        const named = namedIn(game, slot.rank);
        const complete = game.found.has(slot.rank);
        const missed = finished && !complete && !reveal;
        const value = showValues ? slot.row.display : '';
        return (
          <li
            key={slot.rank}
            className={`tb-slot${complete ? ' tb-slot--filled' : ''}${
              missed ? ' tb-slot--missed' : ''
            }${!complete && !finished && named.size > 0 ? ' tb-slot--partial' : ''}`}
          >
            <span className={`tb-slot__rank${slot.rank <= 3 ? ` tb-slot__rank--${['gold', 'silver', 'bronze'][slot.rank - 1]}` : ''}`}>
              {slot.rank}
            </span>
            <span className="tb-slot__name">
              {slot.members.map((member) =>
                named.has(member.key) || reveal ? (
                  <span key={member.key} className="tb-member">
                    {member.label}
                  </span>
                ) : finished ? (
                  <span key={member.key} className="tb-member tb-member--revealed">
                    {member.label}
                  </span>
                ) : (
                  <span key={member.key} className="tb-member tb-member--blank">
                    —
                  </span>
                ),
              )}
              {(missed || reveal) && slot.also ? (
                <span className="tb-member tb-member--revealed">
                  or {slot.also.map((member) => member.label).join(' & ')}
                </span>
              ) : null}
            </span>
            <span className="tb-slot__value">{complete || finished ? value : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The category list.
 *
 * There are a couple of hundred boards, which is too many for a grid of cards
 * and exactly right for a search box over headed groups: you either know what
 * you want and type two words of it, or you scroll the group you fancy.
 */
function CategoryPicker({
  rankings,
  query,
  onQuery,
  onPick,
  statusOf,
}: {
  rankings: Rankings;
  query: string;
  onQuery: (value: string) => void;
  onPick: (board: Board) => void;
  statusOf: (board: string) => PuzzleStatus | null;
}) {
  const grouped = useMemo(() => {
    const out = new Map<string, Board[]>();
    for (const board of rankings.search(query)) {
      const list = out.get(board.group);
      if (list) list.push(board);
      else out.set(board.group, [board]);
    }
    return out;
  }, [rankings, query]);

  const total = [...grouped.values()].reduce((n, list) => n + list.length, 0);

  return (
    <section className="card stack">
      <div className="row-between">
        <div className="card__title">Or pick a category</div>
        <span className="tiny faint">{total} available</span>
      </div>
      <StatusLegend statuses={rankings.boards.map((board) => statusOf(board.id))} />
      <input
        className="input"
        value={query}
        placeholder="Search categories — “2023”, “Brazil”, “LAN”…"
        onChange={(event) => onQuery(event.target.value)}
        aria-label="Search categories"
        autoComplete="off"
        spellCheck={false}
      />
      {total === 0 ? (
        <p className="small muted">Nothing matches “{query}”.</p>
      ) : (
        <div className="picker-list">
          {[...grouped].map(([group, boards]) => (
            <div key={group} className="stack-sm">
              <h3 className="picker-list__head">{group}</h3>
              <div className="picker-list__group">
                {boards.map((board) => (
                  <button
                    key={board.id}
                    type="button"
                    className="picker-option"
                    onClick={() => onPick(board)}
                  >
                    <StatusDot status={statusOf(board.id)} />
                    {board.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
