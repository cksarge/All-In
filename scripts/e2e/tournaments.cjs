// Stage 8: the Tournaments page, a Daily Freeroll, a Slot Showdown and a heads-up Sit & Go.
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
// The stand-in has no realtime: this makes a page refetch now.
const nudge = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
const reel = (i, ...syms) => pool.query('select tests.slot_reel($1, $2, variadic $3::text[])', ['slots_classic', i, syms]);

async function login(browser, email, vp, guides = false) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  // First-visit game guides off, so they don't cover the game under test.
  if (!guides) await page.addInitScript(() => { if (!localStorage.getItem('allin-settings')) localStorage.setItem('allin-settings', JSON.stringify({ state: { soundOn: true, motion: 'system', tourSeen: false, tipsOn: false, tipsSeen: {} }, version: 1 })); });
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

(async () => {
  await pool.query('delete from tests.dice; delete from tests.decks;');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 }, true);
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 800 });
  const A = 'ann@allin.test';
  const B = 'ben@allin.test';

  // ---- The hub ----------------------------------------------------------------
  await ann.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tournaments' }).click();
  await ann.waitForURL('**/tournaments');
  await ann.getByRole('heading', { name: 'Daily Freeroll' }).waitFor();
  await ann.getByRole('dialog', { name: 'Tournaments in a minute' }).waitFor();
  await ann.screenshot({ path: `${SHOTS}/t-guide.png` });
  await ann.getByRole('button', { name: 'Got it' }).click();
  ok(true, 'first visit: a short guide, dismissed with Got it');
  ok((await ann.getByRole('heading', { name: /stakes$/ }).count()) === 3, 'three Slot Showdowns are open');
  ok((await ann.getByRole('button', { name: 'Take a seat' }).count()) === 6 && (await ann.getByRole('heading', { name: /^(Heads-up|\d players)$/ }).count()) === 9, 'nine Sit & Go games, six within reach of a new player');
  // Every round on the three-reel machine, so the reels can be rigged.
  await pool.query(`update public.tournaments set machine = 'slots_classic'`);
  await ann.reload();
  await ann.getByRole('heading', { name: 'Daily Freeroll' }).waitFor();
  await ann.waitForTimeout(1200);
  ok((await ann.getByRole('dialog').count()) === 0, 'the guide is only shown once');
  await ann.screenshot({ path: `${SHOTS}/t-hub.png`, fullPage: true });
  await ann.getByRole('button', { name: 'How it works' }).click();
  await ann.getByRole('dialog', { name: 'How tournaments work' }).waitFor();
  await ann.screenshot({ path: `${SHOTS}/t-rules.png` });
  await ann.keyboard.press('Escape');

  // ---- Daily Freeroll ---------------------------------------------------------
  await ann.getByRole('button', { name: 'Enter free' }).click();
  await ann.waitForURL(/\/tournaments\/[0-9a-f-]{36}$/);
  await ann.getByRole('button', { name: 'Spin' }).waitFor();
  ok((await bal(A)) === 10000, 'the freeroll is free');
  ok((await ann.getByTestId('showdown-spins').innerText()) === '50', '50 spins to play');
  await reel(0, 'BLANK', 'SEVEN', 'BAR1'); await reel(1, 'BELL', 'SEVEN', 'BLANK'); await reel(2, 'CHERRY', 'SEVEN', 'BAR3');
  await ann.getByRole('button', { name: 'Spin' }).click();
  await ann.getByText('+15,000 points').waitFor({ timeout: 15000 });
  ok((await ann.getByTestId('showdown-score').innerText()) === '15,000', 'three sevens: 15,000 points');
  ok((await ann.getByTestId('showdown-spins').innerText()) === '49', 'one spin used');
  ok((await bal(A)) === 10000, 'tournament spins move no chips');
  await ann.waitForTimeout(500);
  await ann.screenshot({ path: `${SHOTS}/t-freeroll.png` });

  // ---- Slot Showdown: two players, winner takes the pot -----------------------
  await ann.getByRole('button', { name: '← Tournaments' }).click();
  await ann.getByRole('link', { name: /Play your spins \(49\)/ }).waitFor();
  const low = ann.getByRole('listitem').filter({ has: ann.getByRole('heading', { name: 'Low stakes' }) });
  await low.getByRole('button', { name: 'Enter', exact: true }).click();
  await ann.waitForURL(/\/tournaments\/[0-9a-f-]{36}$/);
  await ann.getByRole('button', { name: 'Spin' }).waitFor();
  ok((await bal(A)) === 9800, 'showdown entry taken');
  const sd = ann.url().split('/').pop();
  await ben.goto(`${BASE}/tournaments/${sd}`);
  await ben.getByRole('button', { name: /^Enter · 200$/ }).click();
  await ben.getByRole('button', { name: 'Spin' }).waitFor();
  ok(await fits(ben), 'phone: the showdown fits 390px');
  await reel(0, 'BLANK', 'CHERRY', 'BLANK'); await reel(1, 'BLANK', 'BLANK', 'BLANK'); await reel(2, 'BLANK', 'BAR1', 'BLANK');
  await ann.getByRole('button', { name: 'Spin' }).click();
  await ann.getByText('+100 points').waitFor({ timeout: 15000 });
  await reel(0, 'BLANK', 'BLANK', 'BLANK'); await reel(1, 'BLANK', 'BLANK', 'BLANK'); await reel(2, 'BLANK', 'BLANK', 'BLANK');
  await ben.getByRole('button', { name: 'Spin' }).click();
  await ben.getByText('No points that spin.').waitFor({ timeout: 15000 });
  await ben.screenshot({ path: `${SHOTS}/t-showdown-phone.png`, fullPage: true });
  await nudge(ann);
  await ann.getByText('2 in').waitFor();
  // Time's up.
  await pool.query(`update public.tournaments set ends_at = now() - interval '1 second', starts_at = starts_at - interval '7 days' where id = $1`, [sd]);
  await nudge(ann);
  await ann.getByText(/You finished/).waitFor({ timeout: 8000 });
  ok(await ann.getByText(/You finished 1st of 2/).isVisible(), 'the round is settled: first of two');
  ok((await bal(A)) === 9800 + 400 && (await bal(B)) === 9800, 'winner takes the whole pot');
  await ann.screenshot({ path: `${SHOTS}/t-showdown-final.png` });

  // ---- Sit & Go, heads-up ------------------------------------------------------
  await ann.getByRole('button', { name: 'More tournaments' }).click();
  await ann.waitForURL('**/tournaments');
  const before = await bal(A);
  await ann.getByRole('button', { name: 'Take a seat' }).first().click();
  await ann.getByText('Waiting: Ann').waitFor();
  ok((await bal(A)) === before - 250, 'Sit & Go entry taken');
  await ann.getByRole('button', { name: 'Give up seat' }).click();
  await ann.getByText('Seat given up').waitFor();
  ok((await bal(A)) === before, 'giving up the seat returns the entry');
  await ann.getByRole('button', { name: 'Take a seat' }).first().click();
  await ann.getByText('Waiting: Ann').waitFor();

  await ben.goto(`${BASE}/tournaments`);
  await ben.getByText('Waiting: Ann').waitFor();
  ok(await fits(ben), 'phone: the tournaments page fits 390px');
  await ben.screenshot({ path: `${SHOTS}/t-hub-phone.png`, fullPage: true });
  await ben.getByRole('button', { name: 'Take a seat' }).first().click();
  await ben.waitForURL('**/table/**', { timeout: 10000 });
  ok(true, 'the last seat starts the game and takes that player to the table');
  await nudge(ann);
  await ann.waitForURL('**/table/**', { timeout: 10000 });
  ok(true, 'the waiting player is taken to the table too');
  await ann.getByRole('region', { name: 'Tournament' }).waitFor();
  await ann.getByRole('dialog', { name: /Hold'em in a minute/ }).waitFor();
  await ann.getByRole('button', { name: 'Got it' }).click();
  const strip = await ann.getByRole('region', { name: 'Tournament' }).innerText();
  ok(/Level 1/i.test(strip) && strip.includes('10 / 20') && strip.includes('2 of 2') && strip.includes('500'), `tournament strip: level, blinds, players, prize (${strip.replace(/\s+/g, ' ')})`);
  ok((await ann.getByRole('button', { name: 'Sit out' }).count()) === 0 && (await ann.getByRole('button', { name: /Top up|Bring chips/ }).count()) === 0, 'no sit out or top up at a tournament table');
  ok((await bal(A)) === before - 250 && (await bal(B)) === 9800 - 250, 'tournament chips are not wallet chips');
  await ann.waitForTimeout(800);
  await ann.screenshot({ path: `${SHOTS}/t-sng-table.png` });
  await ben.getByRole('region', { name: 'Tournament' }).waitFor();
  ok(await fits(ben), 'phone: the tournament table fits 390px');
  await ben.screenshot({ path: `${SHOTS}/t-sng-table-phone.png`, fullPage: true });

  // Looking away keeps the seat.
  await ann.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Lounge' }).click();
  await ann.waitForURL('**/lounge');
  await ann.getByText(/Your tournament/).waitFor({ timeout: 5000 });
  ok(Number((await q(`select count(*) as n from public.table_seats s join auth.users u on u.id = s.user_id where u.email = $1`, [A])).n) === 1, 'leaving the page keeps a tournament seat');
  await ann.getByRole('link', { name: 'Return to your table' }).click();
  await ann.waitForURL('**/table/**');

  // Ben gives up: Ann wins.
  await ben.getByRole('button', { name: /Leave tournament/ }).click();
  await ben.getByRole('dialog', { name: 'Leave the tournament?' }).waitFor();
  await ben.screenshot({ path: `${SHOTS}/t-sng-leave-phone.png` });
  await ben.getByRole('button', { name: 'Leave and forfeit' }).click();
  await ben.waitForURL('**/tournaments');
  await nudge(ann);
  await ann.getByRole('dialog', { name: 'You won the tournament!' }).waitFor({ timeout: 20000 });
  ok(true, 'the last player standing is told they won');
  ok((await bal(A)) === before + 250 && (await bal(B)) === 9800 - 250, 'the winner gets both entries');
  await ann.waitForTimeout(600);
  await ann.screenshot({ path: `${SHOTS}/t-sng-won.png` });
  await ann.getByRole('link', { name: 'Play another' }).click();
  await ann.waitForURL('**/tournaments');
  await ann.getByText('Sit & Go · Heads-up').waitFor();
  ok(await ann.getByText(/1st of 2/).first().isVisible(), 'the result is listed');
  await ben.reload();
  await ben.getByText('Sit & Go · Heads-up').waitFor();
  ok(await ben.getByText(/2nd of 2/).first().isVisible(), 'and the runner-up sees theirs');

  // ---- Achievements -----------------------------------------------------------
  await ann.goto(`${BASE}/profile`);
  await ann.getByRole('heading', { name: 'Achievements' }).waitFor();
  const got = (await pool.query(`select pa.achievement_key from public.player_achievements pa join auth.users u on u.id = pa.user_id where u.email = $1`, [A])).rows.map((r) => r.achievement_key);
  ok(['tourney_first', 'tourney_win', 'sng_win', 'showdown_win'].every((k) => got.includes(k)), 'tournament achievements unlocked');
  await ann.getByText('Last One Standing').first().scrollIntoViewIfNeeded();
  await ann.screenshot({ path: `${SHOTS}/t-achievements.png` });

  ok(ann.errors.length === 0 && ben.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...ben.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
