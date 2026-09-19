import assert from "node:assert/strict";
import fs from "node:fs";
import { prepare, solve, validate } from "../dist/solver.mjs";
import { runOperationalReplan } from "../dist/operational-replan.mjs";
import { exploreCoSharing } from "../dist/coshare.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../dist/example.json", import.meta.url)));
const dataSnapshot = JSON.stringify(data);
const baseline = solve(data, "A");
const baselineSnapshot = JSON.stringify(baseline);
const location = baseline.modelInfo.activities.find((activity) => activity.id === "A036").core[0];
const change = { location, from: 22, to: 23, capacity: 0, freezeThroughWeek: 21 };
const { result, moved } = runOperationalReplan(data, baseline, change);
assert(result.report.feasible);
assert(moved.length > 0);
for (const field of ["access", "occupancy"])
  assert.deepEqual(
    result[field].filter((row) => row.week <= change.freezeThroughWeek),
    baseline[field].filter((row) => row.week <= change.freezeThroughWeek),
  );
assert(
  !result.occupancy.some((row) => row.location_id === location && row.week >= 22 && row.week <= 23),
);
const model = prepare(data, {
  capacityOverrides: result.inputRevision.capacityOverrides,
  hardDisruption: true,
});
assert.deepEqual(validate(model, result), result.report);
assert.throws(() => runOperationalReplan(data, baseline, { ...change, from: 21 }));
assert.throws(() => runOperationalReplan(data, baseline, { ...change, capacity: -1 }));

const sharing = exploreCoSharing(data, baseline);
assert(sharing.existing.length > 0);
assert(sharing.opportunities.length > 0);
assert(
  sharing.rejected.some(
    (pair) =>
      pair.week === 11 &&
      pair.first === "A019" &&
      pair.second === "A038" &&
      pair.reason.includes("also put A003 and A038") &&
      pair.reason.includes("safety areas overlap"),
  ),
);
assert(sharing.rejected.every((pair) => !/^\d+\|/.test(pair.reason)));
for (const opportunity of sharing.opportunities) {
  assert(opportunity.candidate.report.feasible);
  assert.deepEqual(validate(prepare(data), opportunity.candidate), opportunity.candidate.report);
}
assert.equal(JSON.stringify(data), dataSnapshot);
assert.equal(JSON.stringify(baseline), baselineSnapshot);
console.log(
  "PASS: frozen-history disruption replan, hard closure, impact comparison, co-sharing validation and unchanged inputs.",
);
