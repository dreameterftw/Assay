import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { AssayData } from './storage'
import type { Review, BrandRule, ApprovedClaim, ReviewerRole, ReviewDecision } from './types'

export type WorkspaceMembership = { id: string; name: string; role: string }
export type WorkspaceMember = { userId: string; role: ReviewerRole }
export type CloudWorkspace = { id: string; name: string; role: string; currentUserId: string; memberships: WorkspaceMembership[]; members: WorkspaceMember[]; data: AssayData }

const emptyData = (): AssayData => ({ reviews: [], rules: [], claims: [] })
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function loadOrCreateWorkspace(user: User, selectedOrganizationId?: string | null): Promise<CloudWorkspace> {
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
  if (!org) {
    const { data: created, error } = await supabase.from('organizations')
      .insert({ name: 'My Organization', owner_id: user.id }).select('id, name').single()
    if (error) throw error
    org = created
    role = 'admin'
    selected = { id: created.id, name: created.name, role }
  }

  const [rulesResult, claimsResult, reviewsResult] = await Promise.all([
    supabase.from('brand_rules').select('*').eq('organization_id', org.id).order('created_at'),
    supabase.from('approved_claims').select('*').eq('organization_id', org.id).order('created_at'),
    supabase.from('reviews').select('*').eq('organization_id', org.id).order('created_at', { ascending: false }),
  ])
  if (rulesResult.error) throw rulesResult.error
  if (claimsResult.error) throw claimsResult.error
  if (reviewsResult.error) throw reviewsResult.error

  const reviewIds = (reviewsResult.data ?? []).map((row) => row.id)
  const assetsResult = reviewIds.length
    ? await supabase.from('review_assets').select('*').eq('organization_id', org.id).in('review_id', reviewIds).order('created_at')
    : { data: [], error: null }
  if (assetsResult.error) throw assetsResult.error
  const imagesByReview = new Map<string, NonNullable<Review['image']>>()
  const storage = supabase
  await Promise.all((assetsResult.data ?? []).map(async (asset) => {
    const { data: signed, error } = await storage.storage.from(asset.bucket_id).createSignedUrl(asset.object_path, 3600)
    if (error) throw error
    imagesByReview.set(asset.review_id, {
      assetId: asset.id, storagePath: asset.object_path, name: asset.filename,
      dataUrl: signed.signedUrl, width: asset.width, height: asset.height,
      altText: asset.alt_text, palette: Array.isArray(asset.palette) ? asset.palette : [],
    })
  }))
  const [findingsResult, commentsResult, eventsResult, revisionsResult, decisionsResult] = reviewIds.length ? await Promise.all([
    supabase.from('review_findings').select('*').in('review_id', reviewIds).order('created_at'),
    supabase.from('review_comments').select('*').in('review_id', reviewIds).order('created_at'),
    supabase.from('review_events').select('*').in('review_id', reviewIds).order('created_at', { ascending: false }),
    supabase.from('review_revisions').select('*').in('review_id', reviewIds).order('created_at', { ascending: false }),
    supabase.from('review_decisions').select('*').in('review_id', reviewIds).order('created_at', { ascending: false }),
  ]) : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
  if (findingsResult.error) throw findingsResult.error
  if (commentsResult.error) throw commentsResult.error
  if (eventsResult.error) throw eventsResult.error
  if (revisionsResult.error) throw revisionsResult.error
  if (decisionsResult.error) throw decisionsResult.error

  const roleResult = await supabase.from('organization_members').select('user_id,role').eq('organization_id', org.id)
  if (roleResult.error) throw roleResult.error
  const roleByUser = new Map<string, ReviewerRole>((roleResult.data ?? []).map((member) => [member.user_id, toReviewerRole(member.role)]))
  const members = (roleResult.data ?? []).map((member) => ({ userId: member.user_id, role: toReviewerRole(member.role) }))
  const rules = (rulesResult.data ?? []).map((row) => ({
    id: row.id, category: fromRuleCategory(row.category), label: row.title,
    description: row.description, source: row.source_label, status: row.status === 'approved' ? 'Approved' as const : 'Draft' as const,
    severity: titleCase(row.severity) as BrandRule['severity'], active: row.active, matchText: row.match_text,
  }))
  const claims = (claimsResult.data ?? []).map((row) => ({
    id: row.id, statement: row.statement, evidence: row.evidence_label, evidenceUrl: row.evidence_url ?? undefined, owner: row.owner_label,
    reviewDate: row.reviewed_at ?? '', expiryDate: row.expires_at ?? '', active: row.active,
  }))
  const findingsByReview = new Map<string, Review['findings']>()
  for (const row of findingsResult.data ?? []) {
    const citedRule = rules.find((rule) => rule.id === row.rule_id)
    const citedClaim = claims.find((claim) => claim.id === row.claim_id)
    const finding = {
      id: row.id,
      level: ({ violation: 'Needs review', likely: 'Watch', needs_human_judgement: 'Watch', cannot_verify: 'Watch' } as Record<string, 'Needs review' | 'Watch' | 'Clear'>)[row.state] ?? 'Watch',
      type: titleCase(row.category), title: row.title, excerpt: row.excerpt,
      source: citedRule?.label ?? citedClaim?.statement ?? 'Review evidence', note: row.explanation,
      sourceId: row.rule_id ?? row.claim_id ?? undefined, origin: row.source_kind === 'ai_judgment' ? 'ai' as const : 'deterministic' as const,
      confidence: row.confidence == null ? undefined : Number(row.confidence),
    }
    findingsByReview.set(row.review_id, [...(findingsByReview.get(row.review_id) ?? []), finding])
  }
  const commentsByReview = new Map<string, NonNullable<Review['comments']>>()
  for (const row of commentsResult.data ?? []) commentsByReview.set(row.review_id, [...(commentsByReview.get(row.review_id) ?? []), {
    id: row.id, author: row.author_id === user.id ? user.email ?? 'You' : 'Workspace member',
    role: roleByUser.get(row.author_id) ?? 'Creator', text: row.body, createdAt: row.created_at,
  }])
  const eventsByReview = new Map<string, NonNullable<Review['events']>>()
  for (const row of eventsResult.data ?? []) eventsByReview.set(row.review_id, [...(eventsByReview.get(row.review_id) ?? []), {
    id: row.id, actor: row.actor_id === user.id ? user.email ?? 'You' : 'Workspace member',
    role: roleByUser.get(row.actor_id) ?? 'Creator', action: row.action,
    detail: typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail), createdAt: row.created_at,
  }])
  const revisionsByReview = new Map<string, NonNullable<Review['revisions']>>()
  for (const row of revisionsResult.data ?? []) revisionsByReview.set(row.review_id, [...(revisionsByReview.get(row.review_id) ?? []), {
    id: row.id, content: row.content_snapshot, findings: [], createdAt: row.created_at,
    author: row.author_id === user.id ? user.email ?? 'You' : 'Workspace member', label: row.label,
  }])
  const decisionsByReview = new Map<string, NonNullable<Review['decisions']>>()
  for (const row of decisionsResult.data ?? []) decisionsByReview.set(row.review_id, [...(decisionsByReview.get(row.review_id) ?? []), {
    id: row.id, findingKey: row.finding_key, findingTitle: row.finding_title,
    action: row.action as ReviewDecision['action'], reason: row.reason,
    author: row.actor_id === user.id ? user.email ?? 'You' : 'Workspace member', createdAt: row.created_at,
  }])

  const data: AssayData = {
    rules,
    claims,
    reviews: (reviewsResult.data ?? []).map((row) => ({
      id: row.id, title: row.title, channel: row.channel, createdById: row.created_by,
      owner: row.created_by === user.id ? user.email ?? 'You' : 'Workspace member',
      initials: (row.created_by === user.id ? user.email ?? 'You' : 'W').slice(0, 2).toUpperCase(),
      time: new Date(row.created_at).toLocaleDateString(),
      status: fromReviewStatus(row.status), findings: findingsByReview.get(row.id) ?? [], content: row.content,
      image: imagesByReview.get(row.id),
      reviewer: row.assigned_reviewer ? `${roleByUser.get(row.assigned_reviewer) ?? 'Reviewer'} · ${row.assigned_reviewer.slice(0, 8)}` : undefined,
      riskTier: titleCase(row.risk_tier) as Review['riskTier'],
      assignedReviewerId: row.assigned_reviewer ?? undefined,
      ruleSetVersion: row.rule_set_version, ruleSnapshot: row.rule_snapshot,
      passportCreatedAt: ['approved','waived'].includes(row.status) ? row.updated_at : undefined,
      comments: commentsByReview.get(row.id) ?? [], events: eventsByReview.get(row.id) ?? [], revisions: revisionsByReview.get(row.id) ?? [],
      decisions: decisionsByReview.get(row.id) ?? [],
    })),
  }

  return { id: org.id, name: org.name, role, currentUserId: user.id, memberships: selected ? available.length ? available : [selected] : [], members, data }
}

