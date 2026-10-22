import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { puzzleLabel, puzzleNumber } from '@/daily/day';
import { LIVE_DAILY, type DailyGame } from '@/daily/types';
import { getGame } from '@/games/registry';
import { AdminContext, api } from './api';
import { Card } from './ui';

interface Cell {
  label: string;
  detail?: string;
  warning: string | null;
}

interface Row {
  day: string;
  /**
   * Per game: today and the days after it, and a day filled in for a daily's
   * archive after it was over (`late`) — never a day before the game's first.
   */
  editable: Partial<Record<DailyGame, boolean>>;
  /** The dailies being served (`LIVE_DAILY`). */
  puzzles: Partial<Record<DailyGame, Cell>>;
}

interface Schedule {
  today: string;
  start: string;
  firstEditable: string;
  rows: Row[];
}

interface Option {
  id: string;
  label: string;
  group?: string;
  /**
   * Days a board or a list is already on; `changed` when its answers are
   * different now, `past` once played, `rested` when over 90 days away (`SAME_REST`).
   */
  used?: { day: string; changed: boolean; past: boolean; rested?: boolean }[];
  /** Why it cannot go on this day: one of its players is in another game then. */
  clash?: string;
}

/** "Mon 5 Oct". */
const dayName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

/**
 * `/analytics/daily` — the daily puzzles, today and the coming days, per game:
 * move a puzzle to another day, pick one by hand, or draw a new one. Days
 * before today are what people played and cannot change — except the first
 * days of a daily that started in the past, filled in for its archive.
 */
