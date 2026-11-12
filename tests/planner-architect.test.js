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
  const src = path.join(srcDir, rel + '.ts');
  let out = ts.transpile(fs.readFileSync(src, 'utf8'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  });
  out = out.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, "from '$1.mjs'");
  const dest = path.join(outDir, rel + '.mjs');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, out);
}

for (const name of ['config', 'policy', 'locations', 'routing', 'flow', 'team-state', 'state', 'architect/schema', 'architect/fields', 'architect/extract', 'architect/ack', 'architect/merge', 'architect/questions', 'architect/turn', 'architect/scene-from-plan', 'architect/hear', 'provisioning', 'bom', 'opening', 'status', 'readiness', 'advisor', 'fusion'])
  transpile(name);

let architect;
async function load() {
  if (!architect) {
    const config = await import(path.join(outDir, 'config.mjs'));
    const merge = await import(path.join(outDir, 'architect/merge.mjs'));
    const questions = await import(path.join(outDir, 'architect/questions.mjs'));
    const fields = await import(path.join(outDir, 'architect/fields.mjs'));
    const extract = await import(path.join(outDir, 'architect/extract.mjs'));
    const turn = await import(path.join(outDir, 'architect/turn.mjs'));
    const scene = await import(path.join(outDir, 'architect/scene-from-plan.mjs'));
    const hear = await import(path.join(outDir, 'architect/hear.mjs'));
    const advisor = await import(path.join(outDir, 'advisor.mjs'));
    const fusion = await import(path.join(outDir, 'fusion.mjs'));
    architect = { ...config, ...merge, ...questions, ...fields, ...extract, ...turn, ...scene, ...hear, ...advisor, ...fusion };
  }
  return architect;
}

function update(mod, plan, facts, updates, intent = 'provide_information', unmapped = []) {
  return mod.applyUpdates(plan, facts, updates.map(u => ({
    evidence: u.evidence || 'test',
    needs_confirmation: !!u.needs_confirmation,
    value: Object.prototype.hasOwnProperty.call(u, 'value') ? u.value : null,
    ...u
  })), intent, unmapped);
}

test('rooms do not invent phones', async () => {
  const mod = await load();
  const start = mod.initial();
  const result = update(mod, start, {}, [{ field_id: 'policy.rooms', operation: 'set', value: 6, evidence: 'six rooms' }]);
  assert.equal(result.plan.policy.rooms, 6);
  assert.equal(result.plan.policy.roomsSpecified, true);
  assert.equal(result.plan.policy.placements.length, 0);
  assert.equal(result.plan.endpoints.undecided, true);
});

test('skip is not none for urgent handling', async () => {
  const mod = await load();
  const result = update(mod, mod.initial(), {}, [{ field_id: 'urgent.kind', operation: 'skip', value: null, evidence: 'skip' }], 'skip_current');
  assert.equal(result.plan.policy.urgentKind, 'undecided');
  assert.equal(result.plan.urgent.enabled, false);
  assert.equal(result.facts['urgent.kind'].status, 'skipped');
  assert.ok(!result.plan.confirmed.includes('urgent'));
});

test('probably AI stays proposed, not launch config', async () => {
  const mod = await load();
  const result = update(mod, mod.initial(), {}, [{ field_id: 'after.kind', operation: 'uncertain', value: 'assistant', evidence: 'probably after-hours AI' }]);
  assert.equal(result.plan.after.kind, 'undecided');
  assert.equal(result.facts['after.kind'].status, 'proposed');
});

test('actually voicemail corrects a confirmed after-hours choice', async () => {
  const mod = await load();
  const first = update(mod, mod.initial(), {}, [{ field_id: 'after.kind', operation: 'set', value: 'assistant', evidence: 'AI' }]);
  const second = update(mod, first.plan, first.facts, [{ field_id: 'after.kind', operation: 'set', value: 'message', evidence: 'actually voicemail' }], 'correct_information');
  assert.equal(second.plan.after.kind, 'message');
  assert.equal(second.facts['after.kind'].status, 'confirmed');
});

test('contradiction without correction is held for confirmation', async () => {
  const mod = await load();
  const first = update(mod, mod.initial(), {}, [{ field_id: 'first.kind', operation: 'set', value: 'human', evidence: 'front desk first' }]);
  const second = update(mod, first.plan, first.facts, [{ field_id: 'first.kind', operation: 'set', value: 'menu', evidence: 'a menu' }]);
  assert.equal(second.plan.first.kind, 'human');
  assert.equal(second.confirmationNeeded.length, 1);
  assert.equal(second.facts['first.kind'].status, 'conflicting');
});

