# Deployment and verification

## Current state

Assay uses a two-project setup for now:

- **Dev and Vercel Preview:** `vxiogubmacymbejlsdnh` (Tokyo, `ap-northeast-1`). The migration and RLS suite still require verification on the dev project.
- **Production:** `izhmbumaohbmtdabypii`. Keep it Production-only; no migrations or deployments have been applied there.

A separate staging project is optional and can be added later if Preview needs to be isolated from dev data or production use warrants a dedicated rehearsal environment.

## Target architecture

- Frontend: Vite static build on Vercel (`npm run build`, output `dist`).
- Auth/database: Supabase Auth and Postgres with RLS. Dev and Preview use the Tokyo dev project; Production uses the configured production project.
- Vercel functions: Mumbai (`bom1`) near the database.
- AI: later server-side integration only, disabled until redaction, organization opt-in, disclosure, and citation validation are implemented.
- Docker: not used.

The region choice is for latency and primary data location, not a compliance guarantee. See [PHASE0_AUDIT.md](./PHASE0_AUDIT.md).

## Before a preview deployment

1. Use the dev project for local development and Vercel Preview; keep the configured production project for Production only. A dedicated staging project is a later option, not a current prerequisite.
2. Configure Supabase Auth email confirmation, recovery, allowed redirect URLs for Preview and Production, CAPTCHA, disabled anonymous sign-in, and rate limits. The SQL also limits organization creation to three per user per rolling 24-hour period.
3. Apply migrations through the Supabase CLI and version control. The latest run/invitation hardening migration and expanded RLS suite still require verification on dev. Before any production migration, rehearse it on dev and obtain explicit production approval; do not edit production by hand.
4. Verify multi-organization access, comments, finding decisions, reviewer routing, invitation acceptance/delivery, and audit history in Preview.
5. The migration provisions a private image bucket (PNG/JPEG/WebP, 5 MB), review-linked metadata, signed URLs, and a concurrency-safe limit of 10 image assets per review. Server-side review checks decode stored image bytes and reject missing or mismatched objects. Malware scanning, lifecycle retention, and deletion controls still need operational setup before confidential production use.
6. Confirm the Vercel account/scope and configure environment-specific variables: Preview uses dev and Production uses production. Browser code uses only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; keep service-role and AI secrets server-side.
7. Exercise fresh sign-up and a multi-account review cycle in Preview before promoting anything to Production.

The current build is not ready for an organization/agency pilot. Keep AI and unsupported features unavailable.

## Continuous integration

`.github/workflows/ci.yml` runs the production build and the RLS SQL suite against a fresh local Supabase stack on pushes and pull requests. It does not link to or modify dev, staging, or production projects. A green CI run complements, but does not replace, the user's required dev-project migration and verification.

## Environment configuration and CSP

For local development, put the dev URL and publishable key in ignored `.env.local`. Set the same variable names separately in Vercel's Preview and Production environments:

- Preview: use the dev project `vxiogubmacymbejlsdnh`.
- Production: use the production project `izhmbumaohbmtdabypii`.

`.env.example` contains names only. Do not hardcode either project's URL in source or `vercel.json`.

The production Vite build requires `VITE_SUPABASE_URL` and generates the CSP `img-src` and `connect-src` origins from that environment's URL, including its matching WebSocket origin. This keeps local builds, Preview, and Production aligned with their respective Supabase projects; do not hardcode a project URL in `vercel.json`. `X-Frame-Options: DENY` remains a response header.

## Server-side review checks

The Vercel `POST /api/run-review` function gets approved active rules, active claims, review content, and assets through a service-role RPC after the caller's review access is verified under RLS. It analyzes stored image bytes server-side, stores findings and content/asset/rule/claim snapshots atomically, and rejects stale inputs. Run records are valid for at most 24 hours and no later than the nearest active claim expiry. Approval and waiver require the current, unexpired run; each review is rate-limited to one run every 10 seconds and 500 findings per run.

Invitations are created through a service-role-only RPC that serializes organization caps, enforces role rules, and counts audit events so revocation does not refund the daily limit. Invitation delivery requires Resend configuration; failed delivery is reported and the pending row is revoked. Set `APP_URL` to the canonical environment origin so the invite link lands on the correct Preview or Production domain.

Configure these variables independently for Preview and Production. They must point to the same Supabase project as the corresponding `VITE_` variables: Preview uses dev, and Production uses production.

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — sensitive; server-side only, never use a `VITE_` prefix
- `APP_URL` — the canonical HTTPS origin used in invitation links; set explicitly for each deployed environment
- `RESEND_API_KEY` — sensitive; server-side only
- `INVITATION_FROM_EMAIL` — a verified sender address for Resend
- `INVITATION_DAILY_LIMIT` — optional, defaults to `20`

Keep the browser variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` configured separately. `.env.example` lists variable names only. Do not copy secret values into the repository.

Before deploying the function, apply all migrations to dev and run the RLS test suite. The review-run and invitation RPCs are restricted to the service role. Production remains unchanged until the Preview workflow and release checks pass and production changes are explicitly approved.
