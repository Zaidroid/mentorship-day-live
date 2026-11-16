// API test for the Mentorship Day server.
// Starts its own self hosted server on a free port with a temporary data folder, calls every
// route, and removes the folder at the end. It never touches port 8897 or dev/blobs.
//   npm run test:api
// The server runs with a test clock (MD_TEST_FAKE_NOW), so the date guards can be tested
// on any real day. Every response is recorded, and the last test checks that no response
// carries a device id.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
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
const ALL_FLAGS = { trustProfiles: true, trustTakeaways: true, trustPhotos: false, hello: true, picks: true, meet: true, takeaways: true };

/* ---------- servers ---------- */
async function freePort() {
  const srv = net.createServer(); srv.listen(0, "127.0.0.1"); await once(srv, "listening");
  const { port } = srv.address(); srv.close(); await once(srv, "close"); return port;
}
const servers = [];
// A free port can be taken by another process between the check and the listen, so a failed start is retried.
async function startServer(now = BEFORE_DAY, env = {}) {
  for (let i = 1; ; i++) {
    try { return await startServerOnce(now, env); }
    catch (e) { if (i >= 3 || !/EADDRINUSE/.test(e.message)) throw e; }
  }
}
async function startServerOnce(now, extraEnv) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "md26-api-test-"));
  const port = await freePort();
  const child = spawn(process.execPath, ["server/index.mjs"], { cwd: ROOT, env: { ...process.env, REMOTE_PIN: PIN, PORT: String(port), DATA_DIR: dir, MD_TEST_FAKE_NOW: now, LOCAL_CDN: "0", ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; child.stdout.on("data", d => { out += d; }); child.stderr.on("data", d => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  let up = false, gone = false;
  child.once("exit", () => { gone = true; });
  for (let i = 0; i < 150 && !up && !gone; i++) { try { up = (await fetch(base + "/api/state")).ok; } catch {} if (!up) await sleep(100); }
  if (!up) { child.kill(); await fs.rm(dir, { recursive: true, force: true }); throw new Error("The test server did not start:\n" + out); }
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
  if (!lib) lib = { store: await import("../netlify/lib/store.mjs"), ids: await import("../netlify/lib/ids.mjs"), day: await import("../netlify/lib/day.mjs"), rules: await import("../netlify/lib/rules.mjs"), people: await import("../netlify/lib/people.mjs") };
  return lib.store.st();
}

/* ---------- calls, all recorded for the device id scan ---------- */
const seen = [];
const DEVS = new Set();
const IMPORTED = []; // every people row the tests imported, for the person record scan at the end
function newDev() { const d = Array.from(crypto.randomBytes(12), b => (b % 36).toString(36)).join(""); DEVS.add(d); return d; }
async function call(base, method, url, { body, headers = {}, raw = false } = {}) {
  const h = { ...headers }; let b = body;
  if (body && body.action === "peopleImport" && Array.isArray(body.people)) IMPORTED.push(...body.people.filter(r => r && typeof r === "object" && /^\d{4}$/.test(r.last4 || "") && r.name));
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
// The main server holds poll p1 open, as the remote would; the schedule has its own tests.
before(async () => { S = await startServer(); await op(S.base, { action: "pollActivate", pid: "p1" }); });

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

/* ---------- ids ---------- */
describe("ids", () => {
  test("guest ids are keyed hashes of the device id, never the device id", async () => {
    await openDirect(S.dir);
    const { guestPub, pubOk } = lib.ids;
    const a = newDev(), b = newDev();
    assert.match(guestPub(a), /^g[a-f0-9]{10}$/);
    assert.ok(pubOk(guestPub(a)));
    assert.equal(guestPub(a), guestPub(a));
    assert.notEqual(guestPub(a), guestPub(b));
    assert.ok(!guestPub(a).includes(a));
    const before = guestPub(a);
    globalThis.Netlify = { env: { get: () => "another-pin" } };
    assert.notEqual(guestPub(a), before, "the secret comes from the PIN");
    globalThis.Netlify = { env: { get: k => (k === "REMOTE_PIN" ? PIN : process.env[k]) } };
  });

  test("person ids ignore case, spacing, accents and Arabic letter variants", async () => {
    await openDirect(S.dir);
    const { personId, personPub, normName, pubOk } = lib.ids;
    assert.equal(normName("  Layla   KHOURY "), "layla khoury");
    assert.equal(normName("Lâyla Khoúry"), "layla khoury");
    assert.equal(normName("أحمد"), normName("احمد"));
    assert.equal(normName("مُحَمَّد"), normName("محمد"));
    assert.equal(normName("محـــمد"), normName("محمد"));
    assert.equal(normName("فاطمة"), normName("فاطمه"));
    assert.equal(personId("Layla Khoury", "1234"), personId("layla  khoury", "1234"));
    assert.notEqual(personId("Layla Khoury", "1234"), personId("Layla Khoury", "1235"));
    assert.ok(pubOk(personPub(personId("Layla Khoury", "1234"))));
    assert.ok(!pubOk("x0123456789") && !pubOk("g0123") && !pubOk("gABCDEF0123"));
  });
});

/* ---------- profiles by public id ---------- */
describe("profiles", () => {
  const card = { name: "Layla Khoury", company: "Byte Studio", role: "Founder", looking: ["Funding"], offer: ["Product"], linkedin: "linkedin.com/in/test-layla", consent: true };
  let dev, pub;
  test("a new card is stored under the public id and waits", async () => {
    await openDirect(S.dir);
    dev = newDev(); pub = lib.ids.guestPub(dev);
    const r = await call(S.base, "POST", "/api/profile", { body: card, headers: { "x-dev": dev } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { ok: true, status: "pending", id: pub });
    const g = await call(S.base, "GET", "/api/profile", { headers: { "x-dev": dev } });
    assert.equal(g.json.status, "pending"); assert.equal(g.json.id, pub); assert.equal(g.json.profile.linkedin, "https://linkedin.com/in/test-layla");
    const s = await openDirect(S.dir);
    assert.ok(await s.get(`pr/${pub}`, { type: "json" }));
    assert.equal(await s.get(`pr/${dev}`), null);
    const o = await opGet(S.base);
    assert.ok(o.json.pending.profiles.some(p => p.id === pub && p.name === "Layla Khoury"));
  });

  test("the body may carry the device id, as version 1 phones send it", async () => {
    const d2 = newDev();
    const r = await call(S.base, "POST", "/api/profile", { body: { ...card, name: "Omar Saleh", dev: d2 } });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.id, lib.ids.guestPub(d2));
    await op(S.base, { action: "rejectProfile", id: r.json.id });
  });

  test("approve, edit, decline and remove take the public id", async () => {
    assert.equal((await op(S.base, { action: "approveProfile", id: dev })).status, 400, "a device id is not a profile id");
    assert.equal((await op(S.base, { action: "approveProfile", id: "gzzzz" })).status, 400);
    const a = await op(S.base, { action: "approveProfile", id: pub });
    assert.equal(a.status, 200, a.text);
    let o = await opGet(S.base);
    assert.ok(o.json.snap.profiles.some(p => p.id === pub));
    assert.ok(!o.json.pending.profiles.some(p => p.id === pub));
    assert.equal((await call(S.base, "GET", "/api/profile", { headers: { "x-dev": dev } })).json.status, "approved");
    // an edit takes the card off the board until it is approved again
    await call(S.base, "POST", "/api/profile", { body: { ...card, role: "CEO" }, headers: { "x-dev": dev } });
    o = await opGet(S.base);
    assert.ok(!o.json.snap.profiles.some(p => p.id === pub));
    assert.ok(o.json.pending.profiles.some(p => p.id === pub && p.role === "CEO"));
    await op(S.base, { action: "rejectProfile", id: pub });
    assert.equal((await call(S.base, "GET", "/api/profile", { headers: { "x-dev": dev } })).json.status, "declined");
    await call(S.base, "POST", "/api/profile", { body: card, headers: { "x-dev": dev } });
    await op(S.base, { action: "approveProfile", id: pub });
    await op(S.base, { action: "hideProfile", id: pub });
    o = await opGet(S.base);
    assert.ok(!o.json.snap.profiles.some(p => p.id === pub));
  });

  test("refusals", async () => {
    const d = newDev(), post = (body, h = { "x-dev": d }) => call(S.base, "POST", "/api/profile", { body, headers: h });
    assert.equal((await post(card, {})).status, 400);
    assert.equal((await post(card, { "x-dev": "short" })).status, 400);
    assert.equal((await post({ ...card, name: "L" })).json.error, "Add your name.");
    assert.equal((await post({ ...card, consent: false })).status, 400);
    assert.equal((await post({ ...card, linkedin: "example.com/me" })).json.error, "That LinkedIn link does not look right.");
    assert.equal((await post({ ...card, looking: [], offer: ["Nope"] })).json.error, "Pick at least one tag.");
    assert.equal((await post({ ...card, company: "shit corp" })).status, 422);
    assert.equal((await call(S.base, "POST", "/api/profile", { body: "{", raw: true, headers: { "x-dev": d, "content-type": "application/json" } })).status, 400);
    assert.deepEqual((await call(S.base, "GET", "/api/profile")).json, { status: "none" });
    const none = await call(S.base, "GET", "/api/profile", { headers: { "x-dev": newDev() } });
    assert.equal(none.json.status, "none"); assert.match(none.json.id, /^g[a-f0-9]{10}$/);
  });
});

/* ---------- state and snap ---------- */
const JPEG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const upload = (base, dev, extra = {}) => call(base, "POST", "/api/photo", { body: extra.body || JPEG, raw: true, headers: { "content-type": "image/jpeg", "x-dev": dev, "x-name": encodeURIComponent(extra.name || "Test Photographer"), "x-caption": encodeURIComponent(extra.caption || "Coffee in the Main Hall"), ...(extra.headers || {}) } });
const snapOf = async base => { const st = await state(base); return (await call(base, "GET", "/api/snap?v=" + st.json.snapV)).json; };

describe("state", () => {
  test("has the documented shape, and nothing private", async () => {
    await call(S.base, "POST", "/api/answer", { body: { pid: "p1", text: "clarity" }, headers: { "x-dev": newDev() } });
    await op(S.base, { action: "hideWord", word: "secretword" });
    await call(S.base, "POST", "/api/answer", { body: { pid: "p1", text: "secretword" }, headers: { "x-dev": newDev() } });
    const r = await state(S.base);
    assert.equal(r.status, 200);
    const d = r.json;
    assert.deepEqual(Object.keys(d).sort(), ["cfg", "hello", "interest", "n", "phase", "poll", "reh", "rx", "snapV", "t", "tags", "videos"]);
    assert.deepEqual(Object.keys(d.cfg).sort(), ["ann", "at", "finale", "flags", "links", "mode", "overlay", "photoAt", "pin", "reloadAt", "speaker", "theme", "video", "way"]);
    assert.ok(!r.text.includes("secretword"), "hidden words never leave the server");
    assert.ok(!r.text.includes("rehearsal") && !r.text.includes("hidden"));
    assert.deepEqual(Object.keys(d.poll).sort(), ["id", "manual", "open", "options", "q", "total", "type", "words"]);
    assert.equal(d.poll.manual, true);
    assert.ok(d.poll.words.some(([w]) => w === "clarity"));
    assert.deepEqual(d.cfg.flags, ALL_FLAGS);
    assert.equal(d.reh, false); assert.equal(d.phase, "before");
    assert.ok(Math.abs(d.t - Date.parse(BEFORE_DAY)) < 10 * 60 * 1000, "t follows the server clock");
    assert.equal(d.rx.on, false); assert.equal(d.rx.total, 0); assert.equal(d.rx.b.length, 2);
    assert.equal(d.rx.b[0][0], Math.floor(d.t / 4000)); assert.equal(d.rx.b[1][0], d.rx.b[0][0] - 1);
    assert.deepEqual(d.rx.b.map(x => x.slice(1)), [[0, 0, 0], [0, 0, 0]]);
    assert.deepEqual(Object.keys(d.n).sort(), ["answers", "board", "here", "links", "photos", "takeaways"]);
    assert.ok(d.n.answers >= 2); assert.equal(d.n.here, 0); assert.equal(d.n.links, 0);
    assert.deepEqual(d.interest, {}); assert.deepEqual(d.hello, []);
    assert.match(d.snapV, /^\d+\.\d+$/);
    assert.ok(d.tags.includes("Funding"));
    assert.deepEqual(d.videos.map(v => v.id), ["gsg"]);
    assert.equal(r.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    await op(S.base, { action: "showWord", word: "secretword" });
  });

  test("on Netlify the CDN keeps state for 2 seconds", async () => {
    await openDirect(S.dir);
    const fn = (await import("../netlify/functions/state.mjs")).default;
    const r = await fn(new Request("http://localhost/api/state"));
    assert.match(r.headers.get("netlify-cdn-cache-control"), /s-maxage=2\b/);
    assert.equal(r.headers.get("x-md-cache"), lib.store.CDN_POLICY + "2");
  });
});

/* ---------- the CDN policy and its probe (plan section 5.12) ---------- */
describe("cdn", () => {
  test("every candidate policy has its own headers, chosen in one place", async () => {
    await openDirect(S.dir);
    const { CDN, CDN_POLICIES } = lib.store;
    assert.deepEqual(Object.keys(CDN_POLICIES), ["a", "b", "c", "d", "e"]);
    assert.deepEqual(CDN(2, { policy: "a" }), { "cache-control": "public, max-age=0, must-revalidate", "netlify-cdn-cache-control": "public, durable, s-maxage=2, stale-while-revalidate=10", "x-md-cache": "a2" });
    assert.equal(CDN(5, { policy: "b" })["netlify-cdn-cache-control"], "public, durable, max-age=5, stale-while-revalidate=25");
    assert.equal(CDN(5, { policy: "c" })["cache-control"], "public, max-age=0");
    assert.equal(CDN(5, { policy: "d" })["netlify-cdn-cache-control"], "s-maxage=5,stale-while-revalidate=25,durable");
    const e = CDN(5, { policy: "e" });
    assert.equal(e["cdn-cache-control"], "public, durable, s-maxage=5, stale-while-revalidate=25"); assert.equal(e["netlify-cdn-cache-control"], undefined);
    assert.equal(CDN(3600, { browser: 3600, vary: "query=v", policy: "b" })["cache-control"], "public, max-age=3600");
    assert.equal(CDN(9, { policy: "nope" })["x-md-cache"], "a9");
    assert.match(CDN(60, { immutable: true })["cache-control"], /immutable/);
  });

  test("the probe answers each policy, writes nothing, and refuses the rest", async () => {
    const s = await openDirect(S.dir);
    const before = (await s.list()).blobs.length;
    const r = await call(S.base, "GET", "/api/cdn-probe?p=b&s=5");
    assert.equal(r.status, 200); assert.equal(r.json.p, "b"); assert.equal(r.json.s, 5);
    assert.equal(r.headers.get("x-md-cache"), "b5");
    assert.equal(r.headers.get("netlify-cdn-cache-control"), null, "the self hosted server strips the CDN headers");
    const fn = (await import("../netlify/functions/cdn-probe.mjs")).default;
    const d = await fn(new Request("http://localhost/api/cdn-probe?p=e&s=3"));
    assert.equal(d.headers.get("cdn-cache-control"), "public, durable, s-maxage=3, stale-while-revalidate=15");
    for (const q of ["?p=z", "?p=__proto__", "?s=0", "?s=61", "?s=x"]) assert.equal((await call(S.base, "GET", "/api/cdn-probe" + q)).status, 400, q);
    assert.equal((await call(S.base, "POST", "/api/cdn-probe", { body: {} })).status, 405);
    assert.equal((await s.list()).blobs.length, before);
  });
});

/* ---------- the self hosted server with LOCAL_CDN=1 (npm start, Docker) ---------- */
describe("self hosted cdn cache", () => {
  test("keeps an answer for the CDN time it advertises and never longer, and makes it once for many callers", async () => {
    const C = await startServer(BEFORE_DAY, { LOCAL_CDN: "1" });
    try {
      // The server's clock against ours, from the team answer, which is never kept.
      const t0 = Date.now(), g1 = await opGet(C.base), skew = g1.json.t - (t0 + Date.now()) / 2;
      const g2 = await opGet(C.base);
      assert.notEqual(g1.json.t, g2.json.t, "team answers are made fresh every time");
      const a = await state(C.base), b = await state(C.base);
      assert.equal(b.text, a.text, "a second read within the time gets the same answer");
      assert.equal(b.headers.get("x-md-cache"), "a2"); assert.equal(b.headers.get("netlify-cdn-cache-control"), null);
      // Reads for 5 seconds: no answer is older than 2 seconds, and a change shows within 2 seconds.
      const sent = Date.now();
      await op(C.base, { action: "ann", text: "Cache test", secs: 20 });
      const ages = [], made = new Set(); let shown = 0;
      while (Date.now() - sent < 5000) {
        const r = await state(C.base);
        ages.push(Date.now() + skew - r.json.t); made.add(r.json.t);
        if (!shown && r.json.cfg.ann && r.json.cfg.ann.text === "Cache test") shown = Date.now();
        await sleep(80);
      }
      assert.ok(shown && shown - sent <= 2150, "the change showed within 2 seconds: " + (shown - sent));
      assert.ok(Math.max(...ages) < 2100, "oldest answer served (ms): " + Math.round(Math.max(...ages)));
      assert.ok(made.size >= 2 && made.size <= 4, "made about once per 2 seconds: " + made.size);
      // 30 requests at once after the time is up: one answer made for all of them
      await sleep(2100);
      const many = await Promise.all(Array.from({ length: 30 }, () => state(C.base)));
      assert.ok(new Set(many.map(r => r.json.t)).size <= 2, "made once or twice for 30 callers: " + new Set(many.map(r => r.json.t)).size);
      // While reactions are on, state advertises 1 second and is kept 1 second.
      await op(C.base, { action: "rx", mode: "on" });
      await sleep(2100);
      const ages1 = [];
      for (let end = Date.now() + 2500; Date.now() < end; await sleep(60)) { const r = await state(C.base); assert.equal(r.headers.get("x-md-cache"), "a1"); ages1.push(Date.now() + skew - r.json.t); }
      assert.ok(Math.max(...ages1) < 1100, "oldest answer while reactions are on (ms): " + Math.round(Math.max(...ages1)));
      // A phone's own answer is never kept.
      const dev = newDev(), m1 = await call(C.base, "GET", "/api/me", { headers: { "x-dev": dev } });
      await call(C.base, "POST", "/api/guest", { body: { name: "Cache Guest", hello: false }, headers: { "x-dev": dev } });
      const m2 = await call(C.base, "GET", "/api/me", { headers: { "x-dev": dev } });
      assert.equal(m1.json.status, "none"); assert.equal(m2.json.status, "guest");
    } finally { await C.stop(); }
  });

  test("without LOCAL_CDN, as in npm run dev and these tests, every read is made fresh", async () => {
    const a = await state(S.base); await sleep(5); const b = await state(S.base);
    assert.notEqual(a.json.t, b.json.t);
  });
});

describe("photos and the snapshot", () => {
  let id, dev;
  test("an upload waits, and only the team sees it", async () => {
    dev = newDev();
    const r = await upload(S.base, dev);
    assert.equal(r.status, 200, r.text); id = r.json.id;
    const pub = await call(S.base, "GET", "/api/photo/" + id);
    assert.equal(pub.status, 404); assert.equal(pub.headers.get("x-content-type-options"), "nosniff");
    const team = await call(S.base, "GET", "/api/photo/" + id, { headers: { "x-pin": PIN } });
    assert.equal(team.status, 200); assert.equal(team.headers.get("content-type"), "image/jpeg");
    assert.equal(team.headers.get("cache-control"), "no-store"); assert.equal(team.headers.get("x-content-type-options"), "nosniff");
    const s = await openDirect(S.dir);
    const m = (await s.getMetadata("ph/" + id)).metadata;
    assert.equal(m.pub, lib.ids.guestPub(dev)); assert.equal(m.dev, undefined);
    assert.ok((await opGet(S.base)).json.pending.photos.some(p => p.id === id));
  });

  test("approval changes the snapshot version and adds one photo", async () => {
    const v0 = (await state(S.base)).json.snapV;
    assert.equal((await op(S.base, { action: "approvePhoto", id })).status, 200);
    const st1 = await state(S.base);
    assert.notEqual(st1.json.snapV, v0);
    assert.ok(st1.json.n.photos >= 1);
    const sn = await call(S.base, "GET", "/api/snap?v=" + st1.json.snapV);
    assert.deepEqual(Object.keys(sn.json).sort(), ["at", "links", "photos", "profiles", "takeaways", "v"]);
    assert.equal(sn.json.v, st1.json.snapV);
    assert.deepEqual(sn.json.photos.find(p => p.id === id), { id, name: "Test Photographer", caption: "Coffee in the Main Hall", at: sn.json.photos.find(p => p.id === id).at });
    assert.equal(sn.headers.get("cache-control"), "public, max-age=3600");
    const old = await call(S.base, "GET", "/api/snap?v=" + v0);
    assert.equal(old.headers.get("cache-control"), "no-store", "a stale version is answered but not cached");
    assert.equal(old.json.v, st1.json.snapV);
    const img = await call(S.base, "GET", "/api/photo/" + id);
    assert.equal(img.status, 200); assert.match(img.headers.get("cache-control"), /immutable/); assert.equal(img.headers.get("x-content-type-options"), "nosniff");
  });

  test("on Netlify the snapshot is cached for an hour, keyed on v only", async () => {
    await openDirect(S.dir);
    const fn = (await import("../netlify/functions/snap.mjs")).default;
    const v = (await state(S.base)).json.snapV;
    const r = await fn(new Request("http://localhost/api/snap?v=" + v));
    assert.match(r.headers.get("netlify-cdn-cache-control"), /s-maxage=3600/);
    assert.equal(r.headers.get("netlify-vary"), "query=v");
    const r2 = await fn(new Request("http://localhost/api/snap?v=1.0"));
    assert.equal(r2.headers.get("netlify-cdn-cache-control"), null);
  });

  test("approved profiles are in the snapshot by public id", async () => {
    const d = newDev();
    const p = await call(S.base, "POST", "/api/profile", { body: { name: "Rana Odeh", company: "Nablus Tech", role: "Marketing Lead", looking: ["Partnerships"], offer: ["Marketing"], consent: true }, headers: { "x-dev": d } });
    const at = (await opGet(S.base)).json.pending.profiles.find(x => x.id === p.json.id).at;
    assert.equal((await op(S.base, { action: "approveProfile", id: p.json.id, at: at + 1 })).status, 409, "a card that changed is not approved");
    assert.equal((await op(S.base, { action: "approveProfile", id: p.json.id, at })).status, 200);
    const sn = await snapOf(S.base);
    const item = sn.profiles.find(x => x.id === p.json.id);
    assert.deepEqual(Object.keys(item).sort(), ["at", "company", "id", "linkedin", "looking", "name", "offer", "role"]);
    assert.equal((await state(S.base)).json.n.board, sn.profiles.length);
  });

  test("remove and decline take the photo off the snapshot", async () => {
    await op(S.base, { action: "hidePhoto", id });
    assert.ok(!(await snapOf(S.base)).photos.some(p => p.id === id));
    assert.equal((await call(S.base, "GET", "/api/photo/" + id)).status, 404);
    const r2 = await upload(S.base, dev, { caption: "Room A session" });
    await op(S.base, { action: "approvePhoto", id: r2.json.id });
    await op(S.base, { action: "rejectPhoto", id: r2.json.id });
    assert.ok(!(await snapOf(S.base)).photos.some(p => p.id === r2.json.id));
    assert.equal((await call(S.base, "GET", "/api/photo/" + r2.json.id, { headers: { "x-pin": PIN } })).status, 404, "a declined photo is deleted");
  });

  test("refusals", async () => {
    const d = newDev();
    assert.equal((await op(S.base, { action: "approvePhoto", id: "nosuchphoto1" })).status, 404);
    assert.equal((await op(S.base, { action: "approvePhoto", id: "../x" })).status, 400);
    assert.equal((await upload(S.base, "bad")).status, 400);
    assert.equal((await upload(S.base, d, { headers: { "content-type": "text/html" } })).status, 415);
    assert.equal((await upload(S.base, d, { body: Buffer.alloc(0) })).status, 400);
    assert.equal((await upload(S.base, d, { body: Buffer.alloc(4 * 1024 * 1024 + 10) })).status, 413);
    assert.equal((await upload(S.base, d, { caption: "porn" })).status, 422);
    assert.equal((await call(S.base, "GET", "/api/photo/..%2Fcfg")).status, 404);
    const many = newDev();
    for (let i = 0; i < 12; i++) assert.equal((await upload(S.base, many)).status, 200);
    assert.equal((await upload(S.base, many)).status, 429);
  });
});

describe("answers", () => {
  test("one answer per phone per poll, a new one replaces it", async () => {
    const d = newDev(), ans = (body, h = { "x-dev": d }) => call(S.base, "POST", "/api/answer", { body, headers: h });
    const t0 = (await state(S.base)).json.poll.total;
    assert.equal((await ans({ pid: "p1", text: "Momentum!" })).json.word, "momentum");
    assert.equal((await ans({ pid: "p1", text: "focus" })).status, 200);
    const p = (await state(S.base)).json.poll;
    assert.equal(p.total, t0 + 1);
    assert.ok(p.words.some(([w]) => w === "focus") && !p.words.some(([w]) => w === "momentum"));
    assert.equal((await ans({ pid: "p1", text: "x", dev: newDev() }, {})).status, 200, "version 1 phones send dev in the body");
    assert.equal((await ans({ pid: "p2", text: "Funding" })).status, 409);
    assert.equal((await ans({ pid: "p1", text: "  " })).status, 400);
    assert.equal((await ans({ pid: "p1", text: "shit" })).status, 422);
    assert.equal((await ans({ pid: "p1", text: "ok" }, {})).status, 400);
    await op(S.base, { action: "pollActivate", pid: "p2" });
    assert.equal((await ans({ pid: "p2", text: "Nope" })).status, 400);
    assert.equal((await ans({ pid: "p2", text: "Funding" })).status, 200);
    await op(S.base, { action: "pollClose" });
    assert.equal((await ans({ pid: "p2", text: "Funding" })).status, 409);
    await op(S.base, { action: "pollActivate", pid: "p1" });
  });
});

/* ---------- clock, phase and rehearsal ---------- */
describe("clock", () => {
  test("venue time and phase come from Asia/Hebron, with the right offset in winter and summer", async () => {
    await openDirect(S.dir);
    const { localDate, localMin, localToMs, phase, fmtMin } = lib.day;
    const at = iso => Date.parse(iso);
    assert.equal(localToMs("2026-11-17", "10:55"), at("2026-11-17T08:55:00Z"));
    assert.equal(localToMs("2026-07-01", "12:00"), at("2026-07-01T09:00:00Z"));
    assert.equal(localDate(at("2026-11-16T22:00:00Z")), "2026-11-17");
    assert.equal(fmtMin(localMin(at("2026-11-17T07:30:00Z"))), "09:30");
    assert.equal(phase(at("2026-11-16T12:00:00Z")), "before");
    assert.equal(phase(at("2026-11-17T06:59:59Z")), "before");
    assert.equal(phase(at("2026-11-17T07:00:00Z")), "day");
    assert.equal(phase(at("2026-11-17T12:59:59Z")), "day");
    assert.equal(phase(at("2026-11-17T13:00:00Z")), "after");
    assert.equal(phase(at("2026-11-18T08:00:00Z")), "after");
  });

  test("a rehearsal counts only until it ends, and never on the real event day", async () => {
    await openDirect(S.dir);
    const { nowMs, rehearsalOn, rehearsalFor, localDate } = lib.day;
    const real = Date.parse("2026-11-13T10:00:00Z");
    globalThis.__mdTestClock = () => real;
    try {
      const cfg = { rehearsal: rehearsalFor("09:40", real) };
      assert.ok(rehearsalOn(cfg)); assert.equal(nowMs(cfg), Date.parse("2026-11-17T07:40:00Z"));
      cfg.rehearsal.until = real - 1;
      assert.ok(!rehearsalOn(cfg)); assert.equal(nowMs(cfg), real);
      const onDay = Date.parse("2026-11-17T06:00:00Z");
      const c2 = { rehearsal: rehearsalFor("12:00", onDay - 3600e3) };
      globalThis.__mdTestClock = () => onDay;
      assert.equal(localDate(onDay), "2026-11-17"); assert.ok(!rehearsalOn(c2)); assert.equal(nowMs(c2), onDay);
    } finally { delete globalThis.__mdTestClock; }
  });

  test("op rehearsal moves t, phase and reh for everyone, and stops", async () => {
    await openDirect(S.dir);
    const { localDate, localMin } = lib.day;
    assert.equal((await op(S.base, { action: "rehearsal", hhmm: "10:55" })).status, 200);
    let d = (await state(S.base)).json;
    assert.equal(d.reh, true); assert.equal(d.phase, "day");
    assert.equal(localDate(d.t), "2026-11-17");
    assert.ok(Math.abs(localMin(d.t) - (10 * 60 + 55)) < 1, "the clock reads 10:55 on the day");
    assert.ok(!JSON.stringify(d.cfg).includes("shift"));
    const g = await opGet(S.base);
    assert.equal(g.json.reh, true); assert.equal(g.json.cfg.rehearsal.hhmm, "10:55");
    // announcements and videos carry times in the same clock as t
    await op(S.base, { action: "ann", text: "Rehearsal check", secs: 10 });
    await op(S.base, { action: "video", id: "gsg" });
    d = (await state(S.base)).json;
    assert.ok(Math.abs(d.cfg.ann.at - d.t) < 5000 && Math.abs(d.cfg.video.at - d.t) < 5000);
    await op(S.base, { action: "ann", text: "" }); await op(S.base, { action: "video", id: null });
    // Reset screen controls keeps the rehearsal
    await op(S.base, { action: "reset" });
    assert.equal((await state(S.base)).json.reh, true);
    assert.equal((await op(S.base, { action: "rehearsal", hhmm: null })).status, 200);
    d = (await state(S.base)).json;
    assert.equal(d.reh, false); assert.equal(d.phase, "before");
    assert.ok(Math.abs(d.t - Date.parse(BEFORE_DAY)) < 10 * 60 * 1000);
    for (const hhmm of ["25:00", "1055", "10:5", undefined, 1055]) assert.equal((await op(S.base, { action: "rehearsal", hhmm })).status, 400, String(hhmm));
  });
});

/* ---------- the event day guards, on servers with their own clock ---------- */
describe("event day guards", () => {
  test("07:30 on the day: no rehearsal, a stored one is ignored, wipe still allowed", async () => {
    const E = await startServer("2026-11-17T07:30:00+02:00");
    const r = await op(E.base, { action: "rehearsal", hhmm: "10:00" });
    assert.equal(r.status, 409); assert.equal(r.json.error, "A rehearsal cannot start on the day of the event.");
    const s = await openDirect(E.dir);
    await s.setJSON("cfg", { rehearsal: { shift: 3 * 3600e3, until: Date.now() + 3600e3, hhmm: "10:30", at: Date.now() } });
    const d = (await state(E.base)).json;
    assert.equal(d.reh, false); assert.equal(d.phase, "before");
    assert.ok(Math.abs(d.t - Date.parse("2026-11-17T07:30:00+02:00")) < 5 * 60 * 1000);
    assert.equal((await op(E.base, { action: "wipe", phrase: "RESET MD26" })).status, 200);
    await E.stop();
  });

  test("10:00 on the day: wipe is refused", async () => {
    const E = await startServer("2026-11-17T10:00:00+02:00");
    const r = await op(E.base, { action: "wipe", phrase: "RESET MD26" });
    assert.equal(r.status, 409); assert.equal(r.json.error, "Wiping is blocked between 08:00 and 16:00 on the day of the event.");
    assert.equal((await state(E.base)).json.phase, "day");
    await E.stop();
  });

  test("16:00 on the day: wipe is allowed again, and the phase is after", async () => {
    const E = await startServer("2026-11-17T16:00:00+02:00");
    assert.equal((await op(E.base, { action: "wipe", phrase: "RESET MD26" })).status, 200);
    assert.equal((await state(E.base)).json.phase, "after");
    await E.stop();
    await openDirect(S.dir);
  });
});

/* ---------- reload, flags, repair, beat ---------- */
describe("operator tools", () => {
  test("GET /api/op carries the counts and the reaction total of state, so the remote needs one request", async () => {
    const g = (await opGet(S.base)).json, st = (await state(S.base)).json;
    assert.deepEqual(Object.keys(g.n).sort(), ["answers", "board", "here", "links", "photos", "takeaways"]);
    assert.deepEqual(g.n, st.n);
    assert.deepEqual(g.rx, { on: st.rx.on, total: st.rx.total });
    assert.ok(g.n.answers > 0, "the counts are real");
  });

  test("reload grows reloadAt every time", async () => {
    const r0 = (await state(S.base)).json.cfg.reloadAt;
    await op(S.base, { action: "reload" });
    const r1 = (await state(S.base)).json.cfg.reloadAt;
    await op(S.base, { action: "reload" });
    const r2 = (await state(S.base)).json.cfg.reloadAt;
    assert.ok(r1 > r0 && r2 > r1);
    await op(S.base, { action: "reset" });
    assert.equal((await state(S.base)).json.cfg.reloadAt, r2, "Reset screen controls never makes the wall reload");
  });

  test("flags switch only known features, with a real on or off", async () => {
    assert.equal((await op(S.base, { action: "flags", name: "trustPhotos", on: true })).status, 200);
    assert.equal((await state(S.base)).json.cfg.flags.trustPhotos, true);
    await op(S.base, { action: "reset" });
    assert.equal((await state(S.base)).json.cfg.flags.trustPhotos, true, "switches survive Reset screen controls");
    assert.equal((await op(S.base, { action: "flags", name: "trustPhotos", on: false })).status, 200);
    assert.equal((await state(S.base)).json.cfg.flags.trustPhotos, false);
    assert.equal((await op(S.base, { action: "flags", name: "everything", on: true })).status, 400);
    assert.equal((await op(S.base, { action: "flags", name: "__proto__", on: true })).status, 400);
    assert.equal((await op(S.base, { action: "flags", name: "trustPhotos", on: "yes" })).status, 400);
  });

  test("repair rebuilds the snapshot from the approval markers", async () => {
    const d = newDev();
    const ph = await upload(S.base, d, { caption: "Networking at lunch" });
    await op(S.base, { action: "approvePhoto", id: ph.json.id });
    const before = await snapOf(S.base);
    const s = await openDirect(S.dir);
    // drift: the snapshot lost a photo and gained a card with a device id as its id
    await s.setJSON("snap", { at: before.at, photos: [], profiles: [{ id: d, name: "Ghost" }], takeaways: [] });
    await s.set("ok/pr/" + d, "");
    await s.setJSON("pr/" + d, { name: "Ghost", at: 1 });
    const r = await op(S.base, { action: "repair" });
    assert.equal(r.status, 200);
    assert.equal(r.json.photos, before.photos.length); assert.equal(r.json.profiles, before.profiles.length);
    const after = await snapOf(S.base);
    assert.deepEqual(after.photos.map(p => p.id), before.photos.map(p => p.id));
    assert.deepEqual(after.profiles.map(p => p.id), before.profiles.map(p => p.id));
    assert.ok(after.at > before.at);
    await s.delete("ok/pr/" + d); await s.delete("pr/" + d);
  });

  test("the wall heartbeat is stored, cleaned, and shown to the remote", async () => {
    const beat = { w: 3840, h: 1920, dpr: 1, layout: "wide", mode: "live", scenes: ["rooms", "photos", "poll"], lite: false, fps: 59.7, err: "", at: Date.now() };
    const r = await call(S.base, "POST", "/api/beat", { body: beat });
    assert.equal(r.status, 204);
    let g = (await opGet(S.base)).json.screen;
    assert.equal(g.w, 3840); assert.deepEqual(g.scenes, ["rooms", "photos", "poll"]); assert.equal(g.fps, 59.7);
    assert.ok(g.age >= 0 && g.age < 5);
    await call(S.base, "POST", "/api/beat", { body: { w: "<b>", err: "x".repeat(500), layout: "<script>", scenes: "rooms,poll" } });
    g = (await opGet(S.base)).json.screen;
    assert.equal(g.w, null); assert.equal(g.err.length, 300); assert.ok(!g.layout.includes("<")); assert.equal(g.scenes, "rooms,poll");
    assert.equal((await call(S.base, "POST", "/api/beat", { body: { err: "y".repeat(1100) } })).status, 413);
    assert.equal((await call(S.base, "POST", "/api/beat", { body: "{nope", raw: true })).status, 400);
    assert.equal((await call(S.base, "POST", "/api/beat", { body: [1, 2] })).status, 400);
    assert.equal((await call(S.base, "GET", "/api/beat")).status, 405);
  });
});

/* ---------- wipe, on its own server with data ---------- */
describe("wipe", () => {
  test("deletes what people and the team made, keeps people, polls and directions", async () => {
    const W = await startServer();
    const d = newDev();
    await call(W.base, "POST", "/api/answer", { body: { pid: "p1", text: "growth" }, headers: { "x-dev": d } });
    const ph = await upload(W.base, d); await op(W.base, { action: "approvePhoto", id: ph.json.id });
    const pr = await call(W.base, "POST", "/api/profile", { body: { name: "Yousef Amin", company: "CloudBridge", role: "CTO", looking: ["Hiring"], offer: ["Mentoring"], consent: true }, headers: { "x-dev": d } });
    await op(W.base, { action: "approveProfile", id: pr.json.id });
    await op(W.base, { action: "way", way: { registration: "left", roomA: "up right" } });
    await op(W.base, { action: "pollAdd", q: "What did you learn today?", type: "words" });
    await op(W.base, { action: "mode", mode: "lunch" });
    await op(W.base, { action: "hideWord", word: "growth" });
    await op(W.base, { action: "flags", name: "trustPhotos", on: true });
    await op(W.base, { action: "rehearsal", hhmm: "11:00" });
    await opGet(W.base, "wrong");
    await call(W.base, "POST", "/api/beat", { body: { w: 1920, h: 1080 } });
    const s = await openDirect(W.dir);
    await s.setJSON("people", [{ id: "0123456789", name: "Sample Person" }]);
    for (const k of ["who/" + d, "dv/g0123456789/" + d, "sig/g0123456789", "here/g0123456789", "hi/1~g0123456789~Layla", "fail/0123456789/" + d + "~1", "star/1/g0123456789/1A~own", "rx/1/15/" + d + "~1~0~0~ab", "rxm/1~1~0~0", "rxd/" + d, "rxt/1/1~ab", "code/123", "cx/ga~gb~1", "tk/1A/g0123456789", "q/tk/1A~g0123456789", "ok/tk/1A~g0123456789", "fb/g0123456789", "lim/who/1/" + d + "/a", "alert/photos/1"]) await s.set(k, "x");
    assert.equal((await op(W.base, { action: "wipe", phrase: "reset md26" })).status, 400);
    assert.equal((await op(W.base, { action: "wipe" })).status, 400);
    const r = await op(W.base, { action: "wipe", phrase: "RESET MD26" });
    assert.equal(r.status, 200, r.text); assert.ok(r.json.deleted >= 20, String(r.json.deleted));
    const keys = (await s.list()).blobs.map(b => b.key);
    assert.deepEqual(keys.filter(k => !k.startsWith("log/")).sort(), ["cfg", "people", "polls", "snap"]);
    const g = (await opGet(W.base)).json;
    assert.deepEqual(g.log.map(l => l.what), ["Wiped the test data"]);
    assert.deepEqual(g.cfg.way, { roomA: "up right", registration: "left" });
    assert.equal(g.cfg.mode, "auto"); assert.deepEqual(g.cfg.hidden, []); assert.equal(g.cfg.rehearsal, null);
    assert.deepEqual(g.cfg.flags, ALL_FLAGS);
    assert.ok(g.polls.some(x => x.q === "What did you learn today?"));
    assert.equal(g.screen, null); assert.deepEqual(g.pending, { photos: [], profiles: [], takeaways: [] });
    assert.equal((await s.get("people", { type: "json" }))[0].name, "Sample Person");
    const st = (await state(W.base)).json;
    assert.deepEqual([st.n.answers, st.n.photos, st.n.board, st.reh], [0, 0, 0, false]);
    const sn = await call(W.base, "GET", "/api/snap?v=" + st.snapV);
    assert.deepEqual([sn.json.photos, sn.json.profiles, sn.json.takeaways], [[], [], []]);
    await W.stop();
    await openDirect(S.dir);
  });
});

/* ---------- safety ---------- */
describe("safety", () => {
  test("wrong PINs are refused and counted", async () => {
    const s = await openDirect(S.dir);
    const count = async () => (await s.list({ prefix: "pinfail/" })).blobs.length;
    const c0 = await count();
    assert.equal((await opGet(S.base, "000000")).status, 401);
    assert.equal((await op(S.base, { action: "reload" }, "")).status, 401);
    assert.equal((await call(S.base, "GET", "/api/op")).status, 401);
    assert.equal((await call(S.base, "GET", "/api/photo/nosuchphoto1", { headers: { "x-pin": "nope" } })).status, 404);
    assert.equal((await call(S.base, "GET", "/api/photo/nosuchphoto1")).status, 404);
    assert.equal(await count(), c0 + 4, "three wrong PINs on the remote, one on a photo, none without a PIN");
    assert.ok((await opGet(S.base)).json.pinFails >= 4);
  });

  test("bodies are capped and must be JSON objects", async () => {
    const d = newDev();
    assert.equal((await call(S.base, "POST", "/api/answer", { body: { pid: "p1", text: "a".repeat(3000) }, headers: { "x-dev": d } })).status, 413);
    assert.equal((await call(S.base, "POST", "/api/answer", { body: [1], headers: { "x-dev": d } })).status, 400);
    assert.equal((await call(S.base, "POST", "/api/profile", { body: { name: "x".repeat(5000) }, headers: { "x-dev": d } })).status, 413);
    assert.equal((await call(S.base, "POST", "/api/profile", { body: "null", raw: true, headers: { "x-dev": d, "content-type": "application/json" } })).status, 400);
    assert.equal((await op(S.base, { action: "ann", text: "x".repeat(300 * 1024) })).status, 413);
    assert.equal((await op(S.base, "nope")).status, 400);
    assert.equal((await op(S.base, { action: "nope" })).json.error, "Unknown action.");
  });

  test("every JSON answer says nosniff", async () => {
    for (const r of [await state(S.base), await opGet(S.base), await call(S.base, "GET", "/api/profile")]) assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    assert.equal((await call(S.base, "GET", "/api/sheet/nosuchtab")).status, 404);
  });
});

/* ---------- the version 1 operator actions ---------- */
describe("operator actions", () => {
  test("screen controls change the public config and are logged", async () => {
    const ok = async (body, check) => { const r = await op(S.base, body); assert.equal(r.status, 200, JSON.stringify(body) + " " + r.text); if (check) check((await state(S.base)).json.cfg); };
    await ok({ action: "mode", mode: "lunch" }, c => { assert.equal(c.mode, "lunch"); assert.equal(c.pin, null); });
    await ok({ action: "pin", scene: "photos" }, c => assert.equal(c.pin, "photos"));
    await ok({ action: "pin", scene: null }, c => assert.equal(c.pin, null));
    await ok({ action: "speaker", index: 1 }, c => { assert.equal(c.speaker, 1); assert.equal(c.mode, "opening"); });
    await ok({ action: "speaker", index: null }, c => assert.equal(c.speaker, null));
    await ok({ action: "theme", theme: "dark" }, c => assert.equal(c.theme, "dark"));
    await ok({ action: "overlay", overlay: "check" }, c => assert.equal(c.overlay, "check"));
    await ok({ action: "overlay", overlay: "nonsense" }, c => assert.equal(c.overlay, null));
    await ok({ action: "way", way: { registration: "left", roomA: "sideways" } }, c => assert.deepEqual(c.way, { registration: "left" }));
    await ok({ action: "ann", text: "Lunch is ready in the Main Hall", secs: 500 }, c => { assert.equal(c.ann.text, "Lunch is ready in the Main Hall"); assert.equal(c.ann.secs, 120); });
    await ok({ action: "reset" }, c => { assert.equal(c.mode, "auto"); assert.equal(c.theme, "light"); assert.equal(c.ann, null); assert.deepEqual(c.way, { registration: "left" }); });
    const log = (await opGet(S.base)).json.log.map(l => l.what);
    assert.ok(log.includes("Held the screen on lunch") && log.includes("Reset the screen controls"));
    for (const body of [{ action: "mode", mode: "party" }, { action: "pin", scene: "nope" }, { action: "video", id: "nope" }]) assert.equal((await op(S.base, body)).status, 400, JSON.stringify(body));
  });

  test("polls can be added, opened, cleared and deleted", async () => {
    assert.equal((await op(S.base, { action: "pollAdd", q: "Hi" })).json.error, "Write the question.");
    assert.equal((await op(S.base, { action: "pollAdd", q: "Pick one please", type: "choice", options: ["Only"] })).json.error, "Add at least two options.");
    assert.equal((await op(S.base, { action: "pollAdd", q: "Which room was best?", type: "choice", options: ["Room A", "Room B", ""] })).status, 200);
    let g = (await opGet(S.base)).json;
    const np = g.polls.find(x => x.q === "Which room was best?");
    assert.deepEqual(np.options, ["Room A", "Room B"]);
    assert.equal((await op(S.base, { action: "pollActivate", pid: "nope" })).status, 400);
    await op(S.base, { action: "pollActivate", pid: np.id });
    await call(S.base, "POST", "/api/answer", { body: { pid: np.id, text: "Room A" }, headers: { "x-dev": newDev() } });
    assert.equal((await state(S.base)).json.poll.total, 1);
    await op(S.base, { action: "pollReset", pid: np.id });
    assert.equal((await state(S.base)).json.poll.total, 0);
    await op(S.base, { action: "pollDelete", pid: np.id });
    g = (await opGet(S.base)).json;
    assert.ok(!g.polls.some(x => x.id === np.id)); assert.deepEqual(g.cfg.poll, { id: null, open: false, manual: false }, "deleting the held poll goes back to the schedule");
    assert.equal((await state(S.base)).json.poll, null);
    await op(S.base, { action: "pollActivate", pid: "p1" });
  });

  test("the sheet proxy knows only its three tabs", async () => {
    assert.equal((await call(S.base, "GET", "/api/sheet/people")).status, 404);
  });
});

/* ---------- the poll schedule (plan section 5.8) ---------- */
describe("poll schedule", () => {
  let P;
  const at = async hhmm => { const r = await op(P.base, { action: "rehearsal", hhmm }); assert.equal(r.status, 200, r.text); return (await state(P.base)).json; };
  const ans = (pid, text = "Funding") => call(P.base, "POST", "/api/answer", { body: { pid, text }, headers: { "x-dev": newDev() } });
  before(async () => { P = await startServer(); });
  after(async () => { await P.stop(); });

  test("the open poll follows pollPlan, and the last one shows closed after it", async () => {
    await openDirect(P.dir);
    const { pollNow } = lib.rules, { localToMs } = lib.day;
    const polls = lib.store.DEFAULT_POLLS, cfg = lib.store.mergeCfg(null);
    const on = hhmm => { const c = pollNow(cfg, polls, localToMs("2026-11-17", hhmm)); return c ? [c.p.id, c.open, c.manual] : null; };
    assert.equal(on("08:59"), null, "no poll before the first row");
    assert.deepEqual(on("09:00"), ["p2", true, false]);
    assert.deepEqual(on("10:39"), ["p2", true, false]);
    assert.deepEqual(on("10:40"), ["p1", true, false]);
    assert.deepEqual(on("12:00"), ["p3", true, false]);
    assert.deepEqual(on("13:40"), ["p4", true, false]);
    assert.deepEqual(on("14:59"), ["p4", true, false]);
    assert.deepEqual(on("15:00"), ["p4", false, false]);
    assert.equal(pollNow(cfg, polls, Date.parse("2026-11-16T12:00:00Z")), null, "a day before: no poll");
    assert.deepEqual((({ p, open }) => [p.id, open])(pollNow(cfg, polls, Date.parse("2026-11-18T12:00:00Z"))), ["p4", false]);
    assert.equal((await state(P.base)).json.poll, null, "before the day, nothing is open");
    assert.equal((await ans("p1")).status, 409);
  });

  test("answers go to the scheduled poll only, and the poll changes by itself", async () => {
    let d = await at("09:40");
    assert.equal(d.poll.id, "p2"); assert.equal(d.poll.open, true); assert.equal(d.poll.manual, false);
    assert.equal((await ans("p2", "Funding")).status, 200);
    assert.equal((await ans("p1", "growth")).status, 409);
    d = await at("10:41");
    assert.deepEqual([d.poll.id, d.poll.open, d.poll.type], ["p1", true, "words"]);
    assert.equal((await ans("p1", "growth")).status, 200);
    assert.equal((await ans("p2", "Funding")).status, 409);
    d = await at("15:10");
    assert.deepEqual([d.poll.id, d.poll.open], ["p4", false]);
    assert.equal((await ans("p4", "listen")).status, 409);
  });

  test("the remote can hold a poll, close it, and go back to the schedule", async () => {
    await at("12:10");
    assert.equal((await op(P.base, { action: "pollActivate", pid: "p2" })).status, 200);
    let d = (await state(P.base)).json;
    assert.deepEqual([d.poll.id, d.poll.open, d.poll.manual], ["p2", true, true]);
    d = await at("13:50");
    assert.deepEqual([d.poll.id, d.poll.manual], ["p2", true], "a held poll stays when the clock moves");
    assert.equal((await op(P.base, { action: "pollManual", on: false })).status, 200);
    d = (await state(P.base)).json;
    assert.deepEqual([d.poll.id, d.poll.open, d.poll.manual], ["p4", true, false]);
    assert.equal((await op(P.base, { action: "pollClose" })).status, 200);
    d = (await state(P.base)).json;
    assert.deepEqual([d.poll.id, d.poll.open, d.poll.manual], ["p4", false, true], "closing a scheduled poll holds it closed");
    assert.equal((await ans("p4", "listen")).status, 409);
    await op(P.base, { action: "pollManual", on: false });
    assert.equal((await op(P.base, { action: "pollManual", on: true })).status, 200);
    d = await at("10:00");
    assert.deepEqual([d.poll.id, d.poll.open, d.poll.manual], ["p4", true, true], "pollManual on freezes the poll of that moment");
    for (const body of [{ action: "pollManual" }, { action: "pollManual", on: "yes" }]) assert.equal((await op(P.base, body)).status, 400);
    await op(P.base, { action: "pollManual", on: false });
    const log = (await opGet(P.base)).json.log.map(l => l.what);
    assert.ok(log.includes("Held the poll") && log.includes("Polls follow the schedule again"));
  });

  test("GET /api/op says what the clock rules do now and next", async () => {
    await at("10:20");
    let a = (await opGet(P.base)).json.auto;
    assert.equal(a.now, "10:20"); assert.equal(a.date, "2026-11-17"); assert.equal(a.phase, "day");
    assert.deepEqual(a.poll, { id: "p2", open: true, manual: false, until: "10:40", next: { id: "p1", at: "10:40" } });
    assert.deepEqual(a.rx, { mode: "auto", on: true, until: "10:40", next: "14:00" });
    assert.deepEqual(a.program, { now: { title: "Opening", s: "10:00", e: "10:30" }, next: { title: "Gaza Sky Geeks Film", s: "10:30" } });
    assert.deepEqual(a.takeaways, []);
    await at("11:42");
    a = (await opGet(P.base)).json.auto;
    assert.deepEqual(a.takeaways, [1]); assert.equal(a.rx.on, false); assert.equal(a.rx.next, "14:00");
    await at("13:41");
    assert.deepEqual((await opGet(P.base)).json.auto.takeaways, [3]);
    await op(P.base, { action: "rehearsal", hhmm: null });
    a = (await opGet(P.base)).json.auto;
    assert.equal(a.phase, "before"); assert.equal(a.poll.id, null); assert.deepEqual(a.poll.next, { id: "p2", at: "09:00" }); assert.equal(a.rx.next, "10:00");
  });
});

/* ---------- people and sign in (plan section 5.3) ---------- */
// The six sample people of scripts/seed.sh, with made up last 4 digits. Test data only.
const SAMPLE = [
  { name: "Layla Khoury", last4: "7391", company: "Byte Studio", title: "Founder", linkedin: "linkedin.com/in/test-layla", topics: ["AI adoption and applied AI"], advisorPref: "remote", photoOk: true },
  { name: "Omar Saleh", last4: "0458", company: "Freelance", title: "Full Stack Developer", topics: ["Business development and international sales", "Not a topic"], advisorPref: "", photoOk: false },
  { name: "Rana Odeh", last4: "6620", company: "Nablus Tech", title: "Marketing Lead", topics: ["Career growth and remote work"], advisorPref: "local", rooms: { 1: "Room C", 3: "3B", 2: "Room Z" } },
  { name: "Yousef Amin", last4: "3187", company: "CloudBridge", title: "CTO", topics: ["Engineering leadership and architecture", "AI adoption and applied AI"], advisorPref: "local" },
  { name: "Dina Haddad", last4: "9045", company: "Student Hub", title: "Product Manager", topics: [], advisorPref: "nonsense" },
  { name: "Karim Nasser", last4: "5512", company: "Olive Labs", title: "CEO", topics: ["Fundraising, finance, and scaling a company"], advisorPref: "remote", slot: { who: "iyas", s: "13:15" } }
];
const ARABIC = { name: "ليلى خوري", last4: "2864", company: "", title: "" }; // Layla Khoury in Arabic script, test only
const LAST4S = [...SAMPLE, ARABIC].map(p => p.last4);
const pubOf = p => { const { personId } = lib.ids; return "p" + personId(p.name, p.last4); };
const claim = (base, dev, body) => call(base, "POST", "/api/claim", { body, headers: { "x-dev": dev } });
const me = (base, dev) => call(base, "GET", "/api/me", { headers: { "x-dev": dev } });
const who = (base, dev, q) => call(base, "GET", "/api/who?q=" + encodeURIComponent(q), { headers: { "x-dev": dev } });

describe("sign in", () => {
  let P;
  before(async () => { P = await startServer(); await openDirect(P.dir); });
  after(async () => { await P.stop(); await openDirect(S.dir); });

  test("the import keeps people with a name and 4 digits, and stores no number", async () => {
    const rows = [...SAMPLE, ARABIC, { name: "No Number" }, { name: "", last4: "1111" }, "nonsense", { ...SAMPLE[0], company: "Byte Studio Two" }, { name: "Bad Digits", last4: "12a4" }];
    const r = await op(P.base, { action: "peopleImport", people: rows });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.count, 7); assert.equal(r.json.replaced, 1);
    assert.deepEqual(r.json.skipped, [{ row: 8, why: "no last 4 digits" }, { row: 9, why: "no name" }, { row: 10, why: "not a row" }, { row: 12, why: "no last 4 digits" }]);
    const s = await openDirect(P.dir);
    const people = await s.get("people", { type: "json" });
    assert.equal(people.length, 7);
    const layla = people.find(p => p.name === "Layla Khoury");
    assert.equal(layla.company, "Byte Studio Two", "a later row with the same name and number wins");
    assert.equal(layla.linkedin, "https://linkedin.com/in/test-layla"); assert.equal(layla.first, "Layla");
    assert.equal(layla.k4, lib.ids.k4Of(layla.id, "7391")); assert.equal("last4" in layla, false);
    assert.equal(JSON.stringify(people).includes("7391"), false, "no last 4 digits are stored");
    const omar = people.find(p => p.name === "Omar Saleh");
    assert.deepEqual(omar.topics, ["Business development and international sales"]);
    const rana = people.find(p => p.name === "Rana Odeh");
    assert.deepEqual(rana.rooms, { 1: "1C", 3: "3B" });
    assert.equal(people.find(p => p.name === "Dina Haddad").advisorPref, "");
    assert.deepEqual(people.find(p => p.name === "Karim Nasser").slot, { who: "iyas", s: "13:15", e: "13:30", room: "Small Room 3" });
    assert.equal(people.find(p => p.name === ARABIC.name).first, "ليلى");
  });

  test("import refusals", async () => {
    assert.equal((await op(P.base, { action: "peopleImport", people: "x" })).status, 400);
    assert.equal((await op(P.base, { action: "peopleImport", people: [{ name: "Only Name" }] })).status, 400);
    assert.equal((await op(P.base, { action: "peopleImport", people: Array.from({ length: 801 }, () => ({})) })).status, 413);
    assert.equal((await op(P.base, { action: "peopleImport", people: SAMPLE }, "wrong")).status, 401);
    assert.equal((await opGet(P.base)).json.people.count, 7, "a refused import changes nothing");
  });

  test("search finds the start of any word, ignores case, accents and Arabic variants, names only", async () => {
    const d = newDev();
    const names = async q => { const r = await who(P.base, d, q); assert.equal(r.status, 200, q + " " + r.text); return r.json.list.map(x => x.name); };
    assert.deepEqual(await names("lay"), ["Layla Khoury"]);
    assert.deepEqual(await names("KHOU"), ["Layla Khoury"]);
    assert.deepEqual(await names("layla kh"), ["Layla Khoury"]);
    assert.deepEqual(await names("Lâyla"), ["Layla Khoury"]);
    assert.deepEqual(await names("ليل"), [ARABIC.name]);
    assert.deepEqual(await names("خور"), [ARABIC.name]);
    assert.deepEqual(await names("aye"), [], "the middle of a word does not match");
    const r = await who(P.base, d, "oma");
    assert.deepEqual(Object.keys(r.json.list[0]).sort(), ["id", "name"]);
    assert.equal(r.json.list[0].id, pubOf(SAMPLE[1]));
    assert.equal((await who(P.base, d, "la")).status, 400);
    assert.equal((await who(P.base, d, " l a ")).status, 400);
    assert.equal((await who(P.base, d, "x".repeat(61))).status, 400);
    assert.equal((await call(P.base, "GET", "/api/who?q=layla")).status, 400, "x-dev is required");
  });

  test("at most 5 answers, and 40 searches per phone per 10 minutes", async () => {
    const s = await openDirect(P.dir);
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `Test Person${i}`, last4: String(1000 + i), k4: "", id: String(i).padStart(10, "a") }));
    const people = await s.get("people", { type: "json" });
    await s.setJSON("people", people.concat(many));
    const d = newDev();
    const r = await who(P.base, d, "test");
    assert.equal(r.json.list.length, 5);
    for (let i = 1; i < 40; i++) assert.equal((await who(P.base, d, "omar")).status, 200);
    const over = await who(P.base, d, "omar");
    assert.equal(over.status, 429); assert.equal(over.json.error, "Too many searches. Wait a few minutes and try again.");
    assert.equal((await who(P.base, newDev(), "omar")).status, 200, "another phone still searches");
    await s.setJSON("people", people);
  });

  test("a right number signs in and answers like GET /api/me", async () => {
    const d = newDev(), layla = SAMPLE[0];
    const r = await claim(P.base, d, { id: pubOf(layla), last4: layla.last4, hello: true });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.ok, true); assert.equal(r.json.status, "person");
    assert.deepEqual(r.json.me, { pub: pubOf(layla), name: "Layla Khoury", first: "Layla", company: "Byte Studio Two", title: "Founder", linkedin: "https://linkedin.com/in/test-layla", suggest: ["AI and Tech"], rooms: {}, slot: null, photoOk: true });
    const m = await me(P.base, d);
    assert.deepEqual(Object.keys(m.json).sort(), ["code", "feedback", "links", "me", "profile", "stars", "status", "takeaways"]);
    assert.equal(m.json.status, "person"); assert.deepEqual(m.json.me, r.json.me);
    assert.equal(m.json.profile, null); assert.equal(m.json.code, null); assert.deepEqual(m.json.links, []); assert.deepEqual(m.json.takeaways, []); assert.equal(m.json.feedback, null);
    const karim = await claim(P.base, newDev(), { id: pubOf(SAMPLE[5]), last4: SAMPLE[5].last4 });
    assert.deepEqual(karim.json.me.slot, { who: "iyas", s: "13:15", e: "13:30", room: "Small Room 3" });
    assert.deepEqual(karim.json.me.suggest, ["Funding"]);
  });

  test("claim refusals", async () => {
    const d = newDev(), omar = SAMPLE[1];
    assert.equal((await claim(P.base, d, { id: "0123456789", last4: "1234" })).status, 400);
    assert.equal((await claim(P.base, d, { id: pubOf(omar), last4: "123" })).status, 400);
    assert.equal((await claim(P.base, d, { id: pubOf(omar), last4: 458 })).status, 400);
    assert.equal((await claim(P.base, d, { id: "p0000000000", last4: "1234" })).status, 404);
    assert.equal((await call(P.base, "POST", "/api/claim", { body: { id: pubOf(omar), last4: omar.last4 } })).status, 400, "x-dev is required");
    assert.equal((await call(P.base, "POST", "/api/claim", { body: "{", raw: true, headers: { "x-dev": d, "content-type": "application/json" } })).status, 400);
    assert.equal((await call(P.base, "GET", "/api/claim", { headers: { "x-dev": d } })).status, 405);
  });

  test("5 wrong tries lock one phone, 10 lock the person on every phone, Unlock opens it", async () => {
    const yousef = SAMPLE[3], id = pubOf(yousef), a = newDev();
    const lefts = [];
    for (let i = 0; i < 5; i++) { const r = await claim(P.base, a, { id, last4: "0000" }); assert.equal(r.status, 401); lefts.push(r.json.left); }
    assert.deepEqual(lefts, [4, 3, 2, 1, 0]);
    const locked = await claim(P.base, a, { id, last4: yousef.last4 });
    assert.equal(locked.status, 423, "the right number does not help a locked phone");
    assert.equal(locked.json.error, "Too many tries. Ask the team at the registration desk.");
    const b = newDev();
    const r6 = await claim(P.base, b, { id, last4: "1111" });
    assert.equal(r6.status, 401); assert.equal(r6.json.left, 4, "another phone has its own 5, within the 10");
    for (let i = 0; i < 3; i++) await claim(P.base, b, { id, last4: "2222" });
    const c = newDev();
    const r10 = await claim(P.base, c, { id, last4: "3333" });
    assert.equal(r10.status, 401); assert.equal(r10.json.left, 0);
    assert.equal(r10.json.error, "Too many tries. Ask the team at the registration desk.");
    assert.equal((await claim(P.base, newDev(), { id, last4: yousef.last4 })).status, 423, "a new device id does not reset the person");
    const g = (await opGet(P.base)).json.people;
    assert.deepEqual(g.locked, [{ id, name: "Yousef Amin", tries: 10, all: true }]);
    assert.equal((await op(P.base, { action: "peopleUnlock", id: "nope" })).status, 400);
    assert.equal((await op(P.base, { action: "peopleUnlock", id })).status, 200);
    assert.deepEqual((await opGet(P.base)).json.people.locked, []);
    assert.equal((await claim(P.base, a, { id, last4: yousef.last4 })).status, 200);
    assert.ok((await opGet(P.base)).json.log.some(l => l.what === "Unlocked Yousef Amin"));
  });

  test("wrong tries sent at the same moment still stop at 10", async () => {
    const dina = SAMPLE[4], id = pubOf(dina);
    const res = await Promise.all(Array.from({ length: 16 }, (_, i) => claim(P.base, newDev(), { id, last4: String(1000 + i) })));
    const wrong = res.filter(r => r.status === 401).length, refused = res.filter(r => r.status === 423).length;
    assert.ok(wrong <= 10, `at most 10 numbers were checked, got ${wrong}`);
    assert.equal(wrong + refused, 16);
    // A refused try is not counted, so the person locks after exactly 10 checked numbers in all.
    let more = 0;
    for (let i = 0; i < 12; i++) { const r = await claim(P.base, newDev(), { id, last4: "9999" }); if (r.status === 423) break; assert.equal(r.status, 401); more++; }
    assert.equal(wrong + more, 10);
    assert.equal((await claim(P.base, newDev(), { id, last4: dina.last4 })).status, 423);
    await op(P.base, { action: "peopleUnlock", id });
  });

  test("at most 3 phones per person", async () => {
    const omar = SAMPLE[1], id = pubOf(omar), devs = [newDev(), newDev(), newDev()];
    for (const d of devs) assert.equal((await claim(P.base, d, { id, last4: omar.last4 })).status, 200);
    assert.equal((await claim(P.base, devs[0], { id, last4: omar.last4 })).status, 200, "the same phone again is fine");
    const fourth = await claim(P.base, newDev(), { id, last4: omar.last4 });
    assert.equal(fourth.status, 409); assert.equal(fourth.json.error, "This name is signed in on 3 phones already. Ask the team at the registration desk.");
    await op(P.base, { action: "peopleUnlock", id });
    assert.equal((await claim(P.base, newDev(), { id, last4: omar.last4 })).status, 200, "Unlock also frees the phone count");
  });

  test("guests, sign out, and a phone that never signed in", async () => {
    const d = newDev(), post = body => call(P.base, "POST", "/api/guest", { body, headers: { "x-dev": d } });
    assert.equal((await post({ name: "J" })).status, 400);
    assert.equal((await post({ name: "12345" })).status, 400);
    assert.equal((await post({ name: "Big Shit" })).status, 422);
    assert.equal((await call(P.base, "POST", "/api/guest", { body: { name: "Sami Guest" } })).status, 400, "x-dev is required");
    const g = await post({ name: "  Sami   Guest <b> ", hello: true });
    assert.equal(g.status, 200, g.text);
    assert.equal(g.json.status, "guest");
    assert.deepEqual(g.json.me, { pub: lib.ids.guestPub(d), name: "Sami Guest b", first: "Sami", company: "", title: "", linkedin: "", suggest: [], rooms: {}, slot: null, photoOk: null });
    const people = (await opGet(P.base)).json.people;
    assert.ok(people.list.some(x => x.kind === "guest" && x.name === "Sami Guest b" && x.id === lib.ids.guestPub(d)));
    assert.ok(people.list.some(x => x.kind === "person" && x.name === "Layla Khoury"));
    assert.equal(people.guests, 1); assert.ok(people.signedIn >= 3);
    assert.equal((await call(P.base, "POST", "/api/signout", { headers: { "x-dev": d } })).status, 200);
    const m = await me(P.base, d);
    assert.equal(m.json.status, "none"); assert.equal(m.json.me.pub, lib.ids.guestPub(d)); assert.equal(m.json.me.name, "");
    assert.equal((await call(P.base, "POST", "/api/signout")).status, 400);
    assert.equal((await call(P.base, "GET", "/api/me")).status, 400);
    const fresh = await me(P.base, newDev());
    assert.equal(fresh.json.status, "none"); assert.deepEqual(fresh.json.stars, {});
  });
});

