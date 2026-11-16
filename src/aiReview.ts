import type { ApprovedClaim, BrandRule, Finding } from './types'
import { runDeterministicChecks } from './checks'

export type ReviewContext = {
  content: string
  intent: string
  rules: BrandRule[]
  claims: ApprovedClaim[]
}

export type ReviewProvider = 'demo' | 'api'
export type ReviewSource = { id: string; kind: 'rule' | 'claim'; text: string }

type ProviderFinding = Omit<Finding, 'origin' | 'source'> & { sourceId: string }

function tokenize(text: string) {
  return new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 3))
}

function similarity(left: string, right: string) {
  const a = tokenize(left)
  const b = tokenize(right)
  if (!a.size || !b.size) return 0
  let overlap = 0
  for (const word of a) if (b.has(word)) overlap += 1
  return overlap / Math.sqrt(a.size * b.size)
}

export function retrieveRelevantSources(context: ReviewContext) {
  const sources = [
    ...context.rules.filter((rule) => rule.active && rule.status === 'Approved').map((rule) => ({ id: rule.id, kind: 'rule' as const, text: `${rule.label}. ${rule.description}`, original: rule })),
    ...context.claims.filter((claim) => claim.active).map((claim) => ({ id: claim.id, kind: 'claim' as const, text: `${claim.statement}. ${claim.evidence}`, original: claim })),
  ]
  return sources
    .map((source) => ({ ...source, score: similarity(`${context.content} ${context.intent}`, source.text) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
}

function spanExists(content: string, span: string) {
  return span.length > 0 && content.toLocaleLowerCase().includes(span.toLocaleLowerCase())
}

export function validateProviderFindings(raw: unknown, context: ReviewContext): Finding[] {
  if (!Array.isArray(raw)) return []
  const allowed = new Map(retrieveRelevantSources(context).map((source) => [source.id, source]))
  const output: Finding[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const candidate = item as Partial<ProviderFinding>
    if (typeof candidate.sourceId !== 'string' || !allowed.has(candidate.sourceId)) continue
    if (typeof candidate.excerpt !== 'string' || !spanExists(context.content, candidate.excerpt)) continue
    if (typeof candidate.title !== 'string' || typeof candidate.note !== 'string') continue
    if (!['Needs review', 'Watch'].includes(candidate.level ?? '')) continue
    if (typeof candidate.confidence !== 'number' || candidate.confidence < 0.5 || candidate.confidence > 1) continue
    const source = allowed.get(candidate.sourceId)!
    const rule = source.kind === 'rule' ? source.original : undefined
    output.push({
      id: `ai-${candidate.sourceId}-${output.length + 1}`,
      level: candidate.level as Finding['level'],
      type: typeof candidate.type === 'string' ? candidate.type : 'AI REVIEW · JUDGMENT',
      title: candidate.title.slice(0, 160),
      excerpt: candidate.excerpt,
      source: `${source.id} · ${source.text}`,
      sourceId: source.id,
      origin: 'ai',
      confidence: candidate.confidence,
      note: candidate.note.slice(0, 600),
      suggestion: typeof candidate.suggestion === 'string' ? candidate.suggestion.slice(0, 1000) : undefined,
    })
    if (rule && rule.category === 'Tone') {
      const newest = output[output.length - 1]
      newest.type = 'TONE · AI JUDGMENT'
      newest.level = 'Watch'
    }
  }
  return output
}

export function validateSuggestion(suggestion: string, rules: BrandRule[], claims: ApprovedClaim[], today: string) {
  const findings = runDeterministicChecks(suggestion, rules, claims, today).filter((finding) => finding.level !== 'Clear')
  return { safeToOffer: findings.length === 0, findings }
}

function demoReview(context: ReviewContext): Finding[] {
  const sources = retrieveRelevantSources(context)
  const toneRule = sources.find((source) => source.kind === 'rule' && source.original.category === 'Tone')
  if (!toneRule) return []
  const phrase = context.content.match(/\b(guaranteed|miracle|best ever|number one|#1|act now|never again)\b/i)
  const excerpt = phrase?.[0] ?? context.content.match(/\bthe new way to feel your best\b/i)?.[0]
  if (!excerpt) return []
  const replacement = phrase
    ? context.content.replace(new RegExp(excerpt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'a thoughtful choice')
    : context.content.replace(new RegExp(excerpt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), 'A thoughtful addition to your everyday care routine.')
  return validateProviderFindings([{
    sourceId: toneRule.id,
    id: 'demo-tone',
    level: 'Watch',
    type: 'TONE · AI JUDGMENT',
    title: phrase ? 'This phrase may overpromise' : 'Consider a more specific opening',
    excerpt,
    note: `Your approved voice asks for ${(toneRule.original as BrandRule).description.toLowerCase()} Consider this optional alternative; treat the tone assessment as a suggestion for human review, not a definitive violation.`,
    confidence: 0.76,
    suggestion: replacement,
  }], context)
}

export async function runAiReview(context: ReviewContext, provider: ReviewProvider): Promise<Finding[]> {
  if (provider === 'demo') return demoReview(context)
  throw new Error('Connected AI is unavailable until a secured server endpoint is configured.')
}

export function validateServerPayload(payload: unknown, content: string, sources: ReviewSource[]): Finding[] {
  if (!payload || typeof payload !== 'object') return []
  const data = payload as { findings?: unknown }
  if (!Array.isArray(data.findings)) return []
  const known = new Map(sources.map((source) => [source.id, source]))
  return data.findings.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return []
    const item = candidate as Partial<ProviderFinding>
    const source = typeof item.sourceId === 'string' ? known.get(item.sourceId) : undefined
    if (!source || typeof item.excerpt !== 'string' || !spanExists(content, item.excerpt)) return []
    if (typeof item.title !== 'string' || typeof item.note !== 'string' || !['Needs review', 'Watch'].includes(item.level ?? '')) return []
    if (typeof item.confidence !== 'number' || item.confidence < 0.5 || item.confidence > 1) return []
    return [{
      id: `api-${source.id}-${index + 1}`,
      level: item.level as Finding['level'],
      type: typeof item.type === 'string' ? item.type : 'AI REVIEW · JUDGMENT',
      title: item.title.slice(0, 160),
      excerpt: item.excerpt,
      source: `${source.id} · ${source.text}`,
      sourceId: source.id,
      origin: 'ai' as const,
      confidence: item.confidence,
      note: item.note.slice(0, 600),
      suggestion: typeof item.suggestion === 'string' ? item.suggestion.slice(0, 1000) : undefined,
    }]
  })
}

export function recheckSuggestion(suggestion: string, rules: BrandRule[], claims: ApprovedClaim[], today: string) {
  return runDeterministicChecks(suggestion, rules, claims, today)
}
