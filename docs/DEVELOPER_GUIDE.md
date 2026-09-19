# TrackPlan developer guide

This guide describes the corrected source in `TrackPlan-closure-fixed`, including the closure-validation fix. It documents the implementation as it exists; it does not claim that the official competition validator has approved its output.

## 1. Project overview

TrackPlan is a static browser application for railway access scheduling. It reads planning CSVs, generates schedules under three policies, explains their results, and lets users compare proposed changes with an unchanged baseline.

The browser runs the solver in Web Workers. There is no application server, database, authentication service or external solver dependency. A local HTTP server serves the files; scheduling and uploaded-data processing happen in the browser. State is held in memory and is lost when the page reloads.

**Important scope:** the upload wording is generic, but the underlying model still requires the eight railway CSV tables listed below. It is not an arbitrary CSV analyser.

## 2. Run locally

Requirements:

- A modern browser with JavaScript modules, Web Workers and `structuredClone`.
- Python 3 for the static preview, packaging and independent audit.
- Node.js 20 or newer for the command-line solver and regression scripts. The development checks were run with Node.js 24.

From the extracted project root:

```sh
python -m http.server 8002 --bind 127.0.0.1 --directory dist
```

Open `http://localhost:8002/`, upload the planning CSVs, and select **Generate baseline**. Serving `dist` as the document root removes `/dist/` from the URL. Do not open the HTML directly through `file://`; module and worker loading need an HTTP origin.

No `npm install` or compilation step is required. Despite its name, `dist/` contains the maintained application modules in this project, rather than generated build output.

## 3. Code map

All paths below are relative to the project root.

| File | Responsibility |
| --- | --- |
| `dist/index.html` | Page structure, navigation, upload controls and results containers. |
| `dist/style.css` | Desktop/mobile layout and visual states. |
| `dist/app.mjs` | Upload parsing, application state, baseline worker lifecycle, scenario selection, export and activity inspection. |
| `dist/worker.mjs` | Generates A/B/C sequentially and computes optional recommendations. |
| `dist/solver.mjs` | Input preparation, route/closure construction, scheduling, validation, scoring and CSV serialization. |
| `dist/recommendations.mjs` | Searches validated local changes and separately searches revised-start assumptions. |
| `dist/experiments.mjs` | Builds revised inputs, applies temporary capacity overrides, runs A/B/C and compares activities. |
| `dist/experiment-worker.mjs` | Runs user-defined experiments off the main thread. |
| `dist/experiment-panel.mjs` | Unified Plan comparison controls, suggestions, comparison table and baseline/experiment switch. |
| `dist/results-views.mjs` | Weekly timeline, contract delivery, capacity/checks and weekly network views. |
| `dist/result-data.mjs` | Display calculations for activity status, dates, readable locations and capacity usage. |
| `dist/enhancements.mjs` | Controller briefing, activity advice and capacity hotspot details. |
| `dist/planning.mjs` | Isolated activity workload/dependency advice. |
| `dist/ui.mjs` | Shared HTML escaping, formatting and table helpers. |
| `dist/zip.mjs` | Browser ZIP creation. |
| `scripts/run.mjs` | Reproduce schedules from an input directory. |
| `scripts/verify.py` | Separate Python audit of exported CSVs. |
| `scripts/test-*.mjs` | Regression checks. |
| `scripts/package.py` | Creates the downloadable source archive. |
| `results/A`, `results/B`, `results/C` | Generated CSVs, solution snapshots and local validation reports. |

## 4. Data flow and state

```text
Upload CSVs → parseCSV → prepare → baseline worker
                                  ├─ solve A → validate → result + suggestion
                                  ├─ solve B → validate → result + suggestion
                                  └─ solve C → validate → result + suggestion
                                            ↓
                         originals + active results → views / exports

Proposed change → experiment worker → revised inputs + capacity overrides
                                    → solve A/B/C → comparison
```

The main application keeps:

- `data`: the loaded input tables.
- `originals`: baseline results for A/B/C.
- `results`: the plans currently displayed and exported.
- `suggestions`: optional computed alternatives for each policy.
- `scenario`, `view`, `busy`: selected policy/tab and execution state.

An experiment does not overwrite the baseline inputs. The plan switch changes which result objects the views and ordinary exports use. Reset restores the baseline. Loading another dataset or regenerating clears the experiment state.

The baseline worker accepts `{ data }` and emits `progress`, `result`, `recommendation`, `done` or `error` messages. The experiment worker accepts `{ data, change }` and emits `progress`, then `done` with the experiment or `error`.

Do not mutate baseline arrays when developing a recommendation. Build new arrays or clone data, recompute derived fields, and validate the complete candidate.

## 5. Input model

