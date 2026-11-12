// Live reactions (docs/PLAN.md sections 5.6 and 5.12).
// Each batch a phone sends is one key, so phones never overwrite each other:
//   rx/<minute>/<window>/<dev>~<clap>~<heart>~<bloom>~<rand>
// window is t / 4000 floored (t from nowMs, so rehearsals work), minute is window / 15 floored.
// Counts come from key names. A minute that has closed is summed once into
//   rxm/<minute>~<clap>~<heart>~<bloom>
// Two readers summing the same minute write the same name, so the sum is never counted twice; if two
// names exist for one minute, the larger one wins. The day total therefore costs a few lists, not one
// read per batch.
export const WIN_MS = 4000, WIN_PER_MIN = 15;
export const winOf = t => Math.floor(t / WIN_MS);
export const minOf = w => Math.floor(w / WIN_PER_MIN);
export const RX_KINDS = ["clap", "heart", "bloom"];

const KEY_RE = /^rx\/(\d+)\/(\d+)\/[^~/]+~(\d+)~(\d+)~(\d+)~/;
const SUM_RE = /^rxm\/(\d+)~(\d+)~(\d+)~(\d+)$/;
const sum = v => v[0] + v[1] + v[2];
const add = (a, v) => { a[0] += v[0]; a[1] += v[1]; a[2] += v[2]; };

// First round: two lists that do not depend on the time. Start them together with the other reads.
export function rxLists(s) {
  return Promise.all([s.list({ prefix: "rx/", directories: true }), s.list({ prefix: "rxm/" })]);
}

// Second round: { on, b, total }. Lists the minute now and the minute before, when they hold batches,
// and sums up to 3 closed minutes that were never summed. b is [[window, clap, heart, bloom], [window - 1, ...]].
export async function rxRead(s, [dirs, sums], t, on) {
  const w = winOf(t), mNow = minOf(w), mPrev = mNow - 1;
  const have = new Set(dirs.directories.map(d => +String(d).replace(/\/$/, "").split("/").pop()).filter(Number.isFinite));
  const done = new Map();
  for (const k of sums.blobs) {
    const x = SUM_RE.exec(k.key); if (!x) continue;
    const v = [+x[2], +x[3], +x[4]], cur = done.get(+x[1]);
    if (!cur || sum(v) > sum(cur)) done.set(+x[1], v);
  }
  const live = [mNow, mPrev].filter(m => have.has(m));
  const closed = [...have].filter(m => m !== mNow && m !== mPrev && !done.has(m)).slice(0, 3);
  const mins = [...live, ...closed];
  const lists = await Promise.all(mins.map(m => s.list({ prefix: `rx/${m}/` })));
  const win = new Map([[w, [0, 0, 0]], [w - 1, [0, 0, 0]]]), seen = new Map();
  mins.forEach((m, i) => {
    const tot = [0, 0, 0];
    for (const k of lists[i].blobs) {
      const x = KEY_RE.exec(k.key); if (!x) continue;
      const v = [+x[3], +x[4], +x[5]]; add(tot, v);
      if (win.has(+x[2])) add(win.get(+x[2]), v);
    }
    seen.set(m, tot);
  });
  await Promise.all(closed.map(m => { const v = seen.get(m); return s.set(`rxm/${m}~${v[0]}~${v[1]}~${v[2]}`, ""); }));
  let total = 0;
  for (const m of new Set([...done.keys(), ...seen.keys()])) total += Math.max(sum(done.get(m) || [0, 0, 0]), sum(seen.get(m) || [0, 0, 0]));
  return { on, b: [[w, ...win.get(w)], [w - 1, ...win.get(w - 1)]], total };
}
