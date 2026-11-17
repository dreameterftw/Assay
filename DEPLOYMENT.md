# Deployment and verification

## Current state

The configured Supabase project URL is production and must not be used for development testing. The user applies migrations and runs the SQL suite against a separate `assay-dev` project. No migration or SQL suite has been run by this agent against any hosted project.

## Target architecture

- Frontend: Vite static build on Vercel (`npm run build`, output `dist`).
- Auth/database: Supabase Auth and Postgres with RLS. The requested target is Mumbai (`ap-south-1`), but the existing project's region still needs verification.
- Vercel functions: Mumbai (`bom1`) near the database.
- AI: later server-side integration only, disabled until redaction, organization opt-in, disclosure, and citation validation are implemented.
- Docker: not used.

The region choice is for latency and primary data location, not a compliance guarantee. See [PHASE0_AUDIT.md](./PHASE0_AUDIT.md).

## Before a preview deployment

1. Maintain separate Supabase projects for dev, staging, and production; keep the existing configured project as production. Confirm region and configure Supabase Auth email confirmation, recovery, redirect URLs, CAPTCHA, disabled anonymous sign-in, and rate limits. The SQL also limits organization creation to three per user per rolling 24-hour period.
2. Apply migrations through the Supabase CLI and version control in order: dev, then staging, then production. Do not edit production by hand.
3. Run `supabase/tests/phase1_rls.sql` against dev before proceeding to staging. This agent does not run `supabase login`, `supabase link`, `supabase db push`, or SQL against hosted projects.
4. Verify multi-organization access, comments, finding decisions, reviewer routing, and audit history after the migration is applied. Invitation acceptance and delivery still need implementation.
5. The migration provisions a private image bucket (PNG/JPEG/WebP, 5 MB), review-linked metadata, signed URLs, and a concurrency-safe limit of 10 image assets per review. Uploads are enabled after the migration is applied. Malware scanning, lifecycle retention, and deletion controls still need operational setup before confidential production use.
6. Confirm the Vercel account/scope and configure environment-specific variables: Preview uses staging and Production uses production. Browser code uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; keep service-role and AI secrets server-side.
7. Exercise fresh sign-up and a multi-account review cycle in Preview before promoting anything to Production.

The current build is not ready for an organization/agency pilot. Keep AI and unsupported features unavailable.

## Continuous integration

`.github/workflows/ci.yml` runs the production build and the RLS SQL suite against a fresh local Supabase stack on pushes and pull requests. It does not link to or modify dev, staging, or production projects. A green CI run complements, but does not replace, the user's required dev-project migration and verification.

## Environment configuration and CSP

For local development, put the `assay-dev` URL and publishable key in ignored `.env.local`. Set the same variable names separately in Vercel's Preview (staging) and Production environments. `.env.example` contains names only.

The production Vite build requires `VITE_SUPABASE_URL` and generates the CSP `img-src` and `connect-src` origins from that environment's URL, including its matching WebSocket origin. This keeps local builds, Preview, and Production aligned with their respective Supabase projects; do not hardcode a project URL in `vercel.json`. `X-Frame-Options: DENY` remains a response header.

## Server-side review checks

The Vercel `POST /api/run-review` function runs deterministic checks using only approved, active rules and active claims from the organization selected through the review's RLS-protected row. It stores findings, a content-hash run record, and a review event. The function rejects archived, approved, and waived reviews and limits each review to one run every 10 seconds.

Configure these variables independently for Preview (staging) and Production. They must point to the same Supabase project as the corresponding `VITE_` variables:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — sensitive; server-side only, never use a `VITE_` prefix

Keep the browser variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configured separately. `.env.example` lists variable names only. Do not copy secret values into the repository.

Before deploying the function, apply both migration files to a non-production project and run the RLS test suite. The rate-limit RPC is restricted to the service role.
