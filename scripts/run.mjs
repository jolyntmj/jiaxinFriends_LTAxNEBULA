import fs from "node:fs";
import path from "node:path";

import {
  FILES,
  parseCSV,
  solve,
  outputFiles,
} from "../dist/solver.mjs";


const inputDirectory =
  process.argv[2];

const outputDirectory =
  process.argv[3] || "results";


if (!inputDirectory) {
  throw Error(
    "Usage: node scripts/run.mjs INPUT_DIRECTORY [OUTPUT_DIRECTORY]",
  );
}


const data = {};


/*
 * Find and load each required CSV file.
 *
 * Both of these filename formats are accepted:
 *
 * 01_LINES.csv
 * 01_LINES(1).csv
 */
for (const name of FILES) {
  const availableFiles =
    fs.readdirSync(
      inputDirectory,
    );

  const copiedFilePattern =
    new RegExp(
      "^" +
        name +
        "\\(\\d+\\)\\.csv$",
    );

  const matchingFiles =
    availableFiles.filter(
      (filename) =>
        filename ===
          name + ".csv" ||
        copiedFilePattern.test(
          filename,
        ),
    );

  const preferredFilename =
    name + ".csv";

  const selectedFilename =
    matchingFiles.includes(
      preferredFilename,
    )
      ? preferredFilename
      : matchingFiles[0];

  if (!selectedFilename) {
    throw Error(
      "Missing " + name,
    );
  }

  const filePath = path.join(
    inputDirectory,
    selectedFilename,
  );

  const fileContents =
    fs.readFileSync(
      filePath,
      "utf8",
    );

  data[name] =
    parseCSV(fileContents);
}


/*
 * Save the loaded input data for use
 * by the browser application.
 */
fs.writeFileSync(
  "dist/example.json",
  JSON.stringify(data),
);


/*
 * Generate output files for
 * Scenarios A, B and C.
 */
const scenarios = [
  "A",
  "B",
  "C",
];

for (const scenario of scenarios) {
  const result =
    solve(data, scenario);

  const scenarioDirectory =
    path.join(
      outputDirectory,
      scenario,
    );

  fs.mkdirSync(
    scenarioDirectory,
    {
      recursive: true,
    },
  );


  /*
   * Write the standard result CSV files.
   */
  const generatedFiles =
    outputFiles(result);

  for (
    const [name, contents] of
    Object.entries(
      generatedFiles,
    )
  ) {
    fs.writeFileSync(
      path.join(
        scenarioDirectory,
        name,
      ),
      contents,
    );
  }


  /*
   * Write the detailed validation report.
   */
  fs.writeFileSync(
    path.join(
      scenarioDirectory,
      "validation.json",
    ),
    JSON.stringify(
      result.report,
      null,
      2,
    ),
  );


  /*
   * Write the complete solver result.
   */
  fs.writeFileSync(
    path.join(
      scenarioDirectory,
      "solution.json",
    ),
    JSON.stringify(result),
  );


  /*
   * Print a short scenario summary
   * in the terminal.
   */
  const summary = {
    feasible:
      result.report.feasible,

    score:
      result.report
        .objective_score,

    violations:
      result.report
        .hard_violations
        .slice(0, 5),

    complete:
      result.report.complete,

    overrun:
      result.report
        .overrun_days_total,

    eclo:
      result.report
        .eclo_nights_total,

    excess:
      result.report
        .excess_access_nights_total,

    last:
      result.last,
  };

  console.log(
    scenario,
    JSON.stringify(summary),
  );
}