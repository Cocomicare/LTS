# Database Schema & RLS Policies

Snapshot taken **June 29, 2026** directly from the live Supabase project
(`osasglxowihoygidhgwc`) via the SQL Editor. This file is documentation
only — running it does nothing. It exists so the schema and security
rules are visible in version control instead of living only inside
Supabase's dashboard.

**Keeping this in sync:** there's no automated pipeline for this. Any
time a table or policy changes in Supabase, re-run the three queries at
the bottom of this file and update this doc by hand.

---

## Tables

### `body_measurements`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | |
| site | text | NO | |
| value | numeric | NO | |
| unit | text | NO | `'cm'::text` |
| taken_at | date | NO | `CURRENT_DATE` |
| notes | text | YES | |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

> Plain `DATE` type (no timezone conversion needed) — by design.

### `health_index_history`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | |
| score | numeric | NO | |
| components | jsonb | YES | |
| computed_at | timestamptz | NO | `now()` |
| created_at | timestamptz | YES | `now()` |
| updated_at | timestamptz | YES | `now()` |

### `health_index_settings`
| column | type | nullable | default |
|---|---|---|---|
| user_id | uuid | NO | |
| baseline | numeric | YES | |
| weights | jsonb | YES | |
| thresholds | jsonb | YES | |
| windows | jsonb | YES | |
| updated_at | timestamptz | YES | `now()` |

### `immuno_doses`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | |
| medication_name | text | NO | |
| dose_amount | numeric | YES | |
| dose_unit | text | YES | |
| taken_at | timestamptz | NO | `now()` |
| taken | boolean | YES | `true` |
| notes | text | YES | |
| created_at | timestamptz | YES | `now()` |
| updated_at | timestamptz | YES | `now()` |

### `lab_results`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | |
| lab_type | text | NO | |
| value | numeric | NO | |
| unit | text | YES | |
| taken_at | timestamptz | NO | `now()` |
| notes | text | YES | |
| created_at | timestamptz | YES | `now()` |
| updated_at | timestamptz | YES | `now()` |

### `medication_history`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | |
| medication_id | uuid | NO | |
| dosage | text | YES | |
| frequency | text | YES | |
| changed_at | timestamptz | NO | `now()` |
| note | text | YES | |
| created_at | timestamptz | NO | `now()` |

### `medications`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | |
| name | text | NO | |
| dosage | text | YES | |
| frequency | text | YES | |
| purpose | text | YES | |
| side_effects | text | YES | |
| other_notes | text | YES | |
| refill_date | date | YES | |
| reminder_days_before | integer | NO | `7` |
| active | boolean | NO | `true` |
| created_at | timestamptz | NO | `now()` |
| updated_at | timestamptz | NO | `now()` |

### `peak_flow_sessions`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | |
| pef | numeric | YES | |
| personal_best | numeric | YES | |
| zone | text | YES | |
| taken_at | timestamptz | NO | `now()` |
| created_at | timestamptz | YES | `now()` |
| updated_at | timestamptz | YES | `now()` |
| fev1 | numeric | YES | |

### `profiles`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | |
| full_name | text | YES | |
| created_at | timestamptz | YES | `now()` |
| updated_at | timestamptz | YES | `now()` |

### `spirometer_sessions`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | |
| fev1 | numeric | YES | |
| fvc | numeric | YES | |
| pef | numeric | YES | |
| effort_count | integer | YES | |
| session_data | jsonb | YES | |
| taken_at | timestamptz | NO | `now()` |
| created_at | timestamptz | YES | `now()` |
| updated_at | timestamptz | YES | `now()` |

### `sputum_logs`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | |
| color_score | integer | NO | |
| texture_score | integer | NO | |
| volume_score | integer | NO | |
| notes | text | YES | |
| taken_at | timestamptz | NO | `now()` |
| created_at | timestamptz | YES | `now()` |
| updated_at | timestamptz | YES | `now()` |

### `symptom_checkins`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | |
| symptoms | jsonb | NO | |
| severity_score | numeric | YES | |
| notes | text | YES | |
| taken_at | timestamptz | NO | `now()` |
| created_at | timestamptz | YES | `now()` |
| updated_at | timestamptz | YES | `now()` |

### `vitals_readings`
| column | type | nullable | default |
|---|---|---|---|
| id | uuid | NO | `gen_random_uuid()` |
| user_id | uuid | NO | |
| vital_type | text | NO | |
| value | numeric | NO | |
| unit | text | YES | |
| taken_at | timestamptz | NO | `now()` |
| notes | text | YES | |
| created_at | timestamptz | YES | `now()` |
| updated_at | timestamptz | YES | `now()` |

