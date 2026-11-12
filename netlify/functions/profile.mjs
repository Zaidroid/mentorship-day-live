// Networking Board profiles. One profile per person, keyed by the public id (pub), never by device.
// The phone sends its device id in the x-dev header. New or edited profiles wait for approval.
import { st, clean, isBad, updateSnap, dropItem, J, TAGS } from "../lib/store.mjs";
import { devOk, pubFor } from "../lib/ids.mjs";

function pickTags(v) { return Array.isArray(v) ? [...new Set(v.filter(t => TAGS.includes(t)))].slice(0, 3) : []; }
const devOf = (req, b) => req.headers.get("x-dev") || (b && b.dev) || new URL(req.url).searchParams.get("dev") || "";

export default async (req) => {
  const s = st();
  if (req.method === "GET") {
    const dev = devOf(req);
    if (!devOk(dev)) return J({ status: "none" });
    const pub = await pubFor(s, dev);
    const p = await s.get(`pr/${pub}`, { type: "json" });
    if (!p) return J({ status: "none", id: pub });
    const [approved, pending] = await Promise.all([s.get(`ok/pr/${pub}`), s.get(`q/pr/${pub}`)]);
    const status = approved !== null ? "approved" : (pending !== null ? "pending" : (p.status === "declined" ? "declined" : "pending"));
    return J({ status, profile: p, id: pub });
  }

  let b; try { b = await req.json(); } catch { return J({ error: "Send the profile as JSON." }, 400); }
  const dev = devOf(req, b);
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  const name = clean(b.name, 40), company = clean(b.company, 50), role = clean(b.role, 50);
  let linkedin = clean(b.linkedin, 120);
  if (name.length < 2) return J({ error: "Add your name." }, 400);
  if (!b.consent) return J({ error: "Please agree to show your profile." }, 400);
  if (linkedin && !/^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/\S+$/i.test(linkedin)) return J({ error: "That LinkedIn link does not look right." }, 400);
  if (linkedin && !/^https?:\/\//i.test(linkedin)) linkedin = "https://" + linkedin;
  const looking = pickTags(b.looking), offer = pickTags(b.offer);
  if (!looking.length && !offer.length) return J({ error: "Pick at least one tag." }, 400);
  if ([name, company, role].some(isBad)) return J({ error: "Please change the wording." }, 422);
  const pub = await pubFor(s, dev);
  const p = { name, company, role, looking, offer, linkedin, at: Date.now(), status: "pending" };
  await s.setJSON(`pr/${pub}`, p);
  await s.set(`q/pr/${pub}`, "");
  if ((await s.get(`ok/pr/${pub}`)) !== null) { await s.delete(`ok/pr/${pub}`); await updateSnap(s, sn => dropItem(sn.profiles, pub)); }
  return J({ ok: true, status: "pending", id: pub });
};

export const config = { path: "/api/profile", method: ["GET", "POST"] };
