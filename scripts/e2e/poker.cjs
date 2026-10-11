const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let fails = 0;
const ok = (c, m) => {
  if (!c) fails++;
  console.log(c ? 'PASS' : 'FAIL', m);
};
const q1 = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const bal = async (email) => Number((await q1(`select w.balance from public.wallets w join auth.users u on u.id = w.user_id where u.email = $1`, [email])).balance);
const stack = async (email) => Number((await q1(`select s.stack from public.table_seats s join auth.users u on u.id = s.user_id where u.email = $1`, [email]))?.stack ?? -1);

async function login(browser, email, vp) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  // First-visit game guides off, so they don't cover the game under test.
  await page.addInitScript(() => { if (!localStorage.getItem('allin-settings')) localStorage.setItem('allin-settings', JSON.stringify({ state: { soundOn: true, motion: 'system', tourSeen: false, tipsOn: false, tipsSeen: {} }, version: 1 })); });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|WebSocket/.test(m.text()) && page.errors.push(m.text()));
  await page.route('https://fonts.googleapis.com/**', (r) => r.abort());
  await page.goto(BASE + '/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('abcDEF12');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL('**/lounge');
  return page;
}
// No realtime in the stand-in server: nudge the page to refetch.
const refresh = async (page) => {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(700);
};
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
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });

  // ---------- Lobby ----------
  await ann.goto(`${BASE}/lobby?game=poker_holdem`);
  await ann.getByText('Blinds 5/10').first().waitFor();
  ok(await ann.getByText('Bring 200–1,000').first().isVisible(), 'lobby shows blinds and stack range');
  await ann.screenshot({ path: `${SHOTS}/pk-lobby.png` });

  // ---------- Hold'em: sit, bring chips ----------
  await sitAt(ann, 'poker_holdem', "Emerald Hold'em");
  ok(await ann.getByRole('dialog').getByText('Bring chips to the table').isVisible(), 'bring-chips dialog opens on sitting down');
  await ann.screenshot({ path: `${SHOTS}/pk-bring.png` });
  await bring(ann);
  ok((await bal('ann@allin.test')) === 9000 && (await stack('ann@allin.test')) === 1000, 'Ann brought 1,000');
  ok(await ann.getByText('Waiting for another player').first().isVisible(), 'waiting for a second player');

  await sitAt(ben, 'poker_holdem', "Emerald Hold'em");
  await pool.query(`select tests.deck('As Ah Kc Kd 2c Ad 7s 3h 2d 9c 2s 4d')`);
  await bring(ben);
  await refresh(ann);
  ok(await ann.getByText('Your turn').isVisible(), 'hand dealt: Ann (small blind) to act');
  ok(await ann.getByRole('img', { name: 'Ace of spades' }).first().isVisible(), 'Ann sees her own cards');
  ok((await ann.getByRole('img', { name: 'King of clubs' }).count()) === 0, "Ann can't see Ben's cards");
  await ann.screenshot({ path: `${SHOTS}/pk-preflop-desktop.png` });
  await ben.screenshot({ path: `${SHOTS}/pk-preflop-mobile.png`, fullPage: true });

  await ann.getByRole('button', { name: /^Call/ }).click();
  await ann.waitForTimeout(600);
  await refresh(ben);
  await ben.getByRole('button', { name: /^Check/ }).click();
  await ben.waitForTimeout(800);
  ok(await ben.getByRole('img', { name: 'Ace of diamonds' }).first().isVisible(), 'flop dealt');
  ok(await ben.getByText('Pair of Kings').isVisible(), 'Ben sees his live hand name');
  // Ben bets the minimum (10). On a phone the sizing opens first.
  await ben.getByRole('button', { name: 'Bet…' }).click();
  await ben.screenshot({ path: `${SHOTS}/pk-bet-open-mobile.png` });
  await ben.getByRole('button', { name: /^Bet\s/ }).click();
  await ben.waitForTimeout(600);
  await refresh(ann);
  // Ann raises to 40 by typing it.
  await ann.getByLabel('Exact amount').fill('40');
  await ann.getByRole('button', { name: /^Raise to/ }).click();
  await ann.waitForTimeout(600);
  await refresh(ben);
  await ben.screenshot({ path: `${SHOTS}/pk-facing-raise-mobile.png`, fullPage: true });
  await ben.getByRole('button', { name: /^Call/ }).click();
  await ben.waitForTimeout(600);
  // Turn: Ben checks, Ann checks. River: Ben checks, Ann checks.
  for (let i = 0; i < 2; i++) {
    await ben.getByRole('button', { name: /^Check/ }).click();
    await ann.waitForTimeout(500);
    await refresh(ann);
    await ann.getByRole('button', { name: /^Check/ }).click();
    await ann.waitForTimeout(600);
    await refresh(ben);
  }
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/pk-showdown-desktop.png` });
  await ben.screenshot({ path: `${SHOTS}/pk-showdown-mobile.png`, fullPage: true });
  ok(await ann.getByText(/You win 100 · Three of a kind, Aces/).isVisible(), 'showdown banner names the winning hand');
  ok(await ben.getByRole('img', { name: 'Ace of spades' }).first().isVisible(), "Ben sees Ann's cards at showdown");
  ok((await stack('ann@allin.test')) === 1050 && (await stack('ben@allin.test')) === 950, 'stacks after showdown');

  // History and rules
  await ann.getByRole('button', { name: 'History' }).click();
  await ann.getByText('Hand #1').waitFor();
  await ann.screenshot({ path: `${SHOTS}/pk-history.png` });
  await ann.getByRole('button', { name: 'Close' }).click();
  await ann.getByRole('button', { name: 'Rules' }).click();
  await ann.getByRole('tab', { name: 'Hand rankings' }).click();
  await ann.screenshot({ path: `${SHOTS}/pk-rules.png` });
  await ann.getByRole('button', { name: 'Close' }).click();

  // Top up (Ben is under the max)
  await ben.getByRole('button', { name: 'Top up' }).click();
  await ben.getByRole('dialog').getByRole('button', { name: /^Top up/ }).click();
  await ben.waitForTimeout(800);
  ok((await stack('ben@allin.test')) + Number((await q1(`select coalesce(sum(amount),0) a from public.pk_topups`)).a) === 1000, 'Ben topped up to 1,000');

  // Next hand deals after the pause; Ben leaves mid-hand.
  await ann.waitForTimeout(9000);
  await refresh(ann);
  const handNo = Number((await q1(`select max(hand_no) n from public.pk_hands h join public.game_tables t on t.id = h.table_id where t.name = 'Emerald Hold''em'`)).n);
  ok(handNo === 2, 'next hand dealt automatically');
  const annBefore = await bal('ann@allin.test');
  const benStack = await stack('ben@allin.test');
  const benBal = await bal('ben@allin.test');
  await ben.getByRole('button', { name: '← Leave table' }).click();
  await ben.waitForURL('**/lobby*');
  await ben.waitForTimeout(600);
  ok((await bal('ben@allin.test')) === benBal + benStack, 'leaving returns the stack to the wallet');
  await refresh(ann);
  ok(await ann.getByText(/You win/).isVisible(), 'Ann wins when Ben leaves');
  await ann.getByRole('button', { name: '← Leave table' }).click();
  await ann.waitForURL('**/lobby*');
  await ann.waitForTimeout(500);
  ok((await bal('ann@allin.test')) > annBefore, 'Ann cashes her stack back to the wallet on leaving');
  ok((await bal('ann@allin.test')) + (await bal('ben@allin.test')) === 20000, 'every chip accounted for');

  // ---------- Five-Card Draw ----------
  await sitAt(ann, 'poker_draw', 'Emerald Draw');
  await bring(ann);
  await sitAt(ben, 'poker_draw', 'Emerald Draw');
  await pool.query(`select tests.deck('As Ad 7c 4h 2s Kc Kd Qh Jh 3c Ah 9s 8d 2h')`);
  await bring(ben);
  await refresh(ann);
  await ann.getByRole('button', { name: /^Call/ }).click();
  await ann.waitForTimeout(500);
  await refresh(ben);
  await ben.getByRole('button', { name: /^Check/ }).click();
  await ben.waitForTimeout(500);
  await refresh(ann);
  await ann.getByRole('button', { name: 'Swap Seven of clubs' }).click();
  await ann.getByRole('button', { name: 'Swap Four of hearts' }).click();
  await ann.getByRole('button', { name: 'Swap Two of spades' }).click();
  await ann.screenshot({ path: `${SHOTS}/pk-draw-desktop.png` });
  await ann.getByRole('button', { name: 'Draw 3' }).click();
  await ann.waitForTimeout(600);
  ok(await ann.getByText('Three of a kind, Aces').isVisible(), 'drew into trip aces');
  await refresh(ben);
  await ben.screenshot({ path: `${SHOTS}/pk-draw-mobile.png`, fullPage: true });
  await ben.getByRole('button', { name: 'Stand pat' }).click();
  await ben.waitForTimeout(500);
  ok((await q1(`select phase, street from public.pk_hands h join public.game_tables t on t.id = h.table_id where t.name = 'Emerald Draw' order by hand_no desc limit 1`)).street === 1, 'second betting round');
  await ben.getByRole('button', { name: '← Leave table' }).click();
  await ann.getByRole('button', { name: '← Leave table' }).click();
  await ann.waitForURL('**/lobby*');

  // ---------- Seven-Card Stud ----------
  await sitAt(ann, 'poker_stud', 'Emerald Stud');
  await bring(ann);
  await sitAt(ben, 'poker_stud', 'Emerald Stud');
  await pool.query(`select tests.deck('As Ks 2c Ah Ad Kc 3d 9h 4h 9d 9c Qc Js 8s')`);
  await bring(ben);
  await refresh(ann);
  await refresh(ben);
  ok(await ann.getByRole('img', { name: 'King of clubs' }).isVisible(), "Ben's up card is public");
  ok(await ben.getByRole('button', { name: /^Complete to/ }).isVisible(), 'stud: complete the bring-in');
  await ben.getByRole('button', { name: /^Complete to/ }).click();
  await ben.waitForTimeout(500);
  await refresh(ann);
  await ann.getByRole('button', { name: /^Call/ }).click();
  await ann.waitForTimeout(700);
  await refresh(ben);
  await ann.screenshot({ path: `${SHOTS}/pk-stud-desktop.png` });
  await ben.screenshot({ path: `${SHOTS}/pk-stud-mobile.png`, fullPage: true });
  await ben.getByRole('button', { name: '← Leave table' }).click();
  await ann.getByRole('button', { name: '← Leave table' }).click();
  await ann.waitForURL('**/lobby*');
  await ann.waitForTimeout(500);
  ok((await bal('ann@allin.test')) + (await bal('ben@allin.test')) === 20000, 'all chips back in wallets after three games');

  // ---------- Nine-seat layout at phone width ----------
  await sitAt(ben, 'poker_omaha', 'Emerald Omaha');
  await ben.screenshot({ path: `${SHOTS}/pk-omaha-empty-mobile.png`, fullPage: true });
  await ben.keyboard.press('Escape');
  await ben.getByRole('button', { name: '← Leave table' }).click();

  ok(ann.errors.length === 0 && ben.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...ben.errors].slice(0, 3))}`);
  await browser.close();
  await pool.end();
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
