'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const srcDir = path.join(__dirname, '../planner/src');
const outDir = path.join(__dirname, '../planner/.test-build');
fs.mkdirSync(path.join(outDir, 'architect'), { recursive: true });

function transpile(rel) {
  let out = ts.transpile(fs.readFileSync(path.join(srcDir, rel + '.ts'), 'utf8'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  });
  out = out.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, "from '$1.mjs'");
  const dest = path.join(outDir, rel + '.mjs');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
}

for (const name of ['config', 'policy', 'locations', 'routing', 'flow', 'team-state', 'state', 'architect/schema', 'architect/fields', 'architect/parse', 'architect/extract', 'architect/ack', 'architect/merge', 'architect/questions', 'architect/turn', 'provisioning', 'advisor', 'fusion', 'privacy'])
  transpile(name);

async function load() {
  const config = await import(path.join(outDir, 'config.mjs'));
  const flow = await import(path.join(outDir, 'flow.mjs'));
  const questions = await import(path.join(outDir, 'architect/questions.mjs'));
  const turn = await import(path.join(outDir, 'architect/turn.mjs'));
  const parse = await import(path.join(outDir, 'architect/parse.mjs'));
  const advisor = await import(path.join(outDir, 'advisor.mjs'));
  const fusion = await import(path.join(outDir, 'fusion.mjs'));
  const privacy = await import(path.join(outDir, 'privacy.mjs'));
  return { ...config, ...flow, ...questions, ...turn, ...parse, ...advisor, ...fusion, ...privacy };
}

const blank = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };

test('blank plan does not invent Monday–Friday 9–5', async () => {
  const mod = await load();
  const p = mod.initial();
  assert.equal(p.policy.hoursPreset, 'undecided');
  assert.equal(p.hours.days.every(d => !d.open && !d.start), true);
  assert.equal(mod.hoursSummary(p), 'Hours not given yet');
  assert.equal(mod.nextQuestion(p, {}).id, 'mode');
});

test('Buffalo Monday–Thursday does not fill Friday 9–5', async () => {
  const mod = await load();
  const r = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: blank,
    userText: '8 to 4 Monday to Thursday. Closed weekends.',
    question: null
  });
  const fri = r.plan.hours.days.find(d => d.day === 'Friday');
  const mon = r.plan.hours.days.find(d => d.day === 'Monday');
  assert.equal(mon.start, '08:00');
  assert.equal(mon.end, '16:00');
  assert.equal(fri.open && fri.start === '09:00', false);
  assert.ok(mod.ownerQuestions(r.plan, r.facts).some(q => q.id === 'hours.rest_closed'));
});

test('one receptionist gets a front-desk identity and the kind question', async () => {
  const mod = await load();
  let plan = mod.initial();
  let facts = {};
  const r = mod.interpretTurn({
    plan, facts, interpreter: blank,
    userText: 'Existing dental office. One receptionist. Front desk answers first. After hours voicemail.',
    question: null
  });
  plan = r.plan; facts = r.facts;
  assert.equal(plan.teams.find(t => t.role === 'reception').count, 1);
  assert.ok(plan.policy.placements.some(x => x.team === 'reception' && x.count >= 1));
  const ids = [];
  let follow = r.follow;
  let guard = 0;
  while (follow && guard++ < 12) {
    ids.push(follow.id);
    if (follow.id === 'devices.reception.kind') {
      const chip = follow.options.find(o => o.value === 'desk');
      const c = mod.chipTurn({ plan, facts, chip });
      plan = c.plan; facts = c.facts; follow = c.follow;
      break;
    }
    const chip = follow.options.find(o => o.operation === 'set') || follow.options[0];
    const c = mod.chipTurn({ plan, facts, chip });
    plan = c.plan; facts = c.facts; follow = c.follow;
  }
  assert.ok(ids.includes('devices.reception.kind'));
  const build = mod.fusionBuild(plan);
  const inbound = build.objects.find(o => o.kind === 'ring_group' && o.extension === '7000');
  assert.ok(inbound);
  assert.doesNotMatch(inbound.setup.join(' '), /no members/);
});

test('practice name is asked and AnswerConnect is not the name', async () => {
  const mod = await load();
  const named = mod.parsePracticeName('We are Bright Smiles Orthodontics. After hours we use an answering service called AnswerConnect.');
  assert.equal(named[0].value, 'Bright Smiles Orthodontics');
  assert.equal(named.some(h => /answerconnect/i.test(String(h.value))), false);
  const kingston = mod.parsePracticeName('Kingston Eye Associates, existing optometry office. Yesterday patient John Smith called about his glasses and nobody answered.');
  assert.equal(kingston[0].value, 'Kingston Eye Associates');
  const p = { ...mod.initial(), mode: 'opening' };
  assert.equal(mod.nextQuestion(p, {}).id, 'name');
});

test('no lunch close is not a 12–1 lunch', async () => {
  const mod = await load();
  const lunch = mod.parseLunch('Closed Sunday. No lunch close.');
  assert.equal(lunch.find(h => h.field_id === 'hours.lunch').value, 'covered');
  assert.equal(lunch.some(h => /break_start/.test(h.field_id) && h.value), false);
});

