import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BookOpen,
  Check, CheckCheck, ChevronDown, CircleHelp, Clock3, FileCheck2,
  FileText, Filter, Globe2, LayoutDashboard, MoreHorizontal, Plus,
  Search, Settings2, ShieldCheck, Sparkles, Users2, WandSparkles, MessageSquare, History, Download, Send, FileClock, Route, ImagePlus, X, Compass, ExternalLink,
} from 'lucide-react'
import { clearLegacyWorkspaceMirror, type AssayData } from './storage'
import { findingKey, runDeterministicChecks } from './checks'
import { validateSuggestion } from './aiReview'
import type { Review, BrandRule, ApprovedClaim, Finding, ReviewerRole, ReviewRevision, ReviewDecision } from './types'
import { checkImageMetadata, inspectImage } from './imageChecks'
import { DEFAULT_BRAND_PALETTE } from './lib/checks-core'
import { buildRadar } from './insights'
import { supabase } from './supabase'
import { createWorkspace, loadMoreReviews, loadOrCreateWorkspace, loadReviewImage, saveWorkspaceData, type CloudWorkspace, type ReviewCursor } from './cloudWorkspace'
import type { Session } from '@supabase/supabase-js'

const brandPalette = DEFAULT_BRAND_PALETTE

function applyFindingDecisions(findings: Finding[], decisions: ReviewDecision[] = []): Finding[] {
  const latest = new Map<string, ReviewDecision['action']>()
  for (const decision of [...decisions].reverse()) latest.set(decision.findingKey, decision.action)
  return findings.map((finding) => ({ ...finding, decision: latest.get(findingKey(finding)) }))
}

