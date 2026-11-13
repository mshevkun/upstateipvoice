#!/usr/bin/env node
/**
 * Walk every planner combination and write PDF + analysis files
 * into planner/walkthroughs/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'planner/src');
const buildDir = path.join(root, 'planner/.test-build');
const outDir = path.join(root, 'planner/walkthroughs');
const fontPath = path.join(root, 'planner/public/assets/InstrumentSans.ttf');

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(path.join(buildDir, 'architect'), { recursive: true });
for (const name of ['config', 'policy', 'routing', 'locations', 'fusion', 'plan-content', 'pdf', 'provisioning', 'status', 'readiness', 'privacy', 'bom', 'opening', 'advisor', 'owner-brief', 'engineer-brief', 'flow', 'team-state', 'architect/hear']) {
  let out = ts.transpile(fs.readFileSync(path.join(srcDir, name + '.ts'), 'utf8'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  });
  out = out.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, "from '$1.mjs'");
  if (name === 'pdf') {
    out = out.replace(
      "import fontkit from '@pdf-lib/fontkit';",
      "import fontkitMod from '@pdf-lib/fontkit';\nconst fontkit = fontkitMod.default || fontkitMod;"
    );
  }
  fs.writeFileSync(path.join(buildDir, name + '.mjs'), out);
}

const { initial, valid, decisions, graph, simulate, scenarios } = await import(path.join(buildDir, 'config.mjs'));
const { inventory } = await import(path.join(buildDir, 'policy.mjs'));
const { fusionBuild } = await import(path.join(buildDir, 'fusion.mjs'));
const { sections } = await import(path.join(buildDir, 'plan-content.mjs'));
const { createPDF } = await import(path.join(buildDir, 'pdf.mjs'));

const fontBytes = fs.readFileSync(fontPath).buffer.slice(
  fs.readFileSync(fontPath).byteOffset,
  fs.readFileSync(fontPath).byteOffset + fs.statSync(fontPath).size
);
const fontFile = fs.readFileSync(fontPath);

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function complete(base = initial()) {
  const p = structuredClone(base);
  p.mode = p.mode || 'improving';
  p.name = p.name || 'Hudson Family Practice';
  p.specialty = p.specialty || 'Dental';
  p.teams.forEach((t, i) => {
    if (t.status === 'unanswered') t.status = 'known';
    if (!t.count) t.count = [3, 5, 2][i] || 1;
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
    instructions: (p.after.instructions || '').trim() || 'Leave your name and callback number for our next business day.'
  };
  if (p.after.kind === 'information')
    p.after.instructions = 'Our office is closed. We reopen at 9:00 AM on the next business day. This recording is not clinical advice.';
  if (p.after.kind === 'service')
    p.after.instructions = 'Answering service may take a message. They cannot book appointments or give clinical advice.';
  if (p.after.kind === 'assistant')
    p.after.instructions = 'After hours the virtual receptionist may take a callback request. No bookings or clinical advice.';
  p.urgent = {
    enabled: p.urgent.enabled,
    approved: true,
    instructions: (p.urgent.instructions || '').trim() || 'For an urgent practice matter, request the on-call team. If this is a life-threatening emergency, hang up and call 911.',
    team: p.urgent.team || 'clinical',
    backup: p.urgent.backup || 'admin',
    seconds: p.urgent.seconds || 30,
    owner: p.urgent.owner || 'clinical'
  };
  p.followup = p.followup.owner
    ? p.followup
    : { owner: 'reception', target: 'By the next business day', channels: ['Phone callback'] };
  p.confirmed = [...new Set([...(p.confirmed || []), 'hours', 'urgent', 'team', 'positions', 'first', 'reasons', 'busy', 'after'])];
  p.policy.notification = p.policy.notification === 'undecided' ? 'inbox' : p.policy.notification;
  p.policy.languageDecision = p.languages.length ? 'selected' : (p.policy.languageDecision === 'undecided' ? 'none' : p.policy.languageDecision);
  if (p.policy.ring === 'undecided') p.policy.ring = 'together';
  if (p.policy.urgentKind === 'undecided') p.policy.urgentKind = p.urgent.enabled ? 'connect' : 'none';
  if (p.policy.urgentCoverage === 'undecided') p.policy.urgentCoverage = 'always';
  if (p.policy.urgentRoster === 'undecided') p.policy.urgentRoster = 'fixed';
  p.policy.acceptance = true;
  if (p.policy.followup === 'skip' && !p.followup.owner) p.policy.followup = 'skip';
  else if (p.policy.followup === 'skip') { /* keep */ }
  else p.policy.followup = 'yes';
  p.policy.hoursExceptionsConfirmed = true;
  p.policy.assistant = {
    tasks: p.policy.assistant.tasks.length
      ? p.policy.assistant.tasks
      : ['General information', 'Capture a callback request', 'Appointment requests', 'Connect callers to a team'],
    humanWhen: p.policy.assistant.humanWhen || 'request',
    team: p.policy.assistant.team || 'reception',
    owner: p.policy.assistant.owner || 'reception',
    status: 'needs-confirmation',
    handoffTasks: p.policy.assistant.handoffTasks
  };
  if (!p.policy.placements.length)
    p.policy.placements = p.teams.map((t, i) => ({
      id: t.id, team: t.id, label: t.name,
      device: ['desk', 'computer', 'mobile'][i],
      count: [3, 2, 1][i], sharing: 'shared', access: 'outside', extension: ''
    }));
  p.hours.timezone = p.hours.timezone || 'America/New_York';
  p.hours.holidayPolicy = p.hours.holidayPolicy || 'closed';
  p.policy.terminalApprovals = {
    ...p.policy.terminalApprovals,
    'reason:appointments': true,
    'reason:billing': true,
    'reason:clinical-question': true,
    urgent: true
  };
  if (p.mode === 'opening' || !p.policy.opening.date) {
    p.policy.opening = {
      date: p.mode === 'opening' ? (p.policy.opening.date || '2027-03-01') : p.policy.opening.date,
      construction: p.mode === 'opening' && p.policy.opening.construction === 'undecided' ? 'near' : p.policy.opening.construction,
      numbers: p.mode === 'opening' && p.policy.opening.numbers === 'undecided' ? 'new' : p.policy.opening.numbers,
      internet: p.mode === 'opening' && p.policy.opening.internet === 'undecided' ? 'survey' : p.policy.opening.internet,
      network: p.mode === 'opening' && p.policy.opening.network === 'undecided' ? 'survey' : p.policy.opening.network,
      pms: p.policy.opening.pms || ''
    };
  }
  p.endpoints = inventory(p);
  p.revision = Math.max(1, p.revision || 1);
  p.updatedAt = '2026-11-08T17:00:00.000Z';
  return p;
}

