'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const srcDir = path.join(__dirname, '../planner/src');
const outDir = path.join(__dirname, '../planner/.test-build');
fs.mkdirSync(outDir, { recursive: true });

fs.mkdirSync(path.join(outDir, 'architect'), { recursive: true });
for (const name of ['config', 'policy', 'routing', 'locations', 'fusion', 'plan-content', 'provisioning', 'status', 'readiness', 'bom', 'opening', 'advisor', 'flow', 'team-state', 'architect/questions']) {
  let out = ts.transpile(fs.readFileSync(path.join(srcDir, name + '.ts'), 'utf8'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  });
  out = out.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, "from '$1.mjs'");
  fs.mkdirSync(path.dirname(path.join(outDir, name + '.mjs')), { recursive: true });
  fs.writeFileSync(path.join(outDir, name + '.mjs'), out);
}

let loaded;
async function load() {
  if (!loaded) loaded = await import(path.join(outDir, 'config.mjs'));
  return loaded;
}

function complete(base) {
  const p = structuredClone(base);
  p.mode = p.mode || 'improving';
  p.name = p.name || 'Hudson Family Practice';
  p.specialty = p.specialty || 'Dental';
  p.teams.forEach((t, i) => {
    t.count = [3, 5, 2][i];
    t.status = 'known';
  });
  if (p.first.kind === 'undecided') p.first = { kind: 'human', team: 'reception' };
  p.reasons.forEach((r, i) => { r.team = r.team || ['reception', 'admin', 'clinical'][i]; });
  p.busy = {
    kind: p.busy.kind === 'undecided' ? 'message' : p.busy.kind,
    seconds: p.busy.seconds || 25,
    wait: p.busy.wait || 90,
    backup: p.busy.backup || 'admin',
    owner: p.busy.owner || 'reception'
  };
  p.after = {
    kind: p.after.kind === 'undecided' ? 'message' : p.after.kind,
    owner: p.after.owner || 'reception',
    instructions: p.after.instructions.trim() || 'Leave your name and callback number for our next business day.'
  };
  if (p.after.kind === 'information')
    p.after.instructions = p.after.instructions || 'Our office is closed. Please call back during business hours.';
  if (p.after.kind === 'service')
    p.after.instructions = p.after.instructions || 'Answering service may take a message; they cannot book or give clinical advice.';
  p.urgent = {
    enabled: p.urgent.enabled,
    approved: true,
    instructions: p.urgent.instructions.trim() || 'For an urgent practice matter, request the on-call team.',
    team: p.urgent.team || 'clinical',
    backup: p.urgent.backup || 'admin',
    seconds: p.urgent.seconds || 30,
    owner: p.urgent.owner || 'clinical'
  };
  p.urgent.enabled = true;
  p.followup = { owner: 'reception', target: 'By the next business day', channels: ['Phone callback'] };
  p.confirmed = ['hours', 'urgent', 'team', 'positions'];
  p.policy.notification = 'inbox';
  p.policy.languageDecision = p.languages.length ? 'selected' : 'none';
  p.policy.ring = p.policy.ring === 'undecided' ? 'together' : p.policy.ring;
  p.policy.urgentKind = p.urgent.enabled === false ? 'none' : (p.policy.urgentKind === 'undecided' ? 'connect' : p.policy.urgentKind);
  p.policy.urgentCoverage = 'always';
  p.policy.urgentRoster = 'fixed';
  p.policy.urgentBackup = p.policy.urgentBackup || 'team';
  p.policy.acceptance = true;
  p.policy.followup = 'yes';
  p.policy.hoursExceptionsConfirmed = true;
  p.policy.assistant = {
    tasks: ['General information', 'Capture a callback request', 'Appointment requests', 'Connect callers to a team'],
    humanWhen: 'request',
    team: 'reception',
    owner: 'reception',
    status: 'needs-confirmation'
  };
  if (!p.policy.placements.length)
    p.policy.placements = p.teams.map((t, i) => ({
      id: t.id, team: t.id, label: t.name,
      device: ['desk', 'computer', 'mobile'][i],
      count: [3, 2, 1][i], sharing: 'shared', access: 'outside', extension: ''
    }));
  p.hours.timezone = 'America/New_York';
  p.hours.holidayPolicy = 'closed';
  p.policy.terminalApprovals = {
    ...p.policy.terminalApprovals,
    'reason:appointments': true,
    'reason:billing': true,
    'reason:clinical-question': true,
    urgent: true
  };
  if (p.mode === 'opening') {
    p.policy.opening = {
      date: p.policy.opening.date || '2027-03-01',
      construction: p.policy.opening.construction === 'undecided' ? 'near' : p.policy.opening.construction,
      numbers: p.policy.opening.numbers === 'undecided' ? 'new' : p.policy.opening.numbers,
      internet: p.policy.opening.internet === 'undecided' ? 'survey' : p.policy.opening.internet,
      network: p.policy.opening.network === 'undecided' ? 'survey' : p.policy.opening.network,
      pms: p.policy.opening.pms || ''
    };
  }
  return p;
}