function imageFindingSourceId(findingKeyValue: string): string | undefined {
  try {
    const keyParts = JSON.parse(findingKeyValue) as unknown
    return Array.isArray(keyParts) && typeof keyParts[0] === 'string' ? keyParts[0] : undefined
  } catch (error) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

const navSections = [
  { label: 'WORKSPACE', items: [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Reviews', icon: FileCheck2 }, { name: 'Brand Brain', icon: BookOpen }, { name: 'Governance Radar', icon: Activity }] },
]

type WorkspaceAppProps = { initialData: AssayData; workspace: CloudWorkspace; userEmail: string; accessToken: string; syncStatus: 'saved' | 'saving' | 'error'; onDataChange: (data: AssayData) => Promise<void>; onSignOut: () => void; onSwitchWorkspace: (organizationId: string) => void }

function WorkspaceApp({ initialData, workspace, userEmail, accessToken, syncStatus, onDataChange, onSignOut, onSwitchWorkspace }: WorkspaceAppProps) {
  const canManageBrandBrain = ['admin', 'brand_reviewer'].includes(workspace.role)
  const canManageClaims = ['admin', 'brand_reviewer', 'legal_reviewer'].includes(workspace.role)
  const [reviews, setReviews] = useState<Review[]>(() => initialData.reviews.map((review) => ({
    ...review, findings: applyFindingDecisions(review.findings, review.decisions),
    intent: review.intent || 'Keep the message warm, clear, and optimistic.',
  })))
  const [hasMoreReviews, setHasMoreReviews] = useState(workspace.hasMoreReviews)
  const [loadingMoreReviews, setLoadingMoreReviews] = useState(false)
  const [reviewCursor, setReviewCursor] = useState<ReviewCursor | undefined>(workspace.reviewCursor)
  const [rules, setRules] = useState(initialData.rules)
  const [claims, setClaims] = useState(initialData.claims)
  const [activeId, setActiveId] = useState(initialData.reviews[0]?.id ?? '')
  const [activeNav, setActiveNav] = useState('Reviews')
  const [filter, setFilter] = useState('All reviews')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState('')
  const [showRuleForm, setShowRuleForm] = useState(false)
  const [ruleText, setRuleText] = useState('')
  const [showClaimForm, setShowClaimForm] = useState(false)
  const [claimText, setClaimText] = useState('')
  const [claimEvidence, setClaimEvidence] = useState('')
  const [claimEvidenceUrl, setClaimEvidenceUrl] = useState('')
  const [claimExpiry, setClaimExpiry] = useState('')
  const [intent, setIntent] = useState('Keep the message warm, clear, and optimistic.')
  const [suggestionChecks, setSuggestionChecks] = useState<Finding[]>([])
  const [reviewerRole] = useState<ReviewerRole>(workspace.role === 'creator' ? 'Creator' : workspace.role === 'manager' ? 'Manager' : workspace.role === 'legal_reviewer' ? 'Legal reviewer' : workspace.role === 'brand_reviewer' ? 'Brand reviewer' : 'Admin')
  const canReviewWorkflow = ['admin', 'manager', 'brand_reviewer', 'legal_reviewer'].includes(workspace.role)
  const [assignedMemberId, setAssignedMemberId] = useState('')
  const [commentText, setCommentText] = useState('')
  const [commentVisibility, setCommentVisibility] = useState<'shared' | 'internal'>('shared')
  const [passportOpen, setPassportOpen] = useState(false)
  const [revisionOpen, setRevisionOpen] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [runBusy, setRunBusy] = useState(false)
  const [activeContentSha256, setActiveContentSha256] = useState('')
  const [regressionText, setRegressionText] = useState('')
  const [regressionResults, setRegressionResults] = useState<{ reviewId: string; title: string; added: Finding[] }[] | null>(null)
  const [backupInput, setBackupInput] = useState<HTMLInputElement | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'creator' | 'manager' | 'brand_reviewer' | 'legal_reviewer'>('creator')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviteError, setInviteError] = useState('')
  const [pendingInvites, setPendingInvites] = useState<Array<{ id: string; email: string; role: string; expires_at: string; created_at: string }>>([])
  const [now] = useState(() => new Date())
  const active = reviews.find((review) => review.id === activeId) ?? reviews[0] ?? { id: '', title: '', channel: '', owner: userEmail, initials: userEmail.slice(0, 2).toUpperCase(), time: '', status: 'Draft', findings: [], content: '' }
  const activeHighRisk = active.riskTier === 'High' || active.findings.some((finding) => finding.level === 'Needs review' || /CLAIM|DISCLOSURE/.test(finding.type))
  const hasCurrentRun = Boolean(activeContentSha256
    && active.latestRunContentSha256 === activeContentSha256
    && active.latestRunIsCurrent)
  const hasValidApprovalRun = Boolean(active.latestRunIsCurrent && active.latestRunValidUntil
    && Date.parse(active.latestRunValidUntil) > Date.now())
  const canInviteMembers = ['admin', 'manager'].includes(workspace.role)
  const inviteRoleOptions = workspace.role === 'admin'
    ? [{ value: 'creator', label: 'Creator' }, { value: 'manager', label: 'Manager' }, { value: 'brand_reviewer', label: 'Brand reviewer' }, { value: 'legal_reviewer', label: 'Legal reviewer' }]
    : [{ value: 'creator', label: 'Creator' }]
  const eligibleReviewers = workspace.members.filter((member) => member.userId !== workspace.currentUserId && member.role !== 'Creator' && (!activeHighRisk || ['Legal reviewer', 'Admin'].includes(member.role)))
  const canApproveActive = canReviewWorkflow && active.createdById !== workspace.currentUserId
    && ['Needs review', 'In review'].includes(active.status)
    && hasValidApprovalRun
    && (!activeHighRisk || ['legal_reviewer', 'admin'].includes(workspace.role))
    && active.findings.every((finding) => finding.level === 'Clear' || Boolean(finding.decision))
  const canWaiveActive = canReviewWorkflow && active.createdById !== workspace.currentUserId
    && ['Needs review', 'In review'].includes(active.status)
    && hasValidApprovalRun
    && (!activeHighRisk || ['legal_reviewer', 'admin'].includes(workspace.role))
  useEffect(() => { setAssignedMemberId(active.assignedReviewerId ?? '') }, [active.id, active.assignedReviewerId])
  useEffect(() => {
    let activeEffect = true
    const bytes = new TextEncoder().encode(active.content)
    window.crypto.subtle.digest('SHA-256', bytes).then((digest) => {
      if (!activeEffect) return
      setActiveContentSha256(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''))
    }).catch((error: unknown) => {
      console.error('Could not hash review content', error)
      if (activeEffect) setActiveContentSha256('')
    })
    return () => { activeEffect = false }
  }, [active.id, active.content])
  const today = now.toISOString().slice(0, 10)
  const radar = useMemo(() => buildRadar(reviews), [reviews])
  const visibleReviews = useMemo(() => reviews.filter((review) => {
    const matchesSearch = `${review.title} ${review.owner} ${review.channel}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === 'All reviews' || (filter === 'Needs review' ? review.status === 'Needs review' : review.status === filter)
    return matchesSearch && matchesFilter
  }), [reviews, filter, query])

  async function persist(nextReviews = reviews, nextRules = rules, nextClaims = claims): Promise<boolean> {
    const changed = <T extends { id: string }>(before: T[], after: T[], fields: (keyof T)[]) => after.filter((item) => {
      const previous = before.find((record) => record.id === item.id)
      return !previous || fields.some((field) => previous[field] !== item[field])
    })
    const changedReviews = changed(reviews, nextReviews, ['title', 'channel', 'content', 'status', 'riskTier', 'assignedReviewerId', 'comments', 'decisions'])
    const reviewIdsWithFindings = new Set(changedReviews.map((review) => review.id))
    for (const review of nextReviews) {
      const previous = reviews.find((item) => item.id === review.id)
      if ((!previous || previous.findings !== review.findings) && !reviewIdsWithFindings.has(review.id)) changedReviews.push(review)
    }
    const data: AssayData = {
      reviews: changedReviews,
      rules: changed(rules, nextRules, ['category', 'label', 'description', 'source', 'status', 'severity', 'active', 'matchText']),
      claims: changed(claims, nextClaims, ['statement', 'evidence', 'evidenceUrl', 'owner', 'reviewDate', 'expiryDate', 'active']),
    }
    try {
      await onDataChange(data)
      return true
    } catch {
      setNotice('Save failed. Check your connection, then refresh before continuing.')
      return false
    }
  }

  async function refreshReviewHistory(reviewId: string): Promise<boolean> {
    if (!supabase) return false
    const [reviewResult, findingsResult, commentsResult, eventsResult, revisionsResult, decisionsResult, runsResult, currentRunResult] = await Promise.all([
      supabase.from('reviews').select('approved_run_id').eq('organization_id', workspace.id).eq('id', reviewId).maybeSingle(),
      supabase.from('review_findings').select('*').eq('organization_id', workspace.id).eq('review_id', reviewId).order('created_at'),
      supabase.from('review_comments').select('*').eq('organization_id', workspace.id).eq('review_id', reviewId).order('created_at'),
      supabase.from('review_events').select('*').eq('organization_id', workspace.id).eq('review_id', reviewId).order('created_at', { ascending: false }),
      supabase.from('review_revisions').select('*').eq('organization_id', workspace.id).eq('review_id', reviewId).order('created_at', { ascending: false }),
      supabase.from('review_decisions').select('*').eq('organization_id', workspace.id).eq('review_id', reviewId).order('created_at', { ascending: false }),
      supabase.from('review_runs').select('content_sha256,valid_until').eq('organization_id', workspace.id).eq('review_id', reviewId).order('created_at', { ascending: false }).limit(1),
      supabase.rpc('assay_review_has_current_run', { target_review: reviewId }),
    ])
    const approvedRunId = reviewResult.data?.approved_run_id as string | null | undefined
    const approvedRunResult = approvedRunId
      ? await supabase.from('review_runs')
        .select('id,content_sha256,rules_sha256,claims_sha256,asset_snapshot,rule_snapshot,claim_snapshot,valid_until')
        .eq('organization_id', workspace.id).eq('review_id', reviewId).eq('id', approvedRunId).maybeSingle()
      : { data: null, error: null }
    const queryError = [reviewResult.error, findingsResult.error, commentsResult.error, eventsResult.error, revisionsResult.error, decisionsResult.error, runsResult.error, currentRunResult.error, approvedRunResult.error].find(Boolean)
    if (queryError) {
      console.error('Could not refresh review details:', queryError)
      setNotice('Could not refresh this review. Try again.')
      return false
    }
    const memberFor = (id: string) => workspace.members.find((member) => member.userId === id)
    const decisions: ReviewDecision[] = (decisionsResult.data ?? []).map((row) => ({
      id: row.id, findingKey: row.finding_key, findingTitle: row.finding_title,
      action: row.action as ReviewDecision['action'], reason: row.reason,
      author: row.actor_id === workspace.currentUserId ? userEmail : memberFor(row.actor_id)?.displayName ?? 'Workspace member', createdAt: row.created_at,
    }))
    const decisionByKey = new Map<string, ReviewDecision['action']>()
    for (const decision of [...decisions].reverse()) decisionByKey.set(decision.findingKey, decision.action)
    const findings = (findingsResult.data ?? []).map((row): Finding => {
      const rule = rules.find((item) => item.id === row.rule_id)
      const claim = claims.find((item) => item.id === row.claim_id)
      return {
        id: row.finding_key,
        level: row.state === 'violation' ? 'Needs review' : 'Watch',
        type: `${row.category.replace(/_/g, ' ').toUpperCase()} · ${row.severity.toUpperCase()}`,
        title: row.title, excerpt: row.excerpt,
        source: rule ? `${rule.id} · ${rule.label}` : claim ? `${claim.id} · ${claim.evidence}` : 'Review evidence',
        note: row.explanation,
        sourceId: row.rule_id ?? row.claim_id ?? (row.source_kind === 'image_check' ? imageFindingSourceId(row.finding_key) : undefined),
        origin: row.source_kind === 'ai_judgment' ? 'ai' : row.source_kind === 'image_check' ? 'image' : 'deterministic',
        confidence: row.confidence == null ? undefined : Number(row.confidence),
      }
    })
    setReviews((current) => current.map((review) => review.id !== reviewId ? review : ({
      ...review,
      comments: (commentsResult.data ?? []).map((row) => ({
        id: row.id, author: row.author_id === workspace.currentUserId ? userEmail : memberFor(row.author_id)?.displayName ?? 'Workspace member',
        role: memberFor(row.author_id)?.role ?? 'Creator', text: row.body, createdAt: row.created_at, visibility: row.visibility,
      })),
      events: (eventsResult.data ?? []).map((row) => ({
        id: row.id, actor: row.actor_id === workspace.currentUserId ? userEmail : memberFor(row.actor_id)?.displayName ?? 'Workspace member',
        role: memberFor(row.actor_id)?.role ?? 'Creator', action: row.action,
        detail: typeof row.detail === 'string' ? row.detail : JSON.stringify(row.detail), createdAt: row.created_at,
      })),
      revisions: (revisionsResult.data ?? []).map((row) => ({
        id: row.id, content: row.content_snapshot, findings: [], createdAt: row.created_at,
        author: row.author_id === workspace.currentUserId ? userEmail : memberFor(row.author_id)?.displayName ?? 'Workspace member', label: row.label,
      })),
      decisions,
      findings: findings.map((finding) => ({ ...finding, decision: decisionByKey.get(findingKey(finding)) })),
      approvedRunId: approvedRunId ?? undefined,
      approvedRun: approvedRunResult.data ? {
        id: approvedRunResult.data.id,
        contentSha256: approvedRunResult.data.content_sha256,
        rulesSha256: approvedRunResult.data.rules_sha256,
        claimsSha256: approvedRunResult.data.claims_sha256,
        assetSnapshot: approvedRunResult.data.asset_snapshot,
        ruleSnapshot: approvedRunResult.data.rule_snapshot,
        claimSnapshot: approvedRunResult.data.claim_snapshot,
        validUntil: approvedRunResult.data.valid_until,
      } : undefined,
      latestRunContentSha256: runsResult.data?.[0]?.content_sha256,
      latestRunValidUntil: runsResult.data?.[0]?.valid_until,
      latestRunIsCurrent: currentRunResult.data === true,
    })))
    return true
  }

  useEffect(() => {
    if (!active.id) return
    let activeEffect = true
    void refreshReviewHistory(active.id)
    void loadReviewImage(workspace.id, active.id).then((image) => {
      if (!activeEffect || !image) return
      setReviews((current) => current.map((review) => review.id === active.id ? { ...review, image } : review))
    }).catch((error: unknown) => {
      console.error('Could not load review image:', error)
      if (activeEffect) setNotice("Could not load this review's image.")
    })
    return () => { activeEffect = false }
  }, [active.id, workspace.id])

  useEffect(() => {
    const client = supabase
    if (!client || !workspace) return
    let alive = true
    const loadPendingInvites = async () => {
      const { data, error } = await client.from('workspace_invitations')
        .select('id, email, role, expires_at, created_at')
        .eq('organization_id', workspace.id)
        .is('accepted_at', null)
        .order('created_at', { ascending: false })
      if (!alive) return
      if (error) {
        setInviteError(error.message)
        return
      }
      setPendingInvites((data ?? []) as Array<{ id: string; email: string; role: string; expires_at: string; created_at: string }>)
    }
    void loadPendingInvites()
    return () => { alive = false }
  }, [supabase, workspace?.id])

  async function createMemberInvite() {
    const client = supabase
    if (!client || !workspace || !canInviteMembers) return
    const email = inviteEmail.trim().toLowerCase()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setInviteError('Enter a valid email address.')
      return
    }
    setInviteBusy(true)
    setInviteError('')
    setInviteMessage('')
    try {
      const response = await fetch('/api/create-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ organizationId: workspace.id, email, role: inviteRole }),
      })
      const payload = await response.json().catch(() => ({})) as { error?: string; status?: string }
      if (!response.ok) throw new Error(payload.error || 'Invitation could not be created.')
      setInviteEmail('')
      setInviteRole('creator')
      setInviteMessage('Invitation email sent.')
      const { data, error } = await client.from('workspace_invitations')
        .select('id, email, role, expires_at, created_at')
        .eq('organization_id', workspace.id)
        .is('accepted_at', null)
        .order('created_at', { ascending: false })
      if (!error) setPendingInvites((data ?? []) as Array<{ id: string; email: string; role: string; expires_at: string; created_at: string }>)
    } catch (caught) {
      setInviteError(caught instanceof Error ? caught.message : 'Invitation could not be created.')
    } finally {
      setInviteBusy(false)
    }
  }

  async function revokeInvite(inviteId: string) {
    if (!supabase || !workspace) return
    try {
      const { error } = await supabase.from('workspace_invitations').delete().eq('id', inviteId).eq('organization_id', workspace.id)
      if (error) throw error
      setPendingInvites((current) => current.filter((invitation) => invitation.id !== inviteId))
      setInviteMessage('Invitation revoked.')
    } catch (caught) {
      setInviteError(caught instanceof Error ? caught.message : 'Invitation could not be revoked.')
    }
  }

  function updateReview(reviewId: string, updater: (review: Review) => Review) {
    setReviews((current) => {
      const next = current.map((review) => review.id === reviewId ? updater(review) : review)
      void persist(next)
      return next
    })
  }

  function refreshReview(review: Review, nextRules = rules, nextClaims = claims) {
    void review
    void persist(reviews, nextRules, nextClaims)
  }

  function recordRevision(review: Review, label: string): ReviewRevision {
    return { id: `rev-${Date.now()}`, content: review.content, findings: review.findings, createdAt: new Date().toISOString(), author: userEmail, label }
  }

  async function updateFinding(reviewId: string, findingId: string, action: ReviewDecision['action'], reason = '') {
    const review = reviews.find((item) => item.id === reviewId)
    const finding = review?.findings.find((item) => item.id === findingId)
    if (!review || !finding) return
    const decision: ReviewDecision = { id: crypto.randomUUID(), findingKey: findingKey(finding), findingTitle: finding.title, action, reason, author: userEmail, createdAt: new Date().toISOString() }
    const next = reviews.map((item) => item.id === reviewId ? {
      ...item,
      findings: item.findings.map((entry) => entry.id === findingId ? { ...entry, decision: action } : entry),
      decisions: [decision, ...(item.decisions ?? [])],
    } : item)
    setReviews(next)
    if (!await persist(next)) { setReviews(reviews); return }
    await refreshReviewHistory(reviewId)
    setNotice(action === 'dismissed' ? 'Finding dismissed with a reason.' : `Finding marked ${action}.`)
    window.setTimeout(() => setNotice(''), 2600)
  }

  async function approveReview() {
    if (!hasValidApprovalRun) {
      setNotice('Run the check again before approval; the run is stale or its claim evidence has expired.')
      return
    }
    if (!canApproveActive) { setNotice('This review needs another authorized reviewer or a completed decision set.'); return }
    if (active.findings.some((finding) => finding.level !== 'Clear' && !finding.decision)) {
      setNotice('Resolve or dismiss the open findings before approval.')
      window.setTimeout(() => setNotice(''), 3000)
      return
    }
    const next = reviews.map((review) => review.id === active.id ? { ...review, status: 'Approved', passportCreatedAt: new Date().toISOString() } : review)
    setReviews(next)
    if (!await persist(next)) { setReviews(reviews); return }
    await refreshReviewHistory(active.id)
    setNotice(`${active.title} approved. Review passport created.`)
    window.setTimeout(() => setNotice(''), 3200)
  }

  async function waiveReview() {
    if (!hasValidApprovalRun) {
      setNotice('Run the check again before waiving; the run is stale or its claim evidence has expired.')
      return
    }
    if (!canWaiveActive) { setNotice('A different authorized reviewer must waive this review.'); return }
    const reason = window.prompt('Why is this review being waived?')
    if (!reason?.trim()) return
    const expiresAt = window.prompt('Waiver expiry date (YYYY-MM-DD)')
    const parsedExpiry = expiresAt ? new Date(`${expiresAt}T00:00:00Z`) : null
    if (!expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt) || !parsedExpiry || Number.isNaN(parsedExpiry.getTime()) || parsedExpiry.toISOString().slice(0, 10) !== expiresAt) {
      setNotice('Enter a valid waiver expiry date.')
      return
    }
    const next = reviews.map((review) => review.id === active.id ? {
      ...review, status: 'Waived', waiverReason: reason.trim(), waiverExpiresAt: expiresAt,
      passportCreatedAt: new Date().toISOString(),
    } : review)
    setReviews(next)
    if (!await persist(next)) { setReviews(reviews); return }
    await refreshReviewHistory(active.id)
    setNotice('Review waived with an expiry date.')
    window.setTimeout(() => setNotice(''), 3000)
  }

  async function submitReview() {
    if (!draft.trim()) return
    const nextId = crypto.randomUUID()
    const newReview: Review = {
      id: nextId, title: 'New content submission', channel: 'Social · Draft', owner: userEmail, createdById: workspace.currentUserId, initials: userEmail.slice(0, 2).toUpperCase(), time: 'Just now', status: 'Draft', reviewer: undefined, riskTier: 'Standard', comments: [], events: [], revisions: [], decisions: [],
      content: draft.trim(),
      findings: [],
    }
    const next = [newReview, ...reviews]
    setReviews(next)
    if (!await persist(next)) { setReviews(reviews); return }
    setActiveId(newReview.id)
    setDraft('')
    setNotice('Draft saved. Run the check on the latest content before submitting.')
    window.setTimeout(() => setNotice(''), 2600)
  }

  async function loadMore() {
    if (loadingMoreReviews || !hasMoreReviews) return
    setLoadingMoreReviews(true)
    try {
      const page = await loadMoreReviews(workspace.id, reviewCursor, { id: workspace.currentUserId, email: userEmail }, workspace.members)
      setReviews((current) => [...current, ...page.reviews])
      setHasMoreReviews(page.hasMore)
      setReviewCursor(page.cursor)
    } catch (error) {
      console.error('Could not load additional reviews:', error)
      setNotice('Could not load more reviews. Try again.')
    } finally {
      setLoadingMoreReviews(false)
    }
  }

  async function runActiveCheck() {
    if (!supabase || runBusy || !active.id) return
    setRunBusy(true)
    try {
      const response = await fetch('/api/run-review', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: active.id }),
      })
      let result: { error?: string; finding_count?: number }
      try {
        result = await response.json() as { error?: string; finding_count?: number }
      } catch {
        throw new Error('Review check could not be completed.')
      }
      if (!response.ok) throw new Error(result.error || 'Review check could not be completed.')
      if (!await refreshReviewHistory(active.id)) throw new Error('Check completed, but its results could not be refreshed.')
      setNotice(result.finding_count ? `${result.finding_count} finding${result.finding_count === 1 ? '' : 's'} saved.` : 'No deterministic issues found.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Review check could not be completed.')
    } finally {
      setRunBusy(false)
      window.setTimeout(() => setNotice(''), 3500)
    }
  }

  async function submitForReview() {
    if (!hasCurrentRun) {
      setNotice('Run the check on the latest content first.')
      window.setTimeout(() => setNotice(''), 3000)
      return
    }
    const next = reviews.map((review) => review.id === active.id ? { ...review, status: 'Needs review' } : review)
    setReviews(next)
    if (!await persist(next)) { setReviews(reviews); return }
    await refreshReviewHistory(active.id)
    setNotice('Review submitted.')
    window.setTimeout(() => setNotice(''), 2600)
  }

  function addRule() {
    if (!canManageBrandBrain || !ruleText.trim()) return
    const rule: BrandRule = { id: crypto.randomUUID(), category: 'Terminology', label: ruleText.trim(), description: ruleText.trim(), source: `Workspace rule · Added by ${userEmail}`, status: 'Draft', severity: 'Medium', active: true, matchText: ruleText.trim() }
    const next = [...rules, rule]
    setRules(next)
    setRuleText('')
    setShowRuleForm(false)
    persist(reviews, next, claims)
  }

  function previewRuleRegression() {
    const candidate: BrandRule = { id: 'PREVIEW-RULE', category: 'Terminology', label: `Preview: ${regressionText.trim()}`, description: 'Temporary match-text rule preview.', source: 'Local regression preview', status: 'Approved', severity: 'Medium', active: true, matchText: regressionText.trim() }
    const results = reviews.map((review) => {
      const before = runDeterministicChecks(review.content, rules, claims, today)
      const after = runDeterministicChecks(review.content, [...rules, candidate], claims, today)
      const existing = new Set(before.filter((item) => item.level !== 'Clear').map((item) => `${item.sourceId}|${item.title}|${item.excerpt}`))
      return { reviewId: review.id, title: review.title, added: after.filter((item) => item.sourceId === candidate.id && !existing.has(`${item.sourceId}|${item.title}|${item.excerpt}`)) }
    }).filter((item) => item.added.length > 0)
    setRegressionResults(results)
  }

  function addClaim() {
    if (!canManageClaims || !claimText.trim() || !claimEvidence.trim() || !claimExpiry) return
    const evidenceUrl = claimEvidenceUrl.trim()
    if (evidenceUrl && !/^https?:\/\//i.test(evidenceUrl)) { setNotice('Evidence links must use http:// or https://.'); return }
    const claim: ApprovedClaim = { id: crypto.randomUUID(), statement: claimText.trim(), evidence: claimEvidence.trim(), evidenceUrl: evidenceUrl || undefined, owner: userEmail, reviewDate: today, expiryDate: claimExpiry, active: true }
    const next = [...claims, claim]
    setClaims(next)
    setClaimText('')
    setClaimEvidence('')
    setClaimEvidenceUrl('')
    setClaimExpiry('')
    setShowClaimForm(false)
    persist(reviews, rules, next)
  }

  function toggleRule(ruleId: string) {
    if (!canManageBrandBrain) return
    const next = rules.map((rule) => rule.id === ruleId ? { ...rule, active: !rule.active } : rule)
    setRules(next)
    refreshReview(active, next, claims)
  }

  function approveRule(ruleId: string) {
    if (!canManageBrandBrain) return
    if (!supabase) return
    const rule = rules.find((item) => item.id === ruleId)
    if (!rule) return
    void (async () => {
      try {
        const { data, error } = await supabase.rpc('assay_publish_rule_version', {
          target_org: workspace.id,
          target_rule_key: rule.ruleKey ?? rule.id,
          target_category: rule.category.toLowerCase().replace(/ /g, '_'),
          target_title: rule.label,
          target_description: rule.description,
          target_source_label: rule.source,
          target_severity: rule.severity.toLowerCase(),
          target_match_text: rule.matchText ?? '',
        })
        if (error) throw error
        const published: BrandRule = { ...rule, id: data, version: (rule.version ?? 0) + 1, status: 'Approved' }
        setRules((current) => [...current, published])
        setNotice('A new approved rule version was published.')
        window.setTimeout(() => setNotice(''), 2600)
      } catch (error) {
      console.error('Rule version publish failed', error)
      setNotice('Could not publish the rule version. Please refresh and try again.')
      }
    })()
  }

  function toggleClaim(claimId: string) {
    if (!canManageClaims) return
    const next = claims.map((claim) => claim.id === claimId ? { ...claim, active: !claim.active } : claim)
    setClaims(next)
    refreshReview(active, rules, next)
  }

  function previewSuggestion(suggestion: string) {
    const findings = validateSuggestion(suggestion, rules, claims, today).findings
    setSuggestionChecks(findings)
    setNotice(findings.length ? 'This edit still triggers deterministic checks. Review the results before accepting.' : 'No deterministic issues found in this edit. This does not certify tone or factual accuracy.')
    window.setTimeout(() => setNotice(''), 3500)
  }

  function acceptSuggestion(suggestion: string) {
    const revision: ReviewRevision = { id: `rev-${Date.now()}`, content: active.content, findings: active.findings, createdAt: new Date().toISOString(), author: userEmail, label: 'Before suggested edit' }
    const nextReview = { ...active, content: suggestion, findings: applyFindingDecisions([...runDeterministicChecks(suggestion, rules, claims, today), ...(active.image ? checkImageMetadata(active.image, brandPalette) : []), ...active.findings.filter((finding) => finding.origin === 'ai')], active.decisions), revisions: [revision, ...(active.revisions ?? [])] }
    const nextReviews = reviews.map((review) => review.id === active.id ? nextReview : review)
    setReviews(nextReviews)
    persist(nextReviews)
    setSuggestionChecks([])
    setNotice('Suggestion applied and deterministic checks rerun.')
    window.setTimeout(() => setNotice(''), 3000)
  }

  async function attachImage(file?: File) {
    if (!file) return
    if (!supabase || !active.id || active.image) return
    setImageBusy(true)
    const assetId = crypto.randomUUID()
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : ''
    const objectPath = `${workspace.id}/${active.id}/${workspace.currentUserId}/${assetId}.${extension}`
    let metadataCreated = false
    let objectUploaded = false
    try {
      if (!extension) throw new Error('Choose a PNG, JPEG, or WebP image.')
      const inspected = await inspectImage(file)
      const { error: metadataError } = await supabase.from('review_assets').insert({
        id: assetId, organization_id: workspace.id, review_id: active.id,
        bucket_id: 'assay-review-assets', object_path: objectPath, filename: file.name,
        mime_type: file.type, size_bytes: file.size, width: inspected.width, height: inspected.height,
        alt_text: inspected.altText, palette: inspected.palette, uploaded_by: workspace.currentUserId,
      })
      if (metadataError) throw metadataError
      metadataCreated = true
      const { error: uploadError } = await supabase.storage.from('assay-review-assets').upload(objectPath, file, { contentType: file.type, upsert: false })
      if (uploadError) throw uploadError
      objectUploaded = true
      const { data: signed, error: signedError } = await supabase.storage.from('assay-review-assets').createSignedUrl(objectPath, 300)
      if (signedError) throw signedError
      const image: NonNullable<Review['image']> = { ...inspected, assetId, storagePath: objectPath, dataUrl: signed.signedUrl }
      const findings = [...active.findings.filter((finding) => finding.origin !== 'image'), ...checkImageMetadata(image, brandPalette)]
      setReviews(reviews.map((review) => review.id === active.id ? { ...review, image, findings } : review))
      await refreshReviewHistory(active.id)
      setNotice('Image uploaded to private workspace storage.')
    } catch (error) {
      let cleanupFailed = false
      if (objectUploaded) {
        const { error: cleanupError } = await supabase.storage.from('assay-review-assets').remove([objectPath])
        if (cleanupError) {
          cleanupFailed = true
          console.error('Could not clean up failed image upload:', cleanupError)
        } else {
          objectUploaded = false
        }
      }
      if (metadataCreated && !objectUploaded) {
        const { error: cleanupError } = await supabase.from('review_assets').delete().eq('organization_id', workspace.id).eq('id', assetId)
        if (cleanupError) {
          cleanupFailed = true
          console.error('Could not clean up failed image metadata:', cleanupError)
        }
      }
      const message = typeof error === 'object' && error !== null && 'code' in error && error.code === '54000'
        ? 'A review can have at most 10 image assets.'
        : error instanceof Error ? error.message : 'Image upload failed. Try again.'
      setNotice(cleanupFailed ? `${message} Cleanup was incomplete; contact your workspace administrator.` : message)
    } finally {
      setImageBusy(false)
      window.setTimeout(() => setNotice(''), 4000)
    }
  }

  async function updateImageAlt(altText: string) {
    if (!active.image?.assetId || !supabase) return
    const { error } = await supabase.from('review_assets').update({ alt_text: altText }).eq('organization_id', workspace.id).eq('id', active.image.assetId)
    if (error) { setNotice(`Could not save alt text: ${error.message}`); return }
    const image = { ...active.image, altText }
    const imageFindings = checkImageMetadata(image, brandPalette)
    const nextReview = { ...active, image, findings: [...active.findings.filter((finding) => finding.origin !== 'image'), ...imageFindings] }
    const nextReviews = reviews.map((review) => review.id === active.id ? nextReview : review)
    setReviews(nextReviews)
    await refreshReviewHistory(active.id)
  }

  async function removeImage() {
    if (!active.image?.assetId || !active.image.storagePath || !supabase) return
    if (['Approved', 'Waived', 'Archived'].includes(active.status)) {
      setNotice('Images on finalized reviews are retained with the audit record.')
      window.setTimeout(() => setNotice(''), 3500)
      return
    }
    setImageBusy(true)
    try {
      const { error: storageError } = await supabase.storage.from('assay-review-assets').remove([active.image.storagePath])
      if (storageError) throw storageError
      const { error: metadataError } = await supabase.from('review_assets').delete().eq('organization_id', workspace.id).eq('id', active.image.assetId)
      if (metadataError) throw metadataError
      setReviews(reviews.map((review) => review.id === active.id
        ? { ...review, image: undefined, findings: review.findings.filter((finding) => finding.origin !== 'image') }
        : review))
      await refreshReviewHistory(active.id)
      setNotice('Image removed from the review.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not remove the image.')
    } finally {
      setImageBusy(false)
      window.setTimeout(() => setNotice(''), 3500)
    }
  }

  async function routeForReview() {
    if (!canReviewWorkflow) return
    if (!['Needs review', 'In review'].includes(active.status)) { setNotice('Submit the review before routing it.'); return }
    const highRisk = activeHighRisk
    const member = workspace.members.find((item) => item.userId === assignedMemberId)
    if (!member) { setNotice('Choose an organization reviewer first.'); return }
    if (highRisk && !['Legal reviewer', 'Admin'].includes(member.role)) { setNotice('High-risk reviews must be assigned to legal or an admin.'); return }
    const next = reviews.map((review) => review.id === active.id ? { ...review, reviewer: `${member.displayName} · ${member.role}`, assignedReviewerId: member.userId, riskTier: highRisk ? 'High' as const : 'Low' as const, status: 'In review' } : review)
    setReviews(next)
    if (!await persist(next)) { setReviews(reviews); return }
    await refreshReviewHistory(active.id)
    setNotice(`Routed to ${member.role}.`)
    window.setTimeout(() => setNotice(''), 2600)
  }

  async function addComment() {
    if (!commentText.trim()) return
    const comment = { id: crypto.randomUUID(), author: userEmail, role: reviewerRole, text: commentText.trim(), createdAt: new Date().toISOString(), visibility: commentVisibility }
    const next = reviews.map((review) => review.id === active.id ? { ...review, comments: [comment, ...(review.comments ?? [])] } : review)
    setReviews(next)
    if (!await persist(next)) { setReviews(reviews); return }
    await refreshReviewHistory(active.id)
    setCommentText('')
  }

  async function requestChanges() {
    if (!canReviewWorkflow) return
    const next = reviews.map((review) => review.id === active.id ? { ...review, status: 'Changes requested' } : review)
    setReviews(next)
    if (!await persist(next)) { setReviews(reviews); return }
    await refreshReviewHistory(active.id)
    setNotice('Changes requested. The creator can revise and resubmit.')
    window.setTimeout(() => setNotice(''), 3000)
  }

  function exportPassport() {
    const passport = {
      product: 'Assay', reviewId: active.id, title: active.title, channel: active.channel, status: active.status,
      submittedBy: active.owner, assignedReviewer: active.reviewer ?? 'Unassigned', riskTier: active.riskTier ?? 'Not assessed',
      content: active.content, image: active.image ? { ...active.image, dataUrl: '[omitted from text export; image remains local to this browser]' } : undefined, ruleSetVersion: active.ruleSetVersion ?? 1, ruleSnapshot: active.ruleSnapshot ?? [], findings: active.findings, comments: active.comments ?? [],
      approvedRun: active.approvedRun,
      decisions: active.decisions ?? [], revisions: (active.revisions ?? []).map(({ id, author, label, createdAt, content }) => ({ id, author, label, createdAt, content })),
      aiDisclosure: 'AI review is disabled. Only deterministic checks and human decisions are recorded.', generatedAt: new Date().toISOString(),
    }
    const blob = new Blob([JSON.stringify(passport, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `assay-passport-${active.id}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function exportWorkspaceBackup() {
    const backup = { product: 'Assay', formatVersion: 1, exportedAt: new Date().toISOString(), data: { reviews, rules, claims } }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `assay-workspace-backup-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setNotice('Workspace backup downloaded.')
    window.setTimeout(() => setNotice(''), 2600)
  }

  async function restoreWorkspaceBackup(file?: File) {
    if (!file) return
    try {
      if (file.size > 25 * 1024 * 1024) throw new Error('large')
      const parsed: unknown = JSON.parse(await file.text())
      if (!parsed || typeof parsed !== 'object') throw new Error('invalid')
      const backup = parsed as { product?: unknown; formatVersion?: unknown; data?: Partial<{ reviews: unknown[]; rules: unknown[]; claims: unknown[] }> }
      if (backup.product !== 'Assay' || backup.formatVersion !== 1 || !Array.isArray(backup.data?.reviews) || !Array.isArray(backup.data?.rules) || !Array.isArray(backup.data?.claims)) throw new Error('invalid')
      const nextData = backup.data as AssayData
      if (!nextData.reviews.every((item) => item && typeof item === 'object' && typeof (item as Review).id === 'string' && typeof (item as Review).content === 'string') || !nextData.rules.every((item) => item && typeof item === 'object' && typeof (item as BrandRule).id === 'string') || !nextData.claims.every((item) => item && typeof item === 'object' && typeof (item as ApprovedClaim).id === 'string')) throw new Error('invalid')
      if (!window.confirm(`Import ${nextData.reviews.length} reviews, ${nextData.rules.length} rules, and ${nextData.claims.length} claims into this workspace? Attached images will be skipped.`)) return
      const imported: AssayData = {
        reviews: nextData.reviews.map((review) => ({ ...review, id: crypto.randomUUID(), image: undefined })),
        rules: canManageBrandBrain ? nextData.rules.map((rule) => ({ ...rule, id: crypto.randomUUID() })) : [],
        claims: canManageClaims ? nextData.claims.map((claim) => ({ ...claim, id: crypto.randomUUID() })) : [],
      }
      setReviews((current) => [...imported.reviews, ...current])
      if (canManageBrandBrain) {
        setRules((current) => [...imported.rules, ...current])
      }
      if (canManageClaims) {
        setClaims((current) => [...imported.claims, ...current])
      }
      onDataChange(imported)
      setActiveId(imported.reviews[0]?.id ?? '')
      setActiveNav('Reviews')
      setNotice(canManageBrandBrain || canManageClaims ? 'Supported records imported to the workspace.' : 'Reviews imported. Brand rules and claims require a reviewer role.')
    } catch {
      setNotice('That file is not a valid Assay workspace backup.')
    }
    window.setTimeout(() => setNotice(''), 3200)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setActiveNav('Overview')}><span className="brand-mark">A</span><span>assay<span className="brand-period">.</span></span></a>
        {workspace.memberships.length > 1 ? <label className="workspace-switch"><span className="workspace-avatar">{workspace.name.slice(0, 1).toUpperCase()}</span><span className="workspace-copy"><strong>{workspace.name}</strong><small>Switch organization</small></span><select aria-label="Active organization" value={workspace.id} onChange={(event) => onSwitchWorkspace(event.target.value)}>{workspace.memberships.map((membership) => <option key={membership.id} value={membership.id}>{membership.name}</option>)}</select><ChevronDown size={15} /></label> : <button className="workspace-switch"><span className="workspace-avatar">{workspace.name.slice(0, 1).toUpperCase()}</span><span className="workspace-copy"><strong>{workspace.name}</strong><small>Brand workspace</small></span><ChevronDown size={15} /></button>}
        <div className="nav-groups">
          {navSections.map((section) => <div className="nav-section" key={section.label}><div className="nav-label">{section.label}</div>{section.items.map(({ name, icon: Icon }) => <button key={name} className={`nav-item ${activeNav === name ? 'active' : ''}`} onClick={() => { setActiveNav(name); if (name === 'Reviews') setActiveId(reviews[0]?.id ?? '') }}><Icon size={17} strokeWidth={1.8} /><span>{name}</span></button>)}</div>)}
        </div>
        <div className="sidebar-bottom"><button className={`nav-item ${activeNav === 'Settings' ? 'active' : ''}`} onClick={() => setActiveNav('Settings')}><Settings2 size={17} /><span>Settings</span></button><div className="profile"><div className="profile-avatar">{userEmail.slice(0, 1).toUpperCase()}</div><div className="profile-copy"><strong>{userEmail}</strong><small>Workspace member</small></div><button className="sign-out-link" onClick={onSignOut}>Sign out</button></div></div>
      </aside>

      <main className="main-panel">
        <header className="topbar"><div className="breadcrumb">{workspace.name} <span>/</span> <strong>{activeNav}</strong></div><div className="topbar-actions"><span className={`privacy-pill cloud-sync ${syncStatus}`} title="Authenticated workspace data is saved to the hosted database"><ShieldCheck size={14} /> {syncStatus === 'saving' ? 'Saving…' : syncStatus === 'error' ? 'Sync error' : 'Workspace synced'}</span><div className="topbar-avatar" title={userEmail}>{userEmail.slice(0, 1).toUpperCase()}</div></div></header>
        <div className="content-wrap">
          <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" /> BRAND GOVERNANCE</div><h1>Review workspace</h1><p>Thoughtful checks, clear evidence, better work before it ships.</p></div><button className="primary-button" onClick={() => document.getElementById('draft-input')?.focus()}><Plus size={17} /> New review</button></div>
          <section className="metrics-grid">
            <Metric label="Awaiting review" value={String(reviews.filter((review) => review.status === 'Needs review').length)} detail="Workspace records" icon={<Clock3 size={16} />} tone="amber" />
            <Metric label="Approved reviews" value={String(reviews.filter((review) => review.status === 'Approved').length)} detail="Workspace records" icon={<CheckCheck size={16} />} tone="green" />
            <Metric label="Review decisions" value={String(radar.resolvedActions)} detail="Resolved, dismissed, or confirmed" icon={<Activity size={16} />} tone="blue" />
            <Metric label="Rules to clarify" value={String(radar.ambiguous.length)} detail="Repeated finding prompts" icon={<Sparkles size={16} />} tone="violet" />
          </section>

          {activeNav === 'Settings' ? <section className="brandbrain-section"><div className="section-heading"><div><h2>Workspace settings</h2><p>Manage your signed-in’s workspace and backup files.</p></div></div><div className="brain-card backup-card"><div className="brain-card-head"><div><span className="brain-overline">WORKSPACE DATA</span><h3>Backup and restore</h3></div><span className="local-data-badge"><ShieldCheck size={13} /> Synced workspace</span></div><p>Assay stores supported reviews, rules, and claims in this authenticated workspace. A downloaded backup is a separate JSON file.</p><div className="backup-actions"><button className="primary-button" onClick={exportWorkspaceBackup}><Download size={14} /> Download workspace backup</button><button className="secondary-button" onClick={() => backupInput?.click()}><FileText size={14} /> Import backup</button><input ref={setBackupInput} type="file" accept="application/json,.json" hidden onChange={(event) => { void restoreWorkspaceBackup(event.target.files?.[0]); event.currentTarget.value = '' }} /></div><div className="backup-note"><ShieldCheck size={14} /> Backups can contain submitted copy, review history, and attached image data. Store them with the same care as the workspace.</div><div className="backup-limit">Imports add core review, rule, and claim records. Images, comments, decisions, and revision history are not imported.</div></div>{canInviteMembers && <div className="brain-card backup-card"><div className="brain-card-head"><div><span className="brain-overline">MEMBERS</span><h3>Invite workspace members</h3></div></div><div className="invite-form"><input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@example.com" /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as 'creator' | 'manager' | 'brand_reviewer' | 'legal_reviewer')}><option value="creator">Creator</option>{workspace.role === 'admin' && <><option value="manager">Manager</option><option value="brand_reviewer">Brand reviewer</option><option value="legal_reviewer">Legal reviewer</option></>}</select><button className="primary-button" disabled={inviteBusy} onClick={() => { void createMemberInvite() }}>{inviteBusy ? 'Sending…' : 'Send invite'}</button></div>{inviteError && <p className="auth-error" role="alert">{inviteError}</p>}{inviteMessage && <p className="auth-message" role="status">{inviteMessage}</p>}<div className="invite-list"><div className="brain-card-head"><div><span className="brain-overline">PENDING</span><h3>Open invitations</h3></div></div>{pendingInvites.length === 0 ? <p className="empty-history">No open invitations.</p> : pendingInvites.map((invitation) => <div className="claim-row" key={invitation.id}><div className="claim-row-top"><strong>{invitation.email}</strong><span className="claim-status current">{invitation.role}</span></div><div className="claim-meta"><span>Expires {new Date(invitation.expires_at).toLocaleDateString()}</span><button className="dismiss-button" onClick={() => { void revokeInvite(invitation.id) }}>Revoke</button></div></div>)}</div></div>}{!canInviteMembers && <div className="brain-card backup-card"><div className="brain-card-head"><div><span className="brain-overline">MEMBERS</span><h3>Invitation access</h3></div></div><p>Only Admins can invite non-creator roles. Managers can invite creators only.</p></div>}</section> : activeNav === 'Brand Brain' ? <section className="brandbrain-section"><div className="section-heading"><div><h2>Brand Brain <span className="muted-count">{rules.filter((rule) => rule.status === 'Approved').length} approved rules</span></h2><p>Your team’s source of truth. Draft rules stay out of checks until approved.</p></div>{(canManageBrandBrain || canManageClaims) && <div className="brandbrain-actions">{canManageClaims && <button className="secondary-button" onClick={() => setShowClaimForm((shown) => !shown)}><Plus size={14} /> Add approved claim</button>}{canManageBrandBrain && <button className="primary-button" onClick={() => setShowRuleForm((shown) => !shown)}><Plus size={15} /> Add rule</button>}</div>}</div>
            <div className="regression-panel"><div><span className="brain-overline">RULE REGRESSION PREVIEW</span><h3>Check a proposed term against saved reviews</h3><p>Preview a simple phrase match locally before adding it. This does not change the rule set.</p></div><div className="regression-form"><input aria-label="Phrase to preview" placeholder="Enter a phrase, such as ‘clinically proven’" value={regressionText} onChange={(event) => { setRegressionText(event.target.value); setRegressionResults(null) }} onKeyDown={(event) => { if (event.key === 'Enter' && regressionText.trim()) previewRuleRegression() }} /><button className="secondary-button" disabled={!regressionText.trim()} onClick={previewRuleRegression}><Search size={14} /> Preview impact</button></div>{regressionResults && <div className="regression-results" aria-live="polite"><strong>{regressionResults.reduce((sum, item) => sum + item.added.length, 0)} new match{regressionResults.reduce((sum, item) => sum + item.added.length, 0) === 1 ? '' : 'es'} across {regressionResults.length} review{regressionResults.length === 1 ? '' : 's'}</strong>{regressionResults.length ? regressionResults.map((item) => <div className="regression-result" key={item.reviewId}><span>{item.title}</span><small>{item.added.map((finding) => `“${finding.excerpt}”`).join(', ')}</small></div>) : <p>No matches in saved review copy.</p>}<small>Preview uses the current local review set and only the basic phrase matcher. It is not a full rule quality evaluation.</small></div>}</div>
            <div className="brandbrain-content"><div className="brain-card"><div className="brain-card-head"><div><span className="brain-overline">GOVERNANCE RULES</span><h3>Brand rules</h3></div><span className="version-pill">Rule set v1.0</span></div>{showRuleForm && <div className="inline-create"><input autoFocus placeholder="e.g. Avoid urgency language in customer emails" value={ruleText} onChange={(event) => setRuleText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addRule() }} /><button onClick={addRule}>Save draft</button><button className="cancel-create" onClick={() => setShowRuleForm(false)}>Cancel</button></div>}<div className="rule-list">{rules.map((rule) => <div className={`rule-row ${!rule.active ? 'inactive-row' : ''}`} key={rule.id}><span className={`rule-severity ${rule.severity.toLowerCase()}`} /><div className="rule-copy"><div className="rule-title-line"><strong>{rule.label}</strong><span className={`rule-status ${rule.status.toLowerCase()}`}>{rule.status}{rule.version ? ` · v${rule.version}` : ''}</span></div><p>{rule.description}</p><span className="rule-source"><BookOpen size={12} />{rule.ruleKey ?? rule.id} · {rule.source}</span></div><div className="rule-controls">{canManageBrandBrain && (rule.status === 'Draft' ? <button className="approve-rule" onClick={() => approveRule(rule.id)}><Check size={13} /> Publish version</button> : rule.status === 'Approved' ? <button className={`toggle-switch ${rule.active ? 'on' : ''}`} onClick={() => toggleRule(rule.id)} aria-label={rule.active ? 'Deactivate rule' : 'Activate rule'}><span /></button> : null)}</div></div>)}</div><div className="brain-footer"><ShieldCheck size={14} /> Only approved and active rules are used by deterministic checks.</div></div>
              <div className="brain-card claims-card"><div className="brain-card-head"><div><span className="brain-overline">APPROVED EVIDENCE</span><h3>Claims Vault</h3></div><span className="claim-count">{claims.filter((claim) => claim.active).length} claims</span></div>{showClaimForm && <div className="claim-create"><input autoFocus placeholder="Approved claim or fact" value={claimText} onChange={(event) => setClaimText(event.target.value)} /><input placeholder="Evidence summary or source" value={claimEvidence} onChange={(event) => setClaimEvidence(event.target.value)} /><input type="url" placeholder="Evidence URL (optional)" value={claimEvidenceUrl} onChange={(event) => setClaimEvidenceUrl(event.target.value)} /><label>Expires<input type="date" value={claimExpiry} onChange={(event) => setClaimExpiry(event.target.value)} /></label><button onClick={addClaim} disabled={!claimText.trim() || !claimEvidence.trim() || !claimExpiry}>Save</button><button className="cancel-create" onClick={() => setShowClaimForm(false)}>Cancel</button></div>}<div className="claim-list">{claims.map((claim) => { const expired = Boolean(claim.expiryDate) && claim.expiryDate < today; return <div className={`claim-row ${!claim.active ? 'inactive-row' : ''}`} key={claim.id}><div className="claim-row-top"><strong>{claim.statement}</strong><span className={`claim-status ${expired ? 'expired' : 'current'}`}>{expired ? 'Expired' : 'Current'}</span></div><div className="claim-evidence"><BookOpen size={12} />{claim.evidence}{claim.evidenceUrl && <> · <a href={claim.evidenceUrl} target="_blank" rel="noreferrer">Open proof</a></>}</div><div className="claim-meta"><span>Owner · {claim.owner}</span><span>Expires · {claim.expiryDate ? new Date(`${claim.expiryDate}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'Not set'}</span></div>{canManageClaims && <button className={`claim-toggle ${claim.active ? '' : 'restore'}`} onClick={() => toggleClaim(claim.id)}>{claim.active ? 'Archive' : 'Restore'}</button>}</div> })}</div><div className="brain-footer"><Clock3 size={14} /> Expired claims remain visible and are flagged when matched.</div></div>
            </div><div className="brain-notice"><Sparkles size={15} /><span>Rule extraction from uploaded brand guides is planned next. Add and approve rules manually for now.</span></div>
          </section> : activeNav === 'Governance Radar' ? <RadarView radar={radar} onFocusReview={(reviewId) => { setActiveNav('Reviews'); setActiveId(reviewId) }} /> : <section className="review-section">
            {reviews.length === 0 ? <div className="empty-workspace"><span className="placeholder-icon"><FileText size={21} /></span><h2>Start your workspace with real content</h2><p>Paste a submission below. Assay will check it against the rules and evidence you add to Brand Brain.</p><div className="draft-box"><label className="draft-label" htmlFor="draft-input"><FileText size={15} /><span>NEW CONTENT SUBMISSION</span></label><div className="draft-input-row"><input id="draft-input" placeholder="Paste content to review…" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitReview() }} /><button className="draft-submit" onClick={submitReview} aria-label="Create review"><ArrowRight size={16} /></button></div></div></div> : <>
            <div className="section-heading"><div><h2>Content reviews <span className="muted-count">{reviews.length}</span></h2><p>Review with the right context, not another round of guesswork.</p></div><button className="secondary-button" disabled title="Filters are not enabled yet"><Filter size={15} /> Filters</button></div>
            <div className="review-layout">
              {activeNav === 'Reviews' ? <><div className="queue-panel">
                <div className="queue-toolbar"><label className="search-box"><Search size={15} /><input aria-label="Search reviews" placeholder="Search reviews..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="icon-button subtle" aria-label="More queue options"><MoreHorizontal size={18} /></button></div>
                <div className="filter-tabs">{['All reviews', 'Needs review', 'In review', 'Approved'].map((item) => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>
                <div className="queue-list">{visibleReviews.map((review) => <button key={review.id} className={`queue-card ${activeId === review.id ? 'selected' : ''}`} onClick={() => setActiveId(review.id)}><div className="queue-card-top"><span className={`status-dot ${review.status === 'Approved' ? 'ok' : review.status === 'In review' ? 'reviewing' : ''}`} /><span className="queue-status">{review.status}</span><span className="queue-time">{review.time}</span></div><strong className="queue-title">{review.title}</strong><div className="queue-meta"><span><Globe2 size={13} />{review.channel}</span><span className="queue-owner"><span className="mini-avatar">{review.initials}</span>{review.owner}</span></div><div className="queue-card-bottom"><span className="finding-count">{review.findings.filter((finding) => finding.level !== 'Clear' && !finding.decision).length} findings</span><span className="queue-id">{review.id}</span></div></button>)}{visibleReviews.length === 0 && <div className="empty-state">No reviews match. Try another search or filter.</div>}{hasMoreReviews && <button className="secondary-button" disabled={loadingMoreReviews} onClick={() => { void loadMore() }}>{loadingMoreReviews ? 'Loading…' : 'Load more reviews'}</button>}</div>
              </div></> : <div className="placeholder-panel"><span className="placeholder-icon">{activeNav === 'Overview' ? <LayoutDashboard size={21} /> : activeNav === 'Governance Radar' ? <Activity size={21} /> : <Users2 size={21} />}</span><h2>{activeNav}</h2><p>{activeNav === 'Governance Radar' ? 'Insights will populate from resolved findings, reviewer feedback, and rule history.' : activeNav === 'Assay Guild' ? 'Playbooks, verified expert profiles, and intro requests will connect to real review patterns in a later phase.' : 'Your overview will grow from the workspace’s real review and approval activity.'}</p><span className="coming-soon">PLANNED FOR A LATER PHASE</span></div>}

              {activeNav === 'Reviews' && <div className="detail-panel">
                <div className="detail-header"><div><div className="detail-kicker"><FileText size={14} /> {active.id} <span>·</span> Submitted {active.time}</div><h2>{active.title}</h2><div className="detail-byline"><span className="mini-avatar larger">{active.initials}</span><span>Submitted by <strong>{active.owner}</strong></span><span className="byline-divider" /><span>{active.channel}</span></div></div><button className="icon-button subtle" aria-label="More review actions"><MoreHorizontal size={19} /></button></div>
                <div className="brain-notice"><ShieldCheck size={15} /><span>Submissions, comments, human finding decisions, and review status are saved to Supabase. Findings are deterministic browser checks and have not been independently verified by an AI service.</span></div>
                <div className="detail-actions"><label className="intent-field"><span>Creator intent (not saved yet)</span><input disabled value={active.intent ?? intent} aria-label="Creator intent" /></label>{['Draft', 'Changes requested'].includes(active.status) && <><button className="secondary-button" disabled={runBusy} onClick={() => { void runActiveCheck() }}><Sparkles size={15} /> {runBusy ? 'Running…' : 'Run check'}</button><button className="primary-button" disabled={!hasCurrentRun} onClick={() => { void submitForReview() }} title={hasCurrentRun ? 'Submit this checked draft' : 'Run the check on the latest content first'}><Send size={15} /> Submit for review</button></>}{canReviewWorkflow && ['Needs review', 'In review'].includes(active.status) && <button className="secondary-button" disabled={!canWaiveActive} onClick={() => { void waiveReview() }}>Waive…</button>}<button className="primary-button approve-button" onClick={() => { void approveReview() }} disabled={!canApproveActive} title={canApproveActive ? 'Approve this review' : 'Approval requires an authorized reviewer, another person than the submitter, and completed finding decisions'}><Check size={16} /> Approve review</button></div>
                      {['Draft', 'Changes requested'].includes(active.status) && <p className="run-gate-message" role="status">{hasCurrentRun ? 'The latest content has a completed check.' : 'Run the check on the latest content first.'}</p>}
                <div className="workflow-strip"><span className={`risk-badge ${(active.riskTier ?? 'Standard').toLowerCase()}`}><ShieldCheck size={13} /> {active.riskTier ?? 'Risk not routed'}</span><span><Route size={13} /> {active.assignedReviewerId ? active.reviewer ?? 'Reviewer' : 'No reviewer assigned'}</span>{canReviewWorkflow && <><select aria-label="Assign reviewer" value={assignedMemberId || active.assignedReviewerId || ''} onChange={(event) => setAssignedMemberId(event.target.value)}><option value="">Choose reviewer…</option>{eligibleReviewers.map((member) => <option key={member.userId} value={member.userId}>{member.displayName} · {member.role}</option>)}</select><button disabled={!eligibleReviewers.length || !['Needs review', 'In review'].includes(active.status)} onClick={() => { void routeForReview() }}><ArrowRight size={13} /> Route</button></>}{(active.revisions?.length ?? 0) > 0 && <button onClick={() => setRevisionOpen((open) => !open)}><History size={13} /> History</button>}{['Approved', 'Waived'].includes(active.status) && <button onClick={() => setPassportOpen(true)}><FileCheck2 size={13} /> Passport</button>}</div>
                <div className="finding-summary"><div><span className="summary-number">{active.findings.filter((finding) => finding.level === 'Needs review' && !finding.decision).length}</span><span>needs review</span></div><div className="summary-separator" /><div><span className="summary-number watch-number">{active.findings.filter((finding) => finding.level === 'Watch' && !finding.decision).length}</span><span>to consider</span></div><div className="summary-spacer" /><span className="source-assurance"><ShieldCheck size={15} /> Evidence linked</span></div>
                <ImageAttachment image={active.image} busy={imageBusy} editable={!['Approved', 'Waived', 'Archived'].includes(active.status)} onFile={(file) => { void attachImage(file) }} onAlt={(value) => { void updateImageAlt(value) }} onRemove={() => { void removeImage() }} />
                <div className="findings-list">{active.findings.map((finding) => <FindingCard key={finding.id} finding={finding} onResolve={(action, reason) => updateFinding(active.id, finding.id, action, reason)} onPreviewSuggestion={previewSuggestion} onAcceptSuggestion={acceptSuggestion} decisionsEnabled />)}{active.findings.length === 0 && <div className="all-clear"><span className="all-clear-icon"><Check size={18} /></span><div><strong>No deterministic flags found</strong><p>This is a local deterministic pass and does not assess tone or certify factual accuracy.</p></div></div>}</div>
                {suggestionChecks.length > 0 && <div className="suggestion-check-result"><strong>Fix check found {suggestionChecks.length} issue{suggestionChecks.length === 1 ? '' : 's'}:</strong>{suggestionChecks.map((finding) => <span key={finding.id}>{finding.title}</span>)}</div>}
                {revisionOpen && <div className="history-panel"><div className="panel-title"><History size={14} /> Revision history</div>{(active.revisions ?? []).length ? active.revisions?.map((revision) => <div className="history-entry" key={revision.id}><div><strong>{revision.label}</strong><span>{revision.author} · {new Date(revision.createdAt).toLocaleString()}</span><p>{revision.content}</p></div><button onClick={() => { updateReview(active.id, (review) => ({ ...review, content: revision.content, findings: applyFindingDecisions(runDeterministicChecks(revision.content, rules, claims, today), review.decisions) })); setNotice('Revision restored.') }}>Restore</button></div>) : <p className="empty-history">No content revisions yet.</p>}</div>}
                <ReviewCollaboration review={active} role={reviewerRole} author={userEmail} commentText={commentText} setCommentText={setCommentText} visibility={commentVisibility} setVisibility={setCommentVisibility} canMarkInternal={canReviewWorkflow} addComment={() => { void addComment() }} requestChanges={() => { void requestChanges() }} canRequestChanges={canReviewWorkflow && ['Needs review', 'In review'].includes(active.status)} />
                <div className="event-log"><div className="panel-title"><FileClock size={14} /> Audit trail · database recorded</div>{active.events?.length ? active.events.map((entry) => <div className="history-entry" key={entry.id}><div><strong>{entry.action}</strong><span>{entry.actor} · {new Date(entry.createdAt).toLocaleString()}</span><p>{entry.detail}</p></div></div>) : <p className="empty-history">No review events have been recorded yet.</p>}</div>
                <div className="draft-box"><div className="draft-label"><WandSparkles size={15} /><span>NEW SUBMISSION</span></div><div className="draft-input-row"><input id="draft-input" placeholder="Paste a draft to add it to this review queue..." value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitReview() }} /><button className="draft-submit" onClick={submitReview} aria-label="Submit draft"><ArrowRight size={16} /></button></div><div className="draft-footnote"><ShieldCheck size={13} /> Saved to your authenticated workspace</div></div>
                  </div>}
            </div>
            </>}
          </section>}
          <div className="bottom-note"><span><Sparkles size={14} /> Deterministic checks only · AI review is not connected.</span><button onClick={() => setActiveNav('Brand Brain')}>Explore Brand Brain <ArrowRight size={13} /></button></div>
        </div>
      </main>
      {passportOpen && <PassportModal review={active} onClose={() => setPassportOpen(false)} onExport={exportPassport} />}
      {notice && <div className="toast"><Check size={16} />{notice}</div>}
    </div>
  )
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [workspace, setWorkspace] = useState<CloudWorkspace | null>(null)
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceAttempt, setWorkspaceAttempt] = useState(0)
  const [workspaceError, setWorkspaceError] = useState('')
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [inviteAttempt, setInviteAttempt] = useState(0)
  const [inviteComplete, setInviteComplete] = useState(false)
  const [inviteBusy, setInviteBusy] = useState(false)
  const [inviteError, setInviteError] = useState('')
  const [syncStatus, setSyncStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const saveQueue = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    const url = new URL(window.location.href)
    const queryToken = url.searchParams.get('invite') ?? url.searchParams.get('token')
    const savedToken = window.sessionStorage.getItem('assay-invite-token')
    const token = queryToken ?? savedToken
    if (token) {
      window.sessionStorage.setItem('assay-invite-token', token)
      setInviteToken(token)
    }
    if (url.searchParams.has('invite') || url.searchParams.has('token')) {
      url.searchParams.delete('invite')
      url.searchParams.delete('token')
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    }
  }, [])

  useEffect(() => {
    clearLegacyWorkspaceMirror()
    if (!supabase) { setAuthReady(true); return }
    let alive = true
    supabase.auth.getSession().then(({ data, error }) => {
      if (!alive) return
      if (error) setWorkspaceError(error.message)
      setSession(data.session)
      setAuthReady(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setWorkspace(null)
      setSelectedOrganizationId(null)
      setWorkspaceError('')
    })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!session || !supabase || (inviteToken && !inviteComplete)) {
      setWorkspace(null)
      setWorkspaceLoading(false)
      return
    }
    let alive = true
    setWorkspaceLoading(true)
    loadOrCreateWorkspace(session.user, selectedOrganizationId).then((loaded) => {
      if (!alive) return
      setWorkspace(loaded)
      if (loaded && loaded.id !== selectedOrganizationId) setSelectedOrganizationId(loaded.id)
      setWorkspaceError('')
    }).catch((error: unknown) => {
      if (alive) setWorkspaceError(error instanceof Error ? error.message : 'Could not load your workspace.')
    }).finally(() => { if (alive) setWorkspaceLoading(false) })
    return () => { alive = false }
  }, [session?.user.id, selectedOrganizationId, workspaceAttempt, inviteToken, inviteComplete])

  useEffect(() => {
    if (!session || !supabase || !inviteToken || inviteComplete) return
    let alive = true
    setInviteBusy(true)
    setInviteError('')
    fetch('/api/accept-invite', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inviteToken }),
    }).then(async (response) => {
      const result = await response.json() as { organization_id?: string; error?: string }
      if (!response.ok || !result.organization_id) throw new Error(result.error || 'Invitation could not be accepted.')
      if (!alive) return
      window.sessionStorage.removeItem('assay-invite-token')
      setInviteToken(null)
      setInviteComplete(true)
      setSelectedOrganizationId(result.organization_id)
      setWorkspace(null)
      setWorkspaceError('')
      setWorkspaceAttempt((attempt) => attempt + 1)
    }).catch((error: unknown) => {
      if (alive) setInviteError(error instanceof Error ? error.message : 'Invitation could not be accepted.')
    }).finally(() => {
      if (alive) setInviteBusy(false)
    })
    return () => { alive = false }
  }, [session?.user.id, inviteToken, inviteAttempt, inviteComplete])

  function persistCloudData(data: AssayData): Promise<void> {
    if (!workspace || !session) return Promise.reject(new Error('Workspace is not ready.'))
    setSyncStatus('saving')
    const queued = saveQueue.current.catch(() => undefined).then(async () => {
      await saveWorkspaceData(workspace.id, session.user.id, data)
      setSyncStatus('saved')
    })
    saveQueue.current = queued
    return queued.catch((error: unknown) => {
      console.error('Workspace sync failed', error)
      setSyncStatus('error')
      throw error
    })
  }

  async function signOut() {
    clearLegacyWorkspaceMirror()
    await supabase?.auth.signOut()
  }

  if (!supabase) return <SetupRequired />
  if (!authReady) return <StartupScreen message="Checking your sign-in…" />
  if (!session) return <AuthScreen invitationPending={Boolean(inviteToken)} invitationToken={inviteToken ?? undefined} />
  if (inviteToken && !inviteComplete) {
    if (inviteError) return <InvitationError message={inviteError} onRetry={() => setInviteAttempt((attempt) => attempt + 1)} onSignOut={signOut} />
    return <StartupScreen message={inviteBusy ? 'Accepting your workspace invitation…' : 'Preparing your invitation…'} />
  }
  if (workspaceError && !workspace) return <StartupError message={workspaceError} onRetry={() => setWorkspaceAttempt((attempt) => attempt + 1)} onSignOut={signOut} />
  if (workspaceLoading) return <StartupScreen message="Loading your private workspace…" />
  if (!workspace) return <WorkspaceCreationScreen userId={session.user.id} onCreated={(organizationId) => { setSelectedOrganizationId(organizationId); setWorkspaceAttempt((attempt) => attempt + 1) }} />
  return <WorkspaceApp key={workspace.id} initialData={workspace.data} workspace={workspace} userEmail={session.user.email ?? 'Signed-in user'} accessToken={session.access_token} syncStatus={syncStatus} onDataChange={persistCloudData} onSignOut={signOut} onSwitchWorkspace={(organizationId) => { setWorkspace(null); setSelectedOrganizationId(organizationId) }} />
}

