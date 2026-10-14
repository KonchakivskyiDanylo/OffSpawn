import { useCallback, useMemo, useState } from 'react';
import { sendStart, useRoundRecorder } from '@/analytics/client';
import { ClueActions } from '@/components/ClueControls';
import { GameShell } from '@/components/GameShell';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { LevelSetup, type LevelOption } from '@/components/PoolSetup';
import { Banner, Stat } from '@/components/ui';
import type { Majors } from '@/data/liquipedia/majors';
import type { Roster } from '@/data/liquipedia/roster';
import { useMajors } from '@/data/liquipedia/useMajors';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import { getGame } from '@/games/registry';
import { giveUp, guess, skip } from '@/games/shared/clue-round';
import { dealFresh, LEVEL_LABEL, type Level } from '@/games/shared/levels';
import { lobbyTitle, type Lobby } from '@/games/shared/lobbies';
import { dayMonthYear, moneyShort, plural } from '@/lib/format';
import {
  asNamed,
  compare,
  createGame,
  CUT,
  finisherName,
  lobbiesFor,
  record as roundRecord,
  REGION_ORDER,
  type GameState,
} from './engine';
import './which-lobby.css';

const meta = getGame('which-lobby')!;

const LEVELS: LevelOption<Level>[] = [
  { id: 'easy', label: LEVEL_LABEL.easy, hint: 'The major LANs and the Europe and North America finals. Famous finishers.' },
  { id: 'medium', label: LEVEL_LABEL.medium, hint: 'NA West and Brazil too.' },
  { id: 'hard', label: LEVEL_LABEL.hard, hint: 'Every region, anyone in the results.' },
];

export default function WhichLobbyGame() {
  const { roster, error: rosterError } = useRoster();
  const { majors, error: majorsError } = useMajors();
  return (
    <LiquipediaGate error={rosterError ?? majorsError} ready={Boolean(roster && majors)}>
      {roster && majors ? <Game roster={roster} majors={majors} /> : null}
    </LiquipediaGate>
  );
}

