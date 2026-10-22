import { useMemo, useState } from 'react';
import { PlayerSearch } from '@/components/PlayerSearch';
import { useFacts } from '@/data/liquipedia/useFacts';
import { useMajors } from '@/data/liquipedia/useMajors';
import { useOrgs } from '@/data/liquipedia/useOrgs';
import { useRoster } from '@/data/liquipedia/useRoster';
import { useTeammates } from '@/data/liquipedia/useTeammates';
import {
  ATTRIBUTES,
  DEFAULT_EVENT_WEIGHTS,
  DEFAULT_HALF_LIFE,
  DEFAULT_WEIGHTS,
  pointsOf,
  rankAll,
  type AttributeId,
  type EventWeights,
  type Scored,
  type Weights,
} from '@/games/contextinho/engine';
import { Knobs } from '@/games/contextinho/Knobs';
import { moneyShort } from '@/lib/format';
import { useLocalState } from '@/lib/storage';
import { Card } from './ui';

/** How many of the ranking to show at once. */
const SIZES = [25, 50, 100, 250, 500, 1000];

const LABEL = new Map(ATTRIBUTES.map((attribute) => [attribute.id, attribute.label]));

/**
 * `/analytics/contextinho` — any player's whole Contextinho ranking, with every
 * score taken apart, and the weights to move it (the user, 22 Oct 2026: "give
 * me an opportunity to take a look at any player I want in my dev server and
 * adjust weights to see who is his top10 and even more"). Dev servers only.
 *
 * The secret, the weights, the half-life and the event weights are kept in
 * this browser, so a reload carries on. A Δ column says how far each player
 * moved against the game's defaults, and "Copy as code" gives the lines to
 * paste over the defaults in `src/games/contextinho/engine.ts`.
 */