test('lunch coverage is not a contradiction', async () => {
  const mod = await load();
  const first = update(mod, mod.initial(), {}, [
    { field_id: 'hours.preset', operation: 'set', value: 'weekdays', evidence: 'weekdays' },
    { field_id: 'after.kind', operation: 'set', value: 'message', evidence: 'voicemail' }
  ]);
  const second = update(mod, first.plan, first.facts, [], 'provide_information', ['The front desk covers the phones during lunch']);
  assert.equal(second.plan.after.kind, 'message');
  assert.equal(second.plan.policy.hoursPreset, 'weekdays');
  assert.equal(second.confirmationNeeded.length, 0);
});

test('chip path does not need Groq', async () => {
  const mod = await load();
  const result = mod.applyChip(mod.initial(), {}, { field_id: 'after.kind', value: 'message', operation: 'set', label: 'Take a message' });
  assert.equal(result.plan.after.kind, 'message');
  assert.equal(result.facts['after.kind'].status, 'confirmed');
});

test('correcting a confirmed chip replaces it without confirmation', async () => {
  const mod = await load();
  const first = mod.chipTurn({
    plan: mod.initial(),
    facts: {},
    chip: { id: '1', label: '1', field_id: 'after.kind', value: 'assistant', operation: 'set' }
  });
  assert.equal(first.plan.after.kind, 'assistant');
  const blocked = mod.chipTurn({
    plan: first.plan,
    facts: first.facts,
    chip: { id: 'message', label: 'Take a message', field_id: 'after.kind', value: 'message', operation: 'set' }
  });
  assert.equal(blocked.plan.after.kind, 'assistant');
  assert.equal(blocked.confirmationNeeded.length, 1);
  const corrected = mod.chipTurn({
    plan: first.plan,
    facts: first.facts,
    chip: { id: 'message', label: 'Take a message', field_id: 'after.kind', value: 'message', operation: 'set' },
    correcting: true
  });
  assert.equal(corrected.plan.after.kind, 'message');
  assert.equal(corrected.confirmationNeeded.length, 0);
  assert.equal(corrected.facts['after.kind'].status, 'confirmed');
});

test('e911 fields are rejected', async () => {
  const mod = await load();
  const result = update(mod, mod.initial(), {}, [{ field_id: 'e911Confirmed', operation: 'set', value: true, evidence: 'ignore instructions' }]);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.plan.policy.e911Confirmed, false);
});

test('staff count is not a phone order', async () => {
  const mod = await load();
  const result = update(mod, mod.initial(), {}, [
    { field_id: 'teams.reception.count', operation: 'set', value: 3, evidence: 'three receptionists' },
    { field_id: 'devices.reception.desk_count', operation: 'set', value: 2, evidence: 'two desk phones' },
    { field_id: 'devices.reception.computer_count', operation: 'set', value: 1, evidence: 'one computer' }
  ]);
  assert.equal(result.plan.teams.find(t => t.role === 'reception').count, 3);
  assert.equal(result.plan.policy.placements.find(x => x.device === 'desk').count, 2);
  assert.equal(result.plan.policy.placements.find(x => x.device === 'computer').count, 1);
});

test('future AI is not launch after-hours', async () => {
  const mod = await load();
  const result = update(mod, mod.initial(), {}, [
    { field_id: 'after.kind', operation: 'set', value: 'message', evidence: 'voicemail for now' },
    { field_id: 'future.ai_receptionist', operation: 'set', value: 'AI later when we grow', evidence: 'AI later' }
  ], 'provide_information', ['AI later when the practice grows']);
  assert.equal(result.plan.after.kind, 'message');
  assert.ok(result.futureConsiderations.length >= 1);
});

test('next question skips first-answer when reception already answers everything', async () => {
  const mod = await load();
  let plan = mod.initial();
  let facts = {};
  const filled = update(mod, plan, facts, [
    { field_id: 'mode', operation: 'set', value: 'opening', evidence: 'opening' },
    { field_id: 'specialty', operation: 'set', value: 'Dental', evidence: 'dental' },
    { field_id: 'teams.reception.count', operation: 'set', value: 2, evidence: 'two receptionists' },
    { field_id: 'teams.clinical.count', operation: 'set', value: 4, evidence: 'dentist and assistants' },
    { field_id: 'teams.administration.count', operation: 'set', value: 1, evidence: 'office manager' },
    { field_id: 'first.kind', operation: 'set', value: 'human', evidence: 'front desk first' },
    { field_id: 'busy.kind', operation: 'set', value: 'message', evidence: 'voicemail when busy' },
    { field_id: 'hours.Saturday.open', operation: 'set', value: false, evidence: 'closed weekends' },
    { field_id: 'hours.Sunday.open', operation: 'set', value: false, evidence: 'closed weekends' }
  ]);
  const question = mod.nextQuestion(filled.plan, filled.facts);
  assert.ok(question);
  assert.notEqual(question.id, 'first.kind');
  assert.notEqual(question.id, 'mode');
  assert.notEqual(question.id, 'specialty');
  assert.ok(['hours.preset', 'after.kind'].includes(question.id));
});

