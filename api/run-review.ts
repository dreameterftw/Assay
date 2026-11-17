import { createHash } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import {
  ENGINE_VERSION,
  runChecks,
  runImageChecks,
  type CheckClaim,
  type CheckRule,
} from '../src/lib/checks-core.js'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maxImageBytes = 5 * 1024 * 1024
const maxFindings = 500

type ReviewAssetSnapshot = {
  id: string
  bucket_id: string
  object_path: string
  filename: string
  mime_type: 'image/png' | 'image/jpeg' | 'image/webp'
  size_bytes: number
  width: number
  height: number
  alt_text: string
  palette: unknown
}

type ReviewRunInputs = {
  review_id: string
  organization_id: string
  content: string
  status: string
  archived_at: string | null
  rule_set_version: number
  content_sha256: string
  assets_sha256: string
  rules_sha256: string
  claims_sha256: string
  input_sha256: string
  valid_until: string
  assets: ReviewAssetSnapshot[]
  rules: CheckRule[]
  claims: CheckClaim[]
}

type Finding = ReturnType<typeof runChecks>[number]
type AdminClient = SupabaseClient<any, 'public', 'public'>

function respondError(response: VercelResponse, status: number, message: string) {
  return response.status(status).json({ error: message })
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function detectImageMime(bytes: Buffer): ReviewAssetSnapshot['mime_type'] | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return null
}

function colorHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

