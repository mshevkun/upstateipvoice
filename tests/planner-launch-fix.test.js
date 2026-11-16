'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { prepareBuild } = require('./planner-transpile');

const { srcDir, outDir } = prepareBuild(path.basename(__filename, '.test.js'));

async function load() {
  const config = await import(path.join(outDir, 'config.mjs'));
  const flow = await import(path.join(outDir, 'flow.mjs'));
  const questions = await import(path.join(outDir, 'architect/questions.mjs'));
  const turn = await import(path.join(outDir, 'architect/turn.mjs'));
  const parse = await import(path.join(outDir, 'architect/parse.mjs'));
  const advisor = await import(path.join(outDir, 'advisor.mjs'));
  const fusion = await import(path.join(outDir, 'fusion.mjs'));
  const privacy = await import(path.join(outDir, 'privacy.mjs'));
  const readiness = await import(path.join(outDir, 'readiness.mjs'));
  return { ...config, ...flow, ...questions, ...turn, ...parse, ...advisor, ...fusion, ...privacy, ...readiness };
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
  while (follow && guard++ < 30) {
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
  assert.ok(ids.includes('devices.reception.kind'), 'asked ' + ids.join(','));
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

test('skip reception kind does not finish with empty inbound RG', async () => {
  const mod = await load();
  let plan = mod.initial();
  let facts = {};
  const r = mod.interpretTurn({
    plan, facts, interpreter: blank,
    userText: 'Existing dental. One receptionist. Front desk answers first. After hours voicemail. Weekdays 9 to 5.',
    question: null
  });
  plan = r.plan; facts = r.facts;
  let follow = r.follow;
  let guard = 0;
  let sawKind = false;
  while (follow && guard++ < 40) {
    if (follow.id === 'devices.reception.kind') {
      sawKind = true;
      assert.equal(follow.options.some(o => o.operation === 'skip'), false);
      const chip = follow.options.find(o => o.value === 'desk');
      const c = mod.chipTurn({ plan, facts, chip });
      plan = c.plan; facts = c.facts; follow = c.follow;
      continue;
    }
    const chip = follow.options.find(o => o.operation === 'set') || follow.options[0];
    const c = mod.chipTurn({ plan, facts, chip });
    plan = c.plan; facts = c.facts; follow = c.follow;
  }
  assert.equal(sawKind, true);
  const build = mod.fusionBuild(plan);
  assert.equal(build.blockers.some(b => /inbound ring group has no members/i.test(b)), false);
  assert.ok(plan.policy.placements.some(x => x.team === 'reception' && x.device !== 'undecided' && x.device !== 'none' && x.access === 'outside'));
});

test('clinical first-answer with internal-only stays unfinished until outside desk', async () => {
  const mod = await load();
  let plan = mod.initial();
  plan.mode = 'improving';
  plan.name = 'Solo Clinical';
  plan.specialty = 'Dental';
  plan.first = { kind: 'human', team: 'clinical' };
  plan.teams = plan.teams.map(t => t.role === 'clinical' ? { ...t, count: 1, status: 'known' } : t.role === 'reception' ? { ...t, count: 0, status: 'known' } : t.role === 'administration' ? { ...t, count: 0, status: 'known' } : t);
  plan.busy = { kind: 'message', seconds: 25, wait: 90, backup: '', owner: 'clinical' };
  plan.after = { kind: 'message', owner: 'clinical', instructions: '' };
  plan.policy.ring = 'together';
  plan.policy.languageDecision = 'none';
  plan.reasons = plan.reasons.map(r => ({ ...r, team: 'clinical' }));
  plan.hours.days = plan.hours.days.map((d, i) => ({ ...d, open: i < 5, start: i < 5 ? '09:00' : '', end: i < 5 ? '17:00' : '', stated: true }));
  plan.confirmed = ['hours'];
  let facts = {
    mode: { field_id: 'mode', value: 'improving', status: 'confirmed', evidence: 'x' },
    name: { field_id: 'name', value: 'Solo Clinical', status: 'confirmed', evidence: 'x' },
    specialty: { field_id: 'specialty', value: 'Dental', status: 'confirmed', evidence: 'x' },
    'first.kind': { field_id: 'first.kind', value: 'human', status: 'confirmed', evidence: 'x' },
    'teams.reception.count': { field_id: 'teams.reception.count', value: 0, status: 'confirmed', evidence: 'x' },
    'teams.clinical.count': { field_id: 'teams.clinical.count', value: 1, status: 'confirmed', evidence: 'x' },
    'teams.administration.count': { field_id: 'teams.administration.count', value: 0, status: 'confirmed', evidence: 'x' },
    'busy.kind': { field_id: 'busy.kind', value: 'message', status: 'confirmed', evidence: 'x' },
    'after.kind': { field_id: 'after.kind', value: 'message', status: 'confirmed', evidence: 'x' },
    'hours.preset': { field_id: 'hours.preset', value: 'weekdays', status: 'confirmed', evidence: 'x' },
    'hours.lunch': { field_id: 'hours.lunch', value: 'covered', status: 'confirmed', evidence: 'x' },
    'messages.owner': { field_id: 'messages.owner', value: 'clinical', status: 'confirmed', evidence: 'x' },
    'urgent.kind': { field_id: 'urgent.kind', value: 'none', status: 'confirmed', evidence: 'x' },
    'policy.rooms': { field_id: 'policy.rooms', value: 0, status: 'skipped', evidence: 'x' },
    'languages.decision': { field_id: 'languages.decision', value: 'none', status: 'confirmed', evidence: 'x' },
    'devices.work_mobile': { field_id: 'devices.work_mobile', value: 'none', status: 'confirmed', evidence: 'x' },
    'reasons.default_split': { field_id: 'reasons.default_split', value: true, status: 'confirmed', evidence: 'x' },
    'devices.clinical.area': { field_id: 'devices.clinical.area', value: 'none', status: 'skipped', evidence: 'skip' }
  };
  let q = mod.nextQuestion(plan, facts);
  let guard = 0;
  while (q && q.id !== 'devices.clinical.area' && guard++ < 12) {
    const chip = q.options.find(o => o.operation === 'set') || q.options[0];
    const step = mod.chipTurn({ plan, facts, chip });
    plan = step.plan; facts = step.facts; q = step.follow;
  }
  assert.equal(q?.id, 'devices.clinical.area');
  assert.equal(q.options.some(o => o.value === 'none' || o.operation === 'skip'), false);
  assert.ok(q.options.some(o => o.value === 'desk'));
  const c = mod.chipTurn({ plan, facts, chip: q.options.find(o => o.value === 'desk') });
  assert.ok(c.plan.policy.placements.some(x => x.team === 'clinical' && x.device === 'desk' && x.access === 'outside'));
  const hard = mod.fusionBuild(c.plan).blockers.filter(b => /inbound ring group has no members/i.test(b));
  assert.deepEqual(hard, []);
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

test('Other specialty asks specialtyDetail and softens the Other ack', async () => {
  const mod = await load();
  let plan = mod.initial();
  let facts = {};
  const mode = mod.chipTurn({
    plan,
    facts,
    chip: { id: 'opening', label: 'Opening a new practice', field_id: 'mode', value: 'opening', operation: 'set' }
  });
  plan = mode.plan;
  facts = mode.facts;
  const name = mod.chipTurn({
    plan,
    facts,
    chip: { id: 'skip', label: 'Skip for now', field_id: 'name', value: null, operation: 'skip' }
  });
  plan = name.plan;
  facts = name.facts;
  assert.equal(name.follow?.id, 'specialty');
  const other = mod.chipTurn({
    plan,
    facts,
    chip: { id: 'other', label: 'Other healthcare practice', field_id: 'specialty', value: 'Other healthcare practice', operation: 'set' }
  });
  plan = other.plan;
  facts = other.facts;
  assert.match(other.ack, /another kind of healthcare practice/i);
  assert.doesNotMatch(other.ack, /not a dental or eye-care room layout/i);
  assert.equal(other.follow?.id, 'specialtyDetail');
  const detail = mod.interpretTurn({
    plan,
    facts,
    interpreter: blank,
    userText: 'Family medicine',
    question: other.follow
  });
  assert.equal(detail.plan.specialty, 'Other healthcare practice');
  assert.equal(detail.plan.specialtyDetail, 'Family medicine');
  assert.match(detail.ack, /family medicine/i);
  assert.notEqual(detail.follow?.id, 'specialtyDetail');
});

test('adding second office: named practice stays; this-plan city wins over home', async () => {
  const mod = await load();
  const shared = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: blank,
    userText: "We already have Kingston Family Dental. We're adding a second office in New Paltz under the same number. Two receptionists at Kingston answer both. Front desk first. After hours voicemail.",
    question: null
  });
  assert.equal(shared.plan.mode, 'adding');
  assert.match(String(shared.plan.policy.cityState), /Kingston/i);
  assert.match(shared.plan.name, /Kingston Family Dental/i);
  assert.doesNotMatch(shared.plan.name, /^We already have/i);

  const focused = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: blank,
    userText: 'We have an eye care office in Albany, New York. I am adding one in Troy, New York. The plan I want is the Troy office.',
    question: null
  });
  assert.equal(focused.plan.mode, 'adding');
  assert.match(String(focused.plan.policy.cityState), /Troy/i);
});

