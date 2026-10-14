import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { sendStart, useRoundRecorder } from '@/analytics/client';
import { GameShell } from '@/components/GameShell';
import { GiveUpButton } from '@/components/GiveUpButton';
import { LiquipediaGate, RosterNote } from '@/components/LiquipediaGate';
import { PlayerSearch } from '@/components/PlayerSearch';
import { LevelSetup, type LevelOption } from '@/components/PoolSetup';
import { DailyEnd, DailyPending } from '@/components/DailyEnd';
import { Banner, Hearts, Stat } from '@/components/ui';
import { useDailyRound, usePlayMode } from '@/daily/useDailyRound';
import { restoreDaily, result as dailyResult, shareGrid, snapshot } from './daily';
import type { Facts } from '@/data/liquipedia/facts';
import type { Orgs } from '@/data/liquipedia/orgs';
import type { Pools } from '@/data/liquipedia/pools';
import type { Roster, RosterPlayer } from '@/data/liquipedia/roster';
import { useFacts } from '@/data/liquipedia/useFacts';
import { useOrgs } from '@/data/liquipedia/useOrgs';
import { usePools } from '@/data/liquipedia/usePools';
import { useRoster } from '@/data/liquipedia/useRoster';
import { useEventMode } from '@/games/shared/mode';
import { poolPlayers } from '@/games/shared/pool';
import { useLocalState } from '@/lib/storage';
import { getGame } from '@/games/registry';
import {
  BANDS,
  boardFrom,
  cellKey,
  createGame,
  generateBoard,
  giveUp,
  LEVELS,
  livesLeft,
  place,
  readGridSpec,
  SIZE,
  solutionFor,
  submit,
  type Cell,
  type Difficulty,
  type GameState,
  record as roundRecord,
} from './engine';
import './tic-tac-toe.css';
import { useSocials } from '@/data/useSocials';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import type { CriterionKind } from '@/games/shared/criteria';

const meta = getGame('tic-tac-toe')!;

/**
 * The three levels, each one board shape plus one ruleset.
 *
 * The answers-per-cell count is read from `LEVELS` so the card cannot promise
 * something the generator does not enforce.
 */
const DIFFICULTIES: LevelOption<Difficulty>[] = [
  {
    id: 'easy',
    label: '🟢 Easy',
    hint: `${LEVELS.easy.answers} famous answers in every cell. ${LEVELS.easy.lives} lives.`,
  },
  {
    id: 'medium',
    label: '🟡 Medium',
    hint: `${LEVELS.medium.answers} regulars in every cell. ${LEVELS.medium.lives} lives.`,
  },
  {
    id: 'hard',
    label: '🔴 Hard',
    hint: 'A cell may have just one answer. 1 life.',
  },
];

/** Three boards' worth of rules are kept out of the next board. */
const RECENT_RULES = 3 * 2 * SIZE;


export default function TicTacToeGame() {
  const { roster, error: rosterError } = useRoster();
  const { facts, error: factsError } = useFacts();
  const { orgs, error: orgsError } = useOrgs();
  const { pools } = usePools();

  return (
    <LiquipediaGate
      error={rosterError ?? factsError ?? orgsError}
      ready={Boolean(roster && facts && orgs)}
    >
      {roster && facts && orgs ? (
        <Game roster={roster} facts={facts} orgs={orgs} pools={pools} />
      ) : null}
    </LiquipediaGate>
  );
}