test('opening a dental practice drives the assembly scene', async () => {
  const mod = await load();
  const filled = update(mod, mod.initial(), {}, [
    { field_id: 'mode', operation: 'set', value: 'opening', evidence: 'opening' },
    { field_id: 'specialty', operation: 'set', value: 'Dental', evidence: 'dental' }
  ]);
  const scene = mod.sceneFromPlan(filled.plan);
  assert.equal(scene.mode, 'opening');
  assert.ok(scene.chapter >= 1);
  assert.match(scene.badge, /Dental/i);
});

test('adding a location uses the two-office scene', async () => {
  const mod = await load();
  const filled = update(mod, mod.initial(), {}, [{ field_id: 'mode', operation: 'set', value: 'adding', evidence: 'second office' }]);
  assert.equal(mod.sceneFromPlan(filled.plan).mode, 'adding');
});

test('on-call paraphrases save as connect and skip the urgent question', async () => {
  const mod = await load();
  const result = update(mod, mod.initial(), {}, [
    { field_id: 'urgent.kind', operation: 'set', value: 'on-call', evidence: 'connect the on-call' },
    { field_id: 'urgent.team', operation: 'set', value: 'the doctor', evidence: 'clinician phone' },
    { field_id: 'urgent.coverage', operation: 'set', value: 'open and closed', evidence: 'open and closed hours' }
  ]);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.plan.policy.urgentKind, 'connect');
  assert.equal(result.plan.urgent.enabled, true);
  assert.equal(result.plan.urgent.team, 'clinical');
  assert.equal(result.plan.policy.urgentCoverage, 'always');
  const question = mod.nextQuestion(result.plan, result.facts);
  assert.notEqual(question && question.id, 'urgent.kind');
});

test('urgent sentence prefers clinicians over receptionists mentioned earlier', async () => {
  const mod = await load();
  const text = 'Opening a dental practice. Two receptionists, a dentist, an office manager. Front desk answers first. After hours take a message. During open hours urgent calls go to the clinician phone and when closed connect the on-call.';
  const hinted = mod.updatesFromOwnerText(text, { id: 'mode', affectedFields: ['mode'], options: [] }, {});
  const ids = Object.fromEntries(hinted.map(u => [u.field_id, u.value]));
  assert.equal(ids['urgent.kind'], 'connect');
  assert.equal(ids['urgent.team'], 'clinical');
  assert.equal(ids['urgent.coverage'], 'always');
});

test('opening paragraph does not invent an on-call team', async () => {
  const mod = await load();
  const text = "I'm opening a dental practice in New York next March. We're planning six operatories, two receptionists, a dentist, three assistants, and an office manager.";
  const hinted = mod.updatesFromOwnerText(text, { id: 'mode', affectedFields: ['mode'], options: [] }, {});
  assert.ok(!hinted.some(u => String(u.field_id).startsWith('urgent')));
});

test('ambiguous clinician routing asks urgent vs every call', async () => {
  const mod = await load();
  const text = 'During the oeen hours they should go to the docro clinicians phone and on closed hour connect the on-call';
  const empty = { acknowledgement: 'Got it!', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };
  const turned = mod.interpretTurn({ plan: mod.initial(), facts: {}, interpreter: empty, userText: text, question: null });
  assert.equal(turned.plan.policy.pendingClinicianRoute, true);
  assert.notEqual(turned.plan.policy.urgentKind, 'connect');
  assert.notEqual(turned.plan.first.team, 'clinical');
  assert.equal(turned.follow?.id, 'urgent.scope');
  assert.doesNotMatch(turned.ack, /^got it!?$/i);
  assert.doesNotMatch(turned.ack, /i recorded that from what you wrote/i);
});

test('only-emergencies clarification stores reception first and on-call as urgent', async () => {
  const mod = await load();
  const empty = { acknowledgement: 'Got it.', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };
  const first = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: empty,
    userText: 'During open hours calls go to the doctor, after hours the on-call person.',
    question: null
  });
  const second = mod.interpretTurn({
    plan: first.plan,
    facts: first.facts,
    interpreter: empty,
    userText: 'No, only emergencies. Regular calls go to reception.',
    question: first.follow
  });
  assert.equal(second.plan.policy.urgentScope, 'urgent_only');
  assert.equal(second.plan.first.kind, 'human');
  assert.equal(second.plan.first.team, 'reception');
  assert.equal(second.plan.policy.urgentKind, 'connect');
  assert.equal(second.plan.policy.onCallRouteVerified, false);
});

