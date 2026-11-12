// Photo wall uploads and serving. New photos wait for operator approval.
// Approved photos are public and cached; pending photos are only served to the remote with the PIN.
import { st, idOk, clean, isBad, pinOk, countPinFail, J, CDN } from "../lib/store.mjs";
import { devOk, pubFor } from "../lib/ids.mjs";

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
    if (!authed && req.headers.get("x-pin")) await countPinFail(s).catch(() => {});
    if (!approved && !authed) return notFound();
    const e = await s.getWithMetadata(`ph/${id}`, { type: "arrayBuffer" });
    if (e === null) return notFound();
    const cache = approved && !authed ? CDN(31536000, { immutable: true }) : { "cache-control": "no-store" };
    const type = TYPES.includes(e.metadata.type) ? e.metadata.type : "image/jpeg";
    return new Response(e.data, { headers: { "content-type": type, ...cache, ...NOSNIFF } });
  }

  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  const type = (req.headers.get("content-type") || "").split(";")[0].trim();
  if (!TYPES.includes(type)) return J({ error: "Send a JPEG, PNG or WebP photo." }, 415);
  if ((+req.headers.get("content-length") || 0) > MAX) return J({ error: "That photo is too large. Try a smaller one." }, 413);
  const buf = await req.arrayBuffer();
  if (!buf.byteLength) return J({ error: "The photo was empty." }, 400);
  if (buf.byteLength > MAX) return J({ error: "That photo is too large. Try a smaller one." }, 413);
  const mine = (await s.list({ prefix: `byd/${dev}/` })).blobs.length;
  if (mine >= PER_PHONE) return J({ error: "You have shared the maximum number of photos. Thank you!" }, 429);
  const dec = h => { try { return decodeURIComponent(req.headers.get(h) || ""); } catch { return ""; } };
  const name = clean(dec("x-name"), 40), caption = clean(dec("x-caption"), 90);
  if (isBad(name) || isBad(caption)) return J({ error: "Please change the name or caption." }, 422);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  // The photo records who sent it by public id. The device id stays only in the byd/ count key.
  await s.set(`ph/${id}`, buf, { metadata: { type, name, caption, pub: await pubFor(s, dev), at: Date.now() } });
  await s.set(`q/ph/${id}`, "");
  await s.set(`byd/${dev}/${id}`, "");
  return J({ ok: true, id });
};

export const config = { path: ["/api/photo", "/api/photo/:id"], method: ["GET", "POST"] };
