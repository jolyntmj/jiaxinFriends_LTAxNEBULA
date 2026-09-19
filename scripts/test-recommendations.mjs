import fs from "node:fs";
import assert from "node:assert/strict";
import { solve, prepare, validate, parseCSV } from "../dist/solver.mjs";
import {
  findRecommendation,
  findStartDateSuggestion,
  evaluatePlan,
} from "../dist/recommendations.mjs";

const data = JSON.parse(fs.readFileSync(new URL("../dist/example.json", import.meta.url)));
const inputSnapshot = JSON.stringify(data);
for (const [scenario, score] of [
  ["A", 25.2],
  ["B", 30],
  ["C", 25.2],
]) {
  const original = solve(data, scenario);
  const snapshot = JSON.stringify(original);
  assert.equal(original.report.objective_score, score);
  assert.equal(findRecommendation(data, original), null);
  const suggestion = findStartDateSuggestion(data, original);
  assert(suggestion.saving > 0);
  assert.equal(suggestion.candidate.inputRevision.activityId, "A036");
  assert.equal(suggestion.suggestedScore, scenario === "B" ? 10 : 7);
  assert.equal(suggestion.originalScore, score);
  assert.equal(suggestion.candidate.report.feasible, true);
  const revised = Object.fromEntries(
    Object.entries(suggestion.candidate.inputRevision.files).map(([name, text]) => [
      name.replace(".csv", ""),
      parseCSV(text),
    ]),
  );
  assert.equal(validate(prepare(revised), suggestion.candidate).feasible, true);
  assert.equal(
    validate(prepare(data), suggestion.candidate).feasible,
    false,
    "Earlier start must never be presented as valid for the original inputs",
  );
  assert.equal(JSON.stringify(original), snapshot);
}

// A deliberately delayed but feasible plan must offer a valid move under unchanged inputs.
const original = solve(data, "A");
const rows = original.access.filter((row) => row.activity_id === "A059");
const last = rows.reduce((a, b) => (a.week > b.week ? a : b));
const delayed = evaluatePlan(
  prepare(data),
  original,
  original.access.map((row) => (row === last ? { ...row, week: row.week + 2 } : row)),
  original.occupancy.map((row) =>
    row.activity_id === "A059" && row.week === last.week ? { ...row, week: row.week + 2 } : row,
  ),
);
assert.equal(delayed.report.feasible, true);
const move = findRecommendation(data, delayed);
assert(move && move.saving > 0);
assert.equal(validate(prepare(data), move.candidate).feasible, true);
assert.equal(move.candidate.inputRevision, undefined);
assert.equal(
  findRecommendation(data, { ...original, report: { ...original.report, feasible: false } }),
  null,
);
assert.equal(JSON.stringify(data), inputSnapshot);
console.log(
  "PASS: original scores preserved; valid moves improve score; revised-start suggestions require revised inputs; all A/B/C suggestions revalidate.",
);
