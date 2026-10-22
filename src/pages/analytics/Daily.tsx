import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { puzzleLabel, puzzleNumber } from '@/daily/day';
import { LIVE_DAILY, type DailyGame } from '@/daily/types';
import { getGame } from '@/games/registry';
import { moneyShort } from '@/lib/format';
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
   * Per game: today and the days after it, and the days before for the
   * one-player games (`PAST_EDITABLE`) — never a day before the game's first.
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
  /** Why it cannot go on this day: the player is another one-player game's answer then. */
  clash?: string;
  /** A player's region, country and career earnings. */
  player?: { region: string | null; country: string | null; earnings: number };
  /** The days within 30 of this one the player is a one-player answer, nearest first. */
  answered?: { day: string; game: string }[];
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
 * before today are what people played and cannot change — except the
 * one-player games', which stay open until the user says to lock them.
 */
export function Daily() {
  const { onOut, tick } = useContext(AdminContext);
  const [game, setGame] = useState<DailyGame>('tenaball');
  const [days, setDays] = useState(30);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
      const sure = window.confirm('That day is over, and people may have played its puzzle. Change it anyway?');
      if (!sure) return;
    } else if (schedule && touched.includes(schedule.today)) {
      const sure = window.confirm('Today’s puzzle may already have been played. Change it anyway?');
      if (!sure) return;
    }
    setBusy(true);
    setMessage(null);
    const res = await api<{ error?: string }>(`daily/${path}`, { method: 'POST', body: JSON.stringify({ game, ...body }) });
    if (res.status === 401) return onOut();
    if (res.status >= 400) setMessage(res.body?.error ?? `That did not work (${res.status}).`);
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
          and stay as they were, except in Fortnitedle, Career Path and Ready Up, whose earlier days can still change.
          The three answers of one day are always three different players.
          {schedule.today < schedule.start ? ` The first daily is ${dayName(schedule.start)}.` : ''}
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
            }}
          >
            {getGame(id)?.icon} {getGame(id)?.title}
          </button>
        ))}
      </div>

      {message ? <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>{message}</p> : null}

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

/** How the chooser orders players; boards and lists go fresh-first or by name. */
type Sort = 'earnings' | 'earnings-asc' | 'name' | 'fresh';

const SORTS: { id: Sort; label: string; players: boolean }[] = [
  { id: 'earnings', label: 'Earnings, highest first', players: true },
  { id: 'earnings-asc', label: 'Earnings, lowest first', players: true },
  { id: 'fresh', label: 'Not used lately first', players: false },
  { id: 'name', label: 'Name, A–Z', players: false },
];

