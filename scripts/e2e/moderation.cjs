// Stage 9, part 1: the hidden admin page, reports, blocks, timeouts, forced renames, bans and chip changes.
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
  // In production the admin is the account called Carter; here Ann is made the admin.
  await pool.query(`delete from public.admins; insert into public.admins (user_id) select id from auth.users where email = 'ann@allin.test'; delete from public.admin_log; update public.site_notice set message = null; update public.site_status set maintenance = false, message = null`);
  const browser = await chromium.launch();

  // Nobody else gets in, signed in or not.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(BASE + '/admin');
  await guest.getByRole('heading', { name: 'Access not allowed' }).waitFor();
  ok(true, 'signed out: Access not allowed');
  const ben = await login(browser, 'ben@allin.test', { width: 1280, height: 900 });
  await ben.goto(BASE + '/admin');
  await ben.getByRole('heading', { name: 'Access not allowed' }).waitFor();
  ok((await ben.getByRole('tab').count()) === 0, 'another player: Access not allowed, nothing else on the page');
  await ben.goto(BASE + '/lounge');
  ok((await ben.locator('a[href$="/admin"]').count()) === 0, 'no link leads to the admin page');

  // The profile page: the row of links replaces the old buttons.
  await ben.goto(BASE + '/profile');
  await ben.getByRole('navigation', { name: 'Your pages' }).waitFor();
  const links = await ben.getByRole('navigation', { name: 'Your pages' }).getByRole('link').allInnerTexts();
  ok(links.join(',') === 'Profile,Locker,Friends,Clubs,Leaderboards', `profile links (${links})`);
  ok((await ben.getByRole('link', { name: 'Open locker' }).count()) === 0, 'the old Leaderboards / Friends / Open locker buttons are gone');

  // Ben reports and blocks Cat.
  await ben.goto(BASE + '/profile/Cat');
  await ben.getByRole('button', { name: 'Report' }).click();
  await ben.getByRole('dialog', { name: 'Report Cat' }).waitFor();
  await ben.getByLabel('Harassment').check();
  await ben.getByLabel(/Anything the moderator should know/).fill('Kept spamming emotes');
  await ben.screenshot({ path: `${SHOTS}/a-report.png` });
  await ben.getByRole('button', { name: 'Send report' }).click();
  await ben.getByText('Report sent').waitFor();
  ok(Number((await q(`select count(*) as n from public.player_reports`)).n) === 1, 'the report is stored');
  await ben.getByRole('button', { name: 'Block', exact: true }).click();
  await ben.getByRole('button', { name: 'Blocked · Unblock' }).waitFor();
  await ben.goto(BASE + '/friends');
  await ben.getByRole('heading', { name: 'Blocked players' }).waitFor();
  ok(true, 'blocked players are listed on the Friends page');

  // The admin.
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const cat = await login(browser, 'cat@allin.test', { width: 390, height: 800 });
  await ann.goto(BASE + '/admin');
  await ann.getByRole('heading', { name: 'Admin' }).waitFor();
  await ann.getByText('Kept spamming emotes').waitFor();
  await ann.screenshot({ path: `${SHOTS}/a-reports.png` });
  await ann.getByRole('button', { name: 'Open player' }).click();
  await ann.getByRole('heading', { name: 'Cat' }).waitFor();
  ok(await ann.getByText('cat@allin.test').first().isVisible(), 'the admin sees the player, with email');
  await ann.screenshot({ path: `${SHOTS}/a-player.png`, fullPage: true });

  // Timeout
  await ann.getByLabel('Reason (the player sees this)', { exact: true }).fill('Cool off');
  await ann.getByRole('button', { name: 'Timeout 1 hour' }).click();
  await ann.getByText(/In a timeout until/).waitFor();
  await nudge(cat);
  await cat.getByRole('heading', { name: "You're in a timeout" }).waitFor();
  ok(await cat.getByText('Cool off').isVisible(), 'the player sees the timeout and its reason');
  ok(await fits(cat), 'phone: the timeout screen fits');
  await cat.screenshot({ path: `${SHOTS}/a-timeout-phone.png` });
  await ann.getByRole('button', { name: 'End timeout' }).click();
  await ann.getByText('Timeout ended').waitFor();
  await nudge(cat);
  await cat.getByRole('heading', { name: 'Cat', exact: true }).waitFor();
  ok(true, 'ending the timeout lets them back in');

  // Forced rename
  await ann.getByRole('button', { name: 'Force a name change' }).click();
  await ann.getByRole('heading', { name: /^Player_/ }).waitFor();
  await nudge(cat);
  await cat.getByRole('heading', { name: 'Choose a new username' }).waitFor();
  await cat.getByLabel('New username').fill('Ben');
  await cat.getByRole('button', { name: 'Save username' }).click();
  await cat.getByText('That username is taken.').waitFor();
  await cat.screenshot({ path: `${SHOTS}/a-rename-phone.png` });
  await cat.getByLabel('New username').fill('cat');
  await cat.getByRole('button', { name: 'Save username' }).click();
  await cat.getByText('That is the name a moderator removed. Choose a different one.').waitFor();
  ok(true, 'the name that was taken away cannot be chosen again');
  await cat.getByLabel('New username').fill('Kitty');
  await cat.getByRole('button', { name: 'Save username' }).click();
  await cat.getByRole('heading', { name: 'Kitty', exact: true }).waitFor();
  ok((await q(`select username from public.profiles p join auth.users u on u.id = p.id where u.email = 'cat@allin.test'`)).username === 'Kitty', 'forced rename: old name gone, new one chosen');

  // Chips
  const before = await bal('cat@allin.test');
  await ann.getByLabel('Amount').fill('2500');
  await ann.getByRole('button', { name: 'Add', exact: true }).click();
  await ann.getByText('Added 2,500 chips').waitFor();
  ok((await bal('cat@allin.test')) === before + 2500, 'chips added');
  await ann.getByLabel('Amount').fill('777');
  await ann.getByRole('button', { name: 'Set balance to this' }).click();
  await ann.getByText('Balance set to 777').waitFor();
  ok((await bal('cat@allin.test')) === 777, 'balance set');

  // Ban and unban
  await ann.getByLabel('Reason (the player sees this)', { exact: true }).fill('Testing the ban');
  await ann.getByRole('button', { name: 'Ban', exact: true }).click();
  await ann.getByRole('button', { name: 'Unban' }).waitFor();
  await nudge(cat);
  await cat.getByRole('heading', { name: 'Account suspended' }).waitFor();
  ok(await cat.getByText('Testing the ban').isVisible(), 'a banned player sees only the suspension screen');
  await cat.goto(BASE + '/play/slots_classic');
  await cat.getByRole('heading', { name: 'Account suspended' }).waitFor();
  ok(true, 'every page is closed to them');
  await cat.screenshot({ path: `${SHOTS}/a-banned-phone.png` });
  await ann.getByRole('button', { name: 'Unban' }).click();
  await ann.getByRole('button', { name: 'Ban', exact: true }).waitFor();

  // Notice and overview
  await ann.getByRole('tab', { name: 'overview' }).click();
  await ann.getByLabel('Notice', { exact: true }).fill('Tournament night at 8');
  await ann.getByRole('button', { name: 'Save' }).click();
  await ann.getByText('Notice is up').waitFor();
  await nudge(ben);
  await ben.getByRole('status').filter({ hasText: 'Tournament night at 8' }).waitFor();
  ok(true, 'the site notice reaches other players');
  await ann.screenshot({ path: `${SHOTS}/a-overview.png`, fullPage: true });
  await ann.getByRole('button', { name: 'Take down' }).click();
  await ann.getByText('Notice taken down').waitFor();

  // ---- Site maintenance ---------------------------------------------------------
  await ann.getByLabel('Message for players (optional)').fill('Back at nine');
  await ann.getByRole('button', { name: 'Close the site for maintenance' }).click();
  await ann.getByText('The site is closed for maintenance', { exact: true }).waitFor();
  await ann.getByText(/Maintenance mode is ON/).waitFor({ timeout: 8000 }).catch(() => nudge(ann));
  await nudge(ann);
  await ann.getByText(/Maintenance mode is ON/).waitFor();
  await ann.screenshot({ path: `${SHOTS}/a-maintenance-admin.png`, fullPage: true });
  await nudge(ben);
  await ben.getByRole('heading', { name: 'Site maintenance' }).waitFor({ timeout: 8000 });
  ok(await ben.getByText('Back at nine').isVisible() && (await ben.getByRole('navigation').count()) === 0, 'maintenance: a signed-in player sees only the maintenance page, with the message');
  await ben.screenshot({ path: `${SHOTS}/a-maintenance.png` });
  await ben.goto(BASE + '/play/slots_classic');
  await ben.getByRole('heading', { name: 'Site maintenance' }).waitFor();
  const visitor = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  await visitor.goto(BASE + '/login');
  await visitor.getByRole('heading', { name: 'Site maintenance' }).waitFor();
  ok((await visitor.getByLabel('Email').count()) === 0, 'a signed-out visitor sees it too, and cannot reach the login form');
  await visitor.screenshot({ path: `${SHOTS}/a-maintenance-phone.png` });
  await ann.goto(BASE + '/play/slots_classic');
  await ann.getByRole('button', { name: 'Spin' }).click();
  await ann.getByText(/No win this time|You win|Big win/).first().waitFor({ timeout: 15000 });
  ok(true, 'the admin keeps full access while it is on');
  await ann.goto(BASE + '/admin');
  await ann.getByRole('tab', { name: 'overview' }).click();
  await ann.getByRole('button', { name: 'Open the site' }).click();
  await ann.getByText('The site is open again').waitFor();
  await nudge(ben);
  await ben.getByRole('button', { name: 'Spin' }).waitFor({ timeout: 8000 });
  ok(true, 'opening the site lets everyone back in without a reload');

  ok(ann.errors.length === 0 && ben.errors.length === 0 && cat.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...ben.errors, ...cat.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
