export type Finding = {
  id: string
  level: 'Needs review' | 'Watch' | 'Clear'
  type: string
  title: string
  excerpt: string
  source: string
  note: string
  sourceId?: string
  origin?: 'deterministic' | 'ai' | 'image'
  confidence?: number
  suggestion?: string
  decision?: 'resolved' | 'dismissed' | 'confirmed'
}

export type Review = {
  id: string
  createdAt?: string
  title: string
  channel: string
  owner: string
  createdById?: string
  initials: string
  time: string
  status: string
  findings: Finding[]
  content: string
  intent?: string
  reviewer?: string
  assignedReviewerId?: string
  riskTier?: 'Low' | 'Standard' | 'High'
  comments?: ReviewComment[]
  events?: ReviewEvent[]
  revisions?: ReviewRevision[]
  decisions?: ReviewDecision[]
  passportCreatedAt?: string
  ruleSetVersion?: number
  ruleSnapshot?: { rule_id: string; rule_key: string; version: number }[]
  latestRunContentSha256?: string
  waiverReason?: string
  waiverExpiresAt?: string
  image?: { name: string; dataUrl: string; width: number; height: number; altText: string; palette: string[]; assetId?: string; storagePath?: string }
}

export type ReviewComment = { id: string; author: string; role: ReviewerRole; text: string; createdAt: string; anchor?: string; visibility?: 'internal' | 'shared' }
export type ReviewEvent = { id: string; actor: string; role: ReviewerRole; action: string; detail: string; createdAt: string }
export type ReviewRevision = { id: string; content: string; findings: Finding[]; createdAt: string; author: string; label: string }
export type ReviewDecision = { id: string; findingKey: string; findingTitle: string; action: 'resolved' | 'dismissed' | 'confirmed'; reason: string; author: string; createdAt: string }
export type ReviewerRole = 'Creator' | 'Manager' | 'Brand reviewer' | 'Legal reviewer' | 'Admin'

export type BrandRule = {
  id: string
  ruleKey?: string
  category: 'Terminology' | 'Required language' | 'Claims' | 'Tone' | 'Visual' | 'Accessibility'
  version?: number
  label: string
  description: string
  source: string
  status: 'Approved' | 'Draft' | 'Retired'
  severity: 'High' | 'Medium' | 'Low'
  active: boolean
  matchText?: string
}

export type ApprovedClaim = {
  id: string
  statement: string
  evidence: string
  evidenceUrl?: string
  owner: string
  reviewDate: string
  expiryDate: string
  active: boolean
}