| Required CSV stem | Meaning |
| --- | --- |
| `01_LINES` | Line identifiers. |
| `02_STATIONS` | Ordered station sequence on each line. |
| `03_SECTORS` | Tunnel connections between stations. |
| `04_LOCATION_SUPPLY` | Nominal access capacity for each location. |
| `05_BUFFER_LOCATION` | Buffer size by nature of work. |
| `06_PARAMETERS` | Planning horizon start and length. |
| `07_PROJECT_DETAILS` | Contract/type limits, priorities, possession types and target dates. |
| `08_ACTIVITY_DETAILS` | Activity routes, workload, planned starts and predecessor IDs. |

`prepare(data, options)` clones inputs and constructs lookup maps, route spans and safety footprints. It rejects missing tables, invalid values, unknown references and predecessor cycles. Treat the current checks as the implemented contract, not as exhaustive validation of every possible malformed file.

Locations distinguish platform (`PLAT`) and tunnel (`SEC`), line, station/sector, and eastbound (`EB`) or westbound (`WB`). Contract limits use the compound key `contract_number | activity_type`.

Weeks are one-based from `horizon_start`. An access is credited in its scheduled week. Completion dates use the Sunday at the end of the final access week. Delay calculations use calendar dates in UTC.

## 6. Scheduling and scoring

The solver is a deterministic multi-start greedy heuristic. It tries different activity orderings, constructs weekly possession groups, respects predecessor eligibility, chooses placements, and ranks candidates by violations and penalty. It can continue beyond the nominal horizon to finish the workload.

Default search counts are currently 48 ordering seeds for A/C and 96 for B. Some seeds also run strict-capacity variants. C additionally searches candidate ECLO windows. B includes earlier ECLO strategies because waiting until the deadline is immediately threatened can leave no feasible recovery after closure restrictions are applied.

`solve(data, scenario, options)` returns a candidate even if the bounded search cannot find a feasible plan. Always inspect `result.report.feasible`; a returned object is not evidence of feasibility.

### Scenario policies

| Policy | Hard restriction | Penalty |
| --- | --- | --- |
| A | No excess capacity; no ECLO. Delays allowed. | Weighted activity delay. |
| B | Every activity must meet its planned target. | `7 × excess slots + 5 × ECLO accesses`. |
| C | At most one excess slot per location-week; ECLO fits a two-week window per affected line. | Weighted activity delay plus B's resource terms. |

A standard access delivers 1 work unit; an ECLO access delivers 1.5. Each activity receives at most one access in a week. Delay weight is contract priority weight (`100`, `10`, `1`) multiplied by the activity adjustment (`1.3`, `1.2`, `1.0`).

Weighted activity delay and total contract-delay days are different metrics. Do not multiply the displayed contract-delay total by a single priority weight to reconstruct the score.

### Closure rules and the corrected bug

The previous implementation compared safety conflicts only within a possession group. Different groups in the same week could therefore enter one another's closures. The official error screenshots exposed this, including A074 versus A059 and A007 in week 19.

The corrected implementation checks:

1. **Same group:** retain legal co-sharing and local possession-mix checks. The current sharing predicate is conservative: overlapping, non-Live work, no PM sharing, no PC/PC sharing.
2. **Different groups, same week:** reject overlapping safety footprints. This includes occupied spans, buffers, mirrored bounds and Live interchange crossover closures. It also conservatively excludes buffer-to-buffer overlap.
3. **Different weeks:** these weekly closure comparisons do not conflict.

`co_share_group` is not permission to bypass another group's closure. `access_night` is a local contractor/type allocation index, not a global calendar-night identifier that overrides weekly safety checks.

The full-footprint exclusion is stricter than testing only work-span versus closure intersections. Confirm the official rule interpretation before relaxing it. The old low penalties (25.2 / 30 / 25.2) came from invalid schedules and must not be restored as target assertions.

## 7. Result and export contract

A result includes `scenario`, `access`, `occupancy`, `results`, `report`, `modelInfo`, scheduling diagnostics and the final scheduled week. Key report fields include `feasible`, `hard_violations`, `complete`, `total`, `objective_score`, delay metrics, ECLO count and excess-slot count.

`outputFiles(result)` refuses candidates whose report is not feasible. This is an export guard, not an independent revalidation of an arbitrarily modified object. Revalidate any candidate you change before exporting it.

Official scenario submissions require exactly these root-level files:

```text
SCHEDULE_ACCESS.csv
activity_id,access_seq,week,eclo,access_night

SCHEDULE_OCCUPANCY.csv
activity_id,week,location_id,co_share_group

RESULTS.csv
scenario,contract_number,simulated_completion_date,overrun_days
```

Submit one ZIP for each scenario. The all-scenarios archive contains scenario directories and is not the same as an individual submission ZIP. Source archives and diagnostic JSON files do not belong inside a three-CSV submission ZIP.

### Experiments are separate assumptions

An earlier start changes the activity CSV. A temporary capacity change is passed through `options.capacityOverrides`:

