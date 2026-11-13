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
  'architect/schema', 'architect/fields', 'architect/parse', 'architect/extract', 'architect/ack',
  'architect/merge', 'architect/questions', 'architect/turn', 'architect/scene-from-plan',
  'architect/hear', 'architect/scrub', 'provisioning', 'bom', 'opening', 'status', 'readiness', 'advisor',
  'privacy', 'owner-brief', 'fusion', 'engineer-brief', 'plan-content', 'pdf'
])
  transpile(name);

const { initial } = await import(path.join(buildDir, 'config.mjs'));
const { interpretTurn, chipTurn } = await import(path.join(buildDir, 'architect/turn.mjs'));
const { callerHear } = await import(path.join(buildDir, 'architect/hear.mjs'));
const { identity, glance, insights, purchaseBands } = await import(path.join(buildDir, 'advisor.mjs'));
const { createPairedPDFs } = await import(path.join(buildDir, 'pdf.mjs'));

const blank = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };

const { CONVERSATION, CHIP_ANSWERS } = await import(path.join(root, 'planner/eval/chen-gold.mjs'));
export { CONVERSATION };

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
  let guard = 0;
  while (follow && guard++ < 8) {
    const answer = CHIP_ANSWERS[follow.id];
    if (!answer)
      break;
    const chip = follow.options.find(o => o.value === answer.value) || {
      id: answer.value,
      label: answer.label,
      field_id: answer.field_id,
      value: answer.value,
      operation: 'set'
    };
    const turned = chipTurn({ plan, facts, chip });
    plan = turned.plan;
    facts = turned.facts;
    follow = turned.follow;
    turns.push({ userText: chip.label, ack: turned.ack, follow: follow?.id || null });
  }
  return { plan, facts, follow, turns };
}

const extracted = play(CONVERSATION);
const plan = extracted.plan;
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
