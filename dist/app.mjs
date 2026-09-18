import { createEnhancements } from "./enhancements.mjs";
import { FILES, parseCSV, prepare, outputFiles } from "./solver.mjs";
import { makeZIP } from "./zip.mjs";

const $ = (id) => document.getElementById(id);

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

let data = null;
let results = {};
let scenario = "A";
let view = "timeline";
let busy = false;
let worker = null;
let baselineResults = {};
let experimentalResults = {};
let mode = "baseline";
let experiment = null;

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

const fmt = (x) =>
  Number(x).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });

function message(s, error = false) {
  $("message").textContent = s;
  $("message").classList.toggle("error", error);
}

function setBusy(v) {
  busy = v;

  for (const id of ["run", "example", "files"]) {
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
  baselineResults = {};
  experimentalResults = {};
  mode = "baseline";
  experiment = null;

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

$("example").onclick = async () => {
  try {
    const response = await fetch("example.json");
    const exampleData = await response.json();

    loaded(
      exampleData,
      "Supplied planning instance",
    );
  } catch (e) {
    message(e.message, true);
  }
};

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

function generate(isExperiment = false) {
  if (!data || busy) {
    return;
  }

  if (!isExperiment) {
    baselineResults = {};
    experimentalResults = {};
    experiment = null;
    mode = "baseline";
    results = baselineResults;
  } else {
    experimentalResults = {};
    results = experimentalResults;
    mode = "experiment";
  }

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
        (
          isExperiment
            ? "Re-planning experiment"
            : "Scheduling baseline"
        ) +
          " " +
          x.scenario +
          " — comparing constraints and placements…",
      );
    }

    if (x.type === "result") {
      results[x.scenario] = x.result;
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
          ? isExperiment
            ? "What-if complete. Compare the changes below; your submission baseline is preserved."
            : "Baseline schedules pass the implemented checks. You can now run a what-if comparison."
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

  worker.postMessage({
    data,
    options: isExperiment ? experiment : {},
    baselines: isExperiment
      ? baselineResults
      : {},
  });
}

$("run").onclick = () => generate(false);

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

    for (const [name, content] of Object.entries(
      outputFiles(r),
    )) {
      files[(all ? s + "/" : "") + name] =
        content;
    }
  }

  if (mode === "experiment") {
    files["EXPERIMENT_README.json"] =
      JSON.stringify(
        {
          label:
            "WHAT-IF ONLY — not the original submission baseline",
          changes: experiment,
        },
        null,
        2,
      );
  }

  const filename =
    mode === "experiment"
      ? all
        ? "WhatIf_ABC.zip"
        : "WhatIf_" + scenario + ".zip"
      : all
        ? "PS1_Results_ABC.zip"
        : "Scenario_" + scenario + ".zip";

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

function table(headers, rows) {
  return (
    '<div class="scroll">' +
      "<table>" +
        "<thead>" +
          "<tr>" +
            headers
              .map(
                (header) =>
                  "<th>" + header + "</th>",
              )
              .join("") +
          "</tr>" +
        "</thead>" +
        "<tbody>" +
          rows
            .map(
              (row) =>
                "<tr>" +
                row
                  .map(
                    (cell) =>
                      "<td>" + cell + "</td>",
                  )
                  .join("") +
                "</tr>",
            )
            .join("") +
        "</tbody>" +
      "</table>" +
    "</div>"
  );
}