```js
const result = solve(data, 'C', {
  capacityOverrides: [
    { location: 'PLAT:BET:S14:EB', from: 22, to: 23, capacity: 0 }
  ]
});
```

The week range is inclusive. A zero nominal supply is not a physical safety closure; B/C still have their policy-specific excess allowances. Experiment downloads include revised inputs and metadata because a static supply CSV alone cannot represent a temporary weekly override. These are not baseline submissions for unchanged inputs.

## 8. Reproduction and tests

From the project root:

```sh
node scripts/run.mjs /path/to/input-csvs
python scripts/verify.py
node scripts/test-closures.mjs
node scripts/test-planning.mjs
node scripts/test-experiments.mjs
node scripts/test-recommendations.mjs
node scripts/test-result-data.mjs
```

The runner writes `results/` by default and also replaces `dist/example.json` with the loaded dataset. Use a copy of the project when comparing datasets. Its optional second argument selects a different output directory. The auditor accepts an alternative results directory, but still reads inputs from `dist/example.json`; ensure they match.

| Test | What it establishes |
| --- | --- |
| `test-closures.mjs` | Reproduces reported conflicts, preserves legal sharing, rejects cross-group overlap and infeasible export, and checks B's deadline gate. |
| `test-planning.mjs` | Public-instance completion, feasibility, export headers, basic advice and input immutability. |
| `test-experiments.mjs` | Revised inputs, temporary-capacity boundaries, validation and preserved baselines. |
| `test-recommendations.mjs` | Positive-scoring suggestions are validated without mutating original plans. |
| `test-result-data.mjs` | Display calculations reconcile with solver reports. |
| `verify.py` | Separately implemented Python checks on serialized CSV outputs. |

The committed tests use the bundled public fixture, including its 54-activity expectation. Keep additional synthetic regression cases when expanding supported inputs. The Python audit is independent code, but shares this project's rule interpretation and is not the official validator.

The current corrected public-instance penalties are **A: 952, B: 150, C: 862.8**. All 54 activities are delivered in each result; B has zero delay and 30 ECLO accesses. These are reproducible heuristic results, not optimality guarantees or official acceptance scores.

For browser changes, also exercise upload → generate → compare → baseline/experiment switch → reset → export; then inspect each results tab at desktop and narrow mobile widths. Browser automation used during development is not included as a portable, configured test harness in this source package.

## 9. Making changes safely

### Changing scheduling behaviour

1. Write a small fixture that demonstrates the desired behaviour or bug.
2. Update placement logic and validation consistently. For closure changes, update the separate Python audit too.
3. Check complete workload, predecessor order, capacity, legal sharing and deadlines before comparing penalties.
4. Test A/B/C and revised-input experiments. A lower score from an infeasible candidate is not an improvement.
5. Inspect the exported CSVs, not only the in-memory result.

### Improving optimisation

Start with measured bottlenecks: activity ordering, coordinated moves, ECLO placement or legal co-sharing opportunities. Preserve the baseline and evaluate each proposed schedule through validation. Extend search budgets deliberately; recommendations invoke repeated solves and can increase perceived generation time substantially.

Do not alter planned starts, capacities or workloads silently to improve a baseline score. Those changes belong in Plan comparison and must carry their revised assumptions into exports.

### Changing presentation

Keep solver rules in `solver.mjs`, display calculations in `result-data.mjs`, and rendering in the view modules. Escape user-supplied strings with the shared `esc` helper before interpolating HTML. Avoid introducing a second suggestions panel: Plan comparison is the unified place for suggestions and experiments.

## 10. Packaging and troubleshooting

Run `python scripts/package.py` to rebuild `dist/TrackPlan_Source.zip`. The current packager includes `dist`, `scripts`, `docs`, `results` and the root README; it does not automatically include every root-level diagnostic file. This guide is under `docs/` so it is included.

| Symptom | Check |
| --- | --- |
| Old labels or code still appear | Confirm the server's document root, reload without cache, and check the actual module response. Some entry imports already carry version query strings. |
| Generation feels slow | Baselines and recommendations run sequentially per policy in the worker. Measure solve and recommendation time separately. |
| A result is infeasible | Read `hard_violations` and reproduce with the matching input fixture. Do not bypass export gating. |
| B has a low score but misses targets | Its deadline gate failed; the low resource penalty is not a feasible result. |
| Browser and Python audit disagree | Verify the same input data, scenario files and capacity assumptions were used. |
| Official validator rejects a locally passing plan | Preserve its exact messages and files, reproduce the violation, then add a regression before using another limited submission attempt. |

For the incident history and corrected submission files, see `FIX_NOTES.md` in the full corrected project. The user-supplied results ZIP contained CSV outputs only; this guide describes the latest source available in this conversation, not any separately modified project that has not been provided.
