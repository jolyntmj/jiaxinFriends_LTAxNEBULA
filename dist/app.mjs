import { renderTimeline, renderContracts, renderCapacity, renderNetwork } from "./results-views.mjs?v=plan-comparison-2";
import { createExperimentPanel } from "./experiment-panel.mjs?v=plan-comparison-2";
import { $, esc, fmt, table } from "./ui.mjs";
import { createEnhancements } from "./enhancements.mjs";
import { FILES, parseCSV, prepare, outputFiles } from "./solver.mjs";
import { makeZIP } from "./zip.mjs";

let data = null;
let results = {};
let originals = {};
let suggestions = {};
let searched = {};
let scenario = "A";
let view = "timeline";
let busy = false;
let worker = null;

const titles = {
  A: "Strict supply",
  B: "Strict schedule",
  C: "Balanced",
};

const descriptions = {
  A: "Supply stays fixed. Completion dates absorb congestion.",
  B: "Meet every planned date. Pay only for the additional access and extended nights needed.",
  C: "Balance priority-weighted delays against extra access and extended working nights.",
};

function message(s, error = false) {
  $("message").textContent = s;
  $("message").classList.toggle("error", error);
}

function setBusy(v) {
  busy = v;

  for (const id of ["run", "files"]) {
    $(id).disabled = v || (id === "run" && !data);
  }

  $("export").disabled =
    v || !results[scenario]?.report.feasible;

  $("export-all").disabled =
    v ||
    !["A", "B", "C"].every(
      (s) => results[s]?.report.feasible,
    );
}

function loaded(d, name) {
  prepare(d);

  data = d;
  results = {};
  experimentPanel.reset();
  originals = {};
  suggestions = {};
  searched = {};

  $("inspector").hidden = true;

  $("instance-status").textContent =
    name +
    " · " +
    d["07_PROJECT_DETAILS"].length +
    " contract/type records · " +
    d["08_ACTIVITY_DETAILS"].length +
    " activities · " +
    d["04_LOCATION_SUPPLY"].length +
    " locations";

  message(
    "Instance checked. Generate schedules to compare all three scenarios.",
  );

  render();
  setBusy(false);
}

$("files").onchange = async (e) => {
  try {
    const d = {};

    for (const f of e.target.files) {
      const name = f.name
        .replace(/\(\d+\)(?=\.csv$)/, "")
        .replace(/\.csv$/i, "");

      if (!FILES.includes(name)) {
        continue;
      }

      if (d[name]) {
        throw Error("Duplicate input: " + name);
      }

      if (f.size > 20 * 1024 * 1024) {
        throw Error(f.name + " exceeds 20 MB");
      }

      d[name] = parseCSV(await f.text());
    }

    loaded(d, "Uploaded planning instance");
  } catch (e) {
    message(e.message, true);
    e.target.value = "";
  }
};

function generate() {
  if (!data || busy) {
    return;
  }

  results = {};
  experimentPanel.reset();
  originals = {};
  suggestions = {};
  searched = {};

  $("inspector").hidden = true;

  setBusy(true);
  render();

  worker = new Worker("worker.mjs", {
    type: "module",
  });

  worker.onmessage = (e) => {
    const x = e.data;

    if (x.type === "progress") {
      message(
        "Scheduling" +
          " " +
          x.scenario +
          " — comparing constraints and placements…",
      );
    }

    if (x.type === "result") {
      results[x.scenario] = x.result;
      originals[x.scenario] = x.result;
      render();
    }

    if (x.type === "recommendation") {
      suggestions[x.scenario] = x.recommendation;
      searched[x.scenario] = true;
      render();
    }

    if (x.type === "done") {
      worker.terminate();
      worker = null;

      setBusy(false);
      render();

      const all = Object.values(results).every(
        (r) => r.report.feasible,
      );

      message(
        all
          ? "Schedules pass the implemented checks and are ready to inspect or export."
          : "Some candidates fail checks. Review diagnostics; failing schedules cannot be exported.",
        !all,
      );
    }

    if (x.type === "error") {
      worker.terminate();
      worker = null;

      setBusy(false);
      render();

      message(x.message, true);
    }
  };

  worker.onerror = (e) => {
    worker?.terminate();
    worker = null;

    setBusy(false);
    render();

    message(
      "Scheduling failed: " + e.message,
      true,
    );
  };

  worker.postMessage({ data });
}

