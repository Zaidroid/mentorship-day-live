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

/* ---------- Task 2: performance governor ---------- */

// Blocks the main thread for ms in every animation frame, as a slow wall computer would.
const HOG = ms => `(() => { function hog(){ if (window.__hogStop) return; const e = performance.now() + ${ms}; while (performance.now() < e); requestAnimationFrame(hog); } requestAnimationFrame(hog); })()`;
const liteFacts = () => { const g = document.querySelector('.glass'), cs = g && getComputedStyle(g); const m = window.__md; return { lite: document.documentElement.hasAttribute('data-lite'), why: m.GOV.why, fps: m.GOV.fps, avg: +m.GOV.avg.toFixed(1), bg: m.bg(), backdrop: cs ? cs.backdropFilter : '', fill: cs ? cs.backgroundColor : '' }; };

check('governor-goes-lite', async () => {
  const w = await wall('/screen/?t=11:20&quiet');
  await sleep(2500);
  const before = await md(w.p, liteFacts);
  await w.p.evaluate(HOG(32));
  const t1 = Date.now(); let took = -1;
  while (Date.now() - t1 < 15000) { await sleep(250); if (await md(w.p, () => document.documentElement.hasAttribute('data-lite'))) { took = Date.now() - t1; break; } }
  await w.p.evaluate(() => { window.__hogStop = true; });
  await sleep(4000);
  const after = await md(w.p, liteFacts);
  await w.close();
  const ok = !before.lite && took >= 3000 && took < 12000 && after.lite && after.bg.nodes === Math.ceil(after.bg.full / 2) && after.bg.max === 30 && after.backdrop === 'none' && /0\.86\)$/.test(after.fill);
  return [ok, `before: lite ${before.lite}, ${before.fps} fps; frames blocked 32 ms: lite after ${took} ms (${after.why}); 4 s after the frames are fast again: lite ${after.lite}, ${after.fps} fps; nodes ${after.bg.nodes} of ${after.bg.full}, particle cap ${after.bg.max}, glass backdrop ${after.backdrop}, fill ${after.fill}`];
});

// Headless Chromium on a busy build machine composites in software and is slow at full HD, so the
// governor rightly goes lite there. This check uses a small page, where frames are fast on any machine.
check('governor-stays-full', async () => {
  const w = await wall('/screen/?t=11:20&quiet', '640x360');
  await sleep(12000);
  const f = await md(w.p, liteFacts);
  await w.close();
  return [!f.lite && f.fps > 40, `fast frames (640x360), 12 s: lite ${f.lite}, ${f.fps} fps (${f.avg} ms), nodes ${f.bg.nodes} of ${f.bg.full}`];
});

check('governor-url-force', async () => {
  const w = await wall('/screen/?t=11:20&quiet&lite=0');
  await w.p.evaluate(HOG(32));
  await sleep(9000);
  const off = await md(w.p, liteFacts);
  await w.close();
  const w2 = await wall('/screen/?t=11:20&quiet&lite=1');
  await sleep(600);
  const on = await md(w2.p, liteFacts);
  await w2.close();
  return [!off.lite && on.lite && on.bg.nodes === Math.ceil(on.bg.full / 2), `lite=0 with frames blocked 32 ms for 9 s: lite ${off.lite} (${off.fps} fps); lite=1: lite ${on.lite} at once (${on.why}), nodes ${on.bg.nodes} of ${on.bg.full}`];
});

check('screen-check-shows-perf', async () => {
  const w = await wall('/screen/?t=11:20&quiet');
  await sleep(3500);
  await w.p.keyboard.press('k');
  await sleep(1200);
  const t = await md(w.p, () => ({ fps: (document.getElementById('ckFps') || {}).textContent || '', lite: (document.getElementById('ckLite') || {}).textContent || '', shown: !document.getElementById('check').classList.contains('hide') }));
  await w.close();
  return [t.shown && /\d+ fps/.test(t.fps) && /Lite mode (on|off)/.test(t.lite), `screen check: "${t.fps}", "${t.lite}"`];
});

/* ---------- Task 3: motion system ---------- */

