export type Profile = {
  id: string
  full_name: string
  email: string
  role: 'admin' | 'user'
  created_at: string
}
export type Vow = {
  id: string
  name: string
  description: string | null
  category: string
  unit: string | null
  created_by: string | null
  created_at: string
}
export type Selection = {
  id: string
  user_id: string
  vow_id: string
  program_key: string
  created_at: string
  vow?: Vow
}
export type DailyLog = {
  id: string
  user_id: string
  vow_id: string
  log_date: string
  quantity: number | null
  unit: string | null
  progress_percent: number
  completed: boolean
  reason: string | null
  notes: string | null
  updated_at: string
}
