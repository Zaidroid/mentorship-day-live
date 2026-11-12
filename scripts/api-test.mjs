// API test for the Mentorship Day server.
// Starts its own self hosted server on a free port with a temporary data folder, calls every
// route, and removes the folder at the end. It never touches port 8897 or dev/blobs.
//   npm run test:api
// The server runs with a test clock (MD_TEST_FAKE_NOW), so the date guards can be tested
// on any real day. Every response is recorded, and the last test checks that no response
// carries a device id.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { BlobsServer } from "@netlify/blobs/server";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIN = "test-pin-4821";
const BEFORE_DAY = "2026-11-13T12:00:00+02:00"; // Friday 13 November at noon, venue time
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- servers ---------- */
async function freePort() {
  const srv = net.createServer(); srv.listen(0, "127.0.0.1"); await once(srv, "listening");
  const { port } = srv.address(); srv.close(); await once(srv, "close"); return port;
}
const servers = [];
async function startServer(now = BEFORE_DAY) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "md26-api-test-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.mjs"], { cwd: ROOT, env: { ...process.env, REMOTE_PIN: PIN, PORT: String(port), DATA_DIR: dir, MD_TEST_FAKE_NOW: now }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; child.stdout.on("data", d => { out += d; }); child.stderr.on("data", d => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 150 && !up; i++) { try { up = (await fetch(base + "/api/state")).ok; } catch {} if (!up) await sleep(100); }
  if (!up) { child.kill(); throw new Error("The test server did not start:\n" + out); }
  const exited = once(child, "exit");
  let stopped = null;
  const s = { base, dir, child, out: () => out, stop() { return stopped || (stopped = (async () => { child.kill(); await exited; await fs.rm(dir, { recursive: true, force: true }); })()); } };
  servers.push(s); return s;
}
after(async () => { for (const s of servers) await s.stop(); if (direct) await direct.stop(); });

/* ---------- direct store access, on the same data folder as a server ---------- */
// A second local Blobs server on the same folder. Lets the tests read keys and make drift.
let direct = null, lib = null;
async function openDirect(dir) {
  if (direct) await direct.stop();
  const token = crypto.randomBytes(8).toString("hex");
  const bs = new BlobsServer({ directory: dir, token, port: 0 });
  const { port } = await bs.start();
  const edge = `http://127.0.0.1:${port}`;
  process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ edgeURL: edge, uncachedEdgeURL: edge, siteID: "self-hosted", token })).toString("base64");
  globalThis.Netlify = { env: { get: k => (k === "REMOTE_PIN" ? PIN : process.env[k]) } };
  direct = { stop: () => bs.stop() };
  if (!lib) lib = { store: await import("../netlify/lib/store.mjs"), day: await import("../netlify/lib/day.mjs") };
  return lib.store.st();
}

/* ---------- calls, all recorded for the device id scan ---------- */
const seen = [];
const DEVS = new Set();
function newDev() { const d = Array.from(crypto.randomBytes(12), b => (b % 36).toString(36)).join(""); DEVS.add(d); return d; }
async function call(base, method, url, { body, headers = {}, raw = false } = {}) {
  const h = { ...headers }; let b = body;
  if (body !== undefined && !raw) { b = JSON.stringify(body); if (!h["content-type"]) h["content-type"] = "application/json"; }
  const r = await fetch(base + url, { method, headers: h, body: b });
  const buf = Buffer.from(await r.arrayBuffer());
  const text = buf.toString("latin1");
  seen.push({ method, url, status: r.status, headers: [...r.headers].map(x => x.join(": ")).join("\n"), text });
  let json = null; try { json = JSON.parse(buf.toString("utf8")); } catch {}
  return { status: r.status, headers: r.headers, json, text, buf };
}
const opHeaders = (pin = PIN) => ({ "x-pin": pin, "x-who": "Test" });
const op = (base, body, pin) => call(base, "POST", "/api/op", { body, headers: opHeaders(pin) });
const opGet = (base, pin) => call(base, "GET", "/api/op", { headers: opHeaders(pin) });
const state = base => call(base, "GET", "/api/state");