/* ---------- verified cards, here and hello (plan sections 5.4 and 5.9) ---------- */
describe("cards, here and hello", () => {
  let P;
  const card = { name: "Someone Else", company: "Other Co", role: "Founder", looking: ["Funding"], offer: ["Product"], linkedin: "", consent: true };
  const postCard = (dev, body = card) => call(P.base, "POST", "/api/profile", { body, headers: { "x-dev": dev } });
  const signIn = async (p, dev = newDev(), hello = false) => { const r = await claim(P.base, dev, { id: pubOf(p), last4: p.last4, hello }); assert.equal(r.status, 200, r.text); return dev; };
  before(async () => {
    P = await startServer(); await openDirect(P.dir);
    await op(P.base, { action: "peopleImport", people: [...SAMPLE, { name: "Zib Tester", last4: "6006" }] });
  });
  after(async () => { await P.stop(); await openDirect(S.dir); });

  test("a verified person's card is approved at once, with name and company from registration", async () => {
    const d = await signIn(SAMPLE[0]);
    const r = await postCard(d);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { ok: true, status: "approved", id: pubOf(SAMPLE[0]) });
    const sn = await snapOf(P.base);
    const item = sn.profiles.find(x => x.id === pubOf(SAMPLE[0]));
    assert.equal(item.name, "Layla Khoury"); assert.equal(item.company, "Byte Studio");
    const m = (await me(P.base, d)).json;
    assert.equal(m.profile.status, "approved"); assert.equal(m.profile.name, "Layla Khoury");
    assert.ok(!(await opGet(P.base)).json.pending.profiles.some(x => x.id === pubOf(SAMPLE[0])));
    assert.equal((await postCard(d, { ...card, role: "shit" })).status, 422, "the role is still checked");
    assert.equal((await postCard(d, { ...card, name: "porn star" })).status, 200, "the typed name is ignored for a verified person");
  });

  test("with trustProfiles off, and for guests, a card waits for the team", async () => {
    await op(P.base, { action: "flags", name: "trustProfiles", on: false });
    const d = await signIn(SAMPLE[1]);
    assert.equal((await postCard(d)).json.status, "pending");
    await op(P.base, { action: "flags", name: "trustProfiles", on: true });
    const g = newDev();
    await call(P.base, "POST", "/api/guest", { body: { name: "Sami Guest" }, headers: { "x-dev": g } });
    const r = await postCard(g, { ...card, name: "Sami Guest" });
    assert.equal(r.json.status, "pending"); assert.equal(r.json.id, lib.ids.guestPub(g));
    const pend = (await opGet(P.base)).json.pending.profiles.map(x => x.id);
    assert.ok(pend.includes(pubOf(SAMPLE[1])) && pend.includes(lib.ids.guestPub(g)));
  });

  test("a guest card and own stars made on a phone move to the person who signs in there", async () => {
    const d = newDev(), gp = lib.ids.guestPub(d), pp = pubOf(SAMPLE[3]);
    assert.equal((await postCard(d, { ...card, name: "Yousef A" })).json.status, "pending");
    await call(P.base, "POST", "/api/star", { body: { b: 1, sid: "1C" }, headers: { "x-dev": d } });
    const r = await claim(P.base, d, { id: pp, last4: SAMPLE[3].last4 });
    assert.equal(r.status, 200);
    assert.equal(r.json.profile.status, "approved"); assert.equal(r.json.profile.name, "Yousef Amin"); assert.equal(r.json.profile.role, "Founder");
    assert.deepEqual(r.json.stars[1], { sid: "1C", by: "own", why: null }, "the guest's own star is kept, not replaced by a pick");
    assert.equal(r.json.stars[3].by, "auto");
    const s = await openDirect(P.dir);
    assert.equal(await s.get(`pr/${gp}`), null); assert.equal(await s.get(`q/pr/${gp}`), null);
    assert.equal((await s.list({ prefix: `star/1/${gp}/` })).blobs.length, 0);
    const sn = await snapOf(P.base);
    assert.ok(sn.profiles.some(x => x.id === pp) && !sn.profiles.some(x => x.id === gp));
  });

  test("before the day nobody is here; on the day the first sign in says hello with consent", async () => {
    await signIn(SAMPLE[2], newDev(), true);
    let d = (await state(P.base)).json;
    assert.equal(d.n.here, 0, "a sign in before the day is not someone here"); assert.deepEqual(d.hello, []);
    await op(P.base, { action: "rehearsal", hhmm: "09:40" });
    await signIn(SAMPLE[4], newDev(), true);
    await signIn(SAMPLE[5], newDev(), false);
    await call(P.base, "POST", "/api/guest", { body: { name: "سامي ضيف", hello: true }, headers: { "x-dev": newDev() } });
    await signIn({ name: "Zib Tester", last4: "6006" }, newDev(), true);
    d = (await state(P.base)).json;
    assert.equal(d.n.here, 4);
    assert.deepEqual(d.hello.map(h => h.f), ["سامي", "Dina"], "newest first, first names only, no hello without consent or past the word filter");
    for (const h of d.hello) { assert.deepEqual(Object.keys(h).sort(), ["at", "f"]); assert.ok(Math.abs(h.at - d.t) < 60000, "at is in the time base of t"); }
    await signIn(SAMPLE[4], newDev(), true);
    assert.equal((await state(P.base)).json.hello.length, 2, "a second phone of the same person says no second hello");
  });

  test("a phone signed in before the day is marked here by its first GET /api/me on the day", async () => {
    const rana = (await opGet(P.base)).json.people.list.find(x => x.name === "Rana Odeh");
    assert.equal(rana.here, false);
    const s = await openDirect(P.dir);
    const devs = await Promise.all((await s.list({ prefix: "who/" })).blobs.map(async b => ({ dev: b.key.slice(4), w: await s.get(b.key, { type: "json" }) })));
    const ranaDev = devs.find(x => x.w.name === "Rana Odeh").dev;
    await me(P.base, ranaDev);
    const d = (await state(P.base)).json;
    assert.equal(d.n.here, 5); assert.equal(d.hello[0].f, "Rana", "the hello she agreed to before the day comes now");
    await me(P.base, ranaDev);
    assert.equal((await state(P.base)).json.hello.length, 3);
  });

  test("12 newest hellos, and the hello switch hides them", async () => {
    const s = await openDirect(P.dir), t = (await state(P.base)).json.t;
    for (let i = 0; i < 14; i++) await s.set(`hi/${String(t + 1000 + i).padStart(15, "0")}~g${String(i).padStart(10, "0")}~${encodeURIComponent("Name" + i)}`, "");
    let d = (await state(P.base)).json;
    assert.equal(d.hello.length, 12); assert.equal(d.hello[0].f, "Name13"); assert.equal(d.hello[11].f, "Name2");
    await op(P.base, { action: "flags", name: "hello", on: false });
    d = (await state(P.base)).json;
    assert.deepEqual(d.hello, []);
    await signIn(SAMPLE[0], newDev(), true);
    await op(P.base, { action: "flags", name: "hello", on: true });
    assert.equal((await state(P.base)).json.hello[0].f, "Name13", "no hello was written while the switch was off");
    await op(P.base, { action: "rehearsal", hhmm: null });
  });
});

