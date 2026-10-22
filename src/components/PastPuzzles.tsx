import { useState } from 'react';
import { Link } from 'react-router-dom';
import { puzzleDay, puzzleLabel, puzzleNumber, shortDate } from '@/daily/day';
import { logKey, savedDays, type DailyLog } from '@/daily/progress';
import type { DailyGame } from '@/daily/types';
import { puzzleHref, usePuzzleDay } from '@/daily/useDay';
import { getGame } from '@/games/registry';
import { useLocalState } from '@/lib/storage';
import './daily.css';
import { Modal } from './ui';

/**
 * The archive: every daily puzzle before today, to play once each.
 *
 * The user, 8 Oct 2026: "add a possibility to play previous days games, only
 * if [from this browser] nobody played before". A day finished here shows its
 * result and opens to its board, never a new round; one begun and left carries
 * on where it was. Caught up late, a day counts as played but not towards a
 * streak (`gameStats`).
 */

/** A game's puzzle numbers before today's, newest first. */
export function pastNumbers(today: string, game: DailyGame): number[] {
  const out: number[] = [];
  for (let number = puzzleNumber(today, game) - 1; number >= 1; number--) out.push(number);
  return out;
}

const won = (outcome: string) => outcome === 'won' || outcome === 'cleared';

/** One game's earlier puzzles, newest first: Play, Continue, or the result. */
function PastList({ game, onPick }: { game: DailyGame; onPick?: () => void }) {
  const meta = getGame(game)!;
  const { day: current, today } = usePuzzleDay(game);
  const [log] = useLocalState<DailyLog>(logKey(game), {});
  const begun = savedDays(game);
  return (
    <div className="past-list">
      {pastNumbers(today, game).map((number) => {
        const day = puzzleDay(number, game);
        const done = log[day];
        return (
          <Link
            key={number}
            to={puzzleHref(meta.slug, number)}
            onClick={onPick}
            className={`past-row${day === current ? ' past-row--current' : ''}`}
          >
            <span>
              <strong>{puzzleLabel(number)}</strong>
              <span className="past-row__date">{shortDate(day)}</span>
            </span>
            {done ? (
              <span className={`past-row__state past-row__state--${won(done.outcome) ? 'won' : 'lost'}`}>
                {won(done.outcome) ? '✓ ' : ''}
                {done.score}
              </span>
            ) : (
              <span className="past-row__state">{begun.has(day) ? 'Continue' : 'Play'}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

/** A button opening the archive of one or more daily games; nothing before puzzle #2. */
export function PastPuzzlesButton({
  games,
  label = '📅 Earlier puzzles',
  className = 'icon-btn',
}: {
  games: readonly DailyGame[];
  label?: string;
  className?: string;
}) {
  const { today } = usePuzzleDay();
  const [open, setOpen] = useState(false);
  if (games.every((game) => pastNumbers(today, game).length === 0)) return null;
  const close = () => setOpen(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Modal open={open} title="Earlier puzzles" onClose={close}>
        <p className="small muted" style={{ margin: 0 }}>
          Missed a day? Each puzzle can be played once.
        </p>
        {games.map((game) => {
          const meta = getGame(game)!;
          return (
            <div key={game} className="stack-sm">
              {games.length > 1 ? (
                <h3>
                  <span aria-hidden="true">{meta.icon}</span> {meta.title}
                </h3>
              ) : null}
              <PastList game={game} onPick={close} />
            </div>
          );
        })}
      </Modal>
    </>
  );
}

/**
 * The end of a puzzle's way on to the ones missed: up to four not yet played,
 * newest first, and the whole archive behind a button.
 */
export function MissedPuzzles({ game }: { game: DailyGame }) {
  const meta = getGame(game)!;
  const { day: current, today } = usePuzzleDay(game);
  const [log] = useLocalState<DailyLog>(logKey(game), {});
  const all = pastNumbers(today, game);
  const missed = all.filter((number) => {
    const day = puzzleDay(number, game);
    return day !== current && !log[day];
  });
  if (missed.length === 0) return null;
  const SHOWN = 4;
  return (
    <div className="stack-sm">
      <div className="tiny faint center">Missed a day? Earlier puzzles</div>
      <div className="daily-more">
        {missed.slice(0, SHOWN).map((number) => (
          <Link key={number} to={puzzleHref(meta.slug, number)} className="daily-more__item">
            {puzzleLabel(number)} <span className="past-row__date">{shortDate(puzzleDay(number, game))}</span>
          </Link>
        ))}
        {missed.length > SHOWN ? (
          <PastPuzzlesButton games={[game]} label={`All ${all.length} →`} className="daily-more__item" />
        ) : null}
      </div>
    </div>
  );
}
