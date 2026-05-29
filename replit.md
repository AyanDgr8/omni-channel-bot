# VoxAgent

AI Voice Bot Platform management dashboard — a full-stack control plane for enterprise-grade SIP telephony AI bots with multi-LLM support, WhatsApp/Telegram/Email messaging, calendar scheduling, and a three-tier memory system.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (port 8080, proxy path `/api`)
- Dashboard: React + Vite + Tailwind v4 + shadcn/ui + wouter + React Query (previewPath `/`)
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Charts: recharts

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI source of truth
- `lib/api-zod/src/generated/api.ts` — Zod schemas for backend validation
- `lib/api-client-react/src/generated/api.ts` — React Query hooks for frontend
- `lib/db/src/schema/` — Drizzle ORM table definitions
- `artifacts/api-server/src/routes/` — Express 5 route handlers
- `artifacts/dashboard/src/pages/` — 7 dashboard pages
- `artifacts/dashboard/src/components/Layout.tsx` — sidebar navigation shell

## Architecture decisions

- Contract-first: OpenAPI spec drives both Zod validation (backend) and React Query hooks (frontend) via Orval codegen
- All config (persona/conversation/LLM) stored in DB with a single `default` row; upserted on first access
- Memory entries tiered (L1/L2/L3) by hit count and confidence — reindex triggered manually via `/v1/memory/train`
- Outbound calls simulate completion asynchronously (5s timeout) to demonstrate full call lifecycle
- Messaging routes write to `message_logs` for full delivery audit trail

## Product

- **Dashboard**: Real-time KPI cards, 24h call volume chart, hangup reason pie chart
- **Call Log**: Paginated call history with filters, inline hangup action, outbound dial modal
- **Bot Network**: CRUD grid for AI bot agents with live status badges
- **Configuration**: Hot-reload persona sliders, conversation pacing controls, LLM fallback chain editor
- **Knowledge Base**: Searchable L1/L2/L3 memory Q&A entries with reindex trigger
- **Messaging Hub**: WhatsApp/Telegram/Email send forms with delivery log
- **Calendar**: Available slot picker + calendar invite composer

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After changing `lib/db` schema: run `pnpm --filter @workspace/db run push` then `pnpm run typecheck:libs`
- After changing `lib/api-spec/openapi.yaml`: run `pnpm --filter @workspace/api-spec run codegen`
- Tailwind v4: cannot use `dark` as an `@apply` utility — it's a variant only
- Run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck` or table exports won't resolve

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
