# TrackPlan — Problem Statement 1

TrackPlan is a browser-based railway track access scheduler for the supplied dual-line network. Upload the eight instance CSVs, generate scenarios A/B/C, inspect activity timelines and safety footprints, and download the published output schemas. It requires no API key, Python backend or paid solver.

## Run

Use a current desktop browser and Python 3. From the project root (the folder containing this README):

```sh
python -m http.server 8000 --directory dist
```

Open http://localhost:8000. In **Overview**, upload all eight CSV files for one planning instance, then select **Generate baseline**. Use **Replan** for a future capacity loss, **Co-sharing** for validated pairing previews, and **Results** for detailed schedules. Uploaded copy suffixes such as `(1)` are accepted. The scheduler runs in a Web Worker. Files remain in the browser. Results are session-only; export before refreshing.

The browser app has no runtime dependencies or build step. Node.js 20+, npm, and Python 3.10+ are needed for development checks. From the project root:

```sh
npm ci
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-dev.txt
npm run check
```

`npm run check` runs Prettier, ESLint, the JavaScript regression tests, Ruff, and the independent Python audit. Use `npm run format` for JavaScript/HTML/CSS/README and `npm run format:python` for Python. All npm and Python packages are development tools only; do not deploy `node_modules/` or `.venv/`.

For architecture, input/output schemas, public code contracts, and safety assumptions, see the [developer guide](docs/DEVELOPER_GUIDE.md). For branch and review practices, see [contributing](docs/CONTRIBUTING.md).

The expected inputs are the eight named CSV files `01_LINES.csv` through `08_ACTIVITY_DETAILS.csv`, matching the columns in `dist/example.json`. Keep all eight from the same planning instance. The app rejects missing/empty datasets, duplicate input names, malformed CSV rows, and invalid scheduling values with an error message. `dist/example.json` is a reference instance, not an additional upload.

For team changes, branch from the current integration branch (for example, `git switch -c codex/my-change`), make the change, run `npm test` and `npm run format:check`, then open a merge request for review. Avoid direct edits to `main`. Generated results and the source ZIP should be refreshed intentionally, not included automatically with unrelated code changes.

## Interactive what-if lab

The dashboard's **Replan** page has two distinct workflows. The operational replan freezes all access and occupancy records through a chosen week, imposes a location's reduced weekly capacity over a future week range as a hard disruption in all three policies, and schedules only remaining work. It tries to preserve future weeks and possession groups when feasible. The resulting impact panel shows changed activities, penalties, and local-check status for the selected scenario. Scenario B may become infeasible if a disruption makes a fixed deadline impossible. This is event-driven (run on submit), not an automatic live feed. Future approvals are not hard-locked individually, and a bounded heuristic cannot guarantee minimal churn or find every feasible plan.

The **Co-sharing** page explains the current shared possession groups and tests same-week, overlapping-location pairings that currently use different groups. It rejects obvious PM, PC/PC and Live combinations, then runs every possible merge through the same local validator. A validated merge can be previewed and restored; a preview replaces only the displayed scenario, not the original baseline. The explorer caps detailed candidate checks at 80 for responsiveness, so “no merge found” is not proof that none exists. A freed slot is a distinct location-week-group count; penalty may remain unchanged. Neither workflow uses the organiser's withheld reference validator, so neither constitutes operational authorisation.

The distinction is **what can move**: co-sharing keeps every activity in its scheduled week and changes only possession grouping; operational replanning freezes past weeks but may move future work after a capacity loss. Replanning may itself form legal shares while rebuilding the schedule, but the co-sharing page is a focused, pair-by-pair inspection of an existing plan. Rejected pairings are explained in plain English, including conflicts with a third activity already in the target possession.

Operational-replan exports include the eight unchanged input CSVs and `experiment.json` with `capacityOverrides`, `hardDisruption: true`, and `freezeThroughWeek`. Reproducing the frozen schedule also requires the original baseline passed to `solve` as `lockedBaseline`, with `preserveFuture: true`; ordinary scenario solving with the override alone does not freeze history.

The optional **Other what-if comparisons** section below operational replan retains the earlier full-rerun experiment workflow:

Upload a planning dataset, then select **Generate baseline**. The lab accepts an activity's revised earliest week, a temporary weekly-capacity change at one location, or both. **Compare this change** runs an automatically suggested earlier start across A/B/C. The original inputs and baseline results stay intact.

