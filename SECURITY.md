# Assay security and privacy status

## Current state

- Local Auth and normalized persistence are implemented against the supplied project configuration, but hosted Auth, schema, RLS, and data writes remain unverified.
- The former `assay-workspace-v1` content mirror is no longer read or written; the legacy key is removed at app startup and sign-out. Supabase Auth still persists its browser session as expected.
- Phase 1 migrations explicitly enable RLS and grant only required table operations. Tenant-owned child rows use composite organization/parent foreign keys. Review events and revisions are append-only for authenticated clients.
- RLS tests cover cross-organization reads and writes for all five application roles. Tests are not run here because the hosted database needs to be exercised separately and Docker is not used.
- Image uploads are unavailable until private Storage and signed URLs exist. Findings and workflow UI records are not yet authoritative server history.
- AI processing is disabled. Do not treat this build as ready for confidential customer content.

## Required before a pilot

1. Review and apply `supabase/migrations/202611160001_phase1_foundation.sql` to a non-production project.
2. Execute `supabase/tests/phase1_rls.sql` and resolve every failure before entering real workspace data.
3. Add verified invitation acceptance, organization switching, immutable decision writes, and server-backed findings/comments/revisions.
4. Add private Storage, short-lived signed URLs, upload validation/scanning, and documented retention/deletion.
5. Keep service-role and AI provider secrets on server routes only. Never expose them in `VITE_` variables.
6. Redact sensitive content before any external model call. Log provider/model/data categories and validation outcome without raw content by default; show an AI-use notice.
7. Add rate limits, error monitoring, backup restoration, incident response, and a data-flow page.

## Proposed AI data handling

The initial proposal is one server-side OpenAI provider, only after an organization opts in. API inputs are not used to train models by default, but abuse monitoring and application-state retention can still apply. Do not describe this as zero retention. See [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data).

## Deployment headers

`vercel.json` configures CSP, frame protections, MIME sniffing protection, referrer policy, and disabled camera/microphone/location. Revisit `connect-src` and `img-src` when adding hosted APIs, assets, analytics, or integrations; document each new data flow.
