import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BookOpen,
  Check, CheckCheck, ChevronDown, CircleHelp, Clock3, FileCheck2,
  FileText, Filter, Globe2, LayoutDashboard, MoreHorizontal, Plus,
  Search, Settings2, ShieldCheck, Sparkles, Users2, WandSparkles, MessageSquare, History, Download, Send, FileClock, Route, ImagePlus, X, Compass, ExternalLink,
} from 'lucide-react'
import { clearLegacyWorkspaceMirror, type AssayData } from './storage'
import { runDeterministicChecks } from './checks'
import { validateSuggestion } from './aiReview'
import type { Review, BrandRule, ApprovedClaim, Finding, ReviewerRole, ReviewEvent, ReviewRevision } from './types'
import { checkImageMetadata } from './imageChecks'
import { buildRadar } from './insights'
import { supabase } from './supabase'
import { loadOrCreateWorkspace, saveWorkspaceData, type CloudWorkspace } from './cloudWorkspace'
import type { Session } from '@supabase/supabase-js'

const brandPalette = [{ name: 'Forest', hex: '#285b40' }, { name: 'Sage', hex: '#84a187' }, { name: 'Ivory', hex: '#f4f0e6' }, { name: 'Ink', hex: '#202a22' }]

const navSections = [
  { label: 'WORKSPACE', items: [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Reviews', icon: FileCheck2 }, { name: 'Brand Brain', icon: BookOpen }, { name: 'Governance Radar', icon: Activity }] },
]

type WorkspaceAppProps = { initialData: AssayData; workspace: CloudWorkspace; userEmail: string; syncStatus: 'saved' | 'saving' | 'error'; onDataChange: (data: AssayData) => void; onSignOut: () => void }

function WorkspaceApp({ initialData, workspace, userEmail, syncStatus, onDataChange, onSignOut }: WorkspaceAppProps) {
  const canManageBrandBrain = ['admin', 'brand_reviewer', 'legal_reviewer'].includes(workspace.role)
  const [reviews, setReviews] = useState<Review[]>(() => initialData.reviews.map((review) => ({ ...review, findings: [...runDeterministicChecks(review.content, initialData.rules, initialData.claims, new Date().toISOString().slice(0, 10)), ...(review.image ? checkImageMetadata(review.image, brandPalette) : [])], intent: review.intent || 'Keep the message warm, clear, and optimistic.' })))
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
  const [claimExpiry, setClaimExpiry] = useState('')
  const [intent, setIntent] = useState('Keep the message warm, clear, and optimistic.')
  const [suggestionChecks, setSuggestionChecks] = useState<Finding[]>([])
  const [reviewerRole] = useState<ReviewerRole>(workspace.role === 'creator' ? 'Creator' : workspace.role === 'manager' ? 'Manager' : workspace.role === 'legal_reviewer' ? 'Legal reviewer' : workspace.role === 'brand_reviewer' ? 'Brand reviewer' : 'Admin')
  const [commentText, setCommentText] = useState('')
  const [passportOpen, setPassportOpen] = useState(false)
  const [revisionOpen, setRevisionOpen] = useState(false)
  const imageBusy = false
  const [regressionText, setRegressionText] = useState('')
  const [regressionResults, setRegressionResults] = useState<{ reviewId: string; title: string; added: Finding[] }[] | null>(null)
  const [backupInput, setBackupInput] = useState<HTMLInputElement | null>(null)
  const [now] = useState(() => new Date())
  const active = reviews.find((review) => review.id === activeId) ?? reviews[0] ?? { id: '', title: '', channel: '', owner: userEmail, initials: userEmail.slice(0, 2).toUpperCase(), time: '', status: 'Draft', findings: [], content: '' }
  const today = now.toISOString().slice(0, 10)
  const radar = useMemo(() => buildRadar(reviews), [reviews])
  const visibleReviews = useMemo(() => reviews.filter((review) => {
    const matchesSearch = `${review.title} ${review.owner} ${review.channel}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === 'All reviews' || (filter === 'Needs review' ? review.status === 'Needs review' : review.status === filter)
    return matchesSearch && matchesFilter
  }), [reviews, filter, query])

  function persist(nextReviews = reviews, nextRules = rules, nextClaims = claims) {
    const changed = <T extends { id: string }>(before: T[], after: T[], fields: (keyof T)[]) => after.filter((item) => {
      const previous = before.find((record) => record.id === item.id)
      return !previous || fields.some((field) => previous[field] !== item[field])
    })
    const data: AssayData = {
      reviews: changed(reviews, nextReviews, ['title', 'channel', 'content', 'status', 'riskTier']),
      rules: changed(rules, nextRules, ['category', 'label', 'description', 'source', 'status', 'severity', 'active', 'matchText']),
      claims: changed(claims, nextClaims, ['statement', 'evidence', 'owner', 'reviewDate', 'expiryDate', 'active']),
    }
    onDataChange(data)
  }

  function event(action: string, detail: string, role = reviewerRole): ReviewEvent {
    return { id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, actor: userEmail, role, action, detail, createdAt: new Date().toISOString() }
  }

  function updateReview(reviewId: string, updater: (review: Review) => Review) {
    setReviews((current) => {
      const next = current.map((review) => review.id === reviewId ? updater(review) : review)
      persist(next)
      return next
    })
  }

  function refreshReview(review: Review, nextRules = rules, nextClaims = claims) {
    const imageFindings = review.image ? checkImageMetadata(review.image, brandPalette) : []
    const nextReview = { ...review, findings: [...runDeterministicChecks(review.content, nextRules, nextClaims, today), ...imageFindings] }
    const nextReviews = reviews.map((item) => item.id === review.id ? nextReview : item)
    setReviews(nextReviews)
    persist(nextReviews, nextRules, nextClaims)
  }

  function recordRevision(review: Review, label: string): ReviewRevision {
    return { id: `rev-${Date.now()}`, content: review.content, findings: review.findings, createdAt: new Date().toISOString(), author: userEmail, label }
  }

  function updateFinding(reviewId: string, findingId: string, resolution: string) {
    setReviews((current) => {
      const next = current.map((review) => review.id === reviewId ? (() => {
        const finding = review.findings.find((item) => item.id === findingId)
        const actionEvent = event(resolution, finding?.title ?? 'Finding updated')
        return { ...review, findings: review.findings.filter((item) => item.id !== findingId), events: [actionEvent, ...(review.events ?? [])] }
      })() : review)
      persist(next)
      return next
    })
    setNotice(resolution)
    window.setTimeout(() => setNotice(''), 2600)
  }

  function approveReview() {
    if (active.findings.some((finding) => finding.level !== 'Clear')) {
      setNotice('Resolve or dismiss the open findings before approval.')
      window.setTimeout(() => setNotice(''), 3000)
      return
    }
    setReviews((current) => {
      const next = current.map((review) => review.id === active.id ? { ...review, status: 'Approved', passportCreatedAt: new Date().toISOString(), events: [event('Approved', `Approved by ${userEmail}`), ...(review.events ?? [])] } : review)
      persist(next)
      return next
    })
    setNotice(`${active.title} approved. Review passport created.`)
    window.setTimeout(() => setNotice(''), 3200)
  }

  function submitReview() {
    if (!draft.trim()) return
    const nextId = crypto.randomUUID()
    const newReview: Review = {
      id: nextId, title: 'New content submission', channel: 'Social · Draft', owner: userEmail, initials: userEmail.slice(0, 2).toUpperCase(), time: 'Just now', status: 'Needs review', reviewer: 'Brand reviewer', riskTier: 'Standard', comments: [], events: [event('Submitted', 'Draft submitted for brand review', 'Creator')], revisions: [],
      content: draft.trim(),
      findings: runDeterministicChecks(draft.trim(), rules, claims, today),
    }
    setReviews((current) => {
      const next = [newReview, ...current]
      persist(next)
      return next
    })
    setActiveId(newReview.id)
    setDraft('')
    setNotice(newReview.findings.length ? `${newReview.findings.length} deterministic check${newReview.findings.length === 1 ? '' : 's'} found. Review the evidence below.` : 'No deterministic issues found.')
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
    if (!canManageBrandBrain || !claimText.trim() || !claimEvidence.trim() || !claimExpiry) return
    const claim: ApprovedClaim = { id: crypto.randomUUID(), statement: claimText.trim(), evidence: claimEvidence.trim(), owner: userEmail, reviewDate: today, expiryDate: claimExpiry, active: true }
    const next = [...claims, claim]
    setClaims(next)
    setClaimText('')
    setClaimEvidence('')
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
    const next = rules.map((rule) => rule.id === ruleId ? { ...rule, status: 'Approved' as const } : rule)
    setRules(next)
    refreshReview(active, next, claims)
  }

  function toggleClaim(claimId: string) {
    if (!canManageBrandBrain) return
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
    const nextReview = { ...active, content: suggestion, findings: [...runDeterministicChecks(suggestion, rules, claims, today), ...(active.image ? checkImageMetadata(active.image, brandPalette) : []), ...active.findings.filter((finding) => finding.origin === 'ai')], revisions: [revision, ...(active.revisions ?? [])], events: [event('Edited', 'Accepted an optional suggested edit'), ...(active.events ?? [])] }
    const nextReviews = reviews.map((review) => review.id === active.id ? nextReview : review)
    setReviews(nextReviews)
    persist(nextReviews)
    setSuggestionChecks([])
    setNotice('Suggestion applied and deterministic checks rerun.')
    window.setTimeout(() => setNotice(''), 3000)
  }

  async function attachImage(file?: File) {
    if (!file) return
    setNotice('Image reviews are unavailable until private Supabase Storage and signed URLs are configured.')
    window.setTimeout(() => setNotice(''), 4000)
  }

  function updateImageAlt(altText: string) {
    if (!active.image) return
    const image = { ...active.image, altText }
    const imageFindings = checkImageMetadata(image, brandPalette)
    const nextReview = { ...active, image, findings: [...active.findings.filter((finding) => !finding.id.startsWith('image-')), ...imageFindings] }
    const nextReviews = reviews.map((review) => review.id === active.id ? nextReview : review)
    setReviews(nextReviews)
    persist(nextReviews)
  }

  function routeForReview() {
    const highRisk = active.findings.some((finding) => finding.level === 'Needs review' || /CLAIM|DISCLOSURE/.test(finding.type))
    const assigned = highRisk ? 'Legal reviewer' : 'Manager'
    updateReview(active.id, (review) => ({ ...review, reviewer: assigned, riskTier: highRisk ? 'High' : 'Low', status: 'In review', events: [event('Routed', `Assigned to ${assigned}; ${highRisk ? 'high risk' : 'low risk'} review`), ...(review.events ?? [])] }))
    setNotice(`Routed to ${assigned}.`)
    window.setTimeout(() => setNotice(''), 2600)
  }

  function addComment() {
    if (!commentText.trim()) return
    const comment = { id: `comment-${Date.now()}`, author: userEmail, role: reviewerRole, text: commentText.trim(), createdAt: new Date().toISOString() }
    updateReview(active.id, (review) => ({ ...review, comments: [comment, ...(review.comments ?? [])], events: [event('Commented', comment.text.slice(0, 100)), ...(review.events ?? [])] }))
    setCommentText('')
  }

  function requestChanges() {
    updateReview(active.id, (review) => ({ ...review, status: 'Changes requested', revisions: [recordRevision(review, 'Before changes requested'), ...(review.revisions ?? [])], events: [event('Changes requested', 'Reviewer requested a revision'), ...(review.events ?? [])] }))
    setNotice('Changes requested. The creator can revise and resubmit.')
    window.setTimeout(() => setNotice(''), 3000)
  }

  function exportPassport() {
    const passport = {
      product: 'Assay', reviewId: active.id, title: active.title, channel: active.channel, status: active.status,
      submittedBy: active.owner, assignedReviewer: active.reviewer ?? 'Unassigned', riskTier: active.riskTier ?? 'Not assessed',
      content: active.content, image: active.image ? { ...active.image, dataUrl: '[omitted from text export; image remains local to this browser]' } : undefined, ruleSetVersion: 'v1.0', findings: active.findings, comments: active.comments ?? [],
      decisions: active.events ?? [], revisions: (active.revisions ?? []).map(({ id, author, label, createdAt, content }) => ({ id, author, label, createdAt, content })),
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
        claims: canManageBrandBrain ? nextData.claims.map((claim) => ({ ...claim, id: crypto.randomUUID() })) : [],
      }
      setReviews((current) => [...imported.reviews, ...current])
      if (canManageBrandBrain) {
        setRules((current) => [...imported.rules, ...current])
        setClaims((current) => [...imported.claims, ...current])
      }
      onDataChange(imported)
      setActiveId(imported.reviews[0]?.id ?? '')
      setActiveNav('Reviews')
      setNotice(canManageBrandBrain ? 'Supported records imported to the workspace.' : 'Reviews imported. Brand rules and claims require a reviewer role.')
    } catch {
      setNotice('That file is not a valid Assay workspace backup.')
    }
    window.setTimeout(() => setNotice(''), 3200)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setActiveNav('Overview')}><span className="brand-mark">A</span><span>assay<span className="brand-period">.</span></span></a>
        <button className="workspace-switch"><span className="workspace-avatar">N</span><span className="workspace-copy"><strong>{workspace.name}</strong><small>Brand workspace</small></span><ChevronDown size={15} /></button>
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

          {activeNav === 'Settings' ? <section className="brandbrain-section"><div className="section-heading"><div><h2>Workspace settings</h2><p>Manage your signed-in’s workspace and backup files.</p></div></div><div className="brain-card backup-card"><div className="brain-card-head"><div><span className="brain-overline">WORKSPACE DATA</span><h3>Backup and restore</h3></div><span className="local-data-badge"><ShieldCheck size={13} /> Synced workspace</span></div><p>Assay stores supported reviews, rules, and claims in this authenticated workspace. A downloaded backup is a separate JSON file.</p><div className="backup-actions"><button className="primary-button" onClick={exportWorkspaceBackup}><Download size={14} /> Download workspace backup</button><button className="secondary-button" onClick={() => backupInput?.click()}><FileText size={14} /> Import backup</button><input ref={setBackupInput} type="file" accept="application/json,.json" hidden onChange={(event) => { void restoreWorkspaceBackup(event.target.files?.[0]); event.currentTarget.value = '' }} /></div><div className="backup-note"><ShieldCheck size={14} /> Backups can contain submitted copy, review history, and attached image data. Store them with the same care as the workspace.</div><div className="backup-limit">Imports add core review, rule, and claim records. Images, comments, decisions, and revision history are not imported.</div></div></section> : activeNav === 'Brand Brain' ? <section className="brandbrain-section"><div className="section-heading"><div><h2>Brand Brain <span className="muted-count">{rules.filter((rule) => rule.status === 'Approved').length} approved rules</span></h2><p>Your team’s source of truth. Draft rules stay out of checks until approved.</p></div>{canManageBrandBrain && <div className="brandbrain-actions"><button className="secondary-button" onClick={() => setShowClaimForm((shown) => !shown)}><Plus size={14} /> Add approved claim</button><button className="primary-button" onClick={() => setShowRuleForm((shown) => !shown)}><Plus size={15} /> Add rule</button></div>}</div>
            <div className="regression-panel"><div><span className="brain-overline">RULE REGRESSION PREVIEW</span><h3>Check a proposed term against saved reviews</h3><p>Preview a simple phrase match locally before adding it. This does not change the rule set.</p></div><div className="regression-form"><input aria-label="Phrase to preview" placeholder="Enter a phrase, such as ‘clinically proven’" value={regressionText} onChange={(event) => { setRegressionText(event.target.value); setRegressionResults(null) }} onKeyDown={(event) => { if (event.key === 'Enter' && regressionText.trim()) previewRuleRegression() }} /><button className="secondary-button" disabled={!regressionText.trim()} onClick={previewRuleRegression}><Search size={14} /> Preview impact</button></div>{regressionResults && <div className="regression-results" aria-live="polite"><strong>{regressionResults.reduce((sum, item) => sum + item.added.length, 0)} new match{regressionResults.reduce((sum, item) => sum + item.added.length, 0) === 1 ? '' : 'es'} across {regressionResults.length} review{regressionResults.length === 1 ? '' : 's'}</strong>{regressionResults.length ? regressionResults.map((item) => <div className="regression-result" key={item.reviewId}><span>{item.title}</span><small>{item.added.map((finding) => `“${finding.excerpt}”`).join(', ')}</small></div>) : <p>No matches in saved review copy.</p>}<small>Preview uses the current local review set and only the basic phrase matcher. It is not a full rule quality evaluation.</small></div>}</div>
            <div className="brandbrain-content"><div className="brain-card"><div className="brain-card-head"><div><span className="brain-overline">GOVERNANCE RULES</span><h3>Brand rules</h3></div><span className="version-pill">Rule set v1.0</span></div>{showRuleForm && <div className="inline-create"><input autoFocus placeholder="e.g. Avoid urgency language in customer emails" value={ruleText} onChange={(event) => setRuleText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addRule() }} /><button onClick={addRule}>Save draft</button><button className="cancel-create" onClick={() => setShowRuleForm(false)}>Cancel</button></div>}<div className="rule-list">{rules.map((rule) => <div className={`rule-row ${!rule.active ? 'inactive-row' : ''}`} key={rule.id}><span className={`rule-severity ${rule.severity.toLowerCase()}`} /><div className="rule-copy"><div className="rule-title-line"><strong>{rule.label}</strong><span className={`rule-status ${rule.status.toLowerCase()}`}>{rule.status}</span></div><p>{rule.description}</p><span className="rule-source"><BookOpen size={12} />{rule.id} · {rule.source}</span></div><div className="rule-controls">{rule.status === 'Draft' ? <button className="approve-rule" onClick={() => approveRule(rule.id)}><Check size={13} /> Approve</button> : <button className={`toggle-switch ${rule.active ? 'on' : ''}`} onClick={() => toggleRule(rule.id)} aria-label={rule.active ? 'Deactivate rule' : 'Activate rule'}><span /></button>}</div></div>)}</div><div className="brain-footer"><ShieldCheck size={14} /> Only approved and active rules are used by deterministic checks.</div></div>
              <div className="brain-card claims-card"><div className="brain-card-head"><div><span className="brain-overline">APPROVED EVIDENCE</span><h3>Claims Vault</h3></div><span className="claim-count">{claims.filter((claim) => claim.active).length} claims</span></div>{showClaimForm && <div className="claim-create"><input autoFocus placeholder="Approved claim or fact" value={claimText} onChange={(event) => setClaimText(event.target.value)} /><input placeholder="Evidence or proof link" value={claimEvidence} onChange={(event) => setClaimEvidence(event.target.value)} /><label>Expires<input type="date" value={claimExpiry} onChange={(event) => setClaimExpiry(event.target.value)} /></label><button onClick={addClaim} disabled={!claimText.trim() || !claimEvidence.trim() || !claimExpiry}>Save</button><button className="cancel-create" onClick={() => setShowClaimForm(false)}>Cancel</button></div>}<div className="claim-list">{claims.map((claim) => { const expired = Boolean(claim.expiryDate) && claim.expiryDate < today; return <div className={`claim-row ${!claim.active ? 'inactive-row' : ''}`} key={claim.id}><div className="claim-row-top"><strong>{claim.statement}</strong><span className={`claim-status ${expired ? 'expired' : 'current'}`}>{expired ? 'Expired' : 'Current'}</span></div><div className="claim-evidence"><BookOpen size={12} />{claim.evidence}</div><div className="claim-meta"><span>Owner · {claim.owner}</span><span>Expires · {claim.expiryDate ? new Date(`${claim.expiryDate}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'Not set'}</span></div><button className={`claim-toggle ${claim.active ? '' : 'restore'}`} onClick={() => toggleClaim(claim.id)}>{claim.active ? 'Archive' : 'Restore'}</button></div> })}</div><div className="brain-footer"><Clock3 size={14} /> Expired claims remain visible and are flagged when matched.</div></div>
            </div><div className="brain-notice"><Sparkles size={15} /><span>Rule extraction from uploaded brand guides is planned next. Add and approve rules manually for now.</span></div>
          </section> : activeNav === 'Governance Radar' ? <RadarView radar={radar} onFocusReview={(reviewId) => { setActiveNav('Reviews'); setActiveId(reviewId) }} /> : <section className="review-section">
            {reviews.length === 0 ? <div className="empty-workspace"><span className="placeholder-icon"><FileText size={21} /></span><h2>Start your workspace with real content</h2><p>Paste a submission below. Assay will check it against the rules and evidence you add to Brand Brain.</p><div className="draft-box"><label className="draft-label" htmlFor="draft-input"><FileText size={15} /><span>NEW CONTENT SUBMISSION</span></label><div className="draft-input-row"><input id="draft-input" placeholder="Paste content to review…" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitReview() }} /><button className="draft-submit" onClick={submitReview} aria-label="Create review"><ArrowRight size={16} /></button></div></div></div> : <>
            <div className="section-heading"><div><h2>Content reviews <span className="muted-count">{reviews.length}</span></h2><p>Review with the right context, not another round of guesswork.</p></div><button className="secondary-button" disabled title="Filters are not enabled yet"><Filter size={15} /> Filters</button></div>
            <div className="review-layout">
              {activeNav === 'Reviews' ? <><div className="queue-panel">
                <div className="queue-toolbar"><label className="search-box"><Search size={15} /><input aria-label="Search reviews" placeholder="Search reviews..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="icon-button subtle" aria-label="More queue options"><MoreHorizontal size={18} /></button></div>
                <div className="filter-tabs">{['All reviews', 'Needs review', 'In review', 'Approved'].map((item) => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>
                <div className="queue-list">{visibleReviews.map((review) => <button key={review.id} className={`queue-card ${activeId === review.id ? 'selected' : ''}`} onClick={() => setActiveId(review.id)}><div className="queue-card-top"><span className={`status-dot ${review.status === 'Approved' ? 'ok' : review.status === 'In review' ? 'reviewing' : ''}`} /><span className="queue-status">{review.status}</span><span className="queue-time">{review.time}</span></div><strong className="queue-title">{review.title}</strong><div className="queue-meta"><span><Globe2 size={13} />{review.channel}</span><span className="queue-owner"><span className="mini-avatar">{review.initials}</span>{review.owner}</span></div><div className="queue-card-bottom"><span className="finding-count">{review.findings.filter((finding) => finding.level !== 'Clear').length} findings</span><span className="queue-id">{review.id}</span></div></button>)}{visibleReviews.length === 0 && <div className="empty-state">No reviews match. Try another search or filter.</div>}</div>
              </div></> : <div className="placeholder-panel"><span className="placeholder-icon">{activeNav === 'Overview' ? <LayoutDashboard size={21} /> : activeNav === 'Governance Radar' ? <Activity size={21} /> : <Users2 size={21} />}</span><h2>{activeNav}</h2><p>{activeNav === 'Governance Radar' ? 'Insights will populate from resolved findings, reviewer feedback, and rule history.' : activeNav === 'Assay Guild' ? 'Playbooks, verified expert profiles, and intro requests will connect to real review patterns in a later phase.' : 'Your overview will grow from the workspace’s real review and approval activity.'}</p><span className="coming-soon">PLANNED FOR A LATER PHASE</span></div>}

              {activeNav === 'Reviews' && <div className="detail-panel">
                <div className="detail-header"><div><div className="detail-kicker"><FileText size={14} /> {active.id} <span>·</span> Submitted {active.time}</div><h2>{active.title}</h2><div className="detail-byline"><span className="mini-avatar larger">{active.initials}</span><span>Submitted by <strong>{active.owner}</strong></span><span className="byline-divider" /><span>{active.channel}</span></div></div><button className="icon-button subtle" aria-label="More review actions"><MoreHorizontal size={19} /></button></div>
                <div className="brain-notice"><ShieldCheck size={15} /><span>Phase 1 stores review text, rules, and claims. Findings are local deterministic previews; decisions, comments, routing, revisions, and passports are not saved yet.</span></div>
                <div className="detail-actions"><label className="intent-field"><span>Creator intent (not saved yet)</span><input disabled value={active.intent ?? intent} aria-label="Creator intent" /></label><button className="primary-button approve-button" onClick={approveReview} disabled title="Approval workflow is not enabled yet"><Check size={16} /> Approval in Phase 5</button></div>
                <div className="workflow-strip"><span className={`risk-badge ${(active.riskTier ?? 'Standard').toLowerCase()}`}><ShieldCheck size={13} /> {active.riskTier ?? 'Risk not routed'}</span><span><Route size={13} /> {active.reviewer ?? 'No reviewer assigned'}</span><button disabled onClick={routeForReview}><ArrowRight size={13} /> Routing in Phase 5</button><button disabled onClick={() => setRevisionOpen((open) => !open)}><History size={13} /> History (Phase 5)</button><button disabled onClick={() => setPassportOpen(true)}><FileCheck2 size={13} /> Passport (Phase 5)</button></div>
                <div className="finding-summary"><div><span className="summary-number">{active.findings.filter((finding) => finding.level === 'Needs review').length}</span><span>needs review</span></div><div className="summary-separator" /><div><span className="summary-number watch-number">{active.findings.filter((finding) => finding.level === 'Watch').length}</span><span>to consider</span></div><div className="summary-spacer" /><span className="source-assurance"><ShieldCheck size={15} /> Evidence linked</span></div>
                <ImageAttachment image={active.image} busy={imageBusy} onFile={attachImage} onAlt={updateImageAlt} onRemove={() => { const nextReviews = reviews.map((review) => review.id === active.id ? { ...review, image: undefined, findings: review.findings.filter((finding) => finding.origin !== 'image') } : review); setReviews(nextReviews); persist(nextReviews) }} />
                <div className="findings-list">{active.findings.map((finding) => <FindingCard key={finding.id} finding={finding} onResolve={(action) => updateFinding(active.id, finding.id, `${action}: ${finding.title}`)} onPreviewSuggestion={previewSuggestion} onAcceptSuggestion={acceptSuggestion} decisionsEnabled={false} />)}{active.findings.length === 0 && <div className="all-clear"><span className="all-clear-icon"><Check size={18} /></span><div><strong>No deterministic flags found</strong><p>This local check is not a final decision or approval.</p></div></div>}</div>
                {suggestionChecks.length > 0 && <div className="suggestion-check-result"><strong>Fix check found {suggestionChecks.length} issue{suggestionChecks.length === 1 ? '' : 's'}:</strong>{suggestionChecks.map((finding) => <span key={finding.id}>{finding.title}</span>)}</div>}
                {revisionOpen && <div className="history-panel"><div className="panel-title"><History size={14} /> Revision history</div>{(active.revisions ?? []).length ? active.revisions?.map((revision) => <div className="history-entry" key={revision.id}><div><strong>{revision.label}</strong><span>{revision.author} · {new Date(revision.createdAt).toLocaleString()}</span><p>{revision.content}</p></div><button onClick={() => { updateReview(active.id, (review) => ({ ...review, content: revision.content, findings: revision.findings, events: [event('Restored revision', revision.label), ...(review.events ?? [])] })); setNotice('Revision restored.') }}>Restore</button></div>) : <p className="empty-history">No content revisions yet. Accepting a suggested edit will create a snapshot.</p>}</div>}
                <ReviewCollaboration review={active} role={reviewerRole} author={userEmail} commentText={commentText} setCommentText={setCommentText} addComment={addComment} requestChanges={requestChanges} />
                <div className="event-log"><div className="panel-title"><FileClock size={14} /> Session activity · not saved</div><p className="empty-history">Server audit history is planned for Phase 5.</p></div>
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
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspaceAttempt, setWorkspaceAttempt] = useState(0)
  const [workspaceError, setWorkspaceError] = useState('')
  const [syncStatus, setSyncStatus] = useState<'saved' | 'saving' | 'error'>('saved')
  const saveQueue = useRef<Promise<void>>(Promise.resolve())
  const saveTimer = useRef<number | undefined>(undefined)

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
      setWorkspaceError('')
    })
    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!session || !supabase) { setWorkspace(null); return }
    let alive = true
    setWorkspaceLoading(true)
    loadOrCreateWorkspace(session.user).then((loaded) => {
      if (!alive) return
      setWorkspace(loaded)
      setWorkspaceError('')
    }).catch((error: unknown) => {
      if (alive) setWorkspaceError(error instanceof Error ? error.message : 'Could not load your workspace.')
    }).finally(() => { if (alive) setWorkspaceLoading(false) })
    return () => { alive = false }
  }, [session?.user.id, workspaceAttempt])

  useEffect(() => () => { if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current) }, [])

  function persistCloudData(data: AssayData) {
    if (!workspace) return
    setSyncStatus('saving')
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
        if (!session) throw new Error('Sign in to save workspace changes.')
        await saveWorkspaceData(workspace.id, session.user.id, data)
        setSyncStatus('saved')
      }).catch((error: unknown) => {
        console.error('Workspace sync failed', error)
        setSyncStatus('error')
      })
    }, 450)
  }

  async function signOut() {
    clearLegacyWorkspaceMirror()
    await supabase?.auth.signOut()
  }

  if (!supabase) return <SetupRequired />
  if (!authReady) return <StartupScreen message="Checking your sign-in…" />
  if (!session) return <AuthScreen />
  if (workspaceError && !workspace) return <StartupError message={workspaceError} onRetry={() => setWorkspaceAttempt((attempt) => attempt + 1)} onSignOut={signOut} />
  if (workspaceLoading || !workspace) return <StartupScreen message="Loading your private workspace…" />
  return <WorkspaceApp key={workspace.id} initialData={workspace.data} workspace={workspace} userEmail={session.user.email ?? 'Signed-in user'} syncStatus={syncStatus} onDataChange={persistCloudData} onSignOut={signOut} />
}

