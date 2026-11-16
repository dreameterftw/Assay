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
}

export type Review = {
  id: string
  title: string
  channel: string
  owner: string
  initials: string
  time: string
  status: string
  findings: Finding[]
  content: string
  intent?: string
  reviewer?: string
  riskTier?: 'Low' | 'Standard' | 'High'
  comments?: ReviewComment[]
  events?: ReviewEvent[]
  revisions?: ReviewRevision[]
  passportCreatedAt?: string
  image?: { name: string; dataUrl: string; width: number; height: number; altText: string; palette: string[] }
}

export type ReviewComment = { id: string; author: string; role: ReviewerRole; text: string; createdAt: string; anchor?: string }
export type ReviewEvent = { id: string; actor: string; role: ReviewerRole; action: string; detail: string; createdAt: string }
export type ReviewRevision = { id: string; content: string; findings: Finding[]; createdAt: string; author: string; label: string }
export type ReviewerRole = 'Creator' | 'Manager' | 'Brand reviewer' | 'Legal reviewer' | 'Admin'

export type BrandRule = {
  id: string
  category: 'Terminology' | 'Required language' | 'Claims' | 'Tone'
  label: string
  description: string
  source: string
  status: 'Approved' | 'Draft'
  severity: 'High' | 'Medium' | 'Low'
  active: boolean
  matchText?: string
}

export type ApprovedClaim = {
  id: string
  statement: string
  evidence: string
  owner: string
  reviewDate: string
  expiryDate: string
  active: boolean
}
