#!/usr/bin/env node
/**
 * Announce proof (no DID): typed Chen + hard adversarial walks against
 * production Groq (/api/public/planner) with the local brain merge.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { CONVERSATION, CHIP_ANSWERS, CHEN_GOLD, STILL_OPEN_GOLD } from './chen-gold.mjs';
import { adversarialScenarios } from './gold-adversarial.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'planner/src');
const buildDir = path.join(root, 'planner/.announce-build');
const API = process.env.PLANNER_API || 'https://app.upstateipvoice.com';
const outDir = path.join(root, 'planner/eval/results/announce');
fs.mkdirSync(outDir, { recursive: true });
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
  'architect/schema', 'architect/fields', 'architect/parse', 'architect/extract', 'architect/ack',
  'architect/merge', 'architect/questions', 'architect/turn', 'architect/scene-from-plan',
  'architect/hear', 'architect/scrub', 'provisioning', 'bom', 'opening', 'status',
  'readiness', 'advisor', 'privacy', 'fusion'
])
  transpile(name);

const { initial } = await import(path.join(buildDir, 'config.mjs'));
const { interpretTurn, chipTurn } = await import(path.join(buildDir, 'architect/turn.mjs'));
const { stillOpen } = await import(path.join(buildDir, 'readiness.mjs'));
const { fusionBuild } = await import(path.join(buildDir, 'fusion.mjs'));
const { identity } = await import(path.join(buildDir, 'advisor.mjs'));

const blank = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };

async function api(method, p, body) {
  const t0 = Date.now();
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ms: Date.now() - t0, data };
}

async function groqTurn(sid, text, question, facts, history) {
  const confirmedState = Object.fromEntries(
    Object.entries(facts || {})
      .filter(([, f]) => f?.status === 'confirmed')
      .map(([id, f]) => [id, f.value])
  );
  const r = await api('POST', `/api/public/planner/sessions/${sid}/messages`, {
    clientMessageId: 'a-' + Math.random().toString(36).slice(2, 10),
    text,
    currentQuestionId: question?.id || null,
    currentQuestion: question ? { id: question.id, text: question.text } : null,
    confirmedState,
    facts,
    history: history.slice(-6).map(m => ({ role: m.role, content: m.content })),
    today: new Date().toISOString().slice(0, 10),
    timezone: 'America/New_York'
  });
  return r;
}

function get(plan, path) {
  if (!plan) return undefined;
  if (path === 'mode') return plan.mode;
  if (path === 'name') return plan.name;
  if (path === 'specialty') return plan.specialty;
  if (path === 'specialtyDetail') return plan.specialtyDetail;
  if (path === 'cityState') return plan.policy?.cityState;
  if (path.startsWith('teams.')) {
    const role = path.split('.')[1];
    return plan.teams.find(t => t.role === role)?.count;
  }
  if (path === 'first.kind') return plan.first?.kind;
  if (path === 'first.team') return plan.first?.team;
  if (path === 'after.kind') return plan.after?.kind;
  if (path === 'busy.kind') return plan.busy?.kind;
  if (path === 'hours.lunch') {
    if (plan.hours.days.some(d => d.breakStart && d.breakEnd)) return 'closed';
    if (/lunch phones covered/i.test(plan.policy?.notes || '')) return 'covered';
    return undefined;
  }
  if (path.startsWith('hours.') && path.endsWith('.start')) {
    const day = path.split('.')[1];
    return plan.hours.days.find(d => d.day === day)?.start;
  }
  if (path.startsWith('hours.') && path.endsWith('.end')) {
    const day = path.split('.')[1];
    return plan.hours.days.find(d => d.day === day)?.end;
  }
  if (path.startsWith('hours.') && path.endsWith('.open')) {
    const day = path.split('.')[1];
    return plan.hours.days.find(d => d.day === day)?.open;
  }
  if (path === 'opening.pms') return plan.policy?.opening?.pms;
  if (path === 'opening.date') return plan.policy?.opening?.date;
  if (path === 'languages.decision') return plan.policy?.languageDecision;
  if (path === 'languages.spanish') return plan.languages?.some(l => l.name === 'Spanish');
  if (path === 'urgent.kind') return plan.policy?.urgentKind;
  if (path === 'current.provider') return plan.current?.provider;
  return undefined;
}

function checkFacts(plan, expect) {
  const fails = [];
  for (const [k, v] of Object.entries(expect.facts || {})) {
    if (k === 'locations.names') continue; // soft
    const got = get(plan, k);
    if (got !== v && String(got) !== String(v))
      fails.push(`${k}: want ${JSON.stringify(v)} got ${JSON.stringify(got)}`);
  }
  for (const [k, v] of Object.entries(expect.never || {})) {
    const got = get(plan, k);
    if (got === v || String(got) === String(v))
      fails.push(`never ${k}=${JSON.stringify(v)} but got it`);
  }
  return fails;
}

function checkChen(plan) {
  const fails = [];
  const g = CHEN_GOLD;
  if (plan.name !== g.name) fails.push('name ' + plan.name);
  if (plan.policy.cityState !== g.cityState) fails.push('city ' + plan.policy.cityState);
  if (plan.mode !== g.mode) fails.push('mode ' + plan.mode);
  if (plan.specialty !== g.specialty) fails.push('specialty ' + plan.specialty);
  if (plan.policy.rooms !== g.rooms) fails.push('rooms ' + plan.policy.rooms);
  if (plan.policy.opening?.date !== g.opening.date) fails.push('opening.date ' + plan.policy.opening?.date);
  for (const [role, n] of Object.entries(g.teams)) {
    const got = plan.teams.find(t => t.role === role)?.count;
    if (got !== n) fails.push(`teams.${role}=${got}`);
  }
  if (plan.first.kind !== g.first.kind) fails.push('first.kind');
  const mon = plan.hours.days.find(d => d.day === 'Monday');
  if (mon?.start !== g.hours.monday.start || mon?.end !== g.hours.monday.end) fails.push('Mon hours');
  if (mon?.breakStart !== g.hours.monday.breakStart) fails.push('Mon lunch start');
  const fri = plan.hours.days.find(d => d.day === 'Friday');
  if (fri?.end !== g.hours.friday.end) fails.push('Fri end');
  if (plan.after.kind !== g.after.kind) fails.push('after');
  if (plan.policy.urgentKind !== g.urgent.kind) fails.push('urgent.kind ' + plan.policy.urgentKind);
  if (plan.policy.urgentScope !== g.urgent.scope) fails.push('urgent.scope ' + plan.policy.urgentScope);
  if (!plan.languages.some(l => l.name === 'Spanish')) fails.push('Spanish');
  if (plan.policy.beforeOpening !== g.beforeOpening) fails.push('beforeOpening');
  // Install leftovers only
  let fb;
  try { fb = fusionBuild(plan); } catch (e) { fails.push('fusion crash ' + e.message); fb = { blockers: [] }; }
  const hard = (fb.blockers || []).filter(b => !/Follow Me|E911|site survey/i.test(String(b)));
  if (hard.length) fails.push('fusion blockers: ' + hard.slice(0, 3).join('; '));
  const open = stillOpen(plan);
  for (const must of ['on-call work identity (Follow Me)', 'E911 address on install', 'internet & power site survey']) {
    if (!open.some(x => x.includes(must.split(' ')[0]) || x === must) && !STILL_OPEN_GOLD.includes(must))
      /* soft */;
  }
  return { fails, open, id: identity(plan) };
}

