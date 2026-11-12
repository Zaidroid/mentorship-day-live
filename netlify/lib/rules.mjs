// What runs by the clock (docs/PLAN.md section 5.8). Every rule reads the time t from nowMs(cfg),
// so a rehearsal moves all of them. There is no cron: callers ask at read time.
import { DAY, toMin, fmtMin, localDate, localMin, phase } from "./day.mjs";

const onDay = t => localDate(t) === DAY.date;
const PLAN = [...DAY.pollPlan].sort((a, b) => toMin(a.from) - toMin(b.from));
const LAST_BLOCK = Math.max(...DAY.blocks.map(b => b.n));

// The poll everyone sees. { p, open, manual, row } or null.
//   manual (held from the remote): the poll in cfg.poll, open or closed as the remote left it.
//   schedule: the pollPlan row for the current time, open. Outside every row, the last row that ended,
//   closed; before the first row of the day (and on days before) there is no poll.
export function pollNow(cfg, polls, t) {
  const c = cfg.poll || {};
  if (c.manual) { const p = polls.find(x => x.id === c.id); return p ? { p, open: !!c.open, manual: true, row: null } : null; }
  const d = localDate(t);
  let row = null, open = false;
  if (d === DAY.date) {
    const m = localMin(t);
    row = PLAN.find(r => m >= toMin(r.from) && m < toMin(r.to)) || null;
    if (row) open = true;
    else row = PLAN.filter(r => toMin(r.to) <= m).pop() || null;
  } else if (d > DAY.date) row = PLAN[PLAN.length - 1] || null;
  if (!row) return null;
  const p = polls.find(x => x.id === row.id);
  return p ? { p, open, manual: false, row } : null;
}

// Reactions: on inside reactionWindows on the day, unless the remote set cfg.rx to "on" or "off".
export function rxOn(cfg, t) {
  if (cfg.rx === "on") return true;
  if (cfg.rx === "off") return false;
  if (!onDay(t)) return false;
  const m = localMin(t);
  return DAY.reactionWindows.some(w => m >= toMin(w.from) && m < toMin(w.to));
}

// The takeaway window of a block, in venue minutes: from 5 minutes before the session ends until 20 minutes
// after the block ends. The last block stays open until the close of the day.
export function tkWindow(n) {
  const b = DAY.blocks.find(x => x.n === n);
  if (!b) return null;
  return { from: toMin(b.e) - 5, to: n === LAST_BLOCK ? toMin(DAY.close) : toMin(b.end) + 20 };
}
export function tkOpen(n, t) {
  const w = tkWindow(n);
  if (!w || !onDay(t)) return false;
  const m = localMin(t);
  return m >= w.from && m < w.to;
}

// What the clock rules are doing now and what comes next, for the Status tab of the remote.
export function autoNow(cfg, polls, t) {
  const day = onDay(t), m = day ? localMin(t) : null;
  const cur = pollNow(cfg, polls, t);
  const nextRow = day && !(cfg.poll || {}).manual ? PLAN.find(r => toMin(r.from) > m) : (!day && localDate(t) < DAY.date ? PLAN[0] : null);
  const win = day ? DAY.reactionWindows.find(w => m >= toMin(w.from) && m < toMin(w.to)) : null;
  const nextWin = day ? DAY.reactionWindows.find(w => toMin(w.from) > m) : (localDate(t) < DAY.date ? DAY.reactionWindows[0] : null);
  const prog = day ? DAY.program.find(r => m >= toMin(r.s) && m < toMin(r.e)) : null;
  const nextProg = day ? DAY.program.find(r => toMin(r.s) > m) : (localDate(t) < DAY.date ? DAY.program[0] : null);
  return {
    now: fmtMin(localMin(t)), date: localDate(t), phase: phase(t),
    poll: {
      id: cur ? cur.p.id : null, open: cur ? cur.open : false, manual: !!(cfg.poll || {}).manual,
      until: cur && cur.row && cur.open ? cur.row.to : null,
      next: nextRow ? { id: nextRow.id, at: nextRow.from } : null
    },
    rx: {
      mode: ["on", "off"].includes(cfg.rx) ? cfg.rx : "auto", on: rxOn(cfg, t),
      until: win && !["on", "off"].includes(cfg.rx) ? win.to : null,
      next: nextWin && !["on", "off"].includes(cfg.rx) ? nextWin.from : null
    },
    program: { now: prog ? { title: prog.name || prog.title, s: prog.s, e: prog.e } : null, next: nextProg ? { title: nextProg.name || nextProg.title, s: nextProg.s } : null },
    takeaways: DAY.blocks.map(b => b.n).filter(n => tkOpen(n, t))
  };
}
