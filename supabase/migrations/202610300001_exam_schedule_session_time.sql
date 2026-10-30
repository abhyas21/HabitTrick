-- Adds actual exam session and start-time fields without changing existing exam rows.
alter table public.exams
  add column if not exists session text,
  add column if not exists start_time time;

do $$ begin
  alter table public.exams add constraint exams_session_check
    check (session is null or session in ('FN', 'AN'));
exception when duplicate_object then null;
end $$;

create index if not exists exams_user_month_schedule_idx
  on public.exams(user_id, exam_date, start_time);

-- Supabase's REST API reads a schema cache. Reload it after adding the columns
-- so clients can send the session/start_time fields immediately after migration.
notify pgrst, 'reload schema';
