import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { aggregate, parseFilter, playerIndex, playerLens, readSince } from '@/analytics/aggregate';
import {
  GAME_IDS,
  MAX_MESSAGE_CHARS,
  MAX_RECORD_BYTES,
  SUPPORT_KINDS,
  SUPPORT_STATUSES,
  type ClientError,
  type RoundRecord,
  type SupportRequest,
} from '@/analytics/types';
import { addDays, DAILY_START, dayKey, isDayKey, puzzleNumber } from '@/daily/day';
import { DAILY_GAMES, unfrozen, unpinned, type DailyGame, type DailySet } from '@/daily/types';
import { Socials } from '@/data/socials';
import { movedPath } from '@/games/moved';
import { SITE_HOST, SITE_URL } from '@/lib/site';
import { dataStatus, startDataUpdate } from './data-status';
import { refreshSocials, scheduleSocials, servedSocials, socialsStatus, startTwitchLogin } from './socials';
import { hourKey, openStore, type PageChange } from './store';

/**
 * The site's server: the built app from `dist/`, and a handful of endpoints.
 *
 *   POST /api/funnel    a page opened or a round started, counted per hour (anyone)
 *   POST /api/rounds    a finished round (anyone)
 *   POST /api/support   a support request (anyone)
 *   POST /api/errors    a browser error (anyone)
 *   GET  /api/daily/<day>
 *                       that day's daily puzzles, made on first request and kept
 *                       (anyone; never a day after today)
 *   GET  /api/socials   YouTube subscribers and Twitch followers, fresh ones only
 *                       (anyone; see socials.ts)
 *   POST /api/liquipedia/<secret>
 *                       LiquipediaDB's webhook: a wiki page changed (Liquipedia)
 *   /api/admin/*        the dashboard behind `/analytics` (you): the dashboard,
 *                       the player index and one player's view, all filtered
 *                       by the same query string; the inbox; the errors; and
 *                       the webhook's pings, for the data updater
 *
 * No framework: seven routes and a static folder do not need one, and one
 * dependency (`pg`) is easier to keep current than twelve.
 *
 * Configuration, all environment variables:
 *   PORT              set by Heroku
 *   DATABASE_URL      set by Heroku's Postgres add-on; without it, files
 *   ADMIN_PASSWORD    the dashboard password — the admin routes are off without it
 *   SESSION_SECRET    optional; signs the admin cookie (defaults to the password)
 *   ADMIN_OPEN=1      local only: the dashboard with no password at all. Ignored
 *                     when NODE_ENV is production, which Heroku always sets.
 *   LIQUIPEDIA_WEBHOOK_SECRET
 *                     the last part of the webhook URL you give Liquipedia; the
 *                     webhook route does not exist without it
 *   YOUTUBE_API_KEY, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
 *                     the follower counts — see socials.ts
 *   DATA_UPDATE_TOKEN, DATA_UPDATE_REPO, DATA_UPDATE_BRANCH
 *                     the Update button on /analytics/data — see data-status.ts
 */

const PORT = Number(process.env.PORT ?? 3000);
const DIST = path.resolve(process.cwd(), 'dist');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const SECRET = process.env.SESSION_SECRET || ADMIN_PASSWORD;
const SECURE = process.env.NODE_ENV === 'production';
const OPEN = process.env.ADMIN_OPEN === '1' && !SECURE;
const COOKIE = 'os_admin';
const WEBHOOK_SECRET = process.env.LIQUIPEDIA_WEBHOOK_SECRET ?? '';
/** The one wiki the data comes from; pings about any other are dropped. */
const WIKI = 'fortnite';
const PAGE_EVENTS = ['edit', 'purge', 'delete', 'move'];
const SESSION_DAYS = 30;

const store = await openStore();

// ------------------------------------------------------------------ limits --

/**
 * A fixed window per client and bucket. The address is only ever a key in
 * this map, for as long as the window lasts — it is never written down.
 */
const windows = new Map<string, { count: number; resets: number }>();

