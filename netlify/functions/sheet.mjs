// Proxy for the Mentorship Day Screen Feed sheet (sessions, one to one slots, stats).
// Keeps the screen on one origin and caches the sheet for a few seconds at the CDN.
import { CDN } from "../lib/store.mjs";

const SHEET = "1xOXRmAqi5NqVaLL-IkoEKC7H9eguoc5-idOxpNcbiAY";
const TABS = { sessions: "Sessions", slots: "Slots", stats: "Stats" };

export default async (req, context) => {
  const tab = TABS[context.params.tab];
  if (!tab) return new Response("Unknown tab", { status: 404 });
  const url = `https://docs.google.com/spreadsheets/d/${SHEET}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tab)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) return new Response("Sheet unavailable", { status: 502 });
    return new Response(await r.text(), { headers: { "content-type": "text/csv; charset=utf-8", ...CDN(15) } });
  } catch {
    return new Response("Sheet unavailable", { status: 502 });
  }
};

export const config = { path: "/api/sheet/:tab", method: ["GET"] };
