#!/usr/bin/env node
// Whole-product audit: every eval scenario -> chat -> auto chips -> both PDFs -> invariant checks.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Whole-product gate: npm run planner:audit [idFilter]. Needs poppler (pdftotext).
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const build = path.join(root, 'planner/.audit-build');
const out = path.join(root, 'planner/eval/results/audit');
for (const rel of ['config', 'policy', 'locations', 'routing', 'flow', 'team-state', 'state',
  'architect/schema', 'architect/fields', 'architect/parse', 'architect/extract', 'architect/ack',
  'architect/merge', 'architect/questions', 'architect/turn', 'architect/scene-from-plan',
  'architect/prompt', 'architect/hear', 'architect/scrub', 'fusion', 'plan-content', 'privacy', 'advisor', 'owner-brief', 'engineer-brief', 'opening', 'status',
  'readiness', 'bom', 'provisioning', 'pdf']) {
  let code = ts.transpile(fs.readFileSync(path.join(root, 'planner/src', rel + '.ts'), 'utf8'), { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
  code = code.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, "from '$1.mjs'");
  if (rel === 'pdf') code = code.replace("import fontkit from '@pdf-lib/fontkit';", "import fontkitMod from '@pdf-lib/fontkit';\nconst fontkit = fontkitMod.default || fontkitMod;");
  fs.mkdirSync(path.dirname(path.join(build, rel + '.mjs')), { recursive: true });
  fs.writeFileSync(path.join(build, rel + '.mjs'), code);
}
fs.mkdirSync(out, { recursive: true });

const imp = rel => import(path.join(build, rel + '.mjs'));
const { initial } = await imp('config');
const { interpretTurn, chipTurn } = await imp('architect/turn');
const { nextQuestion, ownerQuestions } = await imp('architect/questions');
const { callerHear } = await imp('architect/hear');
const { fusionBuild } = await imp('fusion');
const { glance, insights, identity } = await imp('advisor');
const { stillOpen } = await imp('readiness');
const { createPairedPDFs } = await imp('pdf');
const { shortScenarios } = await import(path.join(root, 'planner/eval/gold-short.mjs'));
const { fullScenarios } = await import(path.join(root, 'planner/eval/gold-full.mjs'));
const { dumpScenarios } = await import(path.join(root, 'planner/eval/gold-dump.mjs'));
const chen = await import(path.join(root, 'planner/eval/chen-gold.mjs'));
const { adversarialScenarios: extra } = await import(path.join(root, 'planner/eval/gold-adversarial.mjs'));

const font = fs.readFileSync(path.join(root, 'planner/public/assets/InstrumentSans.ttf'));
const logo = fs.readFileSync(path.join(root, 'planner/public/assets/upstate-logo.png'));
const blank = { acknowledgement: '', intent: 'provide_information', updates: [], unmapped_facts: [], explanation_topic: null };

const scenarios = [
  { id: 'CHEN', turns: chen.CONVERSATION.map(t => ({ owner: t })), chips: chen.CHIP_ANSWERS },
  ...extra,
  ...dumpScenarios, ...fullScenarios, ...shortScenarios
].filter(s => !process.argv[2] || s.id.includes(process.argv[2]));

function textOf(t) { return typeof t === 'string' ? t : t.owner || t.text || t.user || ''; }

function play(s, chipMode) {
  let plan = initial(), facts = {}, follow = null;
  const log = [];
  for (const t of s.turns || []) {
    const userText = textOf(t);
    if (!userText) continue;
    const r = interpretTurn({ plan, facts, interpreter: blank, userText, question: follow });
    plan = r.plan; facts = r.facts; follow = r.follow;
    log.push({ who: 'owner', text: userText, ack: r.ack, next: follow?.id || null });
  }
  const asked = [];
  let guard = 0;
  while (follow && guard++ < 25) {
    const want = s.chips?.[follow.id];
    let chip = want ? (follow.options.find(o => o.value === want.value) || { id: want.value, label: want.label, field_id: want.field_id, value: want.value, operation: 'set' }) : null;
    if (!chip) {
      const opts = (follow.options || []).filter(o => o.operation === 'set' && !/undecided|not sure|skip|later|help me decide/i.test(o.label + String(o.value ?? '')) && !(facts[o.field_id] && facts[o.field_id].value === o.value && facts[o.field_id].status === 'confirmed'));
      if (!opts.length && (follow.id === 'opening.date' || follow.id === 'name')) {
        const typed = follow.id === 'name' ? 'The practice is called Audit Family Dental.' : 'We open in May 2027.';
        const r2 = interpretTurn({ plan, facts, interpreter: blank, userText: typed, question: follow });
        asked.push(follow.id + '=typed');
        plan = r2.plan; facts = r2.facts; const was = follow.id; follow = r2.follow;
        log.push({ who: 'owner', text: typed, ack: r2.ack, next: follow?.id || null });
        if (follow?.id === was) { asked.push('STUCK:' + was); break; }
        continue;
      }
      chip = chipMode === 'last' ? opts[opts.length - 1] : opts[0];
    }
    if (!chip) break;
    asked.push(follow.id + '=' + chip.label);
    const r = chipTurn({ plan, facts, chip });
    if (r.follow?.id === follow.id && JSON.stringify(r.plan) === JSON.stringify(plan)) { asked.push('STUCK:' + follow.id); plan = r.plan; break; }
    plan = r.plan; facts = r.facts; follow = r.follow;
    log.push({ who: 'chip', text: chip.label, ack: r.ack, next: follow?.id || null });
  }
  return { plan, facts, follow, log, asked };
}

function pdftext(file) {
  return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
}
// Words below the footer rule or past the right margin.
function overflow(file) {
  const xml = execFileSync('pdftotext', ['-bbox', file, '-'], { encoding: 'utf8' });
  const issues = [];
  let page = 0, H = 0, W = 0;
  for (const line of xml.split('\n')) {
    const pg = /<page width="([\d.]+)" height="([\d.]+)"/.exec(line);
    if (pg) { page++; W = +pg[1]; H = +pg[2]; continue; }
    const w = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*)<\/word>/.exec(line);
    if (!w) continue;
    const [, x0, y0, x1, y1, word] = w;
    if (+x1 > W - 20) issues.push(`p${page} right-overflow "${word}"`);
    if (+y1 > H - 18) issues.push(`p${page} below-page "${word}"`);
  }
  return issues;
}

