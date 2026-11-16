import type { Review, BrandRule, ApprovedClaim } from './types'

// Workspace content is intentionally memory-only in the browser. Durable content
// is read from and written to organization-scoped Supabase tables.
export type AssayData = { reviews: Review[]; rules: BrandRule[]; claims: ApprovedClaim[] }

export function clearLegacyWorkspaceMirror() {
  try { localStorage.removeItem('assay-workspace-v1') } catch { /* storage can be unavailable */ }
}
