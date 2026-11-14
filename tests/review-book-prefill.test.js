'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('review.js prefills practice name from ?name= and keeps Practice name placeholder', () => {
  const src = fs.readFileSync(path.join(__dirname, '../js/review.js'), 'utf8');
  assert.match(src, /practiceName:\s*\(q\.get\("name"\)/);
  assert.match(src, /placeholder\s*=\s*['"]Practice name['"]/);
  assert.match(src, /fields\.business_name\.value\s*=\s*plannerParams\.practiceName/);
});
