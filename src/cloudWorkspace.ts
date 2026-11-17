import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { AssayData } from './storage'
import type { Review, BrandRule, ApprovedClaim, ReviewerRole, ReviewDecision } from './types'

export type WorkspaceMembership = { id: string; name: string; role: string }
export type WorkspaceMember = { userId: string; role: ReviewerRole; displayName: string }
export type ReviewCursor = { createdAt: string; id: string }
export type CloudWorkspace = { id: string; name: string; role: string; currentUserId: string; memberships: WorkspaceMembership[]; members: WorkspaceMember[]; hasMoreReviews: boolean; reviewCursor?: ReviewCursor; data: AssayData }

const emptyData = (): AssayData => ({ reviews: [], rules: [], claims: [] })
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function loadOrCreateWorkspace(user: User, selectedOrganizationId?: string | null): Promise<CloudWorkspace | null> {
  if (!supabase) throw new Error('Supabase is not configured.')

  const { data: memberships, error: memberError } = await supabase
    .from('organization_members')
    .select('organization_id, role, organizations(id, name, created_at)')
    .order('created_at', { ascending: true })
  if (memberError) throw memberError

  const available = (memberships ?? []).flatMap((membership) => {
    const org = (membership as unknown as { organizations?: { id: string; name: string } | null }).organizations
    return org ? [{ id: org.id, name: org.name, role: membership.role ?? 'creator' }] : []
  })
  let selected = available.find((membership) => membership.id === selectedOrganizationId) ?? available[0]
  let org = selected ? { id: selected.id, name: selected.name } : null
  let role = selected?.role ?? 'creator'
  if (!org) return null

  const [rulesResult, claimsResult, reviewsResult] = await Promise.all([
    supabase.from('brand_rules').select('*').eq('organization_id', org.id).order('created_at'),
    supabase.from('approved_claims').select('*').eq('organization_id', org.id).order('created_at'),
    supabase.from('reviews').select('*', { count: 'exact' }).eq('organization_id', org.id)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 24),
  ])
  if (rulesResult.error) throw rulesResult.error
  if (claimsResult.error) throw claimsResult.error
  if (reviewsResult.error) throw reviewsResult.error

  const roleResult = await supabase.from('organization_members').select('user_id,role').eq('organization_id', org.id)
  if (roleResult.error) throw roleResult.error
  const roleByUser = new Map<string, ReviewerRole>((roleResult.data ?? []).map((member) => [member.user_id, toReviewerRole(member.role)]))
  const profileResult = roleResult.data?.length
    ? await supabase.from('profiles').select('id,display_name').in('id', roleResult.data.map((member) => member.user_id))
    : { data: [], error: null }
  if (profileResult.error) throw profileResult.error
  const displayNameByUser = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile.display_name]))
  const members = (roleResult.data ?? []).map((member) => ({
    userId: member.user_id, role: toReviewerRole(member.role),
    displayName: displayNameByUser.get(member.user_id) ?? 'Workspace member',
  }))
  const memberName = (userId: string) => userId === user.id ? user.email ?? 'You' : displayNameByUser.get(userId) ?? 'Workspace member'
  const rules = (rulesResult.data ?? []).map((row) => ({
    id: row.id, ruleKey: row.rule_key, version: row.version, category: fromRuleCategory(row.category), label: row.title,
    description: row.description, source: row.source_label, status: row.status === 'approved' ? 'Approved' as const : row.status === 'retired' ? 'Retired' as const : 'Draft' as const,
    severity: titleCase(row.severity) as BrandRule['severity'], active: row.active, matchText: row.match_text,
  }))
  const claims = (claimsResult.data ?? []).map((row) => ({
    id: row.id, version: row.version, statement: row.statement, evidence: row.evidence_label, evidenceUrl: row.evidence_url ?? undefined, owner: row.owner_label,
    reviewDate: row.reviewed_at ?? '', expiryDate: row.expires_at ?? '', active: row.active,
  }))
  const data: AssayData = {
    rules,
    claims,
    reviews: (reviewsResult.data ?? []).map((row) => ({
      id: row.id, createdAt: row.created_at, title: row.title, channel: row.channel, createdById: row.created_by,
      owner: memberName(row.created_by),
      initials: (row.created_by === user.id ? user.email ?? 'You' : 'W').slice(0, 2).toUpperCase(),
      time: new Date(row.created_at).toLocaleDateString(),
      status: fromReviewStatus(row.status), findings: [], content: row.content,
      reviewer: row.assigned_reviewer ? `${displayNameByUser.get(row.assigned_reviewer) ?? 'Reviewer'} · ${roleByUser.get(row.assigned_reviewer) ?? 'Reviewer'}` : undefined,
      riskTier: titleCase(row.risk_tier) as Review['riskTier'],
      assignedReviewerId: row.assigned_reviewer ?? undefined,
      ruleSetVersion: row.rule_set_version, ruleSnapshot: row.rule_snapshot,
      passportCreatedAt: ['approved','waived'].includes(row.status) ? row.updated_at : undefined,
      waiverReason: row.waiver_reason ?? undefined, waiverExpiresAt: row.waiver_expires_at ?? undefined,
      comments: [], events: [], revisions: [], decisions: [],
    })),
  }

  return {
    id: org.id, name: org.name, role, currentUserId: user.id,
    memberships: selected ? available.length ? available : [selected] : [], members,
    hasMoreReviews: (reviewsResult.count ?? 0) > 25,
    reviewCursor: reviewsResult.data?.length ? {
      createdAt: reviewsResult.data[reviewsResult.data.length - 1].created_at,
      id: reviewsResult.data[reviewsResult.data.length - 1].id,
    } : undefined,
    data,
  }
}

