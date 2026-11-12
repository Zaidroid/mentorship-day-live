// The Networking Board: approving cards, and moving a guest's things to a person (docs/PLAN.md sections 5.3 and 5.9).
// A card is pr/<pub>; q/pr/<pub> marks it waiting, ok/pr/<pub> approved; the snapshot holds the approved ones.
import crypto from "node:crypto";
import { update, updateSnap, putItem, dropItem, profileItem, withLock } from "./store.mjs";
import { BLOCKS, readStars, writeStar, pairsFrom } from "./people.mjs";

// Puts an approved card on the board: the marker, a meet code if it has none, then that one item in the snapshot.
export async function approveCard(s, pub, p) {
  await Promise.all([s.delete(`q/pr/${pub}`), s.set(`ok/pr/${pub}`, "")]);
  await ensureCode(s, pub, p);
  await updateSnap(s, sn => putItem(sn.profiles, profileItem(pub, p)));
  return p;
}

// Meet codes: code/<nnn> holds the pub, 100 to 999, written with onlyIfNew so no two people share one.
// The code is also kept on the card (pr/<pub>.code) for GET /api/me. It stays with the person for the day.
// The lock covers the self hosted server, where onlyIfNew is not atomic.
export async function ensureCode(s, pub, p) {
  if (p && p.code && (await s.get(`code/${p.code}`)) === pub) return p.code;
  // The code is read back after the write: if onlyIfNew turns out not to be atomic on Netlify and another
  // card won the same number, this one tries again instead of sharing it.
  const code = await withLock("codes", async () => {
    for (let i = 0; i < 60; i++) {
      const n = 100 + crypto.randomInt(900);
      if ((await s.set(`code/${n}`, pub, { onlyIfNew: true })).modified && (await s.get(`code/${n}`)) === pub) return n;
    }
    return null;
  });
  if (code) { await update(s, `pr/${pub}`, v => { v.code = code; }); if (p) p.code = code; }
  return code;
}

// Connections on the board: pairs from the cx/ key names where both cards are approved now.
// State counts them for n.links and snapV; the snapshot lists them as [pubA, pubB, at].
export function boardLinks(cxBlobs, snap) {
  const on = new Set(snap.profiles.map(p => p.id));
  return pairsFrom(cxBlobs).filter(([a, b]) => on.has(a) && on.has(b));
}
// Takes a card off the board (it stays stored, for the person and the team).
export async function unlistCard(s, pub) {
  await s.delete(`ok/pr/${pub}`);
  await updateSnap(s, sn => dropItem(sn.profiles, pub));
}

// When a phone that made a guest card signs in as a person, its card, meet code, stars and connections move
// to the person once, best effort. Nothing moves onto things the person has already.
//   person  the people record; trusted  whether the card is approved at once (flags.trustProfiles)
export async function movePub(s, from, to, { person, trusted }) {
  if (from === to) return;
  const [card, mine] = await Promise.all([s.get(`pr/${from}`, { type: "json" }), s.get(`pr/${to}`, { type: "json" })]);
  if (card && !mine) {
    const p = { ...card, name: person.name, company: person.company, at: Date.now(), status: trusted ? "approved" : "pending" };
    await s.setJSON(`pr/${to}`, p);
    if (card.code) await s.set(`code/${card.code}`, to);
    await Promise.all([s.delete(`pr/${from}`), s.delete(`q/pr/${from}`), s.delete(`ok/pr/${from}`)]);
    await updateSnap(s, sn => dropItem(sn.profiles, from));
    if (trusted) await approveCard(s, to, p); else await s.set(`q/pr/${to}`, "");
  }
  const [old, have] = await Promise.all([readStars(s, from), readStars(s, to)]);
  for (const b of BLOCKS) {
    if (!old[b]) continue;
    if (!have[b] && old[b].by === "own") await writeStar(s, b, to, old[b].sid, "own");
    await writeStar(s, b, from, null);
  }
  const cx = await s.list({ prefix: "cx/" });
  for (const [a, b, at] of pairsFrom(cx.blobs).filter(([a, b]) => a === from || b === from)) {
    const other = a === from ? b : a;
    if (other !== to) { const [x, y] = [other, to].sort(); await s.set(`cx/${x}~${y}~${at}`, ""); }
  }
  await Promise.all(cx.blobs.filter(k => k.key.includes(from)).map(k => s.delete(k.key)));
}
