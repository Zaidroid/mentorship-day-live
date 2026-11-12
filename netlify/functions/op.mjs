// Operator remote API. Every call needs the team PIN. Every change is logged with who made it.
import { st, update, readCfg, updateCfg, mergeCfg, readPolls, updatePolls, readSnap, updateSnap, putItem, dropItem, photoItem, profileItem, tally, log, readLog, pinOk, whoOf, idOk, clean, J, Refuse, readBody, countPinFail, pinFails, VIDEOS, FLAGS, rebuild, wipeAll, readBeat } from "../lib/store.mjs";
import { pubOk, personPub } from "../lib/ids.mjs";
import { nowMs, realNow, rehearsalOn, rehearsalFor, isEventDay, localMin } from "../lib/day.mjs";
import { readPeople, personFrom, personOf, syncTeam, PEOPLE_MAX } from "../lib/people.mjs";
import { pollNow, autoNow } from "../lib/rules.mjs";
import { approveCard, unlistCard } from "../lib/board.mjs";

const MODES = ["auto", "welcome", "opening", "video", "choose", "live", "lunch", "close"];
const SCENES = ["rooms", "choose", "board", "spotlight", "advisors", "meet", "photos", "poll", "pulse", "way", "welcome", "speaker", "recap", "thanks"];
const DIRS = ["left", "right", "up", "down", "up left", "up right", "down left", "down right", ""];

async function pendingPhotos(s) {
  const ids = (await s.list({ prefix: "q/ph/" })).blobs.map(b => b.key.slice(5));
  const out = [];
  for (const id of ids) { const m = await s.getMetadata(`ph/${id}`); if (m) out.push({ id, name: m.metadata.name, caption: m.metadata.caption, at: m.metadata.at }); }
  return out.sort((a, b) => a.at - b.at);
}
// People for the remote: how many, who signed in (people and guests), who is locked out.
// Names only: no number, no k4, no device id. Guest names come from their sig/ record.
async function peopleInfo(s) {
  const [people, sig, here, fail] = await Promise.all([readPeople(s), s.list({ prefix: "sig/" }), s.list({ prefix: "here/" }), s.list({ prefix: "fail/" })]);
  const hereSet = new Set(here.blobs.map(b => b.key.slice(5)));
  const pubs = sig.blobs.map(b => b.key.slice(4)).filter(pubOk);
  const list = (await mapLimit(pubs, 16, async pub => {
    if (pub[0] === "p") { const p = personOf(people, pub.slice(1)); return { id: pub, name: p ? p.name : "", kind: "person", here: hereSet.has(pub) }; }
    const g = await s.get(`sig/${pub}`, { type: "json" });
    return { id: pub, name: (g && g.name) || "", kind: "guest", here: hereSet.has(pub) };
  })).sort((a, b) => a.name.localeCompare(b.name));
  const tries = new Map();
  for (const b of fail.blobs) {
    const m = /^fail\/([a-f0-9]{10})\/([a-z0-9]+)~/i.exec(b.key); if (!m) continue;
    const t = tries.get(m[1]) || { all: 0, dev: new Map() };
    t.all++; t.dev.set(m[2], (t.dev.get(m[2]) || 0) + 1); tries.set(m[1], t);
  }
  const locked = [];
  for (const [pid, t] of tries) {
    const most = Math.max(...t.dev.values());
    if (t.all >= 10 || most >= 5) { const p = personOf(people, pid); locked.push({ id: personPub(pid), name: p ? p.name : "", tries: t.all, all: t.all >= 10 }); }
  }
  return { count: people.length, signedIn: list.filter(x => x.kind === "person").length, guests: list.filter(x => x.kind === "guest").length, here: hereSet.size, locked, list };
}
async function mapLimit(items, n, fn) { const out = []; for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn))); return out; }

async function pendingProfiles(s) {
  const ids = (await s.list({ prefix: "q/pr/" })).blobs.map(b => b.key.slice(5));
  const out = [];
  for (const id of ids.filter(pubOk)) { const p = await s.get(`pr/${id}`, { type: "json" }); if (p) out.push({ ...p, id }); }
  return out.sort((a, b) => a.at - b.at);
}

