# Deployment without Docker

## Static demo deployment

The current app is a static Vite build. It can be deployed to Vercel without Docker:

1. Push this repository to a Git provider.
2. Import it into Vercel and select the Vite framework preset.
3. Use `npm run build` as the build command and `dist` as the output directory.
4. Do not configure AI or database secrets for this static demo.
5. Review the security headers in `vercel.json` after deployment and smoke-check the main pages.

This publishes a demo, not a secure multi-tenant production service. The browser stores content locally, and each visitor has a separate browser-local workspace.

## Hosted team product path

The schema in `supabase/schema.sql` is a proposed hosted database/RLS foundation. It is not yet connected to the frontend or validated against a live Supabase project. Before a team pilot, apply and test it in a non-production project, then add a server-side application layer for authenticated reads/writes, membership checks, uploads, signed URLs, provider calls, rate limits, and data retention. Use a hosted deployment platform for that server layer; Docker is not required.

Keep AI disabled until an authenticated endpoint enforces workspace authorization and discloses the exact fields sent to the configured provider. A Vercel static frontend alone cannot safely hold provider credentials.
