// Stage 10, part 3: the four new poker games at the tables (a full Badugi hand with three draws),
// plus the Grandmaster award and the seasonal tag in the locker.
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
// Whoever's turn it is presses the button; the other page is nudged to catch up.
async function press(page, other, name) {
  await page.getByRole('button', { name }).click();
  await page.waitForTimeout(500);
  await refresh(other);
}

(async () => {
  await pool.query('delete from tests.dice; delete from tests.decks;');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });

  // The lobby and lounge list them, with their stakes.
  await ann.goto(`${BASE}/lobby?game=poker_badugi`);
  await ann.getByText(/Limit 10\/20 · Blinds 5\/10/).first().waitFor();
  ok(true, 'the lobby shows fixed-limit stakes for Badugi');
  for (const [g, text] of [['poker_shortdeck', 'Emerald Short Deck'], ['poker_razz', 'Emerald Razz'], ['poker_27', 'Emerald Triple Draw']]) {
    await ann.goto(`${BASE}/lobby?game=${g}`);
    await ann.getByText(text).first().waitFor();
  }
  ok(true, 'Short Deck, Razz and Triple Draw have house tables too');

  // ---------- Badugi: Ann As 2h 3d 4c, Ben Ks Kh 5d 6d ----------
  await pool.query(`select tests.deck('As 2h 3d 4c Ks Kh 5d 6d 7c 8h')`);
  await sitAt(ann, 'poker_badugi', 'Emerald Badugi');
  await bring(ann);
  await sitAt(ben, 'poker_badugi', 'Emerald Badugi');
  await bring(ben);
  await refresh(ann);
  await ann.getByText(/Badugi, 4-3-2-A/).waitFor({ timeout: 8000 });
  ok(true, 'Badugi: four cards, and the hand is named');
  await ann.getByRole('button', { name: 'Rules' }).click();
  await ann.getByText(/four DIFFERENT suits/).waitFor();
  await ann.screenshot({ path: `${SHOTS}/i-badugi-rules.png` });
  await ann.keyboard.press('Escape');
  await press(ann, ben, /^Call/);
  await press(ben, ann, 'Check');
  // First draw: Ben swaps his two kings, Ann stands pat.
  await ben.getByText(/Choose cards to swap/).waitFor({ timeout: 8000 });
  ok(await fits(ben), 'phone: the draw fits 390px');
  await ben.getByRole('button', { name: 'Swap King of spades' }).click();
  await ben.getByRole('button', { name: 'Swap King of hearts' }).click();
  await ben.screenshot({ path: `${SHOTS}/i-badugi-draw-phone.png`, fullPage: true });
  await press(ben, ann, 'Draw 2');
  await press(ann, ben, 'Stand pat');
  await ben.getByText(/3-card hand, 8-7-5/).waitFor({ timeout: 8000 });
  ok(true, 'after the draw: two diamonds, so only three cards count');
  ok((await q(`select street from public.pk_hands h join public.game_tables t on t.id = h.table_id where t.name = 'Emerald Badugi' order by hand_no desc limit 1`)).street === 1, 'betting after the first draw');
  // Two more rounds of check, check, stand pat, stand pat; then the last bets.
  for (let round = 0; round < 2; round++) {
    await press(ben, ann, 'Check');
    await press(ann, ben, 'Check');
    await ann.getByRole('button', { name: 'Stand pat' }).waitFor({ timeout: 8000 });
    await press(ann, ben, 'Stand pat');
    await press(ben, ann, 'Stand pat');
  }
  ok((await q(`select street, phase from public.pk_hands h join public.game_tables t on t.id = h.table_id where t.name = 'Emerald Badugi' order by hand_no desc limit 1`)).street === 3, 'three draws, then the last betting round');
  await ann.screenshot({ path: `${SHOTS}/i-badugi-table.png` });
  await press(ben, ann, 'Check');
  await press(ann, ben, 'Check');
  await ann.getByText(/You win 20 · Badugi, 4-3-2-A/).waitFor({ timeout: 8000 });
  ok(true, 'the four-card badugi wins the pot');
  await ann.screenshot({ path: `${SHOTS}/i-badugi-showdown.png` });
  await ann.getByRole('button', { name: /Leave table/ }).click();
  await ben.getByRole('button', { name: /Leave table/ }).click();
  await ann.waitForURL('**/lobby**');

  // ---------- Grandmaster and the seasonal tag ----------
  const annId = (await q(`select id from auth.users where email = 'ann@allin.test'`)).id;
  await pool.query(`select private.add_xp($1, 980100)`, [annId]);
  await pool.query(`select private.check_achievements($1)`, [annId]);
  const key = (await q(`select to_char(now() at time zone 'utc', 'YYYY-MM') as k`)).k;
  await pool.query(`select private.season_sync()`);
  await pool.query(`select private.season_add($1, 400)`, [annId]);
  await pool.query(`select private.season_grant($1, private.season_current())`, [annId]).catch(() => undefined);
  await ann.goto(`${BASE}/profile`);
  await ann.getByRole('heading', { name: 'Achievements' }).waitFor();
  await ann.getByText(/of 83 unlocked/).waitFor();
  ok((await ann.getByText('Grandmaster').count()) >= 1 && (await ann.getByText(/\+ Grandmaster and 1 more/).count()) === 1, 'Grandmaster is listed with its two prizes');
  await ann.goto(`${BASE}/locker`);
  await ann.getByRole('heading', { name: 'Locker' }).waitFor();
  await ann.getByRole('tab', { name: /Frames/ }).click();
  await ann.getByRole('button', { name: /Grandmaster's Halo/ }).click();
  await ann.getByText('Equipped').first().waitFor();
  await ann.screenshot({ path: `${SHOTS}/i-locker-grandmaster.png`, fullPage: true });
  ok((await q(`select frame from public.player_loadouts where user_id = $1`, [annId])).frame === 'frame_grandmaster', 'the Grandmaster frame can be worn');
  const seasonal = Number((await q(`select count(*) as n from public.player_cosmetics pc join public.cosmetics c on c.key = pc.cosmetic_key where pc.user_id = $1 and c.season = $2`, [annId, key])).n);
  if (seasonal > 0) {
    await ann.getByRole('tab', { name: /Avatars/ }).click();
    await ann.getByText(/^Seasonal · /).first().waitFor();
    ok(true, 'season cosmetics are marked Seasonal, with their month');
    await ann.screenshot({ path: `${SHOTS}/i-locker-seasonal.png`, fullPage: true });
  } else console.log('SKIP seasonal tag: no season is running this month');

  ok(ann.errors.length === 0 && ben.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...ben.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
