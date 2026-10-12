// Stage 9, part 2: missions, the season track, the inbox and inviting a friend to your table.
const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', m); };
const q = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const bal = async (email) => Number((await q(`select w.balance from public.wallets w join auth.users u on u.id = w.user_id where u.email = $1`, [email])).balance);
const uid = async (email) => (await q(`select id from auth.users where email = $1`, [email])).id;
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const nudge = (page) => page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

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

(async () => {
  await pool.query('delete from tests.dice; delete from tests.decks;');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const A = 'ann@allin.test';
  const annId = await uid(A);
  const benId = await uid('ben@allin.test');

  // ---- Missions on the lounge -------------------------------------------------
  await ann.getByRole('heading', { name: "Today's missions" }).waitFor();
  ok((await ann.getByRole('region', { name: "Today's missions" }).getByRole('progressbar').count()) === 3, 'the lounge shows three daily missions');
  // Three easy ones, so one slot spin finishes them all.
  await pool.query(`update public.player_missions set kind = (array['rounds','category','wager'])[slot], param = (array[null,'slots',null])[slot], goal = (array[1,1,10])[slot],
                           key = 'test_' || slot, reward_chips = 300, reward_xp = 40, reward_points = 10
                     where user_id = $1 and period = 'daily'`, [annId]);
  await ann.goto(`${BASE}/play/slots_classic`);
  await ann.getByRole('button', { name: 'Spin' }).waitFor();
  for (const [i, syms] of [['BLANK', 'BLANK', 'BLANK'], ['BLANK', 'BLANK', 'BLANK'], ['BLANK', 'BLANK', 'BLANK']].entries()) {
    await pool.query('select tests.slot_reel($1, $2, variadic $3::text[])', ['slots_classic', i, syms]);
  }
  await ann.getByRole('button', { name: 'Spin' }).click();
  await ann.getByText('No win this time.').waitFor({ timeout: 15000 });
  const before = await bal(A);
  await ann.getByRole('button', { name: '← Lounge' }).click();
  await ann.waitForURL('**/lounge');
  await ann.getByRole('link', { name: 'Collect 3 rewards' }).waitFor({ timeout: 8000 });
  ok(true, 'one spin finished all three; the lounge offers the rewards');
  await ann.screenshot({ path: `${SHOTS}/l-lounge.png`, fullPage: true });
  await ann.getByRole('link', { name: 'Collect 3 rewards' }).click();
  await ann.waitForURL('**/missions');
  await ann.getByRole('heading', { name: 'Missions' }).waitFor();
  const season = await ann.locator('#season-h').waitFor({ timeout: 3000 }).then(() => true, () => false);
  await ann.getByRole('button', { name: 'Collect 3 rewards' }).click();
  await ann.getByText('Mission rewards collected').waitFor();
  ok((await bal(A)) === before + 900, 'mission rewards: 900 chips');
  await ann.getByText('Collected ✓').nth(2).waitFor({ timeout: 5000 });
  ok(true, 'the missions show as collected');

  // ---- The season track --------------------------------------------------------
  if (season) {
    const key = (await q(`select to_char(now() at time zone 'utc', 'YYYY-MM') as k`)).k;
    ok(Number((await q(`select points from public.player_seasons where user_id = $1 and season = $2`, [annId, key])).points) === 30, 'and 30 season points');
    ok(Number((await q(`select count(*) as n from public.cosmetics where season is not null and season <> $1`, [key])).n) === 0, 'no other month exists in the catalogue');
    await pool.query(`update public.player_seasons set points = 400 where user_id = $1 and season = $2`, [annId, key]);
    await ann.reload();
    const b2 = await bal(A);
    await ann.getByRole('button', { name: 'Collect 5 season rewards' }).click();
    await ann.getByText('Season rewards collected').waitFor();
    ok((await bal(A)) === b2 + 3000, 'five season steps: 3,000 chips');
    ok(Number((await q(`select count(*) as n from public.player_cosmetics where user_id = $1 and cosmetic_key like 's____\\_%'`, [annId])).n) === 2, 'and the season title and avatar');
    await ann.waitForTimeout(500);
    await ann.screenshot({ path: `${SHOTS}/l-missions.png`, fullPage: true });
    await ann.goto(`${BASE}/locker`);
    await ann.getByRole('heading', { name: 'Locker' }).waitFor();
    ok((await ann.getByRole('button', { name: /Jack-o|Turkey|Snowman|Party Popper|Cupid|Clover|Blossom|Cowboy|Sunglasses|Fireworks|Palm|Owl|Ghost/ }).count()) >= 1, 'the season avatar is in the locker');
    await ann.screenshot({ path: `${SHOTS}/l-locker.png`, fullPage: true });
  } else {
    console.log('SKIP season checks: no season is running this month');
  }

  // ---- Inbox and a table invite -------------------------------------------------
  await pool.query(`insert into public.friendships (requester, addressee, status) values ($1, $2, 'accepted')`, [benId, annId]);
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 800 });
  const client = await pool.connect();
  await client.query('begin');
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [annId]);
  const tableId = (await client.query(`select public.quick_join('blackjack', 'low') ->> 'table_id' as id`)).rows[0].id;
  await client.query('commit');
  client.release();
  await ann.goto(`${BASE}/table/${tableId}`);
  await ann.getByRole('button', { name: 'Invite', exact: true }).click();
  await ann.getByRole('dialog', { name: 'Invite friends' }).waitFor();
  await ann.screenshot({ path: `${SHOTS}/l-invite.png` });
  await ann.getByRole('dialog').getByRole('button', { name: 'Invite', exact: true }).click();
  await ann.getByText('Invite sent to Ben').waitFor();
  await nudge(ben);
  await ben.getByText('Ann invited you to their table').waitFor({ timeout: 8000 });
  ok(true, 'the friend gets a pop-up with the invite');
  await ben.screenshot({ path: `${SHOTS}/l-invite-toast-phone.png` });
  await ben.getByRole('link', { name: 'Join', exact: true }).click();
  await ben.waitForURL(`**/table/${tableId}`);
  ok(true, 'Join takes them to that table');
  await ben.goto(`${BASE}/inbox`);
  await ben.getByRole('heading', { name: 'Inbox' }).waitFor();
  await ben.getByText('Ann invited you to their table').waitFor();
  ok((await ben.getByText('Ann accepted your friend request').count()) === 1, 'the inbox lists the invite and the friend answer');
  ok(await fits(ben), 'phone: the inbox fits 390px');
  await ben.screenshot({ path: `${SHOTS}/l-inbox-phone.png`, fullPage: true });
  await ben.getByRole('button', { name: 'Mark all read' }).click();
  await ben.getByRole('button', { name: 'Mark all read' }).waitFor({ state: 'detached' });
  await ben.waitForTimeout(600);
  ok(Number((await q(`select count(*) as n from public.notifications where user_id = $1 and read_at is null`, [benId])).n) === 0, 'mark all read');
  await ben.goto(`${BASE}/missions`);
  await ben.getByRole('heading', { name: 'Missions' }).waitFor();
  ok(await fits(ben), 'phone: the missions page fits 390px');
  await ben.screenshot({ path: `${SHOTS}/l-missions-phone.png`, fullPage: true });
  // The bell on a wide screen
  await ann.goto(`${BASE}/lounge`);
  ok((await ann.getByRole('link', { name: /^Inbox/ }).count()) >= 1, 'the top bar has the inbox bell');

  ok(ann.errors.length === 0 && ben.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...ben.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
