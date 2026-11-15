/* Quorum input formats: lab results as HL7 v2 messages (ORU^R01, what analyzers and their data managers send)
   and wearable data as an Apple Health export. Pure functions, usable in the browser and in Node tests. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.QuorumFormats = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // LOINC code -> Quorum marker key.
  var LOINC = { '6690-2': 'white_blood_cell_count', '789-8': 'red_blood_cell_count', '718-7': 'hemoglobin', '4544-3': 'hematocrit', '787-2': 'mcv', '785-6': 'mch', '786-4': 'mchc', '788-0': 'rdw',
    '777-3': 'platelet_count', '32623-1': 'mpv', '770-8': 'neutrophils', '736-9': 'lymphocytes', '5905-5': 'monocytes', '713-8': 'eosinophils', '706-2': 'basophils',
    '751-8': 'absolute_neutrophils', '731-0': 'absolute_lymphocytes', '742-7': 'absolute_monocytes', '711-2': 'absolute_eosinophils', '704-7': 'absolute_basophils',
    '2951-2': 'sodium', '2823-3': 'potassium', '2075-0': 'chloride', '2028-9': 'carbon_dioxide', '1963-8': 'carbon_dioxide', '2345-7': 'glucose', '3094-0': 'urea_nitrogen_bun', '2160-0': 'creatinine',
    '17861-6': 'calcium', '2885-2': 'total_protein', '1751-7': 'albumin', '10834-0': 'globulin', '1759-0': 'albumin_to_globulin_ratio', '1975-2': 'total_bilirubin', '6768-6': 'alkaline_phosphatase', '1920-8': 'ast', '1742-6': 'alt' };
  var NAMES = { wbc: 'white_blood_cell_count', rbc: 'red_blood_cell_count', hgb: 'hemoglobin', hb: 'hemoglobin', hct: 'hematocrit', plt: 'platelet_count', platelets: 'platelet_count', na: 'sodium', k: 'potassium', cl: 'chloride',
    co2: 'carbon_dioxide', tco2: 'carbon_dioxide', bicarbonate: 'carbon_dioxide', glu: 'glucose', bun: 'urea_nitrogen_bun', urea_nitrogen: 'urea_nitrogen_bun', crea: 'creatinine', ca: 'calcium', alp: 'alkaline_phosphatase',
    bilirubin_total: 'total_bilirubin', protein_total: 'total_protein', a_g_ratio: 'albumin_to_globulin_ratio' };
  var norm = function (x) { return String(x == null ? '' : x).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); };
  var unitKind = function (u) { u = String(u || '').toLowerCase().replace(/[µμ]/g, 'u').replace(/\s/g, '').replace(/³/g, '3').replace(/⁶/g, '6').replace(/⁹/g, '9').replace(/\*\*|\^|\*/g, '').replace(/×/g, 'x');
    if (/^(103|10e3|x103|x10e3|k|thou|thousand)\/?ul$/.test(u) || u === '109/l' || u === 'x109/l') return 'k/ul';
    if (/^(106|10e6|x106|x10e6|m|mil|million)\/?ul$/.test(u) || u === '1012/l' || u === 'x1012/l') return 'm/ul';
    if (u === 'cells/ul' || u === '/ul' || u === '/mm3' || u === 'cells/mm3') return 'cells/ul';
    return u; };

  // value in the incoming unit -> value in the unit Quorum expects for that marker, or null if it can't be converted safely.
  function convert(key, value, unit, expected) {
    var a = unitKind(unit), b = unitKind(expected);
    if (!a || a === b) return value;
    if (a === 'k/ul' && b === 'cells/ul') return value * 1000;
    if (a === 'cells/ul' && b === 'k/ul') return value / 1000;
    if (a === 'g/l' && b === 'g/dl') return value / 10;
    if (a === 'meq/l' && b === 'mmol/l' && /^(sodium|potassium|chloride|carbon_dioxide)$/.test(key)) return value;
    if (a === 'mmol/l' && b === 'mg/dl' && key === 'glucose') return value * 18.016;
    if (a === 'iu/l' && b === 'u/l') return value;
    if (!b) return value;
    return null;
  }

  // HL7 v2 result message(s). Returns { patients: [{ id, name, time, obs: [{ key, code, label, value, unit }] }], skipped: [...] }.
  function parseHL7(text) {
    var segs = String(text || '').replace(/^﻿/, '').split(/\r\n|\r|\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!segs.length || segs[0].slice(0, 3) !== 'MSH') return { error: 'This is not an HL7 message: it should start with MSH.' };
    var fs = segs[0].charAt(3) || '|', cs = segs[0].charAt(4) || '^';
    var out = { patients: [], skipped: [] }, cur = null;
    segs.forEach(function (line) {
      var f = line.split(fs), id = f[0];
      if (id === 'PID') { var nm = (f[5] || '').split(cs).filter(Boolean); cur = { id: ((f[3] || '').split(cs)[0] || '').trim(), name: nm.slice(0, 2).reverse().join(' ').trim(), time: '', obs: [] }; out.patients.push(cur); }
      else if (id === 'OBR' && cur) { if (f[7]) cur.time = f[7]; }
      else if (id === 'OBX') {
        if (!cur) { cur = { id: '', name: '', time: '', obs: [] }; out.patients.push(cur); }
        var c = (f[3] || '').split(cs), code = (c[0] || '').trim(), label = (c[1] || code).trim(), raw = (f[5] || '').split(cs).pop().trim(), unit = ((f[6] || '').split(cs)[0] || '').trim();
        var key = LOINC[code] || NAMES[norm(label)] || NAMES[norm(code)] || null, val = Number(raw.replace(/^[<>]=?/, ''));
        if (f[2] && f[2] !== 'NM' && f[2] !== 'SN') { out.skipped.push({ label: label, why: 'not a number' }); return; }
        if (raw === '' || !isFinite(val) || /^[<>]/.test(raw)) { out.skipped.push({ label: label, why: raw === '' ? 'empty' : 'not an exact number (' + raw + ')' }); return; }
        if (f[11] && /^(X|D|W)$/.test(f[11].trim())) { out.skipped.push({ label: label, why: 'marked cancelled or wrong by the analyzer' }); return; }
        cur.obs.push({ key: key, code: code, label: label, value: val, unit: unit });
      }
    });
    if (!out.patients.some(function (p) { return p.obs.length; })) return { error: 'No numeric results (OBX lines) found in this message.' };
    return out;
  }

  /* Apple Health export (export.xml). Feed text chunks to scan(); call days() at the end.
     One row per calendar day: sleep hours, resting heart rate, oxygen, temperature, blood pressure, glucose, mass, exercise, fluid. */
  function appleHealth() {
    var D = {}, tail = '', seen = 0;
    var T = { HKQuantityTypeIdentifierRestingHeartRate: 'hr', HKQuantityTypeIdentifierOxygenSaturation: 'spo2', HKQuantityTypeIdentifierBodyTemperature: 'temp', HKQuantityTypeIdentifierBloodPressureSystolic: 'bps',
      HKQuantityTypeIdentifierBloodPressureDiastolic: 'bpd', HKQuantityTypeIdentifierBloodGlucose: 'glu', HKQuantityTypeIdentifierBodyMass: 'kg', HKQuantityTypeIdentifierAppleExerciseTime: 'ex', HKQuantityTypeIdentifierDietaryWater: 'fluid' };
    var SUM = { ex: 1, fluid: 1 };
    var attr = function (tag, n) { var m = tag.match(new RegExp('\\s' + n + '="([^"]*)"')); return m ? m[1] : null; };
    var when = function (s) { var m = /^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d):(\d\d)\s*([+-]\d\d):?(\d\d)?/.exec(s || ''); if (!m) return null;
      return { day: m[1] + '-' + m[2] + '-' + m[3], ms: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - (parseInt(m[7], 10) * 60 + (m[7].charAt(0) === '-' ? -1 : 1) * (+m[8] || 0)) * 60000 }; };
    var day = function (d) { return D[d] || (D[d] = { sleep: 0, n: {}, s: {} }); };
    function rec(tag) {
      var type = attr(tag, 'type'); if (!type) return;
      if (type === 'HKCategoryTypeIdentifierSleepAnalysis') {
        var v = attr(tag, 'value') || ''; if (!/Asleep/.test(v)) return;
        var a = when(attr(tag, 'startDate')), b = when(attr(tag, 'endDate')); if (!a || !b || b.ms <= a.ms || b.ms - a.ms > 20 * 3600000) return;
        day(b.day).sleep += (b.ms - a.ms) / 3600000; seen++; return;
      }
      var k = T[type]; if (!k) return;
      var x = parseFloat(attr(tag, 'value')), u = (attr(tag, 'unit') || '').toLowerCase(), e = when(attr(tag, 'endDate') || attr(tag, 'startDate')); if (!e || !isFinite(x)) return;
      if (k === 'spo2' && x <= 1.5) x *= 100;
      if (k === 'temp' && (u === 'degf' || x > 60)) x = (x - 32) * 5 / 9;
      if (k === 'kg' && u === 'lb') x *= 0.45359237;
      if (k === 'glu' && u.indexOf('mmol') === 0) x *= 18.016;
      if (k === 'fluid') x = u === 'ml' ? x / 1000 : u === 'fl_oz_us' ? x * 0.0295735 : u === 'cup_us' ? x * 0.2365882 : x;
      var d = day(e.day); d.s[k] = (d.s[k] || 0) + x; d.n[k] = (d.n[k] || 0) + 1; seen++;
    }
    return {
      scan: function (chunk) { var buf = tail + chunk, re = /<Record\s[^>]*>/g, m, last = 0; while ((m = re.exec(buf))) { rec(m[0]); last = re.lastIndex; }
        var cut = buf.lastIndexOf('<Record', buf.length - 1); tail = cut >= last ? buf.slice(cut) : buf.slice(Math.max(last, buf.length - 16)); if (tail.length > 65536) tail = ''; },
      days: function () { return Object.keys(D).sort().map(function (d) { var o = { date: d }, x = D[d]; if (x.sleep > 0) o.sleep = +Math.min(24, x.sleep).toFixed(2);
        for (var k in x.s) o[k] = +(SUM[k] ? x.s[k] : x.s[k] / x.n[k]).toFixed(k === 'kg' || k === 'temp' || k === 'fluid' ? 2 : 1); return o; }); },
      count: function () { return seen; }
    };
  }
  // Days -> the CSV shape the app already imports.
  function daysToCSV(days) {
    var cols = [['hr', 'heart_rate'], ['bps', 'systolic'], ['bpd', 'diastolic'], ['spo2', 'spo2'], ['temp', 'temperature'], ['glu', 'glucose'], ['sleep', 'sleep_hours'], ['ex', 'exercise_min'], ['fluid', 'fluid_l'], ['kg', 'body_mass']]
      .filter(function (c) { return days.some(function (d) { return d[c[0]] != null; }); });
    return ['date'].concat(cols.map(function (c) { return c[1]; })).join(',') + '\n' + days.map(function (d) { return [d.date].concat(cols.map(function (c) { return d[c[0]] == null ? '' : d[c[0]]; })).join(','); }).join('\n');
  }
  return { LOINC: LOINC, parseHL7: parseHL7, convert: convert, unitKind: unitKind, appleHealth: appleHealth, daysToCSV: daysToCSV };
});
