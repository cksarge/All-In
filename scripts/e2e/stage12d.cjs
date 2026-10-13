// Stage 12, part 4: the practice walkthroughs, and the moderator's tools: site statistics, the chat log search,
// scheduled notices and maintenance, and an appeal from a suspended player.
const { chromium } = require('playwright');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres' });
const BASE = 'http://localhost:4180';
const SHOTS = process.argv[2];
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log(c ? 'PASS' : 'FAIL', m); };
const q = async (sql, args = []) => (await pool.query(sql, args)).rows[0];
const fits = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

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

// Goes through one walkthrough, trying each choice of a "Your move" until the right one lets it carry on.
async function walk(page, key, shot) {
  await page.goto(`${BASE}/practice/learn/${key}`);
  await page.getByText(/^Step \d+ of \d+$/).waitFor();
  let wrongSeen = false;
  for (let i = 0; i < 20; i++) {
    const forward = page.getByRole('button', { name: /^(Next|Finish)$/ });
    const moves = page.getByRole('group', { name: 'Your move' }).getByRole('button');
    const n = await moves.count();
    for (let k = 0; k < n && !(await forward.isEnabled()); k++) {
      await moves.nth(k).click();
      if (!(await forward.isEnabled())) wrongSeen = wrongSeen || (await page.getByText(/^Not quite\./).count()) > 0;
    }
    if (shot && i === shot.step) await page.screenshot({ path: `${SHOTS}/${shot.name}`, fullPage: true });
    const last = (await forward.textContent()) === 'Finish';
    await forward.click();
    if (last) break;
  }
  await page.getByText('Walkthrough finished').waitFor({ timeout: 5000 });
  return wrongSeen;
}

