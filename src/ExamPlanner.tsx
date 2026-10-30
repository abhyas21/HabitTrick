import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Pencil, Plus, Trash2 } from 'lucide-react'
import { activitiesOverlap, daysUntil, endTime, formatTime12, hasActivityIdentity, localDateKey, makeDateStrip, progressPercent, sortActivities, sortExamsByDateAndTime, upcomingExamGapLabel } from './examUtils.js'

type Semester = { id: string; name: string }
type Exam = { id: string; user_id: string; semester_id: string | null; name: string; exam_type: string | null; session: 'FN' | 'AN' | null; start_time: string | null; exam_date: string; notes: string | null; created_at: string }
type Subject = { id: string; user_id: string; exam_id: string | null; name: string; sort_order: number }
type Unit = { id: string; user_id: string; subject_id: string; name: string; sort_order: number }
type Topic = { id: string; user_id: string; subject_id: string; unit_id: string | null; name: string; status: TopicStatus; sort_order: number }
type TopicStatus = 'not_started' | 'learning' | 'completed' | 'needs_revision'
type Activity = { id: string; user_id: string; activity_date: string; title: string | null; subject_name: string | null; subject_id: string | null; exam_id: string | null; topic_id: string | null; start_time: string | null; duration_minutes: number | null; is_completed: boolean; sort_order: number; created_at: string }
type Draft = { id: string | null; title: string; subjectName: string; subjectId: string; examId: string; topicId: string; startTime: string; duration: string }
type ExamDraft = { id: string; name: string; type: string; date: string; session?: 'FN' | 'AN' | ''; startTime?: string; notes: string; semesterId: string; semesterName: string }

interface Props { client: SupabaseClient | null; userId: string; online: boolean }

const emptyDraft = (): Draft => ({ id: null, title: '', subjectName: '', subjectId: '', examId: '', topicId: '', startTime: '09:00', duration: '60' })
const statusLabel: Record<TopicStatus, string> = { not_started: 'Not started', learning: 'Learning', completed: 'Completed', needs_revision: 'Needs revision' }

function localDateLabel(value: string, options: Intl.DateTimeFormatOptions) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, options)
}

