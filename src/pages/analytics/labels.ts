import type { Role, Source } from '@/analytics/aggregate';
import type { Outcome } from '@/analytics/types';
import type { Pools } from '@/data/liquipedia/pools';
import { getGame } from '@/games/registry';

/**
 * The words the dashboard shows for the raw values records carry.
 *
 * Records store ids — `chosen`, `globals-2026`, `fncsWins` — so a label can be
 * reworded here without a single stored round going stale.
 */

export const gameTitle = (id: string) => getGame(id)?.title ?? id;

export const SOURCE_LABEL: Record<Source, string> = {
  daily: 'Daily',
  random: 'Random',
  chosen: 'Chosen',
  event: 'Event mode',
  own: 'Own setup',
};

export const SOURCE_HINT: Record<Source, string> = {
  daily: 'the daily puzzle, the same for everyone that day',
  random: 'the shared picker left on Random',
  chosen: 'the picker on Choose: a region and a difficulty',
  event: 'an event field in force, from the home page',
  own: 'Higher or Lower, Box Fight, Tenite and List, which set themselves up',
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  won: 'Won',
  lost: 'Lost',
  'gave-up': 'Gave up',
  cleared: 'Cleared',
};

const CATEGORY_LABEL: Record<string, string> = {
  earnings: 'Career earnings',
  fncsWins: 'FNCS wins',
  fncsFinals: 'FNCS finals',
  age: 'Age',
  twitch: 'Twitch followers',
  youtube: 'YouTube subscribers',
};

/** "all-at-once" -> "All at once", "easy" -> "Easy". */
export function words(value: string): string {
  const spaced = value.replace(/[-_]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function regionLabel(value: string): string {
  return value === 'all' ? 'All regions' : value;
}

export function eventLabel(value: string, pools: Pools | null): string {
  return pools?.get(value)?.label ?? words(value);
}

export function categoryLabel(value: string): string {
  return CATEGORY_LABEL[value] ?? words(value);
}

/** What the player was, as a phrase: "Clix was the secret player". */
export const ROLE_LABEL: Record<Role, string> = {
  secret: 'the secret player',
  guessed: 'a guess',
  mistaken: 'a wrong guess',
  clue: 'a teammate clue',
  answer: 'an answer',
  fits: 'a card that fits',
  griefer: 'a griefer card',
  placed: 'an answer placed',
  tile: 'a tile',
  misgrouped: 'in a wrong four',
  hidden: 'the one to call',
  sorted: 'one of a Pyramid’s ten',
};

/** What "got right" means in each role, where it means anything. */
export const GOOD_LABEL: Partial<Record<Role, string>> = {
  secret: 'solved',
  answer: 'found',
  fits: 'picked',
  griefer: 'left out',
  tile: 'group solved',
  hidden: 'called right',
  sorted: 'placed right',
};

export const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

/** "3 hours ago", "2 days ago" — for the recent-appearances list. */
export function ago(at: string, now = Date.now()): string {
  const minutes = Math.round((now - Date.parse(at)) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