The comparison shows the original and experimental penalty for each policy, the within-policy delta, feasibility, full-workload count, score components, and affected activities (including later finishes). **Baseline**, **Experiment**, and **Reset** control what the timeline and downloads show. A candidate that fails checks is identified as infeasible and cannot be exported.

Temporary capacity overrides in the original full-rerun lab apply inclusively from the selected start week through its end week. They change nominal capacity only; they do not create a physical safety closure. B/C retain their scenario-specific excess-capacity allowances. This workflow remains a full planning rerun, unlike the operational replan above.

Experiment exports include revised input CSVs plus `experiment.json` and an explanation. To reproduce a weekly capacity experiment, pass `experiment.json`'s `capacityOverrides` to `solve(data, scenario, { capacityOverrides })`; the static location-supply CSV cannot encode a week-specific override. Start-date changes are encoded directly in the revised activity CSV. Experiment results are not baseline submissions for the unchanged input instance.

The interface uses dataset-neutral upload wording; the underlying railway schema and required-input validation remain enforced. Header line colours are distinct, and problem-statement labels and promotional headline text have been removed.

Additional checks: `node scripts/test-experiments.mjs` tests start changes, temporary capacity boundaries, unchanged baselines, and independent revalidation of the experiment schedules.

## Optional score recommendations

After generating schedules, suggested changes appear inside the what-if lab. Compare a suggestion or enter a custom change in the same workspace. The Original baseline / Experiment switch controls the timeline and exports, while the comparison retains both scores. Reset experiment returns to the original plans. Select Original baseline before downloading the original schedules.

The bounded local search tests earlier accesses and ECLO changes against the unchanged dataset. If it finds no improvement, a separate what-if search tests bringing selected planned starts forward by up to three weeks. These proposals explicitly require a changed input date. They are validated against revised inputs, not valid submissions against the original dataset. Their downloads include all eight revised CSV inputs and a WHAT_IF_README.txt explanation. Changed activities and activities finishing later are listed before preview.

For the bundled instance, moving A036's planned start from 2027-05-31 to 2027-05-17 produces A/C penalties of 7 (original 25.2) and B of 10 (original 30). These are conditional what-if results, not improvements under the original start-date constraint. The search does not guarantee a global optimum. Regenerating or loading a new dataset resets the previews.

Implementation is separated into `recommendations.mjs` (candidate evaluation and search), `experiment-panel.mjs` (unified suggestions, experiments and plan controls), and `ui.mjs` (shared rendering helpers). The worker computes suggestions without blocking the interface. Baseline solver behavior is preserved.

Run regression checks with `node scripts/test-planning.mjs` and `node scripts/test-recommendations.mjs`.

## Reproduce the result files

Node.js 20+ runs the same JavaScript engine used by the browser:

```sh
node scripts/run.mjs /path/to/eight-input-csvs
python scripts/verify.py
```

No package installation is required. `run.mjs` writes three CSVs plus diagnostic JSON in each `results/A`, `results/B`, `results/C` folder and refreshes the supplied browser example. `verify.py` independently audits the exported CSVs against that example using the Python standard library. It is **not** the organisers' reference validator.

## Public dataset results

| Scenario | Activities complete | Contract-overrun days | Extra location-week access slots | ECLO access records | Penalty |
| -------- | ------------------: | --------------------: | -------------------------------: | ------------------: | ------: |
| A        |               54/54 |                    21 |                                0 |                   0 |    25.2 |
| B        |               54/54 |                     0 |                                0 |                   6 |    30.0 |
| C        |               54/54 |                    21 |                                0 |                   0 |    25.2 |

All three pass TrackPlan's implemented constraints and the independent CSV audit. Results have not been tested with the withheld/reference validator. The supplied sample schedule was not used as the solver's answer.

## Solver

The engine builds complete station/sector spans and expanded safety footprints. Live footprints mirror opposite bounds and close the other line's interchange locations. A multi-start weekly greedy scheduler tries urgency, priority, footprint size, Live-first and deterministic perturbed orderings. It places each eligible activity at most once per week, respecting FS+0 predecessor weeks. It allocates a possession slot and a separate local contractor night index, packs legal co-sharing groups, and checks workfront and weekly limits. Standard access yields 1; ECLO yields 1.5.

A enforces nominal supply and forbids ECLO. B tries nominal-capacity and flexible-capacity plans, adding ECLO when the remaining workload cannot fit the remaining target weeks. C also tries limited-capacity variants and candidate two-week ECLO windows for each line. Feasible candidates are ranked by the published scenario penalty. Candidate windows and orderings are bounded; this heuristic does not guarantee a global optimum or find every feasible hidden-instance plan.

