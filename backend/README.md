# Kelyra Hosted API

This is the public backend boundary for Kelyra Console. It is intentionally
separate from the local CLI bridge in `site/server.mjs`.

## Live Rules

- Public routes use `/api/*`.
- Local CLI bridge routes use `/api/local/*`.
- The hosted API never executes a user's local filesystem directly.
- Proof execution must go through an authenticated job and an isolated runner.
- Provider keys, runner secrets, and signing keys stay server-side only.

## Development

```bash
npm run backend:dev
```

Dev access code:

```text
dev-kelyra
```

## Production Env

Required:

```bash
NODE_ENV=production
KELYRA_API_SECRET=<random 32+ char secret>
KELYRA_ACCESS_CODE_SHA256=<sha256 of beta access code>
KELYRA_ALLOWED_ORIGINS=https://kelyra.example
DATABASE_URL=postgres://...
```

Optional:

```bash
KELYRA_STORE_DIR=/var/lib/kelyra-api
KELYRA_STATIC_DIR=/app/site
KELYRA_PUBLIC_BASE_URL=https://kelyra.example
KELYRA_DATABASE_SSL=false
KELYRA_RUNNER_MODE=hosted-worker
KELYRA_BASE_RPC_URL=https://mainnet.base.org
KELYRA_REQUIRE_TOKEN_HOLDER=true
KELYRA_TOKEN_ADDRESS=<base-erc20-contract-address>
KELYRA_TIER_TOKEN_SYMBOL=KELYRA
KELYRA_BASIC_TOKEN_MIN=5000000
KELYRA_CORE_TOKEN_MIN=50000000
KELYRA_PRO_TOKEN_MIN=100000000
KELYRA_ULTIMATE_TOKEN_MIN=1000000000
KELYRA_WALLET_AUTH_DOMAIN=Kelyra Console
KELYRA_RATE_LIMIT_PER_MINUTE=80
KELYRA_ACCESS_CODE_TIER_ID=basic
KELYRA_SESSION_TTL_SECONDS=43200
PORT=8080
```

`DATABASE_URL` enables the production Postgres store. `KELYRA_STORE_DIR` is a
development fallback or a volume-backed emergency mode; do not rely on ephemeral
disk for a public launch.

`KELYRA_RUNNER_MODE=queue-only` accepts proof jobs but does not execute them.
Use it only for a gated preflight. `KELYRA_RUNNER_MODE=hosted-worker` lets the
worker service claim queued jobs and write hosted receipts.

`KELYRA_REQUIRE_TOKEN_HOLDER=true` makes wallet login check the configured ERC-20
balance on Base. The wallet tier is selected from the configured token thresholds:
Basic, Core, Pro, or Ultimate. Keep `KELYRA_ACCESS_CODE_SHA256` available only
for internal beta users or emergency access.

Daily quotas are served from `/api/tiers` and enforced by the backend. The default
tiers can be tuned with `KELYRA_*_ORACLE_DAILY`, `KELYRA_*_DATA_DAILY`,
`KELYRA_*_BUILD_DAILY`, and `KELYRA_*_PROOF_DAILY`, or replaced with
`KELYRA_TIER_CONFIG_JSON`.

## Railway MVP

The repo includes `Dockerfile`, `railway.json`, and `railway.worker.json`.

1. Create a Railway web service from the repo.
2. Add a Railway Postgres database and expose `DATABASE_URL` to the service.
3. Set the required production variables above.
4. Use `/api/health` as the healthcheck.
5. Create a second Railway service from the same repo/image with start command
   `npm run backend:worker`.
6. Set `KELYRA_RUNNER_MODE=hosted-worker` on both services once the worker is
   online and using the same `DATABASE_URL`.

## Local Live Smoke

Terminal 1:

```bash
PORT=4350 KELYRA_ALLOWED_ORIGINS=http://127.0.0.1:4350 KELYRA_RUNNER_MODE=hosted-worker npm run backend:start
```

Terminal 2:

```bash
KELYRA_ALLOWED_ORIGINS=http://127.0.0.1:4350 KELYRA_RUNNER_MODE=hosted-worker npm run backend:worker
```

Terminal 3:

```bash
KELYRA_SMOKE_BASE_URL=http://127.0.0.1:4350 npm run backend:smoke
```

## Current Endpoints

- `GET /api/health`
- `GET /api/pulse`
- `POST /api/oracle/analyze`
- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/wallet/nonce`
- `POST /api/auth/wallet/verify`
- `POST /api/auth/logout`
- `POST /api/data`
- `POST /api/proof/jobs`
- `GET /api/proof/jobs`
- `GET /api/proof/jobs/:id`
- `GET /api/receipts`
- `GET /api/apps`
- `POST /api/apps/build`
- `GET /api/apps/:slug`
- `GET /api/apps/:slug/preview`

Static landing and console files are served by the same backend process from
`site/` by default, so a single Railway web service can host the phase-2 MVP.
