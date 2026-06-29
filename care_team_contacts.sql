-- ══════════════════════════════════════════════════
--  NEW TABLE: care_team_contacts
--  Supports the new "Contacts" tile inside the Reference Guide.
--  Same ownership pattern as every other table: auth.uid() = user_id.
--
--  Run this in the Supabase SQL Editor. Per project convention, SQL
--  files in the repo are NOT auto-executed — this must be run by hand.
-- ══════════════════════════════════════════════════

create table public.care_team_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  role text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.care_team_contacts enable row level security;

create policy "Users can view their own care team contacts"
  on public.care_team_contacts for select
  using (auth.uid() = user_id);

create policy "Users can insert their own care team contacts"
  on public.care_team_contacts for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own care team contacts"
  on public.care_team_contacts for update
  using (auth.uid() = user_id);

create policy "Users can delete their own care team contacts"
  on public.care_team_contacts for delete
  using (auth.uid() = user_id);

-- Required so the anon/authenticated role can actually reach the table
-- at all — per project learning, RLS policies alone are not enough
-- without these GRANTs, or queries silently return 403.
grant select, insert, update, delete on public.care_team_contacts to authenticated;