$("run").onclick = generate;

document
  .querySelectorAll("[data-scenario]")
  .forEach((button) => {
    button.onclick = () => {
      scenario = button.dataset.scenario;
      $("inspector").hidden = true;
      render();
    };
  });

document
  .querySelectorAll("[data-view]")
  .forEach((button) => {
    button.onclick = () => {
      view = button.dataset.view;
      render();
    };
  });

$("line").onchange = render;
$("search").oninput = render;

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = name;
  anchor.click();

  setTimeout(
    () => URL.revokeObjectURL(url),
    10000,
  );
}

function exportZip(all) {
  const files = {};

  const scenarios = all
    ? ["A", "B", "C"]
    : [scenario];

  for (const s of scenarios) {
    const r = results[s];

    if (!r?.report.feasible) {
      return;
    }

    if (r.inputRevision) {
      const prefix = all ? s + '/' : '';
      for (const [name, content] of Object.entries(r.inputRevision.files)) {
        files[prefix + 'revised_inputs/' + name] = content;
      }
      const description = r.inputRevision.description || `${r.inputRevision.activityId} planned start changed from ${r.inputRevision.previous} to ${r.inputRevision.proposed}`;
      files[prefix + 'WHAT_IF_README.txt'] = `What-if plan: ${description}. Results pass implemented checks against the included revised inputs and any capacity overrides, not the original instance. For weekly overrides, use experiment.json with solve(data, scenario, {capacityOverrides}); the static supply CSV alone does not encode them.`;
      files[prefix + 'experiment.json'] = JSON.stringify({ description, capacityOverrides: r.inputRevision.capacityOverrides || [] }, null, 2);
    }

    for (const [name, content] of Object.entries(
      outputFiles(r),
    )) {
      files[(all ? s + "/" : "") + name] =
        content;
    }
  }

  const filename =
    all
      ? (scenarios.some(s => results[s].inputRevision) ? "WhatIf_Results_ABC.zip" : "TrackPlan_Results_ABC.zip")
      : (results[scenario].inputRevision ? "WhatIf_" : "") + "Scenario_" + scenario + ".zip";

  download(
    filename,
    makeZIP(files),
  );
}

$("export").onclick = () =>
  exportZip(false);

$("export-all").onclick = () =>
  exportZip(true);

function filtered(r) {
  const query = $("search")
    .value
    .toLowerCase();

  const line = $("line").value;

  return r.modelInfo.activities.filter(
    (activity) =>
      (!line || activity.line === line) &&
      (
        !query ||
        (
          activity.id +
          " " +
          activity.contract
        )
          .toLowerCase()
          .includes(query)
      ),
  );
}

