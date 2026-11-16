import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { AssayData } from './storage'
import type { Review, BrandRule, ApprovedClaim } from './types'

export type CloudWorkspace = { id: string; name: string; role: string; data: AssayData }

const emptyData = (): AssayData => ({ reviews: [], rules: [], claims: [] })
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function loadOrCreateWorkspace(user: User): Promise<CloudWorkspace> {
  if (!supabase) throw new Error('Supabase is not configured.')

  const { data: memberships, error: memberError } = await supabase
    .from('organization_members')
    .select('organization_id, role, organizations(id, name, created_at)')
    .order('created_at', { ascending: true })
    .limit(1)
  if (memberError) throw memberError

  let org = (memberships?.[0] as unknown as { organizations?: { id: string; name: string } | null } | undefined)?.organizations
  let role = memberships?.[0]?.role ?? 'creator'
  if (!org) {
    const { data: created, error } = await supabase.from('organizations')
      .insert({ name: 'My Organization', owner_id: user.id }).select('id, name').single()
    if (error) throw error
    org = created
    role = 'admin'
  }

  const [rulesResult, claimsResult, reviewsResult] = await Promise.all([
    supabase.from('brand_rules').select('*').eq('organization_id', org.id).order('created_at'),
    supabase.from('approved_claims').select('*').eq('organization_id', org.id).order('created_at'),
    supabase.from('reviews').select('*').eq('organization_id', org.id).order('created_at', { ascending: false }),
  ])
  if (rulesResult.error) throw rulesResult.error
  if (claimsResult.error) throw claimsResult.error
  if (reviewsResult.error) throw reviewsResult.error

  const data: AssayData = {
    rules: (rulesResult.data ?? []).map((row) => ({
      id: row.id, category: fromRuleCategory(row.category), label: row.title,
      description: row.description, source: row.source_label, status: row.status === 'approved' ? 'Approved' : 'Draft',
      severity: titleCase(row.severity) as BrandRule['severity'], active: row.active, matchText: row.match_text,
    })),
    claims: (claimsResult.data ?? []).map((row) => ({
      id: row.id, statement: row.statement, evidence: row.evidence_label, owner: row.owner_label,
      reviewDate: row.reviewed_at ?? '', expiryDate: row.expires_at ?? '', active: row.active,
    })),
    reviews: (reviewsResult.data ?? []).map((row) => ({
      id: row.id, title: row.title, channel: row.channel,
      owner: row.created_by === user.id ? user.email ?? 'You' : 'Workspace member',
      initials: (row.created_by === user.id ? user.email ?? 'You' : 'W').slice(0, 2).toUpperCase(),
      time: new Date(row.created_at).toLocaleDateString(),
      status: fromReviewStatus(row.status), findings: [], content: row.content,
      reviewer: undefined, riskTier: titleCase(row.risk_tier) as Review['riskTier'], comments: [], events: [], revisions: [],
    })),
  }

  return { id: org.id, name: org.name, role, data }
}

// Writes supported in Phase 1 are normalized rows. Related workflow details
// (findings decisions, comments, image assets) are intentionally not faked here.
export async function saveWorkspaceData(organizationId: string, actorId: string, data: AssayData): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (!uuidPattern.test(organizationId) || !uuidPattern.test(actorId)) throw new Error('Invalid workspace identity.')

  if (data.rules.length) {
    const rows = data.rules.map((rule) => ({
      id: requireUuid(rule.id, 'rule'), organization_id: organizationId,
      rule_key: rule.id, version: 1, match_text: rule.matchText?.trim() || '',
      category: toRuleCategory(rule.category), title: rule.label, description: rule.description,
      source_label: rule.source, severity: rule.severity.toLowerCase(),
      status: rule.status === 'Approved' ? 'approved' : 'draft', active: rule.active, created_by: actorId,
    }))
    const { error } = await supabase.from('brand_rules').upsert(rows, { onConflict: 'id' })
    if (error) throw error
  }

  if (data.claims.length) {
    const rows = data.claims.map((claim) => ({
      id: requireUuid(claim.id, 'claim'), organization_id: organizationId,
      statement: claim.statement, value: null, evidence_label: claim.evidence,
      evidence_url: null, owner_label: claim.owner, reviewed_at: claim.reviewDate || null,
      expires_at: claim.expiryDate || null, active: claim.active, created_by: actorId,
    }))
    const { error } = await supabase.from('approved_claims').upsert(rows, { onConflict: 'id' })
    if (error) throw error
  }

  if (data.reviews.length) {
    const rows = data.reviews.map((review) => ({
      id: requireUuid(review.id, 'review'), organization_id: organizationId,
      title: review.title, channel: review.channel, content: review.content,
      status: toReviewStatus(review.status), risk_tier: (review.riskTier ?? 'Standard').toLowerCase(),
      rule_set_version: 1, created_by: actorId,
    }))
    const { data: existing, error: lookupError } = await supabase.from('reviews').select('id').in('id', rows.map((row) => row.id))
    if (lookupError) throw lookupError
    const existingIds = new Set((existing ?? []).map((row) => row.id))
    const updates = rows.filter((row) => existingIds.has(row.id))
    const inserts = rows.filter((row) => !existingIds.has(row.id))
    if (updates.length) {
      const { error } = await supabase.from('reviews').upsert(updates, { onConflict: 'id' })
      if (error) throw error
    }
    for (const row of inserts) {
      const { status, ...newDraft } = row
      const { error: insertError } = await supabase.from('reviews').insert({ ...newDraft, status: 'draft', risk_tier: 'standard' })
      if (insertError) throw insertError
      if (status === 'submitted') {
        const { error: submitError } = await supabase.from('reviews').update({ status: 'submitted' }).eq('id', row.id)
        if (submitError) throw submitError
      } else if (status !== 'draft') {
        throw new Error('New reviews can only be created as drafts or submitted for review.')
      }
    }
  }
}

function requireUuid(value: string, kind: string) {
  if (!uuidPattern.test(value)) throw new Error(`This ${kind} has an unsupported identifier. Export a backup before replacing it.`)
  return value
}

function titleCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1) }
function toRuleCategory(category: BrandRule['category']) {
  return ({ Terminology: 'terminology', 'Required language': 'required_language', Claims: 'claims', Tone: 'tone' } as const)[category]
}
function fromRuleCategory(category: string): BrandRule['category'] {
  return ({ terminology: 'Terminology', required_language: 'Required language', claims: 'Claims', tone: 'Tone' } as const)[category as 'terminology' | 'required_language' | 'claims' | 'tone'] ?? 'Terminology'
}
function toReviewStatus(status: string) {
  return ({ Draft: 'draft', 'Needs review': 'submitted', 'In review': 'in_review', 'Changes requested': 'changes_requested', Approved: 'approved' } as Record<string, string>)[status] ?? 'draft'
}
function fromReviewStatus(status: string) {
  return ({ draft: 'Draft', submitted: 'Needs review', in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved', waived: 'Approved' } as Record<string, string>)[status] ?? 'Draft'
}
