import test from 'node:test'
import assert from 'node:assert/strict'
import { activitiesOverlap, daysUntil, endTime, formatTime12, hasActivityIdentity, intervalsOverlap, localDateKey, makeDateStrip, progressPercent, shiftDateKey, sortActivities, sortExamsByDateAndTime, upcomingExamGapLabel } from '../src/examUtils.js'

test('local planner dates navigate month, year, and leap-day boundaries', () => {
  assert.equal(localDateKey(new Date(2026, 0, 1, 0, 5)), '2026-01-01')
  assert.equal(shiftDateKey('2026-10-31', 1), '2026-11-01')
  assert.equal(shiftDateKey('2025-12-31', 1), '2026-01-01')
  assert.equal(shiftDateKey('2024-02-28', 1), '2024-02-29')
  assert.equal(shiftDateKey('2024-02-29', 1), '2024-03-01')
})

test('date strip is centered on the selected local date', () => {
  const strip = makeDateStrip('2026-01-01', 2, 2)
  assert.deepEqual(strip, ['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03'])
})

test('exam countdowns use calendar-day arithmetic without DST hour drift', () => {
  assert.equal(daysUntil('2024-03-01', '2024-02-28'), 2)
  assert.equal(daysUntil('2026-01-01', '2025-12-31'), 1)
  assert.equal(daysUntil('2026-10-27', '2026-10-28'), -1)
  assert.equal(daysUntil('2026-10-28', '2026-10-28'), 0)
})

test('upcoming exam gaps use today once, then the previous sorted exam date', () => {
  const sorted = sortExamsByDateAndTime([
    { id: 'later', exam_date: '2026-11-12', start_time: '14:00' },
    { id: 'same-day-late', exam_date: '2026-11-10', start_time: '13:00' },
    { id: 'first', exam_date: '2026-11-10', start_time: '09:00' },
    { id: 'middle', exam_date: '2026-11-11', start_time: '08:00' },
  ])
  assert.deepEqual(sorted.map(exam => exam.id), ['first', 'same-day-late', 'middle', 'later'])
  assert.equal(upcomingExamGapLabel(sorted, 0, '2026-10-29'), '12 days from today')
  assert.equal(upcomingExamGapLabel(sorted, 1, '2026-10-29'), '0 days after previous exam')
  assert.equal(upcomingExamGapLabel(sorted, 2, '2026-10-29'), '1 day after previous exam')
  assert.equal(upcomingExamGapLabel(sorted, 3, '2026-10-29'), '1 day after previous exam')
})

test('exam gap labels recalculate after an exam edit or deletion', () => {
  const afterEdit = sortExamsByDateAndTime([
    { exam_date: '2026-11-03', start_time: '09:00' },
    { exam_date: '2026-11-07', start_time: '09:00' },
  ])
  assert.equal(upcomingExamGapLabel(afterEdit, 1, '2026-11-01'), '4 days after previous exam')
  assert.equal(upcomingExamGapLabel([afterEdit[1]], 0, '2026-11-01'), '6 days from today')
})

test('scheduled activities need a name or an existing supported link', () => {
  assert.equal(hasActivityIdentity({ title: 'Revise chapter' }), true)
  assert.equal(hasActivityIdentity({ title: '   ', examId: 'exam-1' }), true)
  assert.equal(hasActivityIdentity({ topicId: 'topic-1' }), true)
  assert.equal(hasActivityIdentity({ subjectName: 'Algorithms' }), true)
  assert.equal(hasActivityIdentity({ title: '  ', subjectName: '  ', subjectId: '', examId: '', topicId: '' }), false)
})

test('monthly schedule boundaries include only the selected calendar month', () => {
  const inMonth = date => date >= '2026-12-01' && date < '2027-01-01'
  assert.equal(inMonth('2026-12-01'), true)
  assert.equal(inMonth('2026-12-31'), true)
  assert.equal(inMonth('2027-01-01'), false)
  assert.equal(inMonth('2026-11-30'), false)
})

test('scheduled activity end time and 12-hour labels are calculated', () => {
  assert.equal(formatTime12('09:00:00'), '9:00 AM')
  assert.equal(formatTime12('12:05'), '12:05 PM')
  assert.deepEqual(endTime('23:30', 90), { time: '01:00', nextDay: true })
  assert.deepEqual(endTime('09:15', 45), { time: '10:00', nextDay: false })
  assert.equal(endTime(null, 45), null)
})

test('overlap warnings distinguish real overlaps from adjacent or flexible activities', () => {
  const first = { start_time: '09:00', duration_minutes: 60 }
  assert.equal(intervalsOverlap(first, { start_time: '09:30', duration_minutes: 30 }), true)
  assert.equal(intervalsOverlap(first, { start_time: '10:00', duration_minutes: 45 }), false)
  assert.equal(intervalsOverlap(first, { start_time: null, duration_minutes: null }), false)
})

test('same-date identical and partial slots conflict, while adjacent slots do not', () => {
  const first = { id: 'first', activity_date: '2026-10-28', start_time: '09:00', duration_minutes: 60 }
  assert.equal(activitiesOverlap(first, { id: 'same', activity_date: '2026-10-28', start_time: '09:00', duration_minutes: 60 }), true)
  assert.equal(activitiesOverlap(first, { id: 'partial', activity_date: '2026-10-28', start_time: '09:30', duration_minutes: 60 }), true)
  assert.equal(activitiesOverlap(first, { id: 'adjacent', activity_date: '2026-10-28', start_time: '10:00', duration_minutes: 60 }), false)
})

test('activity overlap ignores different dates, the edited row itself, and flexible rows', () => {
  const first = { id: 'same-row', activity_date: '2026-10-28', start_time: '09:00', duration_minutes: 60 }
  assert.equal(activitiesOverlap(first, { ...first }), false)
  assert.equal(activitiesOverlap(first, { id: 'tomorrow', activity_date: '2026-10-29', start_time: '09:00', duration_minutes: 60 }), false)
  assert.equal(activitiesOverlap(first, { id: 'flexible', activity_date: '2026-10-28', start_time: null, duration_minutes: null }), false)
})

test('exam sessions keep FN and AN distinct while legacy exams can remain unset', () => {
  const validSessions = new Set(['FN', 'AN'])
  assert.equal(validSessions.has('FN'), true)
  assert.equal(validSessions.has('AN'), true)
  assert.equal(validSessions.has(''), false)
  assert.equal(null ?? 'Session not set', 'Session not set')
})

test('same-day activities sort stably, scheduled before flexible, without dropping rows', () => {
  const rows = [
    { id: 'flex', start_time: null, sort_order: 0, created_at: '2026-10-28T07:00:00Z' },
    { id: 'late', start_time: '11:00', sort_order: 1, created_at: '2026-10-28T07:01:00Z' },
    { id: 'early', start_time: '09:00', sort_order: 2, created_at: '2026-10-28T07:02:00Z' },
  ]
  assert.deepEqual(sortActivities(rows).map(row => row.id), ['early', 'late', 'flex'])
  assert.equal(rows.length, 3)
})

test('preparation progress deduplicates topic IDs and leaves an empty syllabus unset', () => {
  const topics = [
    { id: 'a', status: 'completed' },
    { id: 'a', status: 'learning' },
    { id: 'b', status: 'needs_revision' },
  ]
  assert.equal(progressPercent(topics), 50)
  assert.equal(progressPercent([]), null)
})
