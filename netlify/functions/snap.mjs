// The public snapshot of approved photos, Networking Board profiles, connections and takeaways.
// Clients ask for /api/snap?v=<snapV from state>. The URL changes when the content does, so a
// response for the current version is cached for an hour. Any other v gets the current content, uncached.
import { st, readSnap, snapVersion, J, CDN } from "../lib/store.mjs";

export default async (req) => {
  const snap = await readSnap(st());
  const links = []; // [[pubA, pubB, at]] from the cx/ key names (WP2)
  const v = snapVersion(snap, links.length);
  const current = new URL(req.url).searchParams.get("v") === v;
  // The answer depends only on v, never on who asks, so it is safe to share at the CDN.
  const cache = current ? CDN(3600, { browser: 3600, vary: "query=v" }) : {};
  return J({ at: snap.at, v, photos: snap.photos, profiles: snap.profiles, links, takeaways: snap.takeaways }, 200, cache);
};

export const config = { path: "/api/snap", method: ["GET"] };