/* ---------- reactions (plan sections 5.6 and 5.12) ---------- */
describe("reactions", () => {
  let P;
  const react = (dev, c) => call(P.base, "POST", "/api/react", { body: { c }, headers: { "x-dev": dev } });
  const rx = async () => (await call(P.base, "GET", "/api/rx")).json;
  before(async () => { P = await startServer(); await openDirect(P.dir); });
  after(async () => { await P.stop(); await openDirect(S.dir); });

  test("reactions follow the clock windows, unless the remote says on or off", async () => {
    assert.equal((await react(newDev(), { clap: 1 })).status, 409, "off before the day");
    await op(P.base, { action: "rehearsal", hhmm: "10:05" });
    assert.equal((await state(P.base)).json.rx.on, true);
    await op(P.base, { action: "rx", mode: "off" });
    assert.equal((await state(P.base)).json.rx.on, false);
    const no = await react(newDev(), { clap: 1 });
    assert.equal(no.status, 409); assert.equal(no.json.error, "Reactions are closed right now.");
    await op(P.base, { action: "rx", mode: "auto" });
    await op(P.base, { action: "rehearsal", hhmm: "10:45" });
    assert.equal((await state(P.base)).json.rx.on, false);
    await op(P.base, { action: "rehearsal", hhmm: "14:30" });
    assert.equal((await rx()).on, true);
    await op(P.base, { action: "rehearsal", hhmm: null });
    await op(P.base, { action: "rx", mode: "on" });
    assert.equal((await state(P.base)).json.rx.on, true, "on from the remote works on any day");
    for (const mode of ["yes", undefined, "ON"]) assert.equal((await op(P.base, { action: "rx", mode })).status, 400);
    assert.ok((await opGet(P.base)).json.log.some(l => l.what === "Turned reactions on"));
  });

  test("a batch shows in the current window and the total, the same in state and in /api/rx", async () => {
    const d = newDev();
    const t0 = (await rx()).total;
    const r = await react(d, { clap: 3, heart: 99, bloom: -4, other: 5 });
    assert.equal(r.status, 204, r.text);
    const st = (await state(P.base)).json, x = await rx();
    assert.equal(st.rx.total, t0 + 33, "heart is capped at 30, a negative count is 0");
    assert.deepEqual(Object.keys(x).sort(), ["b", "on", "t", "total"]);
    assert.equal(x.total, st.rx.total); assert.equal(x.on, true);
    assert.deepEqual((await opGet(P.base)).json.rx, { on: true, total: st.rx.total }, "the remote sees the same total");
    const both = st.rx.b[0].slice(1).map((v, i) => v + st.rx.b[1][i + 1]);
    assert.deepEqual(both, [3, 30, 0]);
    assert.equal(st.rx.b[0][0], Math.floor(st.t / 4000));
    const s = await openDirect(P.dir);
    const keys = (await s.list({ prefix: "rx/" })).blobs.map(b => b.key);
    assert.ok(keys.some(k => k.includes(d)), "the device id stays in the key name, on the server");
  });

  test("one batch per phone per 3 seconds, 150 per phone, 400 per window from everyone", async () => {
    const d = newDev();
    assert.equal((await react(d, { bloom: 1 })).status, 204);
    const fast = await react(d, { bloom: 1 });
    assert.equal(fast.status, 429); assert.equal(fast.json.error, "One moment, then send again.");
    await sleep(2600);
    assert.equal((await react(d, { bloom: 1 })).status, 204);
    const s = await openDirect(P.dir);
    const tired = newDev();
    await s.setJSON(`rxd/${tired}`, { at: 0, n: 150 });
    assert.equal((await react(tired, { clap: 1 })).json.error, "That is all the reactions for today. Thank you!");
    const { winPrefix } = lib.rx || (lib.rx = await import("../netlify/lib/rx.mjs"));
    // No rehearsal runs here, so t is the server's real time too. Fill this window and the next.
    const t = (await rx()).t, pres = [winPrefix(t, t), winPrefix(t + 4000, t + 4000)];
    for (const pre of pres) await Promise.all(Array.from({ length: 400 }, (_, i) => s.set(`${pre}flood${i}~1~0~0~aa`, "")));
    const full = await react(newDev(), { clap: 1 });
    assert.equal(full.status, 429); assert.equal(full.json.error, "Too many reactions at once. Try again in a moment.");
    for (const pre of pres) { const { blobs } = await s.list({ prefix: `${pre}flood` }); await Promise.all(blobs.map(b => s.delete(b.key))); }
  });

  test("refusals", async () => {
    const d = newDev();
    assert.equal((await react(d, {})).json.error, "Nothing to send.");
    assert.equal((await react(d, { clap: 0, heart: "x" })).status, 400);
    assert.equal((await call(P.base, "POST", "/api/react", { body: { c: [1, 2] }, headers: { "x-dev": d } })).status, 400);
    assert.equal((await call(P.base, "POST", "/api/react", { body: { c: { clap: 1 } } })).status, 400, "x-dev is required");
    assert.equal((await call(P.base, "POST", "/api/react", { body: { c: { clap: 1 }, pad: "x".repeat(300) }, headers: { "x-dev": d } })).status, 413);
    assert.equal((await call(P.base, "GET", "/api/react")).status, 405);
    assert.equal((await call(P.base, "POST", "/api/rx", { body: {} })).status, 405);
  });

  test("closed minutes are summed once, so the total stays and costs a few lists", async () => {
    const s = await openDirect(P.dir), { realMin } = lib.rx;
    const x0 = await rx(), m = realMin(x0.t); // no rehearsal runs here, so t is the server's real time
    // batches in a minute long past, and in a minute ahead (only a server with another clock writes there)
    for (const [mm, i] of [[m - 30, 0], [m - 30, 1], [m + 500, 2]]) await s.set(`rx/${mm}/${mm * 15 + 3}/old${i}~2~1~1~bb`, "");
    const results = await Promise.all(Array.from({ length: 5 }, () => rx()));
    for (const r of results) assert.equal(r.total, x0.total + 8, "every reader sees the same total");
    const sums = (await s.list({ prefix: "rx/", directories: true })).blobs.map(b => b.key);
    assert.deepEqual(sums.filter(k => k.startsWith(`rx/s${m - 30}~`)), [`rx/s${m - 30}~2~4~2~2`], "summed once, under one name");
    assert.ok(!sums.some(k => k.startsWith(`rx/s${m + 500}~`)), "a minute ahead of the clock waits until its time, unsummed");
    // the summed batches can even go; the sum keeps the total
    for (const k of (await s.list({ prefix: `rx/${m - 30}/` })).blobs) await s.delete(k.key);
    assert.equal((await rx()).total, x0.total + 8);
    await s.delete(`rx/${m + 500}/${(m + 500) * 15 + 3}/old2~2~1~1~bb`);
  });

  test("on Netlify state is cached 1 second while reactions are on, 2 when off; /api/rx 1 second", async () => {
    await openDirect(P.dir);
    const stateFn = (await import("../netlify/functions/state.mjs")).default, rxFn = (await import("../netlify/functions/rx.mjs")).default;
    assert.match((await stateFn(new Request("http://localhost/api/state"))).headers.get("netlify-cdn-cache-control"), /maxage=1\b/);
    assert.match((await rxFn(new Request("http://localhost/api/rx"))).headers.get("netlify-cdn-cache-control"), /maxage=1\b/);
    await op(P.base, { action: "rx", mode: "off" });
    assert.match((await stateFn(new Request("http://localhost/api/state"))).headers.get("netlify-cdn-cache-control"), /maxage=2\b/);
  });
});

