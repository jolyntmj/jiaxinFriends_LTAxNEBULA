import { prepare } from "./solver.mjs";
import { evaluatePlan } from "./recommendations.mjs";

const intersects = (first, second) => first.some((location) => second.includes(location));
const slotCount = (rows) =>
  new Set(rows.map((row) => `${row.week}|${row.location_id}|${row.co_share_group}`)).size;

/** Turn validator identifiers into a reason a planner can act on. */
export function explainCoShareViolation(violation, model, candidate, testedPair) {
  if (!violation) return "The proposed share did not pass local validation.";
  const { rule, detail } = violation;
  if (rule === "closure") {
    const match = /^(\d+)\|[^:]+: (.+) \/ (.+)$/.exec(detail);
    if (!match) return "The proposed share conflicts with a safety closure.";
    const [, week, firstId, secondId] = match;
    const first = model.byId.get(firstId);
    const second = model.byId.get(secondId);
    const additionalActivity = !testedPair.includes(firstId) || !testedPair.includes(secondId);
    const introduction = additionalActivity
      ? `This merge would also put ${firstId} and ${secondId} in one possession in week ${week}. `
      : `${firstId} and ${secondId} would share one possession in week ${week}. `;
    if (first?.live || second?.live)
      return introduction + "Live work cannot share this possession under the safety rules.";
    if (first?.p.access_type === "PM" || second?.p.access_type === "PM")
      return introduction + "PM work must have its own possession.";
    if (first?.p.access_type === "PC" && second?.p.access_type === "PC")
      return introduction + "Two PC activities cannot share a possession.";
    return (
      introduction +
      "Their safety areas overlap, but their work areas do not overlap in a way that permits co-sharing."
    );
  }
  if (rule === "mix") {
    const [week, location, group] = detail.split("|");
    const activities = [
      ...new Set(
        candidate.occupancy
          .filter(
            (row) =>
              String(row.week) === week &&
              row.location_id === location &&
              row.co_share_group === group,
          )
          .map((row) => row.activity_id),
      ),
    ].map((id) => model.byId.get(id));
    const prefix = `At ${location} in week ${week}, this possession would contain ${activities.length} activities. `;
    if (activities.some((activity) => activity?.p.access_type === "PM"))
      return prefix + "PM work must be alone.";
    if (activities.filter((activity) => activity?.p.access_type === "PC").length > 1)
      return prefix + "Only one PC activity may share with C activities.";
    return prefix + "A possession may contain at most four compatible activities.";
  }
  if (rule === "capacity") {
    const [week, location] = detail.split("|");
    const used = new Set(
      candidate.occupancy
        .filter((row) => String(row.week) === week && row.location_id === location)
        .map((row) => row.co_share_group),
    ).size;
    return `At ${location} in week ${week}, the plan would need ${used} possessions, exceeding the permitted capacity.`;
  }
  const readableRules = {
    workfront: "contractor team limit",
    occupancy: "work-location coverage",
    possession: "consistent possession grouping",
    planned_date: "required completion date",
    predecessor: "activity order",
    eclo_window: "extended-access window",
  };
  return `The proposed share fails the ${readableRules[rule] || rule.replaceAll("_", " ")} check.`;
}

/** Explain existing sharing and validate possible same-week group merges locally. */
export function exploreCoSharing(data, result, limit = 80) {
  if (!result?.report.feasible) return { existing: [], opportunities: [], rejected: [] };
  const model = prepare(data, {
    capacityOverrides: result.inputRevision?.capacityOverrides || [],
    hardDisruption: result.inputRevision?.hardDisruption || false,
  });
  const byWeek = new Map();
  const byGroup = new Map();
  for (const row of result.access) {
    const entries = byWeek.get(row.week) || [];
    entries.push(model.byId.get(row.activity_id));
    byWeek.set(row.week, entries);
  }
  for (const row of result.occupancy) {
    const key = `${row.week}|${row.location_id}|${row.co_share_group}`;
    const ids = byGroup.get(key) || new Set();
    ids.add(row.activity_id);
    byGroup.set(key, ids);
  }
  const existing = [...byGroup]
    .filter(([, ids]) => ids.size > 1)
    .map(([key, ids]) => {
      const [week, location, group] = key.split("|");
      return { week: Number(week), location, group, activities: [...ids] };
    });
  const opportunities = [];
  const rejected = [];
  const seen = new Set();
  let checked = 0;
  for (const [week, activities] of byWeek) {
    for (let firstIndex = 0; firstIndex < activities.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < activities.length; secondIndex++) {
        const first = activities[firstIndex];
        const second = activities[secondIndex];
        if (!intersects(first.core, second.core)) continue;
        const firstGroup = result.occupancy.find(
          (row) => row.week === week && row.activity_id === first.activity_id,
        )?.co_share_group;
        const secondGroup = result.occupancy.find(
          (row) => row.week === week && row.activity_id === second.activity_id,
        )?.co_share_group;
        if (!firstGroup || !secondGroup || firstGroup === secondGroup) continue;
        const key = `${week}|${first.activity_id}|${second.activity_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        let reason = "";
        if (first.live || second.live) reason = "Live-work safety exclusion";
        else if (first.p.access_type === "PM" || second.p.access_type === "PM")
          reason = "PM must possess alone";
        else if (first.p.access_type === "PC" && second.p.access_type === "PC")
          reason = "Two PC activities cannot share";
        if (reason) {
          rejected.push({ week, first: first.activity_id, second: second.activity_id, reason });
          continue;
        }
        if (checked++ >= limit) continue;
        const occupancy = result.occupancy.map((row) =>
          row.week === week && row.activity_id === second.activity_id
            ? { ...row, co_share_group: firstGroup }
            : { ...row },
        );
        const candidate = evaluatePlan(model, result, result.access, occupancy);
        if (!candidate.report.feasible) {
          rejected.push({
            week,
            first: first.activity_id,
            second: second.activity_id,
            reason: explainCoShareViolation(candidate.report.hard_violations[0], model, candidate, [
              first.activity_id,
              second.activity_id,
            ]),
          });
          continue;
        }
        opportunities.push({
          week,
          first: first.activity_id,
          second: second.activity_id,
          slotsSaved: slotCount(result.occupancy) - slotCount(occupancy),
          penaltyChange: candidate.report.objective_score - result.report.objective_score,
          candidate,
        });
      }
    }
  }
  opportunities.sort((a, b) => b.slotsSaved - a.slotsSaved || a.penaltyChange - b.penaltyChange);
  return { existing, opportunities, rejected, checked, truncated: checked > limit };
}