function SetupRequired() {
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark">A</span><strong>assay<span className="brand-period">.</span></strong></div><span className="brain-overline">DEPLOYMENT SETUP REQUIRED</span><h1>Connect your workspace database</h1><p>Assay is configured for authenticated Supabase workspaces. Add the project URL and publishable key to Vercel’s environment settings, then redeploy.</p><div className="env-instructions"><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code></div><small>The publishable key is designed for browser use. Never add a service-role or secret key to a VITE_ variable.</small></section></main>
}

function AuthScreen({ invitationPending = false, invitationToken }: { invitationPending?: boolean; invitationToken?: string }) {
  const [signUp, setSignUp] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (signUp) {
        const emailRedirectUrl = new URL(window.location.href)
        if (invitationToken) emailRedirectUrl.searchParams.set('invite', invitationToken)
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: invitationPending ? { emailRedirectTo: emailRedirectUrl.toString() } : undefined,
        })
        if (authError) throw authError
        if (!data.session) setMessage('Check your email for a confirmation link, then return here to sign in.')
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (authError) throw authError
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Authentication failed.')
    } finally { setBusy(false) }
  }

  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark">A</span><strong>assay<span className="brand-period">.</span></strong></div><span className="brain-overline">PRIVATE BRAND WORKSPACE</span><h1>{signUp ? 'Create your account' : invitationPending ? 'Accept your invitation' : 'Sign in to Assay'}</h1><p>{invitationPending ? 'Sign in or create an account with the email address that received this invitation.' : 'Reviews and brand rules are stored in your authenticated workspace.'}</p><form onSubmit={submit}><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete={signUp ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : signUp ? 'Create account' : 'Sign in'}</button></form>{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-message" role="status">{message}</p>}<button className="auth-toggle" onClick={() => { setSignUp((value) => !value); setError(''); setMessage('') }}>{signUp ? 'Already registered? Sign in' : 'New to Assay? Create an account'}</button><small>New accounts may need email confirmation, depending on the Supabase Auth settings.</small></section></main>
}