/* ---------- reaction totals, with a clock the test moves (plan sections 5.6 and 5.12) ---------- */
// The functions run in this process on the data folder of their own server, with the real clock replaced
// (globalThis.__mdTestClock, as MD_TEST_FAKE_NOW does in the server), so minutes pass in milliseconds.
// Responses are recorded for the scans at the end. Totals stay under 1000, so no total looks like 4 digits.
describe("reaction totals", () => {
  let P, fn, clock = Date.parse("2026-11-13T12:00:50+02:00"), sent = 0, last = 0;
  const costs = []; // [storage operations, writes] of each state read
  async function inproc(f, method, url, { body, headers = {} } = {}) {
    const h = { ...headers }; if (body !== undefined) h["content-type"] = "application/json";
    const r = await f(new Request("http://localhost" + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), {});
    const text = r.status === 204 ? "" : await r.text();
    seen.push({ method, url, status: r.status, headers: [...r.headers].map(x => x.join(": ")).join("\n"), text });
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json };
  }
  // Counts the storage calls made while fn runs.
  async function counted(fn) {
    const proto = Object.getPrototypeOf(lib.store.st()), names = ["get", "getWithMetadata", "getMetadata", "list", "set", "setJSON", "delete"];
    const orig = Object.fromEntries(names.map(k => [k, proto[k]])), n = { ops: 0, writes: 0 };
    for (const k of names) proto[k] = function (...a) { n.ops++; if (k === "set" || k === "setJSON") n.writes++; return orig[k].apply(this, a); };
    try { return { out: await fn(), ...n }; } finally { Object.assign(proto, orig); }
  }
  // Holds the next batch write until release(), as a slow request would.
  function hold() {
    const proto = Object.getPrototypeOf(lib.store.st()), orig = proto.set;
    let release, held; const waiting = new Promise(r => { held = r; });
    proto.set = function (key, ...rest) {
      if (!/^rx\/\d+\//.test(key)) return orig.call(this, key, ...rest);
      proto.set = orig; held();
      return new Promise(r => { release = r; }).then(() => orig.call(this, key, ...rest));
    };
    return { waiting, release: () => release() };
  }
  const devs = Array.from({ length: 12 }, () => newDev()); let turn = 0;
  // One batch from the next phone in turn. sent grows by its size once the server accepts it.
  async function react(c = { clap: 1, heart: 1 }) {
    const r = await inproc(fn.react, "POST", "/api/react", { body: { c }, headers: { "x-dev": devs[turn++ % devs.length] } });
    if (r.status === 204) sent += (c.clap || 0) + (c.heart || 0) + (c.bloom || 0);
    return r.status;
  }
  const read = async () => (await inproc(fn.state, "GET", "/api/state")).json;
  // Reads state, checks the total never went down, and keeps what the read cost.
  async function total() {
    const { out, ops, writes } = await counted(read);
    costs.push([ops, writes]);
    assert.ok(out.rx.total >= last, `the total went down from ${last} to ${out.rx.total}`);
    return (last = out.rx.total);
  }
  const opIn = body => inproc(fn.op, "POST", "/api/op", { body, headers: opHeaders() });
  before(async () => {
    P = await startServer(); await openDirect(P.dir);
    fn = { state: (await import("../netlify/functions/state.mjs")).default, react: (await import("../netlify/functions/react.mjs")).default, op: (await import("../netlify/functions/op.mjs")).default };
    lib.rx ||= await import("../netlify/lib/rx.mjs");
    globalThis.__mdTestClock = () => clock;
    await opIn({ action: "rx", mode: "on" });
  });
  after(async () => { delete globalThis.__mdTestClock; await P.stop(); await openDirect(S.dir); });

  test("the total is every accepted batch, at every read across minute boundaries", async () => {
    assert.equal(await total(), 0);
    for (let i = 0; i < 30; i++) {
      for (let k = 0; k < 2; k++) assert.equal(await react(), 204);
      clock += 7000;
      assert.equal(await total(), sent, `step ${i}`);
    }
    clock += 3 * 60000;
    assert.equal(await total(), sent, "and once those minutes are summed");
  });

  test("a rehearsal clock that jumps a minute at a time, run twice over the same times, keeps every batch", async () => {
    for (const pass of [1, 2]) {
      for (let m = 0; m < 8; m++) {
        clock += 1500;
        assert.equal((await opIn({ action: "rehearsal", hhmm: `10:0${m}` })).status, 200);
        for (let k = 0; k < 2; k++) assert.equal(await react(), 204);
        assert.equal(await total(), sent, `pass ${pass} at 10:0${m}`);
      }
      await opIn({ action: "rehearsal", hhmm: null });
      clock += 1500;
      assert.equal(await total(), sent, `pass ${pass}, after the rehearsal`);
    }
    clock += 3 * 60000;
    assert.equal(await total(), sent, "and once those minutes are summed");
  });

  test("a batch sent just before a minute ends counts, also when it lands after the minute turned", async () => {
    clock = (Math.floor(clock / 60000) + 2) * 60000 - 100;
    assert.equal(await react(), 204);
    const h = hold(), p = react(); await h.waiting;
    clock += 200;
    assert.equal(await total(), sent);
    h.release(); assert.equal(await p, 204);
    assert.equal(await total(), sent, "counted in the minute it was sent in");
    clock += 150000;
    assert.equal(await total(), sent, "and in that minute's sum");
  });

  test("a batch that lands after its minute was summed marks the minute and counts at the next read", async () => {
    clock += 5000;
    const m = lib.rx.realMin(clock), top = async () => (await lib.store.st().list({ prefix: "rx/", directories: true })).blobs.map(b => b.key);
    assert.equal(await react(), 204); // a batch that lands, so the minute is summed
    assert.deepEqual((await top()).filter(k => k.startsWith("rx/l")), [], "a batch on time leaves no mark");
    const h = hold(), p = react({ bloom: 2 }); await h.waiting;
    clock += 3 * 60000;
    assert.equal(await total(), sent, "its minute is summed without it");
    assert.deepEqual((await top()).filter(k => k.startsWith(`rx/s${m}~`)), [`rx/s${m}~1~1~1~0`]);
    h.release(); assert.equal(await p, 204);
    assert.equal((await top()).filter(k => k.startsWith(`rx/l${m}~`)).length, 1, "the late batch marked its minute");
    assert.equal(await total(), sent, "counted at the next read");
    const after = await top();
    assert.ok(after.includes(`rx/s${m}~2~1~1~2`) && !after.some(k => k.startsWith("rx/l")), "summed again, and the mark is gone");
    for (let i = 0; i < 3; i++) { clock += 1000; assert.equal(await total(), sent, "and it stays counted"); }
  });

  test("the total never goes down while batches arrive, whatever the rehearsal clock does", async () => {
    for (const hhmm of ["10:30", "10:05", null, "14:10", "10:05", null]) {
      clock += 2000;
      await opIn({ action: "rehearsal", hhmm });
      for (let i = 0; i < 5; i++) {
        const out = await Promise.all([react(), read(), react(), react()]);
        assert.deepEqual([out[0], out[2], out[3]], [204, 204, 204]);
        clock += 9000;
        await total();
      }
    }
    clock += 3 * 60000;
    assert.equal(await total(), sent);
    assert.ok(sent > 200 && sent < 1000, "enough batches, and no total with 4 digits: " + sent);
  });

  test("a state call costs 9 storage operations without reactions, 11 while they flow, at most 13 when a minute is summed", async t => {
    const fresh = await startServer();
    try {
      await openDirect(fresh.dir);
      assert.equal((await counted(read)).ops, 9);
    } finally { await fresh.stop(); await openDirect(P.dir); }
    const steady = costs.filter(([, w]) => w === 0).map(([n]) => n), all = costs.map(([n]) => n);
    assert.ok(steady.length > 50, "most reads write nothing: " + steady.length);
    assert.ok(Math.max(...steady) <= 11, "steady reads: " + steady.join(" "));
    assert.ok(Math.max(...all) <= 13, "all reads: " + all.join(" "));
    const hist = {}; for (const n of all) hist[n] = (hist[n] || 0) + 1;
    t.diagnostic("storage operations per state read: " + Object.entries(hist).map(([n, c]) => `${n} ops x${c}`).join(", "));
  });
});

