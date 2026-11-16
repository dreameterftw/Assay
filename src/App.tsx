import { useMemo, useState } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Bell, BookOpen,
  Check, CheckCheck, ChevronDown, CircleHelp, Clock3, FileCheck2,
  FileText, Filter, Globe2, LayoutDashboard, MoreHorizontal, Plus,
  Search, Settings2, ShieldCheck, Sparkles, Users2, WandSparkles, MessageSquare, History, Download, Send, FileClock, Route, ImagePlus, X, Compass, ExternalLink,
} from 'lucide-react'
import { loadAssayData, saveAssayData, type AssayData } from './storage'
import { runDeterministicChecks } from './checks'
import { validateSuggestion, runAiReview, type ReviewProvider } from './aiReview'
import type { Review, BrandRule, ApprovedClaim, Finding, ReviewerRole, ReviewEvent, ReviewRevision } from './types'
import { checkImageMetadata, inspectImage } from './imageChecks'
import { buildRadar } from './insights'

const initialReviews: Review[] = [
  {
    id: 'RV-2048', title: 'Spring launch — social copy', channel: 'Instagram · Campaign', owner: 'Maya Chen', initials: 'MC', time: '12 min ago', status: 'Needs review',
    content: 'Meet the new way to feel your best. Trusted by 10,000+ customers, our Spring collection is 50% faster to ship. Shop now and see why we’re the #1 choice for everyday care.',
    findings: [
      { id: 'f1', level: 'Needs review', type: 'CLAIM · HIGH RISK', title: 'Customer count is out of date', excerpt: '“Trusted by 10,000+ customers”', source: 'Approved fact · 8,200 customers (reviewed 12 Sep)', note: 'The submitted number exceeds the latest approved figure. Ask for updated evidence or use the verified value.' },
      { id: 'f2', level: 'Needs review', type: 'CLAIM · HIGH RISK', title: '“50% faster” has no approved evidence', excerpt: '“50% faster to ship”', source: 'Claims Vault · No matching approved claim', note: 'We couldn’t find evidence for this performance claim. It needs a source and legal review before publication.' },
      { id: 'f3', level: 'Watch', type: 'MESSAGING · MEDIUM', title: 'Superlative needs substantiation', excerpt: '“the #1 choice for everyday care”', source: 'Rule B-12 · Substantiate comparative claims', note: 'Comparative language should name its source, market, and date range.' },
      { id: 'f4', level: 'Clear', type: 'TONE · ON BRAND', title: 'Voice matches the channel', excerpt: '“Meet the new way to feel your best.”', source: 'Rule V-03 · Warm, direct, optimistic', note: 'This opening is warm and concise, in line with the approved social voice.' },
    ],
  },
  {
    id: 'RV-2047', title: 'Wellness, without the wait', channel: 'Email · Newsletter', owner: 'Jordan Lee', initials: 'JL', time: '48 min ago', status: 'In review',
    content: 'A calmer start to your morning. Explore our new daily essentials, made with care and designed to fit your routine.',
    findings: [
      { id: 'f5', level: 'Clear', type: 'TONE · ON BRAND', title: 'Voice matches the channel', excerpt: '“A calmer start to your morning.”', source: 'Rule V-03 · Warm, direct, optimistic', note: 'This copy fits the approved tone.' },
      { id: 'f6', level: 'Watch', type: 'TERMINOLOGY · LOW', title: 'Use the preferred product term', excerpt: '“daily essentials”', source: 'Glossary · Prefer “everyday care”', note: 'Use the preferred term to keep product language consistent.' },
    ],
  },
  {
    id: 'RV-2046', title: 'A better routine starts here', channel: 'Web · Landing page', owner: 'Amira Patel', initials: 'AP', time: '2 hr ago', status: 'Approved',
    content: 'Small steps, made simpler. Find the everyday care that works for you.',
    findings: [{ id: 'f7', level: 'Clear', type: 'TONE · ON BRAND', title: 'Copy follows the approved voice', excerpt: '“Small steps, made simpler.”', source: 'Rule V-03 · Warm, direct, optimistic', note: 'No changes needed.' }],
  },
]

const starterRules: BrandRule[] = [
  { id: 'B-01', category: 'Terminology', label: 'Prefer “everyday care”', description: 'Use “everyday care” in customer-facing copy. Avoid “daily essentials”.', source: 'Brand voice guide · Language', status: 'Approved', severity: 'Low', active: true },
  { id: 'B-02', category: 'Terminology', label: 'Avoid “miracle”', description: 'Do not describe products as a “miracle” or imply guaranteed outcomes.', source: 'Brand voice guide · Claims', status: 'Approved', severity: 'High', active: true },
  { id: 'B-03', category: 'Required language', label: 'Include sponsored-post disclosure', description: 'Influencer or paid partnership social posts must include #ad.', source: 'Social publishing policy · Section 4', status: 'Approved', severity: 'High', active: true },
  { id: 'B-04', category: 'Claims', label: 'Substantiate comparative claims', description: 'Superlatives such as “#1” must include an approved source, market, and time period.', source: 'Claims policy · Section 2', status: 'Approved', severity: 'High', active: true },
  { id: 'B-05', category: 'Tone', label: 'Keep the voice warm and direct', description: 'Sound optimistic and helpful. Avoid pressure, fear, or absolute promises.', source: 'Brand voice guide · Voice principles', status: 'Approved', severity: 'Medium', active: true },
]

const starterClaims: ApprovedClaim[] = [
  { id: 'C-101', statement: '8,200 customers', evidence: 'Customer account report · Q3 2026', owner: 'Growth Analytics', reviewDate: '2026-09-12', expiryDate: '2026-12-12', active: true },
  { id: 'C-102', statement: '50% faster to ship', evidence: 'No current evidence · expired pilot claim', owner: 'Operations', reviewDate: '2025-10-01', expiryDate: '2026-01-01', active: true },
  { id: 'C-103', statement: 'Dermatologist tested', evidence: 'Study summary · DT-2026-04', owner: 'Product', reviewDate: '2026-10-03', expiryDate: '2027-04-03', active: true },
]

const brandPalette = [{ name: 'Forest', hex: '#285b40' }, { name: 'Sage', hex: '#84a187' }, { name: 'Ivory', hex: '#f4f0e6' }, { name: 'Ink', hex: '#202a22' }]