function applyFirst(p, kind, ring) {
  p.first = { kind, team: kind === 'human' ? 'reception' : '' };
  p.policy.ring = ring || (kind === 'human' ? 'together' : p.policy.ring);
  if (ring === 'order')
    p.policy.ringOrder = [{ team: 'reception', seconds: 20 }, { team: 'admin', seconds: 20 }];
  if (kind === 'menu')
    p.languages = p.languages.map(l => ({ ...l, mechanism: l.mechanism === 'staff' ? 'menu' : l.mechanism }));
  if (kind === 'assistant')
    p.languages = p.languages.map(l => ({ ...l, mechanism: 'assistant' }));
  if (kind === 'human')
    p.languages = p.languages.map(l => ({ ...l, mechanism: 'staff' }));
}

function walk(fn) {
  return test('combination walk: graphs terminate and Fusion maps every axis', async () => {
    const { initial, valid, graph, simulate, scenarios } = await load();
    const { inventory } = await import(path.join(outDir, 'policy.mjs'));
    const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
    const firsts = [
      ['human', 'together'],
      ['human', 'order'],
      ['menu', 'together'],
      ['assistant', 'together']
    ];
    const busys = ['message', 'queue', 'backup', 'assistant'];
    const afters = ['information', 'message', 'service', 'assistant'];
    const urgents = ['none', 'connect', 'priority', 'instructions'];
    let count = 0;
    const failures = [];
    for (const [kind, ring] of firsts) {
      for (const busy of busys) {
        for (const after of afters) {
          for (const urgent of urgents) {
            const p = complete(initial());
            applyFirst(p, kind, ring);
            p.busy.kind = busy;
            if (busy === 'queue') p.policy.queueExit = 'message';
            p.after.kind = after;
            if (after === 'information')
              p.after.instructions = 'Our office is closed. Please call back during business hours.';
            if (after === 'service')
              p.after.instructions = 'Answering service may take a message; they cannot book or give clinical advice.';
            if (urgent === 'none') {
              p.urgent.enabled = false;
              p.policy.urgentKind = 'none';
            } else {
              p.urgent.enabled = true;
              p.policy.urgentKind = urgent;
              if (urgent === 'instructions') p.urgent.approved = true;
            }
            p.endpoints = inventory(p);
            if (!valid(p)) {
              failures.push(`${kind}/${ring}/${busy}/${after}/${urgent}: invalid plan`);
              continue;
            }
            let g;
            try { g = graph(p); }
            catch (err) {
              failures.push(`${kind}/${ring}/${busy}/${after}/${urgent}: graph threw ${err.message}`);
              continue;
            }
            const seen = new Set();
            const visit = (id, stack) => {
              if (stack.includes(id)) throw new Error('cycle at ' + id);
              if (seen.has(id)) return;
              seen.add(id);
              const n = g.nodes[id];
              if (!n) throw new Error('missing ' + id);
              for (const e of n.edges) visit(e.to, [...stack, id]);
            };
            try { visit(g.start, []); }
            catch (err) {
              failures.push(`${kind}/${ring}/${busy}/${after}/${urgent}: ${err.message}`);
              continue;
            }
            for (const s of scenarios(p)) {
              const r = simulate(p, s);
              const end = r.trace.at(-1);
              if (!end || end.kind !== 'end')
                failures.push(`${kind}/${busy}/${after}/${urgent} scenario ${s.id} did not end`);
            }
            const b = fusionBuild(p);
            const kinds = new Set(b.objects.map(o => o.kind));
            const blob = b.analysis.join(' ') + ' ' + b.objects.map(o => o.name + ' ' + o.setup.join(' ')).join(' ');
            if (kind === 'menu' && !blob.toLowerCase().includes('ivr'))
              failures.push(`${kind}: Fusion advice missing IVR`);
            if (kind === 'human' && ring === 'together' && !blob.includes('simultaneous'))
              failures.push(`${kind}/${ring}: missing simultaneous ring group`);
            if (kind === 'human' && ring === 'order' && !blob.toLowerCase().includes('order'))
              failures.push(`${kind}/${ring}: missing ordered-ring advice`);
            if (kind === 'assistant' && !kinds.has('ai_bridge'))
              failures.push(`${kind}: missing AI bridge object`);
            if (after === 'assistant' && !kinds.has('ai_bridge'))
              failures.push(`after ${after}: missing AI bridge`);
            if (busy === 'queue' && !kinds.has('call_center'))
              failures.push('queue: missing Call Center object');
            if (after === 'information' && !b.recordings.some(r => r.filename.includes('after-hours-info')))
              failures.push('information: missing after-hours recording');
            if (urgent === 'connect' && after !== 'assistant' && !blob.includes('digit 9') && !blob.includes('escalate'))
              failures.push('urgent connect: missing digit 9 / escalate');
            if (!b.objects.some(o => o.kind === 'time_condition'))
              failures.push('missing time condition');
            if (!b.objects.some(o => o.kind === 'destination'))
              failures.push('missing destination');
            if (!b.checklist.length)
              failures.push('empty checklist');
            count += 1;
          }
        }
      }
    }
    assert.equal(failures.join('\n'), '', failures.join('\n'));
    assert.equal(count, firsts.length * busys.length * afters.length * urgents.length);
  });
}