// Writes are scoped to known IDs and update only fields that actually changed.
// Database triggers remain responsible for approval guards and audit history.
export async function saveWorkspaceData(organizationId: string, actorId: string, data: AssayData): Promise<void> {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (!uuidPattern.test(organizationId) || !uuidPattern.test(actorId)) throw new Error('Invalid workspace identity.')

  if (data.rules.length) {
    const ids = data.rules.map((rule) => requireUuid(rule.id, 'rule'))
    const { data: existing, error } = await supabase.from('brand_rules').select('*').eq('organization_id', organizationId).in('id', ids)
    if (error) throw error
    const byId = new Map((existing ?? []).map((row) => [row.id, row]))
    for (const rule of data.rules) {
      const id = requireUuid(rule.id, 'rule')
      const current = byId.get(id)
      const values = {
        rule_key: id, version: 1, match_text: rule.matchText?.trim() || '', category: toRuleCategory(rule.category),
        title: rule.label, description: rule.description, source_label: rule.source,
        severity: rule.severity.toLowerCase(), status: rule.status === 'Approved' ? 'approved' : 'draft', active: rule.active,
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
    const ids = data.claims.map((claim) => requireUuid(claim.id, 'claim'))
    const { data: existing, error } = await supabase.from('approved_claims').select('*').eq('organization_id', organizationId).in('id', ids)
    if (error) throw error
    const byId = new Map((existing ?? []).map((row) => [row.id, row]))
    for (const claim of data.claims) {
      const id = requireUuid(claim.id, 'claim')
      const current = byId.get(id)
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
    const ids = data.reviews.map((review) => requireUuid(review.id, 'review'))
    const { data: existing, error } = await supabase.from('reviews').select('*').eq('organization_id', organizationId).in('id', ids)
    if (error) throw error
    const byId = new Map((existing ?? []).map((row) => [row.id, row]))
    for (const review of data.reviews) {
      const id = requireUuid(review.id, 'review')
      const current = byId.get(id)
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
        continue
      }
      const values = { title: review.title, channel: review.channel, content: review.content, status, risk_tier: (review.riskTier ?? 'Standard').toLowerCase(), assigned_reviewer: review.assignedReviewerId ?? null }
      const update: Record<string, unknown> = {}
      for (const key of Object.keys(values) as (keyof typeof values)[]) {
        if (current[key] !== values[key]) update[key] = values[key]
      }
      if (Object.keys(update).length) {
        const { error: updateError } = await supabase.from('reviews').update(update).eq('organization_id', organizationId).eq('id', id)
        if (updateError) throw updateError
      }
    }

    const reviewIds = data.reviews.map((review) => review.id)
    const { data: existingComments, error: commentsError } = await supabase.from('review_comments').select('id').eq('organization_id', organizationId).in('review_id', reviewIds)
    if (commentsError) throw commentsError
    const commentIds = new Set((existingComments ?? []).map((comment) => comment.id))
    const newComments = data.reviews.flatMap((review) => (review.comments ?? [])
      .filter((comment) => uuidPattern.test(comment.id) && !commentIds.has(comment.id))
      .map((comment) => ({ id: comment.id, organization_id: organizationId, review_id: review.id, author_id: actorId, body: comment.text, anchor: comment.anchor ? { text: comment.anchor } : {} })))
    if (newComments.length) {
      const { error: insertError } = await supabase.from('review_comments').insert(newComments)
      if (insertError) throw insertError
    }

    const { data: existingDecisions, error: decisionsError } = await supabase.from('review_decisions').select('id').eq('organization_id', organizationId).in('review_id', reviewIds)
    if (decisionsError) throw decisionsError
    const decisionIds = new Set((existingDecisions ?? []).map((decision) => decision.id))
    const newDecisions = data.reviews.flatMap((review) => (review.decisions ?? [])
      .filter((decision) => uuidPattern.test(decision.id) && !decisionIds.has(decision.id))
      .map((decision) => ({
        id: decision.id, organization_id: organizationId, review_id: review.id,
        finding_key: decision.findingKey, finding_title: decision.findingTitle,
        action: decision.action, reason: decision.reason, actor_id: actorId,
      })))
    if (newDecisions.length) {
      const { error: insertError } = await supabase.from('review_decisions').insert(newDecisions)
      if (insertError) throw insertError
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
