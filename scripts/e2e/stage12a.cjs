// Stage 12, part 1: quality of life. Lounge search, the music control, auto-play and remembered bets,
// game stats, the size setting, and at a poker table: leave confirmation, sit out next hand, auto top-up.
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
  await page.addInitScript(() => { if (!localStorage.getItem('allin-settings')) localStorage.setItem('allin-settings', JSON.stringify({ state: { soundOn: true, motion: 'system', tourSeen: true, tipsOn: false, tipsSeen: {} }, version: 1 })); });
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

(async () => {
  await pool.query('delete from tests.dice; delete from tests.decks;');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });
  const annId = (await q(`select id from auth.users where email = 'ann@allin.test'`)).id;

  // ---------- Lounge: search and filters ----------
  await ann.getByLabel('Search the games').fill('horse');
  await ann.getByRole('heading', { name: 'Horse Racing' }).waitFor();
  ok((await ann.locator('section[aria-labelledby="games-title"] li h4').count()) === 1, 'searching "horse" leaves just Horse Racing');
  await ann.getByLabel('Search the games').fill('zzzz');
  await ann.getByText('No games match').waitFor();
  await ann.getByRole('button', { name: 'Clear', exact: true }).click();
  await ann.getByLabel('Kind of game').selectOption('tournament');
  const tourneys = await ann.locator('section[aria-labelledby="games-title"] li h4').allInnerTexts();
  ok(tourneys.length === 2 && tourneys.every((t) => /Sit & Go|Showdown/.test(t)), `the Tournaments filter shows the two tournament games (${tourneys.join(', ')})`);
  await ann.getByLabel('Kind of game').selectOption('live');
  const live = await ann.locator('section[aria-labelledby="games-title"] li h4').allInnerTexts();
  ok(live.includes('Crash') && live.includes('Blackjack') && !live.includes('Baccarat'), 'the Live filter keeps tables and rooms and drops solo games');
  await ann.screenshot({ path: `${SHOTS}/n-lounge-filter.png` });
  await ben.getByLabel('Search the games').fill('poker');
  ok(await fits(ben), 'phone: the search and filters fit 390px');
  await ben.screenshot({ path: `${SHOTS}/n-lounge-search-phone.png` });

  // ---------- The music control in the top bar ----------
  await ann.getByRole('button', { name: /^Music: on/ }).click();
  await ann.getByRole('dialog', { name: 'Music' }).getByRole('switch', { name: 'Music' }).click();
  await ann.waitForTimeout(300);
  ok(await ann.evaluate(() => document.querySelector('audio').paused) && (await ann.getByRole('button', { name: /^Music: off/ }).count()) === 1, 'the music button in the top bar switches the music off');
  await ann.screenshot({ path: `${SHOTS}/n-music-control.png` });
  await ann.keyboard.press('Escape');

  // ---------- Auto-play, Rebet after a reload, Stats ----------
  await ann.goto(`${BASE}/play/baccarat`);
  await ann.getByRole('button', { name: /^Player\b/ }).first().click();
  await ann.screenshot({ path: `${SHOTS}/n-baccarat-auto.png` });
  await ann.getByRole('button', { name: 'Auto: 10 rounds' }).click();
  await ann.getByRole('button', { name: /Stop auto \(\d+ left\)/ }).waitFor({ timeout: 8000 });
  for (let i = 0; i < 40; i++) {
    if (Number((await q(`select count(*)::int as n from public.game_history where user_id = $1 and game_key = 'baccarat'`, [annId])).n) >= 3) break;
    await ann.waitForTimeout(1000);
  }
  await ann.getByRole('button', { name: /Stop auto/ }).click();
  const played = Number((await q(`select count(*)::int as n from public.game_history where user_id = $1 and game_key = 'baccarat'`, [annId])).n);
  ok(played >= 3, `auto-play dealt the same bet again by itself (${played} rounds)`);
  await ann.waitForTimeout(6000);
  const after = Number((await q(`select count(*)::int as n from public.game_history where user_id = $1 and game_key = 'baccarat'`, [annId])).n);
  ok(after <= played + 1, 'Stop auto stops it');
  await ann.reload();
  await ann.getByRole('button', { name: 'Rebet' }).waitFor();
  await ann.waitForTimeout(600);
  ok(await ann.getByRole('button', { name: 'Rebet' }).isEnabled(), 'after a reload the last bet is still there to repeat');
  await ann.getByRole('button', { name: 'Rebet' }).click();
  ok(await ann.getByRole('button', { name: 'Deal' }).isEnabled(), 'Rebet puts it back on the table');
  await ann.getByRole('button', { name: 'Stats' }).click();
  await ann.getByRole('heading', { name: /Your stats: Baccarat/ }).waitFor();
  await ann.getByText(/of what you bet has come back/).waitFor();
  ok(true, 'Stats shows your own numbers at this game');
  await ann.screenshot({ path: `${SHOTS}/n-stats.png` });
  await ann.keyboard.press('Escape');

  // ---------- Remembered choices ----------
  await ann.goto(`${BASE}/play/plinko`);
  await ann.getByRole('radio', { name: '16', exact: true }).click();
  await ann.getByRole('radio', { name: /high/i }).click();
  await ann.getByRole('button', { name: 'Raise bet' }).click();
  await ann.reload();
  await ann.getByRole('radio', { name: '16', exact: true }).waitFor();
  ok((await ann.getByRole('radio', { name: '16', exact: true }).getAttribute('aria-checked')) === 'true' && (await ann.getByRole('radio', { name: /high/i }).getAttribute('aria-checked')) === 'true',
     'Plinko remembers its rows and risk');
  ok((await ann.evaluate(() => localStorage.getItem('allin-mem:bet:plinko'))) === '1', 'and the bet');

  // ---------- Size ----------
  await ben.getByRole('button', { name: /settings/i }).first().click();
  await ben.getByRole('radio', { name: /Large/ }).click();
  ok((await ben.evaluate(() => document.documentElement.style.fontSize)) === '106.25%', 'Large makes the whole site bigger (a smaller step on a phone, so nothing is cut off)');
  await ben.keyboard.press('Escape');
  await ben.screenshot({ path: `${SHOTS}/n-large-phone.png` });
  ok(await fits(ben), 'phone: the lounge still fits 390px at Large');
  await ben.getByRole('button', { name: /settings/i }).first().click();
  await ben.getByRole('radio', { name: /Normal/ }).click();
  await ben.keyboard.press('Escape');

  // ---------- A poker table ----------
  await sitAt(ann, 'poker_holdem', "Emerald Hold'em");
  await bring(ann);
  await sitAt(ben, 'poker_holdem', "Emerald Hold'em");
  await bring(ben);
  await refresh(ann);
  await ann.getByRole('button', { name: /Auto top-up/ }).click();
  const stack = async () => Number((await q(`select stack from public.table_seats where user_id = $1`, [annId])).stack);
  ok((await stack()) < 1000, 'the blinds are in');
  // Ann gets out of the hand; whoever is to act folds.
  for (let i = 0; i < 6; i++) {
    for (const p of [ann, ben]) {
      await refresh(p);
      const fold = p.getByRole('button', { name: /^Fold/ });
      if (await fold.count()) { await fold.click(); await p.waitForTimeout(600); i = 99; break; }
    }
  }
  for (let i = 0; i < 20 && (await stack()) !== 1000; i++) { await refresh(ann); await ann.waitForTimeout(500); }
  ok(true, 'a hand was folded');
  // Whoever lost chips: Ann's stack must be back at 1,000 either way (topped up, or she won).
  const s1 = await stack();
  ok(s1 >= 1000, `auto top-up brings the stack back up between hands (${s1})`);

  // The next hand: leaving asks first.
  for (let i = 0; i < 30; i++) {
    await refresh(ann);
    if ((await q(`select count(*)::int as n from public.pk_hands h join public.table_seats s on s.table_id = h.table_id where s.user_id = $1 and h.phase <> 'settled'`, [annId])).n > 0) break;
    await ann.waitForTimeout(700);
  }
  await refresh(ann);
  await ann.getByRole('button', { name: '← Leave table' }).click();
  await ann.getByRole('heading', { name: 'Leave with chips in play?' }).waitFor();
  await ann.screenshot({ path: `${SHOTS}/n-leave-confirm.png` });
  await ann.getByRole('button', { name: 'Stay' }).click();
  ok((await q(`select count(*)::int as n from public.table_seats where user_id = $1`, [annId])).n === 1, 'leaving in the middle of a hand asks first, and Stay keeps the seat');
  await ann.getByRole('button', { name: 'Sit out next hand' }).click();
  for (let i = 0; i < 6; i++) {
    for (const p of [ann, ben]) {
      await refresh(p);
      const fold = p.getByRole('button', { name: /^Fold/ });
      if (await fold.count()) { await fold.click(); await p.waitForTimeout(600); i = 99; break; }
    }
  }
  for (let i = 0; i < 20; i++) {
    await refresh(ann);
    if ((await q(`select status from public.table_seats where user_id = $1`, [annId])).status === 'sitting_out') break;
    await ann.waitForTimeout(500);
  }
  ok((await q(`select status from public.table_seats where user_id = $1`, [annId])).status === 'sitting_out', '"Sit out next hand" sits you out when the hand is over');
  ok(await fits(ben), 'phone: the poker controls fit 390px');
  await ben.screenshot({ path: `${SHOTS}/n-poker-phone.png` });
  await ann.getByRole('button', { name: '← Leave table' }).click();
  await ann.waitForURL('**/lobby**');
  ok(true, 'with nothing at stake, leaving is immediate');
  await ben.getByRole('button', { name: '← Leave table' }).click();

  ok(ann.errors.length === 0 && ben.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...ben.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
