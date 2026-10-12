// Stage 10, part 2: four blackjack variants, Red Dog, Hi-Lo, Andar Bahar and Chuck-a-Luck.
const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', m); };
const q = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const bal = async (email) => Number((await q(`select w.balance from public.wallets w join auth.users u on u.id = w.user_id where u.email = $1`, [email])).balance);
const deck = (cards) => pool.query('select tests.deck($1)', [cards]);
const dice = (...v) => pool.query('insert into tests.dice (v) select x from unnest($1::int[]) with ordinality u(x, o) order by o', [v]);
const GAMES = ['spanish_21', 'blackjack_switch', 'free_bet_blackjack', 'pontoon', 'red_dog', 'hi_lo', 'andar_bahar', 'chuck_a_luck'];

async function login(browser, email, vp) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  await page.addInitScript(() => { if (!localStorage.getItem('allin-settings')) localStorage.setItem('allin-settings', JSON.stringify({ state: { soundOn: true, motion: 'system', tourSeen: false, tipsOn: false, tipsSeen: {} }, version: 1 })); });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.goto(BASE + '/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('abcDEF12');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/lounge');
  return page;
}
const open = async (page, game) => { await page.goto(`${BASE}/play/${game}`); await page.getByRole('button', { name: 'Rules' }).waitFor(); await page.waitForTimeout(300); };
const chip = (page, v) => page.getByRole('radio', { name: `${v} chip`, exact: true }).click();
const spot = (page, re) => page.getByRole('button', { name: re }).click();
const button = (page, name) => page.getByRole('button', { name, exact: true }).click();
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

