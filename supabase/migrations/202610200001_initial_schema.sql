-- Habit Trick: per-account habits and date-specific completions.
create extension if not exists pgcrypto;

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists habits_owner_order_idx on public.habits(user_id, sort_order, created_at);
create unique index if not exists habits_id_owner_unique on public.habits(id, user_id);

create table if not exists public.habit_completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid not null,
  completion_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint completion_habit_owner_fk foreign key (habit_id, user_id)
    references public.habits(id, user_id) on delete cascade,
  constraint habit_completions_unique_date unique (habit_id, completion_date)
);

create index if not exists completions_owner_date_idx on public.habit_completions(user_id, completion_date);

alter table public.habits enable row level security;
alter table public.habit_completions enable row level security;

drop policy if exists "Owners manage own habits" on public.habits;
create policy "Owners manage own habits" on public.habits
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Owners manage own completions" on public.habit_completions;
create policy "Owners manage own completions" on public.habit_completions
  for all to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (
    select 1 from public.habits h where h.id = habit_id and h.user_id = auth.uid()
  ));

-- Realtime publication (safe to run repeatedly).
do $$ begin
  alter publication supabase_realtime add table public.habits;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.habit_completions;
exception when duplicate_object then null;
when undefined_object then null;
end $$;

grant select, insert, update, delete on public.habits, public.habit_completions to authenticated;