---

## RLS status

All 13 public tables have RLS **enabled**:

`body_measurements`, `health_index_history`, `health_index_settings`,
`immuno_doses`, `lab_results`, `medication_history`, `medications`,
`peak_flow_sessions`, `profiles`, `spirometer_sessions`, `sputum_logs`,
`symptom_checkins`, `vitals_readings`

## RLS policies

Every table follows the same pattern: a user can only read/write rows
where `auth.uid() = user_id` (or `= id` for `profiles`). Two policy
styles are used interchangeably — a single `ALL`-command policy, or four
separate SELECT/INSERT/UPDATE/DELETE policies. Functionally equivalent.

| table | policy | cmd | rule |
|---|---|---|---|
| body_measurements | Users can view their own body measurements | SELECT | `auth.uid() = user_id` |
| body_measurements | Users can insert their own body measurements | INSERT | `auth.uid() = user_id` (check) |
| body_measurements | Users can update their own body measurements | UPDATE | `auth.uid() = user_id` |
| body_measurements | Users can delete their own body measurements | DELETE | `auth.uid() = user_id` |
| health_index_history | Users can manage own health index history | ALL | `auth.uid() = user_id` |
| health_index_settings | Users can manage own health index settings | ALL | `auth.uid() = user_id` |
| immuno_doses | Users can manage own immuno doses | ALL | `auth.uid() = user_id` |
| lab_results | Users can manage own lab results | ALL | `auth.uid() = user_id` |
| medication_history | Users can view their own medication history | SELECT | `auth.uid() = user_id` |
| medication_history | Users can insert their own medication history | INSERT | `auth.uid() = user_id` (check) |
| medication_history | Users can update their own medication history | UPDATE | `auth.uid() = user_id` |
| medication_history | Users can delete their own medication history | DELETE | `auth.uid() = user_id` |
| medications | Users can view their own medications | SELECT | `auth.uid() = user_id` |
| medications | Users can insert their own medications | INSERT | `auth.uid() = user_id` (check) |
| medications | Users can update their own medications | UPDATE | `auth.uid() = user_id` |
| medications | Users can delete their own medications | DELETE | `auth.uid() = user_id` |
| peak_flow_sessions | Users can manage own peak flow sessions | ALL | `auth.uid() = user_id` |
| profiles | Users can view own profile | SELECT | `auth.uid() = id` |
| profiles | Users can insert own profile | INSERT | `auth.uid() = id` (check) |
| profiles | Users can update own profile | UPDATE | `auth.uid() = id` |
| spirometer_sessions | Users can manage own spirometer sessions | ALL | `auth.uid() = user_id` |
| sputum_logs | Users can manage own sputum logs | ALL | `auth.uid() = user_id` |
| symptom_checkins | Users can manage own symptom checkins | ALL | `auth.uid() = user_id` |
| vitals_readings | Users can manage own vitals | ALL | `auth.uid() = user_id` |

**Note:** `profiles` has no DELETE policy. This appears intentional —
there's no in-app flow for a user to delete their own profile row — but
flag it if that's ever expected to change.

**Note:** `medication_history`'s UPDATE policy (previously missing,
per earlier project notes) is present in this snapshot — that gap has
already been patched.

---

## Database functions & triggers

**None exist.** Checked via `pg_proc`/`information_schema.triggers` on
June 29, 2026 — zero custom functions, zero triggers in the `public`
schema. All logic lives at the app layer.

In particular, `updated_at` columns are **not** auto-maintained by the
database — they're set manually by the shared `updateRow()` helper in
`supabase-client.js`, which appends `updated_at: new Date().toISOString()`
to every update call. Since every module routes writes through this one
helper, this is reliable — but if a future module ever calls
`sb.from(...).update(...)` directly instead of through `updateRow()`,
its `updated_at` would silently go stale.

## Re-running this snapshot

```sql
-- Table + column definitions
select table_name, column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

```sql
-- RLS policies
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

```sql
-- Which tables have RLS enabled
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;
```

```sql
-- Custom database functions
select p.proname as function_name, pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as returns, l.lanname as language
from pg_proc p
join pg_namespace n on p.pronamespace = n.oid
join pg_language l on p.prolang = l.oid
where n.nspname = 'public'
order by p.proname;
```

```sql
-- Triggers on your tables
select event_object_table as table_name, trigger_name, action_timing,
  event_manipulation as fires_on, action_statement
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;
```
