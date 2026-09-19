import { $, esc, fmt, table } from "./ui.mjs";

/** Event-driven disruption workflow; no live feed or official validator is implied. */
export function createOperationsPanel(api) {
  const panel = $("operations-panel");
  let replan = null;
  let dataset = null;
  let job = null;

  panel.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = api.state();
    const form = event.target;
    const change = Object.fromEntries(new globalThis.FormData(form));
    try {
      // Synchronous validation gives immediate feedback before starting the worker.
      const from = Number(change.from);
      const frozen = Number(change.freezeThroughWeek);
      if (from <= frozen) throw Error("Disruption must start after the frozen weeks.");
      if (!state.originals[state.scenario]?.report.feasible)
        throw Error("Generate a passing baseline first.");
    } catch (error) {
      api.message(error.message, true);
      return;
    }
    api.busy(true);
    api.message(`Replanning scenario ${state.scenario} from week ${change.from}…`);
    try {
      job = new Worker("operational-worker.mjs", { type: "module" });
      job.onmessage = ({ data: response }) => {
        job?.terminate();
        job = null;
        api.busy(false);
        if (response.type === "error") {
          api.message(response.message, true);
          return;
        }
        replan = response.replan;
        api.show({ ...api.state().originals, [state.scenario]: replan.result });
        api.message(
          replan.result.report.feasible
            ? "Replan ready. Frozen weeks are unchanged; review moved work and local checks."
            : "No passing replan was found. Inspect the violations before using this plan.",
          !replan.result.report.feasible,
        );
      };
      job.onerror = (error) => {
        job?.terminate();
        job = null;
        api.busy(false);
        api.message(`Replanning failed: ${error.message}`, true);
      };
      job.postMessage({ data: state.data, baseline: state.originals[state.scenario], change });
    } catch (error) {
      job?.terminate();
      job = null;
      api.busy(false);
      api.message(`Replanning could not start: ${error.message}`, true);
    }
  });
  panel.addEventListener("click", (event) => {
    const action = event.target.closest("[data-replan-action]")?.dataset.replanAction;
    if (!action || api.state().busy) return;
    const state = api.state();
    if (action === "baseline") api.show(state.originals);
    if (action === "replan" && replan)
      api.show({ ...state.originals, [replan.result.scenario]: replan.result });
    if (action === "results") api.navigate("results");
  });

  function render() {
    const state = api.state();
    if (dataset !== state.data) {
      dataset = state.data;
      replan = null;
    }
    const baseline = state.originals[state.scenario];
    const ready = Boolean(baseline?.report.feasible);
    const active = replan && state.results[state.scenario] === replan.result;
    const locations = state.data?.["04_LOCATION_SUPPLY"] || [];
    const firstLocation = locations.find((row) => Number(row.supply_capacity) > 0);
    const horizon = baseline?.modelInfo.horizon || 1;
    panel.innerHTML = `<div class="feature-heading"><p class="eyebrow">02 / DISRUPTION RESPONSE</p><h2>Reschedule after a capacity loss</h2><p class="muted">Freeze weeks already worked, enter the disruption, then see a revised future schedule. This runs when you submit a change; it is not connected to a live operations feed.</p></div>
      <div class="feature-mode"><strong>Future weeks may move</strong><span>Use this when access capacity changes. It rebuilds the remaining schedule; unlike co-sharing, activities may shift to different weeks.</span></div>
      <div class="feature-note">Past access and possession records stay identical. Future work is kept near its original week and group where feasible, but future approvals are not hard-locked. A failed local check blocks export.</div>
      <form id="replan-form"><fieldset ${!ready || state.busy ? "disabled" : ""}><legend>Disruption details · scenario ${state.scenario}</legend><div class="feature-fields">
        <label>Freeze through week<input name="freezeThroughWeek" type="number" min="0" max="${horizon - 1}" step="1" value="0" required></label>
        <label>Location<select name="location" required>${locations
          .filter((row) => Number(row.supply_capacity) > 0)
          .map(
            (row) =>
              `<option value="${esc(row.location_id)}">${esc(row.location_id)} · ${row.supply_capacity} slots</option>`,
          )
          .join("")}</select></label>
        <label>From week<input name="from" type="number" min="1" max="${horizon}" step="1" value="1" required></label>
        <label>To week<input name="to" type="number" min="1" max="${horizon}" step="1" value="2" required></label>
        <label>Available slots<input name="capacity" type="number" min="0" max="${Math.max(0, Number(firstLocation?.supply_capacity || 1) - 1)}" step="1" value="0" required></label>
      </div><button class="primary" type="submit">${state.busy ? "Replanning…" : "Replan future work →"}</button></fieldset></form>
      ${ready ? "" : '<p class="empty-inline">Generate a passing baseline on Overview to enable replanning.</p>'}
      ${replan ? comparison(state, active) : ""}`;
    const location = panel.querySelector('[name="location"]');
    location?.addEventListener("change", () => {
      const supply = locations.find((row) => row.location_id === location.value);
      panel.querySelector('[name="capacity"]').max = Math.max(
        0,
        Number(supply.supply_capacity) - 1,
      );
    });
  }

  function comparison(state, active) {
    const result = replan.result;
    const baseline = state.originals[result.scenario];
    const moved = replan.moved;
    return `<div class="feature-results"><div class="feature-heading"><p class="eyebrow">IMPACT ASSESSMENT · SCENARIO ${result.scenario}</p><h3>${esc(replan.description)}</h3></div>
      <div class="feature-kpis"><article><span>Activities with changed access</span><strong>${moved.length}</strong></article><article><span>Original penalty</span><strong>${fmt(baseline.report.objective_score)}</strong></article><article><span>Replan penalty</span><strong>${result.report.feasible ? fmt(result.report.objective_score) : "Not feasible"}</strong></article><article><span>Local checks</span><strong>${result.report.feasible ? "Passed" : `${result.report.hard_violations.length} violations`}</strong></article></div>
      <div class="plan-switcher"><div class="actions"><button data-replan-action="baseline" aria-pressed="${!active}">Original baseline</button><button data-replan-action="replan" aria-pressed="${Boolean(active)}">Show replan</button><button data-replan-action="results">Explore results →</button></div></div>
      <details><summary>Review moved activities · ${moved.length}</summary>${table(
        ["Activity", "Original finish", "Revised finish", "Impact"],
        moved.map((row) => [
          esc(row.id),
          row.before ? `W${row.before}` : "—",
          row.after ? `W${row.after}` : "—",
          row.shift === null
            ? "Incomplete"
            : row.shift === 0
              ? "Access pattern changed"
              : `${Math.abs(row.shift)} weeks ${row.shift < 0 ? "earlier" : "later"}`,
        ]),
      )}</details>
      ${result.report.feasible ? "" : `<details open><summary>Checks to resolve</summary>${result.report.hard_violations.map((item) => `<p>${esc(item.rule)}: ${esc(item.detail)}</p>`).join("")}</details>`}
      </div>`;
  }
  return {
    render,
    reset: () => {
      replan = null;
      job?.terminate();
      job = null;
    },
  };
}