export default async (req) => {
  if (!pinOk(req)) { await countPinFail(st()).catch(() => {}); return J({ error: "Wrong PIN." }, 401); }
  const s = st(), who = whoOf(req);

  if (req.method === "GET") {
    const [cfg, polls, snap, photos, profiles, logl, screen, people] = await Promise.all([readCfg(s), readPolls(s), readSnap(s), pendingPhotos(s), pendingProfiles(s), readLog(s), readBeat(s), peopleInfo(s)]);
    const t = nowMs(cfg), cur = pollNow(cfg, polls, t);
    const poll = cur ? { ...cur.p, open: cur.open, ...(await tally(s, cur.p.id, [])), manual: cur.manual } : null;
    return J({ cfg, polls, poll, snap, pending: { photos, profiles }, log: logl, videos: VIDEOS, t, reh: rehearsalOn(cfg), screen, pinFails: await pinFails(s), people, auto: autoNow(cfg, polls, t) });
  }

  // 256 KB leaves room for the people import in WP2.
  const { body: b, error } = await readBody(req, 256 * 1024, "Bad request."); if (error) return error;
  try {
    const r = await act(s, b);
    const { note, extra } = typeof r === "string" ? { note: r, extra: {} } : r;
    await log(s, who, note);
    return J({ ok: true, ...extra });
  } catch (e) {
    if (e instanceof Refuse) return J({ error: e.message }, e.status);
    throw e;
  }
};

