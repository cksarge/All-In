// Stage 9, part 3: clubs, head-to-head, the big-win ticker and personal records.
const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', m); };
const q = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const uid = async (email) => (await q(`select id from auth.users where email = $1`, [email])).id;
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

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
  await pool.query('delete from public.clubs; delete from public.big_wins; delete from public.head_to_head;');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 800 });
  const annId = await uid('ann@allin.test');
  const benId = await uid('ben@allin.test');

  // ---- Clubs --------------------------------------------------------------------
  await ann.getByRole('button', { name: 'Account menu' }).click();
  await ann.getByRole('menuitem', { name: 'Clubs' }).click();
  await ann.waitForURL('**/clubs');
  await ann.getByRole('heading', { name: 'Start a club' }).waitFor();
  await ann.getByLabel('Name', { exact: true }).fill('Night Owls');
  await ann.getByLabel('Tag', { exact: true }).fill('owl');
  await ann.getByRole('radio', { name: 'crown' }).click();
  await ann.screenshot({ path: `${SHOTS}/c-browse.png`, fullPage: true });
  await ann.getByRole('button', { name: 'Create club' }).click();
  await ann.getByRole('heading', { name: /Night Owls/ }).waitFor();
  ok(await ann.getByText('1 of 50 members').isVisible(), 'a club is created and its page opens');
  ok((await ann.getByLabel('Invite code, hidden').count()) === 1, 'the invite code is hidden until asked for');
  await ann.getByRole('button', { name: 'Show', exact: true }).click();
  ok(/^[A-Z0-9]{6}$/.test(await ann.getByLabel(/^Invite code [A-Z0-9]{6}$/).innerText()), 'Show reveals it, like a password field');
  await ann.getByRole('button', { name: 'Hide', exact: true }).click();
  await ann.getByLabel('Members can see the invite code').click();
  await ann.getByText('Only you can see the invite code').waitFor();

  await ben.goto(BASE + '/clubs');
  await ben.getByRole('link', { name: /Night Owls/ }).waitFor();
  await ben.screenshot({ path: `${SHOTS}/c-browse-phone.png`, fullPage: true });
  await ben.getByRole('button', { name: 'Join', exact: true }).click();
  await ben.getByRole('heading', { name: /Night Owls/ }).waitFor();
  await ben.getByText('2 of 50 members').waitFor();
  ok(true, 'another player joins from the list');
  ok(await ben.getByText(/Only the owner can see this club/).isVisible(), 'the owner can keep the code from members');
  ok(await fits(ben), 'phone: the club page fits 390px');
  await ben.screenshot({ path: `${SHOTS}/c-club-phone.png`, fullPage: true });

  await ann.reload();
  await ann.getByRole('button', { name: 'Make officer' }).click();
  await ann.getByText('Ben is now an officer').waitFor();
  ok((await q(`select role from public.club_members where user_id = $1`, [benId])).role === 'officer', 'the owner can make an officer');
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/c-club.png`, fullPage: true });

  // ---- Head to head, the ticker and records ---------------------------------------
  const table = (await q(`select id from public.game_tables where game_key = 'poker_holdem' and persistent limit 1`)).id;
  const hand = '00000000-0000-0000-0000-0000000e2e01';
  await pool.query(`select private.record_round($1, 'poker_holdem', $3, $4, 200, 500, '{}'), private.record_round($2, 'poker_holdem', $3, $4, 200, 0, '{}')`, [annId, benId, table, hand]);
  await pool.query(`select private.record_round($1, 'slots_classic', null, gen_random_uuid(), 100, 15000, '{}')`, [annId]);
  // (record_round alone moves no chips: give the balance chart something to draw.)
  for (const d of [-100, 15000, -500, 250]) await pool.query(`select private.apply_chips($1, $2, $3, 'slots_classic')`, [annId, d, d < 0 ? 'bet' : 'payout']);

  await ben.goto(BASE + '/lounge');
  await ben.getByRole('region', { name: 'Recent big wins' }).waitFor();
  const strip = await ben.getByRole('region', { name: 'Recent big wins' }).innerText();
  ok(/Ann/.test(strip) && strip.includes('15,000') && /Lucky Sevens/.test(strip), `the lounge ticker shows the big win (${strip.replace(/\s+/g, ' ')})`);
  ok(await fits(ben), 'phone: the lounge still fits with the ticker');
  await ben.screenshot({ path: `${SHOTS}/c-ticker-phone.png` });

  await ann.goto(BASE + '/profile/Ben');
  await ann.getByRole('heading', { name: 'You against Ben' }).waitFor();
  ok(await ann.getByLabel('You 1, Ben 0').isVisible(), 'head to head on their profile: 1 to 0 in poker hands');
  ok(await ann.getByText(/Member of/).isVisible(), 'their club shows on the profile');
  await ann.screenshot({ path: `${SHOTS}/c-versus.png`, fullPage: true });
  await ann.goto(BASE + '/profile');
  await ann.getByRole('heading', { name: 'Personal records' }).waitFor();
  ok(await ann.getByText('×150 the bet').isVisible() && (await ann.getByRole('heading', { name: 'Rivals' }).count()) === 1, 'your own profile: records and rivals');
  ok((await ann.getByRole('img', { name: /Your balance over your last/ }).count()) === 1, 'and the chart of your balance');
  await ann.screenshot({ path: `${SHOTS}/c-records.png`, fullPage: true });
  await ben.goto(BASE + '/profile');
  await ben.getByRole('heading', { name: 'Personal records' }).waitFor();
  ok(await fits(ben), 'phone: the profile with records fits 390px');
  await ben.screenshot({ path: `${SHOTS}/c-records-phone.png`, fullPage: true });

  // Leaving
  await ben.goto(BASE + '/clubs');
  await ben.getByRole('button', { name: 'Leave club' }).click();
  await ben.getByRole('heading', { name: 'Start a club' }).waitFor();
  ok(Number((await q(`select count(*) as n from public.club_members`)).n) === 1, 'leaving the club');

  ok(ann.errors.length === 0 && ben.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...ben.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
