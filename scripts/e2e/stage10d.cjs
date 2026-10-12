// Stage 10, part 4: horse racing (a live room, two players) and a Teen Patti table (two players, a full hand).
const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', m); };
const q = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const refresh = async (page) => { await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await page.waitForTimeout(700); };
const bal = async (email) => Number((await q(`select w.balance from public.wallets w join auth.users u on u.id = w.user_id where u.email = $1`, [email])).balance);
// Moves the race room's clock forward.
const raceSkip = (s) => pool.query(`update public.race_rounds set betting_ends_at = betting_ends_at - make_interval(secs => $1), started_at = started_at - make_interval(secs => $1), ends_at = ends_at - make_interval(secs => $1) where round_no = (select max(round_no) from public.race_rounds)`, [s]);

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
async function sitAt(page, game, name) {
  await page.goto(`${BASE}/lobby?game=${game}`);
  await page.locator('li', { hasText: name }).getByRole('button', { name: 'Sit down' }).click();
  await page.waitForURL('**/table/*');
  await page.waitForTimeout(900);
}
async function bring(page) {
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  await dlg.getByRole('button', { name: /^Bring/ }).click();
  await dlg.waitFor({ state: 'detached' });
  await page.waitForTimeout(500);
}
async function press(page, other, name) {
  await page.getByRole('button', { name }).click();
  await page.waitForTimeout(500);
  await refresh(other);
}

