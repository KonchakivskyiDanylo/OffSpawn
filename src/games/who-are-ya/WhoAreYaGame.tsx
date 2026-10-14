import { useCallback, useMemo, useState } from 'react';
import { poolSetup, sendStart, useRoundRecorder } from '@/analytics/client';
import { GameShell } from '@/components/GameShell';
import { GiveUpButton } from '@/components/GiveUpButton';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { PlayerSearch } from '@/components/PlayerSearch';
import { PoolSetup } from '@/components/PoolSetup';
import { SecretCard } from '@/components/SecretCard';
import { DailyEnd, DailyPending } from '@/components/DailyEnd';
import { Banner, OptionCard, OptionGrid, Stat } from '@/components/ui';
import { clueGrid, clueResult, snapClues } from '@/daily/clue-round';
import { useDailyRound, usePlayMode } from '@/daily/useDailyRound';
import { restoreDaily } from './daily';
import type { Facts } from '@/data/liquipedia/facts';
import type { Pools } from '@/data/liquipedia/pools';
import type { Roster, RosterPlayer } from '@/data/liquipedia/roster';
import type { Teammates } from '@/data/liquipedia/teammates';
import { useFacts } from '@/data/liquipedia/useFacts';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import { useTeammates } from '@/data/liquipedia/useTeammates';
import { rotationKey } from '@/games/shared/rotation';
import { activePool, useEventMode } from '@/games/shared/mode';
import { dealSecret, poolPlayers, poolScope, resolvePool, usePoolChoice } from '@/games/shared/pool';
import { guessesLeft, MIN_GUESSES } from '@/games/career-path/engine';
import { plural } from '@/lib/format';
import { readLocal, writeLocal } from '@/lib/storage';
import { getGame } from '@/games/registry';
import {
  cluesLeft,
  createGame,
  giveUp,
  MIN_CLUES,
  MIN_TOURNAMENTS,
  revealNext,
  showsMatches,
  submitGuess,
  type GameState,
  type Mode,
  record as roundRecord,
  usableClues,
} from './engine';

const meta = getGame('who-are-ya')!;

/**
 * The three clue orders.
 *
 * Named for what they do rather than Easy/Hard, because the fame difficulty
 * above them already owns those words and two Easys on one screen mean two
 * different things.
 */
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'easy', label: 'Counts shown', hint: 'Fewest to most shared tournaments, with each count.' },
  { id: 'hard', label: 'Counts hidden', hint: 'The same order, no numbers.' },
  {
    id: 'random',
    label: 'Random order',
    hint: 'Shuffled, no counts. The top teammate is never in the first four.',
  },
];

export default function WhoAreYaGame() {
  const { roster, error: rosterError } = useRoster();
  const { teammates, error: teammatesError } = useTeammates();
  const { facts, error: factsError } = useFacts();
  const { pools } = usePools();

  return (
    <LiquipediaGate
      error={rosterError ?? teammatesError ?? factsError}
      ready={Boolean(roster && teammates && facts)}
    >
      {roster && teammates && facts ? (
        <Game roster={roster} teammates={teammates} facts={facts} pools={pools} />
      ) : null}
    </LiquipediaGate>
  );
}

