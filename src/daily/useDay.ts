import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dayKey, isDayKey, msUntilNextDay, puzzleDay, puzzleNumber } from './day';
import type { DailyGame } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The archive: an earlier day's puzzle, from `?puzzle=N` on a daily game's
 * page (the user, 8 Oct 2026: play previous days, but only ones not played
 * before in this browser — a played one shows its result, never a new round).
 * Only a day from #1 to yesterday; anything else is today's. N counts from the
 * game's own first day (`DAILY_FROM`).
 */
export const PUZZLE_PARAM = 'puzzle';

/** The day a daily game's page is on: today's, or an earlier one from the archive. */
export function usePuzzleDay(game?: DailyGame): { day: string; today: string; past: boolean } {
  const today = useToday();
  const [params] = useSearchParams();
  const asked = Number(params.get(PUZZLE_PARAM));
  const past = Number.isInteger(asked) && asked >= 1 && asked < puzzleNumber(today, game);
  return { day: past ? puzzleDay(asked, game) : today, today, past };
}

/**
 * The address of puzzle #`number` of a game, or of today's without one. A dev
 * server's pretend day (`?day=`) comes along, so the archive of a pretend day
 * stays on it.
 */
export function puzzleHref(slug: string, number?: number): string {
  const params = new URLSearchParams();
  const pretend = devDay();
  if (pretend) params.set('day', pretend);
  if (number !== undefined) params.set(PUZZLE_PARAM, String(number));
  const query = params.toString();
  return `/game/${slug}${query ? `?${query}` : ''}`;
}

/**
 * A day to pretend it is, from `?day=YYYY-MM-DD` — dev builds only, for
 * checking tomorrow's puzzles or a streak across a week without waiting.
 */
function devDay(): string | null {
  if (!import.meta.env?.DEV || typeof window === 'undefined') return null;
  const asked = new URLSearchParams(window.location.search).get('day');
  return isDayKey(asked) ? asked : null;
}

/** Today, kept current: the component re-renders when the day turns over. */
export function useToday(): string {
  const [today, setToday] = useState(() => devDay() ?? dayKey());
  useEffect(() => {
    if (devDay()) return;
    // A little past midnight, so the new day has definitely begun.
    const id = window.setTimeout(() => setToday(dayKey()), msUntilNextDay() + 500);
    return () => window.clearTimeout(id);
  }, [today]);
  return today;
}

/** "05:12:33" until the next puzzle, ticking once a second. */
export function useCountdown(): string {
  const [left, setLeft] = useState(() => msUntilNextDay());
  useEffect(() => {
    const id = window.setInterval(() => setLeft(msUntilNextDay()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const total = Math.max(0, Math.floor(left / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}
