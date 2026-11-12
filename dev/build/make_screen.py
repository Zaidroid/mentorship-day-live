import sys
SRC='/tmp/claude-0/-home-claude/b1155bc3-6993-516a-859f-ef808fa1822c/scratchpad/screen/app3.html'
s=open(SRC).read()
def rep(a,b,n=1):
    global s
    c=s.count(a); assert c==n,(c,a[:90]); s=s.replace(a,b)
# assets and fonts as files
for w in (300,400,600,700,900): rep(f'url(__F{w}__)', f'url(/assets/ss3-{w}.woff2)')
rep('<script>\n__QR__\n</script>','<script src="/assets/qrcode.js"></script>')
rep('const A = __ASSETS__;', "const A = {gigi:'/assets/p_gigi.jpg', taylor:'/assets/p_taylor.jpg', ziad:'/assets/p_ziad.jpg', tom:'/assets/p_tom.jpg', rania:'/assets/p_rania.jpg', rajai:'/assets/p_rajai.jpg', iyas:'/assets/p_iyas.jpg', adam:'/assets/p_adam.jpg', rand:'/assets/p_rand.jpg', alan:'/assets/p_alan.jpg', mc:'/assets/mercycorps.png', gsg:'/assets/gsg.png', sida:'/assets/sida.png', tp:'/assets/technopark.png', pis:'/assets/pis.png'};")
rep("<title>Mentorship Day Live Screen</title>","<title>Mentorship Day Live Screen</title>\n<link rel=\"preload\" href=\"/assets/ss3-700.woff2\" as=\"font\" type=\"font/woff2\" crossorigin>")
# config
rep("""  links: { poll:'', survey:'' },
  pollQuestion: 'In one word, what do you want to leave with today?',""","""  links: { survey:'' },
  join: (location.protocol.startsWith('http') && !/^(localhost|127\\.)/.test(location.hostname)) ? location.origin + '/' : 'https://mentorship-day-live.netlify.app/',""")
rep("refreshSeconds: 30","refreshSeconds: 30,\n  stateSeconds: 3")
rep("  tabs: { sessions:'Sessions', slots:'Slots', stats:'Stats', poll:'Poll' },\n  feeds: { sessions:'', slots:'', stats:'', poll:'' },\n","")
# names and Title Case
rep("slotsFor('rand','Small room 1'","slotsFor('rand','Small Room 1'"); rep("slotsFor('alan','Small room 1'","slotsFor('alan','Small Room 1'"); rep("slotsFor('iyas','Small room 3'","slotsFor('iyas','Small Room 3'")
rep("title:'Registration', sub:'and coffee'","title:'Registration', sub:'and Coffee'")
rep("sub:'Main hall'","sub:'Main Hall'",3)
rep("title:'Video messages'","title:'Video Messages'",2)
rep("title:'Coffee break', sub:'Pick your sessions'","title:'Coffee Break', sub:'Pick your sessions'")
rep("title:'Lunch and networking'","title:'Lunch and Networking'")
rep("{s:'10:00', name:'Zaid Salem', org:'Gaza Sky Geeks'","{s:'10:00', name:'Zaid Salem', org:'Market Access Lead, Gaza Sky Geeks'")
s=s.replace('One to ones','One to Ones').replace('One to one conversations','One to One Conversations').replace('Focused sessions','Focused Sessions').replace('Networking and lunch','Networking and Lunch')
s=s.replace('the main hall','the Main Hall').replace("Today's advisors","Today's Advisors").replace("'Live poll'","'Live Poll'").replace("'Choose your sessions'","'Choose Your Sessions'").replace("'Advisor spotlight'","'Advisor Spotlight'").replace("'Video messages'","'Video Messages'").replace(">Video messages<",">Video Messages<").replace("'Our advisors'","'Our Advisors'").replace("'Thank you to our advisors'","'Thank You to Our Advisors'").replace("'Your feedback'","'Your Feedback'").replace("'Lunch and networking'","'Lunch and Networking'")
rep("No session this hour. Join a one to one or the Main Hall.","No session this hour. Book a one to one at the registration desk.")
# scene plan
rep("""  welcome: {p:['welcome'], s:['advisors','poll','board']},""","""  welcome: {p:['welcome'], s:['advisors','way','poll']},""")
rep("""  choose:  {p:['choose'], s:['board','spotlight','poll']},
  live:    {p:['rooms'], s:['spotlight','poll','board']},
  lunch:   {p:['recap'], s:['thanks','survey']},
  close:   {p:['recap'], s:['thanks']}""","""  choose:  {p:['choose'], s:['poll','board','spotlight','way']},
  live:    {p:['rooms'], s:['meet','photos','poll','spotlight','board','pulse','way']},
  lunch:   {p:['recap'], s:['photos','meet','poll','thanks']},
  close:   {p:['recap'], s:['photos','thanks']}""")
