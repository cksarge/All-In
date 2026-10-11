const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
const ok = (c, m) => console.log(c ? 'PASS' : 'FAIL', m);
const bal = async (email) => Number((await pool.query(`select w.balance from public.wallets w join auth.users u on u.id = w.user_id where u.email = $1`, [email])).rows[0].balance);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
async function sitAt(page, game, name) {
  await page.goto(`${BASE}/lobby?game=${game}`);
  await page.locator('li', { hasText: name }).getByRole('button', { name: 'Sit down' }).click();
  await page.waitForURL('**/table/*');
  await page.waitForTimeout(800);
}

(async () => {
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });

  // ================= ROULETTE =================
  await sitAt(ann, 'roulette', 'Riviera Wheel');
  const rlTable = ann.url().split('/table/')[1];
  await sitAt(ben, 'roulette', 'Riviera Wheel');
  const a0 = await bal('ann@allin.test');
  const b0 = await bal('ben@allin.test');
  await ann.getByRole('radio', { name: '100 chip', exact: true }).click();
  await ann.getByRole('button', { name: /^Straight 17\./ }).click();
  await ann.waitForTimeout(300);
  await ann.getByRole('button', { name: /^Black\./ }).click();
  await ben.getByRole('radio', { name: '25 chip', exact: true }).click();
  await ben.getByRole('button', { name: /^Column 2\./ }).click();
  await ann.waitForTimeout(900);
  ok((await bal('ann@allin.test')) === a0 - 200, 'roulette bets deducted');
  await ann.screenshot({ path: `${SHOTS}/rl-betting.png` });
  await ben.screenshot({ path: `${SHOTS}/rl-mobile.png`, fullPage: true });
  // Wait for the spin, then force the pocket to 17 (test only).
  let spinning = null;
  for (let i = 0; i < 40 && !spinning; i++) {
    await sleep(1000);
    spinning = (await pool.query(`select id from public.rl_rounds where table_id = $1 and phase = 'spinning'`, [rlTable])).rows[0];
  }
  ok(Boolean(spinning), 'betting closed and the wheel is spinning');
  await pool.query(`update public.rl_secrets set result = 17 where round_id = $1`, [spinning.id]);
  await ann.waitForTimeout(1500);
  await ann.screenshot({ path: `${SHOTS}/rl-spinning.png` });
  await ann.getByText('You win').waitFor({ timeout: 25000 });
  await ann.screenshot({ path: `${SHOTS}/rl-win.png` });
  ok((await bal('ann@allin.test')) === a0 - 200 + 3600 + 200, `straight 17 + black paid (balance ${await bal('ann@allin.test')})`);
  ok((await bal('ben@allin.test')) === b0 - 25 + 75, 'column 2 (17 is in it) paid 2:1');
  await ann.getByRole('button', { name: '← Leave table' }).click();
  await ben.getByRole('button', { name: '← Leave table' }).click();
  await ann.waitForURL('**/lobby*');

  // ================= CRAPS =================
  await sitAt(ann, 'craps', 'Lucky Dice');
  const crTable = ann.url().split('/table/')[1];
  await sitAt(ben, 'craps', 'Lucky Dice');
  const a1 = await bal('ann@allin.test');
  await ann.getByRole('radio', { name: '100 chip', exact: true }).click();
  await ann.getByRole('button', { name: /^Pass Line\./ }).click();
  await ben.getByRole('radio', { name: '10 chip', exact: true }).click();
  await ben.getByRole('button', { name: /^Field\./ }).click();
  await ann.waitForTimeout(800);
  await pool.query(`insert into tests.dice (v) values (2), (3)`); // 3 + 4 = 7
  await ann.getByRole('button', { name: /Roll the dice/ }).click();
  await ann.waitForTimeout(1800);
  await ann.screenshot({ path: `${SHOTS}/cr-natural.png` });
  ok((await bal('ann@allin.test')) === a1 + 100, 'pass line won on a come-out 7');
  // Point 4 and odds
  await ann.getByRole('button', { name: /^Pass Line\./ }).click();
  await ann.waitForTimeout(3500);
  await pool.query(`insert into tests.dice (v) values (1), (1)`); // 2 + 2 = 4
  await ann.getByRole('button', { name: /Roll the dice/ }).click();
  await ann.waitForTimeout(1500);
  ok(await ann.getByText('ON · 4').isVisible(), 'puck ON at 4');
  await ann.getByRole('button', { name: '+ Odds' }).click();
  await ann.waitForTimeout(600);
  ok((await pool.query(`select odds from public.cr_bets where table_id = $1 and status = 'active' and bet_type = 'pass'`, [crTable])).rows[0]?.odds == 100, 'odds added behind the pass line');
  await ann.getByRole('checkbox', { name: 'Beginner mode' }).uncheck();
  await ann.getByRole('button', { name: /^Hard 8\./ }).click();
  await ann.waitForTimeout(800);
  await ann.screenshot({ path: `${SHOTS}/cr-point.png`, fullPage: true });
  await ben.waitForTimeout(13000);
  await ben.screenshot({ path: `${SHOTS}/cr-mobile.png`, fullPage: true });
  const a2 = await bal('ann@allin.test');
  await pool.query(`insert into tests.dice (v) values (0), (2)`); // 1 + 3 = 4 easy: point made, hard 8 unaffected
  await ann.waitForTimeout(3000);
  await ann.getByRole('button', { name: /Roll the dice/ }).click();
  await ann.waitForTimeout(1800);
  ok((await bal('ann@allin.test')) === a2 + 200 + 100 + 200, `point made: pass 1:1 + odds 2:1 (balance ${await bal('ann@allin.test')})`);
  await ann.screenshot({ path: `${SHOTS}/cr-pointmade.png` });

  ok(!ann.errors.length && !ben.errors.length, `no page errors ${JSON.stringify(ann.errors.concat(ben.errors))}`);
  await browser.close();
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
