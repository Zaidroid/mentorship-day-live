#!/usr/bin/env node
// Crowd simulator and load test for Mentorship Day Live (docs/PLAN.md, WP3).
//
//   node scripts/sim.mjs [--base http://localhost:8897] [--people 100] [--from 09:25] [--speed 30] [--until 15:05]
//                        [--pin 123456] [--seed 1] [--wipe-first] [--allow-remote]
//   node scripts/sim.mjs --load [--seconds 120] [--clients 120]
//
// The day mode starts a rehearsal at --from, imports made up sample people, then plays the day through the real
// routes: sign ins, picks, poll answers, reactions, cards, connections, photos, takeaways, guests, wrong codes and
// feedback. Every simulated person has a device id. The simulated clock moves the server's rehearsal forward by
// itself, one minute at a time, so a day at speed 30 takes 11 real minutes.
//
// All people are test data. Names come from two fixed lists below, last 4 digits are made up and kept only in memory.
// Nothing here reads or fetches real registration data.
//
// Safety: only localhost unless --allow-remote (then a warning and a 5 second wait). --wipe-first is refused for any
// base that is not local. A rehearsal is refused by the server on the real 17 November, so this cannot move that day.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../public/assets/day.js";

const DAY = globalThis.MD_DAY;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- arguments ---------- */
const FLAGS = new Set(["load", "allow-remote", "wipe-first", "help", "demo"]);
function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { console.error(`Unexpected argument: ${a}`); process.exit(2); }
    const k = a.slice(2);
    if (FLAGS.has(k)) o[k] = true;
    else { if (i + 1 >= argv.length) { console.error(`--${k} needs a value`); process.exit(2); } o[k] = argv[++i]; }
  }
  return o;
}
const A = parseArgs(process.argv.slice(2));
if (A.help) {
  console.log(`Usage:
  node scripts/sim.mjs [--base URL] [--people 100] [--from 09:25] [--speed 30] [--until 15:05] [--pin PIN] [--seed 1]
                       [--wipe-first] [--allow-remote] [--phone-active-min 45]
  node scripts/sim.mjs --load [--seconds 120] [--clients 120] [--base URL] [--pin PIN]
Defaults: base http://localhost:8897, pin from REMOTE_PIN or 123456.`);
  process.exit(0);
}
const BASE = (A.base || "http://localhost:8897").replace(/\/+$/, "");
const PIN = A.pin || process.env.REMOTE_PIN || "123456";
const PEOPLE = Math.max(4, parseInt(A.people ?? "100", 10));
const SPEED = Math.max(0.5, +(A.speed ?? 30));
const SEED = parseInt(A.seed ?? "1", 10);
const toMin = hhmm => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
const fmt = m => { m = Math.floor(m); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
for (const k of ["from", "until"]) if (A[k] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(A[k])) { console.error(`--${k} must be HH:MM`); process.exit(2); }
const FROM = toMin(A.from || "09:25"), UNTIL = toMin(A.until || "15:05");
if (UNTIL <= FROM) { console.error("--until must be later than --from"); process.exit(2); }
if (!Number.isFinite(PEOPLE) || !Number.isFinite(SPEED)) { console.error("--people and --speed must be numbers"); process.exit(2); }

/* ---------- safety ---------- */
const isLocal = (() => { try { const u = new URL(BASE); return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"); } catch { return false; } })();
try { new URL(BASE); } catch { console.error(`--base is not an address: ${BASE}`); process.exit(2); }
if (A["wipe-first"] && !isLocal) { console.error("Refusing --wipe-first: it is only allowed for http://localhost or http://127.0.0.1."); process.exit(2); }
if (!isLocal) {
  if (!A["allow-remote"]) { console.error(`Refusing ${BASE}. The simulator only runs against http://localhost or http://127.0.0.1. Add --allow-remote to override.`); process.exit(2); }
  console.warn(`WARNING: ${BASE} is not a local address. The simulator writes test people, answers, photos and takeaways there.`);
  console.warn("Waiting 5 seconds. Press Control C to stop.");
  await sleep(5000);
}

/* ---------- seeded random ---------- */
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(SEED);
const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = arr => arr[Math.floor(rnd() * arr.length)];
const chance = p => rnd() < p;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
const shuffle = arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

/* ---------- requests, counted per route ---------- */
const stats = new Map();   // label -> { n, ok, bad, expected, ms: [], hit, cacheHdr }
const unexpected = [];     // { label, status, msg }
const inflightLimit = 16;
let inflight = 0; const waiters = [];
const acquire = () => inflight < inflightLimit ? (inflight++, Promise.resolve()) : new Promise(r => waiters.push(r));
const release = () => { const w = waiters.shift(); if (w) w(); else inflight--; };

function label(method, p) {
  let u = p.split("?")[0];
  u = u.replace(/^\/api\/photo\/.+$/, "/api/photo/:id").replace(/^\/api\/export\/.+$/, "/api/export/:what");
  return `${method} ${u}`;
}
// call(method, path, { dev, pin, json, raw, headers, expect: [status...], text })
// Returns { ok, status, data }. A status in expect is counted as expected, not as a failure.
async function call(method, p, o = {}) {
  const lab = label(method, p);
  const h = { ...(o.headers || {}) };
  if (o.dev) h["x-dev"] = o.dev;
  if (o.pin) { h["x-pin"] = PIN; h["x-who"] = encodeURIComponent("Simulator"); }
  let body;
  if (o.json !== undefined) { h["content-type"] = "application/json"; body = JSON.stringify(o.json); }
  else if (o.raw) body = o.raw;
  await acquire();
  const t0 = performance.now();
  let status = 0, data = null, err = "", hdr = null;
  try {
    const r = await fetch(BASE + p, { method, headers: h, body, signal: AbortSignal.timeout(30000) });
    status = r.status; hdr = r.headers;
    if (o.text) data = await r.text();
    else if (status !== 204 && (r.headers.get("content-type") || "").includes("json")) data = await r.json().catch(() => null);
    else await r.arrayBuffer();
  } catch (e) { err = e.message || String(e); }
  finally { release(); }
  const ms = performance.now() - t0;
  const s = stats.get(lab) || { n: 0, ok: 0, bad: 0, expected: 0, ms: [], hit: 0, cacheHdr: 0, s5: 0 };
  s.n++; s.ms.push(ms);
  if (status >= 500) s.s5++;
  if (hdr) { const c = hdr.get("cache-status"); if (c) { s.cacheHdr++; if (/;\s*hit\b/i.test(c) || /^hit\b/i.test(c)) s.hit++; } }
  const ok = status >= 200 && status < 300;
  if (ok) s.ok++;
  else if (o.expect && o.expect.includes(status)) s.expected++;
  else { s.bad++; if (unexpected.length < 500) unexpected.push({ label: lab, status, msg: err || (data && data.error) || "" }); }
  stats.set(lab, s);
  return { ok, status, data };
}
const op = (json, o = {}) => call("POST", "/api/op", { pin: true, json, ...o });
const opGet = () => call("GET", "/api/op", { pin: true });
const pct = (arr, q) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };

/* ---------- sample data ---------- */
// Fixed lists of sample names. Test data only. A few are in Arabic script, to prove display and search.
const FIRST = ["Layla", "Omar", "Rana", "Yousef", "Dina", "Karim", "Nour", "Tariq", "Salma", "Hadi", "Maya", "Sami", "Lina", "Fadi", "Reem", "Jad", "Samar", "Bilal", "Hana", "Walid", "Dalia", "Ziad", "Mona", "Rami", "Aya", "Majd", "Lubna", "Nabil", "Ruba", "Khaled", "Tala", "Ihab", "Sara", "Adel", "Noor", "Basel", "Yara", "Hamza", "Abeer", "Murad", "Jana", "Osama"];
const LAST = ["Khoury", "Saleh", "Odeh", "Amin", "Haddad", "Nasser", "Barakat", "Qasem", "Jaber", "Hamdan", "Mansour", "Shaheen", "Daher", "Abbas", "Rizk", "Taha", "Farah", "Zidan", "Awad", "Masri", "Issa", "Karam", "Najjar", "Sabri", "Tamimi", "Hijazi", "Shami", "Bishara", "Yassin", "Ghanem", "Atrash", "Salameh", "Kanaan", "Dajani", "Rabah", "Jarrar", "Sayegh", "Haddadin", "Natsheh", "Zayed", "Awwad", "Bader"];
const AR_FIRST = ["ليلى", "عمر", "رنا", "يوسف", "دينا", "كريم"];
const AR_LAST = ["الخوري", "صالح", "عودة", "أمين", "حداد", "ناصر"];
const COMPANY = ["Sample Labs", "Sample Studio", "Sample Works", "Sample Group", "Sample Tech", "Sample Digital", "Sample Ventures", "Sample Cloud", "Sample Media", "Sample Foods", "Sample Health", "Sample Learning"];
const TITLE = ["Founder", "CEO", "CTO", "Product Manager", "Marketing Lead", "Software Engineer", "Designer", "Operations Lead", "Sales Manager", "Data Analyst", "Freelancer", "Team Lead"];
const GUESTS = ["Sample Guest A", "Sample Guest B", "Sample Guest C", "Sample Guest D", "Sample Guest E", "Sample Guest F", "Sample Guest G", "Sample Guest H"];
const WORDS = {
  p1: ["funding", "clients", "network", "mentors", "clarity", "markets", "sales", "visibility", "partners", "investors", "confidence", "customers", "focus", "time", "talent", "contracts", "عملاء", "تمويل"],
  p3: ["energized", "inspired", "busy", "connected", "learning", "focused", "hopeful", "curious", "motivated", "tired", "great", "useful", "welcome", "ملهم"],
  p4: ["follow up", "pitch", "network", "ask", "delegate", "hire", "price", "listen", "plan", "reach out", "publish", "simplify", "test", "تواصل"]
};
const LOOK = ["Funding", "Clients", "Partnerships", "Hiring", "A New Job", "Mentoring", "Marketing", "Product", "AI and Tech", "Freelancing"];
const CAPTIONS = ["Coffee in the Main Hall", "Room A session", "Room B session", "Room C session", "Networking at lunch", "One to one corner", "Registration desk", "Opening on the stage", "Advisors and attendees", "Talking after the session"];
const LINES = [
  "Lead with the client problem, not the product.", "Follow up within two days, always.", "AI changes the tasks first, then the jobs.", "Ask for the intro, do not wait for it.",
  "Price on value, not on hours.", "Write the pitch in one sentence first.", "Small steps every week beat big plans.", "Say no to the wrong clients early.",
  "Share the problem before the solution.", "Find a mentor who has done it before.", "Test with ten customers before building more.", "Your story is your brand.",
  "Clear words win meetings.", "Hire slowly and for attitude.", "Remote work needs more writing, not less.", "Numbers first, then the story.", "قصتك هي علامتك"
];
const FB_LINES = ["Well organized, thank you.", "More time for one to ones next year.", "Loved the sessions.", "Great advisors.", "Please add a coffee break after lunch."];
const TOPICS = Object.keys(DAY.topicMap);
const SESSIONS_BY_BLOCK = n => DAY.sessions.filter(x => x.b === n);
let SAMPLE_JPG = null;
const sampleJpg = () => (SAMPLE_JPG ||= fs.readFileSync(path.join(HERE, "sample.jpg")));
const RUN = Math.floor(rnd() * 0xffffff).toString(36).padStart(4, "0").slice(0, 4) + Date.now().toString(36).slice(-3);

function makePeople(n) {
  const out = [], seen = new Set();
  for (let i = 0; i < n; i++) {
    let first, last, ar = i % 16 === 5;
    if (ar) { const k = Math.floor(i / 16); first = AR_FIRST[k % 6]; last = AR_LAST[(k + Math.floor(k / 6)) % 6]; }
    else { first = FIRST[i % FIRST.length]; last = LAST[(i + Math.floor(i / FIRST.length)) % LAST.length]; }
    let name = `${first} ${last}`; if (seen.has(name)) name = `${name} ${i}`; seen.add(name);
    const k = rint(1, 3), topics = shuffle([...TOPICS]).slice(0, k);
    out.push({
      i, name, first, last4: String(rint(0, 9999)).padStart(4, "0"), company: pick(COMPANY), title: pick(TITLE), topics,
      advisorPref: pick(["remote", "local", "", "remote", "local"]), photoOk: chance(0.85), dev: `sim${RUN}${String(i).padStart(4, "0")}`,
      kind: "person", signed: false, pub: null, hello: chance(0.8), stars: {}, card: false, code: null, lastRx: 0, rxN: 0, arrive: 0, wrongFirst: 0, present: false
    });
  }
  return out;
}

/* ---------- time ---------- */
const tzFmt = new Intl.DateTimeFormat("en-US", { timeZone: DAY.tz, hourCycle: "h23", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const serverMin = ms => { const o = {}; for (const p of tzFmt.formatToParts(new Date(ms))) o[p.type] = p.value; return +o.hour * 60 + +o.minute + +o.second / 60; };

/* ---------- the day ---------- */
let S = null;                    // the last /api/state answer, kept by the wall bot
let simNow = FROM;               // simulated clock in minutes since midnight
let maxDrift = 0;
const eventsList = []; const dyn = [];
const at = (t, fn) => { if (t >= FROM) eventsList.push({ t, fn }); };
const later = (t, fn) => dyn.push({ t, fn });
const inWin = (a, b, margin = 0.35) => { const lo = Math.max(FROM + 0.3, toMin(a) + margin), hi = toMin(b) - margin; return lo < hi ? [lo, hi] : null; };
const uni = (lo, hi) => lo + rnd() * (hi - lo);
const info = {};                 // counters for the summary

async function signIn(p) {
  const q = encodeURIComponent(p.name);
  const w = await call("GET", `/api/who?q=${q}`, { dev: p.dev });
  const hit = w.ok && w.data && (w.data.list || []).find(x => x.name === p.name);
  if (!hit) return;
  for (let k = 0; k < p.wrongFirst; k++) {
    const bad = String((+p.last4 + 1 + k) % 10000).padStart(4, "0");
    await call("POST", "/api/claim", { dev: p.dev, json: { id: hit.id, last4: bad, hello: p.hello }, expect: [401] });
    info.wrongCodes = (info.wrongCodes || 0) + 1;
  }
  const c = await call("POST", "/api/claim", { dev: p.dev, json: { id: hit.id, last4: p.last4, hello: p.hello } });
  if (!c.ok) return;
  p.signed = true; p.pub = c.data.me.pub;
  for (const [b, st] of Object.entries(c.data.stars || {})) p.stars[b] = st.sid;
  info.signed = (info.signed || 0) + 1;
}
async function signInGuest(p) {
  const g = await call("POST", "/api/guest", { dev: p.dev, json: { name: p.name, hello: p.hello } });
  if (!g.ok) return;
  p.signed = true; p.pub = g.data.me.pub; info.guests = (info.guests || 0) + 1;
}
const openMe = async p => { if (!p.signed) return null; const r = await call("GET", "/api/me", { dev: p.dev }); if (r.ok) { p.code = r.data.code || null; for (const [b, st] of Object.entries(r.data.stars || {})) p.stars[b] = st.sid; } return r.data; };
async function makeCard(p) {
  if (!p.signed || p.card) return;
  const pickTags = () => shuffle([...(S && S.tags && S.tags.length ? S.tags : LOOK)]).slice(0, rint(1, 2));
  const r = await call("POST", "/api/profile", { dev: p.dev, json: { name: p.kind === "guest" ? p.name : undefined, company: p.kind === "guest" ? p.company : undefined, role: p.title, looking: pickTags(), offer: pickTags(), linkedin: "", consent: true } });
  if (!r.ok) return;
  p.card = true; info.cards = (info.cards || 0) + 1;
  later(simNow + 0.05, () => openMe(p));
}
async function changeStar(p, b) {
  if (!p.signed) return;
  const list = SESSIONS_BY_BLOCK(b); if (!list.length) return;
  const cur = p.stars[b];
  const keep = cur && chance(0.6);
  const sid = keep ? cur : pick(list).id;
  const r = await call("POST", "/api/star", { dev: p.dev, json: { b, sid }, expect: [409] });
  if (r.ok) p.stars[b] = sid; else if (r.status === 409) info.seatByTeam = (info.seatByTeam || 0) + 1;
}
async function answerPoll(p, pollRow, polls) {
  if (!p.signed) return;
  const poll = polls.find(x => x.id === pollRow.id); if (!poll) return;
  const text = poll.type === "choice" ? pick(poll.options) : pick(WORDS[poll.id] || WORDS.p1);
  const r = await call("POST", "/api/answer", { dev: p.dev, json: { pid: poll.id, text } });
  if (r.ok) info.answers = (info.answers || 0) + 1;
}
async function react(p, w) {
  if (!p.signed || p.rxN >= 150 || p.rxBusy) return;
  // a retry can fall outside the window: reactions are only sent while the window is open
  if (!DAY.reactionWindows.some(x => simNow >= toMin(x.from) + 0.2 && simNow < toMin(x.to) - 0.2)) { info.rxSkipped = (info.rxSkipped || 0) + 1; return; }
  const wait = 3300 - (performance.now() - p.lastRx); // the gap counts from the last answer, as a phone's timer would
  if (wait > 0) { later(simNow + (wait / 60000) * SPEED + 0.01, () => react(p, w)); return; }
  p.rxBusy = true;
  const heavy = simNow < toMin("10:08") || (simNow > toMin("10:36") && simNow < toMin("10:40"));
  const c = { clap: rint(0, heavy ? 30 : 8), heart: rint(0, heavy ? 12 : 8), bloom: rint(0, 6) };
  if (!c.clap && !c.heart && !c.bloom) c.heart = 1;
  const r = await call("POST", "/api/react", { dev: p.dev, json: { c } });
  p.rxBusy = false; p.lastRx = performance.now();
  if (r.ok) { p.rxN++; info.reactions = (info.reactions || 0) + c.clap + c.heart + c.bloom; }
}
async function meetSomeone(p) {
  if (!p.signed || !p.code) return;
  const pool = people.filter(x => x !== p && x.code); if (!pool.length) return;
  const t = pick(pool);
  const r = await call("POST", "/api/meet", { dev: p.dev, json: { code: String(t.code) } });
  if (r.ok && !r.data.again) info.links = (info.links || 0) + 1;
}
async function wrongMeet(p) {
  if (!p.signed || !p.code) return;
  const taken = new Set(people.map(x => String(x.code)));
  let code = String(rint(100, 999)); for (let k = 0; k < 20 && taken.has(code); k++) code = String(rint(100, 999));
  await call("POST", "/api/meet", { dev: p.dev, json: { code }, expect: [404] });
  info.wrongMeet = (info.wrongMeet || 0) + 1;
}
async function takeaway(p, b) {
  if (!p.signed) return;
  const list = SESSIONS_BY_BLOCK(b); if (!list.length) return;
  const sid = p.stars[b] && list.some(x => x.id === p.stars[b]) ? p.stars[b] : pick(list).id;
  const rating = chance(0.75) ? rint(4, 5) : rint(1, 4);
  const text = chance(0.7) ? pick(LINES) : "";
  const r = await call("POST", "/api/takeaway", { dev: p.dev, json: { sid, rating, text, showName: chance(0.5) } });
  if (r.ok) info.takeaways = (info.takeaways || 0) + 1;
}
async function phonePhoto(p) {
  if (!p.signed) return;
  const r = await call("POST", "/api/photo", { dev: p.dev, raw: sampleJpg(), headers: { "content-type": "image/jpeg", "x-name": encodeURIComponent(p.first), "x-caption": encodeURIComponent(pick(CAPTIONS)) } });
  if (r.ok) info.phonePhotos = (info.phonePhotos || 0) + 1;
}
async function teamPhoto() {
  const r = await call("POST", "/api/photo", { pin: true, raw: sampleJpg(), headers: { "content-type": "image/jpeg", "x-name": encodeURIComponent("Team"), "x-caption": encodeURIComponent(pick(CAPTIONS)) } });
  if (r.ok) info.teamPhotos = (info.teamPhotos || 0) + 1;
}
async function feedback(p) {
  if (!p.signed) return;
  const r = await call("POST", "/api/feedback", { dev: p.dev, json: { overall: rint(3, 5), recommend: chance(0.9) ? rint(6, 10) : null, text: chance(0.5) ? pick(FB_LINES) : "" } });
  if (r.ok) info.feedback = (info.feedback || 0) + 1;
}
// The team: every few minutes look at what waits and approve it, as the remote would.
async function teamRound() {
  const g = await opGet(); if (!g.ok) return;
  const pend = g.data.pending || {};
  for (const ph of pend.photos || []) { const reject = chance(0.06); await op({ action: reject ? "rejectPhoto" : "approvePhoto", id: ph.id }); info.photoReviewed = (info.photoReviewed || 0) + 1; }
  for (const pr of pend.profiles || []) { await op({ action: "approveProfile", id: pr.id, at: pr.at }, { expect: [409, 404] }); info.cardReviewed = (info.cardReviewed || 0) + 1; }
  for (const tk of pend.takeaways || []) { await op({ action: "approveTakeaway", sid: tk.sid, id: tk.id, at: tk.at }, { expect: [409, 404] }); info.tkReviewed = (info.tkReviewed || 0) + 1; }
}

let people = [], guests = [], polls = [];
function planDay() {
  const N = people.length;
  const nWrong = Math.max(2, Math.round(N * 0.05));
  shuffle([...people]).slice(0, nWrong).forEach(p => { p.wrongFirst = rint(1, 2); });
  const arrive = () => {
    const r = rnd();
    if (r < 0.75) return clamp(toMin("09:50") + gauss() * 8, toMin("09:30"), toMin("10:25"));
    if (r < 0.92) return uni(toMin("10:25"), toMin("10:50"));
    return uni(toMin("10:50"), toMin("11:30"));
  };
  const nCards = Math.round(N * 0.6);
  const cardIds = new Set(shuffle([...people]).slice(0, nCards).map(p => p.i));
  const photoIds = new Set(shuffle([...people]).slice(0, Math.max(2, Math.round(N * 0.17))).map(p => p.i));
  const lunchMeeters = new Set();
  for (const p of people) {
    const t0 = Math.max(FROM + 0.3 + rnd() * 0.5, arrive());
    p.arrive = t0;
    at(t0, () => signIn(p).then(() => { p.present = p.signed; }));
    at(t0 + 0.6, () => openMe(p));
    // stars: keep or change in the break before each block
    at(uni(toMin("10:41"), toMin("10:57")), () => changeStar(p, 1));
    at(uni(toMin("11:50"), toMin("11:58")), () => changeStar(p, 2));
    at(uni(toMin("12:48"), toMin("12:58")), () => changeStar(p, 3));
    if (chance(0.5)) at(uni(toMin("10:41"), toMin("10:57")) + 0.02, () => openMe(p));
    // one poll answer per person per poll, in its window
    for (const row of DAY.pollPlan) {
      const from = toMin(row.from), to = toMin(row.to);
      const lo = Math.max(from + 0.5, t0 + 1 + rnd() * 4), hi = to - 0.6;
      if (lo >= hi) continue;
      at(clamp(lo + rnd() * (to - from) * 0.25, lo, hi), () => answerPoll(p, row, polls));
    }
    // reactions in both windows
    DAY.reactionWindows.forEach((w, wi) => {
      const win = inWin(w.from, w.to); if (!win) return;
      const n = wi === 0 ? rint(10, 22) : rint(14, 30);
      for (let k = 0; k < n; k++) {
        // clustered: half the bursts near the speaker moments or the end of the window
        const peak = wi === 0 ? pick([toMin("10:01"), toMin("10:06"), toMin("10:16"), toMin("10:31"), toMin("10:38")]) : pick([toMin("14:05"), toMin("14:30"), toMin("14:45"), toMin("14:58")]);
        const t = chance(0.5) ? clamp(peak + gauss() * 2, win[0], win[1]) : uni(win[0], win[1]);
        at(Math.max(t, t0 + 1), () => react(p, wi));
      }
    });
    // takeaways for each block, inside the window
    for (const b of DAY.blocks) {
      if (!chance(0.88)) continue;
      const lo = toMin(b.e) - 3.5, hi = b.n === 3 ? toMin("14:20") : toMin(b.end) + 15;
      at(uni(lo, hi), () => takeaway(p, b.n));
    }
    // card on the board
    if (cardIds.has(p.i)) {
      const r = rnd();
      const t = r < 0.55 ? t0 + uni(1.5, 25) : r < 0.85 ? uni(toMin("10:41"), toMin("10:58")) : uni(toMin("14:00"), toMin("14:20"));
      at(t, () => makeCard(p));
    }
    if (photoIds.has(p.i)) at(uni(toMin("10:00"), toMin("14:50")), () => phonePhoto(p));
    // feedback after the close
    if (chance(0.7)) at(uni(toMin(DAY.close) + 0.4, toMin(DAY.close) + 4), () => feedback(p));
  }
  // guests
  guests.forEach((g, k) => {
    const t0 = uni(toMin("09:40"), toMin("10:30"));
    at(t0, () => signInGuest(g));
    at(t0 + 0.7, () => openMe(g));
    if (k % 2 === 0) at(t0 + 3, () => makeCard(g));
    const b = DAY.blocks[k % DAY.blocks.length];
    at(uni(toMin(b.e) - 3, toMin(b.e) + 5), () => takeaway(g, b.n));
    at(uni(toMin("10:41"), toMin("10:55")), () => changeStar(g, 1));
  });
  // connections: a few before lunch, many at lunch
  for (let k = 0; k < Math.round(N * 0.4); k++) at(uni(toMin("11:05"), toMin("13:55")), () => meetSomeone(pick(people)));
  for (let k = 0; k < Math.round(N * 2.2); k++) at(Math.sqrt(rnd()) * (toMin("14:55") - toMin("14:00")) + toMin("14:00"), () => meetSomeone(pick(people)));
  for (let k = 0; k < Math.max(2, Math.round(N * 0.03)); k++) at(uni(toMin("11:10"), toMin("14:30")), () => wrongMeet(pick(people)));
  // team photos
  for (let k = 0; k < Math.max(3, Math.round(N * 0.08)); k++) at(uni(toMin("10:00"), toMin("14:50")), teamPhoto);
  // team rounds every 3 simulated minutes, and the group photo at lunch
  for (let t = FROM + 2; t < UNTIL; t += 3) at(t, teamRound);
  at(toMin("14:30"), () => op({ action: "groupPhoto", secs: 20 }));
  at(toMin("14:56"), () => op({ action: "groupPhoto", secs: null }));
  // exports once the day is over
  at(toMin(DAY.close) + 4.2, async () => { for (const w of ["takeaways", "ratings", "polls", "board", "links", "feedback", "signins"]) await call("GET", `/api/export/${w}`, { pin: true, text: true }); });
}

/* ---------- the wall bot: what a real wall asks for, at its real cadence ---------- */
let wallStop = false;
async function wallBot() {
  let snapV = null, lastBeat = 0, lastRx = 0, lastSnap = null;
  while (!wallStop) {
    const r = await call("GET", "/api/state");
    if (r.ok) {
      S = r.data;
      maxDrift = Math.max(maxDrift, Math.abs(serverMin(S.t) - Math.floor(simNow)));
      if (S.snapV !== snapV) { snapV = S.snapV; const sn = await call("GET", `/api/snap?v=${encodeURIComponent(snapV)}`); if (sn.ok) lastSnap = sn.data; }
    }
    if (performance.now() - lastBeat > 60000) { lastBeat = performance.now(); await call("POST", "/api/beat", { json: { w: 3840, h: 1920, dpr: 1, layout: "wall", mode: S ? S.cfg.mode : "auto", scenes: 5, lite: false, fps: 60, err: "", at: Date.now() } }); }
    // rx polling every 2 seconds while reactions are on: one extra poll between state polls
    if (S && S.rx && S.rx.on && performance.now() - lastRx > 1800) { lastRx = performance.now(); await call("GET", "/api/rx"); }
    await sleep(3000);
  }
}

/* ---------- running the day ---------- */
async function setRehearsal(m) { return op({ action: "rehearsal", hhmm: fmt(m) }); }

async function runDay() {
  console.log(`Simulator. Base ${BASE}. ${PEOPLE} people, ${fmt(FROM)} to ${fmt(UNTIL)} at speed ${SPEED}. Seed ${SEED}. Test data only.`);
  const st0 = await call("GET", "/api/state");
  if (!st0.ok) { console.error("The server does not answer /api/state. Is it running?"); process.exit(1); }
  if (A["wipe-first"]) { const w = await op({ action: "wipe", phrase: "RESET MD26" }); if (!w.ok) { console.error("Wipe failed: " + (w.data && w.data.error)); process.exit(1); } console.log("Wiped the data first."); }
  else if (st0.data.n.answers || st0.data.n.board || st0.data.n.here) console.log(`Note: the server already holds data (${st0.data.n.answers} answers, ${st0.data.n.board} cards, ${st0.data.n.here} here). Add --wipe-first for a clean day.`);
  // Team preparation: polls and reactions follow the clock, then the people list.
  await op({ action: "pollManual", on: false }); await op({ action: "rx", mode: "auto" });
  const g = await opGet(); polls = g.ok ? g.data.polls : [];
  people = makePeople(PEOPLE);
  guests = GUESTS.slice(0, Math.max(2, Math.min(GUESTS.length, Math.round(PEOPLE * 0.04)))).map((name, k) => ({ i: -k - 1, name, first: name.split(" ")[0], last4: "", company: "Guest Co", title: "Guest", dev: `sim${RUN}g${String(k).padStart(3, "0")}`, kind: "guest", signed: false, pub: null, hello: chance(0.5), stars: {}, card: false, code: null, lastRx: 0, rxN: 0, arrive: 0, wrongFirst: 0, present: false }));
  // --demo adds three fixed test people that the simulator does not play, so a person can sign in as one of them
  // on a real phone: Demo Tester One 1111, Demo Tester Two 2222, Demo Tester Three 3333.
  const demo = A.demo ? [["Demo Tester One", "1111"], ["Demo Tester Two", "2222"], ["Demo Tester Three", "3333"]].map(([name, last4], k) => ({ name, last4, company: "Test Company", title: "Tester", topics: [TOPICS[k % TOPICS.length]], advisorPref: "", photoOk: true })) : [];
  const imp = await op({ action: "peopleImport", people: people.map(p => ({ name: p.name, last4: p.last4, company: p.company, title: p.title, topics: p.topics, advisorPref: p.advisorPref, photoOk: p.photoOk })).concat(demo) });
  if (!imp.ok) { console.error("People import failed: " + (imp.data && imp.data.error)); process.exit(1); }
  console.log(`Imported ${imp.data.count} sample people (${(imp.data.skipped || []).length} skipped).`);
  const rh = await setRehearsal(FROM);
  if (!rh.ok) { console.error("Could not start the rehearsal: " + (rh.data && rh.data.error)); process.exit(1); }
  planDay();
  eventsList.sort((a, b) => a.t - b.t);
  // events before the start, or at the exact start, wait for it
  const wall = wallBot();
  const t0 = performance.now(), running = new Set();
  let curMin = -1, nextReport = Math.ceil(FROM / 5) * 5, idx = 0, lastCount = 0;
  const total = () => [...stats.values()].reduce((a, s) => a + s.n, 0);
  const bad = () => [...stats.values()].reduce((a, s) => a + s.bad, 0);
  const dispatch = ev => { const pr = Promise.resolve().then(ev.fn).catch(e => { unexpected.push({ label: "script", status: 0, msg: String(e && e.stack || e).split("\n").slice(0, 3).join(" | ") }); }).finally(() => running.delete(pr)); running.add(pr); };
  while (true) {
    simNow = FROM + ((performance.now() - t0) / 60000) * SPEED;
    if (simNow >= UNTIL) break;
    if (Math.floor(simNow) !== curMin) { curMin = Math.floor(simNow); await setRehearsal(curMin); }
    while (idx < eventsList.length && eventsList[idx].t <= simNow) { const ev = eventsList[idx++]; if (ev.t < UNTIL) dispatch(ev); }
    for (let k = dyn.length - 1; k >= 0; k--) if (dyn[k].t <= simNow) dispatch(dyn.splice(k, 1)[0]);
    if (simNow >= nextReport) {
      const n = S ? S.n : {};
      const tot = total();
      console.log(`[${fmt(nextReport)}] req ${String(tot).padStart(6)} (+${String(tot - lastCount).padStart(4)})  failed ${bad()}  here ${n.here ?? "-"}  cards ${n.board ?? "-"}  links ${n.links ?? "-"}  photos ${n.photos ?? "-"}  takeaways ${n.takeaways ?? "-"}  answers ${n.answers ?? "-"}  reactions ${S && S.rx ? S.rx.total : "-"}  in flight ${running.size}`);
      lastCount = tot; nextReport += 5;
    }
    await sleep(60);
  }
  simNow = UNTIL;
  const drainStart = Date.now();
  while (running.size && Date.now() - drainStart < 60000) await Promise.race([...running, sleep(500)]);
  wallStop = true; await wall;
  const fin = await call("GET", "/api/state"); if (fin.ok) S = fin.data;
  const opf = await opGet();
  await op({ action: "rehearsal", hhmm: null });
  console.log("Rehearsal stopped.");
  return { fin: S, opd: opf.ok ? opf.data : null, realSecs: (performance.now() - t0) / 1000 };
}

/* ---------- the report ---------- */
function table() {
  const rows = [...stats.entries()].sort((a, b) => b[1].n - a[1].n);
  const w = Math.max(...rows.map(r => r[0].length), 5);
  const line = (a, b, c, d, e, f) => `${a.padEnd(w)}  ${String(b).padStart(7)}  ${String(c).padStart(6)}  ${String(d).padStart(8)}  ${String(e).padStart(6)}  ${String(f).padStart(6)}`;
  console.log("\n" + line("Route", "Count", "Failed", "Expected", "p50 ms", "p95 ms"));
  console.log("-".repeat(w + 45));
  let n = 0, f = 0, e = 0;
  for (const [lab, s] of rows) { n += s.n; f += s.bad; e += s.expected; console.log(line(lab, s.n, s.bad, s.expected, Math.round(pct(s.ms, .5)), Math.round(pct(s.ms, .95)))); }
  console.log("-".repeat(w + 45));
  console.log(line("Total", n, f, e, "", ""));
  return { n, f, e };
}
const cnt = (...labs) => labs.reduce((a, l) => a + ((stats.get(l) || {}).n || 0), 0);

// Projected function calls for a real day (docs/PLAN.md section 5.12 rule 7).
// People actions come from this run, scaled to 100 people. Polling is modeled from the cadences in the plan,
// because the simulator does not run 100 phones polling in real time. The assumptions are printed.
function projection(opd) {
  const scale = 100 / PEOPLE;
  const phoneActive = +(A["phone-active-min"] ?? 45), share6 = 0.25, remotes = 3, remoteVisible = 0.3;
  const dayMin = toMin(DAY.close) + 5 - toMin("09:25");
  const rxMin = DAY.reactionWindows.reduce((a, w) => a + toMin(w.to) - toMin(w.from), 0);
  const peopleLabs = ["GET /api/who", "POST /api/claim", "POST /api/guest", "GET /api/me", "POST /api/star", "POST /api/react", "POST /api/answer", "POST /api/profile", "POST /api/meet", "POST /api/takeaway", "POST /api/feedback", "POST /api/photo"];
  const people = Math.round(cnt(...peopleLabs) * scale);
  const teamOps = Math.round(cnt("POST /api/op") * scale) + cnt("GET /api/export/:what");
  const cadence = 1 / ((1 - share6) / 15 + share6 / 6);       // seconds between polls, averaged
  const perPhone = Math.round(phoneActive * 60 / cadence);
  const phonePolls = perPhone * 100;
  const wallState = Math.round(dayMin * 60 / 3), wallRx = Math.round(rxMin * 60 / 2), wallSheet = Math.round(dayMin), wallBeat = Math.round(dayMin);
  const remotePolls = Math.round(dayMin * 60 / 8 * remotes * remoteVisible);
  const versions = Math.round((info.cards || 0) * scale + (info.takeaways || 0) * scale * 0.7 + (info.links || 0) * scale + ((info.phonePhotos || 0) + (info.teamPhotos || 0)) * scale);
  const snapNo = 100 * Math.min(versions, Math.round(perPhone / 2)) + versions, snapYes = versions + 100;
  const stateNo = phonePolls + wallState;
  // With a shared cache of 2 seconds (1 second while reactions are on), the origin answers at most once per period.
  const stateYes = Math.min(stateNo, Math.round((dayMin - rxMin) * 60 / 2 + rxMin * 60 / 1));
  const rxYes = Math.min(wallRx, rxMin * 60);
  const fixed = people + teamOps + wallSheet + wallBeat + remotePolls;
  const noCache = fixed + stateNo + wallRx + snapNo, withCache = fixed + stateYes + rxYes + snapYes;
  const row = (a, b) => console.log(`  ${a.padEnd(58)} ${String(b).padStart(8)}`);
  console.log("\nProjected function calls for a real day (100 people)");
  console.log(`  Assumptions: each phone polls state while active for ${phoneActive} minutes (${Math.round((1 - share6) * 100)}% at 15 s, ${Math.round(share6 * 100)}% at 6 s, about ${cadence.toFixed(1)} s on average);`);
  console.log(`  wall state every 3 s, rx every 2 s while on, sheet and beat every 60 s, ${remotes} remotes polling every 8 s while visible ${Math.round(remoteVisible * 100)}% of the day.`);
  row("People actions (sign in, picks, answers, reactions, ...)", people);
  row("Team actions and exports", teamOps);
  row("Remote polling", remotePolls);
  row("Wall sheet and beat", wallSheet + wallBeat);
  row(`Snap fetches (${versions} versions): no cache / cache`, `${snapNo} / ${snapYes}`);
  row(`Phone state polls (${perPhone} per phone)`, phonePolls);
  row("Wall state polls", wallState);
  row("Wall rx polls", wallRx);
  row("State polls reaching functions with a 2 s shared cache", stateYes);
  console.log("");
  row("TOTAL, no shared cache", noCache);
  row("TOTAL, shared cache at 2 s (1 s while reactions are on)", withCache);
  row("Budget for the event day (docs/PLAN.md 5.12)", 60000);
  console.log(`  Verdict: ${noCache < 60000 ? "under" : "OVER"} budget without a cache, ${withCache < 60000 ? "under" : "OVER"} budget with one.`);
  return { noCache, withCache };
}

async function reportDay(r) {
  const { f } = table();
  const n = r.fin ? r.fin.n : {};
  console.log(`\nSimulated ${fmt(FROM)} to ${fmt(UNTIL)} in ${r.realSecs.toFixed(0)} real seconds. Largest gap between the simulated minute and the server clock: ${maxDrift.toFixed(2)} minutes.`);
  console.log(`Sent by people: ${info.signed || 0} sign ins, ${info.guests || 0} guests, ${info.wrongCodes || 0} wrong last 4 on purpose, ${info.answers || 0} poll answers, ${info.reactions || 0} reactions, ${info.cards || 0} cards, ${info.links || 0} new connections, ${info.wrongMeet || 0} wrong meet codes on purpose, ${(info.phonePhotos || 0)} phone photos, ${info.teamPhotos || 0} team photos, ${info.takeaways || 0} takeaways, ${info.feedback || 0} feedback forms.`);
  console.log(`Server now: here ${n.here}, cards ${n.board}, connections ${n.links}, photos ${n.photos}, takeaways ${n.takeaways}, answers ${n.answers}, reactions ${r.fin && r.fin.rx ? r.fin.rx.total : "-"}.`);
  if (r.opd) console.log(`People: ${r.opd.people.count} imported, ${r.opd.people.signedIn} signed in, ${r.opd.people.guests} guests, ${r.opd.people.locked.length} locked. Waiting: ${r.opd.pending.photos.length} photos, ${r.opd.pending.profiles.length} cards, ${r.opd.pending.takeaways.length} takeaways.`);
  projection(r.opd);
  if (unexpected.length) {
    console.log(`\n${unexpected.length} unexpected failures. First ones:`);
    const seen = new Map(); for (const u of unexpected) { const k = `${u.label} ${u.status} ${u.msg}`; seen.set(k, (seen.get(k) || 0) + 1); }
    for (const [k, v] of [...seen].slice(0, 15)) console.log(`  ${v} x ${k}`);
  } else console.log("\nNo unexpected failures.");
  return unexpected.length === 0 && f === 0;
}

/* ---------- load mode ---------- */
async function runLoad() {
  const T = +(A.seconds ?? 120), C = parseInt(A.clients ?? "120", 10);
  console.log(`Load test. Base ${BASE}. ${C} clients for ${T} seconds. Test data only.`);
  const st0 = await call("GET", "/api/state"); if (!st0.ok) { console.error("The server does not answer /api/state."); process.exit(1); }
  await op({ action: "pollManual", on: false }); await op({ action: "rx", mode: "auto" });
  const g = await opGet(); const plist = g.ok ? g.data.polls : [];
  const r0 = await op({ action: "rehearsal", hhmm: "10:15" }); if (!r0.ok) { console.error("Could not start the rehearsal: " + (r0.data && r0.data.error)); process.exit(1); }
  const clients = Array.from({ length: C }, (_, i) => ({ dev: `load${RUN}${String(i).padStart(4, "0")}`, every: i % 3 === 0 ? 6000 : 15000, rxN: 0, lastRx: 0 }));
  const t0 = performance.now(), end = t0 + T * 1000;
  const el = () => performance.now() - t0;
  let cur = null, curSnap = null;
  const state = async () => { const r = await call("GET", "/api/state"); if (r.ok) cur = r.data; return r; };
  await state();
  const rxFrom = 0.25 * T * 1000, rxTo = rxFrom + Math.min(20000, 0.3 * T * 1000);
  const ansFrom = 0.6 * T * 1000, ansTo = ansFrom + Math.min(10000, 0.15 * T * 1000);
  const jobs = [];
  for (const c of clients) {
    jobs.push((async () => {
      await sleep(rnd() * Math.min(c.every, T * 500)); // phones open the page at different moments
      await call("GET", "/api/me", { dev: c.dev });
      let snapV = null, answered = false;
      while (performance.now() < end) {
        const r = await state();
        if (r.ok && r.data.snapV !== snapV) { snapV = r.data.snapV; const sn = await call("GET", `/api/snap?v=${encodeURIComponent(snapV)}`); if (sn.ok) curSnap = sn.data; }
        const next = performance.now() + c.every * (0.85 + rnd() * 0.3);
        // while polling, take part in the bursts
        while (performance.now() < next && performance.now() < end) {
          const now = el();
          if (now >= rxFrom && now < rxTo && cur && cur.rx && cur.rx.on && performance.now() - c.lastRx > 3300 && c.rxN < 150) {
            const rr = await call("POST", "/api/react", { dev: c.dev, json: { c: { clap: rint(0, 10), heart: rint(1, 6), bloom: rint(0, 3) } } });
            c.lastRx = performance.now();
            if (rr.ok) c.rxN++;
          }
          if (!answered && now >= ansFrom + rnd() * (ansTo - ansFrom) && cur && cur.poll && cur.poll.open) {
            answered = true;
            const poll = plist.find(x => x.id === cur.poll.id) || cur.poll;
            await call("POST", "/api/answer", { dev: c.dev, json: { pid: poll.id, text: poll.type === "choice" ? pick(poll.options) : pick(WORDS[poll.id] || WORDS.p1) } });
          }
          await sleep(200 + rnd() * 300);
        }
      }
    })());
  }
  // the wall: state every 3 s, rx every 2 s while on, beat every 60 s. Three remotes: op every 8 s.
  jobs.push((async () => { let lastB = 0; while (performance.now() < end) { await state(); if (performance.now() - lastB > 60000) { lastB = performance.now(); await call("POST", "/api/beat", { json: { w: 3840, h: 1920, dpr: 1, layout: "wall", mode: "auto", scenes: 5, lite: false, fps: 60, err: "", at: Date.now() } }); } await sleep(3000); } })());
  jobs.push((async () => { while (performance.now() < end) { if (cur && cur.rx && cur.rx.on) await call("GET", "/api/rx"); await sleep(2000); } })());
  for (let k = 0; k < 3; k++) jobs.push((async () => { await sleep(k * 2500); while (performance.now() < end) { await opGet(); await sleep(8000); } })());
  // progress
  const prog = setInterval(() => console.log(`[${Math.round(el() / 1000)} s] requests ${[...stats.values()].reduce((a, s) => a + s.n, 0)}  failed ${[...stats.values()].reduce((a, s) => a + s.bad, 0)}`), 10000);
  await Promise.all(jobs); clearInterval(prog);
  await op({ action: "rehearsal", hhmm: null });
  console.log("Rehearsal stopped.");
  const rows = [...stats.entries()].sort((a, b) => b[1].n - a[1].n);
  const w = Math.max(...rows.map(r => r[0].length), 5);
  const line = (a, b, c, d, e, f, h) => `${a.padEnd(w)}  ${String(b).padStart(6)}  ${String(c).padStart(7)}  ${String(d).padStart(7)}  ${String(e).padStart(6)}  ${String(f).padStart(5)}  ${String(h).padStart(10)}`;
  console.log("\n" + line("Route", "Count", "p50 ms", "p95 ms", "Errors", "5xx", "Cache hit"));
  console.log("-".repeat(w + 53));
  for (const [lab, s] of rows) console.log(line(lab, s.n, Math.round(pct(s.ms, .5)), Math.round(pct(s.ms, .95)), s.bad, s.s5, s.cacheHdr ? `${Math.round(100 * s.hit / s.cacheHdr)}%` : "no header"));
  const st = stats.get("GET /api/state") || { ms: [], s5: 0 };
  const total5 = [...stats.values()].reduce((a, s) => a + s.s5, 0), errors = [...stats.values()].reduce((a, s) => a + s.bad, 0);
  const p95 = pct(st.ms, .95);
  console.log(`\nState p95 ${Math.round(p95)} ms (budget 400 ms): ${p95 < 400 ? "pass" : "FAIL"}. Server errors (5xx): ${total5}: ${total5 === 0 ? "pass" : "FAIL"}. Other errors: ${errors}.`);
  if (unexpected.length) { const seen = new Map(); for (const u of unexpected) { const k = `${u.label} ${u.status} ${u.msg}`; seen.set(k, (seen.get(k) || 0) + 1); } for (const [k, v] of [...seen].slice(0, 10)) console.log(`  ${v} x ${k}`); }
  return p95 < 400 && total5 === 0 && errors === 0;
}

/* ---------- main ---------- */
process.on("SIGINT", async () => { console.log("\nStopping. Ending the rehearsal."); try { await op({ action: "rehearsal", hhmm: null }); } catch {} process.exit(130); });
const ok = A.load ? await runLoad() : await reportDay(await runDay());
process.exit(ok ? 0 : 1);
