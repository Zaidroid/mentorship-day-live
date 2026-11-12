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
    await call(S.base, "POST", "/api/answer", { body: { pid: "p1", text: "clarity", dev: newDev() } });
    await op(S.base, { action: "hideWord", word: "secretword" });
    await call(S.base, "POST", "/api/answer", { body: { pid: "p1", text: "secretword", dev: newDev() } });
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
    assert.deepEqual(d.cfg.flags, { trustProfiles: true, trustTakeaways: true, trustPhotos: false });
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
        await op(S.base, { action: "showWord", word: "secretword" });
  });

  test("on Netlify the CDN keeps state for 2 seconds", async () => {
    await openDirect(S.dir);
    const fn = (await import("../netlify/functions/state.mjs")).default;
    const r = await fn(new Request("http://localhost/api/state"));
    assert.match(r.headers.get("netlify-cdn-cache-control"), /s-maxage=2\b/);
  });
});

describe("photos and the snapshot", () => {
  let id, dev;
  test("an upload waits, and only the team sees it", async () => {
    dev = newDev();
    const r = await upload(S.base, dev);
    assert.equal(r.status, 200, r.text); id = r.json.id;
    const pub = await call(S.base, "GET", "/api/photo/" + id);
    assert.equal(pub.status, 404);
    const team = await call(S.base, "GET", "/api/photo/" + id, { headers: { "x-pin": PIN } });
    assert.equal(team.status, 200); assert.equal(team.headers.get("content-type"), "image/jpeg");
    assert.equal(team.headers.get("cache-control"), "no-store");
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
    assert.equal(img.status, 200); assert.match(img.headers.get("cache-control"), /immutable/);
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
    const d = newDev(), ans = (body, h = { "x-dev": d }) => call(S.base, "POST", "/api/answer", { body: h["x-dev"] ? { ...body, dev: h["x-dev"] } : body });
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
    await call(W.base, "POST", "/api/answer", { body: { pid: "p1", text: "growth", dev: d } });
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
    assert.deepEqual(g.cfg.flags, { trustProfiles: true, trustTakeaways: true, trustPhotos: false });
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
