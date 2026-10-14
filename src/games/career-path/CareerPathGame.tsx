import { useCallback, useMemo, useState } from 'react';
import { poolSetup, sendStart, useRoundRecorder } from '@/analytics/client';
import { GameShell } from '@/components/GameShell';
import { GiveUpButton } from '@/components/GiveUpButton';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { PlayerSearch } from '@/components/PlayerSearch';
import { PoolSetup } from '@/components/PoolSetup';
import { SecretCard } from '@/components/SecretCard';
import { DailyEnd, DailyPending } from '@/components/DailyEnd';
import { Banner, OptionCard, OptionGrid, Stat } from '@/components/ui';
import { clueGrid, clueResult, snapClues } from '@/daily/clue-round';
import { useDailyRound, usePlayMode } from '@/daily/useDailyRound';
import { restoreDaily } from './daily';
import type { MajorResult, Majors } from '@/data/liquipedia/majors';
import type { Pools } from '@/data/liquipedia/pools';
import type { Roster } from '@/data/liquipedia/roster';
import { useMajors } from '@/data/liquipedia/useMajors';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import { rotationKey } from '@/games/shared/rotation';
import { activePool, useEventMode } from '@/games/shared/mode';
import { dealSecret, poolPlayers, poolScope, resolvePool, usePoolChoice } from '@/games/shared/pool';
import { moneyShort, ordinal, plural } from '@/lib/format';
import { readLocal, writeLocal } from '@/lib/storage';
import { getGame } from '@/games/registry';
import {
  cluesLeft,
  createGame,
  giveUp,
  guessesLeft,
  MIN_GUESSES,
  revealNext,
  submitGuess,
  type GameState,
  type Mode,
  record as roundRecord,
} from './engine';
import './career-path.css';

const meta = getGame('career-path')!;

// Random first and the default since 14 Oct 2026 (the user: "random would be a
// better game mode overall, with like last placements which give you better
// information").
const MODES: { id: Mode; label: string; hint: string }[] = [
  {
    id: 'random',
    label: 'Random',
    hint: 'Ten results from any year, best results last.',
  },
  {
    id: 'order',
    label: 'Order',
    hint: 'Ten results from across the career, oldest first.',
  },
];

export default function CareerPathGame() {
  const { roster, error: rosterError } = useRoster();
  const { majors, error: majorsError } = useMajors();
  const { pools } = usePools();

  return (
    <LiquipediaGate error={rosterError ?? majorsError} ready={Boolean(roster && majors)}>
      {roster && majors ? <Game roster={roster} majors={majors} pools={pools} /> : null}
    </LiquipediaGate>
  );
}

