// Live reactions (docs/PLAN.md sections 5.6 and 5.12).
// Each batch a phone sends is one key, so phones never overwrite each other:
//   rx/<minute>/<window>/<dev>~<clap>~<heart>~<bloom>~<rand>
// minute is the real minute (real time / 60000 floored). Real time only moves forward, so a minute that has
// ended stays ended, also while a rehearsal moves the clock: a rehearsal repeats the same times of 17 November,
// and keys by that clock landed in minutes that had been summed already. window is t / 4000 floored, t from
// nowMs (the rehearsal clock), and gives rx.b. Counts come from key names.
//
// Every read lists the live minutes: the real minute now, the one before, and the one after (clock skew).
// A minute at least 2 minutes old is summed once into
//   rx/s<minute>~<batches>~<clap>~<heart>~<bloom>
// Two readers summing the same minute write the same name. If two names exist, the one with more batches wins.
// A batch whose write ends so late that its minute may have been summed without it leaves the mark
//   rx/l<minute>~<rand>
// and the next read sums that minute again, then removes the mark. A minute ahead of the real clock (only from
// a server with another clock) waits until its time. Sums and marks sit next to the minutes, so one list shows
// all three: the day total costs that list plus the live minutes.
import { realNow } from "./day.mjs";
import { randHex } from "./store.mjs";

export const WIN_MS = 4000, MIN_MS = 60000;
export const winOf = t => Math.floor(t / WIN_MS);
export const realMin = real => Math.floor(real / MIN_MS);
export const RX_KINDS = ["clap", "heart", "bloom"];
// Where a batch goes: the real minute, then the window of the rehearsal clock.
export const winPrefix = (real, t) => `rx/${realMin(real)}/${winOf(t)}/`;

const KEY_RE = /^rx\/(\d+)\/(\d+)\/[^~/]+~(\d+)~(\d+)~(\d+)~/;
const SUM_RE = /^rx\/s(\d+)~(\d+)~(\d+)~(\d+)~(\d+)$/;
const MARK_RE = /^rx\/l(\d+)~/;
const CLOSE_MAX = 3, AGAIN_MAX = 2; // minutes summed, and marked minutes summed again, in one call at most
const LATE_MS = 10000; // more than any clock skew between two servers
// [batches, clap, heart, bloom]. More batches is more complete; batches only ever add reactions.
const more = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] + a[2] + a[3] > b[1] + b[2] + b[3]);

// After a batch is written. real is the time its key was made from. A reader sums a minute once its own clock
// reads 2 minutes past the minute's start, and lists it after that. A write that ended more than LATE_MS before
// then is in every sum; a later one marks its minute.
export async function markIfLate(s, real) {
  const m = realMin(real);
  if (realNow() >= (m + 2) * MIN_MS - LATE_MS) await s.set(`rx/l${m}~${randHex(3)}`, "");
}

// First round: one list that does not depend on the time. Start it together with the other reads.
export function rxTop(s) { return s.list({ prefix: "rx/", directories: true }); }

// Second round: { on, b, total }. b is [[window, clap, heart, bloom], [window - 1, ...]] from the live minutes.
// real is the real time that t was made from.
export async function rxRead(s, top, t, on, real = realNow()) {
  const w = winOf(t), now = realMin(real);
  const have = new Set(top.directories.map(d => +String(d).replace(/\/$/, "").split("/").pop()).filter(Number.isInteger));
  const done = new Map(), marks = new Map();
  for (const k of top.blobs) {
    const x = SUM_RE.exec(k.key), y = !x && MARK_RE.exec(k.key);
    if (x) { const v = [+x[2], +x[3], +x[4], +x[5]], cur = done.get(+x[1]); if (!cur || more(v, cur)) done.set(+x[1], v); }
    else if (y) { const m = +y[1]; if (!marks.has(m)) marks.set(m, []); marks.get(m).push(k.key); }
  }
  const live = [now + 1, now, now - 1].filter(m => have.has(m));
  // Ended minutes never summed, the newest first: those that just stopped being live, which earlier reads counted.
  const close = [...have].filter(m => m <= now - 2 && !done.has(m)).sort((a, b) => b - a).slice(0, CLOSE_MAX);
  const again = [...marks.keys()].filter(m => m <= now - 2 && done.has(m)).sort((a, b) => b - a).slice(0, AGAIN_MAX);
  const mins = [...live, ...close, ...again];
  const lists = await Promise.all(mins.map(m => s.list({ prefix: `rx/${m}/` })));
  const win = new Map([[w, [0, 0, 0]], [w - 1, [0, 0, 0]]]), seen = new Map();
  mins.forEach((m, i) => {
    const tot = [0, 0, 0, 0];
    for (const k of lists[i].blobs) {
      const x = KEY_RE.exec(k.key); if (!x || +x[1] !== m) continue;
      const v = [+x[3], +x[4], +x[5]];
      tot[0]++; tot[1] += v[0]; tot[2] += v[1]; tot[3] += v[2];
      // Windows count from the live minutes only, which every call lists, so a window's counts only grow.
      const b = i < live.length && win.get(+x[2]);
      if (b) { b[0] += v[0]; b[1] += v[1]; b[2] += v[2]; }
    }
    seen.set(m, tot);
  });
  const writes = [...close, ...again.filter(m => more(seen.get(m), done.get(m)))];
  await Promise.all(writes.map(m => s.set(`rx/s${m}~${seen.get(m).join("~")}`, "")));
  // The marks of minutes listed here go only after their sums are written.
  const gone = [...close, ...again].flatMap(m => marks.get(m) || []);
  if (gone.length) await Promise.all(gone.map(k => s.delete(k)));
  let total = 0;
  for (const m of new Set([...done.keys(), ...seen.keys()])) {
    if (m > now + 1) continue;
    const a = done.get(m), b = seen.get(m), best = !a ? b : !b ? a : more(b, a) ? b : a;
    total += best[1] + best[2] + best[3];
  }
  return { on, b: [[w, ...win.get(w)], [w - 1, ...win.get(w - 1)]], total };
}
