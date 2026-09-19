import fs from "node:fs";
import assert from "node:assert/strict";

import { FILES, outputFiles, prepare, solve } from "../dist/solver.mjs";
import { activityAdvice } from "../dist/planning.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../dist/example.json", import.meta.url), "utf8"));
const original = JSON.stringify(data);

for (const scenario of ["A", "B", "C"]) {
  const result = solve(data, scenario);

  assert.equal(result.report.feasible, true);
  assert.equal(result.report.complete, result.report.total);
  assert.equal(result.report.total, 54);

  const files = outputFiles(result);
  assert.deepEqual(Object.keys(files), [
    "SCHEDULE_ACCESS.csv",
    "SCHEDULE_OCCUPANCY.csv",
    "RESULTS.csv",
  ]);

  assert.match(files["SCHEDULE_ACCESS.csv"], /^activity_id,access_seq,week,eclo,access_night/m);
  assert.match(files["SCHEDULE_OCCUPANCY.csv"], /^activity_id,week,location_id,co_share_group/m);
  assert.match(
    files["RESULTS.csv"],
    /^scenario,contract_number,simulated_completion_date,overrun_days/m,
  );
}

const scenarioA = solve(data, "A");
const advice = activityAdvice(scenarioA, "A036");
assert.equal(advice.a.id, "A036");
assert(Number.isInteger(advice.standardFinish));

assert.equal(JSON.stringify(data), original);
assert.throws(() => solve(data, "UNKNOWN"));

const incomplete = structuredClone(data);
delete incomplete[FILES[0]];
assert.throws(() => prepare(incomplete));

console.log(
  "PASS: A/B/C schedules are feasible and complete; exports, advice, immutable inputs and missing-file rejection verified.",
);
