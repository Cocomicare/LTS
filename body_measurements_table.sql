-- ══════════════════════════════════════════════════
--  body_measurements
--  Circumference tracking for rehab/strength progress —
--  thighs, glutes, calves, biceps, forearms (left/right tracked
--  separately to catch asymmetric recovery), and waist (tracked
--  for context, since corticosteroids redistribute fat centrally
--  even while limb muscle may still be rebuilding — needed to
--  tell "gaining muscle" apart from "gaining centrally from the
--  medication").
--
--  taken_at is a plain DATE (not timestamptz) — time of day has no
--  meaning for this data, so there's no Eastern-timezone conversion
--  needed anywhere in this module.
--
--  Run this once in the Supabase SQL Editor.
-- ══════════════════════════════════════════════════

create table if not exists body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  site text not null,                  -- e.g. 'thigh_left', 'waist', 'glutes'
  value numeric not null,
  unit text not null default 'cm',
  taken_at date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table body_measurements enable row level security;

create policy "Users can view their own body measurements"
  on body_measurements for select
  using (auth.uid() = user_id);

create policy "Users can insert their own body measurements"
  on body_measurements for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own body measurements"
  on body_measurements for update
  using (auth.uid() = user_id);

create policy "Users can delete their own body measurements"
  on body_measurements for delete
  using (auth.uid() = user_id);

-- Required — without these GRANTs, queries silently fail with 403s
-- even though RLS policies look correct.
grant usage on schema public to authenticated;
grant select, insert, update, delete on body_measurements to authenticated;

-- Enable realtime, consistent with every other table in the app.
alter publication supabase_realtime add table body_measurements;
