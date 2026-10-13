// Two-step verification: the question after the sign-up code, the "Verify your identity" page at
// the next login, the switch in Settings (on with a code first, and off), and the admin's off switch.
const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', m); };
const q = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
// Login codes "emailed" since this run began (the stand-in counts from when it was started).
let sentBefore = 0;
const sentTotal = async () => (await (await fetch('http://localhost:54321/test/otp-sent')).json()).length;
const sent = async () => (await sentTotal()) - sentBefore;
const twoStep = async (email) => (await q(`select coalesce((select s.two_step from public.player_security s join auth.users u on u.id = s.user_id where u.email = $1), false) as on`, [email])).on;

async function open(browser, vp) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  await page.addInitScript(() => { if (!localStorage.getItem('allin-settings')) localStorage.setItem('allin-settings', JSON.stringify({ state: { soundOn: true, musicOn: false, motion: 'system', tourSeen: true, tipsOn: false, tipsSeen: {} }, version: 1 })); });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  return page;
}
// The password step only: where it lands is the test.
async function password(page, email) {
  await page.goto(BASE + '/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('abcDEF12');
  await page.getByRole('button', { name: 'Log in' }).click();
}
async function typeCode(page, code) {
  await page.getByLabel('Digit 1 of 6').click();
  await page.keyboard.type(code);
}
const balance = (page) => page.locator('header').getByText(/^\d{1,3}(,\d{3})+$/).first();

(async () => {
  sentBefore = await sentTotal();
  const browser = await chromium.launch();
  const wide = { width: 1280, height: 900 };
  const phone = { width: 390, height: 844 };

  // ---------- Straight after the sign-up code: one question before the lounge ----------
  const ann = await open(browser, wide);
  await ann.goto(BASE + '/verify');
  await ann.getByLabel('Email').fill('ann@allin.test');
  await ann.getByRole('button', { name: 'Continue' }).click();
  await typeCode(ann, '123456');
  await ann.getByRole('heading', { name: 'Secure your account?' }).waitFor();
  ok((await ann.getByRole('heading', { name: /Welcome|lounge/i }).count()) === 0 && (await ann.getByText('Jump back in').count()) === 0, 'after the sign-up code comes the question, not the lounge');
  ok((await sent()) === 0, 'no extra email is sent to ask it');
  await ann.screenshot({ path: `${SHOTS}/t-offer.png` });
  await ann.getByRole('button', { name: 'Turn on two-step verification' }).click();
  await ann.getByText('Two-step verification is on').first().waitFor();
  await balance(ann).waitFor();
  ok(await twoStep('ann@allin.test'), 'saying yes switches it on, and the lounge opens');
  await ann.reload();
  await balance(ann).waitFor();
  ok((await ann.getByRole('heading', { name: 'Secure your account?' }).count()) === 0, 'the question is asked once');

  // "Not now" leaves it off.
  const cat = await open(browser, phone);
  await cat.goto(BASE + '/verify');
  await cat.getByLabel('Email').fill('cat@allin.test');
  await cat.getByRole('button', { name: 'Continue' }).click();
  await typeCode(cat, '123456');
  await cat.getByRole('heading', { name: 'Secure your account?' }).waitFor();
  ok(await fits(cat), 'the question fits a phone');
  await cat.screenshot({ path: `${SHOTS}/t-offer-phone.png` });
  await cat.getByRole('button', { name: 'Not now' }).click();
  await balance(cat).waitFor();
  ok(!(await twoStep('cat@allin.test')), '"Not now" goes to the lounge with it off');

  // ---------- The next login: password, then the code ----------
  const ann2 = await open(browser, wide);
  await password(ann2, 'ann@allin.test');
  await ann2.getByRole('heading', { name: 'Verify your identity' }).waitFor();
  ok((await ann2.getByText('Check your email').count()) === 0, 'it is its own page, not the sign-up one');
  await ann2.waitForTimeout(600);
  ok((await sent()) === 1, 'a code is emailed by itself, once');
  ok((await balance(ann2).count()) === 0, 'nothing of the account is shown before the code');
  await ann2.screenshot({ path: `${SHOTS}/t-verify.png` });
  await ann2.goto(BASE + '/lobby');
  await ann2.getByRole('heading', { name: 'Verify your identity' }).waitFor();
  await ann2.goto(BASE + '/admin');
  await ann2.getByRole('heading', { name: 'Verify your identity' }).waitFor();
  ok((await sent()) === 1, 'other pages are closed too, and moving about sends no second email');
  await typeCode(ann2, '000000');
  await ann2.getByRole('alert').first().waitFor();
  ok((await ann2.getByRole('heading', { name: 'Verify your identity' }).count()) === 1, 'a wrong code is refused');
  await typeCode(ann2, '654321');
  await balance(ann2).waitFor();
  ok((await ann2.getByRole('heading', { name: 'Verify your identity' }).count()) === 0, 'the right code opens the site, balance and all');
  await ann2.reload();
  await balance(ann2).waitFor();
  ok((await sent()) === 1, 'staying logged in needs no new code');
  ok(ann2.errors.length === 0, 'no page errors on the way in: ' + ann2.errors.join(' | '));

  const annPhone = await open(browser, phone);
  await password(annPhone, 'ann@allin.test');
  await annPhone.getByRole('heading', { name: 'Verify your identity' }).waitFor();
  ok(await fits(annPhone), 'the page fits a phone');
  await annPhone.screenshot({ path: `${SHOTS}/t-verify-phone.png` });
  await annPhone.getByRole('button', { name: 'Log out and use a different account' }).click();
  await annPhone.waitForURL((u) => !u.pathname.includes('lounge'));
  ok((await annPhone.getByRole('heading', { name: 'Verify your identity' }).count()) === 0, 'you can log out from it');

  // ---------- Settings ----------
  await ann2.goto(BASE + '/settings');
  const sw = ann2.getByRole('switch', { name: 'Two-step verification' });
  await sw.waitFor();
  ok((await sw.getAttribute('aria-checked')) === 'true', 'Settings shows it on');
  const guides = ann2.getByRole('region', { name: 'Game guides' });
  ok((await guides.getByRole('button', { name: 'Replay welcome tour' }).count()) === 1 && (await ann2.getByRole('region', { name: 'Account' }).getByRole('button', { name: 'Replay welcome tour' }).count()) === 0, '"Replay welcome tour" is under Game guides, not Account');
  await ann2.getByRole('region', { name: 'Account' }).scrollIntoViewIfNeeded();
  await ann2.screenshot({ path: `${SHOTS}/t-settings.png` });
  await sw.click();
  await ann2.getByText('Two-step verification is off').first().waitFor();
  ok(!(await twoStep('ann@allin.test')) && (await sw.getAttribute('aria-checked')) === 'false', 'switched off in Settings');
  const ann3 = await open(browser, wide);
  await password(ann3, 'ann@allin.test');
  await ann3.waitForURL('**/lounge');
  await balance(ann3).waitFor();
  ok((await ann3.getByRole('heading', { name: 'Verify your identity' }).count()) === 0, 'with it off the password is enough again');

  // Switching it on from a password-only session asks for a code first.
  const ben = await open(browser, phone);
  await password(ben, 'ben@allin.test');
  await ben.waitForURL('**/lounge');
  await balance(ben).waitFor();
  await ben.goto(BASE + '/settings');
  const bsw = ben.getByRole('switch', { name: 'Two-step verification' });
  await bsw.waitFor();
  const before = await sent();
  await bsw.click();
  await ben.getByText(/make sure the codes reach you/).waitFor();
  await ben.waitForTimeout(600);
  ok(!(await twoStep('ben@allin.test')) && (await sent()) === before + 1, 'switching it on first emails a code, and nothing is on yet');
  await ben.getByText(/make sure the codes reach you/).scrollIntoViewIfNeeded();
  await ben.screenshot({ path: `${SHOTS}/t-settings-prove-phone.png` });
  await typeCode(ben, '111111');
  await ben.getByText('Two-step verification is on').first().waitFor();
  ok((await twoStep('ben@allin.test')) && (await bsw.getAttribute('aria-checked')) === 'true', 'the code switches it on');
  ok(await fits(ben), 'Settings fits a phone');
  await ben.keyboard.press('Escape');
  await balance(ben).waitFor();
  ok(ben.errors.length === 0, 'no page errors: ' + ben.errors.join(' | '));

  // ---------- The inbox notice for accounts that were here before ----------
  await pool.query(`select private.notify((select id from auth.users where email = 'cat@allin.test'), 'two_step_available', '{}'::jsonb)`);
  await cat.goto(BASE + '/inbox');
  await cat.getByText('New: two-step verification').waitFor();
  ok(await cat.getByRole('link', { name: 'Open settings' }).isVisible(), 'the notice says the feature is here and links to Settings');
  await cat.screenshot({ path: `${SHOTS}/t-inbox-phone.png` });

  // ---------- The admin can switch a locked-out player's off ----------
  await pool.query(`delete from public.admins; insert into public.admins (user_id) select id from auth.users where email = 'ann@allin.test'`);
  await ann3.goto(BASE + '/admin');
  await ann3.getByRole('tab', { name: 'players' }).click();
  await ann3.getByRole('region', { name: 'Find a player' }).getByRole('button', { name: /Ben/ }).first().click();
  await ann3.getByText('Two-step verification is on.').waitFor();
  await ann3.getByRole('button', { name: 'Switch it off' }).click();
  await ann3.getByText('Two-step verification is off for Ben').first().waitFor();
  ok(!(await twoStep('ben@allin.test')), 'the admin switched it off for a player');

  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
