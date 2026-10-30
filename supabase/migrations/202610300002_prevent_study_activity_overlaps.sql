-- Reject new or rescheduled overlapping timed activities while preserving any
-- historical rows that may already overlap.
create or replace function public.prevent_daily_study_activity_overlap()
returns trigger
language plpgsql
as $$
begin
  if new.start_time is null or new.duration_minutes is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.activity_date is not distinct from old.activity_date
    and new.start_time is not distinct from old.start_time
    and new.duration_minutes is not distinct from old.duration_minutes then
    return new;
  end if;

  if exists (
    select 1
    from public.daily_study_activities existing
    where existing.user_id = new.user_id
      and existing.activity_date = new.activity_date
      and existing.start_time is not null
      and existing.duration_minutes is not null
      and existing.id <> new.id
      and new.activity_date + new.start_time < existing.activity_date + existing.start_time + make_interval(mins => existing.duration_minutes)
      and new.activity_date + new.start_time + make_interval(mins => new.duration_minutes) > existing.activity_date + existing.start_time
  ) then
    raise exception 'This time overlaps with another scheduled activity. Choose a different time.'
      using errcode = '23P01';
  end if;
  return new;
end;
$$;

drop trigger if exists daily_study_activities_no_overlap on public.daily_study_activities;
create trigger daily_study_activities_no_overlap
  before insert or update of activity_date, start_time, duration_minutes
  on public.daily_study_activities
  for each row execute function public.prevent_daily_study_activity_overlap();
