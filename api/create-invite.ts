import { createHash, randomBytes } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const allowedRoles = new Set(['creator', 'manager', 'brand_reviewer', 'legal_reviewer']) as Set<string>
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
  if (!body || typeof body.organizationId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.organizationId)) {
    return respondError(response, 400, 'A valid organizationId is required.')
  }
  if (typeof body.email !== 'string' || !emailPattern.test(body.email)) {
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

  try {
    const userClient = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${tokenMatch[1]}` } },
    })
    const { data: authData, error: authError } = await userClient.auth.getUser(tokenMatch[1])
    if (authError || !authData.user) return respondError(response, 401, 'Authentication required.')

    const { data: membership, error: membershipError } = await userClient
      .from('organization_members')
      .select('role, organization_id')
      .eq('organization_id', body.organizationId)
      .eq('user_id', authData.user.id)
      .maybeSingle()
    if (membershipError) throw membershipError
    if (!membership) return respondError(response, 403, 'You are not a member of that workspace.')

    const callerRole = membership.role as string
    const allowedInvitationRoles = callerRole === 'admin'
      ? ['creator', 'manager', 'brand_reviewer', 'legal_reviewer']
      : callerRole === 'manager'
        ? ['creator']
        : []
    if (!allowedInvitationRoles.includes(role)) {
      return respondError(response, 403, 'You are not allowed to invite that role.')
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const dailyLimit = Number(process.env.INVITATION_DAILY_LIMIT ?? defaultDailyLimit)
    const now = new Date()
    const dayStart = new Date(now)
    dayStart.setUTCHours(0, 0, 0, 0)
    const { count, error: countError } = await admin.from('workspace_invitations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', body.organizationId)
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString())
    if (countError) throw countError
    if (typeof count === 'number' && count >= dailyLimit) {
      return respondError(response, 429, 'The organization has reached its invitation limit for today.')
    }

    const token = randomBytes(32).toString('base64url')
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { error: insertError } = await admin.from('workspace_invitations').insert({
      organization_id: body.organizationId,
      email,
      role,
      token_hash: tokenHash,
      invited_by: authData.user.id,
      expires_at: expiresAt,
      accepted_at: null,
    })
    if (insertError) {
      if (insertError.code === '23505') {
        return respondError(response, 409, 'An invitation for that email already exists for this workspace.')
      }
      throw insertError
    }

    const baseUrl = process.env.APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:5173')
    const inviteLink = `${baseUrl}/accept-invite?token=${encodeURIComponent(token)}`

    const fromAddress = process.env.INVITATION_FROM_EMAIL ?? 'noreply@example.invalid'
    const apiKey = process.env.RESEND_API_KEY
    if (apiKey && fromAddress !== 'noreply@example.invalid') {
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
          html: `<p>You have been invited to join an Assay workspace.</p><p><a href="${inviteLink}">Accept your invitation</a></p><p>This link expires in 7 days.</p>`,
          text: `You have been invited to join Assay. Accept your invitation here: ${inviteLink}`,
        }),
      })
      if (!emailResponse.ok) {
        const errorText = await emailResponse.text().catch(() => '')
        console.error('Invitation email delivery failed:', errorText)
      }
    } else {
      console.warn('Invitation created without a configured Resend delivery provider; email was not sent.')
    }

    return response.status(200).json({
      status: 'created',
      organization_id: body.organizationId,
      role,
      expires_at: expiresAt,
      email,
    })
  } catch (error) {
    console.error('Invitation creation failed:', error)
    return respondError(response, 500, 'Invitation could not be created.')
  }
}
