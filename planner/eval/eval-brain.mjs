/**
 * Shared transpile + interpret helpers for planner eval batteries.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'planner/src');
const buildDir = path.join(root, 'planner/.eval-brain-build');
const cacheDir = path.join(root, 'planner/eval/results/cache');

const ARCH_MODULES = [
  'config', 'policy', 'locations', 'routing', 'flow', 'team-state', 'state',
  'architect/schema', 'architect/fields', 'architect/clauses', 'architect/parse', 'architect/extract', 'architect/ack',
  'architect/merge', 'architect/questions', 'architect/turn', 'architect/scene-from-plan',
  'architect/prompt', 'architect/hear', 'architect/scrub',
  'provisioning', 'bom', 'opening', 'status', 'readiness', 'advisor', 'privacy'
];

export function ensureBrainBuild() {
  fs.mkdirSync(path.join(buildDir, 'architect'), { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  function transpile(rel) {
    const srcPath = path.join(srcDir, rel + '.ts');
    if (!fs.existsSync(srcPath))
      return;
    let out = ts.transpile(fs.readFileSync(srcPath, 'utf8'), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext
    });
    out = out.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, "from '$1.mjs'");
    const dest = path.join(buildDir, rel + '.mjs');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, out);
  }
  for (const name of ARCH_MODULES)
    transpile(name);
  return buildDir;
}

let brainPromise;
export async function loadBrain() {
  if (!brainPromise) {
    ensureBrainBuild();
    const dir = buildDir;
    const { initial } = await import(path.join(dir, 'config.mjs'));
    const { interpretTurn, chipTurn } = await import(path.join(dir, 'architect/turn.mjs'));
    const { updatesFromOwnerText } = await import(path.join(dir, 'architect/extract.mjs'));
    const { nextQuestion } = await import(path.join(dir, 'architect/questions.mjs'));
    const { INTERPRETER_SYSTEM_PROMPT } = await import(path.join(dir, 'architect/prompt.mjs'));
    const { interpreterResponseSchema } = await import(path.join(dir, 'architect/schema.mjs'));
    const { relevantCatalog } = await import(path.join(dir, 'architect/fields.mjs'));
    const { scrubPii } = await import(path.join(dir, 'architect/scrub.mjs'));
    const { hoursSummary } = await import(path.join(dir, 'flow.mjs'));
    brainPromise = {
      initial, interpretTurn, chipTurn, updatesFromOwnerText, nextQuestion,
      INTERPRETER_SYSTEM_PROMPT, interpreterResponseSchema, relevantCatalog, scrubPii, hoursSummary, buildDir: dir
    };
  }
  return brainPromise;
}

export const blankInterpreter = {
  acknowledgement: '',
  intent: 'provide_information',
  updates: [],
  unmapped_facts: [],
  explanation_topic: null
};

export function confirmedFacts(facts) {
  const out = {};
  for (const [id, fact] of Object.entries(facts))
    if (fact?.status === 'confirmed')
      out[id] = fact.value;
  return out;
}

export function playTurns(brain, turns) {
  let plan = brain.initial();
  let facts = {};
  let follow = null;
  let ack = '';
  for (const turn of turns) {
    if (turn && typeof turn === 'object' && turn.chip) {
      const chip = (follow?.options || []).find(o => o.value === turn.chip || o.id === turn.chip)
        || { id: turn.chip, label: turn.chip, field_id: turn.field_id || 'urgent.scope', value: turn.chip, operation: 'set' };
      const step = brain.chipTurn({ plan, facts, chip });
      plan = step.plan; facts = step.facts; follow = step.follow; ack = step.ack || ack;
      continue;
    }
    const step = brain.interpretTurn({ plan, facts, interpreter: blankInterpreter, userText: turn, question: follow });
    plan = step.plan; facts = step.facts; follow = step.follow; ack = step.ack;
  }
  return { plan, facts, follow, ack };
}

export function loadGroqEnv() {
  const files = [
    '/Users/andriizorin/Documents/upstateipv/sms-portal/api/.env',
    path.join(root, '.env')
  ];
  let key = process.env.GROQ_API_KEY || process.env.GROQ_PLANNER_API_KEY || '';
  let model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
  for (const file of files) {
    if (!fs.existsSync(file))
      continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      const k = /^GROQ_PLANNER_API_KEY=(.+)/.exec(line)?.[1]?.trim().replace(/^["']|["']$/g, '');
      const g = /^GROQ_API_KEY=(.+)/.exec(line)?.[1]?.trim().replace(/^["']|["']$/g, '');
      const m = /^GROQ_MODEL=(.+)/.exec(line)?.[1]?.trim().replace(/^["']|["']$/g, '');
      if (k)
        key = k;
      else if (g && !key)
        key = g;
      if (m)
        model = m;
    }
  }
  return { key, model, present: /^gsk_/.test(key) };
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function groqInterpret(brain, context, { fresh = false } = {}) {
  const groqEnv = loadGroqEnv();
  if (!groqEnv.present)
    return { interpreter: blankInterpreter, source: 'missing-key' };
  const payload = {
    model: groqEnv.model,
    temperature: 0,
    stream: false,
    messages: [
      { role: 'system', content: brain.INTERPRETER_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(context) }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'practice_interpreter_v1', strict: true, schema: brain.interpreterResponseSchema }
    },
    reasoning_effort: 'low',
    max_completion_tokens: 1200,
    max_tokens: 1200
  };
  const cacheKey = createHash('sha256').update(JSON.stringify({ model: groqEnv.model, payload: payload.messages })).digest('hex');
  const cacheFile = path.join(cacheDir, cacheKey + '.json');
  if (fs.existsSync(cacheFile) && !fresh)
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
    break;
  }
  return { interpreter: blankInterpreter, source: 'fallback', error: lastDetail.slice(0, 240) };
}

/** Local-only, Groq-only (no hints), and merged production path for one turn. */
export async function interpretPaths(brain, { plan, facts, userText, question, history = [] }) {
  const localOnly = playTurns(brain, [userText]);
  const hinted = brain.updatesFromOwnerText(userText, question, facts);
  const groqOnlyPlan = brain.initial();
  const groqOnlyFacts = {};
  let groqInterpreter = blankInterpreter;
  let groqSource = 'skipped';
  const context = {
    latest_user_message: userText,
    current_question_id: question?.id || null,
    current_question: question ? { id: question.id, text: question.text } : null,
    canonical_field_registry: brain.relevantCatalog(question?.id, []),
    currently_confirmed_field_values: confirmedFacts(facts),
    relevant_recent_conversation_history: history.slice(-8),
    existing_unresolved_conflicts: {},
    current_date: '2026-11-16',
    timezone: 'America/New_York'
  };
  const groq = await groqInterpret(brain, context);
  groqSource = groq.source;
  if (groq.interpreter?.updates?.length) {
    groqInterpreter = {
      acknowledgement: groq.interpreter.acknowledgement || '',
      intent: groq.interpreter.intent || 'provide_information',
      updates: groq.interpreter.updates || [],
      unmapped_facts: groq.interpreter.unmapped_facts || [],
      explanation_topic: groq.interpreter.explanation_topic ?? null
    };
    const groqTurn = brain.interpretTurn({
      plan: groqOnlyPlan,
      facts: groqOnlyFacts,
      interpreter: { ...groqInterpreter, updates: groq.interpreter.updates },
      userText,
      question
    });
    Object.assign(localOnly, { groqOnly: { plan: groqTurn.plan, facts: groqTurn.facts } });
  }
  const merged = brain.interpretTurn({
    plan,
    facts,
    interpreter: groq.interpreter?.updates?.length ? groqInterpreter : blankInterpreter,
    userText,
    question
  });
  return {
    local: localOnly,
    groq: groqOnlyPlan,
    merged: { plan: merged.plan, facts: merged.facts, ack: merged.ack },
    groqSource,
    hintedCount: hinted.length
  };
}

