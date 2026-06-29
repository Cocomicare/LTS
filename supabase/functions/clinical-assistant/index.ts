// ══════════════════════════════════════════════════
//  EDGE FUNCTION: clinical-assistant
//  Powers the in-app Clinical Assistant chat. Gathers recent
//  readings across every tracking table for the logged-in user,
//  assembles them into context, and forwards the user's question
//  to Anthropic. The Anthropic key lives only in this function's
//  secret store — same security model as extract-labs.
//
//  This function is purely a READ path against existing tables —
//  it never writes to vitals_readings, lab_results, symptom_checkins,
//  peak_flow_sessions, spirometer_sessions, sputum_logs, immuno_doses,
//  or health_index_history. Disabling the Clinical Assistant module
//  (CLINICAL_ASSISTANT_ENABLED = false in index.html) has zero effect
//  on any of those tables or on Early Warning Signal scoring, because
//  nothing here ever depended on this function running.
//
//  Deploy:
//    supabase functions deploy clinical-assistant
//
//  Uses the SAME ANTHROPIC_API_KEY secret already set for extract-labs —
//  no new secret needed.
// ══════════════════════════════════════════════════

import { createClient } from 'jsr:@supabase/supabase-js@2';

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// How many of the most recent rows to pull per table. Not a date window —
// per the agreed design, recency is judged per-parameter by the model
// using the dates attached to each row, not by a fixed cutoff here.
const ROWS_PER_TABLE = 15;

// These specific numeric thresholds come from the UF Health Shands
// post-transplant patient guide. They live ONLY here, as conversational
// context for the assistant — they are never used in Early Warning
// Signal scoring (score_engine.js has no fixed clinical cutoffs at all;
// it is 100% personal-baseline-driven by design).
const UF_REFERENCE_THRESHOLDS = `
UF Health Shands transplant program's stated call-your-coordinator thresholds (for conversational context only — NOT used in any scoring):
- Temperature: 100.0°F or above (call immediately, including nights/weekends/holidays)
- Blood pressure: systolic >160 or <90; diastolic >100 or <40 (recheck after 15-30 min before calling)
- Heart rate: above 125 bpm at rest
- FEV1: trending down 3 days in a row
- Sputum: change in color or increase in amount
- Vomiting/diarrhea: more than 3 watery stools/day
`.trim();

