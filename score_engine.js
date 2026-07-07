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
  // sdFloor = realistic minimum SD for this parameter on a home device.
  // Replaces the old 3%-of-baseline global floor, which was way too
  // permissive for temperature (3% of 98.7°F = ~3°F!) and too tight
  // for some lab values.
  { key:'symptoms', name:'Symptom Check-in', icon:'🧠', unit:'', weight:8, maxAgeDays:2, direction:'higher_better',
    sdFloor:0.5, desc:'Subjective wellness score', source:'symptoms' },
  { key:'spo2', name:'SpO₂', icon:'🩸', unit:'%', weight:15, maxAgeDays:2, direction:'higher_better',
    sdFloor:0.3, desc:'Oxygen saturation — primary lung function indicator', source:'vitals', vitalType:'spo2' },
  { key:'fev1', name:'FEV1', icon:'📊', unit:'L', weight:15, maxAgeDays:2, direction:'higher_better',
    sdFloor:0.05, desc:'Forced expiratory volume — early rejection signal', source:'peakflow', field:'fev1' },
  { key:'spiro', name:'Spirometer', icon:'🌬️', unit:'mL', weight:8, maxAgeDays:2, direction:'higher_better',
    sdFloor:50, desc:'Inspiratory volume — complements FEV1', source:'spiro' },
  { key:'hr', name:'Heart Rate', icon:'❤️', unit:'bpm', weight:5, maxAgeDays:2, direction:'stable',
    sdFloor:3, desc:'Tachycardia signals infection/rejection', source:'vitals', vitalType:'hr' },
  { key:'temp', name:'Temperature', icon:'🌡️', unit:'°F', weight:12, maxAgeDays:2, direction:'lower_better',
    sdFloor:0.3, desc:'Key infection indicator — tightly regulated, small deviations matter', source:'vitals', vitalType:'temp' },
  { key:'wt', name:'Weight', icon:'🟠', unit:'lbs', weight:3, maxAgeDays:14, direction:'stable',
    sdFloor:0.5, desc:'Fluid retention indicator', source:'vitals', vitalType:'wt' },
  { key:'sputum', name:'Sputum', icon:'🫧', unit:'/10', weight:3, maxAgeDays:2, direction:'higher_better',
    sdFloor:0.5, desc:'Composite of color + texture + volume', source:'sputum' },

  // ── LAB-DERIVED PARAMS ──
  { key:'dd_cfdna', name:'Donor-Derived cfDNA', icon:'🧬', unit:'%', weight:7, maxAgeDays:7, direction:'cfdna_binary',
    sdFloor:0.1, desc:'Most direct, earliest rejection-specific signal — specialist/UF-only test (e.g. AlloSure).', source:'labs' },
  { key:'il6', name:'IL-6', icon:'🔥', unit:'pg/mL', weight:4, maxAgeDays:2, direction:'stable',
    sdFloor:1.0, desc:'Earliest general inflammatory cytokine — precedes CRP.', source:'labs' },
  { key:'crp', name:'CRP', icon:'🌡️', unit:'mg/L', weight:7, maxAgeDays:3, direction:'stable',
    sdFloor:0.5, desc:'Best practical general inflammation marker — self-orderable', source:'labs' },
  { key:'procalcitonin', name:'Procalcitonin', icon:'🦠', unit:'ng/mL', weight:3, maxAgeDays:2, direction:'stable',
    sdFloor:0.05, desc:'Fast, bacteria-specific — blind to rejection, so weighted lower.', source:'labs' },
  { key:'neutrophils_abs', name:'Absolute Neutrophils', icon:'🛡️', unit:'K/µL', weight:6, maxAgeDays:3, direction:'stable',
    sdFloor:0.3, desc:'Bacterial infection signal; also flags drug-induced neutropenia.', source:'labs' },
  { key:'lymphocytes_abs', name:'Absolute Lymphocytes', icon:'🛡️', unit:'K/µL', weight:4, maxAgeDays:3, direction:'stable',
    sdFloor:0.2, desc:'Viral reactivation (e.g. CMV) and some rejection correlation', source:'labs' },
];
// Most lab params will sit "Excluded" for the majority of any given month
// under typical (monthly) draw cadence — that's intentional. A lab value
// only meaningfully describes "right now" for a few days; stretching trust
// in it across weeks would be worse than excluding it and letting the
// score lean on daily vitals/symptoms instead. See EWS_FLOOR_THRESHOLD
// below for how a single fresh, severely abnormal lab can still escalate
// the score during its brief active window.
const EWS_NONNEGOTIABLES = ['symptoms', 'spo2', 'fev1', 'hr'];

