// Operator remote API. Every call needs the team PIN. Every change is logged with who made it.
import { st, readCfg, updateCfg, mergeCfg, readPolls, updatePolls, readSnap, rebuild, tally, log, readLog, pinOk, whoOf, idOk, clean, J, Refuse, VIDEOS } from "../lib/store.mjs";
import { pubOk } from "../lib/ids.mjs";

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
    const [cfg, polls, snap, photos, profiles, logl] = await Promise.all([readCfg(s), readPolls(s), readSnap(s), pendingPhotos(s), pendingProfiles(s), readLog(s)]);
    const p = cfg.poll && polls.find(x => x.id === cfg.poll.id);
    const poll = p ? { ...p, open: !!cfg.poll.open, ...(await tally(s, p.id, [])) } : null;
    return J({ cfg, polls, poll, snap, pending: { photos, profiles }, log: logl, videos: VIDEOS, t: Date.now() });
  }

  let b; try { b = await req.json(); } catch { return J({ error: "Bad request." }, 400); }
  try {
    const note = await act(s, b);
    await log(s, who, note);
    return J({ ok: true });
  } catch (e) {
    if (e instanceof Refuse) return J({ error: e.message }, e.status);
    throw e;
  }
};

// One operator action. Returns the line for the log, or throws a Refuse.
// Shared JSON (cfg, polls) changes only through updateCfg and updatePolls.
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
    await updateCfg(s, c => { c.video = { id: v ? v.id : null, at: Date.now() }; });
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
    await updateCfg(s, c => { c.ann = text ? { text, at: Date.now(), secs: Math.max(8, Math.min(120, parseInt(b.secs) || 20)) } : null; });
    return text ? `Announced: ${text}` : "Cleared the announcement";
  }
  if (a === "way") {
    const w = {}; for (const k of ["registration", "rooms", "oneToOnes"]) { const d = String((b.way || {})[k] || ""); if (DIRS.includes(d) && d) w[k] = d; }
    await updateCfg(s, c => { c.way = Object.keys(w).length ? w : null; });
    return "Updated the This Way directions";
  }
  if (a === "approvePhoto" || a === "rejectPhoto" || a === "hidePhoto") {
    if (!idOk(b.id)) throw new Refuse(400, "Unknown photo.");
    await s.delete(`q/ph/${b.id}`);
    if (a === "approvePhoto") await s.set(`ok/ph/${b.id}`, "");
    if (a === "rejectPhoto") await s.delete(`ph/${b.id}`);
    if (a === "hidePhoto") await s.delete(`ok/ph/${b.id}`);
    await rebuild(s);
    return { approvePhoto: "Approved a photo", rejectPhoto: "Declined a photo", hidePhoto: "Removed a photo from the wall" }[a];
  }
  if (a === "approveProfile" || a === "rejectProfile" || a === "hideProfile") {
    if (!pubOk(b.id)) throw new Refuse(400, "Unknown profile.");
    const p = await s.get(`pr/${b.id}`, { type: "json" });
    await s.delete(`q/pr/${b.id}`);
    if (a === "approveProfile") { await s.set(`ok/pr/${b.id}`, ""); if (p) { p.status = "approved"; await s.setJSON(`pr/${b.id}`, p); } }
    else { await s.delete(`ok/pr/${b.id}`); if (p) { p.status = "declined"; await s.setJSON(`pr/${b.id}`, p); } }
    await rebuild(s);
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
    await updateCfg(s, c => ({ ...mergeCfg(null), poll: c.poll, way: c.way, hidden: c.hidden }));
    return "Reset the screen controls";
  }
  throw new Refuse(400, "Unknown action.");
}

export const config = { path: "/api/op", method: ["GET", "POST"] };