(async () => {
  const id = async (email) => (await q(`select id from auth.users where email = $1`, [email])).id;
  const [annId, benId] = [await id('ann@allin.test'), await id('ben@allin.test')];
  await pool.query(`delete from public.admins`);
  await pool.query(`insert into public.admins (user_id) values ($1)`, [annId]);
  await pool.query(`delete from public.admin_log; update public.site_notice set message = null; update public.site_status set maintenance = false, message = null`);
  const browser = await chromium.launch();
  const ann = await login(browser, 'ann@allin.test', { width: 1280, height: 900 });
  const ben = await login(browser, 'ben@allin.test', { width: 390, height: 844 });

  // ---------- The top bar ----------
  await ann.getByRole('banner').getByText(/^10,000$/).first().waitFor();
  ok((await ann.getByRole('banner').getByText('Play chips', { exact: true }).count()) === 0, 'the top bar shows the balance without the "Play chips" tag');
  await ann.screenshot({ path: `${SHOTS}/q-header.png`, clip: { x: 0, y: 0, width: 1280, height: 70 } });

  // ---------- Practice: two sections ----------
  await ann.goto(`${BASE}/practice`);
  await ann.getByRole('heading', { name: 'Learn to play' }).waitFor();
  ok(await ann.getByRole('heading', { name: 'Drills', exact: true }).isVisible()
     && (await ann.getByRole('link', { name: /Start the walkthrough/ }).count()) === 6
     && (await ann.getByRole('link', { name: /Start the drill/ }).count()) === 7, 'practice has two sections: six walkthroughs and seven drills');
  await ann.screenshot({ path: `${SHOTS}/q-practice.png`, fullPage: true });

  // A wrong move explains itself and does not let you past.
  await ann.goto(`${BASE}/practice/learn/blackjack`);
  await ann.getByRole('button', { name: 'Next' }).click();
  await ann.getByRole('heading', { name: 'Soft hands' }).waitFor();
  ok(await ann.getByRole('button', { name: 'Next' }).isDisabled(), 'a step with a move waits for it');
  await ann.getByRole('button', { name: '7', exact: true }).click();
  ok(await ann.getByText(/^Not quite\./).isVisible() && await ann.getByRole('button', { name: 'Next' }).isDisabled(), 'a wrong move says why and lets you try again');
  await ann.screenshot({ path: `${SHOTS}/q-lesson-wrong.png` });
  await ann.getByRole('button', { name: '7 or 17' }).click();
  ok(await ann.getByRole('button', { name: 'Next' }).isEnabled(), 'the right move opens the next step');
  await ann.goto(`${BASE}/practice`);
  await ann.getByText(/you reached step 2/).waitFor();
  ok(await ann.getByRole('link', { name: /Carry on/ }).isVisible(), 'a walkthrough left half way can be carried on');

  const shots = { blackjack: { step: 5, name: 'q-lesson-blackjack.png' }, craps: { step: 2, name: 'q-lesson-craps.png' }, roulette: { step: 3, name: 'q-lesson-roulette.png' }, holdem: { step: 6, name: 'q-lesson-holdem.png' } };
  for (const key of ['blackjack', 'holdem', 'craps', 'roulette', 'baccarat', 'video-poker']) {
    await walk(ann, key, shots[key]);
    ok(true, `walkthrough: ${key} can be taken from the first step to the last`);
  }
  await ann.screenshot({ path: `${SHOTS}/q-lesson-finished.png` });
  ok(await ann.getByRole('link', { name: 'Holds drill' }).isVisible(), 'the end of a walkthrough points to its drill and the real game');
  await ann.goto(`${BASE}/practice`);
  await ann.getByRole('heading', { name: 'Learn to play' }).waitFor();
  ok((await ann.getByText('Finished ✓').count()) === 6, 'finished walkthroughs are marked');
  for (const key of ['holdem', 'craps']) {
    await ben.goto(`${BASE}/practice/learn/${key}`);
    await ben.getByText(/^Step 1 of/).waitFor();
    await ben.getByRole('button', { name: 'Next' }).click();
    await ben.getByText(/^Step 2 of/).waitFor();
    ok(await fits(ben), `phone: the ${key} walkthrough fits 390px`);
    await ben.screenshot({ path: `${SHOTS}/q-lesson-${key}-phone.png`, fullPage: true });
  }
  await ben.goto(`${BASE}/practice`);
  await ben.getByRole('heading', { name: 'Learn to play' }).waitFor();
  ok(await fits(ben), 'phone: the practice page fits 390px');

  // ---------- Site statistics ----------
  await ben.goto(`${BASE}/play/slots_classic`);
  await ben.getByRole('button', { name: 'Spin' }).click();
  await ben.getByText(/No win this time|You win|Big win/).waitFor({ timeout: 15000 });
  await ann.goto(`${BASE}/admin`);
  await ann.getByRole('tab', { name: 'stats' }).click();
  await ann.getByRole('heading', { name: 'Games, last 7 days' }).waitFor();
  ok(await ann.getByRole('rowheader', { name: 'Lucky Sevens' }).isVisible() && await ann.getByText('Players who played').isVisible()
     && await ann.getByRole('heading', { name: 'Largest balances' }).isVisible(), 'stats: the games played, the daily charts and the balances');
  ok(await ann.getByText(/signup bonus/).isVisible(), 'stats: where chips came from');
  await ann.screenshot({ path: `${SHOTS}/q-admin-stats.png`, fullPage: true });

  // ---------- Chat log search ----------
  await pool.query(`insert into public.chat_messages (channel, user_id, username, body) values ('room:crash', $1, 'Ben', 'what a flight that was')`, [benId]);
  await pool.query(`insert into public.chat_messages (channel, user_id, username, body, raw, flagged, hidden) values ('room:bingo', $1, 'Ben', 'visit my channel', 'visit my channel', 'advert', true)`, [benId]);
  await ann.getByRole('tab', { name: 'chat' }).click();
  await ann.getByLabel('Words').fill('FLIGHT');
  await ann.getByRole('button', { name: 'Search the chat' }).click();
  await ann.getByText('what a flight that was').waitFor();
  ok((await ann.getByRole('list', { name: 'Messages found' }).getByRole('listitem').count()) === 1 && await ann.getByText(/^Crash ·/).isVisible(), 'chat log: found by a word, with where it was said');
  await ann.getByLabel('Words').fill('');
  await ann.getByLabel('Where').selectOption('hidden');
  await ann.getByRole('button', { name: 'Search the chat' }).click();
  await ann.getByText('visit my channel').first().waitFor();
  ok(await ann.getByText('not delivered', { exact: true }).isVisible() && (await ann.getByText('what a flight that was').count()) === 0, 'chat log: messages the filter held back can be listed');
  await ann.screenshot({ path: `${SHOTS}/q-admin-chat.png`, fullPage: true });
  ok(Number((await q(`select count(*)::int as n from public.admin_log where action = 'chat_search'`)).n) === 2, 'chat log: each search is written to the admin log');

  // ---------- Scheduled notice ----------
  await ann.getByRole('tab', { name: 'overview' }).click();
  await ann.getByRole('heading', { name: 'Schedule a notice or maintenance' }).waitFor();
  await ann.getByLabel('Words of the notice').fill('Double XP at eight');
  await ann.getByRole('button', { name: 'Schedule', exact: true }).click();
  await ann.getByRole('list', { name: 'Scheduled' }).getByText('waiting').waitFor();
  ok(true, 'a notice can be scheduled, and waits');
  await ben.goto(`${BASE}/lounge`);
  await ben.getByRole('heading', { name: 'The games' }).waitFor();
  ok((await ben.getByText('Double XP at eight').count()) === 0, 'before its time nobody sees it');
  await pool.query(`update public.site_schedule set starts_at = now() - interval '1 minute' where kind = 'notice'`);
  await ben.reload();
  await ben.getByText('Double XP at eight').waitFor({ timeout: 10000 });
  ok(true, 'at its time the notice is up for every player');
  await ben.screenshot({ path: `${SHOTS}/q-notice-phone.png` });
  await ann.reload();
  await ann.getByRole('tab', { name: 'overview' }).click();
  await ann.getByRole('list', { name: 'Scheduled' }).getByText('running').waitFor();
  await ann.getByRole('button', { name: 'Cancel the scheduled notice' }).click();
  await ann.getByRole('list', { name: 'Scheduled' }).getByText('cancelled').waitFor();
  await ben.reload();
  await ben.getByRole('heading', { name: 'The games' }).waitFor();
  ok((await ben.getByText('Double XP at eight').count()) === 0, 'cancelling takes it down at once');

  // ---------- Scheduled maintenance ----------
  await ann.getByLabel('What').selectOption('maintenance');
  await ann.getByLabel('Words for players (optional)').fill('Upgrading the tables');
  await ann.getByRole('button', { name: 'Schedule', exact: true }).click();
  await ann.getByRole('list', { name: 'Scheduled' }).getByText('waiting').waitFor();
  await ann.screenshot({ path: `${SHOTS}/q-admin-schedule.png`, fullPage: true });
  await pool.query(`update public.site_schedule set starts_at = now() + interval '10 minutes', ends_at = now() + interval '40 minutes' where kind = 'maintenance'`);
  await ben.reload();
  await ben.getByText(/The site closes for maintenance in (9|10) minutes/).waitFor({ timeout: 10000 });
  // The warning strip is drawn before the page is (the page waits to hear about the account).
  await ben.getByRole('heading', { name: 'The games' }).waitFor();
  ok(await ben.getByRole('heading', { name: 'The games' }).isVisible(), 'players are warned during the hour before, and can still play');
  ok(await fits(ben), 'phone: the warning strip fits 390px');
  await ben.screenshot({ path: `${SHOTS}/q-maintenance-warning-phone.png` });
  await pool.query(`update public.site_schedule set starts_at = now() - interval '1 minute' where kind = 'maintenance'`);
  await ben.reload();
  await ben.getByRole('heading', { name: 'Site maintenance' }).waitFor({ timeout: 10000 });
  ok(await ben.getByText('Upgrading the tables').isVisible() && await ben.getByText(/Planned to reopen around/).isVisible(), 'at its time the site closes by itself, and says when it plans to reopen');
  await ben.screenshot({ path: `${SHOTS}/q-maintenance-phone.png` });
  await ann.reload();
  await ann.getByText(/Maintenance mode is ON/).waitFor();
  ok(true, 'the admin stays in, with the reminder strip');
  await ann.getByRole('tab', { name: 'overview' }).click();
  await ann.getByRole('button', { name: 'Cancel the scheduled maintenance' }).click();
  await ann.getByRole('list', { name: 'Scheduled' }).getByText('cancelled').first().waitFor();
  await ben.reload();
  await ben.waitForURL('**/lounge');
  await ben.getByRole('heading', { name: 'The games' }).waitFor({ timeout: 10000 });
  ok(true, 'cancelling it reopens the site');

  // ---------- An appeal ----------
  await pool.query(`insert into public.player_sanctions (user_id, banned_at, ban_reason) values ($1, now(), 'Chip dumping')
                    on conflict (user_id) do update set banned_at = now(), ban_reason = 'Chip dumping'`, [benId]);
  await ben.reload();
  await ben.getByRole('heading', { name: 'Account suspended' }).waitFor();
  await ben.getByRole('button', { name: 'Write an appeal' }).click();
  await ben.getByLabel(/Tell the moderator why/).fill('I was playing with my brother on his birthday. It will not happen again.');
  await ben.screenshot({ path: `${SHOTS}/q-appeal-phone.png`, fullPage: true });
  await ben.getByRole('button', { name: 'Send appeal' }).click();
  await ben.getByText(/is waiting for a moderator/).waitFor();
  ok(await fits(ben), 'a suspended player can send an appeal (and it fits 390px)');
  await ann.getByRole('tab', { name: 'appeals' }).click();
  await ann.getByText('I was playing with my brother on his birthday. It will not happen again.').waitFor();
  ok(await ann.getByText(/Reason given: Chip dumping/).isVisible(), 'the moderator sees the appeal and what it is about');
  await ann.getByLabel(/Your reply/).fill('Fair enough. Welcome back.');
  await ann.screenshot({ path: `${SHOTS}/q-admin-appeal.png`, fullPage: true });
  await ann.getByRole('button', { name: 'Accept' }).click();
  await ann.getByText('No appeals are waiting.').waitFor();
  ok((await q(`select banned_at from public.player_sanctions where user_id = $1`, [benId])).banned_at === null, 'accepting it lifts the suspension');
  await ben.reload();
  await ben.getByRole('heading', { name: 'The games' }).waitFor({ timeout: 10000 });
  await ben.goto(`${BASE}/inbox`);
  await ben.getByText('Your appeal was accepted').waitFor();
  ok(await ben.getByText('Moderator: Fair enough. Welcome back.').isVisible(), 'the player is back in, with the answer in the inbox');
  await ann.getByRole('button', { name: 'answered' }).click();
  await ann.getByText(/Fair enough\. Welcome back\./).waitFor();
  ok(true, 'answered appeals are kept to look back on');

  const errs = [...ann.errors, ...ben.errors];
  ok(errs.length === 0, `no page errors${errs.length ? ': ' + errs.join(' | ') : ''}`);
  await pool.query(`delete from public.admins; delete from public.site_schedule`);
  await browser.close();
  await pool.end();
  console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
