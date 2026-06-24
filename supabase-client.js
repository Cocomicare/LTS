// ══════════════════════════════════════════════════
//  SHARED SUPABASE CLIENT — LTS
//  Loaded by index.html (the shell) AND every module.
//  This is the ONLY place the URL/key live. If they
//  ever change, update them here only.
// ══════════════════════════════════════════════════

const SUPABASE_URL = 'https://osasglxowihoygidhgwc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_R0wx-oao3PmUT0aWNIAWng_hCEyh7_f';

// supabase-js must already be loaded on the page via:
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ══════════════════════════════════════════════════
//  AUTH HELPERS
// ══════════════════════════════════════════════════

/**
 * Returns the current logged-in user, or null.
 * Every module should call this on load — if null,
 * the module should NOT render and should show a
 * "please log in" message (modules are only ever
 * opened from within the authenticated shell, but
 * this guards against someone opening the file directly).
 */
async function getCurrentUser() {
  const { data, error } = await sb.auth.getUser();
  if (error) {
    console.warn('getCurrentUser error:', error.message);
    return null;
  }
  return data?.user || null;
}

/**
 * Subscribes to auth state changes (login/logout/token refresh).
 * Pass a callback that receives the session (or null on logout).
 */
function onAuthChange(callback) {
  return sb.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}

// ══════════════════════════════════════════════════
//  REALTIME SYNC HELPER
// ══════════════════════════════════════════════════
//
// Every module uses this same pattern:
//   1. Initial load: SELECT rows for this user from the table.
//   2. Subscribe to realtime changes filtered to this user.
//   3. On INSERT/UPDATE/DELETE from ANY device, update the
//      in-memory state and re-render — no localStorage, ever.
//
// Usage:
//   const channel = subscribeToTable('vitals_readings', userId, (payload) => {
//     // payload.eventType is 'INSERT' | 'UPDATE' | 'DELETE'
//     // payload.new / payload.old contain the row data
//     handleChange(payload);
//   });
//
//   // later, when leaving the module:
//   sb.removeChannel(channel);

function subscribeToTable(tableName, userId, onChange) {
  const channel = sb
    .channel(`${tableName}_${userId}_changes`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: tableName,
        filter: `user_id=eq.${userId}`,
      },
      (payload) => onChange(payload)
    )
    .subscribe();

  return channel;
}

// ══════════════════════════════════════════════════
//  GENERIC CRUD HELPERS
//  (thin wrappers so every module writes the same way)
// ══════════════════════════════════════════════════

async function fetchRows(tableName, userId, orderBy = 'created_at', ascending = false) {
  const { data, error } = await sb
    .from(tableName)
    .select('*')
    .eq('user_id', userId)
    .order(orderBy, { ascending });
  if (error) {
    console.error(`fetchRows(${tableName}) error:`, error.message);
    return [];
  }
  return data || [];
}

async function insertRow(tableName, row) {
  const { data, error } = await sb.from(tableName).insert(row).select().single();
  if (error) {
    console.error(`insertRow(${tableName}) error:`, error.message);
    throw error;
  }
  return data;
}

async function updateRow(tableName, id, updates) {
  const { data, error } = await sb
    .from(tableName)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error(`updateRow(${tableName}) error:`, error.message);
    throw error;
  }
  return data;
}

async function deleteRow(tableName, id) {
  const { error } = await sb.from(tableName).delete().eq('id', id);
  if (error) {
    console.error(`deleteRow(${tableName}) error:`, error.message);
    throw error;
  }
  return true;
}

/**
 * Upsert for single-row-per-user tables (e.g. health_index_settings,
 * which uses user_id as its primary key instead of a generated id).
 */
async function upsertByUser(tableName, userId, fields) {
  const { data, error } = await sb
    .from(tableName)
    .upsert({ user_id: userId, ...fields, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) {
    console.error(`upsertByUser(${tableName}) error:`, error.message);
    throw error;
  }
  return data;
}

// ══════════════════════════════════════════════════
//  EASTERN TIME HELPERS
//  Every module logs and displays times in US Eastern, regardless
//  of what timezone the device's OS/browser happens to be set to.
//  This is deliberate: the app has one household, all in the
//  Eastern timezone, and a per-device-local-clock approach was
//  causing real bugs — most notably, editing a late-evening entry
//  would show the wrong (next) day, because toISOString() always
//  returns UTC date/time components, not local ones.
//
//  If the app is ever used by someone outside Eastern time, this is
//  the one place that would need a user-selectable timezone setting
//  instead of the hardcoded EASTERN_TZ constant below.
// ══════════════════════════════════════════════════
const EASTERN_TZ = 'America/New_York';

// Internal: extract Eastern-local Y/M/D/H/M(/S) parts from a stored
// UTC timestamp (or "now" if none given).
function easternDateParts(iso) {
  const d = iso ? new Date(iso) : new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map = {};
  fmt.formatToParts(d).forEach(p => { map[p.type] = p.value; });
  // Some browsers render hour '24' for midnight; normalize to '00'.
  if (map.hour === '24') map.hour = '00';
  return map;
}

/** Value for an <input type="date">, in Eastern time. No arg = today (Eastern). */
function easternDateInputValue(iso) {
  const p = easternDateParts(iso);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Value for an <input type="time">, in Eastern time. No arg = right now (Eastern). */
function easternTimeInputValue(iso) {
  const p = easternDateParts(iso);
  return `${p.hour}:${p.minute}`;
}

/**
 * Takes a "YYYY-MM-DD" date string and "HH:MM" time string — both
 * understood as Eastern Time, regardless of the device's own
 * timezone — and returns the correct UTC ISO string for storage.
 * Handles EST/EDT (daylight saving) automatically, since it asks
 * the JS environment what Eastern actually means on that date.
 */
function parseEasternDateTime(dateStr, timeStr) {
  const safeTime = (timeStr && timeStr.length >= 4) ? timeStr : '00:00';
  // Step 1: treat the input as if it were already UTC (a deliberately
  // wrong starting guess — we'll correct it in step 3).
  const naiveUTC = new Date(`${dateStr}T${safeTime}:00Z`);
  // Step 2: ask what Eastern's wall clock would show for that UTC instant.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const map = {};
  fmt.formatToParts(naiveUTC).forEach(p => { map[p.type] = p.value; });
  if (map.hour === '24') map.hour = '00';
  const easternAsIfUTC = new Date(`${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}Z`);
  // Step 3: the gap between our naive guess and what Eastern actually
  // showed IS the current UTC/Eastern offset (handles DST automatically).
  const offsetMs = naiveUTC.getTime() - easternAsIfUTC.getTime();
  return new Date(naiveUTC.getTime() + offsetMs).toISOString();
}

/** Display a stored UTC timestamp as an Eastern-time date string. */
function fmtEasternDate(iso, opts) {
  return new Date(iso).toLocaleDateString('en-US', {
    timeZone: EASTERN_TZ,
    ...(opts || { month: 'short', day: 'numeric', year: 'numeric' }),
  });
}

/** Display a stored UTC timestamp as an Eastern-time time string. */
function fmtEasternTime(iso, opts) {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: EASTERN_TZ,
    ...(opts || { hour: 'numeric', minute: '2-digit' }),
  });
}

/** True if the given stored UTC timestamp falls on "today" in Eastern time. */
function isEasternToday(iso) {
  return easternDateInputValue(iso) === easternDateInputValue();
}
