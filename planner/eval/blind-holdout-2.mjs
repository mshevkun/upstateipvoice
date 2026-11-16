#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLIND_HOLDOUT_2 } from './blind-holdout-2-cases.mjs';
import { loadBrain, playTurns } from './eval-brain.mjs';

const args = new Set(process.argv.slice(2));
const useGroq = args.has('--groq');
const brain = await loadBrain();
const results = [];

for (const c of BLIND_HOLDOUT_2) {
  const step = useGroq ? await (await import('./eval-brain.mjs')).playTurnsAsync(brain, c.turns, { groq: true }) : playTurns(brain, c.turns);
  const ctx = { plan: step.plan, facts: step.facts, ack: step.ack };
  const issues = [];
  try {
    if (c.expect && !c.expect(ctx))
      issues.push('expect failed');
    if (c.mustNot && !c.mustNot(ctx))
      issues.push('mustNot guard failed');
  } catch (e) {
    issues.push(e.message);
  }
  results.push({ id: c.id, ok: issues.length === 0, issues });
}

const passed = results.filter(r => r.ok).length;
const minPass = Math.ceil(results.length * 0.95);
const gate = passed >= minPass;
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'blind-holdout-2.json'), JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, gate, failed: results.filter(r => !r.ok) }, null, 2));

console.log(`Blind holdout 2: ${passed}/${results.length} (gate 95% = ${minPass}+) ${gate ? 'PASS' : 'FAIL'}`);
for (const r of results.filter(x => !x.ok))
  console.log(`  ${r.id}: ${r.issues.join('; ')}`);
process.exit(gate ? 0 : 1);