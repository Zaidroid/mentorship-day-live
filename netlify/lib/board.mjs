// The Networking Board: approving cards, and moving a guest's things to a person (docs/PLAN.md sections 5.3 and 5.9).
// A card is pr/<pub>; q/pr/<pub> marks it waiting, ok/pr/<pub> approved; the snapshot holds the approved ones.
import { updateSnap, putItem, dropItem, profileItem } from "./store.mjs";
import { BLOCKS, readStars, writeStar, pairsFrom } from "./people.mjs";

// Puts an approved card on the board: the marker, then that one item in the snapshot.
export async function approveCard(s, pub, p) {
  await Promise.all([s.delete(`q/pr/${pub}`), s.set(`ok/pr/${pub}`, "")]);
  await updateSnap(s, sn => putItem(sn.profiles, profileItem(pub, p)));
  return p;
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
