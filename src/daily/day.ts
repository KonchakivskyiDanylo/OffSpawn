import { DAILY_FROM, type DailyGame } from './types';

/**
 * Which day it is, for the daily puzzles.
 *
 * Everyone plays the same puzzle on the same day, so "today" cannot be the
 * visitor's own calendar: a player in Brazil and one in Poland would be on
 * different puzzles for five hours of every day. The day turns over at
 * midnight Central European time (the user, 3 Oct 2026: "00:00 CET or
 * something"), and `Europe/Berlin` rather than a fixed UTC+1 so the reset stays
 * at local midnight through summer time as well.
 *
 * A day is named by its date there, "2026-10-05" — the key every daily record
 * hangs off, in the browser and on the server.
 */
export const DAILY_TZ = 'Europe/Berlin';

/**
 * The first day of the dailies: Tenite's puzzle #1. Each game counts its own
 * puzzles from its own first day (`DAILY_FROM`), so the number in a shared
 * result means the same puzzle to everyone who reads it.
 */
export const DAILY_START = '2026-10-05';

const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: DAILY_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** Berlin's wall clock at `at`, as if it were UTC — the difference is the offset. */
function wallClock(at: number): number {
  const got: Record<string, number> = {};
  for (const part of parts.formatToParts(at)) {
    if (part.type !== 'literal') got[part.type] = Number(part.value);
  }
  return Date.UTC(got.year, got.month - 1, got.day, got.hour % 24, got.minute, got.second);
}

const pad = (n: number) => String(n).padStart(2, '0');

function fromUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The daily day at a moment, "YYYY-MM-DD". */
export function dayKey(at: number | Date = Date.now()): string {
  return fromUtc(wallClock(typeof at === 'number' ? at : at.getTime()));
}

export function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(Date.parse(`${value}T00:00:00Z`)) === value;
}

/** `day` moved by `days`, either way. */
export function addDays(day: string, days: number): string {
  return fromUtc(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000);
}

/** Whole days from `from` to `to`; negative when `to` comes first. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * The moment a day starts, in ms since the epoch.
 *
 * Two passes, because the offset to subtract is the one in force at the answer
 * and the first guess can sit on the wrong side of a clock change.
 */
export function startOf(day: string): number {
  const naive = Date.parse(`${day}T00:00:00Z`);
  let at = naive - (wallClock(naive) - naive);
  at = naive - (wallClock(at) - at);
  return at;
}

/** Milliseconds until the next puzzle. */
export function msUntilNextDay(now: number = Date.now()): number {
  return startOf(addDays(dayKey(now), 1)) - now;
}

/**
 * A game's puzzle number for a day: #1 on its first day (`DAILY_FROM`), or on
 * `DAILY_START` without a game. Zero or below before it starts.
 */
export function puzzleNumber(day: string, game?: DailyGame): number {
  return daysBetween(game ? DAILY_FROM[game] : DAILY_START, day) + 1;
}

/** The day of a game's puzzle #`number`. */
export function puzzleDay(number: number, game?: DailyGame): string {
  return addDays(game ? DAILY_FROM[game] : DAILY_START, number - 1);
}

/** "Tue 6 Oct" — a day as the archive names it. */
export function shortDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** "#12", or "preview" for a day before the first puzzle (a dev server, or a site up before the launch). */
export function puzzleLabel(number: number): string {
  return number >= 1 ? `#${number}` : 'preview';
}
