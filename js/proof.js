/* Proof page: every number is computed here from NASA's original files via analysis.js. */
(function () {
  'use strict';
  var A = window.CrewPulseAnalysis;
  var $ = function (id) { return document.getElementById(id); };
  var CBC = 'data/LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv';
  var CMP = 'data/LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv';
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (v, dp) { return v == null ? '-' : (+v).toFixed(dp == null ? 1 : dp); };
  var dec = function (m) { var all = []; m.vals.forEach(function (r) { r.forEach(function (v) { if (v != null) all.push(v); }); }); var d = 0; all.forEach(function (v) { var s = String(v).split('.')[1]; if (s && s.length > d) d = s.length; }); return Math.min(d, 2); };
  var CREWN = ['Crew 1', 'Crew 2', 'Crew 3', 'Crew 4'];
  var ds, sel = { c: 1, m: null };

  // A time-series chart for one marker and one crew member.
  function seriesChart(m, c, o) {
    o = o || {};
    var W = o.w || 720, H = o.h || 280, L = o.mini ? 10 : 56, R = o.mini ? 10 : 24, T = o.mini ? 12 : 20, B = o.mini ? 26 : 40;
    var v = m.vals[c], b = A.band(m, c, { k: A.kFor(m) }), lo = Infinity, hi = -Infinity;
    m.lo[c].forEach(function (x) { if (x != null) lo = Math.min(lo, x); });
    m.hi[c].forEach(function (x) { if (x != null) hi = Math.max(hi, x); });
    var all = v.filter(function (x) { return x != null; });
    if (!o.zoom) all = all.concat([lo, hi]);
    if (b) all.push(b.mean - b.half, b.mean + b.half);
    var y0 = Math.min.apply(null, all), y1 = Math.max.apply(null, all), pad = (y1 - y0) * (o.zoom ? 0.18 : 0.08) || 1; y0 -= pad; y1 += pad;
    var clip = function (y) { return Math.max(y0, Math.min(y1, y)); };
    var X = function (i) { return L + (i + (i >= 3 ? 0.7 : 0)) * (W - L - R) / 6.7; };
    var Y = function (y) { return T + (1 - (y - y0) / (y1 - y0)) * (H - T - B); };
    var fx = (X(2) + X(3)) / 2, s = '';
    s += '<rect class="c-lab" x="' + L + '" y="' + Y(clip(hi)) + '" width="' + (W - L - R) + '" height="' + (Y(clip(lo)) - Y(clip(hi))) + '"/>';
    if (hi <= y1) s += '<line class="c-labline" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(hi) + '" y2="' + Y(hi) + '"/>';
    if (lo >= y0) s += '<line class="c-labline" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(lo) + '" y2="' + Y(lo) + '"/>';
    if (b) s += '<rect class="c-band" x="' + L + '" y="' + Y(b.mean + b.half) + '" width="' + (W - L - R) + '" height="' + (Y(b.mean - b.half) - Y(b.mean + b.half)) + '"/><line class="c-mean" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(b.mean) + '" y2="' + Y(b.mean) + '"/>';
    s += '<rect class="c-flight" x="' + (fx - 7) + '" y="' + T + '" width="14" height="' + (H - T - B) + '"/>';
    if (!o.mini) s += '<text x="' + (fx + 12) + '" y="' + (T + 14) + '">3 days in orbit</text>';
    var pts = []; v.forEach(function (y, i) { if (y != null) pts.push([X(i), Y(y), y, i]); });
    s += '<path class="c-line" d="' + pts.map(function (p, k) { return (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('') + '"/>';
    pts.forEach(function (p) {
      var x = p[3] >= 3 ? A.tcell(m, c, p[3]) : null, cls = p[3] < 3 ? 'c-pre' : (x && x.personal ? 'c-hit' : 'c-post');
      s += '<circle class="' + cls + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="' + (o.mini ? (cls === 'c-hit' ? 4 : 3.5) : (cls === 'c-hit' ? 5.5 : 4.5)) + '"><title>' + A.DRAWS[p[3]] + ': ' + p[2] + ' ' + esc(m.unit) + (x ? (x.personal ? ' · outside personal normal' : ' · inside personal normal') : ' · preflight') + '</title></circle>';
    });
    if (!o.mini) {
      s += '<text x="' + (L - 8) + '" y="' + (Y(hi) + 4) + '" text-anchor="end">' + hi + '</text><text x="' + (L - 8) + '" y="' + (Y(lo) + 4) + '" text-anchor="end">' + lo + '</text>';
      A.DRAWS.forEach(function (d, i) { s += '<text x="' + X(i) + '" y="' + (H - 12) + '" text-anchor="middle">' + d + '</text>'; });
    } else {
      s += '<text class="t-ink" x="' + L + '" y="' + (H - 7) + '">' + CREWN[c] + '</text>';
      if (o.zoom && lo < y0 && hi > y1) s += '<text x="' + (L + 4) + '" y="' + (T + 10) + '">Whole view is inside the lab range, ' + lo + '-' + hi + '</text>';
      var r1 = A.tcell(m, c, 3); if (r1) s += '<text x="' + (W - R) + '" y="' + (H - 7) + '" text-anchor="end">d = ' + r1.d.toFixed(1) + '</text>';
    }
    var label = m.name + ', ' + CREWN[c] + ': lab range ' + lo + ' to ' + hi + ' ' + m.unit + (b ? ', personal normal ' + fmt(b.mean - b.half) + ' to ' + fmt(b.mean + b.half) : '');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(label) + '">' + s + '</svg>';
  }

  // Flags per postflight draw: lab ranges vs personal baseline, with the chance level marked.
  function countChart(sum, ff) {
    var W = 720, H = 250, L = 40, R = 16, T = 22, B = 38, draws = ['R+1', 'R+45', 'R+82', 'R+194'], top = 0;
    draws.forEach(function (d) { var o = sum.byDraw[d]; top = Math.max(top, o.lab, o.personal); });
    var max = Math.ceil((top + 1) / 4) * 4, gw = (W - L - R) / draws.length, bw = 24, Y = function (v) { return T + (1 - v / max) * (H - T - B); }, s = '';
    for (var g = 0; g <= max; g += 4) s += '<line class="' + (g ? 'c-grid' : 'c-axis') + '" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(g) + '" y2="' + Y(g) + '"/><text x="' + (L - 8) + '" y="' + (Y(g) + 4) + '" text-anchor="end">' + g + '</text>';
    var bar = function (x, v) { var t = Y(v), y0 = Y(0), r = Math.min(4, (y0 - t) / 2); return 'M' + x + ' ' + y0 + 'V' + (t + r) + 'Q' + x + ' ' + t + ' ' + (x + r) + ' ' + t + 'H' + (x + bw - r) + 'Q' + (x + bw) + ' ' + t + ' ' + (x + bw) + ' ' + (t + r) + 'V' + y0 + 'Z'; };
    draws.forEach(function (d, i) {
      var o = sum.byDraw[d], cx = L + i * gw + gw / 2;
      [['lab', o.lab, ff.labRate, cx - bw - 1], ['personal', o.personal, ff.rate, cx + 1]].forEach(function (q) {
        var ex = q[2] * o.n;
        s += '<path class="' + (q[0] === 'lab' ? 'c-bar-lab' : 'c-bar-me') + '" d="' + bar(q[3], q[1]) + '"><title>' + d + ': ' + q[1] + ' of ' + o.n + ' results flagged by ' + (q[0] === 'lab' ? 'lab ranges' : 'personal baseline') + '</title></path>';
        s += '<line class="c-exp" x1="' + (q[3] - 3) + '" x2="' + (q[3] + bw + 3) + '" y1="' + Y(ex) + '" y2="' + Y(ex) + '"><title>About ' + ex.toFixed(1) + ' expected by chance</title></line>';
        s += '<text class="t-ink" x="' + (q[3] + bw / 2) + '" y="' + (Y(Math.max(q[1], ex)) - 7) + '" text-anchor="middle">' + q[1] + '</text>';
      });
      s += '<text x="' + cx + '" y="' + (H - 12) + '" text-anchor="middle">' + d + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Flagged results per postflight draw, lab ranges versus personal baseline, with the chance level marked">' + s + '</svg>';
  }

  function renderExplorer() {
    var m = ds.markers[sel.m], c = sel.c;
    $('ex-crew').innerHTML = CREWN.map(function (n, k) { return '<button type="button" data-c="' + k + '" aria-pressed="' + (k === c) + '">' + n + '</button>'; }).join('');
    $('ex-chart').innerHTML = seriesChart(m, c);
    var b = A.band(m, c, { k: A.kFor(m) }), dp = dec(m);
    $('ex-band').textContent = b ? (CREWN[c] + '’s normal: ' + b.mean.toFixed(dp + 1) + ' ± ' + b.half.toFixed(dp + 1) + ' ' + m.unit + ', from ' + b.n + ' preflight draw' + (b.n > 1 ? 's' : '') + '.') : 'Not enough preflight data for this crew member.';
    $('ex-rows').innerHTML = A.POST.map(function (t) {
      var x = A.tcell(m, c, t);
      if (!x) return '<tr><td>' + A.DRAWS[t] + '</td><td colspan="3" class="small">No result in the file</td></tr>';
      return '<tr><td>' + A.DRAWS[t] + '</td><td class="n">' + x.value + ' ' + esc(m.unit) + '</td><td>' + (x.lab ? '<span class="tag out">Outside lab range</span>' : '<span class="tag ok">Normal</span>') + '</td><td>' +
        (x.personal ? '<span class="tag flag">d = ' + x.d.toFixed(1) + ' · outside own normal</span>' : '<span class="tag ok">d = ' + x.d.toFixed(1) + ' · own normal</span>') + '</td></tr>';
    }).join('');
  }

  function render() {
    var sum0 = A.summarize(ds), ff0 = A.falseFlags(ds), st = A.summarizeT(ds), ft = A.falseFlagsT(ds);
    var sum = { markers: sum0.markers, cbc: sum0.cbc, cmp: sum0.cmp, byDraw: st.byDraw }, ff = { flags: ft.flags, tests: ft.tests, rate: ft.rate, labRate: ff0.labRate }, r1 = sum.byDraw['R+1'];
    var mcv = ds.markers.filter(function (m) { return m.key === 'mcv'; })[0];
    var oneIn = function (p) { var n = 1 / p; return n >= 1000 ? Math.round(n / 1000).toLocaleString('en-US') + ',000' : Math.round(n).toLocaleString('en-US'); };
    var put = function (id, v) { var e = $(id); if (e) e.textContent = v; };
    put('n-markers', sum.markers); put('n-markers2', sum.markers); put('n-cbc', sum.cbc); put('n-cmp', sum.cmp); put('n-values', ds.valueCount.toLocaleString('en-US'));
    put('r1-n', r1.n); put('r1-lab', r1.lab); put('r1-me', r1.personal); put('r1-only', r1.personalOnly); put('r1-labonly', r1.labOnly); put('r1-exp', Math.round(ff.rate * r1.n));
    put('ff-n', ff.flags); put('ff-t', ff.tests); put('ff-r', (ff.rate * 100).toFixed(1) + '%'); put('ff-lab', (ff.labRate * 100).toFixed(1) + '%'); put('ff-r2', (ff.rate * 100).toFixed(1) + '%');
    // crew-wide mini charts + table
    $('mcv-minis').innerHTML = A.CREW.map(function (_, c) { return '<div class="card mini">' + seriesChart(mcv, c, { mini: true, zoom: true, w: 280, h: 170 }) + '</div>'; }).join('');
    $('mcv-rows').innerHTML = A.CREW.map(function (id, c) {
      var pre = A.PRE.map(function (t) { return mcv.vals[c][t]; }), x = A.tcell(mcv, c, 3);
      return '<tr><td>' + CREWN[c] + ' <span class="small">(' + id + ')</span></td><td class="n">' + pre.join(', ') + '</td><td class="n">' + x.value + '</td><td class="n">' + mcv.lo[c][3] + '-' + mcv.hi[c][3] + '</td><td class="n">' + x.d.toFixed(1) + '</td></tr>';
    }).join('');
    $('count-chart').innerHTML = countChart(sum, ff);
    // robustness
    var robT = { label: 'Student t limit, 2.306 for most markers (used in the app)', flags: r1.personal, n: r1.n, expected: ft.rate * r1.n, rate: ft.rate, mcvCrew: A.CREW.filter(function (_, c) { var x = A.tcell(mcv, c, 3); return x && x.personal && x.d < 0; }).length };
    $('rob-rows').innerHTML = [robT].concat(A.robustness(ds)).map(function (r) {
      return '<tr><td>' + esc(r.label) + '</td><td class="n">' + r.flags + ' of ' + r.n + '</td><td class="n">' + (r.expected == null ? 'not measured' : 'about ' + (r.expected < 1 ? r.expected.toFixed(1) : Math.round(r.expected))) + '</td><td class="n">' + (r.rate == null ? 'not measured' : (r.rate * 100).toFixed(1) + '%') + '</td><td class="n">' + r.mcvCrew + ' of 4</td></tr>';
    }).join('');

    // ---- source check ----
    var pct = function (v) { return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; };
    var sc = A.sourceCheck(ds, 3), top = sc.alarms[0], cfa = A.crewShiftFalseAlarms(ds);
    var CAUSE = { instrument: 'Instrument suspected', handling: 'Sample handling suspected', environment: 'Shared cause suspected', undetermined: 'Crew-wide shift, cause unclear' };
    if (top) {
      put('sc-verdict', CAUSE[top.cause]);
      $('sc-sum').innerHTML = esc(top.marker.name) + ': ' + top.shift.flagged + ' of ' + top.shift.n + ' crew below their own normal, crew average <b>' + pct(top.shift.pct) + '</b>. Evidence available at R+1:';
      $('sc-ev').innerHTML = top.evidence.map(function (e) { return '<li' + (e.hit ? '' : ' class="ev-no"') + '><b>' + esc(e.title) + (e.hit ? (e.points === 'environment' ? ' · points at the flight' : ' · points at the measurement') : ' · no evidence') + '.</b> ' + esc(e.text) + '</li>'; }).join('');
    }
    $('sc-recur').innerHTML = A.POST.map(function (t) { var s = A.crewShift(mcv, t); return '<tr><td>' + A.DRAWS[t] + ' <span class="small">(' + A.DRAW_DAY[A.DRAWS[t]] + (A.DRAW_DAY[A.DRAWS[t]] === 1 ? ' day' : ' days') + ' after landing)</span></td><td class="n">' + pct(s.pct) + '</td><td class="n">' + s.flagged + ' of ' + s.n + '</td></tr>'; }).join('');
    put('sc-trusted', sc.counts.trusted); put('sc-total', sc.counts.total); put('sc-hold', sc.counts.hold); put('sc-retake', sc.counts.retake);
    put('cfa-a', cfa.alarms); put('cfa-t', cfa.tests);
    // handling pair at R+45
    var glu = ds.markers.filter(function (m) { return m.key === 'glucose'; })[0], pot = ds.markers.filter(function (m) { return m.key === 'potassium'; })[0];
    $('hand-rows').innerHTML = A.CREW.map(function (id, c) {
      var g = A.tcell(glu, c, 4), k = A.tcell(pot, c, 4);
      var tag = function (x) { return x.lab ? ' <span class="tag out">Outside lab range</span>' : ''; };
      return '<tr><td>' + CREWN[c] + '</td><td class="n">' + g.band.mean.toFixed(0) + '</td><td class="n">' + g.value + tag(g) + '</td><td class="n">' + k.band.mean.toFixed(1) + '</td><td class="n">' + k.value + tag(k) + '</td></tr>';
    }).join('');
    put('hand-g', pct(A.crewShift(glu, 4).pct)); put('hand-k', pct(A.crewShift(pot, 4).pct));
    // detection limits
    var dl = A.detectionLimits(ds);
    put('dl-cov', dl.filter(function (d) { return d.crewCovers; }).length); put('dl-n', dl.length); put('dl-mcv', Math.abs(A.crewShift(mcv, 3).pct).toFixed(1));
    $('dl-rows').innerHTML = dl.map(function (d) { return '<tr><td>' + esc(d.name) + '</td><td class="n">' + d.cv.toFixed(1) + '%</td><td class="n">' + d.detect.toFixed(1) + '%</td><td>' + (d.crewCovers ? '<span class="tag ok">The crew</span>' : '<span class="tag flag">A control sample</span>') + '</td></tr>'; }).join('');
    // data check
    $('qc').innerHTML = ds.qc.map(function (q) {
      return '<p><b>' + q.crew + ', ' + q.draw + ' (' + q.panel + ').</b> ' + esc(q.reason) + ' The automatic consistency check found:</p><ul>' + q.evidence.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul><p class="small">Excluded ' + q.removed.length + ' values: ' + q.removed.map(function (r) { return esc(r.name) + ' (' + r.value + ')'; }).join(', ') + '.</p>';
    }).join('');
    // explorer select
    var opts = ds.markers.map(function (m, i) { return A.usable(m) ? '<option value="' + i + '"' + (i === sel.m ? ' selected' : '') + '>' + m.panel + ' · ' + esc(m.name) + '</option>' : ''; }).join('');
    $('ex-marker').innerHTML = opts;
    renderExplorer();
    document.body.classList.add('ready');
  }

  function init() {
    Promise.all([fetch(CBC).then(function (r) { if (!r.ok) throw new Error(CBC); return r.text(); }), fetch(CMP).then(function (r) { if (!r.ok) throw new Error(CMP); return r.text(); })])
      .then(function (t) {
        ds = A.build(t[0], t[1]);
        ds.markers.forEach(function (m, i) { if (m.key === 'mcv') sel.m = i; });
        render();
      })
      .catch(function (e) { var el = $('load-error'); el.hidden = false; el.textContent = 'Could not load NASA’s data files (' + e.message + '). Open this page from the website, not from a saved file.'; });
    document.addEventListener('click', function (e) { var b = e.target.closest('[data-c]'); if (b && ds) { sel.c = +b.dataset.c; renderExplorer(); var nb = document.querySelector('[data-c="' + sel.c + '"]'); if (nb) nb.focus(); } });
    document.addEventListener('change', function (e) { if (e.target.id === 'ex-marker' && ds) { sel.m = +e.target.value; renderExplorer(); } });
  }
  init();
})();

/* Contents rail: mark the section being read. */
/* Simulation section: numbers come from data/validation.json, written by test/validate.js. */
(function () {
  var box = document.getElementById('sim-tbl'); if (!box) return;
  fetch('data/validation.json').then(function (r) { if (!r.ok) throw new Error('validation.json'); return r.json(); }).then(function (v) {
    var f = function (arr, q) { return arr.filter(function (x) { for (var k in q) if (x[k] !== q[k]) return false; return true; })[0]; };
    var pc = function (x) { return x == null ? '–' : x + '%'; };
    var nul = f(v.nullCase, { crew: 4 }), n6 = f(v.nullCase, { crew: 6 });
    var rows = [['Nothing changed', 'False crew-wide alarm on at least one of 36 markers', pc(nul.anyAlarmPct), 'should be low']];
    [['mcv', 'red-cell size', 3], ['mcv', 'red-cell size', 5], ['sodium', 'sodium', 3], ['creatinine', 'creatinine', 10], ['glucose', 'glucose', 10]].forEach(function (q) {
      var x = f(v.instrument, { crew: 4, marker: q[0], shiftPct: q[2] });
      rows.push(['Instrument reads ' + q[1] + ' ' + q[2] + '% low', 'Caught at the first draw', pc(x.detectedFirstDrawPct), x.namedInstrumentPct == null ? '–' : 'named instrument ' + pc(x.namedInstrumentPct) + ' at the second draw']);
    });
    var e = f(v.environment, { crew: 4, shiftPct: 3 }), h = f(v.handling, { crew: 4, potassiumUpPct: 18 }), p5 = f(v.person, { crew: 4, shiftPct: 5 });
    rows.push(['Shared cause: sodium and chloride both 3% high', 'Caught', pc(e.detectedPct), 'named shared environment ' + pc(e.namedEnvironmentPct) + ', instrument ' + pc(e.namedInstrumentPct)]);
    rows.push(['Delayed sample: potassium +' + h.potassiumUpPct + '%, glucose −' + h.glucoseDownPct + '%', 'Caught', pc(h.detectedPct), 'named sample handling ' + pc(h.namedHandlingPct)]);
    rows.push(['One person’s red-cell size really falls 5%', 'Flagged for that person at the first draw', pc(p5.flaggedFirstDrawPct), 'wrongly blamed on the whole crew ' + pc(p5.blamedOnCrewPct)]);
    box.innerHTML = '<table><thead><tr><th>What we injected (crew of four)</th><th>Question</th><th>How often</th><th>Naming the cause</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td><b>' + r[2] + '</b></td><td>' + r[3] + '</td></tr>'; }).join('') + '</tbody></table>';
    document.getElementById('sim-n').textContent = v.trials.toLocaleString('en-US');
    var m5 = f(v.instrument, { crew: 4, marker: 'mcv', shiftPct: 5 });
    document.getElementById('sim-good').textContent = 'A 5% instrument error on a steady marker is caught ' + pc(m5.detectedFirstDrawPct) + ' of the time. A shared cause was not mistaken for the instrument (' + pc(e.namedInstrumentPct) + '). A real change in one person was blamed on the crew only ' + pc(p5.blamedOnCrewPct) + ' of the time. Noisy markers such as glucose and creatinine are mostly missed, which is why those need a control sample.';
    document.getElementById('sim-cost').textContent = 'With nothing wrong, about one draw in three (' + pc(nul.anyAlarmPct) + ') still raises a crew-wide alarm on some marker, and ' + pc(nul.heldPct) + ' of results go on hold. That is the price of checking 36 markers with four people, and it is why the first action is always a retake, never a treatment. With six crew it drops to ' + pc(n6.anyAlarmPct) + '.';
  }).catch(function () { box.innerHTML = '<p class="small">The simulation results could not be loaded. Run node test/validate.js to reproduce them.</p>'; });
})();
(function(){var links=[].slice.call(document.querySelectorAll('.toc a'));if(!links.length||!('IntersectionObserver' in window))return;
  var map={};links.forEach(function(a){map[a.getAttribute('href').slice(1)]=a});
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){links.forEach(function(a){a.classList.remove('on')});var a=map[e.target.id];if(a)a.classList.add('on')}})},{rootMargin:'0px 0px -75% 0px'});
  document.querySelectorAll('main h2[id]').forEach(function(h){io.observe(h)})})();

(function(){function a11yScroll(){document.querySelectorAll('.tbl,.tblwrap,.chart,pre.rep,.scroll,#ex-chart').forEach(function(el){if(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1){if(!el.hasAttribute('tabindex')){el.tabIndex=0;el.setAttribute('role','region');if(!el.getAttribute('aria-label'))el.setAttribute('aria-label','Scrollable content')}}else if(el.getAttribute('aria-label')==='Scrollable content'){el.removeAttribute('tabindex');el.removeAttribute('role');el.removeAttribute('aria-label')}})}a11yScroll();addEventListener('resize',a11yScroll);var mt=0,mo=document.querySelector('main');if(mo&&window.MutationObserver)new MutationObserver(function(){clearTimeout(mt);mt=setTimeout(a11yScroll,120)}).observe(mo,{childList:true,subtree:true})})();
