'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { prepareBuild } = require('./planner-transpile');
const { CONVERSATION, STATED_FIELDS, ACK_NEEDLES, CHIP_ANSWERS, STILL_OPEN_GOLD, CHEN_GOLD } = require('../planner/eval/chen-gold.mjs');

const { outDir } = prepareBuild(path.basename(__filename, '.test.js'));

const blank = {
  acknowledgement: '',
  intent: 'provide_information',
  updates: [],
  unmapped_facts: [],
  explanation_topic: null
};

async function load() {
  const config = await import(path.join(outDir, 'config.mjs'));
  const turn = await import(path.join(outDir, 'architect/turn.mjs'));
  const questions = await import(path.join(outDir, 'architect/questions.mjs'));
  const brief = await import(path.join(outDir, 'owner-brief.mjs'));
  const eng = await import(path.join(outDir, 'engineer-brief.mjs'));
  const advisor = await import(path.join(outDir, 'advisor.mjs'));
  const readiness = await import(path.join(outDir, 'readiness.mjs'));
  const fusion = await import(path.join(outDir, 'fusion.mjs'));
  const provisioning = await import(path.join(outDir, 'provisioning.mjs'));
  return { ...config, ...turn, ...questions, ...brief, ...eng, ...advisor, ...readiness, ...fusion, ...provisioning };
}

function day(plan, name) {
  return plan.hours.days.find(d => d.day === name);
}

function assertGold(plan) {
  const g = CHEN_GOLD;
  assert.equal(plan.name, g.name);
  assert.match(plan.policy.cityState, /Kingston/);
  assert.doesNotMatch(plan.policy.cityState, /Poughkeepsie/i);
  assert.equal(plan.mode, g.mode);
  assert.equal(plan.specialty, g.specialty);
  assert.equal(plan.policy.rooms, g.rooms);
  assert.equal(plan.policy.opening.date, g.opening.date);
  assert.equal(plan.policy.opening.precision, g.opening.precision);
  assert.equal(plan.policy.opening.construction, g.opening.construction);
  assert.equal(plan.policy.opening.numbers, g.opening.numbers);
  assert.equal(plan.policy.opening.internet, g.opening.internet);
  assert.equal(plan.policy.opening.network, g.opening.network);
  assert.match(plan.policy.opening.pms, /Open Dental/i);
  const rec = plan.teams.find(t => t.role === 'reception');
  const clin = plan.teams.find(t => t.role === 'clinical');
  const adm = plan.teams.find(t => t.role === 'administration');
  assert.equal(rec.count, 2);
  assert.equal(rec.status, 'known');
  assert.equal(clin.count, 6);
  assert.equal(clin.status, 'known');
  assert.equal(adm.count, 1);
  assert.equal(adm.status, 'known');
  assert.equal(plan.policy.billingPerformedBy, 'administration');
  assert.equal(plan.first.kind, 'human');
  assert.equal(plan.first.team, 'reception');
  const mon = day(plan, 'Monday');
  const fri = day(plan, 'Friday');
  const sat = day(plan, 'Saturday');
  assert.equal(mon.start, '08:00');
  assert.equal(mon.end, '17:00');
  assert.equal(mon.breakStart, '12:30');
  assert.equal(mon.breakEnd, '13:30');
  assert.equal(fri.start, '08:00');
  assert.equal(fri.end, '14:00');
  assert.equal(fri.breakStart || '', '');
  assert.equal(sat.open, false);
  assert.ok(plan.hours.holidays.includes('2027-11-25'));
  assert.ok(plan.hours.holidays.includes('2027-12-25'));
  assert.equal(plan.hours.holidayPolicy, 'closed');
  assert.equal(plan.busy.kind, 'backup');
  assert.equal(plan.busy.backup, 'admin');
  assert.equal(plan.busy.owner, 'reception');
  assert.equal(plan.after.kind, 'message');
  assert.equal(plan.after.owner, 'reception');
  assert.equal(plan.policy.urgentKind, 'connect');
  assert.equal(plan.policy.urgentScope, 'urgent_only');
  assert.equal(plan.policy.urgentCoverage, 'closed');
  assert.equal(plan.policy.urgentRoster, 'rotation');
  assert.equal(plan.policy.urgentBackup, 'message');
  assert.equal(plan.urgent.team, 'clinical');
  const instr = (plan.urgent.instructions || '').toLowerCase();
  for (const n of g.urgent.instructionsNeedles)
    assert.match(instr, new RegExp(n, 'i'));
  const es = plan.languages.find(l => /spanish/i.test(l.name));
  assert.ok(es);
  assert.equal(es.mechanism, 'staff');
  assert.equal(es.availability, 'open');
  assert.equal(plan.policy.beforeOpening, 'message');
  const appt = plan.reasons.find(r => r.id === 'appointments' || /appoint/i.test(r.label));
  const bill = plan.reasons.find(r => r.id === 'billing' || /bill/i.test(r.label));
  const clinQ = plan.reasons.find(r => r.id === 'clinical-question' || /clinical/i.test(r.label));
  assert.equal(appt.team, 'reception');
  assert.ok(bill.team === 'admin' || bill.team === 'administration');
  assert.equal(clinQ.team, 'clinical');
  const lines = (plan.current.lines || '') + ' ' + (plan.current.notes || '');
  assert.match(lines, /analog/i);
  assert.match(lines, /fax/i);
  const cont = (plan.policy.continuity.notes || '') + ' ' + (plan.policy.notes || '');
  assert.match(cont, /snow/i);
  assert.match(cont, /personal/i);
  assert.notEqual(plan.policy.continuity.power, 'ups');
  assert.notEqual(plan.policy.urgentAlert, 'email');
  assert.notEqual(plan.policy.bomTier, 'balanced');
  const recPlace = plan.policy.placements.find(x => x.team === 'reception');
  assert.ok(recPlace);
  assert.equal(recPlace.sharing, 'separate');
  assert.equal(recPlace.count, 2);
  assert.equal(recPlace.device, 'desk');
  const clinComp = plan.policy.placements.find(x => x.team === 'clinical' && x.device === 'computer');
  assert.equal(clinComp.access, 'internal');
}

