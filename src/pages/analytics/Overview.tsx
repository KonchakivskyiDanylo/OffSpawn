import { Link } from 'react-router-dom';
import type { Dashboard, FunnelTotals, GameOverview, Mix, Traffic } from '@/analytics/aggregate';
import { GAME_IDS, type GameId } from '@/analytics/types';
import type { Pools } from '@/data/liquipedia/pools';
import { getGame } from '@/games/registry';
import { useScope } from './api';
import {
  change,
  compact,
  Heatmap,
  LineChart,
  Meter,
  OutcomeBar,
  OutcomeLegend,
  Refreshing,
  StatTile,
  type Delta,
  type OutcomeSplit,
} from './charts';
import { categoryLabel, eventLabel, gameTitle, pct, regionLabel, words } from './labels';
import { dayMonthYear } from '@/lib/format';
import { Card, countItems, DataTable, ShareBars, sourceItems } from './ui';

/**
 * `/analytics` — the whole site at once: how many come, what they open, how
 * many rounds they start and finish, when, and how each game is doing.
 */
export function Overview({ data, pools, loading }: { data: Dashboard | null; pools: Pools | null; loading: boolean }) {
  if (!data) return <p className="muted">Loading…</p>;
  const { traffic } = data;
  const landing = traffic.landing.map((count) => ({
    key: count.label,
    label: count.label === 'home' ? 'Home page' : gameTitle(count.label),
    count: count.count,
  }));

  return (
    <Refreshing loading={loading}>
      <Kpis data={data} />
      <FilterNote data={data} />

      <Card title="Traffic" aside={<span className="tiny faint">per day, UTC</span>}>
        <LineChart
          label="Visits, rounds started and rounds finished per day"
          days={traffic.days.map((d) => d.day)}
          series={[
            { key: 'visits', label: 'Visits', color: 'var(--viz-1)', values: traffic.days.map((d) => d.visits) },
            { key: 'starts', label: 'Rounds started', color: 'var(--viz-2)', values: traffic.days.map((d) => d.starts) },
            { key: 'finished', label: 'Rounds finished', color: 'var(--viz-3)', values: traffic.days.map((d) => d.finished) },
          ]}
        />
      </Card>

      <div className="an-grid-2">
        <Card title="Conversion">
          <Conversion totals={traffic.totals} since={traffic.countingSince} />
        </Card>
        <Card title="Where visits land">
          <ShareBars items={landing} empty="No visits in this range yet." />
          <p className="tiny faint" style={{ margin: 0 }}>
            The page a visit started on. A game here means a shared link or a bookmark brought someone straight to it.
          </p>
        </Card>
      </div>

      <Card title="Games" aside={<OutcomeLegend />}>
        <GamesTable data={data} />
      </Card>

      <Card title="When people come">
        <Heatmap grid={traffic.hours} unit="page opens" />
      </Card>

      <MixCard mix={data.mix} pools={pools} />
    </Refreshing>
  );
}

// -------------------------------------------------------------------- tiles --

const against = (range: number) => (range === 1 ? 'the 24 hours before' : `the ${range} days before`);

function rateDelta(now: FunnelTotals, before: FunnelTotals | null, range: number): Delta | null {
  if (!before || !before.finished || !now.finished) return null;
  return {
    value: Math.round((now.won / now.finished - before.won / before.finished) * 100),
    unit: 'pts',
    against: against(range),
  };
}

/** The five numbers every page leads with, each against the period before it. */
export function Kpis({ data, oneGame }: { data: Dashboard; oneGame?: boolean }) {
  const { totals, previous, days } = data.traffic;
  const range = data.range;
  const delta = (key: keyof FunnelTotals) => (previous ? change(totals[key], previous[key], against(range)) : null);
  const trend = (key: keyof FunnelTotals) => days.slice(-14).map((d) => d[key]);
  return (
    <div className="viz-stats">
      <StatTile
        label="Visits"
        value={compact(totals.visits)}
        delta={delta('visits')}
        trend={trend('visits')}
        hint={oneGame ? 'Page loads landing here' : 'Page loads'}
      />
      <StatTile label="Game opens" value={compact(totals.opens)} delta={delta('opens')} trend={trend('opens')} hint="Game pages opened" />
      <StatTile label="Rounds started" value={compact(totals.starts)} delta={delta('starts')} trend={trend('starts')} hint="Deals and first daily moves" />
      <StatTile label="Rounds finished" value={compact(totals.finished)} delta={delta('finished')} trend={trend('finished')} hint="Played to the end" />
      <StatTile label="Won" value={pct(totals.won, totals.finished)} delta={rateDelta(totals, previous, range)} hint="Of the rounds finished" />
    </div>
  );
}

