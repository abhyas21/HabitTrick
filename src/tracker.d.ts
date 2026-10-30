export function monthDayCount(year: number, monthIndex: number): number
export function toDateKey(year: number, monthIndex: number, day: number): string
export function localDateKeyFromTimestamp(timestamp: string | null | undefined): string | null
export function eligibleDaysInMonth(year: number, monthIndex: number, today?: Date): number
export function isTrackableDate(year: number, monthIndex: number, day: number, today?: Date): boolean
export function isTodayDate(date: string, today?: Date): boolean
export function moveItem<T>(items: T[], from: number, to: number): T[]
export function completionKey(habitId: string, date: string): string
export function mergeCompletions<T extends { habit_id: string; completion_date: string }>(current: T[], incoming: T[]): T[]
export function getCompletionStats(habits: { id: string; created_at?: string | null }[], completions: { habit_id: string; completion_date: string }[], year: number, monthIndex: number, today?: Date): { completedHabitDays: number; eligibleHabitDays: number; overallPercent: number | null; perHabit: Record<string, number | null> }
export function dailyCompletionPercent(habits: { id: string; created_at?: string | null }[], completions: { habit_id: string; completion_date: string }[], date: string): number | null
