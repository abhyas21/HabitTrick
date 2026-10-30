import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { createPortal } from 'react-dom'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Download, Eye, EyeOff, FileSpreadsheet, Home, LogOut, MoreHorizontal, Pencil, Plus, Printer, Trash2, UserRound, WifiOff } from 'lucide-react'
import { completionKey, dailyCompletionPercent, getCompletionStats, isTodayDate, mergeCompletions, monthDayCount, moveItem, toDateKey } from './tracker.js'
import ExamPlanner from './ExamPlanner'
import { supabaseClient } from './supabaseClient'

type Habit = { id: string; user_id: string; name: string; description?: string | null; sector_id?: string | null; sort_order: number; created_at: string; updated_at: string }
type Sector = { id: string; user_id: string; name: string; color: string; sort_order: number; created_at: string; updated_at: string }
type Completion = { id: string; habit_id: string; completion_date: string }
type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }> }
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined
const supabase = supabaseClient
const NATIVE_AUTH_REDIRECT = 'habittrick://auth/callback'

function localDateKey(date: Date) {
  return toDateKey(date.getFullYear(), date.getMonth(), date.getDate())
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [authMode, setAuthMode] = useState<'signin' | 'signup' | 'reset'>('signin')
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState(''); const [passwordVisible, setPasswordVisible] = useState(false)
  const [greetingName, setGreetingName] = useState('')
  const [verificationPending, setVerificationPending] = useState(false); const [verificationEmail, setVerificationEmail] = useState(''); const [verificationCode, setVerificationCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [authMessage, setAuthMessage] = useState(''); const [authBusy, setAuthBusy] = useState(false)
  const [authMessageError, setAuthMessageError] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileEdit, setProfileEdit] = useState(false)
  const [profileEditName, setProfileEditName] = useState('')
  const [habits, setHabits] = useState<Habit[]>([]); const [completions, setCompletions] = useState<Completion[]>([])
  const [sectors, setSectors] = useState<Sector[]>([]); const [selectedSector, setSelectedSector] = useState<string | null>('all')
  const [activeSection, setActiveSection] = useState<'habits' | 'exams'>(() => localStorage.getItem('habit-trick:active-section') === 'exams' ? 'exams' : 'habits')
  const [sectorsAvailable, setSectorsAvailable] = useState(true)
  const [sectorDialog, setSectorDialog] = useState(false); const [sectorEditing, setSectorEditing] = useState<Sector | null>(null); const [sectorName, setSectorName] = useState(''); const [sectorColor, setSectorColor] = useState('#137b68'); const [sectorDelete, setSectorDelete] = useState<Sector | null>(null)
  const [dataLoaded, setDataLoaded] = useState(false)
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [busy, setBusy] = useState(false); const [online, setOnline] = useState(navigator.onLine); const [error, setError] = useState(''); const [notice, setNotice] = useState('')
  const [habitDialog, setHabitDialog] = useState(false); const [editing, setEditing] = useState<Habit | null>(null); const [habitName, setHabitName] = useState(''); const [habitDescription, setHabitDescription] = useState(''); const [habitSectorId, setHabitSectorId] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Habit | null>(null)
  const [mobileActions, setMobileActions] = useState<{ habitId: string; top: number; maxHeight: number } | null>(null)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const pendingRef = useRef(new Set<string>())
  const lastToggleAt = useRef(new Map<string, number>())
  const requestVersion = useRef(0)
  const activeUserId = useRef<string | null>(null)
  const loadRef = useRef<(quiet?: boolean) => Promise<void>>(async () => {})
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const gridScrollRef = useRef<HTMLDivElement>(null)
  const todayHeaderRef = useRef<HTMLTableCellElement>(null)
  const [todayKey, setTodayKey] = useState(() => localDateKey(new Date()))

  function switchSection(section: 'habits' | 'exams') {
    setActiveSection(section)
    localStorage.setItem('habit-trick:active-section', section)
  }

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true) })
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !Capacitor.isNativePlatform()) return
    let active = true
    const handledCodes = new Set<string>()
    const handleAuthUrl = async (rawUrl: string) => {
      try {
        const url = new URL(rawUrl)
        const params = new URLSearchParams(url.search)
        const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''))
        const code = params.get('code')
        if (code && !handledCodes.has(code)) {
          handledCodes.add(code)
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (active && exchangeError) {
            setAuthMessage(`Could not complete the account link: ${exchangeError.message}`)
            setAuthMessageError(true)
          }
          return
        }
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')
        if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          if (active && sessionError) {
            setAuthMessage(`Could not complete the account link: ${sessionError.message}`)
            setAuthMessageError(true)
          } else if (active && (params.get('type') ?? hashParams.get('type')) === 'recovery') {
            setRecoveryMode(true)
          }
          return
        }
        const linkError = params.get('error_description') ?? hashParams.get('error_description')
        if (active && linkError) {
          setAuthMessage(decodeURIComponent(linkError.replace(/\+/g, ' ')))
          setAuthMessageError(true)
        }
      } catch (cause) {
        if (active) {
          setAuthMessage(cause instanceof Error ? cause.message : 'Could not open the account link.')
          setAuthMessageError(true)
        }
      }
    }
    let listener: { remove: () => Promise<void> } | undefined
    const listenerPromise = CapacitorApp.addListener('appUrlOpen', ({ url }) => { void handleAuthUrl(url) })
    void listenerPromise.then(registered => {
      listener = registered
      if (!active) void registered.remove()
    })
    void CapacitorApp.getLaunchUrl().then(launch => { if (launch?.url) void handleAuthUrl(launch.url) })
    return () => {
      active = false
      if (listener) void listener.remove()
    }
  }, [])
  useEffect(() => {
    const nextId = session?.user.id ?? null
    if (activeUserId.current !== nextId) {
      setHabits([]); setCompletions([]); setDataLoaded(false)
      activeUserId.current = nextId
    }
  }, [session?.user.id])
  useEffect(() => {
    const up = () => setOnline(true), down = () => setOnline(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }
    const onInstalled = () => setInstallPrompt(null)
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  useEffect(() => {
    const updateLocalDate = () => setTodayKey(localDateKey(new Date()))
    const scheduleNextDay = () => {
      const now = new Date()
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      return window.setTimeout(() => { updateLocalDate(); timer = scheduleNextDay() }, Math.max(1, nextMidnight.getTime() - now.getTime() + 25))
    }
    let timer = scheduleNextDay()
    window.addEventListener('focus', updateLocalDate)
    document.addEventListener('visibilitychange', updateLocalDate)
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', updateLocalDate); document.removeEventListener('visibilitychange', updateLocalDate) }
  }, [])

  useEffect(() => {
    const alignToday = () => {
      if (!window.matchMedia('(max-width: 700px)').matches || month.getFullYear() !== new Date().getFullYear() || month.getMonth() !== new Date().getMonth()) return
      const scroller = gridScrollRef.current
      const todayHeader = todayHeaderRef.current
      if (!scroller || !todayHeader) return
      const viewport = scroller.getBoundingClientRect()
      const cell = todayHeader.getBoundingClientRect()
      const stickyWidth = scroller.querySelector('.habit-col')?.getBoundingClientRect().width ?? 0
      const progressWidth = scroller.querySelector('.progress-header')?.getBoundingClientRect().width ?? 0
      const targetLeft = viewport.right - progressWidth - cell.width
      if (cell.left > targetLeft || cell.left < viewport.left + stickyWidth) scroller.scrollLeft += cell.left - targetLeft
    }
    let frame = window.requestAnimationFrame(alignToday)
    const scheduleAlign = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(alignToday) }
    const observer = gridScrollRef.current && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleAlign) : null
    if (observer && gridScrollRef.current) observer.observe(gridScrollRef.current)
    window.addEventListener('resize', scheduleAlign)
    return () => { window.cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', scheduleAlign) }
  }, [month, todayKey, dataLoaded, habits.length])

  useEffect(() => {
    if (!profileOpen) return
    const closeOnOutside = (event: MouseEvent) => { if (event.target instanceof Node && !profileRef.current?.contains(event.target)) setProfileOpen(false) }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setProfileOpen(false) }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('mousedown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [profileOpen])

  useEffect(() => {
    if (!mobileActions) return
    const closeOnOutside = (event: MouseEvent) => {
      if (event.target instanceof Element && !event.target.closest('.mobile-row-action-portal') && !event.target.closest('.mobile-row-action-trigger')) setMobileActions(null)
    }
    const closeOnEscape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') setMobileActions(null) }
    document.addEventListener('click', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('click', closeOnOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [mobileActions])

  const load = useCallback(async (quiet = false) => {
    if (!supabase || !session) return
    const version = ++requestVersion.current
    if (!quiet) { setBusy(true); setDataLoaded(false); setError('') }
    const start = toDateKey(month.getFullYear(), month.getMonth(), 1)
    const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1)
    const end = toDateKey(nextMonth.getFullYear(), nextMonth.getMonth(), 1)
    const cacheKey = `habit-trick:${session.user.id}:${start}`
    if (!online) {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const snapshot = JSON.parse(cached) as { habits: Habit[]; completions: Completion[]; sectors?: Sector[] }
        setHabits(snapshot.habits); setCompletions(snapshot.completions); setSectors(snapshot.sectors ?? []); setSectorsAvailable(Array.isArray(snapshot.sectors)); setDataLoaded(true); setError('Showing saved offline data. Reconnect to sync.')
      } else { setHabits([]); setCompletions([]); setDataLoaded(false); setError('No saved data for this month while offline.') }
      if (!quiet) setBusy(false)
      return
    }
    try {
      const [h, c, s] = await Promise.all([
        supabase.from('habits').select('*').order('sort_order').order('created_at'),
        supabase.from('habit_completions').select('id,habit_id,completion_date').gte('completion_date', start).lt('completion_date', end),
        supabase.from('sectors').select('*').order('sort_order').order('created_at')
      ])
      if (version !== requestVersion.current) return
      if (h.error || c.error) {
        const failures = [h.error && `habits (HTTP ${h.status}, ${h.error.code || 'request failed'}): ${h.error.message}`, c.error && `habit_completions (HTTP ${c.status}, ${c.error.code || 'request failed'}): ${c.error.message}`].filter(Boolean)
        setDataLoaded(false)
        setError(`Could not load tracker data — ${failures.join('; ')}`)
        return
      }
      const nextHabits = h.data ?? [], nextCompletions = c.data ?? [], nextSectors = s.error ? [] : (s.data ?? [])
      setHabits(nextHabits); setCompletions(nextCompletions); setSectors(nextSectors); setSectorsAvailable(!s.error); setDataLoaded(true)
      if (s.error) {
        const isMissingTable = s.error.code === 'PGRST205' || s.error.code === '42P01'
        setError(isMissingTable
          ? `Your habits and completion history loaded, but Supabase cannot resolve public.sectors (HTTP ${s.status}, ${s.error.code}: ${s.error.message}). Apply supabase/migrations/202610210001_sectors.sql if it has not been run; otherwise reload the Supabase API schema cache, then retry.`
          : `Your habits and completion history loaded, but public.sectors could not be read (HTTP ${s.status}, ${s.error.code || 'request failed'}): ${s.error.message}`)
      } else {
        setError('')
      }
      try { localStorage.setItem(cacheKey, JSON.stringify({ habits: nextHabits, completions: nextCompletions, sectors: nextSectors })) } catch { /* Storage may be disabled or full; cloud data remains loaded. */ }
    } catch (cause) {
      if (version !== requestVersion.current) return
      setDataLoaded(false)
      const reason = cause instanceof Error && cause.message ? cause.message : 'network request failed'
      setError(`Could not reach Supabase while loading tracker data (${reason}). Check the connection and retry.`)
    } finally {
      if (version === requestVersion.current && !quiet) setBusy(false)
    }
  }, [session, month, online])
  useEffect(() => { void load() }, [load])
  useEffect(() => { loadRef.current = load }, [load])
  useEffect(() => {
    if (!supabase || !session) return
    const refresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      refreshTimer.current = setTimeout(() => { void loadRef.current(true) }, 120)
    }
    const channel = supabase.channel(`tracker-${session.user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habits', filter: `user_id=eq.${session.user.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sectors', filter: `user_id=eq.${session.user.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'habit_completions', filter: `user_id=eq.${session.user.id}` }, refresh)
      .subscribe()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [session])

  const days = monthDayCount(month.getFullYear(), month.getMonth())
  const today = new Date()
  const dateKey = (d: number) => toDateKey(month.getFullYear(), month.getMonth(), d)
  const completionSet = useMemo(() => new Set(completions.map(c => completionKey(c.habit_id, c.completion_date))), [completions])
  const profileDisplayName = greetingName || (typeof session?.user.user_metadata?.full_name === 'string' ? session.user.user_metadata.full_name.trim() : '')
  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'
  const visibleHabits = useMemo(() => selectedSector === 'all' ? habits : selectedSector === 'unassigned' ? habits.filter(h => !h.sector_id) : habits.filter(h => h.sector_id === selectedSector), [habits, selectedSector])
  const stats = getCompletionStats(visibleHabits, completions, month.getFullYear(), month.getMonth(), today)
  const doneCount = stats.completedHabitDays, overall = stats.overallPercent
  const perHabit = (id: string) => stats.perHabit[id] ?? null
  const dailyRate = (day: number) => dailyCompletionPercent(visibleHabits, completions, dateKey(day))

  async function authSubmit(e: FormEvent) {
    e.preventDefault(); if (!supabase) return
    setAuthBusy(true); setAuthMessage(''); setAuthMessageError(false)
    try {
      if (authMode === 'signin') {
        const name = displayName.trim().slice(0, 80)
        if (!name) { setAuthMessage('Enter your name to continue.'); setAuthMessageError(true); return }
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) { setAuthMessage(signInError.message); setAuthMessageError(true); return }
        const normalizedEmail = email.trim().toLowerCase()
        localStorage.setItem(`habit-trick-name:${normalizedEmail}`, name)
        setGreetingName(name)
        const { data: updated, error: nameError } = await supabase.auth.updateUser({ data: { full_name: name } })
        if (nameError) {
          setSession(data.session)
          setNotice(`Signed in, but your name could not be saved: ${nameError.message}`)
        } else {
          setSession(updated.user ? { ...data.session!, user: updated.user } : data.session)
        }
      } else if (authMode === 'signup') {
        const { data, error: signupError } = await supabase.auth.signUp({ email, password, options: { data: { full_name: displayName.trim() } } })
        if (signupError) { setAuthMessage(signupError.message); setAuthMessageError(true) }
        else {
          localStorage.setItem(`habit-trick-name:${email.trim().toLowerCase()}`, displayName.trim())
          if (!data.session) {
            setVerificationEmail(email); setVerificationPending(true); setAuthMessage('We sent a verification code to your email. Enter it below to finish creating your account.')
          } else { setGreetingName(displayName.trim()); setAuthMessage('') }
        }
      } else {
      const redirectTo = Capacitor.isNativePlatform() ? NATIVE_AUTH_REDIRECT : window.location.origin
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
        setAuthMessage(resetError?.message ?? 'Password reset email sent.'); setAuthMessageError(Boolean(resetError))
      }
    } catch (cause) { setAuthMessage(cause instanceof Error ? cause.message : 'Authentication request failed. Check your connection and try again.'); setAuthMessageError(true) }
    finally { setAuthBusy(false) }
  }
  async function verifyEmailCode(e: FormEvent) {
    e.preventDefault(); if (!supabase) return
    setAuthBusy(true); setAuthMessage(''); setAuthMessageError(false)
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({ email: verificationEmail, token: verificationCode.trim(), type: 'email' })
      if (verifyError) { const reason = verifyError.message.toLowerCase(); setAuthMessage(reason.includes('expired') && !reason.includes('invalid') ? 'This verification code has expired. Request a new code and try again.' : reason.includes('invalid') || reason.includes('token') || reason.includes('expired') ? 'This verification code is invalid or expired. Check the code or request a new one.' : verifyError.message); setAuthMessageError(true) }
      else {
        setVerificationPending(false); setVerificationCode(''); setSession(data.session); setGreetingName(typeof data.session?.user.user_metadata?.full_name === 'string' ? data.session.user.user_metadata.full_name : displayName.trim())
        setAuthMessage('Email verified. Your account is ready.')
        if (data.session) setNotice('Email verified. Welcome to Habit Trick.')
      }
    } catch (cause) { setAuthMessage(cause instanceof Error ? cause.message : 'Verification failed. Check your connection and try again.'); setAuthMessageError(true) }
    finally { setAuthBusy(false) }
  }
  async function resendVerificationCode() {
    if (!supabase) return
    setAuthBusy(true); setAuthMessage(''); setAuthMessageError(false)
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: verificationEmail })
      setAuthMessage(resendError ? resendError.message : 'A new verification code has been requested. Check your email; Supabase applies its configured resend limits.'); setAuthMessageError(Boolean(resendError))
    } catch (cause) { setAuthMessage(cause instanceof Error ? cause.message : 'Could not resend the code. Check your connection and try again.'); setAuthMessageError(true) }
    finally { setAuthBusy(false) }
  }
  async function updatePassword(e: FormEvent) {
    e.preventDefault(); if (!supabase) return
    setAuthBusy(true); setAuthMessage(''); setAuthMessageError(false)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) { setAuthMessage(updateError.message); setAuthMessageError(true) }
      else { setRecoveryMode(false); setNewPassword(''); setAuthMessage('Password updated. You are signed in.') }
    } catch (cause) { setAuthMessage(cause instanceof Error ? cause.message : 'Password update failed. Check your connection and try again.'); setAuthMessageError(true) }
    finally { setAuthBusy(false) }
  }
  async function saveProfileName(e: FormEvent) {
    e.preventDefault(); if (!supabase || !session) return
    const name = profileEditName.trim().slice(0, 80)
    if (!name) return
    setAuthBusy(true)
    try {
      const { data, error: updateError } = await supabase.auth.updateUser({ data: { full_name: name } })
      if (updateError) setError(`Could not update your name: ${updateError.message}`)
      else {
        setSession(current => current ? { ...current, user: data.user } : current)
        setGreetingName(name)
        if (session.user.email) localStorage.setItem(`habit-trick-name:${session.user.email.trim().toLowerCase()}`, name)
        setProfileEdit(false); setProfileOpen(false); setNotice('Display name updated.')
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update your name.') }
    finally { setAuthBusy(false) }
  }
  async function installPwa() {
    if (!installPrompt) return
    try {
      await installPrompt.prompt()
      await installPrompt.userChoice
    } finally { setInstallPrompt(null) }
  }
  async function signOut() { if (supabase) await supabase.auth.signOut(); setProfileOpen(false); setGreetingName(''); setHabits([]); setCompletions([]) }

  async function saveHabit(e: FormEvent) {
    e.preventDefault(); if (!supabase || !session) return
    const clean = habitName.trim().slice(0,120); if (!clean) return
    const description = habitDescription.trim().slice(0,300) || null
    const listFields = sectorsAvailable ? { sector_id: habitSectorId || null } : {}
    setBusy(true); setError('')
    try {
      const result = editing
        ? await supabase.from('habits').update({ name: clean, description, ...listFields, updated_at: new Date().toISOString() }).eq('id', editing.id).eq('user_id', session.user.id)
        : await supabase.from('habits').insert({ name: clean, description, ...listFields, user_id: session.user.id, sort_order: habits.length })
      if (result.error) setError(result.error.message)
      else { setNotice(editing ? 'Habit updated.' : 'Habit added.'); setHabitDialog(false); setEditing(null); setHabitName(''); setHabitDescription(''); await load(true) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the habit. Check your connection and retry.') }
    finally { setBusy(false) }
  }
  function openNewSector() { setSectorEditing(null); setSectorName(''); setSectorColor('#137b68'); setSectorDialog(true) }
  function openEditSector(sector: Sector) { setSectorEditing(sector); setSectorName(sector.name); setSectorColor(sector.color); setSectorDialog(true) }
  async function saveSector(e: FormEvent) {
    e.preventDefault(); if (!supabase || !session) return
    const clean = sectorName.trim().slice(0,80); if (!clean) return
    if (sectors.some(s => s.name.trim().toLocaleLowerCase() === clean.toLocaleLowerCase() && s.id !== sectorEditing?.id)) { setError('A list with that name already exists.'); return }
    setBusy(true); setError('')
    try {
      const result = sectorEditing
        ? await supabase.from('sectors').update({ name: clean, color: sectorColor, updated_at: new Date().toISOString() }).eq('id', sectorEditing.id).eq('user_id', session.user.id)
        : await supabase.from('sectors').insert({ name: clean, color: sectorColor, user_id: session.user.id, sort_order: sectors.length }).select().single()
      if (result.error) setError(result.error.message)
      else {
        if (!sectorEditing && result.data) setSelectedSector(result.data.id)
        setNotice(sectorEditing ? 'List updated.' : 'List created.'); setSectorDialog(false); setSectorEditing(null); setSectorName(''); await load(true)
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this list.') }
    finally { setBusy(false) }
  }
  async function removeSector() {
    if (!supabase || !session || !sectorDelete) return
    setBusy(true); setError('')
    try {
      const result = await supabase.from('sectors').delete().eq('id', sectorDelete.id).eq('user_id', session.user.id)
      if (result.error) setError(result.error.message)
      else { setSelectedSector('unassigned'); setSectorDelete(null); setNotice('List deleted. Its habits are now Unassigned; completion history is preserved.'); await load(true) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this list.') }
    finally { setBusy(false) }
  }
  async function removeHabit() {
    if (!supabase || !deleteTarget) return
    setBusy(true)
    try {
      const result = await supabase.from('habits').delete().eq('id', deleteTarget.id)
      if (result.error) setError(result.error.message); else { setDeleteTarget(null); setNotice('Habit and its tracking history deleted.'); await load(true) }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete the habit. Check your connection and retry.') }
    finally { setBusy(false) }
  }
  async function moveHabit(habit: Habit, delta: number) {
    if (!supabase) return
    const group = visibleHabits
    const i = group.findIndex(h => h.id === habit.id), j = i + delta
    if (j < 0 || j >= group.length) return
    const next = moveItem(group, i, j)
    const slots = group.map(item => habits.findIndex(h => h.id === item.id)).sort((a, b) => a - b)
    const reordered = [...habits]
    slots.forEach((slot, index) => { reordered[slot] = next[index] })
    setHabits(reordered)
    try {
      const changes = next.map((h, idx) => supabase!.from('habits').update({ sort_order: slots[idx], updated_at: new Date().toISOString() }).eq('id', h.id).eq('user_id', session?.user.id))
      const results = await Promise.all(changes); const failed = results.find(r => r.error)
      if (failed?.error) throw new Error(failed.error.message)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reorder habits.'); await load(true) }
  }
  async function toggle(habit: Habit, day: number) {
    const selectedDate = dateKey(day)
    if (!supabase || !session || !online || !isTodayDate(selectedDate, today) || selectedDate !== todayKey) return
    const key = completionKey(habit.id, selectedDate)
    if (pendingRef.current.has(key)) return
    const clickedAt = Date.now(), previousClickAt = lastToggleAt.current.get(key) ?? 0
    if (clickedAt - previousClickAt < 350) return
    lastToggleAt.current.set(key, clickedAt)
    const wasComplete = completionSet.has(key)
    pendingRef.current.add(key); setPending(new Set(pendingRef.current)); setError('')
    setCompletions(prev => wasComplete ? prev.filter(c => completionKey(c.habit_id, c.completion_date) !== key) : mergeCompletions(prev, [{ id: `pending-${key}`, habit_id: habit.id, completion_date: dateKey(day) }]))
    try {
      const result = wasComplete
        ? await supabase.from('habit_completions').delete().eq('user_id', session.user.id).eq('habit_id', habit.id).eq('completion_date', selectedDate)
        : await supabase.from('habit_completions').upsert({ user_id: session.user.id, habit_id: habit.id, completion_date: selectedDate }, { onConflict: 'habit_id,completion_date', ignoreDuplicates: true })
      if (result.error) throw new Error(result.error.message)
      if (!wasComplete) await load(true)
    } catch (cause) { setError(`Could not sync change: ${cause instanceof Error ? cause.message : 'Check your connection and retry.'}`); await load(true) }
    finally { pendingRef.current.delete(key); setPending(new Set(pendingRef.current)) }
  }
  function exportCsv() {
    const rows = [['Habit', ...Array.from({length:days}, (_,i) => String(i+1)), 'Completion %'], ...visibleHabits.map(h => [h.name, ...Array.from({length:days}, (_,i) => completionSet.has(`${h.id}:${dateKey(i+1)}`) ? 'Complete' : ''), perHabit(h.id) === null ? '' : `${perHabit(h.id)}%`])]
    const csv = rows.map(row => row.map(value => {
      const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value
      return `"${safe.replaceAll('"','""')}"`
    }).join(',')).join('\r\n')
    const blob = new Blob(['\ufeff'+csv], {type:'text/csv;charset=utf-8'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `habit-tracker-${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }
  function keyboardCell(e: ReactKeyboardEvent<HTMLButtonElement>, row: number, day: number) {
    const keys: Record<string,[number,number]> = { ArrowUp:[-1,0], ArrowDown:[1,0], ArrowLeft:[0,-1], ArrowRight:[0,1] }
    if (e.key in keys) { e.preventDefault(); const [r,d] = keys[e.key]; document.getElementById(`cell-${row+r}-${day+d}`)?.focus() }
  }

  if (!SUPABASE_URL || !KEY) return <main className="setup"><div className="brand"><span className="brand-mark"><Check size={19}/></span><span>habit trick</span></div><h1>Connect your tracker</h1><p>Add your Supabase project URL and publishable key to <code>.env.local</code>, then restart Vite.</p></main>
  if (!authReady) return <main className="setup"><p>Loading your accountÃ¢â‚¬Â¦</p></main>
  if (session && recoveryMode) return <main className="auth-wrap"><section className="auth-card"><div className="brand"><span className="brand-mark"><Check size={19}/></span><span>habit trick</span></div><h1>Choose a new password</h1><p className="muted">Set a new password for your account.</p><form onSubmit={updatePassword}><label>New password<input type="password" autoComplete="new-password" minLength={8} required value={newPassword} onChange={e=>setNewPassword(e.target.value)} /></label><button className="primary full" disabled={authBusy}>{authBusy ? 'Please waitÃ¢â‚¬Â¦' : 'Update password'}</button></form>{authMessage && <p className={`message ${authMessageError ? 'message-error' : ''}`} role={authMessageError ? 'alert' : 'status'}>{authMessage}</p>}</section></main>
  if (!session && verificationPending) return <main className="auth-wrap"><section className="auth-card"><div className="brand"><span className="brand-mark"><Check size={19}/></span><span>habit trick</span></div><h1>Verify your email</h1><p className="muted">Enter the numeric code sent to <strong>{verificationEmail}</strong>.</p><form onSubmit={verifyEmailCode}><label htmlFor="verify-code">Email verification code</label><input id="verify-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={verificationCode} onChange={e=>setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code"/><button className="primary full" disabled={authBusy || verificationCode.length !== 6}>{authBusy ? 'Verifyingâ€¦' : 'Verify'}</button></form>{authMessage && <p className={`message ${authMessageError ? 'message-error' : ''}`} role={authMessageError ? 'alert' : 'status'}>{authMessage}</p>}<div className="auth-links"><button type="button" onClick={()=>void resendVerificationCode()} disabled={authBusy}>Resend code</button><button type="button" onClick={()=>{setVerificationPending(false);setAuthMessage('');setAuthMode('signin');setPasswordVisible(false)}}>Back to sign in</button></div></section></main>
  if (!session) return <main className="auth-wrap"><section className="auth-card"><div className="brand"><span className="brand-mark"><Check size={19}/></span><span>habit trick</span></div><h1>{authMode === 'signin' ? 'Welcome back' : authMode === 'signup' ? 'Create your account' : 'Reset password'}</h1><p className="muted">Your habits stay in sync across your devices.</p><form onSubmit={authSubmit}>{(authMode === 'signup' || authMode === 'signin') && <label>{authMode === 'signin' ? 'Name' : 'Full name'}<input type="text" autoComplete="name" maxLength={80} required value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Your name"/></label>}<label>Email<input type="email" autoComplete="email" required value={email} onChange={e=>{setEmail(e.target.value);const cached=localStorage.getItem(`habit-trick-name:${e.target.value.trim().toLowerCase()}`);if(cached)setDisplayName(cached)}} /></label>{authMode !== 'reset' && <label>Password<span className="password-wrap"><input type={passwordVisible?'text':'password'} autoComplete={authMode === 'signin' ? 'current-password':'new-password'} minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} /><button type="button" className="password-toggle" aria-label={passwordVisible?'Hide password':'Show password'} aria-pressed={passwordVisible} onClick={()=>setPasswordVisible(v=>!v)}>{passwordVisible?<EyeOff size={18}/>:<Eye size={18}/>}</button></span></label>}<button className="primary full" disabled={authBusy}>{authBusy ? 'Please waitÃ¢â‚¬Â¦' : authMode === 'signin' ? 'Sign in' : authMode === 'signup' ? 'Create account' : 'Send reset link'}</button></form>{authMessage && <p className={`message ${authMessageError ? 'message-error' : ''}`} role={authMessageError ? 'alert' : 'status'}>{authMessage}</p>}<div className="auth-links">{authMode === 'signin' ? <><button type="button" onClick={()=>{setAuthMode('signup');setAuthMessage('');setPasswordVisible(false)}}>Create account</button><button type="button" onClick={()=>{setAuthMode('reset');setAuthMessage('');setPasswordVisible(false)}}>Forgot password?</button></> : <button type="button" onClick={()=>{setAuthMode('signin');setAuthMessage('');setPasswordVisible(false)}}>Back to sign in</button>}</div></section></main>
  const prevMonth = () => setMonth(new Date(month.getFullYear(), month.getMonth()-1, 1)); const nextMonth = () => setMonth(new Date(month.getFullYear(), month.getMonth()+1, 1))
  return <main className={`app-shell ${activeSection==='exams'?'show-exams':''}`} id="app-home">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Check size={19}/></span><span>habit trick</span></div>
      <div className="top-actions">
        {installPrompt && <button className="install-trigger" type="button" onClick={()=>void installPwa()}><Download size={16}/><span>Install app</span></button>}
        <div className="profile-menu" ref={profileRef}>
          <button className="profile-trigger" type="button" aria-label="Open profile menu" aria-haspopup="menu" aria-expanded={profileOpen} onClick={()=>{setProfileOpen(open=>!open);setProfileEdit(false)}}><UserRound size={19}/></button>
          {profileOpen && <div className="profile-dropdown" role="menu" aria-label="Profile menu">
            <div className="profile-name">{profileDisplayName || 'Your profile'}</div>
            {profileEdit ? <form className="profile-edit-form" onSubmit={saveProfileName}><label htmlFor="profile-display-name">Display name</label><input id="profile-display-name" autoFocus required maxLength={80} value={profileEditName} onChange={e=>setProfileEditName(e.target.value)}/><div className="profile-edit-actions"><button type="button" className="profile-menu-item" onClick={()=>setProfileEdit(false)}>Cancel</button><button type="submit" className="profile-menu-item" disabled={!profileEditName.trim()||authBusy}>{authBusy?'Savingâ€¦':'Save name'}</button></div></form> : <><button className="profile-menu-item" role="menuitem" onClick={()=>{setProfileEditName(profileDisplayName);setProfileEdit(true)}}><Pencil size={15}/> Edit name</button><button className="profile-menu-item" role="menuitem" onClick={()=>void signOut()}><LogOut size={15}/> Sign out</button></>}
          </div>}
        </div>
      </div>
    </header>

    {error && <div className="alert" role="alert">{error}<button onClick={()=>void load()}>Retry</button></div>}
    {notice && <div className="notice" role="status">{notice}<button aria-label="Dismiss" onClick={()=>setNotice('')}>Ãƒâ€”</button></div>}
    {!online && <div className="offline-note"><WifiOff size={15}/> Offline viewing is available. Edits are disabled until you reconnect.</div>}

    {activeSection==='exams' && <nav className="sector-bar exam-section-nav" aria-label="Habit lists and sections">
      <div className="sector-tabs">
        <button type="button" className="sector-tab" onClick={()=>{setSelectedSector('all');switchSection('habits')}}>All <span>{habits.length}</span></button>
        {sectors.map(sector=><button type="button" key={sector.id} className="sector-tab" style={{'--sector-color':sector.color} as CSSProperties} onClick={()=>{setSelectedSector(sector.id);switchSection('habits')}}>{sector.name}<span>{habits.filter(h=>h.sector_id===sector.id).length}</span></button>)}
        <button type="button" className="sector-tab" onClick={()=>{setSelectedSector('unassigned');switchSection('habits')}}>Unassigned <span>{habits.filter(h=>!h.sector_id).length}</span></button>
      </div>
      <button type="button" className="new-sector-button" disabled={!online||!sectorsAvailable} onClick={()=>{switchSection('habits');openNewSector()}}><Plus size={15}/> New List</button>
      <button type="button" className="sector-tab active exam-section-tab" aria-current="page">Exams</button>
    </nav>}

    {!dataLoaded ? <section className="empty-state"><div className="empty-icon"><FileSpreadsheet size={24}/></div><h2>{busy?'Loading your trackerâ€¦':online?'Tracker unavailable':'Offline data unavailable'}</h2><p>{error || 'Loading your saved tracker data.'}</p><button className="secondary" onClick={()=>void load()} disabled={!online||busy}>Retry</button></section> : <>
      <section className="tracker-heading"><div className="tracker-title"><div><div className="eyebrow">YOUR HABITS</div><h1>{profileDisplayName ? `${greeting}, ${profileDisplayName}!` : 'Your habits, your progress.'}</h1></div></div>
        <div className="toolbar-actions"><button className="secondary print-action" onClick={()=>window.print()}><Printer size={16}/> PDF / Print</button><button className="secondary" onClick={exportCsv}><FileSpreadsheet size={16}/> Export CSV</button><button className="primary" disabled={!online} onClick={()=>{setEditing(null);setHabitName('');setHabitDescription('');setHabitSectorId(selectedSector && selectedSector!=='all' && selectedSector!=='unassigned' ? selectedSector : '');setHabitDialog(true)}}><Plus size={17}/> Add Habit</button></div>
      </section>
      <section className="toolbar"><div><div className="eyebrow">{selectedSector==='all'?'MONTHLY TRACKER':selectedSector==='unassigned'?'UNASSIGNED':sectors.find(s=>s.id===selectedSector)?.name.toLocaleUpperCase() ?? 'MONTHLY TRACKER'}</div><div className="month-control"><button className="icon-button" onClick={prevMonth} aria-label="Previous month"><ChevronLeft size={19}/></button><h2>{month.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h2><button className="icon-button" onClick={nextMonth} aria-label="Next month"><ChevronRight size={19}/></button><button className="today-button" onClick={()=>setMonth(new Date(today.getFullYear(),today.getMonth(),1))}>Today</button></div></div></section>
      <section className="stats" aria-label="Monthly overview"><div className="stat"><span>Habits</span><strong>{visibleHabits.length}</strong></div><div className="stat"><span>Completed habit-days</span><strong>{doneCount}</strong></div><div className="stat"><span>Monthly completion</span><strong>{overall===null?'Ã¢â‚¬â€':`${overall}%`}</strong></div><div className="stat best"><span>Best-performing habit</span><strong>{visibleHabits.length?visibleHabits.reduce((a,b)=>(perHabit(b.id)??0)>(perHabit(a.id)??0)?b:a).name:'Ã¢â‚¬â€'}</strong></div></section>
       <nav className="sector-bar" aria-label="Habit lists">
        <div className="sector-tabs">
          <button type="button" className={`sector-tab ${selectedSector==='all'?'active':''}`} aria-pressed={selectedSector==='all'} onClick={()=>setSelectedSector('all')}>All <span>{habits.length}</span></button>
          {sectors.map(sector=><div className="sector-tab-wrap" key={sector.id}><button type="button" className={`sector-tab ${selectedSector===sector.id?'active':''}`} aria-pressed={selectedSector===sector.id} style={{'--sector-color':sector.color} as CSSProperties} onClick={()=>setSelectedSector(sector.id)}>{sector.name}<span>{habits.filter(h=>h.sector_id===sector.id).length}</span></button><button className="sector-more" type="button" aria-label={`Manage ${sector.name}`} title={`Manage ${sector.name}`} onClick={()=>openEditSector(sector)}>•••</button></div>)}
          <button type="button" className={`sector-tab ${selectedSector==='unassigned'?'active':''}`} aria-pressed={selectedSector==='unassigned'} onClick={()=>setSelectedSector('unassigned')}>Unassigned <span>{habits.filter(h=>!h.sector_id).length}</span></button>
        </div>
        <button type="button" className="new-sector-button" disabled={!online||!sectorsAvailable} title={sectorsAvailable?'Create a list':'Apply the sectors migration to enable lists'} onClick={()=>{switchSection('habits');openNewSector()}}><Plus size={15}/> New List</button><button type="button" className={`sector-tab exam-section-tab ${activeSection==='exams'?'active':''}`} aria-pressed={activeSection==='exams'} onClick={()=>switchSection('exams')}>Exams</button>
      </nav>
     {visibleHabits.length===0 ? <section className="empty-state"><div className="empty-icon"><FileSpreadsheet size={24}/></div><h2>No habits yet</h2><p>Add a habit to start tracking your progress.</p><button className="primary" disabled={!online} onClick={()=>{setEditing(null);setHabitName('');setHabitDescription('');setHabitSectorId(selectedSector && selectedSector!=='all' && selectedSector!=='unassigned' ? selectedSector : '');setHabitDialog(true)}}><Plus size={17}/> Add Habit</button></section> : <section className="grid-frame" aria-label="Monthly habit tracking grid"><div className="grid-scroll" ref={gridScrollRef}><table className="tracker" style={{"--tracker-body-rows":visibleHabits.length+1} as CSSProperties}><colgroup><col className="habit-col"/>{Array.from({length:days},(_,i)=><col className="day-col" key={i}/>) }<col className="progress-col"/></colgroup><thead><tr><th className="sticky-habit header-habit">Habit / Work</th>{Array.from({length:days},(_,i)=><th key={i} ref={dateKey(i+1)===todayKey?todayHeaderRef:undefined} className={`day-header ${dateKey(i+1)===todayKey?'today-column':''}`}>{i+1}</th>)}<th className="progress-header">Done</th></tr></thead><tbody>{visibleHabits.map((habit,row)=><tr key={habit.id}><th scope="row" className="sticky-habit habit-name"><span className="habit-copy"><span className="habit-title" title={habit.name}>{habit.name}</span>{habit.description?.trim()&&<span className="habit-description" title={habit.description}>{habit.description}</span>}</span><span className="row-actions"><span className="desktop-row-actions"><button aria-label={'Move '+habit.name+' up'} title="Move up" disabled={!online||row===0} onClick={()=>void moveHabit(habit,-1)}><ArrowUp size={15}/></button><button aria-label={'Move '+habit.name+' down'} title="Move down" disabled={!online||row===visibleHabits.length-1} onClick={()=>void moveHabit(habit,1)}><ArrowDown size={15}/></button><button aria-label={'Rename '+habit.name} title="Rename" disabled={!online} onClick={()=>{setEditing(habit);setHabitName(habit.name);setHabitDescription(habit.description ?? '');setHabitSectorId(habit.sector_id ?? '');setHabitDialog(true)}}><Pencil size={15}/></button><button aria-label={'Delete '+habit.name} title="Delete" disabled={!online} onClick={()=>setDeleteTarget(habit)}><Trash2 size={15}/></button></span><button className="mobile-row-actions mobile-row-action-trigger" type="button" aria-label={`Actions for ${habit.name}`} aria-haspopup="menu" aria-expanded={mobileActions?.habitId===habit.id} title="Habit actions" disabled={!online} onClick={e=>{if(mobileActions?.habitId===habit.id){setMobileActions(null);return}const r=e.currentTarget.getBoundingClientRect();const navTop=document.querySelector('.mobile-nav')?.getBoundingClientRect().top??window.innerHeight;const below=Math.max(0,navTop-r.bottom-8);const above=Math.max(0,r.top-8);const cap=Math.max(112,Math.min(184,window.innerHeight-24));const placeBelow=below>=cap||below>=above;const available=Math.max(112,Math.min(cap,placeBelow?below:above));setMobileActions({habitId:habit.id,top:placeBelow?r.bottom+4:Math.max(8,r.top-available-4),maxHeight:available})}}><MoreHorizontal size={19}/></button></span></th>{Array.from({length:days},(_,i)=>{const d=i+1,k=completionKey(habit.id,dateKey(d)),checked=completionSet.has(k),isToday=dateKey(d)===todayKey;return <td key={d} className={`day-cell ${isToday?'today-column':''}`}><button id={`cell-${row}-${d}`} className={`cell-button ${checked?'checked':''} ${isToday?'today-cell':''}`} type="button" aria-pressed={checked} aria-current={isToday?'date':undefined} aria-label={`${habit.name}, ${month.toLocaleDateString(undefined,{month:'long'})} ${d}: ${checked?'complete':'incomplete'}${isToday?', today':''}`} disabled={!online||!isToday||pending.has(k)} onKeyDown={e=>keyboardCell(e,row,d)} onClick={e=>{e.stopPropagation();void toggle(habit,d)}} onDoubleClick={e=>{e.preventDefault();e.stopPropagation()}}>{checked&&<Check size={15} strokeWidth={2.5}/>}</button></td>})}<td className="percent-cell">{perHabit(habit.id)===null?'Ã¢â‚¬â€':`${perHabit(habit.id)}%`}</td></tr>)}<tr className="daily-row"><th className="sticky-habit">Daily completion</th>{Array.from({length:days},(_,i)=><td key={i} className={`daily-cell ${dateKey(i+1)===todayKey?'today-column':''}`}>{dailyRate(i+1)===null?'Ã¢â‚¬â€':`${dailyRate(i+1)}%`}</td>)}<td className="percent-cell">Ã¢â‚¬â€</td></tr></tbody></table></div></section>}
    </>}
    {activeSection==='exams' && <ExamPlanner client={supabase} userId={session.user.id} online={online}/>}
    {mobileActions && activeSection==='habits' && createPortal(<div className="mobile-row-action-menu mobile-row-action-portal" role="menu" aria-label="Habit actions" style={{top:mobileActions.top,maxHeight:mobileActions.maxHeight}}>
      {(() => { const row = visibleHabits.findIndex(habit => habit.id === mobileActions.habitId); const habit = visibleHabits[row]; if (!habit) return null; return <>
        <button role="menuitem" disabled={!online||row===0} onClick={()=>{setMobileActions(null);void moveHabit(habit,-1)}}><ArrowUp size={17}/> Move up</button>
        <button role="menuitem" disabled={!online||row===visibleHabits.length-1} onClick={()=>{setMobileActions(null);void moveHabit(habit,1)}}><ArrowDown size={17}/> Move down</button>
        <button role="menuitem" disabled={!online} onClick={()=>{setMobileActions(null);setEditing(habit);setHabitName(habit.name);setHabitDescription(habit.description ?? '');setHabitSectorId(habit.sector_id ?? '');setHabitDialog(true)}}><Pencil size={17}/> Rename</button>
        <button role="menuitem" disabled={!online} onClick={()=>{setMobileActions(null);setDeleteTarget(habit)}}><Trash2 size={17}/> Delete</button>
      </>})()}
    </div>, document.body)}
    <button className="add-habit-fab" type="button" aria-label="Add habit" title="Add habit" disabled={!online} onClick={()=>{setEditing(null);setHabitName('');setHabitDescription('');setHabitSectorId(selectedSector && selectedSector!=='all' && selectedSector!=='unassigned' ? selectedSector : '');setHabitDialog(true)}}><Plus size={25} strokeWidth={2.4}/></button>
    {habitDialog && <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setHabitDialog(false)}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="habit-title"><button className="modal-close" aria-label="Close" onClick={()=>setHabitDialog(false)}>Ã—</button><h2 id="habit-title">{editing?'Edit habit':'Add a habit'}</h2><p>{editing?'Rename this habit. Completion history is preserved.':'Choose a name. New tracking cells start blank.'}</p><form onSubmit={saveHabit}>
  <label htmlFor="habit-name"><span>Habit name</span><input id="habit-name" autoFocus maxLength={120} value={habitName} onChange={e=>setHabitName(e.target.value)} placeholder="Enter a habit name" required/></label>
  <label htmlFor="habit-sector"><span>List</span><select id="habit-sector" value={habitSectorId} onChange={e=>setHabitSectorId(e.target.value)}><option value="">Unassigned</option>{sectors.map(sector=><option key={sector.id} value={sector.id}>{sector.name}</option>)}</select></label><label htmlFor="habit-description"><span>Work description</span><textarea id="habit-description" maxLength={300} rows={3} value={habitDescription} onChange={e=>setHabitDescription(e.target.value)} placeholder="Describe what you need to do for this habit..."/><span className="character-count">{habitDescription.length}/300</span></label>
  <div className="modal-actions"><button type="button" className="secondary" onClick={()=>setHabitDialog(false)}>Cancel</button><button className="primary" disabled={!habitName.trim()||busy}>{editing?'Save changes':'Save Habit'}</button></div>
</form></section></div>}    {sectorDialog&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setSectorDialog(false)}}><section className="modal sector-modal" role="dialog" aria-modal="true" aria-labelledby="sector-dialog-title"><button className="modal-close" aria-label="Close" onClick={()=>setSectorDialog(false)}>×</button><h2 id="sector-dialog-title">{sectorEditing?'Edit list':'Create a list'}</h2><p>{sectorEditing?'Update this list. Its habits and history stay linked.':'Give your new list a name.'}</p><form onSubmit={saveSector}><label htmlFor="sector-name"><span>List name</span><input id="sector-name" autoFocus required maxLength={80} value={sectorName} onChange={e=>setSectorName(e.target.value)} placeholder="e.g. College"/></label><label className="sector-color-field" htmlFor="sector-color"><span>Color</span><input id="sector-color" type="color" value={sectorColor} onChange={e=>setSectorColor(e.target.value)}/></label><div className="modal-actions"><button type="button" className="secondary" onClick={()=>setSectorDialog(false)}>Cancel</button>{sectorEditing&&<button type="button" className="danger" onClick={()=>{setSectorDialog(false);setSectorDelete(sectorEditing)}}>Delete list</button>}<button className="primary" disabled={!sectorName.trim()||busy}>{sectorEditing?'Save changes':'Create list'}</button></div></form></section></div>}
    {sectorDelete&&<div className="modal-backdrop"><section className="modal" role="alertdialog" aria-modal="true" aria-labelledby="sector-delete-title"><h2 id="sector-delete-title">Delete “{sectorDelete.name}”?</h2><p>{habits.filter(h=>h.sector_id===sectorDelete.id).length} habit(s) will move to Unassigned. Their completion history will be preserved.</p><div className="modal-actions"><button className="secondary" onClick={()=>setSectorDelete(null)}>Cancel</button><button className="danger" onClick={()=>void removeSector()} disabled={busy}>Delete list</button></div></section></div>}    {deleteTarget && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><button className="modal-close" aria-label="Close" onClick={()=>setDeleteTarget(null)}>Ãƒâ€”</button><h2 id="delete-title">Delete Ã¢â‚¬Å“{deleteTarget.name}Ã¢â‚¬Â?</h2><p>This permanently deletes the habit and all of its completion history.</p><div className="modal-actions"><button className="secondary" onClick={()=>setDeleteTarget(null)}>Cancel</button><button className="danger" onClick={()=>void removeHabit()} disabled={busy}><Trash2 size={16}/> Delete habit</button></div></section></div>}
    <nav className="mobile-nav" aria-label="Primary navigation">
      <button type="button" className="mobile-nav-item active" aria-current="page" onClick={()=>window.scrollTo({top:0,behavior:'smooth'})}><Home size={20}/><span>Home</span></button>
      <button type="button" className="mobile-nav-item" aria-haspopup="menu" aria-expanded={profileOpen} onClick={()=>{window.scrollTo({top:0,behavior:'smooth'});setProfileOpen(true);setProfileEdit(false)}}><UserRound size={20}/><span>Profile</span></button>
    </nav>
  </main>
}
export default App
