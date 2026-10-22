import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useOpen } from '@/analytics/client';
import { ModePicker } from '@/components/EventMode';
import { loadDailySet } from '@/daily/client';
import { DAILY_START } from '@/daily/day';
import { gameStats, useDailyLogs } from '@/daily/progress';
import { isDailyOn, type DailyGame } from '@/daily/types';
import { useCountdown, useToday } from '@/daily/useDay';
import { usePlayMode } from '@/daily/useDailyRound';
import { loadRoster } from '@/data/liquipedia/roster';
import { VISIBLE_GAMES, type GameMeta } from '@/games/registry';
import { HOME_META, usePageMeta } from '@/lib/seo';
import '@/components/daily.css';

/**
 * Fetches the players and today's puzzles while someone is still choosing a
 * game.
 *
 * Every game needs them, so by the time a card is tapped they are usually
 * already downloaded. Waits for an idle moment so it never competes with the
 * page itself; both loaders cache, so the game just picks up the same promise.
 * A failure is left for the game to report.
 */
function usePrefetch(today: string, daily: boolean) {
  useEffect(() => {
    const load = () => {
      void loadRoster().catch(() => {});
      if (daily) void loadDailySet(today).catch(() => {});
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(load, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(load, 1500);
    return () => window.clearTimeout(id);
  }, [today, daily]);
}

const won = (outcome: string) => outcome === 'won' || outcome === 'cleared';

/** "Monday 5 October" — the launch day, for the line on the home page before it. */
const LAUNCH = new Date(`${DAILY_START}T12:00:00Z`).toLocaleDateString('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
});

export function Home() {
  usePageMeta(HOME_META);
  useOpen('home');
  const today = useToday();
  const [daily] = usePlayMode();
  usePrefetch(today, daily);
  const countdown = useCountdown();
  // A game before its first daily is under Unlimited until that day.
  const isDaily = (game: GameMeta) => isDailyOn(game.id, today);
  const dailies = VISIBLE_GAMES.filter(isDaily);
  const endless = VISIBLE_GAMES.filter((game) => !isDaily(game));

  // Read through the shared store, so finishing a puzzle in another tab ticks it here too.
  const all = useDailyLogs();
  const logs = dailies.map((game) => [game, all[game.id as DailyGame]] as const);
  const doneToday = logs.filter(([, log]) => log[today]).length;

  // Before the dailies start (or on a dev server in practice): every game, as the site always was.
  if (!daily) {
    return (
      <div className="page stack-lg">
        <section className="stack" style={{ paddingTop: 12 }}>
          <h1>How well do you actually know competitive Fortnite?</h1>
          <p className="muted" style={{ maxWidth: '60ch' }}>
            Puzzles built on the real competitive record — FNCS grand finals, the World Cup, the LANs and
            everything under them. No account, no sign-up: pick a game and play.
          </p>
          {today < DAILY_START ? (
            <p className="home-soon">
              📅 Daily puzzles start on {LAUNCH}: one a day in every game, the same for everyone.
            </p>
          ) : null}
        </section>

        <ModePicker />

        <section className="game-grid">
          {VISIBLE_GAMES.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </section>
      </div>
    );
  }

  return (
    <div className="page stack-lg">
      <section className="stack" style={{ paddingTop: 12 }}>
        <h1>How well do you actually know competitive Fortnite?</h1>
        <p className="muted" style={{ maxWidth: '60ch' }}>
          A new set of puzzles every day, built on the real competitive record — FNCS grand finals, the
          World Cup, the LANs and everything under them. The same puzzles for everyone, new at midnight
          Central European time. No account, no sign-up.
        </p>
      </section>

      <ModePicker />

      <section className="stack">
        <div className="home-today">
          <div>
            {/* No puzzle number: each game counts its own days, so one number cannot
                stand for them all. Earlier puzzles live inside each game (the user, 13 Oct 2026). */}
            <div className="card__title" style={{ marginBottom: 2 }}>
              Today’s puzzles
            </div>
            <div className="home-today__done">
              {doneToday === dailies.length ? 'All done for today ✓' : `${doneToday} of ${dailies.length} played`}
            </div>
          </div>
          <div className="home-today__side">
            <span className="home-today__next">
              Next in <strong>{countdown}</strong>
            </span>
          </div>
        </div>

        <div className="game-grid">
          {logs.map(([game, log]) => {
            const done = log[today];
            // Each game keeps its own streak (the user, 4 Oct 2026: "if player played
            // fortnitedle today, it will show on fortnitedle 1 day streak but not for other games").
            const { streak } = gameStats(log, today);
            return (
              <Link
                key={game.id}
                to={`/game/${game.slug}`}
                className={`game-card${done ? ' game-card--done' : ''}`}
              >
                <span className="game-card__icon" aria-hidden="true">
                  {game.icon}
                </span>
                <span className="game-card__body">
                  <span className="game-card__title">{game.title}</span>
                  <span className="game-card__tagline">{game.tagline}</span>
                  {streak > 0 ? (
                    <span className="game-card__streak">
                      🔥 {streak}-day streak
                    </span>
                  ) : null}
                </span>
                {done ? (
                  <span
                    className={`game-card__done${won(done.outcome) ? '' : ' game-card__done--lost'}`}
                    title="Played today"
                  >
                    {won(done.outcome) ? '✓ ' : ''}
                    {done.score}
                  </span>
                ) : (
                  <span className="game-card__play">Play</span>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      {endless.length > 0 ? (
        <section className="stack">
          <div className="card__title" style={{ marginBottom: 0 }}>
            Unlimited
          </div>
          <div className="game-grid">
            {endless.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** A game's card, for the games that are not a daily puzzle. */
function GameCard({ game }: { game: GameMeta }) {
  return (
    <Link to={`/game/${game.slug}`} className="game-card">
      <span className="game-card__icon" aria-hidden="true">
        {game.icon}
      </span>
      <span className="game-card__body">
        <span className="game-card__title">{game.title}</span>
        <span className="game-card__tagline">{game.tagline}</span>
      </span>
      <span className="game-card__go" aria-hidden="true">
        →
      </span>
    </Link>
  );
}
