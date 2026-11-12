// Operator remote API. Every call needs the team PIN. Every change is logged with who made it.
import { st, update, readCfg, updateCfg, mergeCfg, readPolls, updatePolls, readSnap, updateSnap, putItem, dropItem, photoItem, profileItem, tally, log, readLog, pinOk, whoOf, idOk, clean, J, Refuse, VIDEOS, FLAGS, rebuild, wipeAll, readBeat } from "../lib/store.mjs";
import { pubOk } from "../lib/ids.mjs";
import { nowMs, realNow, rehearsalOn, rehearsalFor, isEventDay, localMin } from "../lib/day.mjs";

const MODES = ["auto", "welcome", "opening", "video", "choose", "live", "lunch", "close"];
const SCENES = ["rooms", "choose", "board", "spotlight", "advisors", "meet", "photos", "poll", "pulse", "way", "welcome", "speaker", "recap", "thanks"];
const DIRS = ["left", "right", "up", "down", "up left", "up right", "down left", "down right", ""];

async function pendingPhotos(s) {
  const ids = (await s.list({ prefix: "q/ph/" })).blobs.map(b => b.key.slice(5));
  const out = [];
  for (const id of ids) { const m = await s.getMetadata(`ph/${id}`); if (m) out.push({ id, name: m.metadata.name, caption: m.metadata.caption, at: m.metadata.at }); }
  return out.sort((a, b) => a.at - b.at);
}
async function pendingProfiles(s) {
  const ids = (await s.list({ prefix: "q/pr/" })).blobs.map(b => b.key.slice(5));
  const out = [];
  for (const id of ids.filter(pubOk)) { const p = await s.get(`pr/${id}`, { type: "json" }); if (p) out.push({ ...p, id }); }
  return out.sort((a, b) => a.at - b.at);
}

export default async (req) => {
  if (!pinOk(req)) return J({ error: "Wrong PIN." }, 401);
  const s = st(), who = whoOf(req);

  if (req.method === "GET") {
    const [cfg, polls, snap, photos, profiles, logl, screen] = await Promise.all([readCfg(s), readPolls(s), readSnap(s), pendingPhotos(s), pendingProfiles(s), readLog(s), readBeat(s)]);
    const p = cfg.poll && polls.find(x => x.id === cfg.poll.id);
    const poll = p ? { ...p, open: !!cfg.poll.open, ...(await tally(s, p.id, [])), manual: true } : null;
    return J({ cfg, polls, poll, snap, pending: { photos, profiles }, log: logl, videos: VIDEOS, t: nowMs(cfg), reh: rehearsalOn(cfg), screen });
  }

  let b; try { b = await req.json(); } catch { return J({ error: "Bad request." }, 400); }
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
    await s.delete(`q/pr/${pub}`);
    if (approve) { await s.set(`ok/pr/${pub}`, ""); await updateSnap(s, sn => putItem(sn.profiles, profileItem(pub, p))); }
    else { await s.delete(`ok/pr/${pub}`); await updateSnap(s, sn => dropItem(sn.profiles, pub)); }
    return `${{ approveProfile: "Approved", rejectProfile: "Declined", hideProfile: "Removed" }[a]} the profile of ${p ? p.name : "someone"}`;
  }
  if (a === "pollActivate") {
    const p = (await readPolls(s)).find(x => x.id === b.pid);
    if (!p) throw new Refuse(400, "Unknown poll.");
    await updateCfg(s, c => { c.poll = { id: p.id, open: true }; });
    return `Opened the poll: ${p.q}`;
  }
  if (a === "pollClose") {
    await updateCfg(s, c => { if (c.poll) c.poll.open = false; });
    return "Closed the poll";
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
    await updateCfg(s, c => { if (c.poll && c.poll.id === b.pid) c.poll = null; });
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
  throw new Refuse(400, "Unknown action.");
}

export const config = { path: "/api/op", method: ["GET", "POST"] };
