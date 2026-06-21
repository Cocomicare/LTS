// ══════════════════════════════════════════════════════════════════
//  SHARED EARLY WARNING SIGNAL SCORING ENGINE
//  Used by health_index.html (the full module) AND index.html (the
//  dashboard's refresh/sync button) so there's exactly one copy of
//  the scoring math to maintain. Loaded after supabase-client.js.
//
//  Medication Impact Signal (toxicity composite) was retired —
//  toxicity labs move slowly enough that routine clinic bloodwork
//  already catches them. This engine now focuses entirely on
//  subclinical infection/rejection detection, including a set of
//  lab-derived parameters (see "LAB-DERIVED PARAMS" below) that
//  layer on top of the original vitals/symptom/peakflow/spiro/sputum
//  parameters.
// ══════════════════════════════════════════════════════════════════

const EWS_PARAMS = [
  // ── Daily/frequent tracking (unchanged from original) ──
  { key:'symptoms', name:'Symptom Check-in', icon:'🧠', unit:'', weight:11, maxAgeDays:2, direction:'higher_better',
    desc:'Subjective wellness score', source:'symptoms' },
  { key:'spo2', name:'SpO₂', icon:'🩸', unit:'%', weight:22, maxAgeDays:2, direction:'higher_better',
    desc:'Oxygen saturation — primary lung function indicator', source:'vitals', vitalType:'spo2' },
  { key:'fev1', name:'FEV1', icon:'📊', unit:'L', weight:22, maxAgeDays:2, direction:'higher_better',
    desc:'Forced expiratory volume — early rejection signal', source:'peakflow', field:'fev1' },
  { key:'spiro', name:'Spirometer', icon:'🌬️', unit:'mL', weight:16, maxAgeDays:2, direction:'higher_better',
    desc:'Inspiratory volume — complements FEV1', source:'spiro' },
  { key:'hr', name:'Heart Rate', icon:'❤️', unit:'bpm', weight:7, maxAgeDays:2, direction:'stable',
    desc:'Tachycardia signals infection/rejection', source:'vitals', vitalType:'hr' },
  { key:'temp', name:'Temperature', icon:'🌡️', unit:'°F', weight:13, maxAgeDays:3, direction:'lower_better',
    desc:'Key infection indicator', source:'vitals', vitalType:'temp' },
  { key:'wt', name:'Weight', icon:'🟠', unit:'lbs', weight:5, maxAgeDays:14, direction:'stable',
    desc:'Fluid retention indicator', source:'vitals', vitalType:'wt' },
  { key:'sputum', name:'Sputum', icon:'🫧', unit:'/10', weight:4, maxAgeDays:3, direction:'higher_better',
    desc:'Composite of color + texture + volume', source:'sputum' },

  // ── LAB-DERIVED PARAMS ──
  // Ranked by biological lead time (earliest/most specific first). Each
  // gets its own maxAgeDays reflecting realistic draw cadence: short
  // windows for markers that are cheap/easy to self-order through
  // Quest/LabCorp, longer windows for markers that only show up on a
  // full UF panel or a specialist-ordered test. All of these are
  // user-adjustable in health_index.html's Settings panel — nothing
  // here is hardcoded once a settings row exists.
  { key:'dd_cfdna', name:'Donor-Derived cfDNA', icon:'🧬', unit:'%', weight:10, maxAgeDays:60, direction:'cfdna_binary',
    desc:'Most direct, earliest rejection-specific signal — specialist/UF-only test (e.g. AlloSure)', source:'labs' },
  { key:'il6', name:'IL-6', icon:'🔥', unit:'pg/mL', weight:6, maxAgeDays:30, direction:'stable',
    desc:'Earliest general inflammatory cytokine — precedes CRP', source:'labs' },
  { key:'crp', name:'CRP', icon:'🌡️', unit:'mg/L', weight:10, maxAgeDays:14, direction:'stable',
    desc:'Best practical general inflammation marker — self-orderable', source:'labs' },
  { key:'procalcitonin', name:'Procalcitonin', icon:'🦠', unit:'ng/mL', weight:4, maxAgeDays:30, direction:'stable',
    desc:'Fast, bacteria-specific — blind to rejection, so weighted lower', source:'labs' },
  { key:'neutrophils_abs', name:'Absolute Neutrophils', icon:'🛡️', unit:'K/µL', weight:8, maxAgeDays:21, direction:'stable',
    desc:'Bacterial infection signal; also flags drug-induced neutropenia', source:'labs' },
  { key:'lymphocytes_abs', name:'Absolute Lymphocytes', icon:'🛡️', unit:'K/µL', weight:6, maxAgeDays:21, direction:'stable',
    desc:'Viral reactivation (e.g. CMV) and some rejection correlation', source:'labs' },
  { key:'esr', name:'ESR', icon:'⏱️', unit:'mm/hr', weight:4, maxAgeDays:21, direction:'stable',
    desc:'Slower, less sensitive cousin of CRP', source:'labs' },
  { key:'albumin', name:'Albumin', icon:'💧', unit:'g/dL', weight:4, maxAgeDays:21, direction:'higher_better',
    desc:'Negative acute-phase reactant — lags real-time inflammation by ~weeks', source:'labs' },
  { key:'wbc', name:'WBC', icon:'🩸', unit:'K/µL', weight:3, maxAgeDays:21, direction:'stable',
    desc:'Broad infection marker — partially redundant with neutrophils/lymphocytes', source:'labs' },
  { key:'igg', name:'IgG', icon:'🛡️', unit:'mg/dL', weight:3, maxAgeDays:60, direction:'higher_better',
    desc:'Standing immune capacity/risk — not a real-time event signal, lowest weight', source:'labs' },
];
const EWS_NONNEGOTIABLES = ['symptoms', 'spo2', 'fev1', 'hr'];