export function Daily() {
  const { onOut, tick } = useContext(AdminContext);
  const [game, setGame] = useState<DailyGame>('tenaball');
  const [days, setDays] = useState(30);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** What a change did besides: another game's puzzle drawn again to keep players apart. */
  const [note, setNote] = useState<string | null>(null);
  /** The day whose puzzle is being picked by hand. */
  const [choosing, setChoosing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<Schedule>(`daily?days=${days}`);
    if (res.status === 401) return onOut();
    if (res.body) setSchedule(res.body);
  }, [days, onOut]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const post = async (path: string, body: object, touched: string[]) => {
    if (schedule && touched.some((day) => day < schedule.today)) {
      const sure = window.confirm(
        'That day is over. Only the archive has offered this puzzle, but someone may have played it there. Change it anyway?',
      );
      if (!sure) return;
    } else if (schedule && touched.includes(schedule.today)) {
      const sure = window.confirm('Today’s puzzle may already have been played. Change it anyway?');
      if (!sure) return;
    }
    setBusy(true);
    setMessage(null);
    setNote(null);
    const res = await api<{ error?: string; note?: string }>(`daily/${path}`, {
      method: 'POST',
      body: JSON.stringify({ game, ...body }),
    });
    if (res.status === 401) return onOut();
    if (res.status >= 400) setMessage(res.body?.error ?? `That did not work (${res.status}).`);
    else if (res.body?.note) setNote(res.body.note);
    setChoosing(null);
    await load();
    setBusy(false);
  };

  if (!schedule) return <p className="muted">Making the schedule…</p>;

  const rows = schedule.rows;
  const editable = rows.filter((row) => row.editable[game]);

  return (
    <div className="stack">
      <Card title="Daily puzzles">
        <p className="small muted" style={{ margin: 0 }}>
          Today and the coming days, one game at a time. ↑ and ↓ swap a puzzle with the day before or after it;
          <strong> Choose</strong> picks one by hand; <strong>New</strong> draws another. Days before today were played
          and stay as they were, except a daily’s first days, filled in for its archive. Nobody is in two games on one
          day: a choice that would put a player in two is refused, unless the other one is Higher or Lower, whose pairs
          are then drawn again.{schedule.today < schedule.start ? ` The first daily is ${dayName(schedule.start)}.` : ''}
        </p>
      </Card>

      <div className="an-tabs" role="tablist" aria-label="Game">
        {LIVE_DAILY.map((id) => (
          <button
            key={id}
            type="button"
            className="an-tab"
            aria-pressed={game === id}
            onClick={() => {
              setGame(id);
              setChoosing(null);
              setMessage(null);
              setNote(null);
            }}
          >
            {getGame(id)?.icon} {getGame(id)?.title}
          </button>
        ))}
      </div>

      {message ? <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>{message}</p> : null}
      {note ? <p className="small muted" style={{ margin: 0 }}>{note}</p> : null}

      <div className="scroll-x">
        <table className="an-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Puzzle</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cell = row.puzzles[game];
              const at = editable.indexOf(row);
              const open = Boolean(row.editable[game]);
              const number = puzzleNumber(row.day, game);
              return (
                <tr key={row.day} style={open ? undefined : { opacity: 0.55 }}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div className="bold">{dayName(row.day)}</div>
                    <div className="tiny faint">
                      {number >= 1 ? puzzleLabel(number) : 'not started'}
                      {row.day === schedule.today ? ' · today' : ''}
                      {open && row.day < schedule.today ? ' · archive' : ''}
                    </div>
                  </td>
                  <td style={{ width: '100%' }}>
                    <div className="bold">{cell?.label ?? '—'}</div>
                    {cell?.detail ? <div className="tiny faint">{cell.detail}</div> : null}
                    {cell?.warning ? (
                      <div className="tiny" style={{ color: 'var(--warning)' }}>
                        ⚠ {cell.warning}
                      </div>
                    ) : null}
                    {choosing === row.day ? (
                      <Chooser
                        game={game}
                        day={row.day}
                        onPick={(id) => void post('choose', { day: row.day, id }, [row.day])}
                        onClose={() => setChoosing(null)}
                      />
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {open ? (
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Swap with the day before"
                          disabled={busy || at <= 0}
                          onClick={() =>
                            void post('swap', { a: editable[at - 1].day, b: row.day }, [editable[at - 1].day, row.day])
                          }
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Swap with the day after"
                          disabled={busy || at >= editable.length - 1}
                          onClick={() =>
                            void post('swap', { a: row.day, b: editable[at + 1].day }, [row.day, editable[at + 1].day])
                          }
                        >
                          ↓
                        </button>
                        {game !== 'tic-tac-toe' ? (
                          <button
                            type="button"
                            className="icon-btn"
                            title={game === 'higher-lower' ? 'Pick the category; its ten pairs are drawn' : undefined}
                            disabled={busy}
                            onClick={() => setChoosing(choosing === row.day ? null : row.day)}
                          >
                            Choose
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="icon-btn"
                          title="Draw a new one"
                          disabled={busy}
                          onClick={() => void post('redraw', { day: row.day }, [row.day])}
                        >
                          ↻ New
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button type="button" className="btn" disabled={busy} onClick={() => setDays((n) => Math.min(120, n + 30))}>
        Show 30 more days
      </button>
    </div>
  );
}

/**
 * A search over everything a game's puzzle can be set to on `day`. Anything
 * that would put a player in two games that day is greyed out, with the reason.
 */
function Chooser({
  game,
  day,
  onPick,
  onClose,
}: {
  game: DailyGame;
  day: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [options, setOptions] = useState<Option[] | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let live = true;
    void api<Option[]>(`daily/options?game=${game}&day=${day}`).then((res) => live && setOptions(res.body ?? []));
    return () => {
      live = false;
    };
  }, [game, day]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = options ?? [];
    const found = needle ? all.filter((o) => `${o.label} ${o.group ?? ''}`.toLowerCase().includes(needle)) : all;
    // The fresh ones first: never used, then changed or rested since, then used as they are, then clashing.
    const free = (use: NonNullable<Option['used']>[number]) => use.changed || use.rested;
    const rank = (o: Option) =>
      o.clash ? 4 : !o.used?.length ? 0 : o.used.some((use) => use.past && !free(use)) ? 3 : o.used.every(free) ? 1 : 2;
    return [...found].sort((a, b) => rank(a) - rank(b)).slice(0, 60);
  }, [options, query]);

  return (
    <div className="stack-sm" style={{ marginTop: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <input
          className="input"
          autoFocus
          value={query}
          placeholder={options ? `Search ${options.length} options…` : 'Loading…'}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="icon-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="stack-sm" style={{ maxHeight: 260, overflowY: 'auto' }}>
        {shown.map((option) => {
          const used = option.used ?? [];
          // Played in the last 90 days with the same answers: shown, so you can see when, but not choosable.
          const played = used.some((use) => use.past && !use.changed && !use.rested);
          const blocked = played || Boolean(option.clash);
          const moves = used.filter((use) => !use.past && !use.changed);
          return (
            <button
              key={option.id}
              type="button"
              className="picker-option"
              disabled={blocked}
              style={blocked ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              title={
                option.clash ?? (played ? 'Played in the last 90 days, and its answers have not changed since' : undefined)
              }
              onClick={() => onPick(option.id)}
            >
              {option.label} {option.group ? <span className="faint">· {option.group}</span> : null}
              {option.clash ? <span className="tiny faint"> · {option.clash}</span> : null}
              {!option.clash && used.length ? (
                <span className="tiny" style={{ color: played ? 'var(--text-faint)' : 'var(--warning)' }}>
                  {' '}
                  {played
                    ? `· played ${used.filter((use) => use.past).map((use) => dayName(use.day)).join(', ')}`
                    : moves.length
                      ? `· on ${moves.map((use) => dayName(use.day)).join(', ')} — choosing it swaps the two days`
                      : `· used ${used.map((use) => dayName(use.day)).join(', ')} — ${used.every((use) => use.changed) ? 'answers changed since' : 'over 90 days ago'}`}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