const playbooks = [
  { id: 'PB-01', category: 'Claims', title: 'Writing substantiated promotional claims', description: 'A practical checklist for numbers, comparisons, proof sources, owners, and expiry dates.', author: 'Assay Guild editorial', tags: ['Claims', 'Legal review'], related: /CLAIM/i },
  { id: 'PB-02', category: 'Voice', title: 'A usable brand voice checklist', description: 'Turn abstract voice principles into channel-specific examples creators can apply.', author: 'Assay Guild editorial', tags: ['Tone', 'Guidelines'], related: /TONE|VOICE/i },
  { id: 'PB-03', category: 'Accessibility', title: 'Alt text that helps people understand', description: 'Describe the purpose and meaningful information in campaign images without repeating nearby copy.', author: 'Assay Guild editorial', tags: ['Accessibility', 'Images'], related: /ACCESSIBILITY|ALT TEXT/i },
  { id: 'PB-04', category: 'Terminology', title: 'Keeping product language consistent', description: 'A glossary workflow for preferred, restricted, and regional product terms.', author: 'Assay Guild editorial', tags: ['Terminology', 'Brand Brain'], related: /TERMINOLOGY/i },
]

const navSections = [
  { label: 'WORKSPACE', items: [{ name: 'Overview', icon: LayoutDashboard }, { name: 'Reviews', icon: FileCheck2, count: '8' }, { name: 'Brand Brain', icon: BookOpen }, { name: 'Governance Radar', icon: Activity }] },
  { label: 'COMMUNITY', items: [{ name: 'Assay Guild', icon: Users2 }] },
]