/* ---------- meet codes and connections (plan section 5.7) ---------- */
describe("meet", () => {
  let P;
  const card = { name: "x", company: "", role: "Founder", looking: ["Funding"], offer: ["Product"], linkedin: "", consent: true };
  const meet = (dev, code) => call(P.base, "POST", "/api/meet", { body: { code }, headers: { "x-dev": dev } });
  const onBoard = async p => {
    const dev = newDev();
    assert.equal((await claim(P.base, dev, { id: pubOf(p), last4: p.last4 })).status, 200);
    assert.equal((await call(P.base, "POST", "/api/profile", { body: card, headers: { "x-dev": dev } })).json.status, "approved");
    const m = (await me(P.base, dev)).json;
    return { dev, pub: m.me.pub, code: m.code };
  };
  let A, B, C;
  before(async () => {
    P = await startServer(); await openDirect(P.dir);
    await op(P.base, { action: "peopleImport", people: SAMPLE });
    A = await onBoard(SAMPLE[0]); B = await onBoard(SAMPLE[1]); C = await onBoard(SAMPLE[2]);
  });
  after(async () => { await P.stop(); await openDirect(S.dir); });

  test("an approved card gets its own 3 digit code, kept when the card changes", async () => {
    for (const x of [A, B, C]) assert.ok(Number.isInteger(x.code) && x.code >= 100 && x.code <= 999, String(x.code));
    assert.equal(new Set([A.code, B.code, C.code]).size, 3);
    await call(P.base, "POST", "/api/profile", { body: { ...card, role: "CEO" }, headers: { "x-dev": A.dev } });
    assert.equal((await me(P.base, A.dev)).json.code, A.code);
    const sn = await snapOf(P.base);
    assert.ok(!JSON.stringify(sn).includes(`"code"`), "codes are never public");
    const s = await openDirect(P.dir);
    assert.equal(await s.get(`code/${A.code}`), A.pub);
  });

  test("we met: both see the connection, the wall gets the link, a second time changes nothing", async () => {
    const v0 = (await state(P.base)).json.snapV;
    const r = await meet(A.dev, B.code);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { ok: true, again: false, person: { id: B.pub, name: "Omar Saleh", company: "Freelance", role: "Founder", linkedin: "" } });
    const st = (await state(P.base)).json;
    assert.equal(st.n.links, 1); assert.notEqual(st.snapV, v0); assert.match(st.snapV, /\.1$/);
    const sn = await snapOf(P.base);
    assert.equal(sn.links.length, 1);
    const [x, y, at] = sn.links[0];
    assert.deepEqual([x, y], [A.pub, B.pub].sort()); assert.ok(Math.abs(at - st.t) < 60000);
    const again = await meet(B.dev, String(A.code));
    assert.equal(again.json.again, true); assert.equal(again.json.person.id, A.pub);
    assert.equal((await state(P.base)).json.n.links, 1);
    const ma = (await me(P.base, A.dev)).json.links, mb = (await me(P.base, B.dev)).json.links;
    assert.deepEqual(ma.map(l => l.id), [B.pub]); assert.deepEqual(mb.map(l => l.id), [A.pub]);
    assert.deepEqual(Object.keys(ma[0]).sort(), ["at", "company", "id", "linkedin", "name", "role"]);
  });

  test("a hidden card takes its links off the wall until it is back", async () => {
    await meet(C.dev, A.code);
    assert.equal((await state(P.base)).json.n.links, 2);
    await op(P.base, { action: "hideProfile", id: C.pub });
    assert.equal((await state(P.base)).json.n.links, 1);
    assert.ok(!(await snapOf(P.base)).links.some(l => l.includes(C.pub)));
    assert.deepEqual((await me(P.base, A.dev)).json.links.map(l => l.id), [B.pub]);
    const r = await meet(A.dev, C.code);
    assert.equal(r.status, 404); assert.equal(r.json.error, "That code is not on the board. Check the number.");
    await op(P.base, { action: "approveProfile", id: C.pub });
    assert.equal((await state(P.base)).json.n.links, 2);
    assert.equal((await me(P.base, C.dev)).json.code, C.code, "the code comes back with the card");
  });

  test("refusals: not on the board, own code, bad code, switched off", async () => {
    const g = newDev();
    await call(P.base, "POST", "/api/profile", { body: { ...card, name: "Guest Person" }, headers: { "x-dev": g } });
    const r = await meet(g, A.code);
    assert.equal(r.status, 409); assert.equal(r.json.error, "Join the Networking Board first.");
    const own = await meet(A.dev, A.code);
    assert.equal(own.status, 400); assert.equal(own.json.error, "That is your own code.");
    for (const code of ["12", "1234", "abc", "099", null]) assert.equal((await meet(A.dev, code)).status, 400, String(code));
    assert.equal((await call(P.base, "POST", "/api/meet", { body: { code: B.code } })).status, 400, "x-dev is required");
    await op(P.base, { action: "flags", name: "meet", on: false });
    assert.equal((await meet(A.dev, C.code)).json.error, "Meeting codes are switched off right now.");
    await op(P.base, { action: "flags", name: "meet", on: true });
  });

  test("5 wrong codes per phone per 10 minutes", async () => {
    const s = await openDirect(P.dir);
    const used = new Set((await s.list({ prefix: "code/" })).blobs.map(b => +b.key.slice(5)));
    const free = []; for (let n = 100; free.length < 6; n++) if (!used.has(n)) free.push(n);
    for (let i = 0; i < 5; i++) assert.equal((await meet(B.dev, free[i])).status, 404);
    const r = await meet(B.dev, C.code);
    assert.equal(r.status, 429); assert.equal(r.json.error, "Too many wrong codes. Try again in a few minutes.");
    assert.equal((await meet(C.dev, B.code)).status, 200, "another phone is not blocked");
  });

  test("at most 60 connections per person", async () => {
    const s = await openDirect(P.dir);
    const D = await onBoard(SAMPLE[3]);
    for (let i = 0; i < 60; i++) { const other = "g" + String(i).padStart(10, "0"); const [x, y] = [D.pub, other].sort(); await s.set(`cx/${x}~${y}~${1000 + i}`, ""); }
    const r = await meet(D.dev, A.code);
    assert.equal(r.status, 429); assert.equal(r.json.error, "You have made 60 connections today. That is the most.");
    const r2 = await meet(A.dev, D.code);
    assert.equal(r2.json.error, "This person has made 60 connections today. That is the most.");
    assert.equal((await state(P.base)).json.n.links, 3, "A and B, A and C, B and C; links with cards that are not on the board are not counted");
  });

  test("codes stay unique when many cards are approved at once", async () => {
    const devs = Array.from({ length: 20 }, () => newDev());
    const pubs = await Promise.all(devs.map(async (d, i) => (await call(P.base, "POST", "/api/profile", { body: { ...card, name: "Guest Number " + i }, headers: { "x-dev": d } })).json.id));
    const res = await Promise.all(pubs.map(id => op(P.base, { action: "approveProfile", id })));
    for (const r of res) assert.equal(r.status, 200, r.text);
    const codes = await Promise.all(devs.map(async d => (await me(P.base, d)).json.code));
    assert.equal(new Set(codes).size, 20); assert.ok(codes.every(c => c >= 100 && c <= 999));
  });
});

