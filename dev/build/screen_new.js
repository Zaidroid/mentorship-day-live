/* ============ Live system: phones and the operator remote ============ */
const LIVE = {videos:[{id:'tareq', title:'Tareq Azza', src:'/videos/tareq-azza.mp4'}, {id:'kassim', title:'KassimLegal', src:'/videos/kassimlegal.mp4'}]};
Object.assign(S, {photos:[], profiles:[], pollQ:'', pollType:'words', pollOpts:[], pollTotal:0, pollOpen:true, remoteMode:null, pin:null, way:null, cfgAt:null, videoAt:null, annAt:null, annUntil:0, liveOk:false, skew:0});
function applyState(d){
  if (d.t) S.skew = d.t - Date.now();
  const p = d.poll;
  if (p) { S.pollQ = p.q; S.pollType = p.type; S.pollOpen = !!p.open; S.pollTotal = p.total || 0; S.pollOpts = p.options || [];
    if (p.type === 'choice') { const m = Object.fromEntries(p.words || []); S.poll = S.pollOpts.map(o => [o, m[o] || 0]); } else S.poll = p.words || []; }
  else { S.pollQ = ''; S.poll = []; S.pollTotal = 0; S.pollType = 'words'; }
  S.photos = d.photos || []; S.profiles = d.profiles || []; if (d.videos && d.videos.length) LIVE.videos = d.videos;
  const c = d.cfg || {}; if (c.at === S.cfgAt) return;
  const first = S.cfgAt === null, srv = Date.now() + S.skew; S.cfgAt = c.at;
  const rm = c.mode && c.mode !== 'auto' ? c.mode : null;
  if (!first && (rm !== S.remoteMode || (c.pin || null) !== S.pin)) S.override = null;
  S.remoteMode = rm; S.pin = c.pin || null; S.way = c.way || null;
  S.speaker = c.speaker == null ? null : c.speaker;
  if (c.theme && c.theme !== S.theme) S.theme = c.theme;
  setOverlay(c.overlay || null);
  if (c.ann && c.ann.at !== S.annAt) { S.annAt = c.ann.at; S.ann = c.ann.text; const left = c.ann.at + c.ann.secs * 1000 - srv; S.annUntil = first ? (left > 0 ? Date.now() + left : 0) : Date.now() + c.ann.secs * 1000; }
  if (!c.ann) { S.ann = ''; S.annUntil = 0; S.annAt = null; }
  if (c.video && c.video.at !== S.videoAt) { S.videoAt = c.video.at; if (!first || srv - c.video.at < 20000) { if (c.video.id) playVideo(c.video.id); else stopVideo(); } }
}
async function pullState(){
  try { const r = await fetch('/api/state', {cache:'no-store'}); if (!r.ok) throw 0; const d = await r.json(); applyState(d); S.liveOk = true; try { localStorage.setItem('md4_state', JSON.stringify(d)); } catch(e) {} }
  catch(e) { S.liveOk = false; }
  setConn(); loop(false);
}
function setConn(){ const ok = S.liveOk; $('conn').classList.toggle('live', ok); $('connTxt').innerHTML = (S.demo ? 'Demo data&nbsp; ' : '') + (ok ? 'Live' : 'Offline, saved data'); }
function setOverlay(o){ S.overlay = o; $('black').classList.toggle('hide', o !== 'black'); $('logo').classList.toggle('hide', o !== 'logo'); if (o === 'check') renderCheck(); $('check').classList.toggle('hide', o !== 'check'); }

/* video, started from the remote */
function playVideo(id){
  const v = LIVE.videos.find(x => x.id === id); if (!v) return;
  const box = $('vid'), el = box.querySelector('video'), msg = box.querySelector('.vmsg');
  msg.textContent = ''; box.classList.remove('hide'); el.muted = false; el.src = v.src;
  el.play().catch(err => { if (err && err.name === 'NotAllowedError') { el.muted = true; el.play().catch(() => {}); toast('Click the screen once so videos can play with sound'); } });
}
function stopVideo(){ const box = $('vid'), el = box.querySelector('video'); el.pause(); el.removeAttribute('src'); el.load(); box.classList.add('hide'); }
function initVideo(){ const box = $('vid'), el = box.querySelector('video'), msg = box.querySelector('.vmsg');
  el.addEventListener('ended', stopVideo);
  el.addEventListener('error', () => { if (!el.getAttribute('src')) return; msg.textContent = 'This video file is not on the screen yet'; setTimeout(stopVideo, 5000); }); }

