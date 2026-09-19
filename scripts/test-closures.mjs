import fs from 'node:fs';
import assert from 'node:assert/strict';
import { prepare, validate, solve, outputFiles } from '../dist/solver.mjs';
const data = JSON.parse(fs.readFileSync(new URL('../dist/example.json', import.meta.url)));
const model = prepare(data);

// Reproduce the exact week-19, different-group conflicts shown by the official validator.
const groups = { A074: 'n2', A059: 'n1', A007: 'n1' };
const regression = {
  scenario: 'A', results: [],
  access: Object.keys(groups).map(activity_id => ({ activity_id, week: 19, access_seq: 1, eclo: 0, access_night: 1 })),
  occupancy: Object.entries(groups).flatMap(([activity_id, co_share_group]) => model.byId.get(activity_id).core.map(location_id => ({ activity_id, week: 19, location_id, co_share_group }))),
};
const violations = validate(model, regression).hard_violations.filter(v => v.rule === 'closure');
for (const other of ['A059', 'A007']) assert(violations.some(v => v.detail.includes('A074') && v.detail.includes(other)));

// Legal co-sharing is exempt, but merely moving the same activities into a
// different group cannot evade their weekly closure conflict.
const source = model.byId.get('A007');
const activities = ['X1', 'X2'].map(activity_id => ({ ...source, activity_id, live: false,
  workload: 1, start: 1, predecessor_activity_id: '', p: { ...source.p, access_type: 'C', fronts: 4 } }));
const mini = { ...model, acts: activities, byId: new Map(activities.map(a => [a.activity_id, a])) };
const shared = { scenario: 'A', results: [], access: activities.map(a => ({ activity_id: a.activity_id, week: 1, eclo: 0, access_seq: 1, access_night: 1 })),
  occupancy: activities.flatMap(a => a.core.map(location_id => ({ activity_id: a.activity_id, week: 1, location_id, co_share_group: 'shared' }))) };
assert(!validate(mini, shared).hard_violations.some(v => v.rule === 'closure'));
const separate = structuredClone(shared);
for (const row of separate.occupancy) if (row.activity_id === 'X2') row.co_share_group = 'different';
assert(validate(mini, separate).hard_violations.some(v => v.rule === 'closure'));

for (const scenario of ['A', 'B', 'C']) {
  const result = solve(data, scenario);
  assert.equal(result.report.feasible, true);
  assert.equal(result.report.complete, 54);
  assert.equal(validate(model, result).hard_violations.length, 0);
  if (scenario === 'B') assert.equal(result.report.overrun_days_total, 0);
  const files = outputFiles(result);
  assert.equal(Object.keys(files).length, 3);
  assert.throws(() => outputFiles({ ...result, report: { ...result.report, feasible: false } }), /infeasible/i);
}
console.log('PASS: week-19 A074/A059/A007 regression, legal sharing, cross-group rejection, A/B/C complete feasibility, B deadline gate and unsafe-export rejection.');
