# TrackPlan: explainable railway access scheduling

## Problem and solution

PS1 asks planners to allocate scarce railway access while delivering every activity and protecting physical safety constraints. TrackPlan converts the eight CSV instance tables into an interactive, auditable schedule for Scenarios A, B and C. It accepts the provided data and new instances through the same interface and scheduling engine.

The supplied public instance contains 14 contracts, 54 activities, 76 locations and 192 required standard-access work units. The planning horizon begins 4 January 2027 and spans 30 weeks.

## Method

TrackPlan first reconstructs each line in station sequence. An activity's span includes every traversed tunnel and platform, including the station endpoints of tunnel endpoints. Buffer footprints expand by the contract's specified number of sectors. Live work additionally closes the opposite bound and the other line's H01–H02 interchange locations.

A deterministic multi-start serial heuristic considers several priority orderings. Each week it selects activities whose start week and predecessor requirements are satisfied, then packs compatible work into dispatch slots. It checks possession mixes, capacity, workfront limits and contractor-specific night indices before placement. The complete remaining workload is tracked explicitly. It compares feasible schedules using the published score rather than reporting an arbitrary utilisation metric as success.

Scenario A cannot purchase capacity or ECLO and therefore absorbs unavoidable schedule slip. B permits ECLO and extra access but must pass the zero-overrun deadline gate. C compares the costs of delay, one-slot local elasticity and line-specific two-week ECLO windows. The search includes nominal-capacity candidates so that flexibility cannot force a more expensive chosen plan.

## Public-instance results

| Scenario | Complete | Contract-overrun days | Extra access slots | ECLO nights | Published-formula penalty |
|---|---:|---:|---:|---:|---:|
| A | 54/54 | 21 | 0 | 0 | 25.2 |
| B | 54/54 | 0 | 0 | 6 | 30.0 |
| C | 54/54 | 21 | 0 | 0 | 25.2 |

The 21 days in A/C comprise C006's 14-day overrun and C010's 7-day overrun. Their late activities are A036 and A059. A036 starts in week 22 and needs seven standard accesses, so at one per week its earliest standard completion is week 28, two weeks after its contract target. A059 starts in week 14 and needs seven standard accesses, finishing no earlier than week 20, one week after its target. These delays arise from the workload and start dates even before resource congestion is considered.

The weighted delay is 14 × 1 × 1.3 + 7 × 1 × 1.0 = 25.2. B uses four ECLO accesses for A036 and two for A059, costing 6 × 5 = 30 while meeting all dates. C selects the lower-cost 25.2 plan. Its two-week ECLO window restricts the available acceleration, and no evaluated alternative is cheaper. Scores are computed from the published formulas; they are not official judge scores.

## What makes the tool useful

The planner can compare policies in one workspace, trace an activity's occupied route and safety footprint, see predecessors and deferral weeks, and export exactly the required files. Separate labels for dispatch slots and contractor-local night indices avoid treating the latter as universal weekdays. Hidden-instance uploads are processed using the actual scheduler, not precomputed answer lookup.

## Technology and verification

The app uses native HTML/CSS and JavaScript modules. A Web Worker keeps scheduling off the main interface thread. The same dependency-free engine runs in Node.js for reproducibility. A separate Python standard-library audit reconstructs routes and checks exported CSVs independently; it reproduces all three scores and checks workload, dates, predecessors, buffers, co-sharing, capacity, workfronts and ECLO. Negative checks caught omitted work, forbidden Scenario A ECLO and predecessor cycles. Reducing every location's supply to one still produced a complete Scenario A schedule under the implemented rules.

## Limitations

The organiser's reference validator is absent. Group/closure semantics and repeated supply beyond the horizon are explicit implementation assumptions and need comparison with that validator. The heuristic uses bounded orderings and ECLO windows and does not guarantee global optimality or feasibility for every hidden instance. Full interactive browser QA was unavailable in this environment; verify the visible upload, inspection and download flow before filming. The prototype does not authorise real railway possessions.
