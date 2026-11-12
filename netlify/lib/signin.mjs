// What happens when a phone signs in, and when a signed in phone is first seen on the day
// (docs/PLAN.md sections 5.3, 5.4 and 5.11).
import { readCfg, firstWord, isBad } from "./store.mjs";
import { nowMs, phase } from "./day.mjs";
import { guestPub } from "./ids.mjs";
import { syncTeam, makePicks } from "./people.mjs";
import { movePub } from "./board.mjs";

// sig/<pub>: signed in at least once, { kind, name, at }. Returns true the first time for this pub.
export async function markSigned(s, pub, kind, name) {
  const r = await s.setJSON(`sig/${pub}`, { kind, name, at: Date.now() }, { onlyIfNew: true });
  if (r.modified) return true;
  if (kind === "guest") { const old = await s.get(`sig/${pub}`, { type: "json" }); await s.setJSON(`sig/${pub}`, { ...(old || {}), kind, name }); } // a guest may give a new name
  return false;
}

// here/<pub>: first seen on the day of the event (by t, so a rehearsal counts too). n.here counts these keys.
// The first time, a hello goes to the wall when the phone said yes at sign in and the hello switch is on:
// hi/<t>~<pub>~<first name>, the first word of the name, never one that fails the word filter.
// A phone that signed in before the day is marked here by its first GET /api/me on the day.
export async function seenToday(s, w, cfg) {
  if (w.status === "none") return false;
  cfg = cfg || await readCfg(s);
  const t = nowMs(cfg);
  if (phase(t) !== "day") return false;
  const r = await s.setJSON(`here/${w.pub}`, { at: t }, { onlyIfNew: true });
  if (!r.modified) return false;
  const first = firstWord(w.name);
  if (w.hello && cfg.flags.hello && first && !isBad(first)) await s.set(`hi/${String(t).padStart(15, "0")}~${w.pub}~${encodeURIComponent(first)}`, "");
  return true;
}

// After claim or guest. w is the new who record, prev the one before it on this phone.
// For a person: a guest card made on this phone moves over, team seats are set, and on the very first
// sign in of the person the sessions are picked (after the move, so a guest's own stars are kept).
export async function afterSignIn(s, { w, prev, person, dev }) {
  const cfg = await readCfg(s);
  const first = await markSigned(s, w.pub, w.status, w.name);
  if (person && prev.status !== "person") await movePub(s, guestPub(dev), w.pub, { person, trusted: cfg.flags.trustProfiles });
  if (person) await syncTeam(s, person);
  if (person && first && cfg.flags.picks) await makePicks(s, person);
  await seenToday(s, w, cfg);
  return { first };
}