/**
 * A search over everything a game's puzzle can be set to on `day`: by name,
 * country or region, narrowed by region and band (or a board's group), and
 * sorted by earnings, name or how recently it was used (the user, 22 Oct 2026:
 * "improve category pick, so I can search for like region / sort by earnings").
 * A player already another one-player game's answer that day is greyed out,
 * with the reason.
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
  const [region, setRegion] = useState('');
  const [group, setGroup] = useState('');
  const [hideRecent, setHideRecent] = useState(false);
  const [limit, setLimit] = useState(60);

  useEffect(() => {
    let live = true;
    void api<Option[]>(`daily/options?game=${game}&day=${day}`).then((res) => live && setOptions(res.body ?? []));
    return () => {
      live = false;
    };
  }, [game, day]);

  const all = options ?? [];
  const forPlayers = all.some((o) => o.player);
  const [sort, setSort] = useState<Sort>(forPlayers ? 'earnings' : 'fresh');
  useEffect(() => setSort(forPlayers ? 'earnings' : 'fresh'), [forPlayers]);
  const regions = useMemo(() => [...new Set(all.flatMap((o) => o.player?.region ?? []))].sort(), [all]);
  const groups = useMemo(() => [...new Set(all.flatMap((o) => o.group ?? []))], [all]);

  /** Played with the same answers in the last 90 days: shown, so you can see when, but not choosable. */
  const playedRecently = (o: Option) => (o.used ?? []).some((use) => use.past && !use.changed && !use.rested);
  const blocked = (o: Option) => Boolean(o.clash) || playedRecently(o);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const found = all.filter(
      (o) =>
        (!needle ||
          [o.label, o.group, o.player?.country, o.player?.region].some((text) => text?.toLowerCase().includes(needle))) &&
        (!region || o.player?.region === region) &&
        (!group || o.group === group) &&
        (!hideRecent || !(o.answered?.length || o.used?.length)),
    );
    // The fresh ones first: never used, then changed or rested since, then used as they are.
    const free = (use: NonNullable<Option['used']>[number]) => use.changed || use.rested;
    const staleness = (o: Option) =>
      o.player
        ? o.answered?.length ? 1 : 0
        : !o.used?.length ? 0 : o.used.some((use) => use.past && !free(use)) ? 3 : o.used.every(free) ? 1 : 2;
    const order: Record<Sort, (a: Option, b: Option) => number> = {
      earnings: (a, b) => (b.player?.earnings ?? 0) - (a.player?.earnings ?? 0),
      'earnings-asc': (a, b) => (a.player?.earnings ?? 0) - (b.player?.earnings ?? 0),
      name: (a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }),
      fresh: (a, b) => staleness(a) - staleness(b),
    };
    // What cannot be picked always goes last.
    return [...found].sort((a, b) => Number(blocked(a)) - Number(blocked(b)) || order[sort](a, b));
  }, [all, query, region, group, hideRecent, sort]);

  return (
    <div className="stack-sm" style={{ marginTop: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <input
          className="input"
          autoFocus
          value={query}
          placeholder={options ? `Search ${options.length} by name${forPlayers ? ', country or region' : ' or group'}…` : 'Loading…'}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(60);
          }}
        />
        <button type="button" className="icon-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {forPlayers ? (
          <select className="input an-select" value={region} onChange={(event) => setRegion(event.target.value)}>
            <option value="">Every region</option>
            {regions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
        {groups.length > 1 ? (
          <select className="input an-select" value={group} onChange={(event) => setGroup(event.target.value)}>
            <option value="">{forPlayers ? 'Famous and regular' : 'Every group'}</option>
            {groups.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : null}
        <select className="input an-select" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
          {SORTS.filter((option) => forPlayers || !option.players).map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="tiny row" style={{ gap: 4 }}>
          <input type="checkbox" checked={hideRecent} onChange={(event) => setHideRecent(event.target.checked)} />
          Hide {forPlayers ? 'answers of the 30 days around' : 'ones already used'}
        </label>
        <span className="tiny faint">
          {shown.length} of {all.length}
        </span>
      </div>
      <div className="stack-sm" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {shown.slice(0, limit).map((option) => {
          const used = option.used ?? [];
          const played = playedRecently(option);
          const off = blocked(option);
          const moves = used.filter((use) => !use.past && !use.changed);
          return (
            <button
              key={option.id}
              type="button"
              className="picker-option"
              disabled={off}
              style={off ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
              title={option.clash ?? (played ? 'Played in the last 90 days, and its answers have not changed since' : undefined)}
              onClick={() => onPick(option.id)}
            >
              {option.label} {option.group ? <span className="faint">· {option.group}</span> : null}
              {option.player ? (
                <span className="tiny faint">
                  {' '}
                  · {[option.player.country, option.player.region].filter(Boolean).join(', ') || 'no country'} ·{' '}
                  {moneyShort(option.player.earnings)}
                </span>
              ) : null}
              {option.clash ? <span className="tiny faint"> · {option.clash}</span> : null}
              {!option.clash && option.answered?.length ? (
                <span className="tiny" style={{ color: 'var(--warning)' }}>
                  {' '}
                  · answer {option.answered.slice(0, 2).map((use) => `${dayName(use.day)} (${use.game})`).join(', ')}
                  {option.answered.length > 2 ? ` +${option.answered.length - 2}` : ''}
                </span>
              ) : null}
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
        {shown.length > limit ? (
          <button type="button" className="btn" onClick={() => setLimit((n) => n + 60)}>
            Show {Math.min(60, shown.length - limit)} more
          </button>
        ) : null}
      </div>
    </div>
  );
}
