## Project overview

- This is a Next.js 16 (App Router) TypeScript project using Supabase for auth and data. Key front-end/server split: UI lives under `app/` and server API routes under `app/api/`.
- Primary services: Supabase (auth + database), Sentry (error observability), Mercado Pago + Stripe (client-portal payments). Environment vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`/`SENTRY_DSN`.
- Today this is a single-tenant system (one admin, one row in `tenant_members`, role `owner`) — multi-tenant support exists in the schema but isn't in active use. Don't assume a second admin/user exists.

## Architecture & patterns to follow

- **Admin authorization — always go through the central helpers, never re-query `tenant_members` by hand:**
  - Bearer-token API routes (called with `Authorization: Bearer <access_token>`): use `requireAdminTenant(req)` from `lib/api/auth.ts`. It resolves the user, checks `tenant_members` role via `isAdminRole()`, and returns `{ ok, supabase, tenant_id, user_id, role }` (or `{ ok:false, res }` to return directly).
  - Cookie-session routes/Server Components (uses `lib/supabase/server.ts`'s `createClient()`): use `getAdminTenantContext()` from `lib/api/auth-server.ts`. If you already have a Supabase client in scope and just need tenant/role, use `resolveAdminTenant(supabase, userId)` instead (avoids creating a second client).
  - `proxy.ts` (was `middleware.ts`) can't use the helpers above directly (different cookie-reading mechanism), but its role check must stay in sync with `isAdminRole()` from `lib/api/auth.ts` — import and reuse that function, don't reimplement the role list.
  - Service-to-service calls (VM/whatsapp-service, Vercel Cron) use `lib/internal-auth.ts`: `isInternalRequest(req, secretEnvVar?)` for the `x-internal-secret` header family, `isCronRequest(req, secretEnvVar)` for `Authorization: Bearer <cron-secret>`. Never compare secrets with `===` — always go through this module (timing-safe).
- Server-side Supabase: use `createClient()` in `lib/supabase/server.ts` for server components and cookie-session API routes (uses `cookies()` and `@supabase/ssr`).
- Client-side Supabase: use `supabaseBrowser` exported from `lib/supabase/browser.ts` in browser code.
- API routes return `NextResponse.json(...)` with proper HTTP status codes. Follow the existing pattern in the specific route family you're editing — some use `{ ok, ... }`, others `{ error }`/`{ data }`; don't change an existing route's response shape without checking what the frontend expects.

## Sensitive routes using SUPABASE_SERVICE_ROLE_KEY (webhooks, crons, fulfillment, client-portal)

Lots of routes legitimately need the service-role client — webhooks, cron jobs, and client-portal routes have no Supabase-auth user session for RLS to key off. That's expected, not a bug. But for routes that touch **money or a client's actual service state** (payments, fulfillment/renewal, billing automations), follow the pattern already used in `lib/client-portal/fulfillment.ts` and the webhook routes:

- **Idempotency**: guard against double-processing (duplicate webhook delivery, double-click, concurrent cron tick). Prefer an atomic `UPDATE ... WHERE status IN (...) RETURNING` claim (see `client_portal_try_acquire_fulfillment_lock` in Postgres, or the per-job lock in `app/api/whatsapp/envio_programado/route.ts`) over check-then-act in application code.
- **Observability**: real failures in these flows must reach Sentry, not just a caught exception returned as JSON. Import `* as Sentry from "@sentry/nextjs"` and call `Sentry.captureException(e, { tags: {...} })` (or `captureMessage` for non-exception failures) at the point of failure — see `markFulfillmentError` in `lib/client-portal/fulfillment.ts` for the reference pattern.
- **Logging**: `next.config.ts` strips `console.*` in production except `console.error` (`compiler.removeConsole`) — use `console.error` for anything worth keeping, not `console.log`.

Catalog/EPG sync, admin CRUD, and other non-money service-role routes don't need this treatment — they're either idempotent by construction (upsert) or low-stakes single-admin operations. Don't add idempotency/Sentry ceremony there without a concrete reason.

## Conventions & common helpers

- Normalizers: small helper functions (e.g. `normalizePhone`, `normalizeExtras`) are used before DB inserts — keep inputs sanitized and convert dates to ISO strings.
- DB calls: prefer `.select()` with `.single()`/`.maybeSingle()` when expecting one row; handle Supabase `error` and return helpful messages.
- Cookies: `createClient()` in `lib/supabase/server.ts` relies on `cookies()` (Next.js server API). Avoid calling cookie-write logic from pure client components.

## Important files to reference

- `lib/api/auth.ts` — `requireAdminTenant`, `isAdminRole`, `ADMIN_ROLES` (Bearer-token routes)
- `lib/api/auth-server.ts` — `getAdminTenantContext`, `resolveAdminTenant` (cookie-session routes)
- `lib/internal-auth.ts` — `isInternalRequest`, `isCronRequest`, `hasBadInternalHeader` (service-to-service)
- `lib/observability.ts` — `flagSuspiciousAccess` (Sentry signal for 403/bad-secret rejections; don't use for routine 401s, too noisy)
- `lib/client-portal/fulfillment.ts` — reference pattern for idempotent, observable payment fulfillment
- `lib/supabase/server.ts` — server client factory (cookie-session)
- `lib/supabase/browser.ts` — browser Supabase client (`supabaseBrowser`)
- `app/` — UI routes and components; many admin screens live under `app/admin/...`

## Developer workflows & commands

- Run development: `npm run dev` (uses `next dev`)
- Build: `npm run build` and start: `npm run start`
- Lint: `npm run lint` (ESLint configured)
- Test: `npm test` (Vitest) — currently covers webhook signature verification (`lib/webhook-signatures.ts`) and the auth helpers above. Not a full suite by design; add tests here for other pure/deterministic logic, not for routes that need a real DB/external provider.

## Guidelines for changes

- Keep server/client surface separation: use `lib/supabase/server.ts` inside server code and `lib/supabase/browser.ts` in browser code.
- Preserve existing HTTP status and JSON response patterns; callers expect `NextResponse.json({ error: ... }, { status })` or `{ data }`/`{ ok }` payloads matching what that specific route family already returns.
- When adding a new protected API route, use the central helpers above — don't write a new inline `tenant_members` query.

## Examples (copy patterns)

- Bearer-token admin route: `app/api/admin/apps/configure/route.ts` — `requireAdminTenant(req)`, validate input, perform DB operation, return response.
- Cookie-session admin route: any file under `app/api/import_export/*` — `createClient()` + `resolveAdminTenant(supabase, user.id)`.
- Idempotent, observable payment flow: `app/api/webhooks/mercadopago/route.ts` + `lib/client-portal/fulfillment.ts`.

## Questions / follow-up

- If you need specific conventions (commit messages, branch naming, release flow), tell me and I will add them.
