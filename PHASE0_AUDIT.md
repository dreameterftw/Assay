# Phase 0 — audit and decisions

**Status:** Local audit and initial Phase 1 implementation are in progress. The project URL and publishable key were supplied and placed in ignored `.env.local`. No hosted migration or policy has been applied or verified. Never commit or print `.env.local`.

## Browser storage inventory

| Data | Browser path | Current cloud path | Still outstanding |
| --- | --- | --- | --- |
| Supabase Auth session | Supabase JS SDK persists its session in localStorage by default. | Supabase Auth. | Verify email confirmation, recovery, session lifetime, and redirect settings. |
| Legacy workspace JSON | The old `assay-workspace-v1` content key is removed at app startup and sign-out. No content reads or writes remain. | None; data must be re-entered/imported. | No automatic migration of old browser data. |
| Reviews, rules, claims | In-memory React state only. | `reviews`, `brand_rules`, and `approved_claims` through normalized Supabase upserts. | Migration must be applied and cloud writes exercised. Findings, comments, decisions, and revisions are not yet persisted. |
| Images and documents | No durable browser path. Image upload currently reports unavailable. | Planned private Supabase Storage and asset metadata. | Buckets, signed URLs, parsing, scan, retention, and deletion. |
| Findings and analytics | Findings are recomputed in the browser; Radar is derived from the loaded records. | Planned `review_findings` and SQL views. | Server checks and durable outcomes are not implemented. |
| Downloaded backup | Explicit user download/import; no background browser persistence. | Import currently writes supported core records. | Images and workflow history are skipped on import. |

No use of sessionStorage, IndexedDB, service worker, or Cache API was found in `src/`. Supabase Auth's SDK-managed session storage is separate from workspace content and is a normal browser default; see the [Supabase JavaScript Auth overview](https://supabase.com/docs/reference/javascript/auth).

## Service and authentication state

### Supabase

- The project URL and publishable key are configured in ignored local `.env.local`; the key is not committed. The actual project region and Auth settings are not confirmed.
- `supabase/migrations/202611160001_phase1_foundation.sql` defines organizations, memberships, five application roles, invitation records, core review/brand tables, RLS, explicit grants, and organization-bound composite foreign keys. It has no JSON workspace snapshot/RPC.
- `supabase/tests/phase1_rls.sql` checks tenant isolation for all five roles across tenant tables. It is staged but has not run. No Docker is being used; hosted test execution requires Supabase CLI authentication and database access, neither provided here.
- The app loads a user's first organization or creates one and reads/writes supported normalized records. Invitation acceptance, multi-organization switching, server-side finding decisions, and complete audit persistence remain unimplemented.

### Vercel

- Vercel CLI `65.16.0` is authenticated as `dr3amtoosadr07-7447`. The default Hobby scope has no projects, and the prior selected scope was inaccessible.
- No `.vercel/project.json`, Vercel project, deployment, or Vercel environment variables exist yet.
- The GitHub repository is under `dreameterftw`; the Vercel account/scope match still needs confirmation before linking.
- `vercel.json` has static security headers only. It does not configure a backend, region, or secrets.

## Target schema map

| Feature | Storage target |
| --- | --- |
| Tenant and roles | `organizations`, `organization_members`, `workspace_invitations` |
| Brand rules and claims | `brand_rules`, `approved_claims`; rule history/version approval will be extended in Phase 2 |
| Glossary and assets | Future `glossary_terms`, `assets`, private Storage bucket, signed URLs |
| Reviews and findings | `reviews`, `review_findings` with citations constrained to same-organization rules/claims |
| Comments and history | `review_comments`, append-only `review_events`, `review_revisions` |
| Parsing and AI jobs | Future document/source/chunk and `review_jobs` tables |
| Radar | SQL views over real findings, dismissals, overrides, and timestamps |

Every tenant table must have RLS, explicit grants, and tests for every role, non-members, and cross-organization reads and writes. The current migration is a Phase 1 base, not the complete product schema.

## AI and region decisions

- Initial provider choice: server-side OpenAI, disabled until organization opt-in, redaction, disclosure, schema/citation validation, and data-flow logging are in place. Do not expose provider secrets in browser variables.
- The owner requested Mumbai for Supabase (`ap-south-1`) and Vercel (`bom1`). The region of the supplied Supabase project has not been verified. Treat region as a latency and primary-location choice, not a compliance guarantee. Vercel CDN and service operations may be distributed. See [Supabase regions](https://supabase.com/docs/guides/platform/regions), [Vercel regions](https://vercel.com/docs/regions), and [Vercel compliance](https://vercel.com/docs/security/compliance).
- OpenAI API data is not used for model training by default; standard abuse monitoring can retain content, so disclose the provider and review current data controls before enabling it. See [API data controls](https://developers.openai.com/api/docs/guides/your-data).

## Features that are not production-ready

- Findings are local deterministic checks; the review engine, AI checks, rewrites, citations, and document/image/slide parsing are not server-backed.
- UI comments, approval actions, decisions, revision history, routing, passport, and Radar are not yet durable server audit/workflow records. Do not treat them as authoritative across users.
- The visible image path is disabled until private storage exists. Guideline import, extraction, glossary, assets, embeddings, email notifications, Slack, scanning, and retention/deletion controls are not implemented.
- Guild is intentionally absent rather than simulated. Error monitoring, rate limits, backup/DR, and production security operations are outstanding.

## Exit status

- [x] Inventory browser storage and map app data to target tables.
- [x] Check current Vercel and local Supabase configuration state.
- [x] Record AI and region decisions with data-flow caveats.
- [x] List unsupported or browser-only behavior.
- [ ] Confirm the Supabase region and Auth settings; apply migration in a non-production environment.
- [ ] Execute the two-organization RLS test suite and resolve failures.
- [ ] Confirm the Vercel account/scope, link a project, and configure Preview/Production variables.
- [ ] Complete normalized workflow persistence and end-to-end multi-account review before deployment.
