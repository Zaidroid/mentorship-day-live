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
  if (!lib) lib = { store: await import("../netlify/lib/store.mjs"), ids: await import("../netlify/lib/ids.mjs"), day: await import("../netlify/lib/day.mjs") };
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
    assert.deepEqual(Object.keys(d.cfg).sort(), ["ann", "at", "finale", "flags", "mode", "overlay", "photoAt", "pin", "reloadAt", "speaker", "theme", "video", "way"]);
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
    assert.deepEqual(d.videos.map(v => v.id), ["tareq", "kassim"]);
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
    await op(S.base, { action: "video", id: "tareq" });
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
    await op(W.base, { action: "way", way: { registration: "left", rooms: "up right" } });
    await op(W.base, { action: "pollAdd", q: "What did you learn today?", type: "words" });
    await op(W.base, { action: "mode", mode: "lunch" });
    await op(W.base, { action: "hideWord", word: "growth" });
    await op(W.base, { action: "flags", name: "trustPhotos", on: true });
    await op(W.base, { action: "rehearsal", hhmm: "11:00" });
    await opGet(W.base, "wrong");
    await call(W.base, "POST", "/api/beat", { body: { w: 1920, h: 1080 } });
    const s = await openDirect(W.dir);
    await s.setJSON("people", [{ id: "0123456789", name: "Sample Person" }]);
    for (const k of ["who/" + d, "dv/g0123456789/" + d, "here/g0123456789", "hi/1~g0123456789~Layla", "fail/0123456789/" + d + "~1", "star/1/g0123456789/1A~own", "rx/1/" + d + "~1~0~0~ab", "rxt/1/1~ab", "code/123", "cx/ga~gb~1", "tk/1A/g0123456789", "fb/g0123456789"]) await s.set(k, "x");
    assert.equal((await op(W.base, { action: "wipe", phrase: "reset md26" })).status, 400);
    assert.equal((await op(W.base, { action: "wipe" })).status, 400);
    const r = await op(W.base, { action: "wipe", phrase: "RESET MD26" });
    assert.equal(r.status, 200, r.text); assert.ok(r.json.deleted >= 20, String(r.json.deleted));
    const keys = (await s.list()).blobs.map(b => b.key);
    assert.deepEqual(keys.filter(k => !k.startsWith("log/")).sort(), ["cfg", "people", "polls", "snap"]);
    const g = (await opGet(W.base)).json;
    assert.deepEqual(g.log.map(l => l.what), ["Wiped the test data"]);
    assert.deepEqual(g.cfg.way, { registration: "left", rooms: "up right" });
    assert.equal(g.cfg.mode, "auto"); assert.deepEqual(g.cfg.hidden, []); assert.equal(g.cfg.rehearsal, null);
    assert.deepEqual(g.cfg.flags, ALL_FLAGS);
    assert.ok(g.polls.some(x => x.q === "What did you learn today?"));
    assert.equal(g.screen, null); assert.deepEqual(g.pending, { photos: [], profiles: [] });
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
    await ok({ action: "way", way: { registration: "left", rooms: "sideways" } }, c => assert.deepEqual(c.way, { registration: "left" }));
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
    assert.ok(!g.polls.some(x => x.id === np.id)); assert.equal(g.cfg.poll, null);
    assert.equal((await state(S.base)).json.poll, null);
    await op(S.base, { action: "pollActivate", pid: "p1" });
  });

  test("the sheet proxy knows only its three tabs", async () => {
    assert.equal((await call(S.base, "GET", "/api/sheet/people")).status, 404);
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

  test("no response to any client carries a device id", () => {
    assert.ok(DEVS.size >= 15, "the test used many devices: " + DEVS.size);
    assert.ok(seen.length >= 150, "the test recorded many responses: " + seen.length);
    const hits = [];
    for (const r of seen) for (const d of DEVS) if (r.text.includes(d) || r.headers.includes(d)) hits.push(`${r.method} ${r.url} (${r.status}) carries ${d}`);
    assert.deepEqual(hits, []);
  });
});
