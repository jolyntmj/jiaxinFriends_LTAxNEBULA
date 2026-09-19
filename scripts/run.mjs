import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { FILES, outputFiles, parseCSV, solve } from "../dist/solver.mjs";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const inputDirectory = process.argv[2];
const outputDirectory = process.argv[3] || path.join(projectRoot, "results");

function findInputFile(directoryEntries, expectedName) {
  const exactName = `${expectedName}.csv`;
  if (directoryEntries.includes(exactName)) return exactName;

  const copiedName = new RegExp(`^${expectedName}\\(\\d+\\)\\.csv$`);
  const matches = directoryEntries.filter((entry) => copiedName.test(entry));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw Error(`Multiple copies found for ${exactName}; keep one or use the exact filename.`);
  }
  throw Error(`Missing required input: ${exactName}`);
}

function loadInputs(directory) {
  const entries = fs.readdirSync(directory);
  return Object.fromEntries(
    FILES.map((name) => {
      const filename = findInputFile(entries, name);
      const contents = fs.readFileSync(path.join(directory, filename), "utf8");
      try {
        return [name, parseCSV(contents)];
      } catch (error) {
        throw Error(`${filename}: ${error.message}`, { cause: error });
      }
    }),
  );
}

function writeScenario(outputRoot, scenario, result) {
  const scenarioDirectory = path.join(outputRoot, scenario);
  fs.mkdirSync(scenarioDirectory, { recursive: true });
  for (const [filename, contents] of Object.entries(outputFiles(result))) {
    fs.writeFileSync(path.join(scenarioDirectory, filename), contents);
  }
  fs.writeFileSync(
    path.join(scenarioDirectory, "validation.json"),
    JSON.stringify(result.report, null, 2),
  );
  fs.writeFileSync(path.join(scenarioDirectory, "solution.json"), JSON.stringify(result));
  console.log(
    `${scenario}: ${result.report.feasible ? "feasible" : "infeasible"}, penalty ${result.report.objective_score}, ${result.report.complete}/${result.report.total} activities`,
  );
}

function main() {
  if (!inputDirectory) {
    throw Error("Usage: node scripts/run.mjs INPUT_DIRECTORY [OUTPUT_DIRECTORY]");
  }
  const inputs = loadInputs(inputDirectory);
  const scenarios = ["A", "B", "C"];
  const results = scenarios.map((scenario) => [scenario, solve(inputs, scenario)]);

  // Finish all calculations before replacing generated files if an input is invalid.
  fs.writeFileSync(path.join(projectRoot, "dist/example.json"), JSON.stringify(inputs));
  for (const [scenario, result] of results) writeScenario(outputDirectory, scenario, result);
}

try {
  main();
} catch (error) {
  console.error(`TrackPlanner: ${error.message}`);
  process.exitCode = 1;
}