// ══════════════════════════════════════════════════
//  SINGLE-PARAMETER FLOOR RULE
//  The weighted composite alone has a real blind spot: a moderate,
//  genuinely-early signal in just one or two parameters (e.g. SpO2
//  or Symptom Check-in dropping meaningfully) can get almost entirely
//  averaged away if every other tracked parameter happens to be near-
//  perfect at the same time — the more "healthy" data you have, the
//  more it can dilute one real problem. This mirrors a known pattern
//  in real clinical scoring systems (e.g. the UK's NEWS2), which pair
//  an aggregate score with a rule that escalates regardless of the
//  total if any single vital sign is severely abnormal on its own.
//
//  Applies across all 14 EWS_PARAMS. dd_cfdna gets its own (higher)
//  threshold because it uses fixed clinical-cutoff buckets rather
//  than a continuous personal-baseline curve — its "mild but real"
//  bucket scores 70, which a shared 65 floor would miss entirely,
//  even though early dd-cfDNA elevation is one of the most clinically
//  important signals this whole system tracks.
// ══════════════════════════════════════════════════
const EWS_FLOOR_THRESHOLD = 65;
const EWS_FLOOR_OVERRIDES = { dd_cfdna: 70 };

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

function ewsRollingStdDev(recs, days) {
  // Standard deviation of the same rolling window used for the mean.
  // Requires at least 2 readings; returns null otherwise (caller falls
  // back to the % deviation floor — see ewsComputeParamScore).
  if (!recs.length) return null;
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);
  const windowRecs = recs.filter(r => new Date(r.date) >= cutoff);
  const useRecs = windowRecs.length > 0 ? windowRecs : recs;
  const vals = useRecs.map(r => r.value).filter(v => v != null && !isNaN(v));
  if (vals.length < 2) return null;
  const mean = vals.reduce((a,b) => a+b, 0) / vals.length;
  const variance = vals.reduce((a,v) => a + (v-mean)**2, 0) / (vals.length - 1);
  return Math.sqrt(variance);
}

// Blood pressure: scored against fixed clinical categories (not personal baseline),
// using whichever of systolic/diastolic falls into the more concerning category.
//
// Previously used hard if/else steps that cliff-jumped the score the instant
// a reading crossed a category boundary. Now uses interpolateScore with each
// category's midpoint as the calibration anchor — the score smoothly approaches
// each category's value as the reading moves through the range, so a reading
// just inside a boundary doesn't get punished identically to one at the far
// extreme of that same category. The categories and their anchor scores are
// unchanged; only the space *between* them is now a smooth ramp instead of a
// cliff edge.
function ewsComputeBPScore(sys, dia) {
  function sysScore(s) {
    return interpolateScore(s, [
      [70,  20],  // deep severe hypotension (<80)
      [85,  60],  // midpoint of mild hypotension (80–89)
      [105, 100], // midpoint of normal (90–119)
      [125, 90],  // midpoint of elevated (120–129)
      [135, 70],  // midpoint of stage 1 hypertension (130–139)
      [150, 45],  // midpoint of stage 2 hypertension (140–159)
      [170, 15],  // deep hypertensive crisis (≥160)
    ]);
  }
  function diaScore(d) {
    return interpolateScore(d, [
      [40,  20],  // deep severe hypotension (<50)
      [55,  60],  // midpoint of mild hypotension (50–59)
      [70,  100], // midpoint of normal (60–79)
      [85,  70],  // midpoint of stage 1 (80–89)
      [95,  45],  // midpoint of stage 2 (90–99)
      [110, 15],  // deep hypertensive crisis (≥100)
    ]);
  }
  return round1(Math.min(sysScore(sys), diaScore(dia)));
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

// Linearly interpolates a score between named calibration points instead
// of snapping to discrete buckets. `points` is [[x, score], ...] sorted
// ascending by x. The calibration meaning at each named point is preserved
// exactly (e.g. "5% off = 85" is still true) — only the space *between*
// points is now a smooth ramp instead of a flat step with a cliff edge.
function interpolateScore(x, points) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i-1], [x1, y1] = points[i];
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}
function round1(n) { return Math.round(n * 10) / 10; }