test('completed human plan has no unresolved choices and original domain routes', async () => {
  const { initial, valid, decisions, graph, simulate, isOpen, affected, commit } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const p = complete(initial());
  p.languages = [{ name: 'Spanish', mechanism: 'staff', team: 'reception', availability: 'open', note: '', fallback: 'reception' }];
  p.policy.languageDecision = 'selected';
  p.busy.kind = 'queue';
  p.policy.queueExit = 'message';
  p.endpoints = inventory(p);
  assert(valid(p));
  assert.deepEqual(decisions(p), []);
  const g = graph(p);
  const walkGraph = (id, path) => {
    assert(g.nodes[id]);
    assert(!path.includes(id));
    for (const e of g.nodes[id].edges) walkGraph(e.to, [...path, id]);
  };
  walkGraph(g.start, []);
  const run = s => simulate(p, { id: 'test', label: 'test', open: true, ...s }).trace;
  assert(!run({ busy: true, language: 'Spanish' }).some(n => n.id === 'language'));
  assert.equal(run({ busy: true }).at(-1).id, 'busy-message');
  assert(run({ answered: true }).at(-1).id.endsWith('accepted'));
  assert.equal(run({ open: false }).at(-1).id, 'closed-message');
  const q = structuredClone(p);
  q.hours.timezone = 'America/New_York';
  assert(isOpen(q, new Date('2026-11-09T15:00:00Z')));
  assert(affected(q, 'reception').length > 0);
  assert.equal(commit(p, { ...p, name: 'New name' }).revision, 1);
});

test('Fusion maps devices, IVR, voicemail, Follow Me, and Spanish keypad', async () => {
  const { initial } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const { sections } = await import(path.join(outDir, 'plan-content.mjs'));
  const p = complete(initial());
  p.first = { kind: 'menu', team: '' };
  p.languages = [{ name: 'Spanish', mechanism: 'menu', team: 'reception', availability: 'open', note: '', fallback: 'reception' }];
  p.policy.languageDecision = 'selected';
  p.endpoints = inventory(p);
  const b = fusionBuild(p);
  assert(b.objects.some(o => o.kind === 'ivr' && o.extension === '9000'));
  assert(b.objects.some(o => o.kind === 'ivr' && o.extension === '9001'));
  assert(b.objects.some(o => o.kind === 'ivr' && o.extension === '9100'));
  assert(b.recordings.some(r => /oprima el 2/i.test(r.script) || /español/i.test(r.script)));
  assert(b.objects.some(o => o.kind === 'follow_me'));
  assert(b.objects.some(o => o.kind === 'voicemail' && o.setup.some(s => s.includes('*99'))));
  assert(b.objects.some(o => o.kind === 'extension' && o.setup.some(s => s.includes(':5081'))));
  assert(b.objects.some(o => o.kind === 'extension' && o.setup.some(s => s.includes(':7443'))));
  const titles = sections(p).map(([t]) => t);
  assert(titles.includes('FusionPBX build (how we actually set this up)'));
  assert(titles.includes('Recordings & announcements to approve'));
  const planText = sections(p).map(([, lines]) => lines.join('\n')).join('\n');
  assert(planText.includes('transfer'));
  assert(planText.includes('Time Condition'));
  assert(planText.includes('group 999'));
});

