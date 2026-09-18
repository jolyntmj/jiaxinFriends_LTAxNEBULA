import {
  activityAdvice,
  comparePlans,
  changeEvidence,
  activityAccesses,
} from "./planning.mjs";

const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

const fmt = (x) =>
  Number(x).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });

const $ = (id) =>
  document.getElementById(id);

const table = (headers, rows) =>
  '<div class="scroll"><table><thead><tr>' +
  headers
    .map((x) => "<th>" + x + "</th>")
    .join("") +
  "</tr></thead><tbody>" +
  rows
    .map(
      (row) =>
        "<tr>" +
        row
          .map((cell) => "<td>" + cell + "</td>")
          .join("") +
        "</tr>",
    )
    .join("") +
  "</tbody></table></div>";

export function createEnhancements(api) {
  let renderedData = null;
  let lastBrief = "";

  $("replan").onclick = () => {
    try {
      const location =
        $("disruption-location").value;

      const from =
        Number($("disruption-from").value);

      const to =
        Number($("disruption-to").value);

      const capacity =
        Number($("disruption-capacity").value);

      const activity =
        $("start-activity").value;

      const start =
        Number($("start-week").value);

      const exp = {
        disruptions: location
          ? [
              {
                location,
                from,
                to,
                capacity,
              },
            ]
          : [],

        startWeeks: activity
          ? {
              [activity]: start,
            }
          : {},
      };

      if (!location && !activity) {
        throw Error(
          "Choose a capacity change or an activity start change first.",
        );
      }

      api.experiment(exp);
    } catch (e) {
      $("experiment-error").textContent =
        e.message;
    }
  };

  $("reset-baseline").onclick = () => {
    api.reset();

    $("disruption-location").value = "";
    $("start-activity").value = "";

    $("disruption-location").onchange();

    $("experiment-error").textContent = "";
  };

  $("show-baseline").onclick = () =>
    api.showMode("baseline");

  $("show-experiment").onclick = () =>
    api.showMode("experiment");

  $("disruption-location").onchange = () => {
    const { data } = api.state();

    const location = data?.[
      "04_LOCATION_SUPPLY"
    ].find(
      (item) =>
        item.location_id ===
        $("disruption-location").value,
    );

    if (location) {
      $("disruption-capacity").max =
        location.supply_capacity;

      $("disruption-capacity").value =
        Math.max(
          0,
          Number(location.supply_capacity) - 1,
        );

      $("capacity-hint").textContent =
        "Original weekly supply: " +
        location.supply_capacity +
        ". This changes the access quota, not a full physical closure.";
    } else {
      $("capacity-hint").textContent =
        "Leave blank to test only an activity start change.";
    }
  };

  $("start-activity").onchange = () => {
    const state = api.state();

    const activity =
      state.baseline[
        state.scenario
      ]?.modelInfo.activities.find(
        (item) =>
          item.id ===
          $("start-activity").value,
      );

    if (activity) {
      $("start-week").value =
        activity.start;
    }
  };

  $("download-brief").onclick = () => {
    const state = api.state();

    const filename =
      "Controller_Brief_" +
      state.mode +
      "_" +
      state.scenario +
      ".txt";

    const file = new Blob(
      [lastBrief],
      {
        type: "text/plain",
      },
    );

    api.download(filename, file);
  };

  document.addEventListener(
    "click",
    (event) => {
      const button = event.target.closest(
        [
          "[data-hotspot]",
          "[data-recommend-start]",
          "[data-switch-scenario]",
          "[data-inspect-change]",
        ].join(","),
      );

      if (!button) {
        return;
      }

      const state = api.state();

      if (
        button.dataset.hotspot !== undefined
      ) {
        hotspot(
          Number(button.dataset.hotspot),
        );
      }

      if (button.dataset.switchScenario) {
        api.selectScenario(
          button.dataset.switchScenario,
        );
      }

      if (button.dataset.inspectChange) {
        api.inspect(
          button.dataset.inspectChange,
        );
      }

      if (button.dataset.recommendStart) {
        $("start-activity").value =
          button.dataset.recommendStart;

        $("start-week").value =
          button.dataset.week;

        $("disruption-location").value = "";

        $("disruption-location").onchange();

        $("experiment-panel").open = true;

        $("experiment-panel").scrollIntoView({
          behavior: "smooth",
        });

        $("experiment-error").textContent =
          "Hypothetical change only. Run the comparison to check resources and predecessors.";
      }
    },
  );

  function render() {
    const state = api.state();

    const result =
      state.results[state.scenario];

    const baseline =
      state.baseline[state.scenario];

    const complete = [
      "A",
      "B",
      "C",
    ].every(
      (scenario) =>
        state.baseline[scenario],
    );

    $("planning-mode").textContent =
      state.mode === "baseline"
        ? "SUBMISSION BASELINE"
        : "WHAT-IF EXPERIMENT";

    $("mode-strip").classList.toggle(
      "experiment-mode",
      state.mode === "experiment",
    );

    $("show-baseline").classList.toggle(
      "primary",
      state.mode === "baseline",
    );

    $("show-experiment").classList.toggle(
      "primary",
      state.mode === "experiment",
    );

    $("show-experiment").disabled =
      state.busy ||
      !Object.keys(
        state.experimental,
      ).length;

    $("show-baseline").disabled =
      state.busy;

    $("replan").disabled =
      state.busy || !complete;

    $("reset-baseline").disabled =
      state.busy ||
      !Object.keys(
        state.experimental,
      ).length;

    const experimentControls = [
      "disruption-location",
      "disruption-from",
      "disruption-to",
      "disruption-capacity",
      "start-activity",
      "start-week",
    ];

    for (
      const id of experimentControls
    ) {
      $(id).disabled =
        state.busy || !complete;
    }

    $("run").textContent =
      "Generate baseline schedules →";

    $("run").disabled =
      state.busy || !state.data;

    $("download-brief").disabled =
      state.busy || !result;

    if (
      state.data &&
      renderedData !== state.data
    ) {
      renderedData = state.data;

      $("disruption-location").innerHTML =
        '<option value="">No capacity change</option>' +
        state.data[
          "04_LOCATION_SUPPLY"
        ]
          .map(
            (location) =>
              '<option value="' +
              esc(location.location_id) +
              '">' +
              esc(location.location_id) +
              "</option>",
          )
          .join("");

      $("start-activity").innerHTML =
        '<option value="">No start-date change</option>' +
        state.data[
          "08_ACTIVITY_DETAILS"
        ]
          .map(
            (activity) =>
              "<option>" +
              esc(activity.activity_id) +
              "</option>",
          )
          .join("");
    }

    const changeText = state.experiment
      ? [
          (
            state.experiment
              .disruptions || []
          )
            .map(
              (change) =>
                change.location +
                ": capacity " +
                change.capacity +
                " in W" +
                change.from +
                "–" +
                change.to,
            )
            .join("; "),

          Object.entries(
            state.experiment
              .startWeeks || {},
          )
            .map(
              ([id, week]) =>
                id +
                ": earliest start W" +
                week,
            )
            .join("; "),
        ]
          .filter(Boolean)
          .join(" · ")
      : "";

    $("applied-changes").textContent =
      changeText
        ? (
            state.mode === "experiment"
              ? "Applied experiment: "
              : "Saved experiment: "
          ) + changeText
        : "Baseline inputs are preserved. Experiments are separate and can be reset.";

    if (!result) {
      $("brief-content").innerHTML =
        '<p class="muted">' +
        "Generate the baseline to see delivery risks and recommended decisions." +
        "</p>";

      $("comparison-panel").hidden = true;

      return;
    }

    const lateContracts =
      result.results.filter(
        (contract) =>
          contract.overrun_days > 0,
      );

    const safe =
      result.report.feasible;

    const otherResults =
      state.results;

    const summary = safe
      ? lateContracts.length
        ? lateContracts
            .map(
              (contract) =>
                contract.contract_number +
                " " +
                contract.overrun_days +
                " days late",
            )
            .join("; ") + "."
        : "All planned contract dates met."
      : "This candidate fails implemented checks; do not treat it as a submission-ready plan.";

    const approvals = [];

    if (
      result.report.eclo_nights_total
    ) {
      approvals.push(
        result.report.eclo_nights_total +
          " ECLO accesses require extended-hours approval",
      );
    }

    if (
      result.report
        .excess_access_nights_total
    ) {
      approvals.push(
        result.report
          .excess_access_nights_total +
          " extra location-week slots require additional access",
      );
    }

    if (lateContracts.length) {
      approvals.push(
        "accept or renegotiate the listed completion delays",
      );
    }

    if (
      state.mode === "experiment" &&
      Object.keys(
        state.experiment?.startWeeks ||
          {},
      ).length
    ) {
      approvals.push(
        "earlier starts are hypothetical and require approval",
      );
    }

    const comparisons = [
      "A",
      "B",
      "C",
    ]
      .filter(
        (scenario) =>
          otherResults[scenario],
      )
      .map((scenario) => {
        const report =
          otherResults[scenario].report;

        return (
          scenario +
          ": " +
          (
            report.feasible
              ? "checks passed"
              : "CHECKS FAILED"
          ) +
          ", " +
          report.overrun_days_total +
          " contract-delay days, " +
          report.eclo_nights_total +
          " ECLO, " +
          report
            .excess_access_nights_total +
          " extra slots, " +
          fmt(report.objective_score) +
          " penalty"
        );
      });

    lastBrief = [
      "TrackPlan controller briefing — " +
        state.mode +
        " — Scenario " +
        state.scenario,

      changeText,

      summary,

      "Complete activities: " +
        result.report.complete +
        "/" +
        result.report.total,

      ...comparisons,

      "Decisions: " +
        (
          approvals.join("; ") ||
          "No additional access or deadline concession identified."
        ),

      "Scores measure different policies: B enforces deadlines; A/C may accept delay.",

      "Checks are TrackPlan checks; the official validator has not been run.",
    ]
      .filter(Boolean)
      .join("\n");

    $("brief-content").innerHTML =
      '<div class="brief-main">' +
        "<strong>" +
          esc(summary) +
        "</strong>" +

        "<p>" +
          esc(
            approvals.length
              ? "Decisions needed: " +
                  approvals.join("; ") +
                  "."
              : "No additional access or deadline concession identified.",
          ) +
        "</p>" +
      "</div>" +

      '<div class="brief-options">' +
        comparisons
          .map(
            (comparison) =>
              "<p>" +
              esc(comparison) +
              "</p>",
          )
          .join("") +
      "</div>" +

      '<p class="muted">' +
        "B protects deadlines; A/C allow delay. " +
        "A lower score across different policies does not automatically mean a better operational choice." +
      "</p>";

    $("comparison-panel").hidden =
      !(
        state.mode === "experiment" &&
        baseline
      );

    if (
      state.mode === "experiment" &&
      baseline
    ) {
      const comparison =
        comparePlans(
          baseline,
          result,
        );

      const labels = {
        objective_score:
          "Penalty",

        overrun_days_total:
          "Contract-delay days",

        eclo_nights_total:
          "ECLO accesses",

        excess_access_nights_total:
          "Extra location-week slots",
      };

      $("comparison-summary").innerHTML =
        "<p>" +
          "<strong>" +
            comparison.changed.length +
            " activities changed; " +
            comparison.unchanged +
            " retained their weeks and ECLO settings." +
          "</strong> " +
          "Feasibility and penalty take precedence; fewer changed activities break score ties. " +
          "This is not a guarantee of minimum disruption." +
        "</p>" +

        table(
          [
            "Measure",
            "Baseline",
            "Experiment",
            "Change",
          ],

          comparison.metrics.map(
            (metric) => [
              labels[metric.key],
              fmt(metric.before),
              fmt(metric.after),

              (
                metric.delta > 0
                  ? "+"
                  : ""
              ) +
                fmt(metric.delta),
            ],
          ),
        );

      $("changes-table").innerHTML =
        comparison.rows.length
          ? table(
              [
                "Activity",
                "Baseline weeks (* ECLO)",
                "Revised weeks (* ECLO)",
                "Finish week change",
              ],

              comparison.rows.map(
                (row) => [
                  '<button class="table-button" data-inspect-change="' +
                    esc(row.id) +
                    '">' +
                    esc(row.id) +
                    " · " +
                    esc(row.contract) +
                  "</button>",

                  esc(row.before),

                  esc(row.after),

                  (
                    row.afterFinish -
                      row.beforeFinish >
                    0
                      ? "+"
                      : ""
                  ) +
                    (
                      row.afterFinish -
                      row.beforeFinish
                    ),
                ],
              ),
            )
          : '<p class="info">' +
              "The baseline remains feasible and no schedule changes were needed for this candidate." +
            "</p>";
    }
  }

  function inspect(id) {
    const state = api.state();

    const result =
      state.results[state.scenario];

    const advice =
      activityAdvice(result, id);

    const activity =
      advice.a;

    const baseline =
      state.baseline[state.scenario];

    const baselineActivity =
      state.baseline.A?.modelInfo.activities.find(
        (item) => item.id === id,
      );

    let html =
      '<section class="recommendations">' +
        "<h3>" +
          "Options to improve delivery" +
        "</h3>" +

        "<p>" +
          esc(
            advice.standardFinish >
              activity.due
              ? "At the current start and predecessor dates, standard accesses cannot meet the target even without congestion. Earliest standard finish: W" +
                  advice.standardFinish +
                  "."
              : advice.late
                ? "The workload can fit in isolation, but the selected schedule finishes late. Inspect the recorded deferrals and capacity constraints."
                : "This activity meets its target in the selected schedule. No recovery action is required.",
          ) +
        "</p>" +

        '<div class="recommendation-grid">' +
          "<article>" +
            '<span class="badge">' +
              "Current policy" +
            "</span>" +

            "<h4>" +
              (
                !advice.late
                  ? "Keep this placement"
                  : state.scenario === "B"
                    ? "Review failed deadline gate"
                    : "Accept the scheduled finish"
              ) +
            "</h4>" +

            "<p>" +
              esc(
                advice.late &&
                  state.scenario === "B"
                  ? "A late candidate is not valid for B. More search or revised inputs are needed."
                  : "Scheduled finish: W" +
                      advice.finish +
                      ". Safety and workload constraints still apply.",
              ) +
            "</p>" +
          "</article>";

    if (
      advice.earlierStart >= 1 &&
      baselineActivity &&
      advice.earlierStart <
        baselineActivity.start
    ) {
      html +=
        "<article>" +
          '<span class="badge">' +
            "Requires input approval" +
          "</span>" +

          "<h4>" +
            "Test an earlier start" +
          "</h4>" +

          "<p>" +
            "In isolation, start by W" +
            advice.earlierStart +
            " to fit " +
            Math.ceil(activity.workload) +
            " standard accesses before W" +
            activity.due +
            ". " +

            (
              advice.predFinish &&
              advice.predFinish >=
                advice.earlierStart
                ? "The current predecessor finish would also block this proposal. "
                : ""
            ) +

            "Re-run to check resource conflicts." +
          "</p>" +

          '<button data-recommend-start="' +
            esc(id) +
            '" data-week="' +
            advice.earlierStart +
          '">' +
            "Try as a what-if →" +
          "</button>" +
        "</article>";
    }

    html +=
      "<article>" +
        '<span class="badge">' +
          "Alternative policy" +
        "</span>" +

        "<h4>" +
          "Compare Scenario B" +
        "</h4>" +

        "<p>" +
          esc(
            advice.ecloCanFit
              ? advice.minimumECLO
                ? "At least " +
                    advice.minimumECLO +
                    " ECLO accesses are needed in isolation within the " +
                    advice.available +
                    " available weeks."
                : "No ECLO is required by the isolated workload calculation."
              : "ECLO alone cannot fit this workload into the available weeks at one access per week.",
          ) +

          " ECLO is forbidden in A; C has a two-week window per line. " +
          "Resource checks still apply." +
        "</p>" +

        '<button data-switch-scenario="B">' +
          "View calculated B plan →" +
        "</button>" +
      "</article>" +
    "</div>" +

    '<p class="muted">' +
      "Adding teams does not override the one-access-per-activity-per-week rule. " +
      "Suggestions do not silently change your submission inputs." +
    "</p>";

    const deferrals =
      result.decisions[id] || [];

    if (deferrals.length) {
      html +=
        "<details>" +
          "<summary>" +
            "Recorded scheduling constraints (" +
            deferrals.length +
            " weeks)" +
          "</summary>" +

          deferrals
            .map(
              (deferral) =>
                "<p>" +
                  "W" +
                  deferral.week +
                  ": " +
                  esc(deferral.reason) +

                  (
                    deferral.blockers?.length
                      ? " · Candidate-slot conflicts: " +
                        esc(
                          deferral.blockers.join(
                            ", ",
                          ),
                        )
                      : ""
                  ) +
                "</p>",
            )
            .join("") +
        "</details>";
    }

    if (
      state.mode === "experiment" &&
      baseline
    ) {
      html +=
        '<div class="info">' +
          "<strong>" +
            "Evidence behind the change" +
          "</strong>" +

          changeEvidence(
            baseline,
            result,
            id,
          )
            .map(
              (evidence) =>
                "<p>" +
                  esc(evidence) +
                "</p>",
            )
            .join("") +

          '<p class="muted">' +
            "These are recorded constraints and input relationships, not proof of a unique cause." +
          "</p>" +
        "</div>";
    }

    html += "</section>";

    $("inspector").insertAdjacentHTML(
      "beforeend",
      html,
    );
  }

  function hotspot(index) {
    const state = api.state();

    const result =
      state.results[state.scenario];

    const hotspot =
      result.report.hotspots[index];

    if (!hotspot) {
      return;
    }

    const entries =
      result.occupancy.filter(
        (occupation) =>
          occupation.week ===
            hotspot.week &&
          occupation.location_id ===
            hotspot.location,
      );

    const activityIds = [
      ...new Set(
        entries.map(
          (occupation) =>
            occupation.activity_id,
        ),
      ),
    ];

    $("inspector").hidden = false;

    $("inspector").innerHTML =
      '<div class="inspector-top">' +
        "<div>" +
          '<p class="eyebrow">' +
            "CAPACITY DETAIL · WEEK " +
            hotspot.week +
          "</p>" +

          "<h2>" +
            esc(hotspot.location) +
          "</h2>" +
        "</div>" +

        '<button id="close-hotspot">' +
          "Close ×" +
        "</button>" +
      "</div>" +

      "<p>" +
        hotspot.used +
        " possession groups / " +
        hotspot.capacity +
        " available slots · " +
        activityIds.length +
        " activities · " +
        hotspot.excess +
        " extra slots. " +
        "Co-sharing activities in the same group consume one slot here." +
      "</p>" +

      table(
        [
          "Activity",
          "Contract",
          "Possession group",
          "Type",
          "Work nature",
        ],

        activityIds.map(
          (id) => {
            const activity =
              result.modelInfo.activities.find(
                (item) =>
                  item.id === id,
              );

            const occupation =
              entries.find(
                (item) =>
                  item.activity_id === id,
              );

            return [
              '<button class="table-button" data-inspect-change="' +
                esc(id) +
              '">' +
                esc(id) +
              "</button>",

              esc(activity.contract),

              esc(
                occupation.co_share_group,
              ),

              esc(activity.access_type),

              esc(activity.nature),
            ];
          },
        ),
      ) +

      '<p class="info">' +
        "Full capacity does not itself mean a violation. " +
        "Scenario A permits no excess, B permits penalised excess, " +
        "and C permits at most one extra slot per location-week." +
      "</p>";

    $("close-hotspot").onclick = () => {
      $("inspector").hidden = true;
    };

    $("inspector").scrollIntoView({
      behavior: "smooth",
    });
  }

  return {
    render,
    inspect,
  };
}