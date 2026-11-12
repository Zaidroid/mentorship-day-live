// Heartbeat from the wall, every 60 seconds (docs/PLAN.md section 5.12). The remote shows the last one with its age.
// Anyone can post, so every field is cleaned and capped, and the body is at most 1 KB.
import { st, clean, J } from "../lib/store.mjs";
import { realNow } from "../lib/day.mjs";
import { alertSoon, originOf } from "../lib/alert.mjs";

const MAX = 1024;
const num = v => (Number.isFinite(+v) && v !== null && v !== "" ? Math.round(+v * 100) / 100 : null);
const scenes = v => Array.isArray(v) ? v.slice(0, 8).map(x => clean(x, 24)) : clean(v, 120);

export default async (req, context) => {
  if ((+req.headers.get("content-length") || 0) > MAX) return J({ error: "That beat is too large." }, 413);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MAX) return J({ error: "That beat is too large." }, 413);
  let b; try { b = JSON.parse(new TextDecoder().decode(buf)); } catch { return J({ error: "Send the beat as JSON." }, 400); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return J({ error: "Send the beat as JSON." }, 400);
  const beat = { w: num(b.w), h: num(b.h), dpr: num(b.dpr), layout: clean(b.layout, 20), mode: clean(b.mode, 20), scenes: scenes(b.scenes), lite: !!b.lite, fps: num(b.fps), err: clean(b.err, 300), at: num(b.at), rt: realNow() };
  const s = st();
  await s.setJSON("beat", beat);
  if (beat.err) await alertSoon(context, s, "wall", { origin: originOf(req) });
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
};

export const config = { path: "/api/beat", method: ["POST"] };
