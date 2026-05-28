# Kelyra Hosted API

This is the public backend boundary for Kelyra Console. It is intentionally
separate from the local CLI bridge in `site/server.mjs`.

## Live Rules

- Public routes use `/api/*`.
- Local CLI bridge routes use `/api/local/*`.
- The hosted API never executes a user's local filesystem directly.
- Production defaults to `KELYRA_CONSOLE_MODE=watch-only`; active hosted console
  routes should open only after auth, quotas, and worker isolation are ready.
- Proof execution must go through an authenticated job and an isolated runner.
- Wallet login uses a nonce plus `personal_sign`; it never asks for approvals,
  transactions, or spending permission.
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
KELYRA_CONSOLE_MODE=watch-only
KELYRA_RUNNER_MODE=hosted-worker
KELYRA_BASE_RPC_URL=https://mainnet.base.org
KELYRA_BASESCAN_API_KEY=<etherscan-v2-api-key>
KELYRA_BASESCAN_API_URL=https://api.etherscan.io/v2/api
KELYRA_REQUIRE_TOKEN_HOLDER=true
KELYRA_TOKEN_ADDRESS=<base-erc20-contract-address>
KELYRA_ACCESS_CODE_ENABLED=true
KELYRA_TIER_TOKEN_SYMBOL=KELYRA
KELYRA_BASIC_TOKEN_MIN=5000000
KELYRA_CORE_TOKEN_MIN=50000000
KELYRA_PRO_TOKEN_MIN=100000000
KELYRA_ULTIMATE_TOKEN_MIN=1000000000
KELYRA_OPERATOR_ORACLE_DAILY=500
KELYRA_OPERATOR_DATA_DAILY=5000
KELYRA_OPERATOR_BUILD_DAILY=120
KELYRA_OPERATOR_PROOF_DAILY=250
KELYRA_WALLET_AUTH_DOMAIN=Kelyra Console
KELYRA_RATE_LIMIT_PER_MINUTE=80
KELYRA_ACCESS_CODE_TIER_ID=operator
KELYRA_SESSION_TTL_SECONDS=43200
PORT=8080
```

`DATABASE_URL` enables the production Postgres store. `KELYRA_STORE_DIR` is a
development fallback or a volume-backed emergency mode; do not rely on ephemeral
disk for a public launch.

`KELYRA_RUNNER_MODE=queue-only` accepts proof jobs but does not execute them.
Use it only for a gated preflight. `KELYRA_RUNNER_MODE=hosted-worker` lets the
worker service claim queued jobs and write hosted receipts.

`KELYRA_CONSOLE_MODE=watch-only` exposes public config, tiers, quota profile,
and static console pages while blocking hosted chat, Pulse refresh, auth login,
proof jobs, Forge builds, and hosted data routes. Set `KELYRA_CONSOLE_MODE=active`
only when auth, quotas, and worker isolation are ready.

`KELYRA_REQUIRE_TOKEN_HOLDER=true` makes wallet login check the configured ERC-20
balance on Base. Leave it `false` until the KELYRA contract address is final,
then set both `KELYRA_TOKEN_ADDRESS=<base-erc20-contract-address>` and
`KELYRA_REQUIRE_TOKEN_HOLDER=true`. The wallet tier is selected from the
configured token thresholds: Basic, Core, Pro, or Ultimate. Keep
`KELYRA_ACCESS_CODE_SHA256` available only for internal beta users or emergency
access. Access-code sessions use the hidden `operator` tier by default so
internal smoke tests do not spend public holder quota. Set
`KELYRA_ACCESS_CODE_ENABLED=false` before public wallet-only launch if beta codes
should be unavailable from the API and hidden from the console.

Daily quotas are served from `/api/tiers` and enforced by the backend. Wallet
sessions start on fresh quota unless yesterday's UTC holder snapshot already met
the same tier minimum; after that they receive full quota. The default tiers can
be tuned with `KELYRA_*_ORACLE_DAILY`, `KELYRA_*_DATA_DAILY`,
`KELYRA_*_BUILD_DAILY`, `KELYRA_*_PROOF_DAILY`, and matching
`KELYRA_*_FRESH_*` variables, or replaced with `KELYRA_TIER_CONFIG_JSON`.

`KELYRA_BASESCAN_API_KEY` is optional. When present, Oracle reports add
source-code verification state, deployer/creation transaction, and holder count
from the Etherscan API V2 Base chain (`chainid=8453`). Without it, those fields
remain explicitly unknown.

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
- `GET /api/docs`
- `GET /openapi.json`
- `GET /api/tiers`
- `GET /api/quota/profile`
- `GET /api/pulse`
- `POST /api/oracle/analyze`
- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/wallet/nonce`
- `POST /api/auth/wallet/verify`
- `POST /api/auth/logout`
- `GET /api/data`
- `POST /api/data`
- `POST /api/proof/jobs`
- `GET /api/proof/jobs`
- `GET /api/proof/jobs/:id`
- `GET /api/receipts`
- `POST /api/receipts/import` with `Authorization: Bearer $KELYRA_API_SECRET`
- `GET /api/apps`
- `GET /api/apps/gallery`
- `GET /api/apps/public`
- `POST /api/apps/build`
- `GET /api/apps/:slug`
- `PATCH /api/apps/:slug`
- `DELETE /api/apps/:slug`
- `POST /api/apps/:slug/publish`
- `GET /api/apps/:slug/assets/:file`
- `GET /api/apps/:slug/preview`

Static landing, console, and docs are intended to be hosted separately on Vercel.
Keep Railway on `api.kelyralabs.com` with `KELYRA_SERVE_STATIC=false`; use the
local `site/` directory only for development or emergency single-service preview.
