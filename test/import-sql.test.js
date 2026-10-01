const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const duplicateQueries = [...source.matchAll(/SELECT id FROM transactions\s+WHERE person_id = \$1[\s\S]*?LIMIT 20/g)].map(match => match[0]);

test('preview and confirmation duplicate checks compare calendar dates with consistent PostgreSQL types', () => {
  assert.equal(duplicateQueries.length, 2);
  for (const sql of duplicateQueries) {
    // The BETWEEN branch types $3 as DATE, while transactions.date is TEXT.
    // Even on an empty table PostgreSQL rejects a remaining text = date branch.
    assert.match(sql, /date::date BETWEEN \$3::date - 3 AND \$3::date \+ 3/);
    assert.match(sql, /source_hash IS NULL AND date::date = \$3::date/);
    assert.doesNotMatch(sql, /(?:^|[\s(])date = \$3\b/);
  }
});
