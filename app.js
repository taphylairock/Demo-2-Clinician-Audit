/* SCREEN LOGIC: reads the files you choose, calls the engine in core.js, and draws the results. */
(function () {
  'use strict';
  var C = window.AuditCore, cfg = window.AUDIT_CONFIG, TZ = cfg.timezone, MIN = C.MIN;
  var $ = function (id) { return document.getElementById(id); };

  var state = { text: {}, names: {}, parsed: {}, loaded: {}, model: null, result: null, days: [], dayIdx: 0, selectedPid: null, activeOpt: -1 };

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt1(n) { return n == null ? '\u2014' : (Math.round(n * 10) / 10).toFixed(1); }
  function pct(n) { return n == null ? '\u2014' : Math.round(n) + '%'; }
  function hm(t) { return C.fmtHM(t, TZ); }
  function dkey(t) { return C.fmtDate(t, TZ); }
  function weekday(key) {
    var a = key.split('-');
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(+a[0], +a[1] - 1, +a[2])).getUTCDay()];
  }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function typeLabel(t) { return t === 'on-call' ? 'On-call' : cap(t); }
  function setMessage(t) { $('message').textContent = t || ''; }

  var tzNames = { 'America/Toronto': 'Eastern', 'Etc/GMT+5': 'Eastern (fixed EST)' };
  $('tzLabel').textContent = tzNames[TZ] || TZ;

  // ---------- loading files ----------
  var KINDS = ['encounters', 'shifts', 'events', 'directory'];

  function readFile(kind, file) {
    var reader = new FileReader();
    reader.onload = function () { setText(kind, String(reader.result), file.name); };
    reader.onerror = function () { setStatus(kind, 'Could not read this file.', 'bad'); };
    reader.readAsText(file);
  }
  function setText(kind, text, name) {
    state.text[kind] = text; state.names[kind] = name;
    try { state.parsed[kind] = C.parseCSV(text); } catch (e) { state.parsed[kind] = null; setStatus(kind, 'This file could not be read as CSV.', 'bad'); return; }
    rebuild();
  }
  function setStatus(kind, text, cls) {
    $('status-' + kind).textContent = text;
    $('slot-' + kind).className = 'slot' + (cls ? ' ' + cls : '');
  }

  function rebuild() {
    var data = { encounters: [], shifts: [], events: [], directory: [], quality: [] };
    state.loaded = {};
    KINDS.forEach(function (kind) {
      var csv = state.parsed[kind];
      if (!csv) return;
      var res = kind === 'encounters' ? C.loadEncounters(csv, cfg) : kind === 'shifts' ? C.loadShifts(csv, cfg) :
        kind === 'directory' ? C.loadDirectory(csv, cfg) : C.loadEvents(csv, cfg);
      data[kind] = res.records;
      data.quality = data.quality.concat(res.quality);
      if (kind === 'encounters') data.encCols = res.cols;
      var errors = res.quality.filter(function (x) { return x.level === 'error'; });
      if (errors.length) setStatus(kind, errors[0].text, 'bad');
      else { state.loaded[kind] = true; setStatus(kind, state.names[kind] + ': ' + res.records.length.toLocaleString() + (kind === 'directory' ? ' names read' : ' rows read'), 'ok'); }
    });
    state.model = C.buildModel(cfg, data);
    state.model.quality = data.quality;

    $('pid').placeholder = state.model.names.size ? 'Type a name or ID' : 'Type an ID (load names to search by name)';
    closeResults();
    setDefaultDates(data);
    setMessage('');
  }

  function setDefaultDates(data) {
    var times = data.shifts.map(function (s) { return s.start; });
    if (!times.length) times = data.encounters.map(function (e) { return e.start; }).filter(function (t) { return t != null; });
    if (!times.length) return;
    var lo = Math.min.apply(null, times), hi = Math.max.apply(null, times);
    var span = (hi - lo) / 86400000;
    if (span > 31) lo = hi - 6 * 86400000;
    if (!$('dStart').value || state.sampleJustLoaded) { $('dStart').value = dkey(lo); $('dEnd').value = dkey(hi); }
    state.sampleJustLoaded = false;
  }

  KINDS.forEach(function (kind) {
    $('file-' + kind).addEventListener('change', function (e) { if (e.target.files[0]) readFile(kind, e.target.files[0]); });
  });

  $('btnSample').addEventListener('click', function () {
    var S = window.SAMPLE_DATA;
    if (!S) { setMessage('Sample data file is missing.'); return; }
    state.sampleJustLoaded = true;
    KINDS.forEach(function (k) { $('file-' + k).value = ''; });
    state.text = {}; state.parsed = {};
    KINDS.forEach(function (k) { if (S[k]) { state.text[k] = S[k]; state.names[k] = 'Sample ' + k; state.parsed[k] = C.parseCSV(S[k]); } });
    rebuild();
    state.selectedPid = S.suggestedProvider;
    $('pid').value = displayOf(S.suggestedProvider);
    $('dStart').value = S.suggestedStart; $('dEnd').value = S.suggestedEnd;
    run();
  });

  // ---------- searching for a provider (by name or ID) ----------
  function nameOf(pid) { return state.model && state.model.names.get(pid) || ''; }
  function displayOf(pid) { return nameOf(pid) || pid; }

  function closeResults() {
    $('pidResults').hidden = true; $('pidResults').innerHTML = '';
    $('pid').setAttribute('aria-expanded', 'false'); $('pid').removeAttribute('aria-activedescendant');
    state.activeOpt = -1;
  }
  function showResults(query) {
    if (!state.model || !query.trim()) { closeResults(); return; }
    var res = C.searchProviders(state.model, query, 8), list = $('pidResults');
    if (!res.matches.length) { closeResults(); return; }
    var h = res.matches.map(function (m, i) {
      var sub = (m.name ? esc(m.pid) : '') + (m.role ? (m.name ? ' \u00B7 ' : '') + esc(m.role) : '');
      return '<li role="option" id="opt-' + i + '" data-pid="' + esc(m.pid) + '" aria-selected="false">' + esc(m.name || m.pid) + (sub ? '<small>' + sub + '</small>' : '') + '</li>';
    }).join('');
    if (res.total > res.matches.length) h += '<li class="more" aria-hidden="true">' + (res.total - res.matches.length) + ' more. Keep typing to narrow it down.</li>';
    list.innerHTML = h; list.hidden = false;
    $('pid').setAttribute('aria-expanded', 'true');
    state.activeOpt = -1;
  }
  function choose(pid) {
    state.selectedPid = pid;
    $('pid').value = displayOf(pid);
    closeResults();
  }
  function moveActive(delta) {
    var opts = $('pidResults').querySelectorAll('[role=option]');
    if (!opts.length) return;
    state.activeOpt = (state.activeOpt + delta + opts.length) % opts.length;
    opts.forEach(function (o, i) { o.setAttribute('aria-selected', String(i === state.activeOpt)); });
    var a = opts[state.activeOpt];
    $('pid').setAttribute('aria-activedescendant', a.id);
    a.scrollIntoView({ block: 'nearest' });
  }
  $('pid').addEventListener('input', function (e) { state.selectedPid = null; showResults(e.target.value); });
  $('pid').addEventListener('focus', function (e) { if (e.target.value && !state.selectedPid) showResults(e.target.value); });
  $('pid').addEventListener('blur', function () { setTimeout(closeResults, 120); });
  $('pid').addEventListener('keydown', function (e) {
    var open = !$('pidResults').hidden;
    if (e.key === 'ArrowDown') { if (!open) showResults(e.target.value); moveActive(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && open) { moveActive(-1); e.preventDefault(); }
    else if (e.key === 'Escape') { closeResults(); }
    else if (e.key === 'Enter') {
      var opts = $('pidResults').querySelectorAll('[role=option]');
      if (open && state.activeOpt >= 0 && opts[state.activeOpt]) { choose(opts[state.activeOpt].getAttribute('data-pid')); }
      run();
      e.preventDefault();
    }
  });
  $('pidResults').addEventListener('mousedown', function (e) {
    var li = e.target.closest('[role=option]');
    if (li) { e.preventDefault(); choose(li.getAttribute('data-pid')); }
  });

  // Turns whatever is in the box into one provider ID, or an explanation of why it cannot.
  function resolveProvider() {
    var text = $('pid').value.trim();
    if (!text) return { error: 'Enter a provider name or ID.' };
    if (state.selectedPid && displayOf(state.selectedPid) === text) return { pid: state.selectedPid };
    if (state.model.providers.indexOf(text) !== -1) return { pid: text };
    var res = C.searchProviders(state.model, text, 8);
    if (res.matches.length === 1) { choose(res.matches[0].pid); return { pid: res.matches[0].pid }; }
    if (res.matches.length > 1) {
      showResults(text);
      return { error: (res.total || res.matches.length) + ' providers match \u201C' + text + '\u201D. Choose one from the list.' };
    }
    if (res.noData.length) {
      return { error: res.noData.map(function (n) { return n.name; }).join(', ') + ' is in the names file but has no shifts or encounters in the files you loaded.' };
    }
    return { error: 'No provider found for \u201C' + text + '\u201D.' +
      (state.model.names.size ? ' Check the spelling, or try part of the name.' : ' Load the names file to search by name, or check the ID for typos.') };
  }

  // ---------- running the audit ----------
  $('btnRun').addEventListener('click', run);

  function run() {
    if (!state.loaded.encounters || !state.loaded.shifts) {
      setMessage('Load the encounters file and the shifts file first.'); return;
    }
    var who = resolveProvider();
    if (who.error) { setMessage(who.error); return; }
    var pid = who.pid;
    var s = $('dStart').value, e = $('dEnd').value;
    if (!s || !e) { setMessage('Choose a start and end date.'); return; }
    if (e < s) { setMessage('The end date is before the start date.'); return; }
    var from = C.dayStart(s, TZ), to = C.nextDayStart(e, TZ);
    var r = C.audit(state.model, pid, from, to);
    if (!r.found) {
      setMessage('No data found for ' + displayOf(pid) + ' in the loaded files.');
      return;
    }
    setMessage('');
    state.result = r;
    state.range = { s: s, e: e };
    var days = {};
    r.shifts.forEach(function (x) { days[dkey(x.start)] = 1; });
    r.consults.forEach(function (c) { var k = dkey(c.s); if (k >= s && k <= e) days[k] = 1; });
    r.flags.forEach(function (f) { days[dkey(f.start)] = 1; });
    state.days = Object.keys(days).sort();
    var firstFlagged = r.flags.length ? state.days.indexOf(dkey(r.flags[0].start)) : 0;
    state.dayIdx = Math.max(0, firstFlagged);
    $('empty').hidden = true; $('results').hidden = false;
    renderAll();
  }

  function renderAll() {
    renderSummary(); renderDayBar(); renderTimeline(); renderFlags(); renderPeers(); renderQuality();
  }

  // ---------- summary ----------
  function renderSummary() {
    var r = state.result, checked = r.shifts.filter(function (s) { return s.policy !== 'suppress'; }).length;
    var blocks = r.flags.filter(function (f) { return f.type !== 'novideo'; });
    var mins = 0, wsum = 0;
    blocks.forEach(function (f) { mins += f.minutes; wsum += f.minutes * (f.wait.intakeAvg + f.wait.triagedAvg); });
    var avgWait = mins ? wsum / mins : null;
    var provLoc = r.loc === 'ALL' ? 'all provinces' : r.loc;
    $('summary').innerHTML =
      '<div class="who">' + esc(nameOf(r.pid) || r.pid) + '<small>' + (nameOf(r.pid) ? esc(r.pid) + ' \u00B7 ' : '') + esc(r.role || 'role unknown') + ' \u00B7 ' + esc(provLoc) + '</small></div>' +
      stat(r.shifts.length, (r.shifts.length === 1 ? 'shift' : 'shifts') + ' (' + checked + ' checked)') +
      stat(r.consults.length, r.consults.length === 1 ? 'consult counted' : 'consults counted') +
      stat(r.flags.length, r.flags.length === 1 ? 'flag' : 'flags', r.flags.length > 0) +
      stat(Math.round(mins), 'minutes flagged', mins > 0) +
      (avgWait == null ? '' : stat(fmt1(avgWait), 'patients waiting on average during flagged time'));
    var low = r.role === 'CM' || r.consults.some(function (c) { return c.conf === 'low'; });
    var b = $('banner');
    b.hidden = !low;
    if (low) {
      b.innerHTML = '<strong>Care manager results are low confidence.</strong> Without message-by-message data, consult time is estimated, and a later return to a chart does not count as working time. Treat flags as leads to check. <button type="button" id="bannerLink">See data quality</button>';
      $('bannerLink').addEventListener('click', function () { showTab('quality', true); });
    }
    function stat(n, label, hot) { return '<div class="stat' + (hot ? ' hot' : '') + '"><strong>' + n + '</strong>' + label + '</div>'; }
  }

  // ---------- tabs ----------
  var tabs = ['timeline', 'flags', 'peers', 'quality'];
  tabs.forEach(function (t) {
    $('tab-' + t).addEventListener('click', function () { showTab(t); });
    $('tab-' + t).addEventListener('keydown', function (e) {
      var i = tabs.indexOf(t);
      if (e.key === 'ArrowRight') { showTab(tabs[(i + 1) % tabs.length], true); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { showTab(tabs[(i + tabs.length - 1) % tabs.length], true); e.preventDefault(); }
    });
  });
  function showTab(name, focus) {
    tabs.forEach(function (t) {
      $('tab-' + t).setAttribute('aria-selected', String(t === name));
      $('panel-' + t).hidden = t !== name;
    });
    if (focus) $('tab-' + name).focus();
  }

  // ---------- day selector ----------
  function renderDayBar() {
    var r = state.result, sel = $('daySelect');
    var counts = {};
    r.flags.forEach(function (f) { var k = dkey(f.start); counts[k] = (counts[k] || 0) + 1; });
    sel.innerHTML = state.days.map(function (k, i) {
      var c = counts[k] || 0;
      return '<option value="' + i + '"' + (i === state.dayIdx ? ' selected' : '') + '>' + weekday(k) + ' ' + k + (c ? ' (' + c + (c === 1 ? ' flag)' : ' flags)') : ')') + '</option>';
    }).join('');
    $('dayPrev').disabled = state.dayIdx <= 0;
    $('dayNext').disabled = state.dayIdx >= state.days.length - 1;
  }
  $('daySelect').addEventListener('change', function (e) { state.dayIdx = +e.target.value; renderDayBar(); renderTimeline(); });
  $('dayPrev').addEventListener('click', function () { if (state.dayIdx > 0) { state.dayIdx--; renderDayBar(); renderTimeline(); } });
  $('dayNext').addEventListener('click', function () { if (state.dayIdx < state.days.length - 1) { state.dayIdx++; renderDayBar(); renderTimeline(); } });

  // ---------- timeline (SVG) ----------
  var EVENT_COLOURS = ['#1F2A44', '#A8570C', '#2F7A52', '#7A3B6E'];

  function renderTimeline() {
    var r = state.result, chart = $('chart');
    if (!state.days.length) { chart.innerHTML = '<p class="note">Nothing to show for this provider in these dates.</p>'; $('legend').innerHTML = ''; return; }
    var key = state.days[state.dayIdx], d0 = C.dayStart(key, TZ), d1 = C.nextDayStart(key, TZ);
    var shifts = r.shifts.filter(function (s) { return s.end > d0 && s.start < d1; });
    var consults = r.consults.filter(function (c) { return c.e > d0 && c.s < d1; });
    var flags = r.flags.filter(function (f) { return f.end > d0 && f.start < d1 || (f.start >= d0 && f.start < d1); });
    var events = r.events.filter(function (e) { return e.t >= d0 && e.t < d1; });

    var lo = Infinity, hi = -Infinity;
    shifts.forEach(function (s) { lo = Math.min(lo, s.start - 30 * MIN); hi = Math.max(hi, s.end + 30 * MIN); });
    if (!shifts.length) {
      consults.forEach(function (c) { lo = Math.min(lo, c.s - 30 * MIN); hi = Math.max(hi, c.e + 30 * MIN); });
    }
    if (!isFinite(lo)) { lo = d0; hi = d1; }
    lo = Math.max(lo, d0); hi = Math.min(hi, d1);
    var p0 = C.partsAt(lo, TZ); lo -= p0.mi * MIN + p0.s * 1000;
    var p1 = C.partsAt(hi, TZ); if (p1.mi || p1.s) hi += (60 - p1.mi) * MIN - p1.s * 1000;
    hi = Math.min(hi, d1);
    var span = hi - lo;

    var W = 1120, X0 = 140, X1 = 1096, PW = X1 - X0;
    var Y = { shift: 30, consult: 68, flag: 112, event: 142, wait: 176 }, H = { shift: 30, consult: 36, flag: 24, event: 24, wait: 96 };
    var bottom = Y.wait + H.wait, total = bottom + 8;
    function x(t) { return X0 + (Math.min(Math.max(t, lo), hi) - lo) / span * PW; }

    var out = [];
    out.push('<svg viewBox="0 0 ' + W + ' ' + total + '" role="img" aria-label="Timeline for ' + esc(r.pid) + ' on ' + esc(key) + '" font-family="Segoe UI, system-ui, sans-serif" font-size="12">');
    out.push('<defs>' +
      '<pattern id="hatchTeal" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#CFE4E5"/><line x1="0" y1="0" x2="0" y2="6" stroke="#0D6B72" stroke-width="2"/></pattern>' +
      '<pattern id="hatchGrey" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#EEF2F2"/><line x1="0" y1="0" x2="0" y2="7" stroke="#B9C5C6" stroke-width="2"/></pattern>' +
      '</defs>');

    // hour grid
    var step = span <= 4 * 3600000 ? 30 * MIN : 60 * MIN;
    for (var t = lo; t <= hi; t += step) {
      var gx = x(t);
      out.push('<line x1="' + gx + '" y1="' + (Y.shift - 4) + '" x2="' + gx + '" y2="' + bottom + '" stroke="#E1E8E8"/>');
      out.push('<text x="' + gx + '" y="' + (Y.shift - 10) + '" text-anchor="middle" fill="#55666D">' + hm(t) + '</text>');
    }

    // lane labels
    function laneLabel(txt, y, h) { out.push('<text x="8" y="' + (y + h / 2 + 4) + '" fill="#55666D">' + esc(txt) + '</text>'); }
    laneLabel('Scheduled shifts', Y.shift, H.shift);
    laneLabel('Consults', Y.consult, H.consult);
    laneLabel('Flags', Y.flag, H.flag);
    laneLabel('Other activity', Y.event, H.event);
    out.push('<text x="8" y="' + (Y.wait + 14) + '" fill="#55666D">Patients waiting</text>');
    out.push('<text x="8" y="' + (Y.wait + 30) + '" fill="#55666D" font-size="11">' + esc(r.loc === 'ALL' ? 'all provinces' : r.loc) + '</text>');

    // flagged bands run through every lane, so idle time lines up with who was waiting
    flags.forEach(function (f) {
      if (f.type === 'novideo') return;
      var a = x(f.start), b = x(f.end);
      out.push('<rect x="' + a + '" y="' + (Y.shift - 4) + '" width="' + Math.max(1, b - a) + '" height="' + (bottom - Y.shift + 4) + '" fill="#BE3227" fill-opacity=".11"/>');
      out.push('<line x1="' + a + '" y1="' + (Y.shift - 4) + '" x2="' + a + '" y2="' + bottom + '" stroke="#BE3227" stroke-opacity=".45" stroke-dasharray="3 3"/>');
      out.push('<line x1="' + b + '" y1="' + (Y.shift - 4) + '" x2="' + b + '" y2="' + bottom + '" stroke="#BE3227" stroke-opacity=".45" stroke-dasharray="3 3"/>');
    });

    // shifts
    shifts.forEach(function (s) {
      var a = x(s.start), b = x(s.end), supp = s.policy === 'suppress';
      var label = typeLabel(s.type) + ' \u00B7 ' + (s.roleUsed || s.role || '?') + (supp ? ' (not checked)' : '');
      out.push('<g><title>' + esc(label + ', ' + hm(s.start) + '\u2013' + hm(s.end)) + '</title>' +
        '<rect x="' + a + '" y="' + Y.shift + '" width="' + Math.max(1, b - a) + '" height="' + H.shift + '" rx="2" fill="' + (supp ? 'url(#hatchGrey)' : '#E3EAEA') + '" stroke="#98A7AA"/>' +
        (b - a > 90 ? '<text x="' + (a + 8) + '" y="' + (Y.shift + 19) + '" fill="#17262D">' + esc(label) + '</text>' : '') + '</g>');
    });

    // consults
    consults.forEach(function (c) {
      var a = x(c.s), b = x(c.e), low = c.conf === 'low';
      out.push('<g><title>' + esc('Encounter ' + c.eid + ', ' + hm(c.s) + '\u2013' + hm(c.e) + (low ? ' (estimated, low confidence)' : '')) + '</title>' +
        '<rect x="' + a + '" y="' + (Y.consult + 3) + '" width="' + Math.max(2, b - a) + '" height="' + (H.consult - 6) + '" rx="2" fill="' + (low ? 'url(#hatchTeal)' : '#0D6B72') + '" fill-opacity="' + (low ? 1 : .88) + '" stroke="' + (low ? '#0D6B72' : '#FFFFFF') + '" stroke-width="' + (low ? 1 : .8) + '"/></g>');
    });

    // flags lane
    flags.forEach(function (f) {
      if (f.type === 'novideo') {
        var cx = x(f.start);
        out.push('<g><title>' + esc('No video call, ' + hm(f.start) + '. ' + f.note) + '</title><path d="M' + cx + ' ' + (Y.flag + 2) + ' l8 18 h-16 z" fill="#BE3227"/></g>');
        return;
      }
      var a = x(f.start), b = x(f.end), w = b - a;
      var txt = Math.round(f.minutes) + ' min';
      out.push('<g><title>' + esc(f.label + ', ' + hm(f.start) + '\u2013' + hm(f.end) + ' (' + txt + '). ' + waitText(f)) + '</title>' +
        '<rect x="' + a + '" y="' + (Y.flag + 3) + '" width="' + Math.max(2, w) + '" height="' + (H.flag - 6) + '" rx="2" fill="#BE3227"/>' +
        (w > 46 ? '<text x="' + (a + w / 2) + '" y="' + (Y.flag + 16) + '" text-anchor="middle" fill="#fff" font-weight="600">' + txt + '</text>' : '') + '</g>');
    });

    // other activity
    var srcs = [];
    events.forEach(function (e) {
      var si = srcs.indexOf(e.source); if (si < 0) { srcs.push(e.source); si = srcs.length - 1; }
      var cx = x(e.t), cy = Y.event + H.event / 2, col = EVENT_COLOURS[si % EVENT_COLOURS.length];
      out.push('<g><title>' + esc(e.source + (e.type ? ': ' + e.type : '') + ' at ' + hm(e.t)) + '</title><path d="M' + cx + ' ' + (cy - 7) + ' l6 7 l-6 7 l-6 -7 z" fill="' + col + '"/></g>');
    });

    // waiting ribbon
    var t = r.series.locs.get(r.loc) || r.series.locs.get('ALL');
    var totalMin = Math.round(span / MIN), bm = Math.max(1, Math.ceil(totalMin / 240)), nb = Math.ceil(totalMin / bm);
    var bi = [], bt = [], maxTot = 4;
    for (var k = 0; k < nb; k++) {
      var mi = 0, mt = 0;
      for (var j = 0; j < bm; j++) {
        var idx = Math.floor((lo + (k * bm + j) * MIN - r.series.from) / MIN);
        if (idx < 0 || idx >= r.series.n) continue;
        if (t.intake[idx] > mi) mi = t.intake[idx];
        if (t.triaged[idx] > mt) mt = t.triaged[idx];
      }
      bi.push(mi); bt.push(mt); if (mi + mt > maxTot) maxTot = mi + mt;
    }
    var base = Y.wait + H.wait, sc = (H.wait - 6) / maxTot;
    out.push('<line x1="' + X0 + '" y1="' + base + '" x2="' + X1 + '" y2="' + base + '" stroke="#98A7AA"/>');
    var bw = bm * MIN / span * PW;
    for (var q = 0; q < nb; q++) {
      var bx = X0 + (q * bm * MIN) / span * PW, hi_ = bi[q] * sc, ht_ = bt[q] * sc;
      if (hi_) out.push('<rect x="' + bx + '" y="' + (base - hi_) + '" width="' + (bw + .4) + '" height="' + hi_ + '" fill="#4864B0"/>');
      if (ht_) out.push('<rect x="' + bx + '" y="' + (base - hi_ - ht_) + '" width="' + (bw + .4) + '" height="' + ht_ + '" fill="#8E5BC0"/>');
    }
    out.push('<text x="' + (X0 - 6) + '" y="' + (Y.wait + 10) + '" text-anchor="end" fill="#55666D" font-size="11">' + maxTot + '</text>');
    out.push('<text x="' + (X0 - 6) + '" y="' + base + '" text-anchor="end" fill="#55666D" font-size="11">0</text>');
    out.push('</svg>');
    chart.innerHTML = out.join('');

    var leg = [
      '<li><i style="background:#E3EAEA;border:1px solid #98A7AA"></i>Scheduled shift</li>',
      '<li><i style="background:repeating-linear-gradient(45deg,#EEF2F2 0 3px,#B9C5C6 3px 5px)"></i>On-call or training (not checked)</li>',
      '<li><i style="background:#0D6B72"></i>Consult</li>',
      '<li><i style="background:repeating-linear-gradient(45deg,#CFE4E5 0 3px,#0D6B72 3px 5px);border:1px solid #0D6B72"></i>Care manager time (estimated)</li>',
      '<li><i style="background:#BE3227"></i>Flag</li>',
      '<li><i style="background:#4864B0"></i>Patients in intake</li>',
      '<li><i style="background:#8E5BC0"></i>Patients triaged and waiting</li>'
    ];
    srcs.forEach(function (s, i) { leg.push('<li><i style="background:' + EVENT_COLOURS[i % EVENT_COLOURS.length] + ';transform:rotate(45deg) scale(.7)"></i>' + esc(s) + '</li>'); });
    $('legend').innerHTML = leg.join('');
  }

  function waitText(f) {
    if (!f.wait) return '';
    return 'Waiting: intake avg ' + fmt1(f.wait.intakeAvg) + ' (max ' + f.wait.intakeMax + '), triaged avg ' + fmt1(f.wait.triagedAvg) + ' (max ' + f.wait.triagedMax + ').';
  }

  // ---------- flags table ----------
  $('onlyWaiting').addEventListener('change', renderFlags);

  function visibleFlags() {
    var only = $('onlyWaiting').checked;
    return state.result.flags.filter(function (f) { return !only || f.type === 'novideo' || (f.wait && (f.wait.intakeMax + f.wait.triagedMax) > 0); });
  }

  function renderFlags() {
    var rows = visibleFlags();
    if (!rows.length) {
      $('flagsTable').innerHTML = '<p class="empty-row">' + (state.result.flags.length ? 'No flags match this filter.' : 'No flags for this provider in these dates.') + '</p>';
      return;
    }
    var h = '<table><thead><tr><th>Date</th><th>Time</th><th class="num">Minutes</th><th>Flag</th><th>Shift</th>' +
      '<th class="num">Intake waiting<br>average / most</th><th class="num">Triaged waiting<br>average / most</th><th>Notes</th></tr></thead><tbody>';
    rows.forEach(function (f) {
      var isVideo = f.type === 'novideo';
      h += '<tr><td class="nowrap">' + esc(dkey(f.start)) + '</td>' +
        '<td class="nowrap">' + (isVideo ? hm(f.start) : hm(f.start) + '\u2013' + hm(f.end)) + '</td>' +
        '<td class="num">' + (isVideo ? '\u2014' : Math.round(f.minutes)) + '</td>' +
        '<td><span class="tag ' + f.type + '">' + esc(f.label) + '</span>' + (f.conf === 'low' ? ' <span class="tag low">Low confidence</span>' : '') + '</td>' +
        '<td>' + (f.shiftType ? '<span class="tag type">' + esc(typeLabel(f.shiftType)) + ' \u00B7 ' + esc(f.role) + '</span>' : esc(f.role || '')) + '</td>' +
        '<td class="num">' + (f.wait ? fmt1(f.wait.intakeAvg) + ' / ' + f.wait.intakeMax : '\u2014') + '</td>' +
        '<td class="num">' + (f.wait ? fmt1(f.wait.triagedAvg) + ' / ' + f.wait.triagedMax : '\u2014') + '</td>' +
        '<td class="notes">' + esc(f.note) + '</td></tr>';
    });
    $('flagsTable').innerHTML = h + '</tbody></table>';
  }

  // ---------- CSV export ----------
  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // stop spreadsheets from running text as a formula
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  $('btnCsv').addEventListener('click', function () {
    var rows = visibleFlags(), r = state.result;
    var withName = cfg.includeNamesInCsv && nameOf(r.pid);
    var head = (withName ? ['provider_name'] : []).concat(['provider_id', 'date', 'start', 'end', 'minutes', 'flag', 'role', 'shift_type', 'intake_waiting_avg', 'intake_waiting_max', 'triaged_waiting_avg', 'triaged_waiting_max', 'confidence', 'notes']);
    var lines = [head.join(',')];
    rows.forEach(function (f) {
      lines.push([].concat(withName ? [nameOf(r.pid)] : [], [r.pid, dkey(f.start), hm(f.start), hm(f.end), f.type === 'novideo' ? '' : Math.round(f.minutes), f.label, f.role, f.shiftType,
        f.wait ? fmt1(f.wait.intakeAvg) : '', f.wait ? f.wait.intakeMax : '', f.wait ? fmt1(f.wait.triagedAvg) : '', f.wait ? f.wait.triagedMax : '', f.conf, f.note]).map(csvCell).join(','));
    });
    var blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'flags_' + r.pid.replace(/[^\w.-]/g, '_') + '_' + state.range.s + '_to_' + state.range.e + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });

  // ---------- peers ----------
  function renderPeers() {
    var p = state.result.peers, r = state.result;
    if (!p.rows.length) {
      $('peersTable').innerHTML = '<p class="empty-row">' + (r.role ? 'No shifts to compare in these dates.' : 'The provider\u2019s role is unknown, so there is nobody to compare with.') + '</p>';
      return;
    }
    var cap_ = '<p class="caption">Compares this provider with other ' + esc(r.role) + 's on regular shifts at the same time (overlap of at least ' + cfg.thresholds.minPeerOverlapMinutes + ' minutes). The last column is the average number of patients waiting during the shift, which is the demand everyone was working against.</p>';
    var h = cap_ + '<table><thead><tr><th>Date</th><th>Shift</th><th class="num">Peers on shift</th>' +
      '<th class="num">Consults per hour<br>this provider / peers</th><th class="num">Time in consults<br>this provider / peers</th><th class="num">Patients waiting<br>average</th></tr></thead><tbody>';
    p.rows.forEach(function (x) {
      h += '<tr><td class="nowrap">' + esc(dkey(x.start)) + '</td><td class="nowrap">' + hm(x.start) + '\u2013' + hm(x.end) + ' <span class="tag type">' + esc(typeLabel(x.type)) + '</span></td>' +
        '<td class="num">' + x.peerCount + '</td>' +
        '<td class="num">' + fmt1(x.myPerHour) + ' / ' + fmt1(x.peerPerHour) + '</td>' +
        '<td class="num">' + pct(x.myBusyPct) + ' / ' + pct(x.peerBusyPct) + '</td>' +
        '<td class="num">' + fmt1(x.avgWaiting) + '</td></tr>';
    });
    if (p.rows.length > 1 && p.overall) {
      var o = p.overall;
      h += '<tr><td colspan="3"><strong>All shifts together</strong></td><td class="num"><strong>' + fmt1(o.myPerHour) + ' / ' + fmt1(o.peerPerHour) + '</strong></td>' +
        '<td class="num"><strong>' + pct(o.myBusyPct) + ' / ' + pct(o.peerBusyPct) + '</strong></td><td></td></tr>';
    }
    $('peersTable').innerHTML = h + '</tbody></table>';
  }

  // ---------- data quality ----------
  function renderQuality() {
    var items = state.result.quality.concat(state.model.quality || []);
    var qs = state.model.queueStats;
    if (qs && qs.total) {
      items.push({ level: 'info', text: 'Queue depth uses ' + qs.used.toLocaleString() + ' of ' + qs.total.toLocaleString() + ' encounters. ' +
        (qs.noStart ? qs.noStart + ' had no start time. ' : '') + (qs.noEnd ? qs.noEnd + ' had no usable end of wait. ' : '') +
        'Queue depth is only as complete as the export: it needs every provider\u2019s encounters for the dates, not just this provider\u2019s.' });
    }
    if (state.loaded.directory) {
      var missing = state.model.providers.filter(function (p) { return !state.model.names.has(p); }).length;
      if (missing) items.push({ level: 'warn', text: missing + ' of ' + state.model.providers.length + ' providers in your data have no name in the names file. They can still be found by ID.' });
    }
    items.push({ level: 'info', text: 'Timestamps without a timezone are read as ' + cfg.sourceTimezone + ' and shown in ' + TZ + '. Change this in js/config.js if the times look shifted.' });
    var order = { error: 0, warn: 1, info: 2 }, label = { error: 'Problem', warn: 'Check this', info: 'Good to know' };
    items.sort(function (a, b) { return order[a.level] - order[b.level]; });
    $('qualityList').innerHTML = items.map(function (i) {
      return '<div class="q ' + i.level + '"><small>' + label[i.level] + '</small>' + esc(i.text) + '</div>';
    }).join('');
  }
})();
