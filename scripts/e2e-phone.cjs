// Deeper checks of the attendee phone page (public/index.html) against a local server.
//   BASE=http://localhost:8897 node scripts/e2e-phone.cjs
// Options (environment):
//   ENGINE=webkit       run in WebKit instead of Chromium
//   SHOTS=<folder>      save the look screenshots there (390x844 unless the name says otherwise)
//   ONLY=signin,myday   run only these parts: signin, myday, stars, live, react, takeaway, people, photos,
//                       offline, polling, layout, arabic, after
// It imports the sample people of scripts/seed.sh again, plus test people made up for this run, so run it after
// `bash scripts/seed.sh <base>`. It moves the server clock with rehearsals and clears the rehearsal at the end.
// Local server only. Exits with 1 when a check fails.
const { chromium, webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8897';
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE + '/')) { console.error('Refusing ' + BASE + '. These checks write test data and are for a local server only.'); process.exit(1); }
const PIN = process.env.REMOTE_PIN || '123456';
const SHOTS = process.env.SHOTS || '';
const ENGINE = process.env.ENGINE === 'webkit' ? webkit : chromium;
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = part => !ONLY.length || ONLY.includes(part);
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

/* ---------- results ---------- */
let fails = 0, passes = 0;
function check(name, ok, detail) {
  if (ok) { passes++; console.log('  pass  ' + name + (detail ? '  (' + detail + ')' : '')); }
  else { fails++; console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
  return ok;
}
const part = t => console.log('\n' + t);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 150) { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch (e) {} await sleep(step); } return v; }