function Game({
  roster,
  facts,
  orgs,
  pools,
}: {
  roster: Roster;
  facts: Facts;
  orgs: Orgs;
  pools: Pools | null;
}) {
  const [event] = useEventMode();
  /** Follower counts: a daily grid may have a follower rule, so it waits for them. */
  const socials = useSocials();
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const byId = useMemo(() => new Map(roster.players.map((player) => [player.id, player])), [roster]);
  const [dailyOn, setDailyOn] = usePlayMode('tic-tac-toe');
  const daily = useDailyRound('tic-tac-toe', {
    on: dailyOn,
    ready: socials !== null,
    restore: (puzzle, saved) => restoreDaily(puzzle, roster, facts, orgs, socials, byId, saved),
    snapshot,
    finished: (state) => state.status !== 'playing',
    result: dailyResult,
  });
  const [practice, setPractice] = useState<GameState | null>(null);
  const game = dailyOn ? daily.state : practice;
  const setGame = (next: GameState) => (dailyOn ? daily.setState(next) : setPractice(next));

  useRoundRecorder('tic-tac-toe', dailyOn ? daily.endedHere : game !== null && game.status !== 'playing', () => ({
    title: `${meta.title} — ${game!.difficulty}`,
    data: facts.generated,
    setup: dailyOn ? { daily: daily.day, level: game!.difficulty } : { event, level: game!.difficulty },
    ...roundRecord(game!),
  }));
  const shell = { game: meta, dataNote: <RosterNote />, daily: { on: dailyOn, number: daily.number, setOn: setDailyOn } };
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: string; message: string } | null>(null);
  /** Set when more than one cell would take this player and keep the board winnable. */
  const [choosing, setChoosing] = useState<{ player: RosterPlayer; cells: Cell[] } | null>(null);

  /*
   * Two pools, deliberately different.
   *
   * `accepted` is who the guess box takes: everyone, because a right answer is
   * a right answer whatever the level. `answers` is who the board is built
   * around, and it is the only thing the level narrows. In an event mode both
   * are the field — that is the whole promise of the mode.
   */
  const field = useMemo(() => poolPlayers(roster, pools, event), [roster, pools, event]);
  const accepted = field.length > 0 ? field : roster.players;
  const answers = useMemo(() => {
    // A field is dealt whole — see the same note in Griefer.
    if (field.length > 0) return field;
    const eligible = facts.eligible(3);
    return BANDS[difficulty].flatMap((band) => roster.exactly(band, { eligible }));
  }, [facts, field, roster, difficulty]);

  /** The rules of the last few boards, so the next one asks something else. */
  const [recent, setRecent] = useLocalState<string[]>('tic-tac-toe:recent', []);

  const start = useCallback(() => {
    const board = generateBoard({ facts, orgs, socials }, { answers, accepted }, difficulty, undefined, recent);
    if (!board) {
      setError('Not enough players in this field to build a solvable grid.');
      return;
    }
    setRecent([...board.rows, ...board.cols].map((axis) => axis.id).concat(recent).slice(0, RECENT_RULES));
    setError(null);
    setFeedback(null);
    setChoosing(null);
    sendStart('tic-tac-toe', false);
    setPractice(createGame(board, difficulty));
  }, [answers, accepted, facts, orgs, socials, difficulty, recent, setRecent]);

  /*
   * A grid from the builder (/analytics/grid), on a dev server only: played as
   * practice at the level it was checked at, then the address is cleared so
   * "New board" deals as usual. It waits for the follower counts, which a
   * "100K+ Twitch" rule needs.
   */
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!import.meta.env.DEV || dailyOn) return;
    const spec = readGridSpec(params.get('grid'));
    if (!spec) return;
    const eligible = facts.eligible(3);
    const band = BANDS[spec.level].flatMap((tier) => roster.exactly(tier, { eligible }));
    const board = boardFrom({ facts, orgs, socials }, { answers: band, accepted: roster.players }, spec.rows, spec.cols, spec.level);
    if (!board && socials === null) return;
    setParams({}, { replace: true });
    if (!board) {
      setError('That grid has a rule this level cannot make any more.');
      return;
    }
    setDifficulty(spec.level);
    setError(null);
    setPractice(createGame(board, spec.level));
  }, [params, setParams, dailyOn, facts, orgs, socials, roster]);

  const usedIds = useMemo(
    () => new Set(game ? [...game.filled.values()].map((player) => player.id) : []),
    [game],
  );

  if (!game && dailyOn) {
    return (
      <GameShell {...shell}>
        <DailyPending status={daily.status} error={daily.error} game="tic-tac-toe" played={daily.played} />
      </GameShell>
    );
  }

  if (!game) {
    return (
      <GameShell {...shell}>
        <div className="stack">
          <LevelSetup
            pools={pools}
            event={event}
            levels={DIFFICULTIES}
            value={difficulty}
            onChange={setDifficulty}
            onStart={start}
            startLabel="New board"
          />
          {error ? (
            <Banner tone="danger" title="Cannot start">
              {error}
            </Banner>
          ) : null}
        </div>
      </GameShell>
    );
  }

  const { board } = game;
  const finished = game.status !== 'playing';

  /** Applies whatever `submit`/`place` came back with, and narrates it. */
  const resolve = (result: ReturnType<typeof submit>, player: RosterPlayer) => {
    setGame(result.state);
    switch (result.outcome.kind) {
      case 'placed': {
        const { row, col } = result.outcome.cell;
        setChoosing(null);
        setFeedback({
          tone: 'var(--success)',
          message: `${player.name} → ${board.rows[row].short} × ${board.cols[col].short}.`,
        });
        break;
      }
      case 'choose':
        setChoosing({ player, cells: result.outcome.cells });
        setFeedback({
          tone: 'var(--text-muted)',
          message: `${player.name} fits more than one cell — pick which.`,
        });
        break;
      case 'already-used':
        setFeedback({ tone: 'var(--warning)', message: `${player.name} is already on the board.` });
        break;
      case 'deadlock':
        setFeedback({
          tone: 'var(--warning)',
          message: `${player.name} fits, but using them there would leave another cell impossible.`,
        });
        break;
      default:
        setChoosing(null);
        setFeedback({ tone: 'var(--danger)', message: `${player.name} does not fit any open cell.` });
    }
  };

  return (
    <GameShell
      {...shell}
      toolbar={
        dailyOn ? null : (
          <button type="button" className="icon-btn" onClick={() => setPractice(null)}>
            ↺ New board
          </button>
        )
      }
    >
      <div className="stack">
        <div className="stats">
          <Stat label="Filled" value={`${game.filled.size}/9`} />
          <Stat
            label={LEVELS[game.difficulty].lives === 1 ? 'Life' : 'Lives'}
            value={<Hearts left={livesLeft(game)} total={LEVELS[game.difficulty].lives} />}
          />
        </div>

        <div className="scroll-x">
          <div className="ttt-grid">
            <div className="ttt-corner" aria-hidden="true" />
            {board.cols.map((col) => (
              <div key={col.id} className="ttt-head" title={col.label}>
                <span className="ttt-head__icon" aria-hidden="true">
                  {kindIcon(col.kind)}
                </span>
                {col.short}
              </div>
            ))}

            {board.rows.map((row, rowIndex) => (
              <BoardRow
                key={row.id}
                rowIndex={rowIndex}
                label={row.short}
                title={row.label}
                icon={kindIcon(row.kind)}
                game={game}
                finished={finished}
                choosing={choosing}
                onChoose={(col) => {
                  if (!choosing) return;
                  resolve(place(game, { row: rowIndex, col }, choosing.player), choosing.player);
                }}
              />
            ))}
          </div>
        </div>

        {feedback ? (
          <p className="small center" style={{ color: feedback.tone }}>
            {feedback.message}
          </p>
        ) : null}

        {finished ? (
          <div className="stack">
            <Banner
              tone={game.status === 'won' ? 'success' : 'danger'}
              title={game.status === 'won' ? 'Board complete!' : 'Board lost'}
            >
              {game.status === 'won'
                ? `All nine cells filled in ${game.guesses} guesses.`
                : 'Every empty cell below shows players who would have worked.'}
            </Banner>
            {game.status === 'lost' ? <Reveal game={game} /> : null}
            {dailyOn ? (
              <DailyEnd
                game="tic-tac-toe"
                number={daily.number}
                day={daily.day}
                result={dailyResult(game)}
                grid={shareGrid(game)}
              />
            ) : (
              <button type="button" className="btn btn--primary btn--lg btn--block" onClick={start}>
                New board
              </button>
            )}
          </div>
        ) : (
          <div className="stack-sm">
            {choosing ? (
              <p className="small center muted">
                Tap the cell you want <strong>{choosing.player.name}</strong> in, or{' '}
                <button type="button" className="link-btn" onClick={() => setChoosing(null)}>
                  cancel
                </button>
                .
              </p>
            ) : (
              <PlayerSearch
                players={accepted}
                onPick={(player) => resolve(submit(game, player), player)}
                exclude={usedIds}
                placeholder="Name a player…"
                buttonLabel="Place"
                autoFocus
              />
            )}
            <div className="row" style={{ justifyContent: 'center' }}>
              <GiveUpButton onGiveUp={() => setGame(giveUp(game))} />
            </div>
          </div>
        )}
      </div>
    </GameShell>
  );
}

