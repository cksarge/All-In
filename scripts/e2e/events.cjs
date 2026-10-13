// Stage 9, part 4: Sit & Go formats, the Main Event (multi-table), trophies, the tournament
// leaderboard, and quality of play (pre-actions, auto-spin, video poker hint, favourites).
const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', m); };
const q = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const bal = async (email) => Number((await q(`select w.balance from public.wallets w join auth.users u on u.id = w.user_id where u.email = $1`, [email])).balance);
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const nudge = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

async function login(browser, email, vp) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  await page.addInitScript(() => { if (!localStorage.getItem('allin-settings')) localStorage.setItem('allin-settings', JSON.stringify({ state: { soundOn: true, motion: 'system', tourSeen: false, tipsOn: false, tipsSeen: {} }, version: 1 })); });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.goto(BASE + '/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('abcDEF12');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/lounge');
  return page;
}

(async () => {
  await pool.query('delete from tests.dice; delete from tests.decks;');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });

  // ---- Quality of play, on your own -------------------------------------------------
  // Favourites and "jump back in"
  await ann.getByRole('button', { name: 'Add Blackjack to your favourites' }).click();
  await ann.getByRole('group', { name: 'Your favourites' }).getByRole('link', { name: 'Blackjack' }).waitFor();
  ok(true, 'starring a game puts it on the favourites shelf');

  // Video poker hint: three kings
  await pool.query(`select tests.deck('Ks Kh Kd 4c 9s 2c 3c 5d 6h 7s')`);
  await ann.goto(`${BASE}/play/video_poker_jacks`);
  await ann.getByRole('button', { name: 'Deal' }).click();
  await ann.getByRole('button', { name: 'Hint' }).click();
  await ann.getByText('Three of a kind: draw two.').waitFor();
  ok((await ann.getByRole('button', { pressed: true }).count()) === 3, 'video poker hint: holds the three kings and says why');
  await ann.screenshot({ path: `${SHOTS}/e-vp-hint.png` });
  await ann.getByRole('button', { name: 'Draw' }).click();
  await ann.getByRole('button', { name: 'Deal' }).waitFor();

  // Slot auto-spin
  await ann.goto(`${BASE}/play/slots_classic`);
  await ann.getByRole('button', { name: 'Auto: 10 rounds' }).click();
  await ann.getByRole('button', { name: /Stop auto/ }).waitFor({ timeout: 8000 });
  const before = Number((await q(`select count(*) as n from public.game_history h join auth.users u on u.id = h.user_id where u.email = 'ann@allin.test' and game_key = 'slots_classic'`)).n);
  await ann.waitForTimeout(6000);
  const after = Number((await q(`select count(*) as n from public.game_history h join auth.users u on u.id = h.user_id where u.email = 'ann@allin.test' and game_key = 'slots_classic'`)).n);
  ok(after >= before + 2, `auto-spin keeps spinning by itself (${after - before} more in six seconds)`);
  await ann.screenshot({ path: `${SHOTS}/e-autospin.png` });
  const stop = ann.getByRole('button', { name: /Stop auto/ });
  if (await stop.count()) await stop.click();
  await ann.getByRole('button', { name: 'Auto: 10 rounds' }).waitFor({ timeout: 15000 });
  ok(true, 'and stops when asked');
  await ann.getByRole('button', { name: '← Lounge' }).click();
  await ann.getByRole('group', { name: 'Jump back in' }).getByRole('link', { name: 'Lucky Sevens' }).waitFor();
  ok(true, 'the lounge offers the games you played last');
  await ann.screenshot({ path: `${SHOTS}/e-lounge-shelf.png` });

  // ---- Tournament formats and the Main Event -----------------------------------------
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 800 });
  const cat = await login(browser, 'cat@allin.test', { width: 1280, height: 900 });
  await ann.goto(`${BASE}/tournaments`);
  await ann.getByRole('heading', { name: 'Main Event' }).waitFor();
  await ann.getByRole('radio', { name: /Turbo.*fast/ }).click();
  await ann.getByText('blinds up every minute').waitFor();
  ok((await ann.getByRole('heading', { name: /^(Heads-up|\d players)$/ }).count()) === 9, 'a format picker: Turbo games with one-minute blinds');
  await ann.screenshot({ path: `${SHOTS}/e-hub.png`, fullPage: true });

  const start = await bal('ann@allin.test');
  for (const p of [ann, ben, cat]) {
    if (p !== ann) await p.goto(`${BASE}/tournaments`);
    await p.getByRole('button', { name: 'Register', exact: true }).click();
    await p.getByText('You are in the Main Event').waitFor();
  }
  ok((await bal('ann@allin.test')) === start - 1000, 'registering takes the entry');
  ok(await fits(ben), 'phone: the tournaments page with the Main Event fits 390px');
  await ben.screenshot({ path: `${SHOTS}/e-hub-phone.png`, fullPage: true });
  await ann.getByRole('button', { name: 'Take a seat' }).first().waitFor();
  ok(await ann.getByRole('button', { name: 'Take a seat' }).first().isDisabled(), 'one poker tournament at a time: Sit & Gos are closed to you meanwhile');

  // Start time arrives.
  await pool.query(`update public.tournaments set starts_at = now() - interval '1 second' where kind = 'mtt' and status = 'registering'`);
  for (const p of [ann, ben, cat]) await nudge(p);
  for (const p of [ann, ben, cat]) await p.waitForURL('**/table/**', { timeout: 15000 });
  ok(true, 'at the start time all three are taken to the table');
  await ann.getByRole('region', { name: 'Tournament' }).waitFor();
  const strip = (await ann.getByRole('region', { name: 'Tournament' }).innerText()).replace(/\s+/g, ' ');
  ok(/3 of 3/.test(strip) && /TABLES 1/i.test(strip) && strip.includes('1,950') && strip.includes('1,050'), `the event strip: players, tables, two prizes (${strip})`);
  ok((await ann.getByRole('heading', { name: /Main Event #\d+ · Table 1/ }).count()) === 1, 'the table is named for the event');
  ok(await fits(ben), 'phone: the event table fits 390px');

  // Decide before your turn: whoever is not to act has the buttons.
  let waiter = null;
  for (let i = 0; i < 20 && !waiter; i++) {
    for (const p of [ann, cat]) if (await p.getByRole('group', { name: 'Decide in advance' }).count()) waiter = p;
    if (!waiter) await ann.waitForTimeout(300);
  }
  ok(Boolean(waiter), 'a player waiting for their turn can decide in advance');
  if (waiter) {
    await waiter.getByRole('button', { name: 'Check / fold' }).click();
    ok((await waiter.getByRole('button', { name: /Check \/ fold/, pressed: true }).count()) === 1, 'Check / fold is armed');
    await waiter.screenshot({ path: `${SHOTS}/e-preaction.png` });
  }

  // Two leave: the last one standing wins the event.
  for (const p of [ben, cat]) {
    await p.getByRole('button', { name: /Leave tournament/ }).click();
    await p.getByRole('button', { name: 'Leave and forfeit' }).click();
    await p.waitForURL('**/tournaments');
  }
  await nudge(ann);
  await ann.getByRole('dialog', { name: 'You won the tournament!' }).waitFor({ timeout: 25000 });
  ok((await bal('ann@allin.test')) === start - 1000 + 1950, 'first of three takes 65% of the pot');
  ok((await bal('ben@allin.test')) === 9000 && (await bal('cat@allin.test')) === 9000 + 1050, 'second takes 35%, third nothing');
  await ann.screenshot({ path: `${SHOTS}/e-won.png` });

  // Trophies and the tournament leaderboard
  await ann.goto(`${BASE}/profile`);
  await ann.getByRole('heading', { name: 'Trophies' }).waitFor();
  ok(await ann.getByText('1st × 1').isVisible() && await ann.getByText('Main Event').first().isVisible(), 'a gold trophy on the profile');
  await ann.screenshot({ path: `${SHOTS}/e-trophies.png` });
  await ann.goto(`${BASE}/leaderboards?board=tournaments`);
  await ann.getByRole('tab', { name: 'Tournaments', selected: true }).waitFor();
  await ann.getByText('1 won').waitFor();
  ok(true, 'the tournament leaderboard ranks by tournaments won');
  await ann.screenshot({ path: `${SHOTS}/e-leaderboard.png` });

  ok(ann.errors.length === 0 && ben.errors.length === 0 && cat.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...ben.errors, ...cat.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
