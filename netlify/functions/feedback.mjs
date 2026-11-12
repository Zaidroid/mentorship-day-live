// POST /api/feedback {overall, recommend, text}: three questions after the event (docs/PLAN.md section 5.7).
// Only from phase "after". overall 1 to 5, recommend 0 to 10 or null, text up to 300 characters. One per person,
// a new one replaces it. Feedback never reaches the wall, and the export carries no names.
import { st, readBody, readCfg, J, clean } from "../lib/store.mjs";
import { devOk, whoFor } from "../lib/ids.mjs";
import { nowMs, phase } from "../lib/day.mjs";

export default async (req) => {
  const { body: b, error } = await readBody(req, 2048, "Send the feedback as JSON."); if (error) return error;
  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  if (!Number.isInteger(b.overall) || b.overall < 1 || b.overall > 5) return J({ error: "Tap a rating from 1 to 5." }, 400);
  if (b.recommend != null && (!Number.isInteger(b.recommend) || b.recommend < 0 || b.recommend > 10)) return J({ error: "Pick a number from 0 to 10." }, 400);
  if (b.text != null && typeof b.text !== "string") return J({ error: "Write your comment as text." }, 400);
  const text = clean(b.text, 2000);
  if (text.length > 300) return J({ error: "Keep it to 300 characters." }, 400);
  const s = st();
  const [cfg, w] = await Promise.all([readCfg(s), whoFor(s, dev)]);
  const t = nowMs(cfg);
  if (phase(t) !== "after") return J({ error: "Feedback opens after the event." }, 409);
  await s.setJSON(`fb/${w.pub}`, { overall: b.overall, recommend: b.recommend ?? null, text, at: t });
  return J({ ok: true });
};

export const config = { path: "/api/feedback", method: ["POST"] };
