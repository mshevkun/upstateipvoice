import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'planner/.test-build/clauses');

function transpile(rel) {
  let out = ts.transpile(fs.readFileSync(path.join(root, 'planner/src', rel + '.ts'), 'utf8'), {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  });
  out = out.replace(/from ['"](\.\.?\/[^'"]+)['"]/g, "from '$1.mjs'");
  fs.mkdirSync(path.dirname(path.join(outDir, rel + '.mjs')), { recursive: true });
  fs.writeFileSync(path.join(outDir, rel + '.mjs'), out);
}

test('clauses: split and scoped negation', async () => {
  fs.mkdirSync(outDir, { recursive: true });
  transpile('architect/clauses');
  const { mentions, splitClauses } = await import(path.join(outDir, 'architect/clauses.mjs'));
  const parts = splitClauses('Not Dentrix anymore, we moved to Open Dental.');
  assert.ok(parts.length >= 1);
  const dentrix = mentions('Not Dentrix anymore, we moved to Open Dental.', /\bDentrix\b/i, { scopes: ['negated', 'asserted', 'past', 'future', 'hypothetical'] });
  assert.equal(dentrix.find(h => h.match.toLowerCase().includes('dentrix'))?.scope, 'negated');
  const od = mentions('Not Dentrix anymore, we moved to Open Dental.', /\bOpen Dental\b/i, { scopes: ['asserted'] });
  assert.ok(od.length >= 1);
});