function ewsGetWeights(settingsRow) {
  const saved = (settingsRow && settingsRow.weights) || {};
  const w = {}; EWS_PARAMS.forEach(p => w[p.key] = saved[p.key] ?? p.weight); return w;
}
function ewsGetThresholds(settingsRow) {
  const saved = (settingsRow && settingsRow.thresholds) || {};
  return { red:85, orange:90, amber:95, ...saved };
}
function ewsGetWindows(settingsRow) {
  const saved = (settingsRow && settingsRow.windows) || {};
  const w = {}; EWS_PARAMS.forEach(p => w[p.key] = saved[p.key] ?? p.maxAgeDays); return w;
}
function ewsGetBaselineDays(settingsRow) { return (settingsRow && settingsRow.baseline) || 14; }

function ewsRollingBaseline(recs, days) {
  if (!recs.length) return null;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const windowRecs = recs.filter(r => new Date(r.date) >= cutoff);
  const useRecs = windowRecs.length > 0 ? windowRecs : recs;
  const vals = useRecs.map(r => r.value).filter(v => v != null && !isNaN(v));
  return vals.length ? vals.reduce((a,b)=>a+b,0)/vals.length : null;
}

// Blood pressure: scored against fixed clinical categories (not personal baseline),
// using whichever of systolic/diastolic falls into the more concerning category.
function ewsComputeBPScore(sys, dia) {
  function sysScore(s) {
    if (s >= 160) return 15; if (s >= 140) return 45; if (s >= 130) return 70;
    if (s >= 120) return 90; if (s >= 90)  return 100; if (s >= 80)  return 60;
    return 20;
  }
  function diaScore(d) {
    if (d >= 100) return 15; if (d >= 90)  return 45; if (d >= 80)  return 70;
    if (d >= 60)  return 100; if (d >= 50)  return 60;
    return 20;
  }
  return Math.min(sysScore(sys), diaScore(dia));
}

// Donor-derived cfDNA doesn't have a meaningful "personal baseline drift" —
// unlike a CBC value, there's no healthy version of this trending up and
// down day to day. It's closer to a flag against a fixed clinical cutoff
// than a percentage deviation. The cutoff below is illustrative (modeled
// loosely on common %cfDNA reporting for tests like AlloSure) — confirm
// the actual interpretation thresholds with your transplant team rather
// than treating this as a clinically validated cutoff.
function ewsComputeCfdnaScore(latest) {
  if (latest <= 0.5) return 100;
  if (latest <= 1.0) return 70;
  if (latest <= 2.0) return 35;
  return 10;
}

