// Probe for the wall. Opens wall URLs at three sizes in both themes and checks:
//   errors    any page error or console error
//   overflow  a child of .slot .sb reaches outside its .slot
//   text      visible text in #app smaller than 1.3 times --u
//   bg        the #bg canvas is the same 2 seconds later (background stopped)
// One line per view and check. Exit code 1 when a check fails and is not on the
// known list in scripts/probe-known.json.
//   npm run probe                          every view (132 views, about 20 minutes with one page at a time)
//   npm run probe -- --quick               one fake time and three scenes per size and theme
//   npm run probe -- --only 3840x1920_dark only view names containing this text
//   npm run probe -- --jobs 4              pages open at the same time (default 1, more is faster but can crash pages on a busy machine)
// Local server only. Start it with npm run dev and npm run seed first.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { wallViews, sizeOf, openWall } = require('./wall-urls.cjs');

const BASE = process.env.BASE || 'http://localhost:8897';
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE + '/')) { console.error('Refusing ' + BASE + '. The probe is for a local server only.'); process.exit(1); }
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes('--' + k);
const ONLY = arg('only', ''), JOBS = +arg('jobs', 1), QUICK = flag('quick');
const BG_GAP = 2000, FACTOR = +arg('factor', 1.3); // --factor is only for checking that the text check can fail

const KNOWN = JSON.parse(fs.readFileSync(path.join(__dirname, 'probe-known.json'), 'utf8')).known;
// A known entry matches a finding when check and key agree and, if the entry lists
// views, the view name contains one of them.
const isKnown = (check, key, view) => KNOWN.find(k => k.check === check && key.startsWith(k.key) && (!k.views || k.views.some(v => view.includes(v))));

// Runs inside the page. Returns overflow and small text findings.
function inPage(FACTOR) {
  const u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u'));
  const label = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const c = [...el.classList].slice(0, 2).join('.');
    if (c) s += '.' + c;
    const slot = el.closest('.slot'); const h2 = slot && slot.querySelector('h2');
    return (h2 ? '[' + h2.textContent.trim() + '] ' : '') + s;
  };
  const overflow = [];
  document.querySelectorAll('.slot').forEach(slot => {
    const sb = slot.querySelector('.sb'); if (!sb) return;
    const sr = slot.getBoundingClientRect(), tol = 1.5;
    [...sb.children].forEach(ch => {
      const r = ch.getBoundingClientRect(); if (!r.width && !r.height) return;
      const over = [];
      if (r.bottom > sr.bottom + tol) over.push('bottom ' + Math.round(r.bottom - sr.bottom) + 'px');
      if (r.right > sr.right + tol) over.push('right ' + Math.round(r.right - sr.right) + 'px');
      if (r.top < sr.top - tol) over.push('top ' + Math.round(sr.top - r.top) + 'px');
      if (r.left < sr.left - tol) over.push('left ' + Math.round(sr.left - r.left) + 'px');
      if (over.length) overflow.push({ key: label(ch), detail: over.join(', ') });
    });
  });
  const small = new Map(); const app = document.getElementById('app');
  const walker = document.createTreeWalker(app, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    if (!el || el === app && !el.childNodes.length) continue;
    if (['SCRIPT', 'STYLE', 'CANVAS', 'NOSCRIPT'].includes(el.tagName)) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    let hidden = false; for (let a = el; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (parseFloat(cs.opacity) < 0.05) { hidden = true; break; } }
    if (hidden) continue;
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < FACTOR * u - 0.01) {
      const key = label(el); const e = small.get(key) || { key, count: 0, size: fs, sample: el.textContent.trim().slice(0, 30) };
      e.count++; e.size = Math.min(e.size, fs); small.set(key, e);
    }
  }
  return { u, overflow, small: [...small.values()] };
}