function Game({
  roster,
  teammates,
  facts,
  pools,
}: {
  roster: Roster;
  teammates: Teammates;
  facts: Facts;
  pools: Pools | null;
}) {
  const [choice, setChoice] = usePoolChoice();
  const [event] = useEventMode();
  const [mode, setMode] = useState<Mode>('easy');
  const byId = useMemo(() => new Map(roster.players.map((player) => [player.id, player])), [roster]);
  const [dailyOn, setDailyOn] = usePlayMode('who-are-ya');
  const daily = useDailyRound('who-are-ya', {
    on: dailyOn,
    ready: true,
    restore: (puzzle, saved) => restoreDaily(puzzle, teammates, byId, saved),
    snapshot: snapClues,
    finished: (state) => state.status !== 'playing',
    result: clueResult,
  });
  const [practice, setPractice] = useState<GameState | null>(null);
  const game = dailyOn ? daily.state : practice;
  const setGame = (next: GameState) => (dailyOn ? daily.setState(next) : setPractice(next));

  useRoundRecorder('who-are-ya', dailyOn ? daily.endedHere : game !== null && game.status !== 'playing', () => ({
    title: `${meta.title} — ${game!.secret.name}`,
    data: teammates.generated,
    setup: dailyOn ? { daily: daily.day, mode: game!.mode } : poolSetup(event, choice, game!.mode),
    ...roundRecord(game!),
  }));
  const [error, setError] = useState<string | null>(null);
  const shell = { game: meta, dataNote: <RosterNote />, daily: { on: dailyOn, number: daily.number, setOn: setDailyOn } };
  const cluesFor = useCallback(
    // Only teammates worth a clue (`MIN_SHARED`), so every count below is a count of real hands.
    (playerId: string) => usableClues(teammates.cluesFor(playerId, byId)),
    [teammates, byId],
  );

  /**
   * A player can only be the answer with enough teammates *and* enough majors
   * — an `unused` teammate has no row to show and no name to guess, and a
   * three-major career is not something anyone can recognise.
   *
   * An event field asks about everyone in it with a teammate at all: a player
   * who qualified is worth a round however short their record, and a short
   * hand still gets `MIN_GUESSES` guesses.
   */
  const field = activePool(pools, event);
  const onRoster = useCallback(
    (players: RosterPlayer[]) =>
      players.filter(
        (player) =>
          cluesFor(player.id).length >= MIN_CLUES && facts.of(player.id).apps >= MIN_TOURNAMENTS,
      ),
    [cluesFor, facts],
  );
  const inField = useCallback(
    (players: RosterPlayer[]) => players.filter((player) => cluesFor(player.id).length > 0),
    [cluesFor],
  );
  const eligible = field ? inField : onRoster;

  /** Who the guess box takes: every usual answer, plus the field's own when one is in force. */
  const answerable = useMemo(() => {
    const usual = onRoster(roster.players);
    if (!field) return usual;
    const known = new Set(usual.map((player) => player.id));
    return [...usual, ...inField(poolPlayers(roster, pools, event)).filter((player) => !known.has(player.id))];
  }, [onRoster, inField, roster, field, pools, event]);
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
          ? 'Nobody in this field has a teammate on record.'
          : `No player in this pool has ${MIN_CLUES} recorded teammates and ${MIN_TOURNAMENTS} majors.`,
      );
      return;
    }
    writeLocal(key, drawn.seen);
    setError(null);
    sendStart('who-are-ya', false);
    setPractice(createGame(drawn.pick, cluesFor(drawn.pick.id), mode));
  }, [players, pools, event, choice, cluesFor, mode, field]);

  if (!game && dailyOn) {
    return (
      <GameShell {...shell}>
        <DailyPending status={daily.status} error={daily.error} game="who-are-ya" played={daily.played} />
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
            {field
              ? `${players.length} of the field's ${plural(field.players.length, 'player')} with a teammate on record`
              : `${plural(answerable.length, 'player')} with at least ${MIN_CLUES} recorded teammates and ${MIN_TOURNAMENTS} majors`}
          </p>
        </div>
      </GameShell>
    );
  }

  const finished = game.status !== 'playing';
  const visible = game.clues.slice(0, game.revealed);
  const guessedIds = new Set(game.guesses.map((p) => p.id));
  const withMatches = showsMatches(game.mode);
  /** The hand's biggest count, so each teammate's bar reads against it. */
  const topCount = Math.max(1, ...game.clues.map((clue) => clue.events));
  /** A hand shorter than the guesses every round gets — see `MIN_GUESSES`. */
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
          {dailyOn ? null : <Stat label="Order" value={MODES.find((m) => m.id === game.mode)!.label} />}
        </div>

        <section className="card stack">
          <div className="card__title">Tournament teammates</div>
          {/*
            One list, start to finish — the same change Career Path got. Ending
            the round fills in the teammates it was still holding back, here,
            dimmed; it does not print a second list of everyone on record.
          */}
          {/* Every teammate's slot on the board from the start, like Career Path's. */}
          <ol className="board-grid board-grid--five list-reset">
            {game.clues.map((clue, index) => {
              if (index >= visible.length) {
                return (
                  <li key={clue.player.id} className="board-step">
                    <div className="board-card board-card--hidden">
                      <span className="board-card__num">{index + 1}</span>
                      <span className="board-card__q">?</span>
                    </div>
                  </li>
                );
              }
              const isNew = index === visible.length - 1 && !finished;
              const shown = withMatches || finished;
              return (
                <li key={clue.player.id} className="board-step">
                  <div
                    className={`board-card${isNew ? ' board-card--new' : ''}${finished && index >= game.earned ? ' board-card--late' : ''}`}
                  >
                    <span className="board-card__num">{index + 1}</span>
                    {isNew ? <span className="board-card__flag">new</span> : null}
                    <PlayerAvatar player={clue.player} size={42} />
                    <span className="board-card__title">{clue.player.name}</span>
                    {/* Country only, spelled out: no org, no country code (the user, 13 Oct 2026). */}
                    <span className="board-card__meta">{clue.player.countryName ?? '—'}</span>
                    <span className="board-card__meta" style={{ fontWeight: 700 }}>
                      {shown ? plural(clue.events, 'tournament') : '? tournaments'}
                    </span>
                    {shown ? (
                      <span className="board-bar" aria-hidden="true">
                        <span style={{ width: `${Math.round((clue.events / topCount) * 100)}%` }} />
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
          {finished && game.clues.length > game.earned ? (
            <p className="tiny faint" style={{ margin: 0 }}>
              You got there on {plural(game.earned, 'clue')} — the dimmed{' '}
              {plural(game.clues.length - game.earned, 'teammate')}{' '}
              {game.clues.length - game.earned === 1 ? 'was' : 'were'} still to come.
            </p>
          ) : null}
          {short && !finished ? (
            <p className="tiny faint" style={{ margin: 0 }}>
              A short list: {plural(game.clues.length, 'teammate')} on record. You still get {MIN_GUESSES}{' '}
              guesses — the ones after the last clue reveal nothing new.
            </p>
          ) : null}
          <p className="tiny faint">
            Ranked by tournaments entered together, across every event in the export
            {game.mode === 'random' ? ', shown in random order.' : ', fewest first.'}
          </p>
        </section>

        {finished ? (
          <div className="stack">
            <Banner
              tone={game.status === 'won' ? 'success' : 'danger'}
              title={
                game.status === 'won'
                  ? `Got it after ${plural(game.earned, 'clue')}!`
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
                game="who-are-ya"
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
            {/* Same pairing as Career Path: take a clue, or stop. */}
            <div className="action-pair">
              <button
                type="button"
                className="btn"
                onClick={() => setGame(revealNext(game))}
                disabled={cluesLeft(game) === 0}
              >
                {cluesLeft(game) > 0
                  ? `Reveal next teammate (${cluesLeft(game)} left)`
                  : left > 1
                    ? `All teammates revealed — ${left} guesses left`
                    : 'All teammates revealed — last guess!'}
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