function ewsComputeParamScore(param, latest, baseline) {
  if (latest === null || latest === undefined) return null;

  if (param.direction === 'cfdna_binary') {
    return ewsComputeCfdnaScore(latest);
  }

  const base = (baseline != null && baseline !== 0) ? baseline : latest;
  if (base === 0) return 75;

  if (param.key === 'spo2') {
    const pctDev = ((base - latest) / base) * 100;
    if (pctDev <= 0) return 100;
    if (pctDev <= 0.5) return 95;
    if (pctDev <= 1.0) return 85;
    if (pctDev <= 2.0) return 65;
    if (pctDev <= 3.0) return 40;
    return Math.max(0, 20 - (pctDev - 3) * 5);
  }
  if (param.direction === 'higher_better') {
    const ratio = latest / base;
    if (ratio >= 0.98) return 100;
    if (ratio >= 0.95) return 85;
    if (ratio >= 0.90) return 65;
    if (ratio >= 0.85) return 40;
    return Math.max(0, Math.round(ratio * 47));
  }
  if (param.direction === 'lower_better') {
    const pctDev = Math.abs((latest - base) / base) * 100;
    if (pctDev <= 0.5) return 100;
    if (pctDev <= 1.0) return 85;
    if (pctDev <= 1.5) return 65;
    if (pctDev <= 2.5) return 40;
    return Math.max(0, 20 - pctDev * 4);
  }
  // 'stable' — deviation in EITHER direction is concerning (e.g. CRP, WBC,
  // neutrophils/lymphocytes, heart rate, weight)
  const pctDev = Math.abs((latest - base) / base) * 100;
  if (pctDev <= 2) return 100;
  if (pctDev <= 5) return 85;
  if (pctDev <= 10) return 65;
  if (pctDev <= 15) return 40;
  return Math.max(0, 20 - (pctDev - 15));
}