function StartupScreen({ message }: { message: string }) {
  return <main className="auth-shell"><section className="auth-card startup-card"><div className="auth-brand"><span className="brand-mark">A</span><strong>assay<span className="brand-period">.</span></strong></div><p>{message}</p></section></main>
}

function WorkspaceCreationScreen({ userId, onCreated }: { userId: string; onCreated: (organizationId: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      onCreated(await createWorkspace({ id: userId }, name))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create workspace.')
    } finally {
      setBusy(false)
    }
  }
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark">A</span><strong>assay<span className="brand-period">.</span></strong></div><span className="brain-overline">WORKSPACE ACCESS</span><h1>Create a workspace</h1><p>You do not belong to a workspace yet. Create one to get started, or wait for an invitation from your team.</p><form onSubmit={submit}><label>Workspace name<input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button></form>{error && <p className="auth-error" role="alert">{error}</p>}<p className="auth-message">Waiting for an invitation? Ask a workspace admin to invite this account.</p></section></main>
}

function StartupError({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark">A</span><strong>assay<span className="brand-period">.</span></strong></div><h1>Workspace unavailable</h1><p className="auth-error">{message}</p><button className="primary-button" onClick={onRetry}>Try again</button><button className="auth-toggle" onClick={onSignOut}>Sign out</button></section></main>
}

function InvitationError({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark">A</span><strong>assay<span className="brand-period">.</span></strong></div><span className="brain-overline">WORKSPACE INVITATION</span><h1>Invitation unavailable</h1><p className="auth-error" role="alert">{message}</p><p>Check that you signed in with the invited email address, or ask a workspace admin for a new invitation.</p><button className="primary-button" onClick={onRetry}>Try again</button><button className="auth-toggle" onClick={onSignOut}>Sign out</button></section></main>
}

function Metric({ label, value, detail, icon, tone }: { label: string; value: string; detail: React.ReactNode; icon: React.ReactNode; tone: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><div className="metric-value">{value}</div><div className={`metric-detail ${tone}`}>{detail}</div></div>
}

function FindingCard({ finding, onResolve, onPreviewSuggestion, onAcceptSuggestion, decisionsEnabled }: { finding: Finding; onResolve: (action: ReviewDecision['action'], reason?: string) => void; onPreviewSuggestion: (suggestion: string) => void; onAcceptSuggestion: (suggestion: string) => void; decisionsEnabled: boolean }) {
  const [expanded, setExpanded] = useState(finding.level !== 'Clear')
  const [showSuggestion, setShowSuggestion] = useState(false)
  return <article className={`finding-card ${finding.level === 'Clear' ? 'clear-card' : ''}`}><button className="finding-head" onClick={() => setExpanded((open) => !open)}><span className={`finding-indicator ${finding.level === 'Needs review' ? 'risk' : finding.level === 'Watch' ? 'watch' : 'clear'}`}>{finding.level === 'Clear' ? <Check size={14} /> : <span />}</span><span className="finding-main"><span className="finding-type">{finding.type}{finding.origin === 'ai' && finding.confidence !== undefined ? ` · ${Math.round(finding.confidence * 100)}% CONFIDENCE` : ''}</span><strong>{finding.title}</strong></span><span className={`finding-state ${finding.level === 'Needs review' ? 'risk-text' : finding.level === 'Watch' ? 'watch-text' : 'clear-text'}`}>{finding.level}</span><ChevronDown className={expanded ? 'chevron open' : 'chevron'} size={16} /></button>{expanded && <div className="finding-body"><div className="quoted-text">{finding.excerpt}</div><p className="finding-note">{finding.note}</p><div className="source-line"><BookOpen size={14} /><span>{finding.source}</span><button aria-label="Open source details" onClick={() => setShowSuggestion((shown) => !shown)}><ArrowRight size={14} /></button></div>{finding.decision && <div className="suggestion-preview">Decision recorded: {finding.decision}</div>}{showSuggestion && <div className="suggestion-preview"><Sparkles size={14} />Suggested next step: review the source with your brand owner before publishing.</div>}{finding.suggestion && <div className="rewrite-box"><div className="rewrite-title"><WandSparkles size={14} /><strong>Rewrite preview (local)</strong></div><p>{finding.suggestion}</p><div className="rewrite-actions"><button className="suggest-button" disabled={!decisionsEnabled} onClick={() => { onPreviewSuggestion(finding.suggestion!); setShowSuggestion(true) }}>Check this edit</button><button className="resolve-button" disabled={!decisionsEnabled} onClick={() => onAcceptSuggestion(finding.suggestion!)}><Check size={13} /> Accept edit</button></div></div>}{decisionsEnabled && !finding.decision && <div className="finding-actions"><button className="resolve-button" onClick={() => onResolve(finding.level === 'Clear' ? 'confirmed' : 'resolved')}><Check size={14} /> {finding.level === 'Clear' ? 'Confirm' : 'Mark resolved'}</button><button className="dismiss-button" onClick={() => { const reason = window.prompt('Why is this finding being dismissed?'); if (reason?.trim()) onResolve('dismissed', reason.trim()) }} aria-label="Dismiss finding">Dismiss with reason</button></div>}</div>}</article>
}

function ReviewCollaboration({ review, role, author, commentText, setCommentText, visibility, setVisibility, canMarkInternal, addComment, requestChanges, canRequestChanges }: { review: Review; role: ReviewerRole; author: string; commentText: string; setCommentText: (value: string) => void; visibility: 'shared' | 'internal'; setVisibility: (value: 'shared' | 'internal') => void; canMarkInternal: boolean; addComment: () => void; requestChanges: () => void; canRequestChanges: boolean }) {
  return <section className="collaboration-panel"><div className="panel-title"><MessageSquare size={14} /> Comments <span>{review.comments?.length ?? 0}</span></div><div className="comment-compose"><textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Add a comment to this review…" rows={2} /><div className="comment-compose-foot"><span>Signed in as {author} · {role}</span><div>{canMarkInternal && <select aria-label="Comment visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as 'shared' | 'internal')}><option value="shared">Shared with creator</option><option value="internal">Internal note</option></select>}<button className="request-changes-button" disabled={!canRequestChanges} onClick={requestChanges}>Request changes</button><button className="post-comment-button" disabled={!commentText.trim()} onClick={addComment}><Send size={13} /> Comment</button></div></div></div>{(review.comments ?? []).map((comment) => <div className="comment-row" key={comment.id}><span className="comment-avatar">{comment.author.split(' ').map((part) => part[0]).join('')}</span><div><div className="comment-byline"><strong>{comment.author}</strong><span>{comment.role}{comment.visibility === 'internal' ? ' · Internal' : ''}</span><time>{new Date(comment.createdAt).toLocaleString()}</time></div><p>{comment.text}</p></div></div>)}</section>
}

