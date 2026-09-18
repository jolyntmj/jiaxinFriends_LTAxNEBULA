import fs from "node:fs";
import assert from "node:assert/strict";

import {
  solve,
  prepare,
  validate,
  outputFiles,
  scheduleChanges,
} from "../dist/solver.mjs";

import {
  activityAdvice,
  comparePlans,
} from "../dist/planning.mjs";

const data = JSON.parse(
  fs.readFileSync(
    new URL("../dist/example.json", import.meta.url),
    "utf8",
  ),
);

const original = JSON.stringify(data);
const scenarios = ["A", "B", "C"];

const baseline = Object.fromEntries(
  scenarios.map((scenario) => [
    scenario,
    solve(data, scenario),
  ]),
);

// Check that generated baseline files match the stored result files.
for (const scenario of scenarios) {
  const files = outputFiles(baseline[scenario]);

  for (const [name, value] of Object.entries(files)) {
    const expected = fs.readFileSync(
      new URL(`../results/${scenario}/${name}`, import.meta.url),
      "utf8",
    );

    assert.equal(value, expected);
  }
}

// Test a disruption that removes capacity.
const experiment = {
  disruptions: [
    {
      location: "SEC:BET:S14_H01:EB",
      from: 22,
      to: 24,
      capacity: 0,
    },
  ],
};

const validationResult = validate(
  prepare(data, experiment),
  baseline.A,
);

assert(
  validationResult.hard_violations.some(
    (violation) => violation.rule === "capacity",
  ),
);

// Re-solve all scenarios using the disruption.
for (const scenario of scenarios) {
  const result = solve(data, scenario, {
    ...experiment,
    baseline: baseline[scenario],
  });

  assert(result.report.feasible);
  assert.equal(result.report.complete, 54);

  assert.equal(
    result.report.objective_score,
    {
      A: 52.5,
      B: 51,
      C: 46.2,
    }[scenario],
  );

  if (scenario === "A") {
    const disruptedLocation =
      experiment.disruptions[0].location;

    const usesClosedLocation =
      result.occupancy.some(
        (entry) =>
          entry.location_id === disruptedLocation &&
          entry.week >= 22 &&
          entry.week <= 24,
      );

    assert(!usesClosedLocation);

    const comparison = comparePlans(
      baseline.A,
      result,
    );

    assert.equal(comparison.changed.length, 4);
  }
}

// Test an earlier start week for activity A036.
const earlyStartResult = solve(data, "A", {
  startWeeks: {
    A036: 20,
  },
  baseline: baseline.A,
});

assert.equal(
  activityAdvice(earlyStartResult, "A036").finish,
  26,
);

assert.equal(
  earlyStartResult.report.objective_score,
  7,
);

assert.equal(
  activityAdvice(baseline.A, "A036").minimumECLO,
  4,
);

// Confirm that solving without changes preserves the baseline.
const unchangedResult = solve(data, "A", {
  baseline: baseline.A,
});

assert.equal(
  scheduleChanges(
    baseline.A,
    unchangedResult,
  ).length,
  0,
);

// Confirm that the original input data was not modified.
assert.equal(
  JSON.stringify(data),
  original,
);

// Reject a disruption whose end week precedes its start week.
assert.throws(() =>
  prepare(data, {
    disruptions: [
      {
        ...experiment.disruptions[0],
        to: 20,
      },
    ],
  }),
);

// Reject negative capacity.
assert.throws(() =>
  prepare(data, {
    disruptions: [
      {
        ...experiment.disruptions[0],
        capacity: -1,
      },
    ],
  }),
);

// Reject an unknown activity.
assert.throws(() =>
  prepare(data, {
    startWeeks: {
      UNKNOWN: 20,
    },
  }),
);

console.log(
  "PASS: all baseline CSVs unchanged; weekly disruptions, " +
    "valid experiments, earlier-start advice, no-op stability, " +
    "immutable data and malformed-input rejection.",
);