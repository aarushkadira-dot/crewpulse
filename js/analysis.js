/*
 * Quorum analysis core.
 * Reads NASA OSDR Inspiration4 files (LSDS-7 complete blood count, LSDS-8 metabolic panel),
 * builds each crew member's personal normal from preflight draws, and compares
 * personal-baseline flags with the reference ranges printed on the lab report.
 * Works in the browser (window.CrewPulseAnalysis) and in Node (require).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CrewPulseAnalysis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DRAWS = ['L-92', 'L-44', 'L-3', 'R+1', 'R+45', 'R+82', 'R+194'];
  var PRE = [0, 1, 2];
  var POST = [3, 4, 5, 6], POST0 = POST;
  var CREW = ['C001', 'C002', 'C003', 'C004'];

  // Display names and units. NASA's column suffixes are kept for traceability,
  // but some are mislabeled in the source (hemoglobin is listed as "percent"), so
  // display units come from this table.
  var META = {
    absolute_basophils: ['Basophils, absolute', 'cells/µL'],
    absolute_eosinophils: ['Eosinophils, absolute', 'cells/µL'],
    absolute_lymphocytes: ['Lymphocytes, absolute', 'cells/µL'],
    absolute_monocytes: ['Monocytes, absolute', 'cells/µL'],
    absolute_neutrophils: ['Neutrophils, absolute', 'cells/µL'],
    basophils: ['Basophils', '%'], eosinophils: ['Eosinophils', '%'], lymphocytes: ['Lymphocytes', '%'],
    monocytes: ['Monocytes', '%'], neutrophils: ['Neutrophils', '%'],
    hematocrit: ['Hematocrit', '%'], hemoglobin: ['Hemoglobin', 'g/dL'],
    mch: ['MCH · hemoglobin per red cell', 'pg'], mchc: ['MCHC · hemoglobin concentration', 'g/dL'],
    mcv: ['MCV · red-cell size', 'fL'], mpv: ['MPV · platelet size', 'fL'],
    platelet_count: ['Platelets', '×10³/µL'], rdw: ['RDW · red-cell size spread', '%'],
    red_blood_cell_count: ['Red blood cells', '×10⁶/µL'], white_blood_cell_count: ['White blood cells', '×10³/µL'],
    albumin: ['Albumin', 'g/dL'], albumin_to_globulin_ratio: ['Albumin / globulin ratio', ''],
    alkaline_phosphatase: ['Alkaline phosphatase', 'U/L'], alt: ['ALT · liver enzyme', 'U/L'], ast: ['AST · liver enzyme', 'U/L'],
    total_bilirubin: ['Bilirubin, total', 'mg/dL'], bun_to_creatinine_ratio: ['BUN / creatinine ratio', ''],
    calcium: ['Calcium', 'mg/dL'], carbon_dioxide: ['Bicarbonate (CO₂)', 'mmol/L'], chloride: ['Chloride', 'mmol/L'],
    creatinine: ['Creatinine', 'mg/dL'], egfr_african_american: ['eGFR (race-adjusted)', 'mL/min/1.73 m²'],
    egfr_non_african_american: ['eGFR', 'mL/min/1.73 m²'], globulin: ['Globulin', 'g/dL'], glucose: ['Glucose', 'mg/dL'],
    potassium: ['Potassium', 'mmol/L'], total_protein: ['Total protein', 'g/dL'], sodium: ['Sodium', 'mmol/L'],
    urea_nitrogen_bun: ['Urea nitrogen (BUN)', 'mg/dL']
  };

  // Documented exclusion. In NASA's LSDS-7 file, crew C003's L-92 row has values in the
  // wrong columns. These are applied only if checkRowConsistency() confirms the row fails.
  var QC = [{
    panel: 'CBC', crew: 'C003', draw: 'L-92',
    keys: ['absolute_basophils', 'absolute_eosinophils', 'absolute_lymphocytes', 'absolute_monocytes', 'absolute_neutrophils',
      'mch', 'mchc', 'mpv', 'platelet_count', 'rdw'],
    reason: 'Values shifted into the wrong columns in the source file (for example platelets 12.9 ×10³/µL, RDW 32.4%).'
  }];

  function num(s) {
    if (s == null) return null;
    s = String(s).trim();
    if (s === '' || s === 'NA' || s === 'N/A') return null;
    var v = Number(s);
    return isFinite(v) ? v : null;
  }

  function parseCSV(text) {
    var lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    var head = lines[0].split(',');
    return { head: head, rows: lines.slice(1).map(function (l) {
      var cells = l.split(','), o = {};
      head.forEach(function (h, i) { o[h] = cells[i]; });
      return o;
    }) };
  }

  function sampleInfo(name) {
    var parts = name.split('_');
    var crew = parts[0], draw = parts.filter(function (p) { return /^[LR][+-]\d+$/.test(p); })[0];
    return { crew: crew, draw: draw };
  }

  // Build markers from one panel file.
  function loadPanel(text, panel) {
    var csv = parseCSV(text), markers = [];
    csv.head.forEach(function (col) {
      var m = col.match(/^(.*)_value(_.*)?$/);
      if (!m) return;
      var key = m[1];
      var minCol = csv.head.filter(function (h) { return h.indexOf(key + '_range_min') === 0; })[0];
      var maxCol = csv.head.filter(function (h) { return h.indexOf(key + '_range_max') === 0 || h.indexOf(key + '_max') === 0; })[0];
      var meta = META[key] || [key, ''];
      var mk = { panel: panel, key: key, name: meta[0], unit: meta[1], sourceColumn: col,
        vals: CREW.map(function () { return DRAWS.map(function () { return null; }); }),
        lo: CREW.map(function () { return DRAWS.map(function () { return null; }); }),
        hi: CREW.map(function () { return DRAWS.map(function () { return null; }); }) };
      csv.rows.forEach(function (r) {
        var info = sampleInfo(r['Sample Name']), c = CREW.indexOf(info.crew), t = DRAWS.indexOf(info.draw);
        if (c < 0 || t < 0) return;
        mk.vals[c][t] = num(r[col]);
        mk.lo[c][t] = minCol ? num(r[minCol]) : null;
        mk.hi[c][t] = maxCol ? num(r[maxCol]) : null;
      });
      markers.push(mk);
    });
    return { markers: markers, rows: csv.rows };
  }

  // Internal consistency checks for a complete-blood-count row. Red-cell indices are
  // arithmetic from hemoglobin, hematocrit and red-cell count, so they must agree.
  function checkRowConsistency(row) {
    var hgb = num(row.hemoglobin_value_percent), hct = num(row.hematocrit_value_percent), rbc = num(row.red_blood_cell_count_value_million_per_microliter);
    var mcv = num(row.mcv_value_femtoliter), mch = num(row.mch_value_picogram), mchc = num(row.mchc_value_grams_per_deciliter);
    var wbc = num(row.white_blood_cell_count_value_thousand_per_microliter), neutPct = num(row.neutrophils_value_percent), neutAbs = num(row.absolute_neutrophils_value_cells_per_microliter);
    var fails = [];
    if (hct && rbc && mcv != null && Math.abs(mcv - hct / rbc * 10) > 1.5) fails.push('MCV does not match hematocrit ÷ red cells');
    if (hgb && rbc && (mch == null || Math.abs(mch - hgb / rbc * 10) > 1)) fails.push('MCH missing or does not match hemoglobin ÷ red cells');
    if (hgb && hct && (mchc == null || Math.abs(mchc - hgb / hct * 100) > 1)) fails.push('MCHC does not match hemoglobin ÷ hematocrit (expected ' + (hgb / hct * 100).toFixed(1) + ', file has ' + mchc + ')');
    if (wbc && neutPct != null && neutAbs != null && Math.abs(neutAbs - wbc * neutPct * 10) > wbc * neutPct * 10 * 0.15) fails.push('Absolute neutrophils (' + neutAbs + ') do not match white cells × neutrophil % (expected about ' + Math.round(wbc * neutPct * 10) + ')');
    return fails;
  }

  function build(cbcText, cmpText) {
    var cbc = loadPanel(cbcText, 'CBC'), cmp = loadPanel(cmpText, 'CMP');
    var markers = cbc.markers.concat(cmp.markers), qcLog = [];
    QC.forEach(function (q) {
      var row = (q.panel === 'CBC' ? cbc.rows : cmp.rows).filter(function (r) { var i = sampleInfo(r['Sample Name']); return i.crew === q.crew && i.draw === q.draw; })[0];
      var fails = row ? checkRowConsistency(row) : [];
      if (!fails.length) return;
      var c = CREW.indexOf(q.crew), t = DRAWS.indexOf(q.draw), removed = [];
      markers.forEach(function (m) {
        if (m.panel === q.panel && q.keys.indexOf(m.key) >= 0 && m.vals[c][t] != null) { removed.push({ key: m.key, name: m.name, value: m.vals[c][t] }); m.vals[c][t] = null; }
      });
      qcLog.push({ panel: q.panel, crew: q.crew, draw: q.draw, reason: q.reason, evidence: fails, removed: removed });
    });
    var valueCount = 0;
    cbc.markers.concat(cmp.markers).forEach(function (m) { m.vals.forEach(function (a) { a.forEach(function (v) { if (v != null) valueCount++; }); }); });
    return { draws: DRAWS, crew: CREW, markers: markers, qc: qcLog, valueCount: valueCount };
  }

  function mean(a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; }

  // Within-person preflight standard deviation, pooled across crew (one value per marker).
  function pooledSD(m, pre) {
    pre = pre || PRE;
    var ss = 0, df = 0;
    m.vals.forEach(function (row) {
      var p = pre.map(function (i) { return row[i]; }).filter(function (x) { return x != null; });
      if (p.length >= 2) { var mu = mean(p); p.forEach(function (x) { ss += (x - mu) * (x - mu); }); df += p.length - 1; }
    });
    return df ? Math.sqrt(ss / df) : null;
  }

  // A marker is usable when it has a two-sided lab range and a computable pooled SD.
  function usable(m, pre) {
    var hasRange = m.hi.some(function (r) { return r.some(function (v) { return v != null; }); }) && m.lo.some(function (r) { return r.some(function (v) { return v != null; }); });
    var sd = pooledSD(m, pre);
    return hasRange && sd != null && sd > 0;
  }

  function band(m, c, opt) {
    opt = opt || {};
    var pre = opt.pre || PRE, k = opt.k || 1.96, sd = pooledSD(m, pre);
    var p = pre.map(function (i) { return m.vals[c][i]; }).filter(function (x) { return x != null; });
    if (!sd || p.length < 2) return null;
    var f = Math.sqrt(1 + 1 / p.length), mu = mean(p);
    return { mean: mu, sd: sd, n: p.length, factor: f, half: k * sd * f, k: k };
  }

  // Drift score d = (x - personal mean) / (s * sqrt(1 + 1/n)); flagged when |d| > k.
  function cell(m, c, t, opt) {
    var v = m.vals[c][t], b = band(m, c, opt), lo = m.lo[c][t], hi = m.hi[c][t];
    if (v == null || !b || lo == null || hi == null) return null;
    var d = (v - b.mean) / (b.sd * b.factor);
    return { value: v, lo: lo, hi: hi, d: d, personal: Math.abs(d) > b.k, lab: v < lo || v > hi, band: b };
  }

  function summarize(ds, opt) {
    opt = opt || {};
    var mk = ds.markers.filter(function (m) { return usable(m, opt.pre); });
    var byDraw = {};
    POST.forEach(function (t) {
      var o = { n: 0, lab: 0, personal: 0, personalOnly: 0, labOnly: 0, both: 0 };
      mk.forEach(function (m) { ds.crew.forEach(function (_, c) {
        var x = cell(m, c, t, opt); if (!x) return;
        o.n++; if (x.lab) o.lab++; if (x.personal) o.personal++;
        if (x.personal && !x.lab) o.personalOnly++; if (x.lab && !x.personal) o.labOnly++; if (x.lab && x.personal) o.both++;
      }); });
      byDraw[ds.draws[t]] = o;
    });
    return { markers: mk.length, cbc: mk.filter(function (m) { return m.panel === 'CBC'; }).length, cmp: mk.filter(function (m) { return m.panel === 'CMP'; }).length, byDraw: byDraw };
  }

  // False-flag test: leave one healthy preflight draw out, test it against the mean of the other two.
  function falseFlags(ds, opt) {
    opt = opt || {};
    var k = opt.k || 1.96, flags = 0, tests = 0, labFlags = 0;
    ds.markers.filter(function (m) { return usable(m); }).forEach(function (m) {
      var sd = pooledSD(m);
      ds.crew.forEach(function (_, c) {
        var p = PRE.map(function (i) { return m.vals[c][i]; });
        if (p.some(function (x) { return x == null; })) return;
        PRE.forEach(function (t, i) {
          var others = p.filter(function (_, j) { return j !== i; });
          tests++;
          if (Math.abs(p[i] - mean(others)) > k * sd * Math.sqrt(1 + 1 / others.length)) flags++;
          var lo = m.lo[c][t], hi = m.hi[c][t];
          if (lo != null && hi != null && (p[i] < lo || p[i] > hi)) labFlags++;
        });
      });
    });
    return { flags: flags, tests: tests, rate: flags / tests, labFlags: labFlags, labRate: labFlags / tests };
  }

  // Markers where every crew member is flagged in the same direction at one draw.
  function crewWide(ds, t, opt) {
    var out = [];
    ds.markers.filter(function (m) { return usable(m, opt && opt.pre); }).forEach(function (m) {
      var cells = ds.crew.map(function (_, c) { return cell(m, c, t, opt); });
      if (cells.some(function (x) { return !x; })) return;
      [1, -1].forEach(function (sg) {
        if (cells.every(function (x) { return x.personal && Math.sign(x.d) === sg; })) out.push({ marker: m, direction: sg, cells: cells });
      });
    });
    return out;
  }

  // Probability that all crew shift the same way on one marker at one draw by chance,
  // assuming independent false flags split evenly between the two directions.
  function crewWideChance(rate, crewCount, markerCount) {
    var perMarker = 2 * Math.pow(rate / 2, crewCount);
    return { perMarker: perMarker, anyMarker: 1 - Math.pow(1 - perMarker, markerCount) };
  }

  function robustness(ds) {
    var rows = [];
    [1.645, 1.96, 2.576].forEach(function (k) {
      var s = summarize(ds, { k: k }), f = falseFlags(ds, { k: k }), r1 = s.byDraw['R+1'], cw = crewWide(ds, 3, { k: k });
      var mcv = ds.markers.filter(function (m) { return m.key === 'mcv'; })[0];
      var mcvCount = ds.crew.filter(function (_, c) { var x = cell(mcv, c, 3, { k: k }); return x && x.personal && x.d < 0; }).length;
      rows.push({ label: 'Threshold ' + k, k: k, n: r1.n, flags: r1.personal, expected: f.rate * r1.n, rate: f.rate, mcvCrew: mcvCount, crewWide: cw.map(function (x) { return x.marker.key; }) });
    });
    [[1, 2], [0, 1]].forEach(function (pre) {
      var s = summarize(ds, { pre: pre }), r1 = s.byDraw['R+1'];
      var mcv = ds.markers.filter(function (m) { return m.key === 'mcv'; })[0];
      var mcvCount = ds.crew.filter(function (_, c) { var x = cell(mcv, c, 3, { pre: pre }); return x && x.personal && x.d < 0; }).length;
      rows.push({ label: 'Baseline from ' + pre.map(function (i) { return DRAWS[i]; }).join(' and ') + ' only', pre: pre, n: r1.n, flags: r1.personal, expected: null, rate: null, mcvCrew: mcvCount });
    });
    return rows;
  }


  /* ------------------------------------------------------------------
   * Crew-based quality control (source check)
   * Before a result is used for a health decision, ask whether the change
   * is in one person, in the whole crew's environment, or in the measurement.
   * ------------------------------------------------------------------ */

  // Two-sided 95% Student t critical values. The pooled SD comes from only a few
  // preflight draws, so the threshold is t(df), not the large-sample 1.96.
  var T975 = [null, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042];
  function tcrit(df) { return df >= 1 && df <= 30 ? T975[df] : 1.96; }

  // Degrees of freedom behind the pooled within-person SD of one marker.
  function pooledDF(m, pre) {
    pre = pre || PRE;
    var df = 0;
    m.vals.forEach(function (row) {
      var p = pre.map(function (i) { return row[i]; }).filter(function (x) { return x != null; });
      if (p.length >= 2) df += p.length - 1;
    });
    return df;
  }
  function kFor(m) { return tcrit(pooledDF(m)); }
  function tcell(m, c, t) { return cell(m, c, t, { k: kFor(m) }); }

  function summarizeT(ds) {
    var mk = ds.markers.filter(function (m) { return usable(m); }), byDraw = {};
    POST.forEach(function (t) {
      var o = { n: 0, lab: 0, personal: 0, personalOnly: 0, labOnly: 0, both: 0 };
      mk.forEach(function (m) { ds.crew.forEach(function (_, c) {
        var x = tcell(m, c, t); if (!x) return;
        o.n++; if (x.lab) o.lab++; if (x.personal) o.personal++;
        if (x.personal && !x.lab) o.personalOnly++; if (x.lab && !x.personal) o.labOnly++; if (x.lab && x.personal) o.both++;
      }); });
      byDraw[ds.draws[t]] = o;
    });
    return { markers: mk.length, byDraw: byDraw };
  }

  function falseFlagsT(ds) {
    var flags = 0, tests = 0;
    ds.markers.filter(function (m) { return usable(m); }).forEach(function (m) {
      var sd = pooledSD(m), k = kFor(m);
      ds.crew.forEach(function (_, c) {
        var p = PRE.map(function (i) { return m.vals[c][i]; });
        if (p.some(function (x) { return x == null; })) return;
        PRE.forEach(function (t, i) {
          var others = p.filter(function (_, j) { return j !== i; });
          tests++;
          if (Math.abs(p[i] - mean(others)) > k * sd * Math.sqrt(1 + 1 / others.length)) flags++;
        });
      });
    });
    return { flags: flags, tests: tests, rate: flags / tests };
  }

  // Crew shift: the average of each crew member's drift score at one draw, scaled by √n.
  // This is the "average of deltas" idea from patient-based quality control, with the
  // crew as the patients and each person's preflight mean as their previous result.
  function crewShift(m, t) {
    var k = kFor(m), ds_ = [], pct = [];
    m.vals.forEach(function (_, c) {
      var x = tcell(m, c, t);
      if (x) { ds_.push(x.d); pct.push((x.value - x.band.mean) / x.band.mean * 100); }
    });
    if (ds_.length < 3) return null;
    var z = mean(ds_) * Math.sqrt(ds_.length);
    var sign = z < 0 ? -1 : 1;
    var flagged = ds_.filter(function (d) { return Math.abs(d) > k && (d < 0 ? -1 : 1) === sign; }).length;
    // signal: the crew average moved. alarm: it moved and at least half the crew is individually outside their own normal.
    // With dozens of markers checked at once, the alarm tier keeps weak drifts from putting results on hold.
    return { z: z, k: k, n: ds_.length, signal: Math.abs(z) > k, alarm: Math.abs(z) > k && flagged * 2 >= ds_.length, sign: sign, pct: mean(pct), flagged: flagged };
  }

  // How often the crew-shift alarm fires on healthy preflight draws (leave one draw out).
  function crewShiftFalseAlarms(ds) {
    var alarms = 0, signals = 0, tests = 0;
    ds.markers.filter(function (m) { return usable(m); }).forEach(function (m) {
      var sd = pooledSD(m), k = kFor(m);
      PRE.forEach(function (t, i) {
        var dd = [];
        ds.crew.forEach(function (_, c) {
          var p = PRE.map(function (j) { return m.vals[c][j]; });
          if (p.some(function (x) { return x == null; })) return;
          var o = p.filter(function (_, j) { return j !== i; });
          dd.push((p[i] - mean(o)) / (sd * Math.sqrt(1 + 1 / o.length)));
        });
        if (dd.length < 3) return;
        tests++;
        var z = mean(dd) * Math.sqrt(dd.length);
        if (Math.abs(z) > k) {
          signals++;
          if (dd.filter(function (d) { return Math.abs(d) > k && (d < 0) === (z < 0); }).length * 2 >= dd.length) alarms++;
        }
      });
    });
    return { signals: signals, alarms: alarms, tests: tests, signalRate: signals / tests, rate: alarms / tests };
  }

  // Markers that are measured or computed together. A real change in the body usually
  // moves relatives; a single moving channel points at the measurement.
  var FAMILY = {
    'Red cells': ['mcv', 'hematocrit', 'hemoglobin', 'red_blood_cell_count', 'mch', 'mchc', 'rdw'],
    'White cells': ['white_blood_cell_count', 'absolute_neutrophils', 'absolute_lymphocytes', 'absolute_monocytes', 'absolute_eosinophils', 'absolute_basophils', 'neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils'],
    'Platelets': ['platelet_count', 'mpv'],
    'Electrolytes': ['sodium', 'chloride', 'potassium', 'carbon_dioxide', 'calcium'],
    'Kidney': ['creatinine', 'urea_nitrogen_bun'],
    'Liver': ['alt', 'ast', 'alkaline_phosphatase', 'total_bilirubin'],
    'Proteins': ['albumin', 'globulin', 'total_protein', 'albumin_to_globulin_ratio'],
    'Sugar': ['glucose']
  };
  function familyOf(key) { for (var f in FAMILY) if (FAMILY[f].indexOf(key) >= 0) return f; return null; }

  // Known sample-handling signatures: pairs that move in opposite, predictable directions
  // when blood waits too long before it is processed.
  var HANDLING = [
    { up: 'potassium', down: 'glucose', label: 'Potassium up with glucose down',
      why: 'Blood cells keep using sugar and leak potassium while a sample waits to be processed. The two moving in opposite directions together is the classic sign of a delayed sample, not of a change in the crew.' }
  ];

  // Did every crew member's preflight values move the same way, draw after draw?
  function baselineComovement(m) {
    var up = 0, down = 0, n = 0;
    m.vals.forEach(function (row) {
      var p = PRE.map(function (i) { return row[i]; });
      if (p.some(function (x) { return x == null; })) return;
      n++;
      if (p[0] < p[1] && p[1] < p[2]) up++;
      if (p[0] > p[1] && p[1] > p[2]) down++;
    });
    return { n: n, up: up, down: down, all: n >= 3 && (up === n || down === n), direction: up === n ? 1 : down === n ? -1 : 0 };
  }

  var DRAW_DAY = { 'L-92': -92, 'L-44': -44, 'L-3': -3, 'R+1': 1, 'R+45': 45, 'R+82': 82, 'R+194': 194 };

  // The source check for one draw. Uses only draws up to and including t, as a crew would.
  function sourceCheck(ds, t) {
    // Draws added on board extend the list of after-flight draws; without them this is the fixed Inspiration4 schedule.
    var POST = ds.post || POST0;
    var dayOf = function (tt) { var d = ds.days && ds.days[ds.draws[tt]]; return d != null ? d : DRAW_DAY[ds.draws[tt]]; };
    var mk = ds.markers.filter(function (m) { return usable(m); });
    var byKey = {};
    mk.forEach(function (m) { byKey[m.key] = m; });
    var shiftAt = function (m, tt) { return crewShift(m, tt); };
    var signals = [];
    mk.forEach(function (m) {
      var s = shiftAt(m, t);
      if (!s || !s.signal) return;
      var ev = [], fam = familyOf(m.key);

      // 1. Sample-handling signature
      var hand = null;
      HANDLING.forEach(function (h) {
        var partnerKey = m.key === h.up ? h.down : m.key === h.down ? h.up : null;
        if (!partnerKey || !byKey[partnerKey]) return;
        var ps = shiftAt(byKey[partnerKey], t);
        var ok = ps && ps.signal && ((m.key === h.up && s.sign > 0 && ps.sign < 0) || (m.key === h.down && s.sign < 0 && ps.sign > 0));
        if (ok) hand = h;
      });
      if (hand) ev.push({ id: 'handling', points: 'handling', hit: true, title: hand.label, text: hand.why });

      // 2. Seen before, long after the flight ended
      var earlier = [];
      POST.forEach(function (tt) { if (tt < t) { var e = shiftAt(m, tt); if (e && e.signal && e.sign === s.sign) earlier.push(ds.draws[tt]); } });
      var first = POST.filter(function (tt) { return tt <= t; }).every(function (tt) { return tt === t || !(shiftAt(m, tt) || {}).signal; });
      ev.push({ id: 'recur', points: 'measurement', hit: earlier.length > 0,
        title: earlier.length ? 'Same shift at ' + earlier.join(', ') : 'Not seen at an earlier draw',
        text: earlier.length ? 'The crew-wide shift is still here ' + (dayOf(t) - 1) + ' days after a three-day flight. A lasting offset is more typical of how samples are measured than of the flight.' : 'A shift that keeps coming back would point at the measurement. This is the first time it appears.' });

      // 3. Baseline already moving together
      var bc = baselineComovement(m);
      ev.push({ id: 'baseline', points: 'measurement', hit: bc.all,
        title: bc.all ? 'Baseline already moved together' : 'Baseline was steady',
        text: bc.all ? 'All ' + bc.n + ' crew ' + (bc.direction > 0 ? 'rose' : 'fell') + ' at each preflight draw, on the ground, before any exposure. The crew’s samples share a batch, so they can move together for reasons that have nothing to do with health.' : 'The preflight draws did not all move the same way, so there is no sign of a shared batch effect before flight.' });

      // 4. One channel or the whole family
      var rel = (FAMILY[fam] || []).filter(function (k) { return k !== m.key && byKey[k]; });
      var relHit = rel.filter(function (k) { var r = shiftAt(byKey[k], t); return r && r.signal; });
      if (rel.length) {
        ev.push({ id: 'isolated', points: relHit.length ? 'environment' : 'measurement', hit: true,
          title: relHit.length ? 'Related markers moved too' : 'Only this channel moved',
          text: relHit.length ? relHit.length + ' of ' + rel.length + ' related markers (' + fam.toLowerCase() + ') shifted crew-wide as well. A real change in the body usually moves relatives together.' : 'None of the ' + rel.length + ' related markers (' + fam.toLowerCase() + ') shifted crew-wide. A real change in the body usually moves relatives together; a single channel moving alone points at the measurement.' });
      }

      // 5. Timing against the exposure
      var firstPost = t === POST[0];
      ev.push({ id: 'timing', points: 'environment', hit: firstPost && first,
        title: firstPost ? 'Appeared right after the flight' : 'Not tied to the flight',
        text: firstPost ? 'This is the first draw after the exposure, which is when a real shared effect of the flight would show up.' : 'This draw is ' + dayOf(t) + ' days after landing, so the timing does not point at the flight.' });

      var score = { measurement: 0, environment: 0 };
      ev.forEach(function (e) { if (e.hit && score[e.points] != null) score[e.points]++; });
      var cause = hand ? 'handling' : score.measurement > score.environment ? 'instrument' : score.environment > score.measurement ? 'environment' : 'undetermined';
      // An alarm that was raised at an earlier draw stays open while the crew average is still shifted.
      var carried = !s.alarm && POST.some(function (tt) { if (tt >= t) return false; var e = shiftAt(m, tt); return e && e.alarm && e.sign === s.sign; });
      signals.push({ marker: m, key: m.key, family: fam, shift: s, tier: s.alarm || carried ? 'alarm' : 'watch', carried: carried, evidence: ev, score: score, cause: cause });
    });
    signals.sort(function (a, b) { return Math.abs(b.shift.z) - Math.abs(a.shift.z); });
    signals.sort(function (a, b) { return (a.tier === 'alarm' ? 0 : 1) - (b.tier === 'alarm' ? 0 : 1); });
    var sigKeys = {};
    signals.forEach(function (s) { if (s.tier === 'alarm') sigKeys[s.key] = s; });

    // Per-result trust status
    var results = [], counts = { trusted: 0, retake: 0, hold: 0, shared: 0, person: 0, total: 0 };
    mk.forEach(function (m) {
      ds.crew.forEach(function (_, c) {
        var x = tcell(m, c, t); if (!x) return;
        var sig = sigKeys[m.key], status, note;
        if (sig && (sig.cause === 'instrument' || sig.cause === 'handling' || sig.cause === 'undetermined')) {
          status = 'hold';
          note = sig.cause === 'handling' ? 'Sample handling suspected' : sig.cause === 'instrument' ? 'Instrument suspected' : 'Crew-wide shift, cause unclear';
        } else if (sig) { status = 'shared'; note = 'Shared cause suspected'; }
        else if (x.personal) {
          var prev = null;
          POST.forEach(function (tt) { if (tt < t) { var y = tcell(m, c, tt); if (y) prev = y; } });
          var repeated = prev && prev.personal && (prev.d < 0) === (x.d < 0);
          if (repeated || x.lab) { status = 'person'; note = repeated ? 'Repeated outside own normal' : 'Outside own normal and the lab range'; }
          else { status = 'retake'; note = 'Single flag: retake before acting'; }
        } else { status = 'trusted'; note = x.lab ? 'Usual for this person' : 'Within own normal'; }
        counts[status]++; counts.total++;
        results.push({ key: m.key, crew: c, status: status, note: note, cell: x });
      });
    });
    return { draw: ds.draws[t], t: t, signals: signals, alarms: signals.filter(function (s) { return s.tier === 'alarm'; }), watch: signals.filter(function (s) { return s.tier === 'watch'; }), results: results, counts: counts };
  }

  // Append a blood draw entered on board. vals maps marker key -> one value per crew member (null where not measured).
  // The lab range for the new draw is carried over from that person's most recent draw.
  function addDraw(ds, d) {
    var last = function (r) { for (var i = r.length - 1; i >= 0; i--) if (r[i] != null) return r[i]; return null; };
    if (!ds.post) ds.post = POST.slice();
    if (!ds.days) ds.days = {};
    ds.draws = ds.draws.concat([d.label]);
    ds.days[d.label] = d.day;
    var t = ds.draws.length - 1;
    ds.post = ds.post.concat([t]);
    ds.markers.forEach(function (m) {
      var v = (d.vals && d.vals[m.key]) || [];
      m.vals.forEach(function (row, c) {
        var x = v[c]; row[t] = (x == null || x === '' || isNaN(+x)) ? null : +x;
        m.lo[c][t] = last(m.lo[c].slice(0, t)); m.hi[c][t] = last(m.hi[c].slice(0, t));
      });
    });
    return t;
  }

  // Smallest crew-wide instrument shift detectable in one round of draws, per marker.
  function detectionLimits(ds, crewN) {
    crewN = crewN || ds.crew.length;
    return ds.markers.filter(function (m) { return usable(m); }).map(function (m) {
      var sd = pooledSD(m), k = kFor(m), means = [];
      m.vals.forEach(function (row) {
        var p = PRE.map(function (i) { return row[i]; }).filter(function (x) { return x != null; });
        if (p.length) means.push(mean(p));
      });
      var mu = mean(means), npre = PRE.length;
      var cv = sd / mu * 100, det = k * sd * Math.sqrt(1 + 1 / npre) / Math.sqrt(crewN) / mu * 100;
      return { key: m.key, name: m.name, panel: m.panel, family: familyOf(m.key), cv: cv, detect: det, crewCovers: det <= CREW_COVER_PCT };
    }).sort(function (a, b) { return a.detect - b.detect; });
  }
  // Illustrative rationing setting: the crew can stand in for a control kit when a
  // crew-wide shift of this size or smaller is detectable in a single round of draws.
  var CREW_COVER_PCT = 5;

  return { DRAWS: DRAWS, PRE: PRE, POST: POST, CREW: CREW, QC: QC, parseCSV: parseCSV, build: build, checkRowConsistency: checkRowConsistency,
    pooledSD: pooledSD, usable: usable, band: band, cell: cell, summarize: summarize, falseFlags: falseFlags,
    crewWide: crewWide, crewWideChance: crewWideChance, robustness: robustness,
    tcrit: tcrit, pooledDF: pooledDF, kFor: kFor, tcell: tcell, summarizeT: summarizeT, falseFlagsT: falseFlagsT,
    crewShift: crewShift, crewShiftFalseAlarms: crewShiftFalseAlarms, sourceCheck: sourceCheck, addDraw: addDraw, baselineComovement: baselineComovement,
    detectionLimits: detectionLimits, familyOf: familyOf, FAMILY: FAMILY, CREW_COVER_PCT: CREW_COVER_PCT, DRAW_DAY: DRAW_DAY };
});
