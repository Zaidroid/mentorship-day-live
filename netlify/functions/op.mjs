// Operator remote API. Every call needs the team PIN. Every change is logged with who made it.
import { st, readCfg, writeCfg, readPolls, readSnap, rebuild, tally, log, readLog, pinOk, whoOf, idOk, devOk, clean, J, DEFAULT_CFG, VIDEOS } from "../lib/store.mjs";

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
  for (const id of ids) { const p = await s.get(`pr/${id}`, { type: "json" }); if (p) out.push({ id, ...p }); }
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
  const cfg = await readCfg(s);
  const a = b.action;
  let note = "";

  if (a === "mode") {
    if (!MODES.includes(b.mode)) return J({ error: "Unknown mode." }, 400);
    cfg.mode = b.mode; cfg.pin = null; if (b.mode !== "opening") cfg.speaker = null;
    await writeCfg(s, cfg); note = b.mode === "auto" ? "Set the screen to automatic" : `Held the screen on ${b.mode}`;
  } else if (a === "pin") {
    if (b.scene !== null && !SCENES.includes(b.scene)) return J({ error: "Unknown scene." }, 400);
    cfg.pin = b.scene; await writeCfg(s, cfg); note = b.scene ? `Pinned the ${b.scene} scene` : "Unpinned the scene";
  } else if (a === "speaker") {
    cfg.speaker = b.index === null ? null : Math.max(0, Math.min(9, parseInt(b.index) || 0));
    if (cfg.speaker !== null && cfg.mode !== "opening") cfg.mode = "opening";
    await writeCfg(s, cfg); note = cfg.speaker === null ? "Speaker cards follow the clock" : `Showed speaker card ${cfg.speaker + 1}`;
  } else if (a === "video") {
    const v = b.id === null ? null : VIDEOS.find(x => x.id === b.id);
    if (b.id !== null && !v) return J({ error: "Unknown video." }, 400);
    cfg.video = { id: v ? v.id : null, at: Date.now() }; await writeCfg(s, cfg); note = v ? `Played the ${v.title} video` : "Stopped the video";
  } else if (a === "theme") {
    cfg.theme = b.theme === "dark" ? "dark" : "light"; await writeCfg(s, cfg); note = `Switched to ${cfg.theme}`;
  } else if (a === "overlay") {
    cfg.overlay = ["black", "logo", "check"].includes(b.overlay) ? b.overlay : null; await writeCfg(s, cfg); note = cfg.overlay ? `Showed the ${cfg.overlay} screen` : "Back to the live screen";
  } else if (a === "ann") {
    const text = clean(b.text, 140);
    cfg.ann = text ? { text, at: Date.now(), secs: Math.max(8, Math.min(120, parseInt(b.secs) || 20)) } : null;
    await writeCfg(s, cfg); note = text ? `Announced: ${text}` : "Cleared the announcement";
  } else if (a === "way") {
    const w = {}; for (const k of ["registration", "rooms", "oneToOnes"]) { const d = String((b.way || {})[k] || ""); if (DIRS.includes(d) && d) w[k] = d; }
    cfg.way = Object.keys(w).length ? w : null; await writeCfg(s, cfg); note = "Updated the This Way directions";
  } else if (a === "approvePhoto" || a === "rejectPhoto" || a === "hidePhoto") {
    if (!idOk(b.id)) return J({ error: "Unknown photo." }, 400);
    await s.delete(`q/ph/${b.id}`);
    if (a === "approvePhoto") await s.set(`ok/ph/${b.id}`, "");
    if (a === "rejectPhoto") await s.delete(`ph/${b.id}`);
    if (a === "hidePhoto") await s.delete(`ok/ph/${b.id}`);
    await rebuild(s); note = { approvePhoto: "Approved a photo", rejectPhoto: "Declined a photo", hidePhoto: "Removed a photo from the wall" }[a];
  } else if (a === "approveProfile" || a === "rejectProfile" || a === "hideProfile") {
    if (!devOk(b.id)) return J({ error: "Unknown profile." }, 400);
    const p = await s.get(`pr/${b.id}`, { type: "json" });
    await s.delete(`q/pr/${b.id}`);
    if (a === "approveProfile") { await s.set(`ok/pr/${b.id}`, ""); if (p) { p.status = "approved"; await s.setJSON(`pr/${b.id}`, p); } }
    else { await s.delete(`ok/pr/${b.id}`); if (p) { p.status = "declined"; await s.setJSON(`pr/${b.id}`, p); } }
    await rebuild(s); note = `${{ approveProfile: "Approved", rejectProfile: "Declined", hideProfile: "Removed" }[a]} the profile of ${p ? p.name : "someone"}`;
  } else if (a === "pollActivate") {
    const polls = await readPolls(s); const p = polls.find(x => x.id === b.pid);
    if (!p) return J({ error: "Unknown poll." }, 400);
    cfg.poll = { id: p.id, open: true }; await writeCfg(s, cfg); note = `Opened the poll: ${p.q}`;
  } else if (a === "pollClose") {
    if (cfg.poll) cfg.poll.open = false; await writeCfg(s, cfg); note = "Closed the poll";
  } else if (a === "pollAdd") {
    const q = clean(b.q, 120); if (q.length < 4) return J({ error: "Write the question." }, 400);
    const type = b.type === "choice" ? "choice" : "words";
    const options = type === "choice" ? (Array.isArray(b.options) ? b.options.map(o => clean(o, 30)).filter(Boolean).slice(0, 6) : []) : undefined;
    if (type === "choice" && options.length < 2) return J({ error: "Add at least two options." }, 400);
    const polls = await readPolls(s); const id = "p" + Date.now().toString(36);
    polls.push({ id, q, type, ...(options ? { options } : {}) }); await s.setJSON("polls", polls); note = `Added the poll: ${q}`;
  } else if (a === "pollDelete") {
    const polls = (await readPolls(s)).filter(x => x.id !== b.pid); await s.setJSON("polls", polls);
    if (cfg.poll && cfg.poll.id === b.pid) { cfg.poll = null; await writeCfg(s, cfg); }
    note = "Deleted a poll";
  } else if (a === "pollReset") {
    const { blobs } = await s.list({ prefix: `ans/${b.pid}/` }); await Promise.all(blobs.map(x => s.delete(x.key))); note = "Cleared the answers of a poll";
  } else if (a === "hideWord" || a === "showWord") {
    const w = clean(b.word, 40); const set = new Set(cfg.hidden || []);
    if (a === "hideWord") set.add(w); else set.delete(w);
    cfg.hidden = [...set]; await writeCfg(s, cfg); note = `${a === "hideWord" ? "Hid" : "Restored"} the word ${w}`;
  } else if (a === "reset") {
    const keep = { ...DEFAULT_CFG, poll: cfg.poll, way: cfg.way, hidden: cfg.hidden }; await writeCfg(s, keep); note = "Reset the screen controls";
  } else {
    return J({ error: "Unknown action." }, 400);
  }

  await log(s, who, note);
  return J({ ok: true });
};

export const config = { path: "/api/op", method: ["GET", "POST"] };
