# TrackPlan developer guide

This guide describes the code contracts and the assumptions a maintainer needs before changing the scheduler. Start with the [README](../README.md) for setup and use. The quality process follows the applicable parts of DataCamp's [coding best-practices guide](https://www.datacamp.com/tutorial/coding-best-practices-and-guidelines): clear structure, documentation, automated checks, tests, input validation, review, and security. This is a local static browser app; authentication, encryption at rest, databases, distributed processing, and vectorization are not applicable to its current design.

## Architecture and data flow

1. `dist/app.mjs` reads the eight CSV files locally, parses them through `dist/csv.mjs`, and calls `prepare` to reject invalid planning instances before enabling generation.
2. `dist/worker.mjs` runs `solve` for scenarios A, B, and C in a Web Worker and searches for optional recommendations. Its messages contain progress, results, recommendations, completion, or an error.
3. `dist/solver.mjs` builds the network model, schedules activities, validates the result, and scores feasible candidates. Shared numeric rules live in `dist/rules.mjs`.
4. `dist/result-data.mjs` derives presentation metrics. `dist/results-views.mjs`, `dist/enhancements.mjs`, and `dist/experiment-panel.mjs` render the interface using helpers in `dist/ui.mjs`.
5. `dist/experiment-worker.mjs` and `dist/experiments.mjs` run changed-input comparisons without modifying the baseline dataset. `dist/recommendations.mjs` validates every proposed schedule against the same rules.
6. `dist/zip.mjs` packages browser downloads. `scripts/run.mjs` runs the same solver in Node. `scripts/verify.py` independently audits the generated CSVs; it does not import the JavaScript solver.

The browser keeps inputs and results in memory. There is no network API or server-side storage. Refreshing the page loses the current session; export before refreshing.

## Input contract

Upload exactly one planning instance consisting of all eight CSVs. Browser uploads may have a `(1)`-style copy suffix. `scripts/run.mjs` accepts either the exact filename or a single suffixed copy per input. Each CSV needs a nonempty, unique header row and the same number of columns in every nonblank data row. `dist/example.json` shows a complete example; its schema is summarized below.

| File                      | Required headers                                                                                                                                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01_LINES.csv`            | `line_code`, `line_name`                                                                                                                                                                                                                                        |
| `02_STATIONS.csv`         | `station_id`, `line_code`, `seq`, `is_interchange`                                                                                                                                                                                                              |
| `03_SECTORS.csv`          | `sector_id`, `line_code`, `from_station_id`, `to_station_id`, `seq`, `is_shared`                                                                                                                                                                                |
| `04_LOCATION_SUPPLY.csv`  | `location_id`, `location_kind`, `line_code`, `bound`, `supply_capacity`                                                                                                                                                                                         |
| `05_BUFFER_LOCATION.csv`  | `nature_of_works`, `up_to_buffer_sectors`, `opposite_bound_required`                                                                                                                                                                                            |
| `06_PARAMETERS.csv`       | `key`, `value` (`horizon_start` and `horizon_weeks`)                                                                                                                                                                                                            |
| `07_PROJECT_DETAILS.csv`  | `contract_number`, `contract_description`, `contract_award_date`, `activity_type`, `nature_of_activity`, `contract_priority`, `contract_completion_date`, `planned_completion_date`, `number_of_workfronts`, `access_type`, `number_of_maximum_access_per_week` |
| `08_ACTIVITY_DETAILS.csv` | `activity_id`, `contract_number`, `activity_type`, `start_location_id`, `end_location_id`, `total_accesses`, `planned_start_date`, `predecessor_activity_id`, `activity_priority`                                                                               |

Dates are ISO `YYYY-MM-DD`. Activity endpoints must be on one line and bound, and each activity must reference a valid contract/type, route, buffer rule, and supply location. Predecessors must exist and cannot form a cycle. Invalid or incomplete input throws an error; callers show that message to the user. Do not silently fill missing planning values.

## Public code contracts

| API                                            | Purpose and result                                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `parseCSV(text)` / `csv(rows, headers?)`       | Convert between CSV text and row objects. The parser rejects malformed headers, unclosed quotes, and inconsistent row widths.                                                                                                             |
| `prepare(data, options?)`                      | Validate and clone an input instance, then build routes, activities, capacities, and date helpers. It does not mutate `data`.                                                                                                             |
| `solve(data, scenario, options?)`              | Produce one candidate for `A`, `B`, or `C`, with `access`, `occupancy`, `results`, `report`, and `modelInfo`. `options.capacityOverrides` supports bounded what-if capacity changes; `options.attempts` controls heuristic search effort. |
| `validate(model, result)`                      | Recheck workload, dates, possession safety, contractor limits, capacity, ECLO rules, and output consistency. Returns `feasible`, violations, and score metrics.                                                                           |
| `outputFiles(result)`                          | Return the three published CSV outputs, keyed by filename. Callers must not export a result whose `report.feasible` is false.                                                                                                             |
| `runExperiment(data, change, progress?)`       | Clone revised inputs, solve all three policies, and attach the revision metadata needed to reproduce downloads.                                                                                                                           |
| `findRecommendation(data, baseline, options?)` | Bounded local search for a validated improvement under the original input. It may return `null`; it does not guarantee a global optimum.                                                                                                  |

The generated CSVs are `SCHEDULE_ACCESS.csv` (activity/week/access), `SCHEDULE_OCCUPANCY.csv` (core locations and possession group), and `RESULTS.csv` (contract completion and overrun). `results/{A,B,C}/validation.json` and `solution.json` are diagnostics, not official submission schemas. What-if downloads include revised inputs and `experiment.json`; a week-specific capacity override is not representable in the static supply CSV alone.

## Important invariants and limitations

- The scheduler is a deterministic, bounded multi-start heuristic. A feasible result is not a proof of optimality; an infeasible result is not proof that no schedule exists.
- One standard access delivers 1 work unit; ECLO delivers 1.5. Extra access and ECLO score weights are centralized in `dist/rules.mjs`.
- The solver's possession group is a dispatch-slot label across the route. `access_night` is a separate contractor-local night index. Do not conflate them.
- Core occupancy appears in the output; buffers, opposite-bound mirrors, and Live cross-line closures are checked as safety footprints, not written as core work locations.
- The static location supply repeats beyond the input horizon. Weekly what-if overrides apply only in their inclusive `from`–`to` range.
- The official organiser validator was not supplied. The local validator and independent Python audit cannot establish official or operational railway safety approval.

## Errors, security, and performance

CSV and model errors should identify the offending input or rule. Workers must report failures to the visible UI and release the busy state. Do not export an invalid candidate. Keep user-controlled strings escaped before inserting them into HTML; `dist/ui.mjs` exports `esc` for this purpose. Its `table` helper intentionally accepts HTML cells, so callers must escape untrusted cell text themselves.

No credentials are required, and input files remain in the browser unless the user explicitly exports them. Do not add hidden uploads, telemetry, hardcoded secrets, or a third-party parser without a separate privacy and dependency review. The 20 MB per-file browser limit bounds accidental memory use. Profile a representative instance before changing the scheduling algorithm for speed; maintain readability and validate A/B/C outputs after any optimization.

## Verification

From the project root, follow the README development setup, then run `npm run check` for Prettier, ESLint, JavaScript regressions, Ruff, and the independent Python audit. Run `node scripts/run.mjs INPUT_DIRECTORY [OUTPUT_DIRECTORY]` only when you intend to regenerate `dist/example.json` and scenario results. Changes to any scoring or safety rule need a focused test and an independent review of the corresponding output CSVs.
