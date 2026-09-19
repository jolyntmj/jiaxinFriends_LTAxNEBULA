import assert from "node:assert/strict";
import fs from "node:fs";

import { prepare } from "../dist/solver.mjs";

const example = JSON.parse(
  fs.readFileSync(new URL("../dist/example.json", import.meta.url), "utf8"),
);

const invalidHorizon = structuredClone(example);
invalidHorizon["06_PARAMETERS"].find((row) => row.key === "horizon_start").value = "2027-02-30";
assert.throws(() => prepare(invalidHorizon), /Invalid date: 2027-02-30/);

const invalidCompletion = structuredClone(example);
invalidCompletion["07_PROJECT_DETAILS"][0].planned_completion_date = "2027-13-01";
assert.throws(() => prepare(invalidCompletion), /Invalid date: 2027-13-01/);

assert.throws(
  () =>
    prepare(example, { capacityOverrides: [{ location: "unknown", from: 1, to: 2, capacity: 1 }] }),
  /Invalid capacity change/,
);

console.log("PASS: invalid calendar dates and capacity overrides are rejected.");
