---
name: DB lib build order
description: typecheck:libs must run before leaf packages that import @workspace/db
---

`@workspace/db` is a composite library that emits declarations. Leaf packages (like `@workspace/api-server`) import from it and need those declarations to be present before TypeScript can resolve the table exports.

**Why:** Without running `tsc --build` on the libs first, TypeScript sees `@workspace/db` as having no exported members, even though the source files are correct.

**How to apply:** Always run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck` (or any leaf package typecheck). The root `pnpm run typecheck` script does this automatically in the right order.
