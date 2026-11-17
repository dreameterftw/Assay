import { createHash, randomBytes } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const allowedRoles = new Set(['creator', 'manager', 'brand_reviewer', 'legal_reviewer'])
const defaultDailyLimit = 20

function respondError(response: VercelResponse, status: number, message: string) {
  return response.status(status).json({ error: message })
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    return respondError(response, 405, 'Method not allowed.')
  }
  const authorization = request.headers.authorization
  const tokenMatch = typeof authorization === 'string' ? /^Bearer\s+(.+)$/i.exec(authorization) : null
  if (!tokenMatch) return respondError(response, 401, 'Authentication required.')

  const body = request.body as { organizationId?: unknown; email?: unknown; role?: unknown } | undefined
  if (!body || typeof body.organizationId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.organizationId)) {
    return respondError(response, 400, 'A valid organizationId is required.')
  }
  if (typeof body.email !== 'string' || !emailPattern.test(body.email.trim())) {
    return respondError(response, 400, 'A valid email address is required.')
  }
  const email = normalizeEmail(body.email)
  const role = typeof body.role === 'string' ? body.role : ''
  if (!allowedRoles.has(role)) return respondError(response, 400, 'That role is not supported for invitations.')

  const supabaseUrl = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    console.error('Create-invite endpoint is missing server environment configuration.')
    return respondError(response, 500, 'Invitation could not be created.')
  }

  const apiKey = process.env.RESEND_API_KEY
  const fromAddress = process.env.INVITATION_FROM_EMAIL
  if (!apiKey || !fromAddress) {
    console.error('Invitation email provider is not configured.')
    return respondError(response, 503, 'Invitations are temporarily unavailable because email delivery is not configured.')
  }

  const configuredAppUrl = process.env.APP_URL
  if (process.env.NODE_ENV === 'production' && !configuredAppUrl) {
    console.error('APP_URL is required in production for invitation links.')
    return respondError(response, 503, 'Invitations are temporarily unavailable because the application URL is not configured.')
  }
  let appUrl: URL
  try {
    appUrl = new URL(configuredAppUrl ?? 'http://localhost:5173')
  } catch {
    console.error('APP_URL is invalid.')
    return respondError(response, 503, 'Invitations are temporarily unavailable because the application URL is invalid.')
  }
  if (process.env.NODE_ENV === 'production' && appUrl.protocol !== 'https:') {
    console.error('APP_URL must use HTTPS in production.')
    return respondError(response, 503, 'Invitations are temporarily unavailable because the application URL is invalid.')
  }

  const dailyLimit = Number(process.env.INVITATION_DAILY_LIMIT ?? defaultDailyLimit)
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1000) {
    console.error('INVITATION_DAILY_LIMIT must be an integer between 1 and 1000.')
    return respondError(response, 500, 'Invitation could not be created.')
  }

  try {
    const userClient = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${tokenMatch[1]}` } },
    })
    const { data: authData, error: authError } = await userClient.auth.getUser(tokenMatch[1])
    if (authError || !authData.user) return respondError(response, 401, 'Authentication required.')

    const { data: membership, error: membershipError } = await userClient
      .from('organization_members')
      .select('role')
      .eq('organization_id', body.organizationId)
      .eq('user_id', authData.user.id)
      .maybeSingle()
    if (membershipError) throw membershipError
    if (!membership) return respondError(response, 403, 'You are not a member of that workspace.')
    const rolesByCaller: Record<string, string[]> = {
      admin: ['creator', 'manager', 'brand_reviewer', 'legal_reviewer'],
      manager: ['creator'],
    }
    if (!rolesByCaller[membership.role]?.includes(role)) {
      return respondError(response, 403, 'You are not allowed to invite that role.')
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await admin.rpc('assay_create_invitation', {
      target_org: body.organizationId,
      target_actor: authData.user.id,
      target_email: email,
      target_role: role,
      target_token_hash: tokenHash,
      target_expires_at: expiresAt,
      target_daily_limit: dailyLimit,
    })
    if (error) throw error

    const result = data as { status?: string; invitation_id?: string }
    if (result?.status === 'forbidden') return respondError(response, 403, 'You are not allowed to invite that role.')
    if (result?.status === 'not_found') return respondError(response, 404, 'Workspace not found.')
    if (result?.status === 'daily_limit' || result?.status === 'rate_limited') {
      return respondError(response, 429, 'The invitation limit has been reached. Try again later.')
    }
    if (result?.status === 'already_pending') {
      return respondError(response, 409, 'An invitation for that email is already pending.')
    }
    if (result?.status !== 'created' || !result.invitation_id) {
      throw new Error('Invitation transaction returned an unexpected result.')
    }

    const inviteLink = new URL('/accept-invite', appUrl)
    inviteLink.searchParams.set('invite', token)
    try {
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [email],
          subject: 'You were invited to join Assay',
          html: `<p>You have been invited to join an Assay workspace.</p><p><a href="${inviteLink.toString()}">Accept your invitation</a></p><p>This link expires in 7 days.</p>`,
          text: `You have been invited to join Assay. Accept your invitation here: ${inviteLink.toString()}`,
        }),
      })
      if (!emailResponse.ok) {
        console.error('Invitation email delivery failed with HTTP status:', emailResponse.status)
        const { error: revokeError } = await admin.rpc('assay_revoke_invitation', {
          target_org: body.organizationId,
          target_invitation: result.invitation_id,
        })
        if (revokeError) console.error('Could not revoke undelivered invitation:', revokeError)
        return respondError(response, 502, 'The invitation was not delivered. Please try again later.')
      }
    } catch (error) {
      console.error('Invitation email delivery request failed:', error)
      const { error: revokeError } = await admin.rpc('assay_revoke_invitation', {
        target_org: body.organizationId,
        target_invitation: result.invitation_id,
      })
      if (revokeError) console.error('Could not revoke undelivered invitation:', revokeError)
      return respondError(response, 502, 'The invitation was not delivered. Please try again later.')
    }

    return response.status(201).json({
      status: 'created',
      organization_id: body.organizationId,
      role,
      expires_at: expiresAt,
    })
  } catch (error) {
    console.error('Invitation creation failed:', error)
    return respondError(response, 500, 'Invitation could not be created.')
  }
}
