// Shared storage and helpers for the Mentorship Day live system.
// One site wide Blobs store, strong consistency so the screen, phones and remote agree.
import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { DAY, realNow } from "./day.mjs";
import { pubOk } from "./ids.mjs";
export { devOk } from "./ids.mjs";

export const st = () => getStore({ name: "md26", consistency: "strong" });

export const TAGS = ["Funding", "Clients", "Partnerships", "Hiring", "A New Job", "Mentoring", "Marketing", "Product", "AI and Tech", "Freelancing"];

export const VIDEOS = DAY.videos;

export const DEFAULT_POLLS = [
  { id: "p1", q: "In one word, what do you need most to grow?", type: "words" },
  { id: "p2", q: "What brought you here today?", type: "choice", options: ["Clients and Sales", "Funding", "Career Growth", "Learning", "Networking"] },
  { id: "p3", q: "In one word, how is your day going?", type: "words" },
  { id: "p4", q: "In one word, what will you do differently after today?", type: "words" }
];

export const DEFAULT_CFG = {
  mode: "auto",          // auto or welcome, opening, video, choose, live, lunch, close
  pin: null,             // scene id to hold on screen, or null to rotate
  speaker: null,         // opening speaker index, or null to follow the clock
  theme: "light",
  overlay: null,         // black, logo, check, or null
  ann: null,             // { text, at, secs }, at in the time base of state.t
  video: null,           // { id, at }, at in the time base of state.t; id null means stop
  way: null,             // { registration, rooms, oneToOnes } arrow directions
  poll: { id: "p1", open: true },
  hidden: [],            // poll words hidden by the operator. Never public
  reloadAt: 0,           // grows when the remote asks the wall to reload. A version, not a clock
  photoAt: null,         // group photo countdown (WP2)
  finale: null,          // lunch finale step (WP2)
  flags: {},             // feature switches that differ from FLAGS
  rehearsal: null,       // { shift, until, hhmm, at } while a rehearsal runs. Never public
  at: 0                  // moves forward on every write, so clients can tell the config changed
};

// Feature switches and their defaults (docs/PLAN.md section 5.9). The remote can only set names listed here.
export const FLAGS = { trustProfiles: true, trustTakeaways: true, trustPhotos: false };

// The part of the config that /api/state shows. Everything else (hidden words, the rehearsal) stays private.
export const PUBLIC_CFG = ["mode", "pin", "speaker", "theme", "overlay", "ann", "video", "way", "reloadAt", "photoAt", "finale", "flags", "at"];
export const publicCfg = cfg => Object.fromEntries(PUBLIC_CFG.map(k => [k, cfg[k] === undefined ? null : cfg[k]]));

