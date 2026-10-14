import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useFacts } from '@/data/liquipedia/useFacts';
import { useOrgs } from '@/data/liquipedia/useOrgs';
import { useRoster } from '@/data/liquipedia/useRoster';
import { useSocials } from '@/data/useSocials';
import type { PlayerCriterion } from '@/games/shared/criteria';
import {
  BANDS,
  boardRules,
  generateBoard,
  inspectBoard,
  LEVELS,
  type BoardPools,
  type Difficulty,
  type GridSpec,
} from '@/games/tic-tac-toe/engine';
import { useLocalState } from '@/lib/storage';
import { Card } from './ui';

/** A grid kept in this browser, with a name to find it by. */
interface Saved extends GridSpec {
  name: string;
  saved: string;
}

const EMPTY: string[] = ['', '', ''];

/**
 * `/analytics/grid` — build a Tic Tac Toe grid by hand (the user, 14 Oct 2026:
 * "a real tic tac toe board creation in analytics, so I can create the boards
 * … by myself. But for now maybe just in dev mode, in the future when I add
 * daily I would add it in there").
 *
 * Pick three rows and three columns from the rules a level's board draws on;
 * every cell shows its answers live, and the grid is checked against what a
 * generated board promises at that level (`inspectBoard`). Play opens it in
 * the game; Save keeps it in this browser. The six ids are exactly a Tic Tac
 * Toe daily's descriptor, so when the game is a daily again these grids can
 * go straight into the schedule.
 */
