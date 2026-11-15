// Cloudflare Workers entry. Deploy with the Cloudflare API:
//   PUT /client/v4/accounts/{account_id}/workers/scripts/crypto-price-api
//   (multipart: metadata {main_module: "worker.mjs", compatibility_date}
//   + worker.mjs + app.mjs as modules), then enable workers.dev:
//   POST /client/v4/accounts/{account_id}/workers/scripts/crypto-price-api/subdomain
//   {"enabled": true}
// `hono` must be bundled into the upload (or vendored under ./vendor).
import { app } from "./app.mjs";

export default {
  fetch: app.fetch,
};