/** Players who would have worked, per cell left empty. */
function Reveal({ game }: { game: GameState }) {
  const empty: Cell[] = [];
  for (let row = 0; row < SIZE; row++) {
    for (let col = 0; col < SIZE; col++) {
      if (!game.filled.has(cellKey(row, col))) empty.push({ row, col });
    }
  }
  return (
    <section className="card stack-sm">
      <div className="card__title">What would have worked</div>
      {empty.map(({ row, col }) => (
        <p key={cellKey(row, col)} className="small">
          <span className="muted">
            {game.board.rows[row].short} × {game.board.cols[col].short}
          </span>{' '}
          —{' '}
          <span className="bold">
            {solutionFor(game, row, col)
              .map((player) => player.name)
              .join(', ') || 'nobody left'}
          </span>
        </p>
      ))}
    </section>
  );
}

/** What kind of rule a header is, at a glance — the board reads faster when titles look like titles. */
function kindIcon(kind: CriterionKind): string {
  switch (kind) {
    case 'country':
    case 'region':
      return '🌍';
    case 'org':
    case 'org-count':
      return '🏢';
    case 'earnings':
      return '💰';
    case 'age':
      return '🎂';
    case 'played-event':
    case 'world-cup':
      return '🎟️';
    case 'lan-winner':
    case 'lan-podium':
      return '🏟️';
    case 'global-winner':
      return '🌐';
    case 'fncs-with':
    case 'played-with':
    case 'fncs-partners':
      return '🤝';
    case 'socials':
      return '📺';
    default:
      return '🏆';
  }
}

