#!/usr/bin/env node
/**
 * Production prove for planner publish gate step 2:
 * create → Groq interpret → put plan → lock (checksum match) → share → reload ?s=
 */
import { createHash } from 'node:crypto';

const API = process.env.PLANNER_API || 'https://app.upstateipvoice.com';

function fingerprint(p) {
  const body = JSON.stringify({
    planId: p.planId,
    revision: p.revision,
    mode: p.mode,
    name: p.name,
    specialty: p.specialty,
    teams: p.teams,
    endpoints: p.endpoints,
    first: p.first,
    reasons: p.reasons,
    busy: p.busy,
    menu: p.menu,
    languages: p.languages,
    hours: p.hours,
    after: p.after,
    urgent: p.urgent,
    followup: p.followup,
    current: p.current,
    confirmed: p.confirmed,
    policy: p.policy,
    locations: p.locations
  });
  // Match planner/advisor.ts FNV-1a 32-bit used in fingerprint.generated.js
  let h = 2166136261;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

async function json(method, path, body) {
  const t0 = Date.now();
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  return { status: res.status, ms: Date.now() - t0, data };
}

const planId = 'UP-smoke-' + Date.now().toString(36);
const basePlan = {
  schema: 2,
  planId,
  revision: 0,
  mode: 'improving',
  name: 'Rivertown Family Eye',
  specialty: 'Eye care',
  teams: [],
  endpoints: { desk: 0, computer: 0, mobile: 0, shared: 0, undecided: true },
  first: { kind: 'human', team: 'reception' },
  reasons: [],
  busy: { kind: 'message', seconds: 25, wait: 90, backup: '', owner: '' },
  menu: { invalid: 'message', noInput: 'message', team: '' },
  languages: [],
  hours: { timezone: 'America/New_York', days: [], holidays: [], holidayPolicy: 'closed' },
  after: { kind: 'message', owner: '', instructions: '' },
  urgent: { enabled: false, approved: false, instructions: '', team: '', backup: '', seconds: 30, owner: '' },
  followup: { owner: '', target: '', channels: [] },
  current: { provider: '', monthly: '', lines: '', notes: '' },
  confirmed: [],
  policy: { cityState: 'Beacon, NY' },
  locations: [{ id: 'location-1', name: 'Main practice' }],
  profiles: {}
};

const out = { api: API, planId, steps: [] };
function step(name, ok, detail) {
  out.steps.push({ name, ok, ...detail });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail?.ms != null ? '  ' + detail.ms + 'ms' : '') + (detail?.note ? '  ' + detail.note : ''));
}

const created = await json('POST', '/api/public/planner/sessions', { planId, revision: 0, plan: basePlan });
step('create', created.status === 201, { status: created.status, ms: created.ms, id: created.data?.id });
if (!created.data?.id) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
}
const sid = created.data.id;

const interpreted = await json('POST', `/api/public/planner/sessions/${sid}/messages`, {
  clientMessageId: 'smoke-' + createHash('sha1').update(String(Date.now())).digest('hex').slice(0, 12),
  text: 'Rivertown Family Eye in Beacon. Been open for years. Replacing phones. Front desk answers. After hours take a message, no on-call.',
  currentQuestionId: 'mode',
  currentQuestion: { id: 'mode', text: 'What are you setting up?' },
  confirmedState: {},
  facts: {},
  history: [],
  today: new Date().toISOString().slice(0, 10),
  timezone: 'America/New_York'
});
const groqOk = interpreted.status === 200 && Array.isArray(interpreted.data?.interpreter?.updates);
step('groq-interpret', groqOk, {
  status: interpreted.status,
  ms: interpreted.ms,
  note: groqOk ? (interpreted.data.interpreter.acknowledgement || '').slice(0, 80) : JSON.stringify(interpreted.data).slice(0, 120)
});

const nextPlan = {
  ...basePlan,
  revision: 0,
  specialty: 'Eye care',
  name: 'Rivertown Family Eye',
  mode: 'improving',
  after: { kind: 'message', owner: 'reception', instructions: '' },
  policy: { ...(basePlan.policy || {}), cityState: 'Beacon, NY', urgentKind: 'none' }
};
const put = await json('PUT', `/api/public/planner/sessions/${sid}/plan`, {
  revision: created.data.revision ?? 0,
  plan: nextPlan,
  facts: {},
  futureConsiderations: []
});
step('put-plan', put.status === 200 && typeof put.data?.revision === 'number', {
  status: put.status,
  ms: put.ms,
  revision: put.data?.revision
});
const revision = put.data?.revision ?? 1;
nextPlan.revision = revision;

// Server fingerprints the stored plan_json — re-read so checksum matches exactly.
const got = await json('GET', `/api/public/planner/sessions/${sid}`);
const serverPlan = got.data?.plan || nextPlan;
const checksum = fingerprint(serverPlan);
const lock = await json('POST', `/api/public/planner/sessions/${sid}/lock`, { revision: got.data?.revision ?? revision, checksum });
const lockOk = lock.status === 200 && lock.data?.lockedChecksum === checksum;
step('lock', lockOk, {
  status: lock.status,
  ms: lock.ms,
  note: lockOk ? checksum : JSON.stringify(lock.data).slice(0, 160) + ' want ' + checksum
});

const share = await json('POST', `/api/public/planner/sessions/${sid}/share`);
step('share', share.status === 200 && share.data?.shared === true, { status: share.status, ms: share.ms });

const reload = await json('GET', `/api/public/planner/sessions/${sid}`);
const reloadOk = reload.status === 200
  && reload.data?.id === sid
  && reload.data?.lockedChecksum === checksum
  && (reload.data?.plan?.name === 'Rivertown Family Eye' || serverPlan.name === 'Rivertown Family Eye');
step('reload-session', reloadOk, {
  status: reload.status,
  ms: reload.ms,
  note: 's=' + sid + ' locked=' + reload.data?.lockedChecksum
});

out.shareUrl = 'https://upstateipvoice.com/planner/?s=' + encodeURIComponent(sid);
out.ok = out.steps.every(s => s.ok);
console.log(JSON.stringify({ ok: out.ok, shareUrl: out.shareUrl, checksum, revision: reload.data?.revision }, null, 2));
process.exit(out.ok ? 0 : 1);