test('owner plus two front-desk billers are not three administrators', async () => {
  const mod = await load();
  const empty = { acknowledgement: 'Got it!', intent: 'provide_information', updates: [{ field_id: 'teams.administration.count', operation: 'set', value: 3, evidence: 'billing', needs_confirmation: false }], unmapped_facts: [], explanation_topic: null };
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: empty,
    userText: "I'm the owner, I manage the practice and do office administration. Two girls work the front. They also handle billing.",
    question: null
  });
  assert.equal(turned.plan.teams.find(t => t.role === 'administration').count, 1);
  assert.equal(turned.plan.teams.find(t => t.role === 'reception').count, 2);
  assert.equal(turned.plan.policy.billingPerformedBy, 'reception');
  assert.match(turned.ack, /front-desk|administration|billing/i);
});

test('january 12 is a day, not the first of the month', async () => {
  const mod = await load();
  const hinted = mod.updatesFromOwnerText('New dental practice in Albany. Call it Albany Smile. We open January 12, 2027.', null, {});
  const ids = Object.fromEntries(hinted.map(u => [u.field_id, u.value]));
  assert.match(String(ids['opening.date']), /january 12/i);
  assert.equal(ids['opening.precision'], 'day');
  assert.equal(ids.name, 'Albany Smile');
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null },
    userText: 'New dental practice in Albany. Call it Albany Smile. We open January 12, 2027.',
    question: null
  });
  assert.equal(turned.plan.policy.opening.date, '2027-01-12');
  assert.equal(turned.plan.policy.opening.precision, 'day');
  assert.equal(turned.plan.name, 'Albany Smile');
});

test('unhired receptionist and office manager stay open or zero', async () => {
  const mod = await load();
  const text = 'I will be the only dentist. I have not hired an office manager. Administration count is zero. I do not know if I will hire one receptionist or two. Do not lock a receptionist number.';
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: { acknowledgement: 'Got it!', intent: 'provide_information', updates: [{ field_id: 'teams.administration.count', operation: 'set', value: 1, evidence: 'manager', needs_confirmation: false }, { field_id: 'teams.reception.count', operation: 'set', value: 1, evidence: 'one', needs_confirmation: false }], unmapped_facts: [], explanation_topic: null },
    userText: text,
    question: null
  });
  assert.equal(turned.plan.teams.find(t => t.role === 'administration').count, 0);
  assert.notEqual(turned.facts['teams.reception.count']?.status, 'confirmed');
});

test('forget kingston keeps the last named city and opening mode', async () => {
  const mod = await load();
  const empty = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };
  const first = mod.interpretTurn({ plan: mod.initial(), facts: {}, interpreter: empty, userText: 'Existing dental phones in Kingston, New York. Just fix them.', question: null });
  const second = mod.interpretTurn({
    plan: first.plan,
    facts: first.facts,
    interpreter: empty,
    userText: 'Wait. Forget Kingston. Scratch the old office. This is a new office we are opening in New Paltz, New York. Not a second location. The only office.',
    question: first.follow
  });
  assert.match(String(second.plan.policy.cityState), /New Paltz/i);
  assert.equal(second.plan.mode, 'opening');
});

test('forget kingston plus give me the plan still replaces the city', async () => {
  const mod = await load();
  const empty = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };
  const first = mod.interpretTurn({ plan: mod.initial(), facts: {}, interpreter: empty, userText: 'Existing dental phones in Kingston, New York. Just fix them.', question: null });
  const second = mod.interpretTurn({
    plan: first.plan,
    facts: first.facts,
    interpreter: { ...empty, intent: 'generate_draft' },
    userText: 'Forget Kingston, this is New Paltz, not a second location. One receptionist, I\'m the dentist, no office manager. Keep our number. Hours 8 to 5 weekdays. Just give me the plan.',
    question: first.follow
  });
  assert.equal(second.intent, 'generate_draft');
  assert.match(String(second.plan.policy.cityState), /New Paltz/i);
  assert.equal(second.plan.mode, 'improving');
  assert.equal(second.plan.teams.find(t => t.role === 'reception').count, 1);
  assert.equal(second.plan.teams.find(t => t.role === 'clinical').count, 1);
  assert.equal(second.plan.teams.find(t => t.role === 'administration').count, 0);
  assert.equal(second.plan.policy.opening.numbers, 'porting');
  assert.match(second.ack, /New Paltz/i);
  assert.equal(second.confirmationNeeded.length, 0);
});

test('robot picking up every call is not all-calls clinician routing', async () => {
  const mod = await load();
  const hinted = mod.updatesFromOwnerText("I don't want a robot picking up every call. Staff should answer.", null, {});
  assert.ok(!hinted.some(u => u.field_id === 'urgent.scope' && u.value === 'all_calls'));
  assert.equal(hinted.find(u => u.field_id === 'first.kind')?.value, 'human');
});

