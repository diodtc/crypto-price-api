# Crypto Price API — pay-per-call, no API key

A live cryptocurrency price API that charges **$0.005 USDC per call on Base**,
paid with [x402 v2](https://x402.org) before it answers. No API key, no account,
no subscription. Built for [zkVerify Agent Games](https://agentgames.zkverify.io)
(Wildcard track) and for the vAPI Network "List your API" quest.

**Live endpoint:** https://crypto-price-api.dtccrypto.workers.dev

## Why this exists

Price APIs were designed for humans: create an account, verify an email, store a
secret key, pick a monthly plan. An autonomous agent has none of that — no email,
no card, no patience for a sign-up form. If agents are going to trade, pay and
verify on their own, the APIs they use have to sell data the way agents can
actually buy it: one call, one price, one payment, in code.

## How it works

`POST /price` with a CoinGecko coin id. The payment flow is five HTTP steps:

1. **Call** — the agent sends `POST /price` with the asset it wants priced.
2. **402** — the API replies `402 PAYMENT-REQUIRED`, with the exact amount
   ($0.005 USDC), the network (Base) and the payment destination, in the JSON
   body and in the base64 `PAYMENT-REQUIRED` header.
3. **Pay** — the agent signs a USDC payment from its own wallet. No redirect,
   no checkout page, no human in the loop.
4. **Retry** — the agent repeats the same request carrying the payment
   signature in the `PAYMENT-SIGNATURE` header.
5. **200** — the API verifies and settles the payment through the x402
   facilitator, then returns the live price with its timestamp. The settlement
   rides back in the `PAYMENT-RESPONSE` header.

```bash
# First call: 402 with the payment offer
curl -X POST https://crypto-price-api.dtccrypto.workers.dev/price \
  -H 'content-type: application/json' \
  -d '{"id":"bitcoin","vs":"usd"}'

# Paid call (after paying 0.005 USDC on Base and signing):
#   same request + header  PAYMENT-SIGNATURE: <base64 payment payload>
# -> 200 {"id":"bitcoin","vs":"usd","price":...,"timestamp":"..."}
```

## Endpoints

| Method & path     | What it does |
| ----------------- | ------------ |
| `GET /`           | Service info, price per call, payout wallet |
| `GET /openapi.json` | OpenAPI 3.0.3 document (discovery) |
| `POST /price`     | Payable price lookup (the real operation) |
| `POST /`, `POST /openapi.json` | Same 402 challenge (so API-discovery probes pass) |

Payment details (x402 v2, `exact` scheme):

- Network: Base (`eip155:8453`)
- Asset: USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Amount: `5000` (= $0.005, 6 decimals)
- Facilitator: https://x402.org/facilitator
- Payout wallet: `0x8166206CBe9f11b5b059812Fd88C57f7F1f6622d`

Price data comes from CoinGecko's public API — no key needed.

## Run it yourself

```bash
npm install
npm start          # listens on http://localhost:4242
```

Set `PAY_TO` to change the payout wallet (defaults to the wallet above).

## Deploy to Cloudflare Workers

The same code runs unchanged on Node (`index.mjs`) and on Workers
(`worker.mjs`) — no Node-only APIs. It was deployed with the Cloudflare API:
upload `worker.mjs` + `app.mjs` as modules (bundle `hono` into the upload),
then enable the `workers.dev` subdomain.

## Stack

Hono + Node, zero external keys. Deployed on Cloudflare Workers.

## The trust problem this points at

A price is a trust claim. When this API returns a number, you trust two hops:
you trust the server, and the server trusts its data source. The payment proves
you paid — it does not prove the price was real, fresh, or actually came from
the source named. That is exactly the gap zkVerify closes: proving data came
from the source it claims (e.g. with zkTLS) without revealing anything else.
In an economy where agents act on prices automatically, "I fetched it" is not
enough. The winning standard will be "I can prove where it came from."

## Links

- Live API: https://crypto-price-api.dtccrypto.workers.dev
- OpenAPI: https://crypto-price-api.dtccrypto.workers.dev/openapi.json
- Creator Track article (LinkedIn): https://www.linkedin.com/pulse/ai-agents-cant-sign-up-saas-so-i-built-api-charges-per-budi-warsono-zzkgc/
- Agent Games profile: @Nentoczc (X) · diodtc (GitHub)
