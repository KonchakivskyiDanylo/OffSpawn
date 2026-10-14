import { useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { BoardRow, ClueRow, Count, Dashboard, SecretRow, Traffic } from '@/analytics/aggregate';
import { GAME_IDS, type GameId } from '@/analytics/types';
import type { Pools } from '@/data/liquipedia/pools';
import { getGame } from '@/games/registry';
import { useAdminData, useScope } from './api';
import { compact, LineChart, OutcomeBar, OutcomeLegend, Refreshing } from './charts';
import { categoryLabel, gameTitle, pct, words } from './labels';
import { Conversion, FilterNote, Kpis, MixCard, splitOf } from './Overview';
import { Card, DataTable, matchesText, RowSearch } from './ui';

/**
 * `/analytics/game/<id>` — one game on its own: the same tiles, traffic and
 * conversion as the overview, narrowed to it, how its daily and unlimited
 * halves compare, how its rounds ended, then the tables that are about this
 * game alone. A search box narrows those tables by name.
 */
export function GamePage({ pools }: { pools: Pools | null }) {
  const { id } = useParams<{ id: string }>();
  const game = (GAME_IDS as readonly string[]).includes(id ?? '') ? (id as GameId) : null;
  const { query, search } = useScope();
  const { data, loading } = useAdminData<Dashboard>(game ? `dashboard?${query({ game })}` : null);
  const [text, setText] = useState('');

  if (!game) return <Navigate to={{ pathname: '/analytics', search: `?${search}` }} replace />;
  const meta = getGame(game);
  const ready = data && data.filter.game === game;
  const days = data?.traffic.days ?? [];
  const halves = data?.traffic.games.find((g) => g.game === game);

  return (
    <div className="stack">
      <div className="row-between">
        <h2 style={{ margin: 0 }}>
          <span aria-hidden="true">{meta?.icon}</span> {gameTitle(game)}
          {meta?.hidden ? <span className="an-tag">hidden</span> : null}
        </h2>
        <Link className="small" to={{ pathname: '/analytics', search: `?${search}` }}>
          ← All games
        </Link>
      </div>
      {!ready ? (
        <p className="muted">Loading…</p>
      ) : (
        <Refreshing loading={loading}>
          <Kpis data={data} oneGame />
          <FilterNote data={data} />
          <Card title="Traffic" aside={<span className="tiny faint">per day, UTC</span>}>
            <LineChart
              label={`${gameTitle(game)}: opens, rounds started and rounds finished per day`}
              days={days.map((d) => d.day)}
              series={[
                { key: 'opens', label: 'Opens', color: 'var(--viz-1)', values: days.map((d) => d.opens) },
                { key: 'starts', label: 'Rounds started', color: 'var(--viz-2)', values: days.map((d) => d.starts) },
                { key: 'finished', label: 'Rounds finished', color: 'var(--viz-3)', values: days.map((d) => d.finished) },
              ]}
            />
          </Card>
          <div className="an-grid-2">
            <Card title="Conversion">
              <Conversion totals={data.traffic.totals} since={data.traffic.countingSince} />
            </Card>
            <Card title="Daily and unlimited">
              {halves ? <Halves halves={halves} /> : <p className="small muted">Nothing in this range yet.</p>}
            </Card>
          </div>
          <Card title="How rounds ended" aside={<OutcomeLegend />}>
            {data.rounds ? (
              <div className="stack-sm">
                <OutcomeBar split={splitOf(data.outcomes)} wide />
                <p className="tiny faint" style={{ margin: 0 }}>
                  {data.rounds} round{data.rounds === 1 ? '' : 's'}: {data.outcomes.won + data.outcomes.cleared} won,{' '}
                  {data.outcomes.lost} lost, {data.outcomes['gave-up']} given up.
                </p>
              </div>
            ) : (
              <p className="small muted">No rounds in this view.</p>
            )}
          </Card>
          <MixCard mix={data.mix} pools={pools} oneGame />
          <Card
            title="Detail"
            aside={<RowSearch value={text} onChange={setText} placeholder="Find a player, board, rule…" />}
          >
            <Detail game={game} data={data} text={text} />
          </Card>
        </Refreshing>
      )}
    </div>
  );
}

/** The game's daily puzzle against its unlimited play, side by side. */
function Halves({ halves }: { halves: Traffic['games'][number] }) {
  const rows = [
    { name: 'Daily', t: halves.daily },
    { name: 'Unlimited', t: halves.unlimited },
  ];
  return (
    <DataTable
      columns={[
        { head: '', cell: (row) => row.name },
        { head: 'Opens', cell: (row) => compact(row.t.opens), align: 'right' },
        { head: 'Started', cell: (row) => pct(row.t.engaged, row.t.opens), align: 'right' },
        { head: 'Rounds', cell: (row) => compact(row.t.finished), align: 'right' },
        { head: 'Won', cell: (row) => pct(row.t.won, row.t.finished), align: 'right' },
      ]}
      rows={rows}
    />
  );
}

function Detail({ game, data, text }: { game: GameId; data: Dashboard; text: string }): ReactNode {
  const has = (...names: string[]) => names.some((name) => matchesText(name, text));
  switch (game) {
    case 'wordle':
      return <Secrets rows={data.wordle.filter((row) => has(row.name))} />;
    case 'guess-the-player':
      return <Secrets rows={data.guessThePlayer.filter((row) => has(row.name))} />;
    case 'career-path':
      return <Clues rows={data.careerPath.filter((row) => has(row.name, ...row.clues.map((c) => c.name)))} />;
    case 'who-are-ya':
      return <Clues rows={data.whoAreYa.filter((row) => has(row.name, ...row.clues.map((c) => c.name)))} />;
    case 'tenaball':
      return <Boards rows={data.tenaball.filter((row) => has(row.name, ...row.answers.map((a) => a.name)))} wrong />;
    case 'list':
      return <Boards rows={data.list.filter((row) => has(row.name, ...row.answers.map((a) => a.name)))} />;
    case 'bingo':
      return <Boards rows={data.bingo.filter((row) => has(row.name, ...row.answers.map((a) => a.name)))} />;
    case 'pyramid':
      return <Boards rows={data.pyramid.filter((row) => has(row.name, ...row.answers.map((a) => a.name)))} />;
    case 'rewind':
      return <Boards rows={data.rewind.filter((row) => has(row.name, ...row.answers.map((a) => a.name)))} />;
    case 'contextinho':
      return <Secrets rows={data.contextinho.filter((row) => has(row.name))} />;
    case 'curveball':
      return <Clues rows={data.curveball.filter((row) => has(row.name, ...row.clues.map((c) => c.name)))} />;
    case 'irl':
      return <Clues rows={data.irl.filter((row) => has(row.name, ...row.clues.map((c) => c.name)))} />;
    case 'transfer-window':
      return <Clues rows={data.transferWindow.filter((row) => has(row.name, ...row.clues.map((c) => c.name)))} />;
    case 'org-chart':
      return <Clues rows={data.orgChart.filter((row) => has(row.name, ...row.clues.map((c) => c.name)))} noLink />;
    case 'which-lobby':
      return <Clues rows={data.whichLobby.filter((row) => has(row.name, ...row.clues.map((c) => c.name)))} noLink />;
    case 'impostor':
      return <Griefer data={data} has={has} />;
    case 'tic-tac-toe':
      return <TicTacToe data={data} has={has} />;
    case 'connections':
      return <Connections data={data} has={has} />;
    case 'higher-lower':
      return <HigherLower data={data} has={has} />;
  }
}

const counts = (items: Count[]) => items.map((item) => `${item.label} ${item.count}`).join(' · ') || '—';

/** A player's name, linking to everything the dashboard knows about them. */
function PlayerLink({ id, name }: { id: string; name: string }) {
  const { search } = useScope();
  return <Link to={{ pathname: `/analytics/players/${encodeURIComponent(id)}`, search: `?${search}` }}>{name}</Link>;
}

function Secrets({ rows }: { rows: SecretRow[] }) {
  return (
    <DataTable
      columns={[
        { head: 'Player', cell: (row) => <PlayerLink id={row.id} name={row.name} />, sort: (row) => row.name },
        { head: 'Plays', cell: (row) => row.plays, sort: (row) => row.plays, align: 'right' },
        { head: 'Solved', cell: (row) => pct(row.solved, row.plays), sort: (row) => row.solved / row.plays, align: 'right' },
        {
          head: 'Avg guesses when solved',
          cell: (row) => row.avgGuesses ?? '—',
          sort: (row) => row.avgGuesses ?? 99,
          align: 'right',
        },
      ]}
      rows={rows}
    />
  );
}

/** `noLink` for the games whose secret is not a player: Org Chart's org, Which Lobby's tournament. */
function Clues({ rows, noLink }: { rows: ClueRow[]; noLink?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <DataTable
      columns={[
        {
          head: noLink ? 'Answer' : 'Player',
          cell: (row) => (
            <div className="stack-sm">
              <span>
                {noLink ? row.name : <PlayerLink id={row.id} name={row.name} />}{' '}
                <button type="button" className="link-btn tiny" onClick={() => setOpen(open === row.id ? null : row.id)}>
                  {open === row.id ? 'hide clues' : 'clues'}
                </button>
              </span>
              {open === row.id ? (
                <>
                  <DataTable
                    columns={[
                      { head: 'Clue', cell: (c) => c.name },
                      { head: 'Solved right after', cell: (c) => `${c.solved}/${c.reached}`, sort: (c) => c.solved, align: 'right' },
                      { head: 'Skipped', cell: (c) => c.skipped, sort: (c) => c.skipped, align: 'right' },
                      { head: 'Guessed wrong', cell: (c) => c.wrong, sort: (c) => c.wrong, align: 'right' },
                    ]}
                    rows={row.clues}
                  />
                  {row.mistakenFor.length ? <p className="tiny muted">Mistaken for: {counts(row.mistakenFor)}</p> : null}
                </>
              ) : null}
            </div>
          ),
          sort: (row) => row.name,
        },
        { head: 'Plays', cell: (row) => row.plays, sort: (row) => row.plays, align: 'right' },
        { head: 'Solved', cell: (row) => pct(row.solved, row.plays), sort: (row) => row.solved / row.plays, align: 'right' },
        { head: 'Avg clues', cell: (row) => row.avgClues ?? '—', sort: (row) => row.avgClues ?? 99, align: 'right' },
        { head: 'Avg guesses', cell: (row) => row.avgGuesses ?? '—', sort: (row) => row.avgGuesses ?? 99, align: 'right' },
      ]}
      rows={rows}
    />
  );
}

function Boards({ rows, wrong }: { rows: BoardRow[]; wrong?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <DataTable
      columns={[
        {
          head: wrong ? 'Board' : 'List',
          cell: (row) => (
            <div className="stack-sm">
              <button type="button" className="link-btn an-link-left" onClick={() => setOpen(open === row.id ? null : row.id)}>
                {row.name}
              </button>
              {open === row.id ? (
                <>
                  <DataTable
                    columns={[
                      { head: 'Answer', cell: (a) => a.name, sort: (a) => a.name },
                      { head: 'Found', cell: (a) => `${a.found}/${a.seen}`, sort: (a) => a.found / a.seen, align: 'right' },
                    ]}
                    rows={row.answers}
                    limit={20}
                  />
                  {wrong && row.wrong.length ? <p className="tiny muted">Wrong answers typed: {counts(row.wrong)}</p> : null}
                </>
              ) : null}
            </div>
          ),
          sort: (row) => row.name,
        },
        { head: 'Plays', cell: (row) => row.plays, sort: (row) => row.plays, align: 'right' },
        { head: 'Found on average', cell: (row) => pct(row.avgShare, 1), sort: (row) => row.avgShare, align: 'right' },
        { head: 'Perfect', cell: (row) => row.perfect, sort: (row) => row.perfect, align: 'right' },
        { head: 'Gave up', cell: (row) => row.gaveUp, sort: (row) => row.gaveUp, align: 'right' },
      ]}
      rows={rows}
    />
  );
}

type Has = (...names: string[]) => boolean;

function Griefer({ data, has }: { data: Dashboard; has: Has }) {
  return (
    <div className="stack">
      <DataTable
        columns={[
          { head: 'Rule', cell: (rule) => rule.name, sort: (rule) => rule.name },
          { head: 'Plays', cell: (rule) => rule.plays, sort: (rule) => rule.plays, align: 'right' },
          { head: 'Won', cell: (rule) => pct(rule.won, rule.plays), sort: (rule) => rule.won / rule.plays, align: 'right' },
        ]}
        rows={data.griefer.rules.filter((rule) => has(rule.name))}
      />
      <div className="field-label">Most misread</div>
      <DataTable
        columns={[
          { head: 'Rule', cell: (read) => read.rule, sort: (read) => read.rule },
          { head: 'Player', cell: (read) => read.player, sort: (read) => read.player },
          { head: 'Actually fits?', cell: (read) => (read.fits ? 'Yes — left out' : 'No — picked') },
          { head: 'Got it wrong', cell: (read) => `${read.wrong}/${read.shown}`, sort: (read) => read.wrong / read.shown, align: 'right' },
        ]}
        rows={data.griefer.misreads.filter((read) => has(read.rule, read.player))}
      />
    </div>
  );
}

function TicTacToe({ data, has }: { data: Dashboard; has: Has }) {
  return (
    <DataTable
      columns={[
        { head: 'Cell', cell: (cell) => cell.name, sort: (cell) => cell.name },
        { head: 'Plays', cell: (cell) => cell.plays, sort: (cell) => cell.plays, align: 'right' },
        { head: 'Filled', cell: (cell) => pct(cell.filled, cell.plays), sort: (cell) => cell.filled / cell.plays, align: 'right' },
        { head: 'Most used', cell: (cell) => counts(cell.answers.slice(0, 3)) },
        { head: 'Least used', cell: (cell) => counts(cell.answers.slice(-3).reverse()) },
      ]}
      rows={data.ticTacToe.filter((cell) => has(cell.name, ...cell.answers.map((a) => a.label)))}
    />
  );
}

function Connections({ data, has }: { data: Dashboard; has: Has }) {
  const misgrouped = data.connections.misgrouped.filter((item) => has(item.label));
  return (
    <div className="stack">
      <DataTable
        columns={[
          { head: 'Group', cell: (group) => group.name, sort: (group) => group.name },
          { head: 'Plays', cell: (group) => group.plays, sort: (group) => group.plays, align: 'right' },
          { head: 'Solved', cell: (group) => pct(group.solved, group.plays), sort: (group) => group.solved / group.plays, align: 'right' },
        ]}
        rows={data.connections.groups.filter((group) => has(group.name))}
      />
      <p className="tiny muted" style={{ margin: 0 }}>
        In a wrong four most often: {counts(misgrouped)}
      </p>
    </div>
  );
}

function HigherLower({ data, has }: { data: Dashboard; has: Has }) {
  const { runs, pairs, players } = data.higherLower;
  return (
    <div className="stack">
      <DataTable
        columns={[
          { head: 'Category', cell: (run) => categoryLabel(run.category), sort: (run) => run.category },
          { head: 'Level', cell: (run) => words(run.level), sort: (run) => run.level },
          { head: 'Runs', cell: (run) => run.runs, sort: (run) => run.runs, align: 'right' },
          { head: 'Avg score', cell: (run) => run.avgScore, sort: (run) => run.avgScore, align: 'right' },
          { head: 'Best', cell: (run) => run.best, sort: (run) => run.best, align: 'right' },
        ]}
        rows={runs}
      />
      <div className="field-label">Players, as the one to call</div>
      <DataTable
        columns={[
          { head: 'Player', cell: (row) => <PlayerLink id={row.id} name={row.name} />, sort: (row) => row.name },
          { head: 'Shown', cell: (row) => row.plays, sort: (row) => row.plays, align: 'right' },
          { head: 'Called right', cell: (row) => pct(row.solved, row.plays), sort: (row) => row.solved / row.plays, align: 'right' },
        ]}
        rows={players.filter((row) => has(row.name))}
      />
      <div className="field-label">Pairs</div>
      <DataTable
        columns={[
          { head: 'Category', cell: (pair) => categoryLabel(pair.category), sort: (pair) => pair.category },
          { head: 'Shown', cell: (pair) => pair.shown, sort: (pair) => pair.shown },
          { head: 'Hidden', cell: (pair) => pair.hidden, sort: (pair) => pair.hidden },
          { head: 'Right', cell: (pair) => `${pair.correct}/${pair.seen}`, sort: (pair) => pair.correct / pair.seen, align: 'right' },
        ]}
        rows={pairs.filter((pair) => has(pair.shown, pair.hidden))}
      />
    </div>
  );
}
