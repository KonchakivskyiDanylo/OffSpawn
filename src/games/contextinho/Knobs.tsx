import {
  ATTRIBUTES,
  DEFAULT_EVENT_WEIGHTS,
  DEFAULT_HALF_LIFE,
  DEFAULT_WEIGHTS,
  EVENT_FAMILIES,
  type AttributeId,
  type EventWeights,
  type Weights,
} from './engine';
import './contextinho.css';

/**
 * The similarity's knobs: a slider per part, the recency half-life and each big
 * event's weight. Dev builds only, in the game's lab and on
 * `/analytics/contextinho`; the live game plays on the defaults in `engine.ts`.
 */
export function Knobs({
  weights,
  onWeights,
  events,
  onEvents,
  halfLife,
  onHalfLife,
}: {
  weights: Weights;
  onWeights: (next: Weights) => void;
  events: EventWeights;
  onEvents: (next: EventWeights) => void;
  halfLife: number;
  onHalfLife: (next: number) => void;
}) {
  const set = (id: AttributeId, value: number) => onWeights({ ...weights, [id]: value });
  const changed = (id: AttributeId) => weights[id] !== DEFAULT_WEIGHTS[id];
  return (
    <div className="stack">
      <p className="tiny faint" style={{ margin: 0 }}>
        Each part scores 0–1 against the secret; the weights below mix them. Changing one re-ranks everyone at once.
        A bold number differs from the default.
      </p>
      <div className="cx-weights">
        {ATTRIBUTES.map((attribute) => (
          <label key={attribute.id} className="cx-weight" title={attribute.hint}>
            <span className="cx-weight__label">
              {attribute.label}{' '}
              <strong style={changed(attribute.id) ? { color: 'var(--warning)' } : undefined}>
                {weights[attribute.id]}
                {changed(attribute.id) ? ` (was ${DEFAULT_WEIGHTS[attribute.id]})` : ''}
              </strong>
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
          How fast titles, big events and results together fade: a result this many years old counts half. 0 is no
          fading. The early majors never fade.
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
        <CopyAsCode weights={weights} events={events} halfLife={halfLife} />
      </div>
    </div>
  );
}

/**
 * The knobs as the lines to paste over the defaults in
 * `src/games/contextinho/engine.ts`, so a mix found here can become the game's.
 */
export function asCode(weights: Weights, events: EventWeights, halfLife: number): string {
  const entries = (record: Record<string, number>) =>
    Object.entries(record)
      .map(([key, value]) => `  ${/^[a-z]+$/i.test(key) ? key : `'${key}'`}: ${value},`)
      .join('\n');
  return [
    `export const DEFAULT_WEIGHTS: Weights = {\n${entries(weights)}\n};`,
    `export const DEFAULT_EVENT_WEIGHTS: EventWeights = {\n${entries(events)}\n};`,
    `export const DEFAULT_HALF_LIFE = ${halfLife};`,
  ].join('\n\n');
}

function CopyAsCode({ weights, events, halfLife }: { weights: Weights; events: EventWeights; halfLife: number }) {
  return (
    <button
      type="button"
      className="link-btn small"
      title="The three defaults in src/games/contextinho/engine.ts, with these values"
      onClick={() => void navigator.clipboard?.writeText(asCode(weights, events, halfLife))}
    >
      Copy as code for engine.ts
    </button>
  );
}