test('Spanish would be nice but unstaffed is English only', async () => {
  const mod = await load();
  const langs = mod.parseLanguages('Spanish would be nice but we do not have anyone who speaks it.');
  assert.equal(langs.find(h => h.field_id === 'languages.decision').value, 'none');
  assert.equal(langs.some(h => h.field_id === 'languages.spanish'), false);
});

test('reasons.routing is one chip and does not repeat', async () => {
  const mod = await load();
  let plan = mod.initial();
  let facts = {};
  const staffed = mod.interpretTurn({
    plan, facts, interpreter: blank,
    userText: 'Dental office. Two receptionists, one office manager, two dentists. Front desk answers first.',
    question: null
  });
  plan = staffed.plan; facts = staffed.facts;
  let follow = staffed.follow;
  let guard = 0;
  const seen = [];
  while (follow && guard++ < 16) {
    seen.push(follow.id);
    if (follow.id === 'reasons.routing') {
      assert.ok(follow.options.some(o => o.field_id === 'reasons.default_split'));
      const chip = follow.options.find(o => o.field_id === 'reasons.default_split');
      const c = mod.chipTurn({ plan, facts, chip });
      assert.notEqual(c.follow?.id, 'reasons.routing');
      assert.ok(c.plan.reasons.every(r => r.team));
      assert.doesNotMatch(c.ack, /^Noted:/);
      return;
    }
    const chip = follow.options.find(o => o.operation === 'set') || follow.options[0];
    const c = mod.chipTurn({ plan, facts, chip });
    plan = c.plan; facts = c.facts; follow = c.follow;
  }
  assert.fail('never asked reasons.routing: ' + seen.join(','));
});

test('lock stays outside fingerprint', async () => {
  const mod = await load();
  const p = mod.initial();
  const before = mod.fingerprint(p);
  const locked = { ...p, lock: { revision: 3, checksum: before, at: '2026-11-13T00:00:00.000Z' } };
  assert.equal(mod.fingerprint(locked), before);
  assert.equal(mod.isLocked(locked), true);
  const confirmed = { ...p, confirmed: [...p.confirmed, 'locked'] };
  assert.notEqual(mod.fingerprint(confirmed), before);
});

test('separate voicemail boxes and overflow is the work mobile', async () => {
  const mod = await load();
  let plan = mod.initial();
  plan.name = 'Chen Family Dental';
  plan.mode = 'opening';
  plan.specialty = 'Dental';
  plan.teams = plan.teams.map(t => t.role === 'reception' ? { ...t, count: 2, status: 'known' } : t.role === 'administration' ? { ...t, count: 1, status: 'known' } : { ...t, count: 2, status: 'known' });
  plan.first = { kind: 'human', team: 'reception' };
  plan.busy = { kind: 'backup', seconds: 25, wait: 90, backup: 'admin', owner: 'reception' };
  plan.after = { kind: 'message', owner: 'reception', instructions: '' };
  plan.hours.days = plan.hours.days.map((d, i) => ({ ...d, open: i < 5, start: i < 5 ? '08:00' : '', end: i < 4 ? '17:00' : i === 4 ? '14:00' : '', breakStart: i < 4 ? '12:30' : '', breakEnd: i < 4 ? '13:30' : '', stated: true }));
  plan.policy.placements = [
    { id: 'reception-desk', team: 'reception', label: 'Front desk', device: 'desk', count: 2, access: 'outside', sharing: 'separate', extension: '' },
    { id: 'admin-computer', team: 'admin', label: 'Administration', device: 'computer', count: 1, access: 'outside', sharing: 'shared', extension: '' },
    { id: 'admin-mobile', team: 'admin', label: 'Administration', device: 'mobile', count: 1, access: 'outside', sharing: 'shared', extension: '' }
  ];
  plan.policy.ring = 'together';
  const build = mod.fusionBuild(plan);
  const boxes = {};
  for (const rec of build.recordings) {
    const m = /box (\d+)/.exec(rec.usedBy || '') || /\*99(\d+)/.exec(rec.usedBy || '');
    if (m)
      (boxes[m[1]] ||= []).push(rec.filename);
  }
  for (const [box, files] of Object.entries(boxes))
    assert.equal(files.length, 1, 'shared mailbox ' + box + ': ' + files.join(', '));
  const overflow = build.objects.find(o => o.kind === 'ring_group' && o.extension === '7001');
  assert.ok(overflow);
  assert.match(overflow.setup.join(' '), /mobile/);
  assert.doesNotMatch(overflow.setup.join(' '), /computer/);
});

test('privacy copy is anyone-with-the-link', async () => {
  const mod = await load();
  assert.match(mod.PRIVACY_COPY, /Anyone with the link can open it/);
  assert.doesNotMatch(mod.PRIVACY_COPY, /only you and Upstate/);
});

test('every catalog chip has a subject ack, never Noted', async () => {
  const mod = await load();
  const missing = [];
  for (const q of mod.ownerQuestionCatalog(mod.initial(), {})) {
    for (const chip of q.options.filter(o => o.operation === 'set')) {
      const key = chip.field_id + '=' + String(chip.value);
      if (!mod.CHIP_SUBJECT[key])
        missing.push(q.id + ' ' + key);
    }
  }
  assert.deepEqual(missing, []);
});