function applyFirst(p, kind, ring) {
  p.first = { kind, team: kind === 'human' ? 'reception' : '' };
  p.policy.ring = ring || (kind === 'human' ? 'together' : p.policy.ring);
  if (ring === 'order')
    p.policy.ringOrder = [{ team: 'reception', seconds: 20 }, { team: 'admin', seconds: 20 }];
  else
    p.policy.ringOrder = [];
}

function applyUrgent(p, urgent) {
  if (urgent === 'none') {
    p.urgent.enabled = false;
    p.policy.urgentKind = 'none';
    return;
  }
  p.urgent.enabled = true;
  p.policy.urgentKind = urgent;
  p.urgent.approved = true;
}

function applyBusy(p, busy) {
  p.busy.kind = busy;
  if (busy === 'queue') p.policy.queueExit = p.policy.queueExit === 'undecided' ? 'message' : p.policy.queueExit;
}

function applyAfter(p, after) {
  p.after.kind = after;
  if (after === 'information')
    p.after.instructions = 'Our office is closed. We reopen at 9:00 AM on the next business day. This recording is not clinical advice.';
  if (after === 'service')
    p.after.instructions = 'Answering service may take a message. They cannot book appointments or give clinical advice.';
  if (after === 'assistant')
    p.after.instructions = 'After hours the virtual receptionist may take a callback request. No bookings or clinical advice.';
}

