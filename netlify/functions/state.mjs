// Public live state for the big screen and the phone page. Cached briefly at the CDN.
import { st, readCfg, readPolls, readSnap, tally, J, CDN, TAGS, VIDEOS } from "../lib/store.mjs";

export default async () => {
  const s = st();
  const [cfg, polls, snap] = await Promise.all([readCfg(s), readPolls(s), readSnap(s)]);
  const p = cfg.poll && polls.find(x => x.id === cfg.poll.id);
  let poll = null;
  if (p) poll = { ...p, open: !!cfg.poll.open, ...(await tally(s, p.id, cfg.hidden)) };
  const { hidden, ...pub } = cfg;
  return J({ t: Date.now(), cfg: pub, poll, photos: snap.photos, profiles: snap.profiles, tags: TAGS, videos: VIDEOS }, 200, CDN(2));
};

export const config = { path: "/api/state", method: ["GET"] };
