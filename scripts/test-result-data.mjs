import fs from 'node:fs';
import assert from 'node:assert/strict';
import { solve } from '../dist/solver.mjs';
import { runExperiment } from '../dist/experiments.mjs';
import { activityStatus, capacityRows, weekDate, locationName } from '../dist/result-data.mjs';
const data = JSON.parse(fs.readFileSync(new URL('../dist/example.json', import.meta.url)));
const experiment = runExperiment(data, { location: 'PLAT:BET:S14:EB', from: 22, to: 23, capacity: 0 });
for (const scenario of ['A', 'B', 'C']) {
  for (const result of [solve(data, scenario), experiment.results[scenario]]) {
    const statuses = result.modelInfo.activities.map(a => activityStatus(result, a, data));
    assert.equal(+statuses.reduce((sum, s) => sum + s.delayPenalty, 0).toFixed(3), result.report.priority_weighted_score);
    assert.equal(statuses.filter(s => s.complete).length, result.report.complete);
    assert.equal(capacityRows(data, result).reduce((sum, r) => sum + r.excess, 0), result.report.excess_access_nights_total);
    assert.equal(weekDate(result, 1), result.modelInfo.start);
  }
}
assert.equal(locationName('SEC:BET:S14_H01:EB'), 'Beta · S14–H01 tunnel · eastbound');
console.log('PASS: per-activity delay, workload, capacity totals and experiment overrides reconcile with reports in all three policies.');
