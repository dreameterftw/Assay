import type { ApprovedClaim, BrandRule, Finding } from './types'

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function addFinding(findings: Finding[], input: Omit<Finding, 'id'>) {
  if (findings.some((finding) => finding.title === input.title && finding.excerpt === input.excerpt)) return
  findings.push({ ...input, id: `det-${findings.length + 1}-${Math.random().toString(36).slice(2, 7)}` })
}

export function runDeterministicChecks(content: string, rules: BrandRule[], claims: ApprovedClaim[], today: string): Finding[] {
  const findings: Finding[] = []
  const normalizedContent = content.toLowerCase()

  for (const rule of rules.filter((item) => item.active && item.status === 'Approved')) {
    const terminologyMatch = rule.matchText ? content.match(new RegExp(escapeRegex(rule.matchText), 'i')) : rule.id === 'B-01' ? content.match(/\bdaily essentials\b/i) : null
    if (terminologyMatch) {
      addFinding(findings, { level: rule.severity === 'High' ? 'Needs review' : 'Watch', type: `TERMINOLOGY · ${rule.severity.toUpperCase()}`, title: rule.label, excerpt: terminologyMatch[0], source: `${rule.id} · ${rule.label}`, sourceId: rule.id, origin: 'deterministic', note: rule.description })
    }
    if (rule.id === 'B-02') {
      const match = content.match(/\bmiracle\b/i)
      if (match) addFinding(findings, { level: 'Needs review', type: 'CLAIM · HIGH RISK', title: 'Avoid an absolute product promise', excerpt: match[0], source: `${rule.id} · ${rule.label}`, sourceId: rule.id, origin: 'deterministic', note: rule.description })
    }
    if (rule.id === 'B-03' && /\b(influencer|paid partnership|sponsored)\b/i.test(content) && !/#ad\b/i.test(content)) {
      addFinding(findings, { level: 'Needs review', type: 'DISCLOSURE · HIGH RISK', title: 'Add the required sponsored-post disclosure', excerpt: content.match(/\b(influencer|paid partnership|sponsored)\b/i)?.[0] ?? '', source: `${rule.id} · ${rule.label}`, sourceId: rule.id, origin: 'deterministic', note: rule.description })
    }
    if (rule.id === 'B-04') {
      const match = content.match(/(?:#1|\bnumber one\b|\bbest-selling\b|\bbest in class\b)/i)
      if (match) addFinding(findings, { level: 'Needs review', type: 'CLAIM · HIGH RISK', title: 'Superlative needs substantiation', excerpt: match[0], source: `${rule.id} · ${rule.label}`, sourceId: rule.id, origin: 'deterministic', note: rule.description })
    }
    if (rule.id === 'B-05' && /\b(guaranteed|miracle|act now or|last chance ever)\b/i.test(content)) {
      const match = content.match(/\b(guaranteed|miracle|act now or|last chance ever)\b/i)
      if (match) addFinding(findings, { level: 'Watch', type: 'TONE · MEDIUM', title: 'Review pressure or absolute wording', excerpt: match[0], source: `${rule.id} · ${rule.label}`, sourceId: rule.id, origin: 'deterministic', note: rule.description })
    }
  }

  for (const claim of claims.filter((item) => item.active)) {
    const statement = claim.statement.trim()
    const match = statement.length >= 4 ? new RegExp(escapeRegex(statement), 'i').test(content) : false
    const valueMatch = statement.match(/[\d,.]+(?:%|\+)?/)
    const claimTerm = statement.replace(/[\d,.]+(?:%|\+)?/g, '').trim()
    const mentionsClaim = claimTerm.length > 4 && normalizedContent.includes(claimTerm.toLowerCase())
    if (match && claim.expiryDate < today) {
      addFinding(findings, { level: 'Needs review', type: 'CLAIM · EXPIRED', title: 'Approved claim has expired', excerpt: statement, source: `${claim.id} · ${claim.evidence} · expired ${claim.expiryDate}`, sourceId: claim.id, origin: 'deterministic', note: 'This approved claim has passed its expiry date. Refresh the evidence before using it.' })
    } else if (!match && valueMatch && mentionsClaim) {
      const numberText = escapeRegex(valueMatch[0].replace(/[+]/g, ''))
      const changedNumber = new RegExp(`\\b\\d[\\d,.]*${valueMatch[0].includes('%') ? '%' : ''}\\s*${escapeRegex(claimTerm)}`, 'i')
      if (changedNumber.test(content)) {
        const excerpt = content.match(changedNumber)?.[0] ?? claimTerm
        addFinding(findings, { level: 'Needs review', type: 'CLAIM · HIGH RISK', title: 'Claim value differs from the approved fact', excerpt, source: `${claim.id} · ${claim.statement} · ${claim.evidence}`, sourceId: claim.id, origin: 'deterministic', note: `The submitted value does not match the approved figure. The approved value is ${valueMatch[0]}; confirm it is still current with ${claim.owner}.` })
      } else if (normalizedContent.includes(numberText.toLowerCase()) && claim.expiryDate < today) {
        addFinding(findings, { level: 'Needs review', type: 'CLAIM · EXPIRED', title: 'Potential use of an expired claim', excerpt: valueMatch[0], source: `${claim.id} · ${claim.evidence} · expired ${claim.expiryDate}`, sourceId: claim.id, origin: 'deterministic', note: 'A number associated with an expired claim appears in the content. Please confirm its intended meaning.' })
      }
    }
  }

  if (findings.length === 0) {
    findings.push({ id: 'det-clear', level: 'Clear', type: 'RULE ENGINE · DETERMINISTIC', title: 'No deterministic issues found', excerpt: 'No active terminology, disclosure, or approved-claim rules were triggered.', source: `Approved rules · ${rules.filter((rule) => rule.active && rule.status === 'Approved').length} active`, origin: 'deterministic', note: 'This is not a tone or factuality approval. AI-assisted and human review are not connected in this phase.' })
  }
  return findings
}
