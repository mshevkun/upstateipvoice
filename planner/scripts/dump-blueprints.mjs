#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'planner/src');
const buildDir = path.join(root, 'planner/.test-build');
const outDir = path.join(root, 'planner/.smoke/blueprints');

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
  'architect/schema', 'architect/fields', 'architect/parse', 'architect/extract', 'architect/ack',
  'architect/merge', 'architect/questions', 'architect/turn', 'architect/scene-from-plan',
  'architect/hear', 'architect/scrub', 'provisioning', 'bom', 'opening', 'status', 'readiness', 'advisor',
  'privacy', 'owner-brief', 'fusion', 'engineer-brief', 'plan-content', 'pdf'
])
  transpile(name);

const { initial, commit } = await import(path.join(buildDir, 'config.mjs'));
const { interpretTurn } = await import(path.join(buildDir, 'architect/turn.mjs'));
const { callerHear } = await import(path.join(buildDir, 'architect/hear.mjs'));
const { glance, insights, callMaps, purchaseBands } = await import(path.join(buildDir, 'advisor.mjs'));
const { ownerSections, engineerSections } = await import(path.join(buildDir, 'plan-content.mjs'));
const { fusionBuild } = await import(path.join(buildDir, 'fusion.mjs'));
const { createPairedPDFs } = await import(path.join(buildDir, 'pdf.mjs'));

const blank = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };

function play(texts) {
  let plan = initial();
  let facts = {};
  let follow = null;
  const acks = [];
  for (const userText of texts) {
    const turned = interpretTurn({ plan, facts, interpreter: blank, userText, question: follow });
    plan = turned.plan;
    facts = turned.facts;
    follow = turned.follow;
    acks.push({ userText, ack: turned.ack, follow: follow?.id || null });
  }
  try {
    plan = commit(plan, plan);
  }
  catch { /* already valid */ }
  return { plan, facts, follow, acks };
}

function dumpText(name, { plan, acks, follow }) {
  const g = glance(plan);
  const maps = callMaps(plan);
  const hear = callerHear(plan);
  const heads = insights(plan);
  const bands = purchaseBands(plan);
  const fusion = fusionBuild(plan);
  const lines = [
    '# ' + name,
    'mode=' + plan.mode + ' ring=' + plan.policy.ring + ' next=' + (follow?.id || 'done'),
    '',
    '## Chat acks',
    ...acks.map(a => 'Q follow=' + a.follow + '\nOwner: ' + a.userText + '\nAck: ' + a.ack),
    '',
    '## Glance',
    g.practice,
    g.dek,
    ...g.metrics.map(m => m.value + ' · ' + m.label),
    g.waitNote,
    '',
    '## Insights',
    ...heads.map(i => i.severity.toUpperCase() + ' ' + i.title + ' — ' + i.detail),
    '',
    '## Call map',
    JSON.stringify(maps, null, 2),
    '',
    '## What a caller hears',
    ...hear.map(r => r.when + ': ' + r.hear),
    '',
    '## Buy',
    ...[...bands.required, ...bands.alsoRequired, ...bands.optional, ...bands.notYet].map(r => r.band + ' ' + r.qty + ' ' + r.item + ' — ' + r.purpose),
    '',
    '## Owner sections (selected)',
    ...ownerSections(plan).flatMap(([title, rows]) => ['### ' + title, ...rows.slice(0, 8)]),
    '',
    '## Fusion recordings',
    ...fusion.recordings.map(r => r.name + ' [' + r.filename + ']: ' + r.script),
    '',
    '## Fusion blockers',
    ...(fusion.blockers.length ? fusion.blockers : ['none']),
    '',
    '## Personal number leaked?',
    JSON.stringify(plan).includes('845-555') ? 'YES LEAK' : 'no',
    'Install-ready claim?',
    /ready to install|e911 confirmed|verified live/i.test(JSON.stringify(ownerSections(plan))) ? 'YES BAD' : 'no'
  ];
  const text = lines.join('\n');
  fs.writeFileSync(path.join(outDir, name + '.txt'), text);
  return text;
}

const hudson = play([
  "We've had this dental office in Hudson for twenty years. Two girls at the front, I'm the dentist. They pick up, not a menu.",
  "No office manager. Weekdays eight to five. Closed for lunch noon to one. When the girls are with a patient the phone just rings and people hang up — take a message. After hours take a message. Keep the number. Four rooms, those are not phones. English is enough. We don't have anyone on call.",
  'The receptionist checks the messages in the morning.',
  'They can both pick up at once.',
  'If nobody answers just ring my cell, 845-555-0199. Do not put my number in the greeting.'
]);
hudson.plan.name = 'Hudson Family Dental';

const opening = play([
  "We're opening a dental office in Catskill. Drywall is still up, not open yet. I haven't hired a receptionist. If someone finds the number before we open, take a callback message. After hours just take a message. I'm the dentist.",
  'I check the voicemail.',
  'No office manager.'
]);
opening.plan.name = 'Catskill Family Dental';

const fontBytes = fs.readFileSync(path.join(root, 'planner/public/assets/InstrumentSans.ttf'));
const logo = fs.readFileSync(path.join(root, 'planner/public/assets/upstate-logo.png'));

for (const [name, session] of [['hudson', hudson], ['opening', opening]]) {
  dumpText(name, session);
  const pair = await createPairedPDFs(session.plan, fontBytes, { logo });
  fs.writeFileSync(path.join(outDir, name + '-owner.pdf'), pair.owner);
  fs.writeFileSync(path.join(outDir, name + '-engineer.pdf'), pair.engineer);
  const o = await PDFDocument.load(pair.owner);
  const e = await PDFDocument.load(pair.engineer);
  console.log(name, 'owner pages', o.getPageCount(), 'engineer pages', e.getPageCount(), 'id', pair.identity.planId);
}

console.log('wrote', outDir);
