// Public live state for the wall and the phone page (docs/PLAN.md section 5.6). Cached briefly at the CDN.
// Lists (photos, profiles, connections, takeaways) are not here: they are in /api/snap, fetched when snapV changes.
// Fields of later features are present with empty values, so clients can be written against the final shape.
import { st, readCfg, readPolls, readSnap, tallyFrom, publicCfg, snapVersion, J, CDN, TAGS, VIDEOS } from "../lib/store.mjs";
import { nowMs, rehearsalOn, phase } from "../lib/day.mjs";

export default async () => {
  const s = st();
  const [cfg, polls, snap, ans] = await Promise.all([readCfg(s), readPolls(s), readSnap(s), s.list({ prefix: "ans/" })]);
  const t = nowMs(cfg);
  const p = cfg.poll && polls.find(x => x.id === cfg.poll.id);
  // manual is true until the poll schedule exists (WP2): the open poll is always the one the remote chose.
  const poll = p ? { id: p.id, q: p.q, type: p.type, options: p.options || [], open: !!cfg.poll.open, ...tallyFrom(ans.blobs, p.id, cfg.hidden), manual: true } : null;
  const links = 0; // connections, from the cx/ key names (WP2)
  const w = Math.floor(t / 4000); // reaction window, from t
  return J({
    t, reh: rehearsalOn(cfg), phase: phase(t),
    cfg: publicCfg(cfg),
    poll,
    rx: { on: false, b: [[w, 0, 0, 0], [w - 1, 0, 0, 0]], total: 0 },
    n: { here: 0, board: snap.profiles.length, links, photos: snap.photos.length, takeaways: snap.takeaways.length, answers: ans.blobs.length },
    interest: {},
    hello: [],
    snapV: snapVersion(snap, links),
    tags: TAGS, videos: VIDEOS
  }, 200, CDN(2));
};

export const config = { path: "/api/state", method: ["GET"] };
