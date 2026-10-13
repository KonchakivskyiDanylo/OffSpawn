import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendStart, useRoundRecorder } from '@/analytics/client';
import { GameShell } from '@/components/GameShell';
import { GiveUpButton } from '@/components/GiveUpButton';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { PlayerSearch } from '@/components/PlayerSearch';
import { DailyEnd, DailyPending } from '@/components/DailyEnd';
import { useSocials } from '@/data/useSocials';
import { Banner, OptionCard, OptionGrid, Stat, StatusDot, StatusLegend } from '@/components/ui';
import { useDailySet } from '@/daily/client';
import { puzzleNumber } from '@/daily/day';
import { logResult, savedRound, saveRound } from '@/daily/progress';
import { useToday } from '@/daily/useDay';
import { usePlayMode } from '@/daily/useDailyRound';
import { DAILY_LEVEL, FRESH, result as dailyResult, shareGrid, type Snapshot } from './daily';
import { WhatCounts } from '@/components/Glossary';
import type { Facts } from '@/data/liquipedia/facts';
import { loadOrgs, type Orgs } from '@/data/liquipedia/orgs';
import type { Pools } from '@/data/liquipedia/pools';
import type { Roster } from '@/data/liquipedia/roster';
import { loadTeammates, type Teammates } from '@/data/liquipedia/teammates';
import type { Searchable } from '@/lib/text';
import { useFacts } from '@/data/liquipedia/useFacts';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import { formatClock } from '@/lib/format';
import { useBestScore } from '@/lib/storage';
import { getGame } from '@/games/registry';
import { activePool, useEventMode } from '@/games/shared/mode';
import { termsIn } from '@/games/shared/glossary';
import { poolPlayers } from '@/games/shared/pool';
import { pickFresh, useProgress, type PuzzleStatus } from '@/games/shared/progress';
import { buildCriteria, buildPoolCriteria, type Criterion } from './criteria';
import './list.css';

const meta = getGame('list')!;

const START_SECONDS = 90;
const BONUS_SECONDS = 5;
const PENALTY_SECONDS = 3;

type Difficulty = 'easy' | 'hard';

export default function ListGame() {
  const { roster, error: rosterError } = useRoster();
  const { facts, error: factsError } = useFacts();
  const { pools } = usePools();

  return (
    <LiquipediaGate error={rosterError ?? factsError} ready={Boolean(roster && facts)}>
      {roster && facts ? <Game roster={roster} facts={facts} pools={pools} /> : null}
    </LiquipediaGate>
  );
}