function render() {
  enhancements.render();
  experimentPanel.render();

  $("export-all").textContent =
    "Download all scenarios ↓";

  document
    .querySelectorAll("[data-scenario]")
    .forEach((button) => {
      const selected =
        button.dataset.scenario === scenario;

      button.classList.toggle(
        "selected",
        selected,
      );

      button.setAttribute(
        "aria-pressed",
        selected,
      );
    });

  document
    .querySelectorAll("[data-view]")
    .forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.view === view,
      );
    });

  for (const s of ["A", "B", "C"]) {
    const r = results[s];

    $("score-" + s).textContent = r
      ? fmt(r.report.objective_score)
      : "—";

    $("meta-" + s).textContent = r
      ? (
          r.report.feasible
            ? r.inputRevision ? "Experiment checks passed" : "Checks passed"
            : "Checks failed"
        ) +
        " · " +
        r.report.complete +
        "/" +
        r.report.total +
        " activities delivered"
      : "Generate schedules to compare";
  }

  $("scenario-title").textContent =
    "Scenario " +
    scenario +
    " · " +
    titles[scenario];

  $("scenario-description").textContent =
    descriptions[scenario];

  const r = results[scenario];

  $("export").disabled =
    busy || !r?.report.feasible;

  $("export-all").disabled =
    busy ||
    !["A", "B", "C"].every(
      (s) => results[s]?.report.feasible,
    );

  $("validation-badge").textContent = r
    ? r.inputRevision ? "What-if · revised-input checks passed" : r.report.feasible
      ? "Implemented checks passed"
      : "Review violations"
    : "Awaiting schedule";

  $("validation-badge").className =
    "badge " +
    (
      r
        ? r.report.feasible
          ? "good"
          : "bad"
        : ""
    );

  if (!r) {
    $("metrics").innerHTML = [
      "Workload delivered",
      "Contract-overrun days",
      "Extra access slots",
      "Extended nights",
    ]
      .map(
        (label) =>
          "<article>" +
            "<span>" +
              label +
            "</span>" +
            "<strong>—</strong>" +
          "</article>",
      )
      .join("");

    $("view").innerHTML =
      '<div class="empty">' +
        "<span>" +
          "01 / LOAD THE DEMAND BOOK" +
        "</span>" +
        "<h3>" +
          "Your planning timeline starts here." +
        "</h3>" +
        "<p>" +
          "Load the dataset, then generate A, B and C." +
        "</p>" +
      "</div>";

    return;
  }

  const report = r.report;

  $("metrics").innerHTML = [
    [
      "Workload delivered",
      report.complete +
        " / " +
        report.total,
      "activities",
    ],
    [
      "Contract-overrun days",
      fmt(report.overrun_days_total),
      report.contracts_overrunning +
        " contracts late",
    ],
    [
      "Extra access slots",
      fmt(
        report.excess_access_nights_total,
      ),
      "summed by location-week",
    ],
    [
      "Extended nights",
      report.eclo_nights_total,
      "ECLO access records",
    ],
  ]
    .map(
      ([label, number, summary]) =>
        "<article>" +
          "<span>" +
            label +
          "</span>" +
          "<strong>" +
            number +
            " <small>" +
              summary +
            "</small>" +
          "</strong>" +
        "</article>",
    )
    .join("");

  const names = {
    timeline: [
      "Activity access plan",
      "See when work happens, which activities are late, and how much workload each access delivers.",
    ],

    contracts: [
      "Contract delivery",
      "Compare target and scheduled completion, then trace delays to the activities that drive them.",
    ],

    capacity: [
      "Capacity & validation",
      "Understand the score, inspect busy locations, and see what every check means.",
    ],

    network: [
      "Dual-line network",
      "Explore each week’s work, platform use, tunnel access and safety closures.",
    ],
  };

  $("view-title").textContent =
    names[view][0];

  $("view-help").textContent =
    names[view][1];

  const viewContext = { data, activities: filtered(r), line: $("line").value, redraw: render };

  if (view === "timeline") {
    renderTimeline(r, viewContext);
  }

  if (view === "contracts") {
    renderContracts(r, viewContext);
  }

  if (view === "capacity") {
    renderCapacity(r, viewContext);
  }

  if (view === "network") {
    renderNetwork(r, viewContext);
  }

  $("view")
    .querySelectorAll("[data-inspect]")
    .forEach((button) => {
      button.onclick = () =>
        inspect(
          button.dataset.inspect,
        );
    });
}