async function play(mod, interpreters) {
  let plan = mod.initial();
  let facts = {};
  let follow = null;
  const turns = [];
  const stated = new Set();
  for (let i = 0; i < CONVERSATION.length; i++) {
    const interpreter = interpreters[i] || blank;
    const turned = mod.interpretTurn({
      plan,
      facts,
      interpreter,
      userText: CONVERSATION[i],
      question: follow
    });
    plan = turned.plan;
    facts = turned.facts;
    follow = turned.follow;
    turns.push({ ack: turned.ack, follow: follow?.id || null });
    for (const id of STATED_FIELDS[i] || [])
      stated.add(id);
    if (follow?.affectedFields?.some(id => stated.has(id)))
      assert.fail('asked already-stated field ' + follow.affectedFields.filter(id => stated.has(id)).join(', ') + ' after turn ' + (i + 1) + ' (question ' + follow.id + ')');
    const needles = ACK_NEEDLES[i];
    for (const n of needles.must)
      assert.match(turned.ack, new RegExp(n, 'i'), 'turn ' + (i + 1) + ' ack missing ' + n + ': ' + turned.ack);
    for (const n of needles.mustNot)
      assert.doesNotMatch(turned.ack, new RegExp(n, 'i'), 'turn ' + (i + 1) + ' ack has ' + n + ': ' + turned.ack);
  }
  const pendingAfterSpeech = (typeof mod.ownerQuestions === 'function' ? mod.ownerQuestions(plan, facts) : []).map(q => q.id);
  let guard = 0;
  while (follow && guard++ < 12) {
    const answer = CHIP_ANSWERS[follow.id];
    if (!answer)
      assert.fail('unexpected question after Chen speech: ' + follow.id + ' — ' + follow.text);
    const chip = follow.options.find(o => o.value === answer.value) || {
      id: answer.value,
      label: answer.label,
      field_id: answer.field_id,
      value: answer.value,
      operation: 'set'
    };
    const turned = mod.chipTurn({ plan, facts, chip });
    plan = turned.plan;
    facts = turned.facts;
    follow = turned.follow;
  }
  return { plan, facts, follow, turns, pendingAfterSpeech };
}