export default function ExamPlanner({ client, userId, online }: Props) {
  const [selectedDate, setSelectedDate] = useState(() => {
    const saved = localStorage.getItem(`habit-trick:exam-date:${userId}`)
    return saved && /^\d{4}-\d{2}-\d{2}$/.test(saved) ? saved : localDateKey()
  })
  const [activities, setActivities] = useState<Activity[]>([])
  const [exams, setExams] = useState<Exam[]>([])
  const [semesters, setSemesters] = useState<Semester[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [activityReady, setActivityReady] = useState(false)
  const [examReady, setExamReady] = useState(false)
  const [error, setError] = useState('')
  const [activityValidationError, setActivityValidationError] = useState('')
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [plannerView, setPlannerView] = useState<'daily' | 'schedule'>('daily')
  const [scheduleMonth, setScheduleMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [examDraft, setExamDraft] = useState<ExamDraft>({ id: '', name: '', type: '', date: '', session: '', startTime: '', notes: '', semesterId: '', semesterName: '' })
  const [isExamFormOpen, setIsExamFormOpen] = useState(false)
  const [subjectDraft, setSubjectDraft] = useState<{ examId: string; name: string } | null>(null)
  const [unitDraft, setUnitDraft] = useState<{ subjectId: string; name: string } | null>(null)
  const [topicDraft, setTopicDraft] = useState<{ subjectId: string; unitId: string; name: string } | null>(null)
  const [expandedExam, setExpandedExam] = useState<string | null>(null)
  const [movingActivity, setMovingActivity] = useState<string | null>(null)
  const [moveDate, setMoveDate] = useState('')
  const loadGeneration = useRef(0)

  useEffect(() => { localStorage.setItem(`habit-trick:exam-date:${userId}`, selectedDate) }, [selectedDate, userId])

  const load = useCallback(async () => {
    if (!client) { setError('Supabase is not configured. Check the existing VITE_SUPABASE_URL and publishable key.'); setLoading(false); return }
    const generation = ++loadGeneration.current
    if (!online) {
      try {
        const cached = localStorage.getItem(`habit-trick:exams:${userId}:${selectedDate}`)
        if (cached) {
          const snapshot = JSON.parse(cached)
          setActivities(snapshot.activities ?? []); setExams(snapshot.exams ?? []); setSemesters(snapshot.semesters ?? [])
          setSubjects(snapshot.subjects ?? []); setUnits(snapshot.units ?? []); setTopics(snapshot.topics ?? [])
          setActivityReady(true); setExamReady(true); setError('Showing saved study planner data offline. Reconnect to sync changes.')
        } else { setActivities([]); setError('No saved planner data for this date while offline.') }
      } catch { setError('Saved planner data could not be read.') }
      setLoading(false)
      return
    }
    setLoading(true); setError('')
    try {
      const [activityResult, examResult, semesterResult, subjectResult, unitResult, topicResult] = await Promise.all([
        client.from('daily_study_activities').select('*').eq('user_id', userId).eq('activity_date', selectedDate).order('sort_order').order('start_time'),
        client.from('exams').select('*').eq('user_id', userId).order('exam_date'),
        client.from('semesters').select('*').eq('user_id', userId).order('created_at'),
        client.from('subjects').select('*').eq('user_id', userId).order('sort_order').order('name'),
        client.from('units').select('*').eq('user_id', userId).order('sort_order').order('name'),
        client.from('topics').select('*').eq('user_id', userId).order('sort_order').order('name'),
      ])
      if (generation !== loadGeneration.current) return
      const results = [activityResult, examResult, semesterResult, subjectResult, unitResult, topicResult]
      const names = ['daily_study_activities', 'exams', 'semesters', 'subjects', 'units', 'topics']
      const failures = results.flatMap((result, index) => result.error ? [`${names[index]} (${result.status}, ${result.error.code}): ${result.error.message}`] : [])
      const nextActivities = activityResult.data ?? [], nextExams = examResult.data ?? [], nextSemesters = semesterResult.data ?? []
      const nextSubjects = subjectResult.data ?? [], nextUnits = unitResult.data ?? [], nextTopics = topicResult.data ?? []
      setActivities(sortActivities(nextActivities)); setExams(nextExams); setSemesters(nextSemesters)
      setSubjects(nextSubjects); setUnits(nextUnits); setTopics(nextTopics)
      setActivityReady(!activityResult.error); setExamReady(!examResult.error)
      setError(failures.length ? `Exam planner schema/data error: ${failures[0]}. Apply the exams migrations through supabase/migrations/202610300001_exam_schedule_session_time.sql in Supabase, then retry.` : '')
      if (!failures.length) {
        try { localStorage.setItem(`habit-trick:exams:${userId}:${selectedDate}`, JSON.stringify({ activities: nextActivities, exams: nextExams, semesters: nextSemesters, subjects: nextSubjects, units: nextUnits, topics: nextTopics })) } catch { /* Cache is optional. */ }
      }
    } catch (cause) {
      if (generation === loadGeneration.current) setError(`Could not load the exam planner: ${cause instanceof Error ? cause.message : 'network request failed'}`)
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [client, userId, selectedDate, online])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!client) return
    const channel = client.channel(`exam-planner-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_study_activities', filter: `user_id=eq.${userId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exams', filter: `user_id=eq.${userId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subjects', filter: `user_id=eq.${userId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'units', filter: `user_id=eq.${userId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'topics', filter: `user_id=eq.${userId}` }, () => { void load() })
      .subscribe()
    return () => { void client.removeChannel(channel) }
  }, [client, userId, load])

  const strip = useMemo(() => makeDateStrip(selectedDate), [selectedDate])
  const scheduled = activities.filter(activity => Boolean(activity.start_time && activity.duration_minutes))
  // Older flexible records remain in Supabase, but the simplified daily plan only
  // presents scheduled activities. This deliberately avoids deleting user data.
  const completedCount = scheduled.filter(activity => activity.is_completed).length
  const totalMinutes = scheduled.reduce((sum, activity) => sum + (Number.isInteger(activity.duration_minutes) && activity.duration_minutes! > 0 ? activity.duration_minutes! : 0), 0)
  const today = localDateKey()
  const upcomingExams = sortExamsByDateAndTime(exams.filter(exam => exam.exam_date >= today))
  const pastExams = exams.filter(exam => exam.exam_date < today).sort((a, b) => b.exam_date.localeCompare(a.exam_date))
  const scheduleStart = `${scheduleMonth.getFullYear()}-${String(scheduleMonth.getMonth() + 1).padStart(2, '0')}-01`
  const scheduleEnd = `${scheduleMonth.getFullYear()}-${String(scheduleMonth.getMonth() + 2).padStart(2, '0')}-01`
  const scheduledExams = exams.filter(exam => exam.exam_date >= scheduleStart && exam.exam_date < scheduleEnd).sort((a, b) => a.exam_date.localeCompare(b.exam_date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''))
  const subjectsForActivity = subjects.filter(subject => !draft?.examId ? subject.exam_id === null : subject.exam_id === draft.examId || subject.exam_id === null)
  const topicSubject = (topicId: string) => {
    const topic = topics.find(item => item.id === topicId)
    return topic ? subjects.find(subject => subject.id === topic.subject_id) : undefined
  }

  function changeDate(date: string) { if (date) { setSelectedDate(date); setDraft(null); setMovingActivity(null) } }

  function changeScheduleMonth(offset: number) {
    setScheduleMonth(current => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  function openScheduleExam(exam?: Exam) {
    openExam(exam)
    if (!exam) setExamDraft(current => ({ ...current, date: scheduleStart, session: '', startTime: '' }))
  }

  async function deleteExam(exam: Exam) {
    if (!client || !online || !window.confirm(`Delete exam “${exam.name}”? Its study activities will be preserved.`)) return
    const result = await client.from('exams').delete().eq('id', exam.id).eq('user_id', userId)
    if (result.error) setError(`Could not delete exam: ${result.error.message}`)
    else { setExams(current => current.filter(item => item.id !== exam.id)); setExpandedExam(null); setNotice('Exam deleted. Linked study activities were kept.'); await load() }
  }

  async function saveSubjectLink(subjectName: string, examId: string) {
    const clean = subjectName.trim()
    if (!clean || !client) return { id: null as string | null, name: null as string | null }
    const existing = subjects.find(subject => subject.name.trim().toLocaleLowerCase() === clean.toLocaleLowerCase() && (subject.exam_id === examId || subject.exam_id === null))
    if (existing) return { id: existing.id, name: existing.name }
    const result = await client.from('subjects').insert({ user_id: userId, exam_id: examId || null, name: clean, sort_order: subjects.length }).select().single()
    if (result.error) throw new Error(`Could not save subject: ${result.error.message}`)
    setSubjects(current => [...current, result.data as Subject])
    return { id: result.data.id as string, name: result.data.name as string }
  }

  async function saveActivity(event: FormEvent, continueAdding = false) {
    event.preventDefault()
    if (!client || !online || !activityReady || !draft) return
    const title = draft.title.trim()
    if (!hasActivityIdentity(draft)) { setActivityValidationError('Enter an activity name or link an exam, subject, or topic.'); return }
    const duration = Number(draft.duration)
    if (!draft.startTime || !Number.isInteger(duration) || duration < 1 || duration > 1440) { setError('Scheduled activities need a start time and a duration from 1 to 1440 minutes.'); return }
    const candidate = { id: draft.id, activity_date: selectedDate, start_time: draft.startTime, duration_minutes: duration }
    if (activities.some(item => activitiesOverlap(candidate, item))) {
      setError('This time overlaps with another scheduled activity. Choose a different time.')
      return
    }
    setActivityValidationError(''); setError(''); setNotice('')
    try {
      const linkedSubject = draft.topicId ? topicSubject(draft.topicId) : undefined
      const subject = linkedSubject
        ? { id: linkedSubject.id, name: linkedSubject.name }
        : await saveSubjectLink(draft.subjectName, draft.examId)
      const topic = draft.topicId ? topics.find(item => item.id === draft.topicId) : undefined
      const linkedExam = topic ? (subject.id ? subjects.find(item => item.id === subject.id)?.exam_id ?? null : null) : draft.examId || null
      const payload = {
        title: title || null, user_id: userId, activity_date: selectedDate,
        subject_name: (subject.name ?? draft.subjectName.trim()) || null,
        subject_id: subject.id, exam_id: linkedExam, topic_id: topic?.id ?? null,
        start_time: candidate.start_time, duration_minutes: candidate.duration_minutes,
        sort_order: draft.id ? activities.find(item => item.id === draft.id)?.sort_order ?? activities.length : activities.length,
        updated_at: new Date().toISOString(),
      }
      const result = draft.id
        ? await client.from('daily_study_activities').update(payload).eq('id', draft.id).eq('user_id', userId)
        : await client.from('daily_study_activities').insert({ ...payload, is_completed: false })
      if (result.error) throw new Error(result.error.message)
      setDraft(continueAdding && !draft.id ? emptyDraft() : null)
      setNotice(draft.id ? 'Activity updated.' : 'Activity added.')
      await load()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not save activity.'
      setError(message.includes('23P01') || message.includes('overlaps') ? 'This time overlaps with another scheduled activity. Choose a different time.' : message)
    }
  }

  function beginEdit(activity: Activity) {
    if (!activity.start_time || !activity.duration_minutes) return
    setDraft({ id: activity.id, title: activity.title ?? '', subjectName: activity.subject_name ?? subjects.find(subject => subject.id === activity.subject_id)?.name ?? '', subjectId: activity.subject_id ?? '', examId: activity.exam_id ?? '', topicId: activity.topic_id ?? '', startTime: activity.start_time.slice(0, 5), duration: activity.duration_minutes.toString() })
    setMovingActivity(null)
  }

  async function toggleCompletion(activity: Activity) {
    if (!client || !online || !activityReady) return
    const result = await client.from('daily_study_activities').update({ is_completed: !activity.is_completed, updated_at: new Date().toISOString() }).eq('id', activity.id).eq('user_id', userId)
    if (result.error) setError(`Could not update completion: ${result.error.message}`)
    else { setActivities(current => current.map(item => item.id === activity.id ? { ...item, is_completed: !item.is_completed } : item)); setNotice('Activity completion saved.') }
  }

  async function removeActivity(activity: Activity) {
    if (!client || !online || !window.confirm(`Delete “${activity.title}”?`)) return
    const result = await client.from('daily_study_activities').delete().eq('id', activity.id).eq('user_id', userId)
    if (result.error) setError(`Could not delete activity: ${result.error.message}`)
    else { setActivities(current => current.filter(item => item.id !== activity.id)); setNotice('Activity deleted.') }
  }

  async function rescheduleActivity(activity: Activity) {
    if (!client || !online || !moveDate || moveDate === activity.activity_date) return
    if (activity.is_completed && !window.confirm('This activity is complete. Change its date and keep its completion status?')) return
    if (activity.start_time && activity.duration_minutes) {
      const existing = await client.from('daily_study_activities').select('id,activity_date,start_time,duration_minutes').eq('user_id', userId).eq('activity_date', moveDate).not('start_time', 'is', null)
      if (existing.error) { setError(`Could not validate the new date: ${existing.error.message}`); return }
      const candidate = { ...activity, activity_date: moveDate }
      if ((existing.data ?? []).some(item => activitiesOverlap(candidate, item))) {
        setError('This time overlaps with another scheduled activity. Choose a different time.')
        return
      }
    }
    const result = await client.from('daily_study_activities').update({ activity_date: moveDate, updated_at: new Date().toISOString() }).eq('id', activity.id).eq('user_id', userId)
    if (result.error) setError(result.error.code === '23P01' ? 'This time overlaps with another scheduled activity. Choose a different time.' : `Could not reschedule activity: ${result.error.message}`)
    else { setActivities(current => current.filter(item => item.id !== activity.id)); setMovingActivity(null); setNotice('Activity rescheduled; its completion status was preserved.') }
  }

  async function saveExam(event: FormEvent) {
    event.preventDefault()
    if (!client || !online || !examReady || !examDraft.name.trim() || !examDraft.date) return
    if (examDraft.session !== 'FN' && examDraft.session !== 'AN') { setError('Choose an Exam Session: FN or AN.'); return }
    try {
      const payload = { user_id: userId, semester_id: examDraft.semesterId || null, name: examDraft.name.trim(), exam_type: examDraft.type.trim() || null, exam_date: examDraft.date, session: examDraft.session, start_time: examDraft.startTime || null, notes: examDraft.notes.trim() || null, updated_at: new Date().toISOString() }
      const result = examDraft.id
        ? await client.from('exams').update(payload).eq('id', examDraft.id).eq('user_id', userId).select().single()
        : await client.from('exams').insert(payload).select().single()
      if (result.error) throw new Error(result.error.message)
      const saved = result.data as Exam
      setExams(current => [...current.filter(item => item.id !== saved.id), saved].sort((a, b) => a.exam_date.localeCompare(b.exam_date) || (a.start_time ?? '').localeCompare(b.start_time ?? '')))
      setExamDraft({ id: '', name: '', type: '', date: '', session: '', startTime: '', notes: '', semesterId: '', semesterName: '' }); setIsExamFormOpen(false); setNotice(examDraft.id ? 'Exam updated.' : 'Exam added.')
      await load()
    } catch (cause) { setError(`Could not save exam: ${cause instanceof Error ? cause.message : 'unknown error'}`) }
  }

  async function addSubject(event: FormEvent, examId: string) {
    event.preventDefault(); if (!client || !online || !subjectDraft?.name.trim()) return
    const result = await client.from('subjects').insert({ user_id: userId, exam_id: examId || null, name: subjectDraft.name.trim(), sort_order: subjects.length }).select().single()
    if (result.error) setError(`Could not add subject: ${result.error.message}`)
    else { setSubjects(current => [...current, result.data as Subject]); setSubjectDraft(null); setNotice('Subject added.') }
  }

  async function addUnit(event: FormEvent, subjectId: string) {
    event.preventDefault(); if (!client || !online || !unitDraft?.name.trim()) return
    const result = await client.from('units').insert({ user_id: userId, subject_id: subjectId, name: unitDraft.name.trim(), sort_order: units.filter(item => item.subject_id === subjectId).length }).select().single()
    if (result.error) setError(`Could not add unit: ${result.error.message}`)
    else { setUnits(current => [...current, result.data as Unit]); setUnitDraft(null); setNotice('Unit added.') }
  }

  async function addTopic(event: FormEvent, subjectId: string, unitId: string | null) {
    event.preventDefault(); if (!client || !online || !topicDraft?.name.trim()) return
    const result = await client.from('topics').insert({ user_id: userId, subject_id: subjectId, unit_id: unitId, name: topicDraft.name.trim(), sort_order: topics.filter(item => item.subject_id === subjectId).length }).select().single()
    if (result.error) setError(`Could not add topic: ${result.error.message}`)
    else { setTopics(current => [...current, result.data as Topic]); setTopicDraft(null); setNotice('Topic added.') }
  }

  async function setTopicStatus(topic: Topic, status: TopicStatus) {
    if (!client || !online) return
    const result = await client.from('topics').update({ status, updated_at: new Date().toISOString() }).eq('id', topic.id).eq('user_id', userId)
    if (result.error) setError(`Could not update topic: ${result.error.message}`)
    else setTopics(current => current.map(item => item.id === topic.id ? { ...item, status } : item))
  }

  const topicPicker = (value: string, onChange: (value: string) => void) => <select aria-label="Link a syllabus topic" value={value} onChange={event => onChange(event.target.value)}><option value="">No topic link</option>{topics.map(topic => <option key={topic.id} value={topic.id}>{subjects.find(subject => subject.id === topic.subject_id)?.name ?? 'Subject'} · {topic.name}</option>)}</select>

  function renderActivityEditor() {
    if (!draft) return null
    const calculatedEnd = endTime(draft.startTime, Number(draft.duration))
    const handleKeys = (event: KeyboardEvent<HTMLFormElement>) => {
      if (event.key === 'Escape' && !draft.id && !draft.title.trim() && !draft.subjectName.trim()) { event.preventDefault(); setDraft(null) }
    }
    return <form className="exam-inline-editor" onSubmit={event => void saveActivity(event, true)} onKeyDown={handleKeys}>
      <input aria-label="Activity title" autoFocus placeholder="What will you study?" value={draft.title} onChange={event => { setActivityValidationError(''); setDraft({ ...draft, title: event.target.value }) }} maxLength={200}/>
      <input aria-label="Subject" list="exam-subject-options" placeholder="Subject (optional)" value={draft.subjectName} onChange={event => { setActivityValidationError(''); setDraft({ ...draft, subjectName: event.target.value, subjectId: '', topicId: '' }) }}/>
      <datalist id="exam-subject-options">{subjectsForActivity.map(subject => <option key={subject.id} value={subject.name}/>)}</datalist>
      <select aria-label="Link an exam" value={draft.examId} onChange={event => { setActivityValidationError(''); setDraft({ ...draft, examId: event.target.value, subjectId: '', topicId: '' }) }}><option value="">No exam link</option>{exams.map(exam => <option key={exam.id} value={exam.id}>{exam.name}</option>)}</select>
      {topicPicker(draft.topicId, topicId => {
        const topic = topics.find(item => item.id === topicId), subject = topic ? subjects.find(item => item.id === topic.subject_id) : undefined
        setActivityValidationError(''); setDraft({ ...draft, topicId, subjectId: subject?.id ?? '', subjectName: subject?.name ?? '', examId: subject?.exam_id ?? '' })
      })}
      <>
        <label className="exam-time-field"><span>Start</span><input aria-label="Start time" type="time" required value={draft.startTime} onChange={event => setDraft({ ...draft, startTime: event.target.value })}/></label>
        <label className="exam-duration-field"><span>Minutes</span><input aria-label="Duration in minutes" type="number" min="1" max="1440" step="1" required value={draft.duration} onChange={event => setDraft({ ...draft, duration: event.target.value })}/></label>
        <span className="exam-end-time">{calculatedEnd ? `Ends ${formatTime12(calculatedEnd.time)}${calculatedEnd.nextDay ? ' (+1 day)' : ''}` : 'End time calculated'}</span>
      </>
      <div className="exam-editor-actions"><button type="button" className="secondary" onClick={() => setDraft(null)}>Cancel</button><button className="primary" disabled={!online}>{draft.id ? 'Save' : 'Add activity'}</button></div>
    </form>
  }

  function renderActivity(activity: Activity) {
    if (draft?.id === activity.id) return <li className="exam-activity editing" key={activity.id}>{renderActivityEditor()}</li>
    const end = activity.start_time ? endTime(activity.start_time, activity.duration_minutes ?? 0) : null
    const linkedExam = exams.find(exam => exam.id === activity.exam_id)
    const subject = activity.subject_name || subjects.find(item => item.id === activity.subject_id)?.name
    const linkedTopic = activity.topic_id ? topics.find(topic => topic.id === activity.topic_id)?.name : ''
    const displayTitle = activity.title?.trim() || linkedExam?.name || linkedTopic || subject || 'Linked study activity'
    return <li className={`exam-activity ${activity.is_completed ? 'completed' : ''}`} key={activity.id}>
      <label className="exam-completion"><input type="checkbox" checked={activity.is_completed} disabled={!online||!activityReady} onChange={() => void toggleCompletion(activity)}/><span aria-hidden="true"><Check size={14}/></span></label>
      <div className="exam-activity-time"><strong>{formatTime12(activity.start_time!)}</strong><small>{end ? `to ${formatTime12(end.time)}${end.nextDay ? ' +1d' : ''}` : ''}</small></div>
      <div className="exam-activity-copy"><strong>{displayTitle}</strong><span>{[subject, linkedExam?.name, linkedTopic].filter(Boolean).join(' · ')}</span></div>
      <div className="exam-activity-actions"><button type="button" aria-label={`Edit ${displayTitle}`} title="Edit" disabled={!online} onClick={() => beginEdit(activity)}><Pencil size={15}/></button><button type="button" aria-label={`Reschedule ${displayTitle}`} title="Reschedule" disabled={!online} onClick={() => { setMovingActivity(activity.id); setMoveDate(activity.activity_date) }}><CalendarDays size={15}/></button><button type="button" aria-label={`Delete ${displayTitle}`} title="Delete" disabled={!online} onClick={() => void removeActivity(activity)}><Trash2 size={15}/></button></div>
      {movingActivity === activity.id && <form className="exam-reschedule" onSubmit={event => { event.preventDefault(); void rescheduleActivity(activity) }}><label>Move to <input type="date" value={moveDate} required onChange={event => setMoveDate(event.target.value)}/></label><button className="primary">Save date</button><button type="button" className="secondary" onClick={() => setMovingActivity(null)}>Cancel</button></form>}
    </li>
  }

  function openExam(exam?: Exam) {
    setExamDraft(exam ? { id: exam.id, name: exam.name, type: exam.exam_type ?? '', date: exam.exam_date, session: exam.session ?? '', startTime: exam.start_time?.slice(0, 5) ?? '', notes: exam.notes ?? '', semesterId: exam.semester_id ?? '', semesterName: '' } : { id: '', name: '', type: '', date: localDateKey(), session: '', startTime: '', notes: '', semesterId: '', semesterName: '' })
    setIsExamFormOpen(true)
  }

  function renderSyllabus(exam: Exam) {
    const examSubjects = subjects.filter(subject => subject.exam_id === exam.id)
    const examTopics = examSubjects.flatMap(subject => topics.filter(topic => topic.subject_id === subject.id))
    const progress = progressPercent(examTopics)
    return <div className="exam-syllabus">
      <div className="exam-progress"><span>Syllabus progress</span><strong>{progress === null ? 'No topics yet' : `${progress}%`}</strong></div>
      {examSubjects.map(subject => {
        const subjectUnits = units.filter(unit => unit.subject_id === subject.id)
        const subjectTopics = topics.filter(topic => topic.subject_id === subject.id)
        const subjectProgress = progressPercent(subjectTopics)
        return <section className="syllabus-subject" key={subject.id}>
          <header><strong>{subject.name}</strong><span>{subjectProgress === null ? 'No topics' : `${subjectProgress}% complete`}</span><button type="button" className="text-action" onClick={() => setTopicDraft({ subjectId: subject.id, unitId: '', name: '' })}><Plus size={14}/> Topic</button><button type="button" className="text-action" onClick={() => setUnitDraft({ subjectId: subject.id, name: '' })}><Plus size={14}/> Unit</button></header>
          {subjectUnits.map(unit => <div className="syllabus-unit" key={unit.id}><h4>{unit.name}</h4>{subjectTopics.filter(topic => topic.unit_id === unit.id).map(topic => <TopicRow key={topic.id} topic={topic} onChange={setTopicStatus}/>) }{topicDraft?.subjectId === subject.id && topicDraft.unitId === unit.id && <form className="syllabus-add" onSubmit={event => void addTopic(event, subject.id, unit.id)}><input autoFocus required placeholder="Topic name" value={topicDraft.name} onChange={event => setTopicDraft({ ...topicDraft, name: event.target.value })}/><button className="primary">Add</button><button type="button" className="secondary" onClick={() => setTopicDraft(null)}>Cancel</button></form>}</div>)}
          {subjectTopics.filter(topic => !topic.unit_id).map(topic => <TopicRow key={topic.id} topic={topic} onChange={setTopicStatus}/>)}
          {topicDraft?.subjectId === subject.id && !topicDraft.unitId && <form className="syllabus-add" onSubmit={event => void addTopic(event, subject.id, null)}><input autoFocus required placeholder="Topic name" value={topicDraft.name} onChange={event => setTopicDraft({ ...topicDraft, name: event.target.value })}/><button className="primary">Add</button><button type="button" className="secondary" onClick={() => setTopicDraft(null)}>Cancel</button></form>}
          {unitDraft?.subjectId === subject.id && <form className="syllabus-add" onSubmit={event => void addUnit(event, subject.id)}><input autoFocus required placeholder="Unit name" value={unitDraft.name} onChange={event => setUnitDraft({ ...unitDraft, name: event.target.value })}/><button className="primary">Add</button><button type="button" className="secondary" onClick={() => setUnitDraft(null)}>Cancel</button></form>}
        </section>
      })}
      {subjectDraft?.examId === exam.id && <form className="syllabus-add" onSubmit={event => void addSubject(event, exam.id)}><input autoFocus required placeholder="Subject name" value={subjectDraft.name} onChange={event => setSubjectDraft({ ...subjectDraft, name: event.target.value })}/><button className="primary">Add subject</button><button type="button" className="secondary" onClick={() => setSubjectDraft(null)}>Cancel</button></form>}
      <button type="button" className="text-action" onClick={() => setSubjectDraft({ examId: exam.id, name: '' })}><Plus size={14}/> Add subject</button>
    </div>
  }

  function renderExamForm(className: string) {
    return <form className={className} onSubmit={event => void saveExam(event)}>
      <label>Exam name<input autoFocus required maxLength={140} value={examDraft.name} onChange={event => setExamDraft({ ...examDraft, name: event.target.value })}/></label>
      <label>Exam date<input type="date" required value={examDraft.date} onChange={event => setExamDraft({ ...examDraft, date: event.target.value })}/></label>
      <label>Exam type (optional)<input placeholder="Mid-term" value={examDraft.type} onChange={event => setExamDraft({ ...examDraft, type: event.target.value })}/></label>
      <label>Exam session<select required value={examDraft.session} onChange={event => { const session = event.target.value as 'FN' | 'AN' | ''; setExamDraft({ ...examDraft, session, startTime: session === 'FN' && !examDraft.startTime ? '09:00' : session === 'AN' && !examDraft.startTime ? '14:00' : examDraft.startTime }) }}><option value="" disabled>Choose a session</option><option value="FN">FN — Forenoon</option><option value="AN">AN — Afternoon</option></select></label>
      <label>Individual start time<input type="time" required value={examDraft.startTime} onChange={event => setExamDraft({ ...examDraft, startTime: event.target.value })}/></label>
      <label className="exam-schedule-notes">Notes (optional)<textarea rows={2} value={examDraft.notes} onChange={event => setExamDraft({ ...examDraft, notes: event.target.value })}/></label>
      <div className="exam-editor-actions"><button type="button" className="secondary" onClick={() => setIsExamFormOpen(false)}>Cancel</button><button className="primary">{examDraft.id ? 'Save exam' : 'Add exam'}</button></div>
    </form>
  }

  function renderSchedule() {
    return <>
      {error && <div className="alert exam-alert" role="alert">{error}<button type="button" onClick={() => void load()}>Retry</button></div>}
      {notice && <div className="notice" role="status">{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}
      <section className="exam-schedule" aria-label="Monthly exam schedule">
      <header className="exam-schedule-header"><div><div className="eyebrow">EXAM SCHEDULE</div><h2>{scheduleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2></div><div className="exam-schedule-controls"><button type="button" className="icon-button" aria-label="Previous month" onClick={() => changeScheduleMonth(-1)}><ChevronLeft size={18}/></button><button type="button" className="secondary" onClick={() => setScheduleMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>This month</button><button type="button" className="icon-button" aria-label="Next month" onClick={() => changeScheduleMonth(1)}><ChevronRight size={18}/></button><button type="button" className="primary" disabled={!online || !examReady} onClick={() => openScheduleExam()}><Plus size={16}/> Add exam</button></div></header>
      {isExamFormOpen && renderExamForm('exam-schedule-form')}
      {scheduledExams.length ? <ul className="exam-schedule-list">{scheduledExams.map(exam => { const remaining = daysUntil(exam.exam_date, today); return <li key={exam.id}><button type="button" className="exam-schedule-main" onClick={() => { setSelectedDate(exam.exam_date); setPlannerView('daily'); setExpandedExam(exam.id) }}><span className="exam-schedule-date"><strong>{localDateLabel(exam.exam_date, { day: 'numeric' })}</strong><small>{localDateLabel(exam.exam_date, { weekday: 'short', month: 'short' })}</small></span><span className="exam-schedule-name"><strong>{exam.name}</strong><small>{exam.exam_type || 'Exam'}{exam.semester_id ? ` · ${semesters.find(item => item.id === exam.semester_id)?.name ?? 'Semester'}` : ''}</small></span><span className="exam-session-badge">{exam.session ?? '—'}</span><span className="exam-start-time">{exam.start_time ? formatTime12(exam.start_time) : 'Time not set'}</span><span className="exam-days-remaining">{remaining < 0 ? 'Past' : remaining === 0 ? 'Today' : remaining === 1 ? '1 day' : `${remaining} days`}</span></button><div className="exam-schedule-actions"><button type="button" aria-label={`Open preparation for ${exam.name}`} onClick={() => { setSelectedDate(exam.exam_date); setPlannerView('daily'); setExpandedExam(exam.id) }}>Preparation</button><button type="button" aria-label={`Edit ${exam.name}`} onClick={() => openScheduleExam(exam)}><Pencil size={15}/></button><button type="button" aria-label={`Delete ${exam.name}`} onClick={() => void deleteExam(exam)}><Trash2 size={15}/></button></div></li> })}</ul> : <div className="exam-empty"><CalendarDays size={25}/><strong>No exams scheduled this month</strong><span>Add an exam with its date, session, and individual start time.</span></div>}
      </section>
    </>
  }

  return <section className="exam-planner" aria-label="Exam planner">
    <header className="exam-page-heading"><div><div className="eyebrow">STUDY PLANNER</div><h1>Exams</h1><p>{plannerView === 'schedule' ? 'Manage every exam for the selected month.' : 'Plan the work for each day, whether or not an exam is scheduled.'}</p></div><div className="exam-date-tools"><button type="button" className="secondary" onClick={() => plannerView === 'schedule' ? setScheduleMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1)) : changeDate(today)}>{plannerView === 'schedule' ? 'This month' : 'Today'}</button>{plannerView === 'daily' && <label className="exam-date-picker" aria-label="Jump to date"><CalendarDays size={16}/><input type="date" value={selectedDate} onChange={event => changeDate(event.target.value)}/></label>}</div></header>
    <nav className="exam-view-nav" aria-label="Exams navigation"><button type="button" className={plannerView === 'schedule' ? 'active' : ''} aria-pressed={plannerView === 'schedule'} onClick={() => setPlannerView('schedule')}>Exam Schedule</button><button type="button" className={plannerView === 'daily' ? 'active' : ''} aria-pressed={plannerView === 'daily'} onClick={() => setPlannerView('daily')}>Daily Study Plan</button></nav>
    {plannerView === 'schedule' ? renderSchedule() : <>
    <nav className="exam-date-nav" aria-label="Choose study date"><button type="button" aria-label="Previous day" onClick={() => changeDateFrom(selectedDate, -1)}><ChevronLeft size={18}/></button><div className="exam-date-strip">{strip.map(date => <button type="button" className={`exam-date-chip ${date === selectedDate ? 'selected' : ''} ${date === today ? 'today' : ''}`} aria-pressed={date === selectedDate} key={date} onClick={() => changeDate(date)}><span>{localDateLabel(date, { weekday: 'short' })}</span><strong>{Number(date.slice(8, 10))}</strong><small>{localDateLabel(date, { month: 'short' })}</small></button>)}</div><button type="button" aria-label="Next day" onClick={() => changeDateFrom(selectedDate, 1)}><ChevronRight size={18}/></button></nav>

    {error && <div className="alert exam-alert" role="alert">{error}<button type="button" onClick={() => void load()}>Retry</button></div>}
    {notice && <div className="notice" role="status">{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice('')}>×</button></div>}
    <div className="exam-summary" aria-label="Daily study summary"><div><span>Scheduled activities</span><strong>{scheduled.length}</strong></div><div><span>Completed</span><strong>{completedCount}</strong></div><div><span>Scheduled study</span><strong>{totalMinutes >= 60 ? `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60 ? `${totalMinutes % 60}m` : ''}` : `${totalMinutes}m`}</strong></div><div><span>Selected date</span><strong>{localDateLabel(selectedDate, { month: 'short', day: 'numeric' })}</strong></div></div>

    <div className="exam-planner-columns"><main className="exam-day-plan"><header className="exam-section-heading"><div><div className="eyebrow">DAILY PLAN</div><h2>{localDateLabel(selectedDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h2></div><span>{loading ? 'Loading…' : `${scheduled.length} planned`}</span></header>
      <section className="exam-activity-section"><header><div><Clock3 size={17}/><h3>Scheduled activities</h3><span>{scheduled.length}</span></div></header><ol className="exam-activity-list">{sortActivities(scheduled).map(renderActivity)}</ol>{renderActivityEditor()}<button type="button" className="exam-add-row" disabled={!online||!activityReady||Boolean(draft)} onClick={() => setDraft(emptyDraft())}><Plus size={16}/> Add Scheduled Activity</button></section>
      {!scheduled.length && !draft && !loading && <div className="exam-empty"><CalendarDays size={25}/><strong>No scheduled activities for this date</strong><span>Add a scheduled study activity above.</span></div>}
    </main>

    <aside className="exam-sidebar"><section className="upcoming-exams-card"><header className="exam-section-heading"><div><div className="eyebrow">EXAM DATES</div><h2>Upcoming exams</h2></div><button type="button" className="icon-button" aria-label="Add exam" disabled={!online||!examReady} onClick={() => openExam()}><Plus size={18}/></button></header>
      {isExamFormOpen && renderExamForm('exam-create-form')}
      {upcomingExams.length ? <ul className="exam-countdown-list">{upcomingExams.map((exam, index) => { const countdown = upcomingExamGapLabel(upcomingExams, index, today); const examSubjects = subjects.filter(subject => subject.exam_id === exam.id); const allTopics = examSubjects.flatMap(subject => topics.filter(topic => topic.subject_id === subject.id)); return <li key={exam.id}><button type="button" className="exam-countdown-main" onClick={() => setExpandedExam(expandedExam === exam.id ? null : exam.id)}><span className="exam-countdown-date">{localDateLabel(exam.exam_date, { month: 'short', day: 'numeric' })}</span><span className="exam-countdown-copy"><strong>{exam.name}</strong><small>{[exam.exam_type, exam.session ?? 'Session not set', exam.start_time ? formatTime12(exam.start_time) : 'Time not set'].filter(Boolean).join(' · ')}</small></span><b>{countdown}</b></button>{expandedExam === exam.id && <>{exam.notes && <p className="exam-notes">{exam.notes}</p>}{renderSyllabus(exam)}<button type="button" className="text-action" onClick={() => openExam(exam)}><Pencil size={14}/> Edit exam</button><span className="exam-mini-progress">{allTopics.length ? `${progressPercent(allTopics)}% prepared` : 'Syllabus not added'}</span></>}</li>})}</ul> : <p className="exam-no-dates">No upcoming exam dates. You can still plan activities for any day.</p>}
      {pastExams.length > 0 && <details className="past-exams"><summary>Past exams ({pastExams.length})</summary><ul>{pastExams.map(exam => <li key={exam.id}><button type="button" onClick={() => { setExpandedExam(expandedExam === exam.id ? null : exam.id); setExamDraft({ id: exam.id, name: exam.name, type: exam.exam_type ?? '', date: exam.exam_date, notes: exam.notes ?? '', semesterId: exam.semester_id ?? '', semesterName: '' }) }}>{exam.name} · {localDateLabel(exam.exam_date, { month: 'short', day: 'numeric', year: 'numeric' })}</button>{expandedExam === exam.id && <>{renderSyllabus(exam)}<button type="button" className="text-action" onClick={() => openExam(exam)}><Pencil size={14}/> Edit exam</button></>}</li>)}</ul></details>}
    </section></aside></div>
    </>}
      {activityValidationError && <p className="exam-activity-validation" role="alert">{activityValidationError}</p>}
  </section>
}

function changeDateFrom(current: string, amount: number) {
  const next = new Date(Number(current.slice(0, 4)), Number(current.slice(5, 7)) - 1, Number(current.slice(8, 10)) + amount, 12)
  return localDateKey(next)
}

function TopicRow({ topic, onChange }: { topic: Topic; onChange: (topic: Topic, status: TopicStatus) => void }) {
  return <div className="syllabus-topic"><span>{topic.name}</span><select aria-label={`${topic.name} progress`} value={topic.status} onChange={event => onChange(topic, event.target.value as TopicStatus)}>{(Object.keys(statusLabel) as TopicStatus[]).map(status => <option key={status} value={status}>{statusLabel[status]}</option>)}</select></div>
}