function Game({ roster, majors }: { roster: Roster; majors: Majors }) {
  const { pools } = usePools();
  const [level, setLevel] = useState<Level>('easy');
  const [game, setGame] = useState<GameState | null>(null);
  /** The picker's level, fixed when the round starts so changing setup mid-round changes nothing. */
  const [dealt, setDealt] = useState<Level>('easy');
  const [error, setError] = useState<string | null>(null);
  const byId = useMemo(() => new Map(roster.players.map((player) => [player.id, player])), [roster]);
  const lobbies = useMemo(() => lobbiesFor(majors, dealt), [majors, dealt]);
  const byName = useMemo(() => new Map(lobbies.map((lobby) => [lobby.name, lobby])), [lobbies]);

  useRoundRecorder('which-lobby', game !== null && game.status !== 'playing', () => ({
    title: `Which Lobby? — ${game!.secret.name}`,
    data: majors.generated,
    setup: { level: dealt },
    ...roundRecord(game!),
  }));

  const start = useCallback(() => {
    const pool = lobbiesFor(majors, level).map((lobby) => ({ ...lobby, id: lobby.name }));
    const lobby = dealFresh(meta.id, [level], pool);
    if (!lobby) {
      setError('No tournament at this level has results on record.');
      return;
    }
    setError(null);
    setDealt(level);
    sendStart('which-lobby', false);
    setGame(createGame(lobby, majors, byId, level));
  }, [majors, level, byId]);

  if (!game) {
    return (
      <GameShell game={meta}>
        <div className="stack">
          <LevelSetup pools={pools} event={null} levels={LEVELS} value={level} onChange={setLevel} onStart={start} />
          {error ? (
            <Banner tone="danger" title="Cannot start">
              {error}
            </Banner>
          ) : null}
        </div>
      </GameShell>
    );
  }

  const finished = game.status !== 'playing';
  const secret = game.secret.lobby;
  const guessed = new Set(game.guesses.map((g) => g.id));

  return (
    <GameShell
      game={meta}
      dataNote={<RosterNote />}
      toolbar={
        <>
          <button type="button" className="icon-btn" onClick={start}>
            ↺ New lobby
          </button>
          <button type="button" className="icon-btn" onClick={() => setGame(null)}>
            ⚙ Setup
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="stats">
          <Stat label="Finishers" value={`${finished ? game.earned : game.revealed}/${game.clues.length}`} />
          <Stat label="Guesses" value={game.guesses.length} />
          <Stat label="Format" value={secret.mode ?? '—'} />
        </div>

        <section className="wl-board" aria-label="Leaderboard">
          <header className="wl-board__head">
            <span>Leaderboard</span>
            <span className="wl-board__event">{finished ? game.secret.name : '???'}</span>
          </header>
          <ol className="wl-rows list-reset">
            {[...game.clues.keys()].reverse().map((index) => {
              const finisher = game.clues[index];
              const open = index < game.revealed;
              const late = finished && index >= game.earned;
              const isNew = !finished && index === game.revealed - 1;
              const place = finisher.placement;
              return (
                <li
                  key={index}
                  className={`wl-row${open ? '' : ' wl-row--hidden'}${isNew ? ' wl-row--new' : ''}${late ? ' wl-row--late' : ''}${open && place <= 3 ? ` wl-row--p${place}` : ''}`}
                >
                  <span className="wl-row__place">{open ? `#${place}` : '#?'}</span>
                  <span className="wl-row__who">{open ? finisherName(finisher) : '—'}</span>
                </li>
              );
            })}
          </ol>
          {/* The same top 20 for every lobby: how far the results went would name the event. */}
          <footer className="wl-board__foot tiny">
            {secret.mode ? `${secret.mode}s` : 'Results'} · top {CUT}
          </footer>
        </section>

        {finished ? (
          <div className="stack">
            <Banner
              tone={game.status === 'won' ? 'success' : 'danger'}
              title={
                game.status === 'won'
                  ? `Got it in ${plural(game.earned, 'finisher')}!`
                  : game.gaveUp
                    ? 'Round over'
                    : 'Out of finishers'
              }
            >
              It was <strong>{secret.name.replace(/\s+/g, ' ')}</strong>
              {secret.prizePool ? `, ${moneyShort(secret.prizePool)} prize pool` : ''}, {dayMonthYear(secret.date)}.
            </Banner>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={start}>
              Next lobby
            </button>
          </div>
        ) : (
          <div className="stack-sm">
            <Picker lobbies={lobbies} guessed={guessed} onGuess={(lobby) => setGame(guess(game, asNamed(lobby)))} />
            <ClueActions
              round={game}
              noun="finisher"
              onReveal={() => setGame(skip(game))}
              onGiveUp={() => setGame(giveUp(game))}
            />
          </div>
        )}

        {game.guesses.length ? (
          <section className="card stack-sm">
            <div className="card__title">Your guesses</div>
            <ul className="wl-guesses list-reset">
              {game.guesses.map((g) => {
                const lobby = byName.get(g.id);
                const right = g.id === game.secret.id;
                const verdict = lobby && !right ? compare(lobby, secret) : null;
                return (
                  <li key={g.id} className={`wl-guess${right ? ' wl-guess--right' : ''}`}>
                    <span className="wl-guess__name">{g.name}</span>
                    {right ? (
                      <span className="chip chip--success">✓ That’s it</span>
                    ) : verdict ? (
                      <span className="row" style={{ gap: 6 }}>
                        <span className={`chip ${verdict.when === 'same' ? 'chip--success' : 'chip--warning'}`}>
                          {verdict.when === 'same' ? '✓ Round' : verdict.when === 'earlier' ? '⬆ Earlier' : '⬇ Later'}
                        </span>
                        <span className={`chip ${verdict.region ? 'chip--success' : 'chip--danger'}`}>
                          {verdict.region ? '✓ Region' : '✗ Region'}
                        </span>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </div>
    </GameShell>
  );
}

/**
 * Year, then round, then region. Three taps rather than typing one of 186
 * names that differ by a word; a round with one lobby — a LAN — guesses on the
 * second tap's Guess.
 */
function Picker({
  lobbies,
  guessed,
  onGuess,
}: {
  lobbies: readonly Lobby[];
  guessed: ReadonlySet<string>;
  onGuess: (lobby: Lobby) => void;
}) {
  const years = useMemo(() => [...new Set(lobbies.map((lobby) => lobby.year))], [lobbies]);
  const [year, setYear] = useState<number>(years[years.length - 1]);
  const [round, setRound] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Lobby | null>(null);

  const rounds = useMemo(() => {
    const out = new Map<string, Lobby[]>();
    for (const lobby of lobbies) {
      if (lobby.year !== year) continue;
      out.set(lobby.round, [...(out.get(lobby.round) ?? []), lobby]);
    }
    return [...out.entries()];
  }, [lobbies, year]);
  const regions = (rounds.find(([key]) => key === round)?.[1] ?? []).slice().sort(
    (a, b) => REGION_ORDER.indexOf(a.variant ?? '') - REGION_ORDER.indexOf(b.variant ?? ''),
  );

  const pickRound = (key: string, members: Lobby[]) => {
    setRound(key);
    setChosen(members.length === 1 ? members[0] : null);
  };

  return (
    <section className="card stack-sm wl-picker">
      <div className="wl-picker__years" role="tablist" aria-label="Year">
        {years.map((y) => (
          <button
            key={y}
            type="button"
            role="tab"
            aria-selected={y === year}
            className="wl-year"
            onClick={() => {
              setYear(y);
              setRound(null);
              setChosen(null);
            }}
          >
            {y}
          </button>
        ))}
      </div>
      <div className="wl-chips">
        {rounds.map(([key, members]) => {
          const done = members.every((lobby) => guessed.has(lobby.name));
          return (
            <button
              key={key}
              type="button"
              className="wl-chip"
              aria-pressed={round === key}
              disabled={done}
              onClick={() => pickRound(key, members)}
            >
              {members[0].label}
            </button>
          );
        })}
      </div>
      {round && regions.length > 1 ? (
        <div className="wl-chips wl-chips--regions">
          {regions.map((lobby) => (
            <button
              key={lobby.name}
              type="button"
              className="wl-chip wl-chip--region"
              aria-pressed={chosen?.name === lobby.name}
              disabled={guessed.has(lobby.name)}
              onClick={() => setChosen(lobby)}
            >
              {lobby.variant}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className="btn btn--primary"
        disabled={!chosen || guessed.has(chosen.name)}
        onClick={() => {
          if (!chosen) return;
          onGuess(chosen);
          setChosen(null);
          setRound(null);
        }}
      >
        {chosen ? `Guess ${year} ${lobbyTitle(chosen)}` : 'Pick a round and a region'}
      </button>
    </section>
  );
}
