import { lazy, Suspense } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { useOpen } from '@/analytics/client';
import type { GameId } from '@/analytics/types';
import { Layout } from '@/components/Layout';
import { isDailyOn } from '@/daily/types';
import { PUZZLE_PARAM, useToday } from '@/daily/useDay';
import { usePlayMode } from '@/daily/useDailyRound';
import { getGame, OPEN_HIDDEN } from '@/games/registry';
import { gameMeta, HOME_META, NOT_FOUND_META, usePageMeta } from '@/lib/seo';
import { Credits } from '@/pages/Credits';
import { Home } from '@/pages/Home';
import { Privacy } from '@/pages/Privacy';

/**
 * Not linked from anywhere: it is the site owner's page, behind a password.
 * Lazy, so its code is never part of what a player downloads.
 */
const Analytics = lazy(() => import('@/pages/Analytics'));

/**
 * No data provider.
 *
 * Every game now reads the Liquipedia export through its own `loadX()` cache
 * and waits on it behind `LiquipediaGate`, so there is nothing app-wide left
 * to load — and nothing to make a game queue behind data it never reads.
 */
function GamePage() {
  const { slug } = useParams<{ slug: string }>();
  const found = slug ? getGame(slug) : undefined;
  // A hidden game is not on the live site at all, address included.
  const game = found && (!found.hidden || OPEN_HIDDEN) ? found : undefined;
  usePageMeta(game ? gameMeta(game) : HOME_META);
  // Counted here, before the game's data loads, so someone who leaves while it
  // loads is still an open.
  const [siteDaily] = usePlayMode();
  const today = useToday();
  useOpen(game ? (game.id as GameId) : null, siteDaily && isDailyOn(game?.id ?? '', today));
  // Another day from the archive is a fresh game: nothing typed or picked on one day carries to the next.
  const [params] = useSearchParams();
  const { search } = useLocation();

  if (!game) return <Navigate to="/" replace />;
  // An old address — the game's id, before a rename — moves to the current one,
  // `?puzzle=` and all. The server does this with a 301; this covers the dev server.
  if (slug !== game.slug) return <Navigate to={`/game/${game.slug}${search}`} replace />;

  const { Component } = game;
  return (
    <Suspense fallback={<div className="page center muted">Loading game…</div>}>
      <Component key={params.get(PUZZLE_PARAM) ?? ''} />
    </Suspense>
  );
}

function NotFound() {
  usePageMeta(NOT_FOUND_META);
  return (
    <div className="page center stack">
      <h1>Page not found</h1>
      <Link to="/" className="btn btn--primary" style={{ margin: '0 auto' }}>
        Back to the games
      </Link>
    </div>
  );
}

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/credits" element={<Credits />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route
          path="/analytics/*"
          element={
            <Suspense fallback={<div className="page center muted">Loading…</div>}>
              <Analytics />
            </Suspense>
          }
        />
        <Route path="/game/:slug" element={<GamePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Layout>
  );
}