function render() {
  enhancements.render();

  $("export-all").textContent =
    mode === "experiment"
      ? "Download experiment ↓"
      : "Download all scenarios ↓";

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
            ? "Checks passed"
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
    ? r.report.feasible
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
      "Each coloured cell is an access. Select an activity to inspect its route, dates and constraints.",
    ],

    contracts: [
      "Contract delivery",
      "Completion is the Sunday of the final access week. Overrun is measured against the planned date.",
    ],

    capacity: [
      "Capacity & validation",
      "These are local checks against our reading of the brief; official validation is still required.",
    ],

    network: [
      "Dual-line network",
      "Platforms and tunnel sectors are independent per line and bound. Live work couples both bounds and the interchange.",
    ],
  };

  $("view-title").textContent =
    names[view][0];

  $("view-help").textContent =
    names[view][1];

  if (view === "timeline") {
    renderTimeline(r);
  }

  if (view === "contracts") {
    renderContracts(r);
  }

  if (view === "capacity") {
    renderCapacity(r, report);
  }

  if (view === "network") {
    renderNetwork();
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

function renderTimeline(r) {
  const activities = filtered(r);

  const weeks = Math.max(
    r.modelInfo.horizon,
    r.last,
  );

  const weekHeaders = Array.from(
    { length: weeks },
    (_, index) =>
      '<th title="Week ' +
      (index + 1) +
      '">' +
      (index + 1) +
      "</th>",
  ).join("");

  const activityRows = activities
    .map((activity) => {
      const accesses = new Map(
        r.access
          .filter(
            (access) =>
              access.activity_id ===
              activity.id,
          )
          .map((access) => [
            access.week,
            access,
          ]),
      );

      const weekCells = Array.from(
        { length: weeks },
        (_, index) => {
          const week = index + 1;
          const access =
            accesses.get(week);

          if (!access) {
            return "<td></td>";
          }

          const classes = [
            "cell",
            activity.line.toLowerCase(),
          ];

          if (access.eclo) {
            classes.push("eclo");
          }

          if (week > activity.due) {
            classes.push("late");
          }

          const accessType = access.eclo
            ? "ECLO: 1.5"
            : "Standard: 1";

          return (
            "<td>" +
              '<button data-inspect="' +
                esc(activity.id) +
                '" aria-label="Inspect ' +
                esc(activity.id) +
                " week " +
                week +
              '">' +
                '<span class="' +
                  classes.join(" ") +
                  '" title="Week ' +
                  week +
                  " · " +
                  accessType +
                  ' units">' +
                "</span>" +
              "</button>" +
            "</td>"
          );
        },
      ).join("");

      return (
        "<tr>" +
          "<td>" +
            '<button data-inspect="' +
              esc(activity.id) +
            '">' +
              esc(activity.id) +
              " · " +
              esc(activity.contract) +
            "</button>" +
            "<small>" +
              esc(activity.line) +
              " " +
              esc(activity.bound) +
              " · P" +
              activity.priority +
            "</small>" +
          "</td>" +
          weekCells +
        "</tr>"
      );
    })
    .join("");

  $("view").innerHTML =
    '<div class="scroll">' +
      '<table class="timeline">' +
        "<thead>" +
          "<tr>" +
            "<th>Activity / contract</th>" +
            weekHeaders +
          "</tr>" +
        "</thead>" +
        "<tbody>" +
          activityRows +
        "</tbody>" +
      "</table>" +
    "</div>" +
    '<div class="legend">' +
      "<span><i></i>Alpha</span>" +
      '<span><i class="blue"></i>Beta</span>' +
      '<span><i class="amber"></i>ECLO</span>' +
      '<span><i class="red"></i>After planned completion</span>' +
      "<span>" +
        "Week 1 starts " +
        esc(r.modelInfo.start) +
      "</span>" +
    "</div>";
}

function renderContracts(r) {
  const rows = r.results
    .filter((result) =>
      filtered(r).some(
        (activity) =>
          activity.contract ===
          result.contract_number,
      ),
    )
    .map((result) => {
      const project =
        data["07_PROJECT_DETAILS"].find(
          (item) =>
            item.contract_number ===
            result.contract_number,
        );

      const overrun = result.overrun_days
        ? '<b style="color:#a84f24">' +
          result.overrun_days +
          " days</b>"
        : "On time";

      const activityCount =
        r.modelInfo.activities.filter(
          (activity) =>
            activity.contract ===
            result.contract_number,
        ).length;

      return [
        esc(result.contract_number),
        "P" +
          esc(project.contract_priority),
        esc(
          project.planned_completion_date,
        ),
        esc(
          result.simulated_completion_date,
        ),
        overrun,
        activityCount,
      ];
    });

  $("view").innerHTML = table(
    [
      "Contract",
      "Priority",
      "Planned completion",
      "Scheduled completion",
      "Overrun",
      "Activities",
    ],
    rows,
  );
}

function renderCapacity(r, report) {
  const rules = [
    "workload",
    "planned_start",
    "predecessor",
    "closure",
    "mix",
    "allocation",
    "workfront",
    "capacity",
    "eclo",
    "eclo_window",
    "frequency",
    "occupancy",
    "results",
  ];

  const checkCards = rules
    .map((rule) => {
      const violations =
        report.hard_violations.filter(
          (violation) =>
            violation.rule === rule,
        );

      const status =
        violations.length
          ? "✕"
          : "✓";

      const details = violations.length
        ? " — " +
          violations
            .map(
              (violation) =>
                esc(violation.detail),
            )
            .join("; ")
        : " · passed";

      return (
        '<div class="check ' +
          (
            violations.length
              ? "bad"
              : ""
          ) +
        '">' +
          status +
          " " +
          esc(
            rule.replaceAll("_", " "),
          ) +
          details +
        "</div>"
      );
    })
    .join("");

  const selectedLine = $("line").value;

  const hotspotRows = report.hotspots
    .filter(
      (hotspot) =>
        !selectedLine ||
        hotspot.location.includes(
          ":" +
          selectedLine +
          ":",
        ),
    )
    .map((hotspot) => [
      hotspot.week,

      '<button class="table-button" data-hotspot="' +
        report.hotspots.indexOf(
          hotspot,
        ) +
      '">' +
        esc(hotspot.location) +
      "</button>",

      hotspot.used,
      hotspot.capacity,
      hotspot.excess,
    ]);

  const penaltyText =
    "Penalty: " +
    fmt(
      report.priority_weighted_score,
    ) +
    " weighted delay" +
    (
      scenario === "B"
        ? " (excluded in B)"
        : ""
    ) +
    " + " +
    report.excess_access_nights_total +
    " × 7 extra slots + " +
    report.eclo_nights_total +
    " × 5 extended nights. " +
    "Scenario A excludes the latter two terms.";

  $("view").innerHTML =
    '<div class="info" style="margin:0 22px 18px">' +
      penaltyText +
    "</div>" +
    '<div class="checks">' +
      checkCards +
    "</div>" +
    table(
      [
        "Week",
        "Location",
        "Possessions",
        "Nominal capacity",
        "Extra slots",
      ],
      hotspotRows,
    );
}

function renderNetwork() {
  const stations =
    data["02_STATIONS"];

  const lines =
    data["01_LINES"];

  const networkLines = lines
    .map((line, index) => {
      const lineStations = stations
        .filter(
          (station) =>
            station.line_code ===
            line.line_code,
        )
        .sort(
          (first, second) =>
            Number(first.seq) -
            Number(second.seq),
        );

      const y = 60 + index * 110;

      const colour = index
        ? "#447bc3"
        : "#168f78";

      const stationNodes = lineStations
        .map((station, stationIndex) => {
          const x =
            95 +
            (
              stationIndex * 890
            ) /
              Math.max(
                1,
                lineStations.length - 1,
              );

          const radius =
            station.is_interchange === "1"
              ? 10
              : 7;

          return (
            '<circle cx="' +
              x +
              '" cy="' +
              y +
              '" r="' +
              radius +
              '" fill="white" stroke="' +
              colour +
              '" stroke-width="3"/>' +
            '<text x="' +
              x +
              '" y="' +
              (y + 30) +
              '" text-anchor="middle">' +
              esc(station.station_id) +
            "</text>"
          );
        })
        .join("");

      return (
        '<text x="15" y="' +
          (y - 22) +
          '" class="line-label">' +
          esc(line.line_name) +
        "</text>" +

        '<line x1="95" x2="985" y1="' +
          y +
          '" y2="' +
          y +
          '" stroke="' +
          colour +
          '" stroke-width="5"/>' +

        stationNodes
      );
    })
    .join("");

  const svgHeight =
    lines.length * 110 + 30;

  $("view").innerHTML =
    '<div class="network">' +
      '<svg viewBox="0 0 1050 ' +
        svgHeight +
        '" role="img" aria-label="Network station sequence by line">' +
        networkLines +
      "</svg>" +
    "</div>" +

    '<div class="network-info">' +
      '<div class="info">' +
        "H01–H02: independent Alpha/Beta tracks. " +
        "Only Live power closures cross between lines at the interchange. " +
        "Live closures also mirror onto the opposite bound." +
      "</div>" +

      '<p class="muted">' +
        "This diagram shows topology, not a live operational possession display. " +
        "Inspect an activity to see its occupied locations and full safety footprint." +
      "</p>" +
    "</div>";
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

const enhancements =
  createEnhancements({
    state: () => ({
      data,
      results,
      baseline:
        baselineResults,
      experimental:
        experimentalResults,
      mode,
      experiment,
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

    experiment: (
      experimentConfiguration,
    ) => {
      if (busy) {
        return;
      }

      prepare(
        data,
        experimentConfiguration,
      );

      experiment = structuredClone(
        experimentConfiguration,
      );

      $("experiment-error").textContent =
        "";

      generate(true);
    },

    reset: () => {
      if (busy) {
        return;
      }

      mode = "baseline";
      results = baselineResults;
      experimentalResults = {};
      experiment = null;

      $("inspector").hidden = true;

      render();
    },

    showMode: (selectedMode) => {
      if (busy) {
        return;
      }

      mode = selectedMode;

      results =
        selectedMode === "baseline"
          ? baselineResults
          : experimentalResults;

      $("inspector").hidden = true;

      render();
    },
  });

render();