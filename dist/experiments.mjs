import { prepare, solve, csv } from './solver.mjs';

export function buildExperiment(data, change) {
  const revised = structuredClone(data);
  const model = prepare(data);
  const descriptions = [];
  const options = { capacityOverrides: [] };
  if (change.activity) {
    const row = revised['08_ACTIVITY_DETAILS'].find(row => row.activity_id === change.activity);
    if (!row) throw Error('Select an activity from the loaded dataset.');
    if (!Number.isInteger(change.startWeek) || change.startWeek < 1 || change.startWeek > model.horizon)
      throw Error(`Start week must be a whole number from 1 to ${model.horizon}.`);
    const oldWeek = model.byId.get(change.activity).start;
    row.planned_start_date = new Date(model.start + (change.startWeek - 1) * 7 * 86400000).toISOString().slice(0, 10);
    descriptions.push(`${change.activity}: earliest start W${oldWeek} → W${change.startWeek}`);
  }
  if (change.location) {
    options.capacityOverrides.push({ location: change.location, from: change.from, to: change.to, capacity: change.capacity });
    if (change.to > model.horizon) throw Error(`Capacity changes must end by week ${model.horizon}.`);
    prepare(revised, options);
    descriptions.push(`${change.location}: ${model.supplies.get(change.location)} → ${change.capacity} weekly slots, W${change.from}–W${change.to}`);
  }
  if (!descriptions.length) throw Error('Choose an activity start change or a location capacity change.');
  return { data: revised, options, description: descriptions.join('; '), change: { ...change } };
}

export function runExperiment(data, change, progress = () => {}) {
  const experiment = buildExperiment(data, change);
  const results = {};
  for (const scenario of ['A', 'B', 'C']) {
    progress(scenario);
    const result = solve(experiment.data, scenario, experiment.options);
    result.inputRevision = {
      description: experiment.description,
      files: Object.fromEntries(Object.entries(experiment.data).map(([name, rows]) => [name + '.csv', csv(rows)])),
      capacityOverrides: experiment.options.capacityOverrides,
    };
    results[scenario] = result;
  }
  return { results, description: experiment.description, change: experiment.change };
}

export function compareActivities(original, revised) {
  const profile = (result, id) => result.access.filter(row => row.activity_id === id)
    .sort((a, b) => a.week - b.week);
  return original.modelInfo.activities.flatMap(activity => {
    const before = profile(original, activity.id);
    const after = profile(revised, activity.id);
    const signature = rows => JSON.stringify(rows.map(row => [row.week, row.eclo, row.access_night]));
    if (signature(before) === signature(after)) return [];
    const finishBefore = before.length ? Math.max(...before.map(row => row.week)) : null;
    const finishAfter = after.length ? Math.max(...after.map(row => row.week)) : null;
    return [{ id: activity.id, contract: activity.contract, before: finishBefore, after: finishAfter,
      shift: finishBefore !== null && finishAfter !== null ? finishAfter - finishBefore : null,
      ecloBefore: before.filter(row => row.eclo).length, ecloAfter: after.filter(row => row.eclo).length }];
  });
}
