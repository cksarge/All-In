// Stage 12, part 2: direct messages, a private table with a waiting room, and watching a friend.
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
  await page.addInitScript(() => { if (!localStorage.getItem('allin-settings')) localStorage.setItem('allin-settings', JSON.stringify({ state: { soundOn: true, musicOn: false, motion: 'system', tourSeen: true, tipsOn: false, tipsSeen: {} }, version: 1 })); });
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
async function say(page, text) {
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await send.waitFor({ timeout: 8000 });
  await send.click();
  await page.waitForTimeout(500);
}

(async () => {
  const id = async (email) => (await q(`select id from auth.users where email = $1`, [email])).id;
  const [annId, benId] = [await id('ann@allin.test'), await id('ben@allin.test')];
  await pool.query(`delete from public.friendships`);
  await pool.query(`insert into public.friendships (requester, addressee, status, responded_at) values ($1, $2, 'accepted', now())`, [annId, benId]);
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });

  // ---------- Direct messages ----------
  await ann.goto(`${BASE}/friends`);
  await ann.getByRole('button', { name: 'Message Ben' }).click();
  await ann.getByRole('heading', { name: 'Messages with Ben' }).waitFor();
  await say(ann, 'fancy a game of poker?');
  await ann.getByText('fancy a game of poker?').waitFor();
  await ann.screenshot({ path: `${SHOTS}/o-dm.png` });
  await ann.keyboard.press('Escape');
  await refresh(ben);
  await ben.getByText('New message from Ann').waitFor({ timeout: 40000 });
  ok(true, 'the friend is told about a new message wherever they are');
  await ben.goto(`${BASE}/friends`);
  await ben.getByRole('button', { name: 'Message Ann, 1 new' }).click();
  await ben.getByText('fancy a game of poker?').waitFor();
  ok(await fits(ben), 'phone: the conversation fits 390px');
  await say(ben, 'yes, set up a table');
  await ben.screenshot({ path: `${SHOTS}/o-dm-phone.png` });
  await ben.keyboard.press('Escape');
  ok(Number((await q(`select count(*)::int as n from public.chat_messages where channel like 'dm:%'`)).n) === 2
     && Number((await q(`select count(distinct channel)::int as n from public.chat_messages where channel like 'dm:%'`)).n) === 1, 'both messages are in one stored conversation');
  await refresh(ben);
  await ben.getByRole('button', { name: 'Message Ann', exact: true }).waitFor({ timeout: 8000 });
  ok(true, 'reading it clears the unread count');

  // ---------- A private table with a waiting room ----------
  await ann.goto(`${BASE}/lobby?game=poker_holdem`);
  await ann.getByRole('button', { name: 'Create private table' }).click();
  ok(await ann.getByRole('checkbox', { name: /Open with a waiting room/ }).isChecked(), 'a private table offers a waiting room');
  await ann.getByRole('dialog').getByRole('button', { name: /^Create/ }).click();
  await ann.getByText('Your table is ready').waitFor();
  const code = (await q(`select invite_code from public.game_tables where created_by = $1 order by created_at desc limit 1`, [annId])).invite_code;
  await ann.getByRole('button', { name: 'Go to the table' }).click();
  await ann.waitForURL('**/table/*');
  await ann.getByText('Waiting room').waitFor();
  const dlg = ann.getByRole('dialog');
  await dlg.waitFor();
  await dlg.getByRole('button', { name: /^Bring/ }).click();
  await dlg.waitFor({ state: 'detached' });
  await ben.goto(`${BASE}/join/${code}`);
  await ben.waitForURL('**/table/*');
  await ben.getByText('Waiting room').waitFor();
  const bd = ben.getByRole('dialog');
  await bd.waitFor();
  await bd.getByRole('button', { name: /^Bring/ }).click();
  await bd.waitFor({ state: 'detached' });
  await ben.getByText(/The host starts the game when everyone is here/).waitFor();
  ok((await ben.getByRole('button', { name: 'Start the game' }).count()) === 0, 'a guest sees the waiting room but cannot start');
  await ben.screenshot({ path: `${SHOTS}/o-waiting-phone.png` });
  await ann.waitForTimeout(4500);
  ok(Number((await q(`select count(*)::int as n from public.pk_hands h join public.game_tables t on t.id = h.table_id where t.invite_code = $1`, [code])).n) === 0, 'two players with chips, and still nothing is dealt');
  await refresh(ann);
  await ann.getByText(/2 players seated/).waitFor({ timeout: 8000 });
  await ann.screenshot({ path: `${SHOTS}/o-waiting-host.png` });
  await ann.getByRole('button', { name: 'Start the game' }).click();
  await ann.getByText('The table is open').waitFor();
  for (let i = 0; i < 20; i++) {
    await refresh(ann);
    if (Number((await q(`select count(*)::int as n from public.pk_hands h join public.game_tables t on t.id = h.table_id where t.invite_code = $1`, [code])).n) > 0) break;
    await ann.waitForTimeout(600);
  }
  ok(Number((await q(`select count(*)::int as n from public.pk_hands h join public.game_tables t on t.id = h.table_id where t.invite_code = $1`, [code])).n) === 1, 'the host starts it and the first hand is dealt');
  await ben.waitForTimeout(4500);
  ok((await ben.getByText('Waiting room').count()) === 0, 'the waiting room closes for the guest too');
  for (const p of [ann, ben]) {
    await p.getByRole('button', { name: '← Leave table' }).click();
    const sure = p.getByRole('button', { name: 'Leave anyway' });
    await sure.waitFor({ timeout: 1000 }).then(() => sure.click()).catch(() => undefined);
    await p.waitForURL('**/lobby**');
  }

  // ---------- Watching a friend ----------
  await ben.goto(`${BASE}/play/slots_classic`);
  await ben.getByRole('button', { name: /^Spin/ }).first().click();
  await ben.waitForTimeout(3500);
  await ann.goto(`${BASE}/friends`);
  await ann.getByText('Playing Lucky Sevens').waitFor({ timeout: 20000 });
  await ann.getByRole('button', { name: 'Watch Ben' }).click();
  await ann.getByRole('heading', { name: 'Watching Ben' }).waitFor();
  await ann.getByText(/Playing Lucky Sevens right now/).waitFor();
  ok((await ann.getByRole('list', { name: 'Their recent rounds' }).getByRole('listitem').count()) >= 1, 'a friend playing alone can be watched: their rounds show up');
  ok((await ann.getByRole('link', { name: 'Play it too' }).getAttribute('href')).endsWith('/play/slots_classic'), 'with a way to play the same game');
  const before = await ann.getByRole('list', { name: 'Their recent rounds' }).getByRole('listitem').count();
  await ben.getByRole('button', { name: /^Spin/ }).first().click();
  await ann.waitForTimeout(6000);
  ok((await ann.getByRole('list', { name: 'Their recent rounds' }).getByRole('listitem').count()) > before, 'and it updates by itself as they play');
  await ann.screenshot({ path: `${SHOTS}/o-watch.png` });
  await ann.keyboard.press('Escape');

  // At a table: watch or join.
  await ben.goto(`${BASE}/lobby?game=blackjack`);
  await ben.locator('li', { hasText: 'Emerald' }).first().getByRole('button', { name: 'Sit down' }).click();
  await ben.waitForURL('**/table/*');
  await ann.reload();
  await ann.getByText(/Playing Blackjack at Emerald/).waitFor({ timeout: 20000 });
  await ann.getByRole('button', { name: 'Watch Ben' }).click();
  await ann.getByRole('link', { name: 'Watch the table' }).waitFor();
  ok((await ann.getByRole('link', { name: 'Join their table' }).count()) === 2, 'a friend at a live table: watch it or join it');
  await ann.getByRole('link', { name: 'Watch the table' }).click();
  await ann.waitForURL('**/table/*');
  await ann.getByText(/You.re watching/).waitFor();
  ok(true, 'watching takes you to the table without a seat');
  await ben.getByRole('button', { name: '← Leave table' }).click();

  // Switching it off.
  await ben.goto(`${BASE}/friends`);
  await ben.getByRole('checkbox', { name: /Let my friends see what I/ }).uncheck();
  await ben.getByText(/can no longer see what you play/).waitFor();
  await ben.goto(`${BASE}/play/slots_classic`);
  await ben.waitForTimeout(1500);
  await ann.goto(`${BASE}/friends`);
  await ann.getByRole('button', { name: 'Message Ben' }).waitFor();
  await ann.waitForTimeout(1500);
  ok((await ann.getByText('Playing Lucky Sevens').count()) === 0 && (await ann.getByRole('button', { name: 'Watch Ben' }).count()) === 0, 'with watching switched off, friends see nothing about solo games');

  ok(ann.errors.length === 0 && ben.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...ben.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
