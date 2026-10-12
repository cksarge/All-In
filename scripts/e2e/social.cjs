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

(async () => {
  await pool.query('delete from tests.dice; delete from tests.decks;');
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const A = 'ann@allin.test';

  // A new player: level 1, nothing waiting
  await ann.getByRole('heading', { name: 'Your progress' }).waitFor({ state: 'attached' });
  await ann.getByText(/0 \/ 100 XP to the next level/).waitFor();
  ok((await ann.getByRole('button', { name: 'Collect rewards' }).count()) === 0, 'new player: no rewards waiting');

  // One lucky spin: three sevens (150x)
  await ann.goto(`${BASE}/play/slots_classic`);
  await ann.getByRole('button', { name: 'Spin' }).waitFor();
  for (const [i, syms] of [['BLANK', 'SEVEN', 'BAR1'], ['BELL', 'SEVEN', 'BLANK'], ['CHERRY', 'SEVEN', 'BAR3']].entries()) {
    await pool.query('select tests.slot_reel($1, $2, variadic $3::text[])', ['slots_classic', i, syms]);
  }
  await ann.getByRole('button', { name: 'Spin' }).click();
  await ann.getByText('Big win!').waitFor({ timeout: 15000 });
  const after = await bal(A);
  ok(after === 10000 - 10 + 1500, 'the spin paid exactly its own win: rewards are not added by themselves');
  await ann.getByRole('button', { name: '← Lounge' }).click();
  await ann.waitForURL('**/lounge');
  await ann.getByText(/achievements unlocked/).waitFor({ timeout: 8000 });
  ok(true, 'back in the lounge: told about the new achievements');
  await ann.getByRole('button', { name: 'Collect rewards' }).waitFor();
  await ann.screenshot({ path: `${SHOTS}/s-lounge-rewards.png` });
  const waiting = Number((await q(`select (select coalesce(sum(a.reward_chips), 0) from public.player_achievements pa join public.achievements a on a.key = pa.achievement_key join auth.users u on u.id = pa.user_id where u.email = $1 and pa.claimed_at is null) + (select coalesce(sum(200 * g), 0) from public.player_progress p join auth.users u on u.id = p.user_id, generate_series(p.claimed_level + 1, p.level) g where u.email = $1) as n`, [A])).n);
  ok(waiting >= 250 + 500 + 5000 + 500, `rewards waiting for First Chip, Tenfold, Hundredfold and Nice Hit (${waiting})`);
  await ann.getByRole('button', { name: 'Collect rewards' }).click();
  await ann.getByText('Rewards collected').waitFor();
  ok((await bal(A)) === after + waiting, 'collected: the chips arrived');

  // Profile
  await ann.goto(`${BASE}/profile`);
  await ann.getByRole('heading', { name: 'Achievements' }).waitFor();
  await ann.getByText(/of 59 unlocked/).waitFor();
  ok((await ann.getByText('(unlocked)').count()) >= 4, 'profile lists the unlocked achievements');
  await ann.waitForTimeout(400);
  await ann.screenshot({ path: `${SHOTS}/s-profile.png`, fullPage: true });

  // Locker: jump to level 21 and dress up
  await pool.query(`select private.add_xp(id, 40000) from auth.users where email = $1`, [A]);
  await ann.goto(`${BASE}/locker`);
  await ann.getByRole('heading', { name: 'Locker' }).waitFor();
  await ann.getByRole('button', { name: /Dragon/ }).click();
  await ann.getByRole('button', { name: /Dragon.*Equipped/s }).waitFor();
  ok((await ann.getByRole('button', { name: /The Whale/ }).isDisabled()), 'locker: an unearned avatar is locked');
  await ann.getByRole('tab', { name: /Frames/ }).click();
  await ann.getByRole('button', { name: /^Gold/ }).click();
  await ann.getByRole('tab', { name: /Titles/ }).click();
  await ann.getByRole('button', { name: /Lucky/ }).click();
  await ann.getByRole('tab', { name: /Card backs/ }).click();
  await ann.getByRole('button', { name: /Sapphire/ }).click();
  await ann.getByRole('tab', { name: /Table felts/ }).click();
  await ann.getByRole('button', { name: /Midnight Blue/ }).click();
  await ann.getByRole('button', { name: /Midnight Blue.*Equipped/s }).waitFor();
  await ann.getByRole('tab', { name: /Avatars/ }).click();
  await ann.waitForTimeout(300);
  await ann.screenshot({ path: `${SHOTS}/s-locker.png`, fullPage: true });
  const look = (await q(`select l.avatar, l.frame, l.title, l.card_back, l.felt from public.player_loadouts l join auth.users u on u.id = l.user_id where u.email = $1`, [A]));
  ok(look.avatar === 'avatar_dragon' && look.frame === 'frame_gold' && look.title === 'title_lucky' && look.card_back === 'back_sapphire' && look.felt === 'felt_midnight', 'locker: five items equipped');
  await ann.goto(`${BASE}/play/video_poker_jacks`);
  await ann.getByRole('button', { name: 'Deal' }).waitFor();
  await ann.waitForTimeout(900);
  await ann.screenshot({ path: `${SHOTS}/s-felt-and-backs.png` });
  ok((await ann.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--felt-base').trim())) === '#0d1b3a', 'the equipped felt colours the tables');

  // Friends
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });
  await ann.goto(`${BASE}/friends`);
  await ann.getByLabel('Player name').fill('be');
  await ann.getByRole('button', { name: 'Search' }).click();
  await ann.getByRole('button', { name: 'Add friend' }).click();
  await ann.getByText('Waiting for an answer').waitFor();
  await ben.goto(`${BASE}/friends`);
  await ben.getByRole('heading', { name: 'Friend requests' }).waitFor();
  await ben.screenshot({ path: `${SHOTS}/s-friends-request-mobile.png`, fullPage: true });
  await ben.getByRole('button', { name: 'Accept' }).click();
  await ben.getByText('Your friends (1)').waitFor();
  ok(true, 'friends: request sent and accepted');
  // Ben sits at a roulette table; Ann follows him there.
  await ben.goto(`${BASE}/lobby?game=roulette`);
  await ben.locator('li', { hasText: 'Riviera Wheel' }).getByRole('button', { name: 'Sit down' }).click();
  await ben.waitForURL('**/table/*');
  await ann.reload();
  await ann.getByRole('link', { name: 'Join their table' }).waitFor({ timeout: 10000 });
  await ann.screenshot({ path: `${SHOTS}/s-friends.png` });
  await ann.getByRole('link', { name: 'Join their table' }).click();
  await ann.waitForURL('**/table/*');
  ok(ann.url() === ben.url(), 'friends: "Join their table" goes to the same table');
  await ann.getByRole('button', { name: 'Take a seat' }).click();
  await ann.waitForTimeout(1500);
  await ann.screenshot({ path: `${SHOTS}/s-table-avatars.png` });
  await ann.getByRole('button', { name: '← Leave table' }).click();
  await ann.waitForURL('**/lobby*');

  // Leaderboards and someone else's profile
  await ann.goto(`${BASE}/leaderboards`);
  const board = ann.locator('ol > li');
  await board.first().waitFor();
  ok((await board.first().textContent()).includes('Ann'), 'leaderboard: Ann leads on level');
  await ann.screenshot({ path: `${SHOTS}/s-leaderboard.png` });
  await ann.getByRole('tab', { name: 'This week' }).click();
  await ann.getByText(/Net chips won since Monday/).waitFor();
  await board.first().waitFor();
  await ann.waitForTimeout(400);
  ok((await board.count()) === 1, 'weekly board: only who has played this week');
  await ann.getByRole('tab', { name: 'Chips' }).click();
  await ann.getByRole('radio', { name: 'Friends' }).click();
  await ann.getByText('among your friends').waitFor();
  await ann.getByRole('link', { name: 'Ben' }).waitFor();
  await ann.waitForTimeout(300);
  ok((await board.count()) === 2, 'friends board: Ann and Ben');
  await ann.getByRole('link', { name: 'Ben' }).click();
  await ann.waitForURL('**/profile/Ben');
  await ann.getByRole('button', { name: /Friends ✓/ }).waitFor();
  ok(true, "profile: Ben's page shows you are friends");

  // Phones
  for (const path of ['/lounge', '/profile', '/locker', '/friends', '/leaderboards']) {
    await ben.goto(BASE + path);
    await ben.waitForTimeout(900);
    ok(await fits(ben), `${path} fits a 390px phone`);
    await ben.screenshot({ path: `${SHOTS}/s-mobile${path.replace('/', '-')}.png`, fullPage: true });
  }
  const tiny = await login(browser, 'cat@allin.test', { width: 360, height: 740 });
  for (const path of ['/profile/Ann', '/locker', '/leaderboards']) {
    await tiny.goto(BASE + path);
    await tiny.waitForTimeout(900);
    ok(await fits(tiny), `${path} fits 360px`);
  }

  const errors = ann.errors.concat(ben.errors, tiny.errors);
  ok(!errors.length, `no page errors ${JSON.stringify(errors)}`);
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  await browser.close();
  await pool.end();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
