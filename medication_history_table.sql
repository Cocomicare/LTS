-- ══════════════════════════════════════════════════
--  medication_history
--  Every time a medication's dosage or frequency changes, this
--  captures a dated snapshot of the new values — so tapering
--  (e.g. Prednisone stepping down over months) becomes visible
--  as a timeline instead of being silently overwritten.
--
--  A row is also inserted when a medication is first created,
--  representing "Started at X". History only starts accumulating
--  from whenever this table is deployed — there's no backfill of
--  changes made before today.
--
--  Run this once in the Supabase SQL Editor.
-- ══════════════════════════════════════════════════

create table if not exists medication_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  medication_id uuid not null references medications(id) on delete cascade,
  dosage text,
  frequency text,
  changed_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

alter table medication_history enable row level security;

create policy "Users can view their own medication history"
  on medication_history for select
  using (auth.uid() = user_id);

create policy "Users can insert their own medication history"
  on medication_history for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own medication history"
  on medication_history for delete
  using (auth.uid() = user_id);

-- Required — without these GRANTs, queries silently fail with 403s
-- even though RLS policies look correct.
grant usage on schema public to authenticated;
grant select, insert, delete on medication_history to authenticated;

-- Enable realtime, consistent with every other table in the app.
alter publication supabase_realtime add table medication_history;
