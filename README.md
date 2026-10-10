# Cube — Payment Failure Resolution Agent

Cube turns a failed payment into a resolved one. When a payment provider reports
a failed charge, Cube opens an **investigation**, classifies the probable cause,
pulls the customer's financial position, recommends a mitigation, runs a
guardrail, and either retries silently, escalates, or emails the customer — with
a human approval step when auto-send is off. Every step is traced and audited.

## How it works

```
provider webhook ─▶ ingest (idempotent) ─▶ queue ─▶ investigation pipeline
                                                         │
   context + history ─▶ cfo.ai financials ─▶ classify ─▶ recommend ─▶ LLM rationale
                                                         │
                              cfo.ai scenario ◀─ audit ─┤
                                                         ▼
                              guardrail ─▶ email sent | queued for approval | blocked | escalate
```

- **Ingest** (`packages/agent`) is idempotent on the provider event id.
- **Classify** maps decline codes + history to a cause, severity and confidence.
- **cfo.ai** supplies deterministic financial context and recovery scenarios,
  falling back to the local ledger/model when not configured.
- **Guardrail** (`packages/agent/src/policy.ts`) always runs before any email:
  email present, not risk-flagged, sane amount, per-customer rate limit, quiet
  hours.
- **Human in the loop**: with `AGENT_AUTO_SEND=false` a passing email is queued
  and sent only after an operator approves it.
- **Observability**: neatlogs traces span the whole run and are linked from each
  investigation.

## Stack

TypeScript · Bun · Next.js 16 (App Router) · Express 5 · Drizzle ORM ·
PostgreSQL · Biome · Turborepo.

## Layout

```
cube/
├── apps/
│   ├── web/        # Next.js dashboard (investigations, API keys, auth)
│   └── server/     # Express API, agent queue, auth, webhooks
└── packages/
    ├── agent/      # pipeline, classify, policy, cfo.ai + email tools, queue
    ├── db/         # Drizzle schema + client
    ├── ui/         # shared shadcn/ui primitives
    └── config/     # shared tsconfig
```

## Getting started

Prerequisites: [Bun](https://bun.sh), a PostgreSQL database.

```bash
bun install                 # installs deps and generates env types (varlock)
```

Configure env (see `.env.schema` in each app for the full list; secrets stay in
the gitignored `.env`):

- `apps/server/.env` — `DATABASE_URL`, `CORS_ORIGIN`, `SERVER_PUBLIC_URL`,
  integrations (`CFO_AI_*`, `NEATLOGS_API_KEY`, `RESEND_API_KEY`, `LLM_*`),
  auth (`SESSION_*`, `AUTH_LOGIN_*`).
- `apps/web/.env` — `NEXT_PUBLIC_SERVER_URL` and deep-link templates.

Apply the schema and seed a demo workspace:

```bash
bun run db:push             # push the Drizzle schema
bun run seed                # demo user + project + API key + webhook secret
```

`seed` prints the demo login (default `demo@cube.test` / `demo-password`,
override with `DEMO_PASSWORD`), an API key and a webhook secret.

Run everything in development:

```bash
bun run dev                 # web on :3001, API on :3000
```

## Authentication

- **Dashboard** uses email + password (Argon2id via `Bun.password`) with an
  opaque session token in an httpOnly, SameSite=Lax cookie. Only the token hash
  is stored. Register at `/register`, or use the seeded demo user.
- **Password reset** emails a single-use, expiring link (`/forgot-password` →
  `/reset-password`). Setting a new password revokes every active session.
- **Machines** use project API keys (`cube_<prefix>_<secret>`, stored hashed,
  revocable, optionally expiring). Send as `Authorization: Bearer …` or
  `x-api-key`.
- **Tenancy**: every investigation and simulate request is scoped to the
  caller's projects — a session sees the projects it owns; an API key sees only
  its own project. Manage keys at `/settings/api-keys`.
- **Webhooks** are HMAC-SHA256 signed with a per-project secret. Point your
  provider at `/webhooks/stripe/:projectId`, or use the global dev secret at
  `/webhooks/stripe`.

## API (all under the server origin)

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | none | Liveness + DB check |
| POST | `/auth/register` | none | Create user + workspace, auto-login |
| POST | `/auth/login` | none | Email/password login |
| POST | `/auth/logout` | session | End the session |
| GET | `/auth/me` | session | Current user + projects |
| POST | `/auth/password/request` | none | Email a password-reset link |
| GET | `/auth/password/verify` | none | Check a reset token (`?token=`) |
| POST | `/auth/password/reset` | none | Set a new password from a token |
| GET | `/projects` | session | List owned projects |
| GET | `/projects/:id/webhook-secret` | session | View webhook URL + secret |
| POST | `/projects/:id/webhook-secret` | session | Rotate the webhook secret |
| GET/POST/DELETE | `/api-keys[/:id]` | session | List / create / revoke keys |
| GET | `/investigations` | session or key | Paginated, filterable list (`page`, `pageSize`, `q`, `status`, `severity`, `sort`, `order`) |
| GET | `/investigations/summary` | session or key | KPI aggregates |
| GET | `/investigations/:id` | session or key | Full investigation detail |
| POST | `/investigations/:id/approve` | session or key | Send a queued email |
| POST | `/investigations/:id/reject` | session or key | Reject a queued email |
| POST | `/webhooks/stripe[/:projectId]` | HMAC | Provider failed-payment webhook |
| POST | `/mock/simulate` | session or key | Fabricate failed charges (dev) |

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Run web + API in watch mode |
| `bun run build` | Build all apps |
| `bun run check-types` | Typecheck every workspace |
| `bun run test` | Run unit tests (`@cube/agent`, `server`) |
| `bun run check` | Biome format + lint (writes) |
| `bun run db:push` / `db:studio` | Apply schema / open Drizzle Studio |
| `bun run seed` | Seed the demo workspace |
| `bun run simulate -- 8` | Ingest N simulated failed charges |
| `bun run cfo:login` / `cfo:publish` | cfo.ai OAuth / publish scenarios |

## Testing

```bash
bun run test
```

Unit tests cover the classify/recommend/policy logic, formatting, the approval
decision, and auth helpers (password, API keys, rate limiting).

## Notes

- Schema is applied with `drizzle-kit push` (no migration files yet) — fine for
  local/dev, add migrations before a real deployment.
- The in-memory login/registration rate limiter is per-instance; swap for Redis
  when running more than one.
