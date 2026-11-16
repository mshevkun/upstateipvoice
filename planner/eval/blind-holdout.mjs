#!/usr/bin/env node
/**
 * Blind holdout: never tune parse/extract against these ids.
 * Score once per release; fix by language class, not case id.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLIND_CASES } from './blind-holdout-cases.mjs';
import { loadBrain, playTurns, playTurnsAsync } from './eval-brain.mjs';

const args = new Set(process.argv.slice(2));
const useGroq = args.has('--groq');
const idFilter = args.has('--id') ? process.argv[process.argv.indexOf('--id') + 1] : '';
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'results');
const baselineFile = path.join(outDir, 'blind-holdout-baseline.json');

const brain = await loadBrain();
const cases = idFilter ? BLIND_CASES.filter(c => c.id === idFilter) : BLIND_CASES;

function runCase(c) {
  const step = useGroq ? null : playTurns(brain, c.turns);
  return { c, step };
}

async function runCaseAsync(c) {
  const step = await playTurnsAsync(brain, c.turns, { groq: true });
  return { c, step };
}

const results = [];
for (const c of cases) {
  const { step } = useGroq ? await runCaseAsync(c) : runCase(c);
  const ctx = { plan: step.plan, facts: step.facts, ack: step.ack, follow: step.follow };
  const issues = [];
  try {
    if (c.expect && !c.expect(ctx))
      issues.push('expect failed');
  } catch (e) {
    issues.push('expect threw: ' + e.message);
  }
  try {
    if (c.mustNot && !c.mustNot(ctx))
      issues.push('mustNot guard failed');
  } catch (e) {
    issues.push('mustNot threw: ' + e.message);
  }
  const wrongConfirmed = Object.entries(step.facts || {}).filter(([, f]) => f?.status === 'confirmed' && f?.precision === 'heuristic' && f?.scope === 'negated');
  if (wrongConfirmed.length)
    issues.push('heuristic confirmed under negated scope: ' + wrongConfirmed.map(([id]) => id).join(', '));
  results.push({
    id: c.id,
    ok: issues.length === 0,
    issues,
    groq: useGroq ? step.track : undefined,
    detail: {
      mode: step.plan?.mode,
      city: step.plan?.policy?.cityState,
      ring: step.plan?.policy?.ring,
      after: step.plan?.after?.kind,
      pms: step.plan?.policy?.opening?.pms
    }
  });
}

const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok);
const summary = {
  at: new Date().toISOString(),
  groq: useGroq,
  passed,
  total: results.length,
  failed: failed.map(f => ({ id: f.id, issues: f.issues }))
};

fs.mkdirSync(outDir, { recursive: true });
if (!useGroq && !args.has('--no-baseline') && !idFilter)
  fs.writeFileSync(baselineFile, JSON.stringify({ ...summary, results }, null, 2));

console.log(`\nBlind holdout: ${passed}/${results.length} passed (groq=${useGroq})\n`);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}${r.issues.length ? ' — ' + r.issues.join('; ') : ''}`);
}
if (failed.length)
  process.exit(1);