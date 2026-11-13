#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { shortScenarios } from './gold-short.mjs';
import { fullScenarios } from './gold-full.mjs';
import { dumpScenarios } from './gold-dump.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'planner/src');
const buildDir = path.join(root, 'planner/.eval-build');
const outDir = path.join(root, 'planner/eval/results');
const cacheDir = path.join(outDir, 'cache');
const args = new Set(process.argv.slice(2));
const idFilter = process.argv.includes('--id') ? process.argv[process.argv.indexOf('--id') + 1] : '';
const suite = args.has('--full') && !args.has('--short') ? 'full' : args.has('--short') && !args.has('--full') ? 'short' : 'all';
const useGroq = !args.has('--no-groq');
const writePdf = !args.has('--no-pdf');
const limitArg = process.argv.includes('--limit') ? Number(process.argv[process.argv.indexOf('--limit') + 1]) : 0;

fs.mkdirSync(path.join(buildDir, 'architect'), { recursive: true });
fs.mkdirSync(cacheDir, { recursive: true });

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
  const dest = path.join(buildDir, rel + '.mjs');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
}

for (const name of [
  'config', 'policy', 'locations', 'routing', 'flow', 'team-state', 'state',
  'architect/schema', 'architect/fields', 'architect/parse', 'architect/extract', 'architect/ack',
  'architect/merge', 'architect/questions', 'architect/turn', 'architect/scene-from-plan',
  'architect/prompt', 'architect/hear', 'architect/scrub', 'fusion', 'plan-content', 'privacy', 'advisor', 'owner-brief', 'engineer-brief', 'opening', 'status',
  'readiness', 'bom', 'provisioning', 'pdf'
])
  transpile(name);

const { initial } = await import(path.join(buildDir, 'config.mjs'));
const { applyUpdates } = await import(path.join(buildDir, 'architect/merge.mjs'));
const { interpretTurn } = await import(path.join(buildDir, 'architect/turn.mjs'));
const { nextQuestion, ownerQuestions } = await import(path.join(buildDir, 'architect/questions.mjs'));
const { INTERPRETER_SYSTEM_PROMPT } = await import(path.join(buildDir, 'architect/prompt.mjs'));
const { interpreterResponseSchema } = await import(path.join(buildDir, 'architect/schema.mjs'));
const { ownerSections, engineerSections } = await import(path.join(buildDir, 'plan-content.mjs'));