const PLACEHOLDER = /\*99—|box —|\(box —\)|<owner>|\(owner extension\)|\(callback owner\)|\(owner\)|undefined|NaN|\[object|null\b|members none(?![^\n]*BLOCKED)/;
const results = [];
for (const s of scenarios) {
  for (const chipMode of ['first', 'last']) {
    if (chipMode === 'last' && s.id === 'CHEN') continue;
    const id = s.id + (chipMode === 'last' ? '~alt' : '');
    const issues = [];
    let r;
    try { r = play(s, chipMode); } catch (e) { results.push({ id, crash: 'play: ' + e.stack.split('\n').slice(0, 3).join(' | ') }); continue; }
    const { plan, facts, follow, log, asked } = r;
    if (follow) issues.push('CHAT-NOT-DONE next=' + follow.id);
    if (asked.some(a => a.startsWith('STUCK'))) issues.push('CHIP-STUCK ' + asked.filter(a => a.startsWith('STUCK')).join(','));
    const oq = ownerQuestions(plan, facts).map(q => q.id);
    if (!follow && oq.length) issues.push('STOP-WITH-OPEN-QUESTIONS ' + oq.join(','));
    // Repeated only after that id was already answered (chip/typed), not sticky next during free-text.
    // Typed fills from play() use fixed canned strings — do not confuse with owner speech like "We open in April".
    const answerAt = new Map();
    let askI = 0;
    for (let i = 0; i < log.length; i++) {
      const pending = asked[askI];
      if (!pending)
        continue;
      if (pending.startsWith('STUCK:')) {
        askI++;
        continue;
      }
      const text = log[i].text || '';
      const typedName = pending.startsWith('name=') && text.startsWith('The practice is called ');
      const typedDate = pending.startsWith('opening.date=') && text.startsWith('We open in ');
      if (log[i].who === 'chip' || typedName || typedDate) {
        const id = pending.split('=')[0];
        if (!answerAt.has(id))
          answerAt.set(id, i);
        askI++;
      }
    }
    const rep = [];
    for (let i = 2; i < log.length; i++) {
      const a = log[i]?.next, b = log[i - 1]?.next, c = log[i - 2]?.next;
      if (a && a === b && a === c && answerAt.has(a) && i > answerAt.get(a))
        rep.push(a);
    }
    if (rep.length) issues.push('REPEATED-QUESTION ' + [...new Set(rep)].join(','));
    // generic acks
    for (const l of log) if (/^(I'll record that|Noted: )/i.test(l.ack || '')) issues.push('GENERIC-ACK "' + l.text.slice(0, 40) + '" -> ' + l.ack);
    let fb, pair;
    try { fb = fusionBuild(plan); } catch (e) { results.push({ id, crash: 'fusion: ' + e.message }); continue; }
    try { pair = await createPairedPDFs(plan, font, { logo }); } catch (e) { results.push({ id, crash: 'pdf: ' + e.stack.split('\n').slice(0, 3).join(' | ') }); continue; }
    const of = path.join(out, id + '-owner.pdf'), ef = path.join(out, id + '-engineer.pdf');
    fs.writeFileSync(of, Buffer.from(pair.owner)); fs.writeFileSync(ef, Buffer.from(pair.engineer));
    const ot = pdftext(of), et = pdftext(ef);
    fs.writeFileSync(path.join(out, id + '-owner.txt'), ot); fs.writeFileSync(path.join(out, id + '-engineer.txt'), et);
    const ownerPages = (ot.match(/\f/g) || []).length, engPages = (et.match(/\f/g) || []).length;
    if (ownerPages !== 6) issues.push('OWNER-PAGES ' + ownerPages);
    for (const [k, t] of [['owner', ot], ['engineer', et]]) {
      const lines = t.split('\n').filter(l => PLACEHOLDER.test(l));
      for (const l of lines.slice(0, 4)) issues.push(`PLACEHOLDER-${k}: ${l.trim().replace(/\s+/g, ' ').slice(0, 140)}`);
      for (const o of overflow(k === 'owner' ? of : ef).slice(0, 3)) issues.push(`OVERFLOW-${k} ${o}`);
      if (/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(t)) issues.push(`PHONE-NUMBER-IN-${k}`);
      if (/this afternoon|same afternoon/i.test(t) && !/afternoon/i.test(JSON.stringify(s.turns))) issues.push(`INVENTED-AFTERNOON-${k}`);
    }
    // recordings -> distinct boxes
    const boxOf = {};
    for (const rec of fb.recordings || []) {
      const m = /box (\d+)/.exec(rec.usedBy || '') || /\*99(\d+)/.exec(rec.usedBy || '');
      if (m) (boxOf[m[1]] ||= []).push(rec.filename);
      if (!et.replace(/\s+/g, '').includes(rec.filename)) issues.push('RECORDING-NOT-IN-ENGINEER ' + rec.filename);
    }
    for (const [b, files] of Object.entries(boxOf)) if (files.length > 1) issues.push(`SHARED-MAILBOX ${b}: ${files.join(', ')}`);
    // filenames broken across lines in engineer
    for (const rec of fb.recordings || []) {
      if (!et.includes(rec.filename) && et.replace(/\s+/g, '').includes(rec.filename)) issues.push('FILENAME-BROKEN ' + rec.filename);
    }
    // hear parity
    for (const h of callerHear(plan)) {
      if (!h.hear || /^Press 9 is part|^A work mobile can ring/.test(h.hear)) continue;
      const needle = h.hear.slice(0, 60).replace(/\s+/g, ' ');
      if (!ot.replace(/\s+/g, ' ').includes(needle)) issues.push('HEAR-NOT-IN-OWNER ' + h.when);
    }
    // identity
    const idn = identity(plan);
    if (!ot.includes(idn.checksum) || !et.includes(idn.checksum)) issues.push('IDENTITY-MISSING');
    // empty / blocked
    for (const b of fb.blockers || []) issues.push('BLOCKER ' + String(b).slice(0, 110));
    const dups = et.match(/\b(\w{4,}) · \1\b|\b(BLOCKED) · BLOCKED\b/g);
    if (dups) issues.push('DUP-WORD ' + dups[0]);
    const speech = JSON.stringify(s.turns || []).toLowerCase();
    const hoursChipped = asked.some(a => /^hours\.preset=/.test(a) && /Monday|9 AM|24-hour/i.test(a));
    const fri = plan.hours.days.find(d => d.day === 'Friday');
    if (fri?.open && fri.start === '09:00' && fri.end === '17:00'
      && !/friday|weekday|weekdays|mon(?:day)?\s*(?:through|to|-|–)\s*fri|m-f|9\s*(?:am)?\s*(?:to|-|–)\s*5|nine\s*(?:to|-|–)\s*five|nine\s*[-–]\s*five/.test(speech)
      && !hoursChipped)
      issues.push('INVENTED-HOURS Friday 9-5');
    results.push({ id, log, mode: plan.mode, specialty: plan.specialty, first: plan.first.kind, after: plan.after.kind, asked, ownerPages, engPages, stillOpen: stillOpen(plan), issues });
  }
}
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(results, null, 2));
const tally = {};
for (const r of results) for (const i of r.issues || [r.crash]) { const k = i.split(/[ :]/)[0]; tally[k] = (tally[k] || 0) + 1; }
console.log('scenarios', results.length, 'crashes', results.filter(r => r.crash).length, 'clean', results.filter(r => !r.crash && !r.issues.filter(i => !i.startsWith('BLOCKER')).length).length);
console.log(tally);
// Gate: a finished chat must produce a buildable spec. Only install-time blockers may remain.
const INSTALL_ONLY = /Follow Me|E911|site survey/i;
const hard = results.flatMap(r => r.crash ? [r.id + ' CRASH ' + r.crash] : r.issues
  .filter(i => !i.startsWith('BLOCKER') || !INSTALL_ONLY.test(i))
  .map(i => r.id + ' ' + i));
if (process.env.AUDIT_GATE && hard.length) {
  console.error(hard.slice(0, 40).join('\n'));
  process.exit(1);
}
