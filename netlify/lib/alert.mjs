// Alerts to a team Telegram chat (docs/PLAN.md section 5.10). Optional: nothing at all happens unless both
// ALERT_TELEGRAM_BOT and ALERT_TELEGRAM_CHAT are set. At most one message per kind per 3 minutes, a 2.5 second
// timeout, and an alert never fails the request. A message says a count and the remote link, never a name.
// ALERT_TELEGRAM_API replaces the Telegram address (the API test points it at a local stub).
import { realNow } from "./day.mjs";
import { withLock } from "./store.mjs";

const env = k => (globalThis.Netlify && Netlify.env.get(k)) || "";
const GAP = 3 * 60 * 1000;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const ALERTS = {
  photos: n => `${plural(n, "photo is", "photos are")} waiting for approval.`,
  waiting: n => `${plural(n, "card or takeaway is", "cards or takeaways are")} waiting for approval.`,
  locked: () => "Someone is locked out of sign in and needs Unlock.",
  wall: () => "The wall reported an error.",
  pin: n => `${n} wrong PINs in the last 10 minutes.`
};
export const alertsOn = () => !!(env("ALERT_TELEGRAM_BOT") && env("ALERT_TELEGRAM_CHAT"));

// Sends one alert. count is a number or an async function (only called when a message goes out).
// origin is the site address for the remote link; Netlify's URL variable wins when it is set.
// The 3 minute gap is a key per kind and time bucket written with onlyIfNew, so two requests at once send one message.
export async function alert(s, kind, { count = 0, origin = "" } = {}) {
  try {
    if (!alertsOn() || !Object.hasOwn(ALERTS, kind)) return false;
    const key = `alert/${kind}/${Math.floor(realNow() / GAP)}`;
    const fresh = await withLock(key, async () => (await s.set(key, "", { onlyIfNew: true })).modified);
    if (!fresh) return false;
    const n = typeof count === "function" ? await count() : count;
    const site = (env("URL") || origin || "").replace(/\/$/, "");
    const text = ALERTS[kind](n) + (site ? ` ${site}/remote/` : "");
    const api = (env("ALERT_TELEGRAM_API") || "https://api.telegram.org").replace(/\/$/, "");
    const res = await fetch(`${api}/bot${env("ALERT_TELEGRAM_BOT")}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env("ALERT_TELEGRAM_CHAT"), text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(2500)
    });
    return res.ok;
  } catch { return false; }
}
// The same, handed to context.waitUntil on Netlify so the answer does not wait for Telegram.
export function alertSoon(context, s, kind, opts) {
  const p = alert(s, kind, opts);
  if (context && typeof context.waitUntil === "function") { context.waitUntil(p); return Promise.resolve(); }
  return p;
}
// Cards and takeaways waiting for the team, for the "waiting" alert.
export async function waitingCount(s) {
  const [pr, tk] = await Promise.all([s.list({ prefix: "q/pr/" }), s.list({ prefix: "q/tk/" })]);
  return pr.blobs.length + tk.blobs.length;
}
export const originOf = req => { try { return new URL(req.url).origin; } catch { return ""; } };