function loadGroqEnv() {
  const files = [
    '/Users/andriizorin/Documents/upstateipv/sms-portal/api/.env',
    path.join(root, '.env')
  ];
  let key = process.env.GROQ_API_KEY || '';
  let model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
  for (const file of files) {
    if (!fs.existsSync(file))
      continue;
    const text = fs.readFileSync(file, 'utf8');
    const k = /(?:^|\n)GROQ_API_KEY=([^\n]+)/.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, '');
    const m = /(?:^|\n)GROQ_MODEL=([^\n]+)/.exec(text)?.[1]?.trim().replace(/^["']|["']$/g, '');
    if (k)
      key = k;
    if (m)
      model = m;
  }
  return { key, model, present: /^gsk_/.test(key) };
}

const groqEnv = loadGroqEnv();
if (useGroq && !groqEnv.present)
  console.error('GROQ_API_KEY is missing; running local hints only.');

const compactRegistry = [
  { id: 'mode', type: 'enum', enum: ['opening', 'improving', 'adding'] },
  { id: 'specialty', type: 'enum', enum: ['Dental', 'Eye care', 'Other healthcare practice'] },
  { id: 'cityState', type: 'string' },
  { id: 'opening.date', type: 'string' },
  { id: 'opening.precision', type: 'enum', enum: ['day', 'month', 'none'] },
  { id: 'teams.reception.count', type: 'number' },
  { id: 'teams.clinical.count', type: 'number' },
  { id: 'teams.administration.count', type: 'number' },
  { id: 'billing.performed_by', type: 'enum', enum: ['reception', 'administration', 'clinical', 'split', 'undecided'] },
  { id: 'first.kind', type: 'enum', enum: ['human', 'menu', 'assistant', 'undecided'] },
  { id: 'first.team', type: 'string' },
  { id: 'busy.kind', type: 'enum', enum: ['message', 'queue', 'backup', 'assistant', 'undecided'] },
  { id: 'busy.wait', type: 'number' },
  { id: 'after.kind', type: 'enum', enum: ['information', 'message', 'service', 'assistant', 'undecided'] },
  { id: 'urgent.kind', type: 'enum', enum: ['connect', 'priority', 'instructions', 'none', 'undecided'] },
  { id: 'urgent.team', type: 'string' },
  { id: 'urgent.coverage', type: 'enum', enum: ['always', 'closed', 'open', 'selected', 'undecided'] },
  { id: 'urgent.scope', type: 'enum', enum: ['urgent_only', 'all_calls', 'undecided'] },
  { id: 'hours.preset', type: 'enum', enum: ['weekdays', 'always', 'custom', 'undecided'] },
  { id: 'policy.rooms', type: 'number' },
  { id: 'future.ai_receptionist', type: 'string' }
];

const emptyInterpreter = {
  acknowledgement: 'Got it!',
  intent: 'provide_information',
  updates: [],
  unmapped_facts: [],
  explanation_topic: null
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function confirmed(facts) {
  const out = {};
  for (const [id, fact] of Object.entries(facts))
    if (fact?.status === 'confirmed')
      out[id] = fact.value;
  return out;
}

function same(a, b) {
  if (a == null && b == null)
    return true;
  if (a === b)
    return true;
  if (typeof a === 'number' || typeof b === 'number')
    return Number(a) === Number(b);
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function factVal(facts, id) {
  const f = facts[id];
  return f?.status === 'confirmed' ? f.value : undefined;
}

function remembered(plan, facts, future, unmapped, ack) {
  const bits = [
    ack || '',
    ...(future || []),
    ...(unmapped || []),
    plan.policy?.notes || '',
    plan.current?.notes || '',
    ...Object.values(facts).flatMap(f => [String(f?.value ?? ''), f?.evidence || ''])
  ];
  return bits.join('\n').toLowerCase();
}

function applyStart(plan, facts, start) {
  if (!start)
    return { plan, facts };
  const updates = Object.entries(start).map(([field_id, value]) => ({
    field_id,
    operation: 'set',
    value,
    evidence: 'start',
    needs_confirmation: false
  }));
  return applyUpdates(plan, facts, updates, 'provide_information');
}

function checkExpect(expect, ctx) {
    if (!expect)
        return [];
    const { plan, facts, follow, ack, intent, future, unmapped, kind } = ctx;
    const failures = [];
    const fail = msg => failures.push(msg);
    for (const [id, value] of Object.entries(expect.facts || {})) {
        const got = factVal(facts, id);
        if (!same(got, value))
            fail(`${id} expected ${JSON.stringify(value)}, got ${JSON.stringify(got)}`);
    }
    for (const [id, values] of Object.entries(expect.factsAllow || {})) {
        const got = factVal(facts, id);
        const list = Array.isArray(values) ? values : [values];
        if (!list.some(v => same(got, v)))
            fail(`${id} expected one of ${JSON.stringify(list)}, got ${JSON.stringify(got)}`);
    }
  for (const [id, needle] of Object.entries(expect.factsContain || {})) {
    const got = String(factVal(facts, id) ?? '');
    if (!got.toLowerCase().includes(String(needle).toLowerCase()))
      fail(`${id} should contain ${needle}, got ${got}`);
  }
  for (const [id, min] of Object.entries(expect.factsAtLeast || {})) {
    const got = Number(factVal(facts, id));
    if (!Number.isFinite(got) || got < min)
      fail(`${id} expected >= ${min}, got ${got}`);
  }
    if (expect.factsAny?.length) {
        const ok = expect.factsAny.some(pair => Object.entries(pair).every(([id, value]) => same(factVal(facts, id), value)));
        if (!ok)
            fail(`none of ${JSON.stringify(expect.factsAny)} confirmed`);
    }
  for (const [id, banned] of Object.entries(expect.never || {})) {
    const got = factVal(facts, id);
    if (got === undefined)
      continue;
    const list = Array.isArray(banned) ? banned : [banned];
    if (list.some(v => same(got, v)))
      fail(`${id} must not be ${JSON.stringify(got)}`);
  }
  for (const id of expect.leaveUnresolved || expect.unresolved || []) {
    if (factVal(facts, id) !== undefined)
      fail(`${id} should stay unresolved, got ${JSON.stringify(factVal(facts, id))}`);
  }
  if (expect.nextQuestionIn) {
    if (!expect.nextQuestionIn.includes(follow?.id))
      fail(`next question ${follow?.id || 'none'} not in ${expect.nextQuestionIn.join(', ')}`);
  }
  if (expect.nextQuestionNot) {
    if (expect.nextQuestionNot.includes(follow?.id))
      fail(`next question should not be ${follow.id}`);
  }
  if (expect.devicesUndecided && plan.endpoints && !plan.endpoints.undecided && (plan.endpoints.desk + plan.endpoints.computer + plan.endpoints.mobile) > 0)
    fail('devices were decided without an owner phone count');
  if (expect.roomsAreNotPhones && plan.policy.roomsSpecified && plan.policy.rooms > 0 && factVal(facts, 'devices.reception.desk_count') == null) {
    const phones = plan.endpoints.desk + plan.endpoints.computer + plan.endpoints.mobile;
    if (phones === plan.policy.rooms)
      fail('room count was copied onto phones');
  }
  if (expect.noVerifiedOnCall && (plan.policy.onCallRouteVerified || plan.policy.handoffTested || plan.policy.e911Confirmed))
    fail('on-call or e911 marked verified');
  if (expect.noVerifiedBooking && /configured|enabled/.test(plan.policy.assistant?.status || '') && plan.policy.assistant.status !== 'not-configured' && plan.policy.assistant.status !== 'needs-confirmation')
    fail('booking marked configured');
    if (expect.ackMustNotBeGeneric && /^(got it!?|i captured that|understood|okay)\.?$/i.test((ack || '').trim()))
        fail(`generic acknowledgement: ${ack}`);
    for (const needle of expect.ackMustNotInclude || [])
        if ((ack || '').toLowerCase().includes(String(needle).toLowerCase()))
            fail(`acknowledgement contains ${needle}`);
    if (expect.destinations) {
        const roles = plan.teams.filter(t => t.status === 'known' && t.count > 0).map(t => t.role);
        const ids = plan.teams.filter(t => t.status === 'known' && t.count > 0).map(t => t.id);
        for (const dest of expect.destinations) {
            const ok = dest === 'administration' ? roles.includes('administration') || ids.includes('admin') : roles.includes(dest) || ids.includes(dest);
            if (!ok)
                fail(`missing destination ${dest}`);
        }
    }
    for (const [id, values] of Object.entries(expect.optional || {})) {
        const got = factVal(facts, id);
        if (got === undefined)
            continue;
        const list = Array.isArray(values) ? values : [values];
        if (!list.some(v => same(got, v)))
            fail(`${id} optional value ${JSON.stringify(got)} not in ${JSON.stringify(list)}`);
    }
  if (expect.intent && !expect.intentAnyTurn && intent !== expect.intent)
    fail(`intent expected ${expect.intent}, got ${intent}`);
  const blob = remembered(plan, facts, future, unmapped, ack);
  for (const needle of expect.rememberedContain || [])
    if (!blob.includes(String(needle).toLowerCase()))
      fail(`remembered text missing ${needle}`);
  for (const needle of expect.rememberedMustNotContain || [])
    if (blob.includes(String(needle).toLowerCase()))
      fail(`remembered text contains ${needle}`);
  if (expect.noPhiStored && /\b(dob|date of birth|ssn)\b/.test(blob))
    fail('PHI stored in plan memory');
  for (const needle of expect.futureConsiderationsContain || [])
    if (!(future || []).join(' ').toLowerCase().includes(String(needle).toLowerCase()))
      fail(`future considerations missing ${needle}`);
  return failures;
}

async function groqInterpret(context) {
  if (!useGroq || !groqEnv.present)
    return { interpreter: emptyInterpreter, source: 'hints' };
  const payload = {
    model: groqEnv.model,
    temperature: 0,
    stream: false,
    messages: [
      { role: 'system', content: INTERPRETER_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(context) }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'practice_interpreter_v1', strict: true, schema: interpreterResponseSchema }
    }
  };
  const cacheKey = createHash('sha256').update(JSON.stringify({ model: groqEnv.model, payload: payload.messages })).digest('hex');
  const cacheFile = path.join(cacheDir, cacheKey + '.json');
  if (fs.existsSync(cacheFile) && !args.has('--fresh'))
    return { interpreter: JSON.parse(fs.readFileSync(cacheFile, 'utf8')), source: 'cache' };
  let lastDetail = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + groqEnv.key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'UpstateIPVoice/1.0 (Practice Architect eval)'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000)
    });
    if (res.ok) {
      const body = await res.json();
      const interpreter = JSON.parse(body?.choices?.[0]?.message?.content || '{}');
      fs.writeFileSync(cacheFile, JSON.stringify(interpreter));
      return { interpreter, source: 'groq' };
    }
    lastDetail = await res.text();
    if (res.status === 429 || res.status >= 500) {
      const retry = /try again in ([\d.]+)\s*s/i.exec(lastDetail);
      await sleep(retry ? Math.min(20000, Number(retry[1]) * 1000) : 1500 * (attempt + 1));
      continue;
    }
    if (res.status === 400 && /json_validate_failed/i.test(lastDetail) && attempt === 0)
      continue;
    break;
  }
  return { interpreter: emptyInterpreter, source: 'fallback', error: lastDetail.slice(0, 240) };
}

