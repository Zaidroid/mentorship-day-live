// People, sign in, stars and the GET /api/me answer (docs/PLAN.md sections 5.3, 5.4 and 5.11).
// The people list lives in the private blob "people". It never leaves the server: search answers names
// and public ids only, and no answer to a phone carries k4, a last 4 digits value, or a bare person id.
import crypto from "node:crypto";
import { DAY, toMin, fmtMin } from "./day.mjs";
import { clean, firstWord, cleanLinkedin, readSnap, withLock, TOPIC_TAGS } from "./store.mjs";
import { personId, personPub, k4Of, normName } from "./ids.mjs";

export const PEOPLE_MAX = 800;
export const BLOCKS = DAY.blocks.map(b => b.n);
export const SESSIONS = Object.fromEntries(DAY.sessions.map(x => [x.id, x]));

export async function readPeople(s) { const v = await s.get("people", { type: "json" }); return Array.isArray(v) ? v : []; }
export const personOf = (people, pid) => (pid && people.find(p => p.id === pid)) || null;

/* ---------- import ---------- */

// Assigned rooms from the import: { "1": "1A" }. A value may be a session id ("1A") or a room ("Room A", "A").
function roomsOf(v) {
  const out = {};
  if (!v || typeof v !== "object") return out;
  for (const b of BLOCKS) {
    const raw = clean(v[b] ?? v[String(b)], 20).toLowerCase();
    if (!raw) continue;
    const s = DAY.sessions.find(x => x.b === b && (x.id.toLowerCase() === raw || x.room.toLowerCase() === raw || x.room.toLowerCase() === "room " + raw));
    if (s) out[b] = s.id;
  }
  return out;
}
// A one to one slot: { who, s } checked against MD_DAY.ones (15 minute slots), or free text kept as { text }.
function slotOf(v) {
  if (v && typeof v === "object" && typeof v.who === "string" && typeof v.s === "string" && /^\d\d:\d\d$/.test(v.s)) {
    const one = DAY.ones.find(o => o.who === v.who && toMin(v.s) >= toMin(o.s) && toMin(v.s) + 15 <= toMin(o.e));
    return one ? { who: one.who, s: v.s, e: fmtMin(toMin(v.s) + 15), room: one.room } : null;
  }
  const text = typeof v === "string" ? clean(v, 80) : "";
  return text ? { text } : null;
}
// One import row to a person record, or { why } when it is skipped. The why never repeats the row.
export function personFrom(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return { why: "not a row" };
  const name = clean(row.name, 80);
  if (normName(name).replace(/ /g, "").length < 2) return { why: "no name" };
  const last4 = String(row.last4 ?? "").trim();
  if (!/^\d{4}$/.test(last4)) return { why: "no last 4 digits" };
  const id = personId(name, last4);
  const topics = Array.isArray(row.topics) ? [...new Set(row.topics.filter(t => typeof t === "string" && Object.hasOwn(DAY.topicMap, t)))] : [];
  const li = cleanLinkedin(row.linkedin);
  return {
    person: {
      id, name, first: firstWord(name), company: clean(row.company, 80), title: clean(row.title, 80),
      linkedin: li.ok ? li.value : "", topics, advisorPref: ["remote", "local"].includes(row.advisorPref) ? row.advisorPref : "",
      photoOk: typeof row.photoOk === "boolean" ? row.photoOk : null, k4: k4Of(id, last4), rooms: roomsOf(row.rooms), slot: slotOf(row.slot)
    }
  };
}
// True when last4 is the person's number. Constant time.
export function last4Ok(person, last4) {
  const a = Buffer.from(k4Of(person.id, last4)), b = Buffer.from(String(person.k4 || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- search ---------- */

// Names whose words start with the query, from any word on (so "layla kh" finds "Layla Khoury").
// Case, accents and Arabic letter variants are ignored. Returns null when the query has under 3 letters.
export function search(people, q) {
  const nq = normName(q);
  if (nq.replace(/ /g, "").length < 3) return null;
  const hits = [];
  for (const p of people) {
    const words = normName(p.name).split(" ");
    const at = words.findIndex((_, i) => words.slice(i).join(" ").startsWith(nq));
    if (at >= 0) hits.push({ p, at });
  }
  hits.sort((x, y) => x.at - y.at || x.p.name.localeCompare(y.p.name));
  return hits.slice(0, 5).map(h => ({ id: personPub(h.p.id), name: h.p.name }));
}

/* ---------- stars ---------- */
// star/<block>/<pub>/<sid>~<by>, by is own (chosen), auto (picked for the person) or team (assigned in the import).

const STAR_RE = /^star\/(\d+)\/([pg][a-f0-9]{10})\/([0-9A-Z]{2,4})~(own|auto|team)$/;
export function parseStar(key) {
  const m = STAR_RE.exec(key);
  if (!m || !SESSIONS[m[3]] || SESSIONS[m[3]].b !== +m[1]) return null;
  return { b: +m[1], pub: m[2], sid: m[3], by: m[4] };
}
const RANK = { team: 0, own: 1, auto: 2 };
const best = list => list.sort((x, y) => RANK[x.by] - RANK[y.by] || x.sid.localeCompare(y.sid))[0] || null;
// The stored stars of one person: { 1: { sid, by } }. Three small lists in parallel.
export async function readStars(s, pub) {
  const lists = await Promise.all(BLOCKS.map(b => s.list({ prefix: `star/${b}/${pub}/` })));
  const out = {};
  lists.forEach((l, i) => { const x = best(l.blobs.map(k => parseStar(k.key)).filter(Boolean)); if (x) out[BLOCKS[i]] = { sid: x.sid, by: x.by }; });
  return out;
}
// "Planning to join" per session, from one listing of star/. Each person counts once per block.
export function interestFrom(blobs) {
  const per = new Map();
  for (const k of blobs) { const x = parseStar(k.key); if (x) { const id = x.b + "/" + x.pub, cur = per.get(id); if (!cur || RANK[x.by] < RANK[cur.by]) per.set(id, x); } }
  const out = {};
  for (const x of per.values()) out[x.sid] = (out[x.sid] || 0) + 1;
  return out;
}
// Sets the one star of a person in a block (sid null removes it). Replaces whatever was there.
export function writeStar(s, b, pub, sid, by) {
  return withLock(`star:${pub}:${b}`, async () => {
    const pre = `star/${b}/${pub}/`, want = sid ? `${pre}${sid}~${by}` : null;
    const { blobs } = await s.list({ prefix: pre });
    await Promise.all(blobs.filter(k => k.key !== want).map(k => s.delete(k.key)));
    if (want && !blobs.some(k => k.key === want)) await s.set(want, "");
  });
}
// Team seats from the import always win. Called on every sign in of a person and after an import.
export async function syncTeam(s, person) {
  const pub = personPub(person.id), rooms = person.rooms || {};
  const cur = await readStars(s, pub);
  await Promise.all(BLOCKS.map(b => {
    if (rooms[b]) return cur[b] && cur[b].by === "team" && cur[b].sid === rooms[b] ? null : writeStar(s, b, pub, rooms[b], "team");
    return cur[b] && cur[b].by === "team" ? writeStar(s, b, pub, null) : null;
  }));
}
// The registration topic behind an automatic pick, or null when the pick came from the advisor preference only.
export const whyOf = (person, sid) => (person && (person.topics || []).find(t => (DAY.topicMap[t] || []).includes(sid))) || null;
// Stars as the phone sees them: { 1: { sid, by, why } }. A team seat from the import always wins.
export function starsOf(person, stored) {
  const rooms = (person && person.rooms) || {}, out = {};
  for (const b of BLOCKS) {
    if (rooms[b]) out[b] = { sid: rooms[b], by: "team", why: null };
    else if (stored[b] && stored[b].by !== "team") out[b] = { sid: stored[b].sid, by: stored[b].by, why: stored[b].by === "auto" ? whyOf(person, stored[b].sid) : null };
  }
  return out;
}

/* ---------- Picked for You (docs/PLAN.md section 5.11) ---------- */

// 3 points for each of the person's topics that maps to the session in MD_DAY.topicMap,
// plus 1 when the delivery fits the advisor preference (remote with Online, local with In person).
export function pickScore(person, x) {
  const topics = (person.topics || []).filter(t => (DAY.topicMap[t] || []).includes(x.id)).length;
  const fit = (person.advisorPref === "remote" && x.mode === "Online") || (person.advisorPref === "local" && x.mode === "In person");
  return 3 * topics + (fit ? 1 : 0);
}
// One pick per block: the highest score above zero; ties go to fewer people planning to join, then room order;
// a session as full as its seats is skipped. Blocks with a team seat or a star already get nothing.
// counts is "planning to join" per session now. Returns { block: sid }.
export function pickFor(person, counts, have = {}) {
  const out = {};
  for (const b of BLOCKS) {
    if ((person.rooms || {})[b] || have[b]) continue;
    const ranked = DAY.sessions.filter(x => x.b === b)
      .map(x => ({ x, score: pickScore(person, x), n: counts[x.id] || 0, room: DAY.rooms.indexOf(x.room) }))
      .filter(c => c.score > 0)
      .sort((c, d) => d.score - c.score || c.n - d.n || c.room - d.room);
    const pick = ranked.find(c => !(c.x.seats > 0) || c.n < c.x.seats);
    if (pick) out[b] = pick.x.id;
  }
  return out;
}
// Writes the picks of a person's first sign in as auto stars. Never touches a block that has a star.
export async function makePicks(s, person) {
  const pub = personPub(person.id);
  const [all, have] = await Promise.all([s.list({ prefix: "star/" }), readStars(s, pub)]);
  const picks = pickFor(person, interestFrom(all.blobs), have);
  await Promise.all(Object.entries(picks).map(([b, sid]) => writeStar(s, +b, pub, sid, "auto")));
  return picks;
}

/* ---------- the answer of GET /api/me (also returned by claim and guest) ---------- */

export function meOf(w, person) {
  const p = person || {};
  const name = person ? person.name : w.name;
  return {
    pub: w.pub, name: name || "", first: name ? firstWord(name) : "",
    company: p.company || "", title: p.title || "", linkedin: p.linkedin || "",
    suggest: [...new Set((p.topics || []).map(t => TOPIC_TAGS[t]).filter(Boolean))],
    rooms: { ...(p.rooms || {}) }, slot: p.slot || null, photoOk: person ? (p.photoOk ?? null) : null
  };
}
// Connections from the cx/ key names: cx/<a>~<b>~<at>, a sorts before b. One entry per pair, the first one.
const CX_RE = /^cx\/([pg][a-f0-9]{10})~([pg][a-f0-9]{10})~(\d+)$/;
export function pairsFrom(blobs) {
  const m = new Map();
  for (const k of blobs) { const x = CX_RE.exec(k.key); if (!x) continue; const id = x[1] + x[2], at = +x[3]; if (!m.has(id) || at < m.get(id)[2]) m.set(id, [x[1], x[2], at]); }
  return [...m.values()].sort((a, b) => a[2] - b[2]);
}
const TK_RE = /^tk\/([0-9A-Z]{2,4})\/([pg][a-f0-9]{10})$/;
export async function meBody(s, w, { people } = {}) {
  const pub = w.pub;
  const [ppl, stars, card, tks, fb, snap, cx] = await Promise.all([
    w.status === "person" ? (people || readPeople(s)) : null,
    readStars(s, pub),
    s.get(`pr/${pub}`, { type: "json" }),
    s.list({ prefix: "tk/" }),
    s.get(`fb/${pub}`, { type: "json" }),
    readSnap(s),
    s.list({ prefix: "cx/" })
  ]);
  const person = ppl ? personOf(ppl, w.pid) : null;
  const me = meOf(w, person);
  const st = starsOf(person, stars);
  const board = new Map(snap.profiles.map(p => [p.id, p]));
  const links = pairsFrom(cx.blobs).filter(([a, b]) => a === pub || b === pub).map(([a, b, at]) => ({ other: a === pub ? b : a, at }))
    .filter(x => board.has(x.other)).map(({ other, at }) => { const p = board.get(other); return { id: other, name: p.name, company: p.company, role: p.role, linkedin: p.linkedin, at }; });
  const mine = tks.blobs.map(k => TK_RE.exec(k.key)).filter(m => m && m[2] === pub);
  const takeaways = (await Promise.all(mine.map(async m => { const t = await s.get(m[0], { type: "json" }); return t ? { sid: m[1], rating: t.rating, text: t.text || "", showName: !!t.showName, status: t.status, at: t.at } : null; }))).filter(Boolean);
  const profile = card ? { status: card.status || "pending", name: card.name, company: card.company, role: card.role, looking: card.looking, offer: card.offer, linkedin: card.linkedin, at: card.at } : null;
  return {
    status: w.status, me, stars: st, profile,
    code: card && card.status === "approved" && card.code ? card.code : null,
    links, takeaways,
    feedback: fb ? { overall: fb.overall, recommend: fb.recommend ?? null, text: fb.text || "", at: fb.at } : null
  };
}
