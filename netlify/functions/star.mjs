// POST /api/star {b, sid}: my session in block b (docs/PLAN.md section 5.7). One per block, sid null removes it.
// Always stored as own, so it replaces a pick made for the person. A seat set by the team cannot be changed here.
// Stars are intentions, not bookings: a full session can still be starred.
import { st, readBody, J } from "../lib/store.mjs";
import { devOk, whoFor } from "../lib/ids.mjs";
import { readPeople, personOf, readStars, writeStar, starsOf, BLOCKS, SESSIONS } from "../lib/people.mjs";

export default async (req) => {
  const { body: b, error } = await readBody(req, 256, "Send the star as JSON."); if (error) return error;
  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  if (!BLOCKS.includes(b.b)) return J({ error: "Unknown block." }, 400);
  if (b.sid !== null && !(typeof b.sid === "string" && SESSIONS[b.sid] && SESSIONS[b.sid].b === b.b)) return J({ error: "Pick a session in this block." }, 400);
  const s = st();
  const w = await whoFor(s, dev);
  const person = w.status === "person" ? personOf(await readPeople(s), w.pid) : null;
  if (person && (person.rooms || {})[b.b]) return J({ error: "Your seat in this block was set by the team. Ask at the registration desk to change it." }, 409);
  await writeStar(s, b.b, w.pub, b.sid, "own");
  return J({ ok: true, stars: starsOf(person, await readStars(s, w.pub)) });
};

export const config = { path: "/api/star", method: ["POST"] };
