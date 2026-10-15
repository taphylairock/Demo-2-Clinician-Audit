/* Run with:  node tests/run_tests.js   (needs Node.js; optional, only for developers) */
var assert = require('assert');
var cfg = JSON.parse(JSON.stringify(require('../js/config.js')));
var C = require('../js/core.js');
var passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; } }

var TZ = cfg.timezone, MIN = 60000;
function et(h, m) { return C.wallToEpoch(2026, 3, 2, h, m, 0, TZ); }          // 2 Mar 2026, Eastern
function iso(ms) { return new Date(ms).toISOString().replace('T', ' ').slice(0, 19); }
function csv(header, rows) { return header + '\n' + rows.join('\n'); }

console.log('CSV and time');
test('parses quotes, commas and blank lines', function () {
  var r = C.parseCSV('a,b,c\r\n1,"x, y",3\r\n\r\n"he said ""hi""",,\r\n');
  assert.deepStrictEqual(r.headers, ['a', 'b', 'c']);
  assert.deepStrictEqual(r.rows, [['1', 'x, y', '3'], ['he said "hi"', '', '']]);
});
test('UTC timestamp shows as Eastern (winter, UTC-5)', function () {
  assert.strictEqual(C.fmtHM(C.parseTimestamp('2026-03-02 14:05:00', 'UTC'), TZ), '09:05');
});
test('UTC timestamp shows as Eastern (summer, UTC-4)', function () {
  assert.strictEqual(C.fmtHM(C.parseTimestamp('2026-07-02T14:05:00Z', 'UTC'), TZ), '10:05');
});
test('offset timestamps and long month format', function () {
  assert.strictEqual(C.fmtHM(C.parseTimestamp('2026-03-02T06:05:00-08:00', 'UTC'), TZ), '09:05');
  assert.strictEqual(C.fmtHM(C.parseTimestamp('March 2, 2026, 2:05 PM', 'UTC'), TZ), '09:05');
  assert.strictEqual(C.parseTimestamp('not a date', 'UTC'), null);
});
test('a day is 23 hours when daylight saving starts', function () {
  var d = C.nextDayStart('2026-03-08', TZ) - C.dayStart('2026-03-08', TZ);
  assert.strictEqual(d / 3600000, 23);
});

console.log('Flags');
var EH = 'practitioner_id,role,encounter_id,locality,started_at,triaged_completed_at,medic_first_responded_at,telecall_clinical_state_started_at,telecall_clinical_state_ended_at,ended_at,participant_joined_at,secs_of_participants_activity,intake_preference,video_call_started_at';
var SH = 'practitioner_id,role,shift_type,start_at,end_at,care_group_id';
function enc(pid, role, id, arrive, triaged, cs, ce, joined, secs, pref, video) {
  return [pid, role, id, 'ON', iso(arrive), iso(triaged), iso(cs), iso(cs), iso(ce), iso(ce), iso(joined), secs == null ? '' : secs, pref || 'chat', video ? iso(video) : ''].join(',');
}
function shift(pid, role, type, a, b) { return [pid, role, type, iso(a), iso(b), 'g'].join(','); }
function build(encRows, shiftRows) {
  var e = C.loadEncounters(C.parseCSV(csv(EH, encRows)), cfg), s = C.loadShifts(C.parseCSV(csv(SH, shiftRows)), cfg);
  return C.buildModel(cfg, { encounters: e.records, shifts: s.records, events: [], encCols: e.cols });
}
function run(model, pid) { return C.audit(model, pid, C.dayStart('2026-03-02', TZ), C.nextDayStart('2026-03-02', TZ)); }

test('NP gap over 20 minutes is flagged; exactly 20 is not', function () {
  var m = build([
    enc('np1', 'NP', 'e1', et(9, 0), et(9, 3), et(9, 5), et(9, 30), et(9, 5)),
    enc('np1', 'NP', 'e2', et(9, 40), et(9, 43), et(9, 50), et(10, 20), et(9, 50)),   // 20 min gap: ok
    enc('np1', 'NP', 'e3', et(10, 30), et(10, 33), et(10, 45), et(11, 10), et(10, 45)) // 25 min gap: flag
  ], [shift('np1', 'NP', 'Regular', et(9, 0), et(11, 10))]);
  var f = run(m, 'np1').flags;
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].type, 'gap');
  assert.strictEqual(Math.round(f[0].minutes), 25);
});

