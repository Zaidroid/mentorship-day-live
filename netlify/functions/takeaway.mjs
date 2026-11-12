// POST /api/takeaway {sid, rating, text, showName}: how a session was, with one optional line (docs/PLAN.md section 5.7).
// Rating 1 to 5. Text up to 120 characters, through the word filter, no links, no phone numbers. Open only in the
// session's window (rules.mjs tkWindow). A verified person's line goes up at once while trustTakeaways is on;
// a guest's waits for the team. A new one replaces the last, at most 5 times per session.
import { st, readBody, readCfg, J, clean, isBad, firstWord } from "../lib/store.mjs";
import { devOk, whoFor } from "../lib/ids.mjs";
import { DAY, nowMs, localDate, localMin, fmtMin } from "../lib/day.mjs";
import { tkOpen, tkWindow } from "../lib/rules.mjs";
import { SESSIONS } from "../lib/people.mjs";
import { hasLink, hasNumber, placeTakeaway } from "../lib/tk.mjs";

const MAX_TEXT = 120, EDITS = 5;

export default async (req) => {
  const { body: b, error } = await readBody(req, 1024, "Send the takeaway as JSON."); if (error) return error;
  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  const sx = typeof b.sid === "string" && Object.hasOwn(SESSIONS, b.sid) ? SESSIONS[b.sid] : null;
  if (!sx) return J({ error: "Pick a session." }, 400);
  if (!Number.isInteger(b.rating) || b.rating < 1 || b.rating > 5) return J({ error: "Tap a rating from 1 to 5." }, 400);
  if (b.text != null && typeof b.text !== "string") return J({ error: "Write your takeaway as text." }, 400);
  const text = clean(b.text, 1000);
  if (text.length > MAX_TEXT) return J({ error: "Keep it to 120 characters." }, 400);
  if (text && isBad(text)) return J({ error: "Please change the wording." }, 422);
  if (text && hasLink(text)) return J({ error: "Please leave out links." }, 422);
  if (text && hasNumber(text)) return J({ error: "Please leave out phone numbers." }, 422);
  const s = st();
  const [cfg, w] = await Promise.all([readCfg(s), whoFor(s, dev)]);
  if (!cfg.flags.takeaways) return J({ error: "Takeaways are switched off right now." }, 409);
  const t = nowMs(cfg);
  if (!tkOpen(sx.b, t)) {
    const win = tkWindow(sx.b), d = localDate(t);
    const early = d < DAY.date || (d === DAY.date && localMin(t) < win.from);
    return J({ error: early ? `Takeaways for this session open at ${fmtMin(win.from)}.` : "Takeaways for this session are closed." }, 409);
  }
  const key = `tk/${sx.id}/${w.pub}`;
  const prev = await s.get(key, { type: "json" });
  if (prev && prev.n >= EDITS) return J({ error: "You have changed this takeaway enough times. Thank you!" }, 429);
  const first = w.name ? firstWord(w.name) : "";
  const trusted = w.status === "person" && cfg.flags.trustTakeaways;
  const rec = { rating: b.rating, text, first, showName: b.showName === true && !!first, at: t, status: !text ? "none" : trusted ? "approved" : "pending", n: ((prev && prev.n) || 0) + 1 };
  await s.setJSON(key, rec);
  await placeTakeaway(s, sx.id, w.pub, rec);
  return J({ ok: true, status: rec.status });
};

export const config = { path: "/api/takeaway", method: ["POST"] };