export async function loadMoreReviews(
  organizationId: string,
  before: ReviewCursor | undefined,
  user: Pick<User, 'id' | 'email'>,
  members: WorkspaceMember[],
): Promise<{ reviews: Review[]; hasMore: boolean; cursor?: ReviewCursor }> {
  if (!supabase) throw new Error('Supabase is not configured.')
  let query = supabase.from('reviews').select('*').eq('organization_id', organizationId)
  if (before) {
    query = query.or(`created_at.lt.${before.createdAt},and(created_at.eq.${before.createdAt},id.lt.${before.id})`)
  }
  const { data, error } = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).range(0, 25)
  if (error) throw error
  const memberById = new Map(members.map((member) => [member.userId, member]))
  const rows = data ?? []
  const reviews = rows.slice(0, 25).map((row): Review => {
    const owner = row.created_by === user.id ? user.email ?? 'You' : memberById.get(row.created_by)?.displayName ?? 'Workspace member'
    const reviewer = row.assigned_reviewer ? memberById.get(row.assigned_reviewer) : undefined
    return {
      id: row.id, createdAt: row.created_at, title: row.title, channel: row.channel, createdById: row.created_by,
      owner, initials: owner.slice(0, 2).toUpperCase(), time: new Date(row.created_at).toLocaleDateString(),
      status: fromReviewStatus(row.status), findings: [], content: row.content,
      reviewer: reviewer ? `${reviewer.displayName} · ${reviewer.role}` : undefined,
      riskTier: titleCase(row.risk_tier) as Review['riskTier'], assignedReviewerId: row.assigned_reviewer ?? undefined,
      ruleSetVersion: row.rule_set_version, ruleSnapshot: row.rule_snapshot,
      passportCreatedAt: ['approved','waived'].includes(row.status) ? row.updated_at : undefined,
      waiverReason: row.waiver_reason ?? undefined, waiverExpiresAt: row.waiver_expires_at ?? undefined,
      comments: [], events: [], revisions: [], decisions: [],
    }
  })
  const last = rows[Math.min(rows.length, 25) - 1]
  return { reviews, hasMore: rows.length > 25, cursor: last ? { createdAt: last.created_at, id: last.id } : undefined }
}

export async function loadReviewImage(organizationId: string, reviewId: string): Promise<Review['image'] | undefined> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data: asset, error } = await supabase.from('review_assets').select('*')
    .eq('organization_id', organizationId).eq('review_id', reviewId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  if (!asset) return undefined
  const { data: signed, error: signedError } = await supabase.storage.from(asset.bucket_id).createSignedUrl(asset.object_path, 300)
  if (signedError) throw signedError
  return {
    assetId: asset.id, storagePath: asset.object_path, name: asset.filename, dataUrl: signed.signedUrl,
    width: asset.width, height: asset.height, altText: asset.alt_text,
    palette: Array.isArray(asset.palette) ? asset.palette : [],
  }
}