export function ContextinhoLab() {
  const { roster } = useRoster();
  const { teammates } = useTeammates();
  const { orgs, error: orgsError } = useOrgs();
  const { facts, error: factsError } = useFacts();
  const { majors, error: majorsError } = useMajors();
  const ready = Boolean(roster && teammates && (orgs || orgsError) && (facts || factsError) && (majors || majorsError));

  const [secretId, setSecretId] = useLocalState<string>('dev:cx-lab:secret', 'MrSavage');
  const [stored, setWeights] = useLocalState<Partial<Weights>>('dev:cx-lab:weights', DEFAULT_WEIGHTS);
  const [storedEvents, setEvents] = useLocalState<Partial<EventWeights>>('dev:cx-lab:events', DEFAULT_EVENT_WEIGHTS);
  const [halfLife, setHalfLife] = useLocalState<number>('dev:cx-lab:half-life', DEFAULT_HALF_LIFE);
  // A part added since the weights were saved starts at its default.
  const weights = useMemo(() => ({ ...DEFAULT_WEIGHTS, ...stored }), [stored]);
  const events = useMemo(() => ({ ...DEFAULT_EVENT_WEIGHTS, ...storedEvents }), [storedEvents]);
  const [size, setSize] = useState(50);
  const [find, setFind] = useState('');
  const [columns, setColumns] = useState<'why' | 'all'>('why');

  const secret = roster?.players.find((player) => player.id === secretId) ?? null;
  const context = useMemo(
    () => (teammates ? { teammates, orgs, facts, majors, events, halfLife } : null),
    [teammates, orgs, facts, majors, events, halfLife],
  );
  const ranking = useMemo(
    () => (ready && roster && secret && context ? [...rankAll(secret, roster.players, weights, context).values()].sort((a, b) => a.rank - b.rank) : null),
    [ready, roster, secret, context, weights],
  );
  // The same secret on the game's defaults, for the Δ column.
  const defaults = useMemo(() => {
    if (!ready || !roster || !secret || !teammates) return null;
    const base = rankAll(secret, roster.players, DEFAULT_WEIGHTS, { teammates, orgs, facts, majors });
    return new Map([...base.values()].map((entry) => [entry.player.id, entry.rank]));
  }, [ready, roster, secret, teammates, orgs, facts, majors]);

  if (!ready || !roster) return <p className="muted">Loading the players…</p>;

  const needle = find.trim().toLowerCase();
  const rows = ranking
    ? needle
      ? ranking.filter((entry) => entry.rank > 1 && entry.player.name.toLowerCase().includes(needle)).slice(0, size)
      : ranking.slice(1, size + 1)
    : [];

  return (
    <div className="stack">
      <Card title="Contextinho lab">
        <p className="small muted" style={{ margin: 0 }}>
          Pick any player and see everyone ranked against them, the way Contextinho ranks guesses. The score is out of
          100, and <strong>Why</strong> splits it into the parts that made it, in points. Move a weight and the whole list
          re-ranks; <strong>Δ</strong> is how far a player moved against the game’s defaults. Your weights stay in this
          browser until you reset them; the game itself plays on the defaults in{' '}
          <code>src/games/contextinho/engine.ts</code>.
        </p>
      </Card>

      <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 280px' }}>
          <PlayerSearch
            players={roster.players}
            onPick={(player) => setSecretId(player.id)}
            placeholder="Any player…"
            buttonLabel="Rank"
          />
        </div>
        {secret ? (
          <div className="small" style={{ flex: '1 1 280px' }}>
            <div className="bold">{secret.name}</div>
            <div className="tiny faint">
              {[secret.countryName, secret.region].filter(Boolean).join(', ')} · {moneyShort(secret.earnings)} ·{' '}
              {majors?.resultsFor(secret.id).length ?? 0} majors · {facts?.earlyResultsFor(secret.id).length ?? 0} early
              majors · {teammates?.matesOf(secret.id).length ?? 0} teammates on record
            </div>
          </div>
        ) : (
          <p className="small muted">Pick a player to rank everyone against.</p>
        )}
      </div>

      <details className="card" open>
        <summary className="card__title" style={{ marginBottom: 0, cursor: 'pointer' }}>
          Weights
        </summary>
        <div style={{ marginTop: 12 }}>
          <Knobs
            weights={weights}
            onWeights={setWeights}
            events={events}
            onEvents={setEvents}
            halfLife={halfLife}
            onHalfLife={setHalfLife}
          />
        </div>
      </details>

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input an-select" value={size} onChange={(event) => setSize(Number(event.target.value))}>
          {SIZES.map((n) => (
            <option key={n} value={n}>
              Top {n}
            </option>
          ))}
        </select>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          value={find}
          placeholder="Where does … rank?"
          onChange={(event) => setFind(event.target.value)}
        />
        <div className="difficulty-switch">
          <button type="button" className="difficulty-switch__btn" aria-pressed={columns === 'why'} onClick={() => setColumns('why')}>
            Why
          </button>
          <button type="button" className="difficulty-switch__btn" aria-pressed={columns === 'all'} onClick={() => setColumns('all')}>
            Every part
          </button>
        </div>
      </div>

      {ranking ? (
        <div className="scroll-x">
          <table className="an-table">
            <thead>
              <tr>
                <th>#</th>
                <th title="Places moved against the game's defaults">Δ</th>
                <th>Player</th>
                <th>Earnings</th>
                <th>Score</th>
                {columns === 'why'
                  ? [<th key="why">Why (points)</th>]
                  : ATTRIBUTES.map((attribute) => (
                      <th key={attribute.id} title={attribute.hint} style={{ whiteSpace: 'nowrap' }}>
                        {attribute.label}
                      </th>
                    ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => (
                <Row key={entry.player.id} entry={entry} weights={weights} was={defaults?.get(entry.player.id)} columns={columns} />
              ))}
            </tbody>
          </table>
          {needle && rows.length === 0 ? <p className="small muted">Nobody by that name.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Row({
  entry,
  weights,
  was,
  columns,
}: {
  entry: Scored;
  weights: Weights;
  /** The player's rank on the game's defaults. */
  was: number | undefined;
  columns: 'why' | 'all';
}) {
  const points = pointsOf(entry, weights);
  const moved = was === undefined ? 0 : was - entry.rank;
  const why = (Object.keys(points) as AttributeId[])
    .filter((id) => points[id] >= 0.5)
    .sort((a, b) => points[b] - points[a])
    .map((id) => `${LABEL.get(id)} ${Math.round(points[id])}`)
    .join(', ');
  return (
    <tr>
      <td>{entry.rank}</td>
      <td className="tiny" style={{ whiteSpace: 'nowrap', color: moved > 0 ? 'var(--success)' : moved < 0 ? 'var(--danger)' : 'var(--text-faint)' }}>
        {moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : '·'}
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <span className="bold">{entry.player.name}</span>{' '}
        <span className="tiny faint">{entry.player.countryName ?? ''}</span>
      </td>
      <td className="tiny" style={{ whiteSpace: 'nowrap' }}>
        {moneyShort(entry.player.earnings)}
      </td>
      <td className="bold">{entry.score}</td>
      {columns === 'why' ? (
        <td className="tiny">{why || '—'}</td>
      ) : (
        ATTRIBUTES.map((attribute) => (
          <td key={attribute.id} className="tiny" style={{ color: points[attribute.id] >= 0.5 ? undefined : 'var(--text-faint)' }}>
            {points[attribute.id] >= 0.05 ? points[attribute.id].toFixed(1) : '·'}
          </td>
        ))
      )}
    </tr>
  );
}
