// POST /api/guest {name, hello}: continue as a guest, for people who are not on the list (docs/PLAN.md section 5.3).
// Guests can do everything, but their card and takeaways wait for the team.
import { st, readBody, J, clean, isBad, withLock } from "../lib/store.mjs";
import { devOk, whoFor, guestPub } from "../lib/ids.mjs";
import { meBody, afterSignIn } from "../lib/people.mjs";

export default async (req) => {
  const { body: b, error } = await readBody(req, 512, "Send your name as JSON."); if (error) return error;
  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  const name = clean(b.name, 40);
  if (name.replace(/[^\p{L}]/gu, "").length < 2) return J({ error: "Type your name." }, 400);
  if (isBad(name)) return J({ error: "Please use a different name." }, 422);
  const s = st(), pub = guestPub(dev);
  return withLock("pub:" + pub, async () => {
    const prev = await whoFor(s, dev);
    const w = { status: "guest", pub, pid: null, name, hello: b.hello === true };
    await s.setJSON(`who/${dev}`, { pub, pid: null, name, hello: w.hello, at: Date.now() });
    await afterSignIn(s, { w, prev, person: null, people: null, dev });
    return J({ ok: true, ...(await meBody(s, w)) });
  });
};

export const config = { path: "/api/guest", method: ["POST"] };
