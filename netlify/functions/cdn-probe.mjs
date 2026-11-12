// CDN experiment route (docs/PLAN.md section 5.12). Answers a tiny body with the cache headers of one
// candidate policy, so one deploy can test every candidate: each ?p= is its own cache key.
//   GET /api/cdn-probe?p=b&s=5     policy b from CDN_POLICIES in store.mjs, 5 seconds
// No blob access, no data, nothing written. "at" shows when the function made the answer, so a cached
// copy is easy to tell from a fresh one. Run scripts/cdn-check.sh against it.
import { J, CDN, CDN_POLICIES } from "../lib/store.mjs";

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const p = q.get("p") || "a";
  const n = parseInt(q.get("s") || "2", 10);
  if (!Object.hasOwn(CDN_POLICIES, p)) return J({ error: "Unknown policy." }, 400);
  if (!(n >= 1 && n <= 60)) return J({ error: "Give s between 1 and 60." }, 400);
  return J({ p, s: n, at: Date.now() }, 200, CDN(n, { policy: p }));
};

export const config = { path: "/api/cdn-probe", method: ["GET"] };