rep("const LONG = {welcome:26, choose:26, rooms:26, recap:24, spotlight:21, speaker:999, video:999};","const LONG = {welcome:26, choose:26, rooms:26, recap:24, spotlight:21, meet:28, photos:28, poll:20, pulse:14, way:14, speaker:999, video:999};")
rep("survey:'Feedback'};","survey:'Feedback', meet:'Networking Board', photos:'Photo Wall', pulse:'Live Numbers', way:'This Way'};")
rep("return {wide, stageW, n: stageW >= 290 ? 3 : (stageW >= 190 ? 2 : 1)};","return {wide, stageW, n: stageW >= 290 ? 3 : (stageW >= 125 ? 2 : 1)};")
rep("""  const set = SETS[S.mode], sec = set.s.filter(id => !(L.wide && RAIL_HAS.includes(id)));""","""  const pin = P.get('scene') || S.pin; if (pin && R[pin]) return [[pin]];
  const set = SETS[S.mode], sec = set.s.filter(id => !(L.wide && RAIL_HAS.includes(id)) && !(id === 'way' && !S.way));""")
# poll scene replaced
a=s.index("R.poll = (c) => {"); b=s.index("function layoutCloud(el){")
s=s[:a]+"""R.poll = (c) => {
  const vertical = c.w < 80, big = c.w >= 120, choice = S.pollType === 'choice', q = S.pollQ || 'The next poll opens soon';
  const left = `<div class="rv" style="display:flex;flex-direction:${vertical ? 'row' : 'column'};gap:calc(var(--u)*2);align-items:${vertical ? 'center' : 'flex-start'};justify-content:center;max-width:calc(var(--u)*${vertical ? 64 : (big ? 46 : 34)})">${qrBox(CONFIG.join, vertical ? 12 : (big ? 22 : 17), '')}<div class="qrtxt"><b style="${big ? 'font-size:calc(var(--u)*3.2)' : ''}">${esc(q)}</b><span>${S.pollOpen ? 'Scan, answer, and watch your answer appear.' : 'This poll is closed. Thank you for answering.'}</span>${S.pollTotal ? `<span style="margin-top:calc(var(--u)*1.6);color:var(--ink)"><b style="font-weight:300;font-size:calc(var(--u)*4);display:inline">${S.pollTotal}</b> ${S.pollTotal === 1 ? 'answer' : 'answers'}</span>` : ''}</div></div>`;
  const right = choice ? `<div class="pbars rv">${S.poll.map(([o, n]) => { const f = S.pollTotal ? n / S.pollTotal : 0; return `<div class="r"><b>${esc(o)}<span>${Math.round(f * 100)}%</span></b><div class="bar"><i style="width:${(f * 100).toFixed(1)}%"></i></div></div>`; }).join('')}</div>`
    : `<div class="cloud rv" data-cloud>${S.poll.length ? '' : '<div class="empty" style="position:absolute;inset:0">The first answers will appear here.</div>'}</div>`;
  return {title:'Live Poll', html:`<div class="poll" style="grid-template-${vertical ? 'rows:auto minmax(0,1fr)' : 'columns:auto minmax(0,1fr)'}">${left}${right}</div>`, after: choice ? null : layoutCloud};
};
"""+s[b:]
# recap kpis
rep("if (S.checkedIn) k.push([S.checkedIn, 'people joined']);","if (S.checkedIn) k.push([S.checkedIn, 'people joined']); if (S.photos.length) k.push([S.photos.length, 'photos shared']); if (S.profiles.length) k.push([S.profiles.length, 'on the Networking Board']); k.splice(4);")
# rail
rep("""  if (S.poll.length) kp.push([S.poll.reduce((a, w) => a + w[1], 0), 'poll answers']);""","""  if (S.pollTotal) kp.push([S.pollTotal, 'poll answers']);
  if (S.profiles.length) kp.push([S.profiles.length, 'on the Networking Board']);""")