test('after hours play hours and hang up is information, not voicemail', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: blank,
    userText: 'Opening Announce Only Eye Care in Hudson May 2027. Two front desk. Front desk first. After hours just play our hours and hang up — no voicemail. New number.',
    question: null
  });
  assert.equal(turned.plan.after.kind, 'information');
});

test('AnswerConnect after hours is a service, not a PMS and not the practice name', async () => {
  const mod = await load();
  const text = 'Bright Smiles Orthodontics in Albany. Three treatment coordinators answer. After hours we use AnswerConnect. Keep the published number. Two orthodontists.';
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: blank,
    userText: text,
    question: null
  });
  assert.equal(turned.plan.name, 'Bright Smiles Orthodontics');
  assert.equal(turned.plan.after.kind, 'service');
  assert.notEqual(turned.plan.policy.opening.pms, 'AnswerConnect');
  assert.doesNotMatch(turned.plan.name, /AnswerConnect/i);
});

test('city correction: actually New Paltz, not Kingston', async () => {
  const mod = await load();
  let plan = mod.initial();
  let facts = {};
  const first = mod.interpretTurn({
    plan,
    facts,
    interpreter: blank,
    userText: 'Opening a dental office in Kingston with three front desk people. Front desk answers first.',
    question: null
  });
  plan = first.plan;
  facts = first.facts;
  assert.match(String(plan.policy.cityState), /Kingston/i);
  assert.equal(plan.teams.find(t => t.role === 'reception')?.count, 3);
  const fix = mod.interpretTurn({
    plan,
    facts,
    interpreter: blank,
    userText: "Actually it's New Paltz, not Kingston, and only two receptionists. After hours voicemail.",
    question: first.follow
  });
  assert.match(String(fix.plan.policy.cityState), /New Paltz/i);
  assert.doesNotMatch(String(fix.plan.policy.cityState), /^Kingston/i);
  assert.equal(fix.plan.teams.find(t => t.role === 'reception')?.count, 2);
});