// One operator action. Returns the line for the log (or { note, extra } to add to the answer), or throws a Refuse.
// Shared JSON (cfg, polls, snap) changes only through updateCfg, updatePolls and updateSnap.
async function act(s, b) {
  const a = b.action;
  if (a === "mode") {
    if (!MODES.includes(b.mode)) throw new Refuse(400, "Unknown mode.");
    await updateCfg(s, c => { c.mode = b.mode; c.pin = null; if (b.mode !== "opening") c.speaker = null; });
    return b.mode === "auto" ? "Set the screen to automatic" : `Held the screen on ${b.mode}`;
  }
  if (a === "pin") {
    if (b.scene !== null && !SCENES.includes(b.scene)) throw new Refuse(400, "Unknown scene.");
    await updateCfg(s, c => { c.pin = b.scene; });
    return b.scene ? `Pinned the ${b.scene} scene` : "Unpinned the scene";
  }
  if (a === "speaker") {
    const cfg = await updateCfg(s, c => { c.speaker = b.index === null ? null : Math.max(0, Math.min(9, parseInt(b.index) || 0)); if (c.speaker !== null && c.mode !== "opening") c.mode = "opening"; });
    return cfg.speaker === null ? "Speaker cards follow the clock" : `Showed speaker card ${cfg.speaker + 1}`;
  }
  if (a === "video") {
    const v = b.id === null ? null : VIDEOS.find(x => x.id === b.id);
    if (b.id !== null && !v) throw new Refuse(400, "Unknown video.");
    await updateCfg(s, c => { c.video = { id: v ? v.id : null, at: nowMs(c) }; });
    return v ? `Played the ${v.title} video` : "Stopped the video";
  }
  if (a === "theme") {
    const theme = b.theme === "dark" ? "dark" : "light";
    await updateCfg(s, c => { c.theme = theme; });
    return `Switched to ${theme}`;
  }
  if (a === "overlay") {
    const o = ["black", "logo", "check"].includes(b.overlay) ? b.overlay : null;
    await updateCfg(s, c => { c.overlay = o; });
    return o ? `Showed the ${o} screen` : "Back to the live screen";
  }
  if (a === "ann") {
    const text = clean(b.text, 140);
    await updateCfg(s, c => { c.ann = text ? { text, at: nowMs(c), secs: Math.max(8, Math.min(120, parseInt(b.secs) || 20)) } : null; });
    return text ? `Announced: ${text}` : "Cleared the announcement";
  }
  if (a === "way") {
    const w = {}; for (const k of ["registration", "rooms", "oneToOnes"]) { const d = String((b.way || {})[k] || ""); if (DIRS.includes(d) && d) w[k] = d; }
    await updateCfg(s, c => { c.way = Object.keys(w).length ? w : null; });
    return "Updated the This Way directions";
  }
  // Approvals set or clear the marker first, then change that one item in the snapshot.
  if (a === "approvePhoto" || a === "rejectPhoto" || a === "hidePhoto") {
    const id = b.id;
    if (!idOk(id)) throw new Refuse(400, "Unknown photo.");
    await s.delete(`q/ph/${id}`);
    if (a === "approvePhoto") {
      const m = await s.getMetadata(`ph/${id}`);
      if (!m) throw new Refuse(404, "That photo is gone.");
      await s.set(`ok/ph/${id}`, "");
      await updateSnap(s, sn => putItem(sn.photos, photoItem(id, m.metadata)));
    } else {
      await s.delete(`ok/ph/${id}`);
      if (a === "rejectPhoto") await s.delete(`ph/${id}`);
      await updateSnap(s, sn => dropItem(sn.photos, id));
    }
    return { approvePhoto: "Approved a photo", rejectPhoto: "Declined a photo", hidePhoto: "Removed a photo from the wall" }[a];
  }
  if (a === "approveProfile" || a === "rejectProfile" || a === "hideProfile") {
    const pub = b.id;
    if (!pubOk(pub)) throw new Refuse(400, "Unknown profile.");
    const approve = a === "approveProfile";
    const exists = (await s.get(`pr/${pub}`)) !== null;
    if (!exists && approve) { await s.delete(`q/pr/${pub}`); throw new Refuse(404, "That profile is gone."); }
    // The status changes through update(), so an edit sent at the same moment is not overwritten.
    // When the remote sends at, the card must still be the version the team looked at.
    const p = exists ? await update(s, `pr/${pub}`, v => {
      if (approve && b.at && v.at !== b.at) throw new Refuse(409, "This card just changed. Look at it again.");
      v.status = approve ? "approved" : "declined";
    }) : null;
    if (approve) await approveCard(s, pub, p);
    else { await s.delete(`q/pr/${pub}`); await unlistCard(s, pub); }
    return `${{ approveProfile: "Approved", rejectProfile: "Declined", hideProfile: "Removed" }[a]} the profile of ${p ? p.name : "someone"}`;
  }
  // Opening or closing a poll from the remote holds it (manual). pollManual {on: false} goes back to the schedule.
  if (a === "pollActivate") {
    const p = (await readPolls(s)).find(x => x.id === b.pid);
    if (!p) throw new Refuse(400, "Unknown poll.");
    await updateCfg(s, c => { c.poll = { id: p.id, open: true, manual: true }; });
    return `Opened the poll: ${p.q}`;
  }
  if (a === "pollClose") {
    const polls = await readPolls(s);
    await updateCfg(s, c => { const cur = pollNow(c, polls, nowMs(c)); c.poll = { id: cur ? cur.p.id : null, open: false, manual: true }; });
    return "Closed the poll";
  }
  if (a === "pollManual") {
    if (typeof b.on !== "boolean") throw new Refuse(400, "Say on or off.");
    const polls = await readPolls(s);
    await updateCfg(s, c => {
      if (!b.on) { c.poll = { id: null, open: false, manual: false }; return; }
      const cur = pollNow(c, polls, nowMs(c)); c.poll = { id: cur ? cur.p.id : null, open: cur ? cur.open : false, manual: true };
    });
    return b.on ? "Held the poll" : "Polls follow the schedule again";
  }
  if (a === "pollAdd") {
    const q = clean(b.q, 120); if (q.length < 4) throw new Refuse(400, "Write the question.");
    const type = b.type === "choice" ? "choice" : "words";
    const options = type === "choice" ? (Array.isArray(b.options) ? b.options.map(o => clean(o, 30)).filter(Boolean).slice(0, 6) : []) : undefined;
    if (type === "choice" && options.length < 2) throw new Refuse(400, "Add at least two options.");
    const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 4);
    await updatePolls(s, polls => { polls.push({ id, q, type, ...(options ? { options } : {}) }); });
    return `Added the poll: ${q}`;
  }
  if (a === "pollDelete") {
    await updatePolls(s, polls => polls.filter(x => x.id !== b.pid));
    await updateCfg(s, c => { if (c.poll && c.poll.id === b.pid) c.poll = { id: null, open: false, manual: false }; });
    return "Deleted a poll";
  }
  if (a === "pollReset") {
    const { blobs } = await s.list({ prefix: `ans/${b.pid}/` }); await Promise.all(blobs.map(x => s.delete(x.key)));
    return "Cleared the answers of a poll";
  }
  if (a === "hideWord" || a === "showWord") {
    const w = clean(b.word, 40);
    await updateCfg(s, c => { const set = new Set(c.hidden || []); if (a === "hideWord") set.add(w); else set.delete(w); c.hidden = [...set]; });
    return `${a === "hideWord" ? "Hid" : "Restored"} the word ${w}`;
  }
  if (a === "reset") {
    // Screen controls go back to automatic. Polls, directions, hidden words, switches and a rehearsal stay.
    await updateCfg(s, c => ({ ...mergeCfg(null), poll: c.poll, way: c.way, hidden: c.hidden, flags: c.flags, rehearsal: c.rehearsal, reloadAt: c.reloadAt }));
    return "Reset the screen controls";
  }
  if (a === "rehearsal") {
    if (b.hhmm === null) { await updateCfg(s, c => { c.rehearsal = null; }); return "Stopped the rehearsal"; }
    if (typeof b.hhmm !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.hhmm)) throw new Refuse(400, "Give the rehearsal time as HH:MM.");
    const real = realNow();
    if (isEventDay(real)) throw new Refuse(409, "A rehearsal cannot start on the day of the event.");
    await updateCfg(s, c => { c.rehearsal = rehearsalFor(b.hhmm, real); });
    return `Started a rehearsal at ${b.hhmm}`;
  }
  if (a === "wipe") {
    if (String(b.phrase || "").trim() !== "RESET MD26") throw new Refuse(400, "Type RESET MD26 to wipe the test data.");
    const real = realNow(), m = localMin(real);
    if (isEventDay(real) && m >= 8 * 60 && m < 16 * 60) throw new Refuse(409, "Wiping is blocked between 08:00 and 16:00 on the day of the event.");
    const n = await wipeAll(s);
    return { note: "Wiped the test data", extra: { deleted: n } };
  }
  if (a === "reload") {
    await updateCfg(s, c => { c.reloadAt = Math.max(Date.now(), (c.reloadAt || 0) + 1); });
    return "Asked the wall to reload";
  }
  if (a === "flags") {
    if (typeof b.name !== "string" || !Object.hasOwn(FLAGS, b.name)) throw new Refuse(400, "Unknown switch.");
    if (typeof b.on !== "boolean") throw new Refuse(400, "Say on or off.");
    await updateCfg(s, c => { c.flags[b.name] = b.on; });
    return `Turned ${b.name} ${b.on ? "on" : "off"}`;
  }
  if (a === "repair") {
    const snap = await rebuild(s);
    return { note: "Repaired the lists", extra: { photos: snap.photos.length, profiles: snap.profiles.length } };
  }
  if (a === "rx") {
    if (!["auto", "on", "off"].includes(b.mode)) throw new Refuse(400, "Say auto, on or off.");
    await updateCfg(s, c => { c.rx = b.mode; });
    return { auto: "Reactions follow the clock", on: "Turned reactions on", off: "Turned reactions off" }[b.mode];
  }
  if (a === "peopleImport") {
    // Rows come reduced from the remote (WP6): no email, no full number. last4 is turned into k4 here and dropped.
    if (!Array.isArray(b.people)) throw new Refuse(400, "Send the people as a list.");
    if (b.people.length > PEOPLE_MAX) throw new Refuse(413, `That list is too long. The most is ${PEOPLE_MAX} people.`);
    const out = new Map(), skipped = []; let replaced = 0;
    b.people.forEach((row, i) => {
      const r = personFrom(row);
      if (r.why) { skipped.push({ row: i + 1, why: r.why }); return; }
      if (out.has(r.person.id)) replaced++;
      out.set(r.person.id, r.person);
    });
    if (!out.size) throw new Refuse(400, "No row had a name and the last 4 digits of a mobile number.");
    const people = [...out.values()];
    await update(s, "people", () => people, { init: [] });
    // Team seats change for people who signed in already.
    const signed = new Set((await s.list({ prefix: "sig/p" })).blobs.map(k => k.key.slice(5)));
    await mapLimit(people.filter(p => signed.has(p.id)), 8, p => syncTeam(s, p));
    return { note: `Imported ${people.length} people`, extra: { count: people.length, skipped, replaced } };
  }
  if (a === "peopleUnlock") {
    const pid = typeof b.id === "string" && /^p?[a-f0-9]{10}$/.test(b.id) ? b.id.replace(/^p/, "") : null;
    if (!pid) throw new Refuse(400, "Unknown person.");
    const [fails, phones, people] = await Promise.all([s.list({ prefix: `fail/${pid}/` }), s.list({ prefix: `dv/p${pid}/` }), readPeople(s)]);
    await mapLimit(fails.blobs.concat(phones.blobs).map(k => k.key), 20, k => s.delete(k));
    const p = personOf(people, pid);
    return `Unlocked ${p ? p.name : "a person"}`;
  }
  throw new Refuse(400, "Unknown action.");
}

export const config = { path: "/api/op", method: ["GET", "POST"] };