function allowed(req: IncomingMessage, bucket: string, max: number, minutes: number): boolean {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const key = `${bucket}|${forwarded || req.socket.remoteAddress || '?'}`;
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || entry.resets < now) {
    windows.set(key, { count: 1, resets: now + minutes * 60_000 });
    if (windows.size > 10_000) {
      for (const [k, v] of windows) if (v.resets < now) windows.delete(k);
    }
    return true;
  }
  entry.count++;
  return entry.count <= max;
}

// ----------------------------------------------------------------- helpers --

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Not JSON');
  }
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined) {
    res.writeHead(status, headers).end();
    return;
  }
  res
    .writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
    .end(JSON.stringify(body));
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// ------------------------------------------------------------------- admin --

function sign(value: string): string {
  return createHmac('sha256', SECRET).update(value).digest('hex');
}

function sameText(a: string, b: string): boolean {
  // Hash first so the comparison is constant-time whatever the lengths.
  return timingSafeEqual(Buffer.from(sign(a)), Buffer.from(sign(b)));
}

function sessionCookie(): string {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const value = `${expires}.${sign(String(expires))}`;
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86_400}${SECURE ? '; Secure' : ''}`;
}

function isAdmin(req: IncomingMessage): boolean {
  if (OPEN) return true;
  if (!ADMIN_PASSWORD) return false;
  const cookie = String(req.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (!cookie) return false;
  const [expires, mac] = cookie.slice(COOKIE.length + 1).split('.');
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  return sameText(mac, sign(expires));
}

// ------------------------------------------------------------------- daily --

/**
 * A day's puzzles, made once.
 *
 * The first request for a day makes its set and the store keeps it; every
 * later request, and every restart and deploy, reads the kept one. So the
 * puzzle someone shares at nine in the morning is the puzzle someone else
 * opens at eleven at night, whatever was deployed in between.
 *
 * The data and the generator load on first use and stay loaded — a few tens of
 * megabytes, once a day of work. Two requests for a new day at the same
 * moment share one making, and the store's first-write-wins settles the rest.
 */
const making = new Map<string, Promise<DailySet>>();
let dailyModule: Promise<typeof import('@/daily/generate')> | null = null;
let dailyData: Promise<import('@/daily/generate').DailyData> | null = null;

/** Days back a new day looks so as not to repeat a secret player or a board. */
const DAILY_HISTORY = 365;

/**
 * The generator and its data, loaded on first use. The follower counts are the
 * ones the site is serving right now, so a follower rule rebuilds the same in
 * the browser.
 */
async function dailyEnv() {
  dailyModule ??= import('@/daily/generate');
  const generate = await dailyModule;
  dailyData ??= generate.loadDailyData();
  const data = { ...(await dailyData), socials: new Socials(await servedSocials(store)) };
  return { generate, data };
}

async function dailySet(day: string): Promise<DailySet> {
  const kept = await store.daily(day);
  // A day not reached yet stays a descriptor; from its date on, its board is pinned.
  if (kept && (day > dayKey() || !unfrozen(kept))) return kept;
  if (!making.has(day)) {
    const made = (async () => {
      const { generate, data } = await dailyEnv();
      // Both sides: the schedule editor makes days ahead, and a day steers clear of those too.
      const history = await store.dailies(addDays(day, -DAILY_HISTORY));
      const set = kept ?? (await store.addDaily(generate.generateDaily(day, data, history)));
      if (day > dayKey()) return set;
      // Pinned on the data of the first request on or after the day: a data
      // update later changes the boards to come, never this one.
      const frozen = generate.freezeDay(set, data, dayKey());
      if (!frozen) return set;
      await store.setDaily(frozen);
      return frozen;
    })().finally(() => making.delete(day));
    making.set(day, made);
  }
  return making.get(day)!;
}

// ------------------------------------------------------- the daily schedule --

/**
 * The editor on /analytics/daily: the days around today, each game's puzzle by
 * name, and changing one — swapping two days, choosing a board or a player, or
 * a new draw. Only today and the days after it change; a day before is what
 * people played. Edits wait for each other, so two tabs cannot interleave.
 */
let editing: Promise<unknown> = Promise.resolve();
function serially<T>(work: () => Promise<T>): Promise<T> {
  const next = editing.then(work, work);
  editing = next.catch(() => {});
  return next;
}

/** The first day that may still change: today, or the first puzzle while the launch is still ahead. */
const firstEditable = () => (dayKey() < DAILY_START ? DAILY_START : dayKey());

async function schedule(days: number) {
  const from = firstEditable();
  const shownFrom = dayKey() < DAILY_START ? DAILY_START : addDays(dayKey(), -7);
  const last = addDays(from, days - 1);
  // Made in order, so each new day sees the ones before it.
  for (let day = from; day <= last; day = addDays(day, 1)) await dailySet(day);
  const all = await store.dailies(addDays(shownFrom, -60));
  const sets = all.filter((set) => set.day >= shownFrom && set.day <= last);
  const { data } = await dailyEnv();
  const admin = await import('@/daily/admin');
  return {
    today: dayKey(),
    start: DAILY_START,
    firstEditable: from,
    rows: admin
      .rowsFor(sets, all, data)
      .map((row) => ({ ...row, number: puzzleNumber(row.day), editable: row.day >= from })),
  };
}

async function editDay(day: string, change: (set: DailySet, others: DailySet[]) => DailySet | null): Promise<void> {
  if (!isDayKey(day) || day < firstEditable()) throw new HttpError(400, 'That day can no longer change');
  await serially(async () => {
    const set = await dailySet(day);
    const others = (await store.dailies(addDays(day, -DAILY_HISTORY))).filter((other) => other.day !== day);
    const next = change(set, others);
    if (!next) throw new HttpError(422, 'Could not make that puzzle');
    await store.setDaily(next);
  });
}

// ------------------------------------------------------------------ routes --

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'POST /api/rounds') {
    if (!allowed(req, 'rounds', 120, 10)) throw new HttpError(429, 'Slow down');
    const body = await readJson(req, MAX_RECORD_BYTES);
    if (
      !isObject(body) ||
      !GAME_IDS.includes(body.game as never) ||
      typeof body.v !== 'number' ||
      !isObject(body.r) ||
      typeof body.outcome !== 'string'
    ) {
      throw new HttpError(400, 'Not a round');
    }
    await store.addRound(body as unknown as RoundRecord);
    return send(res, 204);
  }

  // A page opened or a round started: one more in this hour's count, nothing else kept.
  if (route === 'POST /api/funnel') {
    if (!allowed(req, 'funnel', 300, 10)) return send(res, 204);
    const body = await readJson(req, 1_024);
    const flag = (value: unknown) => value === undefined || typeof value === 'boolean';
    if (
      !isObject(body) ||
      (body.step !== 'open' && body.step !== 'start') ||
      !(body.page === 'home' || GAME_IDS.includes(body.page as never)) ||
      (body.step === 'start' && body.page === 'home') ||
      !flag(body.daily) ||
      !flag(body.entry) ||
      !flag(body.first)
    ) {
      throw new HttpError(400, 'Not a page open or a round start');
    }
    const key = {
      hour: hourKey(new Date()),
      page: body.page as string,
      mode: body.page === 'home' ? ('' as const) : body.daily ? ('daily' as const) : ('unlimited' as const),
    };
    if (body.step === 'open') {
      await store.addFunnel({ ...key, step: 'open' });
      if (body.entry) await store.addFunnel({ ...key, step: 'entry' });
    } else {
      await store.addFunnel({ ...key, step: 'start' });
      if (body.first) await store.addFunnel({ ...key, step: 'first-start' });
    }
    return send(res, 204);
  }

  if (route === 'POST /api/support') {
    if (!allowed(req, 'support', 5, 10)) throw new HttpError(429, 'Too many messages — try again in a few minutes');
    const body = await readJson(req, MAX_RECORD_BYTES + 8_192);
    // A field no person fills in: bots that fill every input fill this one.
    if (isObject(body) && body.website) return send(res, 204);
    if (
      !isObject(body) ||
      !SUPPORT_KINDS.includes(body.kind as never) ||
      typeof body.message !== 'string' ||
      !body.message.trim() ||
      body.message.length > MAX_MESSAGE_CHARS ||
      (body.contact !== undefined && (typeof body.contact !== 'string' || body.contact.length > 200))
    ) {
      throw new HttpError(400, 'Not a support request');
    }
    const request: SupportRequest = {
      kind: body.kind as SupportRequest['kind'],
      message: body.message.trim(),
      contact: typeof body.contact === 'string' && body.contact.trim() ? body.contact.trim() : undefined,
      context: isObject(body.context) ? (body.context as SupportRequest['context']) : undefined,
    };
    await store.addSupport(request);
    return send(res, 204);
  }

  if (route === 'POST /api/errors') {
    if (!allowed(req, 'errors', 20, 10)) return send(res, 204);
    const body = await readJson(req, 8_192);
    if (!isObject(body) || typeof body.message !== 'string') throw new HttpError(400, 'Not an error');
    await store.addError(body as unknown as ClientError);
    return send(res, 204);
  }

  // ---- the daily puzzles
  // Never a day after today on the live site: tomorrow's puzzle is not out yet.
  // A dev server answers any day, for `?day=` in the browser.
  const daily = /^GET \/api\/daily\/([^/]+)$/.exec(route);
  if (daily) {
    const day = decodeURIComponent(daily[1]);
    if (!isDayKey(day)) throw new HttpError(400, 'Not a day');
    if (SECURE && day > dayKey()) throw new HttpError(404, 'Not out yet');
    // Before the launch the live site plays as it always did: nothing to hand out.
    if (SECURE && day < DAILY_START) throw new HttpError(404, `The daily puzzles start on ${DAILY_START}`);
    if (!allowed(req, 'daily', 120, 10)) throw new HttpError(429, 'Slow down');
    // A minute, not longer: the schedule editor can still change today.
    return send(res, 200, await dailySet(day), { 'cache-control': 'public, max-age=60' });
  }

  // ---- YouTube subscribers and Twitch followers: only fresh ones, see socials.ts.
  if (route === 'GET /api/socials') {
    if (!allowed(req, 'socials', 60, 10)) throw new HttpError(429, 'Slow down');
    return send(res, 200, await servedSocials(store), { 'cache-control': 'public, max-age=900' });
  }

  // ---- LiquipediaDB webhook
  // The secret in the path is the only lock: Liquipedia does not sign its
  // pings. Only the main namespace of this wiki is kept — a move out of it
  // counts, because the old page's rows have to go.
  const hook = /^POST \/api\/liquipedia\/([^/]+)$/.exec(route);
  if (hook) {
    if (!WEBHOOK_SECRET || !sameText(decodeURIComponent(hook[1]), WEBHOOK_SECRET)) {
      throw new HttpError(404, 'No such route');
    }
    const body = await readJson(req, 4_096);
    if (
      !isObject(body) ||
      !PAGE_EVENTS.includes(body.event as string) ||
      typeof body.wiki !== 'string' ||
      typeof body.page !== 'string' ||
      typeof body.namespace !== 'number'
    ) {
      throw new HttpError(400, 'Not a page change');
    }
    const main = body.namespace === 0 || (body.event === 'move' && body.from_namespace === 0);
    if (body.wiki === WIKI && main) {
      const change: PageChange = {
        event: body.event as PageChange['event'],
        wiki: body.wiki,
        page: body.page,
        namespace: body.namespace,
      };
      if (body.event === 'move') {
        change.from_page = String(body.from_page ?? '');
        change.from_namespace = Number(body.from_namespace ?? 0);
      }
      await store.addPageChange(change);
    }
    return send(res, 204);
  }

  // ---- admin
  if (!url.pathname.startsWith('/api/admin/')) throw new HttpError(404, 'No such route');
  if (!ADMIN_PASSWORD && !OPEN) throw new HttpError(503, 'Set ADMIN_PASSWORD on the server to use the dashboard');

  if (route === 'POST /api/admin/login') {
    if (!allowed(req, 'login', 10, 15)) throw new HttpError(429, 'Too many attempts — wait fifteen minutes');
    const body = await readJson(req, 1_024);
    if (!isObject(body) || typeof body.password !== 'string' || !sameText(body.password, ADMIN_PASSWORD)) {
      throw new HttpError(401, 'Wrong password');
    }
    return send(res, 204, undefined, { 'set-cookie': sessionCookie() });
  }
  if (route === 'POST /api/admin/logout') {
    return send(res, 204, undefined, { 'set-cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  }

  if (!isAdmin(req)) throw new HttpError(401, 'Log in first');

  if (route === 'GET /api/admin/me') return send(res, 204);

  // The three read the same query string: `days` for the range (0 or absent
  // is all time) and the dashboard's filters — see `parseFilter`.
  const days = Math.max(0, Math.floor(Number(url.searchParams.get('days')) || 0));
  const scope = { days, filter: parseFilter(url.searchParams) };

  if (route === 'GET /api/admin/dashboard') {
    const since = readSince(days);
    return send(res, 200, aggregate(await store.rounds(since), { ...scope, funnel: await store.funnel(since) }));
  }
  if (route === 'GET /api/admin/players') {
    const since = days > 0 ? new Date(Date.now() - days * 86_400_000) : undefined;
    return send(res, 200, playerIndex(await store.rounds(since), scope));
  }
  const lens = /^GET \/api\/admin\/players\/(.+)$/.exec(route);
  if (lens) {
    const since = days > 0 ? new Date(Date.now() - days * 86_400_000) : undefined;
    return send(res, 200, playerLens(await store.rounds(since), decodeURIComponent(lens[1]), scope));
  }
  // The daily schedule — see `schedule` above.
  if (route === 'GET /api/admin/daily') {
    const days = Math.min(120, Math.max(7, Math.floor(Number(url.searchParams.get('days')) || 30)));
    return send(res, 200, await schedule(days));
  }
  if (route === 'GET /api/admin/daily/options') {
    const game = String(url.searchParams.get('game'));
    if (!DAILY_GAMES.includes(game as DailyGame)) throw new HttpError(400, 'No such game');
    const { data } = await dailyEnv();
    // Every day kept, so a board or a list says where it has already been used.
    const sets = await store.dailies(addDays(dayKey(), -DAILY_HISTORY));
    return send(res, 200, (await import('@/daily/admin')).optionsFor(game as DailyGame, data, sets, firstEditable()));
  }
  const dailyEdit = /^POST \/api\/admin\/daily\/(swap|choose|redraw)$/.exec(route);
  if (dailyEdit) {
    const body = await readJson(req, 2_048);
    if (!isObject(body) || !DAILY_GAMES.includes(body.game as DailyGame)) throw new HttpError(400, 'No such game');
    const game = body.game as DailyGame;
    const admin = await import('@/daily/admin');
    const { data } = await dailyEnv();
    if (dailyEdit[1] === 'swap') {
      const [a, b] = [String(body.a), String(body.b)];
      if (!isDayKey(a) || !isDayKey(b) || a < firstEditable() || b < firstEditable()) {
        throw new HttpError(400, 'Only today and the days after it can change');
      }
      await serially(async () => {
        const [first, second] = [await dailySet(a), await dailySet(b)];
        // Today's board is pinned; moved to another day, it is pinned again there.
        const take = (set: DailySet, from: DailySet): DailySet => ({
          ...set,
          puzzles: { ...set.puzzles, [game]: unpinned(from.puzzles[game]) },
        });
        await store.setDaily(take(first, second));
        await store.setDaily(take(second, first));
      });
      return send(res, 204);
    }
    const day = String(body.day);
    if (dailyEdit[1] === 'redraw') {
      await editDay(day, (set, others) => {
        const puzzle = admin.redraw(game, set, others, data);
        return puzzle ? { ...set, puzzles: { ...set.puzzles, [game]: puzzle } } : null;
      });
      return send(res, 204);
    }
    // Choose. A board already played with the same top 10 is refused; one on a
    // coming day moves here, and that day takes this day's board in its place.
    if (!isDayKey(day) || day < firstEditable()) throw new HttpError(400, 'That day can no longer change');
    await serially(async () => {
      const set = await dailySet(day);
      const others = (await store.dailies(addDays(day, -DAILY_HISTORY))).filter((other) => other.day !== day);
      const { past, coming } = admin.sameElsewhere(game, String(body.id), others, data, firstEditable());
      if (past.length) {
        throw new HttpError(409, `Already played on ${past.join(', ')}, and its answers have not changed since.`);
      }
      const puzzle = admin.puzzleForChoice(game, String(body.id), day, data);
      if (!puzzle) throw new HttpError(422, 'Could not make that puzzle');
      for (const from of coming) {
        const other = others.find((candidate) => candidate.day === from)!;
        await store.setDaily({ ...other, puzzles: { ...other.puzzles, [game]: unpinned(set.puzzles[game]) } });
      }
      await store.setDaily({ ...set, puzzles: { ...set.puzzles, [game]: puzzle } });
    });
    return send(res, 204);
  }

  // The follower counts: how fresh they are, the one-time Twitch login, a refresh now.
  if (route === 'GET /api/admin/socials') return send(res, 200, await socialsStatus(store));
  if (route === 'POST /api/admin/socials/twitch-login') return send(res, 200, await startTwitchLogin(store));
  if (route === 'POST /api/admin/socials/refresh') {
    void refreshSocials(store);
    return send(res, 202, { started: true });
  }
  if (route === 'GET /api/admin/support') return send(res, 200, await store.support());
  if (route === 'GET /api/admin/errors') return send(res, 200, await store.errors(200));
  // How old the Liquipedia data is, and the Update button — see data-status.ts.
  if (route === 'GET /api/admin/data') {
    const { data } = await dailyEnv();
    const { EXPORT_DATE } = await import('@/data/liquipedia/roster');
    return send(
      res,
      200,
      await dataStatus(store, {
        exportDate: EXPORT_DATE,
        files: [
          { label: 'Boards (rankings.json)', date: data.rankings.generated || null },
          { label: 'Facts (facts.json)', date: data.facts.generated || null },
        ],
        webhook: Boolean(WEBHOOK_SECRET),
      }),
    );
  }
  if (route === 'POST /api/admin/data/update') {
    try {
      await startDataUpdate();
    } catch (error) {
      throw new HttpError(502, (error as Error).message);
    }
    return send(res, 202, { started: true });
  }
  // The webhook's pings after `after`, oldest first, for the data updater.
  if (route === 'GET /api/admin/liquipedia') {
    const after = Math.max(0, Math.floor(Number(url.searchParams.get('after')) || 0));
    return send(res, 200, await store.pageChanges(after, 5_000));
  }

  const status = /^POST \/api\/admin\/support\/(\d+)$/.exec(route);
  if (status) {
    const body = await readJson(req, 1_024);
    if (!isObject(body) || !SUPPORT_STATUSES.includes(body.status as never)) throw new HttpError(400, 'Bad status');
    const ok = await store.setSupportStatus(Number(status[1]), body.status as never);
    return send(res, ok ? 204 : 404);
  }

  throw new HttpError(404, 'No such route');
}

// ------------------------------------------------------------------ static --

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', // <-- Add this line
};

/**
 * Compressed text files, kept in memory.
 *
 * Heroku's router does not compress, and the roster alone is over a megabyte
 * of JavaScript — on a phone that is the difference between a game opening and
 * a game loading. The build writes a brotli (`.br`) and a gzip (`.gz`) copy of
 * every text file at the highest settings (`precompress` in vite.config.ts);
 * brotli is about a third smaller. A browser that takes brotli gets the `.br`,
 * any other the `.gz`, and a file the build did not compress is gzipped here
 * on first request. `dist/` never changes while the server runs, so each body
 * is read or made once.
 */
const encoded = new Map<string, Promise<Buffer | null>>();
const gzipAsync = promisify(gzip);
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt']);

function encodedBody(file: string, encoding: 'br' | 'gzip'): Promise<Buffer | null> {
  const key = `${file}:${encoding}`;
  if (!encoded.has(key)) {
    encoded.set(
      key,
      encoding === 'br'
        ? readFile(`${file}.br`).catch(() => null)
        : readFile(`${file}.gz`).catch(() => readFile(file).then((raw) => gzipAsync(raw))),
    );
  }
  return encoded.get(key)!;
}

/**
 * Files from `dist/`, and pages for everything else. The app routes on real
 * paths, and the build writes a page for each one a search engine should know
 * (`scripts/prerender.ts`): `/game/tenite` is `dist/game/tenite/index.html`. A
 * renamed game's old address is a 301 to its new one (`games/moved.ts`): shared
 * daily results carry `/game/tenaball`.
 * Any other path gets the home page for the app to route — the dashboard at
 * `/analytics` with a 200, anything else with a 404, so a mistyped or retired
 * address is never indexed as a copy of the home page. Hashed assets are
 * cached for a year; pages never, so a deploy is picked up on reload.
 */
async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const moved = movedPath(url.pathname, url.search);
  if (moved) {
    res.writeHead(301, { location: moved, 'cache-control': 'public, max-age=86400' }).end();
    return;
  }
  const wanted = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  let file = path.join(DIST, wanted);
  if (!file.startsWith(DIST)) return send(res, 403);
  let status = 200;
  const found = await stat(file).catch(() => null);
  const page = found?.isDirectory() ? await stat(path.join(file, 'index.html')).catch(() => null) : null;
  if (page?.isFile()) {
    file = path.join(file, 'index.html');
  } else if (!found?.isFile()) {
    file = path.join(DIST, 'index.html');
    if (!/^\/analytics(\/|$)/.test(url.pathname)) status = 404;
  }
  if (!(await stat(file).catch(() => null))) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No build yet — run `npm run build`.');
    return;
  }
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  const cache = file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  const headers: Record<string, string> = {
    'content-type': type,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
    vary: 'accept-encoding',
  };
  const accepts = String(req.headers['accept-encoding'] ?? '');
  if (COMPRESSIBLE.has(path.extname(file))) {
    for (const encoding of ['br', 'gzip'] as const) {
      if (!new RegExp(`\\b${encoding}\\b`).test(accepts)) continue;
      const body = await encodedBody(file, encoding);
      if (!body) continue;
      res.writeHead(status, { ...headers, 'content-encoding': encoding, 'content-length': String(body.length) }).end(body);
      return;
    }
  }
  const body = await readFile(file);
  res.writeHead(status, { ...headers, 'content-length': String(body.length) }).end(body);
}

/**
 * Where a page request belongs when it reached the site by another address.
 *
 * The site lives at https://offspawn.app, and every page says so in its
 * canonical link. But it also answered on http:// and on www., and Google
 * crawled all four: Search Console listed `http://www.offspawn.app/` and the
 * rest as "Alternative page with proper canonical tag" (13 Oct 2026). A 301
 * makes it one address. Pages only — an API call is never redirected, since a
 * redirected POST arrives as a GET — and only the site's own two aliases: a
 * local server, the herokuapp.com address and anything else pass through.
 * `http://` is read from Heroku's `x-forwarded-proto`. A moved game's old
 * address goes straight to its new one, in one hop.
 */
