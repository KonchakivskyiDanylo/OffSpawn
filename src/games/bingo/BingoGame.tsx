import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendStart, useRoundRecorder } from '@/analytics/client';
import { GameShell } from '@/components/GameShell';
import { GiveUpButton } from '@/components/GiveUpButton';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { LevelSetup, type LevelOption } from '@/components/PoolSetup';
import { Banner, Hearts, OptionCard, OptionGrid, Stat } from '@/components/ui';
import type { Facts } from '@/data/liquipedia/facts';
import type { Orgs } from '@/data/liquipedia/orgs';
import type { Roster } from '@/data/liquipedia/roster';
import { loadTeammates, type Teammates } from '@/data/liquipedia/teammates';
import { useFacts } from '@/data/liquipedia/useFacts';
import { useOrgs } from '@/data/liquipedia/useOrgs';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import { getGame } from '@/games/registry';
import type { PlayerCriterion } from '@/games/shared/criteria';
import { LEVEL_LABEL } from '@/games/shared/levels';
import { formatClock, plural } from '@/lib/format';
import { useLocalState } from '@/lib/storage';
import {
  createGame,
  current,
  generateBoard,
  giveUp,
  LEVELS,
  lines,
  livesLeft,
  outcomeOf,
  place,
  record as roundRecord,
  score,
  skip,
  solutionFor,
  SQUARES,
  tick,
  timeLeft,
  type Difficulty,
  type GameState,
  type Mode,
} from './engine';
import './bingo.css';
import { useSocials } from '@/data/useSocials';

const meta = getGame('bingo')!;

const MODE_OPTIONS: { id: Mode; label: string; hint: string }[] = [
  { id: 'deck', label: '🃏 Deck', hint: 'A set deck, each player once. A full card is always in it.' },
  { id: 'timed', label: '⏱️ Timed', hint: 'Random players until the clock runs out. They can come back.' },
  { id: 'endless', label: '♾️ Endless', hint: 'Random players and no clock. They can come back.' },
];

/** Who each level deals: after a deck's size, and on its own. */
const WHO: Record<Difficulty, { counted: string; alone: string }> = {
  easy: { counted: 'famous players', alone: 'Famous players' },
  medium: { counted: 'players, the regulars too', alone: 'The regulars too' },
  hard: { counted: 'players from anywhere', alone: 'Players from anywhere' },
};

function difficulties(mode: Mode): LevelOption<Difficulty>[] {
  return (['easy', 'medium', 'hard'] as const).map((id) => {
    const { deck, seconds, lives } = LEVELS[id];
    const who =
      mode === 'deck'
        ? `${deck} ${WHO[id].counted}`
        : mode === 'timed'
          ? `${WHO[id].alone}, ${formatClock(seconds)} on the clock`
          : WHO[id].alone;
    return { id, label: LEVEL_LABEL[id], hint: `${who}. ${plural(lives, 'life', 'lives')}.` };
  });
}

/** A full card's score as words: seconds on Timed, players otherwise (see `score`). */
function scoreText(mode: Mode, value: number): string {
  return mode === 'timed' ? `${value.toFixed(1)}s` : plural(value, 'player');
}

/**
 * The best full card for a mode and level, lower better (`score`).
 * `useBestScore` only keeps a high score, so this keeps its own.
 */
function useBest(mode: Mode, difficulty: Difficulty) {
  const [best, setBest] = useLocalState<number | null>(`best:bingo:${mode}:${difficulty}`, null);
  const submit = useCallback(
    (value: number) => setBest((prev) => (prev === null || value < prev ? value : prev)),
    [setBest],
  );
  return { best, submit };
}

/**
 * A square's label: short enough for a 4×4 card on a phone ("Played Fortnite
 * World Cup Finals - Duos" does not fit in 80 pixels), and a whole phrase —
 * Tic Tac Toe's headers can say "XSET", but a lone square reading "XSET"
 * could mean anything.
 */
function squareLabel(square: PlayerCriterion): string {
  if (square.kind === 'org') return `Played for ${square.short}`;
  if (square.kind === 'country') return `From ${square.short}`;
  if (square.kind === 'region') return `Competes in ${square.short}`;
  return square.short
    .replace(/FNCS (\d{4})\s+Global Championship/, 'Globals $1')
    .replace(/Fortnite World Cup Finals - (\w+)/, 'World Cup $1')
    .replace(/Reload Elite Series (\d{4}) - Championship/, 'EWC $1')
    .replace(/FNCS (\d{4}) Major 1 Summit/, 'the $1 Summit')
    .replace(/FNCS: Invitational (\d{4})/, 'the $1 Invitational');
}

