'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { prepareBuild } = require('./planner-transpile');

const { srcDir, outDir } = prepareBuild(path.basename(__filename, '.test.js'));

function complete(base) {
  const p = structuredClone(base);
  p.mode = p.mode || 'opening';
  p.name = p.name || 'Hudson Family Practice';
  p.specialty = p.specialty || 'Dental';
  p.teams.forEach((t, i) => {
    t.count = [2, 4, 1][i];
    t.status = 'known';
  });
  if (p.first.kind === 'undecided')
    p.first = { kind: 'human', team: 'reception' };
  p.reasons.forEach((r, i) => { r.team = r.team || ['reception', 'admin', 'clinical'][i]; });
  p.busy = { kind: p.busy.kind === 'undecided' ? 'message' : p.busy.kind, seconds: 25, wait: 90, backup: '', owner: 'reception' };
  p.after = { kind: p.after.kind === 'undecided' ? 'message' : p.after.kind, owner: 'reception', instructions: p.after.instructions || '' };
  p.hours.days = p.hours.days.map((d, i) => i < 5
    ? { ...d, open: true, start: '08:00', end: '17:00', breakStart: i < 4 ? '12:30' : '', breakEnd: i < 4 ? '13:30' : '', stated: true }
    : { ...d, open: false, stated: true });
  p.policy.beforeOpening = 'message';
  p.policy.opening = { ...p.policy.opening, date: '2027-03-15', precision: 'day', numbers: 'new' };
  return p;
}

test('hear, owner page 02, and fusion recordings share wording; identity matches; no contradicting insights', async () => {
  const config = await import(path.join(outDir, 'config.mjs'));
  const { inventory } = await import(path.join(outDir, 'policy.mjs'));
  const { fusionBuild } = await import(path.join(outDir, 'fusion.mjs'));
  const { callerHear } = await import(path.join(outDir, 'architect/hear.mjs'));
  const { ownerBrief } = await import(path.join(outDir, 'owner-brief.mjs'));
  const { identity, insights } = await import(path.join(outDir, 'advisor.mjs'));
  const { nextQuestion, ownerQuestions } = await import(path.join(outDir, 'architect/questions.mjs'));
  const firsts = [['human', 'together'], ['menu', 'together']];
  const afters = ['message', 'information'];
  const urgents = ['connect', 'none'];
  const forbidden = [
    { rec: /press 9/i, insight: /does not route to on-call/i }
  ];
  for (const [kind, ring] of firsts) {
    for (const after of afters) {
      for (const urgent of urgents) {
        const p = complete(config.initial());
        p.first = { kind, team: kind === 'human' ? 'reception' : '' };
        p.policy.ring = ring;
        p.after.kind = after;
        if (urgent === 'none') {
          p.urgent.enabled = false;
          p.policy.urgentKind = 'none';
        }
        else {
          p.urgent.enabled = true;
          p.policy.urgentKind = 'connect';
          p.policy.urgentCoverage = 'closed';
        }
        p.endpoints = inventory(p);
        const id = identity(p);
        const hear = callerHear(p).filter(r => r.kind !== 'note').map(r => r.when + '|' + r.hear);
        const p02 = ownerBrief(p)[1];
        const scripts = (p02.blocks.find(b => b.kind === 'scripts') || { items: [] }).items.map(r => r.when + '|' + r.hear);
        const recs = fusionBuild(p).recordings.map(r => r.script);
        for (const row of hear) {
          const script = row.split('|').slice(1).join('|');
          assert.ok(recs.some(r => r === script) || recs.some(r => script.includes(r.slice(0, 40))), 'hear row missing from fusion recordings: ' + row.slice(0, 80));
        }
        assert.deepEqual(hear, scripts);
        assert.equal(id.planId + id.checksum, identity(p).planId + identity(p).checksum);
        const blob = insights(p).map(i => i.detail).join(' ');
        const recBlob = recs.join(' ');
        for (const pair of forbidden) {
          if (pair.rec.test(recBlob))
            assert.doesNotMatch(blob, pair.insight);
        }
        const q = nextQuestion(p, {});
        const oq = ownerQuestions(p, {});
        assert.equal(q === null, oq.length === 0, kind + '/' + after + '/' + urgent + ' nextQuestion vs ownerQuestions');
      }
    }
  }
});

test('generated API hash matches planner source', () => {
  const fields = fs.readFileSync(path.join(srcDir, 'architect/fields.ts'), 'utf8');
  const prompt = fs.readFileSync(path.join(srcDir, 'architect/prompt.ts'), 'utf8');
  const schema = fs.readFileSync(path.join(srcDir, 'architect/schema.ts'), 'utf8');
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(fields + '\n' + prompt + '\n' + schema).digest('hex');
  const stampPath = path.join(__dirname, '../planner/eval/api-source.hash');
  if (!fs.existsSync(stampPath))
    return;
  assert.equal(fs.readFileSync(stampPath, 'utf8').trim(), hash);
});