/* ---------- server helpers ---------- */
async function op(body) {
  const r = await fetch(BASE + '/api/op', { method: 'POST', headers: { 'x-pin': PIN, 'x-who': 'Phone test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error('op ' + body.action + ': ' + (d.error || r.status)); return d;
}
async function api(p, dev, body) {
  const r = await fetch(BASE + p, { method: body ? 'POST' : 'GET', headers: { 'x-dev': dev, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({})); return { status: r.status, d };
}
const rehearse = hhmm => op({ action: 'rehearsal', hhmm });

// The sample people come from scripts/seed.sh, so their last 4 digits live in one place.
function seedPeople() {
  const src = fs.readFileSync(path.join(__dirname, 'seed.sh'), 'utf8');
  const m = src.match(/"action":"peopleImport","people":(\[[\s\S]*?\])\}'/);
  if (!m) throw new Error('Could not read the sample people from scripts/seed.sh');
  return JSON.parse(m[1]);
}
const RUN = Array.from({ length: 3 }, () => 'bcdfghjklmnpqrstvwxz'[Math.floor(Math.random() * 20)]).join('');
const SFX = RUN[0].toUpperCase() + RUN.slice(1);
const d4 = () => String(1000 + Math.floor(Math.random() * 9000));
// Test people for this run only. Made up, clearly test data.
const T = {
  alpha: { name: `Test Alpha ${SFX}`, last4: d4(), company: 'Alpha Test Co', title: 'Founder', topics: ['AI adoption and applied AI'], advisorPref: 'local', photoOk: true },
  bravo: { name: `Test Bravo ${SFX}`, last4: d4(), company: 'Bravo Test Co', title: 'Engineer', topics: ['Business development and international sales'], advisorPref: 'remote', photoOk: true },
  charlie: { name: `Test Charlie ${SFX}`, last4: d4(), company: 'Charlie Test Co', title: 'Designer', topics: ['Product management and strategy'], advisorPref: '', photoOk: true },
  delta: { name: `Test Delta ${SFX}`, last4: d4(), company: 'Delta Test Co', title: 'Analyst', topics: ['Career growth and remote work'], advisorPref: 'local', photoOk: true },
  seat: { name: `Test Seat ${SFX}`, last4: d4(), company: 'Seat Test Co', title: 'Analyst', topics: ['Career growth and remote work'], advisorPref: 'local', photoOk: true, rooms: { '1': '1C', '2': '2A' }, slot: { who: 'rand', s: '11:15' } },
  arabic: { name: `سارة ${['عودة', 'حداد', 'نصار'][Math.floor(Math.random() * 3)]} ${SFX}`, last4: d4(), company: 'شركة تجريبية', title: 'Designer', topics: ['Product management and strategy'], advisorPref: '', photoOk: true },
  lock: { name: `Test Lock ${SFX}`, last4: d4(), company: '', title: '', topics: [], advisorPref: '', photoOk: true },
  three: { name: `Test Three ${SFX}`, last4: d4(), company: '', title: '', topics: [], advisorPref: '', photoOk: true },
  forget: { name: `Test Forget ${SFX}`, last4: d4(), company: 'Forget Test Co', title: 'Analyst', topics: [], advisorPref: '', photoOk: true }
};
const SEED = seedPeople();
const seed = n => SEED.find(p => p.name.startsWith(n));
async function idOf(name, dev) { const r = await api('/api/who?q=' + encodeURIComponent(name), dev); return r.d.list && r.d.list.find(x => x.name === name).id; }
let devN = 0;
const newDev = () => 'phonetest' + RUN + String(++devN).padStart(4, '0');
async function claim(person, dev) { const id = await idOf(person.name, dev); return api('/api/claim', dev, { id, last4: person.last4, hello: true }); }

/* ---------- browser helpers ---------- */
let browser;
const pageProblems = [];
async function phone(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: opts.w || 390, height: opts.h || 844 }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: ENGINE === chromium, hasTouch: true, locale: 'en-US' });
  if (opts.dev) await ctx.addInitScript(([d, skip]) => { try { if (!sessionStorage.getItem('md_test_init')) { sessionStorage.setItem('md_test_init', '1'); localStorage.setItem('md_dev', d); if (skip) localStorage.setItem('md_skip', '1'); } } catch (e) {} }, [opts.dev, opts.skip !== false]);
  const p = await ctx.newPage();
  const label = opts.label || 'phone';
  p.on('pageerror', e => pageProblems.push(label + ' pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_INTERNET_DISCONNECTED|net::ERR/.test(m.text())) pageProblems.push(label + ' console: ' + m.text()); });
  p.ctx = ctx;
  return p;
}
async function shot(p, name) { if (!SHOTS) return; await sleep(350); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); }
async function shotFull(p, name) { if (!SHOTS) return; await sleep(350); await p.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true }); }
const text = (p, sel) => p.locator(sel).first().innerText().catch(() => '');
const visible = (p, sel) => p.locator(sel).first().isVisible().catch(() => false);
async function go(p, url) { await p.goto(BASE + url); await p.waitForLoadState('domcontentloaded'); }
async function topHas(p, s, ms = 8000) { return until(async () => (await text(p, '#top')).includes(s), ms); }

// Signs in through the sheet of variant v. Returns nothing; checks the result.
async function signInUI(p, person, v) {
  await p.fill('#siQ', person.name.split(' ').slice(1).join(' '));
  const btn = p.locator(`.res button[data-name="${person.name}"]`);
  await btn.waitFor({ timeout: 8000 }); await btn.click();
  await p.locator('#siD').fill(person.last4);
  if (v === 'a') { await p.locator('[data-act=si-claim]').waitFor(); await p.click('[data-act=si-claim]'); }
  else await p.click('[data-act=si-claim]');
  await until(async () => !(await visible(p, '#sheet')), 8000);
}

(async () => {
  browser = await ENGINE.launch();
  console.log(`Phone checks on ${BASE} in ${ENGINE.name()}, run ${RUN}`);
  await op({ action: 'rehearsal', hhmm: null }).catch(() => {});
  await op({ action: 'rx', mode: 'auto' });
  await op({ action: 'peopleImport', people: SEED.concat(Object.values(T)) });
  // The seed holds the words poll p1 open; keep it so for these checks.
  await op({ action: 'pollActivate', pid: 'p1' });

  try {
  /* ---------- sign in ---------- */
  if (want('signin')) {
    for (const v of ['a', 'b']) {
      part(`Sign in, variant ${v.toUpperCase()}`);
      const p = await phone({ label: 'signin ' + v });
      await go(p, `/?v=${v}`);
      check('the sheet opens on first visit', await until(() => visible(p, '#sheet')));
      await shot(p, `signin_${v}_1_open`);
      // search
      const who = v === 'a' ? T.alpha : T.bravo;
      await p.fill('#siQ', 'Te');
      check('fewer than 3 letters asks for more', (await text(p, '#siHint')).includes('at least 3'));
      await p.fill('#siQ', who.name.split(' ').slice(1).join(' '));
      check('results come as you type', await until(async () => (await p.locator('.res button').count()) > 0));
      check('the name is in the results', await visible(p, `.res button[data-name="${who.name}"]`));
      await shot(p, `signin_${v}_2_search`);
      await p.click(`.res button[data-name="${who.name}"]`);
      check('four digit boxes show', (await p.locator('#siBoxes i').count()) === 4);
      check('the digit field asks for numbers', (await p.getAttribute('#siD', 'inputmode')) === 'numeric');
      await shot(p, `signin_${v}_3_digits`);
      // a wrong code shows the tries left
      const wrong = who.last4 === '0000' ? '1111' : '0000';
      let claimBody = null;
      p.on('request', r => { if (r.url().endsWith('/api/claim')) claimBody = r.postDataJSON(); });
      await p.locator('#siD').fill(wrong);
      if (v === 'a') {
        check('variant A asks the hello question as step 3', await until(() => visible(p, '#siH')));
        await shot(p, `signin_${v}_4_hello`);
        await p.click('[data-act=si-claim]');
      } else {
        check('variant B shows the hello switch with the digits', await visible(p, 'label.sw[for=siH]'));
        await shot(p, `signin_${v}_4_hello`);
        await p.click('[data-act=si-claim]');
      }
      check('a wrong code says so', await until(async () => (await text(p, '#siErr')).includes('not the right number')));
      check('a wrong code shows the tries left', (await text(p, '#siErr')).includes('4 tries left'), await text(p, '#siErr'));
      await shot(p, `signin_${v}_5_wrong`);
      // the hello switch is sent as chosen
      await p.locator('#siD').fill(who.last4);
      if (v === 'b') await p.click('label.sw[for=siH]');
      else { await p.locator('label.sw[for=siH]').waitFor(); await p.click('label.sw[for=siH]'); }
      await p.click('[data-act=si-claim]');
      check('the hello line shows the first name', await until(async () => (await text(p, '#sheet')).includes('Hello, Test')));
      await shot(p, `signin_${v}_6_hello_done`);
      check('the sheet closes after sign in', await until(async () => !(await visible(p, '#sheet'))));
      check('hello off is sent as false', claimBody && claimBody.hello === false, JSON.stringify(claimBody && { hello: claimBody.hello }));
      check('My Day says who is signed in', await until(async () => (await text(p, '#acct')).includes(who.name)));
      await p.ctx.close();
    }

    part('Sign in, locked after 5 wrong codes, and the registration desk');
    for (const v of ['a', 'b']) {
      const p = await phone({ label: 'lock ' + v });
      await go(p, `/?v=${v}`);
      await until(() => visible(p, '#sheet'));
      await p.fill('#siQ', T.lock.name.split(' ').slice(1).join(' '));
      await p.locator(`.res button[data-name="${T.lock.name}"]`).click();
      for (let i = 0; i < 5; i++) {
        await p.locator('#siD').fill(T.lock.last4 === '9999' ? '8888' : '9999');
        if (v === 'a') await p.locator('[data-act=si-claim]').click();
        else await p.click('[data-act=si-claim]');
        const left = new RegExp((4 - i) + ' tr(y|ies) left');
        await until(async () => left.test(await text(p, '#siErr')) || (await text(p, '#sheet')).includes('registration desk'), 6000);
      }
      check(`variant ${v.toUpperCase()}: locked sends the person to the registration desk`, await until(async () => (await text(p, '#sheet')).includes('registration desk')), (await text(p, '#sheet')).slice(0, 120).replace(/\n/g, ' '));
      await shot(p, `signin_${v}_7_locked`);
      await p.ctx.close();
      await op({ action: 'peopleUnlock', id: await idOf(T.lock.name, newDev()) });
    }

    part('Sign in, the guest path and Not now');
    for (const v of ['a', 'b']) {
      const p = await phone({ label: 'guest ' + v });
      await go(p, `/?v=${v}`);
      await until(() => visible(p, '#sheet'));
      await p.click('[data-act=si-guest]');
      await p.fill('#siN', `Guest ${v.toUpperCase()} ${SFX}`);
      await shot(p, `signin_${v}_8_guest`);
      await p.click('[data-act=si-guestgo]');
      check(`variant ${v.toUpperCase()}: a guest is signed in`, await until(async () => (await text(p, '#acct')).includes('Guest')));
      await p.ctx.close();
    }
    {
      const p = await phone({ label: 'not now' });
      await go(p, '/');
      await until(() => visible(p, '#sheet'));
      await p.click('[data-act=si-skip]');
      check('Not now closes the sheet', await until(async () => !(await visible(p, '#sheet'))));
      await p.reload(); await sleep(1200);
      check('Not now is remembered', !(await visible(p, '#sheet')));
      check('My Day offers Sign in instead', (await text(p, '#second')).includes('Sign in'));
      // statuses the contract lists, each with its own calm sentence
      await p.click('#second [data-act=signin]');
      await p.route('**/api/who?**', r => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Too many searches. Wait a few minutes and try again.' }) }));
      await p.fill('#siQ', 'Layla');
      check('a 429 on search shows the server sentence', await until(async () => (await text(p, '#siErr')).includes('Too many searches')));
      await p.unroute('**/api/who?**');
      await p.click('[data-act=si-guest]');
      await p.route('**/api/guest', r => r.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Please use a different name.' }) }));
      await p.fill('#siN', 'Some Name'); await p.click('[data-act=si-guestgo]');
      check('a 422 on a guest name shows the server sentence', await until(async () => (await text(p, '#siErr')).includes('different name')));
      await p.unroute('**/api/guest');
      await p.ctx.close();
    }
    {
      // 409: the name is signed in on 3 phones already
      for (let i = 0; i < 3; i++) await claim(T.three, newDev());
      const p = await phone({ label: 'three phones' });
      await go(p, '/?v=a');
      await until(() => visible(p, '#sheet'));
      await p.fill('#siQ', T.three.name.split(' ').slice(1).join(' '));
      await p.locator(`.res button[data-name="${T.three.name}"]`).click();
      await p.locator('#siD').fill(T.three.last4);
      await p.locator('[data-act=si-claim]').click();
      check('a 409 on 3 phones shows the server sentence', await until(async () => (await text(p, '#siErr')).includes('3 phones')), await text(p, '#siErr'));
      await p.ctx.close();
      await op({ action: 'peopleUnlock', id: await idOf(T.three.name, newDev()) });
    }
  }

  /* ---------- My Day, every row of the table ---------- */
  // Devices of the four sample people signed in by scripts/seed.sh: seedphone0001 Layla, 0002 Omar, 0003 Rana, 0004 Yousef.
  const devs = { alpha: newDev(), bravo: newDev(), charlie: newDev(), delta: newDev(), seat: newDev(), arabic: newDev(), forget: newDev() };
  for (const k of Object.keys(devs)) { const r = await claim(T[k], devs[k]); if (r.status !== 200) console.log('  note: claim ' + k + ' answered ' + r.status); }

  if (want('myday')) {
    part('My Day: the top card follows the clock');
    const rows = [
      ['before', '', 'seedphone0001', 'See you on'],
      ['morning', '09:40', 'seedphone0001', 'Good morning, Layla'],
      ['stage_speaker', '10:10', 'seedphone0001', 'Rand Safi'],
      ['stage_video', '10:35', 'seedphone0001', 'Video Messages'],
      ['pick_auto', '10:45', devs.alpha, 'Picked for you'],
      ['pick_none', '11:50', 'seedphone0001', 'Pick your 12:00 session'],
      ['pick_own', '10:45', 'seedphone0001', 'Room A at 11:00'],
      ['five_minutes', '10:56', 'seedphone0001', 'Head to Room A now'],
      ['in_block_starred', '11:20', 'seedphone0001', 'Room A'],
      ['in_block_no_star', '12:20', 'seedphone0001', 'Sessions until 12:45'],
      ['takeaway_open', '11:42', devs.alpha, 'How was it?'],
      ['one_to_one', '10:45', devs.seat, 'Rand Safi at 11:15'],
      ['seat', '10:45', devs.seat, 'Your seat'],
      ['lunch', '14:20', 'seedphone0001', 'Lunch and Networking'],
      ['after', '15:30', 'seedphone0001', 'Thank you, Layla']
    ];
    for (const [name, t, dev, expect] of rows) {
      for (const v of ['a', 'b']) {
        const p = await phone({ dev, label: 'myday ' + name });
        await go(p, `/?v=${v}${t ? '&t=' + t : ''}`);
        const where = name === 'after' ? '#kpTop' : (name === 'one_to_one' ? '#second' : '#top');
        const ok = await until(async () => (await text(p, where)).includes(expect), 8000);
        check(`${name} (${v.toUpperCase()}) shows "${expect}"`, ok, ok ? '' : (await text(p, where)).slice(0, 160).replace(/\n/g, ' '));
        if (name === 'five_minutes') check(`five_minutes (${v.toUpperCase()}) turns the card orange and the tab title`, (await p.locator('#top .alert').count()) === 1 && (await p.title()).includes('Room A'), await p.title());
        if (name === 'pick_auto') check(`pick_auto (${v.toUpperCase()}) gives the reason and Keep and Change`, /Because you (chose|asked)/.test(await text(p, '#top')) && (await p.locator('#top [data-act=keep]').count()) === 1 && (await p.locator('#top [data-act=change]').count()) === 1);
        if (name === 'seat') check(`seat (${v.toUpperCase()}) cannot be changed`, (await p.locator('#top [data-act=change]').count()) === 0 && (await text(p, '#top')).includes('Your seat'));
        await shot(p, `myday_${v}_${name}`);
        if (v === 'a' && name === 'pick_own') await shotFull(p, 'myday_a_full_page');
        await p.ctx.close();
      }
    }
  }

  /* ---------- stars: keep, change, move ---------- */
  if (want('stars')) {
    part('Stars: a pick kept, a pick changed, a star moved');
    let p = await phone({ dev: devs.alpha, label: 'keep' });
    const stars = [];
    p.on('request', r => { if (r.url().endsWith('/api/star')) stars.push(r.postDataJSON()); });
    await go(p, '/?v=a&t=10:45');
    await topHas(p, 'Picked for you');
    await p.click('#top [data-act=keep]');
    check('Keep sends the picked session as my own', await until(() => stars.some(s => s.b === 1 && s.sid === '1B')), JSON.stringify(stars));
    check('after Keep the card says Next', await topHas(p, 'Next'));
    const me = await api('/api/me', devs.alpha);
    check('the server holds it as my own choice', me.d.stars && me.d.stars['1'] && me.d.stars['1'].by === 'own', JSON.stringify(me.d.stars && me.d.stars['1']));
    await p.ctx.close();

    p = await phone({ dev: devs.delta, label: 'change' });
    const st2 = [];
    p.on('request', r => { if (r.url().endsWith('/api/star')) st2.push(r.postDataJSON()); });
    await go(p, '/?v=b&t=10:45');
    await topHas(p, 'Picked for you');
    await p.click('#top [data-act=change]');
    check('Change shows the choices of the hour', await until(async () => (await p.locator('#top .choice').count()) === 3));
    await shot(p, 'myday_b_change_choices');
    await p.click('#top .choice[data-s="1C"]');
    check('a choice is sent', await until(() => st2.some(s => s.b === 1 && s.sid === '1C')));
    check('the card shows the new room', await topHas(p, 'Room C'));
    // move a star in the list: tapping another session in the same hour moves it
    st2.length = 0;
    // slow the answer so the optimistic change can be seen before it lands
    await p.route('**/api/star', async r => { await sleep(900); await r.continue(); });
    await p.click('.star[data-b="1"][data-s="1A"]');
    check('the star moves at once, before the server answers', (await p.getAttribute('.star[data-b="1"][data-s="1A"]', 'aria-pressed')) === 'true' && (await p.getAttribute('.star[data-b="1"][data-s="1C"]', 'aria-pressed')) === 'false');
    check('the move is sent as one star for the hour', await until(() => st2.some(s => s.b === 1 && s.sid === '1A')));
    await p.unroute('**/api/star');
    await sleep(600);
    const me2 = await api('/api/me', devs.delta);
    check('the server has the moved star', me2.d.stars['1'] && me2.d.stars['1'].sid === '1A' && me2.d.stars['1'].by === 'own');
    // tapping my own star removes it
    st2.length = 0;
    await p.click('.star[data-b="1"][data-s="1A"]');
    check('tapping my star again removes it', await until(() => st2.some(s => s.b === 1 && s.sid === null)));
    // the team seat cannot be starred away
    await p.ctx.close();
    p = await phone({ dev: devs.seat, label: 'seat' });
    await go(p, '/?v=a&t=10:45');
    await until(async () => (await p.locator('.star.lock').count()) >= 1);
    check('a team seat shows Your seat and a locked star', (await p.locator('.star.lock[disabled]').count()) >= 1 && (await text(p, '#blocks')).includes('Your seat'));
    check('the calendar button carries my sessions', /\/api\/ics\?s=/.test(await p.getAttribute('#blocks a[download]', 'href')));
    await p.ctx.close();
  }

  /* ---------- Live: polls ---------- */
  if (want('live')) {
    part('Live: a word poll and a choice poll');
    let p = await phone({ dev: devs.bravo, label: 'live words' });
    await go(p, '/?v=a#live');
    await p.locator('#word').waitFor();
    await shot(p, 'live_word_poll');
    let ans = null; p.on('request', r => { if (r.url().endsWith('/api/answer')) ans = r.postDataJSON(); });
    await p.fill('#word', 'Clarity'); await p.click('[data-act=answer-word]');
    check('a word answer is sent', await until(() => ans && ans.pid === 'p1' && ans.text === 'Clarity'));
    check('the answer is confirmed', await until(async () => (await text(p, '#pollMsg')).includes('Your answer: clarity')), await text(p, '#pollMsg'));
    await shot(p, 'live_word_poll_answered');
    await p.ctx.close();
    await op({ action: 'pollActivate', pid: 'p2' });
    p = await phone({ dev: devs.bravo, label: 'live choice' });
    await go(p, '/?v=a#live');
    await p.locator('.opt[data-act=answer]').first().waitFor();
    const opt = await p.locator('.opt[data-act=answer]').nth(1).getAttribute('data-o');
    await p.locator('.opt[data-act=answer]').nth(1).click();
    check('a choice answer is marked', await until(async () => (await p.locator('.opt[data-act=answer][aria-pressed=true]').count()) === 1 && (await text(p, '#pollMsg')).includes(opt)));
    await sleep(6500);
    check('the results show under the choices', (await p.locator('#pollRes .opt').count()) > 0);
    await shot(p, 'live_choice_poll');
    await p.ctx.close();
    await op({ action: 'pollActivate', pid: 'p1' });
  }

  /* ---------- reactions ---------- */
  if (want('react')) {
    part('Reactions: taps animate at once, batches go every 3 seconds at most');
    await op({ action: 'rx', mode: 'on' });
    const p = await phone({ dev: devs.charlie, label: 'react' });
    const sent = [];
    p.on('request', r => { if (r.url().endsWith('/api/react')) sent.push({ at: Date.now(), c: r.postDataJSON().c }); });
    await go(p, '/?v=a#live');
    await p.locator('#pad .rxb[data-k=clap]').waitFor({ timeout: 8000 });
    await shot(p, 'live_reaction_pad');
    const t0 = Date.now();
    for (let i = 0; i < 7; i++) { await p.locator('#pad .rxb[data-k=clap]').click(); await sleep(120); }
    check('a tap animates on the phone at once', (await p.locator('#pad .fly').count()) > 0);
    for (let i = 0; i < 3; i++) { await p.locator('#pad .rxb[data-k=heart]').click(); await sleep(120); }
    await p.locator('#pad .rxb[data-k=bloom]').click();
    const tapsMs = Date.now() - t0;
    await sleep(7500);
    const total = sent.reduce((a, s) => a + s.c.clap + s.c.heart + s.c.bloom, 0);
    const gaps = sent.slice(1).map((s, i) => s.at - sent[i].at);
    check('11 taps went out in few batches', sent.length >= 1 && sent.length <= Math.ceil(tapsMs / 3000) + 1, `${sent.length} batches for 11 taps in ${tapsMs} ms`);
    check('every tap is counted', total === 11, `sent ${total}`);
    check('batches are at least 3 seconds apart', gaps.every(g => g >= 2900), gaps.join(', ') + ' ms');
    const before = sent.length; await sleep(4000);
    check('nothing is sent when there is nothing to send', sent.length === before);
    // the daily cap of 150 batches is kept on the phone
    await p.evaluate(() => { const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hebron' }).format(new Date()); localStorage.setItem('md_rx', JSON.stringify({ d, n: 150 })); });
    const n0 = sent.length;
    await p.locator('#pad .rxb[data-k=heart]').click(); await sleep(3500);
    check('after 150 batches the phone sends no more', sent.length === n0);
    // the pad shows on My Day too, and goes away when reactions close
    await p.click('#t-today');
    check('the pad floats on My Day while reactions are on', await visible(p, '#pad .rxb'));
    await op({ action: 'rx', mode: 'off' });
    await p.click('#t-poll');
    check('the pad goes away when reactions close', await until(async () => !(await visible(p, '#pad .rxb')), 9000));
    await p.ctx.close();
    await op({ action: 'rx', mode: 'auto' });
  }

  /* ---------- takeaways ---------- */
  if (want('takeaway')) {
    part('Takeaways: inside and outside the window');
    await rehearse('11:50');
    let p = await phone({ dev: devs.bravo, label: 'takeaway' });
    let body = null; p.on('request', r => { if (r.url().endsWith('/api/takeaway')) body = r.postDataJSON(); });
    await go(p, '/?v=a');
    check('in the window the card asks How was it?', await until(async () => (await text(p, '#today')).includes('How was it?'), 10000));
    if (!(await p.locator('#tkCard .flb').count())) await p.locator('#tkCard .choice').first().click();
    await p.locator('#tkCard .flb[data-r="4"]').click();
    await p.fill('#tkCard input[type=text]', 'Write the follow up email the same day.');
    await p.click('#tkCard label.sw');
    await shot(p, 'takeaway_before');
    await p.click('#tkCard [data-act=tk-send]');
    check('the takeaway is sent with rating, line and name choice', await until(() => body && body.rating === 4 && body.text.startsWith('Write the follow up') && body.showName === true), JSON.stringify(body));
    check('the card says thank you and where the line is', await until(async () => (await text(p, '#today')).includes('Your line is on the big screen')));
    await shot(p, 'takeaway_after');
    await p.ctx.close();
    // outside the window: the card is not offered, and the server sentence shows if the phone clock is wrong
    await rehearse('10:30');
    p = await phone({ dev: devs.charlie, label: 'takeaway closed' });
    await go(p, '/?v=a');
    await until(async () => (await text(p, '#top')).includes('On stage now'), 9000);
    check('outside the window there is no takeaway card', !(await text(p, '#today')).includes('How was it?'));
    await p.ctx.close();
    p = await phone({ dev: devs.charlie, label: 'takeaway early' });
    await go(p, '/?v=a&t=11:50');
    await until(async () => (await text(p, '#today')).includes('How was it?'), 9000);
    if (!(await p.locator('#tkCard .flb').count())) await p.locator('#tkCard .choice').first().click();
    await p.locator('#tkCard .flb[data-r="5"]').click();
    await p.click('#tkCard [data-act=tk-send]');
    check('a send outside the window shows the server sentence', await until(async () => /Takeaways for this session (open at|are closed)/.test(await text(p, '#today'))), (await text(p, '#tkCard')).slice(-120).replace(/\n/g, ' '));
    await p.ctx.close();
    await rehearse(null);
  }

  /* ---------- People: the board, codes and ?m= ---------- */
  if (want('people')) {
    part('People: join the board, my code, We met by code and by ?m=');
    const a = await phone({ dev: devs.alpha, label: 'people A' });
    await go(a, '/?v=a#people');
    await a.locator('#mRole').waitFor();
    check('a verified person gets the form filled from registration', (await a.inputValue('#mName')) === T.alpha.name && (await a.getAttribute('#mName', 'readonly')) !== null);
    check('suggested tags from registration are picked', (await a.locator('#mLook .tagb[aria-pressed=true]').count()) >= 1);
    await shot(a, 'people_before_joining');
    await a.locator('#mOffer .tagb[data-t="Funding"]').click();
    await a.locator('#mLook .tagb[data-t="Clients"]').click();
    await a.check('#mOk');
    await a.click('#mSend');
    check('a verified card goes on the board at once', await until(async () => (await text(a, '#mcCard')).includes('You are on the board'), 9000));
    check('my 3 digit code shows', await until(async () => /^\d{3}$/.test((await text(a, '.code .num')).trim())));
    check('the QR of my code shows', await until(async () => (await a.locator('#qr svg').count()) === 1, 8000));
    const code = (await text(a, '.code .num')).trim();
    await sleep(6500);
    check('three people to meet, each with a reason', (await a.locator('#mcSugg .person').count()) === 3 && (await a.locator('#mcSugg .why').count()) === 3, (await text(a, '#mcSugg')).slice(0, 200).replace(/\n/g, ' '));
    await shot(a, 'people_on_board_code');
    await a.evaluate(() => document.getElementById('mcSugg').scrollIntoView());
    await shot(a, 'people_three_to_meet');

    // B meets A by typing the code
    const b = await phone({ dev: devs.bravo, label: 'people B' });
    await go(b, '/?v=a#people');
    await b.locator('#mRole').waitFor();
    await b.locator('#mLook .tagb[data-t="Funding"]').click();
    await b.check('#mOk'); await b.click('#mSend');
    await until(async () => (await b.locator('[data-act=meet-open]').count()) === 1, 9000);
    await b.click('[data-act=meet-open]');
    await b.fill('#mCode', code); await b.click('[data-act=meet-go]');
    check('We met with a code connects the two', await until(async () => (await text(b, '#mcMeet')).includes('You and ' + T.alpha.name)));
    await shot(b, 'people_connection_made');
    check('the connection is in My Connections', await until(async () => (await text(b, '#mcConn')).includes(T.alpha.name), 9000));
    await b.evaluate(() => document.getElementById('mcConn').scrollIntoView());
    await shot(b, 'people_my_connections');
    // a wrong code shows the server sentence
    await b.click('[data-act=meet-open]');
    await b.fill('#mCode', code === '999' ? '998' : '999'); await b.click('[data-act=meet-go]');
    check('a code nobody has shows the server sentence', await until(async () => /not on the board|your own code/.test(await text(b, '#mcMeet'))), await text(b, '#mcMeet'));
    await b.ctx.close();

    // C opens /?m=<code> before signing in: sign in, join the board, connected without typing
    const c = await phone({ label: 'people ?m=' });
    await go(c, `/?v=b&m=${code}`);
    check('?m= opens the sign in with a line about the code', await until(async () => (await text(c, '#sheet')).includes(code)));
    check('?m= leaves the address', !(new URL(c.url())).searchParams.has('m'));
    await shot(c, 'people_qr_link_signin');
    await signInUI(c, T.charlie, 'b');
    check('after sign in the page opens People with the code waiting', await until(async () => (await c.locator('#meet').isVisible()) && (await text(c, '#mcMeet')).includes(code)));
    await c.reload();
    check('the waiting code survives a reload', await until(async () => (await text(c, '#mcMeet')).includes(code)));
    await c.locator('#mRole').waitFor();
    await c.locator('#mLook .tagb[data-t="Product"]').click().catch(() => {});
    if (!(await c.locator('#mLook .tagb[aria-pressed=true]').count())) await c.locator('#mLook .tagb').first().click();
    await c.check('#mOk'); await c.click('#mSend');
    check('joining the board connects without typing', await until(async () => (await text(c, '#mcMeet')).includes('You and ' + T.alpha.name), 10000), (await text(c, '#mcMeet')).slice(0, 120));
    check('the code is used once and forgotten', (await c.evaluate(() => localStorage.getItem('md_m'))) === null);
    await c.ctx.close();
    // A sees both connections on the next snap, without calling /api/me
    await a.click('#t-today'); await a.click('#t-meet');
    check('A sees the new connections from the snap', await until(async () => (await a.locator('#mcConn .person').count()) >= 2, 14000));
    check('the mission flower counts them', await until(async () => (await text(a, '#mcCode')).includes('2 of 3'), 6000), (await text(a, '#mcCode')).replace(/\n/g, ' ').slice(0, 160));
    await a.ctx.close();
  }

  /* ---------- Photos ---------- */
  if (want('photos')) {
    part('Photos: the upload line, an upload and the gallery');
    const p = await phone({ dev: devs.charlie, label: 'photos' });
    await go(p, '/?v=a#photos');
    check('the photo line about consent shows', (await text(p, '#phUp')).includes('happy to be on the big screen'));
    check('the gallery shows approved photos', await until(async () => (await p.locator('#phGrid .grid button').count()) > 0));
    await shot(p, 'photos_tab');
    await p.setInputFiles('#file', path.join(__dirname, 'sample.jpg'));
    await until(async () => !(await p.locator('#send').isDisabled()));
    await p.fill('#cap', 'Phone test photo');
    await p.click('#send');
    check('an upload is sent and waits for the team', await until(async () => (await text(p, '#photoMsg')).includes('once the team checks it')), await text(p, '#photoMsg'));
    await p.locator('#phGrid .grid button').first().click();
    check('a photo opens full screen', await until(() => visible(p, '#viewer img')));
    await shot(p, 'photos_open');
    await p.goBack();
    check('back closes the photo and stays on the page', await until(async () => !(await visible(p, '#viewer img'))) && (await p.locator('#photo').isVisible()));
    await p.ctx.close();
  }

  /* ---------- offline queue ---------- */
  if (want('offline')) {
    part('Offline: a thin banner, a queue, and the replay');
    const p = await phone({ dev: devs.delta, label: 'offline' });
    const posts = [];
    p.on('request', r => { if (/\/api\/(answer|star)$/.test(r.url())) posts.push(r.url().split('/').pop()); });
    await go(p, '/?v=a#live');
    await p.locator('#word').waitFor();
    await p.ctx.setOffline(true);
    await p.evaluate(() => window.dispatchEvent(new Event('offline')));
    check('offline shows the banner', await until(() => visible(p, '#net')));
    await p.fill('#word', 'Patience'); await p.click('[data-act=answer-word]');
    check('the answer waits and says so', await until(async () => (await text(p, '#pollMsg')).includes('sends when you are back online')), await text(p, '#pollMsg'));
    await p.click('#t-today');
    await p.locator('.star[data-b="3"][data-s="3C"]').click();
    check('the star shows at once while offline', (await p.getAttribute('.star[data-b="3"][data-s="3C"]', 'aria-pressed')) === 'true');
    const q = await p.evaluate(() => JSON.parse(localStorage.getItem('md_q') || '[]').map(x => x.kind));
    check('both wait in the queue', q.includes('answer') && q.includes('star'), q.join(', '));
    await shot(p, 'offline_banner');
    await p.ctx.setOffline(false);
    await p.evaluate(() => window.dispatchEvent(new Event('online')));
    check('the queue is sent when the connection returns', await until(async () => (await p.evaluate(() => JSON.parse(localStorage.getItem('md_q') || '[]').length)) === 0, 9000));
    check('the banner goes away', await until(async () => !(await visible(p, '#net'))));
    const me = await api('/api/me', devs.delta);
    check('the server has the star sent from the queue', me.d.stars['3'] && me.d.stars['3'].sid === '3C');
    check('the answer and the star went out', posts.includes('answer') && posts.includes('star'), posts.join(', '));
    await p.ctx.close();
  }

  /* ---------- polling cadence ---------- */
  if (want('polling')) {
    part('Polling: 15 s on My Day, 6 s on Live and People, none while hidden, paused when idle');
    const p = await phone({ dev: devs.charlie, label: 'polling' });
    const log = { state: [], me: [], snap: [] };
    p.on('request', r => { const u = r.url(); if (u.includes('/api/state')) log.state.push(Date.now()); else if (u.includes('/api/me')) log.me.push(Date.now()); else if (u.includes('/api/snap')) log.snap.push(Date.now()); });
    await go(p, '/?v=a');
    await sleep(33000);
    const gaps = log.state.slice(1).map((t, i) => t - log.state[i]);
    check('My Day polls state every 15 seconds', gaps.length >= 1 && gaps.every(g => g > 13500 && g < 17000), gaps.join(', ') + ' ms');
    check('/api/me is called once on open, not on a timer', log.me.length === 1, log.me.length + ' calls');
    check('the snap is fetched only when it changed', log.snap.length <= 1, log.snap.length + ' calls');
    await p.click('#t-poll');
    const s0 = log.state.length; await sleep(19000);
    const live = log.state.slice(s0);
    const g2 = live.slice(1).map((t, i) => t - live[i]);
    check('Live polls state every 6 seconds', g2.length >= 2 && g2.every(g => g > 5000 && g < 7500), g2.join(', ') + ' ms');
    // hidden: no calls at all
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    const h0 = log.state.length; await sleep(15000);
    check('no state calls while hidden', log.state.length === h0, (log.state.length - h0) + ' calls in 15 s');
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    check('back in view, one call at once', await until(() => log.state.length > h0, 2000));
    await p.ctx.close();
    // idle: after 10 minutes without a touch, polling stops until the next touch
    const q = await phone({ dev: devs.charlie, label: 'idle' });
    const st = [];
    q.on('request', r => { if (r.url().includes('/api/state')) st.push(Date.now()); });
    await q.clock.install();
    await go(q, '/?v=a#live');
    await sleep(2500);
    await q.clock.fastForward(10.5 * 60 * 1000);
    await sleep(2500);
    const i0 = st.length; await sleep(16000);
    check('no state calls after 10 minutes without a touch', st.length === i0, (st.length - i0) + ' calls in 16 s');
    await q.touchscreen.tap(200, 400);
    check('the next touch polls again at once', await until(() => st.length > i0, 2500));
    await q.ctx.close();
  }

  /* ---------- layout: 320 px, targets, no scroll ---------- */
  if (want('layout')) {
    part('Layout: no horizontal scroll at 320 px, every target at least 44 px');
    for (const w of [320, 390]) {
      const p = await phone({ dev: devs.alpha, w, label: 'layout ' + w });
      await go(p, '/?v=a&t=10:45');
      await topHas(p, 'Room');
      for (const tab of ['today', 'poll', 'meet', 'photo']) {
        await p.click('#t-' + tab); await sleep(500);
        const r = await p.evaluate(() => {
          const sw = document.scrollingElement.scrollWidth, iw = window.innerWidth;
          const small = [];
          document.querySelectorAll('button, a[href], input:not([type=checkbox]):not([type=file]):not(#siD), label.sw, label.check, summary, [role=tab]').forEach(el => {
            const rc = el.getBoundingClientRect(); if (!rc.width || !rc.height) return;
            const st = getComputedStyle(el); if (st.visibility === 'hidden' || el.closest('[hidden]')) return;
            if (rc.height < 44 || rc.width < 44) small.push((el.id || el.dataset.act || el.tagName) + ' ' + Math.round(rc.width) + 'x' + Math.round(rc.height) + ' "' + (el.innerText || el.value || '').trim().slice(0, 20) + '"');
          });
          return { sw, iw, small };
        });
        check(`${w} px ${tab}: no horizontal scroll`, r.sw <= r.iw, `page ${r.sw} px wide in ${r.iw} px`);
        check(`${w} px ${tab}: every target at least 44 px`, !r.small.length, r.small.slice(0, 6).join('; '));
        if (w === 320) await shot(p, `w320_${tab}`);
      }
      await p.ctx.close();
    }
    // the sheet at 320 px
    const p = await phone({ w: 320, label: 'sheet 320' });
    await go(p, '/?v=a');
    await until(() => visible(p, '#sheet'));
    const r = await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth && document.getElementById('sheet').scrollWidth <= innerWidth);
    check('320 px: the sign in sheet fits', r);
    await shot(p, 'w320_signin_a');
    await p.ctx.close();
  }

  /* ---------- Arabic ---------- */
  if (want('arabic')) {
    part('Arabic: names and lines typed in Arabic read right to left');
    await rehearse('11:50');
    const n = await phone({ dev: devs.arabic, label: 'arabic name' });
    await go(n, '/?v=a&t=09:40');
    check('the greeting carries the Arabic first name', await until(async () => (await text(n, '#top')).includes(T.arabic.name.split(' ')[0])));
    await n.evaluate(() => document.getElementById('acct').scrollIntoView({ block: 'center' }));
    await shot(n, 'arabic_name_on_my_day');
    await n.evaluate(() => window.scrollTo(0, 0));
    await shot(n, 'arabic_greeting');
    await n.ctx.close();
    const p = await phone({ dev: devs.arabic, label: 'arabic' });
    let body = null; p.on('request', r => { if (r.url().endsWith('/api/takeaway')) body = r.postDataJSON(); });
    await go(p, '/?v=a');
    await until(async () => (await text(p, '#today')).includes('How was it?'), 10000);
    check('the Arabic name shows on My Day', await until(async () => (await text(p, '#acct')).includes(T.arabic.name)));
    check('the name element reads by its own direction', await p.evaluate(() => { const b = document.querySelector('#acct b[dir=auto]'); return !!b && getComputedStyle(b).direction === 'rtl'; }));
    if (!(await p.locator('#tkCard .flb').count())) await p.locator('#tkCard .choice').first().click();
    await p.locator('#tkCard .flb[data-r="5"]').click();
    await p.fill('#tkCard input[type=text]', 'أهم شيء أن نبدأ بمشكلة العميل');
    check('the takeaway field types right to left', await p.evaluate(() => getComputedStyle(document.querySelector('#tkCard input[type=text]')).direction === 'rtl'));
    await shot(p, 'arabic_takeaway');
    await p.click('#tkCard [data-act=tk-send]');
    check('the Arabic takeaway is sent as typed', await until(() => body && body.text === 'أهم شيء أن نبدأ بمشكلة العميل'));
    await p.ctx.close();
    await rehearse(null);
  }

  /* ---------- After the Event ---------- */
  if (want('after')) {
    part('After the Event: Keepsake, People, Photos, feedback and Remove my data');
    await rehearse('15:30');
    const p = await phone({ dev: devs.bravo, label: 'after' });
    await go(p, '/?v=a');
    check('the tabs become Keepsake, People and Photos', await until(async () => (await p.locator('#tabs [role=tab]').allInnerTexts()).join('|') === 'Keepsake|People|Photos', 10000), (await p.locator('#tabs [role=tab]').allInnerTexts()).join('|'));
    check('Keepsake thanks the person', (await text(p, '#kpTop')).includes('Thank you, Test'));
    await shot(p, 'after_keepsake');
    await p.locator('[data-act=fb-o][data-r="5"]').click();
    await p.locator('[data-act=fb-r][data-r="9"]').click();
    await p.fill('#fbT', 'Good day');
    await p.click('[data-act=fb-send]');
    check('feedback is sent and thanked', await until(async () => (await text(p, '#kpFb')).includes('Thank you for your feedback')));
    await p.click('#t-meet');
    await sleep(600);
    check('People opens on My Connections', await p.evaluate(() => { const c = document.getElementById('mcConn'), a = document.getElementById('mcAll'); return c.offsetTop < a.offsetTop && c.innerText.includes('My Connections'); }));
    await shot(p, 'after_people');
    await p.click('#t-photo');
    check('uploads are closed', await visible(p, '#phClosed') && !(await visible(p, '#phUp')));
    await shot(p, 'after_photos');
    await p.ctx.close();
    // Remove my data
    const f = await phone({ dev: devs.forget, label: 'forget' });
    await go(f, '/?v=a');
    await until(() => visible(f, '#forget'), 9000);
    f.once('dialog', d => d.accept());
    await f.click('#forget');
    check('Remove my data signs the phone out', await until(async () => (await api('/api/me', devs.forget)).d.status === 'none', 8000));
    await f.ctx.close();
    await rehearse(null);
  }
  } catch (e) {
    check('no unexpected failure', false, e.message.split('\n')[0]);
  } finally {
    await op({ action: 'rehearsal', hhmm: null }).catch(() => {});
    await op({ action: 'rx', mode: 'auto' }).catch(() => {});
    await op({ action: 'pollActivate', pid: 'p1' }).catch(() => {});
    await browser.close();
  }
  part('Page errors');
  check('no console or page errors', !pageProblems.length, [...new Set(pageProblems)].slice(0, 8).join(' | '));
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})();
