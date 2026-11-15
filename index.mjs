// Local Node entry: `node index.mjs` (or `npm start`).
import { serve } from "@hono/node-server";
import { app, payTo } from "./app.mjs";

const PORT = Number(
  (typeof process !== "undefined" && process.env?.PORT) || 4242
);
serve({ fetch: app.fetch, port: PORT });
console.log(
  `Crypto Price API listening on http://localhost:${PORT} (payTo ${payTo})`
);