const NOSTORE = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };
export function J(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...NOSTORE, ...extra } });
}
// Reads a JSON object body of at most max bytes. Returns { body } or { error } with a ready response.
export async function readBody(req, max, bad = "Send the request as JSON.") {
  const big = () => ({ error: J({ error: "That request is too large." }, 413) });
  if ((+req.headers.get("content-length") || 0) > max) return big();
  let buf; try { buf = await req.arrayBuffer(); } catch { return { error: J({ error: bad }, 400) }; }
  if (buf.byteLength > max) return big();
  let body; try { body = JSON.parse(new TextDecoder().decode(buf)); } catch { return { error: J({ error: bad }, 400) }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: J({ error: bad }, 400) };
  return { body };
}
// Every CDN cache header is made here, so the cache policy changes in one place (docs/PLAN.md section 5.12).
// Only answers that are the same for every anonymous client may use it.
//   seconds    how long the Netlify CDN keeps the answer
//   browser    how long a browser may keep it without asking (default 0: ask every time)
//   vary       a Netlify-Vary value, for example "query=v"
//   immutable  the answer never changes (approved photos)
//   policy     one of CDN_POLICIES, only for /api/cdn-probe. Everything else uses CDN_POLICY.
// Every answer also says x-md-cache: <policy><seconds>, so scripts/cdn-check.sh shows which policy answered.
//
// The candidates, in the order to try them on a deploy (version 1 used "a" and its durable layer said fwd=bypass):
//   a  Netlify-CDN-Cache-Control: public, durable, s-maxage=N, stale-while-revalidate=5N   (version 1)
//   b  as a, with max-age in place of s-maxage, as in the Netlify docs example
//   c  as b, and the browser header without must-revalidate
//   d  the form @netlify/cache writes: s-maxage=N,stale-while-revalidate=5N,durable (no public)
//   e  CDN-Cache-Control in place of Netlify-CDN-Cache-Control
// To try one on state and snap, change CDN_POLICY (and CDN_FLOOR for a longer time) and deploy.
export const CDN_POLICY = "a";
export const CDN_FLOOR = 0; // seconds; when above 0, no CDN time is shorter than this
const REVALIDATE = "public, max-age=0, must-revalidate";
export const CDN_POLICIES = {
  a: n => ({ "netlify-cdn-cache-control": `public, durable, s-maxage=${n}, stale-while-revalidate=${n * 5}` }),
  b: n => ({ "netlify-cdn-cache-control": `public, durable, max-age=${n}, stale-while-revalidate=${n * 5}` }),
  c: n => ({ "netlify-cdn-cache-control": `public, durable, max-age=${n}, stale-while-revalidate=${n * 5}`, browser: "public, max-age=0" }),
  d: n => ({ "netlify-cdn-cache-control": `s-maxage=${n},stale-while-revalidate=${n * 5},durable` }),
  e: n => ({ "cdn-cache-control": `public, durable, s-maxage=${n}, stale-while-revalidate=${n * 5}` })
};
export function CDN(seconds, { browser = 0, vary = "", immutable = false, policy = CDN_POLICY } = {}) {
  const name = Object.hasOwn(CDN_POLICIES, policy) ? policy : "a";
  let h;
  if (immutable) h = { "cache-control": `public, max-age=${seconds}, immutable`, "netlify-cdn-cache-control": `public, durable, max-age=${seconds}, immutable` };
  else {
    const n = Math.max(seconds, CDN_FLOOR);
    const { browser: plain = REVALIDATE, ...cdn } = CDN_POLICIES[name](n);
    h = { "cache-control": browser ? `public, max-age=${browser}` : plain, ...cdn };
  }
  if (vary) h["netlify-vary"] = vary;
  h["x-md-cache"] = immutable ? "immutable" : name + Math.max(seconds, CDN_FLOOR);
  return h;
}

// A refusal with an HTTP status and a plain sentence. update() passes it on and writes nothing.
export class Refuse extends Error { constructor(status, message) { super(message); this.status = status; } }

// Runs fn alone among callers in this process that use the same lock name.
const locks = new Map();
export async function withLock(name, fn) {
  const prev = locks.get(name) || Promise.resolve();
  let release; const done = new Promise(r => { release = r; });
  const tail = prev.then(() => done);
  locks.set(name, tail);
  await prev;
  try { return await fn(); }
  finally { release(); if (locks.get(name) === tail) locks.delete(name); }
}

// Changes a shared JSON blob (cfg, snap, polls, people) without losing a change made at the same time.
// Reads the value, applies fn, and writes only if nobody wrote in between (onlyIfMatch with the etag
// of what was read, onlyIfNew for a key that did not exist). Otherwise reads again, up to 6 tries.
// fn gets the current value, or a copy of init when the key is missing. It may change the value in
// place or return a new one, and may be async. A Refuse thrown by fn is passed on, nothing written.
// Callers in one process also queue on a lock per key. The local Blobs server checks the etag and
// writes in separate steps, so two writes can both pass; the lock keeps the self hosted server
// correct. On Netlify the etag check is atomic and covers separate function instances.
export function update(s, key, fn, { init = {} } = {}) {
  return withLock("blob:" + key, () => tryUpdate(s, key, fn, init));
}
let etagOnRead = true; // becomes false on a store that returns no etag with reads (the local server)
async function readTagged(s, key) {
  if (etagOnRead) {
    const r = await s.getWithMetadata(key, { type: "json" });
    if (r === null) return { data: null, etag: null };
    if (r.etag) return { data: r.data, etag: r.etag };
    etagOnRead = false;
  }
  // Take the etag from a listing first and read after it, so the etag is never newer than the data.
  const { blobs } = await s.list({ prefix: key });
  const b = blobs.find(x => x.key === key);
  if (!b) return { data: null, etag: null };
  return { data: await s.get(key, { type: "json" }), etag: b.etag };
}
async function tryUpdate(s, key, fn, init) {
  for (let i = 0; i < 6; i++) {
    const cur = await readTagged(s, key);
    const base = cur.data == null ? structuredClone(init) : cur.data;
    const out = await fn(base);
    const value = out === undefined ? base : out;
    const res = cur.etag ? await s.setJSON(key, value, { onlyIfMatch: cur.etag }) : await s.setJSON(key, value, { onlyIfNew: true });
    if (res.modified) return value;
    await new Promise(r => setTimeout(r, 10 + Math.random() * 30 * (i + 1)));
  }
  throw new Error(`Could not save ${key}: too many changes at once.`);
}

