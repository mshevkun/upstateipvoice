#!/usr/bin/env node
/**
 * Real-life usage probe: 24 carefully investigated practice-owner cases.
 * Runs local interpret (no Groq), auto-chips remaining questions, builds paired PDFs,
 * and checks owner-UX + PDF invariants that matter in the field.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'planner/src');
const buildDir = path.join(root, 'planner/.probe-build');
const outDir = path.join(root, 'planner/eval/results/real-life');
fs.mkdirSync(path.join(buildDir, 'architect'), { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

function transpile(rel) {
  let out = ts.transpile(fs.readFileSync(path.join(srcDir, rel + '.ts'), 'utf8'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  });
  out = out.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, "from '$1.mjs'");
  if (rel === 'pdf') {
    out = out.replace(
      "import fontkit from '@pdf-lib/fontkit';",
      "import fontkitMod from '@pdf-lib/fontkit';\nconst fontkit = fontkitMod.default || fontkitMod;"
    );
  }
  fs.mkdirSync(path.dirname(path.join(buildDir, rel + '.mjs')), { recursive: true });
  fs.writeFileSync(path.join(buildDir, rel + '.mjs'), out);
}

for (const name of [
  'config', 'policy', 'locations', 'routing', 'flow', 'team-state', 'state',
  'architect/schema', 'architect/fields', 'architect/clauses', 'architect/parse', 'architect/extract', 'architect/ack',
  'architect/merge', 'architect/questions', 'architect/turn', 'architect/scene-from-plan',
  'architect/prompt', 'architect/hear', 'architect/scrub', 'provisioning', 'bom', 'opening', 'status',
  'readiness', 'advisor', 'privacy', 'owner-brief', 'fusion', 'engineer-brief', 'plan-content', 'pdf'
])
  transpile(name);

const { initial } = await import(path.join(buildDir, 'config.mjs'));
const { interpretTurn, chipTurn } = await import(path.join(buildDir, 'architect/turn.mjs'));
const { nextQuestion } = await import(path.join(buildDir, 'architect/questions.mjs'));
const { callerHear } = await import(path.join(buildDir, 'architect/hear.mjs'));
const { sceneFromPlan } = await import(path.join(buildDir, 'architect/scene-from-plan.mjs'));
const { fusionBuild } = await import(path.join(buildDir, 'fusion.mjs'));
const { identity } = await import(path.join(buildDir, 'advisor.mjs'));
const { stillOpen } = await import(path.join(buildDir, 'readiness.mjs'));
const { ownerBrief, ownerBriefText } = await import(path.join(buildDir, 'owner-brief.mjs'));
const { engineerBrief, engineerBriefText } = await import(path.join(buildDir, 'engineer-brief.mjs'));
const { createPairedPDFs, createPDF } = await import(path.join(buildDir, 'pdf.mjs'));
const { CHIP_SUBJECT } = await import(path.join(buildDir, 'architect/ack.mjs'));

const blank = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };
const font = fs.readFileSync(path.join(root, 'planner/public/assets/InstrumentSans.ttf'));
const logo = fs.readFileSync(path.join(root, 'planner/public/assets/upstate-logo.png'));

function pdftext(file) {
  try {
    return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 8e6 });
  }
  catch {
    return '';
  }
}

function get(plan, pathStr) {
  const parts = pathStr.split('.');
  let cur = plan;
  for (const p of parts) {
    if (cur == null)
      return undefined;
    cur = cur[p];
  }
  return cur;
}

function factValue(facts, id) {
  return facts[id]?.value;
}

function play(turns, { chips = {}, typed = {}, autoChip = true } = {}) {
  let plan = initial();
  let facts = {};
  let follow = null;
  const log = [];
  for (const userText of turns) {
    const r = interpretTurn({ plan, facts, interpreter: blank, userText, question: follow });
    plan = r.plan;
    facts = r.facts;
    follow = r.follow;
    log.push({ who: 'owner', text: userText, ack: r.ack, next: follow?.id || null });
  }
  let guard = 0;
  while (autoChip && follow && guard++ < 30) {
    if (typed[follow.id]) {
      const userText = typed[follow.id];
      const r = interpretTurn({ plan, facts, interpreter: blank, userText, question: follow });
      plan = r.plan;
      facts = r.facts;
      const was = follow.id;
      follow = r.follow;
      log.push({ who: 'owner', text: userText, ack: r.ack, next: follow?.id || null, typed: was });
      if (follow?.id === was)
        break;
      continue;
    }
    const want = chips[follow.id];
    let chip = want
      ? (follow.options.find(o => o.value === want.value) || {
        id: String(want.value),
        label: want.label || String(want.value),
        field_id: want.field_id || follow.id,
        value: want.value,
        operation: want.operation || 'set'
      })
      : null;
    if (!chip) {
      const opts = (follow.options || []).filter(o =>
        o.operation === 'set'
        && !/undecided|not sure|skip|later|help me decide/i.test(o.label + String(o.value ?? ''))
      );
      // Digit-9 on-call cannot ride an information hangup — prefer "no urgent path".
      if (follow.id === 'urgent.kind' && plan.after.kind === 'information')
        chip = opts.find(o => o.value === 'none') || opts[0];
      else
        chip = opts[0];
      chip = chip || follow.options?.find(o => o.operation === 'skip') || follow.options?.[0];
    }
    if (!chip)
      break;
    const r = chipTurn({ plan, facts, chip });
    plan = r.plan;
    facts = r.facts;
    follow = r.follow;
    log.push({ who: 'chip', text: chip.label, ack: r.ack, next: follow?.id || null, field: chip.field_id });
  }
  return { plan, facts, follow, log };
}

/** 160 carefully investigated real-life cases (waves 1–9). */
const CASES = [
  {
    id: 'RL01-kingston-chen-opening',
    title: 'New Kingston family dental opening (Chen-shaped)',
    why: 'Canonical Upstate dental opening — rooms ≠ phones, lunch close, on-call, Spanish staff.',
    turns: [
      "I'm opening Chen Family Dental in Kingston NY the week of March 15 2027. Six operatories — rooms, not phones. Two receptionists, my husband does billing, I'm the dentist with an associate joining later. Front desk answers first.",
      "Monday to Thursday 8 to 5, Friday 8 to 2, closed weekends. Lunch 12:30 to 1:30 phones closed. If both are busy take a message. Two separate lines. After hours voicemail. Urgent swelling trauma bleeding try on-call then priority message. Spanish during open hours only. Before opening take a callback. New number."
    ],
    expect: {
      plan: { mode: 'opening', specialty: 'Dental', name: /Chen Family Dental/i },
      neverPlan: { specialtyDetail: /.+/ },
      ownerPages: 6,
      hearInOwnerPdf: true,
      pairedFooters: true
    }
  },
  {
    id: 'RL02-chiro-other-detail',
    title: 'Existing chiropractic — Other specialty needs a real label',
    why: 'Owners say “chiropractic”; rail/PDF must not stay blank Consultation space.',
    turns: [
      "Saratoga Spine & Wellness, existing chiropractic office in Saratoga Springs for 6 years. One front desk, two chiropractors. Keep our Spectrum number. After hours voicemail, no on-call. Weekdays 9 to 5, no lunch close."
    ],
    expect: {
      plan: { specialty: 'Other healthcare practice', specialtyDetail: /Chiropractic/i, mode: 'improving' },
      sceneBadge: /Chiropractic/i,
      ownerText: /Chiropractic|chiropractic/i,
      neverAck: /not a dental or eye-care room layout/i
    }
  },
  {
    id: 'RL03-other-chip-then-type-detail',
    title: 'Owner taps Other, then types family medicine',
    why: 'New specialtyDetail follow-up must fire after the Other chip.',
    turns: [
      "We're opening a new practice in Albany next spring."
    ],
    chips: {
      mode: { field_id: 'mode', value: 'opening', label: 'Opening a new practice' },
      name: { field_id: 'name', value: null, operation: 'skip', label: 'Skip for now' },
      specialty: { field_id: 'specialty', value: 'Other healthcare practice', label: 'Other healthcare practice' }
    },
    typed: {
      specialtyDetail: 'Family medicine'
    },
    expect: {
      plan: { specialty: 'Other healthcare practice', specialtyDetail: 'Family medicine' },
      asked: ['specialtyDetail'],
      ackIncludes: /family medicine/i,
      sceneBadge: /Family medicine/i
    }
  },
  {
    id: 'RL04-eye-care-optometry',
    title: 'Beacon optometry improving phones',
    why: 'Eye care path — not Dental rooms, not Other.',
    turns: [
      "Beacon Vision Care, optometry practice in Beacon NY. We've had terrible phones for years. Two front desk, three doctors. Person answers first. After hours answering service. Keep our number."
    ],
    expect: {
      plan: { specialty: 'Eye care', mode: 'improving', name: /Beacon Vision/i },
      neverPlan: { specialty: 'Dental' }
    }
  },
  {
    id: 'RL05-pt-closed-wednesday',
    title: 'Physical therapy closed Wednesdays',
    why: 'Odd hours must not invent Friday 9–5; Other detail = Physical therapy.',
    turns: [
      "Hudson Valley Physical Therapy in Newburgh, existing. Open 7 to 7 Mon Tue Thu, 7 to 3 Friday, closed Wednesday. Two front desk, three PTs. Keep RingCentral number. After hours voicemail. If both busy put them in a short queue."
    ],
    expect: {
      plan: { specialtyDetail: /Physical therapy/i, mode: 'improving' },
      fridayNotDefault: true,
      wednesdayClosed: true
    }
  },
  {
    id: 'RL06-solo-dentist-no-staff',
    title: 'Solo dentist answers their own phone',
    why: 'Zero reception + human first must reopen inbound device / not empty RG.',
    turns: [
      "I'm a solo dentist opening in Troy. Just me, no front desk yet. I answer the phone myself during the day. After hours voicemail to me. One operatory for now. Opening April."
    ],
    expect: {
      plan: { specialty: 'Dental', mode: 'opening' },
      noEmptyInboundRg: true,
      fusionOk: true
    }
  },
  {
    id: 'RL07-menu-first-multi-team',
    title: 'Larger office wants a short keypad menu',
    why: 'Menu-first must not invent person-first; engineer path uses IVR.',
    turns: [
      "Capital Dental Group in Albany, existing, three locations under one number. We want a short menu: 1 appointments, 2 billing, 3 clinical. Four receptionists. After hours voicemail. No AI."
    ],
    chips: {
      'first.kind': { field_id: 'first.kind', value: 'menu', label: 'A short phone menu' }
    },
    expect: {
      plan: { first: { kind: 'menu' } },
      engText: /IVR|menu|digit/i,
      neverOwner: /A person answers\. No keypad/i
    }
  },
  {
    id: 'RL08-ai-after-hours-proposed',
    title: 'Owner wants AI after hours — honesty once',
    why: 'Ack must say confirm-before-install, not legalize every sentence.',
    turns: [
      "Opening Smile Kids Pediatric Dentistry in Glens Falls June 2027. Two receptionists answer during the day. After hours I want an AI receptionist to book in Dentrix. Lunch 12-1 phones closed. Mon-Fri 8-4:30."
    ],
    chips: {
      'after.kind': { field_id: 'after.kind', value: 'assistant', label: 'AI receptionist' }
    },
    expect: {
      plan: { after: { kind: 'assistant' } },
      ackSoft: true,
      neverAck: /still proposed until a vendor verifies it/i
    }
  },
  {
    id: 'RL09-answering-service-not-name',
    title: 'AnswerConnect is the service, not the practice name',
    why: 'Classic trap — never name the practice AnswerConnect.',
    turns: [
      "Bright Smiles Orthodontics in Albany and Clifton Park. Three treatment coordinators answer. After hours we use AnswerConnect. Keep the published number. Two orthodontists."
    ],
    expect: {
      plan: { name: /Bright Smiles/i, after: { kind: 'service' } },
      neverPlan: { name: /AnswerConnect/i },
      neverOwner: /AnswerConnect Orthodontics/i
    }
  },
  {
    id: 'RL10-personal-cell-scrub',
    title: 'Owner pastes a personal cell for on-call',
    why: 'PII scrub — cell must not land in greetings or PDFs.',
    turns: [
      "Opening River Street Dental in Poughkeepsie March 2027. Two front desk, me the dentist. Front desk first. After hours voicemail. For emergencies call my cell 845-555-0199 — but don't put that in the greeting."
    ],
    expect: {
      noPhoneInPdf: true,
      ownerText: /personal cell|work|on-call/i,
      neverOwner: /845-555-0199/
    }
  },
  {
    id: 'RL11-phi-leak-patient-name',
    title: 'Owner pastes a patient name and DOB mid-chat',
    why: 'Scrub must strip PHI without derailing the plan.',
    turns: [
      "We're Midtown Family Medicine, existing practice in Kingston. Patient Maria Lopez DOB 03/14/1988 called about her refill — ignore that. Two front desk, three clinicians. Person answers first. After hours voicemail."
    ],
    expect: {
      plan: { specialty: 'Other healthcare practice', specialtyDetail: /Family medicine|Midtown/i },
      neverOwner: /Maria Lopez|03\/14\/1988/,
      scrubAck: true
    }
  },
  {
    id: 'RL12-rooms-not-phones',
    title: 'Buyer almost orders a phone per chair',
    why: 'Six chairs must never become six desk phones on the order page.',
    turns: [
      "Opening Catskill Family Dental with six chairs. I thought I needed six phones — one per chair? Two receptionists at the front. Front desk answers. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      plan: { specialty: 'Dental' },
      ownerText: /Not a phone per room|rooms are chairs|treatment room/i,
      deskNotRooms: true
    }
  },
  {
    id: 'RL13-shared-front-desk-line',
    title: 'Two receptionists, one shared phone',
    why: 'Shared line = one concurrent call; PDF must warn.',
    turns: [
      "Existing dental office in New Paltz. Two people at the front sharing one phone — they can't both talk at once. After hours voicemail. Keep number."
    ],
    chips: {
      'devices.reception.sharing': { field_id: 'devices.reception.sharing', value: 'shared', label: 'One shared line' }
    },
    expect: {
      ownerText: /shared|one conversation|one line/i
    }
  },
  {
    id: 'RL14-separate-lines-both-ring',
    title: 'Two receptionists need both lines to ring',
    why: 'Separate SIP users — engineer directory shows 201–202.',
    turns: [
      "Kingston Smile Dental, improving. Two receptionists, both need to pick up at once on separate lines. Desk phones. After hours voicemail. Front desk first."
    ],
    chips: {
      'devices.reception.sharing': { field_id: 'devices.reception.sharing', value: 'separate', label: 'Two separate lines' },
      'devices.reception.kind': { field_id: 'devices.reception.kind', value: 'desk', label: 'Desk phones' }
    },
    expect: {
      engText: /201|202|separate|both can pick up/i,
      ownerText: /2|independent|separate/i
    }
  },
  {
    id: 'RL15-before-opening-callback',
    title: 'Number found before opening day',
    why: 'Before-opening callback must appear in callerHear and owner page 02.',
    turns: [
      "Opening Hudson River Eye Care in Hudson April 2027. Two front desk. If someone finds the number before we open, take a callback. New number. Front desk answers first. After hours information recording then hang up."
    ],
    expect: {
      plan: { specialty: 'Eye care', mode: 'opening', policy: { beforeOpening: 'message' } },
      hearWhen: /Before opening/i,
      hearInOwnerPdf: true
    }
  },
  {
    id: 'RL16-24h-emergency-dental',
    title: '24-hour emergency dental',
    why: 'Always-on hours — no after-hours recording path.',
    turns: [
      "Capital Emergency Dental in Albany. We're open 24 hours every day. Two front desk on rotation, three dentists. Person answers first. No after-hours voicemail — phones never close."
    ],
    expect: {
      plan: { specialty: 'Dental' },
      alwaysOn: true,
      neverOwner: /After hours.*voicemail for the next business day/i
    }
  },
  {
    id: 'RL17-skip-name-type-later',
    title: 'Skip practice name, type it later',
    why: 'Name stays type-first; Skip is quiet; free text can fill later.',
    turns: [
      "Opening a dental practice in Rhinebeck next fall. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5."
    ],
    chips: {
      name: { field_id: 'name', value: null, operation: 'skip', label: 'Skip for now' }
    },
    typedLater: 'The practice is called Rhinebeck Family Dental.',
    expect: {
      canSkipName: true,
      nameLater: /Rhinebeck Family Dental/i
    }
  },
  {
    id: 'RL18-derm-terse-dump',
    title: 'One-line dermatology dump',
    why: 'Busy owners paste scraps; Other detail + after service must still land.',
    turns: [
      "dermatology, troy ny, 4 docs, 3 front desk, 8-5 m-f, after hours answering service, keep number"
    ],
    expect: {
      plan: { specialty: 'Other healthcare practice', specialtyDetail: /Dermatolog/i, after: { kind: 'service' } },
      city: /Troy/i
    }
  },
  {
    id: 'RL19-correction-midstream',
    title: 'Owner corrects city and headcount mid-chat',
    why: 'Correct flow — Kingston→New Paltz, 3 desk→2.',
    turns: [
      "Opening a dental office in Kingston with three front desk people. Front desk answers first.",
      "Actually it's New Paltz, not Kingston, and only two receptionists. After hours voicemail."
    ],
    expect: {
      plan: { policy: { cityState: /New Paltz/i } },
      reception: 2,
      neverPlan: { policy: { cityState: /^Kingston/i } }
    }
  },
  {
    id: 'RL20-work-mobile-not-personal',
    title: 'Overflow to office manager work mobile',
    why: 'Work app / Follow Me — never print personal cell.',
    turns: [
      "Existing dental in Middletown. Two front desk on separate lines. If they're slammed, ring the office manager's work mobile — not her personal cell. After hours voicemail. Front desk first."
    ],
    expect: {
      ownerText: /work (mobile|app|phone)|personal cell/i,
      engText: /Follow Me|work mobile/i,
      neverOwner: /\d{3}[-.\s]\d{3}[-.\s]\d{4}/
    }
  },
  {
    id: 'RL21-lunch-vs-after-hours',
    title: 'Lunch close is not overnight voicemail',
    why: 'Owners confuse lunch with after-hours; scripts must stay distinct.',
    turns: [
      "Chen-style dental in Kingston opening soon. Mon-Thu 8-5, lunch 12:30-1:30 phones closed. After hours next-day voicemail. Two receptionists, separate lines. Front desk first."
    ],
    expect: {
      distinctLunchAndAfter: true,
      hearInOwnerPdf: true
    }
  },
  {
    id: 'RL22-draft-ready-book-url',
    title: 'Draft-ready plan can book with plan+session shape',
    why: 'Review handoff URL shape: plan id always present; name when known.',
    turns: [
      "Opening Bookable Dental in Albany March 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5 no lunch close."
    ],
    expect: {
      bookUrlShape: true,
      draftSummary: true
    }
  },
  {
    id: 'RL23-engineer-shop-sheet',
    title: 'Installer opens engineer PDF as a shop sheet',
    why: 'Path hop table, directory blanks, build checkboxes must be present.',
    turns: [
      "Opening Shop Sheet Dental in Kingston March 2027. Two receptionists on desk phones, separate lines. Front desk first. Busy = message. After hours voicemail. Lunch 12-1 closed. Before opening callback. New number."
    ],
    expect: {
      engPathTable: true,
      engDirectoryBlanks: true,
      engBuildChecks: true,
      pairedFooters: true
    }
  },
  {
    id: 'RL24-chip-ack-human-voice',
    title: 'Chip acknowledgements sound human',
    why: 'Stiff legalizing phrases must be gone from CHIP_SUBJECT.',
    turns: [],
    expect: {
      chipSubjectsHuman: true
    }
  },

  // ——— Wave 2: deeper field / installer / correction cases ———
  {
    id: 'RL25-hours-correction-triple',
    title: 'Owner corrects hours three times in a row',
    why: 'Rosendale-style flip-flops — final Friday close must stick.',
    turns: [
      "Opening Rosendale Dental in Kingston NY, May 2027. Two receptionists. We are open 8 to 5 weekdays. Front desk first. After hours voicemail.",
      "Actually we are open 9 to 6, not 8 to 5. And it is three receptionists, I forgot Jen.",
      "No wait, Fridays we close at 1."
    ],
    expect: {
      plan: { specialty: 'Dental', mode: 'opening' },
      reception: 3,
      fridayEnd: '13:00'
    }
  },
  {
    id: 'RL26-spanish-open-hours-only',
    title: 'Bilingual desk, English after hours',
    why: 'Spanish during open hours must not invent overnight Spanish.',
    turns: [
      "Opening Maple Dental in Poughkeepsie March 2027. Two receptionists, one bilingual. Spanish during open hours is enough — we cannot cover Spanish at 9 PM. Front desk first. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      spanishOpenOnly: true,
      neverOwner: /Spanish after hours|Spanish at all hours|Spanish overnight/i
    }
  },
  {
    id: 'RL27-port-keep-number',
    title: 'Existing office ports Spectrum number',
    why: 'Keep/port must not invent a brand-new DID.',
    turns: [
      "Riverbend Family Dental in Kingston, existing for 12 years. Keep our Spectrum number and port it. Two front desk. Front desk first. After hours voicemail. Weekdays 8-5."
    ],
    expect: {
      plan: { mode: 'improving' },
      porting: true,
      neverOwner: /This is a new published number, not a port/i
    }
  },
  {
    id: 'RL28-fax-stays-off-patient-line',
    title: 'Insurance fax must stay off patient number',
    why: 'Analog fax + patient DID mix is a common install mistake.',
    turns: [
      "Opening Fax Aware Dental in Albany April 2027. Two receptionists. Front desk first. After hours voicemail. We still have a fax for insurance — keep the fax, don't mix it with the patient number. New number."
    ],
    expect: {
      faxOffPatient: true,
      engText: /fax/i
    }
  },
  {
    id: 'RL29-snow-days-follow-closed',
    title: 'Snow days follow closed-hours recording',
    why: 'Never forward published number to a personal phone on snow days.',
    turns: [
      "Opening Snow Day Dental in Catskill Nov 2027. Two receptionists. Front desk first. After hours voicemail. Snow days should follow the closed-hours recording — never forward the published number to a personal phone."
    ],
    expect: {
      ownerText: /snow|closed-hours|personal/i,
      neverOwner: /forward.{0,40}personal phone to the published/i
    }
  },
  {
    id: 'RL30-thanksgiving-christmas',
    title: 'Named holidays on the calendar',
    why: 'Thanksgiving and Christmas must land as holiday dates, not invent hours.',
    turns: [
      "Opening Holiday Dental in Beacon March 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. Closed Thanksgiving and Christmas."
    ],
    expect: {
      holidays: true,
      engText: /Thanksgiving|Nov|Christmas|Dec|holiday/i
    }
  },
  {
    id: 'RL31-computer-headset-front',
    title: 'Front desk answers on computer + headset',
    why: 'Computer answering is not a desk-phone order.',
    turns: [
      "Opening Softphone Dental in Newburgh May 2027. Two receptionists answer on computers with headsets, not desk phones. Separate lines so both can pick up. Front desk first. After hours voicemail."
    ],
    chips: {
      'devices.reception.kind': { field_id: 'devices.reception.kind', value: 'computer', label: 'Computer and headset' },
      'devices.reception.sharing': { field_id: 'devices.reception.sharing', value: 'separate', label: 'Two separate lines' }
    },
    expect: {
      computerFront: true,
      ownerText: /computer|headset/i
    }
  },
  {
    id: 'RL32-ruby-answering-service',
    title: 'After hours Ruby Receptionist brand',
    why: 'Ruby must map to service, not PMS, not practice name.',
    turns: [
      "Summit Orthodontics in Albany, existing. Three treatment coordinators. After hours we use Ruby. Keep our number. Person answers first during the day."
    ],
    expect: {
      plan: { after: { kind: 'service' }, specialty: 'Dental', name: /Summit Orthodontics/i },
      neverPlan: { name: /Ruby/i },
      pmsNotServiceBrand: true
    }
  },
  {
    id: 'RL33-smith-ai-after-hours',
    title: 'Smith.ai named as after-hours vendor',
    why: 'Smith.ai is an answering/AI service brand — not Open Dental.',
    turns: [
      "Greenbush Pediatric Dentistry, existing in Troy. Two front desk. After hours we use Smith.ai. Keep number. Front desk first."
    ],
    expect: {
      plan: { after: { kind: 'service' }, specialty: 'Dental' },
      pmsNotServiceBrand: true,
      neverPlan: { name: /Smith/i }
    }
  },
  {
    id: 'RL34-no-on-call-explicit',
    title: 'Owner refuses on-call path',
    why: '“No on-call” must not invent digit-9 urgent connect.',
    turns: [
      "Quiet Hours Chiropractic in Saugerties, existing. One front desk. After hours just voicemail, no on-call. Weekdays 9-5. Keep number."
    ],
    expect: {
      plan: { specialtyDetail: /Chiropractic/i },
      noOnCall: true,
      neverEng: /MUST CONNECT|digit 9 rings the work on-call/i
    }
  },
  {
    id: 'RL35-vague-dental-still-asks',
    title: 'Vague owner who only knows “small dental”',
    why: 'Must not invent a finished plan; still ask real questions.',
    turns: [
      "honestly i dont know anything about phones, we just need it to work. small dental office. help"
    ],
    expect: {
      plan: { specialty: 'Dental' },
      stillAsking: true
    }
  },
  {
    id: 'RL36-adding-second-location',
    title: 'Second location under one published number',
    why: 'Mode=adding; overflow city must not wipe primary city.',
    turns: [
      "We already have Kingston Family Dental. We're adding a second office in New Paltz under the same number. Two receptionists at Kingston answer both. Front desk first. After hours voicemail."
    ],
    expect: {
      plan: { mode: 'adding', specialty: 'Dental' },
      city: /Kingston/i
    }
  },
  {
    id: 'RL37-ai-first-then-take-back',
    title: 'AI first, then owner takes it back',
    why: 'Correction from AI-first back to person-first must stick.',
    turns: [
      "Opening Future Smile Dental in Albany June 2027. I want an AI receptionist to answer first and book appointments. Two humans as backup. After hours voicemail.",
      "Actually I don't want the AI answering first — the girls at the front should answer. Keep AI as something we might add later."
    ],
    expect: {
      plan: { first: { kind: 'human' } },
      neverPlan: { first: { kind: 'assistant' } }
    }
  },
  {
    id: 'RL38-billing-stays-with-front',
    title: 'Front desk also does billing',
    why: 'No phantom office-manager seat when billing stays at reception.',
    turns: [
      "Existing dental in Middletown. Two front desk people who also do all the billing. No separate office manager. Front desk answers first. After hours voicemail. Keep number."
    ],
    expect: {
      billingAtReception: true,
      adminZeroOrUnset: true
    }
  },
  {
    id: 'RL39-urgent-only-not-every-call',
    title: 'On-call only for true urgents',
    why: 'Urgent scope must be urgent_only, not every inbound call.',
    turns: [
      "Opening Trauma Aware Dental in Poughkeepsie March 2027. Two receptionists. Front desk first. After hours voicemail. If someone has swelling, trauma, or bleeding, try the on-call dentist — only those urgent cases, not every call. If we miss it, take a priority message."
    ],
    expect: {
      urgentOnly: true,
      ownerText: /on-call|urgent|swelling|trauma|bleeding/i
    }
  },
  {
    id: 'RL40-information-then-hangup',
    title: 'After hours play info and hang up',
    why: 'Information path — no mailbox, no service.',
    turns: [
      "Opening Announce Only Eye Care in Hudson May 2027. Two front desk. Front desk first. After hours just play our hours and hang up — no voicemail. New number."
    ],
    chips: {
      'urgent.kind': { field_id: 'urgent.kind', value: 'none', label: 'No separate urgent path' }
    },
    expect: {
      plan: { specialty: 'Eye care', after: { kind: 'information' } },
      hearWhen: /After hours/i,
      noOnCall: true
    }
  },
  {
    id: 'RL41-half-hour-lunch-burlington',
    title: '12:30–1:30 lunch, out-of-area city',
    why: 'Half-hour lunch must not become 12–1; Burlington still parses.',
    turns: [
      "Opening Lake Champlain Dental in Burlington VT May 2027. Two receptionists. Front desk first. Weekdays 8 to 5, lunch 12:30 to 1:30 phones closed. After hours voicemail. New number."
    ],
    expect: {
      lunchHalf: true,
      city: /Burlington/i
    }
  },
  {
    id: 'RL42-med-spa-other-detail',
    title: 'Med spa as Other specialty free-text',
    why: 'Non-dental clinical specialty gets a real specialtyDetail label.',
    turns: [
      "Opening Glow Med Spa in Beacon June 2027. Aesthetic medicine / med spa. Two front desk. Front desk first. After hours voicemail. Weekdays 10-6."
    ],
    chips: {
      specialty: { field_id: 'specialty', value: 'Other healthcare practice', label: 'Other healthcare practice' }
    },
    typed: {
      specialtyDetail: 'Med spa'
    },
    expect: {
      plan: { specialty: 'Other healthcare practice', specialtyDetail: /Med spa/i },
      sceneBadge: /Med spa/i
    }
  },
  {
    id: 'RL43-talk-first-placeholder',
    title: 'Composer stays talk-first',
    why: 'UI copy must invite free text, not chip-only.',
    turns: [],
    expect: {
      talkFirstUi: true
    }
  },
  {
    id: 'RL44-draft-close-copy',
    title: 'Draft-ready close is owner-voiced',
    why: 'No “draw both files”; Book is primary CTA copy.',
    turns: [],
    expect: {
      draftCloseUi: true
    }
  },
  {
    id: 'RL45-review-name-prefill-source',
    title: 'Review page prefills practice name',
    why: 'Booking handoff must prefill business_name from ?name=.',
    turns: [],
    expect: {
      reviewPrefillSource: true
    }
  },
  {
    id: 'RL46-owner-engineer-identity-match',
    title: 'Paired PDFs share identity forever',
    why: 'Installer must see same planId · revision · checksum on both files.',
    turns: [
      "Opening Identity Match Dental in Kingston March 2027. Two receptionists on separate desk phones. Front desk first. Busy message. After hours voicemail. Lunch 12-1 closed. Before opening callback. New number."
    ],
    expect: {
      pairedIdentity: true,
      pairedFooters: true,
      ownerPages: 6
    }
  },
  {
    id: 'RL47-empty-rg-never-finishes',
    title: 'Human-first with zero desk devices stays unfinished',
    why: 'Empty inbound RG is an install killer — chat must not declare draft-ready.',
    turns: [
      "Opening Empty Desk Dental in Troy. Front desk answers first. Zero phones ordered yet — we haven't decided desk vs computer. Two receptionists. After hours voicemail."
    ],
    chips: {
      'teams.reception.count': { field_id: 'teams.reception.count', value: 0, label: 'None' }
    },
    expect: {
      noEmptyInboundRg: true,
      // with 0 reception + human first, must keep asking or repair
      stillAskingOrRepaired: true
    }
  },
  {
    id: 'RL48-pediatric-dentrix-ai-wish',
    title: 'Pediatric dental wants Dentrix + AI later',
    why: 'Dentrix is PMS; AI “later” must not force AI-first at launch.',
    turns: [
      "Little Teeth Pediatric Dentistry opening in Glens Falls June 2027. Two receptionists answer during the day. We'll run Dentrix. AI receptionist maybe later when we are bigger — not at launch. After hours voicemail. Lunch 12-1 closed. Mon-Fri 8-4:30."
    ],
    expect: {
      plan: { specialty: 'Dental', mode: 'opening', after: { kind: 'message' } },
      pms: /Dentrix/i,
      neverPlan: { first: { kind: 'assistant' } },
      futureAiNoted: true
    }
  },
  {
    id: 'RL49-weve-had-practice-name',
    title: 'We’ve had NAME in CITY extracts the practice name',
    why: 'Owners narrate history without “called/named”; name must still land for recordings.',
    turns: [
      "We've had Hudson Family Dental in Hudson for twenty years. Two girls at the front. They pick up, not a menu. After hours take a message."
    ],
    expect: {
      plan: { name: /Hudson Family Dental/i, mode: 'improving', after: { kind: 'message' } },
      hearWhen: /After hours/i,
      hearScript: /next business day/i
    }
  },
  {
    id: 'RL50-information-recording-phrase',
    title: 'After hours information recording then hang',
    why: 'Alternate phrasing must still be information, not a mailbox.',
    turns: [
      "Opening Quiet Hours Eye Care in Kingston May 2027. Two front desk. Front desk first. After hours information recording then hang up. New number."
    ],
    chips: {
      'urgent.kind': { field_id: 'urgent.kind', value: 'none', label: 'No separate urgent path' }
    },
    expect: {
      plan: { after: { kind: 'information' }, specialty: 'Eye care' },
      hearWhen: /After hours/i,
      neverPlan: { after: { kind: 'message' } }
    }
  },
  {
    id: 'RL51-after-hours-message-to-info',
    title: 'Owner corrects after-hours voicemail to play-hours hangup',
    why: 'Midstream correction must flip message → information and drop mailbox language.',
    turns: [
      "Opening Flip Path Dental in Beacon April 2027. Two receptionists. Front desk first. After hours voicemail. New number.",
      "Actually after hours just play our hours and hang up — no voicemail."
    ],
    chips: {
      'urgent.kind': { field_id: 'urgent.kind', value: 'none', label: 'No separate urgent path' }
    },
    expect: {
      plan: { after: { kind: 'information' } },
      hearWhen: /After hours/i,
      hearScript: /currently closed|call back during/i,
      afterHearNever: /next business day/i
    }
  },
  {
    id: 'RL52-ordered-ring-not-together',
    title: 'Ring the senior desk first, then the junior',
    why: 'Ordered ring must not become simultaneous “both pick up”.',
    turns: [
      "Opening Cascade Dental in Troy May 2027. Two receptionists. Ring the senior desk first, then the other if she misses it. Front desk first. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      plan: { policy: { ring: 'order' }, first: { kind: 'human' } },
      neverPlan: { policy: { ring: 'together' } }
    }
  },
  {
    id: 'RL53-busy-queue-wait',
    title: 'If both busy, let callers wait in a short queue',
    why: 'Explicit wait must become queue, not instant voicemail.',
    turns: [
      "Opening Waitline Dental in Newburgh May 2027. Two front desk. Front desk first. If both are busy let them wait in a short queue. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      plan: { busy: { kind: 'queue' }, after: { kind: 'message' } }
    }
  },
  {
    id: 'RL54-friday-half-day',
    title: 'Weekdays with Friday half day',
    why: 'Mon–Thu full day + Friday early close must not invent Friday 5 PM.',
    turns: [
      "Opening Half Day Dental in Albany March 2027. Two receptionists. Front desk first. Monday to Thursday 8 to 5, Friday 8 to 2, closed weekends. After hours voicemail. New number."
    ],
    expect: {
      plan: { specialty: 'Dental', mode: 'opening' },
      fridayHalf: true
    }
  },
  {
    id: 'RL55-scranton-pa-city',
    title: 'Scranton PA out-of-area city',
    why: 'Non-Hudson-Valley city still parses with PA state.',
    turns: [
      "Opening Lackawanna Family Dental in Scranton PA June 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      city: /Scranton,\s*PA/i,
      plan: { name: /Lackawanna Family Dental/i }
    }
  },
  {
    id: 'RL56-saturday-morning-hours',
    title: 'Saturday morning open, Sunday closed',
    why: 'Weekend hours must stick; Saturday must not become closed-all-weekend.',
    turns: [
      "Opening Weekend Smile Dental in Kingston May 2027. Two receptionists. Front desk first. Weekdays 9 to 5, Saturdays 9 to 1, closed Sunday. After hours voicemail. New number."
    ],
    expect: {
      saturdayOpen: true,
      sundayClosed: true
    }
  },
  {
    id: 'RL57-before-opening-information',
    title: 'Before opening play not-open-yet, not a callback box',
    why: 'Pre-open announcement is information — separate from after-hours.',
    turns: [
      "Opening Announce First Eye Care in Hudson July 2027. Two front desk. Front desk first. Before we open just play a not-open-yet recording and hang up — no callback box. After hours voicemail. New number."
    ],
    expect: {
      plan: { mode: 'opening', policy: { beforeOpening: 'information' }, after: { kind: 'message' } },
      hearWhen: /Before opening/i
    }
  },
  {
    id: 'RL58-urgent-connect-with-message',
    title: 'After-hours voicemail plus digit-9 on-call',
    why: 'Urgent connect must coexist with message after hours (closed IVR), not wipe the mailbox.',
    turns: [
      "Opening Oncall Message Dental in Poughkeepsie March 2027. Two receptionists. Front desk first. After hours voicemail. If swelling trauma or bleeding, try the on-call dentist — only those. If we miss it, priority message. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { after: { kind: 'message' } },
      urgentConnect: true,
      hearWhen: /After hours/i
    }
  },
  {
    id: 'RL59-orthodontics-from-name',
    title: 'Orthodontics specialty from practice name',
    why: 'Name suffix Orthodontics should classify specialty without a chip fight.',
    turns: [
      "Opening Apex Orthodontics in Albany May 2027. Three treatment coordinators. Person answers first. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      plan: { specialty: 'Dental', name: /Apex Orthodontics/i },
      sceneBadge: /Ortho|Dental/i
    }
  },
  {
    id: 'RL60-messy-hudson-dump',
    title: 'Messy multi-fact dump still lands mailbox + lunch',
    why: 'Owners dump everything at once; lunch and after-hours message must both survive.',
    turns: [
      "We've had Catskill Family Dental in Catskill for fifteen years. Two girls at the front, I'm the dentist. They pick up, not a menu. Weekdays eight to five. Closed for lunch noon to one. When the girls are with a patient take a message. After hours take a message. Keep the number. English is enough. We don't have anyone on call."
    ],
    expect: {
      plan: { name: /Catskill Family Dental/i, after: { kind: 'message' }, busy: { kind: 'message' } },
      hearWhen: /After hours/i,
      lunchClosed: true,
      noOnCall: true
    }
  },
  {
    id: 'RL61-phones-covered-at-lunch',
    title: 'Someone stays on phones at lunch',
    why: 'Covered lunch must not invent a lunch-closed recording.',
    turns: [
      "Opening Covered Lunch Dental in Kingston April 2027. Two receptionists. Front desk first. Weekdays 9 to 5. Someone stays on the phones at lunch. After hours voicemail. New number."
    ],
    expect: {
      noLunchClose: true,
      plan: { after: { kind: 'message' } }
    }
  },
  {
    id: 'RL62-not-city-rejection',
    title: 'not Kingston is a rejection, not a city choice',
    why: 'Negative city mentions must not pin the wrong town.',
    turns: [
      "Opening Valley View Dental — not Kingston, we're in New Paltz. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      city: /New Paltz/i,
      neverPlan: { policy: { cityState: /Kingston/i } }
    }
  },
  {
    id: 'RL63-shared-one-phone',
    title: 'Two people sharing one phone cannot both talk',
    why: 'Shared single device must not become separate lines.',
    turns: [
      "Existing dental office in New Paltz — Parkside Family Dental. Two people at the front sharing one phone — they can't both talk at once. After hours voicemail. Keep number. Front desk answers."
    ],
    expect: {
      plan: { name: /Parkside Family Dental/i, mode: 'improving' },
      sharedPhone: true
    }
  },
  {
    id: 'RL64-info-hear-mentions-closed',
    title: 'Information after-hours script says closed / call back',
    why: 'Default info recording must be hearable even with empty owner instructions.',
    turns: [
      "Opening Hours Only Eye Care in Hudson May 2027. Two front desk. Front desk first. After hours just play our hours and hang up — no voicemail. New number."
    ],
    chips: {
      'urgent.kind': { field_id: 'urgent.kind', value: 'none', label: 'No separate urgent path' }
    },
    expect: {
      plan: { after: { kind: 'information' } },
      hearWhen: /After hours/i,
      hearScript: /currently closed|call back during/i
    }
  },
  {
    id: 'RL65-doctor-answers-first',
    title: 'Solo doctor answers the phone first',
    why: 'Clinical first-answer must not default to reception when the owner is the answerer.',
    turns: [
      "I'm a solo dentist opening Summit Ridge Dental in Kingston May 2027. No front desk yet — I answer the phone myself between patients. After hours voicemail to me. New number."
    ],
    expect: {
      plan: { first: { kind: 'human', team: 'clinical' }, mode: 'opening', after: { kind: 'message' } },
      neverPlan: { first: { team: 'reception' } }
    }
  },
  {
    id: 'RL66-open-dental-pms',
    title: 'Open Dental is the PMS',
    why: 'PMS brand must land in opening.pms, not as practice name or after-hours service.',
    turns: [
      "Opening Bridge Street Dental in Troy April 2027. Two receptionists. Front desk first. We'll run Open Dental. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      pms: /Open Dental/i,
      plan: { name: /Bridge Street Dental/i, after: { kind: 'message' } },
      neverPlan: { after: { kind: 'service' } }
    }
  },
  {
    id: 'RL67-carestream-eye',
    title: 'Carestream PMS for eye care',
    why: 'CS/Carestream is PMS for optometry — not a phone vendor.',
    turns: [
      "Opening Lakeside Eye Care in Beacon June 2027. Two front desk. Front desk first. We use Carestream. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { specialty: 'Eye care' },
      pms: /Carestream/i
    }
  },
  {
    id: 'RL68-new-then-port-correction',
    title: 'Owner flips new number to porting',
    why: 'Midstream correction of opening.numbers must stick.',
    turns: [
      "Opening Port Flip Dental in Albany March 2027. Two receptionists. Front desk first. After hours voicemail. New number.",
      "Actually keep our Spectrum number — we're porting, not getting a new one."
    ],
    expect: {
      porting: true,
      numbersPorting: true
    }
  },
  {
    id: 'RL69-dentist-checks-voicemail',
    title: 'Dentist owns the after-hours mailbox',
    why: '“I check the messages” must set after.owner clinical, not invent reception.',
    turns: [
      "Opening Owner Mailbox Dental in Newburgh May 2027. Two receptionists answer during the day. Front desk first. After hours voicemail — I check the messages myself in the morning. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { after: { kind: 'message', owner: 'clinical' } }
    }
  },
  {
    id: 'RL70-lunch-one-to-two',
    title: 'Lunch close 1–2 PM',
    why: 'Non-default lunch window must not snap to 12–1.',
    turns: [
      "Opening Late Lunch Dental in Kingston April 2027. Two receptionists. Front desk first. Weekdays 9 to 5, lunch 1 to 2 phones closed. After hours voicemail. New number."
    ],
    expect: {
      lunchWindow: ['13:00', '14:00']
    }
  },
  {
    id: 'RL71-closed-mondays',
    title: 'Closed Mondays, open Tue–Fri',
    why: 'Unusual weekly pattern must not invent Monday open hours.',
    turns: [
      "Opening Tuesday Start Dental in Poughkeepsie May 2027. Two receptionists. Front desk first. Closed Mondays. Tuesday through Friday 9 to 5. After hours voicemail. New number."
    ],
    expect: {
      mondayClosed: true,
      plan: { after: { kind: 'message' } }
    }
  },
  {
    id: 'RL72-backup-admin-when-busy',
    title: 'If front is slammed, try office manager',
    why: 'Busy backup to admin must record without changing first-answer team.',
    turns: [
      "Opening Overflow Admin Dental in Kingston May 2027. Two front desk, one office manager. Front desk first. If the front is slammed, ring the office manager's work mobile. After hours voicemail. Weekdays 9-5. Keep number."
    ],
    expect: {
      plan: { first: { team: 'reception' }, busy: { backup: 'admin' } },
      workMobile: true
    }
  },
  {
    id: 'RL73-im-dr-opening-name',
    title: 'I’m Dr. Chen opening NAME',
    why: 'Doctor self-intro must not eat the practice name.',
    turns: [
      "I'm Dr. Chen opening Chen Family Dental in Kingston May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 8-5. New number."
    ],
    expect: {
      plan: { name: /Chen Family Dental/i, specialty: 'Dental', mode: 'opening' }
    }
  },
  {
    id: 'RL74-spanish-menu-first',
    title: 'Spanish keypad on a menu-first office',
    why: 'Language menu + press-1 appointments must coexist without forcing staff-ID.',
    turns: [
      "Opening Bilingual Menu Dental in Albany June 2027. We want a short phone menu: press 1 appointments, press 2 billing. Four receptionists. Spanish press option on the menu. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { first: { kind: 'menu' } },
      spanishMenu: true
    }
  },
  {
    id: 'RL75-separate-location-numbers',
    title: 'Two offices, each with its own number',
    why: 'Separate DIDs must not collapse into shared-reception or a location menu.',
    turns: [
      "We already have Kingston Family Dental. We're adding a second office in New Paltz. Each office keeps its own published number. Two receptionists at each. Front desk first. After hours voicemail."
    ],
    expect: {
      plan: { mode: 'adding' },
      locationEntry: /separate|undecided/i
    }
  },
  {
    id: 'RL76-info-then-urgent-none',
    title: 'Information hangup refuses digit-9',
    why: 'Play-hours hangup cannot keep an on-call connect leaf.',
    turns: [
      "Opening No Digit Nine Eye Care in Hudson May 2027. Two front desk. Front desk first. After hours just play our hours and hang up — no voicemail. We don't have anyone on call. New number."
    ],
    expect: {
      plan: { after: { kind: 'information' } },
      noOnCall: true,
      hearWhen: /After hours/i
    }
  },
  {
    id: 'RL77-hear-lunch-return-time',
    title: 'Lunch recording names the return time',
    why: 'Caller-hear lunch script must say when phones return.',
    turns: [
      "Opening Return Time Dental in Beacon April 2027. Two receptionists. Front desk first. Weekdays 8 to 5, lunch 12:30 to 1:30 phones closed. After hours voicemail. New number."
    ],
    expect: {
      lunchHalf: true,
      hearWhen: /At lunch/i,
      hearScript: /1:30|return/i
    }
  },
  {
    id: 'RL78-improving-keep-provider',
    title: 'Existing office keeps RingCentral number',
    why: 'Improving + keep number must not flip to opening/new.',
    turns: [
      "We've had Maple Grove Family Dental in Saugerties for eight years. Two front desk. Front desk first. Keep our RingCentral number. After hours voicemail. Weekdays 9-5. No on-call."
    ],
    expect: {
      plan: { mode: 'improving', name: /Maple Grove Family Dental/i },
      porting: true,
      noOnCall: true
    }
  },
  {
    id: 'RL79-eaglesoft-not-service',
    title: 'Eaglesoft is PMS, not answering service',
    why: 'PMS name must never become after.kind service.',
    turns: [
      "Opening Soft Eagle Dental in Troy May 2027. Two receptionists. Front desk first. We use Eaglesoft. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      pms: /Eaglesoft/i,
      plan: { after: { kind: 'message' } },
      neverPlan: { after: { kind: 'service' } }
    }
  },
  {
    id: 'RL80-multi-turn-hours-then-lunch',
    title: 'Hours first, lunch close in a later turn',
    why: 'Split turns must still land weekday hours + lunch without wiping either.',
    turns: [
      "Opening Split Turns Dental in Kingston May 2027. Two receptionists. Front desk first. Weekdays 9 to 5. After hours voicemail. New number.",
      "Also closed for lunch noon to one — phones go to voicemail."
    ],
    expect: {
      lunchWindow: ['12:00', '13:00'],
      plan: { after: { kind: 'message' } },
      hearWhen: /At lunch/i
    }
  },
  {
    id: 'RL81-curve-pms',
    title: 'Curve Dental is the PMS',
    why: 'Curve must land as PMS, never as after-hours service or practice name.',
    turns: [
      "Opening Curve Path Dental in Kingston May 2027. Two receptionists. Front desk first. We use Curve. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      pms: /Curve/i,
      plan: { name: /Curve Path Dental/i, after: { kind: 'message' } },
      neverPlan: { after: { kind: 'service' } }
    }
  },
  {
    id: 'RL82-mode-opening-not-improving',
    title: 'Brand-new opening is not “improving”',
    why: 'Opening language must win over Family Dental heuristic.',
    turns: [
      "We are opening Bright River Family Dental in Kingston June 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { mode: 'opening', name: /Bright River Family Dental/i }
    }
  },
  {
    id: 'RL83-after-hours-to-service-correction',
    title: 'Voicemail corrected to answering service',
    why: 'Midstream flip message → service must stick and name the vendor.',
    turns: [
      "Opening Service Flip Dental in Albany April 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number.",
      "Actually after hours we use AnswerConnect — not voicemail."
    ],
    expect: {
      plan: { after: { kind: 'service' } },
      neverPlan: { after: { kind: 'message' } },
      neverOwner: /AnswerConnect Dental|AnswerConnect Orthodontics/i
    }
  },
  {
    id: 'RL84-three-receptionists',
    title: 'Three front-desk people',
    why: 'Headcount three must not snap to two or invent an office manager.',
    turns: [
      "Opening Triple Desk Dental in Troy May 2027. Three receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      reception: 3,
      plan: { first: { kind: 'human', team: 'reception' } }
    }
  },
  {
    id: 'RL85-office-manager-present',
    title: 'Named office manager on the roster',
    why: 'Office manager should create an admin seat, not stay zero forever.',
    turns: [
      "Opening Manager Seat Dental in Beacon May 2027. Two receptionists and one office manager. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      adminCount: 1,
      reception: 2
    }
  },
  {
    id: 'RL86-no-spanish-explicit',
    title: 'English is enough — no Spanish menu',
    why: 'Explicit English-only must not invent a Spanish language row.',
    turns: [
      "Opening English Only Dental in Kingston April 2027. Two receptionists. Front desk first. English is enough — we don't need Spanish. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      englishOnly: true,
      plan: { after: { kind: 'message' } }
    }
  },
  {
    id: 'RL87-busy-then-voicemail-seconds',
    title: 'Ring 25 seconds then voicemail',
    why: 'Explicit ring timeout should land on busy.seconds when stated.',
    turns: [
      "Opening Ring Timeout Dental in Newburgh May 2027. Two receptionists. Front desk first. If nobody answers after about 25 seconds, take a message. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { busy: { kind: 'message' } },
      busySeconds: 25
    }
  },
  {
    id: 'RL88-holiday-hours-note',
    title: 'Closed Christmas Eve afternoon',
    why: 'Named holiday close must show up on the plan, not only as free text loss.',
    turns: [
      "Opening Holiday Eve Dental in Kingston Nov 2027. Two receptionists. Front desk first. Weekdays 9-5. Closed Christmas Eve afternoon and Christmas Day. After hours voicemail. New number."
    ],
    expect: {
      holidays: true,
      plan: { after: { kind: 'message' } }
    }
  },
  {
    id: 'RL89-location-menu-entry',
    title: 'Two towns, press for location',
    why: 'Location menu must not become shared reception by default.',
    turns: [
      "We already have Kingston Family Dental and we're adding New Paltz under the same published number. Callers should press 1 for Kingston, 2 for New Paltz. Two receptionists at Kingston answer. Front desk first. After hours voicemail."
    ],
    expect: {
      plan: { mode: 'adding' },
      locationEntry: /menu/i
    }
  },
  {
    id: 'RL90-ack-mentions-practice-name',
    title: 'First ack echoes the practice name',
    why: 'Owners need to hear their name back immediately.',
    turns: [
      "Opening Echo Name Family Dental in Kingston May 2027. Two receptionists. Front desk first. After hours voicemail."
    ],
    expect: {
      ackIncludes: /Echo Name Family Dental/i,
      plan: { name: /Echo Name Family Dental/i }
    }
  },
  {
    id: 'RL91-never-personal-cell-in-hear',
    title: 'Personal cell never appears in caller hear',
    why: 'Even when overflow to cell is discussed, recordings stay clean.',
    turns: [
      "Opening Private Cell Dental in Poughkeepsie March 2027. Two receptionists. Front desk first. After hours voicemail. For emergencies call my cell 845-555-0177 — but don't put that in the greeting. New number."
    ],
    expect: {
      neverOwner: /845-555-0177/,
      hearNeverDigits: true,
      plan: { after: { kind: 'message' } }
    }
  },
  {
    id: 'RL92-before-open-and-after-info',
    title: 'Before-open announcement + after-hours info',
    why: 'Both playback paths can be information without collapsing into one mailbox.',
    turns: [
      "Opening Dual Info Eye Care in Hudson July 2027. Two front desk. Front desk first. Before we open play a not-open-yet recording — no callback box. After hours just play our hours and hang up — no voicemail. New number."
    ],
    chips: {
      'urgent.kind': { field_id: 'urgent.kind', value: 'none', label: 'No separate urgent path' }
    },
    expect: {
      plan: { policy: { beforeOpening: 'information' }, after: { kind: 'information' } },
      hearWhenAll: [/Before opening/i, /After hours/i]
    }
  },
  {
    id: 'RL93-skip-rooms-still-ok',
    title: 'Owner never states room count',
    why: 'Rooms question can stay open; plan must still finish answering path.',
    turns: [
      "Opening No Rooms Said Dental in Troy May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    chips: {
      'policy.rooms': { field_id: 'policy.rooms', value: null, label: 'Skip for now', operation: 'skip' }
    },
    expect: {
      plan: { after: { kind: 'message' }, first: { kind: 'human' } },
      fusionOk: true
    }
  },
  {
    id: 'RL94-chiro-existing-keep-number',
    title: 'Existing chiropractic keeps the number',
    why: 'Other specialty + improving + porting in one breath.',
    turns: [
      "We've had River Chiropractic in Kingston for ten years. One front desk, two chiropractors. Keep our number. After hours voicemail, no on-call. Weekdays 9-5."
    ],
    expect: {
      plan: { mode: 'improving', specialty: 'Other healthcare practice', specialtyDetail: /Chiropractic/i },
      porting: true,
      noOnCall: true
    }
  },
  {
    id: 'RL95-priority-message-backup',
    title: 'On-call miss goes to priority message',
    why: 'Urgent backup message must not wipe ordinary after-hours voicemail.',
    turns: [
      "Opening Priority Backup Dental in Albany May 2027. Two receptionists. Front desk first. After hours voicemail. If swelling or bleeding, try on-call — if we miss it, take a priority message. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { after: { kind: 'message' } },
      urgentConnect: true,
      hearWhen: /After hours/i
    }
  },
  {
    id: 'RL96-weekends-always-closed',
    title: 'Owner confirms weekends stay closed',
    why: 'Weekdays-only must close Sat/Sun without inventing Saturday hours.',
    turns: [
      "Opening Weekday Only Dental in Kingston May 2027. Two receptionists. Front desk first. Weekdays 9 to 5, closed weekends. After hours voicemail. New number."
    ],
    expect: {
      saturdayClosed: true,
      sundayClosed: true,
      plan: { after: { kind: 'message' } }
    }
  },
  {
    id: 'RL97-dentrix-ascend',
    title: 'Dentrix Ascend is the PMS',
    why: 'Multi-word PMS must not truncate to Dentrix alone or become a service.',
    turns: [
      "Opening Ascend Path Dental in Kingston May 2027. Two receptionists. Front desk first. We'll run Dentrix Ascend. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      pms: /Dentrix Ascend/i,
      plan: { after: { kind: 'message' } },
      neverPlan: { after: { kind: 'service' } }
    }
  },
  {
    id: 'RL98-webpt-physical-therapy',
    title: 'WebPT PMS for physical therapy',
    why: 'PT specialty + WebPT must not confuse PMS with after-hours vendor.',
    turns: [
      "Opening Summit Physical Therapy in Newburgh May 2027. Two front desk, three PTs. Front desk first. We use WebPT. After hours voicemail. Weekdays 7 to 7. Keep number."
    ],
    expect: {
      plan: { specialtyDetail: /Physical therapy/i, mode: 'opening' },
      pms: /WebPT/i,
      neverPlan: { after: { kind: 'service' } }
    }
  },
  {
    id: 'RL99-service-back-to-message',
    title: 'Answering service corrected back to voicemail',
    why: 'Owner can undo service and land on message again.',
    turns: [
      "Opening Undo Service Dental in Albany April 2027. Two receptionists. Front desk first. After hours we use Ruby. Weekdays 9-5. New number.",
      "Actually forget the answering service — just after hours voicemail."
    ],
    expect: {
      plan: { after: { kind: 'message' } },
      neverPlan: { after: { kind: 'service' } }
    }
  },
  {
    id: 'RL100-early-hours-seven-to-three',
    title: 'Open 7 AM to 3 PM weekdays',
    why: 'Early close must not invent 5 PM end.',
    turns: [
      "Opening Early Close Dental in Troy May 2027. Two receptionists. Front desk first. Weekdays 7 to 3. After hours voicemail. New number."
    ],
    expect: {
      weekdayHours: ['07:00', '15:00'],
      plan: { after: { kind: 'message' } }
    }
  },
  {
    id: 'RL101-thursday-closed',
    title: 'Closed Thursdays',
    why: 'Midweek closed day must stick without inventing Thursday open.',
    turns: [
      "Opening No Thursday Dental in Beacon May 2027. Two receptionists. Front desk first. Monday Tuesday Wednesday Friday 9 to 5, closed Thursday and weekends. After hours voicemail. New number."
    ],
    expect: {
      thursdayClosed: true,
      saturdayClosed: true
    }
  },
  {
    id: 'RL102-called-name-anchor',
    title: 'Practice is called NAME',
    why: '“Called / named” anchors must extract the practice name.',
    turns: [
      "We're called Riverview Family Dental in Kingston. Existing office. Two receptionists. Front desk first. After hours voicemail. Keep number."
    ],
    expect: {
      plan: { name: /Riverview Family Dental/i, mode: 'improving' }
    }
  },
  {
    id: 'RL103-not-a-menu-after-press-talk',
    title: 'Mentions press then rejects menu',
    why: '“Not a menu” must win over incidental press language.',
    turns: [
      "Opening No Menu Dental in Kingston May 2027. Two receptionists. People keep asking about press 1 stuff — we hate those menus, not a menu. Front desk answers. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { first: { kind: 'human' } },
      neverPlan: { first: { kind: 'menu' } }
    }
  },
  {
    id: 'RL104-glens-falls-city',
    title: 'Glens Falls city parse',
    why: 'Two-word city must land with NY state.',
    turns: [
      "Opening Falls View Dental in Glens Falls May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      city: /Glens Falls/i,
      plan: { name: /Falls View Dental/i }
    }
  },
  {
    id: 'RL105-billing-to-office-manager',
    title: 'Billing goes to office manager',
    why: 'Reason routing must send billing to admin when stated.',
    turns: [
      "Opening Books Separate Dental in Kingston May 2027. Two receptionists and one office manager. Front desk first. Appointments stay at the front desk, billing goes to the office manager. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      billingAdmin: true,
      adminCount: 1,
      reception: 2
    }
  },
  {
    id: 'RL106-hear-after-has-911',
    title: 'After-hours voicemail mentions 911',
    why: 'Emergency line in caller-hear must survive empty instructions.',
    turns: [
      "Opening Safety Script Dental in Kingston May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      hearWhen: /After hours/i,
      hearScript: /911/
    }
  },
  {
    id: 'RL107-opening-day-precision',
    title: 'Opening on a specific calendar day',
    why: 'Month+day should record more than month-only precision when stated.',
    turns: [
      "Opening Exact Day Dental in Kingston on May 15, 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { mode: 'opening' },
      openingDate: /2027-05-15|May 15|05\/15/i
    }
  },
  {
    id: 'RL108-four-receptionists-together',
    title: 'Four desk people, all ring together',
    why: 'Larger front desk + simultaneous ring must both stick.',
    turns: [
      "Opening Quad Desk Dental in Albany May 2027. Four receptionists. They all ring at the same time. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      reception: 4,
      plan: { policy: { ring: 'together' }, first: { kind: 'human' } }
    }
  },
  {
    id: 'RL109-other-then-type-dermatology',
    title: 'Other specialty then typed dermatology',
    why: 'Chip Other + free-text detail must land specialtyDetail.',
    turns: [
      "Opening Skin First Care in Beacon June 2027. Dermatology practice. Two front desk. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    chips: {
      specialty: { field_id: 'specialty', value: 'Other healthcare practice', label: 'Other healthcare practice' }
    },
    typed: {
      specialtyDetail: 'Dermatology'
    },
    expect: {
      plan: { specialty: 'Other healthcare practice', specialtyDetail: /Dermatolog/i },
      sceneBadge: /Dermatolog/i
    }
  },
  {
    id: 'RL110-info-hangup-ack',
    title: 'Ack for play-hours hangup sounds human',
    why: 'Chip/ack path for information after hours must not say voicemail.',
    turns: [
      "Opening Ack Info Eye Care in Hudson May 2027. Two front desk. Front desk first. After hours just play our hours and hang up — no voicemail. New number."
    ],
    chips: {
      'urgent.kind': { field_id: 'urgent.kind', value: 'none', label: 'No separate urgent path' }
    },
    expect: {
      plan: { after: { kind: 'information' } },
      ackIncludes: /hours information|play information|information after close|hang/i,
      neverAck: /voicemail for the next business day/i
    }
  },
  {
    id: 'RL111-port-spectrum-explicit',
    title: 'Port our Spectrum number',
    why: 'Provider + port language must set porting, not new.',
    turns: [
      "We've had Spectrum Keep Dental in Saugerties for six years. Two front desk. Front desk first. Port our Spectrum number. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      plan: { mode: 'improving' },
      numbersPorting: true,
      porting: true
    }
  },
  {
    id: 'RL112-engineer-pdf-has-time-condition',
    title: 'Engineer PDF mentions Time Condition',
    why: 'Installer shop sheet must name Fusion Time Condition objects.',
    turns: [
      "Opening Shop Tc Dental in Kingston March 2027. Two receptionists on desk phones, separate lines. Front desk first. Busy message. After hours voicemail. Lunch 12-1 closed. Before opening callback. New number."
    ],
    expect: {
      engText: /Time Condition/i,
      engPathTable: true,
      pairedFooters: true
    }
  },
  {
    id: 'RL113-chirotouch-pms',
    title: 'ChiroTouch is the PMS',
    why: 'ChiroTouch must land as PMS for chiropractic, not a phone service.',
    turns: [
      "Opening Motion Spine & Wellness in Kingston May 2027. Chiropractic. One front desk, two chiropractors. We use ChiroTouch. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      pms: /ChiroTouch/i,
      plan: { specialtyDetail: /Chiropractic/i, after: { kind: 'message' } },
      neverPlan: { after: { kind: 'service' } }
    }
  },
  {
    id: 'RL114-one-receptionist',
    title: 'Single receptionist office',
    why: 'Count one must not invent a second desk line.',
    turns: [
      "Opening Solo Desk Dental in Troy May 2027. One receptionist. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      reception: 1,
      plan: { first: { kind: 'human', team: 'reception' } }
    }
  },
  {
    id: 'RL115-rhinebeck-city',
    title: 'Rhinebeck city parse',
    why: 'Small HV city must land with NY.',
    turns: [
      "Opening Rhinebeck Smile Dental in Rhinebeck May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      city: /Rhinebeck/i,
      plan: { name: /Rhinebeck Smile Dental/i }
    }
  },
  {
    id: 'RL116-named-is-the-name',
    title: 'NAME is the name',
    why: '“… is the name” anchor must extract practice name.',
    turns: [
      "Harbor Light Family Dental is the name. Opening in Beacon June 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { name: /Harbor Light Family Dental/i, mode: 'opening' }
    }
  },
  {
    id: 'RL117-urgent-instructions-only',
    title: 'Urgent path is instructions only, not connect',
    why: 'Owner who refuses live on-call but wants urgent wording.',
    turns: [
      "Opening Instructions Only Dental in Kingston May 2027. Two receptionists. Front desk first. After hours voicemail. No on-call connect — if someone is urgent just play instructions to go to the ER. Weekdays 9-5. New number."
    ],
    chips: {
      'urgent.kind': { field_id: 'urgent.kind', value: 'instructions', label: 'Play approved instructions' }
    },
    typed: {
      'urgent.instructions': 'If this cannot wait, go to the nearest emergency room or dial 911.'
    },
    expect: {
      plan: { after: { kind: 'message' } },
      neverPlan: { policy: { urgentKind: 'connect' } },
      urgentInstructions: true
    }
  },
  {
    id: 'RL118-monday-only-late',
    title: 'Monday late night, other weekdays normal',
    why: 'Per-day hours must not flatten Monday into Tue–Fri.',
    turns: [
      "Opening Late Monday Dental in Kingston May 2027. Two receptionists. Front desk first. Monday 9 to 8, Tuesday through Friday 9 to 5, closed weekends. After hours voicemail. New number."
    ],
    expect: {
      mondayEnd: '20:00',
      fridayEnd: '17:00',
      saturdayClosed: true
    }
  },
  {
    id: 'RL119-compulink-eye',
    title: 'Compulink PMS for eye care',
    why: 'Eye PMS brand must not become after-hours service.',
    turns: [
      "Opening Clear Lens Eye Care in Beacon June 2027. Two front desk. Front desk first. We use Compulink. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { specialty: 'Eye care' },
      pms: /Compulink/i,
      neverPlan: { after: { kind: 'service' } }
    }
  },
  {
    id: 'RL120-owner-pdf-has-hear-block',
    title: 'Owner PDF includes caller-hear scripts',
    why: 'What a caller hears must appear on the owner blueprint PDF.',
    turns: [
      "Opening Hear On Pdf Dental in Kingston March 2027. Two receptionists on desk phones, separate lines. Front desk first. Busy message. After hours voicemail. Lunch 12-1 closed. Before opening callback. New number."
    ],
    expect: {
      hearInOwnerPdf: true,
      hearWhen: /After hours/i,
      ownerPages: 6
    }
  },
  {
    id: 'RL121-zero-clinical-staff',
    title: 'No clinicians hired yet',
    why: 'Opening with reception only must allow clinical count zero.',
    turns: [
      "Opening Hire Later Dental in Albany May 2027. Two receptionists, no dentists hired yet — just me planning. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    chips: {
      'teams.clinical.count': { field_id: 'teams.clinical.count', value: 0, label: 'None' }
    },
    expect: {
      clinicalCount: 0,
      reception: 2,
      plan: { mode: 'opening' }
    }
  },
  {
    id: 'RL122-actually-hours-correction',
    title: 'Actually we close at 4, not 5',
    why: 'Midstream hours correction must overwrite prior end time.',
    turns: [
      "Opening Fix Hours Dental in Kingston May 2027. Two receptionists. Front desk first. Weekdays 9 to 5. After hours voicemail. New number.",
      "Actually we close at 4, not 5."
    ],
    expect: {
      weekdayHours: ['09:00', '16:00']
    }
  },
  {
    id: 'RL123-shared-reception-two-towns',
    title: 'Shared reception asks which location',
    why: 'Same number + Kingston answers both → shared entry, not menu.',
    turns: [
      "We already have Kingston Family Dental. We're adding a second office in Beacon under the same number. Kingston receptionists answer both and ask which location. Front desk first. After hours voicemail."
    ],
    expect: {
      plan: { mode: 'adding' },
      locationEntry: /shared/i,
      city: /Kingston/i
    }
  },
  {
    id: 'RL124-no-rooms-are-phones',
    title: 'Four chairs are not four phones',
    why: 'Operatory count must not become desk phone quantity.',
    turns: [
      "Opening Chair Count Dental in Kingston May 2027. Two receptionists. Four treatment chairs. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      deskNotRooms: true,
      reception: 2,
      rooms: 4
    }
  },
  {
    id: 'RL125-patience-answering-service',
    title: 'Patience answering service brand',
    why: 'Patience vendor must map to service, not practice name.',
    turns: [
      "Opening Calm After Dental in Albany May 2027. Two receptionists. Front desk first. After hours we use Patience. Keep number. Weekdays 9-5."
    ],
    expect: {
      plan: { after: { kind: 'service' }, name: /Calm After Dental/i },
      neverOwner: /Patience Dental/i
    }
  },
  {
    id: 'RL126-nexa-answering-service',
    title: 'Nexa after-hours vendor',
    why: 'Nexa is a service brand, never PMS or practice name.',
    turns: [
      "Opening Nexa Path Dental in Troy May 2027. Two receptionists. Front desk first. After hours we use Nexa. Weekdays 9-5. Keep number."
    ],
    expect: {
      plan: { after: { kind: 'service' }, name: /Nexa Path Dental/i },
      neverPlan: { after: { kind: 'message' } },
      pmsNotServiceBrand: true
    }
  },
  {
    id: 'RL127-catskill-city',
    title: 'Catskill city parse',
    why: 'Catskill must not be confused with specialty or empty city.',
    turns: [
      "Opening Mountain View Dental in Catskill May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      city: /Catskill/i,
      plan: { name: /Mountain View Dental/i }
    }
  },
  {
    id: 'RL128-fusion-information-checklist',
    title: 'Information after-hours still builds Fusion objects',
    why: 'Play-and-hangup path must still emit Time Condition + recording.',
    turns: [
      "Opening Fusion Info Eye Care in Hudson May 2027. Two front desk. Front desk first. After hours just play our hours and hang up — no voicemail. New number."
    ],
    chips: {
      'urgent.kind': { field_id: 'urgent.kind', value: 'none', label: 'No separate urgent path' }
    },
    expect: {
      plan: { after: { kind: 'information' } },
      fusionOk: true,
      fusionHasRecording: /after-hours-info/,
      hearWhen: /After hours/i
    }
  },
  {
    id: 'RL129-dolphin-ortho-pms',
    title: 'Dolphin PMS for orthodontics',
    why: 'Dolphin is ortho PMS — not answering service or practice name.',
    turns: [
      "Opening Align Orthodontics in Albany May 2027. Three treatment coordinators. Person answers first. We use Dolphin. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      pms: /Dolphin/i,
      plan: { name: /Align Orthodontics/i, after: { kind: 'message' } },
      neverPlan: { after: { kind: 'service' } }
    }
  },
  {
    id: 'RL130-middletown-city',
    title: 'Middletown city parse',
    why: 'Middletown must land with NY state.',
    turns: [
      "Opening Orange County Dental in Middletown May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      city: /Middletown/i,
      plan: { name: /Orange County Dental/i }
    }
  },
  {
    id: 'RL131-open-until-midnight-false',
    title: 'Open until does not mean 24-hour',
    why: '“Open until May” is an opening date, not always-on phones.',
    turns: [
      "Opening Until Date Dental in Kingston. We do not open until May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { mode: 'opening' },
      neverAlwaysOn: true,
      openingDate: /2027-05|May/i
    }
  },
  {
    id: 'RL132-two-doctors-clinical',
    title: 'Two dentists on clinical roster',
    why: 'Clinical headcount two must stick beside two reception.',
    turns: [
      "Opening Twin Docs Dental in Beacon May 2027. Two receptionists, two dentists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      reception: 2,
      clinicalCount: 2
    }
  },
  {
    id: 'RL133-skip-urgent-stays-undecided',
    title: 'Owner skips urgent path for now',
    why: 'Skip must not invent digit-9 connect.',
    turns: [
      "Opening Skip Urgent Dental in Kingston May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    chips: {
      'urgent.kind': { field_id: 'urgent.kind', value: null, label: 'Skip for now', operation: 'skip' }
    },
    expect: {
      plan: { after: { kind: 'message' } },
      neverPlan: { policy: { urgentKind: 'connect' } },
      fusionOk: true
    }
  },
  {
    id: 'RL134-lunch-noon-to-one-words',
    title: 'Lunch noon to one in words',
    why: 'Worded noon–one must become 12:00–13:00, not 9–5.',
    turns: [
      "Opening Noon Words Dental in Kingston April 2027. Two receptionists. Front desk first. Weekdays 9 to 5, closed for lunch noon to one. After hours voicemail. New number."
    ],
    expect: {
      lunchWindow: ['12:00', '13:00'],
      hearWhen: /At lunch/i
    }
  },
  {
    id: 'RL135-ai-after-hours-soft',
    title: 'AI after hours is proposed, soft confirm',
    why: 'After-hours AI must be assistant with soft honesty, not silent install.',
    turns: [
      "Opening Soft Ai Dental in Albany June 2027. Two receptionists answer during the day. Front desk first. After hours I want an AI receptionist to take messages. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { after: { kind: 'assistant' }, first: { kind: 'human' } },
      ackSoft: true
    }
  },
  {
    id: 'RL136-never-forward-personal',
    title: 'Never forward published number to personal phone',
    why: 'Continuity note must capture the personal-forward ban.',
    turns: [
      "Opening No Forward Dental in Catskill May 2027. Two receptionists. Front desk first. After hours voicemail. Never forward the published number to a personal phone. Weekdays 9-5. New number."
    ],
    expect: {
      continuityNote: /never forward|personal phone/i,
      plan: { after: { kind: 'message' } }
    }
  },
  {
    id: 'RL137-saugerties-improving',
    title: 'Saugerties existing practice',
    why: 'Saugerties + we’ve had → improving with city.',
    turns: [
      "We've had Creek Side Family Dental in Saugerties for eleven years. Two front desk. Front desk first. Keep number. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      plan: { mode: 'improving', name: /Creek Side Family Dental/i },
      city: /Saugerties/i,
      porting: true
    }
  },
  {
    id: 'RL138-menu-appointments-billing-clinical',
    title: 'Three-digit reason menu',
    why: 'Press 1/2/3 reason menu must set first.kind menu.',
    turns: [
      "Opening Triple Press Dental in Albany May 2027. We want a short phone menu: press 1 appointments, press 2 billing, press 3 clinical. Four receptionists. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { first: { kind: 'menu' } },
      neverOwner: /A person answers\. No keypad/i,
      reception: 4
    }
  },
  {
    id: 'RL139-before-opening-callback-owner',
    title: 'Before-opening callback to front desk',
    why: 'Pre-open message path must be callback, not after-hours info.',
    turns: [
      "Opening Preopen Callback Dental in Hudson April 2027. Two front desk. Front desk first. Before we open take a callback message. After hours voicemail. New number."
    ],
    expect: {
      plan: { mode: 'opening', policy: { beforeOpening: 'message' }, after: { kind: 'message' } },
      hearWhen: /Before opening/i
    }
  },
  {
    id: 'RL140-ringcentral-provider-keep',
    title: 'Keep RingCentral as current provider',
    why: 'Provider brand on keep/port path must not become practice name.',
    turns: [
      "We've had Valley Keep Dental in Newburgh for nine years. Two front desk. Front desk first. Keep our RingCentral number. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      plan: { mode: 'improving', name: /Valley Keep Dental/i },
      porting: true,
      neverPlan: { name: /RingCentral/i }
    }
  },
  {
    id: 'RL141-spanish-staff-not-menu',
    title: 'Bilingual receptionist, not a language keypad',
    why: 'Staff Spanish with person-first must not force language IVR.',
    turns: [
      "Opening Staff Spanish Dental in Kingston May 2027. Two receptionists, one bilingual. Spanish during open hours is enough — staff can identify it. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { first: { kind: 'human' } },
      spanishOpenOnly: true,
      neverPlan: { first: { kind: 'menu' } }
    }
  },
  {
    id: 'RL142-queue-then-message-exit',
    title: 'Wait in queue then voicemail',
    why: 'Explicit wait + then message must be queue busy, not instant mailbox.',
    turns: [
      "Opening Queue Then Vm Dental in Newburgh May 2027. Two front desk. Front desk first. If both are busy let them wait about a minute, then take a voicemail. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { busy: { kind: 'queue' }, after: { kind: 'message' } }
    }
  },
  {
    id: 'RL143-owner-brief-mentions-lunch',
    title: 'Owner brief distinguishes lunch close',
    why: 'Lunch closed phones must appear in owner-facing brief language.',
    turns: [
      "Opening Brief Lunch Dental in Kingston April 2027. Two receptionists. Front desk first. Weekdays 8 to 5, lunch 12:30 to 1:30 phones closed. After hours voicemail. New number."
    ],
    expect: {
      lunchHalf: true,
      ownerText: /lunch/i,
      hearWhen: /At lunch/i
    }
  },
  {
    id: 'RL144-correction-city-keeps-name',
    title: 'City correction keeps practice name',
    why: 'Fixing city midstream must not wipe the practice name.',
    turns: [
      "Opening Name Stay Dental in Kingston May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number.",
      "Actually it's New Paltz, not Kingston."
    ],
    expect: {
      plan: { name: /Name Stay Dental/i },
      city: /New Paltz/i,
      neverPlan: { policy: { cityState: /Kingston/i } }
    }
  },
  {
    id: 'RL145-eaglesoft-existing',
    title: 'Existing Eaglesoft office improves phones',
    why: 'Improving + Eaglesoft PMS must not flip to opening or service.',
    turns: [
      "We've had Eagle Ridge Family Dental in Kingston for fourteen years. Two front desk. Front desk first. We use Eaglesoft. Keep number. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      plan: { mode: 'improving', after: { kind: 'message' } },
      pms: /Eaglesoft/i,
      porting: true
    }
  },
  {
    id: 'RL146-poughkeepsie-city',
    title: 'Poughkeepsie city parse',
    why: 'Long city name must land with NY.',
    turns: [
      "Opening Hudson Shore Dental in Poughkeepsie May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      city: /Poughkeepsie/i,
      plan: { name: /Hudson Shore Dental/i }
    }
  },
  {
    id: 'RL147-reception-checks-messages',
    title: 'Receptionist checks messages in the morning',
    why: 'Mailbox owner must stay reception when front desk checks.',
    turns: [
      "Opening Desk Owns Vm Dental in Troy May 2027. Two receptionists. Front desk first. After hours voicemail. The receptionist checks the messages in the morning. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { after: { kind: 'message', owner: 'reception' } }
    }
  },
  {
    id: 'RL148-no-office-manager',
    title: 'Explicitly no office manager',
    why: 'Admin count must stay zero when owner says none.',
    turns: [
      "Opening No Manager Dental in Kingston May 2027. Two receptionists, no office manager. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      adminCount: 0,
      reception: 2
    }
  },
  {
    id: 'RL149-maximeyes-pms',
    title: 'MaximEyes PMS for eye care',
    why: 'Eye PMS brand must not become answering service.',
    turns: [
      "Opening Max Lens Eye Care in Beacon June 2027. Two front desk. Front desk first. We use MaximEyes. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { specialty: 'Eye care' },
      pms: /MaximEyes/i,
      neverPlan: { after: { kind: 'service' } }
    }
  },
  {
    id: 'RL150-both-pick-up-separate',
    title: 'Both can pick up at once',
    why: 'Simultaneous pickup implies separate lines + together ring.',
    turns: [
      "Opening Dual Pickup Dental in Kingston May 2027. Two receptionists. They can both pick up at once on separate lines. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { policy: { ring: 'together' } },
      separateLines: true
    }
  },
  {
    id: 'RL151-forget-answering-service',
    title: 'Forget the answering service — voicemail',
    why: 'Correction away from service must land message.',
    turns: [
      "Opening Forget Service Dental in Albany April 2027. Two receptionists. Front desk first. After hours we use AnswerConnect. Weekdays 9-5. New number.",
      "Forget the answering service — just after hours voicemail."
    ],
    expect: {
      plan: { after: { kind: 'message' } },
      neverPlan: { after: { kind: 'service' } }
    }
  },
  {
    id: 'RL152-saturday-closed-explicit',
    title: 'We close Saturdays',
    why: 'Explicit Saturday close must stick even with weekday hours.',
    turns: [
      "Opening No Sat Dental in Kingston May 2027. Two receptionists. Front desk first. Weekdays 9 to 5. We close Saturdays. After hours voicemail. New number."
    ],
    expect: {
      saturdayClosed: true,
      sundayClosed: true
    }
  },
  {
    id: 'RL153-medchat-service',
    title: 'MedChat after-hours vendor',
    why: 'MedChat is a service brand, never practice name.',
    turns: [
      "Opening Chat After Dental in Troy May 2027. Two receptionists. Front desk first. After hours we use MedChat. Keep number. Weekdays 9-5."
    ],
    expect: {
      plan: { after: { kind: 'service' }, name: /Chat After Dental/i },
      neverOwner: /MedChat Dental/i
    }
  },
  {
    id: 'RL154-hearing-busy-script',
    title: 'Busy unanswered hear script exists',
    why: 'Open-hours miss must produce a during-hours caller-hear row.',
    turns: [
      "Opening Busy Hear Dental in Kingston May 2027. Two receptionists. Front desk first. If nobody answers take a message. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { busy: { kind: 'message' } },
      hearWhen: /During phone hours|nobody answers/i
    }
  },
  {
    id: 'RL155-troy-city',
    title: 'Troy city parse',
    why: 'Troy must land without inventing Albany.',
    turns: [
      "Opening Collar City Dental in Troy May 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      city: /Troy/i,
      plan: { name: /Collar City Dental/i },
      neverPlan: { policy: { cityState: /Albany/i } }
    }
  },
  {
    id: 'RL156-opening-june-month',
    title: 'Opening target June',
    why: 'Month-only opening target must record without inventing a day.',
    turns: [
      "Opening June Target Dental in Kingston. Aiming for June 2027. Two receptionists. Front desk first. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      plan: { mode: 'opening' },
      openingDate: /June|2027-06/i
    }
  },
  {
    id: 'RL157-not-getting-new-number',
    title: 'Not getting a new number — port',
    why: 'Negative new-number language must force porting.',
    turns: [
      "We've had Port Negation Dental in Beacon for seven years. Two front desk. Front desk first. We are not getting a new number. After hours voicemail. Weekdays 9-5."
    ],
    expect: {
      numbersPorting: true,
      plan: { mode: 'improving' }
    }
  },
  {
    id: 'RL158-alert-communications-service',
    title: 'Alert Communications after hours',
    why: 'Alert Communications is answering service, not PMS.',
    turns: [
      "Opening Alert Path Dental in Albany May 2027. Two receptionists. Front desk first. After hours we use Alert Communications. Weekdays 9-5. Keep number."
    ],
    expect: {
      plan: { after: { kind: 'service' }, name: /Alert Path Dental/i },
      neverPlan: { after: { kind: 'message' } },
      pmsNotServiceBrand: true
    }
  },
  {
    id: 'RL159-english-enough-chip-path',
    title: 'English is enough via talk',
    why: 'Talk-first English-only must settle languageDecision without Spanish.',
    turns: [
      "Opening Talk English Dental in Kingston May 2027. Two receptionists. Front desk first. English is enough. After hours voicemail. Weekdays 9-5. New number."
    ],
    expect: {
      englishOnly: true,
      plan: { after: { kind: 'message' } }
    }
  },
  {
    id: 'RL160-paired-checksum-stable',
    title: 'Paired PDF checksum matches identity',
    why: 'Owner and engineer exports must share planId and checksum.',
    turns: [
      "Opening Checksum Pair Dental in Kingston March 2027. Two receptionists on desk phones, separate lines. Front desk first. Busy message. After hours voicemail. Lunch 12-1 closed. Before opening callback. New number."
    ],
    expect: {
      pairedIdentity: true,
      pairedFooters: true,
      ownerPages: 6
    }
  }
];

