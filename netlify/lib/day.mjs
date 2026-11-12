// The day as the server sees it: the schedule from public/assets/day.js, and the clock.
// esbuild bundles the import below into every function. The self hosted server loads it as a module.
import "../../public/assets/day.js";

export const DAY = globalThis.MD_DAY;

export const toMin = hhmm => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
export const fmtMin = m => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(Math.floor(m % 60)).padStart(2, "0");

// The real time. Tests can replace it through the self hosted server (MD_TEST_FAKE_NOW). Netlify never does.
export const realNow = () => (typeof globalThis.__mdTestClock === "function" ? globalThis.__mdTestClock() : Date.now());

const FMT = new Intl.DateTimeFormat("en-US", { timeZone: DAY.tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
function parts(ms) { const o = {}; for (const p of FMT.formatToParts(new Date(ms))) o[p.type] = p.value; return o; }

// "YYYY-MM-DD" at the venue.
export function localDate(ms) { const p = parts(ms); return `${p.year}-${p.month}-${p.day}`; }
// Minutes since midnight at the venue, with seconds as a fraction.
export function localMin(ms) { const p = parts(ms); return +p.hour * 60 + +p.minute + +p.second / 60; }

// The instant when the venue clock shows hhmm on date ("2026-11-17", "10:55").
function offsetAt(ms) { const p = parts(ms); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000; }
export function localToMs(date, hhmm) {
  const [y, mo, d] = date.split("-").map(Number), [h, mi] = hhmm.split(":").map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  return wall - offsetAt(wall - offsetAt(wall));
}

export const isEventDay = (ms = realNow()) => localDate(ms) === DAY.date;

// A rehearsal moves the server clock to a time on the event day for two real hours.
// It never applies on the real event day, so a forgotten one cannot move the real day.
export const REHEARSAL_MS = 2 * 60 * 60 * 1000;
export function rehearsalOn(cfg, real = realNow()) {
  const r = cfg && cfg.rehearsal;
  return !!(r && typeof r.shift === "number" && r.until > real && !isEventDay(real));
}
export function nowMs(cfg) { const real = realNow(); return rehearsalOn(cfg, real) ? real + cfg.rehearsal.shift : real; }
export function rehearsalFor(hhmm, real = realNow()) {
  return { shift: localToMs(DAY.date, hhmm) - real, until: real + REHEARSAL_MS, hhmm, at: real };
}

// before: before dayFrom on the event day, or any earlier day. after: from close on the event day, or any later day.
export function phase(ms) {
  const d = localDate(ms);
  if (d < DAY.date) return "before";
  if (d > DAY.date) return "after";
  const m = localMin(ms);
  if (m < toMin(DAY.dayFrom)) return "before";
  return m >= toMin(DAY.close) ? "after" : "day";
}
