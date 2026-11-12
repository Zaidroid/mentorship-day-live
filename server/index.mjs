// Self hosted server for Mentorship Day Live.
// Serves public/ and runs the same Netlify Functions, backed by a local file based Blobs store.
// The Netlify deploy does not use this file. Use it to run on your own server or a laptop at the venue.
//
//   REMOTE_PIN=123456 PORT=8080 DATA_DIR=./data LOCAL_CDN=1 node server/index.mjs
//
// LOCAL_CDN=1 keeps answers for their CDN time, as Netlify does (see below). npm start and the Docker image set it.
//
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { BlobsServer } from "@netlify/blobs/server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +process.env.PORT || 8080;
const DATA_DIR = path.resolve(root, process.env.DATA_DIR || "data");
const MAX_BODY = 6 * 1024 * 1024;

if (!process.env.REMOTE_PIN) console.warn("REMOTE_PIN is not set. The operator remote will refuse every PIN until you set it.");

// Local Blobs store, same API the functions use on Netlify.
const token = crypto.randomBytes(16).toString("hex");
const blobs = new BlobsServer({ directory: DATA_DIR, token, port: 0 });
const { port: bport } = await blobs.start();
const edge = `http://127.0.0.1:${bport}`;
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, siteID: "self-hosted", token })).toString("base64");
globalThis.Netlify = { env: { get: k => process.env[k] } };

// Tests only: MD_TEST_FAKE_NOW pretends the real time is this instant, and lets it run on from there.
// It exists so scripts/api-test.mjs can test the event day guards on any day. Never set it for real use.
if (process.env.MD_TEST_FAKE_NOW) {
  const off = Date.parse(process.env.MD_TEST_FAKE_NOW) - Date.now();
  if (Number.isNaN(off)) throw new Error("MD_TEST_FAKE_NOW is not a date.");
  globalThis.__mdTestClock = () => Date.now() + off;
  console.warn(`Test clock: the server pretends the real time is ${process.env.MD_TEST_FAKE_NOW}.`);
}

// Load every function and its route from its exported config.
const fnDir = path.join(root, "netlify/functions");
const routes = [];
for (const f of (await fs.readdir(fnDir)).sort()) {
  if (!/\.m?js$/.test(f)) continue;
  const mod = await import(path.join(fnDir, f));
  for (const p of [].concat(mod.config.path)) {
    routes.push({ re: new RegExp("^" + p.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), handler: mod.default, methods: [].concat(mod.config.method || []) });
  }
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp4": "video/mp4", ".webm": "video/webm", ".json": "application/json", ".ico": "image/x-icon" };
const pub = path.join(root, "public");

async function serveStatic(req, res, url) {
  let p = path.normalize(path.join(pub, decodeURIComponent(url.pathname)));
  if (!p.startsWith(pub)) { res.writeHead(403); return res.end("Forbidden"); }
  try {
    let st = await fs.stat(p);
    if (st.isDirectory()) {
      if (!url.pathname.endsWith("/")) { res.writeHead(301, { location: url.pathname + "/" + url.search }); return res.end(); }
      p = path.join(p, "index.html"); st = await fs.stat(p);
    }
    const ext = path.extname(p).toLowerCase();
    // Assets are cached for a day, except the schedule, which can change without a new name.
    const cache = url.pathname.startsWith("/assets/") && url.pathname !== "/assets/day.js" ? "public, max-age=86400" : "no-cache";
    const headers = { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": cache };
    // Videos need range requests so the browser can seek and start fast.
    const range = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if (range && (ext === ".mp4" || ext === ".webm")) {
      const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
      res.writeHead(206, { ...headers, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": end - start + 1 });
      const fh = await fs.open(p); const stream = fh.createReadStream({ start, end }); stream.on("close", () => fh.close()); return stream.pipe(res);
    }
    res.writeHead(200, { ...headers, "content-length": st.size, "accept-ranges": "bytes" });
    if (req.method === "HEAD") return res.end();
    res.end(await fs.readFile(p));
  } catch { res.writeHead(404, { "content-type": "text/plain" }); res.end("Not found"); }
}

// LOCAL_CDN=1 (npm start and the Docker image set it) does here what the Netlify CDN does for answers that carry
// a CDN time: the same URL gets the same answer until that time is up, counted from the moment the answer started
// to be made, and never more than 60 seconds. State is the same for every client, so 100 phones cost about one
// state call a second instead of 100. Requests that come while a known public URL is being made wait for it.
// Immutable answers (photos) and team requests (x-pin) are never kept. npm run dev and the tests leave it off,
// so a write shows at once there.
const LOCAL_CDN = process.env.LOCAL_CDN === "1";
const CDN_MAX_S = 60;
const kept = new Map(); // url -> { res, start, until, pending }
function cdnSeconds(h) {
  const v = h["netlify-cdn-cache-control"] || h["cdn-cache-control"] || "";
  const m = /(?:s-maxage|max-age)=(\d+)/.exec(v);
  return m && !/immutable/.test(v) ? Math.min(+m[1], CDN_MAX_S) : 0;
}
function fromCdn(key, make) {
  const e = kept.get(key), now = Date.now();
  if (e && e.res && now < e.until) return { ...e.res, age: now - e.start };
  // A waiter whose shared answer is already older than its time makes its own.
  if (e && e.pending) return e.pending.then(r => (Date.now() - e.start < r.ttl * 1000 ? { ...r, age: Date.now() - e.start } : make()));
  const start = now;
  const p = make().then(r => {
    if (r.ttl > 0) kept.set(key, { res: r, start, until: start + r.ttl * 1000, pending: null });
    else kept.delete(key);
    return r;
  }, err => { kept.delete(key); throw err; });
  // Only a URL that answered with a CDN time before is shared while it is made, so private answers never are.
  if (e) { e.start = start; e.res = null; e.pending = p; }
  if (kept.size > 500) for (const [k, x] of kept) if (!x.pending && x.until < now) kept.delete(k);
  return p;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  for (const r of routes) {
    const m = url.pathname.match(r.re);
    if (!m) continue;
    if (r.methods.length && !r.methods.includes(req.method)) { res.writeHead(405); return res.end("Method not allowed"); }
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY) { res.writeHead(413); return res.end("Too large"); } chunks.push(c); }
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
    const make = async () => {
      const out = await r.handler(new Request(url, { method: req.method, headers: req.headers, body }), { params: m.groups || {} });
      // There is no Netlify CDN here, so its headers stay behind (cdn-cache-control is one of the CDN policies).
      const headers = Object.fromEntries(out.headers), ttl = out.status === 200 ? cdnSeconds(headers) : 0;
      for (const k of ["netlify-cdn-cache-control", "cdn-cache-control", "netlify-vary"]) delete headers[k];
      return { status: out.status, headers, body: Buffer.from(await out.arrayBuffer()), ttl };
    };
    try {
      const out = LOCAL_CDN && req.method === "GET" && !req.headers["x-pin"] ? await fromCdn(url.pathname + url.search, make) : await make();
      res.writeHead(out.status, out.age === undefined ? out.headers : { ...out.headers, age: String(Math.floor(out.age / 1000)) });
      res.end(out.body);
    } catch (e) { console.error(e); res.writeHead(500); res.end("Server error"); }
    return;
  }
  return serveStatic(req, res, url);
}).listen(PORT, () => console.log(`Mentorship Day Live on http://localhost:${PORT}  (screen: /screen/  remote: /remote/  data: ${DATA_DIR})`));