// The config with defaults filled in. A fresh copy each time, so nobody changes DEFAULT_CFG by accident.
export function mergeCfg(c) { const m = { ...structuredClone(DEFAULT_CFG), ...(c || {}) }; m.flags = { ...FLAGS, ...((c && c.flags) || {}) }; return m; }
export async function readCfg(s) { return mergeCfg(await s.get("cfg", { type: "json" })); }
// Changes the config through update(). fn changes the config in place. cfg.at always moves forward.
export function updateCfg(s, fn) {
  return update(s, "cfg", async c => {
    const cfg = mergeCfg(c); const out = await fn(cfg); const next = out === undefined ? cfg : out;
    next.at = Math.max(Date.now(), ((c && c.at) || 0) + 1); return next;
  });
}
export async function readPolls(s) { return (await s.get("polls", { type: "json" })) || structuredClone(DEFAULT_POLLS); }
export const updatePolls = (s, fn) => update(s, "polls", fn, { init: DEFAULT_POLLS });
// The public snapshot: approved photos, profiles and takeaways. Served by /api/snap, versioned by snapV.
const SNAP_PHOTOS = 300;
export function normSnap(v) { v = v || {}; return { at: v.at || 0, photos: v.photos || [], profiles: v.profiles || [], takeaways: v.takeaways || [] }; }
export async function readSnap(s) { return normSnap(await s.get("snap", { type: "json" })); }
// Changes the snapshot through update(). fn changes it in place. snap.at always moves forward.
export function updateSnap(s, fn) {
  return update(s, "snap", async v => {
    const snap = normSnap(v); await fn(snap);
    snap.photos = snap.photos.slice(0, SNAP_PHOTOS);
    snap.at = Math.max(Date.now(), ((v && v.at) || 0) + 1); return snap;
  });
}
// The version clients compare to know when to fetch the snapshot again. links is the number of connections.
export const snapVersion = (snap, links = 0) => `${snap.at || 0}.${links}`;
export const photoItem = (id, m) => ({ id, name: m.name || "", caption: m.caption || "", at: m.at || 0 });
export const profileItem = (pub, p) => ({ id: pub, name: p.name, company: p.company, role: p.role, looking: p.looking, offer: p.offer, linkedin: p.linkedin, at: p.at });
export function putItem(list, item) { dropItem(list, item.id); list.push(item); list.sort((a, b) => b.at - a.at); }
export function dropItem(list, id) { const i = list.findIndex(x => x.id === id); if (i >= 0) list.splice(i, 1); }

export const idOk = d => /^[a-z0-9]{6,40}$/i.test(d || "");
export function clean(v, n) { return String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n); }

// Small word filter for text that reaches the big screen without approval (poll words).
const BAD = ["fuck", "shit", "bitch", "cunt", "dick", "pussy", "asshole", "bastard", "slut", "whore", "nigger", "faggot", "porn", "sex", "kos", "kuss", "sharmout", "sharmoota", "manyak", "khara", "zeb", "zib", "kalb", "حمار", "كلب", "شرموط", "منيك", "خرا", "زب", "كس", "عرص", "قحبة", "سكس"];
export function isBad(t) {
  const s = String(t || "").toLowerCase();
  const words = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return BAD.some(b => words.includes(b) || (b.length > 4 && s.includes(b)));
}

