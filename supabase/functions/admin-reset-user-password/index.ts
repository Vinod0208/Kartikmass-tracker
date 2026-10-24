import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Server configuration is incomplete. Set the Supabase function secrets.' }, 500)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'You must be logged in as an admin.' }, 401)

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: authError } = await callerClient.auth.getUser()
  if (authError || !userData.user) return json({ error: 'Your session is invalid or expired. Please sign in again.' }, 401)

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: callerProfile, error: roleError } = await adminClient
    .from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
  if (roleError || callerProfile?.role !== 'admin') return json({ error: 'Only an admin can reset user passwords.' }, 403)

  let body: { userId?: unknown; password?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Request body must be valid JSON.' }, 400) }
  const targetId = typeof body.userId === 'string' ? body.userId : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidPattern.test(targetId)) return json({ error: 'A valid user ID is required.' }, 400)
  if (password.length < 8 || password.length > 128) return json({ error: 'Password must be between 8 and 128 characters.' }, 400)
  if (targetId === userData.user.id) return json({ error: 'Use your own account settings to change your admin password.' }, 400)

  const { data: targetProfile, error: targetError } = await adminClient
    .from('profiles').select('role').eq('id', targetId).maybeSingle()
  if (targetError) return json({ error: 'Could not verify the target account.' }, 500)
  if (!targetProfile) return json({ error: 'This user account was not found.' }, 404)
  if (targetProfile.role === 'admin') return json({ error: 'Admin passwords cannot be reset from this screen.' }, 403)

  const { error: updateError } = await adminClient.auth.admin.updateUserById(targetId, { password })
  if (updateError) return json({ error: `Supabase could not reset the password: ${updateError.message}` }, 500)
  return json({ success: true })
})
