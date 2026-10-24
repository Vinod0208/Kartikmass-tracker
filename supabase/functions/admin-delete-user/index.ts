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

  // Validate the caller's access token with the public/anon client.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: userData, error: authError } = await callerClient.auth.getUser()
  if (authError || !userData.user) return json({ error: 'Your session is invalid or expired. Please sign in again.' }, 401)

  // Check admin role in the database; never trust a role sent by the browser.
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: callerProfile, error: roleError } = await adminClient
    .from('profiles').select('role').eq('id', userData.user.id).maybeSingle()
  if (roleError || callerProfile?.role !== 'admin') return json({ error: 'Only an admin can delete user accounts.' }, 403)

  let body: { userId?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Request body must be valid JSON.' }, 400) }
  const targetId = typeof body.userId === 'string' ? body.userId : ''
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidPattern.test(targetId)) return json({ error: 'A valid user ID is required.' }, 400)
  if (targetId === userData.user.id) return json({ error: 'You cannot delete your own admin account here.' }, 400)

  const { data: targetProfile, error: targetError } = await adminClient
    .from('profiles').select('role').eq('id', targetId).maybeSingle()
  if (targetError) return json({ error: 'Could not verify the target account.' }, 500)
  if (!targetProfile) return json({ error: 'This user account was not found.' }, 404)
  if (targetProfile.role === 'admin') return json({ error: 'Admin accounts cannot be deleted from this screen.' }, 403)

  // profiles.id references auth.users(id) ON DELETE CASCADE. Deleting the Auth user
  // therefore cascades to profiles, user_vows, and daily_logs in the provided schema.
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(targetId)
  if (deleteError) return json({ error: `Supabase could not delete the account: ${deleteError.message}` }, 500)

  return json({ success: true })
})