// Every animation the script made (not CSS loops), with what it animates.
const scriptAnims = () => document.getAnimations().filter(a => !(a instanceof CSSAnimation) && !(a instanceof CSSTransition)).map(a => {
  const e = a.effect, t = e.getTiming(), k = e.getKeyframes(), el = e.target;
  const props = [...new Set(k.flatMap(f => Object.keys(f).filter(x => !['offset', 'easing', 'composite', 'computedOffset'].includes(x))))];
  return { dur: t.duration, ease: t.easing, props, kind: el.classList.contains('li') ? 'line' : el.classList.contains('lf') ? 'leaf' : el.classList.contains('dr') || el.classList.contains('shrule') ? 'rule' : el.classList.contains('sb') ? 'scene' : el.classList.contains('rv') ? 'block' : (el.className || el.tagName).toString().slice(0, 20), first: k[0] };
});
const TOKENS = { durations: [240, 420, 520, 900], eases: ['cubic-bezier(0.2, 0.8, 0.2, 1)', 'cubic-bezier(0.65, 0, 0.25, 1)'] };
function judgeAnims(list) {
  const bad = [];
  for (const a of list) {
    if (!TOKENS.durations.includes(a.dur)) bad.push(`${a.kind} lasts ${a.dur} ms`);
    if (!TOKENS.eases.includes(a.ease.replace(/\s+/g, ' ').replace(/,(\S)/g, ', $1'))) bad.push(`${a.kind} eases ${a.ease}`);
    const m = /cubic-bezier\(([^)]+)\)/.exec(a.ease); if (m) { const [, y1, , y2] = m[1].split(',').map(Number); if (y1 < 0 || y1 > 1 || y2 < 0 || y2 > 1) bad.push(`${a.kind} overshoots (${a.ease})`); }
    if (a.kind === 'line' && a.props.includes('opacity')) bad.push('a text line fades');
    if (a.kind === 'line' && !/translateY\(110%\)/.test(a.first.transform || '') && !/translateY\(-110%\)/.test(a.first.transform || '') && a.first.transform !== 'none') bad.push('a text line moves another way: ' + a.first.transform);
    if (a.kind === 'leaf' && !/circle\(0%/.test(a.first.clipPath || '')) bad.push('a leaf does not unfold from its corner');
    if (a.kind === 'rule' && !/scaleX\(0\)/.test(a.first.transform || '')) bad.push('a rule does not draw from the left');
    if (a.props.includes('left') || a.props.includes('top') || a.props.includes('width')) bad.push(`${a.kind} animates layout (${a.props.join(',')})`);
  }
  return [...new Set(bad)];
}

check('motion-one-system', async () => {
  const w = await wall('/screen/?t=11:20&quiet&lite=0', '1920x1080');
  await sleep(4500);
  await w.p.evaluate(() => window.__md.force('spotlight'));
  await sleep(150);
  const exit = await md(w.p, scriptAnims);
  // The exit lasts 420 ms; on a slow machine it ends a few frames later. Sample once the new scene enters.
  await w.p.waitForFunction(() => document.getAnimations().some(a => a.effect && a.effect.target && a.effect.target.classList.contains('sb') && /scale\(1\.06\)/.test(a.effect.getKeyframes()[0].transform || '')), null, { timeout: 4000 }).catch(() => {});
  await sleep(60);
  const enter = await md(w.p, scriptAnims);
  const structure = await md(w.p, () => ({ lines: document.querySelectorAll('.slot .sb .tx .ln').length, plainText: [...document.querySelectorAll('.slot .sb .tx')].filter(e => e.textContent.trim() && !e.querySelector('.ln')).length }));
  await w.close();
  const all = exit.concat(enter), bad = judgeAnims(all);
  const kinds = {}; enter.forEach(a => { kinds[a.kind] = (kinds[a.kind] || 0) + 1; });
  const exitOk = exit.some(a => a.kind === 'scene' && a.first.transform === 'none' && a.dur === 420);
  const enterOk = enter.some(a => a.kind === 'scene' && /scale\(1\.06\)/.test(a.first.transform || '') && a.dur === 900);
  const ok = !bad.length && exitOk && enterOk && (kinds.line || 0) > 0 && (kinds.leaf || 0) > 0 && (kinds.rule || 0) > 0 && structure.lines > 0 && structure.plainText === 0;
  return [ok, `Advisor Spotlight forced: scene leaves by receding: ${exitOk}; comes forward from 1.06: ${enterOk}; entering now: ${JSON.stringify(kinds)}; masked lines ${structure.lines}, text left unsplit ${structure.plainText}; faults: ${bad.join('; ') || 'none'}`];
});

