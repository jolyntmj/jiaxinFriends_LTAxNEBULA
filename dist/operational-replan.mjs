import { csv, prepare, solve } from "./solver.mjs";
import { compareActivities } from "./experiments.mjs";

/** Replan one scenario after a future capacity disruption, keeping elapsed weeks immutable. */
export function runOperationalReplan(data, baseline, change) {
  if (!baseline?.report.feasible) throw Error("Generate a passing baseline first.");
  const model = prepare(data);
  const freezeThroughWeek = Number(change.freezeThroughWeek);
  const from = Number(change.from);
  const to = Number(change.to);
  const capacity = Number(change.capacity);
  if (
    !Number.isInteger(freezeThroughWeek) ||
    freezeThroughWeek < 0 ||
    freezeThroughWeek >= model.horizon
  )
    throw Error(`Frozen week must be from 0 to ${model.horizon - 1}.`);
  if (!Number.isInteger(from) || from <= freezeThroughWeek || from > model.horizon)
    throw Error("Disruption must start after the frozen weeks and within the planning horizon.");
  if (!Number.isInteger(to) || to < from || to > model.horizon)
    throw Error("Disruption end week must be within the horizon and no earlier than its start.");
  if (!Number.isInteger(capacity) || capacity < 0)
    throw Error("Available weekly slots must be a whole number of zero or more.");
  const originalCapacity = model.supplies.get(change.location);
  if (originalCapacity === undefined) throw Error("Choose a known location.");
  if (capacity >= originalCapacity)
    throw Error(`Choose fewer than ${originalCapacity} slots to model a disruption.`);
  const capacityOverrides = [{ location: change.location, from, to, capacity }];
  const description = `${change.location}: ${originalCapacity} → ${capacity} weekly slots, W${from}–W${to}; weeks 1–${freezeThroughWeek} frozen`;
  const result = solve(data, baseline.scenario, {
    capacityOverrides,
    hardDisruption: true,
    lockedBaseline: baseline,
    freezeThroughWeek,
    preserveFuture: true,
    attempts: 18,
  });
  const prefix = (rows) => rows.filter((row) => row.week <= freezeThroughWeek);
  if (
    JSON.stringify(prefix(result.access)) !== JSON.stringify(prefix(baseline.access)) ||
    JSON.stringify(prefix(result.occupancy)) !== JSON.stringify(prefix(baseline.occupancy))
  )
    throw Error("Frozen history changed; the replan was rejected.");
  result.inputRevision = {
    description,
    kind: "operational-replan",
    freezeThroughWeek,
    files: Object.fromEntries(
      Object.entries(data).map(([name, rows]) => [`${name}.csv`, csv(rows)]),
    ),
    capacityOverrides,
    hardDisruption: true,
  };
  return {
    result,
    description,
    change: { location: change.location, from, to, capacity, freezeThroughWeek },
    moved: compareActivities(baseline, result),
  };
}