(async () => {
  await pool.query('delete from tests.dice; delete from tests.decks; delete from public.race_rounds;');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });

  // ---------- Menus ----------
  await ann.getByText('Horse Racing').first().waitFor();
  await ann.getByText('Teen Patti Tables').first().waitFor();
  ok(true, 'the lounge lists Horse Racing and Teen Patti Tables');
  await ann.goto(`${BASE}/lobby?game=teen_patti_live`);
  await ann.getByText('Emerald Teen Patti').first().waitFor();
  await ann.getByText(/Boot 10/).first().waitFor();
  ok(true, 'the lobby has Teen Patti tables, with the boot as the stake');
  await ann.goto(`${BASE}/lobby?game=horse_racing`);
  await ann.getByRole('link', { name: /Join the room/ }).waitFor();
  ok(true, 'the lobby sends you to the race room');

  // ---------- Horse racing: chances 30, 22, 18, 13, 10, 7 in order ----------
  await pool.query(`insert into tests.dice (v) select 0 from generate_series(1, 13)`);
  await ann.goto(`${BASE}/play/horse_racing`);
  await ann.getByText('Thunder Roll').first().waitFor({ timeout: 8000 });
  await ben.goto(`${BASE}/play/horse_racing`);
  await ben.getByText('Thunder Roll').first().waitFor({ timeout: 8000 });
  ok((await ann.getByRole('button', { name: /Midnight Ace to win, pays 3\.00×/ }).count()) === 1 && (await ann.getByRole('button', { name: /Thunder Roll to win, pays 13\.10×/ }).count()) === 1, 'six runners with prices: 3.00× for the favourite, 13.10× for the outsider');
  ok(await fits(ben), 'phone: the race card fits 390px');
  await ann.getByRole('button', { name: /Thunder Roll to win/ }).click();
  await ann.getByRole('button', { name: /Thunder Roll to win.*you have 10 on it/ }).waitFor();
  await ben.getByRole('button', { name: /Midnight Ace to place/ }).click();
  await ben.getByRole('button', { name: /Midnight Ace to place.*you have 10 on it/ }).waitFor();
  await ben.getByRole('button', { name: /Ruby Run to win/ }).click();
  await ben.getByRole('button', { name: /Ruby Run to win.*you have 10 on it/ }).waitFor();
  ok((await bal('ann@allin.test')) === 9990 && (await bal('ben@allin.test')) === 9980, 'bets are taken from the wallet');
  await refresh(ann);
  await ann.getByText(/10 riding · 1 player/).first().waitFor();
  ok(true, 'you see what is riding on each horse');
  await ann.screenshot({ path: `${SHOTS}/j-race-betting.png`, fullPage: true });
  await ben.screenshot({ path: `${SHOTS}/j-race-betting-phone.png`, fullPage: true });
  await ann.getByRole('button', { name: 'Rules' }).click();
  await ann.getByText(/drawn by the server at the moment betting closes/).waitFor();
  await ann.keyboard.press('Escape');

  // Betting closes: 6 wins from 1.
  await pool.query(`insert into tests.dice (v) values (95), (0), (0), (0), (0), (0)`);
  await raceSkip(26);
  await refresh(ann);
  await refresh(ben);
  await ann.getByText(/they’re off/).first().waitFor({ timeout: 8000 });
  ok((await bal('ann@allin.test')) === 9990, 'nothing is paid while they are running');
  ok((await ann.getByRole('button', { name: /Lucky Penny to win/ }).isDisabled()), 'bets are closed during the race');
  await raceSkip(5);
  await ann.waitForTimeout(1300);
  await ann.screenshot({ path: `${SHOTS}/j-race-running.png` });
  await raceSkip(8);
  await refresh(ann);
  await refresh(ben);
  await ann.getByText(/Thunder Roll wins at 13\.10×/).waitFor({ timeout: 8000 });
  await ann.getByText('+131').last().waitFor();
  await ben.getByText('+16').last().waitFor({ timeout: 8000 });
  ok((await bal('ann@allin.test')) === 9990 + 131 && (await bal('ben@allin.test')) === 9980 + 16, 'the winner pays 13.10× and the place 1.60×; the losing bet is gone');
  await ann.screenshot({ path: `${SHOTS}/j-race-result.png`, fullPage: true });
  await ben.screenshot({ path: `${SHOTS}/j-race-result-phone.png`, fullPage: true });
  ok(await fits(ben), 'phone: the result fits 390px');
  await raceSkip(8);
  await refresh(ann);
  await ann.getByText(/Recent winners/).waitFor({ timeout: 8000 });
  await ann.getByText(/Thunder Roll · 13\.10×/).waitFor();
  ok(true, 'the next race opens and the winner joins the recent list');
  await ann.getByRole('button', { name: 'History' }).click();
  await ann.getByText(/Thunder Roll won · 1 bet came in/).waitFor();
  await ann.keyboard.press('Escape');
  ok(true, 'the race is in your history');

  // ---------- Teen Patti: Ben Ks Kh 2d (acts first), Ann As Qd 9c ----------
  await pool.query(`delete from tests.dice; select tests.deck('Ks Kh 2d As Qd 9c')`);
  await sitAt(ann, 'teen_patti_live', 'Emerald Teen Patti');
  await bring(ann);
  await sitAt(ben, 'teen_patti_live', 'Emerald Teen Patti');
  await bring(ben);
  await refresh(ann);
  await ben.getByRole('button', { name: 'Blind · 10' }).waitFor({ timeout: 8000 });
  ok((await ben.getByRole('button', { name: 'Raise · 20' }).count()) === 1 && (await ben.getByRole('button', { name: 'Show · 10' }).count()) === 1 && (await ben.getByRole('button', { name: 'See cards' }).count()) === 1, 'blind: bet 10, raise to 20, show for 10, or look');
  ok(await fits(ben), 'phone: the table fits 390px');
  await ben.screenshot({ path: `${SHOTS}/j-teenpatti-blind-phone.png`, fullPage: true });
  // Ann looks before her turn.
  await ann.getByRole('button', { name: 'See cards' }).click();
  await ann.getByText('High card').first().waitFor({ timeout: 8000 });
  ok(true, 'you can look at your cards while you wait, and are told what you hold');
  await press(ben, ann, 'Blind · 10');
  await ann.getByRole('button', { name: 'Chaal · 20' }).waitFor({ timeout: 8000 });
  ok((await ann.getByRole('button', { name: 'Raise · 40' }).count()) === 1, 'seen: twice the stake');
  await ann.screenshot({ path: `${SHOTS}/j-teenpatti-seen.png` });
  await ann.getByRole('button', { name: 'Rules' }).click();
  await ann.getByText('Pure sequence').first().waitFor();
  await ann.screenshot({ path: `${SHOTS}/j-teenpatti-rules.png` });
  await ann.keyboard.press('Escape');
  await press(ann, ben, 'Raise · 40');
  await ben.getByRole('button', { name: 'Show · 20' }).waitFor({ timeout: 8000 });
  await press(ben, ann, 'Show · 20');
  await ben.getByText(/You win 90 · Pair/).waitFor({ timeout: 8000 });
  await ann.getByText(/Ben wins 90 · Pair/).waitFor({ timeout: 8000 });
  ok(true, 'the show: the blind pair beats the seen high card');
  await ann.screenshot({ path: `${SHOTS}/j-teenpatti-show.png` });
  await ben.screenshot({ path: `${SHOTS}/j-teenpatti-show-phone.png`, fullPage: true });
  await ben.getByRole('button', { name: 'History' }).click();
  await ben.getByText('Hand #1').waitFor();
  await ben.keyboard.press('Escape');
  ok(true, 'the hand is in the table history');
  await ann.getByRole('button', { name: /Leave table/ }).click();
  await ben.getByRole('button', { name: /Leave table/ }).click();
  await ann.waitForURL('**/lobby**');
  await ben.waitForURL('**/lobby**');
  ok((await bal('ann@allin.test')) === 9990 + 131 - 50 && (await bal('ben@allin.test')) === 9980 + 16 + 50, 'stacks go back to the wallets: 50 moved from Ann to Ben');
  const benId = (await q(`select id from auth.users where email = 'ben@allin.test'`)).id;
  ok((await q(`select count(*)::int as n from public.player_achievements where user_id = $1 and achievement_key = 'tpt_blind'`, [benId])).n === 1, 'Ben never looked: Blind Faith');
  await ben.goto(`${BASE}/profile`);
  await ben.getByText('Blind Faith').first().waitFor();
  ok(true, 'and it shows on his profile');

  ok(ann.errors.length === 0 && ben.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...ben.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
