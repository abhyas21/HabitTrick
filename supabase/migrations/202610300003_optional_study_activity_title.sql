-- Allow a scheduled activity to be identified by an existing subject, exam, or
-- topic link instead of a typed title. Existing titled activities are untouched.
alter table public.daily_study_activities
  alter column title drop not null;

do $$
declare
  title_constraint text;
begin
  select conname into title_constraint
  from pg_constraint
  where conrelid = 'public.daily_study_activities'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%title%'
    and (pg_get_constraintdef(oid) ilike '%char_length%' or pg_get_constraintdef(oid) ilike '%length%');

  if title_constraint is not null then
    execute format('alter table public.daily_study_activities drop constraint %I', title_constraint);
  end if;
end $$;

do $$ begin
  alter table public.daily_study_activities
    add constraint activities_title_or_link_check check (
      nullif(trim(coalesce(title, '')), '') is not null
      or nullif(trim(coalesce(subject_name, '')), '') is not null
      or subject_id is not null
      or exam_id is not null
      or topic_id is not null
    );
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
