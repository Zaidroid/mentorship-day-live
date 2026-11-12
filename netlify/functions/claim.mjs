// POST /api/claim {id, last4, hello}: sign in as a person from the people list (docs/PLAN.md section 5.3).
// id is the public id from GET /api/who. 5 wrong tries per phone per person and 10 per person in total,
// then 423 until the team taps Unlock. An answer never says how close a wrong number was.
import { st, readBody, J, withLock, randHex } from "../lib/store.mjs";
import { devOk, whoFor } from "../lib/ids.mjs";
import { readPeople, personOf, last4Ok, meBody } from "../lib/people.mjs";
import { afterSignIn } from "../lib/signin.mjs";
import { alertSoon, originOf } from "../lib/alert.mjs";

const PHONE_TRIES = 5, PERSON_TRIES = 10, PHONES = 3;
const LOCKED = "Too many tries. Ask the team at the registration desk.";

export default async (req, context) => {
  const { body: b, error } = await readBody(req, 512, "Send the sign in as JSON."); if (error) return error;
  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  if (typeof b.id !== "string" || !/^p[a-f0-9]{10}$/.test(b.id)) return J({ error: "Pick your name from the list." }, 400);
  if (typeof b.last4 !== "string" || !/^\d{4}$/.test(b.last4)) return J({ error: "Type the last 4 digits of your mobile number." }, 400);
  const s = st(), pid = b.id.slice(1), pub = b.id;
  const people = await readPeople(s);
  const person = personOf(people, pid);
  if (!person) return J({ error: "We could not find that name. Search again." }, 404);

  // Every try is written before it is checked, so tries sent at the same moment all count:
  // the one that lands as the 11th sees 11 and is refused, whatever the device id.
  const mark = `fail/${pid}/${dev}~${Date.now().toString(36)}${randHex()}`;
  await s.set(mark, "");
  const { blobs } = await s.list({ prefix: `fail/${pid}/` });
  const all = blobs.length, mine = blobs.filter(k => k.key.startsWith(`fail/${pid}/${dev}~`)).length;
  if (all > PERSON_TRIES || mine > PHONE_TRIES) { await s.delete(mark); return J({ error: LOCKED, left: 0 }, 423); }
  if (!last4Ok(person, b.last4)) {
    const left = Math.max(0, Math.min(PHONE_TRIES - mine, PERSON_TRIES - all));
    if (all === PERSON_TRIES) await alertSoon(context, s, "locked", { origin: originOf(req) });
    return J({ error: left ? "That is not the right number. Try again." : LOCKED, left }, 401);
  }
  await s.delete(mark);

  return withLock("pub:" + pub, async () => {
    const pre = `dv/${pub}/`;
    const phones = (await s.list({ prefix: pre })).blobs.map(k => k.key.slice(pre.length));
    if (!phones.includes(dev) && phones.length >= PHONES) return J({ error: "This name is signed in on 3 phones already. Ask the team at the registration desk." }, 409);
    const prev = await whoFor(s, dev);
    const w = { status: "person", pub, pid, name: person.name, hello: b.hello === true };
    await Promise.all([phones.includes(dev) ? null : s.set(pre + dev, ""), s.setJSON(`who/${dev}`, { pub, pid, name: person.name, hello: w.hello, at: Date.now() })]);
    await afterSignIn(s, { w, prev, person, people, dev });
    return J({ ok: true, ...(await meBody(s, w, { people })) });
  });
};

export const config = { path: "/api/claim", method: ["POST"] };
