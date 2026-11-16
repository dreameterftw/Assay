# Assay

Assay is a pre-publication brand review workspace. It checks submitted content against approved rules and evidence, explains findings, and keeps review decisions with the content.

## Run locally

```powershell
npm install
npm run dev
```

No Docker or external account is needed for the offline demo. The development server runs at `http://localhost:5173` by default.

## Review modes

- **Offline demo:** works without an API key. It demonstrates source retrieval, source ID/span validation, a cautious tone suggestion, and human acceptance.
- **Connected AI:** intentionally not enabled in this frontend-only build. Source retrieval and output validation are implemented, but no draft or brand source is sent to a third party.

Do not set a provider key in a `VITE_` variable or put it in client-side code. Before enabling an external provider, deploy an authenticated server route, disclose which submitted data and retrieved brand sources leave the workspace, and confirm that data flow is allowed by the workspace policy.

In a production deployment, add an authenticated serverless API route and configure any provider secret only in the hosting provider's server environment.

## Current scope

- Brand rules and claims are stored in browser local storage.
- Deterministic checks run locally against the active approved rules and claims.
- Brand Brain includes a local phrase-match regression preview that shows which saved reviews a proposed term would match before adding it.
- AI findings must cite an active retrieved source and an exact span from the submitted content. Invalid findings are discarded.
- Tone judgments are always labelled as suggestions; they cannot automatically approve, publish, or change content.
- AI suggestions are rechecked against deterministic checks before acceptance.
- Image previews stay in browser storage; checks cover alt-text presence, pixel dimensions, and coarse dominant-color distance only.
- Governance Radar is computed from local review records. Repeated issues are prompts for review, not proof that a guideline is unclear.
- Settings can export a versioned JSON backup of the local workspace and restore one after validation and an explicit replacement prompt. Backups may include attached image data; keep them private.
- Assay Guild currently contains curated sample playbooks. It does not yet offer verified professionals, user posts, or paid consultations.
- This prototype does not yet provide authentication, workspace isolation, encrypted server storage, file parsing, or a production API deployment.

## Phase 6 foundations

- `supabase/schema.sql` proposes a hosted Postgres schema and row-level policies. It is not yet connected to the app or validated against a live Supabase project.
- The Settings backup is a manual local file workflow; it does not provide cloud sync or encryption.
- `vercel.json` sets static deployment security headers.
- `npm run benchmark` runs the synthetic deterministic-check benchmark. It is a smoke check, not a representative quality evaluation.
- See [DEPLOYMENT.md](./DEPLOYMENT.md) and [SECURITY.md](./SECURITY.md) for deployment and privacy boundaries.