test('chip subjects stay honest without legalizing every line', async () => {
  const mod = await load();
  const stiff = Object.entries(mod.CHIP_SUBJECT).filter(([, line]) =>
    /still proposed|not a verified transfer|I will not invent|I did not add a lunch close|still a proposed contract/i.test(line)
  );
  assert.deepEqual(stiff, []);
  assert.match(mod.CHIP_SUBJECT['first.kind=assistant'], /confirm this before install/i);
  assert.match(mod.CHIP_SUBJECT['after.kind=service'], /confirm the contract before install/i);
});

test('owner conversation complete leaves install leftovers in stillOpen', async () => {
  const mod = await load();
  let plan = mod.initial();
  let facts = {};
  const seed = mod.interpretTurn({
    plan, facts, interpreter: blank,
    userText: 'Existing dental in Albany. Albany Smile. One receptionist. Front desk answers first. After hours voicemail. Weekdays nine to five. No lunch close. Desk phone. English only. No urgent path.',
    question: null
  });
  plan = seed.plan;
  facts = seed.facts;
  let follow = seed.follow;
  let guard = 0;
  while (follow && guard++ < 40) {
    const chip = follow.options.find(o => o.operation === 'set') || follow.options[0];
    const step = mod.chipTurn({ plan, facts, chip });
    plan = step.plan;
    facts = step.facts;
    follow = step.follow;
  }
  assert.equal(follow, null);
  assert.equal(mod.ownerConversationComplete(plan, facts), true);
  assert.equal(mod.blueprintReadyForOwner(plan, facts), true);
  const open = mod.stillOpen(plan);
  assert.ok(open.some(x => /E911/i.test(x)));
  assert.match(mod.walkthroughLeftoversNote(plan), /At your walkthrough we’ll still confirm/i);
  assert.doesNotMatch(mod.walkthroughLeftoversNote(plan), /Still open at install/i);
});

test('free text answers the active follow without requiring a chip', async () => {
  const mod = await load();
  const mode = mod.chipTurn({
    plan: mod.initial(),
    facts: {},
    chip: { id: 'opening', label: 'Opening a new practice', field_id: 'mode', value: 'opening', operation: 'set' }
  });
  assert.equal(mode.follow?.id, 'name');
  const typed = mod.interpretTurn({
    plan: mode.plan,
    facts: mode.facts,
    interpreter: blank,
    userText: 'Call it Chen Family Dental.',
    question: mode.follow
  });
  assert.match(typed.ack, /Chen Family Dental/i);
  assert.equal(typed.plan.name.trim(), 'Chen Family Dental');
  assert.notEqual(typed.follow?.id || null, 'name');
});

test('chat catalog never asks install-only leftovers', async () => {
  const mod = await load();
  const ids = mod.ownerQuestionCatalog(mod.initial(), {}).map(q => q.id);
  for (const bad of ['e911', 'e911Confirmed', 'followMe', 'site.survey', 'opening.internet', 'continuity.power'])
    assert.equal(ids.includes(bad), false, bad);
  assert.ok(ids.includes('devices.reception.kind'));
});

test('ArchitectChat talk-first and walkthrough draft framing', async () => {
  const ui = fs.readFileSync(path.join(srcDir, 'ArchitectChat.tsx'), 'utf8');
  assert.match(ui, /Tell me in your own words/);
  assert.match(ui, /Here's your practice blueprint/);
  assert.match(ui, /Book a walkthrough/);
  assert.match(ui, /walkthroughLeftoversNote|At your walkthrough/);
  assert.match(ui, /Handled at your walkthrough \/ install/);
  assert.doesNotMatch(ui, /Still open at install/);
  assert.doesNotMatch(ui, /disabled=\{interacting \|\| !input\.trim\(\)\}/);
  assert.match(ui, /if \(!trimmed \|\| busy \|\| typing\)/);
});
