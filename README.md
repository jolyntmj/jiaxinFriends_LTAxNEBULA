# TrackPlan — Problem Statement 1

TrackPlan is a browser-based railway track access scheduler for the supplied dual-line network. Upload the eight instance CSVs, generate scenarios A/B/C, inspect activity timelines and safety footprints, and download the published output schemas. It requires no API key, Python backend or paid solver.

## Run

Use a current desktop browser. From the source directory:

```sh
python -m http.server 8000 --directory dist
```

Open http://localhost:8000, select **Upload dataset**, choose all eight CSV files for one planning instance, then select **Generate schedules**. Uploaded copy suffixes such as `(1)` are accepted. The scheduler runs in a Web Worker. Files remain in the browser. Results are session-only; export before refreshing.

## Reproduce the result files

Node.js 20+ runs the same JavaScript engine used by the browser:

```sh
node scripts/run.mjs /path/to/eight-input-csvs
python scripts/verify.py
```

No package installation is required. `run.mjs` writes three CSVs plus diagnostic JSON in each `results/A`, `results/B`, `results/C` folder and refreshes the supplied browser example. `verify.py` independently audits the exported CSVs against that example using the Python standard library. It is **not** the organisers' reference validator.

## Public dataset results

| Scenario | Activities complete | Contract-overrun days | Extra location-week access slots | ECLO access records | Penalty |
|---|---:|---:|---:|---:|---:|
| A | 54/54 | 21 | 0 | 0 | 25.2 |
| B | 54/54 | 0 | 0 | 6 | 30.0 |
| C | 54/54 | 21 | 0 | 0 | 25.2 |

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

- `dist/`: complete static app, shared solver, example input and ZIP exporter.
- `scripts/run.mjs`: reproducible batch runner.
- `scripts/verify.py`: independent output audit.
- `results/`: computed public-instance schedules and diagnostics.
- `docs/`: solution write-up, video script and submission checklist.

## Submission remaining

The source is ready to upload to a GitLab project; no GitLab repository has been created through this session. Record the actual app walkthrough, upload it to YouTube, and supply its URL. Verify that judges can open the hosted app without your owner session. See `docs/SUBMISSION_CHECKLIST.md`.

## Decision support

The capacity table has clickable locations revealing possession groups and activities. Activity details explain timing, workload, predecessor constraints and ECLO implications. The controller briefing summarises each selected scenario and its approval-dependent decisions and can be downloaded as text.