function App() {
  const [initialData] = useState(() => loadAssayData(initialReviews, starterRules, starterClaims))
  const [reviews, setReviews] = useState<Review[]>(() => initialData.reviews.map((review) => ({ ...review, findings: [...runDeterministicChecks(review.content, initialData.rules, initialData.claims, new Date().toISOString().slice(0, 10)), ...(review.image ? checkImageMetadata(review.image, brandPalette) : [])], intent: review.intent || 'Keep the message warm, clear, and optimistic.' })))
  const [rules, setRules] = useState(initialData.rules)
  const [claims, setClaims] = useState(initialData.claims)
  const [activeId, setActiveId] = useState('RV-2048')
  const [activeNav, setActiveNav] = useState('Reviews')
  const [filter, setFilter] = useState('All reviews')
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState('')
  const [showRuleForm, setShowRuleForm] = useState(false)
  const [ruleText, setRuleText] = useState('')
  const [showClaimForm, setShowClaimForm] = useState(false)
  const [claimText, setClaimText] = useState('')
  const [claimExpiry, setClaimExpiry] = useState('')
  const [intent, setIntent] = useState('Keep the message warm, clear, and optimistic.')
  const [aiProvider, setAiProvider] = useState<ReviewProvider>('demo')
  const [aiBusy, setAiBusy] = useState(false)
  const [suggestionChecks, setSuggestionChecks] = useState<Finding[]>([])
  const [reviewerRole, setReviewerRole] = useState<ReviewerRole>('Brand reviewer')
  const [commentText, setCommentText] = useState('')
  const [passportOpen, setPassportOpen] = useState(false)
  const [revisionOpen, setRevisionOpen] = useState(false)
  const [imageBusy, setImageBusy] = useState(false)
  const [guildQuery, setGuildQuery] = useState('')
  const [regressionText, setRegressionText] = useState('')
  const [regressionResults, setRegressionResults] = useState<{ reviewId: string; title: string; added: Finding[] }[] | null>(null)
  const [backupInput, setBackupInput] = useState<HTMLInputElement | null>(null)
  const [now] = useState(() => new Date())
  const active = reviews.find((review) => review.id === activeId) ?? reviews[0]
  const today = now.toISOString().slice(0, 10)
  const activeIntent = active.intent || intent
  const radar = useMemo(() => buildRadar(reviews), [reviews])
  const matchingPlaybooks = useMemo(() => {
    const topTypes = radar.repeated.slice(0, 3).map((item) => item.type)
    return playbooks.filter((playbook) => topTypes.some((type) => playbook.related.test(type)))
  }, [radar])
  const filteredPlaybooks = playbooks.filter((playbook) => `${playbook.title} ${playbook.description} ${playbook.tags.join(' ')}`.toLowerCase().includes(guildQuery.toLowerCase()))
  const visibleReviews = useMemo(() => reviews.filter((review) => {
    const matchesSearch = `${review.title} ${review.owner} ${review.channel}`.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === 'All reviews' || (filter === 'Needs review' ? review.status === 'Needs review' : review.status === filter)
    return matchesSearch && matchesFilter
  }), [reviews, filter, query])

  function persist(nextReviews = reviews, nextRules = rules, nextClaims = claims) {
    saveAssayData({ reviews: nextReviews, rules: nextRules, claims: nextClaims })
  }

  function event(action: string, detail: string, role = reviewerRole): ReviewEvent {
    return { id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, actor: role === 'Creator' ? 'Alex Rivera' : 'Alex Rivera', role, action, detail, createdAt: new Date().toISOString() }
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
    return { id: `rev-${Date.now()}`, content: review.content, findings: review.findings, createdAt: new Date().toISOString(), author: 'Alex Rivera', label }
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
      const next = current.map((review) => review.id === active.id ? { ...review, status: 'Approved', passportCreatedAt: new Date().toISOString(), events: [event('Approved', `Approved by Alex Rivera as ${reviewerRole}`), ...(review.events ?? [])] } : review)
      persist(next)
      return next
    })
    setNotice(`${active.title} approved. Review passport created.`)
    window.setTimeout(() => setNotice(''), 3200)
  }

  function submitReview() {
    if (!draft.trim()) return
    const nextId = `RV-${2049 + reviews.length - initialReviews.length}`
    const newReview: Review = {
      id: nextId, title: 'New content submission', channel: 'Social · Draft', owner: 'You', initials: 'YO', time: 'Just now', status: 'Needs review', reviewer: 'Brand reviewer', riskTier: 'Standard', comments: [], events: [event('Submitted', 'Draft submitted for brand review', 'Creator')], revisions: [],
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
    setNotice(newReview.findings.length ? `${newReview.findings.length} deterministic check${newReview.findings.length === 1 ? '' : 's'} found. Review the evidence below.` : 'No deterministic issues found. AI tone checks are not connected yet.')
    window.setTimeout(() => setNotice(''), 2600)
  }

  function addRule() {
    if (!ruleText.trim()) return
    const rule: BrandRule = { id: `B-${String(Date.now()).slice(-4)}`, category: 'Terminology', label: ruleText.trim(), description: ruleText.trim(), source: 'Workspace rule · Added by Alex Rivera', status: 'Draft', severity: 'Medium', active: true, matchText: ruleText.trim() }
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
    if (!claimText.trim() || !claimExpiry) return
    const claim: ApprovedClaim = { id: `C-${String(Date.now()).slice(-4)}`, statement: claimText.trim(), evidence: 'Added in Brand Brain · Evidence pending', owner: 'Alex Rivera', reviewDate: today, expiryDate: claimExpiry, active: true }
    const next = [...claims, claim]
    setClaims(next)
    setClaimText('')
    setClaimExpiry('')
    setShowClaimForm(false)
    persist(reviews, rules, next)
  }

  function toggleRule(ruleId: string) {
    const next = rules.map((rule) => rule.id === ruleId ? { ...rule, active: !rule.active } : rule)
    setRules(next)
    refreshReview(active, next, claims)
  }

  function approveRule(ruleId: string) {
    const next = rules.map((rule) => rule.id === ruleId ? { ...rule, status: 'Approved' as const } : rule)
    setRules(next)
    refreshReview(active, next, claims)
  }

  function toggleClaim(claimId: string) {
    const next = claims.map((claim) => claim.id === claimId ? { ...claim, active: !claim.active } : claim)
    setClaims(next)
    refreshReview(active, rules, next)
  }

  async function runAiForActiveReview() {
    setAiBusy(true)
    setSuggestionChecks([])
    try {
      const findings = await runAiReview({ content: active.content, intent: activeIntent, rules, claims }, aiProvider)
      const existing = new Set(active.findings.map((finding) => `${finding.sourceId}:${finding.excerpt.toLowerCase()}`))
      const unique = findings.filter((finding) => !existing.has(`${finding.sourceId}:${finding.excerpt.toLowerCase()}`))
      setReviews((current) => {
        const next = current.map((review) => review.id === active.id ? { ...review, findings: [...review.findings.filter((finding) => finding.origin !== 'ai'), ...unique] } : review)
        persist(next)
        return next
      })
      setNotice(unique.length ? `${unique.length} grounded AI judgment${unique.length === 1 ? '' : 's'} added.` : 'No grounded AI findings returned for this content.')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'AI review failed. Check your server endpoint.')
    } finally {
      setAiBusy(false)
      window.setTimeout(() => setNotice(''), 3600)
    }
  }

  function previewSuggestion(suggestion: string) {
    const findings = validateSuggestion(suggestion, rules, claims, today).findings
    setSuggestionChecks(findings)
    setNotice(findings.length ? 'This edit still triggers deterministic checks. Review the results before accepting.' : 'No deterministic issues found in this edit. This does not certify tone or factual accuracy.')
    window.setTimeout(() => setNotice(''), 3500)
  }

  function acceptSuggestion(suggestion: string) {
    const revision: ReviewRevision = { id: `rev-${Date.now()}`, content: active.content, findings: active.findings, createdAt: new Date().toISOString(), author: 'Alex Rivera', label: 'Before suggested edit' }
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
    setImageBusy(true)
    try {
      const image = await inspectImage(file)
      const findings = checkImageMetadata(image, brandPalette)
      const nextReview = { ...active, image, findings: [...active.findings.filter((finding) => !finding.id.startsWith('image-')), ...findings], events: [event('Image added', `${image.name} · ${image.width} × ${image.height}px`), ...(active.events ?? [])] }
      const nextReviews = reviews.map((review) => review.id === active.id ? nextReview : review)
      setReviews(nextReviews)
      persist(nextReviews)
      setNotice(`${image.name} added. ${findings.length} basic image check${findings.length === 1 ? '' : 's'} recorded.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not inspect this image.')
    } finally {
      setImageBusy(false)
      window.setTimeout(() => setNotice(''), 3500)
    }
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

  function importPlaybook(playbook: typeof playbooks[number]) {
    const existing = rules.some((rule) => rule.label === playbook.title)
    if (existing) { setNotice('This playbook is already in Brand Brain.'); return }
    const category: BrandRule['category'] = playbook.category === 'Claims' ? 'Claims' : playbook.category === 'Voice' ? 'Tone' : playbook.category === 'Accessibility' ? 'Required language' : 'Terminology'
    const rule: BrandRule = { id: `B-${String(Date.now()).slice(-4)}`, category, label: playbook.title, description: playbook.description, source: `Assay Guild playbook · ${playbook.id}`, status: 'Draft', severity: 'Medium', active: true }
    const nextRules = [...rules, rule]
    setRules(nextRules)
    persist(reviews, nextRules, claims)
    setNotice('Playbook added as a draft rule. Approve it in Brand Brain before it affects reviews.')
    window.setTimeout(() => setNotice(''), 3600)
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
    const comment = { id: `comment-${Date.now()}`, author: 'Alex Rivera', role: reviewerRole, text: commentText.trim(), createdAt: new Date().toISOString() }
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
      aiDisclosure: 'Offline demo mode. No model provider was called for this review.', generatedAt: new Date().toISOString(),
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
      if (backup.product !== 'Assay' || backup.formatVersion !== 1 || !Array.isArray(backup.data?.reviews) || backup.data.reviews.length === 0 || !Array.isArray(backup.data?.rules) || !Array.isArray(backup.data?.claims)) throw new Error('invalid')
      const nextData = backup.data as AssayData
      if (!nextData.reviews.every((item) => item && typeof item === 'object' && typeof (item as Review).id === 'string' && typeof (item as Review).content === 'string') || !nextData.rules.every((item) => item && typeof item === 'object' && typeof (item as BrandRule).id === 'string') || !nextData.claims.every((item) => item && typeof item === 'object' && typeof (item as ApprovedClaim).id === 'string')) throw new Error('invalid')
      if (!window.confirm(`Restore ${nextData.reviews.length} reviews, ${nextData.rules.length} rules, and ${nextData.claims.length} claims? This replaces the workspace currently saved in this browser.`)) return
      setReviews(nextData.reviews)
      setRules(nextData.rules)
      setClaims(nextData.claims)
      saveAssayData(nextData)
      setActiveId(nextData.reviews[0]?.id ?? '')
      setActiveNav('Reviews')
      setNotice('Workspace restored from backup.')
    } catch {
      setNotice('That file is not a valid Assay workspace backup.')
    }
    window.setTimeout(() => setNotice(''), 3200)
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setActiveNav('Overview')}><span className="brand-mark">A</span><span>assay<span className="brand-period">.</span></span></a>
        <button className="workspace-switch"><span className="workspace-avatar">N</span><span className="workspace-copy"><strong>Northstar Studio</strong><small>Brand workspace</small></span><ChevronDown size={15} /></button>
        <div className="nav-groups">
          {navSections.map((section) => <div className="nav-section" key={section.label}><div className="nav-label">{section.label}</div>{section.items.map(({ name, icon: Icon, count }) => <button key={name} className={`nav-item ${activeNav === name ? 'active' : ''}`} onClick={() => { setActiveNav(name); if (name === 'Reviews') setActiveId('RV-2048') }}><Icon size={17} strokeWidth={1.8} /><span>{name}</span>{count && <span className="nav-count">{count}</span>}</button>)}</div>)}
        </div>
        <div className="sidebar-bottom"><button className={`nav-item ${activeNav === 'Settings' ? 'active' : ''}`} onClick={() => setActiveNav('Settings')}><Settings2 size={17} /><span>Settings</span></button><button className="nav-item"><CircleHelp size={17} /><span>Help & support</span></button><div className="profile"><div className="profile-avatar">AR</div><div className="profile-copy"><strong>Alex Rivera</strong><small>Workspace admin</small></div><MoreHorizontal size={18} /></div></div>
      </aside>

      <main className="main-panel">
        <header className="topbar"><div className="breadcrumb">Northstar Studio <span>/</span> <strong>{activeNav}</strong></div><div className="topbar-actions"><span className="privacy-pill" title="This prototype keeps workspace data in this browser only"><ShieldCheck size={14} /> Browser-only demo</span><button className="icon-button" aria-label="Notifications"><Bell size={18} /><i /></button><div className="topbar-avatar">AR</div></div></header>
        <div className="content-wrap">
          <div className="page-heading"><div><div className="eyebrow"><span className="live-dot" /> BRAND GOVERNANCE</div><h1>Review workspace</h1><p>Thoughtful checks, clear evidence, better work before it ships.</p></div><button className="primary-button" onClick={() => document.getElementById('draft-input')?.focus()}><Plus size={17} /> New review</button></div>
          <section className="metrics-grid">
            <Metric label="Awaiting review" value={String(reviews.filter((review) => review.status === 'Needs review').length + 6)} detail="2 high risk" icon={<Clock3 size={16} />} tone="amber" />
            <Metric label="Approved this week" value="34" detail={<><ArrowUpRight size={14} /> 12% vs last week</>} icon={<CheckCheck size={16} />} tone="green" />
            <Metric label="Average review time" value="2.4h" detail={<><ArrowDownRight size={14} /> 18% faster</>} icon={<Activity size={16} />} tone="blue" />
            <Metric label="Rules to clarify" value="3" detail="Based on reviewer feedback" icon={<Sparkles size={16} />} tone="violet" />
          </section>

          {activeNav === 'Settings' ? <section className="brandbrain-section"><div className="section-heading"><div><h2>Workspace settings</h2><p>Manage this browser’s local workspace and backup files.</p></div></div><div className="brain-card backup-card"><div className="brain-card-head"><div><span className="brain-overline">LOCAL DATA</span><h3>Backup and restore</h3></div><span className="local-data-badge"><ShieldCheck size={13} /> This browser only</span></div><p>Assay currently saves reviews, rules, and claims to this browser. A backup is a JSON file you can keep elsewhere and restore later.</p><div className="backup-actions"><button className="primary-button" onClick={exportWorkspaceBackup}><Download size={14} /> Download workspace backup</button><button className="secondary-button" onClick={() => backupInput?.click()}><FileText size={14} /> Restore from backup</button><input ref={setBackupInput} type="file" accept="application/json,.json" hidden onChange={(event) => { void restoreWorkspaceBackup(event.target.files?.[0]); event.currentTarget.value = '' }} /></div><div className="backup-note"><ShieldCheck size={14} /> Backups can contain submitted copy, review history, and attached image data. Store them with the same care as the workspace. Restoring replaces the data in this browser.</div><div className="backup-limit">No account or server is connected. Downloading or restoring a backup does not upload it to Assay.</div></div></section> : activeNav === 'Brand Brain' ? <section className="brandbrain-section"><div className="section-heading"><div><h2>Brand Brain <span className="muted-count">{rules.filter((rule) => rule.status === 'Approved').length} approved rules</span></h2><p>Your team’s source of truth. Draft rules stay out of checks until approved.</p></div><div className="brandbrain-actions"><button className="secondary-button" onClick={() => setShowClaimForm((shown) => !shown)}><Plus size={14} /> Add approved claim</button><button className="primary-button" onClick={() => setShowRuleForm((shown) => !shown)}><Plus size={15} /> Add rule</button></div></div>
            <div className="regression-panel"><div><span className="brain-overline">RULE REGRESSION PREVIEW</span><h3>Check a proposed term against saved reviews</h3><p>Preview a simple phrase match locally before adding it. This does not change the rule set.</p></div><div className="regression-form"><input aria-label="Phrase to preview" placeholder="Enter a phrase, such as ‘clinically proven’" value={regressionText} onChange={(event) => { setRegressionText(event.target.value); setRegressionResults(null) }} onKeyDown={(event) => { if (event.key === 'Enter' && regressionText.trim()) previewRuleRegression() }} /><button className="secondary-button" disabled={!regressionText.trim()} onClick={previewRuleRegression}><Search size={14} /> Preview impact</button></div>{regressionResults && <div className="regression-results" aria-live="polite"><strong>{regressionResults.reduce((sum, item) => sum + item.added.length, 0)} new match{regressionResults.reduce((sum, item) => sum + item.added.length, 0) === 1 ? '' : 'es'} across {regressionResults.length} review{regressionResults.length === 1 ? '' : 's'}</strong>{regressionResults.length ? regressionResults.map((item) => <div className="regression-result" key={item.reviewId}><span>{item.title}</span><small>{item.added.map((finding) => `“${finding.excerpt}”`).join(', ')}</small></div>) : <p>No matches in saved review copy.</p>}<small>Preview uses the current local review set and only the basic phrase matcher. It is not a full rule quality evaluation.</small></div>}</div>
            <div className="brandbrain-content"><div className="brain-card"><div className="brain-card-head"><div><span className="brain-overline">GOVERNANCE RULES</span><h3>Brand rules</h3></div><span className="version-pill">Rule set v1.0</span></div>{showRuleForm && <div className="inline-create"><input autoFocus placeholder="e.g. Avoid urgency language in customer emails" value={ruleText} onChange={(event) => setRuleText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addRule() }} /><button onClick={addRule}>Save draft</button><button className="cancel-create" onClick={() => setShowRuleForm(false)}>Cancel</button></div>}<div className="rule-list">{rules.map((rule) => <div className={`rule-row ${!rule.active ? 'inactive-row' : ''}`} key={rule.id}><span className={`rule-severity ${rule.severity.toLowerCase()}`} /><div className="rule-copy"><div className="rule-title-line"><strong>{rule.label}</strong><span className={`rule-status ${rule.status.toLowerCase()}`}>{rule.status}</span></div><p>{rule.description}</p><span className="rule-source"><BookOpen size={12} />{rule.id} · {rule.source}</span></div><div className="rule-controls">{rule.status === 'Draft' ? <button className="approve-rule" onClick={() => approveRule(rule.id)}><Check size={13} /> Approve</button> : <button className={`toggle-switch ${rule.active ? 'on' : ''}`} onClick={() => toggleRule(rule.id)} aria-label={rule.active ? 'Deactivate rule' : 'Activate rule'}><span /></button>}</div></div>)}</div><div className="brain-footer"><ShieldCheck size={14} /> Only approved and active rules are used by deterministic checks.</div></div>
              <div className="brain-card claims-card"><div className="brain-card-head"><div><span className="brain-overline">APPROVED EVIDENCE</span><h3>Claims Vault</h3></div><span className="claim-count">{claims.filter((claim) => claim.active).length} claims</span></div>{showClaimForm && <div className="claim-create"><input autoFocus placeholder="Approved claim or fact" value={claimText} onChange={(event) => setClaimText(event.target.value)} /><label>Expires<input type="date" value={claimExpiry} onChange={(event) => setClaimExpiry(event.target.value)} /></label><button onClick={addClaim}>Save</button><button className="cancel-create" onClick={() => setShowClaimForm(false)}>Cancel</button></div>}<div className="claim-list">{claims.map((claim) => { const expired = claim.expiryDate < today; return <div className={`claim-row ${!claim.active ? 'inactive-row' : ''}`} key={claim.id}><div className="claim-row-top"><strong>{claim.statement}</strong><span className={`claim-status ${expired ? 'expired' : 'current'}`}>{expired ? 'Expired' : 'Current'}</span></div><div className="claim-evidence"><BookOpen size={12} />{claim.evidence}</div><div className="claim-meta"><span>Owner · {claim.owner}</span><span>Expires · {new Date(`${claim.expiryDate}T00:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span></div><button className={`claim-toggle ${claim.active ? '' : 'restore'}`} onClick={() => toggleClaim(claim.id)}>{claim.active ? 'Archive' : 'Restore'}</button></div> })}</div><div className="brain-footer"><Clock3 size={14} /> Expired claims remain visible and are flagged when matched.</div></div>
            </div><div className="brain-notice"><Sparkles size={15} /><span>Rule extraction from uploaded brand guides is planned next. Add and approve rules manually for now.</span></div>
          </section> : activeNav === 'Governance Radar' ? <RadarView radar={radar} matchingPlaybooks={matchingPlaybooks} onOpenGuild={() => setActiveNav('Assay Guild')} onFocusReview={(reviewId) => { setActiveNav('Reviews'); setActiveId(reviewId) }} /> : activeNav === 'Assay Guild' ? <GuildView playbooks={filteredPlaybooks} query={guildQuery} setQuery={setGuildQuery} onImport={importPlaybook} /> : <section className="review-section">
            <div className="section-heading"><div><h2>Content reviews <span className="muted-count">{reviews.length + 24}</span></h2><p>Review with the right context, not another round of guesswork.</p></div><button className="secondary-button"><Filter size={15} /> Filters <span className="filter-count">2</span></button></div>
            <div className="review-layout">
              {activeNav === 'Reviews' ? <><div className="queue-panel">
                <div className="queue-toolbar"><label className="search-box"><Search size={15} /><input aria-label="Search reviews" placeholder="Search reviews..." value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="icon-button subtle" aria-label="More queue options"><MoreHorizontal size={18} /></button></div>
                <div className="filter-tabs">{['All reviews', 'Needs review', 'In review', 'Approved'].map((item) => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div>
                <div className="queue-list">{visibleReviews.map((review) => <button key={review.id} className={`queue-card ${activeId === review.id ? 'selected' : ''}`} onClick={() => setActiveId(review.id)}><div className="queue-card-top"><span className={`status-dot ${review.status === 'Approved' ? 'ok' : review.status === 'In review' ? 'reviewing' : ''}`} /><span className="queue-status">{review.status}</span><span className="queue-time">{review.time}</span></div><strong className="queue-title">{review.title}</strong><div className="queue-meta"><span><Globe2 size={13} />{review.channel}</span><span className="queue-owner"><span className="mini-avatar">{review.initials}</span>{review.owner}</span></div><div className="queue-card-bottom"><span className="finding-count">{review.findings.filter((finding) => finding.level !== 'Clear').length} findings</span><span className="queue-id">{review.id}</span></div></button>)}{visibleReviews.length === 0 && <div className="empty-state">No reviews match. Try another search or filter.</div>}</div>
              </div></> : <div className="placeholder-panel"><span className="placeholder-icon">{activeNav === 'Overview' ? <LayoutDashboard size={21} /> : activeNav === 'Governance Radar' ? <Activity size={21} /> : <Users2 size={21} />}</span><h2>{activeNav}</h2><p>{activeNav === 'Governance Radar' ? 'Insights will populate from resolved findings, reviewer feedback, and rule history.' : activeNav === 'Assay Guild' ? 'Playbooks, verified expert profiles, and intro requests will connect to real review patterns in a later phase.' : 'Your overview will grow from the workspace’s real review and approval activity.'}</p><span className="coming-soon">PLANNED FOR A LATER PHASE</span></div>}

              {activeNav === 'Reviews' && <div className="detail-panel">
                <div className="detail-header"><div><div className="detail-kicker"><FileText size={14} /> {active.id} <span>·</span> Submitted {active.time}</div><h2>{active.title}</h2><div className="detail-byline"><span className="mini-avatar larger">{active.initials}</span><span>Submitted by <strong>{active.owner}</strong></span><span className="byline-divider" /><span>{active.channel}</span></div></div><button className="icon-button subtle" aria-label="More review actions"><MoreHorizontal size={19} /></button></div>
                <div className="detail-actions"><label className="intent-field"><span>Creator intent</span><input value={active.intent ?? intent} onChange={(event) => { setIntent(event.target.value); updateReview(active.id, (review) => ({ ...review, intent: event.target.value })) }} aria-label="Creator intent" /></label><label className="provider-select"><span>Acting as</span><select value={reviewerRole} onChange={(event) => setReviewerRole(event.target.value as ReviewerRole)} aria-label="Acting reviewer role">{['Creator','Manager','Brand reviewer','Legal reviewer','Admin'].map((role) => <option key={role}>{role}</option>)}</select></label><button className="ai-review-button" onClick={runAiForActiveReview} disabled={aiBusy}><Sparkles size={14} /> {aiBusy ? 'Reviewing…' : 'Run AI demo'}</button><button className="primary-button approve-button" onClick={approveReview} disabled={active.findings.some((finding) => finding.level !== 'Clear')} title={active.findings.some((finding) => finding.level !== 'Clear') ? 'Resolve or dismiss findings before approval' : 'Approve this review'}><Check size={16} /> Approve</button></div>
                <div className="workflow-strip"><span className={`risk-badge ${(active.riskTier ?? 'Standard').toLowerCase()}`}><ShieldCheck size={13} /> {active.riskTier ?? 'Risk not routed'}</span><span><Route size={13} /> Assigned to {active.reviewer ?? 'Unassigned'}</span><button onClick={routeForReview}><ArrowRight size={13} /> Route by risk</button><button onClick={() => setRevisionOpen((open) => !open)}><History size={13} /> History ({active.revisions?.length ?? 0})</button><button onClick={() => setPassportOpen(true)}><FileCheck2 size={13} /> View passport</button></div>
                <div className="finding-summary"><div><span className="summary-number">{active.findings.filter((finding) => finding.level === 'Needs review').length}</span><span>needs review</span></div><div className="summary-separator" /><div><span className="summary-number watch-number">{active.findings.filter((finding) => finding.level === 'Watch').length}</span><span>to consider</span></div><div className="summary-spacer" /><span className="source-assurance"><ShieldCheck size={15} /> Evidence linked</span></div>
                <ImageAttachment image={active.image} busy={imageBusy} onFile={attachImage} onAlt={updateImageAlt} onRemove={() => { const nextReviews = reviews.map((review) => review.id === active.id ? { ...review, image: undefined, findings: review.findings.filter((finding) => finding.origin !== 'image') } : review); setReviews(nextReviews); persist(nextReviews) }} />
                <div className="ai-disclosure"><ShieldCheck size={13} /><span>Offline demo only: content stays in this browser. A future connected AI mode would send the draft and selected approved sources to the configured provider.</span></div>
                <div className="findings-list">{active.findings.map((finding) => <FindingCard key={finding.id} finding={finding} onResolve={(action) => updateFinding(active.id, finding.id, `${action}: ${finding.title}`)} onPreviewSuggestion={previewSuggestion} onAcceptSuggestion={acceptSuggestion} />)}{active.findings.length === 0 && <div className="all-clear"><span className="all-clear-icon"><Check size={18} /></span><div><strong>All findings resolved</strong><p>This review is ready for a final decision.</p></div></div>}</div>
                {suggestionChecks.length > 0 && <div className="suggestion-check-result"><strong>Fix check found {suggestionChecks.length} issue{suggestionChecks.length === 1 ? '' : 's'}:</strong>{suggestionChecks.map((finding) => <span key={finding.id}>{finding.title}</span>)}</div>}
                {revisionOpen && <div className="history-panel"><div className="panel-title"><History size={14} /> Revision history</div>{(active.revisions ?? []).length ? active.revisions?.map((revision) => <div className="history-entry" key={revision.id}><div><strong>{revision.label}</strong><span>{revision.author} · {new Date(revision.createdAt).toLocaleString()}</span><p>{revision.content}</p></div><button onClick={() => { updateReview(active.id, (review) => ({ ...review, content: revision.content, findings: revision.findings, events: [event('Restored revision', revision.label), ...(review.events ?? [])] })); setNotice('Revision restored.') }}>Restore</button></div>) : <p className="empty-history">No content revisions yet. Accepting a suggested edit will create a snapshot.</p>}</div>}
                <ReviewCollaboration review={active} role={reviewerRole} commentText={commentText} setCommentText={setCommentText} addComment={addComment} requestChanges={requestChanges} />
                <div className="event-log"><div className="panel-title"><FileClock size={14} /> Decision history</div>{(active.events ?? []).length ? active.events?.slice(0,5).map((item) => <div className="event-row" key={item.id}><span className="event-dot" /><div><strong>{item.action}</strong><small>{item.detail}</small></div><time>{new Date(item.createdAt).toLocaleString()}</time></div>) : <p className="empty-history">Review decisions will appear here.</p>}</div>
                <div className="draft-box"><div className="draft-label"><WandSparkles size={15} /><span>TRY A QUICK REVIEW</span><span className="demo-tag">DEMO</span></div><div className="draft-input-row"><input id="draft-input" placeholder="Paste a draft to add it to this review queue..." value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitReview() }} /><button className="draft-submit" onClick={submitReview} aria-label="Submit draft"><ArrowRight size={16} /></button></div><div className="draft-footnote"><ShieldCheck size={13} /> Sample workspace · Your content stays in this browser</div></div>
                  </div>}
            </div>
          </section>}
          <div className="bottom-note"><span><Sparkles size={14} /> Deterministic checks only · AI review is not connected.</span><button onClick={() => setActiveNav('Brand Brain')}>Explore Brand Brain <ArrowRight size={13} /></button></div>
        </div>
      </main>
      {passportOpen && <PassportModal review={active} onClose={() => setPassportOpen(false)} onExport={exportPassport} />}
      {notice && <div className="toast"><Check size={16} />{notice}</div>}
    </div>
  )
}

