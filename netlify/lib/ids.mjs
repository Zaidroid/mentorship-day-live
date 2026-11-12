// Identity and public ids (docs/PLAN.md section 5.3).
// dev  the device id a phone makes for itself. It is the phone's only credential, so it never
//      leaves the server: no response to any other client carries it.
// pub  the id every public list uses: "p" + pid for a verified person, "g" + a keyed hash of
//      dev for a guest or an anonymous phone.
// All hashes are keyed with a secret derived from REMOTE_PIN. If the PIN changes, every
// guest id changes and the people list must be imported again.
import crypto from "node:crypto";

export const PUB_RE = /^[pg][a-f0-9]{10}$/;
export const pubOk = v => PUB_RE.test(v || "");
export const devOk = d => /^[a-z0-9]{8,40}$/i.test(d || "");

const pinValue = () => (globalThis.Netlify && Netlify.env.get("REMOTE_PIN")) || "";
export function secret() { return crypto.createHash("sha256").update("md26|" + pinValue()).digest(); }
const mac = text => crypto.createHmac("sha256", secret()).update(text).digest("hex");

// Names compared without case, accents, Arabic short vowels or tatweel, and with common
// Arabic letter variants folded. Person ids depend on this: do not change it after an import.
export function normName(n) {
  return String(n == null ? "" : n).normalize("NFKD").replace(/\p{M}/gu, "").replace(/ـ/g, "")
    .replace(/ٱ/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export const guestPub = dev => "g" + mac(dev).slice(0, 10);
// The public id of a takeaway: a keyed hash of session and person, so a quote shown without a name
// cannot be traced to a card on the board.
export const takeawayId = (sid, pub) => "t" + mac("tk|" + sid + "|" + pub).slice(0, 10);
export const personId = (name, last4) => mac(normName(name) + "|" + last4).slice(0, 10);
export const personPub = pid => "p" + pid;
export const k4Of = (pid, last4) => mac(pid + ":" + last4);

// Who the phone that sent dev is. who/<dev> is written by claim and guest, deleted by signout.
//   status  "person" (signed in from the people list), "guest", or "none" (never signed in)
//   pub     the public id; a phone that never signed in uses its guest id
//   pid     the person id, or null; name as signed in; hello is the consent given at sign in
export async function whoFor(s, dev) {
  const w = devOk(dev) ? await s.get(`who/${dev}`, { type: "json" }) : null;
  if (w && pubOk(w.pub)) return { status: w.pid ? "person" : "guest", pub: w.pub, pid: w.pid || null, name: w.name || "", hello: !!w.hello };
  return { status: "none", pub: guestPub(dev), pid: null, name: "", hello: false };
}
// The public id of the phone that sent dev.
export async function pubFor(s, dev) { return (await whoFor(s, dev)).pub; }