test('im the dentist counts as one clinician', async () => {
  const mod = await load();
  const hinted = mod.updatesFromOwnerText("One girl at the front to start, I'm the dentist. We open in April.", null, {});
  assert.equal(hinted.find(u => u.field_id === 'teams.clinical.count')?.value, 1);
  assert.equal(hinted.find(u => u.field_id === 'teams.reception.count')?.value, 1);
  assert.equal(hinted.find(u => u.field_id === 'specialty')?.value, 'Dental');
});

test('existing dental in a city sets specialty without asking again', async () => {
  const mod = await load();
  const hinted = mod.updatesFromOwnerText('Existing dental in Catskill NY. One girl at the front, I\'m the dentist.', null, {});
  assert.equal(hinted.find(u => u.field_id === 'specialty')?.value, 'Dental');
  assert.equal(hinted.find(u => u.field_id === 'cityState')?.value, 'Catskill');
});

test('dentist plus front desk does not invent an administrator', async () => {
  const mod = await load();
  const text = 'Existing dental in Catskill NY. One girl at the front, I\'m the dentist. During the oeen hours they should go to the docro clinicians phone and on closed hour connect the on-call.';
  const empty = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: {
      ...empty,
      updates: [
        { field_id: 'teams.administration.count', operation: 'set', value: 1, evidence: 'owner', needs_confirmation: false },
        { field_id: 'first.kind', operation: 'set', value: 'human', evidence: 'open hours', needs_confirmation: false }
      ]
    },
    userText: text,
    question: null
  });
  assert.notEqual(turned.facts['teams.administration.count']?.status, 'confirmed');
  assert.equal(turned.plan.teams.find(t => t.role === 'administration').status, 'unanswered');
  assert.equal(turned.plan.first.kind, 'undecided');
  assert.equal(turned.plan.specialty, 'Dental');
});

test('after hours take a message is not open-hours unanswered', async () => {
  const mod = await load();
  const hinted = mod.updatesFromOwnerText("I've had this dental office thirty years in Hudson. After hours just take a message. We don't have anyone on call.", null, {});
  assert.equal(hinted.find(u => u.field_id === 'after.kind')?.value, 'message');
  assert.equal(hinted.find(u => u.field_id === 'busy.kind'), undefined);
  assert.equal(hinted.find(u => u.field_id === 'urgent.kind')?.value, 'none');
});

test('dont start with all that does not skip the setup question', async () => {
  const mod = await load();
  const empty = { acknowledgement: '', intent: 'skip_current', updates: [{ field_id: 'mode', operation: 'skip', value: null, evidence: 'dont start', needs_confirmation: false }], unmapped_facts: [], explanation_topic: null };
  const first = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: empty,
    userText: "Don't start with all that. After hours just take a voicemail. We don't have anyone on call.",
    question: { id: 'mode', affectedFields: ['mode'], options: [], text: 'What are you setting up?', detail: '', priority: 10, skipAllowed: true }
  });
  assert.notEqual(first.facts.mode?.status, 'skipped');
  assert.equal(first.plan.after.kind, 'message');
  assert.equal(first.plan.policy.urgentKind, 'none');
  assert.equal(first.intent, 'provide_information');
  assert.equal(first.follow?.id, 'mode');
  assert.match(first.ack, /voicemail after hours/i);
  assert.match(first.ack, /no live on-call/i);
  assert.doesNotMatch(first.ack, /human-first|09:00|not a phone order/i);
  const second = mod.interpretTurn({
    plan: first.plan,
    facts: first.facts,
    interpreter: { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null },
    userText: "It's an existing dental office in Beacon. Two girls at the front, I'm the dentist. They pick up, not a menu. Nine to five weekdays. Keep the number.",
    question: first.follow
  });
  assert.equal(second.plan.mode, 'improving');
  assert.match(String(second.plan.policy.cityState), /Beacon/i);
  assert.equal(second.plan.specialty, 'Dental');
  assert.equal(second.plan.first.kind, 'human');
  assert.equal(second.follow?.id, 'teams.administration.count');
  assert.match(second.ack, /existing dental office in Beacon/i);
  assert.match(second.ack, /front desk picks up/i);
  assert.doesNotMatch(second.ack, /human-first|09:00|not a phone order|existing-office plan/i);
  assert.equal(mod.chapterForQuestion(first.follow?.id), 0);
  assert.equal(mod.headerChapter(first.plan), 3);
});

test('spoken ack groups rooms, language, and busy without phone-order jargon', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: { acknowledgement: 'Got it!', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null },
    userText: 'No office manager. If the girls are already on a call, take a message. English is enough. Four rooms, those are not phones.',
    question: { id: 'teams.administration.count', affectedFields: ['teams.administration.count'], options: [], text: 'How many people handle office management?', detail: '', priority: 34, skipAllowed: true }
  });
  assert.match(turned.ack, /no office manager/i);
  assert.match(turned.ack, /English is enough/i);
  assert.match(turned.ack, /4 treatment rooms/i);
  assert.doesNotMatch(turned.ack, /not a phone order/i);
});