/* ---------- takeaways (plan sections 5.7 to 5.9) ---------- */
describe("takeaways", () => {
  let P, L, O, G;
  const send = (dev, body) => call(P.base, "POST", "/api/takeaway", { body, headers: { "x-dev": dev } });
  const at = hhmm => op(P.base, { action: "rehearsal", hhmm });
  before(async () => {
    P = await startServer(); await openDirect(P.dir);
    await op(P.base, { action: "peopleImport", people: SAMPLE });
    L = newDev(); O = newDev(); G = newDev();
    await claim(P.base, L, { id: pubOf(SAMPLE[0]), last4: SAMPLE[0].last4 });
    await claim(P.base, O, { id: pubOf(SAMPLE[1]), last4: SAMPLE[1].last4 });
    await call(P.base, "POST", "/api/guest", { body: { name: "Sami Guest" }, headers: { "x-dev": G } });
  });
  after(async () => { await P.stop(); await openDirect(S.dir); });

  test("each block has its window, the last one stays open until 15:00", async () => {
    const r0 = await send(L, { sid: "1A", rating: 4 });
    assert.equal(r0.status, 409); assert.equal(r0.json.error, "Takeaways for this session open at 11:40.");
    const check = async (hhmm, sid, want, msg) => { await at(hhmm); const r = await send(O, { sid, rating: 3 }); assert.equal(r.status, want, `${hhmm} ${sid}: ${r.text}`); if (msg) assert.equal(r.json.error, msg); };
    await check("11:39", "1B", 409, "Takeaways for this session open at 11:40.");
    await check("11:40", "1B", 200);
    await check("12:19", "1C", 200);
    await check("12:20", "1C", 409, "Takeaways for this session are closed.");
    await check("12:40", "2A", 200);
    await check("13:19", "2A", 200);
    await check("13:20", "2A", 409);
    await check("13:39", "3A", 409, "Takeaways for this session open at 13:40.");
    await check("14:59", "3A", 200);
    await check("15:00", "3B", 409, "Takeaways for this session are closed.");
  });

  test("a verified person's line goes up at once, with the first name only when allowed", async () => {
    await at("11:50");
    const r = await send(L, { sid: "1A", rating: 5, text: "Short pitches win. Lead with the client's problem.", showName: true });
    assert.equal(r.status, 200, r.text); assert.deepEqual(r.json, { ok: true, status: "approved" });
    let sn = await snapOf(P.base);
    const item = sn.takeaways.find(x => x.sid === "1A");
    assert.deepEqual(Object.keys(item).sort(), ["at", "first", "id", "sid", "text"]);
    assert.equal(item.first, "Layla"); assert.match(item.id, /^t[a-f0-9]{10}$/);
    assert.ok(!item.id.includes(pubOf(SAMPLE[0]).slice(1)), "the id does not carry the person id");
    const st = (await state(P.base)).json;
    assert.equal(st.n.takeaways, 1); assert.ok(Math.abs(item.at - st.t) < 60000, "at is in the time base of t");
    const again = await send(L, { sid: "1A", rating: 4, text: "Lead with the problem.", showName: false });
    assert.equal(again.json.status, "approved");
    sn = await snapOf(P.base);
    assert.equal(sn.takeaways.filter(x => x.sid === "1A").length, 1, "a new one replaces the last");
    assert.equal(sn.takeaways.find(x => x.sid === "1A").first, "", "no name when not allowed");
    const mine = (await me(P.base, L)).json.takeaways;
    assert.equal(mine.length, 1);
    assert.deepEqual(mine[0], { sid: "1A", rating: 4, text: "Lead with the problem.", showName: false, status: "approved", at: mine[0].at });
  });

  test("a guest's line waits; the team approves, removes or declines it", async () => {
    const r = await send(G, { sid: "1B", rating: 4, text: "AI will change junior roles first.", showName: true });
    assert.equal(r.json.status, "pending");
    let g = (await opGet(P.base)).json;
    const p = g.pending.takeaways.find(x => x.sid === "1B" && x.text.startsWith("AI will"));
    assert.ok(p); assert.equal(p.first, "Sami"); assert.equal(p.guest, true); assert.equal(p.rating, 4);
    assert.ok(!(await snapOf(P.base)).takeaways.some(x => x.sid === "1B"));
    assert.equal((await op(P.base, { action: "approveTakeaway", sid: "1B", id: p.id, at: p.at + 1 })).status, 409, "a line that changed is not approved");
    assert.equal((await op(P.base, { action: "approveTakeaway", sid: "1B", id: p.id })).status, 200);
    let sn = await snapOf(P.base);
    assert.deepEqual(sn.takeaways.find(x => x.id === p.id), { id: p.id, sid: "1B", text: "AI will change junior roles first.", first: "Sami", at: p.at });
    assert.ok(!(await opGet(P.base)).json.pending.takeaways.some(x => x.id === p.id));
    assert.equal((await op(P.base, { action: "hideTakeaway", sid: "1B", id: p.id })).status, 200);
    assert.ok(!(await snapOf(P.base)).takeaways.some(x => x.id === p.id));
    assert.equal((await me(P.base, G)).json.takeaways[0].status, "hidden");
    await send(G, { sid: "1C", rating: 2, text: "Too fast for me." });
    const q = (await opGet(P.base)).json.pending.takeaways.find(x => x.sid === "1C");
    assert.equal((await op(P.base, { action: "rejectTakeaway", sid: "1C", id: q.id })).status, 200);
    assert.equal((await me(P.base, G)).json.takeaways.find(x => x.sid === "1C").status, "declined");
    const log = (await opGet(P.base)).json.log.map(l => l.what);
    assert.ok(["Approved a takeaway", "Removed a takeaway from the wall", "Declined a takeaway"].every(x => log.includes(x)));
  });

  test("a rating alone needs nobody; trustTakeaways off makes everyone wait", async () => {
    const r = await send(O, { sid: "1A", rating: 3 });
    assert.equal(r.json.status, "none");
    assert.ok(!(await opGet(P.base)).json.pending.takeaways.some(x => x.sid === "1A"));
    await op(P.base, { action: "flags", name: "trustTakeaways", on: false });
    assert.equal((await send(O, { sid: "1A", rating: 3, text: "Good examples." })).json.status, "pending");
    await op(P.base, { action: "flags", name: "trustTakeaways", on: true });
    const anon = await send(newDev(), { sid: "1A", rating: 5, text: "Loved it", showName: true });
    assert.equal(anon.json.status, "pending", "a phone that never signed in waits like a guest");
  });

  test("refusals", async () => {
    const bad = async (body, status, msg) => { const r = await send(L, body); assert.equal(r.status, status, JSON.stringify(body) + " " + r.text); if (msg) assert.equal(r.json.error, msg); };
    await bad({ sid: "9Z", rating: 3 }, 400, "Pick a session.");
    await bad({ sid: "__proto__", rating: 3 }, 400);
    for (const rating of [0, 6, "3", 3.5, null]) await bad({ sid: "1A", rating }, 400, "Tap a rating from 1 to 5.");
    await bad({ sid: "1A", rating: 3, text: 5 }, 400);
    await bad({ sid: "1A", rating: 3, text: "x".repeat(121) }, 400, "Keep it to 120 characters.");
    await bad({ sid: "1A", rating: 3, text: "see www.example.com" }, 422, "Please leave out links.");
    await bad({ sid: "1A", rating: 3, text: "https://x.y" }, 422, "Please leave out links.");
    await bad({ sid: "1A", rating: 3, text: "call 059 123 4567" }, 422, "Please leave out phone numbers.");
    await bad({ sid: "1A", rating: 3, text: "رقمي ٠٥٩١٢٣٤٥٦٧" }, 422, "Please leave out phone numbers.");
    await bad({ sid: "1A", rating: 3, text: "what a shit talk" }, 422, "Please change the wording.");
    assert.equal((await send(L, { sid: "1A", rating: 3, text: "In 2026 we grew 300 percent" })).status, 200, "short numbers are fine");
    assert.equal((await call(P.base, "POST", "/api/takeaway", { body: { sid: "1A", rating: 3 } })).status, 400, "x-dev is required");
    await op(P.base, { action: "flags", name: "takeaways", on: false });
    await bad({ sid: "1A", rating: 3 }, 409, "Takeaways are switched off right now.");
    await op(P.base, { action: "flags", name: "takeaways", on: true });
    for (let i = 0; i < 5; i++) await send(L, { sid: "1C", rating: 3 });
    await bad({ sid: "1C", rating: 4 }, 429, "You have changed this takeaway enough times. Thank you!");
    for (const body of [{ action: "approveTakeaway", sid: "1A", id: "t0000000000" }, { action: "hideTakeaway", sid: "1A", id: "nope" }, { action: "rejectTakeaway", sid: "XX", id: "t0000000000" }]) assert.ok([400, 404].includes((await op(P.base, body)).status), JSON.stringify(body));
    assert.equal((await op(P.base, { action: "approveTakeaway", sid: "1A", id: "t0000000000" })).status, 404);
  });

  test("Repair Lists rebuilds the takeaways from the approval markers", async () => {
    const before = (await snapOf(P.base)).takeaways.map(x => x.id).sort();
    const s = await openDirect(P.dir);
    const cur = await s.get("snap", { type: "json" });
    await s.setJSON("snap", { ...cur, takeaways: [] });
    const r = await op(P.base, { action: "repair" });
    assert.equal(r.json.takeaways, before.length);
    assert.deepEqual((await snapOf(P.base)).takeaways.map(x => x.id).sort(), before);
    await op(P.base, { action: "rehearsal", hhmm: null });
  });
});