function ewsComputeParamScore(param, latest, baseline, stddev) {
  if (latest === null || latest === undefined) return null;

  if (param.direction === 'cfdna_binary') {
    return ewsComputeCfdnaScore(latest);
  }

  const base = (baseline != null && baseline !== 0) ? baseline : latest;
  if (base === 0) return 75;

  if (param.key === 'spo2') {
    // SpO₂ stays as absolute % deviation — clinically, even a 1% drop
    // matters regardless of how variable a person's readings normally
    // are, and it's bounded at 100%, so SD-based scoring is less
    // meaningful here than for unconstrained physiological parameters.
    const pctDev = ((base - latest) / base) * 100;
    return round1(Math.max(0, interpolateScore(pctDev, [[0,100],[0.5,95],[1.0,85],[2.0,65],[3.0,40],[7,0]])));
  }

  // ── SD-based scoring (all other personal-baseline parameters) ──
  //
  // How many standard deviations is the latest reading from the rolling
  // mean? This automatically scales to how variable EACH parameter
  // actually is for THIS patient.
  //
  // Each parameter defines its own sdFloor — the realistic minimum SD
  // for that measurement type on a home device. This replaces the old
  // blanket 3%-of-baseline rule, which was completely wrong for
  // temperature (3% of 98.7°F = 2.96°F — so large that a 0.8°F fever
  // registered as essentially zero deviation and scored 100).
  const sdFloor = param.sdFloor ?? Math.abs(base) * 0.03;
  const effectiveSD = (stddev != null && stddev > sdFloor) ? stddev : sdFloor;

  // Calibration curve in SD units — same shape for all directions,
  // direction determines which side(s) get penalized.
  // Anchor scores: 0 SD = 100, 1 SD = 85, 2 SD = 65, 3 SD = 40, 5 SD = 0
  const SD_CURVE = [[0,100],[0.5,100],[1,85],[2,65],[3,40],[5,0]];

  if (param.direction === 'higher_better') {
    // Only penalize drops below baseline — going above never costs points.
    const sdDev = Math.max(0, (base - latest) / effectiveSD);
    return round1(Math.max(0, interpolateScore(sdDev, SD_CURVE)));
  }
  if (param.direction === 'lower_better') {
    // Penalize deviation in either direction.
    const sdDev = Math.abs((latest - base) / effectiveSD);
    return round1(Math.max(0, interpolateScore(sdDev, SD_CURVE)));
  }
  // 'stable' — penalize deviation in either direction (hr, wt, labs, etc.)
  const sdDev = Math.abs((latest - base) / effectiveSD);
  return round1(Math.max(0, interpolateScore(sdDev, SD_CURVE)));
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
  const today = new Date(easternDateInputValue() + 'T00:00:00Z');

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
    const stddev = ewsRollingStdDev(recs, baselineDays);
    const latestDate = latestRec ? new Date(easternDateInputValue(latestRec.date) + 'T00:00:00Z') : null;

    const maxAge = windows[param.key] || param.maxAgeDays || 7;
    const cutoff = new Date(today); cutoff.setUTCDate(today.getUTCDate() - maxAge);
    const daysAgo = latestDate ? Math.round((today - latestDate) / 86400000) : null;

    let freshness = 'ok';
    if (!latestDate || latest === null) {
      freshness = 'missing'; missingCount++;
      if (EWS_NONNEGOTIABLES.includes(param.key)) missingRequired.push(param.name);
    } else if (latestDate < cutoff) {
      freshness = 'missing'; missingCount++;
      if (EWS_NONNEGOTIABLES.includes(param.key)) missingRequired.push(param.name + ' (expired)');
    }

    if (freshness === 'missing') {
      breakdown.push({ param, score:null, latest, baseline, stddev, w, freshness, daysAgo });
      return;
    }

    const score = ewsComputeParamScore(param, latest, baseline, stddev);
    totalWeight += w;
    weightedSum += score * w;
    breakdown.push({ param, score, latest, baseline, stddev, w, freshness, daysAgo });
  });

  if (missingRequired.length > 0) {
    return { score: null, breakdown, missingCount, missingRequired, settingsRow, historyRows };
  }

  let finalScore = totalWeight > 0 ? round1(weightedSum / totalWeight) : null;
  if (finalScore !== null) finalScore = Math.max(0, Math.min(100, finalScore));

  // ── Apply the single-parameter floor rule ──
  // A severely abnormal individual parameter caps the score regardless
  // of what the weighted composite computed — see EWS_FLOOR_THRESHOLD
  // comment above for why this exists.
  let floorTriggeredBy = null;
  if (finalScore !== null) {
    for (const b of breakdown) {
      if (b.score === null) continue;
      const floor = EWS_FLOOR_OVERRIDES[b.param.key] ?? EWS_FLOOR_THRESHOLD;
      if (b.score <= floor && b.score < finalScore) {
        finalScore = round1(b.score);
        floorTriggeredBy = b.param.name;
      }
    }
  }

  breakdown.sort((a,b) => {
    if (a.score !== null && b.score === null) return -1;
    if (a.score === null && b.score !== null) return 1;
    const impA = a.score !== null ? (100 - a.score) * a.w : 0;
    const impB = b.score !== null ? (100 - b.score) * b.w : 0;
    return impB - impA;
  });

  // Save to history (dedupe same-day rows, same approach as before)
  if (finalScore !== null) {
    const todayStr = easternDateInputValue();
    const todaysRows = historyRows.filter(h => easternDateInputValue(h.computed_at) === todayStr);
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

  return { score: finalScore, breakdown, missingCount, missingRequired: [], settingsRow, historyRows, floorTriggeredBy };
}
