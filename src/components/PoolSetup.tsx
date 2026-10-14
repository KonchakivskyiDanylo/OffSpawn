import { useMemo, type ReactNode } from 'react';
import type { Pools } from '@/data/liquipedia/pools';
import type { Roster } from '@/data/liquipedia/roster';
import { DIFFICULTY_META } from '@/games/shared/difficulty';
import { activePool } from '@/games/shared/mode';
import {
  countFor,
  LEVELS,
  SHOW_STATUS,
  type Eligible,
  type Level,
  type PoolChoice,
  type StatusChoice,
} from '@/games/shared/pool';
import { plural } from '@/lib/format';
import { RegionCards } from './RegionPicker';
import { OptionCard, OptionGrid } from './ui';

/**
 * The setup step every guessing game shares: who am I being asked about, and
 * then Start.
 *
 * Start is always an explicit button, even when nothing needs choosing. Three
 * of these games used to begin the moment you picked a mode, which meant the
 * first clue was on screen before you had finished reading the options — and
 * changing your mind cost you a round.
 *
 * It opens closed. A first-time player gets a title, one sentence and Start;
 * the region and difficulty cards are a second click away behind Choose (the
 * status cards too, while `SHOW_STATUS` is on). They used to be the first thing on the page — three sections and
 * fourteen cards, roughly a thousand pixels of decisions, before you could find
 * out what the game was. Nobody can answer "which region?" before their first
 * round, and everybody can by their tenth, so the cards are still there and
 * they are still remembered — they are simply no longer the greeting.
 *
 * With an event mode in force there is nothing here at all but Start: a fixed
 * field of eighty cannot be narrowed by region or difficulty and the mode chip
 * in the header already says which field it is.
 */

const STATUSES: { id: StatusChoice; label: string; hint: string; icon: string }[] = [
  { id: 'all', label: 'Everyone', hint: 'The whole roster, playing or not.', icon: '🌐' },
  { id: 'active', label: 'Active', hint: 'Players still competing today.', icon: '🟢' },
  { id: 'retired', label: 'Retired', hint: 'Players who have stopped.', icon: '📼' },
];

