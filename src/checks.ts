import { runChecks } from './lib/checks-core'
import type { ApprovedClaim, BrandRule, Finding } from './types'

export { findingKey } from './lib/checks-core'

export function runDeterministicChecks(content: string, rules: BrandRule[], claims: ApprovedClaim[], today: string): Finding[] {
  const findings = runChecks({
    content,
    rules: rules.map((rule) => ({
      id: rule.id,
      rule_key: rule.ruleKey ?? rule.id,
      category: rule.category.toLowerCase().replace(/ /g, '_'),
      title: rule.label,
      description: rule.description,
      source_label: rule.source,
      severity: rule.severity.toLowerCase(),
      match_text: rule.matchText ?? '',
      active: rule.active,
      status: rule.status.toLowerCase(),
    })),
    claims: claims.map((claim) => ({
      id: claim.id,
      statement: claim.statement,
      evidence_label: claim.evidence,
      owner_label: claim.owner,
      expires_at: claim.expiryDate || null,
      active: claim.active,
    })),
    today,
  }).map((finding): Finding => {
    const rule = rules.find((item) => item.id === finding.rule_id)
    const claim = claims.find((item) => item.id === finding.claim_id)
    return {
      id: finding.finding_key,
      level: finding.severity === 'high' ? 'Needs review' : 'Watch',
      type: `${finding.category.replace(/_/g, ' ').toUpperCase()} · ${finding.severity.toUpperCase()}`,
      title: finding.title,
      excerpt: finding.excerpt,
      source: rule ? `${rule.id} · ${rule.label}` : claim ? `${claim.id} · ${claim.evidence}` : 'Review evidence',
      note: finding.explanation,
      sourceId: finding.rule_id ?? finding.claim_id ?? undefined,
      origin: 'deterministic',
    }
  })
  if (findings.length) return findings
  const activeRules = rules.filter((rule) => rule.active && rule.status === 'Approved')
  return [{
    id: 'det-clear', level: 'Clear', type: 'RULE ENGINE · DETERMINISTIC',
    title: 'No deterministic issues found',
    excerpt: 'No active terminology, disclosure, or approved-claim rules were triggered.',
    source: `Approved rules · ${activeRules.length} active`,
    note: 'This is not a tone or factuality approval. AI-assisted and human review are not connected in this phase.',
    origin: 'deterministic',
  }]
}