function SetupRequired() {
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark">A</span><strong>assay<span className="brand-period">.</span></strong></div><span className="brain-overline">DEPLOYMENT SETUP REQUIRED</span><h1>Connect your workspace database</h1><p>Assay is configured for authenticated Supabase workspaces. Add the project URL and publishable key to Vercel’s environment settings, then redeploy.</p><div className="env-instructions"><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_PUBLISHABLE_KEY</code></div><small>The publishable key is designed for browser use. Never add a service-role or secret key to a VITE_ variable.</small></section></main>
}

function AuthScreen() {
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
        const { data, error: authError } = await supabase.auth.signUp({ email: email.trim(), password })
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

  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark">A</span><strong>assay<span className="brand-period">.</span></strong></div><span className="brain-overline">PRIVATE BRAND WORKSPACE</span><h1>{signUp ? 'Create your account' : 'Sign in to Assay'}</h1><p>Reviews and brand rules are stored in your authenticated workspace.</p><form onSubmit={submit}><label>Email<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete={signUp ? 'new-password' : 'current-password'} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : signUp ? 'Create account' : 'Sign in'}</button></form>{error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-message" role="status">{message}</p>}<button className="auth-toggle" onClick={() => { setSignUp((value) => !value); setError(''); setMessage('') }}>{signUp ? 'Already registered? Sign in' : 'New to Assay? Create an account'}</button><small>New accounts may need email confirmation, depending on the Supabase Auth settings.</small></section></main>
}

