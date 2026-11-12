// Shared storage and helpers for the Mentorship Day live system.
// One site wide Blobs store, strong consistency so the screen, phones and remote agree.
import { getStore } from "@netlify/blobs";

export const st = () => getStore({ name: "md26", consistency: "strong" });

export const TAGS = ["Funding", "Clients", "Partnerships", "Hiring", "A New Job", "Mentoring", "Marketing", "Product", "AI and Tech", "Freelancing"];

export const VIDEOS = [
  { id: "tareq", title: "Tareq Azza", src: "/videos/tareq-azza.mp4" },
  { id: "kassim", title: "KassimLegal", src: "/videos/kassimlegal.mp4" }
];

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

export async function readCfg(s) { const c = await s.get("cfg", { type: "json" }); return { ...DEFAULT_CFG, ...(c || {}) }; }
export async function writeCfg(s, cfg) { cfg.at = Date.now(); await s.setJSON("cfg", cfg); return cfg; }
export async function readPolls(s) { return (await s.get("polls", { type: "json" })) || DEFAULT_POLLS; }
export async function readSnap(s) { return (await s.get("snap", { type: "json" })) || { photos: [], profiles: [] }; }

export const devOk = d => /^[a-z0-9]{8,40}$/i.test(d || "");
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
  const okPr = (await s.list({ prefix: "ok/pr/" })).blobs.map(b => b.key.slice(6));
  const profiles = [];
  for (const d of okPr) {
    const p = await s.get(`pr/${d}`, { type: "json" });
    if (p) profiles.push({ id: d, name: p.name, company: p.company, role: p.role, looking: p.looking, offer: p.offer, linkedin: p.linkedin, at: p.at });
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
