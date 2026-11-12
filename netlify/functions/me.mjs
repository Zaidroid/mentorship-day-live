// GET /api/me: everything about this phone's person in one answer (docs/PLAN.md section 5.7).
// { status, me, stars, profile, code, links, takeaways, feedback }. Never cached.
import { st, J } from "../lib/store.mjs";
import { devOk, whoFor } from "../lib/ids.mjs";
import { meBody } from "../lib/people.mjs";
import { seenToday } from "../lib/signin.mjs";

export default async (req) => {
  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  const s = st();
  const w = await whoFor(s, dev);
  await seenToday(s, w);
  return J(await meBody(s, w));
};

export const config = { path: "/api/me", method: ["GET"] };
