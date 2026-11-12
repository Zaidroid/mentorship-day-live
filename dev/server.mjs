// Local test server: static files from public/ plus the Netlify functions, backed by a local Blobs server.
// Usage: node dev/server.mjs [port]
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BlobsServer } from "@netlify/blobs/server";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = +process.argv[2] || 8899;
const blobs = new BlobsServer({ directory: path.join(root, "dev/blobs"), token: "local", port: 0 });
const { port: bport } = await blobs.start();
const ctx = { edgeURL: `http://localhost:${bport}`, uncachedEdgeURL: `http://localhost:${bport}`, siteID: "local", token: "local" };
process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify(ctx)).toString("base64");
process.env.REMOTE_PIN = process.env.REMOTE_PIN || "123456";
globalThis.Netlify = { env: { get: k => process.env[k] } };

const fnDir = path.join(root, "netlify/functions");
const routes = [];
for (const f of await fs.readdir(fnDir)) {
  if (!f.endsWith(".mjs")) continue;
  const mod = await import(path.join(fnDir, f));
  for (const p of [].concat(mod.config.path)) routes.push({ pattern: new RegExp("^" + p.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$"), handler: mod.default, methods: mod.config.method });
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".json": "application/json" };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  for (const r of routes) {
    const m = url.pathname.match(r.pattern);
    if (!m) continue;
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
    const request = new Request(url, { method: req.method, headers: req.headers, body });
    try {
      const out = await r.handler(request, { params: m.groups || {} });
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
    } catch (e) { console.error(e); res.writeHead(500); res.end(String(e)); }
    return;
  }
  let p = path.join(root, "public", decodeURIComponent(url.pathname));
  try { if ((await fs.stat(p)).isDirectory()) p = path.join(p, "index.html"); const data = await fs.readFile(p); res.writeHead(200, { "content-type": TYPES[path.extname(p)] || "application/octet-stream" }); res.end(data); }
  catch { res.writeHead(404); res.end("Not found"); }
}).listen(PORT, () => console.log(`dev server on http://localhost:${PORT}`));
