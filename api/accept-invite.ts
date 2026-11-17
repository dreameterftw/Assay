import { createHash } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const tokenPattern = /^[A-Za-z0-9_-]{32,256}$/

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

  const body = request.body as { inviteToken?: unknown } | undefined
  if (!body || typeof body.inviteToken !== 'string' || !tokenPattern.test(body.inviteToken)) {
    return respondError(response, 400, 'A valid invitation token is required.')
  }

  const supabaseUrl = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    console.error('Invitation acceptance endpoint is missing server environment configuration.')
    return respondError(response, 500, 'Invitation could not be accepted.')
  }

  try {
    const userClient = createClient(supabaseUrl, publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${tokenMatch[1]}` } },
    })
    const { data: authData, error: authError } = await userClient.auth.getUser(tokenMatch[1])
    if (authError || !authData.user?.email) return respondError(response, 401, 'Authentication required.')
    if (!authData.user.email_confirmed_at) {
      return respondError(response, 403, 'Confirm your email address before accepting this invitation.')
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const tokenHash = createHash('sha256').update(body.inviteToken, 'utf8').digest('hex')
    const { data, error } = await admin.rpc('assay_accept_workspace_invitation', {
      target_token_hash: tokenHash,
      target_user: authData.user.id,
      target_email: authData.user.email,
      target_email_confirmed: true,
    })
    if (error) throw error

    const result = data as { status?: string; organization_id?: string; role?: string }
    if (result?.status === 'accepted' && result.organization_id && result.role) {
      return response.status(200).json({ organization_id: result.organization_id, role: result.role })
    }
    if (result?.status === 'already_member') {
      return respondError(response, 409, 'This account already belongs to that workspace.')
    }
    return respondError(response, 404, 'Invitation is invalid or expired.')
  } catch (error) {
    console.error('Invitation acceptance failed:', error)
    return respondError(response, 500, 'Invitation could not be accepted.')
  }
}
