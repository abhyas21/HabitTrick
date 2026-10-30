import test from 'node:test'
import assert from 'node:assert/strict'
import { completionKey, dailyCompletionPercent, eligibleDaysInMonth, getCompletionStats, isTodayDate, isTrackableDate, localDateKeyFromTimestamp, mergeCompletions, monthDayCount, moveItem, toDateKey } from '../src/tracker.js'

test('month lengths cover 28, leap-year 29, 30, and 31 days', () => {
  assert.equal(monthDayCount(2025, 1), 28)
  assert.equal(monthDayCount(2024, 1), 29)
  assert.equal(monthDayCount(2026, 3), 30)
  assert.equal(monthDayCount(2026, 0), 31)
})

test('date keys are stable local calendar dates with zero padding', () => {
  assert.equal(toDateKey(2026, 0, 3), '2026-01-03')
  assert.equal(toDateKey(2026, 11, 31), '2026-12-31')
})

test('creation timestamps map to local calendar dates, including timezone offsets', () => {
  const timestamp = '2026-10-27T18:30:00.000Z'
  const local = new Date(timestamp)
  assert.equal(localDateKeyFromTimestamp(timestamp), toDateKey(local.getFullYear(), local.getMonth(), local.getDate()))
  assert.equal(localDateKeyFromTimestamp('2026-10-27'), '2026-10-27')
  assert.equal(localDateKeyFromTimestamp('invalid'), null)
})

test('eligible days exclude future days and future months', () => {
  const today = new Date(2024, 1, 20, 12)
  assert.equal(eligibleDaysInMonth(2024, 1, today), 20)
  assert.equal(eligibleDaysInMonth(2024, 0, today), 31)
  assert.equal(eligibleDaysInMonth(2024, 2, today), 0)
})

test('tracking rejects impossible and future dates', () => {
  const today = new Date(2024, 1, 20, 12)
  assert.equal(isTrackableDate(2024, 1, 29, today), false)
  assert.equal(isTrackableDate(2024, 1, 20, today), true)
  assert.equal(isTrackableDate(2024, 1, 21, today), false)
  assert.equal(isTrackableDate(2023, 1, 29, today), false)
})

test('only the local calendar date for today is editable', () => {
  const today = new Date(2024, 1, 29, 23, 59)
  assert.equal(isTodayDate('2024-02-29', today), true)
  assert.equal(isTodayDate('2024-02-28', today), false)
  assert.equal(isTodayDate('2024-03-01', today), false)
})

test('reordering moves one item and leaves source unchanged', () => {
  const habits = ['read', 'walk', 'write']
  assert.deepEqual(moveItem(habits, 0, 2), ['walk', 'write', 'read'])
  assert.deepEqual(habits, ['read', 'walk', 'write'])
  assert.deepEqual(moveItem(habits, -1, 2), habits)
})

test('completion percentages use only eligible habit-days and handle empty data', () => {
  const habits = [{ id: 'a', created_at: '2026-10-01T00:00:00' }, { id: 'b', created_at: '2026-10-01T00:00:00' }]
  const completions = [
    { habit_id: 'a', completion_date: '2026-10-01' },
    { habit_id: 'a', completion_date: '2026-10-20' },
    { habit_id: 'b', completion_date: '2026-10-22' },
  ]
  const stats = getCompletionStats(habits, completions, 2026, 9, new Date(2026, 9, 20, 12))
  assert.equal(stats.completedHabitDays, 2)
  assert.equal(stats.eligibleHabitDays, 40)
  assert.equal(stats.overallPercent, 5)
  assert.equal(stats.perHabit.a, 10)
  assert.equal(getCompletionStats([], [], 2026, 9, new Date(2026, 9, 20)).overallPercent, null)
  assert.equal(dailyCompletionPercent([], [], '2026-10-01'), null)
  assert.equal(dailyCompletionPercent(habits, completions, '2026-10-01'), 50)
})

test('monthly completed habit-days begin on each habit local creation date and count unique pairs', () => {
  const today = new Date(2026, 9, 15, 12)
  const habits = [
    { id: 'today', created_at: new Date(2026, 9, 15, 9).toISOString() },
    { id: 'yesterday', created_at: new Date(2026, 9, 14, 23, 59).toISOString() },
    { id: 'last-month', created_at: new Date(2026, 8, 30, 12).toISOString() },
    { id: 'future', created_at: new Date(2026, 9, 16, 8).toISOString() },
  ]
  const completions = [
    { habit_id: 'today', completion_date: '2026-10-14' },
    { habit_id: 'today', completion_date: '2026-10-15' },
    { habit_id: 'today', completion_date: '2026-10-15' },
    { habit_id: 'yesterday', completion_date: '2026-10-14' },
    { habit_id: 'yesterday', completion_date: '2026-10-15' },
    { habit_id: 'last-month', completion_date: '2026-09-30' },
    { habit_id: 'last-month', completion_date: '2026-10-15' },
    { habit_id: 'future', completion_date: '2026-10-16' },
  ]
  const stats = getCompletionStats(habits, completions, 2026, 9, today)
  assert.equal(stats.completedHabitDays, 4)
  assert.equal(stats.eligibleHabitDays, 18)
  assert.equal(stats.perHabit.today, 100)
  assert.equal(stats.perHabit.yesterday, 100)
  assert.equal(stats.perHabit['last-month'], 7)
  assert.equal(stats.perHabit.future, null)
  assert.equal(dailyCompletionPercent(habits, completions, '2026-10-14'), 50)
})

test('creation-date stats handle leap day and year boundaries', () => {
  const leapHabit = { id: 'leap', created_at: '2024-02-29T00:00:00' }
  const leapStats = getCompletionStats([leapHabit], [
    { habit_id: 'leap', completion_date: '2024-02-28' },
    { habit_id: 'leap', completion_date: '2024-02-29' },
  ], 2024, 1, new Date(2024, 2, 1, 12))
  assert.equal(leapStats.eligibleHabitDays, 1)
  assert.equal(leapStats.completedHabitDays, 1)

  const yearStats = getCompletionStats([{ id: 'new-year', created_at: '2025-01-01T00:01:00' }], [
    { habit_id: 'new-year', completion_date: '2024-12-31' },
    { habit_id: 'new-year', completion_date: '2025-01-01' },
  ], 2025, 0, new Date(2025, 0, 1, 12))
  assert.equal(yearStats.eligibleHabitDays, 1)
  assert.equal(yearStats.completedHabitDays, 1)
})

test('completion merge is idempotent by habit and date', () => {
  const first = { id: '1', habit_id: 'a', completion_date: '2026-10-01' }
  const duplicate = { id: '2', habit_id: 'a', completion_date: '2026-10-01' }
  const otherDay = { id: '3', habit_id: 'a', completion_date: '2026-10-02' }
  assert.equal(completionKey('a', '2026-10-01'), 'a:2026-10-01')
  assert.deepEqual(mergeCompletions([first], [duplicate, otherDay]).map(row => row.completion_date), ['2026-10-01', '2026-10-02'])
})
