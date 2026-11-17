import { createHash } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  DEFAULT_BRAND_PALETTE,
  ENGINE_VERSION,
  runChecks,
  runImageChecks,
  type CheckClaim,
  type CheckRule,
} from '../src/lib/checks-core.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const pageSize = 500

type ReviewRunInputs = {
  review_id: string
  organization_id: string
  content: string
  status: string
  archived_at: string | null
  rule_set_version: number
  content_sha256: string
  assets_sha256: string
  input_sha256: string
  assets: ReviewAssetSnapshot[]
}

type ReviewAssetSnapshot = {
  id: string
  filename: string
  width: number
  height: number
  alt_text: string
  palette: unknown
}

type Finding = ReturnType<typeof runChecks>[number]
type AdminClient = SupabaseClient<any, 'public', 'public'>

function respondError(response: VercelResponse, status: number, message: string) {
  return response.status(status).json({ error: message })
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hashSnapshotText(values: Array<string | number | boolean | null>) {
  return sha256(JSON.stringify(values))
}

async function loadRules(admin: AdminClient, organizationId: string): Promise<CheckRule[]> {
  const rows: CheckRule[] = []
  let expectedCount: number | null = null
  for (let offset = 0; expectedCount === null || offset < expectedCount; offset += pageSize) {
    const { data, count, error } = await admin.from('brand_rules')
      .select('id,rule_key,version,category,title,description,source_label,severity,match_text,active,status', { count: 'exact' })
      .eq('organization_id', organizationId).eq('status', 'approved').eq('active', true)
      .order('id').range(offset, offset + pageSize - 1)
    if (error) throw error
    if (count === null) throw new Error('Approved rule count was unavailable.')
    if (expectedCount !== null && count !== expectedCount) throw new Error('Approved rules changed while loading.')
    expectedCount = count
    rows.push(...(data ?? []) as CheckRule[])
    if (offset >= expectedCount || !data?.length) break
  }
  if (rows.length !== expectedCount) throw new Error('Approved rule count did not match the loaded rows.')
  return rows
}

async function loadClaims(admin: AdminClient, organizationId: string): Promise<CheckClaim[]> {
  const rows: CheckClaim[] = []
  let expectedCount: number | null = null
  for (let offset = 0; expectedCount === null || offset < expectedCount; offset += pageSize) {
    const { data, count, error } = await admin.from('approved_claims')
      .select('id,version,statement,value,evidence_label,evidence_url,owner_label,reviewed_at,expires_at,active', { count: 'exact' })
      .eq('organization_id', organizationId).eq('active', true)
      .order('id').range(offset, offset + pageSize - 1)
    if (error) throw error
    if (count === null) throw new Error('Active claim count was unavailable.')
    if (expectedCount !== null && count !== expectedCount) throw new Error('Active claims changed while loading.')
    expectedCount = count
    rows.push(...(data ?? []) as CheckClaim[])
    if (offset >= expectedCount || !data?.length) break
  }
  if (rows.length !== expectedCount) throw new Error('Active claim count did not match the loaded rows.')
  return rows
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return respondError(response, 405, 'Method not allowed.')
  }
  const authorization = request.headers.authorization
  const tokenMatch = typeof authorization === 'string' ? /^Bearer\s+(.+)$/i.exec(authorization) : null
  if (!tokenMatch) return respondError(response, 401, 'Authentication required.')

  const body = request.body as { reviewId?: unknown } | undefined
  if (!body || typeof body.reviewId !== 'string' || !uuidPattern.test(body.reviewId)) {
    return respondError(response, 400, 'A valid reviewId is required.')
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    console.error('Review run endpoint is missing server environment configuration.')
    return respondError(response, 500, 'Review check could not be completed.')
  }

  try {
    const userClient = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${tokenMatch[1]}` } },
    })
    const { data: authData, error: authError } = await userClient.auth.getUser(tokenMatch[1])
    if (authError || !authData.user) return respondError(response, 401, 'Authentication required.')

    const { data: review, error: reviewError } = await userClient.from('reviews')
      .select('id,organization_id,status,archived_at')
      .eq('id', body.reviewId).maybeSingle()
    if (reviewError) throw reviewError
    if (!review) return respondError(response, 404, 'Review not found.')
    if (review.archived_at || !['draft', 'changes_requested'].includes(review.status)) {
      return respondError(response, 409, 'This review cannot be checked.')
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: inputs, error: inputsError } = await admin.rpc('assay_review_run_inputs', {
      target_review: review.id,
    })
    if (inputsError) throw inputsError
    const runInputs = inputs as ReviewRunInputs | null
    if (!runInputs) return respondError(response, 404, 'Review not found.')
    if (runInputs.organization_id !== review.organization_id) {
      throw new Error('The review organization changed while loading check inputs.')
    }
    if (runInputs.archived_at || !['draft', 'changes_requested'].includes(runInputs.status)) {
      return respondError(response, 409, 'This review cannot be checked.')
    }

    const [rules, claims] = await Promise.all([
      loadRules(admin, runInputs.organization_id),
      loadClaims(admin, runInputs.organization_id),
    ])
    const today = new Date().toISOString().slice(0, 10)
    const findings: Finding[] = [
      ...runChecks({ content: runInputs.content, rules, claims, today }),
      ...runInputs.assets.flatMap((asset) => runImageChecks({ asset, approvedPalette: DEFAULT_BRAND_PALETTE })),
    ]
    const ruleSnapshot = rules.map((rule) => ({
      id: rule.id,
      rule_key: rule.rule_key,
      version: rule.version,
      category: rule.category,
      status: rule.status,
      active: rule.active,
      title: rule.title,
      description: rule.description,
      source_label: rule.source_label,
      severity: rule.severity,
      match_text: rule.match_text,
      text_sha256: hashSnapshotText([rule.title, rule.description, rule.source_label, rule.match_text]),
    }))
    const claimSnapshot = claims.map((claim) => ({
      id: claim.id,
      version: claim.version,
      statement: claim.statement,
      value: claim.value ?? null,
      evidence_label: claim.evidence_label,
      evidence_url: claim.evidence_url ?? null,
      owner_label: claim.owner_label,
      reviewed_at: claim.reviewed_at ?? null,
      expires_at: claim.expires_at,
      active: claim.active,
      text_sha256: hashSnapshotText([
        claim.statement, claim.value ?? null, claim.evidence_label, claim.evidence_url ?? null,
        claim.owner_label, claim.reviewed_at ?? null, claim.expires_at, claim.active,
      ]),
    }))

    const { data: commitResult, error: commitError } = await admin.rpc('assay_commit_review_run', {
      target_review: review.id,
      target_user: authData.user.id,
      expected_content_sha256: runInputs.content_sha256,
      expected_assets_sha256: runInputs.assets_sha256,
      expected_input_sha256: runInputs.input_sha256,
      target_findings: findings,
      target_rule_snapshot: ruleSnapshot,
      target_claim_snapshot: claimSnapshot,
      target_asset_snapshot: runInputs.assets,
      target_engine_version: ENGINE_VERSION,
    })
    if (commitError) throw commitError

    const result = commitResult as { status?: string; content_sha256?: string; assets_sha256?: string; input_sha256?: string }
    if (result?.status === 'stale') return respondError(response, 409, 'The review changed during the check. Run it again.')
    if (result?.status === 'rate_limited') return respondError(response, 429, 'Please wait before running this check again.')
    if (result?.status === 'not_found') return respondError(response, 404, 'Review not found.')
    if (result?.status === 'not_editable') return respondError(response, 409, 'This review cannot be checked.')
    if (result?.status !== 'ok') throw new Error('Review run transaction returned an unexpected result.')

    return response.status(200).json({
      content_sha256: result.content_sha256,
      assets_sha256: result.assets_sha256,
      input_sha256: result.input_sha256,
      findings,
      finding_count: findings.length,
    })
  } catch (error) {
    console.error('Review run failed:', error)
    return respondError(response, 500, 'Review check could not be completed.')
  }
}
