#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'planner/src');
const buildDir = path.join(root, 'planner/.test-build');
const outDir = path.join(root, 'examples');

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
  'architect/schema', 'architect/fields', 'architect/extract', 'architect/ack',
  'architect/merge', 'architect/questions', 'architect/turn', 'architect/scene-from-plan',
  'architect/hear', 'provisioning', 'bom', 'opening', 'status', 'readiness', 'advisor',
  'fusion', 'plan-content', 'pdf'
])
  transpile(name);

const { initial, valid, commit } = await import(path.join(buildDir, 'config.mjs'));
const { inventory } = await import(path.join(buildDir, 'policy.mjs'));
const { interpretTurn } = await import(path.join(buildDir, 'architect/turn.mjs'));
const { callerHear } = await import(path.join(buildDir, 'architect/hear.mjs'));
const { suggestedGreeting } = await import(path.join(buildDir, 'flow.mjs'));
const { identity, glance, insights, purchaseBands } = await import(path.join(buildDir, 'advisor.mjs'));
const { createPairedPDFs } = await import(path.join(buildDir, 'pdf.mjs'));

const blank = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };

export const CONVERSATION = [
  "I'm Dr. Maya Chen. I'm opening my own family dental practice in Kingston, New York — Chen Family Dental. I've been an associate in Poughkeepsie for fourteen years. We take possession of a Broadway build-out and I want to be seeing patients the week of March 15, 2027. Six operatories. Those are treatment rooms, not phones.",
  "Two receptionists at the front, already hired. My husband is the office manager — billing, insurance, payroll. Clinical side is me, an associate dentist joining in April, two hygienists, and two assistants. Patients should reach a person at the front desk first, not a menu.",
  "Phones: Monday through Thursday 8 AM to 5 PM. Friday 8 AM to 2 PM. Closed Saturday and Sunday. Lunch is 12:30 to 1:30 Monday through Thursday — the desk is empty, phones should close, not keep ringing. Friday is a short day, no lunch close.",
  "If both receptionists are with patients, take a message. They check the inbox first thing in the morning. They need two separate lines so they can take two callers at once. If the front is slammed, ring my husband's work mobile — a work phone, not his personal cell, and never put a personal number in a recording.",
  "After hours, next-business-day voicemail. Front desk owns those messages. If someone has swelling, trauma, or uncontrolled bleeding, try to reach the on-call dentist. That's only those urgent cases, not every call. If we miss it, still take a priority message. For a true emergency they should hang up and call 911. We rotate on-call between me and the associate. Do not put my cell in the greeting.",
  "One of the receptionists is bilingual. Spanish during open hours is enough — we cannot cover Spanish at 9 PM. English is the after-hours recording.",
  "Before we open, if someone finds the number, take a callback message. Do not advertise the number until that recording exists. New number, not porting. Internet and network still need a survey. We'll run Open Dental. Thanksgiving and Christmas we're closed. Snow days should follow the closed-hours recording — never forward the published number to a personal phone.",
  "Appointments stay with the front desk. Billing and insurance go to the office manager. Clinical questions can go to the clinical team after reception screens them. We still have two analog lines and a fax for insurance; keep the fax, don't mix it with the patient number."
];

function play(texts) {
  let plan = initial();
  let facts = {};
  let follow = null;
  const turns = [];
  for (const userText of texts) {
    const turned = interpretTurn({ plan, facts, interpreter: blank, userText, question: follow });
    plan = turned.plan;
    facts = turned.facts;
    follow = turned.follow;
    turns.push({ userText, ack: turned.ack, follow: follow?.id || null });
  }
  return { plan, facts, follow, turns };
}

