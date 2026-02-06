## Project overview

- This is a Next.js 16 (App Router) TypeScript project using Supabase for auth and data. Key front-end/server split: UI lives under `app/` and server API routes under `app/api/`.
- Primary services: Supabase (auth + database). Environment vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Architecture & patterns to follow

 - Server-side Supabase: use the helper `createClient()` in `lib/supabase/server.ts` for server components and API routes (it uses `cookies()` and `@supabase/ssr`). Example: `app/api/revendedor/route.ts`.
- Client-side Supabase: use the exported `supabase` from `lib/supabase/client.ts` in browser code.
- API routes return `NextResponse.json(...)` with proper HTTP status codes. Follow existing patterns for error/status handling.
- Auth checks: many server routes call `supabase.auth.getUser()` then check permissions via `tenant_members` (role must be `ADMIN`). Mirror this flow when adding new protected routes.

## Conventions & common helpers

- Normalizers: small helper functions (e.g. `normalizePhone`, `normalizeExtras`) are used before DB inserts — keep inputs sanitized and convert dates to ISO strings.
- DB calls: prefer `.select()` with `.single()`/`.maybeSingle()` when expecting one row; handle Supabase `error` and return helpful messages.
- Cookies: `createClient()` in `lib/supabase/server.ts` relies on `cookies()` (Next.js server API). Avoid calling cookie-write logic from pure client components.

## Important files to reference

- `lib/supabase/server.ts` — server client factory (use in server routes)
- `lib/supabase/client.ts` — browser Supabase client
 - `app/api/*` — server routes that show how auth/tenant checks and DB patterns are implemented (see `app/api/revendedor/route.ts`)
- `app/` — UI routes and components; many admin screens live under `app/admin/...`

## Developer workflows & commands

- Run development: `npm run dev` (uses `next dev`)
- Build: `npm run build` and start: `npm run start`
- Lint: `npm run lint` (ESLint configured)

## Guidelines for changes

- Keep server/client surface separation: use `lib/supabase/server.ts` inside server code and `lib/supabase/client.ts` in browser code.
- Preserve existing HTTP status and JSON response patterns; teste or callers expect `NextResponse.json({ error: ... }, { status })` or `{ data }` payloads.
- When adding new API routes, follow permission checks: `supabase.auth.getUser()` → verify `tenant_members` role → perform DB operation.

## Examples (copy patterns)

 - Authorization pattern: see `app/api/revendedor/route.ts` — get user, verify tenant membership role, validate input, normalize fields, insert, return `201`.
- Cookie-aware server client: `lib/supabase/server.ts` implements `cookies()` wrappers — reuse this when sessions or server actions need to mutate cookies.

## Questions / follow-up

- If you need specific conventions (commit messages, branch naming, release flow), tell me and I will add them.