/* screen check for setting up the wall */
function renderCheck(){
  const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight, g = [];
  for (let i = 1; i < 10; i++) g.push(`<i style="left:${i * 10}%;top:0;bottom:0;width:1px"></i><i style="top:${i * 10}%;left:0;right:0;height:1px"></i>`);
  const corner = (t, l) => `<b style="${t}:0;${l}:0;border-${t}:calc(var(--u)*1.2) solid #2F9CC3;border-${l}:calc(var(--u)*1.2) solid #2F9CC3"></b>`;
  $('check').innerHTML = `<div class="grid">${g.join('')}</div><div class="edge"></div>${corner('top','left')}${corner('top','right')}${corner('bottom','left')}${corner('bottom','right')}<div class="cross"></div>
    <div class="info glass"><strong>Screen check</strong><div>${W} x ${H} browser pixels</div><div>${Math.round(W * dpr)} x ${Math.round(H * dpr)} device pixels</div><div>Shape ${(W / H).toFixed(2)} to 1</div><div>Layout: ${L.wide ? 'ultra wide, with side panel' : (L.n > 1 ? L.n + ' columns' : 'one column')}</div>
    <div>The red frame and blue corners should sit exactly on the edges of the wall.</div><div style="font-size:calc(var(--u)*1.3);margin-top:calc(var(--u)*1)">This is the smallest text the screen uses. Check it is readable from the back of the hall.</div></div>`;
}

/* shared pieces */
function emptyJoin(title, text, c){ const col = c.w < 70;
  return `<div style="flex:1;display:flex;align-items:center;justify-content:center;gap:calc(var(--u)*4);${col ? 'flex-direction:column;text-align:center' : ''}"><div class="rv">${qrBox(CONFIG.join, Math.min(24, Math.max(14, c.w * .3)), '')}</div>
    <div class="rv" style="max-width:calc(var(--u)*54)"><div style="font-weight:700;font-size:calc(var(--u)*${col ? 3.6 : 4.6});line-height:1.05;color:var(--red);text-wrap:balance">${esc(title)}</div><div style="height:calc(var(--u)*.45);background:var(--teal);width:calc(var(--u)*12);margin:calc(var(--u)*1.8) ${col ? 'auto' : '0'} 0"></div><p style="font-size:calc(var(--u)*2.1);color:var(--ink2);line-height:1.4;margin-top:calc(var(--u)*1.8)">${esc(text)}</p></div></div>`; }
function joinBlock(){ const el = $('join'); if (L.wide) { el.style.display = 'none'; return; } el.style.display = ''; el.innerHTML = `${qrBox(CONFIG.join, 9, '')}<div><b>Scan to join</b><span>Live poll, photo wall and the Networking Board</span></div>`; }

