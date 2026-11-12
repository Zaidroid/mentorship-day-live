// Shared storage and helpers for the Mentorship Day live system.
// One site wide Blobs store, strong consistency so the screen, phones and remote agree.
import { getStore } from "@netlify/blobs";
import { DAY } from "./day.mjs";
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
  ann: null,             // { text, at, secs }
  video: null,           // { id, at } ; id null means stop
  way: null,             // { registration, rooms, oneToOnes } arrow directions
  poll: { id: "p1", open: true },
  hidden: [],            // poll words hidden by the operator
  at: 0
};

const NOSTORE = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
export function J(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...NOSTORE, ...extra } });
}
export function CDN(seconds) {
  return {
    "cache-control": "public, max-age=0, must-revalidate",
    "netlify-cdn-cache-control": `public, durable, s-maxage=${seconds}, stale-while-revalidate=${seconds * 5}`
  };
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
export function mergeCfg(c) { return { ...structuredClone(DEFAULT_CFG), ...(c || {}) }; }
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
export async function readSnap(s) { return (await s.get("snap", { type: "json" })) || { photos: [], profiles: [] }; }

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

export async function tally(s, pid, hidden) {
  const { blobs } = await s.list({ prefix: `ans/${pid}/` });
  const counts = {}; let total = 0;
  for (const b of blobs) {
    const rest = b.key.slice(`ans/${pid}/`.length); const i = rest.indexOf("/");
    if (i < 0) continue;
    let w = ""; try { w = decodeURIComponent(rest.slice(i + 1)); } catch { continue; }
    if (!w) continue;
    total++;
    if ((hidden || []).includes(w)) continue;
    counts[w] = (counts[w] || 0) + 1;
  }
  return { total, words: Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 80) };
}

// Rebuild the public snapshot of approved photos and profiles. Called only by operator actions.
export async function rebuild(s) {
  const okPh = (await s.list({ prefix: "ok/ph/" })).blobs.map(b => b.key.slice(6));
  const photos = [];
  for (const id of okPh) {
    const m = await s.getMetadata(`ph/${id}`);
    if (m) photos.push({ id, name: m.metadata.name || "", caption: m.metadata.caption || "", at: m.metadata.at || 0 });
  }
  photos.sort((a, b) => b.at - a.at);
  // Profiles are keyed by public id. Anything else under ok/pr/ is ignored, so no device id can reach the snapshot.
  const okPr = (await s.list({ prefix: "ok/pr/" })).blobs.map(b => b.key.slice(6)).filter(pubOk);
  const profiles = [];
  for (const pub of okPr) {
    const p = await s.get(`pr/${pub}`, { type: "json" });
    if (p) profiles.push({ id: pub, name: p.name, company: p.company, role: p.role, looking: p.looking, offer: p.offer, linkedin: p.linkedin, at: p.at });
  }
  profiles.sort((a, b) => b.at - a.at);
  const snap = { photos: photos.slice(0, 80), profiles, at: Date.now() };
  await s.setJSON("snap", snap);
  return snap;
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

export function pinOk(req) {
  const want = (globalThis.Netlify && Netlify.env.get("REMOTE_PIN")) || "";
  const got = req.headers.get("x-pin") || "";
  return !!want && got === want;
}
export function whoOf(req) { let w = req.headers.get("x-who") || ""; try { w = decodeURIComponent(w); } catch {} return clean(w, 30) || "Someone"; }
