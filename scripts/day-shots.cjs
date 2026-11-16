// Records a rehearsal of the day from one wall page (docs/PLAN.md WP7 task 2).
//   node scripts/day-shots.cjs [out dir] [size] [seconds between shots] [total seconds]
// Start the simulator first (npm run sim -- --from 09:25 --speed 30). One wall page stays open the whole
// time, so faults that build up over a day show. Each shot is named by the wall's own clock. Page errors
// and the wall's frame rate are printed per shot.
const { chromium } = require('playwright');
(async () => {
  const [,, dir = 'dev/shots/day', size = '3840x1920', every = '10', total = '700'] = process.argv;
  const base = process.env.BASE || 'http://localhost:8897', [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await p.goto(base + (process.env.WALL || '/screen/?quiet')); await p.waitForTimeout(5000);
  const t0 = Date.now(); let n = 0, seen = 0;
  while (Date.now() - t0 < Number(total) * 1000) {
    const info = await p.evaluate(() => { const c = document.querySelector('#clock, .clock'); const md = window.__md || {}; return { clock: (document.body.innerText.match(/\b\d\d:\d\d\b/) || [''])[0], mode: md.S && md.S.mode, scenes: (md.slotState || []).map(s => s.id).join(','), lite: document.documentElement.hasAttribute('data-lite'), mom: document.getElementById('app').classList.contains('mom') }; }).catch(e => ({ clock: 'err', err: e.message }));
    const name = String(++n).padStart(3, '0') + '_' + (info.clock || 'x').replace(':', '') + '.png';
    await p.screenshot({ path: dir + '/' + name }).catch(e => errs.push('shot: ' + e.message));
    console.log(name, JSON.stringify(info), errs.length > seen ? 'NEW ERRORS: ' + errs.slice(seen).join(' | ').slice(0, 400) : '');
    seen = errs.length;
    await p.waitForTimeout(Math.max(200, Number(every) * 1000 - 900));
  }
  const heap = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null).catch(() => null);
  console.log('done, shots ' + n + ', errors ' + errs.length + ', heap MB ' + heap);
  await b.close();
})();