function PassportModal({ review, onClose, onExport }: { review: Review; onClose: () => void; onExport: () => void }) {
  const resolved = review.findings.filter((item) => Boolean(item.decision)).length
  const openFindings = review.findings.filter((item) => item.level !== 'Clear' && !item.decision).length
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="passport-modal" role="dialog" aria-modal="true" aria-labelledby="passport-title" onClick={(event) => event.stopPropagation()}><div className="passport-head"><div><span className="passport-mark"><ShieldCheck size={18} /></span><div><div className="brain-overline">PUBLISH READINESS RECORD</div><h2 id="passport-title">Review passport</h2></div></div><button className="icon-button" aria-label="Close passport" onClick={onClose}>×</button></div><div className="passport-status"><span className={`risk-badge ${(review.riskTier ?? 'Standard').toLowerCase()}`}><ShieldCheck size={13} /> {review.status}</span><span>{review.id} · Rule set v{review.ruleSetVersion ?? 1}</span></div><div className="passport-fields"><div><small>Content</small><strong>{review.title}</strong></div><div><small>Submitted by</small><strong>{review.owner}</strong></div><div><small>Reviewer</small><strong>{review.reviewer ?? 'Not assigned'}</strong></div><div><small>Risk tier</small><strong>{review.riskTier ?? 'Not assessed'}</strong></div><div><small>Findings resolved</small><strong>{resolved} decisions · {openFindings} open findings</strong></div><div><small>Rules recorded</small><strong>{review.approvedRun?.ruleSnapshot && Array.isArray(review.approvedRun.ruleSnapshot) ? review.approvedRun.ruleSnapshot.length : review.ruleSnapshot?.length ?? 0} versioned rules</strong></div><div><small>Approval run</small><strong>{review.approvedRunId ?? 'Not recorded'}</strong></div>{review.approvedRun && <><div><small>Rules snapshot SHA-256</small><strong>{review.approvedRun.rulesSha256}</strong></div><div><small>Claims snapshot SHA-256</small><strong>{review.approvedRun.claimsSha256}</strong></div><div><small>Run valid until</small><strong>{new Date(review.approvedRun.validUntil).toLocaleString()}</strong></div></>}</div><div className="passport-copy"><small>Reviewed content snapshot</small><p>{review.content}</p></div><div className="passport-disclosure"><ShieldCheck size={14} /> AI review is disabled. This record contains deterministic checks and human decisions; it is not a cryptographic signature.</div><div className="passport-footer"><span>Generated {new Date(review.passportCreatedAt ?? Date.now()).toLocaleString()}</span><button className="primary-button" onClick={onExport}><Download size={14} /> Export JSON</button></div></section></div>
}