export function PoolSetup({
  roster,
  pools,
  event,
  value,
  onChange,
  eligible,
  extra,
  customExtra,
  onStart,
  startLabel = 'Start',
  canStart = true,
}: {
  roster: Roster;
  pools: Pools | null;
  /** The site-wide event mode, or null for the whole scene. */
  event: string | null;
  value: PoolChoice;
  onChange: (next: PoolChoice) => void;
  /** This game's own answerability filter, so every count is a count of real answers. */
  eligible?: Eligible;
  /** Game-specific choices (modes, categories) shown above Start. */
  extra?: ReactNode;
  /** A game's own row inside Choose, under Difficulty — Fortnitedle's "Guesses". Hidden on Random. */
  customExtra?: ReactNode;
  onStart: () => void;
  startLabel?: string;
  canStart?: boolean;
}) {
  const set = (patch: Partial<PoolChoice>) => onChange({ ...value, ...patch });

  const pool = activePool(pools, event);
  const custom = value.mode === 'custom';

  const difficultyCounts = useMemo(
    () =>
      Object.fromEntries(
        LEVELS.map((level) => [level, countFor(roster, value, level, eligible)]),
      ) as Record<Level, number>,
    [roster, value, eligible],
  );

  return (
    <div className="stack">
      {pool ? (
        <FieldNote pools={pools} event={event} />
      ) : (
        <section className="card stack">
          <div className="row-between">
            <div className="card__title" style={{ marginBottom: 0 }}>
              Who you get
            </div>
            {custom ? (
              <button type="button" className="link-btn tiny" onClick={() => set({ mode: 'random' })}>
                reset to random
              </button>
            ) : null}
          </div>

          <div className="difficulty-switch">
            <button
              type="button"
              className="difficulty-switch__btn"
              aria-pressed={!custom}
              onClick={() => set({ mode: 'random' })}
            >
              <span aria-hidden="true">🎲</span> Random
            </button>
            <button
              type="button"
              className="difficulty-switch__btn"
              aria-pressed={custom}
              onClick={() => set({ mode: 'custom' })}
            >
              <span aria-hidden="true">🎛️</span> Choose
            </button>
          </div>

          {custom ? (
            <div className="stack">
              <div className="stack-sm">
                <div className="field-label">Region</div>
                {/* No player counts: a number tells you nothing about whether
                    you will recognise anyone. */}
                <RegionCards
                  regions={roster.regions}
                  value={value.region}
                  onChange={(region) => set({ region })}
                />
              </div>

              <div className="stack-sm">
                <div className="field-label">Difficulty</div>
                <OptionGrid>
                  {LEVELS.map((id) => {
                    if (id === 'any') {
                      return (
                        <OptionCard
                          key={id}
                          label={
                            <>
                              <span aria-hidden="true">🎲</span> Any
                            </>
                          }
                          hint="Every level, leaning to names you know — like Random."
                          selected={value.difficulty === 'any'}
                          disabled={difficultyCounts.any === 0}
                          onClick={() => set({ difficulty: 'any' })}
                        />
                      );
                    }
                    const meta = DIFFICULTY_META[id];
                    return (
                      <OptionCard
                        key={id}
                        label={
                          <>
                            <span aria-hidden="true">{meta.icon}</span> {meta.label}
                          </>
                        }
                        hint={meta.blurb}
                        selected={value.difficulty === id}
                        // A tier with nobody in it is not a choice.
                        disabled={difficultyCounts[id] === 0}
                        onClick={() => set({ difficulty: id })}
                      />
                    );
                  })}
                </OptionGrid>
              </div>

              {SHOW_STATUS ? (
                <div className="stack-sm">
                  <div className="field-label">Still competing?</div>
                  <OptionGrid>
                    {STATUSES.map((status) => (
                      <OptionCard
                        key={status.id}
                        label={
                          <>
                            <span aria-hidden="true">{status.icon}</span> {status.label}
                          </>
                        }
                        hint={status.hint}
                        selected={value.status === status.id}
                        onClick={() => set({ status: status.id })}
                      />
                    ))}
                  </OptionGrid>
                </div>
              ) : null}

              {customExtra}
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              Any region, any level — leaning towards names you know. Hit Choose to narrow it down.
            </p>
          )}
        </section>
      )}

      {extra}

      <button
        type="button"
        className="btn btn--primary btn--lg btn--block"
        disabled={!canStart}
        onClick={onStart}
      >
        {startLabel}
      </button>
    </div>
  );
}

/** Which field is in force, when an event mode is. Renders nothing otherwise. */
function FieldNote({ pools, event }: { pools: Pools | null; event: string | null }) {
  const pool = activePool(pools, event);
  if (!pool) return null;
  return (
    <p className="small muted center">
      Playing the <strong>{pool.label}</strong> field — {plural(pool.players.length, 'player')}.
      Change or leave the mode from the header.
    </p>
  );
}

export interface LevelOption<T extends string> {
  id: T;
  label: ReactNode;
  hint: ReactNode;
}

/**
 * The setup step for a game whose only question is Easy, Medium or Hard.
 *
 * Tic Tac Toe and Higher or Lower used to open on `PoolSetup` *and* a rules
 * card of their own, so a player met two difficulty settings that meant two
 * different things — the fame band behind Choose, and the game's own rules
 * below it. Each of those games now folds both into one level, and that level
 * is the whole form. An event mode still applies: the field note replaces
 * nothing here, because there was no pool choice to replace.
 */
export function LevelSetup<T extends string>({
  pools,
  event,
  levels,
  value,
  onChange,
  extra,
  onStart,
  startLabel = 'Start',
}: {
  pools: Pools | null;
  event: string | null;
  levels: LevelOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Game-specific choices (categories) shown between the levels and Start. */
  extra?: ReactNode;
  onStart: () => void;
  startLabel?: string;
}) {
  return (
    <div className="stack">
      <FieldNote pools={pools} event={event} />
      <section className="card stack">
        <div className="card__title">Difficulty</div>
        <OptionGrid>
          {levels.map((level) => (
            <OptionCard
              key={level.id}
              label={level.label}
              hint={level.hint}
              selected={value === level.id}
              onClick={() => onChange(level.id)}
            />
          ))}
        </OptionGrid>
      </section>
      {extra}
      <button type="button" className="btn btn--primary btn--lg btn--block" onClick={onStart}>
        {startLabel}
      </button>
    </div>
  );
}
