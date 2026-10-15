/*
  Makes js/sample_data.js: a small, entirely MADE-UP day of data for the "Try sample data" button.
  Nothing here is real. Re-run with:  node tools/make_sample.js   (not needed for normal use)
*/
var fs = require('fs');
var path = require('path');

var seed = 42;
function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
function ri(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

var MIN = 60000;
var base = Date.UTC(2026, 2, 2, 14, 0, 0);            // 09:00 Eastern (UTC-5) on 2026-03-02
function at(h, m) { return base + ((h - 9) * 60 + m) * MIN; }
function iso(ms) { return ms == null ? '' : new Date(ms).toISOString().replace('T', ' ').slice(0, 19); }

var END = at(17, 0);
var providers = {
  np_peer1: { freeAt: at(9, 0), windows: [[at(9, 0), END]] },
  np_peer2: { freeAt: at(9, 0), windows: [[at(9, 0), END]] },
  np_demo: { freeAt: at(9, 0), windows: [[at(9, 5), at(10, 25)], [at(11, 10), at(12, 10)], [at(12, 35), at(13, 30)]] }
};

function earliest(p, ready) {
  var t = Math.max(ready, p.freeAt);
  for (var i = 0; i < p.windows.length; i++) {
    var w = p.windows[i], s = Math.max(t, w[0]);
    if (s <= w[1] - 15 * MIN) return { s: s, wEnd: w[1] };
  }
  return null;
}

var patients = [], demoVideoBlankDone = false;
for (var t = at(9, 0), n = 0; t <= at(15, 30); t += 5 * MIN + ri(-1, 1) * MIN, n++) {
  var tri = t + ri(3, 7) * MIN, best = null, bestName = null;
  Object.keys(providers).forEach(function (name) {
    var c = earliest(providers[name], tri);
    if (c && (!best || c.s < best.s)) { best = c; bestName = name; }
  });
  if (!best) continue;
  var dur = Math.min(ri(15, 30) * MIN, best.wEnd - best.s);
  providers[bestName].freeAt = best.s + dur + 2 * MIN;
  var wantsVideo = rnd() < 0.7;
  var videoStart = wantsVideo ? best.s + MIN : null;
  if (wantsVideo && bestName === 'np_demo' && best.s > at(11, 10) && !demoVideoBlankDone) { videoStart = null; demoVideoBlankDone = true; }
  patients.push({
    eid: 'enc_' + (1000 + n), prov: bestName, start: t, tri: tri, cs: best.s, ce: best.s + dur,
    end: best.s + dur + 2 * MIN, pref: wantsVideo ? 'video' : 'chat', video: videoStart
  });
}

var encHeader = 'practitioner_id,role,encounter_id,locality,started_at,triaged_completed_at,medic_first_responded_at,telecall_clinical_state_started_at,telecall_clinical_state_ended_at,ended_at,participant_joined_at,secs_of_participants_activity,intake_preference,video_call_started_at';
var encRows = [];
function encRow(pid, role, p, joined, secs) {
  encRows.push([pid, role, p.eid, 'ON', iso(p.start), iso(p.tri), iso(p.cs), iso(p.cs), iso(p.ce), iso(p.end),
    iso(joined), secs == null ? '' : secs, p.pref, iso(p.video)].join(','));
}
patients.forEach(function (p) { encRow(p.prov, 'NP', p, p.cs, Math.round((p.ce - p.cs) / 1000)); });

// Care managers message patients without taking ownership. cm_demo has long quiet stretches; cm_peer is steady.
function cmTouches(pid, times) {
  times.forEach(function (tm, i) {
    var joined = at(tm[0], tm[1]);
    var cand = patients.filter(function (p) { return p.start <= joined && joined < p.cs; });
    var p = cand.length ? cand[i % cand.length] : patients[i % patients.length];
    encRow(pid, 'CM', p, joined, ri(150, 300));
  });
}
cmTouches('cm_demo', [[9, 10], [9, 20], [9, 55], [10, 40], [12, 20], [12, 25], [15, 30]]);
var steady = [];
for (var m = 0; m < 8 * 60; m += 8) steady.push([9 + Math.floor(m / 60), m % 60]);
cmTouches('cm_peer', steady);

var shiftHeader = 'practitioner_id,role,shift_type,start_at,end_at,care_group_id';
var shiftRows = [];
['np_demo', 'np_peer1', 'np_peer2'].forEach(function (id) { shiftRows.push([id, 'NP', 'Regular', iso(at(9, 0)), iso(at(17, 0)), 'ON-NP'].join(',')); });
['cm_demo', 'cm_peer'].forEach(function (id) { shiftRows.push([id, 'CM', 'Regular', iso(at(9, 0)), iso(at(17, 0)), 'ON-CM'].join(',')); });
shiftRows.push(['np_call', 'NP', 'On-call', iso(at(17, 0)), iso(at(23, 0)), 'ON-NP'].join(','));
shiftRows.push(['np_admin', 'NP', 'Admin', iso(at(9, 0)), iso(at(12, 0)), 'ON-NP'].join(','));

var evHeader = 'practitioner_id,timestamp,source,event_type';
var evRows = [
  ['np_demo', at(10, 40), 'Slack', 'message_sent'], ['np_demo', at(10, 55), 'CHR', 'chart_opened'],
  ['np_demo', at(12, 15), 'Slack', 'message_sent'], ['np_demo', at(14, 20), 'Slack', 'message_sent'],
  ['cm_demo', at(11, 5), 'Slack', 'message_sent'], ['cm_demo', at(13, 45), 'Slack', 'message_sent']
].map(function (r) { return [r[0], iso(r[1]), r[2], r[3]].join(','); });

var dirRows = ['np_demo,Nora Demo', 'np_peer1,Sam Peer-One', 'np_peer2,Jo Peer-Two', 'cm_demo,Casey Demo', 'cm_peer,Drew Peer', 'np_call,Quinn Oncall', 'np_admin,Avery Admin'];

var out = 'window.SAMPLE_DATA = ' + JSON.stringify({
  note: 'Made-up data for demonstration only.',
  directory: 'practitioner_id,name\n' + dirRows.join('\n'),
  suggestedProvider: 'np_demo', suggestedStart: '2026-03-02', suggestedEnd: '2026-03-02',
  encounters: encHeader + '\n' + encRows.join('\n'),
  shifts: shiftHeader + '\n' + shiftRows.join('\n'),
  events: evHeader + '\n' + evRows.join('\n')
}) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'js', 'sample_data.js'), '// Generated by tools/make_sample.js. All data is invented.\n' + out);
console.log('wrote js/sample_data.js with ' + patients.length + ' patients and ' + encRows.length + ' encounter rows');