The engine keeps scheduling beyond the nominal horizon to account for the full workload. A pathological zero-supply/disconnected instance may remain infeasible; the app reports failed checks and disables the submission export rather than silently omitting work. B also reports a failed deadline gate if its complete candidate overruns. A finite search cannot guarantee success on every possible input.

## Interpretation boundaries

- `co_share_group` is a consistent dispatch-slot label across an activity's route in a week. `access_night` is separately numbered within each contract/type/week; it is not a global weekday.
- Exclusion footprints cannot intersect within a dispatch slot unless the activities form a legal co-sharing possession. Different slots represent different access nights. Co-sharing is conservatively limited to overlapping non-Live spans, with no PM and no PC/PC sharing. Non-overlapping independent work may run in the same slot.
- Core occupation is written to SCHEDULE_OCCUPANCY. Buffers, mirrors and cross-line power closures are checked separately, not written as work locations.
- Weekly supply is taken as already net of maintenance. The supplied schema has no dated maintenance events. Capacity counts distinct possession groups at each core location-week, not team count or buffer area.
- Beyond the nominal horizon, the static per-location supply repeats. There is no future-week supply table in the provided instance schema.
- A finish is the Sunday of the last access week. Start dates map to their calendar planning week; successors begin in a strictly later week.
- Where prose conflicts, the explicit formulas govern: extra access costs 7 and ECLO costs 5. Activity priority nudges are 0.3/0.2/0.0 multiplied within contract bands 100/10/1.

The reference validator was not supplied. Its exact treatment of possession groups, closures and end-of-horizon weeks must be reconciled before claiming official feasibility. This prototype is not an operational railway authorisation tool.

## Files

- `dist/index.html`, `dist/style.css`, `dist/app.mjs`: browser entry point and interface.
- `dist/solver.mjs`, `dist/csv.mjs`, `dist/rules.mjs`: scheduling, validation, CSV parsing and shared scoring rules.
- `dist/worker.mjs`, `dist/experiment-worker.mjs`: background scheduling and what-if runs.
- `dist/experiment-panel.mjs`, `dist/experiments.mjs`, `dist/recommendations.mjs`: comparison UI, experiment model and suggestions.
- `dist/results-views.mjs`, `dist/result-data.mjs`, `dist/ui.mjs`: results rendering and shared presentation helpers.
- `scripts/run.mjs`: reproducible batch runner.
- `scripts/test-*.mjs`: regression tests; run all with `npm test`.
- `scripts/verify.py`: independent output audit.
- `results/`: computed public-instance schedules and diagnostics.
- `docs/`: solution write-up, video script and submission checklist.

## Submission remaining

The source is ready to upload to a GitLab project; no GitLab repository has been created through this session. Record the actual app walkthrough, upload it to YouTube, and supply its URL. Verify that judges can open the hosted app without your owner session. See `docs/SUBMISSION_CHECKLIST.md`.

## Decision support

The capacity table has clickable locations revealing possession groups and activities. Activity details explain timing, workload, predecessor constraints and ECLO implications. The controller briefing summarises each selected scenario and its approval-dependent decisions and can be downloaded as text.

## Reading the results

The results tabs retain the detailed schedule and add contextual explanations:

- Weekly timeline: calendar dates, work units per access, target markers, delivery/workload status, late-first ordering, an attention filter and a jump-to-delay control.
- Contract delivery: expandable contracts with target and finish dates, completion-driving activities, individual workload delivery and delay-score contributions.
- Capacity and checks: score components, used versus available slots, full/extra/over-limit labels, all-used-location filtering, and plain-language descriptions of every reported check.
- Network: selectable weeks, station work and external safety-footprint counts, station selection, and platform/tunnel detail with activity inspection.

The former standalone calculation and validation-assumption panels have been removed. View rendering is isolated in `results-views.mjs`; derived presentation metrics are in `result-data.mjs`. Run `node scripts/test-result-data.mjs` to reconcile those metrics with baseline and experiment reports.

The what-if lab is now the single place for automatic suggestions and custom experiments. Its Original baseline / Experiment switch controls the results and downloads; Reset experiment restores all original plans. Workspace links jump to the lab, scenario scores, or results tabs. The duplicate suggestion panel has been removed.
