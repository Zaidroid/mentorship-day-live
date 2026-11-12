// Measured checks for the wall (docs/PLAN.md WP4). Each check drives a real wall page against
// a local server and reads window.__md, so it proves behavior that a screenshot cannot show.
//   BASE=http://localhost:8891 node scripts/wall-check.cjs              every check, about 6 minutes
//   BASE=http://localhost:8891 node scripts/wall-check.cjs --only reload  checks whose name contains this text
//   node scripts/wall-check.cjs --list                                    names only
// Local server only, seeded with scripts/seed.sh. Some checks start and stop a rehearsal and change
// cfg (theme, reload version); each puts things back when it ends. One page is open at a time.
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8897';
const PIN = process.env.REMOTE_PIN || '123456';
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE + '/')) { console.error('Refusing ' + BASE + '. Wall checks are for a local server only.'); process.exit(1); }
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const ONLY = arg('only', '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function op(body) {
  const r = await fetch(BASE + '/api/op', { method: 'POST', headers: { 'x-pin': PIN, 'x-who': 'Wall check', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('op ' + body.action + ' answered ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return r.json();
}
async function state() { return (await fetch(BASE + '/api/state')).json(); }
async function post(path, dev, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dev': dev }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const rnd = () => Math.random().toString(36).slice(2, 10);

let browser;
// Opens a wall page; returns { p, ctx, errs, close }.
async function wall(url, size = '1920x1080') {
  const [width, height] = size.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(BASE + url);
  await p.waitForFunction(() => window.__md && window.__md.slotState.length > 0, null, { timeout: 15000 });
  return { p, ctx, errs, close: () => ctx.close().catch(() => {}) };
}
// Resolves true when the page reloads within ms. Marks the window, then waits for the mark to go.
async function reloadsWithin(p, ms) {
  await p.evaluate(() => { window.__mark = 1; });
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await sleep(250);
    const gone = await p.evaluate(() => !window.__mark).catch(() => false);
    if (gone) return true;
  }
  return false;
}
const md = (p, fn, a) => p.evaluate(fn, a);

const CHECKS = [];
const check = (name, fn) => CHECKS.push({ name, fn });

/* ---------- Task 1: plumbing ---------- */

check('theme-url-wins', async () => {
  await op({ action: 'theme', theme: 'light' });
  const w = await wall('/screen/?t=11:20&quiet&theme=dark');
  const seen = [];
  for (let i = 0; i < 4; i++) { seen.push(await md(w.p, () => document.documentElement.dataset.theme)); await sleep(2000); }
  await w.close();
  const ok = seen.every(t => t === 'dark');
  return [ok, 'theme over 8 s with cfg.theme light and theme=dark in the URL: ' + seen.join(', ')];
});

check('theme-remote-applies', async () => {
  const w = await wall('/screen/?t=11:20&quiet');
  const before = await md(w.p, () => document.documentElement.dataset.theme);
  await op({ action: 'theme', theme: 'dark' });
  await sleep(4500);
  const after = await md(w.p, () => document.documentElement.dataset.theme);
  await op({ action: 'theme', theme: 'light' });
  await sleep(4500);
  const back = await md(w.p, () => document.documentElement.dataset.theme);
  await w.close();
  return [before === 'light' && after === 'dark' && back === 'light', `no theme in the URL: ${before}, remote dark: ${after}, remote light: ${back}`];
});

check('reload-on-version', async () => {
  const w = await wall('/screen/?t=11:20&quiet');
  await sleep(3500);
  await op({ action: 'reload' });
  const t1 = Date.now(); const did = await reloadsWithin(w.p, 9000); const took = Date.now() - t1;
  await w.p.waitForFunction(() => window.__md && window.__md.RELOAD.seen !== null, null, { timeout: 15000 }).catch(() => {});
  const again = await reloadsWithin(w.p, 9000);
  await w.close();
  return [did && !again, `reloaded ${did ? 'after ' + took + ' ms' : 'no'}; reloaded again in the next 9 s: ${again ? 'yes' : 'no'}`];
});

check('reload-waits-for-moment', async () => {
  // At 10:55:00 the 5 minute call takes the wall for 25 seconds.
  const w = await wall('/screen/?t=10:54:57&quiet');
  await w.p.waitForFunction(() => !!window.__md.S.momentKey, null, { timeout: 10000 });
  await op({ action: 'reload' });
  await w.p.evaluate(() => { window.__mark = 1; });
  // Sample every 300 ms until the page reloads. The moment ends at 10:55:25 on the wall clock and the
  // reload may come in that same tick, so the proof is the wall clock at the last sample before the reload.
  let last = null, reloaded = false, allMoment = true;
  const end = Date.now() + 40000;
  while (Date.now() < end) {
    await sleep(300);
    const r = await w.p.evaluate(() => { const v = window.__md && window.__md.venue(); return { mark: !!window.__mark, moment: !!(window.__md && window.__md.S.momentKey), sec: v ? v.h * 3600 + v.m * 60 + v.s : 0 }; }).catch(() => null);
    if (!r) continue;
    if (!r.mark) { reloaded = true; break; }
    if (!r.moment) allMoment = false;
    last = r;
  }
  await w.close();
  const endSec = 10 * 3600 + 55 * 60 + 25, f = s => `10:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const ok = reloaded && allMoment && last && last.sec >= endSec - 1;
  return [ok, `moment showing at every sample until the reload: ${allMoment}; last sample before the reload at ${last ? f(last.sec) : 'none'} on the wall clock (moment ends ${f(endSec)}); reloaded: ${reloaded}`];
});

check('heartbeat', async () => {
  const w = await wall('/screen/?t=11:20&quiet');
  const beats = [];
  w.p.on('request', r => { if (r.url().endsWith('/api/beat') && r.method() === 'POST') { try { beats.push(JSON.parse(r.postData())); } catch (e) { beats.push({ bad: r.postData() }); } } });
  await w.p.evaluate(() => setTimeout(() => { throw new Error('wall check test error'); }, 10));
  await sleep(10500);
  const errAfter = await md(w.p, () => window.__md.ERR.last);
  await w.close();
  const b = beats[0] || {};
  const keys = ['w', 'h', 'dpr', 'layout', 'mode', 'scenes', 'lite', 'fps', 'err', 'at'];
  const missing = keys.filter(k => !(k in b));
  const opr = await (await fetch(BASE + '/api/op', { headers: { 'x-pin': PIN, 'x-who': 'Wall check' } })).json();
  const ok = beats.length === 1 && !missing.length && /wall check test error/.test(b.err) && errAfter === '' && opr.screen && opr.screen.age < 30;
  return [ok, `beats in 10.5 s: ${beats.length}; fields missing: ${missing.join(',') || 'none'}; err sent: "${(b.err || '').slice(0, 40)}"; err cleared after: ${errAfter === ''}; remote sees beat age ${opr.screen && opr.screen.age} s, scenes ${JSON.stringify(b.scenes)}, fps ${b.fps}, lite ${b.lite}`];
});

check('watchdog', async () => {
  const w = await wall('/screen/?t=11:20&quiet');
  await w.p.evaluate(() => { window.__md.WD.frozen = true; });
  const t1 = Date.now(); const did = await reloadsWithin(w.p, 30000); const took = Date.now() - t1;
  await w.p.waitForFunction(() => window.__md, null, { timeout: 15000 }).catch(() => {});
  const ticking = await md(w.p, () => Date.now() - window.__md.WD.tick < 3000).catch(() => false);
  await w.close();
  return [did && took >= 19000 && took < 26000 && ticking, `main loop stopped: page reloaded ${did ? 'after ' + took + ' ms' : 'no'}; loop ticking after the reload: ${ticking}`];
});

check('clock-rule', async () => {
  await op({ action: 'rehearsal', hhmm: '10:20' });
  try {
    const w = await wall('/screen/?quiet');
    await sleep(4000);
    const reh = await md(w.p, () => { const v = window.__md.venue(); return { hm: v.h * 60 + v.m, use: window.__md.CLOCK.use, tag: !!document.querySelector('#conn .reh') }; });
    await w.close();
    const w2 = await wall('/screen/?quiet&t=11:20');
    await sleep(4000);
    const fixed = await md(w2.p, () => { const v = window.__md.venue(); return v.h * 60 + v.m; });
    await w2.close();
    await op({ action: 'rehearsal', hhmm: null });
    const w3 = await wall('/screen/?quiet');
    await sleep(4000);
    const real = await md(w3.p, () => { const v = window.__md.venue(); return { hm: v.h * 60 + v.m, use: window.__md.CLOCK.use }; });
    await w3.close();
    // Venue time now, from the server's own clock and zone.
    const venueNow = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Hebron', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').map(Number);
    const vn = venueNow[0] * 60 + venueNow[1];
    const ok = Math.abs(reh.hm - 620) <= 1 && reh.use && reh.tag && fixed === 680 && !real.use && Math.abs(real.hm - vn) <= 1;
    const f = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    return [ok, `rehearsal 10:20: wall at ${f(reh.hm)}, skew used ${reh.use}, tag ${reh.tag}; with t=11:20: ${f(fixed)}; after the rehearsal: ${f(real.hm)} (venue now ${f(vn)}), skew used ${real.use}`];
  } finally { await op({ action: 'rehearsal', hhmm: null }).catch(() => {}); }
});

check('polling-budget', async () => {
  // Counted from before the page loads, for 62 seconds: the load itself plus one full minute.
  const count = {}, photoIds = {};
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('request', r => { const u = new URL(r.url()); if (!u.pathname.startsWith('/api/')) return; const k = u.pathname.replace(/^\/api\/(sheet|photo)\/.*/, '/api/$1/*'); count[k] = (count[k] || 0) + 1; if (k === '/api/photo/*') photoIds[u.pathname] = (photoIds[u.pathname] || 0) + 1; });
  const t1 = Date.now();
  await p.goto(BASE + '/screen/?t=11:20&quiet');
  await sleep(62000);
  await ctx.close();
  const st = count['/api/state'] || 0, sh = count['/api/sheet/*'] || 0, bt = count['/api/beat'] || 0, sn = count['/api/snap'] || 0;
  const photoRepeats = Object.values(photoIds).filter(n => n > 1).length;
  const ok = st >= 20 && st <= 23 && sh <= 6 && bt <= 2 && sn <= 1 && !photoRepeats;
  return [ok, `requests in ${Math.round((Date.now() - t1) / 1000)} s from load: ${JSON.stringify(count)}; photos fetched twice: ${photoRepeats} (budget: state every 3 s, the 3 sheet tabs at load and every 60 s, a beat at 8 s and every 60 s, snap only when snapV changes)`];
});

(async () => {
  if (process.argv.includes('--list')) { CHECKS.forEach(c => console.log(c.name)); return; }
  browser = await chromium.launch();
  let fails = 0;
  for (const c of CHECKS.filter(c => c.name.includes(ONLY))) {
    let ok = false, detail = '';
    try { [ok, detail] = await c.fn(); } catch (e) { detail = 'threw: ' + e.message.split('\n')[0]; }
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${c.name}  ${detail}`);
  }
  await browser.close();
  console.log(`\nwall-check: ${fails ? fails + ' failed' : 'all passed'}`);
  process.exit(fails ? 1 : 0);
})();