function ImageAttachment({ image, busy, editable, onFile, onAlt, onRemove }: { image?: Review['image']; busy: boolean; editable: boolean; onFile: (file?: File) => void; onAlt: (value: string) => void; onRemove: () => void }) {
  const [altText, setAltText] = useState(image?.altText ?? '')
  useEffect(() => setAltText(image?.altText ?? ''), [image?.assetId, image?.altText])
  return <section className="image-attachment"><div className="panel-title"><ImagePlus size={14} /> Campaign image <span className="image-local-label">PRIVATE STORAGE</span></div>{image ? <div className="attached-image"><img src={image.dataUrl} alt={altText || ''} /><div className="attached-image-details"><div className="image-meta-line"><strong>{image.name}</strong><span>{image.width} × {image.height}px</span>{editable && <button disabled={busy} onClick={onRemove} aria-label="Remove image"><X size={13} /></button>}</div><label className="alt-input"><span>Alt text</span><input disabled={!editable || busy} value={altText} onChange={(event) => setAltText(event.target.value)} onBlur={() => { if (altText !== image.altText) onAlt(altText) }} placeholder="Describe the image for someone who cannot see it" /></label><div className="palette-row"><span>Dominant colors</span>{image.palette.slice(0, 5).map((color) => <i key={color} title={color} style={{ backgroundColor: color }} />)}</div><p>Checks assess alt text, dimensions, and brand palette; tonal contrast is a rough human-review prompt.</p></div></div> : editable ? <label className={`image-drop ${busy ? 'busy' : ''}`}><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { onFile(event.target.files?.[0]); event.currentTarget.value = '' }} /><ImagePlus size={18} /><span>{busy ? 'Inspecting image…' : 'Add a campaign image'}</span><small>PNG, JPG, or WebP · up to 5 MB · stored in your workspace</small></label> : <p className="empty-history">No campaign image is attached.</p>}</section>
}

