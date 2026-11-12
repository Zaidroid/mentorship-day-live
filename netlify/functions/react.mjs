// POST /api/react {c: {clap, heart, bloom}}: one batch of reactions from a phone (docs/PLAN.md sections 5.7 and 5.12).
// Each count is capped at 30. One batch per phone per 3 seconds (2.5 seconds here, for clock jitter), at most
// 150 batches per phone, at most 400 batches in one 4 second window from everyone. 409 while reactions are off.
import { st, readBody, readCfg, J, randHex } from "../lib/store.mjs";
import { devOk } from "../lib/ids.mjs";
import { nowMs, realNow } from "../lib/day.mjs";
import { rxOn } from "../lib/rules.mjs";
import { winOf, minOf, RX_KINDS } from "../lib/rx.mjs";

const CAP = 30, GAP_MS = 2500, PER_PHONE = 150, PER_WINDOW = 400;

export default async (req) => {
  const { body: b, error } = await readBody(req, 256, "Send the reactions as JSON."); if (error) return error;
  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  const c = b.c && typeof b.c === "object" && !Array.isArray(b.c) ? b.c : {};
  const v = RX_KINDS.map(k => Math.max(0, Math.min(CAP, Math.floor(Number.isFinite(+c[k]) ? +c[k] : 0))));
  if (!(v[0] + v[1] + v[2])) return J({ error: "Nothing to send." }, 400);
  const s = st();
  const [cfg, mine] = await Promise.all([readCfg(s), s.get(`rxd/${dev}`, { type: "json" })]);
  const t = nowMs(cfg);
  if (!rxOn(cfg, t)) return J({ error: "Reactions are closed right now." }, 409);
  const real = realNow();
  if (mine && real - mine.at < GAP_MS) return J({ error: "One moment, then send again." }, 429);
  if (mine && mine.n >= PER_PHONE) return J({ error: "That is all the reactions for today. Thank you!" }, 429);
  const w = winOf(t), pre = `rx/${minOf(w)}/${w}/`;
  if ((await s.list({ prefix: pre })).blobs.length >= PER_WINDOW) return J({ error: "Too many reactions at once. Try again in a moment." }, 429);
  await Promise.all([
    s.set(`${pre}${dev}~${v[0]}~${v[1]}~${v[2]}~${randHex(3)}`, ""),
    s.setJSON(`rxd/${dev}`, { at: real, n: ((mine && mine.n) || 0) + 1 })
  ]);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/react", method: ["POST"] };
