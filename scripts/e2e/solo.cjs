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
const GAMES = ['baccarat', 'video_poker_jacks', 'video_poker_deuces', 'three_card_poker', 'pai_gow_poker', 'sic_bo', 'keno', 'money_wheel'];

async function login(browser, email, vp) {
  const page = await (await browser.newContext({ viewport: vp })).newPage();
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

  // Lounge
  await ann.getByRole('tab', { name: 'Specialty' }).click();
  await ann.waitForTimeout(400);
  ok((await ann.getByText('Opening soon').count()) === 0, 'every specialty game is open');
  await ann.getByRole('tab', { name: 'All games' }).click();
  await ann.waitForTimeout(300);
  ok((await ann.getByText('Opening soon').count()) === 0, 'nothing in the lounge is still "opening soon"');
  await ann.locator('li', { hasText: 'Player, Banker or Tie' }).getByRole('link', { name: /Play now/ }).click();
  await ann.waitForURL('**/play/baccarat');

  // Baccarat
  await ann.getByRole('button', { name: 'Rules' }).waitFor();
  b = await bal(A);
  await deck('4s Ks 5h Qd');
  await chip(ann, 100);
  await spot(ann, /^Player\./);
  await chip(ann, 10);
  await spot(ann, /^Tie\./);
  await ann.screenshot({ path: `${SHOTS}/p6-baccarat-bets.png` });
  await button(ann, 'Deal');
  await ann.getByText('Player wins, 9 to 0').waitFor({ timeout: 15000 });
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/p6-baccarat-result.png` });
  ok((await bal(A)) === b - 110 + 200, 'baccarat: player bet won, tie bet lost');
  await ann.getByRole('button', { name: 'Rebet', exact: true }).click();
  await deck('Ks 4s Qd 5h');
  await button(ann, 'Deal');
  await ann.getByText('Banker wins, 9 to 0').waitFor({ timeout: 15000 });
  ok((await bal(A)) === b + 90 - 110, 'baccarat: rebet repeated the bets');

  // Jacks or Better: leave mid-hand, come back, draw a royal
  await open(ann, 'video_poker_jacks');
  b = await bal(A);
  await deck('As Ks Qs Js 2d Ts');
  await button(ann, 'Deal');
  await ann.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  await ann.reload();
  await ann.getByRole('button', { name: 'Draw', exact: true }).waitFor();
  ok((await ann.getByRole('img', { name: 'Ace of spades' }).count()) === 1, 'video poker: the hand waited through a reload');
  for (const c of ['Ace of spades', 'King of spades', 'Queen of spades', 'Jack of spades']) await ann.getByRole('button', { name: c }).click();
  await ann.screenshot({ path: `${SHOTS}/p6-videopoker-hold.png` });
  await button(ann, 'Draw');
  await ann.getByText('Royal flush!').waitFor({ timeout: 10000 });
  await ann.waitForTimeout(500);
  await ann.screenshot({ path: `${SHOTS}/p6-videopoker-royal.png` });
  ok((await bal(A)) === b - 10 + 8000, 'video poker: royal flush paid 800 for 1');

  // Deuces Wild
  await open(ann, 'video_poker_deuces');
  b = await bal(A);
  await deck('2h 9d 9s 5h Kc 9c 2d');
  await button(ann, 'Deal');
  await ann.getByText(/You have three of a kind/).waitFor();
  for (const c of ['Two of hearts', 'Nine of diamonds', 'Nine of spades']) await ann.getByRole('button', { name: c }).click();
  await button(ann, 'Draw');
  await ann.getByText('Five of a kind!').waitFor({ timeout: 10000 });
  await ann.waitForTimeout(500);
  await ann.screenshot({ path: `${SHOTS}/p6-deuces.png` });
  ok((await bal(A)) === b - 10 + 160, 'deuces wild: five of a kind paid 16 for 1');

  // Three Card Poker
  await open(ann, 'three_card_poker');
  b = await bal(A);
  await deck('As Ks Qs 2d 3h 5c');
  await chip(ann, 100);
  await spot(ann, /^Ante\./);
  await chip(ann, 25);
  await spot(ann, /^Pair Plus\./);
  await button(ann, 'Deal');
  await ann.getByText(/You have straight flush/).waitFor();
  await ann.screenshot({ path: `${SHOTS}/p6-threecard-decide.png` });
  await button(ann, 'Play');
  await ann.getByText(/doesn't qualify/).first().waitFor({ timeout: 10000 });
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/p6-threecard-result.png` });
  ok((await bal(A)) === b - 225 + 200 + 100 + 500 + 1025, `three card poker: ante, play, bonus and pair plus (balance ${await bal(A)})`);

  // Pai Gow
  await open(ann, 'pai_gow_poker');
  b = await bal(A);
  await deck('As Ah Kd Kc 7s 4h 2d Qs Jh 9d 8c 6s 4d 3h');
  await raw(52);
  await chip(ann, 100);
  await spot(ann, /^Bet\./);
  await button(ann, 'Deal');
  await ann.getByText('Tap two cards for your low hand').waitFor();
  await ann.getByRole('button', { name: 'Ace of spades' }).click();
  await ann.getByRole('button', { name: 'Ace of hearts' }).click();
  await button(ann, 'Set hands');
  await ann.getByText(/can't be stronger/).waitFor({ timeout: 5000 });
  ok(true, 'pai gow: a foul hand is refused with an explanation');
  await button(ann, 'House way');
  await ann.screenshot({ path: `${SHOTS}/p6-paigow-set.png` });
  await button(ann, 'Set hands');
  await ann.getByText('You win both hands!').waitFor({ timeout: 10000 });
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/p6-paigow-result.png` });
  ok((await bal(A)) === b - 100 + 195, 'pai gow: won both, less 5% commission');
  // the joker
  await deck('Ks Qh Jd Tc 4s 3h 9d 8c 6s 4d 3d 2c 7h 7d');
  await raw(0);
  await chip(ann, 10);
  await spot(ann, /^Bet\./);
  await button(ann, 'Deal');
  await ann.getByRole('button', { name: 'Joker' }).waitFor();
  await ann.screenshot({ path: `${SHOTS}/p6-paigow-joker.png` });
  await button(ann, 'House way');
  await button(ann, 'Set hands');
  await ann.getByText(/High: Straight/).first().waitFor({ timeout: 10000 });
  ok(true, 'pai gow: the joker completed a straight');

  // Sic Bo
  await open(ann, 'sic_bo');
  b = await bal(A);
  await raw(0, 1, 2);
  await chip(ann, 100);
  await spot(ann, /^Small\./);
  await chip(ann, 10);
  await spot(ann, /^Total 6\./);
  await spot(ann, /^Any triple\./);
  await ann.screenshot({ path: `${SHOTS}/p6-sicbo-bets.png` });
  await button(ann, 'Roll');
  await ann.getByText('1 · 2 · 3 makes 6, small').waitFor({ timeout: 10000 });
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/p6-sicbo-result.png` });
  ok((await bal(A)) === b - 120 + 200 + 180, 'sic bo: small and total 6 paid, any triple lost');

  // Keno
  await open(ann, 'keno');
  b = await bal(A);
  await raw(...same(20, 0));
  for (const n of [1, 2, 3, 4, 5]) await ann.getByRole('button', { name: String(n), exact: true }).click();
  await ann.screenshot({ path: `${SHOTS}/p6-keno-picks.png` });
  await button(ann, 'Play');
  await ann.getByText('5 of your 5 came up').waitFor({ timeout: 15000 });
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/p6-keno-result.png` });
  ok((await bal(A)) === b - 10 + 6000, 'keno: five of five paid 600 times the bet');

  // Big Six
  await open(ann, 'money_wheel');
  b = await bal(A);
  await raw(0);
  await chip(ann, 10);
  await spot(ann, /^Segment Joker\./);
  await spot(ann, /^Segment 1\./);
  await button(ann, 'Spin');
  await ann.waitForTimeout(1500);
  await ann.screenshot({ path: `${SHOTS}/p6-wheel-spinning.png` });
  await ann.getByText('It stops on Joker').waitFor({ timeout: 15000 });
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/p6-wheel-result.png` });
  ok((await bal(A)) === b - 20 + 460, 'big six: joker paid 45 to 1');
  await ann.getByRole('button', { name: 'Rules' }).click();
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/p6-wheel-rules.png` });
  await ann.getByRole('button', { name: 'Close' }).click();
  await ann.getByRole('button', { name: 'History' }).click();
  await ann.getByText('Landed on Joker').waitFor();
  ok(true, 'history lists the spin');

  // Phones
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });
  for (const g of GAMES) {
    await open(ben, g);
    ok(await fits(ben), `${g} fits a 390px phone`);
    await ben.screenshot({ path: `${SHOTS}/p6-mobile-${g}.png`, fullPage: true });
  }
  await open(ben, 'sic_bo');
  await spot(ben, /^Big\./);
  await button(ben, 'Roll');
  await ben.getByText(/makes \d+/).waitFor({ timeout: 10000 });
  await ben.screenshot({ path: `${SHOTS}/p6-mobile-sic_bo-rolled.png`, fullPage: true });
  await open(ben, 'keno');
  await button(ben, 'Quick pick');
  await button(ben, 'Play');
  await ben.getByText(/of your 5 came up/).waitFor({ timeout: 15000 });
  await ben.screenshot({ path: `${SHOTS}/p6-mobile-keno-played.png`, fullPage: true });
  const tiny = await login(browser, 'cat@allin.test', { width: 360, height: 740 });
  for (const g of ['sic_bo', 'keno', 'video_poker_jacks', 'pai_gow_poker']) {
    await open(tiny, g);
    ok(await fits(tiny), `${g} fits 360px`);
  }
  await open(tiny, 'pai_gow_poker');
  await spot(tiny, /^Bet\./);
  await button(tiny, 'Deal');
  await tiny.getByText('Tap two cards for your low hand').waitFor();
  ok(await fits(tiny), 'pai gow hand fits 360px');
  await tiny.screenshot({ path: `${SHOTS}/p6-mobile-360-paigow.png`, fullPage: true });

  const errors = ann.errors.concat(ben.errors, tiny.errors);
  ok(!errors.length, `no page errors ${JSON.stringify(errors)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
