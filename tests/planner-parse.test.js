'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { prepareBuild } = require('./planner-transpile');

const { outDir } = prepareBuild(path.basename(__filename, '.test.js'));

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

  const missVoicemail = p.parseRouting('The receptionist answers first. If she misses the call, take a voicemail for her.');
  assert.equal(missVoicemail.find(h => h.field_id === 'first.team')?.value, 'reception');
  assert.equal(missVoicemail.some(h => h.field_id === 'policy.ring' && h.value === 'order'), false);

  const hateMenus = p.parseRouting('I hate menus. Do not build press one, press two.');
  assert.equal(hateMenus.find(h => h.field_id === 'first.kind')?.value, 'human');
  assert.equal(hateMenus.some(h => h.field_id === 'first.team' && h.value === 'reception'), false);

  const doctorFirst = p.parseRouting('While the office is open, calls go to the doctor. I mean every call, not just emergencies.');
  assert.equal(doctorFirst.find(h => h.field_id === 'first.team')?.value, 'clinical');

  const dolphin = p.parsePMS('We use Dolphin. After hours we use an answering service called AnswerConnect.');
  assert.equal(dolphin[0]?.value, 'Dolphin');

  const seniorThen = p.parseRouting('Opening Cascade Dental in Troy. Ring the senior desk first, then the other if she misses it. Front desk first. After hours voicemail.');
  assert.equal(seniorThen.find(h => h.field_id === 'policy.ring')?.value, 'order');

  const missMailbox = p.parseRouting('The receptionist answers first. If she misses the call, take a voicemail for her. After hours voicemail.');
  assert.equal(missMailbox.some(h => h.field_id === 'policy.ring' && h.value === 'order'), false);

  const bothPickup = p.parseRouting('Two receptionists. They can both pick up at once on separate lines. Front desk first.');
  assert.equal(bothPickup.find(h => h.field_id === 'policy.ring')?.value, 'together');
  assert.equal(bothPickup.find(h => h.field_id === 'devices.reception.sharing')?.value, 'separate');

  const bought = p.parseOpening("We bought Dr. Miller's old office in Fishkill. Same patients, same number. Don't give me a new number.");
  assert.equal(bought.find(h => h.field_id === 'mode')?.value, 'improving');
  assert.equal(bought.find(h => h.field_id === 'opening.numbers')?.value, 'porting');

  const bareChiro = p.parseOpening('chiro in warwick ny, keep number');
  assert.equal(bareChiro.find(h => h.field_id === 'specialtyDetail')?.value, 'Chiropractic');
  assert.equal(bareChiro.find(h => h.field_id === 'mode')?.value, 'improving');

  const spa = p.parseOpening('Opening Glow Med Spa in Beacon May 2027.');
  assert.equal(spa.find(h => h.field_id === 'specialty')?.value, 'Other healthcare practice');
  assert.equal(spa.find(h => h.field_id === 'specialtyDetail')?.value, 'Med spa');
  const spaName = p.parsePracticeName('Opening Glow Med Spa in Beacon May 2027.');
  assert.equal(spaName[0]?.value, 'Glow Med Spa');

  const daughter = p.parseRoster("My daughter answers the phones at the front desk, she's the only one.");
  assert.equal(daughter.find(h => h.field_id === 'teams.reception.count')?.value, 1);
  const mom = p.parseRoster('Two at the front. My mom does insurance from home, she is not a receptionist.');
  assert.equal(mom.find(h => h.field_id === 'teams.reception.count')?.value, 2);
  assert.equal(mom.find(h => h.field_id === 'teams.administration.count')?.value, 1);
  assert.equal(mom.find(h => h.field_id === 'billing.performed_by')?.value, 'administration');
  const soloStaff = p.parseRoster("It's just me, solo dentist. No staff.");
  assert.equal(soloStaff.find(h => h.field_id === 'teams.reception.count')?.value, 0);
  const oneFront = p.parseRoster('chiro in warwick, 1 front, 2 docs');
  assert.equal(oneFront.find(h => h.field_id === 'teams.reception.count')?.value, 1);

  const leaveFri = p.parseHours('Existing Hudson dental. Weekdays 9 to 5 but Fridays we leave at 2.');
  assert.equal(leaveFri.find(h => h.field_id === 'hours.Friday.end')?.value, '14:00');
  assert.equal(leaveFri.find(h => h.field_id === 'hours.Monday.end')?.value, '17:00');

  const skipOtherTown = p.parseHours('This plan is Troy. Albany is 8 to 6. I am not giving Troy hours today.');
  assert.equal(skipOtherTown.length, 0);

  const bounceFri = p.parseHours('The girls bounce at 2 on Friday. Rest of the week 9-5.');
  assert.equal(bounceFri.find(h => h.field_id === 'hours.Friday.end')?.value, '14:00');
  assert.equal(bounceFri.find(h => h.field_id === 'hours.Monday.end')?.value, '17:00');

  const closedWed = p.parseHours('Closed Wednesdays. Open 8-6 otherwise weekdays.');
  assert.equal(closedWed.find(h => h.field_id === 'hours.Wednesday.open')?.value, false);
  assert.equal(closedWed.find(h => h.field_id === 'hours.Thursday.start')?.value, '08:00');
  assert.equal(closedWed.find(h => h.field_id === 'hours.Thursday.end')?.value, '18:00');

  const planBeacon = p.parseCity('Adding a Beacon office, home is Newburgh. This plan is Beacon.');
  assert.match(String(planBeacon[0]?.value), /Beacon/i);
  assert.doesNotMatch(String(planBeacon[0]?.value), /Newburgh/i);

  const existingOffice = p.parseCity('This is my existing dental office in Poughkeepsie, New York.');
  assert.match(String(existingOffice[0]?.value), /Poughkeepsie/i);
  assert.doesNotMatch(String(existingOffice[0]?.value), /existing/i);

  const dontPort = p.parseOpening("Don't port. I want a fresh number. Opening Rosendale Family Dental.");
  assert.equal(dontPort.find(h => h.field_id === 'opening.numbers')?.value, 'new');
  const ops = p.parseOpening("3 ops in Millbrook. Don't put a phone in every room.");
  assert.equal(ops.find(h => h.field_id === 'policy.rooms')?.value, 3);
  const eaglesoft = p.parsePMS('Eaglesoft not Dentrix.');
  assert.equal(eaglesoft[0]?.value, 'Eaglesoft');
  const hangup = p.parseRouting("After hours just hang up, play the hours, don't take a message.");
  assert.equal(hangup.find(h => h.field_id === 'after.kind')?.value, 'information');
  const exceptThu = p.parseHours('Open til 7 weekdays except Thursday we close at 3.');
  assert.equal(exceptThu.find(h => h.field_id === 'hours.Monday.end')?.value, '19:00');
  assert.equal(exceptThu.find(h => h.field_id === 'hours.Thursday.end')?.value, '15:00');

  const weekendSmile = p.parseHours('Opening Weekend Smile Dental in Kingston. Weekdays 9 to 5, Saturdays 9 to 1, closed Sunday.');
  assert.equal(weekendSmile.find(h => h.field_id === 'hours.Saturday.open')?.value, true);
  assert.equal(weekendSmile.find(h => h.field_id === 'hours.Saturday.end')?.value, '13:00');
  assert.equal(weekendSmile.find(h => h.field_id === 'hours.Sunday.open')?.value, false);

  const nightVm = p.parseRouting("Hyde Park Family Dental, existing. Nighttime voicemail. I don't want a menu.");
  assert.equal(nightVm.find(h => h.field_id === 'after.kind')?.value, 'message');
  const terseVm = p.parseRouting('after hours vm, keep number');
  assert.equal(terseVm.find(h => h.field_id === 'after.kind')?.value, 'message');

  const soloCell = p.parseRouting("It's just me. I'll answer between patients on my cell.");
  assert.equal(soloCell.find(h => h.field_id === 'first.team')?.value, 'clinical');

  const goDown = p.parseRouting("Don't ring all of them at once, go down the list. Two receptionists. Front desk first.");
  assert.equal(goDown.find(h => h.field_id === 'policy.ring')?.value, 'order');
  const stagger = p.parseRouting('Stagger the phones, ten seconds apart. Two receptionists. Front desk first.');
  assert.equal(stagger.find(h => h.field_id === 'policy.ring')?.value, 'order');
  const huntPhones = p.parseRouting('Hunt the phones, one then the next. Two receptionists. Front desk first.');
  assert.equal(huntPhones.find(h => h.field_id === 'policy.ring')?.value, 'order');

  const usedTo = p.parseRouting('We used to use AnswerConnect, now just vm after hours.');
  assert.equal(usedTo.find(h => h.field_id === 'after.kind')?.value, 'message');
  const notVm = p.parseRouting('After hours ring my cell, not voicemail.');
  assert.equal(notVm.some(h => h.field_id === 'after.kind' && h.value === 'message'), false);
  const dontBuild = p.parseRouting("Don't build press 1. Two at the front. After hours voicemail.");
  assert.equal(dontBuild.find(h => h.field_id === 'first.kind')?.value, 'human');
  assert.notEqual(dontBuild.find(h => h.field_id === 'first.kind')?.value, 'menu');

  const stillDentrix = p.parsePMS('We still use Dentrix, not switching to Open Dental.');
  assert.equal(stillDentrix[0]?.value, 'Dentrix');

  const takingOver = p.parseOpening("I'm taking over the Millbrook office, not opening a new one. Same number.");
  assert.equal(takingOver.find(h => h.field_id === 'mode')?.value, 'improving');
  const relocating = p.parseOpening("We're not adding a second office, we're relocating from Kingston to Rhinebeck.");
  assert.equal(relocating.find(h => h.field_id === 'mode')?.value, 'improving');
  const familyMed = p.parseOpening('Opening in Beacon, family medicine, not a dental office.');
  assert.equal(familyMed.find(h => h.field_id === 'specialty')?.value, 'Other healthcare practice');
  assert.equal(familyMed.find(h => h.field_id === 'specialtyDetail')?.value, 'Family medicine');
  const onGoogle = p.parseOpening('The number is already on Google. Existing Beacon dental.');
  assert.equal(onGoogle.find(h => h.field_id === 'opening.numbers')?.value, 'porting');

  const noSpanish = p.parseLanguages("We don't do Spanish.");
  assert.equal(noSpanish.find(h => h.field_id === 'languages.decision')?.value, 'none');

  const eatDesk = p.parseLunch("We eat at the desk, don't close the phones for lunch. Lunch 12-1.");
  assert.equal(eatDesk.find(h => h.field_id === 'hours.lunch')?.value, 'covered');
  assert.equal(eatDesk.some(h => /break_start/.test(h.field_id)), false);

  const wedShort = p.parseHours('Wednesday is a short day, we close at 1. Weekdays 9-5.');
  assert.equal(wedShort.find(h => h.field_id === 'hours.Wednesday.end')?.value, '13:00');
  assert.equal(wedShort.find(h => h.field_id === 'hours.Friday.end')?.value, '17:00');
  const noonFri = p.parseHours('We close at noon on Fridays. Rest of the week 8-4.');
  assert.equal(noonFri.find(h => h.field_id === 'hours.Friday.end')?.value, '12:00');
  assert.equal(noonFri.find(h => h.field_id === 'hours.Monday.end')?.value, '16:00');
  const seven = p.parseHours("We're open 7 days, 9 to 2.");
  assert.equal(seven.find(h => h.field_id === 'hours.Saturday.open')?.value, true);
  assert.equal(seven.find(h => h.field_id === 'hours.Sunday.end')?.value, '14:00');
  const everyOtherSat = p.parseHours('Closed every other Saturday. Weekdays 9-5.');
  assert.notEqual(everyOtherSat.find(h => h.field_id === 'hours.Saturday.open')?.value, false);

  const blast = p.parseRouting('Blast all the phones at once. Two receptionists. Front desk first.');
  assert.equal(blast.find(h => h.field_id === 'policy.ring')?.value, 'together');
  const grabs = p.parseRouting('Whoever is free grabs it. Two receptionists. Front desk first.');
  assert.equal(grabs.find(h => h.field_id === 'policy.ring')?.value, 'together');
  const hateHold = p.parseRouting("I hate hold music, just vm if they're busy. After hours voicemail.");
  assert.equal(hateHold.find(h => h.field_id === 'busy.kind')?.value, 'message');
  assert.notEqual(hateHold.find(h => h.field_id === 'busy.kind')?.value, 'queue');
  const noMailbox = p.parseRouting('After hours let it ring, no mailbox.');
  assert.equal(noMailbox.some(h => h.field_id === 'after.kind' && h.value === 'message'), false);

  const french = p.parseLanguages('We speak French, not Spanish.');
  assert.equal(french.find(h => h.field_id === 'languages.name')?.value, 'French');
  assert.equal(french.some(h => h.field_id === 'languages.spanish' && h.value === true), false);

  const wifeBoth = p.parseRoster('My wife and I both answer. Existing Red Hook dental.');
  assert.equal(wifeBoth.find(h => h.field_id === 'teams.reception.count')?.value, 2);
  const aunt = p.parseRoster('Aunt does the billing from her laptop, she is not a receptionist. Two at the front.');
  assert.equal(aunt.find(h => h.field_id === 'teams.reception.count')?.value, 2);
  assert.equal(aunt.find(h => h.field_id === 'teams.administration.count')?.value, 1);

  const wedNoon = p.parseHours('Wednesdays we bounce at noon. Rest of the week 8-4.');
  assert.equal(wedNoon.find(h => h.field_id === 'hours.Wednesday.end')?.value, '12:00');
  assert.equal(wedNoon.find(h => h.field_id === 'hours.Thursday.end')?.value, '16:00');

  const podiatry = p.parseOpening('Opening in Beacon, it is a podiatry office.');
  assert.equal(podiatry.find(h => h.field_id === 'specialtyDetail')?.value, 'Podiatry');
  const soloOrtho = p.parseOpening('Solo ortho in Warwick. Keep number. Been here forever.');
  assert.equal(soloOrtho.find(h => h.field_id === 'specialty')?.value, 'Dental');
  const ownsOther = p.parseOpening('I already own Kingston. This plan is Red Hook. New number for Red Hook.');
  assert.equal(ownsOther.find(h => h.field_id === 'mode')?.value, 'adding');
  const movedPms = p.parsePMS('We moved from Dentrix to Eaglesoft.');
  assert.equal(movedPms[0]?.value, 'Eaglesoft');
  const google845 = p.parseOpening('The Google Business listing has the 845. Existing Fishkill dental.');
  assert.equal(google845.find(h => h.field_id === 'opening.numbers')?.value, 'porting');
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
