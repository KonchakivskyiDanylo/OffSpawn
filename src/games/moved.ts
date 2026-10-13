/**
 * Games that changed address: the old slug and the new one.
 *
 * A renamed game keeps its id and takes a new slug (`GameMeta.id`), and its old
 * slug is always that id. Old addresses are out there — every shared daily
 * result ends in one — so the server answers them with a 301 to the new one
 * (`server/index.ts`), and the app does the same where there is no server.
 * Kept here, apart from the registry, so the server reads it without loading
 * the games. `check:games` holds it to the registry.
 */
export const MOVED_SLUGS: Readonly<Record<string, string>> = {
  wordle: 'fortnitedle',
  impostor: 'griefer',
  // Tenaball, renamed Tenite on 13 Oct 2026.
  tenaball: 'tenite',
};

/** `/game/tenaball?puzzle=3` -> `/game/tenite?puzzle=3`, or null when the address has not moved. */
export function movedPath(pathname: string, search = ''): string | null {
  const match = /^\/game\/([^/]+)\/?$/.exec(pathname);
  const to = match ? MOVED_SLUGS[match[1]] : undefined;
  return to ? `/game/${to}${search}` : null;
}
