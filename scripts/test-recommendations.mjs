import fs from 'node:fs';
import assert from 'node:assert/strict';
import { solve, prepare, validate, parseCSV } from '../dist/solver.mjs';
import { findRecommendation, findStartDateSuggestion, evaluatePlan } from '../dist/recommendations.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../dist/example.json', import.meta.url)));
const inputSnapshot = JSON.stringify(data);
for (const scenario of ['A', 'B', 'C']) {
  const original = solve(data, scenario);
  const snapshot = JSON.stringify(original);
  const score = original.report.objective_score;
  const local = findRecommendation(data, original);
  if (local) {
    assert(local.saving > 0);
    assert.equal(validate(prepare(data), local.candidate).feasible, true);
  }
  const suggestion = findStartDateSuggestion(data, original);
  if (suggestion) {
    assert(suggestion.saving > 0);
    assert.equal(suggestion.originalScore, score);
    const revised = Object.fromEntries(Object.entries(suggestion.candidate.inputRevision.files)
      .map(([name, text]) => [name.replace('.csv', ''), parseCSV(text)]));
    assert.equal(validate(prepare(revised), suggestion.candidate).feasible, true);
  }
  assert.equal(JSON.stringify(original), snapshot);
}

// A deliberately delayed but feasible plan must offer a valid move under unchanged inputs.
const simple = structuredClone(data);
simple['08_ACTIVITY_DETAILS'] = [{ ...data['08_ACTIVITY_DETAILS'].find(a => a.activity_id === 'A007'), total_accesses: '1', predecessor_activity_id: '', planned_start_date: '2027-01-04' }];
for (const p of simple['07_PROJECT_DETAILS']) p.planned_completion_date = '2027-01-10';
const original = solve(simple, 'A');
const delayed = evaluatePlan(prepare(simple), original,
  original.access.map(row => ({ ...row, week: 3 })),
  original.occupancy.map(row => ({ ...row, week: 3 })));
assert.equal(delayed.report.feasible, true);
const move = findRecommendation(simple, delayed);
assert(move && move.saving > 0);
assert.equal(validate(prepare(simple), move.candidate).feasible, true);
assert.equal(move.candidate.inputRevision, undefined);
assert.equal(findRecommendation(simple, { ...original, report: { ...original.report, feasible: false } }), null);
assert.equal(JSON.stringify(data), inputSnapshot);
console.log('PASS: immutable originals; local and revised-input suggestions pass cross-group validation; simple recovery move improves score.');
