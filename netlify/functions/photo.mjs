// Photo wall uploads and serving. New photos wait for operator approval, except (docs/PLAN.md section 5.9):
// a team upload with a valid x-pin is approved at once, and while flags.trustPhotos is on so is a photo from
// a verified person who agreed to photos at registration. Answers { ok, id, status } (approved or pending).
// Approved photos are public and cached; pending photos are only served to the remote with the PIN.
import { st, idOk, clean, isBad, pinOk, countPinFail, readCfg, updateSnap, putItem, photoItem, J, CDN } from "../lib/store.mjs";
import { devOk, whoFor } from "../lib/ids.mjs";
import { readPeople, personOf } from "../lib/people.mjs";
import { alertSoon, originOf } from "../lib/alert.mjs";

const TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX = 4 * 1024 * 1024;
const PER_PHONE = 12;

// Every photo response says nosniff, so a browser never runs an upload as anything but an image.
const NOSNIFF = { "x-content-type-options": "nosniff" };
const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...NOSNIFF } });

export default async (req, context) => {
  const s = st();
  if (req.method === "GET") {
    const id = context.params.id;
    if (!idOk(id)) return notFound();
    const approved = (await s.get(`ok/ph/${id}`)) !== null;
    const authed = pinOk(req);
    if (!authed && req.headers.get("x-pin")) await pinFailed(s, req, context);
    if (!approved && !authed) return notFound();
    const e = await s.getWithMetadata(`ph/${id}`, { type: "arrayBuffer" });
    if (e === null) return notFound();
    const cache = approved && !authed ? CDN(31536000, { immutable: true }) : { "cache-control": "no-store" };
    const type = TYPES.includes(e.metadata.type) ? e.metadata.type : "image/jpeg";
    return new Response(e.data, { headers: { "content-type": type, ...cache, ...NOSNIFF } });
  }

  const team = req.headers.get("x-pin") !== null;
  if (team && !pinOk(req)) { await pinFailed(s, req, context); return J({ error: "Wrong PIN." }, 401); }
  const dev = req.headers.get("x-dev") || "";
  if (!team && !devOk(dev)) return J({ error: "Unknown device." }, 400);
  const type = (req.headers.get("content-type") || "").split(";")[0].trim();
  if (!TYPES.includes(type)) return J({ error: "Send a JPEG, PNG or WebP photo." }, 415);
  if ((+req.headers.get("content-length") || 0) > MAX) return J({ error: "That photo is too large. Try a smaller one." }, 413);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return J({ error: "The photo was empty." }, 400);
  if (buf.byteLength > MAX) return J({ error: "That photo is too large. Try a smaller one." }, 413);
  if (!team && (await s.list({ prefix: `byd/${dev}/` })).blobs.length >= PER_PHONE) return J({ error: "You have shared the maximum number of photos. Thank you!" }, 429);
  const dec = h => { try { return decodeURIComponent(req.headers.get(h) || ""); } catch { return ""; } };
  const name = clean(dec("x-name"), 40), caption = clean(dec("x-caption"), 90);
  if (isBad(name) || isBad(caption)) return J({ error: "Please change the name or caption." }, 422);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // The photo records who sent it by public id ("team" for the team). The device id stays only in the byd/ count key.
  let pub = "team", now = team;
  if (!team) {
    const [w, cfg] = await Promise.all([whoFor(s, dev), readCfg(s)]);
    pub = w.pub;
    if (cfg.flags.trustPhotos && w.status === "person") { const p = personOf(await readPeople(s), w.pid); now = !!(p && p.photoOk === true); }
  }
  const meta = { type, name, caption, pub, at: Date.now() };
  await s.set(`ph/${id}`, buf, { metadata: meta });
  if (!team) await s.set(`byd/${dev}/${id}`, "");
  if (now) { await s.set(`ok/ph/${id}`, ""); await updateSnap(s, sn => putItem(sn.photos, photoItem(id, meta))); }
  else { await s.set(`q/ph/${id}`, ""); await alertSoon(context, s, "photos", { origin: originOf(req), count: async () => (await s.list({ prefix: "q/ph/" })).blobs.length }); }
  return J({ ok: true, id, status: now ? "approved" : "pending" });
};

// A wrong PIN is counted; 50 in 10 minutes raise an alert.
async function pinFailed(s, req, context) {
  const n = await countPinFail(s).catch(() => 0);
  if (n >= 50) await alertSoon(context, s, "pin", { count: n, origin: originOf(req) });
}

export const config = { path: ["/api/photo", "/api/photo/:id"], method: ["GET", "POST"] };
