/**
 * Name handling for every game that takes a typed player name.
 *
 * Players type fast, on phones, and from memory — so matching is deliberately
 * forgiving in three separate ways, each of which fixes a real failure:
 *
 *   case / spacing / accents   `th0mas hd` finds Th0masHD
 *   alternate handles          `Shark` finds shxrk, who used to be Shark
 *   digits that read as letters `king` finds K1nG
 *   one or two typos           `shxrk` finds Shark, `peterbo` finds Peterbot
 *
 * The last one is bounded: a typo is only accepted when exactly one player is
 * that close, so a vague stub never silently resolves to the wrong person.
 */

import { moneyShort } from '@/lib/format';

/**
 * Cyrillic and Greek letters that look exactly like Latin ones.
 *
 * Three handles in the roster are spelled with them — `Drobbаn` carries a
 * Cyrillic а (U+0430), `Crystаal` two, `Dуfs` a Cyrillic у. Without this they
 * are silently *deleted* by the A-Z0-9 filter below, so Drobban becomes the
 * six-tile word DROBBN: a Fortnitedle puzzle nobody can type their way out of,
 * and a name no search will ever find. Folding them to their Latin twins fixes
 * both, and covers any future ones the source picks up.
 */
const HOMOGLYPHS: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C',
  Т: 'T', У: 'Y', Х: 'X', І: 'I', Ј: 'J', Ѕ: 'S', Α: 'A', Β: 'B', Ε: 'E',
  Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T',
  Υ: 'Y', Χ: 'X',
};

/** "Th0mas HD!" -> "TH0MASHD" */
export function normalizeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^\x00-\x7F]/g, (char) => HOMOGLYPHS[char] ?? char)
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Digits folded to the letters they stand in for, and the reverse.
 *
 * 342 of the 5,678 handles carry a digit, and almost all of them are a letter
 * wearing a hat: K1nG, Th0masHD, T3enyy, 5aald. Nobody types the digit when
 * they are searching from memory, so both sides of a comparison get folded to
 * one form — `1` and `L` both become `I`, so K1nG, KING and KLNG agree.
 *
 * Only used for *finding* a player. Fortnitedle still scores the real
 * characters, because there the digit is the puzzle.
 */
const LEET: Record<string, string> = { '0': 'O', '1': 'I', L: 'I', '3': 'E', '4': 'A', '5': 'S', '7': 'T' };

export function foldLeet(key: string): string {
  return key.replace(/[013457L]/g, (char) => LEET[char] ?? char);
}

/**
 * The minimum a row needs to be found by name.
 *
 * Structural rather than any one row type, because the roster and the derived
 * leaderboards are different shapes and both are searched.
 */
export interface Nameable {
  id: string;
  name: string;
}

/** A row that also answers to former or alternate spellings. */
export interface Searchable extends Nameable {
  /** `alternateid_list` — e.g. `Shark` for the player now called shxrk. */
  aliases?: readonly string[];
}

/** Every spelling a row answers to, normalised. Name first. */
function keysOf(player: Searchable): string[] {
  const keys = [normalizeName(player.name)];
  for (const alias of player.aliases ?? []) {
    const key = normalizeName(alias);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys.filter(Boolean);
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > max) return max + 1;
    prev = curr;
  }
  return prev[b.length];
}

/**
 * How many typos to forgive at a given length.
 *
 * Short handles get none: at four characters a single edit reaches dozens of
 * other players, and "Ark" resolving to "Ace" is worse than not resolving.
 */
function tolerance(length: number): number {
  if (length < 5) return 0;
  if (length < 8) return 1;
  return 2;
}

/**
 * Resolves typed text to a player, or null when nothing is close enough.
 *
 * Tried in order, most confident first: an exact spelling, then the same
 * spelling with digits folded, then a bounded typo. The typo pass only returns
 * a result when a *single* player is that close.
 */
export function matchPlayer<T extends Searchable>(input: string, players: readonly T[]): T | null {
  const needle = normalizeName(input);
  if (needle.length < 2) return null;

  const exact = players.filter((player) => keysOf(player).includes(needle));
  if (exact.length > 0) return exact[0];

  const folded = foldLeet(needle);
  const leet = players.filter((player) => keysOf(player).some((key) => foldLeet(key) === folded));
  if (leet.length > 0) return leet[0];

  const max = tolerance(needle.length);
  if (max === 0) return null;
  const near = players.filter((player) =>
    keysOf(player).some((key) => levenshtein(foldLeet(key), folded, max) <= max),
  );
  return near.length === 1 ? near[0] : null;
}