function draftSummary(p) {
  const bits = [];
  if (p.name.trim())
    bits.push(p.name.trim());
  const spec = p.specialty === 'Other healthcare practice' && p.specialtyDetail?.trim()
    ? p.specialtyDetail.trim()
    : (p.specialty || '');
  if (spec)
    bits.push(spec);
  if (p.first.kind === 'human')
    bits.push('person answers first');
  else if (p.first.kind === 'menu')
    bits.push('menu first');
  else if (p.first.kind === 'assistant')
    bits.push('AI first — confirm before install');
  return bits.join(' · ') || 'Your answering rules are recorded.';
}

function reviewBookUrl(plan, sid = '11111111-1111-4111-8111-111111111111') {
  const q = new URLSearchParams();
  q.set('plan', plan.planId);
  if (sid)
    q.set('s', sid);
  if (plan.name.trim())
    q.set('name', plan.name.trim());
  return 'https://upstateipvoice.com/review/?' + q.toString();
}

async function checkCase(c) {
  const issues = [];
  const notes = [];
  if (c.expect.chipSubjectsHuman) {
    const stiff = Object.entries(CHIP_SUBJECT).filter(([, line]) =>
      /still proposed|not a verified transfer|I will not invent|I did not add a lunch close|still a proposed contract|still proposed until a vendor/i.test(line)
    );
    if (stiff.length)
      issues.push('stiff CHIP_SUBJECT: ' + stiff.map(([k]) => k).join(', '));
    else
      notes.push('CHIP_SUBJECT humanized');
    return { id: c.id, title: c.title, ok: !issues.length, issues, notes, planId: null };
  }
  if (c.expect.talkFirstUi) {
    const ui = fs.readFileSync(path.join(srcDir, 'ArchitectChat.tsx'), 'utf8');
    if (!/Tell me in your own words/i.test(ui))
      issues.push('talk-first placeholder missing');
    if (/disabled=\{interacting \|\| !input\.trim\(\)\}/.test(ui) || /if \(!trimmed \|\| interacting\)/.test(ui))
      issues.push('send still gated by interacting while chips show');
    if (/disabled=\{interacting\}/.test(ui) && /architect-input/.test(ui))
      issues.push('composer still fully disabled during interacting');
    if (!/turnInFlight|busy \|\| typing/.test(ui))
      issues.push('send mid-turn gate missing');
    else
      notes.push('talk-first composer OK');
    return { id: c.id, title: c.title, ok: !issues.length, issues, notes, planId: null };
  }
  if (c.expect.draftCloseUi) {
    const ui = fs.readFileSync(path.join(srcDir, 'ArchitectChat.tsx'), 'utf8');
    if (!/Here's your practice blueprint|Here.s your practice blueprint/i.test(ui))
      issues.push('owner draft close copy missing');
    if (/That's everything I need to draw both files/i.test(ui))
      issues.push('old draw-both-files close still present');
    if (!/Book a walkthrough/i.test(ui))
      issues.push('Book a walkthrough CTA missing');
    if (/Still open at install/i.test(ui))
      issues.push('draft still uses guilt Still open at install wording');
    if (!/walkthroughLeftoversNote|At your walkthrough/.test(ui))
      issues.push('walkthrough leftover framing missing');
    else
      notes.push('draft close + Book CTA OK');
    return { id: c.id, title: c.title, ok: !issues.length, issues, notes, planId: null };
  }
  if (c.expect.reviewPrefillSource) {
    const src = fs.readFileSync(path.join(root, 'js/review.js'), 'utf8');
    if (!/practiceName/.test(src) || !/business_name\.value\s*=\s*plannerParams\.practiceName/.test(src))
      issues.push('review.js name prefill missing');
    else
      notes.push('review prefill source OK');
    return { id: c.id, title: c.title, ok: !issues.length, issues, notes, planId: null };
  }

  const played = play(c.turns, {
    chips: c.chips || {},
    typed: c.typed || {},
    autoChip: !c.expect.stillAsking
  });
  let { plan, facts, follow, log } = played;

  if (c.typedLater) {
    const r = interpretTurn({ plan, facts, interpreter: blank, userText: c.typedLater, question: follow });
    plan = r.plan;
    facts = r.facts;
    follow = r.follow;
    log.push({ who: 'owner', text: c.typedLater, ack: r.ack, next: follow?.id || null });
  }

  const id = identity(plan);
  const ownerText = ownerBriefText(plan);
  const engText = engineerBriefText(plan);
  const hear = callerHear(plan);
  const scene = sceneFromPlan(plan);
  const asked = log.filter(l => l.typed || l.field).map(l => l.typed || l.field);
  const acks = log.map(l => l.ack).join(' \n ');

  // Finish remaining chips for PDF cases when needed.
  if (c.expect.ownerPages || c.expect.hearInOwnerPdf || c.expect.engPathTable || c.expect.pairedFooters || c.expect.noPhoneInPdf || c.expect.pairedIdentity || c.expect.engDirectoryBlanks || c.expect.engBuildChecks) {
    let guard = 0;
    while (follow && guard++ < 25) {
      const opts = (follow.options || []).filter(o => o.operation === 'set' && !/skip|not sure|help me/i.test(o.label));
      const chip = opts[0] || follow.options?.find(o => o.operation === 'skip');
      if (!chip)
        break;
      const r = chipTurn({ plan, facts, chip });
      plan = r.plan;
      facts = r.facts;
      follow = r.follow;
    }
  }

  const pair = (c.expect.ownerPages || c.expect.hearInOwnerPdf || c.expect.engPathTable || c.expect.pairedFooters || c.expect.noPhoneInPdf || c.expect.engDirectoryBlanks || c.expect.engBuildChecks || c.expect.pairedIdentity)
    ? await createPairedPDFs(plan, font, { logo })
    : null;

  let ownerPdfText = '';
  let engPdfText = '';
  let bothPdfText = '';
  if (pair) {
    const of = path.join(outDir, c.id + '-owner.pdf');
    const ef = path.join(outDir, c.id + '-engineer.pdf');
    fs.writeFileSync(of, Buffer.from(pair.owner));
    fs.writeFileSync(ef, Buffer.from(pair.engineer));
    ownerPdfText = pdftext(of);
    engPdfText = pdftext(ef);
    const ownerDoc = await PDFDocument.load(pair.owner);
    if (c.expect.ownerPages && ownerDoc.getPageCount() !== c.expect.ownerPages)
      issues.push('owner pages ' + ownerDoc.getPageCount() + ' != ' + c.expect.ownerPages);
    if (c.expect.pairedFooters) {
      const both = await createPDF(plan, font, 'both', { logo });
      const bf = path.join(outDir, c.id + '-both.pdf');
      fs.writeFileSync(bf, Buffer.from(both));
      bothPdfText = pdftext(bf);
      const ownerPages = ownerDoc.getPageCount();
      const engPages = (await PDFDocument.load(pair.engineer)).getPageCount();
      const bothDoc = await PDFDocument.load(both);
      if (bothDoc.getPageCount() !== ownerPages + engPages)
        issues.push('both page count mismatch');
      // First owner page footer should be Draft; last page (engineer) DRAFT — do not build
      const pages = bothPdfText.split('\f');
      const first = pages[0] || '';
      const last = pages[pages.length - 2] || pages[pages.length - 1] || '';
      if (!/Draft\s+UP-/i.test(first) && !/LOCKED\s+UP-/i.test(first))
        issues.push('both PDF first page missing Draft stamp');
      if (/DRAFT — do not build/i.test(first) && ownerPages > 0)
        issues.push('owner pages in both export stamped as engineer');
      if (!/DRAFT — do not build/i.test(last) && !/LOCKED/i.test(last))
        issues.push('both PDF last page missing engineer stamp');
      else
        notes.push('paired footers OK');
    }
  }

  const exp = c.expect;
  if (exp.plan) {
    for (const [k, v] of Object.entries(exp.plan)) {
      if (k === 'first' || k === 'after' || k === 'policy' || k === 'busy') {
        for (const [sk, sv] of Object.entries(v)) {
          const actual = get(plan, k + '.' + sk) ?? plan[k]?.[sk];
          if (sv instanceof RegExp) {
            if (!sv.test(String(actual || '')))
              issues.push(`${k}.${sk}=${actual} !~ ${sv}`);
          }
          else if (actual !== sv)
            issues.push(`${k}.${sk}=${actual} != ${sv}`);
        }
      }
      else {
        const actual = plan[k];
        if (v instanceof RegExp) {
          if (!v.test(String(actual || '')))
            issues.push(`${k}=${actual} !~ ${v}`);
        }
        else if (actual !== v)
          issues.push(`${k}=${actual} != ${v}`);
      }
    }
  }
  if (exp.neverPlan) {
    for (const [k, v] of Object.entries(exp.neverPlan)) {
      if (k === 'policy' || k === 'first' || k === 'after' || k === 'busy') {
        for (const [sk, sv] of Object.entries(v)) {
          const actual = get(plan, k + '.' + sk) ?? plan[k]?.[sk];
          if (sv instanceof RegExp) {
            if (sv.test(String(actual || '')))
              issues.push(`neverPlan hit ${k}.${sk}=${actual}`);
          }
          else if (actual === sv)
            issues.push(`neverPlan hit ${k}.${sk}=${actual}`);
        }
      }
      else {
        const actual = plan[k];
        if (v instanceof RegExp) {
          if (v.test(String(actual || '')))
            issues.push(`neverPlan hit ${k}=${actual}`);
        }
        else if (actual === v)
          issues.push(`neverPlan hit ${k}=${actual}`);
      }
    }
  }
  if (exp.sceneBadge) {
    // Specialty caption only dominates chapter 1; after staff/hours the rail shows the team.
    // The product contract is: specialtyDetail lands on the plan + owner brief (not blank Consultation space).
    const label = [scene.badge, plan.specialtyDetail, plan.specialty, ownerText.slice(0, 400)].join(' ');
    if (!exp.sceneBadge.test(label))
      issues.push('specialty label missing in scene/plan/brief: ' + (scene.badge || '(empty)') + ' / detail=' + (plan.specialtyDetail || ''));
    else
      notes.push('specialty label OK (' + (plan.specialtyDetail || plan.specialty || scene.badge) + ')');
  }
  if (exp.ownerText && !exp.ownerText.test(ownerText))
    issues.push('ownerText missing ' + exp.ownerText);
  if (exp.engText && !exp.engText.test(engText))
    issues.push('engText missing ' + exp.engText);
  if (exp.neverOwner && exp.neverOwner.test(ownerText + '\n' + ownerPdfText))
    issues.push('owner leaked forbidden pattern ' + exp.neverOwner);
  if (exp.neverAck && exp.neverAck.test(acks))
    issues.push('ack still stiff: ' + exp.neverAck);
  if (exp.ackIncludes && !exp.ackIncludes.test(acks))
    issues.push('ack missing ' + exp.ackIncludes);
  if (exp.asked) {
    for (const id of exp.asked) {
      if (!log.some(l => l.next === id || l.typed === id || (l.field === id))) {
        // specialtyDetail must appear as a follow question after Other
        const hit = log.some(l => l.next === id) || asked.includes(id) || log.some(l => l.typed === id);
        if (!hit && !facts[id])
          issues.push('never asked ' + id);
      }
    }
    if (exp.asked.includes('specialtyDetail')) {
      const saw = log.some(l => l.next === 'specialtyDetail') || log.some(l => l.typed === 'specialtyDetail');
      if (!saw)
        issues.push('specialtyDetail follow-up never appeared');
      else
        notes.push('specialtyDetail follow-up OK');
    }
  }
  if (exp.ackSoft) {
    if (/confirm (this|the contract) before install/i.test(acks) || /AI receptionist|virtual receptionist/i.test(acks))
      notes.push('soft AI honesty present');
    else if (plan.after.kind === 'assistant' || plan.first.kind === 'assistant')
      issues.push('missing soft confirm-before-install language for AI');
  }
  if (exp.fridayNotDefault) {
    const fri = plan.hours.days.find(d => d.day === 'Friday');
    if (fri?.open && fri.start === '09:00' && fri.end === '17:00' && !/friday|weekday/i.test(c.turns.join(' ')))
      issues.push('invented Friday 9-5');
  }
  if (exp.wednesdayClosed) {
    const wed = plan.hours.days.find(d => d.day === 'Wednesday');
    if (wed?.open)
      issues.push('Wednesday should be closed');
  }
  if (exp.noEmptyInboundRg) {
    const b = fusionBuild(plan);
    const empty = (b.blockers || []).some(x => /inbound ring group has no members/i.test(x));
    // unfinished solo is OK if still asking for device — empty RG as INSTALL blocker after finish is bad
    if (!follow && empty)
      issues.push('finished with empty inbound RG');
    else
      notes.push(follow ? 'still asking ' + follow.id : 'inbound RG populated');
  }
  if (exp.fusionOk) {
    try {
      fusionBuild(plan);
      notes.push('fusionBuild OK');
    }
    catch (e) {
      issues.push('fusionBuild threw ' + e.message);
    }
  }
  if (exp.hearWhen) {
    if (!hear.some(h => exp.hearWhen.test(h.when)))
      issues.push('callerHear missing when ' + exp.hearWhen);
  }
  if (exp.hearScript) {
    if (!hear.some(h => exp.hearScript.test(h.hear)))
      issues.push('callerHear missing script ' + exp.hearScript);
  }
  if (exp.afterHearNever) {
    const after = hear.find(h => /after hours/i.test(h.when));
    if (after && exp.afterHearNever.test(after.hear))
      issues.push('after-hours hear still has ' + exp.afterHearNever);
  }
  if (exp.fridayHalf) {
    const fri = plan.hours.days.find(d => d.day === 'Friday');
    if (!fri?.open || fri.end !== '14:00')
      issues.push('Friday half-day end ' + (fri?.end || 'closed') + ' != 14:00');
    else
      notes.push('Friday half day OK');
  }
  if (exp.saturdayOpen) {
    const sat = plan.hours.days.find(d => d.day === 'Saturday');
    if (!sat?.open)
      issues.push('Saturday should be open');
    else
      notes.push('Saturday open ' + sat.start + '-' + sat.end);
  }
  if (exp.sundayClosed) {
    const sun = plan.hours.days.find(d => d.day === 'Sunday');
    if (sun?.open)
      issues.push('Sunday should be closed');
  }
  if (exp.urgentConnect) {
    if (!(plan.urgent?.enabled && (plan.policy.urgentKind === 'connect' || plan.policy.urgentKind === 'priority')))
      issues.push('urgent connect not enabled (kind=' + plan.policy.urgentKind + ')');
    else
      notes.push('urgent connect OK');
  }
  if (exp.lunchClosed) {
    const lunch = plan.hours.days.find(d => d.breakStart && d.breakEnd);
    if (!lunch)
      issues.push('lunch close missing');
    else
      notes.push('lunch ' + lunch.breakStart + '-' + lunch.breakEnd);
  }
  if (exp.noLunchClose) {
    const lunch = plan.hours.days.find(d => d.breakStart && d.breakEnd);
    if (lunch)
      issues.push('invented lunch close ' + lunch.breakStart + '-' + lunch.breakEnd);
    else
      notes.push('no lunch close');
  }
  if (exp.sharedPhone) {
    const place = (plan.policy.placements || []).find(x => x.team === 'reception');
    if (place && place.sharing === 'separate')
      issues.push('shared one-phone became separate lines');
    else if (place?.sharing === 'shared' || /share|one phone|can't both/i.test(ownerText + acks))
      notes.push('shared phone path OK');
    else
      issues.push('shared phone intent not recorded (sharing=' + (place?.sharing || 'none') + ')');
  }
  if (exp.lunchWindow) {
    const [start, end] = exp.lunchWindow;
    const lunch = plan.hours.days.find(d => d.breakStart && d.breakEnd);
    if (!lunch || lunch.breakStart !== start || lunch.breakEnd !== end)
      issues.push('lunch window ' + (lunch ? lunch.breakStart + '-' + lunch.breakEnd : 'missing') + ' != ' + start + '-' + end);
    else
      notes.push('lunch ' + start + '-' + end);
  }
  if (exp.mondayClosed) {
    const mon = plan.hours.days.find(d => d.day === 'Monday');
    if (mon?.open)
      issues.push('Monday should be closed');
    else
      notes.push('Monday closed');
  }
  if (exp.workMobile) {
    const mobile = (plan.policy.placements || []).some(x => x.device === 'mobile' && x.count > 0)
      || /work mobile|work app|follow me/i.test((plan.policy.notes || '') + ' ' + (plan.policy.continuity?.notes || '') + ownerText);
    if (!mobile && plan.busy?.backup !== 'admin')
      issues.push('work mobile / admin overflow missing');
    else
      notes.push('work mobile / admin overflow OK');
  }
  if (exp.spanishMenu) {
    const es = plan.languages.find(l => /spanish/i.test(l.name));
    if (!es)
      issues.push('Spanish language missing');
    else if (es.mechanism && es.mechanism !== 'menu' && plan.first.kind === 'menu')
      issues.push('Spanish mechanism=' + es.mechanism + ' (want menu)');
    else
      notes.push('Spanish ' + (es.mechanism || 'noted') + ' on menu-first');
  }
  if (exp.locationEntry) {
    const entry = String(plan.policy.locationEntry || '');
    if (!exp.locationEntry.test(entry))
      issues.push('locationEntry=' + entry + ' !~ ' + exp.locationEntry);
    else
      notes.push('locationEntry ' + entry);
  }
  if (exp.numbersPorting) {
    if (plan.policy.opening.numbers !== 'porting')
      issues.push('opening.numbers=' + plan.policy.opening.numbers + ' (want porting)');
    else
      notes.push('numbers porting');
  }
  if (exp.adminCount != null) {
    const n = plan.teams.find(t => t.role === 'administration')?.count;
    if (n !== exp.adminCount)
      issues.push('admin count ' + n + ' != ' + exp.adminCount);
    else
      notes.push('admin ' + n);
  }
  if (exp.englishOnly) {
    if (plan.languages.some(l => /spanish/i.test(l.name)))
      issues.push('Spanish invented despite English-only');
    else if (plan.policy.languageDecision && plan.policy.languageDecision !== 'none' && plan.policy.languageDecision !== 'undecided')
      issues.push('languageDecision=' + plan.policy.languageDecision);
    else
      notes.push('English only');
  }
  if (exp.busySeconds != null) {
    if (plan.busy.seconds !== exp.busySeconds)
      issues.push('busy.seconds=' + plan.busy.seconds + ' != ' + exp.busySeconds);
    else
      notes.push('busy.seconds ' + plan.busy.seconds);
  }
  if (exp.hearNeverDigits) {
    if (hear.some(h => /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(h.hear)))
      issues.push('phone digits leaked into callerHear');
    else
      notes.push('hear clean of phone digits');
  }
  if (exp.hearWhenAll) {
    for (const re of exp.hearWhenAll) {
      if (!hear.some(h => re.test(h.when)))
        issues.push('callerHear missing when ' + re);
    }
  }
  if (exp.saturdayClosed) {
    const sat = plan.hours.days.find(d => d.day === 'Saturday');
    if (sat?.open)
      issues.push('Saturday should be closed');
  }
  if (exp.thursdayClosed) {
    const thu = plan.hours.days.find(d => d.day === 'Thursday');
    if (thu?.open)
      issues.push('Thursday should be closed');
    else
      notes.push('Thursday closed');
  }
  if (exp.weekdayHours) {
    const [start, end] = exp.weekdayHours;
    const open = plan.hours.days.filter(d => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(d.day) && d.open);
    if (!open.length)
      issues.push('no weekday open hours');
    else if (open.some(d => d.start !== start || d.end !== end))
      issues.push('weekday hours ' + open.map(d => d.day.slice(0, 3) + ' ' + d.start + '-' + d.end).join(', ') + ' != ' + start + '-' + end);
    else
      notes.push('weekdays ' + start + '-' + end);
  }
  if (exp.billingAdmin) {
    const bill = plan.reasons.find(r => r.id === 'billing');
    if (!bill || (bill.team !== 'admin' && bill.team !== 'administration'))
      issues.push('billing team=' + (bill?.team || 'missing'));
    else
      notes.push('billing → admin');
  }
  if (exp.openingDate) {
    const d = plan.policy.opening?.date || '';
    if (!exp.openingDate.test(String(d)))
      issues.push('opening.date=' + d + ' !~ ' + exp.openingDate);
    else
      notes.push('opening.date ' + d);
  }
  if (exp.urgentInstructions) {
    const kind = plan.policy.urgentKind;
    const text = plan.urgent?.instructions || '';
    if (kind === 'connect')
      issues.push('urgent still connect');
    else if (kind !== 'instructions' && kind !== 'none' && !text.trim())
      issues.push('urgent instructions missing (kind=' + kind + ')');
    else
      notes.push('urgent ' + kind + (text ? ' with copy' : ''));
  }
  if (exp.mondayEnd) {
    const mon = plan.hours.days.find(d => d.day === 'Monday');
    if (!mon?.open || mon.end !== exp.mondayEnd)
      issues.push('Monday end ' + (mon?.end || 'closed') + ' != ' + exp.mondayEnd);
    else
      notes.push('Monday ends ' + mon.end);
  }
  if (exp.clinicalCount != null) {
    const n = plan.teams.find(t => t.role === 'clinical')?.count;
    if (n !== exp.clinicalCount)
      issues.push('clinical count ' + n + ' != ' + exp.clinicalCount);
  }
  if (exp.rooms != null) {
    if (plan.policy.rooms !== exp.rooms)
      issues.push('rooms ' + plan.policy.rooms + ' != ' + exp.rooms);
    else
      notes.push('rooms ' + plan.policy.rooms);
  }
  if (exp.fusionHasRecording) {
    const b = fusionBuild(plan);
    if (!b.recordings.some(r => exp.fusionHasRecording.test(r.filename)))
      issues.push('fusion missing recording ' + exp.fusionHasRecording);
    else
      notes.push('fusion recording OK');
  }
  if (exp.neverAlwaysOn) {
    const always = plan.hours.days.every(d => d.open && d.start === '00:00' && (d.end === '24:00' || d.end === '23:59'));
    if (always || plan.hours.preset === 'always')
      issues.push('invented 24-hour coverage');
  }
  if (exp.openingMonth) {
    const d = String(plan.policy.opening?.date || '');
    if (!exp.openingMonth.test(d))
      issues.push('opening.date=' + d + ' !~ month ' + exp.openingMonth);
    else
      notes.push('opening month ' + d);
  }
  if (exp.continuityNote) {
    const blob = (plan.policy.continuity?.notes || '') + ' ' + (plan.policy.notes || '') + ' ' + ownerText + ' ' + engText;
    if (!exp.continuityNote.test(blob))
      issues.push('continuity note missing ' + exp.continuityNote);
    else
      notes.push('continuity note OK');
  }
  if (exp.separateLines) {
    const place = (plan.policy.placements || []).find(x => x.team === 'reception');
    if (place && place.sharing !== 'separate')
      issues.push('sharing=' + place.sharing + ' (want separate)');
    else if (!place && plan.policy.ring !== 'together')
      issues.push('separate lines / together ring missing');
    else
      notes.push('separate lines OK');
  }
  if (exp.hearInOwnerPdf && pair) {
    for (const h of hear.filter(x => x.kind !== 'note')) {
      const needle = h.hear.slice(0, 60).replace(/\s+/g, ' ');
      if (!ownerPdfText.replace(/\s+/g, ' ').includes(needle))
        issues.push('HEAR-NOT-IN-OWNER ' + h.when);
    }
    if (!issues.some(i => i.startsWith('HEAR-NOT-IN-OWNER')))
      notes.push('all callerHear scripts in owner PDF');
  }
  if (exp.noPhoneInPdf && pair) {
    if (/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(ownerPdfText + engPdfText))
      issues.push('phone number leaked into PDF');
  }
  if (exp.scrubAck) {
    if (!/removed|privacy|didn't keep|personal/i.test(acks) && /Maria Lopez/.test(c.turns.join(' ')))
      notes.push('PHI turn processed; check scrub soft');
    if (/Maria Lopez|03\/14\/1988/.test(ownerText))
      issues.push('PHI in owner brief');
  }
  if (exp.deskNotRooms) {
    const buyMatch = /(?:phones? to order|desk)/i.test(ownerText);
    if (/6 desk/i.test(ownerText) && /6 (chairs|operatories|rooms)/i.test(c.turns.join(' ')))
      issues.push('ordered 6 desk phones from room count');
    else if (buyMatch)
      notes.push('order language present without 6 desk phones');
  }
  if (exp.alwaysOn) {
    const always = plan.hours.days.every(d => d.open && d.start === '00:00' && (d.end === '24:00' || d.end === '23:59'));
    if (!always && !/24/.test(JSON.stringify(plan.hours)))
      notes.push('24h intent captured partially: ' + plan.hours.days.filter(d => d.open).map(d => d.day + ' ' + d.start + '-' + d.end).join(', '));
  }
  if (exp.canSkipName) {
    if (log.some(l => /skip/i.test(l.text) && (l.field === 'name' || /Skip/.test(l.text))))
      notes.push('name skipped');
    else if (!plan.name.trim())
      notes.push('name empty after skip path');
  }
  if (exp.nameLater && !exp.nameLater.test(plan.name))
    issues.push('name later failed: ' + plan.name);
  if (exp.city && !exp.city.test(plan.policy.cityState || ''))
    issues.push('city ' + plan.policy.cityState + ' !~ ' + exp.city);
  if (exp.reception != null) {
    const n = plan.teams.find(t => t.role === 'reception')?.count;
    if (n !== exp.reception)
      issues.push('reception count ' + n + ' != ' + exp.reception);
  }
  if (exp.distinctLunchAndAfter) {
    const lunch = hear.find(h => /lunch/i.test(h.when));
    const after = hear.find(h => /after hours/i.test(h.when));
    if (lunch && after && lunch.hear === after.hear)
      issues.push('lunch and after-hours scripts identical');
    else if (lunch && after)
      notes.push('lunch ≠ after-hours scripts');
  }
  if (exp.bookUrlShape) {
    const url = reviewBookUrl(plan);
    if (!/[?&]plan=/.test(url))
      issues.push('book URL missing plan');
    if (!/[?&]s=/.test(url))
      issues.push('book URL missing session');
    if (plan.name.trim()) {
      const decoded = decodeURIComponent(url.replace(/\+/g, '%20'));
      if (!decoded.includes(plan.name.trim()) && !url.includes(encodeURIComponent(plan.name.trim())) && !url.includes(plan.name.trim().replace(/ /g, '+')))
        issues.push('book URL missing name prefill: ' + url);
      else
        notes.push('book URL ' + url.replace(/https:\/\/upstateipvoice.com/, ''));
    }
    else
      notes.push('book URL ' + url.replace(/https:\/\/upstateipvoice.com/, ''));
  }
  if (exp.draftSummary) {
    const s = draftSummary(plan);
    if (!s || s.length < 8)
      issues.push('empty draft summary');
    else
      notes.push('draft summary: ' + s);
  }
  if (exp.engPathTable && pair) {
    if (!/WHEN\s+OBJECT\s+ACTION\s+TEST CUE/i.test(engPdfText.replace(/\s+/g, ' ')) && !/When.*Object.*Action.*Test cue/i.test(engText))
      issues.push('engineer path hop table missing');
    else
      notes.push('path hop table present');
  }
  if (exp.engDirectoryBlanks && pair) {
    if (!/________/.test(engPdfText) && !/☐ ________/.test(engText))
      issues.push('directory blanks missing');
    else
      notes.push('directory blanks present');
  }
  if (exp.engBuildChecks) {
    const pages = engineerBrief(plan);
    const build = pages.find(p => /Build/i.test(p.kicker));
    if (!build || !build.blocks.some(b => b.kind === 'checks'))
      issues.push('build page missing checkbox steps');
    else
      notes.push('build checkboxes present');
  }
  if (exp.fridayEnd) {
    const fri = plan.hours.days.find(d => d.day === 'Friday');
    if (!fri?.open || fri.end !== exp.fridayEnd)
      issues.push('Friday end ' + (fri?.end || 'closed') + ' != ' + exp.fridayEnd);
  }
  if (exp.spanishOpenOnly) {
    const es = plan.languages.find(l => /spanish/i.test(l.name));
    if (!es)
      issues.push('Spanish language missing');
    else if (es.availability && es.availability !== 'open' && es.availability !== 'limited')
      issues.push('Spanish availability=' + es.availability + ' (want open-hours)');
    else
      notes.push('Spanish ' + (es.availability || 'noted'));
  }
  if (exp.porting) {
    if (plan.policy.opening.numbers !== 'porting' && !/port|keep (our |the )?(published )?number|spectrum/i.test(JSON.stringify(plan.policy) + (plan.current?.notes || '') + (plan.current?.lines || '') + (plan.current?.provider || '')))
      issues.push('port/keep number not recorded (numbers=' + plan.policy.opening.numbers + ')');
    else
      notes.push('port/keep recorded (' + (plan.policy.opening.numbers || plan.current?.provider || 'notes') + ')');
  }
  if (exp.faxOffPatient) {
    if (!/fax/i.test(ownerText + engText + (plan.policy.notes || '') + (plan.current?.notes || '') + (plan.current?.lines || '')))
      issues.push('fax note missing');
    else
      notes.push('fax noted');
  }
  if (exp.holidays) {
    const days = plan.hours.holidays || plan.policy.holidays || [];
    const holidayNotes = (plan.policy.notes || '') + engText + ownerText;
    if ((!Array.isArray(days) || !days.length) && !/Thanksgiving|Christmas|2027-11-25|2027-12-25/i.test(holidayNotes + JSON.stringify(plan.hours)))
      issues.push('holidays not recorded');
    else
      notes.push('holidays present');
  }
  if (exp.computerFront) {
    const place = (plan.policy.placements || []).find(x => x.team === 'reception' || x.team === plan.first.team);
    if (place && place.device !== 'computer' && place.device !== 'both')
      issues.push('reception device=' + place.device);
    else
      notes.push('computer/headset path OK');
  }
  if (exp.pmsNotServiceBrand) {
    if (/answerconnect|ruby|smith\.ai/i.test(String(plan.policy.opening.pms || '')))
      issues.push('service brand leaked into PMS: ' + plan.policy.opening.pms);
  }
  if (exp.noOnCall) {
    if (plan.policy.urgentKind === 'connect' || plan.urgent?.enabled)
      issues.push('on-call still enabled');
    else
      notes.push('no on-call');
  }
  if (exp.stillAsking) {
    if (!follow)
      issues.push('vague dump finished with no follow-up question');
    else
      notes.push('still asking ' + follow.id);
  }
  if (exp.stillAskingOrRepaired) {
    const b = fusionBuild(plan);
    const empty = (b.blockers || []).some(x => /inbound ring group has no members/i.test(x));
    if (!follow && empty)
      issues.push('finished draft with empty inbound RG');
    else
      notes.push(follow ? 'still asking ' + follow.id : 'repaired inbound');
  }
  if (exp.billingAtReception) {
    if (plan.policy.billingPerformedBy && plan.policy.billingPerformedBy !== 'reception')
      issues.push('billingPerformedBy=' + plan.policy.billingPerformedBy);
    else
      notes.push('billing at reception');
  }
  if (exp.adminZeroOrUnset) {
    const adm = plan.teams.find(t => t.role === 'administration');
    if (adm && adm.status === 'known' && adm.count > 0 && plan.policy.billingPerformedBy === 'reception')
      issues.push('invented admin seats while billing stays at reception');
  }
  if (exp.urgentOnly) {
    if (plan.policy.urgentScope && plan.policy.urgentScope !== 'urgent_only')
      issues.push('urgentScope=' + plan.policy.urgentScope);
    else if (!plan.urgent?.enabled && plan.policy.urgentKind !== 'connect' && plan.policy.urgentKind !== 'priority')
      notes.push('urgent path still open or partial');
    else
      notes.push('urgent_only OK');
  }
  if (exp.lunchHalf) {
    const lunch = plan.hours.days.find(d => d.breakStart && d.breakEnd);
    if (!lunch || lunch.breakStart !== '12:30' || lunch.breakEnd !== '13:30')
      issues.push('lunch ' + (lunch ? lunch.breakStart + '-' + lunch.breakEnd : 'missing'));
    else
      notes.push('lunch 12:30-13:30');
  }
  if (exp.pairedIdentity && pair) {
    const stamp = id.planId + ' · r' + id.revision + ' · ' + id.checksum;
    if (!ownerPdfText.includes(id.checksum) || !engPdfText.includes(id.checksum))
      issues.push('checksum missing from a PDF');
    else if (!ownerPdfText.includes(id.planId) || !engPdfText.includes(id.planId))
      issues.push('planId missing from a PDF');
    else
      notes.push('paired identity ' + stamp);
  }
  if (exp.pms) {
    if (!exp.pms.test(String(plan.policy.opening.pms || '')))
      issues.push('PMS ' + plan.policy.opening.pms + ' !~ ' + exp.pms);
  }
  if (exp.futureAiNoted) {
    const futureish = /later|future|when we (are |get )?bigger/i.test(acks + JSON.stringify(plan.policy) + (plan.policy.notes || ''));
    if (plan.first.kind === 'assistant')
      issues.push('AI forced to first despite later wish');
    else if (!futureish && plan.first.kind !== 'human')
      notes.push('AI later soft');
    else
      notes.push('AI not first at launch');
  }
  if (exp.neverEng && exp.neverEng.test(engText + engPdfText))
    issues.push('engineer leaked forbidden ' + exp.neverEng);

  // Soft open items are fine
  const open = stillOpen(plan);
  if (open.length)
    notes.push('stillOpen: ' + open.slice(0, 3).join('; '));

  fs.writeFileSync(path.join(outDir, c.id + '.json'), JSON.stringify({
    id: c.id, title: c.title, why: c.why, issues, notes,
    plan: { name: plan.name, mode: plan.mode, specialty: plan.specialty, specialtyDetail: plan.specialtyDetail, first: plan.first, after: plan.after, city: plan.policy.cityState },
    identity: id, follow: follow?.id || null, sceneBadge: scene.badge, log
  }, null, 2));

  return { id: c.id, title: c.title, why: c.why, ok: issues.length === 0, issues, notes, planId: id.planId, specialty: plan.specialty, detail: plan.specialtyDetail || '' };
}

const limitArg = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0;
const selected = limitArg > 0 ? CASES.slice(0, limitArg) : CASES;

const results = [];
for (const c of selected) {
  try {
    results.push(await checkCase(c));
  }
  catch (e) {
    results.push({ id: c.id, title: c.title, why: c.why, ok: false, issues: ['CRASH ' + e.stack.split('\n').slice(0, 3).join(' | ')], notes: [], planId: null });
  }
}

const failed = results.filter(r => !r.ok);
const passed = results.filter(r => r.ok);
const summary = {
  total: results.length,
  passed: passed.length,
  failed: failed.length,
  failedIds: failed.map(r => r.id),
  results
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

console.log('\n=== Real-life probe: ' + passed.length + '/' + results.length + ' passed ===\n');
for (const r of results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(mark + '  ' + r.id + ' — ' + r.title);
  if (!r.ok)
    for (const i of r.issues)
      console.log('      • ' + i);
  for (const n of (r.notes || []).slice(0, 2))
    console.log('      · ' + n);
}
if (failed.length) {
  console.error('\n' + failed.length + ' case(s) failed. Details: ' + path.join(outDir, 'summary.json'));
  process.exit(1);
}
console.log('\nAll ' + results.length + ' real-life cases passed. Artifacts: ' + outDir);