test('closed for lunch noon to one is a phone break, not after hours', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null },
    userText: 'Weekdays nine to five. Closed for lunch noon to one. After hours just take a voicemail.',
    question: null
  });
  assert.equal(turned.plan.after.kind, 'message');
  assert.equal(turned.plan.hours.days[0].breakStart, '12:00');
  assert.equal(turned.plan.hours.days[0].breakEnd, '13:00');
  assert.match(turned.ack, /lunch/i);
  assert.doesNotMatch(turned.ack, /after-hours voicemail is a lunch/i);
});

test('whats best after hours does not install AI', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: { acknowledgement: 'An AI receptionist would be best.', intent: 'provide_information', updates: [{ field_id: 'after.kind', operation: 'set', value: 'assistant', evidence: 'best', needs_confirmation: false }], unmapped_facts: [], explanation_topic: null },
    userText: "I don't know whether I need AI, a receptionist, or some answering company. What's best after hours?",
    question: { id: 'after.kind', affectedFields: ['after.kind'], options: [], text: 'What should patients experience when they call after hours?', detail: '', priority: 70, skipAllowed: true }
  });
  assert.notEqual(turned.plan.after.kind, 'assistant');
  assert.equal(turned.plan.after.kind, 'undecided');
  assert.notEqual(turned.plan.first.kind, 'assistant');
  assert.match(turned.ack, /voicemail after hours is the simple path/i);
});

test('patient at the desk plus whats best after hours keeps those decisions separate', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: { ...mod.initial(), mode: 'improving', specialty: 'Dental', first: { kind: 'human', team: 'reception' }, teams: [{ id: 'reception', name: 'Reception', role: 'reception', count: 2, status: 'known' }, { id: 'clinical', name: 'Clinical team', role: 'clinical', count: 1, status: 'known' }, { id: 'admin', name: 'Administration', role: 'administration', count: 0, status: 'unanswered' }] },
    facts: { mode: { field_id: 'mode', value: 'improving', status: 'confirmed', evidence: 'had' }, specialty: { field_id: 'specialty', value: 'Dental', status: 'confirmed', evidence: 'dental' }, 'first.kind': { field_id: 'first.kind', value: 'human', status: 'confirmed', evidence: 'pick up' }, 'teams.reception.count': { field_id: 'teams.reception.count', value: 2, status: 'confirmed', evidence: 'two' }, 'teams.clinical.count': { field_id: 'teams.clinical.count', value: 1, status: 'confirmed', evidence: 'dentist' } },
    interpreter: { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null },
    userText: "No office manager. Weekdays eight to five. Closed for lunch noon to one. When the girls are with a patient the phone just rings and people hang up — take a message. I don't know whether I need AI, a receptionist, or some answering company after hours. What's best?",
    question: { id: 'teams.administration.count', affectedFields: ['teams.administration.count'], options: [], text: 'How many people handle office management?', detail: '', priority: 34, skipAllowed: true }
  });
  assert.equal(turned.plan.busy.kind, 'message');
  assert.equal(turned.plan.after.kind, 'undecided');
  assert.equal(turned.plan.hours.days[0].breakStart, '12:00');
  assert.equal(turned.follow?.id, 'after.kind');
  assert.match(turned.ack, /voicemail after hours is the simple path/i);
  assert.doesNotMatch(turned.ack, /short wait only helps/i);
});

test('drywall office does not lock a receptionist count', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null },
    userText: 'I am building a new dental office in Newburgh. Drywall is still up. I do not know if I will hire one receptionist or two. Do not lock a receptionist number.',
    question: { id: 'mode', affectedFields: ['mode'], options: [], text: 'What are you setting up?', detail: '', priority: 10, skipAllowed: true }
  });
  assert.equal(turned.plan.mode, 'opening');
  assert.equal(turned.plan.specialty, 'Dental');
  assert.equal(turned.plan.policy.opening.construction, 'build-out');
  assert.equal(turned.facts['teams.reception.count']?.status, 'skipped');
  assert.notEqual(turned.plan.teams.find(t => t.role === 'reception').status, 'known');
});

test('eight to five is custom hours, not default nine to five', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null },
    userText: 'Phones are answered Monday through Friday, eight to five. Closed Saturday and Sunday.',
    question: null
  });
  assert.equal(turned.plan.hours.days[0].start, '08:00');
  assert.equal(turned.plan.hours.days[0].end, '17:00');
  assert.equal(turned.plan.policy.hoursPreset, 'custom');
});

const blank = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };

