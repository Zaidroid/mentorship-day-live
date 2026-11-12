// GET /api/rx: reactions only, { t, on, b, total }, the same as state.rx plus t (docs/PLAN.md section 5.12).
// Tiny and cached 1 second at the CDN, so the wall can poll it faster than state while reactions are on,
// if the shared cache does not work at 2 seconds. Same answer for every client.
import { st, readCfg, J, CDN } from "../lib/store.mjs";
import { nowMs, realNow } from "../lib/day.mjs";
import { rxOn } from "../lib/rules.mjs";
import { rxTop, rxRead } from "../lib/rx.mjs";

export default async () => {
  const s = st();
  const [cfg, top] = await Promise.all([readCfg(s), rxTop(s)]);
  const real = realNow(), t = nowMs(cfg, real);
  return J({ t, ...(await rxRead(s, top, t, rxOn(cfg, t), real)) }, 200, CDN(1));
};

export const config = { path: "/api/rx", method: ["GET"] };