/**
 * Autocomplete suggestions, best match first.
 *
 * Four bands, in descending confidence: the name starts with what you typed,
 * an alias does, the name contains it, or it is within a typo of it. Two
 * characters is enough to start — `en` already narrows to a handful, which is
 * the point of suggesting at all.
 */
export function suggestPlayers<T extends Searchable>(
  input: string,
  players: readonly T[],
  limit = 8,
): T[] {
  const needle = normalizeName(input);
  if (!needle) return [];
  const folded = foldLeet(needle);
  const max = tolerance(needle.length);

  const bands: T[][] = [[], [], [], []];
  for (const player of players) {
    const keys = keysOf(player).map(foldLeet);
    const [name, ...aliases] = keys;
    if (name.startsWith(folded)) bands[0].push(player);
    else if (aliases.some((key) => key.startsWith(folded))) bands[1].push(player);
    else if (keys.some((key) => key.includes(folded))) bands[2].push(player);
    else if (max > 0 && keys.some((key) => levenshtein(key, folded, max) <= max)) bands[3].push(player);
  }

  // Inside a band, the shortest name is the closest thing to what was typed:
  // "ace" should offer Ace before Acorn before AceOfSpades.
  const byName = (a: T, b: T) =>
    a.name.length - b.name.length || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1);
  return bands.flatMap((band) => band.sort(byName)).slice(0, limit);
}

/**
 * The parenthetical Liquipedia uses to tell two identical handles apart.
 *
 * `Aqua_(Japanese_player)` -> "Japanese player"; `Aqua` -> null. Shown in the
 * suggestion list *only* for a handle that more than one player answers to —
 * 121 of 5,678 — because everywhere else it is page bookkeeping that gives
 * away a player's nationality for free.
 */
export function disambiguator(id: string): string | null {
  const match = /\(([^)]+)\)\s*$/.exec(id.replace(/_/g, ' '));
  return match ? match[1] : null;
}

/**
 * Normalised handles that more than one row in this pool shares.
 *
 * Built per pool rather than globally: whether "Aqua" is ambiguous depends on
 * who is actually in the list you are searching.
 */
export function ambiguousNames(players: readonly Nameable[]): Set<string> {
  const seen = new Map<string, number>();
  for (const player of players) {
    const key = normalizeName(player.name);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [key, count] of seen) if (count > 1) out.add(key);
  return out;
}

/** A player as `namedPlayer` tells them apart. */
export interface Namesake {
  id: string;
  name: string;
  countryName?: string | null;
  earnings?: number;
}

/** Normalised handle -> every player answering to it, for the handles two or more share. */
export function namesakesOf<T extends Namesake>(players: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const player of players) {
    const key = normalizeName(player.name);
    out.set(key, [...(out.get(key) ?? []), player]);
  }
  for (const [key, group] of out) if (group.length < 2) out.delete(key);
  return out;
}

/**
 * A handle as a rule names it: "Chap", or "Chap (Poland)" when another player
 * answers to it too. Three players are called Chap, and "10+ events with Chap"
 * did not say which (the user, 14 Oct 2026: "it should be specified which
 * exactly"). When a namesake is from the same country as well — Cooper and
 * Deyy each have one in the United States — the career earnings follow:
 * "Cooper (United States, $1.2M)", which picks out the famous one at a
 * glance. Level on that too, the Liquipedia page name.
 */
export function namedPlayer(player: Namesake, namesakes: ReadonlyMap<string, readonly Namesake[]>): string {
  const others = (namesakes.get(normalizeName(player.name)) ?? []).filter((other) => other.id !== player.id);
  if (others.length === 0) return player.name;
  const country = player.countryName ?? null;
  if (country && others.every((other) => other.countryName !== country)) return `${player.name} (${country})`;
  if (player.earnings !== undefined && others.every((other) => other.earnings !== player.earnings)) {
    return `${player.name} (${country ? `${country}, ` : ''}${moneyShort(player.earnings)})`;
  }
  return `${player.name} (${player.id.replace(/_/g, ' ')})`;
}

/** Deterministic avatar colour from a player id. */
export function avatarColors(id: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return [`hsl(${hue} 62% 46%)`, `hsl(${(hue + 42) % 360} 64% 36%)`];
}

/** Up to two initials for the avatar fallback. */
export function initials(name: string): string {
  const clean = name.replace(/[^A-Za-z0-9 ]/g, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return clean.slice(0, 2).toUpperCase() || '??';
}
