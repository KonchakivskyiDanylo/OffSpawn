/**
 * The analytics server, end to end.
 *
 * Run with: npm run check:server
 *
 * Starts `server/index.ts` on a spare port with a throwaway file store and a
 * known admin password, then plays the part of the site and of its owner:
 * sends rounds, support requests and errors, checks the bad ones are turned
 * away, logs in, and reads everything back through the admin routes. Nothing
 * touches a real database or `server/.data`.
 */
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RECORD_VERSION, type RoundRecord } from '@/analytics/types';
import { dayKey } from '@/daily/day';
import type { DailySet } from '@/daily/types';

const problems: string[] = [];
const check = (ok: boolean, message: string) => {
  if (!ok) problems.push(message);
};

const PORT = 3100 + Math.floor(Math.random() * 800);
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'check-server-password';
const HOOK = 'check-hook-secret';
const dir = await mkdtemp(path.join(tmpdir(), 'offspawn-check-'));

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, ADMIN_PASSWORD: PASSWORD, LIQUIPEDIA_WEBHOOK_SECRET: HOOK, DATABASE_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
server.stdout.on('data', (chunk) => (output += chunk));
server.stderr.on('data', (chunk) => (output += chunk));

async function request(route: string, init: RequestInit = {}, cookie = '') {
  const res = await fetch(`${BASE}${route}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, setCookie: res.headers.get('set-cookie') ?? '' };
}
const post = (route: string, body: unknown, cookie = '') =>
  request(route, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }, cookie);

try {
  // Wait for it to listen.
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(`${BASE}/api/admin/me`);
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  const round: RoundRecord<'wordle'> = {
    v: RECORD_VERSION,
    game: 'wordle',
    app: 'check',
    data: 'check',
    setup: { pick: 'random' },
    outcome: 'won',
    r: { secret: { id: 'Bugha', name: 'Bugha' }, guesses: 3 },
  };

  // ---- the public side
  check((await post('/api/rounds', round)).status === 204, 'a valid round was not accepted');
  check((await post('/api/rounds', { ...round, game: 'chess' })).status === 400, 'a round for no game was accepted');
  check((await post('/api/rounds', 'not json')).status === 400, 'a non-JSON round was accepted');
  const huge = { ...round, r: { ...round.r, padding: 'x'.repeat(70_000) } };
  check((await post('/api/rounds', huge)).status === 413, 'an oversized round was accepted');

  const ticket = { kind: 'wrong-data', message: 'FHD has the wrong title count', contact: 'me@example.com', context: { page: '/game/career-path', round } };
  // The funnel: a visit landing on the home page, Fortnitedle's daily opened and
  // its first move, Tenaball opened and two rounds dealt there.
  const hits = [
    { step: 'open', page: 'home', entry: true },
    { step: 'open', page: 'wordle', daily: true },
    { step: 'start', page: 'wordle', daily: true, first: true },
    { step: 'open', page: 'tenaball', daily: false },
    { step: 'start', page: 'tenaball', daily: false, first: true },
    { step: 'start', page: 'tenaball', daily: false, first: false },
  ];
  for (const hit of hits) check((await post('/api/funnel', hit)).status === 204, `a funnel hit was refused: ${JSON.stringify(hit)}`);
  check((await post('/api/funnel', { step: 'open', page: 'chess' })).status === 400, 'a funnel hit for no page was accepted');
  check((await post('/api/funnel', { step: 'start', page: 'home' })).status === 400, 'a round start on the home page was accepted');
  check((await post('/api/funnel', { step: 'click', page: 'wordle' })).status === 400, 'a funnel step that does not exist was accepted');
  check((await post('/api/funnel', { step: 'open', page: 'wordle', daily: 'yes' })).status === 400, 'a funnel hit with a non-boolean flag was accepted');

  check((await post('/api/support', ticket)).status === 204, 'a valid support request was not accepted');
  check((await post('/api/support', { ...ticket, website: 'http://spam' })).status === 204, 'the honeypot did not answer like a success');
  check((await post('/api/support', { ...ticket, message: '   ' })).status === 400, 'an empty support message was accepted');
  check((await post('/api/errors', { message: 'boom', page: '/', app: 'check' })).status === 204, 'an error report was not accepted');

  // ---- the daily puzzles: made on the first request, the same on every one after.
  const today = dayKey();
  const first = await request(`/api/daily/${today}`);
  const set = first.body as DailySet;
  check(first.status === 200 && set?.day === today && typeof set.puzzles === 'object', `the daily puzzles did not come (${first.status})`);
  check(Object.keys(set?.puzzles ?? {}).length > 0, 'the daily set has no puzzles in it');
  const again = await request(`/api/daily/${today}`);
  check(JSON.stringify(again.body) === JSON.stringify(set), 'asking for the same day twice gave two different sets');
  check((await request('/api/daily/2026-02-30')).status === 400, 'a day that does not exist was answered');
  check((await request('/api/daily/today')).status === 400, 'a non-day was answered');

  // ---- LiquipediaDB's webhook: the secret is the path, and only the Fortnite
  // wiki's main namespace is kept (a move out of it counts).
  const ping = { page: 'Peterbot', namespace: 0, wiki: 'fortnite', event: 'edit' };
  check((await post('/api/liquipedia/wrong', ping)).status === 404, 'the webhook answered a wrong secret');
  check((await post(`/api/liquipedia/${HOOK}`, ping)).status === 204, 'the webhook refused a page edit');
  check((await post(`/api/liquipedia/${HOOK}`, { ...ping, wiki: 'dota2' })).status === 204, 'another wiki was not quietly dropped');
  check((await post(`/api/liquipedia/${HOOK}`, { ...ping, namespace: 2 })).status === 204, 'a user page was not quietly dropped');
  const moved = { from_page: 'Old Name', page: 'User:Someone/Old Name', from_namespace: 0, namespace: 2, wiki: 'fortnite', event: 'move' };
  check((await post(`/api/liquipedia/${HOOK}`, moved)).status === 204, 'a move out of the main namespace was refused');
  check((await post(`/api/liquipedia/${HOOK}`, { ...ping, event: 'explode' })).status === 400, 'a nonsense event was accepted');

  // ---- the admin side
  check((await request('/api/admin/me')).status === 401, 'the dashboard answered without a login');
  check((await request('/api/admin/dashboard')).status === 401, 'the dashboard data answered without a login');
  check((await post('/api/admin/login', { password: 'wrong' })).status === 401, 'a wrong password logged in');
  const login = await post('/api/admin/login', { password: PASSWORD });
  check(login.status === 204, `the right password did not log in (${login.status})`);
  check(/HttpOnly/i.test(login.setCookie) && /SameSite=Strict/i.test(login.setCookie), 'the admin cookie is not HttpOnly + SameSite');
  const cookie = login.setCookie.split(';')[0];
  check((await request('/api/admin/me', {}, cookie)).status === 204, 'the admin cookie was not accepted');
  check((await request('/api/admin/me', {}, `${cookie}0`)).status === 401, 'a tampered admin cookie was accepted');

  const dash = await request('/api/admin/dashboard?days=7', {}, cookie);
  const data = dash.body as {
    rounds: number;
    wordle: { name: string; solved: number }[];
    traffic: {
      totals: Record<string, number>;
      landing: { label: string; count: number }[];
      games: { game: string; daily: { opens: number }; unlimited: { opens: number; starts: number } }[];
      hours: number[][];
    };
  };
  check(dash.status === 200 && data.rounds === 1, `the dashboard counts ${data?.rounds} rounds, expected 1`);

  // The funnel read back: totals, the landing page, the halves, the hours.
  const t = data.traffic?.totals ?? {};
  check(
    t.visits === 1 && t.opens === 2 && t.starts === 3 && t.engaged === 2 && t.finished === 1 && t.tracked === 1 && t.won === 1,
    `the funnel totals read ${JSON.stringify(t)}`,
  );
  check(data.traffic?.landing[0]?.label === 'home', 'the visit did not land on the home page');
  const tenaball = data.traffic?.games.find((g) => g.game === 'tenaball');
  check(tenaball?.unlimited.opens === 1 && tenaball.unlimited.starts === 2 && tenaball.daily.opens === 0, `Tenite's halves read ${JSON.stringify(tenaball)}`);

  // A renamed game's old address — every shared Tenaball result ends in one — is a 301 to the new one.
  for (const [from, to] of [
    ['/game/tenaball?puzzle=3', '/game/tenite?puzzle=3'],
    ['/game/tenaball/', '/game/tenite'],
    ['/game/wordle', '/game/fortnitedle'],
    ['/game/tic-tac-toe', '/game/box-fight'],
    ['/game/who-are-ya', '/game/ready-up'],
    ['/game/connections', '/game/squads'],
  ]) {
    const moved = await fetch(`${BASE}${from}`, { redirect: 'manual' });
    check(moved.status === 301 && moved.headers.get('location') === to, `${from} answered ${moved.status} → ${moved.headers.get('location')}, expected 301 → ${to}`);
  }
  const current = await fetch(`${BASE}/game/tenite`, { redirect: 'manual' });
  check(current.status !== 301, '/game/tenite redirects, but it is the current address');

  // One address for the site: www. and http:// pages go to https://offspawn.app, as
  // Heroku hands them over (Host, x-forwarded-proto). API calls and other hosts pass.
  const asHeroku = (route: string, host: string, proto: string, method = 'GET') =>
    new Promise<{ status: number; location: string | null }>((resolve, reject) => {
      const req = httpRequest(
        { host: 'localhost', port: PORT, path: route, method, headers: { host, 'x-forwarded-proto': proto } },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? null });
        },
      );
      req.on('error', reject);
      req.end();
    });
  for (const [route, host, proto, to] of [
    ['/', 'www.offspawn.app', 'https', 'https://offspawn.app/'],
    ['/game/box-fight', 'www.offspawn.app', 'http', 'https://offspawn.app/game/box-fight'],
    ['/credits', 'offspawn.app', 'http', 'https://offspawn.app/credits'],
    ['/game/tenaball?puzzle=3', 'www.offspawn.app', 'http', 'https://offspawn.app/game/tenite?puzzle=3'],
  ] as const) {
    const got = await asHeroku(route, host, proto);
    check(got.status === 301 && got.location === to, `${proto}://${host}${route} answered ${got.status} → ${got.location}, expected 301 → ${to}`);
  }
  for (const [route, host, proto, method] of [
    ['/game/box-fight', 'offspawn.app', 'https', 'GET'],
    ['/api/daily/2026-10-05', 'www.offspawn.app', 'http', 'GET'],
    ['/api/support', 'www.offspawn.app', 'https', 'POST'],
    ['/game/box-fight', 'offspawn-1234.herokuapp.com', 'https', 'GET'],
  ] as const) {
    const got = await asHeroku(route, host, proto, method);
    check(got.status !== 301, `${method} ${proto}://${host}${route} was redirected to ${got.location}`);
  }
  check(data.traffic?.hours.flat().reduce((a, b) => a + b, 0) === 3, 'the hours do not hold the three page opens');
  const daily = (await request('/api/admin/dashboard?days=7&source=daily', {}, cookie)).body as typeof data;
  check(daily?.traffic?.totals.opens === 1 && daily.traffic.totals.starts === 1, `the daily filter reads ${JSON.stringify(daily?.traffic?.totals)}`);

  // The daily schedule editor: made ahead, two days swapped, a past day refused.
  check((await request('/api/admin/daily?days=7')).status === 401, 'the schedule answered without a login');
  const plan = (await request('/api/admin/daily?days=7', {}, cookie)).body as {
    firstEditable: string;
    rows: { day: string; editable: boolean; puzzles: Record<string, { label: string }> }[];
  };
  const editable = plan?.rows?.filter((row) => row.editable) ?? [];
  check(editable.length === 7, `the schedule has ${editable.length} days ahead, expected 7`);
  if (editable.length >= 2) {
    const [a, b] = editable;
    const swap = await post('/api/admin/daily/swap', { game: 'tenaball', a: a.day, b: b.day }, cookie);
    check(swap.status === 204, `a swap was refused (${swap.status})`);
    const after = (await request('/api/admin/daily?days=7', {}, cookie)).body as typeof plan;
    const [a2, b2] = after.rows.filter((row) => row.editable);
    check(
      a2.puzzles.tenaball.label === b.puzzles.tenaball.label && b2.puzzles.tenaball.label === a.puzzles.tenaball.label,
      'the swap did not swap the two days',
    );
    check(
      (await post('/api/admin/daily/redraw', { game: 'tenaball', day: '2020-01-01' }, cookie)).status === 400,
      'a day long past was redrawn',
    );
  }
  check(data.wordle?.[0]?.name === 'Bugha' && data.wordle[0].solved === 1, 'the dashboard lost the Fortnitedle round');

  // Filters ride on the same query string, and one that matches nothing is an
  // empty dashboard, not an error. Nonsense values are ignored.
  const random = (await request('/api/admin/dashboard?days=7&source=random&game=wordle', {}, cookie)).body as { rounds: number };
  check(random?.rounds === 1, `the Random filter counts ${random?.rounds} rounds, expected 1`);
  const event = (await request('/api/admin/dashboard?days=7&source=event', {}, cookie)).body as { rounds: number };
  check(event?.rounds === 0, `the event filter counts ${event?.rounds} rounds, expected 0`);
  const junk = await request('/api/admin/dashboard?days=abc&source=nope&game=chess', {}, cookie);
  check(junk.status === 200 && (junk.body as { rounds: number }).rounds === 1, 'a junk filter was not ignored');

  // The player index and one player's page.
  const players = (await request('/api/admin/players?days=7', {}, cookie)).body as { id: string; rounds: number }[];
  check(players?.[0]?.id === 'Bugha' && players[0].rounds === 1, `the player index reads ${JSON.stringify(players)}`);
  const lens = (await request('/api/admin/players/Bugha?days=7', {}, cookie)).body as {
    rounds: number;
    rows: { game: string; role: string; good: number }[];
  };
  check(
    lens?.rounds === 1 && lens.rows[0]?.role === 'secret' && lens.rows[0].good === 1,
    `Bugha's player page reads ${JSON.stringify(lens)}`,
  );
  check((await request('/api/admin/players?days=7')).status === 401, 'the player index answered without a login');

  const inbox = await request('/api/admin/support', {}, cookie);
  const tickets = inbox.body as { id: number; status: string; body: { message: string } }[];
  check(tickets.length === 1, `the inbox holds ${tickets.length} requests — the honeypot one should be gone`);
  check((await post(`/api/admin/support/${tickets[0]?.id}`, { status: 'done' }, cookie)).status === 204, 'a request could not be marked done');
  const after = (await request('/api/admin/support', {}, cookie)).body as { status: string }[];
  check(after[0]?.status === 'done', 'marking a request done did not stick');

  const errors = (await request('/api/admin/errors', {}, cookie)).body as unknown[];
  check(errors.length === 1, `the error list holds ${errors.length}, expected 1`);

  // The updater reads the pings after its own cursor.
  check((await request('/api/admin/liquipedia')).status === 401, 'the webhook pings answered without a login');
  const pings = (await request('/api/admin/liquipedia?after=0', {}, cookie)).body as { id: number; body: { event: string } }[];
  check(
    pings?.length === 2 && pings[0].body.event === 'edit' && pings[1].body.event === 'move',
    `the webhook kept ${JSON.stringify(pings)}, expected the edit and the move`,
  );
  const later = (await request(`/api/admin/liquipedia?after=${pings?.[0]?.id}`, {}, cookie)).body as unknown[];
  check(later?.length === 1, `the cursor did not skip what was already read (${later?.length})`);

  // /analytics/data: the data's dates and the pings since the export (both of today's).
  check((await request('/api/admin/data')).status === 401, 'the data status answered without a login');
  const status = (await request('/api/admin/data', {}, cookie)).body as {
    dates: { date: string | null }[];
    webhook: boolean;
    changes: { total: number; pages: number };
  };
  check(
    Boolean(status?.dates?.[0]?.date) && status.webhook && status.changes.total === 2,
    `the data status reads ${JSON.stringify(status)}`,
  );

  // ---- limits: the support form is capped at five per ten minutes per client
  let limited = false;
  for (let i = 0; i < 6 && !limited; i++) limited = (await post('/api/support', ticket)).status === 429;
  check(limited, 'the support form was never rate-limited');

  const logout = await post('/api/admin/logout', {}, cookie);
  check(/Max-Age=0/.test(logout.setCookie), 'logging out did not clear the cookie');

  // ---- the site itself, when it has been built: the page, gzipped or brotli
  const page = await fetch(`${BASE}/`, { headers: { 'accept-encoding': 'gzip' } });
  if (page.status !== 404) {
    const html = await page.text();
    check(page.status === 200 && html.includes('<div id="root">'), 'the page did not come back');
    check(page.headers.get('content-encoding') === 'gzip', 'the page was not gzipped');
    // The app's script, which the build compresses ahead (the page is too small to).
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    check(Boolean(script), 'the page names no script');
    if (script) {
      const plain = await (await fetch(`${BASE}${script}`, { headers: { 'accept-encoding': 'identity' } })).text();
      const br = await fetch(`${BASE}${script}`, { headers: { 'accept-encoding': 'gzip, deflate, br' } });
      check(br.headers.get('content-encoding') === 'br', 'a browser taking brotli did not get it');
      check((await br.text()) === plain, 'the brotli script decodes to something else');
      const gz = await fetch(`${BASE}${script}`, { headers: { 'accept-encoding': 'gzip' } });
      check(gz.headers.get('content-encoding') === 'gzip', 'a browser taking only gzip did not get it');
      check((await gz.text()) === plain, 'the gzipped script decodes to something else');
    }
  }
  // ---- ADMIN_OPEN is for a laptop: in production it must do nothing
  const port = PORT + 1;
  const prod = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, ADMIN_OPEN: '1', NODE_ENV: 'production', ADMIN_PASSWORD: '', DATABASE_URL: '' },
    stdio: 'ignore',
  });
  try {
    let status = 0;
    for (let i = 0; i < 100 && !status; i++) {
      status = await fetch(`http://localhost:${port}/api/admin/dashboard`).then(
        (res) => res.status,
        () => new Promise<number>((resolve) => setTimeout(() => resolve(0), 150)),
      );
    }
    check(status === 503, `ADMIN_OPEN opened the dashboard in production (status ${status})`);
  } finally {
    prod.kill();
  }
} catch (error) {
  problems.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  server.kill();
  await rm(dir, { recursive: true, force: true });
}

if (problems.length) {
  console.log(`\n=== ${problems.length} PROBLEM(S) ===`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log('\nserver output:\n' + output);
  process.exit(1);
}
console.log(`server: ${output.trim()}`);
console.log('✓ server checks passed');
