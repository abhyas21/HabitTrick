export function monthDayCount(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate()
}

export function toDateKey(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function localDateKeyFromTimestamp(timestamp) {
  if (typeof timestamp !== 'string' || !timestamp) return null
  // A date-only value is already a calendar date. Timestamps are instants and
  // must be converted to the viewer's local date rather than sliced as UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) return timestamp
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return null
  return toDateKey(date.getFullYear(), date.getMonth(), date.getDate())
}

function dateKeyOrdinal(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / 86400000
}

function eligibleDatesForHabit(habit, monthStart, monthEnd, eligibleEnd) {
  if (eligibleEnd < monthStart) return 0
  const created = localDateKeyFromTimestamp(habit.created_at) ?? '0000-01-01'
  const start = created > monthStart ? created : monthStart
  const end = eligibleEnd < monthEnd ? eligibleEnd : monthEnd
  return start <= end ? dateKeyOrdinal(end) - dateKeyOrdinal(start) + 1 : 0
}

export function eligibleDaysInMonth(year, monthIndex, today = new Date()) {
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const selectedMonthStart = new Date(year, monthIndex, 1)
  if (selectedMonthStart > currentMonthStart) return 0
  if (selectedMonthStart.getTime() === currentMonthStart.getTime()) return today.getDate()
  return monthDayCount(year, monthIndex)
}

export function isTrackableDate(year, monthIndex, day, today = new Date()) {
  if (!Number.isInteger(day) || day < 1 || day > monthDayCount(year, monthIndex)) return false
  return toDateKey(year, monthIndex, day) <= toDateKey(today.getFullYear(), today.getMonth(), today.getDate())
}

export function isTodayDate(date, today = new Date()) {
  return date === toDateKey(today.getFullYear(), today.getMonth(), today.getDate())
}

export function moveItem(items, from, to) {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length) return [...items]
  const result = [...items]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}

export function completionKey(habitId, date) {
  return `${habitId}:${date}`
}

export function mergeCompletions(current, incoming) {
  const merged = new Map()
  for (const completion of [...current, ...incoming]) merged.set(completionKey(completion.habit_id, completion.completion_date), completion)
  return [...merged.values()]
}

export function getCompletionStats(habits, completions, year, monthIndex, today = new Date()) {
  const monthStart = toDateKey(year, monthIndex, 1)
  const monthEnd = toDateKey(year, monthIndex, monthDayCount(year, monthIndex))
  const todayKey = toDateKey(today.getFullYear(), today.getMonth(), today.getDate())
  const eligibleEnd = todayKey < monthEnd ? todayKey : monthEnd
  const createdDates = new Map(habits.map(habit => [habit.id, localDateKeyFromTimestamp(habit.created_at) ?? '0000-01-01']))
  const activeDays = new Map(habits.map(habit => [habit.id, eligibleDatesForHabit(habit, monthStart, monthEnd, eligibleEnd)]))
  const eligibleHabitDays = [...activeDays.values()].reduce((sum, days) => sum + days, 0)
  const uniquePairs = new Set()
  for (const row of completions) {
    const days = activeDays.get(row.habit_id)
    if (!days || row.completion_date < monthStart || row.completion_date > eligibleEnd) continue
    const created = createdDates.get(row.habit_id) ?? '0000-01-01'
    if (row.completion_date >= created) uniquePairs.add(completionKey(row.habit_id, row.completion_date))
  }
  const doneByHabit = new Map(habits.map(habit => [habit.id, new Set()]))
  for (const pair of uniquePairs) {
    const separator = pair.indexOf(':')
    doneByHabit.get(pair.slice(0, separator))?.add(pair.slice(separator + 1))
  }
  const perHabit = Object.fromEntries(habits.map(habit => {
    const days = activeDays.get(habit.id) ?? 0
    return [habit.id, days ? Math.round((doneByHabit.get(habit.id)?.size ?? 0) / days * 100) : null]
  }))
  return {
    completedHabitDays: uniquePairs.size,
    eligibleHabitDays,
    overallPercent: eligibleHabitDays ? Math.round(uniquePairs.size / eligibleHabitDays * 100) : null,
    perHabit,
  }
}

export function dailyCompletionPercent(habits, completions, date) {
  const active = habits.filter(habit => (localDateKeyFromTimestamp(habit.created_at) ?? '0000-01-01') <= date)
  if (!active.length) return null
  const activeIds = new Set(active.map(habit => habit.id))
  const done = new Set(completions.filter(row => row.completion_date === date && activeIds.has(row.habit_id)).map(row => row.habit_id))
  return Math.round(done.size / active.length * 100)
}
