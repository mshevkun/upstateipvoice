'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const srcDir = path.join(__dirname, '../planner/src');
const outDir = path.join(__dirname, '../planner/.test-build');
fs.mkdirSync(path.join(outDir, 'architect'), { recursive: true });

function transpile(rel) {
  let out = ts.transpile(fs.readFileSync(path.join(srcDir, rel + '.ts'), 'utf8'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  });
  out = out.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, "from '$1.mjs'");
  const dest = path.join(outDir, rel + '.mjs');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
}

transpile('architect/parse');
transpile('architect/scrub');

test('parsers: time, city, roster, lunch, callback, PMS, holidays', async () => {
  const p = await import(path.join(outDir, 'architect/parse.mjs'));
  const ranges = p.parseTimeRanges('8 AM to 5 PM and 12:30 to 1:30');
  assert.equal(ranges[0].start, '08:00');
  assert.equal(ranges[0].end, '17:00');
  const lunch = ranges.find(r => r.start === '12:30');
  assert.equal(lunch.end, '13:30');
  const nineToSeven = p.parseTimeRanges('9 to 7')[0];
  assert.equal(nineToSeven.end, '19:00');

  const city = p.parseCity("I'm opening my own family dental practice in Kingston, New York — Chen Family Dental. I've been an associate in Poughkeepsie for fourteen years.");
  assert.match(String(city[0].value), /Kingston/);
  assert.doesNotMatch(String(city[0].value), /Poughkeepsie/);

  const rhine = p.parseCity('I spent ten years as an associate in Poughkeepsie. Now I am opening Rhinebeck Family Dental in Rhinebeck, New York.');
  assert.match(String(rhine[0].value), /Rhinebeck/);

  const roster = p.parseRoster('Clinical side is me, an associate dentist joining in April, two hygienists, and two assistants. My husband is the office manager — billing, insurance, payroll.');
  assert.equal(roster.find(h => h.field_id === 'teams.clinical.count').value, 6);
  assert.equal(roster.find(h => h.field_id === 'teams.administration.count').value, 1);
  assert.equal(roster.find(h => h.field_id === 'billing.performed_by').value, 'administration');

  const lunchHints = p.parseLunch('Lunch is 12:30 to 1:30 Monday through Thursday — the desk is empty, phones should close. Friday is a short day, no lunch close.');
  assert.equal(lunchHints.find(h => h.field_id === 'hours.Monday.break_start').value, '12:30');
  assert.equal(lunchHints.find(h => h.field_id === 'hours.Friday.break_start').value, '');

  const before = p.parseBeforeOpening('Before we open, take a callback message. Do not advertise the number until that recording exists.');
  assert.equal(before[0].value, 'message');

  assert.equal(p.parsePMS("We'll run Open Dental")[0].value, 'Open Dental');
  assert.equal(p.parsePMS('We will run Compulink')[0].value, 'Compulink');

  const hol = p.parseHolidays('Thanksgiving and Christmas we are closed', 2027);
  assert.match(String(hol.find(h => h.field_id === 'hours.holidays').value), /2027-11-25/);
  assert.match(String(hol.find(h => h.field_id === 'hours.holidays').value), /2027-12-25/);

  const april = p.parseCity('We are opening in April. I do not have the exact day.');
  assert.equal(april.length, 0);
  const marchCity = p.parseCity("We're opening in March in Poughkeepsie.");
  assert.match(String(marchCity[0].value), /Poughkeepsie/);
  assert.doesNotMatch(String(marchCity[0].value), /March/);

  const langs = p.parseLanguages('English is enough. We do not need Spanish.');
  assert.equal(langs.find(h => h.field_id === 'languages.decision').value, 'none');

  const named = p.parsePracticeName('The name is Poughkeepsie Vision.');
  assert.equal(named[0].value, 'Poughkeepsie Vision');
  const arts = p.parsePracticeName('The practice name is Albany Dental Arts.');
  assert.equal(arts[0].value, 'Albany Dental Arts');

  const twoFront = p.parseRoster('Two at the front. I am the dentist, one assistant.');
  assert.equal(twoFront.find(h => h.field_id === 'teams.reception.count').value, 2);
  assert.equal(twoFront.find(h => h.field_id === 'teams.clinical.count').value, 2);

  const hours = p.parseHours('Answer the phones weekdays, nine to five. Closed Saturday and Sunday.');
  assert.equal(hours.find(h => h.field_id === 'hours.weekdays_start').value, '09:00');
  assert.equal(hours.find(h => h.field_id === 'hours.weekdays_end').value, '17:00');

  const first = p.parseRouting('The front desk person answers first. Whoever is at the front should answer.');
  assert.equal(first.find(h => h.field_id === 'first.kind').value, 'human');

  const slam = p.parseRouting("If both receptionists are with patients, take a message. If the front is slammed, ring my husband's work mobile.");
  assert.equal(slam.find(h => h.field_id === 'busy.kind').value, 'message');
  assert.equal(slam.find(h => h.field_id === 'busy.backup').value, 'admin');
  assert.equal(slam.find(h => h.field_id === 'devices.work_mobile.team').value, 'admin');

  const openingName = p.parsePracticeName('Opening Poughkeepsie Vision North, an eye care office in Poughkeepsie, New York.');
  assert.equal(openingName[0].value, 'Poughkeepsie Vision North');
  const smile = p.parsePracticeName('New dental practice in Albany, New York. Call it Albany Smile.');
  assert.equal(smile[0].value, 'Albany Smile');

  const noLunch = p.parseLunch('Closed Sunday. No lunch close.');
  assert.equal(noLunch.find(h => h.field_id === 'hours.lunch').value, 'covered');
  const spanishNo = p.parseLanguages('Spanish would be nice but we do not have anyone who speaks it.');
  assert.equal(spanishNo.find(h => h.field_id === 'languages.decision').value, 'none');
  const ortho = p.parsePracticeName('We are Bright Smiles Orthodontics. After hours we use an answering service called AnswerConnect.');
  assert.equal(ortho[0].value, 'Bright Smiles Orthodontics');
  const kingston = p.parsePracticeName('Kingston Eye Associates, existing optometry office. Yesterday patient John Smith called about his glasses and nobody answered.');
  assert.equal(kingston[0].value, 'Kingston Eye Associates');
  const chiro = p.parseOpening('Existing chiropractic office in Saratoga Springs.');
  assert.equal(chiro.find(h => h.field_id === 'specialty').value, 'Other healthcare practice');
  assert.equal(chiro.find(h => h.field_id === 'specialtyDetail').value, 'Chiropractic');
  const mixed = p.parseHours('Monday, Wednesday, Friday 7:30 to 6:30, Tuesday and Thursday 2 to 7, Saturday 8 to noon.');
  assert.equal(mixed.find(h => h.field_id === 'hours.Monday.start').value, '07:30');
  assert.equal(mixed.find(h => h.field_id === 'hours.Tuesday.start').value, '14:00');
  assert.equal(mixed.find(h => h.field_id === 'hours.Saturday.end').value, '12:00');
  assert.equal(mixed.some(h => h.field_id === 'hours.Friday.start' && h.value === '09:00'), false);
  const queue = p.parseRouting('If both front desk are busy, put callers in a queue with hold music for up to 2 minutes, then voicemail.');
  assert.equal(queue.find(h => h.field_id === 'busy.kind').value, 'queue');
  assert.equal(queue.find(h => h.field_id === 'busy.wait').value, 120);
  const service = p.parseRouting('after hours answering service');
  assert.equal(service.find(h => h.field_id === 'after.kind').value, 'service');
  const billing = p.parseRoster('Three receptionists, one billing person, four providers.');
  assert.equal(billing.find(h => h.field_id === 'teams.administration.count').value, 1);
});

test('scrub removes patient name, phone, email, DOB', async () => {
  const { scrubPii } = await import(path.join(outDir, 'architect/scrub.mjs'));
  const out = scrubPii('Call patient James Whitaker, date of birth June 2, 1978 at 845-555-1212 or a@b.com');
  assert.equal(out.removed, true);
  assert.doesNotMatch(out.text, /James Whitaker/);
  assert.doesNotMatch(out.text, /1978/);
  assert.doesNotMatch(out.text, /845-555-1212/);
  assert.doesNotMatch(out.text, /a@b.com/);
});
