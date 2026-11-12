// Networking Board profiles. One profile per phone. New or edited profiles wait for approval.
import { st, devOk, clean, isBad, rebuild, J, TAGS } from "../lib/store.mjs";

function pickTags(v) { return Array.isArray(v) ? [...new Set(v.filter(t => TAGS.includes(t)))].slice(0, 3) : []; }

export default async (req) => {
  const s = st();
  if (req.method === "GET") {
    const dev = new URL(req.url).searchParams.get("dev") || "";
    if (!devOk(dev)) return J({ status: "none" });
    const p = await s.get(`pr/${dev}`, { type: "json" });
    if (!p) return J({ status: "none" });
    const approved = (await s.get(`ok/pr/${dev}`)) !== null;
    const pending = (await s.get(`q/pr/${dev}`)) !== null;
    return J({ status: approved ? "approved" : (pending ? "pending" : (p.status === "declined" ? "declined" : "pending")), profile: p });
  }

  let b; try { b = await req.json(); } catch { return J({ error: "Send the profile as JSON." }, 400); }
  if (!devOk(b.dev)) return J({ error: "Unknown device." }, 400);
  const name = clean(b.name, 40), company = clean(b.company, 50), role = clean(b.role, 50);
  let linkedin = clean(b.linkedin, 120);
  if (name.length < 2) return J({ error: "Add your name." }, 400);
  if (!b.consent) return J({ error: "Please agree to show your profile." }, 400);
  if (linkedin && !/^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/\S+$/i.test(linkedin)) return J({ error: "That LinkedIn link does not look right." }, 400);
  if (linkedin && !/^https?:\/\//i.test(linkedin)) linkedin = "https://" + linkedin;
  const looking = pickTags(b.looking), offer = pickTags(b.offer);
  if (!looking.length && !offer.length) return J({ error: "Pick at least one tag." }, 400);
  if ([name, company, role].some(isBad)) return J({ error: "Please change the wording." }, 422);
  const p = { name, company, role, looking, offer, linkedin, at: Date.now(), status: "pending" };
  await s.setJSON(`pr/${b.dev}`, p);
  await s.set(`q/pr/${b.dev}`, "");
  if ((await s.get(`ok/pr/${b.dev}`)) !== null) { await s.delete(`ok/pr/${b.dev}`); await rebuild(s); }
  return J({ ok: true, status: "pending" });
};

export const config = { path: "/api/profile", method: ["GET", "POST"] };
