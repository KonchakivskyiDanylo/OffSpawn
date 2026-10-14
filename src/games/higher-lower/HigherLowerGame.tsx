import { useCallback, useEffect, useMemo, useState } from 'react';
import { sendStart, useRoundRecorder } from '@/analytics/client';
import { GameShell } from '@/components/GameShell';
import { RosterNote } from '@/components/LiquipediaGate';
import { GiveUpButton } from '@/components/GiveUpButton';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { LevelSetup, type LevelOption } from '@/components/PoolSetup';
import { Banner, OptionCard, OptionGrid, Stat } from '@/components/ui';
import { loadFacts, type Facts } from '@/data/liquipedia/facts';
import { useSocials } from '@/data/useSocials';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import type { Pools } from '@/data/liquipedia/pools';
import { EXPORT_DATE, type Roster, type RosterPlayer } from '@/data/liquipedia/roster';
import { activePool, useEventMode } from '@/games/shared/mode';
import { poolPlayers } from '@/games/shared/pool';
import { money, ordinal, playerMoney, plural } from '@/lib/format';
import { CountryBadge } from '@/components/CountryBadge';
import { useBestScore, useLocalState } from '@/lib/storage';
import { getGame } from '@/games/registry';
import {
  CATEGORIES,
  SOCIAL_CATEGORIES,
  answerLabel,
  correctAnswer,
  createGame,
  giveUp,
  hasEqualButton,
  nextRound,
  submitAnswer,
  withPlacements,
  type Answer,
  type Category,
  type Contender,
  type Difficulty,
  type GameState,
  record as roundRecord,
} from './engine';
import './higher-lower.css';

const meta = getGame('higher-lower')!;

/**
 * The levels, each described by what it does to a run — in the same words as
 * How to play, not the schedule behind them (see the pairing notes in
 * `engine.ts`).
 */
const LEVELS: LevelOption<Difficulty>[] = [
  { id: 'easy', label: '🟢 Easy', hint: 'Gets closer and less known slowly.' },
  { id: 'medium', label: '🟡 Medium', hint: 'Gets closer and less known sooner.' },
  { id: 'hard', label: '🔴 Hard', hint: 'Gets closer and less known fast.' },
];

function displayValue(player: Contender, category: Category): string {
  if (category === 'age') return `${player.age} years old`;
  if (category === 'fncsWins') return plural(player.fncsWins, 'FNCS win');
  if (category === 'fncsFinals') return plural(player.fncsFinals ?? 0, 'FNCS final');
  if (category === 'placement') return `${ordinal(player.placement?.place ?? 0)} place`;
  if (category === 'twitch') return `${(player.twitch ?? 0).toLocaleString('en-US')} followers`;
  if (category === 'youtube') return `${(player.youtube ?? 0).toLocaleString('en-US')} subscribers`;
  return playerMoney(player);
}

const BORN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * The fact shown under the revealed value: something true about the player
 * that is not the answer to the round they just played. Not the wins on an
 * FNCS Finals round, where a player's titles are a floor under their finals.
 * On Age it is the birthday, which is what decides the round: two players on
 * the same whole years are still one older than the other.
 */
function secondaryFact(player: Contender, category: Category): string {
  if (category === 'age' && player.birthDate) return `born ${BORN.format(new Date(player.birthDate))}`;
  return category === 'fncsWins' || category === 'fncsFinals' || category === 'placement' || SOCIAL_CATEGORIES.includes(category)
    ? playerMoney(player)
    : plural(player.fncsWins, 'FNCS win');
}

export default function HigherLowerGame() {
  const { roster, error: loadError } = useRoster();
  const { pools } = usePools();

  if (loadError) {
    return (
      <div className="card banner banner--danger">
        <div>
          <div className="banner__title">Player data unavailable</div>
          <div className="small">{loadError}</div>
        </div>
      </div>
    );
  }
  if (!roster) return <div className="card center muted">Loading players…</div>;
  return <Game roster={roster} pools={pools} />;
}