function StartupScreen({ message }: { message: string }) {
  return <main className="auth-shell"><section className="auth-card startup-card"><div className="auth-brand"><span className="brand-mark">A</span><strong>assay<span className="brand-period">.</span></strong></div><p>{message}</p></section></main>
}

function StartupError({ message, onRetry, onSignOut }: { message: string; onRetry: () => void; onSignOut: () => void }) {
  return <main className="auth-shell"><section className="auth-card"><div className="auth-brand"><span className="brand-mark">A</span><strong>assay<span className="brand-period">.</span></strong></div><h1>Workspace unavailable</h1><p className="auth-error">{message}</p><button className="primary-button" onClick={onRetry}>Try again</button><button className="auth-toggle" onClick={onSignOut}>Sign out</button></section></main>
}

function Metric({ label, value, detail, icon, tone }: { label: string; value: string; detail: React.ReactNode; icon: React.ReactNode; tone: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><div className="metric-value">{value}</div><div className={`metric-detail ${tone}`}>{detail}</div></div>
}

function FindingCard({ finding, onResolve, onPreviewSuggestion, onAcceptSuggestion, decisionsEnabled }: { finding: Finding; onResolve: (action: string) => void; onPreviewSuggestion: (suggestion: string) => void; onAcceptSuggestion: (suggestion: string) => void; decisionsEnabled: boolean }) {
  const [expanded, setExpanded] = useState(finding.level !== 'Clear')
  const [showSuggestion, setShowSuggestion] = useState(false)
  return <article className={`finding-card ${finding.level === 'Clear' ? 'clear-card' : ''}`}><button className="finding-head" onClick={() => setExpanded((open) => !open)}><span className={`finding-indicator ${finding.level === 'Needs review' ? 'risk' : finding.level === 'Watch' ? 'watch' : 'clear'}`}>{finding.level === 'Clear' ? <Check size={14} /> : <span />}</span><span className="finding-main"><span className="finding-type">{finding.type}{finding.origin === 'ai' && finding.confidence !== undefined ? ` · ${Math.round(finding.confidence * 100)}% CONFIDENCE` : ''}</span><strong>{finding.title}</strong></span><span className={`finding-state ${finding.level === 'Needs review' ? 'risk-text' : finding.level === 'Watch' ? 'watch-text' : 'clear-text'}`}>{finding.level}</span><ChevronDown className={expanded ? 'chevron open' : 'chevron'} size={16} /></button>{expanded && <div className="finding-body"><div className="quoted-text">{finding.excerpt}</div><p className="finding-note">{finding.note}</p><div className="source-line"><BookOpen size={14} /><span>{finding.source}</span><button aria-label="Open source details" onClick={() => setShowSuggestion((shown) => !shown)}><ArrowRight size={14} /></button></div>{showSuggestion && <div className="suggestion-preview"><Sparkles size={14} />Suggested next step: review the source with your brand owner before publishing.</div>}{finding.suggestion && <div className="rewrite-box"><div className="rewrite-title"><WandSparkles size={14} /><strong>Rewrite preview (local)</strong></div><p>{finding.suggestion}</p><div className="rewrite-actions"><button className="suggest-button" disabled={!decisionsEnabled} onClick={() => { onPreviewSuggestion(finding.suggestion!); setShowSuggestion(true) }}>Check this edit</button><button className="resolve-button" disabled={!decisionsEnabled} onClick={() => onAcceptSuggestion(finding.suggestion!)}><Check size={13} /> Accept edit</button></div></div>}{decisionsEnabled && <div className="finding-actions"><button className="suggest-button" onClick={() => setShowSuggestion((shown) => !shown)}><WandSparkles size={14} /> {finding.suggestion ? 'Review guidance' : 'Suggest a fix'}</button><button className="resolve-button" onClick={() => onResolve(finding.level === 'Clear' ? 'Confirmed' : 'Resolved')}><Check size={14} /> {finding.level === 'Clear' ? 'Looks good' : 'Mark resolved'}</button><button className="dismiss-button" onClick={() => onResolve('Dismissed')} aria-label="Dismiss finding">Dismiss</button></div>}</div>}</article>
}

function ReviewCollaboration({ review, role, author, commentText, setCommentText, addComment, requestChanges }: { review: Review; role: ReviewerRole; author: string; commentText: string; setCommentText: (value: string) => void; addComment: () => void; requestChanges: () => void }) {
  return <section className="collaboration-panel"><div className="panel-title"><MessageSquare size={14} /> Collaboration (Phase 5) <span>{review.comments?.length ?? 0}</span></div><div className="comment-compose"><textarea disabled value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Comments will be enabled with shared review history." rows={2} /><div className="comment-compose-foot"><span>Signed in as {author} · {role}</span><div><button className="request-changes-button" disabled onClick={requestChanges}>Request changes</button><button className="post-comment-button" disabled onClick={addComment}><Send size={13} /> Comment</button></div></div></div>{(review.comments ?? []).map((comment) => <div className="comment-row" key={comment.id}><span className="comment-avatar">{comment.author.split(' ').map((part) => part[0]).join('')}</span><div><div className="comment-byline"><strong>{comment.author}</strong><span>{comment.role}</span><time>{new Date(comment.createdAt).toLocaleString()}</time></div><p>{comment.text}</p></div></div>)}</section>
}

function PassportModal({ review, onClose, onExport }: { review: Review; onClose: () => void; onExport: () => void }) {
  const resolved = review.events?.filter((item) => ['Resolved', 'Dismissed', 'Confirmed'].some((action) => item.action.includes(action))).length ?? 0
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="passport-modal" role="dialog" aria-modal="true" aria-labelledby="passport-title" onClick={(event) => event.stopPropagation()}><div className="passport-head"><div><span className="passport-mark"><ShieldCheck size={18} /></span><div><div className="brain-overline">PUBLISH READINESS RECORD</div><h2 id="passport-title">Review passport</h2></div></div><button className="icon-button" aria-label="Close passport" onClick={onClose}>×</button></div><div className="passport-status"><span className={`risk-badge ${(review.riskTier ?? 'Standard').toLowerCase()}`}><ShieldCheck size={13} /> {review.status}</span><span>{review.id} · Rule set v1.0</span></div><div className="passport-fields"><div><small>Content</small><strong>{review.title}</strong></div><div><small>Submitted by</small><strong>{review.owner}</strong></div><div><small>Reviewer</small><strong>{review.reviewer ?? 'Not assigned'}</strong></div><div><small>Risk tier</small><strong>{review.riskTier ?? 'Not assessed'}</strong></div><div><small>Findings resolved</small><strong>{resolved} decisions · {review.findings.length} open findings</strong></div><div><small>Rule set version</small><strong>v1.0 · Local workspace</strong></div></div><div className="passport-copy"><small>Reviewed content snapshot</small><p>{review.content}</p></div><div className="passport-disclosure"><ShieldCheck size={14} /> AI review is disabled. This record contains deterministic checks and human decisions; it is not a cryptographic signature.</div><div className="passport-footer"><span>Generated {new Date(review.passportCreatedAt ?? Date.now()).toLocaleString()}</span><button className="primary-button" onClick={onExport}><Download size={14} /> Export JSON</button></div></section></div>
}

function ImageAttachment({ image, busy, onFile, onAlt, onRemove }: { image?: Review['image']; busy: boolean; onFile: (file?: File) => void; onAlt: (value: string) => void; onRemove: () => void }) {
  return <section className="image-attachment"><div className="panel-title"><ImagePlus size={14} /> Campaign image <span className="image-local-label">WORKSPACE DATA</span></div>{image ? <div className="attached-image"><img src={image.dataUrl} alt={image.altText || ''} /><div className="attached-image-details"><div className="image-meta-line"><strong>{image.name}</strong><span>{image.width} × {image.height}px</span><button onClick={onRemove} aria-label="Remove image"><X size={13} /></button></div><label className="alt-input"><span>Alt text</span><input value={image.altText} onChange={(event) => onAlt(event.target.value)} placeholder="Describe the image for someone who cannot see it" /></label><div className="palette-row"><span>Dominant colors</span>{image.palette.slice(0, 5).map((color) => <i key={color} title={color} style={{ backgroundColor: color }} />)}</div><p>Checks cover alt text, image dimensions, and basic palette distance only.</p></div></div> : <label className={`image-drop ${busy ? 'busy' : ''}`}><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { onFile(event.target.files?.[0]); event.currentTarget.value = '' }} /><ImagePlus size={18} /><span>{busy ? 'Inspecting image…' : 'Add a campaign image'}</span><small>PNG, JPG, or WebP · up to 5 MB · stored in your workspace</small></label>}</section>
}