export async function createWorkspace(user: Pick<User, 'id'>, name: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const cleanName = name.trim()
  if (!cleanName) throw new Error('Enter a workspace name.')
  const { data, error } = await supabase.from('organizations')
    .insert({ name: cleanName, owner_id: user.id }).select('id').single()
  if (error) throw error
  return data.id
}

// Writes are scoped to known IDs and update only fields that actually changed.
// Database triggers remain responsible for approval guards and audit history.
export async function saveWorkspaceData(organizationId: string, actorId: string, data: AssayData): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (!uuidPattern.test(organizationId) || !uuidPattern.test(actorId)) throw new Error('Invalid workspace identity.')

  if (data.rules.length) {
    for (const rule of data.rules) {
      const id = requireUuid(rule.id, 'rule')
      const { data: current, error: readError } = await supabase.from('brand_rules').select('*')
        .eq('organization_id', organizationId).eq('id', id).maybeSingle()
      if (readError) throw readError
      const values = {
        rule_key: rule.ruleKey ?? id, version: rule.version ?? 1, match_text: rule.matchText?.trim() || '', category: toRuleCategory(rule.category),
        title: rule.label, description: rule.description, source_label: rule.source,
        severity: rule.severity.toLowerCase(), status: rule.status === 'Approved' ? 'approved' : rule.status === 'Retired' ? 'retired' : 'draft', active: rule.active,
      }
      if (!current) {
        const { error: insertError } = await supabase.from('brand_rules').insert({ id, organization_id: organizationId, ...values, created_by: actorId })
        if (insertError) throw insertError
        continue
      }
      const update: Record<string, unknown> = {}
      for (const key of Object.keys(values) as (keyof typeof values)[]) {
        if (current[key] !== values[key]) update[key] = values[key]
      }
      if (Object.keys(update).length) {
        const { error: updateError } = await supabase.from('brand_rules').update(update).eq('organization_id', organizationId).eq('id', id)
        if (updateError) throw updateError
      }
    }
  }

  if (data.claims.length) {
    for (const claim of data.claims) {
      const id = requireUuid(claim.id, 'claim')
      const { data: current, error: readError } = await supabase.from('approved_claims').select('*')
        .eq('organization_id', organizationId).eq('id', id).maybeSingle()
      if (readError) throw readError
      const values = {
        statement: claim.statement, evidence_label: claim.evidence, evidence_url: claim.evidenceUrl?.trim() || null, owner_label: claim.owner,
        reviewed_at: claim.reviewDate || null, expires_at: claim.expiryDate || null, active: claim.active,
      }
      if (!current) {
        const { error: insertError } = await supabase.from('approved_claims').insert({ id, organization_id: organizationId, ...values, created_by: actorId })
        if (insertError) throw insertError
        continue
      }
      const update: Record<string, unknown> = {}
      for (const key of Object.keys(values) as (keyof typeof values)[]) {
        if (current[key] !== values[key]) update[key] = values[key]
      }
      if (Object.keys(update).length) {
        const { error: updateError } = await supabase.from('approved_claims').update(update).eq('organization_id', organizationId).eq('id', id)
        if (updateError) throw updateError
      }
    }
  }

  if (data.reviews.length) {
    for (const review of data.reviews) {
      const id = requireUuid(review.id, 'review')
      const { data: current, error: readError } = await supabase.from('reviews').select('*')
        .eq('organization_id', organizationId).eq('id', id).maybeSingle()
      if (readError) throw readError
      const status = toReviewStatus(review.status)
      if (!current) {
        if (!['draft', 'submitted'].includes(status)) throw new Error('New reviews can only be created as drafts or submitted for review.')
        const { error: insertError } = await supabase.from('reviews').insert({
          id, organization_id: organizationId, title: review.title, channel: review.channel, content: review.content,
          status: 'draft', risk_tier: 'standard', rule_set_version: 1, created_by: actorId,
        })
        if (insertError) throw insertError
        if (status === 'submitted') {
          const { error: submitError } = await supabase.from('reviews').update({ status: 'submitted' }).eq('organization_id', organizationId).eq('id', id)
          if (submitError) throw submitError
        }
      } else {
        const values = { title: review.title, channel: review.channel, content: review.content, status, risk_tier: (review.riskTier ?? 'Standard').toLowerCase(), assigned_reviewer: review.assignedReviewerId ?? null, waiver_reason: review.waiverReason ?? null, waiver_expires_at: review.waiverExpiresAt ?? null }
        const update: Record<string, unknown> = {}
        for (const key of Object.keys(values) as (keyof typeof values)[]) {
          if (current[key] !== values[key]) update[key] = values[key]
        }
        if (Object.keys(update).length) {
          const { error: updateError } = await supabase.from('reviews').update(update).eq('organization_id', organizationId).eq('id', id)
          if (updateError) throw updateError
        }
      }
    }

    const newComments = data.reviews.flatMap((review) => (review.comments ?? [])
      .filter((comment) => uuidPattern.test(comment.id))
      .map((comment) => ({ id: comment.id, organization_id: organizationId, review_id: review.id, author_id: actorId, body: comment.text, anchor: comment.anchor ? { text: comment.anchor } : {}, visibility: comment.visibility ?? 'shared' })))
    if (newComments.length) {
      const { error: insertError } = await supabase.from('review_comments').upsert(newComments, { onConflict: 'id', ignoreDuplicates: true })
      if (insertError) throw insertError
    }

    const newDecisions = data.reviews.flatMap((review) => (review.decisions ?? [])
      .filter((decision) => uuidPattern.test(decision.id))
      .map((decision) => ({
        id: decision.id, organization_id: organizationId, review_id: review.id,
        finding_key: decision.findingKey, finding_title: decision.findingTitle,
        action: decision.action, reason: decision.reason, actor_id: actorId,
      })))
    if (newDecisions.length) {
      const { data: existing, error: readError } = await supabase.from('review_decisions')
        .select('id').in('id', newDecisions.map((decision) => decision.id))
      if (readError) throw readError
      const existingIds = new Set((existing ?? []).map((decision) => decision.id))
      const pendingDecisions = newDecisions.filter((decision) => !existingIds.has(decision.id))
      if (pendingDecisions.length) {
        const { error: insertError } = await supabase.from('review_decisions').insert(pendingDecisions)
        if (insertError) throw insertError
      }
    }
  }
}

