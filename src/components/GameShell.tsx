import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { puzzleLabel, shortDate } from '@/daily/day';
import { isLiveDaily, type DailyGame } from '@/daily/types';
import { puzzleHref, usePuzzleDay } from '@/daily/useDay';
import { DEV_TOGGLE } from '@/daily/useDailyRound';
import { readLocal, writeLocal } from '@/lib/storage';
import { rulesFor, type GameMeta } from '@/games/registry';
import './daily.css';
import { Glossary } from './Glossary';
import { RosterNote } from './LiquipediaGate';
import { PastPuzzlesButton } from './PastPuzzles';
import { SocialsNote } from './SocialsNote';
import { Modal } from './ui';

/**
 * Page frame shared by all ten games: title bar, "How to play" (shown
 * automatically on a first visit), the game itself, and the rules underneath.
 */
export function GameShell({
  game,
  toolbar,
  dataNote,
  examples,
  daily: dailyProp,
  children,
}: {
  game: GameMeta;
  /**
   * The game's daily state: on with today's number, or off (practice, on a dev
   * server only). Absent for a game with no daily puzzle, and ignored for one
   * whose daily is not served now (`LIVE_DAILY`), so it
   * gets no chip and no toggle either.
   */
  daily?: { on: boolean; number: number; setOn: (on: boolean) => void };
  /** Optional controls rendered on the right of the title row (e.g. New game). */
  toolbar?: ReactNode;
  /**
   * Where this game's numbers come from. Games reading the shared dataset can
   * leave it out; Higher or Lower runs on its own roster and says so itself.
   */
  dataNote?: ReactNode;
  /**
   * Worked examples shown between the goal and the bullets. Some rules are far
   * easier to show than to write: Fortnitedle's three tile colours are three
   * sentences as prose, and three tiles as a picture.
   */
  examples?: ReactNode;
  children: ReactNode;
}) {
  const daily = isLiveDaily(game.id) ? dailyProp : undefined;
  const puzzle = usePuzzleDay(isLiveDaily(game.id) ? game.id : undefined);
  const seenKey = `seen-rules:${game.id}`;
  const [showRules, setShowRules] = useState(() => !readLocal(seenKey, false));

  const dismiss = () => {
    writeLocal(seenKey, true);
    setShowRules(false);
  };

  return (
    // `page--game`, not the full 1120px: a game is a board, an input and a
    // paragraph of rules, and all three read worse the wider they get. The
    // boards cap themselves and were left floating in white space; the rules
    // ran to 140-character lines. The home page keeps the wide column, because
    // a grid of ten cards is the one thing here that wants it.
    <div className="page page--game stack-lg">
      <div className="stack">
        <Link to="/" className="small muted" style={{ width: 'fit-content' }}>
          ← All games
        </Link>
        <div className="row-between">
          <div>
            <h1>
              <span aria-hidden="true" style={{ marginRight: 10 }}>
                {game.icon}
              </span>
              {game.title}{' '}
              {daily ? (
                <span className={`daily-chip${daily.on ? '' : ' daily-chip--practice'}`}>
                  {daily.on ? `Daily ${puzzleLabel(daily.number)}` : 'Practice'}
                </span>
              ) : null}
            </h1>
            <p className="muted small" style={{ marginTop: 4 }}>
              {game.tagline}
            </p>
          </div>
          <div className="row">
            {daily?.on ? <PastPuzzlesButton games={[game.id as DailyGame]} label="📅 Earlier" /> : null}
            {daily && DEV_TOGGLE ? (
              <button
                type="button"
                className="icon-btn"
                title="Dev servers only: the live site is daily puzzles only"
                onClick={() => daily.setOn(!daily.on)}
              >
                {daily.on ? '🛠 Practice' : '📅 Daily'}
              </button>
            ) : null}
            {toolbar}
            <button type="button" className="icon-btn" onClick={() => setShowRules(true)}>
              ? How to play
            </button>
          </div>
        </div>
        {daily?.on && puzzle.past ? (
          <p className="daily-past-note">
            {/* Just the day (the user, 14 Oct 2026: "Just write puzzles from . Today's puzzle, no of this played late"). */}
            📅 The puzzle from {shortDate(puzzle.day)} · <Link to={puzzleHref(game.slug)}>Today’s puzzle →</Link>
          </p>
        ) : null}
      </div>

      {children}

      <RulesCard game={game} daily={daily?.on ?? false} dataNote={dataNote} examples={examples} />

      <Modal open={showRules} title={`How to play ${game.title}`} onClose={dismiss}>
        <Rules game={game} daily={daily?.on ?? false} dataNote={dataNote} examples={examples} />
        <button type="button" className="btn btn--primary btn--block" onClick={dismiss}>
          Got it
        </button>
      </Modal>
    </div>
  );
}

function RulesList({ rules }: { rules: string[] }) {
  return (
    <ul className="stack-sm list-reset small">
      {rules.map((rule) => (
        <li key={rule} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', gap: 8 }}>
          <span aria-hidden="true" style={{ color: 'var(--primary)', lineHeight: 1.55 }}>
            ▸
          </span>
          <span>{rule}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A game's rules, in the order they read best: the plain-English goal first,
 * then the bullets, then where the numbers came from, then the named groups
 * (categories, modes) that only make sense once you know the goal.
 */
function Rules({
  game,
  daily,
  dataNote,
  examples,
}: {
  game: GameMeta;
  daily: boolean;
  dataNote?: ReactNode;
  examples?: ReactNode;
}) {
  const { intro, rules, sections } = rulesFor(game, daily);
  return (
    <div className="stack">
      {intro.length ? (
        <div className="stack-sm">
          {intro.map((line) => (
            <p key={line} className="small muted">
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {examples}

      {rules.length ? <RulesList rules={rules} /> : null}

      {dataNote ?? <RosterNote />}
      {game.socials ? <SocialsNote /> : null}

      {sections.map((section) => (
        <div key={section.title} className="stack-sm">
          <h3>{section.title}</h3>
          <RulesList rules={section.items} />
        </div>
      ))}

      {game.terms?.length ? (
        <div className="stack-sm">
          <h3>What the words mean</h3>
          <Glossary terms={game.terms} />
        </div>
      ) : null}
    </div>
  );
}

export function RulesCard({
  game,
  daily = false,
  dataNote,
  examples,
}: {
  game: GameMeta;
  daily?: boolean;
  dataNote?: ReactNode;
  examples?: ReactNode;
}) {
  return (
    <section className="card stack">
      <div className="card__title">How to play</div>
      <Rules game={game} daily={daily} dataNote={dataNote} examples={examples} />
    </section>
  );
}
