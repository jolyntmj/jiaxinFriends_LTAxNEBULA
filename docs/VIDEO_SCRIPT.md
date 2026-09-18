# Three-minute demo script and recording plan

Record the actual hosted application in a desktop browser. This is a script, not a recorded or uploaded video. Aim for 2:40–2:55, leaving a few seconds of margin under three minutes.

## 0:00–0:20 — Problem and workspace

[Show the top of the app.]

“TrackPlan helps a railway works controller decide which activities get track access, while completing the full workload and respecting safety constraints. We compare three planning policies across Line Alpha and Line Beta.”

## 0:20–0:45 — Real input and generation

[Click Upload dataset, select all eight CSV files for one planning instance, then Generate schedules.]

“This is a live scheduler. It reads the network, available access, buffer rules, contract limits and activity demand. Judges can upload a new instance using these same eight CSV schemas. The supplied instance has 54 activities across 14 contracts.”

## 0:45–1:15 — Scenario comparison

[Click A, B, then C.]

“Scenario A fixes supply and forbids extended nights. Our plan completes every activity with 21 total contract-overrun days. Scenario B fixes completion dates: six extended nights remove the delays without extra location access. Scenario C balances the penalty costs and selects the lower-cost delay plan. Lower scores are better.”

## 1:15–1:50 — Explain an activity

[Select A. Search A036, click the activity and show its detail panel.]

“This activity needs seven standard access nights but starts too late to fit its target at one access per week. The detail explains its earliest completion, shows its actual access records and displays every occupied location. We can expand the safety footprint, including buffers and the special Live closure rules where applicable. A predecessor, if present, must finish in a strictly earlier week.”

## 1:50–2:15 — Delivery and validation

[Show Contract delivery, then Capacity & checks.]

“Controllers can review contract completion and inspect capacity hotspots. Our checks cover full workload delivery, dates, possession mixes, buffers, weekly allocations, teams and extended-night windows. A separate Python audit checks the exported results. These are our checks against the published brief; official validation still requires the organisers' reference tool.”

## 2:15–2:40 — Export

[Click Download all scenarios, open the resulting ZIP and show A/B/C folders.]

“One download produces the three required CSVs for each scenario: access placement, location occupancy and contract completion. These are generated from the same schedule visible in the app.”

## 2:40–2:55 — Close

[Return to the scenario cards.]

“TrackPlan combines complete workload planning, explicit safety checks and clear trade-offs in a single controller workspace. The heuristic is reproducible and can schedule new uploaded instances without changing the code.”

## Before uploading to YouTube

Check the actual runtime is under three minutes. Use a readable browser zoom. Hide personal account details and unrelated tabs. Open the hosted link from a judge-accessible session and verify it works. Upload the real recording to the team's YouTube account and put the resulting URL in the submission. Do not claim the official validator has run.
