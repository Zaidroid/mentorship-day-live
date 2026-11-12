// Networking Board profiles. One profile per person, keyed by the public id (pub), never by device.
// The phone sends its device id in the x-dev header. A verified person's card is approved at once while
// flags.trustProfiles is on, with name and company from registration (docs/PLAN.md section 5.9).
// Every other new or edited card waits for the team.
import { st, clean, isBad, cleanLinkedin, readCfg, readBody, J, TAGS } from "../lib/store.mjs";
import { devOk, whoFor } from "../lib/ids.mjs";
import { readPeople, personOf } from "../lib/people.mjs";
import { approveCard, unlistCard } from "../lib/board.mjs";
import { alertSoon, originOf, waitingCount } from "../lib/alert.mjs";

function pickTags(v) { return Array.isArray(v) ? [...new Set(v.filter(t => TAGS.includes(t)))].slice(0, 3) : []; }
const devOf = (req, b) => req.headers.get("x-dev") || (b && b.dev) || new URL(req.url).searchParams.get("dev") || "";

export default async (req, context) => {
  const s = st();
  if (req.method === "GET") {
    const dev = devOf(req);
    if (!devOk(dev)) return J({ status: "none" });
    const { pub } = await whoFor(s, dev);
    const p = await s.get(`pr/${pub}`, { type: "json" });
    if (!p) return J({ status: "none", id: pub });
    const [approved, pending] = await Promise.all([s.get(`ok/pr/${pub}`), s.get(`q/pr/${pub}`)]);
    const status = approved !== null ? "approved" : (pending !== null ? "pending" : (p.status === "declined" ? "declined" : "pending"));
    const { code, ...card } = p;
    return J({ status, profile: card, id: pub });
  }

  const { body: b, error } = await readBody(req, 4096, "Send the profile as JSON."); if (error) return error;
  const dev = devOf(req, b);
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  const w = await whoFor(s, dev);
  const [cfg, person] = await Promise.all([readCfg(s), w.status === "person" ? readPeople(s).then(pp => personOf(pp, w.pid)) : null]);
  // A verified person's name and company come from registration, so they never need a check by a person.
  const name = person ? clean(person.name, 60) : clean(b.name, 40);
  const company = person ? clean(person.company, 80) : clean(b.company, 50);
  const role = clean(b.role, 50);
  if (name.length < 2) return J({ error: "Add your name." }, 400);
  if (!b.consent) return J({ error: "Please agree to show your profile." }, 400);
  const li = cleanLinkedin(b.linkedin);
  if (!li.ok) return J({ error: "That LinkedIn link does not look right." }, 400);
  const looking = pickTags(b.looking), offer = pickTags(b.offer);
  if (!looking.length && !offer.length) return J({ error: "Pick at least one tag." }, 400);
  if ((person ? [role] : [name, company, role]).some(isBad)) return J({ error: "Please change the wording." }, 422);
  const pub = w.pub;
  const trusted = !!person && cfg.flags.trustProfiles;
  const prev = await s.get(`pr/${pub}`, { type: "json" });
  const p = { name, company, role, looking, offer, linkedin: li.value, at: Date.now(), status: trusted ? "approved" : "pending" };
  if (prev && prev.code) p.code = prev.code; // the meet code stays with the person
  await s.setJSON(`pr/${pub}`, p);
  if (trusted) await approveCard(s, pub, p);
  else {
    await s.set(`q/pr/${pub}`, "");
    if ((await s.get(`ok/pr/${pub}`)) !== null) await unlistCard(s, pub);
    await alertSoon(context, s, "waiting", { origin: originOf(req), count: () => waitingCount(s) });
  }
  return J({ ok: true, status: p.status, id: pub });
};

export const config = { path: "/api/profile", method: ["GET", "POST"] };
