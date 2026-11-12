// node dev/shoot.js "3840x1920" "/screen/?t=11:20&quiet" out.png [scale]
const { chromium } = require('playwright');
(async () => {
  const [,, size, path, out, scale] = process.argv; const [w, h] = size.split('x').map(Number);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:8899' + path); await p.waitForTimeout(4200);
  await p.screenshot({ path: out });
  if (errs.length) console.log('errors:', errs.slice(0, 5).join(' | '));
  await b.close();
})();
