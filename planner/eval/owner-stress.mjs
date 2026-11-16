#!/usr/bin/env node
/**
 * Extra owner dumps that are not in gold/real-life. Failures here are engine bugs,
 * not missing fixtures. Uses the same interpretTurn path as the live brain.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'planner/src');
const buildDir = path.join(root, 'planner/.stress-build');
fs.mkdirSync(path.join(buildDir, 'architect'), { recursive: true });

function transpile(rel) {
  let out = ts.transpile(fs.readFileSync(path.join(srcDir, rel + '.ts'), 'utf8'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  });
  out = out.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, "from '$1.mjs'");
  fs.mkdirSync(path.dirname(path.join(buildDir, rel + '.mjs')), { recursive: true });
  fs.writeFileSync(path.join(buildDir, rel + '.mjs'), out);
}

for (const name of [
  'config', 'policy', 'locations', 'routing', 'flow', 'team-state', 'state',
  'architect/schema', 'architect/fields', 'architect/clauses', 'architect/parse', 'architect/extract', 'architect/ack',
  'architect/merge', 'architect/questions', 'architect/turn', 'architect/scene-from-plan',
  'architect/hear', 'architect/scrub', 'provisioning', 'bom', 'opening', 'status',
  'readiness', 'advisor', 'privacy'
])
  transpile(name);

const { initial } = await import(path.join(buildDir, 'config.mjs'));
const { interpretTurn, chipTurn } = await import(path.join(buildDir, 'architect/turn.mjs'));
const { hoursSummary } = await import(path.join(buildDir, 'flow.mjs'));
const { scrubPii } = await import(path.join(buildDir, 'architect/scrub.mjs'));

const blank = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };

function play(turns) {
  let plan = initial();
  let facts = {};
  let follow = null;
  let ack = '';
  const log = [];
  for (const turn of turns) {
    if (turn && typeof turn === 'object' && turn.chip) {
      const chip = (follow?.options || []).find(o => o.value === turn.chip || o.id === turn.chip)
        || { id: turn.chip, label: turn.chip, field_id: turn.field_id || 'urgent.scope', value: turn.chip, operation: 'set' };
      const step = chipTurn({ plan, facts, chip });
      plan = step.plan; facts = step.facts; follow = step.follow; ack = step.ack || ack;
      log.push({ chip: turn.chip, ack, next: follow?.id });
      continue;
    }
    const step = interpretTurn({ plan, facts, interpreter: blank, userText: turn, question: follow });
    plan = step.plan; facts = step.facts; follow = step.follow; ack = step.ack;
    log.push({ text: turn, ack, next: follow?.id });
  }
  return { plan, facts, follow, ack, log };
}

const CASES = [
  {
    id: 'S01-cascade-name-is-not-ring-order',
    turns: ['Opening Cascade Dental in Troy May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number.'],
    expect: ({ plan }) => plan.policy.ring !== 'order'
  },
  {
    id: 'S02-senior-then-junior-after-hours-voicemail',
    turns: ['Opening Cascade Dental in Troy May 2027. Two receptionists. Ring the senior desk first, then the other if she misses it. Front desk first. After hours voicemail. Weekdays 9-5.'],
    expect: ({ plan }) => plan.policy.ring === 'order'
  },
  {
    id: 'S03-miss-then-voicemail-not-order',
    turns: ['Existing Kingston dental. Front desk first. If she misses the call, take a voicemail for her. After hours voicemail.'],
    expect: ({ plan }) => plan.policy.ring !== 'order' && plan.after.kind === 'message'
  },
  {
    id: 'S04-both-pick-up-together',
    turns: ['Opening Dual Pickup Dental in Kingston May 2027. Two receptionists. They can both pick up at once on separate lines. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.policy.ring === 'together'
  },
  {
    id: 'S05-hate-menus-does-not-wipe-doctor-first',
    turns: [
      'I have an eye care office in Newburgh and I am adding one in Beacon. This plan is the Beacon office. During open hours calls go to the doctor. I mean every call, not just emergencies.',
      'I hate menus. Do not build press one, press two.'
    ],
    expect: ({ plan }) => plan.first.team === 'clinical' && plan.first.kind === 'human' && /Beacon/i.test(plan.policy.cityState)
  },
  {
    id: 'S06-this-plan-is-new-city',
    turns: ['We have an eye care office in Albany, New York. I am adding one in Troy, New York. The plan I want is the Troy office.'],
    expect: ({ plan }) => /Troy/i.test(plan.policy.cityState) && plan.mode === 'adding'
  },
  {
    id: 'S07-home-answers-both-keeps-home-city',
    turns: ["We already have Kingston Family Dental. We're adding a second office in New Paltz under the same number. Two receptionists at Kingston answer both."],
    expect: ({ plan }) => /Kingston/i.test(plan.policy.cityState) && plan.mode === 'adding'
  },
  {
    id: 'S08-dolphin-and-answerconnect',
    turns: ['We are Bright Smiles Orthodontics in Albany. We use Dolphin. After hours we use an answering service called AnswerConnect.'],
    expect: ({ plan }) => /Dolphin/i.test(plan.policy.opening.pms || '') && plan.after.kind === 'service' && !/AnswerConnect/i.test(plan.name)
  },
  {
    id: 'S09-lunch-before-hours-not-closed-week',
    turns: ['Existing Beacon eye office. We close for lunch from 12 to 1.'],
    expect: ({ plan, follow }) => !/Closed all week/i.test(hoursSummary(plan)) && follow?.id !== 'hours.rest_closed'
  },
  {
    id: 'S10-family-eye-is-eye-care',
    turns: ["We're Rivertown Family Eye in Beacon."],
    expect: ({ plan, follow }) => plan.specialty === 'Eye care' && follow?.id !== 'specialty'
  },
  {
    id: 'S11-phi-not-in-plan',
    turns: ['Opening Safe Harbor Dental in Kingston May 2027. Two receptionists. Front desk first. Yesterday patient James Whitaker DOB 03/04/1990 called, email james@example.com. After hours voicemail.'],
    expect: ({ plan, ack }) => {
      const blob = JSON.stringify(plan) + ack;
      return !/James Whitaker|james@example\.com|03\/04\/1990/.test(blob);
    }
  },
  {
    id: 'S12-rooms-not-desk-phones',
    turns: ['Opening Chair Count Dental in Hudson. Eight treatment rooms. I want one desk phone at the front. The rooms do not get phones. One receptionist. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.policy.rooms === 8 && plan.endpoints.desk !== 8
  },
  {
    id: 'S13-clinical-none-does-not-ask-rooms',
    setup() {
      let plan = initial(), facts = {}, follow = null;
      const first = interpretTurn({
        plan, facts, interpreter: blank,
        userText: 'Existing dental in Troy. Two front desk. Two doctors. Front desk first. After hours voicemail, no on-call. Monday through Friday 9 to 5.',
        question: null
      });
      plan = first.plan; facts = first.facts; follow = first.follow;
      let guard = 0;
      while (follow && follow.id !== 'devices.clinical.area' && guard++ < 40) {
        const chip = follow.options.find(o => o.operation === 'set') || follow.options.find(o => o.operation === 'skip');
        if (!chip) break;
        const step = chipTurn({ plan, facts, chip });
        plan = step.plan; facts = step.facts; follow = step.follow;
      }
      if (follow?.id === 'devices.clinical.area') {
        const none = follow.options.find(o => o.value === 'none');
        const step = chipTurn({ plan, facts, chip: none });
        plan = step.plan; facts = step.facts; follow = step.follow;
      }
      return { plan, facts, follow, ack: '' };
    },
    expect: ({ follow }) => follow?.id !== 'policy.rooms'
  },
  {
    id: 'S14-replacing-phones-is-improving',
    turns: ['We are replacing our old phone system at an existing practice in Newburgh.'],
    expect: ({ plan, ack }) => plan.mode === 'improving' && !/^A new /i.test(ack)
  },
  {
    id: 'S15-no-on-call-not-clinician-path',
    turns: ['Existing practice. Nobody on call. Just voicemail after hours. Front desk answers during the day.'],
    expect: ({ plan }) => plan.policy.urgentKind === 'none' && !plan.policy.pendingClinicianRoute && plan.after.kind === 'message'
  },
  {
    id: 'S16-opening-not-improving-family-dental',
    turns: ['We are opening Bright River Family Dental in Kingston June 2027. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.mode === 'opening'
  },
  {
    id: 'S17-english-only-no-spanish-row',
    turns: ["Opening English Only Dental in Kingston. Two receptionists. Front desk first. English is enough — we don't need Spanish. After hours voicemail."],
    expect: ({ plan }) => plan.policy.languageDecision === 'none' || !plan.languages.some(l => /spanish/i.test(l.name || '') && l.mechanism)
  },
  {
    id: 'S18-scrub-function-covers-dump',
    turns: ['dummy'],
    expect: () => {
      const cleaned = scrubPii('patient James Whitaker, date of birth June 2, 1978, email james@example.com, phone 555-111-2222');
      return cleaned.removed && !/James Whitaker|1978|james@example|555-111-2222/.test(cleaned.text);
    }
  },
  {
    id: 'S19-hear-lunch-not-overnight',
    turns: [
      'Existing Kingston dental. Front desk first. Weekdays 9 to 5. We close for lunch noon to one — phones go to voicemail. After hours voicemail. No on-call.'
    ],
    expect: ({ plan, follow }) => {
      const lunch = plan.hours.days.some(d => d.breakStart === '12:00' && d.breakEnd === '13:00');
      return lunch && plan.after.kind === 'message' && follow?.id !== 'hours.rest_closed';
    }
  },
  {
    id: 'S20-manager-overflow-is-backup-not-order',
    turns: ['Opening Manager Seat Dental in Beacon. Two receptionists and one office manager. Front desk first. If the front desk misses a call, try the office manager next, then voicemail if she misses it too. After hours voicemail. Weekdays 9-5.'],
    expect: ({ plan }) => plan.busy.kind === 'backup' && plan.policy.ring !== 'order'
  }
];

const REAL = [
  {
    id: 'E01-wappingers-text-dump',
    turns: ['hey its dr patel in wappingers falls, 2 girls at the front, me and another dentist, we close 12-1 for lunch, after 5 just voicemail, keep the 845 number, been here 11 years'],
    expect: ({ plan }) => plan.mode === 'improving' && /Wappingers/i.test(plan.policy.cityState) && plan.teams.find(t => t.role === 'reception')?.count === 2 && plan.after.kind === 'message'
  },
  {
    id: 'E02-fishkill-bought-practice',
    turns: ["We bought Dr. Miller's old office in Fishkill, NY. Same patients, same number. One receptionist. I am the dentist. Front desk first. After hours take a message. Don't give me a new number."],
    expect: ({ plan }) => plan.mode === 'improving' && /Fishkill/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting'
  },
  {
    id: 'E03-daughter-answers',
    turns: ["Hyde Park Family Dental, existing. My daughter answers the phones at the front desk, she's the only one. Weekdays 8 to 4. Nighttime voicemail. I don't want a menu."],
    expect: ({ plan }) => plan.first.kind === 'human' && plan.first.team === 'reception' && plan.teams.find(t => t.role === 'reception')?.count === 1 && plan.mode === 'improving'
  },
  {
    id: 'E04-husband-cell-overflow',
    turns: ["Red Hook dental, been open forever. One girl up front. If she's slammed ring my husband's work cell, he's the office manager. After hours voicemail, nobody on call."],
    expect: ({ plan }) => plan.busy.backup === 'admin' || plan.policy.urgentKind === 'none'
  },
  {
    id: 'E05-ai-later-not-now',
    turns: ["Opening Woodstock Family Dental next April. Two receptionists. Front desk answers now. Maybe AI later when we're bigger. After hours voicemail. New number."],
    expect: ({ plan }) => plan.mode === 'opening' && plan.first.kind !== 'assistant' && plan.after.kind !== 'assistant'
  },
  {
    id: 'E06-ortho-not-general',
    turns: ['We are Warwick Orthodontics, existing. Three treatment coordinators answer. Two orthodontists. After hours AnswerConnect. Keep the number.'],
    expect: ({ plan }) => /Dental/i.test(plan.specialty) && plan.after.kind === 'service' && !/AnswerConnect/i.test(plan.name)
  },
  {
    id: 'E07-closed-wednesday',
    turns: ['Hudson Valley PT in Newburgh, existing. Open Mon Tue Thu 7 to 7, Friday 7 to 3, closed Wednesday. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const wed = plan.hours.days.find(d => d.day === 'Wednesday');
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      return wed && wed.open === false && fri?.end === '15:00';
    }
  },
  {
    id: 'E08-spanish-maria-afternoons',
    turns: ['Poughkeepsie dental existing. Two at the front. Maria speaks Spanish in the afternoon, mornings English only. After hours English voicemail. No on-call.'],
    expect: ({ plan }) => plan.languages.some(l => /spanish/i.test(l.name || '')) && plan.after.kind === 'message'
  },
  {
    id: 'E09-dont-want-ai-want-person',
    turns: ["I don't want AI I want a person. Existing Beacon eye office. Front desk first. After hours take a message."],
    expect: ({ plan }) => plan.first.kind === 'human' && plan.first.kind !== 'assistant'
  },
  {
    id: 'E10-operatories-not-phones',
    turns: ["Six operatories in Goshen, opening May. Last guy tried to put a phone in every room, don't do that. Two receptionists, front desk first, after hours voicemail."],
    expect: ({ plan }) => plan.policy.rooms === 6 && plan.endpoints.desk !== 6
  },
  {
    id: 'E11-mom-does-insurance-from-home',
    turns: ['Opening Millbrook Family Dental June 2027. Two at the front. My mom does insurance from home, she is not a receptionist. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.teams.find(t => t.role === 'reception')?.count === 2 && (plan.teams.find(t => t.role === 'administration')?.count === 1 || plan.policy.billingPerformedBy === 'administration')
  },
  {
    id: 'E12-spectrum-port-keep',
    turns: ["We've been on Spectrum in Saugerties for years. Switching phones to you. Keep the published number. Two front desk. Person first. Night voicemail."],
    expect: ({ plan }) => plan.mode === 'improving' && plan.policy.opening.numbers === 'porting'
  },
  {
    id: 'E13-correction-city-midstream',
    turns: [
      "Opening in Kingston, two receptionists, front desk first, after hours voicemail.",
      "Wait no, it's New Paltz, not Kingston. Same staffing."
    ],
    expect: ({ plan }) => /New Paltz/i.test(plan.policy.cityState) && !/^Kingston/i.test(plan.policy.cityState)
  },
  {
    id: 'E14-phi-messy-email',
    turns: ['Kingston Eye Associates existing. Patient Linda Chen DOB 11/02/1955 called, my email is drkim@kingstoneye.com. Two opticians answer. After hours voicemail.'],
    expect: ({ plan, ack }) => {
      const blob = JSON.stringify(plan) + ack;
      return /Kingston Eye/i.test(plan.name) && !/Linda Chen|11\/02\/1955/.test(blob);
    }
  },
  {
    id: 'E15-solo-cell-between-patients',
    turns: ["It's just me, solo dentist in Woodstock. No staff. I'll answer between patients on my cell. Tue-Sat 9 to 5."],
    expect: ({ plan }) => plan.first.team === 'clinical' && plan.teams.find(t => t.role === 'reception')?.count === 0
  },
  {
    id: 'E16-history-poughkeepsie-open-rhinebeck',
    turns: ['I was an associate in Poughkeepsie for fourteen years. Now opening Rhinebeck Family Dental in Rhinebeck, New York. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => /Rhinebeck/i.test(plan.policy.cityState) && !/Poughkeepsie/i.test(plan.policy.cityState)
  },
  {
    id: 'E17-press-1-wappingers-press-2-fishkill',
    turns: ['We already have Wappingers Family Dental and we are adding Fishkill under the same number. Callers should press 1 for Wappingers, 2 for Fishkill. Two receptionists. After hours voicemail.'],
    expect: ({ plan }) => plan.mode === 'adding' && (plan.first.kind === 'menu' || plan.policy.locationEntry === 'menu')
  },
  {
    id: 'E18-toothache-page-no-cell',
    turns: ['Existing Kingston dental. Front desk first. After hours voicemail. If it is a real toothache they can page me but do not put my cell on the recording. No on-call line yet.'],
    expect: ({ plan }) => {
      const blob = JSON.stringify(plan);
      return !/\b5\d{2}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(blob) && plan.after.kind === 'message';
    }
  },
  {
    id: 'E19-open-dental-ai-book-later',
    turns: ['Opening Catskill Family Dental March 2027. We run Open Dental. I want AI to book later, not at launch. Two receptionists answer first. After hours voicemail.'],
    expect: ({ plan }) => /Open Dental/i.test(plan.policy.opening.pms || '') && plan.first.kind !== 'assistant'
  },
  {
    id: 'E20-friday-summer-early',
    turns: ['Existing Hudson dental. Weekdays 9 to 5 but Fridays we leave at 2. Two front desk. After hours voicemail. No on-call.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      return fri?.end === '14:00' && mon?.end === '17:00';
    }
  },
  {
    id: 'E21-terse-chiro',
    turns: ['chiro in warwick ny, 1 front, 2 docs, 8-6 m-f, after hours vm, keep number'],
    expect: ({ plan }) => /chiro/i.test(plan.specialtyDetail || '') && plan.after.kind === 'message' && plan.mode === 'improving'
  },
  {
    id: 'E22-medspa-other',
    turns: ['Opening Glow Med Spa in Beacon May 2027. Two people at the desk. Front desk first. After hours just a message. Not medical really but we take calls.'],
    expect: ({ plan }) => plan.specialty === 'Other healthcare practice' || /spa|med/i.test(plan.specialtyDetail || plan.name)
  },
  {
    id: 'E23-dont-invent-hours',
    turns: ['Existing dental in Kingston. Two receptionists. Front desk first. After hours voicemail. I will tell you hours later.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      return !(fri?.open && fri.start === '09:00' && fri.end === '17:00');
    }
  },
  {
    id: 'E24-two-towns-different-hours-dont-merge',
    turns: ['Eye office in Albany, adding Troy. This plan is Troy. Albany is 8 to 6. I am not giving Troy hours today. One receptionist. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const mergedAlbany = fri?.open && fri.start === '08:00' && fri.end === '18:00';
      return /Troy/i.test(plan.policy.cityState) && !mergedAlbany;
    }
  },
  {
    id: 'E25-lunch-words-not-overnight',
    turns: ['Existing Kingston dental. Weekdays 9 to 5. We close for lunch noon to one, phones go to voicemail. After hours also voicemail. Front desk first. No on-call.'],
    expect: ({ plan }) => plan.hours.days.some(d => d.breakStart === '12:00' && d.breakEnd === '13:00') && plan.after.kind === 'message'
  },
  {
    id: 'E26-took-over-same-845',
    turns: ["Took over Dr Chen's office in Saugerties last month. Same 845. Two at the desk. Front desk first. After hours vm."],
    expect: ({ plan }) => plan.mode === 'improving' && /Saugerties/i.test(plan.policy.cityState) && plan.after.kind === 'message' && plan.teams.find(t => t.role === 'reception')?.count === 2
  },
  {
    id: 'E27-girls-bounce-friday',
    turns: ['Kingston dental existing. The girls bounce at 2 on Friday. Rest of the week 9-5. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      return fri?.end === '14:00' && mon?.end === '17:00' && plan.after.kind === 'message';
    }
  },
  {
    id: 'E28-wife-bills-from-house',
    turns: ['Existing Rhinebeck dental. My wife does the billing from the house, not a receptionist. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.teams.find(t => t.role === 'reception')?.count === 2 && (plan.teams.find(t => t.role === 'administration')?.count === 1 || plan.policy.billingPerformedBy === 'administration')
  },
  {
    id: 'E29-lumen-aesthetics-medspa',
    turns: ["Opening Lumen Aesthetics in Beacon June 2027. It's a med spa. Two at the desk. Front desk first. After hours just a message."],
    expect: ({ plan }) => plan.specialty === 'Other healthcare practice' || /spa|med|aesthetic/i.test(plan.specialtyDetail || plan.name || '')
  },
  {
    id: 'E30-solo-pt-cell',
    turns: ['Solo PT in Warwick. No staff. I pick up on my cell between patients. After hours vm. Keep number.'],
    expect: ({ plan }) => plan.first.team === 'clinical' && plan.teams.find(t => t.role === 'reception')?.count === 0 && plan.after.kind === 'message' && plan.mode === 'improving'
  },
  {
    id: 'E31-acquired-night-mailbox',
    turns: ["We acquired the old Kingston practice. Don't issue me a new number, patients already have it. One receptionist. Front desk first. Night mailbox."],
    expect: ({ plan }) => plan.mode === 'improving' && plan.policy.opening.numbers === 'porting' && plan.after.kind === 'message'
  },
  {
    id: 'E32-son-only-one-at-desk',
    turns: ['Hyde Park existing dental. My son answers, he is the only one at the desk. Nighttime vm.'],
    expect: ({ plan }) => plan.first.kind === 'human' && plan.teams.find(t => t.role === 'reception')?.count === 1 && plan.mode === 'improving' && plan.after.kind === 'message'
  },
  {
    id: 'E33-closed-wed-otherwise-8-6',
    turns: ['Fishkill family dental existing. Closed Wednesdays. Open 8-6 otherwise weekdays. Two girls at the front. After hours voicemail.'],
    expect: ({ plan }) => {
      const wed = plan.hours.days.find(d => d.day === 'Wednesday');
      const thu = plan.hours.days.find(d => d.day === 'Thursday');
      return wed && wed.open === false && thu?.start === '08:00' && thu?.end === '18:00';
    }
  },
  {
    id: 'E34-newburgh-hours-not-beacon',
    turns: ['Adding a Beacon office, home is Newburgh. This plan is Beacon. Newburgh is 8 to 5. I am not giving Beacon hours today. One receptionist. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const copied = fri?.open && fri.start === '08:00' && fri.end === '17:00';
      return /Beacon/i.test(plan.policy.cityState) && plan.mode === 'adding' && !copied;
    }
  },
  {
    id: 'E35-between-chairs-cell',
    turns: ["It's me and my cell in Woodstock. Solo dentist. No receptionist. I'll answer between chairs on my cell."],
    expect: ({ plan }) => plan.first.team === 'clinical' && plan.teams.find(t => t.role === 'reception')?.count === 0
  },
  {
    id: 'E36-bought-goshen-terse',
    turns: ["we bought miller's practice in goshen. same patients same number. dont give me a new number. 1 front. after hours take a message."],
    expect: ({ plan }) => plan.mode === 'improving' && /Goshen/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting' && plan.teams.find(t => t.role === 'reception')?.count === 1
  },
  {
    id: 'E37-when-we-close-just-vm',
    turns: ['Opening in Catskill. Two receptionists. Person first. When we close just vm. New number.'],
    expect: ({ plan }) => plan.mode === 'opening' && plan.after.kind === 'message' && plan.first.kind === 'human'
  },
  {
    id: 'E38-poughkeepsie-ruby',
    turns: ['Existing Poughkeepsie ortho. 3 treatment coordinators answer. Keep the number. After hours Ruby.'],
    expect: ({ plan }) => plan.after.kind === 'service' && !/Ruby/i.test(plan.name || '') && plan.mode === 'improving'
  },
  {
    id: 'E39-dont-mash-albany-onto-troy',
    turns: ['Eye office in Albany, adding Troy. This plan is Troy. Albany office is 8-6. Do not mash the hours. One receptionist. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const mashed = fri?.open && fri.start === '08:00' && fri.end === '18:00';
      return /Troy/i.test(plan.policy.cityState) && !mashed;
    }
  },
  {
    id: 'E40-chiro-red-hook-845',
    turns: ['chiropractic in red hook, been here forever, 1 girl up front, after 5 vm, keep the 845'],
    expect: ({ plan }) => /chiro/i.test(plan.specialtyDetail || '') && plan.after.kind === 'message' && plan.mode === 'improving' && /Red Hook/i.test(plan.policy.cityState)
  },
  {
    id: 'E41-took-over-old-number',
    turns: ["We took over the Hyde Park office. Patients still dial the old number. Two girls. Front desk first. After hours just vm."],
    expect: ({ plan }) => plan.mode === 'improving' && /Hyde Park/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting' && plan.after.kind === 'message'
  },
  {
    id: 'E42-grab-it-between-patients',
    turns: ["I'm in Millbrook, solo, no front desk, I grab it between patients on my cell. Night mailbox."],
    expect: ({ plan }) => plan.first.team === 'clinical' && plan.teams.find(t => t.role === 'reception')?.count === 0 && plan.after.kind === 'message'
  },
  {
    id: 'E43-glow-next-to-dunkin',
    turns: ['Opening next door to the Dunkin in Beacon, Glow Med Spa, two at the desk, person first, after hours message'],
    expect: ({ plan }) => /Beacon/i.test(plan.policy.cityState) && (plan.specialty === 'Other healthcare practice' || /spa|med/i.test(plan.specialtyDetail || plan.name || ''))
  },
  {
    id: 'E44-get-out-friday-one',
    turns: ['Warwick chiro, been here forever. Fridays we get out at 1. M-Th 9-6. 1 front. after hours vm'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      return /chiro/i.test(plan.specialtyDetail || '') && fri?.end === '13:00' && mon?.end === '18:00';
    }
  },
  {
    id: 'E45-dont-copy-kingston-onto-newpaltz',
    turns: ["Don't copy Kingston hours onto New Paltz. This plan is New Paltz. Kingston is 8 to 5. I'm not giving New Paltz hours. Adding New Paltz. One receptionist. Front desk first. After hours voicemail."],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const copied = fri?.open && fri.start === '08:00' && fri.end === '17:00';
      return /New Paltz/i.test(plan.policy.cityState) && plan.mode === 'adding' && !copied;
    }
  },
  {
    id: 'E46-niece-shes-it',
    turns: ["Existing Kingston dental. My niece answers the phone, she's it. After hours voicemail."],
    expect: ({ plan }) => plan.first.kind === 'human' && plan.teams.find(t => t.role === 'reception')?.count === 1 && plan.mode === 'improving'
  },
  {
    id: 'E47-keep-published-845',
    turns: ['Keep our published 845. Existing Saugerties dental. Two at the front. After hours take a message.'],
    expect: ({ plan }) => plan.mode === 'improving' && plan.policy.opening.numbers === 'porting' && plan.after.kind === 'message' && /Saugerties/i.test(plan.policy.cityState)
  },
  {
    id: 'E48-second-office-new-number',
    turns: ['I already own Kingston. Opening a 2nd in Red Hook. This plan is Red Hook. New number for Red Hook. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => /Red Hook/i.test(plan.policy.cityState) && plan.mode === 'adding' && plan.policy.opening.numbers === 'new'
  },
  {
    id: 'E49-close-at-2-fridays-summer',
    turns: ['We close at 2 Fridays in the summer. Existing Hudson dental. Rest of the week 9 to 5. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      return fri?.end === '14:00' && mon?.end === '17:00';
    }
  },
  {
    id: 'E50-dad-books-from-home',
    turns: ['Dad does the books from home, not a receptionist. Opening Catskill Family Dental June 2027. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.mode === 'opening' && plan.teams.find(t => t.role === 'reception')?.count === 2 && (plan.teams.find(t => t.role === 'administration')?.count === 1 || plan.policy.billingPerformedBy === 'administration')
  },
  {
    id: 'E51-pt-clinic-goshen',
    turns: ['it is a physical therapy clinic in Goshen, existing, 2 front, after hours vm, keep number'],
    expect: ({ plan }) => /physical therap/i.test(plan.specialtyDetail || '') && plan.after.kind === 'message' && plan.mode === 'improving' && /Goshen/i.test(plan.policy.cityState)
  },
  {
    id: 'E52-no-one-at-front-yet',
    turns: ["No one at the front yet, I'll take calls on my cell between patients. Woodstock, solo dentist, existing"],
    expect: ({ plan }) => plan.first.team === 'clinical' && plan.teams.find(t => t.role === 'reception')?.count === 0 && plan.mode === 'improving'
  },
  {
    id: 'E53-press-1-wappingers-2-beacon',
    turns: ['Callers should press 1 for Wappingers, 2 for Beacon. Adding Beacon, already have Wappingers. After hours voicemail. Two receptionists.'],
    expect: ({ plan }) => plan.mode === 'adding' && (plan.first.kind === 'menu' || plan.policy.locationEntry === 'menu')
  },
  {
    id: 'E54-office-i-bought-keeps-number',
    turns: ["The office I bought in Fishkill keeps the same number. Don't give me a new one. One girl up front. Nighttime voicemail."],
    expect: ({ plan }) => plan.mode === 'improving' && /Fishkill/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting' && plan.after.kind === 'message'
  },
  {
    id: 'E55-leave-at-2-on-fridays',
    turns: ['We leave at 2 on Fridays. Weekdays otherwise 8 to 4. Existing Troy dental. Two girls at the front. After hours voicemail.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const tue = plan.hours.days.find(d => d.day === 'Tuesday');
      return fri?.end === '14:00' && tue?.start === '08:00' && tue?.end === '16:00';
    }
  },
  {
    id: 'E56-phones-are-garbage',
    turns: ['Phones are garbage at our Kingston dental, been here 20 years. Two at the front. Front desk first. After hours vm. Keep the number.'],
    expect: ({ plan }) => plan.mode === 'improving' && /Kingston/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting' && plan.after.kind === 'message'
  },
  {
    id: 'E57-dont-port-fresh-number',
    turns: ["Don't port. I want a fresh number. Opening Rosendale Family Dental May 2027. Two receptionists. Front desk first. After hours voicemail."],
    expect: ({ plan }) => plan.mode === 'opening' && plan.policy.opening.numbers === 'new' && /Rosendale/i.test(plan.policy.cityState)
  },
  {
    id: 'E58-rotate-one-then-the-other',
    turns: ['Existing Hudson dental. They rotate, one then the other. Two front desk. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.policy.ring === 'order' && plan.first.team === 'reception'
  },
  {
    id: 'E59-hang-up-play-hours',
    turns: ["After hours just hang up, play the hours, don't take a message. Existing Beacon eye. Front desk first. Two at the front."],
    expect: ({ plan }) => plan.after.kind === 'information' && plan.first.kind === 'human'
  },
  {
    id: 'E60-moving-kingston-to-rhinebeck',
    turns: ['Moving the practice from Kingston to Rhinebeck. This plan is Rhinebeck. Keep the published number. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => /Rhinebeck/i.test(plan.policy.cityState) && !/Kingston/i.test(plan.policy.cityState) && plan.mode !== 'opening' && plan.policy.opening.numbers === 'porting'
  },
  {
    id: 'E61-sister-in-law-payroll-apartment',
    turns: ["Sister-in-law does payroll from her apartment, she's not a receptionist. Opening New Windsor Family Dental June 2027. Two at the front. Front desk first. After hours voicemail."],
    expect: ({ plan }) => plan.mode === 'opening' && plan.teams.find(t => t.role === 'reception')?.count === 2 && (plan.teams.find(t => t.role === 'administration')?.count === 1 || plan.policy.billingPerformedBy === 'administration') && /New Windsor/i.test(plan.policy.cityState)
  },
  {
    id: 'E62-hygienist-does-not-answer',
    turns: ["Just me and a hygienist. She doesn't answer phones. Existing Woodstock dental. I'll pick up. After hours vm."],
    expect: ({ plan }) => plan.first.team === 'clinical' && plan.mode === 'improving' && plan.after.kind === 'message'
  },
  {
    id: 'E63-three-ops-not-phones',
    turns: ["3 ops in Millbrook opening April. Don't put a phone in every room. Two receptionists, front desk first, after hours voicemail."],
    expect: ({ plan }) => plan.policy.rooms === 3 && plan.endpoints.desk !== 3 && /Millbrook/i.test(plan.policy.cityState)
  },
  {
    id: 'E64-open-til-7-except-thursday',
    turns: ['Open til 7 weekdays except Thursday we close at 3. Existing Catskill dental. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const thu = plan.hours.days.find(d => d.day === 'Thursday');
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      return mon?.end === '19:00' && thu?.end === '15:00';
    }
  },
  {
    id: 'E65-half-day-saturday',
    turns: ['Half day Saturday 9-12, closed Sunday. Existing Poughkeepsie dental. Weekdays 9-5. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => {
      const sat = plan.hours.days.find(d => d.day === 'Saturday');
      const sun = plan.hours.days.find(d => d.day === 'Sunday');
      return sat?.open === true && (sat.end === '12:00' || sat.end === '12:00') && sun?.open === false;
    }
  },
  {
    id: 'E66-other-line-ring-husband',
    turns: ["If she's on the other line ring my husband. Existing Red Hook dental. One girl up front. After hours voicemail. No on-call."],
    expect: ({ plan }) => (plan.busy.backup === 'admin' || plan.busy.kind === 'backup') && plan.policy.urgentKind === 'none'
  },
  {
    id: 'E67-wait-its-fishkill-not-beacon',
    turns: [
      'Existing dental in Beacon. Two receptionists. Front desk first. After hours voicemail.',
      "Wait it's Fishkill, not Beacon. Same staffing."
    ],
    expect: ({ plan }) => /Fishkill/i.test(plan.policy.cityState) && !/^Beacon/i.test(plan.policy.cityState)
  },
  {
    id: 'E68-not-open-yet-take-names',
    turns: ["We're not open yet. Opening in Goshen August. Just take names until we go live. Two receptionists. Front desk first. After hours voicemail. New number."],
    expect: ({ plan }) => plan.mode === 'opening' && /Goshen/i.test(plan.policy.cityState) && (plan.policy.beforeOpening === 'message' || plan.beforeOpening === 'message')
  },
  {
    id: 'E69-no-mailbox-overnight-live-service',
    turns: ["I don't want a mailbox overnight. Get a live answering service. Existing Kingston dental. Two front desk. Front desk first."],
    expect: ({ plan }) => plan.after.kind === 'service' && plan.mode === 'improving'
  },
  {
    id: 'E70-eaglesoft-not-dentrix',
    turns: ['Eaglesoft not Dentrix. Existing Albany dental. Two at the front. Front desk first. After hours voicemail. Keep number.'],
    expect: ({ plan }) => /Eaglesoft/i.test(plan.policy.opening.pms || '') && !/Dentrix/i.test(plan.policy.opening.pms || '')
  },
  {
    id: 'E71-spanish-if-maria-working',
    turns: ['Spanish if Maria is working, otherwise English is fine. Existing Newburgh dental. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.languages.some(l => /spanish/i.test(l.name || '')) && plan.after.kind === 'message'
  },
  {
    id: 'E72-share-one-phone-cant-both-talk',
    turns: ["We share one phone, they can't both talk at once. Opening Dual Line Dental in Troy May 2027. Two receptionists. Front desk first. After hours voicemail."],
    expect: ({ plan }) => plan.policy.ring !== 'together' && (plan.endpoints?.sharing === 'shared' || plan.policy.placements?.some(p => p.team === 'reception' && p.sharing === 'shared') || JSON.stringify(plan).includes('shared'))
  },
  {
    id: 'E73-every-other-friday-not-always-closed',
    turns: ['Closed every other Friday. Existing Hudson dental. Weekdays 9-5. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      return fri && fri.open !== false;
    }
  },
  {
    id: 'E74-dr-patel-old-place-phones-suck',
    turns: ["Dr Patel's old place in New Paltz, phones suck. One receptionist. Front desk first. Night vm. Same number."],
    expect: ({ plan }) => plan.mode === 'improving' && /New Paltz/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting' && plan.after.kind === 'message'
  },
  {
    id: 'E75-friday-8-to-2-not-8-to-5',
    turns: ['Existing Kingston dental. Weekdays 8 to 5. Two front desk. After hours voicemail.', 'I mean Friday 8 to 2, not 8 to 5.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      return fri?.end === '14:00' && mon?.end === '17:00';
    }
  },
  {
    id: 'E76-dropped-answerconnect-now-vm',
    turns: ['We dropped AnswerConnect. After hours just vm now. Existing Kingston dental. Two front desk. Front desk first.'],
    expect: ({ plan }) => plan.after.kind === 'message' && !/AnswerConnect/i.test(plan.name || '')
  },
  {
    id: 'E77-hygienist-covers-lunch',
    turns: ['Hygienist covers lunch, phones stay open. Existing Beacon dental. Weekdays 9-5, lunch 12-1. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => !plan.hours.days.some(d => d.breakStart === '12:00' && d.breakEnd === '13:00') && plan.after.kind === 'message'
  },
  {
    id: 'E78-hate-the-robot',
    turns: ['I hate the robot. Existing Troy dental. Two receptionists. After hours voicemail.'],
    expect: ({ plan }) => plan.first.kind !== 'assistant' && plan.after.kind === 'message'
  },
  {
    id: 'E79-published-number-new-opening',
    turns: ['We already published the number so keep it. Opening in Beacon June 2027. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.mode === 'opening' && plan.policy.opening.numbers === 'porting' && /Beacon/i.test(plan.policy.cityState)
  },
  {
    id: 'E80-docs-girls-answer',
    turns: ["Two docs. I don't answer the phone, the girls do. Existing Hudson dental. Two at the front. After hours voicemail."],
    expect: ({ plan }) => plan.first.team !== 'clinical' && plan.teams.find(t => t.role === 'reception')?.count === 2
  },
  {
    id: 'E81-dont-copy-hudson-onto-catskill',
    turns: ['Adding Catskill. This plan is Catskill. Hudson is 8 to 6. I am not giving Catskill hours. One receptionist. Front desk first. After hours voicemail. Home is Hudson.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const copied = fri?.open && fri.start === '08:00' && fri.end === '18:00';
      return /Catskill/i.test(plan.policy.cityState) && plan.mode === 'adding' && !copied;
    }
  },
  {
    id: 'E82-cascade-to-the-other-girl',
    turns: ['Calls cascade to the other girl if the first misses it. Opening River Dental in Kingston May 2027. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.policy.ring === 'order' && /River/i.test(plan.name || '') && plan.first.team === 'reception'
  },
  {
    id: 'E83-vm-overnight-person-day',
    turns: ['Voicemail overnight, person during the day. Existing Millbrook eye. 1 front.'],
    expect: ({ plan }) => plan.after.kind === 'message' && plan.first.kind === 'human' && plan.teams.find(t => t.role === 'reception')?.count === 1
  },
  {
    id: 'E84-replacing-phones-next-month',
    turns: ['We are replacing the phones next month at the existing Warwick office. 2 front. After hours vm. Keep number.'],
    expect: ({ plan }) => plan.mode === 'improving' && /Warwick/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting'
  },
  {
    id: 'E85-friday-is-a-short-day',
    turns: ['Friday is a short day, we close at 1. Weekdays 9-5. Existing Saugerties dental. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      return fri?.end === '13:00' && mon?.end === '17:00';
    }
  },
  {
    id: 'E86-closed-mondays',
    turns: ['Closed Mondays. Open Tue-Fri 8-5. Existing Kingston dental. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      const tue = plan.hours.days.find(d => d.day === 'Tuesday');
      return mon && mon.open === false && tue?.start === '08:00' && tue?.end === '17:00';
    }
  },
  {
    id: 'E87-go-down-the-list',
    turns: ["Don't ring all of them at once, go down the list. Opening List Dental in Troy May 2027. Two receptionists. Front desk first. After hours voicemail."],
    expect: ({ plan }) => plan.policy.ring === 'order' && plan.first.team === 'reception'
  },
  {
    id: 'E88-number-already-on-google',
    turns: ['The number is already on Google. Existing Beacon dental. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.mode === 'improving' && plan.policy.opening.numbers === 'porting' && /Beacon/i.test(plan.policy.cityState)
  },
  {
    id: 'E89-relocating-not-adding',
    turns: ["We're not adding a second office, we're relocating from Kingston to Rhinebeck. This plan is Rhinebeck. Keep the number. Two receptionists. Front desk first. After hours voicemail."],
    expect: ({ plan }) => plan.mode === 'improving' && /Rhinebeck/i.test(plan.policy.cityState) && !/Kingston/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting'
  },
  {
    id: 'E90-dont-close-phones-for-lunch',
    turns: ["We eat at the desk, don't close the phones for lunch. Existing Hudson dental. Weekdays 9-5, lunch 12-1. Two at the front. Front desk first. After hours voicemail."],
    expect: ({ plan }) => !plan.hours.days.some(d => d.breakStart === '12:00' && d.breakEnd === '13:00') && plan.after.kind === 'message'
  },
  {
    id: 'E91-dont-want-answering-service-just-vm',
    turns: ["I don't want an answering service, just voicemail after hours. Existing Kingston dental. Two front desk. Front desk first."],
    expect: ({ plan }) => plan.after.kind === 'message' && plan.mode === 'improving'
  },
  {
    id: 'E92-used-to-use-answerconnect',
    turns: ['We used to use AnswerConnect, now just vm after hours. Existing Troy dental. Two front desk. Front desk first.'],
    expect: ({ plan }) => plan.after.kind === 'message' && !/AnswerConnect/i.test(plan.name || '')
  },
  {
    id: 'E93-still-dentrix-not-switching-open-dental',
    turns: ['We still use Dentrix, not switching to Open Dental. Existing Albany dental. Two at the front. Front desk first. After hours voicemail. Keep number.'],
    expect: ({ plan }) => /Dentrix/i.test(plan.policy.opening.pms || '') && !/Open Dental/i.test(plan.policy.opening.pms || '')
  },
  {
    id: 'E94-wednesday-is-a-short-day',
    turns: ['Wednesday is a short day, we close at 1. Weekdays 9-5. Existing Saugerties dental. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const wed = plan.hours.days.find(d => d.day === 'Wednesday');
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      return wed?.end === '13:00' && fri?.end === '17:00';
    }
  },
  {
    id: 'E95-number-on-the-door-stays',
    turns: ['The number on the door stays. Existing Fishkill dental. One girl up front. Nighttime voicemail.'],
    expect: ({ plan }) => plan.mode === 'improving' && /Fishkill/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting' && plan.after.kind === 'message'
  },
  {
    id: 'E96-taking-over-not-opening',
    turns: ["I'm taking over the Millbrook office, not opening a new one. Same number. One receptionist. Front desk first. After hours voicemail."],
    expect: ({ plan }) => plan.mode === 'improving' && /Millbrook/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting'
  },
  {
    id: 'E97-family-medicine-not-dental',
    turns: ['Opening in Beacon, family medicine, not a dental office. Two at the desk. Front desk first. After hours voicemail. New number.'],
    expect: ({ plan }) => plan.specialty !== 'Dental' && /family medicine/i.test(plan.specialtyDetail || '') && /Beacon/i.test(plan.policy.cityState)
  },
  {
    id: 'E98-we-dont-do-spanish',
    turns: ["We don't do Spanish. Existing Newburgh dental. Two receptionists. Front desk first. After hours voicemail."],
    expect: ({ plan }) => !plan.languages.some(l => /spanish/i.test(l.name || '')) && (plan.policy.languageDecision === 'none' || !plan.languages.length)
  },
  {
    id: 'E99-after-hours-ring-cell-not-vm',
    turns: ["After hours ring my cell, not voicemail. Existing Woodstock dental. Solo. I'll pick up."],
    expect: ({ plan }) => plan.after.kind !== 'message' && plan.first.team === 'clinical'
  },
  {
    id: 'E100-stagger-the-phones',
    turns: ['Stagger the phones, ten seconds apart. Opening Hunt Dental in Kingston May 2027. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.policy.ring === 'order' && plan.first.team === 'reception'
  },
  {
    id: 'E101-open-seven-days',
    turns: ["We're open 7 days, 9 to 2. Existing chiro in Warwick. 1 front. After hours vm. Keep number."],
    expect: ({ plan }) => {
      const sat = plan.hours.days.find(d => d.day === 'Saturday');
      const sun = plan.hours.days.find(d => d.day === 'Sunday');
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      return /chiro/i.test(plan.specialtyDetail || '') && sat?.open === true && sun?.open === true && mon?.end === '14:00';
    }
  },
  {
    id: 'E102-close-at-noon-fridays',
    turns: ['We close at noon on Fridays. Rest of the week 8-4. Existing Hudson dental. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      return fri?.end === '12:00' && mon?.end === '16:00';
    }
  },
  {
    id: 'E103-got-rid-of-answering-service',
    turns: ['We got rid of the answering service. After hours just vm. Existing Kingston dental. Two front desk. Front desk first.'],
    expect: ({ plan }) => plan.after.kind === 'message' && plan.mode === 'improving'
  },
  {
    id: 'E104-dont-build-press-one',
    turns: ["Don't build press 1. Existing Poughkeepsie dental. Two at the front. After hours voicemail."],
    expect: ({ plan }) => plan.first.kind !== 'menu' && plan.after.kind === 'message'
  },
  {
    id: 'E105-on-the-website-already',
    turns: ["It's already on the website. Existing Saugerties dental. Two at the front. Front desk first. After hours take a message."],
    expect: ({ plan }) => plan.mode === 'improving' && plan.policy.opening.numbers === 'porting' && plan.after.kind === 'message'
  },
  {
    id: 'E106-four-chairs-not-phones',
    turns: ["Four chairs in Goshen, opening May. Don't put a phone in every room. Two receptionists, front desk first, after hours voicemail."],
    expect: ({ plan }) => plan.policy.rooms === 4 && plan.endpoints.desk !== 4 && /Goshen/i.test(plan.policy.cityState)
  },
  {
    id: 'E107-i-check-voicemails-myself',
    turns: ['I listen to the voicemails myself. Existing Beacon dental. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => (plan.after.owner === 'clinical' || plan.policy?.messageOwner === 'clinical' || JSON.stringify(plan).includes('"owner":"clinical"')) && plan.after.kind === 'message'
  },
  {
    id: 'E108-closed-every-other-saturday',
    turns: ['Closed every other Saturday. Existing Hudson dental. Weekdays 9-5. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const sat = plan.hours.days.find(d => d.day === 'Saturday');
      return !sat || sat.open !== false;
    }
  },
  {
    id: 'E109-curve-not-dentrix',
    turns: ['Curve not Dentrix. Existing Catskill dental. Two at the front. Front desk first. After hours voicemail. Keep number.'],
    expect: ({ plan }) => /Curve/i.test(plan.policy.opening.pms || '') && !/Dentrix/i.test(plan.policy.opening.pms || '')
  },
  {
    id: 'E110-hunt-the-phones',
    turns: ['Hunt the phones, one then the next. Opening River Dental in Kingston May 2027. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.policy.ring === 'order'
  },
  {
    id: 'E111-eat-in-shifts-phones-live',
    turns: ['We eat in shifts, phones stay live. Existing Troy dental. Weekdays 9-5, lunch 12-1. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => !plan.hours.days.some(d => d.breakStart === '12:00' && d.breakEnd === '13:00') && plan.after.kind === 'message'
  },
  {
    id: 'E112-patients-still-call-the-845-on-magnets',
    turns: ['Patients still call the 845 on the magnets. Existing Hyde Park dental. Two girls. Front desk first. After hours just vm.'],
    expect: ({ plan }) => plan.mode === 'improving' && plan.policy.opening.numbers === 'porting' && /Hyde Park/i.test(plan.policy.cityState)
  },
  {
    id: 'E113-no-longer-with-ruby',
    turns: ['No longer with Ruby. After hours voicemail now. Existing Poughkeepsie ortho. Two at the front. Front desk first.'],
    expect: ({ plan }) => plan.after.kind === 'message' && !/Ruby/i.test(plan.name || '')
  },
  {
    id: 'E114-moving-across-town-same-number',
    turns: ['Moving across town in Kingston, same number. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.mode === 'improving' && /Kingston/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting'
  },
  {
    id: 'E115-dont-want-a-robot',
    turns: ["Don't want a robot picking up. Existing Catskill dental. Two receptionists. After hours voicemail."],
    expect: ({ plan }) => plan.first.kind !== 'assistant' && plan.after.kind === 'message'
  },
  {
    id: 'E116-closed-thursdays',
    turns: ['Closed Thursdays. Open Mon Tue Wed Fri 8-5. Existing Kingston dental. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const thu = plan.hours.days.find(d => d.day === 'Thursday');
      const tue = plan.hours.days.find(d => d.day === 'Tuesday');
      return thu && thu.open === false && tue?.start === '08:00' && tue?.end === '17:00';
    }
  },
  {
    id: 'E117-closed-wed-and-fri',
    turns: ['Closed Wednesdays and Fridays. Open Mon Tue Thu 9-5. Existing Hudson dental. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const wed = plan.hours.days.find(d => d.day === 'Wednesday');
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      const tue = plan.hours.days.find(d => d.day === 'Tuesday');
      return wed?.open === false && fri?.open === false && tue?.start === '09:00' && tue?.end === '17:00';
    }
  },
  {
    id: 'E118-whoever-is-free-grabs-it',
    turns: ['Whoever is free grabs it. Opening Dual Pickup Dental in Kingston May 2027. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.policy.ring === 'together' && plan.first.team === 'reception'
  },
  {
    id: 'E119-blast-all-the-phones',
    turns: ['Blast all the phones at once. Opening Blast Dental in Troy May 2027. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.policy.ring === 'together'
  },
  {
    id: 'E120-hate-hold-music-just-vm',
    turns: ["I hate hold music, just vm if they're busy. Existing Beacon dental. Two at the front. Front desk first. After hours voicemail."],
    expect: ({ plan }) => plan.busy.kind === 'message' && plan.busy.kind !== 'queue' && plan.after.kind === 'message'
  },
  {
    id: 'E121-not-dentrix-anymore-open-dental',
    turns: ['Not Dentrix anymore, we moved to Open Dental. Existing Albany dental. Two at the front. Front desk first. After hours voicemail. Keep number.'],
    expect: ({ plan }) => /Open Dental/i.test(plan.policy.opening.pms || '') && !/Dentrix/i.test(plan.policy.opening.pms || '')
  },
  {
    id: 'E122-we-speak-french-not-spanish',
    turns: ['We speak French, not Spanish. Existing Newburgh dental. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.languages.some(l => /french/i.test(l.name || '')) && !plan.languages.some(l => /spanish/i.test(l.name || ''))
  },
  {
    id: 'E123-wife-and-i-both-answer',
    turns: ['My wife and I both answer. Existing Red Hook dental. After hours voicemail. Keep number.'],
    expect: ({ plan }) => (plan.teams.find(t => t.role === 'reception')?.count || 0) >= 2 && plan.after.kind === 'message'
  },
  {
    id: 'E124-aunt-bills-from-laptop',
    turns: ['Aunt does the billing from her laptop, she is not a receptionist. Opening Millbrook Family Dental June 2027. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.teams.find(t => t.role === 'reception')?.count === 2 && (plan.teams.find(t => t.role === 'administration')?.count === 1 || plan.policy.billingPerformedBy === 'administration')
  },
  {
    id: 'E125-compulink-not-revolutionehr',
    turns: ['Compulink not RevolutionEHR. Existing Poughkeepsie eye. Two at the front. Front desk first. After hours voicemail. Keep number.'],
    expect: ({ plan }) => /Compulink/i.test(plan.policy.opening.pms || '') && !/RevolutionEHR/i.test(plan.policy.opening.pms || '')
  },
  {
    id: 'E126-dont-invent-hours-screenshot',
    turns: ["Don't invent hours, I'll send a screenshot later. Existing Kingston dental. Two receptionists. Front desk first. After hours voicemail."],
    expect: ({ plan }) => {
      const fri = plan.hours.days.find(d => d.day === 'Friday');
      return !(fri?.open && fri.start === '09:00' && fri.end === '17:00');
    }
  },
  {
    id: 'E127-cancelled-smith-ai-now-vm',
    turns: ['We cancelled Smith.ai. After hours just vm now. Existing Troy dental. Two front desk. Front desk first.'],
    expect: ({ plan }) => plan.after.kind === 'message' && !/Smith/i.test(plan.name || '')
  },
  {
    id: 'E128-dont-text-patients',
    turns: ["Don't text patients. Existing Hudson dental. Two at the front. Front desk first. After hours voicemail."],
    expect: ({ plan }) => plan.policy.followup === 'skip' || plan.followup?.channels?.length === 0
  },
  {
    id: 'E129-no-mailbox-let-it-ring',
    turns: ["After hours let it ring, no mailbox. Existing Woodstock dental. One girl up front. Front desk first."],
    expect: ({ plan }) => plan.after.kind !== 'message'
  },
  {
    id: 'E130-wednesday-bounce-at-noon',
    turns: ['Wednesdays we bounce at noon. Rest of the week 8-4. Existing Saugerties dental. Two front desk. After hours voicemail.'],
    expect: ({ plan }) => {
      const wed = plan.hours.days.find(d => d.day === 'Wednesday');
      const thu = plan.hours.days.find(d => d.day === 'Thursday');
      return wed?.end === '12:00' && thu?.end === '16:00';
    }
  },
  {
    id: 'E131-pediatric-dental',
    turns: ['Opening Hudson Pediatric Dental June 2027. Two receptionists. Front desk first. After hours voicemail. New number.'],
    expect: ({ plan }) => plan.specialty === 'Dental' && /Hudson/i.test(plan.policy.cityState || plan.name || '')
  },
  {
    id: 'E132-podiatry',
    turns: ['Opening in Beacon, it is a podiatry office. Two at the desk. Front desk first. After hours voicemail. New number.'],
    expect: ({ plan }) => plan.specialty === 'Other healthcare practice' && /podiatr/i.test(plan.specialtyDetail || '')
  },
  {
    id: 'E133-google-business-has-845',
    turns: ['The Google Business listing has the 845. Existing Fishkill dental. One girl up front. Nighttime voicemail.'],
    expect: ({ plan }) => plan.mode === 'improving' && plan.policy.opening.numbers === 'porting' && /Fishkill/i.test(plan.policy.cityState)
  },
  {
    id: 'E134-mwf-tue-thu-split',
    turns: ['M W F 8-5, Tue Thu 10-6. Existing Warwick chiro. 1 front. After hours vm. Keep number.'],
    expect: ({ plan }) => {
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      const tue = plan.hours.days.find(d => d.day === 'Tuesday');
      const wed = plan.hours.days.find(d => d.day === 'Wednesday');
      return /chiro/i.test(plan.specialtyDetail || '') && mon?.end === '17:00' && tue?.start === '10:00' && tue?.end === '18:00' && wed?.start === '08:00';
    }
  },
  {
    id: 'E135-forget-beacon-hyde-park',
    turns: [
      'Existing dental in Beacon. Two receptionists. Front desk first. After hours voicemail.',
      "Forget Beacon, it's Hyde Park. Same staffing."
    ],
    expect: ({ plan }) => /Hyde Park/i.test(plan.policy.cityState) && !/^Beacon/i.test(plan.policy.cityState)
  },
  {
    id: 'E136-headset-computer-front',
    turns: ['Front desk answers on a computer and headset. Existing Kingston dental. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => {
      const kind = plan.policy?.placements?.find(p => p.team === 'reception')?.kind
        || plan.endpoints?.kind
        || JSON.stringify(plan);
      return /computer|headset/i.test(String(kind)) || plan.policy.notes?.toLowerCase().includes('headset') || plan.policy.notes?.toLowerCase().includes('computer');
    }
  },
  {
    id: 'E137-overflow-kingston-if-slammed',
    turns: ['If Beacon is slammed overflow to Kingston. Adding Beacon, home is Kingston. This plan is Beacon. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.busy.kind === 'backup' && /Beacon/i.test(plan.policy.cityState) && plan.mode === 'adding'
  },
  {
    id: 'E138-snow-days-closed',
    turns: ['Snow days we are closed. Existing Catskill dental. Weekdays 9-5. Two front desk. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => /snow/i.test(plan.policy?.continuity?.notes || plan.policy?.notes || JSON.stringify(plan))
  },
  {
    id: 'E139-saturday-by-appointment-only',
    turns: ['Saturdays by appointment only. Existing Poughkeepsie dental. Weekdays 9-5. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => {
      const sat = plan.hours.days.find(d => d.day === 'Saturday');
      return !(sat?.open && sat.start === '09:00' && sat.end === '17:00');
    }
  },
  {
    id: 'E140-new-number-for-red-hook-keep-kingston',
    turns: ["I already own Kingston. This plan is Red Hook. New number for Red Hook, keep Kingston's 845. Two receptionists. Front desk first. After hours voicemail."],
    expect: ({ plan }) => /Red Hook/i.test(plan.policy.cityState) && plan.mode === 'adding' && plan.policy.opening.numbers === 'new'
  },
  {
    id: 'E141-switching-off-optimum-keep-number',
    turns: ['Switching off Optimum, keep the number. Existing Saugerties dental. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.mode === 'improving' && plan.policy.opening.numbers === 'porting' && /Saugerties/i.test(plan.policy.cityState)
  },
  {
    id: 'E142-page-me-swellings-no-cell-on-recording',
    turns: ['Existing Kingston dental. Front desk first. After hours voicemail. Page me for swellings but do not put my cell on the recording. Cell is 845-555-0199.'],
    expect: ({ plan, ack }) => {
      const blob = JSON.stringify(plan) + ack;
      return !/845-555-0199/.test(blob) && plan.after.kind === 'message';
    }
  },
  {
    id: 'E143-solo-ortho-one-coordinator',
    turns: ['Solo ortho in Warwick, 1 treatment coordinator answers. After hours Ruby. Keep number. Been here forever.'],
    expect: ({ plan }) => /Dental/i.test(plan.specialty) && plan.teams.find(t => t.role === 'reception')?.count === 1 && plan.after.kind === 'service' && !/Ruby/i.test(plan.name || '')
  },
  {
    id: 'E144-four-rooms-plus-consult-not-phones',
    turns: ["Four treatment rooms plus a consult, don't put phones in them. Opening in Goshen May. Two receptionists, front desk first, after hours voicemail."],
    expect: ({ plan }) => plan.policy.rooms >= 4 && plan.endpoints.desk !== plan.policy.rooms
  },
  {
    id: 'E145-dont-close-mondays-anymore',
    turns: ["We don't close Mondays anymore. Weekdays 9-5. Existing Kingston dental. Two front desk. After hours voicemail."],
    expect: ({ plan }) => {
      const mon = plan.hours.days.find(d => d.day === 'Monday');
      return mon && mon.open !== false && mon.start === '09:00';
    }
  },
  {
    id: 'E146-fax-stays-analog-off-patient-line',
    turns: ['Fax stays analog, keep it off the patient number. Existing Beacon dental. Two at the front. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => /fax/i.test(plan.current?.notes || plan.policy?.notes || JSON.stringify(plan))
  },
  {
    id: 'E147-no-french-no-spanish-english',
    turns: ["No French, no Spanish, English only. Existing Newburgh dental. Two receptionists. Front desk first. After hours voicemail."],
    expect: ({ plan }) => !plan.languages.some(l => /spanish|french/i.test(l.name || '')) && (plan.policy.languageDecision === 'none' || !plan.languages.length)
  },
  {
    id: 'E148-moved-from-dentrix-to-eaglesoft',
    turns: ['We moved from Dentrix to Eaglesoft. Existing Catskill dental. Two at the front. Front desk first. After hours voicemail. Keep number.'],
    expect: ({ plan }) => /Eaglesoft/i.test(plan.policy.opening.pms || '') && !/Dentrix/i.test(plan.policy.opening.pms || '')
  },
  {
    id: 'E149-let-them-wait-then-vm',
    turns: ['If both are busy let them wait about a minute then voicemail. Opening Queue Dental in Troy May 2027. Two receptionists. Front desk first. After hours voicemail.'],
    expect: ({ plan }) => plan.busy.kind === 'queue' && plan.after.kind === 'message'
  },
  {
    id: 'E150-this-is-the-same-office-continuing',
    turns: ['This is the same office continuing, not a brand new opening. Existing Middletown dental. Two front desk. Front desk first. After hours voicemail. Keep the number.'],
    expect: ({ plan }) => plan.mode === 'improving' && /Middletown/i.test(plan.policy.cityState) && plan.policy.opening.numbers === 'porting'
  }
];

function smellIssues(plan, ack, speech) {
  const issues = [];
  const t = String(speech || '').toLowerCase();
  const blob = JSON.stringify(plan) + String(ack || '');
  if (/linda chen|james whitaker|john smith|11\/02\/1955|03\/04\/1990/.test(blob))
    issues.push('PHI leaked into plan/ack');
  if (/answerconnect|ruby receptionist|smith\.ai/i.test(plan.name || ''))
    issues.push('answering-service brand became practice name');
  if (plan.policy?.rooms >= 4 && plan.endpoints?.desk === plan.policy.rooms && /not (six |eight )?phones|rooms are not|operatories/.test(t))
    issues.push('rooms copied onto desk phones');
  if (plan.mode === 'opening' && /been here \d|for years|existing |been open|replacing .{0,20}phone/.test(t) && !/we are opening|im opening|i am opening|opening (woodstock|catskill|millbrook|glow)/.test(t))
    issues.push('mode=opening on existing speech');
  if (/closed all week/i.test(ack || ''))
    issues.push('ack says closed all week');
  if (plan.first?.team === 'clinical' && /front desk first|girls at the front|daughter answers/.test(t) && !/i'?ll answer|solo|myself/.test(t))
    issues.push('front-desk speech landed clinical-first');
  if (plan.first?.kind === 'assistant' && /later when|ai later|not at launch/.test(t))
    issues.push('future AI forced to first answer');
  return issues;
}

function scoreCase(c, step) {
  const issues = [];
  let err = '';
  try {
    if (c.expect && !c.expect(step))
      issues.push('expect failed');
  } catch (e) {
    issues.push('expect threw');
    err = e.message;
  }
  const speech = (c.turns || []).filter(t => typeof t === 'string').join(' ');
  if (c.smells !== false)
    issues.push(...smellIssues(step.plan, step.ack, speech));
  return {
    id: c.id,
    ok: issues.length === 0,
    issues,
    err,
    detail: {
      mode: step.plan?.mode,
      city: step.plan?.policy?.cityState,
      name: step.plan?.name,
      ring: step.plan?.policy?.ring,
      first: step.plan?.first,
      after: step.plan?.after?.kind,
      busy: step.plan?.busy?.kind,
      specialty: step.plan?.specialty,
      detail: step.plan?.specialtyDetail,
      pms: step.plan?.policy?.opening?.pms,
      numbers: step.plan?.policy?.opening?.numbers,
      rooms: step.plan?.policy?.rooms,
      follow: step.follow?.id,
      ack: (step.ack || '').slice(0, 160)
    }
  };
}

const useGroq = process.argv.includes('--groq');
let groqPlay = null;
if (useGroq) {
  const eb = await import('./eval-brain.mjs');
  const shared = await eb.loadBrain();
  groqPlay = turns => eb.playTurnsAsync(shared, turns, { groq: true });
}

async function runOne(c) {
  let step;
  if (c.setup)
    step = c.setup();
  else if (useGroq && groqPlay)
    step = await groqPlay(c.turns);
  else
    step = play(c.turns);
  const base = scoreCase(c, step);
  if (useGroq && step.track) {
    base.groq = step.track;
    base.detail = { ...base.detail, groqCalls: step.track.groqCalls };
  }
  return base;
}

const all = [...CASES, ...REAL];
const results = [];
for (const c of all)
  results.push(await runOne(c));
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed, groq: useGroq }, null, 2));
if (failed.length)
  process.exit(1);
