const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', m); };
const bal = async (email) => Number((await pool.query(`select w.balance from public.wallets w join auth.users u on u.id = w.user_id where u.email = $1`, [email])).rows[0].balance);
const deck = (cards) => pool.query('select tests.deck($1)', [cards]);
const raw = (...v) => pool.query('insert into tests.dice (v) select x from unnest($1::int[]) with ordinality u(x, o) order by o', [v]);
const same = (n, v) => Array(n).fill(v);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAMES = ['dragon_tiger', 'casino_war', 'ultimate_holdem', 'plinko', 'mines', 'scratch_cards', 'power_draw', 'crash', 'bingo'];

async function login(browser, email, vp) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
  // First-visit game guides off, so they don't cover the game under test.
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
const open = async (page, game) => { await page.goto(`${BASE}/play/${game}`); await page.getByRole('button', { name: 'Rules' }).waitFor(); await page.waitForTimeout(300); };
const chip = (page, v) => page.getByRole('radio', { name: `${v} chip`, exact: true }).click();
const spot = (page, re) => page.getByRole('button', { name: re }).click();
const button = (page, name) => page.getByRole('button', { name, exact: true }).click();
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

(async () => {
  await pool.query('delete from tests.dice; delete from tests.decks; delete from public.crash_rounds; delete from public.bingo_rounds;');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const A = 'ann@allin.test';
  let b;

  // Lounge: four sections, every game open
  await ann.getByRole('heading', { name: 'Table games' }).waitFor();
  for (const h of ['Table games', 'Poker', 'Slots', 'Specialty']) ok((await ann.getByRole('heading', { name: h, exact: true }).count()) === 1, `lounge section: ${h}`);
  ok((await ann.getByText('Opening soon').count()) === 0, 'every game is open');
  await ann.getByRole('heading', { name: 'Table games' }).scrollIntoViewIfNeeded();
  await ann.screenshot({ path: `${SHOTS}/m-lounge.png`, fullPage: true });
  // Lobby: the picker lists every game
  await ann.goto(`${BASE}/lobby`);
  await ann.getByRole('tab', { name: /Blackjack/ }).waitFor();
  const tabs = await ann.getByRole('tab').count();
  const total = Number((await pool.query('select count(*) from public.games')).rows[0].count);
  ok(tabs === total, `lobby picker has all ${total} games (${tabs})`);
  await ann.getByRole('tab', { name: /Crash/ }).click();
  await ann.getByRole('link', { name: 'Join the room' }).waitFor();
  await ann.screenshot({ path: `${SHOTS}/m-lobby-room.png` });
  await ann.getByRole('tab', { name: /Mines/ }).click();
  await ann.getByRole('link', { name: 'Play now' }).click();
  await ann.waitForURL('**/play/mines');
  ok(true, 'lobby opens solo games and live rooms');

  // Mines
  await ann.getByRole('button', { name: 'Rules' }).waitFor();
  b = await bal(A);
  await raw(0, 0, 0);
  await button(ann, 'Start');
  await ann.getByText('Pick a tile').waitFor();
  await ann.getByRole('button', { name: 'Tile 6', exact: true }).click();
  await ann.getByText(/×1\.1 so far/).waitFor();
  await ann.reload();
  await ann.getByText(/×1\.1 so far/).waitFor();
  ok(true, 'mines: the field waited through a reload');
  await ann.getByRole('button', { name: 'Tile 25', exact: true }).click();
  await ann.getByText(/×1\.25 so far/).waitFor();
  await ann.screenshot({ path: `${SHOTS}/m-mines-play.png` });
  await ann.getByRole('button', { name: /^Collect/ }).click();
  await ann.getByText('Collected at ×1.25').waitFor();
  await ann.screenshot({ path: `${SHOTS}/m-mines-collected.png` });
  ok((await bal(A)) === b - 10 + 12, 'mines: collected at 1.25x (rounded down to whole chips)');
  await raw(0, 0, 0);
  await button(ann, 'Start');
  await ann.getByRole('button', { name: 'Tile 2', exact: true }).click();
  await ann.getByText('Boom. That was a mine.').waitFor();
  ok((await bal(A)) === b + 2 - 10, 'mines: a mine loses the bet');

  // Dragon Tiger
  await open(ann, 'dragon_tiger');
  b = await bal(A);
  await deck('Ks 2h');
  await chip(ann, 100);
  await spot(ann, /^Dragon\./);
  await button(ann, 'Deal');
  await ann.getByText('Dragon wins').waitFor({ timeout: 8000 });
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/m-dragon-tiger.png` });
  ok((await bal(A)) === b + 100, 'dragon tiger: dragon paid 1 to 1');

  // Casino War
  await open(ann, 'casino_war');
  b = await bal(A);
  await deck('Ks Kh 3d 4d 5d As 6c 7c 8c 2d');
  await chip(ann, 100);
  await spot(ann, /^Ante\./);
  await chip(ann, 10);
  await spot(ann, /^Tie\./);
  await button(ann, 'Deal');
  await ann.getByText("It's a tie! Go to war, or surrender?").waitFor({ timeout: 8000 });
  await ann.screenshot({ path: `${SHOTS}/m-war-tie.png` });
  await button(ann, 'Go to war');
  await ann.getByText('You won the war!').waitFor({ timeout: 8000 });
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/m-war-won.png` });
  ok((await bal(A)) === b - 210 + 410, 'casino war: tie bet 10 to 1, war won');

  // Ultimate Texas Hold'em
  await open(ann, 'ultimate_holdem');
  b = await bal(A);
  await deck('As Ks 2d 3c Qs Js 4s 9d 9h');
  await chip(ann, 100);
  await spot(ann, /^Ante\./);
  await chip(ann, 25);
  await spot(ann, /^Trips\./);
  await button(ann, 'Deal');
  await ann.getByText(/Your two cards/).waitFor();
  await ann.screenshot({ path: `${SHOTS}/m-uth-preflop.png` });
  await button(ann, 'Check');
  await ann.getByText(/^The flop/).waitFor();
  await button(ann, 'Check');
  await ann.getByText(/All five are out/).waitFor();
  await button(ann, 'Bet 1×');
  await ann.getByText('Your hand wins!').waitFor({ timeout: 8000 });
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/m-uth-showdown.png` });
  ok((await bal(A)) === b - 325 + 200 + 250 + 200 + 200, `ultimate hold'em: flush pays blind 3 to 2 and trips 7 to 1 (balance ${await bal(A)})`);

  // Plinko
  await open(ann, 'plinko');
  b = await bal(A);
  await raw(...same(12, 0));
  await ann.getByRole('radio', { name: 'high', exact: true }).click();
  await button(ann, 'Drop');
  await ann.getByText('Landed on ×170').waitFor({ timeout: 10000 });
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/m-plinko.png` });
  ok((await bal(A)) === b - 10 + 1700, 'plinko: the far edge of a 12-row high-risk board paid 170x');
  // five balls at once
  b = await bal(A);
  await ann.getByRole('radio', { name: '5', exact: true }).click();
  await button(ann, 'Drop 5');
  await ann.getByText(/balls bouncing/).waitFor({ timeout: 5000 });
  await ann.waitForTimeout(900);
  await ann.screenshot({ path: `${SHOTS}/m-plinko-five.png` });
  await ann.getByText(/5 balls landed/).waitFor({ timeout: 20000 });
  const five = (await pool.query(`select coalesce(sum(returned), 0) as won, count(*) as n from (select returned from public.game_history h join auth.users u on u.id = h.user_id where u.email = $1 and h.game_key = 'plinko' order by h.id desc limit 5) x`, [A])).rows[0];
  ok((await bal(A)) === b - 50 + Number(five.won), `plinko: five balls, five separate bets (won ${five.won})`);
  await ann.waitForTimeout(1200);
  ok((await ann.getByRole('banner').getByText((await bal(A)).toLocaleString('en-US')).count()) > 0, 'plinko: the header balance is right once every ball has landed');

  // Scratch cards
  await open(ann, 'scratch_cards');
  b = await bal(A);
  await raw(0);
  await ann.getByRole('radio', { name: /Gold Rush/ }).click();
  await button(ann, 'New card');
  await ann.getByText(/Scratch the panels/).waitFor();
  // The header number rolls to its new value, so wait for it to settle.
  ok(await ann.getByRole('banner').getByText(String((b - 10).toLocaleString('en-US'))).first().waitFor({ timeout: 3000 }).then(() => true, () => false), 'scratch: the prize is not in the balance until the card is scratched');
  await ann.getByRole('button', { name: 'Panel 1, covered' }).click();
  await ann.getByRole('button', { name: 'Panel 5, covered' }).click();
  await ann.screenshot({ path: `${SHOTS}/m-scratch-partial.png` });
  await button(ann, 'Scratch all');
  await ann.getByText('Three of a kind: ×2!').waitFor();
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/m-scratch-won.png` });
  ok((await bal(A)) === b - 10 + 20, 'scratch: Gold Rush smallest prize paid twice the price');

  // Power Draw
  await open(ann, 'power_draw');
  b = await bal(A);
  await raw(...same(6, 0));
  for (const n of [1, 2, 3, 29, 30]) await ann.getByRole('button', { name: `Number ${n}`, exact: true }).click();
  await ann.getByRole('radio', { name: 'Power ball 1', exact: true }).click();
  await button(ann, 'Draw');
  await ann.getByText('3 numbers + power ball!').waitFor({ timeout: 15000 });
  await ann.waitForTimeout(600);
  await ann.screenshot({ path: `${SHOTS}/m-power-draw.png` });
  ok((await bal(A)) === b - 10 + 400, 'power draw: three numbers and the power ball paid 40x');

  // Crash: two players in the same room
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });
  await open(ann, 'crash');
  await open(ben, 'crash');
  const a0 = await bal(A);
  const b0 = await bal('ben@allin.test');
  await ann.getByRole('button', { name: 'Bet', exact: true }).waitFor({ timeout: 15000 });
  await raw(900000); // crash point 9.70x, about 32 seconds of flight
  await ann.getByLabel('Collect at (optional)').fill('1.2');
  await button(ann, 'Bet');
  await ben.getByRole('button', { name: 'Bet', exact: true }).click();
  await ann.getByText('Ben').first().waitFor({ timeout: 5000 });
  ok(true, 'crash: each player sees the other in the round');
  await ann.screenshot({ path: `${SHOTS}/m-crash-betting.png` });
  await ben.getByRole('button', { name: /^Collect \d/ }).waitFor({ timeout: 15000 });
  await sleep(5200);
  await ben.screenshot({ path: `${SHOTS}/m-crash-mobile-flying.png`, fullPage: true });
  await ben.getByRole('button', { name: /^Collect \d/ }).click();
  await ben.getByText(/You collected at/).waitFor({ timeout: 5000 });
  await ann.getByText(/You collected at 1\.20×/).waitFor({ timeout: 5000 });
  await ann.screenshot({ path: `${SHOTS}/m-crash-flying.png` });
  ok((await bal(A)) === a0 - 10 + 12, 'crash: automatic collect paid at exactly 1.20x');
  const got = (await bal('ben@allin.test')) - b0;
  ok(got >= 3 && got <= 8, `crash: manual collect after ~5s paid about 1.4 to 1.7x (net ${got})`);
  await pool.query(`update public.crash_secrets set crash_at = now() where round_id = (select id from public.crash_rounds order by round_no desc limit 1)`);
  await ann.getByText(/^Crashed at/).waitFor({ timeout: 5000 });
  await ann.waitForTimeout(350);
  await ann.screenshot({ path: `${SHOTS}/m-crash-falling.png` });
  await ann.getByText('Crashed here').waitFor({ timeout: 3000 });
  await ann.screenshot({ path: `${SHOTS}/m-crash-crashed.png` });
  ok(true, 'crash: the round crashes for everyone');

  // Bingo: both players take cards; Ben's is stacked to win on the fifth call
  await open(ann, 'bingo');
  await open(ben, 'bingo');
  const a1 = await bal(A);
  const b1 = await bal('ben@allin.test');
  await ann.getByRole('radio', { name: '2 cards', exact: true }).click();
  await ann.getByRole('button', { name: /^Take 2 cards/ }).click();
  await ann.getByText(/Balls roll in/).waitFor({ timeout: 5000 });
  await ben.getByText(/Balls roll in/).waitFor({ timeout: 8000 });
  await ben.getByRole('button', { name: /^Take 1 card/ }).click();
  await ben.getByText(/Card for/).waitFor({ timeout: 5000 });
  ok((await bal(A)) === a1 - 20 && (await bal('ben@allin.test')) === b1 - 10, 'bingo: cards paid for');
  await ann.getByText(/2 playing/).waitFor({ timeout: 8000 });
  await ann.screenshot({ path: `${SHOTS}/m-bingo-selling.png` });
  await pool.query(`update public.bingo_cards k set numbers = '{1,2,3,4,5, 16,17,18,19,20, 31,32,0,34,35, 46,47,48,49,50, 61,62,63,64,65}' from auth.users u where u.id = k.user_id and u.email = 'ben@allin.test'`);
  await pool.query(`update public.bingo_cards k set numbers = '{41,42,43,44,45, 46,47,48,49,50, 51,52,0,54,55, 56,57,58,59,60, 71,72,73,74,75}' from auth.users u where u.id = k.user_id and u.email = 'ann@allin.test'`);
  await raw(...same(40, 0)); // balls 1 to 40 in order
  await pool.query(`update public.bingo_rounds set selling_ends_at = now()`);
  await ben.getByText('Bingo!').waitFor({ timeout: 15000 });
  await ben.screenshot({ path: `${SHOTS}/m-bingo-mobile-calling.png`, fullPage: true });
  await ann.screenshot({ path: `${SHOTS}/m-bingo-calling.png` });
  ok((await bal('ben@allin.test')) === b1 - 10, 'bingo: nothing is paid until the round ends');
  await pool.query(`update public.bingo_rounds set started_at = now() - interval '60 seconds'`);
  await ben.getByText(/Line on call 5/).waitFor({ timeout: 8000 });
  await ann.getByText(/Round over: 1 winner/).waitFor({ timeout: 8000 });
  await ann.screenshot({ path: `${SHOTS}/m-bingo-done.png` });
  ok((await bal('ben@allin.test')) === b1 - 10 + 500, 'bingo: a line in five calls paid 50 times the card');
  ok((await bal(A)) === a1 - 20, 'bingo: no line, no prize');

  // Phones
  for (const g of GAMES) {
    await open(ben, g);
    ok(await fits(ben), `${g} fits a 390px phone`);
    await ben.screenshot({ path: `${SHOTS}/m-mobile-${g}.png`, fullPage: true });
  }
  const tiny = await login(browser, 'cat@allin.test', { width: 360, height: 740 });
  for (const g of ['plinko', 'power_draw', 'ultimate_holdem', 'bingo', 'crash']) {
    await open(tiny, g);
    ok(await fits(tiny), `${g} fits 360px`);
  }
  await tiny.goto(`${BASE}/lounge`);
  await tiny.getByRole('heading', { name: 'Specialty', exact: true }).waitFor();
  ok(await fits(tiny), 'lounge fits 360px');
  await tiny.screenshot({ path: `${SHOTS}/m-mobile-lounge.png`, fullPage: true });
  await tiny.goto(`${BASE}/lobby`);
  await tiny.getByRole('tab', { name: /Blackjack/ }).waitFor();
  ok(await fits(tiny), 'lobby fits 360px');

  const errors = ann.errors.concat(ben.errors, tiny.errors);
  ok(!errors.length, `no page errors ${JSON.stringify(errors)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
