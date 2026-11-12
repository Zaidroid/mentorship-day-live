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
export const personId = (name, last4) => mac(normName(name) + "|" + last4).slice(0, 10);
export const personPub = pid => "p" + pid;
export const k4Of = (pid, last4) => mac(pid + ":" + last4);

// The public id of the phone that sent dev. Version 2 foundation: every phone is a guest.
// WP2 adds the signed in case (who/<dev>) here, so callers already await it.
export async function pubFor(s, dev) { return guestPub(dev); }
