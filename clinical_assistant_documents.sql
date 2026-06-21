-- ══════════════════════════════════════════════════
--  clinical_assistant_documents
--  Stores non-lab reference material uploaded directly to the
--  Clinical Assistant (PFT graphs, imaging reports, clinic notes,
--  etc). Structurally separate from lab_results on purpose — see
--  conversation notes: this prevents any possibility of an
--  assistant-uploaded document being mistaken for a logged lab
--  value by the Early Warning Signal engine.
--
--  Run this once in the Supabase SQL Editor (this one really is
--  SQL, unlike the Edge Function secret from earlier).
-- ══════════════════════════════════════════════════

create table if not exists clinical_assistant_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  extracted_summary text,
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table clinical_assistant_documents enable row level security;

create policy "Users can view their own documents"
  on clinical_assistant_documents for select
  using (auth.uid() = user_id);

create policy "Users can insert their own documents"
  on clinical_assistant_documents for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own documents"
  on clinical_assistant_documents for update
  using (auth.uid() = user_id);

create policy "Users can delete their own documents"
  on clinical_assistant_documents for delete
  using (auth.uid() = user_id);

-- Required — without these GRANTs, queries silently fail with 403s
-- even though RLS policies look correct.
grant usage on schema public to authenticated;
grant select, insert, update, delete on clinical_assistant_documents to authenticated;

-- Enable realtime on this table too, consistent with every other
-- table in the app (optional, but matches existing pattern).
alter publication supabase_realtime add table clinical_assistant_documents;
