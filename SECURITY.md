# Assay security and privacy status

## Current state

- Local Auth and normalized persistence are implemented against the supplied project configuration, but hosted Auth, schema, RLS, and data writes remain unverified.
- The former `assay-workspace-v1` content mirror is no longer read or written; the legacy key is removed at app startup and sign-out. Supabase Auth still persists its browser session as expected.
- Phase 1 migration explicitly enables RLS and grants only required table operations. Creators see only their own or assigned reviews and child data; approved active rules are visible to creators. Tenant-owned child rows use composite organization/parent foreign keys.
- Review events/revisions are written by database triggers, immutable to authenticated clients, and protected from review deletion. Finding decisions and comments are append-only. Approved rules are immutable and stamped with approver/time. Review approval blocks self-approval, enforces legal approval for high risk, and prevents creator-controlled routing/risk changes.
- RLS tests cover both tenant isolation and these role/workflow cases. Tests are staged but not run against hosted Postgres; Docker is not used.
- Owner-only role-promotion/removal/ownership-transfer functions record organization events. Auth user deletion is restricted while referenced content/membership exists; there is no automated anonymization flow yet.
- Image uploads are unavailable until private Storage and signed URLs exist. Deterministic findings are computed in the browser and are not server-validated; AI findings are disabled.
- Supabase Auth email confirmation, anonymous sign-in, CAPTCHA, and provider rate limits are dashboard configuration and remain unverified. The database limits organization creation to three per owner per rolling 24 hours.
- AI processing is disabled. Do not treat this build as ready for confidential customer content.

## Required before a pilot

1. Review and apply `supabase/migrations/202611160001_phase1_foundation.sql` to a non-production project.
2. Execute `supabase/tests/phase1_rls.sql` and resolve every failure before entering real workspace data.
3. Add verified invitation acceptance and delivery, then add server-side finding generation and validation.
4. Add private Storage, short-lived signed URLs, upload validation/scanning, and documented retention/deletion.
5. Keep service-role and AI provider secrets on server routes only. Never expose them in `VITE_` variables.
6. Redact sensitive content before any external model call. Log provider/model/data categories and validation outcome without raw content by default; show an AI-use notice.
7. Add rate limits, error monitoring, backup restoration, incident response, and a data-flow page.

## Proposed AI data handling

The initial proposal is one server-side OpenAI provider, only after an organization opts in. API inputs are not used to train models by default, but abuse monitoring and application-state retention can still apply. Do not describe this as zero retention. See [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data).

## Deployment headers

`vercel.json` configures CSP, frame protections, MIME sniffing protection, referrer policy, and disabled camera/microphone/location. Revisit `connect-src` and `img-src` when adding hosted APIs, assets, analytics, or integrations; document each new data flow.
