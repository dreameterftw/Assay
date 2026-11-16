# Assay security and privacy notes

## Current prototype

- The app is a static client-side prototype. Reviews, claims, rules, comments, revisions, decisions, and small image previews are held in browser local storage.
- There is no sign-in, shared workspace, tenant isolation, server-side backup, server-side audit guarantee, or production AI integration.
- The offline AI demonstration uses local deterministic demonstration logic. It does not send drafts to an AI provider.
- Do not use this build for confidential, regulated, or production content.

## Hosted data foundation

`supabase/schema.sql` defines a proposed hosted PostgreSQL schema with workspace membership, role-scoped policies, and workspace-scoped review data. It has not been applied to or exercised against a live Supabase project. Review event and revision tables deny direct update/delete to authenticated clients. This is not a cryptographic audit log: database owners and service-role credentials remain privileged, and backup/retention operations can remove data.

Before using the schema with real data:

1. Apply it only to a non-production Supabase project first.
2. Test tenant isolation using at least two users in separate workspaces and attempt reads, inserts, updates, and deletes across workspace IDs.
3. Review role transitions, workspace-owner lifecycle, deletion/retention behavior, and service-role access.
4. Keep the Supabase service-role key and AI provider keys server-side. Never prefix these secrets with `VITE_`.
5. Add authentication and authorization to every server API route before enabling a hosted model provider.
6. Document which content and retrieved brand sources leave the workspace before any external model call.

## Deployment headers

`vercel.json` configures CSP, frame protections, MIME sniffing protection, referrer policy, and disabled camera/microphone/location. Review the policy if adding analytics, external APIs, image hosts, or integrations. Do not broaden `connect-src` or `img-src` without documenting the data flow.

## Incident and user controls still needed

For a real pilot, implement and document account recovery, workspace deletion, retention/deletion jobs, export, incident response, dependency scanning, request logging limits, and backup restoration. Avoid logging submitted content, prompts, claims, tokens, or model responses by default.