test('second location uses 8001 / 7010 / 6101, not a second Fusion domain', async () => {
  const { initial } = await load();
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  const b = fusionBuild(p, 1);
  assert(b.numbering.some(l => l.includes('8001')));
  assert(b.numbering.some(l => l.includes('7010')));
  assert(b.numbering.some(l => l.includes('6101')));
  assert(b.objects.some(o => o.kind === 'time_condition' && o.extension === '8001'));
  assert(b.analysis.some(l => /Time Condition 8001/.test(l)));
  assert(b.analysis.some(l => /one SIP domain|not extra Fusion domains/i.test(l)));
});

test('incompatible shared reception + menu is blocked in Fusion advice', async () => {
  const { initial, graph, simulate } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  p.locations = [{ id: 'location-1', name: 'Main' }, { id: 'location-2', name: 'North' }];
  p.policy.locationEntry = 'shared';
  p.first = { kind: 'menu', team: '' };
  p.endpoints = inventory(p);
  const b = fusionBuild(p);
  assert(b.blockers.some(x => /shared reception/i.test(x)));
  const end = simulate(p, { id: 'x', label: 'x', open: true, answered: true }).trace.at(-1);
  assert.equal(end.id, 'unresolved');
  const g = graph(p);
  assert(g.nodes.start);
});

test('after-hours AI points group 999 at the bridge, not the daytime IVR', async () => {
  const { initial } = await load();
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  p.after.kind = 'assistant';
  const b = fusionBuild(p);
  const tc = b.objects.find(o => o.kind === 'time_condition');
  assert(tc.setup.some(s => /group 999/i.test(s) && /6100/.test(s)));
  const openLine = tc.setup.find(s => s.startsWith('Open groups'));
  assert(openLine);
  assert(!openLine.includes('6100'));
});

test('Dental vs eye-care notes stay specific', async () => {
  const { initial } = await load();
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const dental = complete(initial());
  dental.specialty = 'Dental';
  const eye = complete(initial());
  eye.specialty = 'Eye care';
  assert(fusionBuild(dental).specialty.some(s => /dental/i.test(s)));
  assert(fusionBuild(eye).specialty.some(s => /optical|eye/i.test(s)));
  assert(!fusionBuild(dental).specialty.some(s => /optical shop/i.test(s)));
});

test('opening-day announcement is a Destination flip, not a Time Condition', async () => {
  const { initial, scenarios, simulate } = await load();
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  p.mode = 'opening';
  p.policy.beforeOpening = 'information';
  p.policy.beforeOpeningText = 'We open Monday. Please call back then.';
  const b = fusionBuild(p);
  assert(b.analysis.some(l => /opening morning/i.test(l) || /before opening/i.test(l)));
  assert(b.recordings.some(r => r.filename === 'before-opening.wav'));
  assert(scenarios(p).some(s => s.id === 'before-opening'));
  assert.equal(simulate(p, scenarios(p).find(s => s.id === 'before-opening')).trace.at(-1).kind, 'end');
});

test('lunch is its own recording, not overnight IVR or on-call', async () => {
  const { initial } = await load();
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  p.hours.days[0].breakStart = '12:00';
  p.hours.days[0].breakEnd = '13:00';
  const b = fusionBuild(p);
  const lunch = b.recordings.find(r => r.filename === 'lunch-closed.wav');
  assert(lunch);
  assert.match(lunch.script, /this afternoon/i);
  assert.doesNotMatch(lunch.script, /next business day/i);
  const tc = b.objects.find(o => o.kind === 'time_condition');
  assert(tc.setup.some(s => /Lunch groups/.test(s) && /not the overnight/i.test(s)));
});

