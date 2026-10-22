import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import type { Dashboard } from '@/analytics/aggregate';
import { GAME_IDS, type ClientError, type Stored, type StoredSupport } from '@/analytics/types';
import { usePools } from '@/data/liquipedia/usePools';
import { getGame } from '@/games/registry';
import { HOME_META, SITE_NAME, usePageMeta } from '@/lib/seo';
import { AdminContext, api, useAdminData, useScope } from './analytics/api';
import { GamePage } from './analytics/GamePage';
import { Errors, Inbox } from './analytics/Inbox';
import { Socials } from './analytics/Socials';
import { Daily } from './analytics/Daily';
import { Data } from './analytics/Data';
import { ContextinhoLab } from './analytics/ContextinhoLab';
import { GridBuilder } from './analytics/GridBuilder';
import { gameTitle } from './analytics/labels';
import { Overview } from './analytics/Overview';
import { PlayerPage, Players } from './analytics/Players';
import { FilterBar } from './analytics/ui';
import './analytics.css';

/**
 * `/analytics` — the site owner's page.
 *
 * Password-protected by the server (`ADMIN_PASSWORD`), not linked from
 * anywhere, and lazy-loaded so none of it ships to players. Everything on it
 * is computed from the stored rounds on request, so it is always current.
 *
 * A page per question rather than one long scroll:
 *
 *   /analytics                 every game: volume, outcomes, how rounds were set up
 *   /analytics/game/<id>       one game, with the tables only it has
 *   /analytics/players         find a player
 *   /analytics/players/<id>    one player across every game
 *   /analytics/support         the 💬 inbox
 *   /analytics/errors          browser errors
 *   /analytics/daily           the daily schedule: reorder, choose, redraw
 *   /analytics/socials         the follower counts and the Twitch login
 *   /analytics/data            how old the Liquipedia data is, and Update now
 *   /analytics/grid            build a Tic Tac Toe grid by hand (dev servers only)
 *   /analytics/contextinho     any player's Contextinho ranking, with the weights (dev servers only)
 *
 * The range and the filters live in the query string and ride along on every
 * link, so they hold while you move between pages.
 */

type Session = 'checking' | 'out' | 'in' | 'off' | 'offline';

/** Not for search engines — robots.txt keeps them out — so no canonical address. */
const DASHBOARD_META = { title: `Dashboard | ${SITE_NAME}`, description: HOME_META.description, path: null };