rep("""<div class="mod glass"><div class="qrrow">${qrBox(CONFIG.links.poll, 11.5, 'Poll<br>QR code')}<div class="qrtxt"><b>Tell us in one word</b><span>${esc(CONFIG.pollQuestion)}</span></div></div></div>${wifi}`;""","""<div class="mod glass"><div class="qrrow">${qrBox(CONFIG.join, 11.5, '')}<div class="qrtxt"><b>Scan to join</b><span>Live poll, photo wall and the Networking Board</span></div></div></div>${wifi}`;""")
# data signature
rep("S.poll.map(w => w[0] + w[1]).join()].join('|'); }","S.poll.map(w => w[0] + w[1]).join(), S.pollQ, S.pollOpen, S.pollTotal, S.photos.map(p => p.id).join(), S.profiles.map(p => p.id + p.at).join(), JSON.stringify(S.way), S.pin].join('|'); }")
# announcements
rep("""  if (!act && S.ann && S.annShown !== S.ann && !S.annUntil) { S.annUntil = Date.now() + 20000; S.annShown = S.ann; }
  if (!act && S.annUntil && Date.now() < S.annUntil) act = {at:'ann', k:'Announcement', t:S.ann, p:''};""","""  if (S.annUntil && Date.now() < S.annUntil) act = {at:'ann' + S.annAt, k:'Announcement', t:S.ann, p:''};""")
rep("""<h1 class="rv" style="font-size:calc(var(--u)*${act.at === 'ann' ? 7 : 10.5})">""","""<h1 class="rv" style="font-size:calc(var(--u)*${String(act.at).startsWith('ann') ? 7 : 10.5})">""")
# ticker
rep("""  if (CONFIG.links.poll) o.push(`<span>${esc(CONFIG.pollQuestion)} Scan the code on screen.</span>`);""","""  o.push('<span>Scan the code on screen to answer the poll, share photos and join the Networking Board</span>');
  const tb = tagBalance().filter(x => x.lk); if (tb.length) o.push(`<span>On the Networking Board: ${tb.slice(0, 3).map(x => `${x.lk} looking for ${esc(x.t)}`).join(', ')}</span>`);""")
# data feeds through the site proxy
rep("""function feedUrl(k){ if (CONFIG.feeds[k]) return CONFIG.feeds[k]; if (!CONFIG.feedSheet || P.has('offline')) return ''; return `https://docs.google.com/spreadsheets/d/${CONFIG.feedSheet}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(CONFIG.tabs[k])}`; }""","""function feedUrl(k){ return (P.has('offline') || !location.protocol.startsWith('http')) ? '' : '/api/sheet/' + k; }""")
rep("""const JOBS = [['sessions', applySessions], ['slots', applySlots], ['stats', applyStats], ['poll', applyPoll]];""","""const JOBS = [['sessions', applySessions], ['slots', applySlots], ['stats', applyStats]];""")
rep("""  S.live = tried > 0 && ok === tried;
  $('conn').classList.toggle('live', S.live);
  $('connTxt').innerHTML = (S.demo ? 'Demo data&nbsp; ' : '') + (tried ? (S.live ? 'Live data' : (ok ? 'Partly live' : 'Offline, saved data')) : 'Saved schedule');
  if (S.sheetSpeaker) S.speaker = +S.sheetSpeaker - 1;""","""  S.live = tried > 0 && ok === tried;""")