test('breaks become two minute-of-day groups with exclusive close', async () => {
  const { initial } = await load();
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  p.hours.days[0].breakStart = '12:00';
  p.hours.days[0].breakEnd = '13:00';
  const tc = fusionBuild(p).objects.find(o => o.kind === 'time_condition');
  const line = tc.setup.find(s => s.startsWith('Open groups'));
  assert(line.includes('minute-of-day 540-719'));
  assert(line.includes('minute-of-day 780-1019'));
});

test('multi-location separate vs menu vs shared Fusion objects', async () => {
  const { initial, graph, scenarios, simulate, valid } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  for (const entry of ['separate', 'menu', 'shared']) {
    const p = complete(initial());
    p.locations = [{ id: 'location-1', name: 'Main' }, { id: 'location-2', name: 'North' }];
    p.policy.locationEntry = entry;
    p.policy.number = entry === 'separate' ? 'own' : 'shared';
    if (entry === 'shared') p.first = { kind: 'human', team: 'reception' };
    if (entry === 'menu') p.first = { kind: 'menu', team: '' };
    p.endpoints = inventory(p);
    assert(valid(p));
    const b = fusionBuild(p, 0);
    const blob = b.analysis.join(' ');
    if (entry === 'separate') assert(/own DID|own DID in Destinations|Each location has its own DID/i.test(blob));
    if (entry === 'menu') {
      assert(b.objects.some(o => o.extension === '9200'));
      assert(/location IVR/i.test(blob));
    }
    if (entry === 'shared') assert(/shared reception/i.test(blob));
    for (const s of scenarios(p))
      assert.equal(simulate(p, s).trace.at(-1).kind, 'end');
    graph(p);
  }
});

test('always-on Spanish without after-hours identification is called out', async () => {
  const { initial } = await load();
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  p.first = { kind: 'human', team: 'reception' };
  p.after.kind = 'message';
  p.languages = [{ name: 'Spanish', mechanism: 'staff', team: 'reception', availability: 'always', note: '', fallback: 'reception' }];
  const b = fusionBuild(p);
  assert(b.analysis.some(l => /all-hours/i.test(l) && /closed/i.test(l)));
});

test('shared vs separate reception identities', async () => {
  const { initial } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const { provisioningMap } = await import(path.join(outDir, 'provisioning.mjs'));
  const shared = complete(initial());
  shared.endpoints = inventory(shared);
  const sharedMap = provisioningMap(shared);
  assert.equal(sharedMap.identities.filter(x => x.team === 'reception').length, 1);
  assert.equal(sharedMap.identities.find(x => x.team === 'reception').registrations, 3);
  const rg = fusionBuild(shared).objects.find(o => o.kind === 'ring_group' && o.extension === '7000');
  assert(rg.setup.some(s => /201/.test(s) && /3 registrations/.test(s)));
  assert(!rg.setup.some(s => /202/.test(s)));
  const separate = complete(initial());
  separate.policy.placements = separate.policy.placements.map(x => x.team === 'reception' ? { ...x, sharing: 'separate' } : x);
  separate.endpoints = inventory(separate);
  const sepMap = provisioningMap(separate);
  assert.deepEqual(sepMap.identities.filter(x => x.team === 'reception').map(x => x.extension), ['201', '202', '203']);
  const rg2 = fusionBuild(separate).objects.find(o => o.kind === 'ring_group' && o.extension === '7000');
  assert(rg2.setup.some(s => /201/.test(s) && /202/.test(s) && /203/.test(s)));
});

test('queue wait is ring plus queue, not queue alone', async () => {
  const { initial, journeySeconds } = await load();
  const p = complete(initial());
  p.busy.kind = 'queue';
  p.busy.seconds = 25;
  p.busy.wait = 90;
  p.policy.queueExit = 'message';
  p.endpoints = (await import(path.join(outDir, 'policy.mjs'))).inventory(p);
  const j = journeySeconds(p, { id: 'unanswered', label: 'Open · nobody answers', open: true, answered: false });
  assert.equal(j.total, 115);
  assert(j.parts.some(x => x.seconds === 25));
  assert(j.parts.some(x => x.seconds === 90));
});

