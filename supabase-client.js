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