export default function Analytics() {
  usePageMeta(DASHBOARD_META);
  const [session, setSession] = useState<Session>('checking');

  const check = useCallback(async () => {
    try {
      const { status } = await api('me');
      setSession(status === 204 ? 'in' : status === 503 ? 'off' : 'out');
    } catch {
      setSession('offline');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);
  const loggedOut = useCallback(() => setSession('out'), []);

  return (
    <div className="page stack an-page">
      {session !== 'in' ? <h1 style={{ margin: 0 }}>Analytics</h1> : null}
      {session === 'checking' ? <p className="muted">Checking…</p> : null}
      {session === 'offline' ? (
        <p className="muted">
          The server is not answering. Locally, run <code>npm run dev:all</code>.
        </p>
      ) : null}
      {session === 'off' ? (
        <p className="muted">
          The dashboard is switched off: set <code>ADMIN_PASSWORD</code> on the server.
        </p>
      ) : null}
      {session === 'out' ? <Login onIn={() => setSession('in')} /> : null}
      {session === 'in' ? <Board onOut={loggedOut} /> : null}
    </div>
  );
}

function Login({ onIn }: { onIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card stack an-login"
      onSubmit={async (event) => {
        event.preventDefault();
        const { status, body } = await api<{ error: string }>('login', {
          method: 'POST',
          body: JSON.stringify({ password }),
        });
        if (status === 204) onIn();
        else setError(body?.error ?? 'Could not log in');
      }}
    >
      <label className="stack-sm">
        <span className="field-label">Password</span>
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoFocus
        />
      </label>
      {error ? <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p> : null}
      <button type="submit" className="btn btn--primary">
        Log in
      </button>
    </form>
  );
}

function Board({ onOut }: { onOut: () => void }) {
  const [tick, setTick] = useState(0);
  const context = useMemo(() => ({ onOut, tick }), [onOut, tick]);
  return (
    <AdminContext.Provider value={context}>
      <Pages onReload={() => setTick((n) => n + 1)} onOut={onOut} />
    </AdminContext.Provider>
  );
}

function Pages({ onReload, onOut }: { onReload: () => void; onOut: () => void }) {
  const { query, search } = useScope();
  const { pathname } = useLocation();
  const { pools } = usePools();
  // The overview's numbers, and the filter dropdowns' options on every page.
  const { data, loading } = useAdminData<Dashboard>(`dashboard?${query({ game: undefined })}`);
  const { data: tickets } = useAdminData<StoredSupport[]>('support');
  const { data: errors } = useAdminData<Stored<ClientError>[]>('errors');
  const [showHidden, setShowHidden] = useState(false);

  const fresh = (tickets ?? []).filter((ticket) => ticket.status === 'new').length;
  // The inbox, the daily schedule, the followers and data pages and the grid builder are not filtered by the dashboard's bar.
  const inbox = /\/analytics\/(support|errors|daily|socials|data|grid|contextinho)/.test(pathname);
  const on = (path: string) => ({ pathname: path, search: search ? `?${search}` : '' });
  const tab = ({ isActive }: { isActive: boolean }) => `an-tab${isActive ? ' is-active' : ''}`;
  // The live games first; the hidden ones behind a toggle, unless one is open.
  const live = GAME_IDS.filter((id) => !getGame(id)?.hidden);
  const hidden = GAME_IDS.filter((id) => getGame(id)?.hidden);
  const openHidden = hidden.some((id) => pathname.endsWith(`/game/${id}`));
  const chips = showHidden || openHidden ? [...live, ...hidden] : live;
  const opens = (id: string) => data?.traffic.games.find((g) => g.game === id)?.all.opens;

  return (
    <div className="stack">
      <header className="an-head">
        <div>
          <h1 className="an-title">Analytics</h1>
          <p className="tiny faint" style={{ margin: 0 }}>
            {data ? `Updated ${new Date(data.generated).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Loading…'}
            {' · '}counts, never people
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={onReload} aria-label="Reload" title="Reload">
            ↻
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await api('logout', { method: 'POST' });
              onOut();
            }}
          >
            Log out
          </button>
        </div>
      </header>

      <nav className="an-tabs" aria-label="Analytics">
        <NavLink end to={on('/analytics')} className={tab}>
          Overview
        </NavLink>
        <NavLink to={on('/analytics/players')} className={tab}>
          Players
        </NavLink>
        <NavLink to={on('/analytics/daily')} className={tab}>
          Daily
        </NavLink>
        <NavLink to={on('/analytics/socials')} className={tab}>
          Followers
        </NavLink>
        <NavLink to={on('/analytics/data')} className={tab}>
          Data
        </NavLink>
        {/* Dev only until Tic Tac Toe is a daily again; then it belongs in Daily's Choose. */}
        {import.meta.env.DEV ? (
          <NavLink to={on('/analytics/grid')} className={tab}>
            Grid builder
          </NavLink>
        ) : null}
        {import.meta.env.DEV ? (
          <NavLink to={on('/analytics/contextinho')} className={tab}>
            Contextinho lab
          </NavLink>
        ) : null}
        <NavLink to={on('/analytics/support')} className={tab}>
          Support{fresh ? <span className="an-badge">{fresh}</span> : null}
        </NavLink>
        <NavLink to={on('/analytics/errors')} className={tab}>
          Errors{errors?.length ? <span className="an-badge an-badge--quiet">{errors.length}</span> : null}
        </NavLink>
      </nav>

      {inbox ? null : (
        <>
          <div className="an-games" aria-label="Games">
            {chips.map((id) => (
              <NavLink
                key={id}
                to={on(`/analytics/game/${id}`)}
                className={({ isActive }) => `an-game${isActive ? ' is-active' : ''}${getGame(id)?.hidden ? ' an-game--hidden' : ''}`}
                title={`${opens(id) ?? 0} opens, ${data?.games.find((g) => g.game === id)?.rounds ?? 0} rounds in this range`}
              >
                <span aria-hidden="true">{getGame(id)?.icon}</span> {gameTitle(id)}
                <span className="an-game__n">{data?.games.find((g) => g.game === id)?.rounds ?? '·'}</span>
              </NavLink>
            ))}
            {openHidden ? null : (
              <button type="button" className="an-game an-game--more" onClick={() => setShowHidden(!showHidden)}>
                {showHidden ? 'Hide the hidden games' : `+ ${hidden.length} hidden`}
              </button>
            )}
          </div>
          <FilterBar options={data?.options ?? null} pools={pools} />
        </>
      )}

      <Routes>
        <Route index element={<Overview data={data} pools={pools} loading={loading} />} />
        <Route path="game/:id" element={<GamePage pools={pools} />} />
        <Route path="players" element={<Players />} />
        <Route path="players/:id" element={<PlayerPage />} />
        <Route path="support" element={<Inbox tickets={tickets} onChange={onReload} />} />
        <Route path="errors" element={<Errors errors={errors} />} />
        <Route path="socials" element={<Socials />} />
        <Route path="daily" element={<Daily />} />
        <Route path="data" element={<Data />} />
        {import.meta.env.DEV ? <Route path="grid" element={<GridBuilder />} /> : null}
        {import.meta.env.DEV ? <Route path="contextinho" element={<ContextinhoLab />} /> : null}
        <Route path="*" element={<Navigate to={on('/analytics')} replace />} />
      </Routes>
    </div>
  );
}
