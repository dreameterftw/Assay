import { createHash } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { ENGINE_VERSION, runChecks, type CheckClaim, type CheckRule } from '../src/lib/checks-core'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function respondError(response: VercelResponse, status: number, message: string) {
  return response.status(status).json({ error: message })
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
      .select('id, organization_id, content, status, archived_at, rule_set_version')
      .eq('id', body.reviewId).maybeSingle()
    if (reviewError) throw reviewError
    if (!review) return respondError(response, 404, 'Review not found.')
    if (review.archived_at || ['approved', 'waived'].includes(review.status)) {
      return respondError(response, 409, 'This review cannot be checked.')
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: allowed, error: rateLimitError } = await admin.rpc('assay_claim_review_run_slot', {
      target_review: review.id,
    })
    if (rateLimitError) throw rateLimitError
    if (!allowed) return respondError(response, 429, 'Please wait before running this check again.')

    const [rulesResult, claimsResult] = await Promise.all([
      admin.from('brand_rules').select('id,rule_key,category,title,description,source_label,severity,match_text,active,status')
        .eq('organization_id', review.organization_id).eq('status', 'approved').eq('active', true),
      admin.from('approved_claims').select('id,statement,evidence_label,owner_label,expires_at,active')
        .eq('organization_id', review.organization_id).eq('active', true),
    ])
    if (rulesResult.error) throw rulesResult.error
    if (claimsResult.error) throw claimsResult.error

    const rules = rulesResult.data as CheckRule[]
    const claims = claimsResult.data as CheckClaim[]
    const findings = runChecks({ content: review.content, rules, claims, today: new Date().toISOString().slice(0, 10) })
    const contentSha256 = createHash('sha256').update(review.content, 'utf8').digest('hex')
    const ruleSnapshot = rules.map(({ id, rule_key, category }) => ({ rule_id: id, rule_key, category }))
    const claimSnapshot = claims.map(({ id, statement, evidence_label, expires_at }) => ({ claim_id: id, statement, evidence_label, expires_at }))

    const findingRows = findings.map((finding) => ({
      organization_id: review.organization_id,
      review_id: review.id,
      ...finding,
    }))
    if (findingRows.length) {
      const { error } = await admin.from('review_findings').upsert(findingRows, {
        onConflict: 'organization_id,review_id,finding_key',
      })
      if (error) throw error
    }

    const { data: previousFindings, error: previousError } = await admin.from('review_findings')
      .select('id,finding_key').eq('organization_id', review.organization_id).eq('review_id', review.id)
      .in('source_kind', ['rule', 'claim'])
    if (previousError) throw previousError
    const currentKeys = new Set(findings.map((finding) => finding.finding_key))
    const staleIds = (previousFindings ?? []).filter((finding) => !currentKeys.has(finding.finding_key)).map((finding) => finding.id)
    if (staleIds.length) {
      const { error } = await admin.from('review_findings').delete()
        .eq('organization_id', review.organization_id).eq('review_id', review.id).in('id', staleIds)
      if (error) throw error
    }

    if (findings.some((finding) => finding.source_kind === 'claim')) {
      const { error } = await admin.from('reviews').update({ risk_tier: 'high' })
        .eq('organization_id', review.organization_id).eq('id', review.id)
      if (error) throw error
    }
    const { error: runError } = await admin.from('review_runs').insert({
      organization_id: review.organization_id,
      review_id: review.id,
      requested_by: authData.user.id,
      content_sha256: contentSha256,
      rule_snapshot: ruleSnapshot,
      claim_snapshot: claimSnapshot,
      finding_count: findings.length,
      engine_version: ENGINE_VERSION,
    })
    if (runError) throw runError

    const { error: eventError } = await admin.from('review_events').insert({
      organization_id: review.organization_id,
      review_id: review.id,
      actor_id: authData.user.id,
      action: 'checks_run',
      detail: { content_sha256: contentSha256, finding_count: findings.length, engine_version: ENGINE_VERSION },
      rule_set_version: review.rule_set_version,
    })
    if (eventError) throw eventError

    return response.status(200).json({ content_sha256: contentSha256, findings, finding_count: findings.length })
  } catch (error) {
    console.error('Review run failed:', error)
    return respondError(response, 500, 'Review check could not be completed.')
  }
}
