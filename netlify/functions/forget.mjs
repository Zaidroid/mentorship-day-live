// POST /api/forget: Remove My Data (docs/PLAN.md section 5.7). Removes this person's card, meet code,
// connections, stars, hellos, takeaway lines and name, and signs out every phone of the person.
// Ratings stay without the name (moved to an anonymous key), feedback too. Photos stay: the team approved
// them and they may show other people; the team removes one on request. The people list is the team's.
import { st, J, updateSnap, dropItem, randHex, log } from "../lib/store.mjs";
import { devOk, whoFor, takeawayId } from "../lib/ids.mjs";
import { BLOCKS } from "../lib/people.mjs";

async function mapLimit(items, n, fn) { const out = []; for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn))); return out; }

export default async (req) => {
  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  const s = st();
  const w = await whoFor(s, dev), pub = w.pub;
  const [card, cx, tks, hi, phones, fb, ...stars] = await Promise.all([
    s.get(`pr/${pub}`, { type: "json" }), s.list({ prefix: "cx/" }), s.list({ prefix: "tk/" }), s.list({ prefix: "hi/" }),
    s.list({ prefix: `dv/${pub}/` }), s.get(`fb/${pub}`, { type: "json" }), ...BLOCKS.map(b => s.list({ prefix: `star/${b}/${pub}/` }))
  ]);
  const gone = [`pr/${pub}`, `q/pr/${pub}`, `ok/pr/${pub}`, `sig/${pub}`, `here/${pub}`, `fb/${pub}`, `who/${dev}`];
  if (card && card.code && (await s.get(`code/${card.code}`)) === pub) gone.push(`code/${card.code}`);
  gone.push(...cx.blobs.map(b => b.key).filter(k => k.includes(pub)));
  gone.push(...hi.blobs.map(b => b.key).filter(k => k.includes(`~${pub}~`)));
  gone.push(...stars.flatMap(l => l.blobs.map(b => b.key)));
  for (const b of phones.blobs) { const d = b.key.split("/").pop(); gone.push(b.key); const wd = await s.get(`who/${d}`, { type: "json" }); if (wd && wd.pub === pub) gone.push(`who/${d}`); }
  // Takeaways: the rating stays under an anonymous id, the line and the name go.
  const mine = tks.blobs.map(b => /^tk\/([0-9A-Z]{2,4})\/([pg][a-f0-9]{10})$/.exec(b.key)).filter(m => m && m[2] === pub);
  const ids = [];
  await mapLimit(mine, 8, async m => {
    const t = await s.get(m[0], { type: "json" });
    if (t && t.rating) await s.setJSON(`tk/${m[1]}/a${randHex(5)}`, { rating: t.rating, text: "", first: "", showName: false, at: t.at, status: "none", n: 1 });
    gone.push(m[0], `q/tk/${m[1]}~${pub}`, `ok/tk/${m[1]}~${pub}`); ids.push(takeawayId(m[1], pub));
  });
  if (fb) await s.setJSON(`fb/a${randHex(5)}`, fb);
  await mapLimit([...new Set(gone)], 20, k => s.delete(k));
  await updateSnap(s, sn => { dropItem(sn.profiles, pub); for (const id of ids) dropItem(sn.takeaways, id); });
  await log(s, "A phone", "Removed its data");
  return J({ ok: true });
};

export const config = { path: "/api/forget", method: ["POST"] };