function inspect(id) {
  const r = results[scenario];

  const activity =
    r.modelInfo.activities.find(
      (item) => item.id === id,
    );

  const accesses = r.access.filter(
    (access) =>
      access.activity_id === id,
  );

  const firstWeek = Math.min(
    ...accesses.map(
      (access) => access.week,
    ),
  );

  const lastWeek = Math.max(
    ...accesses.map(
      (access) => access.week,
    ),
  );

  const delays =
    r.decisions[id] || [];

  const extendedNights =
    accesses.filter(
      (access) => access.eclo,
    ).length;

  const deliveredUnits =
    accesses.reduce(
      (sum, access) =>
        sum +
        1 +
        0.5 * access.eclo,
      0,
    );

  const earliestFinish =
    activity.start +
    Math.ceil(activity.workload) -
    1;

  $("inspector").hidden = false;

  const detailCards = [
    [
      "Delivered / required",
      deliveredUnits +
        " / " +
        activity.workload +
        " units",
    ],

    [
      "Scheduled weeks",
      firstWeek +
        "–" +
        lastWeek,
    ],

    [
      "Earliest start / target",
      "W" +
        activity.start +
        " / W" +
        activity.due,
    ],

    [
      "Extended nights",
      extendedNights,
    ],
  ]
    .map(
      ([label, number]) =>
        "<article>" +
          "<span>" +
            label +
          "</span>" +
          "<strong>" +
            number +
          "</strong>" +
        "</article>",
    )
    .join("");

  let scheduleExplanation = "";

  if (activity.predecessor) {
    scheduleExplanation +=
      "Must follow " +
      esc(activity.predecessor) +
      " in a strictly later week. ";
  } else {
    scheduleExplanation +=
      "No predecessor. ";
  }

  if (earliestFinish > activity.due) {
    scheduleExplanation +=
      "Even without congestion, standard nights finish no earlier than week " +
      earliestFinish +
      ", after the target. ";
  } else {
    scheduleExplanation +=
      "The start date and workload can fit before the target in isolation. ";
  }

  if (lastWeek > activity.due) {
    scheduleExplanation +=
      "This plan finishes " +
      (
        (lastWeek - activity.due) *
        7
      ) +
      " calendar days after the target week.";
  } else {
    scheduleExplanation +=
      "This plan finishes within the target week.";
  }

  const delayWarning = delays.length
    ? '<div class="info warning">' +
        "Deferred in weeks " +
        delays
          .map(
            (delay) => delay.week,
          )
          .join(", ") +
        ": buffers, possession capacity or contractor access/team limits " +
        "prevented a placement in the attempted plan." +
      "</div>"
    : "";

  const accessRows = accesses.map(
    (access) => [
      access.access_seq,
      access.week,
      access.access_night,
      access.eclo
        ? "1.5 · ECLO"
        : "1.0",

      esc(
        r.occupancy.find(
          (occupation) =>
            occupation.activity_id === id &&
            occupation.week ===
              access.week,
        )?.co_share_group,
      ),
    ],
  );

  $("inspector").innerHTML =
    '<div class="inspector-top">' +
      "<div>" +
        '<p class="eyebrow">' +
          "ACTIVITY DETAIL · SCENARIO " +
          scenario +
        "</p>" +

        "<h2>" +
          esc(activity.id) +
          " / " +
          esc(activity.contract) +
          " · " +
          esc(activity.line) +
          " " +
          esc(activity.bound) +
        "</h2>" +

        '<p class="muted">' +
          esc(activity.nature) +
          " · " +
          esc(activity.access_type) +
          " possession · Contract priority " +
          activity.priority +
        "</p>" +
      "</div>" +

      '<button id="close-inspector" aria-label="Close activity detail">' +
        "Close ×" +
      "</button>" +
    "</div>" +

    '<div class="detail-grid">' +
      detailCards +
    "</div>" +

    '<div class="info">' +
      scheduleExplanation +
    "</div>" +

    delayWarning +

    "<h3>Occupied route</h3>" +

    '<p class="path">' +
      activity.core
        .map(esc)
        .join(" → ") +
    "</p>" +

    "<details>" +
      "<summary>" +
        "Safety footprint: " +
        activity.footprint.length +
        " locations" +
      "</summary>" +

      '<p class="path">' +
        activity.footprint
          .map(esc)
          .join("<br>") +
      "</p>" +
    "</details>" +

    "<h3>Access records</h3>" +

    table(
      [
        "Sequence",
        "Week",
        "Contract night index",
        "Yield",
        "Possession group",
      ],
      accessRows,
    );

  $("close-inspector").onclick = () => {
    $("inspector").hidden = true;
  };

  enhancements.inspect(id);

  $("inspector").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

// Feature-detected declarative tools expose the same visible UI actions.
if (
  navigator.modelContext?.registerTool
) {
  try {
    navigator.modelContext.registerTool({
      name:
        "generate_track_schedules",

      description:
        "Generate A, B and C schedules for the currently loaded planning instance.",

      inputSchema: {
        type: "object",
        properties: {},
      },

      execute: async () => {
        if (!data) {
          return {
            content: [
              {
                type: "text",
                text:
                  "Load a planning instance first.",
              },
            ],
          };
        }

        $("run").click();

        return {
          content: [
            {
              type: "text",
              text:
                "Scheduling started. Results appear in the visible workspace.",
            },
          ],
        };
      },
    });
  } catch {
    // WebMCP is optional.
  }
}

const experimentPanel = createExperimentPanel({
  state: () => ({ data, results, originals, suggestions, scenario, busy }),
  busy: setBusy,
  message,
  show: selected => {
    results = { ...selected };
    $("inspector").hidden = true;
    render();
  },
});

const enhancements =
  createEnhancements({
    state: () => ({
      data,
      results,
      scenario,
      busy,
    }),

    download,

    inspect,

    selectScenario: (selected) => {
      scenario = selected;
      $("inspector").hidden = true;
      render();
    },
  });

render();

