# Assay implementation phases

Assay is built as a pre-publication brand review workflow. The product plan is intentionally broader than the first build; each phase should finish in a working, reviewable product increment.

## Phase 1 — Review workspace foundation (current)

**Goal:** establish the product shell and demonstrate the central review loop with representative sample data.

- Create the responsive review workspace, navigation, review queue, finding details, evidence links, and status summaries.
- Support selecting a review, filtering and searching the queue, resolving or dismissing findings, and approving a review.
- Add a quick draft submission path so the queue can be exercised interactively.
- Use clearly labeled sample/demo review data; no external service or account is needed.

**Done when:** the app builds and runs locally; a reviewer can work through a full sample review without a dead end.

## Phase 2 — Brand Brain and deterministic review (implemented)

**Goal:** make checks genuinely grounded in editable brand data before adding AI.

- Add structured brand rules, terminology, and approved claims with evidence, owner, review date, and expiry date.
- Add a rule editor with draft/approved states and a simple rule-set version.
- Implement deterministic checks first: preferred/banned terminology, required disclaimers, expired claims, and basic policy matches.
- Replace sample findings with findings computed from the submission and active rule set.
- Persist workspace data in browser storage while the schema and workflow settle.

**Done when:** editing a rule or claim changes the review result predictably, and every deterministic finding links to its active source.

**Current implementation:** Brand Brain has editable approved/draft rules and an approved-claims list with expiry dates. Review rules are deterministic and source-linked. Workspace changes persist in browser local storage. New rules can be approved and activated; claims can be archived/restored. A local rule regression preview checks a proposed phrase against saved review copy and lists newly matched reviews without changing the rule set. The current checker covers starter terminology, prohibited wording, required sponsored-post disclosure, superlatives, and matches to approved numeric claims. Rule extraction, file import, AI review, and server persistence are not part of this phase.

**Verification:** `npx tsc -b --pretty false` passes, `npm run build` passes, and the Vite development server starts locally. No Docker is used.

## Phase 3 — Grounded AI review and intent-preserving fixes (implemented as offline demo)

**Goal:** add model assistance with evidence validation and honest uncertainty.

- Add a server-side provider interface for one hosted language model.
- Retrieve only relevant approved rules and claims for a submission.
- Require structured outputs that cite source IDs and exact content spans; validate IDs and spans server-side and discard invalid findings.
- Label tone judgments as interpretive and claim results as supported, contradicted, expired, or unable to verify against the supplied vault.
- Capture creator intent and protected spans; propose optional edits and re-run checks before presenting them.
- Show an AI-use notice and the provider/data flow for the review.

**Done when:** model output cannot create an uncited finding or silently replace content, and suggested copy is checked against the same rules.

**Current implementation:** Relevant-source retrieval, source-ID/exact-span validation, confidence bounds, tone-as-judgment labeling, creator-intent capture, a local offline tone demo, and deterministic rechecking of optional edits are implemented. External provider calls remain disabled until an authenticated server endpoint and an approved data-flow policy are in place. The offline demo is illustrative and is not an LLM result.

## Phase 4 — Human review, approvals, and audit passport (local prototype implemented)

**Goal:** turn a useful checker into a review workflow.

- Add creator, manager, brand reviewer, and legal reviewer roles.
- Route high-risk claim findings to legal and other content to the appropriate reviewer.
- Add comments, revision history, decisions, dismissal reasons, and time-limited waivers.
- Produce a review passport containing the submitted version, rule-set version, findings, resolutions, approvers, timestamps, and AI-use disclosure.
- Move persistence from browser storage to hosted PostgreSQL and managed authentication (for example, Supabase).

**Done when:** a second user can review a submission and the complete decision history can be reconstructed.

**Current implementation:** Local role selector; risk-based assignment labels; comments and change requests; revision snapshots and restore; decision event history; approval timestamp; passport modal and JSON export. All records remain in the current browser's local storage. Multi-user collaboration, authentication, server-backed audit integrity, and hosted database persistence remain for a later deployment phase.

## Phase 5 — Visual checks, insights, and Guild (implemented as local prototype)

**Goal:** expand beyond text and close the learning loop.

- Add image upload and deterministic accessibility/color checks, then optional vision-model checks.
- Build Radar from real review events: recurring findings, overrides, rule disagreements, expiring claims, and approval bottlenecks.
- Add rule regression examples so a rule change can be compared against prior approved/rejected samples.
- Add a compact Guild: curated playbooks, anonymised clinic prompts, expert profiles, and request-introduction flow.
- Clearly distinguish computed product data from seeded demo examples.

**Done when:** a reviewer can move from a recurring issue to a rule improvement or relevant playbook.

**Current implementation:** Campaign images stay in the browser and are resized for local persistence. Checks inspect alt-text presence, pixel dimensions, and coarse dominant-color distance against a small workspace palette. Radar counts open findings and recorded decisions from locally saved reviews, and labels repeated issues as heuristic prompts. The Guild contains curated sample playbooks that can be imported as draft rules. No vision model, real cross-brand benchmarks, verified expert profiles, user posts, or external marketplace is implemented.

## Phase 6 — Production readiness and integrations (foundation implemented)

**Goal:** support real teams and existing publishing workflows.

- Add secure file parsing for DOCX/PDF/slides, upload limits/scanning, retention controls, workspace isolation, and operational monitoring.
- Add notifications, invitation flows, and a submission API; later consider browser, Docs/Slides, Figma, and CMS integrations.
- Add benchmark sets and report precision/recall by finding category, source citation rate, fix acceptance, and review-time change.
- Add deployment, backup, privacy, and incident-response documentation.

**Done when:** a pilot workspace can use Assay with its own rules and content under documented data and access controls.

**Current implementation:** Static deployment headers, security/privacy documentation, a proposed Supabase Postgres schema with workspace-scoped RLS, a small synthetic benchmark runner, and validated local JSON backup/restore are in place. The benchmark exposed and fixed a `#1` superlative detection bug. The static app is still browser-local: the hosted database is not wired to the UI, auth and protected API routes are not implemented, file ingestion and integrations are not present, and the SQL has not been applied to a live project or independently security-reviewed. The backup file can include local image data and is not encrypted by Assay.

## Stack and local development (no Docker)

- **Current prototype:** Vite, React, TypeScript, and local sample data.
- **AI later:** a single server-side API integration; keep provider keys out of browser code.
- **Hosted product later:** hosted PostgreSQL/auth/storage such as Supabase, plus a frontend deployment service such as Vercel. Phase 4 currently records a local prototype audit trail; server-backed multi-user access is still required for production approvals.
- **Local run:** `npm install`, then `npm run dev`.
- **Production build:** `npm run build`.

The initial app avoids Docker, local databases, background workers, and external credentials. Add hosted services only when a phase needs them.
