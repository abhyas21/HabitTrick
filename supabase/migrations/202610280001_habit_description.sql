-- Add an optional work description without changing existing habit or completion rows.
alter table public.habits
  add column if not exists description text;
