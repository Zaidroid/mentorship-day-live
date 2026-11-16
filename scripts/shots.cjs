// Several screenshots in one run, one page at a time (this machine cannot hold two wall sized pages).
//   node scripts/shots.cjs <out dir> <size> <path> [<size> <path> ...]
// The file name is built from the size and the path. BASE defaults to the local dev server.
const { chromium } = require('playwright');
(async () => {
  const [,, dir, ...rest] = process.argv; const base = process.env.BASE || 'http://localhost:8897';
  const wait = Number(process.env.WAIT || 4600);
  const b = await chromium.launch();
  for (let i = 0; i + 1 < rest.length; i += 2) {
    const [w, h] = rest[i].split('x').map(Number), path = rest[i + 1];
    const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(base + path); await p.waitForTimeout(wait);
    const name = rest[i] + '_' + path.replace(/^\/+/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) + '.png';
    await p.screenshot({ path: dir + '/' + name });
    console.log(name + (errs.length ? '  errors: ' + errs.slice(0, 3).join(' | ') : ''));
    await p.close();
  }
  await b.close();
})();
