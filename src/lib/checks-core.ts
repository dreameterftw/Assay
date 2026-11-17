export const ENGINE_VERSION = '1.1.0'

export type PaletteColor = { name: string; hex: string }

export const DEFAULT_BRAND_PALETTE: PaletteColor[] = [
  { name: 'Forest', hex: '#285b40' },
  { name: 'Sage', hex: '#84a187' },
  { name: 'Ivory', hex: '#f4f0e6' },
  { name: 'Ink', hex: '#202a22' },
]

export type CheckRule = {
  id: string
  rule_key: string
  version: number
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
  version: number
  statement: string
  value?: string | null
  evidence_label: string
  evidence_url?: string | null
  owner_label: string
  reviewed_at?: string | null
  expires_at: string | null
  active: boolean
}

export type CheckFinding = {
  finding_key: string
  source_kind: 'rule' | 'claim' | 'image_check'
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
  const excerpt = Array.from(finding.excerpt).slice(0, 64).join('')
  return JSON.stringify([finding.sourceId ?? finding.type, finding.title, excerpt])
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
    const title = Array.from(input.title).slice(0, 100).join('')
    const explanationParts = Array.from(input.explanation)
    const explanation = explanationParts.length > 12000
      ? `${explanationParts.slice(0, 11980).join('')} [truncated]`
      : input.explanation
    const finding = { ...input, title, explanation, finding_key: findingKey({
      sourceId: input.rule_id ?? input.claim_id ?? undefined,
      type: input.category,
      title,
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

function colorDistance(left: string, right: string) {
  const channels = (hex: string) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
  const leftRgb = channels(left)
  const rightRgb = channels(right)
  return Math.sqrt(leftRgb.reduce((total, channel, index) => total + (channel - rightRgb[index]) ** 2, 0))
}

export function runImageChecks({
  asset, approvedPalette = DEFAULT_BRAND_PALETTE,
}: {
  asset: { id: string; filename: string; width: number; height: number; alt_text: string; palette: unknown }
  approvedPalette?: PaletteColor[]
}): CheckFinding[] {
  const findings: CheckFinding[] = []
  const addFinding = (category: string, title: string, excerpt: string, explanation: string, severity: CheckFinding['severity'], state: CheckFinding['state']) => {
    findings.push({
      finding_key: findingKey({ sourceId: asset.id, type: 'image_check', title, excerpt }),
      source_kind: 'image_check',
      rule_id: null,
      claim_id: null,
      category,
      severity,
      state,
      title,
      excerpt,
      explanation,
      confidence: null,
    })
  }

  if (!asset.alt_text.trim()) {
    addFinding(
      'accessibility',
      'Add descriptive alt text',
      asset.filename,
      'Describe the image’s purpose and important visible information. Decorative images can use empty alt text when the publishing system supports it.',
      'high',
      'violation',
    )
  }
  if (asset.width < 600 || asset.height < 400) {
    addFinding(
      'visual',
      'Image may be too small for campaign use',
      `${asset.width} × ${asset.height}px`,
      'Check the intended placement; this image may look soft when used in a larger layout.',
      'low',
      'likely',
    )
  }

  const assetPalette = Array.isArray(asset.palette)
    ? asset.palette.filter((color): color is string => typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color))
    : []
  const validApprovedPalette = approvedPalette.filter((color) => /^#[0-9a-f]{6}$/i.test(color.hex))
  if (assetPalette.length && validApprovedPalette.length) {
    const nearest = assetPalette.map((color) => Math.min(...validApprovedPalette.map((approved) => colorDistance(color, approved.hex))))
    const average = nearest.reduce((sum, value) => sum + value, 0) / nearest.length
    if (average > 115) {
      addFinding(
        'visual',
        'Image colors differ from the brand palette',
        assetPalette.join(' · '),
        'This is a simple dominant-color comparison. It cannot identify a logo, judge composition, or determine whether the image is intentionally off-palette; review it in context.',
        'low',
        'likely',
      )
    }
  }
  return findings
}