test('Chen gold conversation without enrich produces the Chen plan (offline)', async () => {
  const mod = await load();
  const { plan, follow, pendingAfterSpeech } = await play(mod, CONVERSATION.map(() => blank));
  assert.equal(follow, null);
  assert.ok(pendingAfterSpeech.includes('devices.reception.kind'), 'kind stays an owner question until the chip: ' + pendingAfterSpeech.join(','));
  assert.ok(pendingAfterSpeech.includes('busy.order'), 'busy.order stays an owner question until the chip: ' + pendingAfterSpeech.join(','));
  if (typeof mod.ownerQuestions === 'function')
    assert.equal(mod.ownerQuestions(plan).length, 0);
  if (typeof mod.stillOpen === 'function') {
    const open = mod.stillOpen(plan).map(x => typeof x === 'string' ? x : x.label);
    assert.deepEqual(open, STILL_OPEN_GOLD);
  }
  assertGold(plan);
  const ownerPages = mod.ownerBrief(plan);
  const engPages = mod.engineerBrief(plan);
  assert.equal(ownerPages.length, 6);
  assert.ok(engPages.length >= 8);
  const id = mod.identity(plan);
  assert.ok(id.planId && id.checksum);
  const identities = mod.provisioningMap(plan).identities.filter(x => x.team === 'reception');
  assert.equal(identities.length, 2);
  const build = mod.fusionBuild(plan);
  const inbound = build.objects.find(o => o.kind === 'ring_group' && /Reception/i.test(o.name) && !/on-call/i.test(o.name));
  assert.ok(inbound);
  assert.match(inbound.setup.join(' '), /201 \(desk/);
  assert.match(inbound.setup.join(' '), /202 \(desk/);
  assert.doesNotMatch(inbound.setup.join(' '), /Members: none|members none/i);
  assert.ok(build.blockers.every(x => !/inbound ring group has no members/i.test(x)));
  const backup = build.objects.find(o => o.kind === 'ring_group' && o.extension === '7001');
  assert.ok(backup, 'overflow RG 7001');
  assert.match(inbound.setup.join(' '), /7001|backup/i);
  const ownerText = mod.ownerBriefText(plan);
  assert.match(ownerText, /2 (front-desk lines|desk phone|people at the front|independent line)/i);
  assert.doesNotMatch(ownerText, /Reception answers on the answering computer/i);
  assert.doesNotMatch(ownerText, /this afternoon/i);
  assert.doesNotMatch(ownerText, /answering computer/i);
  assert.match(ownerText, /On-call is Dr\. Chen alone until the associate starts/i);
  const engText = mod.engineerBriefText(plan);
  assert.match(engText, /BLOCKED/);
  assert.match(engText, /digit 9/i);
  assert.match(engText, /MUST FAIL/);
  assert.match(engText, /Follow Me empty/i);
  assert.match(engText, /Two calls at once/);
  const hourTable = engPages.flatMap(pg => pg.blocks).find(b => b.kind === 'table' && b.headers && b.headers[0] === 'Group');
  assert.ok(hourTable);
  assert.match(hourTable.rows[0].join(' '), /Dates|Nov 25|holiday/i);
  assert.match(engText, /evaluate before weekday/i);
  assert.match(engText, /fax/i);
  assert.match(engText, /analog/i);
  for (const line of engText.split('\n')) {
    if (/BLOCKED/.test(line))
      continue;
    assert.doesNotMatch(line, /members none|\*99—|box —|<owner>/, line);
  }
});

test('Chen gold with recorded Groq replies produces the Chen plan', async () => {
  const fixturePath = path.join(__dirname, '../planner/eval/fixtures/chen-groq.json');
  if (!fs.existsSync(fixturePath))
    return;
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const mod = await load();
  const { plan, follow } = await play(mod, fixture.turns || fixture);
  assert.equal(follow, null);
  assertGold(plan);
});