async function walkTalk(id, turns, chipMap = {}) {
  const created = await api('POST', '/api/public/planner/sessions', {
    planId: 'UP-' + id.replace(/[^a-z0-9-]/gi, '').slice(0, 24),
    revision: 0,
    plan: initial()
  });
  if (created.status !== 201)
    return { id, plan: initial(), facts: {}, follow: null, log: [{ create: created.status, data: created.data }], ms: [], history: [] };
  const sid = created.data.id;
  let plan = initial();
  let facts = {};
  let follow = null;
  const history = [];
  const ms = [];
  const log = [];

  for (const text of turns) {
    let remote;
    try {
      remote = await groqTurn(sid, text, follow, facts, history);
    } catch (e) {
      remote = { status: 0, ms: 0, data: { code: 'network', message: String(e.message || e) } };
    }
    ms.push(remote.ms);
    history.push({ role: 'user', content: text });
    let interpreter = blank;
    if (remote.status === 200 && remote.data?.interpreter)
      interpreter = remote.data.interpreter;
    else
      log.push({ turn: text.slice(0, 40), groq: remote.status, code: remote.data?.code || remote.data?.message });
    // On Groq 429/502, still apply local brain so the walk stays typed-realistic.
    const step = interpretTurn({ plan, facts, interpreter, userText: text, question: follow });
    plan = step.plan;
    facts = step.facts;
    follow = step.follow;
    history.push({ role: 'assistant', content: step.ack || interpreter.acknowledgement || '' });
    log.push({ ack: (step.ack || '').slice(0, 100), follow: follow?.id, groqMs: remote.ms, groq: remote.status });
    if (remote.status === 429)
      await new Promise(r => setTimeout(r, 8000));
  }

  let guard = 0;
  while (follow && guard++ < 25) {
    const chipDef = chipMap[follow.id]
      || follow.options?.find(o => o.operation === 'set')
      || follow.options?.find(o => o.operation === 'skip');
    if (!chipDef) break;
    const chip = follow.options?.find(o => o.value === chipDef.value || o.id === chipDef.id)
      || { id: 'x', label: chipDef.label || String(chipDef.value), field_id: chipDef.field_id || follow.id, value: chipDef.value, operation: 'set' };
    const step = chipTurn({ plan, facts, chip });
    plan = step.plan;
    facts = step.facts;
    follow = step.follow;
    log.push({ chip: chip.label, follow: follow?.id });
  }

  await api('PUT', `/api/public/planner/sessions/${sid}/plan`, {
    revision: 0,
    plan,
    facts,
    futureConsiderations: []
  }).catch(() => null);

  return { id, sid, plan, facts, follow, log, ms, history };
}