function enrich(plan) {
  const p = structuredClone(plan);
  p.planId = 'UP-CHEN-KINGSTON';
  p.name = 'Chen Family Dental';
  p.mode = 'opening';
  p.specialty = 'Dental';
  p.locations = [{ id: 'location-1', name: 'Kingston office' }];
  p.teams = [
    { id: 'reception', name: 'Front desk', role: 'reception', count: 2, status: 'known' },
    { id: 'clinical', name: 'Clinical team', role: 'clinical', count: 6, status: 'known' },
    { id: 'admin', name: 'Administration', role: 'administration', count: 1, status: 'known' }
  ];
  p.first = { kind: 'human', team: 'reception' };
  p.reasons = [
    { id: 'appointments', label: 'Appointments and scheduling', team: 'reception' },
    { id: 'billing', label: 'Billing and insurance questions', team: 'admin' },
    { id: 'clinical-question', label: 'Clinical questions', team: 'clinical' }
  ];
  p.busy = { kind: 'message', seconds: 25, wait: 90, backup: 'admin', owner: 'reception' };
  p.after = {
    kind: 'message',
    owner: 'reception',
    instructions: 'Leave your name, number, and reason for calling. We return calls on the next business day. For a true emergency, hang up and dial 911.'
  };
  p.urgent = {
    enabled: true,
    approved: true,
    instructions: 'If this is swelling, trauma, or uncontrolled bleeding, we will try the on-call dentist. If this is a life-threatening emergency, hang up and call 911.',
    team: 'clinical',
    backup: 'admin',
    seconds: 30,
    owner: 'clinical'
  };
  p.followup = { owner: 'reception', target: 'By the next business day', channels: ['Phone callback'] };
  p.current = {
    provider: 'Two analog lines plus a consumer adapter, plus a dedicated insurance fax',
    monthly: '',
    lines: '2 analog + 1 fax',
    notes: 'Keep the insurance fax off the published patient number.'
  };
  p.languages = [{
    name: 'Spanish',
    mechanism: 'staff',
    team: 'reception',
    availability: 'open',
    note: 'One bilingual receptionist during open hours only.',
    fallback: 'reception'
  }];
  p.hours = {
    timezone: 'America/New_York',
    holidayPolicy: 'closed',
    holidays: ['2027-11-25', '2027-12-25'],
    days: [
      { day: 'Monday', open: true, start: '08:00', end: '17:00', breakStart: '12:30', breakEnd: '13:30' },
      { day: 'Tuesday', open: true, start: '08:00', end: '17:00', breakStart: '12:30', breakEnd: '13:30' },
      { day: 'Wednesday', open: true, start: '08:00', end: '17:00', breakStart: '12:30', breakEnd: '13:30' },
      { day: 'Thursday', open: true, start: '08:00', end: '17:00', breakStart: '12:30', breakEnd: '13:30' },
      { day: 'Friday', open: true, start: '08:00', end: '14:00', breakStart: '', breakEnd: '' },
      { day: 'Saturday', open: false, start: '09:00', end: '17:00', breakStart: '', breakEnd: '' },
      { day: 'Sunday', open: false, start: '09:00', end: '17:00', breakStart: '', breakEnd: '' }
    ]
  };
  p.policy = {
    ...p.policy,
    cityState: 'Kingston, NY',
    hoursPreset: 'custom',
    hoursExceptionsConfirmed: true,
    rooms: 6,
    roomsSpecified: true,
    languageDecision: 'selected',
    languageProviders: { Spanish: 'team' },
    billingPerformedBy: 'administration',
    urgentKind: 'connect',
    urgentScope: 'urgent_only',
    urgentCoverage: 'closed',
    urgentRoster: 'rotation',
    urgentBackup: 'message',
    urgentAlert: 'email',
    pendingClinicianRoute: false,
    ring: 'together',
    notification: 'inbox',
    queueExit: 'message',
    number: 'own',
    locationEntry: 'undecided',
    bomTier: 'balanced',
    followup: 'yes',
    followupOwners: { after: 'reception', busy: 'reception' },
    portNumbers: false,
    system: 'Open Dental',
    beforeOpening: 'message',
    beforeOpeningOwner: 'reception',
    opening: {
      date: '2027-03-15',
      precision: 'day',
      construction: 'build-out',
      numbers: 'new',
      internet: 'survey',
      network: 'survey',
      pms: 'Open Dental'
    },
    continuity: {
      internet: 'survey',
      power: 'ups',
      backupRouting: 'cellular',
      notes: 'Snow days follow the closed-hours recording. Never forward the published number to a personal cell. Work mobile answering is the office manager work phone only.'
    },
    notes: 'Work mobile answering is the office manager work app / follow me, never a personal cell in a greeting or on a wall card. Six operatories are treatment rooms, not a six-phone order. Keep the insurance fax separate from the patient number.',
    placements: [
      { id: 'reception', team: 'reception', label: 'Front desk', device: 'desk', count: 2, sharing: 'separate', access: 'outside', extension: '' },
      { id: 'admin', team: 'admin', label: 'Office manager desk', device: 'computer', count: 1, sharing: 'shared', access: 'outside', extension: '' },
      { id: 'admin-mobile', team: 'admin', label: 'Office manager work mobile', device: 'mobile', count: 1, sharing: 'shared', access: 'outside', extension: '' },
      { id: 'clinical', team: 'clinical', label: 'Doctors’ office', device: 'computer', count: 1, sharing: 'shared', access: 'internal', extension: '' }
    ],
    terminalApprovals: {
      'reason:appointments': true,
      'reason:billing': true,
      'reason:clinical-question': true,
      urgent: true
    },
    handoffTested: false,
    onCallRouteVerified: false,
    e911Confirmed: false,
    baaAcknowledged: false,
    acceptance: false
  };
  p.policy.beforeOpeningText = suggestedGreeting(p) + ' Please leave your name, number, and a good time to reach you. We will call you back.';
  p.confirmed = ['hours', 'urgent', 'team', 'positions', 'first', 'reasons', 'busy', 'after'];
  p.endpoints = inventory(p);
  p.updatedAt = new Date().toISOString();
  p.revision = 1;
  if (!valid(p))
    throw new Error('Chen Family Dental plan is not valid');
  return commit({ ...p, revision: 0 }, p);
}

