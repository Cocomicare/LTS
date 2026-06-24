-- ══════════════════════════════════════════════════
--  medications
--  Ongoing medication list — dosage, frequency, side effects,
--  refill date, and a per-medication configurable reminder
--  lead-time. Distinct from immuno_doses (which logs each actual
--  dose taken) — this table is the standing medication record,
--  not a dose log.
--
--  Run this once in the Supabase SQL Editor.
-- ══════════════════════════════════════════════════

create table if not exists medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  dosage text,
  frequency text,
  purpose text,
  side_effects text,
  other_notes text,
  refill_date date,
  reminder_days_before integer not null default 7,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table medications enable row level security;

create policy "Users can view their own medications"
  on medications for select
  using (auth.uid() = user_id);

create policy "Users can insert their own medications"
  on medications for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own medications"
  on medications for update
  using (auth.uid() = user_id);

create policy "Users can delete their own medications"
  on medications for delete
  using (auth.uid() = user_id);

-- Required — without these GRANTs, queries silently fail with 403s
-- even though RLS policies look correct.
grant usage on schema public to authenticated;
grant select, insert, update, delete on medications to authenticated;

-- Enable realtime, consistent with every other table in the app.
alter publication supabase_realtime add table medications;
