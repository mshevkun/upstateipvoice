#!/usr/bin/env node
/**
 * 20 live owner-brain walks focused on Rivertown-class failures:
 * wrong "new practice" ack, no-on-call → clinician path, re-ask mode.
 * Uses local interpretTurn (same code we deploy). Optional --live checks Pages bundle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'planner/src');
const buildDir = path.join(root, 'planner/.live20-build');
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
  'readiness', 'advisor', 'privacy'
])
  transpile(name);

const { initial } = await import(path.join(buildDir, 'config.mjs'));
const { interpretTurn, chipTurn } = await import(path.join(buildDir, 'architect/turn.mjs'));
const { hoursSummary } = await import(path.join(buildDir, 'flow.mjs'));

const blank = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };

const CASES = [
  {
    id: 'R01-rivertown',
    turns: ["We're Rivertown Family Eye in Beacon. We've been open for years and we're replacing our old phone system. Two people at the front desk, one office manager, three doctors. Patients should always get a real person during the day — I hate phone menus. We close for lunch. After hours just take a message, no on-call."],
    expect: (p, _a, f) => p.mode === 'improving' && p.specialty === 'Eye care' && p.policy.urgentKind === 'none' && !p.policy.pendingClinicianRoute && p.first.kind === 'human' && p.after.kind === 'message' && f !== 'specialty' && f !== 'hours.rest_closed'
  },
  {
    id: 'R02-ack-not-new',
    turns: ['Hudson Vision in Kingston. Been open for years. Replacing phones. Front desk answers. After hours voicemail, no on-call.'],
    expect: (p, a) => p.mode === 'improving' && !/^A new /i.test(a) && /existing/i.test(a)
  },
  {
    id: 'R03-no-urgent-scope-chip',
    turns: ['Existing dental in Troy. After hours just take a message, no on-call. Person at the front during the day.'],
    expect: (p, _a, f) => p.policy.urgentKind === 'none' && f !== 'urgent.scope' && f !== 'mode'
  },
  {
    id: 'R04-replacing-phones',
    turns: ['We are replacing our old phone system at an existing practice in Newburgh.'],
    expect: p => p.mode === 'improving'
  },
  {
    id: 'R05-open-for-years',
    turns: ["We've been open for years in Middletown. Same dental office."],
    expect: p => p.mode === 'improving'
  },
  {
    id: 'R06-hate-menus-not-menu',
    turns: ['I hate phone menus. A real person during the day. Existing office in Albany.'],
    expect: p => p.first.kind === 'human' && p.mode === 'improving'
  },
  {
    id: 'R07-true-ambiguous-still-asks',
    turns: ['During open hours they should go to the doctor clinicians phone and when closed connect the on-call.'],
    expect: (p, _a, f) => p.policy.pendingClinicianRoute === true && f === 'urgent.scope'
  },
  {
    id: 'R08-urgent-only-chip',
    turns: [
      'During open hours calls go to the doctor, after hours the on-call person.',
      { chip: 'urgent_only' }
    ],
    expect: p => p.policy.urgentScope === 'urgent_only' && p.first.team === 'reception' && p.policy.urgentKind === 'connect'
  },
  {
    id: 'R09-all-calls-with-desk-stays-desk',
    turns: [
      'Existing eye office. Front desk answers first. After hours take a message. No on-call.',
      // If scope somehow offered, desk + none must not flip to clinical
    ],
    expect: p => p.first.kind === 'human' && (p.first.team === 'reception' || p.first.team === '') && p.policy.urgentKind === 'none' && !p.policy.pendingClinicianRoute
  },
  {
    id: 'R10-opening-still-opening',
    turns: ["I'm opening a new dental practice in Poughkeepsie next March."],
    expect: p => p.mode === 'opening'
  },
  {
    id: 'R11-during-day-plus-no-oncall',
    turns: ['Patients should get a real person during the day. After hours take a message, no on-call. Existing Beacon practice.'],
    expect: p => p.policy.urgentKind === 'none' && !p.policy.pendingClinicianRoute && p.mode === 'improving'
  },
  {
    id: 'R12-nobody-on-call',
    turns: ['Existing practice. Nobody on call. Just voicemail after hours.'],
    expect: p => p.policy.urgentKind === 'none' && p.after.kind === 'message'
  },
  {
    id: 'R13-dont-want-oncall',
    turns: ["We don't want on-call. After hours leave a message. Improving our phones in Catskill."],
    expect: p => p.policy.urgentKind === 'none' && p.mode === 'improving'
  },
  {
    id: 'R14-two-front-existing',
    turns: ['Two people at the front desk at our existing office in Saugerties. Hate menus.'],
    expect: p => p.mode === 'improving' && p.teams.find(t => t.role === 'reception')?.count === 2 && p.first.kind === 'human'
  },
  {
    id: 'R15-lunch-closed-existing',
    turns: ['Existing Kingston dental. We close for lunch. Front desk first. No on-call after hours — just take a message.'],
    expect: (p, a, f) => p.mode === 'improving' && p.policy.urgentKind === 'none' && /lunch/i.test(a) && f !== 'hours.rest_closed' && !p.hours.days.every(d => d.stated)
  },
  {
    id: 'R16-mode-not-reasked',
    turns: ["Been open for years in Beacon. Replacing phones. Name is Rivertown Family Eye."],
    expect: (p, _a, f) => p.mode === 'improving' && f !== 'mode'
  },
  {
    id: 'R17-connect-still-works',
    turns: ['Opening dental. After hours connect the on-call for emergencies only.'],
    expect: p => p.policy.urgentKind === 'connect' || p.policy.urgentScope === 'urgent_only' || p.policy.pendingClinicianRoute
  },
  {
    id: 'R18-adding-not-improving',
    turns: ['We already have one office in Kingston. We are adding a second location in Beacon.'],
    expect: p => p.mode === 'adding'
  },
  {
    id: 'R19-ack-existing-named',
    turns: ['Rivertown Family Eye in Beacon. Open for years. Replacing our old phone system.'],
    expect: (p, a) => p.specialty === 'Eye care' && /existing/i.test(a) && !/a new /i.test(a)
  },
  {
    id: 'R20-chip-every-call-denied-path',
    setup: (mod) => {
      const first = interpretTurn({
        plan: initial(),
        facts: {},
        interpreter: blank,
        userText: 'Existing practice. Front desk answers. After hours take a message, no on-call.',
        question: null
      });
      // Force a stale urgent.scope chip as if UI lagged — apply must not invent clinician-first.
      const chip = { id: 'all_calls', label: 'Every call', field_id: 'urgent.scope', value: 'all_calls', operation: 'set' };
      return chipTurn({ plan: first.plan, facts: first.facts, chip });
    },
    expect: p => p.first.team !== 'clinical' && p.policy.urgentKind === 'none'
  }
];

const EXTRA = [
  {
    id: 'X01-lunch-before-hours-not-closed-week',
    turns: ['Existing Beacon eye office. We close for lunch from 12 to 1.'],
    expect: (p, _a, f) => {
      const summary = hoursSummary(p);
      const lunchStated = p.hours.days.some(d => d.breakStart && d.stated);
      return !lunchStated
        && !/Closed all week/i.test(summary)
        && (f === 'hours.preset' || f === 'name' || f === 'teams.reception.count' || f === 'first.kind' || !f || f !== 'hours.rest_closed')
        && f !== 'hours.rest_closed'
        && !p.hours.days.some(d => d.stated && !(d.start && d.end) && (d.breakStart || d.breakEnd));
    }
  },
  {
    id: 'X02-family-eye-specialty',
    turns: ["We're Rivertown Family Eye in Beacon."],
    expect: (p, _a, f) => p.specialty === 'Eye care' && f !== 'specialty'
  },
  {
    id: 'X03-rooms-not-after-clinical-none',
    setup: () => {
      let plan = initial();
      let facts = {};
      let follow = null;
      const first = interpretTurn({
        plan, facts, interpreter: blank,
        userText: 'Existing dental in Troy. Two front desk. Two doctors. Front desk answers first. After hours voicemail, no on-call. Monday through Friday 9 to 5.',
        question: null
      });
      plan = first.plan; facts = first.facts; follow = first.follow;
      let guard = 0;
      while (follow && follow.id !== 'devices.clinical.area' && guard++ < 40) {
        const chip = follow.options.find(o => o.operation === 'set') || follow.options.find(o => o.operation === 'skip');
        if (!chip) break;
        const step = chipTurn({ plan, facts, chip });
        plan = step.plan; facts = step.facts; follow = step.follow;
      }
      if (follow?.id === 'devices.clinical.area') {
        const none = follow.options.find(o => o.value === 'none');
        const step = chipTurn({ plan, facts, chip: none });
        plan = step.plan; facts = step.facts; follow = step.follow;
      }
      return { plan, facts, follow, ack: '' };
    },
    expect: (_p, _a, f) => f !== 'policy.rooms'
  }
];

function runCase(mod, c) {
  if (c.setup) {
    const step = c.setup(mod);
    const ok = c.expect(step.plan, step.ack || '', step.follow?.id);
    return { id: c.id, ok, detail: { mode: step.plan.mode, urgent: step.plan.policy.urgentKind, pending: step.plan.policy.pendingClinicianRoute, first: step.plan.first, follow: step.follow?.id, ack: step.ack } };
  }
  let plan = initial();
  let facts = {};
  let follow = null;
  let ack = '';
  for (const turn of c.turns) {
    if (turn && typeof turn === 'object' && turn.chip) {
      const chip = (follow?.options || []).find(o => o.value === turn.chip || o.id === turn.chip)
        || { id: turn.chip, label: turn.chip, field_id: 'urgent.scope', value: turn.chip, operation: 'set' };
      const step = chipTurn({ plan, facts, chip });
      plan = step.plan;
      facts = step.facts;
      follow = step.follow;
      ack = step.ack || ack;
      continue;
    }
    const step = interpretTurn({ plan, facts, interpreter: blank, userText: turn, question: follow });
    plan = step.plan;
    facts = step.facts;
    follow = step.follow;
    ack = step.ack;
  }
  const ok = c.expect(plan, ack, follow?.id);
  return { id: c.id, ok, detail: { mode: plan.mode, urgent: plan.policy.urgentKind, pending: plan.policy.pendingClinicianRoute, first: plan.first, after: plan.after.kind, follow: follow?.id, ack } };
}

const results = [...CASES, ...EXTRA].map(c => runCase({ interpretTurn, chipTurn }, c));
const failed = results.filter(r => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed: failed.map(f => ({ id: f.id, detail: f.detail })) }, null, 2));
if (failed.length)
  process.exit(1);

if (process.argv.includes('--live')) {
  const html = await fetch('https://upstateipvoice.com/planner/?v=' + Date.now()).then(r => r.text());
  const bundle = (html.match(/dev-[A-Za-z0-9_-]+\.js/) || [])[0] || '';
  console.log(JSON.stringify({ livePlannerBundle: bundle, liveOk: !!bundle }, null, 2));
}