let S; // the main server
before(async () => { S = await startServer(); });

/* ---------- update() ---------- */
describe("update helper", () => {
  test("20 concurrent updates on one key lose none", async () => {
    const s = await openDirect(S.dir);
    const { update } = lib.store;
    await Promise.all(Array.from({ length: 20 }, (_, i) => update(s, "test/counter", v => { v.n++; v.seen.push(i); }, { init: { n: 0, seen: [] } })));
    const v = await s.get("test/counter", { type: "json" });
    assert.equal(v.n, 20);
    assert.deepEqual([...v.seen].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i));
  });

  test("20 concurrent updates on an existing key lose none", async () => {
    const s = await openDirect(S.dir);
    const { update } = lib.store;
    await s.setJSON("test/list", { items: ["start"] });
    await Promise.all(Array.from({ length: 20 }, (_, i) => update(s, "test/list", v => { v.items.push("w" + i); })));
    const v = await s.get("test/list", { type: "json" });
    assert.equal(v.items.length, 21);
    for (let i = 0; i < 20; i++) assert.ok(v.items.includes("w" + i));
  });

  test("a write from another instance between read and write is retried, not lost", async () => {
    const s = await openDirect(S.dir);
    const { update } = lib.store;
    await s.setJSON("test/race", { a: 0, b: 0 });
    await sleep(20); // the local server's etag has millisecond resolution
    let calls = 0;
    const out = await update(s, "test/race", async v => {
      calls++;
      if (calls === 1) { await s.setJSON("test/race", { a: 0, b: 1 }); await sleep(5); }
      v.a = 1;
    });
    assert.equal(calls, 2);
    assert.deepEqual(out, { a: 1, b: 1 });
    assert.deepEqual(await s.get("test/race", { type: "json" }), { a: 1, b: 1 });
  });

  test("a key created by another instance first is retried, not overwritten", async () => {
    const s = await openDirect(S.dir);
    const { update } = lib.store;
    let calls = 0;
    const out = await update(s, "test/fresh", async v => {
      calls++;
      if (calls === 1) await s.setJSON("test/fresh", { list: ["other"] });
      v.list.push("mine");
    }, { init: { list: [] } });
    assert.equal(calls, 2);
    assert.deepEqual(out.list, ["other", "mine"]);
  });

  test("gives up after 6 tries and writes nothing of its own", async () => {
    const s = await openDirect(S.dir);
    const { update } = lib.store;
    await s.setJSON("test/busy", { n: 0 });
    let calls = 0;
    await assert.rejects(update(s, "test/busy", async v => { calls++; await sleep(3); await s.setJSON("test/busy", { n: calls }); await sleep(3); v.mine = true; }), /too many/);
    assert.equal(calls, 6);
    assert.equal((await s.get("test/busy", { type: "json" })).mine, undefined);
  });

  test("a refusal inside the change writes nothing", async () => {
    const s = await openDirect(S.dir);
    const { update, Refuse } = lib.store;
    await s.setJSON("test/refuse", { n: 1 });
    await assert.rejects(update(s, "test/refuse", v => { v.n = 2; throw new Refuse(409, "No."); }), /No\./);
    assert.deepEqual(await s.get("test/refuse", { type: "json" }), { n: 1 });
  });

  test("20 concurrent operator changes to the config all land", async () => {
    const words = Array.from({ length: 20 }, (_, i) => "word" + i);
    const res = await Promise.all(words.map(w => op(S.base, { action: "hideWord", word: w })));
    for (const r of res) assert.equal(r.status, 200, r.text);
    const g = await opGet(S.base);
    for (const w of words) assert.ok(g.json.cfg.hidden.includes(w), w);
  });
});