test('owner blueprint omits Fusion ports; engineer spec keeps them', async () => {
  const { initial } = await load();
  const { ownerSections, engineerSections, sections } = await import(path.join(outDir, 'plan-content.mjs'));
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const p = complete(initial());
  p.endpoints = inventory(p);
  const owner = ownerSections(p).map(([, lines]) => lines.join('\n')).join('\n');
  const engineer = engineerSections(p).map(([, lines]) => lines.join('\n')).join('\n');
  assert(!/:5081/.test(owner));
  assert(!/:7443/.test(owner));
  assert(!/reloadxml/.test(owner));
  assert(!/v_dialplan_details/.test(owner));
  assert(/:5081/.test(engineer));
  assert(/Time Condition/.test(engineer));
  assert(sections(p).some(([t]) => t.includes('FusionPBX')));
  assert(owner.includes('clinical rooms') || owner.includes('Clinical rooms') || owner.includes('room count'));
});

test('opening workflow records date and contractor handoff', async () => {
  const { initial, scenarios, simulate } = await load();
  const { ownerSections } = await import(path.join(outDir, 'plan-content.mjs'));
  const { openingChecklist } = await import(path.join(outDir, 'opening.mjs'));
  const p = complete(initial());
  p.mode = 'opening';
  p.policy.beforeOpening = 'information';
  p.policy.beforeOpeningText = 'We open Monday. Please call back then.';
  p.policy.opening = { date: '2027-03-01', construction: 'build-out', numbers: 'new', internet: 'survey', network: 'survey', pms: '' };
  const text = ownerSections(p).map(([, lines]) => lines.join('\n')).join('\n');
  assert(text.includes('2027-03-01'));
  assert(text.includes('Contractor handoff') || text.includes('Hand this section'));
  assert(openingChecklist(p).some(c => c.id === 'handoff' && !c.done));
  assert(scenarios(p).some(s => s.id === 'before-opening'));
  assert.equal(simulate(p, scenarios(p).find(s => s.id === 'before-opening')).trace.at(-1).kind, 'end');
});

test('changing first answer recomputes Fusion objects', async () => {
  const { initial } = await load();
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const p = complete(initial());
  p.endpoints = inventory(p);
  assert(fusionBuild(p).objects.some(o => o.kind === 'ring_group'));
  p.first = { kind: 'menu', team: '' };
  const b = fusionBuild(p);
  assert(b.objects.some(o => o.kind === 'ivr' && o.extension === '9000'));
});

test('clinical unanswered sharing reception mailbox stays unresolved until approved', async () => {
  const { initial, decisions } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const p = complete(initial());
  p.policy.terminalApprovals = {};
  p.endpoints = inventory(p);
  assert(decisions(p).some(d => /clinical/i.test(d) && /mailbox/i.test(d)));
});

test('readiness is not questionnaire completeness', async () => {
  const { initial, decisions } = await load();
  const { readiness } = await import(path.join(outDir, 'readiness.mjs'));
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const p = complete(initial());
  p.endpoints = inventory(p);
  const r = readiness(p);
  assert(r.label.includes('not deployable') || r.blockers.length > 0 || /not operational|not an installed system/i.test(r.label));
  assert(!/your setup is ready/i.test(r.label));
  assert(!/Ready to review/i.test(r.label));
  assert(!/Implementation checklist complete/i.test(r.label));
  assert(r.owner && r.provider && r.tests);
  decisions(p);
});

test('menu keypad cannot classify spoken urgency', async () => {
  const { initial, graph, simulate, scenarios } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const p = complete(initial());
  p.first = { kind: 'menu', team: '' };
  p.busy.kind = 'queue';
  p.policy.queueExit = 'message';
  p.endpoints = inventory(p);
  const g = graph(p);
  assert(!Object.values(g.nodes).some(n => /urgent need stated/i.test(n.label)));
  assert(g.nodes.menu);
  assert(g.nodes.menu.edges.some(e => e.when === 'urgent'));
  assert(/digit 9|9: Urgent/i.test(g.nodes.menu.detail));
  const openUrgent = scenarios(p).find(s => s.id === 'open-urgent');
  assert(openUrgent);
  const end = simulate(p, openUrgent).trace;
  assert(end.some(n => n.id === 'menu'));
  assert(!end.some(n => n.id === 'intent' && /stated/i.test(n.label)));
});

test('staff-first urgency happens after answer, not at the keypad', async () => {
  const { initial, graph } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const p = complete(initial());
  p.first = { kind: 'human', team: 'reception' };
  p.policy.ring = 'together';
  p.endpoints = inventory(p);
  const g = graph(p);
  assert(g.nodes.intent);
  assert(/Staff identifies/i.test(g.nodes.intent.label));
  assert(!g.nodes.menu);
});

