// Public live state for the wall and the phone page (docs/PLAN.md section 5.6). Cached briefly at the CDN.
// Lists (photos, profiles, connections, takeaways) are not here: they are in /api/snap, fetched when snapV changes.
// Fields of later features are present with empty values, so clients can be written against the final shape.
import { st, readCfg, readPolls, readSnap, tallyFrom, publicCfg, snapVersion, J, CDN, TAGS, VIDEOS } from "../lib/store.mjs";
import { nowMs, rehearsalOn, phase } from "../lib/day.mjs";
import { interestFrom } from "../lib/people.mjs";
import { pollNow, rxOn } from "../lib/rules.mjs";
import { rxLists, rxRead } from "../lib/rx.mjs";
import { boardLinks } from "../lib/board.mjs";

// The newest 12 hellos: hi/<t>~<pub>~<first name>. Only the first name and the time leave the server.
function hellos(blobs) {
  return blobs.map(b => b.key.slice(3).split("~")).filter(x => x.length === 3).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 12)
    .map(([at, , f]) => { try { return { f: decodeURIComponent(f), at: +at }; } catch { return null; } }).filter(Boolean);
}

export default async () => {
  const s = st();
  // One round of reads and lists, all in parallel; a second round only for reactions in the last two minutes.
  const [cfg, polls, snap, ans, stars, here, hi, cx, rxl] = await Promise.all([readCfg(s), readPolls(s), readSnap(s), s.list({ prefix: "ans/" }), s.list({ prefix: "star/" }), s.list({ prefix: "here/" }), s.list({ prefix: "hi/" }), s.list({ prefix: "cx/" }), rxLists(s)]);
  const t = nowMs(cfg);
  const rx = await rxRead(s, rxl, t, rxOn(cfg, t));
  // The poll follows the schedule unless the remote holds one (plan section 5.8).
  const cur = pollNow(cfg, polls, t), p = cur && cur.p;
  const poll = p ? { id: p.id, q: p.q, type: p.type, options: p.options || [], open: cur.open, ...tallyFrom(ans.blobs, p.id, cfg.hidden), manual: cur.manual } : null;
  const links = boardLinks(cx.blobs, snap).length;
  return J({
    t, reh: rehearsalOn(cfg), phase: phase(t),
    cfg: publicCfg(cfg),
    poll,
    rx,
    n: { here: here.blobs.length, board: snap.profiles.length, links, photos: snap.photos.length, takeaways: snap.takeaways.length, answers: ans.blobs.length },
    interest: interestFrom(stars.blobs),
    hello: cfg.flags.hello ? hellos(hi.blobs) : [],
    snapV: snapVersion(snap, links),
    tags: TAGS, videos: VIDEOS
  }, 200, CDN(rx.on ? 1 : 2));
};

export const config = { path: "/api/state", method: ["GET"] };
