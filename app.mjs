/**
 * Shared Hono app for the vAPI Call price API. Runs unchanged on Node
 * (index.mjs) and on Cloudflare Workers (worker.mjs) — no Node-only APIs.
 *
 * POST /price returns the live USD price of a crypto asset from CoinGecko's
 * public API (no key). One call costs $0.005 USDC on Base (eip155:8453),
 * paid via x402 v2 `exact` scheme through the Coinbase facilitator
 * (https://x402.org/facilitator). Payment goes straight to the payout wallet.
 *
 * Flow: no PAYMENT-SIGNATURE header -> HTTP 402 with the offer in the JSON
 * body AND in the base64 PAYMENT-REQUIRED header. With a payment signature,
 * verify + settle via the facilitator, then return the price and the
 * settlement in the PAYMENT-RESPONSE header.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();
const facilitator = "https://x402.org/facilitator";
const payTo =
  (typeof process !== "undefined" && process.env?.PAY_TO) ||
  "0x8166206CBe9f11b5b059812Fd88C57f7F1f6622d";

// $0.005 USDC (6 decimals) per call on Base.
const offer = {
  x402Version: 2,
  error: "Payment required",
  resource: {
    url: "/price",
    description:
      "Live crypto price lookup (CoinGecko public data). POST {\"id\":\"bitcoin\",\"vs\":\"usd\"} returns the current price.",
    mimeType: "application/json",
    serviceName: "Crypto Price API",
  },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "5000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo,
      maxTimeoutSeconds: 120,
      extra: { name: "USD Coin", version: "2" },
    },
  ],
};

// Base64 helpers that work in Node and in Workers (btoa/atob are globals in both).
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// The unpaid-request answer: HTTP 402 with the offer in the JSON body and
// in the base64 PAYMENT-REQUIRED header (x402 v2, exact scheme).
function paymentRequired(c) {
  return c.json(offer, 402, {
    "PAYMENT-REQUIRED": b64encode(JSON.stringify(offer)),
  });
}

app.use(
  "*",
  cors({
    origin: "*",
    exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"],
  })
);

app.get("/", (c) =>
  c.json({
    service: "Crypto Price API",
    pricePerCall: "$0.005 USDC on Base",
    endpoint: "POST /price  {\"id\":\"bitcoin\",\"vs\":\"usd\"}",
    openapi: "/openapi.json",
    payTo,
  })
);

app.get("/openapi.json", (c) =>
  c.json({
    openapi: "3.0.3",
    info: { title: "Crypto Price API", version: "1.0.0" },
    paths: {
      "/price": {
        post: {
          "x-payment-info": offer.accepts[0],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: {
                      type: "string",
                      example: "bitcoin",
                      description: "CoinGecko coin id, e.g. bitcoin, ethereum, solana",
                    },
                    vs: {
                      type: "string",
                      example: "usd",
                      description: "Quote currency, default usd",
                    },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: "Paid response with the live price" },
            402: { description: "Payment required" },
          },
        },
      },
    },
  })
);

// The vAPI wizard probes the exact URL entered in Discover with the chosen
// method. If the user pastes the origin or the OpenAPI document URL with
// POST, answer the same 402 challenge instead of a 404 so the probe passes;
// the real payable operation stays POST /price.
app.post("/", (c) => paymentRequired(c));
app.post("/openapi.json", (c) => paymentRequired(c));

app.post("/price", async (c) => {
  const encoded = c.req.header("PAYMENT-SIGNATURE");
  if (!encoded) {
    return paymentRequired(c);
  }

  let payment;
  try {
    payment = JSON.parse(b64decode(encoded));
  } catch {
    return c.json({ error: "Invalid payment" }, 400);
  }

  const body = {
    x402Version: 2,
    paymentPayload: payment,
    paymentRequirements: offer.accepts[0],
  };
  const headers = { "content-type": "application/json" };

  let verify;
  try {
    verify = await fetch(`${facilitator}/verify`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return c.json({ error: "Payment verification failed" }, 402);
  }
  const verified = await verify.json();
  if (!verify.ok || !verified.isValid) {
    return c.json({ error: "Payment verification failed" }, 402);
  }

  let settle;
  try {
    settle = await fetch(`${facilitator}/settle`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    return c.json({ error: "Payment settlement failed" }, 502);
  }
  const settlement = await settle.json();
  if (!settle.ok || !settlement.success) {
    return c.json({ error: "Payment settlement failed" }, 502);
  }

  // Payment settled: fetch the live price (CoinGecko public API, no key).
  let reqBody = {};
  try {
    reqBody = await c.req.json();
  } catch {}
  const id = String(reqBody.id || "bitcoin").toLowerCase();
  const vs = String(reqBody.vs || "usd").toLowerCase();
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
    id
  )}&vs_currencies=${encodeURIComponent(vs)}`;
  let priceResp;
  try {
    priceResp = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    return c.json({ error: "Upstream price source failed" }, 502);
  }
  if (!priceResp.ok) {
    return c.json({ error: "Upstream price source failed" }, 502);
  }
  const data = await priceResp.json();
  const price = data?.[id]?.[vs];
  if (price === undefined) {
    return c.json({ error: `Unknown coin id: ${id}` }, 400);
  }

  return c.json(
    {
      id,
      vs,
      price,
      timestamp: new Date().toISOString(),
    },
    200,
    { "PAYMENT-RESPONSE": b64encode(JSON.stringify(settlement)) }
  );
});

export { app, offer, payTo };