test('CM limit is 15 minutes and CM flags are low confidence', function () {
  var m = build([
    enc('cm1', 'CM', 'e1', et(9, 0), et(9, 3), et(9, 5), et(9, 30), et(9, 5), 300),
    enc('cm1', 'CM', 'e2', et(9, 0), et(9, 3), et(9, 5), et(9, 30), et(9, 30), 300)
  ], [shift('cm1', 'CM', 'Regular', et(9, 0), et(9, 45))]);
  var r = run(m, 'cm1');
  var gap = r.flags.filter(function (x) { return x.type === 'gap'; });
  assert.strictEqual(gap.length, 1);
  assert.strictEqual(gap[0].conf, 'low');
  assert.ok(r.quality.some(function (x) { return /low confidence/i.test(x.text); }));
});

test('CM span from first message to later chart close is NOT counted as working time', function () {
  var m = build([
    enc('cm1', 'CM', 'e1', et(17, 0), et(17, 5), et(18, 0), et(20, 30), et(20, 30), 300)   // "joined" 20:30, 5 minutes active
  ], [shift('cm1', 'CM', 'Regular', et(20, 0), et(21, 0))]);
  var r = run(m, 'cm1');
  assert.strictEqual(r.shifts[0].busyMin, 5);
});

test('empty block flagged with patients waiting; shorter ones are not', function () {
  var m = build([
    enc('np1', 'NP', 'e1', et(9, 0), et(9, 3), et(9, 5), et(9, 30), et(9, 5)),
    enc('np2', 'NP', 'w1', et(10, 0), et(10, 10), et(11, 0), et(11, 20), et(11, 0))      // waits 10:00 -> 11:00
  ], [shift('np1', 'NP', 'Regular', et(9, 0), et(12, 0))]);
  var f = run(m, 'np1').flags;
  assert.strictEqual(f.length, 1);
  assert.strictEqual(f[0].type, 'empty');
  assert.strictEqual(f[0].wait.intakeMax, 1);
  assert.strictEqual(f[0].wait.triagedMax, 1);
});

test('queue counts intake and triaged separately per minute', function () {
  var m = build([
    enc('np1', 'NP', 'a', et(9, 0), et(9, 10), et(9, 30), et(9, 40), et(9, 30)),
    enc('np1', 'NP', 'b', et(9, 5), et(9, 15), et(9, 30), et(9, 40), et(9, 30))
  ], [shift('np1', 'NP', 'Regular', et(9, 0), et(10, 0))]);
  var series = C.audit(m, 'np1', C.dayStart('2026-03-02', TZ), C.nextDayStart('2026-03-02', TZ)).series;
  var s = C.waitStats(series, 'ON', et(9, 7), et(9, 8));          // both in intake
  assert.strictEqual(s.intakeMax, 2); assert.strictEqual(s.triagedMax, 0);
  s = C.waitStats(series, 'ON', et(9, 12), et(9, 13));            // a triaged, b intake
  assert.strictEqual(s.intakeMax, 1); assert.strictEqual(s.triagedMax, 1);
  s = C.waitStats(series, 'ON', et(9, 35), et(9, 36));            // nobody waiting
  assert.strictEqual(s.intakeMax + s.triagedMax, 0);
});

test('on-call and training shifts raise no flags; admin is flagged but labelled', function () {
  var m = build([enc('x', 'NP', 'e1', et(1, 0), et(1, 1), et(1, 2), et(1, 3), et(1, 2))], [
    shift('a', 'NP', 'On-call', et(9, 0), et(15, 0)), shift('b', 'NP', 'Training', et(9, 0), et(15, 0)),
    shift('c', 'NP', 'Admin shift', et(9, 0), et(15, 0))
  ]);
  assert.strictEqual(run(m, 'a').flags.length, 0);
  assert.strictEqual(run(m, 'b').flags.length, 0);
  var c = run(m, 'c').flags;
  assert.strictEqual(c.length, 1);
  assert.ok(/review in context/i.test(c[0].note));
});