export function normWord(t) {
  let s = String(t || "").replace(/[^\p{L}\p{N}\s'&]/gu, " ").replace(/\s+/g, " ").trim();
  if (!/[؀-ۿ]/.test(s)) s = s.toLowerCase();
  const parts = s.split(" ").filter(Boolean).slice(0, 3);
  return parts.join(" ").slice(0, 28);
}

export async function tally(s, pid, hidden) { return tallyFrom((await s.list({ prefix: `ans/${pid}/` })).blobs, pid, hidden); }
// The same from a listing that may hold other polls too.
export function tallyFrom(blobs, pid, hidden) {
  const pre = `ans/${pid}/`, counts = {}; let total = 0;
  for (const b of blobs) {
    if (!b.key.startsWith(pre)) continue;
    const rest = b.key.slice(pre.length); const i = rest.indexOf("/");
    if (i < 0) continue;
    let w = ""; try { w = decodeURIComponent(rest.slice(i + 1)); } catch { continue; }
    if (!w) continue;
    total++;
    if ((hidden || []).includes(w)) continue;
    counts[w] = (counts[w] || 0) + 1;
  }
  return { total, words: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 80) };
}

// Rebuilds the public snapshot from the approval markers. Used by Repair Lists and by wipe.
// Normal approvals change one item through updateSnap.
async function mapLimit(items, n, fn) { const out = []; for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn))); return out; }
export function rebuild(s) {
  return updateSnap(s, async snap => {
    const [okPh, okPr] = await Promise.all([s.list({ prefix: "ok/ph/" }), s.list({ prefix: "ok/pr/" })]);
    const photos = await mapLimit(okPh.blobs.map(b => b.key.slice(6)), 16, async id => { const m = await s.getMetadata(`ph/${id}`); return m ? photoItem(id, m.metadata) : null; });
    // Profiles are keyed by public id. Anything else under ok/pr/ is skipped, so no device id reaches the snapshot.
    const profiles = await mapLimit(okPr.blobs.map(b => b.key.slice(6)).filter(pubOk), 16, async pub => { const p = await s.get(`pr/${pub}`, { type: "json" }); return p ? profileItem(pub, p) : null; });
    snap.photos = photos.filter(Boolean).sort((x, y) => y.at - x.at);
    snap.profiles = profiles.filter(Boolean).sort((x, y) => y.at - x.at);
  });
}

// Wipe Test Data: deletes everything people and the remote made, keeps the people list, the polls
// and the This Way directions. The snapshot is rebuilt last. Returns how many keys were deleted.
const WIPE_PREFIXES = ["who/", "dv/", "here/", "hi/", "fail/", "star/", "rx/", "rxt/", "code/", "cx/", "tk/", "fb/", "pinfail/", "ans/", "ph/", "pr/", "q/", "ok/", "byd/", "log/"];
export async function wipeAll(s) {
  const lists = await Promise.all(WIPE_PREFIXES.map(prefix => s.list({ prefix })));
  const keys = lists.flatMap(l => l.blobs.map(b => b.key));
  await mapLimit(keys.concat(["beat", "snap"]), 20, k => s.delete(k));
  await updateCfg(s, c => ({ ...mergeCfg(null), way: c.way }));
  await rebuild(s);
  return keys.length;
}

// The last heartbeat of the wall, with its age in seconds.
export async function readBeat(s) {
  const b = await s.get("beat", { type: "json" });
  return b ? { ...b, age: Math.max(0, Math.round((realNow() - b.rt) / 1000)) } : null;
}

export async function log(s, who, what) {
  const k = `log/${String(Date.now()).padStart(14, "0")}~${encodeURIComponent(clean(who, 30) || "Someone")}~${encodeURIComponent(clean(what, 140))}`;
  await s.set(k, "");
}
export async function readLog(s, n = 40) {
  const { blobs } = await s.list({ prefix: "log/" });
  return blobs.map(b => b.key).sort().reverse().slice(0, n).map(k => {
    const [ts, who, what] = k.slice(4).split("~");
    let w = "", x = ""; try { w = decodeURIComponent(who); x = decodeURIComponent(what); } catch {}
    return { at: +ts, who: w, what: x };
  });
}

const sha = v => crypto.createHash("sha256").update(String(v)).digest();
export function pinOk(req) {
  const want = (globalThis.Netlify && Netlify.env.get("REMOTE_PIN")) || "";
  return !!want && crypto.timingSafeEqual(sha(req.headers.get("x-pin") || ""), sha(want));
}
// Wrong PINs are counted in 10 minute buckets (pinfail/<bucket>/<rand>), for the alert in WP2.
// At most 500 markers per bucket, so a flood cannot fill the store.
const PIN_BUCKET = 10 * 60 * 1000;
const pinPrefix = () => `pinfail/${Math.floor(realNow() / PIN_BUCKET)}/`;
export async function countPinFail(s) {
  const pre = pinPrefix(), { blobs } = await s.list({ prefix: pre });
  if (blobs.length < 500) await s.set(pre + Date.now().toString(36) + crypto.randomBytes(4).toString("hex"), "");
  return blobs.length + 1;
}
export async function pinFails(s) { return (await s.list({ prefix: pinPrefix() })).blobs.length; }
export function whoOf(req) { let w = req.headers.get("x-who") || ""; try { w = decodeURIComponent(w); } catch {} return clean(w, 30) || "Someone"; }