function BoardRow({
  rowIndex,
  label,
  title,
  icon,
  game,
  finished,
  choosing,
  onChoose,
}: {
  rowIndex: number;
  label: string;
  title: string;
  icon: string;
  game: GameState;
  finished: boolean;
  choosing: { player: RosterPlayer; cells: Cell[] } | null;
  onChoose: (col: number) => void;
}) {
  return (
    <>
      <div className="ttt-head ttt-head--row" title={title}>
        <span className="ttt-head__icon" aria-hidden="true">
          {icon}
        </span>
        {label}
      </div>
      {Array.from({ length: SIZE }, (_, col) => {
        const player = game.filled.get(cellKey(rowIndex, col));
        const offered = choosing?.cells.some((cell) => cell.row === rowIndex && cell.col === col);
        const classes = ['ttt-cell'];
        if (player) classes.push('ttt-cell--filled');
        if (offered) classes.push('ttt-cell--offered');
        return (
          <button
            key={col}
            type="button"
            className={classes.join(' ')}
            onClick={() => offered && onChoose(col)}
            disabled={Boolean(player) || finished || !offered}
          >
            {player ? (
              <>
                <PlayerAvatar player={player} size={34} />
                <span className="ttt-cell__name">{player.name}</span>
              </>
            ) : (
              <span className="ttt-cell__plus" aria-hidden="true">
                {offered ? '↓' : finished ? '?' : ''}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
