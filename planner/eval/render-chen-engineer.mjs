#!/usr/bin/env node
/** Full Chen gold → engineer PDF for design review. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { CONVERSATION, CHIP_ANSWERS } from './chen-gold.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'planner/src');
const buildDir = path.join(root, 'planner/.design-build');
const outDir = path.join(root, 'planner/eval/results/engineer-design');
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
  'architect/hear', 'architect/scrub', 'provisioning', 'bom', 'opening', 'status',
  'readiness', 'advisor', 'privacy', 'owner-brief', 'fusion', 'engineer-brief', 'plan-content', 'pdf'
])
  transpile(name);

const { initial } = await import(path.join(buildDir, 'config.mjs'));
const { interpretTurn, chipTurn } = await import(path.join(buildDir, 'architect/turn.mjs'));
const { createPDF } = await import(path.join(buildDir, 'pdf.mjs'));
const { engineerBrief } = await import(path.join(buildDir, 'engineer-brief.mjs'));
const { identity } = await import(path.join(buildDir, 'advisor.mjs'));

const blank = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };
let plan = initial();
let facts = {};
let follow = null;
for (const turn of CONVERSATION) {
  const r = interpretTurn({ plan, facts, interpreter: blank, userText: turn, question: follow });
  plan = r.plan;
  facts = r.facts;
  follow = r.follow;
}
let guard = 0;
while (follow && guard++ < 20) {
  const ans = CHIP_ANSWERS[follow.id];
  if (!ans)
    throw new Error('unexpected question: ' + follow.id);
  const chip = follow.options.find(o => o.value === ans.value) || {
    id: String(ans.value),
    label: ans.label,
    field_id: ans.field_id,
    value: ans.value,
    operation: 'set'
  };
  const step = chipTurn({ plan, facts, chip });
  plan = step.plan;
  facts = step.facts;
  follow = step.follow;
}
if (follow)
  throw new Error('conversation unfinished: ' + follow.id);

const font = fs.readFileSync(path.join(root, 'planner/public/assets/InstrumentSans.ttf'));
const logo = fs.readFileSync(path.join(root, 'planner/public/assets/upstate-logo.png'));
const bytes = await createPDF(plan, font, 'engineer', { logo });
const pdfPath = path.join(outDir, 'chen-engineer.pdf');
fs.writeFileSync(pdfPath, bytes);
const pages = engineerBrief(plan);
const id = identity(plan);
fs.writeFileSync(path.join(outDir, 'chen-engineer-pages.json'), JSON.stringify({
  identity: id,
  pageCount: pages.length,
  pages: pages.map(p => ({
    kicker: p.kicker,
    title: p.title,
    lede: p.lede,
    blocks: p.blocks.map(b => {
      if (b.kind === 'scripts')
        return { kind: b.kind, count: b.items.length, whens: b.items.map(i => i.when) };
      if (b.kind === 'rows' || b.kind === 'list' || b.kind === 'checks')
        return { kind: b.kind, count: b.items.length };
      if (b.kind === 'table')
        return { kind: b.kind, rows: b.rows.length, headers: b.headers };
      return { kind: b.kind };
    })
  }))
}, null, 2));
console.log(JSON.stringify({ pdf: pdfPath, pages: pages.length, planId: id.planId, revision: id.revision, checksum: id.checksum }, null, 2));
