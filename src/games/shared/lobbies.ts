import type { Majors, MajorTournament } from '@/data/liquipedia/majors';

/**
 * The majors as rounds and regions — "FNCS 2023 - Major 2: Europe - Grand
 * Finals" is round "Major 2" of 2023, region Europe — for the games that ask
 * you to pick one: Which Lobby? and Rewind.
 *
 * Read off the names, which have been spelled five different ways since 2019
 * ("FNCS: Season X - Grand Finals: Asia", "C2S1: FNCS - Grand Finals: Asia",
 * "FNCS: 2021 Grand Royale - Asia", "FNCS 2025 - Major 3: NA West - Grand
 * Finals"). A LAN has no region: its round is the whole event.
 */

export interface Lobby {
  /** The tournament's full name — the id. */
  name: string;
  date: string;
  year: number;
  /** The round as the name spells it, the key the regions group under. */
  round: string;
  /** The round said short, for a picker that already shows the year: "Major 2", "C2S4", "Global Championship". */
  label: string;
  /** The region (or the World Cup's Solo / Duos); null for a LAN with only one lobby. */
  variant: string | null;
  mode: string | null;
  prizePool: number | null;
  /** How many places the results go down to. Not printed in a round: a field's size can name the event. */
  size: number;
}

const REGION = /^(Asia|Brazil|Europe|Middle East|North America East|North America West|North America|NA East|NA West|NA Central|Oceania)$/;

/** The FNCS called the same places three ways; one spelling each. */
const SAME_PLACE: Record<string, string> = {
  'North America East': 'NA East',
  'North America West': 'NA West',
};

export function parseLobby(raw: string): { round: string; variant: string | null } {
  const name = raw.replace(/\s+/g, ' ').trim();
  const split = (round: string, variant: string) => ({ round: round.trim(), variant: SAME_PLACE[variant.trim()] ?? variant.trim() });
  let match = /^(.*?) - Grand Finals: (.+)$/.exec(name);
  if (match) return split(match[1], match[2]);
  match = /^(.*?): (.+?) - Grand Finals$/.exec(name);
  if (match) return split(match[1], match[2]);
  match = /^(.*?) - (Duos|Solo|Trios|Squads)$/.exec(name);
  if (match) return split(match[1], match[2]);
  match = /^(.*) - (.+)$/.exec(name);
  if (match && REGION.test(match[2])) return split(match[1], match[2]);
  return { round: name, variant: null };
}

/** "FNCS 2023 - Major 1" -> "Major 1", "FNCS: Chapter 2 Season 2" -> "C2S2", "C2S1: FNCS" -> "C2S1". */
export function roundLabel(round: string): string {
  const label = round
    .replace(/Chapter (\d+) Season (\d+)/i, 'C$1S$2')
    .replace(/\b(FNCS|Fortnite)\b:?/g, ' ')
    .replace(/\b20\d\d\b/g, ' ')
    .replace(/\s+-\s+|:/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return label || round;
}

/** Every major with results on record, oldest first. */
export function lobbiesOf(majors: Majors): Lobby[] {
  return majors.tournaments
    .map((tournament: MajorTournament): Lobby => {
      const { round, variant } = parseLobby(tournament.name);
      const field = majors.fieldOf(tournament.name);
      return {
        name: tournament.name,
        date: tournament.date,
        year: tournament.year,
        round,
        label: roundLabel(round),
        variant,
        mode: tournament.mode,
        prizePool: tournament.prizePool,
        size: field.length ? field[field.length - 1].placement : 0,
      };
    })
    .filter((lobby) => lobby.size > 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name < b.name ? -1 : 1));
}

/** A lobby's name for a chip: "Major 2 · Europe", "Global Championship". */
export function lobbyTitle(lobby: Lobby): string {
  return lobby.variant ? `${lobby.label} · ${lobby.variant}` : lobby.label;
}
