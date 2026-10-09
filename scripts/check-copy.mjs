#!/usr/bin/env node
/**
 * Guards the "no real money" copy rules in player-facing source:
 *   - no currency symbols next to numbers (chips use the chip icon)
 *   - no transactional words: deposit, withdraw, cash out, buy, purchase
 * The required disclaimers ("No purchases", "nothing to buy", ...) are allowed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIRS = ['src', 'supabase/email-templates'];
const EXTS = /\.(tsx?|html)$/;

const WORDS = /\b(deposit\w*|withdraw\w*|cash[\s-]?out\w*|buy\w*|purchas\w*|bought)\b/gi;
// Negated / disclaimer uses that are required by the product rules.
const ALLOWED = /\b(no|never|nothing to|zero|without)\s+(purchases?|buying|buy)\b|can(?:'|’|no)t\s+(?:be\s+)?(?:bought|buy)/i;
const CURRENCY = /[$€£¥₹₩]\s?\d|\d\s?[$€£¥₹₩]|['"`>]\s*[$€£¥]\s*['"`<]/;

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (EXTS.test(name)) files.push(p);
  }
};
DIRS.forEach((d) => walk(join(ROOT, d)));

const problems = [];
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      const stripped = line.replace(/\$\{[^}]*\}/g, ''); // template-literal placeholders aren't currency
      if (CURRENCY.test(stripped)) problems.push(`${relative(ROOT, file)}:${i + 1}: currency symbol: ${trimmed}`);
      for (const m of line.matchAll(WORDS)) {
        if (ALLOWED.test(line)) continue;
        problems.push(`${relative(ROOT, file)}:${i + 1}: "${m[0]}": ${trimmed}`);
      }
    });
}

if (problems.length) {
  console.error(`Copy check failed (${problems.length}):\n` + problems.join('\n'));
  process.exit(1);
}
console.log(`Copy check passed (${files.length} files).`);