const extracted = play(CONVERSATION);
const plan = enrich(extracted.plan);
const hear = callerHear(plan);
const id = identity(plan);
const g = glance(plan);
const heads = insights(plan);
const bands = purchaseBands(plan);

const fontBytes = fs.readFileSync(path.join(root, 'planner/public/assets/InstrumentSans.ttf'));
const logo = fs.readFileSync(path.join(root, 'planner/public/assets/upstate-logo.png'));
const pair = await createPairedPDFs(plan, fontBytes, { logo });
if (pair.identity.planId !== id.planId || pair.identity.checksum !== id.checksum)
  throw new Error('Paired export identity drifted');

const ownerPath = path.join(outDir, 'chen-family-dental-owner.pdf');
const engineerPath = path.join(outDir, 'chen-family-dental-engineer.pdf');
fs.writeFileSync(ownerPath, Buffer.from(pair.owner));
fs.writeFileSync(engineerPath, Buffer.from(pair.engineer));

const ownerDoc = await PDFDocument.load(pair.owner);
const engDoc = await PDFDocument.load(pair.engineer);
if (ownerDoc.getPageCount() !== 6)
  throw new Error('Owner PDF must be six pages, got ' + ownerDoc.getPageCount());

const transcript = [
  '# Chen Family Dental — walkthrough',
  'planId=' + id.planId + ' revision=' + id.revision + ' checksum=' + id.checksum,
  '',
  '## Conversation',
  ...extracted.turns.flatMap((t, i) => ['### ' + (i + 1), 'Owner: ' + t.userText, 'Architect: ' + t.ack, '']),
  '## Glance',
  g.practice,
  g.dek,
  ...g.metrics.map(m => m.value + ' · ' + m.label),
  '',
  '## Insights',
  ...heads.map(i => i.severity.toUpperCase() + ' ' + i.title + ' — ' + i.detail),
  '',
  '## What a caller hears',
  ...hear.map(r => r.when + ': ' + r.hear),
  '',
  '## Buy (no invented prices)',
  ...[...bands.required, ...bands.alsoRequired, ...bands.optional, ...bands.notYet].map(r => r.band + ' ×' + r.qty + ' ' + r.item + ' — ' + r.purpose)
].join('\n');
fs.writeFileSync(path.join(outDir, 'chen-family-dental.txt'), transcript);

console.log(JSON.stringify({
  planId: id.planId,
  revision: id.revision,
  checksum: id.checksum,
  ownerPages: ownerDoc.getPageCount(),
  engineerPages: engDoc.getPageCount(),
  ownerBytes: pair.owner.byteLength,
  engineerBytes: pair.engineer.byteLength,
  owner: ownerPath,
  engineer: engineerPath,
  extractedFollow: extracted.follow?.id || 'done'
}, null, 2));
