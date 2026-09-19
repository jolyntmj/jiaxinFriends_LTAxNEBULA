import fs from 'node:fs';
import assert from 'node:assert/strict';
import { solve, prepare, validate } from '../dist/solver.mjs';
import { buildExperiment, runExperiment, compareActivities } from '../dist/experiments.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../dist/example.json', import.meta.url)));
const snapshot = JSON.stringify(data);
const baseline = Object.fromEntries(['A', 'B', 'C'].map(s => [s, solve(data, s)]));
const baselineSnapshot = JSON.stringify(baseline);
const earlier = runExperiment(data, { activity: 'A036', startWeek: 20 });
for (const s of ['A', 'B', 'C']) {
  assert.equal(earlier.results[s].report.feasible, true);
  const changed = buildExperiment(data, { activity: 'A036', startWeek: 20 });
  assert.equal(validate(prepare(changed.data), earlier.results[s]).feasible, true);
  assert(earlier.results[s].inputRevision.description.includes('W22 → W20'));
  assert(Array.isArray(compareActivities(baseline[s], earlier.results[s])));
}
const location = baseline.A.modelInfo.activities.find(a => a.id === 'A036').core[0];
const change = { location, from: 22, to: 23, capacity: 0 };
const modified = buildExperiment(data, change);
const model = prepare(modified.data, modified.options);
assert.equal(model.capacity(location, 22), 0);
assert.equal(model.capacity(location, 23), 0);
assert.equal(model.capacity(location, 21), Number(data['04_LOCATION_SUPPLY'].find(row => row.location_id === location).supply_capacity));
assert.equal(model.capacity(location, 24), model.capacity(location, 21));
// A newly constrained week may already be empty in the corrected baseline.
const disruption = runExperiment(data, change);
assert.equal(disruption.results.A.report.feasible, true);
assert(!disruption.results.A.occupancy.some(row => row.location_id === location && row.week >= 22 && row.week <= 23));
for (const s of ['A', 'B', 'C']) {
  assert.deepEqual(validate(model, disruption.results[s]), disruption.results[s].report);
  assert.deepEqual(disruption.results[s].inputRevision.capacityOverrides, modified.options.capacityOverrides);
}
assert.throws(() => buildExperiment(data, {}));
assert.throws(() => buildExperiment(data, { activity: 'unknown', startWeek: 2 }));
assert.throws(() => buildExperiment(data, { activity: 'A036', startWeek: 0 }));
assert.throws(() => buildExperiment(data, { ...change, from: 24 }));
assert.throws(() => buildExperiment(data, { ...change, capacity: -1 }));
assert.equal(JSON.stringify(data), snapshot);
assert.equal(JSON.stringify(baseline), baselineSnapshot);
console.log('PASS: A/B/C start-date experiments, bounded capacity disruptions, independent revalidation, affected activities, immutable baselines and invalid-input rejection.');

