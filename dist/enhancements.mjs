import { activityAdvice } from "./planning.mjs";

import { $, esc, fmt, table } from "./ui.mjs";

export function createEnhancements(api) {
  let lastBrief = "";

  $("download-brief").onclick = () => {
    const { scenario } = api.state();
    api.download(
      "Controller_Brief_Scenario_" + scenario + ".txt",
      new Blob([lastBrief], { type: "text/plain" }),
    );
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-hotspot],[data-switch-scenario]");

    if (!button) return;

    if (button.dataset.hotspot !== undefined) {
      hotspot(Number(button.dataset.hotspot));
    }

    if (button.dataset.switchScenario) {
      api.selectScenario(button.dataset.switchScenario);
    }
  });

  function render() {
    const state = api.state();
    const result = state.results[state.scenario];

    $("download-brief").disabled = state.busy || !result;

    if (!result) {
      $("brief-content").innerHTML =
        '<p class="muted">Generate schedules to see delivery risks and recommended decisions.</p>';
      return;
    }

    const lateContracts = result.results.filter((item) => item.overrun_days > 0);
    const safe = result.report.feasible;
    const otherResults = state.results;

    const summary =
      (result.inputRevision ? "What-if plan: checked against revised planning assumptions. " : "") +
      (safe
        ? lateContracts.length
          ? lateContracts
              .map((item) => item.contract_number + " " + item.overrun_days + " days late")
              .join("; ") + "."
          : "All planned contract dates met."
        : "This candidate fails implemented checks; do not treat it as a submission-ready plan.");

    const approvals = [];
    if (result.report.eclo_nights_total) {
      approvals.push(
        result.report.eclo_nights_total + " ECLO accesses require extended-hours approval",
      );
    }
    if (result.report.excess_access_nights_total) {
      approvals.push(
        result.report.excess_access_nights_total +
          " extra location-week slots require additional access",
      );
    }
    if (lateContracts.length) {
      approvals.push("accept or renegotiate the listed completion delays");
    }

    const comparisons = ["A", "B", "C"]
      .filter((scenario) => otherResults[scenario])
      .map((scenario) => {
        const report = otherResults[scenario].report;
        return (
          scenario +
          ": " +
          (report.feasible ? "checks passed" : "CHECKS FAILED") +
          ", " +
          report.overrun_days_total +
          " contract-delay days, " +
          report.eclo_nights_total +
          " ECLO, " +
          report.excess_access_nights_total +
          " extra slots, " +
          fmt(report.objective_score) +
          " penalty"
        );
      });

    lastBrief = [
      "TrackPlan controller briefing — Scenario " + state.scenario,
      summary,
      "Complete activities: " + result.report.complete + "/" + result.report.total,
      ...comparisons,
      "Decisions: " +
        (approvals.join("; ") || "No additional access or deadline concession identified."),
      "Scores measure different policies: B enforces deadlines; A/C may accept delay.",
      "Checks are TrackPlan checks; the official validator has not been run.",
    ].join("\n");

    $("brief-content").innerHTML =
      '<div class="brief-main"><strong>' +
      esc(summary) +
      "</strong><p>" +
      esc(
        approvals.length
          ? "Decisions needed: " + approvals.join("; ") + "."
          : "No additional access or deadline concession identified.",
      ) +
      '</p></div><div class="brief-options">' +
      comparisons.map((item) => "<p>" + esc(item) + "</p>").join("") +
      '</div><p class="muted">B protects deadlines; A/C allow delay. A lower score across different policies does not automatically mean a better operational choice.</p>';
  }

  function inspect(id) {
    const state = api.state();
    const result = state.results[state.scenario];
    const advice = activityAdvice(result, id);
    const activity = advice.a;

    let html =
      '<section class="recommendations"><h3>Options to improve delivery</h3><p>' +
      esc(
        advice.standardFinish > activity.due
          ? "At the current start and predecessor dates, standard accesses cannot meet the target even without congestion. Earliest standard finish: W" +
              advice.standardFinish +
              "."
          : advice.late
            ? "The workload can fit in isolation, but the selected schedule finishes late. Inspect the recorded deferrals and capacity constraints."
            : "This activity meets its target in the selected schedule. No recovery action is required.",
      ) +
      '</p><div class="recommendation-grid"><article><span class="badge">Current policy</span><h4>' +
      (!advice.late
        ? "Keep this placement"
        : state.scenario === "B"
          ? "Review failed deadline gate"
          : "Accept the scheduled finish") +
      "</h4><p>" +
      esc(
        advice.late && state.scenario === "B"
          ? "A late candidate is not valid for B. More search or revised inputs are needed."
          : "Scheduled finish: W" +
              advice.finish +
              ". Safety and workload constraints still apply.",
      ) +
      '</p></article><article><span class="badge">Alternative policy</span><h4>Compare Scenario B</h4><p>' +
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
      ' ECLO is forbidden in A; C has a two-week window per line. Resource checks still apply.</p><button data-switch-scenario="B">View calculated B plan →</button></article></div><p class="muted">Adding teams does not override the one-access-per-activity-per-week rule. Recommendations do not change the uploaded dataset.</p>';

    const deferrals = result.decisions[id] || [];
    if (deferrals.length) {
      html +=
        "<details><summary>Recorded scheduling constraints (" +
        deferrals.length +
        " weeks)</summary>" +
        deferrals
          .map(
            (item) =>
              "<p>W" +
              item.week +
              ": " +
              esc(item.reason) +
              (item.blockers?.length
                ? " · Candidate-slot conflicts: " + esc(item.blockers.join(", "))
                : "") +
              "</p>",
          )
          .join("") +
        "</details>";
    }

    html += "</section>";
    $("inspector").insertAdjacentHTML("beforeend", html);
  }

  function hotspot(index) {
    const state = api.state();
    const result = state.results[state.scenario];
    const item = result.report.hotspots[index];
    if (!item) return;

    const entries = result.occupancy.filter(
      (entry) => entry.week === item.week && entry.location_id === item.location,
    );
    const ids = [...new Set(entries.map((entry) => entry.activity_id))];

    $("inspector").hidden = false;
    $("inspector").innerHTML =
      '<div class="inspector-top"><div><p class="eyebrow">CAPACITY DETAIL · WEEK ' +
      item.week +
      "</p><h2>" +
      esc(item.location) +
      '</h2></div><button id="close-hotspot">Close ×</button></div><p>' +
      item.used +
      " possession groups / " +
      item.capacity +
      " available slots · " +
      ids.length +
      " activities · " +
      item.excess +
      " extra slots. Co-sharing activities in the same group consume one slot here.</p>" +
      table(
        ["Activity", "Contract", "Possession group", "Type", "Work nature"],
        ids.map((id) => {
          const activity = result.modelInfo.activities.find((candidate) => candidate.id === id);
          const occupancy = entries.find((entry) => entry.activity_id === id);
          return [
            esc(id),
            esc(activity.contract),
            esc(occupancy.co_share_group),
            esc(activity.access_type),
            esc(activity.nature),
          ];
        }),
      ) +
      '<p class="info">Full capacity does not itself mean a violation. Scenario A permits no excess, B permits penalised excess, and C permits at most one extra slot per location-week.</p>';

    $("close-hotspot").onclick = () => {
      $("inspector").hidden = true;
    };
    $("inspector").scrollIntoView({ behavior: "smooth" });
  }

  return { render, inspect };
}