/* Networking Board */
function tagBalance(){ const m = {}; (S.profiles || []).forEach(p => { (p.looking || []).forEach(t => { (m[t] = m[t] || {t, lk:0, of:0}).lk++; }); (p.offer || []).forEach(t => { (m[t] = m[t] || {t, lk:0, of:0}).of++; }); }); return Object.values(m).sort((a, b) => (b.lk + b.of) - (a.lk + a.of)); }
function matchesFor(p){ const out = []; (S.profiles || []).forEach(q => { if (q.id === p.id) return; const a = (q.offer || []).filter(t => (p.looking || []).includes(t)), b = (q.looking || []).filter(t => (p.offer || []).includes(t)); if (a.length || b.length) out.push({q, n:a.length + b.length}); }); return out.sort((x, y) => y.n - x.n).slice(0, 3); }
let meetI = 0;
R.meet = (c) => {
  const list = S.profiles || [];
  if (!list.length) return {title:'Networking Board', html:emptyJoin('Join the Networking Board', 'Add your name, company and what you are looking for. Your card appears here and helps the right people find you.', c)};
  const p = list[meetI % list.length], mt = matchesFor(p), wide = c.w >= 76, bal = tagBalance().slice(0, wide ? 7 : 4), mx = Math.max(1, ...bal.map(x => Math.max(x.lk, x.of)));
  const card = `<div class="card glass rv"><div style="display:flex;align-items:center;gap:calc(var(--u)*2)"><div class="ini">${esc(initials(p.name))}</div><div style="min-width:0"><div class="nm">${esc(p.name)}</div><div class="co">${esc([p.role, p.company].filter(Boolean).join(', '))}</div></div></div>
    ${(p.looking || []).length ? `<div class="tagrow"><em>Looking for</em>${p.looking.map(t => `<span class="tg lk">${esc(t)}</span>`).join('')}</div>` : ''}
    ${(p.offer || []).length ? `<div class="tagrow"><em>Can help with</em>${p.offer.map(t => `<span class="tg of">${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="match">${mt.length ? `Good people to meet: ${mt.map(x => `<b>${esc(x.q.name)}</b>`).join(', ')}` : 'Scan the code to add yourself and find your matches.'}</div></div>`;
  const balH = `<div class="bal rv"><h4>Who is looking for what</h4>${bal.map(x => `<div class="r"><b>${esc(x.t)}</b><div class="bars"><i class="lk" style="width:${(x.lk / mx * 100).toFixed(0)}%"></i><i class="of" style="width:${(x.of / mx * 100).toFixed(0)}%"></i></div></div>`).join('')}
    <div class="legend" style="margin-top:calc(var(--u)*.8)"><span><i class="n"></i>Looking for</span><span><i style="background:var(--teal);border-color:var(--teal)"></i>Can help</span></div></div>`;
  const others = list.filter(x => x.id !== p.id).slice(0, wide ? 12 : 5);
  const names = `<div class="names rv"><b>${list.length} ${list.length === 1 ? 'person' : 'people'} on the board</b>${others.map(x => `<span>${esc(x.name)}</span>`).join('')}</div>`;
  return {title:'Networking Board', html: wide
    ? `<div class="meet" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);grid-template-rows:auto auto;align-content:center">${card}${balH}<div style="grid-column:1/-1">${names}</div></div>`
    : `<div class="meet" style="grid-template-rows:auto minmax(0,1fr)">${card}${balH}</div>`, tick:7, onTick:() => { meetI++; return list.length > 1; }};
};

/* Photo Wall */
let photoI = 0;
const phUrl = id => '/api/photo/' + encodeURIComponent(id);
function phCap(x){ if (!x.caption && !x.name) return ''; return `<div class="cap">${x.caption ? `<b>${esc(x.caption)}</b>` : ''}${x.name ? `<span>${x.caption ? 'Shared by ' : 'Shared by '}${esc(x.name)}</span>` : ''}</div>`; }
R.photos = (c) => {
  const list = S.photos || [];
  if (!list.length) return {title:'Photo Wall', html:emptyJoin('Share your photos of the day', 'Scan the code, take a photo and send it. The team approves every photo before it appears here.', c)};
  const f = list[photoI % list.length], tick = {tick:7, onTick:() => { photoI++; return list.length > 1; }};
  if (c.w < 76 || list.length < 3) return {title:'Photo Wall', html:`<div class="pw"><div class="ph big rv"><img src="${phUrl(f.id)}" alt="">${phCap(f)}</div></div>`, ...tick};
  const n = Math.min(4, list.length - 1), others = []; for (let i = 1; i <= n; i++) others.push(list[(photoI + i) % list.length]);
  const cols = n >= 3 ? '2fr 1fr 1fr' : '2fr 1fr';
  return {title:'Photo Wall', html:`<div class="pw" style="grid-template-columns:${cols};grid-template-rows:1fr 1fr"><div class="ph big rv" style="grid-row:1/3"><img src="${phUrl(f.id)}" alt="">${phCap(f)}</div>${others.map(x => `<div class="ph rv"><img src="${phUrl(x.id)}" alt="">${x.name ? `<div class="cap sm"><span>${esc(x.name)}</span></div>` : ''}</div>`).join('')}</div>`, ...tick};
};

/* Live Numbers */
R.pulse = (c) => {
  const booked = SESSIONS.reduce((a, s) => a + (s.booked || 0), 0), oo = SLOTS.filter(x => x.status === 'Booked').length, k = [];
  if (S.checkedIn) k.push([S.checkedIn, 'people checked in']);
  if (booked) k.push([booked, 'session seats booked']);
  if (oo) k.push([oo, 'one to ones booked']);
  k.push([S.pollTotal || 0, 'poll answers']);
  k.push([(S.photos || []).length, 'photos shared']);
  k.push([(S.profiles || []).length, 'on the Networking Board']);
  if (k.length < 6) k.push([advisorCount(), 'advisors today']);
  if (k.length < 6) k.push([SESSIONS.length, 'sessions today']);
  const cols = c.w >= 76 ? 3 : 2;
  return {title:'Live Numbers', html:`<div class="pulse" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${k.slice(0, cols * 2).map(x => `<div class="kpi rv"><b data-count="${x[0]}">0</b><span>${x[1]}</span><i></i></div>`).join('')}</div>`};
};

/* This Way */
const DEG = {'right':0, 'down right':45, 'down':90, 'down left':135, 'left':180, 'up left':225, 'up':270, 'up right':315};
const ARROW = '<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M18,50 H78 M56,27 L79,50 L56,73" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const WAYS = [{k:'registration', t:'Registration', s:'Badges and one to one bookings'}, {k:'rooms', t:'Rooms A, B and C', s:'Sessions'}, {k:'oneToOnes', t:'One to Ones', s:'Small Rooms 1 and 3', blue:true}];
R.way = (c) => {
  const items = WAYS.filter(w => S.way && S.way[w.k]), row = c.w >= 165;
  return {title:'This Way', html:`<div class="way" style="grid-template-columns:${row ? `repeat(${items.length},minmax(0,1fr))` : '1fr'}"><div class="here rv" style="grid-column:1/-1">You are in the Main Hall</div>${items.map(w => `<div class="wy glass rv"><div class="arr leaf ${w.blue ? 'blue' : ''}"><i style="rotate:${DEG[S.way[w.k]] || 0}deg">${ARROW}</i></div><div style="min-width:0"><b>${esc(w.t)}</b><span>${esc(w.s)}</span></div></div>`).join('')}</div>`};
};
