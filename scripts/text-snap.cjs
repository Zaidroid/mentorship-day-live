// Saves the visible text of the wall (#app) and the phone page (main) for every
// baseline view, so a change that should not change any text can be proven by a diff.
//   node scripts/text-snap.cjs --out dev/text-before
//   node scripts/text-snap.cjs --out dev/text-after
//   diff -r dev/text-before dev/text-after          (must print nothing)
// Options:
//   --only <text>   only view names containing this text
//   --sheet         let the wall read the live Screen Feed sheet. By default the
//                   sheet is blocked, so the wall shows its built in schedule.
// Each view is saved twice: <out>/<name>.txt with the clock seconds and the
// countdown masked (they move while the page settles), and <out>/raw/<name>.txt as read.
// Local server only. Use the same data for both runs.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { wallViews, sizeOf, openWall } = require('./wall-urls.cjs');

const BASE = process.env.BASE || 'http://localhost:8897';
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE + '/')) { console.error('Refusing ' + BASE + '. Text snaps are for a local server only.'); process.exit(1); }
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', ''), ONLY = arg('only', ''), SHEET = process.argv.includes('--sheet');
if (!OUT) { console.error('Give a folder with --out.'); process.exit(1); }

const PHONE_TODAY = ['09:00', '09:40', '10:10', '10:45', '11:20', '11:50', '12:20', '12:50', '13:20', '13:50', '14:30', '15:30'];

function save(name, text, raw) {
  fs.writeFileSync(path.join(OUT, name + '.txt'), text + '\n');
  fs.writeFileSync(path.join(OUT, 'raw', name + '.txt'), raw + '\n');
}

(async () => {
  fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
  const b = await chromium.launch(); const problems = [];
  const block = async ctx => { if (!SHEET) await ctx.route('**/api/sheet/**', r => r.fulfill({ status: 503, body: 'blocked by text-snap' })); };

  const views = wallViews().filter(v => v.name.includes(ONLY));
  let done = 0;
  for (const v of views) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ctx = await b.newContext({ viewport: sizeOf(v.size), deviceScaleFactor: 1 });
      try {
        await block(ctx);
        const p = await ctx.newPage();
        p.on('pageerror', e => problems.push(v.name + ': ' + e.message));
        const bad = await openWall(p, BASE, v); if (bad) problems.push(v.name + ': ' + bad);
        const r = await p.evaluate(() => ({ text: document.getElementById('app').innerText, clock: document.getElementById('clock').innerText, cd: document.getElementById('stCd').innerText }));
        let t = r.text;
        const ci = r.clock ? t.indexOf(r.clock) : -1;
        if (ci >= 0) t = t.slice(0, ci) + '[clock ' + r.clock.slice(0, 5) + ':ss]' + t.slice(ci + r.clock.length);
        if (r.cd) { const di = t.indexOf(r.cd, Math.max(0, ci)); if (di >= 0) t = t.slice(0, di) + '[countdown]' + t.slice(di + r.cd.length); }
        save(v.name, t, r.text); done++; await ctx.close(); break;
      } catch (e) {
        await ctx.close().catch(() => {});
        if (attempt === 3) problems.push(v.name + ': failed after 3 tries: ' + e.message.split('\n')[0]);
      }
    }
  }
  console.log('wall views: ' + done);

  const phone = [];
  for (const t of PHONE_TODAY) phone.push({ name: 'phone_today_t' + t.replace(':', ''), t, tab: 't-today' });
  for (const tab of ['poll', 'photo', 'meet']) phone.push({ name: 'phone_' + tab + '_t1120', t: '11:20', tab: 't-' + tab });
  const pv = phone.filter(x => x.name.includes(ONLY));
  for (const x of pv) {
    const ctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => problems.push(x.name + ': ' + e.message));
    await p.goto(BASE + '/?t=' + x.t); await p.waitForTimeout(1500);
    await p.click('#' + x.tab); await p.waitForTimeout(700);
    const text = await p.evaluate(() => document.querySelector('main').innerText);
    save(x.name, text, text); await ctx.close();
  }
  console.log('phone views: ' + pv.length);
  await b.close();
  if (problems.length) console.log('page problems:\n' + [...new Set(problems)].slice(0, 30).join('\n'));
  console.log('saved to ' + OUT);
})();