async function analyzeAsset(admin: AdminClient, organizationId: string, reviewId: string, asset: ReviewAssetSnapshot) {
  const expectedPathPrefix = `${organizationId}/${reviewId}/`
  if (asset.bucket_id !== 'assay-review-assets' || !asset.object_path.startsWith(expectedPathPrefix)) {
    throw new Error(`Image asset ${asset.id} has an invalid bucket path.`)
  }
  const { data: blob, error } = await admin.storage.from(asset.bucket_id).download(asset.object_path)
  if (error || !blob) throw error ?? new Error(`Image asset ${asset.id} is missing from storage.`)
  if (blob.size < 1 || blob.size > maxImageBytes || blob.size !== asset.size_bytes) {
    throw new Error(`Image asset ${asset.id} has an invalid size.`)
  }

  const bytes = Buffer.from(await blob.arrayBuffer())
  const detectedMime = detectImageMime(bytes)
  if (!detectedMime || detectedMime !== asset.mime_type) {
    throw new Error(`Image asset ${asset.id} does not match its declared image type.`)
  }

  const image = sharp(bytes, { limitInputPixels: 40_000_000 })
  const metadata = await image.metadata()
  const expectedFormat = detectedMime === 'image/jpeg' ? 'jpeg' : detectedMime.slice('image/'.length)
  if (metadata.format !== expectedFormat || !metadata.width || !metadata.height) {
    throw new Error(`Image asset ${asset.id} could not be decoded as its declared type.`)
  }
  if (metadata.width > 50_000 || metadata.height > 50_000) {
    throw new Error(`Image asset ${asset.id} dimensions exceed the supported limit.`)
  }

  const { data, info } = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 64, height: 64, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer({ resolveWithObject: true })
  const histogram = new Map<string, { count: number; red: number; green: number; blue: number }>()
  const luminances: number[] = []
  for (let offset = 0; offset + 2 < data.length; offset += info.channels) {
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const key = [red, green, blue].map((channel) => Math.floor(channel / 16)).join(':')
    const bucket = histogram.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 }
    bucket.count += 1
    bucket.red += red
    bucket.green += green
    bucket.blue += blue
    histogram.set(key, bucket)
    const linear = [red, green, blue].map((channel) => {
      const value = channel / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    luminances.push(0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2])
  }

  const palette = [...histogram.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
    .map((bucket) => colorHex(bucket.red / bucket.count, bucket.green / bucket.count, bucket.blue / bucket.count))
  const sortedLuminances = luminances.sort((left, right) => left - right)
  const lower = sortedLuminances[Math.floor(sortedLuminances.length * 0.05)] ?? 0
  const upper = sortedLuminances[Math.min(sortedLuminances.length - 1, Math.floor(sortedLuminances.length * 0.95))] ?? 0
  const contrastRatio = (Math.max(upper, lower) + 0.05) / (Math.min(upper, lower) + 0.05)

  const swapsDimensions = [5, 6, 7, 8].includes(metadata.orientation ?? 0)
  return {
    ...asset,
    width: swapsDimensions ? metadata.height : metadata.width,
    height: swapsDimensions ? metadata.width : metadata.height,
    palette,
    contrastRatio,
  }
}

function paletteFromRules(rules: CheckRule[]) {
  const colors = new Set<string>()
  for (const rule of rules) {
    if (rule.category !== 'visual') continue
    for (const text of [rule.title, rule.description, rule.match_text]) {
      for (const match of text.matchAll(/#[0-9a-f]{6}\b/gi)) colors.add(match[0].toLowerCase())
    }
  }
  return [...colors].map((hex) => ({ name: hex, hex }))
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
      .select('id,organization_id,status,archived_at,created_by')
      .eq('id', body.reviewId).maybeSingle()
    if (reviewError) throw reviewError
    if (!review) return respondError(response, 404, 'Review not found.')
    if (review.archived_at || !['draft', 'changes_requested'].includes(review.status)) {
      return respondError(response, 409, 'This review cannot be checked.')
    }

    const { data: membership, error: membershipError } = await userClient.from('organization_members')
      .select('role')
      .eq('organization_id', review.organization_id)
      .eq('user_id', authData.user.id)
      .maybeSingle()
    if (membershipError) throw membershipError
    const role = membership?.role
    const isCreator = role === 'creator' && review.created_by === authData.user.id
    const isReviewer = ['admin', 'manager', 'brand_reviewer', 'legal_reviewer'].includes(role ?? '')
    if (!isCreator && !isReviewer) return respondError(response, 403, 'You are not allowed to run checks for this review.')

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

    const analyzedAssets = []
    for (const asset of runInputs.assets) {
      analyzedAssets.push(await analyzeAsset(admin, runInputs.organization_id, runInputs.review_id, asset))
    }
    const today = new Date().toISOString().slice(0, 10)
    const approvedPalette = paletteFromRules(runInputs.rules)
    const findings: Finding[] = [
      ...runChecks({ content: runInputs.content, rules: runInputs.rules, claims: runInputs.claims, today }),
      ...analyzedAssets.flatMap((asset) => runImageChecks({ asset, approvedPalette })),
    ]
    if (findings.length > maxFindings) {
      return respondError(response, 422, 'This review has too many findings to save. Narrow the content or rule set and try again.')
    }

    const { data: commitResult, error: commitError } = await admin.rpc('assay_commit_review_run', {
      target_review: review.id,
      target_user: authData.user.id,
      expected_content_sha256: runInputs.content_sha256,
      expected_assets_sha256: runInputs.assets_sha256,
      expected_rules_sha256: runInputs.rules_sha256,
      expected_claims_sha256: runInputs.claims_sha256,
      expected_input_sha256: runInputs.input_sha256,
      target_findings: findings,
      target_rule_snapshot: runInputs.rules,
      target_claim_snapshot: runInputs.claims,
      target_asset_snapshot: runInputs.assets,
      target_engine_version: ENGINE_VERSION,
    })
    if (commitError) throw commitError

    const result = commitResult as {
      status?: string
      content_sha256?: string
      assets_sha256?: string
      rules_sha256?: string
      claims_sha256?: string
      input_sha256?: string
      valid_until?: string
    }
    if (result?.status === 'stale') return respondError(response, 409, 'The review changed during the check. Run it again.')
    if (result?.status === 'rate_limited') return respondError(response, 429, 'Please wait before running this check again.')
    if (result?.status === 'not_found') return respondError(response, 404, 'Review not found.')
    if (result?.status === 'not_editable') return respondError(response, 409, 'This review cannot be checked.')
    if (result?.status !== 'ok') throw new Error('Review run transaction returned an unexpected result.')

    return response.status(200).json({
      content_sha256: result.content_sha256,
      assets_sha256: result.assets_sha256,
      rules_sha256: result.rules_sha256,
      claims_sha256: result.claims_sha256,
      input_sha256: result.input_sha256,
      valid_until: result.valid_until,
      finding_count: findings.length,
    })
  } catch (error) {
    console.error('Review run failed:', error)
    return respondError(response, 500, 'Review check could not be completed.')
  }
}
