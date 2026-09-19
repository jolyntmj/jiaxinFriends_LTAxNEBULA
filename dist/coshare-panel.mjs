import { $, esc, fmt, table } from "./ui.mjs";
import { exploreCoSharing } from "./coshare.mjs";

/** Read-only explorer with explicit, validated preview action. */
export function createCoSharePanel(api) {
  const panel = $("coshare-panel");
  let source = null;
  let exploration = null;
  let preview = null;
  panel.addEventListener("click", (event) => {
    const action = event.target.closest("[data-share-action]")?.dataset.shareAction;
    if (!action || api.state().busy) return;
    if (action === "restore" && source)
      api.show({ ...api.state().results, [api.state().scenario]: source });
    if (action.startsWith("preview:")) {
      const index = Number(action.split(":")[1]);
      const choice = exploration?.opportunities[index];
      if (!choice) return;
      preview = choice.candidate;
      api.show({ ...api.state().results, [api.state().scenario]: preview });
      api.message(
        `Local checks passed for the W${choice.week} share. Review the preview before export.`,
      );
    }
    if (action === "results") api.navigate("results");
  });
  function render() {
    const state = api.state();
    const result = state.results[state.scenario];
    if (result !== preview && result !== source) {
      source = result;
      preview = null;
      exploration = result?.report.feasible ? exploreCoSharing(state.data, result) : null;
    }
    panel.innerHTML = `<div class="feature-heading"><p class="eyebrow">03 / SAME-WEEK EFFICIENCY</p><h2>Share an existing access slot</h2><p class="muted">Compare activities already scheduled in the same week and overlapping location. Every preview is checked against TrackPlanner’s implemented rules—not the organiser’s unavailable reference validator.</p></div>
      <div class="feature-mode"><strong>Weeks stay the same</strong><span>Only possession grouping changes. Use this to see whether work already planned together can share one slot; it does not respond to a disruption or move work to another week.</span></div>
      <div class="share-rules"><span>PM: alone</span><span>PC: with up to 3 C</span><span>C: up to 4 together</span><span>Live work: excluded from sharing</span></div>
      ${!exploration ? '<p class="empty-inline">Generate a passing schedule to explore co-sharing.</p>' : content(state)}`;
  }
  function content(state) {
    const shown = state.results[state.scenario] === preview && preview;
    const e = exploration;
    return `<div class="feature-kpis"><article><span>Existing shared location-groups</span><strong>${e.existing.length}</strong></article><article><span>Validated possible merges</span><strong>${e.opportunities.length}</strong></article><article><span>Rejected pairings</span><strong>${e.rejected.length}</strong></article><article><span>Candidate checks</span><strong>${Math.min(e.checked, 80)}</strong></article></div>
      ${shown ? '<div class="feature-note">Preview is showing in Results. This changes the displayed plan only; your original baseline remains available.</div>' : ""}
      <div class="actions"><button data-share-action="restore" ${!preview ? "disabled" : ""}>Restore source plan</button><button data-share-action="results">Explore results →</button></div>
      <h3>Possible merges</h3>${
        e.opportunities.length
          ? table(
              ["Week", "Activities", "Slots freed", "Penalty change", "Action"],
              e.opportunities
                .slice(0, 30)
                .map((item, index) => [
                  `W${item.week}`,
                  `${esc(item.first)} + ${esc(item.second)}`,
                  item.slotsSaved,
                  `${item.penaltyChange > 0 ? "+" : ""}${fmt(item.penaltyChange)}`,
                  `<button data-share-action="preview:${index}">Preview merge</button>`,
                ]),
            )
          : '<p class="empty-inline">No additional valid merge found within the checked pairs. The baseline may already share the compatible work.</p>'
      }
      ${e.truncated ? '<p class="muted">Search capped at 80 detailed candidate checks for responsiveness.</p>' : ""}
      <details><summary>Existing shared possessions · ${e.existing.length}</summary>${table(
        ["Week", "Location", "Group", "Activities"],
        e.existing
          .slice(0, 100)
          .map((item) => [
            `W${item.week}`,
            esc(item.location),
            esc(item.group),
            item.activities.map(esc).join(", "),
          ]),
      )}</details>
      <details><summary>Why pairings were rejected · ${e.rejected.length}</summary>${table(
        ["Week", "Activities", "Reason"],
        e.rejected
          .slice(0, 100)
          .map((item) => [
            `W${item.week}`,
            `${esc(item.first)} + ${esc(item.second)}`,
            esc(item.reason),
          ]),
      )}</details>`;
  }
  return {
    render,
    reset: () => {
      source = null;
      preview = null;
      exploration = null;
    },
  };
}