export default function BingoGame() {
  const { roster, error: rosterError } = useRoster();
  const { facts, error: factsError } = useFacts();
  const { orgs, error: orgsError } = useOrgs();

  return (
    <LiquipediaGate error={rosterError ?? factsError ?? orgsError} ready={Boolean(roster && facts && orgs)}>
      {roster && facts && orgs ? <Game roster={roster} facts={facts} orgs={orgs} /> : null}
    </LiquipediaGate>
  );
}

function Game({ roster, facts, orgs }: { roster: Roster; facts: Facts; orgs: Orgs }) {
  const socials = useSocials();
  const { pools } = usePools();
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [mode, setMode] = useState<Mode>('deck');
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: string; message: string } | null>(null);
  const { best, submit: submitBest } = useBest(mode, difficulty);
  /** The best as it stood when the round began, so the end can say whether this one beat it. */
  const bestBefore = useRef<number | null>(null);

  /*
   * The clock: when the round began, and the engine told the time before every
   * move and ten times a second on Timed. Reading `Date.now()` rather than
   * counting ticks keeps it right when a tick is late or the tab sleeps.
   */
  const startedAt = useRef(0);
  const elapsed = () => (Date.now() - startedAt.current) / 1000;
  const ticking = game !== null && game.status === 'playing' && game.board.mode === 'timed';
  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setGame((prev) => (prev ? tick(prev, elapsed()) : prev)), 100);
    return () => window.clearInterval(id);
  }, [ticking]);

  /*
   * Teammate counts, for the "10+ tournaments with X" squares. Loaded after
   * the first paint and not waited for: without them those squares simply do
   * not come up.
   */
  const [teammates, setTeammates] = useState<Teammates | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadTeammates().then(
      (loaded) => !cancelled && setTeammates(loaded),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useRoundRecorder('bingo', game !== null && game.status === 'over', () => ({
    title: `Bingo — ${game!.board.mode}, ${game!.difficulty}`,
    data: facts.generated,
    setup: { level: game!.difficulty, mode: game!.board.mode },
    ...roundRecord(game!),
  }));

  useEffect(() => {
    const value = game && game.status === 'over' ? score(game) : null;
    if (value !== null) submitBest(value);
  }, [game, submitBest]);

  const answers = useMemo(() => {
    const eligible = facts.eligible(3);
    return LEVELS[difficulty].bands.flatMap((band) => roster.exactly(band, { eligible }));
  }, [facts, roster, difficulty]);

  const start = useCallback(() => {
    const board = generateBoard(
      { facts, orgs, socials, teammates, roster: roster.players },
      { answers },
      difficulty,
      String(Date.now()),
      mode,
    );
    if (!board) {
      setError('Could not build a card from this data.');
      return;
    }
    setError(null);
    setFeedback(null);
    sendStart('bingo', false);
    bestBefore.current = best;
    startedAt.current = Date.now();
    setGame(createGame(board, difficulty));
  }, [facts, orgs, socials, teammates, roster, answers, difficulty, mode, best]);

  if (!game) {
    return (
      <GameShell game={meta} dataNote={<RosterNote />}>
        <div className="stack">
          <LevelSetup
            pools={pools}
            event={null}
            levels={difficulties(mode)}
            value={difficulty}
            onChange={setDifficulty}
            onStart={start}
            startLabel="New card"
            extra={
              <section className="card stack">
                <div className="card__title">Mode</div>
                <OptionGrid>
                  {MODE_OPTIONS.map((option) => (
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
        </div>
      </GameShell>
    );
  }

  const { board } = game;
  const player = current(game);
  const finished = game.status === 'over';
  const inLine = new Set(lines(game).flat());
  const left = board.deck.length - game.turn;
  const clock = timeLeft(game);
  const low = clock !== null && clock <= 10;

  const onSquare = (square: number) => {
    // Told the time first, so a tap after the clock ran out is refused.
    const now = tick(game, elapsed());
    const result = place(now, square);
    if (!result) {
      setGame(now);
      return;
    }
    setGame(result.state);
    const name = current(now)!.name;
    if (result.outcome.kind === 'placed') {
      setFeedback({ tone: 'var(--success)', message: `${name} → ${squareLabel(board.squares[square])}.` });
    } else {
      const fits = result.outcome.fits.map((index) => squareLabel(board.squares[index]));
      setFeedback({
        tone: 'var(--danger)',
        message: `${name} is not “${squareLabel(board.squares[square])}”. ${
          fits.length ? `${name} would have fitted: ${fits.join(', ')}.` : `${name} fitted no open square — a skip.`
        }`,
      });
    }
  };

  const outcome = outcomeOf(game);
  const final = score(game);
  const misses = game.wrong.length ? ` and ${plural(game.wrong.length, 'miss', 'misses')}` : '';
  const record =
    final === null
      ? ''
      : bestBefore.current === null || final < bestBefore.current
        ? ' A new best!'
        : ` Your best: ${scoreText(board.mode, bestBefore.current)}.`;

  return (
    <GameShell
      game={meta}
      dataNote={<RosterNote />}
      toolbar={
        <button type="button" className="icon-btn" onClick={() => setGame(null)}>
          ↺ New card
        </button>
      }
    >
      <div className="stack bingo-play">
        <div className="stats">
          <Stat label="Squares" value={`${game.filled.size}/${SQUARES}`} />
          {board.mode === 'deck' ? <Stat label="Players left" value={left} /> : null}
          {clock !== null ? (
            <Stat label="Time" value={<span className={low && !finished ? 'bingo-clock--low' : ''}>{formatClock(clock)}</span>} />
          ) : null}
          {board.mode === 'endless' ? <Stat label="Players" value={game.turn} /> : null}
          <Stat
            label={LEVELS[game.difficulty].lives === 1 ? 'Life' : 'Lives'}
            value={<Hearts left={livesLeft(game)} total={LEVELS[game.difficulty].lives} />}
          />
        </div>

        {clock !== null && !finished ? (
          <div className="bingo-timer" aria-hidden="true">
            <span
              className={low ? 'is-low' : ''}
              style={{ width: `${Math.min(100, (clock / LEVELS[game.difficulty].seconds) * 100)}%` }}
            />
          </div>
        ) : null}

        {player ? (
          <section className="card bingo-deal" aria-live="polite">
            <div className="bingo-deal__who">
              <span className="bingo-deal__count">
                Player {game.turn + 1}
                {board.mode === 'deck' ? ` of ${board.deck.length}` : ''} · tap a square or skip
              </span>
              {/* Keyed by the turn: a player can come back in a stream, and each deal should still read as one. */}
              <span key={game.turn} className="bingo-deal__name">
                {player.name}
              </span>
            </div>
            <button
              type="button"
              className="btn bingo-deal__skip"
              onClick={() => {
                setGame(skip(tick(game, elapsed())));
                setFeedback(null);
              }}
            >
              Skip ⏭
            </button>
          </section>
        ) : null}

        <div className="bingo-card" role="grid" aria-label="Bingo card">
          {board.squares.map((square, index) => {
            const marked = game.filled.get(index);
            const reveal = finished && !marked && outcome !== 'won' ? solutionFor(game, index)[0] : undefined;
            const open = !finished && !marked;
            const classes = ['bingo-sq'];
            if (marked) classes.push('bingo-sq--marked');
            if (inLine.has(index)) classes.push('bingo-sq--line');
            if (open) classes.push('bingo-sq--open');
            return (
              <button
                key={square.id}
                type="button"
                role="gridcell"
                className={classes.join(' ')}
                title={square.label}
                disabled={!open}
                onClick={() => onSquare(index)}
              >
                <span className="bingo-sq__rule">{squareLabel(square)}</span>
                {marked ? <span className="bingo-sq__player">{marked.name}</span> : null}
                {reveal ? <span className="bingo-sq__reveal">e.g. {reveal.name}</span> : null}
              </button>
            );
          })}
        </div>

        {/* Below the card, so a message never pushes the squares down. */}
        {feedback ? (
          <p className="small center" style={{ color: feedback.tone, margin: 0 }}>
            {feedback.message}
          </p>
        ) : null}

        {finished ? (
          <div className="stack">
            <Banner
              tone={outcome === 'won' ? 'success' : 'danger'}
              title={
                outcome === 'won'
                  ? 'Full card — Bingo!'
                  : game.gaveUp
                    ? 'Gave up'
                    : livesLeft(game) === 0
                      ? 'Out of lives'
                      : game.timedOut
                        ? 'Out of time'
                        : 'Out of players'
              }
            >
              {outcome === 'won'
                ? `All ${SQUARES} squares in ${scoreText(board.mode, final!)}${board.mode === 'deck' ? `, ${left} to spare` : ''}${misses}.${record}`
                : `${game.filled.size} of ${SQUARES} squares. Each open one shows a player who would have fitted.`}
            </Banner>
            <button type="button" className="btn btn--primary btn--lg btn--block" onClick={start}>
              New card
            </button>
          </div>
        ) : (
          <div className="row" style={{ justifyContent: 'center' }}>
            <GiveUpButton onGiveUp={() => setGame(giveUp(tick(game, elapsed())))} />
          </div>
        )}
      </div>
    </GameShell>
  );
}
