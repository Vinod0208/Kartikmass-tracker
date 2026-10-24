import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  Activity, CalendarDays, Check, CheckCircle2, ChevronDown, CircleHelp,
  ClipboardList, Download, Flame, Heart, LayoutDashboard, LogOut, Plus,
  ShieldCheck, Sparkles, Users, X, Trash2
} from 'lucide-react'
import { hasSupabaseConfig, supabase } from './lib/supabase'
import type { DailyLog, Profile, Selection, Vow } from './types'

const PROGRAM_KEY = 'kartik'
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
type LogDraft = { quantity: string; unit: string; progress: number; completed: boolean; reason: string; notes: string }

function App() {
  const [session, setSession] = useState<any>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [screen, setScreen] = useState<'dashboard' | 'choose' | 'admin'>('dashboard')
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [savingVow, setSavingVow] = useState(false)
  const [authName, setAuthName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [vows, setVows] = useState<Vow[]>([])
  const [selections, setSelections] = useState<Selection[]>([])
  const [logs, setLogs] = useState<DailyLog[]>([])
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [newVow, setNewVow] = useState({ name: '', description: '', category: 'Personal', unit: '' })
  const [drafts, setDrafts] = useState<Record<string, LogDraft>>({})
  const [logDate, setLogDate] = useState(today())
  const [loading, setLoading] = useState(false)
  const [adminUsers, setAdminUsers] = useState<Profile[]>([])
  const [adminSelections, setAdminSelections] = useState<(Selection & { profile?: Profile })[]>([])
  const [adminLogs, setAdminLogs] = useState<(DailyLog & { profile?: Profile; vow?: Vow })[]>([])
  const [adminSearch, setAdminSearch] = useState('')
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null)
  const [resettingUserId, setResettingUserId] = useState<string | null>(null)

  const notify = (msg: string) => { setNotice(msg); window.setTimeout(() => setNotice(''), 5000) }

  const loadCore = useCallback(async (userId: string) => {
    if (!supabase) return
    setLoading(true)
    const [vowRes, selectionRes, logRes, profileRes] = await Promise.all([
      supabase.from('vows').select('*').order('name'),
      supabase.from('user_vows').select('*, vow:vows(*)').eq('user_id', userId).eq('program_key', PROGRAM_KEY),
      supabase.from('daily_logs').select('*').eq('user_id', userId).order('log_date', { ascending: false }),
      supabase.from('profiles').select('*').eq('id', userId).single()
    ])
    if (vowRes.error) notify(vowRes.error.message)
    if (selectionRes.error) notify(selectionRes.error.message)
    if (logRes.error) notify(logRes.error.message)
    setVows(vowRes.data || [])
    setSelections((selectionRes.data || []) as Selection[])
    setLogs((logRes.data || []) as DailyLog[])
    if (profileRes.data) setProfile(profileRes.data as Profile)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (session?.user?.id) void loadCore(session.user.id)
    else { setProfile(null); setVows([]); setSelections([]); setLogs([]) }
  }, [session?.user?.id, loadCore])

  useEffect(() => {
    const next: Record<string, LogDraft> = {}
    selections.forEach(sel => {
      const log = logs.find(l => l.vow_id === sel.vow_id && l.log_date === logDate)
      next[sel.vow_id] = log
        ? { quantity: log.quantity == null ? '' : String(log.quantity), unit: log.unit || sel.vow?.unit || '', progress: log.progress_percent, completed: log.completed, reason: log.reason || '', notes: log.notes || '' }
        : { quantity: '', unit: sel.vow?.unit || '', progress: 0, completed: false, reason: '', notes: '' }
    })
    setDrafts(next)
  }, [selections, logs, logDate])

  const myVows = useMemo(() => selections.map(s => ({ ...s.vow!, selectionId: s.id })).filter(v => v.id), [selections])
  const todayLogs = logs.filter(l => l.log_date === today())
  const dailyPercent = myVows.length
    ? Math.round(myVows.reduce((sum, v) => sum + (todayLogs.find(l => l.vow_id === v.id)?.progress_percent || 0), 0) / myVows.length)
    : 0


  async function handleAuth(e: FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setAuthBusy(true); setNotice('')
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: authEmail.trim(), password: authPassword, options: { data: { full_name: authName.trim() } } })
        if (error) throw error
        if (data.session) notify('Account created. Welcome! Choose your Kartik sankalps.')
        else notify('Account created. If you cannot sign in, ask the temple admin to check Supabase email-confirmation settings.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: authEmail.trim(), password: authPassword })
        if (error) throw error
      }
    } catch (err: any) { notify(err.message || 'Authentication failed.') }
    finally { setAuthBusy(false) }
  }

  async function signOut() {
    if (supabase) await supabase.auth.signOut()
    setScreen('dashboard')
  }

  async function addVow(e: FormEvent) {
    e.preventDefault()
    if (!supabase || !profile) return
    setSavingVow(true)
    const name = newVow.name.trim()
    if (name.length < 3) { setSavingVow(false); return notify('Please enter a vow name with at least 3 characters.') }
    const duplicate = vows.some(v => v.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (duplicate) { setSavingVow(false); return notify('A similar vow already exists in the shared list.') }
    const { data, error } = await supabase.from('vows').insert({
      name, description: newVow.description.trim() || null,
      category: newVow.category.trim() || 'Personal', unit: newVow.unit.trim() || null,
      created_by: profile.id
    }).select().single()
    if (error) { setSavingVow(false); return notify(error.message) }
    setSavingVow(false)
    setVows(old => [...old, data as Vow].sort((a, b) => a.name.localeCompare(b.name)))
    setSelectedIds(old => [...old, data.id])
    setNewVow({ name: '', description: '', category: 'Personal', unit: '' })
    notify('Vow added to the shared list and selected for you.')
  }

  async function saveSelections() {
    if (!supabase || !profile) return
    if (!selectedIds.length) return notify('Please select at least one vow.')
    setLoading(true)
    try {
      const { error } = await supabase.rpc('save_initial_kartik_sankalps', { p_vow_ids: [...new Set(selectedIds)] })
      if (error) throw error
      await loadCore(profile.id)
      setScreen('dashboard')
      notify('Your Kartik sankalps are saved and locked.')
    } catch (err: any) {
      notify(err.message || 'Could not save sankalps. Please refresh and try again.')
    } finally { setLoading(false) }
  }

  async function saveTodayCheckin() {
    if (!supabase || !profile) return
    if (!myVows.length) return notify('Please save your sankalps before checking in.')
    setLoading(true)
    try {
      const currentDay = today()
      const rows = myVows.map(vow => {
        const completed = Boolean(drafts[vow.id]?.completed)
        return {
          user_id: profile.id,
          vow_id: vow.id,
          log_date: currentDay,
          quantity: null,
          unit: null,
          progress_percent: completed ? 100 : 0,
          completed,
          reason: null,
          notes: null,
          updated_at: new Date().toISOString()
        }
      })
      const { error } = await supabase.from('daily_logs').upsert(rows, { onConflict: 'user_id,vow_id,log_date' })
      if (error) throw error
      setLogDate(currentDay)
      await loadCore(profile.id)
      notify('Today’s sankalp check-in saved.')
    } catch (err: any) {
      notify(err.message || 'Could not save today’s check-in. Please try again.')
    } finally {
      setLoading(false)
    }
  }


  async function loadAdmin() {
    if (!supabase || profile?.role !== 'admin') return
    setLoading(true)
    const [usersRes, selectionsRes, logsRes] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('user_vows').select('*, vow:vows(*)').eq('program_key', PROGRAM_KEY),
      supabase.from('daily_logs').select('*').order('log_date', { ascending: false }).limit(1500)
    ])
    if (usersRes.error || selectionsRes.error || logsRes.error) notify(usersRes.error?.message || selectionsRes.error?.message || logsRes.error?.message || 'Could not load admin report.')
    setAdminUsers((usersRes.data || []) as Profile[])
    const profilesById = new Map((usersRes.data || []).map((p: any) => [p.id, p as Profile]))
    setAdminSelections((selectionsRes.data || []).map((s: any) => ({ ...s, profile: profilesById.get(s.user_id) })) as any)
    const vowById = new Map(vows.map(v => [v.id, v]))
    setAdminLogs((logsRes.data || []).map((l: any) => ({ ...l, profile: profilesById.get(l.user_id), vow: vowById.get(l.vow_id) })) as any)
    setLoading(false)
  }

  useEffect(() => { if (screen === 'admin' && profile?.role === 'admin') void loadAdmin() }, [screen, profile?.role, vows.length])

  async function resetDevoteePassword(user: Profile) {
    if (!supabase || profile?.role !== 'admin' || user.role === 'admin') return
    const temporaryPassword = window.prompt(`Set a temporary password for ${user.full_name || user.email || 'this devotee'}. Use at least 8 characters and share it privately.`)
    if (temporaryPassword === null) return
    if (temporaryPassword.length < 8) return notify('Temporary password must be at least 8 characters.')
    if (!window.confirm(`Set this temporary password for ${user.full_name || user.email || 'this devotee'}? Share it privately and ask them to change it after signing in.`)) return
    setResettingUserId(user.id)
    const { data, error } = await supabase.functions.invoke('admin-reset-user-password', { body: { userId: user.id, password: temporaryPassword } })
    setResettingUserId(null)
    if (error) {
      let detail = error.message || 'Could not reset password.'
      try { const body = await error.context?.json?.(); if (body?.error) detail = body.error } catch { /* Keep SDK message. */ }
      notify(`${detail} Make sure the admin-reset-user-password Edge Function is deployed.`)
      return
    }
    if (data?.error) return notify(data.error)
    notify('Temporary password set. Share it privately with the devotee.')
  }

  async function deleteDevotee(user: Profile) {
    if (!supabase || profile?.role !== 'admin' || user.role === 'admin') return
    const confirmed = window.confirm(
      `Permanently delete ${user.full_name || user.email || 'this devotee'}?\n\nTheir account, selected sankalps, and all daily progress/history will be deleted. This cannot be undone.`
    )
    if (!confirmed) return
    setDeletingUserId(user.id)
    const { data, error } = await supabase.functions.invoke('admin-delete-user', { body: { userId: user.id } })
    setDeletingUserId(null)
    if (error) {
      let detail = error.message || 'Could not delete user.'
      try {
        const body = await error.context?.json?.()
        if (body?.error) detail = body.error
      } catch { /* Keep the SDK error message. */ }
      notify(`${detail} Make sure the admin-delete-user Edge Function is deployed and configured.`)
      return
    }
    if (data?.error) return notify(data.error)
    notify('Devotee account and associated progress deleted.')
    await loadAdmin()
  }

  function exportCSV() {
    const rows = [['User', 'Email', 'Date', 'Vow', 'Quantity', 'Unit', 'Progress %', 'Completed', 'Reason', 'Notes']]
    adminLogs.forEach(l => rows.push([
      l.profile?.full_name || '', l.profile?.email || '', l.log_date, l.vow?.name || l.vow_id,
      l.quantity == null ? '' : String(l.quantity), l.unit || '', String(l.progress_percent),
      l.completed ? 'Yes' : 'No', l.reason || '', l.notes || ''
    ]))
    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'iskcon-kartik-sankalp-report.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  if (!hasSupabaseConfig) return <SetupScreen />
  if (!session) return <AuthScreen
    mode={authMode} setMode={setAuthMode} name={authName} setName={setAuthName}
    email={authEmail} setEmail={setAuthEmail} password={authPassword} setPassword={setAuthPassword}
    busy={authBusy} onSubmit={handleAuth} notice={notice} />

  const firstVisit = selections.length === 0

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-mark"><Flame size={25} /></div>
      <div className="brand-copy"><strong>Kartik Sankalp</strong><span>ISKCON Dehradun</span></div>
      <div className="program-chip"><Sparkles size={15} /> Kartik Maas Program</div>
      <nav>
        <button className={screen === 'dashboard' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('dashboard')}><LayoutDashboard size={18} /> My Dashboard</button>
        {firstVisit && <button className={screen === 'choose' ? 'nav-item active' : 'nav-item'} onClick={() => { setSelectedIds(selections.map(s => s.vow_id)); setScreen('choose') }}><ClipboardList size={18} /> Choose Sankalps</button>}
        {profile?.role === 'admin' && <button className={screen === 'admin' ? 'nav-item active' : 'nav-item'} onClick={() => setScreen('admin')}><ShieldCheck size={18} /> Admin Dashboard</button>}
      </nav>
      <div className="sidebar-bottom">
        <div className="user-mini"><div className="avatar">{(profile?.full_name || profile?.email || 'D').slice(0, 1).toUpperCase()}</div><div><strong>{profile?.full_name || 'Devotee'}</strong><span>{profile?.role === 'admin' ? 'Temple Admin' : 'Devotee'}</span></div></div>
        <button className="nav-item logout" onClick={signOut}><LogOut size={18} /> Sign out</button>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <div><span className="eyebrow">Hare Krishna</span><h1>{screen === 'admin' ? 'Temple Overview' : screen === 'choose' ? 'My Sankalp Selection' : 'My Sankalp Dashboard'}</h1></div>
        <div className="topbar-right"><div className="date-pill"><CalendarDays size={16} /> {new Date(`${today()}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</div><div className="avatar top-avatar">{(profile?.full_name || 'D').slice(0, 1).toUpperCase()}</div></div>
      </header>

      {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={16}/></button></div>}
      {loading && <div className="loading-line"><span /></div>}

      {screen === 'choose' && <section className="content-stack">
        <div className="section-intro"><div><h2>Choose your Kartik vows</h2><p>Select the vows you want to observe throughout Kartik Maas. You can select multiple vows.</p></div><span className="count-badge">{selectedIds.length} selected</span></div>
        <div className="notice-card"><Heart size={20}/><p>Choose sincerely and follow the guidance shared by ISKCON Dehradun. Your selected vows will be private to your account.</p></div>
        <form className="panel add-vow-panel" onSubmit={addVow}>
          <div className="panel-heading"><div><h3>Add a new shared vow</h3><p>Your vow will be visible immediately to all signed-in devotees.</p></div><div className="icon-soft"><Plus size={19}/></div></div>
          <div className="form-grid">
            <label className="field"><span>Vow name *</span><input required minLength={3} maxLength={120} value={newVow.name} onChange={e => setNewVow({...newVow, name:e.target.value})} placeholder="e.g. Read one chapter daily"/></label>
            <label className="field"><span>Category</span><input maxLength={60} value={newVow.category} onChange={e => setNewVow({...newVow, category:e.target.value})} placeholder="Japa, Study, Seva..."/></label>
            <label className="field"><span>Unit (optional)</span><input maxLength={40} value={newVow.unit} onChange={e => setNewVow({...newVow, unit:e.target.value})} placeholder="rounds, minutes, chapters"/></label>
            <label className="field"><span>Description (optional)</span><input maxLength={300} value={newVow.description} onChange={e => setNewVow({...newVow, description:e.target.value})} placeholder="Short explanation"/></label>
          </div>
          <button className="btn btn-secondary" type="submit" disabled={savingVow}>{savingVow ? <><span className="spinner"/> Adding…</> : <><Plus size={17}/> Add to shared list</>}</button>
        </form>

        <div className="vow-grid">
          {vows.map(vow => <label key={vow.id} className={selectedIds.includes(vow.id) ? 'vow-card selected' : 'vow-card'}>
            <input type="checkbox" checked={selectedIds.includes(vow.id)} onChange={e => setSelectedIds(old => e.target.checked ? [...old, vow.id] : old.filter(id => id !== vow.id))}/>
            <span className="custom-check">{selectedIds.includes(vow.id) && <Check size={15}/>}</span>
            <div className="vow-card-icon"><Sparkles size={18}/></div>
            <strong>{vow.name}</strong><p>{vow.description || 'A personal Kartik sankalp.'}</p>
            <div className="vow-meta"><span>{vow.category}</span>{vow.unit && <span>Unit: {vow.unit}</span>}</div>
          </label>)}
        </div>
        <div className="sticky-actions"><span>{selectedIds.length} vows selected</span><button className="btn btn-primary" disabled={loading || !selectedIds.length} onClick={saveSelections}>{loading ? <><span className="spinner"/> Saving…</> : <>Save my sankalps <CheckCircle2 size={17}/></>}</button></div>
      </section>}

      {screen === 'dashboard' && <section className="content-stack">
        {firstVisit ? <div className="welcome-card"><div className="welcome-symbol"><Flame size={30}/></div><div><span className="eyebrow light">Your Kartik journey begins here</span><h2>Take your Sankalp</h2><p>Choose the vows you wish to observe this Kartik Maas. Your selected vows will appear here every time you return.</p><button className="btn btn-light" onClick={() => setScreen('choose')}>Choose my vows <ChevronDown size={17}/></button></div></div> :
        <>
          <div className="welcome-card"><div className="welcome-symbol"><Flame size={30}/></div><div><span className="eyebrow light">Kartik Maas · Your daily practice</span><h2>Hare Krishna, {profile?.full_name?.split(' ')[0] || 'Devotee'}!</h2><p>One day, one step, one sincere offering at a time.</p></div><div className="welcome-stat"><strong>{myVows.length}</strong><span>My sankalps</span></div></div>
          <div className="stats-grid">
            <Stat icon={<ClipboardList size={19}/>} label="My Sankalps" value={String(myVows.length)} detail="Selected for Kartik" />
            <Stat icon={<CheckCircle2 size={19}/>} label="Today's Completed" value={`${todayLogs.filter(l => l.completed).length}/${myVows.length}`} detail="Marked complete today" />
            <Stat icon={<Activity size={19}/>} label="Today's Progress" value={`${dailyPercent}%`} detail="Average across your vows" />
            <Stat icon={<CalendarDays size={19}/>} label="Days with entries" value={String(new Set(logs.map(l => l.log_date)).size)} detail="Days you have logged" />
          </div>
          <div className="section-intro"><div><h2>Today's Sankalp Check-in</h2><p>Record your practice for today. Daily entries can only be created or changed for the current day.</p></div><span className="count-badge">Today only</span></div>
          <div className="daily-list">
            {myVows.map(vow => {
              const d = drafts[vow.id] || { quantity: '', unit: vow.unit || '', progress: 0, completed: false, reason: '', notes: '' }
              return <article className="daily-card daily-checkin-card" key={vow.id}>
                <label className={d.completed ? 'daily-check-row completed' : 'daily-check-row'}>
                  <input
                    type="checkbox"
                    checked={Boolean(d.completed)}
                    disabled={loading}
                    onChange={e => setDrafts(old => ({
                      ...old,
                      [vow.id]: { ...d, completed: e.target.checked, progress: e.target.checked ? 100 : 0 }
                    }))}
                  />
                  <span className="daily-check-custom">{d.completed && <Check size={16} />}</span>
                  <span className="daily-check-copy">
                    <strong>{vow.name}</strong>
                    <small>{vow.category}{d.completed ? ' · Completed today' : ' · Not checked yet'}</small>
                  </span>
                </label>
              </article>
            })}
          </div>
          <div className="sticky-actions daily-save-actions">
            <span>{myVows.filter(v => drafts[v.id]?.completed).length} of {myVows.length} sankalps completed today</span>
            <button className="btn btn-primary" disabled={loading || myVows.length === 0} onClick={saveTodayCheckin}>
              {loading ? <><span className="spinner"/> Saving check-in…</> : <>Save today's check-in <CheckCircle2 size={17}/></>}
            </button>
          </div>
          <div className="panel history-panel"><div className="panel-heading"><div><h3>My daily history</h3><p>Your saved entries, grouped by date.</p></div><CalendarDays size={20}/></div>
            {logs.length === 0 ? <Empty text="No daily entries yet. Update one of your sankalps above to begin your history."/> :
              <div className="history-list">{Array.from(new Set(logs.map(l => l.log_date))).sort((a,b)=>b.localeCompare(a)).map(date => <details key={date} className="history-day" open={date === logDate}><summary><span>{new Date(`${date}T12:00:00`).toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',year:'numeric'})}</span><span>{logs.filter(l=>l.log_date===date).length} entries <ChevronDown size={15}/></span></summary><div className="history-items">{logs.filter(l=>l.log_date===date).map(log => <div className="history-item" key={log.id}><div><strong>{vows.find(v=>v.id===log.vow_id)?.name || 'Sankalp'}</strong><p>{log.notes || log.reason || (log.completed ? 'Completed' : 'Progress updated')}</p></div><div className="history-progress"><strong>{log.progress_percent}%</strong><span>{log.quantity ?? '—'} {log.unit || ''}</span></div></div>)}</div></details>)}</div>}
          </div>
        </>}
      </section>}

      {screen === 'admin' && profile?.role === 'admin' && <section className="content-stack">
        <div className="section-intro"><div><h2>Temple overview</h2><p>Review devotee participation and Kartik sankalp progress. Respect privacy and use reports only for authorized temple purposes.</p></div><button className="btn btn-secondary" onClick={loadAdmin}><Activity size={16}/> Refresh</button></div>
        <div className="stats-grid">
          <Stat icon={<Users size={19}/>} label="Registered Devotees" value={String(adminUsers.filter(u=>u.role!=='admin').length)} detail="User accounts" />
          <Stat icon={<ClipboardList size={19}/>} label="Vows in Shared Library" value={String(vows.length)} detail="Available to devotees" />
          <Stat icon={<Heart size={19}/>} label="Sankalps Selected" value={String(adminSelections.length)} detail="Across all users" />
          <Stat icon={<CheckCircle2 size={19}/>} label="Daily Entries" value={String(adminLogs.length)} detail="Loaded recent entries" />
        </div>
        <div className="panel"><div className="panel-heading"><div><h3>Devotees</h3><p>Account list and selected vow counts.</p></div><button className="btn btn-secondary btn-small" onClick={exportCSV}><Download size={15}/> Export CSV</button></div>
          <input className="search-input" value={adminSearch} onChange={e=>setAdminSearch(e.target.value)} placeholder="Search by name or email..."/>
          <div className="table-wrap"><table><thead><tr><th>Devotee</th><th>Email</th><th>Joined</th><th>Sankalps</th><th>Latest entry</th><th>Account actions</th></tr></thead><tbody>
            {adminUsers.filter(u=>u.role!=='admin' && `${u.full_name} ${u.email}`.toLowerCase().includes(adminSearch.toLowerCase())).map(u => <tr key={u.id}><td><strong>{u.full_name || 'Devotee'}</strong></td><td>{u.email}</td><td>{new Date(u.created_at).toLocaleDateString('en-IN')}</td><td>{adminSelections.filter(s=>s.user_id===u.id).length}</td><td>{(adminLogs.filter(l=>l.user_id===u.id).map(l=>l.log_date).sort().slice(-1)[0]) || 'No entries'}</td><td><div className="action-row"><button className="btn btn-secondary btn-small" disabled={resettingUserId!==null || deletingUserId!==null} onClick={() => void resetDevoteePassword(u)}><ShieldCheck size={14}/>{resettingUserId===u.id ? 'Resetting…' : 'Reset password'}</button><button className="btn btn-danger btn-small" disabled={deletingUserId!==null || resettingUserId!==null} onClick={() => void deleteDevotee(u)}><Trash2 size={14}/>{deletingUserId===u.id ? 'Deleting…' : 'Delete user'}</button></div></td></tr>)}
          </tbody></table></div>
        </div>
        <div className="panel"><div className="panel-heading"><div><h3>Recent daily progress</h3><p>Daily logs across devotees.</p></div></div>
          {adminLogs.length===0 ? <Empty text="No daily logs have been submitted yet."/> : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Devotee</th><th>Sankalp</th><th>Quantity</th><th>Progress</th><th>Status</th><th>Reason / Notes</th></tr></thead><tbody>
            {adminLogs.slice(0,100).map(l=><tr key={l.id}><td>{l.log_date}</td><td>{l.profile?.full_name || l.profile?.email || 'Devotee'}</td><td>{l.vow?.name || vows.find(v=>v.id===l.vow_id)?.name || 'Sankalp'}</td><td>{l.quantity ?? '—'} {l.unit || ''}</td><td><span className="percent-pill">{l.progress_percent}%</span></td><td><span className={l.completed?'status-done':'status-pending'}>{l.completed?'Completed':'In progress'}</span></td><td>{l.reason || l.notes || '—'}</td></tr>)}
          </tbody></table></div>}
        </div>
      </section>}
      <footer className="app-footer">Made for Kartik Maas · ISKCON Dehradun <span>Hare Krishna 🙏</span></footer>
    </main>
  </div>
}

function Stat({icon,label,value,detail}:{icon:ReactNode;label:string;value:string;detail:string}) {
  return <div className="stat-card"><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-detail">{detail}</span></div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong></div>
}
function Empty({text}:{text:string}) { return <div className="empty-state"><CircleHelp size={22}/><p>{text}</p></div> }

function SetupScreen() {
  return <div className="auth-page"><div className="auth-card setup-card"><div className="auth-symbol"><Flame size={28}/></div><span className="eyebrow">ISKCON Dehradun</span><h1>Connect your Supabase project</h1><p>The app is ready, but environment variables are missing.</p><ol><li>Copy <code>.env.example</code> to <code>.env.local</code>.</li><li>Set <code>VITE_SUPABASE_URL</code> to your Project URL.</li><li>Set <code>VITE_SUPABASE_ANON_KEY</code> to your publishable key or legacy anon key.</li><li>Restart the dev server. In Vercel, add the same variables in Project Settings → Environment Variables.</li></ol><p className="security-note">Never use a Supabase service-role or secret key in this browser app.</p></div></div>
}

function AuthScreen(props: {
  mode:'login'|'signup'; setMode:(v:'login'|'signup')=>void; name:string; setName:(v:string)=>void;
  email:string; setEmail:(v:string)=>void; password:string; setPassword:(v:string)=>void;
  busy:boolean; onSubmit:(e:FormEvent)=>void; notice:string
}) {
  return <div className="auth-page"><div className="auth-art"><div className="mandala">✺</div><span className="eyebrow light">ISKCON DEHRADUN PRESENTS</span><h1>Kartik Sankalp</h1><p>Make a sincere vow. Practice each day. Offer every step with devotion.</p><div className="auth-verse">“Remember Krishna and make your daily practice a loving offering.”</div><span className="art-footer">KARTIK MAAS · DAILY SPIRITUAL TRACKER</span></div>
    <div className="auth-form-wrap"><form className="auth-card" onSubmit={props.onSubmit}><div className="auth-symbol"><Flame size={27}/></div><span className="eyebrow">{props.mode==='signup'?'BEGIN YOUR JOURNEY':'WELCOME BACK'}</span><h2>{props.mode==='signup'?'Create your account':'Sign in to continue'}</h2><p className="auth-subtitle">{props.mode==='signup'?'Create an account to choose and track your Kartik sankalps.':'Continue your Kartik sankalp journey. If you forget your password, contact the temple admin.'}</p>
      {props.notice && <div className="inline-notice">{props.notice}</div>}
      {props.mode==='signup' && <label className="field"><span>Full name</span><input required autoComplete="name" value={props.name} onChange={e=>props.setName(e.target.value)} placeholder="Your full name"/></label>}
      <label className="field"><span>Email address</span><input required type="email" autoComplete="email" value={props.email} onChange={e=>props.setEmail(e.target.value)} placeholder="you@example.com"/></label>
      <label className="field"><span>Password</span><input required type="password" minLength={props.mode==='signup'?8:1} autoComplete={props.mode==='signup'?'new-password':'current-password'} value={props.password} onChange={e=>props.setPassword(e.target.value)} placeholder={props.mode==='signup'?'At least 8 characters':'Your password'}/></label>
      <button className="btn btn-primary auth-submit" disabled={props.busy}>{props.busy ? <><span className="spinner"/> Please wait…</> : <>{props.mode==='signup'?'Create account':'Sign in'} <CheckCircle2 size={17}/></>}</button>
      <p className="auth-switch">{props.mode==='signup'?'Already have an account?':'New to the tracker?'} <button type="button" onClick={()=>props.setMode(props.mode==='signup' ? 'login' : 'signup')}>{props.mode==='signup'?'Sign in':'Create account'}</button></p>
      <p className="privacy-foot">Your daily notes are private to your account and authorized temple administrators.</p>
    </form></div>
  </div>
}

export default App