let watch = null;
(async () => {
  await pool.query('delete from tests.dice; delete from tests.decks;');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  watch = ann;
  const A = 'ann@allin.test';
  let b;

  // Spanish 21: 6-7-8 for the bonus
  await open(ann, 'spanish_21');
  b = await bal(A);
  await deck('6s Kd 7h 9c 8d');
  await chip(ann, 100);
  await spot(ann, /^Bet\./);
  await button(ann, 'Deal');
  await ann.getByText(/you have 13/).waitFor();
  ok((await ann.getByRole('button', { name: 'Surrender', exact: true }).count()) === 1, 'Spanish 21 offers surrender on the first two cards');
  await ann.screenshot({ path: `${SHOTS}/h-spanish-decide.png` });
  await button(ann, 'Hit');
  await ann.getByText(/Bonus 21/).waitFor({ timeout: 10000 });
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/h-spanish-result.png` });
  ok((await bal(A)) === b + 150, 'Spanish 21: 6-7-8 pays 3 to 2');

  // Blackjack Switch: 15 and 15 become 20 and 10
  await open(ann, 'blackjack_switch');
  b = await bal(A);
  await deck('Ts 5h 6d 5s Td 9c Kh');
  await chip(ann, 100);
  await spot(ann, /^Bet\./);
  await button(ann, 'Deal');
  await ann.getByRole('button', { name: 'Switch', exact: true }).waitFor();
  ok((await bal(A)) === b - 200, 'Blackjack Switch takes two bets');
  await ann.screenshot({ path: `${SHOTS}/h-switch-before.png` });
  await button(ann, 'Switch');
  await ann.getByText(/Hand 1: you have 20/).waitFor();
  await button(ann, 'Stand');
  await ann.getByText(/Hand 2: you have 10/).waitFor();
  await ann.getByRole('button', { name: /^Double/ }).click();
  await ann.getByText(/The dealer has 18/).waitFor({ timeout: 10000 });
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/h-switch-result.png` });
  ok((await bal(A)) === b - 300 + 600, 'after the switch both hands win');

  // Free Bet Blackjack: a free double
  await open(ann, 'free_bet_blackjack');
  b = await bal(A);
  await deck('5s Td 6h 7c 9d');
  await chip(ann, 100);
  await spot(ann, /^Bet\./);
  await button(ann, 'Deal');
  await ann.getByRole('button', { name: /^Double free$/ }).waitFor();
  await ann.screenshot({ path: `${SHOTS}/h-freebet-decide.png` });
  await ann.getByRole('button', { name: /^Double free$/ }).click();
  await ann.getByText(/The dealer has 17/).waitFor({ timeout: 10000 });
  ok((await bal(A)) === b + 200, 'Free Bet: a free double wins on both bets for the price of one');

  // Pontoon: a five-card trick
  await open(ann, 'pontoon');
  b = await bal(A);
  await deck('6s Td 6h 7c');
  await chip(ann, 100);
  await spot(ann, /^Bet\./);
  await button(ann, 'Deal');
  await ann.getByRole('button', { name: 'Twist', exact: true }).waitFor();
  ok((await ann.getByRole('button', { name: 'Stick', exact: true }).count()) === 0, 'Pontoon: no sticking on 12');
  await button(ann, 'Twist');
  await ann.getByText(/you have 13/).waitFor();
  await button(ann, 'Twist');
  await ann.getByRole('button', { name: 'Stick', exact: true }).waitFor();
  await button(ann, 'Twist');
  await ann.getByText(/The dealer has 17/).waitFor({ timeout: 10000 });
  ok((await ann.getByText(/Five-card trick/).count()) >= 1, 'Pontoon: five cards without going over is called a five-card trick');
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/h-pontoon-result.png` });
  ok((await bal(A)) === b + 200, 'a five-card trick pays 2 to 1');

  // Red Dog
  await open(ann, 'red_dog');
  b = await bal(A);
  await deck('5s 9h 7d');
  await button(ann, 'Deal');
  await ann.getByText(/A spread of 3/).waitFor();
  await ann.screenshot({ path: `${SHOTS}/h-reddog-decide.png` });
  await ann.getByRole('button', { name: /^Raise/ }).click();
  await ann.getByText('In between: you win!').waitFor({ timeout: 10000 });
  ok((await bal(A)) === b - 20 + 60, 'Red Dog: raised on a spread of three, 2 to 1');

  // Hi-Lo: seven, then a king, collect
  await open(ann, 'hi_lo');
  b = await bal(A);
  await dice(6);
  await button(ann, 'Start');
  await ann.getByText(/higher or lower than 7/).waitFor();
  await dice(11);
  await ann.getByRole('button', { name: /^Higher/ }).click();
  await ann.getByText(/Right 1 time/).waitFor();
  await ann.screenshot({ path: `${SHOTS}/h-hilo.png` });
  await ann.getByRole('button', { name: /^Collect/ }).click();
  await ann.getByText(/Collected at ×1.7/).waitFor();
  ok((await bal(A)) === b - 10 + 17, 'Hi-Lo: one right guess from a seven pays 1.7 times');

  // Andar Bahar
  await open(ann, 'andar_bahar');
  b = await bal(A);
  await deck('7s 2h 3d 7h');
  await chip(ann, 100);
  await spot(ann, /^Andar\./);
  await button(ann, 'Deal');
  await ann.getByText(/Andar matches the 7 after 3 cards/).waitFor({ timeout: 10000 });
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/h-andar.png` });
  ok((await bal(A)) === b + 90, 'Andar Bahar: Andar pays 1 to 1 less 10 percent');

  // Chuck-a-Luck: three threes
  await open(ann, 'chuck_a_luck');
  b = await bal(A);
  await dice(2, 2, 2);
  await chip(ann, 10);
  await spot(ann, /^3\./);
  await spot(ann, /^Any triple\./);
  await button(ann, 'Roll');
  await ann.getByText(/3 · 3 · 3 makes 9, a triple!/).waitFor({ timeout: 10000 });
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/h-chuck.png` });
  ok((await bal(A)) === b - 20 + 110 + 310, 'Chuck-a-Luck: 10 to 1 on the number and 30 to 1 on the triple');

  // A blackjack hand left open is picked up after a reload.
  await open(ann, 'spanish_21');
  await deck('9s Kd 7h 9c');
  await chip(ann, 100);
  await spot(ann, /^Bet\./);
  await button(ann, 'Deal');
  await ann.getByRole('button', { name: 'Hit', exact: true }).waitFor();
  await ann.reload();
  await ann.getByRole('button', { name: 'Stand', exact: true }).waitFor();
  ok(true, 'a blackjack hand left open is still there after a reload');
  await button(ann, 'Stand');
  await ann.getByText(/The dealer has 19/).waitFor({ timeout: 10000 });

  // Phone widths
  const phone = await login(browser, 'ben@allin.test', { width: 390, height: 800 });
  for (const g of GAMES) {
    await open(phone, g);
    ok(await fits(phone), `phone: ${g} fits 390px`);
    await phone.screenshot({ path: `${SHOTS}/h-mobile-${g}.png`, fullPage: true });
  }
  await open(phone, 'blackjack_switch');
  await deck('8s 8h 6d 8d 8c 9c Kh');
  await chip(phone, 100);
  await spot(phone, /^Bet\./);
  await button(phone, 'Deal');
  await phone.getByRole('button', { name: 'Switch', exact: true }).waitFor();
  ok(await fits(phone), 'phone: two hands and five choices fit');
  await phone.screenshot({ path: `${SHOTS}/h-mobile-switch-decide.png`, fullPage: true });

  ok(ann.errors.length === 0 && phone.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...phone.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch(async (e) => { console.error(e); if (watch) await watch.screenshot({ path: `${SHOTS}/h-fail.png` }).catch(() => undefined); process.exit(1); });
