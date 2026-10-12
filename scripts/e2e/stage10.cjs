// Stage 10, part 1: six card games against the dealer and three video poker machines.
const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', m); };
const q = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const bal = async (email) => Number((await q(`select w.balance from public.wallets w join auth.users u on u.id = w.user_id where u.email = $1`, [email])).balance);
const deck = (cards) => pool.query('select tests.deck($1)', [cards]);
const TABLE = ['caribbean_stud', 'casino_holdem', 'let_it_ride', 'mississippi_stud', 'four_card_poker', 'teen_patti'];

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
const open = async (page, game) => { await page.goto(`${BASE}/play/${game}`); await page.getByRole('button', { name: 'Rules' }).waitFor(); await page.waitForTimeout(300); };
const chip = (page, v) => page.getByRole('radio', { name: `${v} chip`, exact: true }).click();
const spot = (page, re) => page.getByRole('button', { name: re }).click();
const button = (page, name) => page.getByRole('button', { name, exact: true }).click();
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

(async () => {
  await pool.query('delete from tests.dice; delete from tests.decks;');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const A = 'ann@allin.test';
  let b;

  // The lounge lists them.
  await ann.getByRole('heading', { name: 'Caribbean Stud' }).waitFor();
  ok((await ann.getByRole('heading', { name: /^(Caribbean Stud|Casino Hold'em|Let It Ride|Mississippi Stud|Four Card Poker|Teen Patti|Bonus Poker|Double Bonus Poker|Joker Poker)$/ }).count()) === 9, 'the lounge lists all nine new games');

  // Caribbean Stud: trips against a dealer with ace-king
  await open(ann, 'caribbean_stud');
  b = await bal(A);
  await deck('Ks Kh Kd 4c 9s As Kc 7d 4s 2c');
  await chip(ann, 100);
  await spot(ann, /^Ante\./);
  await button(ann, 'Deal');
  await ann.getByText(/you have three of a kind/i).waitFor();
  await ann.screenshot({ path: `${SHOTS}/g-caribbean-decide.png` });
  await ann.getByRole('button', { name: /^Raise \d/ }).click();
  await ann.getByText('You win!').waitFor({ timeout: 10000 });
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/g-caribbean-result.png` });
  ok((await bal(A)) === b - 300 + 200 + 800, `Caribbean Stud: ante 1 to 1, raise 3 to 1 on trips (balance ${await bal(A)})`);

  // Casino Hold'em: aces against a dealer who doesn't qualify
  await open(ann, 'casino_holdem');
  b = await bal(A);
  await deck('As Ah Kd Qc 2s 7h 9d 3c 4h');
  await chip(ann, 100);
  await spot(ann, /^Ante\./);
  await button(ann, 'Deal');
  await ann.getByText(/you have pair/i).waitFor();
  await ann.getByRole('button', { name: /^Call \d/ }).click();
  await ann.getByText(/doesn't qualify/).first().waitFor({ timeout: 10000 });
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/g-holdem-result.png` });
  ok((await bal(A)) === b - 300 + 200 + 200, 'Casino Hold’em: ante paid, call returned');

  // Let It Ride: pull one back, ride the other, three tens
  await open(ann, 'let_it_ride');
  b = await bal(A);
  await deck('Ts Th 4d Tc 9s');
  await chip(ann, 100);
  await spot(ann, /^Bets riding\./);
  await button(ann, 'Deal');
  await ann.getByText(/First choice/).waitFor();
  ok((await bal(A)) === b - 300, 'Let It Ride: three bets go down');
  await button(ann, 'Take one back');
  await ann.getByText(/Second choice/).waitFor();
  ok((await bal(A)) === b - 200, 'one bet comes straight back');
  await ann.screenshot({ path: `${SHOTS}/g-ride-second.png` });
  await button(ann, 'Let it ride');
  await ann.getByText('You win!').waitFor({ timeout: 10000 });
  ok((await bal(A)) === b - 200 + 800, 'two bets ride on three tens: 3 to 1 each');

  // Mississippi Stud: a pair of jacks, betting all the way
  await open(ann, 'mississippi_stud');
  b = await bal(A);
  await deck('Js Jh 4d 7c 2s');
  await chip(ann, 100);
  await spot(ann, /^Ante\./);
  await button(ann, 'Deal');
  await ann.getByText(/Third street/).waitFor();
  await ann.getByRole('button', { name: /^Bet 3×/ }).click();
  await ann.getByText(/Fourth street/).waitFor();
  await ann.getByRole('button', { name: /^Bet 1×/ }).click();
  await ann.getByText(/Fifth street/).waitFor();
  await ann.screenshot({ path: `${SHOTS}/g-mississippi-fifth.png` });
  await ann.getByRole('button', { name: /^Bet 1×/ }).click();
  await ann.getByText('You win!').waitFor({ timeout: 10000 });
  ok((await bal(A)) === b + 600, 'Mississippi Stud: jacks pay even money on all 600 in bets');

  // Four Card Poker: aces against kings, with Aces Up
  await open(ann, 'four_card_poker');
  b = await bal(A);
  await deck('As Ah 4d 7c 9s Ks Kh 2d 5c 8s Jd');
  await chip(ann, 100);
  await spot(ann, /^Ante\./);
  await chip(ann, 25);
  await spot(ann, /^Aces Up\./);
  await button(ann, 'Deal');
  await ann.getByText(/you have pair/i).waitFor();
  await ann.getByRole('button', { name: /^Bet 3×/ }).click();
  await ann.getByText('You win!').waitFor({ timeout: 10000 });
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/g-fourcard-result.png` });
  ok((await bal(A)) === b - 425 + 850, 'Four Card Poker: ante, 3x raise and Aces Up all pay');

  // Teen Patti: a trail
  await open(ann, 'teen_patti');
  b = await bal(A);
  await deck('7s 7h 7d As Ks Qs');
  await chip(ann, 100);
  await spot(ann, /^Ante\./);
  await button(ann, 'Deal');
  await ann.getByText(/you have trail/i).waitFor();
  await button(ann, 'Fold');
  await ann.getByText('You folded.').waitFor({ timeout: 10000 });
  ok((await bal(A)) === b - 100, 'Teen Patti: folding loses the ante (even a trail)');
  await deck('7s 7h 7d As Ks Qs');
  await chip(ann, 100);
  await spot(ann, /^Ante\./);
  await button(ann, 'Deal');
  await ann.getByText(/you have trail/i).waitFor();
  await ann.getByRole('button', { name: /^Play \d/ }).click();
  await ann.getByText('You win!').waitFor({ timeout: 10000 });
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/g-teenpatti-result.png` });
  ok((await bal(A)) === b - 100 - 200 + 200 + 200 + 500, 'a trail beats a pure sequence, with the 5 to 1 ante bonus');

  // A hand left open is picked up after a reload.
  await open(ann, 'caribbean_stud');
  await deck('2s 5h 9d Jc Ks 7s 7h 7d 4s 2c');
  await chip(ann, 100);
  await spot(ann, /^Ante\./);
  await button(ann, 'Deal');
  await ann.getByRole('button', { name: /^Raise \d/ }).waitFor();
  await ann.reload();
  await ann.getByRole('button', { name: 'Fold', exact: true }).waitFor();
  ok(true, 'a hand left open is still there after a reload');
  await button(ann, 'Fold');
  await ann.getByText('You folded.').waitFor({ timeout: 10000 });

  // Video poker: Double Bonus four aces, Joker wild royal
  await open(ann, 'video_poker_double');
  b = await bal(A);
  await deck('As Ah Ad Ac 5s 2c 3c 4c 5c 6c');
  await button(ann, 'Deal');
  await ann.getByText(/You have four aces/i).waitFor();
  await button(ann, 'Hint');
  ok((await ann.locator('main button[aria-pressed="true"]').count()) === 4, 'Double Bonus: the hint keeps the four aces');
  await button(ann, 'Draw');
  await ann.getByText('Four aces!').waitFor();
  ok((await bal(A)) === b - 10 + 1600, 'four aces pays 160');
  await ann.screenshot({ path: `${SHOTS}/g-doublebonus.png` });
  await open(ann, 'video_poker_joker');
  await pool.query('insert into tests.dice (v) values (0)');
  await deck('As Ks Qs Js 2d 3d 4d 5d 6d');
  await button(ann, 'Deal');
  await ann.getByText(/You have wild royal flush/i).waitFor();
  ok((await ann.getByRole('button', { name: 'Hint' }).count()) === 0 && (await ann.getByText('Wild', { exact: true }).count()) >= 1, 'Joker Poker: the joker is marked wild (no hint on this machine)');
  await ann.screenshot({ path: `${SHOTS}/g-joker.png` });
  for (let i = 0; i < 5; i++) await ann.locator('main button[aria-pressed="false"]').first().click();
  await button(ann, 'Draw');
  await ann.getByText('Wild royal flush!').waitFor();

  // Phone widths
  const phone = await login(browser, 'ben@allin.test', { width: 390, height: 800 });
  for (const g of [...TABLE, 'video_poker_bonus']) {
    await open(phone, g);
    ok(await fits(phone), `phone: ${g} fits 390px`);
    await phone.screenshot({ path: `${SHOTS}/g-mobile-${g}.png`, fullPage: true });
  }
  await open(phone, 'four_card_poker');
  await deck('As Ah 4d 7c 9s Ks Kh 2d 5c 8s Jd');
  await chip(phone, 100);
  await spot(phone, /^Ante\./);
  await button(phone, 'Deal');
  await phone.getByRole('button', { name: /^Bet 3×/ }).waitFor();
  ok(await fits(phone), 'phone: four choices fit on one screen');
  await phone.screenshot({ path: `${SHOTS}/g-mobile-fourcard-decide.png`, fullPage: true });
  await phone.getByRole('button', { name: /^Bet 1×/ }).click();
  await phone.getByText('You win!').waitFor({ timeout: 10000 });

  ok(ann.errors.length === 0 && phone.errors.length === 0, `no page errors ${JSON.stringify([...ann.errors, ...phone.errors])}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
