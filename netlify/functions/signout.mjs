// POST /api/signout: forgets who this phone is. Deletes who/<dev> only; stars, card and connections stay.
import { st, J } from "../lib/store.mjs";
import { devOk } from "../lib/ids.mjs";

export default async (req) => {
  const dev = req.headers.get("x-dev") || "";
  if (!devOk(dev)) return J({ error: "Unknown device." }, 400);
  await st().delete(`who/${dev}`);
  return J({ ok: true });
};

export const config = { path: "/api/signout", method: ["POST"] };