function RadarView({ radar, onFocusReview }: { radar: ReturnType<typeof buildRadar>; onFocusReview: (id: string) => void }) {
  const max = Math.max(1, ...radar.repeated.map((item) => item.count))
  return <section className="radar-page"><div className="radar-intro"><div><span className="brain-overline">LOCAL PREVIEW · PHASE 6</span><h2>Governance Radar</h2><p>Patterns calculated only from this workspace’s saved review records.</p></div><span className="local-data-badge"><Activity size={14} /> {radar.reviewCount} reviews</span></div><div className="radar-stats"><div><small>Open findings</small><strong>{radar.openFindings}</strong><span>Across current reviews</span></div><div><small>Review decisions</small><strong>{radar.resolvedActions}</strong><span>Resolved, dismissed, or confirmed</span></div><div><small>Change requests</small><strong>{radar.changesRequested}</strong><span>Recorded in review history</span></div><div><small>Workflow statuses</small><strong>{Object.keys(radar.statuses).length}</strong><span>Current review states</span></div></div><div className="radar-columns"><div className="radar-card"><div className="radar-card-heading"><div><h3>Recurring findings</h3><p>Grouped by source rule or finding title.</p></div><span className="computed-label">COMPUTED</span></div>{radar.repeated.length ? radar.repeated.slice(0, 6).map((item) => <div className="radar-row" key={item.title}><div className="radar-row-copy"><strong>{item.title}</strong><small>{item.type} · {item.reviewIds.length} affected reviews</small></div><div className="radar-bar-track"><i style={{ width: `${Math.max(12, item.count / max * 100)}%` }} /></div><b>{item.count}</b><button onClick={() => item.reviewIds[0] && onFocusReview(item.reviewIds[0])}>Open</button></div>) : <div className="radar-empty">No open findings in the workspace.</div>}</div><div className="radar-card"><div className="radar-card-heading"><div><h3>Rules to clarify</h3><p>Repeated unresolved findings may be worth reviewing.</p></div><span className="computed-label">HEURISTIC</span></div>{radar.ambiguous.length ? radar.ambiguous.slice(0, 4).map((item) => <div className="clarity-item" key={item.title}><span className="clarity-icon"><Sparkles size={14} /></span><div><strong>{item.title}</strong><p>Appears in {item.count} open findings. This is a review prompt, not proof a guideline is unclear.</p></div></div>) : <div className="radar-empty">Repeated issues will appear after the workspace has review history.</div>}</div></div><div className="radar-disclaimer"><ShieldCheck size={14} /> Radar uses records from this workspace only. It does not compare brands or infer causation.</div></section>
}

export default App
