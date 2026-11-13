#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { PDFDocument } from 'pdf-lib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcDir = path.join(root, 'planner/src');
const buildDir = path.join(root, 'planner/.test-build');
const outDir = path.join(root, 'planner/.smoke');
const fontPath = path.join(root, 'planner/public/assets/InstrumentSans.ttf');
const logoPath = path.join(root, 'planner/public/assets/upstate-logo.png');

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

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

const { initial } = await import(path.join(buildDir, 'config.mjs'));
const { inventory } = await import(path.join(buildDir, 'policy.mjs'));
const { identity } = await import(path.join(buildDir, 'advisor.mjs'));
const { createPairedPDFs } = await import(path.join(buildDir, 'pdf.mjs'));

function hudson() {
  const p = structuredClone(initial());
  p.mode = 'opening';
  p.name = 'Hudson Family Practice';
  p.specialty = 'Dental';
  p.teams.forEach((t, i) => {
    t.count = [3, 5, 2][i];
    t.status = 'known';
  });
  p.first = { kind: 'menu', team: '' };
  p.reasons.forEach((r, i) => { r.team = ['reception', 'admin', 'clinical'][i]; });
  p.busy = { kind: 'queue', seconds: 25, wait: 90, backup: 'admin', owner: 'reception' };
  p.policy.queueExit = 'message';
  p.after = {
    kind: 'message',
    owner: 'reception',
    instructions: 'Leave your name and callback number for our next business day.'
  };
  p.urgent = {
    enabled: true,
    approved: true,
    instructions: 'For an urgent practice matter, request the on-call team. If this is a life-threatening emergency, hang up and call 911.',
    team: 'clinical',
    backup: 'admin',
    seconds: 30,
    owner: 'clinical'
  };
  p.followup = { owner: 'reception', target: 'By the next business day', channels: ['Phone callback'] };
  p.confirmed = ['hours', 'urgent', 'team', 'positions', 'first', 'reasons', 'busy', 'after'];
  p.policy.notification = 'inbox';
  p.policy.languageDecision = 'none';
  p.policy.ring = 'together';
  p.policy.urgentKind = 'connect';
  p.policy.urgentCoverage = 'always';
  p.policy.urgentRoster = 'fixed';
  p.policy.urgentBackup = 'team';
  p.policy.acceptance = true;
  p.policy.followup = 'yes';
  p.policy.hoursExceptionsConfirmed = true;
  p.policy.roomsSpecified = true;
  p.policy.rooms = 6;
  p.policy.beforeOpening = 'undecided';
  p.policy.opening = {
    date: '2027-03-15',
    construction: 'build-out',
    numbers: 'undecided',
    internet: 'survey',
    network: 'survey',
    pms: ''
  };
  p.policy.placements = [
    { id: 'reception', team: 'reception', label: 'Reception', device: 'desk', count: 3, sharing: 'separate', access: 'outside', extension: '' },
    { id: 'clinical', team: 'clinical', label: 'Clinical team', device: 'computer', count: 2, sharing: 'shared', access: 'outside', extension: '' },
    { id: 'admin', team: 'admin', label: 'Administration', device: 'mobile', count: 1, sharing: 'shared', access: 'outside', extension: '' }
  ];
  p.policy.terminalApprovals = {
    'reason:appointments': true,
    'reason:billing': true,
    'reason:clinical-question': true,
    urgent: true
  };
  p.hours.timezone = 'America/New_York';
  p.endpoints = inventory(p);
  return p;
}

const font = fs.readFileSync(fontPath);
const logo = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : undefined;
const plan = hudson();
const id = identity(plan);
const pair = await createPairedPDFs(
  plan,
  font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength),
  logo ? { logo: logo.buffer.slice(logo.byteOffset, logo.byteOffset + logo.byteLength) } : undefined
);
if (pair.identity.planId !== id.planId || pair.identity.checksum !== id.checksum)
  throw new Error('Paired export identity drifted from the source plan');

const ownerPath = path.join(outDir, 'owner.pdf');
const engineerPath = path.join(outDir, 'engineer.pdf');
fs.writeFileSync(ownerPath, Buffer.from(pair.owner));
fs.writeFileSync(engineerPath, Buffer.from(pair.engineer));

const ownerDoc = await PDFDocument.load(pair.owner);
const engDoc = await PDFDocument.load(pair.engineer);
const report = {
  planId: pair.identity.planId,
  revision: pair.identity.revision,
  checksum: pair.identity.checksum,
  ownerPages: ownerDoc.getPageCount(),
  engineerPages: engDoc.getPageCount(),
  ownerSubject: ownerDoc.getSubject(),
  engineerSubject: engDoc.getSubject(),
  ownerBytes: pair.owner.byteLength,
  engineerBytes: pair.engineer.byteLength
};
fs.writeFileSync(path.join(outDir, 'identity.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.ownerSubject !== report.engineerSubject)
  throw new Error('Owner and engineer PDF subjects do not match');
if (report.ownerPages !== 6)
  throw new Error('Owner PDF must be six pages, got ' + report.ownerPages);
if (report.engineerPages < 1)
  throw new Error('Engineer PDF is empty');

const dense = hudson();
dense.after.kind = 'assistant';
dense.languages = [{ name: 'Spanish', mechanism: 'menu', team: 'reception', availability: 'open', note: '', fallback: 'reception' }];
dense.policy.languageDecision = 'selected';
dense.policy.rooms = 1;
const densePair = await createPairedPDFs(
  dense,
  font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength),
  logo ? { logo: logo.buffer.slice(logo.byteOffset, logo.byteOffset + logo.byteLength) } : undefined
);
const densePages = (await PDFDocument.load(densePair.owner)).getPageCount();
if (densePages !== 6)
  throw new Error('Dense owner PDF must stay six pages, got ' + densePages);
if (densePair.identity.checksum !== identity(dense).checksum)
  throw new Error('Dense paired export identity drifted');
console.log(JSON.stringify({ denseOwnerPages: densePages, denseChecksum: densePair.identity.checksum }));
