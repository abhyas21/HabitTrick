-- Add user-owned sectors without deleting, moving, or rewriting existing habits.
-- Existing habits remain unassigned (sector_id IS NULL) until the user moves them.
create table if not exists public.sectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  color text not null default '#137b68' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sectors_owner_order_idx on public.sectors(user_id, sort_order, created_at);
create unique index if not exists sectors_owner_name_unique on public.sectors(user_id, lower(trim(name)));

alter table public.habits add column if not exists sector_id uuid;
do $$ begin
  alter table public.habits add constraint habits_sector_id_fkey
    foreign key (sector_id) references public.sectors(id) on delete set null;
exception when duplicate_object then null;
end $$;
create index if not exists habits_sector_order_idx on public.habits(user_id, sector_id, sort_order);
create unique index if not exists habits_id_owner_unique on public.habits(id, user_id);

-- Keep duplicate completion rows from being written even if the earlier index was absent.
create unique index if not exists habit_completions_unique_date
  on public.habit_completions(habit_id, completion_date);
do $$ begin
  alter table public.habit_completions add constraint completion_habit_owner_fk
    foreign key (habit_id, user_id) references public.habits(id, user_id) on delete cascade;
exception when duplicate_object then null;
end $$;

alter table public.sectors enable row level security;
alter table public.habits enable row level security;
alter table public.habit_completions enable row level security;

-- Remove other permissive policies on these app tables before applying the owner-only policies.
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'sectors' loop
    execute format('drop policy if exists %I on public.sectors', p.policyname);
  end loop;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'habits' loop
    execute format('drop policy if exists %I on public.habits', p.policyname);
  end loop;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'habit_completions' loop
    execute format('drop policy if exists %I on public.habit_completions', p.policyname);
  end loop;
end $$;

create policy "Owners manage own sectors" on public.sectors
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Check both row owner and assigned sector owner on every insert/update.
create policy "Owners manage own habits" on public.habits
  for all to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (sector_id is null or exists (
      select 1 from public.sectors s where s.id = sector_id and s.user_id = auth.uid()
    ))
  );

create policy "Owners manage own completions" on public.habit_completions
  for all to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.habits h where h.id = habit_id and h.user_id = auth.uid())
  );

grant select, insert, update, delete on public.sectors to authenticated;
grant select, insert, update, delete on public.habits, public.habit_completions to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.sectors;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
