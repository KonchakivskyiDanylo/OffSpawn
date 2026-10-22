/**
 * Contextinho's closest players to a secret, with each one's score and what
 * made it: for tuning the similarity by eye (the user, 22 Oct 2026: "give me a
 * few popular players with their top 10 and I will tell you whether it's
 * fine. Better with scores").
 *
 *   npx tsx scripts/contextinho-report.ts MrSavage Mongraal vic0
 *   npx tsx scripts/contextinho-report.ts --top 20 Kiryache32
 *   npx tsx scripts/contextinho-report.ts --set teammates=5.5,age=1 MrSavage
 *
 * "Why" is the score split into the parts that made it, in points: a score of
 * 41 might be "Played together 16, Results together 9, Country 6, …". With
 * `--set`, the weights named change and a Δ column says how far each player
 * moved against the defaults (▲ up, ▼ down, "new" from outside the list). The
 * same with sliders for every weight is `/analytics/contextinho` on a dev server.
 */
import { loadFacts } from '@/data/liquipedia/facts';
import { loadMajors } from '@/data/liquipedia/majors';
import { loadOrgs } from '@/data/liquipedia/orgs';
import { loadRoster } from '@/data/liquipedia/roster';
import { loadTeammates } from '@/data/liquipedia/teammates';
import { ATTRIBUTES, DEFAULT_WEIGHTS, pointsOf, rankAll, type AttributeId, type Weights } from '@/games/contextinho/engine';

const args = process.argv.slice(2);
let top = 10;
const weights: Weights = { ...DEFAULT_WEIGHTS };
let changed = false;
const names: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--top') top = Number(args[++i]) || top;
  else if (args[i] === '--set') {
    for (const pair of (args[++i] ?? '').split(',')) {
      const [id, value] = pair.split('=');
      if (!(id in weights) || Number.isNaN(Number(value))) {
        console.error(`Not a weight: ${pair}. The weights: ${Object.keys(weights).join(', ')}`);
        process.exit(1);
      }
      weights[id as AttributeId] = Number(value);
      changed = true;
    }
  } else names.push(args[i]);
}
if (names.length === 0) {
  console.error('Name a player or more: npx tsx scripts/contextinho-report.ts MrSavage Mongraal');
  process.exit(1);
}

const [roster, teammates, orgs, facts, majors] = await Promise.all([
  loadRoster(),
  loadTeammates(),
  loadOrgs(),
  loadFacts(),
  loadMajors(),
]);
const context = { teammates, orgs, facts, majors };
const label = new Map(ATTRIBUTES.map((a) => [a.id, a.label]));

for (const name of names) {
  const key = name.toLowerCase();
  const secret = roster.players.find((p) => p.id.toLowerCase() === key || p.name.toLowerCase() === key);
  if (!secret) {
    console.log(`\n## ${name}: not on the roster`);
    continue;
  }
  const ranking = rankAll(secret, roster.players, weights, context);
  const before = changed ? rankAll(secret, roster.players, DEFAULT_WEIGHTS, context) : null;
  const rows = [...ranking.values()].sort((a, b) => a.rank - b.rank).slice(1, top + 1);
  console.log(`\n## ${secret.name} (${secret.countryName ?? '?'})\n`);
  console.log(`| # |${before ? ' Δ |' : ''} Player | Country | Score | Why |`);
  console.log(`| --- |${before ? ' --- |' : ''} --- | --- | --- | --- |`);
  for (const row of rows) {
    const points = pointsOf(row, weights);
    const why = (Object.keys(points) as AttributeId[])
      .map((id) => ({ id, points: points[id] }))
      .filter((part) => part.points >= 0.5)
      .sort((a, b) => b.points - a.points)
      .slice(0, 4)
      .map((part) => `${label.get(part.id)} ${Math.round(part.points)}`)
      .join(', ');
    const was = before?.get(row.player.id)?.rank;
    const moved = was === undefined ? '' : was > top + 1 ? ' new |' : was === row.rank ? ' · |' : was > row.rank ? ` ▲${was - row.rank} |` : ` ▼${row.rank - was} |`;
    console.log(`| ${row.rank} |${moved} ${row.player.name} | ${row.player.countryName ?? '?'} | ${row.score} | ${why} |`);
  }
}
