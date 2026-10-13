// Stage 12, part 3: the seasonal slot (Haunted Manor) and its season missions, the practice drills,
// a private tournament joined by code, and a club event.
// The season mission checks need October 2026's season to be running (like live.cjs).
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
const G = 'slots_haunted';
const reels = async (list) => { for (let i = 0; i < list.length; i++) await pool.query('select tests.slot_reel($1, $2, variadic $3::text[])', [G, i, list[i]]); };
const dice = (...v) => pool.query('insert into tests.dice (v) select x from unnest($1::int[]) with ordinality u(x, o) order by o', [v]);

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

(async () => {
  const id = async (email) => (await q(`select id from auth.users where email = $1`, [email])).id;
  const [annId, benId, catId] = [await id('ann@allin.test'), await id('ben@allin.test'), await id('cat@allin.test')];
  const season = (await q(`select to_char(private.live_now() at time zone 'utc', 'YYYY-MM') = '2026-10' as on`)).on;
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });

  // ---------- The seasonal game on the lounge ----------
  await ann.getByText(/Seasonal game ·/).waitFor();
  ok(await ann.getByRole('link', { name: /Haunted Manor/ }).first().isVisible(), 'the lounge puts this month\'s seasonal game on show');
  await ann.screenshot({ path: `${SHOTS}/p-lounge-seasonal.png` });
  await ben.getByText(/Seasonal game ·/).waitFor();
  ok(await fits(ben), 'phone: the lounge with the seasonal banner fits 390px');
  await ben.screenshot({ path: `${SHOTS}/p-lounge-seasonal-phone.png` });

  // ---------- Haunted Manor ----------
  await ann.goto(`${BASE}/play/${G}`);
  await ann.getByRole('button', { name: 'Spin' }).waitFor();
  ok(await ann.getByText(/^Seasonal · /).isVisible(), 'the machine says it is seasonal');
  await ann.getByRole('button', { name: 'Rules' }).click();
  ok(await ann.getByText(/ghosts may fly in/).isVisible() && await ann.getByText(/raises the multiplier by 1/).isVisible(), 'the rules explain hauntings and the midnight multiplier');
  await ann.screenshot({ path: `${SHOTS}/p-haunted-rules.png` });
  await ann.keyboard.press('Escape');
  await ann.screenshot({ path: `${SHOTS}/p-haunted-idle.png` });

  // A haunting: two cells of the second reel turn wild.
  await reels([['VAMPIRE', 'BAT', 'K'], ['J', 'Q', 'K'], ['VAMPIRE', 'BAT', 'SKULL'], ['A', 'A', 'A'], ['A', 'A', 'A']]);
  await dice(0, 0, 0, 0);
  await ann.getByRole('button', { name: 'Spin' }).click();
  await ann.getByText('2 ghosts turned wild!').waitFor({ timeout: 8000 });
  await ann.waitForTimeout(450);
  await ann.screenshot({ path: `${SHOTS}/p-haunted-ghosts.png` });
  await ann.getByText(/You win!|Big win!/).waitFor({ timeout: 10000 });
  const h1 = await q(`select returned, summary from public.game_history where user_id = $1 and game_key = $2 order by id desc limit 1`, [annId, G]);
  ok(h1.summary.haunted === true && Number(h1.summary.units) >= 280, 'a haunted spin plays out and pays with the ghost wilds');
  await ann.screenshot({ path: `${SHOTS}/p-haunted-won.png` });

  // Midnight spins: three scatters, then two winning spins lift the multiplier to 3.
  await reels([['SCATTER', 'J', 'K'], ['SCATTER', 'Q', 'A'], ['SCATTER', 'J', 'K'], ['Q', 'Q', 'Q'], ['Q', 'Q', 'Q']]);
  await dice(1);
  for (let i = 0; i < 2; i++) { await reels([['BAT', 'K', 'J'], ['BAT', 'A', 'Q'], ['BAT', 'J', 'J'], ['Q', 'Q', 'Q'], ['Q', 'Q', 'Q']]); await dice(1); }
  for (let i = 0; i < 6; i++) { await reels([['J', 'K', 'A'], ['Q', 'Q', 'Q'], ['J', 'K', 'A'], ['Q', 'Q', 'Q'], ['J', 'K', 'A']]); await dice(1); }
  await ann.getByRole('button', { name: 'Spin' }).click();
  await ann.getByText('8 Midnight Spins').waitFor({ timeout: 8000 });
  await ann.waitForTimeout(500);
  await ann.screenshot({ path: `${SHOTS}/p-haunted-midnight-banner.png` });
  await ann.getByText(/Midnight spin 3 of 8/).waitFor({ timeout: 20000 });
  ok(await ann.getByRole('status', { name: 'Midnight multiplier: times 3' }).isVisible(), 'the midnight multiplier climbs with each win');
  await ann.screenshot({ path: `${SHOTS}/p-haunted-midnight.png` });
  await ann.getByText('The clock strikes one').waitFor({ timeout: 30000 });
  await ann.screenshot({ path: `${SHOTS}/p-haunted-midnight-done.png` });
  await ann.getByRole('button', { name: 'Spin' }).waitFor({ timeout: 10000 });
  const h2 = await q(`select returned, summary from public.game_history where user_id = $1 and game_key = $2 order by id desc limit 1`, [annId, G]);
  ok(Number(h2.returned) === 38 * Number((await q(`select wagered from public.game_history where user_id = $1 and game_key = $2 order by id desc limit 1`, [annId, G])).wagered) / 10
     && h2.summary.feature === 'free' && h2.summary.top_mult === 3, 'the midnight spins pay 3.8 times the bet, as rigged');
  ok(Number((await q(`select count(*)::int as n from tests.dice`)).n) === 0, 'every rigged draw was used');

  // Phone widths
  for (const w of [390, 360]) {
    await ben.setViewportSize({ width: w, height: 800 });
    await ben.goto(`${BASE}/play/${G}`);
    await ben.getByRole('button', { name: 'Spin' }).waitFor();
    ok(await fits(ben), `phone: Haunted Manor fits ${w}px`);
  }
  await reels([['VAMPIRE', 'BAT', 'K'], ['J', 'Q', 'K'], ['VAMPIRE', 'BAT', 'SKULL'], ['A', 'A', 'A'], ['A', 'A', 'A']]);
  await dice(0, 0, 0, 0);
  await ben.getByRole('button', { name: 'Spin' }).click();
  await ben.getByText('2 ghosts turned wild!').waitFor({ timeout: 8000 });
  await ben.waitForTimeout(450);
  await ben.screenshot({ path: `${SHOTS}/p-haunted-phone.png` });
  await ben.getByText(/You win!|Big win!/).waitFor({ timeout: 10000 });
  await ben.setViewportSize({ width: 390, height: 844 });

  // ---------- Season missions ----------
  if (season) {
    await ann.goto(`${BASE}/missions`);
    await ann.getByRole('heading', { name: 'Season missions' }).waitFor();
    ok(await ann.getByText('Play 150 rounds of Haunted Manor').isVisible() && await ann.getByText('Win 60 rounds of Haunted Manor').isVisible()
       && await ann.getByText('Trigger the bonus spins on Haunted Manor 5 times').isVisible(), 'three season missions about the season\'s game');
    const sm = (await pool.query(`select slot, progress, reward_points from public.player_missions where user_id = $1 and period = 'season' order by slot`, [annId])).rows;
    ok(sm.length === 3 && sm.reduce((n, m) => n + m.reward_points, 0) === 300 && Number(sm[0].progress) === 2 && Number(sm[1].progress) === 2 && Number(sm[2].progress) === 1,
       'worth 300 points, and the two spins already count');
    await ann.screenshot({ path: `${SHOTS}/p-season-missions.png`, fullPage: true });
    await ben.goto(`${BASE}/missions`);
    await ben.getByRole('heading', { name: 'Season missions' }).waitFor();
    ok(await fits(ben), 'phone: the missions page fits 390px');
    await ben.screenshot({ path: `${SHOTS}/p-season-missions-phone.png`, fullPage: true });
  } else console.log('SKIP season missions (October 2026 is over)');

  // ---------- Out of season ----------
  await pool.query(`update public.games set season = '2020-01' where key = $1`, [G]);
  await ann.goto(`${BASE}/play/${G}`);
  await ann.getByText(/Its season is over/).waitFor();
  ok(true, 'out of season, the machine says so instead of opening');
  await ann.goto(`${BASE}/lounge`);
  await ann.getByRole('heading', { name: 'The games' }).waitFor();
  await ann.getByRole('heading', { name: 'Lucky Sevens' }).first().waitFor();
  ok((await ann.getByText('Haunted Manor').count()) === 0, 'and the lounge no longer lists it');
  await pool.query(`update public.games set season = to_char(now() at time zone 'utc', 'YYYY-MM') where key = $1`, [G]);

  // ---------- Practice ----------
  await ann.getByRole('link', { name: 'Practice' }).first().click();
  await ann.waitForURL('**/practice');
  await ann.getByRole('heading', { name: 'Blackjack: basic strategy' }).waitFor();
  ok((await ann.getByRole('link', { name: /Start the drill/ }).count()) === 7, 'seven practice drills');
  await ann.screenshot({ path: `${SHOTS}/p-practice.png`, fullPage: true });
  const bal0 = Number((await q(`select balance from public.wallets where user_id = $1`, [annId])).balance);
  const drills = ['blackjack', 'video-poker', 'showdown', 'pot-odds', 'craps', 'roulette', 'baccarat'];
  for (const d of drills) {
    await ann.goto(`${BASE}/practice/${d}`);
    await ann.getByText('Question 1').waitFor();
    if (d === 'video-poker') {
      await ann.getByRole('group', { name: 'Your answer' }).getByRole('button').first().waitFor();
      await ann.locator('button[aria-pressed]').first().click();
    }
    await ann.getByRole('group', { name: 'Your answer' }).getByRole('button').first().click();
    await ann.getByRole('button', { name: 'Next question' }).waitFor();
    const said = await ann.getByText(/^(Correct\.|Not quite\.)/).first().textContent();
    if (d === 'blackjack' || d === 'craps' || d === 'video-poker') await ann.screenshot({ path: `${SHOTS}/p-practice-${d}.png` });
    await ann.getByRole('button', { name: 'Next question' }).click();
    await ann.getByText('Question 2').waitFor();
    ok(Boolean(said) && await ann.getByText(/^[01] of 1$/).isVisible(), `practice: ${d} asks, explains and keeps score`);
  }
  ok(Number((await q(`select balance from public.wallets where user_id = $1`, [annId])).balance) === bal0, 'practice moves no chips');
  await ben.goto(`${BASE}/practice/blackjack`);
  await ben.getByText('Question 1').waitFor();
  await ben.getByRole('group', { name: 'Your answer' }).getByRole('button').first().click();
  await ben.getByRole('button', { name: 'Next question' }).waitFor();
  ok(await fits(ben), 'phone: a drill fits 390px');
  await ben.screenshot({ path: `${SHOTS}/p-practice-phone.png`, fullPage: true });
  await ben.goto(`${BASE}/practice/showdown`);
  await ben.getByText('Question 1').waitFor();
  ok(await fits(ben), 'phone: the poker drill fits 390px');
  await ben.screenshot({ path: `${SHOTS}/p-practice-showdown-phone.png`, fullPage: true });

  // ---------- A private tournament ----------
  await ann.goto(`${BASE}/tournaments`);
  await ann.getByRole('heading', { name: 'Private tournaments and club events' }).waitFor();
  await ann.getByRole('radiogroup', { name: 'Players' }).getByRole('radio', { name: '2', exact: true }).click();
  await ann.getByRole('radio', { name: 'Free entry' }).click();
  await ann.getByRole('button', { name: 'Create the tournament' }).click();
  await ann.getByRole('heading', { name: 'Private tournament', exact: true }).waitFor();
  const code = (await q(`select invite_code from public.tournaments where host = $1 and status = 'registering'`, [annId])).invite_code;
  ok(await ann.getByText(code, { exact: true }).isVisible(), 'the host gets a code to share');
  await ann.screenshot({ path: `${SHOTS}/p-private-waiting.png`, fullPage: true });
  await ben.goto(`${BASE}/tournaments`);
  await ben.getByRole('heading', { name: 'Private tournaments and club events' }).waitFor();
  ok((await ben.getByRole('heading', { name: 'Private tournament', exact: true }).count()) === 0, 'nobody else sees it');
  ok(await fits(ben), 'phone: the tournaments page fits 390px');
  await ben.getByLabel(/six-character code/).fill(code.toLowerCase());
  await ben.screenshot({ path: `${SHOTS}/p-private-join-phone.png`, fullPage: true });
  await ben.getByRole('button', { name: 'Join the tournament' }).click();
  await ben.waitForURL('**/table/*', { timeout: 10000 });
  ok(true, 'a friend joins with the code and is taken to the table');
  await refresh(ann);
  await ann.waitForURL('**/table/*', { timeout: 15000 });
  await ann.getByText(/Private tournament #/).first().waitFor({ timeout: 10000 });
  ok(true, 'the host is taken there too');
  await ann.screenshot({ path: `${SHOTS}/p-private-table.png` });
  // Ben is knocked out by leaving his seat.
  await pool.query(`delete from public.table_seats where user_id = $1`, [benId]);
  const t1 = await q(`select status from public.tournaments where host = $1 order by created_at desc limit 1`, [annId]);
  const c1 = await q(`select coalesce((counters ->> 'tourney_wins')::int, 0) as wins, coalesce((counters ->> 'tournaments_hosted')::int, 0) as hosted from public.player_progress where user_id = $1`, [annId]);
  ok(t1.status === 'finished' && c1.wins === 0 && c1.hosted === 1
     && Number((await q(`select count(*)::int as n from public.player_trophies where user_id = $1`, [annId])).n) === 0, 'it finishes; hosting is counted, but it is no tournament win and earns no trophy');
  ok(Boolean(await q(`select 1 as x from public.player_achievements where user_id = $1 and achievement_key = 'host_first'`, [annId])), 'the host earns Master of Ceremonies');

  // ---------- A club event ----------
  await pool.query(`insert into public.clubs (name, tag, invite_code, owner) values ('Night Owls', 'OWL', 'OWLS22', $1)`, [annId]);
  await pool.query(`insert into public.club_members (club_id, user_id, role) select c.id, u.id, u.role from public.clubs c, (values ($1::uuid, 'owner'), ($2::uuid, 'member'), ($3::uuid, 'member')) u(id, role) where c.tag = 'OWL'`, [annId, benId, catId]);
  await ann.goto(`${BASE}/tournaments`);
  await ann.getByRole('radio', { name: 'Event for Night Owls' }).click();
  await ann.getByRole('radio', { name: 'Entry 100 chips' }).click();
  await ann.getByRole('button', { name: 'Create the club event' }).click();
  await ann.getByRole('heading', { name: 'Night Owls event' }).waitFor();
  await ann.screenshot({ path: `${SHOTS}/p-club-event.png`, fullPage: true });
  ok(Number((await q(`select count(*)::int as n from public.notifications where kind = 'club_event' and user_id in ($1, $2)`, [benId, catId])).n) === 2, 'the club\'s members are told');
  await ben.goto(`${BASE}/inbox`);
  await ben.getByText('Ann set up a club event').waitFor();
  await ben.screenshot({ path: `${SHOTS}/p-club-event-inbox-phone.png` });
  await ben.getByRole('link', { name: 'Join' }).first().click();
  await ben.waitForURL('**/tournaments*');
  await ben.getByRole('heading', { name: 'Night Owls event' }).waitFor();
  await ben.screenshot({ path: `${SHOTS}/p-club-event-phone.png`, fullPage: true });
  await ben.getByRole('button', { name: 'Join the event' }).click();
  await ben.getByRole('button', { name: 'Give up seat' }).waitFor();
  ok(true, 'a member joins from the notification, with no code');
  const cat = await login(browser, 'cat@allin.test', { width: 1280, height: 900 });
  await cat.goto(`${BASE}/tournaments`);
  await cat.getByRole('button', { name: 'Join the event' }).click();
  await cat.waitForURL('**/table/*', { timeout: 10000 });
  await cat.getByText(/Club event #/).first().waitFor({ timeout: 10000 });
  ok(true, 'the third member fills it and it starts');
  await cat.screenshot({ path: `${SHOTS}/p-club-event-table.png` });
  await pool.query(`delete from public.table_seats where user_id = $1`, [benId]);
  await pool.query(`delete from public.table_seats where user_id = $1`, [catId]);
  ok(Boolean(await q(`select 1 as x from public.player_achievements where user_id = $1 and achievement_key = 'club_event_win'`, [annId])), 'the winner earns Club Champion');
  await ann.goto(`${BASE}/locker`);
  await ann.getByRole('heading', { name: 'Locker' }).waitFor();
  await ann.getByRole('tab', { name: /Titles/ }).click();
  await ann.getByText('Club Champion').first().waitFor();
  await ann.screenshot({ path: `${SHOTS}/p-locker-titles.png`, fullPage: true });
  ok(await ann.getByText('The Host').first().isVisible(), 'both new titles are in the locker');

  const errs = [...ann.errors, ...ben.errors, ...cat.errors];
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