function requireUuid(value: string, kind: string) {
  if (!uuidPattern.test(value)) throw new Error(`This ${kind} has an unsupported identifier. Export a backup before replacing it.`)
  return value
}

function titleCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1) }
function toReviewerRole(role: string): ReviewerRole {
  return ({ creator: 'Creator', manager: 'Manager', brand_reviewer: 'Brand reviewer', legal_reviewer: 'Legal reviewer', admin: 'Admin' } as Record<string, ReviewerRole>)[role] ?? 'Creator'
}
function toRuleCategory(category: BrandRule['category']) {
  return ({ Terminology: 'terminology', 'Required language': 'required_language', Claims: 'claims', Tone: 'tone', Visual: 'visual', Accessibility: 'accessibility' } as const)[category]
}
function fromRuleCategory(category: string): BrandRule['category'] {
  return ({ terminology: 'Terminology', required_language: 'Required language', claims: 'Claims', tone: 'Tone', visual: 'Visual', accessibility: 'Accessibility' } as const)[category as 'terminology' | 'required_language' | 'claims' | 'tone' | 'visual' | 'accessibility'] ?? 'Terminology'
}
function toReviewStatus(status: string) {
  return ({ Draft: 'draft', 'Needs review': 'submitted', 'In review': 'in_review', 'Changes requested': 'changes_requested', Approved: 'approved', Waived: 'waived' } as Record<string, string>)[status] ?? 'draft'
}
function fromReviewStatus(status: string) {
  return ({ draft: 'Draft', submitted: 'Needs review', in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved', waived: 'Waived' } as Record<string, string>)[status] ?? 'Draft'
}