function applyLanguage(p, mechanism) {
  if (!mechanism) {
    p.languages = [];
    p.policy.languageDecision = 'none';
    return;
  }
  p.languages = [{
    name: 'Spanish',
    mechanism,
    team: 'reception',
    availability: 'open',
    note: '',
    fallback: 'reception'
  }];
  p.policy.languageDecision = 'selected';
  p.policy.languageProviders = { Spanish: 'team' };
  p.policy.languageFallbacks = { Spanish: { kind: 'callback', team: '', text: '', approved: false } };
}

function variants() {
  const list = [];
  const firsts = [['human', 'together'], ['human', 'order'], ['menu', 'together'], ['assistant', 'together']];
  const busys = ['message', 'queue', 'backup', 'assistant'];
  const afters = ['information', 'message', 'service', 'assistant'];
  const urgents = ['none', 'connect', 'priority', 'instructions'];
  for (const [kind, ring] of firsts) {
    for (const busy of busys) {
      for (const after of afters) {
        for (const urgent of urgents) {
          const p = complete();
          applyFirst(p, kind, ring);
          applyBusy(p, busy);
          applyAfter(p, after);
          applyUrgent(p, urgent);
          applyLanguage(p, kind === 'menu' ? 'menu' : kind === 'assistant' ? 'assistant' : kind === 'human' ? 'staff' : '');
          p.endpoints = inventory(p);
          list.push({
            group: 'matrix',
            id: slug(`matrix-${kind}-${ring}-${busy}-${after}-${urgent}`),
            title: `${kind} ${ring} · busy ${busy} · after ${after} · urgent ${urgent}`,
            plan: p
          });
        }
      }
    }
  }

  const extras = [];
  const push = (id, title, fn) => {
    const p = complete();
    applyFirst(p, 'human', 'together');
    applyBusy(p, 'message');
    applyAfter(p, 'message');
    applyUrgent(p, 'connect');
    applyLanguage(p, 'staff');
    fn(p);
    p.endpoints = inventory(p);
    extras.push({ group: 'detail', id: slug('detail-' + id), title, plan: p });
  };

  push('specialty-dental', 'Specialty: Dental', p => { p.specialty = 'Dental'; });
  push('specialty-eye', 'Specialty: Eye care', p => { p.specialty = 'Eye care'; });
  push('specialty-other', 'Specialty: Other (family medicine)', p => { p.specialty = 'Other healthcare practice'; p.specialtyDetail = 'Family medicine'; });
  push('mode-opening-info', 'Opening day · play information', p => {
    p.mode = 'opening';
    p.policy.beforeOpening = 'information';
    p.policy.beforeOpeningText = 'We are not yet open. Please call back after our opening date. This is not a booking.';
  });
  push('mode-opening-message', 'Opening day · callback voicemail', p => {
    p.mode = 'opening';
    p.policy.beforeOpening = 'message';
    p.policy.beforeOpeningOwner = 'reception';
  });
  push('mode-opening-buildout', 'Opening day · under construction with contractor handoff', p => {
    p.mode = 'opening';
    p.policy.beforeOpening = 'information';
    p.policy.beforeOpeningText = 'We are not yet open. Please call back after 1 March 2027.';
    p.policy.opening = { date: '2027-03-01', construction: 'build-out', numbers: 'porting', internet: 'survey', network: 'survey', pms: 'OpenDental' };
    p.policy.roomsSpecified = true;
    p.policy.rooms = 4;
    p.policy.continuity = { internet: 'failover', power: 'ups', backupRouting: 'cellular', notes: 'Confirm failover on site.' };
    p.policy.e911Confirmed = false;
    p.policy.baaAcknowledged = true;
  });
  push('sharing-separate-reception', 'Three independent reception extensions', p => {
    p.policy.placements = p.policy.placements.map(x => x.team === 'reception' ? { ...x, sharing: 'separate', count: 3 } : x);
    p.policy.roomsSpecified = true;
    p.policy.rooms = 4;
  });
  push('unapproved-clinical-mailbox', 'Clinical unanswered still shares reception until confirmed', p => {
    p.policy.terminalApprovals = { 'reason:appointments': true, 'reason:billing': true };
  });
  push('mode-adding-own-did', 'Adding a location with its own number', p => {
    p.mode = 'adding';
    p.locations = [{ id: 'location-1', name: 'Main' }, { id: 'location-2', name: 'North office' }];
    p.policy.locationEntry = 'separate';
    p.policy.number = 'own';
  });
  push('locations-menu', 'Two locations · caller location menu', p => {
    p.locations = [{ id: 'location-1', name: 'Main' }, { id: 'location-2', name: 'North office' }];
    p.policy.locationEntry = 'menu';
    applyFirst(p, 'menu', 'together');
    applyLanguage(p, 'menu');
  });
  push('locations-shared', 'Two locations · shared reception', p => {
    p.locations = [{ id: 'location-1', name: 'Main' }, { id: 'location-2', name: 'North office' }];
    p.policy.locationEntry = 'shared';
    applyFirst(p, 'human', 'together');
  });
  push('locations-shared-blocked-menu', 'Incompatible: shared reception + menu', p => {
    p.locations = [{ id: 'location-1', name: 'Main' }, { id: 'location-2', name: 'North office' }];
    p.policy.locationEntry = 'shared';
    applyFirst(p, 'menu', 'together');
    applyLanguage(p, 'menu');
  });
  push('lang-none', 'No additional language', p => applyLanguage(p, ''));
  push('lang-spanish-always-message', 'Spanish all-hours but after-hours is only a message', p => {
    applyLanguage(p, 'staff');
    p.languages[0].availability = 'always';
    applyAfter(p, 'message');
  });
  push('lang-spanish-limited', 'Spanish limited hours', p => {
    applyLanguage(p, 'staff');
    p.languages[0].availability = 'limited';
    p.languages[0].note = 'Wednesdays 13:00–17:00';
    p.policy.languageSchedules = {
      Spanish: p.hours.days.map(d => d.day === 'Wednesday'
        ? { ...d, open: true, start: '13:00', end: '17:00' }
        : { ...d, open: false })
    };
  });
  push('lang-spanish-instructions-fallback', 'Spanish unavailable → approved instructions', p => {
    applyLanguage(p, 'staff');
    p.policy.languageFallbacks = {
      Spanish: { kind: 'instructions', team: '', text: 'A Spanish-speaking team member will return your call the next business day.', approved: true }
    };
  });
  push('lang-spanish-service-provider', 'Spanish via external language service', p => {
    applyLanguage(p, 'staff');
    p.policy.languageProviders = { Spanish: 'service' };
  });
  push('busy-queue-exit-backup', 'Queue exit: backup team', p => {
    applyBusy(p, 'queue');
    p.policy.queueExit = 'backup';
    p.busy.backup = 'admin';
  });
  push('busy-queue-exit-assistant', 'Queue exit: virtual receptionist', p => {
    applyBusy(p, 'queue');
    p.policy.queueExit = 'assistant';
  });
  push('menu-invalid-team', 'Menu invalid/no-input → fallback team', p => {
    applyFirst(p, 'menu', 'together');
    applyLanguage(p, 'menu');
    p.menu.invalid = 'team';
    p.menu.noInput = 'team';
    p.menu.team = 'reception';
  });
  push('menu-retries-0', 'Menu retries = 0', p => {
    applyFirst(p, 'menu', 'together');
    applyLanguage(p, 'menu');
    p.policy.menuRetries = 0;
  });
  push('menu-retries-2', 'Menu retries = 2', p => {
    applyFirst(p, 'menu', 'together');
    applyLanguage(p, 'menu');
    p.policy.menuRetries = 2;
  });
  push('hours-lunch-break', 'Weekday lunch break 12:00–13:00', p => {
    p.hours.days = p.hours.days.map(d => d.open ? { ...d, breakStart: '12:00', breakEnd: '13:00' } : d);
  });
  push('hours-saturday-open', 'Saturday 09:00–13:00 open', p => {
    p.hours.days = p.hours.days.map(d => d.day === 'Saturday' ? { ...d, open: true, start: '09:00', end: '13:00' } : d);
  });
  push('hours-holiday-regular', 'Listed holiday keeps regular hours', p => {
    p.hours.holidays = ['2026-12-25'];
    p.hours.holidayPolicy = 'regular';
  });
  push('hours-holiday-closed', 'Christmas closed + temporary closure', p => {
    p.hours.holidays = ['2026-12-25'];
    p.hours.holidayPolicy = 'closed';
    p.policy.closures = ['2026-12-26'];
  });
  push('hours-chicago', 'Timezone America/Chicago', p => { p.hours.timezone = 'America/Chicago'; });
  push('urgent-coverage-closed', 'On-call only after hours', p => { p.policy.urgentCoverage = 'closed'; });
  push('urgent-coverage-open', 'On-call only during phone hours', p => { p.policy.urgentCoverage = 'open'; });
  push('urgent-coverage-selected', 'On-call selected hours', p => {
    p.policy.urgentCoverage = 'selected';
    p.policy.urgentDays = p.hours.days.map(d => ({ ...d, open: d.day !== 'Sunday', start: '17:00', end: '23:00' }));
  });
  push('urgent-roster-rotation', 'On-call rotation (must be assigned)', p => { p.policy.urgentRoster = 'rotation'; });
  push('urgent-backup-message', 'On-call miss → priority voicemail only', p => { p.policy.urgentBackup = 'message'; });
  push('urgent-backup-instructions', 'On-call miss → approved instructions', p => {
    p.policy.urgentBackup = 'instructions';
    p.urgent.approved = true;
  });
  push('devices-all-desk', 'Every team on desk phones', p => {
    p.policy.placements = p.teams.map(t => ({
      id: t.id, team: t.id, label: t.name, device: 'desk', count: t.count, sharing: 'separate', access: 'outside', extension: ''
    }));
  });
  push('devices-clinical-internal', 'Clinical internal-only (no inbound ring)', p => {
    p.policy.placements = p.policy.placements.map(x => x.team === 'clinical' ? { ...x, access: 'internal' } : x);
  });
  push('devices-mobile-followme', 'Reception on work mobile (Follow Me)', p => {
    p.policy.placements = p.policy.placements.map(x => x.team === 'reception' ? { ...x, device: 'mobile', count: 2 } : x);
  });
  push('notification-email', 'Voicemail notification: email', p => { p.policy.notification = 'email'; });
  push('followup-skip', 'Skip extra follow-up tools', p => { p.policy.followup = 'skip'; });
  push('followup-pms', 'Follow-up + named PMS (unverified)', p => {
    p.policy.followup = 'yes';
    p.policy.system = 'Ortho2';
    p.followup.channels = ['Patient texts', 'Voicemail and callbacks', 'Appointment requests or reminders'];
  });
  push('team-fallback-clinical', 'Clinical unanswered uses a different fallback', p => {
    p.policy.teamFallbacks = { clinical: { kind: 'backup', team: 'admin', owner: 'reception' } };
  });
  push('team-deferred-admin', 'Administration headcount deferred', p => {
    p.teams = p.teams.map(t => t.id === 'admin' ? { ...t, count: 0, status: 'deferred' } : t);
  });
  push('assistant-human-selected', 'AI human handoff only for selected tasks', p => {
    applyFirst(p, 'assistant', 'together');
    applyLanguage(p, 'assistant');
    p.policy.assistant.humanWhen = 'selected';
    p.policy.assistant.handoffTasks = ['Connect callers to a team'];
  });
  push('comparison-port', 'Improving + keep existing numbers', p => {
    p.policy.comparison = true;
    p.policy.portNumbers = true;
    p.current = { provider: 'Legacy PBX', monthly: '420', lines: '4', notes: 'Want to keep the published DID.' };
    p.policy.costIncludes = ['Equipment', 'Taxes and fees'];
  });
  push('timeout-short', 'Ring timeout 5 seconds (minimum)', p => { p.busy.seconds = 5; p.urgent.seconds = 5; });
  push('timeout-long', 'Ring timeout 90s, queue wait 180s', p => {
    applyBusy(p, 'queue');
    p.busy.seconds = 90;
    p.busy.wait = 180;
  });

  const stacked = [];
  const realistic = (id, title, fn) => {
    const p = complete();
    fn(p);
    p.endpoints = inventory(p);
    stacked.push({ group: 'practice', id: slug('practice-' + id), title, plan: p });
  };
  realistic('dental-menu-spanish-ai-oncall', 'Dental · menu · Spanish · after-hours AI · on-call', p => {
    p.specialty = 'Dental';
    p.name = 'Hudson Dental';
    applyFirst(p, 'menu', 'together');
    applyLanguage(p, 'menu');
    applyBusy(p, 'backup');
    applyAfter(p, 'assistant');
    applyUrgent(p, 'connect');
    p.policy.urgentCoverage = 'closed';
    p.hours.days = p.hours.days.map(d => d.open ? { ...d, breakStart: '12:00', breakEnd: '13:00' } : d);
    p.hours.holidays = ['2026-12-25'];
  });
  realistic('eye-human-together-info', 'Eye care · human together · after-hours information', p => {
    p.specialty = 'Eye care';
    p.name = 'Valley Eye';
    applyFirst(p, 'human', 'together');
    applyLanguage(p, '');
    applyBusy(p, 'message');
    applyAfter(p, 'information');
    applyUrgent(p, 'instructions');
  });
  realistic('opening-new-practice', 'Brand-new practice before opening day', p => {
    p.mode = 'opening';
    p.name = 'Newburgh Family';
    p.specialty = 'Other healthcare practice';
    p.specialtyDetail = 'Primary care';
    p.policy.beforeOpening = 'information';
    p.policy.beforeOpeningText = 'We open in January. Please check our website for the date. Do not leave clinical information.';
    applyFirst(p, 'human', 'together');
    applyAfter(p, 'message');
    applyUrgent(p, 'none');
  });
  realistic('two-site-separate-dids', 'Two sites, own DID each, ordered ring', p => {
    p.name = 'Northeast Offices';
    p.locations = [{ id: 'location-1', name: 'Newburgh' }, { id: 'location-2', name: 'Wappingers' }];
    p.policy.locationEntry = 'separate';
    p.policy.number = 'own';
    applyFirst(p, 'human', 'order');
    applyBusy(p, 'queue');
    p.policy.queueExit = 'message';
    applyAfter(p, 'assistant');
    applyUrgent(p, 'connect');
    p.policy.urgentCoverage = 'closed';
  });

  return [...list, ...extras, ...stacked];
}