check('motion-cloud-and-moment', async () => {
  const w = await wall('/screen/?t=11:20&quiet&lite=0&scene=poll', '1920x1080');
  await w.p.waitForFunction(() => document.querySelectorAll('.cloud span.new').length > 0, null, { timeout: 6000 }).catch(() => {});
  const cloud = await md(w.p, scriptAnims);
  await sleep(2500);
  const kept = await md(w.p, () => ({ words: document.querySelectorAll('.cloud span').length, stillNew: document.querySelectorAll('.cloud span.new').length }));
  await w.close();
  const w2 = await wall('/screen/?t=10:54:58&quiet&lite=0', '1920x1080');
  await w2.p.waitForFunction(() => !!window.__md.S.momentKey, null, { timeout: 8000 });
  await sleep(120);
  const mom = await md(w2.p, scriptAnims);
  await w2.close();
  const bad = judgeAnims(cloud.concat(mom));
  const words = cloud.filter(a => a.kind === 'I').length, lines = mom.filter(a => a.kind === 'line').length, panel = mom.filter(a => /scale\(1\.06\)/.test(a.first.transform || '') && a.kind !== 'scene' && a.kind !== 'block').length;
  return [!bad.length && words > 0 && kept.stillNew === kept.words && lines > 0 && panel > 0, `cloud words rising: ${words}, 2.5 s later the same words are still the ones that rose (${kept.stillNew} of ${kept.words}, no repaint cut them); moment panel comes forward: ${panel > 0}; moment lines rising: ${lines}; faults: ${bad.join('; ') || 'none'}`];
});

/* ---------- Task 4: the director ---------- */

// A wall page that sees no data at all: empty state and snap, no sheet. The schedule still comes from day.js.
const EMPTY_STATE = () => ({ t: Date.now(), reh: false, phase: 'day', cfg: { mode: 'auto', pin: null, speaker: null, theme: 'light', overlay: null, ann: null, video: null, way: null, reloadAt: 0, photoAt: null, finale: null, links: null, flags: {}, at: 1 }, poll: null, rx: { on: false, b: [], total: 0 }, n: { here: 0, board: 0, links: 0, photos: 0, takeaways: 0, answers: 0 }, interest: {}, hello: [], snapV: '0.0', tags: [], videos: [] });
async function emptyWall(url, size) {
  const [width, height] = size.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.route('**/api/state', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(EMPTY_STATE()) }));
  await ctx.route('**/api/snap**', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ at: 0, v: '0.0', photos: [], profiles: [], links: [], takeaways: [] }) }));
  await ctx.route('**/api/sheet/**', r => r.fulfill({ status: 503, body: 'no sheet in this check' }));
  await ctx.route('**/api/beat', r => r.fulfill({ status: 204, body: '' }));
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(BASE + url);
  await p.waitForFunction(() => window.__md && window.__md.slotState.length > 0, null, { timeout: 15000 });
  return { p, ctx, errs, close: () => ctx.close().catch(() => {}) };
}
// Turns every rotating slot n times (the N key) and records what each slot showed and whether it had content.
async function turns(p, n) {
  const seen = [];
  for (let k = 0; k < n; k++) {
    await p.keyboard.press('n'); await sleep(700);
    seen.push(...await p.evaluate(() => window.__md.slotState.map((st, i) => {
      const sb = st.el.querySelector('.sb'), text = sb.innerText.trim(), media = sb.querySelectorAll('img,svg').length;
      return { slot: i, role: st.role, id: st.id, content: window.__md.content(st.id), filled: text.length > 0 || media > 0, turn: st.turn };
    })));
  }
  return seen;
}

check('director-never-empty', async () => {
  const views = [['3840x1920', '/screen/?t=09:40&quiet'], ['1920x1080', '/screen/?t=11:20&quiet'], ['3840x1080', '/screen/?t=11:20&quiet'], ['3840x1920', '/screen/?t=14:20&quiet']];
  const out = []; let bad = [];
  for (const [size, url] of views) for (const empty of [false, true]) {
    const w = empty ? await emptyWall(url, size) : await wall(url, size);
    await sleep(3500);
    const seen = await turns(w.p, 12);
    const log = await md(w.p, () => window.__md.DIR.log.filter(x => x.to));
    await w.close();
    const shown = [...new Set(seen.map(s => s.id))];
    seen.filter(s => s.content === 'no' || !s.filled).forEach(s => bad.push(`${size} ${empty ? 'empty' : 'seed'}: slot ${s.slot} showed ${s.id} (${s.content}, filled ${s.filled})`));
    log.filter(x => x.content === 'no' && x.why !== 'force').forEach(x => bad.push(`${size} ${empty ? 'empty' : 'seed'}: director chose ${x.to} without content`));
    // A join prompt at most once in four turns of a slot.
    const bySlot = {}; log.forEach(x => { (bySlot[x.slot] = bySlot[x.slot] || []).push(x); });
    Object.values(bySlot).forEach(list => { let lastJoin = -9; list.forEach((x, i) => { if (x.content === 'join') { if (i - lastJoin < 4) bad.push(`${size} ${empty ? 'empty' : 'seed'}: join prompt ${x.to} after ${i - lastJoin} turns`); lastJoin = i; } }); });
    out.push(`${size}${url.match(/t=[\d:]+/)[0]}${empty ? ' empty' : ''}: ${shown.join(',')}`);
  }
  bad = [...new Set(bad)];
  return [!bad.length, `12 turns per view; shown: ${out.join(' | ')}; faults: ${bad.slice(0, 6).join('; ') || 'none'}`];
});

