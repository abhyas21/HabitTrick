-- Habit Trick exam planner. Adds user-owned study planning tables only.
create table if not exists public.semesters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index if not exists semesters_user_name_unique on public.semesters(user_id, lower(trim(name)));

create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  semester_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 140),
  exam_type text,
  exam_date date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint exams_semester_owner_fk foreign key (semester_id, user_id)
    references public.semesters(id, user_id) on delete set null (semester_id)
);
create index if not exists exams_user_date_idx on public.exams(user_id, exam_date);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  exam_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 120),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint subjects_exam_owner_fk foreign key (exam_id, user_id)
    references public.exams(id, user_id) on delete set null (exam_id)
);
create unique index if not exists subjects_general_name_unique on public.subjects(user_id, lower(trim(name))) where exam_id is null;
create unique index if not exists subjects_exam_name_unique on public.subjects(user_id, exam_id, lower(trim(name))) where exam_id is not null;

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 140),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id, subject_id),
  constraint units_subject_owner_fk foreign key (subject_id, user_id)
    references public.subjects(id, user_id) on delete cascade
);
create unique index if not exists units_subject_name_unique on public.units(user_id, subject_id, lower(trim(name)));

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null,
  unit_id uuid,
  name text not null check (char_length(trim(name)) between 1 and 160),
  status text not null default 'not_started' check (status in ('not_started','learning','completed','needs_revision')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id, subject_id),
  constraint topics_subject_owner_fk foreign key (subject_id, user_id)
    references public.subjects(id, user_id) on delete cascade,
  constraint topics_unit_owner_fk foreign key (unit_id, user_id, subject_id)
    references public.units(id, user_id, subject_id) on delete set null (unit_id)
);
create unique index if not exists topics_subject_name_unique on public.topics(user_id, subject_id, lower(trim(name)));
create index if not exists topics_user_subject_order_idx on public.topics(user_id, subject_id, sort_order);

create table if not exists public.daily_study_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  title text not null check (char_length(trim(title)) between 1 and 200),
  subject_name text,
  subject_id uuid,
  exam_id uuid,
  topic_id uuid,
  start_time time,
  duration_minutes integer check (duration_minutes between 1 and 1440),
  is_completed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activities_schedule_shape check (
    (start_time is null and duration_minutes is null) or (start_time is not null and duration_minutes is not null)
  ),
  constraint activities_topic_subject_required check (topic_id is null or subject_id is not null),
  constraint activities_subject_owner_fk foreign key (subject_id, user_id)
    references public.subjects(id, user_id) on delete set null (subject_id),
  constraint activities_exam_owner_fk foreign key (exam_id, user_id)
    references public.exams(id, user_id) on delete set null (exam_id),
  constraint activities_topic_owner_fk foreign key (topic_id, user_id, subject_id)
    references public.topics(id, user_id, subject_id) on delete set null (topic_id)
);
create index if not exists activities_user_date_order_idx on public.daily_study_activities(user_id, activity_date, sort_order, start_time);

alter table public.semesters enable row level security;
alter table public.exams enable row level security;
alter table public.subjects enable row level security;
alter table public.units enable row level security;
alter table public.topics enable row level security;
alter table public.daily_study_activities enable row level security;

drop policy if exists "Owners manage own semesters" on public.semesters;
create policy "Owners manage own semesters" on public.semesters for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Owners manage own exams" on public.exams;
create policy "Owners manage own exams" on public.exams for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Owners manage own subjects" on public.subjects;
create policy "Owners manage own subjects" on public.subjects for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Owners manage own units" on public.units;
create policy "Owners manage own units" on public.units for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Owners manage own topics" on public.topics;
create policy "Owners manage own topics" on public.topics for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Owners manage own study activities" on public.daily_study_activities;
create policy "Owners manage own study activities" on public.daily_study_activities for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.semesters, public.exams, public.subjects, public.units, public.topics, public.daily_study_activities to authenticated;

do $$ begin alter publication supabase_realtime add table public.semesters; exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.exams; exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.subjects; exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.units; exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.topics; exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.daily_study_activities; exception when duplicate_object then null; when undefined_object then null; end $$;