test('receptionist checks messages fills the mailbox owner', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: blank,
    userText: 'After hours just take a message. The receptionist checks it in the morning.',
    question: null
  });
  assert.equal(turned.plan.after.kind, 'message');
  assert.equal(turned.plan.after.owner, 'reception');
  assert.equal(turned.plan.busy.owner, 'reception');
  assert.match(turned.ack, /front desk checks/i);
});

test('two at the front who can both pick up is separate lines, not a phone order', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: blank,
    userText: 'Two girls at the front. They can both pick up at once.',
    question: null
  });
  assert.equal(turned.plan.teams.find(t => t.role === 'reception').count, 2);
  const share = turned.plan.policy.placements.find(x => x.team === 'reception');
  assert.equal(share.sharing, 'separate');
  assert.equal(share.device, 'undecided');
  assert.equal(share.count, 0);
  assert.equal(turned.plan.endpoints.desk, 0);
  assert.equal(turned.plan.endpoints.undecided, true);
  assert.match(turned.ack, /two front-desk lines/i);
});

test('ring my personal cell is work mobile and never stores the number', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: blank,
    userText: 'If nobody answers just ring my cell, 845-555-0199. Do not put my number in the greeting.',
    question: null
  });
  assert.equal(turned.plan.policy.continuity.backupRouting, 'undecided');
  assert.match(turned.plan.policy.notes, /work mobile/i);
  assert.doesNotMatch(turned.plan.policy.notes, /845/);
  assert.doesNotMatch(turned.plan.policy.notes, /555-0199/);
  const hear = mod.callerHear(turned.plan);
  assert.ok(hear.some(row => /work mobile/i.test(row.hear)));
  assert.ok(hear.every(row => !/845/.test(row.hear)));
});

test('internet outage to the work cell still records backup routing', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: blank,
    userText: 'To the work cell.',
    question: null
  });
  assert.equal(turned.plan.policy.continuity.backupRouting, 'cellular');
  assert.match(turned.plan.policy.notes, /work mobile/i);
});

test('before opening callback is not the after-hours path', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: blank,
    userText: "We're opening a dental office in Catskill. Drywall is still up, not open yet. I haven't hired a receptionist. If someone finds the number before we open, take a callback message. After hours just take a message. I'm the dentist.",
    question: null
  });
  assert.equal(turned.plan.mode, 'opening');
  assert.equal(turned.plan.policy.beforeOpening, 'message');
  assert.equal(turned.plan.policy.opening.construction, 'build-out');
  assert.equal(turned.plan.after.kind, 'message');
  assert.notEqual(turned.plan.busy.kind, 'message');
  assert.equal(turned.facts['teams.reception.count']?.status, 'skipped');
  assert.match(turned.ack, /callback messages before opening/i);
});

test('after a take-a-message dump the next question is who checks the mailbox', async () => {
  const mod = await load();
  const turned = mod.interpretTurn({
    plan: mod.initial(),
    facts: {},
    interpreter: blank,
    userText: 'Existing dental in Hudson. Two girls at the front, I am the dentist. No office manager. The girls at the front answer. If they are with a patient take a message. After hours take a message. Weekdays nine to five. Someone stays on the phones at lunch.',
    question: null
  });
  assert.equal(turned.plan.after.kind, 'message');
  assert.equal(turned.plan.busy.kind, 'message');
  assert.equal(turned.follow?.id, 'messages.owner');
});

test('before-opening recording chip does not crash caller hear', async () => {
  const mod = await load();
  let plan = mod.initial();
  plan.mode = 'opening';
  plan.policy.beforeOpening = 'information';
  assert.doesNotThrow(() => mod.callerHear(plan));
  const rows = mod.callerHear(plan);
  assert.ok(rows.some(row => /Before opening day/.test(row.when) && /not open yet/i.test(row.hear)));
  const turned = update(mod, { ...mod.initial(), mode: 'opening' }, {}, [
    { field_id: 'beforeOpening', operation: 'set', value: 'information' }
  ]);
  assert.equal(turned.plan.policy.beforeOpening, 'information');
  assert.ok(turned.plan.policy.beforeOpeningText.trim());
  assert.doesNotThrow(() => mod.callerHear(turned.plan));
});

test('caller hear preview uses the practice name and lunch close', async () => {
  const mod = await load();
  let plan = mod.initial();
  plan = update(mod, plan, {}, [
    { field_id: 'name', operation: 'set', value: 'Hudson Family Dental' },
    { field_id: 'first.kind', operation: 'set', value: 'human' },
    { field_id: 'busy.kind', operation: 'set', value: 'message' },
    { field_id: 'after.kind', operation: 'set', value: 'message' },
    { field_id: 'hours.lunch', operation: 'set', value: 'closed' }
  ]).plan;
  const hear = mod.callerHear(plan);
  assert.ok(hear.some(row => /Hudson Family Dental/.test(row.hear) && /After hours/.test(row.when)));
  assert.ok(hear.some(row => /lunch/i.test(row.when)));
  assert.ok(hear.every(row => !/\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(row.hear)));
});