function inspect(plan) {
  const g = graph(plan);
  const ends = {};
  for (const s of scenarios(plan)) {
    const r = simulate(plan, s);
    ends[s.id] = {
      label: s.label,
      path: r.trace.map(n => n.label),
      end: r.trace.at(-1)?.label || 'missing',
      endId: r.trace.at(-1)?.id || '',
      kind: r.trace.at(-1)?.kind || ''
    };
  }
  const fusion = fusionBuild(plan);
  return {
    valid: valid(plan),
    decisions: decisions(plan),
    nodeCount: Object.keys(g.nodes).length,
    scenarios: ends,
    fusion: {
      blockers: fusion.blockers,
      analysis: fusion.analysis,
      objects: fusion.objects.map(o => ({ kind: o.kind, extension: o.extension || '', name: o.name })),
      recordings: fusion.recordings.map(r => ({ name: r.name, filename: r.filename, script: r.script })),
      numbering: fusion.numbering,
      checklist: fusion.checklist,
      specialty: fusion.specialty
    }
  };
}

function textBundle(plan, info) {
  const lines = [];
  lines.push('# ' + (plan.name || 'Practice') + ' — walkthrough');
  lines.push('');
  lines.push('Valid: ' + info.valid);
  lines.push('Open decisions: ' + (info.decisions.length ? info.decisions.join(' | ') : 'none'));
  lines.push('Graph nodes: ' + info.nodeCount);
  lines.push('');
  lines.push('## Fusion analysis');
  for (const a of info.fusion.analysis) lines.push('- ' + a);
  if (info.fusion.blockers.length) {
    lines.push('');
    lines.push('## Blockers');
    for (const b of info.fusion.blockers) lines.push('- ' + b);
  }
  lines.push('');
  lines.push('## Fusion objects');
  for (const o of info.fusion.objects) lines.push(`- [${o.kind}] ${o.name}${o.extension ? ' ext ' + o.extension : ''}`);
  lines.push('');
  lines.push('## Recordings');
  for (const r of info.fusion.recordings) lines.push(`- ${r.filename}: ${r.script}`);
  lines.push('');
  lines.push('## Scenario ends');
  for (const s of Object.values(info.scenarios))
    lines.push(`- ${s.label}: ${s.path.join(' → ')} [${s.kind}]`);
  lines.push('');
  lines.push('## Full plan text');
  for (const [title, body] of sections(plan)) {
    lines.push('');
    lines.push('### ' + title);
    for (const line of body) lines.push(line);
  }
  return lines.join('\n');
}