/** Says which numbers a filter on how rounds were set up does not reach. */
export function FilterNote({ data }: { data: Dashboard }) {
  const f = data.filter;
  const narrowing = [f.event && 'event', f.region && 'region', f.difficulty && 'difficulty', f.level && 'level', f.outcome && 'outcome'].filter(Boolean);
  if (!narrowing.length) return null;
  return (
    <p className="tiny faint an-note">
      Visits, opens and starts cannot tell how a round was set up, so the tiles, the traffic and the conversion
      leave out the {narrowing.join(' and ')} filter{narrowing.length === 1 ? '' : 's'}. The tables below use it.
    </p>
  );
}

/**
 * Opens that led to a round, rounds that were finished, rounds that were won.
 *
 * The finish rate sets starts against the rounds finished since starts were
 * counted (`tracked`), not against every round in the range: before 4 Oct
 * 2026 rounds were recorded and starts were not, and a 30-day range read
 * "579 of 487 rounds started".
 */
export function Conversion({ totals, since }: { totals: FunnelTotals; since: string }) {
  const untracked = totals.finished - totals.tracked;
  return (
    <div className="stack">
      <Meter label="Game opens that started a round" part={totals.engaged} whole={totals.opens} note="game opens" />
      <Meter label="Rounds started that were finished" part={totals.tracked} whole={totals.starts} note="rounds started" />
      <Meter label="Rounds finished that were won" part={totals.won} whole={totals.finished} note="rounds finished" />
      {untracked > 0 ? (
        <p className="tiny faint" style={{ margin: 0 }}>
          Starts are counted from {since ? dayMonthYear(since.slice(0, 10)) : 'when the funnel began'}. The{' '}
          {compact(untracked)} round{untracked === 1 ? '' : 's'} finished before then {untracked === 1 ? 'is' : 'are'}{' '}
          left out of the finish rate.
        </p>
      ) : null}
    </div>
  );
}

// -------------------------------------------------------------------- games --

export function splitOf(outcomes: GameOverview['outcomes']): OutcomeSplit {
  return { won: outcomes.won + outcomes.cleared, lost: outcomes.lost, gaveUp: outcomes['gave-up'] };
}

interface GameRow {
  game: GameId;
  traffic: Traffic['games'][number] | undefined;
  rounds: GameOverview | undefined;
}

/**
 * One row per game: its funnel from the opens (range and game only), and how
 * its rounds ended (every filter). The live games are always listed, at zero
 * if need be; a hidden one only once it has numbers.
 */