function Metric({ label, value, detail, icon, tone }: { label: string; value: string; detail: React.ReactNode; icon: React.ReactNode; tone: string }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon ${tone}`}>{icon}</span></div><div className="metric-value">{value}</div><div className={`metric-detail ${tone}`}>{detail}</div></div>
}

function FindingCard({ finding, onResolve, onPreviewSuggestion, onAcceptSuggestion }: { finding: Finding; onResolve: (action: string) => void; onPreviewSuggestion: (suggestion: string) => void; onAcceptSuggestion: (suggestion: string) => void }) {
  const [expanded, setExpanded] = useState(finding.level !== 'Clear')
  const [showSuggestion, setShowSuggestion] = useState(false)
  return <article className={`finding-card ${finding.level === 'Clear' ? 'clear-card' : ''}`}><button className="finding-head" onClick={() => setExpanded((open) => !open)}><span className={`finding-indicator ${finding.level === 'Needs review' ? 'risk' : finding.level === 'Watch' ? 'watch' : 'clear'}`}>{finding.level === 'Clear' ? <Check size={14} /> : <span />}</span><span className="finding-main"><span className="finding-type">{finding.type}{finding.origin === 'ai' && finding.confidence !== undefined ? ` · ${Math.round(finding.confidence * 100)}% CONFIDENCE` : ''}</span><strong>{finding.title}</strong></span><span className={`finding-state ${finding.level === 'Needs review' ? 'risk-text' : finding.level === 'Watch' ? 'watch-text' : 'clear-text'}`}>{finding.level}</span><ChevronDown className={expanded ? 'chevron open' : 'chevron'} size={16} /></button>{expanded && <div className="finding-body"><div className="quoted-text">{finding.excerpt}</div><p className="finding-note">{finding.note}</p><div className="source-line"><BookOpen size={14} /><span>{finding.source}</span><button aria-label="Open source details" onClick={() => setShowSuggestion((shown) => !shown)}><ArrowRight size={14} /></button></div>{showSuggestion && <div className="suggestion-preview"><Sparkles size={14} />Suggested next step: review the source with your brand owner before publishing.</div>}{finding.suggestion && <div className="rewrite-box"><div className="rewrite-title"><WandSparkles size={14} /><strong>Intent-preserving suggestion</strong></div><p>{finding.suggestion}</p><div className="rewrite-actions"><button className="suggest-button" onClick={() => { onPreviewSuggestion(finding.suggestion!); setShowSuggestion(true) }}>Check this edit</button><button className="resolve-button" onClick={() => onAcceptSuggestion(finding.suggestion!)}><Check size={13} /> Accept edit</button></div></div>}<div className="finding-actions"><button className="suggest-button" onClick={() => setShowSuggestion((shown) => !shown)}><WandSparkles size={14} /> {finding.suggestion ? 'Review guidance' : 'Suggest a fix'}</button><button className="resolve-button" onClick={() => onResolve(finding.level === 'Clear' ? 'Confirmed' : 'Resolved')}><Check size={14} /> {finding.level === 'Clear' ? 'Looks good' : 'Mark resolved'}</button><button className="dismiss-button" onClick={() => onResolve('Dismissed')} aria-label="Dismiss finding">Dismiss</button></div></div>}</article>
}

function ReviewCollaboration({ review, role, commentText, setCommentText, addComment, requestChanges }: { review: Review; role: ReviewerRole; commentText: string; setCommentText: (value: string) => void; addComment: () => void; requestChanges: () => void }) {
  return <section className="collaboration-panel"><div className="panel-title"><MessageSquare size={14} /> Reviewer collaboration <span>{review.comments?.length ?? 0}</span></div><div className="comment-compose"><textarea value={commentText} onChange={(event) => setCommentText(event.target.value)} placeholder="Leave a note for the creator or reviewer..." rows={2} /><div className="comment-compose-foot"><span>Posting as Alex Rivera · {role}</span><div><button className="request-changes-button" onClick={requestChanges}>Request changes</button><button className="post-comment-button" onClick={addComment} disabled={!commentText.trim()}><Send size={13} /> Comment</button></div></div></div>{(review.comments ?? []).map((comment) => <div className="comment-row" key={comment.id}><span className="comment-avatar">{comment.author.split(' ').map((part) => part[0]).join('')}</span><div><div className="comment-byline"><strong>{comment.author}</strong><span>{comment.role}</span><time>{new Date(comment.createdAt).toLocaleString()}</time></div><p>{comment.text}</p></div></div>)}</section>
}

function PassportModal({ review, onClose, onExport }: { review: Review; onClose: () => void; onExport: () => void }) {
  const resolved = review.events?.filter((item) => ['Resolved', 'Dismissed', 'Confirmed'].some((action) => item.action.includes(action))).length ?? 0
  return <div className="modal-backdrop" role="presentation" onClick={onClose}><section className="passport-modal" role="dialog" aria-modal="true" aria-labelledby="passport-title" onClick={(event) => event.stopPropagation()}><div className="passport-head"><div><span className="passport-mark"><ShieldCheck size={18} /></span><div><div className="brain-overline">PUBLISH READINESS RECORD</div><h2 id="passport-title">Review passport</h2></div></div><button className="icon-button" aria-label="Close passport" onClick={onClose}>×</button></div><div className="passport-status"><span className={`risk-badge ${(review.riskTier ?? 'Standard').toLowerCase()}`}><ShieldCheck size={13} /> {review.status}</span><span>{review.id} · Rule set v1.0</span></div><div className="passport-fields"><div><small>Content</small><strong>{review.title}</strong></div><div><small>Submitted by</small><strong>{review.owner}</strong></div><div><small>Reviewer</small><strong>{review.reviewer ?? 'Not assigned'}</strong></div><div><small>Risk tier</small><strong>{review.riskTier ?? 'Not assessed'}</strong></div><div><small>Findings resolved</small><strong>{resolved} decisions · {review.findings.length} open findings</strong></div><div><small>Rule set version</small><strong>v1.0 · Local workspace</strong></div></div><div className="passport-copy"><small>Reviewed content snapshot</small><p>{review.content}</p></div><div className="passport-disclosure"><ShieldCheck size={14} /> Offline demo mode. No AI provider was called. This passport is a local prototype record, not a cryptographic signature.</div><div className="passport-footer"><span>Generated {new Date(review.passportCreatedAt ?? Date.now()).toLocaleString()}</span><button className="primary-button" onClick={onExport}><Download size={14} /> Export JSON</button></div></section></div>
}

function ImageAttachment({ image, busy, onFile, onAlt, onRemove }: { image?: Review['image']; busy: boolean; onFile: (file?: File) => void; onAlt: (value: string) => void; onRemove: () => void }) {
  return <section className="image-attachment"><div className="panel-title"><ImagePlus size={14} /> Campaign image <span className="image-local-label">BROWSER ONLY</span></div>{image ? <div className="attached-image"><img src={image.dataUrl} alt={image.altText || ''} /><div className="attached-image-details"><div className="image-meta-line"><strong>{image.name}</strong><span>{image.width} × {image.height}px</span><button onClick={onRemove} aria-label="Remove image"><X size={13} /></button></div><label className="alt-input"><span>Alt text</span><input value={image.altText} onChange={(event) => onAlt(event.target.value)} placeholder="Describe the image for someone who cannot see it" /></label><div className="palette-row"><span>Dominant colors</span>{image.palette.slice(0, 5).map((color) => <i key={color} title={color} style={{ backgroundColor: color }} />)}</div><p>Checks cover alt text, image dimensions, and basic palette distance only.</p></div></div> : <label className={`image-drop ${busy ? 'busy' : ''}`}><input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={(event) => { onFile(event.target.files?.[0]); event.currentTarget.value = '' }} /><ImagePlus size={18} /><span>{busy ? 'Inspecting image…' : 'Add a campaign image'}</span><small>PNG, JPG, or WebP · up to 5 MB · stays in this browser</small></label>}</section>
}

function RadarView({ radar, matchingPlaybooks, onOpenGuild, onFocusReview }: { radar: ReturnType<typeof buildRadar>; matchingPlaybooks: typeof playbooks; onOpenGuild: () => void; onFocusReview: (id: string) => void }) {
  const max = Math.max(1, ...radar.repeated.map((item) => item.count))
  return <section className="radar-page"><div className="radar-intro"><div><span className="brain-overline">INSIGHTS FROM THIS BROWSER</span><h2>Governance Radar</h2><p>Patterns calculated from the review records saved in this workspace. No external benchmark data is used.</p></div><span className="local-data-badge"><Activity size={14} /> {radar.reviewCount} review records</span></div><div className="radar-stats"><div><small>Open findings</small><strong>{radar.openFindings}</strong><span>Across current review records</span></div><div><small>Review decisions</small><strong>{radar.resolvedActions}</strong><span>Resolved, dismissed, or confirmed</span></div><div><small>Change requests</small><strong>{radar.changesRequested}</strong><span>Recorded in review history</span></div><div><small>Statuses</small><strong>{Object.keys(radar.statuses).length}</strong><span>Distinct workflow states</span></div></div><div className="radar-columns"><div className="radar-card"><div className="radar-card-heading"><div><h3>Recurring findings</h3><p>Grouped by source rule or finding title.</p></div><span className="computed-label">COMPUTED</span></div>{radar.repeated.length ? radar.repeated.slice(0, 6).map((item) => <div className="radar-row" key={item.title}><div className="radar-row-copy"><strong>{item.title}</strong><small>{item.type} · {item.reviewIds.length} affected review{item.reviewIds.length === 1 ? '' : 's'}</small></div><div className="radar-bar-track"><i style={{ width: `${Math.max(12, item.count / max * 100)}%` }} /></div><b>{item.count}</b><button onClick={() => item.reviewIds[0] && onFocusReview(item.reviewIds[0])}>Open</button></div>) : <div className="radar-empty">No open findings in the saved reviews yet. Findings resolve as reviewers act on them.</div>}</div><div className="radar-card"><div className="radar-card-heading"><div><h3>Rules to clarify</h3><p>Repeated unresolved findings may indicate a rule worth reviewing.</p></div><span className="computed-label">HEURISTIC</span></div>{radar.ambiguous.length ? radar.ambiguous.slice(0, 4).map((item) => <div className="clarity-item" key={item.title}><span className="clarity-icon"><Sparkles size={14} /></span><div><strong>{item.title}</strong><p>Appears in {item.count} open findings. This is a review prompt, not proof the guideline is ambiguous.</p></div></div>) : <div className="radar-empty">No repeated open issue yet. As review history grows, repeated findings will appear here.</div>}<div className="radar-playbook-link"><span><BookOpen size={14} /> Related playbooks</span>{matchingPlaybooks.length ? matchingPlaybooks.slice(0, 2).map((book) => <button key={book.id} onClick={onOpenGuild}>{book.title}<ArrowRight size={12} /></button>) : <button onClick={onOpenGuild}>Browse the Assay Guild <ArrowRight size={12} /></button>}</div></div></div><div className="radar-disclaimer"><ShieldCheck size={14} /> Radar uses only locally saved review records. It does not compare your brand to other organisations or infer causation from repeated findings.</div></section>
}

function GuildView({ playbooks: items, query, setQuery, onImport }: { playbooks: typeof playbooks; query: string; setQuery: (query: string) => void; onImport: (playbook: typeof playbooks[number]) => void }) {
  return <section className="guild-page"><div className="guild-hero"><div><span className="brain-overline">ASSAY GUILD · CURATED KNOWLEDGE</span><h2>Good guidance travels.</h2><p>Practical playbooks for brand teams, creators, and reviewers. Import one as a draft rule, then adapt and approve it for your workspace.</p></div><div className="guild-hero-icon"><Compass size={28} /></div></div><div className="guild-toolbar"><div><h3>Playbook library</h3><p>Curated examples · Not legal advice · Adapt before use</p></div><label className="search-box"><Search size={15} /><input placeholder="Search playbooks" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div><div className="playbook-grid">{items.map((book) => <article className="playbook-card" key={book.id}><div className="playbook-card-top"><span>{book.category}</span><span>{book.id}</span></div><h3>{book.title}</h3><p>{book.description}</p><div className="playbook-tags">{book.tags.map((tag) => <span key={tag}>{tag}</span>)}</div><div className="playbook-footer"><span><Users2 size={12} /> {book.author}</span><button onClick={() => onImport(book)}>Add as draft <ArrowRight size={13} /></button></div></article>)}</div><div className="guild-safety"><ShieldCheck size={14} /><span>This prototype contains curated sample playbooks, not verified professional accounts. Expert profiles, paid consultations, and community posting are planned after moderation and identity checks.</span></div></section>
}

export default App