export function GridBuilder() {
  const { roster } = useRoster();
  const { facts } = useFacts();
  const { orgs } = useOrgs();
  const socials = useSocials();
  const [level, setLevel] = useState<Difficulty>('medium');
  const [rows, setRows] = useState<string[]>(EMPTY);
  const [cols, setCols] = useState<string[]>(EMPTY);
  const [saved, setSaved] = useLocalState<Saved[]>('dev:grids', []);
  const [name, setName] = useState('');

  const pools: BoardPools | null = useMemo(() => {
    if (!roster || !facts) return null;
    const eligible = facts.eligible(3);
    return { answers: BANDS[level].flatMap((tier) => roster.exactly(tier, { eligible })), accepted: roster.players };
  }, [roster, facts, level]);

  const rules = useMemo(
    () => (pools && facts && orgs ? boardRules({ facts, orgs, socials }, pools, level) : []),
    [pools, facts, orgs, socials, level],
  );
  const byId = useMemo(() => new Map(rules.map((rule) => [rule.id, rule])), [rules]);
  /** The picker's options, grouped by kind, each group alphabetical. */
  const grouped = useMemo(() => {
    const out = new Map<string, PlayerCriterion[]>();
    for (const rule of rules) out.set(rule.kind, [...(out.get(rule.kind) ?? []), rule]);
    for (const list of out.values()) list.sort((a, b) => a.short.localeCompare(b.short));
    return [...out].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rules]);

  const rowRules = rows.map((id) => byId.get(id));
  const colRules = cols.map((id) => byId.get(id));
  const complete = [...rowRules, ...colRules].every(Boolean);
  const missing = [...rows, ...cols].filter((id) => id && !byId.has(id));
  const report = useMemo(
    () =>
      complete && pools
        ? inspectBoard({ rows: rowRules as PlayerCriterion[], cols: colRules as PlayerCriterion[] }, pools, level)
        : null,
    // The ids are the board; the rule objects follow from them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [complete, pools, level, rows.join('|'), cols.join('|'), byId],
  );

  if (!roster || !facts || !orgs || !pools) return <p className="muted">Loading the data…</p>;

  const spec: GridSpec = { rows, cols, level };
  const playHref = `/game/tic-tac-toe?grid=${encodeURIComponent(JSON.stringify(spec))}`;
  const set = (axis: 'row' | 'col', index: number, id: string) =>
    (axis === 'row' ? setRows : setCols)((prev) => prev.map((value, i) => (i === index ? id : value)));
  const random = () => {
    const board = generateBoard({ facts, orgs, socials }, pools, level);
    if (!board) return;
    setRows(board.rows.map((rule) => rule.id));
    setCols(board.cols.map((rule) => rule.id));
  };
  const save = () => {
    const label = name.trim() || [...rowRules, ...colRules].map((rule) => rule?.short).join(' · ');
    setSaved([{ ...spec, name: label, saved: new Date().toISOString() }, ...saved]);
    setName('');
  };

  const picker = (axis: 'row' | 'col', index: number, value: string) => (
    <select
      className="input grid-builder__pick"
      value={value}
      aria-label={`${axis === 'row' ? 'Row' : 'Column'} ${index + 1}`}
      onChange={(event) => set(axis, index, event.target.value)}
    >
      <option value="">{axis === 'row' ? `Row ${index + 1}…` : `Column ${index + 1}…`}</option>
      {value && !byId.has(value) ? <option value={value}>{value} (not at this level)</option> : null}
      {grouped.map(([kind, list]) => (
        <optgroup key={kind} label={kind}>
          {list.map((rule) => (
            <option key={rule.id} value={rule.id}>
              {rule.short} ({rule.matches.length})
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  return (
    <div className="stack">
      <Card
        title="Box Fight grid"
        aside={
          <div className="row">
            {(['easy', 'medium', 'hard'] as const).map((id) => (
              <button
                key={id}
                type="button"
                className={`btn${level === id ? ' btn--primary' : ''}`}
                onClick={() => setLevel(id)}
              >
                {id[0].toUpperCase() + id.slice(1)}
              </button>
            ))}
          </div>
        }
      >
        <p className="tiny faint" style={{ margin: 0 }}>
          {rules.length} rules at this level. A cell reads: answers from the level's players (
          {LEVELS[level].answers}+ promised), then everyone who fits, then the best-known three.
        </p>
        <div className="grid-builder">
          <div />
          {cols.map((id, c) => (
            <div key={`c${c}`}>{picker('col', c, id)}</div>
          ))}
          {rows.map((id, r) => (
            <div key={`r${r}`} className="grid-builder__row">
              {picker('row', r, id)}
              {cols.map((_, c) => {
                const cell = report?.answers[r][c];
                const thin = cell && cell.length < LEVELS[level].answers;
                return (
                  <div key={c} className={`grid-builder__cell${thin ? ' grid-builder__cell--thin' : ''}`}>
                    {cell ? (
                      <>
                        <strong>{cell.length}</strong>
                        <span className="tiny faint"> / {report!.accepted[r][c]}</span>
                        <div className="tiny">{cell.slice(0, 3).map((player) => player.name).join(', ') || '—'}</div>
                      </>
                    ) : (
                      <span className="tiny faint">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {missing.length ? (
          <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>
            Not a rule at this level: {missing.join(', ')}
          </p>
        ) : null}
        {report ? (
          report.problems.length ? (
            <ul className="small list-reset stack-sm" style={{ color: 'var(--warning)' }}>
              {report.problems.map((problem) => (
                <li key={problem}>⚠ {problem}</li>
              ))}
            </ul>
          ) : (
            <p className="small" style={{ color: 'var(--success)', margin: 0 }}>
              ✓ Keeps every promise of a {level} board. Most cells for one player: {report.reach.cells} (
              {report.reach.player}).
            </p>
          )
        ) : null}

        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button type="button" className="btn" onClick={random}>
            🎲 Random grid
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setRows(EMPTY);
              setCols(EMPTY);
            }}
          >
            Clear
          </button>
          {complete ? (
            <>
              <Link className="btn btn--primary" to={playHref} target="_blank" rel="noreferrer">
                ▶ Play it
              </Link>
              <input
                className="input"
                style={{ maxWidth: 220 }}
                placeholder="Name (optional)"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button type="button" className="btn" onClick={save}>
                Save
              </button>
            </>
          ) : null}
        </div>
      </Card>

      <Card title="Saved grids" aside={<span className="tiny faint">this browser only</span>}>
        {saved.length ? (
          <ul className="list-reset stack-sm">
            {saved.map((grid) => (
              <li key={grid.saved} className="row-between small">
                <span>
                  <strong>{grid.name}</strong> <span className="tiny faint">{grid.level}</span>
                </span>
                <span className="row">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setLevel(grid.level);
                      setRows(grid.rows);
                      setCols(grid.cols);
                    }}
                  >
                    Load
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => void navigator.clipboard?.writeText(JSON.stringify({ rows: grid.rows, cols: grid.cols }))}
                    title="The six rule ids, as a Box Fight daily stores them"
                  >
                    Copy
                  </button>
                  <button type="button" className="btn" onClick={() => setSaved(saved.filter((other) => other !== grid))}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            None yet. Saved grids stay in this browser until Box Fight has a daily schedule to put them in.
          </p>
        )}
      </Card>
    </div>
  );
}
