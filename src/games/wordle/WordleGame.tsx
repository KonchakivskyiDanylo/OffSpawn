import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { EXPORT_DATE } from '@/data/liquipedia/roster';
import { poolSetup, sendStart, useRoundRecorder } from '@/analytics/client';
import { GameShell } from '@/components/GameShell';
import { GiveUpButton } from '@/components/GiveUpButton';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { PoolSetup } from '@/components/PoolSetup';
import { SecretCard } from '@/components/SecretCard';
import { DailyEnd, DailyPending } from '@/components/DailyEnd';
import { Banner, OptionCard, OptionGrid } from '@/components/ui';
import { useDailyRound, usePlayMode } from '@/daily/useDailyRound';
import { restoreDaily, result as dailyResult, shareGrid, snapshot } from './daily';
import { rotationKey } from '@/games/shared/rotation';
import { useEventMode } from '@/games/shared/mode';
import { chosenLevel, dealSecret, poolScope, resolvePool, usePoolChoice } from '@/games/shared/pool';
import type { Pools } from '@/data/liquipedia/pools';
import { type Roster } from '@/data/liquipedia/roster';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import { plural } from '@/lib/format';
import { readLocal, useLocalState, writeLocal } from '@/lib/storage';
import { getGame } from '@/games/registry';
import {
  digitAnnounced,
  digitHelp,
  eligible,
  FIRST_REVEAL,
  gameFor,
  giveUp,
  hasDigits,
  keyboardState,
  MAX_GUESSES,
  playerNames,
  revealedDigits,
  revealSchedule,
  scoreGuess,
  submitGuess,
  type GameState,
  type TileState,
  record as roundRecord,
} from './engine';
import './wordle.css';

const meta = getGame('wordle')!;

const KEY_ROWS = [
  '1234567890'.split(''),
  'QWERTYUIOP'.split(''),
  'ASDFGHJKL'.split(''),
  ['ENTER', ...'ZXCVBNM'.split(''), 'DEL'],
];

/**
 * The rules, shown rather than described.
 *
 * Real handles, so the examples double as a hint about what the answers look
 * like. MITR0 carries the digit rule, which reads as a footnote in prose and as
 * an obvious fact the moment you see a 0 in a tile.
 *
 * `states` is one entry per tile, `null` for a tile left neutral so the eye
 * goes to the one being explained.
 */
const EXAMPLES: { word: string; states: (TileState | null)[]; note: string }[] = [
  {
    word: 'BUGHA',
    states: ['correct', null, null, null, null],
    note: 'B is in the player’s name and in the correct spot.',
  },
  {
    word: 'MITR0',
    states: [null, null, null, null, 'present'],
    note: '0 is in the player’s name but in the wrong spot — digits are characters too.',
  },
  {
    word: 'ACORN',
    states: [null, 'absent', null, null, null],
    note: 'C is not in the player’s name in any spot.',
  },
];

/**
 * The tile character a physical key press stands for, or null.
 *
 * `key` first, so AZERTY and other Latin layouts type what is printed on the
 * key. When `key` is not a Latin letter or digit — a Cyrillic layout left on,
 * an IME, a digit behind Shift on AZERTY — fall back to `code`, the physical
 * key read as US QWERTY. Without the fallback, a Ukrainian layout typed digits
 * (the same on both layouts) and no letters at all.
 */
function keyChar(stroke: KeyboardEvent): string | null {
  if (/^[a-zA-Z0-9]$/.test(stroke.key)) return stroke.key.toUpperCase();
  const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(stroke.code);
  return physical ? (physical[1] ?? physical[2]) : null;
}

function Examples() {
  return (
    <div className="stack-sm">
      {EXAMPLES.map((example) => (
        <div key={example.word} className="wordle-example">
          <div
            className="wordle-grid wordle-grid--example"
            style={{ '--cols': example.word.length } as CSSProperties}
            aria-hidden="true"
          >
            {example.word.split('').map((char, index) => {
              const state = example.states[index];
              return (
                <div key={index} className={`wordle-tile${state ? ` wordle-tile--${state}` : ''}`}>
                  {char}
                </div>
              );
            })}
          </div>
          <p className="small muted center">{example.note}</p>
        </div>
      ))}
    </div>
  );
}

export default function WordleGame() {
  const { roster, error } = useRoster();
  const { pools } = usePools();
  return (
    <LiquipediaGate error={error} ready={Boolean(roster)}>
      {roster ? <Game roster={roster} pools={pools} /> : null}
    </LiquipediaGate>
  );
}

