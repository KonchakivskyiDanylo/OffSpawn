/**
 * A real HTML page for every address a search engine should know, written
 * into `dist/` after `vite build` (`npm run build` runs it):
 *
 *   dist/index.html                  the home page
 *   dist/credits/index.html          credits and licence
 *   dist/privacy/index.html          privacy
 *   dist/game/<slug>/index.html      each game the site shows
 *   dist/sitemap.xml                 all of the above
 *
 * Each is the built app's page with its own title, description, canonical
 * link and share tags (`src/lib/seo.ts`), and the page's words as plain HTML
 * inside `#root`: the game's pitch, how to play and links to the others. The
 * app replaces that on its first render, so a player never sees it for longer
 * than a script takes to load; a crawler gets the text without running any.
 * The server serves these by path (`serveStatic` in server/index.ts).
 *
 * Hidden games get no page and are not in the sitemap: the live site sends
 * their address home.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { SOURCE } from '@/data/liquipedia/roster';
import { dayKey } from '@/daily/day';
import { isDailyOn } from '@/daily/types';
import { rulesFor, VISIBLE_GAMES, type GameMeta } from '@/games/registry';
import { CREDITS_META, gameMeta, HOME_META, metaTags, PRIVACY_META, SITE_URL, type PageMeta } from '@/lib/seo';

const DIST = path.resolve(process.cwd(), 'dist');
const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

const esc = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const list = (items: string[]) => `<ul>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`;
const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;

/** The other games, so every page links to every other. */
function gameLinks(except?: GameMeta): string {
  const games = VISIBLE_GAMES.filter((game) => game !== except);
  return `<ul>${games.map((game) => `<li>${link(`/game/${game.slug}`, game.title)} — ${esc(game.tagline)}</li>`).join('')}</ul>`;
}

function homeBody(): string {
  return [
    '<h1>How well do you actually know competitive Fortnite?</h1>',
    `<p>${esc(HOME_META.description)}</p>`,
    '<h2>The games</h2>',
    gameLinks(),
    `<p>${link('/credits', 'Credits & licence')}</p>`,
  ].join('');
}

function gameBody(game: GameMeta): string {
  // A daily game plays the daily puzzle on the live site, so its rules are the ones to index.
  const { intro, rules, sections } = rulesFor(game, isDailyOn(game.id, dayKey()));
  return [
    `<h1>${esc(game.title)}</h1>`,
    `<p>${esc(game.tagline)}</p>`,
    ...intro.map((paragraph) => `<p>${esc(paragraph)}</p>`),
    ...(rules.length ? ['<h2>How to play</h2>', list(rules)] : []),
    ...sections.flatMap((section) => [`<h2>${esc(section.title)}</h2>`, list(section.items)]),
    '<h2>More competitive Fortnite puzzles</h2>',
    gameLinks(game),
    `<p>${link('/', 'All games')} · ${link('/credits', 'Credits & licence')}</p>`,
  ].join('');
}

function creditsBody(): string {
  return [
    '<h1>Credits &amp; licence</h1>',
    `<p>Every player, team, tournament, result and transfer on OffSpawn comes from the ${link(SOURCE.url, 'Liquipedia Fortnite wiki')}, ` +
      `written by its contributors, through the Liquipedia API, and is used under ${link(SOURCE.licenseUrl, SOURCE.license)}. ` +
      'OffSpawn changed it: ages, difficulty levels, rankings, FNCS title counts and puzzle answers are worked out by the site.</p>',
    `<p>Our data files are shared under the same licence, as they are, without warranty. Follower counts come from YouTube and Twitch and belong to them.</p>`,
    '<p>OffSpawn is unofficial and not connected to Epic Games, Liquipedia or any team. Fortnite is a trademark of Epic Games, Inc.</p>',
    `<p>${link('/', 'All games')}</p>`,
  ].join('');
}

function privacyBody(): string {
  return [
    '<h1>Privacy</h1>',
    '<p>No accounts, no ads, no tracking cookies. Your results and streaks stay in your browser.</p>',
    '<p>When you finish a round, the site counts how it went without knowing who you are: no account, no device id, no cookie, and IP addresses are not saved.</p>',
    `<p>Follower counts come from the YouTube Data API (YouTube API Services) and the Twitch API. Using the parts of OffSpawn that show them means agreeing to the ${link('https://www.youtube.com/t/terms', 'YouTube Terms of Service')}; YouTube data is handled under the ${link('https://policies.google.com/privacy', 'Google Privacy Policy')}.</p>`,
    `<p>${link('/', 'All games')} · ${link('/credits', 'Credits & licence')}</p>`,
  ].join('');
}

/** The built page with this page's head and words. */
function page(shell: string, meta: PageMeta, body: string): string {
  const head = [
    ...(meta.path === null ? [] : [`<link rel="canonical" href="${esc(SITE_URL + meta.path)}" />`]),
    ...metaTags(meta)
      .filter((tag) => tag.key !== 'description')
      .map((tag) => `<meta ${tag.attr}="${tag.key}" content="${esc(tag.content)}" />`),
  ].join('\n    ');
  const out = shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(meta.description)}" />`)
    .replace('</head>', `  ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"><main class="page stack">${body}</main></div>`);
  for (const part of ['<title>', 'name="description"', 'rel="canonical"', '<main class="page stack">']) {
    if (part === 'rel="canonical"' && meta.path === null) continue;
    if (!out.includes(part)) throw new Error(`prerender: ${meta.path} is missing ${part} — has index.html changed shape?`);
  }
  return out;
}

/** The page and its `.br` and `.gz`, as the vite build writes for every file. */
async function write(file: string, html: string): Promise<void> {
  const raw = Buffer.from(html);
  await mkdir(path.dirname(file), { recursive: true });
  const [br, gzipped] = await Promise.all([
    brotli(raw, {
      params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
    }),
    gz(raw, { level: 9 }),
  ]);
  await Promise.all([writeFile(file, raw), writeFile(`${file}.br`, br), writeFile(`${file}.gz`, gzipped)]);
}

const shell = await readFile(path.join(DIST, 'index.html'), 'utf8');
if (!shell.includes('<div id="root"></div>')) {
  throw new Error('prerender: dist/index.html is not a fresh build — run vite build first');
}

const pages: { file: string; meta: PageMeta; body: string; priority: string; changefreq: string }[] = [
  { file: 'index.html', meta: HOME_META, body: homeBody(), priority: '1.0', changefreq: 'daily' },
  ...VISIBLE_GAMES.map((game) => ({
    file: `game/${game.slug}/index.html`,
    meta: gameMeta(game),
    body: gameBody(game),
    priority: '0.8',
    changefreq: 'weekly',
  })),
  { file: 'credits/index.html', meta: CREDITS_META, body: creditsBody(), priority: '0.3', changefreq: 'monthly' },
  { file: 'privacy/index.html', meta: PRIVACY_META, body: privacyBody(), priority: '0.2', changefreq: 'yearly' },
];

for (const { file, meta, body } of pages) {
  await write(path.join(DIST, file), page(shell, meta, body));
}

const today = new Date().toISOString().slice(0, 10);
const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ...pages.map(
    ({ meta, priority, changefreq }) =>
      `  <url>\n    <loc>${SITE_URL}${meta.path}</loc>\n    <lastmod>${today}</lastmod>\n` +
      `    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`,
  ),
  '</urlset>',
  '',
].join('\n');
await writeFile(path.join(DIST, 'sitemap.xml'), sitemap);

console.log(`prerender: ${pages.length} pages and sitemap.xml — ${pages.map((p) => p.meta.path).join(', ')}`);