function Game({ roster, pools }: { roster: Roster; pools: Pools | null }) {
  const [event] = useEventMode();
  const pool = activePool(pools, event);
  const socials = useSocials();
  const [picked, setCategory] = useState<Category>('earnings');
  // Placement is a question about the event's results. With no mode, or a mode
  // whose results are not in yet, it falls back to the default rather than
  // leaving the setup on a card that is not there.
  const hasResults = Object.keys(pool?.placements ?? {}).length > 0;
  // A follower category whose platform the server has nothing fresh for is not offered either.
  const offline = (id: Category) => (id === 'twitch' || id === 'youtube') && !socials?.has(id);
  const hidden = (id: Category) => CATEGORIES.find((item) => item.id === id)?.hidden === true;
  const category: Category =
    (picked === 'placement' && !hasResults) || offline(picked) || hidden(picked) ? 'earnings' : picked;
  const [difficulty, setDifficulty] = useLocalState<Difficulty>('higher-lower:level', 'easy');
  const [game, setGame] = useState<GameState | null>(null);

  useRoundRecorder(
    'higher-lower',
    game !== null && (game.status === 'gameover' || game.status === 'cleared'),
    () => ({
      title: `Higher or Lower — ${game!.category}, ${game!.score} in a row`,
      data: EXPORT_DATE,
      setup: { event, level: game!.difficulty, category: game!.category },
      ...roundRecord(game!),
    }),
  );
  const [error, setError] = useState<string | null>(null);

  // Keyed by the level alone now that it is the only setting. Scores from the
  // old region / fame / status scopes are left where they are: they were
  // earned under a different pairing and are not the same record.
  const scope = `higher-lower:${category}:${event ? `event:${event}` : 'roster'}:${difficulty}`;
  const { best, submit: submitBest } = useBestScore(scope);

  /**
   * `facts.json`, fetched the first time FNCS Finals is picked. It is the one
   * category that needs it, and 577 KB is a lot to charge everyone who came to
   * play Career Earnings.
   */
  const [facts, setFacts] = useState<Facts | null>(null);
  const [factsFailed, setFactsFailed] = useState(false);
  useEffect(() => {
    if (category !== 'fncsFinals' || facts) return;
    let cancelled = false;
    loadFacts().then(
      (loaded) => !cancelled && setFacts(loaded),
      () => !cancelled && setFactsFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [category, facts]);

  /**
   * The whole roster, or the event's field with its finishes attached. The
   * level narrows it round by round from the top earners down, so nothing is
   * cut from it up front.
   */
  const players = useMemo((): Contender[] => {
    const field = poolPlayers(roster, pools, event);
    const base = field.length > 0 ? field : roster.players;
    const counted = base.map((p) => ({
      ...p,
      ...(facts ? { fncsFinals: facts.of(p.id).fncsApps } : {}),
      ...(socials ? { twitch: socials.of('twitch', p) ?? undefined, youtube: socials.of('youtube', p) ?? undefined } : {}),
    }));
    return withPlacements(counted, pool?.placements);
  }, [roster, pools, event, facts, pool, socials]);

  const start = useCallback(() => {
    if (category === 'fncsFinals' && !facts) {
      setError(
        factsFailed
          ? 'FNCS finals come from facts.json, which could not be loaded.'
          : 'Still loading the FNCS finals — try again in a moment.',
      );
      return;
    }
    // A field takes its regions in turn; the whole scene has no such promise.
    const created = createGame(players, category, difficulty, undefined, Boolean(pools?.get(event)));
    if (!created) {
      setError('Not enough players in this field have that value on record.');
      return;
    }
    setError(null);
    sendStart('higher-lower', false);
    setGame(created);
  }, [players, category, difficulty, pools, event, facts, factsFailed]);

  // Reveal the answer for a beat, then slide to the next pair.
  useEffect(() => {
    if (game?.status !== 'revealed') return;
    const timer = window.setTimeout(() => setGame((prev) => (prev ? nextRound(prev) : prev)), 1100);
    return () => window.clearTimeout(timer);
  }, [game?.status, game?.challenger.id]);

  useEffect(() => {
    if (game && (game.status === 'gameover' || game.status === 'cleared')) submitBest(game.score);
  }, [game, submitBest]);

  const answer = (choiceMade: Answer) =>
    setGame((prev) => (prev ? submitAnswer(prev, choiceMade) : prev));

  return (
    <GameShell
      game={meta}
      dataNote={<RosterNote />}
      toolbar={
        game ? (
          <button type="button" className="icon-btn" onClick={() => setGame(null)}>
            ⚙ Setup
          </button>
        ) : null
      }
    >
      {!game ? (
        <div className="stack">
          <LevelSetup
            pools={pools}
            event={event}
            levels={LEVELS}
            value={difficulty}
            onChange={setDifficulty}
            onStart={start}
            startLabel="Start endless run"
            extra={
              <section className="card stack">
                <div className="card__title">Category</div>
                <OptionGrid>
                  {CATEGORIES.filter((item) => !item.hidden && (!item.eventOnly || pool) && !offline(item.id)).map((item) => {
                    const waiting = item.id === 'placement' && !hasResults;
                    return (
                      <OptionCard
                        key={item.id}
                        label={item.label}
                        hint={waiting ? 'Where each player finished. Opens once the results are in.' : item.hint}
                        selected={category === item.id}
                        disabled={waiting}
                        onClick={() => setCategory(item.id)}
                      />
                    );
                  })}
                </OptionGrid>
              </section>
            }
          />
          {error ? (
            <Banner tone="danger" title="Cannot start">
              {error}
            </Banner>
          ) : null}
          <p className="tiny faint center">Endless mode · one mistake ends the run</p>
        </div>
      ) : (
        <Board
          game={game}
          best={best}
          eventLabel={pool?.label ?? null}
          onAnswer={answer}
          onRestart={start}
          onGiveUp={() => setGame(giveUp(game))}
        />
      )}
    </GameShell>
  );
}

function Board({
  game,
  best,
  eventLabel,
  onAnswer,
  onRestart,
  onGiveUp,
}: {
  game: GameState;
  best: number;
  /** The event in force, named in the Placement prompt. */
  eventLabel: string | null;
  onAnswer: (answer: Answer) => void;
  onRestart: () => void;
  onGiveUp: () => void;
}) {
  const categoryMeta = CATEGORIES.find((c) => c.id === game.category)!;
  const revealed = game.status !== 'playing';
  const finished = game.status === 'gameover' || game.status === 'cleared';
  const truth = correctAnswer(game);

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Score" value={game.score} />
        <Stat label="Best" value={Math.max(best, game.score)} />
      </div>

      <div className="hl-prompt">
        <span className="chip chip--primary">{categoryMeta.title}</span>
      </div>

      <div className="hl-board">
        <PlayerPanel
          player={game.current}
          category={game.category}
          value={displayValue(game.current, game.category)}
        />
        <div className="hl-vs" aria-hidden="true">
          VS
        </div>
        <PlayerPanel
          player={game.challenger}
          category={game.category}
          value={revealed ? displayValue(game.challenger, game.category) : null}
          countUp={revealed ? countUpFor(game.challenger, game.category) : null}
          tone={
            revealed && game.lastAnswer ? (game.status === 'gameover' ? 'wrong' : 'right') : undefined
          }
        />
      </div>

      {finished ? (
        <div className="stack">
          {game.status === 'cleared' ? (
            <Banner tone="success" title="🎉 You ran out of players! You won!">
              {/* Not necessarily the whole pool: FNCS Wins stops once there is
                  no title-holder left to pair against, because a round where
                  neither player has won one is not a question. */}
              You scored {game.score} and exhausted every pair this category had left.
            </Banner>
          ) : (
            <Banner tone="danger" title={game.lastAnswer ? 'Run over' : 'Gave up'}>
              {game.challenger.name} was {displayValue(game.challenger, game.category)} — the answer was{' '}
              <strong>{answerLabel(game.category, truth)}</strong>. Final score: {game.score}.
            </Banner>
          )}
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={onRestart}>
            Play again
          </button>
        </div>
      ) : (
        <div className="stack-sm">
          <div className="hl-answers">
            <button
              type="button"
              className="btn btn--lg hl-answer"
              disabled={revealed}
              onClick={() => onAnswer('higher')}
            >
              {game.category === 'age' ? '▲ Older' : '▲ Higher'}
            </button>
            {hasEqualButton(game.category) ? (
              <button
                type="button"
                className="btn btn--lg hl-answer"
                disabled={revealed}
                onClick={() => onAnswer('equal')}
              >
                = Equal
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn--lg hl-answer"
              disabled={revealed}
              onClick={() => onAnswer('lower')}
            >
              {game.category === 'age' ? '▼ Younger' : '▼ Lower'}
            </button>
          </div>
          <div className="row" style={{ justifyContent: 'center' }}>
            <GiveUpButton onGiveUp={onGiveUp} />
          </div>
        </div>
      )}

      <p className="tiny faint center">{promptFor(game, eventLabel)}</p>
    </div>
  );
}

/**
 * The question under the board, in each category's own words. Only FNCS Wins
 * is ever dealt a tie, so only its question mentions one.
 */
function promptFor(game: GameState, eventLabel: string | null): string {
  const hidden = game.challenger.name;
  const shown = game.current.name;
  switch (game.category) {
    case 'age':
      return `Is ${hidden} older or younger than ${shown}?`;
    case 'earnings':
      return `Are ${hidden}’s career earnings higher or lower than ${shown}’s?`;
    case 'fncsWins':
      return `Does ${hidden} have more or fewer FNCS wins than ${shown} — or the same number? Two players with none are level too.`;
    case 'fncsFinals':
      return `Has ${hidden} reached more or fewer FNCS grand finals than ${shown}?`;
    case 'placement':
      return `Did ${hidden} place higher or lower than ${shown}${eventLabel ? ` at ${eventLabel}` : ''}?`;
    case 'twitch':
      return `Does ${hidden} have more or fewer Twitch followers than ${shown}?`;
    case 'youtube':
      return `Does ${hidden} have more or fewer YouTube subscribers than ${shown}?`;
  }
}

/**
 * The big numbers count up as they are revealed — money and followers, where
 * watching $1.2M climb past the number on the left is half the fun. Small
 * counts and ages just appear.
 */
function countUpFor(player: Contender, category: Category): { to: number; format: (n: number) => string } | null {
  if (category === 'earnings' && player.earningsKnown) return { to: player.earnings, format: money };
  if (category === 'twitch') return { to: player.twitch ?? 0, format: (n) => `${n.toLocaleString('en-US')} followers` };
  if (category === 'youtube') return { to: player.youtube ?? 0, format: (n) => `${n.toLocaleString('en-US')} subscribers` };
  return null;
}

function useCountUp(target: { to: number; format: (n: number) => string } | null, ms = 650): string | null {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!target) {
      setShown(null);
      return;
    }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setShown(target.format(target.to));
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      // Ease out, so it slows into the real number.
      setShown(target.format(Math.round(target.to * (1 - (1 - t) ** 3))));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.to, target === null]);
  return shown;
}

function PlayerPanel({
  player,
  category,
  value,
  countUp = null,
  tone,
}: {
  player: RosterPlayer;
  category: Category;
  value: string | null;
  countUp?: { to: number; format: (n: number) => string } | null;
  tone?: 'right' | 'wrong';
}) {
  const counting = useCountUp(countUp);
  value = value !== null && counting !== null ? counting : value;
  return (
    <div className={`hl-panel${tone ? ` hl-panel--${tone}` : ''}`}>
      <PlayerAvatar player={player} size={72} />
      <div className="hl-panel__name">{player.name}</div>
      <div className="hl-panel__meta">
        {player.country ? (
          <>
            <CountryBadge code={player.country} name={player.countryName ?? player.country} />{' '}
          </>
        ) : null}
        {player.countryName ?? 'Unknown'}
      </div>
      <div className={`hl-panel__value${value ? '' : ' hl-panel__value--hidden'}`}>{value ?? '???'}</div>
      {/* Only shown once the value is out — the two numbers correlate. */}
      <div className="tiny faint">{value ? secondaryFact(player, category) : ' '}</div>
    </div>
  );
}
