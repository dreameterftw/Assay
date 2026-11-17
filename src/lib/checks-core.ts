export const ENGINE_VERSION = '1.0.0'

export type CheckRule = {
  id: string
  rule_key: string
  category: string
  title: string
  description: string
  source_label: string
  severity: string
  match_text: string
  active: boolean
  status: string
}

export type CheckClaim = {
  id: string
  statement: string
  evidence_label: string
  owner_label: string
  expires_at: string | null
  active: boolean
}

export type CheckFinding = {
  finding_key: string
  source_kind: 'rule' | 'claim'
  rule_id: string | null
  claim_id: string | null
  category: string
  severity: 'low' | 'medium' | 'high'
  state: 'violation' | 'likely' | 'needs_human_judgement' | 'cannot_verify'
  title: string
  excerpt: string
  explanation: string
  confidence: null
}

export function findingKey(finding: { sourceId?: string; type: string; title: string; excerpt: string }): string {
  return JSON.stringify([finding.sourceId ?? finding.type, finding.title, finding.excerpt])
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function runChecks({
  content, rules, claims, today,
}: {
  content: string
  rules: CheckRule[]
  claims: CheckClaim[]
  today: string
}): CheckFinding[] {
  const findings: CheckFinding[] = []
  const normalizedContent = content.toLowerCase()

  const addFinding = (input: Omit<CheckFinding, 'finding_key'>) => {
    const finding = { ...input, finding_key: findingKey({
      sourceId: input.rule_id ?? input.claim_id ?? undefined,
      type: input.category,
      title: input.title,
      excerpt: input.excerpt,
    }) }
    if (!findings.some((existing) => existing.finding_key === finding.finding_key)) findings.push(finding)
  }

  for (const rule of rules.filter((item) => item.active && item.status === 'approved')) {
    const ruleName = rule.rule_key || rule.id
    const match = rule.match_text
      ? content.match(new RegExp(escapeRegex(rule.match_text), 'i'))
      : ruleName === 'B-01' ? content.match(/\bdaily essentials\b/i) : null
    if (match) addFinding({
      source_kind: 'rule', rule_id: rule.id, claim_id: null, category: rule.category,
      severity: rule.severity === 'high' ? 'high' : rule.severity === 'medium' ? 'medium' : 'low',
      state: rule.severity === 'high' ? 'violation' : 'likely', title: rule.title, excerpt: match[0],
      explanation: rule.description, confidence: null,
    })
    const addRuleFinding = (pattern: RegExp, category: string, title: string, severity: CheckFinding['severity'], state: CheckFinding['state']) => {
      const specialMatch = content.match(pattern)
      if (specialMatch) addFinding({
        source_kind: 'rule', rule_id: rule.id, claim_id: null, category, severity, state,
        title, excerpt: specialMatch[0], explanation: rule.description, confidence: null,
      })
    }
    if (ruleName === 'B-02') addRuleFinding(/\bmiracle\b/i, 'claims', 'Avoid an absolute product promise', 'high', 'violation')
    if (ruleName === 'B-03' && /\b(influencer|paid partnership|sponsored)\b/i.test(content) && !/#ad\b/i.test(content)) {
      addRuleFinding(/\b(influencer|paid partnership|sponsored)\b/i, 'required_language', 'Add the required sponsored-post disclosure', 'high', 'violation')
    }
    if (ruleName === 'B-04') addRuleFinding(/(?:#1|\bnumber one\b|\bbest-selling\b|\bbest in class\b)/i, 'claims', 'Superlative needs substantiation', 'high', 'violation')
    if (ruleName === 'B-05') addRuleFinding(/\b(guaranteed|miracle|act now or|last chance ever)\b/i, 'tone', 'Review pressure or absolute wording', 'medium', 'likely')
  }

  for (const claim of claims.filter((item) => item.active)) {
    const statement = claim.statement.trim()
    const match = statement.length >= 4 ? new RegExp(escapeRegex(statement), 'i').test(content) : false
    const valueMatch = statement.match(/[\d,.]+(?:%|\+)?/)
    const claimTerm = statement.replace(/[\d,.]+(?:%|\+)?/g, '').trim()
    const mentionsClaim = claimTerm.length > 4 && normalizedContent.includes(claimTerm.toLowerCase())
    const addClaimFinding = (title: string, excerpt: string, explanation: string) => addFinding({
      source_kind: 'claim', rule_id: null, claim_id: claim.id, category: 'claims', severity: 'high',
      state: 'violation', title, excerpt, explanation, confidence: null,
    })
    if (match && claim.expires_at && claim.expires_at < today) {
      addClaimFinding('Approved claim has expired', statement, 'This approved claim has passed its expiry date. Refresh the evidence before using it.')
    } else if (!match && valueMatch && mentionsClaim) {
      const numberText = escapeRegex(valueMatch[0].replace(/[+]/g, ''))
      const changedNumber = new RegExp(`\\b\\d[\\d,.]*${valueMatch[0].includes('%') ? '%' : ''}\\s*${escapeRegex(claimTerm)}`, 'i')
      if (changedNumber.test(content)) {
        const excerpt = content.match(changedNumber)?.[0] ?? claimTerm
        addClaimFinding('Claim value differs from the approved fact', excerpt,
          `The submitted value does not match the approved figure. The approved value is ${valueMatch[0]}; confirm it is still current with ${claim.owner_label}.`)
      } else if (claim.expires_at && claim.expires_at < today && normalizedContent.includes(numberText.toLowerCase())) {
        addClaimFinding('Potential use of an expired claim', valueMatch[0],
          'A number associated with an expired claim appears in the content. Please confirm its intended meaning.')
      }
    }
  }
  return findings
}