/* ---------- the team's tools: exports, team photos, group photo, finale, survey link ---------- */
describe("team tools", () => {
  let P;
  const exp = (what, pin = PIN) => call(P.base, "GET", "/api/export/" + what, { headers: { "x-pin": pin, "x-who": "Test" } });
  const rowsOf = r => r.buf.toString("utf8").replace(/^\ufeff/, "").trim().split("\r\n");
  before(async () => {
    P = await startServer(); await openDirect(P.dir);
    await op(P.base, { action: "peopleImport", people: SAMPLE });
  });
  after(async () => { await P.stop(); await openDirect(S.dir); });

  test("a team upload with the PIN is approved at once, without a device id", async () => {
    const r = await call(P.base, "POST", "/api/photo", { body: JPEG, raw: true, headers: { "content-type": "image/jpeg", "x-pin": PIN, "x-name": "Team", "x-caption": "Group%20photo" } });
    assert.equal(r.status, 200, r.text); assert.equal(r.json.status, "approved");
    assert.ok((await snapOf(P.base)).photos.some(p => p.id === r.json.id && p.caption === "Group photo"));
    assert.equal((await call(P.base, "GET", "/api/photo/" + r.json.id)).status, 200);
    const s = await openDirect(P.dir);
    assert.equal((await s.getMetadata("ph/" + r.json.id)).metadata.pub, "team");
    assert.ok(!(await opGet(P.base)).json.pending.photos.some(p => p.id === r.json.id));
    const bad = await call(P.base, "POST", "/api/photo", { body: JPEG, raw: true, headers: { "content-type": "image/jpeg", "x-pin": "wrong" } });
    assert.equal(bad.status, 401);
  });

  test("trustPhotos lets verified people who agreed to photos skip the queue", async () => {
    const yes = newDev(), no = newDev();
    await claim(P.base, yes, { id: pubOf(SAMPLE[0]), last4: SAMPLE[0].last4 });
    await claim(P.base, no, { id: pubOf(SAMPLE[1]), last4: SAMPLE[1].last4 });
    assert.equal((await upload(P.base, yes)).json.status, "pending", "the switch is off by default");
    await op(P.base, { action: "flags", name: "trustPhotos", on: true });
    assert.equal((await upload(P.base, yes)).json.status, "approved");
    assert.equal((await upload(P.base, no)).json.status, "pending", "this person did not agree to photos");
    assert.equal((await upload(P.base, newDev())).json.status, "pending", "a phone that never signed in waits");
    await op(P.base, { action: "flags", name: "trustPhotos", on: false });
  });

  test("group photo countdown, finale steps and the survey link are public config", async () => {
    assert.equal((await op(P.base, { action: "groupPhoto", secs: 60 })).status, 200);
    let d = (await state(P.base)).json;
    assert.equal(d.cfg.photoAt.secs, 60); assert.ok(Math.abs(d.cfg.photoAt.at - d.t) < 5000);
    await op(P.base, { action: "groupPhoto", secs: null });
    assert.equal((await state(P.base)).json.cfg.photoAt, null);
    for (const secs of [4, 601, "60", 1.5]) assert.equal((await op(P.base, { action: "groupPhoto", secs })).status, 400, String(secs));
    assert.equal((await op(P.base, { action: "finale", step: "voices" })).status, 200);
    d = (await state(P.base)).json;
    assert.equal(d.cfg.finale.step, "voices"); assert.ok(Math.abs(d.cfg.finale.at - d.t) < 5000);
    await op(P.base, { action: "finale", step: null });
    assert.equal((await state(P.base)).json.cfg.finale, null);
    assert.equal((await op(P.base, { action: "finale", step: "dance" })).status, 400);
    assert.equal((await op(P.base, { action: "links", survey: "https://forms.example.org/md26" })).status, 200);
    assert.deepEqual((await state(P.base)).json.cfg.links, { survey: "https://forms.example.org/md26" });
    await op(P.base, { action: "reset" });
    assert.deepEqual((await state(P.base)).json.cfg.links, { survey: "https://forms.example.org/md26" }, "Reset screen controls keeps the link");
    for (const survey of ["http://forms.example.org", "javascript:alert(1)", "forms", "https://x", 5, "https://e.org/" + "x".repeat(300)]) assert.equal((await op(P.base, { action: "links", survey })).status, 400, String(survey));
    await op(P.base, { action: "links", survey: null });
    assert.equal((await state(P.base)).json.cfg.links, null);
    const log = (await opGet(P.base)).json.log.map(l => l.what);
    assert.ok(log.includes("Started a 60 second group photo countdown") && log.includes("Showed the finale step voices") && log.includes("Set the survey link"));
  });

  test("every export is a CSV with a byte order mark, needs the PIN, and is logged", async () => {
    const L = newDev(), O = newDev();
    await claim(P.base, L, { id: pubOf(SAMPLE[0]), last4: SAMPLE[0].last4 });
    await claim(P.base, O, { id: pubOf(SAMPLE[1]), last4: SAMPLE[1].last4 });
    const card = { name: "x", role: "=HYPERLINK(1)", looking: ["Funding"], offer: ["Product"], consent: true };
    for (const d of [L, O]) await call(P.base, "POST", "/api/profile", { body: card, headers: { "x-dev": d } });
    const codeO = (await me(P.base, O)).json.code;
    await call(P.base, "POST", "/api/meet", { body: { code: codeO }, headers: { "x-dev": L } });
    await op(P.base, { action: "rehearsal", hhmm: "11:50" });
    await call(P.base, "POST", "/api/takeaway", { body: { sid: "1A", rating: 5, text: "Pitch, then listen, then \"ask\"", showName: true }, headers: { "x-dev": L } });
    await call(P.base, "POST", "/api/takeaway", { body: { sid: "1A", rating: 2, text: "Too fast", showName: false }, headers: { "x-dev": O } });
    await op(P.base, { action: "pollActivate", pid: "p1" });
    await call(P.base, "POST", "/api/answer", { body: { pid: "p1", text: "focus" }, headers: { "x-dev": L } });
    await call(P.base, "POST", "/api/answer", { body: { pid: "p1", text: "focus" }, headers: { "x-dev": O } });
    for (const what of ["takeaways", "ratings", "polls", "board", "links", "feedback", "signins"]) {
      const r = await exp(what);
      assert.equal(r.status, 200, what);
      assert.equal(r.headers.get("content-type"), "text/csv; charset=utf-8");
      assert.equal(r.headers.get("content-disposition"), `attachment; filename="md26-${what}.csv"`);
      assert.equal(r.headers.get("cache-control"), "no-store");
      assert.deepEqual([...r.buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], what + " starts with a byte order mark");
    }
    const tk = rowsOf(await exp("takeaways"));
    assert.equal(tk[0], "Session,Title,Room,Rating,Takeaway,First name,Status,Time");
    assert.ok(tk.some(l => l.startsWith('1A,Pitching and Outreach to International Clients,Room A,5,"Pitch, then listen, then ""ask""",Layla,approved,2026-11-17 11:50')), tk.join("\n"));
    assert.ok(tk.some(l => l.includes(",2,Too fast,,approved,")), "no first name when it was not allowed");
    const ra = rowsOf(await exp("ratings"));
    assert.ok(ra.includes("1A,Pitching and Outreach to International Clients,Room A,2,3.5,0,1,0,0,1"), ra.join("\n"));
    assert.ok(rowsOf(await exp("polls")).includes("p1,\"In one word, what do you need most to grow?\",focus,2,no"));
    const bd = rowsOf(await exp("board"));
    assert.ok(bd.some(l => l.startsWith("Layla Khoury,Byte Studio,'=HYPERLINK(1),Funding,Product,")), "a formula is made harmless: " + bd.join("\n"));
    assert.ok(rowsOf(await exp("links")).some(l => /^(Layla Khoury,Omar Saleh|Omar Saleh,Layla Khoury),2026-/.test(l)));
    const si = rowsOf(await exp("signins"));
    assert.equal(si[0], "Name,Kind,First sign in,Here on the day,Phones");
    assert.ok(si.some(l => l.startsWith("Layla Khoury,person,") && l.endsWith(",2")), si.join("\n"));
    assert.equal((await exp("people")).status, 404);
    assert.equal((await exp("takeaways", "wrong")).status, 401);
    assert.equal((await call(P.base, "GET", "/api/export/takeaways")).status, 401);
    assert.ok((await opGet(P.base)).json.log.some(l => l.what === "Exported takeaways"));
    await op(P.base, { action: "rehearsal", hhmm: null });
  });
});

/* ---------- alerts (plan section 5.10), against a local stub of the Telegram API ---------- */
describe("alerts", () => {
  let P, stub, sent = [], mode = "ok";
  const NAMES = [...SAMPLE.map(p => p.name), "Sami", "Layla", "Omar"];
  before(async () => {
    stub = http.createServer((req, res) => {
      let body = ""; req.on("data", c => { body += c; });
      req.on("end", () => {
        if (mode === "hang") return; // never answers: the server must give up after 2.5 seconds
        sent.push({ url: req.url, body: JSON.parse(body) }); res.writeHead(mode === "fail" ? 500 : 200); res.end("{}");
      });
    });
    stub.listen(0, "127.0.0.1"); await once(stub, "listening");
    P = await startServer(BEFORE_DAY, { ALERT_TELEGRAM_BOT: "testbot", ALERT_TELEGRAM_CHAT: "-100", ALERT_TELEGRAM_API: `http://127.0.0.1:${stub.address().port}` });
    await openDirect(P.dir);
    await op(P.base, { action: "peopleImport", people: SAMPLE });
  });
  after(async () => { await P.stop(); stub.closeAllConnections(); stub.close(); await openDirect(S.dir); });
  const last = () => sent[sent.length - 1];

  test("photos waiting: one message with the count and the remote link, then quiet for 3 minutes", async () => {
    assert.equal((await upload(P.base, newDev())).status, 200);
    assert.equal(sent.length, 1);
    assert.equal(last().url, "/bottestbot/sendMessage");
    assert.equal(last().body.chat_id, "-100");
    assert.equal(last().body.text, `1 photo is waiting for approval. ${P.base}/remote/`);
    await upload(P.base, newDev());
    assert.equal(sent.length, 1, "no second message within 3 minutes");
  });

  test("a guest card or takeaway waiting, a locked person, a wall error, 50 wrong PINs", async () => {
    const g = newDev();
    await call(P.base, "POST", "/api/guest", { body: { name: "Sami Guest" }, headers: { "x-dev": g } });
    await call(P.base, "POST", "/api/profile", { body: { name: "Sami Guest", role: "Founder", looking: ["Funding"], consent: true }, headers: { "x-dev": g } });
    assert.equal(last().body.text, `1 card or takeaway is waiting for approval. ${P.base}/remote/`);
    for (let i = 0; i < 10; i++) await claim(P.base, newDev(), { id: pubOf(SAMPLE[2]), last4: String(5000 + i) });
    assert.equal(last().body.text, `Someone is locked out of sign in and needs Unlock. ${P.base}/remote/`);
    const n = sent.length;
    await call(P.base, "POST", "/api/beat", { body: { w: 1920, h: 1080, err: "" } });
    assert.equal(sent.length, n, "a beat without an error says nothing");
    await call(P.base, "POST", "/api/beat", { body: { w: 1920, h: 1080, err: "TypeError: x is undefined" } });
    assert.equal(last().body.text, `The wall reported an error. ${P.base}/remote/`);
    for (let i = 0; i < 50; i++) await opGet(P.base, "wrong" + i);
    assert.equal(last().body.text, `50 wrong PINs in the last 10 minutes. ${P.base}/remote/`);
    assert.equal(sent.length, n + 2);
    for (const m of sent) for (const name of NAMES) assert.ok(!m.body.text.includes(name), "an alert never carries a name: " + m.body.text);
  });

  test("a failing or silent Telegram never fails the request", async () => {
    const s = await openDirect(P.dir);
    const clear = async () => { for (const b of (await s.list({ prefix: "alert/" })).blobs) await s.delete(b.key); };
    await clear(); mode = "fail";
    assert.equal((await upload(P.base, newDev())).status, 200);
    await clear(); mode = "hang";
    const t0 = Date.now();
    const r = await upload(P.base, newDev());
    assert.equal(r.status, 200);
    assert.ok(Date.now() - t0 < 4000, "the alert gives up after 2.5 seconds: " + (Date.now() - t0));
    mode = "ok";
  });

  test("without the two settings nothing is sent and nothing is written", async () => {
    const s = await openDirect(S.dir);
    await upload(S.base, newDev());
    await call(S.base, "POST", "/api/beat", { body: { err: "boom" } });
    assert.equal((await s.list({ prefix: "alert/" })).blobs.length, 0);
  });
});

