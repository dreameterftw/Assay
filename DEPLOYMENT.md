# Deployment without Docker

## Current state

The Supabase URL and browser-safe publishable key are configured in ignored local `.env.local`. No migration has been applied or tested against the hosted project. No Vercel project, deployment, or environment configuration exists. The Vercel CLI is logged into a default Hobby scope with no projects; confirm it is the right account before linking.

## Target architecture

- Frontend: Vite static build on Vercel (`npm run build`, output `dist`).
- Auth/database: Supabase Auth and Postgres with RLS. The requested target is Mumbai (`ap-south-1`), but the existing project's region still needs verification.
- Vercel functions, when added: Mumbai (`bom1`) near the database.
- AI: later server-side integration only, disabled until redaction, organization opt-in, disclosure, and citation validation are implemented.
- Docker: not used.

The region choice is for latency and primary data location, not a compliance guarantee. See [PHASE0_AUDIT.md](./PHASE0_AUDIT.md).

## Before a preview deployment

1. Confirm project region and configure Supabase Auth email confirmation, recovery, redirect URLs, CAPTCHA, disabled anonymous sign-in, and rate limits. The SQL also limits organization creation to three per user per rolling 24-hour period.
2. Review and apply `supabase/migrations/202611160001_phase1_foundation.sql` in a non-production environment.
3. Run `supabase/tests/phase1_rls.sql` against that environment, using an available hosted test route; Docker is not required for hosted SQL execution.
4. Complete and verify invitations, multi-organization access, and server-backed workflow history.
5. Add private object storage, signed URLs, upload limits/scanning, and retention controls before enabling uploads.
6. Confirm the Vercel account/scope, link this repository, and set only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for browser code. Keep service-role and AI secrets server-side.
7. Exercise fresh sign-up and a multi-account review cycle in Preview before promoting anything to Production.

The current build is not ready for an organization/agency pilot. Keep AI and unsupported features unavailable.
