import assert from "node:assert/strict";

import { csv, parseCSV } from "../dist/csv.mjs";

const rows = parseCSV('\uFEFFname,note\r\nA,"quoted, value"\r\nB,"two ""quotes"""\r\n');
assert.deepEqual(rows, [
  { name: "A", note: "quoted, value" },
  { name: "B", note: 'two "quotes"' },
]);
assert.deepEqual(parseCSV(csv(rows)), rows);
assert.throws(() => parseCSV("name,note\nA"), /row 2 has 1 columns; expected 2/);
assert.throws(() => parseCSV("name,name\nA,B"), /Duplicate CSV columns/);
assert.throws(() => parseCSV('name,note\nA,"open'), /Unclosed CSV quote/);
assert.throws(() => parseCSV('name,note\nA,un"quoted"'), /Unexpected CSV quote/);
assert.throws(() => parseCSV('name,note\nA,"closed"junk'), /Unexpected text after CSV quote/);

console.log("PASS: CSV escaping, BOM, column counts and malformed input errors.");
