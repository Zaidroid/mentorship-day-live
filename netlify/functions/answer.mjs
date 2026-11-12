// Poll answers from phones. One answer per phone per poll; a new answer replaces the old one.
// Each answer is its own key, so many phones answering at once never overwrite each other.
import { st, readCfg, readPolls, devOk, normWord, isBad, readBody, J } from "../lib/store.mjs";

export default async (req) => {
  const { body: b, error } = await readBody(req, 2048, "Send the answer as JSON."); if (error) return error;
  const dev = req.headers.get("x-dev") || b.dev;
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  const s = st();
  const cfg = await readCfg(s);
  if (!cfg.poll || cfg.poll.id !== b.pid || !cfg.poll.open) return J({ error: "This poll is closed. A new one will open soon." }, 409);
  const p = (await readPolls(s)).find(x => x.id === b.pid);
  if (!p) return J({ error: "This poll is closed." }, 409);
  let word;
  if (p.type === "choice") {
    if (!(p.options || []).includes(b.text)) return J({ error: "Pick one of the options." }, 400);
    word = b.text;
  } else {
    word = normWord(b.text);
    if (!word) return J({ error: "Type a word first." }, 400);
    if (isBad(word)) return J({ error: "Please choose a different word." }, 422);
  }
  const pre = `ans/${p.id}/${dev}/`;
  const { blobs } = await s.list({ prefix: pre });
  await Promise.all(blobs.map(x => s.delete(x.key)));
  await s.set(pre + encodeURIComponent(word), "1");
  return J({ ok: true, word });
};

export const config = { path: "/api/answer", method: ["POST"] };
