// End to end test of the team remote at 420 px wide (docs/PLAN.md WP6).
//   BASE=http://localhost:8897 node scripts/e2e-remote.cjs
// Drives the page like a person: sign in to the remote, import people from a file and from pasted rows,
// check that no email or full number is sent, a sign in made through the API shows up in People,
// a lockout and Unlock, a rehearsal on and off, a feature switch, a takeaway approval, an announcement,
// polls, reactions, finale, group photo, survey link, team photo, an export download and a wipe.
// It wipes the data of the server it runs against, so it only runs against localhost.
// Screenshots of every tab go to SHOTS (default dev/shots/remote).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const B = (process.env.BASE || 'http://localhost:8897').replace(/\/+$/, '');
const PIN = process.env.REMOTE_PIN || '123456';
const SHOTS = process.env.SHOTS || 'dev/shots/remote';
const ROOT = path.resolve(__dirname, '..');
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(B)) { console.error('Refusing ' + B + ': this test wipes data and only runs against localhost.'); process.exit(2); }
fs.mkdirSync(SHOTS, { recursive: true });

const fails = [];
const check = (cond, msg) => { console.log((cond ? 'ok    ' : 'FAIL  ') + msg); if (!cond) fails.push(msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- API helpers, as a phone or the team would call it ---------- */
async function api(method, p, { dev, pin, json, raw, type } = {}) {
  const h = {};
  if (dev) h['x-dev'] = dev;
  if (pin) { h['x-pin'] = PIN; h['x-who'] = 'E2E'; }
  let body;
  if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json); } else if (raw) { h['content-type'] = type || 'image/jpeg'; body = raw; }
  const r = await fetch(B + p, { method, headers: h, body });
  const text = await r.text(); let data = null; try { data = JSON.parse(text); } catch (e) {}
  return { status: r.status, data, text };
}
const op = json => api('POST', '/api/op', { pin: true, json });
const state = async () => (await api('GET', '/api/state')).data;
const claim = async (dev, name, last4) => {
  const w = await api('GET', '/api/who?q=' + encodeURIComponent(name), { dev });
  const hit = ((w.data || {}).list || []).find(x => x.name === name);
  if (!hit) return { status: 404 };
  return api('POST', '/api/claim', { dev, json: { id: hit.id, last4, hello: true } });
};

