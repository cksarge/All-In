const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', m); };
const bal = async (email) => Number((await pool.query(`select w.balance from public.wallets w join auth.users u on u.id = w.user_id where u.email = $1`, [email])).rows[0].balance);
const pot = async (col = 'amount') => Number((await pool.query(`select ${col} as v from public.jackpots where key = 'grand'`)).rows[0].v);
// Stack the next spin: reels in order, each a list of symbols from top to bottom.
const reels = async (game, list) => { for (let i = 0; i < list.length; i++) await pool.query('select tests.slot_reel($1, $2, variadic $3::text[])', [game, game === 'slots_cascade' ? 0 : i, list[i]]); };
const raw = (...v) => pool.query('insert into tests.dice (v) select x from unnest($1::int[]) with ordinality u(x, o) order by o', [v]);
const same = (n, v) => Array(n).fill(v);

async function login(browser, email, vp) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
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
const open = async (page, game) => { await page.goto(`${BASE}/play/${game}`); await page.getByRole('button', { name: 'Spin' }).waitFor(); };
const spin = (page) => page.getByRole('button', { name: 'Spin' }).click();
const done = async (page) => {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Spin');
    return b && !b.disabled;
  }, null, { timeout: 60000 });
};
const raise = async (page, times) => { for (let i = 0; i < times; i++) await page.getByRole('button', { name: 'Raise bet' }).click(); };
const NOTHING = [['J', 'K', 'J'], ['Q', 'A', 'Q'], ['J', 'J', 'J'], ['J', 'J', 'J'], ['J', 'J', 'J']];

