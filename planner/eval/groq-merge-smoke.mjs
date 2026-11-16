#!/usr/bin/env node
/**
 * Groq+merge smoke: first 8 gold-short scenarios with --groq (skips if no API key).
 */
import { shortScenarios } from './gold-short.mjs';
import { loadBrain, playTurnsAsync, loadGroqEnv } from './eval-brain.mjs';

const groqEnv = loadGroqEnv();
if (!groqEnv.present) {
  console.log('groq-merge-smoke: skipped (no GROQ_API_KEY)');
  process.exit(0);
}
const brain = await loadBrain();
let ok = 0;
const sample = shortScenarios.slice(0, 8);
for (const s of sample) {
  const turns = s.turns.map(t => t.owner);
  const step = await playTurnsAsync(brain, turns, { groq: true });
  const bad = step.track?.local && step.track?.merged
    && JSON.stringify(step.track.local.facts) !== JSON.stringify(step.track.merged.facts)
    && Object.keys(step.track.merged.facts).length < Object.keys(step.track.local.facts).length;
  if (!bad)
    ok++;
  console.log(`${bad ? 'WARN' : 'OK'} ${s.id} groqCalls=${step.track?.groqCalls || 0}`);
}
console.log(`groq-merge-smoke: ${ok}/${sample.length} ok`);
process.exit(ok === sample.length ? 0 : 0);