// Simulation check of the source check. Synthetic crews are drawn from the real Inspiration4
// preflight statistics (each marker's personal means and pooled within-person SD), a known cause
// is injected, and we count how often the source check names it. Seeded, so the output is reproducible.
// Run: node test/validate.js            (prints a summary)
//      node test/validate.js --write    (also rewrites data/validation.json)
'use strict';
const fs = require('fs'), path = require('path');
const A = require('../js/analysis.js');
const dir = path.join(__dirname, '..', 'data');
const real = A.build(fs.readFileSync(path.join(dir, 'LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv'), 'utf8'),
  fs.readFileSync(path.join(dir, 'LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv'), 'utf8'));
const TRIALS = 2000;

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function normal(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// Per-marker facts taken from the real data.
const M = real.markers.filter(m => A.usable(m)).map(m => {
  const means = [], decs = [];
  m.vals.forEach(row => { const p = [0, 1, 2].map(i => row[i]).filter(x => x != null); if (p.length >= 2) means.push(p.reduce((a, b) => a + b, 0) / p.length); row.forEach(v => { if (v != null) decs.push((String(v).split('.')[1] || '').length); }); });
  let lo = null, hi = null; m.lo.forEach(r => r.forEach(x => { if (x != null && lo == null) lo = x; })); m.hi.forEach(r => r.forEach(x => { if (x != null && hi == null) hi = x; }));
  return { key: m.key, name: m.name, panel: m.panel, unit: m.unit, sd: A.pooledSD(m), means, dp: Math.max.apply(null, decs), lo, hi };
});
const round = (x, dp) => { const f = Math.pow(10, dp); return Math.max(0, Math.round(x * f) / f); };

// One synthetic crew: 3 baseline draws and 2 later draws. inject(key, crewIndex, drawIndex) returns a multiplier.
function crew(r, n, inject) {
  const draws = ['L-92', 'L-44', 'L-3', 'R+1', 'R+45'];
  const markers = M.map(m => {
    const vals = [], lo = [], hi = [];
    for (let c = 0; c < n; c++) {
      const mu = m.means[Math.floor(r() * m.means.length)];
      vals.push(draws.map((_, t) => round((mu + m.sd * normal(r)) * (t >= 3 ? inject(m.key, c, t) : 1), m.dp)));
      lo.push(draws.map(() => m.lo)); hi.push(draws.map(() => m.hi));
    }
    return { panel: m.panel, key: m.key, name: m.name, unit: m.unit, vals, lo, hi };
  });
  return { draws, crew: Array.from({ length: n }, (_, i) => 'S' + i), markers, post: [3, 4] };
}
const pct = (a, b) => b ? +(100 * a / b).toFixed(1) : null;
const out = { trials: TRIALS, markers: M.length, note: 'Synthetic crews drawn from Inspiration4 preflight statistics. Not new astronaut data.', nullCase: [], instrument: [], environment: [], handling: [], person: [] };

[3, 4, 6].forEach((n, ni) => {
  // 1. Nothing changed.
  let r = rng(1000 + ni), anyAlarm = 0, hold = 0, results = 0, flagged = 0, alarms = 0;
  for (let i = 0; i < TRIALS; i++) {
    const sc = A.sourceCheck(crew(r, n, () => 1), 3);
    if (sc.alarms.length) anyAlarm++; alarms += sc.alarms.length; hold += sc.counts.hold + sc.counts.shared; results += sc.counts.total;
    flagged += sc.counts.retake + sc.counts.person;
  }
  out.nullCase.push({ crew: n, anyAlarmPct: pct(anyAlarm, TRIALS), alarmsPerDraw: +(alarms / TRIALS).toFixed(3), heldPct: pct(hold, results), singleFlagPct: pct(flagged, results) });

  // 2. Instrument offset on one marker, present at both later draws.
  ['mcv', 'sodium', 'creatinine', 'glucose'].forEach((key, ki) => {
    [1, 2, 3, 5, 10].forEach((d, di) => {
      r = rng(2000 + ni * 100 + ki * 10 + di); let det = 0, det2 = 0, inst = 0;
      for (let i = 0; i < TRIALS; i++) {
        const ds = crew(r, n, k => k === key ? 1 - d / 100 : 1);
        if (A.sourceCheck(ds, 3).alarms.some(s => s.key === key)) det++;
        const a2 = A.sourceCheck(ds, 4).alarms.find(s => s.key === key);
        if (a2) { det2++; if (a2.cause === 'instrument') inst++; }
      }
      out.instrument.push({ crew: n, marker: key, shiftPct: d, detectedFirstDrawPct: pct(det, TRIALS), detectedSecondDrawPct: pct(det2, TRIALS), namedInstrumentPct: pct(inst, det2) });
    });
  });

  // 3. Shared environment: two related electrolytes move together at the first later draw.
  [2, 3, 5].forEach((d, di) => {
    r = rng(3000 + ni * 10 + di); let det = 0, env = 0, inst = 0;
    for (let i = 0; i < TRIALS; i++) {
      const a = A.sourceCheck(crew(r, n, (k, c, t) => (k === 'sodium' || k === 'chloride') && t === 3 ? 1 + d / 100 : 1), 3).alarms.find(s => s.key === 'sodium');
      if (a) { det++; if (a.cause === 'environment') env++; if (a.cause === 'instrument') inst++; }
    }
    out.environment.push({ crew: n, shiftPct: d, detectedPct: pct(det, TRIALS), namedEnvironmentPct: pct(env, det), namedInstrumentPct: pct(inst, det) });
  });

  // 4. Delayed sample: potassium up, glucose down.
  [[10, 15], [15, 25], [18, 32]].forEach((d, di) => {
    r = rng(4000 + ni * 10 + di); let det = 0, hand = 0;
    for (let i = 0; i < TRIALS; i++) {
      const al = A.sourceCheck(crew(r, n, (k, c, t) => t !== 3 ? 1 : k === 'potassium' ? 1 + d[0] / 100 : k === 'glucose' ? 1 - d[1] / 100 : 1), 3).alarms.filter(s => s.key === 'potassium' || s.key === 'glucose');
      if (al.length) { det++; if (al.every(s => s.cause === 'handling')) hand++; }
    }
    out.handling.push({ crew: n, potassiumUpPct: d[0], glucoseDownPct: d[1], detectedPct: pct(det, TRIALS), namedHandlingPct: pct(hand, det) });
  });

  // 5. One person really changes (MCV), at both later draws. It must not be blamed on the instrument.
  [3, 5].forEach((d, di) => {
    r = rng(5000 + ni * 10 + di); let crewAlarm = 0, first = 0, second = 0;
    for (let i = 0; i < TRIALS; i++) {
      const ds = crew(r, n, (k, c) => k === 'mcv' && c === 0 ? 1 - d / 100 : 1);
      const s1 = A.sourceCheck(ds, 3), s2 = A.sourceCheck(ds, 4);
      if (s1.alarms.some(s => s.key === 'mcv')) crewAlarm++;
      const r1 = s1.results.find(x => x.key === 'mcv' && x.crew === 0), r2 = s2.results.find(x => x.key === 'mcv' && x.crew === 0);
      if (r1 && (r1.status === 'retake' || r1.status === 'person')) first++;
      if (r2 && r2.status === 'person') second++;
    }
    out.person.push({ crew: n, shiftPct: d, blamedOnCrewPct: pct(crewAlarm, TRIALS), flaggedFirstDrawPct: pct(first, TRIALS), confirmedSecondDrawPct: pct(second, TRIALS) });
  });
});

if (process.argv.includes('--write')) fs.writeFileSync(path.join(dir, 'validation.json'), JSON.stringify(out, null, 1));
if (require.main === module) {
  console.log('null', JSON.stringify(out.nullCase));
  console.log('instrument (crew 4)', out.instrument.filter(x => x.crew === 4).map(x => [x.marker, x.shiftPct, x.detectedFirstDrawPct, x.namedInstrumentPct].join(':')).join('  '));
  console.log('environment', JSON.stringify(out.environment.filter(x => x.crew === 4)));
  console.log('handling', JSON.stringify(out.handling.filter(x => x.crew === 4)));
  console.log('person', JSON.stringify(out.person));
}
module.exports = out;
