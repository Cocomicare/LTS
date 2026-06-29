-- ══════════════════════════════════════════════════
--  medication_history — add UPDATE capability
--  The original migration only allowed insert/select/delete.
--  Run this once in the Supabase SQL Editor (safe to run even if
--  you're not sure whether you already have this policy — it will
--  just error harmlessly on a duplicate name, nothing breaks).
-- ══════════════════════════════════════════════════

create policy "Users can update their own medication history"
  on medication_history for update
  using (auth.uid() = user_id);

grant update on medication_history to authenticated;