/* ---------- a small CSV reader, only to build the pasted rows from the fixture ---------- */
function csv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// What Google Sheets puts on the clipboard: tab separated, cells with line breaks or quotes are quoted.
const tsv = rows => rows.map(r => r.map(c => /[\t\n"]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join('\t')).join('\n');

(async () => {
  const fixture = path.join(ROOT, 'scripts/fixtures/people-sample.csv');
  const table = csv(fs.readFileSync(fixture, 'utf8'));
  const head = table[0];

  // A clean start: no rehearsal, schedule polls, no data. The people list is replaced by the imports below.
  await op({ action: 'rehearsal', hhmm: null });
  await op({ action: 'pollManual', on: false });
  await op({ action: 'rx', mode: 'auto' });
  const w0 = await op({ action: 'wipe', phrase: 'RESET MD26' });
  check(w0.status === 200, 'clean start: wipe through the API answers 200 (got ' + w0.status + ')');
  for (const f of ['trustProfiles', 'trustTakeaways', 'hello', 'picks', 'meet', 'takeaways']) await op({ action: 'flags', name: f, on: true });
  await op({ action: 'flags', name: 'trustPhotos', on: false });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [], opBodies = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  let stateCalls = 0;
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/op')) opBodies.push(r.postData() || ''); if (r.url().includes('/api/state')) stateCalls++; });
  const shot = async name => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: true });
  const noScroll = async what => { const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]); check(sw <= iw, `no sideways scroll on ${what} (${sw} of ${iw} px)`); };
  const tab = async t => { await page.click(`nav button[data-t=${t}]`); await page.waitForSelector(`#${t}:not([hidden])`); };
  const yes = async () => { await page.waitForSelector('#ask:not([hidden])'); await page.click('#askYes'); await page.waitForSelector('#ask', { state: 'hidden' }); };
  const refresh = async () => { await page.click('#refreshNow'); await sleep(700); };
  const lastOp = action => { for (let i = opBodies.length - 1; i >= 0; i--) { try { const b = JSON.parse(opBodies[i]); if (b.action === action) return b; } catch (e) {} } return null; };

  /* the gate and the Status tab */
  await page.goto(B + '/remote/');
  await page.fill('#gWho', 'E2E Team'); await page.fill('#gPin', 'wrong');
  await page.click('#gGo'); await page.waitForSelector('#gErr:not(:empty)');
  check(/PIN/.test(await page.textContent('#gErr')), 'a wrong PIN is refused with a plain sentence');
  errs.length = 0; // the browser logs the 401 of the wrong PIN, on purpose
  await page.fill('#gPin', PIN); await page.click('#gGo');
  await page.waitForSelector('#app:not([hidden])');
  check(await page.getAttribute('nav button[data-t=status]', 'aria-selected') === 'true', 'Status is the first tab');
  await page.waitForSelector('#wallKv dt'); await sleep(500);
  check(/All good|need/.test(await page.textContent('#stBanner')), 'the Status banner says whether anything needs the team');
  check(/Poll|Reactions|Takeaways/.test(await page.textContent('#autoList')), 'Running by itself lists the clock rules');
  check((await page.locator('#annQuick button').allTextContents()).join('|') === 'Sessions start in 5 minutes|Lunch is served in the Main Hall|Group photo in the Main Hall now|One to one slots are open at the registration desk', 'exactly the four one tap announcements');
  await noScroll('Status'); await shot('01-status');

  /* people import from a file */
  await tab('people');
  await page.setInputFiles('#impFile', fixture);
  await page.waitForSelector('#impCount');
  const prev = await page.textContent('#impPrev');
  check(/5 people ready/.test(prev), 'file preview: 5 people ready (' + prev.slice(0, 60).replace(/\s+/g, ' ') + ')');
  check(/fewer than 4 digits/.test(prev) && /no name/.test(prev) && /empty row/.test(prev) && /older row/.test(prev), 'file preview gives the reasons for skipped rows');
  check(/Layla Khoury/.test(prev) && /Karim Nasser/.test(prev), 'file preview names the first people');
  check((prev.match(/Khoury|Saleh|Odeh|Amin|Nasser/g) || []).length === 5, 'file preview shows at most the first 5 names');
  check(!(await page.locator('#impSend').isDisabled()), 'Send is on once the preview is good');
  await shot('02-people-import-preview'); await noScroll('People');
  const before = opBodies.length;
  await page.click('#impSend'); await yes();
  await page.waitForFunction(() => /Imported/.test(document.getElementById('impRes').textContent), null, { timeout: 8000 });
  check(opBodies.length === before + 1, 'nothing was sent before the confirmation, one request after it');
  const imp = lastOp('peopleImport'); const raw = opBodies[opBodies.length - 1];
  check(!raw.includes('@'), 'the import request holds no "@"');
  check(!/\d{7,}/.test(raw), 'the import request holds no run of 7 or more digits');
  check(imp && imp.people.length === 5, 'the import sends 5 people');
  const layla = imp && imp.people.find(p => p.name === 'Layla Khoury');
  check(layla && layla.last4 === '0111' && layla.company === 'Byte Studio' && layla.advisorPref === 'remote' && layla.photoOk === true, 'Layla: newest row won, last 4 digits, remote advisors, photo yes');
  check(layla && JSON.stringify(layla.topics) === JSON.stringify(['Business development and international sales', 'AI adoption and applied AI']), 'topics found by looking inside the cell');
  const karim = imp && imp.people.find(p => p.name === 'Karim Nasser');
  check(karim && karim.topics.includes('Fundraising, finance, and scaling a company') && karim.topics.length === 2, 'a topic with commas stays whole');
  const rana = imp && imp.people.find(p => p.name === 'Rana Odeh'), yousef = imp && imp.people.find(p => p.name === 'Yousef Amin');
  check(rana && rana.last4 === '0333' && rana.advisorPref === 'local', 'a number written with spaces: last 4 digits, local advisors');
  check(yousef && yousef.last4 === '0444' && yousef.photoOk === false, 'a number written with +970 and spaces; consent No is false');
  check(imp && Object.keys(imp.people[0]).every(k => ['name', 'company', 'title', 'linkedin', 'topics', 'advisorPref', 'photoOk', 'last4', 'rooms', 'slot'].includes(k)), 'only the reduced fields are sent');
  await refresh();
  check(/5 on the list/.test(await page.textContent('#peopleSum')), 'People shows 5 on the list');

  /* people import from pasted rows, with Status and room columns */
  const extra = ['Status', 'Block 1 Room', 'Block 2 Room', 'Block 3 Room', 'One to one slot'];
  const pasteRows = [head.concat(extra),
    table[4].concat(['Accepted', '', '', '', '']),                       // Rana Odeh
    table[5].concat(['Rejected', '', '', '', '']),                       // Yousef Amin
    table[7].concat(['', 'Room B', '', 'Room C', 'Rand Safi 11:00'])];   // Karim Nasser
  await page.click('#impClear');
  await page.fill('#impPaste', tsv(pasteRows));
  await page.waitForSelector('#impCount');
  const pv2 = await page.textContent('#impPrev');
  check(/2 people ready/.test(pv2) && /Status column/.test(pv2), 'paste preview: 2 ready, one row skipped by its Status');
  await page.click('#impSend'); await yes();
  await page.waitForFunction(() => /Imported 2/.test(document.getElementById('impRes').textContent), null, { timeout: 8000 });
  const imp2 = lastOp('peopleImport'), raw2 = opBodies[opBodies.length - 1];
  const k2 = imp2.people.find(p => p.name === 'Karim Nasser');
  check(k2 && k2.rooms && k2.rooms['1'] === 'Room B' && k2.rooms['3'] === 'Room C' && k2.slot === 'Rand Safi 11:00', 'rooms and one to one slot come from their columns');
  check(!raw2.includes('@') && !/\d{7,}/.test(raw2), 'the pasted import request holds no "@" and no run of 7 or more digits');
  await shot('03-people-pasted');
  // back to the file, so the people list is the fixture for the rest of the test
  await page.click('#impClear'); await page.setInputFiles('#impFile', fixture); await page.waitForSelector('#impCount');
  await page.click('#impSend'); await yes();
  await page.waitForFunction(() => /Imported 5/.test(document.getElementById('impRes').textContent), null, { timeout: 8000 });

  /* a sign in made through the API shows up in People */
  const c1 = await claim('e2erm0001', 'Layla Khoury', '0111');
  check(c1.status === 200, 'API sign in of Layla answers 200 (got ' + c1.status + ')');
  await refresh();
  const list = await page.textContent('#peopleList');
  check(/Layla Khoury/.test(list), 'the sign in shows up in the People list');
  check(/1 signed in/.test(await page.textContent('#peopleSum')), 'the People summary counts 1 signed in');
  await page.fill('#pFind', 'zzz');
  check(/Nobody matches/.test(await page.textContent('#peopleList')), 'the find box filters the list');
  await page.fill('#pFind', 'khou');
  check(/Layla Khoury/.test(await page.textContent('#peopleList')), 'the find box finds a part of a name');
  await page.fill('#pFind', '');

  /* a lockout and Unlock */
  let st;
  for (let i = 0; i < 5; i++) st = (await claim('e2erm0002', 'Omar Saleh', '9999')).status;
  check(st === 401 || st === 423, 'five wrong last 4 digits from one phone (last answer ' + st + ')');
  await refresh();
  await page.waitForSelector('#lockedList [data-do=unlock]');
  check(/Omar Saleh/.test(await page.textContent('#lockedList')), 'the locked person is listed by name');
  check(await page.isVisible('#pbadge'), 'the People tab carries a badge for the lock');
  await shot('04-people-locked');
  const lockedClaim = await claim('e2erm0002', 'Omar Saleh', '0222');
  check(lockedClaim.status === 423, 'a locked person is refused even with the right digits (got ' + lockedClaim.status + ')');
  await page.click('#lockedList [data-do=unlock]');
  check(/Unlock Omar Saleh/.test(await page.textContent('#askT')), 'Unlock asks first and names the person');
  await yes();
  await page.waitForFunction(() => /Nobody is locked out/.test(document.getElementById('lockedList').textContent), null, { timeout: 8000 });
  const okClaim = await claim('e2erm0002', 'Omar Saleh', '0222');
  check(okClaim.status === 200, 'after Unlock the right digits sign in (got ' + okClaim.status + ')');

  /* a rehearsal on, and a banner on every tab */
  await tab('status');
  await page.fill('#rhTime', '11:50');
  await page.click('#rhStart');
  check(/11:50/.test(await page.textContent('#askT')) && /2 hours/.test(await page.textContent('#askB')), 'Start rehearsal says what it will do');
  await shot('05-confirm-sheet');
  await yes();
  await page.waitForSelector('#rehBanner:not([hidden])');
  check(/11:5/.test(await page.textContent('#rehTxt')), 'the rehearsal banner shows the clock');
  check((await state()).reh === true, 'the server says a rehearsal is on');
  await tab('screen');
  check(await page.isVisible('#rehBanner'), 'the banner stays visible on other tabs');
  await shot('06-screen');
  await noScroll('Screen');

  /* a feature switch */
  await tab('status');
  await page.click('#flags [data-flag=meet]');
  check(/Turn off "Meet codes"/.test(await page.textContent('#askT')), 'a switch asks before it changes');
  await yes();
  await page.waitForFunction(() => document.querySelector('#flags [data-flag=meet]').textContent === 'Off', null, { timeout: 8000 });
  check((await state()).cfg.flags.meet === false, 'the meet switch is off on the server');
  check(/Switched off: Meet codes/.test(await page.textContent('#stHeld')), 'Held by you lists the switch that is off');
  await shot('07-status-held');
  await page.click('#flags [data-flag=meet]'); await yes();
  await page.waitForFunction(() => document.querySelector('#flags [data-flag=meet]').textContent === 'On', null, { timeout: 8000 });
  check((await state()).cfg.flags.meet === true, 'the meet switch is on again');

  /* one tap announcement */
  await page.click('#annQuick button:nth-child(1)');
  await page.waitForFunction(() => /On the wall now/.test(document.getElementById('annState').textContent), null, { timeout: 8000 });
  const s2 = await state();
  check(s2.cfg.ann && s2.cfg.ann.text === 'Sessions start in 5 minutes' && s2.cfg.ann.secs === 30, 'one tap announcement: right sentence for 30 seconds');

  /* a takeaway from a guest waits, the team approves it */
  const g = await api('POST', '/api/guest', { dev: 'e2erm0003', json: { name: 'Sample Guest Remote', hello: false } });
  check(g.status === 200, 'API guest sign in answers 200');
  const line = 'Lead with the client problem, not the product.';
  const t1 = await api('POST', '/api/takeaway', { dev: 'e2erm0003', json: { sid: '1A', rating: 5, text: line, showName: true } });
  check(t1.status === 200 && t1.data.status === 'pending', 'a guest takeaway waits (' + t1.status + ' ' + JSON.stringify(t1.data) + ')');
  await refresh();
  check(/1/.test(await page.textContent('#badge')) && await page.isVisible('#badge'), 'the Approve tab carries a badge');
  check(/takeaway/.test(await page.textContent('#stBanner')), 'the Status banner says a takeaway is waiting');
  await tab('approve');
  await page.waitForSelector('#tkWait [data-a=approveTakeaway]');
  const tkText = await page.textContent('#tkWait');
  check(tkText.includes(line) && /Guest/.test(tkText) && /Room A/.test(tkText), 'the takeaway shows its line, its session and that it is a guest');
  await shot('08-approve');
  await page.click('#tkWait [data-a=approveTakeaway]');
  await page.waitForFunction(() => /Nothing waiting/.test(document.getElementById('tkWait').textContent), null, { timeout: 8000 });
  const sv = (await state()).snapV;
  const snap = (await api('GET', '/api/snap?v=' + encodeURIComponent(sv))).data;
  check(snap.takeaways.some(t => t.text === line), 'after Approve the takeaway is in the public snapshot');
  check(/Lead with the client/.test(await page.textContent('#tkOk')), 'the approved takeaway is listed with a Remove button');
  check((await page.locator('#trust [data-flag]').count()) === 3, 'three trust switches on the Approve tab');

  /* team photos */
  const n0 = (await state()).n.photos;
  await page.setInputFiles('#teamFiles', path.join(ROOT, 'scripts/sample.jpg'));
  await page.fill('#teamCap', 'Team photo from the remote');
  await page.click('#teamGo');
  await page.waitForFunction(() => /1 of 1 added/.test(document.getElementById('teamRes').textContent), null, { timeout: 10000 });
  check((await state()).n.photos === n0 + 1, 'a team photo is on the photo wall at once');

  /* polls */
  await tab('polls');
  check(/Follows the schedule/.test(await page.textContent('#pollMode')), 'Polls says it follows the schedule');
  await page.click('#pollMode [data-do=pollHold]'); await yes();
  await page.waitForFunction(() => /Held by you/.test(document.getElementById('pollMode').textContent), null, { timeout: 8000 });
  check((await state()).poll.manual === true, 'the poll is held on the server');
  await shot('09-polls-held');
  await page.click('#pollMode [data-do=pollBack]');
  await page.waitForFunction(() => /Follows the schedule/.test(document.getElementById('pollMode').textContent), null, { timeout: 8000 });
  check((await state()).poll.manual === false, 'Back to the schedule releases the poll');
  await noScroll('Polls');

  /* reactions, finale, group photo, survey link */
  await tab('screen');
  await page.click('#rxBtns [data-m=on]'); await page.waitForFunction(() => /Held on/.test(document.getElementById('rxNow').textContent), null, { timeout: 8000 });
  check((await state()).rx.on === true, 'reactions held on');
  await page.click('#rxBtns [data-m=auto]'); await page.waitForFunction(() => /Following the clock/.test(document.getElementById('rxNow').textContent), null, { timeout: 8000 });
  await page.click('#finBtns [data-step=numbers]'); await page.waitForFunction(() => /Held on Day in Numbers/.test(document.getElementById('finNow').textContent), null, { timeout: 8000 });
  check((await state()).cfg.finale.step === 'numbers', 'finale step shown');
  await page.click('#finBtns [data-step=""]'); await page.waitForFunction(() => /Runs by itself/.test(document.getElementById('finNow').textContent), null, { timeout: 8000 });
  await page.click('[data-do=gpStart]'); check(/60 second/.test(await page.textContent('#askB')), 'the group photo asks first and says 60 seconds'); await yes();
  await page.waitForFunction(() => /Countdown running/.test(document.getElementById('gpNow').textContent), null, { timeout: 8000 });
  await page.click('[data-do=gpStop]'); await page.waitForFunction(() => !/Countdown running/.test(document.getElementById('gpNow').textContent), null, { timeout: 8000 });
  await page.fill('#svLink', 'https://example.com/survey'); await page.click('[data-do=svSave]');
  await page.waitForFunction(() => /example.com\/survey/.test(document.getElementById('svNow').textContent), null, { timeout: 8000 });
  check((await state()).cfg.links.survey === 'https://example.com/survey', 'survey link saved');
  await page.click('[data-do=svClear]'); await yes();
  await page.waitForFunction(() => /No survey link/.test(document.getElementById('svNow').textContent), null, { timeout: 8000 });

  /* rehearsal off, from the banner */
  await page.click('#rehBanner [data-do=rhStop]');
  check(/real time/.test(await page.textContent('#askB')), 'Stop rehearsal says what it will do');
  await yes();
  await page.waitForSelector('#rehBanner', { state: 'hidden' });
  check((await state()).reh === false, 'the rehearsal is off on the server');

  /* export download, with the PIN */
  await tab('export');
  check((await page.locator('#exList [data-x]').count()) === 7, 'seven export buttons');
  await shot('10-export');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exList [data-x=takeaways]')]);
  const file = path.join(SHOTS, 'download-takeaways.csv'); await dl.saveAs(file);
  const csvText = fs.readFileSync(file, 'utf8');
  check(dl.suggestedFilename() === 'md26-takeaways.csv', 'the download is named md26-takeaways.csv');
  check(csvText.charCodeAt(0) === 0xFEFF && csvText.includes('Session,Title') && csvText.includes(line), 'the file starts with the byte order mark, has its header and the takeaway');
  fs.unlinkSync(file);
  await noScroll('Export');

  /* log */
  await tab('log'); await refresh(); await shot('11-log');
  const logText = await page.textContent('#logList');
  check(/E2E Team/.test(logText) && /Exported takeaways/.test(logText) && /Announced/.test(logText), 'the log shows who did what (' + logText.slice(0, 200) + ')');
  await noScroll('Log');

  /* wipe behind the phrase */
  await tab('status');
  await page.click('#wipeBox summary');
  check(await page.locator('#wipeGo').isDisabled(), 'Wipe is off until the phrase is typed');
  await page.fill('#wipePhrase', 'reset md26 please');
  check(await page.locator('#wipeGo').isDisabled(), 'a wrong phrase keeps Wipe off');
  await page.fill('#wipePhrase', 'RESET MD26');
  check(!(await page.locator('#wipeGo').isDisabled()), 'the right phrase turns Wipe on');
  await shot('12-wipe');
  const sBefore = await state();
  check(sBefore.n.here > 0 && sBefore.n.photos > 0, 'there is data to wipe (here ' + sBefore.n.here + ', photos ' + sBefore.n.photos + ')');
  await refresh();
  const oB = (await api('GET', '/api/op', { pin: true })).data;
  const tiles = Object.fromEntries(await page.$$eval('#tiles .tile', els => els.map(e => [e.querySelector('small').textContent, e.querySelector('b').textContent])));
  check(!!oB.n && tiles.Here === String(oB.n.here) && tiles.Photos === String(oB.n.photos) && tiles.Answers === String(oB.n.answers) && tiles.Reactions === String(oB.rx.total), 'the Status counts are the ones in the op answer (' + JSON.stringify(tiles) + ')');
  await page.click('#wipeGo');
  check(/cannot be undone/.test(await page.textContent('#askB')), 'Wipe confirms once more and says it cannot be undone');
  await yes();
  await page.waitForFunction(() => document.getElementById('wipePhrase').value === '', null, { timeout: 10000 });
  const sAfter = await state();
  check(sAfter.n.here === 0 && sAfter.n.photos === 0 && sAfter.n.answers === 0 && sAfter.n.takeaways === 0, 'after Wipe the counts are zero');
  const o2 = (await api('GET', '/api/op', { pin: true })).data;
  check(o2.people.count === 5 && o2.people.signedIn === 0, 'Wipe kept the people list and cleared the sign ins');
  await tab('status'); await sleep(400); await shot('13-status-after-wipe');

  check(stateCalls === 0, 'the remote never asks /api/state: its counts come with the op answer (' + stateCalls + ' calls)');
  check(errs.length === 0, 'no page errors or console errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await browser.close();
  console.log(fails.length ? `\n${fails.length} checks failed.` : '\nAll checks passed.');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