async function runScenario(scenario, kind) {
  let plan = initial();
  let facts = {};
  let future = [];
  let unmapped = [];
  let follow = nextQuestion(plan, facts);
  let ack = '';
  let intent = 'provide_information';
  let groqCalls = 0;
  const started = applyStart(plan, facts, scenario.start);
  plan = started.plan;
  facts = started.facts;
  follow = nextQuestion(plan, facts);
  const failures = [];
  const history = [];
  const turns = [];
  for (let i = 0; i < scenario.turns.length; i++) {
    const turn = scenario.turns[i];
    const text = turn.owner;
    const context = {
      latest_user_message: text,
      current_question_id: follow?.id || null,
      current_question: follow ? { id: follow.id, text: follow.text } : null,
      canonical_field_registry: compactRegistry,
      currently_confirmed_field_values: confirmed(facts),
      relevant_recent_conversation_history: history.slice(-8),
      existing_unresolved_conflicts: {},
      current_date: '2026-11-09',
      timezone: 'America/New_York'
    };
    const groq = await groqInterpret(context);
    groqCalls += groq.source === 'groq' ? 1 : 0;
    const interpreter = {
      acknowledgement: groq.interpreter.acknowledgement || emptyInterpreter.acknowledgement,
      intent: groq.interpreter.intent || 'provide_information',
      updates: Array.isArray(groq.interpreter.updates) ? groq.interpreter.updates : [],
      unmapped_facts: Array.isArray(groq.interpreter.unmapped_facts) ? groq.interpreter.unmapped_facts : [],
      explanation_topic: groq.interpreter.explanation_topic ?? null
    };
    const turned = interpretTurn({ plan, facts, interpreter, userText: text, question: follow, future });
    plan = turned.plan;
    facts = turned.facts;
    future = turned.future;
    follow = turned.follow;
    ack = turned.ack;
    intent = turned.intent;
    unmapped = [...unmapped, ...(turned.unmapped || interpreter.unmapped_facts || [])];
    history.push({ role: 'user', content: text.slice(0, 400) });
    history.push({ role: 'assistant', content: ack.slice(0, 400) });
    turns.push({ owner: text, ack, intent, next: follow?.id || null, facts: confirmed(facts), groq: groq.source, error: groq.error || null });
    const after = (scenario.expectAfterTurn || []).find(row => row.turn === i);
    if (after)
        failures.push(...checkExpect(after, { plan, facts, follow, ack, intent, future, unmapped, kind }).map(m => `after turn ${i}: ${m}`));
    if (useGroq && groq.source === 'groq')
      await sleep(400);
  }
  failures.push(...checkExpect(scenario.expect, { plan, facts, follow, ack, intent, future, unmapped, kind }));
  const remaining = ownerQuestions(plan, facts);
  if ((follow == null) !== (remaining.length === 0))
    failures.push(`nextQuestion ${follow?.id || 'null'} vs ownerQuestions ${remaining.length}`);
  if (scenario.expect?.generateDraft && intent !== 'generate_draft' && !turns.some(t => t.intent === 'generate_draft'))
    failures.push('expected generate_draft');
  if (scenario.expect?.intent && scenario.expect.intentAnyTurn && !turns.some(t => t.intent === scenario.expect.intent) && intent !== scenario.expect.intent)
    failures.push(`intent ${scenario.expect.intent} never appeared`);
  const pdfText = JSON.stringify(plan) + JSON.stringify(ownerSections(plan)) + JSON.stringify(engineerSections(plan));
  if (scenario.expect?.pdf?.mustInclude)
    for (const needle of scenario.expect.pdf.mustInclude)
      if (!pdfText.toLowerCase().includes(String(needle).toLowerCase()))
        failures.push(`plan document missing ${needle}`);
  if (scenario.expect?.pdf?.mustNotInclude)
    for (const needle of scenario.expect.pdf.mustNotInclude)
      if (pdfText.toLowerCase().includes(String(needle).toLowerCase()))
        failures.push(`plan document contains ${needle}`);
  let pdfFiles = [];
  if (kind === 'full' && writePdf) {
    try {
      transpile('pdf');
      const { createPairedPDFs } = await import(path.join(buildDir, 'pdf.mjs'));
      const font = fs.readFileSync(path.join(root, 'planner/public/assets/InstrumentSans.ttf'));
      const logo = fs.readFileSync(path.join(root, 'planner/public/assets/upstate-logo.png'));
      const pair = await createPairedPDFs(plan, font, { logo });
      const dir = path.join(outDir, 'plans', scenario.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'owner.pdf'), pair.owner);
      fs.writeFileSync(path.join(dir, 'engineer.pdf'), pair.engineer);
      fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ plan, facts: confirmed(facts), future, unresolved: follow?.id || null }, null, 2));
      pdfFiles = ['owner.pdf', 'engineer.pdf'];
    }
    catch (err) {
      failures.push('pdf: ' + (err?.message || String(err)));
    }
  }
  return {
    id: scenario.id,
    title: scenario.title,
    kind,
    ok: failures.length === 0,
    failures,
    groqCalls,
    turns,
    facts: confirmed(facts),
    next: follow?.id || null,
    intent,
    ack,
    pdfFiles
  };
}