test('queue agents are the overflowing teams, not an empty first-answer team', async () => {
  const { initial } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const { queueAgents, queuePlan } = await import(path.join(outDir, 'advisor.mjs'));
  const p = complete(initial());
  p.first = { kind: 'menu', team: '' };
  p.busy.kind = 'queue';
  p.policy.queueExit = 'message';
  p.endpoints = inventory(p);
  const qa = queueAgents(p);
  const plan = queuePlan(p);
  assert.equal(qa.needed, true);
  assert(qa.members.length > 0);
  assert(plan.queues.length >= 2);
  const clinical = plan.queues.find(q => q.team === 'clinical');
  const reception = plan.queues.find(q => q.team === 'reception');
  assert(clinical && reception);
  const recExt = new Set(reception.members.map(m => m.extension));
  assert(!clinical.members.some(m => recExt.has(m.extension)));
  const centers = fusionBuild(p).objects.filter(o => o.kind === 'call_center');
  assert.equal(centers.length, plan.queues.length);
  const blob = centers.map(o => o.setup.join(' ')).join(' ');
  assert(!/Agents = first-answer/i.test(blob));
  assert(qa.members.some(m => blob.includes(m.extension)));
});

test('compiled daytime ring groups timeout to per-team queues, not voicemail', async () => {
  const { initial, simulate, scenarios, overflowTeams } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { fusionBuild, parityReport } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  p.first = { kind: 'menu', team: '' };
  p.busy.kind = 'queue';
  p.policy.queueExit = 'message';
  p.endpoints = inventory(p);
  const b = fusionBuild(p);
  const unanswered = scenarios(p).find(s => s.id === 'unanswered');
  assert(unanswered);
  for (const r of p.reasons) {
    const team = r.team === '@main' ? p.first.team : r.team;
    const ids = simulate(p, { ...unanswered, reason: r.id }).trace.map(n => n.id);
    assert(ids.includes('queue-' + team), r.label + ' ' + ids.join('>'));
  }
  const daytime = b.objects.filter(o => o.kind === 'ring_group' && !/on-call/i.test(o.name));
  assert(daytime.length > 0);
  for (const g of daytime) {
    const timeout = g.setup.find(s => /timeout_data/.test(s)) || '';
    assert(/5\d{3}/.test(timeout), g.name + ' ' + timeout);
    assert(!/\*99/.test(timeout), g.name + ' leaked voicemail ' + timeout);
  }
  assert.equal(overflowTeams(p).length, b.objects.filter(o => o.kind === 'call_center').length);
  assert.deepEqual(parityReport(p), []);
});

test('menu greetings announce every configured digit including 9', async () => {
  const { initial, menuDigits } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  p.first = { kind: 'menu', team: '' };
  p.busy.kind = 'queue';
  p.policy.queueExit = 'message';
  p.endpoints = inventory(p);
  const digits = menuDigits(p);
  assert(digits.some(d => d.digit === '9' && d.kind === 'urgent'));
  const recs = fusionBuild(p).recordings.filter(r => r.filename === 'ivr-open-greeting.wav' || r.filename === 'ivr-open-short.wav');
  assert.equal(recs.length, 2);
  for (const rec of recs) {
    for (const d of digits)
      assert(new RegExp('press ' + d.digit, 'i').test(rec.script), rec.filename + ' missing ' + d.digit + ': ' + rec.script);
    assert(/life-threatening emergency/i.test(rec.script));
    assert(/911/.test(rec.script));
  }
  const ivr = fusionBuild(p).objects.find(o => o.kind === 'ivr' && /reason menu/.test(o.name));
  assert(ivr);
  for (const d of digits)
    assert(ivr.setup.some(s => s.includes('Digit ' + d.digit)), 'IVR missing digit ' + d.digit);
});

test('spanish greeting announces the same digits as the english menu', async () => {
  const { initial, menuDigits } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  p.first = { kind: 'menu', team: '' };
  p.languages = [{ name: 'Spanish', mechanism: 'menu', team: 'reception', availability: 'open', note: '', fallback: 'reception' }];
  p.endpoints = inventory(p);
  const es = fusionBuild(p).recordings.find(r => r.filename === 'ivr-open-es.wav');
  assert(es);
  for (const d of menuDigits(p))
    assert(es.script.includes('oprima ' + d.digit) || es.script.includes('oprima el ' + d.digit), es.script);
  assert(/911/.test(es.script));
  const lang = fusionBuild(p).recordings.find(r => r.filename === 'ivr-language.wav');
  assert(lang);
  assert(!/Press 1 for Appointments/i.test(lang.script));
});

