const DAY = 86400000;
export const weekDate = (result, week, end = false) => new Date(Date.parse(result.modelInfo.start) + ((week - 1) * 7 + (end ? 6 : 0)) * DAY).toISOString().slice(0, 10);
export const shortDate = date => new Date(date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export function activityStatus(result, activity, data) {
  const rows = result.access.filter(row => row.activity_id === activity.id);
  const units = rows.reduce((sum, row) => sum + 1 + row.eclo * .5, 0);
  const finish = rows.length ? Math.max(...rows.map(row => row.week)) : null;
  const input = data['08_ACTIVITY_DETAILS'].find(row => row.activity_id === activity.id);
  const project = data['07_PROJECT_DETAILS'].find(row => row.contract_number === activity.contract && row.activity_type === input?.activity_type);
  const dueDate = project?.planned_completion_date || weekDate(result, activity.due, true);
  const lateDays = finish ? Math.max(0, Math.round((Date.parse(weekDate(result, finish, true)) - Date.parse(dueDate)) / DAY)) : 0;
  return { rows, units, finish, dueDate, lateDays, complete: units >= activity.workload,
    delayPenalty: lateDays * activity.weight, extended: rows.filter(row => row.eclo).length };
}
export function locationName(id) {
  const [kind, line, place, bound] = id.split(':');
  return `${line === 'ALP' ? 'Alpha' : line === 'BET' ? 'Beta' : line} · ${place?.replaceAll('_', '–')} ${kind === 'PLAT' ? 'platform' : 'tunnel'} · ${bound === 'EB' ? 'eastbound' : 'westbound'}`;
}
export function capacityAt(data, result, location, week) {
  const override = result.inputRevision?.capacityOverrides?.find(change => change.location === location && week >= change.from && week <= change.to);
  return override?.capacity ?? Number(data['04_LOCATION_SUPPLY'].find(row => row.location_id === location)?.supply_capacity || 0);
}
export function capacityRows(data, result) {
  const groups = new Map();
  for (const row of result.occupancy) {
    const key = `${row.week}|${row.location_id}`;
    if (!groups.has(key)) groups.set(key, { week: row.week, location: row.location_id, groups: new Set(), activities: new Set() });
    groups.get(key).groups.add(row.co_share_group);
    groups.get(key).activities.add(row.activity_id);
  }
  return [...groups.values()].map(row => {
    const capacity = capacityAt(data, result, row.location, row.week);
    return { ...row, used: row.groups.size, capacity, excess: Math.max(0, row.groups.size - capacity) };
  }).sort((a, b) => b.excess - a.excess || (b.used - b.capacity) - (a.used - a.capacity) || a.week - b.week || a.location.localeCompare(b.location));
}