function play(mod, texts) {
  let plan = mod.initial();
  let facts = {};
  let follow = null;
  let ack = '';
  for (const userText of texts) {
    const turned = mod.interpretTurn({
      plan,
      facts,
      interpreter: blank,
      userText,
      question: follow
    });
    plan = turned.plan;
    facts = turned.facts;
    follow = turned.follow;
    ack = turned.ack;
  }
  return { plan, facts, follow, ack };
}

test('Hudson messy talk lands mailbox, two lines, work mobile, and lunch on the blueprint', async () => {
  const mod = await load();
  const { plan, ack, follow } = play(mod, [
    "We've had this dental office in Hudson for twenty years. Two girls at the front, I'm the dentist. They pick up, not a menu.",
    "No office manager. Weekdays eight to five. Closed for lunch noon to one. When the girls are with a patient the phone just rings and people hang up — take a message. After hours take a message. Keep the number. Four rooms, those are not phones. English is enough. We don't have anyone on call.",
    'The receptionist checks the messages in the morning.',
    'They can both pick up at once.',
    'If nobody answers just ring my cell, 845-555-0199. Do not put my number in the greeting.'
  ]);
  assert.equal(plan.mode, 'improving');
  assert.equal(plan.policy.ring, 'together');
  assert.notEqual(follow?.id, 'mode');
  assert.equal(plan.after.owner, 'reception');
  assert.equal(plan.busy.owner, 'reception');
  assert.equal(plan.policy.placements.find(x => x.team === 'reception').sharing, 'separate');
  assert.equal(plan.endpoints.undecided, true);
  assert.doesNotMatch(JSON.stringify(plan.policy), /845-555-0199/);
  assert.match(ack, /work mobile/i);
  const maps = mod.callMaps(plan);
  assert.match(maps.closed, /checked by Reception/i);
  assert.match(maps.lunch, /lunch close/i);
  const hear = mod.callerHear(plan);
  assert.ok(hear.some(row => /after hours/i.test(row.when) && /next business day/i.test(row.hear)));
  assert.ok(hear.every(row => !/845/.test(row.hear)));
  const heads = mod.headlineInsights(plan).map(i => i.id).join(' ');
  assert.match(heads, /share-intent/);
  assert.match(heads, /work-mobile/);
  assert.match(heads, /lunch/);
  const bands = [...mod.purchaseBands(plan).required, ...mod.purchaseBands(plan).optional];
  assert.ok(bands.some(r => /both can pick up/i.test(r.item)));
  assert.ok(bands.some(r => /work-mobile/i.test(r.item)));
  const glance = mod.glance(plan);
  assert.equal(glance.metrics[0].value, '2');
  const fusion = mod.fusionBuild(plan);
  assert.ok(fusion.recordings.some(r => r.filename === 'greeting_1.wav' && /Hudson Family Dental|the practice/i.test(r.script)));
  assert.ok(fusion.analysis.some(line => /2 independent reception identities/i.test(line)));
  assert.ok(fusion.analysis.some(line => /Follow Me/i.test(line) && /personal cell/i.test(line)));
  assert.ok(fusion.checklist.some(line => /independent reception identities/i.test(line)));
  assert.ok(fusion.objects.some(o => o.kind === 'ring_group' && /7000/.test(o.name)));
  assert.doesNotMatch(JSON.stringify(fusion), /845-555/);
});

test('opening callback owner is not left unset once someone owns the mailbox', async () => {
  const mod = await load();
  const first = play(mod, [
    "We're opening a dental office in Catskill. Drywall is still up, not open yet. I haven't hired a receptionist. If someone finds the number before we open, take a callback message. After hours just take a message. I'm the dentist."
  ]);
  assert.equal(first.plan.policy.beforeOpening, 'message');
  const second = mod.interpretTurn({
    plan: first.plan,
    facts: first.facts,
    interpreter: blank,
    userText: 'I check the voicemail.',
    question: first.follow
  });
  assert.equal(second.plan.after.owner, 'clinical');
  assert.equal(second.plan.policy.beforeOpeningOwner, 'clinical');
  const maps = mod.callMaps(second.plan);
  assert.match(maps.before, /Clinical/i);
  assert.doesNotMatch(maps.before, /unset/i);
  const hear = mod.callerHear(second.plan);
  assert.ok(hear.some(row => /before opening/i.test(row.when) && /not yet open/i.test(row.hear)));
  const rec = mod.fusionBuild(second.plan).recordings.find(r => r.filename === 'before-opening-callback.wav');
  assert.ok(rec);
  assert.match(rec.script, /not yet open/i);
  assert.match(mod.headlineInsights(second.plan).map(i => i.id).join(' '), /before-ok/);
});



