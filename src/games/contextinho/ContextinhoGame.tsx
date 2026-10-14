import { useCallback, useMemo, useState } from 'react';
import { sendStart, useRoundRecorder } from '@/analytics/client';
import { GameShell } from '@/components/GameShell';
import { GiveUpButton } from '@/components/GiveUpButton';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { PlayerSearch } from '@/components/PlayerSearch';
import { LevelSetup, type LevelOption } from '@/components/PoolSetup';
import { SecretCard } from '@/components/SecretCard';
import { Banner, Stat } from '@/components/ui';
import type { Facts } from '@/data/liquipedia/facts';
import type { Majors } from '@/data/liquipedia/majors';
import type { Orgs } from '@/data/liquipedia/orgs';
import type { Roster } from '@/data/liquipedia/roster';
import type { Teammates } from '@/data/liquipedia/teammates';
import { useFacts } from '@/data/liquipedia/useFacts';
import { useMajors } from '@/data/liquipedia/useMajors';
import { useOrgs } from '@/data/liquipedia/useOrgs';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import { useTeammates } from '@/data/liquipedia/useTeammates';
import { getGame } from '@/games/registry';
import { dealFresh, LEVEL_LABEL, levelPlayers, type Level } from '@/games/shared/levels';
import { plural } from '@/lib/format';
import {
  ATTRIBUTES,
  createGame,
  DEFAULT_EVENT_WEIGHTS,
  DEFAULT_HALF_LIFE,
  DEFAULT_WEIGHTS,
  EVENT_FAMILIES,
  eligible,
  giveUp,
  hintFor,
  rankAll,
  record as roundRecord,
  submitGuess,
  type AttributeId,
  type EventWeights,
  type GameState,
  type Scored,
  type Weights,
} from './engine';
import './contextinho.css';

const meta = getGame('contextinho')!;

const LEVELS: LevelOption<Level>[] = [
  { id: 'easy', label: LEVEL_LABEL.easy, hint: 'A name everyone knows.' },
  { id: 'medium', label: LEVEL_LABEL.medium, hint: 'A regular of the scene.' },
  { id: 'hard', label: LEVEL_LABEL.hard, hint: 'Anyone who has played with a teammate.' },
];

/**
 * The tuning panel the roadmap's V1 asks for. Dev builds only: on the live
 * site the game plays on `DEFAULT_WEIGHTS` and nobody sees the knobs.
 */
const SHOW_LAB = import.meta.env.DEV;

export default function ContextinhoGame() {
  const { roster, error: rosterError } = useRoster();
  const { teammates, error: matesError } = useTeammates();
  // Each of these feeds a few parts and may be missing — those parts then
  // score 0 — but the round waits until each has loaded or failed: one that
  // arrived mid-round would re-rank every guess already made.
  const { orgs, error: orgsError } = useOrgs();
  const { facts, error: factsError } = useFacts();
  const { majors, error: majorsError } = useMajors();
  const settled = Boolean((orgs || orgsError) && (facts || factsError) && (majors || majorsError));
  return (
    <LiquipediaGate error={rosterError ?? matesError} ready={Boolean(roster && teammates && settled)}>
      {roster && teammates && settled ? (
        <Game roster={roster} teammates={teammates} orgs={orgs} facts={facts} majors={majors} />
      ) : null}
    </LiquipediaGate>
  );
}

/** Warm to cold by rank. Bands sized for a ranking of ~5,700. */
function band(rank: number): 'hot' | 'warm' | 'cool' | 'cold' {
  if (rank <= 25) return 'hot';
  if (rank <= 150) return 'warm';
  if (rank <= 750) return 'cool';
  return 'cold';
}