rep("""function restore(){ JOBS.forEach(""","""function restore(){ try { const v = localStorage.getItem('md4_state'); if (v) applyState(JSON.parse(v)); } catch(e) {} JOBS.forEach(""")
rep("localStorage.setItem('md3_' + k","localStorage.setItem('md4_' + k"); rep("localStorage.getItem('md3_' + k)","localStorage.getItem('md4_' + k)")
# demo only fills poll when there are no real answers
rep("const n = Math.max(0, Math.min(DEMO_WORDS.length, Math.floor((m - 570) / 4))); S.poll =","const n = Math.max(0, Math.min(DEMO_WORDS.length, Math.floor((m - 570) / 4))); if (!S.pollTotal) S.poll =")
rep("const total = SESSIONS.reduce((a, s) => a + s.booked, 0) + SLOTS.filter(x => x.status === 'Booked').length + (S.checkedIn || 0) + S.poll.reduce((a, w) => a + w[1], 0);","const total = SESSIONS.reduce((a, s) => a + s.booked, 0) + SLOTS.filter(x => x.status === 'Booked').length + (S.checkedIn || 0) + (S.pollTotal || 0) + S.photos.length + S.profiles.length;")
# keys
rep("['L','Logo screen'],['B','Black screen'],","['L','Logo screen'],['B','Black screen'],['K','Screen check, for setting up the wall'],['V','Stop a playing video'],")
rep("""  else if (k === 'a') { const t = prompt('Announcement for the screen', S.ann); if (t !== null) { S.ann = t.trim(); S.annShown = ''; updateTicker(); } }""","""  else if (k === 'a') { const t = prompt('Announcement for the screen', S.ann); if (t !== null) { S.ann = t.trim(); S.annAt = Date.now(); S.annUntil = S.ann ? Date.now() + 20000 : 0; updateTicker(); } }
  else if (k === 'k') { setOverlay(S.overlay === 'check' ? null : 'check'); }
  else if (k === 'v') stopVideo();""")
rep("""  else if (k === 'd') { S.demo = !S.demo; if (!S.demo) { S.poll = []; S.checkedIn = null;""","""  else if (k === 'd') { S.demo = !S.demo; if (!S.demo) { if (!S.pollTotal) S.poll = []; S.checkedIn = null;""")
rep("const mode = S.override || S.sheetScene || autoMode(nowMin());","const mode = S.override || S.remoteMode || S.sheetScene || autoMode(nowMin());")
# markup additions
rep("""    <div class="logos" id="logos"></div>""","""    <div class="join" id="join"></div>
    <div class="logos" id="logos"></div>""")
rep("""<div class="ov hide" id="help"></div>""","""<div class="ov hide" id="help"></div>
<div class="ov hide" id="check"></div>
<div class="ov hide" id="vid"><video playsinline preload="auto"></video><div class="vmsg"></div></div>""")
# insert new code before Rail section
new=open('dev/build/screen_new.js').read()
rep("/* ============ Rail ============ */", new + "\n/* ============ Rail ============ */")
# boot
rep("function resize(){ L = layout(); S.plan = ''; gardenKey = ''; initBg(); logos(); tkHtml = ''; loop(true); }","function resize(){ L = layout(); S.plan = ''; gardenKey = ''; initBg(); logos(); joinBlock(); tkHtml = ''; if (S.overlay === 'check') renderCheck(); loop(true); }")
rep("refresh(); setInterval(refresh, CONFIG.refreshSeconds * 1000);","initVideo(); setConn(); refresh(); setInterval(refresh, CONFIG.refreshSeconds * 1000);\nif (location.protocol.startsWith('http')) { pullState(); setInterval(pullState, CONFIG.stateSeconds * 1000); }")
rep("  loop(true); }\nfunction restore()","  loop(true); }\nfunction restore()") if False else None
# CSS
css=open('dev/build/screen_new.css').read()
rep(".hide{display:none!important}", css + "\n.hide{display:none!important}")
open('public/screen/index.html','w').write(s)
print('ok', len(s))
