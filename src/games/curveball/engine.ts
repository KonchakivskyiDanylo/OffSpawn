import type { ClueRoundPayload, Outcome } from '@/analytics/types';
import type { RosterPlayer } from '@/data/liquipedia/roster';
import { moneyShort } from '@/lib/format';
import { recordRound, startRound, type ClueRound } from '@/games/shared/clue-round';

/**
 * Pure logic for Curveball: a player's prize money drawn as a curve, one year
 * at a time, until you name them.
 *
 * Built to the user's roadmap (2 Oct 2026). Its V1 is the reveal loop, V2 the
 * graph, V3 the three pools. The roadmap's second curve, PR, is Fortnite
 * Tracker's power ranking and nowhere in the Liquipedia export; a world rank
 * by prize money stood in for it briefly and was dropped at the user's word —
 * one curve, earnings.
 */

/** Years with prize money a curve needs: two points are a line, not a curve. */
export const MIN_YEARS = 3;

/** Guesses a round always gets, so a three-year curve is not three guesses. */
export const MIN_GUESSES = 5;

export interface Point {
  year: number;
  /** Prize money that calendar year, 0 for a year in the middle with none. */
  earnings: number;
}

/** The years a player earned prize money, oldest first. */
function moneyYears(player: RosterPlayer): number[] {
  return Object.keys(player.earningsByYear)
    .map(Number)
    .filter((year) => player.earningsByYear[year] > 0)
    .sort((a, b) => a - b);
}

/**
 * The curve: every year from the first with prize money to the last, the
 * empty years between included — a gap year is part of the shape.
 */
export function curveOf(player: RosterPlayer): Point[] {
  const years = moneyYears(player);
  if (years.length === 0) return [];
  const out: Point[] = [];
  for (let year = years[0]; year <= years[years.length - 1]; year++) {
    out.push({ year, earnings: player.earningsByYear[year] ?? 0 });
  }
  return out;
}

/** Players with a curve worth drawing. */
export function eligible(players: readonly RosterPlayer[]): RosterPlayer[] {
  return players.filter((player) => moneyYears(player).length >= MIN_YEARS);
}

export type GameState = ClueRound<RosterPlayer, Point>;

export function createGame(secret: RosterPlayer): GameState {
  return startRound(secret, curveOf(secret), MIN_GUESSES);
}

/**
 * The y axis, the same for every curve, since an axis fitted to the curve
 * would give away how high it goes before it got there.
 *
 * A cube-root scale up to $1M, and the World Cup money above it squeezed into
 * a band at the top. It was a log scale from $100 to $5M, on which a year of
 * $600K stood 4 pixels above one of $500K on a 236-pixel plot (the user,
 * 14 Oct 2026: "500k and 600k are completely similar"); here they are 11
 * apart. A square root would part them further but press the small earners
 * onto the floor — Hard's typical curve peaks near $6K — while a cube root
 * still lifts a $1K year a tenth of the way up. Only 11 years on record pass
 * $1M (10 of them the 2019 World Cup), so the band gives them a tenth of the
 * height rather than the two-fifths an unbroken scale to $5M would.
 */
export const AXIS = {
  /** Where the cube root ends and the band begins. */
  knee: 1_000_000,
  /** The top: above the richest year on record, Bugha's $3.08M in 2019. */
  max: 5_000_000,
  /** The share of the height the band above the knee takes. */
  band: 0.1,
  ticks: [1_000, 10_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000],
} as const;

/** How far up the axis an amount sits, 0 (the floor, no prize money) to 1. */
export function heightOf(value: number): number {
  if (value <= 0) return 0;
  const below = 1 - AXIS.band;
  if (value <= AXIS.knee) return below * Math.cbrt(value / AXIS.knee);
  return Math.min(1, below + (AXIS.band * Math.log(value / AXIS.knee)) / Math.log(AXIS.max / AXIS.knee));
}

/**
 * Prize money from the first year to the newest one showing — the career so
 * far, which a curve is hard to add up by eye (the user, 3 Oct 2026: "from
 * the beginning until the year is currently shown").
 */
export function totalSoFar(points: readonly Point[], shown: number): number {
  return points.slice(0, shown).reduce((sum, point) => sum + point.earnings, 0);
}

/** One point as the curve labels it. */
export function pointLabel(point: Point): string {
  return point.earnings > 0 ? moneyShort(point.earnings) : '$0';
}

export function record(state: GameState): { outcome: Outcome; r: ClueRoundPayload } {
  return recordRound(state, (point) => ({ id: String(point.year), name: `${point.year} — ${pointLabel(point)}` }));
}
