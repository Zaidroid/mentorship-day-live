// Session takeaways (docs/PLAN.md sections 5.7 to 5.9).
//   tk/<sid>/<pub>  { rating, text, first, showName, at, status, n }, one per person per session, a new one replaces it
//   status          approved (on the wall), pending (waits for the team), declined, hidden, or none (a rating without text)
//   q/tk/<sid>~<pub>, ok/tk/<sid>~<pub>  waiting and approved markers
// The snapshot holds approved takeaways with text as { id, sid, text, first, at } (store.mjs takeawayItem).
import { updateSnap, putItem, dropItem, takeawayItem } from "./store.mjs";
import { takeawayId, pubOk } from "./ids.mjs";

// Text that reaches the wall without a person: no links, no phone numbers.
const LINK = /(https?:\/\/|www\.|@[a-z0-9_]{3,}|\b[a-z0-9-]+\.(com|net|org|io|me|ly|co|ps|info|biz|app|dev|link|site)\b)/i;
export const hasLink = t => LINK.test(t);
export const hasNumber = t => /\p{Nd}{7,}/u.test(String(t).replace(/(?<=\p{Nd})[\s\-.()/]+(?=\p{Nd})/gu, ""));

// Sets the markers and the snapshot item for a takeaway record after its status changed.
export async function placeTakeaway(s, sid, pub, t) {
  const q = `q/tk/${sid}~${pub}`, ok = `ok/tk/${sid}~${pub}`, id = takeawayId(sid, pub);
  if (t.status === "approved" && t.text) {
    await Promise.all([s.delete(q), s.set(ok, "")]);
    await updateSnap(s, sn => putItem(sn.takeaways, takeawayItem(sid, pub, t)));
    return;
  }
  const wasOn = (await s.get(ok)) !== null;
  await Promise.all([t.status === "pending" ? s.set(q, "") : s.delete(q), s.delete(ok)]);
  if (wasOn) await updateSnap(s, sn => dropItem(sn.takeaways, id));
}

// The pub behind a public takeaway id, by trying the people who wrote about that session. null when none.
export async function takeawayPub(s, sid, id) {
  const pre = `tk/${sid}/`;
  const pubs = (await s.list({ prefix: pre })).blobs.map(b => b.key.slice(pre.length)).filter(pubOk);
  return pubs.find(pub => takeawayId(sid, pub) === id) || null;
}
