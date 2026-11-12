// POST /api/meet {code}: "We met" with the 3 digit code of another person on the board (docs/PLAN.md section 5.7).
// Both cards must be on the board. Not yourself. The same pair twice is fine and changes nothing.
// 5 wrong codes per phone per 10 minutes, at most 60 connections per person.
import { st, readBody, readCfg, J, limitCount, limitHit } from "../lib/store.mjs";
import { devOk, whoFor, pubOk } from "../lib/ids.mjs";
import { nowMs } from "../lib/day.mjs";
import { pairsFrom } from "../lib/people.mjs";

const WRONG = 5, WINDOW = 10 * 60 * 1000, MOST = 60;
const NOT_ON = "That code is not on the board. Check the number.";

export default async (req) => {
  const { body: b, error } = await readBody(req, 256, "Send the code as JSON."); if (error) return error;
  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  const code = String(b.code ?? "").trim();
  if (!/^[1-9]\d\d$/.test(code)) return J({ error: "Type the 3 digit code." }, 400);
  const s = st();
  const [cfg, w, wrong] = await Promise.all([readCfg(s), whoFor(s, dev), limitCount(s, "meet", dev, WINDOW)]);
  if (!cfg.flags.meet) return J({ error: "Meeting codes are switched off right now." }, 409);
  if (wrong >= WRONG) return J({ error: "Too many wrong codes. Try again in a few minutes." }, 429);
  const [mine, other] = await Promise.all([s.get(`ok/pr/${w.pub}`), s.get(`code/${code}`)]);
  if (mine === null) return J({ error: "Join the Networking Board first." }, 409);
  if (other === w.pub) return J({ error: "That is your own code." }, 400);
  const [otherOn, card] = pubOk(other) ? await Promise.all([s.get(`ok/pr/${other}`), s.get(`pr/${other}`, { type: "json" })]) : [null, null];
  if (otherOn === null || !card) { await limitHit(s, "meet", dev, WINDOW); return J({ error: NOT_ON }, 404); }
  const person = { id: other, name: card.name, company: card.company || "", role: card.role || "", linkedin: card.linkedin || "" };
  const pairs = pairsFrom((await s.list({ prefix: "cx/" })).blobs);
  const [x, y] = [w.pub, other].sort();
  if (pairs.some(([a, c]) => a === x && c === y)) return J({ ok: true, again: true, person });
  const count = pub => pairs.filter(([a, c]) => a === pub || c === pub).length;
  if (count(w.pub) >= MOST) return J({ error: "You have made 60 connections today. That is the most." }, 429);
  if (count(other) >= MOST) return J({ error: "This person has made 60 connections today. That is the most." }, 429);
  await s.set(`cx/${x}~${y}~${nowMs(cfg)}`, "");
  return J({ ok: true, again: false, person });
};

export const config = { path: "/api/meet", method: ["POST"] };