function Game({ roster, pools }: { roster: Roster; pools: Pools | null }) {
  const [choice, setChoice] = usePoolChoice();
  const [event] = useEventMode();
  const [dailyOn, setDailyOn] = usePlayMode('wordle');
  const daily = useDailyRound('wordle', {
    on: dailyOn,
    ready: true,
    restore: (puzzle, saved) => restoreDaily(puzzle, roster, saved),
    snapshot,
    finished: (state) => state.status !== 'playing',
    result: dailyResult,
  });
  const [practice, setPractice] = useState<GameState | null>(null);
  const game = dailyOn ? daily.state : practice;
  const saveDaily = daily.setState;
  const setGame = useCallback(
    (next: GameState | null) => (dailyOn ? next && saveDaily(next) : setPractice(next)),
    [dailyOn, saveDaily],
  );

  useRoundRecorder('wordle', dailyOn ? daily.endedHere : game !== null && game.status !== 'playing', () => ({
    title: `Fortnitedle — ${game!.secret.name}`,
    data: EXPORT_DATE,
    setup: dailyOn ? { daily: daily.day } : poolSetup(event, choice, game!.namesOnly ? 'names-only' : undefined),
    ...roundRecord(game!),
  }));
  const shell = {
    game: meta,
    examples: <Examples />,
    dataNote: <RosterNote />,
    daily: { on: dailyOn, number: daily.number, setOn: setDailyOn },
  };
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  /** Set when a round opened a fresh cycle, so the board can say so. */
  const [wrapped, setWrapped] = useState(false);

  /**
   * Guesses: anything the right length, or player names only. A Choose option
   * (the user, 13 Oct 2026), so Random, an event field and the daily always take
   * anything; the pick is remembered for the next time Choose is on.
   */
  const [namesOnlyPick, setNamesOnly] = useLocalState<boolean>('wordle:names-only', false);
  const namesOnly = choice.mode === 'custom' && !pools?.get(event) && namesOnlyPick;
  const names = useMemo(() => playerNames(roster.players), [roster]);

  // A handle only works as an answer at a playable length, so eligibility has
  // to be part of choosing the pool, not a filter applied after it.
  const players = useMemo(
    () => resolvePool(roster, pools, event, choice, eligible, 1),
    [roster, pools, event, choice],
  );

  /**
   * Deal a player nobody in this pool has had yet.
   *
   * The cycle is keyed by everything that changes who is in the bag, so
   * switching region or level starts a separate cycle rather than poisoning
   * the one you were on.
   */
  const newGame = useCallback(() => {
    const key = rotationKey(meta.id, ...poolScope(event, choice));
    const drawn = dealSecret(players, readLocal<string[]>(key, []), pools, event, choice);
    if (drawn) writeLocal(key, drawn.seen);
    if (drawn) sendStart('wordle', false);
    setPractice(drawn ? gameFor(drawn.pick, chosenLevel(event, choice), namesOnly) : null);
    setWrapped(drawn?.wrapped ?? false);
    setDraft('');
    setMessage(null);
  }, [players, pools, event, choice, namesOnly]);

  const commit = useCallback(() => {
    if (!game || game.status !== 'playing') return;
    const result = submitGuess(game, draft, names);
    if (!result.ok) {
      setMessage(result.reason);
      return;
    }
    setMessage(null);
    setDraft('');
    setGame(result.state);
  }, [game, draft, names, setGame]);

  const press = useCallback(
    (key: string) => {
      if (!game || game.status !== 'playing') return;
      if (key === 'ENTER') {
        commit();
        return;
      }
      if (key === 'DEL') {
        setMessage(null);
        setDraft((prev) => prev.slice(0, -1));
        return;
      }
      if (!/^[A-Z0-9]$/.test(key)) return;
      setMessage(null);
      setDraft((prev) => (prev.length >= game.answer.length ? prev : prev + key));
    },
    [game, commit],
  );

  // Physical keyboard support — the on-screen one is for touch. The parameter
  // is `stroke` rather than the usual `event`, which now means the site-wide
  // event mode everywhere else in this file.
  useEffect(() => {
    const onKey = (stroke: KeyboardEvent) => {
      if (!game || game.status !== 'playing') return;
      if (stroke.metaKey || stroke.ctrlKey || stroke.altKey) return;
      // Not while something else has the keyboard. The 💬 report form opens
      // over this page, and a message typed into it used to fill the grid
      // behind it — Enter in the message box submitted that as a guess.
      if (document.querySelector('[aria-modal="true"]')) return;
      if (stroke.target instanceof Element && stroke.target.closest('input, textarea, select, [contenteditable]')) return;
      const key = stroke.key === 'Enter' ? 'ENTER' : stroke.key === 'Backspace' ? 'DEL' : keyChar(stroke);
      // Space is swallowed too: like Enter, it clicks whichever button has
      // focus — the last on-screen key tapped, which left a stray letter in
      // the next row, or Give up.
      if (key || stroke.key === ' ') stroke.preventDefault();
      if (key) press(key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, press]);

  if (!game && dailyOn) {
    return (
      <GameShell {...shell}>
        <DailyPending status={daily.status} error={daily.error} game="wordle" played={daily.played} />
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
            customExtra={
              <div className="stack-sm">
                <div className="field-label">Guesses</div>
                <OptionGrid>
                  <OptionCard
                    label={
                      <>
                        <span aria-hidden="true">🔤</span> Anything
                      </>
                    }
                    hint="Any letters the right length, so you can test letters freely."
                    selected={!namesOnlyPick}
                    onClick={() => setNamesOnly(false)}
                  />
                  <OptionCard
                    label={
                      <>
                        <span aria-hidden="true">👤</span> Player names only
                      </>
                    }
                    hint="Every guess must be a real player’s name. Much harder."
                    selected={namesOnlyPick}
                    onClick={() => setNamesOnly(true)}
                  />
                </OptionGrid>
              </div>
            }
            onStart={newGame}
            canStart={players.length > 0}
          />
          {players.length === 0 ? (
            <Banner tone="danger" title="No puzzle available">
              No player in this pool has a name this game can use.
            </Banner>
          ) : null}
          <p className="tiny faint center">
            6 guesses · every player in the pool comes up once before any of them comes round again
          </p>
        </div>
      </GameShell>
    );
  }

  const keys = keyboardState(game);
  const finished = game.status !== 'playing';
  const digits = revealedDigits(game);
  const rows = Array.from({ length: MAX_GUESSES }, (_, index) => {
    if (index < game.guesses.length) {
      return { value: game.guesses[index], states: scoreGuess(game.guesses[index], game.answer) };
    }
    if (index === game.guesses.length && !finished) return { value: draft, states: null };
    return { value: '', states: null };
  });

  return (
    <GameShell
      {...shell}
      toolbar={
        dailyOn ? null : (
          <button type="button" className="icon-btn" onClick={() => setPractice(null)}>
            ⚙ Setup
          </button>
        )
      }
    >
      <div className="stack">
        <div
          className="wordle-grid"
          style={{ '--cols': game.answer.length } as CSSProperties}
          aria-label={`Guess grid, ${game.answer.length} characters`}
        >
          {rows.map((row, rowIndex) =>
            Array.from({ length: game.answer.length }, (_, colIndex) => {
              const char = row.value[colIndex] ?? '';
              const state = row.states?.[colIndex];
              return (
                <div
                  key={`${rowIndex}-${colIndex}`}
                  className={`wordle-tile${state ? ` wordle-tile--${state} wordle-tile--flip` : ''}${char && !state ? ' wordle-tile--filled' : ''}`}
                  style={state ? ({ '--i': colIndex } as CSSProperties) : undefined}
                >
                  {char}
                </div>
              );
            }),
          )}
        </div>

        {/*
          Only once a digit has actually been handed over.
          The strip used to appear from guess one as a row of blanks reading
          "This name has 1 digit in it" — which gives away the length of the
          answer and the fact that it contains a digit, three guesses before the
          game intends to tell you either. Nothing to show is now shown as
          nothing.
        */}
        {hasDigits(game.answer) && !finished && digits.size > 0 ? (
          <DigitHint
            answer={game.answer}
            shown={digits}
            guesses={game.guesses.length}
            exact={digitHelp(game) === 'digit'}
          />
        ) : null}

        {!finished && digitAnnounced(game) ? <DigitNotice justNow={game.guesses.length === FIRST_REVEAL} /> : null}

        {!finished && game.namesOnly ? (
          <p className="tiny faint center" style={{ margin: 0 }}>
            👤 Player names only — every guess must be a real player’s name.
          </p>
        ) : null}

        {message ? <p className="center small" style={{ color: 'var(--warning)' }}>{message}</p> : null}

        {finished ? (
          <div className="stack">
            <Banner
              tone={game.status === 'won' ? 'success' : 'danger'}
              title={game.status === 'won' ? 'Solved!' : 'Round over'}
            >
              The player was <strong>{game.secret.name}</strong>.
            </Banner>
            <SecretCard player={game.secret} />
            {dailyOn ? (
              <DailyEnd game="wordle" number={daily.number} day={daily.day} result={dailyResult(game)} grid={shareGrid(game)} />
            ) : (
              <button type="button" className="btn btn--primary btn--lg btn--block" onClick={newGame}>
                New game
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="wordle-keyboard">
              {KEY_ROWS.map((row, index) => (
                <div className="wordle-keyboard__row" key={index}>
                  {row.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={`wordle-key${key.length > 1 ? ' wordle-key--wide' : ''}${
                        keys.get(key) ? ` wordle-key--${keys.get(key)}` : ''
                      }`}
                      onClick={() => press(key)}
                    >
                      {key === 'DEL' ? '⌫' : key}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'center' }}>
              <GiveUpButton onGiveUp={() => setGame(giveUp(game))} />
            </div>
          </>
        )}

        {wrapped ? (
          <p className="tiny faint center">
            You have now had every player in this pool — starting again, reshuffled.
          </p>
        ) : null}
      </div>
    </GameShell>
  );
}

/**
 * The digit help: that the name has at least one digit, and nothing more.
 * Announced on the guess it arrives, like a reveal, then kept as a line.
 */
function DigitNotice({ justNow }: { justNow: boolean }) {
  const text = 'This name has at least one digit in it';
  return (
    <div className="wordle-hint">
      {justNow ? (
        <p className="wordle-hint__pop" role="status">
          🔢 {text} — 0–9 are on the keyboard
        </p>
      ) : (
        <p className="tiny faint center" style={{ margin: 0 }}>
          🔢 {text}.
        </p>
      )}
    </div>
  );
}

/**
 * The digits in the answer, handed over on a schedule.
 *
 * Shown as a skeleton of the whole word rather than a sentence, because "the
 * third character is a 0" is a fact you then have to hold in your head while
 * counting tiles. A row of blanks with the digit sitting in its own slot is
 * the same fact, already positioned.
 *
 * Only rendered once the first digit has landed — before that there is nothing
 * to say that is not a spoiler. See the call site. On Medium (`exact` false)
 * the cells hold a # rather than the digit, and the keyboard stays as it was.
 */
function DigitHint({
  answer,
  shown,
  guesses,
  exact,
}: {
  answer: string;
  shown: Map<number, string>;
  guesses: number;
  exact: boolean;
}) {
  const schedule = revealSchedule(answer);
  const pending = [...schedule.values()].filter((after) => guesses < after);
  const next = pending.length > 0 ? Math.min(...pending) : null;

  /*
   * Which digits arrived on *this* guess, so they can be announced rather than
   * quietly appearing. A reveal is the only thing this game ever gives you for
   * free and it used to slide in unmarked under a grid you were staring at.
   */
  const justRevealed = new Set(
    [...schedule.entries()].filter(([, after]) => after === guesses).map(([position]) => position),
  );

  return (
    <div className="wordle-hint">
      <div className="wordle-hint__row" aria-label="Known digits">
        {answer.split('').map((_char, index) => (
          <span
            key={index}
            className={[
              'wordle-hint__cell',
              shown.has(index) ? 'wordle-hint__cell--shown' : '',
              justRevealed.has(index) ? 'wordle-hint__cell--new' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {shown.get(index) ?? ''}
          </span>
        ))}
      </div>
      {justRevealed.size > 0 ? (
        <p className="wordle-hint__pop" role="status">
          {exact
            ? `${justRevealed.size === 1 ? 'Digit revealed' : `${justRevealed.size} digits revealed`} — on the keyboard too`
            : `${justRevealed.size === 1 ? 'A digit goes here' : `${justRevealed.size} digits go here`} — which one is for you to find`}
        </p>
      ) : (
        <p className="tiny faint center">
          {`${shown.size} of ${plural(schedule.size, 'digit')} shown.`}
          {next !== null ? ` Next after guess ${next}.` : ''}
        </p>
      )}
    </div>
  );
}
