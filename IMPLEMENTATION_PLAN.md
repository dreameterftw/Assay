# Assay production implementation plan

This roadmap tracks the authenticated, multi-tenant product. No Docker is required or used. See [PHASE0_AUDIT.md](./PHASE0_AUDIT.md) for local storage paths, the schema map, service state, and region caveats.

## Phase 0 — Audit and decisions

**Status:** local audit complete. Supabase project URL and publishable key are configured locally; hosted region and Auth settings still need verification. Vercel account/scope has no project and needs confirmation.

**Exit:** documented browser storage, data model, AI provider, region choice, and unsupported features. Hosted RLS test and Vercel setup remain prerequisites to preview deployment.

## Phase 1 — Auth, organizations, roles, RLS

**Status:** implementation staged; not applied to the hosted database.

- Supabase email/password Auth, first-organization creation, admin membership, and organization-scoped table access.
- Roles: creator, manager, brand reviewer, legal reviewer, admin.
- Ordered SQL migration with private role helpers, explicit grants, per-operation RLS, same-organization composite foreign keys, guarded approval/risk transitions, immutable approved rules, soft deletion, database-authored audit/revisions, and no whole-workspace JSON snapshot.
- Owner-only role promotion, membership removal, and ownership transfer are audited. Org creation has a per-user database rate limit.
- Test matrix covers two organizations, all five roles, creator/assignee visibility, anonymous access, metadata spoofing, workflow constraints, and audit behavior.
- App reads/writes normalized reviews, rules, and claims. Review inserts start as drafts and submission uses the guarded update path. Legacy workspace JSON is no longer used.

**Outstanding:** apply migration, run the RLS matrix, implement invitation acceptance and organization switching, configure/verify Auth confirmation, CAPTCHA and rate limits, and verify hosted sign-up/login. Server findings/decisions and invitation delivery remain outstanding.

## Phase 2 — Brand Brain storage

- Private guideline/assets bucket, upload validation, and server-side PDF/DOCX/Markdown parsing.
- Draft rule extraction with human approval and immutable versions; claims evidence and expiry; glossary and asset library.
- Add pgvector only when source chunks and citation boundaries are ready.

## Phase 3 — Review engine

- Server review route for supported content formats; redaction before external calls.
- Deterministic terminology/disclaimer/accessibility checks and grounded checks citing rule/fact IDs.
- Citation validator rejects invalid sources. Long reviews use background jobs.
- Benchmark planted issues by category before enabling a check.

## Phase 4 — Findings and fixes

- Persist findings with exact spans, evidence, confidence, and state.
- Offer up to three optional rewrites; re-check before display. Never apply without an explicit user action.
- Store accept/edit/dismiss decisions and require a reason for dismissal.

## Phase 5 — Collaboration and approval

- Verified invitations, role-aware routing, comments/anchors, approve/request changes/waive, revision history, append-only server audit, notifications, and passport.
- Complete separate creator, manager, and legal reviewer accounts through the full cycle.

## Phase 6 — Radar insights

- SQL views over actual findings, decisions, overrides, expiring facts, and review durations.
- Remove all fixed sample counters from live organization workspaces.

## Phase 7 — Security, privacy, AI disclosure

- Private signed URLs, retention/deletion, org AI policy, rate/upload limits, scanning, prompt-injection defense, output/citation validation, AI-use notice, and data-flow logs.

## Phase 8 — Deployment and operations

- Versioned Supabase migrations, separate Preview and Production config, Vercel environment variables, error monitoring, backups, and disaster recovery.
- Run fresh signup plus two-organization/five-user acceptance scenario before production promotion.

## Phase 9 — Guild (after core)

- Verified profiles, posts, playbook import, and request-based Premium Connect only after the core workflow works. Anything incomplete stays off the live app.

## Current verification and limits

- `npm run build` passes.
- The migration and RLS tests have not been run against hosted Postgres. Supabase CLI access requires a personal access token; no token or database password was supplied. They are not requested or embedded in this repository.
- No deployment is live. Do not represent the current UI's local deterministic checks, collaboration controls, passport, or Radar as authoritative server workflows.