export async function playTurnsAsync(brain, turns, { groq = false } = {}) {
  let plan = brain.initial();
  let facts = {};
  let follow = brain.nextQuestion(plan, facts);
  let ack = '';
  const history = [];
  const track = { local: null, merged: null, groqCalls: 0 };
  for (const turn of turns) {
    if (typeof turn !== 'string') {
      if (turn?.chip) {
        const chip = (follow?.options || []).find(o => o.value === turn.chip || o.id === turn.chip)
          || { id: turn.chip, label: turn.chip, field_id: turn.field_id || 'urgent.scope', value: turn.chip, operation: 'set' };
        const step = brain.chipTurn({ plan, facts, chip });
        plan = step.plan; facts = step.facts; follow = step.follow; ack = step.ack || ack;
      }
      continue;
    }
    if (!groq) {
      const step = brain.interpretTurn({ plan, facts, interpreter: blankInterpreter, userText: turn, question: follow });
      plan = step.plan; facts = step.facts; follow = step.follow; ack = step.ack;
      history.push({ role: 'user', content: turn.slice(0, 400) });
      history.push({ role: 'assistant', content: (step.ack || '').slice(0, 400) });
      continue;
    }
    const context = {
      latest_user_message: turn,
      current_question_id: follow?.id || null,
      current_question: follow ? { id: follow.id, text: follow.text } : null,
      canonical_field_registry: brain.relevantCatalog(follow?.id, Object.entries(facts).filter(([, f]) => f?.status !== 'confirmed').map(([id]) => id)),
      currently_confirmed_field_values: confirmedFacts(facts),
      relevant_recent_conversation_history: history.slice(-8),
      existing_unresolved_conflicts: {},
      current_date: '2026-11-16',
      timezone: 'America/New_York'
    };
    const groqRes = await groqInterpret(brain, context);
    if (groqRes.source === 'groq' || groqRes.source === 'cache')
      track.groqCalls++;
    const interpreter = groqRes.interpreter?.updates?.length ? {
      acknowledgement: groqRes.interpreter.acknowledgement || '',
      intent: groqRes.interpreter.intent || 'provide_information',
      updates: groqRes.interpreter.updates,
      unmapped_facts: groqRes.interpreter.unmapped_facts || [],
      explanation_topic: groqRes.interpreter.explanation_topic ?? null
    } : blankInterpreter;
    const localStep = brain.interpretTurn({ plan, facts, interpreter: blankInterpreter, userText: turn, question: follow });
    track.local = { plan: localStep.plan, facts: localStep.facts };
    const step = brain.interpretTurn({ plan, facts, interpreter, userText: turn, question: follow });
    plan = step.plan; facts = step.facts; follow = step.follow; ack = step.ack;
    track.merged = { plan: step.plan, facts: step.facts };
    history.push({ role: 'user', content: turn.slice(0, 400) });
    history.push({ role: 'assistant', content: (step.ack || '').slice(0, 400) });
    await sleep(350);
  }
  return { plan, facts, follow, ack, track };
}