// ══════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
//  Fetches all source data fresh, computes the score, saves it to
//  health_index_history (deduping any same-day rows), and returns
//  everything the UI needs to render.
// ══════════════════════════════════════════════════════════════════
async function ewsComputeAndSave(userId) {
  const labTypes = EWS_PARAMS.filter(p => p.source === 'labs').map(p => p.key);

  const [settingsRes, historyRes, symptomRows, vitalsRows, peakflowRows, spiroRows, sputumRows, labRows] = await Promise.all([
    sb.from('health_index_settings').select('*').eq('user_id', userId).maybeSingle(),
    sb.from('health_index_history').select('*').eq('user_id', userId).order('computed_at', { ascending: true }),
    sb.from('symptom_checkins').select('*').eq('user_id', userId).order('taken_at', { ascending: true }),
    sb.from('vitals_readings').select('*').eq('user_id', userId).order('taken_at', { ascending: true }),
    sb.from('peak_flow_sessions').select('*').eq('user_id', userId).order('taken_at', { ascending: true }),
    sb.from('spirometer_sessions').select('*').eq('user_id', userId).order('taken_at', { ascending: true }),
    sb.from('sputum_logs').select('*').eq('user_id', userId).order('taken_at', { ascending: true }),
    sb.from('lab_results').select('*').eq('user_id', userId).in('lab_type', labTypes).order('taken_at', { ascending: true }),
  ]);

  const settingsRow = settingsRes.data || null;
  let historyRows = historyRes.data || [];

  const rawData = {};
  rawData.symptoms = (symptomRows.data || []).map(r => ({ date: r.taken_at, value: r.severity_score }));
  rawData.fev1 = (peakflowRows.data || []).filter(r => r.fev1 != null).map(r => ({ date: r.taken_at, value: Number(r.fev1) }));
  rawData.spiro = (spiroRows.data || []).filter(r => r.session_data && r.session_data.volume_ml != null)
    .map(r => ({ date: r.taken_at, value: Number(r.session_data.volume_ml) }));
  rawData.sputum = (sputumRows.data || []).filter(r => r.color_score != null && r.texture_score != null && r.volume_score != null)
    .map(r => ({ date: r.taken_at, value: (Number(r.color_score) + Number(r.texture_score) + Number(r.volume_score)) / 3 }));
  ['spo2','hr','temp','wt'].forEach(vt => {
    rawData[vt] = (vitalsRows.data || []).filter(r => r.vital_type === vt).map(r => ({ date: r.taken_at, value: Number(r.value) }));
  });
  labTypes.forEach(key => {
    rawData[key] = (labRows.data || []).filter(r => r.lab_type === key).map(r => ({ date: r.taken_at, value: Number(r.value) }));
  });

  const weights = ewsGetWeights(settingsRow);
  const windows = ewsGetWindows(settingsRow);
  const baselineDays = ewsGetBaselineDays(settingsRow);
  const today = new Date(); today.setHours(0,0,0,0);

  let weightedSum = 0, totalWeight = 0, missingCount = 0;
  const breakdown = [];
  const missingRequired = [];

  EWS_PARAMS.forEach(param => {
    const w = weights[param.key] || 0;
    if (w === 0) return;

    const recs = rawData[param.key] || [];
    const latestRec = recs.length ? recs[recs.length-1] : null;
    const latest = latestRec ? latestRec.value : null;
    const baseline = ewsRollingBaseline(recs, baselineDays);
    const latestDate = latestRec ? new Date(latestRec.date) : null;
    if (latestDate) latestDate.setHours(0,0,0,0);

    const maxAge = windows[param.key] || param.maxAgeDays || 7;
    const cutoff = new Date(today); cutoff.setDate(today.getDate() - maxAge);
    const daysAgo = latestDate ? Math.floor((today - latestDate) / 86400000) : null;

    let freshness = 'ok';
    if (!latestDate || latest === null) {
      freshness = 'missing'; missingCount++;
      if (EWS_NONNEGOTIABLES.includes(param.key)) missingRequired.push(param.name);
    } else if (latestDate < cutoff) {
      freshness = 'missing'; missingCount++;
      if (EWS_NONNEGOTIABLES.includes(param.key)) missingRequired.push(param.name + ' (expired)');
    }

    if (freshness === 'missing') {
      breakdown.push({ param, score:null, latest, baseline, w, freshness, daysAgo });
      return;
    }

    const score = ewsComputeParamScore(param, latest, baseline);
    totalWeight += w;
    weightedSum += score * w;
    breakdown.push({ param, score, latest, baseline, w, freshness, daysAgo });
  });

  if (missingRequired.length > 0) {
    return { score: null, breakdown, missingCount, missingRequired, settingsRow, historyRows };
  }

  let finalScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : null;
  if (finalScore !== null) finalScore = Math.max(0, Math.min(100, finalScore));

  breakdown.sort((a,b) => {
    if (a.score !== null && b.score === null) return -1;
    if (a.score === null && b.score !== null) return 1;
    const impA = a.score !== null ? (100 - a.score) * a.w : 0;
    const impB = b.score !== null ? (100 - b.score) * b.w : 0;
    return impB - impA;
  });

  // Save to history (dedupe same-day rows, same approach as before)
  if (finalScore !== null) {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todaysRows = historyRows.filter(h => {
      const d = new Date(h.computed_at); d.setHours(0,0,0,0);
      return d.getTime() === todayStart.getTime();
    });
    const components = {};
    breakdown.forEach(b => { components[b.param.key] = b.score; });

    try {
      if (todaysRows.length) {
        todaysRows.sort((a,b) => new Date(b.computed_at) - new Date(a.computed_at));
        const keep = todaysRows[0];
        const dupes = todaysRows.slice(1);
        if (keep.score !== finalScore) {
          const updated = await updateRow('health_index_history', keep.id, { score: finalScore, components });
          keep.score = updated.score; keep.components = updated.components;
        }
        for (const dupe of dupes) {
          await deleteRow('health_index_history', dupe.id);
          historyRows = historyRows.filter(h => h.id !== dupe.id);
        }
      } else {
        const inserted = await insertRow('health_index_history', {
          user_id: userId, score: finalScore, components, computed_at: new Date().toISOString(),
        });
        historyRows.push(inserted);
      }
    } catch (e) {
      console.error('ewsComputeAndSave: history save failed:', e.message);
    }
  }

  return { score: finalScore, breakdown, missingCount, missingRequired: [], settingsRow, historyRows };
}