function canonicalTarget(req: IncomingMessage, url: URL): string | null {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  if (url.pathname.startsWith('/api/')) return null;
  const host = String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  const www = host === `www.${SITE_HOST}`;
  const insecure = host === SITE_HOST && proto === 'http';
  if (!www && !insecure) return null;
  return SITE_URL + (movedPath(url.pathname, url.search) ?? `${url.pathname}${url.search}`);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  try {
    const canonical = canonicalTarget(req, url);
    if (canonical) {
      res.writeHead(301, { location: canonical, 'cache-control': 'public, max-age=86400' }).end();
      return;
    }
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else await serveStatic(req, res, url);
  } catch (error) {
    if (error instanceof HttpError) return send(res, error.status, { error: error.message });
    console.error(error);
    if (!res.headersSent) send(res, 500, { error: 'Server error' });
  }
}).listen(PORT, () => {
  const dashboard = OPEN ? 'open (ADMIN_OPEN, local only)' : ADMIN_PASSWORD ? 'on' : 'off (no ADMIN_PASSWORD)';
  console.log(`OffSpawn on :${PORT} — ${process.env.DATABASE_URL ? 'Postgres' : 'file store'}, dashboard ${dashboard}`);
  // Today's puzzles made now rather than on the first visitor's request.
  if (SECURE && dayKey() >= DAILY_START) {
    void dailySet(dayKey()).catch((error) => console.error('daily puzzles:', error));
  }
  // The follower counts, kept fresh — nothing happens without the API keys.
  scheduleSocials(store);
});
