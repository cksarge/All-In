// Stage 13: keyboard shortcuts in the games, bet presets, the lounge's friends strip, and the
// alert when it is your turn at a table you are not looking at.
const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', m); };
const q = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const rounds = async (email, game) => Number((await q(`select count(*) as n from public.game_history h join auth.users u on u.id = h.user_id where u.email = $1 and h.game_key = $2`, [email, game])).n);

async function login(browser, email, vp) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  await page.addInitScript(() => { if (!localStorage.getItem('allin-settings')) localStorage.setItem('allin-settings', JSON.stringify({ state: { soundOn: true, musicOn: false, motion: 'system', tourSeen: true, tipsOn: false, tipsSeen: {} }, version: 1 })); });
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
async function sitAt(page, game) {
  await page.goto(`${BASE}/lobby?game=${game}`);
  await page.getByRole('button', { name: 'Sit down' }).first().click();
  await page.waitForURL('**/table/*');
  await page.waitForTimeout(800);
  return page.url().split('/table/')[1];
}

(async () => {
  const id = async (email) => (await q(`select id from auth.users where email = $1`, [email])).id;
  const [annId, benId] = [await id('ann@allin.test'), await id('ben@allin.test')];
  await pool.query(`delete from public.friendships`);
  await pool.query(`insert into public.friendships (requester, addressee, status, responded_at) values ($1, $2, 'accepted', now())`, [annId, benId]);
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });

  // ---------- Shortcuts: a game with betting spots ----------
  await ann.goto(BASE + '/play/baccarat');
  await ann.getByRole('button', { name: /^Player\./ }).waitFor();
  await ann.keyboard.press('2');
  ok((await ann.getByRole('radio', { name: /chip$/ }).nth(1).getAttribute('aria-checked')) === 'true', 'a number key picks a chip');
  await ann.keyboard.press('1');
  await ann.getByRole('button', { name: /^Player\./ }).click();
  await ann.getByRole('button', { name: /^Banker\./ }).click();
  const before = await rounds('ann@allin.test', 'baccarat');
  // The mouse was last on a betting spot: Space must deal, not put another chip there.
  await ann.keyboard.press('Space');
  for (let i = 0; i < 40 && (await rounds('ann@allin.test', 'baccarat')) === before; i++) await sleep(150);
  const bet = await q(`select h.wagered as wager from public.game_history h where h.user_id = $1 and h.game_key = 'baccarat' order by h.created_at desc limit 1`, [annId]);
  ok((await rounds('ann@allin.test', 'baccarat')) === before + 1 && Number(bet.wager) === 20, 'Space deals, with exactly the chips that were placed');
  await ann.getByRole('button', { name: 'Rebet' }).waitFor();
  for (let i = 0; i < 40 && !(await ann.getByRole('button', { name: 'Rebet' }).isEnabled()); i++) await sleep(150);
  const clear = ann.getByRole('button', { name: 'Clear', exact: true });
  await ann.keyboard.press('r');
  for (let i = 0; i < 20 && !(await clear.isEnabled()); i++) await sleep(100);
  ok(await clear.isEnabled(), 'R puts the last bets back');
  await ann.keyboard.press('c');
  for (let i = 0; i < 20 && (await clear.isEnabled()); i++) await sleep(100);
  ok(!(await clear.isEnabled()), 'C clears them');
  await ann.keyboard.press('Shift+Slash');
  await ann.getByRole('heading', { name: 'Keyboard shortcuts' }).waitFor();
  await ann.getByRole('dialog').getByText('Deal', { exact: true }).waitFor();
  await ann.waitForTimeout(400);
  const listed = await ann.getByRole('dialog').innerText();
  ok(/Space/.test(listed) && /Deal/.test(listed) && /chip/.test(listed), '"?" lists this game’s keys');
  await ann.screenshot({ path: `${SHOTS}/k-keys.png` });
  // With the list open, keys do not reach the game.
  await ann.keyboard.press('Escape');
  await ann.getByRole('heading', { name: 'Keyboard shortcuts' }).waitFor({ state: 'detached' });
  ok(await ann.getByRole('button', { name: 'Keys' }).isVisible(), 'a Keys button opens the same list');

  // ---------- Presets ----------
  await ann.getByRole('button', { name: /^Player\./ }).click();
  await ann.getByRole('button', { name: /^Tie\./ }).click();
  await ann.getByRole('button', { name: /^Presets/ }).click();
  await ann.screenshot({ path: `${SHOTS}/k-presets.png` });
  await ann.getByRole('button', { name: 'Save these bets as preset 1' }).click();
  await ann.getByText('Saved as preset 1').first().waitFor();
  await ann.keyboard.press('Escape');
  await ann.keyboard.press('c');
  for (let i = 0; i < 20 && (await clear.isEnabled()); i++) await sleep(100);
  await ann.keyboard.press('Shift+1');
  await ann.getByRole('button', { name: /^Tie\..*Your bet: 10/ }).waitFor();
  ok(await clear.isEnabled(), 'a saved preset comes back with Shift + 1');
  await ann.reload();
  await ann.getByRole('button', { name: /^Player\./ }).waitFor();
  await ann.getByRole('button', { name: 'Presets (1)' }).click();
  await ann.getByRole('button', { name: 'Use preset 1' }).click();
  await ann.getByRole('button', { name: /^Tie\..*Your bet: 10/ }).waitFor();
  ok(true, 'presets are kept after a reload, and the menu uses one');
  await ann.getByRole('button', { name: 'Presets (1)' }).click();
  await ann.getByRole('button', { name: 'Empty preset 1' }).click();
  ok((await ann.getByRole('button', { name: 'Presets', exact: true }).count()) === 1, 'a preset can be emptied');
  await ann.keyboard.press('Escape');

  // ---------- Shortcuts: a slot, video poker, and switching them off ----------
  await ann.goto(BASE + '/play/slots_classic');
  await ann.getByRole('button', { name: 'Spin' }).waitFor();
  const s0 = await rounds('ann@allin.test', 'slots_classic');
  await ann.keyboard.press('Space');
  for (let i = 0; i < 40 && (await rounds('ann@allin.test', 'slots_classic')) === s0; i++) await sleep(150);
  ok((await rounds('ann@allin.test', 'slots_classic')) === s0 + 1, 'Space spins a slot');
  await ann.getByRole('button', { name: 'Spin' }).waitFor({ timeout: 20000 });

  await ann.goto(BASE + '/play/video_poker_jacks');
  await ann.getByRole('button', { name: 'Deal' }).waitFor();
  await ann.keyboard.press('Space');
  await ann.getByRole('button', { name: 'Draw' }).waitFor();
  await ann.keyboard.press('1');
  await ann.keyboard.press('3');
  await ann.waitForTimeout(200);
  ok((await ann.locator('button[aria-pressed="true"]').count()) === 2, '1 to 5 hold cards in video poker');
  const v0 = await rounds('ann@allin.test', 'video_poker_jacks');
  await ann.keyboard.press('Space');
  for (let i = 0; i < 40 && (await rounds('ann@allin.test', 'video_poker_jacks')) === v0; i++) await sleep(150);
  ok((await rounds('ann@allin.test', 'video_poker_jacks')) === v0 + 1, 'Space deals and draws');
  await ann.screenshot({ path: `${SHOTS}/k-video-poker.png` });

  await ann.goto(BASE + '/settings');
  await ann.getByRole('switch', { name: 'Keyboard shortcuts' }).click();
  ok((await ann.getByRole('switch', { name: 'Tell me when it is my turn' }).getAttribute('aria-checked')) === 'true', 'Settings has switches for shortcuts and turn alerts');
  await ann.getByRole('region', { name: 'Playing' }).scrollIntoViewIfNeeded();
  await ann.screenshot({ path: `${SHOTS}/k-settings.png` });
  await ann.goto(BASE + '/play/slots_classic');
  await ann.getByRole('button', { name: 'Spin' }).waitFor();
  const s1 = await rounds('ann@allin.test', 'slots_classic');
  await ann.keyboard.press('Space');
  await ann.waitForTimeout(900);
  ok((await rounds('ann@allin.test', 'slots_classic')) === s1 && (await ann.getByRole('button', { name: 'Keys' }).count()) === 0, 'switched off, the keys do nothing and the Keys button goes');
  await ann.evaluate(() => { const s = JSON.parse(localStorage.getItem('allin-settings')); s.state.hotkeysOn = true; localStorage.setItem('allin-settings', JSON.stringify(s)); });

  // ---------- Roulette: chip keys and a preset ----------
  const rl = await sitAt(ann, 'roulette');
  await ann.keyboard.press('1');
  await ann.getByRole('button', { name: /^Straight 17\./ }).click();
  await ann.waitForTimeout(400);
  await ann.getByRole('button', { name: /^Straight 17\./ }).click();
  await ann.waitForTimeout(400);
  await ann.getByRole('button', { name: /^Black\./ }).click();
  await ann.waitForTimeout(600);
  const mine = async () => (await pool.query(`select b.bet_type, b.selection, sum(b.amount)::int as amount from public.rl_bets b join public.rl_rounds r on r.id = b.round_id where r.table_id = $1 and b.user_id = $2 and r.phase = 'betting' group by 1, 2 order by 1, 2`, [rl, annId])).rows;
  const placed = await mine();
  await ann.getByRole('button', { name: /^Presets/ }).click();
  await ann.getByRole('button', { name: 'Save these bets as preset 1' }).click();
  await ann.keyboard.press('Escape');
  await ann.keyboard.press('c');
  for (let i = 0; i < 30 && (await mine()).length > 0; i++) await sleep(150);
  ok(placed.length === 2 && (await mine()).length === 0, 'C clears the roulette bets');
  await ann.keyboard.press('Shift+1');
  for (let i = 0; i < 40 && (await mine()).length < 2; i++) await sleep(150);
  ok(JSON.stringify(await mine()) === JSON.stringify(placed), 'a roulette preset puts the same chips on the same spots');
  await ann.screenshot({ path: `${SHOTS}/k-roulette.png` });

  // ---------- Craps: Space rolls ----------
  const cr = await sitAt(ann, 'craps');
  await ann.getByRole('button', { name: /^Pass Line\./ }).first().click();
  await ann.getByRole('button', { name: /Roll the dice/ }).waitFor({ timeout: 8000 });
  for (let i = 0; i < 40 && !(await ann.getByRole('button', { name: /Roll the dice/ }).isEnabled()); i++) await sleep(150);
  const r0 = Number((await q(`select roll_no from public.cr_state where table_id = $1`, [cr])).roll_no);
  await ann.keyboard.press('Space');
  for (let i = 0; i < 40 && Number((await q(`select roll_no from public.cr_state where table_id = $1`, [cr])).roll_no) === r0; i++) await sleep(150);
  ok(Number((await q(`select roll_no from public.cr_state where table_id = $1`, [cr])).roll_no) === r0 + 1, 'Space rolls the dice in craps');
  ok((await ann.getByRole('button', { name: /^Presets/ }).count()) === 1, 'craps has presets too');

  // ---------- Your turn, in another tab ----------
  const bj = await sitAt(ann, 'blackjack');
  await ann.getByRole('button', { name: 'Place bet' }).waitFor();
  await ann.keyboard.press('1');
  await ann.keyboard.press('Enter');
  for (let i = 0; i < 30 && !(await pool.query(`select 1 from public.bj_hands h join public.bj_rounds r on r.id = h.round_id where r.table_id = $1 and h.user_id = $2`, [bj, annId])).rows[0]; i++) await sleep(150);
  ok(Boolean((await pool.query(`select 1 from public.bj_hands h join public.bj_rounds r on r.id = h.round_id where r.table_id = $1 and h.user_id = $2`, [bj, annId])).rows[0]), 'at the blackjack table, 1 adds a chip and Enter places the bet');
  const title = await ann.title();
  // The tab goes to the background before the cards are dealt.
  await ann.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  });
  // A hand dealt a blackjack has no turn: bet again until one does.
  let flashed = false;
  for (let hand = 0; hand < 4 && !flashed; hand++) {
    if (hand > 0) {
      await ann.getByRole('button', { name: 'Place bet' }).waitFor({ timeout: 30000 });
      await ann.keyboard.press('1');
      await ann.keyboard.press('Enter');
    }
    for (let i = 0; i < 80 && !flashed; i++) {
      await sleep(400);
      flashed = (await ann.title()).includes('Your turn');
      const settled = (await pool.query(`select 1 from public.bj_rounds where table_id = $1 and phase = 'settled' and id = (select id from public.bj_rounds where table_id = $1 order by round_no desc limit 1)`, [bj])).rows[0];
      if (settled && i > 5 && !flashed) break;
    }
  }
  ok(flashed, 'the tab title says "Your turn" when the tab is in the background');
  await ann.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await ann.waitForTimeout(300);
  ok((await ann.title()) === title, 'coming back puts the title right');

  // ---------- Friends online, on the lounge ----------
  await ben.goto(BASE + '/play/plinko');
  await ben.getByRole('button', { name: /^Drop/ }).waitFor();
  await ben.waitForTimeout(800);
  await ann.goto(BASE + '/lounge');
  const strip = ann.getByRole('region', { name: /Friends online/ });
  await strip.waitFor({ timeout: 8000 });
  ok(/Ben/.test(await strip.innerText()) && /Playing Plinko/.test(await strip.innerText()), 'the lounge shows a friend who is playing, and what');
  await ann.screenshot({ path: `${SHOTS}/k-friends.png` });
  await strip.getByRole('button', { name: 'Watch Ben' }).click();
  await ann.getByRole('dialog').getByText(/Plinko/).first().waitFor();
  ok(true, 'Watch opens from the strip');
  await ann.keyboard.press('Escape');
  await strip.getByRole('button', { name: /^Message Ben/ }).click();
  await ann.getByRole('heading', { name: 'Messages with Ben' }).waitFor();
  ok(true, 'and so does a message');
  await ann.keyboard.press('Escape');
  // Ben sits at a public table: the strip offers to join it.
  const bt = await sitAt(ben, 'blackjack');
  await ann.reload();
  await strip.getByRole('link', { name: 'Join Ben' }).waitFor({ timeout: 8000 });
  ok((await strip.getByRole('link', { name: 'Join Ben' }).getAttribute('href')).endsWith(`/table/${bt}`), 'a friend at a table can be joined from the strip');
  // On a phone the strip scrolls sideways inside itself.
  await ann.goto(BASE + '/play/plinko');
  await ann.getByRole('button', { name: /^Drop/ }).waitFor();
  await ben.goto(BASE + '/lounge');
  await ben.getByRole('region', { name: /Friends online/ }).waitFor({ timeout: 8000 });
  ok(await fits(ben), 'the lounge still fits a phone');
  await ben.screenshot({ path: `${SHOTS}/k-lounge-phone.png` });
  // The presets menu on a phone, where the controls are pinned to the bottom of the screen.
  await ben.goto(BASE + '/play/baccarat');
  await ben.getByRole('button', { name: /^Player\./ }).click();
  await ben.getByRole('button', { name: /^Presets/ }).click();
  const menu = await ben.getByRole('group', { name: 'Bet presets' }).boundingBox();
  ok(menu.x >= 0 && menu.x + menu.width <= 390 && menu.y >= 0 && (await fits(ben)), 'the presets menu fits a phone');
  await ben.waitForTimeout(700);
  await ben.screenshot({ path: `${SHOTS}/k-presets-phone.png` });
  ok((await ben.getByRole('button', { name: 'Keys' }).count()) === 0 || !(await ben.getByRole('button', { name: 'Keys' }).isVisible()), 'no Keys button on a phone');
  ok(ann.errors.length === 0 && ben.errors.length === 0, 'no page errors: ' + [...ann.errors, ...ben.errors].join(' | '));

  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
