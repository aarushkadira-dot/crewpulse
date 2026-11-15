// Reproduces the numbers published in the Quorum methods note from NASA's original files.
// Run: node test/test.js
const fs = require('fs');
const path = require('path');
const A = require('../js/analysis.js');

const dir = path.join(__dirname, '..', 'data');
const ds = A.build(
  fs.readFileSync(path.join(dir, 'LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv'), 'utf8'),
  fs.readFileSync(path.join(dir, 'LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv'), 'utf8')
);

let failed = 0;
function eq(label, got, want) {
  const ok = typeof want === 'number' ? Math.abs(got - want) < 1e-9 || (Number.isInteger(want) ? got === want : Math.abs(got - want) < 0.05) : JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(got)}${ok ? '' : `  (expected ${JSON.stringify(want)})`}`);
  if (!ok) failed++;
}

eq('values read (CBC 560 + CMP 532 incl. markers without usable ranges)', ds.valueCount > 1000, true);
eq('QC rows excluded', ds.qc.length, 1);
eq('QC values removed (MCH already blank in source)', ds.qc[0].removed.length, 9);
eq('QC evidence found', ds.qc[0].evidence.length > 0, true);

const s = A.summarize(ds);
eq('usable markers', s.markers, 36);
eq('CBC markers', s.cbc, 20);
eq('CMP markers', s.cmp, 16);
eq('R+1', s.byDraw['R+1'], { n: 143, lab: 5, personal: 12, personalOnly: 11, labOnly: 4, both: 1 });
eq('R+45', s.byDraw['R+45'], { n: 142, lab: 6, personal: 15, personalOnly: 10, labOnly: 1, both: 5 });
eq('R+82', s.byDraw['R+82'], { n: 143, lab: 2, personal: 16, personalOnly: 15, labOnly: 1, both: 1 });
eq('R+194', s.byDraw['R+194'], { n: 142, lab: 5, personal: 14, personalOnly: 11, labOnly: 2, both: 3 });

const f = A.falseFlags(ds);
eq('false flags', [f.flags, f.tests, f.labFlags], [25, 396, 15]);
eq('false-flag rate %', +(f.rate * 100).toFixed(1), 6.3);
eq('lab rate %', +(f.labRate * 100).toFixed(1), 3.8);

const mcv = ds.markers.find(m => m.key === 'mcv');
const d = A.CREW.map((_, c) => +A.cell(mcv, c, 3).d.toFixed(1));
eq('MCV drift at R+1', d, [-2.8, -4.0, -2.6, -2.5]);
const cw = A.crewWide(ds, 3);
eq('crew-wide markers at R+1', cw.map(x => x.marker.key), ['mcv']);
const ch = A.crewWideChance(f.rate, 4, s.markers);
eq('chance, any of 36 markers (1 in N)', Math.round(1 / ch.anyMarker / 1000), 14);

const rb = A.robustness(ds);
eq('robustness flags', rb.map(r => r.flags), [19, 12, 4, 15, 23]);
eq('robustness MCV crew', rb.map(r => r.mcvCrew), [4, 4, 3, 4, 4]);
eq('robustness false-flag %', rb.slice(0, 3).map(r => +(r.rate * 100).toFixed(1)), [11.4, 6.3, 0.3]);


// ---- Crew-based quality control (source check) ----
eq('t threshold for 8 degrees of freedom', A.tcrit(8), 2.306);
eq('MCV pooled degrees of freedom', A.pooledDF(mcv), 8);
const st = A.summarizeT(ds);
eq('R+1 with t threshold', st.byDraw['R+1'], { n: 143, lab: 5, personal: 7, personalOnly: 7, labOnly: 5, both: 0 });
const ft = A.falseFlagsT(ds);
eq('false flags with t threshold', [ft.flags, ft.tests], [6, 396]);
eq('MCV drift at R+1 all beyond 2.306', A.CREW.every((_, c) => A.tcell(mcv, c, 3).d < -2.306), true);
const cs = A.crewShift(mcv, 3);
eq('MCV crew shift at R+1 (z, %)', [+cs.z.toFixed(1), +cs.pct.toFixed(1), cs.flagged, cs.alarm], [-6.0, -3.9, 4, true]);
const cfa = A.crewShiftFalseAlarms(ds);
eq('crew-shift alarms on healthy preflight draws', [cfa.signals, cfa.alarms, cfa.tests], [3, 0, 102]);
eq('MCV rose at every preflight draw in all four crew', A.baselineComovement(mcv), { n: 4, up: 4, down: 0, all: true, direction: 1 });
const sc = [3, 4, 5, 6].map(t => A.sourceCheck(ds, t));
eq('R+1 alarms', sc[0].alarms.map(s => s.key + ':' + s.cause), ['mcv:instrument']);
eq('R+1 trust counts', sc[0].counts, { trusted: 136, retake: 3, hold: 4, shared: 0, person: 0, total: 143 });
eq('R+45 alarms', sc[1].alarms.map(s => s.key + ':' + s.cause), ['potassium:handling', 'mcv:instrument', 'glucose:handling']);
eq('R+45 handling pair (potassium %, glucose %)', ['potassium', 'glucose'].map(k => +sc[1].alarms.find(s => s.key === k).shift.pct.toFixed(1)), [17.9, -31.7]);
eq('R+82 MCV alarm carried', sc[2].alarms.filter(s => s.key === 'mcv').map(s => s.carried), [true]);
eq('R+194 MCV', sc[3].alarms.filter(s => s.key === 'mcv').map(s => [s.cause, s.shift.flagged, s.shift.n, +s.shift.pct.toFixed(1)]), [['instrument', 3, 3, -4.6]]);
const dl = A.detectionLimits(ds);
eq('detection limits, tightest three', dl.slice(0, 3).map(x => [x.key, +x.detect.toFixed(1)]), [['sodium', 1.2], ['mcv', 1.5], ['chloride', 1.8]]);
eq('markers the crew can cover', dl.filter(x => x.crewCovers).length, 9);
eq('glucose and white cells need a control kit', ['glucose', 'white_blood_cell_count'].map(k => dl.find(x => x.key === k).crewCovers), [false, false]);

// A draw added on board: the same check runs on it, and the NASA draws are left untouched.
const mcvM = ds.markers.find(m => m.key === 'mcv');
const preMean = c => (mcvM.vals[c][0] + mcvM.vals[c][1] + mcvM.vals[c][2]) / 3;
const tBack = A.addDraw(ds, { label: 'R+230', day: 230, vals: { mcv: [0, 1, 2, 3].map(c => +preMean(c).toFixed(1)) } });
const back = A.sourceCheck(ds, tBack);
eq('added retake at baseline: no alarm, 4 of 4 trusted', [back.alarms.length, back.counts.trusted, back.counts.total], [0, 4, 4]);
const tLow = A.addDraw(ds, { label: 'R+260', day: 260, vals: { mcv: [0, 1, 2, 3].map(c => +(preMean(c) * 0.96).toFixed(1)) } });
const low = A.sourceCheck(ds, tLow);
eq('added draw 4% low: instrument alarm, all on hold', [low.alarms.map(s => s.key + ':' + s.cause), low.counts.hold], [['mcv:instrument'], 4]);
eq('added draw remembers earlier shifts', low.alarms[0].evidence.find(e => e.id === 'recur').hit, true);
eq('NASA draws unchanged after adding', A.sourceCheck(ds, 3).counts, sc[0].counts);

// Mission event log: an event only counts when the shift is new, and never changes the NASA results.
const cbc = fs.readFileSync(path.join(dir, 'LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv'), 'utf8'), cmp = fs.readFileSync(path.join(dir, 'LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv'), 'utf8');
const ds2 = A.build(cbc, cmp);
const naM = ds2.markers.find(m => m.key === 'sodium'), clM = ds2.markers.find(m => m.key === 'chloride');
const pm = (m, c) => { const p = [0, 1, 2].map(i => m.vals[c][i]).filter(x => x != null); return p.reduce((a, b) => a + b, 0) / p.length; };
const up = (m, f) => [0, 1, 2, 3].map(c => +(pm(m, c) * f).toFixed(1));
const tE = A.addDraw(ds2, { label: 'R+230', day: 230, vals: { sodium: up(naM, 1.04), chloride: up(clM, 1.04) } });
const noLog = A.sourceCheck(ds2, tE).alarms.find(s => s.key === 'sodium');
eq('no event log: no event evidence', noLog.evidence.some(e => e.id === 'event'), false);
ds2.events = [{ day: 227, kind: 'environment', label: 'Water filter swapped' }];
const withEnv = A.sourceCheck(ds2, tE).alarms.find(s => s.key === 'sodium');
eq('water event 3 days before a new shift: environment', [withEnv.cause, withEnv.event.label, withEnv.evidence.find(e => e.id === 'event').hit], ['environment', 'Water filter swapped', true]);
ds2.events = [{ day: 100, kind: 'environment', label: 'Old event' }];
eq('event outside the window is ignored', A.sourceCheck(ds2, tE).alarms.find(s => s.key === 'sodium').evidence.find(e => e.id === 'event').hit, false);
ds2.events = [{ day: 190, kind: 'environment', label: 'Late event' }];
const mcvOld = A.sourceCheck(ds2, 6).alarms.find(s => s.key === 'mcv');
eq('event cannot explain a shift seen earlier', [mcvOld.evidence.find(e => e.id === 'event').hit, mcvOld.cause], [false, 'instrument']);
eq('NASA R+1 counts unchanged with an event log', A.sourceCheck(ds2, 3).counts, sc[0].counts);

// Crew member who joined on board: typical range first, own baseline after three draws.
const ds3 = A.build(cbc, cmp);
const j = A.addCrew(ds3, 'New');
const mc = ds3.markers.find(m => m.key === 'mcv');
const row = v => ({ mcv: [null, null, null, null, v] });
const t1 = A.addDraw(ds3, { label: 'R+230', day: 230, vals: row(88) });
const r1 = A.sourceCheck(ds3, t1).results.find(r => r.crew === j);
eq('joined crew, draw 1: typical range, trusted', [r1.status, r1.cell.population, r1.cell.own], ['trusted', true, 1]);
const t2 = A.addDraw(ds3, { label: 'R+240', day: 240, vals: row(150) });
eq('joined crew, out of typical range: retake', A.sourceCheck(ds3, t2).results.find(r => r.crew === j).status, 'retake');
A.addDraw(ds3, { label: 'R+250', day: 250, vals: row(88.4) });
A.addDraw(ds3, { label: 'R+260', day: 260, vals: row(87.6) });
const t5 = A.addDraw(ds3, { label: 'R+270', day: 270, vals: row(80) });
const r5 = A.sourceCheck(ds3, t5).results.find(r => r.crew === j);
eq('joined crew, after three draws: judged against own baseline', [!!r5.cell.joined, r5.cell.personal, r5.cell.lab], [true, true, false]);
eq('joined crew does not change the original crew', A.sourceCheck(ds3, 3).counts, sc[0].counts);

console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed: results match the methods note.');
process.exit(failed ? 1 : 0);