function Game({
  roster,
  teammates,
  orgs,
  facts,
  majors,
}: {
  roster: Roster;
  teammates: Teammates;
  orgs: Orgs | null;
  facts: Facts | null;
  majors: Majors | null;
}) {
  const { pools } = usePools();
  const [level, setLevel] = useState<Level>('easy');
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [events, setEvents] = useState<EventWeights>(DEFAULT_EVENT_WEIGHTS);
  const [halfLife, setHalfLife] = useState(DEFAULT_HALF_LIFE);
  const [display, setDisplay] = useState<'rank' | 'score'>('rank');
  const [showParts, setShowParts] = useState(false);
  const [peek, setPeek] = useState(false);

  const ranking = useMemo(
    () => (game ? rankAll(game.secret, roster.players, weights, { teammates, orgs, facts, majors, events, halfLife }) : null),
    [game?.secret, roster, weights, events, halfLife, teammates, orgs, facts, majors],
  );

  useRoundRecorder('contextinho', game !== null && game.status !== 'playing', () => ({
    title: `Contextinho — ${game!.secret.name}`,
    data: teammates.generated,
    setup: { level },
    ...roundRecord(game!),
  }));

  const start = useCallback(() => {
    const pick = dealFresh(meta.id, [level], levelPlayers(roster, level, eligible(teammates)));
    if (!pick) {
      setError('Nobody at this level has a teammate on record.');
      return;
    }
    setError(null);
    sendStart('contextinho', false);
    setGame(createGame(pick));
  }, [roster, teammates, level]);

  if (!game || !ranking) {
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
  const everyone = ranking.size;
  const scoredGuesses = game.guesses.map((g) => ({ ...ranking.get(g.player.id)!, hint: g.hint }));
  const latest = scoredGuesses[scoredGuesses.length - 1];
  const sorted = [...scoredGuesses].sort((a, b) => a.rank - b.rank);
  const best = sorted[0]?.rank ?? null;
  const hint = finished ? null : hintFor(game, ranking, everyone);
  const closest = [...ranking.values()].sort((a, b) => a.rank - b.rank).slice(1, 11);

  return (
    <GameShell
      game={meta}
      dataNote={<RosterNote />}
      toolbar={
        <>
          <button type="button" className="icon-btn" onClick={start}>
            ↺ New player
          </button>
          <button type="button" className="icon-btn" onClick={() => setGame(null)}>
            ⚙ Setup
          </button>
        </>
      }
    >
      <div className="stack cx-play">
        <div className="stats">
          <Stat label="Guesses" value={game.guesses.length} />
          <Stat label="Best" value={best === null ? '—' : `#${best}`} />
          <Stat label="Hints" value={game.hints} />
        </div>

        {finished ? (
          <div className="stack">
            <Banner
              tone={game.status === 'won' ? 'success' : 'danger'}
              title={game.status === 'won' ? `Found in ${plural(game.guesses.length, 'guess', 'guesses')}!` : 'Round over'}
            >
              The secret player was <strong>{game.secret.name}</strong>.
            </Banner>
            <SecretCard player={game.secret} />
          </div>
        ) : (
          <div className="stack-sm">
            <PlayerSearch
              players={roster.players}
              onPick={(player) => setGame(submitGuess(game, player))}
              exclude={new Set(game.guesses.map((g) => g.player.id))}
              placeholder="Guess any player…"
              autoFocus
            />
            <div className="action-pair">
              <button
                type="button"
                className="btn"
                disabled={!hint}
                onClick={() => hint && setGame(submitGuess(game, hint, true))}
              >
                {hint ? '💡 Hint' : best !== null && best <= 2 ? 'So close — no hint left' : '💡 Hint'}
              </button>
              <GiveUpButton onGiveUp={() => setGame(giveUp(game))} variant="danger" />
            </div>
          </div>
        )}

        {latest && !finished ? (
          <div className="stack-sm">
            <div className="field-label">Last guess</div>
            <GuessRow entry={latest} everyone={everyone} display={display} showParts={showParts} isLatest />
          </div>
        ) : null}

        {sorted.length ? (
          <section className="card stack-sm">
            <div className="card__title">Your guesses, closest first</div>
            <ol className="cx-list list-reset">
              {sorted.map((entry) => (
                <li key={entry.player.id}>
                  <GuessRow entry={entry} everyone={everyone} display={display} showParts={showParts} />
                </li>
              ))}
            </ol>
          </section>
        ) : (
          <p className="small muted center" style={{ margin: 0 }}>
            Guess anyone to start — the rank says how close they are, out of {everyone.toLocaleString('en-US')}.
          </p>
        )}

        {finished || peek ? (
          <section className="card stack-sm">
            <div className="card__title">The ten closest to {finished ? game.secret.name : 'the secret'}</div>
            <ol className="cx-list list-reset">
              {closest.map((entry) => (
                <li key={entry.player.id}>
                  <GuessRow entry={{ ...entry, hint: false }} everyone={everyone} display={display} showParts={showParts} />
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {finished ? (
          <button type="button" className="btn btn--primary btn--lg btn--block" onClick={start}>
            Next player
          </button>
        ) : null}

        {SHOW_LAB ? (
          <Lab
            weights={weights}
            onWeights={setWeights}
            events={events}
            onEvents={setEvents}
            halfLife={halfLife}
            onHalfLife={setHalfLife}
            display={display}
            onDisplay={setDisplay}
            showParts={showParts}
            onShowParts={setShowParts}
            peek={peek}
            onPeek={setPeek}
          />
        ) : null}
      </div>
    </GameShell>
  );
}

function GuessRow({
  entry,
  everyone,
  display,
  showParts,
  isLatest,
}: {
  entry: Scored & { hint: boolean };
  everyone: number;
  display: 'rank' | 'score';
  showParts: boolean;
  isLatest?: boolean;
}) {
  const secret = entry.rank === 1;
  // How full the bar is: rank on a log scale, so #10 and #100 look different
  // and #3,000 and #5,000 do not.
  const fill = secret ? 1 : Math.max(0.03, 1 - Math.log(entry.rank) / Math.log(everyone));
  const tone = secret ? 'win' : band(entry.rank);
  return (
    <div
      className={`cx-row cx-row--${tone}${isLatest ? ' cx-row--latest' : ''}`}
      style={{ '--cx-fill': `${(fill * 100).toFixed(1)}%` } as React.CSSProperties}
    >
      <div className="cx-row__main">
        <span className="cx-row__name">
          {entry.player.name}
          {entry.hint ? <span className="cx-row__tag">hint</span> : null}
        </span>
        <span className="cx-row__value">
          {secret ? '🎯' : display === 'rank' ? `#${entry.rank.toLocaleString('en-US')}` : entry.score}
        </span>
      </div>
      {showParts && !secret ? <Parts entry={entry} /> : null}
    </div>
  );
}

function Parts({ entry }: { entry: Scored }) {
  return (
    <div className="cx-parts">
      {ATTRIBUTES.map((attribute) => (
        <span key={attribute.id} className="cx-part" title={attribute.hint}>
          {attribute.label} <strong>{Math.round(entry.parts[attribute.id] * 100)}</strong>
        </span>
      ))}
    </div>
  );
}

function Lab({
  weights,
  onWeights,
  events,
  onEvents,
  halfLife,
  onHalfLife,
  display,
  onDisplay,
  showParts,
  onShowParts,
  peek,
  onPeek,
}: {
  weights: Weights;
  onWeights: (next: Weights) => void;
  events: EventWeights;
  onEvents: (next: EventWeights) => void;
  halfLife: number;
  onHalfLife: (next: number) => void;
  display: 'rank' | 'score';
  onDisplay: (next: 'rank' | 'score') => void;
  showParts: boolean;
  onShowParts: (next: boolean) => void;
  peek: boolean;
  onPeek: (next: boolean) => void;
}) {
  const set = (id: AttributeId, value: number) => onWeights({ ...weights, [id]: value });
  return (
    <details className="card cx-lab">
      <summary className="card__title" style={{ marginBottom: 0, cursor: 'pointer' }}>
        🧪 Similarity lab (dev only)
      </summary>
      <div className="stack" style={{ marginTop: 12 }}>
        <p className="tiny faint" style={{ margin: 0 }}>
          Each part scores 0–1 against the secret; the weights below mix them. Changing one re-ranks everyone at once.
        </p>
        <div className="cx-weights">
          {ATTRIBUTES.map((attribute) => (
            <label key={attribute.id} className="cx-weight" title={attribute.hint}>
              <span className="cx-weight__label">
                {attribute.label} <strong>{weights[attribute.id]}</strong>
              </span>
              <input
                type="range"
                min={0}
                max={6}
                step={0.5}
                value={weights[attribute.id]}
                onChange={(event) => set(attribute.id, Number(event.target.value))}
              />
              <span className="tiny faint">{attribute.hint}</span>
            </label>
          ))}
        </div>
        <label className="cx-weight">
          <span className="cx-weight__label">
            Recency half-life <strong>{halfLife > 0 ? `${halfLife} years` : 'off'}</strong>
          </span>
          <input type="range" min={0} max={10} step={0.5} value={halfLife} onChange={(event) => onHalfLife(Number(event.target.value))} />
          <span className="tiny faint">
            How fast titles, big events and “teamed up lately” fade: a result this many years old counts half. 0 is no fading.
          </span>
        </label>
        <p className="tiny faint" style={{ margin: 0 }}>
          Big events, each weighted inside the two parts about them: 1 as it stands, 2 twice that, 0 left out.
        </p>
        <div className="cx-weights">
          {EVENT_FAMILIES.map((family) => (
            <label key={family.id} className="cx-weight">
              <span className="cx-weight__label">
                {family.label} <strong>{events[family.id]}</strong>
              </span>
              <input
                type="range"
                min={0}
                max={3}
                step={0.5}
                value={events[family.id]}
                onChange={(event) => onEvents({ ...events, [family.id]: Number(event.target.value) })}
              />
            </label>
          ))}
        </div>
        <div className="row">
          <div className="difficulty-switch">
            <button type="button" className="difficulty-switch__btn" aria-pressed={display === 'rank'} onClick={() => onDisplay('rank')}>
              Rank #
            </button>
            <button type="button" className="difficulty-switch__btn" aria-pressed={display === 'score'} onClick={() => onDisplay('score')}>
              Score 0–100
            </button>
          </div>
          <label className="small row" style={{ gap: 6 }}>
            <input type="checkbox" checked={showParts} onChange={(event) => onShowParts(event.target.checked)} /> Parts on every row
          </label>
          <label className="small row" style={{ gap: 6 }}>
            <input type="checkbox" checked={peek} onChange={(event) => onPeek(event.target.checked)} /> Peek at the ten closest
          </label>
          <button
            type="button"
            className="link-btn small"
            onClick={() => {
              onWeights(DEFAULT_WEIGHTS);
              onEvents(DEFAULT_EVENT_WEIGHTS);
              onHalfLife(DEFAULT_HALF_LIFE);
            }}
          >
            Reset to the defaults
          </button>
        </div>
      </div>
    </details>
  );
}
