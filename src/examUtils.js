export function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function shiftDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day + days, 12)
  return localDateKey(date)
}

export function makeDateStrip(centerDate, before = 3, after = 7) {
  return Array.from({ length: before + after + 1 }, (_, index) => shiftDateKey(centerDate, index - before))
}

export function daysUntil(examDate, today = localDateKey()) {
  const ordinal = key => {
    const [year, month, day] = key.split('-').map(Number)
    return Date.UTC(year, month - 1, day) / 86400000
  }
  return ordinal(examDate) - ordinal(today)
}

export function sortExamsByDateAndTime(exams) {
  return [...exams].sort((a, b) => a.exam_date.localeCompare(b.exam_date) || (a.start_time ?? '').localeCompare(b.start_time ?? ''))
}

export function upcomingExamGapLabel(exams, index, today = localDateKey()) {
  const exam = exams[index]
  if (!exam) return ''
  const difference = index === 0
    ? daysUntil(exam.exam_date, today)
    : daysUntil(exam.exam_date, exams[index - 1].exam_date)
  if (index === 0) return difference === 0 ? 'Today' : `${difference} ${difference === 1 ? 'day' : 'days'} from today`
  return `${difference} ${difference === 1 ? 'day' : 'days'} after previous exam`
}

export function hasActivityIdentity({ title, subjectName, subjectId, examId, topicId }) {
  return Boolean(title?.trim() || subjectName?.trim() || subjectId || examId || topicId)
}

export function formatTime12(time) {
  if (!time || !/^\d{2}:\d{2}/.test(time)) return ''
  const [hour, minute] = time.slice(0, 5).split(':').map(Number)
  const suffix = hour < 12 ? 'AM' : 'PM'
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function endTime(startTime, durationMinutes) {
  if (!startTime || !Number.isInteger(Number(durationMinutes)) || Number(durationMinutes) <= 0) return null
  const [hour, minute] = startTime.slice(0, 5).split(':').map(Number)
  const total = hour * 60 + minute + Number(durationMinutes)
  const clock = `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  return { time: clock, nextDay: total >= 1440 }
}

export function intervalsOverlap(first, second) {
  if (!first.start_time || !first.duration_minutes || !second.start_time || !second.duration_minutes) return false
  const start = value => {
    const [hour, minute] = value.slice(0, 5).split(':').map(Number)
    return hour * 60 + minute
  }
  const a = start(first.start_time), b = start(second.start_time)
  return a < b + Number(second.duration_minutes) && b < a + Number(first.duration_minutes)
}

export function activitiesOverlap(first, second) {
  if (first.activity_date !== second.activity_date || first.id === second.id) return false
  return intervalsOverlap(first, second)
}

export function progressPercent(topics) {
  const unique = new Map()
  for (const topic of topics) {
    const existing = unique.get(topic.id)
    // A duplicated topic must still count once; retain completion if any copy
    // reports it so a stale duplicate cannot reduce preparation progress.
    if (!existing || topic.status === 'completed') unique.set(topic.id, topic)
  }
  if (!unique.size) return null
  const done = [...unique.values()].filter(topic => topic.status === 'completed').length
  return Math.round(done / unique.size * 100)
}

export function sortActivities(activities) {
  return [...activities].sort((a, b) => {
    const aTime = a.start_time || '99:99'
    const bTime = b.start_time || '99:99'
    return aTime.localeCompare(bTime) || a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)
  })
}
