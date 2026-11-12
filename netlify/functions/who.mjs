// GET /api/who?q=<name>: search the people list for sign in (docs/PLAN.md section 5.3).
// At least 3 letters, at most 5 answers, names and public ids only. 40 searches per phone per 10 minutes.
import { st, J, limitCount, limitHit } from "../lib/store.mjs";
import { devOk, normName } from "../lib/ids.mjs";
import { readPeople, search } from "../lib/people.mjs";

const PER_PHONE = 40, WINDOW = 10 * 60 * 1000;

export default async (req) => {
  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  const q = (new URL(req.url).searchParams.get("q") || "").slice(0, 200);
  if (q.length > 60) return J({ error: "Type a shorter part of your name." }, 400);
  if (normName(q).replace(/ /g, "").length < 3) return J({ error: "Type at least 3 letters of your name." }, 400);
  const s = st();
  if (await limitCount(s, "who", dev, WINDOW) >= PER_PHONE) return J({ error: "Too many searches. Wait a few minutes and try again." }, 429);
  const [people] = await Promise.all([readPeople(s), limitHit(s, "who", dev, WINDOW)]);
  return J({ list: search(people, q) });
};

export const config = { path: "/api/who", method: ["GET"] };
