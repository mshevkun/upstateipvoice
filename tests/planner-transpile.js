'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const srcDir = path.join(__dirname, '../planner/src');

/** Full planner graph used by unit tests — keep one list so parallel runs stay self-contained. */
const MODULES = [
  'config', 'policy', 'locations', 'routing', 'flow', 'team-state', 'state',
  'architect/schema', 'architect/fields', 'architect/parse', 'architect/extract', 'architect/ack',
  'architect/merge', 'architect/questions', 'architect/turn', 'architect/scene-from-plan',
  'architect/hear', 'architect/scrub', 'architect/prompt',
  'provisioning', 'bom', 'opening', 'status', 'readiness', 'advisor', 'privacy',
  'owner-brief', 'fusion', 'engineer-brief', 'plan-content'
];

function prepareBuild(tag) {
  const outDir = path.join(__dirname, '../planner/.test-build', tag);
  fs.mkdirSync(path.join(outDir, 'architect'), { recursive: true });

  function transpile(rel) {
    const src = path.join(srcDir, rel + '.ts');
    if (!fs.existsSync(src))
      return;
    let out = ts.transpile(fs.readFileSync(src, 'utf8'), {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext
    });
    out = out.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, "from '$1.mjs'");
    const dest = path.join(outDir, rel + '.mjs');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = dest + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, out);
    fs.renameSync(tmp, dest);
  }

  for (const name of MODULES)
    transpile(name);

  return { srcDir, outDir };
}

module.exports = { prepareBuild, MODULES, srcDir };