async function teamPhoto(caption) {
  const fs = require('fs'), path = require('path');
  const r = await fetch(BASE + '/api/photo', { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-pin': PIN, 'x-who': 'Wall check', 'x-name': 'Wall%20Check', 'x-caption': encodeURIComponent(caption) }, body: fs.readFileSync(path.join(__dirname, 'sample.jpg')) });
  return r.status;
}
async function waitFor(p, fn, ms, arg) { const end = Date.now() + ms; while (Date.now() < end) { const v = await p.evaluate(fn, arg).catch(() => null); if (v) return v; await sleep(200); } return null; }

check('director-bump-waits', async () => {
  // Two slots at 3840x1920: the secondary rotates Networking Board, Photo Wall, Live Poll and more.
  const w = await wall('/screen/?t=11:20&quiet', '3840x1920');
  await sleep(4000);
  const sec = 1;
  await w.p.evaluate(i => window.__md.force('spotlight'), sec);
  const t0 = await md(w.p, () => window.__md.slotState[1].since);
  const st1 = await teamPhoto('Wall check photo one');
  const switched = await waitFor(w.p, () => { const st = window.__md.slotState[1]; return st.id === 'photos' ? { at: st.since, bumps: window.__md.DIR.log.filter(x => x.bump) } : null; }, 16000);
  const waited = switched ? switched.at - t0 : -1;
  // A second new photo within 90 seconds: no bump.
  await w.p.evaluate(() => window.__md.force('spotlight'));
  const t1 = await md(w.p, () => window.__md.slotState[1].since);
  await teamPhoto('Wall check photo two');
  await sleep(11000);
  const after = await md(w.p, () => ({ id: window.__md.slotState[1].id, since: window.__md.slotState[1].since, bumps: window.__md.DIR.log.filter(x => x.bump).length }));
  await w.close();
  const ok = st1 === 200 && switched && waited >= 8000 && waited < 9800 && after.since === t1 && after.bumps === 1;
  return [ok, `photo approved ${Math.round((switched ? switched.bumps[0].at - t0 : 0) / 100) / 10} s into Advisor Spotlight; Photo Wall came after ${waited} ms (rule: 8000); second photo 30 s later: slot still on ${after.id} after 11 s, bumps logged ${after.bumps} (rule: once per 90 s)`];
});

check('director-poll-bump', async () => {
  const s0 = await state();
  if (!s0.poll || !s0.poll.open) return [false, 'no open poll on the server; run scripts/seed.sh first'];
  const w = await wall('/screen/?t=11:20&quiet', '3840x1920');
  await sleep(4000);
  await w.p.evaluate(() => window.__md.force('pulse'));
  const t0 = await md(w.p, () => window.__md.slotState[1].since);
  for (const word of ['clarity', 'focus', 'courage']) await fetch(BASE + '/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pid: s0.poll.id, dev: 'wallcheck' + rnd(), text: word }) });
  const sw = await waitFor(w.p, () => { const st = window.__md.slotState[1]; return st.id === 'poll' ? { at: st.since, why: window.__md.DIR.log.filter(x => x.bump === 'poll').map(x => x.why) } : null; }, 16000);
  await w.close();
  const waited = sw ? sw.at - t0 : -1;
  return [!!sw && waited >= 8000 && waited < 9800, `three answers sent 0.1 s into Live Numbers; Live Poll came after ${waited} ms (${sw ? sw.why.join(', ') : 'no bump'})`];
});

check('director-clock', async () => {
  const w = await wall('/screen/?t=11:49:56&quiet', '3840x1920');
  await sleep(1500);
  const before = await md(w.p, () => window.__md.slotState[0].id);
  const at = await waitFor(w.p, () => window.__md.slotState[0].id === 'choose' ? window.__md.venue() : null, 10000);
  await w.close();
  const w2 = await wall('/screen/?t=11:59:56&quiet', '3840x1920');
  await sleep(1500);
  const b2 = await md(w2.p, () => window.__md.slotState[0].id);
  const at2 = await waitFor(w2.p, () => window.__md.slotState[0].id === 'rooms' ? window.__md.venue() : null, 10000);
  await w2.close();
  await op({ action: 'mode', mode: 'lunch' });
  let held;
  try { const w3 = await wall('/screen/?t=11:52&quiet', '3840x1920'); await sleep(4500); held = await md(w3.p, () => ({ mode: window.__md.S.mode, ids: window.__md.slotState.map(s => s.id) })); await w3.close(); }
  finally { await op({ action: 'mode', mode: 'auto' }); }
  const f = v => v ? `${v.h}:${String(v.m).padStart(2, '0')}:${String(v.s).padStart(2, '0')}` : 'never';
  const ok = before === 'rooms' && at && at.m === 50 && b2 === 'choose' && at2 && at2.h === 12 && held.mode === 'lunch' && !held.ids.includes('choose');
  return [ok, `primary at 11:49:57: ${before}, Choose Your Sessions from ${f(at)}; at 11:59:57: ${b2}, Rooms from ${f(at2)}; remote holds lunch at 11:52: ${held.mode}, slots ${held.ids.join(',')}`];
});

check('director-dwell', async () => {
  const w = await wall('/screen/?t=11:20&quiet', '3840x1920');
  await sleep(4000);
  await w.p.evaluate(() => window.__md.force('photos'));
  const r = await md(w.p, () => ({ photos: window.__md.S.photos.length, dwell: window.__md.dwellFor(window.__md.slotState[1]), tick: window.__md.slotState[1].res.tick }));
  await w.close();
  const want = Math.max(20, Math.min(45, 4 * r.photos));
  return [r.dwell === want && r.tick >= 4 && r.tick <= 7, `${r.photos} photos: Photo Wall dwell ${r.dwell} s (rule: 4 s a photo within 20 to 45 = ${want}), big photo changes every ${r.tick.toFixed(1)} s`];
});

/* ---------- Task 5: arrival and hellos ---------- */

// A wall page whose state answers carry hellos and a here count set by the check (the rest is the real state).
async function helloWall(url, size, fake) {
  const [width, height] = size.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.route('**/api/state', async r => { const res = await r.fetch(); const j = await res.json(); fake.t = j.t; j.hello = fake.hello.slice(0, 12); j.n.here = fake.here; await r.fulfill({ response: res, body: JSON.stringify(j) }); });
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p.goto(BASE + url);
  await p.waitForFunction(() => window.__md && window.__md.slotState.length > 0, null, { timeout: 15000 });
  return { p, ctx, errs, close: () => ctx.close().catch(() => {}) };
}

for (const v of ['a', 'b']) check(`arrival-hellos-${v}`, async () => {
  // A hello from two minutes ago is in the list at load, and another old one turns up later: neither is news.
  const fake = { hello: [{ f: 'Earlier', at: Date.now() - 120000 }], here: 5, t: 0 };
  const w = await helloWall(`/screen/?t=09:40&quiet&v=${v}`, '1920x1080', fake);
  await sleep(1500);
  fake.hello = [{ f: 'Stale', at: fake.t - 90000 }].concat(fake.hello);
  await sleep(4000);
  const early = await md(w.p, () => ({ shown: document.querySelectorAll('.slot [data-hellos] .hello').length, here: (document.querySelector('[data-here]') || {}).textContent }));
  // Five people arrive at once, and the count goes from 5 to 10.
  const names = ['Layla', 'Omar', 'Mariam', 'Yousef', 'Hala'];
  fake.hello = names.map((f, i) => ({ f, at: fake.t + i })).reverse().concat(fake.hello); fake.here = 10;
  const t0 = Date.now(), firstSeen = {}, outAt = {}, counts = new Set(); let maxLive = 0;
  while (Date.now() - t0 < 16000) {
    const s = await md(w.p, () => ({ live: [...document.querySelectorAll('.slot [data-hellos] .hello')].map(e => ({ t: e.textContent.replace('Welcome, ', ''), out: e.classList.contains('out') })), here: (document.querySelector('[data-here]') || {}).textContent }));
    const now = Date.now();
    s.live.forEach(h => { if (!firstSeen[h.t]) firstSeen[h.t] = now; if (h.out && !outAt[h.t]) outAt[h.t] = now; });
    maxLive = Math.max(maxLive, s.live.filter(h => !h.out).length); counts.add(s.here);
    await sleep(100);
  }
  await w.close();
  const durs = names.map(n => firstSeen[n] && outAt[n] ? outAt[n] - firstSeen[n] : -1);
  const ok = early.shown === 0 && early.here === '5' && maxLive <= 3 && names.every(n => firstSeen[n]) && durs.every(d => d >= 3700 && d <= 4500) && counts.has('10') && [...counts].some(c => +c > 5 && +c < 10);
  return [ok, `variant ${v}: an old hello at load shown ${early.shown}, count ${early.here}; five arrive at once: most on screen at a time ${maxLive} (rule 3), all shown ${names.every(n => firstSeen[n])}, each for ${durs.map(d => (d / 1000).toFixed(1)).join(', ')} s (rule 4), count passed ${[...counts].filter(Boolean).sort((a, b) => a - b).join(' ')}`];
});

check('arrival-ticker-outside-welcome', async () => {
  const fake = { hello: [], here: 7, t: 0 };
  const w = await helloWall('/screen/?t=11:20&quiet', '1920x1080', fake);
  await sleep(1500);
  fake.hello = [{ f: 'Rana', at: fake.t }, { f: 'Karim', at: fake.t - 1000 }];
  await sleep(4500);
  const r = await md(w.p, () => ({ box: !!document.querySelector('.slot [data-hellos]'), ticker: document.getElementById('tkIn').textContent }));
  await w.close();
  const m = /Welcome, Rana and Karim/.test(r.ticker);
  return [!r.box && m, `in Sessions mode: hello column on screen ${r.box}; ticker says "Welcome, Rana and Karim": ${m}`];
});

check('arrival-qr-line', async () => {
  const want = [['09:40', 'Scan and find your name'], ['10:45', 'Scan to pick your 11:00 session'], ['11:50', 'Scan to pick your 12:00 session'], ['11:20', 'Scan to join'], ['14:20', 'Scan to meet your 3 people']];
  const got = [];
  for (const [t, line] of want) {
    const w = await wall(`/screen/?t=${t}&quiet`, '1920x1080');
    await sleep(2000);
    const r = await md(w.p, () => { const q = document.querySelector('#join .qr.ping'); return { text: (document.querySelector('#join b') || {}).textContent, ring: q ? getComputedStyle(q, '::after').animationDuration : '' }; });
    got.push([t, r.text, r.ring, r.text === line && r.ring === '20s']);
    await w.close();
  }
  const w = await wall('/screen/?t=10:45&quiet', '3840x1080');
  await sleep(2000);
  const rail = await md(w.p, () => { const q = document.querySelector('#rail .qr.ping'); return { text: (document.querySelector('#rail .qrtxt b') || {}).textContent, ring: q ? getComputedStyle(q, '::after').animationDuration : '' }; });
  await w.close();
  const ok = got.every(g => g[3]) && rail.text === 'Scan to pick your 11:00 session' && rail.ring === '20s';
  return [ok, got.map(g => `${g[0]} "${g[1]}"${g[3] ? '' : ' WRONG'}`).join('; ') + `; rail at 3840x1080 10:45 "${rail.text}"; ring every ${rail.ring}`];
});

/* ---------- Task 6: moments ---------- */

check('moment-countdown', async () => {
  const w = await wall('/screen/?t=10:59:47&quiet', '3840x1080');
  const seen = [], overlaps = []; let startAt = null, cover = null;
  const end = Date.now() + 17000;
  while (Date.now() < end) {
    const s = await md(w.p, () => {
      const v = window.__md.venue(), el = document.getElementById('moment'), cur = el.querySelector('.cd m-i:not(.old)'), old = el.querySelector('.cd m-i.old');
      // Layout boxes (offset*), not transformed ones: the panel enters from scale 1.06 and the stage recedes to .97.
      const h1 = el.querySelector('h1'), box = e => ({ left: e.offsetLeft, right: e.offsetLeft + e.offsetWidth }), r = box(el), st = box(document.getElementById('stage')), rl = box(document.getElementById('rail'));
      return { sec: v.h * 3600 + v.m * 60 + v.s + v.ms / 1000, n: cur ? cur.textContent : null, h1: h1 ? h1.textContent : null,
        overlap: cur && old ? old.getBoundingClientRect().bottom - cur.getBoundingClientRect().top : null,
        cover: el.classList.contains('show') ? { left: Math.round(r.left - st.left), right: Math.round(rl.right - r.right), stageOpacity: getComputedStyle(document.getElementById('stage')).opacity } : null };
    });
    if (s.n && seen[seen.length - 1] !== s.n) seen.push(s.n);
    if (s.overlap !== null && s.overlap > 1) overlaps.push(Math.round(s.overlap));
    if (s.h1 === 'Starting Now' && startAt === null) startAt = s.sec;
    if (s.cover && !cover && s.n) cover = s.cover;
    await sleep(80);
  }
  await w.close();
  const want = ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'], start = 11 * 3600;
  const ok = JSON.stringify(seen) === JSON.stringify(want) && startAt !== null && startAt - start < 0.6 && startAt >= start && !overlaps.length && cover && Math.abs(cover.left) <= 1 && Math.abs(cover.right) <= 1;
  return [ok, `numerals: ${seen.join(' ')}; Starting Now at ${startAt === null ? 'never' : '+' + (startAt - start).toFixed(2) + ' s'} after 11:00:00; old and new numerals overlapping during a roll: ${overlaps.length ? overlaps.join(',') + ' px' : 'never'}; at 3840x1080 the moment lines up with the stage left edge (${cover && cover.left} px) and the rail right edge (${cover && cover.right} px), stage opacity under it ${cover && cover.stageOpacity}`];
});

check('moment-call-arrows', async () => {
  const w = await wall('/screen/?t=10:54:58&quiet', '1920x1080');
  await w.p.waitForFunction(() => document.querySelectorAll('#moment .mrc').length > 0, null, { timeout: 8000 }).catch(() => {});
  await sleep(1200);
  const a = await md(w.p, () => ({ cards: [...document.querySelectorAll('#moment .mrc')].map(c => ({ room: c.querySelector('.pill').textContent, arrow: c.querySelector('.arr i') ? c.querySelector('.arr i').style.rotate : null })), dot: !!document.querySelector('#moment .k .live-dot') && document.querySelector('#moment .k .live-dot').getBoundingClientRect().width > 0 }));
  await w.close();
  const e = await emptyWall('/screen/?t=11:54:58&quiet', '1920x1080');
  await e.p.waitForFunction(() => document.querySelectorAll('#moment .mrc').length > 0, null, { timeout: 8000 }).catch(() => {});
  await sleep(800);
  const b = await md(e.p, () => [...document.querySelectorAll('#moment .mrc')].map(c => ({ room: c.querySelector('.pill').textContent, arrow: !!c.querySelector('.arr') })));
  await e.close();
  const st = await state(), dir = st.cfg.way && st.cfg.way.rooms, deg = { 'right': 0, 'down right': 45, 'down': 90, 'down left': 135, 'left': 180, 'up left': 225, 'up': 270, 'up right': 315 }[dir];
  const ok = a.cards.length === 3 && a.cards.every(c => c.arrow === deg + 'deg') && a.dot && b.length === 1 && b[0].room === 'Room A' && !b[0].arrow;
  return [ok, `10:55 call with directions (rooms "${dir}"): ${a.cards.map(c => c.room + ' ' + c.arrow).join(', ')}; live dot shows ${a.dot}; 11:55 call without directions: ${b.map(c => c.room + (c.arrow ? ' with arrow' : ' no arrow')).join(', ')}`];
});

check('moment-announcement', async () => {
  const w = await wall('/screen/?t=11:20&quiet', '1920x1080');
  await sleep(2500);
  const text = 'Lunch is ready in the Main Hall';
  await op({ action: 'ann', text, secs: 10 });
  try {
    await w.p.waitForFunction(t => { const h = document.querySelector('#moment h1'); return h && h.textContent === t; }, text, { timeout: 8000 });
    await sleep(100);
    const r = await md(w.p, () => { const h = document.querySelector('#moment h1'); return { lines: h.querySelectorAll('m-l').length, dir: h.getAttribute('dir'), rising: document.getAnimations().some(a => a.effect.target && a.effect.target.closest && a.effect.target.closest('#moment h1') && /translateY\(110%\)/.test(a.effect.getKeyframes()[0].transform || '')) }; });
    await w.close();
    return [r.lines > 0 && r.dir === 'auto' && r.rising, `announcement on the wall in ${'<'}8 s: masked lines ${r.lines}, rising ${r.rising}, dir ${r.dir}`];
  } finally { await op({ action: 'ann', text: '' }).catch(() => {}); }
});

/* ---------- Task 7: Choose and Rooms ---------- */

const cellFacts = () => [...document.querySelectorAll('[data-sid]')].map(c => ({ sid: c.dataset.sid, plan: (c.querySelector('.plan b') || {}).textContent || null, seats: !!c.querySelector('.seats, .bar'), bar: c.querySelector('.lbar i') ? parseFloat(c.querySelector('.lbar i').style.width) : null, tag: (c.querySelector('.top em') || {}).textContent || null }));

check('choose-planning', async () => {
  const st = await state();
  const w = await wall('/screen/?t=10:45&quiet', '1920x1080');
  await sleep(3500);
  const cells = await md(w.p, cellFacts);
  await w.close();
  const bad = cells.filter(c => (st.interest[c.sid] || 0) > 0 ? c.plan !== String(st.interest[c.sid]) : c.plan !== null);
  const seats = cells.filter(c => c.seats);
  return [cells.length === 7 && !bad.length && !seats.length, `full grid at 10:45: ${cells.map(c => c.sid + '=' + (c.plan || '-')).join(' ')} (state interest ${JSON.stringify(st.interest)}); wrong: ${bad.map(c => c.sid).join(',') || 'none'}; seats shown without bookings: ${seats.length}`];
});

check('choose-focused-block', async () => {
  const st = await state();
  const w = await wall('/screen/?t=11:52&quiet', '3840x1920');
  await sleep(3500);
  const r = await md(w.p, () => ({ title: window.__md.slotState[0].el.querySelector('h2').textContent, cards: [...window.__md.slotState[0].el.querySelectorAll('[data-sid]')].map(c => ({ sid: c.dataset.sid, plan: (c.querySelector('.plan.big b') || {}).textContent || null })) }));
  await w.close();
  const ok = r.title === 'Choose Your 12:00 Session' && r.cards.length === 1 && r.cards[0].sid === '2A' && r.cards[0].plan === String(st.interest['2A'] || '') ;
  return [ok, `primary at 11:52: "${r.title}", sessions ${r.cards.map(c => c.sid + ' planning ' + c.plan).join(', ')} (state says 2A: ${st.interest['2A']})`];
});

check('rooms-progress-and-wrapping', async () => {
  const w = await wall('/screen/?t=11:20&quiet', '1920x1080');
  await sleep(3000);
  const a = await md(w.p, cellFacts);
  await w.close();
  const w2 = await wall('/screen/?t=11:41&quiet', '1920x1080');
  await sleep(3000);
  const b = await md(w2.p, cellFacts);
  await w2.close();
  const near = (v, want) => v !== null && Math.abs(v - want) < 2.5;
  const ok = a.length === 3 && a.every(c => near(c.bar, 20.1 / 45 * 100) && c.tag === 'On now') && b.every(c => near(c.bar, 41.1 / 45 * 100) && c.tag === 'Wrapping up');
  return [ok, `11:20: ${a.map(c => c.sid + ' ' + c.tag + ' ' + c.bar + '%').join(', ')} (want about 44.7%); 11:41: ${b.map(c => c.sid + ' ' + c.tag + ' ' + c.bar + '%').join(', ')} (want about 91.3%, Wrapping up)`];
});

check('seats-only-with-bookings', async () => {
  // A sessions tab where one session has 7 bookings: then, and only then, seats show.
  const csv = '"Block","Time","Room","Session topic","Advisor","Host status","Delivery","Seats","Booked","Seats left"\n"1","11:00 to 11:45","Room A","Pitching and Outreach to International Clients","Gigi Aulsebrook","Confirmed","Online","25","7","18"\n"1","11:00 to 11:45","Room B","AI Impact on Technical Jobs","Asem","Confirmed","In person","25","0","25"\n"1","11:00 to 11:45","Room C","Sales Tactics for Startups and Scaleups","Taylor Mohylsky","Confirmed","Online","25","0","25"\n';
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.route('**/api/sheet/sessions**', r => r.fulfill({ status: 200, contentType: 'text/csv', body: csv }));
  const p = await ctx.newPage(); await p.goto(BASE + '/screen/?t=10:52&quiet&scene=rooms');
  await sleep(4500);
  const withB = await p.evaluate(() => [...document.querySelectorAll('[data-sid]')].map(c => ({ sid: c.dataset.sid, seats: (c.querySelector('.seats span') || {}).textContent || null })));
  await ctx.close();
  const w = await wall('/screen/?t=10:52&quiet&scene=rooms', '1920x1080');
  await sleep(4500);
  const without = await md(w.p, cellFacts);
  await w.close();
  const a = withB.find(c => c.sid === '1A');
  const ok = a && a.seats === '18 of 25 seats left' && withB.every(c => c.seats) && without.every(c => !c.seats);
  return [ok, `tracker with a booking: ${withB.map(c => c.sid + ' "' + c.seats + '"').join(', ')}; tracker with none: seats shown on ${without.filter(c => c.seats).length} of ${without.length} cards`];
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