function Game({ roster, facts, pools }: { roster: Roster; facts: Facts; pools: Pools | null }) {
  const [event] = useEventMode();
  const socials = useSocials();
  const pool = activePool(pools, event);

  /**
   * The lists on offer: this field's, or the all-time set.
   *
   * A field is a hundred players, so every list it can produce is derived on
   * the spot — see `buildPoolCriteria`. If the field is too small to fill even
   * one list the all-time set stands in, which is what the note on the setup
   * screen is for.
   */
  /*
   * Organisations and teammate counts, loaded after the first paint.
   *
   * Between them they are 1.4 MB, and they buy two families of list — "has
   * played for FaZe" and "has queued with Peterbot ten times" — that nobody is
   * looking at in the first second. Same deal as Tenaball's `facts.json`: the
   * categories appear when the files land, and a missing file costs those
   * categories rather than the game.
   */
  const [extra, setExtra] = useState<{ orgs: Orgs | null; teammates: Teammates | null; settled: number }>({
    orgs: null,
    teammates: null,
    settled: 0,
  });
  useEffect(() => {
    let cancelled = false;
    const settle = (patch: Partial<typeof extra>) =>
      !cancelled && setExtra((was) => ({ ...was, ...patch, settled: was.settled + 1 }));
    loadOrgs().then(
      (orgs) => settle({ orgs }),
      () => settle({}),
    );
    loadTeammates().then(
      (teammates) => settle({ teammates }),
      () => settle({}),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const criteria = useMemo(() => {
    if (pool) {
      const scoped = buildPoolCriteria(
        pool,
        poolPlayers(roster, pools, event),
        facts,
        extra.orgs,
        roster.players,
      );
      if (scoped.length > 0) return scoped;
    }
    return buildCriteria(roster, facts, pools, extra.orgs, extra.teammates, socials);
  }, [pool, roster, facts, pools, event, extra, socials]);

  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [criterion, setCriterion] = useState<Criterion | null>(null);
  /** The category search box — see `ListPicker`. */
  const [query, setQuery] = useState('');
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  /** Ended by the give-up button rather than by the clock. */
  const [gaveUp, setGaveUp] = useState(false);
  const [found, setFound] = useState<Searchable[]>([]);

  /*
   * The daily list. Not `useDailyRound` like the other games: a List run is a
   * clock as much as a state, so the run is saved as when it started and how
   * far the bonuses and penalties moved it (`daily.ts`), and a reload works
   * out the real time left from that.
   */
  const [dailyOn, setDailyOn] = usePlayMode('list');
  const today = useToday();
  const { set, error: dailyError } = useDailySet(dailyOn ? today : null);
  // The day's list may be a follower list, so the daily waits for the counts too.
  const listsReady = extra.settled >= 2 && socials !== null;
  const dailyList = useMemo(
    () => (dailyOn && set && listsReady ? (criteria.find((list) => list.id === set.puzzles.list?.list) ?? null) : null),
    [dailyOn, set, listsReady, criteria],
  );
  const run = useRef<Snapshot>(FRESH);
  /** A run that was already over when the page loaded — recorded the first time, not again. */
  const [restoredOver, setRestoredOver] = useState(false);

  const persist = (patch: Partial<Snapshot>) => {
    run.current = { ...run.current, ...patch };
    if (!dailyOn || !dailyList) return;
    saveRound('list', today, set?.puzzles.list, run.current);
    if (run.current.ended) logResult('list', today, dailyResult(run.current, dailyList.answers.length));
  };

  useEffect(() => {
    if (!dailyList) return;
    const saved = savedRound<Snapshot>('list', today, set?.puzzles.list) ?? FRESH;
    run.current = saved;
    setCriterion(dailyList);
    setDifficulty(DAILY_LEVEL);
    setFound(saved.found);
    setGaveUp(saved.ended === 'gave-up');
    setFeedback(null);
    setRestoredOver(saved.ended !== null);
    const deadline = saved.started === null ? 0 : saved.started + (START_SECONDS + saved.shift) * 1000;
    if (saved.ended) {
      setRunning(false);
      setFinished(true);
      setTimeLeft(Math.max(0, (deadline - Date.now()) / 1000));
    } else if (saved.started !== null && deadline <= Date.now()) {
      // Left open, or closed, past the end of the clock: the run is over.
      run.current = { ...saved, ended: 'time' };
      saveRound('list', today, set?.puzzles.list, run.current);
      logResult('list', today, dailyResult(run.current, dailyList.answers.length));
      setRestoredOver(true);
      setRunning(false);
      setFinished(true);
      setTimeLeft(0);
    } else if (saved.started !== null) {
      deadlineRef.current = deadline;
      setTimeLeft((deadline - Date.now()) / 1000);
      setFinished(false);
      setRunning(true);
    } else {
      setRunning(false);
      setFinished(false);
      setTimeLeft(START_SECONDS);
    }
  }, [dailyList, today]);

  useRoundRecorder('list', finished && criterion !== null && !(dailyOn && restoredOver), () => {
    const list = criterion!;
    return {
      title: `List — ${list.title}`,
      data: facts.generated,
      setup: dailyOn ? { daily: today, level: difficulty } : { event, level: difficulty },
      outcome: gaveUp ? 'gave-up' : found.length >= list.answers.length ? 'won' : 'lost',
      r: {
        list: { id: list.id, name: list.title },
        total: list.answers.length,
        found: found.map((entry) => ({ id: entry.id, name: entry.name })),
        missed: list.answers
          .filter((answer) => !found.some((entry) => entry.id === answer.id))
          .map((answer) => answer.name),
      },
    };
  });
  const [timeLeft, setTimeLeft] = useState(START_SECONDS);
  const [feedback, setFeedback] = useState<{ tone: string; message: string } | null>(null);
  const deadlineRef = useRef<number>(0);
  /** The timer's way to `persist` — its interval outlives the render that made it. */
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const { best, submit: submitBest } = useBestScore(`list:${criterion?.id ?? 'none'}:${difficulty}`);

  // Timer: a deadline plus a tick, so bonuses and penalties simply move the
  // deadline and the display stays accurate even if a tick is late.
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const remaining = (deadlineRef.current - Date.now()) / 1000;
      if (remaining <= 0) {
        setTimeLeft(0);
        setRunning(false);
        setFinished(true);
        persistRef.current({ ended: 'time' });
      } else {
        setTimeLeft(remaining);
      }
    };
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (finished) submitBest(found.length);
  }, [finished, found.length, submitBest]);

  // Green, yellow or red in the picker: completed, tried, not played.
  const { statusOf, mark } = useProgress('list');
  useEffect(() => {
    if (finished && criterion) mark(criterion.id, found.length >= criterion.answers.length);
  }, [finished, criterion, found.length, mark]);

  const start = useCallback(() => {
    if (!criterion) return;
    const now = Date.now();
    setFound([]);
    setFeedback(null);
    setFinished(false);
    setGaveUp(false);
    setTimeLeft(START_SECONDS);
    deadlineRef.current = now + START_SECONDS * 1000;
    // List's own clock start is its round start, on the daily list too.
    sendStart('list', dailyOn);
    setRunning(true);
    persistRef.current({ ...FRESH, started: now });
  }, [criterion, dailyOn]);

  const adjustTime = (seconds: number) => {
    deadlineRef.current += seconds * 1000;
    setTimeLeft(Math.max(0, (deadlineRef.current - Date.now()) / 1000));
    persist({ shift: run.current.shift + seconds });
  };

  const guess = (player: Searchable) => {
    if (!running || !criterion) return;

    if (found.some((entry) => entry.id === player.id)) {
      setFeedback({ tone: 'var(--warning)', message: `${player.name} is already on your list.` });
      return;
    }
    if (!criterion.answers.some((answer) => answer.id === player.id)) {
      persist({ wrong: run.current.wrong + 1 });
      if (difficulty === 'hard') adjustTime(-PENALTY_SECONDS);
      setFeedback({
        tone: 'var(--danger)',
        message:
          difficulty === 'hard'
            ? `${player.name} does not fit — ${PENALTY_SECONDS}s`
            : `${player.name} does not fit.`,
      });
      return;
    }

    /*
     * Naming the last one ends the round, then and there.
     *
     * It used to keep the clock running on an empty list with nothing left to
     * type, until time ran out and the game said "Time! 14 of 14" — which is a
     * win reported as though it were a loss, after thirty seconds of sitting
     * there. Clearing the list is the best thing that can happen in this game
     * and it should be the thing that stops it.
     */
    const complete = found.length + 1 >= criterion.answers.length;
    persist({ found: [{ id: player.id, name: player.name }, ...run.current.found] });
    if (complete) {
      setRunning(false);
      setFinished(true);
      setFeedback(null);
      persist({ ended: 'cleared' });
    } else {
      adjustTime(BONUS_SECONDS);
      setFeedback({ tone: 'var(--success)', message: `${player.name} +${BONUS_SECONDS}s` });
    }
    setFound((prev) => [player, ...prev]);
  };

  if (criteria.length === 0) {
    return (
      <GameShell game={meta}>
        <Banner tone="danger" title="No categories available">
          The export does not currently support any List category.
        </Banner>
      </GameShell>
    );
  }

  const shell = {
    game: meta,
    dataNote: <RosterNote />,
    daily: {
      on: dailyOn,
      number: puzzleNumber(today),
      setOn: (on: boolean) => {
        setDailyOn(on);
        setCriterion(null);
        setRunning(false);
        setFinished(false);
      },
    },
  };

  if (dailyOn && (!criterion || criterion.id !== dailyList?.id)) {
    const status = dailyError ? 'error' : set && listsReady && !dailyList ? 'missing' : 'loading';
    return (
      <GameShell {...shell}>
        <DailyPending status={status} error={dailyError} />
      </GameShell>
    );
  }

  // ------------------------------------------------------------- setup --
  if (!criterion) {
    return (
      <GameShell {...shell}>
        <div className="stack">
          <section className="card stack">
            <div className="card__title">Difficulty</div>
            <OptionGrid>
              <OptionCard
                label="🟢 Easy"
                hint="90 seconds. Wrong answers cost nothing."
                selected={difficulty === 'easy'}
                onClick={() => setDifficulty('easy')}
              />
              <OptionCard
                label="🔴 Hard"
                hint={`90 seconds. Every wrong answer costs ${PENALTY_SECONDS}s.`}
                selected={difficulty === 'hard'}
                onClick={() => setDifficulty('hard')}
              />
            </OptionGrid>
          </section>

          {pool ? (
            <p className="small muted center" style={{ margin: 0 }}>
              Every list below is the <strong>{pool.label}</strong> field only.
            </p>
          ) : null}

          {/*
            Random first, then the list — the same shape as Tenite's picker,
            and for the same reason. The categories grew from five hand-picked
            ones to a few dozen, which is past the point where a wall of cards
            is a choice rather than a search.
          */}
          <button
            type="button"
            className="btn btn--primary btn--lg btn--block"
            onClick={() => setCriterion(pickFresh(criteria, statusOf))}
          >
            🎲 Random list
          </button>

          <ListPicker
            criteria={criteria}
            query={query}
            onQuery={setQuery}
            onPick={setCriterion}
            scope={pool?.label ?? null}
            statusOf={statusOf}
          />
        </div>
      </GameShell>
    );
  }

  const foundIds = new Set(found.map((player) => player.id));
  // "players" for all but one list — see `Criterion.noun`.
  const noun = criterion.noun ?? 'players';
  const missed = criterion.answers.filter((player) => !foundIds.has(player.id));
  const idle = !running && !finished;

  return (
    <GameShell
      {...shell}
      toolbar={
        dailyOn ? null : (
          <button type="button" className="icon-btn" onClick={() => setCriterion(null)}>
            ↺ New list
          </button>
        )
      }
    >
      <div className="stack">
        <div className="stats">
          <Stat label="Score" value={found.length} />
          <Stat label="Best" value={Math.max(best, found.length)} />
          <Stat
            label="Time"
            value={
              <span className={timeLeft <= 10 && running ? 'list-clock--low' : ''}>
                {formatClock(timeLeft)}
              </span>
            }
          />
        </div>

        <section className="card stack list-head">
          <div className="card__title">Your list</div>
          <h2>{criterion.title}</h2>
          {criterion.subtitle ? <p className="small muted">{criterion.subtitle}</p> : null}
          <div className="list-meter" aria-label={`${found.length} of ${criterion.answers.length} found`}>
            <div className="list-meter__bar">
              <span style={{ width: `${(found.length / Math.max(1, criterion.answers.length)) * 100}%` }} />
            </div>
            <span className="list-meter__count">
              {found.length} / {criterion.answers.length} {noun}
            </span>
          </div>
          {running ? (
            <div className="list-timer" aria-hidden="true">
              <span
                className={timeLeft <= 10 ? 'is-low' : ''}
                style={{ width: `${Math.min(100, (timeLeft / START_SECONDS) * 100)}%` }}
              />
            </div>
          ) : null}
          <WhatCounts terms={termsIn(`${criterion.title} ${criterion.subtitle ?? ''}`, criterion.id)} />
        </section>

        {idle ? (
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={start}>
            Start the clock
          </button>
        ) : null}

        {running ? (
          <div className="stack-sm">
            {/*
             * Suggestions are safe here now the row is a bare handle: it helps
             * you spell a name you already thought of, and tells you nothing
             * about whether that name is on the list.
             */}
            <PlayerSearch
              players={criterion.pool ?? roster.players}
              onPick={guess}
              exclude={foundIds}
              placeholder={`Name a ${noun.replace(/ies$/, 'y').replace(/s$/, '')}…`}
              buttonLabel="Add"
              autoFocus
            />
            {feedback ? (
              <p className="small center" style={{ color: feedback.tone }}>
                {feedback.message}
              </p>
            ) : null}
            <div className="row" style={{ justifyContent: 'center' }}>
              <GiveUpButton
                onGiveUp={() => {
                  setRunning(false);
                  setFinished(true);
                  setGaveUp(true);
                  setTimeLeft(0);
                  setFeedback(null);
                  persist({ ended: 'gave-up' });
                }}
              />
            </div>
          </div>
        ) : null}

        {found.length > 0 ? (
          <section className="card stack-sm">
            <div className="card__title">Found ({found.length})</div>
            <div className="list-grid">
              {found.map((player, index) => (
                <div key={player.id} className={`list-chip list-chip--found${index === 0 && running ? ' list-chip--new' : ''}`}>
                  {player.name}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {finished ? (
          <div className="stack">
            <Banner
              tone={missed.length === 0 ? 'success' : 'info'}
              title={
                missed.length === 0
                  ? `You win — all ${criterion.answers.length} of them!`
                  : `${gaveUp ? 'Gave up' : 'Time!'} ${found.length} of ${criterion.answers.length}`
              }
            >
              {missed.length > 0
                ? `You missed ${missed.length}.`
                : `Cleared the whole list with ${formatClock(timeLeft)} on the clock.`}
            </Banner>

            {missed.length > 0 ? (
              <section className="card stack-sm">
                <div className="card__title">Missed ({missed.length})</div>
                <div className="list-grid">
                  {missed.map((player) => (
                    <div key={player.id} className="list-chip">
                      {player.name}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {dailyOn ? (
              <DailyEnd
                game="list"
                number={puzzleNumber(today)}
                day={today}
                result={dailyResult(run.current, criterion.answers.length)}
                grid={shareGrid(run.current, criterion.answers.length)}
              />
            ) : (
              <div className="row">
                <button type="button" className="btn btn--primary btn--lg" style={{ flex: 1 }} onClick={start}>
                  Play again
                </button>
                <button
                  type="button"
                  className="btn btn--lg"
                  style={{ flex: 1 }}
                  onClick={() => setCriterion(null)}
                >
                  New list
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </GameShell>
  );
}

/**
 * The list picker: a search box over grouped categories.
 *
 * Same component shape as Tenaball's, deliberately — the two games ask the
 * same question ("which of these dozens do you want?") and answering it in two
 * different ways on two adjacent pages is the kind of thing that makes a site
 * feel assembled rather than designed.
 *
 * Grouped by what the list is about, because "FNCS grand final winners —
 * Europe" and "Players with 3+ FNCS wins" are neighbours in a player's head
 * and were forty cards apart in an alphabetical wall.
 */
function ListPicker({
  criteria,
  query,
  onQuery,
  onPick,
  scope,
  statusOf,
}: {
  criteria: Criterion[];
  query: string;
  onQuery: (value: string) => void;
  onPick: (criterion: Criterion) => void;
  /** The event field in force, if any — shown so the header says what these are. */
  scope: string | null;
  statusOf: (list: string) => PuzzleStatus | null;
}) {
  const needle = query.trim().toLowerCase();
  const matching = needle
    ? criteria.filter(
        (entry) =>
          entry.title.toLowerCase().includes(needle) ||
          (entry.subtitle ?? '').toLowerCase().includes(needle),
      )
    : criteria;

  const grouped = new Map<string, Criterion[]>();
  for (const entry of matching) {
    const group = groupOf(entry);
    const bucket = grouped.get(group);
    if (bucket) bucket.push(entry);
    else grouped.set(group, [entry]);
  }

  return (
    <section className="card stack">
      <div className="row-between">
        <div className="card__title" style={{ marginBottom: 0 }}>
          {scope ? `Or pick a ${scope} list` : 'Or pick a list'}
        </div>
        <span className="tiny faint">{matching.length} available</span>
      </div>
      <StatusLegend statuses={criteria.map((entry) => statusOf(entry.id))} />
      <input
        className="input"
        value={query}
        placeholder="Search lists — “FNCS”, “Europe”, “earnings”…"
        onChange={(event) => onQuery(event.target.value)}
        aria-label="Search lists"
        autoComplete="off"
        spellCheck={false}
      />
      {matching.length === 0 ? (
        <p className="small muted">Nothing matches “{query}”.</p>
      ) : (
        <div className="picker-list">
          {[...grouped].map(([group, entries]) => (
            <div key={group} className="stack-sm">
              <h3 className="picker-list__head">{group}</h3>
              <div className="picker-list__group">
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="picker-option"
                    title={entry.subtitle}
                    onClick={() => onPick(entry)}
                  >
                    <StatusDot status={statusOf(entry.id)} />
                    {entry.title}{' '}
                    <span className="faint">· {entry.answers.length}</span>
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

/** Which heading a list sits under, read off its id prefix. */
function groupOf(criterion: Criterion): string {
  const [kind, year] = criterion.id.split(':');
  switch (kind) {
    case 'season':
      return `The ${year} season`;
    case 'pool':
      return 'Qualified fields';
    case 'both':
    case 'every-global':
    case 'finals-pair':
      return 'Two events at once';
    case 'fncs':
    case 'fncs-wins':
    case 'fncs-apps':
    case 'fncs-back-to-back':
    case 'fncs-age':
      return 'FNCS';
    case 'earnings':
    case 'year-earnings':
      return 'Earnings';
    case 'won-in-year':
    case 'fncs-every':
      return 'Year by year';
    case 'country-fncs':
    case 'country-earnings':
    case 'country-lan':
    case 'countries-over':
      return 'By country';
    case 'org':
      return 'Organisations';
    case 'with':
      return 'Teammates';
    case 'divcup-finals':
    case 'divcup-wins':
    case 'divcup-won':
    case 'divcup-every':
      return 'Div Cups';
    case 'fpe-sessions':
      return 'Performance Evaluations';
    default:
      return 'Titles';
  }
}