async function writeOne(entry, index, total, dirs) {
  const info = inspect(entry.plan);
  const base = String(index).padStart(3, '0') + '-' + entry.id;
  const pdfBytes = await createPDF(entry.plan, fontFile.buffer.slice(fontFile.byteOffset, fontFile.byteOffset + fontFile.byteLength));
  fs.writeFileSync(path.join(dirs.pdf, base + '.pdf'), pdfBytes);
  fs.writeFileSync(path.join(dirs.analysis, base + '.txt'), textBundle(entry.plan, info));
  fs.writeFileSync(path.join(dirs.analysis, base + '.json'), JSON.stringify({
    id: entry.id,
    group: entry.group,
    title: entry.title,
    file: base,
    ...info,
    plan: {
      mode: entry.plan.mode,
      specialty: entry.plan.specialty,
      first: entry.plan.first,
      busy: entry.plan.busy.kind,
      after: entry.plan.after.kind,
      urgent: { enabled: entry.plan.urgent.enabled, kind: entry.plan.policy.urgentKind },
      languages: entry.plan.languages.map(l => l.name + '/' + l.mechanism + '/' + l.availability),
      locations: entry.plan.locations.map(l => l.name),
      locationEntry: entry.plan.policy.locationEntry
    }
  }, null, 2));
  if (index % 10 === 0 || index === total)
    console.log(index + '/' + total + ' ' + base);
  return {
    n: index,
    id: entry.id,
    group: entry.group,
    title: entry.title,
    pdf: 'pdf/' + base + '.pdf',
    txt: 'analysis/' + base + '.txt',
    json: 'analysis/' + base + '.json',
    valid: info.valid,
    decisions: info.decisions.length,
    blockers: info.fusion.blockers.length,
    scenarios: Object.keys(info.scenarios).length,
    nodes: info.nodeCount
  };
}