test('no video call flag: NP only, only when video was requested', function () {
  var m = build([
    enc('np1', 'NP', 'v1', et(9, 0), et(9, 3), et(9, 5), et(9, 30), et(9, 5), 1500, 'video', null),          // flag
    enc('np1', 'NP', 'v2', et(9, 40), et(9, 43), et(9, 45), et(10, 10), et(9, 45), 1500, 'video', et(9, 46)), // had video
    enc('np1', 'NP', 'c1', et(10, 15), et(10, 17), et(10, 20), et(10, 40), et(10, 20), 1200, 'chat', null),   // chat requested
    enc('cm1', 'CM', 'v1', et(9, 0), et(9, 3), et(9, 5), et(9, 30), et(9, 6), 200, 'video', null)            // CM: ignored
  ], [shift('np1', 'NP', 'Regular', et(9, 0), et(10, 40)), shift('cm1', 'CM', 'Regular', et(9, 0), et(10, 0))]);
  var nv = run(m, 'np1').flags.filter(function (x) { return x.type === 'novideo'; });
  assert.strictEqual(nv.length, 1);
  assert.strictEqual(run(m, 'cm1').flags.filter(function (x) { return x.type === 'novideo'; }).length, 0);
});

test('no video check is switched off if the export has no video columns', function () {
  var e = C.loadEncounters(C.parseCSV('practitioner_id,encounter_id,started_at\nnp1,e1,2026-03-02 14:00:00'), cfg);
  var m = C.buildModel(cfg, { encounters: e.records, shifts: [], events: [], encCols: e.cols });
  assert.strictEqual(m.videoCheck.enabled, false);
});

test('peer comparison counts only regular shifts of the same role', function () {
  var rows = [
    enc('np1', 'NP', 'e1', et(9, 0), et(9, 3), et(9, 5), et(9, 35), et(9, 5)),
    enc('np2', 'NP', 'e2', et(9, 0), et(9, 3), et(9, 5), et(9, 35), et(9, 5)),
    enc('np2', 'NP', 'e3', et(9, 40), et(9, 43), et(9, 45), et(10, 15), et(9, 45)),
    enc('cm1', 'CM', 'e4', et(9, 0), et(9, 3), et(9, 5), et(9, 35), et(9, 5), 200)
  ];
  var m = build(rows, [shift('np1', 'NP', 'Regular', et(9, 0), et(10, 0)), shift('np2', 'NP', 'Regular', et(9, 0), et(10, 0)),
    shift('cm1', 'CM', 'Regular', et(9, 0), et(10, 0)), shift('np3', 'NP', 'Admin', et(9, 0), et(10, 0))]);
  var p = run(m, 'np1').peers;
  assert.strictEqual(p.rows[0].peerCount, 1);
  assert.ok(p.overall.peerPerHour > p.overall.myPerHour);
});

test('bad data does not crash: missing times and unknown columns', function () {
  var m = build(['np1,NP,e1,ON,,,,,,,,,chat,', 'np1,NP,e2,ON,not-a-date,,,,,,,,chat,'], [shift('np1', 'NP', 'Regular', et(9, 0), et(10, 0))]);
  var r = run(m, 'np1');
  assert.strictEqual(r.flags.length, 1);              // the whole 60-minute shift has no usable consults
  assert.strictEqual(C.audit(m, 'nobody', 0, 1).found, false);
});

console.log('Sample data');
test('sample data produces the flags the demo promises', function () {
  global.window = global.window || {};
  require('../js/sample_data.js');
  var S = global.window.SAMPLE_DATA;
  var e = C.loadEncounters(C.parseCSV(S.encounters), cfg), s = C.loadShifts(C.parseCSV(S.shifts), cfg), ev = C.loadEvents(C.parseCSV(S.events), cfg);
  assert.strictEqual(e.quality.filter(function (x) { return x.level === 'error'; }).length, 0);
  var m = C.buildModel(cfg, { encounters: e.records, shifts: s.records, events: ev.records, encCols: e.cols });
  var r = run(m, 'np_demo'), types = r.flags.map(function (x) { return x.type; });
  assert.ok(types.indexOf('gap') !== -1 && types.indexOf('empty') !== -1 && types.indexOf('novideo') !== -1);
  assert.strictEqual(run(m, 'np_call').flags.length, 0);
  assert.strictEqual(run(m, 'np_peer1').flags.length, 0);
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));
