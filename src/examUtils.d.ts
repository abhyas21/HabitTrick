export function localDateKey(date?: Date): string
export function shiftDateKey(dateKey: string, days: number): string
export function makeDateStrip(centerDate: string, before?: number, after?: number): string[]
export function daysUntil(examDate: string, today?: string): number
export function sortExamsByDateAndTime<T extends { exam_date: string; start_time: string | null }>(exams: T[]): T[]
export function upcomingExamGapLabel(exams: { exam_date: string }[], index: number, today?: string): string
export function hasActivityIdentity(value: { title?: string; subjectName?: string; subjectId?: string; examId?: string; topicId?: string }): boolean
export function formatTime12(time: string | null): string
export function endTime(startTime: string | null, durationMinutes: number | null): { time: string; nextDay: boolean } | null
export function intervalsOverlap(first: { start_time: string | null; duration_minutes: number | null }, second: { start_time: string | null; duration_minutes: number | null }): boolean
export function activitiesOverlap(first: { id?: string | null; activity_date: string; start_time: string | null; duration_minutes: number | null }, second: { id?: string | null; activity_date: string; start_time: string | null; duration_minutes: number | null }): boolean
export function progressPercent(topics: { id: string; status: string }[]): number | null
export function sortActivities<T extends { start_time: string | null; sort_order: number; created_at: string }>(activities: T[]): T[]
