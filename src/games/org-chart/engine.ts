import type { ClueRoundPayload, Outcome } from '@/analytics/types';
import type { Bios, Stint } from '@/data/liquipedia/bios';
import type { Org, Orgs } from '@/data/liquipedia/orgs';
import type { Roster, RosterPlayer } from '@/data/liquipedia/roster';
import { moneyShort, monthYear } from '@/lib/format';
import { makeRng, sample, shuffle, type Rng } from '@/lib/rng';
import { recordRound, startRound, type ClueRound } from '@/games/shared/clue-round';
import type { Level } from '@/games/shared/levels';

/**
 * Pure logic for Org Chart: name an organisation from the players who played
 * for it, revealed one at a time.
 *
 * Built to the user's roadmap (2 Oct 2026). V1 is the levels and the three
 * clue styles; for V2 ("more clue types, revealed progressively — think about
 * something") the org's own facts are dealt in between the players: its region
 * after the third, the year it was founded after the sixth, its prize money
 * last. The facts only ever narrow a field the players have already pointed at.
 */

/** How much each player clue says. */
export type ClueStyle = 'dates' | 'joined' | 'names';

/** Which orgs can come up: the richest `top` of those with a page and enough players. */
export const LEVELS: Record<Level, { top: number }> = {
  easy: { top: 25 },
  medium: { top: 75 },
  hard: { top: Number.POSITIVE_INFINITY },
};

/** Roster players an org needs to be a round. */
export const MIN_MEMBERS = 5;

/**
 * Player clues in a round, at most; fewer only when the org has fewer on the
 * roster. It was seven (the user, 14 Oct 2026: "maybe more players, like
 * increase it to eight if there is enough").
 */
export const PLAYER_CLUES = 8;

/** The best-known players, by career earnings, held out of the opening. */
export const HELD_BACK = 2;
/** Clues at the top of a round they cannot be in. */
export const OPENING = 3;

/**
 * The org's region comes after this many players, the year it was founded
 * after this many (or after the last, on a smaller org), its prize money last:
 * three, three and two players between them on a full hand of eight.
 */
export const REGION_AFTER = 3;
export const FOUNDED_AFTER = 6;

export type Clue =
  | {
      kind: 'player';
      player: RosterPlayer;
      /** First joined and last left, over every spell at this org; null where unknown. */
      from: string | null;
      to: string | null;
      /** Still there today. */
      current: boolean;
    }
  | { kind: 'fact'; id: 'region' | 'founded' | 'earnings'; label: string; value: string };

export type GameState = ClueRound<Org, Clue> & { style: ClueStyle };

/** Who played for an org, as roster players: from the dated stints when there are some. */
function membersOf(org: Org, bios: Bios | null, byId: ReadonlyMap<string, RosterPlayer>): Map<RosterPlayer, Stint[]> {
  const out = new Map<RosterPlayer, Stint[]>();
  const stints = bios?.membersOf(org.id);
  for (const id of new Set([...org.ever, ...(stints?.keys() ?? [])])) {
    const player = byId.get(id);
    if (player) out.set(player, [...(stints?.get(id) ?? [])]);
  }
  return out;
}

/** The orgs a level can deal, richest first. */
export function orgPool(orgs: Orgs, roster: Roster, level: Level): Org[] {
  const onRoster = new Set(roster.players.map((player) => player.id));
  return orgs.orgs
    .filter((org) => org.hasPage && org.ever.filter((id) => onRoster.has(id)).length >= MIN_MEMBERS)
    .slice(0, LEVELS[level].top);
}

/**
 * The player clues: the two best-known (held back from the opening), three
 * from the next ten by career earnings, and the rest from anyone — so a round
 * moves from players only the org's fans know towards the ones everybody does,
 * without ever being a straight ramp.
 */
function pickPlayers(members: RosterPlayer[], rng: Rng): { famous: RosterPlayer[]; rest: RosterPlayer[] } {
  const byFame = [...members].sort((a, b) => b.earnings - a.earnings);
  const famous = byFame.slice(0, HELD_BACK);
  const near = sample(rng, byFame.slice(HELD_BACK, HELD_BACK + 10), 3);
  const others = sample(
    rng,
    byFame.slice(HELD_BACK).filter((player) => !near.includes(player)),
    PLAYER_CLUES - famous.length - near.length,
  );
  return { famous, rest: [...near, ...others] };
}

/** Random order, with the famous ones only after the opening. */
function order(famous: RosterPlayer[], rest: RosterPlayer[], rng: Rng): RosterPlayer[] {
  const out = shuffle(rng, rest);
  for (const player of shuffle(rng, famous)) {
    const from = Math.min(OPENING, out.length);
    const at = from + Math.floor(rng() * (out.length - from + 1));
    out.splice(at, 0, player);
  }
  return out;
}

export function createGame(
  org: Org,
  roster: Roster,
  bios: Bios | null,
  style: ClueStyle,
  seed: string = String(Date.now()),
): GameState {
  const rng = makeRng(seed);
  const byId = new Map(roster.players.map((player) => [player.id, player]));
  const members = membersOf(org, bios, byId);
  const { famous, rest } = pickPlayers([...members.keys()], rng);
  const current = new Set(org.current);

  const players: Clue[] = order(famous, rest, rng).map((player) => {
    const spells = members.get(player) ?? [];
    const froms = spells.map((stint) => stint.from).filter((day): day is string => Boolean(day)).sort();
    const open = spells.some((stint) => stint.to === null);
    const tos = spells.map((stint) => stint.to).filter((day): day is string => Boolean(day)).sort();
    return {
      kind: 'player',
      player,
      from: froms[0] ?? null,
      to: open ? null : (tos[tos.length - 1] ?? null),
      current: current.has(player.id),
    };
  });

  const facts: (Clue | null)[] = [
    org.region ? { kind: 'fact', id: 'region', label: 'Region', value: org.region } : null,
    org.founded ? { kind: 'fact', id: 'founded', label: 'Founded', value: org.founded.slice(0, 4) } : null,
    org.earnings > 0 ? { kind: 'fact', id: 'earnings', label: 'Prize money', value: moneyShort(org.earnings) } : null,
  ];
  // Region after the third player, founded after the sixth (or the last), prize money last.
  const clues: Clue[] = [];
  players.forEach((clue, index) => {
    clues.push(clue);
    if (index === REGION_AFTER - 1 && facts[0]) clues.push(facts[0]);
    if (index === Math.min(FOUNDED_AFTER, players.length) - 1 && facts[1]) clues.push(facts[1]);
  });
  if (facts[2]) clues.push(facts[2]);

  return { ...startRound(org, clues), style: bios?.dated ? style : 'names' };
}

/** What a player clue says beside the name, in a style. */
export function tenure(clue: Extract<Clue, { kind: 'player' }>, style: ClueStyle): string | null {
  if (style === 'names') return null;
  const joined = clue.from ? monthYear(clue.from) : '?';
  if (style === 'joined') return `joined ${joined}`;
  const left = clue.current ? 'now' : clue.to ? monthYear(clue.to) : '?';
  return `${joined} – ${left}`;
}

export function record(state: GameState): { outcome: Outcome; r: ClueRoundPayload } {
  return recordRound(state, (clue) =>
    clue.kind === 'player'
      ? { id: clue.player.id, name: clue.player.name }
      : { id: `fact:${clue.id}`, name: `${clue.label}: ${clue.value}` },
  );
}
