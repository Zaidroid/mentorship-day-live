// GET /api/export/:what: CSV downloads for the team, with a UTF 8 byte order mark so Excel reads Arabic.
// Needs x-pin. Every export is logged with who made it. what is one of EXPORTS below.
// No export carries a device id, a number, or k4. Feedback has no names. Times are venue time.
import { st, pinOk, countPinFail, whoOf, log, J, readPolls, TAGS } from "../lib/store.mjs";
import { localDate, localMin, fmtMin } from "../lib/day.mjs";
import { pubOk } from "../lib/ids.mjs";
import { readPeople, personOf, pairsFrom, SESSIONS } from "../lib/people.mjs";

async function mapLimit(items, n, fn) { const out = []; for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn))); return out; }
const when = ms => (ms ? `${localDate(ms)} ${fmtMin(localMin(ms))}` : "");
// A cell: quoted when needed, and a leading = + - @ made harmless so a spreadsheet never runs it as a formula.
function cell(v) {
  let x = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(x)) x = "'" + x;
  return /[",\r\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x;
}
const TK_RE = /^tk\/([0-9A-Z]{2,4})\/([a-z][a-f0-9]{10})$/;
async function allTakeaways(s) {
  const keys = (await s.list({ prefix: "tk/" })).blobs.map(b => TK_RE.exec(b.key)).filter(m => m && SESSIONS[m[1]]);
  return (await mapLimit(keys, 16, async m => { const t = await s.get(m[0], { type: "json" }); return t ? { sid: m[1], ...t } : null; })).filter(Boolean);
}
async function cards(s, pubs) {
  const out = new Map();
  await mapLimit([...new Set(pubs)], 16, async pub => { const p = await s.get(`pr/${pub}`, { type: "json" }); if (p) out.set(pub, p); });
  return out;
}

const EXPORTS = {
  async takeaways(s) {
    const rows = (await allTakeaways(s)).sort((a, b) => a.sid.localeCompare(b.sid) || a.at - b.at);
    return [["Session", "Title", "Room", "Rating", "Takeaway", "First name", "Status", "Time"],
      ...rows.map(t => [t.sid, SESSIONS[t.sid].title, SESSIONS[t.sid].room, t.rating, t.text || "", t.showName ? t.first : "", t.status, when(t.at)])];
  },
  async ratings(s) {
    const all = await allTakeaways(s);
    return [["Session", "Title", "Room", "Ratings", "Average", "1", "2", "3", "4", "5"], ...Object.values(SESSIONS).map(x => {
      const r = all.filter(t => t.sid === x.id).map(t => t.rating).filter(n => n >= 1 && n <= 5);
      const avg = r.length ? Math.round(r.reduce((a, b) => a + b, 0) / r.length * 100) / 100 : "";
      return [x.id, x.title, x.room, r.length, avg, ...[1, 2, 3, 4, 5].map(n => r.filter(v => v === n).length)];
    })];
  },
  async polls(s) {
    const [polls, ans, cfg] = await Promise.all([readPolls(s), s.list({ prefix: "ans/" }), s.get("cfg", { type: "json" })]);
    const hidden = new Set((cfg && cfg.hidden) || []), counts = new Map();
    for (const b of ans.blobs) {
      const [, pid, , w] = b.key.split("/"); let word = ""; try { word = decodeURIComponent(w || ""); } catch {}
      if (!pid || !word) continue;
      const k = pid + "\u0000" + word; counts.set(k, (counts.get(k) || 0) + 1);
    }
    const rows = [...counts].map(([k, n]) => { const [pid, word] = k.split("\u0000"); const p = polls.find(x => x.id === pid); return [pid, p ? p.q : "", word, n, hidden.has(word) ? "yes" : "no"]; })
      .sort((a, b) => a[0].localeCompare(b[0]) || b[3] - a[3]);
    return [["Poll", "Question", "Answer", "Count", "Hidden"], ...rows];
  },
  async board(s) {
    const pubs = (await s.list({ prefix: "pr/" })).blobs.map(b => b.key.slice(3)).filter(pubOk);
    const m = await cards(s, pubs);
    const tags = v => (v || []).filter(t => TAGS.includes(t)).join("; ");
    return [["Name", "Company", "Role", "Looking for", "Offers", "LinkedIn", "Status", "Kind", "Updated"],
      ...[...m].sort((a, b) => a[1].name.localeCompare(b[1].name)).map(([pub, p]) => [p.name, p.company, p.role, tags(p.looking), tags(p.offer), p.linkedin, p.status, pub[0] === "p" ? "person" : "guest", when(p.at)])];
  },
  async links(s) {
    const pairs = pairsFrom((await s.list({ prefix: "cx/" })).blobs);
    const m = await cards(s, pairs.flatMap(([a, b]) => [a, b]));
    const name = pub => (m.get(pub) || {}).name || "(card removed)";
    return [["Person A", "Person B", "Time"], ...pairs.map(([a, b, at]) => [name(a), name(b), when(at)])];
  },
  async feedback(s) {
    const keys = (await s.list({ prefix: "fb/" })).blobs.map(b => b.key);
    const rows = (await mapLimit(keys, 16, k => s.get(k, { type: "json" }))).filter(Boolean).sort((a, b) => a.at - b.at);
    return [["Overall", "Recommend", "Comment", "Time"], ...rows.map(f => [f.overall, f.recommend ?? "", f.text || "", when(f.at)])];
  },
  async signins(s) {
    const [people, sig, here, dv] = await Promise.all([readPeople(s), s.list({ prefix: "sig/" }), s.list({ prefix: "here/" }), s.list({ prefix: "dv/" })]);
    const phones = new Map();
    for (const b of dv.blobs) { const pub = b.key.split("/")[1]; phones.set(pub, (phones.get(pub) || 0) + 1); }
    const hereAt = new Map(await mapLimit(here.blobs.map(b => b.key.slice(5)), 16, async pub => [pub, ((await s.get(`here/${pub}`, { type: "json" })) || {}).at || 0]));
    const rows = await mapLimit(sig.blobs.map(b => b.key.slice(4)).filter(pubOk), 16, async pub => {
      const g = (await s.get(`sig/${pub}`, { type: "json" })) || {};
      const p = pub[0] === "p" ? personOf(people, pub.slice(1)) : null;
      return [p ? p.name : g.name || "", pub[0] === "p" ? "person" : "guest", when(g.at), hereAt.has(pub) ? when(hereAt.get(pub)) : "", pub[0] === "p" ? phones.get(pub) || 0 : ""];
    });
    return [["Name", "Kind", "First sign in", "Here on the day", "Phones"], ...rows.sort((a, b) => a[0].localeCompare(b[0]))];
  }
};

export default async (req, context) => {
  const s = st();
  if (!pinOk(req)) { await countPinFail(s).catch(() => {}); return J({ error: "Wrong PIN." }, 401); }
  const what = context.params.what;
  if (!Object.hasOwn(EXPORTS, what)) return J({ error: "Unknown export." }, 404);
  const rows = await EXPORTS[what](s);
  await log(s, whoOf(req), `Exported ${what}`);
  const csv = "﻿" + rows.map(r => r.map(cell).join(",")).join("\r\n") + "\r\n";
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="md26-${what}.csv"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
};

export const config = { path: "/api/export/:what", method: ["GET"] };