function Game({ roster, majors, pools }: { roster: Roster; majors: Majors; pools: Pools | null }) {
  const [choice, setChoice] = usePoolChoice();
  const [event] = useEventMode();
  const [mode, setMode] = useState<Mode>('random');
  const byId = useMemo(() => new Map(roster.players.map((player) => [player.id, player])), [roster]);
  const [dailyOn, setDailyOn] = usePlayMode('career-path');
  const daily = useDailyRound('career-path', {
    on: dailyOn,
    ready: true,
    restore: (puzzle, saved) => restoreDaily(puzzle, majors, byId, saved),
    snapshot: snapClues,
    finished: (state) => state.status !== 'playing',
    result: clueResult,
  });
  const [practice, setPractice] = useState<GameState | null>(null);
  const game = dailyOn ? daily.state : practice;
  const setGame = (next: GameState) => (dailyOn ? daily.setState(next) : setPractice(next));

  useRoundRecorder('career-path', dailyOn ? daily.endedHere : game !== null && game.status !== 'playing', () => ({
    title: `Career Path — ${game!.secret.name}`,
    data: majors.generated,
    setup: dailyOn ? { daily: daily.day, mode: game!.mode } : poolSetup(event, choice, game!.mode),
    ...roundRecord(game!),
  }));
  const shell = { game: meta, dataNote: <RosterNote />, daily: { on: dailyOn, number: daily.number, setOn: setDailyOn } };
  const [error, setError] = useState<string | null>(null);

  // An event field asks about anyone in it with a major; the whole roster only
  // about careers long enough to read (see `Majors.inField`).
  const field = activePool(pools, event);
  const eligible = field ? majors.inField : majors.eligible;

  /** Who the guess box takes: every usual answer, plus the field's own when one is in force. */
  const answerable = useMemo(() => {
    const usual = majors.eligible(roster.players);
    if (!field) return usual;
    const known = new Set(usual.map((player) => player.id));
    return [
      ...usual,
      ...majors.inField(poolPlayers(roster, pools, event)).filter((player) => !known.has(player.id)),
    ];
  }, [roster, majors, field, pools, event]);

  const players = useMemo(
    () => resolvePool(roster, pools, event, choice, eligible, 10),
    [roster, pools, event, choice, eligible],
  );

  const start = useCallback(() => {
    const key = rotationKey(meta.id, ...poolScope(event, choice));
    const drawn = dealSecret(players, readLocal<string[]>(key, []), pools, event, choice);
    if (!drawn) {
      setError(
        field
          ? 'Nobody in this field has a major on record.'
          : `No player in this pool has ${majors.minAppearances} majors on record.`,
      );
      return;
    }
    writeLocal(key, drawn.seen);
    setError(null);
    sendStart('career-path', false);
    setPractice(createGame(drawn.pick, majors.resultsFor(drawn.pick.id), mode, majors));
  }, [players, pools, event, choice, majors, mode, field]);

  if (!game && dailyOn) {
    return (
      <GameShell {...shell}>
        <DailyPending status={daily.status} error={daily.error} game="career-path" played={daily.played} />
      </GameShell>
    );
  }

  if (!game) {
    return (
      <GameShell {...shell}>
        <div className="stack">
          <PoolSetup
            roster={roster}
            pools={pools}
            event={event}
            value={choice}
            onChange={setChoice}
            eligible={eligible}
            onStart={start}
            startLabel="Start"
            extra={
              <section className="card stack">
                <div className="card__title">Clue order</div>
                <OptionGrid>
                  {MODES.map((option) => (
                    <OptionCard
                      key={option.id}
                      label={option.label}
                      hint={option.hint}
                      selected={mode === option.id}
                      onClick={() => setMode(option.id)}
                    />
                  ))}
                </OptionGrid>
              </section>
            }
          />
          {error ? (
            <Banner tone="danger" title="Cannot start">
              {error}
            </Banner>
          ) : null}
          <p className="tiny faint center">
            {plural(majors.tournaments.length, 'major')} on record ·{' '}
            {field
              ? `${players.length} of the field's ${plural(field.players.length, 'player')} with at least one`
              : `${plural(answerable.length, 'player')} with at least ${majors.minAppearances} of them`}
          </p>
        </div>
      </GameShell>
    );
  }

  const finished = game.status !== 'playing';
  const visible = game.clues.slice(0, game.revealed);
  const guessedIds = new Set(game.guesses.map((p) => p.id));
  /** A career shorter than the guesses every round gets — see `MIN_GUESSES`. */
  const short = game.clues.length < MIN_GUESSES;
  const left = guessesLeft(game);

  return (
    <GameShell
      {...shell}
      toolbar={
        dailyOn ? null : (
          <>
            <button type="button" className="icon-btn" onClick={start}>
              ↺ New player
            </button>
            <button type="button" className="icon-btn" onClick={() => setPractice(null)}>
              ⚙ Setup
            </button>
          </>
        )
      }
    >
      <div className="stack">
        <div className="stats">
          <Stat label="Clues used" value={`${finished ? game.earned : game.revealed}/${game.clues.length}`} />
          <Stat label="Guesses" value={short ? `${game.guesses.length}/${MIN_GUESSES}` : game.guesses.length} />
          {dailyOn ? null : <Stat label="Mode" value={game.mode === 'order' ? 'Order' : 'Random'} />}
        </div>

        <section className="card stack">
          <div className="card__title">
            {game.mode === 'order' ? 'Career path — oldest first' : 'Career path — best results last'}
          </div>
          {/*
            One list, start to finish. Ending the round fills in the rest of the
            ten *here*, continuing what you were already reading, rather than
            printing a second copy of the career in a card underneath the
            answer. Clues you never needed are dimmed.
          */}
          {/*
            Every clue's slot is on the board from the start, the ones still
            to come dashed with a ?, so you can see how much career is left.
            Numbered, so Order reads oldest first without arrows to wrap.
          */}
          <ol className="board-grid board-grid--five list-reset">
            {game.clues.map((clue, index) => (
              <li key={clue.result.tournament.name} className="board-step">
                {index < visible.length ? (
                  <ResultCard
                    number={index + 1}
                    result={clue.result}
                    isNew={index === visible.length - 1 && !finished}
                    dim={finished && index >= game.earned}
                  />
                ) : (
                  <div className="board-card board-card--hidden">
                    <span className="board-card__num">{index + 1}</span>
                    <span className="board-card__q">?</span>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="board-progress" aria-hidden="true">
            {game.clues.map((clue, index) => (
              <span
                key={clue.result.tournament.name}
                className={index < (finished ? game.earned : game.revealed) ? 'is-on' : ''}
              />
            ))}
          </div>
          {finished && game.clues.length > game.earned ? (
            <p className="tiny faint" style={{ margin: 0 }}>
              You got there on {plural(game.earned, 'clue')} — the dimmed{' '}
              {plural(game.clues.length - game.earned, 'result')} below{' '}
              {game.clues.length - game.earned === 1 ? 'was' : 'were'} still to come.
            </p>
          ) : null}
          {short && !finished ? (
            <p className="tiny faint" style={{ margin: 0 }}>
              A short career: {plural(game.clues.length, 'major')} on record, so this is all there is.
              You still get {MIN_GUESSES} guesses — the ones after the last clue reveal nothing new.
            </p>
          ) : null}
        </section>

        {finished ? (
          <div className="stack">
            <Banner
              tone={game.status === 'won' ? 'success' : 'danger'}
              title={
                game.status === 'won'
                  ? `Got it in ${game.guesses.length}!`
                  : game.gaveUp
                    ? 'Round over'
                    : short
                      ? 'Out of guesses'
                      : 'Out of clues'
              }
            >
              The player was <strong>{game.secret.name}</strong>.
            </Banner>
            <SecretCard player={game.secret} />

            {dailyOn ? (
              <DailyEnd
                game="career-path"
                number={daily.number}
                day={daily.day}
                result={clueResult(game)}
                grid={clueGrid(game)}
              />
            ) : (
              <button type="button" className="btn btn--primary btn--lg btn--block" onClick={start}>
                Next player
              </button>
            )}
          </div>
        ) : (
          <div className="stack-sm">
            <PlayerSearch
              players={answerable}
              onPick={(player) => setGame(submitGuess(game, player))}
              exclude={guessedIds}
              autoFocus
            />
            {/*
              Side by side: taking a clue and quitting are the two ways out of a
              round you are stuck in, and they belong on the same line so you
              can weigh one against the other. Give up is the red one, on the
              right, where a destructive action is expected.
            */}
            <div className="action-pair">
              <button
                type="button"
                className="btn"
                onClick={() => setGame(revealNext(game))}
                disabled={cluesLeft(game) === 0}
              >
                {cluesLeft(game) > 0
                  ? `Reveal next clue (${cluesLeft(game)} left)`
                  : left > 1
                    ? `All clues revealed — ${left} guesses left`
                    : 'All clues revealed — last guess!'}
              </button>
              <GiveUpButton onGiveUp={() => setGame(giveUp(game))} variant="danger" />
            </div>
          </div>
        )}

        {game.guesses.length > 0 ? (
          <section className="card stack-sm">
            <div className="card__title">Your guesses</div>
            <div className="row">
              {game.guesses.map((player) => (
                <span
                  key={player.id}
                  className={`chip ${player.id === game.secret.id ? 'chip--success' : 'chip--danger'}`}
                >
                  {player.name}
                </span>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </GameShell>
  );
}

/** A finish as a medal: gold, silver, bronze, the top ten in green. */
function medalClass(placement: number): string {
  if (placement === 1) return 'medal medal--gold';
  if (placement === 2) return 'medal medal--silver';
  if (placement === 3) return 'medal medal--bronze';
  return placement <= 10 ? 'medal medal--top10' : 'medal';
}

function ResultCard({
  number,
  result,
  isNew,
  dim,
}: {
  number: number;
  result: MajorResult;
  isNew?: boolean;
  /** A clue the round never needed, once it is over. */
  dim?: boolean;
}) {
  const { tournament, placement } = result;
  return (
    <div className={`board-card${isNew ? ' board-card--new' : ''}${dim ? ' board-card--late' : ''}`}>
      <span className="board-card__num">{number}</span>
      {isNew ? <span className="board-card__flag">new</span> : null}
      <span className={medalClass(placement)} aria-label={`Placed ${ordinal(placement)}`}>
        {ordinal(placement)}
      </span>
      <span className="board-card__title">{tournament.shortName}</span>
      <span className="board-card__meta">
        {tournament.mode ? `${tournament.mode} · ` : ''}
        {tournament.year}
        {tournament.prizePool ? ` · ${moneyShort(tournament.prizePool)}` : ''}
      </span>
    </div>
  );
}
