/*
  CORE ENGINE: all of the arithmetic lives here. No screen code, no AI, no network.
  Every flag is plain arithmetic on timestamps, so any result can be re-checked by hand.
*/
(function (root) {
  'use strict';

  var MIN = 60000;

  // =====================================================================
  // CSV
  // =====================================================================
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var n = text.length, rows = [], row = [], i = 0;
    while (i < n) {
      var field;
      if (text.charCodeAt(i) === 34) {
        i++;
        var start = i;
        field = '';
        for (;;) {
          var j = text.indexOf('"', i);
          if (j === -1) { field += text.slice(start); i = n; break; }
          if (text.charCodeAt(j + 1) === 34) { field += text.slice(start, j + 1); i = j + 2; start = i; continue; }
          field += text.slice(start, j); i = j + 1; break;
        }
        while (i < n) {
          var d0 = text.charCodeAt(i);
          if (d0 === 44 || d0 === 10 || d0 === 13) break;
          field += text[i]; i++;
        }
      } else {
        var k = i;
        while (k < n) {
          var d1 = text.charCodeAt(k);
          if (d1 === 44 || d1 === 10 || d1 === 13) break;
          k++;
        }
        field = text.slice(i, k);
        i = k;
      }
      row.push(field);
      if (i >= n) break;
      var d = text.charCodeAt(i);
      if (d === 44) { i++; if (i >= n) row.push(''); continue; }
      if (d === 13 && text.charCodeAt(i + 1) === 10) i += 2; else i++;
      rows.push(row);
      row = [];
    }
    if (row.length) rows.push(row);
    var headers = (rows.shift() || []).map(function (h) { return h.trim(); });
    rows = rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ''); });
    return { headers: headers, rows: rows };
  }

  // =====================================================================
  // TIME (everything is stored as UTC milliseconds and only formatted for display)
  // =====================================================================
  var dtfCache = {};
  function dtf(tz) {
    if (!dtfCache[tz]) {
      dtfCache[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    return dtfCache[tz];
  }
  function partsAt(ts, tz) {
    var p = {}, arr = dtf(tz).formatToParts(new Date(ts));
    for (var i = 0; i < arr.length; i++) p[arr[i].type] = arr[i].value;
    return { y: +p.year, mo: +p.month, d: +p.day, h: (+p.hour) % 24, mi: +p.minute, s: +p.second };
  }
  function tzOffsetMs(ts, tz) {
    var p = partsAt(ts, tz);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ts / 1000) * 1000;
  }
  function wallToEpoch(y, mo, d, h, mi, s, tz) {
    var guess = Date.UTC(y, mo - 1, d, h, mi, s);
    var t = guess - tzOffsetMs(guess, tz);
    var off2 = tzOffsetMs(t, tz);
    if (guess - off2 !== t) t = guess - off2;
    return t;
  }
  var MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;
  var LONG_RE = /^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i;

  // Returns UTC milliseconds, or null if the text is not a date we understand.
  function parseTimestamp(raw, srcTz) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s) return null;
    var m = ISO_RE.exec(s);
    if (m) {
      var y = +m[1], mo = +m[2], d = +m[3], h = +(m[4] || 0), mi = +(m[5] || 0), sec = +(m[6] || 0);
      if (m[7]) {
        var off = 0;
        if (m[7].toUpperCase() !== 'Z') {
          var sign = m[7][0] === '-' ? -1 : 1;
          var digits = m[7].slice(1).replace(':', '');
          var oh = +digits.slice(0, 2), om = +(digits.slice(2) || 0);
          off = sign * (oh * 60 + om) * MIN;
        }
        return Date.UTC(y, mo - 1, d, h, mi, sec) - off;
      }
      return wallToEpoch(y, mo, d, h, mi, sec, srcTz);
    }
    m = LONG_RE.exec(s);
    if (m) {
      var mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mon === undefined) return null;
      var hh = +(m[4] || 0);
      if (m[7]) {
        var pm = m[7].toUpperCase() === 'PM';
        if (pm && hh < 12) hh += 12;
        if (!pm && hh === 12) hh = 0;
      }
      return wallToEpoch(+m[3], mon + 1, +m[2], hh, +(m[5] || 0), +(m[6] || 0), srcTz);
    }
    return null;
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtHM(ts, tz) { var p = partsAt(ts, tz); return pad2(p.h) + ':' + pad2(p.mi); }
  function fmtDate(ts, tz) { var p = partsAt(ts, tz); return p.y + '-' + pad2(p.mo) + '-' + pad2(p.d); }
  function dayStart(dateStr, tz) {
    var a = dateStr.split('-');
    return wallToEpoch(+a[0], +a[1], +a[2], 0, 0, 0, tz);
  }
  function nextDayStart(dateStr, tz) {
    var a = dateStr.split('-');
    var nd = new Date(Date.UTC(+a[0], +a[1] - 1, +a[2] + 1));
    return wallToEpoch(nd.getUTCFullYear(), nd.getUTCMonth() + 1, nd.getUTCDate(), 0, 0, 0, tz);
  }

  // =====================================================================
  // COLUMN MAPPING AND LOADERS
  // =====================================================================
  function normKey(s) { return String(s).trim().toLowerCase().replace(/[\s\-]+/g, '_'); }

  function resolveColumns(headers, aliasMap) {
    var norm = headers.map(normKey), idx = {};
    Object.keys(aliasMap).forEach(function (canon) {
      var names = [canon].concat(aliasMap[canon]), found = -1;
      for (var i = 0; i < names.length && found === -1; i++) found = norm.indexOf(normKey(names[i]));
      idx[canon] = found;
    });
    return idx;
  }

  var COLUMN_HELP = {
    role: 'who is an NP, MD or CM (the role from the shifts file is used instead)',
    locality: 'which province the patient waited in (the national queue is used instead)',
    started_at: 'when the patient entered the platform (queue depth is not available without it)',
    triaged_completed_at: 'the split between intake and triaged waiting',
    first_responded_at: 'when the wait ended',
    clinical_start: 'when the consult started (joined time is used instead)',
    clinical_end: 'when the consult ended (encounter end time is used instead)',
    ended_at: 'when the encounter ended',
    joined_at: 'when the provider joined the consult (needed for care managers)',
    secs_active: 'engaged time for care managers',
    intake_preference: 'whether the patient asked for video (the no-video flag is switched off)',
    video_started_at: 'whether a video call happened',
    had_video_call: 'whether a video call happened',
    shift_type: 'on-call, training and admin shifts (all shifts are treated as regular)',
    care_group_id: 'which care group a shift belongs to',
    source: 'the platform name on the timeline',
    event_type: 'the action name on the timeline'
  };

  function q(level, text) { return { level: level, text: text }; }

  function reportMissing(cols, quality, fileLabel) {
    var missing = Object.keys(cols).filter(function (c) {
      if (c === 'had_video_call' && cols.video_started_at >= 0) return false;     // either one is enough
      if (c === 'video_started_at' && cols.had_video_call >= 0) return false;
      return cols[c] < 0 && COLUMN_HELP[c];
    });
    if (!missing.length) return;
    var groups = {};
    missing.forEach(function (c) { groups[COLUMN_HELP[c]] = (groups[COLUMN_HELP[c]] || []).concat(c); });
    Object.keys(groups).forEach(function (h) {
      quality.push(q('warn', fileLabel + ': column not found (' + groups[h].join(', ') + '). This affects: ' + h + '.'));
    });
  }

  function makeGetters(cols, srcTz, bad) {
    return {
      get: function (row, c) { return cols[c] >= 0 ? String(row[cols[c]] == null ? '' : row[cols[c]]).trim() : ''; },
      ts: function (row, c) {
        if (cols[c] < 0) return null;
        var raw = String(row[cols[c]] == null ? '' : row[cols[c]]).trim();
        if (!raw) return null;
        var t = parseTimestamp(raw, srcTz);
        if (t == null) bad[c] = (bad[c] || 0) + 1;
        return t;
      }
    };
  }

  function reportBad(bad, quality, fileLabel) {
    Object.keys(bad).forEach(function (c) {
      quality.push(q('warn', fileLabel + ': ' + bad[c] + ' value(s) in "' + c + '" could not be read as a date and were ignored.'));
    });
  }

  function normalizeRole(raw, cfg) {
    if (!raw) return null;
    var k = String(raw).trim().toLowerCase();
    var roles = Object.keys(cfg.roleAliases);
    for (var i = 0; i < roles.length; i++) if (cfg.roleAliases[roles[i]].indexOf(k) !== -1) return roles[i];
    return null;
  }

  function boolOf(raw, cfg) {
    var k = String(raw || '').trim().toLowerCase();
    if (!k) return null;
    if (cfg.trueValues.indexOf(k) !== -1) return true;
    if (cfg.falseValues.indexOf(k) !== -1) return false;
    return null;
  }

  function namesList(obj) { return Object.keys(obj).map(function (pid) { return { pid: pid, name: obj[pid] }; }); }

  function nameFromRow(g, row) {
    var n = g.get(row, 'practitioner_name') || (g.get(row, 'practitioner_first_name') + ' ' + g.get(row, 'practitioner_last_name')).trim();
    return n.replace(/\s+/g, ' ');
  }

  function loadEncounters(csv, cfg) {
    var quality = [], cols = resolveColumns(csv.headers, cfg.columns.encounters), records = [];
    if (cols.practitioner_id < 0 || cols.encounter_id < 0) {
      quality.push(q('error', 'Encounters file: the required column(s) ' +
        [cols.practitioner_id < 0 ? 'practitioner_id' : '', cols.encounter_id < 0 ? 'encounter_id' : ''].filter(Boolean).join(' and ') +
        ' were not found. Add your column name to js/config.js.'));
      return { records: records, quality: quality, cols: cols };
    }
    var bad = {}, g = makeGetters(cols, cfg.sourceTimezone, bad), skipped = 0, unknownRole = 0, names = {};
    csv.rows.forEach(function (row) {
      var pid = g.get(row, 'practitioner_id'), eid = g.get(row, 'encounter_id');
      if (!pid || !eid) { skipped++; return; }
      var nm = nameFromRow(g, row); if (nm && !names[pid]) names[pid] = nm;
      var roleRaw = g.get(row, 'role'), role = normalizeRole(roleRaw, cfg);
      if (roleRaw && !role) unknownRole++;
      var secs = parseFloat(g.get(row, 'secs_active'));
      records.push({
        pid: pid, eid: eid, role: role,
        loc: g.get(row, 'locality').toUpperCase() || null,
        start: g.ts(row, 'started_at'), triaged: g.ts(row, 'triaged_completed_at'),
        firstResp: g.ts(row, 'first_responded_at'),
        cStart: g.ts(row, 'clinical_start'), cEnd: g.ts(row, 'clinical_end'),
        end: g.ts(row, 'ended_at'), joined: g.ts(row, 'joined_at'),
        secs: isNaN(secs) ? null : secs,
        pref: g.get(row, 'intake_preference').toLowerCase() || null,
        videoStart: g.ts(row, 'video_started_at'),
        hadVideo: cols.had_video_call >= 0 ? boolOf(g.get(row, 'had_video_call'), cfg) : null
      });
    });
    if (skipped) quality.push(q('warn', 'Encounters file: ' + skipped + ' row(s) had no provider ID or encounter ID and were skipped.'));
    if (unknownRole) quality.push(q('warn', 'Encounters file: ' + unknownRole + ' row(s) had a role that is not recognised. Add it to roleAliases in js/config.js.'));
    reportMissing(cols, quality, 'Encounters file');
    reportBad(bad, quality, 'Encounters file');
    return { records: records, quality: quality, cols: cols, names: namesList(names) };
  }

  function loadDirectory(csv, cfg) {
    var quality = [], cols = resolveColumns(csv.headers, cfg.columns.directory), records = [];
    var hasName = cols.name >= 0 || cols.first_name >= 0 || cols.last_name >= 0;
    if (cols.practitioner_id < 0 || !hasName) {
      quality.push(q('error', 'Names file: needs a practitioner_id column and a name column (or first_name and last_name). Add your column names to js/config.js.'));
      return { records: records, quality: quality, cols: cols };
    }
    var g = makeGetters(cols, cfg.sourceTimezone, {}), skipped = 0;
    csv.rows.forEach(function (row) {
      var pid = g.get(row, 'practitioner_id');
      var name = g.get(row, 'name') || (g.get(row, 'first_name') + ' ' + g.get(row, 'last_name')).trim();
      if (!pid || !name) { skipped++; return; }
      records.push({ pid: pid, name: name.replace(/\s+/g, ' ') });
    });
    if (skipped) quality.push(q('warn', 'Names file: ' + skipped + ' row(s) had no ID or no name and were skipped.'));
    return { records: records, quality: quality, cols: cols };
  }

  function classifyShiftType(raw, cfg) {
    var k = String(raw || '').toLowerCase();
    if (!k.trim()) return 'regular';
    var types = Object.keys(cfg.shiftTypeKeywords);
    for (var i = 0; i < types.length; i++) {
      var words = cfg.shiftTypeKeywords[types[i]];
      for (var j = 0; j < words.length; j++) if (k.indexOf(words[j]) !== -1) return types[i];
    }
    return 'regular';
  }

  function loadShifts(csv, cfg) {
    var quality = [], cols = resolveColumns(csv.headers, cfg.columns.shifts), records = [];
    var req = ['practitioner_id', 'start_at', 'end_at'].filter(function (c) { return cols[c] < 0; });
    if (req.length) {
      quality.push(q('error', 'Shifts file: the required column(s) ' + req.join(', ') + ' were not found. Add your column name to js/config.js.'));
      return { records: records, quality: quality, cols: cols };
    }
    var bad = {}, g = makeGetters(cols, cfg.sourceTimezone, bad), skipped = 0, unknownRole = 0, n = 0, names = {};
    csv.rows.forEach(function (row) {
      var pid = g.get(row, 'practitioner_id'), s = g.ts(row, 'start_at'), e = g.ts(row, 'end_at');
      if (!pid || s == null || e == null || e <= s) { skipped++; return; }
      var nm = nameFromRow(g, row); if (nm && !names[pid]) names[pid] = nm;
      var roleRaw = g.get(row, 'role'), role = normalizeRole(roleRaw, cfg);
      if (roleRaw && !role) unknownRole++;
      var typeRaw = g.get(row, 'shift_type');
      records.push({
        id: 'S' + (++n), pid: pid, start: s, end: e, role: role,
        typeRaw: typeRaw, type: classifyShiftType(typeRaw, cfg), careGroup: g.get(row, 'care_group_id') || null
      });
    });
    if (skipped) quality.push(q('warn', 'Shifts file: ' + skipped + ' row(s) were skipped (missing ID, or start/end time missing or end not after start).'));
    if (unknownRole) quality.push(q('warn', 'Shifts file: ' + unknownRole + ' row(s) had a role that is not recognised. Add it to roleAliases in js/config.js.'));
    reportMissing(cols, quality, 'Shifts file');
    reportBad(bad, quality, 'Shifts file');
    return { records: records, quality: quality, cols: cols, names: namesList(names) };
  }

  function loadEvents(csv, cfg) {
    var quality = [], cols = resolveColumns(csv.headers, cfg.columns.events), records = [];
    var req = ['practitioner_id', 'timestamp'].filter(function (c) { return cols[c] < 0; });
    if (req.length) {
      quality.push(q('error', 'Other-activity file: the required column(s) ' + req.join(', ') + ' were not found. Add your column name to js/config.js.'));
      return { records: records, quality: quality, cols: cols };
    }
    var bad = {}, g = makeGetters(cols, cfg.sourceTimezone, bad), skipped = 0;
    csv.rows.forEach(function (row) {
      var pid = g.get(row, 'practitioner_id'), t = g.ts(row, 'timestamp');
      if (!pid || t == null) { skipped++; return; }
      records.push({ pid: pid, t: t, source: g.get(row, 'source') || 'other', type: g.get(row, 'event_type') || '' });
    });
    if (skipped) quality.push(q('warn', 'Other-activity file: ' + skipped + ' row(s) were skipped (missing ID or time).'));
    reportMissing(cols, quality, 'Other-activity file');
    reportBad(bad, quality, 'Other-activity file');
    return { records: records, quality: quality, cols: cols };
  }

  // =====================================================================
  // MODEL
  // =====================================================================
  function mode(arr) {
    var m = {}, best = null, bc = 0;
    arr.forEach(function (v) {
      if (v == null || v === '') return;
      m[v] = (m[v] || 0) + 1;
      if (m[v] > bc) { bc = m[v]; best = v; }
    });
    return best;
  }
  function pushTo(map, k, v) { var a = map.get(k); if (!a) { a = []; map.set(k, a); } a.push(v); }

  function buildModel(cfg, data) {
    var enc = data.encounters || [], shifts = data.shifts || [], events = data.events || [];
    var m = {
      cfg: cfg, enc: enc, shifts: shifts, events: events, names: new Map(),
      encByPid: new Map(), shiftsByPid: new Map(), eventsByPid: new Map(),
      ivCache: new Map(), roleCache: new Map(), qsCache: null, quality: [], queueEncs: []
    };
    enc.forEach(function (r) { pushTo(m.encByPid, r.pid, r); });
    shifts.forEach(function (s) { pushTo(m.shiftsByPid, s.pid, s); });
    events.forEach(function (e) { pushTo(m.eventsByPid, e.pid, e); });
    shifts.forEach(function (s) { s.policy = policyOf(cfg, s.type); });
    (data.directory || []).forEach(function (d) { if (!m.names.has(d.pid)) m.names.set(d.pid, d.name); });

    var set = new Set();
    m.encByPid.forEach(function (_, k) { set.add(k); });
    m.shiftsByPid.forEach(function (_, k) { set.add(k); });
    m.providers = Array.from(set).sort();

    // Video check is only possible if the export has the preference AND some proof of a call.
    var c = data.encCols || {};
    m.videoCheck = { enabled: false, reason: '' };
    if (!enc.length) m.videoCheck.reason = 'No encounters file loaded.';
    else if (!(c.intake_preference >= 0)) m.videoCheck.reason = 'The encounters file has no intake preference column.';
    else if (!(c.video_started_at >= 0) && !(c.had_video_call >= 0)) m.videoCheck.reason = 'The encounters file has no column showing whether a video call happened.';
    else m.videoCheck.enabled = true;

    // One queue entry per encounter, filling blanks from any row of the same encounter.
    var byEnc = new Map();
    enc.forEach(function (r) {
      var o = byEnc.get(r.eid);
      if (!o) { byEnc.set(r.eid, { eid: r.eid, loc: r.loc, start: r.start, triaged: r.triaged, firstResp: r.firstResp, cStart: r.cStart, end: r.end }); return; }
      ['loc', 'start', 'triaged', 'firstResp', 'cStart', 'end'].forEach(function (f) { if (o[f] == null) o[f] = r[f]; });
    });
    var noStart = 0, noEnd = 0;
    byEnc.forEach(function (o) {
      if (o.start == null) { noStart++; return; }
      var waitEnd = o.firstResp != null ? o.firstResp : (o.cStart != null ? o.cStart : o.end);
      if (waitEnd == null || waitEnd <= o.start) { noEnd++; return; }
      var tri = o.triaged != null ? Math.min(Math.max(o.triaged, o.start), waitEnd) : null;
      m.queueEncs.push({ loc: o.loc, start: o.start, tri: tri, waitEnd: waitEnd });
    });
    m.queueStats = { total: byEnc.size, used: m.queueEncs.length, noStart: noStart, noEnd: noEnd };
    return m;
  }

  // ---------- searching by name or ID ----------
  function fold(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/,/g, ' ');
  }
  // Every word typed must appear somewhere in the name or ID, in any order,
  // so "smith jane", "jane smi" and "Smith, Jane" all find Jane Smith.
  function searchProviders(model, query, limit) {
    var tokens = fold(query).split(/\s+/).filter(Boolean);
    var out = { matches: [], noData: [] };
    if (!tokens.length) return out;
    var withData = {};
    model.providers.forEach(function (p) { withData[p] = 1; });
    function score(pid, name) {
      var id = fold(pid), nm = fold(name), hay = id + ' ' + nm;
      for (var i = 0; i < tokens.length; i++) if (hay.indexOf(tokens[i]) === -1) return -1;
      var full = tokens.join(' ');
      if (id === full || nm === full) return 0;
      if (nm.indexOf(tokens[0]) === 0 || nm.indexOf(' ' + tokens[0]) !== -1 || id.indexOf(tokens[0]) === 0) return 1;
      return 2;
    }
    var found = [];
    model.providers.forEach(function (pid) {
      var name = model.names.get(pid) || '', sc = score(pid, name);
      if (sc >= 0) found.push({ pid: pid, name: name, role: primaryRole(model, pid), score: sc });
    });
    found.sort(function (a, b) { return a.score - b.score || (a.name || a.pid).localeCompare(b.name || b.pid); });
    out.matches = found.slice(0, limit || 8);
    out.total = found.length;
    if (!found.length) {
      model.names.forEach(function (name, pid) {
        if (!withData[pid] && score(pid, name) >= 0 && out.noData.length < 5) out.noData.push({ pid: pid, name: name });
      });
    }
    return out;
  }

  function policyOf(cfg, type) { return cfg.shiftTypePolicy[type] || 'flag'; }

  function primaryRole(model, pid) {
    if (model.roleCache.has(pid)) return model.roleCache.get(pid);
    var r = mode((model.encByPid.get(pid) || []).map(function (x) { return x.role; })) ||
            mode((model.shiftsByPid.get(pid) || []).map(function (x) { return x.role; })) || null;
    model.roleCache.set(pid, r);
    return r;
  }

  // The stretches of time a provider was in consults.
  //   NP / MD : clinical start -> clinical end (falls back to joined -> encounter end)
  //   CM      : joined -> joined + engaged seconds. This is an ESTIMATE, marked low confidence,
  //             because without per-message data the real end of messaging is unknown.
  function intervalsFor(model, pid) {
    if (model.ivCache.has(pid)) return model.ivCache.get(pid);
    var rows = model.encByPid.get(pid) || [], prim = primaryRole(model, pid), out = [], seen = {}, dropped = 0;
    rows.forEach(function (r) {
      var role = r.role || prim || 'UNKNOWN', s, e, conf = 'normal';
      if (role === 'CM') {
        s = r.joined;
        e = (s != null && r.secs > 0) ? s + r.secs * 1000 : null;
        conf = 'low';
      } else {
        s = r.cStart != null ? r.cStart : r.joined;
        e = r.cEnd != null ? r.cEnd : r.end;
      }
      if (s == null || e == null || e <= s) { dropped++; return; }
      var key = r.eid + '|' + s;
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ s: s, e: e, eid: r.eid, conf: conf, role: role, loc: r.loc });
    });
    out.sort(function (a, b) { return a.s - b.s; });
    var val = { list: out, dropped: dropped };
    model.ivCache.set(pid, val);
    return val;
  }

  function mergeClipped(list, a, b) {
    var out = [];
    list.forEach(function (c) {
      var s = Math.max(c.s, a), e = Math.min(c.e, b);
      if (e <= s) return;
      var last = out[out.length - 1];
      if (last && s <= last.e) { last.e = Math.max(last.e, e); if (c.conf === 'low') last.conf = 'low'; }
      else out.push({ s: s, e: e, conf: c.conf });
    });
    return out;
  }

  function windowStats(list, a, b) {
    var seen = {}, count = 0;
    list.forEach(function (c) { if (c.s >= a && c.s < b && !seen[c.eid]) { seen[c.eid] = 1; count++; } });
    var busy = 0;
    mergeClipped(list, a, b).forEach(function (x) { busy += (x.e - x.s) / MIN; });
    return { count: count, busyMin: busy };
  }

  // Patients waiting, per minute, per province (and 'ALL' for the whole country).
  function buildQueueSeries(model, from, to) {
    var key = from + '|' + to;
    if (model.qsCache && model.qsCache.key === key) return model.qsCache.val;
    var n = Math.max(1, Math.ceil((to - from) / MIN)), locs = new Map();
    function get(l) {
      if (!locs.has(l)) locs.set(l, { intake: new Int32Array(n + 1), triaged: new Int32Array(n + 1) });
      return locs.get(l);
    }
    get('ALL');
    function add(arr, a, b) {
      var i0 = Math.max(0, Math.floor((a - from) / MIN)), i1 = Math.min(n, Math.ceil((b - from) / MIN));
      if (i1 <= i0) return;
      arr[i0] += 1; arr[i1] -= 1;
    }
    model.queueEncs.forEach(function (qe) {
      if (qe.waitEnd <= from || qe.start >= to) return;
      var targets = [get('ALL')];
      if (qe.loc) targets.push(get(qe.loc));
      targets.forEach(function (t) {
        if (qe.tri != null) { add(t.intake, qe.start, qe.tri); add(t.triaged, qe.tri, qe.waitEnd); }
        else add(t.intake, qe.start, qe.waitEnd);
      });
    });
    locs.forEach(function (t) {
      var a = 0, b = 0;
      for (var i = 0; i < n; i++) { a += t.intake[i]; t.intake[i] = a; b += t.triaged[i]; t.triaged[i] = b; }
    });
    var val = { from: from, n: n, locs: locs };
    model.qsCache = { key: key, val: val };
    return val;
  }

  function waitStats(series, loc, a, b) {
    var t = series.locs.get(loc) || series.locs.get('ALL');
    var i0 = Math.max(0, Math.floor((a - series.from) / MIN)), i1 = Math.min(series.n, Math.ceil((b - series.from) / MIN));
    var sumI = 0, sumT = 0, maxI = 0, maxT = 0, cnt = Math.max(1, i1 - i0);
    for (var i = i0; i < i1; i++) {
      sumI += t.intake[i]; sumT += t.triaged[i];
      if (t.intake[i] > maxI) maxI = t.intake[i];
      if (t.triaged[i] > maxT) maxT = t.triaged[i];
    }
    return { intakeAvg: sumI / cnt, intakeMax: maxI, triagedAvg: sumT / cnt, triagedMax: maxT };
  }

  // =====================================================================
  // AUDIT FOR ONE PROVIDER
  // =====================================================================
  function audit(model, pid, from, to) {
    var cfg = model.cfg, th = cfg.thresholds, quality = [];
    var rows = model.encByPid.get(pid) || [], allShifts = model.shiftsByPid.get(pid) || [];
    if (!rows.length && !allShifts.length) return { found: false };

    var primary = primaryRole(model, pid);
    var iv = intervalsFor(model, pid);
    var shifts = allShifts.filter(function (s) { return s.start >= from && s.start < to; })
      .sort(function (a, b) { return a.start - b.start; });
    var consults = iv.list.filter(function (c) { return c.e > from && c.s < to; });

    var lo = from, hi = to;
    shifts.forEach(function (s) { lo = Math.min(lo, s.start); hi = Math.max(hi, s.end); });
    consults.forEach(function (c) { lo = Math.min(lo, c.s); hi = Math.max(hi, c.e); });
    var series = buildQueueSeries(model, lo, hi);

    var inRange = rows.filter(function (r) {
      var t = r.cStart != null ? r.cStart : (r.joined != null ? r.joined : r.start);
      return t != null && t >= from && t < to;
    });
    var loc = mode(inRange.map(function (r) { return r.loc; })) || mode(rows.map(function (r) { return r.loc; })) || 'ALL';
    if (!series.locs.has(loc)) loc = 'ALL';

    var flags = [], fid = 0;
    function addFlag(f) { f.id = ++fid; f.pid = pid; flags.push(f); }

    shifts.forEach(function (s) {
      var role = s.role || primary || 'UNKNOWN';
      var thr = th.gapMinutes[role] != null ? th.gapMinutes[role] : th.gapMinutes.default;
      var merged = mergeClipped(iv.list, s.start, s.end);
      s.roleUsed = role; s.threshold = thr;
      s.consultCount = windowStats(iv.list, s.start, s.end).count;
      s.busyMin = 0;
      merged.forEach(function (x) { s.busyMin += (x.e - x.s) / MIN; });
      s.flagCount = 0;
      if (s.policy === 'suppress') return;

      var gaps = [], pointer = s.start, first = true;
      merged.forEach(function (x) {
        if (x.s > pointer) gaps.push({ a: pointer, b: x.s, kind: first ? 'leading' : 'between' });
        pointer = Math.max(pointer, x.e);
        first = false;
      });
      if (pointer < s.end) gaps.push({ a: pointer, b: s.end, kind: merged.length ? 'trailing' : 'whole' });

      gaps.forEach(function (gp) {
        var minutes = (gp.b - gp.a) / MIN, f = null;
        if (gp.kind === 'between' && minutes > thr) {
          f = { type: 'gap', label: 'Gap between consults', note: 'Longer than the ' + thr + ' minute limit for ' + role + '.' };
        } else if (gp.kind !== 'between' && minutes >= th.emptyBlockMinutes) {
          var where = gp.kind === 'leading' ? 'Nothing before the first consult.' :
                      gp.kind === 'trailing' ? 'Nothing after the last consult.' : 'No consults at all in this shift.';
          f = { type: 'empty', label: 'Empty block', note: where };
        }
        if (!f) return;
        if (s.policy === 'flag-labelled') f.note += ' ' + capitalize(s.type) + ' shift: review in context.';
        if (role === 'CM') f.note += ' Care manager times are estimated, so treat as a lead to check.';
        f.start = gp.a; f.end = gp.b; f.minutes = minutes; f.shiftId = s.id; f.shiftType = s.type; f.role = role;
        f.wait = waitStats(series, loc, gp.a, gp.b);
        f.conf = role === 'CM' ? 'low' : 'normal';
        s.flagCount++;
        addFlag(f);
      });
    });

    // No video call although the patient asked for video (NP / MD only).
    if (model.videoCheck.enabled) {
      var seenEnc = {};
      rows.forEach(function (r) {
        var role = r.role || primary;
        if (role !== 'NP' && role !== 'MD') return;
        if (!r.pref || cfg.videoRequestedValues.indexOf(r.pref) === -1) return;
        var t = r.cStart != null ? r.cStart : (r.joined != null ? r.joined : r.start);
        if (t == null || t < from || t >= to || seenEnc[r.eid]) return;
        seenEnc[r.eid] = 1;
        var had = r.hadVideo === true || r.videoStart != null;
        if (had) return;
        var f = { type: 'novideo', label: 'No video call', note: 'Patient chose video at intake. Encounter ' + r.eid + ' has no video call recorded.',
          start: t, end: t, minutes: 0, shiftId: null, shiftType: '', role: role, conf: 'normal', wait: null };
        addFlag(f);
      });
    }
    flags.sort(function (a, b) { return a.start - b.start; });

    // Data-quality notes that apply to this lookup
    if (!allShifts.length) quality.push(q('warn', 'No scheduled shifts found for this provider anywhere in the shifts file, so gaps cannot be checked.'));
    else if (!shifts.length) quality.push(q('warn', 'This provider has shifts in the file, but none start inside the chosen dates.'));
    if (!consults.length) quality.push(q('warn', 'No usable consult times found for this provider in the chosen dates.'));
    if (iv.dropped) quality.push(q('info', iv.dropped + ' encounter row(s) for this provider had no usable start and end time and were left out of the consult timeline.'));
    if (!primary) quality.push(q('warn', 'This provider\'s role (NP, MD or CM) is unknown, so the default ' + th.gapMinutes.default + ' minute gap limit was used.'));
    if (primary === 'CM' || consults.some(function (c) { return c.conf === 'low'; })) {
      quality.push(q('warn', 'Care manager data is low confidence. With no message-by-message data, consult time is estimated from joined time plus engaged seconds. A later return to a chart does not count as working time. Treat these flags as leads to check.'));
    }
    if (!model.videoCheck.enabled) quality.push(q('info', 'The "no video call" flag is off. ' + model.videoCheck.reason));
    quality.push(q('info', 'For NPs and MDs, consult start and end come from the encounter\'s clinical state times, so two providers touching the same encounter show the same consult window.'));

    return {
      found: true, pid: pid, role: primary, loc: loc, from: from, to: to,
      shifts: shifts, consults: consults, flags: flags, series: series, quality: quality,
      events: (model.eventsByPid.get(pid) || []).filter(function (e) { return e.t >= lo && e.t < hi; }),
      peers: peerComparison(model, pid, primary, shifts, series, loc)
    };
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  // How the provider compares with others of the same role working at the same time.
  function peerComparison(model, pid, role, shifts, series, loc) {
    var cfg = model.cfg, minOv = cfg.thresholds.minPeerOverlapMinutes * MIN;
    var mine = shifts.filter(function (s) { return s.policy !== 'suppress'; });
    if (!mine.length || !role) return { rows: [], overall: null };
    var lo = Math.min.apply(null, mine.map(function (s) { return s.start; }));
    var hi = Math.max.apply(null, mine.map(function (s) { return s.end; }));
    var others = model.shifts.filter(function (s) {
      return s.pid !== pid && s.end > lo && s.start < hi && s.type === 'regular' &&
        (s.role || primaryRole(model, s.pid)) === role;
    });
    var myList = intervalsFor(model, pid).list;
    var rows = [], tot = { myC: 0, myH: 0, myB: 0, pC: 0, pH: 0, pB: 0 };
    mine.forEach(function (s) {
      var my = windowStats(myList, s.start, s.end), hrs = (s.end - s.start) / 3600000;
      var peerSet = {}, pC = 0, pMin = 0, pBusy = 0;
      others.forEach(function (o) {
        var a = Math.max(s.start, o.start), b = Math.min(s.end, o.end);
        if (b - a < minOv) return;
        var st = windowStats(intervalsFor(model, o.pid).list, a, b);
        peerSet[o.pid] = 1; pC += st.count; pMin += (b - a) / MIN; pBusy += st.busyMin;
      });
      var w = waitStats(series, loc, s.start, s.end);
      var peerCount = Object.keys(peerSet).length;
      rows.push({
        shiftId: s.id, start: s.start, end: s.end, type: s.type, role: role, peerCount: peerCount,
        myPerHour: my.count / hrs, myBusyPct: 100 * my.busyMin / (hrs * 60),
        peerPerHour: pMin ? pC / (pMin / 60) : null, peerBusyPct: pMin ? 100 * pBusy / pMin : null,
        avgWaiting: w.intakeAvg + w.triagedAvg
      });
      tot.myC += my.count; tot.myH += hrs; tot.myB += my.busyMin;
      if (pMin) { tot.pC += pC; tot.pH += pMin / 60; tot.pB += pBusy; }
    });
    return {
      rows: rows,
      overall: {
        myPerHour: tot.myH ? tot.myC / tot.myH : null, myBusyPct: tot.myH ? 100 * tot.myB / (tot.myH * 60) : null,
        peerPerHour: tot.pH ? tot.pC / tot.pH : null, peerBusyPct: tot.pH ? 100 * tot.pB / (tot.pH * 60) : null
      }
    };
  }

  var api = {
    MIN: MIN, parseCSV: parseCSV, parseTimestamp: parseTimestamp, wallToEpoch: wallToEpoch,
    fmtHM: fmtHM, fmtDate: fmtDate, dayStart: dayStart, nextDayStart: nextDayStart, partsAt: partsAt,
    loadEncounters: loadEncounters, loadShifts: loadShifts, loadEvents: loadEvents, loadDirectory: loadDirectory,
    searchProviders: searchProviders, primaryRole: primaryRole,
    buildModel: buildModel, audit: audit, waitStats: waitStats, intervalsFor: intervalsFor,
    classifyShiftType: classifyShiftType, normalizeRole: normalizeRole, resolveColumns: resolveColumns
  };
  root.AuditCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
