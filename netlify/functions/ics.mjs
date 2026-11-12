// GET /api/ics?s=1A,3B: a calendar file with the chosen sessions, 5 minute alarm (docs/PLAN.md section 5.7).
// Without s it holds the day itself. Times come from public/assets/day.js in venue time and are written in UTC.
// The answer depends only on s, so it is cached at the CDN for an hour.
import { CDN } from "../lib/store.mjs";
import { DAY, localToMs, realNow } from "../lib/day.mjs";
import { SESSIONS } from "../lib/people.mjs";

const HOST = "mentorship-day-live.netlify.app";
const PLACE = "Palestine TechnoPark, Birzeit";
const BY = "Mentorship Day 2026 by Gaza Sky Geeks, a program of Mercy Corps, inside the Palestine Innovation Summit.";
const utc = ms => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const esc = v => String(v).replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
// Lines longer than 75 bytes are folded: the rest goes on the next line after one space.
function fold(line) {
  const out = []; let cur = "", size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; size = 0; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}
function event({ uid, start, end, title, where, about, alarm }) {
  return ["BEGIN:VEVENT", `UID:${uid}@${HOST}`, `DTSTAMP:${utc(realNow())}`, `DTSTART:${utc(localToMs(DAY.date, start))}`, `DTEND:${utc(localToMs(DAY.date, end))}`,
    `SUMMARY:${esc(title)}`, `LOCATION:${esc(where)}`, `DESCRIPTION:${esc(about)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(alarm)}`, "TRIGGER:-PT5M", "END:VALARM", "END:VEVENT"];
}

export default async (req) => {
  const raw = (new URL(req.url).searchParams.get("s") || "").split(",").map(x => x.trim()).filter(Boolean);
  const ids = [...new Set(raw)];
  if (ids.length > DAY.sessions.length || ids.some(id => !Object.hasOwn(SESSIONS, id))) {
    return new Response(JSON.stringify({ error: "Unknown session." }), { status: 400, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }
  const events = ids.length
    ? ids.map(id => {
      const x = SESSIONS[id], b = DAY.blocks.find(k => k.n === x.b);
      const who = x.who.map(k => (DAY.advisors[k] || {}).name).filter(Boolean).join(" and ");
      const about = `${who ? `With ${who}.` : ""}${x.mode === "Online" ? " The advisor joins online." : ""} ${BY}`.trim();
      return event({ uid: `md26-${id}`, start: b.s, end: b.e, title: x.title, where: `${x.room}, ${PLACE}`, about, alarm: `${x.title} starts in 5 minutes in ${x.room}.` });
    }).flat()
    : event({ uid: "md26-day", start: DAY.open, end: DAY.close, title: "Mentorship Day 2026", where: PLACE, about: BY, alarm: "Mentorship Day starts in 5 minutes." });
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Gaza Sky Geeks//Mentorship Day 2026//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Mentorship Day 2026", ...events, "END:VCALENDAR"];
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="mentorship-day.ics"', "x-content-type-options": "nosniff", ...CDN(3600, { vary: "query=s" }) }
  });
};

export const config = { path: "/api/ics", method: ["GET"] };