/* ---------- after the event: feedback, Remove My Data, the calendar file ---------- */
describe("feedback, forget and ics", () => {
  let P;
  const fb = (dev, body) => call(P.base, "POST", "/api/feedback", { body, headers: { "x-dev": dev } });
  before(async () => { P = await startServer(); await openDirect(P.dir); await op(P.base, { action: "peopleImport", people: SAMPLE }); });
  after(async () => { await P.stop(); await openDirect(S.dir); });

  test("feedback opens after the event, one per person, never with a name in the export", async () => {
    const d = newDev();
    await claim(P.base, d, { id: pubOf(SAMPLE[4]), last4: SAMPLE[4].last4 });
    const early = await fb(d, { overall: 5 });
    assert.equal(early.status, 409); assert.equal(early.json.error, "Feedback opens after the event.");
    await op(P.base, { action: "rehearsal", hhmm: "15:30" });
    assert.equal((await state(P.base)).json.phase, "after");
    assert.deepEqual((await fb(d, { overall: 4, recommend: 9, text: "More time for one to ones." })).json, { ok: true });
    assert.equal((await fb(d, { overall: 5, recommend: 10, text: "More time for one to ones, please." })).status, 200, "a new one replaces it");
    const m = (await me(P.base, d)).json.feedback;
    assert.deepEqual({ ...m, at: 0 }, { overall: 5, recommend: 10, text: "More time for one to ones, please.", at: 0 });
    for (const body of [{ overall: 0 }, { overall: 6 }, { overall: "5" }, { overall: 5, recommend: 11 }, { overall: 5, recommend: 2.5 }, { overall: 5, text: 3 }, { overall: 5, text: "x".repeat(301) }]) assert.equal((await fb(d, body)).status, 400, JSON.stringify(body));
    assert.equal((await call(P.base, "POST", "/api/feedback", { body: { overall: 5 } })).status, 400, "x-dev is required");
    const csv = (await call(P.base, "GET", "/api/export/feedback", { headers: { "x-pin": PIN } })).buf.toString("utf8");
    assert.ok(csv.includes('5,10,"More time for one to ones, please.",2026-11-17 15:30'), csv);
    assert.ok(!csv.includes("Dina"));
    await op(P.base, { action: "rehearsal", hhmm: null });
  });

  test("Remove My Data takes card, code, links, stars, hellos, lines and name, keeps the rating", async () => {
    const a = newDev(), a2 = newDev(), b = newDev(), layla = SAMPLE[0], pa = pubOf(layla);
    await op(P.base, { action: "rehearsal", hhmm: "11:50" });
    await claim(P.base, a, { id: pa, last4: layla.last4, hello: true });
    await claim(P.base, a2, { id: pa, last4: layla.last4 });
    await claim(P.base, b, { id: pubOf(SAMPLE[1]), last4: SAMPLE[1].last4 });
    const card = { name: "x", role: "Founder", looking: ["Funding"], offer: ["Product"], consent: true };
    for (const d of [a, b]) await call(P.base, "POST", "/api/profile", { body: card, headers: { "x-dev": d } });
    const codeB = (await me(P.base, b)).json.code, codeA = (await me(P.base, a)).json.code;
    await call(P.base, "POST", "/api/meet", { body: { code: codeB }, headers: { "x-dev": a } });
    await call(P.base, "POST", "/api/star", { body: { b: 2, sid: "2A" }, headers: { "x-dev": a } });
    await call(P.base, "POST", "/api/takeaway", { body: { sid: "1A", rating: 5, text: "Know your buyer.", showName: true }, headers: { "x-dev": a } });
    let st = (await state(P.base)).json;
    assert.equal(st.n.links, 1); assert.ok(st.hello.some(h => h.f === "Layla")); assert.equal(st.interest["2A"], 1); assert.equal(st.n.takeaways, 1);
    const r = await call(P.base, "POST", "/api/forget", { headers: { "x-dev": a } });
    assert.deepEqual(r.json, { ok: true });
    st = (await state(P.base)).json;
    assert.equal(st.n.links, 0); assert.ok(!st.hello.some(h => h.f === "Layla")); assert.equal(st.interest["2A"], undefined); assert.equal(st.n.takeaways, 0);
    const sn = await snapOf(P.base);
    assert.ok(!sn.profiles.some(x => x.id === pa)); assert.ok(!JSON.stringify(sn).includes("Know your buyer"));
    for (const d of [a, a2]) { const m = (await me(P.base, d)).json; assert.equal(m.status, "none", "every phone of the person is signed out"); assert.equal(m.profile, null); }
    assert.equal((await call(P.base, "POST", "/api/meet", { body: { code: codeA }, headers: { "x-dev": b } })).status, 404, "the code is gone");
    const csv = (await call(P.base, "GET", "/api/export/ratings", { headers: { "x-pin": PIN } })).buf.toString("utf8");
    assert.ok(csv.includes("1A,Pitching and Outreach to International Clients,Room A,1,5,0,0,0,0,1"), "the rating stays: " + csv);
    const tk = (await call(P.base, "GET", "/api/export/takeaways", { headers: { "x-pin": PIN } })).buf.toString("utf8");
    assert.ok(!tk.includes("Know your buyer") && !tk.includes("Layla"));
    const people = (await opGet(P.base)).json;
    assert.ok(!people.people.list.some(x => x.id === pa)); assert.ok(people.log.some(l => l.who === "A phone" && l.what === "Removed its data"));
    assert.equal((await call(P.base, "POST", "/api/forget")).status, 400, "x-dev is required");
    assert.equal((await call(P.base, "POST", "/api/forget", { headers: { "x-dev": newDev() } })).status, 200, "a phone with nothing to remove is fine");
    await op(P.base, { action: "rehearsal", hhmm: null });
  });

  test("the calendar file has the chosen sessions in UTC with a 5 minute alarm", async () => {
    const r = await call(P.base, "GET", "/api/ics?s=1A,3B,1A");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "text/calendar; charset=utf-8");
    assert.equal(r.headers.get("content-disposition"), 'attachment; filename="mentorship-day.ics"');
    const text = r.buf.toString("utf8");
    assert.ok(text.startsWith("BEGIN:VCALENDAR\r\n") && text.endsWith("END:VCALENDAR\r\n"));
    for (const line of text.split("\r\n")) assert.ok(Buffer.byteLength(line) <= 75, "folded: " + line);
    const flat = text.replace(/\r\n /g, "");
    assert.equal((flat.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.ok(flat.includes("DTSTART:20261117T090000Z\r\nDTEND:20261117T094500Z"), "11:00 to 11:45 in Birzeit is 09:00 to 09:45 UTC");
    assert.ok(flat.includes("DTSTART:20261117T110000Z\r\nDTEND:20261117T114500Z"));
    assert.ok(flat.includes("SUMMARY:Pitching and Outreach to International Clients"));
    assert.ok(flat.includes("LOCATION:Room A\\, Palestine TechnoPark\\, Birzeit"));
    assert.ok(flat.includes("With Gigi Aulsebrook. The advisor joins online. Mentorship Day 2026 by Gaza Sky Geeks\\, a program of Mercy Corps"));
    assert.equal((flat.match(/TRIGGER:-PT5M/g) || []).length, 2);
    const day = (await call(P.base, "GET", "/api/ics")).buf.toString("utf8").replace(/\r\n /g, "");
    assert.ok(day.includes("SUMMARY:Mentorship Day 2026") && day.includes("DTSTART:20261117T073000Z") && day.includes("DTEND:20261117T130000Z"));
    assert.equal((await call(P.base, "GET", "/api/ics?s=1A,9Z")).status, 400);
    assert.equal((await call(P.base, "GET", "/api/ics?s=__proto__")).status, 400);
    await openDirect(P.dir);
    const fn = (await import("../netlify/functions/ics.mjs")).default;
    const h = (await fn(new Request("http://localhost/api/ics?s=2A"))).headers;
    assert.match(h.get("netlify-cdn-cache-control"), /maxage=3600/); assert.equal(h.get("netlify-vary"), "query=s");
  });
});

/* ---------- stars, interest and Picked for You (plan section 5.11) ---------- */
describe("stars and picks", () => {
  let P, s, n = 0;
  // A person made for one test: a sample name with its own made up number, so every test has a fresh person.
  const person = (name, extra = {}) => ({ name, last4: String(4000 + (++n)), company: "", title: "", topics: [], advisorPref: "", ...extra });
  const signIn = async (p, dev = newDev()) => { const r = await claim(P.base, dev, { id: pubOf(p), last4: p.last4 }); assert.equal(r.status, 200, r.text); return { ...r.json, dev }; };
  const load = async list => { const r = await op(P.base, { action: "peopleImport", people: list }); assert.equal(r.status, 200, r.text); };
  const clearStars = async () => { const { blobs } = await s.list({ prefix: "star/" }); await Promise.all(blobs.map(b => s.delete(b.key))); };
  const fill = async (sid, count) => { const b = sid[0]; for (let i = 0; i < count; i++) await s.set(`star/${b}/g${String(i).padStart(10, "0")}/${sid}~own`, ""); };
  const star = (dev, body) => call(P.base, "POST", "/api/star", { body, headers: { "x-dev": dev } });
  const sids = stars => Object.fromEntries(Object.entries(stars).map(([b, x]) => [b, x.sid]));
  before(async () => { P = await startServer(); s = await openDirect(P.dir); });
  beforeEach(async () => { if (s) await clearStars(); });
  after(async () => { await P.stop(); await openDirect(S.dir); });

  test("a star per block, own, replaced by the next, removed with null, counted in interest", async () => {
    const d = newDev();
    let r = await star(d, { b: 1, sid: "1A" });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.json, { ok: true, stars: { 1: { sid: "1A", by: "own", why: null } } });
    r = await star(d, { b: 1, sid: "1B" });
    assert.deepEqual(sids(r.json.stars), { 1: "1B" });
    await star(d, { b: 3, sid: "3C" });
    assert.deepEqual((await state(P.base)).json.interest, { "1B": 1, "3C": 1 });
    r = await star(d, { b: 1, sid: null });
    assert.deepEqual(sids(r.json.stars), { 3: "3C" });
    assert.deepEqual((await state(P.base)).json.interest, { "3C": 1 });
    assert.deepEqual((await me(P.base, d)).json.stars, { 3: { sid: "3C", by: "own", why: null } }, "a phone that never signed in can star");
    for (const body of [{ b: 4, sid: "1A" }, { b: "1", sid: "1A" }, { b: 1, sid: "2A" }, { b: 1, sid: "9Z" }, { b: 1 }, { b: 2, sid: ["2A"] }]) assert.equal((await star(d, body)).status, 400, JSON.stringify(body));
    assert.equal((await call(P.base, "POST", "/api/star", { body: { b: 1, sid: "1A" } })).status, 400, "x-dev is required");
  });

  test("rule 1: 3 points per topic, plus 1 when the delivery fits the advisor preference", async () => {
    const a = person("Layla Khoury", { topics: ["Business development and international sales", "AI adoption and applied AI", "Engineering leadership and architecture"], advisorPref: "remote" });
    const b = person("Omar Saleh", { topics: ["Business development and international sales", "AI adoption and applied AI"], advisorPref: "remote" });
    const c = person("Rana Odeh", { advisorPref: "remote" });
    await load([a, b, c]);
    // a: 1A 3+1, 1B 3+3, 1C 3+1; 2A nothing; 3A 0+1, 3B 3
    const ra = await signIn(a);
    assert.deepEqual(ra.stars, { 1: { sid: "1B", by: "auto", why: "AI adoption and applied AI" }, 3: { sid: "3B", by: "auto", why: "Engineering leadership and architecture" } });
    await clearStars();
    // b: 1A 3+1 beats 1B 3, because of the preference point; 3A is Online, so it scores 1
    assert.deepEqual(sids((await signIn(b)).stars), { 1: "1A", 3: "3A" });
    await clearStars();
    // c: the preference alone scores 1: Online sessions only, and the reason is empty
    const rc = await signIn(c);
    assert.deepEqual(rc.stars, { 1: { sid: "1A", by: "auto", why: null }, 3: { sid: "3A", by: "auto", why: null } });
  });

  test("rule 2: a tie goes to fewer people planning to join, then to room order", async () => {
    const d = person("Dina Haddad", { topics: ["Business development and international sales"] });
    const e = person("Karim Nasser", { topics: ["Business development and international sales"] });
    await load([d, e]);
    assert.deepEqual(sids((await signIn(d)).stars), { 1: "1A" }, "1A and 1C score 3, same interest, Room A first");
    assert.deepEqual(sids((await signIn(e)).stars), { 1: "1C" }, "1A now has one more person planning to join");
    assert.deepEqual((await state(P.base)).json.interest, { "1A": 1, "1C": 1 }, "automatic picks count as planning to join");
  });

  test("rule 3: a session as full as its seats is skipped for the next best", async () => {
    const f = person("Yousef Amin", { topics: ["AI adoption and applied AI", "Business development and international sales"] });
    const g = person("Layla Khoury", { topics: ["AI adoption and applied AI"] });
    await load([f, g]);
    await fill("1B", 25);
    assert.equal((await state(P.base)).json.interest["1B"], 25);
    assert.deepEqual(sids((await signIn(f)).stars), { 1: "1A" }, "1B is full, 1A and 1C score 3, Room A first");
    assert.deepEqual((await signIn(g)).stars, {}, "1B is full and nothing else scores above zero");
  });

  test("rule 4: nothing scores above zero, so there is no pick", async () => {
    const h = person("Rana Odeh");
    const i = person("Omar Saleh", { advisorPref: "local", topics: ["Product management and strategy"] });
    await load([h, i]);
    const rh = await signIn(h);
    assert.deepEqual(rh.stars, {});
    assert.deepEqual((await me(P.base, rh.dev)).json.stars, {});
    assert.deepEqual(sids((await signIn(i)).stars), { 1: "1B", 2: "2A", 3: "3B" }, "local preference: In person sessions score 1, 2A scores 3+1");
  });

  test("rule 5: a room assigned by the team wins, as team, and cannot be changed by the person", async () => {
    const j = person("Karim Nasser", { topics: ["AI adoption and applied AI", "Fundraising, finance, and scaling a company"], rooms: { 1: "Room C" } });
    await load([j]);
    const r = await signIn(j);
    assert.deepEqual(r.stars, { 1: { sid: "1C", by: "team", why: null }, 3: { sid: "3A", by: "auto", why: "Fundraising, finance, and scaling a company" } });
    assert.deepEqual(r.me.rooms, { 1: "1C" });
    const no = await star(r.dev, { b: 1, sid: "1B" });
    assert.equal(no.status, 409); assert.equal(no.json.error, "Your seat in this block was set by the team. Ask at the registration desk to change it.");
    assert.equal((await star(r.dev, { b: 1, sid: null })).status, 409);
    assert.equal((await star(r.dev, { b: 3, sid: "3B" })).status, 200, "other blocks stay free");
    assert.deepEqual((await state(P.base)).json.interest, { "1C": 1, "3B": 1 });
    // a new import moves the seat for a person who signed in already
    await load([{ ...j, rooms: { 1: "1A" } }]);
    assert.deepEqual(sids((await me(P.base, r.dev)).json.stars), { 1: "1A", 3: "3B" });
    assert.deepEqual((await state(P.base)).json.interest, { "1A": 1, "3B": 1 });
    await load([{ ...j, rooms: {} }]);
    assert.deepEqual(sids((await me(P.base, r.dev)).json.stars), { 3: "3B" }, "a seat taken away leaves the block empty, no new pick");
  });

  test("rule 6: picks are made once, and a choice by the person is never overwritten", async () => {
    const k = person("Dina Haddad", { topics: ["Business development and international sales", "Career growth and remote work"] });
    await load([k]);
    const first = await signIn(k);
    assert.deepEqual(sids(first.stars), { 1: "1A", 3: "3B" }, "3B and 3C tie at 3, Room B comes first");
    // Keep turns the pick into own; another choice is own too
    assert.deepEqual((await star(first.dev, { b: 1, sid: "1A" })).json.stars[1], { sid: "1A", by: "own", why: null });
    assert.deepEqual((await star(first.dev, { b: 3, sid: null })).json.stars, { 1: { sid: "1A", by: "own", why: null } });
    await fill("1A", 30);
    await call(P.base, "POST", "/api/signout", { headers: { "x-dev": first.dev } });
    const again = await signIn(k, first.dev);
    assert.deepEqual(again.stars, { 1: { sid: "1A", by: "own", why: null } }, "no new picks on a later sign in, the empty block stays empty");
    const second = await signIn(k);
    assert.deepEqual(sids(second.stars), { 1: "1A" }, "a second phone sees the same stars and makes no picks");
  });

  test("the picks switch turns picking off", async () => {
    const l = person("Omar Saleh", { topics: ["AI adoption and applied AI"] });
    await load([l]);
    await op(P.base, { action: "flags", name: "picks", on: false });
    assert.deepEqual((await signIn(l)).stars, {});
    await op(P.base, { action: "flags", name: "picks", on: true });
  });
});

/* ---------- privacy ---------- */
describe("privacy", () => {
  test("every public route, read by a stranger after all of the above", async () => {
    const st = await state(S.base);
    const sn = await call(S.base, "GET", "/api/snap?v=" + st.json.snapV);
    await call(S.base, "GET", "/api/snap");
    for (const p of sn.json.photos) assert.equal((await call(S.base, "GET", "/api/photo/" + p.id)).status, 200);
    for (const p of sn.json.profiles) assert.match(p.id, /^[pg][a-f0-9]{10}$/);
    await call(S.base, "GET", "/api/profile", { headers: { "x-dev": newDev() } });
    await opGet(S.base);
    assert.ok(sn.json.photos.length >= 1 && sn.json.profiles.length >= 1, "the sweep saw real data");
  });

  test("no response carries k4, a last 4 digits value, or a bare person id", async () => {
    await openDirect(S.dir);
    const { personId, k4Of } = lib.ids;
    const people = [...new Map(IMPORTED.map(r => [r.name + "|" + r.last4, r])).values()];
    assert.ok(people.length >= 20, "the tests imported many people: " + people.length);
    const scan = (r, hits = []) => {
      const text = r.text + "\n" + r.headers;
      const utf = Buffer.from(r.text, "latin1").toString("utf8");
      for (const p of people) {
        const pid = personId(p.name, p.last4), k4 = k4Of(pid, p.last4);
        if (text.includes(k4)) hits.push(`${r.method} ${r.url} carries the k4 of ${p.name}`);
        if (new RegExp(`(?<![0-9a-fA-F])${p.last4}(?![0-9a-fA-F])`).test(utf)) hits.push(`${r.method} ${r.url} carries the digits ${p.last4}`);
        if (new RegExp(`(?<!p)${pid}`).test(text)) hits.push(`${r.method} ${r.url} carries the bare person id of ${p.name}`);
      }
      if (/"(k4|last4)"/.test(utf)) hits.push(`${r.method} ${r.url} has a k4 or last4 field`);
      return hits;
    };
    // the scan itself catches each kind of leak
    const lp = personId(SAMPLE[0].name, SAMPLE[0].last4);
    for (const leak of [`{"n":"${SAMPLE[0].last4}"}`, `{"k":"${k4Of(lp, SAMPLE[0].last4)}"}`, `{"id":"${lp}"}`, `{"id":"x${lp}"}`, `{"last4":1}`]) assert.equal(scan({ method: "TEST", url: leak, text: leak, headers: "" }).length > 0, true, leak);
    assert.deepEqual(scan({ method: "TEST", url: "", text: `{"id":"p${lp}","at":1794500687724}`, headers: "" }), []);
    const hits = [];
    for (const r of seen) scan(r, hits);
    assert.deepEqual(hits, []);
  });

  test("no response to any client carries a device id", () => {
    assert.ok(DEVS.size >= 15, "the test used many devices: " + DEVS.size);
    assert.ok(seen.length >= 150, "the test recorded many responses: " + seen.length);
    const hits = [];
    for (const r of seen) for (const d of DEVS) if (r.text.includes(d) || r.headers.includes(d)) hits.push(`${r.method} ${r.url} (${r.status}) carries ${d}`);
    assert.deepEqual(hits, []);
  });
});
