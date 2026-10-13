// Every game in the catalogue (supabase/sql/03_games_and_stakes.sql) must have an icon of its own
// in src/components/ui/GameIcon.tsx, and no two games may share a drawing. Run by `npm run check`.
import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/sql/03_games_and_stakes.sql', 'utf8');
const games = [...sql.matchAll(/^\s+\('([a-z0-9_]+)',\s+'(?:[^']|'')+',\s+'(?:table|poker|slots|specialty)'/gm)].map((m) => m[1]);
const src = readFileSync('src/components/ui/GameIcon.tsx', 'utf8');
const body = src.slice(src.indexOf('const ICONS'), src.indexOf('export const GAME_ICON_KEYS'));
const starts = [...body.matchAll(/^  ([a-z0-9_]+): \($/gm)];
const icons = new Map(starts.map((m, i) => [m[1], body.slice(m.index + m[0].length, starts[i + 1]?.index ?? body.length).replace(/\s+/g, ' ').replace(/\/\/ -+ [a-z ]+$/, '').trim()]));

const problems = [];
if (games.length < 50) problems.push(`only ${games.length} games were found in the catalogue: has its layout changed?`);
for (const g of games) if (!icons.has(g)) problems.push(`${g} has no icon`);
for (const k of icons.keys()) if (!games.includes(k)) problems.push(`${k} has an icon but is not in the catalogue`);
const seen = new Map();
for (const [k, drawing] of icons) {
  if (seen.has(drawing)) problems.push(`${k} and ${seen.get(drawing)} have the same drawing`);
  seen.set(drawing, k);
}
if (problems.length) {
  console.error('Icon check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`Icon check passed (${games.length} games, each with its own icon).`);