const all = variants();
const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.slice(8) || 0);
const selected = limit > 0 ? all.slice(0, limit) : all;

fs.rmSync(outDir, { recursive: true, force: true });
const dirs = {
  pdf: path.join(outDir, 'pdf'),
  analysis: path.join(outDir, 'analysis')
};
fs.mkdirSync(dirs.pdf, { recursive: true });
fs.mkdirSync(dirs.analysis, { recursive: true });

console.log('Generating ' + selected.length + ' walkthroughs into ' + outDir);
const rows = [];
for (let i = 0; i < selected.length; i++)
  rows.push(await writeOne(selected[i], i + 1, selected.length, dirs));

const manifest = {
  generatedAt: new Date().toISOString(),
  folder: outDir,
  count: rows.length,
  groups: Object.fromEntries(['matrix', 'detail', 'practice'].map(g => [g, rows.filter(r => r.group === g).length])),
  rows
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const md = [
  '# Planner walkthroughs',
  '',
  'Generated ' + manifest.generatedAt + '. **' + manifest.count + '** complete walks (PDF + analysis).',
  '',
  '- matrix (first × busy × after × urgent, with matching language): ' + manifest.groups.matrix,
  '- detail (one-field variants): ' + manifest.groups.detail,
  '- practice (stacked realistic plans): ' + manifest.groups.practice,
  '',
  'Open `index.html` in a browser, or any file under `pdf/`.',
  '',
  '| # | Group | Plan | PDF | Analysis | Valid | Open decisions | Blockers | Scenarios |',
  '|---|---|---|---|---|---|---|---|---|'
];
for (const r of rows) {
  md.push(`| ${r.n} | ${r.group} | ${r.title.replace(/\|/g, '/')} | [${path.basename(r.pdf)}](${r.pdf}) | [txt](${r.txt}) | ${r.valid} | ${r.decisions} | ${r.blockers} | ${r.scenarios} |`);
}
fs.writeFileSync(path.join(outDir, 'README.md'), md.join('\n'));

const html = `<!doctype html>
<meta charset="utf-8">
<title>Planner walkthroughs (${rows.length})</title>
<style>
  body{font:14px/1.45 ui-sans-serif,system-ui;margin:24px;background:#f6f7f4;color:#142}
  h1{font-weight:600}
  input{width:min(520px,100%);padding:8px 10px;margin:8px 0 16px;border:1px solid #c5cdc4;border-radius:8px}
  table{border-collapse:collapse;width:100%;background:#fff}
  th,td{border-bottom:1px solid #e4e8e2;padding:8px 10px;text-align:left;vertical-align:top}
  th{position:sticky;top:0;background:#eef2ee}
  a{color:#2a6}
  .tag{font-size:11px;padding:1px 6px;border-radius:99px;background:#e7efe6}
</style>
<h1>Planner walkthroughs — ${rows.length} PDFs</h1>
<p>Folder: <code>${outDir}</code></p>
<input id="q" placeholder="Filter by first answer, busy, after hours, urgent, specialty…">
<table>
<thead><tr><th>#</th><th>Group</th><th>Plan</th><th>Files</th><th>Valid</th><th>Decisions</th><th>Blockers</th></tr></thead>
<tbody>
${rows.map(r => `<tr data-s="${(r.title + ' ' + r.id).toLowerCase()}"><td>${r.n}</td><td><span class="tag">${r.group}</span></td><td>${r.title}</td><td><a href="${r.pdf}">PDF</a> · <a href="${r.txt}">txt</a> · <a href="${r.json}">json</a></td><td>${r.valid}</td><td>${r.decisions}</td><td>${r.blockers}</td></tr>`).join('\n')}
</tbody>
</table>
<script>
const q=document.getElementById('q');
q.addEventListener('input',()=>{
  const v=q.value.toLowerCase();
  for (const tr of document.querySelectorAll('tbody tr'))
    tr.hidden = v && !tr.dataset.s.includes(v);
});
</script>
`;
fs.writeFileSync(path.join(outDir, 'index.html'), html);
console.log('Done. ' + rows.length + ' PDFs in ' + outDir);