test('before-opening installer notes are blocked when unresolved', async () => {
  const { initial } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { fusionBuild, fusionScenarioNote } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  p.mode = 'opening';
  p.policy.beforeOpening = 'undecided';
  p.endpoints = inventory(p);
  const note = fusionScenarioNote(p, 'before-opening');
  assert(/BLOCKED/.test(note));
  assert(!/still on the before-opening announcement/i.test(note));
  const dest = fusionBuild(p).objects.filter(o => o.kind === 'destination');
  assert(dest.some(o => /before opening/i.test(o.name) && o.setup.some(s => /BLOCKED/.test(s))));
  assert(dest.some(o => /after opening/i.test(o.name)));
  assert.deepEqual(fusionBuild(p).parity.filter(x => /before-opening/i.test(x)), []);
});

test('owner glance is operational, room phones are not a shopping quantity', async () => {
  const { initial } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { glance, purchaseBands, callBranches } = await import(path.join(outDir, 'advisor.mjs'));
  const p = complete(initial());
  p.name = 'Hudson Family Practice';
  p.first = { kind: 'menu', team: '' };
  p.busy.kind = 'queue';
  p.policy.queueExit = 'message';
  p.policy.roomsSpecified = true;
  p.policy.rooms = 6;
  p.endpoints = inventory(p);
  const g = glance(p);
  assert.equal(g.practice, 'Hudson Family Practice');
  assert(!g.metrics.some(m => /SIP/i.test(m.label)));
  assert(g.metrics.some(m => /Independent answering/i.test(m.label)));
  const rooms = purchaseBands(p).notYet.find(r => /room/i.test(r.item));
  assert(rooms);
  assert.equal(rooms.qty, '0 selected');
  assert(!/^6$/.test(rooms.qty));
  const branches = callBranches(p);
  assert(branches.some(b => b.digit === '9'));
  assert(branches.filter(b => b.digit && b.digit !== '9').every(b => /Queue/.test(b.missed)));
  assert(branches.find(b => b.digit === '9').missed.includes('On-call'));
});

test('daytime ring-group timeout is not the on-call timeout', async () => {
  const { initial } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const p = complete(initial());
  p.busy.seconds = 25;
  p.urgent.seconds = 30;
  p.urgent.enabled = true;
  p.policy.urgentKind = 'connect';
  p.endpoints = inventory(p);
  const b = fusionBuild(p);
  const daytime = b.objects.filter(o => o.kind === 'ring_group' && !/on-call/i.test(o.name));
  assert(daytime.length > 0);
  for (const g of daytime) {
    const blob = g.setup.join(' ');
    assert(/call timeout 25s/.test(blob), g.name + ' ' + blob);
    assert(/timeout 25/.test(blob));
    assert(!/call timeout 30s/.test(blob), g.name);
  }
  const onCall = b.objects.find(o => /on-call/i.test(o.name));
  assert(onCall);
  assert(onCall.setup.join(' ').includes('30s'));
});

test('owner and engineer artifacts share plan ID, revision, and checksum', async () => {
  const { initial } = await load();
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { identity, fingerprint } = await import(path.join(outDir, 'advisor.mjs'));
  const { engineerSections } = await import(path.join(outDir, 'plan-content.mjs'));
  const p = complete(initial());
  p.endpoints = inventory(p);
  const a = identity(p);
  p.updatedAt = new Date('2030-01-01T00:00:00Z').toISOString();
  assert.equal(identity(p).checksum, a.checksum);
  p.name = 'Renamed Practice';
  assert.notEqual(fingerprint(p), a.checksum);
  p.name = a.planId ? complete(initial()).name : p.name;
  const snap = complete(initial());
  snap.endpoints = inventory(snap);
  const id = identity(snap);
  const text = engineerSections(snap).map(([, lines]) => lines.join('\n')).join('\n');
  assert(text.includes(id.planId));
  assert(text.includes(id.checksum));
  assert(text.includes('revision ' + id.revision));
});

walk();