function GamesTable({ data }: { data: Dashboard }) {
  const { search } = useScope();
  const rows: GameRow[] = GAME_IDS.map((game) => ({
    game,
    traffic: data.traffic.games.find((g) => g.game === game),
    rounds: data.games.find((g) => g.game === game),
  })).filter((row) => !getGame(row.game)?.hidden || row.traffic || row.rounds?.rounds);
  const t = (row: GameRow) => row.traffic?.all;

  return (
    <DataTable
      columns={[
        {
          head: 'Game',
          cell: (row) => (
            <Link to={{ pathname: `/analytics/game/${row.game}`, search: `?${search}` }} className="an-game-link">
              <span aria-hidden="true">{getGame(row.game)?.icon}</span> {gameTitle(row.game)}
              {getGame(row.game)?.hidden ? <span className="an-tag">hidden</span> : null}
            </Link>
          ),
          sort: (row) => gameTitle(row.game),
        },
        { head: 'Opens', cell: (row) => compact(t(row)?.opens ?? 0), sort: (row) => t(row)?.opens ?? 0, align: 'right' },
        {
          head: 'Started',
          cell: (row) => pct(t(row)?.engaged ?? 0, t(row)?.opens ?? 0),
          sort: (row) => ratio(t(row)?.engaged, t(row)?.opens),
          align: 'right',
        },
        { head: 'Rounds', cell: (row) => compact(t(row)?.finished ?? 0), sort: (row) => t(row)?.finished ?? 0, align: 'right' },
        {
          head: 'Finished',
          cell: (row) => pct(t(row)?.tracked ?? 0, t(row)?.starts ?? 0),
          sort: (row) => ratio(t(row)?.tracked, t(row)?.starts),
          align: 'right',
        },
        {
          head: 'Daily',
          cell: (row) => pct(row.traffic?.daily.finished ?? 0, t(row)?.finished ?? 0),
          sort: (row) => ratio(row.traffic?.daily.finished, t(row)?.finished),
          align: 'right',
        },
        {
          head: 'How rounds ended',
          cell: (row) => (row.rounds ? <OutcomeBar split={splitOf(row.rounds.outcomes)} /> : <span className="tiny faint">—</span>),
          sort: (row) => (row.rounds?.rounds ? (row.rounds.outcomes.won + row.rounds.outcomes.cleared) / row.rounds.rounds : -1),
        },
      ]}
      rows={rows.sort((a, b) => (t(b)?.opens ?? 0) + (t(b)?.finished ?? 0) - ((t(a)?.opens ?? 0) + (t(a)?.finished ?? 0)))}
      empty="No games yet."
    />
  );
}

const ratio = (part = 0, whole = 0) => (whole ? part / whole : -1);

// ---------------------------------------------------------------------- mix --

/**
 * How the rounds were set up, one question at a time.
 *
 * Each breakdown is over the rounds it applies to — regions over Chosen
 * rounds, fields over event rounds — and says so, so "Europe 60%" means
 * sixty percent of the rounds where somebody picked a region.
 */
export function MixCard({ mix, pools, oneGame }: { mix: Mix; pools: Pools | null; oneGame?: boolean }) {
  const sources = sourceItems(mix.source).filter((item) => !oneGame || item.count > 0 || item.key === 'event');
  const chosen = mix.source.find((s) => s.label === 'chosen')?.count ?? 0;
  const events = mix.source.find((s) => s.label === 'event')?.count ?? 0;
  const levelled = mix.level.reduce((n, c) => n + c.count, 0);

  return (
    <Card title="How rounds were set up">
      {mix.rounds === 0 ? (
        <p className="small muted">No rounds in this view.</p>
      ) : (
        <div className="an-mix">
          <div className="stack-sm">
            <div className="field-label">Where the players came from</div>
            <ShareBars items={sources} total={mix.rounds} />
          </div>
          {mix.events.length ? (
            <div className="stack-sm">
              <div className="field-label">Event mode — which field ({events})</div>
              <ShareBars items={countItems(mix.events, (v) => eventLabel(v, pools))} />
            </div>
          ) : null}
          {mix.regions.length ? (
            <div className="stack-sm">
              <div className="field-label">Chosen — region ({chosen})</div>
              <ShareBars items={countItems(mix.regions, regionLabel)} />
            </div>
          ) : null}
          {mix.difficulty.length ? (
            <div className="stack-sm">
              <div className="field-label">Chosen — difficulty ({chosen})</div>
              <ShareBars items={countItems(mix.difficulty, words)} />
            </div>
          ) : null}
          {mix.level.length ? (
            <div className="stack-sm">
              <div className="field-label">Level ({levelled})</div>
              <ShareBars items={countItems(mix.level, words)} />
              <p className="tiny faint" style={{ margin: 0 }}>
                A game’s own Easy / Medium / Hard; for Fortnitedle, the level the round was played at.
              </p>
            </div>
          ) : null}
          {mix.mode.length ? (
            <div className="stack-sm">
              <div className="field-label">Game mode</div>
              <ShareBars items={countItems(mix.mode, words)} />
            </div>
          ) : null}
          {mix.category.length ? (
            <div className="stack-sm">
              <div className="field-label">Category</div>
              <ShareBars items={countItems(mix.category, categoryLabel)} />
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