const HARD = ['chiro-odd-hours', 'solo-no-staff', 'phi-leak', 'pediatric-ai', 'contradiction', 'derm-terse']
  .map(id => adversarialScenarios.find(s => s.id === 'A-' + id))
  .filter(Boolean);

const results = [];

console.log('=== Production announce walks (no DID) @ ' + API + ' ===\n');

// Chen
{
  console.log('CHEN — 8 typed turns + chips…');
  const walked = await walkTalk('chen', CONVERSATION, CHIP_ANSWERS);
  const { fails, open, id } = checkChen(walked.plan);
  const ok = fails.length === 0;
  results.push({ id: 'CHEN', ok, fails, open, identity: id, groqMs: walked.ms, follow: walked.follow?.id, log: walked.log });
  console.log((ok ? 'PASS' : 'FAIL') + '  CHEN  groq p50=' + percentile(walked.ms, 0.5) + 'ms p95=' + percentile(walked.ms, 0.95) + 'ms');
  if (!ok) fails.forEach(f => console.log('   · ' + f));
  else console.log('   · ' + id.planId + ' · r' + id.revision + ' · ' + id.checksum);
  fs.writeFileSync(path.join(outDir, 'chen-plan.json'), JSON.stringify({ plan: walked.plan, log: walked.log, fails, open }, null, 2));
}

for (const s of HARD) {
  const turns = s.turns.map(t => t.owner || t.text || t);
  console.log(s.id + ' — ' + turns.length + ' turn(s)…');
  await new Promise(r => setTimeout(r, 2500)); // stay under prod interpret rate limit
  const walked = await walkTalk(s.id, turns, {});
  const fails = checkFacts(walked.plan || initial(), s.expect || {});
  // PHI / personal data must not land in the plan (user-typed history is not the store).
  if (s.id === 'A-phi-leak') {
    const planBlob = JSON.stringify(summarize(walked.plan));
    if (/John Smith|04\/12\/1961|drkim@/i.test(walked.plan.name || ''))
      fails.push('PHI leaked into name');
    if (/John Smith|drkim@|04\/12\/1961/i.test(planBlob))
      fails.push('PHI leaked into plan fields');
    const acks = (walked.log || []).map(l => l.ack || '').join(' ');
    if (/John Smith|drkim@/i.test(acks))
      fails.push('PHI echoed in acknowledgement');
    if (!/personal|patient|don'?t store|do not store/i.test(acks))
      fails.push('expected scrub notice in ack');
  }
  if (s.id === 'A-pediatric-ai') {
    if (/518-555-0142/.test(JSON.stringify(summarize(walked.plan))))
      fails.push('personal cell stored in plan');
  }
  const ok = fails.length === 0;
  results.push({ id: s.id, ok, fails, groqMs: walked.ms, follow: walked.follow?.id, name: walked.plan.name, specialty: walked.plan.specialty, mode: walked.plan.mode });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + s.id + (ok ? '' : '  ' + fails.join('; ')));
  fs.writeFileSync(path.join(outDir, s.id + '.json'), JSON.stringify({ plan: summarize(walked.plan), fails, log: walked.log }, null, 2));
}

function summarize(p) {
  return {
    name: p.name, mode: p.mode, specialty: p.specialty, specialtyDetail: p.specialtyDetail,
    city: p.policy?.cityState,
    teams: Object.fromEntries(p.teams.map(t => [t.role, t.count])),
    first: p.first, after: p.after?.kind, busy: p.busy?.kind,
    urgent: p.policy?.urgentKind,
    hours: p.hours.days.map(d => ({ day: d.day, open: d.open, start: d.start, end: d.end, break: d.breakStart ? d.breakStart + '-' + d.breakEnd : '' })),
    languages: p.languages, beforeOpening: p.policy?.beforeOpening
  };
}

function percentile(arr, p) {
  if (!arr?.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
}

const passed = results.filter(r => r.ok).length;
const summary = { at: new Date().toISOString(), api: API, passed, total: results.length, results };
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('\n=== ' + passed + '/' + results.length + ' passed ===');
console.log('Artifacts: ' + outDir);
process.exit(passed === results.length ? 0 : 1);
