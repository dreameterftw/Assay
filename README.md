# Assay

Assay is a brand-governance workspace for reviewing content against an organisation’s approved rules and evidence.

## Run locally

```powershell
npm install
npm run dev
```

Docker is not required. The browser client uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in ignored `.env.local`. Apply `supabase/migrations/202611160001_phase1_foundation.sql` before sign-up and workspace persistence can work. The project URL and publishable key have been supplied, but the migration has not been applied or verified against the hosted project.

## Current implementation status

- Seeded sample reviews and the sample Guild are removed from the live navigation. A new workspace starts empty.
- Email/password sign-up and sign-in UI is scaffolded with Supabase Auth.
- First sign-in creates an organization and admin membership. Reviews, rules, and claims use normalized table upserts with RLS; comments, findings, decisions, and revisions are not yet durably stored.
- Deterministic checks run in the browser. Image upload is disabled until private object storage is implemented. JSON backup/import is explicit and imports only core records.
- Vercel CLI is authenticated, but its default scope has no project and no deployment exists. Supabase config is local only; hosted Auth, schema, and policies have not been verified.
- AI calls are disabled. No customer content is sent to an AI provider.

## Not ready for customer use

The Supabase migration and RLS policies have not been applied or tested. Multi-user roles, invitations, normalized server persistence, private file storage, document parsing, server-side review, grounded AI, retention controls, notification delivery, and monitoring remain incomplete. Read [PHASE0_AUDIT.md](./PHASE0_AUDIT.md) for the data inventory, mapping, architecture choices, and remaining browser-only features.

Do not put a Supabase service-role key or AI provider secret in a `VITE_` variable. See [DEPLOYMENT.md](./DEPLOYMENT.md) and [SECURITY.md](./SECURITY.md) before creating a pilot deployment.