const selected = [];
if (suite !== 'full')
  selected.push(...shortScenarios.map(s => ({ ...s, kind: 'short' })));
if (suite !== 'short')
  selected.push(...fullScenarios.map(s => ({ ...s, kind: 'full' })));
if (suite !== 'short')
  selected.push(...dumpScenarios.map(s => ({ ...s, kind: 'dump' })));
const filtered = selected.filter(s => !idFilter || s.id === idFilter || s.id.startsWith(idFilter));
const work = limitArg ? filtered.slice(0, limitArg) : filtered;

console.log(`Practice Architect gold eval · ${work.length} conversations · Groq ${useGroq && groqEnv.present ? groqEnv.model : 'off (hints only)'}`);

const results = [];
for (const scenario of work) {
  const result = await runScenario(scenario, scenario.kind);
  results.push(result);
  const mark = result.ok ? 'PASS' : 'FAIL';
  console.log(`${mark} ${result.id}  ${result.title}${result.failures.length ? '\n  - ' + result.failures.join('\n  - ') : ''}`);
}

const passed = results.filter(r => r.ok).length;
const summary = {
  at: new Date().toISOString(),
  groq: useGroq && groqEnv.present,
  model: groqEnv.present ? groqEnv.model : null,
  passed,
  failed: results.length - passed,
  total: results.length,
  results: results.map(r => ({ id: r.id, ok: r.ok, failures: r.failures, next: r.next, facts: r.facts, groqCalls: r.groqCalls }))
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n${passed}/${results.length} passed. Details: planner/eval/results/summary.json`);
if (passed !== results.length)
  process.exitCode = 1;
