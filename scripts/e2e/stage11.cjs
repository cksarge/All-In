// Phase 11: typed chat (a live room and a table), the filter, reputation, reporting a message, and the admin's controls.
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
const rep = async (email) => Number((await q(`select private.reputation_of(u.id) as r from auth.users u where u.email = $1`, [email])).r);

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
// Types a message and sends it, waiting out the 3-second gap first.
async function say(page, text) {
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await send.waitFor({ timeout: 8000 });
  await send.click();
  await page.waitForTimeout(500);
}

(async () => {
  await pool.query(`delete from public.admins; insert into public.admins (user_id) select id from auth.users where email = 'cat@allin.test'`);
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });

  // ---------- A live room ----------
  await ann.goto(`${BASE}/play/crash`);
  await ben.goto(`${BASE}/play/crash`);
  await ann.getByRole('button', { name: /Room chat/ }).click();
  await ann.getByText('Nothing said yet.').waitFor();
  await say(ann, 'hello everyone');
  await ann.getByText('hello everyone').waitFor();
  ok((await ann.getByRole('button', { name: /^\d+s$/ }).count()) === 1, 'after sending, the button counts down the 3-second gap');
  await refresh(ben);
  await ben.getByText(/1 new/).waitFor({ timeout: 15000 });
  ok(true, 'someone with the chat shut is told there is something new');
  await ben.getByRole('button', { name: /Room chat/ }).click();
  await ben.getByText('hello everyone').waitFor();
  ok(await fits(ben), 'phone: the room chat fits 390px');
  await say(ben, 'hi Ann, good luck');
  await refresh(ann);
  await ann.getByText('hi Ann, good luck').waitFor({ timeout: 8000 });
  ok(true, 'two players talk in the room');

  // The filter: a warning, then points.
  await say(ann, 'well shit');
  await ann.getByText(/This is your one warning for today/).waitFor();
  await ann.getByText('well ****').waitFor();
  ok((await rep('ann@allin.test')) === 50, 'the first swear word is starred out and only warned about');
  await refresh(ben);
  await ben.getByText('well ****').waitFor({ timeout: 8000 });
  ok((await ben.getByText('well shit').count()) === 0, 'the other player only ever sees the stars');
  await ben.screenshot({ path: `${SHOTS}/l-room-chat-phone.png`, fullPage: true });
  await say(ann, 'oh fuck off');
  await ann.getByText(/You lost 25 reputation/).waitFor();
  await ann.getByText(/Typed chat is switched off for you at the moment/).first().waitFor();
  ok((await rep('ann@allin.test')) === 25 && (await ann.getByRole('textbox', { name: 'Message' }).count()) === 0, 'the second costs 25, and at 25 typed chat is switched off');
  await ann.screenshot({ path: `${SHOTS}/l-room-chat-banned.png`, fullPage: true });

  // Reporting a message.
  await refresh(ben);
  await ben.getByText('oh **** off').waitFor({ timeout: 8000 });
  await ben.getByRole('button', { name: 'Report this message from Ann' }).last().click();
  await ben.getByText('Message reported').waitFor();
  ok((await q(`select context ->> 'raw' as raw from public.player_reports order by id desc limit 1`)).raw === 'oh fuck off', 'a reported message is kept with the report, as typed');

  // ---------- The profile ----------
  await ann.goto(`${BASE}/profile`);
  await ann.getByRole('heading', { name: 'Reputation' }).waitFor();
  await ann.getByText('Typed chat: off').waitFor();
  await ann.getByText('Quick chat and emotes: on').waitFor();
  await ann.getByText('Swearing in chat').waitFor();
  ok(true, 'your profile shows your reputation, what it allows and what changed it');
  await ann.getByRole('heading', { name: 'Reputation' }).scrollIntoViewIfNeeded();
  await ann.screenshot({ path: `${SHOTS}/l-reputation-card.png` });
  await ben.goto(`${BASE}/profile/Ann`);
  await ben.getByRole('heading', { name: 'Ann' }).first().waitFor();
  ok((await ben.getByRole('heading', { name: 'Reputation' }).count()) === 0, 'nobody else can see it');
  await ann.goto(`${BASE}/inbox`);
  await ann.getByText(/Your reputation went down by 25/).waitFor();
  ok(true, 'and the inbox says so');

  // ---------- A table ----------
  for (const p of [ann, ben]) {
    await p.goto(`${BASE}/lobby?game=blackjack`);
    await p.locator('li', { hasText: 'Emerald' }).first().getByRole('button', { name: 'Sit down' }).click();
    await p.waitForURL('**/table/*');
    await p.waitForTimeout(900);
  }
  await ben.getByRole('button', { name: 'Chat', exact: true }).click();
  await say(ben, 'nice table');
  await ben.getByText('nice table').waitFor();
  ok(await fits(ben), 'phone: chat at a table fits 390px');
  await ben.screenshot({ path: `${SHOTS}/l-table-chat-phone.png` });
  await refresh(ann);
  await ann.getByRole('button', { name: /Chat, 1 new/ }).waitFor({ timeout: 15000 });
  await ann.getByText('Ben: nice table').waitFor();
  ok(true, 'at a table a new message shows beside the Chat button');
  await ann.screenshot({ path: `${SHOTS}/l-table-chat-peek.png` });
  await ann.getByRole('button', { name: /Chat/ }).first().click();
  await ann.getByRole('dialog', { name: 'Chat' }).getByText(/Typed chat is switched off/).waitFor();
  await ann.getByRole('tab', { name: 'Emotes' }).click();
  ok((await ann.getByRole('button', { name: /^Send emote/ }).count()) > 0, 'with typed chat off, quick chat still works');
  await ann.getByRole('button', { name: /Leave table/ }).click();
  await ben.getByRole('button', { name: /Leave table/ }).click();

  // ---------- The admin ----------
  const cat = await login(browser, 'cat@allin.test', { width: 1280, height: 900 });
  await cat.goto(`${BASE}/admin`);
  await cat.getByText(/Chat message \(room:crash\)/).waitFor();
  await cat.getByText('oh fuck off').first().waitFor();
  ok(true, 'the report shows the admin what was really typed');
  await cat.screenshot({ path: `${SHOTS}/l-admin-report.png` });
  cat.once('dialog', (d) => d.accept());
  await cat.getByRole('button', { name: /False report/ }).click();
  await cat.getByText('Dismissed as a false report').waitFor();
  ok((await rep('ben@allin.test')) === 40, 'dismissing it as false costs the reporter 10');
  await cat.getByRole('tab', { name: 'players' }).click();
  await cat.getByRole('region', { name: 'Find a player' }).getByRole('button', { name: /Ben/ }).first().click();
  await cat.getByRole('heading', { name: 'Reputation and chat' }).waitFor();
  await cat.getByLabel('Reputation points').fill('80');
  cat.once('dialog', (d) => d.accept());
  await cat.getByRole('button', { name: 'Set to this' }).click();
  await cat.getByText('Reputation set to 80').waitFor();
  ok((await rep('ben@allin.test')) === 80, 'the admin can set a reputation');
  await cat.getByRole('heading', { name: 'Reputation and chat' }).scrollIntoViewIfNeeded();
  await cat.screenshot({ path: `${SHOTS}/l-admin-reputation.png` });

  // The cosmetics that depend on it.
  await ben.goto(`${BASE}/locker`);
  await ben.getByRole('heading', { name: 'Locker' }).waitFor();
  await ben.getByRole('tab', { name: /Titles/ }).click();
  await ben.getByRole('button', { name: /Well-Mannered/ }).click();
  await ben.getByText('Equipped').first().waitFor();
  const benId = (await q(`select id from auth.users where email = 'ben@allin.test'`)).id;
  ok((await q(`select title from public.player_loadouts where user_id = $1`, [benId])).title === 'title_well_mannered', 'at 75 or more the reputation title can be worn');
  ok((await ben.getByText(/Reputation 100 or more/).count()) >= 1, 'the locker shows what 100 would bring');
  await ben.screenshot({ path: `${SHOTS}/l-locker-reputation-phone.png`, fullPage: true });
  await cat.getByRole('button', { name: '1 hour', exact: true }).first().click();
  await cat.getByText(/Typed chat banned: 1 hour/).waitFor();
  await cat.getByLabel('Reputation points').fill('10');
  await cat.getByRole('button', { name: 'Remove points' }).click();
  await cat.getByText('Removed 10 reputation').waitFor();
  ok((await q(`select title from public.player_loadouts where user_id = $1`, [benId])).title === 'title_newcomer', 'dropping below 75 takes the title off at once');
  await ben.goto(`${BASE}/profile`);
  await ben.getByText(/Switched off by a moderator until/).waitFor();
  ok(true, 'a chat ban from the admin shows on the profile, with when it ends');

  ok(ann.errors.length === 0 && ben.errors.length === 0 && cat.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...ben.errors, ...cat.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