const SYSTEM_PROMPT = `You are the Clinical Assistant inside LTS Care, a personal post-lung-transplant monitoring app. You help the user understand their own tracked health data — labs, vitals, symptoms, peak flow/spirometer readings, sputum logs, immunosuppression dosing, and their computed Early Warning Signal score history — in combination with general medical knowledge about lung transplant care.

${UF_REFERENCE_THRESHOLDS}

Tone and boundaries:
- Be informative and contextual, not directive. Explain what values and trends generally mean and how they relate to what the user is tracking.
- Never diagnose. Never tell the user to change a medication or dose.
- When something in the data looks genuinely concerning (e.g. crosses one of the UF thresholds above, or shows a meaningful multi-parameter trend), say so clearly, but frame it as "this is worth discussing with your transplant team" rather than issuing an instruction or a verdict.
- When asked about a specific value (e.g. "what's my tacrolimus level"), use the most recent value present in the provided data for that parameter, regardless of how old it is — note its date so the user knows how current it is.
- When asked about a trend, look across the multiple recent readings provided for that parameter, not just the single latest one.
- If data for something the user asks about simply isn't present in the provided context, say so plainly rather than guessing or inventing a number.
- Do not assume the user is a medical professional; explain things in plain, clear language.
- Remind the user, when relevant, that you may not have the full clinical picture their transplant team has, and that this conversation is informational rather than medical advice.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await supabaseClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = userData.user.id;

    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server is missing ANTHROPIC_API_KEY secret' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { question, history } = await req.json();
    if (!question || typeof question !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing question' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── Gather recent rows across every tracking table, READ-ONLY ──
    const [
      vitalsRes, symptomsRes, peakflowRes, spiroRes, sputumRes,
      labsRes, immunoRes, ewsRes, docsRes,
    ] = await Promise.all([
      supabaseClient.from('vitals_readings').select('*').eq('user_id', userId).order('taken_at', { ascending: false }).limit(ROWS_PER_TABLE * 4), // multiple vital_types share this table
      supabaseClient.from('symptom_checkins').select('*').eq('user_id', userId).order('taken_at', { ascending: false }).limit(ROWS_PER_TABLE),
      supabaseClient.from('peak_flow_sessions').select('*').eq('user_id', userId).order('taken_at', { ascending: false }).limit(ROWS_PER_TABLE),
      supabaseClient.from('spirometer_sessions').select('*').eq('user_id', userId).order('taken_at', { ascending: false }).limit(ROWS_PER_TABLE),
      supabaseClient.from('sputum_logs').select('*').eq('user_id', userId).order('taken_at', { ascending: false }).limit(ROWS_PER_TABLE),
      supabaseClient.from('lab_results').select('*').eq('user_id', userId).order('taken_at', { ascending: false }).limit(ROWS_PER_TABLE * 6), // many distinct lab_types share this table
      supabaseClient.from('immuno_doses').select('*').eq('user_id', userId).order('taken_at', { ascending: false }).limit(ROWS_PER_TABLE),
      supabaseClient.from('health_index_history').select('*').eq('user_id', userId).order('computed_at', { ascending: false }).limit(ROWS_PER_TABLE),
      supabaseClient.from('clinical_assistant_documents').select('id, label, taken_at, extracted_summary').eq('user_id', userId).order('taken_at', { ascending: false }).limit(10),
    ]);

    function fmtRows(rows, dateField, valueFields) {
      return (rows || []).map(r => {
        const parts = valueFields.map(f => `${f}=${r[f]}`).join(', ');
        return `[${r[dateField]}] ${parts}`;
      }).join('\n') || '(none recorded)';
    }

    const context = `
=== VITAL SIGNS (most recent ${ROWS_PER_TABLE * 4} readings across all types) ===
${fmtRows(vitalsRes.data, 'taken_at', ['vital_type', 'value'])}

=== SYMPTOM CHECK-INS ===
${fmtRows(symptomsRes.data, 'taken_at', ['severity_score'])}

=== PEAK FLOW / FEV1 ===
${fmtRows(peakflowRes.data, 'taken_at', ['pef', 'fev1'])}

=== SPIROMETER ===
${(spiroRes.data || []).map(r => `[${r.taken_at}] volume_ml=${r.session_data?.volume_ml}`).join('\n') || '(none recorded)'}

=== SPUTUM LOG ===
${fmtRows(sputumRes.data, 'taken_at', ['color_score', 'texture_score', 'volume_score'])}

=== LAB RESULTS (most recent ${ROWS_PER_TABLE * 6} values across all lab types) ===
${fmtRows(labsRes.data, 'taken_at', ['lab_type', 'value', 'unit'])}

=== IMMUNOSUPPRESSION DOSING ===
${fmtRows(immunoRes.data, 'taken_at', ['medication', 'dose'])}

=== EARLY WARNING SIGNAL — COMPUTED SCORE HISTORY ===
${fmtRows(ewsRes.data, 'computed_at', ['score'])}

=== UPLOADED REFERENCE DOCUMENTS (non-lab material the user has shared directly with you, e.g. PFT graphs, imaging reports — these are NOT part of Early Warning Signal scoring) ===
${(docsRes.data || []).map(r => `[${r.taken_at}] "${r.label}": ${r.extracted_summary || '(no summary available)'}`).join('\n') || '(none uploaded)'}
`.trim();

    const messages = [];
    if (Array.isArray(history)) {
      for (const turn of history) {
        if (turn.role && turn.content) messages.push({ role: turn.role, content: turn.content });
      }
    }
    messages.push({
      role: 'user',
      content: `Here is my current tracked data:\n\n${context}\n\nMy question: ${question}`,
    });

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(JSON.stringify({ error: `Anthropic API error ${anthropicRes.status}: ${errText.slice(0, 300)}` }), {
        status: anthropicRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await anthropicRes.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