function RadarView({ radar, onFocusReview }: { radar: ReturnType<typeof buildRadar>; onFocusReview: (id: string) => void }) {
  const max = Math.max(1, ...radar.repeated.map((item) => item.count))
  return <section className="radar-page"><div className="radar-intro"><div><span className="brain-overline">LOCAL PREVIEW · PHASE 6</span><h2>Governance Radar</h2><p>Patterns calculated only from this workspace’s saved review records.</p></div><span className="local-data-badge"><Activity size={14} /> {radar.reviewCount} reviews</span></div><div className="radar-stats"><div><small>Open findings</small><strong>{radar.openFindings}</strong><span>Across current reviews</span></div><div><small>Review decisions</small><strong>{radar.resolvedActions}</strong><span>Resolved, dismissed, or confirmed</span></div><div><small>Change requests</small><strong>{radar.changesRequested}</strong><span>Recorded in review history</span></div><div><small>Workflow statuses</small><strong>{Object.keys(radar.statuses).length}</strong><span>Current review states</span></div></div><div className="radar-columns"><div className="radar-card"><div className="radar-card-heading"><div><h3>Recurring findings</h3><p>Grouped by source rule or finding title.</p></div><span className="computed-label">COMPUTED</span></div>{radar.repeated.length ? radar.repeated.slice(0, 6).map((item) => <div className="radar-row" key={item.title}><div className="radar-row-copy"><strong>{item.title}</strong><small>{item.type} · {item.reviewIds.length} affected reviews</small></div><div className="radar-bar-track"><i style={{ width: `${Math.max(12, item.count / max * 100)}%` }} /></div><b>{item.count}</b><button onClick={() => item.reviewIds[0] && onFocusReview(item.reviewIds[0])}>Open</button></div>) : <div className="radar-empty">No open findings in the workspace.</div>}</div><div className="radar-card"><div className="radar-card-heading"><div><h3>Rules to clarify</h3><p>Repeated unresolved findings may be worth reviewing.</p></div><span className="computed-label">HEURISTIC</span></div>{radar.ambiguous.length ? radar.ambiguous.slice(0, 4).map((item) => <div className="clarity-item" key={item.title}><span className="clarity-icon"><Sparkles size={14} /></span><div><strong>{item.title}</strong><p>Appears in {item.count} open findings. This is a review prompt, not proof a guideline is unclear.</p></div></div>) : <div className="radar-empty">Repeated issues will appear after the workspace has review history.</div>}</div></div><div className="radar-disclaimer"><ShieldCheck size={14} /> Radar uses records from this workspace only. It does not compare brands or infer causation.</div></section>
}

export default App
