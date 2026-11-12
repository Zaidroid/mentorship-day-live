// Saves reference screenshots of the wall and the phone page.
//   npm run baseline                      all views to dev/shots/baseline/
//   npm run baseline -- --out dev/shots/after   another folder, to compare later
//   npm run baseline -- --only 3840x1920_light  only names containing this text
//   npm run baseline -- --jobs 4          pages open at the same time (default 2)
//   npm run baseline -- --resume          skip shots that already exist
// Local server only. Start it with npm run dev and npm run seed first.
// The shots depend on the data in the server, so seed the same way each time.
const { chromium, devices } = require('playwright');
const fs = require('fs');
const path = require('path');
const { wallViews, sizeOf, openWall } = require('./wall-urls.cjs');

const BASE = process.env.BASE || 'http://localhost:8897';
if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE + '/')) { console.error('Refusing ' + BASE + '. Baseline shots are for a local server only.'); process.exit(1); }
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', 'dev/shots/baseline'), ONLY = arg('only', ''), JOBS = +arg('jobs', 2), RESUME = process.argv.includes('--resume');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(); const problems = [];
  const views = wallViews().filter(v => v.name.includes(ONLY));
  let next = 0, done = 0;
  async function wallWorker() {
    while (next < views.length) {
      const v = views[next++];
      const file = path.join(OUT, v.name + '.png');
      if (RESUME && fs.existsSync(file)) { done++; continue; }
      // A busy machine can crash a page at 3840 wide, so try each view up to 3 times.
      for (let attempt = 1; attempt <= 3; attempt++) {
        const ctx = await b.newContext({ viewport: sizeOf(v.size), deviceScaleFactor: 1 });
        try {
          const p = await ctx.newPage();
          p.on('pageerror', e => problems.push(v.name + ': ' + e.message));
          p.on('console', m => { if (m.type() === 'error') problems.push(v.name + ': ' + m.text()); });
          const bad = await openWall(p, BASE, v); if (bad) problems.push(v.name + ': ' + bad);
          await p.screenshot({ path: file, timeout: 120000 }); done++; await ctx.close(); break;
        } catch (e) {
          await ctx.close().catch(() => {});
          if (attempt === 3) problems.push(v.name + ': failed after 3 tries: ' + e.message.split('\n')[0]);
        }
      }
    }
  }
  await Promise.all(Array.from({ length: JOBS }, wallWorker));
  console.log('wall shots: ' + done);

  // Phone tabs at 390x844, fake time 11:20
  const phoneTabs = [['today', 't-today'], ['poll', 't-poll'], ['photo', 't-photo'], ['meet', 't-meet']].filter(([n]) => ('phone_' + n).includes(ONLY));
  if (phoneTabs.length) {
    const ctx = await b.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }); const p = await ctx.newPage();
    p.on('pageerror', e => problems.push('phone: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') problems.push('phone: ' + m.text()); });
    await p.goto(BASE + '/?t=11:20'); await p.waitForTimeout(1500);
    for (const [n, id] of phoneTabs) {
      await p.click('#' + id); await p.waitForTimeout(700);
      await p.screenshot({ path: path.join(OUT, 'phone_' + n + '.png') });
    }
    await ctx.close(); console.log('phone shots: ' + phoneTabs.length);
  }
  await b.close();
  if (problems.length) console.log('page problems:\n' + [...new Set(problems)].slice(0, 20).join('\n'));
  console.log('saved to ' + OUT);
})();
