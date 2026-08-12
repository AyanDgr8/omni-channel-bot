---
name: Phase 1 Multi-Tenancy & RBAC — key facts
description: Design decisions, default credentials, and constraints from the multi-tenancy implementation
---

# Phase 1 Multi-Tenancy & RBAC

## Default tenant & admin
- Default tenant UUID: `00000000-0000-0000-0000-000000000001` (slug=`default`)
- Default admin user: `admin@voxagent.local` / `voxagent` (bcrypt hash in `0001_tenants_users.sql`)

## Schema decisions
- `personas.isActive` — UI convenience flag (stays)
- `bots.activePersonaId` — the real per-bot persona assignment; nullable FK to personas
- `emailAgentConfigTable.msTenantId` = Azure AD tenant ID (TS field only, same DB column `ms_tenant_id`)
- `emailAgentConfigTable.voxTenantId` = VoxAgent org FK (new column; NOT unique-constrained, so use SELECT-first then INSERT/UPDATE, not `onConflictDoUpdate`)

## Migrations path resolution (dev vs prod)
`src/lib/run-migrations.ts` checks `__dirname.includes("/dist")`:
- Production (esbuild bundle): `path.join(__dirname, "migrations")` → `dist/migrations/`
- Development (tsx): `path.resolve(__dirname, "../../../../lib/db/src/migrations")` → workspace `lib/db/src/migrations/`

## RBAC rank order
`ANALYST < SUPERVISOR < ADMIN < OWNER` — stored in `ROLE_RANK` from `@workspace/db`

## Session
- `express-session` + `connect-pg-simple` store
- Session table DDL created in migration `0001_tenants_users.sql`
- Cookie: `sameSite: "lax"`, `secure: false` in dev — same-origin, cookies sent automatically without `credentials: "include"`

## Route conventions
- `req.params` values must be cast `as string` when passed to Drizzle `eq()` — Drizzle types params as `string | string[]`
- Auth exempt paths: `/api/v1/health`, `/api/v1/auth/*`
- Webhook auth path: `X-Webhook-Secret` header + `tenant_dids` lookup

## Integration tests
- All 21 tenant-isolation tests pass in `artifacts/api-server/src/__tests__/tenant-isolation.test.ts`
- Run with: `cd artifacts/api-server && DATABASE_URL="$DATABASE_URL" pnpm test`
- Setup seeds two temp tenants + users, cleans up in `afterAll`

## Dashboard auth
- `hooks/use-auth.ts` — react-query wrapper for auth/me; exposes login, logout
- `pages/login.tsx` — standalone login page (no Layout)
- `pages/users.tsx` — OWNER-only user management
- `App.tsx` — ProtectedRoute wraps all routes; `/login` is public
- `Layout.tsx` — shows tenant name, user email/role badge, logout button

## What was intentionally deferred
- api-zod Zod schemas + api-client-react typed hooks for auth/users endpoints (Task #20)
- Password self-service change endpoint (Task #21)
- Login rate limiting / account lockout (Task #22)