(async () => {
  await pool.query('delete from tests.dice');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const A = 'ann@allin.test';

  // From the lounge
  await ann.getByRole('tab', { name: 'Slots' }).click();
  await ann.getByText('Jackpot now').waitFor();
  ok(true, 'lounge card shows the live jackpot');
  await ann.screenshot({ path: `${SHOTS}/sl-lounge.png` });
  await ann.locator('li', { hasText: 'Lucky Sevens' }).getByRole('link', { name: /Play now/ }).click();
  await ann.waitForURL('**/play/slots_classic');
  await ann.getByRole('button', { name: 'Spin' }).waitFor();
  ok(true, 'lounge opens Lucky Sevens');
  await ann.screenshot({ path: `${SHOTS}/sl-classic-idle.png` });

  // Lucky Sevens: 777
  let b = await bal(A);
  await reels('slots_classic', [['BLANK', 'SEVEN', 'BAR1'], ['BELL', 'SEVEN', 'BLANK'], ['CHERRY', 'SEVEN', 'BAR3']]);
  await spin(ann);
  await ann.getByText('Big win!').waitFor({ timeout: 15000 });
  await ann.screenshot({ path: `${SHOTS}/sl-classic-777.png` });
  ok((await bal(A)) === b - 10 + 1500, 'three sevens paid 150x');
  await ann.getByRole('button', { name: 'Rules' }).click();
  await ann.getByRole('tab', { name: 'Paytable' }).click();
  await ann.screenshot({ path: `${SHOTS}/sl-classic-paytable.png` });
  await ann.getByRole('button', { name: 'Close' }).click();
  await ann.getByRole('button', { name: 'History' }).click();
  await ann.getByText('×150 the bet').waitFor();
  ok(true, 'history shows the spin');
  await ann.getByRole('button', { name: 'Close' }).click();

  // Pharaoh's Fortune: free spins
  await open(ann, 'slots_paylines');
  await raise(ann, 3); // 100
  b = await bal(A);
  await reels('slots_paylines', [['SCATTER', 'J', 'K'], ['SCATTER', 'Q', 'A'], ['SCATTER', 'J', 'K'], ['J', 'J', 'J'], ['J', 'J', 'J']]);
  await reels('slots_paylines', [['EYE', 'K', 'J'], ['EYE', 'A', 'Q'], ['EYE', 'J', 'J'], ['J', 'J', 'J'], ['J', 'J', 'J']]);
  for (let i = 0; i < 9; i++) await reels('slots_paylines', NOTHING);
  await spin(ann);
  await ann.getByText('10 Free Spins').waitFor({ timeout: 15000 });
  ok((await ann.getByRole('banner').getByText(String((b - 100 + 200).toLocaleString('en-US'))).count()) > 0, 'balance shows the scatter win but not the free spins yet');
  await ann.screenshot({ path: `${SHOTS}/sl-paylines-trigger.png` });
  await ann.getByText('Free spin 1 of 10').waitFor({ timeout: 15000 });
  await ann.waitForTimeout(1500);
  await ann.screenshot({ path: `${SHOTS}/sl-paylines-freespin.png` });
  await ann.getByText('Free spins complete').waitFor({ timeout: 60000 });
  await ann.screenshot({ path: `${SHOTS}/sl-paylines-complete.png` });
  await done(ann);
  ok((await bal(A)) === b - 100 + 760, 'scatter pay + doubled free spin win');

  // Skip button fast-forwards
  await reels('slots_paylines', [['SCATTER', 'J', 'K'], ['SCATTER', 'Q', 'A'], ['SCATTER', 'J', 'K'], ['J', 'J', 'J'], ['J', 'J', 'J']]);
  for (let i = 0; i < 10; i++) await reels('slots_paylines', NOTHING);
  b = await bal(A);
  await spin(ann);
  await ann.getByRole('button', { name: 'Skip' }).click();
  await done(ann);
  ok((await bal(A)) === b - 100 + 200, 'skip jumps to the end');

  // Dragon Pearls: hold and win
  await open(ann, 'slots_holdwin');
  b = await bal(A);
  await reels('slots_holdwin', [['PEARL', 'PEARL', 'PEARL'], ['PEARL', 'PEARL', 'PEARL'], ['K', 'Q', 'K'], ['A', 'A', 'A'], ['Q', 'K', 'Q']]);
  await raw(0, 0, 0, 40, 65, 90, 0, 99, ...same(8, 9999), ...same(24, 9999));
  await spin(ann);
  await ann.getByText('Hold & Win').waitFor({ timeout: 15000 });
  await ann.screenshot({ path: `${SHOTS}/sl-holdwin-trigger.png` });
  await ann.getByText(/New pearl!/).waitFor({ timeout: 15000 });
  await ann.screenshot({ path: `${SHOTS}/sl-holdwin-respin.png` });
  await ann.getByText('Pearls pay').waitFor({ timeout: 30000 });
  await ann.screenshot({ path: `${SHOTS}/sl-holdwin-pays.png` });
  await done(ann);
  ok((await bal(A)) === b - 10 + 1180, `six pearls (18x) plus a 100x pearl paid (balance ${await bal(A)})`);

  // Wild Frontier: ways
  await open(ann, 'slots_ways');
  b = await bal(A);
  const ways = [[2, ['BISON', 'J', 'K', 'Q', 'A']], [1, ['BISON', 'BISON', 'Q', 'A']], [0, ['WILD', 'A', 'A']], [1, ['BISON', 'K', 'K', 'K']], [0, ['J', 'J', 'J']]];
  const hb = { 0: 0, 1: 50, 2: 85 }; // index into the height bag: 3, 4 or 5 rows
  for (let i = 0; i < ways.length; i++) { await raw(hb[ways[i][0]]); await pool.query('select tests.slot_reel($1, $2, variadic $3::text[])', ['slots_ways', i, ways[i][1]]); }
  await spin(ann);
  await ann.getByText('You win!').waitFor({ timeout: 15000 });
  await ann.screenshot({ path: `${SHOTS}/sl-ways.png` });
  ok((await bal(A)) === b - 10 + 47, `bison on four reels two ways, plus aces and queens (balance ${await bal(A)})`);

  // Gem Cascade
  await open(ann, 'slots_cascade');
  b = await bal(A);
  const G = ['DIAMOND', 'RUBY', 'EMERALD', 'SAPPHIRE', 'AMETHYST', 'TOPAZ', 'QUARTZ'];
  const gems = [];
  for (let c = 0; c < 6; c++) gems.push(Array.from({ length: 5 }, (_, r) => (c === 0 ? 'DIAMOND' : G[(c + 2 * r + 1) % 7])));
  await reels('slots_cascade', gems);
  await reels('slots_cascade', [['RUBY', 'SAPPHIRE', 'TOPAZ', 'DIAMOND', 'EMERALD']]);
  await spin(ann);
  await ann.waitForTimeout(1900);
  await ann.screenshot({ path: `${SHOTS}/sl-cascade-win.png` });
  await done(ann);
  await ann.screenshot({ path: `${SHOTS}/sl-cascade-after.png` });
  ok((await bal(A)) === b - 10 + 100, 'five diamonds paid 10x');

  // Grand Jackpot
  await open(ann, 'slots_progressive');
  await ann.getByText('Grand Jackpot').first().waitFor();
  await ann.screenshot({ path: `${SHOTS}/sl-jackpot-idle.png` });
  b = await bal(A);
  const before = Math.floor(((await pot('pool_hundredths')) + 20) / 100); // 2% of this 10-chip bet goes in first
  await reels('slots_progressive', [['BELL', 'BELL', 'BELL'], ['BAR', 'BAR', 'BAR'], ['BELL', 'BELL', 'BELL'], ['BAR', 'BAR', 'BAR'], ['BELL', 'BELL', 'BELL']]);
  await raw(0);
  await spin(ann);
  await ann.getByText('Jackpot!').waitFor({ timeout: 15000 });
  await ann.waitForTimeout(600);
  await ann.screenshot({ path: `${SHOTS}/sl-jackpot-won.png` });
  await done(ann);
  ok((await bal(A)) === b - 10 + before, `jackpot of ${before} paid`);
  ok((await pot()) === 100000, 'pot reset to its seed');
  await ann.getByText(/Last won by Ann/).waitFor({ timeout: 5000 });
  ok(true, 'ticker names the winner');
  await ann.screenshot({ path: `${SHOTS}/sl-jackpot-after.png` });

  // Phone: every machine fits and spins
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });
  for (const g of ['slots_classic', 'slots_paylines', 'slots_cascade', 'slots_ways', 'slots_holdwin', 'slots_progressive']) {
    await open(ben, g);
    if (g === 'slots_progressive') await raw(...same(15, 0), 4999999); // never the jackpot here
    await spin(ben);
    await done(ben);
    const fits = await ben.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    ok(fits, `${g} fits a 390px phone`);
    await ben.screenshot({ path: `${SHOTS}/sl-mobile-${g}.png`, fullPage: true });
    if (g === 'slots_cascade') await ben.screenshot({ path: `${SHOTS}/sl-mobile-viewport.png` });
  }
  const tiny = await login(browser, 'cat@allin.test', { width: 360, height: 740 });
  await open(tiny, 'slots_cascade');
  ok(await tiny.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'Gem Cascade fits 360px');
  await tiny.getByRole('button', { name: 'Rules' }).click();
  await tiny.getByRole('tab', { name: 'Paytable' }).click();
  await tiny.screenshot({ path: `${SHOTS}/sl-mobile-360-paytable.png` });

  const errors = ann.errors.concat(ben.errors, tiny.errors);
  ok(!errors.length, `no page errors ${JSON.stringify(errors)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