(async () => {
  let views = wallViews().filter(v => v.name.includes(ONLY));
  if (QUICK) views = views.filter(v => /_t1120$|scene-(rooms|poll|board)$/.test(v.name));
  const b = await chromium.launch();
  const results = []; let next = 0;
  async function worker() {
    while (next < views.length) {
      const v = views[next++]; let f = null, lastErr = '';
      // A busy machine can crash a page at 3840 wide, so try each view up to 3 times.
      for (let attempt = 1; attempt <= 3 && !f; attempt++) {
        const errs = [];
        const ctx = await b.newContext({ viewport: sizeOf(v.size), deviceScaleFactor: 1 });
        try {
          const p = await ctx.newPage();
          p.on('pageerror', e => errs.push('pageerror: ' + e.message));
          p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
          p.on('requestfailed', r => { if (r.url().startsWith(BASE)) errs.push('request failed: ' + r.url().replace(BASE, '')); });
          const themeBad = await openWall(p, BASE, v); if (themeBad) errs.push('theme: ' + themeBad);
          const bg1 = await p.evaluate(() => document.getElementById('bg').toDataURL());
          const found = await p.evaluate(inPage, FACTOR);
          await p.waitForTimeout(BG_GAP);
          const bg2 = await p.evaluate(() => document.getElementById('bg').toDataURL());
          f = { errors: [...new Set(errs)].map(e => ({ key: e, detail: '' })), overflow: found.overflow, text: found.small.map(s => ({ key: s.key, detail: `${s.count} element(s) at ${s.size.toFixed(1)}px, limit ${(FACTOR * found.u).toFixed(1)}px, e.g. "${s.sample}"` })), bg: bg1 === bg2 ? [{ key: '#bg', detail: 'canvas did not change in ' + BG_GAP + ' ms' }] : [] };
        } catch (e) { lastErr = e.message.split('\n')[0]; }
        await ctx.close().catch(() => {});
      }
      if (!f) f = { errors: [{ key: 'probe could not finish this view after 3 tries: ' + lastErr, detail: '' }], overflow: [], text: [], bg: [] };
      results.push({ v, f });
      const line = (check, arr) => { const bad = arr.filter(x => !isKnown(check, x.key, v.name)), kn = arr.length - bad.length; return `${bad.length ? 'FAIL' : kn ? 'KNOWN' : 'ok  '}  ${v.name}  ${check}` + (arr.length ? `  (${bad.length} new, ${kn} known)` : ''); };
      for (const c of ['errors', 'overflow', 'text', 'bg']) console.log(line(c, f[c]));
    }
  }
  await Promise.all(Array.from({ length: JOBS }, worker));
  await b.close();

  // Summary. Group findings by check and key so a repeat across views reads as one line.
  const groups = new Map();
  for (const { v, f } of results) for (const c of ['errors', 'overflow', 'text', 'bg']) for (const x of f[c]) {
    const g = groups.get(c + '|' + x.key) || { check: c, key: x.key, views: [], detail: x.detail, known: isKnown(c, x.key, v.name) };
    g.views.push(v.name); groups.set(c + '|' + x.key, g);
  }
  const all = [...groups.values()].sort((a, b) => a.check.localeCompare(b.check) || a.key.localeCompare(b.key));
  const fresh = all.filter(g => !g.known || g.views.some(n => !isKnown(g.check, g.key, n)));
  console.log('\n' + results.length + ' views checked.');
  for (const g of all) {
    const isNew = fresh.includes(g);
    console.log(`\n${isNew ? 'FAIL' : 'KNOWN'} ${g.check}: ${g.key}\n  ${g.detail}\n  in ${g.views.length} view(s): ${g.views.slice(0, 4).join(', ')}${g.views.length > 4 ? ', ...' : ''}` + (g.known ? `\n  known: ${g.known.why}` : ''));
  }
  console.log(`\nprobe: ${fresh.length ? fresh.length + ' new finding(s)' : 'no new findings'}, ${all.length - fresh.length} known.`);
  process.exit(fresh.length ? 1 : 0);
})();
