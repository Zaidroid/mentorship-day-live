const { chromium, devices } = require('playwright');
const B = process.env.BASE || 'http://localhost:8897';
(async () => {
  const b = await chromium.launch(); const errs = [];
  const phone = await b.newContext({ ...devices['iPhone 13'] }); const p = await phone.newPage();
  p.on('pageerror', e => errs.push('phone: ' + e.message));
  await p.goto(B + '/?t=11:20'); await p.waitForTimeout(800);
  // The first visit opens the sign in sheet. This phone uses the page without signing in, so its card waits for the remote.
  await p.click('[data-act=si-skip]'); await p.waitForTimeout(400);
  await p.screenshot({ path: 'dev/shots/ph_today.png', fullPage: false });
  await p.click('#t-poll'); await p.waitForTimeout(500);
  await p.fill('#word', 'Confidence'); await p.click('[data-act=answer-word]'); await p.waitForTimeout(900);
  console.log('poll msg:', await p.textContent('#pollMsg'));
  await p.screenshot({ path: 'dev/shots/ph_poll.png' });
  await p.click('#t-photo'); await p.setInputFiles('#file', 'scripts/sample.jpg'); await p.waitForTimeout(800);
  await p.fill('#cap', 'Coffee break in the Main Hall'); await p.fill('#pname', 'E2E Tester'); await p.click('#send'); await p.waitForTimeout(900);
  console.log('photo msg:', await p.textContent('#photoMsg'));
  await p.screenshot({ path: 'dev/shots/ph_photo.png' });
  await p.click('#t-meet'); await p.waitForTimeout(500);
  await p.fill('#mName', 'E2E Tester'); await p.fill('#mCo', 'Test Co');
  await p.click('#mLook .tagb[data-t="Funding"]'); await p.click('#mOffer .tagb[data-t="Marketing"]');
  await p.check('#mOk'); await p.click('#mSend'); await p.waitForTimeout(900);
  console.log('meet status:', await p.textContent('#mcCard .status'));
  await p.screenshot({ path: 'dev/shots/ph_meet.png', fullPage: true });

  const rc = await b.newContext({ viewport: { width: 420, height: 900 } }); const r = await rc.newPage();
  r.on('pageerror', e => errs.push('remote: ' + e.message));
  await r.goto(B + '/remote/'); await r.fill('#gWho', 'Zaid'); await r.fill('#gPin', '123456'); await r.click('#gGo'); await r.waitForTimeout(1200);
  await r.screenshot({ path: 'dev/shots/rm_screen.png', fullPage: true });
  await r.click('nav button[data-t=approve]'); await r.waitForTimeout(1200);
  console.log('badge:', await r.textContent('#badge'));
  await r.screenshot({ path: 'dev/shots/rm_approve.png', fullPage: true });
  await r.click('#phWait [data-a=approvePhoto]'); await r.waitForTimeout(900);
  await r.click('#prWait [data-a=approveProfile]'); await r.waitForTimeout(900);
  await r.click('nav button[data-t=screen]');
  await r.click('#scenes [data-s=photos]'); await r.waitForTimeout(700);
  await r.fill('#annTxt', 'Lunch is ready in the Main Hall'); await r.click('#annGo'); await r.waitForTimeout(900);
  await r.click('nav button[data-t=polls]'); await r.waitForTimeout(500); await r.screenshot({ path: 'dev/shots/rm_polls.png', fullPage: true });
  await r.click('nav button[data-t=log]'); await r.waitForTimeout(300); console.log('log:', (await r.textContent('#logList')).slice(0, 160));

  const sc = await b.newPage({ viewport: { width: 1920, height: 960 } }); sc.on('pageerror', e => errs.push('screen: ' + e.message));
  await sc.goto(B + '/screen/?t=11:20&quiet'); await sc.waitForTimeout(2500);
  await sc.screenshot({ path: 'dev/shots/sc_ann.png' });
  await sc.waitForTimeout(31000);
  await sc.screenshot({ path: 'dev/shots/sc_photos.png' });
  await r.click('nav button[data-t=screen]'); await r.click('#scenes [data-s=""]'); await r.waitForTimeout(400); await r.click('#annClear');
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})();
